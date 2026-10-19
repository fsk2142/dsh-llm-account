/**
 * 容器渲染仿真：把三个容器组件（设置页、侧边栏卡片、中栏仪表盘）**真正挂载起来**跑流程。
 *
 * 为什么需要这个文件：Ruling 22 的自觉取舍让容器（唯一的 Hook 宿主）不参与单测 ——
 * 测试用的 React 替身会把 Hook 调用判为失败。代价是容器**接线**没有进程内覆盖，例如
 * 「保存失败时把原因落进页面状态」「关掉开关后卡片真的停轮询」这些行为只由 1c 真机验证。
 * 变异检验证实了这一点：把 `onSave` 改回静默失败，当时的测试套件全绿。
 *
 * 本文件通过 `vi.mock("react", …)` 把 Hook 换成 `tests/support/container-sim.ts` 的迷你运行时，
 * 被测的仍然是**生产代码**：`startSharedState` / `registerSharedSurfaces` / `createConnectedPage`
 * 原样参与，插槽、设置服务、远程命名空间都由 `tests/support/fake-host.ts` 提供（形状贴着真实
 * 宿主与本机已装的旧插件产物）。
 *
 * 这里是**手写脚本**：一次只改一个东西，断言精确。随机序列那半在
 * `randomized-simulation.test.ts`（同一套夹具）。
 *
 * 覆盖的行为（全部是此前只有真机能验的）：
 * 1. 字段编辑 → 保存 → 写的是**命中的行名**（opencode 写 `opencode-go` 而不是命名空间）；
 * 2. 保存失败时保存条出现可读原因（不再是静默失败 —— 这条杀掉了一个存活变异）；
 * 3. 修订号冲突后重读重放：第二次保存成功；
 * 4. 账户操作（添加）经容器走到远程命名空间（表单能真的打开并提交）；
 * 5. 侧边栏卡片开关生命周期：关闭 → 渲染 null + 推进时间零新增请求；开启 → 立即读 + 60s 轮询；
 *    再关闭 → 定时器停掉（规格 §8.1 第 6 条 / 冒烟 C13 的进程内版）；
 * 6. 外部改动（`settings/document-updated`）时卡片跟随；多家同开时跟第一家；
 * 7. usage 远程面只 `$mount` 一次（两个 profile 行共享），页面卸载不 dispose；
 * 8. 插槽注册形状（`id`/`order` 与 `key`），卡片「打开面板」与面板「关闭」都走 `layout.selectPanel`。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { VendorCardsContext } from "../../src/client/seams";
import {
  elementsOfSim,
  findSim,
  fireSim,
  installMiniReact,
  settleSim,
  textsOfSim,
  type MiniReact,
  type SimElement,
} from "../support/container-sim";
import { fakeHost, type FakeHost } from "../support/fake-host";

vi.mock("react", async () => {
  const stub = await import("../support/react-stub");
  const mini = installMiniReact();
  return {
    createElement: stub.createElement,
    Fragment: stub.Fragment,
    useState: mini.useState,
    useEffect: mini.useEffect,
    useRef: mini.useRef,
    // 错误边界是类组件（React 里没有函数式等价物），仿真必须提供基类。
    Component: stub.Component,
    // 测试侧要驱动这个运行时（挂载、排空、复位）。
    __mini: mini,
  };
});

/** 取迷你运行时（`vi.mock` 把它挂在 react 上导出）。 */
async function runtime(): Promise<MiniReact> {
  return (await import("react") as unknown as { __mini: MiniReact }).__mini;
}

afterEach(async () => {
  (await runtime()).reset();
  vi.useRealTimers();
});

/** 模块级共享状态的复位（每个用例都要有干净的插件级单例/存储/镜像）。 */
async function freshSeams(): Promise<void> {
  const { resetSeams } = await import("../../src/client/seams");
  const { resetShell } = await import("../../src/client/shell");
  resetSeams();
  resetShell();
}

/** 造设置页容器（真实生产代码）。 */
async function pageContainer(host: FakeHost, renderVendorCards?: (cards: VendorCardsContext) => ReactNode): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({
    entries: VENDORS,
    ctx: host.ctx as never,
    t: dictionaryOf("zh"),
    ...(renderVendorCards === undefined ? {} : { renderVendorCards }),
  });
}

/**
 * 走**真实的 apply 期引导**拿到侧边栏卡片与中栏面板的组件：`startSharedState`（usage 远程面
 * 单例 + 设置镜像）→ `registerSharedSurfaces`（常驻注册），与 `src/client/index.ts` 的 `apply`
 * 同序同物。
 *
 * 这样做而不是直接调 `createSidebarCardView`：注册路径本身也是接线的一部分 ——
 * 「打开面板」与「关闭面板」分别接的是 `layout.selectPanel(DASHBOARD_PANEL_ID)` 与
 * `selectPanel(null)`，只有经过注册才接得上；而设置镜像（`settings/document-updated` 订阅）
 * 也只有引导过才存在。
 */
