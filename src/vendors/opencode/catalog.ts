/**
 * opencode 目录：`/models` 清单 + models.dev 元数据 → 统一目录条目。
 *
 * 纯解析加一层带 TTL 的内存缓存，形状逐条对照旧插件 `dsh-opencode-go/lib/index.js`：
 * - 清单：`readLiveModelIds`（**第 6444-6461 行**）、`fetchLiveModelIds`（**第 6462-6489 行**），
 *   端点 `${baseURL}/models`（**第 6463 行**），`data` 数组里只有非空字符串 `id` 才算有效行；
 * - 元数据：`MODEL_METADATA_URL`（**第 6104 行**）与 `readModelMetadata`（**第 6168-6231 行**），
 *   取 `payload["opencode-go"].models[id]` 的 `name` / `limit.context` / `limit.output` /
 *   `modalities.input` / `reasoning` / `provider.npm`；
 * - 归属：**清单的 id 决定成员，元数据决定怎么调用**（旧插件 `build` 第 6639-6641 行的注释）；
 * - 域校验：只把 `opencode.ai` 域当目录来源（旧插件第 8662-8665 行的 `DISCOVERY_UNSUPPORTED`）。
 *
 * 与旧插件的差别（本期范围）：
 * - **不落盘**：旧插件把元数据写进 `~/.dsh/cache/dsh-opencode-go/models.dev.api.json`
 *   （第 6363 行）；本期只要求解析 + 可注入 `fetchImpl` + 内存 TTL；
 * - **不做 builtin 兜底表**：旧插件有一份内置模型表；本期元数据拿不到就只用清单
 *   （名字退回 id、无上下文/输出上限），**不补 0**（缺失就是缺失）；
 * - `modelLimits` 覆盖由适配器在 `resolveModel` 里应用，不在这里。
 * @module dsh-llm-account/src/vendors/opencode/catalog
 */
import { LlmError } from "@deepseek-ai/dsh-llm";
import type { ModelModality } from "@deepseek-ai/dsh-llm";

import type { CatalogEntry } from "../../core/adapter";
import { BodyTooLargeError, readBoundedText } from "../../core/bounded-body";
import { assignUniqueNames } from "../../core/model-names";
import {
  DEFAULT_API,
  DEFAULT_CATALOG_TTL_MS,
  METADATA_MAX_BYTES,
  MODELS_FETCH_TIMEOUT_MS,
  MODELS_MAX_BYTES,
  apiForNpm,
  assertOpencodeBase,
  catalogRequest,
  isRecord,
  metadataRequest,
} from "./protocol";

/**
 * 元数据（models.dev）的默认预算：**4 秒**。
 *
 * 实测该端点 2.8s 起步、偶发 18s 失败、最坏 197s；而它只提供建议性事实
 * （上下文/输出/模态/协议），档位已由网关 `/models` 提供。等它就会「切模型反应好半天」
 * （2026-11-04 报障），所以给它一个明显短于网关请求的预算，超时直接用清单事实。
 */
const METADATA_BUDGET_MS = 4_000;
import type { OpencodeApi } from "./protocol";

/** models.dev 里这条网关的 provider 键（旧插件 `record(body)["opencode-go"]` 第 6169 行）。 */
const SDK_PROVIDER_KEY = "opencode-go";

/** 一次目录清单解析的结果。 */
export interface CatalogParseResult {  /** 可用的目录条目，保持输入顺序。 */
  entries: CatalogEntry[];
  /** 被忽略的行数（缺少非空 `id`，或整行不是对象）。 */
  ignored: number;
}

/** 读取非空字符串。 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** 读取正数（上下文窗口与输出上限为 0 或负数时视为未公布）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 读出一行声明的输入模态；未声明就是未知，不猜。 */
function inputModalitiesOf(value: unknown): readonly ModelModality[] {
  const declared = isRecord(value) ? value.input : undefined;
  if (Array.isArray(declared) && declared.includes("image")) return ["text", "image"];
  return ["text"];
}

