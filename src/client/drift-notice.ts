/**
 * 版本漂移提示框。
 *
 * ## 场景
 *
 * 通过插件市场更新后，宿主侧代码已重新加载，但页面里的客户端 bundle 还是旧的
 * （浏览器只在**页面重载**时重新求值）。两半代码不同步 → 侧边栏渲染异常。
 * 用户此前不得不重启程序，其实**刷新页面就够**。
 *
 * ## 为什么自己画 DOM
 *
 * 宿主没有暴露通用的对话框 API（2026-10-22 查过 client 层：没有 dialog / modal /
 * toast 之类的接缝）。所以这里自建一个最小覆盖层 —— 只做一件事：告诉用户「刷新」，
 * 给两个按钮。
 *
 * ## 约束（与 `css.ts` 同一纪律）
 *
 * - 只用宿主的 `--dsw-*` 变量，不写死颜色；
 * - 没有 DOM 时（测试、SSR）是**空操作**，绝不抛错 —— 它挂在 `apply` 路径上，
 *   抛出去会连累整页；
 * - 只弹一次（同一页面生命周期内记住），避免重复刷新失败的场景里反复打扰。
 *
 * @module dsh-llm-account/src/client/drift-notice
 */

/** 提示框文案。 */
export interface DriftNoticeText {
  title: string;
  body: string;
  reload: string;
  later: string;
}

/** 一个已挂上的提示框。 */
export interface DriftNoticeHandle {
  /** 关掉它（用户点「稍后」或点刷新后）。 */
  dismiss(): void;
}

/** 是否已经弹过（每次页面加载只弹一次）。 */
let shownThisPage = false;

/**
 * 读浏览器的 `document`。
 *
 * tsconfig 的 `lib` 里没有 DOM（刻意的：宿主侧代码不该用 DOM API），所以窄化读取。
 * @returns 只含本模块用到的成员的形状。
 */
function domDocument():
  | {
      body?: { appendChild?: (node: unknown) => unknown; contains?: (node: unknown) => boolean };
      createElement?: (tag: string) => unknown;
      getElementById?: (id: string) => unknown;
      location?: { reload?: () => void };
    }
  | undefined {
  return (globalThis as { document?: ReturnType<typeof domDocument> }).document;
}

/** 元素上要用的最小写属性集合（避免引入 DOM 类型）。 */
interface MinimalElement {
  id: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  setAttribute(name: string, value: string): void;
  appendChild(node: unknown): unknown;
  addEventListener(type: string, handler: () => void): void;
  remove(): void;
}

/** 造一个元素。 */
function elementOf(doc: NonNullable<ReturnType<typeof domDocument>>, tag: string): MinimalElement {
  return (doc.createElement?.(tag) ?? {}) as MinimalElement;
}

/**
 * 弹出「插件已更新，请刷新」提示。
 *
 * @param text - 文案（调用方已按语言取好）。
 * @param onReload - 点「立即刷新」时执行（生产传 `reloadPage`）。
 * @returns 句柄；没有 DOM 或已经弹过时返回 `undefined`。
 */
export function showDriftNotice(text: DriftNoticeText, onReload: () => void): DriftNoticeHandle | undefined {
  const doc = domDocument();
  if (doc?.body?.appendChild === undefined || typeof doc.createElement !== "function") return undefined;
  if (shownThisPage) return undefined;
  // 同一份提示只挂一个：两次 apply（两行各一次）都跑这段代码。
  if (typeof doc.getElementById === "function" && doc.getElementById("dsl-drift-notice") !== null) return undefined;

  shownThisPage = true;

  const root = elementOf(doc, "div");
  root.id = "dsl-drift-notice";
  root.className = "dsl-drift-notice";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-live", "assertive");

  const card = elementOf(doc, "div");
  card.className = "dsl-drift-notice-card";

  const title = elementOf(doc, "h3");
  title.className = "dsl-drift-notice-title";
  title.textContent = text.title;

  const body = elementOf(doc, "p");
  body.className = "dsl-drift-notice-body";
  body.textContent = text.body;

  const actions = elementOf(doc, "div");
  actions.className = "dsl-drift-notice-actions";

  const later = elementOf(doc, "button");
  later.className = "dsl-drift-notice-later";
  later.setAttribute("type", "button");
  later.textContent = text.later;

  const reload = elementOf(doc, "button");
  reload.className = "dsl-drift-notice-reload";
  reload.setAttribute("type", "button");
  reload.textContent = text.reload;

  const dismiss = (): void => {
    // `remove` 在真实的 DOM 元素上存在；测试替身可能没有，那就退化成清空。
    if (typeof root.remove === "function") root.remove();
    else root.textContent = "";
  };

  later.addEventListener("click", dismiss);
  reload.addEventListener("click", () => {
    dismiss();
    onReload();
  });

  actions.appendChild(later);
  actions.appendChild(reload);
  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(actions);
  root.appendChild(card);
  doc.body.appendChild(root);

  return { dismiss };
}

/** 重置「已弹过」的标记（测试用；生产不需要）。 */
export function resetDriftNoticeForTest(): void {
  shownThisPage = false;
}
