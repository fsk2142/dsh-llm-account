import { LlmError } from "@deepseek-ai/dsh-llm";
import { expect, it, vi } from "vitest";

import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, runStream } from "../../src/core/transport";
import type { StreamBudget } from "../../src/core/transport";

/** 测试用的最小 chunk 形状：内核只透传，不解释内容。 */
type Chunk = { type: string };

/** 两个预算都远大于测试时长：这些用例只考取消/透传，不考预算。 */
const NO_PRESSURE: StreamBudget = { requestTimeoutMs: 60_000, streamIdleTimeoutMs: 60_000 };

/**
 * 把流收集成数组。`for await` 会在提前退出时关闭流，与宿主的消费方式一致。
 * @param source - 要消费的流。
 * @returns 按产出顺序排列的 chunk。
 */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

/**
 * 按顺序产出后正常结束。
 * @param values - 依次产出的值。
 */
async function* fromArray<T>(values: readonly T[]): AsyncGenerator<T> {
  for (const value of values) yield value;
}

/**
 * 永不产出的流：模拟上游连第一个字节都不给。
 *
 * 用手写迭代器而不是 `await new Promise(() => {})` 的异步生成器，是为了不在进程里留下
 * 一个永久挂起的生成器；两者对内核是等价的「索取永不落地」。
 * @returns 只会挂起的流。
 */
function never(): AsyncIterable<Chunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Chunk> {
      return { next: () => new Promise<IteratorResult<Chunk>>(() => {}) };
    },
  };
}

/** 假异步迭代器：`next()` 永不落地，`return()` 计数。 */
interface StalledSource<T> {
  source: AsyncIterable<T>;
  /** 解析于第一次 `next()` 被调用之后：此时内核已挂起在等待原始流。 */
  demanded: Promise<void>;
  /** `next()` 被调用的次数。 */
  demandCount: () => number;
  /** `return()` 被调用的次数（原始流是否被主动关闭）。 */
  closeCount: () => number;
}

/**
 * 构造一个「索取永不落地、但可观察关闭请求」的假流。
 * @returns 假流与它的观察点。
 */
function stalledSource<T>(): StalledSource<T> {
  let markDemanded: () => void = () => {};
  const demanded = new Promise<void>((resolve) => {
    markDemanded = resolve;
  });
  let demands = 0;
  let closes = 0;
  return {
    source: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            demands += 1;
            markDemanded();
            return new Promise<IteratorResult<T>>(() => {});
          },
          return: (): Promise<IteratorResult<T>> => {
            closes += 1;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
    demanded,
    demandCount: () => demands,
    closeCount: () => closes,
  };
}

/**
 * 记录窗口内真实 `setTimeout` 上膛、且尚未触发/清除的句柄。
 *
 * 不替换时钟（真实定时器仍是真定时器），只观察内核自己的定时器纪律；`peak()` 保证
 * 观测确实看到了内核的定时器（否则「没有残留」是假通过）。
 * @returns 存活句柄数、峰值与还原函数。
 */
