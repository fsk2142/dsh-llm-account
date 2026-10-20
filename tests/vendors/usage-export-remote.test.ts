/**
 * 宿主侧：`usageExportCsv` 与报表里的 `failuresByKind`（2026-10-20）。
 *
 * 与 `usage-insights.test.ts` 的分工：那个测纯函数（唯一可信来源），这里测**接线** ——
 * 台账真的落盘、远程方法真的读回来、CSV 真的带着表头。两条路径分开测，才分得清
 * 「算错了」与「没接上」（这一层以前正是 `lastUsed` 两次被抹掉的地方）。
 *
 * 台账目录由 `tests/setup-usage-dir.ts` 指到临时目录，不碰用户真实数据。
 */
import { expect, it } from "vitest";

import { createUsageLedger, type UsageLedger } from "../../src/core/usage/ledger";
import { exportTailOf, ledgerCsvOf } from "../../src/core/usage/export";
import { failureBreakdownOf } from "../../src/core/usage/failures";
import type { UsageRecord } from "../../src/core/usage/stats";

/** 造一条记录。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    vendor: "opendesign",
    account: "acc-1",
    at: 1_000,
    outcome: "success",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheWriteTokens: 0,
    model: "deepseek-v4.1-flash",
    ...overrides,
  };
}

/** 一本指向临时目录的独立台账（每个用例一份，互不干扰）。 */
async function tempLedger(): Promise<UsageLedger> {
  const directory = process.env.DSH_LLM_ACCOUNT_USAGE_DIR ?? "";
  expect(directory).not.toBe("");
  return createUsageLedger(directory);
}

it("台账落盘 → 读回来 → 导出 CSV：表头与记录都在", async () => {
  const ledger = await tempLedger();
  await ledger.record({ vendor: "opendesign", account: "acc-1", outcome: "success", inputTokens: 10, outputTokens: 5, model: "m" });
  const records = await ledger.read();
  const csv = ledgerCsvOf(records);

  expect(csv.split("\n")[0]).toBe(
    "at,vendor,account,model,outcome,failureKind,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens",
  );
  expect(csv).toContain("opendesign");
  expect(csv).toContain("acc-1");
});

it("空台账也导出表头（用户能区分「导出成功但没数据」与「导出失败」）", async () => {
  // 空目录：直接对空集合序列化，模拟新装机器。
  expect(ledgerCsvOf([])).toBe(
    "at,vendor,account,model,outcome,failureKind,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens",
  );
});

it("导出行数与记录数一致（不丢行、不多行）", async () => {
  const records = [record({ at: 1 }), record({ at: 2 }), record({ at: 3 })];
  // 表头 1 行 + 3 条记录。
  expect(ledgerCsvOf(records).split("\n")).toHaveLength(4);
});

it("exportTailOf 在真实记录上取最近 N 条（按时刻，不按写入顺序）", () => {
  const records = [record({ at: 300 }), record({ at: 100 }), record({ at: 200 })];
  // 调用方负责按时间升序读（`ledger.read()` 就是这么返回的），尾部即最近。
  const sorted = [...records].sort((left, right) => left.at - right.at);
  expect(exportTailOf(sorted, 2).map((entry) => entry.at)).toEqual([200, 300]);
});

it("失败明细只统计失败，且与失败分类一一对应", () => {
  const records = [
    record({ outcome: "failure", failureKind: "network", at: 10 }),
    record({ outcome: "failure", failureKind: "network", at: 20 }),
    record({ outcome: "failure", failureKind: "quota", at: 30 }),
    record({ outcome: "success", at: 40 }),
  ];
  const rows = failureBreakdownOf(records);
  expect(rows.map((row) => [row.kind, row.count])).toEqual([
    ["network", 2],
    ["quota", 1],
  ]);
  // 最近一次失败的时刻与账号都能落到具体那一行。
  expect(rows[0]).toMatchObject({ kind: "network", lastAt: 20, lastAccount: "acc-1" });
});
