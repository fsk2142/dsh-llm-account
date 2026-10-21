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
 * 官方展示名末尾的**标注性后缀**，它们不是模型身份的一部分。
 *
 * 官方页写成 `DeepSeek V4.1 Flash (latest)` / `DeepSeek V4 Flash Vision (exp)`，
 * 而网关目录里的 id 是 `deepseek-v4.1-flash` / `...-vision-exp` —— 不剥掉这些后缀，
 * 两边永远对不上（2026-10-21 实测：带 `(latest)` 的都匹配失败）。
 *
 * 注意 `exp` 有两种写法：官方写 `(exp)`、目录写 `-exp`，所以它单独按词处理，
 * 不能只剥括号。
 */
const ANNOTATION_PATTERN = /\((?:latest|exp|experimental|preview|beta)\)/gi;

/** 目录 id 里作为「标注」的同义尾部词（`-exp` / `-latest`）。 */
const TRAILING_MARKERS = /(?:^|\s)(?:latest|exp|experimental|beta)$/i;

/**
 * 把模型 id / 展示名归一化成查表用的键。
 *
 * 规则：转小写、把连字符与下划线都换成单空格、压缩多余空白、剥掉标注性后缀。于是
 * `deepseek/deepseek-v4.1-flash`、`DeepSeek V4.1 Flash (latest)` 得到同一个键
 * `deepseek v4.1 flash`。
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
  let key = base
    .replace(ANNOTATION_PATTERN, " ")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // 目录侧的 `-exp` / `-latest` 尾部标记同样剥掉（剥完可能又冒出空格）。
  key = key.replace(TRAILING_MARKERS, "").replace(/\s+/g, " ").trim();
  return key;
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
 * Command Code **GOAT 套餐**的逐模型额度（官方 `docs/plans/goat` 的 `Monthly credits` 列，
 * 抓于 2026-10-21）。
 *
 * 为什么单独一张：GOAT 是用户实际在用的档位，而官方在这一页把**全部 60 个模型**都列了
 * 各自的 monthly credits（含 Claude / GPT / Gemini 等闭源模型）。pricing 页那张只有 7 个
 * 开源模型的五档表覆盖不了它 —— 用户 2026-10-21 报障「commandcode 没看到每个模型各自的
 * 可用额度」，根因就是当时用的是那张 7 行表。
 *
 * 数据特点（官方原样）：
 * - 同一模型在不同档位拿到的 credits 不同，这里只取 GOAT 那列；
 * - `$100`（Ling 3.1 Flash）比套餐总额 $70 还高 —— 官方按模型定价折算，不是固定比例；
 * - Claude Sonnet 5.5 只有 $10，Claude Haiku 5.5 有 $20（官方原文：GOAT 上的 premium
 *   models 每月 $10 credits，Claude Haiku 5.5 除外拿 $20）。
 */
/**
 * Command Code **Go / Pro / Max** 三档的逐模型额度（官方 `docs/plans/{go,pro,max}`
 * 的 Monthly credits 列，抓于 2026-10-21）。
 *
 * 为什么需要：GOAT 那张表只覆盖 GOAT 档。用户切到其他档位时，若没有这些表，
 * 除了 pricing 页那 7 个开源模型之外**全部显示「未知」** —— 而官方其实公布了完整数字
 * （Go 47 个 / Pro 75 个 / Max 97 个）。
 *
 * Max 档的列头在官网上叫 `Max 10× credits`（对应 $150/月那档）。
 */
