/**
 * 行内图标：几个 16×16 的线性 SVG，用 `currentColor` 着色。
 *
 * 为什么自己画而不是引图标库：客户端产物**只能带宿主已提供的东西**（`tsdown.config.ts` 的
 * `CLIENT_EXTERNALS` 只有 react），引一个图标包会把整套字体/组件塞进浏览器产物；而宿主也不提供
 * 一个「取图标」的服务。四个图标各一条 path，比一个依赖便宜得多，也不受网络影响。
 *
 * 颜色全部是 `currentColor`：由按钮/文字的档位类决定，主题切换自动跟随。
 * @module dsh-llm-account/src/client/icons
 */
import { createElement, type ReactElement } from "react";

/** 所有图标的公共外壳（16×16、无填充、装饰性——文案在按钮的 aria-label 上）。 */
const FRAME = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": "true",
  focusable: "false",
} as const;

/** 一条描边路径。 */
function stroke(path: string, extra: Record<string, unknown> = {}): ReactElement {
  return createElement("path", {
    d: path,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...extra,
  });
}

/**
 * 展开/收起用的 V 形箭头。
 *
 * 展开态**不换图标**：`.dsl-icon[aria-expanded="true"] svg` 在样式表里把它转 180°，
 * 这样动画只有一条 transform，不用为两个方向各画一份。
 * @returns svg 元素。
 */
export function ChevronIcon(): ReactElement {
  return createElement("svg", FRAME, stroke("M4 6.25 8 10.25 12 6.25"));
}

/** 「更多操作」的三点。 */
export function MoreIcon(): ReactElement {
  const dot = (cx: number): ReactElement =>
    createElement("circle", { cx, cy: 8, r: 1.25, fill: "currentColor" });
  return createElement("svg", FRAME, dot(3.5), dot(8), dot(12.5));
}

/** 关闭（×）。 */
export function CloseIcon(): ReactElement {
  return createElement("svg", FRAME, stroke("M4.5 4.5 11.5 11.5"), stroke("M11.5 4.5 4.5 11.5"));
}

/** 刷新（一圈箭头）。 */
export function RefreshIcon(): ReactElement {
  return createElement(
    "svg",
    FRAME,
    stroke("M13 8a5 5 0 1 1-1.5-3.6"),
    stroke("M13.25 2.75v3h-3"),
  );
}

/** 删除一行（叉）。 */
export function RemoveIcon(): ReactElement {
  return createElement("svg", FRAME, stroke("M4.5 4.5 11.5 11.5"), stroke("M11.5 4.5 4.5 11.5"));
}

/** 上移 / 下移的箭头（排序控件用）。 */
export function MoveIcon(direction: "up" | "down"): ReactElement {
  return createElement(
    "svg",
    FRAME,
    stroke(direction === "up" ? "M8 12.5v-9" : "M8 3.5v9"),
    stroke(direction === "up" ? "M4.25 7.75 8 3.5l3.75 4.25" : "M4.25 8.25 8 12.5l3.75-4.25"),
  );
}

/** 网页登录（外链箭头）。 */
export function ExternalIcon(): ReactElement {
  return createElement(
    "svg",
    FRAME,
    stroke("M9.5 3.5h3v3"),
    stroke("M12.5 3.5 7 9"),
    stroke("M12 9.5v2.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75H6"),
  );
}

/**
 * 设置（齿轮）：仪表盘头部「转到设置」用。
 *
 * 外圈 + 一个短辐条：16px 下八根辐条会糊成一团，少而粗的线条在小尺寸才可辨。
 */
export function SettingsIcon(): ReactElement {
  return createElement(
    "svg",
    FRAME,
    stroke("M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"),
    stroke("M8 1.5v1.8"),
    stroke("M8 12.7v1.8"),
    stroke("M1.5 8h1.8"),
    stroke("M12.7 8h1.8"),
    stroke("M3.4 3.4l1.3 1.3"),
    stroke("M11.3 11.3l1.3 1.3"),
    stroke("M12.6 3.4l-1.3 1.3"),
    stroke("M4.7 11.3l-1.3 1.3"),
  );
}

/** 用量（三根柱子）：侧边栏收起时唯一的可见入口。 */
export function UsageIcon(): ReactElement {
  const bar = (x: number, y: number, height: number): ReactElement =>
    createElement("rect", { x, y, width: 2, height, rx: 1, fill: "currentColor" });
  return createElement("svg", FRAME, bar(3, 9, 4), bar(7, 5, 8), bar(11, 7.5, 5.5));
}

/** 返回（左箭头）：主栏里的设置页返回用量面板用。 */
export function BackIcon(): ReactElement {
  return createElement(
    "svg",
    FRAME,
    stroke("M12.5 8h-9"),
    stroke("M7 4.5 3.5 8 7 11.5"),
  );
}
