/**
 * 额度读数到界面文案的**唯一**一份实现（账户卡片、侧边栏卡片、仪表盘共用）。
 *
 * 为什么单独成模块：同一件事（「缺失」与「真的是 0」必须区分开）写三遍，迟早有一处写错。
 * 这里只有纯函数，没有 React、没有厂商知识。
 * @module dsh-llm-account/src/client/quota
 */
import type { QuotaPlanSummary, QuotaUnit, QuotaWindow } from "./usage-contract";

/** 一个窗口的读数形状：决定用哪种写法呈现。 */
export type QuotaShape = "used-cap" | "percent" | "used" | "cap" | "unlimited" | "missing";

/**
 * 读数里的数字：最多两位小数，整数的尾巴不留 0。
 *
 * 线上给的是原始浮点（`70.06581737679998`、`5.0011194891`、`0.30000000000000004`），
 * 直接上屏既长又像调试输出，还会把「标签 …… 数值」那一行撑开。额度是展示口径，
 * 两位小数足够 —— 数字本身仍然原样保留在状态与 `data-*` 属性里，只是不这样印出来。
 * @param value - 原始数值。
 * @returns 展示用文本。
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/**
 * 一个额度数字的上屏写法：厂商给了单位就按单位排版，没给就按裸数字。
 *
 * `usd` = `$` + 两位小数（旧插件 `formatMoney` 第 1516 行的同一口径：`$7.22`、
 * `$0.12 / $3.00`）。这是**显示**口径，原始浮点仍在状态与 `data-*` 属性里。
 * @param value - 原始数值。
 * @param unit - 厂商给的单位；缺省表示没给。
 * @returns 展示用文本。
 */
function quotaAmount(value: number, unit: QuotaUnit | undefined): string {
  if (unit === "usd") return `$${value.toFixed(2)}`;
  return formatNumber(value);
}

/**
 * 判断一个窗口能拿什么数来写。
 *
 * 顺序固定：`used`+`cap` 齐 → `percent` → 只有 `used` → 什么都没有。
 * **不补 0**：缺失就是缺失。
 * @param window - 归一化后的额度窗口。
 * @returns 形状标记。
 */
export function quotaShape(window: QuotaWindow): QuotaShape {
  return quotaReading(window).shape;
}

/** 一个窗口「能怎么读」：形状 + 已经收窄的数值（判别联合，读的时候不必再断言）。 */
export type QuotaReading =
  | { shape: "used-cap"; used: number; cap: number }
  | { shape: "percent"; percent: number }
  | { shape: "used"; used: number }
  | { shape: "cap"; cap: number }
  | { shape: "unlimited" }
  | { shape: "missing" };

/**
 * 把窗口读成「形状 + 可用的数值」——**这里是那个固定顺序的唯一一份实现**。
 *
 * `quotaShape` 与 `quotaWindowText` 都从这里取，避免两处各写一遍 `if (used !== undefined…)`
 * 而先后顺序悄悄分叉（症状会是「条画了、字没写」这种没人看得懂的东西）。
 * @param window - 归一化后的额度窗口。
 * @returns 判别联合。
 */
export function quotaReading(window: QuotaWindow): QuotaReading {
  // 「厂商明说不限」优先于任何数字：它是端点给出的事实（`limited: false`），不是从字段推出来的。
  if (window.unlimited === true) return { shape: "unlimited" };
  const { used, cap, percent } = window;
  if (used !== undefined && cap !== undefined) return { shape: "used-cap", used, cap };
  if (percent !== undefined) return { shape: "percent", percent };
  if (used !== undefined) return { shape: "used", used };
  // 只有上限：厂商公布了额度配给、但用量读不到。这种读数照样有价值（用户问的正是
  // 「额度是多少」），不能当缺数据丢掉。
  //
  // 注：Open Design 曾走过这条分支（本地补一个月度窗口、只填 cap）；2026-10-23 那个
  // 合成窗口已移除。这条分支现在服务的是 Command Code 那种「有配给表、余额读不到」的情形。
  if (cap !== undefined) return { shape: "cap", cap };
  return { shape: "missing" };
}