const COMMANDCODE_GO_RAW: Readonly<Record<string, string>> = {
  "DeepSeek V4 Flash (latest)": "$6",
  "DeepSeek V4 Flash Fast": "$8",
  "DeepSeek V4 Flash Vision (exp)": "$6",
  "DeepSeek V4 Pro (latest)": "$6",
  "DeepSeek V4.1 Flash (latest)": "$10",
  "DeepSeek V4.1 Flash Fast (latest)": "$6",
  "GLM-5.2": "$10",
  "GLM-5.2 Fast": "$9",
  "GLM-5.3": "$10",
  "GLM-5.3 Flash": "$10",
  "GLM-5.3 FlashX": "$6",
  "GPT-5.6 Luna": "$6",
  "GPT-6 Luna": "$6",
  "Grok 4.5": "$6",
  "Inkling": "$6",
  "Inkling Small": "$6",
  "Kimi K2.7 Code": "$9",
  "Kimi K2.7 Code HighSpeed": "$6",
  "Kimi K3": "$8",
  "Ling 3.1 Flash": "$6",
  "LongCat 2.0": "$10",
  "MiMo V2.5": "$6",
  "MiMo V2.5 Pro": "$6",
  "MiMo V2.6 Flash": "$6",
  "MiMo V2.6 Pro": "$6",
  "MiniMax M3": "$8",
  "MiniMax M3.1 Flash": "$6",
  "Mistral Large 4": "$6",
  "Muse Spark 1.2 Contributor": "$6",
  "Muse Spark 1.3 Contributor": "$6",
  "Muse Spark Open": "$6",
  "Nemotron 3 Ultra": "$6",
  "Nemotron 3.5 Super VL": "$6",
  "Ornith 1.5 122B": "$6",
  "Qwen 3.6 Plus": "$10",
  "Qwen 3.7 Max": "$10",
  "Qwen 3.7 Plus": "$10",
  "Qwen 3.8 27B": "$10",
  "Qwen 3.8 Flash": "$6",
  "Qwen 3.8 Max": "$7",
  "Qwen 3.8 Max 0902": "$7",
  "Qwen 3.8 Omni Flash": "$6",
  "Step 3.5 Flash": "$6",
  "Step 3.7 Flash": "$6",
  "Step 5 Preview": "$6",
  "Tencent Hy3": "$10",
  "Tencent Hy4 Preview": "$6",
};

const COMMANDCODE_PRO_RAW: Readonly<Record<string, string>> = {
  "Claude Haiku 4.5": "$20",
  "Claude Haiku 5.5": "$30",
  "Claude Sonnet 4.6": "$20",
  "Claude Sonnet 5": "$20",
  "Claude Sonnet 5.5": "$20",
  "DeepSeek V4 Flash (latest)": "$70",
  "DeepSeek V4 Flash Fast": "$30",
  "DeepSeek V4 Flash Vision (exp)": "$30",
  "DeepSeek V4 Pro (latest)": "$30",
  "DeepSeek V4.1 Flash (latest)": "$90",
  "DeepSeek V4.1 Flash Fast (latest)": "$70",
  "Gemini 3.1 Flash Lite": "$20",
  "Gemini 3.5 Flash": "$20",
  "Gemini 3.5 Flash Lite": "$20",
  "Gemini 3.6 Flash": "$20",
  "Gemini 3.7 Flash": "$50",
  "Gemini 3.8 Flash": "$50",
  "Gemini 4 Argon": "$20",
  "GLM-5.2": "$80",
  "GLM-5.2 Fast": "$30",
  "GLM-5.3": "$30",
  "GLM-5.3 Flash": "$90",
  "GLM-5.3 FlashX": "$30",
  "GPT-5.3 Codex": "$20",
  "GPT-5.4": "$20",
  "GPT-5.4 Mini": "$20",
  "GPT-5.5": "$20",
  "GPT-5.6 Luna": "$30",
  "GPT-5.6 Sol": "$30",
  "GPT-5.6 Terra": "$20",
  "GPT-6 Luna": "$30",
  "GPT-6 Sol": "$20",
  "Grok 4.5": "$30",
  "Grok 4.6": "$30",
  "Grok 4.7": "$30",
  "Inkling": "$30",
  "Inkling Small": "$30",
  "Jev": "$30",
  "Jev 1.14.0": "$30",
  "Kimi K2.7 Code": "$70",
  "Kimi K2.7 Code HighSpeed": "$30",
  "Kimi K3": "$30",
  "Ling 3.1 Flash": "$110",
  "LongCat 2.0": "$60",
  "MiMo V2.5": "$40",
  "MiMo V2.5 Pro": "$30",
  "MiMo V2.6 Flash": "$30",
  "MiMo V2.6 Pro": "$30",
  "MiMo V2.6 Pro UltraSpeed": "$20",
  "MiniMax M3": "$57",
  "MiniMax M3.1 Flash": "$30",
  "Mistral Large 4": "$30",
  "Muse Spark 1.1": "$20",
  "Muse Spark 1.2": "$30",
  "Muse Spark 1.2 Contributor": "$30",
  "Muse Spark 1.3": "$30",
  "Muse Spark 1.3 Contributor": "$30",
  "Muse Spark Open": "$30",
  "Nemotron 3 Ultra": "$30",
  "Nemotron 3.5 Super VL": "$30",
  "Ornith 1.5 122B": "$30",
  "Qwen 3.6 Plus": "$43",
  "Qwen 3.7 Max": "$43",
  "Qwen 3.7 Plus": "$43",
  "Qwen 3.8 27B": "$80",
  "Qwen 3.8 Flash": "$30",
  "Qwen 3.8 Max": "$30",
  "Qwen 3.8 Max 0902": "$30",
  "Qwen 3.8 Max Prime": "$30",
  "Qwen 3.8 Omni Flash": "$30",
  "Step 3.5 Flash": "$30",
  "Step 3.7 Flash": "$30",
  "Step 5 Preview": "$30",
  "Tencent Hy3": "$80",
  "Tencent Hy4 Preview": "$30",
};

