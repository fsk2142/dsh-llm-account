/**
 * 中栏仪表盘（Task 9）：逐账号列出额度与状态、生效账号高亮。
 *
 * 规格 §8.1 第 5 条：「点开中栏仪表盘：逐账号列出额度、状态、拒绝/冷却与切换记录；生效账号
 * 高亮」。**切换记录一栏已按用户要求移除**（2026-10-18）—— 记录只说明过去发生过什么，用户
 * 要的是「现在哪张卡还有额度」；宿主侧的记录本身仍在（`switches()` 远程方法未动）。
 *
 * 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态、不发起请求。
 *
 * 视觉（2026-10-17 重做，2026-10-18 平铺）：标题行带刷新/关闭两个图标按钮；每个账号是一张卡片
 * （生效账号的描边用强调色），卡片内是「身份行 + 标记 + 额度表」。
 *
 * **账号平铺不按厂商分组**（2026-10-18 用户要求）：用户要看的是「这台机器上有哪些账号、
 * 各自多少额度」，按厂商分组会让同一个列表出现两个标题、两个区块；供应商是账号的一个属性，
 * 所以它是账号名后面的一个徽标，不是一个分组标题。
 * @module dsh-llm-account/src/client/dashboard
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import { rejectionText } from "./copy";
import { failureText } from "./failure-text";
import { CloseIcon, RefreshIcon } from "./icons";
import { QuotaBar } from "./quota-bar";
import { fallbackQuotaWindows, quotaPlanText } from "./quota";
import type { AccountUsageStatus, QuotaWindow, VendorUsageStatus } from "./usage-contract";

/** 仪表盘属性。 */
export interface DashboardProps {
  t: (key: string) => string;
  /** 状态；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /** 多供应商视图；缺省时按单 status 渲染（兼容既有调用）。 */
  vendors?: readonly { label: string; status?: VendorUsageStatus; vendor?: string }[];
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
  /**
   * 每账号的用量块（容器按 `vendor + ref` 提供）。
   *
   * 用户 2026-10-19：「还有一点就是用量面板中还没有这个统计」—— 设置页的账号行有了，
   * 中栏这个面板也必须一致（同一份数据、同一份渲染），否则打开面板看到的是两套东西。
   * 返回 `undefined` 表示这一行暂时没有读数（不占位）。
   */
  usageOf?: (vendor: string, ref: string) => ReactNode;
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
    ...(status === undefined && props.vendors === undefined
      ? [
          // 没有数据时：失败说失败，什么都不曾说才说「暂无数据」。
          failure === undefined
            ? createElement("p", { key: "nodata", "data-dashboard-empty": "true", className: CSS_CLASS.empty }, t("dashboard.noData"))
            : createElement("p", { key: "nodata-failed", "data-dashboard-empty": "true", className: CSS_CLASS.empty }, t("usage.failed")),
        ]
      : [
          createElement("h3", { key: "accounts-title" }, t("dashboard.accounts")),
          // **平铺**：所有厂商的账号在一份列表里，供应商是账号名后的徽标而不是分组标题
          // （2026-10-18 用户要求）。单 status 的旧调用路径同样走这里。
          ...accountEntries(props).map((entry) =>
            accountBlock(props, entry.account, entry.status, entry.label, entry.vendor),
          ),
          ...vendorFailureNotes(props),
        ]),
  );
}

/** 平铺列表的一条：账号 + 它所属厂商的状态与标签。 */
interface AccountEntry {
  account: AccountUsageStatus;
  status: VendorUsageStatus | undefined;
  label: string;
  /** 该账号所属厂商的 id（用量块按它 + ref 取读数）。 */
  vendor: string;
}

/**
 * 把所有厂商的账号收成一份平铺列表（厂商声明顺序即展示顺序）。
 *
 * 与旧的「一家一个 section」的区别不只是少一个标题：固定标注与缺额度时的兜底窗口都按
 * **账号自己所属厂商**的状态算，第二家的账号不会画错窗口形状（2026-10-18 修）。
 */
function accountEntries(props: DashboardProps): AccountEntry[] {
  const entries: AccountEntry[] = [];
  const collect = (vendor: string, label: string, vendorStatus: VendorUsageStatus | undefined): void => {
    for (const account of vendorStatus?.accounts ?? []) {
      // 线上 `accounts` 可能含渲染不了的行（null / 非对象）：结构校验只查「是不是数组」，
      // 渲染路径必须自己挑出能画的行 —— 一行画不了不该让整块仪表盘崩。
      if (typeof account !== "object" || account === null) continue;
      entries.push({ account, status: vendorStatus, label, vendor });
    }
  };
  if (props.vendors === undefined) collect(props.status?.vendor ?? "", "", props.status);
  else for (const vendor of props.vendors) collect(vendor.vendor ?? vendor.status?.vendor ?? "", vendor.label, vendor.status);
  return entries;
}

/**
 * 厂商级失败项（`status.failures`，如某账号额度读取超时）。
 *
 * 逐条翻成人话（`failureText`：端点短名、包装过的超时诊断），原文留在 `data-failure-detail`
 * 上供排查 ——
 * 把 `timeout after 30000ms` 这种原文直接印在界面上就是调试输出。非超时失败同样映射：
 * 宿主侧现在用账号**名称**记失败（`quota: commandcode "工作账号" read failed (…)`），
 * 可读，所以原样显示。
 */
