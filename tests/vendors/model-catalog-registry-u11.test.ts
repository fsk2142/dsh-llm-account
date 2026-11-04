import { beforeEach, describe, expect, it } from "vitest";

import {
  cachedModelCandidates,
  invalidateCatalogCandidates,
  modelCandidates,
  noteCatalogModels,
  registerCatalogSource,
  resetCatalogSources,
} from "../../src/vendors/model-catalog-registry";

/**
 * 取消模型后自动切换不能沿用旧候选（2026-11-04 外部审查 U11）。
 *
 * ## 审查原文
 *
 * > 当前 source 已无该模型，60 秒候选缓存仍返回旧值，执行委托又不重新核对。
 *
 * ## 验收
 *
 * > 保存取消勾选、删除最后账号或撤销凭据后立刻触发切换，均不得调用已禁用目标。
 *
 * ## 契约
 *
 * 这三类操作在宿主里都是**设置变更**，会触发 `loader/volatile-update`。
 * 三家入口在那里调用 `invalidateCatalogCandidates()` —— 缓存立刻作废，
 * 下一次换模型重新读目录，已取消的模型不会进候选。
 */
const PROVIDER = "dsh-opencode-go";

describe("U11 · 设置变更必须作废候选缓存", () => {
  beforeEach(() => {
    resetCatalogSources();
    registerCatalogSource({
      provider: PROVIDER,
      models: async () => [],
      available: () => true,
    });
  });

  it("**设置变更后旧候选立刻消失**（不等 60 秒 TTL）", async () => {
    const now = 1_000;
    noteCatalogModels(PROVIDER, [{ id: "m1" }, { id: "m2" }], now);
    expect(cachedModelCandidates(now), "先要有缓存").toHaveLength(2);

    // 用户取消了 m2 的勾选（或删了账号/撤销了凭据）→ 设置变更。
    invalidateCatalogCandidates();

    expect(
      cachedModelCandidates(now),
      "作废之后不该再拿得到旧候选（否则会把已取消的模型当切换目标）",
    ).toBeUndefined();
  });

  it("作废后重新读目录拿到的是**新**清单", async () => {
    noteCatalogModels(PROVIDER, [{ id: "m1" }, { id: "m2" }], 1_000);
    expect(cachedModelCandidates(1_000)).toHaveLength(2);

    // 这一家把 m2 取消了。
    resetCatalogSources();
    registerCatalogSource({
      provider: PROVIDER,
      models: async () => [{ id: "m1" }],
      available: () => true,
    });
    invalidateCatalogCandidates();

    const fresh = await modelCandidates(1_000);
    expect(fresh.map((candidate) => candidate.model), "只剩仍可见的那个").toEqual(["m1"]);
  });

  it("作废不影响**登记表**（只丢缓存，不是把 provider 摘掉）", async () => {
    invalidateCatalogCandidates();

    const candidates = await modelCandidates(1_000);
    // 登记仍然有效：`models()` 被真的调用了（这里返回空数组，但没抛「未登记」）。
    expect(Array.isArray(candidates), "登记表必须完好").toBe(true);
  });

  it("`available()` 为 false 的厂商在作废后也不会回来", async () => {
    let enabled = true;
    resetCatalogSources();
    registerCatalogSource({
      provider: PROVIDER,
      models: async () => [{ id: "m1" }],
      available: () => enabled,
    });

    noteCatalogModels(PROVIDER, [{ id: "m1" }], 1_000);
    expect(cachedModelCandidates(1_000)).toHaveLength(1);

    // 撤销凭据 → 这家不再可用 + 设置变更。
    enabled = false;
    invalidateCatalogCandidates();

    expect(await modelCandidates(1_000), "不可用的厂商不该进候选").toEqual([]);
  });
});
