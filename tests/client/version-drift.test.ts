/**
 * 版本漂移检测（用户 2026-10-22 报障的修复）。
 *
 * 报障：「通过插件市场更新后如果不重启，侧边栏那里显示就会出现异常」，
 * 要求「更新完自动弹出提示框」让人刷新页面，而不是重启程序。
 *
 * 根因：宿主侧代码在更新时重新加载，而客户端 bundle 只在页面重载时重新求值。
 * 页面里跑旧 bundle、与新宿主通信时字段对不上 → 侧边栏渲染异常。
 */
import { describe, expect, it } from "vitest";

import { driftOf, driftPromptOf, versionsMatch } from "../../src/client/version-drift";

describe("版本比对", () => {
  it("完全相同算一致", () => {
    expect(versionsMatch("0.7.3", "0.7.3")).toBe(true);
  });

  it("**不同就算不一致**（只比相等，不比大小）", () => {
    // 目的是「页面跑的是不是同一份代码」，不是「哪个更新」。
    expect(versionsMatch("0.7.3", "0.7.4")).toBe(false);
    // 这个反例说明为什么不做语义化比较：0.7.3 与 0.7.30 是不同构建。
    expect(versionsMatch("0.7.3", "0.7.30")).toBe(false);
  });

  it("任一侧为空算不一致（宁可提示刷新，也不静默用旧代码）", () => {
    expect(versionsMatch("", "0.7.3")).toBe(false);
    expect(versionsMatch("0.7.3", "")).toBe(false);
    expect(versionsMatch("  ", "  ")).toBe(false);
  });

  it("首尾空白不影响判断", () => {
    expect(versionsMatch(" 0.7.3 ", "0.7.3")).toBe(true);
  });
});

describe("漂移结论", () => {
  it("一致 → same（不弹）", () => {
    expect(driftOf("0.7.3", { ok: true, version: "0.7.3" })).toEqual({ kind: "same", version: "0.7.3" });
  });

  it("**不一致 → stale（该弹）**", () => {
    expect(driftOf("0.7.3", { ok: true, version: "0.7.4" })).toEqual({
      kind: "stale",
      pageVersion: "0.7.3",
      diskVersion: "0.7.4",
    });
  });

  it("**读不到磁盘版本 → unknown（不弹）**", () => {
    // 老宿主没有这个接口、或请求失败：没有依据就不打扰用户。
    const result = driftOf("0.7.3", { ok: false, reason: "no such method" });
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") expect(result.reason).toBe("no such method");
  });
});

describe("提示文案", () => {
  const t = (key: string): string =>
    ({
      "drift.title": "插件已更新",
      "drift.body": "当前页面运行的是 {page}，磁盘上已是 {disk}。刷新后才能使用新功能。",
      "drift.reload": "立即刷新",
      "drift.later": "稍后",
    })[key] ?? key;

  it("stale 时给出完整文案，且版本号被填进去", () => {
    const prompt = driftPromptOf(t, { kind: "stale", pageVersion: "0.7.3", diskVersion: "0.7.4" });
    expect(prompt).toBeDefined();
    expect(prompt?.title).toBe("插件已更新");
    expect(prompt?.body).toContain("0.7.3");
    expect(prompt?.body).toContain("0.7.4");
    expect(prompt?.reload).toBe("立即刷新");
    expect(prompt?.later).toBe("稍后");
  });

  it("非 stale 时不弹（same / unknown 都返回 undefined）", () => {
    expect(driftPromptOf(t, { kind: "same", version: "0.7.3" })).toBeUndefined();
    expect(driftPromptOf(t, { kind: "unknown", pageVersion: "0.7.3", reason: "x" })).toBeUndefined();
  });
});
