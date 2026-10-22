/**
 * 版本漂移提示框（`apply` 路径上的自建覆盖层）。
 *
 * 它挂在插件最外层入口上，所以两条纪律必须钉住：
 * 1. **没有 DOM 时是空操作** —— 抛错会连累整页；
 * 2. **只弹一次** —— 两行各调一次 `apply`，重复弹会盖两层。
 */
import { describe, expect, it, vi } from "vitest";

import { resetDriftNoticeForTest, showDriftNotice } from "../../src/client/drift-notice";

const TEXT = { title: "插件已更新", body: "当前运行 0.7.3，磁盘已是 0.7.4。", reload: "立即刷新", later: "稍后" };

/** 一个足够用的假 DOM。 */
function fakeDom(): {
  document: unknown;
  appended: { id: string; className: string; children: unknown[]; text: string; removed: boolean }[];
  bodyContains: { value: boolean };
} {
  const appended: { id: string; className: string; children: unknown[]; text: string; removed: boolean }[] = [];
  const bodyContains = { value: false };

  const makeElement = (tag: string): unknown => {
    const handlers: Record<string, (() => void) | undefined> = {};
    const node = {
      tag,
      id: "",
      className: "",
      style: {} as Record<string, string>,
      textContent: "",
      children: [] as unknown[],
      handlers,
      removed: false,
      setAttribute() {
        // 属性对断言不重要。
      },
      appendChild(child: unknown) {
        node.children.push(child);
        return child;
      },
      addEventListener(type: string, handler: () => void) {
        handlers[type] = handler;
      },
      remove() {
        node.removed = true;
      },
    };
    // 顶层节点记录到 appended 里，便于断言。
    appended.push(node as never);
    return node;
  };

  const document = {
    body: {
      appendChild: (node: unknown) => {
        bodyContains.value = true;
        return node;
      },
    },
    createElement: makeElement,
    getElementById: () => null,
  };

  return { document, appended, bodyContains };
}

describe("版本漂移提示框", () => {
  it("**没有 document 时是空操作、不抛错**（apply 路径不能炸）", () => {
    const previous = (globalThis as { document?: unknown }).document;
    delete (globalThis as { document?: unknown }).document;
    try {
      expect(() => showDriftNotice(TEXT, vi.fn())).not.toThrow();
      expect(showDriftNotice(TEXT, vi.fn())).toBeUndefined();
    } finally {
      if (previous !== undefined) (globalThis as { document?: unknown }).document = previous;
    }
  });

  it("有 DOM 时挂上一个提示，并返回句柄", () => {
    resetDriftNoticeForTest();
    const dom = fakeDom();
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = dom.document;
    try {
      const handle = showDriftNotice(TEXT, vi.fn());
      expect(handle).toBeDefined();
      expect(dom.bodyContains.value).toBe(true);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  });

  it("**只弹一次**（两行各调一次 apply 不会叠两层）", () => {
    resetDriftNoticeForTest();
    const dom = fakeDom();
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = dom.document;
    try {
      const first = showDriftNotice(TEXT, vi.fn());
      const second = showDriftNotice(TEXT, vi.fn());
      expect(first).toBeDefined();
      expect(second).toBeUndefined();
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  });

  it("句柄能关掉它", () => {
    resetDriftNoticeForTest();
    const dom = fakeDom();
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = dom.document;
    try {
      const handle = showDriftNotice(TEXT, vi.fn());
      expect(() => handle?.dismiss()).not.toThrow();
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  });
});
