/**
 * 目录读取的**按键隔离 / 独立取消 / 内部超时**（2026-11-05 外部审查 F15 / F17）。
 *
 * ## 被替换掉的实现
 *
 * 两家（Command Code、Open Design）原来是同一个形状：
 *
 * ```ts
 * if (this.#catalogInFlight !== undefined) return this.#catalogInFlight;  // ← 不分键
 * const pending = this.#fetchCatalog(config, signal);
 * this.#catalogInFlight = pending;
 * ```
 *
 * 加上 `signal: signal ?? AbortSignal.timeout(10s)`。四个可复现的缺陷：
 *
 * | 编号 | 缺陷 | 用户看到什么 |
 * | --- | --- | --- |
 * | F15-a | 在途请求不分键 | 切网关/切账号后，模型列表还是旧配置的 |
 * | F15-b | `fresh` 不复位在途 | 刷新按钮在请求在途时「点了没反应」 |
 * | F15-c | 等待者共用第一个 signal | A 取消，还在等的 B 一起失败 |
 * | F17 | `signal ?? timeout` | 调用方给了 signal 但永不 abort，请求挂到天荒地老 |
 *
 * 这里逐条钉住。**只测 `createCatalogFlight` 是不够的** —— 那是 U06/U07 的教训。
 * 所以文件末尾还有一组从两家 `adapter.catalogModels()` 进入的端到端断言。
 */
import { describe, expect, it } from "vitest";

import { createCatalogFlight } from "../../src/core/catalog-flight";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";

/** 手动放行的闸门。 */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open: () => open?.() };
}

/** 让微任务落地。 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("F15 · 在途请求按键隔离", () => {
  it("**不同键并发 → 各发各的请求，不共用 Promise**", async () => {
    const calls: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async (key) => {
        calls.push(key);
        const g = gate();
        gates.set(key, g);
        await g.wait;
        return `result:${key}`;
      },
    });

    const a = flight.read("base-A");
    const b = flight.read("base-B");
    await settle();
    expect(calls, "两个键各自发了请求").toEqual(["base-A", "base-B"]);

    gates.get("base-B")?.open();
    await expect(b).resolves.toBe("result:base-B");
    gates.get("base-A")?.open();
    await expect(a).resolves.toBe("result:base-A");
  });

  it("同键并发 → **只发一次**（去重仍然有效）", async () => {
    let calls = 0;
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async () => {
        calls += 1;
        await settle();
        return "same";
      },
    });

    const [a, b, c] = await Promise.all([flight.read("k"), flight.read("k"), flight.read("k")]);
    expect(calls, "三次读取只发一次请求").toBe(1);
    expect([a, b, c]).toEqual(["same", "same", "same"]);
  });

  it("**不同键的缓存互不污染**", async () => {
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async (key) => key.toUpperCase(),
    });
    expect(await flight.read("a")).toBe("A");
    expect(await flight.read("b")).toBe("B");
    expect(await flight.read("a"), "a 的缓存还是 A").toBe("A");
  });

  it("**`fresh` 绕过在途请求**（刷新按钮必须真的重读）", async () => {
    let calls = 0;
    const first = gate();
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async () => {
        calls += 1;
        if (calls === 1) {
          await first.wait;
          return "stale";
        }
        return "fresh";
      },
    });

    const slow = flight.read("k");
    const refreshed = flight.read("k", { fresh: true });
    expect(calls, "fresh 另起一次请求").toBe(2);
    await expect(refreshed).resolves.toBe("fresh");

    first.open();
    await expect(slow).resolves.toBe("stale");
    // 旧一代不得覆盖刚刷新出来的缓存。
    expect(await flight.read("k"), "缓存是 fresh 的结果").toBe("fresh");
  });

  it("**旧请求晚到不覆盖新缓存**", async () => {
    const slowGate = gate();
    let calls = 0;
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async () => {
        calls += 1;
        if (calls === 1) {
          await slowGate.wait;
          return "old";
        }
        return "new";
      },
    });

    const old = flight.read("k");
    const fresh = flight.read("k", { fresh: true });
    await expect(fresh).resolves.toBe("new");
    slowGate.open();
    await expect(old).resolves.toBe("old");
    expect(await flight.read("k"), "缓存保持 new").toBe("new");
  });
});

describe("F15 · 取消只影响自己", () => {
  it("**首个等待者取消，第二个继续**", async () => {
    const g = gate();
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async () => {
        await g.wait;
        return "shared";
      },
    });

    const a = new AbortController();
    const b = new AbortController();
    const first = flight.read("k", { signal: a.signal });
    const second = flight.read("k", { signal: b.signal });

    a.abort();
    await expect(first).rejects.toMatchObject({ code: "ABORTED" });
    g.open();
    await expect(second, "B 不受 A 的取消影响").resolves.toBe("shared");
  });

  it("**全部等待者取消才 abort 底层请求**", async () => {
    let signalSeen: AbortSignal | undefined;
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async (_key, signal) => {
        signalSeen = signal;
        return await new Promise<string>(() => {
          /* 永不 settle；只能靠 abort */
        });
      },
    });

    const a = new AbortController();
    const b = new AbortController();
    const first = flight.read("k", { signal: a.signal });
    const second = flight.read("k", { signal: b.signal });
    await settle();

    a.abort();
    await expect(first).rejects.toMatchObject({ code: "ABORTED" });
    await settle();
    expect(signalSeen?.aborted, "A 单独取消不该 abort 共享请求").toBe(false);

    b.abort();
    await expect(second).rejects.toMatchObject({ code: "ABORTED" });
    await settle();
    expect(signalSeen?.aborted, "最后一个等待者走了才 abort").toBe(true);
  });

  it("已取消的调用方不会发起请求", async () => {
    let calls = 0;
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 0,
      load: async () => {
        calls += 1;
        return "x";
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(flight.read("k", { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    expect(calls, "连共享请求都不该发").toBe(0);
  });
});

describe("F17 · 调用方 signal 与内部超时同时生效", () => {
  it("**传了永不 abort 的 signal，仍然按内部超时放弃**", async () => {
    let signalSeen: AbortSignal | undefined;
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      // 100ms 的内部上限
      timeoutMs: 100,
      load: async (_key, signal) => {
        signalSeen = signal;
        return await new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted by timeout")), { once: true });
        });
      },
    });

    const caller = new AbortController(); // 永远不 abort
    const started = Date.now();
    await expect(flight.read("k", { signal: caller.signal })).rejects.toThrow(/aborted/i);
    expect(Date.now() - started, "不该等到调用方 signal").toBeLessThan(5_000);
    expect(signalSeen?.aborted, "内部超时也要 abort 底层请求").toBe(true);
  });

  it("调用方取消仍然立刻生效（不必等超时）", async () => {
    const flight = createCatalogFlight<string>({
      ttlMs: 60_000,
      timeoutMs: 60_000,
      load: async (_key, signal) =>
        await new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });

    const caller = new AbortController();
    const pending = flight.read("k", { signal: caller.signal });
    await settle();
    caller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});

