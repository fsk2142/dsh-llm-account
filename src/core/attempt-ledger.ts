/**
 * 一次请求内「试了多少账号、各自怎么失败、用尽时抛哪条」的共享记账。
 *
 * ## 为什么要有这个模块（2026-11-07）
 *
 * 三个厂商适配器（opendesign / opencode / commandcode）各自抄了一份回合循环：
 * `tried` 集合、`lastFailure`、失败链、`maxTried` 判断、「用尽时抛哪一条」。
 * 抄三份的代价不是代码行数，而是**同一个 bug 要修三次，且总会漏**：
 *
 * | 事故 | 当时的状态 |
 * | --- | --- |
 * | 「额度已用尽」误报（2026-11-06） | 三家都抛「最后一条失败」→ 三家一起错 |
 * | 条数上限失效（2026-11-06） | 只修了 opendesign，另两家留着同样的坑 |
 * | `maxTried` 语义 | 三家各理解一次 |
 *
 * 所以把这段**纯策略**收进来：它不碰网络、不认识任何厂商字样，只回答
 * 「还能再试吗」「试完了该抛谁」。各家的凭据解析、协议投影、失败分类表仍然
 * 留在自己的适配器里 —— 那才是它们真正的差异。
 *
 * 行为与抽取前**完全一致**（三家共 2000+ 条用例是护栏）。
 * @module dsh-llm-account/src/core/attempt-ledger
 */
import { LlmError } from "@deepseek-ai/dsh-llm";

import { pickExhaustedFailure } from "./failures";
import type { Rejection } from "./adapter";

/** 一次失败尝试：分类结果，以及最终要抛给宿主的错误。 */
export interface AttemptFailure {
  rejection: Rejection;
  thrown: unknown;
}

/**
 * 一个请求内的账号尝试记账。
 *
 * 用法（与抽取前的循环一一对应）：
 *
 * ```ts
 * const ledger = new AttemptLedger(() => this.#maxTried());
 * for (;;) {
 *   const ref = rotation.pick({ model, tried: ledger.tried });
 *   if (ref === undefined) ledger.throwExhausted(() => new LlmError(..., "MISSING_CREDENTIAL"));
 *   ledger.beginAttempt(ref);
 *   ...
 *   ledger.note({ rejection, thrown });          // 记一次失败
 *   if (ledger.reachedMax()) ledger.throwExhausted(() => ...);
 * }
 * ```
 */
export class AttemptLedger {
  /** 本请求内已经试过的账号（按 ref 去重）。 */
  readonly tried = new Set<string>();

  /** 本请求内**按尝试顺序**记录的全部失败。 */
  readonly failures: AttemptFailure[] = [];

  /** 最近一次失败（换模型回退要读它的分类）。 */
  last: AttemptFailure | undefined;

  /**
   * @param maxTried - 本请求最多试几个账号（现读设置，热更新即时生效）。
   */
  constructor(private readonly maxTried: () => number) {}

  /**
   * 占位一个账号：记入 `tried`（同一请求内不再重复选它）。
   *
   * **必须在真正发请求之前调用** —— 抽取前的三家代码都是 `tried.add(ref)` 紧接
   * 取凭据，顺序反了会让「没有可用密钥」的账号被反复选中。
   * @param ref - 账号 ref。
   */
  beginAttempt(ref: string): void {
    this.tried.add(ref);
  }

  /**
   * 记一次失败（同时更新 `last` 与失败链）。
   * @param failure - 分类结果与要抛的错误。
   */
  note(failure: AttemptFailure): void {
    this.last = failure;
    this.failures.push(failure);
  }

  /** 是否已经用满本请求的尝试次数。 */
  reachedMax(): boolean {
    return this.tried.size >= this.maxTried();
  }

  /**
   * 抛给宿主：**优先抛可重试的那一条**，而不是最后碰巧失败的那一条。
   *
   * 选择规则见 `failures.ts` 的 {@link pickExhaustedFailure}（60 行注释，含事故来由）：
   * 链条里有可自愈的瞬时失败时抛它，宿主会在几秒后自动重试并把这一轮救回来；
   * 抛一条永不重试的终态等于替用户判死刑。
   * @param noAccount - 一条失败都没有时的兜底错误（通常是「没有可用账号」）。
   * @returns 永不返回（总是抛出）。
   */
  throwExhausted(noAccount: () => LlmError): never {
    const picked = pickExhaustedFailure(this.failures) ?? this.last;
    if (picked === undefined) throw noAccount();
    throw picked.thrown;
  }
}
