import "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
//#region src/core/adapter.d.ts
/** 统一失败分类；厂商原始错误到本分类的映射表放在各自适配器里。 */
type FailureKind = "quota" | "rate-limit" | "invalid-credential" | "unavailable" | "server" | "network";
/** 一次拒绝：分类、可选的重置时刻（epoch 毫秒，仅当厂商给出时）、面向用户的说明。 */
interface Rejection {
  kind: FailureKind;
  resetAt?: number;
  message: string;
}
/**
 * 账号行的展示视图。身份键是凭据引用 ref，不是 key —— 两个账号共用同一个 key
 * 时状态也必须隔离。
 */
interface AccountView {
  /** 凭据引用名，账号的唯一身份键。 */
  ref: string;
  /** 用户可见名称。 */
  label: string;
  /** 背后是否已有可用密钥。 */
  configured: boolean;
  /** 是否为当前选中（固定）账号。 */
  active: boolean;
}
/** 按模型绑定账号：一个模型同一时间只属于一个账号。 */
interface ModelRule {
  models: string[];
  account: string;
}
/** 账号库状态：顺序、按模型规则、固定账号（`null` 表示自动轮换）。 */
interface AccountState {
  order: string[];
  rules: ModelRule[];
  pinned: string | null;
}
/**
 * 模型可见性的写入时机：改完就写（`immediate`），还是等底部保存条（`onSave`）。
 *
 * 住在能力声明旁边：它描述的是厂商端口的行为，不是某张卡片的实现细节。设置页的字段
 * 控件与容器都从这里取同一个联合，避免两处各写一份字面量后悄悄分叉。
 */
type ModelsWriteMode = "onSave" | "immediate";
/** 厂商能力声明；UI 依据它隐藏或置灰不可用控件。 */
interface VendorCapabilities {
  /** 是否支持调整账号顺序。 */
  reorder: boolean;
  /** 是否支持固定账号（透支时允许回落，窗口重置后恢复）。 */
  pin: boolean;
  /** 是否支持本机回环网页登录。 */
  browserLogin: boolean;
  /** 是否支持按模型绑定账号。 */
  modelAccountRules: boolean;
  /** 额度数据的原生形状：窗口集合（used/cap）或百分比。 */
  quotaShape: "windows" | "percent";
  /** 模型可见性的写入时机。 */
  modelVisibilityWrite: ModelsWriteMode;
  /** 额度耗尽时是否允许自动切换账号。 */
  automaticSwitch: boolean;
}
/** 账号库端口。未实现的可选方法由能力声明关闭，UI 对应控件隐藏。 */
interface AccountPort {
  list(): Promise<AccountView[]>;
  add(input: {
    label: string;
    key?: string;
  }): Promise<AccountView>;
  rename(ref: string, label: string): Promise<void>;
  replaceKey(ref: string, key: string): Promise<void>;
  remove(ref: string): Promise<void>;
  /** `null` 表示回到自动轮换。 */
  select(ref: string | null): Promise<void>;
  move?(ref: string, toIndex: number): Promise<void>;
  /**
   * 写一份**全局**顺序（`vendor:ref` 键；两家共享同一份数组）。
   * 每家只投影自己的账号；旧裸 ref 仍兼容。
   */
  setOrder?(order: readonly string[]): Promise<void>;
  setAutoSwitch?(value: boolean): Promise<void>;
}
/**
 * 凭据端口：按键的引用名解析、写入、移除密钥。
 * 密钥只经此端口进出，永不写入设置文档；空串或纯空白一律视为未配置。
 */
