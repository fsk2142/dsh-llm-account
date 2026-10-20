/**
 * 「启用自动切换 / 开启网页搜索」两个开关的**实际效果**（2026-10-20 用户报障 + 澄清）。
 *
 * 用户报障：「显示切换策略那个我点了按钮没什么反应」「显示网页搜索那个设置我也点了
 * 按钮也没什么反应」。
 *
 * 根因：这两个开关只声明了配置字段与文案，**客户端渲染层从来没读过它们** ——
 * 值写进去了，但没有任何东西随之变化，所以点上去「没反应」。
 *
 * 用户随后澄清了期望的形状：
 * 「信息卡留着，但是重点是启用开关和相关配置……重点是是否开启网页搜索，然后下面就是相关配置」。
 * 所以：**卡片不消失**，主开关关掉时只把下方配置置灰。
 */
import { describe, expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { PageShell } from "../../src/client/page";
import { createPageState, FEATURE_TAB_NS, setField } from "../../src/client/page-state";
import { VENDORS } from "../../src/client/shell";
import type { StubElement } from "../support/react-stub";

const t = dictionaryOf("zh");

/** 三家设置快照（功能页的快照由 createPageState 借用承载行）。 */
function snapshots(overrides: Record<string, Record<string, unknown>> = {}) {
  return [
    { ns: "llm-commandcode", row: "llm-commandcode", value: overrides["llm-commandcode"] ?? {}, revision: 1 },
    { ns: "llm-opencode-go", row: "opencode-go", value: overrides["llm-opencode-go"] ?? {}, revision: 1 },
    { ns: "llm-opendesign", row: "opendesign", value: overrides["llm-opendesign"] ?? {}, revision: 1 },
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
function render(state: ReturnType<typeof createPageState>): StubElement[] {
  return elementsOf(
    PageShell({
      state,
      entries: VENDORS,
      t,
      onSelectTab: () => undefined,
      onSetField: () => undefined,
      onSave: () => undefined,
    }),
  );
}

/** 页面里出现的卡片 id。 */
function cardIds(elements: readonly StubElement[]): string[] {
  return elements
    .filter((element) => element.type === "details" && element.props["data-card"] !== undefined)
    .map((element) => element.props["data-card"] as string);
}

describe("默认状态", () => {
  it("四张卡片都在，且主开关都在", () => {
    const elements = render(createPageState(VENDORS, snapshots()));
    expect(cardIds(elements)).toEqual(["display", "switching", "search", "advanced"]);
    expect(elements.some((element) => element.props["data-field"] === "featureSwitchEnabled")).toBe(true);
    expect(elements.some((element) => element.props["data-field"] === "featureSearchEnabled")).toBe(true);
  });

  it("主开关单独成块、排在配置之前（`data-card-primary`）", () => {
    const elements = render(createPageState(VENDORS, snapshots()));
    expect(elements.some((element) => element.props["data-card-primary"] === "switching")).toBe(true);
    expect(elements.some((element) => element.props["data-card-primary"] === "search")).toBe(true);
  });

  it("主开关不出现在配置区里（否则同一张卡里会出现两次）", () => {
    const elements = render(createPageState(VENDORS, snapshots()));
    const switchingConfig = elements.find((element) => element.props["data-card-config"] === "switching");
    expect(switchingConfig).toBeDefined();
    const inside = elementsOf(switchingConfig);
    expect(inside.some((element) => element.props["data-field"] === "featureSwitchEnabled")).toBe(false);
  });
});

describe("关掉主开关之后：卡片仍在，配置置灰", () => {
  it("切换设置卡**不消失**（用户随时能重新打开）", () => {
    const state = createPageState(VENDORS, snapshots({ "llm-commandcode": { featureSwitchEnabled: false } }));
    const elements = render(state);
    expect(cardIds(elements)).toContain("switching");
    // 开关自己也还在。
    expect(elements.some((element) => element.props["data-field"] === "featureSwitchEnabled")).toBe(true);
  });

  it("切换设置的配置区标成禁用，并给一句说明", () => {
    const state = createPageState(VENDORS, snapshots({ "llm-commandcode": { featureSwitchEnabled: false } }));
    const elements = render(state);
    const config = elements.find((element) => element.props["data-card-config"] === "switching");
    expect(config?.props["data-card-disabled"]).toBe("true");
    expect(elementsOf(config).some((element) => element.type === "small")).toBe(true);
  });

  it("搜索设置卡同样不消失，配置置灰", () => {
    const state = createPageState(VENDORS, snapshots({ "llm-commandcode": { featureSearchEnabled: false } }));
    const elements = render(state);
    expect(cardIds(elements)).toContain("search");
    const config = elements.find((element) => element.props["data-card-config"] === "search");
    expect(config?.props["data-card-disabled"]).toBe("true");
  });

  it("关闭一张卡不影响另一张卡的状态", () => {
    const state = createPageState(VENDORS, snapshots({ "llm-commandcode": { featureSwitchEnabled: false } }));
    const elements = render(state);
    const searchConfig = elements.find((element) => element.props["data-card-config"] === "search");
    expect(searchConfig?.props["data-card-disabled"]).toBeUndefined();
  });
});

describe("点了开关立刻有反应（走草稿，不等保存）", () => {
  it("草稿里关掉主开关 → 当次渲染配置就置灰", () => {
    const base = createPageState(VENDORS, snapshots());
    const dirty = setField(base, FEATURE_TAB_NS, "featureSwitchEnabled", false);
    const elements = render(dirty);
    const config = elements.find((element) => element.props["data-card-config"] === "switching");
    expect(config?.props["data-card-disabled"]).toBe("true");
    // 而且有未保存改动 → 保存条出现（否则改了就存不了）。
    expect(elements.some((element) => element.props["data-save-bar"] !== undefined)).toBe(true);
  });
});

describe("文案", () => {
  it("两个开关的文案是「启用…」，与卡片名区分开", () => {
    expect(t("field.featureSwitchEnabled")).toBeTruthy();
    expect(t("field.featureSwitchEnabled")).not.toBe(t("card.switching"));
    expect(t("field.featureSearchEnabled")).toBeTruthy();
    expect(t("field.featureSearchEnabled")).not.toBe(t("card.search"));
  });
});
