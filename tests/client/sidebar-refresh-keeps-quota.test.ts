/**
 * 侧边栏额度在刷新时消失（2026-10-20 报障）—— 直击真正的时序。
 *
 * 第一轮我写的 4 条用例全绿，说明**我模拟的路径不对**。这一轮针对真实链路里那个会清空
 * 读数的分支：`vendors.length === 0` 时 `setView({ stale: false })` 会把 `status` 丢掉，
 * 而 `vendors` 来自设置快照的重读 —— 那正是刷新 / 保存设置会触发的东西。
 *
 * 关键断言：**一次设置读取失败（或读到空）不该被当成「用户关掉了卡片」**。
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

/** 一个带额度的已配置账号。 */
function accountWithQuota(): Record<string, unknown> {
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

/** 侧边栏的额度行（每行一条进度条）。 */
function quotaRows(tree: unknown): number {
  return elementsOfSim(tree).filter((element) => element.props["data-sidebar-window"] !== undefined).length;
}

describe("设置重读不该把卡片清空", () => {
  it("设置读取**失败一次**时，卡片与额度都保持原样", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [accountWithQuota()] } });
    const card = await mountCard(host);
    expect(quotaRows(card.tree()), "首帧应有额度行").toBeGreaterThan(0);

    // 宿主设置服务这次没读出来（返回空快照）：`noteSidebarSnapshots` 会**跳过**空快照，
    // 所以卡片应当照旧 —— 这条钉住那个「不写入空快照」的纪律。
    host.describeReturnsEmptyOnce = true;
    host.emitDocumentUpdated();
    await settleSim(mini);

    expect(card.tree(), "设置读取失败不该让卡片消失").not.toBeNull();
    expect(quotaRows(card.tree()), "设置读取失败不该清空额度").toBeGreaterThan(0);
    card.unmount();
    vi.useRealTimers();
  });

  it("保存无关设置字段后，卡片与额度都还在", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [accountWithQuota()] } });
    const card = await mountCard(host);
    expect(quotaRows(card.tree())).toBeGreaterThan(0);

    // 用户在设置页改了个不相干的字段并落盘 → 宿主广播设置变化。
    const row = host.rows.get("llm-commandcode")!;
    row.value = { ...row.value, quotaRefreshMinutes: 10 };
    row.revision += 1;
    host.emitDocumentUpdated();
    await settleSim(mini);

    expect(quotaRows(card.tree()), "保存设置后额度不该消失").toBeGreaterThan(0);
    card.unmount();
  });

  it("轮询刷新一次后额度仍在（基本盘）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [accountWithQuota()] } });
    const card = await mountCard(host);
    const before = host.statusCalls.length;

    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls.length).toBeGreaterThan(before);
    expect(quotaRows(card.tree())).toBeGreaterThan(0);

    card.unmount();
    vi.useRealTimers();
  });

  it("刷新失败一次后保留「上次数据」，不清空", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [accountWithQuota()] } });
    const card = await mountCard(host);
    expect(quotaRows(card.tree())).toBeGreaterThan(0);

    host.statusFailOnce = "gateway/timeout: upstream did not answer";
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(quotaRows(card.tree()), "一次读失败不该清空已有额度").toBeGreaterThan(0);
    card.unmount();
    vi.useRealTimers();
  });
});

describe("读数形状不完备时不得抛错（真机崩溃的根因）", () => {
  it("`completeReading` 对缺失的 failures/windows 有防护，不抛错", async () => {
    const { completeReading } = await import("../../src/client/seams");
    // 线上真见过这些形状：`quota` 在但没有 `failures`/`windows`；`status.failures` 缺失。
    const shapes: unknown[] = [
      { vendor: "commandcode", capabilities: {}, accounts: [{ ref: "a", configured: true, quota: {} }] },
      { vendor: "commandcode", capabilities: {}, accounts: [{ ref: "a", configured: true, quota: { windows: [] } }] },
      { vendor: "commandcode", accounts: [{ ref: "a", configured: true, quota: null }] },
      { vendor: "commandcode", accounts: [{ ref: "a", configured: true }] },
      { vendor: "commandcode", accounts: [] },
      {},
    ];
    for (const [index, shape] of shapes.entries()) {
      // 只要求「不抛」：抛错会让整次刷新中断，那正是「额度消失」的症状。
      expect(() => completeReading(shape as never), `shape #${index}`).not.toThrow();
    }
  });

  it("形状不完备的一次读数不会打断刷新（卡片仍有额度）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [accountWithQuota()] } });
    const card = await mountCard(host);
    expect(quotaRows(card.tree())).toBeGreaterThan(0);

    // 下一次读数里账号带 quota 但缺 failures：旧代码会在这里抛，刷新链断掉。
    host.accountsOverride = {
      commandcode: [{ ...accountWithQuota(), quota: { windows: [{ key: "rolling", percent: 55 }] } }],
    };
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(quotaRows(card.tree()), "形状不完备不该让刷新中断").toBeGreaterThan(0);
    card.unmount();
    vi.useRealTimers();
  });
});
