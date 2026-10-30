/**
 * 自动继续的**宿主接线**（`applyAutoContinue`）。
 *
 * 与 `core/switching/auto-continue` 的分工：那个回答「该不该继续」，这个负责
 * 「怎么接到宿主上」——注册两个事件、维护每轮计数、把结果翻译成宿主认识的形状。
 *
 * 宿主签名（读自 `dsh-agent-loop/lib/index.js`）：
 * - `agent/request-error` 是 **waterfall**，返回 `{ kind: "retry" }` 且不调 `next()` 即重试。
 * - `agent/turn-stopping` 是 **serial**，本轮结束前调用；让 `inbox.nextStep` 非空即保持本轮。
 *
 * 这里用最小假 ctx 验证「注册了哪些事件、返回什么」—— 真机行为由宿主保证。
 */
import { describe, expect, it } from "vitest";

import { applyAutoContinue } from "../../src/vendors/auto-continue";
import { DEFAULT_AUTO_CONTINUE } from "../../src/core/switching/auto-continue";

/** 记录事件注册的最小假 ctx。 */
function fakeCtx() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ctx = {
    on(event: string, listener: (...args: unknown[]) => unknown) {
      handlers.set(event, listener);
      return () => handlers.delete(event);
    },
    /** 触发一个已注册的事件（waterfall 的 next 也会传进来）。 */
    async fire(event: string, payload: unknown, next: () => Promise<unknown> = async () => undefined) {
      const handler = handlers.get(event);
      return handler === undefined ? undefined : await handler(payload, next);
    },
    has: (event: string) => handlers.has(event),
    size: () => handlers.size,
  };
  return ctx;
}

describe("注册", () => {
  it("总开关关着时**仍注册监听器，但事件进来直接交棒**（2026-10-30 改）", async () => {
    /**
     * 原来「关着就不注册」，但 `loader/volatile-update` 不会重跑 apply —— 于是
     * 运行时把开关打开也没用（监听器从未存在）。现在两个监听器总是注册，
     * 关着时在事件里直接 `next()` 交棒，与「不注册」等价，但可以热开。
     */
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ ...DEFAULT_AUTO_CONTINUE }));
    expect(ctx.has("agent/request-error"), "监听器在").toBe(true);

    let handedOff = 0;
    const action = await ctx.fire(
      "agent/request-error",
      { turn: 1, failure: { code: "TRANSPORT" } },
      async () => {
        handedOff += 1;
        return undefined;
      },
    );

    expect(action, "关着 → 不重试").toBeUndefined();
    expect(handedOff, "关着 → 交棒给下游").toBe(1);
  });

  it("**运行时打开开关立即生效**（不用重载宿主）", async () => {
    const ctx = fakeCtx();
    let enabled = false;
    applyAutoContinue(ctx as never, () => ({ enabled, maxAttempts: 3, intervalMs: 0 }));

    // 关着：不重试
    expect(await ctx.fire("agent/request-error", { turn: 1, failure: { code: "TRANSPORT" } })).toBeUndefined();

    // 改设置（模拟 volatile-update）→ 同一批监听器立刻按新值工作
    enabled = true;
    expect(await ctx.fire("agent/request-error", { turn: 2, failure: { code: "TRANSPORT" } })).toEqual({
      kind: "retry",
    });

    // 再关掉 → 立刻不重试
    enabled = false;
    expect(await ctx.fire("agent/request-error", { turn: 3, failure: { code: "TRANSPORT" } })).toBeUndefined();
  });

  it("总开关开着、但没有宿主探针时只注册请求失败那一个", () => {
    // `agent/turn-stopping` 那条路要 `probe.inbox` 才能往队列里推消息，没有就无从续写。
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    expect(ctx.has("agent/request-error")).toBe(true);
    expect(ctx.has("agent/turn-stopping"), "没有探针就不注册").toBe(false);
  });

  it("总开关开着 + 有探针时，两个接缝都注册", () => {
    const ctx = fakeCtx();
    const appended: unknown[] = [];
    applyAutoContinue(
      ctx as never,
      () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }),
      { inbox: { append: (message: unknown) => appended.push(message) } },
    );
    expect(ctx.has("agent/request-error")).toBe(true);
    expect(ctx.has("agent/turn-stopping")).toBe(true);
  });

});