/**
 * 额度窗口的中文名称。
 * @param t - 取词函数。
 * @param key - 厂商窗口键。
 * @returns 可读名称；未知键原样返回。
 */
export function quotaWindowLabel(t: (key: string) => string, key: string): string {
  switch (key) {
    case "fiveHour":
    case "5h":
      return t("quota.window.fiveHour");
    case "rolling":
      return t("quota.window.rolling");
    case "daily":
    case "day":
      return t("quota.window.daily");
    case "weekly":
    case "week":
      return t("quota.window.weekly");
    case "monthly":
    case "month":
      return t("quota.window.monthly");
    case "monthlyCredits":
      return t("quota.window.monthlyCredits");
    case "plan":
      return t("quota.window.plan");
    case "":
      return t("quota.window.unknown");
    default:
      return key;
  }
}

/**
 * 一个窗口的读数文案。
 * @param t - 取词函数（缺失时要用到 `account.quotaMissing`）。
 * @param window - 额度窗口。
 * @returns 人类可读的读数；什么都没有时为「暂无额度数据」。
 */
export function quotaWindowText(t: (key: string) => string, window: QuotaWindow): string {
  const reading = quotaReading(window);
  // 本机口径的读数必须自带标注：同一个 `$` 符号既可能是厂商说的（含所有设备），也可能是
  // 本机台账折合的（只有这台机器）。不标出来，用户跟厂商后台对账必然对不上
  // （2026-10-19 用户直接问了这一点）。
  const suffix = window.usedSource === "local" ? `（${t("usage.localOnly")}）` : "";
  switch (reading.shape) {
    case "used-cap":
      return (
        t("quota.usedOf")
          .replace("{used}", quotaAmount(reading.used, window.unit))
          .replace("{cap}", quotaAmount(reading.cap, window.unit)) + suffix
      );
    case "percent":
      return t("quota.usedPercent").replace("{percent}", formatNumber(reading.percent)) + suffix;
    case "used":
      return t("quota.used").replace("{used}", quotaAmount(reading.used, window.unit)) + suffix;
    case "cap":
      return t("quota.capOnly").replace("{cap}", quotaAmount(reading.cap, window.unit));
    case "unlimited":
      return t("quota.unlimited");
    case "missing":
      return t("account.quotaMissing");
  }
}

/**
 * 侧边栏只显示**一个**窗口：小时级的那个（5 小时 / 滚动小时）。
 *
 * 存在的理由：侧边栏槽位窄，每窗口一条 QuotaBar（标签 + 百分比 + 条 + 读数 + 重置五行
 * 结构）排三条就把整块侧边栏撑满，而用户真正盯的是最短的那个窗口（额度打满会被自动
 * 切走）。厂商窗口键写得不一致（`5h` / `fiveHour` / opencode 的 `rolling` 都是小时级），
 * 这里统一认这三样。
 *
 * 兜底顺序：小时级窗口 → 第一窗口 → 厂商空窗列表的第一项。一个都不给时返回
 * `undefined`（调用方画空态，不补 0）。
 *
 * 「不限」窗口不参与挑选：它不是读数（侧边栏只有一行，显示「月度额度 · 已用 62.21」比
 * 「5 小时 · 不限」有用 —— 后者每家都有、永远不变）。
 * @param windows - 归一化后的额度窗口。
 * @param vendor - 厂商 id（仅用于兜底空窗列表）。
 * @returns 要在侧边栏显示的那一个窗口。
 */
export function primaryQuotaWindow(windows: readonly QuotaWindow[], vendor: string): QuotaWindow | undefined {
  const readable = windows.filter((window) => window.unlimited !== true);
  const hourly = readable.find((window) => window.key === "fiveHour" || window.key === "5h" || window.key === "rolling");
  return hourly ?? readable[0] ?? windows[0] ?? fallbackQuotaWindows(vendor)[0];
}

/**
 * 额度读数还没回来时，先按厂商的窗口形状画空进度条。
 *
 * 只给窗口名，不给数值：空条 +「暂无额度数据」，既保持版面一致，也不把未知写成 0。
 * @param vendor - 厂商 id。
 * @returns 该厂商常规的窗口列表。
 */
