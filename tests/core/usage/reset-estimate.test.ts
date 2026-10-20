/**
 * 重置时间估算（2026-10-20 用户要求：「如果没有提供就给出估算值」）。
 *
 * Command Code 的 `/alpha/billing/credits` 只给窗口的 `used` 与 `cap`，**不给 `resetAt`**：
 *
 * ```
 * windowLimits = { fiveHour: { used: 0.0024, cap: 14 },
 *                  weekly:   { used: 14.2285949297, cap: 35 } }
 * ```
 *
 * 所以 5 小时/周的重置时间一直是空的（月度有 `currentPeriodEnd`，不受影响）。
 * 估算依据：固定窗口用完后 `used` 会回到 0，于是「**首次观测到 `used` 从 0 变正**」就是
 * 窗口起点，加窗口长度就是重置时刻。
 *
 * 关键约束：**估算值必须与厂商给的区分开**（`resetEstimated`），界面显示成「约」。
 */
import { describe, expect, it } from "vitest";

import { estimateReset, fixedWindowMs, WINDOW_LENGTH_MS } from "../../../src/core/usage/reset-estimate";
import { createCommandCodeQuota } from "../../../src/vendors/commandcode/quota";
import { quotaResetDateText } from "../../../src/client/quota";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

describe("fixedWindowMs：只有固定窗口能估算", () => {
  it("5 小时与周是固定窗口", () => {
    expect(fixedWindowMs("fiveHour")).toBe(WINDOW_LENGTH_MS["five-hour"]);
    expect(fixedWindowMs("5h")).toBe(WINDOW_LENGTH_MS["five-hour"]);
    expect(fixedWindowMs("weekly")).toBe(WINDOW_LENGTH_MS.week);
  });

  it("月度/未知窗口不估算（它们有自己的来源或本来就按自然月）", () => {
    for (const key of ["monthlyCredits", "monthly", "rolling", "unknown"]) {
      expect(fixedWindowMs(key), key).toBeUndefined();
    }
  });
});

describe("estimateReset：锚点语义", () => {
  it("首次见到 used > 0 → 以当下为锚点，重置 = 现在 + 5 小时", () => {
    const { anchor, estimate } = estimateReset(undefined, { key: "fiveHour", used: 1, at: T0 });
    expect(anchor).toEqual({ anchorAt: T0, windowMs: 5 * HOUR });
    expect(estimate).toMatchObject({ resetAt: T0 + 5 * HOUR, estimated: true, anchorAt: T0 });
  });

  it("后续观测沿用同一锚点（不每轮往后推）", () => {
    const first = estimateReset(undefined, { key: "fiveHour", used: 1, at: T0 });
    const later = estimateReset(first.anchor, { key: "fiveHour", used: 3, at: T0 + HOUR });
    expect(later.estimate!.resetAt).toBe(T0 + 5 * HOUR);
    expect(later.anchor).toEqual(first.anchor);
  });

  it("**used 回到 0 → 锚点作废**（这一轮已重置，还不知道新窗口何时开始）", () => {
    const first = estimateReset(undefined, { key: "fiveHour", used: 1, at: T0 });
    const cleared = estimateReset(first.anchor, { key: "fiveHour", used: 0, at: T0 + 5 * HOUR });
    expect(cleared.anchor).toBeUndefined();
    expect(cleared.estimate).toBeUndefined();
  });

  it("**锚点过期（错过重置）→ 用当前时刻重新锚定**，不推出一个永远在未来的假时间", () => {
    const first = estimateReset(undefined, { key: "fiveHour", used: 1, at: T0 });
    // 8 小时后才再观测（插件关过）：旧锚点算出的重置时刻早已过去。
    const later = estimateReset(first.anchor, { key: "fiveHour", used: 2, at: T0 + 8 * HOUR });
    expect(later.estimate!.anchorAt).toBe(T0 + 8 * HOUR);
    expect(later.estimate!.resetAt).toBe(T0 + 13 * HOUR);
  });

  it("这次读不到 used（undefined）→ 保留旧锚点，且**不**当成 0", () => {
    const first = estimateReset(undefined, { key: "fiveHour", used: 1, at: T0 });
    const missing = estimateReset(first.anchor, { key: "fiveHour", used: undefined, at: T0 + HOUR });
    expect(missing.anchor).toEqual(first.anchor);
    expect(missing.estimate!.resetAt).toBe(T0 + 5 * HOUR);
  });

  it("没有锚点且这次读不到 → 无法估算（不猜）", () => {
    const result = estimateReset(undefined, { key: "fiveHour", used: undefined, at: T0 });
    expect(result.estimate).toBeUndefined();
  });
});

