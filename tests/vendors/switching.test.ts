/**
 * 切换控制器：只测「什么时候读额度、什么时候写选择、什么时候等回合结束」。
 * 判定本身在 `core/switching.ts` 里单测；这里用真实 `RotationEngine` + 假账号/额度/时钟。
 */
import { expect, it, vi } from "vitest";

import type { AccountView, QuotaSnapshot } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/rotation";
import type { RotationAccess } from "../../src/vendors/assembly";
import { SwitchingController, isTurnEndEvent } from "../../src/vendors/switching";

/** 80% 已用 → 剩 20%。 */
function quota(percent: number): QuotaSnapshot {
  return { windows: [{ key: "monthly", percent }], failures: [] };
}

/** 构造控制器与可观察的假件。 */
function harness(options: {
  document?: Record<string, unknown>;
  pinned?: string | null;
  quotas?: Record<string, QuotaSnapshot | Error>;
  now?: () => number;
} = {}) {
  let pinned = options.pinned === undefined ? "a" : options.pinned;
  const engine = new RotationEngine({ order: ["a", "b", "c"], pinned: "a", rules: [] });
  engine.noteSelected("a");
  const rotation: RotationAccess = { current: () => engine, clearCredentialRejection: () => {} };
  const selects: string[] = [];
  const accounts = {
    list: async (): Promise<AccountView[]> =>
      ["a", "b", "c"].map((ref) => ({ ref, label: ref, configured: true, active: ref === pinned })),
    select: async (ref: string | null): Promise<void> => {
      selects.push(ref ?? "null");
      pinned = ref;
    },
  };
  const quotaCalls: string[] = [];
  const quotaPort = {
    snapshot: async (ref?: string): Promise<QuotaSnapshot> => {
      const key = ref ?? pinned ?? "a";
      quotaCalls.push(key);
      const value = options.quotas?.[key];
      if (value instanceof Error) throw value;
      return value ?? quota(50);
    },
  };
  const document = options.document ?? { switchStrategy: "order", switchAtTurnEnd: true, switchIntervalMinutes: 60 };
  const controller = new SwitchingController({
    accounts,
    quota: quotaPort,
    rotation,
    document: () => document,
    pinnedRef: () => pinned,
    now: options.now,
    warn: vi.fn(),
  });
  return { controller, engine, selects, pinned: () => pinned, quotaCalls };
}

it("isTurnEndEvent：认 turn/end（含事件包一层），不认其它事件", () => {
  expect(isTurnEndEvent({ type: "turn/end" })).toBe(true);
  expect(isTurnEndEvent({ type: "turn_end" })).toBe(true);
  expect(isTurnEndEvent({ event: { type: "turn/end" } })).toBe(true);
  expect(isTurnEndEvent({ type: "step/end" })).toBe(false);
  expect(isTurnEndEvent(undefined)).toBe(false);
  expect(isTurnEndEvent("turn/end")).toBe(false);
});

it("noteHostEvent：兼容 (sessionId, event) 与 ({ sessionId, event }) 两种参数形状", async () => {
  let clock = 1_000;
  const { controller, engine, selects } = harness({ now: () => clock });
  await controller.beforeRequest({ sessionId: "s1" });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(selects).toEqual([]);

  clock = 2_000;
  controller.noteHostEvent({ sessionId: "s1", event: { type: "turn/end" } });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(selects).toEqual(["b"]);
});

it("noteHostEvent：宿主的 (session 对象, 事件) 形状也能识别", async () => {
  let clock = 1_000;
  const { controller, engine, selects } = harness({ now: () => clock });
  await controller.beforeRequest({ sessionId: "sess-1" });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "sess-1" });
  expect(selects).toEqual([]);

  clock = 2_000;
  controller.noteHostEvent({ id: "sess-1" }, { type: "turn/end", data: {} });
  await controller.beforeRequest({ sessionId: "sess-1" });
  expect(selects).toEqual(["b"]);
});

it("手动顺序：当前账号被拒后切到顺序里的下一个，并记一条 quota 提示", async () => {
  const { controller, engine, selects } = harness();
  engine.markRejected("a", { kind: "quota", message: "exhausted" });

  // 首次请求没有「上一回合」可言，视为回合末：立即应用。
  await controller.beforeRequest({ sessionId: "s1" });

  expect(selects).toEqual(["b"]);
  expect(engine.switchNotice()).toMatchObject({ fromRef: "a", toRef: "b", reason: "quota" });
});

it("回合末切换：回合内先记 pending，收到 turn/end 后的下一次请求才写选择", async () => {
  let clock = 1_000;
  const { controller, engine, selects } = harness({ now: () => clock });
  await controller.beforeRequest({ sessionId: "s1" }); // 这一回合的第一个请求，没有要切的

  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "s1" }); // 同一回合内：不切
  expect(selects).toEqual([]);

  clock = 2_000;
  controller.noteSessionEvent("s1", { type: "turn/end" });
  await controller.beforeRequest({ sessionId: "s1" }); // 新回合：应用 pending
  expect(selects).toEqual(["b"]);
});

it("额度优先：到期且另一个账号明显更充足时切过去，原因是 balance", async () => {
  const { controller, engine, selects, quotaCalls } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: true, switchIntervalMinutes: 60 },
    quotas: { a: quota(80), b: quota(20), c: quota(60) },
  });

  await controller.beforeRequest({ sessionId: "s1" });

  expect(selects).toEqual(["b"]);
  expect(engine.switchNotice()).toMatchObject({ fromRef: "a", toRef: "b", reason: "balance" });
  // 三个账号都读了（a 当前 + b/c 候选）；没有额度读数就没法比较。
  expect(quotaCalls.sort()).toEqual(["a", "b", "c"]);
});

it("普通对话以外（title/compaction）不读也不切", async () => {
  const { controller, engine, selects, quotaCalls } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 0 },
  });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });

  await controller.beforeRequest({ sessionId: "s1", purpose: "title" });

  expect(selects).toEqual([]);
  expect(quotaCalls).toEqual([]);
});

it("没有固定的当前账号时不主动切（交给轮换引擎自动选）", async () => {
  const { controller, selects } = harness({ pinned: null });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(selects).toEqual([]);
});

it("额度优先时某个候选读取失败不拖垮整次评估", async () => {
  const { controller, engine, selects } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    quotas: { a: quota(80), b: new Error("boom"), c: quota(60) },
  });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });

  await controller.beforeRequest({ sessionId: "s1" });

  // a 已耗尽；b 读失败（未知，不当作 0）；c 最充足 → c。
  expect(selects).toEqual(["c"]);
});
