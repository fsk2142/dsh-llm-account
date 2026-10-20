/**
 * 全局切换面板：策略、评估间隔、回合末、自动切换，以及全局账户顺序放在同一张卡片里。
 *
 * 为什么合并（2026-10-18 用户要求）：切换策略和「先试哪个账号」是同一件事的两个面；分成
 * 两家标签页各一份，用户看到的顺序和策略就不是同一套。这里只有一份，写入两家文档。
 *
 * 纯 props → 元素树；输入变化由容器立即写回，`now` 由容器每秒推进。
 * @module dsh-llm-account/src/client/switch-panel
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import type { SwitchRuntimeState, SwitchSettingsWrite } from "../core/switching/settings";
import { CSS_CLASS } from "./css";
import { durationPartsOf, minutesOfDurationParts } from "./duration";
import { ChevronIcon } from "./icons";
import { countdownText } from "./switch-card";

/** 顺序列表的一行。 */
export interface SwitchOrderItem {
  key: string;
  label: string;
  vendorLabel: string;
  /** 动作路由用。 */
  vendor: string;
  ref: string;
  /** 是否是当前使用的账号。 */
  current?: boolean;
}

/** 全局切换面板属性。 */
export interface SwitchPanelProps {
  t: (key: string) => string;
  state?: SwitchRuntimeState;
  now: number;
  order: readonly SwitchOrderItem[];
  onChange: (patch: Partial<SwitchSettingsWrite>) => void;
  onReorder: (order: readonly string[]) => void;
  onSwitchNow: () => void;
  /** 直接切到某个账号（自动切换关闭时也能手动选）。 */
  onSelect: (vendor: string, ref: string) => void;
}

/** 默认值（宿主还没有发布 switchState 时）。 */
const DEFAULTS: SwitchSettingsWrite = {
  strategy: "best-quota",
  intervalMinutes: 60,
  atTurnEnd: true,
  autoSwitch: true,
};

/**
 * 全局切换面板。
 * @param props - 见 {@link SwitchPanelProps}。
 * @returns 元素树。
 */
export function SwitchPanel(props: SwitchPanelProps): ReactElement {
  const { t } = props;
  const state = props.state;
  const settings: SwitchSettingsWrite = {
    strategy: state?.strategy ?? DEFAULTS.strategy,
    intervalMinutes: state?.intervalMinutes ?? DEFAULTS.intervalMinutes,
    atTurnEnd: state?.atTurnEnd ?? DEFAULTS.atTurnEnd,
    autoSwitch: state?.autoSwitch ?? DEFAULTS.autoSwitch,
  };
  const parts = durationPartsOf(settings.intervalMinutes);
  const changePart = (part: "days" | "hours" | "minutes", raw: string): void => {
    props.onChange({ intervalMinutes: minutesOfDurationParts({ ...parts, [part]: Number(raw) }) });
  };
  const countdown = state === undefined ? t("switch.unknown") : countdownText(t, state, props.now);
  const current = props.order.find((item) => item.current === true);

  return createElement(
    "section",
    { "data-card": "switch-panel", className: CSS_CLASS.card },
    createElement("h2", null, t("switch.panelTitle")),
    createElement(
      "small",
      { "data-switch-current": current?.key ?? "none", className: CSS_CLASS.note },
      current === undefined
        ? t("switch.noCurrent")
        : t("switch.current").replace("{account}", `${current.label} · ${current.vendorLabel}`),
    ),
    createElement(
      "div",
      { "data-switch-strategy-field": "true", className: CSS_CLASS.field },
      createElement("span", { className: CSS_CLASS.fieldText }, createElement("span", null, t("field.switchStrategy")), createElement("small", null, t("field.switchStrategy.hint"))),
      createElement(
        "select",
        {
          "data-switch-strategy": "true",
          value: settings.strategy,
          onChange: (event: { target?: { value?: string } }) => {
            const next = event.target?.value;
            props.onChange({ strategy: next === "best-quota" ? "best-quota" : next === "scheduled" ? "scheduled" : "order" });
          },
        },
        createElement("option", { value: "order" }, t("options.switchOrder")),
        createElement("option", { value: "best-quota" }, t("options.switchBestQuota")),
        createElement("option", { value: "scheduled" }, t("options.switchScheduled")),
      ),
    ),
    ...toggleRow("autoSwitch", t("field.autoSwitch"), t("field.autoSwitch.hint"), settings.autoSwitch, (value) =>
      props.onChange({ autoSwitch: value }),
    ),
    ...(settings.strategy === "order"
      ? []
      : [
          createElement(
            "div",
            { key: "interval", "data-switch-interval-field": "true", className: CSS_CLASS.field },
            createElement(
              "span",
              { className: CSS_CLASS.fieldText },
              createElement("span", null, t(settings.strategy === "scheduled" ? "field.scheduledIntervalMinutes" : "field.switchIntervalMinutes")),
              createElement("small", null, t(settings.strategy === "scheduled" ? "field.scheduledIntervalMinutes.hint" : "field.switchIntervalMinutes.hint")),
            ),
            createElement(
              "div",
              { className: CSS_CLASS.duration, "data-switch-interval": "true" },
              ...([
                ["days", 30],
                ["hours", 24],
                ["minutes", 60],
              ] as const).map(([part, max]) =>
                createElement(
                  "span",
                  { key: part, className: CSS_CLASS.durationPart },
                  createElement("input", {
                    type: "number",
                    min: 0,
                    max,
                    value: String(parts[part]),
                    "data-switch-duration-part": part,
                    onChange: (event: { target?: { value?: string } }) => changePart(part, event.target?.value ?? ""),
                  }),
                  createElement("span", null, t(`duration.${part}`)),
                ),
              ),
            ),
          ),
          ...toggleRow("switchAtTurnEnd", t("field.switchAtTurnEnd"), t("field.switchAtTurnEnd.hint"), settings.atTurnEnd, (value) =>
            props.onChange({ atTurnEnd: value }),
          ),
        ]),
    createElement(
      "div",
      { className: CSS_CLASS.cardFooter, "data-switch-countdown": "true" },
      createElement("span", { className: CSS_CLASS.fieldText }, createElement("span", null, countdown)),
      createElement(
        "button",
        {
          type: "button",
          "data-switch-now": "true",
          className: CSS_CLASS.buttonSecondary,
          onClick: () => props.onSwitchNow(),
        },
        t("switch.now"),
      ),
    ),
    orderSection(props),
  );
}

