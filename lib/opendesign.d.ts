import { a as AccountView, c as QuotaPort, i as AccountPort, l as VendorCapabilities, n as RotationAccess, o as CredentialPort, r as IntentLog, t as PluginConfigSchema } from "./assembly-B6om4u3r.js";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
//#region src/vendors/opendesign/accounts.d.ts
/** 追加账号的输入：展示名称与两个可选密钥（+ 可选工作区）。 */
interface OpenDesignAccountInput {
  /** 用户可见名称（账号标签；ref 由它派生）。 */
  label: string;
  /** 推理密钥（runtime key）；缺省表示先建条目、稍后补。 */
  key?: string;
  /** 控制面密钥（额度接口用）；缺省表示这个账号只做推理。 */
  controlKey?: string;
  /** 工作区 id（vela 周期额度查询用）；缺省表示这台机器不知道该账号的工作区。 */
  workspaceId?: string;
}
/**
 * Open Design 的账号端口：`AccountPort` 的七个方法都在，`add` 多收两个可选字段
 * （控制面密钥与工作区）。多出来的字段不影响 `AccountPort` 的实现（多余参数是可选的）。
 */
type OpenDesignAccounts = Omit<AccountPort, "add"> & {
  add(input: OpenDesignAccountInput): Promise<AccountView>;
  /**
   * 把工作区写进**这个账号自己的条目**（2026-10-20，多账号兼容）。
   *
   * 不在 `AccountPort` 里：那是三家共用的最小契约，工作区只有这一家有这个概念。
   */
  setWorkspace(ref: string, workspaceId: string): Promise<void>;
};
//#endregion
//#region src/vendors/opendesign/index.d.ts
/**
 * 宿主在 volatile 配置被改写后广播这次更新（与另两行同一事件名；类型声明逐字对照
 * `opencode/index.ts` 的补齐声明 —— 本机没有 loader 包，宿主侧不导出这个事件）。
 */
declare module "@deepseek-ai/cordis" {
  interface Events {
    /**
     * volatile 配置被改写。
     * @param paths - 被改写的路径列表（本入口不读它，只用来触发重判）。
     */
    "loader/volatile-update"(paths: readonly (readonly string[])[]): void;
  }
}
/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opendesign`）。 */
export declare const name = "llm-opendesign";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export declare const inject: string[];
/** provider 路由 id（施工单 §1，全局约束，不得更改）。 */
export declare const PROVIDER_ID = "opendesign";
/**
 * 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入）。
 *
 * 账号条目比另两家多两个可选字段（`controlKeyEnv` 控制面密钥槽、`workspaceId` vela
 * 工作区）；顶层 `walletBase` 与 `workspaceId` 是本行新增的可配置项（客户端
 * 「高级设置」里暴露，`shell.ts` 的卡片声明与这里的字段一一对应）。
 *
 * 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery
 * 的推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）。
 */
export declare const Config: PluginConfigSchema;
/** 一行的装配产物。宿主忽略 `apply` 的返回值；它存在是为了装配测试与将来取用。 */
export interface OpenDesignBundle {
  readonly providerId: string;
  /** `core` 侧的固定命名空间（不是 profile 行 id）。 */
  readonly settingsNs: string;
  /** 能力声明（规格 §7.3）：宿主公开这套声明，页面据此降级。 */
  readonly capabilities: VendorCapabilities;
  /** 适配器实例（`enabled: false` 时构造但**不**注册到宿主路由）。 */
  readonly adapter: LlmAdapter;
  /** 轮换引擎读取口（账号库状态变了就换引擎）。 */
  readonly rotation: RotationAccess;
  /** 该设置命名空间唯一的意图日志。 */
  readonly intents: IntentLog;
  /**
   * 账号端口。类型是本行**加宽过的**那份（`add` 多收控制面密钥与工作区），
   * 这样装配测试与将来的调用方能看见这两个可选字段；结构上仍然是完整的 `AccountPort`。
   */
  readonly accounts: OpenDesignAccounts;
  readonly credentials: CredentialPort;
  readonly quota: QuotaPort;
}
/**
 * 装一行 Open Design。
 *
 * 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
 * @param ctx - 宿主插件上下文。
 * @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
 * @returns 装配产物（宿主忽略；装配测试使用）。
 */
export declare function apply(ctx: Context, config?: unknown): OpenDesignBundle;
//#endregion
export {};