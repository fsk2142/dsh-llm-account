import { a as AccountView, c as QuotaPort, i as AccountPort, l as VendorCapabilities, n as RotationAccess, o as CredentialPort, r as IntentLog, s as LoginPort, t as PluginConfigSchema } from "./assembly-DJDU9XGc.js";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { Context } from "@deepseek-ai/cordis";
//#region src/vendors/commandcode/login.d.ts
/** 登录端口 + 状态查询里需要的只读事实。 */
type CommandCodeLogin = LoginPort & {
  /** 等待授权时的授权网址；其余状态下为 `undefined`。 */
  readonly authUrl?: string;
  /** 本次实例实际使用的起始端口（`deps.startPort` 覆盖后）。 */
  readonly startPortDefault: number;
  /** 本次实例实际使用的候选端口个数（`deps.portAttempts` 覆盖后）。 */
  readonly portAttemptsDefault: number;
};
//#endregion
//#region src/vendors/commandcode/index.d.ts
/** 插件名（fiber 名与日志前缀；行 id 由 patch 层给定，两者同名）。 */
export declare const name = "llm-commandcode";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export declare const inject: string[];
/** provider 路由 id（全局约束，不得更改）。 */
export declare const PROVIDER_ID = "commandcode";
/**
 * 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入），
 * 只有 `apiKey` 例外 —— 它是组合配置里的非持久化秘密字面量，没有任何设置界面写它。
 *
 * 声明的是**用户现有的字段名**（旧插件 Config schema 第 10044-10083 行的子集）：
 * `apiKeyEnv` / `accounts` / `activeAccount` / `modelAccountRules` / `credentialCleanupRefs`
 * 是账号文档，其余是路由连接事实。旧插件里本期的非目标字段（`webSearch`、`zdr`、
 * `filterModelsByPlan`、`modelsCachePath`、`accountEnrollmentTasks` 等）没有声明：
 * schemastery 的 object 解析会把未声明字段原样带过，所以它们仍然留在文档里，只是本期
 * 不读也不改（第 2/3 期再接）。
 *
 * 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery 的
 * 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）；入口
 * 本来就把配置读成 `Record<string, unknown>`，这个注解只影响声明文件，不影响运行时的
 * schema 对象。
 */
export declare const Config: PluginConfigSchema;
/** 一行的装配产物。宿主忽略 `apply` 的返回值；它存在是为了装配测试与计划 1b 取用。 */
export interface CommandCodeBundle {
  readonly providerId: string;
  readonly settingsNs: string;
  /** 注册到宿主路由的适配器实例。 */
  readonly adapter: LlmAdapter;
  /** 能力声明（规格 §7.3）：宿主公开这套声明，页面据此降级。 */
  readonly capabilities: VendorCapabilities;
  /** 轮换引擎读取口（账号库状态变了就换引擎）。 */
  readonly rotation: RotationAccess;
  /** 该设置命名空间唯一的意图日志。 */
  readonly intents: IntentLog;
  readonly accounts: AccountPort;
  readonly credentials: CredentialPort;
  readonly quota: QuotaPort;
  /** 网页登录端口：本期只构造（远程暴露与页面在计划 1b）。 */
  readonly login: CommandCodeLogin;
}
/**
 * 装一行 Command Code。
 *
 * 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
 * @param ctx - 宿主插件上下文。
 * @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
 * @returns 装配产物（宿主忽略；装配测试与 1b 使用）。
 */
export declare function apply(ctx: Context, config?: unknown): CommandCodeBundle;
/**
 * 登录落库前判定：这个 ref 是否已经被**另一个**账号占用？
 *
 * 抽成导出函数是为了能被单测：它是「不得静默覆盖别人的凭据槽」（Task 5 Step 7）的判定本身，
 * 而它平时藏在一个闭包里、只有跑完整的浏览器登录流程才会执行到。
 * @param views - 当前账号表（`AccountPort.list()` 的视图，含合成的默认槽）。
 * @param ref - 登录将要写入的凭据槽。
 * @param userName - 登录返回的用户名。
 * @returns 占用者；空闲、或占用者就是同一账号时为 `undefined`。
 */
export declare function loginSlotHolder(views: readonly AccountView[], ref: string, userName: string): AccountView | undefined;
//#endregion
export {};