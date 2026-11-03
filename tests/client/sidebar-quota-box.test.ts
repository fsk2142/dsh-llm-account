import { describe, expect, it } from "vitest";

import { SidebarCard } from "../../src/client/sidebar-card";

/**
 * 额度改成**圆角矩形卡片**（2026-11-03 需求）。
 *
 * > 如果改成两个圆角矩形，圆角矩形上方是额度信息，内部是剩余额度信息和下次重置时间
 * > 对，但是 5 小时还有每周要和圆角矩形的中心对齐
 *
 * 版式：每格纵向排列 —— 档位名（居中于矩形）→ 矩形（内含剩余百分比 + 重置时间）。
 *
 * 矩形取代了原来的圆环：**弧长没有了**，比例只剩「数字 + 档位色」两个信号。
 * 这是用户明确选定的取舍，测试据此断言（不再有弧）。
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
};

const t = (key: string): string =>
  ({
    "vendor.opencodeGo": "OpenCode",
    "quota.window.fiveHour": "5 小时",
    "quota.window.weekly": "每周",
    "quota.remaining": "剩余 {percent}%",
    "quota.unlimited": "不限",
    "account.quotaMissing": "暂无额度数据",
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

/** 取出某档的矩形卡片（`data-sidebar-box`）。 */
function boxOf(tree: StubElement, key: string): StubElement | undefined {
  return elementsOf(tree).find((element) => element.props["data-sidebar-box"] === key);
}

const RESET_AT = Date.UTC(2026, 10, 19, 12, 0);

describe("额度圆角矩形卡片", () => {
  it("每档都有一个圆角矩形（`data-sidebar-box`）", () => {
    const tree = cardWith([
      { key: "5h", percent: 4, resetAt: RESET_AT },
      { key: "weekly", percent: 50, resetAt: RESET_AT },
    ]);
    expect(boxOf(tree, "5h"), "5 小时档要有矩形").toBeDefined();
    expect(boxOf(tree, "weekly"), "每周档要有矩形").toBeDefined();
  });

  it("**矩形内部同时有剩余百分比与重置时间**", () => {
    const tree = cardWith([{ key: "5h", percent: 4, resetAt: RESET_AT }]);
    const box = boxOf(tree, "5h")!;
    const text = textsOf(box).join(" ");
    expect(text, "剩余百分比在矩形里").toContain("96");
    // 重置时间也必须在矩形内部（不是在矩形外面单独一行）。
    expect(
      elementsOf(box).find((element) => element.props["data-sidebar-reset"] !== undefined),
      "重置时间应在矩形内部",
    ).toBeDefined();
  });

  it("**档位名在矩形之上**，不在矩形内部", () => {
    const tree = cardWith([{ key: "5h", percent: 4, resetAt: RESET_AT }]);
    const cell = elementsOf(tree).find((element) => element.props["data-sidebar-window"] === "5h")!;
    const ordered = elementsOf(cell).filter(
      (element) =>
        String(element.props.className ?? "").includes("dsl-sidebar-window-label") ||
        element.props["data-sidebar-box"] !== undefined,
    );
    expect(ordered.length, "应当有标签与矩形各一个").toBe(2);
    expect(ordered[0]!.props["data-sidebar-box"], "标签在前（矩形上方）").toBeUndefined();
    expect(ordered[1]!.props["data-sidebar-box"], "矩形在后").toBe("5h");
    // 标签不在矩形内部：矩形的子树里不该出现标签类名。
    expect(
      elementsOf(ordered[1]!).some((element) =>
        String(element.props.className ?? "").includes("dsl-sidebar-window-label"),
      ),
      "标签不能掉进矩形里",
    ).toBe(false);
  });

  it("**不再有圆环弧**（矩形取代圆环）", () => {
    const tree = cardWith([{ key: "5h", percent: 4, resetAt: RESET_AT }]);
    expect(
      elementsOf(tree).some((element) => element.type === "circle"),
      "不应该再有 SVG 圆弧",
    ).toBe(false);
  });

  it("「不限」写「不限」，不写假的百分比", () => {
    const tree = cardWith([{ key: "5h", unlimited: true }]);
    expect(textsOf(boxOf(tree, "5h")).join(" ")).toContain("不限");
  });

  it("**读不到时不猜 0%**", () => {
    const tree = cardWith([{ key: "5h" }]);
    const text = textsOf(boxOf(tree, "5h")).join(" ");
    expect(text, "不能写 0%").not.toContain("0%");
    expect(text, "不能写 100%").not.toContain("100%");
  });
});

/** 取矩形里那条「剩余比例」描边（带 strokeDashoffset 的 rect）。 */
function progressOf(box: StubElement | undefined): StubElement | undefined {
  return elementsOf(box).find(
    (element) => element.type === "rect" && element.props["strokeDashoffset"] !== undefined,
  );
}

/**
 * 边框**按剩余比例逐渐消失**（2026-11-03 需求）。
 *
 * > 圆角矩形太细了，能不能做成按照百分比逐渐消失，和圆环那种效果差不多
 *
 * 与圆环同源：周长 P 作 stroke-dasharray，dashoffset = P × (1 − 剩余/100)，
 * 所以描出的那段边框正好等于剩余比例。这里盯**几何**，不只盯文本 ——
 * 字符串断言抓不到「框永远画满」这类回退。
 */
describe("矩形边框按剩余比例逐渐消失", () => {
  it("剩余 100% → dashoffset 为 0（整圈都在）", () => {
    const tree = cardWith([{ key: "5h", percent: 0, resetAt: RESET_AT }]);
    const progress = progressOf(boxOf(tree, "5h"));
    expect(progress, "必须有按比例绘制的边框").toBeDefined();
    expect(Number(progress!.props["strokeDashoffset"])).toBeCloseTo(0, 4);
  });

  it("剩余 50% → dashoffset 是周长的一半", () => {
    const tree = cardWith([{ key: "5h", percent: 50, resetAt: RESET_AT }]);
    const progress = progressOf(boxOf(tree, "5h"))!;
    const perimeter = Number(progress.props["strokeDasharray"]);
    expect(perimeter).toBeGreaterThan(0);
    expect(Number(progress.props["strokeDashoffset"])).toBeCloseTo(perimeter / 2, 4);
  });

  it("剩余 0% → dashoffset 等于周长（一点都不画）", () => {
    const tree = cardWith([{ key: "5h", percent: 100, resetAt: RESET_AT }]);
    const progress = progressOf(boxOf(tree, "5h"))!;
    const perimeter = Number(progress.props["strokeDasharray"]);
    expect(Number(progress.props["strokeDashoffset"])).toBeCloseTo(perimeter, 4);
  });

  it("**读不到时不画进度边框**（缺失不等于 0%）", () => {
    const tree = cardWith([{ key: "5h" }]);
    expect(progressOf(boxOf(tree, "5h")), "没有百分比时不能描边").toBeUndefined();
  });

  it("「不限」时不画进度边框（没有比例可言）", () => {
    const tree = cardWith([{ key: "5h", unlimited: true }]);
    expect(progressOf(boxOf(tree, "5h"))).toBeUndefined();
  });
});
