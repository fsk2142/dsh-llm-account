/**
 * **「已失效」账号的判定与处置**。
 *
 * 需求原话：「检查到未订阅的话就将账号打上已失效的标签，不要自动重试连接到」，
 * 随后补充口径：「订阅失效并且余额小于 1 美元就认为账号失效」（余额可能是负数）。
 *
 * 本文件固定三件事：
 *
 * 1. **判定**（`livenessOf`，纯函数）—— 两个条件必须**同时**满足。
 *    真机实测 2026-11-22：两个免费号 `membershipTier: null` + `totalAvailableCreditsUsd: "0"`，
 *    而 go 会员号的余额**同样是 0** 却完全可用。只看任一条都会误杀。
 * 2. **跳过**（`RotationEngine.pick`）—— 失效账号不再被选中，且**跨请求记得**
 *    （拒绝表 5 分钟就过期，用它实现等于每 5 分钟白撞一次）。
 * 3. **不发请求**（全失效时直接抛）—— 用户明确要求「不要自动重试连接到」。
 */
import { describe, expect, it } from "vitest";
import { LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

import { runAttemptLoop, type AttemptLoopHost, type AttemptCounts } from "../../src/core/attempt-loop";
import type { AttemptFailure } from "../../src/core/attempt-ledger";
import type { Rejection } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";
import { DEAD_BALANCE_USD, livenessOf } from "../../src/vendors/opendesign/liveness";

/** 线上真实负载：免费号（未订阅、余额 0）。 */
const FREE_BROKE = {
  membershipTier: null,
  subscriptionStatus: null,
  personalSubscriptionUpgradeState: "free",
  balanceUsd: "0.0000",
  creditsPerUsd: 10000,
  balances: { subscriptionCredits: "0", rechargeCredits: "0", totalAvailableCredits: "0" },
  totalAvailableCreditsUsd: "0.0000",
};

/** 线上真实负载：go 会员（**余额同样是 0**，但订阅生效，必须判为可用）。 */
const GO_MEMBER = {
  membershipTier: "go",
  subscriptionStatus: "active",
  balanceUsd: "0.0000",
  balances: { totalAvailableCredits: "0" },
  totalAvailableCreditsUsd: "0.0000",
};

describe("livenessOf：判定口径", () => {
  it("**未订阅 + 余额 0 → 失效**（真机上的两个 QQ 号）", () => {
    const verdict = livenessOf(FREE_BROKE);
    expect(verdict.decided).toBe(true);
    expect(verdict.dead).toBe(true);
    expect(verdict.reason).toContain("未订阅");
  });

  it("**有生效订阅 + 余额 0 → 可用**（foxmail 的 go 号，余额也是 0）", () => {
    expect(livenessOf(GO_MEMBER)).toEqual({ decided: true, dead: false });
  });

  it("**未订阅但余额 ≥ $1 → 可用**（按量付费账号不能被误杀）", () => {
    const verdict = livenessOf({ membershipTier: null, totalAvailableCreditsUsd: "5.00" });
    expect(verdict).toEqual({ decided: true, dead: false });
  });

  it("**余额恰好 $1 → 可用**（门槛是 `< 1`，不含 1）", () => {
    const verdict = livenessOf({ membershipTier: null, totalAvailableCreditsUsd: String(DEAD_BALANCE_USD) });
    expect(verdict.dead).toBe(false);
  });

  it("**余额是负数 → 失效**（用户明确说「余额也可能是负数」）", () => {
    const verdict = livenessOf({ membershipTier: null, totalAvailableCreditsUsd: "-2.50" });
    expect(verdict.decided).toBe(true);
    expect(verdict.dead).toBe(true);
  });

  it("**订阅被取消 + 余额不足 → 失效**（档位字段还留着旧值也不算有订阅）", () => {
    const verdict = livenessOf({ membershipTier: "go", subscriptionStatus: "canceled", totalAvailableCreditsUsd: "0.3" });
    expect(verdict.dead).toBe(true);
  });

  it("**订阅过期 + 余额充足 → 可用**（还有钱就还能按量付费）", () => {
    const verdict = livenessOf({ membershipTier: "go", subscriptionStatus: "expired", totalAvailableCreditsUsd: "8" });
    expect(verdict.dead).toBe(false);
  });

  it("**余额字段缺失 → 不下结论**（宁可不标，也不许错杀）", () => {
    expect(livenessOf({ membershipTier: null })).toEqual({ decided: false });
  });

  it("**摘要为空/不是对象 → 不下结论**（读失败时保留上次结论）", () => {
    for (const payload of [undefined, null, "", 0, []]) {
      expect(livenessOf(payload)).toEqual({ decided: false });
    }
  });

  it("**`null` 余额不读成 0**（「没报」与「真的是零」是两件事）", () => {
    expect(livenessOf({ membershipTier: null, totalAvailableCreditsUsd: null })).toEqual({ decided: false });
  });

  it("**credits 折算兜底**：没有美元字段时用 totalAvailableCredits ÷ creditsPerUsd", () => {
    const verdict = livenessOf({
      membershipTier: null,
      creditsPerUsd: 10000,
      balances: { totalAvailableCredits: "20000" },
    });
    // 20000 / 10000 = $2 ≥ $1 → 可用
    expect(verdict).toEqual({ decided: true, dead: false });
  });

  it("**`data` 包一层也认**（网关两种负载形状）", () => {
    expect(livenessOf({ data: FREE_BROKE }).dead).toBe(true);
  });
});

describe("RotationEngine：失效账号不再被选中", () => {
  it("**pick 跳过已失效账号**，选中下一个可用账号", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    engine.markDead("a");
    expect(engine.pick({ model: "m", tried: new Set() })).toBe("b");
  });

  it("**失效是跨请求记住的**（新建 tried 集仍跳过它）", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    engine.markDead("a");
    expect(engine.pick({ model: "m", tried: new Set(["b"]) })).toBeUndefined();
    expect(engine.pick({ model: "m", tried: new Set() })).toBe("b");
  });

  it("**全部失效时返回 undefined**（不编造账号）", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    engine.markDead("a");
    engine.markDead("b");
    expect(engine.pick({ model: "m", tried: new Set() })).toBeUndefined();
    expect(engine.deadAccounts().size).toBe(2);
  });

  it("**harmed pinned 也跳过**（固定账号失效时不能卡死）", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: "a" });
    engine.markDead("a");
    expect(engine.pick({ model: "m", tried: new Set() })).toBe("b");
  });

  it("**clearDead 让它复活**（用户充值后自动撤销）", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    engine.markDead("a");
    engine.clearDead("a");
    expect(engine.isDead("a")).toBe(false);
    expect(engine.pick({ model: "m", tried: new Set() })).toBe("a");
  });

  it("**markDead 对空串是恒等变换**（手改坏的配置不该造出脏条目）", () => {
    const engine = new RotationEngine({ order: ["a"], rules: [], pinned: null });
    engine.markDead("");
    expect(engine.deadAccounts().size).toBe(0);
  });

  it("**引擎重建时失效标记要搬过去**（用户改设置不该让标记丢失）", () => {
    const engine = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    engine.markDead("a");
    const rebuilt = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
    rebuilt.adoptObservations(engine);
    expect(rebuilt.isDead("a")).toBe(true);
    expect(rebuilt.pick({ model: "m", tried: new Set() })).toBe("b");
  });

  it("**deadAccounts 返回快照**（调用方改不动引擎内部状态）", () => {
    const engine = new RotationEngine({ order: ["a"], rules: [], pinned: null });
    engine.markDead("a");
    const snapshot = engine.deadAccounts() as Set<string>;
    snapshot.delete("a");
    expect(engine.isDead("a")).toBe(true);
  });
});

