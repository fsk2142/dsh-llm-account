/**
 * 轮换引擎：一次请求该用哪个账号，以及哪些失败让账号退出轮换。
 *
 * 决策顺序固定为「按模型规则命中 → 固定账号 → 顺序里第一个可用账号」，见
 * 设计文档 §9.1。本模块是纯逻辑：不做 I/O、不注册定时器、不持有外部资源；
 * 时间只经可注入的 `now` 读取，过期条目**惰性清理**（读取时判定，不留后台任务）。
 *
 * **账号标识**：所有 ref 参数都在 `accountRef()` 那套 ref 标识空间里，人类可读
 * 名称不参与比较。引擎只做比较，不生成 ref（生成在 Task 4 的 `accountRef()`）。
 * @module dsh-llm-account/src/core/rotation
 */
import type { AccountState, FailureKind, ModelRule, Rejection } from "./adapter";
import type { TransientFailureKind } from "./failures";

/**
 * 单次请求内的尝试上限。**由调用方执行**（请求内核在 `tried.size` 达到该值时停止
 * 重试）：引擎不自行截断，因为 `tried` 可能含不属于本 `order` 的账号，引擎按大小
 * 截断会误判「没有可用账号」。
 */
export const MAX_TRIED = 16;

/** 没有明确重置时刻的账号级失败（rate-limit，以及无 `resetAt` 的 quota/unavailable）的冷缺时长。 */
export const RATE_LIMIT_COOLDOWN_MS = 300_000;

/**
 * 瞬时失败分类：不写入拒绝表。一次网络抖动不该把好账号踢出轮换；同一请求内由
 * `tried` 防止立刻重选同一账号，是否重试交给宿主的重试策略。
 */
const TRANSIENT_KINDS: ReadonlySet<FailureKind> = new Set<TransientFailureKind>(["server", "network"]);

/** 拒绝表的一行：拒绝内容，以及它失效的时刻（`undefined` 表示只能被显式清除）。 */
interface RejectionEntry {
  rejection: Rejection;
  expiresAt: number | undefined;
}

/** 构造参数：账号库状态，加上可注入的时钟。 */
export interface RotationConfig extends AccountState {
  /** 时钟注入点（epoch 毫秒），便于测试冷却与 `resetAt`；缺省为 `Date.now`。 */
  readonly now?: () => number;
}

/** 一次选号请求。`tried` 是本请求内已经试过的账号 ref。 */
export interface PickRequest {
  model: string;
  tried: ReadonlySet<string>;
}

/** 是否允许切换账号的依据：请求已开始输出、已消耗 token、或调用方已中止。 */
export interface FallbackContext {
  emitted: boolean;
  totalTokens: number;
  aborted: boolean;
}

/**
 * 按分类算出拒绝条目的失效时刻。
 * @param kind - 失败分类。
 * @param resetAt - 厂商给出的重置时刻（epoch 毫秒），可能缺省。
 * @param now - 记录时刻（epoch 毫秒）。
 * @returns 失效时刻；`undefined` 表示不会自行过期。
 */
function rejectionExpiry(kind: FailureKind, resetAt: number | undefined, now: number): number | undefined {
  switch (kind) {
    case "invalid-credential":
      // 凭据本身失效，时间不会修复它：只有 clearCredentialRejection 能清除。
      return undefined;
    case "rate-limit":
      // 冷却固定 5 分钟（裁决：rate-limit 不看 resetAt）。
      return now + RATE_LIMIT_COOLDOWN_MS;
    case "quota":
    case "unavailable":
      // 有重置时刻就用到点为止；没有就退回冷却时长。
      return resetAt ?? now + RATE_LIMIT_COOLDOWN_MS;
    case "server":
    case "network":
      // 瞬时失败从不进拒绝表（markRejected 已提前返回），这里只为穷尽联合类型。
      return undefined;
  }
}

/**
 * 账号轮换与拒绝记忆。
 *
 * 构造时**复制** `order` 与 `rules`，之后不再读调用方的对象：账号库后续变更
 * （`reorder`/`assignModelRule`/`dropAccount` 都返回新对象）应由调用方新建引擎或
 * 传入新状态，引擎不会静默跟随。
 */
