/**
 * 去掉「启用自动切换 / 开启网页搜索」两个界面开关（2026-10-20 用户要求）。
 *
 * 用户原话：「显示网页搜索那个按钮和显示切换策略那个按钮可以不要，毕竟可以通过箭头展开
 * 或者收起」。
 *
 * 判断依据：这两个开关从来没有真正的「启用/禁用功能」语义 —— 它们只控制卡片是否渲染，
 * 而卡片本来就能用 `<details>` 的箭头收起。多一个开关反而误导（用户会以为关掉就禁用了功能）。
 * 所以整条链路一起删：字段声明、卡片归属、主开关/置灰逻辑。
 */
import { describe, expect, it } from "vitest";

import { PRIMARY_SWITCH_FIELDS, SETTINGS_CARDS, isConfigEnabled, primarySwitchOf } from "../../src/client/settings-cards";
import { VENDORS } from "../../src/client/shell";

/** VENDORS 里声明的全部字段名（扁平）。 */
function declaredFieldKeys(): string[] {
  return VENDORS.flatMap((vendor) => vendor.cards.flatMap((card) => card.fields.map((field) => field.key)));
}

describe("两个界面开关已经移除", () => {
  it("界面不再声明 featureSwitchEnabled", () => {
    expect(declaredFieldKeys()).not.toContain("featureSwitchEnabled");
  });

  it("界面不再声明 featureSearchEnabled", () => {
    expect(declaredFieldKeys()).not.toContain("featureSearchEnabled");
  });

  it("卡片声明里也不再引用这两个字段", () => {
    const all = SETTINGS_CARDS.flatMap((card) => [...card.shared, ...card.specific.map((field) => field.key)]);
    expect(all).not.toContain("featureSwitchEnabled");
    expect(all).not.toContain("featureSearchEnabled");
  });

  it("没有任何卡片还声明主开关（主开关概念本身随需求消失）", () => {
    for (const id of ["display", "switching", "search", "advanced"] as const) {
      expect(primarySwitchOf(id), id).toBeUndefined();
    }
    expect(PRIMARY_SWITCH_FIELDS).toEqual([]);
  });

  it("没有任何卡片会进入「禁用」状态（配置永远可用）", () => {
    for (const id of ["display", "switching", "search", "advanced"] as const) {
      expect(isConfigEnabled({}, id), id).toBe(true);
      // 即使文档里碰巧留着旧值，也不再影响渲染。
      expect(isConfigEnabled({ featureSwitchEnabled: false, featureSearchEnabled: false }, id), id).toBe(true);
    }
  });
});

describe("四张卡片仍然齐全（功能没有被删掉）", () => {
  it("顺序不变", () => {
    expect(SETTINGS_CARDS.map((card) => card.id)).toEqual(["display", "switching", "search", "advanced"]);
  });

  it("切换设置里仍有换模型与自动继续", () => {
    const switching = SETTINGS_CARDS.find((card) => card.id === "switching");
    expect(switching?.shared).toContain("autoSwitchModelOnQuota");
    expect(switching?.shared).toContain("autoContinueOnError");
  });

  it("搜索设置里仍有网关优先与 API key 引用", () => {
    const search = SETTINGS_CARDS.find((card) => card.id === "search");
    expect(search?.shared).toContain("searchStrategy");
    expect(search?.shared).toContain("searchApiKeyRefs");
  });
});
