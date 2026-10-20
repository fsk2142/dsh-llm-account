/**
 * 分期过期与窗口 `all` 的两处静默错误（2026-10-20 审计 #4 #5）。
 *
 * #4 `planPeriodAt`：`at >= end`（订阅本期已过、厂商还没报新的 periodEnd）时，返回的周期仍然
 *    以**过去的** periodEnd 结尾，`at` 不在区间里。`usage-report` 用 `record.at < period.end`
 *    过滤 → 当前所有记录被丢掉 → 账号用量块显示 0 请求，而请求其实在正常进行。
 *    注释写的是「用现在这一档兜住」，代码没做。
 *
 * #5 `readRangeFor("all")`：`windowStartOf("all")` 返回 `undefined`（表示无下界），但函数把它
 *    当成「没给」而回落到 40 天下界。客户端把窗口硬编码成 `all`（三处），于是失败明细与
 *    超过 40 天的周期都会掉数据，而 CSV 导出（全读）与界面对不上。
 */
import { describe, expect, it } from "vitest";

import { planPeriodAt } from "../../src/core/billing-period";

const DAY = 86_400_000;

describe("#4 分期末尾已过时，周期必须包含此刻", () => {
  it("只给过去的 periodEnd：返回的区间必须包含 at", () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    // 本期在 10 天前就结束了（订阅过期 / 厂商还没报新一期）。
    const periodEnd = now - 10 * DAY;
    const period = planPeriodAt(periodEnd, now);
    expect(period).toBeDefined();
    // 关键：现在这一刻必须落在 [start, end) 里，否则统计会把当前记录全过滤掉。
    expect(period!.start).toBeLessThanOrEqual(now);
    expect(period!.end === undefined || period!.end > now).toBe(true);
  });

  it("给了 periodStart 但本期已过：同样要兜住此刻", () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    const periodStart = now - 40 * DAY;
    const periodEnd = now - 10 * DAY;
    const period = planPeriodAt(periodEnd, now, periodStart);
    expect(period).toBeDefined();
    expect(period!.start).toBeLessThanOrEqual(now);
    expect(period!.end === undefined || period!.end > now).toBe(true);
  });

  it("本期仍在进行时行为不变（回归保护）", () => {
    const now = Date.UTC(2026, 9, 20, 12, 0, 0);
    const periodEnd = now + 10 * DAY;
    const period = planPeriodAt(periodEnd, now);
    expect(period).toMatchObject({ start: expect.any(Number), end: periodEnd });
    expect(period!.start).toBeLessThan(now);
  });
});
