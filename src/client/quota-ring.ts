/**
 * 单个额度窗口的圆环仪表盘：中心显示**剩余**百分比，环从顶部顺时针画剩余比例。
 *
 * 颜色语义：剩余 ≥50% 绿、≥20% 黄、其余红；无读数时只画灰色轨道和「—」，不补 0。
 * 纯 props → 元素树，三张卡片共用。
 * @module dsh-llm-account/src/client/quota-ring
 */
import { createElement, type ReactElement } from "react";

import { CSS_CLASS } from "./css";
import { quotaMeter, quotaWindowLabel, quotaWindowText } from "./quota";
import type { QuotaWindow } from "./usage-contract";

/** 圆环属性。 */
export interface QuotaRingProps {
  t: (key: string) => string;
  window: QuotaWindow;
}

/**
 * 额度圆环。
 * @param props - 见 {@link QuotaRingProps}。
 * @returns 元素树。
 */
export function QuotaRing(props: QuotaRingProps): ReactElement {
  const { t, window } = props;
  const meter = quotaMeter(window);
  const remaining = meter === undefined ? undefined : Math.max(0, Math.min(100, 100 - meter.percent));
  // 剩余额度用绿色；只有真正为 0 才转红。圆环之间留一个底部缺口，避免看起来像实心圆盘。
  const level = remaining === undefined ? "missing" : remaining > 0 ? "ok" : "error";
  const arc = remaining === undefined ? 0 : (remaining / 100) * 75;
  return createElement(
    "div",
    {
      "data-quota-ring": window.key,
      "data-quota-ring-level": level,
      ...(remaining === undefined ? {} : { "data-quota-ring-remaining": remaining }),
      className: CSS_CLASS.ring,
    },
    createElement(
      "div",
      { className: CSS_CLASS.ringChart },
      createElement(
        "svg",
        { viewBox: "0 0 44 44", className: CSS_CLASS.ringSvg, "aria-hidden": "true" },
        createElement("circle", {
          cx: 22,
          cy: 22,
          r: 18,
          pathLength: 100,
          className: CSS_CLASS.ringTrack,
          strokeDasharray: "75 25",
          transform: "rotate(135 22 22)",
        }),
        remaining === undefined
          ? null
          : createElement("circle", {
              cx: 22,
              cy: 22,
              r: 18,
              pathLength: 100,
              className: CSS_CLASS.ringFill,
              "data-level": level,
              strokeDasharray: `${arc} 100`,
              transform: "rotate(135 22 22)",
            }),
      ),
      createElement(
        "span",
        { "data-quota-ring-text": remaining === undefined ? "missing" : String(remaining), className: CSS_CLASS.ringPercent },
        remaining === undefined ? "—" : `${remaining}%`,
      ),
    ),
    createElement("span", { className: CSS_CLASS.ringLabel }, quotaWindowLabel(t, window.key)),
    createElement("span", { className: CSS_CLASS.ringNote }, quotaWindowText(t, window)),
  );
}
