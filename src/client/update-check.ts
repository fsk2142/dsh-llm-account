/**
 * 插件自身的**更新检查**（2026-10-20 用户要求：不用每次卸载重装）。
 *
 * ## 为什么不是「一个更新按钮」那么简单
 *
 * 宿主侧有一个公开的更新 API（`dshmarket` 的 `/dsh-market/api/v1/*`，见该包的
 * `UPDATE-API-V1.md`）。但它**只对「从仓库/npm 装」的包有意义**：实测本机
 *
 * ```
 * GET /dsh-market/api/v1/updates?name=dsh-llm-account&force=1
 * → { "package": { "source": "linked", "installedVersion": "0.1.0",
 *                  "latestVersion": null, "updateAvailable": false } }
 * ```
 *
 * `source: "linked"` 表示这个 profile 行是指向源码目录的符号链接（开发模式）——
 * 那种安装**永远不会有更新**：它跟着源码走，改代码刷新页面就生效。
 *
 * 所以本模块的职责是：**如实区分三种状态**，而不是一律画一个「更新」按钮：
 *
 * | source | 含义 | 界面该说什么 |
 * | --- | --- | --- |
 * | `linked` | 本地链接/开发模式 | 不会更新，说明原因（不要给假按钮） |
 * | `npm`/`git` 等 | 可更新 | 有新版本就显示「更新」 |
 * | 查不到 | 市场缺席 / 该版本没有这个 API | 说明查不到，不猜 |
 *
 * ## 为什么走宿主 HTTP 而不是 `ctx` 服务
 *
 * 更新 API 是**同源 HTTP 接口**（浏览器里 fetch 自带 DSH 的会话 cookie）。宿主没有为它
 * 暴露 cordis 服务，所以客户端只能用 `fetch`。这也是 API 文档给插件 UI 的用法。
 *
 * @module dsh-llm-account/src/client/update-check
 */

/** 本包在宿主上的名字（更新 API 的 `name` 参数）。 */
export const UPDATE_PACKAGE = "dsh-llm-account";

/** 市场更新 API 的版本化前缀（文档：`dsh-market/update-api/v1`）。 */
const MARKET_API = "/dsh-market/api/v1";

/** 一次更新检查的结论。 */
export type UpdateState =
  /** 有新版可装。 */
  | { kind: "available"; installed: string; latest: string; source: string }
  /** 已是最新。 */
  | { kind: "current"; installed: string; source: string }
  /**
   * 这种安装方式**不会有更新**（`source: "linked"` 等）。
   *
   * 与 `current` 的区别很重要：「已是最新」意味着「以后会有新版，现在没有」；
   * 而链接安装是「永远不会通过更新按钮变化」。把两者混为一谈会让用户等着一个
   * 永远不来的按钮。
   */
  | { kind: "not-applicable"; installed: string; source: string }
  /** 查不到（市场缺席 / 老版本没有这个 API / 网络失败）。**不猜**。 */
  | { kind: "unknown"; reason: string };

/** 更新 API 里单个包的形状（只取本模块用到的字段）。 */
interface PackageInfo {
  name?: unknown;
  source?: unknown;
  installedVersion?: unknown;
  latestVersion?: unknown;
  updateAvailable?: unknown;
}

/** 从响应里取 `package` 对象（形状不可信，逐项校验）。 */
function packageOf(payload: unknown): PackageInfo | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const pkg = (payload as Record<string, unknown>).package;
  if (typeof pkg !== "object" || pkg === null) return undefined;
  return pkg as PackageInfo;
}

/** 把 `source` 归一成小写字符串。 */
function sourceOf(pkg: PackageInfo): string {
  return typeof pkg.source === "string" ? pkg.source.trim().toLowerCase() : "";
}

/**
 * 哪些 `source` 意味着「这种安装不会通过更新按钮变化」。
 *
 * `linked` 是实测到的（junction / symlink 到源码目录）。`file` 同理（本地路径安装）。
 */
const NON_UPDATABLE_SOURCES: ReadonlySet<string> = new Set(["linked", "file", "directory", "workspace"]);

/**
 * 把一次 `/updates` 响应翻成界面能直接用的结论（纯函数，便于单测）。
 *
 * 判断顺序有意为之：先看「这种安装能不能更新」，再看有没有新版 —— 否则一个链接安装
 * 会显示成「已是最新」，而那是**错的**（它根本不是「更新」这条路）。
 * @param payload - 已解析的 JSON。
 * @returns 更新结论。
 */
