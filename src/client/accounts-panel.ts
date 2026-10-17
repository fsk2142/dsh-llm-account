/**
 * 合并账户面板：一张常驻卡片里同时列出两家厂商的账户。
 *
 * 为什么合并（设计 §7.2）：账户属于「这台机器上我有哪些额度」，不属于「我正在看哪家的设置」；
 * 切成 OpenCode 标签页才能看到 OpenCode 账户，等于把同一个问题拆成两页。设置字段与模型仍然
 * 按厂商分标签页，账户面板固定在标签页上方。
 *
 * 纯 props → 元素树：动作按厂商路由（`onOpenAction(vendor, …)` 等），面板自己不持有状态；
 * 每家的内容复用 `account-card.ts` 的 `accountCardBody`，行渲染只有一份实现。
 * @module dsh-llm-account/src/client/accounts-panel
 */
import { createElement, type ReactElement } from "react";

import { accountCardBody, type AccountCardProps, type LoginView } from "./account-card";
import { CSS_CLASS } from "./css";
import type { AccountAction } from "./page-state";
import type { VendorEntry } from "./registry";
import type { VendorUsageStatus } from "./usage-contract";

/** 面板里的一个厂商分组。 */
export interface AccountsPanelVendor {
  /** 厂商声明（取标签文案）。 */
  entry: VendorEntry;
  /** 该厂商的状态；远程面还没挂上时为 `undefined`。 */
  status?: VendorUsageStatus;
  /** 状态读不出来的原因。 */
  problem?: string;
  /** 属于这家的账户操作（面板已按厂商过滤）。 */
  action?: AccountAction;
  /** 属于这家的展开项（面板已按厂商过滤）。 */
  expandedRef?: string;
  /** 这家的网页登录状态。 */
  login?: LoginView;
}

/** 合并账户面板属性。 */
export interface AccountsPanelProps {
  t: (key: string) => string;
  vendors: readonly AccountsPanelVendor[];
  /** 打开一个账户操作；`vendor` 是动作要路由到的厂商。 */
  onOpenAction: (vendor: string, action: { kind: AccountAction["kind"]; ref?: string }) => void;
  onActionField: (field: "label" | "key", value: string) => void;
  /** 提交当前操作（动作里已带厂商）。 */
  onConfirmAction: (vendor: string) => void;
  onCancelAction: () => void;
  onSelect: (vendor: string, ref: string | null) => void;
  onRemove: (vendor: string, ref: string) => void;
  onMove?: (vendor: string, ref: string, toIndex: number) => void;
  onToggleExpand: (vendor: string, ref: string) => void;
  onLoginBegin: (vendor: string) => void;
}

/**
 * 合并账户面板。
 * @param props - 见 {@link AccountsPanelProps}。
 * @returns 元素树。
 */
export function AccountsPanel(props: AccountsPanelProps): ReactElement {
  const { t, vendors } = props;
  return createElement(
    "section",
    { "data-card": "accounts-panel", className: CSS_CLASS.card },
    createElement("h2", null, t("group.accounts")),
    ...vendors.map((group) => vendorGroup(props, group)),
  );
}

/** 一家厂商的分组：标题 + 共享的账户行内容。 */
function vendorGroup(props: AccountsPanelProps, group: AccountsPanelVendor): ReactElement {
  const vendor = group.entry.providerId;
  const entry = group.entry;
  const accountProps: AccountCardProps = {
    t: props.t,
    status: group.status,
    problem: group.problem,
    action: group.action,
    expandedRef: group.expandedRef,
    login: group.login,
    onOpenAction: (action) => props.onOpenAction(vendor, action),
    onActionField: props.onActionField,
    onConfirmAction: () => props.onConfirmAction(vendor),
    onCancelAction: props.onCancelAction,
    onSelect: (ref) => props.onSelect(vendor, ref),
    onRemove: (ref) => props.onRemove(vendor, ref),
    onToggleExpand: (ref) => props.onToggleExpand(vendor, ref),
    onLoginBegin: () => props.onLoginBegin(vendor),
    ...(props.onMove === undefined ? {} : { onMove: (ref: string, toIndex: number) => props.onMove?.(vendor, ref, toIndex) }),
  };
  return createElement(
    "div",
    { key: vendor, "data-accounts-vendor": vendor, className: CSS_CLASS.accountGroup },
    createElement("h3", null, props.t(entry.labelKey)),
    ...accountCardBody(accountProps),
  );
}
