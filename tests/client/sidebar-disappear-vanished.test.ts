/**
 * 侧边栏「刷新额度时消失」——**逐帧复现**（2026-10-20 第二次报障）。
 *
 * 上一轮我修了 `completeReading` 抛错打断刷新链的问题，但用户说症状**仍然存在**。
 * 所以这一轮换方法：不猜路径，而是把刷新期间**可能出现的每一种读数形状**都喂一遍，
 * 检查卡片在哪些形状下会「消失」（`relatedTargets` 变空 → 组件 return null）。
 *
 * 重点怀疑：`sidebarTargetsOf` 要求 `account.configured === true`。如果刷新中的某一次读数
 * 暂时丢了 `configured`（或账号表为空），`targets` 就会瞬间为空 —— 而卡片正是靠 targets
 * 决定「有没有东西可显示」的。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { elementsOfSim, installMiniReact, settleSim, type MiniReact } from "../support/container-sim";
import { fakeHost, type FakeHost } from "../support/fake-host";

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

async function runtime(): Promise<MiniReact> {
  return (await import("react") as unknown as { __mini: MiniReact }).__mini;
}

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

/** 一个完整账号（带额度）。 */
function fullAccount(): Record<string, unknown> {
  return {
    ref: "acct-1",
    label: "Work",
    configured: true,
    active: true,
    effective: true,
    quota: { windows: [{ key: "rolling", percent: 40 }], resetAt: 1_800_000_000_000 },
    failures: [],
  };
}

async function mountCard(host: FakeHost): Promise<{ tree: () => unknown; unmount: () => void }> {
  const mini = await runtime();
  const { registerSharedSurfaces, startSharedState } = await import("../../src/client/seams");
  const { VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  startSharedState(host.ctx as never, VENDORS);
  registerSharedSurfaces({ ctx: host.ctx as never, entries: VENDORS, t: dictionaryOf("zh"), localeNs: PAGE_LOCALE_NS });
  const entry = host.registered.find((item) => item.slot === "sidebar.footer.action")!;
  const mounted = mini.mount(entry.component);
  await settleSim(mini);
  return { tree: () => mounted.tree(), unmount: () => mounted.unmount() };
}

/** 卡片当前是否显示了内容（null = 消失）。 */
function visible(tree: unknown): boolean {
  return tree !== null && tree !== undefined;
}

/** 卡片里有没有额度行。 */
function quotaRows(tree: unknown): number {
  return elementsOfSim(tree).filter((element) => element.props["data-sidebar-window"] !== undefined).length;
}

describe("刷新期间各种读数形状：卡片会不会消失", () => {
  it("刷新返回**空账号表**（服务端瞬时异常）→ 卡片不该消失", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [fullAccount()] } });
    const card = await mountCard(host);
    expect(visible(card.tree())).toBe(true);
    expect(quotaRows(card.tree())).toBeGreaterThan(0);

    // 下一次读数的账号表是空的 —— 这在凭据读取失败 / 服务端抖动时真的会发生。
    host.accountsOverride = { commandcode: [] };
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(visible(card.tree()), "空账号表不该让卡片消失").toBe(true);
    card.unmount();
    vi.useRealTimers();
  });

  it("刷新返回的账号**暂时没有 configured 字段** → 卡片不该消失", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [fullAccount()] } });
    const card = await mountCard(host);
    expect(visible(card.tree())).toBe(true);

    // 形状退化的读数：账号在，但 `configured` 丢了（线上形状不可信）。
    const degraded = { ...fullAccount() };
    delete degraded.configured;
    host.accountsOverride = { commandcode: [degraded] };
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(visible(card.tree()), "configured 缺失不该让卡片消失").toBe(true);
    card.unmount();
    vi.useRealTimers();
  });

  it("刷新返回的**额度窗口为空** → 卡片仍在（只是没数字可说）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [fullAccount()] } });
    const card = await mountCard(host);

    host.accountsOverride = {
      commandcode: [{ ...fullAccount(), quota: { windows: [], failures: [] } }],
    };
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(visible(card.tree()), "额度窗口为空不该让卡片消失").toBe(true);
    card.unmount();
    vi.useRealTimers();
  });
});
