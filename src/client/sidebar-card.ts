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
import type { AccountUsageStatus, SwitchNotice, VendorUsageStatus } from "./usage-contract";

/** 卡片属性。 */
export interface SidebarCardProps {
  t: (key: string) => string;
  /** 要显示的厂商状态；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /** 打开中栏仪表盘。 */
  onOpen: () => void;
  /**
   * 最近一次读取的失败原因（宿主给出的可读文本）；读取正常时为 `undefined`。
   *
   * 存在的理由是把「读失败」和「没有请求」分开：两者都表现为没有额度数字，但成因
   * 完全相反 —— 把一次瞬时故障显示成「还没有请求经过这个账号」是谎报（参考实现的
   * 用量胶囊在失败时给的是失败提示 + 「上次数据」，不是空态）。
   */
  failure?: string;
  /** 当前显示的是上一次成功读到的数据（失败时保留），不是刚刚读到的。 */
  stale?: boolean;
  /** 手动重试（失败时用户要能立刻再问一次，参考实现的「立即重试」）。 */
  onRefresh?: () => void;
}

/**
 * 侧边栏额度卡片。
 * @param props - 见 {@link SidebarCardProps}。
 * @returns 元素树。
 */
export function SidebarCard(props: SidebarCardProps): ReactElement {
  const { t, status } = props;
  // `effective` 在契约里是**可省略**字段（`effective?: { ref; at }`），而这份数据跨远程边界
  // 传输 —— 一个把 `undefined` 序列化成 `null` 的中间层就会让 `null !== undefined` 成立，
  // 接着 `effective.ref` 在**渲染路径**上抛错，整块侧边栏变空白（`index.ts` 里点名过这个失败
  // 模式）。所以这里把 `null` 一律收敛成「没有生效账号」，并把收敛后的值递给标注区，
  // 全卡片只有这一处读它。
  const effective = status?.effective ?? undefined;
  const pinned = status?.pinned ?? null;
  const effectiveRow = effective === undefined ? undefined : status?.accounts.find((account) => account.ref === effective.ref);
  const hasData = status !== undefined && effective !== undefined;

  return createElement(
    "div",
    { "data-card": "sidebar-quota", className: CSS_CLASS.sidebar },
    ...(hasData
      ? [
          // `switch` 与 `effective` 同一条纪律：可选字段，线上可能是 `null`。
          switchNotice(t, effective, pinned, status.switch ?? undefined),
          createElement("h3", { key: "title", "data-sidebar-title": "true" }, titleOf(props, effectiveRow)),
          ...effectiveQuota(props, effectiveRow),
        ]
      : [
          // 没有可显示的数据：失败时说失败（附上一次数据标记），什么都没发生过时才说
          // 「还没有请求」—— 前者是故障，后者是空态，混为一谈就是谎报。
          props.failure === undefined
            ? createElement("p", { key: "empty", "data-sidebar-empty": "true" }, t("sidebar.noRequest"))
            : failureNote(props),
        ]),
    ...(hasData && props.failure !== undefined ? [failureNote(props)] : []),
    ...(props.onRefresh === undefined
      ? []
      : [
          createElement(
            "button",
            { key: "refresh", type: "button", "data-sidebar-refresh": "true", onClick: () => props.onRefresh?.() },
            t("usage.refresh"),
          ),
        ]),
    createElement(
      "button",
      { key: "open", type: "button", "data-sidebar-open": "true", onClick: () => props.onOpen() },
      t("sidebar.open"),
    ),
  );
}

/**
 * 失败提示行：可读的原因文案 + 「上次数据」标记。
 *
 * 原因文本由容器从宿主读数里带出来（`status.failures`）；没有文本时只显示通用文案，
 * 不留一行光秃秃的「失败」。
 */
function failureNote(props: SidebarCardProps): ReactElement {
  const { t } = props;
  const detail = props.failure ?? "";
  return createElement(
    "p",
    {
      key: "failure",
      "data-sidebar-failure": "true",
      ...(detail === "" ? {} : { "data-sidebar-failure-detail": detail }),
    },
    t("usage.failed"),
    detail === "" ? "" : `：${detail}`,
    props.stale === true ? createElement("small", { key: "stale", "data-sidebar-stale": "true" }, `（${t("usage.stale")}）`) : null,
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
 *
 * 三个值都由 {@link SidebarCard} 递进来（`effective` 已在那一处把 `null` 收敛成 `undefined`），
 * 本函数不再自己读 `status` —— 两处各读一次就有一处可能忘掉收敛。
 */
function switchNotice(
  t: (key: string) => string,
  effective: { ref: string; at: number } | undefined,
  pinned: string | null,
  switchRecord: SwitchNotice | undefined,
): ReactNode {
  const differs = effective !== undefined && pinned !== null && pinned !== effective.ref;
  const marks: ReactNode[] = [];

  if (pinned !== null && (differs || effective === undefined)) {
    marks.push(createElement("span", { key: "pinned", "data-sidebar-pinned": pinned }, `${t("sidebar.pinned")}: ${pinned}`));
  }
  if (effective !== undefined) {
    marks.push(createElement("span", { key: "effective", "data-sidebar-effective": effective.ref }, `${t("sidebar.effective")}: ${effective.ref}`));
  }

  const notice = switchRecord;
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
