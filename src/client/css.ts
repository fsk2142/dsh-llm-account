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
/* —— 页面骨架：与宿主设置面板同宽（ModelsSection 的 max-width: 720px） —— */
.dsl-root { display: flex; flex-direction: column; gap: 12px; max-width: 720px; padding-bottom: 72px;
  font-family: var(--dsw-font-family); color: var(--dsw-alias-label-primary); }

.dsl-root h1 { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; letter-spacing: normal; }
.dsl-root h2 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; letter-spacing: normal; }
.dsl-root h3, .dsl-root h4 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px;
  letter-spacing: normal; color: var(--dsw-alias-label-secondary); }
.dsl-intro { margin: 0; font-size: 14px; line-height: 22px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
.dsl-root small { display: block; font-size: 12px; line-height: 18px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
/* 等宽片段（模型 id、诊断原文）：宿主代码块同样走等宽 + 极小的字距 */
.dsl-mono { font-family: var(--dsw-font-mono); letter-spacing: 0.01em; }

/* —— 标签页：与插件市场同款的下划线标签 —— */
.dsl-tabs { display: flex; flex-direction: row; gap: 24px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsl-tabs button { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -.5px;
  padding: 8px 0; cursor: pointer; color: var(--dsw-alias-label-secondary); font: inherit;
  font-size: 14px; line-height: 22px; transition: color 120ms ease, border-color 120ms ease; }
.dsl-tabs button:hover { color: var(--dsw-alias-label-primary); }
.dsl-tabs button[aria-selected="true"] { color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-brand-primary); }
.dsl-tabs button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: -2px; border-radius: var(--dsw-radius-xs); }

/* —— 卡片：宿主设置卡片的原样形状（.5px 描边 + radius-xl + 扁平，无阴影） —— */
.dsl-card { display: flex; flex-direction: column; gap: 12px; padding: 16px;
  border: .5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill); }
.dsl-card > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
  color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
.dsl-card > summary::-webkit-details-marker { display: none; }
.dsl-card > summary::before { content: "\u203A"; display: inline-block; font-size: 14px;
  color: var(--dsw-alias-label-tertiary); transition: transform 120ms ease; }
.dsl-card[open] > summary::before { transform: rotate(90deg); }
.dsl-card > summary:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 2px; border-radius: var(--dsw-radius-xs); }
/* 卡片内的分组标题右侧留白给动作（宿主 rowHead + rowActions margin-left:auto 的同一做法） */
.dsl-card > h2 + small { margin-top: -6px; }

/* —— 设置行：标签在左、控件在右，行间一条发丝线（PreferenceRow 的原样形状） —— */
.dsl-field { display: flex; flex-direction: row; align-items: center; gap: 16px; padding: 14px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2); font-size: 14px; line-height: 22px; }
.dsl-field:last-child { border-bottom: none; }
.dsl-field > span:first-child { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  color: var(--dsw-alias-label-primary); font-weight: 400; }
.dsl-field small { font-weight: 400; }

/* —— 控件 —— */
.dsl-field input[type="text"], .dsl-field input[type="number"], .dsl-field input[type="password"],
.dsl-field select, .dsl-inline input[type="text"], .dsl-inline input[type="password"], .dsl-search input {
  box-sizing: border-box; height: 32px; width: 100%; font: inherit; font-size: 14px; line-height: 22px;
  padding: 0 10px; color: var(--dsw-alias-label-primary); caret-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md); transition: border-color 120ms ease; }
.dsl-field input:hover, .dsl-field select:hover { border-color: var(--dsw-alias-border-l3); }
.dsl-field input:focus, .dsl-field select:focus, .dsl-inline input:focus, .dsl-search input:focus {
  outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsl-field input::placeholder, .dsl-inline input::placeholder, .dsl-search input::placeholder {
  color: var(--dsw-alias-label-dimmed); }
.dsl-field input:disabled, .dsl-field select:disabled { color: var(--dsw-alias-label-dimmed);
  cursor: not-allowed; background: var(--dsw-alias-bg-layer-2); }
.dsl-field input[type="number"] { font-variant-numeric: tabular-nums; }
/* 文本类控件占右半栏；复选框与下拉按内容宽度 */
.dsl-field > input[type="text"], .dsl-field > input[type="number"], .dsl-field > input[type="password"],
.dsl-field > select { flex: 1 1 auto; max-width: 260px; min-width: 0; }
.dsl-field > input[type="checkbox"] { box-sizing: border-box; flex: none; width: 16px; height: 16px;
  margin: 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsl-field > input[type="checkbox"]:focus-visible { outline: var(--dsw-focus-ring-width) solid
  var(--dsw-focus-ring-color); outline-offset: 2px; }

/* —— 搜索框：与插件市场的搜索框同形（发丝边 + 圆角 + 左侧留白给图标） —— */
.dsl-search { position: relative; display: flex; align-items: center; }
.dsl-search input { padding-left: 34px; }
/* 放大镜是两个伪元素画出来的（一个圈 + 一根柄）：不引图标字体、不引外部资源 */
.dsl-search::before { content: ""; position: absolute; left: 13px; top: 50%; margin-top: -6px;
  box-sizing: border-box; width: 10px; height: 10px; border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-radius: 50%; pointer-events: none; }
.dsl-search::after { content: ""; position: absolute; left: 23px; top: 50%; margin-top: 3px;
  width: 6px; height: 1.5px; background: var(--dsw-alias-label-tertiary); transform: rotate(45deg);
  pointer-events: none; }
.dsl-search-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* —— 按钮：宿主按钮的原样尺寸（32px 高、radius-md、14px 字） —— */
.dsl-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  box-sizing: border-box; height: 32px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md);
  font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary);
  cursor: pointer; text-wrap: nowrap; transition: background 120ms ease, border-color 120ms ease; }
