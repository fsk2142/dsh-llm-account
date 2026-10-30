/**
 * Command Code 入口：一行装配（设计 §5.1；profile 行 id 与设置命名空间都是 `llm-commandcode`）。
 *
 * 宿主把这一行的 `config` 按本模块导出的 `Config` 解析后交给 {@link apply}；字段全部
 * volatile，所以每次读取都拿最新值（改完立即生效）。`Config` 同时是**账号文档**的形状：
 * `accounts` / `activeAccount` / `modelAccountRules` / `credentialCleanupRefs` 就是用户
 * profile patch 里已有的那些字段，账号端口经 `ctx.settings.describe/mutate` 原样读写它 ——
 * 用户现有的两行配置**一字不改**即可继续用（零迁移，设计 §5.1）。
 *
 * 装配产物：
 * - 轮换引擎（顺序 = 顶层默认账号 + `accounts` 列表，固定 = `activeAccount`，规则 =
 *   `modelAccountRules`，自动切换 = `autoSwitch`）—— 状态一变即重建，拒绝记忆随之搬迁；
 * - 意图日志（存储 = 设置文档的隐藏字段 `accountIntents`，**每个命名空间唯一一个实例**）；
 * - 账号端口（Task 10）、额度端口（Task 10）、登录端口（Task 11，本期只构造并挂在返回的
 *   装配产物上，远程暴露留给计划 1b）；
 * - `ctx.llm.registerAdapter(["commandcode"], adapter)` 注册路由。
 *
 * 本期**不**做：客户端页面与统一账号中心（1b）、真机安装与旧插件切换（1c）、客户端
 * bundle、第 2/3 期功能（额度卡片、套餐过滤、费用估算、联网搜索、ZDR、代理等）。
 * @module dsh-llm-account/src/vendors/commandcode/index
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type { AdapterRegistrationHandle, LlmAdapter } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

import type { AccountPort, AccountState, AccountView, CredentialPort, ModelRule, QuotaPort, VendorCapabilities } from "../../core/adapter";
import { assignModelsToAccount, CREDENTIAL_REF_PATTERN, globalOrderOfVendor } from "../../core/accounts";
import { normalizeKey, pickApiKey } from "../../core/credentials";
import type { IntentLog } from "../../core/recovery";
import {
  createCredentialsPort,
  createRotationAccess,
  createSettingsIntentStore,
  writeSwitchSettings,
  writeModelRules,
  createSettingsPort,
  disableSettingsAutoForm,
  environmentValue,
  intentLogFor,
  isParsedConfig,
  isRecord,
  markVolatileFields,
  unwrapVolatileConfig,
} from "../assembly";
import type { RotationAccess, PluginConfigSchema, SettingsRowIds } from "../assembly";
import {
  COMMAND_CODE_SETTINGS_NS,
  commandCodeAccountSlot,
  commandCodeDefaultRef,
  createCommandCodeAccounts,
  DEFAULT_API_KEY_ENV,
} from "./accounts";
import { createCommandCodeAdapter } from "./adapter";
import type { CommandCodeAdapterDeps, CommandCodeConfig } from "./adapter";
import { createCommandCodeLogin } from "./login";
import type { CommandCodeLogin } from "./login";
import { DEFAULT_API_BASE } from "./protocol";
import type { CommandCodeProtocol } from "./protocol";
import { createCommandCodeQuota } from "./quota";
import { applyUsageRemote } from "../usage-remote";
import { applyAutoContinue } from "../auto-continue";
import { applySearch } from "../search";
import { gatewayAccessOf } from "../gateway-access";
import { registerSearchProvider } from "../search-provider";
import { createSearchSlotSync } from "../search-release";
import { probeSearchKey } from "../search-api";
import { normalizeSearchKeyRefs } from "../../core/switching/search-keys";
import { createUsagePort } from "../usage-store";
import { modelCandidates, registerCatalogSource } from "../model-catalog-registry";
import { SwitchingController } from "../switching";

/** 插件名（fiber 名与日志前缀；行 id 由 patch 层给定，两者同名）。 */
export const name = "llm-commandcode";

/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export const inject = ["llm"];

/** provider 路由 id（全局约束，不得更改）。 */
export const PROVIDER_ID = "commandcode";

/** 意图日志在设置文档里的隐藏字段（本项目自己的持久化字段，旧插件没有）。 */
const INTENTS_FIELD = "accountIntents";