/** 一个布尔设置行。 */
function toggleRow(
  key: string,
  label: string,
  hint: string,
  value: boolean,
  onChange: (value: boolean) => void,
): ReactNode[] {
  return [
    createElement(
      "div",
      { key, "data-switch-field": key, className: CSS_CLASS.field },
      createElement("span", { className: CSS_CLASS.fieldText }, createElement("span", null, label), createElement("small", null, hint)),
      createElement("input", {
        type: "checkbox",
        className: CSS_CLASS.toggle,
        "data-switch-toggle": key,
        checked: value,
        onChange: (event: { target?: { checked?: boolean } }) => onChange(event.target?.checked === true),
      }),
    ),
  ];
}

/** 全局顺序：交叉列出两家账号，上移/下移提交完整顺序。 */
function orderSection(props: SwitchPanelProps): ReactNode {
  const items = props.order;
  const adjustable = (props.state?.strategy ?? "best-quota") !== "best-quota";
  return createElement(
    "details",
    { "data-switch-order": "true", className: CSS_CLASS.inset, open: true },
    createElement("summary", { className: CSS_CLASS.orderSummary }, createElement(ChevronIcon, null), props.t("account.orderTitle")),
    createElement("small", { className: CSS_CLASS.note }, props.t("account.orderHint")),
    ...items.map((item, index) =>
      createElement(
        "div",
        { key: item.key, "data-order-item": item.key, className: CSS_CLASS.field },
        createElement(
          "span",
          { className: CSS_CLASS.fieldText },
          createElement(
            "span",
            { className: CSS_CLASS.nameRow },
            createElement("span", null, item.label),
            createElement("small", { className: CSS_CLASS.vendorBadge }, item.vendorLabel),
            item.current === true
              ? createElement(
                  "small",
                  { "data-order-current": item.key, className: CSS_CLASS.newBadge },
                  props.t("account.current"),
                )
              : null,
          ),
        ),
        ...(adjustable
          ? [
              createElement(
                "button",
                {
                  type: "button",
                  key: "use",
                  "data-order-select": item.key,
                  className: CSS_CLASS.buttonGhost,
                  onClick: () => props.onSelect(item.vendor, item.ref),
                },
                props.t("account.use"),
              ),
              createElement(
                "button",
                {
                  type: "button",
                  key: "up",
                  "data-order-up": item.key,
                  className: CSS_CLASS.buttonGhost,
                  disabled: index === 0,
                  onClick: () => props.onReorder(swapped(items, index, -1)),
                },
                "↑",
              ),
              createElement(
                "button",
                {
                  type: "button",
                  key: "down",
                  "data-order-down": item.key,
                  className: CSS_CLASS.buttonGhost,
                  disabled: index === items.length - 1,
                  onClick: () => props.onReorder(swapped(items, index, 1)),
                },
                "↓",
              ),
            ]
          : []),
      ),
    ),
  );
}

/** 交换两个下标，返回 keys。 */
function swapped(items: readonly SwitchOrderItem[], index: number, delta: number): string[] {
  const next = items.map((item) => item.key);
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
