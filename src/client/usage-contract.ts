/**
 * 「账号中心」远程面的**线上契约**：包名、命名空间、三个方法与强类型描述符。
 *
 * 为什么单独一个模块：同一份契约要被**两侧**使用 ——
 * - 宿主侧（`src/vendors/usage-remote.ts`）把它登记给 `ctx.typert`（`invocations`）；
 * - 客户端侧（`src/client/seams.ts`）把它 `$mount` 给 `ctx.remote`（`descriptors`），
 *   拿回命名空间对象再调用。
 *
 * 客户端**绝不能**导入 `src/vendors/**`（那一侧会拉进宿主与 SDK 依赖，浏览器产物会因此带上
 * `node:` 内置）。所以这份契约刻意放在 `src/client/` 下、**只含纯数据与纯函数**：不 import 任何
 * 宿主包、不读环境、不持有状态。两侧各按自己的方式用它。
 *
 * 形状证据（逐字取自本机已装的 `@mars-sea/dsh-commandcode-provider`）：
 * - 宿主面登记：`lib/index.js:8965-8976`（`typert.register({ package, face: "host", invocations })`）；
 * - 客户端面挂载：`lib/client.js:8900-8939`（`ctx.remote.$mount({ package, descriptors })`，
 *   成功后再 `ctx.inject(["remote.<namespace>"], …)` 取 `remoteCtx.remote.<namespace>`）；
 * - 描述符字段：`lib/index.js:3221-3242`（`makeStrictCodec` / `makeRemoteDescriptor`）。
 *
 * **未验证接缝**：我们的命名空间是 `llm-account`，客户端侧的服务名预期是 `remote.llm-account`
 * （与旧插件 `remote.commandcode` / `remote.session` 同一形状），真机判定在计划 1c。
 * @module dsh-llm-account/src/client/usage-contract
 */
import type { AccountView, CatalogModelsResult, FailureKind, QuotaWindow, VendorCapabilities } from "../core/adapter";
import type { SwitchRuntimeState, SwitchSettingsWrite } from "../core/switching/settings";

// 客户端其它模块（页面、接缝）需要这几个形状时也从这里取，不必各自去 import `src/core/**`：
// 这个模块是客户端侧唯一允许提到 core 的地方，而且是**纯类型**导入（`verbatimModuleSyntax`
// 会把整个 import 语句擦掉，浏览器产物里不会出现 core 的任何运行时代码）。
export type {
  AccountView,
  CatalogModel,
  CatalogModelsResult,
  FailureKind,
  ModelRule,
  QuotaUnit,
  QuotaWindow,
  VendorCapabilities,
} from "../core/adapter";
export type { SwitchRuntimeState, SwitchSettingsWrite } from "../core/switching/settings";

import type { ModelRule } from "../core/adapter";

/** 贡献所属的 npm 包（描述符 id 的前缀）。 */
export const USAGE_PACKAGE = "dsh-llm-account";

/** 宿主侧 cordis 服务键；两个 profile 行共享同一个实例。 */
export const USAGE_SERVICE_KEY = "llmAccountUsage";

/** 线上命名空间：端点 = `<namespace>/<method>`，客户端侧服务名 = `remote.<namespace>`。 */
export const USAGE_NAMESPACE = "llm-account";

/** 三个方法名（两侧都要一致：描述符按名字派发到同名方法）。 */
export const USAGE_METHODS = [
  // 只读面（Task 3）
  "status",
  "accounts",
  "switches",
  // 磁盘上的已安装版本：判断页面里的客户端 bundle 是否已落后（2026-10-22）
  "installedVersion",
  // 设置页的模型勾选：未过滤的完整目录
  "models",
  // 账号操作（Task 5：账户卡片的 `⋯` 菜单与「添加账户」）
  "addAccount",
  "renameAccount",
  "restoreAccountName",
  "replaceKey",
  "removeAccount",
  "selectAccount",
  // 排序与自动切换（Task 6：只有声明了相应能力的厂商才实现）
  "moveAccount",
  "setAutoSwitch",
  // 切换策略：页面「立即切换」
  "switchNow",
  // 全局账户顺序（两家同一份）
  "setAccountOrder",
  // 全局切换策略（两家同一套）
  "setSwitchSettings",
  // 账户可用的模型（同一模型可属于多个账号）
  "setAccountModels",
  // 网页登录（Task 5：Command Code 的登录入口）
  "loginBegin",
  "loginStatus",
  "loginCancel",
  // 用量统计（跨厂商：每账号自身周期 + 总账）
  "usageReport",
  // 清空用量台账（用户显式操作，页面会先二次确认）
  "usageClear",
  // 导出用量台账为 CSV 文本
  "usageExportCsv",
  // 凭据状态（只回布尔，不回密钥）
  "credentialStatus",
  "setCredential",
  // 密钥实测（真的发一次最小请求，回答「能不能用」）
  "probeSearchCredential",
] as const;

/** 一个方法名。 */
export type UsageMethod = (typeof USAGE_METHODS)[number];

// —— 用量统计的传输类型（与 `core/usage-report` 同形，客户端可单独引用） ——

/** 用量窗口。 */
export type UsageWindowView = "today" | "7d" | "30d" | "all";

/** 一个聚合桶（与 `core/usage-stats` 的 `UsageBucket` 同形）。 */
export interface UsageBucketView {
  period: string;
  since: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  ok: number;
  failed: number;
  successRate?: number;
  cacheHitRate?: number;
  vendorCost?: number;
  officialCost?: number;
  /**
   * 上面的金额只是**部分**（有记录因为没有价格没被算进去）。
   *
   * 界面必须据此把金额标成「≈」或说明只统计了部分 —— 否则一个部分和会被当成完整花费
   * （2026-10-20 审计：价格表只覆盖少数模型，这一列几乎总是部分和）。
   */
  vendorCostPartial?: boolean;
  officialCostPartial?: boolean;
}

