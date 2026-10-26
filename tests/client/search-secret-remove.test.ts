/**
 * 搜索密钥的增删（2026-10-20 报障的回归测试）。
 *
 * 需求：「密钥添加后还是无法移除」。
 *
 * 根因（两处，都是真缺陷）：
 * 1. **增删只写草稿、从不落盘**。2026-10-20 上一轮把输入类字段改成「等卡片保存按钮」之后，
 *    `searchApiKeyRefs` 这条通道就没有出口了 —— 它在页面上根本没有对应的输入框，所以也没有
 *    任何一根保存按钮会替它落盘。于是「点 × 之后列表回来了」。
 * 2. **删除读的是快照，不是草稿**。刚添加的那一条先进草稿，`adopt` 要等一次往返才吸收进快照；
 *    期间点删除拿旧快照去 `filter`，自然删不掉刚加的那条。
 *
 * 这两条都必须由**容器层**（真远程调用 + 真设置写入）来钉，页面层看不出来。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { elementsOfSim, settleSim, findSim, fireSim, installMiniReact, type MiniReact } from "../support/container-sim";
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

describe("添加密钥", () => {
  it("写入凭据库，并把引用名**落盘**到承载行的设置文档", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-test-1" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    // 真 key 进了凭据库，且没有写空密钥。
    expect(host.credentialWrites).toEqual([{ ref: "DEEPSEEK_API_KEY", secret: "sk-test-1" }]);
    // 引用名列表进了设置文档（**这是「刷新后还在」与「能删除」的前提**）。
    expect(storedRefs(host)).toEqual(["DEEPSEEK_API_KEY"]);
    // 界面立刻显示这一条。
    expect(secretRows(page.tree())).toEqual(["DEEPSEEK_API_KEY"]);
  });

  it("宿主拒绝写凭据时给出原因，且不留半条引用名", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    host.failCredentialOnce = "the credentials service is read-only";
    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-test-1" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    expect(findSim(page.tree(), "data-secret-error")).toBeDefined();
    // 失败不该把引用名写进设置文档（否则界面会列出「一把不存在的钥匙」）。
    expect(storedRefs(host)).toBeUndefined();
    expect(secretRows(page.tree())).toEqual([]);
  });
});

describe("删除密钥（报障：添加后无法移除）", () => {
  it("点 × → 从设置文档里真的删掉，界面上也消失", async () => {
    const mini = await runtime();
    await freshSeams();
    // 已有一条：凭据库里有，设置文档里也记着。
    const host = fakeHost(mini, {
      secretRefs: ["DEEPSEEK_API_KEY"],
      credentialsInitially: ["DEEPSEEK_API_KEY"],
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(secretRows(page.tree())).toEqual(["DEEPSEEK_API_KEY"]);

    fireSim(findSim(page.tree(), "data-secret-remove", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);

    // 设置文档里真的没有了 —— 这是「无法移除」的正解。
    expect(storedRefs(host)).toEqual([]);
    expect(secretRows(page.tree())).toEqual([]);
  });

  it("**刚添加的那一条**也能立刻删除（草稿优先，不看快照）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-test-1" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);
    expect(secretRows(page.tree())).toEqual(["DEEPSEEK_API_KEY"]);

    // 紧接着删：此时普通快照可能还没吸收这一条，删除必须靠草稿算得出来。
    fireSim(findSim(page.tree(), "data-secret-remove", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);

    expect(storedRefs(host)).toEqual([]);
    expect(secretRows(page.tree())).toEqual([]);
  });

  it("删掉中间一条后编号复用：再加回来仍是 _2，不会一路涨到 _3", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      secretRefs: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2", "DEEPSEEK_API_KEY_3"],
      credentialsInitially: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2", "DEEPSEEK_API_KEY_3"],
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-remove", "DEEPSEEK_API_KEY_2"), "onClick");
    await settleSim(mini);
    expect(storedRefs(host)).toEqual(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_3"]);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-test-2" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    // 复用空洞：回到 `_2`，而不是继续 `_4`。
    expect(host.credentialWrites.at(-1)!.ref).toBe("DEEPSEEK_API_KEY_2");
    expect(storedRefs(host)).toEqual(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_3", "DEEPSEEK_API_KEY_2"]);
  });

  it("老宿主（没有凭据服务）时密钥区整块不渲染 —— 不留死按钮", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { credentials: false });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    expect(findSim(page.tree(), "data-secret-add")).toBeUndefined();
    expect(findSim(page.tree(), "data-secret-input")).toBeUndefined();
  });
});
