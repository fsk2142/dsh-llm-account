/**
 * 额度读数到界面文案的**唯一**一份实现（账户卡片、侧边栏卡片、仪表盘共用）。
 *
 * 为什么单独成模块：同一件事（「缺失」与「真的是 0」必须区分开）写三遍，迟早有一处写错。
 * 这里只有纯函数，没有 React、没有厂商知识。
 * @module dsh-llm-account/src/client/quota
 */
import type { QuotaWindow } from "./usage-contract";

/** 一个窗口的读数形状：决定用哪种写法呈现。 */
export type QuotaShape = "used-cap" | "percent" | "used" | "missing";

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
  const { used, cap, percent } = window;
  if (used !== undefined && cap !== undefined) return { shape: "used-cap", used, cap };
  if (percent !== undefined) return { shape: "percent", percent };
  if (used !== undefined) return { shape: "used", used };
  return { shape: "missing" };
}

/**
 * 一个窗口的读数文案。
 * @param t - 取词函数（缺失时要用到 `account.quotaMissing`）。
 * @param window - 额度窗口。
 * @returns 人类可读的读数；什么都没有时为「暂无额度数据」。
 */
export function quotaWindowText(t: (key: string) => string, window: QuotaWindow): string {
  const reading = quotaReading(window);
  switch (reading.shape) {
    case "used-cap":
      return `${formatNumber(reading.used)}/${formatNumber(reading.cap)}`;
    case "percent":
      return `${formatNumber(reading.percent)}%`;
    case "used":
      return formatNumber(reading.used);
    case "missing":
      return t("account.quotaMissing");
  }
}

/**
 * 展开报告里的一行明细：把存在的字段都写出来，缺失的一律不出现。
 * @param window - 额度窗口。
 * @returns 明细文案；一个字段都没有时为 `-`。
 */
export function quotaWindowDetail(window: QuotaWindow): string {
  const parts: string[] = [];
  if (window.used !== undefined && window.cap !== undefined) parts.push(`${formatNumber(window.used)}/${formatNumber(window.cap)}`);
  if (window.percent !== undefined) parts.push(`${formatNumber(window.percent)}%`);
  if (window.resetAt !== undefined) parts.push(`@${window.resetAt}`);
  return parts.length === 0 ? "-" : parts.join(" ");
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
