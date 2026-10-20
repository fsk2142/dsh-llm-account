/**
 * 侧边栏卡片「不重启就不出现」（2026-10-20 用户报障）。
 *
 * 用户原话：「如果我不重启，侧边栏就无法出来，是否可以提示刷新页面的方式，这样就不需要我重启了」。
 *
 * 这条报告有一个重要的潜台词：**刷新页面就够了，重启不需要**。也就是说插件侧的状态是好的，
 * 缺的只是「让浏览器重新走一遍客户端启动图」。所以本文件先钉住两件事：
 *
 * 1. 卡片在「开关从关到开」之后应当自己出现（不需要刷新、更不需要重启）；
 * 2. 如果宿主侧确实不会重新求值插槽，那我们至少要**在界面上给出可操作的提示**。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { installMiniReact, settleSim, type MiniReact } from "../support/container-sim";
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

/** 一个有额度的账号。 */
function account(): Record<string, unknown> {
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

/** 走真实注册路径挂上卡片。 */
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

describe("开关从关到开：卡片应当自己出现", () => {
  it("**冷启动后**再打开开关（宿主广播设置变化）→ 卡片出现，不需要刷新页面", async () => {
    // 这个场景正是「不重启就不出现」：卡片组件在开关关闭时就已挂载（槽位常驻注册），
    // 冷启动兜底读过一次设置（那时开关是关的，`sidebarVendorSeeded()` 变 true）。
    // 之后用户在设置页把开关打开 → 宿主写设置文档并广播 `settings/document-updated`。
    // 期望：卡片自己跟着出现。若这里失败，说明兜底那次读取把「已 seeded」永久写死了。
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { commandcodeToggle: false, accounts: { commandcode: [account()] } });
    const card = await mountCard(host);

    // 初始：开关关闭 → 卡片渲染 null。
    expect(card.tree()).toBeNull();

    // 用户打开开关（写入宿主文档 + 广播）。
    const row = host.rows.get("llm-commandcode")!;
    row.value = { ...row.value, showSidebarQuota: true };
    row.revision += 1;
    host.emitDocumentUpdated();
    await settleSim(mini);

    expect(card.tree(), "打开开关后卡片应当自己出现").not.toBeNull();
    card.unmount();
  });

  it("第二次打开（关→开→关→开）也能出现", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { commandcodeToggle: true, accounts: { commandcode: [account()] } });
    const card = await mountCard(host);
    expect(card.tree()).not.toBeNull();

    // 关掉
    let row = host.rows.get("llm-commandcode")!;
    row.value = { ...row.value, showSidebarQuota: false };
    row.revision += 1;
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(card.tree()).toBeNull();

    // 再打开：仍然要能出现（不能「只灵一次」）
    row = host.rows.get("llm-commandcode")!;
    row.value = { ...row.value, showSidebarQuota: true };
    row.revision += 1;
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(card.tree(), "第二次打开也该出现").not.toBeNull();
    card.unmount();
  });
});
