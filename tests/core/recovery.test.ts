import { expect, it } from "vitest";

import { IntentLog, type AccountIntent, type IntentStore } from "../../src/core/recovery";

/**
 * 内存存储端口：`read`/`write` 都收发副本，用来验证日志不泄漏内部对象。
 * `writeCount` 记录落盘次数，用来验证「每轮落盘」而不是最后一次性写。
 */
interface MemoryStore extends IntentStore {
  snapshot(): AccountIntent[];
  writeCount(): number;
}

function memoryStore(initial: readonly AccountIntent[] = []): MemoryStore {
  let state: AccountIntent[] = initial.map((intent) => ({ ...intent }));
  let writes = 0;
  return {
    read: async () => state.map((intent) => ({ ...intent })),
    write: async (intents) => {
      writes += 1;
      state = intents.map((intent) => ({ ...intent }));
    },
    snapshot: () => state.map((intent) => ({ ...intent })),
    writeCount: () => writes,
  };
}

/** 写入永远失败：模拟磁盘/设置端口崩溃，用于验证错误不会被静默吞掉。 */
function failingStore(initial: readonly AccountIntent[] = []): IntentStore {
  const inner = memoryStore(initial);
  return {
    read: () => inner.read(),
    write: async () => {
      throw new Error("boom: store write failed");
    },
  };
}

function intent(id: string, kind: AccountIntent["kind"], createdAt: number): AccountIntent {
  return { id, kind, createdAt };
}

/** 手动闸门：把并发交错固定在确定的位置上，不依赖任何计时器。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * 首写闸门存储：第一次 `write` 会挂起，直到调用 `release()`；`entered` 在该写被发起时
 * resolve。用来在「append 的落盘」与「replay 的本轮落盘」之间插入一个确定的交错点。
 */
function gatedFirstWriteStore(initial: readonly AccountIntent[]) {
  const inner = memoryStore(initial);
  const entered = deferred<void>();
  const released = deferred<void>();
  let writes = 0;
  const store: IntentStore = {
    read: () => inner.read(),
    write: async (intents) => {
      writes += 1;
      if (writes === 1) {
        entered.resolve();
        await released.promise;
      }
      await inner.write(intents);
    },
  };
  return {
    store,
    entered: entered.promise,
    release: () => released.resolve(),
    snapshot: () => inner.snapshot(),
  };
}

it("重放后已提交的意图被清除，未提交的保留", async () => {
  const store = memoryStore([
    { id: "1", kind: "add", label: "A", createdAt: 1 },
    { id: "2", kind: "remove", ref: "r", createdAt: 2 },
  ]);
  const log = new IntentLog(store);
  const report = await log.replay(async (i) => (i.kind === "add" ? "applied" : "unknown"));
  expect(report).toEqual({ applied: 1, rejected: 0, unknown: 1, remaining: 1 });
  expect((await log.list()).map((i) => i.id)).toEqual(["2"]);
});

it("重放最多 4 轮，避免死循环（Review Focus 5：冲突后重放而不是覆盖）", async () => {
  const store = memoryStore([{ id: "1", kind: "add", label: "A", createdAt: 1 }]);
  let calls = 0;
  const report = await new IntentLog(store).replay(async () => {
    calls += 1;
    return "unknown";
  });
  expect(calls).toBeLessThanOrEqual(4);
  expect(report.remaining).toBe(1);
});

it("append → list 往返：按插入顺序返回，且返回的是副本", async () => {
  const log = new IntentLog(memoryStore());
  const first = intent("1", "add", 3);
  await log.append(first);
  await log.append({ id: "2", kind: "rename", ref: "r1", label: "B", createdAt: 1 });
  await log.append({ id: "3", kind: "move", ref: "r2", toIndex: 0, createdAt: 2 });

  // 插入顺序即顺序，不按 createdAt 排序（回放要按因果顺序，不是墙钟顺序）。
  expect((await log.list()).map((i) => i.id)).toEqual(["1", "2", "3"]);

  // 调用方改返回的数组或对象，都改不动日志内部。
  const listed = await log.list();
  listed.pop();
  listed[0].label = "被污染的标签";
  expect((await log.list()).map((i) => i.id)).toEqual(["1", "2", "3"]);
  expect((await log.list())[0].label).toBeUndefined();

  // append 之后再改入参对象，也改不动日志内部。
  first.label = "又一次污染";
  expect((await log.list())[0].label).toBeUndefined();
});

