/**
 * 设置页四张卡片（2026-10-20 用户要求）。
 *
 * 用户原话：「显示设置，切换设置，搜索设置，高级设置，要四个卡片」，
 * 「三家的设置合并在一起，除非某个设置是专门针对某一家网关的」，
 * 「不要那个设置对象，就按照可收起的卡片形式」。
 *
 * 所以版式从「按厂商分 tab」改成「按功能分四张可折叠卡片」：
 * - **显示设置**：三家共有（侧边栏额度卡、刷新间隔）
 * - **切换设置**：三家共有（额度用尽换模型 + 自动继续）
 * - **搜索设置**：三家共有（搜索开关、网关优先、API key 引用）
 * - **高级设置**：三家共有部分是超时；**厂商专属**字段（apiBase / protocol / workspaceId…）
 *   留在同一张卡里，但标注归属，因为它只对那一家生效。
 */
import { describe, expect, it } from "vitest";

import { SETTINGS_CARDS } from "../../src/client/settings-cards";

describe("四张卡片", () => {
  it("顺序固定：显示 → 切换 → 搜索 → 高级", () => {
    expect(SETTINGS_CARDS.map((card) => card.id)).toEqual(["display", "switching", "search", "advanced"]);
  });

  it("每张卡片都有可折叠的标题文案", () => {
    for (const card of SETTINGS_CARDS) {
      expect(card.labelKey, card.id).toMatch(/^card\./);
    }
  });

  it("三家共有的字段归入前三张卡（不重复声明为厂商专属）", () => {
    const shared = SETTINGS_CARDS.flatMap((card) => card.shared);
    expect(shared).toContain("showSidebarQuota");
    expect(shared).toContain("quotaRefreshMinutes");
    expect(shared).toContain("autoSwitchModelOnQuota");
    expect(shared).toContain("autoContinueOnError");
    expect(shared).toContain("autoContinueOnTruncate");
    expect(shared).toContain("autoContinueMaxAttempts");
    expect(shared).toContain("searchStrategy");
    
    expect(shared).toContain("requestTimeoutMs");
    expect(shared).toContain("streamIdleTimeoutMs");
    // 2026-10-20 用户去掉了「启用自动切换 / 开启网页搜索」两个界面开关
    // （卡片本来就能用箭头收起）。
    expect(shared).not.toContain("featureSwitchEnabled");
    expect(shared).not.toContain("featureSearchEnabled");
  });

  it("厂商专属字段带明确的归属（只对那一家生效）", () => {
    const advanced = SETTINGS_CARDS.find((card) => card.id === "advanced");
    expect(advanced).toBeDefined();
    const owners = new Map(advanced!.specific.map((field) => [field.key, field.vendor]));
    expect(owners.get("apiBase")).toBe("commandcode");
    expect(owners.get("protocol")).toBe("commandcode");
    expect(owners.get("workspaceId")).toBe("opendesign");
    expect(owners.get("walletBase")).toBe("opendesign");
    // baseURL 三家用的名字一样，但含义各自独立 —— 按厂商分别声明。
    expect(owners.get("baseURL")).toBeDefined();
  });

  it("没有字段同时出现在「共有」与「专属」里（否则写回会打架）", () => {
    const shared = new Set(SETTINGS_CARDS.flatMap((card) => card.shared));
    const specific = SETTINGS_CARDS.flatMap((card) => card.specific.map((field) => field.key));
    for (const key of specific) expect(shared.has(key), key).toBe(false);
  });

  it("四个卡片都不为空（空卡片不渲染，但声明里不该有空的）", () => {
    for (const card of SETTINGS_CARDS) {
      expect(card.shared.length + card.specific.length, card.id).toBeGreaterThan(0);
    }
  });
});
