/**
 * 出站 `messages[]` 的**条数上限**（2026-11-05 修「Open Design 1003 > 1000」）。
 *
 * ## 为什么需要一个条数上限
 *
 * Open Design 网关（`amr-link.open-design.ai/v1`）对 `deepseek-v4.1-flash` 的
 * `messages[]` 有条数硬上限：**1000 条**。第 1001 条直接 400：
 *
 * ```
 * [code=context_length_exceeded] Input is too long: conversation history
 * exceeds the allowed input item limit (1003 > 1000 items).
 * ```
 *
 * 这是**条数**限制，不是 token 限制 —— 宿主只按 token 算压缩时机
 * （`LlmModelContext { contextWindow }` 没有条数字段），所以这条限制永远不会被提前触发。
 *
 * ## 为什么这是「死循环」
 *
 * 报错正文里写着 `Compact the conversation and retry`，宿主也确实那样做了：
 * 一次 `compactIfNeeded(agent, "context-overflow")`。但**压缩请求本身**同样要发
 * `messages[]` —— 而且发的还是同一份超限历史。于是压缩也 400、`compaction/end`
 * 带着同一个 400、回合结束。下一轮照样 1003 条，照样失败。
 *
 * 换句话说：**不解决出站条数，任何压缩策略都救不回来**。
 *
 * ## 为什么在上限处丢而不是报错
 *
 * 丢历史当然有信息损失，但两种损失不对等：
 *
 * | 选择 | 结果 |
 * | --- | --- |
 * | 照发 | 整轮失败，用户什么都拿不到，且**每轮都失败** |
 * | 裁到上限 + 明确告知 | 本轮能用，模型知道「更早的历史被省略了」 |
 *
 * 所以裁，并且在正文里插一条**明确提示**（绝不静默丢 —— 与 U07/U13 同一条纪律）。
 *
 * ## 裁剪纪律
 *
 * 1. **保留最近的历史**：从新往旧取，预算不够就停在更旧那一条前面（连续后缀）；
 * 2. **工具调用与结果不可拆开**：一个 assistant 的 `tool_calls` 必须和它的
 *    `tool` 结果同进同出。拆开会让模型看到「调用没有结果」，多数兼容网关直接 400；
 * 3. **system 消息全部保留**（身份与规则，通常在开头且很少）；
 * 4. **最后一条消息一定保留**（那就是这一轮的用户输入，丢了等于空请求）；
 * 5. 插入的提示自己也要占一格，所以预算先减一。
 *
 * @module dsh-llm-account/src/core/wire-limit
 */

/**
 * 出站消息的最小形状（三家协议投影出来的都满足）。
 *
 * 只声明裁剪需要读的三个字段：`role`、`tool_calls`（判定「这是一次工具调用」）、
 * `tool_call_id`（判定「这是一条工具结果」）。其余字段原样透传。
 */
