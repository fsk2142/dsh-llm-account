/**
 * **可选宿主接缝必须各自隔离失败**（2026-11-19 真机故障）。
 *
 * ## 被钉住的故障
 *
 * 用户同事的 `opendesign` 整家从设置页消失、登录入口只剩另外两家。根因是 `apply()` 里
 * 那些**附加功能**的宿主接缝（`ctx.on(...)` 注册事件、`applyUsageRemote(...)` 走
 * `ctx.inject`）在旧宿主（`0.2.2-rc.1`）上抛错 —— 异常冒到 `apply()`，**整个厂商不加载**。
 *
 * 账号卡片是按家渲染的（没有设置快照 → 没有 tab → 没有账号卡片），所以一家 `apply`
 * 挂掉的表现就是「那一家整个消失」。
 *
 * `optionalStep` 让这些接缝**各自**兜住：丢一个功能，不丢整家。
 *
 * ## 这条用例钉住什么
 *
 * 1. 抛错时**不冒出去**，返回 `undefined`；
 * 2. 成功时**原样返回**步骤的值（不能把正常路径也变成 `undefined`）；
 * 3. 抛错时打印一条含**厂商名与步骤名**的警告（用户能在控制台里搜到是哪一步）；
 * 4. 即使 `console` 本身出问题也不抛（这个助手必须绝对安全）。
 */
import { describe, expect, it, vi } from "vitest";

import { optionalStep } from "../../src/vendors/assembly";

describe("optionalStep：附加功能失败不拖垮整家", () => {
  it("**抛错不外溢**，返回 undefined", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(optionalStep("opendesign", "测试步骤", () => {
      throw new Error("host does not support this");
    })).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("**成功时原样返回**（不能把正常路径也变成 undefined）", () => {
    expect(optionalStep("opendesign", "测试步骤", () => 42)).toBe(42);
    expect(optionalStep("opendesign", "测试步骤", () => "value")).toBe("value");
  });

  it("抛错时的警告**含厂商名与步骤名**（否则不知道是哪一步被跳过）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    optionalStep("opencode", "用量远程面", () => {
      throw new Error("boom");
    });
    const message = String(warnSpy.mock.calls[0]?.[0] ?? "");
    expect(message, "要能看出是哪一家").toContain("opencode");
    expect(message, "要能看出是哪一步").toContain("用量远程面");
    expect(message, "要能被用户搜到").toContain("[dsh-llm-account]");
    warnSpy.mockRestore();
  });

  it("**抛非 Error 值**（字符串 / null）也不外溢", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(optionalStep("commandcode", "测试", () => { throw "plain string"; })).toBeUndefined();
    expect(optionalStep("commandcode", "测试", () => { throw null; })).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("**`console.warn` 自己抛也不外溢**（这个助手必须绝对安全）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console broken");
    });
    // 这里如果实现不当（catch 里再调 console），会二次抛出去。
    expect(() => optionalStep("opendesign", "测试", () => { throw new Error("x"); })).not.toThrow();
    warnSpy.mockRestore();
  });
});
