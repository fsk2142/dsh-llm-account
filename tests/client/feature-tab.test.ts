/**
 * P1：功能页 tab（切换策略 + 网页搜索同页，各可隐藏）。
 *
 * 需求：这两台功能「单独一张选项卡」，「也可以有一个箭头专门隐藏他」。
 * 关键语义：
 * 1. 功能页是**第二类 tab**，不从厂商设置文档发现（它不是任何一家厂商）；
 * 2. 功能页**永远在**（即使两台功能都关掉），否则用户没有入口把它重新打开
 *    —— 与「移除模型后仍可见入口」是同一条既有纪律；
 * 3. 隐藏是**功能级**的：关掉某台功能只隐藏它那一块，不影响另一台，也不影响厂商页。
 */
import { describe, expect, it } from "vitest";

import { createPageState, FEATURE_TAB_NS } from "../../src/client/page-state";
import type { VendorEntry } from "../../src/client/registry";

/** 一家厂商声明（只填状态机用到的字段）。 */
function entry(ns: string, providerId: string, order: number): VendorEntry {
  return { ns, rowIds: [ns], providerId, order, labelKey: `vendor.${providerId}`, cards: [] } as unknown as VendorEntry;
}

/** 一份设置快照。 */
function snapshot(ns: string, value: Record<string, unknown> = {}) {
  return { ns, row: ns, value, revision: 1 };
}

const ENTRIES = [entry("llm-commandcode", "commandcode", 1), entry("llm-opendesign", "opendesign", 3)];

describe("功能页 tab", () => {
  it("功能页排在最后（厂商页在前，符合「先配账号再看功能」的顺序）", () => {
    const state = createPageState(ENTRIES, [snapshot("llm-commandcode"), snapshot("llm-opendesign")]);
    const namespaces = state.tabs.map((tab) => tab.ns);
    expect(namespaces).toEqual(["llm-commandcode", "llm-opendesign", FEATURE_TAB_NS]);
  });

  it("一台厂商都没发现时，功能页仍然在（否则用户进不了功能设置）", () => {
    const state = createPageState(ENTRIES, []);
    expect(state.tabs.map((tab) => tab.ns)).toEqual([FEATURE_TAB_NS]);
  });

  it("功能页有自己的文案键，不与厂商页混用", () => {
    const state = createPageState(ENTRIES, [snapshot("llm-commandcode")]);
    const feature = state.tabs.find((tab) => tab.ns === FEATURE_TAB_NS);
    expect(feature?.labelKey).toBe("vendor.features");
  });

  it("功能页的 providerId 是一个稳定的虚拟值（不冒充任何厂商）", () => {
    const state = createPageState(ENTRIES, [snapshot("llm-commandcode")]);
    const feature = state.tabs.find((tab) => tab.ns === FEATURE_TAB_NS);
    expect(feature?.providerId).toBe("features");
  });

  it("功能页排最后靠一个大的 order，不与厂商的 order 值撞车", () => {
    const state = createPageState(ENTRIES, [snapshot("llm-commandcode")]);
    const feature = state.tabs.find((tab) => tab.ns === FEATURE_TAB_NS);
    const vendors = state.tabs.filter((tab) => tab.ns !== FEATURE_TAB_NS);
    for (const vendor of vendors) expect(feature!.order).toBeGreaterThan(vendor.order);
  });
});
