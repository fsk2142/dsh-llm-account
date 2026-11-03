/**
 * 侧边栏的**额度矩形卡片**（2026-11-03 需求）。
 *
 * > 如果改成两个圆角矩形，圆角矩形上方是额度信息，内部是剩余额度信息和下次重置时间
 * > 对，但是 5 小时还有每周要和圆角矩形的中心对齐
 * > 额度那个百分比太大了，字体要和重置时间一样，另外就是圆角矩形太细了，
 * > 能不能做成按照百分比逐渐消失，和圆环那种效果差不多
 *
 * ## 版式
 *
 * ```
 *    5 小时                 ← 档位名（居中于矩形）
 *  ╭──────────────╮
 *  │      96%     │        ← 剩余额度（字号与重置时间一致）
 *  │  10-19 20:00 │        ← 下次重置时间
 *  ╰──────────────╯
 * ```
 *
 * ## 边框按比例「逐渐消失」
 *
 * 与圆环同源：把矩形周长 `P` 当作 `stroke-dasharray`，
 * `stroke-dashoffset = P × (1 − 剩余/100)`，于是描出的那段边框**正好是剩余比例** ——
 * 剩余越少，框缺得越多。
 *
 * 为什么用**固定尺寸 + SVG**：`stroke-dasharray` 需要知道周长，而周长依赖盒子尺寸。
 * 盒子尺寸固定（见 {@link BOX_WIDTH} / {@link BOX_HEIGHT}），SVG 的 `viewBox` 与之 1:1，
 * 就不会出现「描边被拉伸变形」。文字用绝对定位盖在 SVG 上。
 *
 * @module dsh-llm-account/src/client/quota-box
 */
import { createElement, type ReactElement } from "react";

import { CSS_CLASS } from "./css";

/**
 * 盒子尺寸（px）。
 *
 * 与 CSS 的 `.dsl-sidebar-box` 宽高必须一致 —— 否则 SVG 的 viewBox 与容器不同比例，
 * 描边会被拉伸。`tests/client/css.test.ts` 里有断言守着这两个数。
 */
export const BOX_WIDTH = 76;
export const BOX_HEIGHT = 44;

/** 圆角半径（px）。 */
const RADIUS = 9;
/** 描边宽度（px）：比原来的 1px 边框粗，视觉上不「太细」。 */
export const BORDER_WIDTH = 2;

/**
 * 矩形周长：`2 × 直边之和 + 2πr`。
 *
 * 描边居中在路径上，所以路径矩形是「盒子内缩半个描边」。
 */
export const BOX_PERIMETER =
  2 * (BOX_WIDTH - BORDER_WIDTH - 2 * RADIUS) +
  2 * (BOX_HEIGHT - BORDER_WIDTH - 2 * RADIUS) +
  2 * Math.PI * RADIUS;

/** 供样式表契约测试核对：盒子尺寸与描边宽度。 */
export const BOX_GEOMETRY = { width: BOX_WIDTH, height: BOX_HEIGHT, border: BORDER_WIDTH } as const;

/**
 * 一个额度矩形卡片。
 *
 * 三种情形**不互相冒充**：「不限」是端点给的事实；读不到写占位符且**不画进度边框**
 * （不猜成 0%）；其余按剩余比例描边。
 * @param props - 剩余额度、档位、两行文本与读屏说明。
 * @returns 矩形卡片元素。
 */
export function QuotaBox(props: {
  /** 剩余百分比（0–100）；`undefined` = 读不到或不适用。 */
  remaining?: number | undefined;
  /** 视觉档位（决定描边与数值颜色）。 */
  level: "ok" | "warn" | "error" | "unlimited" | "missing";
  /** 第一行：剩余额度的显示文本（如 `96%` / `不限` / `—`）。 */
  valueText: string;
  /** 第二行：下次重置时间（已格式化）。 */
  resetText: string;
  /** 重置时间的数据属性值（`resetAt` 或 `unknown`）。 */
  resetAt: string;
  /** 读屏用的完整说明（如「剩余 96%」）。 */
  ariaLabel: string;
  /** 数据属性值：窗口键。 */
  trackKey: string;
}): ReactElement {
  const clamped =
    props.remaining === undefined ? undefined : Math.max(0, Math.min(100, props.remaining));
  /** 底框：始终画满，作为「总量」的参照。 */
  const track = createElement("rect", {
    x: BORDER_WIDTH / 2,
    y: BORDER_WIDTH / 2,
    width: BOX_WIDTH - BORDER_WIDTH,
    height: BOX_HEIGHT - BORDER_WIDTH,
    rx: RADIUS,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: BORDER_WIDTH,
    opacity: 0.18,
  });
  /** 剩余比例那段边框：`rotate(-90)` 让 0% 从 12 点开始顺时针走。 */
  const progress =
    clamped === undefined
      ? null
      : createElement("rect", {
          x: BORDER_WIDTH / 2,
          y: BORDER_WIDTH / 2,
          width: BOX_WIDTH - BORDER_WIDTH,
          height: BOX_HEIGHT - BORDER_WIDTH,
          rx: RADIUS,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: BORDER_WIDTH,
          strokeLinecap: "round",
          strokeDasharray: BOX_PERIMETER,
          strokeDashoffset: BOX_PERIMETER * (1 - clamped / 100),
          transform: `rotate(-90 ${BOX_WIDTH / 2} ${BOX_HEIGHT / 2})`,
        });
  return createElement(
    "div",
    {
      "data-sidebar-box": props.trackKey,
      "data-sidebar-box-level": props.level,
      // `data-sidebar-track` 保留：既有样式与测试用它定位「承载额度读数的那个盒子」。
      "data-sidebar-track": props.trackKey,
      "aria-label": props.ariaLabel,
      role: "img",
      className: CSS_CLASS.sidebarBox,
    },
    createElement(
      "svg",
      {
        className: CSS_CLASS.sidebarBoxFrame,
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
        viewBox: `0 0 ${BOX_WIDTH} ${BOX_HEIGHT}`,
        xmlns: "http://www.w3.org/2000/svg",
        "aria-hidden": "true",
        focusable: "false",
      },
      track,
      progress,
    ),
    createElement("span", { className: CSS_CLASS.sidebarBoxValue }, props.valueText),
    createElement(
      "span",
      { "data-sidebar-reset": props.resetAt, className: CSS_CLASS.sidebarBoxReset },
      props.resetText,
    ),
  );
}
