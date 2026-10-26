/**
 * 换模型的候选**必须来自用户可选范围**（需求：
 * 「根据当前的可选模型配置切换模型名单」）。
 *
 * 这是本功能最容易做错的地方：目录端点返回的是**全部**模型，而 `visibleModels` /
 * `modelVisibility` 表达的是「用户允许哪些」。换模型如果拿全量目录去挑，就会切到一个
 * 用户已经明确关掉的模型上——这正是注册表要用 `listModels()`（已过滤）而不是
 * `catalogModels()`（全量）的原因。
 */
import { describe, expect, it } from "vitest";

import { isModelIdVisible, normalizeVisibility, selectVisible } from "../../../src/core/catalog";
import { pickFallbackModel } from "../../../src/core/switching/model-fallback";

/** 造一个目录条目（只要 id 就够本文件用）。 */
function entry(id: string): { id: string; name: string; inputModalities: readonly ["text"] } {
  return { id, name: id, inputModalities: ["text"] };
}

describe("可见性规则（换模型的输入就是它）", () => {
  it("白名单非空时只放名单内的模型", () => {
    const visibility = normalizeVisibility({ visibleModels: ["deepseek-v4.1-flash"] });
    const visible = selectVisible([entry("deepseek-v4.1-flash"), entry("deepseek-v4-pro")], visibility);
    expect(visible.map((item) => item.id)).toEqual(["deepseek-v4.1-flash"]);
  });

  it("逐模型显式关掉的优先于白名单", () => {
    const visibility = normalizeVisibility({
      visibleModels: ["deepseek-v4.1-flash", "deepseek-v4.1-flash-2"],
      modelVisibility: { "deepseek-v4.1-flash-2": false },
    });
    expect(isModelIdVisible("deepseek-v4.1-flash-2", visibility)).toBe(false);
    expect(isModelIdVisible("deepseek-v4.1-flash", visibility)).toBe(true);
  });

  it("从没配过可见性时默认全部关闭", () => {
    // 这条决定了「换模型」在用户没勾选任何模型时**没有候选**——安全默认。
    expect(isModelIdVisible("deepseek-v4.1-flash", normalizeVisibility({}))).toBe(false);
  });
});

describe("候选只在可选范围内", () => {
  it("候选池之外的同名模型不会被选中（只在该账号已勾选的模型里换）", () => {
    // 需求：「可以降级，但**严格限定在该账号已勾选的模型里**」。
    // 这里验证「池外」——只有当前模型自己在池里时，换不了（因为排除自己）。
    const all = ["deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash", "kimi-k3"];
    const visibility = normalizeVisibility({ visibleModels: ["deepseek-v4.1-flash"] });
    const allowed = selectVisible(all.map(entry), visibility).map((item) => item.id);
    expect(allowed).toEqual(["deepseek-v4.1-flash"]);
    const picked = pickFallbackModel(
      { provider: "commandcode", model: "deepseek-v4.1-flash" },
      allowed.map((model) => ({ provider: "commandcode", model })),
    );
    // 池里只有它自己 → 排除自己后没有候选 → 停手（不会去拿池外的 kimi-k3）。
    expect(picked).toBeUndefined();
  });

  it("池内可以降级到不同名模型（但绝不跨出池子）", () => {
    // 用户允许了两个模型：一个同名、一个不同名。额度用尽时按四级优先，先同名。
    const all = ["deepseek-v4.1-flash", "kimi-k3", "claude-opus-5"];
    const visibility = normalizeVisibility({ visibleModels: ["deepseek-v4.1-flash", "kimi-k3"] });
    const allowed = selectVisible(all.map(entry), visibility).map((item) => item.id);
    const candidates = allowed.map((model) => ({ provider: "commandcode", model }));
    const picked = pickFallbackModel({ provider: "commandcode", model: "deepseek-v4.1-flash" }, candidates);
    // 只剩 kimi-k3（第 3 级），claude-opus-5 不在池里所以永不被选中。
    expect(picked?.model).toBe("kimi-k3");
  });

  it("允许了同名模型时能换过去", () => {
    // 同名 = 去掉厂商前缀/分隔符后相等：`deepseek/deepseek-v4.1-flash` 与
    // `deepseek-v4.1-flash` 是同一个键（不同网关的写法差异，这才是真实可换的情形）。
    const visibility = normalizeVisibility({
      visibleModels: ["deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"],
    });
    const allowed = selectVisible(
      [entry("deepseek-v4.1-flash"), entry("deepseek/deepseek-v4.1-flash")],
      visibility,
    ).map((item) => item.id);
    const picked = pickFallbackModel(
      { provider: "commandcode", model: "deepseek-v4.1-flash" },
      allowed.map((model) => ({ provider: "commandcode", model })),
    );
    expect(picked).toEqual({ provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" });
  });
});