async function applyLikeHost(host: FakeHost): Promise<{ card: () => unknown; panel: () => unknown }> {
  const { registerSharedSurfaces, startSharedState, DASHBOARD_PANEL_ID, SIDEBAR_SLOT } = await import("../../src/client/seams");
  const { VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  startSharedState(host.ctx as never, VENDORS);
  registerSharedSurfaces({ ctx: host.ctx as never, entries: VENDORS, t: dictionaryOf("zh"), localeNs: PAGE_LOCALE_NS });
  const sidebar = host.registered.find((entry) => entry.slot === SIDEBAR_SLOT);
  const panel = host.registered.find((entry) => entry.slot === "main");
  if (sidebar === undefined || panel === undefined) throw new Error("the shared surfaces were not registered");
  if (panel.entry["key"] !== DASHBOARD_PANEL_ID) throw new Error(`the panel is registered under ${String(panel.entry["key"])}`);
  return { card: sidebar.component, panel: panel.component };
}

/** 找元素；找不到就抛出可读的失败（静默跳过会让断言假阳性）。 */
function find(tree: unknown, marker: string, value?: string): SimElement {
  const element = findSim(tree, marker, value);
  if (element === undefined) throw new Error(`no element carries ${marker}${value === undefined ? "" : `=${value}`}`);
  return element;
}

/** 点一下（元素不存在或没有回调都抛）。 */
function click(tree: unknown, marker: string, value?: string, event: unknown = {}): void {
  fireSim(findSim(tree, marker, value), "onClick", event);
}

// —— 仿真 1：设置页容器 ————————

describe("设置页容器仿真", () => {
  it("宿主上下文读 remote 就抛错时，页面照常渲染（不再是空白，也不抛未处理异常）", async () => {
    // 症状：设置里有我们的条目，点进去什么都没有。根因之一是容器/发现路径直接读
    // `ctx.remote`，而宿主 getter 在服务未就绪时会抛 —— 异常穿到 effect 里就是未处理拒绝，
    // 页面只剩空白。现在所有读取都走 `remoteOf`（永不抛错），于是降级成正常的空态。
    const mini = await runtime();
    const ctor = await import("../../src/client/seams");
    const page = ctor.createConnectedPage({
      entries: [],
      ctx: {
        get remote(): never {
          throw new Error("boom from the host remote");
        },
        get inject(): never {
          throw new Error("boom from the host remote");
        },
      } as never,
      t: (key: string) => key,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let text: string;
    try {
      text = textsOfSim(mini.mount(page).tree()).join(" ");
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
    // 页面树被渲染出来了（而不是错误面板，也不是空白）。
    expect(text).toContain("title");
    expect(text).not.toContain("页面渲染失败");
  });

  it("字段编辑 → 保存 → 写的是命中的行名；opencode 写行 id 而不是命名空间", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 切到 opencode（合并模式没有 tab 行，用设置对象下拉），改 baseURL，保存。
    fireSim(find(page.tree(), "data-settings-target-select", "true"), "onChange", {
      target: { value: "llm-opencode-go" },
    });
    await settleSim(mini);
    fireSim(find(page.tree(), "data-field-input", "baseURL"), "onChange", { target: { value: "https://new.example" } });
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save-bar")).toBeDefined();

    click(page.tree(), "data-save", "llm-opencode-go");
    await settleSim(mini);

    // 写的是行 id `opencode-go`（宿主按条目 id 寻址；写命名空间会落空）。
    expect(host.mutations).toHaveLength(1);
    expect(host.mutations[0]!.row).toBe("opencode-go");
    expect(host.mutations[0]!.ops).toEqual([{ op: "set", path: ["baseURL"], value: "https://new.example" }]);
    // 保存成功：保存条消失（基线以宿主为准），宿主文档已更新。
    expect(findSim(page.tree(), "data-save-bar")).toBeUndefined();
    expect(host.rows.get("opencode-go")!.value.baseURL).toBe("https://new.example");
  });

  it("保存失败时保存条显示可读原因，而不是静默失败（杀掉存活变异的那条）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(find(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://edited.example" } });
    await settleSim(mini);

    host.failOnce = "the credentials service rejected the write";
    click(page.tree(), "data-save", "llm-commandcode");
    await settleSim(mini);

    // 界面上有失败提示（通用文案），宿主的原文在 data 属性上供排查。
    const error = find(page.tree(), "data-save-error", "llm-commandcode");
    expect(textsOfSim(page.tree())).toContain("保存失败，请重试。");
    expect(error.props["data-save-error-reason"]).toBe("the credentials service rejected the write");
    // 草稿与保存条都在（用户可以改完重试）。
    expect(findSim(page.tree(), "data-save-bar")).toBeDefined();

    // 重试成功：错误与保存条一起消失。
    click(page.tree(), "data-save", "llm-commandcode");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save-error")).toBeUndefined();
    expect(findSim(page.tree(), "data-save-bar")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://edited.example");
  });

  it("修订号冲突后自动重读重放：第二次保存成功（乐观修订号猜不得）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { conflictOnce: true });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    fireSim(find(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://first.example" } });
    await settleSim(mini);
    click(page.tree(), "data-save", "llm-commandcode");
    await settleSim(mini);

    // 并发写者把修订号 +1：这次保存必须失败并提示（而不是带着旧修订号静默丢写）。
    expect(findSim(page.tree(), "data-save-error", "llm-commandcode")).toBeDefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://api.commandcode.ai");

    // 用户再点一次保存：保存后重读过宿主，修订号是新的 → 成功。
    click(page.tree(), "data-save", "llm-commandcode");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-save-error")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://first.example");
  });

  it("账户操作经容器走到远程命名空间：填名称与密钥 → 添加 → addAccount(vendor, {label, key})", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    // 生产路径：账户表在标签页上方的合并面板里，不在 `renderVendorCards` 的专属卡片里。
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 底部「添加账户」：点入口展开表单 → 填名称 + 密钥 → 点提交。
    click(page.tree(), "data-action", "add");
    await settleSim(mini);
    fireSim(find(page.tree(), "data-add-label"), "onChange", { target: { value: " work " } });
    fireSim(find(page.tree(), "data-add-key"), "onChange", { target: { value: " sk-new\n" } });
    await settleSim(mini);
    click(page.tree(), "data-action", "confirmAdd");
    await settleSim(mini);

    // 走到远程命名空间；名称/密钥在派发边界上 trim 过（派发本身由 seams.test.ts 覆盖）。
    expect(host.usageCalls).toEqual([{ method: "addAccount", vendor: "commandcode", input: { label: "work", key: "sk-new" } }]);
  });

  it("点「添加账户」会展开表单（回归：入口与提交曾是同一个按钮，空提交毫无反应）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 收起时只有入口，没有输入框：点它才展开。
    expect(findSim(page.tree(), "data-add-label")).toBeUndefined();
    click(page.tree(), "data-action", "add");
    await settleSim(mini);
    // 表单已打开 → 输入框出现，且受控（值来自状态，容器不留本地状态）。
    expect(findSim(page.tree(), "data-add-label")).toBeDefined();
    fireSim(find(page.tree(), "data-add-label"), "onChange", { target: { value: "typed only" } });
    await settleSim(mini);
    expect(find(page.tree(), "data-add-label").props["value"]).toBe("typed only");
    // 表单已打开 → 出现取消与提交按钮。
    expect(findSim(page.tree(), "data-action", "cancel")).toBeDefined();
    expect(findSim(page.tree(), "data-action", "confirmAdd")).toBeDefined();
  });

  it("空名称点「确定」不再毫无反应：表单里给出原因，且一条调用都不发（2026-10-18 操作逻辑）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    click(page.tree(), "data-action", "add");
    await settleSim(mini);
    click(page.tree(), "data-action", "confirmAdd");
    await settleSim(mini);

    // 规矩不变：空名称不发调用（防住误写一个空账号）……
    expect(host.usageCalls).toEqual([]);
    // ……变的是这一次点击有可见结果：表单里写着为什么（以前是死按钮，用户无从判断）。
    expect(textsOfSim(page.tree())).toContain("请先填写账户名称。");

    // 一开始输入，原因就消失（不残留上一次的错）。
    fireSim(find(page.tree(), "data-add-label"), "onChange", { target: { value: "work" } });
    await settleSim(mini);
    expect(findSim(page.tree(), "data-action-error")).toBeUndefined();

    // 名称有了、密钥留空：仍然可以提交（「先建条目、稍后补密钥」是允许的路径），表单收起来。
    click(page.tree(), "data-action", "confirmAdd");
    await settleSim(mini);
    expect(host.usageCalls).toEqual([{ method: "addAccount", vendor: "commandcode", input: { label: "work" } }]);
    expect(findSim(page.tree(), "data-add-label")).toBeUndefined();
  });

  it("按账户刷新模型：点账号行的刷新只重读**那一家**的目录（2026-10-18 用户要求）", async () => {
    const mini = await runtime();
    await freshSeams();
    // 两家各给一个账号（第三家无账号）：刷新按钮在每个账号行上（不再有面板头部的全局按钮）。
    const host = fakeHost(mini, {
      accounts: {
        commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }],
        "dsh-opencode-go": [{ ref: "oc-1", label: "Personal", configured: true, active: false, effective: false }],
      },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 挂载即读一次三家目录（全局模型数据源只此一处）。
    expect(host.modelCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    // 每个账号行都有自己的刷新按钮；面板头部没有全局「重新获取模型」。
    expect(findSim(page.tree(), "data-account-refresh-models", "cc-1"), "账号行要有刷新按钮").toBeDefined();
    expect(findSim(page.tree(), "data-account-refresh-models", "oc-1")).toBeDefined();
    expect(findSim(page.tree(), "data-refresh-models")).toBeUndefined();

    // 点 commandcode 那个账号的：只重读 commandcode，不碰别家 ——「不是刷新所有的」。
    click(page.tree(), "data-account-refresh-models", "cc-1");
    await settleSim(mini);
    expect(host.modelCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign", "commandcode"]);
    // 读取完成后按钮恢复可用（不再转圈）。
    expect(find(page.tree(), "data-account-refresh-models", "cc-1").props["disabled"]).not.toBe(true);
  });

  it("TTL 内再次打开设置不重取：账号行与模型目录直接复用上一次的读数（2026-10-18 用户提问）", async () => {
    const mini = await runtime();
    await freshSeams();
    // 夹具是**完整**读数（每家已配置账号都带非空额度）：只有完整读数才够格进缓存。
    const host = fakeHost(mini, {
      accounts: {
        commandcode: [
          { ref: "cc-1", label: "Work", configured: true, active: true, effective: true, quota: { windows: [{ key: "fiveHour", used: 3, cap: 10, unit: "usd" }], failures: [] } },
        ],
        "dsh-opencode-go": [
          { ref: "oc-1", label: "Personal", configured: true, active: false, effective: false, quota: { windows: [{ key: "rolling", percent: 35 }], failures: [] } },
        ],
      },
    });
    const first = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 首次打开：三家各读一次状态与目录（没有可复用的读数）。
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    expect(host.modelCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);

    // 关掉设置（卸载）再打开（重新挂载）：TTL 还没过 —— 一次网络读取都不该发。
    first.unmount();
    await settleSim(mini);
    const second = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    expect(host.modelCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);

    // 数据来自缓存而不是回到空态：账号行与模型勾选照旧在。
    expect(findSim(second.tree(), "data-account", "cc-1")).toBeDefined();
    expect(findSim(second.tree(), "data-account-models", "cc-1")).toBeDefined();
    expect(findSim(second.tree(), "data-account-models", "oc-1")).toBeDefined();
  });

  it("读数不完整（额度带失败项/缺失）一律不进缓存：重开设置必须现读（2026-10-18 用户报障根因）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: {
        commandcode: [
          {
            ref: "cc-1", label: "Work", configured: true, active: true, effective: true,
            // 瞬时故障的形状：月度一条读到了，`billing/credits` 失败 —— 这次读数**不完整**。
            quota: { windows: [{ key: "monthlyCredits", used: 62.21, unit: "usd" }], failures: ["credits"] },
          },
        ],
        // 已配置但没有额度读数（额度缺席）：同样不完整。
        "dsh-opencode-go": [{ ref: "oc-1", label: "Personal", configured: true, active: false, effective: false }],
      },
    });
    const first = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    // 失败行给人话（端点短名不上屏），原文留在 data 属性上。
    const note = findSim(first.tree(), "data-account-quota-failure", "cc-1");
    expect(note).toBeDefined();
    expect(note!.props["data-failure-detail"]).toBe("credits");

    // 关掉再打开：TTL 还没过，但读数不完整 —— 必须重新现读。把一次瞬时故障缓存 60 秒，
    // 就是用户看到的「重新点开设置后额度信息又不见了」。
    // 第三家（opendesign）没有账号：它的读数**完整**，照常进缓存 —— 纪律是按厂商逐家判的，
    // 不是「一家不完整就全家重读」。
    first.unmount();
    await settleSim(mini);
    const second = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign", "commandcode", "dsh-opencode-go"]);
    expect(findSim(second.tree(), "data-account", "cc-1")).toBeDefined();
  });

  it("超过 TTL 后再打开会重新读取（缓存不是一次性的）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
    });
    const first = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    first.unmount();
    await settleSim(mini);

    const { STATUS_READING_TTL_MS } = await import("../../src/client/seams");
    vi.setSystemTime(STATUS_READING_TTL_MS + 1);
    const second = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign", "commandcode", "dsh-opencode-go", "opendesign"]);
    second.unmount();
    vi.useRealTimers();
  });

  it("账号操作后强制现读：缓存不会盖住刚发生的变更", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);

    // 添加账号 → 成功后修订号 +1 → 三家状态重读（新账号的额度必须现问，不能吃缓存）。
    click(page.tree(), "data-action", "add");
    await settleSim(mini);
    fireSim(find(page.tree(), "data-add-label"), "onChange", { target: { value: "work" } });
    fireSim(find(page.tree(), "data-add-key"), "onChange", { target: { value: "sk-new" } });
    await settleSim(mini);
    click(page.tree(), "data-action", "confirmAdd");
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign", "commandcode", "dsh-opencode-go", "opendesign"]);
  });

  it("凭据变更（含设置页关闭时完成的网页登录）让缓存失效：下次打开重读", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
    });
    // apply 期的常驻订阅（与 src/client/index.ts 同序）：它负责清缓存，而容器只负责 +1 修订号。
    const { startSharedState } = await import("../../src/client/seams");
    const { VENDORS } = await import("../../src/client/shell");
    startSharedState(host.ctx as never, VENDORS);

    const first = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
    first.unmount();
    await settleSim(mini);

    // 设置页关着的时候凭据变了（网页登录完成）：缓存必须失效，重开要现读。
    for (const listener of host.listeners.get("credentials/reference-updated") ?? []) listener();
    await settleSim(mini);
    const second = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go", "opendesign", "commandcode", "dsh-opencode-go", "opendesign"]);
    second.unmount();
  });

  it("模型勾选在保存前就反映到草稿（回归：点了没反应）", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const { ModelsCard } = await import("../../src/client/models-card");
    const { createElement } = await import("react");
    const page = mini.mount(
      await pageContainer(host, (cards) =>
        createElement(ModelsCard as never, {
          t: cards.t,
          models: cards.models,
          visibility: cards.modelVisibility,
          visibleModels: cards.visibleModels,
          modelInfo: cards.modelInfo,
          catalogFailure: cards.catalogFailure,
          catalogLoading: cards.catalogLoading,
          onRetryCatalog: cards.onRetryCatalog,
          draft: cards.modelDraft,
          filter: cards.modelFilter,
          onFilterChange: cards.setModelFilter,
          mode: cards.modelMode,
          onToggleModel: (model: string, visible: boolean) => cards.editModel({ kind: "toggle", model, visible }),
          onRemoveModel: (model: string) => cards.editModel({ kind: "remove", model }),
          onDraftChange: cards.setModelDraft,
          onAddModel: (model: string) => cards.editModel({ kind: "add", model }),
        } as never),
      ),
    );
    await settleSim(mini);

    // 新规则：目录里的 m1 默认关闭；点一下必须立刻变成已勾选（还没保存）。
    const toggle = find(page.tree(), "data-model-visible", "m1");
    expect(toggle.props.checked).toBe(false);
    fireSim(toggle, "onChange", { target: { checked: true } });
    await settleSim(mini);
    expect(find(page.tree(), "data-model-visible", "m1").props.checked).toBe(true);
    // 草稿已经脏了：保存条出现，勾选不是假象。
    expect(findSim(page.tree(), "data-save-bar")).toBeDefined();
  });
});

