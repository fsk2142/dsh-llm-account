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
  it("两个开关都关时**不注册任何事件**（关掉即静默，不起后台逻辑）", () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE });
    expect(ctx.size()).toBe(0);
  });

  it("只开 onError 时只注册请求失败那一个", () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true });
    expect(ctx.has("agent/request-error")).toBe(true);
    expect(ctx.has("agent/turn-stopping")).toBe(false);
  });

  it("只开 onTruncate 但**没有**宿主探针时也不注册（没有 inbox 就无从续写）", () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onTruncate: true });
    expect(ctx.size()).toBe(0);
  });

  it("只开 onTruncate 且提供了探针时，只注册本轮结束那一个", () => {
    const ctx = fakeCtx();
    const appended: unknown[] = [];
    applyAutoContinue(
      ctx as never,
      { ...DEFAULT_AUTO_CONTINUE, onTruncate: true },
      { inbox: { append: (message: unknown) => appended.push(message) } },
    );
    expect(ctx.has("agent/turn-stopping")).toBe(true);
    expect(ctx.has("agent/request-error")).toBe(false);
  });
});

describe("请求失败：返回 { kind: 'retry' } 才重试", () => {
  it("瞬时失败 + 开关开 → 返回 retry", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true });
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
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true });
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
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true });
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
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true, maxAttempts: 2 });
    const payload = { turn: 7, step: 1, provider: "commandcode", failure: { code: "TRANSPORT" } };
    expect(await ctx.fire("agent/request-error", payload)).toEqual({ kind: "retry" });
    expect(await ctx.fire("agent/request-error", payload)).toEqual({ kind: "retry" });
    // 第三次：超限，交给宿主（终态）。
    expect(await ctx.fire("agent/request-error", payload)).toBeUndefined();
  });

  it("换一个 turn 后计数重新开始（每个轮次各自限额）", async () => {
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onError: true, maxAttempts: 1 });
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
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onTruncate: true }, {
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
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onTruncate: true }, {
      inbox: { append: (message: unknown) => appended.push(message) },
      lastFinishReason: () => "stop",
    });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    expect(appended).toHaveLength(0);
  });

  it("次数用尽 → 不推消息", async () => {
    const appended: unknown[] = [];
    const ctx = fakeCtx();
    applyAutoContinue(ctx as never, { ...DEFAULT_AUTO_CONTINUE, onTruncate: true, maxAttempts: 1 }, {
      inbox: { append: (message: unknown) => appended.push(message) },
      lastFinishReason: () => "length",
    });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    await ctx.fire("agent/turn-stopping", { turn: 1 });
    expect(appended).toHaveLength(1);
  });
});
