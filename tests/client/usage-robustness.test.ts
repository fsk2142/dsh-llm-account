/**
 * 边界与渲染的容错：坏数据**可以少显示，但绝不能让整棵子树消失**。
 *
 * 2026-10-19 报障：「刷新用量统计时整块内容消失」。根因是渲染期解引用缺失字段
 * （`entry.period.kind` 等）抛 TypeError，React 丢弃整棵子树。
 * 这里从两头钉住：边界校验器丢弃坏行；渲染层对残留坏字段也不抛。
 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { usageDescriptors } from "../../src/client/usage-contract";
import { AccountUsageBlock, UsageCard } from "../../src/client/usage-card";

/** 取 usageReport 描述符的返回解析器（走真实契约，而不是自己造一个）。 */
function reportParser(): (value: unknown) => unknown {
  const descriptor = usageDescriptors().find((entry) => (entry as { method?: string }).method === "usageReport");
  expect(descriptor, "usageReport 描述符应存在").toBeDefined();
  const codec = (descriptor as unknown as { result: { create: () => { parse: (value: unknown) => unknown } } }).result;
  return codec.create().parse;
}

it("边界校验：缺 period / bucket 的账号行被丢弃，而不是让渲染拿到 undefined", () => {
  const parse = reportParser();
  const parsed = parse({
    accounts: [
      // 好行
      { vendor: "v", account: "ok", period: { kind: "month", key: "k", start: 0, fromResetAt: false }, bucket: {}, windowed: {} },
      // 缺 period
      { vendor: "v", account: "no-period", bucket: {} },
      // 缺 bucket
      { vendor: "v", account: "no-bucket", period: { kind: "month", key: "k", start: 0, fromResetAt: false } },
      // 彻底不是对象
      null,
    ],
    total: { window: "today", bucket: {}, byVendor: [{ vendor: "v", bucket: {} }, { vendor: "bad" }] },
  }) as { accounts: { account: string }[]; total: { byVendor: { vendor: string }[] } };
  expect(parsed.accounts.map((row) => row.account)).toEqual(["ok"]);
  // byVendor 同样丢坏行。
  expect(parsed.total.byVendor.map((row) => row.vendor)).toEqual(["v"]);
});

it("边界校验：total.bucket 缺失时明确报错（这种报表整个不可用）", () => {
  const parse = reportParser();
  expect(() => parse({ accounts: [], total: { window: "today" } })).toThrow(/total\.bucket/);
});

it("渲染层：即使 period / bucket 是坏值也不抛（只少显示）", () => {
  const build = (over: Record<string, unknown>) =>
    AccountUsageBlock({
      t: dictionaryOf("zh"),
      entry: { vendor: "v", account: "a", ...over } as never,
      label: "a",
    });
  // 这三种都是「能过类型但线上可能出现」的坏值。
  expect(() => build({ period: null, bucket: null })).not.toThrow();
  expect(() => build({ period: {}, bucket: {} })).not.toThrow();
  expect(() => build({ period: { kind: 1 }, bucket: { requests: "x" } })).not.toThrow();
});

it("用量卡片：byVendor 里的坏行不会让整卡崩", () => {
  expect(() =>
    UsageCard({
      t: dictionaryOf("zh"),
      window: "today",
      accounts: [],
      total: {
        window: "today",
        bucket: {},
        byVendor: [{ vendor: "v" }, { vendor: "w", bucket: {} }],
      } as never,
    }),
  ).not.toThrow();
});
