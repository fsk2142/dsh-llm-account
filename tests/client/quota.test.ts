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
  primaryQuotaWindow,
  quotaMeter,
  quotaPlanText,
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

it("「不限」是端点给的读数：文案写「不限」，不画条，也不进侧边栏的主窗口", () => {
  // 2026-10-18 线报：CC 的 `windowLimits.limited === false`、`fiveHour`/`weekly` 为 null ——
  // 适配器据此给出 `unlimited` 窗口（不是缺失）；这里钉住它在读数层的样子。
  const unlimited = { key: "fiveHour", unlimited: true };
  expect(quotaReading(unlimited)).toEqual({ shape: "unlimited" });
  expect(quotaShape(unlimited)).toBe("unlimited");
  expect(quotaWindowText(t, unlimited)).toBe("不限");
  expect(quotaWindowDetail(t, unlimited)).toBe("不限");
  // 没有上限可量 → 不画条；端点自相矛盾地给了数字也不画（条会撒谎）。
  expect(quotaMeter(unlimited)).toBeUndefined();
  expect(quotaMeter({ key: "fiveHour", unlimited: true, percent: 10 })).toBeUndefined();
  // 侧边栏只有一行，要挑**有读数**的那条：月度消耗比永远不变的「不限」有用。
  const windows = [unlimited, { key: "weekly", unlimited: true }, { key: "monthlyCredits", used: 62.21 }];
  expect(primaryQuotaWindow(windows, "commandcode")).toEqual({ key: "monthlyCredits", used: 62.21 });
  // 全都是「不限」时仍给出一条（侧边栏不变成空白）。
  expect(primaryQuotaWindow([unlimited], "commandcode")).toEqual(unlimited);
});

it("primaryQuotaWindow：侧边栏只取小时级窗口（5h / fiveHour / rolling）", () => {
  // 2026-10-18 用户反馈：侧边栏三条窗口太占地方，只留 5 小时那条。
  const cc = [{ key: "5h", used: 1, cap: 9 }, { key: "weekly" }, { key: "monthlyCredits" }];
  expect(primaryQuotaWindow(cc, "commandcode")).toBe(cc[0]);
  // 同一语义的另一种厂商写法（fiveHour）也认；不在第一位也要挑出来。
  expect(primaryQuotaWindow([{ key: "weekly" }, { key: "fiveHour", used: 2, cap: 9 }], "commandcode")).toEqual({ key: "fiveHour", used: 2, cap: 9 });
  // opencode 的小时级窗口叫 rolling。
  expect(primaryQuotaWindow([{ key: "rolling" }, { key: "monthly" }], "dsh-opencode-go")).toEqual({ key: "rolling" });
  // 一个小时级窗口都没有时兜底第一窗口，别把账号变成空白。
  expect(primaryQuotaWindow([{ key: "daily" }, { key: "weekly" }], "commandcode")).toEqual({ key: "daily" });
  // 空列表 → 厂商空窗列表里的第一个（commandcode 的第一个正是 5h，正好还是小时级）。
  expect(primaryQuotaWindow([], "commandcode")).toEqual({ key: "5h" });
  // 空厂商：fallback 只有一个无名窗口，也不会没有条。
  expect(primaryQuotaWindow([], "unknown-vendor")).toEqual({ key: "" });
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

it("额度带上单位：厂商给的美元按 `$` + 两位小数排版（旧插件 formatMoney 第 1516 行同一口径）", () => {
  // 2026-10-18 用户要求「额度信息带上单位」。单位是**厂商给的事实**（CC 的额度都是美元：
  // 旧插件 `formatMoney` = `$` + toFixed(2)），所以只在 `unit` 存在时排版；没给单位的窗口
  // 照旧裸数字 —— 不替厂商猜单位，也不把美元符号贴到别家身上。
  expect(quotaWindowText(t, { key: "fiveHour", used: 3, cap: 10, unit: "usd" })).toBe("已用 $3.00 / 共 $10.00");
  expect(quotaWindowText(t, { key: "monthlyCredits", used: 62.2122, unit: "usd" })).toBe("已用 $62.21");
  expect(quotaWindowDetail(t, { key: "fiveHour", used: 3, cap: 10, unit: "usd" })).toContain("已用 $3.00 / 共 $10.00");
  // 没给单位 → 裸数字（与单位缺席是两件事）。
  expect(quotaWindowText(t, { key: "fiveHour", used: 3, cap: 10 })).toBe("已用 3 / 共 10");
});

it("套餐行：名称 + 每月额度 + 本期结束三块各自独立，缺哪块就不写哪块", () => {
  const periodEnd = Date.parse("2026-11-14T03:23:11.000Z");
  const date = new Date(periodEnd).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  // 线上账号（sample-user）：GOAT / 每月 70 美元 / 本期到 11 月 14 日 —— 状态 active 不重复写。
  expect(
    quotaPlanText(t, { id: "individual-goat", name: "GOAT", status: "active", monthlyCredits: 70, periodEnd }),
  ).toBe(`套餐 GOAT · 每月 $70.00 · 本期至 ${date}`);
  // 表里没有这个标识 → 退回标识原文，不编名称与额度。
  expect(quotaPlanText(t, { id: "individual-new-tier" })).toBe("套餐 individual-new-tier");
  // 非 active 才写状态（本地化；词表外的状态原样排）。
  expect(quotaPlanText(t, { id: "individual-pro-v1", name: "Pro", status: "past_due", monthlyCredits: 80 })).toBe(
    "套餐 Pro · 已逾期未付 · 每月 $80.00",
  );
  expect(quotaPlanText(t, { id: "x", status: "weird" })).toBe("套餐 x · weird");
  // 只有状态（标识都没有）：只写状态那一块。
  expect(quotaPlanText(t, { id: "", status: "canceled" })).toBe("已取消");
  // 什么都没有 → 整行不画。
  expect(quotaPlanText(t, { id: "" })).toBeUndefined();
});

it("重置时间：有值才写，resetAt 为 0 不显示 1970", () => {
  // 相对当前时刻构造，避免跨天（本地午夜）时用例自己失效。
  const base = new Date();
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 30, 0).getTime();
  expect(quotaResetText(t, { key: "w", resetAt: today })).toContain("今天");
  expect(quotaResetText(t, { key: "w", resetAt: today })).toContain("重置");
  expect(quotaResetText(t, { key: "w", resetAt: 0 })).toBeUndefined();
  expect(quotaResetText(t, { key: "w" })).toBeUndefined();
  // 未来日期也显示，不因为不是今天而丢。
  expect(quotaResetText(t, { key: "w", resetAt: base.getTime() + 86400_000 * 3 })).toContain("重置");
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
