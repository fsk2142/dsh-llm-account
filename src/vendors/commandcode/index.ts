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
 *   `modelAccountRules`）—— 状态一变即重建，拒绝记忆随之搬迁；
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
import type { LlmAdapter } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";

import type { AccountPort, AccountState, CredentialPort, ModelRule, QuotaPort } from "../../core/adapter";
import { normalizeKey, pickApiKey } from "../../core/credentials";
import type { IntentLog } from "../../core/recovery";
import {
  createCredentialsPort,
  createRotationAccess,
  createSettingsIntentStore,
  createSettingsPort,
  environmentValue,
  intentLogFor,
  isParsedConfig,
  isRecord,
  markVolatileFields,
  unwrapVolatileConfig,
} from "../assembly";
import type { RotationAccess, PluginConfigSchema, SettingsRowIds } from "../assembly";
import { ACTIVE_ACCOUNT_AUTO, COMMAND_CODE_SETTINGS_NS, createCommandCodeAccounts } from "./accounts";
import { createCommandCodeAdapter } from "./adapter";
import type { CommandCodeAdapterDeps, CommandCodeConfig } from "./adapter";
import { createCommandCodeLogin } from "./login";
import type { CommandCodeLogin } from "./login";
import { DEFAULT_API_BASE } from "./protocol";
import type { CommandCodeProtocol } from "./protocol";
import { createCommandCodeQuota } from "./quota";

/** 插件名（fiber 名与日志前缀；行 id 由 patch 层给定，两者同名）。 */
export const name = "llm-commandcode";

/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
export const inject = ["llm"];

/** provider 路由 id（全局约束，不得更改）。 */
export const PROVIDER_ID = "commandcode";

/** 顶层默认账号的凭据引用名（旧插件 `DEFAULT_API_KEY_ENV` 第 10030 行）。 */
const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";

/** 旧插件的「默认槽」id：`activeAccount: default` 指顶层 `apiKeyEnv` 那个账号。 */
const LEGACY_DEFAULT_SLOT = "default";

/** 合法凭据引用名（Global Constraints）。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
      requestTimeoutMs: z.number(),
      streamIdleTimeoutMs: z.number(),
      defaultMaxTokens: z.number(),
      visibleModels: z.array(z.string()),
      modelVisibility: z.dict(z.boolean()),
      showSidebarQuota: z.boolean().default(false),
      accounts: z.array(
        z.object({
          label: z.string(),
          apiKeyEnv: z.string().role("credential-ref"),
          /** 旧插件允许的内联密钥；本包不读它（密钥只走凭据服务），但写回时原样保留。 */
          apiKey: z.string().role("secret"),
        }),
      ),
      activeAccount: z.string(),
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

  const settings = createSettingsPort(ctx, COMMAND_CODE_SETTINGS_NS, SETTINGS_ROWS);
  const credentials = createCredentialsPort(ctx);
  const intents = intentLogFor(
    COMMAND_CODE_SETTINGS_NS,
    createSettingsIntentStore(settings, COMMAND_CODE_SETTINGS_NS, INTENTS_FIELD, warn),
  );
  const accounts = createCommandCodeAccounts({ settings, credentials, intents });
  const rotation = createRotationAccess(() => accountStateOf(document()));
  warnAboutActiveAccount(document(), warn);

  /** 额度端口：每次读数都用当时的配置（`apiBase` 是构造参数，跟着现读的配置走）。 */
  const quota: QuotaPort = {
    async snapshot() {
      const apiBase = normalizeKey(document().apiBase) ?? DEFAULT_API_BASE;
      return createCommandCodeQuota({
        ref: () => selectedRefOf(document()),
        resolveKey: (ref) => resolveAccountKey(ctx, document(), credentials, ref),
        fetchImpl: fetch,
        apiBase,
      }).snapshot();
    },
  };

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
  };
  const adapter = createCommandCodeAdapter(deps);

  const login = createCommandCodeLogin({
    fetchImpl: fetch,
    // 登录端口的基地址是构造期参数：本期只构造，跟随 volatile 变更留给计划 1b 的远程页。
    apiBase: normalizeKey(document().apiBase) ?? DEFAULT_API_BASE,
    storeKey: (ref, key) => credentials.set(ref, key),
  });
  ctx.effect(
    () => () => {
      // 等待授权时卸载插件：回环服务器必须收掉（迟到的回调不再落库）。
      void login.cancel();
    },
    "dsh-llm-account: commandcode login port",
  );

  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
  ctx.effect(() => () => registration(), "dsh-llm-account: commandcode provider route");

  // Ruling 23：用户补上密钥后该账号必须能重新参与轮换。宿主 0.2.0-rc.2 的
  // `credentials/reference-updated` 就是这个接缝（凭据引用名与账号 ref 同一套标识空间）。
  ctx.on("credentials/reference-updated", (ref) => {
    rotation.clearCredentialRejection(ref);
  });

  return { providerId: PROVIDER_ID, settingsNs: COMMAND_CODE_SETTINGS_NS, adapter, rotation, intents, accounts, credentials, quota, login };
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

