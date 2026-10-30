/**
 * OpenCode Go 入口：一行装配（设计 §5.1）。
 *
 * **两个名字不同**：profile 行 id 固定为 `opencode-go`（用户现有 patch 的按 id 覆盖必须继续
 * 生效），而 `core` 侧固定的设置命名空间是 `llm-opencode-go`。现代宿主（0.2.x）的
 * `settings.describe()` 按**行 id** 建索引，所以设置端口按候选名单解析：先找行 id
 * `opencode-go`，再回落到 `llm-opencode-go`（旧插件的 `accountSettingsRow` 是同一顺序）。
 * 写路径一律用命中的行名 —— 写 `llm-opencode-go` 只会得到一个不存在的行。
 *
 * 一行 = 一个设置命名空间：`Config` 就是这一行的文档形状，`accounts` / `apiKeyEnv` /
 * `credentialCleanupRefs` / `autoSwitch` 就是用户 profile patch 里已有的字段，账号端口原样
 * 读写它（零迁移）。
 *
 * 装配产物：轮换引擎（顺序 = 顶层当前账号 + `accounts` 列表，固定 = 顶层 `apiKeyEnv`）、
 * 意图日志（隐藏字段 `accountIntents`，每个命名空间唯一一个实例）、账号端口（Task 13）、
 * 额度端口（Task 13），并按 `enabled` 决定是否注册路由
 * `ctx.llm.registerAdapter(["dsh-opencode-go"], adapter)`。
 *
 * **`enabled` 门**（旧插件 `applyRoute` 第 8613-8626 行 + `lib/types/index.d.ts` 第 18 行的
 * 文档「false withdraws the route; the plugin stays mounted」）：`false` 时不注册 provider 路由
 * （路由与它的模型目录都不上线），但这一行仍然挂载 —— 适配器、账号/额度端口、意图日志与
 * 凭据事件订阅照旧构造。用户现有的 profile 行就是 `enabled: false`，所以这个门必须在
 * **挂载时**就读，而不是等第一次改写。
 *
 * 本期**不**做：客户端页面与统一账号中心（1b）、真机安装与旧插件切换（1c）、客户端 bundle、
 * 第 2/3 期功能（用量胶囊、代理、协议覆盖、诊断导出等）。
 * @module dsh-llm-account/src/vendors/opencode/index
 */
import type { Context } from "@deepseek-ai/cordis";
import type { AdapterRegistrationHandle, LlmAdapter } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

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

import type { AccountPort, AccountState, CredentialPort, ModelRule, QuotaPort, VendorCapabilities } from "../../core/adapter";
import { assignModelsToAccount, CREDENTIAL_REF_PATTERN, globalOrderOfVendor } from "../../core/accounts";
import { normalizeKey } from "../../core/credentials";
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
import { createOpencodeAdapter } from "./adapter";
import type { OpencodeAdapterDeps, OpencodeConfig, OpencodeModelLimits } from "./adapter";
import {
  OPENCODE_DEFAULT_REF,
  OPENCODE_SETTINGS_NS,
  createOpencodeAccounts,
  opencodeAccountSlot,
} from "./accounts";
import { DEFAULT_BASE_URL } from "./protocol";
import { createOpencodeQuota } from "./quota";
import { applyUsageRemote } from "../usage-remote";
import { createUsagePort } from "../usage-store";
import { modelCandidates, registerCatalogSource } from "../model-catalog-registry";
import { SwitchingController } from "../switching";
import { createSearchSlotSync } from "../search-release";
import { createOpencodeLogin } from "./login";