export function fallbackQuotaWindows(vendor: string): QuotaWindow[] {
  if (vendor.includes("opencode")) return [{ key: "rolling" }, { key: "weekly" }, { key: "monthly" }];
  if (vendor.includes("command")) return [{ key: "5h" }, { key: "weekly" }, { key: "monthlyCredits" }];
  return [{ key: "" }];
}

/**
 * 额度窗口的重置时间文案（本地时间；今天/明天用相对日）。
 *
 * **估算值要带「约」**（2026-10-20）：5 小时/周的重置时间是按「`used` 首次变正 + 窗口长度」
 * 推算的，不是厂商给的。四条返回路径都必须带上这个前缀 —— 只在其中一条加会让同一个时刻
 * 在不同界面上看起来可信度不同。
 * @param t - 取词函数。
 * @param window - 额度窗口。
 * @returns 文案；没有 resetAt 时为 `undefined`。
 */
export function quotaResetText(t: (key: string) => string, window: QuotaWindow): string | undefined {
  const at = window.resetAt;
  if (at === undefined || !Number.isFinite(at) || at <= 0) return undefined;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const approximate = window.resetEstimated === true ? t("quota.estimatedPrefix") : "";
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return approximate + t("quota.resetToday").replace("{time}", time);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();
  if (isTomorrow) return approximate + t("quota.resetTomorrow").replace("{time}", time);
  const day = date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
  return approximate + t("quota.resetAtLong").replace("{date}", day).replace("{time}", time);
}

/**
 * 重置时刻的**日期**文案（侧边栏用）：`10-19 20:00`。
 *
 * 为什么与 {@link quotaResetText} 分开：那个用「今天 / 明天」这种相对说法（设置页与账号
 * 卡片里读起来自然），但侧边栏两行上下并排时，「明天 20:00」与「10-25 10:00」混在一起
 * 既不对齐也不好比较。
 * 统一成绝对日期后两行格式一致、宽窄稳定。
 *
 * 跨年时带上年份 —— 否则 `01-05` 会让人以为已经过去。
 *
 * **估算值要带「约」**（2026-10-20）：Command Code 的 5 小时/周窗口不公布重置时间，我们用
 * 「`used` 首次变正 + 窗口长度」推算。推算值必须一眼可辨，否则用户会把它当成厂商给的
 * 精确时刻去安排事情。`estimated` 由 `QuotaWindow.resetEstimated` 传进来。
 * @param at - 重置时刻（epoch 毫秒）。
 * @param now - 现在（判断是否需要年份；缺省 `Date.now()`）。
 * @param estimated - 这个时刻是不是估算出来的（是则加「约」）。
 * @returns `MM-DD HH:mm`（同年）或 `YYYY-MM-DD HH:mm`（跨年）；估算时前缀「约 」；
 *   时刻不可用时 `undefined`。
 */
export function quotaResetDateText(
  at: number | undefined,
  now: number = Date.now(),
  estimated = false,
): string | undefined {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return undefined;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (value: number): string => String(value).padStart(2, "0");
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const text = sameYear ? `${month}-${day} ${time}` : `${date.getFullYear()}-${month}-${day} ${time}`;
  return estimated ? `约 ${text}` : text;
}

/**
 * 套餐行的文案：`套餐 GOAT · 每月 $70.00 · 本期至 2026-11-14`。
 *
 * 三块独立存在、缺一就不出现：名称（表里没有时退回标识原文）、状态（`active` 是常态，
 * 不重复写；其余状态原文照排 —— 状态是厂商开放词表，认不出的原样显示）、每月额度、
 * 本期结束。**没有套餐时返回 `undefined`**：界面据此不画这一行（未订阅不是错误）。
 * @param t - 取词函数。
 * @param plan - 归一化的套餐。
 * @returns 一行文案；`plan.id` 为空且没有状态时为 `undefined`。
 */