it("settle 只移除指定意图；不存在的 id 是无操作（不抛错、不落盘）", async () => {
  const store = memoryStore([intent("1", "add", 1), intent("2", "remove", 2), intent("3", "rename", 3)]);
  const log = new IntentLog(store);
  await log.settle("2");
  expect((await log.list()).map((i) => i.id)).toEqual(["1", "3"]);

  const writesBefore = store.writeCount();
  await expect(log.settle("并不存在")).resolves.toBeUndefined();
  expect((await log.list()).map((i) => i.id)).toEqual(["1", "3"]);
  expect(store.writeCount()).toBe(writesBefore);
});

it("rejected 与 applied 都从日志移除，unknown 保留；ReplayReport 四个字段分别计时", async () => {
  const store = memoryStore([intent("1", "add", 1), intent("2", "remove", 2), intent("3", "rename", 3)]);
  const log = new IntentLog(store);
  const report = await log.replay(async (i) => {
    if (i.kind === "add") return "applied";
    if (i.kind === "remove") return "rejected";
    return "unknown";
  });
  expect(report).toEqual({ applied: 1, rejected: 1, unknown: 1, remaining: 1 });
  expect((await log.list()).map((i) => i.id)).toEqual(["3"]);
});

it("连续两次 replay：全部提交后第二次不再调用 apply（调用次数不增加）", async () => {
  const log = new IntentLog(memoryStore([intent("1", "add", 1), intent("2", "rename", 2)]));
  let calls = 0;
  const apply = async (): Promise<"applied"> => {
    calls += 1;
    return "applied";
  };

  expect(await log.replay(apply)).toEqual({ applied: 2, rejected: 0, unknown: 0, remaining: 0 });
  expect(calls).toBe(2);

  // 已提交的意图都已从日志移除：第二次 replay 无可重放，apply 一次都不再被调用。
  expect(await log.replay(apply)).toEqual({ applied: 0, rejected: 0, unknown: 0, remaining: 0 });
  expect(calls).toBe(2);
  expect(await log.list()).toEqual([]);
});

it("连续两次 replay：已提交的意图不会重复应用（未决的仍会重放）", async () => {
  const log = new IntentLog(memoryStore([intent("1", "add", 1), intent("2", "remove", 2)]));
  const appliedIds: string[] = [];
  const apply = async (i: AccountIntent): Promise<"applied" | "unknown"> => {
    appliedIds.push(i.id);
    return i.kind === "add" ? "applied" : "unknown";
  };

  expect(await log.replay(apply)).toEqual({ applied: 1, rejected: 0, unknown: 1, remaining: 1 });
  expect(appliedIds).toEqual(["1", "2"]);

  // 第二次只重放上一轮未决的 "2"；已提交的 "1" 不再被应用。
  expect(await log.replay(apply)).toEqual({ applied: 0, rejected: 0, unknown: 1, remaining: 1 });
  expect(appliedIds).toEqual(["1", "2", "2"]);
  expect(appliedIds.filter((id) => id === "1")).toEqual(["1"]);
});

it("重放期间追加的意图不会被吞掉", async () => {
  const store = memoryStore([intent("1", "add", 1)]);
  const log = new IntentLog(store);
  const seen: string[] = [];
  const report = await log.replay(async (i) => {
    seen.push(i.id);
    if (i.id === "1") {
      await log.append(intent("2", "auto-switch", 2));
      return "applied";
    }
    return "unknown";
  });

  // 本轮快照里 "1" 被清除，"2" 不在本轮快照里，必须原样留下。
  expect((await log.list()).map((i) => i.id)).toEqual(["2"]);
  expect(report).toEqual({ applied: 1, rejected: 0, unknown: 1, remaining: 1 });
  expect(seen).toEqual(["1", "2"]);
});