/** 一个账号的用量（与 `core/usage-report` 的 `AccountUsage` 同形）。 */
export interface AccountUsageView {
  vendor: string;
  account: string;
  period: { kind: string; key: string; start: number; end?: number; fromResetAt: boolean };
  bucket: UsageBucketView;
  windowed: UsageBucketView;
  /** 厂商自己公布的**本周期已消耗金额**（美元）；额度没读到或不是美元口径时缺失。 */
  spent?: number;
  /** 该金额来自哪个额度窗口。 */
  spentWindow?: string;
  /**
   * 本周期内**本机折合**花费（美元，按官方价折算我们自己记的 token）。
   *
   * 与 `spent` 是两套账：那个含所有客户端/机器，这个只有这台机器上本插件发出的请求。
   *
   * 界面把它和「官方价 ≈ $X」一起显示（中间用 ` · ` 连接）——「按什么价算」与「统计
   * 范围」是两个不同的问题，两个都要说。2026-10-23 之前它只在厂商不给数时顶替显示。
   */
  localSpent?: number;
  /** 本周期内**最近一次请求**的时刻（epoch 毫秒）；周期内没有记录时缺失。 */
  lastAt?: number;
}

/** 一份用量报表。 */
export interface UsageReportView {
  accounts: AccountUsageView[];
  total: {
    window: UsageWindowView;
    bucket: UsageBucketView;
    byVendor: { vendor: string; bucket: UsageBucketView }[];
    /** 窗口内最近一次请求的时刻；没有记录时缺失。 */
    lastAt?: number;
  };
  /**
   * **最近一次请求**是哪个账号（侧边栏「跟随当前会话」用）。
   *
   * 用户 2026-10-19：「根据该会话的模型所属账号显示当前账号信息，就不需要轮播」。
   * 宿主的 `remote.session` 没有「当前打开哪个会话」的接口，所以用「最近一次请求」代替
   * ——刚发过请求的那个会话几乎必然就是用户在看的那个（见 `core/last-used` 的说明）。
   * 没有可用记录时缺失（那就退回轮播）。
   */
  lastUsed?: { vendor: string; account: string; model: string; at: number };
  /**
   * 失败明细：这一期按分类（`FailureKind`）收成的几行。
   *
   * 台账早就在记 `failureKind`，但界面从没读过 —— 用户只看到「成功率 99.6%」，报障时无从
   * 判断是网络抖动、限额还是凭据失效。缺失时整块不渲染（**不是**给一条全 0 的行）。
   */
  failuresByKind?: { kind: string; count: number; lastAt: number; lastAccount: string }[];
  /**
   * 失败明细的**按账号**切法（界面真正使用的那一份）。
   *
   * 为什么需要它：用量块渲染在**每个账号**下面，而 `failuresByKind` 是窗口级的全局汇总 ——
   * 直接用它会让同厂商的所有账号都显示同一份明细（失败属于 A 却显示在 B 下面，
   * 2026-10-20 审计发现的真 bug）。没有失败的账号不出现在这个数组里。
   */
  failuresByAccount?: {
    vendor: string;
    account: string;
    rows: { kind: string; count: number; lastAt: number; lastAccount: string }[];
  }[];
}

/** 一次登录尝试的状态（与宿主侧 `LoginStatus` 同形；`reason` 是稳定文案键）。 */
export interface LoginStatus {
  state: "idle" | "waiting" | "success" | "failed";
  authUrl?: string;
  /** 设备码流程要在浏览器里输入的代码。 */
  userCode?: string;
  /** 等待的过期时刻（epoch 毫秒）。 */
  expiresAt?: number;
  reason?: string;
  /**
   * 失败时的**外部命令诊断原文**（`vela` 的 stdout/stderr 片段，已脱敏截断）。
   *
   * 界面上显示在失败原因下面：`reason` 只给一句稳定文案，这句才是真正的病因
   * （命令没启动 / 崩了 / 输出格式变了 / 没有任何输出）。
   */
  detail?: string;
}

/** 「添加账户」的输入。`key` 缺省表示先建条目、稍后补密钥。 */
export interface AddAccountInput {
  label: string;
  key?: string;
}

/** 本包托管的三条厂商路由（客户端只做参数校验，不认识厂商语义）。 */
export const VENDOR_IDS = ["commandcode", "dsh-opencode-go", "opendesign"] as const;

/** 订阅套餐（与宿主侧 `QuotaPlan` 同形；厂商没报订阅时整个字段缺省）。 */
export interface QuotaPlanSummary {
  id: string;
  name?: string;
  status?: string;
  monthlyCredits?: number;
  periodEnd?: number;
  /** 本期开始时刻（厂商公布时才有；统计的账期边界用它）。 */
  periodStart?: number;
}

/** 一条额度摘要。字段一律**原样**搬运：读数里没有的字段不许补 0。 */
export interface QuotaSummary {
  plan?: QuotaPlanSummary;
  windows: QuotaWindow[];
  failures: string[];
}

/** 账号行的展示状态（对齐宿主侧的返回；`pinned` 只在 `VendorUsageStatus` 上）。 */
export interface AccountUsageStatus extends AccountView {
  effective: boolean;
  rejection?: { kind: FailureKind; until?: number };
  quota?: QuotaSummary;
}

/** 切换原因（规格 §8.1 第 3 条列出的四种）。 */
export type SwitchReason = "quota" | "rate-limit" | "invalid-credential" | "manual" | "balance" | "scheduled";

/** 一次切换：谁 → 谁、原因、时刻（`status()` 发布的最近一条。**不带**厂商标签）。 */
export interface SwitchNotice {
  fromRef: string;
  toRef: string;
  reason: SwitchReason;
  at: number;
}

/** 一条切换记录：切换 + 厂商标签（`switches()` 一次只发布一家的）。 */
export interface SwitchRecord extends SwitchNotice {
  vendor: string;
}

/** 「立即切换」的结果。 */
export interface SwitchNowResult {
  switched: boolean;
  target?: string;
  reason?: SwitchReason;
}

