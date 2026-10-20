/**
 * 用量采集端口：adapter 侧看到的**唯一**采集形状。
 *
 * 为什么不直接在 adapter 里调台账：三个 adapter 都要记同一件事，而它们各自的
 * "一次尝试"边界不同（重试、换账号、CLI 回退）。端口只暴露「记下这一次的结果」，
 * 具体怎么归属账号/周期由装配层决定 —— adapter 不需要知道记账周期的存在。
 * @module dsh-llm-account/src/core/usage-port
 */
import type { RequestOutcome } from "./stats";

/** 一次请求的采集入参。 */
export interface UsageSample {
  /** 厂商 id。 */
  vendor: string;
  /** 服务这次请求的账号 ref（未知为空串）。 */
  account: string;
  /** 结果。 */
  outcome: RequestOutcome;
  /** 模型 id（计价用）。 */
  model?: string;
  /** 四个 token 计数（失败时通常缺失）。 */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** 失败分类（`outcome === "failure"` 时有意义）。 */
  failureKind?: string;
}

/** 采集端口。实现必须**不阻塞、不抛错**（统计失败不能拖垮请求）。 */
export interface UsagePort {
  /** 记一次请求。 */
  record(sample: UsageSample): void;
}

/** 什么都不记的端口（测试与「统计被关掉」时用）。 */
export const NOOP_USAGE_PORT: UsagePort = { record: () => undefined };
