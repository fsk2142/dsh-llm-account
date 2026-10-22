/**
 * 更新**完成后**弹出刷新提示（2026-10-22 用户要求）。
 *
 * 用户原话：「更新完自动弹出提示框」「能够通过弹出刷新页面的形式避免重新启动的操作」。
 *
 * ## 为什么这条路径必须有测试
 *
 * 第一版把检测挂在 `applyShell` 里，结果**永远不会触发**（`apply` 只在页面加载时跑，
 * 更新后不重跑）。改成在 `runUpdate` 的成功分支里主动弹之后，这条路径就成了唯一
 * 生效的实现 —— 它没有测试，坏了也没人知道。
 *
 * 这里驱动真实容器（`createConnectedPage` + 真实 `runUpdate`），只把网络与 DOM
 * 换成替身。
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

async function pageContainer(host: ReturnType<typeof fakeHost>): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t: dictionaryOf("zh") });
}

async function freshSeams(): Promise<void> {
  const { resetSeams } = await import("../../src/client/seams");
  const { resetShell } = await import("../../src/client/shell");
  const { resetDriftNoticeForTest } = await import("../../src/client/drift-notice");
  resetSeams();
  resetShell();
  resetDriftNoticeForTest();
}

afterEach(async () => {
  (await runtime()).reset();
  vi.unstubAllGlobals();
  (globalThis as { document?: unknown }).document = undefined;
});

/** 一个够用的假 document（提示框会往 body 里挂节点）。 */
function fakeDocument(): { document: unknown; appended: unknown[] } {
  const appended: unknown[] = [];
  const make = (): unknown => {
    const node = {
      id: "",
      className: "",
      style: {},
      textContent: "",
      children: [] as unknown[],
      handlers: {} as Record<string, () => void>,
      setAttribute() {},
      appendChild(child: unknown) {
        node.children.push(child);
        return child;
      },
      addEventListener(type: string, handler: () => void) {
        node.handlers[type] = handler;
      },
      remove() {},
    };
    return node;
  };
  return {
    document: {
      body: {
        appendChild: (node: unknown) => {
          appended.push(node);
          return node;
        },
      },
      createElement: make,
      getElementById: () => null,
      location: { reload: () => undefined },
    },
    appended,
  };
}

/**
 * 更新接口的假 fetch：POST 返回 202+operationId，轮询返回 succeeded。
 * @returns 调用计数（判断有没有真的发起更新）。
 */
function stubUpdateFetch(): { starts: () => number } {
  let starts = 0;
  vi.stubGlobal(
    "fetch",
    (async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (url.includes("/dsh-market/api/v1/updates") && init?.method === "POST") {
        starts += 1;
        return new Response(
          JSON.stringify({ schema: "dsh-market/update-api/v1", operation: { operationId: "op-1", state: "running" } }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/dsh-market/api/v1/operations")) {
        return new Response(JSON.stringify({ operation: { state: "succeeded", refreshRequired: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // 其余（更新检查）返回「有新版」。
      return new Response(
        JSON.stringify({
          package: { source: "github", installedVersion: "0.7.0", latestVersion: "0.8.0", updateAvailable: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch,
  );
  return { starts: () => starts };
}

/** 在树里找带某个属性的元素。 */
function findByProp(
  elements: readonly { props: Record<string, unknown> }[],
  prop: string,
): { props: Record<string, unknown> } | undefined {
  return elements.find((element) => element.props[prop] !== undefined);
}

describe("更新完成后弹出刷新提示", () => {
  it("**走完 runUpdate 后，页面上出现刷新提示**", async () => {
    const mini = await runtime();
    await freshSeams();
    const fetchStub = stubUpdateFetch();
    const dom = fakeDocument();
    (globalThis as { document?: unknown }).document = dom.document;

    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    await settleSim(mini);

    // 点「更新」按钮。
    const { elementsOfSim } = await import("../support/container-sim");
    const start = findByProp(elementsOfSim(page.tree()), "data-update-start");
    expect(start, "设置页里应当有更新按钮").toBeDefined();
    (start?.props.onClick as (() => void) | undefined)?.();
    await settleSim(mini);
    await settleSim(mini);
    await settleSim(mini);

    // 真的发起了更新。
    expect(fetchStub.starts(), "应当发起一次更新请求").toBe(1);
    // 提示框被挂到 body 上。
    expect(dom.appended.length, "更新成功后应当弹出提示框").toBeGreaterThan(0);
  });

  it("更新失败时不弹（只有成功才提示刷新）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.stubGlobal(
      "fetch",
      (async (input: unknown, init?: { method?: string }) => {
        const url = String(input);
        if (url.includes("/dsh-market/api/v1/updates") && init?.method === "POST") {
          return new Response(JSON.stringify({ operation: { operationId: "op-1" } }), {
            status: 202,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/dsh-market/api/v1/operations")) {
          return new Response(JSON.stringify({ operation: { state: "failed", code: "RELEASE_TOO_FRESH" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            package: { source: "github", installedVersion: "0.7.0", latestVersion: "0.8.0", updateAvailable: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    );
    const dom = fakeDocument();
    (globalThis as { document?: unknown }).document = dom.document;

    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    await settleSim(mini);

    const { elementsOfSim } = await import("../support/container-sim");
    const start = findByProp(elementsOfSim(page.tree()), "data-update-start");
    (start?.props.onClick as (() => void) | undefined)?.();
    await settleSim(mini);
    await settleSim(mini);

    expect(dom.appended.length, "更新失败不该弹刷新提示").toBe(0);
  });
});