/** 一个厂商的完整状态。 */
export interface VendorUsageStatus {
  vendor: string;
  /** 能力声明（规格 §7.3）：页面据此隐藏或置灰控件。**唯一来源在宿主侧**。 */
  capabilities: VendorCapabilities;
  pinned: string | null;
  /** 生效账号；从未发过请求时**没有**这个字段。 */
  effective?: { ref: string; at: number };
  /** 最近一次切换；从未切换过时**没有**这个字段。 */
  switch?: SwitchNotice;
  /** 切换策略运行态（倒计时/待切换）；老宿主没有这个字段。 */
  switchState?: SwitchRuntimeState;
  /** 全局顺序（`vendor:ref`；两家返回同一份）。 */
  accountOrder?: string[];
  /** 模型→账号分配规则；同一模型可以属于多个账号。 */
  modelRules?: ModelRule[];
  accounts: AccountUsageStatus[];
  failures: string[];
}

/** 一个强类型调用描述符（字段名取自 typert 协议的 `InvocationDescriptor`）。 */
export interface UsageInvocationDescriptor {
  id: string;
  service: string;
  namespace: string;
  method: UsageMethod;
  invocation: { kind: "direct" };
  parameters: readonly unknown[];
  result: { mode: "strict"; typeSymbol: string; create: () => { parse: (value: unknown) => unknown } };
}

/** 边界校验失败：说出是哪个端点、哪个字段。 */
function boundaryError(endpoint: string, detail: string): Error {
  return new Error(`${USAGE_PACKAGE}: ${endpoint} boundary violation: ${detail}`);
}

/**
 * 把一个边界值写进错误消息。
 *
 * **不能直接用 `JSON.stringify`**：它对 BigInt 抛 `TypeError`、对循环引用也抛 ——
 * 于是「报一个边界错误」这件事自己先崩了，调用方拿到的是一个跟边界毫无关系的
 * TypeError（主机与客户端同进程，线上值不一定是 JSON 能序列化的东西）。
 * @param value - 待描述的边界值。
 * @returns 一段安全的文本；序列化不了就退到类型名。
 */
function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** 判定「普通对象」。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验线上厂商 id。
 * @param value - 边界值。
 * @returns 合法的厂商 id。
 */
export function parseVendorId(value: unknown): string {
  if (typeof value === "string" && (VENDOR_IDS as readonly string[]).includes(value)) return value;
  throw boundaryError(`${USAGE_NAMESPACE}/vendor`, `expected a known vendor id, got ${describeValue(value)}`);
}

/**
 * 校验状态结果：结构 + **逐项洗 `quota`**。
 *
 * 为什么不能只查顶层（2026-10-20 复审发现）：页面用 `quota?.windows?.length` 判「有没有
 * 额度数据」—— 字符串也有 `length`，所以 `windows: "oops"` 会通过那个假值检查，紧接着
 * `.map` 抛错。虽然三处卡片都有 `RenderBoundary` 兜底（不会白屏），但那块面板会降级成
 * 「面板失败 + 重试」—— 一个坏字段换掉整个面板。
 *
 * 与 `parseCatalogModels` 同一条纪律：**边界上逐项清洗**，让下游可以信任形状。
 * `windows` / `failures` 不是数组时直接归空数组（而不是丢掉整行）：账号本身还有
 * `label` / `configured` 这些有用信息。
 * @param endpoint - 调用方端点名（错误消息要指名是哪条调用）。
 * @param value - 边界值。
 */
function parseVendorUsageStatus(endpoint: string, value: unknown): VendorUsageStatus {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw boundaryError(endpoint, "expected an object with an accounts array");
  }
  const accounts = value.accounts.map((account) => {
    if (!isRecord(account)) return account;
    const quota = account.quota;
    // `quota` 本身不是对象 → 整个丢掉（界面按「没有额度读数」处理，与缺失同义）。
    if (!isRecord(quota)) return quota === null || quota === undefined ? account : { ...account, quota: undefined };
    // **窗口元素也要逐项洗**（2026-10-20 独立审查发现 2）。
    //
    // 只保证 `windows` 是数组还不够：下游 `quotaAmount` 在 `unit === "usd"` 时调
    // `value.toFixed(2)`，而字符串没有 `toFixed` —— 一个坏元素就能让整块额度面板降级成
    // 「面板失败 + 重试」（有 `RenderBoundary` 兜底，不会白屏，但用户看不到额度）。
    // 与 `parseCatalogModels` 同一纪律：边界上逐项收窄，让下游可以信任形状。
    const windows = (Array.isArray(quota.windows) ? quota.windows : []).map(cleanQuotaWindow).filter(isDefined);
    const failures = Array.isArray(quota.failures) ? quota.failures : [];
    return { ...account, quota: { ...quota, windows, failures } };
  });
  return { ...value, accounts } as unknown as VendorUsageStatus;
}

/** 类型守卫：过滤掉 `undefined`。 */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * 洗一个额度窗口：只保留**形状正确**的字段。
 *
 * 数字字段必须是有限数字（`NaN` / 字符串 / `null` 一律归缺失 —— 缺失 ≠ 0，界面上
 * 「没有这个数」与「这个数是零」是两回事）；`unit` 只认已知单位；`key` 必须是非空字符串。
 * 认不出 `key` 的整条丢掉：没有键就没有标签可显示，留着只会渲染出一个空行。
 * @param raw - 线上来的一个窗口元素。
 * @returns 干净的窗口，或 `undefined`（连 key 都没有）。
 */
function cleanQuotaWindow(raw: unknown): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const key = raw.key;
  if (typeof key !== "string" || key.trim() === "") return undefined;
  const window: QuotaWindow = { key };
  const number = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const used = number(raw.used);
  if (used !== undefined) window.used = used;
  const cap = number(raw.cap);
  if (cap !== undefined) window.cap = cap;
  const percent = number(raw.percent);
  if (percent !== undefined) window.percent = percent;
  const resetAt = number(raw.resetAt);
  if (resetAt !== undefined) window.resetAt = resetAt;
  if (raw.unit === "usd") window.unit = "usd";
  if (raw.exceeded === true) window.exceeded = true;
  if (raw.unlimited === true) window.unlimited = true;
  if (raw.resetEstimated === true) window.resetEstimated = true;
  if (raw.usedSource === "local" || raw.usedSource === "vendor") window.usedSource = raw.usedSource;
  return window;
}

