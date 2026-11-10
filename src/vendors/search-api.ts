/**
 * DeepSeek **Search API** 直连（`POST /v1/tools/search`）。
 *
 * ## 为什么需要这条路（与网关路并存）
 *
 * | | 网关路（服务端工具） | API 路（本模块） |
 * | --- | --- | --- |
 * | 端点 | 对话端点 + `tools: web_search_20250305` | `POST /v1/tools/search` |
 * | 计费 | 按 **token**（一次搜索 = 一次完整模型调用） | 每 **1000 次成功请求 5 元** |
 * | 结果 | 夹在对话流里的 `web_search_tool_result` 块 | 干净的结构化 `results[]` |
 * | 依赖 | 必须是 opendesign + DeepSeek 模型 | 任何 DeepSeek API key |
 *
 * 需求两条都保留、可切优先策略（见 `core/switching/search-route`）。
 *
 * ## 文档要点（api-docs.deepseek.com/zh-cn/guides/search）
 *
 * - 请求：`{ query, count?, ori_question?, localization?, need_content? }`，`count` 1–50；
 * - 响应：`{ results: [{ title, url, snippet, summary, content, site_name, date, authority,
 *   rerank_score }] }`；**空 results 是合法结果**（真的没匹配到）；
 * - 计费：只有「HTTP 200 且 results 非空」才计费 —— 失败与空结果都不花钱；
 * - 失败码：400 参数错 / 401 key 无效 / 402 余额不足 / 429 限流 / 5xx 服务端。
 *
 * @module dsh-llm-account/src/vendors/search-api
 */

import { readBoundedJsonResult } from "../core/bounded-body";

/** Search API 的路径（基地址固定是 `https://api.deepseek.com`）。 */
export const SEARCH_API_PATH = "/v1/tools/search";

/** Search API 的基地址（官方文档只有这一个，没有地区变体）。 */
const SEARCH_API_BASE = "https://api.deepseek.com";

/** `count` 的官方范围。 */
const MIN_COUNT = 1;
const MAX_COUNT = 50;

/**
 * Search API 请求的硬超时（毫秒）。
 *
 * ## 为什么（2026-11-10 审查 A08）
 *
 * 与网关路同一个问题：原来只在调用方给了 `signal` 时透传，没有自己的 deadline。
 * 调用方不传或永不 abort 时，一次握手卡住的请求会一直挂着 —— 而搜索是**交互式**
 * 操作，挂住比报错更糟：用户只能干等，连「换个方式」的提示都得不到。
 *
 * 15 秒与网关路同档：两条路是同一个用户的同一个动作，超时口径不该一个有、一个没有。
 */
export const API_SEARCH_TIMEOUT_MS = 15_000;

/**
 * Search API 响应的正文上限（字节）。
 *
 * 搜索结果是小结构（标题 + URL + 摘要），1 MiB 已经宽裕；但 `need_content` 或
 * 协议变更可能让单次响应变大，所以给一个上限而不是无限 `json()`。
 */
export const API_SEARCH_BODY_LIMIT = 1_048_576;

/** 一条来源（与宿主 `WebSource` 同形）。 */
export interface ApiSearchSource {
  url: string;
  title: string;
}

/** 一次搜索的结果。 */
export interface ApiSearchResult {
  sources: ApiSearchSource[];
}

/** 请求参数。 */
export interface ApiSearchInput {
  /** 搜索词（1–128 字符）。 */
  query: string;
  /** DeepSeek API key。 */
  key: string;
  /** 想要的条数；缺省交给服务端（文档默认 10）。 */
  maxResults?: number;
  /** 注入的 fetch（测试用）。 */
  fetchImpl: typeof fetch;
  /** 取消信号。 */
  signal?: AbortSignal;
}

/** 搜索失败（带上 HTTP 状态码，供调用方区分）。 */
export class SearchApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SearchApiError";
    this.status = status;
  }
}

/**
 * 把 HTTP 状态码翻成人话。
 *
 * 分开说是因为处理方式完全不同：401 要换 key、402 要充值、429 等一会再来、
 * 5xx 可以重试 —— 统一一句「搜索失败」会让用户无从下手。
 * @param status - HTTP 状态码。
 * @returns 可读原因。
 */
function reasonOf(status: number): string {
  if (status === 401) return "API key 无效或缺失（401）";
  if (status === 402) return "DeepSeek 账户余额不足（402），请先充值";
  if (status === 403) return "请求被安全策略拒绝（403）";
  if (status === 429) return "触发限流（429），请稍后重试";
  if (status >= 500) return `DeepSeek 服务端错误（${status}），可稍后重试`;
  return `搜索请求失败（HTTP ${status}）`;
}

