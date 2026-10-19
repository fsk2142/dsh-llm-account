/**
 * 账号网关的**原生搜索**：Anthropic Messages 请求 + `web_search_20250305` 服务端工具。
 *
 * 写法与解析逐条对齐宿主 `@deepseek-ai/dsh-web-search-deepseek`（MIT；2026-10-18 从
 * app.asar 提取核对）：只认结构化的 `web_search_tool_result` 块，缺块即报错，**绝不**
 * 从模型散文里刮结果；snippet 来自 text 块 citation 的 `cited_text`（同一 url 取首个）。
 *
 * 与宿主实现的三处有意差异：
 * ① 端点与密钥来自**本插件自己的账号行**（不是本模块的设置字段）——「跟随模型账号」的字面含义；
 * ② 401 / 402 的文案分开：401 是密钥被拒（去厂商卡片换密钥），402 是上游拒绝（不是密钥问题）；
 * ③ 请求头带上网关要的身份编码与归属头，与对话请求同源（见 `commandcode/protocol.ts`）。
 * @module dsh-llm-account/src/web-search/anthropic
 */
import { attributionHeaders } from "@deepseek-ai/dsh-llm";
import { WebError } from "./web-error";
import type { WebSearchResult, WebSearchSource } from "@deepseek-ai/dsh-web";

import { IDENTITY_ENCODING_HEADER } from "../vendors/commandcode/protocol";
import { abortedError, isAbortError, isRecord, stringField, throwIfAborted } from "./util";

/** 服务端搜索工具的类型名（Anthropic 与 DeepSeek 的 Anthropic 兼容端点同款）。 */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305";

/** `anthropic-version` 头（与宿主原生搜索一致）。 */
export const ANTHROPIC_VERSION = "2023-06-01";

/** 一次搜索请求的输出上限：搜索回合很短，4096 足够，不占对话预算。 */
export const SEARCH_MAX_TOKENS = 4096;

/** 一次搜索允许的 `web_search` 工具调用上限。 */
export const SEARCH_MAX_USES = 5;

/** 归属头（与对话请求同一套自报家门的写法）。 */
const SEARCH_USER_AGENT = "dsh-llm-account/0.1.0";

/** 一次账号搜索请求的输入（端点与密钥已由 provider 的选项快照解析好）。 */
export interface AnthropicSearchInput {
  /** Messages 端点（已含路径）。 */
  readonly endpoint: string;
  /** 账号密钥。 */
  readonly key: string;
  /** 本次请求用的模型 id（取当前默认模型的 id）。 */
  readonly model: string;
}

/**
 * 构造原生搜索的请求体（导出给测试逐字段核对）。
 * @param input - 模型与查询。
 * @returns Messages 请求体。
 */
export function buildAnthropicSearchBody(input: { model: string; query: string }): Record<string, unknown> {
  return {
    model: input.model,
    max_tokens: SEARCH_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `Perform a web search for the query: ${input.query}` }],
      },
    ],
    tools: [{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: SEARCH_MAX_USES }],
    thinking: { type: "disabled" },
  };
}

/**
 * 从响应块的 text citations 里建 `url → cited_text` 映射（snippet 的来源）。
 * `web_search_result` 条目本身通常没有摘要，摘录只在 citation 里（同一 url 取首个）。
 * @param blocks - 响应 content 块。
 * @returns 映射（没有 citation 时为空）。
 */
function citationSnippets(blocks: readonly unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== "text" || !Array.isArray(block.citations)) continue;
    for (const raw of block.citations) {
      if (!isRecord(raw)) continue;
      const url = stringField(raw, "url");
      const cited = stringField(raw, "cited_text");
      if (url === undefined || url.length === 0 || cited === undefined || cited.length === 0) continue;
      if (!map.has(url)) map.set(url, cited);
    }
  }
  return map;
}

/**
 * 把一次 Messages 响应映射成归一化搜索结果。
 *
 * 只认 `web_search_tool_result` 块里的 `web_search_result` 条目；**没有结果块就是错误**，
 * 不做散文刮取（降级会撒谎：模型自述的链接不是搜索证据）。`truncated` 交给 seam 决定。
 * @param response - 已解析的 Messages 响应体。
 * @param endpoint - 出错的请求端点（诊断用；缺省不进文案）。
 * @returns 归一化结果（按 url 去重）。
 * @throws {@link WebError} `WEB_PROVIDER_ERROR`：响应里没有结果块。
 */