/** 账号库状态：顺序、按模型规则与固定账号（`core` 的 `RotationEngine` 输入）。 */
function accountStateOf(document: Record<string, unknown>): AccountState {
  return { order: orderOf(document), rules: rulesOf(document), pinned: pinnedRefOf(document) };
}

/** 顶层默认账号的 ref：`apiKeyEnv`；缺省或非法时回落到内置默认名。 */
function defaultRefOf(document: Record<string, unknown>): string {
  const ref = normalizeKey(document.apiKeyEnv);
  return ref !== undefined && REF_PATTERN.test(ref) ? ref : DEFAULT_API_KEY_ENV;
}

/** `accounts[].apiKeyEnv` 里合法的凭据引用名（合法名才可能是凭据槽；其余条目本期不支持）。 */
function accountRefsOf(document: Record<string, unknown>): string[] {
  const accounts = document.accounts;
  if (!Array.isArray(accounts)) return [];
  const refs: string[] = [];
  for (const item of accounts) {
    if (!isRecord(item)) continue;
    const ref = normalizeKey(item.apiKeyEnv);
    if (ref !== undefined && REF_PATTERN.test(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * 轮换顺序 = 顶层默认账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
 *
 * 顶层 `apiKeyEnv` **必须**进顺序：旧插件把它渲染成第一个槽（Default / legacy），而
 * `AccountPort.list()` 只列 `accounts` 条目；顺序里少了它，只配了顶层密钥的存量用户会让
 * `RotationEngine.pick` 返回 `undefined`，适配器直接报 MISSING_CREDENTIAL。
 */
function orderOf(document: Record<string, unknown>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    order.push(ref);
  }
  return order;
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
 * @param document - 现读的设置文档。
 * @returns 固定账号的 ref，或 `null`（自动轮换）。
 */
function pinnedRefOf(document: Record<string, unknown>): string | null {
  const active = normalizeKey(document.activeAccount);
  if (active === undefined || active === ACTIVE_ACCOUNT_AUTO) return null;
  if (active === LEGACY_DEFAULT_SLOT) return defaultRefOf(document);
  return REF_PATTERN.test(active) ? active : null;
}

/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document: Record<string, unknown>): string | undefined {
  return pinnedRefOf(document) ?? orderOf(document)[0];
}

/** 应用期诊断：认不出的 `activeAccount` 只在这里说一次（现读路径按自动轮换处理）。 */
function warnAboutActiveAccount(document: Record<string, unknown>, warn: (message: string) => void): void {
  const active = normalizeKey(document.activeAccount);
  if (active === undefined || active === ACTIVE_ACCOUNT_AUTO || active === LEGACY_DEFAULT_SLOT) return;
  if (REF_PATTERN.test(active)) return;
  warn(`llm-commandcode: activeAccount "${active}" is not a credential reference; automatic rotation is used instead`);
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