/** 校验账号行数组。 */
function parseAccountViews(endpoint: string, value: unknown): AccountView[] {
  if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of account views");
  return value as AccountView[];
}

/** 校验切换记录数组。 */
function parseSwitchRecords(endpoint: string, value: unknown): SwitchRecord[] {
  if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of switch records");
  return value as SwitchRecord[];
}

/** 校验一次登录尝试的状态。 */
function parseLoginStatus(endpoint: string, value: unknown): LoginStatus {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw boundaryError(endpoint, "expected a login status object with a state field");
  }
  return value as unknown as LoginStatus;
}

/**
 * 校验模型目录结果。
 *
 * 只查结构、逐项清洗：目录与失败原因都来自宿主，但页面不该因为一个坏行就整块崩掉；
 * 读不出内容的行直接丢弃，失败项只保留字符串。
 */
function parseCatalogModels(endpoint: string, value: unknown): CatalogModelsResult {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw boundaryError(endpoint, "expected a models result with a models array");
  }
  const models = value.models
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: item.id as string,
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.company === "string" ? { company: item.company } : {}),
      ...(item.free === true ? { free: true } : {}),
    }));
  const failures = Array.isArray(value.failures)
    ? value.failures.filter((item): item is string => typeof item === "string")
    : [];
  return { models, failures };
}

/** 校验一条账号行。 */
function parseAccountView(endpoint: string, value: unknown): AccountView {
  if (!isRecord(value) || typeof value.ref !== "string") {
    throw boundaryError(endpoint, "expected an account view with a ref");
  }
  return value as unknown as AccountView;
}

/** 无返回值的调用（宿主方法返回 `void`）：接受任何值并归一到 `undefined`。 */
function parseVoid(): undefined {
  return undefined;
}

/**
 * 校验「磁盘已安装版本」：必须是非空字符串。
 *
 * 拒绝空串：空版本号会让漂移检测永远判为「不一致」，于是每次加载都弹刷新提示 ——
 * 那比不提示更糟。宁可在这里失败（客户端据此视为「读不到」，不弹）。
 * @param endpoint - 调用点（错误信息里点名）。
 * @param value - 宿主返回值。
 * @returns 版本字符串。
 */
function parseInstalledVersion(endpoint: string, value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new Error(`${endpoint}: expected a non-empty version string`);
  return text;
}

/**
 * 校验导出结果：必须是一段**非空**的 CSV 文本。
 *
 * 为什么拒绝空串：真实导出**永远至少有表头**（`ledgerCsvOf` 对空台账也返回表头），所以
 * 空串只可能来自坏掉的宿主。接受它会让用户下载到一个 0 字节文件，还以为导出成功了 ——
 * 那是这条路径上最糟的失败形态（静默地给出一个看起来成功的结果）。
 * @param endpoint - 调用点（错误信息里点名）。
 * @param value - 线上值。
 * @returns CSV 文本。
 */
function parseUsageCsv(endpoint: string, value: unknown): string {
  if (typeof value !== "string") {
    throw boundaryError(endpoint, `expected the CSV text, got ${describeValue(value)}`);
  }
  if (value === "") {
    throw boundaryError(endpoint, "expected a CSV header, got an empty string");
  }
  return value;
}

/**
 * 校验「凭据状态」的结果。
 *
 * 只收 `{ ref, configured }` 两项：这是**布尔摘要**，绝不搬运密钥本身
 * （那会把它传进浏览器内存，而界面上从来不需要它）。
 * 形状不合格的行丢掉；一条都不剩时返回空数组（界面据此显示「未添加」）。
 * @param endpoint - 调用点。
 * @param value - 线上值。
 * @returns 逐条状态。
 */
function parseCredentialStatus(endpoint: string, value: unknown): { ref: string; configured: boolean }[] {
  if (!Array.isArray(value)) {
    throw boundaryError(endpoint, `expected an array of credential statuses, got ${describeValue(value)}`);
  }
  const out: { ref: string; configured: boolean }[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const ref = row.ref;
    const configured = row.configured;
    if (typeof ref !== "string" || ref === "") continue;
    if (typeof configured !== "boolean") continue;
    out.push({ ref, configured });
  }
  return out;
}

/**
 * 一次「密钥实测」的结论。
 *
 * 三档而不是两档，因为**「测不出来」和「密钥无效」是两件完全不同的事**：
 * - `ok`：真的拿到结果了；
 * - `invalid`：服务端明确拒绝（401 无效 / 402 余额不足 / 403 被封）—— 这把 key 不能用；
 * - `unknown`：**没能判定**（网络不通、超时、5xx）—— 不能因此告诉用户「你的 key 是错的」，
 *   那会让人去换一把其实没问题的密钥。界面对这一档只提示「暂时无法验证」。
 */
export type CredentialProbeState = "ok" | "invalid" | "unknown";

/** 密钥实测的结果（宿主 → 界面）。**绝不含密钥本身。** */
export interface CredentialProbe {
  ref: string;
  state: CredentialProbeState;
  /** 人话原因；`ok` 时为空。 */
  reason?: string;
}

/**
 * 校验「密钥实测」的结果。
 *
 * 形状不可信：缺 `state`、出现三档之外的值、`ref` 为空，一律丢掉 —— 界面宁可什么都不显示，
 * 也不能把一个猜出来的结论当成事实呈现（这条与全项目「不猜」的纪律一致）。
 * @param endpoint - 调用点。
 * @param value - 线上值。
 * @returns 合格的结果列表（可能为空）。
 */
function parseCredentialProbes(endpoint: string, value: unknown): CredentialProbe[] {
  if (!Array.isArray(value)) {
    throw boundaryError(endpoint, `expected an array of credential probes, got ${describeValue(value)}`);
  }
  const out: CredentialProbe[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const ref = row.ref;
    const state = row.state;
    if (typeof ref !== "string" || ref === "") continue;
    if (state !== "ok" && state !== "invalid" && state !== "unknown") continue;
    const reason = typeof row.reason === "string" && row.reason !== "" ? row.reason : undefined;
    out.push(reason === undefined ? { ref, state } : { ref, state, reason });
  }
  return out;
}