/** 设置行候选名：本行的行 id 与命名空间同名。 */
const SETTINGS_ROWS: SettingsRowIds = [COMMAND_CODE_SETTINGS_NS];

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
export const Config: PluginConfigSchema = z.object(
  markVolatileFields(
    {
      apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
      apiKey: z.string().role("secret"),
      apiBase: z.string(),
      workingDir: z.string(),
      protocol: z.union(["openai", "messages", "cli"]),
      /**
       * 是否注册这条 provider 路由。
       *
       * **三行对称**（2026-10-20 复审发现）：opencode 与 opendesign 早就有这个字段并据此
       * 决定是否 `registerAdapter`，唯独 commandcode 没有 —— 于是用户手改 profile 把它配成
       * `enabled: false` **不会生效**（另外两家会）。字段缺省读作启用；只有显式 `false` 才撤下。
       */
      enabled: z.boolean().default(true),
      requestTimeoutMs: z.number(),
      streamIdleTimeoutMs: z.number(),
      defaultMaxTokens: z.number(),
      visibleModels: z.array(z.string()),
      modelVisibility: z.dict(z.boolean()),
      removedModels: z.array(z.string()),
      showSidebarQuota: z.boolean().default(false),
      /**
       * 侧边栏额度卡片的刷新间隔（分钟），与 opencode 对称。缺省 1 分钟、上限 120 分钟，
       * 见 opencode 入口的同名字段说明。
       */
      quotaRefreshMinutes: z.number().step(1).min(1).max(120).default(1),
      /**
       * **额度用尽后是否自动切换模型**。
       *
       * 关着时：账号全被限额拒绝就直接报错，不替用户换模型。
       * 打开后按四级优先（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名）随机挑一个，
       * 且**只在该账号已勾选的模型里**。
       */
      autoSwitchModelOnQuota: z.boolean().default(false),
      /**
       * **自动继续**：会话非人为中断后自动接着跑。
       *
       * 两台开关都默认关闭：自动续写会改变对话内容、也可能烧额度，与
       * `autoSwitchModelOnQuota` 同一条「危险能力默认关」原则。
       *
       * 这些字段挂在**这一行**不是因为它属于 commandcode，而是因为功能页是跨厂商的，
       * 需要一个固定的承载行（详见设计文档 §4.2）。三家 schema 都声明它们，
       * 谁先加载都能读到同一个值。
       */
      // 自动重试（2026-10-29 合并）：一个总开关管两件事 —— 请求失败重试、输出截断续写。
      // 原来分成两个开关，界面上并排的复选框反而让人分不清该开哪个。
      autoContinue: z.boolean().default(false),
      /**
       * **旧字段**（v1.4.0 之前拆成两个开关），只为升级兼容保留。
       *
       * zod 的 `z.object` 默认**剥掉未知字段** —— 不在 schema 里声明，`document()`
       * 就读不到它们，兼容代码等于没写。所以这里必须显式声明。
       *
       * 这些字段**不给 default** —— 未提供时就是 `undefined`，与「用户关着」区分得开。
       *
       * 不显示在界面上（`settings-cards.ts` 的 `shared` 列表里没有它们），
       * 只在 `autoContinue` 缺失时作为回退依据：任一为 true 就当作开启。
       * 读侧见 `applyAutoContinue` 调用点的注释。
       */
      autoContinueOnError: z.boolean(),
      autoContinueOnTruncate: z.boolean(),
      autoContinueMaxAttempts: z.number().step(1).min(1).max(20).default(3),
      autoContinueIntervalMs: z.number().step(100).min(500).max(60000).default(2000),
      /** 功能页的两台开关：关掉只隐藏界面那一块，不影响已配置的能力。 */
      /** 搜索：是否优先用网关订阅额度（默认是；没有可用网关时回退 API key）。 */
      searchStrategy: z.union(["gateway-first", "api-first", "gateway-only", "api-only", "off"]).default("gateway-first"),
      /** 搜索用的 API key 凭据引用名（配在凭据服务里，不是明文）。 */
      searchApiKeyRefs: z.array(z.string().role("credential-ref")).default(["DEEPSEEK_API_KEY"]),
      accounts: z.array(
        z.object({
          label: z.string(),
          apiKeyEnv: z.string().role("credential-ref"),
          /** 旧插件允许的内联密钥；本包不读它（密钥只走凭据服务），但写回时原样保留。 */
          apiKey: z.string().role("secret"),
        }),
      ),
      activeAccount: z.string(),
      /** 手动排序覆盖；缺省时沿用派生顺序（顶层默认账号 + `accounts[]`）。 */
      accountOrder: z.array(z.string()),
      /**
       * 自动切换开关（设计 §6.4.5：`autoSwitch` 落库是两家共用的可靠性机制；2026-10-17 按
       * 交接文件 §4.2 的 C 项从 opencode 对齐过来）。关闭后轮换只试当前账号（固定账号；
       * 未固定时是顶层默认账号），门见 `accountStateOf`。
       *
       * 默认 `true`（与 opencode 的 `false` 不同）：旧插件一直允许额度耗尽时回落到备用账号，
       * 零迁移要求默认保持这个行为 —— 用户文档里没有这个字段时行为一字不变。
       */
      autoSwitch: z.boolean().default(true),
      /** 切换策略：手动顺序（只在耗尽时切）或额度优先。 */
      switchStrategy: z.union(["order", "best-quota", "scheduled"]).default("best-quota"),
      /** 额度优先模式的评估间隔（分钟）；`0` 表示只在当前耗尽时评估。 */
      switchIntervalMinutes: z.number().default(60),
      /** 是否等回合结束再切（默认 `true`，任务进行中不换号）。 */
      switchAtTurnEnd: z.boolean().default(true),
      modelAccountRules: z.array(z.object({ models: z.array(z.string()), account: z.string() })),
      credentialCleanupRefs: z.array(z.string().role("credential-ref")),
      // 意图日志的持久化字段：内容是恢复状态，对 schema 不透明（`z.any()` 只做「是数组」这一层
      // 校验，逐条收窄在 `createSettingsIntentStore` 里做）。形状写死会让一次手改把整行配置
      // 判为非法、插件起不来。
      accountIntents: z.array(z.any()).hidden(),
    },
    ["apiKey"],
  ),
);

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
export function apply(ctx: Context, config?: unknown): CommandCodeBundle {
  const parsed = parseConfig(config);
  const document = (): Record<string, unknown> => unwrapVolatileConfig(parsed);
  const warn = (message: string): void => {
    ctx.logger.warn(message);
  };
  const settingsPort = createSettingsPort(ctx, COMMAND_CODE_SETTINGS_NS, SETTINGS_ROWS);
  /**
   * 自动重试开关的**有效值**（2026-10-30 两度修：R04 → N01）。
   *
   * ## 为什么不能简单写 `a || b || c`
   *
   * v1.4.0 把 `autoContinueOnError` / `autoContinueOnTruncate` 合并成 `autoContinue`，
   * 旧 profile 里只有旧字段。若写成「新字段 === true || 旧字段 === true」，那么
   * **用户在新界面明确关掉之后**（`autoContinue: false`），残留的
   * `autoContinueOnError: true` 会把它重新打开 —— 表现为「关不掉」。
   *
   * ## 第一次修（R04）为什么没修好
   *
   * 当时想用 `apply` 收到的 `config` 判断「用户有没有写过 autoContinue」。但宿主
   * **先把这一行的 config 按 `Config` 解析、再交给 apply**（见本文件头部注释），
   * 所以 `isParsedConfig(config)` 恒为真 —— 那条分支于是放弃判断、退回旧字段，
   * 生产路径上等于没修。
   *
   * ## 正解：不看解析结果，看**持久文档**
   *
   * `ctx.settings.describe(ns).value` 是用户 profile 里的**原始文档**（未经本模块
   * schema 加工），只有它能区分「写了 false」与「根本没写」。所以：
   *
   * 1. 文档里**显式**有 `autoContinue` → 以它为准（这就是「关得掉」）；
   * 2. 文档里没有、但有旧字段为 `true` → 视为开启（旧用户不丢功能）；
   * 3. 都没有 → 用解析后的值（schema 默认 `false`）。
   *
   * ## 缓存必须跟着设置变（2026-10-30 二度修：A01）
   *
   * 第一版只在 `apply` 时读一次文档、之后一直用那份快照，于是：
   *
   * - 关 → 开：用户改了设置，但 `autoContinueEnabled()` 仍返回启动时的 `false`，
   *   监听器把控制权交给下游、**根本不重试**；
   * - 开 → 关：缓存还是 `true`，**关不掉**。
   *
   * 现在由 `loader/volatile-update` 触发重新读取，并用**递增序号**丢弃乱序响应
   * （先发的慢响应不能盖掉后发的快响应）。
   */
  let rawDocument: Record<string, unknown> | undefined;
  /** 已发出的读取序号；`describe` 返回时只有序号仍是最新的才写回。 */
  let rawDocumentSeq = 0;
  /**
   * 最近一次读取是否**失败**了（2026-10-30，按「偏安全」策略加）。
   *
   * 用户的选择：读不到最新设置时**临时关闭自动重试**，而不是沿用旧值。
   * 理由：开关是用户直接控制「要不要自动发请求」的东西 —— 他点了关闭就应该真的
   * 不重试。设置服务抖一下导致的重试暂停是可接受的代价，反过来（用户以为关了、
   * 实际还在重试）不可接受。
   */
  let rawDocumentFailed = false;
  /**
   * 重新读一次持久文档。
   *
   * **失败时标记 `rawDocumentFailed`**，由 `autoContinueEnabled()` 据此返回 `false`
   * （fail-closed）。下一次读取成功会清掉标记、恢复按文档判断。
   */
  const refreshRawDocument = (): void => {
    rawDocumentSeq += 1;
    const seq = rawDocumentSeq;
    void settingsPort
      .describe(COMMAND_CODE_SETTINGS_NS)
      .then((snapshot) => {
        // 乱序保护：期间又有更新的读取发出，就丢弃这次结果。
        if (seq !== rawDocumentSeq) return;
        rawDocument = snapshot.value;
        rawDocumentFailed = false;
      })
      .catch(() => {
        if (seq !== rawDocumentSeq) return;
        // 偏安全：读不到就当「用户可能关了」，不再自动重试。
        rawDocumentFailed = true;
      });
  };
  refreshRawDocument();
  /**
   * 自动重试开关的**有效值**。
   *
   * ## 失败策略：fail-closed（2026-10-30 按用户选择定）
   *
   * 读不到持久文档时**不重试**。开关决定的是「要不要自动发请求」，用户点了关闭就
   * 必须真的不重试 —— 宁可因一次读失败暂停重试，也不要在他以为关掉之后继续打。
   *
   * 读到之后恢复正常判断（下次 `volatile-update` 会重试读取）。
   * @returns 是否开启。
   */
  const autoContinueEnabled = (): boolean => {
    if (rawDocumentFailed) return false;
    const explicit = rawDocument === undefined ? undefined : Object.hasOwn(rawDocument, "autoContinue");
    if (explicit === true && rawDocument !== undefined) return rawDocument["autoContinue"] === true;
    const current = document();
    if (current["autoContinueOnError"] === true || current["autoContinueOnTruncate"] === true) return true;
    return current["autoContinue"] === true;
  };

  // 复用上面为「读原始文档」建的那个端口，不重复构造（避免两次 provider 注册）。
  const settings = settingsPort;
  const credentials = createCredentialsPort(ctx);
  const intents = intentLogFor(
    COMMAND_CODE_SETTINGS_NS,
    createSettingsIntentStore(settings, COMMAND_CODE_SETTINGS_NS, INTENTS_FIELD, warn),
  );
  const accounts = createCommandCodeAccounts({ settings, credentials, intents });
  const rotation = createRotationAccess(() => accountStateOf(document()));
  warnAboutActiveAccount(document(), warn);

  /**
   * 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
   * 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
   */
  const capabilities: VendorCapabilities = {
    reorder: true,
    pin: true,
    browserLogin: true,
    modelAccountRules: true,
    quotaShape: "windows",
    modelVisibilityWrite: "onSave",
    automaticSwitch: true,
  };

  /** 额度端口：每次读数都用当时的配置；`snapshot(ref)` 可读指定账号（切换策略用）。 */
  const quota: QuotaPort = {
    async snapshot(accountRef?: string) {
      const apiBase = normalizeKey(document().apiBase) ?? DEFAULT_API_BASE;
      const ref = accountRef ?? selectedRefOf(document());
      return createCommandCodeQuota({
        ref: () => ref,
        resolveKey: (candidate) => resolveAccountKey(ctx, document(), credentials, candidate),
        fetchImpl: fetch,
        apiBase,
      }).snapshot();
    },
  };

  const switching = new SwitchingController({
    accounts,
    quota,
    rotation,
    document,
    pinnedRef: () => pinnedRefOf(document()),
    warn,
  });

  const deps: CommandCodeAdapterDeps = {
    config: () => adapterConfigOf(document()),
    // 适配器按请求现取引擎：账号库一改，下一次请求就用新的顺序/固定/规则。
    get rotation() {
      return rotation.current();
    },
    quota,
    accounts,
    fetchImpl: fetch,
    resolveStored: (ref) => credentials.resolve(ref),
    resolveEnvironment: (ref) => environmentValue(ctx, ref),
    authFileFallback: authKeyFromAuthFile,
    beforeRequest: (input) => switching.beforeRequest(input),
    // 用量采集：三条 provider 行共用一本台账（见 `usage-store`）。
    usage: createUsagePort(),
    // 限额换模型：候选来自跨厂商注册表（三家各自登记目录读口）。
    fallbackCandidates: () => modelCandidates(),
    // 自动切换模型白名单：每次现读设置，改完即时生效。
    // 空数组 = 不限制（候选退回「模型选择器里开启的那些」）。
    // 额度用尽后是否自动换模型。
    // 关着时账号全被限额拒绝就直接报错，不替用户换。
    autoSwitchModel: () => document()["autoSwitchModelOnQuota"] === true,
    /**
     * 一次请求内最多试几个账号 —— 与 `autoContinueMaxAttempts` 共用同一个上限
     * （2026-10-30 统一）。原来适配器内是硬编码 16，与用户设的次数无关。
     */
    maxTried: () =>
      typeof document()["autoContinueMaxAttempts"] === "number"
        ? (document()["autoContinueMaxAttempts"] as number)
        : undefined,
  };
  const adapter = createCommandCodeAdapter(deps);
  // 登记本家的目录读口：别的行换模型时要在这里找「同名模型」（见 model-catalog-registry）。
  registerCatalogSource({
    provider: "commandcode",
    // 只回报**用户已允许的模型**（listModels 已按可见性过滤），并带上能力信息 ——
    // 换模型时「参数能力接近」要靠上下文窗口与档位数比较。
    //
    // 只含账号里已显示的模型，正是用户要的「从每个账号可选模型中随机切换」：没勾选的模型
    // 不会出现在候选里。
    models: () =>
      adapter.listModels(PROVIDER_ID).then(async (rows) =>
        Promise.all(
          rows.map(async (row) => {
            const meta = await adapter
              .resolveModel(PROVIDER_ID, row.id)
              .then((info) => ({
                ...(info.context?.contextWindow === undefined ? {} : { contextWindow: info.context.contextWindow }),
                ...(info.reasoning?.efforts === undefined ? {} : { effortCount: info.reasoning.efforts.length }),
              }))
              .catch(() => ({}) as { contextWindow?: number; effortCount?: number });
            return { id: row.id, ...meta };
          }),
        ),
      ),
    // 跨厂商换模型的执行入口：别家要换到这家时，由**这家的 adapter** 自己发请求
    // （宿主的路由是固定的，adapter 不能以别家身份发）。
    stream: (options) => adapter.stream(options as Parameters<typeof adapter.stream>[0]),
  });

  const login = createCommandCodeLogin({
    fetchImpl: fetch,
    // 登录端口的基地址是构造期参数：本期只构造，跟随 volatile 变更留给计划 1b 的远程页。
    apiBase: normalizeKey(document().apiBase) ?? DEFAULT_API_BASE,
    // Task 5 Step 7（第 1a 期交接项）：登录的 ref 由 userName 推导。统一账户面板里，
    // 网页登录既可能更新既有账号、也可能新增账号：同 ref/同标签就换密钥，否则 add 一个。
    // 同一账号的重新登录（名字相同）允许刷新密钥。
    storeKey: async (ref, key, userName) => {
      const views = await accounts.list();
      const existing = views.find((view) => view.ref === ref) ?? views.find((view) => view.label === userName);
      if (existing !== undefined) {
        await credentials.set(existing.ref, key);
        return;
      }
      await accounts.add({ label: userName, key });
    },
  });
  ctx.effect(
    () => () => {
      // 等待授权时卸载插件：回环服务器必须收掉（迟到的回调不再落库）。
      void login.cancel();
    },
    "dsh-llm-account: commandcode login port",
  );

  /**
   * 当前这条路由注册的句柄；`enabled: false` 时是 `undefined`（行仍然挂载）。
   *
   * 三行对称（2026-10-20 复审）：opencode / opendesign 早就是这个形状，commandcode 原先
   * **无条件注册** —— 用户把它配成 `enabled: false` 不会生效。用「释放 + 重新注册」而不是
   * `handle.replace([])`：与另两行同一形状，也让撤下与 `ctx.effect` 的释放路径共用句柄。
   */
  let registration: AdapterRegistrationHandle | undefined;
  /** 按**现读**的 `enabled` 校准路由：缺省（含非布尔值）读作启用，只有显式的 `false` 撤下。 */
  const applyRoute = (): void => {
    const enabled = document().enabled !== false;
    if (enabled && registration === undefined) {
      registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
    } else if (!enabled && registration !== undefined) {
      registration();
      registration = undefined;
    }
  };
  applyRoute();
  ctx.effect(() => () => {
    if (registration !== undefined) {
      registration();
      registration = undefined;
    }
  }, "dsh-llm-account: commandcode provider route");
  // volatile 变更不重跑 `apply`，所以 `enabled` 的后续改写靠这个接缝重判
  // （2026-10-20 补齐：opencode / opendesign 早有这条，唯独本行没有 ——
  //  后果是手改 profile 的 `enabled: false` 要重载宿主才生效）。
  /**
   * 搜索槽位同步：三家 provider 行**都**触发（2026-10-28 补），由
   * `createSearchSlotSync` 合并同拍调用（并发 mutate 同一条 `web` 行会撞乐观锁）。
   *
   * 为什么是三家而不是只挂这一行：手改 profile 只动 opencode / opendesign 的
   * `searchStrategy` 时，那两行的 `volatile-update` 也要能把槽位让出去 / 收回来。
   */
  const syncSearchSlot = createSearchSlotSync({
    settings,
    strategy: () => document()["searchStrategy"],
    warn,
  });

  ctx.on("loader/volatile-update", () => {
    applyRoute();
    /**
     * 设置变了 → 重读持久文档（2026-10-30 修 A01）。
     *
     * `autoContinueEnabled()` 要看「用户到底有没有显式写过 `autoContinue`」，而那个
     * 信息只在**持久文档**里。首次读取发生在 `apply`，之后如果不跟着设置变更重读，
     * 用户改完开关拿到的仍是启动时的快照 —— 表现就是「开了不生效 / 关不掉」。
     */
    refreshRawDocument();
    // 设定变了 → 如果搜索被关掉（或重新打开），把宿主 `web` 行的 `searchProvider`
    // 槽位让出 / 收回（见 `search-release.ts` 的完整理由）。不在每次启动做：只在
    // **用户动作**的瞬间改配置，因果关系清楚。
    void syncSearchSlot();
  });

  // 回合结束是「等任务结束后再切换」的门控。实测 0.2.1-rc.2：事件名 `session/event`，
  // 参数是 `(session, event)`，`event.type === "turn/end"`；类型里还没声明，故窄化后调用。
  (ctx.on as (event: string, listener: (...args: unknown[]) => void) => () => void)("session/event", (...args) =>
    switching.noteHostEvent(...args),
  );

  // Ruling 23：用户补上密钥后该账号必须能重新参与轮换。宿主 0.2.0-rc.2 的
  // `credentials/reference-updated` 就是这个接缝（凭据引用名与账号 ref 同一套标识空间）。
  ctx.on("credentials/reference-updated", (ref) => {
    rotation.clearCredentialRejection(ref);
  });

  // 自动继续：会话非人为中断后自动接着跑。
  //
  // 只在这一行注册一次就够 —— 设置是**全局**的（功能页是跨厂商的），而三家 schema 都声明了
  // 同一批字段，所以三个 provider 行里任意一行读到的都是同一份值。在这里注册可以避免
  // 同一次请求被三条链路各重试一遍（那会把重试次数放大三倍）。
  //
  // **两个监听器总是注册**，每次事件现读设置：开关关着就交棒（不重试），与「不注册」
  // 等价。这样运行时改开关/次数/间隔能立即生效 —— 快照做不到（`volatile-update`
  // 不会重跑 apply）。
  applyAutoContinue(
    ctx as unknown as { on(event: string, listener: (...args: unknown[]) => unknown): unknown },
    // 传**读取函数**而不是快照：`loader/volatile-update` 不会重跑 apply，
    // 快照会让「运行时改开关/次数/间隔」全部不生效（要重载宿主才行）。
    () => ({
      /**
       * **兼容旧字段**（2026-10-30，R04 修）：原来拆成 `autoContinueOnError` /
       * `autoContinueOnTruncate` 两个开关，v1.4.0 合并成 `autoContinue`。旧 profile 里
       * 没有新字段 → 升级后原本开着的自动重试会被静默关掉，所以旧字段仍要能开启。
       *
       * 但**显式关闭必须优先**：用户在新界面关掉之后，残留的旧字段不该把它重新打开。
       * 优先级与「缺失 vs 显式 false」的区分见上面 `autoContinueEnabled` 的注释。
       */
      enabled: autoContinueEnabled(),
      maxAttempts:
        typeof document()["autoContinueMaxAttempts"] === "number"
          ? (document()["autoContinueMaxAttempts"] as number)
          : 3,
      intervalMs:
        typeof document()["autoContinueIntervalMs"] === "number"
          ? (document()["autoContinueIntervalMs"] as number)
          : 2000,
    }),
  );

  // 统一搜索：网关订阅额度优先，没有则用 API key。
  //
  // 为什么在这里注册：搜索是**全局**能力（一台会话用一次），不需要三家各注册一份
  // —— 重复注册会撞宿主的 `WEB_DUPLICATE_PROVIDER`。
  //
  // 选路依据是**当前会话的路由**：宿主 `agents.currentInitiator()` 给出正在跑的 agent，
  // 它的 `session.requestContext()` 是最近一次 `request/context` 事件
  // （`{ provider, model, ... }`，实测确认有这两个字段）。
  applySearch(
    ctx as unknown as Parameters<typeof applySearch>[0],
    {
      // 搜索能力**总是启用**：2026-10-20 用户去掉了「开启网页搜索」界面开关
      // （卡片用箭头收起即可）。宿主没有 `web` 服务时 `applySearch` 会自行静默跳过。
      enabled: () => true,
      register: (webCtx) =>
        registerSearchProvider(webCtx, {
          fetchImpl: globalThis.fetch.bind(globalThis),
          sessionRoute: () => {
            // 读不到就返回空路由：选路会保守地退回 API key（不猜网关）。
            const agents = (ctx as unknown as { get?: (name: string) => unknown }).get?.("agents") as
              | { currentInitiator?: () => { session?: { requestContext?: () => unknown } } | undefined }
              | undefined;
            const context = agents?.currentInitiator?.()?.session?.requestContext?.();
            const record = typeof context === "object" && context !== null ? (context as Record<string, unknown>) : {};
            return {
              provider: typeof record.provider === "string" ? record.provider : undefined,
              model: typeof record.model === "string" ? record.model : undefined,
            };
          },
          strategy: () => {
            const value = document()["searchStrategy"];
            return typeof value === "string" && value !== "" ? value : "gateway-first";
          },
          // 网关访问走**跨行注册表**（`gateway-access`）：数据在 opendesign 行登记，
          // 不在本行。以前这里读本行的 `apiKeyEnv` / `apiBase`，等于拿着 commandcode 的
          // 密钥打 commandcode 的端点（实测 400）—— 2026-10-20 审计修掉。
          gatewayAccess: (provider) => gatewayAccessOf(provider),
          // 多 key：按用户填的顺序依次解析，解析不到的跳过（不算失败 —— 用户可能只填了一条）。
          resolveApiKeys: async () => {
            const refs = normalizeSearchKeyRefs(document()["searchApiKeyRefs"]);
            const out: { ref: string; key: string }[] = [];
            for (const ref of refs) {
              const key = await credentials.resolve(ref);
              if (key !== undefined) out.push({ ref, key });
            }
            return out;
          },
        }),
    },
  );

  // Task 3：把生效账号 / 切换通知 / 每账号额度摘要发布成远程面（客户端页面与侧边栏卡片的数据源）。
  applyUsageRemote(ctx, {
    vendor: PROVIDER_ID,
    credentials,
    // 密钥实测（搜索卡「测试」按钮 + 添加后自动验一次）。与 provider 共用同一份实现，
    // 保证「测试说的」与「搜索实际用的」永远一致。
    probeSearchKey: async (ref) => {
      const key = await credentials.resolve(ref);
      if (key === undefined) {
        return { state: "invalid" as const, reason: "凭据库里找不到这把密钥（可能已被删除）" };
      }
      return await probeSearchKey({ key, fetchImpl: fetch });
    },
    rotation,
    accounts,
    quota,
    pinnedRef: () => pinnedRefOf(document()),
    quotaRef: () => selectedRefOf(document()),
    capabilities,
    // 网页登录端口（Task 5）：账户卡片的登录入口经远程调用它。
    login,
    // 设置页的模型勾选：未过滤的完整目录（页面把目录 ∪ 已配置项一起渲染）。
    // 刷新按钮的落点：**必须 fresh**（绕过目录缓存）。TTL 内点刷新若拿缓存，
    // 界面上就是「点了没反应」。
    models: () => adapter.catalogModels(true),
    switchState: () => switching.snapshot(),
    switchNow: () => switching.switchNow(),
    accountOrder: () => {
      const order = document().accountOrder;
      return Array.isArray(order) ? order.filter((key): key is string => typeof key === "string") : [];
    },
    setAccountOrder: async (order) => {
      await accounts.setOrder?.(order);
    },
    setSwitchSettings: (input) => writeSwitchSettings(settings, COMMAND_CODE_SETTINGS_NS, input),
    modelRules: () => rulesOf(document()),
    setAccountModels: (ref, models) =>
      writeModelRules(settings, COMMAND_CODE_SETTINGS_NS, assignModelsToAccount(rulesOf(document()), ref, models)),
  });

  // Task 3：关掉宿主自动生成的设置表单，否则它会和统一页面并排出现（第 1a 期交接项）。
  disableSettingsAutoForm(ctx, COMMAND_CODE_SETTINGS_NS);

  return { providerId: PROVIDER_ID, settingsNs: COMMAND_CODE_SETTINGS_NS, capabilities, adapter, rotation, intents, accounts, credentials, quota, login };
}