interface CredentialPort {
  /** 解析一次引用；每操作重新解析，不跨操作缓存。未配置返回 `undefined`。 */
  resolve(ref: string): Promise<string | undefined>;
  /** 写入非空密钥；空值必须拒绝（移除走 {@link CredentialPort.unset}）。 */
  set(ref: string, value: string): Promise<void>;
  /** 移除引用；移除不存在的引用是无操作。 */
  unset(ref: string): Promise<void>;
  /**
   * 一次查询一组引用的配置状态（`AccountView.configured` 的来源）。
   * 空值、纯空白与不存在的引用一律 `configured: false`；调用方按 ref 直接索引结果。
   * @param refs - 要查询的凭据引用名。
   * @returns ref 到配置状态的映射。
   */
  describe(refs: string[]): Promise<Record<string, {
    configured: boolean;
    writable?: boolean;
  }>>;
}
/**
 * 额度数字的单位。
 *
 * 目前只有美元一种：Command Code 的额度就是美元口径（旧插件把 `totalCredits` 与两个窗口的
 * `used`/`cap` 一律按 `$` 排版：`lib/client.js` 的 `formatMoney` 第 1516 行、窗口行 3647 行、
 * `/usage` 面板 7742-7743 行）。要加第二种单位，先在这里加成员、再让厂商端口产出它 ——
 * 界面只认这张表，`undefined` 表示厂商没给单位，就按裸数字显示。
 */
type QuotaUnit = "usd";
/**
 * 归一化后的额度窗口。除 `key` 外全部可选：字段不存在表示「未知」，
 * 绝不允许倒成 0。
 */
interface QuotaWindow {
  /** 窗口标识（厂商窗口名或归一化后的类别）。 */
  key: string;
  /** 已用量。 */
  used?: number;
  /** 上限。 */
  cap?: number;
  /** 已用百分比。 */
  percent?: number;
  /** 重置时刻（epoch 毫秒）。 */
  resetAt?: number;
  /**
   * `resetAt` 是**估算出来的**，不是厂商公布的事实。
   *
   * 2026-10-20：Command Code 的 `windowLimits` 只给 `used` 与 `cap`，**不给 `resetAt`**，
   * 于是 5 小时/周窗口的重置时间一直是空的。用户要求「没有提供就给出估算值」，估算依据是
   * 「第一次观测到 `used` 从 0 变正的时刻 + 窗口长度」（见 `core/usage/reset-estimate`）。
   *
   * 这个标记存在的唯一目的：**界面必须把估算值显示成「约」**，绝不能让它看起来像厂商数据
   * —— 一次估算很可能与真实重置差几分钟到几十分钟。
   */
  resetEstimated?: boolean;
  /** 是否已超出。 */
  exceeded?: boolean;
  /**
   * 数字的单位（厂商口径）。缺失表示厂商没给单位，界面按裸数字排版 —— 不替它挑一个。
   */
  unit?: QuotaUnit;
  /**
   * 厂商**明确**声明该窗口不设上限（Command Code 的 `windowLimits.limited: false` + 窗口为
   * `null`；线上实测就是这个形状）。
   *
   * 与「字段缺失」是两件事：缺失是「未知」（照旧什么都不画），这里是「没有上限」这个事实
   * ——UI 上要写成「不限」，否则看起来像丢了两个窗口。
   */
  unlimited?: boolean;
  /**
   * `used` 这个数字是**谁**给的。
   *
   * - 缺省 / `"vendor"`：厂商端点自己报的（权威）；
   * - `"local"`：**本机台账**算出来的（厂商不公布该窗口用量时，见 Open Design 的月度）。
   *
   * 为什么必须能区分：同一个窗口里的两个数可能来自两套账 —— 官方的「5 小时已用 $X」与
   * 本机的「这台机器本期折合 $Y」不是一回事（换一台机器、或别的工具用了同一个账号，
   * 官方数会更大）。界面上必须标出来，否则用户拿它跟厂商后台对账必然对不上。
   */
  usedSource?: "vendor" | "local";
}
/**
 * 订阅套餐（厂商报告了订阅时才有）。字段除 `id` 外全部可选：不存在就是「未知」，
 * 绝不替厂商补一个默认套餐。
 *
 * 为什么要带上额度与本期结束：套餐决定月度配给（Command Code 的套餐表：Go 10 / Pro 30
 * 或 80 / Max 150 / Ultra 300 美元每月），`credits.credits.monthlyCredits` 是**余额** ——
 * 两者相减才是本期的月度已用。旧插件与官方 CLI 的 `/usage` 都是这么算的
 * （`lib/client.js` 的 `monthlyView` 第 5722-5750 行、CLI 的 `getCreditDepletionPct`）。
 */