/**
 * 校验用量报表。
 *
 * **必须逐层校验**，不能只看顶层：渲染时会直接解引用 `account.period.kind` /
 * `bucket.*` / `total.bucket`，任何一层缺失都会在渲染期抛 TypeError —— React 因此
 * 丢弃整棵子树，表现就是「刷新用量统计时整块内容消失」（2026-10-19 报障）。
 *
 * 策略：不认识的行**丢弃**而不是整体报错 —— 少一行明细好过整页消失。
 */
function parseUsageReport(endpoint: string, value: unknown): UsageReportView {
  if (!isRecord(value) || !isRecord(value.total) || !Array.isArray(value.accounts)) {
    throw boundaryError(endpoint, "expected a usage report with accounts and total");
  }
  const total = value.total;
  if (!isRecord(total.bucket)) {
    throw boundaryError(endpoint, "expected total.bucket to be an object");
  }
  const accounts = (value.accounts as unknown[]).filter(isAccountUsageRow);
  const byVendor = Array.isArray(total.byVendor) ? (total.byVendor as unknown[]).filter(isVendorBucketRow) : [];
  // **lastUsed 必须显式搬运**：这个函数会重建对象，漏一个字段就等于把它抹掉。
  // 这条路径上已经栽过两次（`seams.reportOf` 漏一次、这里漏一次），症状都是「侧边栏不显示
  // 额度 / 不跟随当前账号」（2026-10-19 报障）。**新增字段时务必同步这一行。**
  const lastUsed = lastUsedOf(value.lastUsed);
  // 失败明细同样**必须显式搬运**：这个函数会重建对象，漏一行就等于把字段抹掉
  // （与 lastUsed 那条注释同一条纪律）。
  const failuresByKind = failuresByKindOf(value.failuresByKind);
  const failuresByAccount = failuresByAccountOf(value.failuresByAccount);
  return {
    accounts,
    total: {
      window: isUsageWindow(total.window) ? total.window : "today",
      bucket: total.bucket as unknown as UsageBucketView,
      byVendor,
      ...(typeof total.lastAt === "number" && Number.isFinite(total.lastAt) ? { lastAt: total.lastAt } : {}),
    },
    ...(lastUsed === undefined ? {} : { lastUsed }),
    ...(failuresByKind === undefined ? {} : { failuresByKind }),
    ...(failuresByAccount === undefined ? {} : { failuresByAccount }),
  } as UsageReportView;
}

/**
 * 校验并搬运「按账号的失败明细」。
 *
 * 逐行核对：`account` 非空、`rows` 是数组且其中每一行形状合格。坏行**丢弃**（一行坏掉不该
 * 让整块消失）；`rows` 全坏时整个账号条目丢弃。一条都没有时返回 `undefined`。
 * @param value - 线上值（形状不可信）。
 * @returns 按账号的明细；没有合格条目时为 `undefined`。
 */
function failuresByAccountOf(
  value: unknown,
): { vendor: string; account: string; rows: { kind: string; count: number; lastAt: number; lastAccount: string }[] }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { vendor: string; account: string; rows: { kind: string; count: number; lastAt: number; lastAccount: string }[] }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const vendor = entry.vendor;
    const account = entry.account;
    // `account` 允许空串（选账号之前就失败的记录），但 `vendor` 必须非空 ——
    // 没有厂商维度的条目无法归属，留着只会串味。
    if (typeof vendor !== "string" || vendor === "") continue;
    if (typeof account !== "string") continue;
    const rows = failuresByKindOf(entry.rows);
    if (rows === undefined) continue;
    out.push({ vendor, account, rows });
  }
  return out.length === 0 ? undefined : out;
}

/**
 * 校验并搬运失败明细。
 *
 * 逐行核对四个字段：形状不合格的行**丢弃**（一行坏掉不该让整块消失）。一行都不剩时返回
 * `undefined` —— 界面上「没有失败」与「明细读不到」因此长得一样，这正是我们要的：
 * 不给用户一条「失败 0 次」的行。
 * @param value - 线上值（形状不可信）。
 * @returns 明细行；没有合格行时为 `undefined`。
 */
function failuresByKindOf(
  value: unknown,
): { kind: string; count: number; lastAt: number; lastAccount: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((row): row is { kind: string; count: number; lastAt: number; lastAccount: string } => {
    if (!isRecord(row)) return false;
    return (
      typeof row.kind === "string" &&
      row.kind !== "" &&
      typeof row.count === "number" &&
      Number.isFinite(row.count) &&
      typeof row.lastAt === "number" &&
      Number.isFinite(row.lastAt) &&
      typeof row.lastAccount === "string"
    );
  });
  return rows.length === 0 ? undefined : rows;
}

/** 合法的窗口值。 */
function isUsageWindow(value: unknown): value is UsageWindowView {
  return value === "today" || value === "7d" || value === "30d" || value === "all";
}

/**
 * 校验并搬运「最近一次请求的账号」。
 *
 * 四个字段（vendor / account / at 必须有效，model 可空）都核对过才收下 —— 缺一块的读数
 * 拿去渲染只会让侧边栏挑不到账号，静默退回清单第一个（看起来像「不跟随」）。
 * @param value - 线上值（形状不可信）。
 * @returns 校验后的读数；不合格时为 `undefined`（当作「没有」，不猜）。
 */
function lastUsedOf(value: unknown): { vendor: string; account: string; model: string; at: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { vendor, account, at } = value;
  if (typeof vendor !== "string" || vendor === "") return undefined;
  if (typeof account !== "string" || account === "") return undefined;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return undefined;
  return { vendor, account, model: typeof value.model === "string" ? value.model : "", at };
}

/**
 * 一行账号用量是否**可渲染**：`period` 与 `bucket` 必须在。
 *
 * 只查渲染会直接解引用的字段；数字缺失由渲染层兜底（显示破折号），但对象整体缺失
 * 必须在边界挡掉 —— 那正是「渲染期 TypeError → 整块消失」的来源。
 */
