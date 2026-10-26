/**
 * 失败明细与台账导出（2026-10-20 用户选的 1 + 2）。
 *
 * 两条都是「数据已经在手上、只差一屏」：
 * - 台账早就在记 `failureKind`（实测 8 条 `network`），但**界面上看不到任何一条失败明细** ——
 *   成功率只给一个百分比，实际情况时无从判断是网络抖动还是真的限额。
 * - 台账能读能清，但**没有导出**。对账/备份/拿给别人看，都只能自己去翻 jsonl。
 *
 * 这里先钉住纯数据层（可完整单测），界面与远程方法在后面接。
 */
import { describe, expect, it } from "vitest";

import { failureBreakdownOf, groupFailuresByKind } from "../../../src/core/usage/failures";
import { exportTailOf, ledgerCsvOf, modelKeyOfRecord } from "../../../src/core/usage/export";
import type { UsageRecord } from "../../../src/core/usage/stats";

/** 造一条记录；默认是一次成功的请求。 */
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

describe("失败明细：按分类聚合", () => {
  it("只统计失败记录，按数量降序", () => {
    const records = [
      record({ outcome: "failure", failureKind: "network" }),
      record({ outcome: "failure", failureKind: "network" }),
      record({ outcome: "failure", failureKind: "quota" }),
      record(), // 成功的不算
    ];
    const rows = groupFailuresByKind(records);
    expect(rows).toEqual([
      { kind: "network", count: 2 },
      { kind: "quota", count: 1 },
    ]);
  });

  it("没有 failureKind 的失败也要算一类（不能悄悄丢掉）", () => {
    const rows = groupFailuresByKind([record({ outcome: "failure" }), record({ outcome: "failure", failureKind: "server" })]);
    // 缺失分类名用 "unknown"：它不是空，只是厂商/分类器没给出原因。
    // 两者次数相同 → 按分类名升序（`server` < `unknown`）。
    expect(rows).toEqual([
      { kind: "server", count: 1 },
      { kind: "unknown", count: 1 },
    ]);
  });

  it("数量相同时按分类名排序（结果必须稳定，否则每次重读界面都在跳）", () => {
    const rows = groupFailuresByKind([
      record({ outcome: "failure", failureKind: "server" }),
      record({ outcome: "failure", failureKind: "network" }),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["network", "server"]);
  });

  it("一条失败都没有时返回空数组（不是 undefined、也不是全 0 的行）", () => {
    expect(groupFailuresByKind([record(), record()])).toEqual([]);
    expect(groupFailuresByKind([])).toEqual([]);
  });

  it("明细带最近一次失败的时刻与所属账号（报障时要能对上「刚才那次」）", () => {
    const records = [
      record({ outcome: "failure", failureKind: "network", at: 500, account: "acc-1" }),
      record({ outcome: "failure", failureKind: "network", at: 900, account: "acc-2" }),
    ];
    const [summary] = failureBreakdownOf(records);
    expect(summary).toMatchObject({ kind: "network", count: 2, lastAt: 900, lastAccount: "acc-2" });
  });

  it("lastAccount 取**最近那条**的账号，不是先出现的那个", () => {
    const records = [
      record({ outcome: "failure", failureKind: "network", at: 900, account: "late" }),
      record({ outcome: "failure", failureKind: "network", at: 100, account: "early" }),
    ];
    expect(failureBreakdownOf(records)[0]?.lastAccount).toBe("late");
  });
});

describe("台账导出 CSV", () => {
  it("表头固定、字段顺序稳定（excel 打开时列不能乱跳）", () => {
    const csv = ledgerCsvOf([record()]);
    const [header] = csv.split("\n");
    expect(header).toBe("at,vendor,account,model,outcome,failureKind,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens");
  });

  it("时间导成 ISO 8601（人能读，也不依赖本机时区）", () => {
    const csv = ledgerCsvOf([record({ at: 0 })]);
    expect(csv.split("\n")[1]).toMatch(/^1970-01-01T00:00:00\.000Z,/);
  });

  it("含逗号/引号/换行的字段按 RFC 4180 转义", () => {
    const csv = ledgerCsvOf([record({ account: 'a,b"c', model: "line\nbreak" })]);
    // 字段被引号包住时，换行属于**字段内容**，所以整段文本里仍是引号内换行 ——
    // 不能按 "\n" 切行再断言（那会把一个字段劈成两半）。
    expect(csv).toContain('"a,b""c"');
    expect(csv).toContain('"line\nbreak"');
    // 除表头与记录之间那一处结构换行外，换行只出现在被引号包住的字段内部。
    expect(csv.split("\n").length).toBe(3); // 表头 + 1 条记录（被换行劈成 2 段）
  });

  it("空的 failureKind 导成空列，不写 undefined / null", () => {
    const row = ledgerCsvOf([record()]).split("\n")[1]!;
    expect(row).not.toMatch(/undefined|null/);
    // 第 6 列（failureKind）是空的：at,vendor,account,model,outcome,,input...
    expect(row.split(",")[5]).toBe("");
  });

  it("没有记录时只给表头（不能是空文件，否则看不出「已导出但没数据」）", () => {
    expect(ledgerCsvOf([])).toBe(
      "at,vendor,account,model,outcome,failureKind,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens",
    );
  });

  it("导出保留原始 model id，不做展示名替换（对账要的是台账里的真值）", () => {
    const csv = ledgerCsvOf([record({ model: "deepseek/deepseek-v4.1-flash" })]);
    expect(csv).toContain("deepseek/deepseek-v4.1-flash");
    expect(csv).not.toContain("DeepSeek-V4.1-Flash");
  });
});

describe("导出的收口", () => {
  it("modelKeyOfRecord 归一化同一模型的两种写法（供后续分组）", () => {
    expect(modelKeyOfRecord("deepseek/deepseek-v4.1-flash")).toBe(modelKeyOfRecord("deepseek-v4.1-flash"));
  });

  it("exportTailOf 只留最近 N 条（导出不该把 120 天全塞给用户）", () => {
    const records = [record({ at: 1 }), record({ at: 2 }), record({ at: 3 })];
    expect(exportTailOf(records, 2).map((r) => r.at)).toEqual([2, 3]);
  });

  it("exportTailOf 在 N 超过总数时原样返回（不补空、不报错）", () => {
    const records = [record({ at: 1 })];
    expect(exportTailOf(records, 100)).toHaveLength(1);
  });
});