const COMMANDCODE_MAX10_RAW: Readonly<Record<string, string>> = {
  "Beam 1.0": "Free",
  "Claude Fable 5": "$100",
  "Claude Fable 5.1": "$100",
  "Claude Haiku 4.5": "$100",
  "Claude Haiku 5.5": "$150",
  "Claude Opus 4.6": "$100",
  "Claude Opus 4.7": "$100",
  "Claude Opus 4.8": "$100",
  "Claude Opus 5": "$100",
  "Claude Opus 5.5": "$100",
  "Claude Sonnet 4.6": "$100",
  "Claude Sonnet 5": "$100",
  "Claude Sonnet 5.5": "$150",
  "DeepSeek V4 Flash (latest)": "$150",
  "DeepSeek V4 Flash Fast": "$150",
  "DeepSeek V4 Flash Vision (exp)": "$150",
  "DeepSeek V4 Pro (latest)": "$150",
  "DeepSeek V4.1 Flash (latest)": "$150",
  "DeepSeek V4.1 Flash Fast (latest)": "$150",
  "Fugu Ultra": "$100",
  "Gemini 3.1 Flash Lite": "$100",
  "Gemini 3.5 Flash": "$100",
  "Gemini 3.5 Flash Lite": "$100",
  "Gemini 3.6 Flash": "$100",
  "Gemini 3.7 Flash": "$150",
  "Gemini 3.8 Flash": "$150",
  "Gemini 4 Argon": "$100",
  "GLM-5": "$150",
  "GLM-5.1": "$150",
  "GLM-5.2": "$150",
  "GLM-5.2 Fast": "$150",
  "GLM-5.3": "$150",
  "GLM-5.3 Flash": "$150",
  "GLM-5.3 FlashX": "$150",
  "Glyph Cluster": "Free",
  "GPT-5.3 Codex": "$100",
  "GPT-5.4": "$100",
  "GPT-5.4 Mini": "$100",
  "GPT-5.5": "$100",
  "GPT-5.6 Luna": "$150",
  "GPT-5.6 Sol": "$150",
  "GPT-5.6 Terra": "$100",
  "GPT-6 Astra": "$100",
  "GPT-6 Luna": "$150",
  "GPT-6 Sol": "$100",
  "GPT-6.1 Sol": "$100",
  "Grok 4.5": "$150",
  "Grok 4.6": "$150",
  "Grok 4.7": "$150",
  "Inkling": "$150",
  "Inkling Small": "$150",
  "Jev": "$150",
  "Jev 1.14.0": "$150",
  "Kimi K2.5": "$150",
  "Kimi K2.6": "$150",
  "Kimi K2.7 Code": "$150",
  "Kimi K2.7 Code HighSpeed": "$150",
  "Kimi K3": "$150",
  "Laguna S 2.1": "Free",
  "Ling 3.1 Flash": "$150",
  "LongCat 2.0": "$150",
  "MiMo V2.5": "$150",
  "MiMo V2.5 Pro": "$150",
  "MiMo V2.6 Flash": "$150",
  "MiMo V2.6 Pro": "$150",
  "MiMo V2.6 Pro UltraSpeed": "$150",
  "MiniMax M2.5": "$150",
  "MiniMax M2.7": "$150",
  "MiniMax M3": "$150",
  "MiniMax M3.1 Flash": "$150",
  "Mistral Large 4": "$150",
  "Muse Spark 1.1": "$100",
  "Muse Spark 1.2": "$150",
  "Muse Spark 1.2 Contributor": "$150",
  "Muse Spark 1.3": "$150",
  "Muse Spark 1.3 Contributor": "$150",
  "Muse Spark Open": "$150",
  "Muse Wonder": "$100",
  "Nemotron 3 Ultra": "$150",
  "Nemotron 3.5 Super VL": "$150",
  "Ornith 1.5 122B": "$150",
  "Qwen 3.6 Max Preview": "$150",
  "Qwen 3.6 Plus": "$150",
  "Qwen 3.7 Flash": "$150",
  "Qwen 3.7 Max": "$150",
  "Qwen 3.7 Plus": "$150",
  "Qwen 3.8 27B": "$150",
  "Qwen 3.8 Flash": "$150",
  "Qwen 3.8 Max": "$150",
  "Qwen 3.8 Max 0902": "$150",
  "Qwen 3.8 Max Prime": "$150",
  "Qwen 3.8 Omni Flash": "$150",
  "Step 3.5 Flash": "$150",
  "Step 3.7 Flash": "$150",
  "Step 5 Preview": "$150",
  "Tencent Hy3": "$150",
  "Tencent Hy4 Preview": "$150",
};