export class RotationEngine {
  readonly #order: readonly string[];
  readonly #pinned: string | null;
  readonly #rules: readonly ModelRule[];
  readonly #now: () => number;
  readonly #entries = new Map<string, RejectionEntry>();

  /**
   * @param config - 账号库状态（顺序、固定账号、按模型规则）与可选时钟。
   */
  constructor(config: RotationConfig) {
    this.#order = [...config.order];
    this.#pinned = config.pinned;
    this.#rules = config.rules.map((rule) => ({ models: [...rule.models], account: rule.account }));
    this.#now = config.now ?? (() => Date.now());
  }

  /**
   * 选下一个账号：规则命中 → 固定 → 顺序里第一个未被拒绝且不在 `tried` 中的账号。
   *
   * 任一候选不可用都**继续往下走**，不会因为规则或固定账号不可用就直接放弃。
   * 顺带惰性清理已过期的拒绝条目。
   * @param request - 目标模型与本请求内已试过的账号。
   * @returns 选中的账号 ref；无可选账号时为 `undefined`。
   */
  pick({ model, tried }: PickRequest): string | undefined {
    const rule = this.#rules.find((entry) => entry.models.includes(model));
    const candidates: readonly (string | null | undefined)[] = [rule?.account, this.#pinned, ...this.#order];
    for (const ref of candidates) {
      if (ref === null || ref === undefined) continue;
      if (tried.has(ref)) continue;
      if (this.#live(ref) !== undefined) continue;
      return ref;
    }
    return undefined;
  }

  /**
   * 记录一次账号级失败，让该账号退出轮换。同一 ref 的新记录覆盖旧记录。
   *
   * `server`/`network` 是瞬时失败：直接返回，**既不入表也不清除**已有条目 ——
   * 一次服务端错误说明不了额度状态，把好账号踢出轮换的代价远大于多试一次。
   * @param ref - 被拒绝的账号 ref。
   * @param value - 失败分类、可选重置时刻与说明。
   */
  markRejected(ref: string, value: Rejection): void {
    if (TRANSIENT_KINDS.has(value.kind)) return;
    this.#entries.set(ref, {
      rejection: { ...value },
      expiresAt: rejectionExpiry(value.kind, value.resetAt, this.#now()),
    });
  }

  /**
   * 凭据更新后清除该账号的 `invalid-credential` 标记；对其它分类无效果
   * （换 key 不影响额度与冷却），对不存在或已被清除的 ref 是恒等变换。
   * @param ref - 换了密钥的账号 ref。
   */
  clearCredentialRejection(ref: string): void {
    if (this.#entries.get(ref)?.rejection.kind === "invalid-credential") this.#entries.delete(ref);
  }

  /**
   * 当前仍然生效的拒绝表快照（已过期条目在读取时被清掉）。
   * 返回的是新 Map：调用方改不动引擎内部状态。
   * @returns ref 到拒绝记录的只读映射。
   */
  rejections(): ReadonlyMap<string, Rejection> {
    const live = new Map<string, Rejection>();
    for (const ref of [...this.#entries.keys()]) {
      const found = this.#live(ref);
      if (found !== undefined) live.set(ref, found);
    }
    return live;
  }

  /**
   * 请求是否还允许切换账号（设计文档 §6.4.2）。只要已开始输出、已消耗 token 或
   * 调用方已中止，就必须把失败原样抛给调用方，不能偷偷换账号重放。
   * @param context - 本次尝试的进度。
   * @returns 允许切换为 `true`。
   */
  fallbackAllowed({ emitted, totalTokens, aborted }: FallbackContext): boolean {
    return !emitted && !aborted && totalTokens <= 0;
  }

  /**
   * 读取仍然生效的拒绝；已过期则顺手删掉（惰性清理，无定时器）。
   * @param ref - 账号 ref。
   * @returns 生效中的拒绝记录；没有或已过期时为 `undefined`。
   */
  #live(ref: string): Rejection | undefined {
    const entry = this.#entries.get(ref);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== undefined && this.#now() >= entry.expiresAt) {
      this.#entries.delete(ref);
      return undefined;
    }
    return entry.rejection;
  }
}
