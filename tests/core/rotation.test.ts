import { expect, it } from "vitest";

import { rejection } from "../../src/core/failures";
import {
  MAX_SWITCH_NOTICES,
  MAX_TRIED,
  RATE_LIMIT_COOLDOWN_MS,
  RotationEngine,
} from "../../src/core/rotation";

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

it("rate-limit 带 resetAt 时到 resetAt 即恢复（修复轮 1 裁决：与 quota 对称）", () => {
  // resetAt 早于 5 分钟冷却：必须按 resetAt 放行，不能傻等冷却。
  let now = 1_000;
  const early = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  const resetAt = now + 20_000;
  early.markRejected("a", { kind: "rate-limit", message: "429", resetAt });
  now = resetAt - 1;
  expect(early.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now = resetAt;
  expect(early.pick({ model: "m", tried: new Set() })).toBe("a");

  // resetAt 晚于冷却：仍以 resetAt 为准，冷却到点不得提前放行。
  now = 1_000;
  const late = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  late.markRejected("a", { kind: "rate-limit", message: "429", resetAt: now + 2 * RATE_LIMIT_COOLDOWN_MS });
  now += RATE_LIMIT_COOLDOWN_MS;
  expect(late.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += RATE_LIMIT_COOLDOWN_MS;
  expect(late.pick({ model: "m", tried: new Set() })).toBe("a");
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

// —— Task 2：生效账号（effective account）与切换通知（规格 §8.1 第 1、3 条）——

it("没有任何请求时生效账号为 undefined（不编造）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  expect(e.effectiveAccount()).toBeUndefined();
  expect(e.switchNotice()).toBeUndefined();
  expect(e.switchNotices()).toEqual([]);
});

it("第一次选中即成为生效账号，且此时没有切换通知（没有「从谁切过来」）", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
  expect(e.effectiveAccount()).toEqual({ ref: "a", at: 1_000 });
  expect(e.switchNotice()).toBeUndefined();
});

it("额度拒绝后切到另一个账号：生效账号随之改变，并产生切换通知（谁→谁、原因、时间）", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  e.pick({ model: "m", tried: new Set() });
  now = 2_000;
  e.markRejected("a", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });

  // 换账号重试：调用方把 a 放进 tried（这是请求内核本来的做法）。
  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBe("b");
  expect(e.effectiveAccount()).toEqual({ ref: "b", at: 2_000 });
  expect(e.switchNotice()).toEqual({ fromRef: "a", toRef: "b", reason: "quota", at: 2_000 });
});

it("切换原因按拒绝分类映射：rate-limit 与 invalid-credential 都能被指名", () => {
  const cases = [
    { kind: "rate-limit", expected: "rate-limit" },
    { kind: "invalid-credential", expected: "invalid-credential" },
  ] as const;

  for (const { kind, expected } of cases) {
    const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
    e.pick({ model: "m", tried: new Set() });
    e.markRejected("a", { kind, message: kind });
    expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBe("b");
    expect(e.switchNotice()?.reason).toBe(expected);
  }
});

it("unavailable 造成的换号不算可指名的切换：生效账号更新，但不产出提示（不编造原因）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  e.pick({ model: "m", tried: new Set() });
  e.markRejected("a", { kind: "unavailable", message: "503" });

  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBe("b");
  expect(e.effectiveAccount()?.ref).toBe("b");
  expect(e.switchNotice()).toBeUndefined();
});

it("成功完成请求后生效账号更新为最近成功者（含时刻）", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  e.pick({ model: "m", tried: new Set() }); // 选中 a
  e.markRejected("a", { kind: "quota", message: "exhausted" });
  now = 2_000;
  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBe("b");
  expect(e.effectiveAccount()).toEqual({ ref: "b", at: 2_000 });

  // b 真的把请求服务完了：生效时刻推进到成功那一刻。
  now = 3_000;
  e.noteSettled("b");
  expect(e.effectiveAccount()).toEqual({ ref: "b", at: 3_000 });

  // 宿主报上来的成功者是另一个 ref 时，以它为准（这是最权威的信号）。
  now = 4_000;
  e.noteSettled("a");
  expect(e.effectiveAccount()).toEqual({ ref: "a", at: 4_000 });
});

it("手动切换产生原因为 manual 的切换通知", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });
  e.pick({ model: "m", tried: new Set() }); // a

  now = 2_000;
  e.noteManualSwitch("b");
  expect(e.effectiveAccount()).toEqual({ ref: "b", at: 2_000 });
  expect(e.switchNotice()).toEqual({ fromRef: "a", toRef: "b", reason: "manual", at: 2_000 });
});

it("手动切到当前生效账号不产生通知（没有变化就不提示）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  e.pick({ model: "m", tried: new Set() });

  e.noteManualSwitch("a");
  expect(e.effectiveAccount()?.ref).toBe("a");
  expect(e.switchNotice()).toBeUndefined();
});

