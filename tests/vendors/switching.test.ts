/**
 * 切换控制器：只测「什么时候读额度、什么时候写选择、什么时候等回合结束」。
 * 判定本身在 `core/switching.ts` 里单测；这里用真实 `RotationEngine` + 假账号/额度/时钟。
 */
import { expect, it, vi } from "vitest";

import type { AccountView, QuotaSnapshot } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";
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
  refs?: string[];
  snapshot?: (ref: string) => Promise<QuotaSnapshot>;
  now?: () => number;
} = {}) {
  const refs = options.refs ?? ["a", "b", "c"];
  let pinned = options.pinned === undefined ? "a" : options.pinned;
  const engine = new RotationEngine({ order: refs, pinned: "a", rules: [] });
  engine.noteSelected("a");
  const rotation: RotationAccess = { current: () => engine, clearCredentialRejection: () => {} };
  const selects: string[] = [];
  const accounts = {
    list: async (): Promise<AccountView[]> =>
      refs.map((ref) => ({ ref, label: ref, configured: true, active: ref === pinned })),
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
      if (options.snapshot !== undefined) return options.snapshot(key);
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
  return { controller, engine, selects, pinned: () => pinned, quotaCalls, select: accounts.select, document };
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

it("额度优先：三个候选的额度读取同时开始，不逐个等待", async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let signalFirst!: () => void;
  const first = new Promise<void>((resolve) => { signalFirst = resolve; });
  const { controller } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    snapshot: async (ref) => {
      started.push(ref);
      if (ref === "a") signalFirst();
      await new Promise<void>((resolve) => releases.set(ref, resolve));
      return quota(50);
    },
  });

  const pending = controller.beforeRequest({ sessionId: "s1" });
  await first;
  expect(started.slice().sort(), "前三个候选必须都开始读，不能卡在第一个").toEqual(["a", "b", "c"]);
  for (const release of releases.values()) release();
  await pending;
});

it("额度优先：候选同时在途数量最多 4，其余按批次接力", async () => {
  const refs = ["a", "b", "c", "d", "e", "f"];
  const started: string[] = [];
  const gates = new Map<string, Promise<void>>();
  const releases = new Map<string, () => void>();
  for (const ref of refs) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    gates.set(ref, gate);
    releases.set(ref, release);
  }
  let active = 0;
  let maxActive = 0;
  let signalFirst!: () => void;
  let signalFifth!: () => void;
  const first = new Promise<void>((resolve) => { signalFirst = resolve; });
  const fifth = new Promise<void>((resolve) => { signalFifth = resolve; });
  const { controller } = harness({
    refs,
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    snapshot: async (ref) => {
      started.push(ref);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (started.length === 1) signalFirst();
      if (started.length === 5) signalFifth();
      await gates.get(ref)!;
      active -= 1;
      return quota(50);
    },
  });

  const pending = controller.beforeRequest({ sessionId: "s1" });
  await first;
  expect(started.length, "第一批最多同时读 4 个").toBe(4);
  expect(maxActive).toBe(4);

  releases.get("a")!();
  await fifth;
  expect(started.length, "释放一个后只补进一个，不能超过 4").toBe(5);
  expect(maxActive, "任何时刻在途数都不能超过 4").toBe(4);

  for (const [ref, release] of releases) if (ref !== "a") release();
  await pending;
  expect(started.slice().sort()).toEqual(refs.slice().sort());
});

it("非 best-quota 仍使用缓存额度：顺序切换跳过已耗尽账号", async () => {
  const { controller, engine, selects, document } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    quotas: { a: quota(50), b: quota(100), c: quota(60) },
  });
  await controller.beforeRequest({ sessionId: "s1" }); // 填充 a/b/c 的 TTL 缓存

  document.switchStrategy = "order";
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "s1" });

  expect(selects, "b 已缓存为额度耗尽，顺序模式必须跳过它").toEqual(["c"]);
});

it("当前账号读取失败时不重复补读", async () => {
  const { controller, engine, quotaCalls } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    quotas: { a: new Error("boom"), b: quota(10), c: quota(60) },
  });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });

  await controller.beforeRequest({ sessionId: "s1" });

  expect(quotaCalls.filter((ref) => ref === "a"), "候选池已经读过当前账号，失败也不能再补读一次").toHaveLength(1);
});

it("候选乱序完成仍按账号清单顺序打破并列", async () => {
  const started: string[] = [];
  const gates = new Map<string, Promise<void>>();
  const releases = new Map<string, () => void>();
  for (const ref of ["a", "b", "c"]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    gates.set(ref, gate);
    releases.set(ref, release);
  }
  let signalStarted!: () => void;
  const allStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  const { controller, engine, selects } = harness({
    document: { switchStrategy: "best-quota", switchAtTurnEnd: false, switchIntervalMinutes: 60 },
    snapshot: async (ref) => {
      started.push(ref);
      if (started.length === 3) signalStarted();
      await gates.get(ref)!;
      return ref === "a" ? quota(0) : quota(50);
    },
  });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });

  const pending = controller.beforeRequest({ sessionId: "s1" });
  await allStarted;
  releases.get("c")!(); // 后启动的 c 先完成
  await Promise.resolve();
  releases.get("b")!();
  releases.get("a")!();
  await pending;

  expect(selects, "b/c 额度相同，必须选清单里靠前的 b，不能按完成顺序选 c").toEqual(["b"]);
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

