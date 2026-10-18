/**
 * 合并账户面板：两家账号**平铺**在同一张卡片里，账号名后跟供应商标签。
 *
 * 为什么平铺（2026-10-18 用户要求）：账号是「这台机器上有哪些额度」，按厂商分组会让同一个
 * 列表出现两个标题、两个添加入口；用户想直接看到所有账号，再决定用哪家的。
 *
 * 添加/网页登录是**全局入口**：先选供应商（Command Code / OpenCode），再选手动或网页登录；
 * 账户动作仍按厂商路由（`onOpenAction(vendor, …)` 等），面板自己不持有状态。
 * @module dsh-llm-account/src/client/accounts-panel
 */
import { createElement, type ReactElement } from "react";

import { accountAddSection, accountRows, type AccountCardProps, type LoginView } from "./account-card";
import { CSS_CLASS } from "./css";
import type { AccountAction } from "./page-state";
import type { VendorEntry } from "./registry";
import type { VendorUsageStatus } from "./usage-contract";

/** 面板里的一个厂商。 */
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
  const total = vendors.reduce(
    (count, group) =>
      count + (group.status?.accounts ?? []).filter((account) => typeof account === "object" && account !== null).length,
    0,
  );
  const addVendor = vendors.find((group) => group.action?.kind === "add");
  const addProps = addVendor === undefined ? undefined : accountPropsFor(props, addVendor);

  return createElement(
    "section",
    { "data-card": "accounts-panel", className: CSS_CLASS.card },
    createElement("h2", null, t("group.accounts")),
    createElement(
      "details",
      { "data-add-chooser": "true", className: CSS_CLASS.addChooser },
      createElement("summary", { className: CSS_CLASS.addSummary }, t("account.addAccount")),
      createElement("small", { className: CSS_CLASS.note }, t("account.addAccount.hint")),
      createElement(
        "div",
        { "data-account-add-actions": "true", className: CSS_CLASS.actions },
        ...vendors.flatMap((group) => [
          createElement(
            "button",
            {
              key: `${group.entry.providerId}-add`,
              type: "button",
              "data-action": group.entry.providerId === "commandcode" ? "add" : `add-${group.entry.providerId}`,
              className: CSS_CLASS.buttonSecondary,
              onClick: () => props.onOpenAction(group.entry.providerId, { kind: "add" }),
            },
            t("account.addFor").replace("{vendor}", t(group.entry.labelKey)),
          ),
          createElement(
            "button",
            {
              key: `${group.entry.providerId}-login`,
              type: "button",
              "data-action": group.entry.providerId === "commandcode" ? "login" : `login-${group.entry.providerId}`,
              className: CSS_CLASS.buttonSecondary,
              onClick: () => props.onLoginBegin(group.entry.providerId),
            },
            t("account.loginFor").replace("{vendor}", t(group.entry.labelKey)),
          ),
        ]),
      ),
    ),
    ...waitingLogins(props),
    // 某一家读不到状态时把原因放在它自己的小标题下，不要和「没有账号」混在一起。
    ...vendors.flatMap((group) =>
      group.status !== undefined
        ? []
        : [
            createElement(
              "p",
              { key: `${group.entry.providerId}-unavailable`, "data-accounts-vendor": group.entry.providerId, className: CSS_CLASS.note },
              `${t(group.entry.labelKey)}: ${t("account.unavailable")}`,
            ),
            ...(group.problem === undefined
              ? []
              : [
                  createElement(
                    "pre",
                    { key: `${group.entry.providerId}-problem`, "data-usage-problem": true, className: CSS_CLASS.diagnostic },
                    group.problem,
                  ),
                ]),
          ],
    ),
    ...(total === 0
      ? [createElement("p", { key: "empty", "data-accounts-empty": "true", className: CSS_CLASS.note }, t("account.empty"))]
      : []),
    createElement(
      "div",
      { "data-account-list": "true" },
      ...vendors.flatMap((group) => accountRows(accountPropsFor(props, group))),
    ),
    addProps === undefined
      ? null
      : createElement(
          "div",
          { key: "add-form", "data-add-panel": addVendor!.entry.providerId, className: CSS_CLASS.inset },
          accountAddSection(addProps),
        ),
  );
}

/** 某一家等待授权的登录面板（设备码 / 授权网址）。 */
function waitingLogins(props: AccountsPanelProps): ReactElement[] {
  return props.vendors.flatMap((group) => {
    const login = group.login;
    if (login?.state !== "waiting") return [];
    return [
      createElement(
        "div",
        { key: `login-${group.entry.providerId}`, "data-login-panel": group.entry.providerId, className: CSS_CLASS.inset },
        createElement("p", null, `${props.t(group.entry.labelKey)} · ${props.t("account.loginWaiting")}`),
        ...(login.userCode === undefined
          ? []
          : [
              createElement(
                "p",
                { key: "code", "data-login-code": login.userCode, className: CSS_CLASS.mono },
                props.t("account.loginCode").replace("{code}", login.userCode),
              ),
            ]),
        ...(login.authUrl === undefined
          ? []
          : [
              createElement(
                "a",
                { key: "url", "data-login-url": true, href: login.authUrl, target: "_blank", rel: "noreferrer", className: CSS_CLASS.link },
                login.authUrl,
              ),
            ]),
      ),
    ];
  });
}

/** 把面板回调包装成该厂商的 AccountCardProps。 */
function accountPropsFor(props: AccountsPanelProps, group: AccountsPanelVendor): AccountCardProps {
  const vendor = group.entry.providerId;
  return {
    t: props.t,
    status: group.status,
    problem: group.problem,
    action: group.action,
    expandedRef: group.expandedRef,
    login: group.login,
    vendorLabel: props.t(group.entry.labelKey),
    onOpenAction: (action) => props.onOpenAction(vendor, action),
    onActionField: props.onActionField,
    onConfirmAction: () => props.onConfirmAction(vendor),
    onCancelAction: props.onCancelAction,
    onSelect: (ref) => props.onSelect(vendor, ref),
    onRemove: (ref) => props.onRemove(vendor, ref),
    onToggleExpand: (ref) => props.onToggleExpand(vendor, ref),
    onLoginBegin: () => props.onLoginBegin(vendor),
  };
}
