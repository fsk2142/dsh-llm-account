/**
 * **各套餐下「这个模型能用多少额度」**（用户 2026-10-21 要的功能）。
 *
 * ## 为什么需要一张表
 *
 * 各家网关对同一个套餐里的不同模型给的额度**不一样**，而且不是简单比例：
 *
 * - Command Code 的 GOAT（每月 $70）里，`MiniMax M3` 的有效额度是 **$47**、
 *   `MiMo V2.5` 是 **$100**（比套餐总额还高 —— MoE 模型的计价倍率不同）。
 * - Open Design 的 Go（每月 $120）里，`GPT-6 Luna` 只有 **$15**，
 *   而 `DeepSeek V4.1 Flash` 能到 **$120**（吃满整个套餐）。
 *
 * 所以「套餐总额 × 固定百分比」这个算法是错的，只能用官方公布的逐模型数字。
 *
 * ## 数据来源（都是官网 HTML，没有 API）
 *
 * | 厂商 | 页面 | 抓取日期 |
 * | --- | --- | --- |
 * | commandcode | `https://commandcode.ai/pricing` 的 Usage 表 | 2026-10-21 |
 * | opendesign | `https://open-design.ai/pricing` 的 Design Plan usage 表 | 2026-10-21 |
 *
 * ## 会过期，所以查不到就不显示
 *
 * 官网会调价（用户 2026-10-21 明确提到「GOAT 现在是 70，后边变成 80」）。这张表和
 * 官方一旦不一致，显示出来的就是**错的数字**，而错数字比没有数字更糟 —— 用户会照着它
 * 安排用量。
 *
 * 因此纪律与 `commandcode/plans.ts` 的静态套餐表一致：
 * **表里没有的组合就是没有数据**，界面留空。用户确认过「有更新时我自己发新版本」，
 * 所以这里不尝试运行时抓网页（那会让设置页每次都多一个 350KB 的外部依赖）。
 *
 * @module dsh-llm-account/src/core/model-quota-table
 */

/** 一个模型在某个套餐下每月可用的额度（美元）。 */
export type ModelQuotaAmount =
  /** 官方给了美元数字。 */
  | { kind: "usd"; amount: number }
  /** 官方标明**免费**（不消耗套餐额度）。 */
  | { kind: "free" }
  /** 官方给的是「约」值（表格里印着 `~$100`）。 */
  | { kind: "approx"; amount: number };

/**
 * 一张表的形状：`套餐键 → (模型归一化名 → 额度)`。
 *
 * 模型名一律用 {@link normalizeModelKey} 归一化后的小写形式作键 —— 目录里的 id
 * 有 `deepseek/deepseek-v4.1-flash`、`deepseek-v4.1-flash` 等各种写法，官方表用的是
 * 展示名（`DeepSeek V4.1 Flash`），三者必须落到同一个键上。
 */
export type PlanModelQuotaTable = Readonly<Record<string, Readonly<Record<string, ModelQuotaAmount>>>>;

/**
 * 把模型 id / 展示名归一化成查表用的键。
 *
 * 规则：转小写、把连字符与下划线都换成单空格、压缩多余空白。于是
 * `deepseek/deepseek-v4.1-flash`、`DeepSeek V4.1 Flash`、`deepseek_v4.1_flash`
 * 得到同一个键 `deepseek v4.1 flash`。
 *
 * 只保留最后一段（`company/model` 只取 `model`）：官方表不区分公司前缀，
 * 而目录里同一个模型可能带不同前缀。
 * @param name - 模型 id 或展示名。
 * @returns 归一化键；空输入返回空串。
 */
export function normalizeModelKey(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "";
  const segments = trimmed.split("/");
  const base = segments[segments.length - 1] ?? trimmed;
  return base
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 把官方表格里的 `$47` / `~$100` / `Free` 解析成 {@link ModelQuotaAmount}。 */
function amountOf(raw: string): ModelQuotaAmount | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  if (/^free$/i.test(text)) return { kind: "free" };
  const approx = text.startsWith("~") || text.startsWith("约");
  const digits = text.replace(/[^\d.]/g, "");
  if (digits === "") return undefined;
  const value = Number(digits);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return approx ? { kind: "approx", amount: value } : { kind: "usd", amount: value };
}

/**
 * Command Code 的逐模型额度（官方 `Usage` 表，抓于 2026-10-21）。
 *
 * 列顺序即官方表格的 Go / GOAT / Pro / Max 10× / Max 20×，套餐月度额度分别是
 * $10 / $70 / $80 / $150 / $300（同一页的 `Monthly credits` 行）。
 *
 * 官方原文里 `Free` 表示「容量期内不扣 credits」；`~$` 是官方自己标了约等号。
 */
const COMMANDCODE_RAW: Readonly<Record<string, readonly [string, string, string, string, string]>> = {
  "MiniMax M3": ["$8", "$47", "$57", "~$300", "~$600"],
  "MiMo V2.5": ["~$60", "~$100", "~$150", "~$750", "~$1,500"],
  "Laguna S 2.1": ["Free", "Free", "Free", "Free", "Free"],
  "Glyph Cluster": ["Free", "Free", "Free", "Free", "Free"],
  "Beam 1.0": ["Free", "Free", "Free", "Free", "Free"],
  "MiniMax M3.1 Flash": ["Free", "Free", "Free", "Free", "Free"],
  "Ornith 1.5 122B": ["Free", "Free", "Free", "Free", "Free"],
};

