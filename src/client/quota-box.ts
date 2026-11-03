/**
 * 侧边栏的**额度矩形卡片**（2026-11-03 需求）。
 *
 * > 如果改成两个圆角矩形，圆角矩形上方是额度信息，内部是剩余额度信息和下次重置时间
 * > 对，但是 5 小时还有每周要和圆角矩形的中心对齐
 *
 * ## 版式
 *
 * ```
 *    5 小时                 ← 档位名（居中于矩形）
 *  ╭──────────────╮
 *  │      96%     │        ← 剩余额度
 *  │  10-19 20:00 │        ← 下次重置时间
 *  ╰──────────────╯
 * ```
 *
 * ## 与上一版（圆环）的取舍
 *
 * 圆环用**弧长**表达比例，矩形没有弧 —— 比例只剩「数字 + 档位色」两个信号。
 * 这是用户明确选定的：矩形里能放两行文字，数值与重置时间都清楚，比 32px 的环宽松。
 *
 * @module dsh-llm-account/src/client/quota-box
 */
import { createElement, type ReactElement } from "react";

import { CSS_CLASS } from "./css";

/**
 * 一个额度矩形卡片。
 *
 * 环内文本三种情形分开说、**不互相冒充**：「不限」是端点给的事实；读不到写占位符，
 * 绝不猜成 0%（缺失与用光是两回事）。
 * @param props - 剩余额度、档位、两行文本与读屏说明。
 * @returns 矩形卡片元素。
 */
export function QuotaBox(props: {
  /** 视觉档位（决定边框与数值颜色）。 */
  level: "ok" | "warn" | "error" | "unlimited" | "missing";
  /** 第一行：剩余额度的显示文本（如 `96%` / `∞` / `—`）。 */
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
  return createElement(
    "div",
    {
      "data-sidebar-box": props.trackKey,
      "data-sidebar-box-level": props.level,
      // `data-sidebar-track` 保留：既有样式与测试用它定位「承载额度读数的那个盒子」，
      // 从圆环换成矩形后语义不变。
      "data-sidebar-track": props.trackKey,
      "aria-label": props.ariaLabel,
      role: "img",
      className: CSS_CLASS.sidebarBox,
    },
    createElement("span", { className: CSS_CLASS.sidebarBoxValue }, props.valueText),
    createElement(
      "span",
      { "data-sidebar-reset": props.resetAt, className: CSS_CLASS.sidebarBoxReset },
      props.resetText,
    ),
  );
}