describe("请求失败：返回 { kind: 'retry' } 才重试", () => {
  it("瞬时失败 + 开关开 → 返回 retry", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      step: 1,
      provider: "commandcode",
      failure: { code: "TRANSPORT", message: "boom" },
    });
    expect(action).toEqual({ kind: "retry" });
  });

  it("用户主动中止 → 不返回 retry（把决定权交回宿主）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      step: 1,
      provider: "commandcode",
      failure: { code: "ABORTED", message: "user stopped" },
    });
    expect(action).toBeUndefined();
  });

  it("确定性失败 → 不重试", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      step: 1,
      provider: "commandcode",
      failure: { code: "CONTEXT_WINDOW_EXCEEDED", message: "too long" },
    });
    expect(action).toBeUndefined();
  });

  it("次数用尽后不再重试（同一轮次内计数）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 2, intervalMs: 0 }));
    const payload = { turn: 7, step: 1, provider: "commandcode", failure: { code: "TRANSPORT" } };
    expect(await ctx.fire("agent/request-error", payload)).toEqual({ kind: "retry" });
    expect(await ctx.fire("agent/request-error", payload)).toEqual({ kind: "retry" });
    // 第三次：超限，交给宿主（终态）。
    expect(await ctx.fire("agent/request-error", payload)).toBeUndefined();
  });

  it("换一个 turn 后计数重新开始（每个轮次各自限额）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 1, intervalMs: 0 }));
    expect(await ctx.fire("agent/request-error", { turn: 1, failure: { code: "TRANSPORT" } })).toEqual({ kind: "retry" });
    expect(await ctx.fire("agent/request-error", { turn: 1, failure: { code: "TRANSPORT" } })).toBeUndefined();
    // 新一轮重新获得额度。
    expect(await ctx.fire("agent/request-error", { turn: 2, failure: { code: "TRANSPORT" } })).toEqual({ kind: "retry" });
  });
});

describe("回答截断：往 nextStep 推一条消息", () => {
  it("截断 + 开关开 → 调 append 让本轮保持打开", async () => {
    const appended: unknown[] = [];
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }), {
      // 宿主在 turn-stopping 之后检查 `inbox.nextStep.length`；这里注入最小形状。
      inbox: { append: (message: unknown) => appended.push(message) },
      lastFinishReason: () => "length",
    });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    expect(appended).toHaveLength(1);
  });

  it("正常结束（stop）→ 不推消息（不破坏正常对话）", async () => {
    const appended: unknown[] = [];
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }), {
      inbox: { append: (message: unknown) => appended.push(message) },
      lastFinishReason: () => "stop",
    });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    expect(appended).toHaveLength(0);
  });

  it("次数用尽 → 不推消息", async () => {
    const appended: unknown[] = [];
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 1, intervalMs: 0 }), {
      inbox: { append: (message: unknown) => appended.push(message) },
      lastFinishReason: () => "length",
    });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    expect(appended).toHaveLength(1);
  });

});

describe("重试退避（2026-10-28）", () => {
  /**
   * 宿主收到 `{ kind: "retry" }` 后**立即** `continue`，中间没有任何等待
   * （实测 `dsh-agent-loop` 无 backoff）。所以退避必须由插件自己加 ——
   * 网络抖动时在几百毫秒内连打数次反而可能加剧拥塞。
   */
  it("**重试前按配置的间隔等待**（默认 2s）", async () => {
    const ctx = fakeCtx();
    // 用真实默认间隔 —— 这条测试钉的就是「间隔被真正用上」。
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 2000 }));

    const started = Date.now();
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      failure: { code: "TRANSPORT" },
    });
    const elapsed = Date.now() - started;

    expect(action).toEqual({ kind: "retry" });
    expect(elapsed, "固定等 2s 才重试").toBeGreaterThanOrEqual(1900);
  });

  it("间隔可配置：设成 100ms 就只等 100ms", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 100 }));

    const started = Date.now();
    await ctx.fire("agent/request-error", { turn: 1, failure: { code: "TRANSPORT" } });
    const elapsed = Date.now() - started;

    expect(elapsed, "不该等满默认的 2s").toBeLessThan(1000);
  });

  it("不可重试的失败**不等待**（立即返回 undefined）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));

    const started = Date.now();
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      failure: { code: "QUOTA" },
    });
    const elapsed = Date.now() - started;

    expect(action).toBeUndefined();
    expect(elapsed, "不该为不重试的失败白等").toBeLessThan(100);
  });

});

