/**
 * Command Code 额度**重置时间估算**的生命周期测试。
 *
 * ## 为什么这个文件存在（第七轮复审 P1-F01）
 *
 * `createCommandCodeQuota` 的闭包里有个 `resetAnchors` Map —— 估算「额度什么时候
 * 重置」要靠它把**上一次观测**传下去（`quota.ts` 的注释写的就是「跨轮询保持」）。
 *
 * 但装配层原来是这么写的：
 *
 * ```ts
 * async snapshot(ref) {
 *   return createCommandCodeQuota({ ... }).snapshot();   // 每次新建工厂
 * }
 * ```
 *
 * 工厂建完就丢，Map 活不过一次请求 —— **每次轮询都从零估算**，界面上的重置时间
 * 会一直往前漂。纯函数测试（`reset-estimate.test.ts`）测不到这一点，因为它只验证
 * `estimateReset` 本身，不经过装配层的生命周期。
 *
 * 这里直接验证「同一工厂 vs 新建工厂」的差异 —— 这正是修复前后装配层的行为差别。
 */
import { describe, expect, it } from "vitest";

import { createCommandCodeQuota } from "../../src/vendors/commandcode/quota";

/** 端点响应（真实形状：窗口在 `windowLimits`，与 `commandcode-quota.test.ts` 一致）。 */
function routes(fiveHourUsed: () => number): Record<string, () => Response> {
  const json = (payload: unknown): Response =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  return {
    "/alpha/whoami": () => json({ user: { id: "u1", name: "T" }, org: { id: "org_1" } }),
    "/alpha/usage/summary": () => json({ totalCredits: 12, totalTokensIn: 10, totalTokensOut: 2 }),
    "/alpha/billing/credits": () =>
      json({
        credits: { monthlyCredits: 55, purchasedCredits: 5, freeCredits: 1, planId: "pro" },
        windowLimits: {
          fiveHour: { used: fiveHourUsed(), cap: 10, exceeded: false },
          weekly: { used: 30, cap: 100, exceeded: false },
        },
      }),
    "/alpha/billing/subscriptions?orgId=org_1": () =>
      json({ success: true, data: { planId: "individual-goat", status: "active", currentPeriodEnd: "2026-11-14T03:23:11Z" } }),
  };
}

/**
 * 造一个额度端口。
 * @param used - 每次读数返回的 5 小时窗口已用量。
 * @param now - 可控时钟。
 * @returns 端口。
 */
function port(used: () => number, now: () => number): ReturnType<typeof createCommandCodeQuota> {
  const table = routes(used);
  const fetchImpl = (async (input: unknown) => {
    const url = new URL(String(input));
    const handler = table[`${url.pathname}${url.search}`] ?? table[url.pathname];
    if (handler === undefined) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return handler();
  }) as unknown as typeof fetch;
  return createCommandCodeQuota({
    ref: () => "acc-a",
    resolveKey: async () => "sk-live",
    fetchImpl,
    apiBase: "https://api.example.test",
    now,
  });
}

/** 取 5 小时窗口的重置时刻。 */
function fiveHourReset(snapshot: { windows: readonly { key: string; resetAt?: number }[] }): number | undefined {
  return snapshot.windows.find((window) => window.key === "fiveHour")?.resetAt;
}

describe("重置时间锚点必须跨调用存活（P1-F01）", () => {
  /**
   * **核心断言**：同一个工厂实例连续读两次、中间过 60 秒，估算的重置时间应当**不变**
   * （锚点是第一次见到 `used > 0` 的那一刻）。
   */
  it("复用工厂时，相隔 60 秒的两次读数**重置时间不漂移**", async () => {
    let current = 1_700_000_000_000;
    let used = 3;
    const shared = port(() => used, () => current);

    const first = await shared.snapshot("acc-a");
    const firstReset = fiveHourReset(first);

    current += 60_000;
    used = 5; // 用了一点，但远未到重置
    const second = await shared.snapshot("acc-a");
    const secondReset = fiveHourReset(second);

    expect(firstReset, "首次读数应有估算的重置时间").toBeDefined();
    expect(secondReset, "第二次也有").toBeDefined();
    expect(secondReset, "锚点延续 → 重置时间不该变").toBe(firstReset);
  });

  /**
   * **对照**：每次新建工厂（旧装配层的行为）→ 锚点丢失 → 重置时间往后漂。
   *
   * 这条不需要「制造 bug」，它验证的是 `resetAnchors` 确实活在工厂闭包里 ——
   * 所以装配层必须复用工厂。
   */
  it("**新建工厂会让重置时间漂移**（这就是旧装配层的 bug）", async () => {
    let current = 1_700_000_000_000;
    let used = 3;

    const first = await port(() => used, () => current).snapshot("acc-a");
    const firstReset = fiveHourReset(first);

    current += 60_000;
    used = 5;
    const second = await port(() => used, () => current).snapshot("acc-a");
    const secondReset = fiveHourReset(second);

    expect(firstReset).toBeDefined();
    expect(secondReset).toBeDefined();
    expect(
      (secondReset ?? 0) - (firstReset ?? 0),
      "新建工厂 → 锚点丢失 → 第二次把「现在」当新锚点，重置时间往后推了 60 秒",
    ).toBeGreaterThanOrEqual(60_000);
  });

  it("used 归零后锚点重新开始", async () => {
    let current = 1_700_000_000_000;
    let used = 3;
    const shared = port(() => used, () => current);

    const first = await shared.snapshot("acc-a");
    const firstReset = fiveHourReset(first);

    // 额度重置：used 回到 0。
    used = 0;
    current += 60_000;
    await shared.snapshot("acc-a");

    // 重新用起来：锚点应是「再次变正」的这一刻。
    used = 2;
    current += 10_000;
    const third = await shared.snapshot("acc-a");
    const thirdReset = fiveHourReset(third);

    expect(firstReset).toBeDefined();
    expect(thirdReset).toBeDefined();
    expect(thirdReset, "归零后锚点重新计算，重置时间应晚于最初的").toBeGreaterThan(firstReset ?? 0);
  });
});
