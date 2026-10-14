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
import type { AccountView, FailureKind, QuotaWindow, VendorCapabilities } from "../core/adapter";

// 客户端其它模块（页面、接缝）需要这几个形状时也从这里取，不必各自去 import `src/core/**`：
// 这个模块是客户端侧唯一允许提到 core 的地方，而且是**纯类型**导入（`verbatimModuleSyntax`
// 会把整个 import 语句擦掉，浏览器产物里不会出现 core 的任何运行时代码）。
export type { AccountView, FailureKind, QuotaWindow, VendorCapabilities } from "../core/adapter";

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
  // 账号操作（Task 5：账户卡片的 `⋯` 菜单与「添加账户」）
  "addAccount",
  "renameAccount",
  "replaceKey",
  "removeAccount",
  "selectAccount",
  // 网页登录（Task 5：Command Code 的登录入口）
  "loginBegin",
  "loginStatus",
  "loginCancel",
] as const;

/** 一个方法名。 */
export type UsageMethod = (typeof USAGE_METHODS)[number];

/** 一次登录尝试的状态（与宿主侧 `LoginStatus` 同形；`reason` 是稳定文案键）。 */
export interface LoginStatus {
  state: "idle" | "waiting" | "success" | "failed";
  authUrl?: string;
  reason?: string;
}

/** 「添加账户」的输入。`key` 缺省表示先建条目、稍后补密钥。 */
export interface AddAccountInput {
  label: string;
  key?: string;
}

/** 本包托管的两条厂商路由（客户端只做参数校验，不认识厂商语义）。 */
export const VENDOR_IDS = ["commandcode", "dsh-opencode-go"] as const;

/** 一条额度摘要。字段一律**原样**搬运：读数里没有的字段不许补 0。 */
export interface QuotaSummary {
  plan?: string;
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
export type SwitchReason = "quota" | "rate-limit" | "invalid-credential" | "manual";

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
  throw boundaryError(`${USAGE_NAMESPACE}/vendor`, `expected a known vendor id, got ${JSON.stringify(value)}`);
}

/** 校验状态结果：只查结构（数据由宿主产生，深校验没有额外价值）。 */
function parseVendorUsageStatus(value: unknown): VendorUsageStatus {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw boundaryError(`${USAGE_NAMESPACE}/status`, "expected an object with an accounts array");
  }
  return value as unknown as VendorUsageStatus;
}

/** 校验账号行数组。 */
function parseAccountViews(value: unknown): AccountView[] {
  if (!Array.isArray(value)) throw boundaryError(`${USAGE_NAMESPACE}/accounts`, "expected an array of account views");
  return value as AccountView[];
}

/** 校验切换记录数组。 */
function parseSwitchRecords(value: unknown): SwitchRecord[] {
  if (!Array.isArray(value)) throw boundaryError(`${USAGE_NAMESPACE}/switches`, "expected an array of switch records");
  return value as SwitchRecord[];
}

/** 校验一次登录尝试的状态。 */
function parseLoginStatus(value: unknown): LoginStatus {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw boundaryError(`${USAGE_NAMESPACE}/login`, "expected a login status object with a state field");
  }
  return value as unknown as LoginStatus;
}

/** 校验一条账号行。 */
function parseAccountView(value: unknown): AccountView {
  if (!isRecord(value) || typeof value.ref !== "string") {
    throw boundaryError(`${USAGE_NAMESPACE}/accounts`, "expected an account view with a ref");
  }
  return value as unknown as AccountView;
}

/** 无返回值的调用（宿主方法返回 `void`）：接受任何值并归一到 `undefined`。 */
function parseVoid(): undefined {
  return undefined;
}

/** 校验「添加账户」的输入。 */
function parseAddAccountInput(value: unknown): AddAccountInput {
  if (!isRecord(value) || typeof value.label !== "string") {
    throw boundaryError(`${USAGE_NAMESPACE}/addAccount`, "expected { label }");
  }
  const key = value.key;
  return typeof key === "string" ? { label: value.label, key } : { label: value.label };
}