/**
 * 解析一份 `/models` 清单（旧插件 `readLiveModelIds` 第 6444-6461 行）。
 *
 * 有效的行只需要非空 `id`（在线清单常常只给 id，名字与上限来自元数据）；`name` 缺省时
 * 退回 id。`contextWindow` / `maxTokens` 未公布时**不写**该字段，让「未公布」与
 * 「公布为 0」在数据上可区分。
 *
 * 展示名由 id 派生（`assignUniqueNames`），与另两家同一套规则；清单里的 `name` 不参与
 * 展示（同一模型在三家网关写法不同，见 `core/model-names` 的说明）。
 * @param payload - 已解析的响应正文（形状不可信）。
 * @returns 可用条目与被忽略的行数。
 */
export function parseModels(payload: unknown): CatalogParseResult {
  if (!isRecord(payload)) return { entries: [], ignored: 0 };
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const entries: Omit<CatalogEntry, "name">[] = [];
  let ignored = 0;

  for (const raw of rows) {
    if (!isRecord(raw)) {
      ignored += 1;
      continue;
    }
    const id = stringValue(raw.id);
    if (id === undefined) {
      ignored += 1;
      continue;
    }
    const contextWindow = positiveNumber(raw.context_length ?? raw.contextWindow);
    const maxTokens = positiveNumber(raw.max_output_tokens ?? raw.maxTokens);
    /**
     * 网关自己公布的档位：`capabilities.reasoning.effort`。
     *
     * 2026-11-03 报障 `does not support reasoning effort "max"` 的根因就在这一行之前：
     * 档位**只**从 models.dev 元数据（`reasoning_options`）来，而那次抓取会失败/漏字段，
     * 于是 `efforts` 变成空数组，宿主认为该模型没有档位 —— 用户选着 `max` 的请求被拒。
     * 而 `/models` 是**目录本身的必需请求**，它公布的档位永远拿得到，比 models.dev 可靠。
     */
    const gatewayEfforts = effortsOfCapabilities(raw.capabilities);
    entries.push({
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(gatewayEfforts === undefined ? {} : { efforts: gatewayEfforts }),
      inputModalities: inputModalitiesOf(raw),
    });
  }

  const names = assignUniqueNames(entries.map((entry) => entry.id));
  return {
    entries: entries.map((entry, index) => ({ ...entry, name: names[index] ?? entry.id })),
    ignored,
  };
}

/** models.dev 为一条模型给出的元数据（全部可选：缺失就是未知）。 */
export interface ModelMetadata {
  /** 用户可见名称。 */
  name?: string;
  /** 上下文窗口（`limit.context`）。 */
  contextWindow?: number;
  /** 最大输出 token（`limit.output`）。 */
  maxTokens?: number;
  /** 声明的推理档位（`reasoning_options` 里 `type: "effort"` 的取值）。 */
  efforts?: readonly string[];
  /** 声明的输入模态（`modalities.input`）。 */
  inputModalities?: readonly ModelModality[];
  /** 该模型的线协议（由 `provider.npm` 决定，旧插件第 6188 行）。 */
  api?: OpencodeApi;
  /** 是否声明了推理能力。 */
  reasoning?: boolean;
  /** 归属公司（`canonical_model_id` 的斜杠前一段）。 */
  company?: string;
  /** 输入/输出单价都为 0：免费模型。 */
  free?: boolean;
  /** 是否开源权重（用于未来的分组/标记，先透传）。 */
  openWeights?: boolean;
}

/**
 * 解析 models.dev 元数据（旧插件 `readModelMetadata` 第 6168-6231 行）。
 *
 * 只认 `payload["opencode-go"].models`；单条模型解析不了就跳过该条（旧插件把失败
 * 记进 `errors` 并把该 id 标成「元数据不可用」，本期直接用清单事实兜底）。
 * @param payload - `https://models.dev/api.json` 的响应正文。
 * @returns 模型 id → 元数据。
 */
