/**
 * 版本漂移检测：判断「页面里的代码」是否落后于「磁盘上已安装的版本」。
 *
 * ## 为什么需要
 *
 * 用户 2026-10-22 报障：通过插件市场更新后，**不重启**的话侧边栏显示异常。
 *
 * 原因是两半代码不同步：
 * - 宿主侧（`lib/index.js` 等）在更新时被重新加载；
 * - 客户端 bundle（`lib/client.js`）只会在**页面重载**时重新求值。
 *
 * 于是页面里跑的还是旧 bundle，与新的宿主代码通信时字段对不上，界面就渲染异常。
 * 重启程序能解决（等于重载一切），但**刷新页面就够了**——用户不必重启。
 *
 * ## 怎么判断
 *
 * 客户端 bundle 里有构建期注入的 `PLUGIN_VERSION`（= 页面加载时的版本）。
 * 宿主侧能读磁盘上 `package.json` 的真实版本（= 更新后的版本）。
 * 两者不同，就说明该刷新了。
 *
 * ## 为什么不做定时轮询
 *
 * 页面不会「自己变旧」—— 变的是磁盘。所以在 `apply`（页面加载/插件激活）时查一次
 * 就够：那一刻要么一致（不需要提示），要么已经落后（提示刷新）。
 *
 * 已知局限：如果页面一直开着、期间插件被更新，这次检测不会主动感知 —— 要等下一次
 * 页面加载或刷新。加定时轮询能覆盖这种情况，但代价是常驻一个网络调用；对一个
 * 「更新完提醒一次」的需求不值得。需要时可在这里加一个低频（如 5 分钟）复查。
 *
 * @module dsh-llm-account/src/client/version-drift
 */

/** 检测结论。 */
export type VersionDrift =
  /** 页面代码与磁盘版本一致。 */
  | { kind: "same"; version: string }
  /** 页面代码落后于磁盘版本 —— 应当提示刷新。 */
  | { kind: "stale"; pageVersion: string; diskVersion: string }
  /** 读不到磁盘版本（老宿主没这个接口 / 请求失败）—— 不提示，不猜。 */
  | { kind: "unknown"; pageVersion: string; reason: string };

/**
 * 构建期注入失败时的占位版本号（见 `update-check.ts` 的 `PLUGIN_VERSION`）。
 *
 * 它不等于任何真实版本，所以**不能拿它做漂移判断** —— 否则每次加载页面都会弹提示，
 * 而用户遇到一次「刷新了也没用」之后就会学会忽略这类提示，那比不提示更糟。
 */
export const UNKNOWN_VERSION = "0.0.0-unknown";

/**
 * 比较两个版本号字符串。
 *
 * 只做**相等性**判断，不比较大小：目的是「页面跑的是不是同一份代码」，
 * 而不是「哪个更新」。所以 `0.7.3` 与 `0.7.30` 在这里必然不同（它们确实是不同的构建）。
 * @param pageVersion - 页面加载时注入的版本。
 * @param diskVersion - 磁盘上读到的版本。
 * @returns 是否一致；任一为空时算不一致（宁可提示刷新，也不要静默用旧代码）。
 */
export function versionsMatch(pageVersion: string, diskVersion: string): boolean {
  const page = pageVersion.trim();
  const disk = diskVersion.trim();
  if (page === "" || disk === "") return false;
  return page === disk;
}

/**
 * 页面版本是否可信（不是占位值）。
 * @param pageVersion - 页面加载时注入的版本。
 * @returns 是否是真实版本号。
 */
export function isKnownVersion(pageVersion: string): boolean {
  const page = pageVersion.trim();
  return page !== "" && page !== UNKNOWN_VERSION;
}

/**
 * 由两个版本号得出检测结论。
 * @param pageVersion - 页面加载时注入的版本。
 * @param diskResult - 宿主返回的磁盘版本（可能是信封或原始值）。
 * @returns 检测结论。
 */
export function driftOf(
  pageVersion: string,
  diskResult: { ok: true; version: string } | { ok: false; reason: string },
): VersionDrift {
  if (!diskResult.ok) return { kind: "unknown", pageVersion, reason: diskResult.reason };
  // 页面版本是占位值：不知道自己在跑哪一版，**不判断**（否则会永久误弹）。
  if (!isKnownVersion(pageVersion)) {
    return { kind: "unknown", pageVersion, reason: "page version is a build-time placeholder" };
  }
  if (versionsMatch(pageVersion, diskResult.version)) {
    return { kind: "same", version: diskResult.version };
  }
  return { kind: "stale", pageVersion, diskVersion: diskResult.version };
}

/** 提示框的文案（两种语言）。 */
export interface DriftPromptText {
  /** 标题，例如「插件已更新」。 */
  title: string;
  /** 正文：说明当前页面跑的是旧版本。 */
  body: string;
  /** 「立即刷新」按钮。 */
  reload: string;
  /** 「稍后」按钮。 */
  later: string;
}

/**
 * 造提示框文案。
 * @param t - 取词函数。
 * @param drift - `stale` 结论。
 * @returns 文案；非 `stale` 时为 `undefined`（不该弹）。
 */
export function driftPromptOf(
  t: (key: string) => string,
  drift: VersionDrift,
): DriftPromptText | undefined {
  if (drift.kind !== "stale") return undefined;
  return {
    title: t("drift.title"),
    body: t("drift.body")
      .replace("{page}", drift.pageVersion)
      .replace("{disk}", drift.diskVersion),
    reload: t("drift.reload"),
    later: t("drift.later"),
  };
}
