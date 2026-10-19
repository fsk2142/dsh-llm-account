/**
 * 用量统计的纯逻辑测试：聚合口径、缓存命中率、两种计价、窗口与记账周期。
 *
 * 这些是**会被用户当数字看的东西**，所以每条口径都要有用例钉住：成功率的分母、
 * 命中率的分母、成本缺失时不能变 0、周期边界不能把请求算错账。
 */
import { describe, expect, it } from "vitest";

import { periodAt, periodKindOf } from "../../src/core/billing-period";
import { DEEPSEEK_OFFICIAL_PRICES, lookupPrice, officialPriceOf, vendorPriceOf } from "../../src/core/pricing";
import { buildUsageReport } from "../../src/core/usage-report";
import {
  aggregateUsage,
  costOf,
  countsOf,
  totalTokensOf,
  windowStart,
  withinWindow,
  type UsageRecord,
} from "../../src/core/usage-stats";

/** 造一条记录（默认「一次成功、100 输入、50 输出、无缓存」）。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    vendor: "commandcode",
    account: "a",
    at: 1_700_000_000_000,
    outcome: "success",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "deepseek-v4.1-flash",
    ...overrides,
  };
}

describe("计数与合计", () => {
  it("缺失字段按 0，负数与非数也按 0", () => {
    expect(countsOf(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(countsOf({ inputTokens: -5, outputTokens: Number.NaN, cacheReadTokens: 7 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
    });
  });

  it("总量 = 四个分项之和", () => {
    expect(totalTokensOf({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBe(10);
  });
});

describe("聚合口径", () => {
  it("成功率的分母是**尝试数**（失败也算），没有请求时是 undefined 而不是 0", () => {
    const records = [record(), record(), record({ outcome: "failure" })];
    const bucket = aggregateUsage(records, "p", 0, () => undefined, () => undefined);
    expect(bucket.requests).toBe(3);
    expect(bucket.ok).toBe(2);
    expect(bucket.failed).toBe(1);
    expect(bucket.successRate).toBeCloseTo(2 / 3, 6);

    const empty = aggregateUsage([], "p", 0, () => undefined, () => undefined);
    expect(empty.successRate).toBeUndefined();
    expect(empty.cacheHitRate).toBeUndefined();
  });

  it("缓存命中率 = 缓存读 /（缓存读 + 未命中输入）；写缓存不进分母", () => {
    // 命中 300、未命中 100 → 75%。写缓存 500 不应拉低它。
    const bucket = aggregateUsage(
      [record({ cacheReadTokens: 300, inputTokens: 100, cacheWriteTokens: 500 })],
      "p",
      0,
      () => undefined,
      () => undefined,
    );
    expect(bucket.cacheHitRate).toBeCloseTo(0.75, 6);
  });

  it("没有 token 的请求（比如鉴权失败）不产生命中率，也不影响别的账号", () => {
    const bucket = aggregateUsage(
      [record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outcome: "failure" })],
      "p",
      0,
      () => undefined,
      () => undefined,
    );
    expect(bucket.cacheHitRate).toBeUndefined();
    expect(bucket.successRate).toBe(0);
  });

  it("成本逐条累加：不同模型的记录各按各的价", () => {
    const priceOf = (model: string): { input: number; cacheRead: number; cacheWrite: number; output: number } | undefined =>
      model === "cheap" ? { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 } : { input: 100, cacheRead: 0, cacheWrite: 0, output: 0 };
    const bucket = aggregateUsage(
      [record({ model: "cheap", inputTokens: 1_000_000, outputTokens: 0 }), record({ model: "pricey", inputTokens: 1_000_000, outputTokens: 0 })],
      "p",
      0,
      priceOf,
      () => undefined,
    );
    expect(bucket.vendorCost).toBeCloseTo(101, 6);
  });

  it("没有价格时成本是 undefined（绝不显示成 0 元）", () => {
    expect(costOf({ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, undefined)).toBeUndefined();
    const bucket = aggregateUsage([record()], "p", 0, () => undefined, () => undefined);
    expect(bucket.vendorCost).toBeUndefined();
  });
});

describe("DeepSeek 官方计价", () => {
  it("官方价表按每百万 token 计价，缓存命中用缓存价", () => {
    // Flash 高峰价：input 0.30 / cacheRead 0.006 / output 1.20（每百万）
    const counts = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    const cost = costOf(counts, DEEPSEEK_OFFICIAL_PRICES["deepseek-v4.1-flash"]);
    expect(cost).toBeCloseTo(0.3 + 1.2 + 0.006, 6);
  });

  it("模型 id 的三种写法都能查到同一份价（完整 / 子路径 / 带前缀）", () => {
    const direct = lookupPrice(DEEPSEEK_OFFICIAL_PRICES, "deepseek-v4.1-flash");
    expect(direct).toBeDefined();
    expect(lookupPrice(DEEPSEEK_OFFICIAL_PRICES, "deepseek/deepseek-v4.1-flash")).toEqual(direct);
    expect(lookupPrice(DEEPSEEK_OFFICIAL_PRICES, "DeepSeek-V4.1-Flash")).toEqual(direct);
  });

  it("未知模型没有官方价", () => {
    expect(officialPriceOf("some-model-nobody-priced")).toBeUndefined();
  });

  it("厂商真实价当前为空（订阅制不公布 token 单价）——查询返回 undefined 而不是假数字", () => {
    expect(vendorPriceOf("commandcode")("deepseek-v4.1-flash")).toBeUndefined();
    expect(vendorPriceOf("dsh-opencode-go")("anything")).toBeUndefined();
  });
});

describe("时间窗口", () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();

  it("今日从本地零点起算", () => {
    expect(windowStart("today", now)).toBe(new Date(2026, 9, 19, 0, 0, 0).getTime());
  });

  it("近 7 天 / 近 30 天各按天数回推；全部没有下界", () => {
    expect(windowStart("7d", now)).toBe(now - 7 * 86_400_000);
    expect(windowStart("30d", now)).toBe(now - 30 * 86_400_000);
    expect(windowStart("all", now)).toBeUndefined();
  });

  it("裁剪只保留窗口内的记录", () => {
    const records = [
      record({ at: now - 86_400_000 }),
      record({ at: now - 8 * 86_400_000 }),
      record({ at: now - 40 * 86_400_000 }),
    ];
    expect(withinWindow(records, "today", now)).toHaveLength(0);
    expect(withinWindow(records, "7d", now)).toHaveLength(1);
    expect(withinWindow(records, "30d", now)).toHaveLength(2);
    expect(withinWindow(records, "all", now)).toHaveLength(3);
  });
});

describe("记账周期", () => {
  it("窗口 key → 粒度", () => {
    expect(periodKindOf("fiveHour")).toBe("five-hour");
    expect(periodKindOf("5h")).toBe("five-hour");
    expect(periodKindOf("rolling")).toBe("five-hour");
    expect(periodKindOf("weekly")).toBe("week");
    expect(periodKindOf("monthlyCredits")).toBe("month");
    expect(periodKindOf("daily")).toBe("day");
  });

  it("有 resetAt 时以它反推周期起点，并标为来自厂商", () => {
    const resetAt = new Date(2026, 9, 19, 18, 0, 0).getTime();
    const at = new Date(2026, 9, 19, 15, 0, 0).getTime();
    const period = periodAt("five-hour", at, resetAt);
    expect(period.fromResetAt).toBe(true);
    expect(period.start).toBe(resetAt - 5 * 3_600_000);
    expect(period.end).toBe(resetAt);
  });

  it("resetAt 落在过去（已经过期）时退回自然周期", () => {
    const resetAt = new Date(2026, 9, 18, 18, 0, 0).getTime();
    const at = new Date(2026, 9, 19, 15, 0, 0).getTime();
    const period = periodAt("five-hour", at, resetAt);
    expect(period.fromResetAt).toBe(false);
  });

  it("自然周期：按本地时区切桶，进行中的周期没有终点", () => {
    const at = new Date(2026, 9, 19, 15, 30, 0).getTime();
    const period = periodAt("day", at);
    expect(period.start).toBe(new Date(2026, 9, 19, 0, 0, 0).getTime());
    expect(period.end).toBeUndefined();
  });

  it("周从周一起算", () => {
    // 2026-10-19 是周一。
    const at = new Date(2026, 9, 21, 10, 0, 0).getTime();
    const period = periodAt("week", at);
    expect(new Date(period.start).getDay()).toBe(1);
  });
});

describe("报表：每账号按自己的周期 + 单独的总账", () => {
  const now = new Date(2026, 9, 19, 15, 0, 0).getTime();
  const resetAtFiveHour = new Date(2026, 9, 19, 18, 0, 0).getTime();

  it("账号分桶互不干扰，且各自锚到自己的重置时间", () => {
    const records = [
      record({ vendor: "commandcode", account: "a", at: now - 3_600_000 }),
      record({ vendor: "commandcode", account: "a", at: now - 2 * 3_600_000 }),
      record({ vendor: "opendesign", account: "b", at: now - 3_600_000 }),
    ];
    const report = buildUsageReport({
      records,
      window: "today",
      now,
      periodWindowOf: (vendor) => (vendor === "commandcode" ? "fiveHour" : "monthly"),
      resetAtOf: (vendor) => (vendor === "commandcode" ? resetAtFiveHour : undefined),
    });

    expect(report.accounts).toHaveLength(2);
    const cc = report.accounts.find((entry) => entry.vendor === "commandcode")!;
    expect(cc.bucket.requests).toBe(2);
    expect(cc.period.fromResetAt).toBe(true);
    const od = report.accounts.find((entry) => entry.vendor === "opendesign")!;
    expect(od.bucket.requests).toBe(1);
    expect(od.period.kind).toBe("month");
  });

  it("总账跨账号合计，并按厂商拆开", () => {
    const records = [
      record({ vendor: "commandcode", account: "a", inputTokens: 100 }),
      record({ vendor: "commandcode", account: "b", inputTokens: 200 }),
      record({ vendor: "dsh-opencode-go", account: "c", inputTokens: 300 }),
    ];
    const report = buildUsageReport({ records, window: "all", now });
    expect(report.total.bucket.requests).toBe(3);
    expect(report.total.bucket.inputTokens).toBe(600);
    expect(report.total.byVendor.map((entry) => entry.vendor)).toEqual(["commandcode", "dsh-opencode-go"]);
    expect(report.total.byVendor[0]!.bucket.inputTokens).toBe(300);
    expect(report.total.byVendor[1]!.bucket.inputTokens).toBe(300);
  });

  it("周期窗口不影响别的窗口口径：账号同时带周期聚合与窗口聚合", () => {
    const records = [
      record({ at: now - 3_600_000 }), // 今日、本期
      record({ at: now - 10 * 86_400_000 }), // 不在今日/本期
    ];
    const report = buildUsageReport({
      records,
      window: "today",
      now,
      periodWindowOf: () => "fiveHour",
      resetAtOf: () => resetAtFiveHour,
    });
    const entry = report.accounts[0]!;
    expect(entry.bucket.requests).toBe(1);
    expect(entry.windowed.requests).toBe(1);
    expect(report.total.bucket.requests).toBe(1);
  });

  it("官方价折算：有 token 就有值，没 token 时为 undefined", () => {
    const report = buildUsageReport({
      records: [record({ model: "deepseek-v4.1-flash", inputTokens: 1_000_000, outputTokens: 0 })],
      window: "all",
      now,
    });
    expect(report.total.bucket.officialCost).toBeCloseTo(0.3, 6);
    // 厂商价没公开 → 保持 undefined。
    expect(report.total.bucket.vendorCost).toBeUndefined();
  });
});
