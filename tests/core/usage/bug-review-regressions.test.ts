/**
 * Bug 审查报告（2026-10-22）里两个已修项的回归测试。
 *
 * 报告基于 v0.6.0 的快照，但两个问题在当前版本**仍然存在**：
 *
 * - **MEDIUM-1**：额度读取超时后底层调用仍在飞，重试会让在途请求叠加；
 * - **LOW-2**：CSV 导出未防公式注入（报告自评「利用条件基本不成立」）。
 */
import { describe, expect, it, vi } from "vitest";

import { quotaWithTimeout } from "../../../src/vendors/usage-remote";
import { ledgerCsvOf } from "../../../src/core/usage/export";
import type { UsageRecord } from "../../../src/core/usage/stats";

/** 一条最小可导出的记录。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: 1_700_000_000_000,
    vendor: "opendesign",
    account: "ACC_1",
    model: "deepseek-v4.1-flash",
    kind: "success",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  } as UsageRecord;
}

/** 取 CSV 的第一条数据行（跳过表头）。 */
function firstRow(csv: string): string {
  return csv.split(/\r?\n/)[1] ?? "";
}

describe("CSV 公式注入防护（LOW-2）", () => {
  it("**以 = 开头的字段被引号包裹**（Excel 不再当公式求值）", () => {
    const csv = ledgerCsvOf([record({ model: '=HYPERLINK("http://evil","x")' })]);
    expect(firstRow(csv)).toContain('"=HYPERLINK');
  });

  it("以 + / - / @ 开头的字段同样被包裹", () => {
    for (const prefix of ["+", "-", "@"]) {
      const csv = ledgerCsvOf([record({ model: `${prefix}cmd` })]);
      expect(firstRow(csv), `${prefix} 开头应当被包裹`).toContain(`"${prefix}cmd"`);
    }
  });

  it("普通字段**不加多余引号**（导出文件保持干净）", () => {
    const csv = ledgerCsvOf([record({ model: "deepseek-v4.1-flash" })]);
    expect(firstRow(csv)).toContain("deepseek-v4.1-flash");
    expect(firstRow(csv), "不该给普通字段加引号").not.toContain('"deepseek');
  });

  it("含逗号的字段仍然被包裹（既有行为不变）", () => {
    expect(firstRow(ledgerCsvOf([record({ model: "a,b" })]))).toContain('"a,b"');
  });
});

describe("额度读取超时不重试（MEDIUM-1）", () => {
  it("**超时只发一次请求**，并在超时后把错误抛给调用方", async () => {
    /**
     * 用真实的 `quotaWithTimeout`。旧实现在超时后重试，导致失败路径上两个 snapshot
     * 同时在飞（`QuotaPort.snapshot` 不接受 AbortSignal，无法真正取消）。
     *
     * 端口永远不 resolve，所以必然走超时分支 —— 这正是要覆盖的失败路径。
     */
    const snapshot = vi.fn(() => new Promise<never>(() => undefined));
    const quota = { snapshot } as never;

    // 超时常量是 30s，测试不能真等；用 vi.useFakeTimers 推进。
    vi.useFakeTimers();
    try {
      const pending = quotaWithTimeout(quota, "ACC_1");
      pending.catch(() => undefined); // 先挂上，避免 unhandled rejection
      await vi.advanceTimersByTimeAsync(30_001);
      await expect(pending).rejects.toThrow(/timeout/u);
      expect(snapshot, "**只调用一次**（不重试，避免在途请求叠加）").toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("端口自己失败时原样抛出（不吞掉、不重试）", async () => {
    const snapshot = vi.fn(async () => {
      throw new Error("MISSING_CREDENTIAL");
    });
    const quota = { snapshot } as never;
    await expect(quotaWithTimeout(quota, "ACC_1")).rejects.toThrow(/MISSING_CREDENTIAL/u);
    expect(snapshot, "确定性失败不重试").toHaveBeenCalledTimes(1);
  });

  it("成功时返回端口读数", async () => {
    const snapshot = vi.fn(async () => ({ windows: [], failures: [] }));
    const quota = { snapshot } as never;
    await expect(quotaWithTimeout(quota, "ACC_1")).resolves.toMatchObject({ windows: [] });
  });
});
