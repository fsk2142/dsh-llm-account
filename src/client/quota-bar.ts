/**
 * 额度条形进度条：一行一个窗口，绿色部分表示**剩余**额度。
 *
 * 统一账户卡片、侧边栏与仪表盘：标题、剩余百分比、进度条、已用读数、重置时间。
 * 纯 props → 元素树，不做任何取数。
 * @module dsh-llm-account/src/client/quota-bar
 */
import { createElement, type ReactElement } from "react";

import { CSS_CLASS } from "./css";
import { quotaMeter, quotaResetText, quotaWindowLabel, quotaWindowText } from "./quota";
import type { QuotaWindow } from "./usage-contract";

/** 条形额度属性。 */
export interface QuotaBarProps {
  t: (key: string) => string;
  window: QuotaWindow;
}

/**
 * 一个额度窗口的条形进度。
 * @param props - 见 {@link QuotaBarProps}。
 * @returns 元素树。
 */
export function QuotaBar(props: QuotaBarProps): ReactElement {
  const { t, window } = props;
  // 「不限」是端点给的读数，不是缺数据：不画条、不写重置时间 —— 空条会被读成「用光了」，
  // 而「重置时间未提供」会把「不设上限」说成「缺数据」。一行「不限」就是它的全部内容。
  const unlimited = window.unlimited === true;
  const meter = quotaMeter(window);
  const remaining = meter === undefined ? undefined : Math.max(0, Math.min(100, 100 - meter.percent));
  // 剩余额度用绿色；只有真正为 0 才转红。
  const level = unlimited ? "unlimited" : remaining === undefined ? "missing" : remaining > 0 ? "ok" : "error";
  const reset = quotaResetText(t, window) ?? t("quota.resetUnknown");
  return createElement(
    "div",
    {
      "data-quota-bar": window.key,
      "data-quota-bar-level": level,
      ...(remaining === undefined ? {} : { "data-quota-bar-remaining": remaining }),
      className: CSS_CLASS.quotaBar,
    },
    createElement(
      "div",
      { className: CSS_CLASS.quotaBarHead },
      createElement("span", { className: CSS_CLASS.quotaBarLabel }, quotaWindowLabel(t, window.key)),
      createElement(
        "span",
        {
          "data-quota-bar-percent": unlimited ? "unlimited" : remaining === undefined ? "missing" : String(remaining),
          className: CSS_CLASS.quotaBarPercent,
        },
        unlimited ? t("quota.unlimited") : remaining === undefined ? "—" : t("quota.remaining").replace("{percent}", String(remaining)),
      ),
    ),
    unlimited
      ? null
      : createElement(
          "span",
          { className: CSS_CLASS.quotaBarTrack },
          meter === undefined
            ? null
            : createElement("span", {
                "data-quota-bar-fill": window.key,
                "data-level": level,
                className: CSS_CLASS.quotaBarFill,
                style: { width: `${remaining}%` },
              }),
        ),
    unlimited
      ? null
      : createElement(
          "div",
          { className: CSS_CLASS.quotaBarMeta },
          createElement("span", { "data-quota-bar-value": window.key }, quotaWindowText(t, window)),
          createElement(
            "span",
            { key: "reset", "data-quota-bar-reset": window.resetAt ?? "unknown", className: CSS_CLASS.quotaBarReset },
            reset,
          ),
        ),
  );
}
