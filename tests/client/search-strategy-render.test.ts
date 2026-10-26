/**
 * 搜索设置卡要**真的渲染出「搜索方式」下拉**。
 *
 * 上一层测试只保证「卡片声明的字段名与厂商声明一致」；这一层再往前走一步：
 * 真的渲染页面，确认那个 `<select>` 出现在搜索卡里，且四个选项齐全。
 *
 * 为什么值得单独测：字段名对上只说明「能被找到」，控件种类（`kind: "select"`）与选项
 * 是否写对，仍然可能让用户看到一个空下拉或者根本没有下拉。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState } from "../../src/client/page-state";
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
function render(): StubElement[] {
  return elementsOf(
    PageShell({
      state: createPageState(VENDORS, snapshots()),
      entries: VENDORS,
      t,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
      // 密钥管理块只在宿主支持写凭据时渲染（老宿主不显示死按钮）。
      onSaveSecret: async () => undefined,
      onRemoveSecret: () => undefined,
    }),
  );
}

describe("搜索设置卡里的控件", () => {
  it("「搜索方式」真的渲染出来了（不是只有声明）", () => {
    const all = render();
    const field = all.find((element) => element.props["data-field"] === "searchStrategy");
    expect(field, "searchStrategy 字段应该出现在页面上").toBeDefined();
  });

  it("它是个下拉（select），不是布尔开关或文本框", () => {
    const all = render();
    const control = all.find((element) => element.props["data-field-input"] === "searchStrategy");
    expect(control, "搜索方式应该有控件").toBeDefined();
    expect(control?.type).toBe("select");
  });

  it("四个选项齐全：网关优先 / API 优先 / 只用网关 / 只用 API", () => {
    const all = render();
    const control = all.find((element) => element.props["data-field-input"] === "searchStrategy");
    const options = elementsOf(control).filter((element) => element.type === "option");
    expect(options.map((option) => option.props.value)).toEqual([
      "gateway-first",
      "api-first",
      "gateway-only",
      "api-only",
      // 需求：下拉里要有「不使用网页搜索」。
      "off",
    ]);
  });

  it("两张与「搜索走哪条路」有关的项都在同一张卡里（搜索方式 + 密钥管理）", () => {
    const all = render();
    const searchCard = all.find((element) => element.props["data-card"] === "search");
    expect(searchCard).toBeDefined();
    const inside = elementsOf(searchCard);
    const fields = inside
      .filter((element) => element.props["data-field"] !== undefined)
      .map((element) => element.props["data-field"]);
    expect(fields).toContain("searchStrategy");
    // 密钥列表不是设置字段，而是卡片里挂的「密钥管理」块。
    expect(inside.some((element) => element.props["data-secret-block"] !== undefined)).toBe(true);
  });

  it("选项文案是可读的人话（不是键名）", () => {
    const all = render();
    const control = all.find((element) => element.props["data-field-input"] === "searchStrategy");
    const options = elementsOf(control).filter((element) => element.type === "option");
    for (const option of options) {
      const label = String(option.props.children ?? "");
      expect(label).not.toBe("");
      // 键名会以 `options.` 开头，说明词典里缺这一条。
      expect(label.startsWith("options."), `${option.props.value} 缺文案`).toBe(false);
    }
  });
});
