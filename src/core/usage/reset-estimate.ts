/**
 * 额度窗口的**重置时间估算**。
 *
 * ## 背景：为什么需要估算
 *
 * Command Code 的 `/alpha/billing/credits` 只给窗口的 `used` 与 `cap`，**不给 `resetAt`**：
 *
 * ```
 * windowLimits = { fiveHour: { used: 0.0024, cap: 14 },
 *                  weekly:   { used: 14.2285949297, cap: 35 } }
 * ```
 *
 * 而月度窗口的重置时间来自 `/alpha/billing/subscriptions` 的 `currentPeriodEnd` ——
 * 所以只有月度能显示真实的重置时刻，5 小时与周只能显示为空。
 *
 * ## 估算依据（唯一的可观测事实）
 *
 * 固定窗口（非滚动）的额度是**按时段重置**的：一个 5 小时窗口用完之后，`used` 回到 0。
 * 于是「**第一次观测到 `used` 从 0 变正的时刻**」就是那个窗口的起点，加 5 小时就是重置时刻。
 *
 * ## 三条纪律（缺一不可）
 *
 * 1. **绝不把估算说成事实**：结论带 `estimated: true`，界面必须显示「约」，且要能区分
 *    「厂商给的」与「我们算的」。
 * 2. **没有可靠锚点就不给估算**：从未观测到 `used === 0` 的账号（例如插件刚装、窗口早就
 *    开始了）只能给「未知」—— 拿安装时刻当锚点会得出一个与真实重置毫无关系的数字。
 * 3. **锚点会过期**：窗口长度（5 小时 / 7 天）一到，下一次观测到的 `used` 若再次变正，
 *    锚点就换成新那次；否则旧锚点必须丢弃，不能一直往后加窗口长度（那会推出一个永远在
 *    未来的假时间）。
 *
 * @module dsh-llm-account/src/core/usage/reset-estimate
 */

/** 窗口长度（毫秒）。 */
export const WINDOW_LENGTH_MS: Readonly<Record<"five-hour" | "week", number>> = {
  "five-hour": 5 * 3_600_000,
  week: 7 * 24 * 3_600_000,
};

/** 一次观测：某个窗口在某个时刻的已用量。 */
export interface WindowObservation {
  /** 窗口标识（`fiveHour` / `weekly` / …）。 */
  key: string;
  /** 已用量；`undefined` 表示这次没读到（**不能**当成 0）。 */
  used: number | undefined;
  /** 观测时刻（epoch 毫秒）。 */
  at: number;
}

/** 一个窗口的重置时刻估算结果。 */
export interface ResetEstimate {
  /** 估算的重置时刻（epoch 毫秒）。 */
  resetAt: number;
  /** **恒为 `true`**：这是估算值，不是厂商公布的事实。 */
  estimated: true;
  /** 估算所依赖的锚点时刻（第一次观测到 `used` 从 0 变正那一刻）。 */
  anchorAt: number;
  /** 这次估算的窗口长度。 */
  windowMs: number;
}

/** 一个窗口的锚点状态（需要跨调用保存）。 */
export interface AnchorState {
  /** 锚点时刻（`used` 从 0 变正的观测时刻）。 */
  anchorAt: number;
  /** 建立锚点时的窗口长度。 */
  windowMs: number;
}

/** 从窗口 key 判断是不是固定窗口（只有固定窗口才能用「起点 + 长度」估算）。 */
export function fixedWindowMs(key: string): number | undefined {
  const normalized = key.trim().toLowerCase();
  if (normalized.includes("fivehour") || normalized === "5h" || normalized.includes("five-hour")) {
    return WINDOW_LENGTH_MS["five-hour"];
  }
  if (normalized.includes("week")) return WINDOW_LENGTH_MS.week;
  return undefined;
}

/**
 * 用一次观测更新锚点，并给出重置时刻估算。
 *
 * 判定顺序（每条都对应一个真实场景）：
 *
 * 1. 不是固定窗口（月度等）→ 不估算（它们有自己的真实来源或本来就按自然月）；
 * 2. 这次没读到 `used`（`undefined`）→ 原样返回旧锚点，**不当作 0**；
 * 3. `used === 0` → 记录「窗口当前是空的」：若之前有锚点，说明已经重置过，丢弃它；
 * 4. `used > 0` 且没有锚点 → **建立**锚点（这是唯一能确定起点的时刻）；
 * 5. `used > 0` 且已有锚点 → 若估算的重置时刻**已经过去**，说明我们错过了重置（插件关着 /
 *    没轮询），旧锚点作废、用当前时刻重新锚定；否则沿用旧锚点。
 *
 * @param previous - 这个窗口上次的锚点状态（没有就 `undefined`）。
 * @param observation - 本次观测。
 * @returns 新锚点与估算；不可估算时 `estimate` 为 `undefined`。
 */
export function estimateReset(
  previous: AnchorState | undefined,
  observation: WindowObservation,
): { anchor: AnchorState | undefined; estimate: ResetEstimate | undefined } {
  const windowMs = fixedWindowMs(observation.key);
  if (windowMs === undefined) return { anchor: previous, estimate: undefined };
  // 这次没读到：保持原状（**不**把「读不到」当成 0）。
  if (observation.used === undefined || !Number.isFinite(observation.used)) {
    return {
      anchor: previous,
      estimate:
        previous === undefined
          ? undefined
          : { resetAt: previous.anchorAt + previous.windowMs, estimated: true, anchorAt: previous.anchorAt, windowMs: previous.windowMs },
    };
  }
  // 窗口是空的：如果之前有锚点，说明这一轮已经重置过了。
  if (observation.used === 0) {
    return { anchor: undefined, estimate: undefined };
  }
  // 有锚点：先看它是否已经过期（估算的重置时刻早于现在 = 我们错过了那次重置）。
  if (previous !== undefined) {
    const resetAt = previous.anchorAt + previous.windowMs;
    if (resetAt > observation.at) {
      return { anchor: previous, estimate: { resetAt, estimated: true, anchorAt: previous.anchorAt, windowMs: previous.windowMs } };
    }
    // 过期：重新锚定（用当前这次观测当新起点）。
    const anchor: AnchorState = { anchorAt: observation.at, windowMs };
    return {
      anchor,
      estimate: { resetAt: observation.at + windowMs, estimated: true, anchorAt: observation.at, windowMs },
    };
  }
  // 没有锚点且窗口非空：这是本插件能看到的「起点」，记下来。
  const anchor: AnchorState = { anchorAt: observation.at, windowMs };
  return {
    anchor,
    estimate: { resetAt: observation.at + windowMs, estimated: true, anchorAt: observation.at, windowMs },
  };
}
