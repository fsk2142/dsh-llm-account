/**
 * **自动继续的接线不能把整个厂商拖死**（2026-11-19 真机故障）。
 *
 * ## 被钉住的故障
 *
 * `wireAutoContinue` 原来只把 `applyAutoContinue(...)` 包在 try 里，而它前面两句
 * `events.on("agent/pre-step", …)` / `events.on("session/event", …)` **在 try 之外**。
 *
 * 宿主对**不认识的事件名**可能让 `ctx.on` 抛（版本差异），而这两句发生在 `apply()` 里、
 * 没有任何兜底 —— 于是**整个厂商行的 apply 挂掉**，那一家彻底不加载：
 *
 * - 设置页里那一家整块消失（没有设置快照 → 没有 tab → 没有账号卡片）；
 * - 「网页登录」按钮也只剩另外两家。
 *
 * 用户报障原话：「他原来一直登录的 opendesign，现在打开后 opendesign 登录的账户不见了，
 * 重新登录只显示 opencode 和 commandcode 的登录」。他的宿主是 `0.2.2-rc.1`，
 * 而开发机上验证用的是 `0.2.2-rc.3` —— 正好是「事件名在某个 rc 上不存在」的典型场景。
 *
 * ## 这条用例钉住什么
 *
 * 1. **一个事件注册抛错，不能让 `wireAutoContinue` 抛**；
 * 2. 另一个事件仍然要注册成功（各自独立兜住，不互相连坐）；
 * 3. `applyAutoContinue` 自己抛也不能冒出去；
 * 4. 挂在树上的一半监听要被摘掉（不留半个接线 —— 那比完全没有更难排查）。
 */
import { describe, expect, it, vi } from "vitest";

import { wireAutoContinue } from "../../src/vendors/auto-continue-wiring";

/** 造一个最小的宿主 context：`on` 的行为由 `onImpl` 决定。 */
function hostWith(onImpl: (name: string, listener: (...args: unknown[]) => unknown) => unknown): {
  ctx: unknown;
  registered: string[];
} {
  const registered: string[] = [];
  const ctx = {
    on: (name: string, listener: (...args: unknown[]) => unknown) => {
      registered.push(name);
      return onImpl(name, listener);
    },
    get: () => undefined,
    effect: () => () => undefined,
  };
  return { ctx, registered };
}

/** 关掉的设置：接线本身与开关无关，这里只关心「会不会抛」。 */
const OFF = () => ({ enabled: false, maxAttempts: 3, intervalMs: 2_000 });

describe("事件名不受支持时不能拖垮整个厂商（2026-11-19 真机故障）", () => {
  it("**两个事件都注册失败也不抛**（这条是故障的核心）", () => {
    const { ctx } = hostWith(() => {
      throw new Error('unknown event "agent/pre-step"');
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => wireAutoContinue(ctx, OFF, "opendesign")).not.toThrow();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("**一个事件失败、另一个仍要注册**（不互相连坐）", () => {
    const { ctx, registered } = hostWith((name) => {
      if (name === "agent/pre-step") throw new Error("unknown event");
      return () => undefined;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    wireAutoContinue(ctx, OFF, "opendesign");
    expect(registered, "两个都尝试过").toContain("session/event");
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("`on` 返回非函数（宿主形状不同）也不抛", () => {
    const { ctx } = hostWith(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => wireAutoContinue(ctx, OFF, "opendesign")).not.toThrow();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("**`ctx` 连 `on` 都没有**（残缺宿主）也不抛", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => wireAutoContinue({}, OFF, "opendesign")).not.toThrow();
    errorSpy.mockRestore();
  });

  it("**注销函数总是可调用**，且重复调用不抛", () => {
    const { ctx } = hostWith(() => () => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = wireAutoContinue(ctx, OFF, "opendesign");
    expect(typeof dispose).toBe("function");
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("接线中途失败时，**已注册的监听要被摘掉**（不留半个接线）", () => {
    const disposed: string[] = [];
    const { ctx } = hostWith((name) => () => {
      disposed.push(name);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = wireAutoContinue(ctx, OFF, "opendesign");
    /*
     * 只断言**本模块自己注册的那两个**被摘掉。
     *
     * `applyAutoContinue` 内部还会往同一个 ctx 上注册它自己的监听（它自带 disposer，
     * 由 cordis 的 fiber 管），不该算进本模块的账 —— 拿 `registered.length` 当分母
     * 会把两边的监听混在一起，那是测试写错而不是实现错。
     */
    dispose();
    expect(disposed, "本模块注册的两个事件都要能注销").toContain("agent/pre-step");
    expect(disposed).toContain("session/event");
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
