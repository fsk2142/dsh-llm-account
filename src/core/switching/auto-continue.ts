/**
 * 自动继续的判定（纯函数）。
 *
 * 需求：「如果当前会话非人为停止然后出现了中断，就自动继续进行」。
 * 宿主的两个接缝各负责一半（签名读自 `dsh-agent-loop/lib/index.js`）：
 *
 * 1. **`agent/request-error`**（waterfall，payload `{turn, step, provider, failure,
 *    retryPolicy, signal}`）——监听器返回 `{ kind: "retry" }` 且不调用 `next()` 即重试。
 *    对应「请求失败」这一类中断。
 * 2. **`agent/turn-stopping`**（serial，payload `{turn, signal}`）——本轮结束前调用；
 *    此时若 `inbox.nextStep` 非空，循环不会 `break`，本轮继续。
 *    对应「回答被截断」这一类中断。
 *
 * 本模块只回答「该不该继续」，不做任何 I/O；宿主接线在 `plugin.ts`。
 *
 * 纪律：**默认全关**。自动续写会改变对话内容、也可能烧额度，与
 * `autoSwitchModelOnQuota` 同一条原则 —— 危险能力默认关闭。
 * @module dsh-llm-account/src/core/switching/auto-continue
 */

/**
 * 自动重试的设置。
 *
 * 2026-10-29 合并：原来 `onError` / `onTruncate` 是两个开关，界面上一堆相邻的复选框
 * 让用户分不清该开哪个（实际两者都是「异常中断后接着跑」）。现在一个 `enabled`
 * 总开关，两件事都归它管。
 */
export interface AutoContinueSettings {
  /** 总开关：任意异常中断（请求失败 / 输出被截断）后是否自动接着跑。 */
  enabled: boolean;
  /** 一次轮次内最多自动继续多少次（防止无限续写烧额度）。 */
  maxAttempts: number;
  /** 每次重试/续写前的等待（毫秒）。 */
  intervalMs: number;
}

/** 默认值：关着、最多 3 次、每次间隔 2 秒。 */
export const DEFAULT_AUTO_CONTINUE: AutoContinueSettings = {
  enabled: false,
  maxAttempts: 3,
  intervalMs: 2000,
};

/**
 * **绝不重试**的失败码 —— 只有用户的意图和「重试必然失败且会烧额度」的少数几类。
 *
 * 2026-10-29 改：从「白名单」（只重试已知瞬时码）改成「黑名单」
 * （除下面这些外全部重试）。用户的原话是「除非手动暂停，剩下的异常中断都要自动重试
 * 三次」—— 白名单会漏掉宿主新增的或本插件没预料到的码，那种情况用户只能手动再发。
 *
 * 黑名单里每一项的理由：
 *
 * - `ABORTED`：**用户按了停止**。把它当异常去重试等于覆盖用户的意图；
 * - `CONTEXT_WINDOW_EXCEEDED`：上下文超长，重试多少次都一样长 —— 只会把一次明确的
 *   错误拖成 N 倍延迟；
 * - `INVALID_CREDENTIAL`：密钥失效，等 2 秒不会自己恢复（本插件的适配器在抛给宿主
 *   之前已经换过账号了，到这里说明全都不可用）；
 * - `QUOTA`：额度用尽，同上 —— 适配器已试过换账号与换模型。
 *
 * **未知码按「重试」处理**（与白名单时代相反）：这是本次改动的核心 —— 宁可多试三次
 * 也不让用户手动补救。
 */
const NEVER_RETRY_CODES: ReadonlySet<string> = new Set([
  "ABORTED",
  "CONTEXT_WINDOW_EXCEEDED",
  "INVALID_CREDENTIAL",
  "QUOTA",
]);

/**
 * 一个失败码是否值得自动重试。
 *
 * **用户主动中止永远不算** —— 他按了停止，我们就必须停；把它当成中断去重试，
 * 等于把用户的意图覆盖掉。
 *
 * 其余情况：只要不在 `NEVER_RETRY_CODES` 里就重试（含**未知码**）。
 * @param code - 宿主的失败码（形状不可信）。
 * @returns 是否值得重试。
 */
export function isTransientFailure(code: string | undefined): boolean {
  // 拿不到码也重试：宿主诊断信息缺失不该让用户手动补救。
  if (code === undefined) return true;
  return !NEVER_RETRY_CODES.has(code);
}

/**
 * 请求失败时该不该重试。
 * @param settings - 当前开关与次数。
 * @param code - 失败码。
 * @param attempts - 本**轮次**内已经自动继续过几次。
 * @returns 是否重试。
 */
export function shouldRetryFailure(
  settings: AutoContinueSettings,
  code: string | undefined,
  attempts: number,
): boolean {
  if (!settings.enabled) return false;
  if (attempts >= settings.maxAttempts) return false;
  return isTransientFailure(code);
}

/**
 * 回答被截断时该不该续写。
 *
 * 只认 `finish.reason === "length"`：那是「模型被输出上限截断」的唯一信号。
 * `stop`（正常结束）与 `tool-call`（交给工具）都是**正常**完成，续写它们会破坏对话。
 * @param settings - 当前开关与次数。
 * @param finishReason - 本轮的结束原因（形状不可信）。
 * @param attempts - 本轮已自动继续次数。
 * @returns 是否续写。
 */
export function shouldContinueOnTruncate(
  settings: AutoContinueSettings,
  finishReason: string | undefined,
  attempts: number,
): boolean {
  if (!settings.enabled) return false;
  if (attempts >= settings.maxAttempts) return false;
  /**
   * 认**两种**写法（2026-10-29）：
   *
   * - `"max-tokens"`：宿主 `dsh-agent-loop` 内部用的就是这个（`finish.kind ===
   *   "max-tokens"` → `turnEnds = { kind: "max-tokens" }`）。本插件的三家适配器也把
   *   厂商的 `length` / `max_tokens` 映射成 `{ kind: "max-tokens" }`；
   * - `"length"`：厂商原始字面量。留着是为了**探针实现变了也不静默失效** ——
   *   原来只认 `"length"`，而实际拿到的是 `max-tokens`，于是这条路径从未触发过。
   *
   * `stop`（正常结束）与 `tool-calls`（交给工具）都是**正常**完成，绝不续写。
   */
  return finishReason === "max-tokens" || finishReason === "length";
}
