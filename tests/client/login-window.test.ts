/**
 * 登录弹窗工具（`src/client/login-window.ts`）。
 *
 * 这一层存在的唯一理由是**弹窗拦截器只认用户手势**：授权网址是异步回来的，所以必须在
 * 点击的当刻先开一个空白窗口，拿到网址再导航过去。这里把三种失败路径钉住 ——
 * 没有 `window`（Node/内嵌 webview）、被拦截（`open` 返回 `null`）、导航失败
 * （跨域/窗口已关），任何一种都必须退回「界面上显示链接」而不是崩或留空白页。
 */
import { describe, expect, it, vi } from "vitest";

import { closeLoginWindow, openLoginWindow, pointLoginWindowAt, type LoginWindowHandle } from "../../src/client/login-window";

/** 造一个可观察的假窗口。 */
function fakeWindow(): { handle: LoginWindowHandle & { location: { href?: string }; closed: boolean }; closed: () => number } {
  let closedCount = 0;
  const handle = {
    closed: false,
    location: {} as { href?: string },
    close: () => {
      closedCount += 1;
      handle.closed = true;
    },
  };
  return { handle, closed: () => closedCount };
}

describe("openLoginWindow", () => {
  it("没有 window.open 时返回 undefined（Node 容器仿真 / 内嵌 webview）", () => {
    const previous = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(openLoginWindow()).toBeUndefined();
    } finally {
      if (previous !== undefined) (globalThis as { window?: unknown }).window = previous;
    }
  });

  it("在用户手势里打开一个 about:blank 占位窗口（target=_blank）", () => {
    const { handle } = fakeWindow();
    const open = vi.fn(() => handle);

    const result = openLoginWindow(open);

    expect(result).toBe(handle);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
  });

  it("被弹窗拦截（open 返回 null）时不产生句柄，调用方退回显示链接", () => {
    expect(openLoginWindow(() => null)).toBeUndefined();
    expect(openLoginWindow(() => undefined)).toBeUndefined();
  });

  it("open 抛错（扩展禁止开窗）时不抛给调用方", () => {
    const open = () => {
      throw new Error("blocked by policy");
    };
    expect(openLoginWindow(open)).toBeUndefined();
  });
});

describe("pointLoginWindowAt", () => {
  it("把占位窗口导航到授权网址", () => {
    const { handle } = fakeWindow();

    expect(pointLoginWindowAt(handle, "https://example.test/auth?code=1")).toBe(true);
    expect(handle.location.href).toBe("https://example.test/auth?code=1");
  });

  it("句柄缺省、已关闭或没有 location 时返回 false（调用方据此关窗）", () => {
    expect(pointLoginWindowAt(undefined, "https://x")).toBe(false);
    const { handle } = fakeWindow();
    handle.closed = true;
    expect(pointLoginWindowAt(handle, "https://x")).toBe(false);
    expect(pointLoginWindowAt({}, "https://x")).toBe(false);
  });

  it("赋值抛错（跨域/只读）时返回 false 而不是抛", () => {
    const handle: LoginWindowHandle = {
      // 跨域窗口读 `location` 会抛（真实浏览器行为）：导航必须整体落在 try 里。
      get location(): { href?: string } {
        throw new Error("cross-origin");
      },
    };
    expect(pointLoginWindowAt(handle, "https://x")).toBe(false);
  });
});

describe("closeLoginWindow", () => {
  it("关掉仍未关闭的窗口；undefined 与已关闭都不动手", () => {
    const { handle, closed } = fakeWindow();
    closeLoginWindow(handle);
    expect(closed()).toBe(1);

    closeLoginWindow(handle); // 已关闭：不重复关
    expect(closed()).toBe(1);

    expect(() => closeLoginWindow(undefined)).not.toThrow();
  });

  it("close 抛错时不抛给调用方（尽力而为）", () => {
    const handle: LoginWindowHandle = {
      close: () => {
        throw new Error("already gone");
      },
    };
    expect(() => closeLoginWindow(handle)).not.toThrow();
  });
});