export function parseModelMetadata(payload: unknown): Map<string, ModelMetadata> {
  const result = new Map<string, ModelMetadata>();
  if (!isRecord(payload)) return result;
  const provider = payload[SDK_PROVIDER_KEY];
  if (!isRecord(provider) || !isRecord(provider.models)) return result;
  const fallbackNpm = provider.npm;

  for (const [id, value] of Object.entries(provider.models)) {
    if (!isRecord(value)) continue;
    const limit = isRecord(value.limit) ? value.limit : {};
    const metadata: ModelMetadata = {};
    const name = stringValue(value.name);
    if (name !== undefined) metadata.name = name;
    const contextWindow = positiveNumber(limit.context);
    if (contextWindow !== undefined) metadata.contextWindow = contextWindow;
    const maxTokens = positiveNumber(limit.output);
    if (maxTokens !== undefined) metadata.maxTokens = maxTokens;
    const modalities = isRecord(value.modalities) ? value.modalities.input : undefined;
    if (Array.isArray(modalities)) {
      metadata.inputModalities = modalities.includes("image") ? ["text", "image"] : ["text"];
    }
    if (typeof value.reasoning === "boolean") metadata.reasoning = value.reasoning;
    const efforts = effortsOf(value.reasoning_options);
    if (efforts.length > 0) metadata.efforts = efforts;
    const npm = (isRecord(value.provider) ? value.provider.npm : undefined) ?? fallbackNpm;
    const api = apiForNpm(npm);
    if (api !== undefined) metadata.api = api;
    const canonical = stringValue(value.canonical_model_id);
    if (canonical !== undefined) {
      const company = canonical.split("/")[0];
      if (company !== undefined && company !== "") metadata.company = company;
    }
    const cost = isRecord(value.cost) ? value.cost : undefined;
    if (cost !== undefined) {
      const input = typeof cost.input === "number" ? cost.input : undefined;
      const output = typeof cost.output === "number" ? cost.output : undefined;
      if (input === 0 && output === 0) metadata.free = true;
    }
    if (typeof value.open_weights === "boolean") metadata.openWeights = value.open_weights;
    result.set(id, metadata);
  }
  return result;
}

/**
 * `reasoning_options` 里 `type: "effort"` 的取值（旧插件第 6131-6138 行）。
 *
 * **两种形状都要认**（2026-11-04 实测）：
 *
 * - **对象**（models.dev 现在的真实形状）：
 *   `{"type":"effort","values":["low","high","max"]}` —— 取自 live `api.json`；
 * - **数组**（旧插件与部分历史快照）：
 *   `[{"type":"effort","values":[…]}, …]`。
 *
 * 原来只认数组，于是线上元数据的档位**永远读不出来**（`effortsOf` 恒返回空数组）。
 * 现在先按对象读，不成再按数组遍历。
 * @param value - `reasoning_options` 原值。
 * @returns 档位数组（可能为空）。
 */
function effortsOf(value: unknown): readonly string[] {
  const collect = (option: unknown): string[] => {
    if (!isRecord(option) || option.type !== "effort" || !Array.isArray(option.values)) return [];
    const efforts: string[] = [];
    for (const level of option.values) {
      if (typeof level === "string" && level !== "" && level !== "none") efforts.push(level);
    }
    return efforts;
  };
  // 单个对象形状（线上实际形态）。
  if (isRecord(value)) return collect(value);
  if (!Array.isArray(value)) return [];
  const efforts: string[] = [];
  for (const option of value) efforts.push(...collect(option));
  return efforts;
}

/**
 * 网关 `/models` 的 `capabilities.reasoning.effort` → 档位数组。
 *
 * 2026-11-03 报障 `does not support reasoning effort "max"` 的修复点：
 * 之前档位**只**来自 models.dev 元数据（`reasoning_options`），那次抓取失败或漏字段时
 * 就是空数组，宿主据此判定「这个模型没有档位」，把用户选的 `max` 请求直接拒掉。
 * 而 `/models` 是目录本身的必需请求，公布的档位永远拿得到。
 *
 * 与 {@link effortsOf} 的区别：那边是 models.dev 的 `{type:"effort",values:[…]}` 形状，
 * 这边是网关直接给的字符串数组。
 * @param capabilities - `/models` 条目的 `capabilities`。
 * @returns 档位数组；没有可用档位时 `undefined`（不产出 `[]`，让「未声明」与「空」可区分）。
 */
