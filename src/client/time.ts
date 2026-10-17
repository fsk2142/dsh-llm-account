/**
 * 相对时间文案。
 *
 * 为什么需要它：切换记录与切换提示此前把 `toISOString()` 直接印在界面上
 * （`2026-10-17T13:28:58.000Z`）—— 精确但对人没有意义。这里换成「刚刚 / 3 分钟前 /
 * 2 小时前 / 5 天前」，机器可读的 ISO 仍然留在 `<time dateTime>` 上（测试断言的就是它）。
 *
 * 纯函数、无 React：`now` 可注入，测试不必依赖真实时钟。
 * @module dsh-llm-account/src/client/time
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 把时刻格式化成相对文案。
 * @param t - 取词函数（`copy.ts` 的 `time.*` 键）。
 * @param at - 目标时刻（epoch 毫秒）。
 * @param now - 当前时刻（epoch 毫秒，默认 `Date.now()`；时钟回拨时按「刚刚」处理）。
 * @returns 可读的相对时间。
 */
export function relativeTime(t: (key: string) => string, at: number, now: number = Date.now()): string {
  const delta = now - at;
  if (!Number.isFinite(delta) || delta < MINUTE) return t("time.now");
  if (delta < HOUR) return t("time.minutes").replace("{n}", String(Math.floor(delta / MINUTE)));
  if (delta < DAY) return t("time.hours").replace("{n}", String(Math.floor(delta / HOUR)));
  return t("time.days").replace("{n}", String(Math.floor(delta / DAY)));
}
