/**
 * `clear()` 必须清掉**整段保留期**，不是只清今天（2026-10-20 审计，HIGH）。
 *
 * 错在哪：`clear()` 只 `writeFile(今天的文件, "")`，而 `readRecords` 会读保留期内的**每一个**
 * 日文件。于是用户确认了「清空全部用量记录？此操作不可撤销」之后：
 * 1. 只有今天的数据真的没了；
 * 2. 界面重读后，前几天的历史**原样回来**；
 * 3. 界面却显示成功 —— 部分清空 + 部分数据丢失，两者都不该在「清空全部」里发生。
 */
import { describe, expect, it } from "vitest";

import { createUsageLedger } from "../../../src/core/usage/ledger";

/** 测试用的台账目录（`tests/setup-usage-dir.ts` 已指向临时目录）。 */
function directory(): string {
  const dir = process.env.DSH_LLM_ACCOUNT_USAGE_DIR ?? "";
  expect(dir).not.toBe("");
  return dir;
}

const DAY = 86_400_000;

describe("清空台账要清干净", () => {
  it("跨多天的记录全部被清掉（不是只清今天）", async () => {
    const ledger = createUsageLedger(directory());
    const now = Date.now();
    // 三天各一条：今天、昨天、前天。
    for (const offset of [0, 1, 2]) {
      await ledger.record({
        vendor: "opendesign",
        account: "acc-1",
        at: now - offset * DAY,
        outcome: "success",
        inputTokens: 1,
        outputTokens: 1,
        model: "m",
      });
    }
    expect((await ledger.read()).length).toBe(3);

    await ledger.clear();

    // 关键断言：清空之后**一条都不剩**（以前这里会剩下昨天与前天的）。
    expect(await ledger.read()).toEqual([]);
  });

  it("清空是幂等的（空台账再清一次不抛）", async () => {
    const ledger = createUsageLedger(directory());
    await ledger.clear();
    await ledger.clear();
    expect(await ledger.read()).toEqual([]);
  });

  it("清空之后的写入照常工作（文件可继续追加）", async () => {
    const ledger = createUsageLedger(directory());
    await ledger.record({ vendor: "opendesign", account: "a", outcome: "success", model: "m" });
    await ledger.clear();
    await ledger.record({ vendor: "opendesign", account: "a", outcome: "success", model: "m" });
    expect((await ledger.read()).length).toBe(1);
  });
});