/** Command Code 在表里的五档套餐键（与 `plans.ts` 的展示名一致，小写）。 */
const COMMANDCODE_PLAN_ORDER: readonly string[] = ["go", "goat", "pro", "max10x", "max20x"];

/**
 * Open Design 的逐模型额度（官方 `Design Plan usage` 表，抓于 2026-10-21）。
 *
 * 官方表格只给 Go / Plus / Pro 三档的美元列（Max 列在页面里是空的，所以这里也没有 ——
 * **不猜**）。套餐月度额度 Go $120 / Plus $180 / Pro $480。
 */
const OPENDESIGN_RAW: Readonly<Record<string, readonly [string, string, string]>> = {
  "GLM-5.3 Flash-X": ["$30", "$40", "$90"],
  "DeepSeek V4 Pro": ["$60", "$80", "$180"],
  "Kimi K2.7 Code": ["$60", "$80", "$180"],
  "Hunyuan H4 Preview": ["$60", "$80", "$180"],
  "Claude Haiku 5.5": ["$30", "$40", "$90"],
  "GPT-6 Luna": ["$15", "$20", "$45"],
  "GLM-5.3 Flash": ["$60", "$80", "$180"],
  "DeepSeek V4 Flash Vision Exp": ["$60", "$80", "$180"],
  "MiMo V2.6 Pro": ["$60", "$80", "$180"],
  "DeepSeek V4 Flash": ["$60", "$80", "$180"],
  "MiMo V2.6 Flash": ["$60", "$80", "$180"],
  "DeepSeek V4.1 Flash": ["$120", "$160", "$360"],
};

/** Open Design 在表里的套餐键。 */
const OPENDESIGN_PLAN_ORDER: readonly string[] = ["go", "plus", "pro"];

/**
 * 把「模型 → 各套餐原始字符串」的紧凑表展开成按套餐索引的查表结构。
 * @param raw - 官方表格的逐行原文。
 * @param planOrder - 列顺序对应的套餐键。
 * @returns `套餐键 → (归一化模型名 → 额度)`。
 */
function expand(
  raw: Readonly<Record<string, readonly string[]>>,
  planOrder: readonly string[],
): Record<string, Record<string, ModelQuotaAmount>> {
  const table: Record<string, Record<string, ModelQuotaAmount>> = {};
  for (const plan of planOrder) table[plan] = {};
  for (const [model, cells] of Object.entries(raw)) {
    const key = normalizeModelKey(model);
    if (key === "") continue;
    cells.forEach((cell, index) => {
      const plan = planOrder[index];
      if (plan === undefined) return;
      const amount = amountOf(cell);
      if (amount === undefined) return;
      table[plan]![key] = amount;
    });
  }
  return table;
}

/** Command Code 的查表结构。 */
export const COMMANDCODE_MODEL_QUOTA: PlanModelQuotaTable = expand(COMMANDCODE_RAW, COMMANDCODE_PLAN_ORDER);

/** Open Design 的查表结构。 */
export const OPENDESIGN_MODEL_QUOTA: PlanModelQuotaTable = expand(OPENDESIGN_RAW, OPENDESIGN_PLAN_ORDER);

/**
 * 从套餐展示名（`GOAT` / `Go` / `Max 10×` / `Plus`…）得到查表用的套餐键。
 *
 * 官方名字带空格与 `×`（`Max 10×`），表里用 `max10x` 这种紧凑写法；大小写与空格的
 * 差异不该让整行数据消失，所以这里统一归一化。
 * @param planName - 套餐展示名（`QuotaPlanSummary.name` 或 `id`）。
 * @returns 套餐键；认不出时 `undefined`（不猜）。
 */
export function planKeyOf(planName: string): string | undefined {
  const key = planName
    .toLowerCase()
    .replace(/[×✕x]/g, "x")
    .replace(/[\s_-]+/g, "")
    .trim();
  if (key === "") return undefined;
  if (key === "go" || key === "goat" || key === "pro" || key === "plus") return key;
  if (key === "max10x" || key === "max20x") return key;
  return undefined;
}

/**
 * 查一个模型在某个套餐下的额度。
 *
 * 返回 `undefined` 的三种情况都**不该显示任何数字**：套餐认不出、模型不在表里、
 * 该组合官方没给数据。这与「额度缺失不倒成 0」是同一条纪律。
 * @param table - 该厂商的表。
 * @param planName - 套餐展示名。
 * @param modelName - 模型 id 或展示名。
 * @returns 额度；查不到时 `undefined`。
 */
export function modelQuotaOf(
  table: PlanModelQuotaTable,
  planName: string | undefined,
  modelName: string,
): ModelQuotaAmount | undefined {
  if (planName === undefined) return undefined;
  const plan = planKeyOf(planName);
  if (plan === undefined) return undefined;
  const bucket = table[plan];
  if (bucket === undefined) return undefined;
  return bucket[normalizeModelKey(modelName)];
}
