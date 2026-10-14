/**
 * Task 4 测试：统一设置页——厂商标签页、通用字段卡片、保存条与各条接缝。
 *
 * 分工（Ruling 22 的 humble-object 切分）：
 * - **状态机**在 `page-state.ts`（纯函数，不碰 React）→ 本文件大部分用例直接测它；
 * - **渲染**在 `page.ts`（`createElement`，纯 props → 元素树）→ 用测试专用 React 替身直接调用
 *   组件并遍历返回的树（替身的 Hook 会抛错，所以「被测组件必须无状态」是机械保证，不是纪律）；
 * - **接缝**在 `seams.ts`（宿主调用的形状）→ 用假宿主测。
 */
import { expect, it } from "vitest";

import { COPY, dictionaryOf, missingCopyKeys } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import {
  cardGroupsOf,
  createPageState,
  dirtyFields,
  fieldValue,
  fieldsOf,
  isDirty,
  noteCredentialChange,
  selectTab,
  setField,
  sidebarToggleField,
  type PageState,
  type VendorSnapshot,
} from "../../src/client/page-state";
import type { VendorEntry } from "../../src/client/registry";
import { VENDORS } from "../../src/client/shell";
import type { StubElement } from "../support/react-stub";

/** 一个最小厂商声明：只带「集成与显示」一组。 */
function entryOf(overrides: Partial<VendorEntry> & Pick<VendorEntry, "ns">): VendorEntry {
  return {
    rowIds: [overrides.ns],
    providerId: overrides.ns,
    order: 1,
    labelKey: `vendor.${overrides.ns}`,
    cards: [],
    ...overrides,
  };
}

/** 两份设置快照：两家都在宿主上存在。 */
const SNAPSHOTS: VendorSnapshot[] = [
  { ns: "llm-commandcode", value: { showSidebarQuota: false, apiBase: "https://a.example" }, revision: 3 },
  { ns: "llm-opencode-go", value: { usageDisplay: "auto" }, revision: 1 },
];

/** 展平元素树（数组与 `props.children` 都要下钻），得到所有元素。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 树里所有文本。 */
function textOf(node: unknown): string[] {
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      texts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value !== null && typeof value === "object" && "props" in (value as StubElement)) {
      walk((value as StubElement).props.children);
    }
  };
  walk(node);
  return texts;
}

// —— 标签页 ——

it("标签页只渲染「已注册且宿主上存在」的厂商，按 order 升序", () => {
  const registered = [entryOf({ ns: "llm-opencode-go", order: 20 }), entryOf({ ns: "llm-commandcode", order: 12 })];
  const state = createPageState(registered, SNAPSHOTS);

  expect(state.tabs.map((tab) => tab.ns)).toEqual(["llm-commandcode", "llm-opencode-go"]);
  // 注册了但宿主上没有这个命名空间：不渲染（规格 §8 的「按设置命名空间发现厂商」）。
  const withGhost = createPageState([...registered, entryOf({ ns: "llm-ghost" })], SNAPSHOTS);
  expect(withGhost.tabs.map((tab) => tab.ns)).toEqual(["llm-commandcode", "llm-opencode-go"]);
  // 一个都没有：没有标签页，也没有选中的厂商（不编造）。
  const none = createPageState(registered, []);
  expect(none.tabs).toEqual([]);
  expect(none.activeNs).toBeUndefined();
});

it("切换标签不丢草稿：每个厂商的草稿各存各的", () => {
  let state = createPageState(VENDORS, SNAPSHOTS);
  state = setField(state, "llm-commandcode", "apiBase", "https://edited.example");
  state = setField(state, "llm-opencode-go", "usageDisplay", "off");
  state = selectTab(state, "llm-opencode-go");
  state = selectTab(state, "llm-commandcode");

  expect(fieldValue(state, "llm-commandcode", "apiBase")).toBe("https://edited.example");
  expect(fieldValue(state, "llm-opencode-go", "usageDisplay")).toBe("off");
  // 一家的改动不会把另一家弄脏。
  expect(isDirty(state, "llm-commandcode")).toBe(true);
  expect(isDirty(state, "llm-opencode-go")).toBe(true);
  const onlyOne = setField(createPageState(VENDORS, SNAPSHOTS), "llm-commandcode", "apiBase", "x");
  expect(isDirty(onlyOne, "llm-opencode-go")).toBe(false);
});

