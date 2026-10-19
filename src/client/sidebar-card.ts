/**
 * 侧边栏额度卡片 —— 用户的第一诉求（规格 §8.1）。
 *
 * 要修掉的旧缺陷：旧卡片显示「配置里固定的那个账号」，而多账号轮换是每次请求临时决定的，
 * 用量打满被自动切走后卡片数字不变。所以本卡片显示的是**生效账号**（`status().effective`）。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态，也不会在
 * 这里发起任何请求 —— 轮询由 `seams.ts` 的控制器按挂载/开关状态起停。
 *
 * 视觉（2026-10-19 用户要求定稿）：
 * - **整张卡片就是一个按钮**：点哪里都打开用量面板。原先底部那个「打开用量面板」通栏按钮
 *   删掉了 —— 它占一整行却只做一件「点卡片」也能做的事；
 * - **手动刷新搬到面板里**：侧边栏是常驻的窄条，上面摆一个刷新图标容易被误点，而它要刷的
 *   本来就是面板里的东西；
 * - 额度一行放下**三档**（5 小时 / 每周 / 每月）：每档一列「名称 + 剩余百分比 + 细条」，
 *   不再只报 5 小时。
 *
 * 收起态（槽位只有 ~35px）仍然只渲染一个图标按钮，动作与整卡点击相同。
 * @module dsh-llm-account/src/client/sidebar-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS, cls } from "./css";
import { failureText } from "./failure-text";
import { UsageIcon } from "./icons";
import { fallbackQuotaWindows, quotaMeter, quotaReading, quotaResetDateText, quotaWindowLabel } from "./quota";
import type { AccountUsageStatus, QuotaWindow, VendorUsageStatus } from "./usage-contract";

/** 卡片属性。 */
export interface SidebarCardProps {
  t: (key: string) => string;
  /** 要显示的厂商状态；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /**
   * 要显示**哪一个账号**（账号级轮播，2026-10-19）。
   *
   * 轮播器算出当前该显示哪个 (厂商, 账号) 对，把 ref 传进来。缺省时退回「这家当前使用的
   * 账号」—— 那样多账号的厂商永远只显示一个。
   */
  accountRef?: string | undefined;
  /** 打开中栏仪表盘。**整张卡片**点下去就是这个动作。 */
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
}

/**
 * 一行里要显示的三档窗口，按这个顺序找（键的写法各家不一，见 {@link windowOfKind}）。
 *
 * 用户 2026-10-19：「看看能不能在一行空间内显示 5 小时、一周、一个月的额度消耗情况」。
 * 找不到的档位**不占位**（`undefined` 直接跳过）——三家并不都有月度窗口（Open Design 的
 * 月度是本机口径补的，Command Code 是 `monthlyCredits`）。
 */
const ROW_KINDS: readonly { kind: "five-hour" | "week" | "month"; keys: readonly string[] }[] = [
  { kind: "five-hour", keys: ["fiveHour", "5h", "5H", "rolling"] },
  { kind: "week", keys: ["weekly", "week", "Weekly"] },
  { kind: "month", keys: ["monthly", "month", "monthlyCredits", "Monthly"] },
];

/**
 * 从窗口列表里挑出某一档。
 * @param windows - 归一化后的窗口。
 * @param kind - 目标档位。
 * @returns 该档窗口；没有就是 `undefined`（不占位）。
 */
