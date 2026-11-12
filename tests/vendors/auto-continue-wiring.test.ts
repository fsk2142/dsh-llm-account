/**
 * 自动继续的**接线**（2026-11-12，A03 后续）。
 *
 * ## 被钉住的两个缺陷
 *
 * **① 只有 commandcode 接了。** `applyAutoContinue` 原本只在那一家的 `apply` 里调用，
 * opendesign / opencode 连调用都没有 —— 于是界面上可见的「自动继续」开关在那两家上
 * **从来不会生效**。
 *
 * **② 断流不在续写判据里。** `shouldContinueOnTruncate` 原来只认 `max-tokens` / `length`；
 * 我把断流改成 `finish: error`（A03）之后，断流就彻底落在自动续写覆盖之外。
 *
 * ## 这条用例固定什么
 *
 * 1. 断流码也被认定为「回答没写完」；
 * 2. **默认关闭**时一律不续写（用户选的 A 方案：尊重现有默认值，不擅自改动行为）；
 * 3. 次数上限仍然生效（断流不会变成无限续写）。
 */
import { describe, expect, it } from "vitest";

import { autoContinueEnabledOf } from "../../src/vendors/auto-continue-wiring";
import { shouldContinueOnTruncate } from "../../src/core/switching/auto-continue";

/** 一个「开启」的设置。 */
const ON = { enabled: true, maxAttempts: 3, intervalMs: 2_000 };

/** 一个「关闭」的设置。 */
const OFF = { enabled: false, maxAttempts: 3, intervalMs: 2_000 };

describe("断流也能触发续写（A03 后续）", () => {
  it("**`PROVIDER_STREAM_TRUNCATED` 也算「没写完」**", () => {
    expect(shouldContinueOnTruncate(ON, "PROVIDER_STREAM_TRUNCATED", 0)).toBe(true);
  });

  it("原有的两种信号仍然生效（不回归）", () => {
    expect(shouldContinueOnTruncate(ON, "max-tokens", 0)).toBe(true);
    expect(shouldContinueOnTruncate(ON, "length", 0)).toBe(true);
  });

  it("`stop` / `tool-calls` 仍然绝不续写", () => {
    expect(shouldContinueOnTruncate(ON, "stop", 0)).toBe(false);
    expect(shouldContinueOnTruncate(ON, "tool-calls", 0)).toBe(false);
    expect(shouldContinueOnTruncate(ON, "tool-call", 0)).toBe(false);
  });

  it("**开关关着时断流也不续写**（用户选的 A：默认行为不变）", () => {
    expect(shouldContinueOnTruncate(OFF, "PROVIDER_STREAM_TRUNCATED", 0)).toBe(false);
  });

  it("次数上限对断流同样生效（不会变成无限续写）", () => {
    expect(shouldContinueOnTruncate(ON, "PROVIDER_STREAM_TRUNCATED", 1)).toBe(true);
    expect(shouldContinueOnTruncate(ON, "PROVIDER_STREAM_TRUNCATED", 2)).toBe(true);
    expect(shouldContinueOnTruncate(ON, "PROVIDER_STREAM_TRUNCATED", 3)).toBe(false);
  });
});

describe("开关判定：显式值优先，旧字段作回退", () => {
  it("`autoContinue: true` → 开启", () => {
    expect(autoContinueEnabledOf({ autoContinue: true })).toBe(true);
  });

  it("**显式 `false` 优先于旧字段**（用户关了就不该被旧字段重新打开）", () => {
    expect(autoContinueEnabledOf({ autoContinue: false, autoContinueOnTruncate: true })).toBe(false);
  });

  it("旧字段任一为 true → 开启（升级兼容）", () => {
    expect(autoContinueEnabledOf({ autoContinueOnTruncate: true })).toBe(true);
    expect(autoContinueEnabledOf({ autoContinueOnError: true })).toBe(true);
  });

  it("什么都没有 → **关闭**（与 schema 的 default(false) 一致）", () => {
    expect(autoContinueEnabledOf({})).toBe(false);
  });
});
