/**
 * 样式契约：**渲染层与样式表必须真的接上**。
 *
 * 为什么单独一个文件：真机截图里最丑的三处都不是审美问题，而是接线断了 ——
 * 1. 一排按钮掉回浏览器默认样式（灰底 + 系统字体 + 13.33px）：渲染层挂的是
 *    `dsl-button-ghost`，盒模型却只写在 `.dsl-button` 上（两个类缺一不可，缺一个就是裸按钮）；
 * 2. 有三个按钮**根本没挂类**（仪表盘的刷新/关闭、保存条的保存、上移/下移）；
 * 3. 账号行把身份块与额度条塞进同一行，名称被挤成竖排单字。
 * 这三条在「纯 props → 元素树」的测试里全都看得见 —— 只要有人去看类名。所以这里
 * 把「每个按钮都有档位类」「每个类名在样式表里都有规则」当成契约，逐棵树验一遍。
 *
 * 覆盖两条路径：
 * - **纯卡片**（`AccountCard` 的各种分支、模型卡片、侧边栏、仪表盘）：props 由本文件完全控制，
 *   能覆盖编辑器/登录/展开报告/排序控件这些只在特定状态下才出现的按钮；
 * - **真实容器**（`createConnectedPage` + 注册出来的侧边栏与面板，走 `fake-host`）：保存条那个
 *   按钮只有「改过东西之后」才渲染，只有挂起来跑才知道它到底有没有类。
 */
import { afterEach, expect, it, vi } from "vitest";

import { AccountCard, type AccountCardProps } from "../../src/client/account-card";
import { CSS_CLASS, PAGE_CSS } from "../../src/client/css";
import { dictionaryOf } from "../../src/client/copy";
import { Dashboard } from "../../src/client/dashboard";
import { ModelsCard } from "../../src/client/models-card";
import { OpenCodeAccountCard } from "../../src/client/opencode-account-card";
import { SidebarCard } from "../../src/client/sidebar-card";
import type { AccountUsageStatus, VendorCapabilities, VendorUsageStatus } from "../../src/client/usage-contract";
import {
  elementsOfSim,
  findSim,
  fireSim,
  settleSim,
  type MiniReact,
  type SimElement,
} from "../support/container-sim";
import { fakeHost } from "../support/fake-host";

