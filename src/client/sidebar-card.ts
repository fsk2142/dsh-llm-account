/**
 * 侧边栏额度卡片（Task 8）—— 用户的第一诉求（规格 §8.1）。
 *
 * 要修掉的旧缺陷：旧卡片显示「配置里固定的那个账号」，而多账号轮换是每次请求临时决定的，
 * 用量打满被自动切走后卡片数字不变。所以本卡片显示的是**生效账号**（`status().effective`），
 * 并在它与固定账号不同时，在顶部给出「谁 → 谁、原因、时间」的切换提示，同时把两者都标注出来
 * （规格 §8.1 第 3、4 条）。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态，也不会在
 * 这里发起任何请求 —— 轮询由 `seams.ts` 的控制器按挂载/开关状态起停。
 * @module dsh-llm-account/src/client/sidebar-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import { quotaShape, quotaWindowText } from "./quota";
import type { AccountUsageStatus, VendorUsageStatus } from "./usage-contract";

/** 卡片属性。 */
export interface SidebarCardProps {
  t: (key: string) => string;
  /** 要显示的厂商状态；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /** 打开中栏仪表盘。 */
  onOpen: () => void;
}

/**
 * 侧边栏额度卡片。
 * @param props - 见 {@link SidebarCardProps}。
 * @returns 元素树。
 */
export function SidebarCard(props: SidebarCardProps): ReactElement {
  const { t, status } = props;
  const effective = status?.effective;
  const effectiveRow = effective === undefined ? undefined : status?.accounts.find((account) => account.ref === effective.ref);

  return createElement(
    "div",
    { "data-card": "sidebar-quota", className: CSS_CLASS.sidebar },
    ...(status === undefined || effective === undefined
      ? [
          // 还没有任何请求（或状态还没读到）：占位，**不显示 0%**。
          createElement("p", { key: "empty", "data-sidebar-empty": "true" }, t("sidebar.noRequest")),
        ]
      : [
          switchNotice(props),
          createElement("h3", { key: "title", "data-sidebar-title": "true" }, titleOf(props, effectiveRow)),
          ...effectiveQuota(props, effectiveRow),
        ]),
    createElement(
      "button",
      { key: "open", type: "button", "data-sidebar-open": "true", onClick: () => props.onOpen() },
      t("sidebar.open"),
    ),
  );
}

/** 卡片标题：有套餐名就带套餐，否则用生效账号的名字。 */
function titleOf(props: SidebarCardProps, row: AccountUsageStatus | undefined): string {
  const plan = row?.quota?.plan;
  const account = row === undefined ? (props.status?.effective?.ref ?? "") : row.label;
  if (plan === undefined) return account;
  return `${account} · ${plan}`;
}

/**
 * 顶部提示与「固定/当前」两个标注。
 *
 * 提示**只在两者不同**时出现（规格 §8.1 第 3 条）；相同就只标一个「当前」，不重复刷屏。
 */
function switchNotice(props: SidebarCardProps): ReactNode {
  const { t, status } = props;
  const effective = status?.effective;
  const pinned = status?.pinned ?? null;
  const differs = effective !== undefined && pinned !== null && pinned !== effective.ref;
  const marks: ReactNode[] = [];

  if (pinned !== null && (differs || effective === undefined)) {
    marks.push(createElement("span", { key: "pinned", "data-sidebar-pinned": pinned }, `${t("sidebar.pinned")}: ${pinned}`));
  }
  if (effective !== undefined) {
    marks.push(createElement("span", { key: "effective", "data-sidebar-effective": effective.ref }, `${t("sidebar.effective")}: ${effective.ref}`));
  }

  const notice = status?.switch;
  if (!differs || notice === undefined) {
    return createElement("div", { key: "marks", "data-sidebar-marks": "true" }, ...marks);
  }

  return createElement(
    "div",
    {
      key: "switch",
      "data-switch-notice": "true",
      className: CSS_CLASS.switchNotice,
      "data-switch-from": notice.fromRef,
      "data-switch-to": notice.toRef,
      "data-switch-reason": notice.reason,
    },
    createElement("span", { "data-switch-summary": "true" }, `${notice.fromRef} → ${notice.toRef}`),
    createElement("span", { "data-switch-reason-label": notice.reason }, t(`switch.reason.${notice.reason}`)),
    createElement(
      "time",
      { "data-switch-at": notice.at, dateTime: new Date(notice.at).toISOString() },
      new Date(notice.at).toISOString(),
    ),
    ...marks,
  );
}

/** 生效账号的额度条：每个窗口一行，缺失的窗口按「暂无数据」处理。 */
function effectiveQuota(props: SidebarCardProps, row: AccountUsageStatus | undefined): ReactNode[] {
  const { t } = props;
  const quota = row?.quota;
  if (quota === undefined) {
    return [createElement("p", { key: "noquota", "data-sidebar-quota-missing": "true", className: CSS_CLASS.quotaMissing }, t("account.quotaMissing"))];
  }
  return quota.windows.map((window) =>
    createElement(
      "div",
      { key: window.key, "data-sidebar-window": window.key, "data-sidebar-window-shape": quotaShape(window), className: CSS_CLASS.quotaRow },
      createElement("span", null, window.key),
      createElement("span", { "data-sidebar-window-value": window.key }, quotaWindowText(t, window)),
    ),
  );
}
