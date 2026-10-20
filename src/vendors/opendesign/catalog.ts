/**
 * Open Design 目录负载 → 统一目录条目。
 *
 * 纯解析：坏行忽略并计数，绝不因为一行残缺就丢掉整份目录。线上形状是 OpenAI 的
 * `GET /v1/models`（计划 §0）：`{ object: "list", data: [{ id, ... }] }`。字段名对照另两家的
 * 同一套收窄规则（`commandcode/catalog.ts`）：`id` 与 `name` 必须非空，其余字段缺失就是
 * **未公布**，不猜（与「额度缺失不倒成 0」同一条纪律）。
 *
 * **可见性过滤不在本模块**：`visibleModels` / `modelVisibility` / `removedModels` 的投影住在
 * 适配器（与另两家同一条分工），本模块只回答「这份负载里有哪些模型」。
 * @module dsh-llm-account/src/vendors/opendesign/catalog
 */
import type { ModelModality } from "@deepseek-ai/dsh-llm";

import type { CatalogEntry } from "../../core/adapter";
import { assignUniqueNames, officialModelName } from "../../core/model-names";

/** 一次目录解析的结果。 */
export interface CatalogParseResult {
  /** 可用的目录条目，保持输入顺序。 */
  entries: CatalogEntry[];
  /** 被忽略的行数（缺少 id，或整行不是对象）。 */
  ignored: number;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取非空字符串（目录里的 id/name 必须是非空字符串才算有效）。 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** 读取正数（上下文窗口与输出上限为 0 或负数时视为未公布）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 从一份负载里取出模型数组。
 *
 * 线上是 `{ object: "list", data: [...] }`；网关的其它端点与本地缓存可能给
 * `{ models: [...] }`（与另两家同一份容错），两种都认。
 * @param payload - 目录负载。
 * @returns 待解析的原始行；形状不认识时为空数组。
 */
function rowsOf(payload: Record<string, unknown>): readonly unknown[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.models)) return payload.models;
  return [];
}

/**
 * 读出一行的输入模态。
 *
 * 只信负载自己声明的能力：`modalities` 数组里的 `"image"`，或布尔 `image: true`
 * （旧插件的模型表属第 2 期，本期不搬）。未声明就是**未知**，不猜。
 * @param row - 一行原始目录数据。
 * @returns 至少含 `"text"` 的模态列表。
 */
function inputModalitiesOf(row: Record<string, unknown>): readonly ModelModality[] {
  const declared = row.modalities;
  const fromList = Array.isArray(declared) && declared.includes("image");
  if (fromList || row.image === true) return ["text", "image"];
  return ["text"];
}

/**
 * 读出一行声明的推理档位。
 *
 * 只信负载自己声明的档位（`efforts` / `supported_efforts` / `reasoning_efforts`）：未声明
 * 就是**未知**，不猜（适配器随之不向宿主声明档位）。
 * @param row - 一行原始目录数据。
 * @returns 档位 id（按负载顺序）；未声明时为空数组。
 */
function effortsOf(row: Record<string, unknown>): readonly string[] {
  const declared = row.efforts ?? row.supported_efforts ?? row.reasoning_efforts;
  if (!Array.isArray(declared)) return [];
  return declared.filter((item): item is string => typeof item === "string" && item !== "");
}

/**
 * 解析一份 Open Design 目录负载。
 *
 * 有效的行只要有非空 `id`：OpenAI 形状的 `/v1/models` 常常**不带展示名**（线上就是
 * `{ id, object, created, owned_by }`），照搬另两家「缺 name 就忽略」会把整份目录丢光；
 * 缺 `name` 时按 `name = id` 收下，页面本来也是这么兜底的。
 * `contextWindow` / `maxTokens` 缺失时**不写**该字段，让「未公布」与「公布为 0」在数据上可区分。
 *
 * 展示名与另两家同一套：由 id 派生（{@link assignUniqueNames}）。负载给的 `name` 与 id
 * 不同时仍然优先 —— 这家哪天开始公布真名就以它为准，那是更新的真相；但它必须与另两家
 * 的写法一致才用得上（`name === id` 的回显照旧走规则）。
 * @param payload - 已解析的响应正文（形状不可信）。
 * @returns 可用条目与被忽略的行数。
 */
export function parseCatalog(payload: unknown): CatalogParseResult {
  if (!isRecord(payload)) return { entries: [], ignored: 0 };
  const rows = rowsOf(payload);
  const entries: Omit<CatalogEntry, "name">[] = [];
  /** 每行声明的 name（可能缺省）；与 id 相同视为「没公布」。 */
  const declaredNames: (string | undefined)[] = [];
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
    const declared = stringValue(raw.name);
    declaredNames.push(declared !== undefined && declared !== id ? declared : undefined);
    // **opendesign 把容量放在嵌套的 `metadata` 里**（2026-10-20 用真实目录实测）：
    //
    // ```json
    // "metadata": { "context_limit": 1048000, "context_budget": 328000, "output_budget": 128000 }
    // ```
    //
    // 而它的**顶层没有** `context_length` / `max_output_tokens` —— 只认顶层的旧实现因此把
    // 12 个模型全部读成「没公布」，连带两个症状：① 宿主不显示会话长度；
    // ② 宿主的自动压缩插件读到 `info.context === undefined` 直接抛错，**该路由完全不压缩**，
    // 最终以 HTTP 400（上下文超限）收场（日志实测 91.6 万 token 时被拒）。
    //
    // 取值优先级：扁平字段（若有）> `metadata.context_limit`。仍取不到才留空 ——
    // 保持「未公布」与「公布为 0」的区别，不编数字。
    const meta = isRecord(raw.metadata) ? raw.metadata : undefined;
    const contextWindow = positiveNumber(
      raw.context_length ?? raw.contextWindow ?? meta?.context_limit ?? meta?.contextWindow,
    );
    const maxTokens = positiveNumber(
      raw.max_output_tokens ?? raw.maxTokens ?? raw.publishedMaxTokens ?? meta?.output_budget ?? meta?.max_output_tokens,
    );
    const efforts = effortsOf(raw);
    entries.push({
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(efforts.length === 0 ? {} : { efforts }),
      inputModalities: inputModalitiesOf(raw),
    });
  }

  const generated = assignUniqueNames(entries.map((entry) => entry.id));
  return {
    entries: entries.map((entry, index) => ({
      ...entry,
      name: declaredNames[index] ?? generated[index] ?? officialModelName(entry.id) ?? entry.id,
    })),
    ignored,
  };
}
