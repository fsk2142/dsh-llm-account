/**
 * Open Design 入口：一行装配（施工单 §2.8，逐句对照 `opencode/index.ts` 的顺序）。
 *
 * 厂商事实与命名见 `docs/superpowers/notes/2026-10-18-opendesign-plan.md`：推理走
 * `amr-link.open-design.ai`（OpenAI Chat Completions，runtime key），额度/账单走
 * `amr-api.open-design.ai`（control key），周期额度（Coding Plan）走本机 `vela`。
 *
 * 与另两行的同构差异（都来自厂商事实，不是偏好）：
 * - **两把密钥**：账号条目有 `apiKeyEnv`（推理）与可选的 `controlKeyEnv`（额度面）；
 *   控制面槽缺省时派生为 `<ref>_CONTROL`（默认账号是 `OPENDESIGN_CONTROL_KEY`）。
 *   `quota` 的密钥解析因此多走一层 {@link opendesignControlRef}。
 * - **工作区**：账号条目（或顶层）的 `workspaceId` 是 vela 周期额度的查询参数；
 *   没配就不查，也不记失败（`./quota` 的约定）。
 * - **网页登录 = 设备授权**：由官方 `vela login` 完成（`./login`），成功产物
 *   `~/.amr/config.json` 只读导入；找不到 vela 时给 `vela-missing` 的人话原因。
 *
 * `enabled` 门与 `loader/volatile-update` 重判、`session/event` 的回合结束门控、
 * `credentials/reference-updated` 的拒绝记忆清除、`applyUsageRemote` 的远程面发布与
 * `disableSettingsAutoForm` 都与另两行同一套（装配顺序逐句对照 opencode）。
 * @module dsh-llm-account/src/vendors/opendesign/index
 */
import { spawn } from "node:child_process";
import type { Context } from "@deepseek-ai/cordis";
import type { AdapterRegistrationHandle, LlmAdapter } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

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

import type { AccountState, CredentialPort, ModelRule, QuotaPort, VendorCapabilities } from "../../core/adapter";
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
import { createOpenDesignAdapter } from "./adapter";
import type { OpenDesignAdapterDeps, OpenDesignConfig } from "./adapter";
import {
  OPENDESIGN_DEFAULT_REF,
  OPENDESIGN_SETTINGS_NS,
  createOpenDesignAccounts,
  opendesignAccountSlot,
  opendesignControlRef,
  opendesignWorkspaceId,
} from "./accounts";
import type { OpenDesignAccounts } from "./accounts";
import { DEFAULT_BASE_URL } from "./protocol";
import { DEFAULT_WALLET_BASE_URL, createOpenDesignQuota } from "./quota";
import { applyUsageRemote } from "../usage-remote";
import { createUsagePort, localSpendBetween } from "../usage-store";
import { modelCandidates, registerCatalogSource } from "../model-catalog-registry";
import { SwitchingController } from "../switching";
import { VELA_PREFLIGHT_TIMEOUT_MS, createOpenDesignLogin, discoverWorkspaceId, findVelaBinary } from "./login";

