/**
 * 时长换算：天/小时/分钟 ↔ 分钟，最大 30 天。
 */
import { expect, it } from "vitest";

import {
  MAX_DURATION_MINUTES,
  clampDuration,
  countdownPartsOf,
  durationPartsOf,
  minutesOfDurationParts,
} from "../../src/client/duration";

it("分钟 → 天/小时/分钟：60 分钟进 1 小时，24 小时进 1 天", () => {
  expect(durationPartsOf(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
  expect(durationPartsOf(60)).toEqual({ days: 0, hours: 1, minutes: 0 });
  expect(durationPartsOf(90)).toEqual({ days: 0, hours: 1, minutes: 30 });
  expect(durationPartsOf(24 * 60)).toEqual({ days: 1, hours: 0, minutes: 0 });
  expect(durationPartsOf(25 * 60 + 5)).toEqual({ days: 1, hours: 1, minutes: 5 });
  expect(durationPartsOf(MAX_DURATION_MINUTES)).toEqual({ days: 30, hours: 0, minutes: 0 });
});

it("天/小时/分钟 → 分钟：超界自动进位，超过 30 天夹住", () => {
  expect(minutesOfDurationParts({ days: 0, hours: 0, minutes: 90 })).toBe(90);
  expect(minutesOfDurationParts({ days: 0, hours: 25, minutes: 0 })).toBe(25 * 60);
  expect(minutesOfDurationParts({ days: 1, hours: 1, minutes: 5 })).toBe(25 * 60 + 5);
  expect(minutesOfDurationParts({ days: 31, hours: 0, minutes: 0 })).toBe(MAX_DURATION_MINUTES);
  expect(minutesOfDurationParts({ days: -1, hours: -60, minutes: -1 })).toBe(0);
  expect(minutesOfDurationParts({})).toBe(0);
});

it("clampDuration：坏值、负数、30 天以上都收敛", () => {
  expect(clampDuration(undefined)).toBe(0);
  expect(clampDuration(Number.NaN)).toBe(0);
  expect(clampDuration(-5)).toBe(0);
  expect(clampDuration(60.9)).toBe(60);
  expect(clampDuration(MAX_DURATION_MINUTES + 1)).toBe(MAX_DURATION_MINUTES);
});

it("倒计时：按秒折算，负数归零", () => {
  expect(countdownPartsOf(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
  expect(countdownPartsOf(90_000)).toEqual({ days: 0, hours: 0, minutes: 1 });
  expect(countdownPartsOf(3_600_000)).toEqual({ days: 0, hours: 1, minutes: 0 });
  expect(countdownPartsOf(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1 });
  expect(countdownPartsOf(-1)).toEqual({ days: 0, hours: 0, minutes: 0 });
});
