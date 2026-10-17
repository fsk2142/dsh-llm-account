/**
 * 统一页面与各卡片的样式表（Task 10 的全分支复核发现：此前**完全没有样式**）。
 *
 * 约束（Global Constraints）：界面**只用宿主 `--dsw-*` 变量**、自带 `<style data-plugin-css>`、
 * 不修改宿主 DOM 结构。所以这里：
 * - **没有**任何硬编码颜色（`#rrggbb`/`rgb()`/`hsl()`/颜色名一律不出现）—— 主题切换与深浅色由宿主变量承担；
 * - 尺寸用 px（间距/半径不属于主题），字号尽量取宿主的 `--dsw-font-*`；
 * - 变量名取自**本机已装插件实际使用的集合**（逐个 grep 出来的，不是编的），例如
 *   `--dsw-alias-label-primary`、`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l1`、
 *   `--dsw-alias-brand-primary`、`--dsw-alias-state-warn-primary`、`--dsw-font-xxs-12`。
 *   **若某个变量在目标宿主上不存在**：该属性回落到继承/默认值，最坏情形是这一处没有颜色，不会崩。
 *
 * 作用域：本包只给自己的元素加类（`dsl-` 前缀）与 `data-*` 属性，不动宿主节点、不用 `!important`。
 * @module dsh-llm-account/src/client/css
 */

/** 本包样式表的 id（`<style data-plugin-css="…">` 的值，注入幂等的依据）。 */
export const PAGE_CSS_ID = "@dsh-llm-account/page.css";

/**
 * 统一页面 + 卡片 + 侧边栏 + 仪表盘的样式。
 *
 * 三处界面（设置页 / 侧边栏额度卡 / 中栏用量面板）共用这一套 token 与形状，**这是它们
 * 看起来像同一个东西的唯一依据**——分成三份样式各写各的，是「一边精致一边像调试输出」
 * 的根源。
 *
 * token 用法（对照桌面端实际发布的 422 个 `--dsw-*` 变量与三个在跑插件的取用）：
 * - 圆角走刻度 `--dsw-radius-*`，不写死像素；
 * - 阴影/描边走 `--dsw-shadow-lv*` 与 `--dsw-alias-border-l*`；
 * - 设置卡片本身有专用 token（`--dsw-alias-settings-card-fill/stroke`），比通用层更贴主题；
 * - 焦点环用 `--dsw-focus-ring-*`（此前完全没有，控件在键盘操作下是「发死」的）；
 * - 字重有 strong 变体（`--dsw-font-xxs-strong-12` 等），标题/字段名靠它分层。
 *
 * 颜色一律走宿主变量：不写死颜色是为了深色主题不坏（`tests/client/css.test.ts` 有护栏）。
 */
