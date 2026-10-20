/**
 * 两张功能卡片的结构（2026-10-20 用户澄清）。
 *
 * 用户原话：「信息卡留着，但是重点是启用开关和相关配置，启用自动切换开关，目前只有这一个
 * 按钮就可以为以后添加东西留着占位，搜索那里也是，重点是是否开启网页搜索，然后下面就是
 * 相关配置」。
 *
 * 所以版式是：
 * - **切换设置**卡：主开关「启用自动切换」在最上，下面是相关配置（额度用尽换模型、自动继续）。
 * - **搜索设置**卡：主开关「启用网页搜索」在最上，下面是相关配置（网关优先、API key 引用）。
 * - **卡片永远都在**（开关关掉也留着），只是下方配置变成禁用态 ——
 *   这样用户随时能重新打开，也不会因为关掉而找不到入口。
 */
import { describe, expect, it } from "vitest";

import {
  isConfigEnabled,
  primarySwitchOf,
  SETTINGS_CARDS,
  subordinateFieldsOf,
} from "../../src/client/settings-cards";

describe("主开关排在最前", () => {
  it("切换设置的主开关是「启用自动切换」", () => {
    expect(primarySwitchOf("switching")).toBe("featureSwitchEnabled");
  });

  it("搜索设置的主开关是「启用网页搜索」", () => {
    expect(primarySwitchOf("search")).toBe("featureSearchEnabled");
  });

  it("显示设置与高级设置没有主开关（它们是普通配置卡）", () => {
    expect(primarySwitchOf("display")).toBeUndefined();
    expect(primarySwitchOf("advanced")).toBeUndefined();
  });

  it("主开关不在「从属字段」列表里（否则会渲染两次）", () => {
    for (const id of ["switching", "search"] as const) {
      const primary = primarySwitchOf(id);
      expect(subordinateFieldsOf(id)).not.toContain(primary);
    }
  });
});

describe("下方配置 = 卡里除主开关之外的字段", () => {
  it("切换设置下面有额度用尽换模型与自动继续三项", () => {
    const fields = subordinateFieldsOf("switching");
    expect(fields).toContain("autoSwitchModelOnQuota");
    expect(fields).toContain("autoContinueOnError");
    expect(fields).toContain("autoContinueOnTruncate");
    expect(fields).toContain("autoContinueMaxAttempts");
  });

  it("搜索设置下面是网关优先与 API key 引用", () => {
    const fields = subordinateFieldsOf("search");
    expect(fields).toContain("searchPreferGateway");
    expect(fields).toContain("searchApiKeyEnv");
  });
});

describe("主开关关掉时配置变禁用，但卡片仍在", () => {
  it("默认（字段缺失）视为启用", () => {
    expect(isConfigEnabled({}, "switching")).toBe(true);
    expect(isConfigEnabled({}, "search")).toBe(true);
  });

  it("关掉切换 → 切换卡的配置禁用（不是卡片消失）", () => {
    expect(isConfigEnabled({ featureSwitchEnabled: false }, "switching")).toBe(false);
  });

  it("关掉搜索 → 搜索卡的配置禁用", () => {
    expect(isConfigEnabled({ featureSearchEnabled: false }, "search")).toBe(false);
  });

  it("非布尔值按启用处理（不误禁用）", () => {
    expect(isConfigEnabled({ featureSwitchEnabled: "false" }, "switching")).toBe(true);
    expect(isConfigEnabled({ featureSearchEnabled: null }, "search")).toBe(true);
  });

  it("没有主开关的卡片永远启用", () => {
    expect(isConfigEnabled({ featureSwitchEnabled: false, featureSearchEnabled: false }, "display")).toBe(true);
    expect(isConfigEnabled({ featureSwitchEnabled: false }, "advanced")).toBe(true);
  });

  it("两张卡都声明了主开关，且不在显示设置卡里（已搬回各自卡）", () => {
    const display = SETTINGS_CARDS.find((card) => card.id === "display");
    expect(display?.shared).not.toContain("featureSwitchEnabled");
    expect(display?.shared).not.toContain("featureSearchEnabled");
    const switching = SETTINGS_CARDS.find((card) => card.id === "switching");
    expect(switching?.shared).toContain("featureSwitchEnabled");
    const search = SETTINGS_CARDS.find((card) => card.id === "search");
    expect(search?.shared).toContain("featureSearchEnabled");
  });
});