it("snapshot：额度优先给出下次评估时刻，手动顺序没有倒计时", async () => {
  let clock = 1_000;
  const best = harness({
    document: { switchStrategy: "best-quota", switchIntervalMinutes: 60, switchAtTurnEnd: true },
    now: () => clock,
  });
  expect(best.controller.snapshot().nextAt).toBe(1_000); // 还没评估：现在就该评估
  await best.controller.beforeRequest({ sessionId: "s1" });
  expect(best.controller.snapshot().nextAt).toBe(1_000 + 60 * 60_000);

  clock = 5_000;
  const order = harness({ document: { switchStrategy: "order", switchIntervalMinutes: 60 }, now: () => clock });
  await order.controller.beforeRequest({ sessionId: "s1" });
  expect(order.controller.snapshot().nextAt).toBeUndefined();
});

it("switchNow：手动顺序下强制切到下一个可用账号（原因 manual），并清掉 pending", async () => {
  let clock = 1_000;
  const { controller, engine, selects } = harness({ now: () => clock });

  // 没有 pending 时：强制轮换到下一个。
  await controller.switchNow();
  expect(selects).toEqual(["b"]);
  expect(engine.switchNotice()).toMatchObject({ fromRef: "a", toRef: "b", reason: "manual" });

  // 造一个 pending（回合内被拒），switchNow 应立刻应用而不是等 turn/end。
  const deferred = harness({ now: () => clock });
  await deferred.controller.beforeRequest({ sessionId: "s1" });
  deferred.engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await deferred.controller.beforeRequest({ sessionId: "s1" });
  expect(deferred.controller.snapshot().pending?.target).toBe("b");
  await deferred.controller.switchNow();
  expect(deferred.selects).toEqual(["b"]);
  expect(deferred.controller.snapshot().pending).toBeUndefined();
});

it("关闭自动切换会取消已排队的回合末切换", async () => {
  let clock = 1_000;
  const document: Record<string, unknown> = { autoSwitch: true, switchStrategy: "order", switchAtTurnEnd: true };
  const { controller, engine, selects } = harness({ document, now: () => clock });
  await controller.beforeRequest({ sessionId: "s1" });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(controller.snapshot().pending?.target).toBe("b");
  document.autoSwitch = false;
  clock = 2_000;
  controller.noteSessionEvent("s1", { type: "turn/end" });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(selects).toEqual([]);
  expect(controller.snapshot().pending).toBeUndefined();
  // 手动按钮仍应有效。
  await controller.switchNow();
  expect(selects).toEqual(["b"]);
});

it("读取额度期间关闭自动切换，读取完成后不会应用旧决定", async () => {
  const document: Record<string, unknown> = { autoSwitch: true, switchStrategy: "best-quota", switchAtTurnEnd: false };
  let release!: (value: QuotaSnapshot) => void;
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  const deferred = new Promise<QuotaSnapshot>((resolve) => { release = resolve; });
  const selects: string[] = [];
  const engine = new RotationEngine({ order: ["a", "b"], pinned: "a", rules: [] });
  const controller = new SwitchingController({
    document: () => document,
    pinnedRef: () => "a",
    accounts: {
      list: async () => ["a", "b"].map((ref) => ({ ref, label: ref, configured: true, active: ref === "a" })),
      select: async (ref) => { selects.push(ref!); },
    },
    rotation: { current: () => engine, clearCredentialRejection: () => {} },
    quota: { snapshot: async (ref) => {
      if (ref === "a") { reading(); return deferred; }
      return quota(10);
    } },
    now: () => 1_000,
  });
  const pending = controller.beforeRequest({ sessionId: "s1" });
  await started;
  document.autoSwitch = false;
  release(quota(90));
  await pending;
  expect(selects).toEqual([]);
  expect(controller.snapshot().pending).toBeUndefined();
});

it("pending automatic switching does not overwrite a later manual account selection", async () => {
  let clock = 1_000;
  const { controller, engine, selects, pinned, select } = harness({ now: () => clock });
  await controller.beforeRequest({ sessionId: "s1" });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(controller.snapshot().pending?.target).toBe("b");

  await select("c");
  clock = 2_000;
  controller.noteSessionEvent("s1", { type: "turn/end" });
  await controller.beforeRequest({ sessionId: "s1" });
  expect(selects).toEqual(["c"]);
  expect(pinned()).toBe("c");
  expect(controller.snapshot().pending).toBeUndefined();
});