/** 一条最小请求。 */
function request(model = "m1"): GenerateOptions {
  return { provider: "p", model, messages: [{ role: "user", content: [] }] } as unknown as GenerateOptions;
}

/** 造一个最小 host：`pick` 由真实引擎决定，其余全部记账。 */
function harness(input: { order: string[]; dead?: string[]; noLiveText?: string }) {
  const engine = new RotationEngine({ order: input.order, rules: [], pinned: null });
  for (const ref of input.dead ?? []) engine.markDead(ref);
  const attempted: string[] = [];
  const usage: { ref: string; outcome: string }[] = [];
  const host: AttemptLoopHost<unknown, string, undefined> = {
    label: "test",
    rotation: {
      pick: (req) => engine.pick(req),
      markRejected: (_ref: string, _rejection: Rejection) => undefined,
      fallbackAllowed: ({ emitted, totalTokens, aborted }) => !emitted && !aborted && totalTokens <= 0,
      noteSettled: () => undefined,
      deadAccounts: () => engine.deadAccounts(),
    },
    maxTried: () => 3,
    resolveConfig: () => ({}),
    isAbort: () => false,
    abortError: () => new LlmError("aborted", "ABORTED"),
    resolveCredential: async (ref) => `key-${ref}`,
    missingCredential: (ref) => ({
      rejection: { kind: "invalid-credential", message: `no key ${ref}` },
      thrown: new LlmError(`no key ${ref}`, "MISSING_CREDENTIAL"),
    }),
    attempt: async function* (_config, _options, credential) {
      attempted.push(String(credential));
      yield { type: "text-delta", text: "ok", index: 0 } as unknown as StreamChunk;
    },
    classify: (error): AttemptFailure | undefined => ({
      rejection: { kind: "quota", message: String(error) },
      thrown: error,
    }),
    recordUsage: (ref, _model, outcome, _counts: AttemptCounts) => usage.push({ ref, outcome }),
    noteSettled: () => undefined,
    noAccount: (model) => new LlmError(`no account for ${model}`, "MISSING_CREDENTIAL"),
    noLiveAccount: (model, deadCount) =>
      new LlmError(input.noLiveText ?? `all ${deadCount} dead for ${model}`, "NO_LIVE_ACCOUNT"),
    fallbackModel: async () => undefined,
    delegate: () => undefined,
  };
  return { host, attempted, engine, usage };
}

