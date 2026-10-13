/**
 * 请求内核：给任意 chunk 流套上两个时间预算 —— 整请求 deadline 与流空闲看门狗。
 *
 * 厂商无关、只负责时序与错误码：不认识任何厂商概念，也不碰 `stop` 参数（拒绝不支持的
 * `stop` 序列是宿主契约、由适配器负责）。
 *
 * **预算从「开始消费」算起**：异步生成器在被第一次 `next()` 之前不执行任何代码，因此
 * 调用 `runStream()` 本身不启动原始流、不上膛定时器 —— 「拿到流却从不消费」不会泄漏
 * handle；代价是 deadline 也从第一次索取开始计，而不是从 `runStream()` 调用时刻。
 *
 * **唤醒只靠真实定时器**：注入的 `now` 只用于判定整请求 deadline 的边界（定时器回调
 * 还没轮到、chunk 却已越过 deadline 的情形），不替代定时器。
 *
 * **关闭原始流是尽力而为**：超时/中止时只发一次 `return()` 请求、**不等它完成**。实测
 * 卡在永不落地的 `await` 上的异步生成器不会处理 `return()`（`await iterator.return()`
 * 永久挂起），而那正是看门狗要救的场景 —— 等它等于让看门狗失效。
 * @module dsh-llm-account/src/core/transport
 */
import { LlmError } from "@deepseek-ai/dsh-llm";

/** 整请求超出 deadline 时抛出的错误码（宿主按这个字符串路由重试，不按错误类型）。 */
export const LLM_REQUEST_TIMEOUT = "LLM_REQUEST_TIMEOUT";

/** 流在空闲预算内没有任何 chunk 时抛出的错误码。 */
export const LLM_STREAM_IDLE_TIMEOUT = "LLM_STREAM_IDLE_TIMEOUT";

/**
 * 调用方中止时抛出的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」，
 * 所以这里不另起名字；它不是本模块的公开常量（调用方只需认识 `LlmError.code`）。
 */
const ABORTED = "ABORTED";

/**
 * Node 会把大于该值的延迟夹到 1ms（等于立刻触发）。上膛前先夹住上界，于是「一个足够大的
 * 数」自然地表示「不限制」，不必再引入哨兵值。
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** 两个时间预算，单位毫秒。 */
export interface StreamBudget {
  /**
   * 整请求 deadline：从开始消费到最后一个 chunk 的总预算，**产出中途不重置**。
   * 消费方处理已产出 chunk 的时间也算在这个预算里（它是整条请求的预算，不是网络等待的预算）。
   * 取值可以远大于 {@link MAX_TIMER_DELAY_MS}（上膛时被夹住），表示实际不限制。
   */
  requestTimeoutMs: number;
  /**
   * 流空闲看门狗：两次产出之间允许的最大间隔，**每次拿到 chunk 后重新上膛**。
   * 消费方处理 chunk 的时间不算厂商空闲 —— 这期间没有未完成的索取。
   */
  streamIdleTimeoutMs: number;
}

/** {@link runStream} 的可选接缝。 */
export interface RunStreamOptions {
  /** 调用方取消信号；中止时抛 `ABORTED` 并关闭原始流。 */
  signal?: AbortSignal;
  /** 时钟注入点（epoch 毫秒），只用于整请求 deadline 的边界判定；缺省 `Date.now`。 */
  now?: () => number;
}

/** 打断一次等待的原因；正常的「拿到 chunk」不属于这里。 */
type Interruption = { kind: "abort" | "request" | "idle" };

/** 一次等待的结局：拿到结果，或者被上面三种原因打断。 */
type Wait<T> = { kind: "chunk"; result: IteratorResult<T> } | Interruption;

/**
 * 把预算毫秒夹到 Node 真正能调度的范围。
 * @param ms - 预算毫秒。
 * @returns 上膛用的延迟；非正数或 NaN 交给 `setTimeout` 按 0 处理（立即触发，快速失败），
 *   因为配置校验属于设置层，不在这里重复。
 */
function armDelay(ms: number): number {
  return Math.min(ms, MAX_TIMER_DELAY_MS);
}

