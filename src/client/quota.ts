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
 * 判断一个窗口能拿什么数来写。
 *
 * 顺序固定：`used`+`cap` 齐 → `percent` → 只有 `used` → 什么都没有。
 * **不补 0**：缺失就是缺失。
 * @param window - 归一化后的额度窗口。
 * @returns 形状标记。
 */
export function quotaShape(window: QuotaWindow): QuotaShape {
  if (window.used !== undefined && window.cap !== undefined) return "used-cap";
  if (window.percent !== undefined) return "percent";
  if (window.used !== undefined) return "used";
  return "missing";
}

/**
 * 一个窗口的读数文案。
 * @param t - 取词函数（缺失时要用到 `account.quotaMissing`）。
 * @param window - 额度窗口。
 * @returns 人类可读的读数；什么都没有时为「暂无额度数据」。
 */
export function quotaWindowText(t: (key: string) => string, window: QuotaWindow): string {
  switch (quotaShape(window)) {
    case "used-cap":
      return `${window.used}/${window.cap}`;
    case "percent":
      return `${window.percent}%`;
    case "used":
      return `${window.used}`;
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
  if (window.used !== undefined && window.cap !== undefined) parts.push(`${window.used}/${window.cap}`);
  if (window.percent !== undefined) parts.push(`${window.percent}%`);
  if (window.resetAt !== undefined) parts.push(`@${window.resetAt}`);
  return parts.length === 0 ? "-" : parts.join(" ");
}
