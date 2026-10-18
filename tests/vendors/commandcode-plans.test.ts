/**
 * 套餐表测试：`subscriptionPlanInfo` 与官方 CLI 的 `Sr`/`wr` 两张表逐条对照。
 *
 * 参照物：`command-code@1.84.0` 的 `dist/cli.mjs`（2026-10-18 抽取），
 * `{name, monthlyCredits}` 与旧插件 `KNOWN_SUBSCRIPTION_PLANS`（第 941-995 行）一致。
 */
import { expect, it } from "vitest";

import { SUBSCRIPTION_PLANS, subscriptionPlanInfo } from "../../src/vendors/commandcode/plans";

it("表本身与官方 CLI 的套餐表一一对应（不多不少）", () => {
  expect(SUBSCRIPTION_PLANS).toEqual({
    "individual-go": { name: "Go", monthlyCredits: 10 },
    "individual-go-v1": { name: "Go", monthlyCredits: 10 },
    "individual-goat": { name: "GOAT", monthlyCredits: 70 },
    "individual-pro": { name: "Pro", monthlyCredits: 30 },
    "individual-pro-v1": { name: "Pro", monthlyCredits: 80 },
    "individual-provider": { name: "Provider", monthlyCredits: 15 },
    "individual-max": { name: "Max", monthlyCredits: 150 },
    "individual-ultra": { name: "Ultra", monthlyCredits: 300 },
    "teams-pro": { name: "Teams Pro", monthlyCredits: 40 },
  });
});

it("已知套餐给出名称与每月额度（线上账号 GOAT = 70，5h/weekly 上限 14/35 正好是它的 1/5、1/2）", () => {
  expect(subscriptionPlanInfo("individual-goat")).toEqual({ name: "GOAT", monthlyCredits: 70 });
  expect(subscriptionPlanInfo("individual-go")).toEqual({ name: "Go", monthlyCredits: 10 });
  expect(subscriptionPlanInfo("individual-max")).toEqual({ name: "Max", monthlyCredits: 150 });
  expect(subscriptionPlanInfo("individual-ultra")).toEqual({ name: "Ultra", monthlyCredits: 300 });
  expect(subscriptionPlanInfo("teams-pro")).toEqual({ name: "Teams Pro", monthlyCredits: 40 });
});

it("最长前缀优先：`individual-pro-v1` 用 80 而不是 30（旧插件同一处用最长前缀）", () => {
  expect(subscriptionPlanInfo("individual-pro-v1")).toEqual({ name: "Pro", monthlyCredits: 80 });
  expect(subscriptionPlanInfo("individual-pro")).toEqual({ name: "Pro", monthlyCredits: 30 });
  expect(subscriptionPlanInfo("individual-go-v1")).toEqual({ name: "Go", monthlyCredits: 10 });
});

it("标识先规范化（小写、下划线折成连字符），前缀之后的后缀照旧命中", () => {
  expect(subscriptionPlanInfo("INDIVIDUAL_GOAT")).toEqual({ name: "GOAT", monthlyCredits: 70 });
  expect(subscriptionPlanInfo("individual-goat-2026-annual")).toEqual({ name: "GOAT", monthlyCredits: 70 });
  expect(subscriptionPlanInfo("  individual-goat  ")).toEqual({ name: "GOAT", monthlyCredits: 70 });
});

it("表里没有的标识就是没有名称与额度：界面退回标识原文，不猜", () => {
  expect(subscriptionPlanInfo("individual-new-tier")).toBeUndefined();
  expect(subscriptionPlanInfo("goat")).toBeUndefined();
  expect(subscriptionPlanInfo("")).toBeUndefined();
  expect(subscriptionPlanInfo("   ")).toBeUndefined();
});
