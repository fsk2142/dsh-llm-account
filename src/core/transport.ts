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

/**
 * 一次**外部请求**的整请求预算（跨阶段共享）。
 *
 * ## 为什么不是每次调用都传 `requestTimeoutMs`（2026-11-01 修 R02 第二版）
 *
 * 上一版给「fetch / 读错误正文 / 协议重发 / runStream」**每一段**都套一个
 * `withRequestDeadline(budget)`。而每个都从**当下**开始算完整预算，于是：
 *
 * ```
 * 用户配 90ms：
 *   等响应头 60ms（< 90 ✓）→ 读错误正文 60ms（< 90 ✓）→ 合计 120ms > 90ms
 *   → 但每一段都"没超时"，整请求实际跑了 120ms
 * ```
 *
 * 实测确认：整请求 90ms 的设置下，把两段各设 60ms，请求仍然跑满 120ms 才结束。
 *
 * 正确语义是**一个 deadline，所有阶段共用剩余时间**。这个类就是那个共享状态：
 * 构造时记下截止时刻，每次 `remainingMs()` 返回剩余，各阶段用它当预算。
 */
export class RequestDeadline {
  /** 截止时刻（epoch 毫秒）。 */
  private readonly deadlineAt: number;

  /**
   * @param budgetMs - 整请求预算（毫秒）。
   * @param now - 时钟注入点；缺省 `Date.now`。
   */
  constructor(budgetMs: number, now: () => number = Date.now) {
    this.deadlineAt = now() + Math.max(1, budgetMs);
  }

  /**
   * 还剩多少毫秒。
   *
   * 已过期时返回一个**极小正数**（不返回 0 或负数）：调用方把它当预算传给
   * `withRequestDeadline` / `runStream`，而那些实现按「正数」校验。返回 0 会让它们
   * 退化成「不限制」。
   * @returns 剩余毫秒（至少 1）。
   */
  remainingMs(): number {
    return Math.max(1, this.deadlineAt - Date.now());
  }

  /**
   * 用**共享 deadline 的剩余预算**包住一次异步操作。
   * @param operation - 要执行的操作（收到可透传给 `fetch` 的 signal）。
   * @param streamIdleTimeoutMs - 流空闲预算（只透传，本方法不用）。
   * @param opts - 调用方取消信号与时钟注入点。
   * @returns 操作结果。
   */
  run<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    streamIdleTimeoutMs: number,
    opts: RunStreamOptions = {},
  ): Promise<T> {
    return withRequestDeadline(operation, { requestTimeoutMs: this.remainingMs(), streamIdleTimeoutMs }, opts);
  }

  /**
   * 把剩余预算交给 `runStream`（流式阶段同样不该重置）。
   * @param streamIdleTimeoutMs - 流空闲预算。
   * @returns `runStream` 需要的预算对象。
   */
  streamBudget(streamIdleTimeoutMs: number): StreamBudget {
    return { requestTimeoutMs: this.remainingMs(), streamIdleTimeoutMs };
  }
}

/**
 * 用**整请求 deadline** 包住一次可能长时间挂起的异步操作（`fetch`、读错误正文）。
 *
 * ## 为什么需要（2026-11-01 修 R02）
 *
 * `runStream` 的 deadline 只覆盖**已经开始产出 chunk 之后**。而一次真实请求里：
 *
 * ```
 * const response = await this.#post(...);              // fetch 等响应头，没有超时
 * if (!response.ok) await readErrorBody(response);     // 读错误正文，没有超时
 * yield* runStream(decodeStream(response.body), ...);  // 超时只包住这里
 * ```
 *
 * 网关接受连接但**永不返回响应头**时（典型的半开连接、被上游挂起），用户配的
 * `requestTimeoutMs` 完全不起作用 —— 请求会一直挂着，直到宿主自己放弃。
 *
 * ## 语义
 *
 * - 超时抛 `LLM_REQUEST_TIMEOUT` —— 与 `runStream` 的整请求超时**同一个码**，
 *   宿主与界面看到的是同一类失败；
 * - **不取消底层操作**：这条路径上 `fetch` 不接受我们的 signal，超时只停止等待。
 *   与 `quotaWithTimeout` 同一取舍；底层 promise 挂了 `.catch` 兜住，不会变成
 *   unhandled rejection；
 * - `signal` 中止仍然优先（用户按停止立即生效）。
 * @param operation - 要执行的异步操作（会收到可透传给 `fetch` 的 signal）。
 * @param budget - 时间预算（只用 `requestTimeoutMs`）。
 * @param opts - 调用方取消信号与时钟注入点。
 * @returns 操作结果。
 */
