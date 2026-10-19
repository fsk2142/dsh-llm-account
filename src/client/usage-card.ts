/**
 * 用量卡片：**额度下方**那块统计（请求数、成功率、token、缓存命中率、两种计价）。
 *
 * 分层要求（用户原话）：
 * 1. 「每个账号只统计自己的记账周期」→ 先按账号列，每行标注它的周期；
 * 2. 「单独有一个总的记录」→ 末尾一节总账，按选中的时间窗口。
 *
 * 纯 props → 元素树：不取数、不留状态（窗口切换由容器给回调）。
 * @module dsh-llm-account/src/client/usage-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import type { AccountUsageView, UsageBucketView, UsageReportView, UsageWindowView } from "./usage-contract";
import { relativeTime } from "./time";

/**
 * UI 只认**传输类型**（`usage-contract` 里的 `*View`）。
 *
 * 为什么不直接用 `core/usage-report` 的类型：那份是宿主侧的实现形状，客户端 bundle
 * 不该为了几个字段把核心层拉进来；传输类型的可选字段（`successRate?`）也正好对应
 * 「这个数可能没有」的界面语义。
 */
export type { AccountUsageView, UsageBucketView, UsageReportView };

/** 一个可选的窗口（顺序即界面顺序）。 */
const WINDOWS: readonly { key: UsageWindowView; copy: string }[] = [
  { key: "today", copy: "usage.window.today" },
  { key: "7d", copy: "usage.window.7d" },
  { key: "30d", copy: "usage.window.30d" },
  { key: "all", copy: "usage.window.all" },
];

/** 卡片属性。 */
export interface UsageCardProps {
  t: (key: string) => string;
  /** 当前窗口。 */
  window: UsageWindowView;
  /** 每账号明细。 */
  accounts: readonly AccountUsageView[];
  /** 总账。 */
  total: UsageReportView["total"];
  /** 切换窗口。 */
  onWindow?: (window: UsageWindowView) => void;
  /** 读取失败原因（可选）。 */
  failure?: string;
  /** 还没读到（与「没有记录」区分开）。 */
  loading?: boolean;
  /** 把 ref 翻成可读的账号名（容器给；缺省原样显示）。 */
  labelOf?: (vendor: string, account: string) => string;
  /**
   * 清空台账。
   *
   * 二次确认由**容器**用 `confirm()` 做（卡片是纯组件，不自己弹窗）；不传就没有这个
   * 入口 —— 没有记录的空白页面上摆一个「清空」按钮毫无意义。
   */
  onClear?: () => void;
}

/** 千分位（数字是给人看的，别让人自己数位数）。 */
function grouped(value: number): string {
  return Math.round(value).toLocaleString();
}