// —— 仿真 2：侧边栏卡片 ————————

describe("侧边栏卡片容器仿真", () => {
  it("注册形状：侧边栏用 id/order，中栏面板用 key；卡片与面板都常驻", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    await applyLikeHost(host);
    const { SIDEBAR_CARD_ID, DASHBOARD_PANEL_ID, SIDEBAR_SLOT } = await import("../../src/client/seams");

    const sidebar = host.registered.find((entry) => entry.slot === SIDEBAR_SLOT)!;
    expect(sidebar.entry).toMatchObject({ id: SIDEBAR_CARD_ID, order: 1 });
    expect(sidebar.entry["key"]).toBeUndefined(); // 侧边栏用 id
    const main = host.registered.find((entry) => entry.slot === "main")!;
    expect(main.entry).toMatchObject({ key: DASHBOARD_PANEL_ID });
    expect(main.entry["order"]).toBeUndefined(); // 面板用 key，没有 order
  });

  it("关闭 → 渲染 null 且零新增请求；开启 → 立即读 + 60s 轮询；再关闭 → 又零新增请求", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: false });
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    await settleSim(mini);

    // 关闭：卡片渲染 null（侧边栏里什么都没有），一次用量请求都没有。
    expect(cardView.tree()).toBeNull();
    expect(host.statusCalls).toEqual([]);
    vi.advanceTimersByTime(600_000);
    await settleSim(mini);
    expect(host.statusCalls).toEqual([]);

    // 外部（等价于用户在设置页保存）把开关拨开：镜像重读 → 卡片出现并立即读一次。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: true };
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(cardView.tree()).not.toBeNull();
    expect(textsOfSim(cardView.tree()).join(" ")).toContain("还没有请求经过这个账号");
    expect(host.statusCalls).toEqual(["commandcode"]);
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode", "commandcode"]); // +60s：第二次（确认 60s 一拍）
    // 分两次各推进 60s（而非一次 120s）：vitest 的假定时器在一次推进里**不会**触发「推进过程中
    // 才排定的边界计时器」，一次 120s 会把 +180s 那一下丢掉；两次 +60s 能踩到边界。
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(3); // +120s：第三次
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(4); // +180s：第四次，确认仍是 60s 一拍

    // 再关闭：卡片重新变 null，定时器停掉（推进再久也不再请求）。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(cardView.tree()).toBeNull();
    const afterClose = host.statusCalls.length;
    vi.advanceTimersByTime(600_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(afterClose);
    vi.useRealTimers();
  });

  it("侧边栏卡片用量刷新间隔跟随 quotaRefreshMinutes（分钟）设置，而不是写死 60s", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true });
    // 把刷新间隔设成 5 分钟（覆盖默认的 1 分钟），验证卡片按设置走、而非硬编码 60s。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, quotaRefreshMinutes: 5 };
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    await settleSim(mini);
    // 开启即读一次。
    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls).toEqual(["commandcode"]);
    // 推进 1 分钟（< 5 分钟间隔）：不应再发起请求。
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(1);
    // 推进到 5 分钟边界：恰好一拍。
    vi.advanceTimersByTime(5 * 60_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("设置页保存开关后卡片跟随：保存条 → 宿主文档 → 卡片出现（端到端一条链）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: false });
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    expect(cardView.tree()).toBeNull();
    // 设置页自己的状态读（页面要显示额度），与卡片无关 —— 记下基线再比增量。
    const baseline = host.statusCalls.length;

    fireSim(find(page.tree(), "data-field-input", "showSidebarQuota"), "onChange", { target: { checked: true } });
    await settleSim(mini);
    click(page.tree(), "data-save", "llm-commandcode");
    await settleSim(mini);
    expect(host.rows.get("llm-commandcode")!.value.showSidebarQuota).toBe(true);

    expect(cardView.tree()).not.toBeNull();
    // 保存的是「通用显示设置」→ 三家一起打开。三家都没有账号，于是轮播逐家试一遍
    // （2026-10-18 用户要求：没有账号的厂商自动跳过，不显示「未配置」），
    // 一轮都试完仍没有可显示的账号时停在最后一家显示空态。
    const probed = host.statusCalls.slice(baseline);
    expect(new Set(probed)).toEqual(new Set(["commandcode", "dsh-opencode-go", "opendesign"]));
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(cardView.tree()).not.toBeNull();
    vi.useRealTimers();
  });

  it("外部改动开关（settings/document-updated）时卡片跟随，无需设置页参与", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true });
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    await settleSim(mini);

    // 开关初始为真：卡片直接出现并读取（冷启动 describe 兜底，无需先开设置页）。
    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls).toEqual(["commandcode"]);

    // 外部把开关拨掉（patch 文件/其它工具），宿主广播失效信号。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(cardView.tree()).toBeNull();
    const afterOff = host.statusCalls.length;
    vi.advanceTimersByTime(600_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(afterOff);
    vi.useRealTimers();
  });

  it("多家同开时跟第一家（commandcode）；第一家关掉后跟到 opencode", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, {
      commandcodeToggle: true,
      opencodeToggle: true,
      // 两家都带一个已配置账号：轮播「跳过未配置厂商」的逻辑不该在这里触发。
      accounts: {
        commandcode: [{ ref: "cc-1", label: "CC", configured: true, active: true }],
        "dsh-opencode-go": [{ ref: "oc-1", label: "OC", configured: true, active: true }],
      },
    });
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    await settleSim(mini);
    expect(host.statusCalls).toEqual(["commandcode"]);

    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    host.emitDocumentUpdated();
    await settleSim(mini);
    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go"]);
    vi.useRealTimers();
  });

  it("usage 远程面只 $mount 一次（两个 profile 行共享），页面卸载不 dispose", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const { ensureUsageRemote, startSharedState } = await import("../../src/client/seams");
    const { VENDORS } = await import("../../src/client/shell");
    const host = fakeHost(mini);
    // 两个 profile 行各引导一次（共享同一份模块状态）。
    startSharedState(host.ctx as never, VENDORS);
    const shared = ensureUsageRemote(host.ctx as never);
    startSharedState(host.ctx as never, VENDORS);
    const { card } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    const afterUnmount = host.statusCalls.length;

    expect(host.mounts).toHaveLength(1);
    expect(host.mounts[0]!.package).toBe("dsh-llm-account");

    // 页面卸载：远程面不撤（卡片还活着，还要用它）。新消费者拿到的必须是**同一个活着的**
    // 句柄 —— 若页面卸载时把它 dispose 掉，下一个消费者会重挂，`mounts` 就变成 2。
    const beforeUnmount = host.mounts.length;
    page.unmount();
    await settleSim(mini);
    expect(ensureUsageRemote(host.ctx as never)).toBe(shared);
    expect(shared.disposed()).toBe(false);
    expect(host.mounts).toHaveLength(beforeUnmount);
    expect(cardView.tree()).toBeNull(); // 开关关着：仍然不渲染、不请求
    // 卸载后连**设置页自己**的用量请求也不再有（它随页面卸载了），卡片更是一次不发。
    vi.advanceTimersByTime(600_000);
    await settleSim(mini);
    expect(host.statusCalls).toHaveLength(afterUnmount);
    vi.useRealTimers();
  });
});

