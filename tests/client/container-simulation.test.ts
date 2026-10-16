/**
 * 容器渲染仿真：把三个容器组件（设置页、侧边栏卡片、中栏仪表盘）**真正挂载起来**跑流程。
 *
 * 为什么需要这个文件：Ruling 22 的自觉取舍让容器（唯一的 Hook 宿主）不参与单测 ——
 * 测试用的 React 替身会把 Hook 调用判为失败。代价是容器**接线**没有进程内覆盖，例如
 * 「保存失败时把原因落进页面状态」「关掉开关后卡片真的停轮询」这些行为只由 1c 真机验证。
 * 变异检验证实了这一点：把 `onSave` 改回静默失败，当时的测试套件全绿。
 *
 * 本文件提供一个**迷你 React 运行时**（`useState`/`useEffect` 的单组件实现，语义取
 * 「渲染收集 → 依赖变化才跑 effect → setState 触发重渲染 → 卸载跑清理」），通过
 * `vi.mock("react", …)` 只在本文件内替换掉 Hook 抛错替身。被测的仍然是**生产代码**：
 * `registerSharedSurfaces` / `createConnectedPage` 原样参与，插槽、设置服务、远程命名空间
 * 都由假宿主提供。
 *
 * 覆盖的行为（全部是此前只有真机能验的）：
 * 1. 字段编辑 → 保存 → 写的是**命中的行名**（opencode 写 `opencode-go` 而不是命名空间）；
 * 2. 保存失败时保存条出现可读原因（不再是静默失败 —— 这条杀掉了一个存活变异）；
 * 3. 修订号冲突后重读重放：第二次保存成功；
 * 4. 账户操作（添加）经容器走到远程命名空间，名称/密钥在边界 trim；
 * 5. 侧边栏卡片开关生命周期：关闭 → 渲染 null + 推进时间零新增请求；开启 → 立即读 + 60s 轮询；
 *    再关闭 → 定时器停掉（规格 §8.1 第 6 条 / 冒烟 C13 的进程内版）；
 * 6. 外部改动（`settings/document-updated`）时卡片跟随；两家同开时跟第一家；
 * 7. usage 远程面只 `$mount` 一次（两个 profile 行共享），页面卸载不 dispose；
 * 8. 插槽注册形状（`id`/`order` 与 `key`），卡片「打开面板」与面板「关闭」都走 `layout.selectPanel`。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// —— 迷你 React 运行时（只在本文件内替换 react；生产代码与其它测试不受影响）——
//
// 语义刻意从简：组件只挂载一次、props 不变，因此不需要协调与 key diff；effect 的依赖
// 比较、清理顺序、setState 重渲染循环都按 React 的规则来。多个容器可以同时挂载
// （设置页 + 侧边栏卡片 + 仪表盘），各自一个实例。

/** 一个 Hook 槽位：状态或副作用（两类共用一个顺序空间，与 React 的 Hook 顺序契约一致）。 */
type Hook =
  | { kind: "state"; value: unknown }
  | { kind: "effect"; fn: () => void | (() => void); deps?: readonly unknown[]; cleanup?: (() => void) | undefined; pending: boolean };

interface Instance {
  component: () => unknown;
  hooks: (Hook | undefined)[];
  cursor: number;
  tree: unknown;
  dirty: boolean;
  unmounted: boolean;
}

const live: Instance[] = [];

/** 当前正在渲染的实例（`useState`/`useEffect` 只在渲染期间调用）。 */
let rendering: Instance | undefined;

/** 进行中的异步宿主调用数（假宿主自增自减，`settle` 用它判断「还没排空」）。 */
let inflight = 0;

/** 把一次假宿主的异步结果登记为 in-flight（`settle` 的排空判据）。 */
function track<T>(value: T): Promise<T> {
  inflight += 1;
  return Promise.resolve(value).then((settled) => {
    inflight -= 1;
    return settled;
  });
}

const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]): boolean => {
  if (left === undefined || right === undefined) return false; // 无依赖 = 每次渲染都跑
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
};