/**
 * 解析入口收到的配置。
 *
 * 宿主交给 `apply` 的是**已解析**的 Config（volatile 引用就是解析产物），重复解析会把活引用
 * 当成普通值；程序化构造（装配测试、将来的远程页）是普通值，必须自己过一遍 `Config`。
 * @param config - `apply` 收到的原始配置。
 * @returns 字段表（可能是 volatile 引用，也可能是普通值）。
 */
function parseConfig(config: unknown): Record<string, unknown> {
  if (isParsedConfig(config)) return config;
  const parsed: unknown = Config(config as Parameters<typeof Config>[0]);
  return isRecord(parsed) ? parsed : {};
}

/** 入口配置 → 适配器配置：只搬适配器认识的字段。 */
function adapterConfigOf(document: Record<string, unknown>): CommandCodeConfig {
  const apiBase = normalizeKey(document.apiBase);
  const apiKey = normalizeKey(document.apiKey);
  const workingDir = normalizeKey(document.workingDir);
  const protocol = protocolOf(document.protocol);
  const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
  const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
  const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
  const visibleModels = stringList(document.visibleModels);
  const modelVisibility = booleanMap(document.modelVisibility);
  const removedModels = stringList(document.removedModels);
  return {
    ...(apiBase === undefined ? {} : { apiBase }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(workingDir === undefined ? {} : { workingDir }),
    ...(protocol === undefined ? {} : { protocol }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs }),
    ...(defaultMaxTokens === undefined ? {} : { defaultMaxTokens }),
    ...(visibleModels === undefined ? {} : { visibleModels }),
    ...(modelVisibility === undefined ? {} : { modelVisibility }),
    ...(removedModels === undefined ? {} : { removedModels }),
  };
}

