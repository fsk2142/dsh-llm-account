/**
 * 搜索卡的密钥管理界面。
 *
 * 需求：「建议只保留保存密钥那个，没添加一个就自动显示添加了一个，然后还可以点x删除
 * 已经添加的」。
 *
 * 所以界面上**不再有「引用名」输入框**：只留一个密钥输入 + 添加按钮，
 * 下面是已添加的列表（每条带 × 删除）。
 *
 * 引用名仍存在设置文档里（`searchApiKeyRefs`），但由「添加/删除」动作维护 ——
 * 用户不需要知道它叫什么。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState } from "../../src/client/page-state";
import { VENDORS } from "../../src/client/shell";
import type { StubElement } from "../support/react-stub";

const t = dictionaryOf("zh");

/** 三家设置快照（功能页借用承载行）。 */
function snapshots(value: Record<string, unknown> = {}) {
  return [
    { ns: "llm-commandcode", row: "llm-commandcode", value, revision: 1 },
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

/** 渲染页面（带搜索密钥能力）。 */
function render(value: Record<string, unknown> = {}, props: Record<string, unknown> = {}): StubElement[] {
  return elementsOf(
    PageShell({
      state: createPageState(VENDORS, snapshots(value)),
      entries: VENDORS,
      t,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
      onSaveSecret: async () => undefined,
      onRemoveSecret: () => undefined,
      ...props,
    }),
  );
}

describe("密钥输入", () => {
  it("只有一个密码框 + 添加按钮（不再有引用名输入框）", () => {
    const all = render();
    const inputs = all.filter((element) => element.props["data-secret-input"] !== undefined);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.props.type).toBe("password");
    expect(all.some((element) => element.props["data-secret-add"] !== undefined)).toBe(true);
  });

  it("界面上不再出现「引用名」这个设置字段", () => {
    const all = render();
    expect(all.some((element) => element.props["data-field"] === "searchApiKeyRefs")).toBe(false);
  });
});

describe("已添加的列表", () => {
  it("一条都没有时显示空态（不是一片空白）", () => {
    const all = render({ searchApiKeyRefs: [] });
    expect(all.some((element) => element.props["data-secret-empty"] !== undefined)).toBe(true);
  });

  it("有两条时列表里就有两行，且各自带 × 删除", () => {
    const all = render(
      { searchApiKeyRefs: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"] },
      { credentialStatus: { DEEPSEEK_API_KEY: true, DEEPSEEK_API_KEY_2: true } },
    );
    const rows = all.filter((element) => element.props["data-secret-row"] !== undefined);
    expect(rows.map((row) => row.props["data-secret-row"])).toEqual([
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_API_KEY_2",
    ]);
    const removes = all.filter((element) => element.props["data-secret-remove"] !== undefined);
    expect(removes.map((element) => element.props["data-secret-remove"])).toEqual([
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_API_KEY_2",
    ]);
  });

  it("每行显示状态：已添加 / 未添加", () => {
    const all = render(
      { searchApiKeyRefs: ["A_KEY", "B_KEY"] },
      { credentialStatus: { A_KEY: true, B_KEY: false } },
    );
    const rows = all.filter((element) => element.props["data-secret-row"] !== undefined);
    const textOf = (node: unknown): string =>
      elementsOf(node)
        .map((element) => String(element.props.children ?? ""))
        .join(" ");
    expect(textOf(rows[0])).toContain(t("search.keyConfigured"));
    expect(textOf(rows[1])).toContain(t("search.keyMissing"));
  });

  it("点 × 会带着引用名回调删除", () => {
    const removed: string[] = [];
    const all = render(
      { searchApiKeyRefs: ["A_KEY"] },
      { onRemoveSecret: (ref: string) => removed.push(ref) },
    );
    const button = all.find((element) => element.props["data-secret-remove"] !== undefined)!;
    (button.props.onClick as () => void)();
    expect(removed).toEqual(["A_KEY"]);
  });
});
