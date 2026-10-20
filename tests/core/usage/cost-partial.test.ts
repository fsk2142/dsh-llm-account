/**
 * 成本合计不能把「部分有价」当成完整金额（2026-10-20 审计 #7）。
 *
 * 错在哪：`aggregateUsage` 只对**有价格**的记录累加，结果是一个残留的部分和而不是
 * `undefined`。价格表只覆盖少数模型（`VENDOR_PRICES` 为空、官方价表 4 条 vs 目录 85 条），
 * 所以几乎总是「一小部分钱」。而 `usage-report` 把它当 `localSpent` 传下去、界面按普通美元
 * 金额显示（「花费 $0.0x · 仅本机」）—— 违反项目自己的「缺失不等于 0」纪律，而且错在
 * **钱**这一列。
 *
 * 正确口径：至少有一条记录**没有**价格时，合计就是**不完整**的，必须能区分出来。
 */
import { describe, expect, it } from "vitest";

import { aggregateUsage, type UsageRecord, type TokenPrice } from "../../../src/core/usage/stats";

/** 造一条记录。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    vendor: "opendesign",
    account: "acc-1",
    at: 1_000,
    outcome: "success",
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "priced",
    ...overrides,
  };
}

const PRICE: TokenPrice = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };

/** 只有 `priced` 这个模型有价。 */
const priceOf = (model: string): TokenPrice | undefined => (model === "priced" ? PRICE : undefined);

describe("成本合计的可信度", () => {
  it("全部记录都有价时，合计就是完整的（不误报为不完整）", () => {
    const bucket = aggregateUsage([record(), record()], "p", 0, priceOf, priceOf);
    expect(bucket.vendorCost).toBe(2);
    expect(bucket.vendorCostPartial).toBeUndefined();
  });

  it("有记录没价时，**不能**把部分和当成完整金额", () => {
    const records = [record({ model: "priced" }), record({ model: "unpriced" })];
    const bucket = aggregateUsage(records, "p", 0, priceOf, priceOf);
    // 部分和是 1（不是 2），但必须标成「不完整」，界面才不会把它当成全部花费。
    expect(bucket.vendorCost).toBe(1);
    expect(bucket.vendorCostPartial).toBe(true);
    // 同样的口径也要覆盖官方价折算（它就是 localSpent 的来源）。
    expect(bucket.officialCostPartial).toBe(true);
  });

  it("一条有价的都没有时，合计是 undefined 且**不**标成部分（那是「完全没有」）", () => {
    const bucket = aggregateUsage([record({ model: "unpriced" })], "p", 0, priceOf, priceOf);
    expect(bucket.vendorCost).toBeUndefined();
    expect(bucket.vendorCostPartial).toBeUndefined();
  });

  it("没有记录时既不报金额也不报部分", () => {
    const bucket = aggregateUsage([], "p", 0, priceOf, priceOf);
    expect(bucket.vendorCost).toBeUndefined();
    expect(bucket.vendorCostPartial).toBeUndefined();
  });
});
