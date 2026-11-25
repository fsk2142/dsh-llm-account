/**
 * P1：账号操作的刷新范围。
 *
 * 旧实现用一个全局 `accountRevision`：在任一家点「使用」/删账号/改模型，都会让
 * 设置页重读三家完整 `status()`（逐账号额度）和跨厂商 `usageReport()`。
 *
 * 这里用真实容器 + fake host 钉住：
 * 1. 单家账号操作只重读那一家；
 * 2. 清空台账只重读报表，不重读任何厂商额度；
 * 3. 首次挂载仍读全部（不能把局部优化做成“另外两家永远不加载”）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { findSim, fireSim, installMiniReact, settleSim, type MiniReact } from "../support/container-sim";
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

async function pageContainer(host: ReturnType<typeof fakeHost>): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t: dictionaryOf("zh") });
}

afterEach(async () => {
  (await runtime()).reset();
  vi.useRealTimers();
});

describe("账号变更只刷新目标厂商", () => {
  it("在 opendesign 点「使用」→ 只重读 opendesign，不碰另外两家", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: {
        commandcode: [{ ref: "cc-1", label: "CC", configured: true, active: true, effective: true }],
        "dsh-opencode-go": [{ ref: "oc-1", label: "OC", configured: true, active: true, effective: true }],
        opendesign: [
          { ref: "od-1", label: "OD 1", configured: true, active: true, effective: true },
          { ref: "od-2", label: "OD 2", configured: true, active: false, effective: false },
        ],
      },
      usageReport: () => ({ lastUsed: undefined, failuresByAccount: [] }),
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    host.statusCalls.length = 0;
    host.modelCalls.length = 0;
    const reportsBefore = host.usageCalls.filter((call) => call.method === "usageReport").length;

    fireSim(findSim(page.tree(), "data-account-use", "od-2"), "onClick", {});
    await settleSim(mini);

    expect(host.usageCalls.some((call) => call.method === "selectAccount" && call.vendor === "opendesign")).toBe(true);
    expect(host.statusCalls, "另外两家的额度不该被重新读取").toEqual(["opendesign"]);
    expect(host.modelCalls, "目录也只刷新目标厂商").toEqual(["opendesign"]);
    expect(host.usageCalls.filter((call) => call.method === "usageReport").length, "账号操作不该刷新跨厂商报表").toBe(reportsBefore);
  });

  it("清空台账 → 只重读 usageReport，不重读三家 status", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "CC", configured: true, active: true, effective: true }] },
      usageReport: () => ({ lastUsed: undefined, failuresByAccount: [] }),
      usageClear: () => undefined,
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    host.statusCalls.length = 0;
    host.modelCalls.length = 0;
    const reportsBefore = host.usageCalls.filter((call) => call.method === "usageReport").length;

    fireSim(findSim(page.tree(), "data-usage-clear"), "onClick", {});
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-usage-clear-confirm"), "onClick", {});
    await settleSim(mini);

    expect(host.usageCalls.some((call) => call.method === "usageClear")).toBe(true);
    expect(host.statusCalls, "清台账不是账号变更，不该重读额度").toEqual([]);
    expect(host.modelCalls, "清台账也不该重读模型目录").toEqual([]);
    expect(
      host.usageCalls.filter((call) => call.method === "usageReport").length,
      "报表必须刷新",
    ).toBeGreaterThan(reportsBefore);
  });
});
