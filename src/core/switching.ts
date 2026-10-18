/**
 * 账号切换策略的**纯判定**（设计 `2026-10-17-switching-models-density-design.md` §6.3/§6.4）。
 *
 * 这里只回答三个问题：这个账号还剩多少额度、现在该不该评估、该切到谁。
 * 时钟、网络、设置写入都在 `src/vendors/switching.ts` 的控制器里；本模块无 I/O，可完整单测。
 * @module dsh-llm-account/src/core/switching
 */
import type { QuotaSnapshot, QuotaWindow } from "./adapter";

/** 切换策略：`order` 手动顺序（只在耗尽时切），`best-quota` 额度优先，`scheduled` 定时切换。 */
export type SwitchStrategy = "order" | "best-quota" | "scheduled";

/** 从设置文档解析出的策略参数。 */
export interface SwitchSettings {
  strategy: SwitchStrategy;
  /** 定时评估间隔（分钟）；`0` 表示不按时间评估、只在耗尽时切。 */
  intervalMinutes: number;
  /** 是否等到回合结束再切（默认 `true`）。 */
  atTurnEnd: boolean;
}

/** best-quota 需要领先当前账号的最小幅度（避免在两个接近的账号之间抖动）。 */
export const SWITCH_MARGIN = 0.1;

/** 切换原因（与 `core/rotation.ts` 的 `SwitchReason` 对齐）。 */
export type SwitchDecisionReason = "quota" | "balance" | "manual" | "scheduled";

/** 控制器对页面发布的运行态（倒计时/待切换）。 */
export interface SwitchRuntimeState {
  strategy: SwitchStrategy;
  intervalMinutes: number;
  atTurnEnd: boolean;
  /** 自动切换开关（各厂商默认不同，控制器按厂商默认解析后发布）。 */
  autoSwitch: boolean;
  /** 上次评估时刻（0 = 还没评估过）。 */
  evaluatedAt: number;
  /** 下次评估时刻；手动顺序或间隔为 0 时缺省。 */
  nextAt?: number;
  /** 已决定、等回合结束的切换。 */
  pending?: { target: string; reason: SwitchDecisionReason };
}

/** 页面写入的全局切换设置（两家文档保存同一套）。 */
export interface SwitchSettingsWrite {
  strategy: SwitchStrategy;
  intervalMinutes: number;
  atTurnEnd: boolean;
  autoSwitch: boolean;
}

/** 一个候选账号。 */
export interface SwitchCandidate {
  /** 账号 ref。 */
  ref: string;
  /** 最近一次额度读数；没读过或读失败时缺省。 */
  quota?: QuotaSnapshot;
  /** 是否已被拒绝（限流/额度/凭据），来自轮换引擎的拒绝表。 */
  rejected?: boolean;
}

/** `chooseSwitch` 的输入。候选顺序即手动顺序。 */
export interface SwitchInput {
  strategy: SwitchStrategy;
  candidates: readonly SwitchCandidate[];
  /** 当前账号；`null` 表示还没选定（不主动切）。 */
  current: string | null;
  /** 当前账号的额度读数；缺省时从候选里按 ref 取。 */
  currentQuota?: QuotaSnapshot;
  /** 当前账号是否已被拒绝；缺省时从候选里取。 */
  currentRejected?: boolean;
  /** 是否到期评估（耗尽或间隔到）；由控制器算好。 */
  due: boolean;
}

/** 一次切换决定。 */
export interface SwitchDecision {
  target: string;
  reason: SwitchDecisionReason;
}

/**
 * 一个窗口的剩余比例（0..1）。
 *
 * 判定顺序：`exceeded` → 0；`percent` → `1 - percent/100`；`used/cap` → `1 - used/cap`；
 * 都缺 → `undefined`（未知，绝不倒成 0）。结果夹到 `[0,1]`。
 * @param window - 归一化窗口。
 * @returns 剩余比例；无法判定时 `undefined`。
 */
export function windowRemaining(window: QuotaWindow): number | undefined {
  if (window.exceeded === true) return 0;
  let usedFraction: number | undefined;
  if (typeof window.percent === "number" && Number.isFinite(window.percent)) {
    usedFraction = window.percent / 100;
  } else if (
    typeof window.used === "number" &&
    typeof window.cap === "number" &&
    Number.isFinite(window.used) &&
    Number.isFinite(window.cap) &&
    window.cap > 0
  ) {
    usedFraction = window.used / window.cap;
  }
  if (usedFraction === undefined) return undefined;
  return Math.min(1, Math.max(0, 1 - usedFraction));
}

/**
 * 一个快照的剩余比例：取**最紧**的那个窗口（额度优先看最先耗尽的约束）。
 * @param snapshot - 额度读数。
 * @returns 剩余比例；没有任何可判定窗口时 `undefined`。
 */
export function remainingFraction(snapshot: QuotaSnapshot | undefined): number | undefined {
  if (snapshot === undefined) return undefined;
  let min: number | undefined;
  for (const window of snapshot.windows) {
    const remaining = windowRemaining(window);
    if (remaining === undefined) continue;
    if (min === undefined || remaining < min) min = remaining;
    // 已经是 0 就不必再看别的窗口。
    if (min === 0) break;
  }
  return min;
}

/**
 * 这个快照是否已耗尽（任一窗口超出或剩余归零）。
 * 未知读数**不算**耗尽 —— 否则一次失败的额度读取会触发无谓换号。
 * @param snapshot - 额度读数。
 * @returns 是否耗尽。
 */
