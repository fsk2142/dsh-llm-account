/**
 * 用量卡片的渲染测试。
 *
 * 关注的不是样式，而是**几条会被用户当承诺读的口径**：
 * - 失败/成功率/命中率缺失时显示破折号，不显示 0%；
 * - 厂商价未公开时显示「未公开」，不显示 $0.00；
 * - 官方价折算以**小字**跟随（用户要求「出个小字」）；
 * - 每账号带自己的周期来源，总账单独一节。
 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { UsageCard, type UsageReportView } from "../../src/client/usage-card";
import type { StubElement } from "../support/react-stub";

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 树里的全部文本。 */
function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    walk((value as StubElement).props.children);
  };
  walk(node);
  return out;
}

/** 造一个桶（默认「2 次请求、1 成功 1 失败、100 输入、50 输出、300 缓存读」）。 */
function bucketOf(overrides: Partial<UsageReportView["total"]["bucket"]> = {}): UsageReportView["total"]["bucket"] {
  return {
    period: "p",
    since: 0,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    requests: 2,
    ok: 1,
    failed: 1,
    successRate: 0.5,
    cacheHitRate: 0.75,
    officialCost: 0.42,
    ...overrides,
  };
}

/** 造一份报表。 */
function reportOf(overrides: Partial<UsageReportView> = {}): UsageReportView {
  return {
    accounts: [
      {
        vendor: "commandcode",
        account: "a",
        period: { kind: "five-hour", key: "2026-10-19T13", start: 0, fromResetAt: true },
        bucket: bucketOf(),
        windowed: bucketOf(),
      },
    ],
    total: { window: "today", bucket: bucketOf(), byVendor: [{ vendor: "commandcode", bucket: bucketOf() }] },
    ...overrides,
  };
}

/** 渲染一次。 */
function render(overrides: Partial<UsageReportView> = {}, extra: Record<string, unknown> = {}): StubElement {
  const report = reportOf(overrides);
  return UsageCard({
    t: dictionaryOf("zh"),
    window: "today",
    accounts: report.accounts,
    total: report.total,
    ...extra,
  });
}

it("请求数同时给出总数与成功/失败；成功率与命中率按百分比显示", () => {
  const tree = render();
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("2 次（成功 1 · 失败 1）");
  expect(texts).toContain("50%"); // 成功率
  expect(texts).toContain("75%"); // 命中率
});

it("四个 token 分项都列出来（总量对不上时可以自己对账）", () => {
  const tree = render();
  const rows = elementsOf(tree).map((element) => element.props["data-usage-row"]);
  expect(rows).toContain("input");
  expect(rows).toContain("output");
  expect(rows).toContain("cache-read");
  expect(rows).toContain("cache-write");
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("未命中输入");
  expect(texts).toContain("缓存命中");
});

it("厂商价未公开时显示「未公开」，不是 $0.00", () => {
  const tree = render();
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("未公开");
  expect(texts).not.toContain("$0.00");
});

it("官方价折算以**小字**跟随厂商价（用户要求「出个小字」）", () => {
  const tree = render();
  const official = elementsOf(tree).find((element) => element.props["data-usage-row"] === "official-cost")!;
  expect(official).toBeDefined();
  // 官方价那一格必须是 <small>，不是普通数值。
  const hint = elementsOf(official).find((element) => element.props["data-usage-official"] !== undefined)!;
  expect(hint.type).toBe("small");
  expect(textsOf(hint).join(" ")).toContain("按 DeepSeek 官方价");
  expect(textsOf(hint).join(" ")).toContain("$0.42");
});

it("缺失的比率/成本显示破折号或「未公开」，绝不显示成 0", () => {
  const tree = render({
    accounts: [],
    total: {
      window: "today",
      bucket: bucketOf({ requests: 1, ok: 1, failed: 0, successRate: 1, cacheHitRate: undefined, officialCost: undefined }),
      byVendor: [],
    },
  });
  // 命中率那一格必须是破折号（缺失 ≠ 0%）。
  const cacheRow = elementsOf(tree).find((element) => element.props["data-usage-row"] === "cache-hit-rate")!;
  expect(textsOf(cacheRow).join(" ")).toContain("—");
  expect(textsOf(cacheRow).join(" ")).not.toContain("%");
  // 官方价缺失也显示破折号，不是 $0.00。
  const officialRow = elementsOf(tree).find((element) => element.props["data-usage-row"] === "official-cost")!;
  expect(textsOf(officialRow).join(" ")).toContain("—");
  expect(textsOf(officialRow).join(" ")).not.toContain("$0.00");
});

it("每账号一节标注它的周期与来源（厂商重置 vs 自然推算）", () => {
  const tree = render();
  const period = elementsOf(tree).find((element) => element.props["data-usage-period"] !== undefined)!;
  expect(period.props["data-usage-period-source"]).toBe("vendor");
  expect(textsOf(period).join(" ")).toContain("按厂商重置时间");
});

it("总账单独一节，并列出各厂商的请求数", () => {
  const tree = render();
  const total = elementsOf(tree).find((element) => element.props["data-usage-total"] !== undefined)!;
  expect(total).toBeDefined();
  expect(textsOf(total).join(" ")).toContain("合计");
  expect(textsOf(total).join(" ")).toContain("commandcode 2");
});

it("没有记录时给出空态说明（而不是一块空白）", () => {
  const empty = bucketOf({ requests: 0, ok: 0, failed: 0, successRate: undefined, cacheHitRate: undefined, officialCost: undefined });
  const tree = render({ accounts: [], total: { window: "today", bucket: empty, byVendor: [] } });
  expect(textsOf(tree).join(" ")).toContain("还没有用量记录");
});

it("窗口按钮带上当前选中态，点它回调窗口键", () => {
  const calls: string[] = [];
  const tree = render({}, { onWindow: (next: string) => calls.push(next) });
  const buttons = elementsOf(tree).filter((element) => element.props["data-usage-window"] !== undefined);
  expect(buttons.map((element) => element.props["data-usage-window"])).toEqual(["today", "7d", "30d", "all"]);
  // 当前窗口是 today → aria-pressed
  expect(buttons[0]!.props["aria-pressed"]).toBe(true);
  (buttons[1]!.props.onClick as () => void)();
  expect(calls).toEqual(["7d"]);
});
