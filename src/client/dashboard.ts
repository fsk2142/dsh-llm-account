/**
 * 中栏仪表盘（Task 9）：逐账号列出额度与状态、生效账号高亮、切换记录。
 *
 * 规格 §8.1 第 5 条：「点开中栏仪表盘：逐账号列出额度、状态、拒绝/冷却与切换记录；生效账号高亮」。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态、不发起请求。
 *
 * 视觉（2026-10-17 重做）：标题行带刷新/关闭两个图标按钮；每个账号是一张卡片
 * （生效账号的描边用强调色），卡片内是「身份行 + 标记 + 额度表」；切换记录是一行一条的
 * 时间线，时间在右端、用相对时间显示（ISO 仍在 `dateTime` 上）。
 * @module dsh-llm-account/src/client/dashboard
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import { rejectionText } from "./copy";
import { CloseIcon, RefreshIcon } from "./icons";
import { quotaMeter, quotaShape, quotaWindowLabel, quotaWindowText } from "./quota";
import { relativeTime } from "./time";
import type { AccountUsageStatus, QuotaWindow, SwitchRecord, VendorUsageStatus } from "./usage-contract";

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
  /**
   * 最近一次读取的失败原因（宿主给出的可读文本）；读取正常时为 `undefined`。
   * 与 {@link SidebarCardProps.failure} 同一条纪律：读失败与没有数据是两件事。
   */
  failure?: string;
  /** 当前显示的是上一次成功读到的数据（失败时保留），不是刚刚读到的。 */
  stale?: boolean;
}

/**
 * 中栏仪表盘。
 * @param props - 见 {@link DashboardProps}。
 * @returns 元素树。
 */
export function Dashboard(props: DashboardProps): ReactElement {
  const { t, status } = props;
  const failure = props.failure;
  return createElement(
    "div",
    { "data-card": "dashboard", className: CSS_CLASS.dashboard },
    createElement(
      "header",
      null,
      createElement("h2", null, t("dashboard.title")),
      // 动作成组右对齐（`header > :last-child` 的 `margin-left:auto` 落在这一组上）。
      createElement(
        "div",
        { className: CSS_CLASS.actions },
        ...(props.onRefresh === undefined
          ? []
          : [
              createElement(
                "button",
                {
                  key: "refresh",
                  type: "button",
                  "data-dashboard-refresh": "true",
                  "aria-label": t("dashboard.refresh"),
                  title: t("dashboard.refresh"),
                  className: CSS_CLASS.icon,
                  onClick: () => props.onRefresh?.(),
                },
                createElement(RefreshIcon, null),
              ),
            ]),
        createElement(
          "button",
          {
            key: "close",
            type: "button",
            "data-dashboard-close": "true",
            "aria-label": t("dashboard.close"),
            title: t("dashboard.close"),
            className: CSS_CLASS.icon,
            onClick: () => props.onClose(),
          },
          createElement(CloseIcon, null),
        ),
      ),
    ),
    // 失败提示置顶（参考实现的用量胶囊同一条：失败时先说失败，再决定显示什么数据）。
    ...(failure === undefined
      ? []
      : [
          createElement(
            "p",
            {
              key: "failure",
              "data-dashboard-failure": "true",
              className: CSS_CLASS.failure,
              ...(failure === "" ? {} : { "data-dashboard-failure-detail": failure }),
            },
            t("usage.failed"),
            failure === "" ? "" : `：${failure}`,
            props.stale === true ? createElement("small", { key: "stale", "data-dashboard-stale": "true" }, `（${t("usage.stale")}）`) : null,
          ),
        ]),
    ...(status === undefined
      ? [
          // 没有数据时：失败说失败，什么都不曾说才说「暂无数据」。
          failure === undefined
            ? createElement("p", { key: "nodata", "data-dashboard-empty": "true", className: CSS_CLASS.empty }, t("dashboard.noData"))
            : createElement("p", { key: "nodata-failed", "data-dashboard-empty": "true", className: CSS_CLASS.empty }, t("usage.failed")),
        ]
      : [
          createElement("h3", { key: "accounts-title" }, t("dashboard.accounts")),
          // 与 account-card.ts 同一条纪律：结构校验只查「是不是数组」，渲染路径自己挑出
          // 能画的行；集合字段缺了就当作空，不让 `.map`/`.length` 抛在渲染路径上。
          ...(status.accounts ?? [])
            .filter((account): account is AccountUsageStatus => typeof account === "object" && account !== null)
            .map((account) => accountBlock(props, account)),
          ...((status.failures ?? []).length === 0
            ? []
            : [createElement("ul", { key: "failures", "data-dashboard-failures": "true" }, ...(status.failures ?? []).map((item, index) => createElement("li", { key: index }, item)))]),
        ]),
    switchHistory(props),
  );
}

