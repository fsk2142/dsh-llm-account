/**
 * 统一页面与各卡片的样式表。
 *
 * 约束（Global Constraints）：界面**只用宿主 `--dsw-*` 变量**、自带 `<style data-plugin-css>`、
 * 不修改宿主 DOM 结构。所以这里：
 * - **没有**任何硬编码颜色（`#rrggbb`/`rgb()`/`hsl()`/颜色名一律不出现）—— 主题切换与深浅色由宿主变量承担；
 * - 尺寸用 px（间距/半径不属于主题），字号尽量取宿主的刻度；
 * - 变量名取自**本机已装宿主实际发布的集合**（从桌面端主题包与前端产物里逐个核对出来的，不是编的），例如
 *   `--dsw-alias-label-primary`、`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l2`、
 *   `--dsw-alias-button-primary-fill`、`--dsw-alias-state-business-primary`、`--dsw-radius-md`。
 *   **若某个变量在目标宿主上不存在**：该属性回落到继承/默认值（或用 `var(--x, var(--y))` 给第二选择），
 *   最坏情形是这一处没有颜色，不会崩。
 *
 * 设计语言（与宿主设置页一致）：
 * - 卡片：发丝描边 + `--dsw-radius-xl` + 设置卡片的填充色，扁平、没有投影；
 * - 行：标签在左（附说明在其下）、控件在右；行与行之间是发丝线，不是方框；
 * - 控件：32px 高、`--dsw-radius-md`、发丝描边；行内动作小一档；
 * - 强调色只用于状态（成功/警示/错误）与进度条；主按钮走宿主的「反色」主按钮；
 * - 图标按钮 28px 见方，悬停才浮出底色；破坏性动作平时安静。
 *
 * 作用域：本包只给自己的元素加类（`dsl-` 前缀）与 `data-*` 属性，不动宿主节点、不用 `!important`。
 * @module dsh-llm-account/src/client/css
 */

/** 本包样式表的 id（`<style data-plugin-css="…">` 的值，注入幂等的依据）。 */
export const PAGE_CSS_ID = "@dsh-llm-account/page.css";

/**
 * 组合类名。
 *
 * 「档位」（颜色/角色）与「尺寸」（行内小一档）必须能自由组合，所以渲染层要拼两三个类。
 * 放在这里是因为类名常量就住在这个模块：**渲染层与样式表共用一个真值来源**。
 * 样式表那边每个类各自都是完整按钮（见按钮一节），所以这里即便拼错，也只是少一层
 * 颜色或尺寸，不会掉回浏览器默认样式。
 * @param names - 类名（都是 {@link CSS_CLASS} 里的常量）。
 * @returns 空格分隔的类名。
 */
export function cls(...names: readonly string[]): string {
  return names.join(" ");
}

/**
 * 统一页面 + 卡片 + 侧边栏 + 仪表盘的样式。
 *
 * 三处界面（设置页 / 侧边栏额度卡 / 中栏用量面板）共用这一套 token 与形状，**这是它们
 * 看起来像同一个东西的唯一依据**——分成三份样式各写各的，是「一边精致一边像调试输出」
 * 的根源。
 */
