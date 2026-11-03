import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opencode/quota";

/**
 * 订阅周期回归（2026-11-03 报障）。
 *
 * ## 现象
 *
 * 用量面板把 opencode 统计成「最近 5 小时」的量（111.6M），而同样一块面板里
 * Open Design 与 Command Code 统计的是**整个订阅周期**（本账单月）的量。
 * 用户一眼看出三家不一致：「opendesign和command那个不就是统计的整个订阅周期内的用量吗？」
 *
 * ## 根因
 *
 * `usage-remote.ts` 选周期的顺序是：
 *
 * 1. 厂商真的公布了 `quota.plan.periodEnd` / `periodStart` → 用厂商给的账期边界；
 * 2. 否则退回「最细的一档窗口」（`rankOfWindow`：5 小时 = 0）。
 *
 * Open Design 的 `subscriptionCurrentPeriodEnd` 与 Command Code 的订阅字段都会
 * 落成 `plan.periodEnd`，所以它们走第 1 条；**opencode 的 `/usage` 只回
 * `rolling` / `weekly` / `monthly` 三个百分比窗口，从来不公布账期**，于是掉到第 2 条，
 * 被算成 5 小时窗口。
 *
 * ## 修法
 *
 * opencode 的 `monthly` 窗口**就是**订阅周期（`resetsAt` 即本期结束时刻），
 * 所以在 `toQuotaSnapshot` 里把它落成 `plan`：与另外两家的口径对齐。
 */
describe("opencode 额度：订阅周期", () => {
  const PAYLOAD = {
    usage: {
      rolling: { status: "ok", percent: 4, resetsAt: "2026-11-03T11:00:21.000Z" },
      weekly: { status: "ok", percent: 6, resetsAt: "2026-11-09T00:00:00.000Z" },
      monthly: { status: "ok", percent: 3, resetsAt: "2026-12-02T14:26:00.000Z" },
    },
  };

  it("**把 monthly 窗口的重置时刻落成 plan.periodEnd**（整个订阅周期）", () => {
    const snapshot = toQuotaSnapshot(PAYLOAD);
    expect(snapshot.plan, "必须上报套餐账期，否则用量面板会退回 5 小时窗口").toBeDefined();
    expect(snapshot.plan?.periodEnd).toBe(Date.parse("2026-12-02T14:26:00.000Z"));
  });

  it("periodEnd 取的是 **monthly**，不是 rolling/weekly", () => {
    const planEnd = toQuotaSnapshot(PAYLOAD).plan?.periodEnd;
    expect(planEnd, "不能是 rolling 的 5 小时后").not.toBe(Date.parse("2026-11-03T11:00:21.000Z"));
    expect(planEnd, "不能是 weekly 的重置").not.toBe(Date.parse("2026-11-09T00:00:00.000Z"));
  });

  it("periodStart 由 periodEnd 往前推一个日历月（厂商不公布起点）", () => {
    const plan = toQuotaSnapshot(PAYLOAD).plan;
    expect(plan?.periodStart).toBeDefined();
    const start = plan?.periodStart ?? 0;
    const end = plan?.periodEnd ?? 0;
    expect(start, "起点必须早于终点").toBeLessThan(end);
    const days = (end - start) / 86_400_000;
    expect(days, "一个月约 30-31 天").toBeGreaterThan(28);
    expect(days).toBeLessThan(32);
  });

  it("没有 monthly 窗口时**不造** plan（宁可退回窗口，也不编账期）", () => {
    const snapshot = toQuotaSnapshot({
      usage: {
        rolling: { status: "ok", percent: 4, resetsAt: "2026-11-03T11:00:21.000Z" },
      },
    });
    expect(snapshot.plan, "缺 monthly 时不能凭空造订阅周期").toBeUndefined();
  });

  it("monthly 窗口缺 resetsAt 时也不造 plan", () => {
    const snapshot = toQuotaSnapshot({
      usage: { monthly: { status: "ok", percent: 3 } },
    });
    expect(snapshot.plan).toBeUndefined();
  });

  it("windows 仍然照常产出（不因为加了 plan 而少窗口）", () => {
    const snapshot = toQuotaSnapshot(PAYLOAD);
    expect(snapshot.windows.map((window) => window.key)).toEqual(["rolling", "weekly", "monthly"]);
  });
});
