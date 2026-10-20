/**
 * 切换倒计时卡片：显示下次额度评估，并允许立即执行一次切换。
 *
 * 纯 props → 元素树；`now` 由容器每秒推进（卡片自己没有定时器），因此倒计时可单测。
 * @module dsh-llm-account/src/client/switch-card
 */
import { createElement, type ReactElement } from "react";

import type { SwitchRuntimeState } from "../core/switching/settings";
import { CSS_CLASS } from "./css";
import { countdownPartsOf } from "./duration";

/** 倒计时卡片属性。 */
export interface SwitchCardProps {
  t: (key: string) => string;
  /** 宿主发布的切换运行态；老宿主缺省。 */
  state?: SwitchRuntimeState;
  /** 当前时刻（容器每秒推进）。 */
  now: number;
  /** 立即执行一次切换；缺省时按钮禁用。 */
  onSwitchNow?: () => void;
}

/**
 * 倒计时文案。
 * @param t - 取词函数。
 * @param state - 切换运行态。
 * @param now - 当前时刻。
 * @returns 一行可读的状态文案。
 */
export function countdownText(
  t: (key: string) => string,
  state: SwitchRuntimeState,
  now: number,
): string {
  if (state.pending !== undefined) {
    return t("switch.pending").replace("{target}", state.pending.target);
  }
  if (state.strategy === "scheduled") {
    if (state.intervalMinutes <= 0) return t("switch.noInterval");
    if (state.nextAt === undefined || state.nextAt <= now) return t("switch.switchDue");
    const parts = countdownPartsOf(state.nextAt - now);
    const chunks: string[] = [];
    if (parts.days > 0) chunks.push(`${parts.days} ${t("duration.days")}`);
    if (parts.hours > 0) chunks.push(`${parts.hours} ${t("duration.hours")}`);
    if (parts.minutes > 0 || chunks.length === 0) chunks.push(`${parts.minutes} ${t("duration.minutes")}`);
    return t("switch.nextSwitchIn").replace("{time}", chunks.join(" "));
  }
  if (state.strategy !== "best-quota") return t("switch.order");
  if (state.intervalMinutes <= 0) return t("switch.noInterval");
  if (state.nextAt === undefined || state.nextAt <= now) return t("switch.due");
  const parts = countdownPartsOf(state.nextAt - now);
  const chunks: string[] = [];
  if (parts.days > 0) chunks.push(`${parts.days} ${t("duration.days")}`);
  if (parts.hours > 0) chunks.push(`${parts.hours} ${t("duration.hours")}`);
  if (parts.minutes > 0 || chunks.length === 0) chunks.push(`${parts.minutes} ${t("duration.minutes")}`);
  return t("switch.nextIn").replace("{time}", chunks.join(" "));
}

/**
 * 切换倒计时卡片。
 * @param props - 见 {@link SwitchCardProps}。
 * @returns 元素树。
 */
export function SwitchCard(props: SwitchCardProps): ReactElement {
  const { t, state } = props;
  const text = state === undefined ? t("switch.unknown") : countdownText(t, state, props.now);
  return createElement(
    "section",
    { "data-card": "switch-status", className: CSS_CLASS.card },
    createElement("h2", null, t("switch.title")),
    createElement(
      "div",
      { className: CSS_CLASS.cardFooter },
      createElement("span", { className: CSS_CLASS.fieldText, "data-switch-countdown": "true" }, createElement("span", null, text)),
      createElement(
        "button",
        {
          type: "button",
          "data-switch-now": "true",
          className: CSS_CLASS.buttonSecondary,
          disabled: props.onSwitchNow === undefined,
          onClick: () => props.onSwitchNow?.(),
        },
        t("switch.now"),
      ),
    ),
  );
}