it("每轮结束就把已决定的意图落盘，不在最后一次性写", async () => {
  const store = memoryStore([intent("1", "add", 1)]);
  const log = new IntentLog(store);
  let sawSelfPersisted = false;
  const report = await log.replay(async (i) => {
    if (i.id === "1") {
      await log.append(intent("2", "add", 2));
      return "applied";
    }
    // 第二轮开始时，"1" 必须已经落盘（第一轮就写了，而不是攒到最后）。
    sawSelfPersisted = store.snapshot().every((entry) => entry.id !== "1");
    return "applied";
  });

  expect(sawSelfPersisted).toBe(true);
  expect(report).toEqual({ applied: 2, rejected: 0, unknown: 0, remaining: 0 });
  // 3 次写入 = append 一次 + 第 1 轮落盘 + 第 2 轮落盘。若攒到最后一次性写，
  // 就只会有 2 次，而且第 2 轮开始时 snapshot 里还能看到 "1"（见上方断言）。
  expect(store.writeCount()).toBe(3);
});

it("每轮都有新意图时，单次 replay 4 轮封顶", async () => {
  const store = memoryStore([intent("0", "add", 0)]);
  const log = new IntentLog(store);
  const seen: string[] = [];
  const report = await log.replay(async (i) => {
    seen.push(i.id);
    await log.append(intent(String(Number(i.id) + 1), "add", seen.length));
    return "applied";
  });

  expect(seen).toEqual(["0", "1", "2", "3"]);
  expect(report).toEqual({ applied: 4, rejected: 0, unknown: 0, remaining: 1 });
  expect((await log.list()).map((i) => i.id)).toEqual(["4"]);
});

it("存储写失败必须向外抛出（append / settle / replay 都不静默吞掉）", async () => {
  await expect(new IntentLog(failingStore()).append(intent("1", "add", 1))).rejects.toThrow(
    "boom: store write failed",
  );
  await expect(new IntentLog(failingStore([intent("1", "add", 1)])).settle("1")).rejects.toThrow(
    "boom: store write failed",
  );
  await expect(
    new IntentLog(failingStore([intent("1", "add", 1)])).replay(async () => "applied"),
  ).rejects.toThrow("boom: store write failed");
});

it("并发 append：两条意图都要落盘（读改写不交叉，不丢写）", async () => {
  const log = new IntentLog(memoryStore());

  // read/write 都是异步的：不串行化时两个 append 会各自读到空日志，后写的覆盖先写的。
  await Promise.all([log.append(intent("a", "add", 1)), log.append(intent("b", "remove", 2))]);

  expect((await log.list()).map((i) => i.id)).toEqual(["a", "b"]);
});

it("并发 settle 与 append：被收尾的消失，被追加的留下", async () => {
  const log = new IntentLog(memoryStore([intent("1", "add", 1)]));

  await Promise.all([log.settle("1"), log.append(intent("2", "remove", 2))]);

  // 无论谁先排队：settle 只能移除 "1"，append 的 "2" 不能被越过它的整份覆盖写掉。
  expect((await log.list()).map((i) => i.id)).toEqual(["2"]);
});

it("并发 replay 与 append：本轮清理不会清掉并发追加的意图", async () => {
  const gated = gatedFirstWriteStore([intent("1", "add", 1)]);
  const log = new IntentLog(gated.store);
  const appended: Promise<void>[] = [];
  const replaying = log.replay(async (i) => {
    if (i.id === "1") {
      appended.push(log.append(intent("2", "auto-switch", 2)));
      return "applied";
    }
    return "unknown";
  });

  // 闸门保证「追加的落盘」已经发起但尚未落地，此时放行。
  await gated.entered;
  gated.release();
  await replaying;
  await Promise.all(appended);

  // 本轮只该清掉本轮判定为 applied 的 "1"；并发追加的 "2" 必须留下。
  expect((await log.list()).map((i) => i.id)).toEqual(["2"]);
});