interface QuotaPlan {
  /** 套餐标识原文（如 `individual-goat`）。 */
  id: string;
  /** 展示名（厂商套餐表给的；表里没有这个标识时缺省，界面退回标识）。 */
  name?: string;
  /** 订阅状态原文（如 `active` / `canceled`）。 */
  status?: string;
  /** 该套餐每月的额度（美元口径）。 */
  monthlyCredits?: number;
  /** 本期结束时刻（epoch 毫秒）。 */
  periodEnd?: number;
  /**
   * 本期**开始**时刻（epoch 毫秒）。
   *
   * 厂商真的公布时才有（Open Design 的 `subscriptionCurrentPeriodStart`，2026-10-19 实测）。
   * 有它，统计的账期就是厂商的两个真实边界；没有则由 `periodEnd` 往前推一个日历月。
   */
  periodStart?: number;
}
/** 归一化后的额度读数；部分端点失败不拖垮整体，失败项列在 `failures` 里。 */
interface QuotaSnapshot {
  windows: QuotaWindow[];
  /** 套餐；厂商未报告订阅时缺省。 */
  plan?: QuotaPlan;
  /** 失败的端点或窗口名，供 UI 提示数据不完整。 */
  failures: string[];
}
/** 额度端口：读取归一化额度读数。 */
interface QuotaPort {
  /**
   * 读一次额度。
   * @param ref - 指定账号；缺省时读「当前选中账号」（页面/侧边栏的既有行为）。
   *   切换策略的额度优先模式用它逐个读候选账号，不需要临时改当前账号。
   * @returns 归一化读数。
   */
  snapshot(ref?: string): Promise<QuotaSnapshot>;
}
/** 一次登录尝试的状态。 */
interface LoginStatus {
  state: "idle" | "waiting" | "success" | "failed";
  /** 等待授权时可供用户打开的网址。 */
  authUrl?: string;
  /** 设备码流程要在浏览器里输入的代码（没有该流程时缺省）。 */
  userCode?: string;
  /** 这次等待的过期时刻（epoch 毫秒）。 */
  expiresAt?: number;
  /** 失败原因（稳定文案键，例如 `"timeout"`）。 */
  reason?: string;
  /**
   * 失败时的**外部命令诊断原文**（`vela` 的 stdout/stderr 片段）。
   *
   * 为什么要有：`reason` 是稳定键，界面只有一句「等待授权超时」，而这一句话背后至少有四种
   * 完全不同的病因（命令没启动 / 启动了但崩了 / 输出格式变了 / 用户没批准）。2026-10-20
   * 实测就卡在这里：用户手动跑 `vela login` 一切正常，插件里却只报超时，而**真实输出在
   * 那个分支里被直接丢弃了**，谁都无法继续排查。
   *
   * 只放外部命令的输出片段，**绝不包含密钥或登录产物内容**（那些在 `~/.amr/config.json`，
   * 本字段不从那里取任何东西）。
   */
  detail?: string;
}
/** 网页登录端口：仅声明了 `browserLogin` 能力的厂商提供。 */
interface LoginPort {
  /** 开始（或接续）一次尝试，返回其最新状态。 */
  begin(): Promise<LoginStatus>;
  /** 查询当前尝试状态。 */
  status(): Promise<LoginStatus>;
  /** 取消等待中的尝试；终态不受影响。 */
  cancel(): Promise<void>;
}
//#endregion
//#region src/core/recovery.d.ts
/**
 * 账号操作意图日志：先写意图、再提交，崩溃后重放（设计文档 §6.4.5、§12 Review Focus 5）。
 *
 * 账号操作（增删改、改密钥、选择、排序、自动切换）都是「设置 + 凭据」两处写入，
 * 中途崩溃会留下半成品。约定做法是**先记意图、再做提交、成功后 `settle`**：崩溃后
 * 重启时 `replay` 把未决意图逐条交给调用方的 `apply`，按结果收尾 —— 冲突时重放，
 * 而不是盲目覆盖。
 *
 * 本模块是纯核心逻辑：不导入任何宿主包、不注册定时器、不写日志输出，只依赖注入的
 * `IntentStore` 端口。日志的**真源永远在存储里**：每个方法都重新 `read`，不缓存，
 * 不会拿陈旧的内存副本去覆盖存储。
 *
 * **并发边界**：本实例的所有写路径（`append`、`settle`，以及 `replay` 每轮的落盘）都
 * 串行化在一条内部 promise 链上，「读全量 → 改全量 → 写全量」不会互相交叉，因此同一
 * 实例上的并发调用不会丢写。`IntentStore` 端口没有 CAS，这条链只覆盖**本实例**：调用
 * 方必须保证**一份存储只配一个 `IntentLog` 实例**；多实例、以及其它进程/宿主的写者
 * 仍可能整份覆盖（端口只有「一次写全量」，没有比对与合并的能力）。
 *
 * **顺序**：日志顺序就是 `append` 的插入顺序（即存储 `read` 返回的顺序），**不按
 * `createdAt` 排序** —— 回放必须按因果顺序（先 add 再 rename），墙钟顺序做不到这点。
 * 调用方负责按因果顺序 `append`。
 * @module dsh-llm-account/src/core/recovery
 */
