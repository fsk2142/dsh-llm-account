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
import { fallbackQuotaWindows, quotaMeter, quotaReading, quotaResetText, quotaWindowLabel } from "./quota";
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
  /**
   * 现在显示的是「最近一次请求的账号」而不是轮播（用户 2026-10-19 要求跟随会话）。
   *
   * 由此在标题旁标一句「跟随最近一次请求」—— 措辞必须诚实：宿主的 `remote.session` 没有
   * 「前端当前打开哪个会话」的接口，所以这是**最近发过请求**的那个账号，不是实时跟随。
   */
  following?: boolean;
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
        // 跟随当前会话时标一句。措辞必须诚实：这是**最近一次请求**的账号，不是实时跟随
        // 会话（宿主的 `remote.session` 没有「前端当前打开哪个会话」的接口）。不标的话，
        // 用户翻看一个旧会话而没发消息时，会觉得"显示错了"。
        ...(props.following === true
          ? [createElement("small", { key: "following", "data-sidebar-following": "true", className: CSS_CLASS.sidebarFollowing }, t("sidebar.following"))]
          : []),
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
 * 额度概览：**只显示 5 小时档 + 下次重置时间**（用户 2026-10-19 定稿）。
 *
 * 走过的弯路：先试过一行三档（5 小时 / 每周 / 每月并排），窄的时候档位名要截断、重置时间
 * 完全放不下；又试过两行（第一行 5 小时、第二行周+月）。用户最终确定只要**一档**：
 * 侧边栏是常驻的窄条，5 小时才是会被自动切换盯着的那个，其余档位去用量面板看。
 *
 * 找不到 5 小时档时（旧宿主只给无键窗口）退回「第一个能读的窗口」，别让整块空白。
 * @param props - 卡片属性。
 * @param row - 当前账号。
 * @returns 要追加的元素。
 */
function quotaRows(props: SidebarCardProps, row: AccountUsageStatus | undefined): ReactNode[] {
  const { t } = props;
  const vendor = props.status?.vendor ?? "";
  const windows = row?.quota?.windows?.length ? row.quota.windows : fallbackQuotaWindows(vendor);
  const primary = windowOfKind(windows, "five-hour") ?? windows.find((window) => window.unlimited !== true) ?? windows[0];
  if (primary === undefined) return [];
  return [
    createElement(
      "div",
      { key: "primary", "data-sidebar-row": "primary", className: CSS_CLASS.sidebarRowPrimary },
      // `wide` = 档位名与重置时间同一行 + 下面「剩余百分比 + 细条」。
      sidebarMeter(t, primary, "wide"),
    ),
  ];
}
/**
 * 一档窗口的一块读数。
 *
 * 两种密度：
 * - `wide`（第一行）：档位名 + 重置时间在一行，下面「剩余百分比 + 细条」；
 * - `compact`（第二行两列）：档位名、剩余百分比、细条三行，**不带重置时间** ——
 *   半行宽度放不下，而周/月的重置时间本来也不常看。
 *
 * 剩余百分比沿用 {@link QuotaBar} 的口径（绿色 = 还剩多少）；**缺失显示破折号**，不是 0%。
 * @param t - 取词。
 * @param window - 该档窗口。
 * @param density - 版式密度。
 * @returns 一块元素。
 */
function sidebarMeter(t: (key: string) => string, window: QuotaWindow, density: "wide" | "compact"): ReactElement {
  const meter = quotaMeter(window);
  const remaining = meter === undefined ? undefined : Math.max(0, Math.min(100, 100 - meter.percent));
  // 「不限」是端点给的事实，与「读不到」不是一回事。
  const unlimited = window.unlimited === true;
  const reading = quotaReading(window);
  const text = unlimited ? t("quota.unlimited") : remaining === undefined ? "—" : `${remaining}%`;
  const level = unlimited ? "unlimited" : remaining === undefined ? "missing" : remaining > 0 ? "ok" : "error";
  const reset = density === "wide" ? quotaResetText(t, window) : undefined;
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
      "data-sidebar-density": density,
      className: CSS_CLASS.sidebarWindow,
    },
    // 档位名 + （第一行才有的）重置时间。
    createElement(
      "div",
      { className: CSS_CLASS.sidebarWindowHead },
      createElement("span", { className: CSS_CLASS.sidebarWindowLabel }, quotaWindowLabel(t, window.key)),
      ...(reset === undefined
        ? []
        : [
            createElement(
              "small",
              { key: "reset", "data-sidebar-reset": window.resetAt ?? "unknown", className: CSS_CLASS.sidebarWindowReset },
              reset,
            ),
          ]),
    ),
    createElement("span", { className: CSS_CLASS.sidebarWindowValue }, text),
    createElement("span", { className: CSS_CLASS.sidebarWindowTrack }, bar),
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
