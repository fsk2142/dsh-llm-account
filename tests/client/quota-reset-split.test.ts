import { describe, expect, it } from "vitest";

import { splitResetText } from "../../src/client/quota";

/**
 * 重置时间拆成「日期 / 时间」两列（2026-11-03 需求）。
 *
 * > 重置时间放到右边吧，分两列，一列日期，一列时间
 *
 * `quotaResetDateText` 产出的是**一整串** `MM-DD HH:MM`（跨年时 `YYYY-MM-DD HH:MM`）。
 * 界面要把日期与时间放进两列，所以在这里按**最后一个空格**切开 —— 日期部分本身可能
 * 含空格（`约 10-19`、`2026-11-14`），时间部分永远不含。
 */
describe("重置时间拆两列", () => {
  it("同年：`10-19 20:00` → 日期 `10-19` / 时间 `20:00`", () => {
    expect(splitResetText("10-19 20:00")).toEqual({ date: "10-19", time: "20:00" });
  });

  it("跨年：`2026-11-14 20:00` → 日期整段带年份", () => {
    expect(splitResetText("2026-11-14 20:00")).toEqual({ date: "2026-11-14", time: "20:00" });
  });

  it("估算前缀保留在日期上：`约 10-19 20:00`", () => {
    expect(splitResetText("约 10-19 20:00")).toEqual({ date: "约 10-19", time: "20:00" });
  });

  it("**没有时间部分时整串都是日期**（`未知` 之类不能凭空造一个时间）", () => {
    expect(splitResetText("未知")).toEqual({ date: "未知", time: undefined });
    expect(splitResetText("10-19")).toEqual({ date: "10-19", time: undefined });
  });

  it("空串 / 纯空白 → 日期为空、无时间", () => {
    expect(splitResetText("")).toEqual({ date: "", time: undefined });
    expect(splitResetText("   ")).toEqual({ date: "", time: undefined });
  });

  it("时间部分必须像 `HH:MM`：不像时不算时间，整串归日期", () => {
    // 防止把「10-19 下午」这种没给时刻的文案误切成两列。
    expect(splitResetText("10-19 下午")).toEqual({ date: "10-19 下午", time: undefined });
  });
});
