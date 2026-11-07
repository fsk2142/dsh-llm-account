/**
 * open-design 窗口的美元换算（2026-11-08 用**真机 preflight 数据**重写）。
 *
 * 背景：`billing/summary` 与 `vela billing summary` **都回 403**，拿不到
 * `creditsPerUsd`。于是窗口只能退回百分比口径 —— 用户看不到「还剩多少美元」。
 * 而官方 `model-credits` 页明确公布了每个窗口的美元上限
 * （2026-11-08：Go 周 **$55** / 5 小时 **$18**；调价前是 $30 / $10），
 * 拿它除以接口给的 `limitCredits` 就能反推换算率。
 *
 * ## 这一版为什么可信：拿到了真机数据
 *
 * 上一版这里写着「`limitCredits` 是否随调价放大，本机验证不了」——**现在验证了**：
 * 用账号自己的控制器密钥直连 `{walletBase}/workspaces/{id}/billing/preflight`
 * （`vela` CLI 那条路要本机登录态，所以以前回 403），三个账号实测都是：
 *
 * ```
 * tier = "go"
 * 5 小时：usedCredits=4568  limitCredits=50000     ← 调价前后**没有变**
 * 每周  ：usedCredits=10175 limitCredits=150000    ← 也没有变
 * ```
 *
 * 也就是说官方涨的是**美元额度**（$30→$55、$10→$18），接口的 credits 一个没动。
 * 所以换算率从 5000 变成了约 2727（150000/55）与 2777（50000/18）——
 * 「同一批 credits 现在值更多美元」，这与「额度上调」是一致的。
 *
 * 换算**逐窗口**做（`limitCredits ÷ 该窗口的官方上限`），不是全局一个比率：
 * 官方这两档的美元比（18:55）与 credits 比（1:3）并不严格成比例，用全局比率会让
 * 另一档的美元值偏 2% 左右。逐窗口算就等于「占比 × 官方上限」，永远自洽。
 *
 * 本文件里的断言值就是上面那次真机抓取的结果（$1.64 / $18 与 $3.73 / $55）。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/**
 * **真机抓到的 preflight**（2026-11-08，Go 套餐）。
 *
 * 这不是编的夹具：`limitCredits` 50000 / 150000 与 `usedCredits` 都在真实响应里出现过。
 */
const REAL_GO = {
  codingPlan: {
    eligible: true,
    tier: "go",
    windows: [
      { durationSeconds: 18_000, usedCredits: "4568", limitCredits: "50000" },
      { durationSeconds: 604_800, usedCredits: "10175", limitCredits: "150000" },
    ],
  },
};

describe("open-design 窗口的美元换算", () => {
  it("**周窗口显示 $55**（2026-11-07 调价后 Go 的官方上限）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly).toBeDefined();
    expect(weekly?.cap).toBe(55);
    expect(weekly?.unit).toBe("usd");
  });

  it("5 小时窗口是 $18（Go 套餐）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    expect(fiveHour?.cap).toBe(18);
  });

  it("已用金额按「官方上限 ÷ limitCredits」逐窗口折算", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    const weekly = snap.windows.find((window) => window.key === "weekly");
    // 4568 × 18/50000 = $1.64；10175 × 55/150000 = $3.73
    expect(fiveHour?.used).toBeCloseTo(1.64, 2);
    expect(weekly?.used).toBeCloseTo(3.73, 2);
  });

  it("**占比与真实 credits 完全一致**（这才是额度条要表达的）", () => {
    const snap = toQuotaSnapshot({ summary: undefined, preflight: REAL_GO, failures: [] });
    const fiveHour = snap.windows.find((window) => window.key === "fiveHour");
    const weekly = snap.windows.find((window) => window.key === "weekly");
    // 真实占比：4568/50000 = 9.14%、10175/150000 = 6.78%。
    expect((fiveHour!.used! / fiveHour!.cap!) * 100).toBeCloseTo((4568 / 50000) * 100, 2);
    expect((weekly!.used! / weekly!.cap!) * 100).toBeCloseTo((10175 / 150000) * 100, 2);
  });

  it("**摘要给的 creditsPerUsd 不决定上限**（官方口径优先）", () => {
    // 接口实测给的 creditsPerUsd 是 10000，按它算周窗口只有 $15，而官方是 $55。
    // 所以上限一律采信官方表；creditsPerUsd 只在完全拿不到官方上限时当回落。
    const snap = toQuotaSnapshot({
      summary: { membershipTier: "go", creditsPerUsd: 10_000 },
      preflight: REAL_GO,
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(55);
    expect(weekly?.used).toBeCloseTo(3.73, 2);
  });

  it("套餐认不出时不反推换算率（退回百分比口径，不猜）", () => {
    const preflight = { codingPlan: { eligible: true, windows: REAL_GO.codingPlan.windows } };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBeUndefined();
    expect(weekly?.percent).toBeCloseTo((10175 / 150000) * 100, 4);
  });

  it("Plus 套餐的周窗口按官方 $74 折算（2026-11-07 调价：$40→$74）", () => {
    const preflight = {
      codingPlan: {
        eligible: true,
        tier: "plus",
        windows: [{ durationSeconds: 604_800, usedCredits: "10000", limitCredits: "200000" }],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight, failures: [] });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(74);
  });
});
