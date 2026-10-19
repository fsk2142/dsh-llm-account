/**
 * 用量台账的落盘测试：追加、跨进程读回、坏行自愈。
 *
 * 台账是统计的**唯一真相**，所以这几条必须钉住：写进去能读回来、坏行不带走整份、
 * 并发写不交错成坏行。
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { createUsageLedger } from "../../src/core/usage-ledger";

/** 临时目录（每个用例一个，互不干扰）。 */
const directories: string[] = [];

/** 造一个临时目录。 */
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dsh-usage-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it("写进去能原样读回来（含四个 token 分项与失败分类）", async () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();
  const ledger = createUsageLedger(await tempDirectory(), () => now);
  await ledger.record({
    vendor: "commandcode",
    account: "a",
    outcome: "success",
    model: "deepseek-v4.1-flash",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 7,
  });
  await ledger.record({ vendor: "opendesign", account: "b", outcome: "failure", failureKind: "rate-limit" });

  const records = await ledger.read();
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({
    vendor: "commandcode",
    account: "a",
    outcome: "success",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 7,
    model: "deepseek-v4.1-flash",
  });
  expect(records[1]).toMatchObject({ vendor: "opendesign", outcome: "failure", failureKind: "rate-limit" });
  // 按时间升序。
  expect(records[0]!.at).toBeLessThanOrEqual(records[1]!.at);
});

it("坏行自愈：坏 JSON / 缺字段 / 空行都不带走整份台账", async () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();
  const directory = await tempDirectory();
  const ledger = createUsageLedger(directory, () => now);
  await ledger.record({ vendor: "commandcode", account: "good", outcome: "success", inputTokens: 1 });
  // 手工追加三条坏行（模拟半截写入 / 手工编辑）。
  const file = join(directory, "usage-2026-10-19.jsonl");
  const original = await readFile(file, "utf8");
  await writeFile(file, `${original}not json at all\n{"vendor":"x"}\n\n`, "utf8");

  const records = await ledger.read();
  expect(records).toHaveLength(1);
  expect(records[0]!.account).toBe("good");
});

it("并发写不会交错成坏行（写队列串行化）", async () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();
  const ledger = createUsageLedger(await tempDirectory(), () => now);
  await Promise.all(
    Array.from({ length: 20 }, (_unused, index) =>
      ledger.record({ vendor: "commandcode", account: `a${index}`, outcome: "success", inputTokens: index }),
    ),
  );
  const records = await ledger.read();
  expect(records).toHaveLength(20);
  expect(new Set(records.map((record) => record.account)).size).toBe(20);
});

it("目录不存在时读回空数组（不是抛错）", async () => {
  const ledger = createUsageLedger(join(tmpdir(), "dsh-usage-does-not-exist-xyz"), () => Date.now());
  expect(await ledger.read()).toEqual([]);
});

it("按 since 预筛文件：跨天的记录只读命中的那几个文件", async () => {
  const directory = await tempDirectory();
  // 三天各写一条（用固定「现在」= 第三天）。
  const day1 = new Date(2026, 9, 17, 12, 0, 0).getTime();
  const day2 = new Date(2026, 9, 18, 12, 0, 0).getTime();
  const day3 = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const ledger = createUsageLedger(directory, () => day3);
  await ledger.record({ vendor: "v", account: "d1", at: day1, outcome: "success" });
  await ledger.record({ vendor: "v", account: "d2", at: day2, outcome: "success" });
  await ledger.record({ vendor: "v", account: "d3", at: day3, outcome: "success" });

  // 全部：三条都在（保留期内）。
  expect((await ledger.read()).map((record) => record.account)).toEqual(["d1", "d2", "d3"]);
  // 从第二天零点起：只剩 d2、d3（d1 的文件被文件名筛掉）。
  const fromDay2 = new Date(2026, 9, 18, 0, 0, 0).getTime();
  expect((await ledger.read({ since: fromDay2 })).map((record) => record.account)).toEqual(["d2", "d3"]);
  // 只要第三天：只剩 d3。
  const fromDay3 = new Date(2026, 9, 19, 0, 0, 0).getTime();
  expect((await ledger.read({ since: fromDay3 })).map((record) => record.account)).toEqual(["d3"]);
});

it("until 也参与预筛（区间查询不会读到更晚的文件）", async () => {
  const directory = await tempDirectory();
  const day1 = new Date(2026, 9, 17, 12, 0, 0).getTime();
  const day3 = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const ledger = createUsageLedger(directory, () => day3);
  await ledger.record({ vendor: "v", account: "d1", at: day1, outcome: "success" });
  await ledger.record({ vendor: "v", account: "d3", at: day3, outcome: "success" });

  const untilDay2 = new Date(2026, 9, 18, 23, 59, 0).getTime();
  expect((await ledger.read({ until: untilDay2 })).map((record) => record.account)).toEqual(["d1"]);
});