it("noteSelected 可被调用方显式上报（宿主重放/指定账号的路径），且重复上报同一 ref 是恒等变换", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  e.noteSelected("b");
  expect(e.effectiveAccount()).toEqual({ ref: "b", at: 1_000 });
  expect(e.switchNotice()).toBeUndefined();

  e.markRejected("b", { kind: "rate-limit", message: "429" });
  now = 2_000;
  e.noteSelected("a");
  expect(e.switchNotice()).toEqual({ fromRef: "b", toRef: "a", reason: "rate-limit", at: 2_000 });

  // pick 已经记录过 a：再显式上报一次不得产生第二条通知。
  now = 3_000;
  e.noteSelected("a");
  expect(e.effectiveAccount()).toEqual({ ref: "a", at: 3_000 });
  expect(e.switchNotices()).toHaveLength(1);
});

it("pick 没有可选账号时不记录生效账号", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "invalid-credential", message: "401" });

  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  expect(e.effectiveAccount()).toBeUndefined();
});

it("切换记录最新在前，可供 Task 3 的 switches() 发布", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  e.pick({ model: "m", tried: new Set() }); // a
  now = 2_000;
  e.markRejected("a", { kind: "quota", message: "exhausted" });
  e.pick({ model: "m", tried: new Set(["a"]) }); // b，通知 1：a→b quota
  now = 3_000;
  e.noteManualSwitch("a"); // 通知 2：b→a manual

  expect(e.switchNotices().map((notice) => [notice.fromRef, notice.toRef, notice.reason])).toEqual([
    ["b", "a", "manual"],
    ["a", "b", "quota"],
  ]);
  expect(e.switchNotice()).toEqual({ fromRef: "b", toRef: "a", reason: "manual", at: 3_000 });
});

it("切换记录有上限，长驻进程里不会无限增长", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  e.pick({ model: "m", tried: new Set() }); // a

  // 反复手动切换，每次都是一个命名得清的 manual 切换。
  for (let index = 0; index < MAX_SWITCH_NOTICES + 10; index += 1) {
    e.noteManualSwitch(index % 2 === 0 ? "b" : "a");
  }

  expect(e.switchNotices()).toHaveLength(MAX_SWITCH_NOTICES);
  expect(e.switchNotice()!.reason).toBe("manual");
});

it("生效账号/切换记录的读取不会把内部状态交出去（返回副本）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  e.pick({ model: "m", tried: new Set() });
  e.markRejected("a", { kind: "quota", message: "exhausted" });
  e.pick({ model: "m", tried: new Set(["a"]) });

  const effective = e.effectiveAccount()!;
  effective.ref = "mutated";
  // 记录的字段可以被就地改写（同一个人写的测试代码也只能到这里），但引擎内部不受影响。
  const notices = e.switchNotices();
  (notices[0]! as { toRef: string }).toRef = "mutated";

  expect(e.effectiveAccount()!.ref).toBe("b");
  expect(e.switchNotice()!.toRef).toBe("b");
  expect(e.switchNotices()).not.toBe(notices);
});

it("引擎重建时可以继承观测状态：生效账号与切换记录都不丢，且继承不算一次切换", () => {
  let now = 1_000;
  const previous = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });
  previous.pick({ model: "m", tried: new Set() }); // a
  now = 2_000;
  previous.markRejected("a", { kind: "quota", message: "exhausted" });
  previous.pick({ model: "m", tried: new Set(["a"]) }); // b + 通知 a→b

  // 账号库状态变了（例如用户改了顺序）：装配层换一台新引擎，它当然是空的。
  const replacement = new RotationEngine({ order: ["b", "a"], pinned: null, rules: [], now: () => now });
  expect(replacement.effectiveAccount()).toBeUndefined();

  replacement.adoptObservations(previous);
  expect(replacement.effectiveAccount()).toEqual({ ref: "b", at: 2_000 });
  expect(replacement.switchNotices()).toEqual(previous.switchNotices());
  // 继承是搬运、不是切换：通知条数不变。
  expect(replacement.switchNotices()).toHaveLength(1);

  // 搬运之后仍按新引擎自己的时钟继续观察。
  now = 5_000;
  replacement.noteManualSwitch("a");
  expect(replacement.switchNotice()).toEqual({ fromRef: "b", toRef: "a", reason: "manual", at: 5_000 });
  expect(replacement.switchNotices()).toHaveLength(2);
});

it("noteAutoSwitch 记一条 balance 切换提示，不改拒绝表", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "a", rules: [] });
  e.noteSelected("a");
  e.noteAutoSwitch("b", "balance");
  expect(e.switchNotice()).toMatchObject({ fromRef: "a", toRef: "b", reason: "balance" });
  expect(e.rejections().size).toBe(0);
});