/**
 * 同一行**一次往返内连续两次写入**不许丢（2026-10-20 独立审查发现 1）。
 *
 * ## 缺陷
 *
 * `saveRow` 的在途守卫是：
 *
 * ```ts
 * // 注释：已经有一轮保存/写在途：直接把这一轮排到它后面，不并发发两份。
 * if (savingRowInFlight.current.has(ns)) return writeQueue.current;   // ← 提前返回
 * ```
 *
 * 注释说「排队」，实现是**提前返回** —— 第二次写入既没落盘、也没有任何提示。
 *
 * ## 可达路径（用户真的能踩到）
 *
 * 搜索密钥的删除按钮没有 busy 守卫（「添加」「测试」都有）。一次写入往返内点两个删除：
 * 删 A → 草稿变 `[B]`、写入在途；删 B → 草稿变 `[]` → 命中守卫 → **被吞**。
 *
 * ## 测试为什么必须挂起写入
 *
 * `fakeHost` 的 `mutate` 默认同步 resolve —— 「在途」窗口在那种环境下**根本不存在**，
 * 两次点击会串行跑完。所以这里用 `holdMutation` 把第一次写入停在半路，
 * 在真正的在途状态下点第二次。
 *
 * **实测教训**：不做挂起时，把守卫改回「提前返回」，测试仍然全绿（变异检验漏报）。
 * 夹具必须能表达「写入未完成」这个状态，测试才真的在测那件事。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  elementsOfSim,
  fireSim,
  installMiniReact,
  settleSim,
  type MiniReact,
  type SimElement,
} from "../support/container-sim";
import { fakeHost } from "../support/fake-host";

vi.mock("react", async () => {
  const stub = await import("../support/react-stub");
  const mini = installMiniReact();
  return {
    createElement: stub.createElement,
    Fragment: stub.Fragment,
    Component: stub.Component,
    useState: mini.useState,
    useEffect: mini.useEffect,
    useRef: mini.useRef,
    memo: (component: unknown) => component,
    __mini: mini,
  };
});

/** 取迷你运行时。 */
async function runtime(): Promise<MiniReact> {
  return (await import("react") as unknown as { __mini: MiniReact }).__mini;
}

/** 造设置页容器（真实生产代码）。 */
async function pageContainer(host: ReturnType<typeof fakeHost>): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t: dictionaryOf("zh") });
}

/** 模块级共享状态的复位。 */
async function freshSeams(): Promise<void> {
  const { resetSeams } = await import("../../src/client/seams");
  const { resetShell } = await import("../../src/client/shell");
  resetSeams();
  resetShell();
}

afterEach(async () => {
  (await runtime()).reset();
  vi.useRealTimers();
});

/** 搜索卡里当前的引用名（按页面渲染顺序）。 */
function secretRows(tree: unknown): string[] {
  return elementsOfSim(tree)
    .filter((element) => element.props["data-secret-row"] !== undefined)
    .map((element) => String(element.props["data-secret-row"]));
}

/** 承载行里的引用名（宿主文档真实值）。 */
function storedRefs(host: ReturnType<typeof fakeHost>): unknown {
  return host.rows.get("llm-commandcode")!.value["searchApiKeyRefs"];
}

/** 找到某一行引用名对应的删除按钮（标记是 `data-secret-remove`，值是 ref）。 */
function removeButton(tree: unknown, ref: string): SimElement {
  const hit = elementsOfSim(tree).find((element) => element.props["data-secret-remove"] === ref);
  if (hit === undefined) throw new Error(`no remove button for ${ref}`);
  return hit;
}

describe("同一行一次往返内连点两个删除", () => {
  it("**第二个删除必须生效**（旧实现在途时提前返回，把它静默吞掉）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { secretRefs: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"] });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 起点确认：两条都在。
    expect(secretRows(page.tree()).sort()).toEqual(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"]);
    expect(storedRefs(host)).toEqual(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"]);

    // **把写入停住**，制造真实的「在途」窗口。
    host.holdMutation = true;

    // 删第一个：草稿变 `[第二个]`，写入开始但挂起。
    fireSim(removeButton(page.tree(), "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);

    // 删第二个：草稿变 `[]`。**此时第一轮写入还在途** —— 这正是缺陷的触发点。
    fireSim(removeButton(page.tree(), "DEEPSEEK_API_KEY_2"), "onClick");
    await settleSim(mini);

    // 放行所有挂起的写入，让它们跑完。
    host.holdMutation = false;
    for (let index = 0; index < 8; index += 1) {
      host.releaseMutation();
      await settleSim(mini);
    }

    // **关键断言**：磁盘上两条都删掉了。
    // 旧实现（在途时提前返回）在这里会留下一条没删掉的引用名。
    expect(storedRefs(host), "两次删除都必须落盘").toEqual([]);
    expect(secretRows(page.tree())).toEqual([]);
  });

  it("只点一次删除时行为不变", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { secretRefs: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"] });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(removeButton(page.tree(), "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);
    await settleSim(mini);

    expect(storedRefs(host)).toEqual(["DEEPSEEK_API_KEY_2"]);
    expect(secretRows(page.tree())).toEqual(["DEEPSEEK_API_KEY_2"]);
  });
});
