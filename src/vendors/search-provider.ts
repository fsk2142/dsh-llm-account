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
 * `search()` 返回 `{ sources: [{ url, title, snippet? }], truncated: boolean }`。
 *
 * **`truncated` 是必填的**（2026-10-23 收紧）：宿主的 `web_search` 工具把返回值按一份
 * JSON schema 校验，其中它是 `required: true`。漏传会让整个返回值过不了校验，宿主报
 * `value is not lossless JSON` —— 那句话听起来像编码问题，实际是 schema 失败。
 *
 * ## 三条硬规矩
 *
 * 1. **没有 `web_search_tool_result` 就是失败**。实测网关走错协议时会回 200、模型只输出
 *    「web_search query: …」文本 —— 把那种文本当成结果，等于让模型胡编一个答案。
 * 2. `available()` 不发网络请求（宿主拿它做选路，慢一次就拖慢每次搜索）。
 * 3. 两条路都不可用时**明确抛错**，不返回空 sources 冒充成功。
 * @module dsh-llm-account/src/vendors/search-provider
 */

import { chooseSearchRoute, isSearchDisabled, type SearchRoute } from "../core/switching/search-route";
import { SearchApiError, searchViaApi } from "./search-api";

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
  /**
   * 是否因为上限被截断。
   *
   * **必须总是有值**（2026-10-23 修）：宿主的 `web_search` 工具把返回值按一份 JSON
   * schema 校验，其中 `truncated` 是 `required: true`（`type: boolean`）。我们原来把它
   * 声明成可选、并且两处返回点没传 —— 于是宿主报
   * `tool "web_search" returned invalid output: value is not lossless JSON`。
   *
   * 那个报错文案完全没提 `truncated`，所以容易误判成编码问题；实际是 schema 校验失败。
   */
  truncated: boolean;
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
  /**
   * 按顺序解析多个 API key 引用名（多 key 轮替）。
   *
   * 返回**实际解析到的**那些（顺序即优先级）：解析不到的引用名直接跳过，
   * 不当作失败 —— 用户可能只填了第一条。
   */
  resolveApiKeys: () => Promise<{ ref: string; key: string }[]>;
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
  return { sources, truncated: false };
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
 * 这个策略失败后**允许**回退到另一条路吗。
 *
 * 与 `chooseSearchRoute` 里的语义严格对齐：`*-first` 是「优先但可回退」，`*-only` 与 `off`
 * 是「不许偷偷换路」（`*-only` 选了某一条，换过去会违背策略，也可能产生额外计费）。
 * @param strategy - 设置文档里的策略值。
 * @returns 失败后是否还可以试另一条路。
 */
export function strategyCanFallBack(strategy: unknown): boolean {
  if (typeof strategy !== "string") return true; // 形状不可信时按缺省的 gateway-first 语义
  const value = strategy.trim().toLowerCase();
  return value.endsWith("-first") || value === "";
}

/** 一次 API 路的尝试结局。 */
type ApiAttempt =
  | { kind: "ok"; sources: SearchSource[] }
  | { kind: "failed"; reason: string };

/**
 * 用一组 key 依次尝试 Search API（多 key 轮替）。
 *
 * 与旧实现的差别：旧版只在「HTTP 401/402」时换下一把，而没有状态码的失败（请求根本没发出去）
 * 直接终止 —— 实测最典型的就是密钥里混进中文导致的 `ByteString` 错误。那把 key 永远用不了，
 * 但**别的 key 可能是好的**，所以现在也换。
 * 每一把的失败原因都会累积进最终消息，用户不必靠猜。
 * @param apiKeys - 按优先级排列的 key。
 * @param request - 搜索请求。
 * @param signal - 取消信号。
 * @returns 成功的结果或失败原因。
 */
