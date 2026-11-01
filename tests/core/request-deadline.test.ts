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

import { LLM_REQUEST_TIMEOUT, RequestDeadline, withRequestDeadline } from "../../src/core/transport";

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

  it("操作能拿到 signal，且**调用方取消会传导**（合并信号）", async () => {
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
    /**
     * **不再断言 `seen[0] === controller.signal`**（2026-11-01 修 R03）。
     *
     * 现在传给底层的是 `AbortSignal.any([调用方, 超时自己的 controller])` ——
     * 一个**合并**信号，不是调用方原对象。断言对象相等会锁死实现细节；重要的是
     * 「取消能传导」，那由下面几条单独验证。
     */
    expect(seen[0], "必须把 signal 交给操作").toBeDefined();
    expect(seen[0]?.aborted, "此刻不该是已中止的").toBe(false);
  });

  it("**超时会 abort 底层 signal**（R03 修的就是这个）", async () => {
    /**
     * 上一版超时只是「我不等了」：`operation` 收到的 signal 是**调用方**的，
     * 从没被 abort，于是 `fetch` 继续跑到自然结束。
     */
    let observed: AbortSignal | undefined;
    let abortedDuringRun = false;
    const hanging = new Promise<never>(() => {});
    const started = withRequestDeadline(async (signal) => {
      observed = signal;
      signal?.addEventListener("abort", () => {
        abortedDuringRun = true;
      });
      return hanging;
    }, BUDGET);
    await expect(started).rejects.toMatchObject({ code: LLM_REQUEST_TIMEOUT });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(observed, "操作应当收到 signal").toBeDefined();
    expect(observed?.aborted, "**超时后底层 signal 必须已中止**").toBe(true);
    expect(abortedDuringRun, "abort 事件必须真的派发到监听器").toBe(true);
  });

  it("调用方取消会传导到合并信号", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const hanging = new Promise<never>(() => {});
    const started = withRequestDeadline(
      async (signal) => {
        observed = signal;
        return hanging;
      },
      { requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10_000 },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(started).rejects.toMatchObject({ code: "ABORTED" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(observed?.aborted, "调用方取消必须传导").toBe(true);
  });

  it("正常完成时**不** abort 底层信号（别把成功的响应标脏）", async () => {
    let observed: AbortSignal | undefined;
    await withRequestDeadline(async (signal) => {
      observed = signal;
      return "ok";
    }, BUDGET);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(observed?.aborted, "成功路径不该 abort").toBe(false);
  });
});

describe("RequestDeadline（共享预算，R02 第二版）", () => {
  it("**剩余时间递减**：第二段拿到的不是新的完整预算", async () => {
    const deadline = new RequestDeadline(90);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const first = deadline.remainingMs();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = deadline.remainingMs();
    expect(first, "60ms 后应剩约 30ms").toBeLessThanOrEqual(35);
    expect(second, "再过 60ms 应几乎耗尽（不是又拿 90）").toBeLessThanOrEqual(5);
  });

  it("已过期时返回正数（0 会让下游退化成「不限制」）", async () => {
    const deadline = new RequestDeadline(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deadline.remainingMs(), "必须 ≥1，不能是 0 或负数").toBeGreaterThanOrEqual(1);
  });

  it("streamBudget 用的也是剩余时间", async () => {
    const deadline = new RequestDeadline(90);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const budget = deadline.streamBudget(5_000);
    expect(budget.requestTimeoutMs, "流式阶段不该重置整请求预算").toBeLessThanOrEqual(35);
    expect(budget.streamIdleTimeoutMs, "空闲看门狗保持原值").toBe(5_000);
  });

  it("**两段各 60ms 在 90ms 预算下不能都成功**（R02 的原始复现）", async () => {
    /**
     * 复审用这个夹具证明原来的实现有问题：头等待 60ms、正文再等 60ms，
     * 每段都小于 90ms 的预算，但整请求 120ms > 90ms。
     *
     * 现在第二段拿到的是**剩余**预算，所以它必须超时。
     */
    const deadline = new RequestDeadline(90);
    const phase = async (ms: number): Promise<string> => {
      const remaining = deadline.remainingMs();
      if (ms > remaining) throw new Error(`would exceed budget: ${ms} > ${remaining}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return "ok";
    };
    await expect(phase(60)).resolves.toBe("ok");
    await expect(phase(60), "第二段 60ms 已超出剩余预算").rejects.toThrow(/would exceed budget/u);
  });
});

describe("超时真正取消底层请求（R03 的端到端语义）", () => {
  it("**假 fetch 在超时后收到 abort**，socket 不会继续挂着", async () => {
    /**
     * 模拟真实 fetch：它内部监听 signal，abort 时 reject。
     *
     * 若实现不 abort（R03 的旧行为），这个 promise 会一直 pending，
     * 测试靠 `observedAbort` 断言它会失败。
     */
    let observedAbort = false;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    const fakeFetch = (signal?: AbortSignal): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(new Error("aborted"));
        });
        // 永不 resolve：模拟网关挂起。
        pendingTimer = setTimeout(() => {}, 60_000);
      });
    try {
      await expect(
        withRequestDeadline((signal) => fakeFetch(signal), {
          requestTimeoutMs: 30,
          streamIdleTimeoutMs: 5_000,
        }),
      ).rejects.toMatchObject({ code: LLM_REQUEST_TIMEOUT });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(observedAbort, "**底层必须真的收到 abort**（否则 socket 继续挂着）").toBe(true);
    } finally {
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    }
  });

  it("调用方取消也会让假 fetch 收到 abort", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const fakeFetch = (signal?: AbortSignal): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(new Error("aborted"));
        });
      });
    const started = withRequestDeadline(
      (signal) => fakeFetch(signal),
      { requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10_000 },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(started).rejects.toMatchObject({ code: "ABORTED" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observedAbort, "取消也要传导到底层").toBe(true);
  });
});
