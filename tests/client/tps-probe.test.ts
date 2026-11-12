/**
 * 探针的**崩溃回归**（2026-11-12 真机故障）。
 *
 * ## 被钉住的 bug
 *
 * 第一版探针这样注册：
 *
 * ```ts
 * const register = events.register;      // 取出方法
 * const off = register(definition());    // 调用 → this === undefined
 * ```
 *
 * 宿主 `register` 是 **class 方法**，内部第一句 `this.registerDefinition(...)`。
 * 于是用户控制台里刷出：
 *
 * ```
 * [dsh-llm-account] tps probe: registration failed:
 * TypeError: Cannot read properties of undefined (reading 'registerDefinition')
 * ```
 *
 * 这条用例用**带 `this` 依赖的假实现**复现它：旧写法会抛，新写法不会。
 *
 * ## 同时钉住的边界
 *
 * 探针是可选功能，任何一环缺失都**不许外抛** —— 否则 `apply` 里的异常会让整个客户端包
 * 看起来激活失败（用户报过「升级后功能坏掉」）。
 */
import { describe, expect, it, vi } from "vitest";

import { installTpsProbe } from "../../src/client/tps-probe";

/** 记录一次注册调用（含 `this` 是否绑定正确）。 */
interface RecordedRegister {
  definition: { kind: string };
  /** 调用那一刻的 `this` —— `undefined` 就说明方法被“摘下来”调用了。 */
  receiver: unknown;
}

/**
 * 造一个 `uiConversation` 假件：`register` 是**依赖 this 的 class 方法**（与真宿主同形状）。
 * @param receiverBox - 收集调用的盒子。
 * @returns 假服务。
 */
function serviceOf(receiverBox: RecordedRegister[]): unknown {
  class FakeRegistry {
    /** 与宿主同名：旧写法在这里读 `this` 就炸。 */
    registerDefinition(_kind: string, resolved: unknown): void {
      void resolved;
    }
    /** 探针真正调用的入口；**依赖 `this`**。 */
    register(definition: { kind: string }): () => void {
      receiverBox.push({ definition, receiver: this });
      // 关键：真实宿主在这里访问 this.registerDefinition —— 摘掉方法后会抛。
      this.registerDefinition(definition.kind, definition);
      return () => undefined;
    }
  }
  return { events: new FakeRegistry() };
}

/**
 * 跑一次探针安装。
 * @param service - `uiConversation` 的值（`undefined` 表示服务缺失）。
 * @param box - 收集注册调用的盒子。
 * @returns 日志行。
 */
function runProbe(service: unknown, box: RecordedRegister[] = []): { logged: string[]; box: RecordedRegister[] } {
  const logged: string[] = [];
  const spy = vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  const ctx = {
    inject: (_names: readonly string[], callback: (scoped: never) => unknown) => {
      callback({ uiConversation: service } as never);
      return () => undefined;
    },
  };
  try {
    installTpsProbe(ctx);
  } finally {
    spy.mockRestore();
    errorSpy.mockRestore();
  }
  return { logged, box };
}

describe("tps probe: 注册不得因摘掉方法而崩", () => {
  it("**`register` 被正确绑定 `this`**（旧写法在这里抛 registerDefinition 错误）", () => {
    const box: RecordedRegister[] = [];
    const { logged } = runProbe(serviceOf(box), box);

    expect(logged.some((line) => line.includes("registration failed")), "不许出现注册失败").toBe(false);
    expect(box, "注册必须真的发生一次").toHaveLength(1);
    // `this` 必须还是那个 registry 实例（旧写法这里是 undefined）。
    expect(box[0]!.receiver, "this 必须是 events 对象，不能是 undefined").not.toBe(undefined);
    expect(logged.some((line) => line.includes("registered (waiting for assistant/live-chunk)"))).toBe(true);
  });

  it("注册后打印出 events 对象上真实可用的方法名（诊断用）", () => {
    const box: RecordedRegister[] = [];
    const { logged } = runProbe(serviceOf(box), box);
    const line = logged.find((entry) => entry.includes("registered (waiting"));
    expect(line, "一行日志里要列出方法名").toContain("events methods=[");
    expect(line).toContain("register");
  });

  it("**服务缺失时不抛**，只记一行 skip", () => {
    const { logged } = runProbe(undefined);
    expect(logged.some((line) => line.includes("uiConversation is not an object, skipped"))).toBe(true);
    expect(logged.some((line) => line.includes("registration failed"))).toBe(false);
  });

  it("**`events` 缺失时不抛**", () => {
    const { logged } = runProbe({});
    expect(logged.some((line) => line.includes("uiConversation.events is unavailable, skipped"))).toBe(true);
  });

  it("**`register` 不是函数时也不抛**，并把能用的方法名报出来", () => {
    const { logged } = runProbe({ events: { registerDefinition: () => undefined } });
    expect(logged.some((line) => line.includes("events.register is unavailable"))).toBe(true);
    expect(logged.some((line) => line.includes("available methods=[registerDefinition]"))).toBe(true);
  });

  it("`ctx.inject` 本身不可用时安静跳过", () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      installTpsProbe({});
    } finally {
      spy.mockRestore();
    }
    expect(logged.some((line) => line.includes("ctx.inject is unavailable, skipped"))).toBe(true);
  });

  it("嵌套注入回调抛错也被兜住，不冒泡到 apply", () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      // 一个 getter 抛错的 service：读 `.events` 就炸。
      const hostile = {
        get events(): never {
          throw new Error("boom");
        },
      };
      installTpsProbe({
        inject: (_names, callback) => {
          callback({ uiConversation: hostile } as never);
          return () => undefined;
        },
      });
    } finally {
      spy.mockRestore();
    }
    expect(logged.some((line) => line.includes("registration failed")), "应记为失败而不是外抛").toBe(true);
  });
});