export const PAGE_CSS = `
.dsl-root { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 72px; color: var(--dsw-alias-label-primary); }

/* —— 标题层级 —— */
.dsl-root h1 { font-size: var(--dsw-font-s-strong-14); font-weight: 600; margin: 0; letter-spacing: 0.01em; }
.dsl-root h2 { font-size: var(--dsw-font-xxs-strong-12); font-weight: 600; margin: 0;
  color: var(--dsw-alias-label-primary); }
.dsl-root h3, .dsl-root h4 { font-size: var(--dsw-font-xxs-strong-12); font-weight: 600;
  margin: 0; color: var(--dsw-alias-label-secondary); }
.dsl-root small { display: block; font-size: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary); line-height: 1.5; }
.dsl-intro { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: var(--dsw-font-xxs-12); line-height: 1.6; }

/* —— 标签页：分段控件，不是下划线 —— */
.dsl-tabs { display: inline-flex; flex-direction: row; gap: 2px; padding: 2px; align-self: flex-start;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-tabs button { background: none; border: none; border-radius: var(--dsw-radius-sm); padding: 5px 14px;
  cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: var(--dsw-font-xxs-12);
  font-weight: 500; transition: background 120ms ease, color 120ms ease; }
.dsl-tabs button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsl-tabs button[aria-selected="true"] { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font-weight: 600; box-shadow: var(--dsw-shadow-lv1); }
.dsl-tabs button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: 1px; }

/* —— 卡片 —— */
.dsl-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px;
  border: 1px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill); box-shadow: var(--dsw-shadow-lv1); }
.dsl-card > summary { cursor: pointer; color: var(--dsw-alias-label-secondary);
  font-size: var(--dsw-font-xxs-strong-12); font-weight: 600; list-style: none; }
.dsl-card > summary::-webkit-details-marker { display: none; }
.dsl-card > summary::before { content: "▸"; display: inline-block; margin-right: 6px;
  font-size: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); transition: transform 120ms ease; }
.dsl-card[open] > summary::before { transform: rotate(90deg); }
.dsl-card[data-card-hint] { margin: -4px 0 0; }

/* —— 字段：标签在上、控件在下，整行可点 —— */
.dsl-field { display: flex; flex-direction: column; gap: 5px; color: var(--dsw-alias-label-secondary);
  font-size: var(--dsw-font-xxs-12); }
.dsl-field > span:first-child { color: var(--dsw-alias-label-primary); font-size: var(--dsw-font-xxs-12); }
.dsl-field small { margin-top: 1px; }

.dsl-field input[type="text"], .dsl-field input[type="number"], .dsl-field input[type="password"],
.dsl-field select, .dsl-inline input[type="text"], .dsl-inline input[type="password"] {
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  padding: 6px 10px; font-size: var(--dsw-font-xxs-12); font-family: inherit; width: 100%;
  transition: border-color 120ms ease, box-shadow 120ms ease; }
.dsl-field input:hover, .dsl-field select:hover { border-color: var(--dsw-alias-border-l3); }
.dsl-field input:focus, .dsl-field select:focus { outline: none; border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 var(--dsw-focus-ring-width) var(--dsw-focus-ring-color); }
.dsl-field input::placeholder { color: var(--dsw-alias-label-quaternary); }

/* 复选框与它的标签同行：控件不再独占一行，也不撑满 */
.dsl-field input[type="checkbox"] { width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer; }
.dsl-field:has(> input[type="checkbox"]) { flex-direction: row; align-items: center; gap: 8px; }
.dsl-field:has(> input[type="checkbox"]) > span:first-child { order: 2; flex: 1; }

/* —— 按钮 —— */
.dsl-actions { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-actions button, .dsl-inline button, .dsl-card button {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  padding: 5px 12px; cursor: pointer; font-size: var(--dsw-font-xxxs-11); font-family: inherit;
  text-wrap: nowrap; transition: background 120ms ease, border-color 120ms ease; }
.dsl-actions button:hover, .dsl-inline button:hover, .dsl-card button:hover {
  background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l3); }
.dsl-actions button:active, .dsl-inline button:active, .dsl-card button:active {
  background: var(--dsw-alias-interactive-bg-active); }
.dsl-actions button:focus-visible, .dsl-inline button:focus-visible, .dsl-card button:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: 1px; }
.dsl-actions button:disabled { color: var(--dsw-alias-label-dimmed); cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.dsl-inline { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }

/* 「移除」这类次要动作不抢视觉重量 */
.dsl-card button[data-model-remove] { color: var(--dsw-alias-label-tertiary); border-color: transparent;
  background: none; padding: 2px 8px; }
.dsl-card button[data-model-remove]:hover { color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover); border-color: transparent; }

/* —— 模型行：名称 + 开关 + 移除挤在一行 —— */
.dsl-field[data-model] { flex-direction: row; align-items: center; gap: 10px; padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-field[data-model] > span:first-child { flex: 1; font-family: var(--dsw-font-mono);
  font-size: var(--dsw-font-xxxs-11); word-break: break-all; }

/* —— 账号行 —— */
.dsl-account { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-account[data-dashboard-effective="true"] { border-color: var(--dsw-alias-brand-primary);
  box-shadow: var(--dsw-shadow-lv1); }
.dsl-account[data-rejection-kind] { border-color: var(--dsw-alias-state-warn-primary); }
.dsl-mark { font-size: var(--dsw-font-xxxs-strong-11); font-weight: 600; padding: 2px 8px;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary);
  text-wrap: nowrap; }
.dsl-mark[data-state="success"], .dsl-mark[data-configured="true"] {
  color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsl-mark[data-state="warn"] { color: var(--dsw-alias-state-warn-primary);
  border-color: var(--dsw-alias-state-warn-primary); }

/* —— 额度 —— */
.dsl-quota { display: flex; flex-direction: column; gap: 3px; min-width: 160px; flex: 1; }
.dsl-quota-row { display: flex; flex-direction: row; justify-content: space-between; gap: 10px;
  font-size: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-secondary); }
.dsl-quota-row > span:last-child { color: var(--dsw-alias-label-primary); font-weight: 500;
  font-family: var(--dsw-font-mono); }
.dsl-quota-missing { color: var(--dsw-alias-label-tertiary); font-size: var(--dsw-font-xxxs-11); }
.dsl-failure { color: var(--dsw-alias-state-warn-primary); font-size: var(--dsw-font-xxxs-11); }
.dsl-diagnostic { margin: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono);
  font-size: var(--dsw-font-xxxs-11); line-height: 1.6; word-break: break-word; }

/* —— 保存条 —— */
.dsl-save { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: row; gap: 12px;
  align-items: center; margin-top: 4px; padding: 10px 14px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-shadow-lv2); }
.dsl-save button { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
  border: none; border-radius: var(--dsw-radius-sm); padding: 6px 16px; cursor: pointer;
  font-size: var(--dsw-font-xxxs-strong-11); font-weight: 600; font-family: inherit; }
.dsl-save button:hover { background: var(--dsw-alias-interactive-bg-hover-accent); }

/* —— 侧边栏额度卡：与设置页同一套形状，只是更紧凑 —— */
.dsl-sidebar { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
  font-size: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-secondary); }
.dsl-switch { display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; align-items: center;
  color: var(--dsw-alias-state-warn-label); font-size: var(--dsw-font-xxxs-11); }
.dsl-dashboard { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.dsl-dashboard section { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
  border: 1px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill); box-shadow: var(--dsw-shadow-lv1); }
.dsl-dashboard section[data-dashboard-effective="true"] { border-color: var(--dsw-alias-brand-primary); }
`;