const runRender = (instance: Instance): void => {
  instance.cursor = 0;
  rendering = instance;
  try {
    instance.tree = instance.component();
  } finally {
    rendering = undefined;
  }
};

const flushEffects = (instance: Instance): void => {
  for (const hook of instance.hooks) {
    if (hook === undefined || hook.kind !== "effect" || !hook.pending) continue;
    hook.pending = false;
    hook.cleanup?.();
    const cleanup = hook.fn();
    hook.cleanup = typeof cleanup === "function" ? (cleanup as () => void) : undefined;
  }
};

const settleInstance = (instance: Instance): void => {
  for (let guard = 0; guard < 50 && instance.dirty && !instance.unmounted; guard += 1) {
    instance.dirty = false;
    runRender(instance);
    flushEffects(instance);
  }
  if (instance.dirty) throw new Error("mini-react: the component did not settle after 50 renders");
};

vi.mock("react", async () => {
  const stub = await import("../support/react-stub");

  const useState = <State>(initial: State | (() => State)): [State, (next: State | ((previous: State) => State)) => void] => {
    const instance = rendering;
    if (instance === undefined) throw new Error("mini-react: useState outside of render");
    const index = instance.cursor;
    instance.cursor += 1;
    let hook = instance.hooks[index];
    if (hook === undefined || hook.kind !== "state") {
      hook = { kind: "state", value: typeof initial === "function" ? (initial as () => State)() : initial };
      instance.hooks[index] = hook;
    }
    const slot = hook;
    const setter = (next: State | ((previous: State) => State)): void => {
      const resolved = typeof next === "function" ? (next as (previous: State) => State)(slot.value as State) : next;
      if (Object.is(resolved, slot.value)) return;
      slot.value = resolved;
      instance.dirty = true;
    };
    return [slot.value as State, setter];
  };

  const useEffect = (fn: () => void | (() => void), deps?: readonly unknown[]): void => {
    const instance = rendering;
    if (instance === undefined) throw new Error("mini-react: useEffect outside of render");
    const index = instance.cursor;
    instance.cursor += 1;
    const existing = instance.hooks[index];
    if (existing === undefined || existing.kind !== "effect") {
      instance.hooks[index] = { kind: "effect", fn, deps, cleanup: undefined, pending: true };
      return;
    }
    existing.fn = fn;
    if (!sameDeps(existing.deps, deps)) {
      existing.deps = deps;
      existing.pending = true;
    }
  };

  return { createElement: stub.createElement, Fragment: stub.Fragment, useState, useEffect };
});

/** 挂载一个容器组件（生产代码原样参与）。 */
function mount(component: () => unknown): { tree: () => unknown; unmount: () => void } {
  const instance: Instance = { component, hooks: [], cursor: 0, tree: undefined, dirty: false, unmounted: false };
  live.push(instance);
  runRender(instance);
  flushEffects(instance);
  settleInstance(instance);
  return {
    tree: () => instance.tree,
    unmount: () => {
      if (instance.unmounted) return;
      instance.unmounted = true;
      for (const hook of instance.hooks) if (hook !== undefined && hook.kind === "effect") hook.cleanup?.();
      const index = live.indexOf(instance);
      if (index >= 0) live.splice(index, 1);
    },
  };
}

/**
 * 排空微任务，并把期间发生的 setState 渲染出来。
 *
 * 排空判据是 **连续三轮安静**（无 in-flight 宿主调用、无脏实例），而不是「这一轮有没有
 * 渲染」：容器的异步全是 promise 链（`describe → mutate → 再 describe`），链上的 `setState`
 * 要好几拍才落地，而 in-flight 计数会在 `await` 的续体之前先归零 —— 只看单轮会在链子走完
 * 之前就返回，那正是本文件初版的失败原因。
 *
 * 用固定轮数的微任务排空而不是 `setTimeout(0)`：有测试开着假定时器。
 */
async function settle(): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 80; round += 1) {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    for (const instance of [...live]) settleInstance(instance);
    const settled = inflight === 0 && live.every((instance) => !instance.dirty);
    quiet = settled ? quiet + 1 : 0;
    if (quiet >= 3) return;
  }
  throw new Error(`mini-react: the tree never settled (inflight=${inflight})`);
}

