/**
 * 「网页搜索」设置模块的入口：把 `llm-account-web` 搜索 provider 注册进宿主 `ctx.web`。
 *
 * 这一行（`llm-account-web-search`）**只**管搜索 provider，不碰对话路由；卡片里的三选一通过
 * 写宿主 `web.searchProvider` 决定谁来执行搜索（本 provider / 宿主自己的 `deepseek-official`）。
 * 配置字段全部 volatile（卡片要能逐路径写、改完立即生效）。
 * @module dsh-llm-account/src/web-search/index
 */
import type { Context } from "@deepseek-ai/cordis";
import { isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";

import {
  createCredentialsPort,
  isParsedConfig,
  isRecord,
  markVolatileFields,
  unwrapVolatileConfig,
  type PluginConfigSchema,
} from "../vendors/assembly";
import { LlmAccountWebSearchProvider, type WebSearchConfigSnapshot } from "./provider";
import { DEFAULT_SEARCH_KEY_REF, WEB_SEARCH_NAMESPACE } from "./support";
import { stringField } from "./util";

/** 本行的模块名（宿主加载器诊断用）。 */
export const name = WEB_SEARCH_NAMESPACE;

/** 只进 web seam：宿主没装 `dsh-web` 时本行不起（别的行不受影响）。 */
export const inject = ["web"];

/**
 * 这一行的 Config：全部字段 volatile（卡片逐路径写、改完立即生效）。
 *
 * `mode` 决定搜索走哪条路：`account` = 跟随模型账号（账号网关原生搜索），
 * `custom` = 第三方 API。其余字段按模式取用（`endpoint` 一族只在 `custom` 下有意义）。
 */
export const Config: PluginConfigSchema = z.object(
  markVolatileFields({
    /** `account` = 跟随模型账号；`custom` = 第三方 API。 */
    mode: z.union(["account", "custom"]).default("account"),
    /** 第三方 API 的接口地址（`custom` 模式必填）。 */
    endpoint: z.string().default(""),
    /** 请求方法。 */
    method: z.union(["GET", "POST"]).default("GET"),
    /** GET 的查询参数名。 */
    queryParam: z.string().default("q"),
    /** POST 请求体里的查询字段名。 */
    queryField: z.string().default("query"),
    /** POST 请求体里的 Key 字段名；空串表示 Key 走请求头。 */
    keyField: z.string().default(""),
    /** 结果数组的字段路径；空串表示自动探测常见形状。 */
    resultsPath: z.string().default(""),
    /** 第三方 Key 的凭据引用名（密钥只进宿主凭据库）。 */
    apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_SEARCH_KEY_REF),
    /** 认证头名；空串表示不带认证头。 */
    authHeader: z.string().default("Authorization"),
    /** 认证方案前缀；空串表示裸值。 */
    authScheme: z.string().default("Bearer"),
  }),
);

/**
 * 注册 provider。
 *
 * 依赖全部做成现取函数（配置、设置行、凭据），所以这一行不需要重启就能吃上新设置；
 * 宿主没装 web seam 时 cordis 不会调用 `apply`（`inject` 挡住）。
 * @param ctx - 插件上下文。
 * @param config - 宿主解析过的 Config（或程序化构造的原始配置）。
 */
export function apply(ctx: Context, config?: unknown): void {
  const parsed = parseConfig(config);
  const credentials = createCredentialsPort(ctx);
  const provider = new LlmAccountWebSearchProvider({
    config: () => snapshotOf(unwrapVolatileConfig(parsed)),
    settingsRow: (candidateIds) => settingsValueOf(ctx, candidateIds),
    resolveCredential: (ref) => credentials.resolve(ref),
  });
  ctx.web.registerSearchProvider(provider);
}

/**
 * 解析入口收到的配置。
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

/** 取一个字符串字段并裁掉首尾空白（空白照原样保留：空串在这几个字段里有语义）。 */
function trimOf(document: Record<string, unknown>, key: string): string | undefined {
  return stringField(document, key)?.trim();
}

/** 取一个「非空才有意义」的字符串字段：空白一律当作没写。 */
function textOf(document: Record<string, unknown>, key: string): string | undefined {
  const value = trimOf(document, key);
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * 取凭据引用名：裁空白后必须是合法引用名，否则当作「没写」回落默认。
 *
 * 手改成空白或非法名（例如旧插件的 `account-2`）不是「不要密钥」，而是文档坏了：
 * 带着一个查不到的引用跑，用户只会看到一条莫名其妙的「未配置」。
 */
function refNameOf(document: Record<string, unknown>, key: string): string | undefined {
  const value = textOf(document, key);
  return value === undefined || !isCredentialRefName(value) ? undefined : value;
}

/**
 * 配置文档 → provider 的选项快照。
 *
 * 逐字段收窄（文档可能被手改）：认不出的值回落到默认，不抛错、不让一次手改打断搜索。
 * 字符串一律裁掉首尾空白；`keyField`/`resultsPath`/`authHeader`/`authScheme` 的空串**有意义**
 * （分别表示「Key 走请求头」「自动探测结果数组」「不带认证头」「裸值」），所以它们保留空串，
 * 只有「非空才有意义」的字段（查询参数名、引用名）才把空白当作没写。
 * @param document - 配置文档的普通值。
 * @returns 选项快照。
 */
export function snapshotOf(document: Record<string, unknown>): WebSearchConfigSnapshot {
  return {
    mode: document.mode === "custom" ? "custom" : "account",
    endpoint: trimOf(document, "endpoint") ?? "",
    method: document.method === "POST" ? "POST" : "GET",
    queryParam: textOf(document, "queryParam") ?? "q",
    queryField: textOf(document, "queryField") ?? "query",
    keyField: trimOf(document, "keyField") ?? "",
    resultsPath: trimOf(document, "resultsPath") ?? "",
    apiKeyEnv: refNameOf(document, "apiKeyEnv") ?? DEFAULT_SEARCH_KEY_REF,
    authHeader: trimOf(document, "authHeader") ?? "Authorization",
    authScheme: trimOf(document, "authScheme") ?? "Bearer",
  };
}

/**
 * 现读宿主设置里某一行（按候选行名），返回它的值记录。
 *
 * 服务端 `settings.describe()` 按 profile 行 id 建索引，所以候选名要把行 id 与核心命名空间
 * 都列上。任何读取失败都读成「这一行不在这里」：搜索路径按不可用处理，不把设置服务自己的
 * 问题伪装成搜索故障。
 * @param ctx - 插件上下文（每次现取设置服务）。
 * @param candidateIds - 候选行名，按优先级排列。
 * @returns 行值；行缺失或读取失败时 `undefined`。
 */
function settingsValueOf(ctx: Context, candidateIds: readonly string[]): Record<string, unknown> | undefined {
  const service: unknown = ctx.get("settings");
  if (!isRecord(service) || typeof service.describe !== "function") return undefined;
  let described: unknown;
  try {
    described = service.describe();
  } catch {
    return undefined;
  }
  if (!Array.isArray(described)) return undefined;
  for (const id of candidateIds) {
    for (const row of described) {
      if (!isRecord(row) || row.ns !== id) continue;
      return isRecord(row.value) ? row.value : {};
    }
  }
  return undefined;
}
