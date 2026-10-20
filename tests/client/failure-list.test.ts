/**
 * 失败明细那一块（`FailureKindList`）与导出按钮（`UsageExportButton`）。
 *
 * 用户选的第 1 项：台账早就记了 `failureKind`，但界面从来没有读过它 —— 只有一个成功率
 * 百分比，报障时无从判断是网络抖动、限额，还是凭据失效。
 *
 * 三条界面纪律（与项目其余部分一致）：
 * 1. **一条失败都没有就整块不渲染**（不画「失败 0 次」那种行）；
 * 2. 分类名必须走已有的 `rejection.<kind>` 文案，认不出的分类**原样显示**（不吞掉、不编一个）；
 * 3. 数量与时间都来自台账，不做估算。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { FailureKindList, UsageExportButton } from "../../src/client/failure-list";
import type { StubElement } from "../support/react-stub";

const t = dictionaryOf("zh");

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

/** 渲染一棵树并取全部文本。 */
function render(props: Parameters<typeof FailureKindList>[0]): string {
  return textsOf(FailureKindList(props)).join(" ");
}

/** 按 data 属性找元素。 */
function findByAttr(tree: unknown, attribute: string, value?: string): StubElement | undefined {
  return elementsOf(tree).find((element) => {
    const actual = (element.props as Record<string, unknown>)[attribute];
    return value === undefined ? actual !== undefined : actual === value;
  });
}

describe("失败明细", () => {
  it("没有失败时返回 null（整块不渲染，不画「失败 0 次」）", () => {
    expect(FailureKindList({ t, rows: [] })).toBeNull();
  });

  it("已知分类走已有的 rejection.* 文案", () => {
    const text = render({ t, rows: [{ kind: "network", count: 8, lastAt: 1_000, lastAccount: "acc-1" }] });
    expect(text).toContain("网络错误");
    expect(text).toContain("8");
  });

  it("认不出的分类原样显示（不吞掉、也不编一个中文名）", () => {
    const text = render({ t, rows: [{ kind: "some-new-kind", count: 2, lastAt: 1_000, lastAccount: "acc-1" }] });
    expect(text).toContain("some-new-kind");
  });

  it("多行按传入顺序渲染（聚合层已经排好序，界面不再重排）", () => {
    const text = render({
      t,
      rows: [
        { kind: "network", count: 5, lastAt: 2_000, lastAccount: "a" },
        { kind: "quota", count: 1, lastAt: 1_000, lastAccount: "b" },
      ],
    });
    expect(text.indexOf("网络错误")).toBeLessThan(text.indexOf("额度"));
  });

  it("每行挂 data 属性（便于排查与测试定位具体分类）", () => {
    const tree = FailureKindList({ t, rows: [{ kind: "network", count: 3, lastAt: 1_000, lastAccount: "a" }] });
    expect(findByAttr(tree, "data-failure-kind", "network")).toBeDefined();
  });
});

describe("导出按钮", () => {
  it("有导出能力时显示按钮，点击触发回调", () => {
    let clicked = 0;
    const tree = UsageExportButton({ t, onExport: () => (clicked += 1) });
    const button = findByAttr(tree, "data-usage-export");
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)();
    expect(clicked).toBe(1);
  });

  it("没有导出能力时返回 null（老宿主不显示一个点了没反应的按钮）", () => {
    expect(UsageExportButton({ t, onExport: undefined })).toBeNull();
  });

  it("导出进行中按钮禁用并换文案（避免连点导出两份）", () => {
    const tree = UsageExportButton({ t, onExport: () => {}, busy: true });
    const button = findByAttr(tree, "data-usage-export")!;
    expect(button.props.disabled).toBe(true);
    expect(textsOf(tree).join(" ")).toContain("导出中");
  });
});
