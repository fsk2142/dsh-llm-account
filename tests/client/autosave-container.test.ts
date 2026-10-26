/**
 * 改了就存 + 卡片内保存。
 *
 * 需求（第一轮）：「任何选项修改了就是直接保存，不需要那个保存按钮了，除非是需要填写什么东西的
 * 逻辑，然后再对应的卡片中显示保存就可以，不需要在最下面保留那个保存按钮了」。
 * 需求（第二轮）：「不用那个填入了，一个卡片保留一个保存按钮，点完保存后按钮消失，
 * 如果复原则不显示保存」。
 *
 * 这个文件钉住**容器层**的行为：
 * - 开关/下拉：改一个字段 → 立刻产生一次远程写入（不等按钮）；
 * - 输入框：改完**不**写，点卡片里的保存按钮才写；
 * - 写的一律是**命中的行名**（宿主按条目 id 寻址，opencode 是 `opencode-go`）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { settleSim, findSim, fireSim, installMiniReact, type MiniReact, type SimElement } from "../support/container-sim";
import { fakeHost } from "../support/fake-host";

/**
 * 把 `react` 替成 mini-react，并通过 `__mini` 暴露驱动句柄。
 *
 * 工厂里用**动态** import：`vi.mock` 的工厂会被提升到文件顶部，
 * 静态 import 在这里还没初始化（vitest 会报 `Cannot access '__vi_import_N__'`）。
 */
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

/**
 * 拿**同一个** mini-react 实例。
 *
 * 不能每次 `installMiniReact()` 新建：插件级单例（seams / shell）是模块级的，
 * 换了实例就对不上，页面会渲染成空的。
 */
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

/** 模块级共享状态的复位（插件级单例/存储/镜像）。 */
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

describe("开关：改了就存", () => {
  it("拨「显示设置」的开关 → 立刻写入宿主，不需要点保存", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 页面底部没有保存条（需求去掉）。
    expect(findSim(page.tree(), "data-save-bar")).toBeUndefined();

    fireSim(findSim(page.tree(), "data-field-input", "showSidebarQuota"), "onChange", {
      target: { checked: true },
    });
    await settleSim(mini);

    // 已经落盘：宿主收到一次写入，且写的是行 id（`llm-commandcode`）。
    expect(host.mutations.length).toBeGreaterThan(0);
    const last = host.mutations.at(-1)!;
    expect(last.row).toBe("llm-commandcode");
    expect(last.ops).toEqual([{ op: "set", path: ["showSidebarQuota"], value: true }]);
    // 开关不会留下草稿，所以也不该出现保存按钮。
    expect(findSim(page.tree(), "data-save")).toBeUndefined();
  });
});

describe("输入框：卡片里的保存按钮", () => {
  it("改了 baseURL 但不点保存 → 不写宿主；点了才写，且写 opencode 的行 id", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-field-input", "baseURL"), "onChange", {
      target: { value: "https://manual.example" },
    });
    await settleSim(mini);
    // 还没写：输入类要等用户点保存。
    expect(host.mutations).toHaveLength(0);
    // 但按钮出现了，且属于 opencode 那一家。
    const save = findSim(page.tree(), "data-save", "llm-opencode-go");
    expect(save).toBeDefined();

    fireSim(save, "onClick");
    await settleSim(mini);

    const last = host.mutations.at(-1)!;
    // 宿主按条目 id 寻址；写命名空间会落空。
    expect(last.row).toBe("opencode-go");
    expect(last.ops).toEqual([{ op: "set", path: ["baseURL"], value: "https://manual.example" }]);
    // 存完按钮消失（草稿与基线一致了）。
    expect(findSim(page.tree(), "data-save")).toBeUndefined();
  });

  it("把输入改回原值 → 保存按钮不出现（「复原则不显示保存」）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    const original = host.rows.get("opencode-go")!.value.baseURL as string;
    const input = (): SimElement | undefined => findSim(page.tree(), "data-field-input", "baseURL");
    fireSim(input(), "onChange", { target: { value: "https://typo.example" } });
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save", "llm-opencode-go")).toBeDefined();

    // 改回原值：草稿条目被删掉，于是不需要保存。
    fireSim(input(), "onChange", { target: { value: original } });
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save", "llm-opencode-go")).toBeUndefined();
  });

  it("写入失败时错误显示在卡片里，再点一次保存就重试成功", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    host.failOnce = "the credentials service rejected the write";
    fireSim(findSim(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://edited.example" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settleSim(mini);

    // 界面上有失败提示，宿主的原文在 data 属性上供排查。
    const error = findSim(page.tree(), "data-save-error", "llm-commandcode");
    expect(error?.props["data-save-error-reason"]).toBe("the credentials service rejected the write");
    // 底部那条早就没了 —— 错误挂在卡片里。
    expect(findSim(page.tree(), "data-save-bar")).toBeUndefined();

    // 再点一次保存（等价于用户重试）：这次写成功，错误消失。
    fireSim(findSim(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save-error")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://edited.example");
  });

  it("修订号冲突后重读，再点保存即成功（乐观修订号猜不得）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { conflictOnce: true });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(findSim(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://first.example" } });
    await settleSim(mini);
    fireSim(findSim(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settleSim(mini);

    // 并发写者把修订号 +1：这次写入必须失败并提示（而不是带着旧修订号静默丢写）。
    expect(findSim(page.tree(), "data-save-error", "llm-commandcode")).toBeDefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://api.commandcode.ai");

    // 重读过宿主，修订号是新的 → 再点保存成功。
    fireSim(findSim(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save-error")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://first.example");
  });

  it("连续拨两个开关（改了就存）不会互相撞修订号", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 同一拍里连拨两个开关：写入选修号围栏 + 串行队列，两次都必须成功。
    fireSim(findSim(page.tree(), "data-field-input", "showSidebarQuota"), "onChange", { target: { checked: true } });
    fireSim(findSim(page.tree(), "data-field-input", "autoSwitchModelOnQuota"), "onChange", { target: { checked: true } });
    await settleSim(mini);

    expect(findSim(page.tree(), "data-save-error")).toBeUndefined();
    const row = host.rows.get("llm-commandcode")!.value;
    expect(row.showSidebarQuota).toBe(true);
    expect(row.autoSwitchModelOnQuota).toBe(true);
  });
});