it("保存条只在有改动时出现：值与基线一致就不算改动", () => {
  let state = createPageState(VENDORS, SNAPSHOTS);
  expect(isDirty(state, "llm-commandcode")).toBe(false);
  expect(dirtyFields(state, "llm-commandcode")).toEqual([]);

  // 写回与基线相同的值：仍然不脏（不能靠「碰过这个字段」判定）。
  state = setField(state, "llm-commandcode", "apiBase", "https://a.example");
  expect(isDirty(state, "llm-commandcode")).toBe(false);

  state = setField(state, "llm-commandcode", "apiBase", "https://b.example");
  expect(isDirty(state, "llm-commandcode")).toBe(true);
  expect(dirtyFields(state, "llm-commandcode")).toEqual([{ key: "apiBase", value: "https://b.example" }]);

  // 改回基线：又不脏了。
  state = setField(state, "llm-commandcode", "apiBase", "https://a.example");
  expect(isDirty(state, "llm-commandcode")).toBe(false);
});

// —— 通用字段卡片 ——

it("三组通用卡片按厂商声明渲染：未声明的组不出现，空组也不出现", () => {
  const commandCode = VENDORS.find((vendor) => vendor.ns === "llm-commandcode")!;
  const groups = cardGroupsOf(commandCode).map((group) => group.group);

  // 本包两个厂商这一期都没有声明「隐私与安全」的字段（1a 把 zdr/webSearch 留到后续期），
  // 所以该组不渲染 —— 「厂商未声明的组不渲染」这条规则的自然结果。
  expect(groups).toEqual(["integrations", "advanced"]);

  // 显式声明一个空组：同样不渲染（避免出现一个没有字段的空卡片）。
  const withEmpty = entryOf({
    ns: "llm-commandcode",
    cards: [{ group: "privacy", fields: [] }, { group: "integrations", fields: [{ key: "showSidebarQuota", kind: "boolean", labelKey: "field.showSidebarQuota" }] }],
  });
  expect(cardGroupsOf(withEmpty).map((group) => group.group)).toEqual(["integrations"]);
});

it("「集成与显示」里的侧边栏卡片开关默认关闭，且声明来源就是厂商注册表", () => {
  for (const vendor of VENDORS) {
    const toggle = sidebarToggleField(vendor);
    expect(toggle?.key, vendor.ns).toBe("showSidebarQuota");
    expect(toggle?.kind, vendor.ns).toBe("boolean");
    // 声明默认值就是 `false`（规格 §8.1 第 6 条：默认关闭、关闭时不后台刷新）。
    expect(toggle?.fallback, vendor.ns).toBe(false);
  }

  // 宿主文档里没有这个字段时，读到的就是声明的默认值 —— 不是 `undefined`，也不是真的 0/true。
  const state = createPageState(VENDORS, [{ ns: "llm-commandcode", value: {}, revision: 1 }]);
  expect(fieldValue(state, "llm-commandcode", "showSidebarQuota")).toBe(false);
  // 宿主文档里有值时以宿主为准。
  const on = createPageState(VENDORS, [{ ns: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 }]);
  expect(fieldValue(on, "llm-commandcode", "showSidebarQuota")).toBe(true);
});

it("字段列表按声明顺序展开，值来自草稿 → 基线 → 声明默认值", () => {
  const commandCode = VENDORS.find((vendor) => vendor.ns === "llm-commandcode")!;
  const state = setField(createPageState(VENDORS, SNAPSHOTS), "llm-commandcode", "protocol", "cli");
  const fields = fieldsOf(state, commandCode);

  expect(fields.map((field) => field.spec.key)).toEqual(["showSidebarQuota", "apiBase", "protocol", "requestTimeoutMs", "streamIdleTimeoutMs", "defaultMaxTokens"]);
  const byKey = new Map(fields.map((field) => [field.spec.key, field]));
  expect(byKey.get("showSidebarQuota")?.value).toBe(false); // 基线没有 → 声明默认
  expect(byKey.get("apiBase")?.value).toBe("https://a.example"); // 基线
  expect(byKey.get("protocol")?.value).toBe("cli"); // 草稿
  expect(byKey.get("protocol")?.changed).toBe(true);
  expect(byKey.get("defaultMaxTokens")?.value).toBeUndefined(); // 没有默认值就是没有
});

// —— 凭据推送 ——

