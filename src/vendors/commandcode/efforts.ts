/**
 * Command Code 的**静态能力快照**：模型 → 可选推理档位。
 *
 * 为什么必须是静态表：网关的 `/provider/v1/models` 只公布 `reasoning: true|false`（这个模型
 * 会不会思考），**从不公布档位** —— 2026-10-18 线上实测（两个账号、85 个模型），整份负载的键
 * 只有 `id` / `name` / `reasoning` / `contextWindow` / `maxTokens`。档位只在官方 CLI 打包的
 * 模型表（`command-code` 的 `dist/cli.mjs`）里；本表逐字对应该表，与旧插件
 * `@mars-sea/dsh-commandcode-provider` 的 `KNOWN_EFFORTS`（在 command-code@1.79.2 上校验过）
 * 完全一致。
 *
 * 用户可见后果（2026-10-18 报障「选择模型后仍然无法继续选择思考模式」）：宿主的思考档位
 * 选择器完全由 `resolveModel().reasoning.efforts` 驱动 —— 不声明档位，等于这家模型没有档位
 * 可选；而网关永远不声明，所以这份表就是唯一的档位来源。
 *
 * 纪律：表里没有的模型**就是不声明档位**（自动思考、由厂商决定深度的模型本来就没有可选档位，
 * 旧插件的 `KNOWN_THINKING_MODELS` 就是这批 21 个）；猜一组档位只会换来一个发出去就被厂商
 * 拒绝的请求。
 * @module dsh-llm-account/src/vendors/commandcode/efforts
 */

/** 模型 id → 可选档位（数组顺序即界面顺序；取自官方 CLI 的模型表）。 */
export const KNOWN_EFFORTS: Readonly<Record<string, readonly string[]>> = {
  "Qwen/Qwen3.8-Max": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max-0902": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-27B": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Flash": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Omni-Flash": ["low", "medium", "xhigh"],
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5-5": ["low", "medium", "high", "xhigh", "max"],
  "deepseek/deepseek-v4-flash-fast": ["low", "high", "max"],
  "deepseek/deepseek-v4.1-flash": ["off", "low", "high", "max"],
  "deepseek/deepseek-v4.1-flash-fast": ["off", "low", "high", "max"],
  "deepseek/deepseek-v4-flash": ["off", "high", "max"],
  "deepseek/deepseek-v4-flash-vision-exp": ["off", "high", "max"],
  "deepseek/deepseek-v4-pro": ["off", "high", "max"],
  "google/gemini-3.1-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.5-flash": ["low", "medium", "high"],
  "google/gemini-3.5-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.6-flash": ["low", "medium", "high"],
  "google/gemini-3.7-flash": ["low", "medium", "high"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["low", "medium", "high"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max"],
  "moonshotai/Kimi-K3": ["low", "high", "max"],
  "google/gemini-3.8-flash": ["low", "medium", "high"],
  "sakana/fugu-ultra": ["high", "xhigh"],
  "stepfun/Step-5-Preview": ["low", "medium", "high"],
  "tencent/hy4-preview": ["low", "medium", "high"],
  "xai/grok-4.5": ["low", "medium", "high"],
  "xai/grok-4.6": ["low", "medium", "high", "xhigh"],
  "xai/grok-4.7": ["low", "medium", "high", "xhigh"],
  "z-ai/glm-5.3-flash": ["low", "high", "max"],
  "z-ai/glm-5.3-flashx": ["low", "high", "max"],
  "zai-org/GLM-5.2": ["high", "max"],
  "zai-org/GLM-5.3": ["low", "high", "max"],
  "meta/muse-spark-1.1": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2-contributor": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.3": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.3-contributor": ["low", "medium", "high", "xhigh"],
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-sol": ["low", "medium", "high", "xhigh", "max"],
  "MiniMaxAI/MiniMax-M3": ["low", "medium", "high"],
  "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
  "inclusionai/ling-3.1-flash:free": ["low", "medium", "high"],
  "mistral/mistral-large-4": ["low", "medium", "high"],
  "claude-haiku-5-5": ["low", "medium", "high", "xhigh", "max"],
  "stealth/glyph-cluster:free": ["low", "medium", "high", "xhigh"],
};

/**
 * 查一个模型的可选推理档位。
 * @param model - 模型 id。
 * @returns 档位列表；表里没有该模型时为 `undefined`（不猜）。
 */
export function knownEfforts(model: string): readonly string[] | undefined {
  return Object.hasOwn(KNOWN_EFFORTS, model) ? KNOWN_EFFORTS[model] : undefined;
}
