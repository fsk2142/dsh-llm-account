/**
 * 密钥实测。
 *
 * 需求：「添加了 key 后就发起一次小请求验证一下是否可用，不可用的话就进行提示吧」
 * +「或者多增加一个测试按钮，让用户可以自行测试密钥的有效性」。
 *
 * 三档结论的语义（这是本文件真正要钉住的东西）：
 * - `ok`      → 「可用」
 * - `invalid` → 「不可用」（服务端明确拒绝：401/402/403）
 * - `unknown` → 「暂时无法验证」——**绝不能说成不可用**。网络抖动不该让用户去换一把其实
 *   没问题的密钥，那是最难自查的误导。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  elementsOfSim,
  findSim,
  fireSim,
  installMiniReact,
  settleSim,
  type MiniReact,
} from "../support/container-sim";
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

/** 取迷你运行时。 */
async function runtime(): Promise<MiniReact> {
  return (await import("react") as unknown as { __mini: MiniReact }).__mini;
}

/** 造设置页容器（真实生产代码）。 */
async function pageContainer(host: FakeHost): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t: dictionaryOf("zh") });
}

/** 复位模块级共享状态。 */
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

/** 某一把密钥那一行的实测标签（`undefined` = 没有标签）。 */
function probeOf(tree: unknown, ref: string): { state: string; text: string; reason?: unknown } | undefined {
  const row = elementsOfSim(tree).find((element) => element.props["data-secret-row"] === ref);
  if (row === undefined) return undefined;
  const badge = elementsOfSim(row).find((element) => element.props["data-secret-probe"] !== undefined);
  if (badge === undefined) return undefined;
  return {
    state: String(badge.props["data-secret-probe"]),
    text: elementsOfSim(badge).map((element) => String(element.props.children ?? "")).join(""),
    reason: badge.props["data-secret-probe-reason"],
  };
}

describe("添加后自动实测一次", () => {
  it("加完立刻调 probeSearchCredential，并显示「可用」", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-good" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    // 真的去测了（不是只在界面上写一句「已保存」）。
    expect(host.probeCalls).toEqual([["DEEPSEEK_API_KEY"]]);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")?.state).toBe("ok");
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")?.text).toBe("可用");
  });

  it("密钥无效时当场提示「不可用」，并带上宿主给的原因", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    host.probeVerdicts["DEEPSEEK_API_KEY"] = { state: "invalid", reason: "API key 无效或缺失（401）" };
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-bad" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    const probe = probeOf(page.tree(), "DEEPSEEK_API_KEY");
    expect(probe?.state).toBe("invalid");
    expect(probe?.text).toBe("不可用");
    // 原文在 data 属性上（界面说人话，排查要能拿到宿主原话）。
    expect(probe?.reason).toBe("API key 无效或缺失（401）");
  });

  it("**测不出来**时不说「不可用」（网络抖动不是密钥的错）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    host.probeVerdicts["DEEPSEEK_API_KEY"] = { state: "unknown", reason: "network unreachable" };
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-input"), "onChange", { target: { value: "sk-maybe" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-secret-add"), "onClick");
    await settleSim(mini);

    const probe = probeOf(page.tree(), "DEEPSEEK_API_KEY");
    expect(probe?.state).toBe("unknown");
    expect(probe?.text).toBe("暂时无法验证");
    expect(probe?.text).not.toBe("不可用");
  });
});

describe("手动测试按钮", () => {
  it("每把已添加的密钥都有「测试」按钮，点了就再测一次", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { secretRefs: ["DEEPSEEK_API_KEY"], credentialsInitially: ["DEEPSEEK_API_KEY"] });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    const button = findSim(page.tree(), "data-secret-test", "DEEPSEEK_API_KEY");
    expect(button, "应该有测试按钮").toBeDefined();
    // 还没测过时没有任何结论标签（不给暗示）。
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")).toBeUndefined();

    fireSim(button, "onClick");
    await settleSim(mini);

    expect(host.probeCalls).toEqual([["DEEPSEEK_API_KEY"]]);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")?.state).toBe("ok");
  });

  it("结论可以随复测改变（先失败后成功 → 标签跟着变）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { secretRefs: ["DEEPSEEK_API_KEY"], credentialsInitially: ["DEEPSEEK_API_KEY"] });
    host.probeVerdicts["DEEPSEEK_API_KEY"] = { state: "invalid", reason: "402 余额不足" };
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-test", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")?.text).toBe("不可用");

    // 充值后复测：结论必须更新，而不是永远停在第一次的判断上。
    host.probeVerdicts["DEEPSEEK_API_KEY"] = { state: "ok" };
    fireSim(findSim(page.tree(), "data-secret-test", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")?.text).toBe("可用");
  });

  it("删掉密钥时它的实测结论一并清掉（不留一条描述已删密钥的记录）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { secretRefs: ["DEEPSEEK_API_KEY"], credentialsInitially: ["DEEPSEEK_API_KEY"] });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-secret-test", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")).toBeDefined();

    fireSim(findSim(page.tree(), "data-secret-remove", "DEEPSEEK_API_KEY"), "onClick");
    await settleSim(mini);
    expect(host.rows.get("llm-commandcode")!.value["searchApiKeyRefs"]).toEqual([]);
    expect(probeOf(page.tree(), "DEEPSEEK_API_KEY")).toBeUndefined();
  });

  it("老宿主（没有实测通道）时不渲染测试按钮 —— 不留点不动的按钮", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { credentials: false });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(findSim(page.tree(), "data-secret-test")).toBeUndefined();
  });
});
