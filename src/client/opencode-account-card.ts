/**
 * OpenCode 账户卡片：共享账户卡片 + 排序控件。
 *
 * 为什么单独一张卡片而不是直接渲染共享卡片：排序控件的 `reorder` 只在这一家的能力矩阵里
 * 历史存在（Command Code 现在也支持，控件已并入共享卡片）；保留这个包装层是为了不把
 * OpenCode 的调用点散到页面注册里。
 *
 * `autoSwitch` 已改为「切换策略」卡片里的普通设置字段（底部保存条生效），不再挂在账户卡
 * 底部 —— 同一件事有两个开关只会让人不知道哪个算数。
 *
 * 与其它卡片一样：纯 props → 元素树，没有 Hook、没有内部状态（Ruling 22/29）。
 * @module dsh-llm-account/src/client/opencode-account-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { AccountCard, type AccountCardProps } from "./account-card";
import { CSS_CLASS } from "./css";

/** 卡片属性：共享卡片的一切，但没有厂商专属插槽。 */
export type OpenCodeAccountCardProps = Omit<AccountCardProps, "rowExtras" | "cardFooter"> & {
  /**
   * 旧调用点仍可传 `settings` + `onSetAutoSwitch`：只有两者都在时才渲染底部开关
   * （页面已改为「切换策略」卡片里的普通字段，生产路径不再传）。
   * @deprecated 用设置字段 `autoSwitch`。
   */
  settings?: Record<string, unknown>;
  /** @deprecated 用设置字段 `autoSwitch`。 */
  onSetAutoSwitch?: (value: boolean) => void;
};

/**
 * OpenCode 账户卡片。
 * @param props - 见 {@link OpenCodeAccountCardProps}。
 * @returns 元素树。
 */
export function OpenCodeAccountCard(props: OpenCodeAccountCardProps): ReactElement {
  // 共享卡片**直接调用**（而不是 `createElement(AccountCard, …)`）：返回的元素树因此是完整展开的，
  // 上层的窗口/字段断言与 1c 的渲染都不需要再套一层未展开的组件元素。
  return AccountCard({
    ...props,
    ...(props.settings === undefined || props.onSetAutoSwitch === undefined ? {} : { cardFooter: autoSwitchRow(props) }),
  });
}

/**
 * 兼容旧调用点的底部 `autoSwitch` 开关；生产路径已改走「切换策略」字段。
 * @deprecated 用设置字段 `autoSwitch`。
 */
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
      checked: props.settings?.autoSwitch === true,
      onChange: (event: { target?: { checked?: boolean } }) => props.onSetAutoSwitch?.(event.target?.checked === true),
    }),
  );
}
