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

import { createUsageLedger } from "../../src/core/usage/ledger";

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

it("**文件没变就不重复读盘解析**（设置页每 30 秒重读一次同样的台账）", async () => {
  // 2026-10-21 性能审计：设置页的 `usageTick` 每 30 秒触发一次 `usageReport()`，
  // 每次都把保留期内的日文件整份读进来、逐行 `JSON.parse`。实测 3458 条记录 ≈ 3.3ms/
  // 次，页面开着一天约 9.5 秒纯 CPU，而且这些解析结果**每次完全一样**。
  //
  // 这里用「读盘次数」而不是计时来钉住它 —— 计时在 CI 上不稳定，而「同一份文件
  // 第二次不该再读」是确定的因果。
  const directory = await tempDirectory();
  const now = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const ledger = createUsageLedger(directory, () => now);
  await ledger.record({ vendor: "v", account: "a", at: now, outcome: "success" });

  const first = await ledger.read();
  expect(first).toHaveLength(1);
  const readsAfterFirst = ledger.stats().fileReads;
  expect(readsAfterFirst).toBeGreaterThan(0);

  // 再读 5 次：文件一个字节都没变，不该再读盘。
  for (let index = 0; index < 5; index += 1) await ledger.read();
  expect(ledger.stats().fileReads).toBe(readsAfterFirst);

  // 但结果必须仍然正确（缓存不能把数据弄丢）。
  expect(await ledger.read()).toEqual(first);
});

it("**追加新记录后缓存失效**：立刻能读到新记录", async () => {
  // 缓存最容易引入的 bug 就是「写进去读不出来」。追加必须让该文件的缓存失效。
  const directory = await tempDirectory();
  const now = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const ledger = createUsageLedger(directory, () => now);
  await ledger.record({ vendor: "v", account: "a", at: now, outcome: "success" });
  expect(await ledger.read()).toHaveLength(1);

  await ledger.record({ vendor: "v", account: "b", at: now, outcome: "success" });
  expect((await ledger.read()).map((record) => record.account)).toEqual(["a", "b"]);
});

it("**别的进程写了文件**：mtime/size 变了就要重读，不能拿旧缓存糊弄", async () => {
  // 台账是三条 provider 行共用的，而且宿主可能重启 —— 缓存只在本进程内有效，
  // 所以必须靠文件的 mtime/size 判断它是否被外部改过。
  const directory = await tempDirectory();
  const now = new Date(2026, 9, 19, 12, 0, 0).getTime();
  const ledger = createUsageLedger(directory, () => now);
  await ledger.record({ vendor: "v", account: "a", at: now, outcome: "success" });
  expect(await ledger.read()).toHaveLength(1);

  // 模拟「另一个进程」追加了一行：直接用 fs 写，不经过 ledger。
  const name = (await import("node:fs/promises")).readdir(directory).then((names) =>
    names.find((entry) => entry.endsWith(".jsonl")) as string,
  );
  const file = join(directory, await name);
  const original = await readFile(file, "utf8");
  const extra = `${JSON.stringify({ vendor: "v", account: "external", at: now, outcome: "success" })}\n`;
  await writeFile(file, original + extra, "utf8");

  expect((await ledger.read()).map((record) => record.account)).toEqual(["a", "external"]);
});
