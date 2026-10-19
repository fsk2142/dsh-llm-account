/**
 * 「跟随最近一次请求」的纯判定（用户 2026-10-19 要求取代轮播）。
 *
 * 为什么用「最近一次请求」而不是「当前显示的会话」：宿主的 `remote.session` 只有按
 * `sessionId` 查询的接口，**没有**「前端当前打开哪个会话」（扫过 asar 全部调用点确认）。
 * 而刚发过请求的会话几乎必然就是用户在看的那个。
 *
 * 这些用例钉住三件事：
 * 1. 有新鲜的最近使用 → 一定显示它（即使 `turn` 指向别的账号）；
 * 2. 它不在清单里（被删了 / 未勾选）→ 退回轮播，而不是显示一个不存在的账号；
 * 3. 过期 → 退回轮播（不能把昨天的记录当成「当前」）。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_FRESH_TTL_MS, isLastUsedFresh, lastUsedAccountOf } from "../../src/core/last-used";
import { sidebarCurrentTarget, type SidebarTarget } from "../../src/client/page-state";
import type { UsageRecord } from "../../src/core/usage-stats";

/** 造一条台账记录。 */
function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    vendor: "commandcode",
    account: "cc-1",
    at: 1_000,
    outcome: "success",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "deepseek-v4.1-flash",
    ...overrides,
  };
}

/** 造一个轮播目标。 */
function target(vendor: string, ref: string): SidebarTarget {
  return { vendor, ref };
}

describe("lastUsedAccountOf：从台账里找最近一次", () => {
  it("取时刻最大的那一条", () => {
    const found = lastUsedAccountOf([
      record({ account: "old", at: 1_000 }),
      record({ account: "newest", at: 5_000 }),
      record({ account: "middle", at: 3_000 }),
    ]);
    expect(found).toEqual({ vendor: "commandcode", account: "newest", model: "deepseek-v4.1-flash", at: 5_000 });
  });

  it("跳过匿名的失败记录（空 account）", () => {
    const found = lastUsedAccountOf([record({ account: "", at: 9_000 }), record({ account: "real", at: 1_000 })]);
    expect(found?.account).toBe("real");
  });

  it("按 known 过滤掉已经不存在的账号", () => {
    const found = lastUsedAccountOf(
      [record({ account: "deleted", at: 9_000 }), record({ account: "alive", at: 1_000 })],
      (_vendor, account) => account === "alive",
    );
    expect(found?.account).toBe("alive");
  });

  it("一条可用记录都没有时为 undefined", () => {
    expect(lastUsedAccountOf([])).toBeUndefined();
    expect(lastUsedAccountOf([record({ account: "" })])).toBeUndefined();
  });
});

describe("isLastUsedFresh：过期就不该当「当前」", () => {
  it("TTL 内算新鲜", () => {
    expect(isLastUsedFresh(1_000, 1_000 + 60_000)).toBe(true);
  });

  it("超过 TTL 不算", () => {
    expect(isLastUsedFresh(1_000, 1_000 + DEFAULT_FRESH_TTL_MS + 1)).toBe(false);
  });

  it("时钟回拨也当作新鲜（宁可显示刚用过的，也不要在抖动时闪回第一家）", () => {
    expect(isLastUsedFresh(1_000, 500)).toBe(true);
  });

  it("非法时刻不算新鲜", () => {
    expect(isLastUsedFresh(0, 1_000)).toBe(false);
    expect(isLastUsedFresh(Number.NaN, 1_000)).toBe(false);
  });
});

describe("sidebarCurrentTarget：跟随优先，轮播兜底", () => {
  const targets = [target("commandcode", "cc-1"), target("opendesign", "od-1")];
  const now = 1_000_000;

  it("有新鲜的最近使用 → 显示它，即使 turn 指向别的账号", () => {
    const picked = sidebarCurrentTarget(
      targets,
      { vendor: "opendesign", account: "od-1", at: now - 60_000 },
      0, // turn 指向 cc-1
      now,
    );
    expect(picked).toEqual(target("opendesign", "od-1"));
  });

  it("最近使用不在清单里（被删/未勾选）→ 退回轮播", () => {
    const picked = sidebarCurrentTarget(
      targets,
      { vendor: "opendesign", account: "gone", at: now - 60_000 },
      1,
      now,
    );
    expect(picked).toEqual(target("opendesign", "od-1"));
  });

  it("最近使用过期 → 退回轮播", () => {
    const picked = sidebarCurrentTarget(
      targets,
      { vendor: "opendesign", account: "od-1", at: now - DEFAULT_FRESH_TTL_MS - 1 },
      0,
      now,
    );
    expect(picked).toEqual(target("commandcode", "cc-1"));
  });

  it("没有最近使用 → 退回轮播（用户从没发过请求时的正常路径）", () => {
    expect(sidebarCurrentTarget(targets, undefined, 1, now)).toEqual(target("opendesign", "od-1"));
  });

  it("清单为空 → undefined（卡片由此进入空态）", () => {
    expect(sidebarCurrentTarget([], { vendor: "x", account: "y", at: now }, 0, now)).toBeUndefined();
  });
});
