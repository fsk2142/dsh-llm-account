/**
 * 共享内核的端口与能力声明：两个厂商适配器实现这些接口，后续任务按这些名字编程。
 *
 * 本文件只放类型与 `supports()` 查询，不做 I/O、不持有状态、不含厂商专属逻辑。
 * @module dsh-llm-account/src/core/adapter
 */
import type { GenerateOptions, LlmAdapter, ModelModality, StreamChunk } from "@deepseek-ai/dsh-llm";

/** 本包托管的两条 provider 路由 id（全局约束，不得更改）。 */
export type VendorId = "commandcode" | "dsh-opencode-go";

/** 统一失败分类；厂商原始错误到本分类的映射表放在各自适配器里。 */
export type FailureKind =
  | "quota"
  | "rate-limit"
  | "invalid-credential"
  | "unavailable"
  | "server"
  | "network";

/** 一次拒绝：分类、可选的重置时刻（epoch 毫秒，仅当厂商给出时）、面向用户的说明。 */
export interface Rejection {
  kind: FailureKind;
  resetAt?: number;
  message: string;
}

/**
 * 账号行的展示视图。身份键是凭据引用 ref，不是 key —— 两个账号共用同一个 key
 * 时状态也必须隔离。
 */
export interface AccountView {
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
export interface ModelRule {
  models: string[];
  account: string;
}

/** 账号库状态：顺序、按模型规则、固定账号（`null` 表示自动轮换）。 */
export interface AccountState {
  order: string[];
  rules: ModelRule[];
  pinned: string | null;
}

/** 厂商能力声明；UI 依据它隐藏或置灰不可用控件。 */
export interface VendorCapabilities {
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
  modelVisibilityWrite: "onSave" | "immediate";
  /** 额度耗尽时是否允许自动切换账号。 */
  automaticSwitch: boolean;
}

/** 账号库端口。未实现的可选方法由能力声明关闭，UI 对应控件隐藏。 */
export interface AccountPort {
  list(): Promise<AccountView[]>;
  add(input: { label: string; key?: string }): Promise<AccountView>;
  rename(ref: string, label: string): Promise<void>;
  replaceKey(ref: string, key: string): Promise<void>;
  remove(ref: string): Promise<void>;
  /** `null` 表示回到自动轮换。 */
  select(ref: string | null): Promise<void>;
  move?(ref: string, toIndex: number): Promise<void>;
  setAutoSwitch?(value: boolean): Promise<void>;
}

/**
 * 凭据端口：按键的引用名解析、写入、移除密钥。
 * 密钥只经此端口进出，永不写入设置文档；空串或纯空白一律视为未配置。
 */
export interface CredentialPort {
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
  describe(refs: string[]): Promise<Record<string, { configured: boolean; writable?: boolean }>>;
}

/**
 * 归一化后的额度窗口。除 `key` 外全部可选：字段不存在表示「未知」，
 * 绝不允许倒成 0。
 */
export interface QuotaWindow {
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
  /** 是否已超出。 */
  exceeded?: boolean;
}

/** 归一化后的额度读数；部分端点失败不拖垮整体，失败项列在 `failures` 里。 */
export interface QuotaSnapshot {
  windows: QuotaWindow[];
  /** 套餐标识，厂商未提供时缺省。 */
  plan?: string;
  /** 失败的端点或窗口名，供 UI 提示数据不完整。 */
  failures: string[];
}

/** 额度端口：读取归一化额度读数。 */
export interface QuotaPort {
  /**
   * 读一次额度。
   * @param ref - 指定账号；缺省时读「当前选中账号」（页面/侧边栏的既有行为）。
   *   切换策略的额度优先模式用它逐个读候选账号，不需要临时改当前账号。
   * @returns 归一化读数。
   */
  snapshot(ref?: string): Promise<QuotaSnapshot>;
}

/** 模型目录的最小统一形状。 */
export interface CatalogEntry {
  /** 请求时使用的模型 id。 */
  id: string;
  /** 用户可见名称。 */
  name: string;
  /** 上下文窗口（token）。 */
  contextWindow?: number;
  /** 最大输出 token。 */
  maxTokens?: number;
  /** 可选推理档位 id，按展示顺序排列。 */
  efforts?: readonly string[];
  /** 接受的输入类型，至少含 `"text"`。 */
  inputModalities: readonly ModelModality[];
}

/** 目录端口：返回当前可广告的模型条目（已由可见性规则过滤）。 */
export interface CatalogPort {
  list(): Promise<CatalogEntry[]>;
}

/** 目录里的一行（只用于设置页勾选，不需要完整元数据）。 */
export interface CatalogModel {
  /** 请求时使用的模型 id。 */
  id: string;
  /** 用户可见名称；端点没给时缺省。 */
  name?: string;
}

/** `models()` 远程方法的结果：目录 + 读取失败项（失败不抛）。 */
export interface CatalogModelsResult {
  models: CatalogModel[];
  failures: string[];
}

/** 能列出目录的适配器：设置页的模型勾选需要**未过滤**的完整目录。 */
export interface CatalogModelsPort {
  catalogModels(): Promise<CatalogModel[]>;
}

/** 一次登录尝试的状态。 */
export interface LoginStatus {
  state: "idle" | "waiting" | "success" | "failed";
  /** 等待授权时可供用户打开的网址。 */
  authUrl?: string;
  /** 失败原因（稳定文案键，例如 `"timeout"`）。 */
  reason?: string;
}

/** 网页登录端口：仅声明了 `browserLogin` 能力的厂商提供。 */
export interface LoginPort {
  /** 开始（或接续）一次尝试，返回其最新状态。 */
  begin(): Promise<LoginStatus>;
  /** 查询当前尝试状态。 */
  status(): Promise<LoginStatus>;
  /** 取消等待中的尝试；终态不受影响。 */
  cancel(): Promise<void>;
}

/** 传输端口：一次流式请求。deadline 与空闲看门狗由请求内核包在外面。 */
export interface TransportPort {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

/** 一处按路径寻址的设置编辑；路径语义与宿主设置接缝一致。 */
export type SettingsOp =
  | { op: "set"; path: readonly string[]; value: unknown }
  | { op: "unset"; path: readonly string[] };

/** 一次设置读取的结果：文档内容与它当时的修订号。 */
export interface SettingsSnapshot {
  /** 描述时的修订号，原样传给 `mutate`。 */
  revision: number;
  value: Readonly<Record<string, unknown>>;
}

/**
 * 设置端口（本项目自己的端口，不绑定宿主设置服务的具体类型）。
 * `mutate` 的修订号过期时抛出 `code` 为 `SETTINGS_CONFLICT` 的错误；
 * 调用方必须重读后重放用户操作，不得覆盖对方的写入。
 */
export interface SettingsPort {
  describe(ns: string): Promise<SettingsSnapshot>;
  mutate(ns: string, ops: readonly SettingsOp[], revision: number): Promise<SettingsSnapshot>;
}

/** 一个厂商的适配器聚合：宿主适配器实例加上各个端口与能力声明。 */
export interface VendorAdapter {
  readonly providerId: VendorId;
  readonly displayName: string;
  readonly capabilities: VendorCapabilities;
  /** 注册到宿主路由的适配器实例。 */
  readonly llm: LlmAdapter;
  readonly accounts: AccountPort;
  readonly credentials: CredentialPort;
  readonly catalog: CatalogPort;
  readonly quota: QuotaPort;
  readonly transport: TransportPort;
  /** 仅提供网页登录的厂商给出。 */
  readonly login?: LoginPort;
}

/**
 * 查询厂商是否声明了某项能力。只读，无副作用：布尔能力按取值判定，
 * 非布尔能力（`quotaShape` / `modelVisibilityWrite`）按是否声明判定。
 * @param caps - 该厂商的能力声明。
 * @param feature - 要查询的能力字段名。
 * @returns 该能力是否可用。
 */
export function supports(caps: VendorCapabilities, feature: keyof VendorCapabilities): boolean {
  const declared = caps[feature];
  return typeof declared === "boolean" ? declared : declared !== undefined;
}
