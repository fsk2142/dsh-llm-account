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
 * 把投影后的消息裁到条数上限以内。
 *
 * @param messages - 投影后的完整消息（含 system）。
 * @param limit - 允许的最大条数；非正数/非有限值表示不限制。
 * @param makeNotice - 生成「历史已省略」提示（各家把它造成自己的消息形状）。
 * @returns 裁剪结论。
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

  // 提示自己占一格，所以可用预算要减一；再减掉 system 段。
  const budget = Math.max(1, limit - system.length - 1);

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
  // 病态情形：最后一组自己就超过预算。宁可略微超限，也要保住这一轮的输入 ——
  // 只发一条提示过去等于空请求，那一定失败。
  if (kept.length === 0 && groups.length > 0) {
    const last = groups[groups.length - 1];
    if (last !== undefined) {
      kept.push(last);
      used += last.length;
    }
  }

  const dropped = messages.length - system.length - used;
  return {
    messages: [...system, makeNotice(dropped), ...kept.flat()],
    dropped,
    noticeInserted: true,
  };
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
