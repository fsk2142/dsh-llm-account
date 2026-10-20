/**
 * 自动继续的判定（纯函数）。
 *
 * 用户要求：「如果当前会话非人为停止然后出现了中断，就自动继续进行」。
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

/** 自动继续的两台开关与次数上限。 */
export interface AutoContinueSettings {
  /** 模型请求失败时是否自动重试（`agent/request-error`）。 */
  onError: boolean;
  /** 回答被截断时是否自动续写（`agent/turn-stopping`）。 */
  onTruncate: boolean;
  /** 一次轮次内最多自动继续多少次（两个开关共用，防止无限续写）。 */
  maxAttempts: number;
}

/** 默认值：两个开关都关、最多 3 次。 */
export const DEFAULT_AUTO_CONTINUE: AutoContinueSettings = { onError: false, onTruncate: false, maxAttempts: 3 };

/**
 * 可以安全重试的**瞬时**失败码。
 *
 * 这份白名单而不是黑名单，理由是错了代价不对称：
 * - 漏掉一个瞬时码 → 用户手动再发一次，损失很小；
 * - 把确定性失败当成瞬时 → 重试 N 次都必然失败，白烧额度、还把一次明确的错误拖成 N 倍延迟。
 *
 * `TRANSPORT` / `SERVER` / `TIMEOUT` / `EMPTY_RESPONSE` / `RATE_LIMIT` / `THROTTLED`
 * 都来自宿主的 `DEFAULT_RETRYABLE_CODES` 与本插件的两个超时码。
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "TRANSPORT",
  "SERVER",
  "TIMEOUT",
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "THROTTLED",
  "LLM_REQUEST_TIMEOUT",
  "LLM_STREAM_IDLE_TIMEOUT",
]);

/**
 * 一个失败码是否属于「中断」这一类（值得重试）。
 *
 * **用户主动中止永远不算** —— 他按了停止，我们就必须停；把它当成中断去重试，
 * 等于把用户的意图覆盖掉。
 * 未知码按**不重试**处理（见 `TRANSIENT_CODES` 的说明）。
 * @param code - 宿主的失败码（形状不可信）。
 * @returns 是否瞬时失败。
 */
export function isTransientFailure(code: string | undefined): boolean {
  if (code === undefined) return false;
  // 用户意图的终点：绝不重试。
  if (code === "ABORTED") return false;
  return TRANSIENT_CODES.has(code);
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
  if (!settings.onError) return false;
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
  if (!settings.onTruncate) return false;
  if (attempts >= settings.maxAttempts) return false;
  return finishReason === "length";
}
