/**
 * 记账周期：每个账号**各按自己的额度周期**结算，总账另有一份。
 *
 * 为什么不能按日历日：三家的额度窗口不同（Command Code 有 5 小时 / 周 / 月度；
 * OpenCode 是滚动 / 周 / 月；Open Design 是 5 小时 / 周 / 月度）。把 token 摊到日历日
 * 会让「本周期用了多少」失真 —— 而用户真正想知道的就是这个。
 *
 * 做法：一次请求归属「它发生时该账号所处的周期」。周期由**窗口的重置时间**反推：
 * - 有 `resetAt`：周期 = `[resetAt - 周期长度, resetAt)`，长度按窗口 key 推断
 *   （5 小时 / 周 / 月）；
 * - 没有 `resetAt`：退化为自然周期（自然日 / 自然周 / 自然月），并标明是推算的。
 *
 * 这样即使厂商改了重置时间，统计也跟着走；不会出现「周期内的请求被算到上一个周期」。
 * @module dsh-llm-account/src/core/billing-period
 */

/** 周期粒度。 */
export type PeriodKind = "five-hour" | "day" | "week" | "month";

/** 一个周期区间（左闭右开）。 */
export interface BillingPeriod {
  kind: PeriodKind;
  /** 周期标识（同一账号内唯一、可排序）：`2026-10-19T06` 这类。 */
  key: string;
  /** 起点（epoch 毫秒，含）。 */
  start: number;
  /** 终点（epoch 毫秒，不含）；`undefined` = 还没结束（当前周期）。 */
  end: number | undefined;
  /** 终点是不是从窗口 `resetAt` 读来的（否则是按粒度推算的）。 */
  fromResetAt: boolean;
}

/** 一小时的毫秒数。 */
const HOUR = 3_600_000;

/** 各粒度的大致长度（**只用于由 `resetAt` 反推起点**，不用于判定自然边界）。 */
const APPROX_LENGTH: Readonly<Record<PeriodKind, number>> = {
  "five-hour": 5 * HOUR,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
  month: 30 * 24 * HOUR,
};

/**
 * 由额度窗口的 key 推断周期粒度。
 * @param windowKey - `QuotaWindow.key`（`fiveHour` / `5h` / `weekly` / `monthlyCredits` …）。
 * @returns 粒度；认不出时按月（额度里最粗的那档）。
 */
export function periodKindOf(windowKey: string): PeriodKind {
  const key = windowKey.toLowerCase();
  if (key.includes("5h") || key.includes("fivehour") || key.includes("five-hour") || key.includes("rolling")) return "five-hour";
  if (key.includes("week")) return "week";
  if (key.includes("day") || key.includes("daily")) return "day";
  return "month";
}

/**
 * 把时刻截断到自然周期的起点（本地时区，与用户看到的日期一致）。
 * @param kind - 粒度。
 * @param at - 时刻。
 * @returns 起点。
 */
function naturalStart(kind: PeriodKind, at: number): number {
  const date = new Date(at);
  if (kind === "five-hour") {
    // 自然 5 小时桶：按本地小时的倍数切（00 / 05 / 10 / 15 / 20）。
    const bucket = Math.floor(date.getHours() / 5) * 5;
    date.setHours(bucket, 0, 0, 0);
    return date.getTime();
  }
  if (kind === "day") {
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (kind === "week") {
    // 以周一为一周之首（与国内习惯一致）。
    const day = (date.getDay() + 6) % 7;
    date.setHours(0, 0, 0, 0);
    return date.getTime() - day * 24 * HOUR;
  }
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** 由起点推终点（自然周期的下一个起点）。 */
function naturalEnd(kind: PeriodKind, start: number): number {
  const date = new Date(start);
  if (kind === "five-hour") return start + 5 * HOUR;
  if (kind === "day") return start + 24 * HOUR;
  if (kind === "week") return start + 7 * 24 * HOUR;
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

/** 周期 key：稳定、可排序、可读（本地时区）。 */
function periodKeyOf(kind: PeriodKind, start: number): string {
  const date = new Date(start);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (kind === "five-hour") return `${day}T${pad(date.getHours())}`;
  if (kind === "day") return day;
  if (kind === "week") return `W${day}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/**
 * 判定某个时刻属于哪个周期。
 *
 * @param kind - 该账号这一档额度的粒度。
 * @param at - 请求发生的时刻。
 * @param resetAt - 该额度窗口的重置时间（epoch 毫秒）；未知或缺省时按自然周期。
 * @returns 该时刻所在的周期。
 */
export function periodAt(kind: PeriodKind, at: number, resetAt?: number | undefined): BillingPeriod {
  // 有 resetAt 且它确实在这一档的「未来」：以它为终点反推起点。
  if (resetAt !== undefined && Number.isFinite(resetAt) && resetAt > 0) {
    const length = APPROX_LENGTH[kind];
    const start = resetAt - length;
    if (at >= start && at < resetAt) {
      return { kind, key: periodKeyOf(kind, start), start, end: resetAt, fromResetAt: true };
    }
  }
  const start = naturalStart(kind, at);
  const end = naturalEnd(kind, start);
  // 自然周期仍在进行中时不写终点（`end` 只表示「已经确定的结束时刻」）。
  const ongoing = at < end;
  return { kind, key: periodKeyOf(kind, start), start, end: ongoing ? undefined : end, fromResetAt: false };
}

/** 周期里还剩多少毫秒（没有终点时为 `undefined`）。 */
export function remainingOf(period: BillingPeriod, now: number): number | undefined {
  if (period.end === undefined) {
    // 自然周期：算到下一个自然边界。
    const end = naturalEnd(period.kind, period.start);
    return Math.max(0, end - now);
  }
  return Math.max(0, period.end - now);
}