const COMMANDCODE_MAX20_RAW: Readonly<Record<string, string>> = {
  "Beam 1.0": "Free",
  "Claude Fable 5": "$200",
  "Claude Fable 5.1": "$200",
  "Claude Haiku 4.5": "$200",
  "Claude Haiku 5.5": "$300",
  "Claude Opus 4.6": "$200",
  "Claude Opus 4.7": "$200",
  "Claude Opus 4.8": "$200",
  "Claude Opus 5": "$200",
  "Claude Opus 5.5": "$200",
  "Claude Sonnet 4.6": "$200",
  "Claude Sonnet 5": "$200",
  "Claude Sonnet 5.5": "$300",
  "DeepSeek V4 Flash (latest)": "$300",
  "DeepSeek V4 Flash Fast": "$300",
  "DeepSeek V4 Flash Vision (exp)": "$300",
  "DeepSeek V4 Pro (latest)": "$300",
  "DeepSeek V4.1 Flash (latest)": "$300",
  "DeepSeek V4.1 Flash Fast (latest)": "$300",
  "Fugu Ultra": "$200",
  "Gemini 3.1 Flash Lite": "$200",
  "Gemini 3.5 Flash": "$200",
  "Gemini 3.5 Flash Lite": "$200",
  "Gemini 3.6 Flash": "$200",
  "Gemini 3.7 Flash": "$300",
  "Gemini 3.8 Flash": "$300",
  "Gemini 4 Argon": "$200",
  "GLM-5": "$300",
  "GLM-5.1": "$300",
  "GLM-5.2": "$300",
  "GLM-5.2 Fast": "$300",
  "GLM-5.3": "$300",
  "GLM-5.3 Flash": "$300",
  "GLM-5.3 FlashX": "$300",
  "Glyph Cluster": "Free",
  "GPT-5.3 Codex": "$200",
  "GPT-5.4": "$200",
  "GPT-5.4 Mini": "$200",
  "GPT-5.5": "$200",
  "GPT-5.6 Luna": "$300",
  "GPT-5.6 Sol": "$300",
  "GPT-5.6 Terra": "$200",
  "GPT-6 Astra": "$200",
  "GPT-6 Luna": "$300",
  "GPT-6 Sol": "$200",
  "GPT-6.1 Sol": "$200",
  "Grok 4.5": "$300",
  "Grok 4.6": "$300",
  "Grok 4.7": "$300",
  "Inkling": "$300",
  "Inkling Small": "$300",
  "Jev": "$300",
  "Jev 1.14.0": "$300",
  "Kimi K2.5": "$300",
  "Kimi K2.6": "$300",
  "Kimi K2.7 Code": "$300",
  "Kimi K2.7 Code HighSpeed": "$300",
  "Kimi K3": "$300",
  "Laguna S 2.1": "Free",
  "Ling 3.1 Flash": "$300",
  "LongCat 2.0": "$300",
  "MiMo V2.5": "$300",
  "MiMo V2.5 Pro": "$300",
  "MiMo V2.6 Flash": "$300",
  "MiMo V2.6 Pro": "$300",
  "MiMo V2.6 Pro UltraSpeed": "$300",
  "MiniMax M2.5": "$300",
  "MiniMax M2.7": "$300",
  "MiniMax M3": "$300",
  "MiniMax M3.1 Flash": "$300",
  "Mistral Large 4": "$300",
  "Muse Spark 1.1": "$200",
  "Muse Spark 1.2": "$300",
  "Muse Spark 1.2 Contributor": "$300",
  "Muse Spark 1.3": "$300",
  "Muse Spark 1.3 Contributor": "$300",
  "Muse Spark Open": "$300",
  "Muse Wonder": "$200",
  "Nemotron 3 Ultra": "$300",
  "Nemotron 3.5 Super VL": "$300",
  "Ornith 1.5 122B": "$300",
  "Qwen 3.6 Max Preview": "$300",
  "Qwen 3.6 Plus": "$300",
  "Qwen 3.7 Flash": "$300",
  "Qwen 3.7 Max": "$300",
  "Qwen 3.7 Plus": "$300",
  "Qwen 3.8 27B": "$300",
  "Qwen 3.8 Flash": "$300",
  "Qwen 3.8 Max": "$300",
  "Qwen 3.8 Max 0902": "$300",
  "Qwen 3.8 Max Prime": "$300",
  "Qwen 3.8 Omni Flash": "$300",
  "Step 3.5 Flash": "$300",
  "Step 3.7 Flash": "$300",
  "Step 5 Preview": "$300",
  "Tencent Hy3": "$300",
  "Tencent Hy4 Preview": "$300",
};



