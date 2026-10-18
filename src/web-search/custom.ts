/**
 * 第三方搜索 API（**通用自定义**）：用户自己填接口地址与 Key，兼容大多数搜索 API
 * （Tavily / Brave / Serper / Exa / 自建……）。
 *
 * 设计取舍：
 * - 请求形状由卡片上的小字段集描述（GET/POST、查询参数名、Key 放头还是放体），不做各家预设
 *   ——「通用自定义」就是不做预设、不猜；
 * - 响应形状**自动探测**常见的结果数组与字段名，探测不到就报错并提示填 `resultsPath`，
 *   绝不静默返回空结果（空结果与「接口没跑通」是两回事）；
 * - 结果不裁剪：宿主 seam 会按 `request.maxResults` 截断并置 `truncated`。
 * @module dsh-llm-account/src/web-search/custom
 */
import { WebError } from "@deepseek-ai/dsh-web";
import type { WebSearchResult, WebSearchSource } from "@deepseek-ai/dsh-web";

import { abortedError, firstString, isAbortError, isRecord, throwIfAborted } from "./util";

/** 一次第三方搜索的请求形状（全部来自卡片/模块配置）。 */
export interface CustomSearchOptions {
  /** 接口地址（GET 时可自带查询参数）。 */
  readonly endpoint: string;
  /** 请求方法。 */
  readonly method: "GET" | "POST";
  /** GET 的查询参数名（空串按 `q`）。 */
  readonly queryParam: string;
  /** POST 请求体里的查询字段名（空串按 `query`）。 */
  readonly queryField: string;
  /** POST 请求体里的 Key 字段名（空串表示 Key 走请求头；Tavily 这类用 `api_key`）。 */
  readonly keyField: string;
  /** 结果数组的字段路径（点号分隔；空串表示自动探测）。 */
  readonly resultsPath: string;
  /** 已解析的密钥；没有就不带认证。 */
  readonly key?: string;
  /** 认证头名（空串表示不带认证头）。 */
  readonly authHeader: string;
  /** 认证方案前缀（空串表示裸值）。 */
  readonly authScheme: string;
}

/**
 * 结果数组的自动探测路径（按优先级）。
 *
 * 覆盖常见形状：Tavily/Exa `results`；Brave `web.results`；Serper `organic`；自建包装
 * `data.results` / `data`。探测不到时用户可以把 `resultsPath` 填成实际路径。
 */
const RESULT_PATHS: readonly string[] = [
  "results",
  "data.results",
  "data.web.results",
  "web.results",
  "organic",
  "organic_results",
  "items",
  "hits",
  "sources",
  "entries",
  "data",
];

/** 答案/摘要文本的候选路径（`content` 字段，可选）。 */
const ANSWER_FIELDS: readonly string[] = ["answer", "summary", "message"];