function trackTimers(): { count: () => number; peak: () => number; restore: () => void } {
  const armed = new Set<ReturnType<typeof setTimeout>>();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let peak = 0;

  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    const handle: ReturnType<typeof setTimeout> = realSetTimeout(() => {
      armed.delete(handle);
      handler(...args);
    }, delayMs);
    armed.add(handle);
    if (armed.size > peak) peak = armed.size;
    return handle;
  }) as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>): void => {
    if (handle !== undefined) armed.delete(handle);
    realClearTimeout(handle);
  }) as typeof globalThis.clearTimeout;

  return {
    count: () => armed.size,
    peak: () => peak,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

it("两个错误码常量与设计约定的字符串一致", () => {
  expect(LLM_REQUEST_TIMEOUT).toBe("LLM_REQUEST_TIMEOUT");
  expect(LLM_STREAM_IDLE_TIMEOUT).toBe("LLM_STREAM_IDLE_TIMEOUT");
});

it("整请求超时抛出 LLM_REQUEST_TIMEOUT", async () => {
  await expect(collect(runStream(never(), { requestTimeoutMs: 10, streamIdleTimeoutMs: 1000 }))).rejects.toMatchObject({
    code: LLM_REQUEST_TIMEOUT,
  });
});

it("流空闲超时抛出 LLM_STREAM_IDLE_TIMEOUT", async () => {
  async function* stallAfterOne(): AsyncGenerator<Chunk> {
    yield { type: "text-delta" };
    await new Promise(() => {});
  }
  await expect(collect(runStream(stallAfterOne(), { requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10 }))).rejects.toMatchObject({
    code: LLM_STREAM_IDLE_TIMEOUT,
  });
});

it("正常流按原顺序透传所有 chunk（含 usage）", async () => {
  const chunks = [{ type: "text-delta" }, { type: "usage" }, { type: "finish" }];
  expect(await collect(runStream(fromArray(chunks), { requestTimeoutMs: 1000, streamIdleTimeoutMs: 1000 }))).toEqual(chunks);
});

it("超时抛的是宿主的 LlmError，并主动关闭原始流（只发关闭请求，不等它完成）", async () => {
  const upstream = stalledSource<Chunk>();
  const error = await collect(runStream(upstream.source, { requestTimeoutMs: 10, streamIdleTimeoutMs: 1000 })).catch(
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(LlmError);
  expect(error).toMatchObject({ code: LLM_REQUEST_TIMEOUT });
  expect(upstream.demandCount()).toBeGreaterThan(0); // 原始流真的被索取过，不是空跑通过
  expect(upstream.closeCount()).toBe(1);
});

it("调用方中止抛出 ABORTED 而不是超时码，并关闭原始流", async () => {
  const controller = new AbortController();
  const upstream = stalledSource<Chunk>();
  const consuming = collect(runStream(upstream.source, NO_PRESSURE, { signal: controller.signal }));
  await upstream.demanded;
  controller.abort();
  const error = await consuming.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(LlmError);
  expect(error).toMatchObject({ code: "ABORTED" });
  expect(upstream.closeCount()).toBe(1);
});

it("消费前已中止：抛 ABORTED，且完全不索取原始流", async () => {
  const upstream = stalledSource<Chunk>();
  const error = await collect(runStream(upstream.source, NO_PRESSURE, { signal: AbortSignal.abort() })).catch(
    (thrown: unknown) => thrown,
  );
  expect(error).toMatchObject({ code: "ABORTED" });
  expect(upstream.demandCount()).toBe(0);
  expect(upstream.closeCount()).toBe(0);
});

it("消费方提前退出（break）时关闭原始流，并清掉全部定时器", async () => {
  let closes = 0;
  const source: AsyncIterable<Chunk> = {
    [Symbol.asyncIterator](): AsyncIterator<Chunk> {
      return {
        next: (): Promise<IteratorResult<Chunk>> => Promise.resolve({ done: false, value: { type: "text-delta" } }),
        return: (): Promise<IteratorResult<Chunk>> => {
          closes += 1;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
  const timers = trackTimers();
  try {
    for await (const chunk of runStream(source, { requestTimeoutMs: 1000, streamIdleTimeoutMs: 1000 })) {
      expect(chunk).toEqual({ type: "text-delta" });
      break;
    }
    expect(closes).toBe(1);
    expect(timers.peak()).toBeGreaterThanOrEqual(2);
    expect(timers.count()).toBe(0);
  } finally {
    timers.restore();
  }
});

it("流正常结束后不残留定时器", async () => {
  const timers = trackTimers();
  try {
    const chunks = [{ type: "text-delta" }, { type: "usage" }, { type: "finish" }];
    expect(await collect(runStream(fromArray(chunks), { requestTimeoutMs: 1000, streamIdleTimeoutMs: 1000 }))).toEqual(chunks);
    // 至少上膛过 deadline 与 idle 两个：确认观测到了内核的定时器，不是假通过。
    expect(timers.peak()).toBeGreaterThanOrEqual(2);
    expect(timers.count()).toBe(0);
  } finally {
    timers.restore();
  }
});

it("每次产出后空闲计时重置：产出间隔始终短于空闲预算的长流不会误报空闲超时", async () => {
  vi.useFakeTimers();
  try {
    const chunks: Chunk[] = [{ type: "a" }, { type: "b" }, { type: "c" }, { type: "d" }];
    // 每个 chunk 之间等 20ms，空闲预算 30ms：一旦计时不重置就会误报。
    async function* paced(): AsyncGenerator<Chunk> {
      for (const chunk of chunks) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });
        yield chunk;
      }
    }
    // 立刻挂上拒绝处理：推进假时间时流可能已经开始拒绝，浮空会成为「未处理拒绝」。
    const outcome = collect(runStream(paced(), { requestTimeoutMs: 600_000, streamIdleTimeoutMs: 30 })).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    for (let step = 0; step < chunks.length; step += 1) await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toEqual({ value: chunks });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("交出 chunk 后（消费方处理期间）只留整请求 deadline，空闲计时已清", async () => {
  const timers = trackTimers();
  try {
    const stream = runStream(fromArray([{ type: "a" }, { type: "b" }]), { requestTimeoutMs: 60_000, streamIdleTimeoutMs: 60_000 });
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { type: "a" } });
    // 挂起在 yield：空闲计时必须已清掉，否则消费方的处理时间会被算成「厂商空闲」。
    expect(timers.count()).toBe(1);
    expect(await iterator.next()).toEqual({ done: false, value: { type: "b" } });
    expect(timers.count()).toBe(1);
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(timers.count()).toBe(0);
  } finally {
    timers.restore();
  }
});

it("消费方在 yield 上停留超过整请求 deadline 时，下一次索取就报整请求超时", async () => {
  const timers = trackTimers();
  try {
    const stream = runStream(fromArray([{ type: "text-delta" }, { type: "finish" }]), {
      requestTimeoutMs: 25,
      streamIdleTimeoutMs: 60_000,
    });
    const iterator = stream[Symbol.asyncIterator]();
    // 25ms/60ms 的余量选择：首个 chunk 只需微秒级，30ms 级的事件循环停顿才会误伤它；
    // 而停留必然超过 25ms，所以「deadline 在 yield 期间到点」是确定发生的。
    expect((await iterator.next()).done).toBe(false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 60);
    });
    const error = await iterator.next().catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({ code: LLM_REQUEST_TIMEOUT });
    expect(timers.count()).toBe(0);
  } finally {
    timers.restore();
  }
});

it("整请求 deadline 由注入的 now 判定：越预算的 chunk 不再下发", async () => {
  let clock = 0;
  // 每次读时钟前进 60s：deadline 只上膛 30s，所以真正判定它的是注入的时钟。
  const now = (): number => {
    clock += 60_000;
    return clock;
  };
  const error = await collect(
    runStream(fromArray([{ type: "text-delta" }]), { requestTimeoutMs: 30_000, streamIdleTimeoutMs: 600_000 }, { now }),
  ).catch((thrown: unknown) => thrown);
  expect(error).toMatchObject({ code: LLM_REQUEST_TIMEOUT });
});

it("原始流的错误原样抛出，不被包装成超时码（适配器据此分类）", async () => {
  const failure = new Error("upstream exploded");
  async function* broken(): AsyncGenerator<Chunk> {
    throw failure;
  }
  const timers = trackTimers();
  try {
    const error = await collect(runStream(broken(), NO_PRESSURE)).catch((thrown: unknown) => thrown);
    expect(error).toBe(failure);
    // 出错路径同样要清掉定时器。
    expect(timers.count()).toBe(0);
  } finally {
    timers.restore();
  }
});

it("两个预算用足够大的数表示「不限制」：慢一点的正常流照样透传", async () => {
  const chunks = [{ type: "text-delta" }, { type: "finish" }];
  const unlimited: StreamBudget = { requestTimeoutMs: Number.MAX_SAFE_INTEGER, streamIdleTimeoutMs: Number.MAX_SAFE_INTEGER };
  // 未夹住延迟时 Node 会把超大延迟夹到 1ms 立即触发，这个 5ms 的产出就会被误判超时。
  async function* slowStart(): AsyncGenerator<Chunk> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    yield chunks[0];
    yield chunks[1];
  }
  expect(await collect(runStream(slowStart(), unlimited))).toEqual(chunks);
});
