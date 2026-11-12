/**
 * **实时 tok/s 的显示**（2026-11-12，第 2 步）。
 *
 * ## 放在哪
 *
 * 注册进 `conversation.composer.dock`，`order: -1` —— 官方那两个胶囊
 * （轮次/步数 = order 0、用量 = order 1）排在右边，所以它出现在输入框底部
 * 那一行「92 轮 4018 步 · …」的**左边**。
 *
 * ## 样式为什么写成一串 CSS 变量的 calc（2026-11-12 用户实测反馈）
 *
 * 用户第一版看到的效果：**「字体和官方的不一致」**。根因是我只写了
 * `display/color/tabular-nums` 三个内联属性，**没有覆盖字号与行高** —— 于是它继承
 * 容器默认值，和旁边官方胶囊差一档。
 *
 * 官方胶囊的真实规则（`@deepseek-ai/dsh-client-ui-chat` 的 `StatsPills` 模块）：
 *
 * ```
 * .anchor { min-width:0; font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);
 *           line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px)); display:inline-flex }
 * .pill   { border-radius:var(--dsw-radius-sm); color:var(--dsw-alias-label-tertiary);
 *           font:inherit; font-variant-numeric:tabular-nums; white-space:nowrap;
 *           background:0 0; border:none; align-items:center; gap:6px; padding:1px 8px; display:inline-flex }
 * .pill svg { flex:none; width:14px; height:14px }
 * ```
 *
 * 这里逐条照抄成内联样式（不引它的 CSS Module —— 那是宿主私有类名，换版本会变）。
 *
 * ## 为什么空闲时显示 0 而不是消失（用户明确要求）
 *
 * 用户原话：「完全没有会话动作的时候直接显示 0 tok/s 吧，不要消失」。
 *
 * 上一版归零就 `return null`，于是模型一停组件就没了 —— 用户看到的正是「好像又没了」。
 * 现在**始终渲染**：有速度显示速度，没有就显示 `0`。
 *
 * ## 为什么定时器要能停也能重启
 *
 * 「指针回落」需要即使没有新事件也重算（每 100ms 一次）。但值已经是 0 之后就没必要
 * 再算了 —— 所以归零时**停表**，等下一帧到达（`notify()`）再重启。
 * 这样空闲时不会留一个每秒唤醒 10 次的主线程定时器（上一版就是那样，还伴随
 * 控制台的 `Forced reflow` 警告）。
 *
 * @module dsh-llm-account/src/client/tps-pill
 */

import { createElement, useEffect, useState, type ReactElement } from "react";

import { createTpsMeter } from "./tps-meter";

/** 重渲染间隔（毫秒）：100ms 足够顺滑，又不至于像 60fps 那样白烧。 */
const TICK_MS = 100;

/** 速度计的最小面（便于测试注入替身）。 */
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
 * 注入/替换速度计（生产由首次 `readingAt` 创建；测试用它放替身）。
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

/** 订阅者（组件挂载时登记；帧到达时被通知）。 */
const listeners = new Set<() => void>();

/** 通知所有订阅者「数据变了」。 */
function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * 推进一帧（由事件定义调用）。
 * @param chunk - 流式 chunk（含 `type` 与 `text`）。
 * @param meta - 该帧所属的 turn/step（当前不参与计算，见下）。
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
 * 读当前速度。**空闲时返回 0，而不是 `undefined`**（用户要求始终显示）。
 * @param at - 现在（毫秒）。
 * @returns 估算 tok/s（非负）。
 */
export function readingAt(at: number): number {
  const reading = meter?.reading(at);
  return typeof reading === "number" && Number.isFinite(reading) && reading > 0 ? reading : 0;
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
  if (clamped === 0) return "0";
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/** 与官方 `.pill` 逐条对齐的内联样式（理由见文件头）。 */
const PILL_STYLE = {
  boxSizing: "border-box",
  borderRadius: "var(--dsw-radius-sm)",
  maxWidth: "100%",
  color: "var(--dsw-alias-label-tertiary)",
  font: "inherit",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "inherit",
  whiteSpace: "nowrap",
  background: "0 0",
  border: "none",
  alignItems: "center",
  gap: "6px",
  padding: "1px 8px",
  display: "inline-flex",
} as const;

/** 与官方 `.anchor` 对齐的外壳样式（字号与行高在这里）。 */
const ANCHOR_STYLE = {
  minWidth: "0",
  fontSize: "calc(var(--dsh-content-font-size-secondary, 13px) - 1px)",
  lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
  display: "inline-flex",
} as const;

/**
 * 仪表盘图标。
 *
 * ## 为什么用官方的路径数据（2026-11-12 用户反馈「有点小、对比官方不太好看」）
 *
 * 第一版我自己画了「一条上弧 + 一枚指针」，但：
 * - 缺了圆心那个**实心点**，少了辨识度；
 * - `strokeWidth: 1.4` 比官方粗，小尺寸下糊成一团。
 *
 * 现在逐字采用宿主图标集里 `gauge-outline` 的几何（从 `dsh-web-frontend` 的
 * 图标表读出）：`viewBox 0 0 16 16`、`stroke-width: 1`（官方 regular 档）、
 * 三段 path（外弧 + 指针 + 圆心实心点）。
 *
 * 尺寸仍由外层样式决定（官方 `.pill svg { width:14px; height:14px }`）。
 * @returns SVG 元素。
 */
function GaugeIcon(): ReactElement {
  return createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": "true",
      focusable: "false",
      style: { flex: "none", width: "14px", height: "14px" },
    },
    // 外弧
    createElement("path", {
      d: "M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096",
      stroke: "currentColor",
      strokeWidth: 1,
    }),
    // 指针
    createElement("path", {
      d: "M8 8.49994L11.6114 4.88855",
      stroke: "currentColor",
      strokeWidth: 1,
    }),
    // 圆心（实心）
    createElement("path", {
      d: "M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z",
      fill: "currentColor",
    }),
  );
}

/**
 * 实时速度胶囊。**始终渲染**（空闲时显示 `0 tok/s`）。
 * @returns 元素。
 */
export function TpsPill(): unknown {
  const [value, setValue] = useState<number>(() => readingAt(Date.now()));

  useEffect(() => {
    /** 当前运行中的定时器（归零后停、新帧到达再启）。 */
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = (): void => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };
    const start = (): void => {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        const next = readingAt(Date.now());
        setValue(next);
        // 到 0 就停表：没有需要动画的数字了，别继续唤醒主线程。
        if (next === 0) stop();
      }, TICK_MS);
    };
    const listener = (): void => {
      const next = readingAt(Date.now());
      setValue(next);
      // 有了新数据：指针又要动起来，重启定时器。
      if (next > 0) start();
    };
    listeners.add(listener);
    if (readingAt(Date.now()) > 0) start();
    return () => {
      listeners.delete(listener);
      stop();
    };
  }, []);

  return createElement(
    "span",
    { "data-composer-stat": "llm-account-tps", style: ANCHOR_STYLE },
    createElement(
      "span",
      {
        style: PILL_STYLE,
        "aria-label": `实时输出速度（TPS）：${formatRate(value)} tok/s`,
      },
      GaugeIcon(),
      createElement(
        "span",
        { style: { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" } },
        `实时输出速度（TPS）：${formatRate(value)} tok/s`,
      ),
    ),
  );
}
