/**
 * 统一搜索提供方：把「网关额度优先、API key 兜底」接到宿主的 `ctx.web` 上。
 *
 * ## 为什么插件要自己注册一个 provider
 *
 * 宿主自带的 `dsh-web-search-deepseek` 只做「DeepSeek 账号 token → DEEPSEEK_API_KEY」，
 * 不会用**网关订阅额度**。用户的诉求是「优先用登录的供应商账号额度」，所以本插件在旁边注册
 * 自己的 provider：能用网关就用网关，否则回退 API key。
 *
 * ## 接口形状（读自 `dsh-web-search-deepseek/lib/index.js`）
 *
 * ```js
 * { id, available(), async search(request, signal) }
 * ```
 *
 * `available()` 是**廉价的本地检查**（宿主在选路时会调它，不能发网络请求）；
 * `search()` 返回 `{ sources: [{ url, title, snippet? }], truncated? }`。
 *
 * ## 三条硬规矩
 *
 * 1. **没有 `web_search_tool_result` 就是失败**。实测网关走错协议时会回 200、模型只输出
 *    「web_search query: …」文本 —— 把那种文本当成结果，等于让模型胡编一个答案。
 * 2. `available()` 不发网络请求（宿主拿它做选路，慢一次就拖慢每次搜索）。
 * 3. 两条路都不可用时**明确抛错**，不返回空 sources 冒充成功。
 * @module dsh-llm-account/src/vendors/search-provider
 */

import { chooseSearchRoute, type SearchRoute } from "../core/switching/search-route";
import { searchViaApi } from "./search-api";

/** 本 provider 的稳定 id（宿主注册表的键）。 */
export const SEARCH_PROVIDER_ID = "llm-account-deepseek";

/** 一条搜索来源（与宿主的 `WebSource` 同形）。 */
export interface SearchSource {
  url: string;
  title: string;
  snippet?: string;
}

/** 一次搜索的结果。 */
export interface SearchResult {
  sources: SearchSource[];
  truncated?: boolean;
}

/** 一次搜索请求（宿主传给 provider 的形状）。 */
export interface SearchRequest {
  query: string;
  maxResults?: number;
}

/** provider 可用的传输与凭据解析（都可注入，便于单测）。 */
export interface SearchProviderDeps {
  /** 注入的 fetch（生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /** 当前会话的路由（`provider` / `model`）；宿主可能还没有信息。 */
  sessionRoute: () => { provider: string | undefined; model: string | undefined };
  /** 用户选的优先策略（见 `core/switching/search-route`）。 */
  strategy: () => string;
  /**
   * 解析「某家网关」的推理密钥与基地址。
   * @param provider - 网关 id。
   * @returns 基地址与密钥；该网关不可用时为 `undefined`。
   */
  gatewayAccess: (provider: string) => Promise<{ baseURL: string; key: string } | undefined>;
  /** 解析 API key（凭据服务里的引用）。 */
  resolveApiKey: () => Promise<string | undefined>;
}

/** 辅助搜索请求的模型（与宿主同一档）。 */
const SEARCH_MODEL = "deepseek-v4-flash";

/** Anthropic 版本头（与宿主同一条）。 */
const API_VERSION = "2023-06-01";

/**
 * 从一次 Messages 响应里抽出搜索结果。
 *
 * **没有 `web_search_tool_result` 就是失败**：这是本模块最重要的一条。
 * 实测踩到过 —— 网关走错协议时回 200，模型只输出「web_search query: xxx」这段文本，
 * 一条结果都没有。把那种文本当结果，等于让模型对着空气编答案。
 * @param payload - 已解析的响应正文（形状不可信）。
 * @returns 来源列表；截断标记。
 * @throws 当响应里没有任何搜索结果块时。
 */
export function sourcesOf(payload: unknown): SearchResult {
  const content = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).content
    : undefined;
  if (!Array.isArray(content)) {
    throw new SearchUnavailableError("搜索响应里没有 content 块");
  }
  const sources: SearchSource[] = [];
  let sawResultBlock = false;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record.type !== "web_search_tool_result") continue;
    sawResultBlock = true;
    const items = record.content;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.url !== "string" || entry.url === "") continue;
      const title = typeof entry.title === "string" && entry.title !== "" ? entry.title : entry.url;
      sources.push({ url: entry.url, title });
    }
  }
  if (!sawResultBlock) {
    // 关键断言：200 但没有结果块 = 这次搜索**没有真的发生**。
    throw new SearchUnavailableError(
      "网关没有执行服务端搜索（响应里没有 web_search_tool_result）—— 多半是模型或协议不支持",
    );
  }
  return { sources };
}

