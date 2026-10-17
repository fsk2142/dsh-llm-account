/**
 * 模型分组的纯规则：公司归属、免费模型、分组顺序。
 *
 * 目录端点只给 id/name（OpenCode 的 `/models` 全是 `owned_by: "opencode"`），真正有用的
 * 归属信息在 models.dev 的 `canonical_model_id` 里（`anthropic/claude-…`）。这里既认适配器
 * 带下来的公司键，也在缺失时按 id 前缀兜底 —— 命令码那家的目录没有 canonical id，不能因此
 * 把所有模型塞进「其他」。
 * @module dsh-llm-account/src/core/model-groups
 */

/** 一个模型的分组输入。 */
export interface ModelGroupInput {
  /** 模型 id。 */
  id: string;
  /** 适配器带下来的公司键（`canonical_model_id` 的斜杠前一段）。 */
  company?: string;
  /** 目录明确标成免费（`cost.input === 0 && cost.output === 0` 等）。 */
  free?: boolean;
}

/** 一个展示分组。 */
export interface ModelGroup {
  /** 分组键：`free`、公司键或 `other`。 */
  key: string;
  /** 组内模型 id，保持输入顺序。 */
  models: string[];
}

/** 公司键 → 展示名；未知公司回退到键本身。 */
const COMPANY_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  zhipuai: "Zhipu AI",
  alibaba: "Alibaba",
  moonshotai: "Moonshot AI",
  minimax: "MiniMax",
  xiaomi: "Xiaomi",
  tencent: "Tencent",
  meituan: "Meituan",
  stepfun: "StepFun",
  meta: "Meta",
  reflection: "Reflection",
  mistralai: "Mistral AI",
  cohere: "Cohere",
  baidu: "Baidu",
  bytedance: "ByteDance",
  opencode: "OpenCode",
  other: "其他",
};

/** id 前缀 → 公司键；顺序有意义（`gpt` 先于更泛的规则）。 */
const ID_PREFIXES: readonly (readonly [RegExp, string])[] = [
  [/^claude(?:[-_]|$)/i, "anthropic"],
  [/^(?:gpt|codex)(?:[-_]|$)/i, "openai"],
  [/^o[1-9](?:[-_]|$)/i, "openai"],
  [/^gemini(?:[-_]|$)/i, "google"],
  [/^grok(?:[-_]|$)/i, "xai"],
  [/^deepseek(?:[-_]|$)/i, "deepseek"],
  [/^glm(?:[-_]|$)/i, "zhipuai"],
  [/^(?:qwen|qwq)(?:[-_]|\d)/i, "alibaba"],
  [/^(?:kimi|moonshot)(?:[-_]|$)/i, "moonshotai"],
  [/^minimax(?:[-_]|$)/i, "minimax"],
  [/^mimo(?:[-_]|$)/i, "xiaomi"],
  [/^hy\d/i, "tencent"],
  [/^hunyuan(?:[-_]|$)/i, "tencent"],
  [/^longcat(?:[-_]|$)/i, "meituan"],
  [/^step(?:[-_]|$)/i, "stepfun"],
  [/^muse(?:[-_]|$)/i, "meta"],
  [/^llama(?:[-_]|$)/i, "meta"],
  [/^(?:mistral|codestral|devstral|magistral)(?:[-_]|$)/i, "mistralai"],
  [/^command(?:[-_]|$)/i, "cohere"],
  [/^ernie(?:[-_]|$)/i, "baidu"],
  [/^(?:doubao|seed)(?:[-_]|$)/i, "bytedance"],
  [/^beam(?:[-_]|$)/i, "reflection"],
];

/**
 * 归属公司键；优先用适配器给的 canonical 公司，缺省时按 id 前缀兜底。
 * @param id - 模型 id。
 * @param company - 适配器带下来的公司键。
 * @returns 公司键；认不出来是 `"other"`。
 */
export function companyKeyOf(id: string, company?: string): string {
  if (company !== undefined && company.trim() !== "") return company.trim();
  for (const [pattern, key] of ID_PREFIXES) if (pattern.test(id)) return key;
  return "other";
}

/**
 * 公司展示名。
 * @param key - 公司键。
 * @returns 展示名；未知键原样返回（不丢信息）。
 */
export function companyLabelOf(key: string): string {
  if (key === "other") return COMPANY_LABELS.other!;
  return COMPANY_LABELS[key] ?? key;
}

/**
 * 是否免费模型。目录的 `cost` 明确为 0 时优先；否则按 id 里的 `free` 段兜底
 * （`beam-free`、`step-5-preview-free`、`cat-jam-free`）。
 * @param id - 模型 id。
 * @param free - 目录的免费标记。
 * @returns 是否免费。
 */
export function isFreeModel(id: string, free?: boolean): boolean {
  return free === true || /(?:^|[-_/])free(?:$|[-_/])/i.test(id) || /-free$/i.test(id);
}

/**
 * 分组：免费组永远第一，其余按公司首次出现顺序；`other` 放最后。
 * 输入顺序即目录顺序，组内也保持它。
 * @param models - 模型列表。
 * @returns 分组；空输入返回空数组。
 */
export function groupModels(models: readonly ModelGroupInput[]): ModelGroup[] {
  const free: string[] = [];
  const groups = new Map<string, string[]>();
  for (const model of models) {
    if (isFreeModel(model.id, model.free)) {
      free.push(model.id);
      continue;
    }
    const key = companyKeyOf(model.id, model.company);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [model.id]);
    else bucket.push(model.id);
  }
  const out: ModelGroup[] = [];
  if (free.length > 0) out.push({ key: "free", models: free });
  for (const [key, ids] of groups) {
    if (key === "other") continue;
    out.push({ key, models: ids });
  }
  const other = groups.get("other");
  if (other !== undefined && other.length > 0) out.push({ key: "other", models: other });
  return out;
}
