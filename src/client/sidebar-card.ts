/**
 * 侧边栏额度卡片 —— 用户的第一诉求（规格 §8.1）。
 *
 * 要修掉的旧缺陷：旧卡片显示「配置里固定的那个账号」，而多账号轮换是每次请求临时决定的，
 * 用量打满被自动切走后卡片数字不变。所以本卡片显示的是**生效账号**（`status().effective`），
 * 并在它与固定账号不同时，在顶部给出「谁 → 谁、原因、时间」的切换提示，同时把两者都标注出来
 * （规格 §8.1 第 3、4 条）。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态，也不会在
 * 这里发起任何请求 —— 轮询由 `seams.ts` 的控制器按挂载/开关状态起停。
 *
 * 视觉（2026-10-17 重做）：标题 + 右上角刷新图标一行；切换提示是一条琥珀色小条；
 * 额度是「标签 …… 读数 / 4px 进度条」的紧凑列表；底部一个通栏按钮打开中栏面板。
 * @module dsh-llm-account/src/client/sidebar-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS, cls } from "./css";
import { RefreshIcon, UsageIcon } from "./icons";
import { quotaMeter, quotaShape, quotaWindowLabel, quotaWindowText } from "./quota";
import { relativeTime } from "./time";
import type { AccountUsageStatus, QuotaWindow, SwitchNotice, VendorUsageStatus } from "./usage-contract";

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
    // 外壳只负责「有多宽」：宿主侧边栏收起时这个槽位只有 ~35px，整张卡片放不下（会向左溢出
    // 到窗口外）。外壳用容器查询把宽度告诉内部，窄的时候只渲染一个图标按钮；宽的时候渲染
    // 完整卡片。两套都在树里，切换由样式表的 container query 做 —— 组件仍然是纯 props 的。
    "div",
    { className: CSS_CLASS.sidebarShell },
    createElement(
      "div",
      { "data-card": "sidebar-quota", className: CSS_CLASS.sidebar },
      createElement(
        "div",
        { className: CSS_CLASS.sidebarHead },
        createElement("h3", { "data-sidebar-title": "true", title: titleOf(props, effectiveRow) }, titleOf(props, effectiveRow)),
        ...(props.onRefresh === undefined ? [] : [refreshButton(props)]),
      ),
      ...(hasData
        ? [
            // `switch` 与 `effective` 同一条纪律：可选字段，线上可能是 `null`。
            switchNotice(t, effective, pinned, status.switch ?? undefined),
            ...effectiveQuota(props, effectiveRow),
          ]
        : [
            // 没有可显示的数据：失败时说失败（附上一次数据标记），什么都没发生过时才说
            // 「还没有请求」—— 前者是故障，后者是空态，混为一谈就是谎报。
            props.failure === undefined
              ? createElement("p", { key: "empty", "data-sidebar-empty": "true", className: CSS_CLASS.empty }, t("sidebar.noRequest"))
              : failureNote(props),
          ]),
      ...(hasData && props.failure !== undefined ? [failureNote(props)] : []),
      createElement(
        "div",
        { className: CSS_CLASS.sidebarFoot },
        createElement(
          "button",
          { type: "button", "data-sidebar-open": "true", className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm), onClick: () => props.onOpen() },
          t("sidebar.open"),
        ),
      ),
    ),
    // 收起态：只有这一个图标按钮（同一个动作，同一个 `data-sidebar-open`）。
    createElement(
      "div",
      { className: CSS_CLASS.sidebarCompact },
      createElement(
        "button",
        {
          type: "button",
          "data-sidebar-open": "true",
          "data-sidebar-compact": "true",
          "aria-label": t("sidebar.open"),
          title: t("sidebar.open"),
          className: CSS_CLASS.icon,
          onClick: () => props.onOpen(),
        },
        createElement(UsageIcon, null),
      ),
    ),
  );
}

/** 右上角的刷新图标按钮（失败时要能立刻再问一次）。 */
function refreshButton(props: SidebarCardProps): ReactElement {
  const label = props.t("usage.refresh");
  return createElement(
    "button",
    {
      key: "refresh",
      type: "button",
      "data-sidebar-refresh": "true",
      "aria-label": label,
      title: label,
      className: CSS_CLASS.icon,
      onClick: () => props.onRefresh?.(),
    },
    createElement(RefreshIcon, null),
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
      className: CSS_CLASS.failure,
      ...(detail === "" ? {} : { "data-sidebar-failure-detail": detail }),
    },
    t("usage.failed"),
    detail === "" ? "" : `：${detail}`,
    props.stale === true ? createElement("small", { key: "stale", "data-sidebar-stale": "true" }, `（${t("usage.stale")}）`) : null,
  );
}

/** 卡片标题：有套餐名就带套餐，否则用生效账号的名字；什么都没有时用页面名兜底。 */
function titleOf(props: SidebarCardProps, row: AccountUsageStatus | undefined): string {
  const plan = row?.quota?.plan;
  const account = row === undefined ? (props.status?.effective?.ref ?? "") : row.label;
  if (plan === undefined) return account === "" ? props.t("nav") : account;
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
    marks.push(createElement("span", { key: "pinned", "data-sidebar-pinned": pinned, className: CSS_CLASS.mark }, `${t("sidebar.pinned")}: ${pinned}`));
  }
  if (effective !== undefined) {
    marks.push(createElement("span", { key: "effective", "data-sidebar-effective": effective.ref, className: CSS_CLASS.mark }, `${t("sidebar.effective")}: ${effective.ref}`));
  }

  const notice = switchRecord;
  if (!differs || notice === undefined) {
    return createElement("div", { key: "marks", "data-sidebar-marks": "true", className: CSS_CLASS.marks }, ...marks);
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
      relativeTime(t, notice.at),
    ),
    ...marks,
  );
}

/** 生效账号的额度：每个窗口一行（标签 + 读数 + 进度条），缺失的窗口按「暂无数据」处理。 */
function effectiveQuota(props: SidebarCardProps, row: AccountUsageStatus | undefined): ReactNode[] {
  const { t } = props;
  const quota = row?.quota;
  if (quota === undefined) {
    return [createElement("p", { key: "noquota", "data-sidebar-quota-missing": "true", className: CSS_CLASS.quotaMissing }, t("account.quotaMissing"))];
  }
  return [
    createElement(
      "div",
      { key: "meters", className: CSS_CLASS.meters },
      ...(quota.windows ?? []).map((window) => meterRow(t, window)),
    ),
  ];
}

/** 一个窗口的紧凑读数（与账户卡片同一套形状，列数由侧边栏样式压成一列）。 */
function meterRow(t: (key: string) => string, window: QuotaWindow): ReactElement {
  const shape = quotaShape(window);
  const meter = quotaMeter(window);
  return createElement(
    "div",
    {
      key: window.key,
      "data-sidebar-window": window.key,
      "data-sidebar-window-shape": shape,
      className: CSS_CLASS.quotaRow,
    },
    createElement(
      "div",
      { className: CSS_CLASS.meterHead },
      createElement("span", { className: CSS_CLASS.meterLabel }, quotaWindowLabel(t, window.key)),
      createElement(
        "span",
        { "data-sidebar-window-value": window.key, className: shape === "missing" ? CSS_CLASS.quotaMissing : CSS_CLASS.quotaValue },
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