describe("waterfall 交接（2026-10-29）", () => {
  /**
   * `agent/request-error` 是 **waterfall**：`cordis` 的实现是
   * `const next = () => (cbs.shift() ?? inner)(...args); return next();` ——
   * **监听器不调 `next()`，链路就在这里终止**，后面的监听器永远收不到。
   *
   * 宿主自带的 `dsh-llm-retry` 也挂在这个事件上（中间件形态）。我们原来
   * `return undefined` 而不调 `next()`，排在它前面时会把宿主那条重试链吞掉。
   */
  it("**不归我们重试时必须调用 next()**（否则吞掉宿主的重试链）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    let handedOff = 0;

    const action = await ctx.fire(
      "agent/request-error",
      { turn: 1, failure: { code: "QUOTA" } }, // 不在白名单 → 不重试
      async () => {
        handedOff += 1;
        return undefined;
      },
    );

    expect(handedOff, "必须交棒给下游").toBe(1);
    expect(action).toBeUndefined();
  });

  it("下游返回 retry 时原样透传（不覆盖别人的决策）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));

    const action = await ctx.fire(
      "agent/request-error",
      { turn: 1, failure: { code: "QUOTA" } },
      async () => ({ kind: "retry" }),
    );

    expect(action, "下游的决策要透出去").toEqual({ kind: "retry" });
  });

  it("我们决定重试时**返回决策并终止链路**（不调 next）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx, () => ({ enabled: true, maxAttempts: 3, intervalMs: 0 }));
    let handedOff = 0;

    const action = await ctx.fire(
      "agent/request-error",
      { turn: 1, failure: { code: "TRANSPORT" } }, // 白名单 → 我们重试
      async () => {
        handedOff += 1;
        return undefined;
      },
    );

    expect(action).toEqual({ kind: "retry" });
    expect(handedOff, "返回决策即终止链路，不该再问下游").toBe(0);
  });

  it("**等待期间被取消 → 不返回 retry**（2026-10-30 修 BUG-04）", async () => {
    /**
     * 原来 `delay` 不理会信号：用户按停止后定时器照常走完，然后照样返回
     * `{ kind: "retry" }` —— 等于否认用户的取消意图，还可能让宿主再打一次请求。
     */
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 5000 }));

    const controller = new AbortController();
    const started = Date.now();
    // 100ms 后取消（远早于 5s 的间隔）。
    setTimeout(() => controller.abort(), 100);

    let handedOff = 0;
    const action = await ctx.fire(
      "agent/request-error",
      { turn: 1, failure: { code: "TRANSPORT" }, signal: controller.signal },
      async () => {
        handedOff += 1;
        return undefined;
      },
    );
    const elapsed = Date.now() - started;

    expect(action, "取消 → 不重试").toBeUndefined();
    expect(handedOff, "取消 → 交棒").toBe(1);
    expect(elapsed, "应被立刻打断，不等满 5s").toBeLessThan(2000);
  });

  it("没有取消时照常等满间隔再重试", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, () => ({ enabled: true, maxAttempts: 3, intervalMs: 100 }));
    const controller = new AbortController();
    const action = await ctx.fire("agent/request-error", {
      turn: 1,
      failure: { code: "TRANSPORT" },
      signal: controller.signal,
    });
    expect(action).toEqual({ kind: "retry" });
  });
});
