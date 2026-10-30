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
 * **关掉即静默**：开关关着时监听器虽然注册，但事件进来立刻交棒给下游（不重试、不续写），\n * 与「不注册」等价；只有 `probe` 那条路在缺少宿主探针时才不注册。
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
 * 等一会儿（不阻塞事件循环），**可被 abort 提前打断**。
 *
 * 2026-10-30 加信号支持：原来只 `setTimeout`，用户在这段等待里按停止也不会生效 ——
 * 定时器照常走完，然后照样返回 `{ kind: "retry" }`，等于否认了用户的取消意图。
 *
 * 被取消时**不抛错**，而是正常 resolve 并让调用方检查 `signal.aborted` —— 抛
 * `AbortError` 会把「用户取消」伪装成一次失败，污染上层的失败分类。
 * @param ms - 毫秒。
 * @param signal - 可选取消信号。
 * @returns 到点或被取消后 resolve 的 Promise。
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    /** 取消时清掉定时器，立刻放行（**不抛错**）。 */
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 注册自动继续的两个事件。
 *
 * `settings` 是**读取函数**而不是值快照（2026-10-30 修）。
 *
 * 原来是值快照，而 `loader/volatile-update`（用户改设置）**不会重跑 apply** ——
 * 于是「关→开」时监听器从未注册、「开→关」时旧处理器按旧快照照跑、改次数/间隔也不
 * 生效，全都要重载宿主。同文件的其他配置（`autoSwitchModel` / `maxTried`）都是
 * getter，只有这里传了快照，是遗漏。
 *
 * 现在两个监听器**总是注册**，每次事件现读设置：
 * - 开关关着 → 直接交棒（不重试），与「不注册」等价；
 * - 开关开着 → 按当前次数与间隔判断。
 * 这样 `enabled` 的语义从「装不装监听器」变成「事件时判不判」，行为可预期、可热改。
 * @param ctx - 宿主 context（只用 `on`）。
 * @param settings - **读取**当前开关与上限的函数。
 * @param probe - 截断路径所需的最小宿主探针（缺省则不启用续写）。
 * @returns 注销函数（把注册的事件都摘掉）。
 */
export function applyAutoContinue(
  ctx: AutoContinueHost,
  settings: () => AutoContinueSettings,
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

  {    /**
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
      /**
       * 取消信号（2026-10-30 起真正使用）。
       *
       * 宿主把被取消那次请求的信号放在 payload 上；拿不到就当没有。
       * 用户在等待期间按停止 → `delay` 立刻放行 → 下面的 `aborted` 检查拒绝返回
       * `retry`，把决定权交回下游。**这是用户意图优先于「多试一次」的地方。**
       */
      const signal = record.signal instanceof AbortSignal ? record.signal : undefined;
      const current = settings();
      const attempts = attemptsOf(turn);
      if (!shouldRetryFailure(current, code, attempts)) {
        // 不归我们重试：**必须交棒**，否则会截断宿主自己的重试链。
        return await handOff();
      }
      bump(turn);
      /**
       * **按配置的间隔等待再重试**。
       *
       * 宿主收到 `{ kind: "retry" }` 就立刻 `continue` —— **它自己不做任何等待**
       * （实测 `dsh-agent-loop` 里没有 backoff / setTimeout）。所以网络抖动时重试会
       * 在几百毫秒内连着打好几次（台账实测有 0.1 秒的相邻失败），反而可能加剧拥塞。
       *
       * 缺省 2 秒、**固定间隔**而不是递增退避：均匀间隔对「网络刚恢复」这类场景更稳，
       * 也避免第一次重试来得太急。等待用 `setTimeout` + Promise，不阻塞事件循环。
       *
       * 等待**响应取消**：用户在等待期间按停止时定时器立刻清掉、放行，然后由下面
       * 的 `aborted` 检查拒绝重试。原来这里不理会信号，等于把用户的停止意图拖后
       * 一整段间隔，还可能返回一个与当前信号矛盾的 `retry`。
       */
      await delay(current.intervalMs, signal);
      if (signal?.aborted === true) {
        // 用户在我们等待期间取消了：不重试，交棒给下游（它会看到同一个已取消的信号）。
        return await handOff();
      }
      return { kind: "retry" };
    });
    if (typeof off === "function") disposers.push(off as () => void);
  }

  if (probe !== undefined) {
    const off = ctx.on("agent/turn-stopping", async (payload: unknown) => {
      const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const turn = typeof record.turn === "number" ? record.turn : 0;
      const reason = probe.lastFinishReason?.();
      const current = settings();
      if (!shouldContinueOnTruncate(current, reason, attemptsOf(turn))) return undefined;
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