/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opendesign`）。 */
export const name = "llm-opendesign";

/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export const inject = ["llm"];

/** provider 路由 id（施工单 §1，全局约束，不得更改）。 */
export const PROVIDER_ID = "opendesign";

/** 意图日志在设置文档里的隐藏字段（与另两行同一个字段名）。 */
const INTENTS_FIELD = "accountIntents";

/**
 * 设置行候选名（按优先级）：现代宿主按 profile 行 id 建索引，旧宿主用插件自报的命名空间。
 * 行 id 必须排在前面（命中它就说明用户 patch 的那一行正在给本插件供配置）。
 */
const SETTINGS_ROWS: SettingsRowIds = ["opendesign", OPENDESIGN_SETTINGS_NS];

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
export const Config: PluginConfigSchema = z.object(
  markVolatileFields({
    /** `false` 撤下本行的 provider 路由（行仍然挂载、其余产物照旧构造）。 */
    enabled: z.boolean().default(true),
    modelVisibility: z.dict(z.boolean().required()).default({}),
    visibleModels: z.array(z.string()),
    removedModels: z.array(z.string()),
    modelAccountRules: z.array(z.object({ models: z.array(z.string()), account: z.string() })),
    /** 顶层**推理**密钥引用（当前账号）。 */
    apiKeyEnv: z.string().role("credential-ref").default(OPENDESIGN_DEFAULT_REF),
    // 条目形状：`id` / `name` / `apiKeyEnv` 必填，`controlKeyEnv` 与 `workspaceId` 可选。
    // 不写死的上限：账号数上限由账号端口在写入路径上拒绝（`MAX_ACCOUNTS`），schema
    // 拒绝存量文档会让整行起不来。
    accounts: z
      .union([
        z.const(null),
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            apiKeyEnv: z.string().role("credential-ref"),
            controlKeyEnv: z.string().role("credential-ref"),
            workspaceId: z.string(),
          }),
        ),
      ])
      .default(null),
    /** 手动排序覆盖；缺省时沿用派生顺序（顶层 `apiKeyEnv` + `accounts[]`）。 */
    accountOrder: z.array(z.string()),
    autoSwitch: z.boolean().default(false),
    /** 切换策略：手动顺序（只在耗尽时切）或额度优先。 */
    switchStrategy: z.union(["order", "best-quota", "scheduled"]).default("best-quota"),
    /** 额度优先模式的评估间隔（分钟）；`0` 表示只在当前耗尽时评估。 */
    switchIntervalMinutes: z.number().default(60),
    /** 是否等回合结束再切（默认 `true`，任务进行中不换号）。 */
    switchAtTurnEnd: z.boolean().default(true),
    /**
     * 侧边栏额度卡片开关（规格 §8.1：**默认关闭，关闭时不后台刷新**）。
     * 与另两行同一个字段名、同一个默认值（页面按厂商声明渲染同一个开关）。
     */
    showSidebarQuota: z.boolean().default(false),
    /** 侧边栏额度卡片的刷新间隔（分钟）；缺省 1、下限 1、上限 120（与另两行同一档）。 */
    quotaRefreshMinutes: z.number().step(1).min(1).max(120).default(1),
      /**
       * **额度用尽后是否自动切换模型**（用户 2026-10-19：默认关闭）。
       *
       * 关着时：账号全被限额拒绝就直接报错，不替用户换模型。
       * 打开后按四级优先（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名）随机挑一个，
       * 且**只在该账号已勾选的模型里**。
       */
      autoSwitchModelOnQuota: z.boolean().default(false),
      // 自动继续 / 功能页 / 搜索：**全局**设置，三家 schema 都声明，谁先加载都读到同一个值。
      autoContinueOnError: z.boolean().default(false),
      autoContinueOnTruncate: z.boolean().default(false),
      autoContinueMaxAttempts: z.number().default(3),
      featureSwitchEnabled: z.boolean().default(true),
      featureSearchEnabled: z.boolean().default(true),
      searchPreferGateway: z.boolean().default(true),
      searchApiKeyEnv: z.string().role("credential-ref").default("DEEPSEEK_API_KEY"),
    /** 顶层工作区（账号条目没配 `workspaceId` 时的回退；vela 周期额度用）。 */
    workspaceId: z.string().default(""),
    /** 推理网关基地址（Chat Completions）。 */
    baseURL: z.string().default(DEFAULT_BASE_URL),
    /** 额度/账单基地址（控制面）。 */
    walletBase: z.string().default(DEFAULT_WALLET_BASE_URL),
    requestTimeoutMs: z.number(),
    streamIdleTimeoutMs: z.number(),
    /**
     * 待清理凭据引用数组。删除账号只**记录**待清理的 ref（推理槽 + 控制面槽），
     * 真正 `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
     */
    credentialCleanupRefs: z.array(z.string().role("credential-ref")),
    // 意图日志的持久化字段：内容是恢复状态，对 schema 不透明（`z.any()` 只做「是数组」
    // 这一层校验，逐条收窄在 `createSettingsIntentStore` 里做）。
    accountIntents: z.array(z.any()).hidden(),
  }),
);

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
export function apply(ctx: Context, config?: unknown): OpenDesignBundle {
  const parsed = parseConfig(config);
  const document = (): Record<string, unknown> => unwrapVolatileConfig(parsed);
  const warn = (message: string): void => {
    ctx.logger.warn(message);
  };

  const settings = createSettingsPort(ctx, OPENDESIGN_SETTINGS_NS, SETTINGS_ROWS);
  const credentials = createCredentialsPort(ctx);
  const intents = intentLogFor(
    OPENDESIGN_SETTINGS_NS,
    createSettingsIntentStore(settings, OPENDESIGN_SETTINGS_NS, INTENTS_FIELD, warn),
  );
  const accounts = createOpenDesignAccounts({ settings, credentials, intents });
  const rotation = createRotationAccess(() => accountStateOf(document()));

  /**
   * 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
   * 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
   *
   * `quotaShape: "windows"`：本行的窗口带 `used`/`cap`（美元或百分比口径，`./quota`）；
   * `modelVisibilityWrite: "onSave"`：模型勾选经设置保存落库（与 commandcode 同一档）。
   */
  const capabilities: VendorCapabilities = {
    reorder: true,
    // 顶层 `apiKeyEnv` 就是「当前账号」（`select` 写它），与 commandcode 的固定账号同义。
    pin: true,
    browserLogin: true,
    modelAccountRules: true,
    quotaShape: "windows",
    modelVisibilityWrite: "onSave",
    automaticSwitch: true,
  };

  /** 工作区发现的失败重试间隔（毫秒）：成功永久缓存，失败一分钟内不再问 vela。 */
  const WORKSPACE_DISCOVERY_RETRY_MS = 60_000;
  /**
   * 进程内的「发现到的工作区」缓存。
   *
   * 网页登录的产物**不带工作区**（本机实测 `~/.amr/config.json` 只有两把密钥与 user），
   * 而周期额度必须有它。所以读额度时缺省就问一次 `vela team-projects list`；成功一次就写回
   * 顶层设置并常驻，失败只缓存一分钟（用户可能刚装好 vela）。
   */
  let discoveredWorkspace: { value: string | undefined; at: number } | undefined;

  /**
   * 取某账号的工作区：条目/顶层设置优先，缺省时用 vela 兜底发现并写回。
   * @param candidate - 账号 ref。
   * @returns 工作区 id，或 `undefined`（本机没有 vela / 没登录）。
   */
  const workspaceFor = async (candidate: string): Promise<string | undefined> => {
    const stored = opendesignWorkspaceId(document(), candidate);
    if (stored !== undefined) return stored;
    if (discoveredWorkspace?.value !== undefined) return discoveredWorkspace.value;
    if (discoveredWorkspace !== undefined && Date.now() - discoveredWorkspace.at < WORKSPACE_DISCOVERY_RETRY_MS) {
      return undefined;
    }
    const found = await discoverWorkspaceId();
    discoveredWorkspace = { value: found, at: Date.now() };
    // 写回顶层：下一次读（含重启后）不必再问 vela；`fillTopLevelWorkspace` 只补空、不覆盖。
    if (found !== undefined) await fillTopLevelWorkspace(found);
    return found;
  };

  /** 额度端口：每次读数都用当时的配置；`snapshot(ref)` 可读指定账号（切换策略用）。 */
  const quota: QuotaPort = {
    async snapshot(accountRef?: string) {
      const walletBase = normalizeKey(document().walletBase) ?? DEFAULT_WALLET_BASE_URL;
      const ref = accountRef ?? selectedRefOf(document());
      return createOpenDesignQuota({
        ref: () => ref,
        // 控制面密钥：账号声明的槽优先，缺省派生（`<ref>_CONTROL`）；凭据库 → 启动环境。
        // **没有再退回推理密钥**：Open Design 的手动添加只收一把 API key（表单没有控制面字段，
        // 用户也很难拿到第二把），账单/余额与推理是同一个 Bearer —— 没有独立控制面密钥时
        // 用推理密钥试一次，比直接报「账号没配全」有用得多；真被拒了，失败项会说明是账单接口
        // 读不到，用户仍可走网页登录（那条路径会同时导入两把密钥与工作区）。
        resolveControlKey: async (candidate) => {
          const control = await resolveAccountKey(ctx, credentials, opendesignControlRef(document(), candidate));
          if (control !== undefined) return control;
          return resolveAccountKey(ctx, credentials, candidate);
        },
        workspaceIdOf: (candidate) => workspaceFor(candidate),
        fetchImpl: fetch,
        // 控制面 403 时的第二来源：本机 vela 的登录态（真机实测：HTTP 被拒、CLI 能读）。
        summaryFallback: velaSummary,
        walletBase,
        preflight: velaPreflight,
        // 月度用量：这家厂商的接口不给（订阅走 credit 窗口，钱包消耗恒 0），问本机台账 ——
        // 界面会标成「仅本机」（用户 2026-10-19 的两个要求：月度要有数字 + 只统计本机）。
        localSpend: (from, to) => localSpendBetween({ vendor: "opendesign", account: ref ?? "", from, to }),
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

  /**
   * 把发现到的工作区补进**顶层**字段（账号条目，读不到时才写这里）。
   *
   * 只补空：用户已经填过（顶层或条目里）就不动 —— 覆盖别人显式配好的值比缺一个 id 更糟。
   * 失败只记一条警告：这是登录收尾的附加动作，失败不该把登录判成失败。
   * @param workspaceId - 发现到的工作区 id。
   */
  const fillTopLevelWorkspace = async (workspaceId: string): Promise<void> => {
    if (normalizeKey(document().workspaceId) !== undefined) return;
    try {
      const snapshot = await settings.describe(OPENDESIGN_SETTINGS_NS);
      const stored = snapshot.value.workspaceId;
      if (typeof stored === "string" && stored.trim() !== "") return;
      await settings.mutate(
        OPENDESIGN_SETTINGS_NS,
        [{ op: "set", path: ["workspaceId"], value: workspaceId }],
        snapshot.revision,
      );
    } catch (error) {
      warn(
        `dsh-llm-account: could not store the discovered Open Design workspace id (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  };

  // 网页登录：vela 设备授权。成功后把 profile 里的三样东西交给装配层落库
  // （同 ref/同标签换密钥，否则新增账号；控制面密钥与工作区跟着新条目走）。
  const login = createOpenDesignLogin({
    storeKey: async (input) => {
      // 登录产物通常只有两把密钥、**没有工作区**（本机实测）。没有工作区就没有周期额度，
      // 所以这里问一次 vela（`team-projects list`）兜底；问不到就照旧按缺省处理。
      const workspaceId = input.workspaceId ?? (await discoverWorkspaceId());
      const views = await accounts.list();
      const existing = views.find((view) => view.ref === input.ref) ?? views.find((view) => view.label === input.label);
      if (existing !== undefined) {
        // 同账号重新登录：刷新推理密钥；控制面密钥如果这次拿到了也一起刷新。
        await credentials.set(existing.ref, input.key);
        if (input.controlKey !== undefined) {
          await credentials.set(opendesignControlRef(document(), existing.ref), input.controlKey);
        }
        // 工作区没有端口方法可改，但顶层字段是现成的回退：条目没配时它就生效。
        if (workspaceId !== undefined) await fillTopLevelWorkspace(workspaceId);
        return;
      }
      await accounts.add({
        label: input.label,
        key: input.key,
        ...(input.controlKey === undefined ? {} : { controlKey: input.controlKey }),
        ...(workspaceId === undefined ? {} : { workspaceId }),
      });
    },
  });
  ctx.effect(
    () => () => {
      // 等待授权时卸载插件：后台轮询必须停掉，迟到的成功不能再写凭据。
      void login.cancel();
    },
    "dsh-llm-account: opendesign login port",
  );

  /**
   * **本期没有「备用账号提位」逻辑**（opencode 的 `promoteServed` 那套）。
   *
   * 原因：提位的判定在装配层，但触发点在适配器 —— 适配器要在一次成功流结束后报告
   * 「这次是哪个账号服务的」，而 `./adapter` 的 deps 没有这个回调（本期没实现）。
   * 硬要在这里做只能轮询状态，那是另一种复杂度和另一种时序；留给后续按 opencode 的
   * 同款改动一起补（适配器加一个可选 `promoteServed` 回调即可，装配层不动）。
   */
  const deps: OpenDesignAdapterDeps = {
    config: () => adapterConfigOf(document()),
    // 适配器按请求现取引擎：账号库一改，下一次请求就用新的顺序与固定账号。
    get rotation() {
      return rotation.current();
    },
    quota,
    accounts,
    fetchImpl: fetch,
    resolveStored: (ref) => credentials.resolve(ref),
    resolveEnvironment: (ref) => environmentValue(ctx, ref),
    beforeRequest: (input) => switching.beforeRequest(input),
    // 用量采集：三条 provider 行共用一本台账（见 `usage-store`）。
    usage: createUsagePort(),
    // 限额换模型（用户 2026-10-19）：候选来自跨厂商注册表（三家各自登记目录读口）。
    fallbackCandidates: () => modelCandidates(),
    // 自动切换模型白名单（用户 2026-10-19）：每次现读设置，改完即时生效。
    // 空数组 = 不限制（候选退回「模型选择器里开启的那些」）。
    // 额度用尽后是否自动换模型（用户 2026-10-19：**默认关闭**）。
    // 关着时账号全被限额拒绝就直接报错，不替用户换。
    autoSwitchModel: () => document()["autoSwitchModelOnQuota"] === true,
  };
  const adapter = createOpenDesignAdapter(deps);
  // 登记本家的目录读口：别的行换模型时要在这里找「同名模型」（见 model-catalog-registry）。
  registerCatalogSource({
    provider: "opendesign",
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
   * 用「释放 + 重新注册」而不是 `handle.replace([])`：与另两行同一形状，也让
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
      ctx.logger.info("llm-opendesign: disabled by configuration; the route and its models are withdrawn");
    }
  };

  applyRoute();
  // volatile 变更不重跑 `apply`，所以 `enabled` 的后续改写靠这个接缝重判（与另两行同一事件名）。
  ctx.on("loader/volatile-update", () => {
    applyRoute();
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
    "dsh-llm-account: opendesign provider route",
  );

  // Ruling 23：用户补上密钥后该账号必须能重新参与轮换（凭据引用名与账号 ref 同一套标识空间）。
  ctx.on("credentials/reference-updated", (ref) => {
    rotation.clearCredentialRejection(ref);
  });

  // 把生效账号 / 切换通知 / 每账号额度摘要发布成远程面（客户端页面与侧边栏卡片的数据源）。
  applyUsageRemote(ctx, {
    vendor: PROVIDER_ID,
    rotation,
    accounts,
    quota,
    pinnedRef: () => pinnedRefOf(document()),
    quotaRef: () => selectedRefOf(document()),
    capabilities,
    // 网页登录端口（设备授权）：账户卡片的登录入口经远程调用它。
    login,
    // 设置页的模型勾选：未过滤的完整目录。
    // 刷新按钮的落点：**必须 fresh**（绕过目录缓存）。TTL 内点刷新若拿缓存，
    // 界面上就是「点了没反应」（用户 2026-10-19 报障 opendesign 刷新不起作用）。
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
    setSwitchSettings: (input) => writeSwitchSettings(settings, OPENDESIGN_SETTINGS_NS, input),
    modelRules: () => modelRulesOf(document()),
    setAccountModels: (ref, models) =>
      writeModelRules(settings, OPENDESIGN_SETTINGS_NS, assignModelsToAccount(modelRulesOf(document()), ref, models)),
  });

  // 关掉宿主自动生成的设置表单，否则它会和统一页面并排出现（与另两行同一处置）。
  disableSettingsAutoForm(ctx, OPENDESIGN_SETTINGS_NS);

  return {
    providerId: PROVIDER_ID,
    settingsNs: OPENDESIGN_SETTINGS_NS,
    capabilities,
    adapter,
    rotation,
    intents,
    accounts,
    credentials,
    quota,
  };
}

/**
 * 解析入口收到的配置。
 *
 * 宿主交给 `apply` 的是**已解析**的 Config（volatile 引用就是解析产物），重复解析会把活引用
 * 当成普通值；程序化构造（装配测试）是普通值，必须自己过一遍 `Config`。
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
 * 只有一处改名：文档字段是 `baseURL`（用户文档里就是它），适配器接口叫 `apiBase`。
 * 模型可见性原样交给适配器（形状不可信，适配器自己收窄）。
 */
function adapterConfigOf(document: Record<string, unknown>): OpenDesignConfig {
  const baseURL = normalizeKey(document.baseURL);
  const apiBase = normalizeKey(document.apiBase);
  const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
  const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
  const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
  const modelVisibility = booleanMap(document.modelVisibility);
  const visibleModels = stringList(document.visibleModels);
  return {
    // `apiBase` 是本包自己的字段名（组合层可直接用）；用户文档里的 `baseURL` 优先于它。
    ...(apiBase === undefined ? {} : { apiBase }),
    ...(baseURL === undefined ? {} : { apiBase: baseURL }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs }),
    ...(defaultMaxTokens === undefined ? {} : { defaultMaxTokens }),
    ...(modelVisibility === undefined ? {} : { modelVisibility }),
    ...(visibleModels === undefined ? {} : { visibleModels }),
  };
}

/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
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

/** 账号库状态：顺序、按模型规则与固定账号（`autoSwitch: false` 时候选集只剩当前账号）。 */
function accountStateOf(document: Record<string, unknown>): AccountState {
  const slot = opendesignAccountSlot(document);
  return {
    order: document.autoSwitch === false ? [slot.ref] : orderOf(document),
    rules: modelRulesOf(document),
    pinned: slot.pinned,
  };
}

/** 顶层当前账号的 ref：`apiKeyEnv` 是合法引用名时就是它，否则是内置默认名。 */
function defaultRefOf(document: Record<string, unknown>): string {
  return opendesignAccountSlot(document).ref;
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
 * 顶层 `apiKeyEnv` **必须**进顺序：少了它，只配了顶层密钥的存量用户会让
 * `RotationEngine.pick` 返回 `undefined`，适配器直接报 MISSING_CREDENTIAL。
 */
function orderOf(document: Record<string, unknown>): string[] {
  const derived: string[] = [];
  const seen = new Set<string>();
  for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    derived.push(ref);
  }
  return globalOrderOfVendor(derived, document.accountOrder, PROVIDER_ID);
}

/**
 * 固定账号：顶层 `apiKeyEnv` 是合法引用名时就是它（`select` 写它，`move` 也把新队首写进去）；
 * 字段缺失/空串/非法引用名一律读作自动轮换（判定在账号端口里，两边同一份答案）。
 * @param document - 现读的设置文档。
 * @returns 固定账号的 ref，或 `null`（自动轮换）。
 */
function pinnedRefOf(document: Record<string, unknown>): string | null {
  return opendesignAccountSlot(document).pinned;
}

/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document: Record<string, unknown>): string | undefined {
  return pinnedRefOf(document) ?? orderOf(document)[0];
}

/**
 * 解析某个账号这一读要用的密钥：按 `stored → environment` 挑第一把。
 *
 * Open Design 没有 auth.json 兜底（设计 §4.2 的差异表）：密钥只来自凭据库或启动环境。
 * @param ctx - 插件上下文（读启动环境）。
 * @param credentials - 凭据端口。
 * @param ref - 目标账号的凭据引用名（调用方已把控制面槽解析好）。
 * @returns 可用的密钥，或 `undefined`。
 */
async function resolveAccountKey(ctx: Context, credentials: CredentialPort, ref: string): Promise<string | undefined> {
  const stored = await credentials.resolve(ref);
  if (stored !== undefined) return stored;
  return environmentValue(ctx, ref);
}

/**
 * vela 周期额度查询（Coding Plan）：`vela billing preflight --workspace-id <id> --format json`。
 *
 * 只在这个账号配了 `workspaceId` 时被调用（`./quota` 的门）；本机找不到 vela 时抛错，
 * 由额度端口记成一句人话失败 —— 用户配了工作区却查不到，必须让他知道原因，而不是
 * 静悄悄地少一个窗口。
 * @param workspaceId - 该账号的工作区 id。
 * @returns preflight 的 JSON 负载；输出不是对象时读作「没有数据」。
 */
async function velaPreflight(workspaceId: string): Promise<unknown> {
  // 工作区 id 来自设置/登录产物（用户可改）。它是命令行参数，`--`/空格这类值会被 vela 的
  // 参数解析器当成开关（参数注入）；只接受厂商实际使用的字符集，且不能以 `-` 开头
  // （否则 `--help` 也能过字符集）。
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(workspaceId)) {
    throw new Error("工作区 id 形状不对（只允许字母、数字、下划线与连字符，且不能以连字符开头）");
  }
  const vela = findVelaBinary();
  if (vela === undefined) {
    throw new Error("本机找不到 vela：安装 Open Design 桌面端，或设置 VELA_BIN 指向 vela 可执行文件");
  }
  const child = spawn(vela, ["billing", "preflight", "--workspace-id", workspaceId, "--format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const timer = setTimeout(() => {
    child.kill();
  }, VELA_PREFLIGHT_TIMEOUT_MS);
  try {
    const [stdout, code] = await Promise.all([readStream(child.stdout), waitForExit(child)]);
    if (code !== 0) throw new Error(`vela billing preflight 失败（退出码 ${code ?? "unknown"}）`);
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) ? parsed : undefined;
  } catch (error) {
    // 输出不是 JSON 时给一句准确的（JSON.parse 抛 SyntaxError，消息对用户没有意义）。
    if (error instanceof SyntaxError) throw new Error("vela billing preflight 的输出不是 JSON");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * vela 的账单摘要（`vela billing summary --format json`）：套餐、换算率与订阅周期。
 *
 * 为什么需要：控制面的 `GET /billing/summary` 在本机对 runtimeKey / controlKey 都回 403，
 * 而同一份数据 CLI 能拿到。没有这条回退，界面上的套餐行永远是空的（用户报障「套餐信息也没有」）。
 * 失败一律读作「没有数据」：这是**附加**来源，不能把额度读取整块拖垮。
 * @returns 摘要负载；找不到 vela / 非零退出 / 输出不是 JSON 时为 `undefined`。
 */
async function velaSummary(): Promise<unknown | undefined> {
  const vela = findVelaBinary();
  if (vela === undefined) return undefined;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(vela, ["billing", "summary", "--format", "json"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch {
    return undefined;
  }
  const timer = setTimeout(() => child.kill(), VELA_PREFLIGHT_TIMEOUT_MS);
  try {
    const [stdout, code] = await Promise.all([readStream(child.stdout), waitForExit(child)]);
    if (code !== 0) return undefined;
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** 读完一个输出流（`null` 流读作空串 —— 假 stdio 时可能没有管道）。 */
async function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** 等子进程退出；启动失败（`error` 事件）读作退出码 `null`。 */
function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
}