function effortsOfCapabilities(capabilities: unknown): readonly string[] | undefined {
  if (!isRecord(capabilities)) return undefined;
  const reasoning = capabilities.reasoning;
  if (!isRecord(reasoning)) return undefined;
  if (!Array.isArray(reasoning.effort)) return undefined;
  const efforts: string[] = [];
  for (const level of reasoning.effort) {
    if (typeof level === "string" && level !== "") efforts.push(level);
  }
  return efforts.length === 0 ? undefined : efforts;
}

/** 目录里一条模型：宿主可见的条目 + 请求时需要的协议事实。 */
export interface OpencodeCatalogRecord {
  /** 宿主形状的目录条目。 */
  entry: CatalogEntry;
  /** 该模型的线协议。 */
  api: OpencodeApi;
  /** 是否声明了推理能力。 */
  reasoning: boolean;
  /** 该模型声明的推理档位。 */
  efforts: readonly string[];
  /** 归属公司键（canonical id 的斜杠前一段）。 */
  company?: string;
  /** 目录明确标成免费。 */
  free?: boolean;
}

/**
 * 一次在途加载。
 *
 * **为什么需要「代号 + 共享 controller」**（2026-11-05 外部审查 F01）：
 *
 * 上一版用单个 `inFlight` 变量兼职三件事 —— 并发去重、结果回写、指针清理 ——
 * 于是产生两个可复现的缺陷：
 *
 * 1. **旧结果覆盖新结果**：`fresh` 只是 `inFlight = undefined`，旧 Promise 并未取消；
 *    它稍后完成时照样执行 `cached = records`，用户点了刷新，缓存又被打回旧值。
 * 2. **取消串扰**：所有等待者共享**第一个调用方**的 signal。A 取消时底层请求被取消，
 *    还在等的 B 跟着一起失败 —— 尽管 B 自己的信号好好的。
 *
 * 现在：每次加载有自己的 `generation` 与 `AbortController`。
 * - 只有 `generation === generationSeq`（最新一代）的结果允许写缓存；
 * - `finally` 只在 `current === entry` 时清指针，旧加载不会把新指针抹掉；
 * - 调用方的 signal **只取消自己的等待**，全部等待者都走了才 abort 共享请求。
 */
interface CatalogLoad {
  /** 本次加载的唯一代号（递增）。 */
  readonly generation: number;
  /** 共享的取消入口：所有等待者都放弃时才 abort。 */
  readonly controller: AbortController;
  /** 结果 promise（所有等待者共用同一次网络请求）。 */
  promise: Promise<OpencodeCatalogRecord[]>;
  /** 仍在等待的调用方数量。 */
  waiters: number;
}

export interface OpencodeCatalog {
  /**
   * @param signal - 调用方取消信号（`listModels`/`resolveModel` 传自己的信号）。
   * @param fresh - 绕过 TTL 缓存重读（刷新按钮，审查 U10）。
   */
  list(signal?: AbortSignal, fresh?: boolean): Promise<OpencodeCatalogRecord[]>;
}

