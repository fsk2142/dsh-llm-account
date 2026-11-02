import { c as QuotaPort, i as AccountPort, l as VendorCapabilities, n as RotationAccess, o as CredentialPort, r as IntentLog, t as PluginConfigSchema } from "./assembly-B6om4u3r.js";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
//#region src/vendors/opencode/index.d.ts
/**
 * 宿主在 volatile 配置被改写后广播这次更新（两个旧插件用同一事件名重读配置：
 * `dsh-opencode-go/lib/index.js` 第 8686 行、`@mars-sea/dsh-commandcode-provider/lib/index.js`
 * 第 10410 行）。宿主**不会**为 volatile 变更重跑本插件的 `apply`（volatile 的意义就是
 * 「改完立即生效、不重挂载」），所以 `enabled` 的后续改写要靠这个接缝重判。
 *
 * 事件名在宿主侧（`dsh-loader`）发出，本次 typecheck 用的 `@deepseek-ai/cordis` 与
 * `@deepseek-ai/dsh-*` 都不声明它（本机没有 loader 包），所以这里按旧插件的做法自行补齐
 * 声明；签名逐字取自 `dsh-opencode-go/lib/types/index.d.ts` 第 37 行。
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
/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opencode-go`）。 */
export declare const name = "llm-opencode-go";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export declare const inject: string[];
/** provider 路由 id（全局约束，不得更改）。 */
export declare const PROVIDER_ID = "dsh-opencode-go";
/**
 * 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入），字段名逐条
 * 对齐用户现有的 profile config（旧插件 `src/config.ts` 第 6816-6852 行的子集）。
 *
 * 旧插件里本期的非目标字段（`proxyURL`、`refreshMinutes`、`protocolOverrides`、
 * `requestPreparationTimeoutMs`、图片预算、`accountOperations` 等）没有声明：schemastery 的
 * object 解析会把未声明字段原样带过，所以它们仍然留在文档里，只是本期不读也不改。
 * 侧边栏额度卡片的刷新间隔是本期新增的可配置项，对应本包的 `quotaRefreshMinutes`（与旧插件的
 * 目录缓存 `refreshMinutes` 是两回事：一个是用量轮询、一个是模型目录缓存，不要混用）。
 *
 * 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery 的
 * 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）；入口
 * 本来就把配置读成 `Record<string, unknown>`，这个注解只影响声明文件，不影响运行时的
 * schema 对象。
 */
export declare const Config: PluginConfigSchema;
/** 一行的装配产物。宿主忽略 `apply` 的返回值；它存在是为了装配测试与计划 1b 取用。 */
export interface OpencodeBundle {
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
  readonly accounts: AccountPort;
  readonly credentials: CredentialPort;
  readonly quota: QuotaPort;
}
/**
 * 装一行 OpenCode Go。
 *
 * 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
 * @param ctx - 宿主插件上下文。
 * @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
 * @returns 装配产物（宿主忽略；装配测试与 1b 使用）。
 */
export declare function apply(ctx: Context, config?: unknown): OpencodeBundle;
/**
 * 轮换顺序 = 顶层当前账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
 *
 * 顶层 `apiKeyEnv` **必须**进顺序：旧插件的 `accountsOf` 在顶层引用不在账号表里时，会把它
 * 当成 `legacy:<ref>` 补在**列表首位**；本函数是同一顺序的显式写法，账号端口的 `list()` 也会
 * 合成同一行。少了它，只配了顶层密钥的存量用户会让 `RotationEngine.pick` 返回 `undefined`，
 * 适配器直接报 MISSING_CREDENTIAL。
 *
 * ## 但**不能**凭空合成一个"幽灵账号"（2026-11-02 真机报障）
 *
 * 原来的写法是 `[defaultRefOf(document), ...accountRefsOf(document)]`。而
 * `defaultRefOf` 在顶层 `apiKeyEnv` **缺失**时会回退到内置默认名
 * {@link OPENCODE_DEFAULT_REF}（`OPENCODE_API_KEY`）。于是出现：
 *
 * ```
 * 账号表里有 Default（凭据真实存在）
 * 顶层 apiKeyEnv 缺失（或没写上）
 *   → 顺序 = [OPENCODE_API_KEY, DSH_OPENCODE_GO_ACCOUNT_DEFAULT_xxx]
 *   → pick() 先拿到 OPENCODE_API_KEY
 *   → 那个 ref 在凭据库里根本不存在
 *   → 适配器抛 “no API key for OpenCode Go account "OPENCODE_API_KEY"”
 * ```
 *
 * 真机现象就是：界面上账号显示「已配置」，但一发请求就报默认 ref 没密钥。
 *
 * 现在的规则：
 *
 * 1. 顶层 `apiKeyEnv` **是显式合法引用名** → 它排第一（保持旧行为，存量用户不变）；
 * 2. 顶层缺失/为空/非法，但账号表非空 → **只用账号表**，不合成默认槽；
 * 3. 两者都空 → 才退回默认槽（真正的"什么都没配"，报错信息才有意义）。
 */
/**
 * 轮换顺序（导出供测试直接验证，避免测试复刻一份逻辑）。
 *
 * @param document - 现读的设置文档。
 * @returns 按优先级排列的账号 ref。
 */
export declare function orderOf(document: Record<string, unknown>): string[];
//#endregion