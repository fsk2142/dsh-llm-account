/**
 * 容器仿真的假宿主：有状态的设置服务 + usage 远程命名空间 + 插槽 + 事件。
 *
 * 形状刻意贴着**真实宿主**（`src/client/seams.ts` 的接缝类型与本机已装的旧插件产物）：
 * - `settings.describe()` 返回**行**（`{ ns: 行 id, value, revision }`）—— opencode 的行 id
 *   （`opencode-go`）与核心命名空间（`llm-opencode-go`）不同，opendesign 同理
 *   （`opendesign` vs `llm-opendesign`）：这是 1b 修掉的写入 bug 的根因，第三家必须同形状；
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
  usageCalls: { method: string; vendor: string; input?: unknown }[];
  /** 模型目录读取记录（`重新获取模型` 按钮的断言依据）。 */
  modelCalls: string[];
  /** 网页登录调用记录（按厂商；`begin`/`status`/`cancel` 三个动作）。 */
  loginCalls: { method: "loginBegin" | "loginStatus" | "loginCancel"; vendor: string }[];
  /** 凭据库里「确实存在」的引用名（`setCredential` 会往里加；`credentialStatus` 按它回答）。 */
  credentials: Set<string>;
  /** 写进凭据库的调用（引用名 + 明文；明文只在这里出现，便于断言「没写空密钥」）。 */
  credentialWrites: { ref: string; secret: string }[];
  /** `credentialStatus` 被问过的引用名（断言「添加后确实重新查了一次」）。 */
  credentialStatusCalls: string[][];
  /** 让下一次 `setCredential` 被宿主拒绝（凭据服务报错）。 */
  failCredentialOnce: string | undefined;
  /** 每次实测被问到的引用名（断言「加完自动测了一次」）。 */
  probeCalls: string[][];
  /** 各引用名的实测结论（缺省 `ok`）。 */
  probeVerdicts: Record<string, { state: "ok" | "invalid" | "unknown"; reason?: string }>;
  /** 让下一次 `status()` 返回失败信封（刷新时的一次读失败）。 */
  statusFailOnce: string | undefined;
  /** 覆盖 `status()` 返回的账号表（运行中可改：模拟读数变化/清空）。 */
  accountsOverride: Record<string, readonly Record<string, unknown>[]> | undefined;
  /** 让下一次 `settings.describe()` 返回空数组（模拟设置服务瞬时读不到）。 */
  describeReturnsEmptyOnce: boolean;
  /**
   * 下一次/后续 `models()` 要带的失败项（空 = 正常）。可随时改写：
   * 「加账号前目录读不到、加账号后读到」这条链要靠它复现（失败的读数不进缓存）。
   */
  modelFailures: string[];
  /** 让接下来的一次 mutate 撞上修订号冲突（并发写者的模拟）。 */
  conflictOnce: boolean;
  /** 让接下来的一次 mutate 以普通错误失败。 */
  failOnce: string | undefined;
  /** 广播一次设置文档失效信号（外部改设置后宿主会做的事）。 */
  emitDocumentUpdated(): void;
}

/** 各家的默认授权网址（三条登录链路的真实形状不同，假宿主按厂商区分）。 */
const LOGIN_URLS: Readonly<Record<string, string>> = {
  commandcode: "https://commandcode.ai/studio/auth/cli?state=x",
  "dsh-opencode-go": "https://opencode.ai/auth/device?code=ABCD",
  opendesign: "https://open-design.ai/device?code=WXYZ",
};

/** 宿主侧返回的用量状态形状（`VendorUsageStatus` 的最小可用版）。 */
function usageStatus(vendor: string, accounts: Record<string, readonly Record<string, unknown>[]>): Record<string, unknown> {
  return {
    vendor,
    capabilities: {
      reorder: vendor !== "commandcode",
      pin: true,
      // 与各家适配器的能力声明一致：commandcode 与 opendesign 都有网页登录（vela 设备授权）。
      browserLogin: vendor === "commandcode" || vendor === "opendesign",
      modelAccountRules: true,
      quotaShape: "windows",
      modelVisibilityWrite: "onSave",
      automaticSwitch: true,
    },
    pinned: null,
    accounts: (accounts[vendor] ?? []).map((account) => ({ ...account })),
    failures: [],
  };
}

