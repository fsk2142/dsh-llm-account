/**
 * 搜索选路：两条路 + 用户可选的优先策略（2026-10-20 用户要求）。
 *
 * 用户原话：「我怎么添加我的 deepseek search api 呢，网关那个也要保留，我自己手动填写 api
 * 就可以，然后加一个策略选择，可以选优先使用哪一个」。
 *
 * 两条路的本质区别（官方文档确认）：
 * - **网关路**：模型在对话里调用服务端工具 `web_search_20250305`。按 token 计费，
 *   一次搜索 = 一次完整模型调用（贵、慢、结果夹在对话里）。
 * - **API 路**：直接 `POST /v1/tools/search`。每 1000 次成功请求 5 元，不看 token，
 *   返回结构化 `results[]`。
 *
 * 所以策略必须由用户选：便宜还是「不额外花钱（用订阅额度）」。
 */
import { describe, expect, it } from "vitest";

import { chooseSearchRoute, isDeepSeekModel, SEARCH_STRATEGIES, type SearchRouteInput } from "../../../src/core/switching/search-route";

/** 一份「两条路都可用」的输入。 */
const BOTH: Omit<SearchRouteInput, "strategy"> = {
  provider: "opendesign",
  model: "deepseek-v4.1-flash",
  hasApiKey: true,
  hasGateway: true,
};

describe("策略取值", () => {
  it("四种策略：网关优先 / API 优先 / 只用网关 / 只用 API", () => {
    expect(SEARCH_STRATEGIES).toEqual(["gateway-first", "api-first", "gateway-only", "api-only"]);
  });

  it("线上值不可信：不认识的策略按「网关优先」处理（最保守，不额外花钱）", () => {
    expect(chooseSearchRoute({ ...BOTH, strategy: "nonsense" as never })).toEqual({
      kind: "gateway",
      provider: "opendesign",
    });
  });
});

describe("gateway-first（默认）", () => {
  it("两条都可用 → 走网关（用订阅额度）", () => {
    expect(chooseSearchRoute({ ...BOTH, strategy: "gateway-first" })).toEqual({
      kind: "gateway",
      provider: "opendesign",
    });
  });

  it("网关不可用（非 opendesign / 非 DeepSeek）→ 回退 API", () => {
    expect(chooseSearchRoute({ ...BOTH, provider: "commandcode", strategy: "gateway-first" })).toEqual({ kind: "api" });
    expect(chooseSearchRoute({ ...BOTH, model: "glm-5.3-flash", strategy: "gateway-first" })).toEqual({ kind: "api" });
  });

  it("API key 缺失但网关可用 → 走网关（这正是「用订阅额度」的收益）", () => {
    expect(chooseSearchRoute({ ...BOTH, hasApiKey: false, strategy: "gateway-first" })).toEqual({
      kind: "gateway",
      provider: "opendesign",
    });
  });
});

describe("api-first", () => {
  it("两条都可用 → 走 API（省 token、结果结构更好）", () => {
    expect(chooseSearchRoute({ ...BOTH, strategy: "api-first" })).toEqual({ kind: "api" });
  });

  it("API key 缺失 → 回退网关", () => {
    expect(chooseSearchRoute({ ...BOTH, hasApiKey: false, strategy: "api-first" })).toEqual({
      kind: "gateway",
      provider: "opendesign",
    });
  });

  it("网关不可用也不影响（本来就走 API）", () => {
    expect(chooseSearchRoute({ ...BOTH, provider: "commandcode", strategy: "api-first" })).toEqual({ kind: "api" });
  });
});

describe("gateway-only：不允许回退", () => {
  it("网关可用 → 走网关", () => {
    expect(chooseSearchRoute({ ...BOTH, strategy: "gateway-only" })).toEqual({
      kind: "gateway",
      provider: "opendesign",
    });
  });

  it("网关不可用 → **明确失败**，不偷偷用 API（用户选了「只用网关」）", () => {
    expect(chooseSearchRoute({ ...BOTH, provider: "commandcode", strategy: "gateway-only" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("api-only：不允许回退", () => {
  it("有 API key → 走 API", () => {
    expect(chooseSearchRoute({ ...BOTH, strategy: "api-only" })).toEqual({ kind: "api" });
  });

  it("没有 API key → 明确失败，不偷偷用网关", () => {
    expect(chooseSearchRoute({ ...BOTH, hasApiKey: false, strategy: "api-only" })).toEqual({ kind: "unavailable" });
  });
});

describe("两条都不可用", () => {
  it("任何策略下都返回 unavailable（不发注定失败的请求）", () => {
    for (const strategy of SEARCH_STRATEGIES) {
      expect(
        chooseSearchRoute({ provider: "commandcode", model: "x", hasApiKey: false, hasGateway: false, strategy }),
        strategy,
      ).toEqual({ kind: "unavailable" });
    }
  });
});

describe("网关可用性由显式标记决定（不再只看 provider 名）", () => {
  it("provider 是 opendesign 但用户没配网关账号 → hasGateway=false 时不走网关", () => {
    expect(chooseSearchRoute({ ...BOTH, hasGateway: false, strategy: "gateway-first" })).toEqual({ kind: "api" });
  });

  it("isDeepSeekModel 仍然用来判断模型族（厂商专属能力）", () => {
    expect(isDeepSeekModel("deepseek-v4.1-flash")).toBe(true);
    expect(isDeepSeekModel("glm-5.3-flash")).toBe(false);
  });
});