export function quotaExhausted(snapshot: QuotaSnapshot | undefined): boolean {
  if (snapshot === undefined) return false;
  return snapshot.windows.some((window) => windowRemaining(window) === 0);
}

/**
 * 从设置文档解析策略，坏值落默认：`order` / 60 分钟 / 回合末切换。
 * @param document - 设置文档。
 * @returns 清洗后的策略参数。
 */
export function switchSettingsOf(document: Record<string, unknown>): SwitchSettings {
  const strategy =
    document.switchStrategy === "best-quota"
      ? "best-quota"
      : document.switchStrategy === "scheduled"
        ? "scheduled"
        : "order";
  const rawInterval = document.switchIntervalMinutes;
  const intervalMinutes =
    typeof rawInterval === "number" && Number.isFinite(rawInterval)
      ? Math.min(24 * 60, Math.max(0, Math.floor(rawInterval)))
      : 60;
  return {
    strategy,
    intervalMinutes,
    // 只有显式 `false` 才关掉「回合末切换」；缺省（老文档）保持真。
    atTurnEnd: document.switchAtTurnEnd !== false,
  };
}

/**
 * 现在是否该评估一次切换。
 * @param lastEvaluatedAt - 上一次评估时刻（epoch 毫秒）；`0` 表示从未评估。
 * @param now - 当前时刻。
 * @param intervalMinutes - 评估间隔（分钟）；`0` 表示不按时间评估。
 * @param currentExhausted - 当前账号是否已耗尽（耗尽立刻评估）。
 * @returns 是否评估。
 */
export function isDue(lastEvaluatedAt: number, now: number, intervalMinutes: number, currentExhausted: boolean): boolean {
  if (currentExhausted) return true;
  if (intervalMinutes <= 0) return false;
  if (lastEvaluatedAt <= 0) return true;
  return now - lastEvaluatedAt >= intervalMinutes * 60_000;
}

/** 候选是否不可用（被拒或额度耗尽）。 */
function unavailable(candidate: SwitchCandidate): boolean {
  return candidate.rejected === true || quotaExhausted(candidate.quota);
}

/**
 * 选下一个账号。
 *
 * - `current` 为 `null`：不主动切（还没有「当前」可言）；
 * - 当前耗尽：`order` 取顺序里第一个可用者；`best-quota` 取额度最高者（都没有读数时退回
 *   顺序里的第一个可用者）。原因 `quota`；
 * - 当前未耗尽：`order` 永不切；`best-quota` 只在**到期**且最高者领先当前至少
 *   {@link SWITCH_MARGIN} 时切，原因 `balance`；当前额度未知时不切。
 *
 * @param input - 当前账号、候选顺序、额度与是否到期。
 * @returns 切换决定；不该切时 `undefined`。
 */
export function chooseSwitch(input: SwitchInput): SwitchDecision | undefined {
  if (input.current === null) return undefined;
  const currentCandidate = input.candidates.find((candidate) => candidate.ref === input.current);
  const currentSnapshot = input.currentQuota ?? currentCandidate?.quota;
  const currentExhausted =
    input.currentRejected === true || currentCandidate?.rejected === true || quotaExhausted(currentSnapshot);
  const others = input.candidates.filter((candidate) => candidate.ref !== input.current);
  const available = others.filter((candidate) => !unavailable(candidate));
  if (available.length === 0) return undefined;

  const rotate = (reason: SwitchDecisionReason): SwitchDecision | undefined => {
    const at = input.candidates.findIndex((candidate) => candidate.ref === input.current);
    const rotated =
      at === -1 ? input.candidates : [...input.candidates.slice(at + 1), ...input.candidates.slice(0, at)];
    const next = rotated.find((candidate) => candidate.ref !== input.current && !unavailable(candidate));
    return next === undefined ? undefined : { target: next.ref, reason };
  };

  if (input.strategy === "scheduled") {
    // 定时策略只在到点时切；额度耗尽不触发自动切换。
    if (!input.due) return undefined;
    return rotate("scheduled");
  }

  if (currentExhausted) {
    // 顺序/额度优先：耗尽时按顺序或额度排序找下一个。
    if (input.strategy !== "best-quota") return rotate("quota");
    const ranked = available
      .flatMap((candidate) => {
        const remaining = remainingFraction(candidate.quota);
        return remaining === undefined ? [] : [{ ref: candidate.ref, remaining }];
      })
      .sort((left, right) => right.remaining - left.remaining);
    // 没有任何读数时退回顺序：至少让请求有机会继续，而不是卡死在耗尽账号上。
    return { target: ranked[0]?.ref ?? available[0]!.ref, reason: "quota" };
  }

  if (!input.due) return undefined;
  if (input.strategy !== "best-quota") return undefined;
  const currentRemaining = remainingFraction(currentSnapshot);
  if (currentRemaining === undefined) return undefined;
  const best = available
    .flatMap((candidate) => {
      const remaining = remainingFraction(candidate.quota);
      return remaining === undefined ? [] : [{ ref: candidate.ref, remaining }];
    })
    .sort((left, right) => right.remaining - left.remaining)[0];
  if (best === undefined || best.remaining <= currentRemaining + SWITCH_MARGIN) return undefined;
  return { target: best.ref, reason: "balance" };
}
