/**
 * Open Design 的推理档位：**逐模型实测表优先，模型族兜底**。
 *
 * 为什么需要这份表：`GET /v1/models` 走 OpenAI 目录形状（`{ id, object, created, owned_by,
 * metadata, architecture }`），**不公布档位**。而宿主的思考强度选择器完全由
 * `resolveModel().reasoning.effects` 驱动 —— 不声明就等于这家没有档位可选。
 *
 * 为什么能"实测"：这个网关对**不认识的档位**会回 400，而且正文直接把该模型的白名单念出来
 * （`use one of none, minimal, low, medium, high, xhigh, ultra, max` /
 * `expected one of "max"|"xhigh"|…`）。2026-10-18 用本机登录产物对每个可用模型各打一次
 * `reasoning_effort: __probe__`，把网关自己说的白名单抄成了 {@link MEASURED_EFFORTS}。
 * 这份表比推断可靠得多 —— 之前按族给的 `low/high` 漏掉了 DeepSeek 的 `max`（用户报障：
 * 「opendesign 的 DeepSeek 不能设置 max 思考吗？」），而实测它支持到 8 档。
 *
 * 纪律：
 * 1. 表里有的模型**只用表**（网关亲口说的）；
 * 2. 表里没有的按模型族兜底（顺序即选择器顺序，由弱到强）；
 * 3. 族也认不出就**不声明**：猜一组档位换来的是发出去就被拒的请求，比「没有档位可选」更糟；
 * 4. 目录哪天自己公布档位（`efforts` / `supported_efforts` / `reasoning_efforts`）就以目录为准。
 * @module dsh-llm-account/src/vendors/opendesign/efforts
 */

/**
 * DeepSeek 的**官方四档**：`off / low / high / max`。
 *
 * 网关其实还接受 `none / minimal / medium / xhigh / ultra`（把别名摊平成上游的四档），
 * 但全摆出来只会让选择器变成一张让人选不清的表 —— 官方口径是四档，界面就四档。
 */
const DEEPSEEK_TIERS: readonly string[] = ["off", "low", "high", "max"];

/** Claude / GPT / 未实测族：官方档位到 `max`（`none`/`minimal` 是网关别名，不摆出来）。 */
const FIVE_TIERS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** GLM 只认三档（网关原文：`use one of low, high, max`）。 */
const GLM_TIERS: readonly string[] = ["low", "high", "max"];

/** Kimi：网关明确不接受 `max`（原文只到 `xhigh`），官方口径也就两档。 */
const KIMI_TIERS: readonly string[] = ["low", "high"];

/** 未实测族用的保守集：有 `max`，但不声明只有部分厂商认的 `none` / `minimal` / `ultra`。 */
const GENERIC_TIERS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * 网关实测的逐模型白名单（2026-10-18，账号可用的 12 个模型全部覆盖）。
 *
 * 键是小写 id（比对时统一小写）；值按由弱到强排列，选择器直接用这个顺序。
 */
export const MEASURED_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  "claude-haiku-5.5": FIVE_TIERS,
  "deepseek-v4-flash": DEEPSEEK_TIERS,
  "deepseek-v4-flash-vision-exp": DEEPSEEK_TIERS,
  "deepseek-v4-pro": DEEPSEEK_TIERS,
  "deepseek-v4.1-flash": DEEPSEEK_TIERS,
  "glm-5.3-flash": GLM_TIERS,
  "glm-5.3-flashx": GLM_TIERS,
  "gpt-6-luna": FIVE_TIERS,
  "hy4-preview": FIVE_TIERS,
  "kimi-k2.7-code": KIMI_TIERS,
  "mimo-v2.6-flash": FIVE_TIERS,
  "mimo-v2.6-pro": FIVE_TIERS,
};

