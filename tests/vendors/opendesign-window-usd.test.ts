/**
 * open-design 窗口的美元换算（2026-10-21 修正）。
 *
 * 背景：`billing/summary` 与 `vela billing summary` **都回 403**，拿不到
 * `creditsPerUsd`。于是窗口只能退回百分比口径 —— 用户看不到「还剩多少美元」。
 * 而官方 zh/model-credits 页明确公布了每个窗口的美元上限（Go: 周 $30 / 5 小时 $10），
 * 拿它除以接口给的 `limitCredits` 就能反推换算率。
 *
 * 这一条修的是一个**真实的显示错误**：用户实际是 Go 套餐（周窗口 $30），
 * 界面却显示「共 $15.00」——因为没有任何换算率可读，早期文档记的 10000 就成了事实标准。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/** 真实的 preflight 响应（2026-10-21 实抓，Go 套餐）。 */
const REAL_GO = {
  codingPlan: {
    eligible: true,
    tier: "go",
    windows: [
      { durationSeconds: 18_000, usedCredits: "6860", limitCredits: "50000" },
      { durationSeconds: 604_800, usedCredits: "51768", limitCredits: "150000" },
    ],
  },
};

describe("open-design 窗口的美元换算", () => {
  it("**周窗口显示 $30 而不是 $15**（Go 套餐的官方上限）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly).toBeDefined();
    // 150000 credits / 5000 = $30（官方 zh/model-credits 页明写 Go 周窗口 $30）。
    expect(weekly?.cap).toBe(30);
    expect(weekly?.unit).toBe("usd");
  });

  it("5 小时窗口是 $10（Go 套餐）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    expect(fiveHour?.cap).toBe(10);
  });

  it("已用金额也按同一换算率算（51768 / 5000 ≈ $10.35）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.used).toBeCloseTo(10.35, 1);
  });

  it("**摘要给的 creditsPerUsd 不再决定上限**（官方口径优先）", () => {
    // 用户 2026-10-21 明确要求「按照官方的实际口径来而不是靠推算」。
    // 接口实测给的 creditsPerUsd 是 10000，按它算周窗口只有 $15，而官方是 $30。
    // 所以上限一律采信官方表；creditsPerUsd 只在算「已用」时当备用比率。
    const snap = toQuotaSnapshot({
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: REAL_GO,
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(30);
  });

  it("**已用金额仍按「官方上限 ÷ limitCredits」折**（与上限自洽）", () => {
    // 51768 credits、官方周上限 $30、limitCredits 150000 → 比率 5000 → 已用 $10.35。
    // 即使 summary 给了 10000 也不影响，因为比率优先来自官方上限。
    const snap = toQuotaSnapshot({
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: REAL_GO,
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.used).toBeCloseTo(10.35, 1);
  });

  it("套餐认不出时不反推换算率（退回百分比口径，不猜）", () => {
    const preflight = { codingPlan: { eligible: true, windows: REAL_GO.codingPlan.windows } };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBeUndefined();
    expect(weekly?.percent).toBeDefined();
  });

  it("Plus 套餐的周窗口按官方 $40 折算（150000 → 但 Plus 的 limitCredits 不同）", () => {
    // Plus: 周窗口官方 $40。若 limitCredits 是 200000，换算率 5000，cap = $40。
    const preflight = {
      codingPlan: {
        eligible: true,
        tier: "plus",
        windows: [{ durationSeconds: 604_800, usedCredits: "10000", limitCredits: "200000" }],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(40);
  });
});

describe("2026-10-21 真实数据回归（Go 套餐）", () => {
  it("**摘要返回 creditsPerUsd=10000 时，周窗口仍显示 $30**", () => {
    // 这是用户实际遇到的场景：界面上限显示 $15，实际应该是 $30。
    // 真实 preflight：周窗口 limitCredits=150000、usedCredits=53198。
    const real = {
      codingPlan: {
        eligible: true,
        tier: "go",
        windows: [
          { durationSeconds: 18_000, usedCredits: "8290", limitCredits: "50000" },
          { durationSeconds: 604_800, usedCredits: "53198", limitCredits: "150000" },
        ],
      },
    };
    const snap = toQuotaSnapshot({
      // 关键：摘要**成功返回**且给了 10000（这不是 403 场景）。
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: real,
      failures: [],
    });

    const fiveHour = snap.windows.find((w) => w.key === "fiveHour");
    const weekly = snap.windows.find((w) => w.key === "weekly");

    // 上限走官方表：$10 / $30。
    expect(fiveHour?.cap).toBe(10);
    expect(weekly?.cap).toBe(30);
    // 已用按「官方上限 ÷ limitCredits」折：8290/5000 ≈ $1.66、53198/5000 ≈ $10.64。
    expect(fiveHour?.used).toBeCloseTo(1.66, 1);
    expect(weekly?.used).toBeCloseTo(10.64, 1);
  });
});