function isAccountUsageRow(value: unknown): value is AccountUsageView {
  if (!isRecord(value)) return false;
  const period = value.period;
  if (!isRecord(period) || typeof period.kind !== "string" || typeof period.key !== "string") return false;
  if (typeof period.start !== "number" || typeof period.fromResetAt !== "boolean") return false;
  return isRecord(value.bucket);
}

/** 一家厂商的桶是否可渲染（`byVendor` 的每一行）。 */
function isVendorBucketRow(value: unknown): value is { vendor: string; bucket: UsageBucketView } {
  return isRecord(value) && typeof value.vendor === "string" && isRecord(value.bucket);
}

/** 校验「添加账户」的输入。 */function parseAddAccountInput(value: unknown): AddAccountInput {
  if (!isRecord(value) || typeof value.label !== "string") {
    throw boundaryError(`${USAGE_NAMESPACE}/addAccount`, "expected { label }");
  }
  const key = value.key;
  return typeof key === "string" ? { label: value.label, key } : { label: value.label };
}

/** 校验一个必填字符串。 */
function parseString(endpoint: string, value: unknown): string {
  if (typeof value !== "string") throw boundaryError(endpoint, `expected a string, got ${describeValue(value)}`);
  return value;
}

/** 校验一个数字（账号下标）。 */
function parseNumber(endpoint: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw boundaryError(endpoint, `expected a finite number, got ${describeValue(value)}`);
  }
  return value;
}

/** 校验一个布尔值。 */
function parseBoolean(endpoint: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw boundaryError(endpoint, `expected a boolean, got ${describeValue(value)}`);
  return value;
}

/** 校验「立即切换」的结果。 */
function parseSwitchNowResult(endpoint: string, value: unknown): SwitchNowResult {
  if (!isRecord(value) || typeof value.switched !== "boolean") {
    throw boundaryError(endpoint, "expected { switched: boolean }");
  }
  return {
    switched: value.switched,
    ...(typeof value.target === "string" ? { target: value.target } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason as SwitchReason } : {}),
  };
}

/** 校验一个字符串数组。 */
function parseStringArray(endpoint: string, value: unknown): string[] {
  if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of strings");
  return value.filter((item): item is string => typeof item === "string");
}

/** 校验全局切换设置。 */
function parseSwitchSettings(endpoint: string, value: unknown): SwitchSettingsWrite {
  if (!isRecord(value)) throw boundaryError(endpoint, "expected a switch settings object");
  const strategy =
    value.strategy === "best-quota" ? "best-quota" : value.strategy === "scheduled" ? "scheduled" : "order";
  const intervalMinutes =
    typeof value.intervalMinutes === "number" && Number.isFinite(value.intervalMinutes)
      ? Math.min(30 * 24 * 60, Math.max(0, Math.floor(value.intervalMinutes)))
      : 60;
  return {
    strategy,
    intervalMinutes,
    atTurnEnd: value.atTurnEnd !== false,
    autoSwitch: value.autoSwitch !== false,
  };
}

/** 校验一个可空的字符串（`null` 表示「回到自动轮换」）。 */
function parseNullableString(endpoint: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return parseString(endpoint, value);
}

/** 造一个强类型结果编解码（与旧插件 `makeStrictCodec` 同形）。 */
function strictCodec(typeSymbol: string, parse: (value: unknown) => unknown): UsageInvocationDescriptor["result"] {
  return { mode: "strict", typeSymbol: `${USAGE_PACKAGE}#${typeSymbol}`, create: () => ({ parse }) };
}

/**
 * 一个业务参数：名字、边界校验与类型符号。
 *
 * `parse` **必须**是 `(endpoint, value)` 双参：调用方 {@link parameterOf} 会把端点名传进去，
 * 让错误消息能指名是哪条调用的哪个字段。TypeScript **不会**拦住「少写一个形参」的函数
 * （少参是合法的可赋值形态），所以这里除了约定，还有 {@link parameterOf} 里的运行期护栏。
 */
interface ParamSpec {
  name: string;
  typeSymbol: string;
  /** 边界校验；第一个参数是端点名，错误消息用它指名是哪条调用。 */
  parse: (endpoint: string, value: unknown) => unknown;
  /** 允许缺席（线上 `undefined`）。 */
  optional?: boolean;
}

/**
 * 三个只读方法共用的参数：厂商 id。
 *
 * `parseVendorId` 只收一个值（它自己的语义），而描述符契约要双参 —— 所以这里**适配**，
 * 不能直接把单参函数挂上去。挂错了的后果是运行时才暴露的：`parameterOf` 会把端点名
 * （`"llm-account/status#vendor"`）当成 vendor 值去比对白名单，于是**每一次**带 vendor 的
 * 调用都在网关边界上被拒（真机报错：`wire field "vendor" failed boundary validation`），
 * 状态 / 账号 / 开关 / 增删改全线失效，而页面只会显示「账号数据暂不可用」。
 */
const VENDOR_PARAM: ParamSpec = { name: "vendor", typeSymbol: "VendorId", parse: (_endpoint, value) => parseVendorId(value) };
/** 账号 ref 参数。 */
const REF_PARAM: ParamSpec = { name: "ref", typeSymbol: "AccountRef", parse: parseString };
/** 模型 id 数组参数。 */
const MODELS_PARAM: ParamSpec = { name: "models", typeSymbol: "AccountModels", parse: parseStringArray };
/** 凭据引用名数组参数（查询它们是否真的配置了）。 */
const REFS_PARAM: ParamSpec = { name: "refs", typeSymbol: "CredentialRefs", parse: parseStringArray };
/** 密钥本身（只在这一条上行，绝不回读）。 */
const SECRET_PARAM: ParamSpec = { name: "secret", typeSymbol: "CredentialSecret", parse: (endpoint, value) => {
  if (typeof value !== "string" || value.trim() === "") throw boundaryError(endpoint, "expected a non-empty secret");
  return value;
} };
/**
 * 用量窗口参数（`today` / `7d` / `30d` / `all`）。
 *
 * 取值一旦不认识就退回 `today`：宁可少显示，也不要因为一个拼错的窗口让整块报表报错。
 */
const WINDOW_PARAM: ParamSpec = {
  name: "window",
  typeSymbol: "UsageWindow",
  optional: true,
  parse: (_endpoint, value) => {
    if (typeof value !== "string") return "today";
    return value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "today";
  },
};

