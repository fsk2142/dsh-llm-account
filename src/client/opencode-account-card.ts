/**
 * OpenCode 账户卡片：共享账户卡片 + 排序控件 + `autoSwitch` 开关。
 *
 * 为什么单独一张卡片而不是给共享卡片加开关：`reorder` 只在这一家的能力矩阵里存在（Command
 * Code 的账号顺序由配置决定，设计 §7.3）；`autoSwitch` 两家都已实现并落库（设计 §6.4.5，
 * Command Code 的开关见 `src/vendors/commandcode/accounts.ts`），但 1b 只给 OpenCode
 * 渲染这个开关控件（Command Code 的开关目前经远程面调）。把它们留在这里，共享卡片就仍然
 * 是厂商无关的。
 *
 * **排序交互的实现取舍**（Ruling 31）：计划写的是「拖动排序」，但本期的测试环境没有 DOM
 * （Ruling 22：没有 jsdom，组件按「纯 props → 元素树」测），真正的拖动需要 pointer 事件与
 * 布局测量，在这里既写不出可信的实现也测不了。所以用**上移/下移**表达同一个操作
 * （`moveAccount(ref, toIndex)`），越界的按钮禁用。1c 若确认要拖动，只需在同一个 `onMove`
 * 回调前面加一层手势，语义与参数都不变。
 *
 * 与其它卡片一样：纯 props → 元素树，没有 Hook、没有内部状态（Ruling 22/29）。
 * @module dsh-llm-account/src/client/opencode-account-card
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { AccountCard, moveItems, type AccountCardProps } from "./account-card";
import { CSS_CLASS } from "./css";
import type { AccountUsageStatus } from "./usage-contract";

/** 卡片属性：共享卡片的一切，加上设置快照与两个 OpenCode 专属回调。 */
export interface OpenCodeAccountCardProps extends Omit<AccountCardProps, "rowExtras" | "cardFooter"> {
  /** 该厂商设置文档的当前值（`autoSwitch` 的当前值来源）。 */
  settings: Record<string, unknown>;
  /**
   * 调整顺序：目标账号与**移动后的最终下标**。
   * @param ref - 目标账号。
   * @param toIndex - 最终下标（越界由宿主侧的 `reorder` 夹到两端）。
   */
  onMove: (ref: string, toIndex: number) => void;
  /** 写自动切换开关（立即生效，不等保存条）。 */
  onSetAutoSwitch: (value: boolean) => void;
}

/**
 * OpenCode 账户卡片。
 * @param props - 见 {@link OpenCodeAccountCardProps}。
 * @returns 元素树。
 */
export function OpenCodeAccountCard(props: OpenCodeAccountCardProps): ReactElement {
  const accounts = (props.status?.accounts ?? []).filter(
    (account): account is AccountUsageStatus => typeof account === "object" && account !== null,
  );
  // 共享卡片**直接调用**（而不是 `createElement(AccountCard, …)`）：返回的元素树因此是完整展开的，
  // 上层的窗口/字段断言与 1c 的渲染都不需要再套一层未展开的组件元素。
  const rows = AccountCard({
    ...props,
    rowExtras: (account, index) => moveControl(props, accounts, account, index),
    cardFooter: autoSwitchRow(props),
  });
  return createElement(Fragment, null, rows);
}

/** `autoSwitch` 开关：读设置文档，拨动即写。 */
function autoSwitchRow(props: OpenCodeAccountCardProps): ReactNode {
  const { t } = props;
  return createElement(
    "div",
    { "data-card": "auto-switch", className: CSS_CLASS.cardFooter },
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement("span", null, t("account.autoSwitch")),
      createElement("small", null, t("account.autoSwitch.hint")),
    ),
    createElement("input", {
      "data-auto-switch": "true",
      type: "checkbox",
      className: CSS_CLASS.toggle,
      // 设置文档里没有这个字段就是关闭（声明默认值），不编造 true。
      checked: props.settings.autoSwitch === true,
      onChange: (event: { target?: { checked?: boolean } }) => props.onSetAutoSwitch(event.target?.checked === true),
    }),
  );
}

/**
 * 一行账号的排序控件（菜单项形态，挂在 `⋯` 菜单末尾）。
 *
 * 不声明 `reorder` 能力的厂商**整块不渲染**（不是禁用）——页面上不该出现一个永远点不动的控件。
 */
function moveControl(
  props: OpenCodeAccountCardProps,
  accounts: readonly AccountUsageStatus[],
  account: AccountUsageStatus,
  index: number,
): ReactNode {
  if (props.status?.capabilities.reorder !== true) return null;
  return moveItems(props, account, index, accounts.length);
}