describe("attempt-loop：全失效时一个请求都不发", () => {
  it("**全部失效 → 直接抛 NO_LIVE_ACCOUNT，attempted 为空**（用户要求「不要自动重试连接到」）", async () => {
    const { host, attempted } = harness({ order: ["a", "b", "c"], dead: ["a", "b", "c"] });
    const error = await (async () => {
      try {
        for await (const _chunk of runAttemptLoop(host, request())) {
          // 不应产出任何 chunk
        }
        return undefined;
      } catch (reason: unknown) {
        return reason;
      }
    })();
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("NO_LIVE_ACCOUNT");
    expect(attempted, "一次尝试都不该发生").toEqual([]);
  });

  it("**还有可用账号时正常发请求**（失效的不参与，可用的照常）", async () => {
    const { host, attempted } = harness({ order: ["a", "b"], dead: ["a"] });
    const chunks: StreamChunk[] = [];
    for await (const chunk of runAttemptLoop(host, request())) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(0);
    expect(attempted).toEqual(["key-b"]);
  });

  it("**一个账号都没有（没有失效账号）→ 走原来的 MISSING_CREDENTIAL 文案**", async () => {
    const { host, attempted } = harness({ order: [], dead: [] });
    const error = await (async () => {
      try {
        for await (const _chunk of runAttemptLoop(host, request())) {
          // 空
        }
        return undefined;
      } catch (reason: unknown) {
        return reason;
      }
    })();
    expect((error as LlmError).code, "不能误报成「全部失效」").toBe("MISSING_CREDENTIAL");
    expect(attempted).toEqual([]);
  });
});
