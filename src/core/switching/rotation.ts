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
import type { AccountState, FailureKind, ModelRule, Rejection } from "../adapter";
import type { TransientFailureKind } from "../failures";

/**
 * 单次请求内的尝试上限。**由调用方执行**（请求内核在 `tried.size` 达到该值时停止
 * 重试）：引擎不自行截断，因为 `tried` 可能含不属于本 `order` 的账号，引擎按大小
 * 截断会误判「没有可用账号」。
 */
export const MAX_TRIED = 16;

/** 没有明确重置时刻的账号级失败（rate-limit，以及无 `resetAt` 的 quota/unavailable）的冷却时长。 */
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
 * 生效账号：最近一次**真正被选中去发请求**的 ref，以及那一刻（epoch 毫秒）。
 *
 * 规格 §8.1 第 1 条把它定成一等概念，存在的理由是修掉旧卡片的缺陷：旧卡片显示
 * 「配置里固定的账号」，而多账号轮换是每次请求临时决定的，用量打满被自动切走后
 * 卡片数字不变。`at` 让界面能说明「这个结论是什么时候取的」。
 */
export interface EffectiveAccount {
  ref: string;
  at: number;
}

/**
 * 能被**指名**的切换原因（规格 §8.1 第 3 条列出的四种）。
 *
 * 刻意不包含 `unavailable`：它在失败分类里存在，但规格没有给它文案，硬塞进
 * `quota` 之类的桶里就是编造原因 —— 指不出原因的变化只更新生效账号、不产出提示。
 */
export type SwitchReason = "quota" | "rate-limit" | "invalid-credential" | "manual" | "balance" | "scheduled";

/** 一次切换提示：谁 → 谁、原因、时刻。 */
export interface SwitchNotice {
  fromRef: string;
  toRef: string;
  reason: SwitchReason;
  at: number;
}

/**
 * 切换记录的保留上限。引擎长驻宿主进程、每次失败换号都可能记一条，历史必须封顶；
 * 界面只需要最近若干条（Task 3 的 `switches()` 发布它）。
 */