export function quotaPlanText(t: (key: string) => string, plan: QuotaPlanSummary): string | undefined {
  const parts: string[] = [];
  const name = plan.name ?? plan.id;
  if (name !== "") parts.push(`${t("account.plan")} ${name}`);
  if (plan.status !== undefined && plan.status !== "" && plan.status !== "active") {
    parts.push(quotaPlanStatusText(t, plan.status));
  }
  if (plan.monthlyCredits !== undefined) {
    parts.push(t("quota.planMonthly").replace("{amount}", quotaAmount(plan.monthlyCredits, "usd")));
  }
  if (plan.periodEnd !== undefined) {
    const date = new Date(plan.periodEnd);
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        t("quota.planPeriodEnd").replace(
          "{date}",
          date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }),
        ),
      );
    }
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** 套餐状态的本地化文案；词表外的状态原样返回（不给厂商的状态编翻译）。 */
function quotaPlanStatusText(t: (key: string) => string, status: string): string {
  const key = `quota.planStatus.${status}`;
  const text = t(key);
  return text === key ? status : text;
}

/**
 * 展开报告里的一行明细：把存在的字段都写出来，缺失的一律不出现。
 * @param t - 取词函数。
 * @param window - 额度窗口。
 * @returns 明细文案；一个字段都没有时为 `-`。
 */
export function quotaWindowDetail(t: (key: string) => string, window: QuotaWindow): string {
  if (window.unlimited === true) return t("quota.unlimited");
  const parts: string[] = [];
  if (window.used !== undefined && window.cap !== undefined) {
    parts.push(
      t("quota.usedOf")
        .replace("{used}", quotaAmount(window.used, window.unit))
        .replace("{cap}", quotaAmount(window.cap, window.unit)),
    );
  }
  if (window.percent !== undefined) {
    parts.push(t("quota.usedPercent").replace("{percent}", formatNumber(window.percent)));
  }
  // 估算值带「约」：这一行是纯文本摘要，没有别的地方能标注它是推算的。
  const approximate = window.resetEstimated === true ? t("quota.estimatedPrefix") : "";
  if (window.resetAt !== undefined) {
    parts.push(`${approximate}${t("quota.resetAt")} ${new Date(window.resetAt).toLocaleString()}`);
  }
  return parts.length === 0 ? "-" : parts.join(" · ");
}

/** 进度条的档位：健康 / 偏高 / 用尽。颜色由样式表的 `[data-level]` 决定。 */
export type QuotaLevel = "ok" | "warn" | "error";

/** 一根进度条能画出来的东西：已用百分比（0–100）与档位。 */
export interface QuotaMeter {
  percent: number;
  level: QuotaLevel;
}

/**
 * 把窗口折算成进度条；画不出来时返回 `undefined`（**绝不补一条 0%**）。
 *
 * 三条口径，账户卡片、侧边栏与仪表盘共用同一份实现：
 * 1. 有 `percent` 就用它（契约写明是「已用百分比」）；
 * 2. 没有 `percent` 但 `used` 与 `cap` 都在，就算得出来（`cap` 为 0 时不算，除零）；
 * 3. 用得越多越糟：`≥80` 红、`≥50` 黄、其余蓝；厂商自己说 `exceeded` 的一律红。
 * @param window - 额度窗口。
 * @returns 条宽与档位；一个数都没有时为 `undefined`。
 */
export function quotaMeter(window: QuotaWindow): QuotaMeter | undefined {
  // 不限窗口没有百分比可画（就算端点顺带给了数字也不画：那是自相矛盾的读数，条会撒谎）。
  if (window.unlimited === true) return undefined;
  const reported = window.percent;
  const derived =
    reported === undefined && window.used !== undefined && window.cap !== undefined && window.cap > 0
      ? (window.used / window.cap) * 100
      : undefined;
  const percent = reported ?? derived;
  if (percent === undefined || !Number.isFinite(percent)) return undefined;
  const level: QuotaLevel = window.exceeded === true || percent >= 80 ? "error" : percent >= 50 ? "warn" : "ok";
  return { percent: Math.max(0, Math.min(100, Math.round(percent))), level };
}
