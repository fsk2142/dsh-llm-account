/**
 * 自动继续的**宿主接线**：把 `core/switching/auto-continue` 的判定接到宿主的两个接缝上。
 *
 * 宿主签名（读自 `dsh-agent-loop/lib/index.js`，不是照 README 猜的）：
 *
 * 1. `agent/request-error` 是 **waterfall**：
 *    ```js
 *    const action = await this.dispatch.waterfall("agent/request-error",
 *      { turn, step, provider, failure, retryPolicy, signal },
 *      () => Promise.resolve(undefined));
 *    if (action?.kind !== "retry") throw new LlmError(...);
 *    continue;   // ← 重试
 *    ```
 *    所以「返回 `{ kind: "retry" }`」就是重试；返回 `undefined` 交给宿主当终态。
 *
 * 2. `agent/turn-stopping` 是 **serial**，payload `{ turn, signal }`，在本轮即将结束前调用：
 *    ```js
 *    if (turnEnds && this.inbox.nextStep.length === 0) await dispatch.serial("agent/turn-stopping", ...);
 *    if (turnEnds && this.inbox.nextStep.length === 0) break;   // ← 仍然为空才真的结束
 *    ```
 *    所以「往 `inbox.nextStep` 推一条消息」就能让本轮继续。
 *
 * **关掉即静默**：两个开关都不开时本模块不注册任何事件（与项目里其它后台能力的纪律一致）。
 * @module dsh-llm-account/src/vendors/auto-continue
 */
import {
  shouldContinueOnTruncate,
  shouldRetryFailure,
  type AutoContinueSettings,
} from "../core/switching/auto-continue";

