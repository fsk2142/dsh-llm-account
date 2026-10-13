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
 * 账号级失败分类：必须写入拒绝表并让该账号退出轮换，恢复方式见各分类的冷却规则。
 * 用 `Exclude` 而不是重抄一遍联合成员，`FailureKind` 增删成员时这里会跟着变。
 */
export type AccountScopedFailureKind = Exclude<FailureKind, TransientFailureKind>;

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