vi.mock("react", async () => {
  // 两个依赖都用**动态** import 在工厂内部取：`vi.mock` 的工厂会被提升到文件顶部，
  // 从这里引用文件顶部的静态 import 会在它初始化之前就读（vitest 报
  // `Cannot access '__vi_import_N__' before initialization`）。
  const stub = await import("../support/react-stub");
  const sim = await import("../support/container-sim");
  const mini = sim.installMiniReact();
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
  return ((await import("react")) as unknown as { __mini: MiniReact }).__mini;
}

afterEach(async () => {
  (await runtime()).reset();
});

const t = dictionaryOf("zh");

/** 类名注册表：渲染层能用的类名只有这些。 */
const REGISTRY = new Set<string>(Object.values(CSS_CLASS));

/** Command Code 的能力矩阵（全开，好让所有按钮都出现）。 */
const COMMAND_CODE: VendorCapabilities = {
  reorder: true,
  pin: true,
  browserLogin: true,
  modelAccountRules: true,
  quotaShape: "windows",
  modelVisibilityWrite: "onSave",
  automaticSwitch: true,
};

/** 一个账号行。 */
function account(overrides: Partial<AccountUsageStatus> & Pick<AccountUsageStatus, "ref">): AccountUsageStatus {
  return { label: overrides.ref, configured: true, active: false, effective: false, ...overrides };
}

/** 一份状态。 */
function statusOf(accounts: AccountUsageStatus[], effective?: string): VendorUsageStatus {
  return {
    vendor: "commandcode",
    capabilities: COMMAND_CODE,
    pinned: "work",
    ...(effective === undefined ? {} : { effective: { ref: effective, at: 1_700_000_000_000 } }),
    accounts,
    failures: [],
  };
}

/** 卡片回调（卡片不留状态，全部由调用方提供）。 */
const callbacks = {
  onOpenAction: vi.fn(),
  onActionField: vi.fn(),
  onConfirmAction: vi.fn(),
  onCancelAction: vi.fn(),
  onSelect: vi.fn(),
  onRemove: vi.fn(),
  onToggleExpand: vi.fn(),
  onLoginBegin: vi.fn(),
};

/** 账户卡片属性。 */
function accountProps(overrides: Partial<AccountCardProps> = {}): AccountCardProps {
  return { t, status: statusOf([account({ ref: "work" })]), ...callbacks, ...overrides };
}

/** 元素的类名 token。 */
function classesOf(element: SimElement): string[] {
  const value = element.props["className"];
  return typeof value === "string" ? value.split(/\s+/).filter((token) => token !== "") : [];
}

/** 元素的定位描述（失败消息里要能认出是哪个按钮）。 */
function labelOf(element: SimElement): string {
  const markers = Object.keys(element.props).filter((key) => key.startsWith("data-"));
  return markers.length === 0 ? "(无 data 标记)" : markers.map((key) => `${key}=${String(element.props[key])}`).join(", ");
}

/**
 * 一棵树必须满足的两条契约。
 * @param tree - 元素树。
 * @param where - 出问题时报的位置。
 * @returns 这棵树里的按钮数（调用方据此断言「真的渲染出了按钮」，避免空树假绿）。
 */
function assertStyled(tree: unknown, where: string): number {
  const all = elementsOfSim(tree);
  const buttons = all.filter((element) => element.type === "button");
  for (const button of buttons) {
    const classes = classesOf(button);
    expect(classes.length, `${where}: 按钮 ${labelOf(button)} 没有任何类名（会掉回浏览器默认样式）`).toBeGreaterThan(0);
    for (const token of classes) {
      expect(REGISTRY.has(token), `${where}: 按钮 ${labelOf(button)} 的类名 ${token} 不在 CSS_CLASS 注册表里`).toBe(true);
    }
  }
  for (const element of all) {
    for (const token of classesOf(element)) {
      expect(PAGE_CSS.includes(`.${token}`), `${where}: 类名 ${token} 在样式表里没有对应规则`).toBe(true);
    }
  }
  return buttons.length;
}

// —— 纯卡片 ————————

it("账户卡片的每一档按钮都有类（含编辑器、登录、添加表单、展开报告）", () => {
  const trees: [string, unknown][] = [
    [
      "默认 + 展开报告 + 登录等待 + 排序手柄",
      AccountCard(
        accountProps({
          status: statusOf([account({ ref: "work", effective: true, quota: { windows: [{ key: "rolling", percent: 35 }], failures: [] } })]),
          expandedRef: "work",
          login: { state: "waiting", authUrl: "https://example.invalid/auth?code=abcdef" },
        }),
      ),
    ],
    ["添加表单（收起 → 展开后的提交/取消）", AccountCard(accountProps({ action: { kind: "add", label: "work", key: "sk-1" } }))],
    ["重命名编辑器", AccountCard(accountProps({ status: statusOf([account({ ref: "work" })]), action: { kind: "rename", ref: "work", label: "w", key: "" } }))],
    ["更换密钥编辑器", AccountCard(accountProps({ status: statusOf([account({ ref: "work" })]), action: { kind: "key", ref: "work", label: "", key: "sk" } }))],
    ["读不到状态（诊断块）", AccountCard(accountProps({ status: undefined, problem: "gateway/input-invalid: …" }))],
  ];
  let buttons = 0;
  for (const [where, tree] of trees) buttons += assertStyled(tree, where);
  // 真正渲染出来的按钮远远多于「每棵树一个」：这条断言防的是「树是空的所以全绿」。
  expect(buttons).toBeGreaterThan(15);
});

it("OpenCode 账户卡片：排序控件与 autoSwitch 也有类", () => {
  const tree = OpenCodeAccountCard({
    ...accountProps({ status: statusOf([account({ ref: "a" }), account({ ref: "b" })]) }),
    settings: { autoSwitch: true },
    onMove: vi.fn(),
    onSetAutoSwitch: vi.fn(),
  });
  expect(assertStyled(tree, "opencode 账户卡片")).toBeGreaterThan(5);
});

it("模型卡片：搜索、逐模型移除、添加都有类", () => {
  const tree = ModelsCard({
    t,
    models: ["alpha", "beta"],
    visibility: { beta: false },
    draft: "gamma",
    filter: "al",
    onFilterChange: vi.fn(),
    mode: "onSave",
    onToggleModel: vi.fn(),
    onRemoveModel: vi.fn(),
    onDraftChange: vi.fn(),
    onAddModel: vi.fn(),
  });
  // 两行按钮：移除（过滤后剩下的那一行）+ 添加。数量多于 1 就说明两条路径都渲染了。
  expect(assertStyled(tree, "模型卡片")).toBeGreaterThan(1);
});

it("侧边栏卡片与中栏仪表盘：按钮都有类", () => {
  const status = statusOf([account({ ref: "work", effective: true, quota: { windows: [{ key: "rolling", percent: 35 }], failures: [] } })], "work");
  const card = SidebarCard({ t, status, onOpen: vi.fn(), onRefresh: vi.fn() });
  const panel = Dashboard({ t, status, switches: [], onClose: vi.fn(), onRefresh: vi.fn() });
  expect(assertStyled(card, "侧边栏卡片")).toBeGreaterThan(1);
  expect(assertStyled(panel, "中栏仪表盘")).toBeGreaterThan(1);
});

// —— 结构与单位（钉住两个真机故障） ————————

it("账号行是两段结构：身份块与动作在身份行里，额度条在它外面", () => {
  // 曾经三者是同一层的兄弟：身份块的 flex:1 被额度条的 min-width 挤没，名称成了竖排单字。
  const tree = AccountCard(accountProps({ status: statusOf([account({ ref: "work", quota: { windows: [{ key: "rolling", percent: 35 }], failures: [] } })]) }));
  const row = elementsOfSim(tree).find((element) => element.props["data-account"] === "work");
  expect(row, "账号行").toBeDefined();
  const head = elementsOfSim(row).find((element) => classesOf(element).includes(CSS_CLASS.accountHead));
  expect(head, "身份行（dsl-account-head）").toBeDefined();
  const headClasses = elementsOfSim(head).flatMap((element) => classesOf(element));
  expect(headClasses).toContain(CSS_CLASS.identity);
  expect(headClasses).toContain(CSS_CLASS.accountActions);
  // 额度条**不在**身份行里 —— 否则它又会去跟名称抢同一行的宽度。
  expect(elementsOfSim(head).some((element) => element.props["data-quota-window"] !== undefined)).toBe(false);
});

it("额度环：中心显示剩余百分比，绿色代表剩余充足，没数据不补 0", () => {
  const ring = (
    window: { key: string; used?: number; cap?: number; percent?: number; exceeded?: boolean },
  ): { level: unknown; remaining: unknown } | undefined => {
    const tree = AccountCard(accountProps({ status: statusOf([account({ ref: "work", quota: { windows: [window], failures: [] } })]) }));
    const wrapper = elementsOfSim(tree).find((element) => element.props["data-quota-ring"] !== undefined);
    if (wrapper === undefined) return undefined;
    return {
      level: wrapper.props["data-quota-ring-level"],
      remaining: wrapper.props["data-quota-ring-remaining"],
    };
  };

  // percent 是已用百分比：20% 已用 = 80% 剩余。
  expect(ring({ key: "w", percent: 20 })).toEqual({ level: "ok", remaining: 80 });
  expect(ring({ key: "w", percent: 50 })).toEqual({ level: "ok", remaining: 50 });
  expect(ring({ key: "w", percent: 85 })).toEqual({ level: "ok", remaining: 15 });
  expect(ring({ key: "w", percent: 100, exceeded: true })).toEqual({ level: "error", remaining: 0 });
  // used/cap 型：5/35 → 已用 14%，剩余 86%。
  expect(ring({ key: "w", used: 5, cap: 35 })).toEqual({ level: "ok", remaining: 86 });
  // 什么数都没有 → 灰色空环，不补 0。
  expect(ring({ key: "w" })).toEqual({ level: "missing", remaining: undefined });
  expect(ring({ key: "w", used: 0, cap: 0 })).toEqual({ level: "missing", remaining: undefined });
  // 越界值夹在 0–100。
  expect(ring({ key: "w", percent: 120 })).toEqual({ level: "error", remaining: 0 });
});

// —— 真实容器 ————————

/** 模块级共享状态的复位（每个用例都要有干净的插件级单例/存储/镜像）。 */
async function freshSeams(): Promise<void> {
  const { resetSeams } = await import("../../src/client/seams");
  const { resetShell } = await import("../../src/client/shell");
  resetSeams();
  resetShell();
}

it("真实挂载：保存条、侧边栏、仪表盘的按钮也都有类", async () => {
  const mini = await runtime();
  await freshSeams();
  const host = fakeHost(mini, { commandcodeToggle: true });
  const { createConnectedPage, registerSharedSurfaces, startSharedState, DASHBOARD_PANEL_ID, SIDEBAR_SLOT } = await import("../../src/client/seams");
  const { VENDORS, PAGE_LOCALE_NS } = await import("../../src/client/shell");

  // ① 设置页：先改一个字段，保存条（此前**没挂类**的三个按钮之一）才会渲染出来。
  const page = mini.mount(createConnectedPage({ entries: VENDORS, ctx: host.ctx as never, t }));
  await settleSim(mini);
  fireSim(findSim(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://styled.example" } });
  await settleSim(mini);
  expect(findSim(page.tree(), "data-save-bar"), "改过字段之后应该有保存条").toBeDefined();
  expect(assertStyled(page.tree(), "设置页容器")).toBeGreaterThan(1);

  // ② 侧边栏卡片与中栏面板：走真实的注册路径（与 `apply` 同序同物）。
  startSharedState(host.ctx as never, VENDORS);
  registerSharedSurfaces({ ctx: host.ctx as never, entries: VENDORS, t, localeNs: PAGE_LOCALE_NS });
  const sidebar = host.registered.find((entry) => entry.slot === SIDEBAR_SLOT);
  const panel = host.registered.find((entry) => entry.slot === "main");
  expect(sidebar, "侧边栏注册").toBeDefined();
  expect(panel, "中栏面板注册").toBeDefined();
  expect(panel!.entry["key"]).toBe(DASHBOARD_PANEL_ID);

  const card = mini.mount(sidebar!.component);
  await settleSim(mini);
  expect(assertStyled(card.tree(), "侧边栏容器")).toBeGreaterThan(1);

  const dashboard = mini.mount(panel!.component);
  await settleSim(mini);
  expect(assertStyled(dashboard.tree(), "面板容器")).toBeGreaterThan(1);
});