/** 校验一个必填字符串。 */
function parseString(value: unknown): string {
  if (typeof value !== "string") throw boundaryError(USAGE_NAMESPACE, `expected a string, got ${JSON.stringify(value)}`);
  return value;
}

/** 校验一个可空的字符串（`null` 表示「回到自动轮换」）。 */
function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return parseString(value);
}

/** 造一个强类型结果编解码（与旧插件 `makeStrictCodec` 同形）。 */
function strictCodec(typeSymbol: string, parse: (value: unknown) => unknown): UsageInvocationDescriptor["result"] {
  return { mode: "strict", typeSymbol: `${USAGE_PACKAGE}#${typeSymbol}`, create: () => ({ parse }) };
}

/** 一个业务参数：名字、边界校验与类型符号。 */
interface ParamSpec {
  name: string;
  typeSymbol: string;
  parse: (value: unknown) => unknown;
  /** 允许缺席（线上 `undefined`）。 */
  optional?: boolean;
}

/** 三个只读方法共用的参数：厂商 id。 */
const VENDOR_PARAM: ParamSpec = { name: "vendor", typeSymbol: "VendorId", parse: parseVendorId };
/** 账号 ref 参数。 */
const REF_PARAM: ParamSpec = { name: "ref", typeSymbol: "AccountRef", parse: parseString };

/** 造一个参数描述符。 */
function parameterOf(spec: ParamSpec): unknown {
  return {
    name: spec.name,
    wire: spec.name,
    source: "json",
    ...(spec.optional === true ? { acceptsUndefined: true } : {}),
    codec: {
      mode: "strict",
      typeSymbol: `${USAGE_PACKAGE}#${spec.typeSymbol}`,
      create: () => ({ parse: spec.parse }),
    },
  };
}

/** 造一个强类型调用描述符（端点 = `<namespace>/<method>`）。 */
function makeDescriptor(
  method: UsageMethod,
  typeSymbol: string,
  parse: (value: unknown) => unknown,
  parameters: readonly ParamSpec[],
): UsageInvocationDescriptor {
  return {
    id: `${USAGE_PACKAGE}#${USAGE_NAMESPACE}/${method}`,
    service: USAGE_SERVICE_KEY,
    namespace: USAGE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: parameters.map(parameterOf),
    result: strictCodec(typeSymbol, parse),
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
    makeDescriptor("addAccount", "AccountView", parseAccountView, [
      VENDOR_PARAM,
      { name: "input", typeSymbol: "AddAccountInput", parse: parseAddAccountInput },
    ]),
    makeDescriptor("renameAccount", "Void", parseVoid, [
      VENDOR_PARAM,
      REF_PARAM,
      { name: "label", typeSymbol: "AccountLabel", parse: parseString },
    ]),
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
    // 登录的 ref 由宿主按登录返回的用户名推导（`accountRef`），客户端**不能**指定它 ——
    // 能指定就等于让页面决定把密钥写进哪个凭据槽，那正是 T5 Step 7 要防的事。
    makeDescriptor("loginBegin", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
    makeDescriptor("loginStatus", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
    makeDescriptor("loginCancel", "Void", parseVoid, [VENDOR_PARAM]),
  ];
}

/** 客户端侧从命名空间对象上调用全部方法的形状。 */
export interface UsageNamespace {
  status(vendor: string): Promise<VendorUsageStatus>;
  accounts(vendor: string): Promise<AccountView[]>;
  switches(vendor: string): Promise<SwitchRecord[]>;
  addAccount(vendor: string, input: AddAccountInput): Promise<AccountView>;
  renameAccount(vendor: string, ref: string, label: string): Promise<void>;
  replaceKey(vendor: string, ref: string, key: string): Promise<void>;
  removeAccount(vendor: string, ref: string): Promise<void>;
  selectAccount(vendor: string, ref: string | null): Promise<void>;
  loginBegin(vendor: string): Promise<LoginStatus>;
  loginStatus(vendor: string): Promise<LoginStatus>;
  loginCancel(vendor: string): Promise<void>;
}
