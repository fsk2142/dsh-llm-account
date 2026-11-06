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
 * 从 `metadata` 里读上下文容量：**取其中最大的那个**（2026-11-06 防回归）。
 *
 * 网关同时公布 `context_limit`（真天花板 ≈104.8 万）与 `context_budget`
 * （预算 23~40 万）。按定义 `budget = limit − 输出预留`，所以正常数据里 limit 永远更大。
 *
 * ## 哪个才是天花板：二分实测
 *
 * 对着 `deepseek-v4.1-flash` 直接发真实请求，用 `usage.prompt_tokens` 逐档加长：
 *
 * | prompt_tokens | 结果 |
 * | --- | --- |
 * | 978039 / 1017039 / 1036239 / 1045839 | 200 |
 * | **1048239** | **200**（最大一次成功） |
 * | 1048576 / 1048700 / 1049000 / 1049500 / 1050000 | 400 |
 * | **~1050419** | **400**（最小一次失败） |
 *
 * 天花板落在 1048239 与 1048576 之间，与 `context_limit`（1048000，≈1 MiB）吻合，
 * **与 328000 毫无关系**。opencode 公布的 `limit.context = 1000000` 是同一件事。
 *
 * ## 为什么不写成按字段名排序的 `??` 链
 *
 * 2.1.1 的事故正是因为有人把 `context_budget` 挪到了 `context_limit` 前面 —— 一行
 * 顺序调整，阈值就从 `floor(min(1048000×0.8, 1048000−128000−65536)) = 838400` 掉到
 * `floor(min(328000×0.8, 328000−128000−65536)) = 134464`（约 270 条消息），用户看到的是
 * 「会话刚开始就压缩」。**取最大值不依赖书写顺序**，这类改动于是不再可能悄悄改变行为。
 *
 * 万一哪天网关给出 `budget > limit`（按定义属于坏数据），取大值也仍是更安全的一侧：
 * 报大了只是压缩更晚触发，而上下文超限是**可自愈**的（宿主认那条 400，剪枝、压缩后
 * 重发）；报小了则是每一种会话都被提前压缩，且用户完全无从察觉。
 * @param meta - 已确认是普通对象的 `metadata`。
 * @returns 上下文窗口；三个字段里都没有正数时为 `undefined`（保持「未公布」，不编数字）。
 */
function capacityOf(meta: Record<string, unknown> | undefined): number | undefined {
  if (meta === undefined) return undefined;
  let best: number | undefined;
  for (const value of [meta.context_limit, meta.context_budget, meta.contextWindow]) {
    const candidate = positiveNumber(value);
    if (candidate !== undefined && (best === undefined || candidate > best)) best = candidate;
  }
  return best;
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
 * **opendesign 把能力放在嵌套的 `architecture` 里**（2026-10-20 用真实目录实测）：
 *
 * ```json
 * "architecture": { "input_modalities": ["text","image"], "output_modalities": ["text"] }
 * ```
 *
 * 顶层**没有** `modalities` / `image` 字段。只认顶层的旧实现因此把所有模型都读成
 * 「仅文本」—— 包括上游明确声明支持图片的 `deepseek-v4.1-flash`（`[text,image]`）、
 * `deepseek-v4-flash-vision-exp`、`kimi-k2.7-code` 等，宿主的图片按钮就永远不出现。
 *
 * 取值优先级：顶层 `modalities` / `image`（若有）> `architecture.input_modalities`。
 * `video` / `audio` / `file` 这类**不映射**到宿主的模态判定：宿主的 `ModelModality` 只有
 * 文本与图片两档，把 `file` 也算成图片会让「能读附件」的模型误显示为能读图。
 * @param row - 一行原始目录数据。
 * @returns 至少含 `"text"` 的模态列表。
 */
function inputModalitiesOf(row: Record<string, unknown>): readonly ModelModality[] {
  const declared = row.modalities;
  const fromList = Array.isArray(declared) && declared.includes("image");
  const architecture = isRecord(row.architecture) ? row.architecture : undefined;
  const inputs = architecture?.input_modalities;
  const fromArchitecture = Array.isArray(inputs) && inputs.includes("image");
  if (fromList || fromArchitecture || row.image === true) return ["text", "image"];
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
    // 取值：扁平字段（若有）优先，否则交给 {@link capacityOf}（`metadata` 里三个容量字段
    // 取**最大值**）。那个函数里有完整依据：`context_limit` 才是 token 天花板
    // （二分实测 1048239 仍 200、1048576 起 400），`context_budget`（23~40 万）是预算；
    // 曾经误取 budget，阈值掉到 134464 token（约 270 条消息），就是「最新版本很快就压缩了」。
    // 顺带一条纠错：`context_budget` 也不是条数上限的解药 —— 条数（第 1001 条 → 400）与
    // token 容量是两个独立约束，宿主的 `LlmModelContext` 里根本没有条数字段，所以**任何**
    // token 阈值都不可能提前发现条数超限，只能靠出站裁剪（{@link trimWireMessages}）兜底
    // 加上宿主 `context-overflow` 的反应式压缩自救。
    const meta = isRecord(raw.metadata) ? raw.metadata : undefined;
    const contextWindow = positiveNumber(raw.context_length ?? raw.contextWindow) ?? capacityOf(meta);
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