it("凭据变更推送到达时刷新计数（「已配置」徽标的刷新依据）", () => {
  const before = createPageState(VENDORS, SNAPSHOTS);
  const after = noteCredentialChange(before);
  expect(after.credentialRevision).toBe(before.credentialRevision + 1);
  // 新状态对象：靠引用变化触发重渲染，而不是就地改。
  expect(after).not.toBe(before);
  expect(after.tabs).toBe(before.tabs);
});

// —— 文案 ——

it("两套文案键完全对齐，且语言不同文案不同", () => {
  expect(missingCopyKeys()).toEqual([]);
  const zh = dictionaryOf("zh");
  const en = dictionaryOf("en");
  expect(zh("title")).not.toBe(en("title"));
  expect(zh("nav")).toBe(COPY.zh.nav);
  // 键缺失时回退到键名（而不是 undefined 在界面上变成空白）。
  expect(zh("nope.missing")).toBe("nope.missing");
  // 厂商标签文案：注册表只给键，文案在 copy 里。
  for (const vendor of VENDORS) {
    expect(zh(vendor.labelKey), vendor.ns).not.toBe(vendor.labelKey);
    expect(en(vendor.labelKey), vendor.ns).not.toBe(vendor.labelKey);
  }
});

// —— 渲染（纯 props → 元素树）——

/** 渲染一次页面外壳，返回元素树。 */
function render(state: PageState, t = dictionaryOf("en")): StubElement {
  return PageShell({
    state,
    entries: VENDORS,
    t,
    onSelectTab: () => undefined,
    onSetField: () => undefined,
    onSave: () => undefined,
  });
}

it("页面外壳渲染标题、简介与每个厂商一个标签页", () => {
  const tree = render(createPageState(VENDORS, SNAPSHOTS));
  const all = elementsOf(tree);

  const tabs = all.filter((element) => element.props["data-tab"] !== undefined);
  expect(tabs.map((element) => element.props["data-tab"])).toEqual(["llm-commandcode", "llm-opencode-go"]);
  const texts = textOf(tree);
  expect(texts).toContain(COPY.en.title);
  expect(texts).toContain(COPY.en.intro);
  expect(texts).toContain(COPY.en["vendor.commandcode"]);
});

it("未声明的卡片组不渲染元素；声明了的组带着字段渲染", () => {
  const tree = render(createPageState(VENDORS, SNAPSHOTS));
  const all = elementsOf(tree);

  const groups = all.filter((element) => element.props["data-card-group"] !== undefined).map((element) => element.props["data-card-group"]);
  expect(groups).toEqual(["integrations", "advanced"]);
  // 「隐私与安全」这一期两家都没声明 → 连标题都不出现。
  expect(textOf(tree)).not.toContain(COPY.en["group.privacy"]);

  const fieldKeys = all.filter((element) => element.props["data-field"] !== undefined).map((element) => element.props["data-field"]);
  expect(fieldKeys).toContain("showSidebarQuota");
  expect(fieldKeys).toContain("apiBase");
});

it("保存条只在当前厂商有改动时出现", () => {
  expect(elementsOf(render(createPageState(VENDORS, SNAPSHOTS))).filter((element) => element.props["data-save-bar"] !== undefined)).toHaveLength(0);

  const dirty = setField(createPageState(VENDORS, SNAPSHOTS), "llm-commandcode", "apiBase", "https://b.example");
  const bars = elementsOf(render(dirty)).filter((element) => element.props["data-save-bar"] !== undefined);
  expect(bars).toHaveLength(1);
  expect(textOf(bars[0])).toContain(COPY.en.save);
});

it("没有厂商可渲染时给出说明文字，而不是空白页", () => {
  const tree = render(createPageState(VENDORS, []));
  expect(textOf(tree)).toContain(COPY.en["empty.noVendor"]);
});

it("侧边栏卡片开关在页面上是未勾选状态（默认关闭）", () => {
  const all = elementsOf(render(createPageState(VENDORS, SNAPSHOTS)));
  const toggle = all.find((element) => element.props["data-field"] === "showSidebarQuota")!;
  // 控件自己带着当前值；宿主文档 `{}` → 声明默认 `false` → 未勾选。
  const input = elementsOf(toggle).find((element) => element.props["data-field-input"] === "showSidebarQuota")!;
  expect(input.props.checked).toBe(false);
});