export function updateStateOf(payload: unknown): UpdateState {
  const pkg = packageOf(payload);
  if (pkg === undefined) return { kind: "unknown", reason: "更新接口没有返回 package 字段" };
  const source = sourceOf(pkg);
  const installed = typeof pkg.installedVersion === "string" ? pkg.installedVersion : "";
  const latest = typeof pkg.latestVersion === "string" ? pkg.latestVersion : "";
  if (NON_UPDATABLE_SOURCES.has(source)) {
    return { kind: "not-applicable", installed, source };
  }
  if (pkg.updateAvailable === true && latest !== "") {
    return { kind: "available", installed, latest, source };
  }
  // `updateAvailable` 明确为 false 且给了 installedVersion：确实是最新。
  if (pkg.updateAvailable === false && installed !== "") {
    return { kind: "current", installed, source };
  }
  return { kind: "unknown", reason: `更新接口的回答不认识（source=${source || "?"}）` };
}

/** 注入点（测试用）。 */
export interface UpdateCheckDeps {
  /** 同源 fetch；缺省用全局 fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * 问宿主要一次更新结论。
 *
 * 失败一律归 `unknown` 并带上可读原因：**更新检查失败不该看起来像「已是最新」**——
 * 那会让用户以为没有新版本（与额度「缺数据不补 0」同一条纪律）。
 * @param deps - 注入点。
 * @returns 更新结论。
 */
export async function checkForUpdate(deps: UpdateCheckDeps = {}): Promise<UpdateState> {
  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (doFetch === undefined) return { kind: "unknown", reason: "这个环境没有 fetch" };
  let response: Response;
  try {
    response = await doFetch(`${MARKET_API}/updates?name=${encodeURIComponent(UPDATE_PACKAGE)}&force=1`, {
      method: "GET",
      // 同源请求自带会话 cookie；显式声明只是让意图清楚。
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) {
    // 404 = 这个宿主没有更新 API（老版本市场 / 没装市场）。
    return {
      kind: "unknown",
      reason: response.status === 404 ? "这个宿主没有插件更新接口" : `更新检查失败（HTTP ${response.status}）`,
    };
  }
  try {
    return updateStateOf(await response.json());
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 发起一次更新（**会真的改动 profile**）。
 *
 * 只在用户点「更新」时调用。返回 `operationId` 供轮询；失败给可读原因。
 * @param deps - 注入点。
 * @returns 操作 id，或失败原因。
 */
export async function startUpdate(
  deps: UpdateCheckDeps = {},
): Promise<{ ok: true; operationId: string } | { ok: false; reason: string }> {
  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (doFetch === undefined) return { ok: false, reason: "这个环境没有 fetch" };
  try {
    const response = await doFetch(`${MARKET_API}/updates`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ packageName: UPDATE_PACKAGE }),
    });
    if (!response.ok) {
      return { ok: false, reason: `请求被拒绝（HTTP ${response.status}）` };
    }
    const payload: unknown = await response.json();
    const id =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).operationId
        : undefined;
    return typeof id === "string" && id !== ""
      ? { ok: true, operationId: id }
      : { ok: false, reason: "宿主接受了请求但没有给出 operationId" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 一次更新操作的进度（只取界面需要的字段）。 */
export interface UpdateOperation {
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "rolled-back" | "unknown";
  /** 失败时的稳定错误码（`RELEASE_TOO_FRESH` 等）。 */
  code?: string;
  /** 失败时的可读说明。 */
  message?: string;
  /** 装完后是否需要刷新页面。 */
  refreshRequired?: boolean;
}

/**
 * 查一次更新操作的进度。
 * @param operationId - `startUpdate` 给的回执。
 * @param deps - 注入点。
 * @returns 进度；查询本身失败时 `state: "unknown"`。
 */
export async function pollUpdate(
  operationId: string,
  deps: UpdateCheckDeps = {},
): Promise<UpdateOperation> {
  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (doFetch === undefined) return { state: "unknown" };
  try {
    const response = await doFetch(
      `${MARKET_API}/operations?operationId=${encodeURIComponent(operationId)}`,
      { method: "GET", credentials: "same-origin", headers: { accept: "application/json" } },
    );
    if (!response.ok) return { state: "unknown" };
    const payload: unknown = await response.json();
    const op =
      typeof payload === "object" && payload !== null
        ? ((payload as Record<string, unknown>).operation ?? payload)
        : undefined;
    if (typeof op !== "object" || op === null) return { state: "unknown" };
    const record = op as Record<string, unknown>;
    const raw = typeof record.state === "string" ? record.state : "";
    const state: UpdateOperation["state"] = (
      ["queued", "running", "succeeded", "failed", "cancelled", "rolled-back"] as const
    ).includes(raw as never)
      ? (raw as UpdateOperation["state"])
      : "unknown";
    return {
      state,
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(typeof record.message === "string" ? { message: record.message } : {}),
      ...(record.refreshRequired === true ? { refreshRequired: true } : {}),
    };
  } catch {
    return { state: "unknown" };
  }
}
