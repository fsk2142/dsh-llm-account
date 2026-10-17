/**
 * 切换控制器：把 `core/switching.ts` 的纯判定接到真实账号、额度与设置上。
 *
 * 职责边界（设计 §6.4）：
 * - **只在普通对话请求前**评估（title / compact 等不换号）；
 * - 手动顺序模式只在当前账号被拒/耗尽时切；额度优先模式按间隔评估；
 * - `switchAtTurnEnd` 为真时，先把决定记成 pending，等 `session/event` 的 `turn/end`
 *   之后的下一次请求再写选择 —— 任务进行中不换号；
 * - 写选择走 `accounts.select()`（设置文档），再让轮换引擎记一条提示；
 * - 额度优先逐个读候选，读数有 TTL 缓存，单个读取失败只丢该候选，不拖垮整次评估。
 *
 * 控制器不抛错：任何失败都降级为「这次不切」，并把原因交给 `warn`（不能因为一次额度读取
 * 失败把用户的请求一起弄挂）。
 * @module dsh-llm-account/src/vendors/switching
 */
import type { AccountPort, QuotaPort, QuotaSnapshot } from "../core/adapter";
import {
  chooseSwitch,
  isDue,
  quotaExhausted,
  switchSettingsOf,
  type SwitchCandidate,
  type SwitchDecision,
  type SwitchRuntimeState,
} from "../core/switching";
import type { RotationAccess } from "./assembly";

/** 额度读数的复用窗口；到期后重新读（避免每个请求都打额度端点）。 */
export const QUOTA_CACHE_MS = 60_000;

/** 会话边界表的上限；超过后丢最早的一条（长时间运行的会话不会无限涨）。 */
const MAX_SESSIONS = 128;

/** 控制器依赖。 */
export interface SwitchingDeps {
  /** 账号端口：`list()` 的顺序就是轮换顺序，`select()` 写当前账号。 */
  accounts: Pick<AccountPort, "list" | "select">;
  /** 额度端口：`snapshot(ref)` 读指定账号。 */
  quota: QuotaPort;
  /** 轮换引擎访问器；控制器用它读拒绝表、记切换提示。 */
  rotation: RotationAccess;
  /** 当前设置文档（每次评估重新读，volatile 字段立即生效）。 */
  document: () => Record<string, unknown>;
  /** 只读当前账号；`null` 表示自动轮换（不主动切）。 */
  pinnedRef: () => string | null;
  /** 时钟（测试注入）。 */
  now?: () => number;
  /** 非致命失败的可读日志。 */
  warn?: (message: string) => void;
}

/** 一次请求前要传给控制器的信息。 */
export interface BeforeRequestInput {
  /** 会话 id：只有同一会话里才谈得上「回合末」。 */
  sessionId?: string;
  /** 宿主调用目的（`chat` / `title` / `compaction` 等）。 */
  purpose?: string;
}

/** 判断一个宿主事件是不是回合结束。 */
export function isTurnEndEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const record = event as Record<string, unknown>;
  const type = record.type;
  if (type === "turn/end" || type === "turn_end") return true;
  if (record.kind === "turn/end") return true;
  // 兼容 `{ event: { type: "turn/end" } }` 的包一层形状。
  return record.event !== undefined && isTurnEndEvent(record.event);
}

