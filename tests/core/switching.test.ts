/**
 * 切换策略的纯判定（设计 §6.3/§6.4）：额度剩余、是否该评估、选谁。
 *
 * 这些函数不碰时钟、不碰网络、不写设置 —— 控制器只负责把真实读数与时机喂进来。
 */
import { expect, it } from "vitest";

import type { QuotaSnapshot } from "../../src/core/adapter";
import { chooseSwitch, isDue, quotaExhausted, remainingFraction, switchSettingsOf } from "../../src/core/switching";

/** 只带一个窗口的快照。 */
function snapshot(window: Partial<QuotaSnapshot["windows"][number]>): QuotaSnapshot {
  return { windows: [{ key: "monthly", ...window }], failures: [] };
}

it("remainingFraction：优先百分比，其次 used/cap，超限为 0，多个窗口取最紧", () => {
  expect(remainingFraction(snapshot({ percent: 75 }))).toBeCloseTo(0.25);
  expect(remainingFraction(snapshot({ used: 80, cap: 100 }))).toBeCloseTo(0.2);
  expect(remainingFraction(snapshot({ exceeded: true, percent: 10 }))).toBe(0);
  expect(remainingFraction(undefined)).toBeUndefined();
  expect(remainingFraction(snapshot({}))).toBeUndefined();
  expect(
    remainingFraction({
      windows: [
        { key: "weekly", percent: 10 },
        { key: "monthly", percent: 90 },
      ],
      failures: [],
    }),
  ).toBeCloseTo(0.1);
});

it("quotaExhausted：超限或剩余归零算耗尽，未知不算", () => {
  expect(quotaExhausted(snapshot({ exceeded: true }))).toBe(true);
  expect(quotaExhausted(snapshot({ percent: 100 }))).toBe(true);
  expect(quotaExhausted(snapshot({ percent: 99 }))).toBe(false);
  expect(quotaExhausted(undefined)).toBe(false);
  expect(quotaExhausted(snapshot({}))).toBe(false);
});

it("switchSettingsOf：坏值落默认（order / 60 分钟 / 回合末切换）", () => {
  expect(switchSettingsOf({})).toEqual({ strategy: "order", intervalMinutes: 60, atTurnEnd: true });
  expect(switchSettingsOf({ switchStrategy: "best-quota", switchIntervalMinutes: 15, switchAtTurnEnd: false })).toEqual({
    strategy: "best-quota",
    intervalMinutes: 15,
    atTurnEnd: false,
  });
  expect(switchSettingsOf({ switchStrategy: "scheduled", switchIntervalMinutes: 15 })).toMatchObject({
    strategy: "scheduled",
    intervalMinutes: 15,
  });
  expect(switchSettingsOf({ switchStrategy: "nonsense", switchIntervalMinutes: -5, switchAtTurnEnd: "no" }).strategy).toBe("order");
  expect(switchSettingsOf({ switchIntervalMinutes: 0 }).intervalMinutes).toBe(0);
  expect(switchSettingsOf({ switchIntervalMinutes: "15" }).intervalMinutes).toBe(60);
});

it("isDue：当前耗尽立刻评估；间隔为 0 不按时间评估；首次到期", () => {
  expect(isDue(0, 1_000, 60, true)).toBe(true);
  expect(isDue(0, 1_000, 60, false)).toBe(true);
  expect(isDue(1_000, 2_000, 0, false)).toBe(false);
  expect(isDue(1_000, 2_000, 1, false)).toBe(false);
  expect(isDue(1_000, 61_000, 1, false)).toBe(true);
});

