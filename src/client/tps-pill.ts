/**
 * **实时 tok/s 的显示**（2026-11-12，第 2 步）。
 *
 * ## 放在哪
 *
 * 注册进 `conversation.composer.dock`，`order: -1` —— 官方那两个胶囊
 * （轮次/步数 = order 0、用量 = order 1）会排在我们右边，所以它出现在输入框底部
 * 那一行「90 轮 3946 步 · …」的**左边**，正是用户指的位置。
 *
 * ## 为什么是「会话级」而不是「按厂商」
 *
 * 这个数字只跟当前会话正在流出的字有关，与厂商、账号、模型都无关 —— 所以它**不碰**
 * 任何 vendor schema，也不需要落进设置文档里的厂商字段。
 *
 * ## 为什么组件里要跑定时器
 *
 * 用户要的是「像汽车速度表一样逐渐降低为 0」：模型停下后指针按指数衰减滑回。
 * 那意味着**即使没有新事件**显示值也在变，所以用 100ms 定时器驱动重读；
 * 归零（`undefined`）时组件返回 `null`，同时把定时器停掉（不给空闲界面留空转）。
 *
 * ## 用 `react` 的方式和其他组件一致
 *
 * 与 `sidebar-card.ts` 同一套：`import { createElement, useEffect, useState } from "react"`
 * —— `react` 由宿主加载器注入（`tsdown.config.ts` 的 `CLIENT_EXTERNALS` 已声明为 external）。
 *
 * @module dsh-llm-account/src/client/tps-pill
 */

import { createElement, useEffect, useState } from "react";

import { createTpsMeter } from "./tps-meter";

/** 重渲染间隔（毫秒）：100ms 足够顺滑，又不至于像 60fps 那样白烧。 */
const TICK_MS = 100;

/**
 * 速度计的最小面（便于测试注入替身）。
 */
export interface TpsMeterLike {
  push(text: string, at: number): void;
  reading(at: number): number | undefined;
  settle(at: number): void;
}

/**
 * 模块级速度计（**全会话一个**）。
 *
 * 为什么放模块级而不是组件里：事件定义在插件生命周期内注册一次，必须把帧推进
 * **同一个**累加器；而组件可能因槽位重注册反复挂载，状态不能跟着丢。
 */
let meter: TpsMeterLike | undefined;

/**
 * 注入/替换速度计（生产由 `installTpsPill` 创建；测试用它放替身）。
 * @param next - 要使用的实例。
 */
export function useTpsMeter(next: TpsMeterLike): void {
  meter = next;
}

/**
 * 确保速度计存在（幂等）。
 * @returns 当前实例。
 */
function ensureMeter(): TpsMeterLike {
  if (meter === undefined) meter = createTpsMeter();
  return meter;
}

/** 订阅者（组件挂载时登记；帧到达或衰减时被通知）。 */
const listeners = new Set<() => void>();

/** 通知所有订阅者「数据变了」。 */
function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * 推进一帧（由事件定义调用）。
 *
 * `meta`（turn/step）目前**不参与计算**：分组交给宿主的事件 id，重置语义由
 * "换了一轮就重新开始计数" 自然满足（旧的桶会被窗口滑出）。
 * 保留这个参数是为了语义清晰与将来需要时不必改签名。
 * @param chunk - 流式 chunk（含 `type` 与 `text`）。
 * @param meta - 该帧所属的 turn/step（当前未使用）。
 * @param at - 帧到达时刻（毫秒）。
 */
export function pushLiveChunk(chunk: unknown, meta: { turn?: unknown; step?: unknown }, at: number): void {
  void meta;
  if (typeof chunk !== "object" || chunk === null) return;
  const type = (chunk as { type?: unknown }).type;
  /*
   * **只认正文与思考**。思考也是模型真实产出的字（官方 `outputTokens` 含它），
   * 所以算进来；`usage` / `block-start` / `block-end` 不含文本，直接忽略。
   */
  if (type !== "text-delta" && type !== "reasoning-delta") return;
  const text = (chunk as { text?: unknown }).text;
  if (typeof text !== "string" || text === "") return;
  ensureMeter().push(text, at);
  notify();
}

/**
 * 本轮结束：只停止**计入新帧**，不清空窗口 —— 指针要靠着已有读数衰减下去。
 * @param at - 结束时刻（毫秒）。
 */
export function settleLiveStream(at: number): void {
  meter?.settle(at);
}

/**
 * 读当前速度（`undefined` = 已归零，组件应隐藏）。
 * @param at - 现在（毫秒）。
 * @returns 估算 tok/s。
 */
export function readingAt(at: number): number | undefined {
  return meter?.reading(at);
}

/**
 * 把数值格式化成显示文本。
 *
 * ≥10 取整、<10 保留一位（与官方 `formatTokensPerSecond` 同一口径）。
 * @param value - tok/s。
 * @returns 显示文本。
 */
export function formatRate(value: number): string {
  const clamped = Math.max(0, value);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/**
 * 实时速度胶囊。
 *
 * 返回 `null` 表示「不显示」—— 值已衰减到 0 时留一个 0 只是噪音。
 * @returns 元素或 `null`。
 */
export function TpsPill(): unknown {
  const [value, setValue] = useState<number | undefined>(() => readingAt(Date.now()));

  useEffect(() => {
    const listener = (): void => setValue(readingAt(Date.now()));
    listeners.add(listener);
    /*
     * 定时器负责**衰减动画**：模型不产字时没有事件，但指针仍要往下滑。
     * 归零后停表 —— 空闲界面不该留一个永远空转的 interval。
     */
    const timer = setInterval(() => {
      const next = readingAt(Date.now());
      setValue(next);
      if (next === undefined) clearInterval(timer);
    }, TICK_MS);
    return () => {
      listeners.delete(listener);
      clearInterval(timer);
    };
  }, []);

  if (value === undefined) return null;
  return createElement(
    "span",
    {
      "data-composer-stat": "llm-account-tps",
      "aria-label": `${formatRate(value)} tok/s`,
      // 内联样式：不绑定宿主 CSS Module 的私有类名（那些会随版本变）。
      style: {
        display: "inline-flex",
        alignItems: "center",
        color: "var(--dsw-alias-label-tertiary)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      },
    },
    `${formatRate(value)} tok/s`,
  );
}
