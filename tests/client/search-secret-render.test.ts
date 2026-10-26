/**
 * 搜索卡的密钥管理。
 *
 * 需求：「建议只保留保存密钥那个，没添加一个就自动显示添加了一个，然后还可以点x删除
 * 已经添加的」。
 *
 * 最终形状：**密码框 + 添加按钮 + 已添加列表（每条带 ×）**。
 * 「引用名」不再是用户填的字段 —— 由添加动作自动分配（`nextKeyRef`）。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState, FEATURE_TAB_NS } from "../../src/client/page-state";
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

/** 渲染页面；`props` 可覆盖密钥相关的回调。 */
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

/** 树里的全部文本。 */
function textOf(node: unknown): string {
  return elementsOf(node)
    .map((element) => (typeof element.props.children === "string" ? element.props.children : ""))
    .join(" ");
}

describe("密钥输入", () => {
  it("只有一个密码框（密钥不明文显示）", () => {
    const inputs = render().filter((element) => element.props["data-secret-input"] !== undefined);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.props.type).toBe("password");
  });

  it("有「添加密钥」按钮", () => {
    expect(render().some((element) => element.props["data-secret-add"] !== undefined)).toBe(true);
  });

  it("输入框不带 data-field（否则会与设置草稿共用通道）", () => {
    const input = render().find((element) => element.props["data-secret-input"] !== undefined)!;
    expect(input.props["data-field"]).toBeUndefined();
  });

  it("宿主不支持写凭据时整块不渲染（老宿主不留死按钮）", () => {
    const all = elementsOf(
      PageShell({
        state: createPageState(VENDORS, snapshots()),
        entries: VENDORS,
        t,
        onSelectTab: () => undefined,
        onSetField: () => undefined,
        onSave: () => undefined,
      }),
    );
    expect(all.some((element) => element.props["data-secret-input"] !== undefined)).toBe(false);
  });

  it("空密钥点添加 → 不发请求，给出原因", async () => {
    let called = 0;
    const errors: (string | undefined)[] = [];
    const all = render(
      {},
      {
        onSaveSecret: async () => {
          called += 1;
          return undefined;
        },
        secretDraft: "",
        onSecretError: (error: string | undefined) => errors.push(error),
      },
    );
    const button = all.find((element) => element.props["data-secret-add"] !== undefined)!;
    (button.props.onClick as () => void)();
    await Promise.resolve();
    expect(called).toBe(0);
    expect(errors.at(-1)).toMatch(/密钥/);
  });
});

describe("已添加的列表", () => {
  it("一条都没有时显示空态（不是一片空白）", () => {
    expect(render().some((element) => element.props["data-secret-empty"] !== undefined)).toBe(true);
  });

  it("列表里每条都带 × 删除", () => {
    const all = render(
      { searchApiKeyRefs: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"] },
      { credentialStatus: { DEEPSEEK_API_KEY: true, DEEPSEEK_API_KEY_2: true } },
    );
    const rows = all.filter((element) => element.props["data-secret-row"] !== undefined);
    expect(rows.map((row) => row.props["data-secret-row"])).toEqual(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"]);
    const removes = all.filter((element) => element.props["data-secret-remove"] !== undefined);
    expect(removes.map((element) => element.props["data-secret-remove"])).toEqual([
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_API_KEY_2",
    ]);
  });

  it("每行按凭据库状态显示「已添加 / 未添加」", () => {
    const all = render({ searchApiKeyRefs: ["A_KEY", "B_KEY"] }, { credentialStatus: { A_KEY: true, B_KEY: false } });
    const rows = all.filter((element) => element.props["data-secret-row"] !== undefined);
    expect(textOf(rows[0])).toContain(t("search.keyConfigured"));
    expect(textOf(rows[1])).toContain(t("search.keyMissing"));
  });

  it("状态还没读回来时不显示徽标（不猜「未添加」）", () => {
    const all = render({ searchApiKeyRefs: ["A_KEY"] }, { credentialStatus: undefined });
    expect(all.some((element) => element.props["data-secret-state"] !== undefined)).toBe(false);
  });

  it("点 × 带着引用名回调删除", () => {
    const removed: string[] = [];
    const all = render({ searchApiKeyRefs: ["A_KEY"] }, { onRemoveSecret: (ref: string) => removed.push(ref) });
    (all.find((element) => element.props["data-secret-remove"] !== undefined)!.props.onClick as () => void)();
    expect(removed).toEqual(["A_KEY"]);
  });

  it("老文档里逗号分隔的字符串形式也认（不必等用户重新添加）", () => {
    const all = render({ searchApiKeyRefs: "A_KEY, B_KEY" });
    const rows = all.filter((element) => element.props["data-secret-row"] !== undefined);
    expect(rows.map((row) => row.props["data-secret-row"])).toEqual(["A_KEY", "B_KEY"]);
  });

  it("引用名列表住在功能页承载行里，从快照读得到", () => {
    // 钉住「列表不是设置字段但界面仍能读到」——功能页借用承载行快照。
    const state = createPageState(VENDORS, snapshots({ searchApiKeyRefs: ["X_KEY"] }));
    expect(state.snapshots[FEATURE_TAB_NS]?.value?.["searchApiKeyRefs"]).toEqual(["X_KEY"]);
  });
});