// —— 仿真 3：中栏仪表盘 ————————

describe("仪表盘容器仿真", () => {
  it("即使侧边栏开关关闭，仪表盘也列出三家的账户统计", async () => {
    const mini = await runtime();
    await freshSeams();
    // 三家各给一个账号：平铺列表里供应商是账号名后的**徽标**（不是分组标题），
    // 所以「三家都列出来」的断言落在徽标与账号行上。
    const host = fakeHost(mini, {
      commandcodeToggle: false,
      accounts: {
        commandcode: [{ ref: "cc-1", label: "CC 账号", configured: true, active: true, effective: true }],
        "dsh-opencode-go": [{ ref: "oc-1", label: "OC 账号", configured: true, active: false, effective: false }],
        opendesign: [{ ref: "od-1", label: "OD 账号", configured: true, active: false, effective: false }],
      },
    });
    const { panel } = await applyLikeHost(host);
    const view = mini.mount(panel);
    await settleSim(mini);
    const text = textsOfSim(view.tree()).join(" ");
    expect(text).toContain("CC 账号");
    expect(text).toContain("OC 账号");
    expect(text).toContain("OD 账号");
    // 供应商徽标：每行一个，顺序按厂商声明（commandcode → opencode → opendesign）。
    const badges = elementsOfSim(view.tree()).filter((element) => element.props["data-account-vendor"] !== undefined);
    expect(badges.map((element) => element.props["data-account-vendor"])).toEqual(["Command Code", "OpenCode", "Open Design"]);
    // 三家的状态都读了（开关关着也读 —— 面板不跟随侧边栏开关）。
    expect(host.statusCalls).toHaveLength(3);
  });

  it("打开面板时读一次状态，手动刷新再读一次；卡片「打开」与面板「关闭」都走 layout.selectPanel", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { commandcodeToggle: true });
    const { card, panel } = await applyLikeHost(host);
    const cardView = mini.mount(card);
    const view = mini.mount(panel);
    await settleSim(mini);
    const afterOpen = host.statusCalls.length;
    expect(afterOpen).toBeGreaterThanOrEqual(1);

    click(view.tree(), "data-dashboard-refresh");
    await settleSim(mini);
    // 刷新重读**所有**厂商的状态（仪表盘不跟随侧边栏开关）：三家各一次。
    expect(host.statusCalls.length).toBe(afterOpen + 3);

    // 卡片的「打开用量面板」按钮 → layout.selectPanel(面板 key)。
    click(cardView.tree(), "data-sidebar-open");
    const { DASHBOARD_PANEL_ID } = await import("../../src/client/seams");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID]);

    // 面板的关闭按钮 → layout.selectPanel(null)。
    click(view.tree(), "data-dashboard-close");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID, null]);
  });
});