/**
 * 读一段**真正有界**的 JSON 正文（目录请求用）。
 *
 * ## 实现已下沉到 `core/bounded-body`（2026-11-05 复审的去重项）
 *
 * 这里原先有一份完整的分块实现，OAuth 那边（F13）又写了一份**同样的逻辑**。
 * 两份实现意味着**两处都要修、两处都可能漏** —— 与
 * `docs/HANDOVER-2.0.0.md` §5.5 是同一条教训。现在共用一份，各自保留自己的
 * 错误映射：目录侧翻译成 `DISCOVERY_FAILED`，OAuth 侧抛原始错误让调用方分类。
 *
 * 保留的语义与原来一致：
 * - 按 **UTF-8 字节**计（不是字符数）；
 * - `Content-Length` 先快速拒绝；
 * - 超限**立刻 cancel**，后面的 chunk 不再索取；
 * - 非法 JSON → `DISCOVERY_FAILED`。
 * @param response - 已拿到响应头的响应。
 * @param limit - 允许的最大**字节**数。
 * @returns 解析后的 JSON。
 * @throws {@link LlmError} 超限或非法 JSON 时（码都是 `DISCOVERY_FAILED`）。
 */
async function readJsonBounded(response: Response, limit: number): Promise<unknown> {
  let text: string;
  try {
    text = await readBoundedText(response, limit);
  } catch (error: unknown) {
    if (error instanceof BodyTooLargeError) {
      throw new LlmError(`opencode catalog response exceeds the ${limit} byte limit`, "DISCOVERY_FAILED", {
        cause: error,
      });
    }
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new LlmError("opencode catalog response is not valid JSON", "DISCOVERY_FAILED", { cause: error });
  }
}

/**
 * 造一份带 TTL 的内存目录缓存（旧插件 `OpencodeGoCatalog` 第 6510-6710 行的精简版：
 * 只保留「清单 + 元数据 → 记录」与刷新窗口，不落盘、不做 ETag/条件请求）。
 * @param input - 基地址、注入的 `fetch`、TTL 与时钟。
 * @returns 目录来源。
 */