/** 账号操作意图的分类。 */
type AccountIntentKind = "add" | "remove" | "rename" | "replace-key" | "select" | "move" | "auto-switch" |
/**
 * 把工作区写进某个账号的条目（2026-10-20）。
 *
 * 单独一种意图而不是复用 `rename`：两者改的是不同字段，恢复时各自重放；混在一起会让
 * 「改名」的幂等判断把工作区也带上，反之亦然。
 */
"set-workspace";
/**
 * 一条待提交的账号操作意图。字段按 `kind` 取用（与 `AccountPort` 的参数一一对应）：
 * `add`/`rename` 用 `label`，`remove`/`rename`/`replace-key`/`select`/`move` 用 `ref`，
 * `move` 用 `toIndex`，`auto-switch` 用 `value`，`set-workspace` 用 `workspaceId`。
 */
interface AccountIntent {
  /** 意图标识，同一份日志内唯一（`settle`/去重都按它定位）。 */
  id: string;
  /** 操作类型。 */
  kind: AccountIntentKind;
  /** 目标账号的 ref（ref 标识空间；`add` 时尚不存在，可缺省）。 */
  ref?: string;
  /** `add`/`rename` 的目标名称。 */
  label?: string;
  /** `move` 的目标下标。 */
  toIndex?: number;
  /** `auto-switch` 的目标开关值。 */
  value?: boolean;
  /** `set-workspace` 要写入的工作区 id（2026-10-20，逐账号存）。 */
  workspaceId?: string;
  /** 入队时刻（epoch 毫秒），仅供展示与排查，不参与排序。 */
  createdAt: number;
}
/**
 * 意图日志的持久化端口：一次读全量、一次写全量。
 *
 * 端口实现须把整份日志当作原子值（写成功后 `read` 必须返回刚写入的内容），
 * 失败必须抛错 —— 静默失败会让崩溃恢复丢掉已提交的操作。
 */