/** 元素形状（与 `../support/react-stub` 的 `StubElement` 同一套字段）。 */
interface StubElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly key: string | null;
}

/** 展开一个节点：函数组件就地调用（被测卡片都是纯函数，Ruling 22），元素按 children 摊平。 */
function expand(node: unknown, depth = 0): unknown[] {
  if (node === null || node === undefined || typeof node !== "object") return [node];
  if (depth > 20) throw new Error("mini-react: the element tree is deeper than 20 levels");
  if (Array.isArray(node)) return node.flatMap((child) => expand(child, depth + 1));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  const type = element.type;
  if (typeof type === "function") {
    // 纯函数组件：直接以 props 调用（真实 React 也在这里创建子树）。
    return expand((type as (props: Record<string, unknown>) => unknown)(element.props), depth + 1);
  }
  return [element, ...expand(element.props.children, depth + 1)];
}

/** 展平元素树（与其它客户端测试同一套遍历，额外展开函数组件）。 */
function elementsOf(node: unknown): StubElement[] {
  return expand(node).filter((value): value is StubElement => typeof value === "object" && value !== null && "props" in value && "type" in value);
}

function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value !== null && typeof value === "object" && "props" in (value as StubElement)) {
      walk((value as StubElement).props.children);
    }
  };
  walk(node);
  return out;
}

/** 触发一个元素的回调（模拟用户操作）。 */
function fire(element: StubElement | undefined, name: string, event: unknown = {}): void {
  if (element === undefined) throw new Error(`no element carries a ${name} handler`);
  const handler = element.props[name];
  if (typeof handler !== "function") throw new Error(`the element has no ${name} handler`);
  (handler as (value: unknown) => void)(event);
}

function find(tree: unknown, marker: string, value?: string): StubElement | undefined {
  return elementsOf(tree).find((element) => (value === undefined ? marker in element.props : element.props[marker] === value));
}

// —— 假宿主：有状态的设置服务 + usage 远程命名空间 + 插槽 + 事件 ————

/** 一行设置的当前状态。 */
interface HostRow {
  value: Record<string, unknown>;
  revision: number;
}

/** 一次被记录的设置提交。 */
interface HostMutation {
  row: string;
  ops: readonly { op: string; path: readonly string[]; value: unknown }[];
  revision: number;
}

interface FakeHost {
  ctx: Record<string, unknown>;
  rows: Map<string, HostRow>;
  mutations: HostMutation[];
  registered: { slot: string; entry: Record<string, unknown>; component: () => unknown }[];
  mounts: { package: string; descriptors: readonly unknown[] }[];
  panels: (string | null)[];
  listeners: Map<string, (() => void)[]>;
  statusCalls: string[];
  usageCalls: { method: string; vendor: string }[];
  /** 让接下来的一次 mutate 撞上修订号冲突（并发写者的模拟）。 */
  conflictOnce: boolean;
  /** 让接下来的一次 mutate 以普通错误失败。 */
  failOnce: string | undefined;
}

