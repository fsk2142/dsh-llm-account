/**
 * 失败明细必须按 **(vendor, account)** 归属，不能只按 account（2026-10-20 审计 #6）。
 *
 * 错在哪：`failureBreakdownPerAccount` 只以 `account`（即凭据引用名）作键，客户端也只用 `ref`
 * 查。默认的 ref 各家不同，但 `apiKeyEnv` 允许用户写任意引用名 —— 两家都填 `DSH_WORK_KEY`
 * 时，A 家的失败明细会显示在 B 家的账号下面。
 *
 * 第二条：`account: ""`（选账号之前就失败的请求）在边界被丢掉，但仍计入全局的
 * `failuresByKind` —— 于是全局说「失败 3 次」而分账号加起来只有 2 次，对不上。
 */
import { describe, expect, it } from "vitest";

import { failureBreakdownPerAccount } from "../../src/core/usage-failures";
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

describe("跨厂商同名 ref 不能互相串味", () => {
  it("两家都用同一个 ref 时，各自的失败分开统计", () => {
    const records = [
      record({ vendor: "commandcode", account: "DSH_WORK_KEY", outcome: "failure", failureKind: "network" }),
      record({ vendor: "opendesign", account: "DSH_WORK_KEY", outcome: "failure", failureKind: "quota" }),
    ];
    // 键是 `vendor\u0000account`：两家各一条。
    const perAccount = failureBreakdownPerAccount(records);
    expect(perAccount.get("commandcode\u0000DSH_WORK_KEY")).toEqual([
      { kind: "network", count: 1, lastAt: 1_000, lastAccount: "DSH_WORK_KEY" },
    ]);
    expect(perAccount.get("opendesign\u0000DSH_WORK_KEY")).toEqual([
      { kind: "quota", count: 1, lastAt: 1_000, lastAccount: "DSH_WORK_KEY" },
    ]);
    // 只按 account 的键**不应该存在**（那正是串味的来源）。
    expect(perAccount.has("DSH_WORK_KEY")).toBe(false);
  });

  it("同一家同一账号的多条失败仍然合并（回归保护）", () => {
    const records = [
      record({ vendor: "opendesign", account: "a", outcome: "failure", failureKind: "network" }),
      record({ vendor: "opendesign", account: "a", outcome: "failure", failureKind: "network" }),
    ];
    const perAccount = failureBreakdownPerAccount(records);
    expect(perAccount.get("opendesign\u0000a")?.[0]?.count).toBe(2);
  });
});

describe("匿名失败（选账号之前就失败）也要有一席之地", () => {
  it("account 为空串时仍然产出一行，而不是被丢掉", () => {
    const records = [record({ vendor: "opendesign", account: "", outcome: "failure", failureKind: "network" })];
    const perAccount = failureBreakdownPerAccount(records);
    // 键仍然是 `vendor\u0000`（account 段为空）：这条失败属于「该厂商但还没选中账号」。
    expect(perAccount.size).toBe(1);
    expect(perAccount.get("opendesign\u0000")?.[0]?.kind).toBe("network");
  });
});
