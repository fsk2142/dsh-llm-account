/**
 * 改了就存 + 卡片内保存（2026-10-20 用户要求，两轮收敛后）。
 *
 * 用户原话（第一轮）：「任何选项修改了就是直接保存，不需要那个保存按钮了，除非是需要填写什么东西的
 * 逻辑，然后再对应的卡片中显示保存就可以，不需要在最下面保留那个保存按钮了」。
 * 用户原话（第二轮）：「不用那个填入了，一个卡片保留一个保存按钮，点完保存后按钮消失，
 * 如果复原则不显示保存」。
 *
 * 所以最终形状是：
 * 1. 开关/下拉 —— 一次点击就是完整决定，改了就落盘，**不产生草稿**，因此保存按钮不出现；
 * 2. 文本/数字/时长 —— 留在草稿里，**该卡片底部**出现保存按钮；存完按钮消失；
 *    用户把值改回原样，草稿条目被删掉，按钮同样不出现；
 * 3. 页面底部**永远**没有保存条。
 *
 * 本文件钉住**页面层**（纯 props → 元素树）的事实；「点了立刻落盘」由容器保证，
 * 在 `autosave-container.test.ts` 里验。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState, setField } from "../../src/client/page-state";
import { VENDORS } from "../../src/client/shell";
import type { StubElement } from "../support/react-stub";

const t = dictionaryOf("zh");

/** 三家设置快照。 */
function snapshots() {
  return [
    { ns: "llm-commandcode", row: "llm-commandcode", value: {}, revision: 1 },
    { ns: "llm-opencode-go", row: "opencode-go", value: {}, revision: 1 },
    { ns: "llm-opendesign", row: "opendesign", value: {}, revision: 1 },
  ];
}

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 渲染页面。 */
function render(state = createPageState(VENDORS, snapshots()), extra: Record<string, unknown> = {}): StubElement[] {
  return elementsOf(
    PageShell({
      state,
      entries: VENDORS,
      t,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
      onSaveSecret: async () => undefined,
      onRemoveSecret: () => undefined,
      ...extra,
    }),
  );
}

/** 卡片里的保存按钮（`data-save="<ns>"`）。 */
function saveButtons(all: StubElement[], ns?: string): StubElement[] {
  return all.filter((element) =>
    ns === undefined ? element.props["data-save"] !== undefined : element.props["data-save"] === ns,
  );
}

describe("页面底部没有保存条", () => {
  it("干净的页面没有任何保存按钮", () => {
    expect(saveButtons(render())).toHaveLength(0);
    expect(render().some((element) => element.props["data-save-bar"] !== undefined)).toBe(false);
  });

  it("拨开关（改了就存）**不**点亮保存按钮", () => {
    // 开关类改了就落盘，草稿被容器立刻消化；这里模拟的正是「草稿阶段」不该存在的状态：
    // 即便草稿里真有它，保存按钮也不该由开关点亮（判据是控件种类，不是脏不脏）。
    const state = setField(createPageState(VENDORS, snapshots()), "llm-commandcode", "showSidebarQuota", true);
    expect(saveButtons(render(state))).toHaveLength(0);
  });

  it("改输入框（apiBase）→ 那张卡片底部出现保存按钮", () => {
    const state = setField(createPageState(VENDORS, snapshots()), "llm-commandcode", "apiBase", "https://b.example");
    const buttons = saveButtons(render(state), "llm-commandcode");
    expect(buttons).toHaveLength(1);
    // 按钮只属于承载这个字段的那张卡（apiBase 在「高级设置」里）。
    const bar = render(state).find((element) => element.props["data-card-save"] !== undefined);
    expect(bar?.props["data-card-save"]).toBe("advanced");
  });

  it("把输入改回原值 → 保存按钮消失（草稿条目被删掉）", () => {
    let state = setField(createPageState(VENDORS, snapshots()), "llm-commandcode", "apiBase", "https://b.example");
    expect(saveButtons(render(state))).toHaveLength(1);
    // 改回与已存储值相同：`setField` 按约定删掉草稿条目。
    state = setField(state, "llm-commandcode", "apiBase", undefined);
    expect(saveButtons(render(state))).toHaveLength(0);
  });

  it("保存中显示「保存中…」并禁用，避免连点存两份", () => {
    const state = setField(createPageState(VENDORS, snapshots()), "llm-commandcode", "apiBase", "https://b.example");
    const [button] = saveButtons(render(state, { savingNs: "llm-commandcode" }), "llm-commandcode");
    expect(button!.props.disabled).toBe(true);
  });

  it("未保存的输入在字段上留标记（否则用户不知道按钮管哪几个字段）", () => {
    const state = setField(createPageState(VENDORS, snapshots()), "llm-commandcode", "apiBase", "https://b.example");
    const field = render(state).find((element) => element.props["data-field"] === "apiBase");
    expect(field?.props["data-field-pending"]).toBe("true");
  });
});

describe("保存失败原因", () => {
  it("挂在卡片里，且不静默", () => {
    const state = {
      ...createPageState(VENDORS, snapshots()),
      saveErrors: { "llm-commandcode": "boom" },
    };
    const all = render(state as never);
    const error = all.find((element) => element.props["data-save-error"] === "llm-commandcode");
    expect(error?.props["data-save-error-reason"]).toBe("boom");
  });

  it("同一条错误不会在四张卡里各印一遍", () => {
    const state = {
      ...createPageState(VENDORS, snapshots()),
      saveErrors: { "llm-commandcode": "boom" },
    };
    const all = render(state as never);
    // 只出现在承载了 commandcode 字段的卡里；四张卡全印一遍会让用户以为四处都坏了。
    expect(all.filter((element) => element.props["data-save-error"] !== undefined)).toHaveLength(1);
  });
});
