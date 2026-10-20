/**
 * 「清空台账」入口（2026-10-20 审计发现它已经消失）。
 *
 * 远程方法 `usageClear` 一直在，但界面入口在某次删卡片时被连带砍掉，两条文案
 * （`usage.clear` / `usage.clearConfirm`）的消费者数量降到 0 —— 用户没有任何办法清空历史，
 * 想重开统计只能自己去删文件。
 *
 * 界面纪律（沿用项目既有做法）：
 * 1. **必须二次确认**：不可撤销的破坏性动作，一次点击不该生效；
 * 2. 没有清空能力（老宿主）时整个按钮不渲染，而不是留一个点了没反应的入口；
 * 3. 失败要说出原因（静默失败会让人以为清掉了）。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { UsageClearButton } from "../../src/client/failure-list";
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

/** 按 data 属性找元素。 */
function findByAttr(tree: unknown, attribute: string, value?: string): StubElement | undefined {
  return elementsOf(tree).find((element) => {
    const actual = (element.props as Record<string, unknown>)[attribute];
    return value === undefined ? actual !== undefined : actual === value;
  });
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

describe("清空台账入口", () => {
  it("没有清空能力时不渲染（老宿主不留死按钮）", () => {
    expect(UsageClearButton({ t, onClear: undefined })).toBeNull();
  });

  it("点了先要确认，不立刻清空（不可撤销的动作）", () => {
    let confirmed = 0;
    let requested = 0;
    const tree = UsageClearButton({
      t,
      onClear: () => (confirmed += 1),
      onRequestConfirm: () => (requested += 1),
    });
    const trigger = findByAttr(tree, "data-usage-clear")!;
    expect(trigger).toBeDefined();
    // 第一下只展开确认，不调用清空。
    (trigger.props.onClick as () => void)();
    expect(confirmed).toBe(0);
    expect(requested).toBe(1);
  });

  it("确认态里写着「不可撤销」（用的就是已有的 usage.clearConfirm 文案）", () => {
    const tree = UsageClearButton({ t, onClear: () => {}, confirming: true });
    expect(textsOf(tree).join(" ")).toContain("不可撤销");
  });

  it("确认按钮挂在自己的 data 属性上（确认后才真的调用）", () => {
    let confirmed = 0;
    const tree = UsageClearButton({ t, onClear: () => (confirmed += 1), confirming: true });
    const confirm = findByAttr(tree, "data-usage-clear-confirm")!;
    expect(confirm).toBeDefined();
    (confirm.props.onClick as () => void)();
    expect(confirmed).toBe(1);
  });

  it("取消能收起确认（不调用清空）", () => {
    let confirmed = 0;
    let cancelled = 0;
    const tree = UsageClearButton({
      t,
      onClear: () => (confirmed += 1),
      onCancel: () => (cancelled += 1),
      confirming: true,
    });
    (findByAttr(tree, "data-usage-clear-cancel")!.props.onClick as () => void)();
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);
  });

  it("清空中按钮禁用（避免连点重复发请求）", () => {
    const tree = UsageClearButton({ t, onClear: () => {}, busy: true });
    const trigger = findByAttr(tree, "data-usage-clear")!;
    expect(trigger.props.disabled).toBe(true);
  });
});