const COMMANDCODE_GOAT_RAW: Readonly<Record<string, string>> = {
  "Ling 3.1 Flash": "$100",
  "DeepSeek V4.1 Flash": "$80",
  "GLM-5.3 Flash": "$80",
  "GLM-5.2": "$70",
  "Tencent Hy3": "$70",
  "Qwen 3.8 27B": "$70",
  "DeepSeek V4 Flash": "$60",
  "DeepSeek V4.1 Flash Fast": "$60",
  "Kimi K2.7 Code": "$60",
  "LongCat 2.0": "$50",
  "MiniMax M3": "$47",
  "Gemini 3.8 Flash": "$40",
  "Qwen 3.7 Max": "$33",
  "Qwen 3.7 Plus": "$33",
  "Qwen 3.6 Plus": "$33",
  "MiMo V2.5": "$30",
  "GPT-5.6 Sol": "$20",
  "GPT-5.6 Luna": "$20",
  "Qwen 3.8 Max": "$20",
  "Mistral Large 4": "$20",
  "DeepSeek V4 Pro": "$20",
  "MiMo V2.5 Pro": "$20",
  "Claude Sonnet 5.5": "$10",
  "Claude Haiku 5.5": "$20",
  "Kimi K3": "$20",
  "GPT-6 Luna": "$20",
  "Qwen 3.8 Omni Flash": "$20",
  "Qwen 3.8 Max Prime": "$20",
  "Qwen 3.8 Max 0902": "$20",
  "Tencent Hy4 Preview": "$20",
  "MiniMax M3.1 Flash": "$20",
  "Ornith 1.5 122B": "$20",
  "Qwen 3.8 Flash": "$20",
  "GLM-5.3 FlashX": "$20",
  "DeepSeek V4 Flash Vision (exp)": "$20",
  "DeepSeek V4 Flash Fast": "$20",
  "GLM-5.3": "$20",
  "Muse Spark 1.3": "$20",
  "Muse Spark 1.3 Contributor": "$20",
  "Muse Spark 1.2": "$20",
  "Muse Spark 1.2 Contributor": "$20",
  "Muse Spark Open": "$20",
  "Kimi K2.7 Code HighSpeed": "$20",
  "Grok 4.5": "$20",
  "Grok 4.6": "$20",
  "Grok 4.7": "$20",
  "Gemini 3.7 Flash": "$40",
  "GLM-5.2 Fast": "$20",
  "Inkling": "$20",
  "Inkling Small": "$20",
  "MiMo V2.6 Pro": "$20",
  "MiMo V2.6 Flash": "$20",
  "MiMo V2.6 Pro UltraSpeed": "$10",
  "Step 5 Preview": "$20",
  "Step 3.7 Flash": "$20",
  "Step 3.5 Flash": "$20",
  "Nemotron 3 Ultra": "$20",
  "Nemotron 3.5 Super VL": "$20",
  "Jev": "$20",
  "Jev 1.14.0": "$20",
};

