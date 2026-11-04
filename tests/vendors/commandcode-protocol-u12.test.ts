import { describe, expect, it } from "vitest";

import { resolveProtocol } from "../../src/vendors/commandcode/protocol";

/**
 * 强制协议设置必须生效（2026-11-04 外部审查 U12）。
 *
 * ## 审查原文
 *
 * > 配置 `protocol=messages`，非 Claude 模型仍发 `/chat/completions`；
 * > `resolveProtocol` 只处理强制 cli。
 *
 * 原来只认 `forced === "cli"`，`messages` 落进「按模型推断」分支 ——
 * 于是非 Claude 模型仍然走 openai。设置项**形同虚设**。
 */
const NON_CLAUDE = "deepseek/deepseek-v4.1-flash";
const CLAUDE = "claude-sonnet-4-5-20250929";

describe("U12 · 强制协议必须被尊重", () => {
  it("**forced=messages 对非 Claude 模型也生效**", () => {
    expect(resolveProtocol({ model: NON_CLAUDE, forced: "messages" })).toBe("messages");
  });

  it("**forced=openai 对 Claude 模型也生效**（反向也要尊重）", () => {
    // Claude 模型默认会推断成 messages；强制 openai 时必须听设置。
    expect(resolveProtocol({ model: CLAUDE, forced: "openai" })).toBe("openai");
  });

  it("forced=cli 照旧生效", () => {
    expect(resolveProtocol({ model: NON_CLAUDE, forced: "cli" })).toBe("cli");
  });

  it("**不强制时按模型推断**（不能把默认行为改坏）", () => {
    // Claude 走 messages 端点（需要 anthropic 形状）。
    expect(resolveProtocol({ model: CLAUDE })).toBe("messages");
    // 非 Claude 默认 openai。
    expect(resolveProtocol({ model: NON_CLAUDE })).toBe("openai");
  });

  it("`supportedEndpoints` 仍参与推断（不强制时）", () => {
    // 网关声明只有 /messages 时，非 Claude 也要走 messages。
    // （端点名的真实写法是 `/messages`，不是完整路径 —— 见 requiresMessagesEndpoint。）
    expect(resolveProtocol({ model: NON_CLAUDE, supportedEndpoints: ["/messages"] })).toBe("messages");
  });

  it("forced 优先级高于 supportedEndpoints", () => {
    expect(resolveProtocol({ model: NON_CLAUDE, forced: "openai", supportedEndpoints: ["/messages"] })).toBe(
      "openai",
    );
  });
});