/** 宿主 context 里本模块用到的最小形状（不绑定具体 cordis 类型）。 */
export interface AutoContinueHost {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

/** 可选的宿主探针：用于「截断」这条路径，缺省时行为保守（不续写）。 */
export interface AutoContinueProbe {
  /** 往当前轮次的 `inbox.nextStep` 追加一条消息，让本轮不结束。 */
  inbox: { append(message: unknown): unknown };
  /**
   * 最近一次的结束原因（`"length"` 表示被输出上限截断）。
   *
   * 为什么由调用方提供而不是本模块去读：结束原因在 `assistant/message` 的
   * `finish.reason` 里，而订阅会话事件属于装配层的事。缺省返回 `undefined`，
   * 于是「截断续写」这条路径**默认不触发** —— 宁可什么都不做，也不要误续写。
   */
  lastFinishReason?: () => string | undefined;
}

/** 续写时发给模型的用户消息（用户可读，也是模型能理解的指令）。 */
export const CONTINUE_PROMPT = "继续";

/**
 * 每次重试前的固定等待（毫秒）。
 *
 * 为什么需要：宿主收到 `{ kind: "retry" }` 后**立即** `continue`，中间没有任何等待
 * （实测 `dsh-agent-loop` 无 backoff）。网络抖动时会在几百毫秒内连打数次 ——
 * 台账实测有 0.1 秒的相邻失败，那反而可能加剧拥塞。
 *
 * **固定 2 秒**（2026-10-29 按需求改）：原来是 0.5s / 1s / 2s 的递增退避，
 * 用户要求「每次错误重试中间间隔要 2s」—— 均匀间隔对「网络刚恢复」这类场景更稳，
 * 也不会让第一次重试来得太急。
 */
const RETRY_INTERVAL_MS = 2000;

/**
 * 等一会儿（不阻塞事件循环）。
 * @param ms - 毫秒。
 * @returns 到点后 resolve 的 Promise。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 注册自动继续的两个事件。
 * @param ctx - 宿主 context（只用 `on`）。
 * @param settings - 开关与次数上限。
 * @param probe - 截断路径所需的最小宿主探针（缺省则不启用续写）。
 * @returns 注销函数（把注册的事件都摘掉）。
 */
export function applyAutoContinue(
  ctx: AutoContinueHost,
  settings: AutoContinueSettings,
  probe?: AutoContinueProbe,
): () => void {
  const disposers: (() => void)[] = [];

  /** 每**轮次**的已自动继续次数：`turn` 变了就重新计数。 */
  const attemptsByTurn = new Map<number, number>();
  const attemptsOf = (turn: number): number => attemptsByTurn.get(turn) ?? 0;
  const bump = (turn: number): void => {
    attemptsByTurn.set(turn, attemptsOf(turn) + 1);
    // 只留最近几轮：这个表不该无限长（长会话里 turn 会一直涨）。
    if (attemptsByTurn.size > 32) {
      const oldest = [...attemptsByTurn.keys()].sort((left, right) => left - right)[0];
      if (oldest !== undefined) attemptsByTurn.delete(oldest);
    }
  };

  if (settings.onError) {
    /**
     * `agent/request-error` 是 **waterfall**，签名是 `(payload, next) => decision`。
     *
     * `cordis` 的实现（`EventsService.waterfall`）：
     *
     * ```js
     * const next = () => (cbs.shift() ?? inner)(...args);
     * return next();
     * ```
     *
     * 也就是说：**监听器不调用 `next()`，链路就在这里终止** —— 后面的监听器永远收不到
     * 这次失败。宿主自带的 `dsh-llm-retry` 也挂在这个事件上，它是个中间件
     * （`(payload, next) => recover(payload, next)`），靠 `next()` 交棒。
     *
     * 原来的写法是 `return undefined` 而不调 `next()`：如果我们排在 `llm-retry`
     * **前面**，宿主那条重试链就被我们吞掉了 —— 表现为「fetch failed 没有自动继续」。
     *
     * 现在两条出口都显式接力：不重试 → `next()`；重试 → 返回决策（终止链路，这是
     * waterfall 的正确用法）。
     */
    const off = ctx.on("agent/request-error", async (payload: unknown, next?: unknown) => {
      /** 调用下游；没有 `next`（旧宿主/假 ctx）时退化成 `undefined`。 */
      const handOff = async (): Promise<unknown> =>
        typeof next === "function" ? await (next as () => Promise<unknown>)() : undefined;

      const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const turn = typeof record.turn === "number" ? record.turn : 0;
      const failure =
        typeof record.failure === "object" && record.failure !== null
          ? (record.failure as Record<string, unknown>)
          : {};
      const code = typeof failure.code === "string" ? failure.code : undefined;
      const attempts = attemptsOf(turn);
      if (!shouldRetryFailure(settings, code, attempts)) {
        // 不归我们重试：**必须交棒**，否则会截断宿主自己的重试链。
        return await handOff();
      }
      bump(turn);
      /**
       * **固定等待 2 秒再重试**（2026-10-29 按需求改）。
       *
       * 宿主收到 `{ kind: "retry" }` 就立刻 `continue` —— **它自己不做任何等待**
       * （实测 `dsh-agent-loop` 里没有 backoff / setTimeout）。所以网络抖动时重试会
       * 在几百毫秒内连着打好几次（台账实测有 0.1 秒的相邻失败），反而可能加剧拥塞。
       *
       * 用户要求「每次错误重试中间间隔要 2s」，所以是**固定间隔**而不是递增退避：
       * 均匀间隔对「网络刚恢复」这类场景更稳，也避免第一次重试来得太急。
       * 等待用 `setTimeout` + Promise，不阻塞事件循环。
       *
       * **等待期间不响应取消信号**：用户按停止后最多还要等 2 秒，宿主在下一轮才感知
       * 到取消。这是有意的取舍 —— 给 `delay` 接 `AbortSignal` 要多传参数、多一条竞速
       * 路径，而 2 秒的延迟无害。
       */
      await delay(RETRY_INTERVAL_MS);
      return { kind: "retry" };
    });
    if (typeof off === "function") disposers.push(off as () => void);
  }

  if (settings.onTruncate && probe !== undefined) {
    const off = ctx.on("agent/turn-stopping", async (payload: unknown) => {
      const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const turn = typeof record.turn === "number" ? record.turn : 0;
      const reason = probe.lastFinishReason?.();
      if (!shouldContinueOnTruncate(settings, reason, attemptsOf(turn))) return undefined;
      bump(turn);
      // 推一条消息 → 宿主随后检查 `inbox.nextStep.length` 时不再为 0，本轮继续。
      probe.inbox.append({ role: "user", content: CONTINUE_PROMPT });
      return undefined;
    });
    if (typeof off === "function") disposers.push(off as () => void);
  }

  return () => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    attemptsByTurn.clear();
  };
}