async function searchWithApiKeys(
  apiKeys: readonly { ref: string; key: string }[],
  request: SearchRequest,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<ApiAttempt> {
  const reasons: string[] = [];
  for (const item of apiKeys) {
    try {
      const result = await searchViaApi({
        query: request.query,
        key: item.key,
        ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
        fetchImpl,
        ...(signal === undefined ? {} : { signal }),
      });
      return { kind: "ok", sources: result.sources };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reasons.push(`${item.ref}: ${message}`);
      // 换了也没用的失败（限流/服务端/参数错）：立刻停止，不折腾剩下的 key。
      if (!worthAnotherKey(error)) break;
    }
  }
  return { kind: "failed", reason: `搜索失败（已尝试 ${reasons.length} 个密钥）—— ${reasons.join("；")}` };
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
 * 从一个错误里取出 HTTP 状态码（轮替判定要用）。
 * @param error - 捕获到的错误。
 * @returns 状态码；不是 `SearchApiError` 时为 `undefined`。
 */
function statusOf(error: unknown): number | undefined {
  return error instanceof SearchApiError ? error.status : undefined;
}

/**
 * 这个错误是「用户取消」吗。
 *
 * `fetch` 遇到 abort 抛的是 `DOMException`（`name: "AbortError"`），不是 `SearchApiError` ——
 * 所以轮替判定必须单独认出它，否则取消会被当成「这把 key 有问题」。
 * @param error - 捕获到的错误。
 * @returns 是否是取消。
 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as { name?: unknown }).name === "AbortError";
}

/**
 * 这个失败是否「换一把 key 就有可能好」。
 *
 * 三类属于：
 * 1. **401/402**：这把 key 无效或余额不足（原本就有的判定）；
 * 2. **压根没发出请求**（没有状态码）：实测最典型的是密钥里混进了中文 —— fetch 在构造请求头时
 *    就抛 `Cannot convert argument to a ByteString`。这把 key 永远用不了，但**别的 key 可能好好
 *    的**，所以必须换下一条；
 * 3. **429/5xx**：按厂商限流/服务端错误，换了也一样 —— **不换**。
 *
 * 这条判据来自 2026-10-20 的真机数据：用户把一段中文误存成 `DEEPSEEK_API_KEY`，而真正能用的
 * `DEEPSEEK_API_KEY_2` 排在后面；旧逻辑因为「没有状态码 → 不换 key」既没试到好 key，
 * 也没回退网关，搜索直接不可用。
 *
 * **取消是第四类，且优先级最高**：用户按了停止，就该立刻停。旧代码把 `AbortError` 归进
 * 「没有状态码」那一类，于是拿着同一个已 abort 的信号把剩下每把 key 都试一遍（每把都瞬间失败），
 * 最后还给用户一句「已尝试 N 个密钥」—— 取消压根不是密钥的问题。
 * @param error - 捕获到的错误。
 * @returns 是否该换下一把 key。
 */
function worthAnotherKey(error: unknown): boolean {
  if (isAbortError(error)) return false; // 用户取消：到此为止
  const status = statusOf(error);
  if (status === undefined) return true; // 请求根本没发出去：换一把
  return status === 401 || status === 402;
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
  const route = async (): Promise<{
    chosen: SearchRoute;
    apiKeys: { ref: string; key: string }[];
    access?: { baseURL: string; key: string };
  }> => {
    const { provider, model } = deps.sessionRoute();
    const apiKeys = await deps.resolveApiKeys();
    const access = await gatewayReady(provider);
    const chosen = chooseSearchRoute({
      provider,
      model,
      strategy: deps.strategy(),
      hasApiKey: apiKeys.length > 0,
      hasGateway: access !== undefined,
    });
    return { chosen, apiKeys, ...(access === undefined ? {} : { access }) };
  };

  return {
    id: SEARCH_PROVIDER_ID,
    /**
     * 宿主拿它做选路。**必须廉价**：不发网络请求。
     *
     * ## 为什么现在要判 `off`（2026-10-23）
     *
     * 原来恒返回 `true`。后果是：用户把搜索方式选成「不启用」之后，宿主仍然认为
     * 本 provider **可用** —— 它继续把每次搜索都交给这里，而这里必然抛「网页搜索
     * 已被关闭」。别的搜索插件即使装了也排不上队。
     *
     * 更糟的是 `WEB_PROVIDER_AMBIGUOUS`：配置里不写 `searchProvider` 时，宿主收集
     * 所有 `available()` 为真的 provider，**两个以上直接报错**，两个都用不了。
     * 恒 `true` 让本插件成为那个「永远占着名额却不干活」的条目。
     *
     * 现在：明确选了 `off` 就报 `false`，把名额让出来。
     *
     * 注意宿主的行为（实测 `dsh-web` 源码）：配置的 id **已注册但 unavailable** 时
     * 报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，**不会回退**到别的 provider。所以
     * 光靠这里返回 `false` 会让搜索直接报错 —— 配套动作是 `search-release.ts`：
     * 切到 `off` 的那一刻把 `web.searchProvider` 置空，让宿主走「未指定 id」的选路。
     *
     * 仍然不做完整判定（那要解析凭据，是异步的）：只要**没有被明确关闭**就报告可用，
     * 真正的失败在 `search()` 里给出可读原因。
     */
    available(): boolean {
      return !isSearchDisabled(deps.strategy());
    },
    async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
      const { chosen, apiKeys, access } = await route();
      if (chosen.kind === "unavailable") {
        // 区分「用户主动关掉」与「两条路都没配好」—— 前者不是错误配置。
        if (isSearchDisabled(deps.strategy())) {
          throw new SearchUnavailableError("网页搜索已被关闭（搜索方式选了「不启用」）");
        }
        throw new SearchUnavailableError(
          "没有可用的搜索凭据：当前策略下两条路都不可用。请在功能页选择搜索方式，并配好 DeepSeek API key（或 opendesign 账号）",
        );
      }

      // —— API 路：直连 /v1/tools/search（不吃对话 token）——
      /** 本路失败的原因（`undefined` = 成功返回了）。回退时要把两边的真实原因都说出来。 */
      let apiFailure: string | undefined;
      if (chosen.kind === "api") {
        if (apiKeys.length === 0) throw new SearchUnavailableError("没有解析到 DeepSeek API key");
        const failure = await searchWithApiKeys(apiKeys, request, deps.fetchImpl, signal);
        if (failure.kind === "ok") return { sources: failure.sources, truncated: false };
        // **用户取消了**：到此为止。不回退网关（那个请求同样带着已 abort 的信号，只会再失败一次），
        // 也不把取消说成「密钥不可用」—— 那会让人去换一把没问题的 key。
        if (signal?.aborted === true) throw new SearchUnavailableError("搜索已取消");
        // API 路试完全部 key 仍失败。**`*-first` 是可回退的**（见 `chooseSearchRoute`：
        // `api-first` = 「优先但可回退」），所以还有网关就走网关；`api-only` 或网关不可用
        // 时明确失败，并把 API 侧的真实原因带出去（否则用户只看到一句「搜索不可用」）。
        if (!strategyCanFallBack(deps.strategy()) || access === undefined) {
          throw new SearchUnavailableError(failure.reason);
        }
        apiFailure = failure.reason;
        // 落到下面的网关路；若网关也失败，用户会看到两边的原因。
      }

      // —— 网关路：模型在对话里调用服务端搜索工具 ——
      //
      // **两个方向都要能回退**（2026-10-30 修）。原来只有 `api-first` 会回退到网关，
      // `gateway-first` 在网关 500 / 超时 / 没返回工具结果时**直接抛错** —— 与 README
      // 承诺的「网关优先，失败回退 API」不符。
      //
      // 回退条件与 API 侧对称：
      // - 策略允许回退（`*-first` 才行，`*-only` 不许）；
      // - 目标路可用（这里是 `apiKeys` 非空）；
      // - 用户**没有取消**（取消了就到此为止，不再打第二个网络请求）。
      const gatewayAvailable = access !== undefined;
      const apiAvailable = apiKeys.length > 0;
      /** 网关可走，或（网关不可用但 API 可回退）时继续。 */
      const canTryGateway = gatewayAvailable || (strategyCanFallBack(deps.strategy()) && apiAvailable);
      if (!canTryGateway) {
        if (apiFailure !== undefined) throw new SearchUnavailableError(apiFailure);
        throw new SearchUnavailableError("网关联署密钥不可用，搜索无法走订阅额度");
      }

      /** 网关路的失败原因；`undefined` = 成功。 */
      let gatewayFailure: string | undefined;
      if (gatewayAvailable) {
        const { baseURL, key } = access;
        const body = {
          model: SEARCH_MODEL,
          max_tokens: 4_096,
          messages: [{ role: "user", content: request.query }],
          // **工具类型必须是这个版本串**：写裸 `web_search` 会被当成普通工具（实测 0 结果）。
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        };
        let response: Response | undefined;
        try {
          response = await deps.fetchImpl(`${baseURL.replace(/\/$/, "")}/messages`, {
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
        } catch (error) {
          // 取消可能发生在请求在途的那一刻（不是开始前）：同样给一句干净的话，
          // 别把一个 DOMException 原样抛给宿主。
          if (isAbortError(error)) throw new SearchUnavailableError("搜索已取消");
          gatewayFailure = `搜索请求没能发出：${error instanceof Error ? error.message : String(error)}`;
        }
        if (response !== undefined && gatewayFailure === undefined) {
          if (!response.ok) {
            gatewayFailure = `搜索请求失败：HTTP ${response.status}`;
          } else {
            /**
             * `response.json()` **必须在 try 里**（2026-10-30 修 R05）。
             *
             * 代理 / 边缘网关可能返回 200 的 HTML、空正文或损坏的 JSON —— 那会让
             * `json()` 抛 `SyntaxError`。原来它在这个 try **外面**，异常直接从
             * `search()` 逸出，`gateway-first` 后面的 API 回退永远执行不到。
             */
            try {
              const payload: unknown = await response.json();
              const result = sourcesOf(payload);
              // 宿主自己也执行 maxResults：这里截一次以防 provider 侧超发。
              const max = request.maxResults;
              if (typeof max === "number" && max > 0 && result.sources.length > max) {
                return { sources: result.sources.slice(0, max), truncated: true };
              }
              return result;
            } catch (error) {
              gatewayFailure = `网关响应无效：${error instanceof Error ? error.message : String(error)}`;
            }
          }
        }
      }

      // 网关也失败 → 若策略允许且 API 可用，回退到 API；否则把两边的真实原因都说出来。
      if (signal?.aborted === true) throw new SearchUnavailableError("搜索已取消");
      /**
       * 回退到 API 的唯一条件：**API 还没试过**（`apiFailure === undefined`）。
       *
       * `api-first` 走到这里时 API 已经试过并失败（`apiFailure` 有值），再打一次是白烧
       * 请求与计费 —— 那条路的回退方向是 API→网关，反过来不成立。
       */
      if (apiFailure === undefined && strategyCanFallBack(deps.strategy()) && apiAvailable) {
        const retry = await searchWithApiKeys(apiKeys, request, deps.fetchImpl, signal);
        if (retry.kind === "ok") return { sources: retry.sources, truncated: false };
        // 这里不再重复检查 `signal.aborted`：上面已经抛过一次，而且 `searchWithApiKeys`
        // 自己会把取消语境翻译成原因文本。多一层判断只会让类型收窄成 `false` 恒不成立。
        throw new SearchUnavailableError(
          `两条路都失败 —— 网关：${gatewayFailure ?? "不可用"}；API：${retry.reason}`,
        );
      }
      throw new SearchUnavailableError(
        gatewayFailure === undefined
          ? (apiFailure ?? "搜索不可用")
          : apiFailure === undefined
            ? gatewayFailure
            : `两条路都失败 —— API：${apiFailure}；网关：${gatewayFailure}`,
      );
    },
  };
}
