/**
 * `withRequestDeadline` 的语义测试（2026-11-01 修 R02 的回归）。
 *
 * ## 为什么需要
 *
 * `runStream` 的整请求 deadline 只覆盖「已经开始产出 chunk 之后」。而一次真实请求里
 * `fetch()`（等响应头）与读错误正文都在它**之前** —— 网关接受连接但永不返回响应头时，
 * 用户配的 `requestTimeoutMs` 完全不起作用，请求一直挂着。
 *
 * 这个辅助函数把那段也纳入同一个预算。本文件验证三件事：
 *
 * 1. 超时抛 `LLM_REQUEST_TIMEOUT`（与 `runStream` 同一个码，宿主看到同一类失败）；
 * 2. 用户取消优先于超时（按停止立即生效）；
 * 3. 操作能拿到可透传给 `fetch` 的 signal。
 *
 * ## 没有覆盖的一项
 *
 * 「超时后底层 promise 的失败被兜住、不产生 unhandled rejection」这条**不在本文件**。
 * 尝试过两种写法都不成立：
 *
 * - `process.on("unhandledRejection")` 计数：删掉实现的 `.catch` 后测试仍通过
 *   （变异检验确认），因为 vitest 自己接管了该上报路径，进程级监听器看不到；
 * - 自己给底层 promise 挂 `.catch` 计数：那个 catch 是我们挂的，跟实现无关，
 *   删掉实现的兜底它照样触发。
 *
 * 可靠的验证方式需要一个**独立 node 进程**（未被 vitest 接管）跑一个永不 resolve
 * 的 fetch 再超时，观察 stderr 是否有 `UnhandledPromiseRejection`。那属于集成测试，
 * 本轮没有加 —— 与其写一条证明不了任何事的断言，不如如实说明缺口。
 */
import { describe, expect, it, vi } from "vitest";

import { LLM_REQUEST_TIMEOUT, withRequestDeadline } from "../../src/core/transport";

/** 一个很快的预算，让测试不用真的等。 */
const BUDGET = { requestTimeoutMs: 20, streamIdleTimeoutMs: 5_000 };

describe("withRequestDeadline（fetch 阶段的整请求超时）", () => {
  it("操作在预算内完成 → 正常返回结果", async () => {
    const value = await withRequestDeadline(async () => "done", BUDGET);
    expect(value).toBe("done");
  });

  it("操作超时 → 抛 **LLM_REQUEST_TIMEOUT**（与 runStream 同一个码）", async () => {
    // 模拟「网关接受连接但永不返回响应头」：promise 永不 resolve。
    const hanging = new Promise<never>(() => {});
    await expect(withRequestDeadline(() => hanging, BUDGET)).rejects.toMatchObject({
      code: LLM_REQUEST_TIMEOUT,
    });
  });

  it("错误文案带上配置的毫秒数（用户能对上自己填的值）", async () => {
    const hanging = new Promise<never>(() => {});
    await expect(
      withRequestDeadline(() => hanging, { requestTimeoutMs: 20, streamIdleTimeoutMs: 5_000 }),
    ).rejects.toThrow(/20\s*ms/u);
  });

  it("调用方已取消 → 直接抛 ABORTED，不发请求", async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => "never");
    await expect(
      withRequestDeadline(operation, BUDGET, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(operation, "已取消时不该启动操作").not.toHaveBeenCalled();
  });

  it("操作进行中取消 → 立即抛 ABORTED（不等超时）", async () => {
    const controller = new AbortController();
    const hanging = new Promise<never>(() => {});
    const started = withRequestDeadline(
      () => hanging,
      { requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10_000 },
      { signal: controller.signal },
    );
    // 20ms 后取消：远早于 10 秒超时。
    setTimeout(() => controller.abort(), 20);
    await expect(started).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("操作能拿到 signal（可透传给 fetch）", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    await withRequestDeadline(
      async (signal) => {
        seen.push(signal);
        return "ok";
      },
      BUDGET,
      { signal: controller.signal },
    );
    expect(seen[0], "实现必须把 signal 交给操作").toBe(controller.signal);
  });
});
