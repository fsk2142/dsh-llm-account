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
import type { SwitchRuntimeState } from "../core/switching";

// 客户端其它模块（页面、接缝）需要这几个形状时也从这里取，不必各自去 import `src/core/**`：
// 这个模块是客户端侧唯一允许提到 core 的地方，而且是**纯类型**导入（`verbatimModuleSyntax`
// 会把整个 import 语句擦掉，浏览器产物里不会出现 core 的任何运行时代码）。
export type {
  AccountView,
  CatalogModel,
  CatalogModelsResult,
  FailureKind,
  QuotaWindow,
  VendorCapabilities,
} from "../core/adapter";
export type { SwitchRuntimeState } from "../core/switching";

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
  // 设置页的模型勾选：未过滤的完整目录
  "models",
  // 账号操作（Task 5：账户卡片的 `⋯` 菜单与「添加账户」）
  "addAccount",
  "renameAccount",
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
  /** 设备码流程要在浏览器里输入的代码。 */
  userCode?: string;
  /** 等待的过期时刻（epoch 毫秒）。 */
  expiresAt?: number;
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
export type SwitchReason = "quota" | "rate-limit" | "invalid-credential" | "manual" | "balance";

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
 * 校验状态结果：只查结构（数据由宿主产生，深校验没有额外价值）。
 * @param endpoint - 调用方端点名（错误消息要指名是哪条调用）。
 * @param value - 边界值。
 */
function parseVendorUsageStatus(endpoint: string, value: unknown): VendorUsageStatus {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw boundaryError(endpoint, "expected an object with an accounts array");
  }
  return value as unknown as VendorUsageStatus;
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

/** 校验「添加账户」的输入。 */
function parseAddAccountInput(value: unknown): AddAccountInput {
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
  models?(vendor: string): Promise<CatalogModelsResult>;
  addAccount(vendor: string, input: AddAccountInput): Promise<AccountView>;
  renameAccount(vendor: string, ref: string, label: string): Promise<void>;
  replaceKey(vendor: string, ref: string, key: string): Promise<void>;
  removeAccount(vendor: string, ref: string): Promise<void>;
  selectAccount(vendor: string, ref: string | null): Promise<void>;
  moveAccount(vendor: string, ref: string, toIndex: number): Promise<void>;
  setAutoSwitch(vendor: string, value: boolean): Promise<void>;
  switchNow?(vendor: string): Promise<SwitchNowResult>;
  setAccountOrder?(order: readonly string[]): Promise<void>;
  loginBegin(vendor: string): Promise<LoginStatus>;
  loginStatus(vendor: string): Promise<LoginStatus>;
  loginCancel(vendor: string): Promise<void>;
}