.dsl-button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.dsl-button:disabled { cursor: not-allowed; color: var(--dsw-alias-label-dimmed); }
.dsl-button-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsl-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsl-button-secondary { background: none; border: .5px solid var(--dsw-alias-border-l3); }
.dsl-button-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-button-ghost { background: none; color: var(--dsw-alias-label-secondary); }
.dsl-button-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-button-danger { background: none; color: var(--dsw-alias-state-error-primary); }
.dsl-button-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-actions { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-inline { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 10px 0; }

/* —— 添加账户：收起时是一个按钮，展开时是一张表单 —— */
.dsl-add { display: flex; flex-direction: column; gap: 12px; }
.dsl-add > .dsl-field { border-bottom: none; padding: 0; }

/* —— 账号行：宿主身份行的形状（32px 圆点 + 14px/500 名称 + 12px 副文案） —— */
.dsl-account { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 12px;
  padding: 12px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsl-account:last-of-type { border-bottom: none; }
.dsl-dot { box-sizing: border-box; flex: none; width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-border-l2); }
.dsl-account[data-dashboard-effective="true"] .dsl-dot,
.dsl-account[data-effective="true"] .dsl-dot { background: var(--dsw-alias-state-success-primary); }
.dsl-account[data-rejection-kind] .dsl-dot { background: var(--dsw-alias-state-warn-primary); }
.dsl-identity { display: flex; flex-direction: row; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.dsl-identity-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsl-identity-text > strong { font-size: 14px; font-weight: 500; line-height: 22px; overflow-wrap: anywhere; }
.dsl-identity-text > small { font-size: 12px; line-height: 18px; }

/* —— 标签（宿主 rowTag 的形状） —— */
.dsl-mark { flex: none; padding: 1px 6px; border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 16px; text-wrap: nowrap; }
.dsl-mark[data-state="success"], .dsl-mark[data-configured="true"] {
  color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsl-mark[data-state="warn"] { color: var(--dsw-alias-state-warn-primary);
  border-color: var(--dsw-alias-state-warn-primary); }

/* —— 额度：标签在左、数值在右，条是 3px 的细线 —— */
.dsl-quota { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 180px; }
.dsl-quota-row { display: flex; flex-direction: row; align-items: center; justify-content: space-between;
  gap: 16px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsl-quota-row > span:last-child { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dsl-quota-track { overflow: hidden; height: 3px; border-radius: 999px; background: var(--dsw-alias-border-l1); }
.dsl-quota-fill { height: 3px; border-radius: 999px; background: var(--dsw-alias-state-success-primary); }
.dsl-quota-fill[data-level="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsl-quota-fill[data-level="error"] { background: var(--dsw-alias-state-error-primary); }
.dsl-quota-missing { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsl-failure { font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-primary); }
.dsl-diagnostic { overflow-wrap: anywhere; margin: 0; padding: 10px 12px;
  border: .5px solid var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono); font-size: 12px; line-height: 18px; }

/* —— 保存条 —— */
.dsl-save { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: row; gap: 12px;
  align-items: center; margin-top: 4px; padding: 12px 16px; background: var(--dsw-alias-bg-layer-1);
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xl); }

/* —— 侧边栏额度卡：同一套形状，紧凑一档 —— */
.dsl-sidebar { display: flex; flex-direction: column; gap: 8px; padding: 12px;
  border: .5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill); font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.dsl-switch { display: flex; flex-direction: row; gap: 8px; flex-wrap: wrap; align-items: center;
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-label); }
.dsl-dashboard { display: flex; flex-direction: column; gap: 12px; max-width: 720px;
  color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.dsl-dashboard header { display: flex; align-items: center; gap: 8px; }
.dsl-dashboard header > :last-child { margin-left: auto; }
.dsl-dashboard section { display: flex; flex-direction: column; gap: 12px; padding: 16px;
  border: .5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill); }
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
  add: "dsl-add",
  search: "dsl-search",
  searchCount: "dsl-search-count",
  button: "dsl-button",
  buttonPrimary: "dsl-button-primary",
  buttonSecondary: "dsl-button-secondary",
  buttonGhost: "dsl-button-ghost",
  buttonDanger: "dsl-button-danger",
  identity: "dsl-identity",
  identityText: "dsl-identity-text",
  mono: "dsl-mono",
  dot: "dsl-dot",
  quotaTrack: "dsl-quota-track",
  quotaFill: "dsl-quota-fill",
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
