/**
 * **限额换模型**的纯判定。
 *
 * ## 需求演化（记下来，免得再绕回去）
 *
 * 1. 最初：「遇到账号限额的时候自动切换到同等类型的模型还有思考强度，但是排除官方的 API」；
 * 2. 中间加过「自动切换模型白名单」（手填 / 勾选）；
 * 3. 现在（2026-10-19 晚）：「不要那个了，太复杂了，就直接从每个账号可选模型中随机切换吧」，
 *    并给出明确优先级。
 *
 * ## 四级优先（需求的落地）
 *
 * 1. **同网关 + 同名模型**（最安全：还是同一家发请求、模型等级不变）；
 * 2. **跨网关 + 同名模型**（换一家发，模型等级不变）；
 * 3. **同网关 + 不同名模型**（换等级但不出这家；「参数能力什么的接近」按上下文窗口与
 *    推理档位接近度排）；
 * 4. **跨网关 + 不同名模型**（最后手段）。
 *
 * 同一优先级里有多个候选时**随机**选一个（需求「随机切换」，避免总压在同一个上）。
 *
 * 排除 DeepSeek 官方直连（用户最初就要求的），以及**自己**（同一个网关+同一个 id）。
 *
 * 纯函数：不读网络、不读设置、不留状态，可完整单测（随机源可注入）。
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
 * 前缀匹配既挡住官方，也不会误伤 `dsh-opencode-go`。
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
  /** 提供这个模型的网关路由 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。 */
  provider: string;
  /** 模型 id。 */
  model: string;
  /**
   * 上下文窗口（token）。用于第 3/4 级「参数能力接近」的排序；未知时缺省
   * （视为最不接近 —— 未知不该被当成"恰好合适"）。
   */
  contextWindow?: number;
  /** 推理档位数量。档位越多通常能力越强，作为「接近度」的第二判据。 */
  effortCount?: number;
}

/** 四级优先的级别（数字越小越优先）。 */
export type FallbackTier = 1 | 2 | 3 | 4;

/**
 * 一个候选属于第几级。
 *
 * @param current - 刚失败的 (网关, 模型)。
 * @param candidate - 待判定的候选。
 * @returns 级别：1 同网关同名 / 2 跨网关同名 / 3 同网关异名 / 4 跨网关异名。
 */
export function fallbackTierOf(current: FallbackCandidate, candidate: FallbackCandidate): FallbackTier {
  const sameGateway = candidate.provider === current.provider;
  const sameModel = modelKeyOf(candidate.model) === modelKeyOf(current.model);
  if (sameGateway) return sameModel ? 1 : 3;
  return sameModel ? 2 : 4;
}

/**
 * 「参数能力接近度」：与当前模型差多少（越小越接近）。
 *
 * 只在第 3/4 级（异名模型）时用得上 —— 同名时等级本来就一样。
 * 判据按重要性排：
 * 1. 上下文窗口的相对差（相差一个数量级就明显不是同级模型）；
 * 2. 推理档位数量之差（反映深度档位丰富度）。
 *
 * 未知值（缺省）给一个很大的惩罚分：宁可选一个已知相近的，也不要把未知当成恰好合适。
 * @param current - 当前模型。
 * @param candidate - 候选。
 * @returns 距离分（非负；越小越接近）。
 */
export function capabilityDistance(current: FallbackCandidate, candidate: FallbackCandidate): number {
  const UNKNOWN = 1e9;
  const windowScore = (() => {
    const from = current.contextWindow;
    const to = candidate.contextWindow;
    if (from === undefined || to === undefined || from <= 0 || to <= 0) return UNKNOWN;
    // 相对差：同量级时很小，差 10 倍时约 9。
    return Math.abs(Math.log2(to / from));
  })();
  const effortScore = (() => {
    const from = current.effortCount;
    const to = candidate.effortCount;
    if (from === undefined || to === undefined) return UNKNOWN / 100;
    return Math.abs(to - from);
  })();
  // 窗口优先（×100），档位作为同窗口下的次级判据。
  return windowScore * 100 + effortScore;
}