/** 从错误正文里读出服务端的 message（诊断信息不该被吞掉）。 */
function messageOf(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const error = (payload as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

/**
 * 把一个实测失败**分档**：这把 key 是「确定不能用」还是「只是这次没测出来」。
 *
 * 为什么必须分开：只有 401/402/403 是服务端在**说这把密钥有问题**；网络错误、超时、5xx
 * 都可能是此刻的抖动 —— 把它们报成「密钥无效」会让用户去换一把其实没问题的密钥，
 * 而那正是最难自查的误导。
 * @param error - 实测时捕获的错误。
 * @returns `invalid`（确定不能用）或 `unknown`（没能判定）。
 */
export function probeVerdictOf(error: unknown): "invalid" | "unknown" {
  const status = error instanceof SearchApiError ? error.status : undefined;
  if (status === 401 || status === 402 || status === 403) return "invalid";
  return "unknown";
}

/**
 * 实测一把搜索密钥：发一次**最小**请求，回答它到底能不能用。
 *
 * 与正式搜索的区别只有两点，都是为了「小」：
 * 1. `query` 固定成一个短词、`count: 1` —— 计费按请求次数，最小化请求即最小化开销；
 * 2. **空结果算成功**（`ok`）：那说明鉴权与配额都通过了，只是这个词没搜到东西。
 *    这正是「密钥能用」要证明的事，不该误报成不可用。
 *
 * 早期版本还会在本地先挡掉含非 ASCII 的密钥（那种值会在构造请求头时就抛
 * `Cannot convert argument to a ByteString`），现在交给 `probeVerdictOf` 归到 `unknown`
 * 之外的 `invalid` 更准确 —— 见下面的显式判断。
 * @param input - 密钥与注入的 fetch。
 * @returns 结论与可读原因。
 */
export async function probeSearchKey(input: {
  key: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ state: "ok" | "invalid" | "unknown"; reason?: string }> {
  // 先做一次本地形状检查：非 ASCII 的值**不可能是** DeepSeek 密钥（粘贴错了），
  // 而且它会让 fetch 在构造头时就抛一个对用户毫无意义的 ByteString 错误。
  if (/[^\x20-\x7E]/.test(input.key)) {
    return { state: "invalid", reason: "密钥里含非 ASCII 字符（多半是粘贴错了，把中文或空格存进来了）" };
  }
  try {
    await searchViaApi({ query: "deepseek", key: input.key, maxResults: 1, fetchImpl: input.fetchImpl, ...(input.signal === undefined ? {} : { signal: input.signal }) });
    return { state: "ok" };
  } catch (error) {
    const state = probeVerdictOf(error);
    return { state, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 发一次 Search API 请求。
 * @param input - 查询、密钥与注入的 fetch。
 * @returns 来源列表（可能为空 —— 空结果是合法结果）。
 * @throws {SearchApiError} HTTP 失败或响应形状不认识。
 */
export async function searchViaApi(input: ApiSearchInput): Promise<ApiSearchResult> {
  const body: Record<string, unknown> = { query: input.query };
  // `count` 只在用户给了合法值时才发：编一个值会让服务端按我们的猜测裁剪。
  if (input.maxResults !== undefined && Number.isFinite(input.maxResults)) {
    body.count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(input.maxResults)));
  }
  // `need_content` 保持缺省（false）：网页正文不进上下文，省 token 也省带宽。

  /*
   * **内部硬超时 + 合并调用方 signal**（2026-11-10 审查 A08）：
   * 与网关路同一套 —— 任一条件成立都让请求停下，而不是「有 signal 就没上限」。
   */
  const deadline = AbortSignal.timeout(API_SEARCH_TIMEOUT_MS);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);

  const response = await input.fetchImpl(`${SEARCH_API_BASE}${SEARCH_API_PATH}`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    // 尽力读出正文里的 message，但**不因为读不出来而改变失败语义**。
    let detail: string | undefined;
    try {
      const read = await readBoundedJsonResult(response, API_SEARCH_BODY_LIMIT);
      detail = read.kind === "json" ? messageOf(read.value) : undefined;
    } catch {
      detail = undefined;
    }
    const reason = reasonOf(response.status);
    throw new SearchApiError(detail === undefined ? reason : `${reason}：${detail}`, response.status);
  }

  /*
   * 有界读取（审查 A08）：原来直接 `await response.json()`，没有字节上限。
   * `kind === "invalid"` 时按「形状不认识」报错 —— 不能把一次协议变更误读成
   * 「今天没有热点」（空 results 才是合法空结果）。
   */
  let payload: unknown;
  try {
    const read = await readBoundedJsonResult(response, API_SEARCH_BODY_LIMIT);
    if (read.kind !== "json") {
      throw new SearchApiError(
        read.kind === "empty" ? "Search API 返回了空正文" : "Search API 响应不是合法 JSON",
      );
    }
    payload = read.value;
  } catch (error) {
    if (error instanceof SearchApiError) throw error;
    throw new SearchApiError(
      `Search API 响应读取失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const results = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) {
    // 形状不认识 ≠ 没搜到：后者是 `results: []`（合法）。这里必须报错，
    // 否则一次协议变更会被误读成「今天没有热点」。
    throw new SearchApiError("Search API 响应里没有 results 数组");
  }

  const sources: ApiSearchSource[] = [];
  for (const item of results) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" && record.url !== "" ? record.url : undefined;
    // 没有 url 的条目丢掉：界面上它就是一个点不动的链接。
    if (url === undefined) continue;
    const title = typeof record.title === "string" && record.title !== "" ? record.title : url;
    sources.push({ url, title });
  }
  return { sources };
}
