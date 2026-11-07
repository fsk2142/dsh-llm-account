/**
 * **源码契约**：三家适配器不许再自己实现回合循环。
 *
 * ## 为什么用源码断言而不是行为用例
 *
 * 抽取共享回合循环（`core/attempt-loop`）的收益不是「行为变对了」，而是「以后只改一处」。
 * 行为用例保不住这个性质：谁把循环抄回去，行为仍然是对的、测试全绿，直到某天一处修复
 * 漏掉两家才会炸 —— 2026-11-06 的条数上限就只修了 opendesign，另两家留着同样的坑。
 *
 * 所以这里直接读源码，断言四件**结构性**的事：
 *
 * 1. 三家都走 `runAttemptLoop`；
 * 2. 不自己选账号、不自己判「已输出就不换号」（那是循环的职责）；
 * 3. 不自己选「用尽时抛哪一条」；
 * 4. 不自己维护 `tried` 集合、上限比较与 `AttemptFailure` 类型。
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

/**
 * 读一份源码，并**剥掉注释**。
 *
 * 必须剥：适配器头部的文档仍会提到 `rotation.pick` 之类的旧描述，那是给人读的说明，
 * 不是实现。断言应该看代码，不看注释。
 * @param path - 相对仓库根的路径。
 * @returns 去掉注释的源码。
 */
async function sourceOf(path: string): Promise<string> {
  const raw = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("回合循环只有一份实现", () => {
  it.each(ADAPTERS)("%s 使用共享回合循环 runAttemptLoop", async (_name, path) => {
    const source = await sourceOf(path);
    expect(source, "必须从 core/attempt-loop 取循环").toMatch(/from "\.\.\/\.\.\/core\/attempt-loop"/u);
    expect(source, "必须真的调用它").toMatch(/runAttemptLoop</u);
  });

  it.each(ADAPTERS)("%s 不再自己选账号、不自己判换号闸门", async (_name, path) => {
    const source = await sourceOf(path);
    // 这两件事 2026-11-06 在三家各写一遍，是「同一个 bug 修三次」的根源。
    expect(source, "不许再自己调 rotation.pick").not.toMatch(/rotation\.pick\(/u);
    expect(source, "不许再自己判 fallbackAllowed").not.toMatch(/fallbackAllowed\(/u);
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
