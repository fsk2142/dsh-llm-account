/**
 * 用量面板的刷新按钮必须有反馈（用户 2026-10-22 报障）。
 *
 * 用户原话：「用量面板的刷新按钮没反应，既不转圈也不刷新内容」。
 *
 * ## 根因
 *
 * `createDashboardView` 给 `Dashboard` 的 `onRefresh` 是 `() => load()`，而 `load()`
 * 是**同步函数** —— 它把异步结果吞在 `.then` 里，自己立刻返回。于是点刷新后：
 *
 * - 面板没有任何加载态（props 里根本没有「正在刷新」这个字段）
 * - 用户看不到任何反馈，只能怀疑按钮坏了
 *
 * ## 修法
 *
 * `load()` 改成返回 Promise；容器新增 `refreshing` 状态，点击时置 true（按钮
 * disabled + `aria-busy` → 复用 `css.ts` 已有的旋转动画），读完后在 `finally` 里复位。
 *
 * ## 这条测试钉住的契约
 *
 * 点击后、请求还在路上的那一刻，按钮必须带加载态标记。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { installMiniReact, settleSim, type MiniReact } from "../support/container-sim";
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

/** 复位模块级状态。 */
async function freshSeams(): Promise<void> {
  const { resetSeams } = await import("../../src/client/seams");
  const { resetShell } = await import("../../src/client/shell");
  resetSeams();
  resetShell();
}

afterEach(async () => {
  (await runtime()).reset();
  vi.unstubAllGlobals();
});

describe("用量面板刷新按钮", () => {
  it("**点刷新后按钮进入加载态**（不能毫无反馈）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const { createDashboardView } = await import("../../src/client/seams");
    const { VENDORS } = await import("../../src/client/shell");
    const { dictionaryOf } = await import("../../src/client/copy");
    const { elementsOfSim } = await import("../support/container-sim");

    const view = createDashboardView({
      ctx: host.ctx as never,
      entries: VENDORS,
      t: dictionaryOf("zh"),
      onClose: () => undefined,
    });
    const mounted = mini.mount(view);
    // 首次加载排空：让面板进入稳定态（否则后续断言会与初始加载混淆）。
    await settleSim(mini);
    await settleSim(mini);

    const findRefresh = (): { props: Record<string, unknown> } | undefined =>
      elementsOfSim(mounted.tree()).find((element) => element.props["data-dashboard-refresh"] !== undefined);

    const before = findRefresh();
    expect(before, "面板上应当有刷新按钮").toBeDefined();
    // 稳定态：不该带加载标记。
    expect(before?.props["data-dashboard-refreshing"], "初始不该是加载态").toBeUndefined();

    // 点一下（**不**排空：要在请求还在路上的那一刻断言）。
    (before?.props.onClick as (() => void) | undefined)?.();
    // 让 setRefreshing(true) 落地并渲染一轮；**不**排空（请求还在路上）。
    await Promise.resolve();
    const instance = mini.live[0];
    expect(instance, "应当有一个活着的实例").toBeDefined();
    mini.settleInstance(instance!);

    const during = findRefresh();
    expect(during?.props["data-dashboard-refreshing"], "加载中应当有 data-dashboard-refreshing").toBe("true");
    expect(during?.props["aria-busy"], "加载中 aria-busy 应为 true（触发旋转动画）").toBe("true");
    expect(during?.props.disabled, "加载中按钮应 disabled，防止重复点击").toBe(true);

    // 读完后恢复。
    await settleSim(mini);
    const after = findRefresh();
    expect(after?.props["data-dashboard-refreshing"], "读完后应恢复").toBeUndefined();
    expect(after?.props.disabled, "读完后应可再次点击").toBeUndefined();

    mounted.unmount();
  });
});