/** 百分比（0–1 → 「93%」）；`undefined` → 破折号（缺失不是 0%）。 */
function percent(rate: number | undefined): string {
  return rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

/** 金额：小于 1 分也显示成 `<0.01`，不要显示成 0（那会让人以为是免费）。 */
function money(value: number | undefined, unknownText: string): string {
  if (value === undefined) return unknownText;
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** 一行「标签 …… 值」。 */
function row(key: string, label: string, value: ReactNode, attribute: string): ReactElement {
  return createElement(
    "div",
    { key, "data-usage-row": attribute, className: CSS_CLASS.usageRow },
    createElement("span", { className: CSS_CLASS.usageLabel }, label),
    createElement("span", { className: CSS_CLASS.usageValue }, value),
  );
}

/**
 * 一个桶的数值区（账号行与总账共用同一份渲染，避免两处口径分叉）。
 * @param props - 取词、桶、是否显示周期说明。
 * @returns 元素列表。
 */
function bucketRows(t: (key: string) => string, bucket: UsageBucketView): ReactElement[] {
  const rows: ReactElement[] = [
    row(
      "requests",
      t("usage.requests"),
      t("usage.requestsValue")
        .replace("{total}", grouped(bucket.requests))
        .replace("{ok}", grouped(bucket.ok))
        .replace("{failed}", grouped(bucket.failed)),
      "requests",
    ),
    row("success", t("usage.successRate"), percent(bucket.successRate), "success-rate"),
    row("cache", t("usage.cacheHitRate"), percent(bucket.cacheHitRate), "cache-hit-rate"),
    row(
      "tokens",
      t("usage.tokens"),
      `${grouped(bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens)}`,
      "tokens",
    ),
    // 明细：四个分项各占一行，避免「总量对不上」的疑问。
    row("input", t("usage.input"), grouped(bucket.inputTokens), "input"),
    row("output", t("usage.output"), grouped(bucket.outputTokens), "output"),
    row("cache-read", t("usage.cacheRead"), grouped(bucket.cacheReadTokens), "cache-read"),
    row("cache-write", t("usage.cacheWrite"), grouped(bucket.cacheWriteTokens), "cache-write"),
  ];
  // 厂商计价：没公开就照实说，不显示 $0.00。
  rows.push(
    createElement(
      "div",
      { key: "cost", "data-usage-row": "vendor-cost", className: CSS_CLASS.usageRow },
      createElement("span", { className: CSS_CLASS.usageLabel }, t("usage.vendorCost")),
      createElement(
        "span",
        { className: bucket.vendorCost === undefined ? CSS_CLASS.usageMuted : CSS_CLASS.usageValue },
        money(bucket.vendorCost, t("usage.priceUnknown")),
      ),
    ),
    // 官方价折算：**小字**跟在厂商价后面（用户要求「出个小字约等于官方多少价值」）。
    createElement(
      "div",
      { key: "official", "data-usage-row": "official-cost", className: CSS_CLASS.usageRow },
      createElement("span", { className: CSS_CLASS.usageLabel }, ""),
      createElement(
        "small",
        { "data-usage-official": bucket.officialCost ?? "unknown", className: CSS_CLASS.usageHint },
        `${t("usage.officialCost")} ${money(bucket.officialCost, "—")}`,
      ),
    ),
  );
  return rows;
}

/**
 * 用量卡片。
 * @param props - 见 {@link UsageCardProps}。
 * @returns 元素树。
 */
export function UsageCard(props: UsageCardProps): ReactElement {
  const { t, accounts, total } = props;
  const labelOf = props.labelOf ?? ((_vendor: string, account: string): string => account);

  /** 窗口按钮（含选中态）。抽成数组，好在同一个动作组里和「清空」并排。 */
  const windowButtons: ReactElement[] = WINDOWS.map((entry) =>
    createElement(
      "button",
      {
        key: entry.key,
        type: "button",
        "data-usage-window": entry.key,
        "aria-pressed": props.window === entry.key,
        className:
          props.window === entry.key
            ? `${CSS_CLASS.buttonGhost} ${CSS_CLASS.usageWindowActive}`
            : CSS_CLASS.buttonGhost,
        onClick: () => props.onWindow?.(entry.key),
      },
      t(entry.copy),
    ),
  );

  const header = createElement(
    "header",
    { className: CSS_CLASS.usageHead },
    createElement("h2", null, t("usage.title")),
    createElement(
      "div",
      { "data-usage-windows": "true", className: CSS_CLASS.usageWindows },
      ...windowButtons,
      // 「清空」只在确实有记录、且容器给了动作时渲染。
      ...(props.onClear === undefined || total.bucket.requests === 0
        ? []
        : [
            createElement(
              "button",
              {
                key: "clear",
                type: "button",
                "data-usage-clear": "true",
                className: CSS_CLASS.buttonGhost,
                onClick: () => props.onClear?.(),
              },
              t("usage.clear"),
            ),
          ]),
    ),
  );

  // 失败的提示优先（「读不到」与「没有数据」是两件事）。
  const failure =
    props.failure === undefined
      ? null
      : createElement(
          "p",
          { "data-usage-failure": "true", className: CSS_CLASS.failure },
          `${t("usage.readFailed")}：${props.failure}`,
        );

  const loading = props.loading === true ? createElement("p", { className: CSS_CLASS.note }, t("usage.loading")) : null;

  // 每账号一节：标题是账号名，副标题是它的记账周期。
  const perAccount = accounts.map((entry) =>
    createElement(
      "section",
      {
        key: `${entry.vendor}\u0000${entry.account}`,
        "data-usage-account": entry.account,
        "data-usage-vendor": entry.vendor,
        className: CSS_CLASS.usageBlock,
      },
      createElement(
        "div",
        { className: CSS_CLASS.usageAccountHead },
        createElement("strong", null, labelOf(entry.vendor, entry.account)),
        createElement(
          "small",
          { "data-usage-period": entry.period.key, "data-usage-period-source": entry.period.fromResetAt ? "vendor" : "estimated", className: CSS_CLASS.usageMuted },
          `${t("usage.period")} · ${entry.period.fromResetAt ? t("usage.periodFromVendor") : t("usage.periodEstimated").replace("{kind}", t(`usage.kind.${entry.period.kind}`))}`,
        ),
      ),
      ...bucketRows(t, entry.bucket),
      // 厂商权威金额：额度端点按美元记账时直接给出「本周期花了多少」，
      // 比 token×单价反推更准。缺失（额度读不到 / 只给百分比）时整行不画。
      ...(entry.spent === undefined
        ? []
        : [
            row(
              "spent",
              t("usage.spent"),
              `$${entry.spent.toFixed(2)}`,
              "spent",
            ),
          ]),
    ),
  );

  // 总账一节（放在最后，与账号分隔开）。
  const totalSection = createElement(
    "section",
    { "data-usage-total": "true", className: CSS_CLASS.usageBlock },
    createElement(
      "div",
      { className: CSS_CLASS.usageAccountHead },
      createElement("strong", null, t("usage.total")),
    ),
    ...bucketRows(t, total.bucket),
    ...props.total.lastAt === undefined
      ? []
      : [
          row(
            "last",
            t("usage.lastAt"),
            createElement("time", { "data-usage-last-at": props.total.lastAt, dateTime: new Date(props.total.lastAt).toISOString() }, relativeTime(t, props.total.lastAt)),
            "last-at",
          ),
        ],
    // 按厂商拆分：每家一行「名字 · 请求数 · 官方折算」。只在有多家时才画 ——
    // 只有一家时这行与上面完全重复，纯噪音。
    ...(total.byVendor.length <= 1
      ? []
      : [
          createElement(
            "div",
            { key: "by-vendor", "data-usage-by-vendor": "true", className: CSS_CLASS.usageSplit },
            ...total.byVendor.map((entry) =>
              createElement(
                "span",
                { key: entry.vendor, "data-usage-vendor-row": entry.vendor, className: CSS_CLASS.usageHint },
                `${entry.vendor} · ${grouped(entry.bucket.requests)} 次 · ${percent(entry.bucket.cacheHitRate)}`,
              ),
            ),
          ),
        ]),
  );

  const empty =
    accounts.length === 0 && total.bucket.requests === 0 && props.loading !== true && props.failure === undefined
      ? createElement("p", { "data-usage-empty": "true", className: CSS_CLASS.note }, t("usage.empty"))
      : null;

  return createElement(
    "section",
    { "data-card": "usage", className: CSS_CLASS.card },
    header,
    failure,
    loading,
    empty,
    accounts.length === 0
      ? null
      : createElement(
          "div",
          { className: CSS_CLASS.usageGroup },
          createElement("h3", null, t("usage.perAccount")),
          ...perAccount,
        ),
    total.bucket.requests === 0 && accounts.length > 0 ? null : totalSection,
  );
}

/**
 * 账号行的周期剩余时间文案（用在账号卡片的额度区下方）。
 * @param t - 取词。
 * @param end - 周期终点（epoch 毫秒）。
 * @param now - 现在。
 * @returns 文案；没有终点时为 `undefined`。
 */
export function periodRemainingText(t: (key: string) => string, end: number | undefined, now: number): string | undefined {
  if (end === undefined) return undefined;
  const remaining = end - now;
  if (remaining <= 0) return undefined;
  return `${t("usage.remaining")} ${relativeTime(t, now + remaining)}`;
}
