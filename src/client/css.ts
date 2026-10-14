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

/** 统一页面 + 卡片 + 侧边栏 + 仪表盘的样式。 */
export const PAGE_CSS = `
.dsl-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 72px; color: var(--dsw-alias-label-primary); }
.dsl-root h1 { font-size: var(--dsw-font-s-14); margin: 0; }
.dsl-root h2 { font-size: var(--dsw-font-xxs-12); margin: 0 0 6px; color: var(--dsw-alias-label-primary); }
.dsl-root h3 { font-size: var(--dsw-font-xxs-12); margin: 12px 0 6px; }
.dsl-root h4 { font-size: var(--dsw-font-xxs-12); margin: 0; }
.dsl-root small { display: block; font-size: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.dsl-intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: var(--dsw-font-xxs-12); }

.dsl-tabs { display: flex; flex-direction: row; gap: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsl-tabs button { background: none; border: none; border-bottom: 2px solid transparent; padding: 6px 10px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: var(--dsw-font-xxs-12); }
.dsl-tabs button[aria-selected="true"] { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.dsl-tabs button:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dsl-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }

.dsl-account { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; }
.dsl-account[data-dashboard-effective="true"] { border-color: var(--dsw-alias-brand-primary); }
.dsl-account[data-rejection-kind] { border-color: var(--dsw-alias-state-warn-primary); }
.dsl-mark { font-size: var(--dsw-font-xxxs-11); padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }

.dsl-quota { display: flex; flex-direction: column; gap: 2px; min-width: 160px; }
.dsl-quota-row { display: flex; flex-direction: row; justify-content: space-between; gap: 8px; font-size: var(--dsw-font-xxxs-11); }
.dsl-quota-missing { color: var(--dsw-alias-label-tertiary); }
.dsl-failure { color: var(--dsw-alias-state-warn-primary); }

.dsl-field { display: flex; flex-direction: column; gap: 2px; }
.dsl-field input[type="text"], .dsl-field input[type="number"], .dsl-field select,
.dsl-inline input[type="text"], .dsl-inline input[type="password"] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 4px 8px; font-size: var(--dsw-font-xxs-12); }

.dsl-actions { display: flex; flex-direction: row; gap: 8px; align-items: center; }
.dsl-actions button, .dsl-inline button, .dsl-card button {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 8px; cursor: pointer;
  font-size: var(--dsw-font-xxxs-11); }
.dsl-actions button:hover, .dsl-inline button:hover, .dsl-card button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-actions button:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }

.dsl-save { position: sticky; bottom: 0; display: flex; flex-direction: row; gap: 10px; align-items: center;
  padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.dsl-save button { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
  border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; }

.dsl-sidebar { display: flex; flex-direction: column; gap: 4px; padding: 8px; font-size: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-secondary); }
.dsl-switch { display: flex; flex-direction: row; gap: 6px; flex-wrap: wrap; color: var(--dsw-alias-state-warn-label);
  font-size: var(--dsw-font-xxxs-11); }
.dsl-dashboard { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.dsl-dashboard section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px; background: var(--dsw-alias-bg-layer-1); }
.dsl-dashboard section[data-dashboard-effective="true"] { border-color: var(--dsw-alias-brand-primary); }
`;

/** 各元素用到的类名（渲染层与样式表共用的唯一来源，避免两边写错字）。 */
export const CSS_CLASS = {
  root: "dsl-root",
  intro: "dsl-intro",
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
