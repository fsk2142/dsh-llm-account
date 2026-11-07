/**
 * open-design 窗口的美元换算（2026-11-07 随官方调价更新）。
 *
 * 背景：`billing/summary` 与 `vela billing summary` **都回 403**，拿不到
 * `creditsPerUsd`。于是窗口只能退回百分比口径 —— 用户看不到「还剩多少美元」。
 * 而官方 `model-credits` 页明确公布了每个窗口的美元上限
 * （2026-11-07：Go 周 **$55** / 5 小时 **$18**；调价前是 $30 / $10），
 * 拿它除以接口给的 `limitCredits` 就能反推换算率。
 *
 * ## ⚠ 一个本机验证不了的假设
 *
 * 这份用例里的 `limitCredits` 是**按换算率 5000 同比例放大**的（50000→90000、
 * 150000→275000），假设是「官方调价时接口的 credits 配比也一起放大」。
 *
 * 反过来若网关**没有**放大（limitCredits 仍是 150000），那按官方上限反推出来的
 * 换算率会变成 2727，已用金额会被算成约 ¥19，而实际只有 $10.35 —— 差一倍。
 *
 * 本机无法验证哪种情况：`vela billing preflight` 在这台机器上回
 * 403 `workspace_forbidden`，没有真实的 `limitCredits` 样本。所以这里只能固定
 * **「上限取官方表 + 已用按同一比率折算」这个机制**，并把假设写在这里。
 * 如果真机上「周额度显示已用 $19」而用户知道实际是 $10，就是假设 A 不成立。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/** Go 套餐的 preflight 形状（`limitCredits` 按换算率 5000 与新版官方上限对齐）。 */
const REAL_GO = {
  codingPlan: {
    eligible: true,
    tier: "go",
    windows: [
      { durationSeconds: 18_000, usedCredits: "6860", limitCredits: "90000" },
      { durationSeconds: 604_800, usedCredits: "51768", limitCredits: "275000" },
    ],
  },
};

describe("open-design 窗口的美元换算", () => {
  it("**周窗口显示 $55**（2026-11-07 调价后 Go 的官方上限）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly).toBeDefined();
    // 275000 credits / 5000 = $55（官方 model-credits 页明写 Go 周窗口 $55）。
    expect(weekly?.cap).toBe(55);
    expect(weekly?.unit).toBe("usd");
  });

  it("5 小时窗口是 $18（Go 套餐）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    expect(fiveHour?.cap).toBe(18);
  });

  it("已用金额也按同一换算率算（51768 / 5000 ≈ $10.35）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.used).toBeCloseTo(10.35, 1);
  });

  it("**摘要给的 creditsPerUsd 不再决定上限**（官方口径优先）", () => {
    // 需求 明确要求「按照官方的实际口径来而不是靠推算」。
    // 接口实测给的 creditsPerUsd 是 10000，按它算周窗口只有 $27.5，而官方是 $55。
    // 所以上限一律采信官方表；creditsPerUsd 只在算「已用」时当备用比率。
    const snap = toQuotaSnapshot({
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: REAL_GO,
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(55);
  });

  it("**已用金额仍按「官方上限 ÷ limitCredits」折**（与上限自洽）", () => {
    // 51768 credits、官方周上限 $55、limitCredits 275000 → 比率 5000 → 已用 $10.35。
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

  it("Plus 套餐的周窗口按官方 $74 折算（2026-11-07 调价：$40→$74）", () => {
    const preflight = {
      codingPlan: {
        eligible: true,
        tier: "plus",
        windows: [{ durationSeconds: 604_800, usedCredits: "10000", limitCredits: "370000" }],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(74);
  });
});

describe("真实数据回归（Go 套餐，上限一律取官方表）", () => {
  it("**摘要返回 creditsPerUsd=10000 时，上限仍按官方 $18 / $55**", () => {
    const real = {
      codingPlan: {
        eligible: true,
        tier: "go",
        windows: [
          { durationSeconds: 18_000, usedCredits: "8290", limitCredits: "90000" },
          { durationSeconds: 604_800, usedCredits: "53198", limitCredits: "275000" },
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

    // 上限走官方表。
    expect(fiveHour?.cap).toBe(18);
    expect(weekly?.cap).toBe(55);
    // 已用按「官方上限 ÷ limitCredits」折：8290/5000 ≈ $1.66、53198/5000 ≈ $10.64。
    expect(fiveHour?.used).toBeCloseTo(1.66, 1);
    expect(weekly?.used).toBeCloseTo(10.64, 1);
  });
});