it("scheduled 策略：到期按顺序切下一个，不看额度；未到期不切", () => {
  expect(
    chooseSwitch({
      strategy: "scheduled",
      candidates: [{ ref: "a" }, { ref: "b" }, { ref: "c" }],
      current: "a",
      due: true,
    }),
  ).toEqual({ target: "b", reason: "scheduled" });
  expect(
    chooseSwitch({ strategy: "scheduled", candidates: [{ ref: "a" }, { ref: "b" }], current: "a", due: false }),
  ).toBeUndefined();
  // 当前耗尽时仍按顺序切，原因记为额度。
  expect(
    chooseSwitch({
      strategy: "scheduled",
      candidates: [{ ref: "a" }, { ref: "b" }],
      current: "a",
      currentRejected: true,
      due: true,
    }),
  ).toEqual({ target: "b", reason: "quota" });
});

it("order 策略：只在当前耗尽时切到顺序里的下一个可用账号", () => {
  expect(
    chooseSwitch({
      strategy: "order",
      candidates: [{ ref: "a" }, { ref: "b" }, { ref: "c" }],
      current: "a",
      currentRejected: true,
      due: true,
    }),
  ).toEqual({ target: "b", reason: "quota" });
  // 没耗尽时，即使到期也不切（手动顺序模式不按额度轮换）。
  expect(
    chooseSwitch({ strategy: "order", candidates: [{ ref: "a" }, { ref: "b" }], current: "a", due: true }),
  ).toBeUndefined();
  // 下一个被拒/耗尽就继续往后找。
  expect(
    chooseSwitch({
      strategy: "order",
      candidates: [{ ref: "a" }, { ref: "b", rejected: true }, { ref: "c" }],
      current: "a",
      currentRejected: true,
      due: true,
    }),
  ).toEqual({ target: "c", reason: "quota" });
  // 一个可用的都没有：不编造目标。
  expect(
    chooseSwitch({
      strategy: "order",
      candidates: [{ ref: "a" }, { ref: "b", rejected: true }],
      current: "a",
      currentRejected: true,
      due: true,
    }),
  ).toBeUndefined();
  // 到末尾绕回开头：当前是 c，c 耗尽 → a。
  expect(
    chooseSwitch({
      strategy: "order",
      candidates: [{ ref: "a" }, { ref: "b" }, { ref: "c" }],
      current: "c",
      currentRejected: true,
      due: true,
    }),
  ).toEqual({ target: "a", reason: "quota" });
});

it("best-quota：当前耗尽切到额度最高者；未耗尽则只在明显更高时切", () => {
  // 当前耗尽：b 0.5、c 0.8 → c（不是顺序里的 b）。
  expect(
    chooseSwitch({
      strategy: "best-quota",
      candidates: [
        { ref: "a", quota: snapshot({ percent: 100 }) },
        { ref: "b", quota: snapshot({ percent: 50 }) },
        { ref: "c", quota: snapshot({ percent: 20 }) },
      ],
      current: "a",
      due: true,
    }),
  ).toEqual({ target: "c", reason: "quota" });

  // 未耗尽但到期：b 比当前高 0.6 → 切（balance）。
  expect(
    chooseSwitch({
      strategy: "best-quota",
      candidates: [
        { ref: "a", quota: snapshot({ percent: 80 }) },
        { ref: "b", quota: snapshot({ percent: 20 }) },
      ],
      current: "a",
      due: true,
    }),
  ).toEqual({ target: "b", reason: "balance" });

  // 只高 0.05，不到 0.1 的领先幅度 → 不切（避免抖动）。
  expect(
    chooseSwitch({
      strategy: "best-quota",
      candidates: [
        { ref: "a", quota: snapshot({ percent: 80 }) },
        { ref: "b", quota: snapshot({ percent: 75 }) },
      ],
      current: "a",
      due: true,
    }),
  ).toBeUndefined();

  // 当前额度未知：不按「0」处理，也不切。
  expect(
    chooseSwitch({
      strategy: "best-quota",
      candidates: [{ ref: "a" }, { ref: "b", quota: snapshot({ percent: 50 }) }],
      current: "a",
      due: true,
    }),
  ).toBeUndefined();
});