export async function withRequestDeadline<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  budget: StreamBudget,
  opts: RunStreamOptions = {},
): Promise<T> {
  const callerSignal = opts.signal;
  if (callerSignal?.aborted === true) {
    throw callerSignal.reason === undefined
      ? new LlmError("the caller aborted the request", ABORTED)
      : new LlmError("the caller aborted the request", ABORTED, { cause: callerSignal.reason });
  }
  let interrupt: (reason: Interruption) => void = () => {};
  const interrupted = new Promise<Interruption>((resolve) => {
    interrupt = resolve;
  });
  const onAbort = (): void => interrupt({ kind: "abort" });
  callerSignal?.addEventListener("abort", onAbort);
  /**
   * **超时也要真的取消底层请求**（2026-11-01 修 R03 第三版）。
   *
   * ## 上一版的问题
   *
   * 上一版把 `opts.signal` 原样传给 `operation` —— 那是**调用方**的信号，
   * 只在用户按停止时 abort。于是超时的语义是「我不等了」：
   *
   * ```
   * 30 秒到 → 界面报 LLM_REQUEST_TIMEOUT
   *        → 但 fetch 手里的 signal 从未 abort
   *        → 底层请求继续跑到自然结束（TCP 层可能要 2 分钟以上）
   * ```
   *
   * 更糟的是超时码**不在** `NEVER_RETRY_CODES` 里 —— 自动重试会再发一次，
   * 3 次重试就是 **3 条僵死连接同时在途**（实测复审确认 `signal.aborted` 仍为
   * false、`reader.cancel` 未被调用）。
   *
   * ## 现在的做法
   *
   * 建一个**自己的** controller，超时时 abort 它；再与调用方的信号合并成一个
   * `AbortSignal.any([...])` 传给底层。于是：
   *
   * - 超时 → 底层 `fetch` 收到 abort → socket 立即释放；
   * - 用户按停止 → 同样 abort（且理由优先，见下面的 `interrupt` 竞态）；
   * - 正常完成 → `finally` 里不 abort（那会把已完成的响应也标脏）。
   *
   * `AbortSignal.any` 需要 Node ≥20.3；本包 engines 要求 `>=22.19.0`，可用。
   */
  const timeoutController = new AbortController();
  /** 底层看到的信号：调用方取消 **或** 本函数超时，任一发生就 abort。 */
  const signal =
    callerSignal === undefined
      ? timeoutController.signal
      : AbortSignal.any([callerSignal, timeoutController.signal]);
  const timer = setTimeout(() => {
    // 先 abort（让底层立刻停止），再打断等待。
    timeoutController.abort(new LlmError(`the request did not finish within ${budget.requestTimeoutMs}ms`, LLM_REQUEST_TIMEOUT));
    interrupt({ kind: "request" });
  }, armDelay(budget.requestTimeoutMs));
  /**
   * 底层操作；超时后它**会**被 signal 取消，但取消是异步的（fetch 需要一拍）。
   * 仍然挂 `catch` 兜住 —— 否则 abort 导致的 rejection 可能变成 unhandled。
   */
  const running = operation(signal).then((value): { kind: "ok"; value: T } => ({ kind: "ok", value }));
  try {
    const outcome = await Promise.race([running, interrupted]);
    if (outcome.kind === "ok") return outcome.value;
    throw interruptionError(outcome.kind, budget, callerSignal);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
    void running.catch(() => {});
  }
}