/** 可读的错误信息。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把 key 写进有上限的表；满了先丢最早插入的项。 */
function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (!map.has(key) && map.size >= MAX_SESSIONS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

/** 手动顺序里的下一个可用账号（当前之后，绕回开头）。 */
function nextInOrder(current: string, candidates: readonly SwitchCandidate[]): string | undefined {
  const at = candidates.findIndex((candidate) => candidate.ref === current);
  const rotated = at === -1 ? candidates : [...candidates.slice(at + 1), ...candidates.slice(0, at)];
  return rotated.find((candidate) => candidate.ref !== current && candidate.rejected !== true && !quotaExhausted(candidate.quota))?.ref;
}

/**
 * 账号切换控制器（每个厂商一份）。
 */
export class SwitchingController {
  readonly #deps: SwitchingDeps;
  readonly #now: () => number;
  readonly #warn: (message: string) => void;
  /** 上一次评估策略的时刻（进程内；重启后从 0 开始，等价于「立刻评估一次」）。 */
  #lastEvaluatedAt = 0;
  /** ref → 额度读数（带时刻，读时判 TTL）。 */
  readonly #quotaCache = new Map<string, { snapshot: QuotaSnapshot; at: number }>();
  /** session → 最近一次 turn/end 的时刻。 */
  readonly #turnEnds = new Map<string, number>();
  /** session → 最近一次普通请求的时刻。 */
  readonly #lastRequests = new Map<string, number>();
  /** 回合末要应用的切换决定。 */
  #pending: SwitchDecision | undefined;
  /** 防止并发请求同时评估（同一个插件只有一份控制器）。 */
  #busy = false;

  /**
   * @param deps - 账号、额度、轮换与设置来源。
   */
  constructor(deps: SwitchingDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? (() => Date.now());
    this.#warn = deps.warn ?? (() => {});
  }

  /**
   * 普通对话请求前调用。永远不抛。
   * @param input - 会话 id 与宿主调用目的。
   */
  async beforeRequest(input: BeforeRequestInput): Promise<void> {
    // 宿主只给辅助调用标 purpose（`compaction` / `session-title`）；普通对话不带该字段。
    if (input.purpose !== undefined) return;
    if (this.#busy) return;
    this.#busy = true;
    const now = this.#now();
    try {
      if (this.#pending !== undefined) {
        if (this.#atTurnBoundary(input)) {
          const pending = this.#pending;
          this.#pending = undefined;
          await this.#apply(pending);
        }
      } else {
        await this.#evaluate(input, now);
      }
    } catch (error) {
      this.#warn(`switching: ${messageOf(error)}`);
    } finally {
      this.#busy = false;
      if (input.sessionId !== undefined) remember(this.#lastRequests, input.sessionId, now);
    }
  }

  /**
   * 接收宿主会话事件；只有回合结束才改变门控状态。
   * @param sessionId - 会话 id。
   * @param event - 宿主事件（形状不可信）。
   */
  noteSessionEvent(sessionId: string | undefined, event: unknown): void {
    if (sessionId === undefined || !isTurnEndEvent(event)) return;
    remember(this.#turnEnds, sessionId, this.#now());
  }

  /**
   * 接收宿主 `session/event` 的原始参数（形状未文档化，做容错解析）：
   * 既支持 `(sessionId, event)`，也支持 `({ sessionId, event })`。
   * @param args - 宿主事件回调收到的参数。
   */
  noteHostEvent(...args: unknown[]): void {
    const [first, second] = args;
    if (typeof first === "string") {
      this.noteSessionEvent(first, second);
      return;
    }
    if (typeof first !== "object" || first === null) return;
    const record = first as Record<string, unknown>;
    // 实测 0.2.1-rc.2 的参数是 `(session, event)`：session 对象带 `id`，不是字符串。
    if (typeof record.id === "string" && second !== undefined) {
      this.noteSessionEvent(record.id, second);
      return;
    }
    // 兼容 `({ sessionId, event })` 的包一层形状。
    const session = record.sessionId ?? record.session;
    if (typeof session !== "string") return;
    this.noteSessionEvent(session, record.event ?? first);
  }

  /**
   * 现在是否允许「立即应用」：没有会话（单次调用）、会话还没发过请求、或
   * 上次请求之后收到过 turn/end。
   * @param input - 本次请求信息。
   * @returns 是否在回合边界上。
   */
  #atTurnBoundary(input: BeforeRequestInput): boolean {
    const session = input.sessionId;
    if (session === undefined) return true;
    const last = this.#lastRequests.get(session);
    if (last === undefined) return true;
    const end = this.#turnEnds.get(session);
    return end !== undefined && end > last;
  }

  /**
   * 页面运行态：倒计时与待切换。
   * @returns 当前策略、上次/下次评估与 pending。
   */
  snapshot(): SwitchRuntimeState {
    const settings = switchSettingsOf(this.#deps.document());
    const now = this.#now();
    const nextAt =
      settings.strategy === "best-quota" && settings.intervalMinutes > 0
        ? this.#lastEvaluatedAt > 0
          ? this.#lastEvaluatedAt + settings.intervalMinutes * 60_000
          : now
        : undefined;
    return {
      ...settings,
      evaluatedAt: this.#lastEvaluatedAt,
      ...(nextAt === undefined ? {} : { nextAt }),
      ...(this.#pending === undefined ? {} : { pending: { ...this.#pending } }),
    };
  }

  /**
   * 「立即切换」：有 pending 就先应用它；否则强制评估一次并立即应用（不等间隔、不等回合末）。
   * @returns 实际发生的切换；没有可切的目标时 `undefined`。
   */
  async switchNow(): Promise<SwitchDecision | undefined> {
    if (this.#busy) return undefined;
    this.#busy = true;
    try {
      if (this.#pending !== undefined) {
        const pending = this.#pending;
        this.#pending = undefined;
        await this.#apply(pending);
        return pending;
      }
      return await this.#evaluate(undefined, this.#now(), { force: true });
    } catch (error) {
      this.#warn(`switching: ${messageOf(error)}`);
      return undefined;
    } finally {
      this.#busy = false;
    }
  }

  /**
   * 到点就评估一次。
   * @param input - 本次请求信息；`undefined` 表示页面「立即切换」。
   * @param now - 当前时刻。
   * @param options - `force` 跳过 autoSwitch/间隔/回合末门控。
   * @returns 实际应用的切换；只记 pending 或没有目标时 `undefined`。
   */
  async #evaluate(
    input: BeforeRequestInput | undefined,
    now: number,
    options: { force?: boolean } = {},
  ): Promise<SwitchDecision | undefined> {
    const force = options.force === true;
    const document = this.#deps.document();
    // `autoSwitch: false` 停用自动换号；但用户点「立即切换」是手动动作，仍然生效。
    if (!force && document.autoSwitch === false) return undefined;
    const settings = switchSettingsOf(document);
    const current = this.#deps.pinnedRef();
    if (current === null) return undefined;

    const engine = this.#deps.rotation.current();
    const rejections = engine.rejections();
    const currentExhausted = rejections.has(current) || quotaExhausted(this.#freshQuota(current, now));

    // 手动顺序模式没有「按时间评估」：只等当前耗尽（force 时允许手动轮换到下一个）。
    if (!force && settings.strategy === "order" && !currentExhausted) return undefined;
    if (!force && !isDue(this.#lastEvaluatedAt, now, settings.intervalMinutes, currentExhausted)) return undefined;

    // 账号列表的顺序就是轮换顺序（含手动排序覆盖）。
    const views = (await this.#deps.accounts.list()).filter((view) => view.configured);
    const candidates: SwitchCandidate[] = [];
    for (const view of views) {
      let snapshot = this.#freshQuota(view.ref, now);
      // 只有额度优先模式需要为每个候选花一次读取；手动模式只用拒绝表。
      if (settings.strategy === "best-quota" && snapshot === undefined) {
        snapshot = await this.#readQuota(view.ref, now);
      }
      candidates.push({
        ref: view.ref,
        ...(snapshot === undefined ? {} : { quota: snapshot }),
        ...(rejections.has(view.ref) ? { rejected: true } : {}),
      });
    }
    this.#lastEvaluatedAt = now;

    // 当前账号可能不在 `views` 里（凭据没配好），额度优先时单独补读一次。
    let currentSnapshot = this.#freshQuota(current, now);
    if (settings.strategy === "best-quota" && currentSnapshot === undefined) {
      currentSnapshot = await this.#readQuota(current, now);
    }
    let decision: SwitchDecision | undefined;
    if (force && settings.strategy === "order" && !currentExhausted) {
      // 「立即切换」在手动顺序模式下就是：切到当前之后的第一个可用账号。
      const target = nextInOrder(current, candidates);
      decision = target === undefined ? undefined : { target, reason: "manual" };
    } else {
      decision = chooseSwitch({
        strategy: settings.strategy,
        candidates,
        current,
        ...(currentSnapshot === undefined ? {} : { currentQuota: currentSnapshot }),
        currentRejected: rejections.has(current),
        due: true,
      });
    }
    if (decision === undefined) return undefined;

    if (!force && settings.atTurnEnd && input !== undefined && !this.#atTurnBoundary(input)) {
      this.#pending = decision;
      return undefined;
    }
    await this.#apply(decision);
    return decision;
  }

  /**
   * 应用一个切换决定：写设置里的当前账号，再让引擎记提示。
   * @param decision - 目标与原因。
   */
  async #apply(decision: SwitchDecision): Promise<void> {
    if (this.#deps.pinnedRef() === decision.target) return;
    await this.#deps.accounts.select(decision.target);
    this.#deps.rotation.current().noteAutoSwitch(decision.target, decision.reason);
  }

  /**
   * 读缓存里的新鲜读数。
   * @param ref - 账号 ref。
   * @param now - 当前时刻。
   * @returns 未过期读数；没有或过期时 `undefined`。
   */
  #freshQuota(ref: string, now: number): QuotaSnapshot | undefined {
    const entry = this.#quotaCache.get(ref);
    if (entry === undefined) return undefined;
    return now - entry.at < QUOTA_CACHE_MS ? entry.snapshot : undefined;
  }

  /**
   * 读一个账号的额度并写缓存；失败只记日志，返回 `undefined`。
   * @param ref - 账号 ref。
   * @param now - 当前时刻。
   * @returns 读数或 `undefined`。
   */
  async #readQuota(ref: string, now: number): Promise<QuotaSnapshot | undefined> {
    try {
      const snapshot = await this.#deps.quota.snapshot(ref);
      this.#quotaCache.set(ref, { snapshot, at: now });
      return snapshot;
    } catch (error) {
      this.#warn(`switching: quota read for "${ref}" failed (${messageOf(error)})`);
      return undefined;
    }
  }
}
