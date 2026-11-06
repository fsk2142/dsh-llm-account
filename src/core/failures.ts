/**
 * 失败分类的共享类型与构造辅助。
 *
 * 本文件**只**放类型与构造 {@link Rejection} 的小助手：厂商原始错误码到
 * `FailureKind` 的映射表属于各家适配器（任务 9/12），不放在共享内核里 —— 内核
 * 不认识任何厂商字样，只认识这六个分类。
 * @module dsh-llm-account/src/core/failures
 */
import type { FailureKind, Rejection } from "./adapter";

export type { FailureKind, Rejection } from "./adapter";

/**
 * 瞬时失败分类：不污染账号状态，靠同一请求内的 `tried` 防止立刻重选同一账号，
 * 是否重试由宿主的重试策略决定。
 */
export type TransientFailureKind = Extract<FailureKind, "server" | "network">;

/**
 * 构造一次拒绝。`resetAt` 只在厂商确实给出重置时刻时传入 —— 缺省时**不写**该字段，
 * 让「未知重置时刻」与「已知重置时刻」在数据上可区分（轮换引擎据此选择冷却策略）。
 * @param kind - 失败分类。
 * @param message - 面向用户的说明。
 * @param resetAt - 重置时刻（epoch 毫秒）；缺省表示厂商未给出。
 * @returns 新的拒绝记录。
 */
export function rejection(kind: FailureKind, message: string, resetAt?: number): Rejection {
  return resetAt === undefined ? { kind, message } : { kind, message, resetAt };
}

/**
 * **宿主会自动重试**的失败分类（与 `switching/auto-continue.ts` 的
 * `NEVER_RETRY_CODES` 互补）。
 *
 * 那边的黑名单是 `ABORTED` / `CONTEXT_WINDOW_EXCEEDED` / `INVALID_CREDENTIAL` /
 * `QUOTA`；落到分类上就是「除 `quota` 与 `invalid-credential` 之外都重试」。
 */
const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "server",
  "network",
  "rate-limit",
  "unavailable",
]);

/** 只要求带 `rejection` 的失败记录（三家的 `AttemptFailure` 都满足）。 */
export interface FailureCandidate {
  rejection: Rejection;
}

/**
 * 账号试完时，该把**哪一条**失败抛给宿主。
 *
 * ## 为什么不能直接抛最后一条
 *
 * 2026-11-06 的真实事故：一个请求内按规则顺序连试 3 个账号 ——
 * 第 1 个只是瞬时 5xx，第 2、3 个都是 402 `insufficient_balance`。用尽时抛的是
 * **最后一条**（配额），于是：
 *
 * - 用户看到「本轮运行失败，当前请求的额度已用尽」，以为账号没钱了；
 * - `QUOTA` 在 `NEVER_RETRY_CODES` 里 —— 宿主的自动继续**不会**重试，这一轮直接死掉；
 * - 用户手动发「继续」立刻成功，因为跨请求 `tried` 会重置、第 1 个账号本来就没问题。
 *
 * 也就是说：**抛哪一条决定了宿主会不会救这一轮**。链条里明明有可自愈的瞬时失败，
 * 却抛出不可重试的终态，等于替用户判了死刑。
 *
 * ## 规则
 *
 * 1. 链条里有可重试的分类（`server` / `network` / `rate-limit` / `unavailable`）→
 *    抛**最后一条**这样的失败（最新鲜的信号；宿主的重试等 2 秒就够）；
 * 2. 全都是终态（`quota` / `invalid-credential`）→ 抛最后一条（此时换谁都一样，
 *    原来那个信息量最大）。
 *
 * 注意本函数**只**决定「抛哪一条」，不改任何账号状态、不改变重试次数 ——
 * 拒绝表与轮换顺序完全照旧。
 * @param failures - 本请求内按尝试顺序记录的失败。
 * @returns 该抛出的那一条；`failures` 为空时为 `undefined`。
 */
export function pickExhaustedFailure<T extends FailureCandidate>(failures: readonly T[]): T | undefined {
  if (failures.length === 0) return undefined;
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    const candidate = failures[index];
    if (candidate !== undefined && RETRYABLE_KINDS.has(candidate.rejection.kind)) return candidate;
  }
  return failures[failures.length - 1];
}
