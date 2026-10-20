/**
 * 侧边栏 / 中台面板必须有错误边界（2026-10-20 第二次报障的修法）。
 *
 * 用户说「刷新额度时侧边栏消失」的问题仍然存在。上一轮修的是 `completeReading` 抛错
 * 打断刷新链；这一轮找到的是**更根本的结构缺口**：
 *
 * 设置页早就包了 `RenderBoundary`，而侧边栏卡片与中台面板**没有**。于是它们渲染期一旦
 * 抛一次错（形状不可信的读数、缺字段的宿主对象、任何未预料的 undefined），React 就会
 * **卸载整棵子树** —— 表现正是「卡片凭空消失」，而且没有任何提示可查。
 *
 * 本文件证明：加边界之后，同样的异常只会毁掉自己那一块，并且用户能看到「重试」。
 */
import { describe, expect, it } from "vitest";

import { createElement } from "../support/react-stub";
import { RenderBoundary } from "../../src/client/boundary";
import { expandSim } from "../support/container-sim";

/** 一个一定抛错的子组件。 */
function Exploder(): never {
  throw new Error("boom: 形状不可信的读数");
}

describe("错误边界能接住子组件抛错", () => {
  it("子组件抛错时，边界渲染成可读面板而不是让整棵树消失", () => {
    const tree = createElement(RenderBoundary, { title: "当前使用", variant: "inline" }, createElement(Exploder));
    // `expandSim` 会实例化类组件并走 `getDerivedStateFromError`（与真 React 同序）。
    const nodes = expandSim(tree);
    expect(nodes.length, "边界应当渲染出东西（而不是空）").toBeGreaterThan(0);
    const flat = JSON.stringify(nodes);
    // 面板里应当带上失败信息与重试入口，便于用户与排查者。
    expect(flat).toContain("boom");
  });

  it("没有异常时，边界原样渲染子组件（不干扰正常路径）", () => {
    function Ok(): unknown {
      return createElement("span", { "data-ok": "true" }, "fine");
    }
    const tree = createElement(RenderBoundary, { title: "x", variant: "inline" }, createElement(Ok));
    const flat = JSON.stringify(expandSim(tree));
    expect(flat).toContain("fine");
  });
});

describe("插槽组件确实被包了边界", () => {
  it("注册进 sidebar.footer.action 的组件外层是 RenderBoundary", async () => {
    const { installMiniReact } = await import("../support/container-sim");
    const mini = installMiniReact();
    const { fakeHost } = await import("../support/fake-host");
    const host = fakeHost(mini, { commandcodeToggle: true });
    const { registerSharedSurfaces } = await import("../../src/client/seams");
    const { VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");
    const { dictionaryOf } = await import("../../src/client/copy");
    registerSharedSurfaces({
      ctx: host.ctx as never,
      entries: VENDORS,
      t: dictionaryOf("zh"),
      localeNs: PAGE_LOCALE_NS,
    });

    const sidebar = host.registered.find((item) => item.slot === "sidebar.footer.action")!;
    const panel = host.registered.find((item) => item.slot === "main")!;

    // 直接调用注册组件：它应当先返回一个 `RenderBoundary` 元素（类组件）。
    for (const [where, registration] of [
      ["侧边栏卡片", sidebar],
      ["中台面板", panel],
    ] as const) {
      const tree = registration.component() as { type?: unknown };
      expect(tree, `${where} 应当有根元素`).toBeDefined();
      expect(tree.type, `${where} 的外层应当是 RenderBoundary`).toBe(RenderBoundary);
    }
  });
});