/**
 * 造一个参数描述符。
 *
 * 护栏：`parse` 的形参数必须 ≥ 2。这是唯一能机械拦住上面那类 arity 错误的检查 ——
 * 类型系统放行，形状测试也放行，只有把真值喂进 `codec.create().parse()` 才会炸。
 * @param spec - 参数规格。
 * @param method - 所属方法名（拼端点用）。
 */
function parameterOf(spec: ParamSpec, method: string): unknown {
  if (spec.parse.length < 2) {
    // 抛在这里而不是让网关抛：这条消息指名是哪个参数的 arity 写错了，而网关那边只会说
    // 「wire field X failed boundary validation」—— 看不出是自己的校验函数挂错了参数顺序。
    throw new Error(
      `${USAGE_PACKAGE}: parameter "${spec.name}" of ${USAGE_NAMESPACE}/${method} needs a (endpoint, value) parser, got one with ${spec.parse.length} argument(s)`,
    );
  }
  const parameterEndpoint = `${USAGE_NAMESPACE}/${method}#${spec.name}`;
  return {
    name: spec.name,
    wire: spec.name,
    source: "json",
    ...(spec.optional === true ? { acceptsUndefined: true } : {}),
    codec: {
      mode: "strict",
      typeSymbol: `${USAGE_PACKAGE}#${spec.typeSymbol}`,
      create: () => ({ parse: (value: unknown) => spec.parse(parameterEndpoint, value) }),
    },
  };
}

/** 造一个强类型调用描述符（端点 = `<namespace>/<method>`）。 */
function makeDescriptor(
  method: UsageMethod,
  typeSymbol: string,
  parse: (endpoint: string, value: unknown) => unknown,
  parameters: readonly ParamSpec[],
): UsageInvocationDescriptor {
  const endpoint = `${USAGE_NAMESPACE}/${method}`;
  return {
    id: `${USAGE_PACKAGE}#${endpoint}`,
    service: USAGE_SERVICE_KEY,
    namespace: USAGE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: parameters.map((spec) => parameterOf(spec, method)),
    // 结果解析器绑上**本条调用**的端点：复用同一个解析函数的端点（addAccount 与
    // accounts 共用 parseAccountView）才不会把失败归错到别人头上。
    result: strictCodec(typeSymbol, (value: unknown) => parse(endpoint, value)),
  };
}

/**
 * 全部远程方法的描述符（每次调用返回新数组，避免调用方改到共享常量）。
 * @returns 描述符列表。
 */