export interface WireMessageLike {
  role?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

/** 裁剪结论。 */
export interface WireTrimResult<T extends WireMessageLike> {
  /** 裁剪后的消息（未被裁剪时是原数组的浅拷贝）。 */
  messages: T[];
  /** 被丢掉的条数（不含插入的提示）。 */
  dropped: number;
  /** 是否插入了「更早历史已省略」提示。 */
  noticeInserted: boolean;
}

/**
 * 窗口起点的量化块大小（单位：**组**）。
 *
 * 取 64 组的理由：一次典型回合产生 1～3 组，所以窗口起点大约每 20～60 个回合才挪一次；
 * 其余回合的请求退化成「在末尾追加」，前缀缓存能整段命中。
 *
 * 块太小（比如 8）会频繁挪动，缓存收益不明显；块太大则在跳变那一轮丢得过多。
 */
const DROP_BLOCK_GROUPS = 64;

/**
 * 判断一条投影后的消息是不是「工具调用」的开头。
 * @param message - 投影后的消息。
 * @returns 是否带 `tool_calls`。
 */
function isToolCallMessage(message: WireMessageLike): boolean {
  return message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

/**
 * 把消息切成**不可分割的组**：一条工具调用 + 紧随其后的工具结果算一组。
 *
 * 为什么要成组：OpenAI 形状要求每个 `assistant.tool_calls[].id` 都有对应的
 * `role: "tool"` 消息。只丢掉其中一半会让请求本身非法 —— 那比超限更难查。
 * @param messages - 投影后的消息。
 * @returns 组列表（组内顺序与输入一致）。
 */
function groupsOf<T extends WireMessageLike>(messages: readonly T[]): T[][] {
  const groups: T[][] = [];
  let index = 0;
  while (index < messages.length) {
    const head = messages[index];
    if (head === undefined) break;
    const group = [head];
    index += 1;
    if (isToolCallMessage(head)) {
      while (index < messages.length) {
        const next = messages[index];
        if (next === undefined || next.role !== "tool") break;
        group.push(next);
        index += 1;
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * 无法在 `limit` 内合法裁剪。
 *
 * 什么情况下会抛：
 *
 * - `system` 段本身就已经占满 `limit`（丢掉 system 等于换了个助手，那是更大的破坏）；
 * - 只剩一个**不可分割的工具调用组**比预算还大（拆开会让请求非法，见 {@link groupsOf}）。
 *
 * 为什么抛而不是「尽力而为」：上一版为了保住最后一组会**超出 limit**（F16），
 * 而超限的结果就是网关 400 —— 用户拿到的是「Open Design stream error」，既看不懂
 * 也不知道该怎么办。明确抛错至少能让调用方给出「这次请求太大」这种可行动的提示。
 *
 * **绝不发送已知超过硬上限的请求**是这里的第一原则。
 */
export class WireLimitExceededError extends Error {
  /**
   * @param limit - 硬上限。
   * @param irreducible - 无法再压缩的条数（system 段 + 最后一组）。
   */
  constructor(
    readonly limit: number,
    readonly irreducible: number,
  ) {
    super(
      `cannot trim the request to ${limit} messages: the irreducible part (system messages + the last tool-call group) already takes ${irreducible}`,
    );
    this.name = "WireLimitExceededError";
  }
}

/**
 * 把投影后的消息裁到条数上限以内。
 *
 * ## `limit` 是**严格**不变量（2026-11-05 外部审查 F16）
 *
 * 上一版有两个漏洞，都能让输出超过 `limit`：
 *
 * 1. `Math.max(1, limit - system.length - 1)` —— system 段占满预算时仍强行保一条；
 * 2. 「最后一组比预算大就整组保留」—— 那组 4 条、预算 2 条时输出就是 `limit + 2`。
 *
 * 两个都源于同一句错误的自我安慰：「宁可略微超限也要保住这一轮的输入」。
 * 但超限的**实际后果**是网关 400、整轮失败 —— 比“这次输入太大”糟得多。
 *
 * 现在：能裁就裁到 `limit` 以内；裁不到就抛 {@link WireLimitExceededError}，
 * 由调用方给出可行动的提示。**不发送已知会被拒绝的请求。**
 * @param messages - 投影后的完整消息（含 system）。
 * @param limit - 允许的最大条数；非正数/非有限值表示不限制。
 * @param makeNotice - 生成「历史已省略」提示（各家把它造成自己的消息形状）。
 * @returns 裁剪结论。
 * @throws {@link WireLimitExceededError} 无法在 `limit` 内合法裁剪时。
 */
export function trimWireMessages<T extends WireMessageLike>(
  messages: readonly T[],
  limit: number | undefined,
  makeNotice: (dropped: number) => T,
): WireTrimResult<T> {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0 || messages.length <= limit) {
    return { messages: [...messages], dropped: 0, noticeInserted: false };
  }

  // 开头的 system 连续段整段保留：那是这次请求的身份与规则，丢它会让模型行为跑偏。
  let head = 0;
  while (head < messages.length && messages[head]?.role === "system") head += 1;
  const system = messages.slice(0, head);
  const groups = groupsOf(messages.slice(head));

  /**
   * 只有一组、且它自己就装不下剩余预算 → 无解。
   *
   * 这一组的最后一条是本轮的用户输入（丢了等于空请求），而整组又不可拆 ——
   * 两条路都通向失败，所以如实报出来。
   *
   * **预算里不再给提示留一格**：提示会并进第一条 system（见下方 `notice` 的说明），
   * 而 system 段本来就整段保留。没有 system 时才需要自建一条 —— 那一种情形由
   * `budget` 的 `head0 === undefined` 分支处理。
   */
  const lastGroup = groups.at(-1);
  const noticeSlot = system.length === 0 ? 1 : 0;
  if (system.length >= limit || (groups.length === 1 && lastGroup !== undefined && system.length + lastGroup.length + noticeSlot > limit)) {
    throw new WireLimitExceededError(limit, system.length + (lastGroup?.length ?? 0) + noticeSlot);
  }

  // 从最新往旧取：预算紧张时保留**最近**的历史。
  // **不用 `Math.max(1, …)`**：那是超限的直接来源（F16）。
  const budget = limit - system.length - noticeSlot;
  if (budget <= 0) throw new WireLimitExceededError(limit, system.length + noticeSlot);

  const kept: T[][] = [];
  let used = 0;
  // 从最新往旧取：预算紧张时保留**最近**的历史（那才是这一轮要接着说的内容）。
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === undefined) continue;
    if (used + group.length > budget) break;
    kept.unshift(group);
    used += group.length;
  }

  // 一条都放不下：最后一组（不可拆）比整个预算还大 → 无解。
  if (kept.length === 0) {
    throw new WireLimitExceededError(limit, system.length + (lastGroup?.length ?? 0) + noticeSlot);
  }

  /**
   * ## 窗口起点必须**量化**，否则每轮都换前缀（2026-11-06，缓存命中率暴跌）
   *
   * 上一版取的是「正好装得下的最近 N 组」。问题是：每多一轮对话，`groups` 就长一条，
   * 于是窗口起点**每轮都往后挪一格** —— 而前缀缓存（prompt caching）比的是
   * **从头开始连续相同**的 token。起点一挪，第二条消息就跟上一轮不一样，命中率直接归零。
   *
   * 更隐蔽的是提示文案里的 `${dropped}` 条数也每轮在变，而它被并进**第一条 system** ——
   * 那条消息位于请求最开头，于是连「system 能命中」这点残羹都没了。实测连续两轮的
   * 公共前缀是 **0 条（0.0%）**，肉眼还看不出差别（前 70 个字符完全一样）。
   *
   * 现在把「丢弃多少组」向上量化到 `DROP_BLOCK_GROUPS` 的整数倍：窗口起点在一个块内
   * **保持不动**，请求就退化成「在末尾追加」—— 这才是缓存友好的形状。每积满一个块才
   * 跳一次，跳的那一轮会全量失效，其余轮次正常命中。
   *
   * 向上取整（丢得更多、留得更少）保证仍然落在预算内，绝不会因为量化而超限。
   */
  const rawStart = groups.length - kept.length;
  const aligned = Math.ceil(rawStart / DROP_BLOCK_GROUPS) * DROP_BLOCK_GROUPS;
  /**
   * 取整结果越界时**退回原始起点**。
   *
   * 短请求（组数不到一个块）里 `aligned` 会大于 `groups.length - 1`，硬取整就只剩最后
   * 一组 —— 那会把「工具调用 + 结果」这一整组之外的上下文全丢掉，甚至留下一个孤立的
   * user 消息。这类请求本来也短，缓存收益可以放弃，**正确性优先**。
   */
  const start = aligned <= groups.length - 1 ? aligned : rawStart;
  const windowed = groups.slice(start);
  const usedFinal = windowed.reduce((sum, group) => sum + group.length, 0);

  const dropped = messages.length - system.length - usedFinal;
  /**
   * ## 提示必须**并进第一条 system**，不能自造第二条（自审发现）
   *
   * 原实现把提示当成一条**独立的 system 消息**插在 system 段之后。实测出站序列是
   * `["system","system","user",…]` —— 两个问题：
   *
   * 1. 多数网关（含 OpenAI 官方）只在开头读**一条** system，或要求 system 必须全部
   *    在开头连续出现；第二条位于历史之前的过渡位置，行为未定义；
   * 2. 更要紧的是**提示可能被静默忽略** —— 那么「不要假设你读过被省略的内容」这句
   *    就白写了，模型会以为自己看到了完整历史。这正是当初写这条提示要防的事。
   *
   * 现在：有 system 就把提示追加到**第一条**的内容尾部（保持一条 system）；
   * 没有 system 才自造一条放开头。
   *
   * 这样也顺带省下一格预算（提示不再单独占位），见 `budget` 的计算。
   */
  const notice = makeNotice(dropped);
  const head0 = system[0];
  const merged: T[] =
    head0 === undefined
      ? [notice, ...windowed.flat()]
      : [
          {
            ...head0,
            content: mergeNoticeIntoContent(head0, notice),
          } as T,
          ...system.slice(1),
          ...windowed.flat(),
        ];
  return { messages: merged, dropped, noticeInserted: true };
}

/**
 * 把提示并进原 system 消息的 `content`。
 *
 * `content` 在两家 wire 形状里都是字符串（Open Design 的 system 是纯文本），但为了
 * 不假设任何一家的形状，这里做保守处理：字符串就直接拼接，其它类型退化成
 * 「保留原文 + 提示文本数组」。
 * @param head - 第一条 system 消息。
 * @param notice - 提示消息（它的 `content` 是提示正文）。
 * @returns 新的 content 值。
 */
function mergeNoticeIntoContent(head: WireMessageLike, notice: WireMessageLike): unknown {
  const base = (head as { content?: unknown }).content;
  const extra = (notice as { content?: unknown }).content;
  if (typeof base === "string" && typeof extra === "string") {
    return base === "" ? extra : `${base}\n\n${extra}`;
  }
  return [base, extra];
}

/**
 * 「更早历史已省略」提示的正文。
 *
 * 必须**说清楚发生了什么**：模型要知道这不是用户说的话，且不能假装看过被省略的内容 ——
 * 那正是 U07 「不能静默丢弃」的同一条要求。
 * @param dropped - 被省略的条数。
 * @returns 提示文本。
 */
export function omittedHistoryNotice(dropped: number): string {
  return `[更早的 ${dropped} 条历史消息已省略：本次请求超过了网关的消息条数上限，只能保留最近的部分。不要假设你读过被省略的内容；需要时请让用户重述。]`;
}
