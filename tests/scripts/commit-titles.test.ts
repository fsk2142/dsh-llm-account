/**
 * 提交标题规则的**生产实现**回归测试（2026-11-05，F08）。
 *
 * ## 为什么要写下这个文件
 *
 * v2.0.0 的 CI 红了一整轮，原因只是 1.9.12 的标题 74 > 72。修复方式是按 SHA
 * 豁免已发布历史，而不是放宽上限 —— 于是必须有测试钉住**两件相反的事**：
 *
 * 1. 已发布的那条确实被豁免（否则 CI 继续红）；
 * 2. 上限**没有**被放宽（否则未来 80 字符的标题也能过，等于把检查废掉）。
 *
 * 这两条必须同时成立，所以断言要成对写。测试 import 的是
 * `scripts/commit-titles.mjs` 的**同一份实现**，不是复制品。
 */
import { describe, expect, it } from "vitest";

import { GRANDFATHERED, MAX_LEN, problemsOf, partition } from "../../scripts/commit-titles.mjs";

/** 被豁免的那条真实标题（74 字符）。 */
const RELEASED_1912 = "fix: project assistant history images without blocking compaction (1.9.12)";
/** 它在仓库里的真实 SHA。 */
const RELEASED_1912_SHA = "d9036c3ea20363231ce16af6c3185e12cf6c9ff9";

describe("commit titles：已发布历史按 SHA 豁免", () => {
  it("1.9.12 那条（74 字符）在豁免后不再失败", () => {
    const result = partition([{ sha: RELEASED_1912_SHA, subject: RELEASED_1912 }]);
    expect(result.failed).toEqual([]);
    expect(result.exempted).toBe(1);
    expect(result.checked).toBe(0);
  });

  it("**豁免不能按标题生效**：同一标题换个 SHA 仍要失败", () => {
    const result = partition([{ sha: "0".repeat(40), subject: RELEASED_1912 }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.problems.join()).toContain(String(MAX_LEN));
  });

  it("豁免集合只放完整 40 位小写十六进制 SHA", () => {
    expect(GRANDFATHERED.size).toBeGreaterThan(0);
    for (const sha of GRANDFATHERED) expect(sha, "必须是完整 40 位小写 SHA").toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("commit titles：上限没有被放宽", () => {
  it("恰好 72 字符合规，73 字符失败（边界是闭区间）", () => {
    const at = `fix: ${"a".repeat(MAX_LEN - "fix: ".length)}`;
    expect(at.length).toBe(MAX_LEN);
    expect(problemsOf(at)).toEqual([]);

    const over = `${at}b`;
    expect(over.length).toBe(MAX_LEN + 1);
    expect(problemsOf(over).join()).toContain(`${MAX_LEN + 1}`);
  });

  it("新提交即使超过豁免条目的长度也照样失败", () => {
    const result = partition([{ sha: "1".repeat(40), subject: `feat: ${"x".repeat(80)}` }]);
    expect(result.failed).toHaveLength(1);
  });
});

describe("commit titles：其余判据保持不变", () => {
  it("缺 type 前缀失败", () => {
    expect(problemsOf("修个 bug")).toHaveLength(1);
  });

  it("未知 type 失败", () => {
    expect(problemsOf("wip: 半成品")).toHaveLength(1);
  });

  it("标题里带日期失败（全角与半角括号都算）", () => {
    expect(problemsOf("fix: 修好了（2026-11-04）")).toHaveLength(1);
    expect(problemsOf("fix: 修好了 (2026-11-04)")).toHaveLength(1);
  });

  it("合规标题不报问题", () => {
    expect(problemsOf("fix: 修一个边界")).toEqual([]);
    expect(problemsOf("feat(opencode): 支持网页登录")).toEqual([]);
  });
});