export const PAGE_CSS = `
/* ═══ 页面骨架 ═══ */
.dsl-root { display: flex; flex-direction: column; gap: 12px; max-width: 720px; padding-bottom: 56px;
  font-family: var(--dsw-font-family); font-size: 14px; line-height: 22px;
  color: var(--dsw-alias-label-primary); }
.dsl-header { display: flex; flex-direction: column; gap: 4px; }
.dsl-root h1 { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; letter-spacing: normal; }
.dsl-root h2 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; letter-spacing: normal; }
.dsl-root h3, .dsl-root h4 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px;
  letter-spacing: normal; color: var(--dsw-alias-label-secondary); }
.dsl-intro { margin: 0; font-size: 13px; line-height: 20px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
.dsl-root p { margin: 0; }
.dsl-root small { display: block; font-size: 12px; line-height: 18px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
.dsl-mono { font-family: var(--dsw-font-mono); letter-spacing: 0; }

/* ═══ 标签页：与宿主设置页同款的下划线标签 ═══ */
.dsl-tabs { display: flex; flex-direction: row; gap: 24px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsl-tab { display: inline-flex; align-items: center; height: auto; margin: 0 0 -1px; padding: 6px 0 8px;
  border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; letter-spacing: normal; cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease; }
.dsl-tab:hover { color: var(--dsw-alias-label-primary); }
.dsl-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-brand-primary); }
.dsl-tab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; border-radius: var(--dsw-radius-xs); }

/* ═══ 卡片：宿主设置卡片的原样形状（发丝描边 + radius-xl + 扁平） ═══ */
.dsl-card { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; padding: 14px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill); }
.dsl-card > h2 { flex: none; }
.dsl-card > [data-card-hint] { margin-top: -8px; }
.dsl-card > summary { display: flex; flex-direction: row; align-items: center; gap: 8px; padding: 0;
  color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px;
  list-style: none; cursor: pointer; }
.dsl-card > summary::-webkit-details-marker { display: none; }
.dsl-card > summary > svg { flex: none; color: var(--dsw-alias-label-tertiary); }
.dsl-card[open] > summary > svg { transform: rotate(180deg); }
.dsl-card > summary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 4px; border-radius: var(--dsw-radius-xs); }
/* 卡片底部的常驻开关（如 OpenCode 的自动切换）：一条分隔线把它们与账号列表分开。 */
.dsl-card-footer { display: flex; flex-direction: row; align-items: center; gap: 16px;
  padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l1); }

/* ═══ 设置行：标签与说明在左、控件在右，行间一条发丝线 ═══ */
.dsl-field { display: flex; flex-direction: row; align-items: center; gap: 16px; padding: 8px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l1); font-size: 14px; line-height: 22px; }
.dsl-field:last-child { border-bottom: none; }
.dsl-field-text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0;
  color: var(--dsw-alias-label-primary); font-weight: 400; }
.dsl-field-text > small { font-weight: 400; }

/* ═══ 输入控件 ═══ */
.dsl-field input[type="text"], .dsl-field input[type="number"], .dsl-field input[type="password"],
.dsl-field select, .dsl-inline input[type="text"], .dsl-inline input[type="password"],
.dsl-add-field input[type="text"], .dsl-add-field input[type="password"],
.dsl-search input, .dsl-actions input[type="text"], .dsl-actions input[type="password"] {
  box-sizing: border-box; height: 32px; width: 100%; margin: 0; padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 13px;
  line-height: 20px; transition: border-color 120ms ease; }
.dsl-field input:hover, .dsl-field select:hover, .dsl-inline input:hover, .dsl-add-field input:hover,
.dsl-search input:hover, .dsl-actions input:hover { border-color: var(--dsw-alias-border-l4); }
.dsl-field input:focus, .dsl-field select:focus, .dsl-inline input:focus, .dsl-add-field input:focus,
.dsl-search input:focus, .dsl-actions input:focus { outline: none;
  border-color: var(--dsw-alias-state-business-primary); }
.dsl-field input::placeholder, .dsl-inline input::placeholder, .dsl-add-field input::placeholder,
.dsl-search input::placeholder, .dsl-actions input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsl-field input:disabled, .dsl-field select:disabled { cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); }
.dsl-field input[type="number"] { font-variant-numeric: tabular-nums; }
/* 控件贴右、宽度按内容：留给标签列的宽度永远是整行剩余部分（标签不再被挤成竖排单字）。 */
.dsl-field > input[type="text"], .dsl-field > input[type="password"] { flex: 0 0 240px; width: 240px; }
.dsl-field > input[type="number"] { flex: 0 0 140px; width: 140px; }
.dsl-field > select { flex: 0 0 180px; width: 180px; }

/* ═══ 开关（appearance:none 画出来的滑轨，比默认复选框更符合「开/关」语义） ═══ */
.dsl-toggle { appearance: none; -webkit-appearance: none; position: relative; flex: none;
  box-sizing: border-box; width: 34px; height: 20px; margin: 0; padding: 0; border: none;
  border-radius: 999px; background: var(--dsw-alias-border-l2); cursor: pointer;
  transition: background 150ms ease; }
.dsl-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; box-sizing: border-box;
  width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-static-neutral-bluish-00);
  transition: transform 150ms ease; }
.dsl-toggle:checked { background: var(--dsw-alias-state-business-primary); }
.dsl-toggle:checked::after { transform: translateX(14px); }
.dsl-toggle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; }
.dsl-toggle:disabled { cursor: not-allowed; opacity: .5; }

/* ═══ 搜索框：发丝边 + 左侧留白给放大镜（两个伪元素画出来，不引图标字体） ═══ */
.dsl-search { position: relative; display: flex; flex-direction: row; align-items: center; }
.dsl-search input { padding-left: 32px; }
.dsl-search::before { content: ""; position: absolute; left: 12px; top: 50%; margin-top: -6px;
  box-sizing: border-box; width: 10px; height: 10px; border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-radius: 50%; pointer-events: none; }
.dsl-search::after { content: ""; position: absolute; left: 21px; top: 50%; margin-top: 3px;
  width: 6px; height: 1.5px; background: var(--dsw-alias-label-tertiary);
  transform: rotate(45deg); pointer-events: none; }
.dsl-search-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* ═══ 按钮 ═══
 * 两条纪律：
 * 1. 我们渲染的每一个按钮都有形状：:where() 把容器那半截选择器的特异度归零，所以这里只管
 *    「没挂任何档位类」的兜底，档位类永远压得过它。
 * 2. 每个档位类**各自都是完整按钮**：只挂一个也是这个形状。
 */
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar) button,
.dsl-button, .dsl-button-primary, .dsl-button-secondary, .dsl-button-ghost, .dsl-button-danger,
.dsl-button-sm, .dsl-icon, .dsl-icon-danger, .dsl-item {
  display: inline-flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px;
  box-sizing: border-box; height: 32px; padding: 0 12px; margin: 0;
  border: .5px solid transparent; border-radius: var(--dsw-radius-md); background: none;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; letter-spacing: normal; text-align: center; text-wrap: nowrap;
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  -webkit-appearance: none; appearance: none; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar) button svg,
.dsl-button svg, .dsl-button-primary svg, .dsl-button-secondary svg, .dsl-button-ghost svg,
.dsl-button-danger svg, .dsl-button-sm svg, .dsl-icon svg, .dsl-icon-danger svg, .dsl-item svg {
  flex: none; width: 16px; height: 16px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar) button:focus-visible,
.dsl-button:focus-visible, .dsl-button-primary:focus-visible, .dsl-button-secondary:focus-visible,
.dsl-button-ghost:focus-visible, .dsl-button-danger:focus-visible, .dsl-button-sm:focus-visible,
.dsl-icon:focus-visible, .dsl-icon-danger:focus-visible, .dsl-item:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar) button:disabled { cursor: not-allowed; }
.dsl-button-primary { background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground); }
.dsl-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsl-button-primary:disabled { border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); }
.dsl-button-secondary { border-color: var(--dsw-alias-border-l3); }
.dsl-button-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-button-secondary:disabled { border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-dimmed); }
.dsl-button-ghost { color: var(--dsw-alias-label-secondary); }
.dsl-button-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-button-ghost:disabled, .dsl-button-danger:disabled, .dsl-button-sm:disabled {
  color: var(--dsw-alias-label-dimmed); }
.dsl-button-danger { color: var(--dsw-alias-state-error-primary); }
.dsl-button-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover)); }
/* 行内动作小一档：宿主 rowActions 的原样数值（28px / 12px / radius-sm） */
.dsl-button-sm { height: 28px; padding: 0 10px; border-radius: var(--dsw-radius-sm);
  font-size: 12px; line-height: 18px; }
.dsl-button-sm svg { width: 14px; height: 14px; }
/* 图标按钮：见方、无文字，悬停浮出底色；破坏性版本平时也保持安静，悬停才变色。 */
.dsl-icon, .dsl-icon-danger { width: 28px; height: 28px; padding: 0;
  border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); }
.dsl-icon:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-icon-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger,
  var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-state-error-primary); }
.dsl-icon[aria-expanded="true"] svg { transform: rotate(180deg); }
.dsl-icon svg, .dsl-icon-danger svg, .dsl-card > summary > svg {
  transition: transform 150ms ease; transform-box: fill-box; transform-origin: center; }
/* 菜单项：占满菜单宽度的左对齐行 */
.dsl-item { justify-content: flex-start; width: 100%; height: 30px; padding: 0 8px; gap: 8px;
  border-radius: var(--dsw-radius-sm); font-size: 13px; font-weight: 400; text-align: left; }
.dsl-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-item.dsl-button-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-state-error-primary); }
/* 溢出菜单：一个原生 details，摘要就是 28px 的图标按钮；面板绝对定位在它的右下角。 */
.dsl-menu { position: relative; flex: none; }
.dsl-menu > summary { list-style: none; }
.dsl-menu > summary::-webkit-details-marker { display: none; }
.dsl-menu[open] > summary { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-menu-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; min-width: 176px;
  padding: 5px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-shadow-lv3); }
.dsl-actions { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-actions > input[type="text"], .dsl-actions > input[type="password"] {
  flex: 1 1 180px; width: auto; min-width: 0; }
.dsl-inline { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-inline input[type="text"], .dsl-inline input[type="password"] { flex: 1 1 180px; }

/* ═══ 内嵌面板：展开报告、编辑器、登录说明、错误详情 ═══ */
.dsl-inset { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 10px 12px;
  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-inset p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere; }
.dsl-inset[data-report] p { font-family: var(--dsw-font-mono); }
.dsl-inset .dsl-inline { padding: 0; }
/* 编辑器是「一行输入 + 两个按钮」：inset 与 inline 同时挂上时按行排（否则纵向布局会把
 * 输入框的 flex-basis 当高度用，面板被撑成一整块空白）。 */
.dsl-inset.dsl-inline { flex-direction: row; align-items: center; gap: 8px; }
/* 内嵌面板是纵向 flex：按钮不该被拉成通栏（登录入口曾经是一整条 660px 的框）。 */
.dsl-inset > button, .dsl-inset > .dsl-actions, .dsl-inset > .dsl-add { align-self: flex-start; }
/* 卡片里的独立按钮同样不该被拉成通栏（卡片是纵向 flex，默认 align-items:stretch）。 */
.dsl-card > button { align-self: flex-start; }
.dsl-link { color: var(--dsw-alias-link); font-family: var(--dsw-font-mono); font-size: 12px;
  line-height: 18px; overflow-wrap: anywhere; }

/* ═══ 空态：虚线框里一句话，不是一段裸文本 ═══ */
.dsl-note { margin: 0; padding: 2px 0; color: var(--dsw-alias-label-tertiary); font-size: 13px;
  line-height: 20px; }
.dsl-empty { box-sizing: border-box; margin: 0; padding: 14px 12px; text-align: center;
  border: .5px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ═══ 添加账户：收起时是一个入口，展开时是一张表单 ═══ */
.dsl-add { display: flex; flex-direction: column; gap: 8px; }
.dsl-add > .dsl-field { border-bottom: none; padding: 0; }
/* 表单字段：标签在上、输入占满整行（添加表单不是设置行，标签不需要与输入抢同一行）。 */
.dsl-add-field { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-field > small { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsl-add-field > input { width: 100%; }
.dsl-add-trigger { display: flex; flex-direction: row; align-items: center; justify-content: center;
  gap: 6px; align-self: stretch; box-sizing: border-box; height: 38px; padding: 0 12px;
  border: .5px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 20px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease,
  color 120ms ease; }
.dsl-add-trigger::before { content: "+"; font-size: 15px; line-height: 1;
  color: var(--dsw-alias-label-tertiary); }
.dsl-add-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l4); color: var(--dsw-alias-label-primary); }
.dsl-add-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px; }

/* ═══ 账号行：身份行（名称 + 标记 + 动作）在上，额度表在其下 ═══ */
.dsl-account { display: flex; flex-direction: column; gap: 8px; padding: 10px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsl-account:last-of-type { border-bottom: none; padding-bottom: 0; }
.dsl-account-head { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsl-account-actions { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;
  gap: 2px; margin-left: auto; }
.dsl-account-actions > .dsl-actions { gap: 2px; flex-wrap: nowrap; }
.dsl-dot { flex: none; box-sizing: border-box; width: 7px; height: 7px; border-radius: 50%;
  background: var(--dsw-alias-border-l3); transition: background 150ms ease; }
.dsl-account[data-effective="true"] .dsl-dot,
.dsl-dashboard section[data-dashboard-effective="true"] .dsl-dot {
  background: var(--dsw-alias-state-success-primary); }
.dsl-account[data-rejection-kind] .dsl-dot,
.dsl-dashboard section[data-dashboard-rejection-kind] .dsl-dot {
  background: var(--dsw-alias-state-warn-primary); }
/* 身份块贴着自己的内容（不抢剩余宽度）：名称、标记按顺序排在一起，右端留给动作。 */
.dsl-identity { display: flex; flex-direction: row; align-items: center; gap: 9px;
  flex: 0 1 auto; min-width: 0; }
.dsl-identity-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsl-identity-text > small { font-size: 12px; line-height: 18px; }
.dsl-name-row { display: flex; flex-direction: row; align-items: center; gap: 6px; min-width: 0; }
.dsl-name-row > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap;
  font-size: 14px; font-weight: 500; line-height: 22px; }
/* 拒绝原因（冷却/额度用尽/服务端拒绝）：单独一行可读文本，用警示色，不装成标签。 */
.dsl-rejection { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-state-warn-primary); overflow-wrap: anywhere; }
/* 拖拽手柄：六个点（径向渐变点阵），不引图标字体、不引外部资源。 */
.dsl-drag { flex: none; width: 12px; height: 18px; margin-left: 2px; opacity: .55;
  cursor: grab; background-image: radial-gradient(circle at 2px 2px,
  var(--dsw-alias-label-tertiary) 1px, transparent 1.2px); background-size: 6px 6px; }

/* ═══ 标签（宿主 rowTag 的形状） ═══ */
.dsl-mark { flex: none; box-sizing: border-box; padding: 0 6px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 16px; font-weight: 400; text-wrap: nowrap; }
.dsl-mark[data-state="success"], .dsl-mark[data-mark="effective"] {
  color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsl-mark[data-state="warn"] {
  color: var(--dsw-alias-state-warn-label); border-color: var(--dsw-alias-state-warn-primary); }
.dsl-mark[data-mark="plan"] { color: var(--dsw-alias-label-secondary);
  border-color: var(--dsw-alias-border-l3); }

/* ═══ 额度：每个窗口一小块（标签 + 读数 + 4px 进度条） ═══ */
.dsl-meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px 24px; }
.dsl-sidebar .dsl-meters { display: flex; flex-direction: column; gap: 9px; }
.dsl-quota-row { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsl-meter-head { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between;
  gap: 8px; min-width: 0; font-size: 12px; line-height: 18px; }
.dsl-meter-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap;
  color: var(--dsw-alias-label-tertiary); }
.dsl-quota-value { flex: none; color: var(--dsw-alias-label-primary); font-size: 12px;
  line-height: 18px; font-variant-numeric: tabular-nums; }
.dsl-quota-track { display: block; flex: none; overflow: hidden; box-sizing: border-box; width: 100%;
  height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); }
.dsl-quota-fill { display: block; height: 100%; border-radius: inherit;
  background: var(--dsw-alias-state-business-primary); transition: width 200ms ease; }
.dsl-quota-fill[data-quota-level="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsl-quota-fill[data-quota-level="error"] { background: var(--dsw-alias-state-error-primary); }
.dsl-quota-missing { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsl-quota { display: flex; flex-direction: column; gap: 8px; }
.dsl-failure { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-primary);
  overflow-wrap: anywhere; }
.dsl-diagnostic { box-sizing: border-box; max-height: 240px; margin: 0; padding: 10px 12px;
  overflow: auto; border: .5px solid var(--dsw-alias-border-l2); border-left: 2px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono); font-size: 11px;
  line-height: 17px; overflow-wrap: anywhere; }

/* ═══ 底部保存条（有改动才出现；贴在内容底部，带一层浮起） ═══ */
.dsl-save { position: sticky; bottom: 12px; z-index: 5; display: flex; flex-direction: row;
  align-items: center; gap: 12px; box-sizing: border-box; margin-top: 0; padding: 10px 14px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-shadow-lv3); }
.dsl-save > small { flex: 1 1 auto; min-width: 0; }

/* ═══ 侧边栏额度卡（紧凑一档） ═══
 * 宿主侧边栏收起时，「sidebar.footer.action」 槽位只有约 35px 宽；整张卡片塞不进去会向左溢出到
 * 窗口外。外壳声明成宽度容器，窄的时候由容器查询换成单个图标按钮（完整卡片整个隐藏）。
 */
.dsl-sidebar-shell { display: block; box-sizing: border-box; width: 100%; min-width: 0;
  container-type: inline-size; }
.dsl-sidebar-compact { display: none; }
@container (max-width: 190px) {
  .dsl-sidebar-shell .dsl-sidebar { display: none; }
  .dsl-sidebar-shell .dsl-sidebar-compact { display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px; }
}
.dsl-sidebar { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 10px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill); color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; }
.dsl-sidebar h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px;
  color: var(--dsw-alias-label-primary); }
.dsl-sidebar-head { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; }
.dsl-sidebar-head > h3 { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  text-wrap: nowrap; }
.dsl-sidebar-head > button { margin: -5px -6px 0 0; }
.dsl-sidebar-foot { display: flex; flex-direction: row; gap: 8px; }
.dsl-sidebar-foot > button { flex: 1 1 auto; }
.dsl-sidebar .dsl-empty { padding: 10px; font-size: 12px; line-height: 18px; }
.dsl-switch { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px 8px;
  box-sizing: border-box; padding: 6px 8px; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label);
  font-size: 11px; line-height: 16px; }
.dsl-switch > time { margin-left: auto; font-variant-numeric: tabular-nums; }
.dsl-switch > .dsl-mark { border-color: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-label); }
.dsl-marks { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }

/* ═══ 中栏仪表盘 ═══ */
.dsl-dashboard { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;
  max-width: 760px; padding: 16px 20px 32px; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px; }
.dsl-dashboard > header { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.dsl-dashboard > header > h2 { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 16px;
  font-weight: 500; line-height: 24px; }
.dsl-dashboard h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.dsl-dashboard h4 { margin: 0; min-width: 0; font-size: 14px; font-weight: 500; line-height: 22px;
  overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
.dsl-dashboard p { margin: 0; font-size: 12px; line-height: 18px; }
.dsl-dashboard ul { margin: 0; padding-left: 16px; color: var(--dsw-alias-state-warn-primary);
  font-size: 12px; line-height: 18px; }
.dsl-dashboard small { display: block; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsl-dashboard section { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 12px 14px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-settings-card-fill); }
.dsl-dashboard section[data-dashboard-effective="true"] {
  border-color: var(--dsw-alias-state-business-primary); }
.dsl-dashboard [data-switch-record] { display: flex; flex-direction: row; align-items: center; gap: 8px;
  padding: 7px 0; border-bottom: .5px solid var(--dsw-alias-border-l1); font-size: 12px;
  line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsl-dashboard [data-switch-record]:last-child { border-bottom: none; padding-bottom: 0; }
.dsl-dashboard [data-switch-record] time { margin-left: auto; flex: none;
  color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
`;

