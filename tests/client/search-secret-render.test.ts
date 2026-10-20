/**
 * 搜索卡里的「保存密钥」必须真的渲染出来（2026-10-20 报障的根因验证）。
 *
 * 用户报障：「我加了 api，点了保存但是还是显示未添加」。
 * 根因：引用名输入框只写**名字**，设置文档里没有真 key，凭据库里也没有 ——
 * 界面上根本没有写密钥的入口。这一层测试钉住那个入口**确实存在**。
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

/** 渲染页面（带「保存密钥」能力）。 */
function render(props: Record<string, unknown> = {}): StubElement[] {
  return elementsOf(
    PageShell({
      state: createPageState(VENDORS, snapshots({ searchApiKeyRefs: "DEEPSEEK_API_KEY" })),
      entries: VENDORS,
      t,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
      onSaveSecret: async () => undefined,
      ...props,
    }),
  );
}

describe("「保存密钥」入口", () => {
  it("有密码框（不是普通文本框：密钥不该明文显示）", () => {
    const input = render().find((element) => element.props["data-secret-input"] !== undefined);
    expect(input, "应该有密钥输入框").toBeDefined();
    expect(input?.props.type).toBe("password");
  });

  it("有保存按钮，且绑定到当前引用名", () => {
    const button = render().find((element) => element.props["data-secret-save"] !== undefined);
    expect(button).toBeDefined();
    expect(button?.props["data-secret-save"]).toBe("DEEPSEEK_API_KEY");
  });

  it("输入框不带 data-field（否则会和设置草稿/保存条共用通道）", () => {
    const input = render().find((element) => element.props["data-secret-input"] !== undefined)!;
    expect(input.props["data-field"]).toBeUndefined();
  });

  it("宿主不支持写凭据时不渲染这一块（老宿主不留死按钮）", () => {
    const all = elementsOf(
      PageShell({
        state: createPageState(VENDORS, snapshots({ searchApiKeyRefs: "DEEPSEEK_API_KEY" })),
        entries: VENDORS,
        t,
        onSelectTab: () => undefined,
        onSetField: () => undefined,
        onSave: () => undefined,
      }),
    );
    expect(all.some((element) => element.props["data-secret-input"] !== undefined)).toBe(false);
  });

  it("还没填引用名时给出提示，而不是一个不知道往哪写的按钮", () => {
    const all = elementsOf(
      PageShell({
        state: createPageState(VENDORS, snapshots({ searchApiKeyRefs: "" })),
        entries: VENDORS,
        t,
        onSelectTab: () => undefined,
        onSetField: () => undefined,
        onSave: () => undefined,
        onSaveSecret: async () => undefined,
      }),
    );
    const block = all.find((element) => element.props["data-secret-block"] === "no-ref");
    expect(block).toBeDefined();
  });

  it("空密钥点保存 → 不发请求，给出原因", async () => {
    let called = 0;
    const errors: (string | undefined)[] = [];
    const all = elementsOf(
      PageShell({
        state: createPageState(VENDORS, snapshots({ searchApiKeyRefs: "DEEPSEEK_API_KEY" })),
        entries: VENDORS,
        t,
        onSelectTab: () => undefined,
        onSetField: () => undefined,
        onSave: () => undefined,
        onSaveSecret: async () => {
          called += 1;
          return undefined;
        },
        secretDraft: "",
        onSecretError: (error: string | undefined) => errors.push(error),
      }),
    );
    const button = all.find((element) => element.props["data-secret-save"] !== undefined)!;
    (button.props.onClick as () => void)();
    await Promise.resolve();
    expect(called).toBe(0);
    expect(errors.at(-1)).toMatch(/密钥/);
  });
});
