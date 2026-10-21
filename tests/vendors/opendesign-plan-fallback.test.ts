/**
 * open-design 的套餐档位从 **preflight** 兜底（2026-10-21 实测发现）。
 *
 * 用户报障「opendesign 部分显示不全」，根因是套餐名一直从 `billing/summary` 读，
 * 而那个端点（以及 `vela billing summary` 回退）**都回 403**。
 *
 * 同一个账号的 `billing preflight` 却稳定给出 `codingPlan.tier`，而且这份数据本来
 * 每次都在读（额度窗口就来自它）—— 等于白拿一个可靠的套餐来源。
 */
import { describe, expect, it } from "vitest";

import { toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

describe("open-design 套餐来源", () => {
  it("**summary 缺失（403）时从 preflight 取档位**", () => {
    const snapshot = toQuotaSnapshot({
      summary: undefined,
      preflight: { codingPlan: { eligible: true, tier: "go", windows: [] } },
      failures: [],
    });
    expect(snapshot.plan?.id).toBe("go");
    expect(snapshot.plan?.name).toBe("go");
  });

  it("**summary 有数据时优先用它**（它还有状态与账期）", () => {
    const snapshot = toQuotaSnapshot({
      summary: { membershipTier: "pro", subscriptionStatus: "active", subscriptionCurrentPeriodEnd: "2026-11-14T00:00:00Z" },
      preflight: { codingPlan: { eligible: true, tier: "go", windows: [] } },
      failures: [],
    });
    expect(snapshot.plan?.id).toBe("pro");
    expect(snapshot.plan?.status).toBe("active");
    expect(snapshot.plan?.periodEnd).toBeDefined();
  });

  it("**eligible: false 时不信 tier**（该工作区没有周期套餐）", () => {
    const snapshot = toQuotaSnapshot({
      summary: undefined,
      preflight: { codingPlan: { eligible: false, tier: "go", windows: [] } },
      failures: [],
    });
    expect(snapshot.plan).toBeUndefined();
  });

  it("preflight 没有 codingPlan 时不给套餐（不编）", () => {
    const snapshot = toQuotaSnapshot({ summary: undefined, preflight: {}, failures: [] });
    expect(snapshot.plan).toBeUndefined();
  });

  it("preflight 的 tier 也能带出月度上限（Go 档 = $120）", () => {
    // 月度上限表按 tier 查；套餐名通了，补出来的月度窗口才跟着通。
    const snapshot = toQuotaSnapshot({
      summary: undefined,
      preflight: {
        codingPlan: {
          eligible: true,
          tier: "go",
          windows: [{ durationSeconds: 18_000, usedCredits: "9281", limitCredits: "50000" }],
        },
      },
      failures: [],
    });
    const monthly = snapshot.windows.find((window) => window.key === "monthly");
    expect(monthly).toBeDefined();
    expect(monthly?.cap).toBe(120);
  });
});
