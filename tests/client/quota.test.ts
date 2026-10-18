/**
 * 读数契约：`quota.ts` 是账户卡片 / 侧边栏 / 仪表盘**共用**的那一份读数实现。
 *
 * 两条都在真机上被看见过，所以护栏放在这里：
 * 1. `70.06581737679998` / `5.0011194891` 直接上屏 —— 原始浮点又长又像调试输出，
 *    还会把「标签 …… 数值」那一行撑开；
 * 2. 百分比型窗口的条**永远是满的绿色** —— `percent` 的单位是 0–100，而渲染层按 0–1
 *    判阈值、乘 100 算宽度。数字是对的，条子骗人（这类错最难看出来）。
 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import {
  formatNumber,
  quotaMeter,
  quotaReading,
  quotaResetText,
  quotaShape,
  quotaWindowDetail,
  quotaWindowText,
} from "../../src/client/quota";

const t = dictionaryOf("zh");

it("读数里的数字最多两位小数，整数不带小数尾巴", () => {
  expect(formatNumber(70.06581737679998)).toBe("70.07");
  expect(formatNumber(5.0011194891)).toBe("5");
  expect(formatNumber(0.5)).toBe("0.5");
  expect(formatNumber(1 / 3)).toBe("0.33");
  expect(formatNumber(35)).toBe("35");
  expect(formatNumber(0)).toBe("0");
  // 非有限值原样带出：不编造 0（那会把「不知道」显示成「没有」）。
  expect(formatNumber(Number.NaN)).toBe("NaN");
  expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
});

it("顺序固定：used+cap 齐 → percent → 只有 used → 什么都没有（不补 0）", () => {
  expect(quotaReading({ key: "w", used: 3, cap: 7, percent: 42 })).toEqual({ shape: "used-cap", used: 3, cap: 7 });
  expect(quotaReading({ key: "w", used: 3, percent: 42 })).toEqual({ shape: "percent", percent: 42 });
  expect(quotaReading({ key: "w", used: 3 })).toEqual({ shape: "used", used: 3 });
  expect(quotaReading({ key: "w" })).toEqual({ shape: "missing" });
  // 真的 0 是一种读数（`0/0`），与「缺失」不是一回事。
  expect(quotaReading({ key: "w", used: 0, cap: 0 })).toEqual({ shape: "used-cap", used: 0, cap: 0 });
  expect(quotaReading({ key: "w", percent: 0 })).toEqual({ shape: "percent", percent: 0 });
});

it("quotaShape 与 quotaReading 永远说同一件事（同一份实现，不许分叉）", () => {
  const windows = [
    { key: "a" },
    { key: "b", used: 1 },
    { key: "c", percent: 0 },
    { key: "d", used: 1, cap: 2 },
    { key: "e", used: 1, cap: 2, percent: 50 },
  ];
  for (const window of windows) expect(quotaShape(window)).toBe(quotaReading(window).shape);
});

it("文案：百分比按 0–100 原样写，明细把存在的字段都写出来", () => {
  expect(quotaWindowText(t, { key: "w", percent: 35 })).toBe("已用 35%");
  expect(quotaWindowText(t, { key: "w", used: 5.0011194891, cap: 35 })).toBe("已用 5 / 共 35");
  expect(quotaWindowText(t, { key: "w", used: 0, cap: 0 })).toBe("已用 0 / 共 0");
  expect(quotaWindowText(t, { key: "w" })).toBe(t("account.quotaMissing"));
  expect(quotaWindowDetail(t, { key: "w", used: 1, cap: 2, percent: 50, resetAt: 1700 })).toBe(
    `已用 1 / 共 2 · 已用 50% · 重置于 ${new Date(1700).toLocaleString()}`,
  );
  expect(quotaWindowDetail(t, { key: "w" })).toBe("-");
});

it("重置时间：有值才写，resetAt 为 0 不显示 1970", () => {
  const now = new Date(2026, 9, 18, 12, 0, 0).getTime();
  const reset = new Date(2026, 9, 18, 18, 0, 0).getTime();
  expect(quotaResetText(t, { key: "w", resetAt: reset })).toContain("今天");
  expect(quotaResetText(t, { key: "w", resetAt: reset })).toContain("重置");
  expect(quotaResetText(t, { key: "w", resetAt: 0 })).toBeUndefined();
  expect(quotaResetText(t, { key: "w" })).toBeUndefined();
  // 未来日期也显示，不因为不是今天而丢。
  expect(quotaResetText(t, { key: "w", resetAt: now + 86400_000 * 3 })).toContain("重置");
});

it("进度条：单位是 0–100 的已用百分比，用得越多档位越糟，缺失与除零不画条", () => {
  // 单位是 0–100：20% 就是 20% 宽、判健康（不是「按 0–1 判阈值」也不是「永远满格」）。
  expect(quotaMeter({ key: "w", percent: 20 })).toEqual({ percent: 20, level: "ok" });
  expect(quotaMeter({ key: "w", percent: 50 })).toEqual({ percent: 50, level: "warn" });
  expect(quotaMeter({ key: "w", percent: 85 })).toEqual({ percent: 85, level: "error" });
  // 厂商自己说超出了（`exceeded`）优先判红。
  expect(quotaMeter({ key: "w", percent: 10, exceeded: true })).toEqual({ percent: 10, level: "error" });
  // used/cap 型：算得出来就画（5/35 → 14%），cap 为 0 时不算（除零）。
  expect(quotaMeter({ key: "w", used: 5, cap: 35 })).toEqual({ percent: 14, level: "ok" });
  expect(quotaMeter({ key: "w", used: 0, cap: 0 })).toBeUndefined();
  // 什么数都没有 → 不画条（不是补一条 0%）。
  expect(quotaMeter({ key: "w" })).toBeUndefined();
  // 越界的值夹在 0–100：条不会溢出卡片。
  expect(quotaMeter({ key: "w", percent: 120 })).toEqual({ percent: 100, level: "error" });
  expect(quotaMeter({ key: "w", percent: -5 })).toEqual({ percent: 0, level: "ok" });
});