/** 造假宿主。两个 toggle 是两家 `showSidebarQuota` 的初始值。 */
function fakeHost(options: { commandcodeToggle?: boolean; opencodeToggle?: boolean; conflictOnce?: boolean } = {}): FakeHost {
  const rows = new Map<string, HostRow>([
    ["llm-commandcode", { value: { showSidebarQuota: options.commandcodeToggle ?? false, apiBase: "https://api.commandcode.ai" }, revision: 5 }],
    ["opencode-go", { value: { showSidebarQuota: options.opencodeToggle ?? false, baseURL: "https://opencode.example" }, revision: 7 }],
  ]);
  const host: FakeHost = {
    rows,
    mutations: [],
    registered: [],
    mounts: [],
    panels: [],
    listeners: new Map(),
    statusCalls: [],
    usageCalls: [],
    conflictOnce: options.conflictOnce ?? false,
    failOnce: undefined,
    ctx: {},
  };

  const emit = (event: string): void => {
    for (const listener of host.listeners.get(event) ?? []) listener();
  };

  /** 假 usage 远程命名空间：状态读计入 statusCalls，账号操作计入 usageCalls。 */
  const usage = (): Record<string, unknown> => ({
    status: (vendor: string): Promise<unknown> => {
      host.statusCalls.push(vendor);
      return track({
        vendor,
        capabilities: {
          reorder: vendor !== "commandcode",
          pin: vendor === "commandcode",
          browserLogin: vendor === "commandcode",
          modelAccountRules: false,
          quotaShape: "windows",
          modelVisibilityWrite: "onSave",
          automaticSwitch: true,
        },
        pinned: null,
        effective: null,
        accounts: [],
        failures: [],
      });
    },
    accounts: (): Promise<unknown[]> => track([]),
    switches: (): Promise<unknown[]> => track([]),
    addAccount: (vendor: string, input: { label: string; key?: string }): Promise<unknown> => {
      host.usageCalls.push({ method: "addAccount", vendor });
      return track({ ref: "DSH_NEW_ACCOUNT", label: input.label, configured: input.key !== undefined, active: false });
    },
    renameAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "renameAccount", vendor });
      return track(undefined);
    },
    replaceKey: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "replaceKey", vendor });
      return track(undefined);
    },
    removeAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "removeAccount", vendor });
      return track(undefined);
    },
    selectAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "selectAccount", vendor });
      return track(undefined);
    },
    moveAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "moveAccount", vendor });
      return track(undefined);
    },
    setAutoSwitch: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "setAutoSwitch", vendor });
      return track(undefined);
    },
    loginBegin: (): Promise<unknown> => track({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x" }),
    loginStatus: (): Promise<unknown> => track({ state: "idle" }),
    loginCancel: (): Promise<void> => track(undefined),
  });

  const settings = {
    describe: (): Promise<{ ns: string; value: Record<string, unknown>; revision: number }[]> =>
      track([...rows.entries()].map(([row, state]) => ({ ns: row, value: { ...state.value }, revision: state.revision }))),
    mutate: async (row: string, ops: readonly { op: string; path: readonly string[]; value: unknown }[], expected: number): Promise<unknown> => {
      const state = rows.get(row);
      if (state === undefined) throw new Error(`No configurable plugin entry "${row}"`);
      if (host.conflictOnce) {
        host.conflictOnce = false;
        state.revision += 1; // 并发写者抢先提交
        throw Object.assign(new Error("settings revision conflict"), { code: "SETTINGS_CONFLICT" });
      }
      if (host.failOnce !== undefined) {
        const reason = host.failOnce;
        host.failOnce = undefined;
        throw new Error(reason);
      }
      if (state.revision !== expected) {
        throw Object.assign(new Error("settings revision conflict"), { code: "SETTINGS_CONFLICT" });
      }
      host.mutations.push({ row, ops, revision: expected });
      for (const op of ops) {
        const field = op.path[0];
        if (field === undefined) continue;
        if (op.op === "set") state.value = { ...state.value, [field]: op.value };
        else {
          const next = { ...state.value };
          delete next[field];
          state.value = next;
        }
      }
      state.revision += 1;
      // 宿主在文档变化后广播失效信号（客户端设置镜像靠它保持新鲜）。
      emit("settings/document-updated");
      return track({ ns: row, value: { ...state.value }, revision: state.revision });
    },
  };

  const remote: Record<string, unknown> = {
    settings,
    $on: (event: string, listener: () => void): (() => void) => {
      const list = host.listeners.get(event) ?? [];
      list.push(listener);
      host.listeners.set(event, list);
      return () => {
        host.listeners.set(
          event,
          (host.listeners.get(event) ?? []).filter((entry) => entry !== listener),
        );
      };
    },
    $mount: (contribution: { package: string; descriptors: readonly unknown[] }): Promise<() => void> => {
      host.mounts.push(contribution);
      return track(() => undefined);
    },
  };

  const layout = { selectPanel: (panel: string | null): void => void host.panels.push(panel) };
  const slots = {
    inject: (_slot: string, callback: () => unknown): unknown => callback(),
    register: (entry: Record<string, unknown>, component: () => unknown): unknown => {
      host.registered.push({ slot: String(entry["name"]), entry, component });
      return () => undefined;
    },
  };

  host.ctx = {
    slots,
    remote,
    get: (name: string) => (name === "layout" ? layout : undefined),
    inject: (names: readonly string[], callback: (scoped: Record<string, unknown>) => unknown): unknown => {
      const scoped: Record<string, unknown> = {
        remote: names[0] === "remote.llm-account" ? { ...remote, "llm-account": usage() } : remote,
        // 嵌套注入：第二层的名字由被注入的回调自己解析（这里直接把当前作用域递下去）。
        inject: () => callback(scoped),
        effect: (fn: () => unknown) => fn(),
        slots,
        get: (name: string) => (name === "layout" ? layout : undefined),
      };
      return callback(scoped);
    },
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => () => undefined, bind: () => (key: string) => key },
  };
  return host;
}