export const MAX_SWITCH_NOTICES = 50;

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
    case "quota":
    case "unavailable":
      // 有重置时刻就用到点为止（429 常带一个有意义的窗口重置）；没有就退回冷却时长。
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
  /** 生效账号；`undefined` 表示本引擎实例还没有发过任何请求（不编造）。 */
  #effective: EffectiveAccount | undefined;
  /** 切换记录，**最新在前**（`switchNotice()` 的头部即最近一次）。 */
  #notices: SwitchNotice[] = [];

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
   * 选下一个账号：**用户选定的账号 → 规则命中 → 顺序里第一个未被拒绝的**。
   *
   * 任一候选不可用都**继续往下走**，不会因为规则或固定账号不可用就直接放弃。
   * 顺带惰性清理已过期的拒绝条目。
   *
   * 命中时顺带把该 ref 记为**生效账号**（见 `noteSelected`）：选择次序、拒绝表与
   * `fallbackAllowed` 的既有语义一律不动，这里只是把「这次真的是谁去发请求」记下来。
   *
   * ## 优先级（2026-10-22 定稿）
   *
   * **用户手动选定的账号（pinned）永远排第一**，只要它没被拒绝、没试过。
   *
   * 之前的口径是「模型绑定的账号优先于 pinned」—— 只有 pinned 恰好也在该模型的绑定
   * 列表里时才让 pinned 先。那个口径有实际后果：用户报「我选定了 A 账号，但请求走到了
   * B」，因为同一个模型被绑到两个账号时，绑定列表的顺序压过了用户的选择。
   *
   * 需求：「我选择使用其中的一个账号时，然后在会话中使用该网关的模型发送的时候
   * 应该就是使用我选定的那个账号的 API 发送请求」。**人的显式选择比规则表更权威。**
   *
   * 模型绑定因此只承担「这个模型能用哪些账号」的信息作用：pinned 不在绑定列表里时仍
   * 优先（用户明确指定了），从绑定列表挑不到就退回普通顺序。
   * @param request - 目标模型与本请求内已试过的账号。
   * @returns 选中的账号 ref；无可选账号时为 `undefined`（此时不动生效账号）。
   */
  pick({ model, tried }: PickRequest): string | undefined {
    const assigned = this.#rules.filter((entry) => entry.models.includes(model)).map((entry) => entry.account);
    const assignedInOrder = this.#order.filter((ref) => assigned.includes(ref));
    const assignedExtra = assigned.filter((ref) => !this.#order.includes(ref));
    /**
     * 候选顺序：**pinned 最前**，然后模型绑定的，最后普通顺序。
     *
     * pinned 为 `null`（自动轮换）时会被下面的过滤跳过，等价于没有它。
     */
    const candidates: readonly (string | null | undefined)[] = [
      this.#pinned,
      ...assignedInOrder,
      ...assignedExtra,
      ...this.#order,
    ];
    for (const ref of candidates) {
      if (ref === null || ref === undefined) continue;
      /**
       * **空串也要跳过**（2026-10-22 自查发现）。
       *
       * `pinned` 来自设置文档的顶层 `apiKeyEnv` —— 那个字段可能被手改坏，也可能是
       * 半截写入留下的空串。旧代码只挡 `null` / `undefined`，于是空串被当成合法 ref
       * 返回，一路带到适配器：
       *
       * - `#resolveKey("")` 必然返回 `undefined` → 被判成「没有可用密钥」；
       * - 于是 `markRejected("", invalid-credential)` —— 拒绝表里多一条**永不过期**的
       *   脏条目（该分类的过期时刻是 `undefined`），还会多记一条失败用量。
       *
       * 它不影响请求最终能不能发出去（循环会继续试真正的账号），但一直在污染拒绝表
       * 与台账 —— 属于「不报错但一直错」的那类。
       */
      if (ref.trim() === "") continue;
      if (tried.has(ref)) continue;
      /**
       * **不再看拒绝表**（2026-10-30 按用户要求改）。
       *
 * 用户诉求：「不要拒绝表，直接更换下一个，下一个不行的话继续下一个，有最大的
       * 测试上限就可以，比如我设置的 5 次，那么失败五次后直接停止」。
       *
       * 也就是说：**同一个请求内**按顺序把候选试一遍，试过的记进 `tried`、直到
       * `MAX_TRIED`；**跨请求不再记忆**上一次谁失败过。
       *
       * 为什么比原来的「拒绝表」好：
       *
       * - 拒绝表会把账号封死一段时间（`RATE_LIMIT_COOLDOWN_MS` = 5 分钟）。只有一个
       *   账号时，那等于「限额一次 → 5 分钟内完全不可用」，而额度可能几十秒后就恢复了。
       *   用户报的「触发限额后没有继续」就是这条链。
       * - 现在每次请求都真的去试，恢复即用；重复打上游的风险由 `MAX_TRIED` 与自动重试
       *   的退避兜住。
       *
       * 拒绝记录本身仍然保留（`markRejected` 照旧写入）：界面用它显示「这个账号为什么
       * 被跳过」的说明，`assembly` 也用它迁移状态。只是**选号时不拿它过滤**。
       */
      this.noteSelected(ref);
      return ref;
    }
    return undefined;
  }

  /**
   * 上报「这个 ref 被选中去发请求了」，把它记成生效账号，并在**上一次生效账号能被
   * 指名**（额度耗尽 / 限流 / 凭据失效）时记一条切换提示。
   *
   * `pick` 命中时会自动调用；调用方用别的方式选号（宿主重放、显式指定）时自己调用。
   * 对同一个 ref 重复上报是恒等变换，不会产生第二条提示。
   * @param ref - 本次要去发请求的账号 ref。
   */
  noteSelected(ref: string): void {
    const previous = this.#effective;
    const at = this.#now();
    this.#effective = { ref, at };
    if (previous === undefined || previous.ref === ref) return;
    const reason = this.#namedReason(previous.ref);
    // 指不出原因的换号（例如 unavailable）只更新生效账号：宁可没有提示，也不编造原因。
    if (reason === undefined) return;
    this.#record({ fromRef: previous.ref, toRef: ref, reason, at });
  }

  /**
   * 上报「这个 ref 成功完成了请求」，把生效账号修正为**最近成功者**
   * （规格 §8.1 第 1 条的后半段）。成功不是一次「切换」，因此不产出切换提示。
   * @param ref - 真正把请求服务完的账号 ref。
   */
  noteSettled(ref: string): void {
    this.#effective = { ref, at: this.#now() };
  }

  /**
   * 用户手动把生效账号切到 ref：原因固定为 `manual`，时间取当前时刻。
   *
   * 不触碰拒绝表 —— 手动换号是用户的选择，不改变被换下那个账号的额度/凭据状态。
   * @param ref - 用户选定的账号 ref。
   */
  noteManualSwitch(ref: string): void {
    const previous = this.#effective;
    const at = this.#now();
    this.#effective = { ref, at };
    if (previous === undefined || previous.ref === ref) return;
    this.#record({ fromRef: previous.ref, toRef: ref, reason: "manual", at });
  }

  /**
   * 切换策略（手动顺序/额度优先）主动换号：原因由调用方给定，时间取当前时刻。
   *
   * 不触碰拒绝表 —— 主动换号不是「这个账号被拒了」；拒绝表只由真实失败写入。
   * @param ref - 目标账号 ref。
   * @param reason - 切换原因（`quota` 或 `balance`）。
   */
  noteAutoSwitch(ref: string, reason: SwitchReason): void {
    const previous = this.#effective;
    const at = this.#now();
    this.#effective = { ref, at };
    if (previous === undefined || previous.ref === ref) return;
    this.#record({ fromRef: previous.ref, toRef: ref, reason, at });
  }

  /**
   * 当前的生效账号（副本）。
   * @returns 最近一次被选中/成功的 ref 与时刻；还没有请求时为 `undefined`。
   */
  effectiveAccount(): EffectiveAccount | undefined {
    return this.#effective === undefined ? undefined : { ...this.#effective };
  }

  /**
   * 最近一次切换提示（副本）。
   * @returns 最近一条切换记录；从未切换过时为 `undefined`。
   */
  switchNotice(): SwitchNotice | undefined {
    const latest = this.#notices[0];
    return latest === undefined ? undefined : { ...latest };
  }

  /**
   * 切换记录，最新在前（副本；Task 3 的 `switches()` 发布它）。
   * @returns 切换记录数组，最多 `MAX_SWITCH_NOTICES` 条。
   */
  switchNotices(): readonly SwitchNotice[] {
    return this.#notices.map((notice) => ({ ...notice }));
  }

  /**
   * 把另一台引擎的**观测状态**（生效账号与切换记录）搬到本引擎上。
   *
   * 引擎在账号库状态（顺序/固定/规则）变化时会被装配层**重建**；重建只搬拒绝记录是
   * 不够的 —— 那样用户一改账号设置，卡片就会突然显示「没有生效账号」，切换提示也归零。
   * 这是搬运而不是观察：不产生新的切换记录，也不改动拒绝表。
   *
   * 本引擎上已有的观测状态会被**覆盖**（调用方按「新引擎继承旧引擎」使用）。
   * @param source - 被替换掉的那台引擎。
   */
  adoptObservations(source: RotationEngine): void {
    const effective = source.effectiveAccount();
    this.#effective = effective === undefined ? undefined : { ...effective };
    // `switchNotices()` 已经是最新在前，取头部即保留最近的那些。
    this.#notices = source.switchNotices().slice(0, MAX_SWITCH_NOTICES).map((notice) => ({ ...notice }));
  }

  /**
   * 记录一次账号级失败。同一 ref 的新记录覆盖旧记录。
   *
   * `server`/`network` 是瞬时失败：直接返回，**既不入表也不清除**已有条目 ——
   * 一次服务端错误说明不了额度状态。
   *
   * **这张表不再参与选号**（2026-10-30）：`pick()` 只看 `tried`（同一请求内已试过的），
   * 跨请求不记忆失败。理由见 `pick()` 里的注释 —— 单账号场景下「拒绝即冷却 5 分钟」
   * 等于把唯一的选择封死，而额度可能几十秒后就恢复。
   *
   * 记录本身仍然保留，给两个地方用：
   * - 界面显示「这个账号为什么被跳过」；
   * - `assembly` 在引擎重建时迁移状态（`adoptObservations`）。
   *
   * 2026-10-29 曾在这里加过「只有一个账号时不入表」的特判；`pick()` 不看表之后它
   * 失去意义，已随本轮一并删除 —— 入表不再影响能否选中，只影响界面怎么描述。
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

  /**
   * 把一个 ref 被换下的原因翻译成**能指名**的切换原因。
   * @param ref - 被换下的账号 ref。
   * @returns 四种原因之一；拒绝表里没有它、或分类无法指名（`unavailable`/瞬时失败）时为 `undefined`。
   */
  #namedReason(ref: string): SwitchReason | undefined {
    const kind = this.#live(ref)?.kind;
    if (kind === "quota" || kind === "rate-limit" || kind === "invalid-credential") return kind;
    return undefined;
  }

  /**
   * 记一条切换提示（最新在前）并裁到上限。
   * @param notice - 要记录的切换。
   */
  #record(notice: SwitchNotice): void {
    this.#notices.unshift(notice);
    if (this.#notices.length > MAX_SWITCH_NOTICES) this.#notices.length = MAX_SWITCH_NOTICES;
  }
}
