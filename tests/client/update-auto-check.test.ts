/**
 * 打开设置页就**自动**检查更新（2026-10-21 用户要求）。
 *
 * 用户原话：「每次打开设置页就自动检查更新并提示吧，别手动点了」。
 *
 * 这条的分寸：自动查，但**不能每次开关设置页都打一次网络** —— 设置页会被反复开关。
 * 折中是模块级缓存：本页面会话查过一次就不再问，刷新页面后重新查。
 *
 * 断言的是容器行为（`createConnectedPage`），不是页面纯渲染 ——
 * `PageShell` 只负责显示，发起检查的是容器。
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

/** 造设置页容器。 */
async function pageContainer(host: ReturnType<typeof fakeHost>): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t: dictionaryOf("zh") });
}

/** 复位模块级状态（含更新缓存）。 */
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

/** 装一个只对更新接口作答的假 fetch，返回调用计数。 */
function stubUpdateFetch(available: boolean): { calls: () => number } {
  let count = 0;
  vi.stubGlobal(
    "fetch",
    (async (input: unknown) => {
      count += 1;
      const url = String(input);
      if (!url.includes("/dsh-market/api/v1/updates")) {
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({
          package: {
            source: "github",
            installedVersion: "0.1.0",
            latestVersion: available ? "0.2.0" : "0.1.0",
            updateAvailable: available,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  );
  return { calls: () => count };
}

describe("打开设置页自动检查更新", () => {
  it("**挂载就查一次**，不需要点按钮", async () => {
    const mini = await runtime();
    await freshSeams();
    const fetchStub = stubUpdateFetch(true);
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    await settleSim(mini);

    expect(fetchStub.calls(), "应当自动请求过一次更新接口").toBeGreaterThan(0);

    // 结论已经进了状态：标题行右侧显示「有新版本」。
    const { elementsOfSim, textsOfSim } = await import("../support/container-sim");
    const meter = elementsOfSim(page.tree()).find((element) => element.props["data-update-meter"] !== undefined);
    expect(meter, "标题行里应当有更新控件").toBeDefined();
    expect(textsOfSim(meter).join(" ")).toContain("有新版本");
    page.unmount();
  });

  it("**同一页面会话内反复开关设置页不重复查**（模块级缓存）", async () => {
    const mini = await runtime();
    await freshSeams();
    const fetchStub = stubUpdateFetch(false);
    const host = fakeHost(mini);

    const first = mini.mount(await pageContainer(host));
    await settleSim(mini);
    await settleSim(mini);
    const afterFirst = fetchStub.calls();
    expect(afterFirst).toBeGreaterThan(0);
    first.unmount();

    // 再开一次：不该再打网络（结论已经缓存）。
    const second = mini.mount(await pageContainer(host));
    await settleSim(mini);
    await settleSim(mini);
    expect(fetchStub.calls(), "第二次挂载不该重复请求").toBe(afterFirst);
    second.unmount();
  });
});
