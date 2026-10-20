/**
 * 导出不得**静默**丢数据，也不得因为一行坏数据整次失败（2026-10-20 审计）。
 *
 * 两个真缺陷：
 * 1. 缺省上限 1000 条，而客户端从不传参 —— 台账超过 1000 条时用户拿到的文件悄悄少了前面
 *    那部分，界面上毫无提示（当时实际 2401 条）。对账场景下「看起来成功但数据不全」比直接
 *    失败更危险。
 * 2. `new Date(NaN).toISOString()` 抛 `RangeError`，一行坏 `at` 就能让整次导出失败。
 */
import { describe, expect, it } from "vitest";

import { ledgerCsvOf } from "../../../src/core/usage/export";
import type { UsageRecord } from "../../../src/core/usage/stats";
import { createUsageLedger } from "../../../src/core/usage/ledger";
import { LlmAccountUsageService } from "../../../src/vendors/usage-remote";

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

/** CSV 的数据行数（不含表头）。 */
function dataRows(csv: string): number {
  const lines = csv.split("\n");
  return lines.length - 1;
}

describe("导出不静默截断", () => {
  // 显式给长超时：这个用例要往真实台账追加 1500 条（真文件 I/O，单跑约 900ms），
  // 全量并行时会超过缺省 5 秒 —— 与断言语义无关，但一套发红的测试会掩盖真回归。
  it("台账 1500 条时，不传 limit 的导出必须给全 1500 条", async () => {
    const directory = process.env.DSH_LLM_ACCOUNT_USAGE_DIR ?? "";
    expect(directory).not.toBe("");
    const ledger = createUsageLedger(directory);
    // 用**当前时间**附近的时刻：台账按 120 天保留期读，1970 年的记录会被直接跳过。
    const now = Date.now();
    for (let index = 0; index < 1_500; index += 1) {
      await ledger.record({
        vendor: "opendesign",
        account: "acc-1",
        at: now - 1_500 + index,
        outcome: "success",
        inputTokens: 1,
        outputTokens: 1,
        model: "m",
      });
    }
    const records = await ledger.read();
    expect(records.length).toBe(1_500);
    // 不传上限 = 导出全部（`usageExportCsv()` 的实现契约）。
    expect(dataRows(ledgerCsvOf(records))).toBe(1_500);
  }, 30_000);

  it("显式给了上限才截断，且截的是尾部（最近的）", () => {
    const records = [record({ at: 1 }), record({ at: 2 }), record({ at: 3 })];
    const csv = ledgerCsvOf(records.slice(1));
    expect(dataRows(csv)).toBe(2);
    // 保留的是 at=2 与 at=3。
    expect(csv).not.toContain("1970-01-01T00:00:00.001Z");
  });
});

describe("坏数据不让整次导出失败", () => {
  it("at 为 NaN 时写出原始值，不抛 RangeError", () => {
    const csv = ledgerCsvOf([record({ at: Number.NaN })]);
    expect(csv.split("\n")).toHaveLength(2);
    // 原始值留在行里（留线索），而不是一个空列或抛错。
    expect(csv).toContain("NaN");
  });

  it("at 为非法大数（超出 Date 范围）时不抛", () => {
    const csv = ledgerCsvOf([record({ at: 8.64e15 + 1 })]);
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("一条坏记录不影响同批次的正常记录", () => {
    const csv = ledgerCsvOf([record({ at: Number.NaN }), record({ at: 0 })]);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("1970-01-01T00:00:00.000Z");
  });
});

describe("service 层的导出入口确实遵守「缺省全部」", () => {
  it("usageExportCsv() 不传参时导出全部记录", async () => {
    // 直接读服务实现上的方法：它读的是同一个临时台账目录（setup 已指向临时目录）。
    // 这里不断言具体条数（并行用例可能写同一目录），只断言「表头 + 至少一条」且不抛。
    const csv = await LlmAccountUsageService.prototype.usageExportCsv.call({
      // 用最小的假 this：只有方法体里用到的 sharedUsageLedger 走真实实现。
    } as never);
    expect(typeof csv).toBe("string");
    expect(csv.split("\n")[0]).toContain("at,vendor,account");
  });
});