/**
 * 把打断原因翻译成宿主认识的 `LlmError`。
 * @param kind - 打断原因。
 * @param budget - 当前预算，用于说明文案。
 * @param signal - 调用方信号，仅 `abort` 分支用来保留原始中止原因。
 * @returns 带稳定 `code` 的错误。
 */
function interruptionError(kind: Interruption["kind"], budget: StreamBudget, signal: AbortSignal | undefined): LlmError {
  switch (kind) {
    case "abort":
      return signal?.reason === undefined
        ? new LlmError("the caller aborted the request", ABORTED)
        : new LlmError("the caller aborted the request", ABORTED, { cause: signal.reason });
    case "request":
      return new LlmError(`the request did not finish within ${budget.requestTimeoutMs}ms`, LLM_REQUEST_TIMEOUT);
    case "idle":
      return new LlmError(`the provider stream produced no chunk for ${budget.streamIdleTimeoutMs}ms`, LLM_STREAM_IDLE_TIMEOUT);
  }
}

/**
 * 尽力关闭原始流：只发关闭请求，不等它完成（见模块头注释）。关闭失败或迟迟不落地都不
 * 改写已经确定的错误，也不产生未处理的拒绝。
 * @param iterator - 原始流的迭代器。
 */
function closeQuietly(iterator: AsyncIterator<unknown>): void {
  try {
    const closing = iterator.return?.();
    if (closing !== undefined) void closing.catch(() => {});
  } catch {
    // 同步抛出的关闭请求同样只是尽力而为。
  }
}

/**
 * 用整请求 deadline 与流空闲看门狗包住一个 chunk 流，并按原顺序透传。
 *
 * 两个预算同时成立、互不抑制：各自有独立定时器，谁先到就报谁的码；**同一时刻都该到点时
 * 整请求 deadline 赢**（它先上膛）。已经越过 deadline 的 chunk 不再下发。
 * @param source - 上游 chunk 流（例如 `TransportPort.stream()` 的结果）。
 * @param budget - 两个时间预算。
 * @param opts - 调用方取消信号与时钟注入点。
 * @returns 与 `source` 同序的 chunk 流；预算耗尽或调用方中止时抛 `LlmError`。
 */
export async function* runStream<T>(
  source: AsyncIterable<T>,
  budget: StreamBudget,
  opts: RunStreamOptions = {},
): AsyncIterable<T> {
  const now = opts.now ?? Date.now;
  const signal = opts.signal;

  // 消费前已中止：既不索取原始流（不发出请求），也不上膛定时器。
  if (signal?.aborted === true) throw interruptionError("abort", budget, signal);

  const deadlineAt = now() + budget.requestTimeoutMs;
  let interrupt: (reason: Interruption) => void = () => {};
  const interrupted = new Promise<Interruption>((resolve) => {
    interrupt = resolve;
  });
  const onAbort = (): void => interrupt({ kind: "abort" });

  const iterator = source[Symbol.asyncIterator]();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let exhausted = false;

  signal?.addEventListener("abort", onAbort);
  // 整请求 deadline 只上膛一次：产出再多也不重置。
  const deadlineTimer = setTimeout(() => interrupt({ kind: "request" }), armDelay(budget.requestTimeoutMs));

  try {
    while (true) {
      // 空闲看门狗按「一次未完成的索取」上膛，拿到 chunk 就清掉。
      idleTimer = setTimeout(() => interrupt({ kind: "idle" }), armDelay(budget.streamIdleTimeoutMs));
      const outcome: Wait<T> = await Promise.race([
        iterator.next().then((result): Wait<T> => ({ kind: "chunk", result })),
        interrupted,
      ]);
      clearTimeout(idleTimer);
      idleTimer = undefined;
      if (outcome.kind !== "chunk") throw interruptionError(outcome.kind, budget, signal);
      if (outcome.result.done === true) {
        exhausted = true;
        return;
      }
      // 定时器回调可能还没轮到：用时钟兜住边界，已越预算的 chunk 不下发。
      if (now() >= deadlineAt) throw interruptionError("request", budget, signal);
      yield outcome.result.value;
    }
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(deadlineTimer);
    signal?.removeEventListener("abort", onAbort);
    if (!exhausted) closeQuietly(iterator);
  }
}
