/**
 * 容器仿真的假宿主：有状态的设置服务 + usage 远程命名空间 + 插槽 + 事件。
 *
 * 形状刻意贴着**真实宿主**（`src/client/seams.ts` 的接缝类型与本机已装的旧插件产物）：
 * - `settings.describe()` 返回**行**（`{ ns: 行 id, value, revision }`）—— opencode 的行 id
 *   （`opencode-go`）与核心命名空间（`llm-opencode-go`）不同，这是 1b 修掉的写入 bug 的根因；
 * - `settings.mutate(row, ops, expectedRevision)` 按**行 id** 寻址，并对修订号做围栏；
 * - `remote.$on("settings/document-updated", …)` 是宿主在设置文档变化时广播的失效信号；
 * - `slots.inject/register` 与 `layout.selectPanel` 照旧插件的调用形状。
 *
 * 全部异步走 {@link MiniReact.track}，`settleSim` 靠它判断「还有没有没落定的调用」。
 */
import type { MiniReact } from "./container-sim";

/** 一行设置的当前状态。 */
export interface HostRow {
  value: Record<string, unknown>;
  revision: number;
}

/** 一次被记录的设置提交。 */
export interface HostMutation {
  row: string;
  ops: readonly { op: string; path: readonly string[]; value: unknown }[];
  revision: number;
}

export interface FakeHost {
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
  /** 广播一次设置文档失效信号（外部改设置后宿主会做的事）。 */
  emitDocumentUpdated(): void;
}

/** 宿主侧返回的用量状态形状（`VendorUsageStatus` 的最小可用版）。 */
function usageStatus(vendor: string): Record<string, unknown> {
  return {
    vendor,
    capabilities: {
      reorder: vendor !== "commandcode",
      pin: true,
      browserLogin: vendor === "commandcode",
      modelAccountRules: true,
      quotaShape: "windows",
      modelVisibilityWrite: "onSave",
      automaticSwitch: true,
    },
    pinned: null,
    accounts: [],
    failures: [],
  };
}

/**
 * 造假宿主。
 * @param mini - 迷你运行时（异步登记要走它）。
 * @param options - 两家 `showSidebarQuota` 的初始值；`conflictOnce` 让第一次写入撞上并发冲突。
 * @returns 假宿主。
 */
export function fakeHost(
  mini: MiniReact,
  options: { commandcodeToggle?: boolean; opencodeToggle?: boolean; conflictOnce?: boolean } = {},
): FakeHost {
  const rows = new Map<string, HostRow>([
    [
      "llm-commandcode",
      { value: { showSidebarQuota: options.commandcodeToggle ?? false, apiBase: "https://api.commandcode.ai" }, revision: 5 },
    ],
    [
      "opencode-go",
      { value: { showSidebarQuota: options.opencodeToggle ?? false, baseURL: "https://opencode.example" }, revision: 7 },
    ],
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
    emitDocumentUpdated: () => {
      for (const listener of host.listeners.get("settings/document-updated") ?? []) listener();
    },
  };

  /** 假 usage 远程命名空间：状态读计入 statusCalls，账号操作计入 usageCalls。 */
  const usage = (): Record<string, unknown> => ({
    status: (vendor: string): Promise<unknown> => {
      host.statusCalls.push(vendor);
      return mini.track(usageStatus(vendor));
    },
    accounts: (): Promise<unknown[]> => mini.track([]),
    switches: (): Promise<unknown[]> => mini.track([]),
    addAccount: (vendor: string, input: { label: string; key?: string }): Promise<unknown> => {
      host.usageCalls.push({ method: "addAccount", vendor });
      return mini.track({ ref: "DSH_NEW_ACCOUNT", label: input.label, configured: input.key !== undefined, active: false });
    },
    renameAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "renameAccount", vendor });
      return mini.track(undefined);
    },
    replaceKey: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "replaceKey", vendor });
      return mini.track(undefined);
    },
    removeAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "removeAccount", vendor });
      return mini.track(undefined);
    },
    selectAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "selectAccount", vendor });
      return mini.track(undefined);
    },
    moveAccount: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "moveAccount", vendor });
      return mini.track(undefined);
    },
    setAutoSwitch: (vendor: string): Promise<void> => {
      host.usageCalls.push({ method: "setAutoSwitch", vendor });
      return mini.track(undefined);
    },
    loginBegin: (): Promise<unknown> => mini.track({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x" }),
    loginStatus: (): Promise<unknown> => mini.track({ state: "idle" }),
    loginCancel: (): Promise<void> => mini.track(undefined),
  });

  const settings = {
    describe: (): Promise<{ ns: string; value: Record<string, unknown>; revision: number }[]> =>
      mini.track([...rows.entries()].map(([row, state]) => ({ ns: row, value: { ...state.value }, revision: state.revision }))),
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
      if (state.revision !== expected) throw new Error("settings revision conflict");
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
      host.emitDocumentUpdated();
      return mini.track({ ns: row, value: { ...state.value }, revision: state.revision });
    },
  };

  const remote: Record<string, unknown> = {
    settings,
    $on: (event: string, listener: () => void): (() => void) => {
      const list = host.listeners.get(event) ?? [];
      list.push(listener);
      host.listeners.set(event, list);
      return () => host.listeners.set(event, (host.listeners.get(event) ?? []).filter((entry) => entry !== listener));
    },
    $mount: (contribution: { package: string; descriptors: readonly unknown[] }): Promise<() => void> => {
      host.mounts.push(contribution);
      return mini.track(() => undefined);
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
        // 嵌套注入：第二层的作用域名由被注入的回调自己解析，这里直接把当前作用域递下去。
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