export function mapAnthropicSearchResponse(response: unknown, endpoint?: string): WebSearchResult {
  const blocks: readonly unknown[] = isRecord(response) && Array.isArray(response.content) ? response.content : [];
  const resultBlocks = blocks.filter((block) => isRecord(block) && block.type === "web_search_tool_result");
  if (resultBlocks.length === 0) {
    throw new WebError(
      `the account gateway returned no web_search_tool_result blocks${
        endpoint === undefined ? "" : ` from ${JSON.stringify(endpoint)}`
      }; the upstream may have refused the web_search tool declaration, so the search did not run`,
      "WEB_PROVIDER_ERROR",
    );
  }
  const snippets = citationSnippets(blocks);
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  for (const block of resultBlocks) {
    if (!isRecord(block) || !Array.isArray(block.content)) continue;
    for (const raw of block.content) {
      if (!isRecord(raw) || raw.type !== "web_search_result") continue;
      const url = stringField(raw, "url");
      if (url === undefined || url.length === 0 || seen.has(url)) continue;
      seen.add(url);
      const title = stringField(raw, "title");
      const pageAge = stringField(raw, "page_age");
      const snippet = snippets.get(url);
      sources.push({
        url,
        ...(title !== undefined && title.length > 0 ? { title } : {}),
        ...(snippet === undefined ? {} : { snippet }),
        ...(pageAge !== undefined && pageAge.length > 0 ? { publishedAt: pageAge } : {}),
      });
    }
  }
  return { sources, truncated: false };
}

/**
 * 出错文案的公共前缀：带上端点与「怎么修」的指引（不静默、也不误导用户改错地方）。
 * @param endpoint - 请求端点。
 * @param message - 具体原因。
 * @param cause - 原始错误。
 * @returns WebError。
 */
function endpointError(endpoint: string, message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThe account-native web search used endpoint ${JSON.stringify(
      endpoint,
    )} (from the model account's own settings row, not from the search card). Fix the account in the provider's card, or pick "DeepSeek 官方" / a third-party search API in the plugin's 网页搜索 card.`,
    "WEB_PROVIDER_ERROR",
    cause === undefined ? undefined : { cause },
  );
}

/** HTTP 错误正文里的细节（JSON 的 error.message / message，否则原始片段）。 */
function httpDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed)) {
      const nested = isRecord(parsed.error) ? stringField(parsed.error, "message") : undefined;
      const message = nested ?? stringField(parsed, "message");
      if (message !== undefined && message.length > 0) return `: ${message}`;
    }
  } catch {
    // 不是 JSON：退回原始片段。
  }
  const trimmed = body.trim();
  return trimmed.length === 0 ? "" : `: ${trimmed.slice(0, 300)}`;
}

/**
 * 走一次账号网关的原生搜索（一次完整的 Messages 回合）。
 * @param input - 端点、密钥与模型。
 * @param query - 查询词。
 * @param signal - 调用方的取消信号。
 * @param fetchImpl - fetch 实现（测试注入）。
 * @returns 归一化搜索结果。
 * @throws {@link WebError} `WEB_ABORTED` 取消；`WEB_PROVIDER_ERROR` 网络、HTTP、解析或没有结果块。
 */
export async function searchViaAnthropicMessages(
  input: AnthropicSearchInput,
  query: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<WebSearchResult> {
  throwIfAborted(signal);
  const body = buildAnthropicSearchBody({ model: input.model, query });
  let response: Response;
  try {
    response = await fetchImpl(input.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": SEARCH_USER_AGENT,
        authorization: `Bearer ${input.key}`,
        "anthropic-version": ANTHROPIC_VERSION,
        ...IDENTITY_ENCODING_HEADER,
        ...attributionHeaders(),
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error);
    throw endpointError(input.endpoint, `the account search request failed: ${String(error)}`, error);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = `the account gateway rejected the search (HTTP ${response.status})${httpDetail(text)}`;
    if (response.status === 401) {
      throw new WebError(
        `${message}\n\nThe account key was rejected (HTTP 401). Update or re-import the account in the provider's card, then search again.`,
        "WEB_PROVIDER_ERROR",
      );
    }
    if (response.status === 402) {
      throw new WebError(
        `${message}\n\nHTTP 402 is an upstream refusal at the gateway (a plan/usage gate), not an expired key. If this account cannot use native search, pick "DeepSeek 官方" or a third-party search API in the plugin's 网页搜索 card.`,
        "WEB_PROVIDER_ERROR",
      );
    }
    throw endpointError(input.endpoint, message);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw abortedError(signal, error);
    throw endpointError(
      input.endpoint,
      `the account gateway returned an unprocessable response body: ${String(error)}`,
      error,
    );
  }
  return mapAnthropicSearchResponse(payload, input.endpoint);
}
