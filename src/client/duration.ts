/**
 * 「额度评估间隔」的时长换算：分钟是存储单位，页面按天/小时/分钟展示。
 *
 * 规则（需求）：最大 30 天；分钟满 60 进小时，小时满 24 进天；超过 30 天夹到 30 天。
 * 纯函数，页面与测试共用；不碰设置文档。
 * @module dsh-llm-account/src/client/duration
 */

/** 30 天，单位分钟。 */
export const MAX_DURATION_MINUTES = 30 * 24 * 60;

/** 三个展示单位。 */
export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/** 把任意值夹成 0..MAX 的整数分钟。 */
export function clampDuration(value: unknown): number {
  const minutes = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(MAX_DURATION_MINUTES, Math.max(0, minutes));
}

/**
 * 分钟 → 天/小时/分钟（自动进位；超过 30 天夹到 30 天 0 小时 0 分）。
 * @param value - 存储的分钟数。
 * @returns 展示用三段值。
 */
export function durationPartsOf(value: unknown): DurationParts {
  const total = clampDuration(value);
  return {
    days: Math.floor(total / 24 / 60),
    hours: Math.floor((total % (24 * 60)) / 60),
    minutes: total % 60,
  };
}

/**
 * 天/小时/分钟 → 分钟（小时/分钟可超界，自动进位；负数按 0；总时长夹到 30 天）。
 * @param parts - 三段值。
 * @returns 存储用分钟数。
 */
export function minutesOfDurationParts(parts: Partial<DurationParts>): number {
  const number = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  const total =
    number(parts.days) * 24 * 60 + number(parts.hours) * 60 + number(parts.minutes);
  return clampDuration(total);
}

/**
 * 倒计时用三段值（秒级；天/小时/分钟）。
 * @param remainingMs - 剩余毫秒（负数按 0）。
 * @returns 展示用三段值。
 */
export function countdownPartsOf(remainingMs: number): DurationParts {
  const seconds = Math.max(0, Math.floor(remainingMs / 1_000));
  return {
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
  };
}
