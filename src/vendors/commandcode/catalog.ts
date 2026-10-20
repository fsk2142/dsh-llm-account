/**
 * Command Code 目录负载 → 统一目录条目。
 *
 * 纯解析：坏行忽略并计数，绝不因为一行残缺就丢掉整份目录。字段名对照旧插件
 * `@mars-sea/dsh-commandcode-provider/lib/index.js` 的 `normalizeModel`
 * （第 5216-5231 行）：线上是 `context_length` / `max_output_tokens` /
 * `supported_endpoints`，本地缓存文件里是驼峰拼写，两种都认。
 *
 * **本期不做**：套餐过滤（`supportedEndpoints` 只用来选协议）、免费模型置顶、
 * 能力描述文案 —— 那些属于第 2 期（设计 §7.1 与计划 Task 9 的控制器补充第 3 条）。
 * @module dsh-llm-account/src/vendors/commandcode/catalog
 */
import type { ModelModality } from "@deepseek-ai/dsh-llm";

import type { CatalogEntry } from "../../core/adapter";
import { assignUniqueNames } from "../../core/model-names";

/** 一次目录解析的结果。 */
export interface CatalogParseResult {
  /** 可用的目录条目，保持输入顺序。 */
  entries: CatalogEntry[];
  /** 被忽略的行数（缺少 id/name，或整行不是对象）。 */
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
 * 从一行里取出模型数组：线上形状是 `{ object: "list", data: [...] }`，
 * 缓存与搜索形状是 `{ models: [...] }`，两种都认。
 * @param payload - 目录负载。
 * @returns 待解析的原始行；形状不认识时为空数组。
 */
function rowsOf(payload: Record<string, unknown>): readonly unknown[] {
  if (Array.isArray(payload.models)) return payload.models;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

/**
 * 读出一行的输入模态。
 *
 * 只信负载自己声明的能力：`modalities` 数组里的 `"image"`，或布尔 `image: true`。
 * 旧插件用一份 `KNOWN_IMAGE_MODELS` 常量表兜底（第 462 行起），本期不搬那份表 ——
 * 未声明就是**未知**，不猜（与「额度缺失不倒成 0」同一条纪律）。
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
 * 只信负载自己声明的档位（`efforts` / `supported_efforts` / `reasoning_efforts`）；
 * 旧插件用一份 `KNOWN_EFFORTS` 常量表兜底（第 115 行起、约 350 行数据），本期不搬 ——
 * 未声明就是**未知**，不猜。
 * @param row - 一行原始目录数据。
 * @returns 档位 id（按负载顺序）；未声明时为空数组。
 */
function effortsOf(row: Record<string, unknown>): readonly string[] {
  const declared = row.efforts ?? row.supported_efforts ?? row.reasoning_efforts;
  if (!Array.isArray(declared)) return [];
  return declared.filter((item): item is string => typeof item === "string" && item !== "");
}

/**
 * 解析一份 Command Code 目录负载。
 *
 * 有效的行必须同时有非空 `id` 与非空 `name`（旧插件 `normalizeModel` 第 5218-5220 行
 * 的同一道门槛）；其余行计入 `ignored`。`contextWindow` / `maxTokens` 缺失时**不写**
 * 该字段，让「未公布」与「公布为 0」在数据上可区分。
 *
 * **展示名不用负载里的 `name`**：那份 name 带网关自己的标记（`DeepSeek V4.1 Flash (CC)`、
 * `… (latest)`），与另两家的同一模型写法不同（2026-10-20 报障「模型名称又不一致了」）。
 * name 只用来过上面那道门槛，展示名由 `assignUniqueNames` 统一从 id 派生。
 * @param payload - 已解析的响应正文（形状不可信）。
 * @returns 可用条目与被忽略的行数。
 */
export function parseCatalog(payload: unknown): CatalogParseResult {
  if (!isRecord(payload)) return { entries: [], ignored: 0 };
  const rows = rowsOf(payload);
  const entries: Omit<CatalogEntry, "name">[] = [];
  let ignored = 0;

  for (const raw of rows) {
    if (!isRecord(raw)) {
      ignored += 1;
      continue;
    }
    const id = stringValue(raw.id);
    const name = stringValue(raw.name);
    if (id === undefined || name === undefined) {
      ignored += 1;
      continue;
    }
    const contextWindow = positiveNumber(raw.context_length ?? raw.contextWindow);
    const maxTokens = positiveNumber(raw.max_output_tokens ?? raw.maxTokens ?? raw.publishedMaxTokens);
    const efforts = effortsOf(raw);
    entries.push({
      id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(efforts.length === 0 ? {} : { efforts }),
      inputModalities: inputModalitiesOf(raw),
    });
  }

  const names = assignUniqueNames(entries.map((entry) => entry.id));
  return {
    entries: entries.map((entry, index) => ({ ...entry, name: names[index] ?? entry.id })),
    ignored,
  };
}
