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
import {
  DEFAULT_API,
  DEFAULT_CATALOG_TTL_MS,
  METADATA_FETCH_TIMEOUT_MS,
  METADATA_MAX_BYTES,
  MODELS_FETCH_TIMEOUT_MS,
  MODELS_MAX_BYTES,
  apiForNpm,
  assertOpencodeBase,
  catalogRequest,
  isRecord,
  metadataRequest,
} from "./protocol";
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
 * @param payload - 已解析的响应正文（形状不可信）。
 * @returns 可用条目与被忽略的行数。
 */
export function parseModels(payload: unknown): CatalogParseResult {
  if (!isRecord(payload)) return { entries: [], ignored: 0 };
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  const entries: CatalogEntry[] = [];
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
    entries.push({
      id,
      name: stringValue(raw.name) ?? id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      inputModalities: inputModalitiesOf(raw),
    });
  }

  return { entries, ignored };
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
    result.set(id, metadata);
  }
  return result;
}

/** `reasoning_options` 里 `type: "effort"` 的取值（旧插件第 6131-6138 行）。 */
function effortsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const efforts: string[] = [];
  for (const option of value) {
    if (!isRecord(option) || option.type !== "effort" || !Array.isArray(option.values)) continue;
    for (const level of option.values) {
      if (typeof level === "string" && level !== "" && level !== "none") efforts.push(level);
    }
  }
  return efforts;
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
}

/** 目录来源：`list()` 交回合并后的记录（带 TTL 缓存）。 */
export interface OpencodeCatalog {
  /** @param signal - 调用方取消信号（`listModels`/`resolveModel` 传自己的信号）。 */
  list(signal?: AbortSignal): Promise<OpencodeCatalogRecord[]>;
}

/** 读一段有界的 JSON 正文（旧插件用 `fetchJsonResponse` 的字节上限做同一件事）。 */
async function readJsonBounded(response: Response, limit: number): Promise<unknown> {
  const text = await response.text();
  if (text.length > limit) {
    throw new LlmError(`opencode catalog response exceeds the ${limit} byte limit`, "DISCOVERY_FAILED");
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
}): OpencodeCatalog {
  const now = input.now ?? Date.now;
  const ttlMs = input.ttlMs !== undefined && Number.isFinite(input.ttlMs) && input.ttlMs >= 0 ? input.ttlMs : DEFAULT_CATALOG_TTL_MS;
  let cached: OpencodeCatalogRecord[] | undefined;
  let expiresAt = 0;
  let inFlight: Promise<OpencodeCatalogRecord[]> | undefined;

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
      const response = await input.fetchImpl(url, { headers, signal: requestSignal(signal, METADATA_FETCH_TIMEOUT_MS) });
      if (!response.ok) return new Map();
      return parseModelMetadata(await readJsonBounded(response, METADATA_MAX_BYTES));
    } catch {
      // 元数据是建议性的：拿不到就用清单事实（旧插件也保留上一份可用配置继续服务）。
      return new Map();
    }
  };

  const load = async (signal: AbortSignal | undefined): Promise<OpencodeCatalogRecord[]> => {
    const entries = await listing(signal);
    const metadataById = await metadata(signal);
    const records = entries.map((entry): OpencodeCatalogRecord => {
      const meta = metadataById.get(entry.id);
      const contextWindow = meta?.contextWindow ?? entry.contextWindow;
      const maxTokens = meta?.maxTokens ?? entry.maxTokens;
      return {
        entry: {
          id: entry.id,
          name: meta?.name ?? entry.name,
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxTokens === undefined ? {} : { maxTokens }),
          ...(meta?.efforts === undefined ? {} : { efforts: meta.efforts }),
          inputModalities: meta?.inputModalities ?? entry.inputModalities,
        },
        api: meta?.api ?? DEFAULT_API,
        reasoning: meta?.reasoning === true,
        efforts: meta?.efforts ?? [],
      };
    });
    return records;
  };

  return {
    async list(signal?: AbortSignal): Promise<OpencodeCatalogRecord[]> {
      const stamp = now();
      if (cached !== undefined && stamp < expiresAt) return cached;
      inFlight ??= load(signal)
        .then((records) => {
          cached = records;
          expiresAt = now() + ttlMs;
          return records;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
  };
}
