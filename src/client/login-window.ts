/**
 * 网页登录的浏览器窗口（弹窗）小工具。
 *
 * 为什么要有这么一层：浏览器**只允许在用户手势的同步阶段**打开新窗口。而授权网址是异步
 * 拿到的（`loginBegin` 要走一次远程调用 / 本地起服务器），等它回来再 `window.open` 就会被
 * 弹窗拦截器拦掉。所以做法是：点击的当刻先开一个空白窗口（{@link openLoginWindow}），
 * 拿到网址后再把它的 `location` 指过去（{@link pointLoginWindowAt}）；失败就关掉
 * （{@link closeLoginWindow}），别留一个空白页给用户。
 *
 * 没有 `window`（Node 里的容器仿真、或嵌入式 webview 不提供 `open`）时一律返回
 * `undefined`，调用方退回「界面上显示可点的授权链接」——那条路径本来就在。
 * @module dsh-llm-account/src/client/login-window
 */

/** 弹窗句柄的最小形状（`Window` 的子集；测试用一个普通对象就够）。 */
export interface LoginWindowHandle {
  /** 窗口是否已被关闭（浏览器会在用户手动关闭后同步这个值）。 */
  readonly closed?: boolean;
  /** 可写的地址（`about:blank` 窗口一定有 `location`）。 */
  readonly location?: { href?: string } | null;
  /** 关闭窗口。 */
  readonly close?: () => void;
}

/** 打开新窗口的注入点（生产是 `window.open`，测试传假实现）。 */
export type OpenWindow = (url: string, target: string) => unknown;

/** 取全局 `window.open`（没有就返回 `undefined`）。 */
function defaultOpenWindow(): OpenWindow | undefined {
  const win = (globalThis as { window?: { open?: unknown } }).window;
  if (win === undefined || typeof win.open !== "function") return undefined;
  return (url, target) => (win.open as (u: string, t: string) => unknown)(url, target);
}

/** 把任意返回值收窄成句柄（浏览器返回 `Window`，被拦截时返回 `null`）。 */
function asHandle(value: unknown): LoginWindowHandle | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as LoginWindowHandle;
}

/**
 * 在用户手势里先开一个空白窗口，留给稍后拿到的授权网址。
 *
 * **必须同步调用**（直接写在点击处理器里），否则弹窗拦截器会拦掉。
 * @param openWindow - 打开窗口的实现；缺省用全局 `window.open`。
 * @returns 句柄；没有 `window`、被拦截或抛错时为 `undefined`（调用方退回显示链接）。
 */
export function openLoginWindow(openWindow?: OpenWindow): LoginWindowHandle | undefined {
  const open = openWindow ?? defaultOpenWindow();
  if (open === undefined) return undefined;
  try {
    // `about:blank`：此时还不知道授权网址；先占住这次「用户手势」的窗口额度。
    return asHandle(open("about:blank", "_blank"));
  } catch {
    return undefined;
  }
}

/**
 * 把占位窗口导航到授权网址。
 * @param handle - {@link openLoginWindow} 的返回值。
 * @param url - 授权网址。
 * @returns 是否成功导航（失败时调用方应关掉窗口，别留空白页）。
 */
/**
 * 授权网址是否可安全打开：只接受 `http:` / `https:`。
 *
 * 网址来自厂商（`authUrl` / `verificationUri`），而它最终会进 `window.location` 或 `<a href>` ——
 * `javascript:` / `data:` 这类协议在 Electron 宿主里等于执行任意脚本。协议白名单是这里唯一
 * 可靠的闸门（渲染层 React 不会逃逸 href 的协议）。
 * @param url - 厂商给的网址。
 * @returns 可以打开时为 `true`。
 */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function pointLoginWindowAt(handle: LoginWindowHandle | undefined, url: string): boolean {
  if (!isHttpUrl(url)) return false;
  if (handle === undefined || handle.closed === true) return false;
  try {
    // 读 `location` 本身就可能抛（跨域窗口）：必须一起放进 try 里。
    const location = handle.location;
    if (location === undefined || location === null) return false;
    location.href = url;
    return true;
  } catch {
    return false;
  }
}

/**
 * 关掉占位窗口（登录失败/取消/无需浏览器时）。
 * @param handle - {@link openLoginWindow} 的返回值；`undefined` 时什么都不做。
 */
export function closeLoginWindow(handle: LoginWindowHandle | undefined): void {
  if (handle === undefined || handle.closed === true) return;
  try {
    handle.close?.();
  } catch {
    // 关不掉（已被用户关掉/跨域限制）不是错误：这里只做尽力而为。
  }
}
