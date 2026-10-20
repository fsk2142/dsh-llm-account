/**
 * 统一搜索的**选路判定**（纯函数）—— 2026-10-20 用户要求。
 *
 * 用户原话：「统一都用 deepseek 的搜索，API 优先用我们登录的供应商账号额度，
 * 如果没有就使用我们自己添加的 API 调用搜索」。
 *
 * 实测结论（用真实密钥打的，见设计文档 §2.2）：
 * - opendesign 的 `/v1/messages` + `web_search_20250305` + **DeepSeek 系模型** → 真能搜（20 条结果）；
 * - 同一端点 + glm / claude → 400；
 * - chat/completions 形状 → **200 但静默忽略**，模型只是输出「web_search query:」文本。
 *
 * 所以选路不能只看「有没有配 key」，必须看**当前会话是哪家网关、哪个模型**。
 */
import { describe, expect, it } from "vitest";

import { chooseSearchRoute, isDeepSeekModel } from "../../../src/core/switching/search-route";

describe("DeepSeek 系模型判定", () => {
  it("短 id 与带公司前缀的写法都算", () => {
    expect(isDeepSeekModel("deepseek-v4.1-flash")).toBe(true);
    expect(isDeepSeekModel("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(isDeepSeekModel("deepseek-v4-pro")).toBe(true);
    expect(isDeepSeekModel("deepseek-flash")).toBe(true);
  });

  it("非 DeepSeek 模型不算（实测这些在网关上搜不了）", () => {
    expect(isDeepSeekModel("glm-5.3-flash")).toBe(false);
    expect(isDeepSeekModel("claude-haiku-5.5")).toBe(false);
    expect(isDeepSeekModel("gpt-6-luna")).toBe(false);
    expect(isDeepSeekModel("kimi-k2.7-code")).toBe(false);
  });

  it("大小写与空白不影响", () => {
    expect(isDeepSeekModel("  DeepSeek-V4-Pro  ")).toBe(true);
  });
});

describe("选路：网关额度优先，否则 API key", () => {
  it("opendesign + DeepSeek 模型 + 允许网关 → 走网关", () => {
    const route = chooseSearchRoute({
      provider: "opendesign",
      model: "deepseek-v4.1-flash",
      preferGateway: true,
      hasApiKey: true,
    });
    expect(route).toEqual({ kind: "gateway", provider: "opendesign" });
  });

  it("opendesign 但模型不是 DeepSeek → 回退 API（网关上那些模型搜不了）", () => {
    const route = chooseSearchRoute({
      provider: "opendesign",
      model: "glm-5.3-flash",
      preferGateway: true,
      hasApiKey: true,
    });
    expect(route).toEqual({ kind: "api" });
  });

  it("commandcode → 永远回退 API（实测它的 /messages 只收 Claude 系，DeepSeek 走不了服务端搜索）", () => {
    const route = chooseSearchRoute({
      provider: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
      preferGateway: true,
      hasApiKey: true,
    });
    expect(route).toEqual({ kind: "api" });
  });

  it("用户关掉「优先网关」→ 直接用 API", () => {
    const route = chooseSearchRoute({
      provider: "opendesign",
      model: "deepseek-v4.1-flash",
      preferGateway: false,
      hasApiKey: true,
    });
    expect(route).toEqual({ kind: "api" });
  });

  it("没有 API key 且走不了网关 → 无可用路线（明确失败，不静默）", () => {
    const route = chooseSearchRoute({
      provider: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
      preferGateway: true,
      hasApiKey: false,
    });
    expect(route).toEqual({ kind: "unavailable" });
  });

  it("会话还没有路由信息（首帧）→ 按 API 处理（保守：不去猜网关）", () => {
    const route = chooseSearchRoute({ provider: undefined, model: undefined, preferGateway: true, hasApiKey: true });
    expect(route).toEqual({ kind: "api" });
  });

  it("网关可用时不需要 API key 也能搜（这正是「优先用订阅额度」的收益）", () => {
    const route = chooseSearchRoute({
      provider: "opendesign",
      model: "deepseek-v4.1-flash",
      preferGateway: true,
      hasApiKey: false,
    });
    expect(route).toEqual({ kind: "gateway", provider: "opendesign" });
  });
});