function vendorFailureNotes(props: DashboardProps): ReactNode[] {
  const { t } = props;
  const failures = props.vendors === undefined ? (props.status?.failures ?? []) : props.vendors.flatMap((vendor) => vendor.status?.failures ?? []);
  if (failures.length === 0) return [];
  return [
    createElement(
      "div",
      { key: "failures", "data-dashboard-failures": "true" },
      ...failures.map((item, index) =>
        createElement(
          "p",
          {
            key: index,
            "data-failure": index,
            "data-failure-detail": item,
            className: CSS_CLASS.failure,
          },
          failureText(t, item),
        ),
      ),
    ),
  ];
}

/** 一个账号的区块：名称、状态、固定/生效标注、拒绝、逐窗口额度。
 *
 * `status` 是**这个账号所属厂商**的状态（多厂商视图里各家不同）：固定标注与缺额度时的
 * 兜底窗口都必须按它算。旧实现用 `props.status`（第一个厂商的），第二家的账号会画错
 * 窗口形状、固定标注也可能张冠李戴（2026-10-18 修）。
 *
 * `label` 是供应商标签：平铺列表里它渲染成账号名后面的徽标（供应商是账号的属性，
 * 不是一个分组标题 —— 2026-10-18 用户要求）。单厂商旧调用路径传空串，不渲染徽标。
 */
function accountBlock(
  props: DashboardProps,
  account: AccountUsageStatus,
  status: VendorUsageStatus | undefined = props.status,
  label = "",
  vendor = props.status?.vendor ?? "",
): ReactNode {
  const { t } = props;
  const effective = account.effective;
  // 「当前使用」= 这家供应商此刻在服务的账号，**每家只有一个**：有生效账号就标生效的那个
  // （自动轮换后的真实服务者），没有生效账号时才退回「设置里选中的那个」。
  // 以前这里还画一个「已指定」（pinned），两个徽标说的是同一件事，用户看到的却是「每个
  // 账户都写着已指定」—— 语义收拢成一个。
  const serving = (status?.accounts ?? []).some(
    (candidate) => typeof candidate === "object" && candidate !== null && candidate.effective === true,
  );
  const current = serving ? effective : account.active === true;
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
      ...(label === "" ? {} : { "data-dashboard-vendor": label }),
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
            // 供应商徽标：与设置页账户行的 `data-account-vendor` 同一条语义、同一个类。
            ...(label === ""
              ? []
              : [createElement("small", { key: "vendor", "data-account-vendor": label, className: CSS_CLASS.vendorBadge }, label)]),
            ...(current
              ? [
                  createElement(
                    "span",
                    { key: "current", "data-dashboard-current": account.ref, className: CSS_CLASS.mark },
                    t("account.effectiveBy"),
                  ),
                ]
              : []),
          ),
          createElement("small", { key: "configured" }, account.configured ? t("account.configured") : t("account.missing")),
          // 订阅套餐：厂商报告了订阅才有这一行（与设置页账户卡片同一形状、同一份文案）。
          ...(() => {
            const plan = quotaOf?.plan;
            if (plan === undefined) return [];
            const text = quotaPlanText(t, plan);
            if (text === undefined) return [];
            return [createElement("small", { key: "plan", "data-dashboard-plan": plan.id, className: CSS_CLASS.note }, text)];
          })(),
        ),
      ),
    ),
    ...(rejectionOf === undefined
      ? []
      : [createElement("p", { key: "rejection", "data-dashboard-rejection-label": rejectionOf.kind, className: CSS_CLASS.rejection }, rejectionText(t, rejectionOf.kind))]),
    // 该账号额度读取里的**部分失败**照样列出来：不列就等于把一次不完整的读数呈现成完整的。
    // 文案翻成人话（端点短名不再直接上屏），原文留在 data 属性里，与厂商级失败项同一条纪律。
    ...(quotaOf?.failures ?? []).map((item, index) =>
      createElement(
        "small",
        { key: `qf-${index}`, "data-dashboard-account-failure": `${account.ref}:${index}`, "data-failure-detail": item, className: CSS_CLASS.failure },
        failureText(t, item),
      ),
    ),
    createElement(
      "div",
      { key: "meters", className: CSS_CLASS.meters },
      ...(quotaOf?.windows?.length ? quotaOf.windows : fallbackQuotaWindows(status?.vendor ?? "")).map((window) =>
        windowBlock(t, window),
      ),
    ),
    // 该账号的用量：与设置页账号行**同一份渲染**（`AccountUsageBlock`），紧贴额度条下方。
    // 用户 2026-10-19：「用量面板中还没有这个统计」—— 两个界面给同一份数据，不该只做一个。
    props.usageOf?.(vendor, account.ref) ?? null,
  );
}

/** 一个额度窗口（条形）。 */
function windowBlock(t: (key: string) => string, window: QuotaWindow): ReactNode {
  return createElement(
    "div",
    { key: window.key, "data-dashboard-window": window.key },
    QuotaBar({ t, window }),
  );
}