/** 各元素用到的类名（渲染层与样式表共用的唯一来源，避免两边写错字）。 */
export const CSS_CLASS = {
  root: "dsl-root",
  intro: "dsl-intro",
  diagnostic: "dsl-diagnostic",
  tabs: "dsl-tabs",
  card: "dsl-card",
  account: "dsl-account",
  mark: "dsl-mark",
  quota: "dsl-quota",
  quotaRow: "dsl-quota-row",
  quotaMissing: "dsl-quota-missing",
  failure: "dsl-failure",
  field: "dsl-field",
  inline: "dsl-inline",
  actions: "dsl-actions",
  save: "dsl-save",
  sidebar: "dsl-sidebar",
  switchNotice: "dsl-switch",
  dashboard: "dsl-dashboard",
} as const;

/** 本模块用到的 DOM 形状（只读 + 建标签 + 挂载/移除）。 */
interface CssDocument {
  head?: { appendChild(node: unknown): unknown };
  querySelector?(selector: string): unknown;
  createElement?(tag: string): { setAttribute(name: string, value: string): void; textContent: string; remove?(): void };
}

/**
 * 注入本包的样式表（`<style data-plugin-css="…">`）。
 *
 * 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:8809-8818`）：
 * `document` 缺席（非浏览器）→ 空操作；**同 id 已存在 → 空操作**（这就是幂等的依据：两行各调一次
 * 也只注入一份）；否则建一个 `<style data-plugin="…" data-plugin-css="id">` 挂到 `head`，并返回移除器。
 *
 * `document` 的类型：tsconfig 的 `lib` 里没有 DOM（刻意的：宿主侧代码不该用 DOM API），所以这里做
 * 一次窄化结构读取，不给整个工程加 `DOM`。样式表与插槽注册是两件独立的事：注册失败不影响样式。
 * @param id - 样式表 id（`data-plugin-css` 的值）。
 * @param css - 样式文本。
 * @returns 移除器；没注入时是空操作。
 */
export function injectPluginCss(id: string, css: string): () => void {
  const dom = (globalThis as { document?: CssDocument }).document;
  if (dom?.head === undefined) return () => undefined;
  if (typeof dom.querySelector === "function" && dom.querySelector(`style[data-plugin-css="${id}"]`) !== null) {
    return () => undefined;
  }
  if (typeof dom.createElement !== "function") return () => undefined;
  const tag = dom.createElement("style");
  tag.setAttribute("data-plugin", "@dsh-llm-account");
  tag.setAttribute("data-plugin-css", id);
  tag.textContent = css;
  dom.head.appendChild(tag);
  return () => tag.remove?.();
}