/** 模型族 → 档位。顺序即优先级，命中即停（只对**表里没有**的模型生效）。 */
const FAMILIES: readonly { readonly pattern: RegExp; readonly efforts: readonly string[] }[] = [
  // Claude（Opus / Sonnet / Haiku）与 anthropic 前缀。
  { pattern: /(?:^|[/_-])(?:claude|anthropic)(?:[/_-]|$)/i, efforts: FIVE_TIERS },
  // DeepSeek：官方四档（`off / low / high / max`）。
  { pattern: /(?:^|[/_-])deepseek(?:[/_-]|$)/i, efforts: DEEPSEEK_TIERS },
  // GLM / Z.ai：只认三档。
  { pattern: /(?:^|[/_-])(?:glm|z-ai|zai)(?:[/_-]|$)/i, efforts: GLM_TIERS },
  // Kimi / Moonshot：网关不接受 `max`。
  { pattern: /(?:^|[/_-])(?:kimi|moonshot)(?:[/_-]|$)/i, efforts: KIMI_TIERS },
  // GPT-5 及以后、o 系列推理模型。
  { pattern: /(?:^|[/_-])(?:gpt-?[5-9]|o[1-9](?:$|[/_-]))/i, efforts: FIVE_TIERS },
  // 未实测的族：给一组带 `max` 的保守集，真被拒时适配器会按网关白名单降一档重发。
  { pattern: /(?:^|[/_-])gemini(?:[/_-]|$)/i, efforts: GENERIC_TIERS },
  { pattern: /(?:^|[/_-])grok(?:[/_-]|$)/i, efforts: GENERIC_TIERS },
  { pattern: /(?:^|[/_-])qwen(?:[/_-]|\d)/i, efforts: GENERIC_TIERS },
  { pattern: /(?:^|[/_-])(?:mimo|hy\d)(?:[/_-]|\d)/i, efforts: GENERIC_TIERS },
];

/**
 * 查一个模型在**没有目录声明**时的可选档位。
 * @param model - 模型 id。
 * @returns 档位列表；既不在实测表里、族也认不出时为空数组（不声明）。
 */
export function familyEfforts(model: string): readonly string[] {
  const measured = MEASURED_EFFORTS[model.trim().toLowerCase()];
  if (measured !== undefined) return measured;
  for (const family of FAMILIES) {
    if (family.pattern.test(model)) return family.efforts;
  }
  return [];
}

/**
 * 一个模型最终声明的档位：目录声明优先，其次是实测表 / 模型族兜底。
 * @param model - 模型 id。
 * @param declared - 目录里声明的档位（可为空/缺省）。
 * @returns 档位列表；都认不出时为空数组。
 */
export function effortsFor(model: string, declared?: readonly string[]): readonly string[] {
  if (declared !== undefined && declared.length > 0) return declared;
  return familyEfforts(model);
}

/** 档位强弱顺序（用于「网关拒绝时降一档」）。`off` 是 `none` 的别名，排在它前面。 */
const STRENGTH_ORDER: readonly string[] = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "ultra", "max"];

/**
 * 从网关的 400 正文里读出它认的档位白名单。
 *
 * 这个网关两种口吻都出现过：
 * - `[code=invalid_request_error] reasoning effort is unsupported for deepseek-v4-pro; use one of none, minimal, …`
 * - `[code=upstream_error] reasoning_effort: Invalid option: expected one of "max"|"xhigh"|…`
 * @param body - 已解析的错误正文（对象或原始文本）。
 * @returns 白名单（可能为空）。
 */
export function allowedEffortsIn(body: unknown): readonly string[] {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const after = text.includes("use one of")
    ? text.slice(text.indexOf("use one of") + "use one of".length)
    : text.includes("expected one of")
      ? text.slice(text.indexOf("expected one of") + "expected one of".length)
      : "";
  if (after === "") return [];
  const found = after.match(/[a-z]+/gi) ?? [];
  const allowed: string[] = [];
  for (const token of found) {
    const value = token.toLowerCase();
    // 只收档位词：正文尾巴常带别的词（`type`, `code`, `message`…）。
    if (!STRENGTH_ORDER.includes(value)) {
      // 遇到第一个非档位词就收手：白名单总是连着念完的。
      if (allowed.length > 0) break;
      continue;
    }
    if (!allowed.includes(value)) allowed.push(value);
  }
  return allowed;
}

/**
 * 网关拒绝了某个档位时，挑一个「不高于它、但被允许」的最强档位。
 * @param requested - 用户/宿主选的档位。
 * @param allowed - 网关白名单。
 * @returns 可用的替代档位；没有更弱的可选项时为 `undefined`（调用方会去掉字段重发）。
 */
export function nearestAllowedEffort(requested: string, allowed: readonly string[]): string | undefined {
  const wanted = STRENGTH_ORDER.indexOf(requested.toLowerCase());
  const usable = allowed
    .map((value) => ({ value, rank: STRENGTH_ORDER.indexOf(value) }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank);
  if (usable.length === 0) return undefined;
  // 用户选的那档不在表里（自定义 id）时按「最高可用」处理。
  if (wanted < 0) return usable[usable.length - 1]!.value;
  let best: string | undefined;
  for (const entry of usable) {
    if (entry.rank > wanted) break;
    best = entry.value;
  }
  return best ?? usable[0]!.value;
}