/**
 * Command Code 的**五档**逐模型额度（官方 pricing 页的 `Usage` 表，抓于 2026-10-21）。
 *
 * 只覆盖 7 个开源模型 —— 它比不上面的 GOAT 表全，但它是唯一给出 Go / Pro / Max 各档
 * 数字的来源，所以保留。查表时 **GOAT 优先用 {@link COMMANDCODE_GOAT_RAW}**，
 * 其余档位才落到这张表。
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
 * OpenCode 的逐模型额度（官方公开页 `https://opencode.ai/go` 的 `Monthly usage` 列，
 * 抓于 2026-10-21）。
 *
 * 列顺序 = Go / Go Plus 两档（官网表格每行前一组是 5 小时请求数、后一组是月度额度，
 * 这里只取后一组）。`∞` 是官方原文：免费模型不计额度。
 *
 * **注意**：opencode 的额度接口（`usage.rolling` / `weekly` / `monthly`）**不上报套餐名**，
 * 所以查表时调用方传进来的档位可能为空 —— 那时用 Go（$10/月，官网的默认档）兜底。
 */
const OPENCODE_RAW: Readonly<Record<string, readonly [string, string]>> = {
  "Kimi K3": ["$15", "$60"],
  "Gemini 4 Argon Contributor": ["$30", "$60"],
  "Kimi K2.7 Code": ["$60", "$180"],
  "Step 5 Preview": ["$15", "$60"],
  "MiniMax M3": ["$60", "$180"],
  "Claude Haiku 5.5": ["$15", "$60"],
  "GPT 6 Luna": ["$15", "$60"],
  "Qwen3.7 Plus": ["$60", "$180"],
  "GLM-5.3-Flash": ["$60", "$180"],
  "MiMo-V2.6-Flash": ["$60", "$120"],
  "DeepSeek V4.1 Flash": ["$80", "$160"],
  "Muse Spark 1.3 Contributor": ["$60", "$120"],
  "LongCat 2.5 Preview": ["Free", "Free"],
  "MiniMax M3.1 Flash": ["Free", "Free"],
  "Beam": ["Free", "Free"],
};

/** OpenCode 在表里的两档套餐键。 */
const OPENCODE_PLAN_ORDER: readonly string[] = ["go", "goplus"];

/**
 * Open Design 的逐模型额度（官方 `Design Plan usage` 表，抓于 2026-10-21）。
 *
 * 表头的「每月使用额度」是**该套餐额度池里分给这个模型的份额**（不是套餐价格）：
 * 官网 zh/model-credits 页把套餐构成写得很清楚 ——
 * Go 原价 $10/月、每月最高总额度 $120、7 天窗口 $30、5 小时窗口 $10。
 * 所以 `go` 这一列的数字（如 DeepSeek V4.1 Flash = $120）与套餐总额度同量级是对的。
 *
 * 三列 = Go / Plus / Pro。**Max 列官方页面是空的**，所以这里也没有 —— 不猜。
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

/** 把「模型 → 单个额度字符串」的单档表展开（只有一列数字的表用）。 */
function expandSingle(raw: Readonly<Record<string, string>>): Record<string, ModelQuotaAmount> {
  const bucket: Record<string, ModelQuotaAmount> = {};
  for (const [model, cell] of Object.entries(raw)) {
    const key = normalizeModelKey(model);
    if (key === "") continue;
    const amount = amountOf(cell);
    if (amount !== undefined) bucket[key] = amount;
  }
  return bucket;
}

