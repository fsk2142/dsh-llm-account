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

/**
 * 本包在 npm 上的名字。
 *
 * 用它而不是手写 `"@dsh-llm-account"`：插件市场与宿主的诊断工具都按**包名**找人
 * （`data-plugin="<包名>"`），写错一个前缀就让「这个样式是谁注入的」查不到。
 */
const PACKAGE_NAME = "dsh-llm-account";

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
/* 标题行：名字在左、版本与更新控件在右（2026-10-21 用户要求「放到最右边」）。
   两端对齐 + 允许换行：窄侧边栏里控件掉到第二行，而不是把标题挤没。 */
.dsl-title-row { display: flex; align-items: center; justify-content: space-between;
  gap: 8px; flex-wrap: wrap; }
/* 右侧控件：版本号 / 状态 / 按钮三段横排，都压到 12px 以免比标题还显眼。 */
.dsl-update-meter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 12px; line-height: 18px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
/* 版本号用等宽字形：v0.1.0 这类短串在比例字体里会跳字。 */
.dsl-update-version { font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px; color: var(--dsw-alias-label-secondary); text-wrap: nowrap; }
.dsl-update-state { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
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
/* 可收起卡片的标题行：标题占满，当前状态缩到右端（收起时也能读到关键信息）。 */
.dsl-card-summary-title { flex: 1 1 auto; min-width: 0; }
.dsl-card-summary > small { flex: none; margin: 0; text-align: right; }
/* 收起状态下不显示正文的额外间距（details 自动隐藏，这里只补布局）。 */
.dsl-card[open] > summary { margin-bottom: 2px; }
.dsl-model-summary-title { font-size: 15px; font-weight: 600; line-height: 24px; }
.dsl-model-vendor-group { display: flex; flex-direction: column; gap: 4px; padding-top: 8px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-model-vendor-group:first-of-type { border-top: none; padding-top: 0; }
.dsl-model-group { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 2px 10px; }
.dsl-model-group-summary { display: flex; flex-direction: row; align-items: center; gap: 6px;
  padding: 2px 0; list-style: none; cursor: pointer; color: var(--dsw-alias-label-secondary); }
.dsl-model-group-summary::-webkit-details-marker { display: none; }
.dsl-model-group-summary > svg { flex: none; transition: transform 150ms ease; }
.dsl-model-group-summary > button { flex: none; margin-left: auto; padding: 0 6px; font-size: 11px; line-height: 18px; }
.dsl-model-group[open] > .dsl-model-group-summary > svg,
.dsl-model-vendor-group[open] > .dsl-model-group-summary > svg { transform: rotate(180deg); }
.dsl-model-group-title { font-size: 12px; line-height: 18px; font-weight: 600; }
.dsl-model-add { display: flex; flex-direction: column; gap: 8px; padding-top: 12px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-model-add-title { font-size: 13px; line-height: 20px; font-weight: 600; }
.dsl-model-add-row { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsl-model-add-select { flex: 0 0 auto; min-width: 120px; border: 0; background: transparent;
  padding: 4px 0; color: var(--dsw-alias-label-secondary); }
.dsl-model-add-input { flex: 1 1 220px; min-width: 0; border: 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2); border-radius: 0; background: transparent; padding: 6px 0; }
.dsl-model-add .dsl-actions { justify-content: flex-end; }
/* 「这个模型在这个套餐下能用多少额度」：次要文字，紧挨在开关左边。
   margin-inline-start:auto 让它靠右（模型名在左、额度与开关在右），
   与用户 2026-10-21 指定的「模型名 …… 额度信息 开关」顺序一致。 */
.dsl-model-quota { flex: none; margin-inline-start: auto; padding-inline-end: 8px;
  font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary); text-wrap: nowrap; }
/* 「未知」：官方没公布这个模型的额度（2026-10-21 用户要求用文字说明而不是留空）。
   比正常额度更淡一档，读作「这里没有数据」而不是「额度是这个词」。 */
.dsl-model-quota-unknown { color: var(--dsw-alias-label-tertiary); }
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
.dsl-duration { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 6px; flex: none; }
.dsl-duration-part { display: inline-flex; flex-direction: row; align-items: center; gap: 4px;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsl-duration-part > input { width: 64px; }
.dsl-field input:disabled, .dsl-field select:disabled { cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); }
.dsl-field input[type="number"] { font-variant-numeric: tabular-nums; }
/* 控件贴右、宽度按内容：留给标签列的宽度永远是整行剩余部分（标签不再被挤成竖排单字）。 */
.dsl-field > input[type="text"], .dsl-field > input[type="password"] { flex: 0 0 240px; width: 240px; }
.dsl-field > input[type="number"] { flex: 0 0 140px; width: 140px; }
.dsl-field > select { flex: 0 0 180px; width: 180px; }
/* 还有未保存输入的字段：左侧留一道提示条，让「卡片里那个保存按钮管哪几项」一眼可见。
 * 自动保存没有进度暗示，这个标记是用户唯一能看出「我改的东西还在草稿里」的线索。 */
.dsl-field[data-field-pending="true"] { position: relative; }
.dsl-field[data-field-pending="true"]::before { content: ""; position: absolute; left: -6px;
  top: 50%; transform: translateY(-50%); width: 2px; height: 16px; border-radius: 999px;
  background: var(--dsw-alias-state-business-primary); }

/* ═══ 搜索密钥列表（已添加的那几条） ═══
 * 用户 2026-10-20：「添加后那个默认名占的位置太宽，降低一下高度」。
 *
 * 这些是**列表项**，不是可编辑的设置行，所以不复用 14px 字号 + 上下 8px 内边距：
 * 那条设置行给的是「标签 + 说明 + 控件」的三段高度，而这里只有「一个名字 + 一个 ×」。
 * 压到 12px 字号、上下各 2px，并把状态徽标改成同一行的尾注（不再另起一行）。
 */
.dsl-secret-row { gap: 10px; padding: 2px 0; font-size: 12px; line-height: 18px;
  border-bottom: none; align-items: center; }
.dsl-secret-row .dsl-field-text { flex-direction: row; align-items: center; gap: 8px;
  flex-wrap: nowrap; min-width: 0; font-size: 12px; line-height: 18px; }
/* 引用名可能很长（DEEPSEEK_API_KEY_12）：省略而不是把行撑宽或把 × 挤出去。 */
.dsl-secret-row .dsl-mono { min-width: 0; overflow: hidden; text-overflow: ellipsis;
  text-wrap: nowrap; }
.dsl-secret-row .dsl-field-text > small { flex: none; }
/* × 也矮一档：图标按钮默认 28px，在这一行里比文字高出一截。 */
.dsl-secret-row > .dsl-icon-danger { width: 22px; height: 22px; }
.dsl-secret-row > .dsl-icon-danger svg { width: 14px; height: 14px; }
/* 列表容器：几条紧挨着，不要 8px 的整段间隙（否则「矮了」看不出来）。 */
[data-secret-rows] { gap: 0; padding: 2px 10px; }
[data-secret-rows] > small { font-size: 12px; line-height: 18px; }

/* ═══ 「插件已更新，刷新页面」提示条（2026-10-20） ═══
 * 只在「设置页打得开、侧边栏卡片却没挂上」时出现。用提示色而不是错误色：这不是故障，
 * 是一次正常的安装/更新需要浏览器重新走一遍启动图。
 */
.dsl-notice { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2);
  border-left: 2px solid var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.dsl-notice-title { font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-primary); }
.dsl-notice > small { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
/* 按钮不该被纵向 flex 拉成通栏。 */
.dsl-notice > button { align-self: flex-start; }

/* ═══ vela 缺失时的安装指引（只在这一种登录失败时出现） ═══
 * 三档可执行路径 + 一行可复制的命令。刻意用内嵌面板（dsl-inset）而不是一句话：
 * 用户 2026-10-20 要的是「如何快速安装环境」，不是「请先安装」。
 */
.dsl-vela-guide-title { font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-primary); }
/* 命令块：等宽、可整行选中、允许横向滚动（命令不长，但别让它把卡片撑破）。 */
.dsl-inset > code { display: block; box-sizing: border-box; max-width: 100%; padding: 6px 8px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono); font-size: 12px; line-height: 18px;
  overflow-x: auto; text-wrap: nowrap; user-select: all; }

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
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button,
.dsl-button, .dsl-button-primary, .dsl-button-secondary, .dsl-button-ghost, .dsl-button-danger,
.dsl-button-sm, .dsl-icon, .dsl-icon-danger, .dsl-item {
  display: inline-flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px;
  box-sizing: border-box; height: 32px; padding: 0 12px; margin: 0;
  border: .5px solid transparent; border-radius: var(--dsw-radius-md); background: none;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; letter-spacing: normal; text-align: center; text-wrap: nowrap;
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  -webkit-appearance: none; appearance: none; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button svg,
.dsl-button svg, .dsl-button-primary svg, .dsl-button-secondary svg, .dsl-button-ghost svg,
.dsl-button-danger svg, .dsl-button-sm svg, .dsl-icon svg, .dsl-icon-danger svg, .dsl-item svg {
  flex: none; width: 16px; height: 16px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button:focus-visible,
.dsl-button:focus-visible, .dsl-button-primary:focus-visible, .dsl-button-secondary:focus-visible,
.dsl-button-ghost:focus-visible, .dsl-button-danger:focus-visible, .dsl-button-sm:focus-visible,
.dsl-icon:focus-visible, .dsl-icon-danger:focus-visible, .dsl-item:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button:disabled { cursor: not-allowed; }
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
/* 按账户刷新模型的加载态：图标转圈（aria-busy 由渲染层挂上，与 disabled 同时出现）。 */
@keyframes dsl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dsl-icon[aria-busy="true"] svg { animation: dsl-spin 900ms linear infinite; }
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
/* 表单标题：说明「正在往哪家加账号」（面板底部只有一个表单位置，前后两家共用）。 */
.dsl-add-title { font-size: 13px; line-height: 20px; font-weight: 600; }
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

/* ═══ 账户面板头部：标题 + 账号数 + 右侧动作（重新获取模型） ═══ */
.dsl-panel-head { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsl-panel-head > h2 { flex: none; }
.dsl-panel-count { flex: none; box-sizing: border-box; padding: 1px 8px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsl-panel-head > .dsl-actions { margin-left: auto; }

/* ═══ 账号行：身份行（名称 + 标记 + 动作）在上，额度表在其下 ═══
 * 2026-10-18 起改成**内嵌卡片**：一张账号一块浅色填充 + 发丝描边 + radius-lg，
 * 行与行之间用间距分隔而不是分割线 —— 与中栏用量面板的账号卡片同一形状，
 * 两处界面看起来才是同一个东西。生效账号用强调色描边标出，与用量面板的
 * data-dashboard-effective 同一条语义。 */
.dsl-account-list { display: flex; flex-direction: column; gap: 8px; }
.dsl-account { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 12px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-settings-card-fill); }
/* 生效账号：强调色描边（与用量面板的 data-dashboard-effective 同一条语义）；
 * 被拒绝（冷却/额度用尽）的账号用警示色描边，扫一眼就能看出谁在冷却。 */
.dsl-account[data-effective="true"] { border-color: var(--dsw-alias-state-business-primary); }
.dsl-account[data-rejection-kind] { border-color: var(--dsw-alias-state-warn-primary); }
.dsl-account-group { display: flex; flex-direction: column; gap: 8px; padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-account-group:first-of-type { border-top: none; padding-top: 0; }
.dsl-account-group > h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); }
.dsl-account-head { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsl-account-actions { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;
  gap: 2px; margin-left: auto; }
.dsl-account-actions > .dsl-actions { gap: 2px; flex-wrap: nowrap; }
.dsl-vendor-badge { flex: none; padding: 1px 6px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dsl-new-badge { flex: none; padding: 1px 6px; border-radius: 999px; background:
  var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-inverse, var(--dsw-alias-label-primary));
  font-size: 10px; line-height: 16px; font-weight: 600; }
.dsl-add-chooser { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-group { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-summary { display: inline-flex; flex-direction: row; align-items: center; align-self: flex-start;
  gap: 4px; list-style: none; cursor: pointer; color: var(--dsw-alias-state-business-primary);
  font-size: 13px; line-height: 20px; }
.dsl-add-summary::-webkit-details-marker { display: none; }
.dsl-order-summary { display: inline-flex; align-self: flex-start; list-style: none; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 600; line-height: 20px; }
.dsl-order-summary::-webkit-details-marker { display: none; }
.dsl-add-chooser > .dsl-actions { flex-wrap: wrap; }
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
.dsl-meters { display: flex; flex-direction: column; gap: 10px; }
.dsl-sidebar .dsl-ring-row { flex-wrap: nowrap; gap: 2px; padding: 4px 0 0; }
.dsl-sidebar .dsl-ring { flex: 1 1 0; min-width: 0; }
.dsl-sidebar .dsl-ring-chart,
.dsl-sidebar .dsl-ring-svg { width: 38px; height: 38px; }
.dsl-sidebar .dsl-ring-percent { font-size: 11px; }
.dsl-sidebar .dsl-ring-label { font-size: 12px; line-height: 16px; }
.dsl-sidebar .dsl-ring-note { display: none; }
.dsl-sidebar .dsl-ring-reset { font-size: 10px; line-height: 13px; text-align: center; }
.dsl-sidebar .dsl-meters { display: flex; flex-direction: column; gap: 9px; }
.dsl-quota-row { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsl-meter-head { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between;
  gap: 8px; min-width: 0; font-size: 12px; line-height: 18px; }
.dsl-meter-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap;
  color: var(--dsw-alias-label-tertiary); }
.dsl-quota-value { flex: none; color: var(--dsw-alias-label-primary); font-size: 12px;
  line-height: 18px; font-variant-numeric: tabular-nums; }
.dsl-quota-hint { flex: none; margin-left: 6px; color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 18px; }
/* 账号用量块：紧贴额度条下方，靠一条细分隔线与额度分开 —— 账号卡片本身就是外框，
   不再套第二层框（两层边框+两层内边距会把一行账号撑成一屏）。 */
.dsl-usage-section { display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
  padding-top: 8px; border-top: .5px dashed var(--dsw-alias-border-l1); }
.dsl-usage-head { display: flex; flex-direction: row; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dsl-usage-title { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-usage-period { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; }
.dsl-usage-muted { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.dsl-usage-hint { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
/* 指标块：四块等宽横排，窄容器自动折行（设置页可能很窄）。 */
.dsl-usage-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
.dsl-usage-metric { display: flex; flex-direction: column; gap: 1px; box-sizing: border-box; padding: 7px 9px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-l1); min-width: 0; }
.dsl-usage-metric-value { font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: normal;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dsl-usage-metric-label { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.dsl-usage-metric-hint { font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; }
.dsl-usage-metric[data-tone="ok"] .dsl-usage-metric-value { color: var(--dsw-alias-state-success-primary); }
.dsl-usage-metric[data-tone="warn"] .dsl-usage-metric-value { color: var(--dsw-alias-state-warn-primary); }
.dsl-usage-metric[data-tone="muted"] .dsl-usage-metric-value { color: var(--dsw-alias-label-tertiary); }
/* 核对用的补充数（命中率、缓存读写、最近一次请求）：一行小字，不占指标位。 */
.dsl-usage-foot { display: flex; flex-direction: row; flex-wrap: wrap; gap: 2px 12px;
  font-size: 11px; line-height: 15px; }
.dsl-quota-bar-list { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.dsl-quota-bar { display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%; }
.dsl-quota-bar-head { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsl-quota-bar-label { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-quota-bar-percent { flex: none; font-size: 13px; line-height: 18px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-state-success-primary); }
.dsl-quota-bar[data-quota-bar-level="error"] .dsl-quota-bar-percent { color: var(--dsw-alias-state-error-primary); }
.dsl-quota-bar[data-quota-bar-level="missing"] .dsl-quota-bar-percent,
.dsl-quota-bar[data-quota-bar-level="unlimited"] .dsl-quota-bar-percent { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dsl-quota-bar-track { display: block; overflow: hidden; height: 8px; border-radius: 999px;
  background: var(--dsw-alias-border-l1); }
.dsl-quota-bar-fill { display: block; height: 100%; border-radius: inherit;
  background: var(--dsw-alias-state-success-primary); transition: width 200ms ease; }
.dsl-quota-bar-fill[data-level="error"] { background: var(--dsw-alias-state-error-primary); }
.dsl-quota-bar-meta { display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px;
  font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsl-quota-bar-reset { color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar .dsl-quota-bar-list { gap: 9px; }
.dsl-sidebar .dsl-quota-bar { gap: 3px; }
.dsl-sidebar .dsl-quota-bar-label,
.dsl-sidebar .dsl-quota-bar-percent { font-size: 12px; line-height: 17px; }
.dsl-sidebar .dsl-quota-bar-track { height: 6px; }
.dsl-sidebar .dsl-quota-bar-meta { font-size: 10px; line-height: 14px; }
.dsl-ring { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 64px; }
.dsl-ring-chart { position: relative; width: 40px; height: 40px; }
.dsl-ring-svg { display: block; width: 40px; height: 40px; }
.dsl-ring-track { fill: none; stroke: var(--dsw-alias-border-l2); stroke-width: 3; }
.dsl-ring-fill { fill: none; stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray 200ms ease; }
.dsl-ring-fill[data-level="ok"] { stroke: var(--dsw-alias-state-success-primary); }
.dsl-ring-fill[data-level="warn"] { stroke: var(--dsw-alias-state-warn-primary); }
.dsl-ring-fill[data-level="error"] { stroke: var(--dsw-alias-state-error-primary); }
.dsl-ring-percent { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dsl-ring[data-quota-ring-level="ok"] .dsl-ring-percent { color: var(--dsw-alias-state-success-primary); }
.dsl-ring[data-quota-ring-level="warn"] .dsl-ring-percent { color: var(--dsw-alias-state-warn-primary); }
.dsl-ring[data-quota-ring-level="error"] .dsl-ring-percent { color: var(--dsw-alias-state-error-primary); }
.dsl-ring-label { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsl-ring-note { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsl-ring-reset { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); }
.dsl-ring-row { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 6px 0 2px; }
.dsl-ring-cell { display: flex; justify-content: center; }
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
/* 渲染兜底面板：只在子树抛错时出现。虚线框 —— 它不是一个正常的分组，别让人误以为这是新功能。 */
.dsl-boundary { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 12px;
  border: 1px dashed var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-boundary > h2 { margin: 0; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dsl-boundary > button { align-self: flex-start; }

/* ═══ 卡片内的保存条（只在有未保存输入时出现；放在卡片末尾，不浮动遮挡） ═══
 * 用户 2026-10-20：「一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」。
 * 它现在住在**卡片里**（data-card-save），不再是页面底部那条 —— 所以这里只负责
 * 「一行按钮 + 一行小字」的排布，像一条分隔线，而不是一条横贯页面的操作栏。
 */
.dsl-save { position: static; display: flex; flex-direction: row;
  align-items: center; gap: 12px; box-sizing: border-box; margin-top: 12px; padding: 10px 14px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-save > small { flex: 1 1 auto; min-width: 0; }
/* 一行按钮不该被卡片（纵向 flex）拉成通栏，也不该把两个厂商名挤掉。 */
.dsl-save > button { align-self: flex-start; flex: none; }

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
/* 整张卡片是一个按钮（2026-10-19 用户要求）：点哪里都打开用量面板。
   所以它要长得像能点的：左对齐、指针、悬停浮起；且**不能**沿用按钮的居中与内边距。 */
.dsl-sidebar-button { width: 100%; text-align: left; font: inherit; cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease; }
.dsl-sidebar-button:hover { background: var(--dsw-alias-bg-l2);
  border-color: var(--dsw-alias-border-l3); }
.dsl-sidebar-button:active { background: var(--dsw-alias-bg-l1); }
.dsl-sidebar h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px;
  color: var(--dsw-alias-label-primary); }
.dsl-sidebar-head { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; }
.dsl-sidebar-head > h3 { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  text-wrap: nowrap; }
/* 标题行的三种文字，视觉权重按「账号 > 厂商 > 套餐徽标」递减（用户 2026-10-21 定）：
 * 只有**账号名**是深色加粗的主信息；厂商与套餐跟「用量周期」同色（tertiary），
 * 读作陪衬而不是第二个标题。
 *
 * **字号必须写死**：账号与厂商在 h3 里（13px），而套餐徽标是 h3 的兄弟节点、
 * 继承的是 .dsl-sidebar 的 12px —— 不加这一行两者会差 1px（用户 2026-10-21 问
 * 「确认一下字号是否是统一的」，就是这一处）。 */
.dsl-sidebar-account { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-sidebar-vendor { font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar-vendor::before { content: " · "; }
/* 套餐徽标：**靠右对齐**（用户 2026-10-21 的版式：账号 · 厂商 ……… [套餐]）。
 * margin-inline-start:auto 把它推到行尾；不换行，太长时由标题让位（h3 已可省略号）。
 * 字号与 h3 对齐见上一条注释。 */
.dsl-sidebar-plan { flex: none; margin-inline-start: auto; font-size: 13px; font-weight: 400;
  color: var(--dsw-alias-label-tertiary); text-wrap: nowrap; }
/* 额度行：**一条一行**，「标签 — 进度条 — 重置时间」横向三样（用户 2026-10-19 定稿）。
 *
 * **对齐的关键**：列宽必须定义在**外层容器**上，不能每个行各写一套 —— 每一行是独立网格时，
 * 「5 小时」与「每周」标签宽度不同，后两列的起点就会错开（用户报障「对齐一下两个进度条」）。
 * 现在容器定义一次三列，每行用 display: contents 把子元素直接交给外层网格。 */
.dsl-sidebar-row-primary,
.dsl-sidebar-row-secondary { display: contents; }
.dsl-sidebar-windows { display: grid; grid-template-columns: max-content minmax(40px, 1fr) max-content;
  align-items: center; gap: 6px 8px; width: 100%; min-width: 0; }
/* 表头：「用量周期 / 重置时间」。字号更小、颜色更淡，读作标题而不是数据。
 * 中间那格是空的（对应进度条列），这样三列与下面的数据行严格对齐。 */
.dsl-sidebar-windows-head { display: contents; }
.dsl-sidebar-windows-head > .dsl-sidebar-window-label,
.dsl-sidebar-windows-head > .dsl-sidebar-window-reset { font-size: 10px; line-height: 14px;
  font-weight: 500; color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar-window { display: contents; }
.dsl-sidebar-window-head { display: contents; }
.dsl-sidebar-window-label { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary);
  text-wrap: nowrap; }
/* 重置时间：两行都有。等宽数字 + 固定不换行，两行的右边界因此对齐。 */
.dsl-sidebar-window-reset { font-size: 10px; line-height: 14px; justify-self: end;
  color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; text-wrap: nowrap; }
/* 百分比数值不再单独一行：条已经表达了比例（见 sidebarMeter 的说明）。 */
.dsl-sidebar-window-value { display: none; }
.dsl-sidebar-window[data-sidebar-window-level="error"] .dsl-sidebar-window-track {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l1)); }
.dsl-sidebar-window-track { display: block; overflow: hidden; height: 6px; border-radius: 999px;
  background: var(--dsw-alias-border-l1); min-width: 0; width: 100%; }
.dsl-sidebar-foot { display: flex; flex-direction: row; gap: 8px; }
.dsl-sidebar-foot > button { flex: 1 1 auto; }
.dsl-sidebar .dsl-empty { padding: 10px; font-size: 12px; line-height: 18px; }
.dsl-marks { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }

/* ═══ 中栏仪表盘 ═══
 *
 * **必须能滚动**（用户 2026-10-19：「打开用量面板后无法滚动下滑」）：面板内容随账号数无限
 * 增长（每个账号一段额度 + 用量块），而中栏高度是固定的。给容器高度上限并让它自己滚 ——
 * 否则内容被裁掉、又没有滚动条，后面的账号根本看不到。
 *
 * 收缩的必要条件：默认 min-height 是 auto，会撑破父容器，于是 overflow 永远不生效 ——
 * 这是「加了 overflow 也不能滚」最常见的原因。 */
.dsl-dashboard { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;
  max-width: 760px; padding: 16px 20px 32px; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px;
  max-height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3) transparent; }
.dsl-dashboard::-webkit-scrollbar { width: 10px; }
.dsl-dashboard::-webkit-scrollbar-track { background: transparent; }
.dsl-dashboard::-webkit-scrollbar-thumb { border-radius: 999px; border: 3px solid transparent;
  background-clip: content-box; background-color: var(--dsw-alias-border-l3); }
.dsl-dashboard::-webkit-scrollbar-thumb:hover { background-color: var(--dsw-alias-label-tertiary); }
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

/* ═══ 主栏设置页外壳（「转到设置」打开的面板）═══
 * 一层薄壳：一条返回栏 + 设置页组件本体（dsl-root 自己管排版）。返回栏与仪表盘头部
 * 同形（左对齐一个幽灵按钮），下面直接接页面，不再套一层卡片 —— 设置页自己就有卡片分组。 */
.dsl-settings-panel { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;
  max-width: 760px; padding: 16px 20px 32px; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px; }
.dsl-settings-back { display: flex; flex-direction: row; align-items: center; }

/* ═══ 版本漂移提示（插件更新后页面仍跑旧代码）═══
 * 自建的覆盖层：宿主没有通用对话框 API（2026-10-22 查证）。
 *
 * **z-index 取 9999 而不是 2147483000**：那个最大值会压过宿主自己的模态框与菜单，
 * 用户点开确认框时可能被我们的提示挡住 —— 一个「提醒刷新」的框不该有这种权力。
 * 9999 足以盖过本插件自己的菜单（20）与常见面板（1000 级），又给宿主留了余地。
 * 只做一件事：告诉用户该刷新，并给两个按钮。 */
.dsl-drift-notice { position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; box-sizing: border-box;
  background: var(--dsw-alias-bg-mask, var(--dsw-alias-bg-l1)); }
.dsl-drift-notice-card { display: flex; flex-direction: column; gap: 12px;
  box-sizing: border-box; width: 100%; max-width: 420px; padding: 20px 22px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-l2));
  color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px;
  box-shadow: 0 8px 32px var(--dsw-alias-bg-l1); }
.dsl-drift-notice-title { margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; }
.dsl-drift-notice-body { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsl-drift-notice-actions { display: flex; flex-direction: row; justify-content: flex-end; gap: 8px;
  padding-top: 4px; }
.dsl-drift-notice-later,
.dsl-drift-notice-reload { flex: none; padding: 6px 14px; border-radius: var(--dsw-radius-md);
  font: inherit; cursor: pointer; }
.dsl-drift-notice-later { border: .5px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); }
.dsl-drift-notice-reload { border: 0; background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-button-primary-foreground, var(--dsw-alias-label-primary)); }
`;

/** 各元素用到的类名（渲染层与样式表共用的唯一来源，避免两边写错字）。 */
export const CSS_CLASS = {
  root: "dsl-root",
  header: "dsl-header",
  intro: "dsl-intro",
  diagnostic: "dsl-diagnostic",
  boundary: "dsl-boundary",
  tabs: "dsl-tabs",
  tab: "dsl-tab",
  card: "dsl-card",
  cardFooter: "dsl-card-footer",
  panelHead: "dsl-panel-head",
  panelCount: "dsl-panel-count",
  account: "dsl-account",
  accountList: "dsl-account-list",
  accountGroup: "dsl-account-group",
  vendorBadge: "dsl-vendor-badge",
  newBadge: "dsl-new-badge",
  addChooser: "dsl-add-chooser",
  addSummary: "dsl-add-summary",
  orderSummary: "dsl-order-summary",
  cardSummary: "dsl-card-summary",
  cardSummaryTitle: "dsl-card-summary-title",
  modelSummary: "dsl-model-summary",
  modelSummaryTitle: "dsl-model-summary-title",
  modelGroup: "dsl-model-group",
  modelVendorGroup: "dsl-model-vendor-group",
  modelGroupSummary: "dsl-model-group-summary",
  modelGroupTitle: "dsl-model-group-title",
  modelAdd: "dsl-model-add",
  modelAddTitle: "dsl-model-add-title",
  modelQuota: "dsl-model-quota",
  modelQuotaUnknown: "dsl-model-quota-unknown",
  modelAddRow: "dsl-model-add-row",
  modelAddSelect: "dsl-model-add-select",
  modelAddInput: "dsl-model-add-input",
  duration: "dsl-duration",
  durationPart: "dsl-duration-part",
  mark: "dsl-mark",
  quota: "dsl-quota",
  quotaRow: "dsl-quota-row",
  quotaMissing: "dsl-quota-missing",
  failure: "dsl-failure",
  field: "dsl-field",
  /* 密钥列表行：与设置行同一套排布，但矮一档（列表项，不是可编辑的设置行）。 */
  secretRow: "dsl-secret-row",
  fieldText: "dsl-field-text",
  inline: "dsl-inline",
  inset: "dsl-inset",
  /* vela 缺失时的安装指引块标题（2026-10-20）。 */
  velaGuideTitle: "dsl-vela-guide-title",
  /* 「插件已更新，刷新页面」提示条（2026-10-20）。 */
  notice: "dsl-notice",
  noticeTitle: "dsl-notice-title",
  /* 标题行（名字在左、版本与更新控件在右）与其右侧控件的三段（2026-10-21）。 */
  titleRow: "dsl-title-row",
  updateMeter: "dsl-update-meter",
  updateVersion: "dsl-update-version",
  updateState: "dsl-update-state",
  empty: "dsl-empty",
  note: "dsl-note",
  actions: "dsl-actions",
  add: "dsl-add",
  addField: "dsl-add-field",
  addTitle: "dsl-add-title",
  addGroup: "dsl-add-group",
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
  quotaHint: "dsl-quota-hint",
  quotaBar: "dsl-quota-bar",
  quotaBarHead: "dsl-quota-bar-head",
  quotaBarLabel: "dsl-quota-bar-label",
  quotaBarPercent: "dsl-quota-bar-percent",
  quotaBarTrack: "dsl-quota-bar-track",
  quotaBarFill: "dsl-quota-bar-fill",
  quotaBarMeta: "dsl-quota-bar-meta",
  quotaBarReset: "dsl-quota-bar-reset",
  quotaBarList: "dsl-quota-bar-list",
  usageSection: "dsl-usage-section",
  usageHead: "dsl-usage-head",
  usageTitle: "dsl-usage-title",
  usagePeriod: "dsl-usage-period",
  usageMuted: "dsl-usage-muted",
  usageHint: "dsl-usage-hint",
  usageMetrics: "dsl-usage-metrics",
  usageMetric: "dsl-usage-metric",
  usageMetricValue: "dsl-usage-metric-value",
  usageMetricLabel: "dsl-usage-metric-label",
  usageMetricHint: "dsl-usage-metric-hint",
  usageFoot: "dsl-usage-foot",
  ring: "dsl-ring",
  ringChart: "dsl-ring-chart",
  ringSvg: "dsl-ring-svg",
  ringTrack: "dsl-ring-track",
  ringFill: "dsl-ring-fill",
  ringPercent: "dsl-ring-percent",
  ringLabel: "dsl-ring-label",
  ringNote: "dsl-ring-note",
  ringReset: "dsl-ring-reset",
  ringRow: "dsl-ring-row",
  ringCell: "dsl-ring-cell",
  identity: "dsl-identity",
  identityText: "dsl-identity-text",
  mono: "dsl-mono",
  dot: "dsl-dot",
  toggle: "dsl-toggle",
  quotaTrack: "dsl-quota-track",
  quotaFill: "dsl-quota-fill",
  save: "dsl-save",
  sidebar: "dsl-sidebar",
  sidebarButton: "dsl-sidebar-button",
  sidebarWindows: "dsl-sidebar-windows",
  sidebarWindowsHead: "dsl-sidebar-windows-head",
  sidebarRowPrimary: "dsl-sidebar-row-primary",
  sidebarRowSecondary: "dsl-sidebar-row-secondary",
  sidebarWindow: "dsl-sidebar-window",
  sidebarWindowHead: "dsl-sidebar-window-head",
  sidebarWindowLabel: "dsl-sidebar-window-label",
  sidebarWindowReset: "dsl-sidebar-window-reset",
  sidebarWindowValue: "dsl-sidebar-window-value",
  sidebarWindowTrack: "dsl-sidebar-window-track",
  sidebarShell: "dsl-sidebar-shell",
  sidebarCompact: "dsl-sidebar-compact",
  sidebarHead: "dsl-sidebar-head",
  sidebarAccount: "dsl-sidebar-account",
  sidebarVendor: "dsl-sidebar-vendor",
  sidebarPlan: "dsl-sidebar-plan",
  sidebarFoot: "dsl-sidebar-foot",
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
  tag.setAttribute("data-plugin", PACKAGE_NAME);
  tag.setAttribute("data-plugin-css", id);
  tag.textContent = css;
  dom.head.appendChild(tag);
  return () => tag.remove?.();
}
