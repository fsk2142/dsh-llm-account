/**
 * 侧边栏的**额度圆环**（2026-11-03 需求）：环内显示剩余百分比，环下是档位名与重置时间。
 *
 * > 如果做成两个圆环，内部显示剩余的百分比怎么样，圆环下边是下次的重置时间
 *
 * ## 为什么用 SVG 而不是 conic-gradient
 *
 * `conic-gradient` 画环需要在环心再盖一个与**卡片背景同色**的圆来挖空 —— 而侧边栏的
 * 背景随主题/层级变化（`--dsw-alias-*`），盖错色就会露出一个突兀的色块。SVG 用
 * 描边画环，环心天然是透明的，不依赖任何背景色。
 *
 * ## 圆的几何
 *
 * 半径 `R`、描边 `STROKE` 都在 40×40 的坐标系里。周长 `C = 2πR`；`stroke-dasharray = C`
 * 且 `stroke-dashoffset = C × (1 − 剩余比例)` 时，描出的那段弧**正好是剩余比例**，
 * 且从 12 点方向顺时针走（`rotate(-90)`）。
 *
 * @module dsh-llm-account/src/client/quota-ring
 */
import { createElement, type ReactElement } from "react";
import { CSS_CLASS } from "./css";

/** 视图坐标系（正方形）。 */
const SIZE = 40;
/** 半径：留出描边宽度，环不贴边裁切。 */
const RADIUS = 16;
/** 描边宽度（视觉上约 3px）。 */
const STROKE = 4;
/** 周长：`stroke-dasharray` 的基数。 */
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 一个额度圆环。
 *
 * `remaining` 为 `undefined` 时**不描弧**（只有底环）：缺失不等于 0%，不能画成「用光了」。
 * @param props - 剩余百分比与档位色。
 * @returns 圆环元素。
 */
export function QuotaRing(props: {
  /** 剩余百分比（0–100）；`undefined` = 读不到。 */
  remaining?: number | undefined;
  /** 视觉档位（决定弧的颜色）。 */
  level: "ok" | "warn" | "error" | "unlimited" | "missing";
  /** 环内的可见文本（如 `96%`）。 */
  text: string;
  /** 读屏用的完整说明（如「剩余 96%」）。 */
  ariaLabel: string;
  /** 数据属性：`data-sidebar-track` 的值（沿用旧的窗口键，样式与测试都靠它定位）。 */
  trackKey: string;
}): ReactElement {
  const clamped = props.remaining === undefined ? undefined : Math.max(0, Math.min(100, props.remaining));
  const arc =
    clamped === undefined
      ? null
      : createElement("circle", {
          // 弧长按剩余比例缩短；从 12 点顺时针。
          cx: SIZE / 2,
          cy: SIZE / 2,
          r: RADIUS,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: STROKE,
          strokeLinecap: "round",
          strokeDasharray: CIRCUMFERENCE,
          strokeDashoffset: CIRCUMFERENCE * (1 - clamped / 100),
        });
  return createElement(
    "span",
    {
      "data-sidebar-track": props.trackKey,
      "data-sidebar-ring-level": props.level,
      "aria-label": props.ariaLabel,
      role: "img",
      className: CSS_CLASS.sidebarRing,
    },
    createElement(
      "svg",
      {
        width: 40,
        height: 40,
        viewBox: `0 0 ${SIZE} ${SIZE}`,
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-hidden": "true",
        focusable: "false",
      },
      // 底环：始终画满，作为「总量」的参照。
      createElement("circle", {
        cx: SIZE / 2,
        cy: SIZE / 2,
        r: RADIUS,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: STROKE,
        opacity: 0.18,
      }),
      // 剩余弧：`rotate(-90)` 让 0% 从 12 点开始。
      arc === null
        ? null
        : createElement(
            "g",
            { transform: `rotate(-90 ${SIZE / 2} ${SIZE / 2})`, className: CSS_CLASS.sidebarRingArc },
            arc,
          ),
    ),
    createElement("span", { className: CSS_CLASS.sidebarRingValue }, props.text),
  );
}
