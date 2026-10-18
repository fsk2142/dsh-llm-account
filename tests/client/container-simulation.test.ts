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
 * 6. 外部改动（`settings/document-updated`）时卡片跟随；两家同开时跟第一家；
 * 7. usage 远程面只 `$mount` 一次（两个 profile 行共享），页面卸载不 dispose；
 * 8. 插槽注册形状（`id`/`order` 与 `key`），卡片「打开面板」与面板「关闭」都走 `layout.selectPanel`。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { VendorCardsContext } from "../../src/client/seams";
import {
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
  it("字段编辑 → 保存 → 写的是命中的行名；opencode 写行 id 而不是命名空间", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini);
    const page = mini.mount(await pageContainer(host));
    await settleSim(mini);

    // 切到 opencode 标签页，改 baseURL，保存。
    click(page.tree(), "data-tab", "llm-opencode-go");
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
    expect(host.statusCalls.slice(baseline)).toEqual(["commandcode"]);
    vi.advanceTimersByTime(60_000);
    await settleSim(mini);
    expect(host.statusCalls.slice(baseline)).toEqual(["commandcode", "commandcode"]);
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

  it("两家同开时跟第一家（commandcode）；第一家关掉后跟到 opencode", async () => {
    const mini = await runtime();
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost(mini, { commandcodeToggle: true, opencodeToggle: true });
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
  it("跟随开关存储里的厂商：没有厂商时给占位，不编造", async () => {
    const mini = await runtime();
    await freshSeams();
    const host = fakeHost(mini, { commandcodeToggle: false });
    const { panel } = await applyLikeHost(host);
    const view = mini.mount(panel);
    await settleSim(mini);
    expect(textsOfSim(view.tree()).join(" ")).toContain("还没有可显示的用量数据");
    expect(host.statusCalls).toEqual([]);
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
    expect(host.statusCalls.length).toBe(afterOpen + 1);

    // 卡片的「打开用量面板」按钮 → layout.selectPanel(面板 key)。
    click(cardView.tree(), "data-sidebar-open");
    const { DASHBOARD_PANEL_ID } = await import("../../src/client/seams");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID]);

    // 面板的关闭按钮 → layout.selectPanel(null)。
    click(view.tree(), "data-dashboard-close");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID, null]);
  });
});