/**
 * **限额时换模型**的纯判定（用户 2026-10-19 要求）。
 *
 * 需求原话：「遇到账号限额的时候自动切换到同等类型的模型还有思考强度，但是排除官方的 API」。
 * 澄清后的一句话版本：**只换同名模型**，没有同名就停手；绝不切到 DeepSeek 官方直连。
 *
 * 为什么「同名」是唯一安全的对应：三家网关各自编模型 id（`deepseek/deepseek-v4.1-flash`、
 * `deepseek-v4.1-flash`、`deepseek/deepseek-v4-pro`），没有任何官方对应表。按「档位词」
 * 猜（flash↔pro）等于替用户改了模型等级 —— 限额是要省钱，不是降智。所以：
 *
 * 1. 优先找一个**归一化后同名**的模型（去掉厂商前缀、大小写、`.`/`-` 差异）；
 * 2. 找不到就**不换**（`undefined`），把决定权交回用户 —— 停手比猜错好；
 * 3. 官方直连路由永远排除。
 *
 * 纯函数：不读网络、不读设置、不留状态，可完整单测。
 * @module dsh-llm-account/src/core/model-fallback
 */

/**
 * 官方直连的 provider id 前缀（要排除的目标）。
 *
 * 本包托管的三个网关（commandcode / dsh-opencode-go / opendesign）都**不是**这里的前缀，
 * 所以「排除官方」= 只在这些网关之间互切。
 */
const OFFICIAL_PROVIDER_PREFIXES: readonly string[] = ["deepseek", "deepseek-account"];

/**
 * 判定一个 provider id 是不是**官方直连**（要排除）。
 *
 * 为什么不只比 `=== "deepseek"`：官方那套插件的路由名不止一个
 * （`deepseek` / `deepseek-account`），将来还可能有 `deepseek-official` 之类的变体。
 * 前缀匹配 + 精确排除本包三家，既挡住官方，也不会误伤 `dsh-opencode-go`。
 * @param provider - provider 路由 id。
 * @returns 是否官方直连。
 */
export function isOfficialProvider(provider: string): boolean {
  const id = provider.trim().toLowerCase();
  if (id === "") return false;
  for (const prefix of OFFICIAL_PROVIDER_PREFIXES) {
    if (id === prefix || id.startsWith(`${prefix}-`)) return true;
  }
  return false;
}

/**
 * 模型 id 的归一化键：用于判定「同名」。
 *
 * 去掉厂商前缀（`deepseek/`）、转小写、统一分隔符：`deepseek-v4.1-flash` 与
 * `deepseek/deepseek-v4.1-flash` 归一到同一个键。
 * @param model - 模型 id。
 * @returns 归一化键；空输入返回空串。
 */
export function modelKeyOf(model: string): string {
  const trimmed = model.trim().toLowerCase();
  if (trimmed === "") return "";
  // 取最后一段：`anthropic/claude-x` → `claude-x`（公司前缀不参与「同名」判定）。
  const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return tail.replace(/[-_.]/gu, "");
}

/** 一个可切换的候选模型。 */
export interface FallbackCandidate {
  /** 提供这个模型的 provider 路由 id。 */
  provider: string;
  /** 模型 id。 */
  model: string;
}

/**
 * 挑一个替代模型：**同名、非官方、在白名单里、且不是刚失败的那一个**。
 *
 * @param current - 刚失败的 (provider, model)。
 * @param candidates - 这台机器上可用的所有 (provider, model)，顺序即偏好顺序。
 * @param options - 见下：
 *   - `excludeOfficial` 默认 `true`（用户明确要求排除官方）；
 *   - `allowCrossProvider` 默认 `false`（adapter 不能替别家发请求；上层编排才开）；
 *   - `whitelist` 用户配置的「自动切换模型白名单」：**非空时只收名单内的**，
 *     空或未给 = 不限制（退回候选原样）。
 * @returns 替代目标；没有合格候选时为 `undefined`（**不猜档位**）。
 */
export function pickFallbackModel(
  current: FallbackCandidate,
  candidates: readonly FallbackCandidate[],
  options: {
    excludeOfficial?: boolean;
    allowCrossProvider?: boolean;
    whitelist?: readonly string[];
  } = {},
): FallbackCandidate | undefined {
  const excludeOfficial = options.excludeOfficial !== false;
  // 默认**只在同一 provider 内换**：adapter 无法替别的 provider 发请求（宿主的
  // `GenerateOptions.provider` 由路由决定），跨厂商换模型得由上层编排。
  const allowCrossProvider = options.allowCrossProvider === true;
  // 白名单：非空时只在这些模型里挑。**用同一个 `modelKeyOf` 归一**，否则用户填
  // `deepseek/deepseek-v4.1-flash` 而候选是 `deepseek-v4.1-flash` 就永远匹配不上 ——
  // 那种「设置了却没效果」最难排查。
  const allowed = new Set<number>();
  const whitelist = (options.whitelist ?? []).filter((item) => typeof item === "string" && item.trim() !== "");
  const whitelistKeys = new Set(whitelist.map((item) => modelKeyOf(item)));
  const wanted = modelKeyOf(current.model);
  if (wanted === "") return undefined;
  void allowed;
  for (const candidate of candidates) {
    if (excludeOfficial && isOfficialProvider(candidate.provider)) continue;
    if (candidate.provider === current.provider && candidate.model === current.model) continue;
    if (!allowCrossProvider && candidate.provider !== current.provider) continue;
    if (modelKeyOf(candidate.model) !== wanted) continue;
    // 白名单非空 → 只收名单内的（同样用归一化键比较）。
    if (whitelistKeys.size > 0 && !whitelistKeys.has(modelKeyOf(candidate.model))) continue;
    return candidate;
  }
  return undefined;
}

/**
 * 思考强度的回落：**尽量保持原样**。
 *
 * 用户要求「连同思考强度一起切换」。但如果替代模型不支持原来的档位（`max` 而它只有
 * `high`），强行发一个它不认的档位会被厂商拒绝 —— 那会把一次限额问题变成一次请求失败。
 * 所以规则是：
 * 1. 替代模型支持原档位 → 原样保留；
 * 2. 否则退回该模型**最高**的可用档位（"尽量想得一样多"）；
 * 3. 替代模型没有任何档位 → 返回 `undefined`（由厂商自己决定深度）。
 *
 * @param wanted - 原本选中的档位（可能为 `undefined`）。
 * @param supported - 替代模型声明的档位（按展序，最后一个视为最高）。
 * @returns 要发送的档位；都不适用时 `undefined`。
 */
export function fallbackEffort(wanted: string | undefined, supported: readonly string[]): string | undefined {
  if (supported.length === 0) return undefined;
  if (wanted !== undefined && supported.includes(wanted)) return wanted;
  return supported[supported.length - 1];
}
