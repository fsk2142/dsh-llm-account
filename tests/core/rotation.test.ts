import { expect, it } from "vitest";

import { rejection } from "../../src/core/failures";
import { MAX_TRIED, RATE_LIMIT_COOLDOWN_MS, RotationEngine } from "../../src/core/rotation";

it("按模型规则优先选择账号", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [{ models: ["m1"], account: "b" }] });
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("b");
});

it("固定账号优先，但被标记失效后回落到其它账号", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "b", rules: [] });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("b");
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: Date.now() + 60_000 });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("已尝试过的账号不重复选择；全部试过返回 undefined", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBeUndefined();
});

it("尝试上限为 16", () => {
  expect(MAX_TRIED).toBe(16);
});

it("已输出 / 已消耗 token / 已中止时禁止切换（Review Focus 2）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  expect(e.fallbackAllowed({ emitted: true, totalTokens: 0, aborted: false })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 12, aborted: false })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 0, aborted: true })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 0, aborted: false })).toBe(true);
});

it("invalid-credential 在凭据更新后清除标记", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "invalid-credential", message: "401" });
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  e.clearCredentialRejection("a");
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("rate-limit 冷却 5 分钟后自动恢复", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "rate-limit", message: "429" });
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += RATE_LIMIT_COOLDOWN_MS + 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

// —— 控制器裁决补充：六种 FailureKind 的拒绝生命周期 ——

it("quota 没有 resetAt 时按 RATE_LIMIT_COOLDOWN_MS 冷却", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "quota", message: "exhausted" });
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += RATE_LIMIT_COOLDOWN_MS - 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("quota 带 resetAt 时到 resetAt（毫秒）为止，到点即恢复", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });
  now += 59_999;
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("unavailable 与 quota 同规则：无 resetAt 按冷却，带 resetAt 到点恢复", () => {
  let now = 5_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "unavailable", message: "套餐不含该模型" });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("b");
  now += RATE_LIMIT_COOLDOWN_MS + 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");

  e.markRejected("a", { kind: "unavailable", message: "额度耗尽", resetAt: now + 30_000 });
  now += 29_999;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("b");
  now += 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("server 是瞬时失败：不进拒绝表，账号仍在轮换里", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "server", message: "500" });
  expect(e.rejections().size).toBe(0);
  expect(e.rejections().has("a")).toBe(false);
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("network 是瞬时失败：不进拒绝表，账号仍在轮换里", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "network", message: "ECONNRESET" });
  expect(e.rejections().size).toBe(0);
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});

it("瞬时失败既不写入也不清除既有拒绝条目", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });
  e.markRejected("a", { kind: "server", message: "500" });
  expect(e.rejections().get("a")?.kind).toBe("quota");
  e.markRejected("a", { kind: "network", message: "ETIMEDOUT" });
  expect(e.rejections().get("a")?.kind).toBe("quota");
});

it("clearCredentialRejection 只清 invalid-credential，对其它分类无效果", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b", "c", "d"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "invalid-credential", message: "401" });
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });
  e.markRejected("c", { kind: "rate-limit", message: "429" });
  e.markRejected("d", { kind: "unavailable", message: "套餐不含该模型" });

  e.clearCredentialRejection("a");
  expect(e.rejections().has("a")).toBe(false);

  for (const ref of ["b", "c", "d"]) {
    e.clearCredentialRejection(ref);
    expect(e.rejections().has(ref)).toBe(true);
  }
  // 清不掉的条目仍然挡住轮换：只试 a 时无账号可选。
  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBeUndefined();
  // 清除不存在的 ref 是恒等变换。
  e.clearCredentialRejection("nope");
  expect(e.rejections().size).toBe(3);
});

it("规则账号已被拒绝时继续往固定 → 顺序走，而不是直接返回 undefined", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "b", rules: [{ models: ["m1"], account: "b" }] });
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: Date.now() + 60_000 });
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("a");
});

it("规则账号已在 tried 中时同样继续往固定 → 顺序走", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [{ models: ["m1"], account: "b" }] });
  expect(e.pick({ model: "m1", tried: new Set(["b"]) })).toBe("a");
});

it("pick 惰性清理已过期条目，且不改动调用方的 order / rules / tried", () => {
  let now = 1_000;
  const order = ["a", "b"];
  const rules = [{ models: ["m1"], account: "b" }];
  const tried = new Set<string>();
  const e = new RotationEngine({ order, pinned: null, rules, now: () => now });

  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });
  expect(e.pick({ model: "m1", tried })).toBe("a");
  expect(e.rejections().has("b")).toBe(true);

  now += 60_000;
  expect(e.pick({ model: "m1", tried })).toBe("b");
  expect(e.rejections().has("b")).toBe(false);

  expect(order).toEqual(["a", "b"]);
  expect(rules).toEqual([{ models: ["m1"], account: "b" }]);
  expect([...tried]).toEqual([]);
});

it("rejection() 只在给出 resetAt 时带上该字段", () => {
  expect(rejection("rate-limit", "429")).toEqual({ kind: "rate-limit", message: "429" });
  expect(rejection("quota", "exhausted", 42)).toEqual({ kind: "quota", message: "exhausted", resetAt: 42 });
  expect("resetAt" in rejection("quota", "exhausted")).toBe(false);
});