interface IntentStore {
  /** 读取当前全量日志（顺序即日志顺序）。 */
  read(): Promise<AccountIntent[]>;
  /** 覆盖写入全量日志。 */
  write(intents: AccountIntent[]): Promise<void>;
}
/**
 * 一次 `replay` 的结果。
 *
 * - `applied`：本轮回放中被 `apply` 判定为「已提交」的意图数（已从日志移除）。
 * - `rejected`：被 `apply` 判定为「已被拒绝/冲突」的意图数（同样已从日志移除，
 *   不会再次重放；它和 `applied` 的区别只在**语义归属**，不在是否落盘收尾）。
 * - `unknown`：`apply` 无法判定、仍留在日志里等待下次重放的意图数。同一个意图在
 *   一次 `replay` 调用里最多尝试一次，所以它不会因为多轮而被重复计数。
 * - `remaining`：本次 `replay` 返回时日志里还剩多少条（= `unknown` 加上回放期间
 *   新追加、尚未处理的意图；对未来得及进本轮快照的新意图也计入）。
 */
interface ReplayReport {
  applied: number;
  rejected: number;
  unknown: number;
  remaining: number;
}
/** `apply` 对单条意图的判定。 */
type ReplayOutcome = "applied" | "rejected" | "unknown";
/**
 * 意图日志。用法：提交前 `append`，提交成功后 `settle`，启动时 `replay`。
 *
 * 每个方法都是一次「读全量 → 改全量 → 写全量」的步骤；`append`、`settle` 与 `replay`
 * 里的落盘都排在本实例的内部串行链上（`list` 只读，不排队），所以并发调用不会把彼此的
 * 读改写撕开、丢写（见模块头的并发边界）。存储写失败一律向外抛。
 * `settle` 对不存在的 id 是无操作，连写都不发（避免无谓落盘，也避免让「清一条早已
 * 收尾的意图」因为存储抖动而失败）。
 */
