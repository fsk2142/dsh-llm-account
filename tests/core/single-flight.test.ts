/**
 * `createSingleFlight`：按 key 合并并发调用（bug 审查 LOW-1 的修法）。
 *
 * ## 为什么改用真实现测（2026-10-22）
 *
 * 最初这段逻辑写在 adapter 的私有方法 `#refreshShared` 里，测试只能**复刻一份**同样的
 * 代码做语义验证 —— bug 审查复查指出：「如果生产代码写错了，测试照样通过」。
 *
 * 现在抽到 `core/single-flight.ts`，本文件直接 import **生产实现**，变异检验能真的抓到
 * 问题（见文件末尾的注释）。
 *
 * ## 三条语义
 *
 * 1. 同 key 并发 → 只跑一次，所有调用拿到同一个结果；
 * 2. settle 后立刻移除表项（**失败也移除**，否则那个 key 再也跑不动）；
 * 3. 不同 key 互不影响。
 */
import { describe, expect, it, vi } from "vitest";

import { createSingleFlight } from "../../src/core/single-flight";

describe("createSingleFlight", () => {
  it("**同 key 并发只跑一次**，所有调用拿到同一结果", async () => {
    const run = createSingleFlight();
    const work = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "结果";
    });

    const results = await Promise.all([run("k", work), run("k", work), run("k", work)]);

    expect(work, "**只执行一次**").toHaveBeenCalledTimes(1);
    expect(results).toEqual(["结果", "结果", "结果"]);
  });

  it("**不同 key 各跑一次**（按 key 隔离，不是全局串行）", async () => {
    const run = createSingleFlight();
    const work = vi.fn(async (value: string) => value);

    const [a, b] = await Promise.all([run("k1", () => work("a")), run("k2", () => work("b"))]);

    expect(work).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(["a", "b"]);
  });

  it("**失败后移除表项**：下一个调用能重新尝试", async () => {
    const run = createSingleFlight();
    let attempts = 0;
    const failing = async (): Promise<string> => {
      attempts += 1;
      throw new Error("boom");
    };

    await expect(run("k", failing)).rejects.toThrow("boom");
    // 关键：表项已被移除，所以第二次真的会再跑一次。
    await expect(run("k", failing)).rejects.toThrow("boom");
    expect(attempts, "**两次都真的执行了**（失败没被永久缓存）").toBe(2);
  });

  it("失败时所有并发调用都拿到同一个错误", async () => {
    const run = createSingleFlight();
    const work = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("共享的失败");
    });

    const results = await Promise.allSettled([run("k", work), run("k", work)]);
    expect(results.map((row) => row.status)).toEqual(["rejected", "rejected"]);
    expect(work, "只执行一次").toHaveBeenCalledTimes(1);
  });

  it("**settle 之后新调用会重新执行**（不是永久缓存结果）", async () => {
    const run = createSingleFlight();
    let count = 0;
    const work = async (): Promise<number> => {
      count += 1;
      return count;
    };

    expect(await run("k", work)).toBe(1);
    // 第一次已 settle 并移除表项 → 这是全新的一次调用。
    expect(await run("k", work)).toBe(2);
    expect(count).toBe(2);
  });

  it("**建表与入表之间没有 await**：同步抛错的 work 也不会漏掉清理", async () => {
    const run = createSingleFlight();
    let attempts = 0;
    const throwsSync = (): Promise<never> => {
      attempts += 1;
      throw new Error("同步抛");
    };

    // work 同步抛错时，`finally` 仍会跑（promise 已建好），所以表项被清掉。
    await expect(run("k", throwsSync)).rejects.toThrow("同步抛");
    await expect(run("k", throwsSync)).rejects.toThrow("同步抛");
    expect(attempts, "两次都执行了，说明没有卡住").toBe(2);
  });
});

/**
 * 变异检验记录（人工执行，2026-10-22）：
 *
 * - 把 `pending.delete(key)` 删掉 → 「失败后移除表项」「settle 后重新执行」两条变红；
 * - 把 `pending.set(key, started)` 移到 `return` 之后 → 「同 key 并发只跑一次」变红。
 *
 * 这两条都能抓到，说明本测试验的是**生产实现**，不是复刻。
 */