/** 读线协议；认不出的值读作「按模型自动选择」。 */
function protocolOf(value: unknown): CommandCodeProtocol | undefined {
  return value === "openai" || value === "messages" || value === "cli" ? value : undefined;
}

/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 读一个字符串数组（丢掉非字符串与空白项）；非数组读作缺省。 */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** 读一个 id → 布尔 的映射；非对象读作缺省，一个合法项都没有时也读作缺省。 */
function booleanMap(value: unknown): Record<string, boolean> | undefined {
  if (!isRecord(value)) return undefined;
  const map: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value)) {
    if (typeof flag === "boolean") map[key] = flag;
  }
  return Object.keys(map).length === 0 ? undefined : map;
}

/**
 * 账号库状态：顺序、按模型规则与固定账号（`core` 的 `RotationEngine` 输入）。
 *
 * **`autoSwitch` 门**（设计 §6.4.5：落库的自动切换开关改为两家共用）：显式 `false` 时
 * 候选顺序收窄成**只当前账号** —— 固定账号；未固定时是轮换顺序的首项（顶层默认账号）——
 * 一次额度拒绝不会把请求打到用户没允许的第二个账号上（与 opencode 的门同义）。默认 `true`
 * 保持旧插件「额度耗尽总是回落」的行为；只有**显式** `false` 才收窄：程序化构造的文档
 * 没有这个字段时保持完整顺序（两侧都有测试锁死）。
 */
