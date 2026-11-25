/**
 * P1：侧边栏不能为了 lastUsed 反复打完整 usageReport。
 *
 * 真实容器回归：
 * - 启动建清单读每家一次，控制器首读不能重复读第一家；
 * - 有轻量 usageLastUsed 时，绝不调用完整 usageReport；
 * - 老宿主没有轻量接口时仍回退 usageReport（兼容不回归）。
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

function account(ref: string): Record<string, unknown> {
  return {
    ref,
    label: ref,
    configured: true,
    active: ref === "cc-1",
    effective: ref === "cc-1",
    quota: { windows: [{ key: "rolling", percent: 40 }] },
    failures: [],
  };
}

async function mountCard(host: ReturnType<typeof fakeHost>) {
  const mini = await runtime();
  const { registerSharedSurfaces, startSharedState } = await import("../../src/client/seams");
  const { VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  startSharedState(host.ctx as never, VENDORS);
  registerSharedSurfaces({ ctx: host.ctx as never, entries: VENDORS, t: dictionaryOf("zh"), localeNs: PAGE_LOCALE_NS });
  const entry = host.registered.find((item) => item.slot === "sidebar.footer.action")!;
  return mini.mount(entry.component);
}

describe("侧边栏读取单飞", () => {
  it("两家启动各读一次；轻量 lastUsed 不触发完整 usageReport", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      commandcodeToggle: true,
      opencodeToggle: true,
      opendesignToggle: true,
      accounts: { commandcode: [account("cc-1")], "dsh-opencode-go": [account("oc-1")] },
      usageLastUsed: () => ({ vendor: "dsh-opencode-go", account: "oc-1", model: "m1", at: Date.now() }),
      usageReport: () => ({ accounts: [], total: { window: "all", bucket: { period: "", since: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, ok: 0, failed: 0, successRate: 100 }, byVendor: [] } }),
    });
    const card = await mountCard(host);
    await settleSim(mini);

    expect(host.statusCalls.join(","), "启动建清单与控制器首读应共用同一次 status").toBe("commandcode,dsh-opencode-go,opendesign");
    expect(host.usageCalls.some((call) => call.method === "usageLastUsed")).toBe(true);
    expect(host.usageCalls.some((call) => call.method === "usageReport"), "侧边栏不该为 lastUsed 打完整报表").toBe(false);
    card.unmount();
  });

  it("每次轮询刷新轻量 lastUsed，但仍不调用完整 usageReport", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    let lastUsed = { vendor: "commandcode", account: "cc-1", model: "m1", at: Date.now() };
    const host = fakeHost(mini, {
      commandcodeToggle: true,
      opencodeToggle: true,
      accounts: { commandcode: [account("cc-1")], "dsh-opencode-go": [account("oc-1")] },
      usageLastUsed: () => lastUsed,
      usageReport: () => ({ accounts: [], total: { window: "all", bucket: { period: "", since: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, ok: 0, failed: 0, successRate: 100 }, byVendor: [] } }),
    });
    const card = await mountCard(host);
    await settleSim(mini);
    const before = host.usageCalls.filter((call) => call.method === "usageLastUsed").length;
    expect(before).toBeGreaterThan(0);
    const { sidebarLastUsed } = await import("../../src/client/seams");
    expect(sidebarLastUsed()?.account).toBe("cc-1");

    lastUsed = { vendor: "dsh-opencode-go", account: "oc-1", model: "m2", at: Date.now() + 1 };
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);

    expect(host.usageCalls.filter((call) => call.method === "usageLastUsed").length, "下一拍必须刷新最近使用账号").toBeGreaterThan(before);
    expect(sidebarLastUsed()?.account, "新请求的账号必须真正写入侧边栏目标缓存").toBe("oc-1");
    expect(host.usageCalls.some((call) => call.method === "usageReport")).toBe(false);
    card.unmount();
  });

  it("老宿主没有 usageLastUsed 时仍回退 usageReport", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      commandcodeToggle: true,
      accounts: { commandcode: [account("cc-1")] },
      usageReport: () => ({ accounts: [], total: { window: "all", bucket: { period: "", since: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, ok: 0, failed: 0, successRate: 100 }, byVendor: [] }, lastUsed: { vendor: "commandcode", account: "cc-1", model: "m1", at: Date.now() } }),
    });
    const card = await mountCard(host);
    await settleSim(mini);

    expect(host.statusCalls.join(","), "跟随模式三家各读一次，不能重复读").toBe("commandcode,dsh-opencode-go,opendesign");
    expect(host.usageCalls.some((call) => call.method === "usageReport")).toBe(true);
    card.unmount();
  });
});
