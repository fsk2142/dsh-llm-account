/**
 * 中栏仪表盘（Task 9）：逐账号列出额度与状态、生效账号高亮、切换记录。
 *
 * 规格 §8.1 第 5 条：「点开中栏仪表盘：逐账号列出额度、状态、拒绝/冷却与切换记录；生效账号高亮」。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态、不发起请求。
 * @module dsh-llm-account/src/client/dashboard
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import { quotaShape, quotaWindowText } from "./quota";
import type { AccountUsageStatus, SwitchRecord, VendorUsageStatus } from "./usage-contract";

/** 仪表盘属性。 */
export interface DashboardProps {
  t: (key: string) => string;
  /** 状态；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /** 切换记录（**最新在前**，顺序由宿主侧 `switchNotices()` 保证）。 */
  switches: readonly SwitchRecord[] | undefined;
  /** 关闭面板。 */
  onClose: () => void;
  /** 手动刷新（可选）。 */
  onRefresh?: () => void;
}

/** 认识的拒绝分类（其余显示为「未知」，不把原始值印到界面上）。 */
const KNOWN_REJECTIONS: readonly string[] = ["quota", "rate-limit", "invalid-credential", "unavailable", "server", "network"];

/**
 * 中栏仪表盘。
 * @param props - 见 {@link DashboardProps}。
 * @returns 元素树。
 */
export function Dashboard(props: DashboardProps): ReactElement {
  const { t, status } = props;
  return createElement(
    "div",
    { "data-card": "dashboard", className: CSS_CLASS.dashboard },
    createElement(
      "header",
      null,
      createElement("h2", null, t("dashboard.title")),
      ...(props.onRefresh === undefined
        ? []
        : [createElement("button", { key: "refresh", type: "button", "data-dashboard-refresh": "true", onClick: () => props.onRefresh?.() }, t("dashboard.refresh"))]),
      createElement("button", { key: "close", type: "button", "data-dashboard-close": "true", onClick: () => props.onClose() }, t("dashboard.close")),
    ),
    ...(status === undefined
      ? [createElement("p", { key: "nodata", "data-dashboard-empty": "true" }, t("dashboard.noData"))]
      : [
          createElement("h3", { key: "accounts-title" }, t("dashboard.accounts")),
          ...status.accounts.map((account) => accountBlock(props, account)),
          ...(status.failures.length === 0
            ? []
            : [createElement("ul", { key: "failures", "data-dashboard-failures": "true" }, ...status.failures.map((failure, index) => createElement("li", { key: index }, failure)))]),
        ]),
    switchHistory(props),
  );
}

/** 一个账号的区块：名称、状态、固定/生效标注、拒绝、逐窗口额度。 */
function accountBlock(props: DashboardProps, account: AccountUsageStatus): ReactNode {
  const { t } = props;
  const effective = account.effective;
  const pinned = props.status?.pinned === account.ref;
  return createElement(
    "section",
    {
      key: account.ref,
      "data-dashboard-account": account.ref,
      className: CSS_CLASS.account,
      // 生效账号高亮（规格 §8.1 第 5 条）。
      "data-dashboard-effective": effective,
      "data-dashboard-configured": account.configured,
      ...(account.rejection === undefined ? {} : { "data-dashboard-rejection-kind": account.rejection.kind }),
      ...(account.rejection?.until === undefined ? {} : { "data-dashboard-rejection-until": account.rejection.until }),
    },
    createElement("h4", null, account.label),
    ...(effective ? [createElement("span", { key: "effective", "data-dashboard-mark": "effective" }, t("sidebar.effective"))] : []),
    ...(pinned ? [createElement("span", { key: "pinned", "data-dashboard-pinned": account.ref }, t("sidebar.pinned"))] : []),
    createElement("small", { key: "configured" }, account.configured ? t("account.configured") : t("account.missing")),
    ...(account.rejection === undefined
      ? []
      : [
          createElement(
            "small",
            { key: "rejection", "data-dashboard-rejection-label": account.rejection.kind },
            rejectionText(t, account.rejection.kind),
          ),
        ]),
    ...(account.quota?.plan === undefined ? [] : [createElement("small", { key: "plan", "data-dashboard-plan": account.quota.plan }, account.quota.plan)]),
    // 该账号额度读取里的**部分失败**照样列出来：不列就等于把一次不完整的读数呈现成完整的。
    ...(account.quota?.failures ?? []).map((failure, index) =>
      createElement("small", { key: `qf-${index}`, "data-dashboard-account-failure": `${account.ref}:${index}` }, failure),
    ),
    ...(account.quota === undefined ? [] : account.quota.windows.map((window) => windowBlock(t, window))),
  );
}

/** 一个额度窗口。 */
function windowBlock(t: (key: string) => string, window: { key: string; used?: number; cap?: number; percent?: number; resetAt?: number; exceeded?: boolean }): ReactNode {
  return createElement(
    "div",
    { key: window.key, "data-dashboard-window": window.key, "data-dashboard-window-shape": quotaShape(window) },
    createElement("span", null, window.key === "" ? t("dashboard.unknown") : window.key),
    createElement("span", { "data-dashboard-window-value": window.key }, quotaWindowText(t, window)),
  );
}

/** 拒绝分类文案：认识的映射到原因文案，不认识的显示「未知」。 */
function rejectionText(t: (key: string) => string, kind: string): string {
  if (!KNOWN_REJECTIONS.includes(kind)) return t("dashboard.unknown");
  return t(`switch.reason.${kind}`);
}

/** 切换记录（最新在前）。 */
function switchHistory(props: DashboardProps): ReactNode {
  const { t } = props;
  const switches = props.switches ?? [];
  return createElement(
    "section",
    { "data-dashboard-switches": "true" },
    createElement("h3", null, t("dashboard.switches")),
    ...(switches.length === 0
      ? [createElement("p", { key: "none" }, t("dashboard.noSwitches"))]
      : switches.map((record, index) =>
          createElement(
            "div",
            {
              key: `${record.at}-${index}`,
              "data-switch-record": `${record.fromRef}→${record.toRef}`,
              "data-switch-reason": record.reason,
              "data-switch-at": record.at,
            },
            createElement("span", null, `${record.fromRef} → ${record.toRef}`),
            createElement("span", { "data-switch-reason-label": record.reason }, t(`switch.reason.${record.reason}`)),
            createElement("time", { dateTime: new Date(record.at).toISOString() }, new Date(record.at).toISOString()),
          ),
        )),
  );
}