afterEach(() => {
  for (const instance of [...live]) {
    instance.unmounted = true;
    for (const hook of instance.hooks) if (hook !== undefined && hook.kind === "effect") hook.cleanup?.();
  }
  live.length = 0;
  inflight = 0;
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
async function pageContainer(host: FakeHost, renderVendorCards?: (cards: never) => unknown): Promise<() => unknown> {
  const { createConnectedPage } = await import("../../src/client/seams");
  const { VENDORS } = await import("../../src/client/shell");
  const { dictionaryOf } = await import("../../src/client/copy");
  return createConnectedPage({
    entries: VENDORS,
    ctx: host.ctx as never,
    t: dictionaryOf("zh"),
    ...(renderVendorCards === undefined ? {} : { renderVendorCards: renderVendorCards as never }),
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

// —— 仿真 1：设置页容器 ————————

describe("设置页容器仿真", () => {
  it("字段编辑 → 保存 → 写的是命中的行名；opencode 写行 id 而不是命名空间", async () => {
    await freshSeams();
    const host = fakeHost();
    const page = mount(await pageContainer(host));
    await settle();

    // 切到 opencode 标签页，改 baseURL，保存。
    fire(find(page.tree(), "data-tab", "llm-opencode-go"), "onClick");
    await settle();
    fire(find(page.tree(), "data-field-input", "baseURL"), "onChange", { target: { value: "https://new.example" } });
    await settle();
    expect(find(page.tree(), "data-save-bar")).toBeDefined();

    fire(find(page.tree(), "data-save", "llm-opencode-go"), "onClick");
    await settle();

    // 写的是行 id `opencode-go`（宿主按条目 id 寻址；写命名空间会落空）。
    expect(host.mutations).toHaveLength(1);
    expect(host.mutations[0]!.row).toBe("opencode-go");
    expect(host.mutations[0]!.ops).toEqual([{ op: "set", path: ["baseURL"], value: "https://new.example" }]);
    // 保存成功：保存条消失（基线以宿主为准），宿主文档已更新。
    expect(find(page.tree(), "data-save-bar")).toBeUndefined();
    expect(host.rows.get("opencode-go")!.value.baseURL).toBe("https://new.example");
  });

  it("保存失败时保存条显示可读原因，而不是静默失败（杀掉存活变异的那条）", async () => {
    await freshSeams();
    const host = fakeHost();
    const page = mount(await pageContainer(host));
    await settle();

    fire(find(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://edited.example" } });
    await settle();

    host.failOnce = "the credentials service rejected the write";
    fire(find(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settle();

    // 界面上有失败提示（通用文案），宿主的原文在 data 属性上供排查。
    const error = find(page.tree(), "data-save-error", "llm-commandcode");
    expect(error).toBeDefined();
    expect(textsOf(page.tree())).toContain("保存失败，请重试。");
    expect(error!.props["data-save-error-reason"]).toBe("the credentials service rejected the write");
    // 草稿与保存条都在（用户可以改完重试）。
    expect(find(page.tree(), "data-save-bar")).toBeDefined();

    // 重试成功：错误与保存条一起消失。
    fire(find(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settle();
    expect(find(page.tree(), "data-save-error")).toBeUndefined();
    expect(find(page.tree(), "data-save-bar")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://edited.example");
  });

  it("修订号冲突后自动重读重放：第二次保存成功（乐观修订号猜不得）", async () => {
    await freshSeams();
    const host = fakeHost({ conflictOnce: true });
    const page = mount(await pageContainer(host));
    await settle();

    fire(find(page.tree(), "data-field-input", "apiBase"), "onChange", { target: { value: "https://first.example" } });
    await settle();
    fire(find(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settle();

    // 并发写者把修订号 +1：这次保存必须失败并提示（而不是带着旧修订号静默丢写）。
    expect(find(page.tree(), "data-save-error", "llm-commandcode")).toBeDefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://api.commandcode.ai");

    // 用户再点一次保存：保存后重读过宿主，修订号是新的 → 成功。
    fire(find(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settle();
    expect(find(page.tree(), "data-save-error")).toBeUndefined();
    expect(host.rows.get("llm-commandcode")!.value.apiBase).toBe("https://first.example");
  });

  it("账户操作经容器走到远程命名空间：填名称与密钥 → 添加 → addAccount(vendor, {label, key})", async () => {
    const { AccountCard } = await import("../../src/client/account-card");
    const { createElement } = await import("react");
    await freshSeams();
    const host = fakeHost();
    const seen: { label: string; key?: string }[] = [];
    const page = mount(
      await pageContainer(host, (cards: never) => {
        const context = cards as unknown as {
          t: (key: string) => string;
          usage?: { addAccount?: (vendor: string, input: { label: string; key?: string }) => Promise<unknown> };
          openAction: (action: unknown) => void;
          setActionField: (field: string, value: string) => void;
          confirmAction: () => void;
          cancelAction: () => void;
          select: (ref: string) => void;
          remove: (ref: string) => void;
          toggleExpand: (ref: string) => void;
          loginBegin: () => void;
        };
        // 包一层，把容器递给卡片的那个「添加账户」回调换成可断言的记录器。
        return createElement(AccountCard as never, {
          status: undefined,
          t: context.t,
          onOpenAction: context.openAction,
          onActionField: context.setActionField,
          onConfirmAction: () => {
            const action = (cards as unknown as { action?: { kind: string; label: string; key: string } }).action;
            if (action?.kind !== "add") {
              context.confirmAction();
              return;
            }
            const label = action.label.trim();
            const key = action.key.trim();
            if (label === "" || key === "") return;
            seen.push(key === "" ? { label } : { label, key });
            context.confirmAction();
          },
          onCancelAction: context.cancelAction,
          onSelect: context.select,
          onRemove: context.remove,
          onToggleExpand: context.toggleExpand,
          onLoginBegin: context.loginBegin,
        } as never);
      }),
    );
    await settle();

    // 底部「添加账户」：名称 + 密钥（受控输入），点添加。
    fire(find(page.tree(), "data-add-label"), "onChange", { target: { value: " work " } });
    fire(find(page.tree(), "data-add-key"), "onChange", { target: { value: " sk-new\n" } });
    await settle();
    fire(find(page.tree(), "data-action", "add"), "onClick");
    await settle();

    // 走到远程命名空间；名称/密钥在派发边界上 trim 过（派发本身由 seams.test.ts 覆盖）。
    expect(host.usageCalls).toEqual([{ method: "addAccount", vendor: "commandcode" }]);
    expect(seen).toEqual([{ label: "work", key: "sk-new" }]);
  });
});

// —— 仿真 2：侧边栏卡片 ————————

describe("侧边栏卡片容器仿真", () => {
  it("注册形状：侧边栏用 id/order，中栏面板用 key；卡片与面板都常驻", async () => {
    await freshSeams();
    const host = fakeHost();
    const { card, panel } = await applyLikeHost(host);
    const { SIDEBAR_CARD_ID, DASHBOARD_PANEL_ID, SIDEBAR_SLOT } = await import("../../src/client/seams");

    const sidebar = host.registered.find((entry) => entry.slot === SIDEBAR_SLOT)!;
    expect(sidebar.entry).toMatchObject({ id: SIDEBAR_CARD_ID, order: 1 });
    expect(sidebar.entry["key"]).toBeUndefined(); // 侧边栏用 id
    const main = host.registered.find((entry) => entry.slot === "main")!;
    expect(main.entry).toMatchObject({ key: DASHBOARD_PANEL_ID });
    expect(main.entry["order"]).toBeUndefined(); // 面板用 key，没有 order
    expect(typeof card).toBe("function");
    expect(typeof panel).toBe("function");
  });

  it("关闭 → 渲染 null 且零新增请求；开启 → 立即读 + 60s 轮询；再关闭 → 又零新增请求", async () => {
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost({ commandcodeToggle: false });
    const { card } = await applyLikeHost(host);
    const cardView = mount(card);
    await settle();

    // 关闭：卡片渲染 null（侧边栏里什么都没有），一次用量请求都没有。
    expect(cardView.tree()).toBeNull();
    expect(host.statusCalls).toEqual([]);
    vi.advanceTimersByTime(600_000);
    await settle();
    expect(host.statusCalls).toEqual([]);

    // 外部（等价于用户在设置页保存）把开关拨开：镜像重读 → 卡片出现并立即读一次。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: true };
    emitDocumentUpdated(host);
    await settle();
    expect(cardView.tree()).not.toBeNull();
    expect(textsOf(cardView.tree()).join(" ")).toContain("还没有请求经过这个账号");
    expect(host.statusCalls).toEqual(["commandcode"]);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(host.statusCalls).toEqual(["commandcode", "commandcode"]);
    vi.advanceTimersByTime(120_000);
    await settle();
    expect(host.statusCalls).toHaveLength(4);

    // 再关闭：卡片重新变 null，定时器停掉（推进再久也不再请求）。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    emitDocumentUpdated(host);
    await settle();
    expect(cardView.tree()).toBeNull();
    const afterClose = host.statusCalls.length;
    vi.advanceTimersByTime(600_000);
    await settle();
    expect(host.statusCalls).toHaveLength(afterClose);
    vi.useRealTimers();
  });

  it("设置页保存开关后卡片跟随：保存条 → 宿主文档 → 卡片出现（端到端一条链）", async () => {
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost({ commandcodeToggle: false });
    const { card } = await applyLikeHost(host);
    const cardView = mount(card);
    const page = mount(await pageContainer(host));
    await settle();
    expect(cardView.tree()).toBeNull();
    // 设置页自己的状态读（页面要显示额度），与卡片无关 —— 记下基线再比增量。
    const baseline = host.statusCalls.length;

    fire(find(page.tree(), "data-field-input", "showSidebarQuota"), "onChange", { target: { checked: true } });
    await settle();
    fire(find(page.tree(), "data-save", "llm-commandcode"), "onClick");
    await settle();
    expect(host.rows.get("llm-commandcode")!.value.showSidebarQuota).toBe(true);

    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls.slice(baseline)).toEqual(["commandcode"]);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(host.statusCalls.slice(baseline)).toEqual(["commandcode", "commandcode"]);
    vi.useRealTimers();
  });

  it("外部改动开关（settings/document-updated）时卡片跟随，无需设置页参与", async () => {
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost({ commandcodeToggle: true });
    const { card } = await applyLikeHost(host);
    const cardView = mount(card);
    await settle();

    // 开关初始为真：卡片直接出现并读取（冷启动 describe 兜底，无需先开设置页）。
    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls).toEqual(["commandcode"]);

    // 外部把开关拨掉（patch 文件/其它工具），宿主广播失效信号。
    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    emitDocumentUpdated(host);
    await settle();
    expect(cardView.tree()).toBeNull();
    const afterOff = host.statusCalls.length;
    vi.advanceTimersByTime(600_000);
    await settle();
    expect(host.statusCalls).toHaveLength(afterOff);
    vi.useRealTimers();
  });

  it("两家同开时跟第一家（commandcode）；第一家关掉后跟到 opencode", async () => {
    await freshSeams();
    vi.useFakeTimers();
    const host = fakeHost({ commandcodeToggle: true, opencodeToggle: true });
    const { card } = await applyLikeHost(host);
    const cardView = mount(card);
    await settle();
    expect(host.statusCalls).toEqual(["commandcode"]);

    host.rows.get("llm-commandcode")!.value = { ...host.rows.get("llm-commandcode")!.value, showSidebarQuota: false };
    emitDocumentUpdated(host);
    await settle();
    expect(cardView.tree()).not.toBeNull();
    expect(host.statusCalls).toEqual(["commandcode", "dsh-opencode-go"]);
    vi.useRealTimers();
  });

  it("usage 远程面只 $mount 一次（两个 profile 行共享），页面卸载不 dispose", async () => {
    await freshSeams();
    const { ensureUsageRemote, startSharedState } = await import("../../src/client/seams");
    const { VENDORS } = await import("../../src/client/shell");
    vi.useFakeTimers();
    const host = fakeHost();
    // 两个 profile 行各引导一次（共享同一份模块状态）。
    startSharedState(host.ctx as never, VENDORS);
    const shared = ensureUsageRemote(host.ctx as never);
    startSharedState(host.ctx as never, VENDORS);
    const { card } = await applyLikeHost(host);
    const cardView = mount(card);
    const page = mount(await pageContainer(host));
    await settle();
    const afterUnmount = host.statusCalls.length;

    expect(host.mounts).toHaveLength(1);
    expect(host.mounts[0]!.package).toBe("dsh-llm-account");

    // 页面卸载：远程面不撤（卡片还活着，还要用它）。新消费者拿到的必须是**同一个活着的**
    // 句柄 —— 若页面卸载时把它 dispose 掉，下一个消费者会重挂，`mounts` 就变成 2。
    const beforeUnmount = host.mounts.length;
    page.unmount();
    await settle();
    expect(ensureUsageRemote(host.ctx as never)).toBe(shared);
    expect(shared.disposed()).toBe(false);
    expect(host.mounts).toHaveLength(beforeUnmount);
    expect(cardView.tree()).toBeNull(); // 开关关着：仍然不渲染、不请求
    // 卸载后连**设置页自己**的用量请求也不再有（它随页面卸载了），卡片更是一次不发。
    vi.advanceTimersByTime(600_000);
    await settle();
    expect(host.statusCalls).toHaveLength(afterUnmount);
  });
});

// —— 仿真 3：中栏仪表盘 ————————

describe("仪表盘容器仿真", () => {
  it("跟随开关存储里的厂商：没有厂商时给占位，不编造", async () => {
    await freshSeams();
    const host = fakeHost({ commandcodeToggle: false });
    const { panel } = await applyLikeHost(host);
    const view = mount(panel);
    await settle();
    expect(textsOf(view.tree()).join(" ")).toContain("还没有可显示的用量数据");
    expect(host.statusCalls).toEqual([]);
  });

  it("打开面板时读一次状态，手动刷新再读一次；卡片「打开」与面板「关闭」都走 layout.selectPanel", async () => {
    await freshSeams();
    const host = fakeHost({ commandcodeToggle: true });
    const { card, panel } = await applyLikeHost(host);
    const cardView = mount(card);
    const view = mount(panel);
    await settle();
    expect(host.statusCalls.filter((vendor) => vendor === "commandcode").length).toBeGreaterThanOrEqual(1);

    fire(find(view.tree(), "data-dashboard-refresh"), "onClick");
    await settle();
    const beforeRefresh = host.statusCalls.length;
    expect(beforeRefresh).toBeGreaterThanOrEqual(2);

    // 卡片的「打开用量面板」按钮 → layout.selectPanel(面板 key)。
    fire(find(cardView.tree(), "data-sidebar-open"), "onClick");
    const { DASHBOARD_PANEL_ID } = await import("../../src/client/seams");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID]);

    // 面板的关闭按钮 → layout.selectPanel(null)。
    fire(find(view.tree(), "data-dashboard-close"), "onClick");
    expect(host.panels).toEqual([DASHBOARD_PANEL_ID, null]);
  });
});

/** 让假宿主广播一次设置文档失效信号（外部改设置后宿主会做的事）。 */
function emitDocumentUpdated(host: FakeHost): void {
  for (const listener of host.listeners.get("settings/document-updated") ?? []) listener();
}