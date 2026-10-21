/**
 * 排查同类 bug：换算率在**所有档位**下是否都对得上官方表。
 *
 * 上一次只验证了 Go 套餐（150000 / 5000 = $30）。这份诊断把四个档位、
 * 每种窗口时长都过一遍，确认「官方上限 ÷ limitCredits」得到的换算率在各档一致。
 *
 * 如果某档算出来的换算率明显偏离 5000，说明 `WINDOW_CAP_USD` 表有错，或官方
 * 给各档的 credits 配比不是线性的 —— 两种都值得知道。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/** 用给定 limitCredits 造一个 preflight。 */
function preflightOf(tier: string, windows: { duration: number; limit: number; used: number }[]) {
  return {
    codingPlan: {
      eligible: true,
      tier,
      windows: windows.map((w) => ({
        durationSeconds: w.duration,
        usedCredits: String(w.used),
        limitCredits: String(w.limit),
      })),
    },
  };
}

/** 取某个窗口的 cap。 */
function capOf(tier: string, windows: { duration: number; limit: number; used: number }[], key: string) {
  const snap = toQuotaSnapshot({ summary: undefined, preflight: preflightOf(tier, windows), failures: [] });
  return snap.windows.find((window) => window.key === key)?.cap;
}

describe("换算率一致性排查", () => {
  it("**Go**：周 150000→$30、5小时 50000→$10（换算率 5000）", () => {
    const windows = [
      { duration: 18_000, limit: 50_000, used: 0 },
      { duration: 604_800, limit: 150_000, used: 0 },
    ];
    expect(capOf("go", windows, "fiveHour")).toBe(10);
    expect(capOf("go", windows, "weekly")).toBe(30);
  });

  it("**Plus**：周窗口按官方 $40 折算", () => {
    // 单窗口反推时，cap 必然等于官方上限（换算率就是由它算出来的）——
    // 这条测的是「反推逻辑对每个档位都跑得通」，不是校验 credits 配比。
    const cap = capOf("plus", [{ duration: 604_800, limit: 200_000, used: 0 }], "weekly");
    expect(cap).toBe(40);
  });

  it("**多个窗口时只用一个反推，其余自动对齐**", () => {
    // 这才是真正有价值的检查：同一份 preflight 里两个窗口的 credits 若成比例，
    // 用任意一个反推得到的换算率会让另一个也算对。
    const windows = [
      { duration: 18_000, limit: 50_000, used: 25_000 },
      { duration: 604_800, limit: 150_000, used: 75_000 },
    ];
    const snap = toQuotaSnapshot({ summary: undefined, preflight: preflightOf("go", windows), failures: [] });
    const fiveHour = snap.windows.find((w) => w.key === "fiveHour");
    const weekly = snap.windows.find((w) => w.key === "weekly");
    // 50000/5000 = $10（官方 5 小时上限），150000/5000 = $30（官方周上限）。
    expect(fiveHour?.cap).toBe(10);
    expect(weekly?.cap).toBe(30);
    expect(fiveHour?.used).toBe(5);
    expect(weekly?.used).toBe(15);
  });

  it("**Pro**：周窗口按官方 $90 折算", () => {
    const cap = capOf("pro", [{ duration: 604_800, limit: 450_000, used: 0 }], "weekly");
    expect(cap).toBe(90);
  });

  it("**Max**：周窗口按官方 $150 折算", () => {
    const cap = capOf("max", [{ duration: 604_800, limit: 750_000, used: 0 }], "weekly");
    expect(cap).toBe(150);
  });

  it("月度窗口（30 天）也用同一换算率", () => {
    const windows = [{ duration: 2_592_000, limit: 600_000, used: 0 }];
    const cap = capOf("go", windows, "monthly");
    // Go 月度官方 $120。600000 / (150000/30) = 600000/5000 = 120。
    expect(cap).toBe(120);
  });

  it("**窗口时长认不出时不反推**（比如 15 分钟的自定义窗口）", () => {
    const cap = capOf("go", [{ duration: 900, limit: 10_000, used: 0 }], "900");
    expect(cap).toBeUndefined();
  });

  it("**limitCredits 为 0 时上限仍是官方值**（上限不依赖接口数字）", () => {
    // 官方口径上线后：上限来自 WINDOW_CAP_USD，与 limitCredits 是否可用无关。
    // limitCredits 只影响「已用金额」能不能算（除零时不算，不编 0）。
    const snap = toQuotaSnapshot({
      summary: undefined,
      preflight: preflightOf("go", [{ duration: 604_800, limit: 0, used: 0 }]),
      failures: [],
    });
    const weekly = snap.windows.find((window) => window.key === "weekly");
    expect(weekly?.cap).toBe(30);
    expect(weekly?.used).toBeUndefined();
  });
});

describe("异常窗口处理", () => {
  it("**Plus 收到不该有的 5 小时窗口时，跳过它用周窗口反推**", () => {
    // 官方说 Plus/Pro/Max「不设 5 小时窗口」。若某天真的收到一个，
    // WINDOW_CAP_USD 里没有它的美元上限 → 反推时跳过，用周窗口算。
    const p = {
      codingPlan: {
        eligible: true,
        tier: "plus",
        windows: [
          { durationSeconds: 18_000, usedCredits: "100", limitCredits: "50000" },
          { durationSeconds: 604_800, usedCredits: "1000", limitCredits: "200000" },
        ],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight: p, failures: [] });
    const weekly = snap.windows.find((w) => w.key === "weekly");
    // 用周窗口反推：200000 / 40 = 5000，所以 5 小时窗口也按 5000 折算 = $10。
    expect(weekly?.cap).toBe(40);
    const fiveHour = snap.windows.find((w) => w.key === "fiveHour");
    expect(fiveHour?.cap).toBe(10);
  });

  it("**没有 limitCredits 时上限仍显示官方值，已用留空**", () => {
    // 官方口径：上限来自文档表，不依赖接口。已用没有换算依据时留空（不编 0）。
    const p = {
      codingPlan: {
        eligible: true,
        tier: "go",
        windows: [{ durationSeconds: 604_800, usedCredits: "1000" }],
      },
    };
    const snap = toQuotaSnapshot({ summary: undefined, preflight: p, failures: [] });
    const weekly = snap.windows.find((w) => w.key === "weekly");
    expect(weekly?.cap).toBe(30);
    expect(weekly?.used).toBeUndefined();
  });
});
