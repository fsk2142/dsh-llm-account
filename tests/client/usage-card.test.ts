/**
 * 账号用量区块的渲染测试（`AccountUsageBlock`）。
 *
 * 用户 2026-10-19 的要求：统计**只在每个账号下面**，版式对齐参考图 —— 一行标题（用量 + 账期
 * 区间 + 口径来源）、四个指标块（请求 / 成功率 / 花费 / Token）、每个块带一行小字补充，
 * 核对用的数（命中率、缓存读写、最近一次请求）收在脚下。
 *
 * 关注的是几条会被用户当承诺读的口径：
 * - 缺失的比率/金额显示破折号或「未公开」，绝不显示 0 / $0.00；
 * - 官方价折算以小字跟随厂商金额（「出个小字」）；
 * - 账期区间按账号自己的周期给，不跟页面上的时间窗口走。
 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { AccountUsageBlock, periodRangeText } from "../../src/client/usage-card";
import type { AccountUsageView, UsageBucketView } from "../../src/client/usage-contract";
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

/** 本地时区的某天 0 点（账期区间按本地日历格式化，测试不能用 UTC 常量）。 */
function localDay(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

/** 造一个桶（默认「2 次请求、1 成功 1 失败」）。 */
function bucketOf(overrides: Partial<UsageBucketView> = {}): UsageBucketView {
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

/** 造一条账号用量行。 */
function entryOf(overrides: Partial<AccountUsageView> = {}): AccountUsageView {
  return {
    vendor: "commandcode",
    account: "a",
    period: {
      kind: "month",
      key: "2026-10",
      start: localDay(2026, 10, 14),
      end: localDay(2026, 11, 14),
      fromResetAt: true,
    },
    bucket: bucketOf(),
    windowed: bucketOf(),
    ...overrides,
  };
}

/** 渲染一次。 */
function render(entry: Partial<AccountUsageView> = {}, extra: Record<string, unknown> = {}): StubElement {
  return AccountUsageBlock({
    t: dictionaryOf("zh"),
    entry: entryOf(entry),
    label: "主账号",
    ...extra,
  });
}

/** 某个指标块。 */
function metric(tree: StubElement, attribute: string): StubElement {
  const found = elementsOf(tree).find((element) => element.props["data-usage-metric"] === attribute);
  if (found === undefined) throw new Error(`no metric carries data-usage-metric=${attribute}`);
  return found;
}

it("标题行给出用量、账期区间与口径来源", () => {
  const tree = render();
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("用量");
  expect(texts).toContain("账期 2026/10/14 – 2026/11/14");
  expect(texts).toContain("按厂商重置时间");
  const period = elementsOf(tree).find((element) => element.props["data-usage-period"] !== undefined)!;
  expect(period.props["data-usage-period"]).toBe("2026-10");
  expect(period.props["data-usage-period-source"]).toBe("vendor");
});

it("账期没有厂商重置时间时标注「自然月推算」来源", () => {
  const tree = render({
    period: { kind: "month", key: "2026-10", start: localDay(2026, 10, 1), fromResetAt: false },
  });
  const period = elementsOf(tree).find((element) => element.props["data-usage-period"] !== undefined)!;
  expect(period.props["data-usage-period-source"]).toBe("estimated");
  expect(textsOf(tree).join(" ")).toContain("按自然月推算");
  // 没有终点就只写起点，不编一个结束日期。
  expect(textsOf(tree).join(" ")).toContain("自 2026/10/1 起");
});

it("四个指标块的顺序固定为 请求 / 成功率 / 花费 / Token", () => {
  const tree = render();
  const metrics = elementsOf(tree).filter((element) => element.props["data-usage-metric"] !== undefined);
  expect(metrics.map((element) => element.props["data-usage-metric"])).toEqual([
    "requests",
    "success-rate",
    "cost",
    "tokens",
  ]);
});

it("请求数带成功/失败的小字，成功率按百分比显示", () => {
  const tree = render();
  const requests = metric(tree, "requests");
  expect(textsOf(requests).join(" ")).toContain("2");
  expect(textsOf(requests).join(" ")).toContain("1 成功 / 1 失败");
  // 两位小数精度（用户 2026-10-19 要求）。`1 成功 / 1 失败` = 50.00%。`n  expect(textsOf(metric(tree, "success-rate")).join(" ")).toContain("50.00%");
});

it("大数字用 K/M/B 收窄（一行要塞四个数）", () => {
  const tree = render({
    bucket: bucketOf({ requests: 4_600, ok: 4_600, failed: 0, inputTokens: 2_000_000_000, outputTokens: 100_000_000 }),
  });
  expect(textsOf(metric(tree, "requests")).join(" ")).toContain("4.6K");
  expect(textsOf(metric(tree, "tokens")).join(" ")).toContain("2.1B");
  // 入/出分项也在小字里按同一套单位给。
  expect(textsOf(metric(tree, "tokens")).join(" ")).toContain("2B 入 / 100M 出");
});

it("花费优先用厂商记账金额，官方价折算以小字跟随", () => {
  const tree = render({ spent: 3.2 });
  const cost = metric(tree, "cost");
  expect(textsOf(cost).join(" ")).toContain("$3.20");
  expect(cost.props["data-usage-spent"]).toBe(3.2);
  const hint = elementsOf(cost).find((element) => element.type === "small" && textsOf(element).join(" ").includes("官方价"));
  expect(hint, "官方价必须是一行小字").toBeDefined();
  expect(textsOf(hint!).join(" ")).toContain("$0.42");
});

it("没有厂商金额时退回 token × 厂商单价", () => {
  const tree = render({ bucket: bucketOf({ vendorCost: 1.5, officialCost: undefined }) });
  expect(textsOf(metric(tree, "cost")).join(" ")).toContain("$1.50");
});

it("金额与比率都缺失时显示「未公开」/破折号，绝不显示成 0", () => {
  const tree = render({
    bucket: { period: "p", since: 0 } as never,
  });
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("未公开");
  expect(texts).not.toContain("$0.00");
  expect(texts).not.toContain("NaN");
  expect(textsCached(tree)).not.toContain("%");
});

/** 指标数值区（不含小字）的文本：用来确认比率缺失时没有百分比。 */
function textsCached(tree: StubElement): string {
  return ["requests", "success-rate", "cost", "tokens"]
    .map((attribute) => {
      const values = elementsOf(metric(tree, attribute)).filter((element) => element.type === "span");
      return textsOf(values[0]).join(" ");
    })
    .join(" | ");
}

it("核对用的数收在脚下：命中率、缓存读/写、最近一次请求", () => {
  const at = localDay(2026, 10, 20) + 12 * 3_600_000;
  const tree = render({ lastAt: at }, { now: at + 120_000 });
  const foot = elementsOf(tree).find((element) => element.props["data-usage-foot"] !== undefined)!;
  expect(foot).toBeDefined();
  const footRow = elementsOf(tree).find((element) => element.props.className === "dsl-usage-foot")!;
  expect(textsOf(footRow).join(" ")).toContain("缓存命中率 75.00%");
  expect(textsOf(footRow).join(" ")).toContain("缓存命中 300 · 缓存写入 0");
  expect(textsOf(footRow).join(" ")).toContain("最近一次请求 2 分钟前");
  const last = elementsOf(tree).find((element) => element.props["data-usage-last-at"] !== undefined)!;
  expect(last.props["data-usage-last-at"]).toBe(at);
});

it("没有可核对的数时不画脚下那一行（不留一块空壳）", () => {
  const tree = render({
    bucket: { requests: 1, ok: 1, failed: 0 } as never,
  });
  expect(elementsOf(tree).some((element) => element.props["data-usage-foot"] !== undefined)).toBe(false);
});

it("成功率与命中率按健康度上色：好→绿、差→黄、缺失→灰", () => {
  expect(metric(render(), "success-rate").props["data-tone"]).toBe("warn");
  expect(metric(render({ bucket: bucketOf({ successRate: 0.98 }) }), "success-rate").props["data-tone"]).toBe("ok");
  expect(metric(render({ bucket: bucketOf({ successRate: undefined }) }), "success-rate").props["data-tone"]).toBe("muted");
});

it("账期文案的纯函数：有终点给区间、只有起点给「自…起」、都没有就不给", () => {
  const t = dictionaryOf("zh");
  const start = localDay(2026, 10, 14);
  const end = localDay(2026, 11, 14);
  expect(periodRangeText(t, start, end)).toBe("账期 2026/10/14 – 2026/11/14");
  expect(periodRangeText(t, start, undefined)).toBe("自 2026/10/14 起");
  expect(periodRangeText(t, undefined, undefined)).toBeUndefined();
  expect(periodRangeText(t, "x", null)).toBeUndefined();
});

it("失败过一次就不能显示成 100%（1131 成功 / 1 失败 应显示 99.91%）", () => {
  // 用户 2026-10-19 报障：「先失败了一次，但是我看成功率还是 100%」。
  // 这是整数四舍五入掩盖了失败 —— 现在保留两位小数，差别可见。
  const tree = render({
    bucket: bucketOf({ requests: 1132, ok: 1131, failed: 1, successRate: 1131 / 1132 }),
  });
  const shown = textsOf(metric(tree, "success-rate")).join(" ");
  expect(shown).toContain("99.91%");
  expect(shown).not.toContain("100%");
});

it("真的全成功时才显示 100%（不写 100.00%）", () => {
  const tree = render({ bucket: bucketOf({ requests: 10, ok: 10, failed: 0, successRate: 1 }) });
  const shown = textsOf(metric(tree, "success-rate")).join(" ");
  expect(shown).toContain("100%");
  expect(shown).not.toContain("100.00%");
});