/** 一个账号的区块：名称、状态、固定/生效标注、拒绝、逐窗口额度。 */
function accountBlock(props: DashboardProps, account: AccountUsageStatus): ReactNode {
  const { t } = props;
  const effective = account.effective;
  const pinned = props.status?.pinned === account.ref;
  // 契约里 `rejection` / `quota` 都是**可选**字段，而线上可能把它们序列化成 `null`
  // （JSON 没有 undefined）。只写 `=== undefined` 会让 `null` 走进来，接着读 `.kind` /
  // `.windows` 抛错 —— 渲染路径一抛，整块仪表盘变空白。与 `sidebar-card.ts` 同一条纪律。
  const rejectionOf = account.rejection ?? undefined;
  const quotaOf = account.quota ?? undefined;
  return createElement(
    "section",
    {
      key: account.ref,
      "data-dashboard-account": account.ref,
      // 生效账号高亮（规格 §8.1 第 5 条）。
      "data-dashboard-effective": effective,
      "data-dashboard-configured": account.configured,
      ...(rejectionOf === undefined ? {} : { "data-dashboard-rejection-kind": rejectionOf.kind }),
      ...(rejectionOf?.until === undefined ? {} : { "data-dashboard-rejection-until": rejectionOf.until }),
    },
    // 身份行：名称 + 标记 + 配置状态（与账户卡片同一形状：左边是身份，右边才是动作）。
    createElement(
      "div",
      { className: CSS_CLASS.accountHead },
      createElement(
        "span",
        { className: CSS_CLASS.identity },
        createElement("span", { className: CSS_CLASS.dot }),
        createElement(
          "span",
          { className: CSS_CLASS.identityText },
          createElement(
            "span",
            { className: CSS_CLASS.nameRow },
            createElement("h4", null, account.label),
            ...(effective ? [createElement("span", { key: "effective", "data-dashboard-mark": "effective", className: CSS_CLASS.mark }, t("sidebar.effective"))] : []),
            ...(pinned ? [createElement("span", { key: "pinned", "data-dashboard-pinned": account.ref, className: CSS_CLASS.mark }, t("sidebar.pinned"))] : []),
            ...(quotaOf?.plan === undefined
              ? []
              : [createElement("span", { key: "plan", "data-dashboard-plan": quotaOf.plan, "data-mark": "plan", className: CSS_CLASS.mark }, quotaOf.plan)]),
          ),
          createElement("small", { key: "configured" }, account.configured ? t("account.configured") : t("account.missing")),
        ),
      ),
    ),
    ...(rejectionOf === undefined
      ? []
      : [createElement("p", { key: "rejection", "data-dashboard-rejection-label": rejectionOf.kind, className: CSS_CLASS.rejection }, rejectionText(t, rejectionOf.kind))]),
    // 该账号额度读取里的**部分失败**照样列出来：不列就等于把一次不完整的读数呈现成完整的。
    ...(quotaOf?.failures ?? []).map((item, index) =>
      createElement("small", { key: `qf-${index}`, "data-dashboard-account-failure": `${account.ref}:${index}`, className: CSS_CLASS.failure }, item),
    ),
    ...(quotaOf === undefined
      ? []
      : [
          createElement(
            "div",
            { key: "meters", className: CSS_CLASS.meters },
            ...(quotaOf.windows ?? []).map((window) => windowBlock(t, window)),
          ),
        ]),
  );
}

/** 一个额度窗口。 */
function windowBlock(t: (key: string) => string, window: QuotaWindow): ReactNode {
  const shape = quotaShape(window);
  const meter = quotaMeter(window);
  return createElement(
    "div",
    { key: window.key, "data-dashboard-window": window.key, "data-dashboard-window-shape": shape, className: CSS_CLASS.quotaRow },
    createElement(
      "div",
      { className: CSS_CLASS.meterHead },
      createElement("span", { className: CSS_CLASS.meterLabel }, window.key === "" ? t("dashboard.unknown") : quotaWindowLabel(t, window.key)),
      createElement(
        "span",
        { "data-dashboard-window-value": window.key, className: shape === "missing" ? CSS_CLASS.quotaMissing : CSS_CLASS.quotaValue },
        quotaWindowText(t, window),
      ),
    ),
    meter === undefined
      ? null
      : createElement(
          "span",
          { key: "bar", "data-quota-percent": meter.percent, className: CSS_CLASS.quotaTrack },
          createElement("span", { "data-quota-level": meter.level, className: CSS_CLASS.quotaFill, style: { width: `${meter.percent}%` } }),
        ),
  );
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
            createElement("time", { dateTime: new Date(record.at).toISOString() }, relativeTime(t, record.at)),
          ),
        )),
  );
}
