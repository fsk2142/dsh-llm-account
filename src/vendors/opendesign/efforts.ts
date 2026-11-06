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
 * 这份表比推断可靠得多 —— 之前按族给的 `low/high` 漏掉了 DeepSeek 的 `max`（实际情况：
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
 * DeepSeek 的官方档位：`low / high / max`。**没有 `off`。**
 *
 * 依据 <https://api-docs.deepseek.com/zh-cn/guides/thinking_mode>：OpenAI 格式的
 * `reasoning_effort` 与 Anthropic 格式的 `output_config.effort` 都只接受这三档。
 * 关闭思考是**另一个字段**（OpenAI 格式 `thinking.type: "disabled"`，Anthropic 格式
 * `reasoning.effort: "none"`），不是 `reasoning_effort` 的取值。
 *
 * 2026-11-06 修：这里原本写的是 `off / low / high / max`。`off` 五家官方文档都没有，
 * 是本文件自造的 —— 发出去必然被网关 400，然后靠下面的降档兜底重发，白多一轮往返。
 */
const DEEPSEEK_TIERS: readonly string[] = ["low", "high", "max"];

/**
 * Claude：官方 `low / medium / high / max`。
 *
 * 注意 `xhigh` 不是 Anthropic 的值（那是 OpenAI 的），旧表把它当通用档摆给了 Claude。
 */
const CLAUDE_TIERS: readonly string[] = ["low", "medium", "high", "max"];

/**
 * GPT 推理模型：官方枚举 `none / minimal / low / medium / high / xhigh / max`。
 *
 * 依据 OpenAI 官方 SDK 的 `ReasoningEffort`（`none` 仅 gpt-5.1 起、`xhigh` 仅
 * gpt-5.1-codex-max 之后）。具体模型支持哪些由网关校验，被拒时下面会自动降一档。
 */
const GPT_TIERS: readonly string[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** GLM 只认三档（网关原文：`use one of low, high, max`；官方文档同）。 */
const GLM_TIERS: readonly string[] = ["low", "high", "max"];

/**
 * Kimi：k3.1 起官方 `low / high / max`（默认 `max`）。
 *
 * `kimi-k2.7-code` 单独一档 —— **实测（2026-11-06 现场）它认 `low` / `high`，`max` 报 400**。
 * 官方文档说那款「不收 `reasoning_effort`」，但这个网关确实收，而且思考量随档位变化
 * （low→84、high→102 推理 token）。曾经按官方文档把它声明成空数组，等于把一个能用
 * 的功能藏掉，已按实测改回 `low / high`。
 */
const KIMI_TIERS: readonly string[] = ["low", "high", "max"];

/** `kimi-k2.7-code`：实测只到 `high`（`max` → 400）。 */
const KIMI_CODE_TIERS: readonly string[] = ["low", "high"];

/**
 * 未实测族（gemini / grok / qwen / mimo / hy）的保守集。
 *
 * 只放**各家官方都认**的三档：Gemini 用 `thinking_level`、Grok/Qwen 口径各不相同，
 * 没有一家把 `xhigh` / `ultra` 写进官方文档 —— 猜一个上去就是把用户的档位选择变成 400。
 */
const GENERIC_TIERS: readonly string[] = ["low", "medium", "high"];

/**
 * 网关实测的逐模型白名单（2026-10-18，账号可用的 12 个模型全部覆盖）。
 *
 * 键是小写 id（比对时统一小写）；值按由弱到强排列，选择器直接用这个顺序。
 */
export const MEASURED_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  "claude-haiku-5.5": CLAUDE_TIERS,
  "deepseek-v4-flash": DEEPSEEK_TIERS,
  "deepseek-v4-flash-vision-exp": DEEPSEEK_TIERS,
  "deepseek-v4-pro": DEEPSEEK_TIERS,
  "deepseek-v4.1-flash": DEEPSEEK_TIERS,
  "glm-5.3-flash": GLM_TIERS,
  "glm-5.3-flashx": GLM_TIERS,
  "gpt-6-luna": GPT_TIERS,
  "hy4-preview": GENERIC_TIERS,
  // 实测：low / high 都收，max → 400（2026-11-06 现场复测）。
  "kimi-k2.7-code": KIMI_CODE_TIERS,
  "mimo-v2.6-flash": GENERIC_TIERS,
  "mimo-v2.6-pro": GENERIC_TIERS,
};

