/**
 * Command Code 的**静态套餐表**：`planId` 前缀 → 展示名 + 每月额度（美元）。
 *
 * 为什么必须是静态表：`/alpha/billing/subscriptions` 只回报 `planId`（如
 * `individual-goat`）与状态，**从不回报套餐名与每月额度**；官方 CLI 自己在
 * `dist/cli.mjs` 里带同一张表（`getPlanInfo` / `getPlanTotalCredits`，2026-10-18
 * 对 command-code@1.84.0 逐条核对：`individual-goat` → GOAT → 70），旧插件
 * `@mars-sea/dsh-commandcode-provider` 的 `KNOWN_SUBSCRIPTION_PLANS`（第 941-995 行）
 * 与它一致。
 *
 * 线上交叉验证（2026-10-18，订阅账号 sample-user）：`planId=individual-goat` 时
 * `windowLimits.fiveHour.cap = 14`、`weekly.cap = 35` —— 正好是 70 的 1/5 与 1/2；
 * `monthlyCredits` 余额 55.7714050703，`70 - 55.7714050703 = 14.2285949297` 与该账号的
 * `weekly.used` 一字不差。这张表就是月度配给的事实来源，不是估出来的。
 *
 * 纪律：表里没有的 `planId` **就是没有名称与额度**（不给默认值、不猜）—— 新套餐上线时
 * 补表，界面在此之前只显示标识与状态。
 * @module dsh-llm-account/src/vendors/commandcode/plans
 */

/** 一条套餐：`planId` 前缀、展示名、每月额度（美元）。 */
export interface CommandCodePlanInfo {
  /** 展示名（官方 CLI 的 `wr` 表：`Go` / `GOAT` / `Pro` / …）。 */
  name: string;
  /** 每月额度（官方 CLI 的 `Sr` 表，美元口径）。 */
  monthlyCredits: number;
}

/**
 * `planId` 前缀 → 套餐。顺序不重要：{@link subscriptionPlanInfo} 取**最长**匹配，
 * 所以 `individual-pro-v1` 命中 `individual-pro-v1`（80）而不是 `individual-pro`（30）
 * —— 旧插件的同一处用最长前缀（第 1005-1010 行），CLI 用的是数组顺序的 `find`，
 * 这里跟旧插件（它对 `-v1` 变体的额度更准）。
 */
export const SUBSCRIPTION_PLANS: Readonly<Record<string, CommandCodePlanInfo>> = {
  "individual-go": { name: "Go", monthlyCredits: 10 },
  "individual-go-v1": { name: "Go", monthlyCredits: 10 },
  "individual-goat": { name: "GOAT", monthlyCredits: 70 },
  "individual-pro": { name: "Pro", monthlyCredits: 30 },
  "individual-pro-v1": { name: "Pro", monthlyCredits: 80 },
  "individual-provider": { name: "Provider", monthlyCredits: 15 },
  "individual-max": { name: "Max", monthlyCredits: 150 },
  "individual-ultra": { name: "Ultra", monthlyCredits: 300 },
  "teams-pro": { name: "Teams Pro", monthlyCredits: 40 },
};

/** 规范化的 `planId`（小写、下划线折成连字符）与命中的前缀。 */
function longestPrefix(planId: string): string | undefined {
  const normalized = planId.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "") return undefined;
  let hit: string | undefined;
  for (const prefix of Object.keys(SUBSCRIPTION_PLANS)) {
    if (!normalized.startsWith(prefix)) continue;
    if (hit === undefined || prefix.length > hit.length) hit = prefix;
  }
  return hit;
}

/**
 * 查一个 `planId` 的套餐名与每月额度。
 * @param planId - 端点给的套餐标识原文。
 * @returns 命中的套餐；表里没有这个前缀时为 `undefined`（界面退回标识，不猜名称与额度）。
 */
export function subscriptionPlanInfo(planId: string): CommandCodePlanInfo | undefined {
  const prefix = longestPrefix(planId);
  return prefix === undefined ? undefined : SUBSCRIPTION_PLANS[prefix];
}
