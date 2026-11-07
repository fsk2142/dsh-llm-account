/**
 * 账号尝试记账（`AttemptLedger`）的行为契约。
 *
 * 这个类是从三家适配器的重复代码里抽出来的，所以用例要覆盖**抽取前各自的行为**
 * 而不是某个实现细节 —— 三类事故各固定一条：用尽时抛哪一条、上限怎么算、
 * 失败链是否按顺序保留。
 */
import { describe, expect, it } from "vitest";

import { AttemptLedger, type AttemptFailure } from "../../src/core/attempt-ledger";
import { LlmError } from "@deepseek-ai/dsh-llm";

/** 造一次失败：`kind` 同时当抛出内容的标记，便于断言“抛的是哪一条”。 */
function failure(kind: AttemptFailure["rejection"]["kind"]): AttemptFailure {
  return { rejection: { kind, message: `fail:${kind}` }, thrown: new Error(kind) };
}

/** 一条「没有可用账号」的兜底错误。 */
function noAccount(): LlmError {
  return new LlmError("no account", "MISSING_CREDENTIAL");
}

describe("AttemptLedger", () => {
  it("一条失败都没有时抛兜底错误（MISSING_CREDENTIAL）", () => {
    const ledger = new AttemptLedger(() => 3);
    expect(() => ledger.throwExhausted(noAccount)).toThrow(/no account/u);
  });

  it("**用尽时优先抛可重试的那一条**（2026-11-06「额度已用尽」误报的回归）", () => {
    const ledger = new AttemptLedger(() => 3);
    ledger.note(failure("server"));
    ledger.note(failure("quota"));
    ledger.note(failure("quota"));
    // 真实顺序：第 1 个账号瞬时 5xx，后两个额度耗尽。抛 quota 的话宿主不会重试。
    expect(() => ledger.throwExhausted(noAccount)).toThrow(/^server$/u);
  });

  it("全是终态时抛最后一条", () => {
    const ledger = new AttemptLedger(() => 3);
    ledger.note(failure("quota"));
    ledger.note(failure("invalid-credential"));
    expect(() => ledger.throwExhausted(noAccount)).toThrow(/invalid-credential/u);
  });

  it("失败链按尝试顺序保留（换模型回退要读 last）", () => {
    const ledger = new AttemptLedger(() => 3);
    ledger.note(failure("server"));
    ledger.note(failure("rate-limit"));
    expect(ledger.failures.map((item) => item.rejection.kind)).toEqual(["server", "rate-limit"]);
    expect(ledger.last?.rejection.kind, "last 是最近一次，不是最值得抛的那次").toBe("rate-limit");
  });

  it("**调用次数上限现读设置**（热更新：改设置后立刻按新值判断）", () => {
    let max = 2;
    const ledger = new AttemptLedger(() => max);
    ledger.beginAttempt("a");
    expect(ledger.reachedMax(), "1 < 2 还能再试").toBe(false);
    ledger.beginAttempt("b");
    expect(ledger.reachedMax()).toBe(true);
    max = 5;
    expect(ledger.reachedMax(), "上限调大后立刻不再是「用尽」").toBe(false);
  });

  it("同一个账号只占一次名额（ref 去重）", () => {
    const ledger = new AttemptLedger(() => 3);
    ledger.beginAttempt("a");
    ledger.beginAttempt("a");
    expect(ledger.tried.size).toBe(1);
    expect(ledger.reachedMax()).toBe(false);
  });

  it("tried 供轮换引擎直接消费（传出去的就是那个集合）", () => {
    const ledger = new AttemptLedger(() => 3);
    ledger.beginAttempt("a");
    expect([...ledger.tried]).toEqual(["a"]);
  });
});
