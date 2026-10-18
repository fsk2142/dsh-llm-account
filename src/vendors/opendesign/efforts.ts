/**
 * Open Design 的推理档位：**目录声明优先，模型族兜底**。
 *
 * 为什么需要兜底：`GET /v1/models` 走的是 OpenAI 的目录形状（`{ id, object, created, owned_by }`），
 * **不公布档位**（`efforts` / `supported_efforts` 这些键线上都没有）。而宿主的思考强度选择器
 * 完全由 `resolveModel().reasoning.efforts` 驱动 —— 不声明就等于这家没有档位可选
 * （用户报障：OpenDesign 的模型选不了思考强度）。
 *
 * 与 Command Code 那家的差别：那边的官方 CLI 带一份**逐 id 的完整表**（`commandcode/efforts.ts`），
 * 可以照抄；Open Design 没有这样一份公开表，所以这里按**模型族**给一组保守档位
 * （`low` / `medium` / `high` —— OpenAI 形状 `reasoning_effort` 的标准取值，也是 Anthropic 系
 * 模型经这类网关时最普遍接受的三个）。族里认不出的模型**不声明**：猜一组档位换来的是
 * 发出去就被拒的请求，比「没有档位可选」更糟。
 *
 * 只影响「声明与闸门」两处：目录自己声明了档位时以目录为准，本表不覆盖它。
 * @module dsh-llm-account/src/vendors/opendesign/efforts
 */

/** 标准档位集合（数组顺序即选择器顺序）。 */
const STANDARD_EFFORTS: readonly string[] = ["low", "medium", "high"];

/** 模型族 → 档位。顺序即优先级，命中即停。 */
const FAMILIES: readonly { readonly pattern: RegExp; readonly efforts: readonly string[] }[] = [
  // Claude（Opus / Sonnet / Haiku）：这类网关普遍把 anthropic 的 effort 折成这三档。
  { pattern: /(?:^|[/_-])(?:claude|anthropic)(?:[/_-]|$)/i, efforts: STANDARD_EFFORTS },
  // GPT-5 及以后、o 系列推理模型。
  { pattern: /(?:^|[/_-])(?:gpt-?[5-9]|o[1-9](?:$|[/_-]))/i, efforts: STANDARD_EFFORTS },
  { pattern: /(?:^|[/_-])gemini(?:[/_-]|$)/i, efforts: STANDARD_EFFORTS },
  { pattern: /(?:^|[/_-])grok(?:[/_-]|$)/i, efforts: STANDARD_EFFORTS },
  // DeepSeek / GLM / Kimi / Qwen：这几家的网关通常只认更粗的档位。
  { pattern: /(?:^|[/_-])deepseek(?:[/_-]|$)/i, efforts: ["low", "high"] },
  { pattern: /(?:^|[/_-])(?:glm|z-ai|zai)(?:[/_-]|$)/i, efforts: ["low", "high"] },
  { pattern: /(?:^|[/_-])(?:kimi|moonshot)(?:[/_-]|$)/i, efforts: ["low", "high"] },
  { pattern: /(?:^|[/_-])qwen(?:[/_-]|\d)/i, efforts: ["low", "high"] },
];

/**
 * 查一个模型在**没有目录声明**时的可选档位。
 * @param model - 模型 id。
 * @returns 档位列表；模型族认不出时为空数组（不声明）。
 */
export function familyEfforts(model: string): readonly string[] {
  for (const family of FAMILIES) {
    if (family.pattern.test(model)) return family.efforts;
  }
  return [];
}

/**
 * 一个模型最终声明的档位：目录声明优先，其次是模型族兜底。
 * @param model - 模型 id。
 * @param declared - 目录里声明的档位（可为空/缺省）。
 * @returns 档位列表；都认不出时为空数组。
 */
export function effortsFor(model: string, declared?: readonly string[]): readonly string[] {
  if (declared !== undefined && declared.length > 0) return declared;
  return familyEfforts(model);
}