/**
 * Command Code 的查表结构。
 *
 * **GOAT 合并两张表**，不是覆盖：
 * - `docs/plans/goat` 的 60 行完整表（含闭源模型，用户实际在用的数据）；
 * - pricing 页那 7 行表里的 `goat` 列 —— 它标了 `Free` 的那几个模型
 *   （Beam 1.0 / Glyph Cluster / Laguna S 2.1）在 docs 页的 `Monthly credits`
 *   表里**没有对应行**（它们不扣额度，所以不列额度数字）。
 *
 * 2026-10-21 踩过：一开始写成 `{ ...expand(RAW), goat: expandSingle(GOAT_RAW) }`，
 * 整桶覆盖导致那 3 个 Free 模型消失 —— 界面上从「免费」变成空白。
 * 合并顺序：完整表在前、Free 兜底在后（后者的 `Free` 只补前者缺的键）。
 */
export const COMMANDCODE_MODEL_QUOTA: PlanModelQuotaTable = (() => {
  const fiveTier = expand(COMMANDCODE_RAW, COMMANDCODE_PLAN_ORDER);
  // 每一档都是「完整表优先，pricing 页的 Free/旧数据补齐缺的键」。
  // 顺序不能反：完整表里的真数字必须压过 pricing 页那 7 行里可能过期的值。
  const merge = (plan: string, full: Readonly<Record<string, string>>) => ({
    ...(fiveTier[plan] ?? {}),
    ...expandSingle(full),
  });
  return {
    ...fiveTier,
    go: merge("go", COMMANDCODE_GO_RAW),
    goat: merge("goat", COMMANDCODE_GOAT_RAW),
    pro: merge("pro", COMMANDCODE_PRO_RAW),
    // Max 页有 `Max 10× credits` 与 `Max 20× credits` 两列，各 97 个模型。
    max10x: merge("max10x", COMMANDCODE_MAX10_RAW),
    max20x: merge("max20x", COMMANDCODE_MAX20_RAW),
  };
})();

/** Open Design 的查表结构。 */
export const OPENDESIGN_MODEL_QUOTA: PlanModelQuotaTable = expand(OPENDESIGN_RAW, OPENDESIGN_PLAN_ORDER);

/** OpenCode 的查表结构（只能区分 Go / Go Plus 两档）。 */
export const OPENCODE_MODEL_QUOTA: PlanModelQuotaTable = expand(OPENCODE_RAW, OPENCODE_PLAN_ORDER);

/**
 * **某个套餐到底包含哪些模型**（用户 2026-10-21 要求：不要把本套餐用不了的模型也列出来）。
 *
 * 与 {@link PlanModelQuotaTable} 的区别很重要：
 * - 额度表回答「这个模型能用多少额度」，只有官方公布了数字的模型才在表里；
 * - 这张表回答「这个模型能不能用」，覆盖该套餐的**全部**可用模型。
 *
 * 二者数量不同是正常的：GOAT 有 71 个可用模型，但只有 60 个公布了 monthly credits。
 * 拿额度表当可用性用会把 11 个能用但没公布额度的模型也藏掉。
 */
export type PlanModelSet = Readonly<Record<string, ReadonlySet<string>>>;

/**
 * Command Code **GOAT 套餐**包含的全部模型（官方 `docs/plans/goat` 的
 * 「Models included」表，抓于 2026-10-21，共 71 个唯一名字）。
 *
 * 官方原话：「Every model below is included on the GOAT plan」；同页还写着
 * 「The rest of the premium lineup needs Pro or Max」—— 所以不在这张表里的模型
 * （如 Claude Opus 系列）在 GOAT 下确实不可用。
 */
