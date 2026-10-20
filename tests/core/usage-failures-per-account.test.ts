/**
 * 失败明细必须归到**具体账号**，不能挂到同厂商的所有账号下（2026-10-20 审计发现的真 bug）。
 *
 * 错在哪：`failuresOf(vendor)` 只按**厂商**过滤，而 `usageOf` 是**每个账号调一次**。
 * 于是同一厂商有两个账号时：
 * 1. 两个账号下面都显示同一份明细（重复）；
 * 2. 更糟的是，失败本来属于 A，却显示在 A 和 B 两处 —— 用户会以为 B 也在失败。
 *
 * 正确口径：失败明细是**每账号**的，按 `account` 分组。台账里每条失败都带 `account`，
 * `failureBreakdownOf` 接收记录时能算出来，只是报表层把它按窗口聚合成了一份全局的。
 */
import { describe, expect, it } from "vitest";

import { failureBreakdownOf, failureBreakdownPerAccount } from "../../src/core/usage-failures";
import type { UsageRecord } from "../../src/core/usage-stats";

/** 造一条记录。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    vendor: "opendesign",
    account: "acc-1",
    at: 1_000,
    outcome: "success",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "deepseek-v4.1-flash",
    ...overrides,
  };
}

describe("失败明细按账号分组", () => {
  it("两个账号各自的失败分开统计（不再混成一份）", () => {
    const records = [
      record({ account: "a", outcome: "failure", failureKind: "network" }),
      record({ account: "a", outcome: "failure", failureKind: "network" }),
      record({ account: "b", outcome: "failure", failureKind: "quota" }),
    ];
    const perAccount = failureBreakdownPerAccount(records);

    // 键是 `vendor\u0000account`（见 usage-failures-vendor.test.ts：只按 account 会串味）。
    expect(perAccount.get("opendesign\u0000a")).toEqual([
      { kind: "network", count: 2, lastAt: 1_000, lastAccount: "a" },
    ]);
    expect(perAccount.get("opendesign\u0000b")).toEqual([{ kind: "quota", count: 1, lastAt: 1_000, lastAccount: "b" }]);
  });

  it("某账号一条失败都没有 → 该账号不在结果里（界面据此不渲染那一块）", () => {
    const records = [
      record({ account: "a", outcome: "failure", failureKind: "network" }),
      record({ account: "b", outcome: "success" }),
    ];
    const perAccount = failureBreakdownPerAccount(records);
    expect(perAccount.has("opendesign\u0000a")).toBe(true);
    expect(perAccount.has("opendesign\u0000b")).toBe(false);
  });

  it("同一账号两类失败，按次数降序（与全局聚合同一套排序）", () => {
    const records = [
      record({ account: "a", outcome: "failure", failureKind: "quota" }),
      record({ account: "a", outcome: "failure", failureKind: "network" }),
      record({ account: "a", outcome: "failure", failureKind: "network" }),
    ];
    expect(failureBreakdownPerAccount(records).get("opendesign\u0000a")?.map((row) => row.kind)).toEqual(["network", "quota"]);
  });

  it("空记录 → 空 Map（不返回 undefined）", () => {
    expect(failureBreakdownPerAccount([]).size).toBe(0);
  });

  it("全局聚合仍然可用（两者是同一事实的两种切法，不是替代）", () => {
    const records = [
      record({ account: "a", outcome: "failure", failureKind: "network" }),
      record({ account: "b", outcome: "failure", failureKind: "network" }),
    ];
    // 全局：network × 2；分账号：各 1。
    expect(failureBreakdownOf(records)).toEqual([{ kind: "network", count: 2, lastAt: 1_000, lastAccount: "b" }]);
    expect(failureBreakdownPerAccount(records).get("opendesign\u0000a")?.[0]?.count).toBe(1);
    expect(failureBreakdownPerAccount(records).get("opendesign\u0000b")?.[0]?.count).toBe(1);
  });
});