// —— 仿真 4：网页登录（2026-10-18 报障：没自动弹出 / 链接不消失 / 另外两家没反应） ——

describe("网页登录容器仿真", () => {
  /**
   * 装一个假浏览器窗口：`window.open` 必须**同步**被调用（弹窗拦截器只认用户手势），
   * 所以断言落在「调用时机 → 导航网址 → 失败时关掉」这三件事上。
   */
  function stubBrowserWindow(): { handle: { closed: boolean; location: { href?: string }; close: () => void }; closedTimes: () => number; openCalls: () => number } {
    let closedTimes = 0;
    let openCalls = 0;
    const handle = {
      closed: false,
      location: {} as { href?: string },
      close: () => {
        closedTimes += 1;
        handle.closed = true;
      },
    };
    vi.stubGlobal("window", {
      open: () => {
        openCalls += 1;
        return handle;
      },
    });
    return { handle, closedTimes: () => closedTimes, openCalls: () => openCalls };
  }

  it("点 opencode 的网页登录：远程收到**那一家**，占位窗口被导航到它的授权网址", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    const popup = stubBrowserWindow();

    click(page.tree(), "data-action", "login-dsh-opencode-go");
    await settleSim(mini);

    // 1) 路由到 opencode（以前三家都进同一个静默分支，看起来就是「没反应」）。
    expect(host.loginCalls).toEqual([{ method: "loginBegin", vendor: "dsh-opencode-go" }]);
    // 2) 占位窗口在点击时同步打开，拿到网址后导航过去（不再需要用户手点链接）。
    expect(popup.openCalls()).toBe(1);
    expect(popup.handle.location.href).toBe("https://opencode.ai/auth/device?code=ABCD");
    // 3) 等待面板出现（带链接兜底，也带取消入口）。
    expect(findSim(page.tree(), "data-login-panel", "dsh-opencode-go")).toBeDefined();
    expect(findSim(page.tree(), "data-action", "login-cancel")).toBeDefined();
    page.unmount();
    vi.unstubAllGlobals();
  });

  it("第三家（opendesign）同样能发起；登录失败时说明原因并关掉占位窗口", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      // 本机没有 vela、也没有可导入的登录产物：这正是「点了没反应」的第二种真实成因。
      login: { begin: () => ({ state: "failed", reason: "vela-missing" }) },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    const popup = stubBrowserWindow();

    click(page.tree(), "data-action", "login-opendesign");
    await settleSim(mini);

    expect(host.loginCalls).toEqual([{ method: "loginBegin", vendor: "opendesign" }]);
    const failure = find(page.tree(), "data-login-failure", "opendesign");
    expect(failure.props["data-login-failure-detail"]).toBe("vela-missing");
    expect(textsOfSim(page.tree()).join(" ")).toContain("vela");
    // 失败不该留一个空白窗口给用户。
    expect(popup.closedTimes()).toBe(1);
    page.unmount();
    vi.unstubAllGlobals();
  });

  it("点「取消登录」：宿主停流程、等待面板立即消失、轮询不再发请求", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    click(page.tree(), "data-action", "login");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();

    click(page.tree(), "data-action", "login-cancel");
    await settleSim(mini);
    expect(host.loginCalls).toContainEqual({ method: "loginCancel", vendor: "commandcode" });
    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();

    // 面板没了 → 不再轮询（等待授权期间那 1s 一拍是唯一的后台请求来源）。
    const polls = host.loginCalls.filter((call) => call.method === "loginStatus").length;
    vi.advanceTimersByTime(5_000);
    await settleSim(mini);
    expect(host.loginCalls.filter((call) => call.method === "loginStatus").length).toBe(polls);
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("轮询读到 success：等待面板自动消失，并触发一次账号重读", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { login: { status: () => ({ state: "success" }) } });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    click(page.tree(), "data-action", "login");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();
    const readsBefore = host.statusCalls.length;

    vi.advanceTimersByTime(1_500);
    await settleSim(mini);

    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();
    expect(host.statusCalls.length).toBeGreaterThan(readsBefore);
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("状态读口连续失败：先保留面板（不误伤），连续 3 次后给出可读原因并停轮询", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, {
      login: {
        begin: () => ({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x" }),
        status: () => {
          throw new Error("the llm-account remote went away");
        },
      },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    click(page.tree(), "data-action", "login");
    await settleSim(mini);

    vi.advanceTimersByTime(1_000);
    await settleSim(mini);
    // 单次失败不清面板（用户可能正在浏览器里操作）。
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();

    vi.advanceTimersByTime(2_500);
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();
    const failure = find(page.tree(), "data-login-failure", "commandcode");
    expect(failure.props["data-login-failure-detail"]).toBe("network");
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("网页登录自动收尾（不登录也不该一直挂着）", () => {
  function stubBrowserWindow(): { handle: { closed: boolean; location: { href?: string }; close: () => void } } {
    const handle = {
      closed: false,
      location: {} as { href?: string },
      close: () => {
        handle.closed = true;
      },
    };
    vi.stubGlobal("window", { open: () => handle });
    return { handle };
  }

  it("宿主报了 expiresAt：到期后链接自动收起并说明超时（不需要手点取消）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const host = fakeHost(mini, {
      login: {
        begin: () => ({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x", expiresAt: 2_000 }),
        // 宿主一直说 waiting（流程没自己结算）：界面必须按期限自己收尾。
        status: () => ({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x", expiresAt: 2_000 }),
      },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    click(page.tree(), "data-action", "login");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();

    vi.advanceTimersByTime(2_500);
    await settleSim(mini);

    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();
    const failure = find(page.tree(), "data-login-failure", "commandcode");
    expect(failure.props["data-login-failure-detail"]).toBe("timeout");
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("宿主没报 expiresAt（旧宿主）：按默认 TTL 兜底，同样自动收起", async () => {
    const mini = await runtime();
    await freshSeams();
    const { LOGIN_WAITING_TTL_MS } = await import("../../src/client/seams");
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const host = fakeHost(mini, {
      login: {
        begin: () => ({ state: "waiting", authUrl: "https://opencode.ai/auth/device" }),
        status: () => ({ state: "waiting", authUrl: "https://opencode.ai/auth/device" }),
      },
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    click(page.tree(), "data-action", "login-dsh-opencode-go");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "dsh-opencode-go")).toBeDefined();

    vi.advanceTimersByTime(LOGIN_WAITING_TTL_MS + 3_000);
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("用户关掉授权窗口：面板立即收起（宿主流程不取消，轮询到终态）", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    const popup = stubBrowserWindow();

    click(page.tree(), "data-action", "login");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();

    // 用户把弹出的授权页关了。
    popup.handle.closed = true;
    vi.advanceTimersByTime(1_500);
    await settleSim(mini);

    expect(findSim(page.tree(), "data-login-panel")).toBeUndefined();
    // 没有取消宿主流程（万一他关闭前刚批准，取消会误杀成功）。
    expect(host.loginCalls.some((call) => call.method === "loginCancel")).toBe(false);
    page.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("再点一次「新增账户」：还开着的添加表单与等待中的登录一起收掉", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);
    stubBrowserWindow();

    // 先摆出两个"未完成"：一个添加表单 + 一个等待中的登录。
    click(page.tree(), "data-action", "add");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-add-label")).toBeDefined();
    click(page.tree(), "data-action", "login");
    await settleSim(mini);
    expect(findSim(page.tree(), "data-login-panel", "commandcode")).toBeDefined();

    // 收起「新增账户」区块（用户再点一次摘要）。
    fireSim(find(page.tree(), "data-add-chooser"), "onToggle", { currentTarget: { open: false } });
    await settleSim(mini);

    expect(findSim(page.tree(), "data-add-label"), "添加表单应被收掉").toBeUndefined();
    expect(findSim(page.tree(), "data-login-panel"), "等待中的登录应被取消").toBeUndefined();
    expect(host.loginCalls).toContainEqual({ method: "loginCancel", vendor: "commandcode" });
    page.unmount();
    vi.unstubAllGlobals();
  });
});

it("加完账号后模型目录自动重读：加之前读不到（401），加之后读到（目录要鉴权）", async () => {
  const mini = await runtime();
  await freshSeams();
  const host = fakeHost(mini);
  // 加账号之前：目录读不到（Open Design 的 /v1/models 不带密钥就是 401）。失败读数不进缓存。
  host.modelFailures = ["models: opendesign read failed (401 missing_api_key)"];
  const page = mini.mount(await pageContainer(host));
  await settleSim(mini);
  const before = host.modelCalls.length;
  expect(before).toBeGreaterThanOrEqual(3);

  // 账号加进来之后目录就能读了（同一把密钥）。
  host.modelFailures = [];
  click(page.tree(), "data-action", "add");
  await settleSim(mini);
  fireSim(find(page.tree(), "data-add-label"), "onChange", { target: { value: "work" } });
  fireSim(find(page.tree(), "data-add-key"), "onChange", { target: { value: "sk-new" } });
  await settleSim(mini);
  click(page.tree(), "data-action", "confirmAdd");
  await settleSim(mini);

  // 账号修订号变化 → 目录重读（否则界面会一直停在挂载时那次空目录上）。
  expect(host.modelCalls.length).toBeGreaterThan(before);
  page.unmount();
});

it("侧边栏轮播：两家都开时轮流显示（默认 1 分钟一换，先显示按标签页顺序的第一家）", async () => {
  const mini = await runtime();
  await freshSeams();
  vi.useFakeTimers();
  const host = fakeHost(mini, {
    commandcodeToggle: true,
    opencodeToggle: true,
    accounts: {
      commandcode: [{ ref: "cc-1", label: "CC", configured: true, active: true }],
      "dsh-opencode-go": [{ ref: "oc-1", label: "OC", configured: true, active: true }],
    },
  });
  const { card } = await applyLikeHost(host);
  const cardView = mini.mount(card);
  await settleSim(mini);

  // 起点：第一家（commandcode）。
  expect(cardView.tree()).not.toBeNull();
  expect(host.statusCalls).toEqual(["commandcode"]);

  // 30 秒：还没到轮播点，仍是同一家。
  vi.advanceTimersByTime(30_000);
  await settleSim(mini);
  expect(host.statusCalls).not.toContain("dsh-opencode-go");

  // 到 60 秒：轮播切到第二家并读它的状态（卡片标题随之换供应商）。
  vi.advanceTimersByTime(30_000);
  await settleSim(mini);
  expect(host.statusCalls).toContain("dsh-opencode-go");

  // 再一轮回到第一家（两家循环）。
  vi.advanceTimersByTime(60_000);
  await settleSim(mini);
  const commandCodeReads = host.statusCalls.filter((vendor) => vendor === "commandcode").length;
  expect(commandCodeReads).toBeGreaterThanOrEqual(3);
  vi.useRealTimers();
});

it("轮播跳过没有账号的厂商：第一家未配置 → 直接落到第二家，不显示「未配置」", async () => {
  const mini = await runtime();
  await freshSeams();
  vi.useFakeTimers();
  const host = fakeHost(mini, {
    commandcodeToggle: true,
    opencodeToggle: true,
    // 只有 opencode 有账号：commandcode 这一轮必须被跳过（2026-10-18 用户要求）。
    accounts: { "dsh-opencode-go": [{ ref: "oc-1", label: "OC", configured: true, active: true, effective: true }] },
  });
  const { card } = await applyLikeHost(host);
  const cardView = mini.mount(card);
  await settleSim(mini);

  // 探过 commandcode（发现没账号）→ 跳到 opencode 并显示它的账号。
  expect(host.statusCalls).toContain("commandcode");
  expect(host.statusCalls).toContain("dsh-opencode-go");
  const text = textsOfSim(cardView.tree()).join(" ");
  expect(text).toContain("OC");
  expect(text).not.toContain("未配置");
  vi.useRealTimers();
});

// —— 用量统计：只挂在账号下面，且绝不吃掉整页 ————————

/** 默认的聚合桶（4.6K 请求、100% 成功、87% 命中、官方价 $18.14）。 */
const USAGE_BUCKET: Record<string, unknown> = {
  period: "2026-10",
  since: 0,
  requests: 4_600,
  ok: 4_600,
  failed: 0,
  successRate: 1,
  cacheHitRate: 0.87,
  inputTokens: 2_000_000,
  outputTokens: 4_600_000,
  cacheReadTokens: 100_000_000,
  cacheWriteTokens: 0,
  officialCost: 18.14,
};

/**
 * 造一份 usageReport（一个账号、周期为厂商重置的月度账期）。
 *
 * `bucket` **整块替换**而不是浅合并：有一个用例要喂一个「读任何字段都抛」的坏桶，
 * 浅合并会在构造报表时就把 getter 读掉，异常落到 `usageReport()` 调用里，
 * 于是测到的是「读取失败」而不是「渲染失败」—— 差之毫厘。
 * @param account - 账号 ref。
 * @param bucket - 聚合桶（缺省 {@link USAGE_BUCKET}）。
 * @returns 线上形状的报表。
 */
function reportFor(account: string, bucket: Record<string, unknown> = USAGE_BUCKET): Record<string, unknown> {
  return {
    accounts: [
      {
        vendor: "commandcode",
        account,
        period: { kind: "month", key: "2026-10", start: new Date(2026, 9, 14).getTime(), end: new Date(2026, 10, 14).getTime(), fromResetAt: true },
        bucket,
        windowed: { period: "all", since: 0, requests: 0, ok: 0, failed: 0 },
      },
    ],
    total: { window: "all", bucket: {}, byVendor: [] },
  };
}

it("用量块挂在**它自己的账号行**下面（页面上不再有跨账号的用量卡片）", async () => {
  const mini = await runtime();
  await freshSeams();
  const host = fakeHost(mini, {
    accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
    usageReport: () => reportFor("cc-1"),
  });
  const page = mini.mount(await pageContainer(host));
  await settleSim(mini);

  const block = find(page.tree(), "data-usage-account", "cc-1");
  // 位置：在账号行**里面**（额度条下方），不是页面级别的另一张卡。
  // 只能看结构（`elementsOfSim` 每次展开都会重新求值组件，对象恒等比较没有意义）。
  const row = find(page.tree(), "data-account", "cc-1");
  expect(elementsOfSim(row).some((element) => element.props["data-usage-account"] === "cc-1")).toBe(true);
  const text = textsOfSim(block).join(" ");
  expect(text).toContain("用量");
  expect(text).toContain("4.6K");
  expect(text).toContain("4.6K 成功 / 0 失败");
  expect(text).toContain("官方价");
  // 窗口选择器随大卡片一起没了：页面上不该再出现时间窗口按钮。
  expect(findSim(page.tree(), "data-usage-window")).toBeUndefined();
});

it("用量块渲染抛错时只坏它自己：账号行与整页设置仍在（不再整页消失）", async () => {
  const mini = await runtime();
  await freshSeams();
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    // 坏桶：读任何字段都抛。边界校验器只查「是不是对象」，所以它能走到渲染层 ——
    // 这正是 2026-10-19 报障的形状（刷新用量时整页消失）。
    const exploding: Record<string, unknown> = {};
    for (const key of ["requests", "ok", "failed", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "successRate", "cacheHitRate", "officialCost"]) {
      Object.defineProperty(exploding, key, {
        enumerable: true,
        get() {
          throw new Error(`boom reading ${key}`);
        },
      });
    }
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
      usageReport: () => reportFor("cc-1", exploding),
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 页面本体还在（标题、账号行都在）。
    expect(findSim(page.tree(), "data-page", "llm-account")).toBeDefined();
    expect(findSim(page.tree(), "data-account", "cc-1")).toBeDefined();
    expect(textsOfSim(page.tree()).join(" ")).toContain("Work");
    // 只有用量那一小块换成了行内失败提示，并且原因看得见。
    const inline = find(page.tree(), "data-render-error-inline", "true");
    expect(elementsOfSim(inline).length).toBeGreaterThan(0);
    expect(textsOfSim(page.tree()).join(" ")).toContain("boom reading");
  } finally {
    errors.mockRestore();
  }
});

it("usageReport 以 `{ ok, value }` 信封返回时也能读到（宿主的真实形状）", async () => {
  // 2026-10-19 真实报障：`TypeError: Cannot read properties of undefined (reading ''find'')`
  // —— 宿主的远程读口一律返回信封，之前把整个信封当成报表存下来，`report.accounts` 是
  // undefined，账号行渲染时 `.find` 就炸了。这条钉住「信封要解包」。
  const mini = await runtime();
  await freshSeams();
  const host = fakeHost(mini, {
    accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
    usageReport: () => ({ ok: true, value: reportFor("cc-1") }),
  });
  const page = mini.mount(await pageContainer(host));
  await settleSim(mini);

  const block = find(page.tree(), "data-usage-account", "cc-1");
  expect(textsOfSim(block).join(" ")).toContain("4.6K");
  // 页面本体完全正常（没有走到失败面板/行内报错）。
  expect(findSim(page.tree(), "data-render-error")).toBeUndefined();
  expect(findSim(page.tree(), "data-render-error-inline")).toBeUndefined();
});

it("usageReport 返回空值或坏形状时不崩：只是少显示用量块", async () => {
  for (const payload of [undefined, null, {}, { accounts: "nope" }, { accounts: null, total: null }, 42, "text"]) {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, {
      accounts: { commandcode: [{ ref: "cc-1", label: "Work", configured: true, active: true, effective: true }] },
      usageReport: () => payload,
    });
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 页面与账号行都在；用量块不出现（没有数据就什么都不画）。
    expect(findSim(page.tree(), "data-page", "llm-account")).toBeDefined();
    expect(findSim(page.tree(), "data-account", "cc-1")).toBeDefined();
    expect(findSim(page.tree(), "data-render-error")).toBeUndefined();
    expect(findSim(page.tree(), "data-render-error-inline")).toBeUndefined();
  }
});