declare class IntentLog {
  #private;
  /**
   * @param store - 注入的持久化端口；本类不关心它背后是设置、文件还是数据库。
   */
  constructor(store: IntentStore);
  /**
   * 追加一条意图并立即落盘。追加成功后才可以做真正的提交动作。
   * @param intent - 待记录的意图；入参会被复制，调用方后续改动无效。
   */
  append(intent: AccountIntent): Promise<void>;
  /**
   * 读取当前日志（按插入顺序）。
   * @returns 全新的数组与全新的意图对象：调用方怎么改都影响不到日志内部。
   */
  list(): Promise<AccountIntent[]>;
  /**
   * 收尾一条意图：提交成功后把它从日志里去掉，之后的 `replay` 不会再碰它。
   * 对不存在的 id 是无操作（不抛错、不落盘）。
   * @param id - 意图标识。
   */
  settle(id: string): Promise<void>;
  /**
   * 重放未决意图：把日志交给 `apply` 逐条判定，按结果收尾。
   *
   * 单次调用最多 4 轮；每轮取一次快照，只处理**本次调用里还没尝试过**的意图（`unknown`
   * 的意图不会在同一轮里被反复重试），随后把该轮判定为 `applied`/`rejected` 的意图从
   * **当场读到的最新日志**里删掉并落盘 —— 逐轮落盘，不在内存里攒到最后一次性写。
   * `unknown` 的意图原样留下，等下一次 `replay`；回放期间新追加的意图因此不会被清掉，
   * 但会进入下一轮（轮数上限即 4）。
   *
   * `apply` 与存储的错误都不吞：抛错直接冒泡，调用方据此判断本次回放没有完成。
   * @param apply - 对单条意图执行提交动作并给出判定；`applied` 与 `rejected` 都会从
   *   日志移除，`unknown` 保留待下次重放。会收到意图的副本。
   * @returns 本次回放的计数与剩余条数，见 `ReplayReport`。
   */
  replay(apply: (intent: AccountIntent) => Promise<ReplayOutcome>): Promise<ReplayReport>;
}
//#endregion
//#region src/core/switching/rotation.d.ts
/** 构造参数：账号库状态，加上可注入的时钟。 */
interface RotationConfig extends AccountState {
  /** 时钟注入点（epoch 毫秒），便于测试冷却与 `resetAt`；缺省为 `Date.now`。 */
  readonly now?: () => number;
}
/** 一次选号请求。`tried` 是本请求内已经试过的账号 ref。 */
interface PickRequest {
  model: string;
  tried: ReadonlySet<string>;
}
/** 是否允许切换账号的依据：请求已开始输出、已消耗 token、或调用方已中止。 */
interface FallbackContext {
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
interface EffectiveAccount {
  ref: string;
  at: number;
}
/**
 * 能被**指名**的切换原因（规格 §8.1 第 3 条列出的四种）。
 *
 * 刻意不包含 `unavailable`：它在失败分类里存在，但规格没有给它文案，硬塞进
 * `quota` 之类的桶里就是编造原因 —— 指不出原因的变化只更新生效账号、不产出提示。
 */
type SwitchReason = "quota" | "rate-limit" | "invalid-credential" | "manual" | "balance" | "scheduled";
/** 一次切换提示：谁 → 谁、原因、时刻。 */
interface SwitchNotice {
  fromRef: string;
  toRef: string;
  reason: SwitchReason;
  at: number;
}
/**
 * 账号轮换与拒绝记忆。
 *
 * 构造时**复制** `order` 与 `rules`，之后不再读调用方的对象：账号库后续变更
 * （`reorder`/`assignModelRule`/`dropAccount` 都返回新对象）应由调用方新建引擎或
 * 传入新状态，引擎不会静默跟随。
 */
declare class RotationEngine {
  #private;
  /**
   * @param config - 账号库状态（顺序、固定账号、按模型规则）与可选时钟。
   */
  constructor(config: RotationConfig);
  /**
   * 选下一个账号：规则命中 → 固定 → 顺序里第一个未被拒绝且不在 `tried` 中的账号。
   *
   * 任一候选不可用都**继续往下走**，不会因为规则或固定账号不可用就直接放弃。
   * 顺带惰性清理已过期的拒绝条目。
   *
   * 命中时顺带把该 ref 记为**生效账号**（见 `noteSelected`）：选择次序、拒绝表与
   * `fallbackAllowed` 的既有语义一律不动，这里只是把「这次真的是谁去发请求」记下来。
   * @param request - 目标模型与本请求内已试过的账号。
   * @returns 选中的账号 ref；无可选账号时为 `undefined`（此时不动生效账号）。
   */
  pick({ model, tried }: PickRequest): string | undefined;
  /**
   * 上报「这个 ref 被选中去发请求了」，把它记成生效账号，并在**上一次生效账号能被
   * 指名**（额度耗尽 / 限流 / 凭据失效）时记一条切换提示。
   *
   * `pick` 命中时会自动调用；调用方用别的方式选号（宿主重放、显式指定）时自己调用。
   * 对同一个 ref 重复上报是恒等变换，不会产生第二条提示。
   * @param ref - 本次要去发请求的账号 ref。
   */
  noteSelected(ref: string): void;
  /**
   * 上报「这个 ref 成功完成了请求」，把生效账号修正为**最近成功者**
   * （规格 §8.1 第 1 条的后半段）。成功不是一次「切换」，因此不产出切换提示。
   * @param ref - 真正把请求服务完的账号 ref。
   */
  noteSettled(ref: string): void;
  /**
   * 用户手动把生效账号切到 ref：原因固定为 `manual`，时间取当前时刻。
   *
   * 不触碰拒绝表 —— 手动换号是用户的选择，不改变被换下那个账号的额度/凭据状态。
   * @param ref - 用户选定的账号 ref。
   */
  noteManualSwitch(ref: string): void;
  /**
   * 切换策略（手动顺序/额度优先）主动换号：原因由调用方给定，时间取当前时刻。
   *
   * 不触碰拒绝表 —— 主动换号不是「这个账号被拒了」；拒绝表只由真实失败写入。
   * @param ref - 目标账号 ref。
   * @param reason - 切换原因（`quota` 或 `balance`）。
   */
  noteAutoSwitch(ref: string, reason: SwitchReason): void;
  /**
   * 当前的生效账号（副本）。
   * @returns 最近一次被选中/成功的 ref 与时刻；还没有请求时为 `undefined`。
   */
  effectiveAccount(): EffectiveAccount | undefined;
  /**
   * 最近一次切换提示（副本）。
   * @returns 最近一条切换记录；从未切换过时为 `undefined`。
   */
  switchNotice(): SwitchNotice | undefined;
  /**
   * 切换记录，最新在前（副本；Task 3 的 `switches()` 发布它）。
   * @returns 切换记录数组，最多 `MAX_SWITCH_NOTICES` 条。
   */
  switchNotices(): readonly SwitchNotice[];
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
  adoptObservations(source: RotationEngine): void;
  /**
   * 记录一次账号级失败，让该账号退出轮换。同一 ref 的新记录覆盖旧记录。
   *
   * `server`/`network` 是瞬时失败：直接返回，**既不入表也不清除**已有条目 ——
   * 一次服务端错误说明不了额度状态，把好账号踢出轮换的代价远大于多试一次。
   * @param ref - 被拒绝的账号 ref。
   * @param value - 失败分类、可选重置时刻与说明。
   */
  markRejected(ref: string, value: Rejection): void;
  /**
   * 凭据更新后清除该账号的 `invalid-credential` 标记；对其它分类无效果
   * （换 key 不影响额度与冷却），对不存在或已被清除的 ref 是恒等变换。
   * @param ref - 换了密钥的账号 ref。
   */
  clearCredentialRejection(ref: string): void;
  /**
   * 当前仍然生效的拒绝表快照（已过期条目在读取时被清掉）。
   * 返回的是新 Map：调用方改不动引擎内部状态。
   * @returns ref 到拒绝记录的只读映射。
   */
  rejections(): ReadonlyMap<string, Rejection>;
  /**
   * 请求是否还允许切换账号（设计文档 §6.4.2）。只要已开始输出、已消耗 token 或
   * 调用方已中止，就必须把失败原样抛给调用方，不能偷偷换账号重放。
   * @param context - 本次尝试的进度。
   * @returns 允许切换为 `true`。
   */
  fallbackAllowed({ emitted, totalTokens, aborted }: FallbackContext): boolean;
}
//#endregion
//#region src/vendors/assembly.d.ts
/**
 * 插件 `Config` 的导出类型：宿主加载器对它的**最小**要求。
 *
 * 两个理由不写 schemastery 的推断类型：① schemastery 只默认导出一个值，节点类型没有可命名
 * 的出口；② 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用
 * （TS2883：`.pnpm` 里的传递依赖不能出现在声明文件里）。这里只声明加载器真正用到的两件事：
 * 可调用（解析这一行的配置）与可序列化（`"toJSON" in schema` 的判定，见 dsh-settings 的
 * `SettingsForms.schema()`）；volatile 记号与节点树由运行时的真 schema 对象提供。
 */
interface PluginConfigSchema {
  /** 解析一份配置（原始缺省时用 schema 默认值）。 */
  (data?: Record<string, unknown>): unknown;
  /** 序列化 schema（宿主的设置表单据此投影 volatile 节点）。 */
  toJSON(): unknown;
}
/**
 * 轮换引擎的读取口。
 *
 * 适配器与额度端口都按请求现取引擎，所以账号库状态（顺序/固定/规则）一变就换一台新引擎，
 * 并把**仍然生效的拒绝记录**以及**观测状态（生效账号与切换记录）**搬到新引擎上：换引擎不能
 * 把「这个账号刚被拒绝」或「刚才是谁在服务」弄丢。
 */
interface RotationAccess {
  /** 当前账号库状态对应的引擎（状态变了就顺带重建）。 */
  current(): RotationEngine;
  /**
   * 凭据更新后清除该账号的 `invalid-credential` 标记。
   * @param ref - 换了密钥的账号 ref。
   */
  clearCredentialRejection(ref: string): void;
}
//#endregion
export { AccountView as a, QuotaPort as c, AccountPort as i, VendorCapabilities as l, RotationAccess as n, CredentialPort as o, IntentLog as r, LoginPort as s, PluginConfigSchema as t };