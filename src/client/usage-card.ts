/**
 * 账号用量区块：**长在账号自己下面**的那一小块统计。
 *
 * 两次要求叠出来的形状（用户原话）：
 * 1. 「每个账号只统计自己的记账周期」→ 每个账号按**它自己的账期**聚合，不跟着页面上的时间窗口走；
 * 2. 「只在每个账号下面统计本身的用量」→ 页面上**没有**一张跨账号的大卡片了。额度是「还剩多少」，
 *    用量是「用了多少」，同一账号的两面贴在一起读才对得上。
 *
 * 版式对齐用户给的参考图：一行标题（「用量」+ 账期区间 + 口径来源），下面四个指标块
 * （请求 / 成功率 / 花费 / Token），每个块带一行小字补充（成功失败数、官方价折算、入/出 token）。
 * 缓存命中率与最近一次请求不占指标位，收在脚下那一行 —— 它们是核对用的，不该跟结论抢版面。
 *
 * 纯 props → 元素树：不取数、不留状态、不设定时器。
 * @module dsh-llm-account/src/client/usage-card
 */
import { createElement, type ReactElement } from "react";

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
export type { AccountUsageView, UsageBucketView, UsageReportView, UsageWindowView };

/** 一个数值字段是否可信（线上可能是 null / 字符串 / NaN）。 */
function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 紧凑数字（`4600` → `4.6K`，`2_100_000_000` → `2.1B`）。
 *
 * 为什么不像以前那样只加千分位：账号卡片一行里要塞四个数，`4,600` 与 `2,100,000,000`
 * 长度差三倍，标题会被最长的那一个撑开；参考图用的就是 K/M/B。
 * @param value - 数值；缺失或非有限值时给破折号（**不是 0**）。
 * @returns 可读的紧凑文本。
 */
