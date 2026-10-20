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
    const off = ctx.on("agent/request-error", async (payload: unknown) => {
      const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const turn = typeof record.turn === "number" ? record.turn : 0;
      const failure =
        typeof record.failure === "object" && record.failure !== null
          ? (record.failure as Record<string, unknown>)
          : {};
      const code = typeof failure.code === "string" ? failure.code : undefined;
      if (!shouldRetryFailure(settings, code, attemptsOf(turn))) {
        // 交给宿主：不返回 retry，它会按终态处理。
        return undefined;
      }
      bump(turn);
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
