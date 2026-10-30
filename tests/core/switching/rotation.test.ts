import { expect, it } from "vitest";

import { rejection } from "../../../src/core/failures";
import {
  MAX_SWITCH_NOTICES,
  MAX_TRIED,
  RATE_LIMIT_COOLDOWN_MS,
  RotationEngine,
} from "../../../src/core/switching/rotation";

it("按模型规则优先选择账号", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [{ models: ["m1"], account: "b" }] });
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("b");
});

it("同一模型分配给多个账号时按全局顺序选，第一个试过后换下一个", () => {
  const e = new RotationEngine({
    order: ["a", "b"],
    pinned: null,
    rules: [
      { models: ["m1"], account: "b" },
      { models: ["m1"], account: "a" },
    ],
  });
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("a");
  expect(e.pick({ model: "m1", tried: new Set(["a"]) })).toBe("b");
});

it("**用户选定的账号永远优先**，即使模型绑给了别的账号（2026-10-22 改）", () => {
  // 旧口径是「模型绑定的账号优先于 pinned」，导致用户报「我选定了 A，请求却走了 B」。
  // 现在：人的显式选择比规则表权威。
  const e = new RotationEngine({
    order: ["a", "b"],
    pinned: "b",
    rules: [
      { models: ["m1"], account: "a" },
      { models: ["m1"], account: "b" },
    ],
  });
  expect(e.pick({ model: "m1", tried: new Set() }), "选定的 b 在绑定列表里 → 优先它").toBe("b");

  const other = new RotationEngine({
    order: ["a", "b"],
    pinned: "b",
    // 模型 m2 只绑给了 a —— 但用户选定的是 b，仍然先用 b。
    rules: [{ models: ["m2"], account: "a" }],
  });
  expect(other.pick({ model: "m2", tried: new Set() }), "选定的账号不在绑定列表里也优先").toBe("b");

  // 试过 b 之后才回落到模型绑定的 a。
  expect(other.pick({ model: "m2", tried: new Set(["b"]) })).toBe("a");
});

it("固定账号优先；**拒绝表不再让它回落**（2026-10-30）", () => {
  /**
   * 用户要求「不要拒绝表，直接更换下一个」：拒绝记录只用于界面说明，
   * **不再参与选号**。所以固定账号即使被标记，下一次 `pick` 仍返回它 ——
   * 真正「换下一个」发生在同一次请求内（`tried` 里有它之后）。
   */
  const e = new RotationEngine({ order: ["a", "b"], pinned: "b", rules: [] });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("b");
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: Date.now() + 60_000 });
  expect(e.pick({ model: "m", tried: new Set() }), "跨请求不记忆失败").toBe("b");
  expect(e.pick({ model: "m", tried: new Set(["b"]) }), "同请求内换下一个").toBe("a");
  expect(e.rejections().has("b"), "但记录仍保留（界面用）").toBe(true);
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

it("invalid-credential 记录可在凭据更新后清除（但选号不依赖它）", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "invalid-credential", message: "401" });
  // 2026-10-30：拒绝记录不再挡选号 —— 单账号场景下挡了就等于「完全不可用」。
  expect(e.pick({ model: "m", tried: new Set() }), "记录不影响选号").toBe("a");
  expect(e.rejections().has("a"), "但记录仍在").toBe(true);
  e.clearCredentialRejection("a");
  expect(e.rejections().has("a"), "清除后记录消失").toBe(false);
});

it("拒绝记录的过期规则仍按分类计算（供界面显示，不影响选号）", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });

  // rate-limit 无 resetAt → 冷却 RATE_LIMIT_COOLDOWN_MS
  e.markRejected("a", { kind: "rate-limit", message: "429" });
  expect(e.rejections().has("a")).toBe(true);
  now += RATE_LIMIT_COOLDOWN_MS + 1;
  expect(e.rejections().has("a"), "冷却到点后记录消失").toBe(false);

  // quota 带 resetAt → 到点为止
  now = 1_000;
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: now + 60_000 });
  now += 59_999;
  expect(e.rejections().has("b"), "未到 resetAt").toBe(true);
  now += 1;
  expect(e.rejections().has("b"), "到 resetAt 后消失").toBe(false);
});

it("**同一次请求内**按顺序换下一个账号（这才是真正的「换号」）", () => {
  const e = new RotationEngine({ order: ["a", "b", "c"], pinned: null, rules: [] });
  const tried = new Set<string>();
  expect(e.pick({ model: "m", tried })).toBe("a");
  tried.add("a");
  expect(e.pick({ model: "m", tried })).toBe("b");
  tried.add("b");
  expect(e.pick({ model: "m", tried })).toBe("c");
  tried.add("c");
  expect(e.pick({ model: "m", tried }), "全试过返回 undefined").toBeUndefined();
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
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });
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
    // 2026-10-30：记录不再挡选号 —— 只试过 a 时按顺序给 b。
    expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBe("b");
  // 清除不存在的 ref 是恒等变换。
  e.clearCredentialRejection("nope");
  expect(e.rejections().size).toBe(3);
});

it("规则账号被标记后**仍优先**；换下一个靠 tried（2026-10-30）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "b", rules: [{ models: ["m1"], account: "b" }] });
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: Date.now() + 60_000 });
  // 记录不参与选号：规则账号照样被选中。
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("b");
  // 同一次请求内试过它之后才轮到下一个。
  expect(e.pick({ model: "m1", tried: new Set(["b"]) })).toBe("a");
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
  // 记录不参与选号：规则账号 b 仍被选中；只验证「读数时会惰性清理过期条目」。
  expect(e.rejections().has("b")).toBe(true);

  now += 60_000;
  expect(e.pick({ model: "m1", tried })).toBe("b");
  expect(e.rejections().has("b"), "过期条目在读取时被清掉").toBe(false);

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

it("pick 没有可选账号时不记录生效账号（全部在 tried 里）", () => {
  // 2026-10-30：拒绝表不再挡选号，所以「无账号可选」只能由 tried 全部覆盖造成。
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });

  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBeUndefined();
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
it("**pinned 是空串时跳过它**（不拿空 ref 去查凭据 / 污染拒绝表）", () => {
  // 设置文档的顶层 apiKeyEnv 可能被手改坏或半截写入成空串。
  // 旧行为：pick 返回 ""，适配器拿它去查凭据 → 必然失败 → 往拒绝表里写一条
  // **永不过期**的 `invalid-credential` 脏条目，还多记一条失败用量。
  const e = new RotationEngine({ order: ["a", "b"], pinned: "", rules: [] });
  expect(e.pick({ model: "m", tried: new Set() }), "空 ref 不该被选中").toBe("a");
});

it("pinned 是纯空白时同样跳过", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "   ", rules: [] });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});