function accountStateOf(document: Record<string, unknown>): AccountState {
  const pinned = pinnedRefOf(document);
  return {
    order: document.autoSwitch === false ? [pinned ?? defaultRefOf(document)] : orderOf(document),
    rules: rulesOf(document),
    pinned,
  };
}

/** 顶层默认账号的 ref：`apiKeyEnv`；缺省或非法时回落到内置默认名（与账号端口同一份读法）。 */
function defaultRefOf(document: Record<string, unknown>): string {
  return commandCodeDefaultRef(document);
}

/** `accounts[].apiKeyEnv` 里合法的凭据引用名（合法名才可能是凭据槽；其余条目本期不支持）。 */
function accountRefsOf(document: Record<string, unknown>): string[] {
  const accounts = document.accounts;
  if (!Array.isArray(accounts)) return [];
  const refs: string[] = [];
  for (const item of accounts) {
    if (!isRecord(item)) continue;
    const ref = normalizeKey(item.apiKeyEnv);
    if (ref !== undefined && CREDENTIAL_REF_PATTERN.test(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * 轮换顺序 = 顶层默认账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
 *
 * 顶层 `apiKeyEnv` **必须**进顺序：旧插件把它渲染成第一个槽（Default / legacy），而
 * `AccountPort.list()` 在它缺席 `accounts[]` 时合成同一行；顺序里少了它，只配了顶层密钥的
 * 存量用户会让 `RotationEngine.pick` 返回 `undefined`，适配器直接报 MISSING_CREDENTIAL。
 */
function orderOf(document: Record<string, unknown>): string[] {
  const derived: string[] = [];
  const seen = new Set<string>();
  for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    derived.push(ref);
  }
  // 用户手动排序（`accountOrder`）优先于派生顺序；缺省/坏形状时原样返回派生顺序。
  return globalOrderOfVendor(derived, document.accountOrder, "commandcode");
}

/** 按模型绑定账号：只收形状完整的规则（模型列表非空、`account` 是合法 ref）。 */
function rulesOf(document: Record<string, unknown>): ModelRule[] {
  const raw = document.modelAccountRules;
  if (!Array.isArray(raw)) return [];
  const rules: ModelRule[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const models = stringList(item.models);
    const account = normalizeKey(item.account);
    if (models === undefined || models.length === 0 || account === undefined) continue;
    rules.push({ models, account });
  }
  return rules;
}

/**
 * 固定账号。`activeAccount` 是**旧的槽 id 空间**：`default`（顶层默认账号）、`auto`/空
 * （自动轮换），或者账号条目自己的 ref；认不出的值（旧插件的 `account-N` 内联密钥槽，
 * 本期不支持）读作自动轮换 —— 宁可轮换，也不能把请求指到一个不存在的凭据槽上。
 *
 * 判定本身在账号端口里（`commandCodeAccountSlot`）：端口的 `list()`/`select()`/`remove()` 与
 * 这里必须对同一份文档给出同一个答案，否则又会出现「服务请求的账号没有行」那种裂缝。
 * @param document - 现读的设置文档。
 * @returns 固定账号的 ref，或 `null`（自动轮换）。
 */
function pinnedRefOf(document: Record<string, unknown>): string | null {
  return commandCodeAccountSlot(document).pinned;
}

/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document: Record<string, unknown>): string | undefined {
  return pinnedRefOf(document) ?? orderOf(document)[0];
}

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
export function loginSlotHolder(
  views: readonly AccountView[],
  ref: string,
  userName: string,
): AccountView | undefined {
  const holder = views.find((view) => view.ref === ref);
  if (holder === undefined) return undefined;
  return sameAccountName(holder.label, userName) ? undefined : holder;
}

/**
 * 「这个名字属于同一个账号吗」：忽略大小写与首尾空白。
 *
 * 判定刻意**保守**：只有明显同名才允许覆盖凭据槽（同名 = 同一个 Command Code 账号的重新登录）；
 * 名字不同的都拒绝。拒绝的代价是用户手动处置一次；静默覆盖的代价是把别人的密钥冲掉，
 * 而密钥冲掉是找不回来的。
 * @param label - 账号表里那一行的展示名称。
 * @param userName - 登录流程返回的用户名。
 * @returns 是否视为同一账号。
 */
function sameAccountName(label: string, userName: string): boolean {
  return label.trim().toLowerCase() === userName.trim().toLowerCase();
}

/** 应用期诊断：认不出的 `activeAccount` 只在这里说一次（现读路径按自动轮换处理）。 */
function warnAboutActiveAccount(document: Record<string, unknown>, warn: (message: string) => void): void {
  const slot = commandCodeAccountSlot(document);
  if (!slot.invalid) return;
  warn(
    `llm-commandcode: activeAccount "${normalizeKey(document.activeAccount) ?? ""}" is not a credential reference; automatic rotation is used instead`,
  );
}

/**
 * 解析某个账号这一读要用的密钥：按 `literal → stored → environment → authFile` 挑第一把
 * （与适配器同一优先级；组合配置里的 `apiKey` 是路由级字面量，对每个账号都生效）。
 * @param ctx - 插件上下文（读启动环境）。
 * @param document - 现读的设置文档。
 * @param credentials - 凭据端口。
 * @param ref - 目标账号 ref。
 * @returns 可用的密钥，或 `undefined`。
 */
async function resolveAccountKey(
  ctx: Context,
  document: Record<string, unknown>,
  credentials: CredentialPort,
  ref: string,
): Promise<string | undefined> {
  const literal = normalizeKey(document.apiKey);
  const stored = await credentials.resolve(ref);
  const environment = environmentValue(ctx, ref);
  const authFile = await authKeyFromAuthFile();
  return pickApiKey({
    ...(literal === undefined ? {} : { literal }),
    ...(stored === undefined ? {} : { stored }),
    ...(environment === undefined ? {} : { environment }),
    ...(authFile === undefined ? {} : { authFile }),
  }).key;
}

/**
 * 只读兜底：官方 CLI 的 `~/.commandcode/auth.json`。
 *
 * 形状与旧插件 `resolveAuthFileApiKey` 第 5719-5737 行一致：先看顶层 `apiKey` /
 * `commandcode` 字符串，再看 `commandcode` / `command-code` 下的 `{ type }` 记录。任何
 * 读取或解析失败都读作「没有兜底」（文件不存在是常态），绝不因此让请求失败。
 * @returns 兜底密钥，或 `undefined`。
 */
async function authKeyFromAuthFile(): Promise<string | undefined> {
  try {
    const path = join(homedir(), ".commandcode", "auth.json");
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return undefined;
    return (
      normalizeKey(parsed.apiKey) ??
      normalizeKey(parsed.commandcode) ??
      recordKey(parsed.commandcode) ??
      recordKey(parsed["command-code"])
    );
  } catch {
    return undefined;
  }
}

/** 从 CLI 的嵌套凭据记录里取密钥（`type: "api"` 用 `key`，`oauth` 用 `access`）。 */
function recordKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const type = normalizeKey(value.type);
  if (type === "api") return normalizeKey(value.key);
  if (type === "oauth") return normalizeKey(value.access);
  return normalizeKey(value.key) ?? normalizeKey(value.access);
}
