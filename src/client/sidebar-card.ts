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
 * 视觉（2026-10-17 重做；2026-10-18 再简）：标题 + 右上角刷新图标一行；额度只显示
 * **小时级窗口一条**（5 小时 / 滚动小时）—— 每窗口一条 QuotaBar 排三条太占侧边栏的
 * 地方，而最短窗口才是会被自动切换盯着的那个，全量窗口去中栏面板看；底部一个通栏按钮
 * 打开中栏面板。
 * @module dsh-llm-account/src/client/sidebar-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS, cls } from "./css";
import { failureText } from "./failure-text";
import { RefreshIcon, UsageIcon } from "./icons";
import { fallbackQuotaWindows, primaryQuotaWindow, quotaShape } from "./quota";
import { QuotaBar } from "./quota-bar";
import type { AccountUsageStatus, VendorUsageStatus } from "./usage-contract";

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
  // `accounts` 是跨边界传输的数组：`status.accounts` 存在但**不是数组**时（旧宿主、半成品
  // 载荷）`.find` 一样会抛 —— 而这是侧边栏的渲染路径，抛了整块卡片变空白。收敛成空数组。
  const rows: readonly AccountUsageStatus[] = Array.isArray(status?.accounts) ? status.accounts : [];
  const effectiveRow = effective === undefined ? undefined : rows.find((account) => account.ref === effective.ref);
  // 还没有请求时 effective 可能为空，但用户已经指定/自动选中了当前账号：优先显示它。
  const currentRow =
    effectiveRow ??
    rows.find((account) => account.active === true) ??
    rows.find((account) => account.effective === true) ??
    rows.find((account) => account.configured === true);
  const hasData = status !== undefined && currentRow !== undefined;

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
        createElement("h3", { "data-sidebar-title": "true", title: titleOf(props, currentRow) }, titleOf(props, currentRow)),
        ...(props.onRefresh === undefined ? [] : [refreshButton(props)]),
      ),
      ...(hasData
        ? [
            // 简要信息只显示当前账号和额度；不再显示「已指定/生效」等标记。
            ...effectiveQuota(props, currentRow),
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
 * 不留一行光秃秃的「失败」。诊断原文（端点短名之类的英文）翻成人话再上屏，原文留在
 * `data-sidebar-failure-detail` 上供排查；认不出的形状（宿主能力缺失之类的原文）原样显示。
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
    detail === "" ? "" : `：${failureText(t, detail)}`,
    props.stale === true ? createElement("small", { key: "stale", "data-sidebar-stale": "true" }, `（${t("usage.stale")}）`) : null,
  );
}

/** 卡片标题：只显示当前账号名称；没有账号时用页面名兜底。 */
function titleOf(props: SidebarCardProps, row: AccountUsageStatus | undefined): string {
  const account = row === undefined ? (props.status?.effective?.ref ?? "") : row.label;
  return account === "" ? props.t("nav") : account;
}

/** 生效账号的额度：**只画小时级窗口一条**（侧边栏窄，三条并排太占地方；全量窗口在中栏面板）。 */
function effectiveQuota(props: SidebarCardProps, row: AccountUsageStatus | undefined): ReactNode[] {
  const { t } = props;
  const vendor = props.status?.vendor ?? "";
  const quota = row?.quota;
  const windows = quota?.windows?.length ? quota.windows : fallbackQuotaWindows(vendor);
  const window = primaryQuotaWindow(windows, vendor);
  if (window === undefined) return [];
  return [
    createElement(
      "div",
      { key: "bars", className: CSS_CLASS.quotaBarList },
      createElement(
        "div",
        { key: window.key, "data-sidebar-window": window.key, "data-sidebar-window-shape": quotaShape(window) },
        QuotaBar({ t, window }),
      ),
    ),
  ];
}


