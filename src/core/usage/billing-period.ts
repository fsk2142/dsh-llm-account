/**
 * 记账周期：每个账号**各按自己的额度周期**结算，总账另有一份。
 *
 * 为什么不能按日历日：三家的额度窗口不同（Command Code 有 5 小时 / 周 / 月度；
 * OpenCode 是滚动 / 周 / 月；Open Design 只有 5 小时 / 周）。把 token 摊到日历日
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

/**
 * 把一个时刻按**日历月**前移/后移（月末夹取：1/31 的前一月是 12/31，不会溢出到 3 月）。
 * @param at - 基准时刻。
 * @param months - 偏移月数（可负）。
 * @returns 平移后的时刻。
 */
function addMonths(at: number, months: number): number {
  const date = new Date(at);
  const day = date.getDate();
  const target = new Date(at);
  // 先设成 1 号再改月，避免 1/31 → 2/31 自动溢出到 3 月。
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target.getTime();
}

/**
 * **套餐周期**：锚在订阅本期的边界（`periodEnd`，可选 `periodStart`）。
 *
 * 为什么单独一种：用户 2026-10-19 明确要求「按照套餐的有效期进行统计」。订阅是**按月续费**
 * 的，它的边界只由厂商给的日期决定 —— 既不是自然月（9 月 20 日订阅，周期就是 20 日到 20 日），
 * 也不是额度里最细的那一档（5 小时窗口只说明「最近五小时用了多少」）。
 *
 * `periodStart` 缺失时由 `periodEnd` 往前推一个日历月（厂商通常只公布终点）。两种情况下
 * 起点都属于「按周期推断」，而终点是权威的 —— 界面因此显示成「按厂商重置时间」。
 * @param periodEnd - 套餐本期结束时刻（epoch 毫秒）。
 * @param at - 要归属的时刻。
 * @param periodStart - 套餐本期开始时刻（可选；厂商公布时比推算更准）。
 * @returns 该时刻所在的套餐周期；`periodEnd` 不可用时为 `undefined`。
 */
export function planPeriodAt(periodEnd: number, at: number, periodStart?: number): BillingPeriod | undefined {
  if (!Number.isFinite(periodEnd) || periodEnd <= 0 || !Number.isFinite(at)) return undefined;
  // 0) 本期已经结束（订阅过期 / 厂商还没报新一期）：`periodEnd` 在过去。
  //
  // 以前这里会返回「以过去的 periodEnd 结尾」的周期，`at` 根本不在区间内 —— 而
  // `usage-report` 用 `record.at < period.end` 过滤，于是当前所有记录被丢掉：账号用量块显示
  // 0 请求，而请求其实在正常进行（2026-10-20 审计）。这里改成**从 periodEnd 往后推**，
  // 让区间真正兜住此刻；真正的「本期」仍然优先用厂商给的边界（见下面两条）。
  if (at >= periodEnd) {
    const anchor = periodStart !== undefined && Number.isFinite(periodStart) && periodStart > 0 && periodStart < periodEnd
      ? periodStart
      : addMonths(periodEnd, -1);
    const length = periodEnd - anchor;
    if (length > 0) {
      // 已经过了几期就往后推几期（最多 24 期，避免异常数据导致死循环）。
      const steps = Math.min(24, Math.max(1, Math.ceil((at - periodEnd) / length)));
      const start = anchor + steps * length;
      if (start <= at) {
        return { kind: "month", key: periodKeyOf("month", start), start, end: start + length, fromResetAt: true };
      }
    }
  }
  // 1) 厂商自己给了本期起点：直接用它，不做任何推算。
  if (periodStart !== undefined && Number.isFinite(periodStart) && periodStart > 0 && periodStart < periodEnd) {
    const inside = at >= periodStart && at < periodEnd;
    // 落在本期外（上一期的记录）：按起止长度平移，最多回溯 24 期。
    const length = periodEnd - periodStart;
    if (!inside && at < periodStart) {
      const steps = Math.ceil((periodStart - at) / length);
      if (steps <= 24) {
        const start = periodStart - steps * length;
        return { kind: "month", key: periodKeyOf("month", start), start, end: start + length, fromResetAt: true };
      }
    }
    return { kind: "month", key: periodKeyOf("month", periodStart), start: periodStart, end: periodEnd, fromResetAt: true };
  }
  // 2) 只有终点：从「本期」往回找（`at` 可能落在好几个周期之前）。
  let end = periodEnd;
  for (let guard = 0; guard < 24; guard += 1) {
    const start = addMonths(end, -1);
    if (at >= start && at < end) {
      return { kind: "month", key: periodKeyOf("month", start), start, end, fromResetAt: true };
    }
    if (at < start) {
      end = start;
      continue;
    }
    // `at >= end`：本期已经结束（厂商还没报新的 periodEnd）→ 用现在这一档兜住。
    return { kind: "month", key: periodKeyOf("month", start), start, end, fromResetAt: true };
  }
  return undefined;
}