/** 模型族 → 档位。顺序即优先级，命中即停（只对**表里没有**的模型生效）。 */
const FAMILIES: readonly { readonly pattern: RegExp; readonly efforts: readonly string[] }[] = [
  // Claude（Opus / Sonnet / Haiku）与 anthropic 前缀。
  { pattern: /(?:^|[/_-])(?:claude|anthropic)(?:[/_-]|$)/i, efforts: CLAUDE_TIERS },
  // DeepSeek：官方三档（`low / high / max`）。
  { pattern: /(?:^|[/_-])deepseek(?:[/_-]|$)/i, efforts: DEEPSEEK_TIERS },
  // GLM / Z.ai：只认三档。
  { pattern: /(?:^|[/_-])(?:glm|z-ai|zai)(?:[/_-]|$)/i, efforts: GLM_TIERS },
  // Kimi / Moonshot：k3.1 起三档。
  { pattern: /(?:^|[/_-])(?:kimi|moonshot)(?:[/_-]|$)/i, efforts: KIMI_TIERS },
  // GPT-5 及以后、o 系列推理模型。
  { pattern: /(?:^|[/_-])(?:gpt-?[5-9]|o[1-9](?:$|[/_-]))/i, efforts: GPT_TIERS },
  // 未实测的族：只给各家官方都认的三档，真被拒时适配器会按网关白名单降一档重发。
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

/**
 * 档位强弱顺序（用于「网关拒绝时降一档」）。
 *
 * `off` **不是任何一家的官方取值**，只在 2026-11-06 之前被本插件写进过设置。它留在这里
 * 的唯一用途是让那种旧值还能被算出「最弱」从而降档，绝不参与声明（见 `DEEPSEEK_TIERS`）。
 */
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
 * 网关拒绝了某个档位时，挑一个**比它更强、且被允许**的档位（升档）。
 *
 * ## 为什么是升档而不是降档（2026-11-06 用户要求）
 *
 * 原来的策略是「降一档」：选不高于请求值的最强档位。实测下来这会把用户的意图
 * **悄悄削弱** —— 用户点 `xhigh`，网关只认到 `high`，于是这次请求的思考量比预期少。
 * 升档则相反：宁可多想一点，也不要比用户要的少。
 *
 * 这是**有意的方向性偏置**：推理档位调高的代价是多花 token，调低的代价是答案质量下降，
 * 而用户选择高档次本身就是在表达「我愿意为质量付钱」。
 *
 * ## 没有更强的档位时
 *
 * 返回 `undefined`，由调用方**去掉字段**重发 —— 也就是交回厂商默认。
 * 不退回一个更弱的显式档位：那正是要避免的静默降档。
 * @param requested - 用户/宿主选的档位。
 * @param allowed - 网关白名单。
 * @returns 更强的可用档位；没有更强项（或白名单为空）时为 `undefined`。
 */
export function upgradeAllowedEffort(requested: string, allowed: readonly string[]): string | undefined {
  const wanted = STRENGTH_ORDER.indexOf(requested.toLowerCase());
  const usable = allowed
    .map((value) => ({ value, rank: STRENGTH_ORDER.indexOf(value) }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank);
  if (usable.length === 0) return undefined;
  // 用户选的那档不在强弱表里（自定义 id）时无法比较，按「最高可用」处理 —— 同样不降档。
  if (wanted < 0) return usable[usable.length - 1]!.value;
  // 严格更强的第一个；找不到就是「已经到顶」，返回 undefined 让调用方去掉字段。
  return usable.find((entry) => entry.rank > wanted)?.value;
}