const COMMANDCODE_GOAT_MODELS: readonly string[] = [
  "Beam 1.0",
  "Claude Haiku 5.5",
  "Claude Sonnet 5.5",
  "DeepSeek V4 Flash",
  "DeepSeek V4 Flash Fast",
  "DeepSeek V4 Flash Vision",
  "DeepSeek V4 Pro",
  "DeepSeek V4.1 Flash",
  "DeepSeek V4.1 Flash Fast",
  "Gemini 3.7 Flash",
  "Gemini 3.8 Flash",
  "GLM-5",
  "GLM-5.1",
  "GLM-5.2",
  "GLM-5.2 Fast",
  "GLM-5.3",
  "GLM-5.3 Flash",
  "GLM-5.3 FlashX",
  "Glyph Cluster",
  "GPT-5.6 Luna",
  "GPT-5.6 Sol",
  "GPT-6 Luna",
  "Grok 4.5",
  "Grok 4.6",
  "Grok 4.7",
  "Inkling",
  "Inkling Small",
  "Jev",
  "Jev 1.14.0",
  "Kimi K2.5",
  "Kimi K2.6",
  "Kimi K2.7 Code",
  "Kimi K2.7 Code HighSpeed",
  "Kimi K3",
  "Laguna S 2.1",
  "Ling 3.1 Flash",
  "LongCat 2.0",
  "MiMo V2.5",
  "MiMo V2.5 Pro",
  "MiMo V2.6 Flash",
  "MiMo V2.6 Pro",
  "MiMo V2.6 Pro UltraSpeed",
  "MiniMax M2.5",
  "MiniMax M2.7",
  "MiniMax M3",
  "MiniMax M3.1 Flash",
  "Mistral Large 4",
  "Muse Spark 1.2",
  "Muse Spark 1.2 Contributor",
  "Muse Spark 1.3",
  "Muse Spark 1.3 Contributor",
  "Muse Spark Open",
  "Nemotron 3 Ultra",
  "Nemotron 3.5 Super VL",
  "Ornith 1.5 122B",
  "Qwen 3.6 Max Preview",
  "Qwen 3.6 Plus",
  "Qwen 3.7 Flash",
  "Qwen 3.7 Max",
  "Qwen 3.7 Plus",
  "Qwen 3.8 27B",
  "Qwen 3.8 Flash",
  "Qwen 3.8 Max",
  "Qwen 3.8 Max 0902",
  "Qwen 3.8 Max Prime",
  "Qwen 3.8 Omni Flash",
  "Step 3.5 Flash",
  "Step 3.7 Flash",
  "Step 5 Preview",
  "Tencent Hy3",
  "Tencent Hy4 Preview",
];

/** 把一串官方展示名转成归一化键的集合。 */
function keySetOf(names: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of names) {
    const key = normalizeModelKey(name);
    if (key !== "") set.add(key);
  }
  return set;
}

/** Command Code 各档位的可用模型集合。目前只有 GOAT 有官方完整清单。 */
export const COMMANDCODE_PLAN_MODELS: PlanModelSet = {
  goat: keySetOf(COMMANDCODE_GOAT_MODELS),
};

/**
 * 某个模型是否在指定套餐的可用清单里。
 *
 * 三档结论：
 * - `true`：在清单里，可以显示；
 * - `false`：**明确不在**清单里，应当隐藏；
 * - `undefined`：这家厂商/这个档位没有官方清单（不知道），**不要隐藏** ——
 *   没有依据就藏模型会让用户以为功能坏了。
 * @param table - 该厂商的可用模型集合。
 * @param planName - 套餐展示名。
 * @param modelName - 模型 id 或展示名。
 * @returns 是否可用；没有该档清单时 `undefined`。
 */
export function modelAvailableIn(
  table: PlanModelSet,
  planName: string | undefined,
  modelName: string,
): boolean | undefined {
  if (planName === undefined) return undefined;
  const plan = planKeyOf(planName);
  if (plan === undefined) return undefined;
  const set = table[plan];
  if (set === undefined) return undefined;
  return set.has(normalizeModelKey(modelName));
}

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
  // OpenCode 的两档：`Go` / `Go Plus`。注意它和 Open Design 的 `Plus` 是两家的不同档位，
  // 但两家各用各的表，所以键同名不冲突。
  if (key === "goplus") return "goplus";
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