function compact(value: number | undefined): string {
  if (value === undefined) return "—";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  if (magnitude < 1_000) return `${sign}${Math.round(magnitude)}`;
  const units: readonly (readonly [string, number])[] = [
    ["B", 1_000_000_000],
    ["M", 1_000_000],
    ["K", 1_000],
  ];
  for (const [suffix, size] of units) {
    if (magnitude < size) continue;
    // 一位小数就够读；整数倍不留 `.0`（`4.0M` 看起来像有精度的假数字）。
    const scaled = Math.round((magnitude / size) * 10) / 10;
    return `${sign}${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
  }
  return `${sign}${Math.round(magnitude)}`;
}

/** 百分比（0–1 → 「93%」）；`undefined` → 破折号（缺失不是 0%）。 */
function percent(rate: number | undefined): string {
  if (rate === undefined) return "—";
  return `${Math.round(rate * 100)}%`;
}

/** 金额：小于 1 分也显示成 `<0.01`，不要显示成 0（那会让人以为是免费）。 */
function money(value: number | undefined, unknownText: string): string {
  if (value === undefined) return unknownText;
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** 账期端点 → `2026/10/14`（本地时区；账期本来就是按用户本地日历算的）。 */
function dateText(at: number | undefined): string | undefined {
  if (at === undefined || at <= 0) return undefined;
  const date = new Date(at);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 账期区间文案（`2026/10/14 – 2026/11/14`）。
 *
 * 端点缺失时只写起点（`自 2026/10/14`）：`end` 缺失表示厂商没说什么时候重置，
 * 编一个终点比不写更糟。两个都没有就不画这一行。
 * @param t - 取词。
 * @param start - 账期起点（epoch 毫秒）。
 * @param end - 账期终点（epoch 毫秒，可缺）。
 * @returns 文案；没有可用端点时为 `undefined`。
 */
export function periodRangeText(t: (key: string) => string, start: unknown, end: unknown): string | undefined {
  const from = dateText(finite(start));
  const to = dateText(finite(end));
  if (from !== undefined && to !== undefined) return t("usage.periodRange").replace("{from}", from).replace("{to}", to);
  if (from !== undefined) return t("usage.periodFrom").replace("{from}", from);
  return undefined;
}

/** 成功率/命中率的健康色：好→绿、一般→黄、缺失→灰。 */
function rateTone(rate: number | undefined): "ok" | "warn" | "muted" {
  if (rate === undefined) return "muted";
  if (rate >= 0.9) return "ok";
  return "warn";
}

/**
 * 一张**指标块**：大数字 + 标签 + 一行小字补充。
 *
 * 结构对参考图：数字在上、标签在中、补充说明在下，四块等宽横排（窄容器自动折行）。
 * @param props - 取词与数值。
 * @returns 指标块。
 */
function metric(props: {
  key: string;
  label: string;
  value: string;
  attribute: string;
  hint?: string | undefined;
  tone?: "plain" | "ok" | "warn" | "muted";
  /** 额外的 data 属性（例如权威金额原值）。 */
  data?: Record<string, string | number>;
}): ReactElement {
  return createElement(
    "div",
    {
      key: props.key,
      "data-usage-metric": props.attribute,
      "data-tone": props.tone ?? "plain",
      className: CSS_CLASS.usageMetric,
      ...props.data,
    },
    createElement("span", { className: CSS_CLASS.usageMetricValue }, props.value),
    createElement("span", { className: CSS_CLASS.usageMetricLabel }, props.label),
    // 没有补充的小字就**不留空行**：空 `small` 会让四块高度不齐，看着像渲染坏了。
    ...(props.hint === undefined
      ? []
      : [createElement("small", { key: "hint", className: CSS_CLASS.usageMetricHint }, props.hint)]),
  );
}

/** 脚下那一行的一小项（`缓存命中率 75%`）。 */
function footItem(key: string, text: string, attribute: string, extra?: Record<string, string | number>): ReactElement {
  return createElement(
    "span",
    { key, "data-usage-foot": attribute, className: CSS_CLASS.usageHint, ...extra },
    text,
  );
}

/**
 * 一个账号的用量区块。
 *
 * 渲染层**绝不因为一条数据形状不对就抛**：一抛就是整棵子树被丢弃，表现为「刷新用量统计时
 * 整块内容消失」（2026-10-19 报障）。边界校验器（`usage-contract`）已挡掉大部分坏行，
 * 这里再兜住残留 —— 每个字段都过 {@link finite}，缺失一律显示破折号。
 * @param props - 取词、账号用量、可选的账号名（只用于无障碍标签）。
 * @returns 区块元素。
 */
export function AccountUsageBlock(props: {
  t: (key: string) => string;
  entry: AccountUsageView;
  /** 账号名；账号卡片里名字就在上面，所以只挂到 `aria-label`，不重复上图。 */
  label?: string;
  /** 「现在」（测试注入；缺省 `Date.now()`）。 */
  now?: number;
}): ReactElement {
  const { t, entry } = props;
  const period = entry.period ?? ({} as AccountUsageView["period"]);
  const fromVendor = period.fromResetAt === true;
  const kind = typeof period.kind === "string" ? period.kind : "month";
  // 词典里没有这个粒度（宿主新增了一种周期）时退回「月」：宁可说错粒度，也不要把
  // `usage.kind.whatever` 这个键名直接印到界面上。
  const kindKey = `usage.kind.${kind}`;
  const kindText = t(kindKey) === kindKey ? t("usage.kind.month") : t(kindKey);
  const sourceText = fromVendor
    ? t("usage.periodFromVendor")
    : t("usage.periodEstimated").replace("{kind}", kindText);

  const bucket = entry.bucket ?? ({} as UsageBucketView);
  const requests = finite(bucket.requests);
  const ok = finite(bucket.ok);
  const failed = finite(bucket.failed);
  const input = finite(bucket.inputTokens);
  const output = finite(bucket.outputTokens);
  const cacheRead = finite(bucket.cacheReadTokens);
  const cacheWrite = finite(bucket.cacheWriteTokens);
  const successRate = finite(bucket.successRate);
  const cacheHitRate = finite(bucket.cacheHitRate);
  const officialCost = finite(bucket.officialCost);
  const vendorCost = finite(bucket.vendorCost);
  const spent = finite(entry.spent);
  const lastAt = finite(entry.lastAt);

  // 总 token：四个分项相加。任一分项缺失都还是能加（缺失按 0），但**全部**缺失就是没有数据。
  const tokenParts = [input, output, cacheRead, cacheWrite];
  const tokens = tokenParts.every((part) => part === undefined)
    ? undefined
    : tokenParts.reduce<number>((sum, part) => sum + (part ?? 0), 0);

  // 花费：厂商按美元记账的权威金额优先；没有它才退回「token × 厂商单价」。
  // 两者都没有就是「未公开」——不写 $0.00，那会让人以为免费。
  const cost = spent ?? vendorCost;
  // 原值留在 data 属性上供排查/测试（`data-usage-spent` = 厂商权威口径，
  // `data-usage-official` = 官方价折算），界面上只显示格式化后的金额。
  const costData: Record<string, string | number> = {};
  if (spent !== undefined) costData["data-usage-spent"] = spent;
  if (officialCost !== undefined) costData["data-usage-official"] = officialCost;

  const head = createElement(
    "div",
    { className: CSS_CLASS.usageHead },
    createElement("span", { className: CSS_CLASS.usageTitle }, t("usage.title")),
    ...(() => {
      const range = periodRangeText(t, period.start, period.end);
      if (range === undefined) return [];
      return [
        createElement(
          "small",
          {
            key: "period",
            "data-usage-period": period.key,
            "data-usage-period-source": fromVendor ? "vendor" : "estimated",
            className: CSS_CLASS.usagePeriod,
          },
          range,
        ),
        createElement("small", { key: "source", className: CSS_CLASS.usageMuted }, sourceText),
      ];
    })(),
  );

  const metrics = createElement(
    "div",
    { "data-usage-metrics": "true", className: CSS_CLASS.usageMetrics },
    metric({
      key: "requests",
      attribute: "requests",
      label: t("usage.requests"),
      value: compact(requests),
      // 参考图的口径：总数在上，成功/失败在下。
      ...(ok === undefined && failed === undefined
        ? {}
        : { hint: `${compact(ok)} ${t("usage.okShort")} / ${compact(failed)} ${t("usage.failedShort")}` }),
    }),
    metric({
      key: "success",
      attribute: "success-rate",
      label: t("usage.successRate"),
      value: percent(successRate),
      tone: rateTone(successRate),
    }),
    metric({
      key: "cost",
      attribute: "cost",
      label: t("usage.cost"),
      value: money(cost, t("usage.priceUnknown")),
      tone: cost === undefined ? "muted" : "plain",
      // 官方价折算跟在金额下面（用户要求「出个小字约等于官方多少」）。
      ...(officialCost === undefined ? {} : { hint: `${t("usage.officialShort")} ≈ ${money(officialCost, "—")}` }),
      data: costData,
    }),
    metric({
      key: "tokens",
      attribute: "tokens",
      label: t("usage.tokens"),
      value: compact(tokens),
      ...(input === undefined && output === undefined
        ? {}
        : { hint: `${compact(input)} ${t("usage.inputShort")} / ${compact(output)} ${t("usage.outputShort")}` }),
    }),
  );

  // 脚下那一行：核对用的数（命中率、缓存读写、最近一次请求），有哪个画哪个。
  const foot: ReactElement[] = [];
  if (cacheHitRate !== undefined) {
    foot.push(footItem("hit", `${t("usage.cacheHitRate")} ${percent(cacheHitRate)}`, "cache-hit-rate"));
  }
  if (cacheRead !== undefined || cacheWrite !== undefined) {
    foot.push(
      footItem(
        "cache",
        `${t("usage.cacheRead")} ${compact(cacheRead)} · ${t("usage.cacheWrite")} ${compact(cacheWrite)}`,
        "cache-tokens",
      ),
    );
  }
  if (lastAt !== undefined) {
    foot.push(
      footItem(
        "last",
        `${t("usage.lastAt")} ${relativeTime(t, lastAt, props.now)}`,
        "last-at",
        { "data-usage-last-at": lastAt },
      ),
    );
  }

  return createElement(
    "section",
    {
      // key 只在数组上下文里需要；这里也留住，方便调用方把块塞进列表。
      "data-usage-account": typeof entry.account === "string" ? entry.account : undefined,
      "data-usage-vendor": typeof entry.vendor === "string" ? entry.vendor : undefined,
      "aria-label": props.label,
      className: CSS_CLASS.usageSection,
    },
    head,
    metrics,
    ...(foot.length === 0 ? [] : [createElement("div", { key: "foot", className: CSS_CLASS.usageFoot }, ...foot)]),
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