/** 各元素用到的类名（渲染层与样式表共用的唯一来源，避免两边写错字）。 */
export const CSS_CLASS = {
  root: "dsl-root",
  header: "dsl-header",
  intro: "dsl-intro",
  diagnostic: "dsl-diagnostic",
  tabs: "dsl-tabs",
  tab: "dsl-tab",
  card: "dsl-card",
  cardFooter: "dsl-card-footer",
  account: "dsl-account",
  mark: "dsl-mark",
  quota: "dsl-quota",
  quotaRow: "dsl-quota-row",
  quotaMissing: "dsl-quota-missing",
  failure: "dsl-failure",
  field: "dsl-field",
  fieldText: "dsl-field-text",
  inline: "dsl-inline",
  inset: "dsl-inset",
  empty: "dsl-empty",
  note: "dsl-note",
  actions: "dsl-actions",
  add: "dsl-add",
  addField: "dsl-add-field",
  search: "dsl-search",
  searchCount: "dsl-search-count",
  button: "dsl-button",
  buttonPrimary: "dsl-button-primary",
  buttonSecondary: "dsl-button-secondary",
  buttonGhost: "dsl-button-ghost",
  buttonDanger: "dsl-button-danger",
  buttonSm: "dsl-button-sm",
  icon: "dsl-icon",
  iconDanger: "dsl-icon-danger",
  item: "dsl-item",
  menu: "dsl-menu",
  menuPanel: "dsl-menu-panel",
  addTrigger: "dsl-add-trigger",
  link: "dsl-link",
  accountHead: "dsl-account-head",
  accountActions: "dsl-account-actions",
  nameRow: "dsl-name-row",
  rejection: "dsl-rejection",
  drag: "dsl-drag",
  meters: "dsl-meters",
  meterHead: "dsl-meter-head",
  meterLabel: "dsl-meter-label",
  quotaValue: "dsl-quota-value",
  identity: "dsl-identity",
  identityText: "dsl-identity-text",
  mono: "dsl-mono",
  dot: "dsl-dot",
  toggle: "dsl-toggle",
  quotaTrack: "dsl-quota-track",
  quotaFill: "dsl-quota-fill",
  save: "dsl-save",
  sidebar: "dsl-sidebar",
  sidebarShell: "dsl-sidebar-shell",
  sidebarCompact: "dsl-sidebar-compact",
  sidebarHead: "dsl-sidebar-head",
  sidebarFoot: "dsl-sidebar-foot",
  switchNotice: "dsl-switch",
  marks: "dsl-marks",
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