/** 搜索不可用（宿主会把消息呈现给用户）。 */
export class SearchUnavailableError extends Error {
  readonly code = "WEB_PROVIDER_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

/**
 * 把一个 provider 注册进宿主的 `ctx.web`，并返回注销函数。
 *
 * 宿主的 `registerSearchProvider` 返回它自己的 disposer（随调用方 fiber 释放）；
 * 这里只做形状适配，让装配层不必认识 provider 的具体类型。
 * @param webCtx - 已注入 `web` 的宿主上下文。
 * @param deps - 传输与凭据解析。
 * @returns 注销函数。
 */
export function registerSearchProvider(
  webCtx: { web?: { registerSearchProvider(provider: ReturnType<typeof createSearchProvider>): unknown } },
  deps: SearchProviderDeps,
): () => void {
  const web = webCtx.web;
  if (web === undefined) return () => undefined;
  const provider = createSearchProvider(deps);
  const dispose = web.registerSearchProvider(provider);
  return typeof dispose === "function" ? (dispose as () => void) : () => undefined;
}

/**
 * 造一个搜索 provider（注册到 `ctx.web.registerSearchProvider`）。
 * @param deps - 传输、会话路由与凭据解析。
 * @returns 宿主形状的 provider。
 */
export function createSearchProvider(deps: SearchProviderDeps): {
  id: string;
  available(): boolean;
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
} {
  /** 网关路是否可用（异步：要解析那家的密钥）。 */
  const gatewayReady = async (provider: string | undefined): Promise<{ baseURL: string; key: string } | undefined> => {
    if (provider !== "opendesign") return undefined;
    return await deps.gatewayAccess(provider);
  };

  /** 当前该走哪条路（只解析凭据，不发搜索请求）。 */
  const route = async (): Promise<{ chosen: SearchRoute; apiKey?: string; access?: { baseURL: string; key: string } }> => {
    const { provider, model } = deps.sessionRoute();
    const apiKey = await deps.resolveApiKey();
    const access = await gatewayReady(provider);
    const chosen = chooseSearchRoute({
      provider,
      model,
      strategy: deps.strategy(),
      hasApiKey: apiKey !== undefined,
      hasGateway: access !== undefined,
    });
    return { chosen, ...(apiKey === undefined ? {} : { apiKey }), ...(access === undefined ? {} : { access }) };
  };

  return {
    id: SEARCH_PROVIDER_ID,
    /**
     * 宿主拿它做选路。**必须廉价**：不发网络请求。
     *
     * 这里不做完整判定（那要解析凭据，是异步的）：只要可能存在一条路就报告可用，
     * 真正的失败在 `search()` 里给出可读原因。
     */
    available(): boolean {
      return true;
    },
    async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
      const { chosen, apiKey, access } = await route();
      if (chosen.kind === "unavailable") {
        throw new SearchUnavailableError(
          "没有可用的搜索凭据：当前策略下两条路都不可用。请在功能页选择搜索策略，并配好 DeepSeek API key（或 opendesign 账号）",
        );
      }

      // —— API 路：直连 /v1/tools/search（不吃对话 token）——
      if (chosen.kind === "api") {
        if (apiKey === undefined) throw new SearchUnavailableError("没有解析到 DeepSeek API key");
        try {
          const result = await searchViaApi({
            query: request.query,
            key: apiKey,
            ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
            fetchImpl: deps.fetchImpl,
            ...(signal === undefined ? {} : { signal }),
          });
          return { sources: result.sources };
        } catch (error) {
          // 把 Search API 的错误翻成宿主认识的 provider 错误（保留原因）。
          throw new SearchUnavailableError(error instanceof Error ? error.message : String(error));
        }
      }

      // —— 网关路：模型在对话里调用服务端搜索工具 ——
      if (access === undefined) {
        throw new SearchUnavailableError("网关联署密钥不可用，搜索无法走订阅额度");
      }
      const { baseURL, key } = access;
      const body = {
        model: SEARCH_MODEL,
        max_tokens: 4_096,
        messages: [{ role: "user", content: request.query }],
        // **工具类型必须是这个版本串**：写裸 `web_search` 会被当成普通工具（实测 0 结果）。
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      };
      const response = await deps.fetchImpl(`${baseURL.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          authorization: `Bearer ${key}`,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        throw new SearchUnavailableError(`搜索请求失败：HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      const result = sourcesOf(payload);
      // 宿主自己也执行 maxResults：这里截一次以防 provider 侧超发。
      const max = request.maxResults;
      if (typeof max === "number" && max > 0 && result.sources.length > max) {
        return { sources: result.sources.slice(0, max), truncated: true };
      }
      return result;
    },
  };
}
