/**
 * 目录缓存的**并发正确性**回归（2026-11-05 外部审查 F01）。
 *
 * ## 上一版的两个缺陷（都可复现）
 *
 * 单个 `inFlight` 变量兼职三件事 —— 并发去重、结果回写、指针清理 —— 于是：
 *
 * 1. **旧结果覆盖新结果**：`fresh` 只是 `inFlight = undefined`，旧 Promise 没被取消，
 *    它稍后完成时照样 `cached = records`。用户点了刷新，然后缓存又被打回旧值。
 * 2. **取消串扰**：所有等待者共享**第一个调用方**的 signal。A 取消 → 底层请求被取消
 *    → 还在等的 B 一起失败，尽管 B 自己的信号完好。
 *
 * ## 为什么必须从 `list()` 进入
 *
 * 与 U10 那次教训一致（`docs/HANDOVER-2.0.0.md` §5.3）：只测底层函数是假绿。
 * 这里的每一条都构造真实的并发时序，断言的是 `list()` 的观察结果。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";

const BASE = "https://opencode.ai/zen/go/v1";
const TTL = 5 * 60_000;

/** 一个可手动放行的 `/models` 响应队列；元数据端点一律快速失败（不参与本组断言）。 */
function deferredModels(): {
  fetchImpl: typeof fetch;
  pending: () => number;
  resolve: (index: number, id: string) => void;
} {
  const waits: ((body: string) => void)[] = [];
  const fetchImpl = (async (url: string) => {
    const text = String(url);
    if (text.includes("models.dev")) return new Response("{}", { status: 500 });
    return new Promise<Response>((resolve) => {
      waits.push((id) => resolve(new Response(JSON.stringify({ data: [{ id, name: id }] }), { status: 200 })));
    });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    pending: () => waits.length,
    resolve: (index, id) => {
      const release = waits[index];
      if (release === undefined) throw new Error(`no pending request at ${index}`);
      release(id);
    },
  };
}

/** 等一轮微任务 + 宏任务，让 promise 链落地。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("F01 · 旧加载不得覆盖新缓存", () => {
  it("**旧请求晚于 fresh 完成**：缓存保持 fresh 的结果", async () => {
    const gateway = deferredModels();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: gateway.fetchImpl, ttlMs: TTL });

    const slow = catalog.list(); // A：挂在第 0 个请求
    const fresh = catalog.list(undefined, true); // B：fresh → 第 1 个请求
    expect(gateway.pending(), "A、B 各自发了请求").toBe(2);

    // B 先回，新结果写缓存。
    gateway.resolve(1, "fresh-B");
    await expect(fresh).resolves.toMatchObject([{ entry: { id: "fresh-B" } }]);
    await settle();

    // A 后回 —— 它是旧一代，**不许**写缓存。
    gateway.resolve(0, "stale-A");
    await expect(slow).resolves.toMatchObject([{ entry: { id: "stale-A" } }]);
    await settle();

    const cached = await catalog.list();
    expect(cached[0]?.entry.id, "缓存必须还是 fresh-B").toBe("fresh-B");
  });

  it("**旧请求先完成但 fresh 仍在途**：旧结果也不得先写进缓存", async () => {
    const gateway = deferredModels();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: gateway.fetchImpl, ttlMs: TTL });

    const slow = catalog.list();
    const fresh = catalog.list(undefined, true);

    // A 先回 —— 它已经不是最新一代了，TTL 不能被它刷新。
    gateway.resolve(0, "stale-A");
    await expect(slow).resolves.toMatchObject([{ entry: { id: "stale-A" } }]);
    await settle();

    // 此时 B 还没回：再读一次应该继续等 B（共享在途），而不是拿 A 的结果。
    const third = catalog.list();
    expect(gateway.pending(), "第三次读取复用在途的 B，不新发请求").toBe(2);

    gateway.resolve(1, "fresh-B");
    await expect(fresh).resolves.toMatchObject([{ entry: { id: "fresh-B" } }]);
    await expect(third).resolves.toMatchObject([{ entry: { id: "fresh-B" } }]);
    await settle();

    expect((await catalog.list())[0]?.entry.id, "缓存是 B").toBe("fresh-B");
  });

  it("**连续两次 fresh**：只保留最后一次的结果", async () => {
    const gateway = deferredModels();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: gateway.fetchImpl, ttlMs: TTL });

    const first = catalog.list();
    const second = catalog.list(undefined, true);
    const third = catalog.list(undefined, true);
    expect(gateway.pending(), "三次读取 = 三次请求（fresh 不复用在途）").toBe(3);

    gateway.resolve(2, "fresh-3");
    await expect(third).resolves.toMatchObject([{ entry: { id: "fresh-3" } }]);
    await settle();
    gateway.resolve(1, "fresh-2");
    await expect(second).resolves.toMatchObject([{ entry: { id: "fresh-2" } }]);
    await settle();
    gateway.resolve(0, "stale-1");
    await expect(first).resolves.toMatchObject([{ entry: { id: "stale-1" } }]);
    await settle();

    expect((await catalog.list())[0]?.entry.id, "只有最后一次 fresh 能写缓存").toBe("fresh-3");
  });
});

describe("F01 · 取消只影响自己", () => {
  it("**首个 waiter 取消，第二个继续**：B 正常拿到结果", async () => {
    const gateway = deferredModels();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: gateway.fetchImpl, ttlMs: TTL });

    const a = new AbortController();
    const b = new AbortController();

    const first = catalog.list(a.signal);
    const second = catalog.list(b.signal);
    expect(gateway.pending(), "两人共用同一个在途请求").toBe(1);

    a.abort();
    await expect(first).rejects.toThrow(/aborted/i);
    // A 走了，但 B 还在等 —— 共享请求**不能**被 abort。
    gateway.resolve(0, "shared");
    await expect(second).resolves.toMatchObject([{ entry: { id: "shared" } }]);
  });

  it("**全部 waiter 都取消**才真正 abort 底层请求", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>(() => {
        /* 永不 settle；只能靠 abort */
      });
    }) as unknown as typeof fetch;

    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: TTL });
    const a = new AbortController();
    const b = new AbortController();

    const first = catalog.list(a.signal);
    const second = catalog.list(b.signal);
    await settle();

    a.abort();
    await expect(first).rejects.toThrow(/aborted/i);
    await settle();
    expect(signals[0]?.aborted, "A 单独取消不该 abort 共享请求").toBe(false);

    b.abort();
    await expect(second).rejects.toThrow(/aborted/i);
    await settle();
    expect(signals[0]?.aborted, "最后一个 waiter 走了才 abort").toBe(true);
  });

  it("取消后再来的读取会重新发请求（不留下死掉的 in-flight）", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      calls += 1;
      return new Response(JSON.stringify({ data: [{ id: `m${calls}`, name: `m${calls}` }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: TTL });
    const a = new AbortController();
    const doomed = catalog.list(a.signal);
    a.abort();
    await expect(doomed).rejects.toThrow(/aborted/i);

    const after = await catalog.list();
    expect(calls, "取消后能重新取到目录").toBeGreaterThanOrEqual(1);
    expect(after[0]?.entry.id, "拿得到结果").toBeTruthy();
  });
});
