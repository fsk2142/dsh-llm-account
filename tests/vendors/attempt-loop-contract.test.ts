/**
 * **源码契约**：三家适配器不许再各写一份「尝试策略」。
 *
 * ## 为什么用源码断言而不是行为用例
 *
 * 这次重构的收益不是「行为变对了」，而是「以后只改一处」。行为用例保不住这个性质：
 * 谁把策略抄回去，行为仍然是对的，测试全绿，直到某天一处修复漏掉两家才会炸
 * （2026-11-06 的条数上限就是这样：只修了 opendesign）。
 *
 * 所以这里直接读源码，断言三件**结构性**的事：
 *
 * 1. 三家都从 `core/attempt-ledger` 取记账层；
 * 2. 三家都不再自己写「抛哪一条失败」的选择（那正是 11-06 误报的来源）；
 * 3. 三家都不再自己维护 `tried` 集合与 `maxTried` 比较（上限语义只有一份）。
 *
 * 这类断言很「硬」，但它的代价是改结构时要同步改这里 —— 那正是我们想要的摩擦力。
 */
import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";

/** 三家的适配器源码路径（相对仓库根）。 */
const ADAPTERS = [
  ["opendesign", "src/vendors/opendesign/adapter.ts"],
  ["opencode", "src/vendors/opencode/adapter.ts"],
  ["commandcode", "src/vendors/commandcode/adapter.ts"],
] as const;

/** 读一份源码。 */
async function sourceOf(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("尝试策略只有一份实现", () => {
  it.each(ADAPTERS)("%s 使用共享记账层 AttemptLedger", async (_name, path) => {
    const source = await sourceOf(path);
    expect(source, "必须从 core/attempt-ledger 取记账层").toMatch(/from "\.\.\/\.\.\/core\/attempt-ledger"/u);
    expect(source, "必须真的构造它").toMatch(/new AttemptLedger\(/u);
  });

  it.each(ADAPTERS)("%s 不再自己选择「用尽时抛哪一条」", async (_name, path) => {
    const source = await sourceOf(path);
    // 这段选择逻辑 2026-11-06 在三家各错一次：「抛最后一条」让宿主不肯重试。
    expect(source, "不许直接调 pickExhaustedFailure（那是记账层的职责）").not.toMatch(/pickExhaustedFailure/u);
  });

  it.each(ADAPTERS)("%s 不再自己维护 tried 集合与上限比较", async (_name, path) => {
    const source = await sourceOf(path);
    expect(source, "不许再 `new Set<string>()` 存 tried").not.toMatch(/const tried = new Set<string>\(\)/u);
    expect(source, "不许再手写 `tried.size >= …maxTried()` 判断").not.toMatch(/tried\.size >= /u);
  });

  it("三家都不再各自声明 AttemptFailure（类型只有一份）", async () => {
    for (const [, path] of ADAPTERS) {
      const source = await sourceOf(path);
      expect(source, `${path} 不该再声明 AttemptFailure 接口`).not.toMatch(/interface AttemptFailure\b/u);
    }
  });
});