/**
 * 从候选里按**四级优先**选一个替代模型。
 *
 * 同一级里有多个候选时**随机**取一个（需求「随机切换」）。为什么不是取第一个：
 * 候选来自固定顺序的目录，总取第一个会让所有账号的失败都压到同一个模型上。
 *
 * @param current - 刚失败的 (网关, 模型)。
 * @param candidates - 可选模型（**只该包含用户允许的那些**，由调用方过滤）。
 * @param options - `random` 随机源（测试注入，缺省 `Math.random`）；
 *   `excludeOfficial` 默认 `true`；
 *   `sameGatewayOnly` 默认 `false`（见下）。
 * @returns 替代目标；没有任何合格候选时为 `undefined`（停手）。
 */
export function pickFallbackModel(
  current: FallbackCandidate,
  candidates: readonly FallbackCandidate[],
  options: { random?: () => number; excludeOfficial?: boolean; sameGatewayOnly?: boolean } = {},
): FallbackCandidate | undefined {
  const excludeOfficial = options.excludeOfficial !== false;
  const random = options.random ?? Math.random;
  /**
   * **只在同一网关内换**（2026-10-28 加）。
   *
   * 用于「网络层断裂」这一类失败：`fetch failed` / DNS / 代理不通意味着**这台机器
   * 出不去**，换到另一家网关走的是同一个网卡、同一条路由 —— 必然同样失败，只是白烧
   * 一次请求 + 多等一轮。那种情况下「换厂商」毫无意义，只该在同一网关内换模型
   * （同名模型可能落在不同上游）。
   *
   * 额度不足、鉴权失败、上游 5xx 这些**服务侧**的失败不设这个限制：换一家真的可能
   * 绕过（那家没坏）。
   */
  const sameGatewayOnly = options.sameGatewayOnly === true;

  // 1) 过滤掉不合格的：官方直连、自己、空 id；`sameGatewayOnly` 时再排除跨网关的。
  const usable = candidates.filter((candidate) => {
    if (typeof candidate.model !== "string" || candidate.model.trim() === "") return false;
    if (typeof candidate.provider !== "string" || candidate.provider.trim() === "") return false;
    if (excludeOfficial && isOfficialProvider(candidate.provider)) return false;
    if (sameGatewayOnly && candidate.provider !== current.provider) return false;
    // 「自己」：同网关 + 同 id（同名但不同写法的算合格 —— 那正是第 1 级要找的）。
    if (candidate.provider === current.provider && candidate.model === current.model) return false;
    return true;
  });
  if (usable.length === 0) return undefined;

  // 2) 按级别分组，取最小的那个非空级别。
  const tiers = new Map<FallbackTier, FallbackCandidate[]>();
  for (const candidate of usable) {
    const tier = fallbackTierOf(current, candidate);
    const bucket = tiers.get(tier);
    if (bucket === undefined) tiers.set(tier, [candidate]);
    else bucket.push(candidate);
  }
  const bestTier = ([1, 2, 3, 4] as const).find((tier) => (tiers.get(tier)?.length ?? 0) > 0);
  if (bestTier === undefined) return undefined;
  const pool = tiers.get(bestTier)!;
  if (pool.length === 1) return pool[0];

  // 3) 第 3/4 级（异名模型）先按能力接近度收窄，再随机。
  //
  // 为什么收窄再随机：异名模型之间必须能力接近才可替换。如果直接在全部异名模型里随机，
  // 有可能把一个 1M 上下文的 flash 换成一个 8K 上下文的旧模型 —— 那不是"切换"，是降级。
  // 收窄到「最接近的那一档」再在其中随机，兼顾了「接近」与「不要总压同一个」。
  const narrowed =
    bestTier === 3 || bestTier === 4
      ? (() => {
          const scored = pool.map((candidate) => ({ candidate, distance: capabilityDistance(current, candidate) }));
          const min = Math.min(...scored.map((item) => item.distance));
          return scored.filter((item) => item.distance === min).map((item) => item.candidate);
        })()
      : pool;
  const index = Math.min(narrowed.length - 1, Math.max(0, Math.floor(random() * narrowed.length)));
  return narrowed[index];
}

/**
 * 思考强度的回落：**尽量保持原样**。
 *
 * 需求「连同思考强度一起切换」。但如果替代模型不支持原来的档位（`max` 而它只有
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