export function usageDescriptors(): UsageInvocationDescriptor[] {
  return [
    makeDescriptor("status", "VendorUsageStatus", parseVendorUsageStatus, [VENDOR_PARAM]),
    makeDescriptor("accounts", "AccountViewList", parseAccountViews, [VENDOR_PARAM]),
    makeDescriptor("switches", "SwitchRecordList", parseSwitchRecords, [VENDOR_PARAM]),
    // 无参：磁盘上的已安装版本（页面用它判断自己的 bundle 是否已落后）。
    makeDescriptor("installedVersion", "InstalledVersion", parseInstalledVersion, []),
    makeDescriptor("models", "CatalogModels", parseCatalogModels, [VENDOR_PARAM]),
    makeDescriptor("addAccount", "AccountView", parseAccountView, [
      VENDOR_PARAM,
      { name: "input", typeSymbol: "AddAccountInput", parse: (_endpoint, value) => parseAddAccountInput(value) },
    ]),
    makeDescriptor("renameAccount", "Void", parseVoid, [
      VENDOR_PARAM,
      REF_PARAM,
      { name: "label", typeSymbol: "AccountLabel", parse: parseString },
    ]),
    /**
     * 把账号名恢复成登录时的默认名（2026-10-22）。
     *
     * 为什么单独一个方法而不是让客户端算好再调 `renameAccount`：默认名存在**宿主侧的
     * 账号条目**里（`defaultName` 字段），客户端只是从 `list()` 里读到副本。让宿主自己
     * 查自己写，「默认名」就只有一处真相 —— 否则客户端传来的值可能已经过期（另一个
     * 窗口刚改过名）。
     */
    makeDescriptor("restoreAccountName", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
    // 密钥从浏览器到宿主只走这一条调用，宿主把它交给凭据服务；**永远不进设置文档**。
    makeDescriptor("replaceKey", "Void", parseVoid, [
      VENDOR_PARAM,
      REF_PARAM,
      { name: "key", typeSymbol: "ApiKey", parse: parseString },
    ]),
    makeDescriptor("removeAccount", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
    makeDescriptor("selectAccount", "Void", parseVoid, [
      VENDOR_PARAM,
      { name: "ref", typeSymbol: "NullableAccountRef", parse: parseNullableString, optional: true },
    ]),
    makeDescriptor("moveAccount", "Void", parseVoid, [
      VENDOR_PARAM,
      REF_PARAM,
      { name: "toIndex", typeSymbol: "AccountIndex", parse: parseNumber },
    ]),
    makeDescriptor("setAutoSwitch", "Void", parseVoid, [
      VENDOR_PARAM,
      { name: "value", typeSymbol: "AutoSwitch", parse: parseBoolean },
    ]),
    makeDescriptor("switchNow", "SwitchNowResult", parseSwitchNowResult, [VENDOR_PARAM]),
    makeDescriptor("setAccountOrder", "Void", parseVoid, [
      { name: "order", typeSymbol: "AccountOrder", parse: parseStringArray },
    ]),
    makeDescriptor("setSwitchSettings", "Void", parseVoid, [
      { name: "settings", typeSymbol: "SwitchSettingsWrite", parse: parseSwitchSettings },
    ]),
    makeDescriptor("setAccountModels", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM, MODELS_PARAM]),
    // 登录的 ref 由宿主按登录返回的用户名推导（`accountRef`），客户端**不能**指定它 ——
    // 能指定就等于让页面决定把密钥写进哪个凭据槽，那正是 T5 Step 7 要防的事。
    makeDescriptor("loginBegin", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
    makeDescriptor("loginStatus", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
    makeDescriptor("loginCancel", "Void", parseVoid, [VENDOR_PARAM]),
    // 用量统计：**跨厂商**的一份报表（总账 + 每账号周期）。不带 vendor 参数，
    // 因为它读的是一本共享台账（见 `vendors/usage-store`）。
    makeDescriptor("usageReport", "UsageReport", parseUsageReport, [WINDOW_PARAM]),
    makeDescriptor("usageClear", "Void", parseVoid, []),
    // 导出：返回 CSV 文本（不是文件）—— 传文件路径/让宿主写盘会把「存在哪」变成新问题，
    // 而浏览器侧本来就有下载能力。
    makeDescriptor("usageExportCsv", "UsageCsv", parseUsageCsv, [
      { name: "limit", typeSymbol: "ExportLimit", parse: parseNumber, optional: true },
    ]),
    // 凭据状态：界面要能回答「我填的那个引用名，库里真的有一把 key 吗」。
    // 只回**布尔**，绝不回密钥本身 —— 这条边界与账号卡片的「已配置」徽标同一来源。
    makeDescriptor("credentialStatus", "CredentialStatusList", parseCredentialStatus, [REFS_PARAM]),
    // 写入一把密钥：搜索设置卡里的「保存密钥」走这条（与账号卡片「更换密钥」同一条路径）。
    makeDescriptor("setCredential", "Void", parseVoid, [REF_PARAM, SECRET_PARAM]),
    // 密钥实测：加完立刻发一次最小搜索请求，把「能不能用」当场告诉用户。
    // 用户 2026-10-20：「添加了key后就发起一次小请求验证一下是否可用，不可用的话就进行提示」。
    // 只回结论与原因，**绝不回密钥**。
    makeDescriptor("probeSearchCredential", "CredentialProbes", parseCredentialProbes, [REFS_PARAM]),
  ];
}

/** 客户端侧从命名空间对象上调用全部方法的形状。 */
export interface UsageNamespace {
  status(vendor: string): Promise<VendorUsageStatus>;
  /**
   * 用量报表（跨厂商：每账号按自己的记账周期 + 一份总账）。
   *
   * 可选：老版本宿主侧没实现它时，页面不该因此崩 —— 卡片整体不渲染即可。
   */
  usageReport?(window: UsageWindowView): Promise<UsageReportView>;
  /** 清空用量台账（不可撤销；页面负责二次确认）。 */
  /**
   * 清空用量台账（不可撤销；页面负责二次确认）。
   *
   * 返回 `unknown` 而不是 `void`：宿主的一元调用**永远 resolve 成信封**
   * （`{ ok: true, value }` / `{ ok: false, error }`），写 `Promise<void>` 等于对类型撒谎 ——
   * 调用方会以为 `await` 正常返回就是成功，于是根本没有解包（2026-10-20 审计的真 bug：
   * 被拒绝的清空看起来像成功了）。调用方必须走 `unwrapRemote`。
   */
  usageClear?(): Promise<unknown>;
  /**
   * 导出用量台账为 CSV 文本（可选：老宿主没实现时按钮不显示）。
   *
   * 同样返回 `unknown`：真实值是信封，必须解包后再用（否则会把 `[object Object]` 写进文件）。
   * @param limit - 最多导出多少条（尾部，即最近的）；省略 = 全部。
   */
  usageExportCsv?(limit?: number): Promise<unknown>;
  /**
   * 查询一组凭据引用名是否**真的**配置了（界面用来显示「已添加 / 未添加」）。
   *
   * 返回 `unknown`：与其它远程方法一样，真实值是 `{ ok, value }` 信封，必须 `unwrapRemote`。
   * 只回布尔，**绝不回密钥**。
   */
  credentialStatus?(refs: readonly string[]): Promise<unknown>;
  /**
   * 往凭据库里写一把密钥（搜索设置卡的「保存密钥」）。
   *
   * 返回 `unknown`：真实值是信封，必须 `unwrapRemote`。
   */
  setCredential?(ref: string, secret: string): Promise<unknown>;
  /**
   * 实测一组搜索密钥能不能用（每个引用名发一次最小请求）。
   *
   * 可选：老宿主没实现时界面跳过验证 —— 那种情况只显示「已保存」，不谎称已验证。
   * 返回 `unknown`：真实值是信封，必须 `unwrapRemote`。
   */
  probeSearchCredential?(refs: readonly string[]): Promise<unknown>;
  accounts(vendor: string): Promise<AccountView[]>;
  switches(vendor: string): Promise<SwitchRecord[]>;
  /**
   * 磁盘上的**已安装版本**（宿主读自己的 `package.json`）。
   *
   * 可选：老版本宿主没有它 —— 那时页面无法判断自己是否落后，于是不提示
   * （没有依据就不打扰用户）。
   */
  installedVersion?(): Promise<unknown>;
  models?(vendor: string): Promise<CatalogModelsResult>;
  addAccount(vendor: string, input: AddAccountInput): Promise<AccountView>;
  renameAccount(vendor: string, ref: string, label: string): Promise<void>;
  /**
   * 把账号名恢复成登录时的默认名（可选：只有记录了默认名的厂商实现）。
   */
  restoreAccountName?(vendor: string, ref: string): Promise<void>;
  replaceKey(vendor: string, ref: string, key: string): Promise<void>;
  removeAccount(vendor: string, ref: string): Promise<void>;
  selectAccount(vendor: string, ref: string | null): Promise<void>;
  moveAccount(vendor: string, ref: string, toIndex: number): Promise<void>;
  setAutoSwitch(vendor: string, value: boolean): Promise<void>;
  switchNow?(vendor: string): Promise<SwitchNowResult>;
  setAccountOrder?(order: readonly string[]): Promise<void>;
  setSwitchSettings?(settings: SwitchSettingsWrite): Promise<void>;
  setAccountModels?(vendor: string, ref: string, models: readonly string[]): Promise<void>;
  loginBegin(vendor: string): Promise<LoginStatus>;
  loginStatus(vendor: string): Promise<LoginStatus>;
  loginCancel(vendor: string): Promise<void>;
}