export function createOpencodeCatalog(input: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  ttlMs?: number;
  now?: () => number;
  /**
   * 元数据的**独立预算**（毫秒）；缺省 {@link METADATA_BUDGET_MS}。
   *
   * 元数据只提供能力事实（上下文、输出、模态、协议），**档位已由网关 `/models` 提供**，
   * 所以它慢不该拖住切模型（2026-11-04 报障「切模型反应好半天」）。
   */
  metadataBudgetMs?: number;
}): OpencodeCatalog {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs !== undefined && Number.isFinite(input.ttlMs) && input.ttlMs >= 0 ? input.ttlMs : DEFAULT_CATALOG_TTL_MS;
  /**
   * 元数据预算默认取得比网关请求短得多：实测 `models.dev` 一次 2.8s、一次 18.5s 失败、
   * 一次 **197s**。它是建议性的，等它不如用清单事实先把模型列表给出去。
   */
  const metadataBudgetMs =
    input.metadataBudgetMs !== undefined && Number.isFinite(input.metadataBudgetMs) && input.metadataBudgetMs > 0
      ? input.metadataBudgetMs
      : METADATA_BUDGET_MS;
  let cached: OpencodeCatalogRecord[] | undefined;
  let expiresAt = 0;
  /** 最新一代的代号：只有它返回的结果允许写缓存。 */
  let generationSeq = 0;
  /** 当前共享的在途加载（并发去重）。 */
  let current: CatalogLoad | undefined;

  const requestSignal = (signal: AbortSignal | undefined, budgetMs: number): AbortSignal =>
    signal === undefined ? AbortSignal.timeout(budgetMs) : AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]);

  const listing = async (signal: AbortSignal | undefined): Promise<CatalogEntry[]> => {
    assertOpencodeBase(input.baseUrl);
    const { url, headers } = catalogRequest(input.baseUrl);
    const response = await input.fetchImpl(url, { headers, signal: requestSignal(signal, MODELS_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new LlmError(`opencode models endpoint returned ${response.status}`, "DISCOVERY_FAILED", {
        status: response.status,
      });
    }
    const parsed = parseModels(await readJsonBounded(response, MODELS_MAX_BYTES));
    if (parsed.entries.length === 0 && parsed.ignored > 0) {
      // 旧插件第 6458 行：非空清单一行有效 id 都没有，是发现失败，不是「没有模型」。
      throw new LlmError("the opencode model listing has no valid model ids", "DISCOVERY_FAILED");
    }
    return parsed.entries;
  };

  const metadata = async (signal: AbortSignal | undefined): Promise<Map<string, ModelMetadata>> => {
    try {
      const { url, headers } = metadataRequest();
      const response = await input.fetchImpl(url, { headers, signal: requestSignal(signal, metadataBudgetMs) });
      if (!response.ok) return new Map();
      return parseModelMetadata(await readJsonBounded(response, METADATA_MAX_BYTES));
    } catch {
      // 元数据是建议性的：拿不到就用清单事实（旧插件也保留上一份可用配置继续服务）。
      return new Map();
    }
  };

  const load = async (signal: AbortSignal | undefined): Promise<OpencodeCatalogRecord[]> => {
    /**
     * **两个请求并行发**（2026-11-04 修「切模型反应好半天」）。
     *
     * 原来是 `await listing(); await metadata();` —— 串行。元数据（`models.dev`，5.7 MB）
     * 实测 2.8s / 18.5s 失败 / **197s**，而它只是建议性的，却把整条路径堵在最慢那个上。
     *
     * 现在：
     * - 并行发出，总耗时 ≈ max(清单, 元数据) 而不是两者之和；
     * - 元数据有自己的短预算（{@link METADATA_BUDGET_MS}），超时就用清单事实继续 ——
     *   档位、上下文、模态在清单里都有兜底值（`entry.efforts` 等）；
     * - 清单失败仍然整次失败：没有清单就没有目录，不能编。
     */
    const [entries, metadataById] = await Promise.all([listing(signal), metadata(signal)]);
    // 展示名在**合并之后**统一派生：清单层派生的名字会被 models.dev 的 `name` 覆盖，
    // 而元数据的名字写法与另两家不同（`DeepSeek V4.1 Flash` vs `DeepSeek-V4.1-Flash`）。
    // 元数据只提供能力事实（上下文、输出、档位、模态、协议），名字一律走统一规则。
    const names = assignUniqueNames(entries.map((entry) => entry.id));
    const records = entries.map((entry, index): OpencodeCatalogRecord => {
      const meta = metadataById.get(entry.id);
      const contextWindow = meta?.contextWindow ?? entry.contextWindow;
      const maxTokens = meta?.maxTokens ?? entry.maxTokens;
      // 档位来源优先级：网关 `/models` 的 capabilities → models.dev 的 reasoning_options。
      const efforts = entry.efforts ?? meta?.efforts;
      return {
        entry: {
          id: entry.id,
          name: names[index] ?? entry.name,
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxTokens === undefined ? {} : { maxTokens }),
          // **网关公布的档位优先**：`/models` 是目录本身的必需请求，永远拿得到；
          // models.dev 元数据可能抓取失败。反过来会让用户选的 `max` 被宿主拒掉（2026-11-03 报障）。
          ...(efforts === undefined ? {} : { efforts }),
          inputModalities: meta?.inputModalities ?? entry.inputModalities,
        },
        api: meta?.api ?? DEFAULT_API,
        reasoning: meta?.reasoning === true,
        efforts: efforts ?? [],
        ...(meta?.company === undefined ? {} : { company: meta.company }),
        ...(meta?.free === true ? { free: true } : {}),
      };
    });
    return records;
  };

  return {
    /**
     * 读目录（带 TTL 缓存）。
     *
     * @param signal - 调用方取消信号。**只取消自己的等待**，不影响其他等待者（F01）。
     * @param fresh - **绕过缓存**（2026-11-04 外部审查 U10）。
     *
     *   `CatalogModelsPort.catalogModels(fresh)` 的契约就是「刷新按钮必须真的重读」，
     *   而这里原来只收 `signal`、无条件走 TTL —— 用户在 TTL 内点刷新，界面就是
     *   「点了没反应」，服务端已经变了的列表永远看不到。
     *
     * ## 并发语义（2026-11-05 外部审查 F01 重写）
     *
     * | 场景 | 行为 |
     * | --- | --- |
     * | 多个普通读取并发 | 共用同一次网络请求（去重） |
     * | `fresh` | **另起一代**，不复用在途请求；旧一代的结果**不再**能写缓存 |
     * | 某个调用方取消 | 只有它自己 reject；共享请求活到最后一个等待者也走掉 |
     * | 旧加载的 `finally` | 不会清掉新一代的指针（比较 `current === entry`） |
     */
    async list(signal?: AbortSignal, fresh = false): Promise<OpencodeCatalogRecord[]> {
      const stamp = now();
      if (!fresh && cached !== undefined && stamp < expiresAt) return cached;

      // 已取消的调用方：连共享请求都不该发起（也不该占用别人的 in-flight）。
      if (signal?.aborted === true) throw cancelledError(signal);

      // fresh = 旧一代作废。这里**不** abort 旧 controller：它的等待者还要各自收尾，
      // 只是它写不了缓存了（generation 已过期）。
      if (fresh) {
        generationSeq += 1;
        current = undefined;
      }

      const existing = current;
      const entry = existing ?? startLoad();
      // 复用在途请求时**也要计入等待者**：全部走光才该 abort 共享请求。
      if (existing !== undefined) existing.waiters += 1;
      return waitFor(entry, signal);
    },
  };

  /**
   * 起一代新的加载。
   * @returns 新的在途加载（`waiters` 初始为 1，代表本次调用方）。
   */
  function startLoad(): CatalogLoad {
    const controller = new AbortController();
    const entry: CatalogLoad = {
      generation: generationSeq,
      controller,
      promise: undefined as unknown as Promise<OpencodeCatalogRecord[]>,
      waiters: 1,
    };
    entry.promise = load(controller.signal).then((records) => {
      // **只有最新一代能写缓存**：旧请求晚到时不覆盖用户刚刷新出来的结果。
      if (entry.generation === generationSeq) {
        cached = records;
        expiresAt = now() + ttlMs;
      }
      return records;
    });
    current = entry;
    // 指针清理用身份比较：旧一代的 finally 不能把新一代抹掉。
    void entry.promise
      .catch(() => {})
      .finally(() => {
        if (current === entry) current = undefined;
      });
    return entry;
  }

  /**
   * 等一份加载的结果，并把「调用方取消」与「加载失败」分开。
   *
   * 取消只 reject **本调用方**；`releaseWaiter` 在最后一个等待者离开时
   * abort 共享请求，所以一个组件取消不会拖死其他人（F01 的第二个缺陷）。
   * @param entry - 在途加载。
   * @param signal - 本调用方的取消信号。
   * @returns 目录记录。
   */
  async function waitFor(entry: CatalogLoad, signal: AbortSignal | undefined): Promise<OpencodeCatalogRecord[]> {
    if (signal === undefined) return entry.promise;
    if (signal.aborted) {
      releaseWaiter(entry);
      throw cancelledError(signal);
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = (): void => {
        releaseWaiter(entry);
        reject(cancelledError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([entry.promise, aborted]);
    } finally {
      // 正常返回后摘掉监听：长命的调用方 signal 不该累积监听器。
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 一个等待者放弃；全部走光才 abort 共享请求（否则一个组件取消会拖死其他人）。
   * @param entry - 在途加载。
   */
  function releaseWaiter(entry: CatalogLoad): void {
    entry.waiters -= 1;
    if (entry.waiters > 0) return;
    if (current === entry) current = undefined;
    if (!entry.controller.signal.aborted) entry.controller.abort();
  }

  /** 调用方取消时的错误（带 `signal.reason`，便于上游区分「谁取消的」）。 */
  function cancelledError(signal: AbortSignal): LlmError {
    return signal.reason === undefined
      ? new LlmError("the caller aborted the catalog read", "ABORTED")
      : new LlmError("the caller aborted the catalog read", "ABORTED", { cause: signal.reason });
  }
}