/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opencode-go`）。 */
export const name = "llm-opencode-go";

/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export const inject = ["llm"];

/** provider 路由 id（全局约束，不得更改）。 */
export const PROVIDER_ID = "dsh-opencode-go";

/** 意图日志在设置文档里的隐藏字段（本项目自己的持久化字段，旧插件用的是 `accountOperations`）。 */
const INTENTS_FIELD = "accountIntents";

/**
 * 设置行候选名（按优先级）：现代宿主按 profile 行 id 建索引，旧宿主用插件自报的命名空间。
 * 行 id 必须排在前面 —— 命中它就说明用户现有 patch 的那一行正在给本插件供配置。
 */
const SETTINGS_ROWS: SettingsRowIds = ["opencode-go", OPENCODE_SETTINGS_NS];

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
export const Config: PluginConfigSchema = z.object(
  markVolatileFields({
    /** `false` 撤下本行的 provider 路由（行仍然挂载、其余产物照旧构造），见模块头。 */
    enabled: z.boolean().default(true),
    usageDisplay: z.union(["auto", "always", "off"]).default("auto"),
    modelVisibility: z.dict(z.boolean().required()).default({}),
    visibleModels: z.array(z.string()),
    removedModels: z.array(z.string()),
    modelAccountRules: z.array(z.object({ models: z.array(z.string()), account: z.string() })),
    apiKeyEnv: z.string().role("credential-ref").default(OPENCODE_DEFAULT_REF),
    // 条目按用户现有形状声明（`id` / `name` / `apiKeyEnv`）。不写死的上限：账号数上限由
    // 账号端口在写入路径上拒绝（`MAX_ACCOUNTS`），schema 拒绝存量文档会让整行起不来。
    accounts: z
      .union([
        z.const(null),
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            apiKeyEnv: z.string().role("credential-ref"),
          }),
        ),
      ])
      .default(null),
    /** 手动排序覆盖；缺省时沿用派生顺序（顶层 `apiKeyEnv` + `accounts[]`）。 */
    accountOrder: z.array(z.string()),
    /**
     * 自动切换开关：关闭后轮换只试当前账号（固定账号；未固定时是顶层默认账号）。
     *
     * **默认 `false`**，与 Command Code 的 `true` 不同 —— Command Code 那边是为了让
     * 旧插件的既有用户零迁移（它一直允许额度耗尽时回落）。本网关没有那个历史包袱，
     * 按「危险能力默认关」的原则留给用户显式打开（与 `autoSwitchModelOnQuota`、
     * 两个自动继续开关同一条纪律）。
     */
    autoSwitch: z.boolean().default(false),
    /** 切换策略：手动顺序（只在耗尽时切）或额度优先。 */
    switchStrategy: z.union(["order", "best-quota", "scheduled"]).default("best-quota"),
    /** 额度优先模式的评估间隔（分钟）；`0` 表示只在当前耗尽时评估。 */
    switchIntervalMinutes: z.number().default(60),
    /** 是否等回合结束再切（默认 `true`，任务进行中不换号）。 */
    switchAtTurnEnd: z.boolean().default(true),
    /**
     * 侧边栏额度卡片开关（规格 §8.1 第 6 条：**默认关闭，关闭时不后台刷新**）。
     *
     * Ruling 34：命令码 Command Code 的 Config 里一直有这个字段，opencode 此前没有 —— 而页面按
     * 厂商声明渲染「集成与显示」里的这个开关，缺失会让这一家的开关写进宿主不认识的字段。
     * 补上它与 commandcode 对称（两个旧插件都有侧边栏卡片，且规格把该卡片当作跨厂商能力）。
     * 默认 `false`：存量文档不受影响，用户不开就不显示、也不轮询。
     */
    showSidebarQuota: z.boolean().default(false),
    /**
     * 侧边栏额度卡片的刷新间隔（分钟）。规格 §8.1 第 6 条只要求「关闭即静默」、没规定间隔，
     * 旧插件把固定 60s 写死；这里交给用户。缺省 1 分钟（与旧插件一致的体验），下限 1 分钟、
     * 上限 120 分钟（再长用量基本就是过期的，反而误导）。整数是因为 UI 用「分钟」步进输入框。
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
      // 自动继续 / 功能页 / 搜索：**全局**设置，三家 schema 都声明，谁先加载都读到同一个值。
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
      searchStrategy: z.union(["gateway-first", "api-first", "gateway-only", "api-only", "off"]).default("gateway-first"),
      searchApiKeyRefs: z.array(z.string().role("credential-ref")).default(["DEEPSEEK_API_KEY"]),
    baseURL: z.string().default(DEFAULT_BASE_URL),
    requestTimeoutMs: z.number(),
    streamIdleTimeoutMs: z.number(),
    modelLimits: z
      .dict(
        z.union([
          z.const(null),
          z.object({
            contextWindow: z.union([z.const(null), z.number()]),
            maxTokens: z.union([z.const(null), z.number()]),
            /** 推理档位预算属第 2 期：本期只原样保留，不参与请求构造。 */
            thinkingBudgets: z.union([z.const(null), z.array(z.number())]),
          }),
        ]),
      )
      .default({}),
    credentialCleanupRefs: z.array(z.string().role("credential-ref")),
    // 意图日志的持久化字段：内容是恢复状态，对 schema 不透明（`z.any()` 只做「是数组」这一层
    // 校验，逐条收窄在 `createSettingsIntentStore` 里做）。形状写死会让一次手改把整行配置
    // 判为非法、插件起不来。
    accountIntents: z.array(z.any()).hidden(),
  }),
);

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
export function apply(ctx: Context, config?: unknown): OpencodeBundle {
  const parsed = parseConfig(config);
  const document = (): Record<string, unknown> => unwrapVolatileConfig(parsed);
  const warn = (message: string): void => {
    ctx.logger.warn(message);
  };

  const settings = createSettingsPort(ctx, OPENCODE_SETTINGS_NS, SETTINGS_ROWS);
  const credentials = createCredentialsPort(ctx);
  const intents = intentLogFor(
    OPENCODE_SETTINGS_NS,
    createSettingsIntentStore(settings, OPENCODE_SETTINGS_NS, INTENTS_FIELD, warn),
  );
  const accounts = createOpencodeAccounts({ settings, credentials, intents });
  const rotation = createRotationAccess(() => accountStateOf(document()));

  /**
   * 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
   * 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
   */
  const capabilities: VendorCapabilities = {
    reorder: true,
    // OpenCode 的「当前账号」由 `select` 改写顶层 `apiKeyEnv`，没有独立的「固定」概念。
    pin: false,
    browserLogin: true,
    modelAccountRules: true,
    quotaShape: "percent",
    modelVisibilityWrite: "immediate",
    automaticSwitch: true,
  };

  /** 额度端口：每次读数都用当时的配置（`apiBase` 是构造参数，跟着现读的配置走）。 */
  const quota: QuotaPort = {
    async snapshot(accountRef?: string) {
      const apiBase = normalizeKey(document().baseURL) ?? DEFAULT_BASE_URL;
      const ref = accountRef ?? selectedRefOf(document());
      return createOpencodeQuota({
        ref: () => ref,
        resolveKey: (candidate) => resolveAccountKey(ctx, credentials, candidate),
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

  // 实验性网页登录：拿到 ocoauth1 blob 后写进账号表（同标签换密钥，否则新增账号）。
  const login = createOpencodeLogin({
    fetchImpl: fetch,
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
      // 等待授权时卸载插件：后台轮询必须停掉，迟到的成功不能再写凭据。
      void login.cancel();
    },
    "dsh-llm-account: opencode login port",
  );

  /**
   * 备用账号把请求服务完了：把它提成当前账号（旧插件 `GoAccountSelection.adopt` 的同一后果 ——
   * 「开始正常输出的备用账号会移至首位并成为当前账号」）。
   *
   * 策略都在这一层（适配器只报告「这次是备用账号服务的」，判定可单测）：
   * - 只在**显式** `autoSwitch: true` 时提位：关掉自动切换时顺序是用户的地盘，不擅自改；
   * - 已经是当前账号就什么都不做（省掉一次 describe + mutate 往返）；
   * - 按 ref 单飞：并发请求不会为同一账号排一串重复写入。
   *
   * 写入走账号端口的 `move(ref, 0)`：它自带修订围栏与冲突重试，并把顶层 `apiKeyEnv`
   * 跟到新队首 —— 「第一行 = 当前账号」的不变量由此保持，`list()` 的派生顺序也随之跟上。
   * 提位失败只留一行告警：一次成功的请求不该因为记不下功劳而变成失败，下次请求照常轮换。
   */
  const promoting = new Map<string, Promise<void>>();
  const promoteServedAccount = (ref: string): void => {
    const current = document();
    if (current.autoSwitch !== true) return;
    if (opencodeAccountSlot(current).ref === ref) return;
    if (promoting.has(ref)) return;
    // 端口类型上 `move` 是可选的（能力矩阵里有厂家不实现重排）；opencode 声明了
    // `reorder: true`，这里照旧防御一次，免得类型上的可选在运行时变成未定义调用。
    const move = accounts.move?.bind(accounts);
    if (move === undefined) return;
    const pending = move(ref, 0).then(
      () => undefined,
      (error: unknown) => {
        warn(`llm-opencode-go: could not make "${ref}" the current account (${String(error)})`);
      },
    );
    promoting.set(ref, pending);
    void pending.finally(() => {
      if (promoting.get(ref) === pending) promoting.delete(ref);
    });
  };

  const deps: OpencodeAdapterDeps = {
    config: () => adapterConfigOf(document()),
    // 适配器按请求现取引擎：账号库一改（含 `move` / `select` 改写的顶层 `apiKeyEnv`），
    // 下一次请求就用新的顺序与固定账号。
    get rotation() {
      return rotation.current();
    },
    quota,
    accounts,
    fetchImpl: fetch,
    resolveStored: (ref) => credentials.resolve(ref),
    resolveEnvironment: (ref) => environmentValue(ctx, ref),
    // 网页登录刷新后的 blob 回写原凭据槽；普通 API key 不受影响。
    persistStored: (ref, value) => credentials.set(ref, value),
    promoteServed: promoteServedAccount,
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
  const adapter = createOpencodeAdapter(deps);
  // 登记本家的目录读口：别的行换模型时要在这里找「同名模型」（见 model-catalog-registry）。
  registerCatalogSource({
    provider: "dsh-opencode-go",
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

  /**
   * 当前这次路由注册的句柄；`enabled: false` 时是 `undefined`（行仍然挂载）。
   *
   * 用「释放 + 重新注册」而不是 `handle.replace([])`：与旧插件 `applyRoute` 同一形状，也让
   * 撤下与 `ctx.effect` 的释放路径共用同一个句柄。
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
      ctx.logger.info("llm-opencode-go: disabled by configuration; the route and its models are withdrawn");
    }
  };

  applyRoute();
  // volatile 变更不重跑 `apply`，所以 `enabled` 的后续改写靠这个接缝重判（与旧插件同一事件名）。
  /**
   * 搜索槽位同步（2026-10-28 补）：三家 provider 行都触发，`createSearchSlotSync`
   * 内部合并同拍调用。手改 profile 只动本行的 `searchStrategy` 时也要能同步槽位。
   */
  const syncSearchSlot = createSearchSlotSync({
    settings,
    strategy: () => document()["searchStrategy"],
    warn,
  });

  ctx.on("loader/volatile-update", () => {
    applyRoute();
    void syncSearchSlot();
  });
  // 回合结束是「等任务结束后再切换」的门控。实测 0.2.1-rc.2：事件名 `session/event`，
  // 参数是 `(session, event)`，`event.type === "turn/end"`；类型里还没声明，故窄化后调用。
  (ctx.on as (event: string, listener: (...args: unknown[]) => void) => () => void)("session/event", (...args) =>
    switching.noteHostEvent(...args),
  );
  ctx.effect(
    () => () => {
      registration?.();
      registration = undefined;
    },
    "dsh-llm-account: opencode provider route",
  );

  // Ruling 23：用户补上密钥后该账号必须能重新参与轮换。宿主 0.2.0-rc.2 的
  // `credentials/reference-updated` 就是这个接缝（凭据引用名与账号 ref 同一套标识空间）。
  ctx.on("credentials/reference-updated", (ref) => {
    rotation.clearCredentialRejection(ref);
  });

  // Task 3：把生效账号 / 切换通知 / 每账号额度摘要发布成远程面（客户端页面与侧边栏卡片的数据源）。
  applyUsageRemote(ctx, {
    vendor: PROVIDER_ID,
    credentials,
    rotation,
    accounts,
    quota,
    pinnedRef: () => pinnedRefOf(document()),
    quotaRef: () => selectedRefOf(document()),
    capabilities,
    // 设置页的模型勾选：未过滤的完整目录。
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
    setSwitchSettings: (input) => writeSwitchSettings(settings, OPENCODE_SETTINGS_NS, input),
    modelRules: () => modelRulesOf(document()),
    setAccountModels: (ref, models) =>
      writeModelRules(settings, OPENCODE_SETTINGS_NS, assignModelsToAccount(modelRulesOf(document()), ref, models)),
    // 实验性设备码网页登录。
    login,
  });

  // Task 3：关掉宿主自动生成的设置表单，否则它会和统一页面并排出现（第 1a 期交接项）。
  disableSettingsAutoForm(ctx, OPENCODE_SETTINGS_NS);

  return { providerId: PROVIDER_ID, settingsNs: OPENCODE_SETTINGS_NS, capabilities, adapter, rotation, intents, accounts, credentials, quota };
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

/**
 * 入口配置 → 适配器配置。
 *
 * 只有一处改名：文档字段是 `baseURL`（旧插件的字段名，用户现有配置里就是它），适配器接口
 * 叫 `apiBase`。`modelLimits` 只搬适配器认识的两项（`thinkingBudgets` 属第 2 期）。
 */
function adapterConfigOf(document: Record<string, unknown>): OpencodeConfig {
  const baseURL = normalizeKey(document.baseURL);
  const apiBase = normalizeKey(document.apiBase);
  const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
  const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
  const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
  const catalogTtlMs = nonNegativeNumber(document.catalogTtlMs);
  const modelVisibility = booleanMap(document.modelVisibility);
  const visibleModels = stringList(document.visibleModels);
  const removedModels = stringList(document.removedModels);
  const modelLimits = modelLimitsOf(document.modelLimits);
  return {
    // `apiBase` 是本包自己的字段名（组合层可直接用）；用户文档里的 `baseURL` 优先于它。
    ...(apiBase === undefined ? {} : { apiBase }),
    ...(baseURL === undefined ? {} : { apiBase: baseURL }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs }),
    ...(defaultMaxTokens === undefined ? {} : { defaultMaxTokens }),
    ...(catalogTtlMs === undefined ? {} : { catalogTtlMs }),
    ...(modelVisibility === undefined ? {} : { modelVisibility }),
    ...(visibleModels === undefined ? {} : { visibleModels }),
    ...(removedModels === undefined ? {} : { removedModels }),
    ...(modelLimits === undefined ? {} : { modelLimits }),
  };
}

/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 读一个非负有限数（目录 TTL 允许 0 = 不缓存）。 */
function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 读一个字符串数组；非数组读作缺省，空数组保留（表示显式清空）。 */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
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

/** 读 `null | number`（`null` 与适配器接口同义：显式「用目录自报值」）。 */
function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读逐模型的上下文窗口/输出上限覆盖；没有一项可用时读作缺省（适配器用目录自报值）。 */
function modelLimitsOf(value: unknown): Record<string, OpencodeModelLimits> | undefined {
  if (!isRecord(value)) return undefined;
  const limits: Record<string, OpencodeModelLimits> = {};
  for (const [model, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const contextWindow = nullableNumber(entry.contextWindow);
    const maxTokens = nullableNumber(entry.maxTokens);
    if (contextWindow === undefined && maxTokens === undefined) continue;
    limits[model] = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    };
  }
  return Object.keys(limits).length === 0 ? undefined : limits;
}

/**
 * 账号库状态：顺序、按模型规则（opencode 不支持，恒为空）与固定账号。
 *
 * **`autoSwitch` 门**（旧插件第 7515 行的同一分支）：`autoSwitch: false` 时候选集只有当前
 * 账号 —— `autoSwitch ? [...new Set([preferred, ...accounts])] : [preferred]`。默认值就是
 * `false`（旧插件与我们的 Config 都是），所以「关掉自动切换」必须真的只试一个账号，否则一次
 * 额度拒绝就会把请求打到用户没允许的第二个账号上。只有**显式** `false` 才收窄：程序化构造的
 * 文档没有这个字段时保持完整的顺序（与旧插件 `readConfig` 拿到的归一化值同义）。
 */
/** 按模型分配规则；形状不可信时逐条收窄。 */
function modelRulesOf(document: Record<string, unknown>): ModelRule[] {
  const raw = document.modelAccountRules;
  if (!Array.isArray(raw)) return [];
  const rules: ModelRule[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const models = Array.isArray(item.models)
      ? item.models.filter((model): model is string => typeof model === "string" && model.trim() !== "")
      : undefined;
    const account = normalizeKey(item.account);
    if (models === undefined || models.length === 0 || account === undefined) continue;
    rules.push({ models, account });
  }
  return rules;
}

function accountStateOf(document: Record<string, unknown>): AccountState {
  const slot = opencodeAccountSlot(document);
  return {
    order: document.autoSwitch === false ? [slot.ref] : orderOf(document),
    rules: modelRulesOf(document),
    pinned: slot.pinned,
  };
}

/** 顶层当前账号的 ref：`apiKeyEnv` 是合法引用名时就是它，否则是内置默认名。 */
function defaultRefOf(document: Record<string, unknown>): string {
  return opencodeAccountSlot(document).ref;
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
 * 轮换顺序 = 顶层当前账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
 *
 * 顶层 `apiKeyEnv` **必须**进顺序：旧插件的 `accountsOf` 在顶层引用不在账号表里时，会把它
 * 当成 `legacy:<ref>` 补在**列表首位**；本函数是同一顺序的显式写法，账号端口的 `list()` 也会
 * 合成同一行。少了它，只配了顶层密钥的存量用户会让 `RotationEngine.pick` 返回 `undefined`，
 * 适配器直接报 MISSING_CREDENTIAL。
 */
function orderOf(document: Record<string, unknown>): string[] {
  const derived: string[] = [];
  const seen = new Set<string>();
  for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    derived.push(ref);
  }
  return globalOrderOfVendor(derived, document.accountOrder, "dsh-opencode-go");
}

/**
 * 固定账号：opencode 用顶层 `apiKeyEnv` 表示「当前账号」（`AccountPort.select` 写它，
 * `move` 也会把移动后的队首写进去），所以它就是引擎的固定账号；字段缺失/空串/非法引用名一律
 * 读作自动轮换。
 *
 * 判定本身在账号端口里（`opencodeAccountSlot`）：端口的 `list()`/`select()`/`remove()` 与这里
 * 必须对同一份文档给出同一个答案，否则又会出现「服务请求的账号没有行」那种裂缝。
 * @param document - 现读的设置文档。
 * @returns 固定账号的 ref，或 `null`（自动轮换）。
 */
function pinnedRefOf(document: Record<string, unknown>): string | null {
  return opencodeAccountSlot(document).pinned;
}

/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document: Record<string, unknown>): string | undefined {
  return pinnedRefOf(document) ?? orderOf(document)[0];
}

/**
 * 解析某个账号这一读要用的密钥：按 `stored → environment` 挑第一把（opencode 没有
 * auth.json 兜底，设计 §4.2 的差异表）。
 * @param ctx - 插件上下文（读启动环境）。
 * @param credentials - 凭据端口。
 * @param ref - 目标账号 ref。
 * @returns 可用的密钥，或 `undefined`。
 */
async function resolveAccountKey(ctx: Context, credentials: CredentialPort, ref: string): Promise<string | undefined> {
  const stored = await credentials.resolve(ref);
  if (stored !== undefined) return stored;
  return environmentValue(ctx, ref);
}