/** 点号路径取值（任一段不是记录就返回 `undefined`）。 */
function valueAt(payload: unknown, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/** 找到结果数组，或给出「探测不到」的原因。 */
function resultArray(payload: unknown, resultsPath: string): { items: readonly unknown[] } | { error: string } {
  if (Array.isArray(payload)) return { items: payload };
  const configured = resultsPath.trim();
  if (configured.length > 0) {
    const value = valueAt(payload, configured);
    if (Array.isArray(value)) return { items: value };
    return { error: `the configured results path "${configured}" does not point at an array` };
  }
  for (const path of RESULT_PATHS) {
    const value = valueAt(payload, path);
    if (Array.isArray(value)) return { items: value };
  }
  return { error: `no result array was found (tried ${RESULT_PATHS.join(", ")})` };
}

/** 一条结果 → 归一化来源（没有可用 url 的条目丢弃）。 */
function sourceOf(item: unknown): WebSearchSource | undefined {
  if (typeof item === "string") return item.startsWith("http") ? { url: item } : undefined;
  const url = firstString(item, ["url", "link", "href"]);
  if (url === undefined) return undefined;
  const title = firstString(item, ["title", "name", "headline"]);
  const snippet = firstString(item, ["snippet", "content", "description", "text", "summary", "body"]);
  const publishedAt = firstString(item, [
    "publishedAt",
    "published_at",
    "publishedDate",
    "published_date",
    "page_age",
    "date",
    "age",
  ]);
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

/** 顶层答案文本（可选）：`answer` / `summary` / `message` 或 `data.answer`。 */
function answerOf(payload: unknown): string | undefined {
  return (
    firstString(payload, ANSWER_FIELDS) ?? firstString(valueAt(payload, "data"), ["answer", "summary"])
  );
}

/**
 * 把第三方接口的响应映射成归一化搜索结果（导出给测试逐形状核对）。
 * @param payload - 已解析的 JSON。
 * @param resultsPath - 配置的结果数组路径（空串自动探测）。
 * @returns 归一化结果（按 url 去重）。
 * @throws {@link WebError} `WEB_PROVIDER_ERROR`：探测不到结果数组。
 */
export function mapCustomSearchPayload(payload: unknown, resultsPath: string): WebSearchResult {
  const found = resultArray(payload, resultsPath);
  if ("error" in found) {
    throw new WebError(
      `${found.error}; set "resultsPath" in the web-search card to the field that holds the result array`,
      "WEB_PROVIDER_ERROR",
    );
  }
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  for (const item of found.items) {
    const source = sourceOf(item);
    if (source === undefined || seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push(source);
  }
  const content = answerOf(payload);
  return { ...(content === undefined ? {} : { content }), sources, truncated: false };
}

/**
 * 组装一次第三方搜索请求（导出给测试逐字段核对）。
 * @param options - 请求形状。
 * @param query - 查询词。
 * @returns URL 与 fetch 的 init。
 */
export function buildCustomSearchRequest(options: CustomSearchOptions, query: string): { url: string; init: RequestInit } {
  const key = options.key;
  const hasKey = key !== undefined && key.length > 0;
  const headers: Record<string, string> = { accept: "application/json" };
  const keyField = options.keyField.trim();
  const authHeader = options.authHeader.trim();
  const authScheme = options.authScheme.trim();
  if (hasKey && keyField === "" && authHeader !== "") {
    headers[authHeader] = authScheme === "" ? key : `${authScheme} ${key}`;
  }
  if (options.method === "GET") {
    const url = new URL(options.endpoint);
    const queryParam = options.queryParam.trim();
    url.searchParams.set(queryParam === "" ? "q" : queryParam, query);
    return { url: url.toString(), init: { method: "GET", headers, redirect: "follow" } };
  }
  headers["content-type"] = "application/json";
  const queryField = options.queryField.trim();
  const body: Record<string, unknown> = { [queryField === "" ? "query" : queryField]: query };
  if (hasKey && keyField !== "") body[keyField] = key;
  return {
    url: options.endpoint,
    init: { method: "POST", headers, redirect: "follow", body: JSON.stringify(body) },
  };
}

/**
 * 出错文案的公共前缀：带端点与「怎么修」的指引。
 * @param url - 请求 URL。
 * @param message - 具体原因。
 * @param cause - 原始错误。
 * @returns WebError。
 */
function endpointError(url: string, message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThe third-party web search used endpoint ${JSON.stringify(
      url,
    )}. Fix the endpoint or the key in the plugin's 网页搜索 card (third-party API).`,
    "WEB_PROVIDER_ERROR",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * 走一次第三方搜索接口。
 * @param options - 请求形状（密钥已解析）。
 * @param query - 查询词。
 * @param signal - 调用方的取消信号。
 * @param fetchImpl - fetch 实现（测试注入）。
 * @returns 归一化搜索结果。
 * @throws {@link WebError} `WEB_ABORTED` 取消；`WEB_PROVIDER_ERROR` 地址非法、网络、HTTP 或解析失败。
 */
export async function searchViaCustomApi(
  options: CustomSearchOptions,
  query: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WebSearchResult> {
  throwIfAborted(signal);
  let built: { url: string; init: RequestInit };
  try {
    built = buildCustomSearchRequest(options, query);
  } catch (error) {
    throw endpointError(options.endpoint, `the third-party search endpoint is not a valid URL: ${String(error)}`, error);
  }
  let response: Response;
  try {
    response = await fetchImpl(built.url, { ...built.init, ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error);
    throw endpointError(built.url, `the third-party search request failed: ${String(error)}`, error);
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const trimmed = text.trim();
    throw endpointError(
      built.url,
      `the third-party search endpoint answered HTTP ${response.status}${trimmed.length === 0 ? "" : `: ${trimmed.slice(0, 300)}`}`,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const trimmed = text.trim();
    throw endpointError(
      built.url,
      `the third-party search endpoint did not return JSON${trimmed.length === 0 ? "" : `: ${trimmed.slice(0, 300)}`}`,
      error,
    );
  }
  return mapCustomSearchPayload(payload, options.resultsPath);
}
