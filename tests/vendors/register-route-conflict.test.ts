/**
 * **provider id 撞车时不能崩**（2026-11-19 真机故障的真因）。
 *
 * ## 故障链
 *
 * 用户同事在「模型 → 手动添加 provider」里建了个自定义路由，route 填成和我们同名
 * （`opendesign` / `commandcode` / `dsh-opencode-go` 这类 slug 都可能）。
 *
 * 那条官方界面**允许用户自己填 route**（正则 `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`），
 * 只校验「与**当前已注册**的 id 是否重名」—— 而插件启动顺序决定了我们的 provider
 * 还没注册，于是重名能建成功。
 *
 * 等我们的 `apply` 跑起来再注册，宿主的 `registerAdapter` 就抛：
 *
 * ```js
 * throw new LlmError(
 *   `an adapter for provider "${provider}" is already registered`,
 *   "DUPLICATE_ADAPTER",
 * );
 * ```
 *
 * 而这发生在 `apply()` 里 —— **整个厂商行不加载**，账号卡片与登录按钮一起消失。
 *
 * ## 修法
 *
 * `registerRouteOrExplain` 捕获它，打印一条**能直接照着做**的诊断，然后返回
 * `undefined` 让 `apply` 继续跑完：
 *
 * - 别的功能（设置页、账号卡片、额度、登录）照常；
 * - 只是这家**没有模型可选**（因为 route id 被占了）；
 * - 用户按日志去删那个自定义 provider 即可恢复。
 *
 * ## 为什么不静默跳过
 *
 * 静默跳过等于「界面说这家已启用，但没有模型可选」—— 更难排查。
 * 警告里必须同时有：**provider id**、**宿主原话**、**该怎么办**。
 */
import { describe, expect, it, vi } from "vitest";

import { registerRouteOrExplain } from "../../src/vendors/assembly";

/** 造一个假 llm 服务（`registerAdapter` 行为由参数决定）。 */
function ctxWith(registerAdapter: unknown): never {
  return { llm: { registerAdapter } } as never;
}

/** 一个假的注册句柄（带 `replace`，与宿主形状一致）。 */
const handle = Object.assign(() => undefined, { replace: () => undefined });

describe("provider id 撞车时不拖垮整家", () => {
  it("**DUPLICATE_ADAPTER 不冒出去**，返回 undefined", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = ctxWith(() => {
      throw new Error('an adapter for provider "opendesign" is already registered');
    });
    expect(() => registerRouteOrExplain(ctx, "opendesign", {})).not.toThrow();
    expect(registerRouteOrExplain(ctx, "opendesign", {})).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("撞名时警告**含 provider id 与「手动添加」的提示**（用户要知道去哪删）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    registerRouteOrExplain(ctxWith(() => { throw new Error("DUPLICATE_ADAPTER"); }), "opendesign", {});
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message, "要说清是哪个 id").toContain("opendesign");
    expect(message, "要说明是别人先占了").toMatch(/ALREADY REGISTERED/i);
    expect(message, "要指出去哪删").toMatch(/模型|添加/);
    expect(message, "要能被搜到").toContain("[dsh-llm-account]");
    warnSpy.mockRestore();
  });

  it("**成功时原样返回注册句柄**（正常路径不能被影响）", () => {
    expect(registerRouteOrExplain(ctxWith(() => handle), "opendesign", {})).toBe(handle);
  });

  it("非撞名的失败也要兜住，并说明「这家没有模型可选」", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    registerRouteOrExplain(ctxWith(() => { throw new Error("INVALID_ADAPTER"); }), "commandcode", {});
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message).toMatch(/models are unavailable/i);
    warnSpy.mockRestore();
  });

  it("**宿主没有 llm.registerAdapter**（残缺宿主）也不抛", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => registerRouteOrExplain({} as never, "opendesign", {})).not.toThrow();
    expect(() => registerRouteOrExplain({ llm: {} } as never, "opendesign", {})).not.toThrow();
    warnSpy.mockRestore();
  });

  it("**`console.warn` 自己抛也不外溢**（契约是「绝对安全」）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console broken");
    });
    expect(() =>
      registerRouteOrExplain(ctxWith(() => { throw new Error("boom"); }), "opendesign", {}),
    ).not.toThrow();
    warnSpy.mockRestore();
  });
});