/** 两家的最小桩（只用到 config / fetchImpl / accounts）。 */
function stubDeps(fetchImpl: typeof fetch): Record<string, unknown> {
  return {
    config: () => ({ apiBase: "https://example.test/v1" }),
    rotation: new RotationEngine({ order: ["a"], rules: [], pinned: null }),
    quota: { snapshot: async () => ({ windows: [], failures: [] }) },
    accounts: { list: async () => [{ ref: "a", label: "A", apiKeyEnv: "A" }] },
    fetchImpl,
    resolveStored: async () => "sk-a",
  };
}

describe("F15/F17 · 端到端（从 adapter.catalogModels 进入）", () => {
  it("Command Code：**切基地址后不串用旧请求**", async () => {
    const seen: string[] = [];
    let base = "https://one.test/v1";
    const g = gate();
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      // 旧基地址的请求挂住：如果新配置复用了它，新请求就永远不会发出去。
      if (String(url).includes("one.test")) await g.wait;
      return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = createCommandCodeAdapter({
      ...(stubDeps(fetchImpl) as unknown as { rotation: never; quota: never; accounts: never; fetchImpl: typeof fetch; resolveStored: () => Promise<string> }),
      config: () => ({ apiBase: base }),
    });

    const first = adapter.catalogModels().catch(() => []);
    await settle();
    base = "https://two.test/v1";
    const second = adapter.catalogModels();

    await expect(second, "新基地址必须真的拿到结果").resolves.toBeInstanceOf(Array);
    expect(seen.some((url) => url.includes("two.test")), "**新基地址被请求了**").toBe(true);
    g.open();
    await first;
  });

  it("Open Design：**换密钥后不串用旧请求**（键含密钥）", async () => {
    const seenKeys: string[] = [];
    let key = "sk-first";
    const g = gate();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seenKeys.push(auth);
      if (String(url).includes("/models") && auth.includes("sk-first")) await g.wait;
      return new Response(JSON.stringify({ object: "list", data: [{ id: "m" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = createOpenDesignAdapter({
      ...(stubDeps(fetchImpl) as unknown as { rotation: never; quota: never; accounts: never; fetchImpl: typeof fetch; resolveStored: () => Promise<string> }),
      config: () => ({ apiBase: "https://example.test/v1" }),
      resolveStored: async () => key,
    });

    const first = adapter.catalogModels().catch(() => []);
    await settle();
    key = "sk-second";
    const second = adapter.catalogModels();

    await expect(second, "新密钥必须真的拿到结果").resolves.toBeInstanceOf(Array);
    expect(
      seenKeys.some((header) => header.includes("sk-second")),
      "**新密钥真的被用来请求了**（没复用旧密钥的在途请求）",
    ).toBe(true);
    g.open();
    await first;
  });
});
