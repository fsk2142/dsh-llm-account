/**
 * 边界与渲染的容错：坏数据**可以少显示，但绝不能让整棵子树消失**。
 *
 * 2026-10-19 两次报障同一条症状：「刷新用量统计时整块内容消失」「整个设置页消失」。
 * 两类病因，两头都要钉住：
 * 1. 渲染期解引用缺失字段抛 TypeError（边界校验器 + 渲染层双重兜底）；
 * 2. 子组件抛错时 React 丢弃**整棵**子树 —— 只有真正的错误边界（类组件）能挡住，
 *    一层同步 `try/catch` 挡不住子组件的渲染（那发生在它之后的工作循环里）。
 */
import { expect, it, vi } from "vitest";

import { RenderBoundary } from "../../src/client/boundary";
import { dictionaryOf } from "../../src/client/copy";
import { usageDescriptors } from "../../src/client/usage-contract";
import { AccountUsageBlock } from "../../src/client/usage-card";
import { expandSim, findSim, textsOfSim } from "../support/container-sim";

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
  // 这几种都是「能过类型但线上可能出现」的坏值。
  expect(() => build({ period: null, bucket: null })).not.toThrow();
  expect(() => build({ period: {}, bucket: {} })).not.toThrow();
  expect(() => build({ period: { kind: 1 }, bucket: { requests: "x" } })).not.toThrow();
  // 数字字段变成字符串 / null 时显示破折号，不拼出 "NaN"。
  const texts = textsOfSim(build({ period: { kind: "month" }, bucket: { requests: "x", ok: null, officialCost: "y" } })).join(" ");
  expect(texts).not.toContain("NaN");
  expect(texts).toContain("—");
});

it("错误边界：子树抛错后渲染的是面板（含原因与重试），抛出点之上的内容不受影响", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const boom = () => {
      throw new Error("boom from a child");
    };
    const tree = expandSim({
      type: RenderBoundary,
      props: {
        title: "LLM 账号",
        note: "这一块渲染失败了，其它设置不受影响。",
        retryLabel: "重试",
        children: { type: boom, props: {}, key: null },
      },
      key: null,
    });
    const texts = textsOfSim(tree).join(" ");
    expect(texts).toContain("这一块渲染失败了");
    expect(texts).toContain("boom from a child");
    expect(findSim(tree, "data-render-error", "true")).toBeDefined();
    expect(findSim(tree, "data-boundary-retry", "true")).toBeDefined();
  } finally {
    errors.mockRestore();
  }
});

it("错误边界：正常时不改变子树", () => {
  const tree = expandSim({
    type: RenderBoundary,
    props: { children: { type: "span", props: { children: "正常内容" }, key: null } },
    key: null,
  });
  expect(textsOfSim(tree).join(" ")).toContain("正常内容");
  expect(findSim(tree, "data-render-error")).toBeUndefined();
});