function windowOfKind(windows: readonly QuotaWindow[], kind: "five-hour" | "week" | "month"): QuotaWindow | undefined {
  const wanted = ROW_KINDS.find((entry) => entry.kind === kind);
  if (wanted === undefined) return undefined;
  for (const key of wanted.keys) {
    const hit = windows.find((window) => window.key === key);
    if (hit !== undefined) return hit;
  }
  return undefined;
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
  // 接着 `effective.ref` 在**渲染路径**上抛错，整块侧边栏变空白。所以这里把 `null` 一律
  // 收敛成「没有生效账号」。
  const effective = status?.effective ?? undefined;
  // `accounts` 是跨边界传输的数组：存在但**不是数组**时 `.find` 一样会抛（旧宿主、
  // 半成品载荷），而这是侧边栏的渲染路径 —— 抛了整块卡片变空白。收敛成空数组。
  const rows: readonly AccountUsageStatus[] = Array.isArray(status?.accounts) ? status.accounts : [];
  // 轮播到的那一个账号优先（账号级轮播 2026-10-19）；没指定才退回「这家的当前账号」。
  const wantedRow =
    props.accountRef === undefined ? undefined : rows.find((account) => account.ref === props.accountRef);
  const effectiveRow = effective === undefined ? undefined : rows.find((account) => account.ref === effective.ref);
  // 还没有请求时 effective 可能为空，但用户已经指定/自动选中了当前账号：优先显示它。
  const currentRow =
    wantedRow ??
    effectiveRow ??
    rows.find((account) => account.active === true) ??
    rows.find((account) => account.effective === true) ??
    rows.find((account) => account.configured === true);
  const hasData = status !== undefined && currentRow !== undefined;

  return createElement(
    // 外壳只负责「有多宽」：宿主侧边栏收起时这个槽位只有 ~35px，整张卡片放不下（会向左溢出
    // 到窗口外）。外壳用容器查询把宽度告诉内部，窄的时候只渲染一个图标按钮。
    "div",
    { className: CSS_CLASS.sidebarShell },
    // —— 展开态：**整张卡片**是按钮 ——
    //
    // 为什么用 `<button>` 包住整块而不是给 div 挂 onClick：键盘可达（Tab + 回车）、
    // 语义正确（读屏会念「按钮」）、并且不需要自己处理焦点环。里面不再套别的按钮
    // （HTML 不允许嵌套 button），所以刷新入口已经搬到面板里。
    createElement(
      "button",
      {
        type: "button",
        "data-card": "sidebar-quota",
        "data-sidebar-open": "true",
        "data-sidebar-whole": "true",
        "aria-label": `${titleOf(props, currentRow)} · ${t("sidebar.open")}`,
        title: t("sidebar.open"),
        className: cls(CSS_CLASS.sidebar, CSS_CLASS.sidebarButton),
        onClick: () => props.onOpen(),
      },
      createElement(
        "div",
        { className: CSS_CLASS.sidebarHead },
        createElement("h3", { "data-sidebar-title": "true" }, titleOf(props, currentRow)),
      ),
      ...(hasData
        ? [
            // 两行：第一行 5 小时（带重置时间），第二行周 + 月。
            ...quotaRows(props, currentRow),
          ]
        : [
            // 没有可显示的数据：失败时说失败（附上一次数据标记），什么都没发生过时才说
            // 「还没有请求」—— 前者是故障，后者是空态，混为一谈就是谎报。
            props.failure === undefined
              ? createElement("p", { key: "empty", "data-sidebar-empty": "true", className: CSS_CLASS.empty }, t("sidebar.noRequest"))
              : failureNote(props),
          ]),
      ...(hasData && props.failure !== undefined ? [failureNote(props)] : []),
    ),
    // —— 收起态：只有这一个图标按钮（同一个动作） ——
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

/**
 * 额度概览：**两行**，每行一条「标签 — 进度条 — 重置时间」（用户 2026-10-19 定稿）。
 *
 * 第一行 5 小时档、第二行周档。为什么不并排：侧边栏只有两百多像素宽，并排后档位名要截断、
 * 重置时间完全放不下；横排一行一条才塞得下这三样，而且和「还剩多少 + 什么时候恢复」的
 * 阅读顺序一致。
 *
 * 缺少某一档时**不占位**（三家并不都有周窗口）；一档都没有时退回第一个能读的窗口，
 * 别让整块空白。
 * @param props - 卡片属性。
 * @param row - 当前账号。
 * @returns 要追加的行元素。
 */
function quotaRows(props: SidebarCardProps, row: AccountUsageStatus | undefined): ReactNode[] {
  const { t } = props;
  const vendor = props.status?.vendor ?? "";
  const windows = row?.quota?.windows?.length ? row.quota.windows : fallbackQuotaWindows(vendor);
  const fiveHour = windowOfKind(windows, "five-hour");
  const week = windowOfKind(windows, "week");
  const shown = [fiveHour, week].filter((item): item is QuotaWindow => item !== undefined);
  // 一档都认不出来（旧宿主只给无键窗口）：用第一个能读的，不留空白。
  const rows = shown.length > 0 ? shown : windows.filter((item) => item.unlimited !== true).slice(0, 1);
  if (rows.length === 0) return [];
  // **外层网格**：三列定义在容器上，两行共享同一套列宽 —— 这是两条进度条对齐的前提
  // （每行各写一套网格时，标签宽度不同会让后两列错开）。
  return [
    createElement(
      "div",
      { key: "windows", "data-sidebar-windows": "true", className: CSS_CLASS.sidebarWindows },
      ...rows.map((window, index) =>
        createElement(
          "div",
          {
            key: window.key,
            "data-sidebar-row": index === 0 ? "primary" : "secondary",
            className: CSS_CLASS.sidebarRowPrimary,
          },
          sidebarMeter(t, window),
        ),
      ),
    ),
  ];
}
/**
 * 一档窗口的一行读数：**标签 — 进度条 — 重置时间**（横向三样，用户 2026-10-19 定稿）。
 *
 * 条的长度是两个读数的比值：左侧填色 = **剩余**比例（与 QuotaBar 同一口径），
 * 所以「条越长越安全」。百分比数字不再单列一行 —— 条本身已经表达了比例，重置时间更重要。
 *
 * 缺失数据时的表现：条不填色、重置时间写「未知」，都不猜成 0。
 * @param t - 取词。
 * @param window - 该档窗口。
 * @returns 一行元素。
 */
function sidebarMeter(t: (key: string) => string, window: QuotaWindow): ReactElement {
  const meter = quotaMeter(window);
  const remaining = meter === undefined ? undefined : Math.max(0, Math.min(100, 100 - meter.percent));
  // 「不限」是端点给的事实，与「读不到」不是一回事。
  const unlimited = window.unlimited === true;
  const reading = quotaReading(window);
  const level = unlimited ? "unlimited" : remaining === undefined ? "missing" : remaining > 0 ? "ok" : "error";
  // 日期格式（`10-19 20:00`）而不是「今天/明天」：两行上下并排时相对说法对不齐，
  // 也不好比较（用户 2026-10-19：「小时那个也用日期表示，不用明天这种」）。
  const reset = quotaResetDateText(window.resetAt) ?? t("quota.resetUnknown");
  const bar =
    meter === undefined || unlimited
      ? null
      : createElement("span", {
          "data-quota-bar-fill": window.key,
          "data-level": level,
          className: CSS_CLASS.quotaBarFill,
          style: { width: `${remaining}%` },
        });
  return createElement(
    "div",
    {
      key: window.key,
      "data-sidebar-window": window.key,
      "data-sidebar-window-shape": reading.shape,
      "data-sidebar-window-level": level,
      className: CSS_CLASS.sidebarWindow,
    },
    createElement("span", { className: CSS_CLASS.sidebarWindowLabel }, quotaWindowLabel(t, window.key)),
    createElement(
      "span",
      // aria-label 给读屏：条是纯视觉的，把「还剩多少」说出来。
      {
        "data-sidebar-track": window.key,
        "aria-label": unlimited ? t("quota.unlimited") : remaining === undefined ? t("account.quotaMissing") : `${remaining}%`,
        className: CSS_CLASS.sidebarWindowTrack,
      },
      bar,
    ),
    createElement(
      "small",
      { "data-sidebar-reset": window.resetAt ?? "unknown", className: CSS_CLASS.sidebarWindowReset },
      reset,
    ),
  );
}

/**
 * 失败提示行：可读的原因文案 + 「上次数据」标记。
 *
 * 原因文本由容器从宿主读数里带出来（`status.failures`）；没有文本时只显示通用文案，
 * 不留一行光秃秃的「失败」。诊断原文（端点短名之类的英文）翻成人话再上屏，原文留在
 * `data-sidebar-failure-detail` 上供排查；认不出的形状原样显示。
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