/**
 * 造假宿主。
 * @param mini - 迷你运行时（异步登记要走它）。
 * @param options - 三家 `showSidebarQuota` 的初始值；`conflictOnce` 让第一次写入撞上并发冲突；
 *   `accounts` 按**厂商 id**（`commandcode` / `dsh-opencode-go` / `opendesign`）给用量状态塞账号行
 *   —— 缺省空（侧边栏卡片的空态文案依赖它）。
 * @returns 假宿主。
 */
export function fakeHost(
  mini: MiniReact,
  options: {
    commandcodeToggle?: boolean;
    opencodeToggle?: boolean;
    opendesignToggle?: boolean;
    conflictOnce?: boolean;
    accounts?: Record<string, readonly Record<string, unknown>[]>;
    /**
     * `usageReport(window)` 的返回（注入自定义报表；缺省**不提供**这个方法，走「宿主没实现」
     * 那条降级路径）。抛错会让页面进入「用量读取失败」分支 —— 用来钉住两种降级。
     */
    usageReport?: (window: string) => unknown;
    /**
     * 网页登录的脚本：`begin` 决定 `loginBegin(vendor)` 的返回（可以是 `failed` 状态，
     * 也可以抛错来模拟"调用没发出去"）；`status` 决定轮询读到的状态。
     * 缺省按厂商返回 `waiting`（带各自的授权网址），状态读作 `idle`。
     */
    login?: {
      begin?: (vendor: string) => unknown;
      status?: (vendor: string) => unknown;
    };
    /**
     * 凭据服务的形状。`false` = **老宿主**（不提供 `setCredential`/`credentialStatus`），
     * 于是搜索卡的密钥区整块不渲染 —— 两条降级路径都要能测。
     */
    credentials?: boolean;
    /** 凭据库里预先存在的引用名（页面据此显示「已添加」）。 */
    credentialsInitially?: readonly string[];
    /**
     * 承载行里预先存在的搜索密钥引用名（`searchApiKeyRefs`）。
     * 缺省不给：真实用户第一次打开时这个字段本来就不存在。
     */
    secretRefs?: readonly string[];
  } = {},
): FakeHost {
  const rows = new Map<string, HostRow>([
    [
      "llm-commandcode",
      {
        value: {
          showSidebarQuota: options.commandcodeToggle ?? false,
          apiBase: "https://api.commandcode.ai",
          ...(options.secretRefs === undefined ? {} : { searchApiKeyRefs: [...options.secretRefs] }),
        },
        revision: 5,
      },
    ],
    [
      "opencode-go",
      { value: { showSidebarQuota: options.opencodeToggle ?? false, baseURL: "https://opencode.example" }, revision: 7 },
    ],
    [
      // 行 id 与命名空间**不同**（宿主侧 `SETTINGS_ROWS = ["opendesign", "llm-opendesign"]`）：
      // 与 opencode 同一形状，页面发现与保存都必须落在行 id 上。
      "opendesign",
      { value: { showSidebarQuota: options.opendesignToggle ?? false, workspaceId: "ws-fake" }, revision: 9 },
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
    modelCalls: [],
    loginCalls: [],
    modelFailures: [],
    credentials: new Set(options.credentialsInitially ?? []),
    credentialWrites: [],
    credentialStatusCalls: [],
    failCredentialOnce: undefined,
    probeCalls: [],
    probeVerdicts: {},
    statusFailOnce: undefined,
    accountsOverride: undefined,
    describeReturnsEmptyOnce: false,
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
      // 可注入的失败：用来复现「刷新时的一次读失败」（2026-10-20 报障）。
      if (host.statusFailOnce !== undefined) {
        const reason = host.statusFailOnce;
        host.statusFailOnce = undefined;
        return mini.track({ ok: false, error: reason });
      }
      const accounts = host.accountsOverride ?? options.accounts ?? {};
      return mini.track(usageStatus(vendor, accounts));
    },
    accounts: (): Promise<unknown[]> => mini.track([]),
    switches: (): Promise<unknown[]> => mini.track([]),
    // 只有测试显式给了报表才提供这个方法：缺省时页面走「宿主没实现 usageReport」的降级。
    ...(options.usageReport === undefined
      ? {}
      : {
          usageReport: (window: string): Promise<unknown> => {
            host.usageCalls.push({ method: "usageReport", vendor: window });
            return mini.track(options.usageReport?.(window));
          },
        }),
    models: (vendor: string): Promise<unknown> => {
      host.modelCalls.push(vendor);
      return mini.track({
        models:
          host.modelFailures.length > 0
            ? []
            : [
                { id: "m1", name: "M1", company: "anthropic" },
                { id: "m2", name: "M2", free: true },
              ],
        failures: [...host.modelFailures],
      });
    },
    addAccount: (vendor: string, input: { label: string; key?: string }): Promise<unknown> => {
      host.usageCalls.push({ method: "addAccount", vendor, input });
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
    loginBegin: (vendor: string): Promise<unknown> => {
      host.loginCalls.push({ method: "loginBegin", vendor });
      return mini.track(
        options.login?.begin?.(vendor) ?? {
          state: "waiting",
          authUrl: LOGIN_URLS[vendor] ?? "https://example.invalid/auth",
        },
      );
    },
    loginStatus: (vendor: string): Promise<unknown> => {
      host.loginCalls.push({ method: "loginStatus", vendor });
      return mini.track(options.login?.status?.(vendor) ?? { state: "idle" });
    },
    loginCancel: (vendor: string): Promise<void> => {
      host.loginCalls.push({ method: "loginCancel", vendor });
      return mini.track(undefined);
    },
    // 搜索密钥：凭据库的读口与写口。有它们，搜索卡才渲染「添加密钥」与已添加列表
    // （缺省时整块不渲染 —— 那是老宿主的降级路径，两个方向都要能测，所以做成可关）。
    ...(options.credentials === false
      ? {}
      : {
          /** 凭据库里「确实存在」的引用名（`credentialStatus` 的回答）。 */
          credentialStatus: (refs: readonly string[]): Promise<unknown> => {
            host.credentialStatusCalls.push([...refs]);
            return mini.track(refs.filter((ref) => host.credentials.has(ref)).map((ref) => ({ ref, configured: true })));
          },
          setCredential: (ref: string, secret: string): Promise<unknown> => {
            host.credentialWrites.push({ ref, secret });
            if (host.failCredentialOnce !== undefined) {
              const reason = host.failCredentialOnce;
              host.failCredentialOnce = undefined;
              return mini.track({ ok: false, error: reason });
            }
            host.credentials.add(ref);
            return mini.track(undefined);
          },
          /** 密钥实测：按 `host.probeVerdicts` 回答（缺省一律 `ok`）。 */
          probeSearchCredential: (refs: readonly string[]): Promise<unknown> => {
            host.probeCalls.push([...refs]);
            return mini.track(
              refs.map((ref) => {
                const verdict = host.probeVerdicts[ref] ?? { state: "ok" as const };
                return verdict.reason === undefined
                  ? { ref, state: verdict.state }
                  : { ref, state: verdict.state, reason: verdict.reason };
              }),
            );
          },
        }),
  });

  const settings = {
    describe: (): Promise<{ ns: string; value: Record<string, unknown>; revision: number }[]> => {
      // 可注入的「这次没读出来」：模拟设置服务瞬时失败。
      if (host.describeReturnsEmptyOnce) {
        host.describeReturnsEmptyOnce = false;
        return mini.track([]);
      }
      return mini.track([...rows.entries()].map(([row, state]) => ({ ns: row, value: { ...state.value }, revision: state.revision })));
    },
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