describe("界面：估算值必须显示「约」", () => {
  it("estimated 为真时带前缀", () => {
    expect(quotaResetDateText(T0, T0, true)).toMatch(/^约 /);
  });

  it("厂商给的真实值不带前缀", () => {
    expect(quotaResetDateText(T0, T0, false)).not.toMatch(/^约 /);
    expect(quotaResetDateText(T0, T0)).not.toMatch(/^约 /);
  });
});

describe("接入额度端口：只补端点没给的窗口", () => {
  /** 造一个假账户端点响应。 */
  function quotaWith(windows: Record<string, unknown>) {
    let now = T0;
    const ref = "acct-1";
    const quote = createCommandCodeQuota({
      ref: () => ref,
      resolveKey: async () => "sk-test",
      now: () => now,
      fetchImpl: (async (url: unknown) => {
        const path = String(url);
        const body = path.includes("/billing/credits")
          ? { credits: { monthlyCredits: 55 }, windowLimits: { limited: true, ...windows } }
          : path.includes("/billing/subscriptions")
            ? { data: null }
            : path.includes("/usage/summary")
              ? { totalCredits: 1 }
              : { user: "x", org: null };
        return { ok: true, status: 200, json: async () => body } as Response;
      }) as unknown as typeof fetch,
    });
    return {
      quote,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("fiveHour 没有 resetAt → 补上估算值并标 resetEstimated", async () => {
    const { quote } = quotaWith({ fiveHour: { used: 1, cap: 14 } });
    const snapshot = await quote.snapshot("acct-1");
    const fiveHour = snapshot.windows.find((window: { key: string; resetAt?: number; resetEstimated?: boolean }) => window.key === "fiveHour");
    expect(fiveHour?.resetAt).toBe(T0 + 5 * HOUR);
    expect(fiveHour?.resetEstimated).toBe(true);
  });

  it("端点**给了** resetAt → 尊重它，不估算", async () => {
    const given = T0 + 2 * HOUR;
    const { quote } = quotaWith({ fiveHour: { used: 1, cap: 14, resetAt: given } });
    const snapshot = await quote.snapshot("acct-1");
    const fiveHour = snapshot.windows.find((window: { key: string; resetAt?: number; resetEstimated?: boolean }) => window.key === "fiveHour");
    expect(fiveHour?.resetAt).toBe(given);
    expect(fiveHour?.resetEstimated).toBeUndefined();
  });

  it("连续两次读取沿用同一锚点（不会每轮往后漂）", async () => {
    const { quote, advance } = quotaWith({ fiveHour: { used: 1, cap: 14 } });
    const first = await quote.snapshot("acct-1");
    advance(HOUR);
    const second = await quote.snapshot("acct-1");
    const a = first.windows.find((window: { key: string; resetAt?: number; resetEstimated?: boolean }) => window.key === "fiveHour")?.resetAt;
    const b = second.windows.find((window: { key: string; resetAt?: number; resetEstimated?: boolean }) => window.key === "fiveHour")?.resetAt;
    expect(a).toBe(T0 + 5 * HOUR);
    expect(b).toBe(a);
  });

  it("月度窗口不受影响（它有自己的周期结束来源）", async () => {
    const { quote } = quotaWith({ fiveHour: { used: 1, cap: 14 } });
    const snapshot = await quote.snapshot("acct-1");
    const monthly = snapshot.windows.find((window: { key: string; resetAt?: number; resetEstimated?: boolean }) => window.key === "monthlyCredits");
    // 没有订阅 → 月度只有消耗，没有 resetAt；不该被估算逻辑塞一个假的。
    expect(monthly?.resetAt).toBeUndefined();
    expect(monthly?.resetEstimated).toBeUndefined();
  });
});
