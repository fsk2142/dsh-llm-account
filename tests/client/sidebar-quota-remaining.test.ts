import { describe, expect, it } from "vitest";

import { SidebarCard } from "../../src/client/sidebar-card";

/**
 * 侧边栏额度行显示「剩余多少」（2026-11-03 需求）。
 *
 * > 侧边栏这里两个额度的状态条后边加上剩余多少吧，不然每次我都要点进去看具体的剩余额度
 *
 * 现状：状态条只在**视觉上**表达比例，读屏靠 `aria-label`，但肉眼看不到数字 ——
 * 想知道具体剩余必须点开中栏。这里把剩余百分比作为可见文本补在条后面。
 *
 * 口径与展开面板一致（都用百分比）：侧边栏只拿到 `QuotaWindow`，没有模型与套餐信息，
 * 算不出美元金额；而展开面板显示的也是百分比，两处对得上。
 */
interface StubElement {
  type: unknown;
  props: Record<string, unknown>;
  children?: unknown[];
}

function elementsOf(node: unknown): StubElement[] {
  const out: StubElement[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const element = value as StubElement;
    if (element.props !== undefined && typeof element.props === "object") {
      out.push(element);
      for (const child of element.children ?? []) walk(child);
      const props = element.props as Record<string, unknown>;
      if (props.children !== undefined) walk(props.children);
    }
  };
  walk(node);
  return out;
}

function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const element = value as StubElement;
    for (const child of element.children ?? []) walk(child);
    const props = element.props as Record<string, unknown>;
    if (props.children !== undefined) walk(props.children);
  };
  walk(node);
  return out;
}

const t = (key: string): string =>
  ({
    "vendor.opencodeGo": "OpenCode",
    "sidebar.usagePeriod": "用量周期",
    "sidebar.resetTime": "重置时间",
    "quota.window.fiveHour": "5 小时",
    "quota.window.weekly": "每周",
    "quota.remaining": "剩余 {percent}%",
    "quota.usedPercent": "已用 {percent}%",
    "quota.unlimited": "不限",
    "account.quotaMissing": "读不到",
    "quota.resetUnknown": "未知",
  })[key] ?? key;

function cardWith(windows: readonly Record<string, unknown>[]): StubElement {
  return SidebarCard({
    t,
    status: {
      vendor: "dsh-opencode-go",
      capabilities: {},
      pinned: null,
      failures: [],
      accounts: [
        {
          ref: "acc",
          label: "Default",
          effective: true,
          configured: true,
          active: true,
          quota: { windows: [...windows] as never, failures: [] },
        },
      ],
    } as never,
    onOpen: () => {},
  }) as unknown as StubElement;
}

const FIVE_HOUR_RESET = Date.UTC(2026, 10, 4, 3, 0);

describe("侧边栏额度行显示剩余百分比", () => {
  it("**每档条后面都有可见的「剩余 X%」**", () => {
    const tree = cardWith([
      { key: "5h", percent: 20, resetAt: FIVE_HOUR_RESET },
      { key: "weekly", percent: 50, resetAt: FIVE_HOUR_RESET },
    ]);
    const rows = elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined);
    expect(rows.length).toBe(2);
    // 未用 20% → 剩 80%；未用 50% → 剩 50%。
    const first = elementsOf(rows[0]).find((element) => element.props["data-sidebar-value"] !== undefined);
    const second = elementsOf(rows[1]).find((element) => element.props["data-sidebar-value"] !== undefined);
    expect(first, "第一档必须有可见的剩余值").toBeDefined();
    expect(textsOf(first).join("")).toContain("80");
    expect(second, "第二档同样").toBeDefined();
    expect(textsOf(second).join("")).toContain("50");
  });

  it("剩余值不是 0/100 这两个边界时才谈得上「具体」（92% 要原样显示）", () => {
    const tree = cardWith([{ key: "5h", percent: 8, resetAt: FIVE_HOUR_RESET }]);
    const row = elementsOf(tree).find((element) => element.props["data-sidebar-window"] !== undefined)!;
    const value = elementsOf(row).find((element) => element.props["data-sidebar-value"] !== undefined);
    expect(textsOf(value).join("")).toContain("92");
  });

  it("「不限」时写「不限」，不写一个假的百分比", () => {
    const tree = cardWith([{ key: "5h", unlimited: true }]);
    const row = elementsOf(tree).find((element) => element.props["data-sidebar-window"] !== undefined)!;
    const value = elementsOf(row).find((element) => element.props["data-sidebar-value"] !== undefined);
    expect(value, "不限也要有可见文本").toBeDefined();
    expect(textsOf(value).join("")).toContain("不限");
  });

  it("**读不到时不猜成 0%**（缺失与 0 是两回事）", () => {
    const tree = cardWith([{ key: "5h" }]);
    const row = elementsOf(tree).find((element) => element.props["data-sidebar-window"] !== undefined)!;
    const value = elementsOf(row).find((element) => element.props["data-sidebar-value"] !== undefined);
    expect(value).toBeDefined();
    const text = textsOf(value).join("");
    expect(text, "不能凭空写 0%").not.toContain("0%");
    expect(text, "不能凭空写 100%").not.toContain("100%");
    expect(text).toContain("读不到");
  });
});

describe("圆环的几何：弧长必须反映剩余比例", () => {
  /**
   * 只断言「有文本」不够 —— 弧画错（永远画满、或缺失时画成 0%）时文本仍然对。
   * 这里直接盯 `stroke-dashoffset`：它决定画出多长的一段弧。
   */
  function arcOf(remaining: number | undefined, level: "ok" | "warn" | "error" | "unlimited" | "missing" = "ok") {
    const tree = cardWith([
      { key: "5h", ...(remaining === undefined ? {} : { percent: 100 - remaining }) },
    ]);
    const ring = elementsOf(tree).find((element) => element.props["data-sidebar-track"] !== undefined)!;
    const circle = elementsOf(ring).find(
      (element) => element.type === "circle" && element.props["strokeDashoffset"] !== undefined,
    );
    return { ring, circle, level };
  }

  it("剩余 100% → dashoffset 为 0（整圈都画）", () => {
    const { circle } = arcOf(100) as { circle: StubElement };
    expect(circle, "必须有弧").toBeDefined();
    expect(Number(circle.props["strokeDashoffset"])).toBeCloseTo(0, 5);
  });

  it("剩余 50% → dashoffset 是周长的一半", () => {
    const { circle } = arcOf(50) as { circle: StubElement };
    const circumference = Number(circle.props["strokeDasharray"]);
    expect(circumference).toBeGreaterThan(0);
    expect(Number(circle.props["strokeDashoffset"])).toBeCloseTo(circumference / 2, 5);
  });

  it("剩余 0% → dashoffset 等于整个周长（一点都不画）", () => {
    const { circle } = arcOf(0) as { circle: StubElement };
    const circumference = Number(circle.props["strokeDasharray"]);
    expect(Number(circle.props["strokeDashoffset"])).toBeCloseTo(circumference, 5);
  });

  it("**读不到时不画弧**（缺失 ≠ 0%）", () => {
    const { circle } = arcOf(undefined);
    expect(circle, "没有百分比时不能描弧").toBeUndefined();
  });
});
