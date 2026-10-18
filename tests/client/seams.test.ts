/**
 * Task 4 测试：客户端**接缝层**（`src/client/seams.ts`）。
 *
 * 这里测的是「猜出来的宿主形状」被调用时**我们这一侧**的行为：调用参数对不对、成功/失败分别
 * 怎么降级、卸载时有没有把东西收干净。宿主那一侧到底接不接受这些形状，本机无法验证（计划 1c）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canSelectPanel,
  describeVendorSnapshots,
  dispatchAccountAction,
  ensureUsageRemote,
  modelWriteModeOf,
  mountUsageRemote,
  noteSidebarSnapshots,
  onUsageReady,
  quotaRefreshMs,
  sidebarRotateMs,
  readAccounts,
  readStatus,
  readStatusDetail,
  registerPanelCard,
  registerSharedSurfaces,
  registerSidebarCard,
  resetSeams,
  saveSettings,
  selectPanel,
  sidebarVendor,
  sidebarVendorSeeded,
  sidebarVendorSettings,
  startSharedState,
  startSidebarMirror,
  subscribeCredentials,
  subscribeSidebarVendor,
  usageNamespace,
  DASHBOARD_PANEL_ID,
  type ClientSeamContext,
  type RemoteSettings,
} from "../../src/client/seams";
import { USAGE_NAMESPACE, USAGE_PACKAGE, usageDescriptors, type UsageNamespace } from "../../src/client/usage-contract";
import type { VendorCapabilities } from "../../src/core/adapter";
import { VENDORS } from "../../src/client/shell";

/** Command Code 的能力矩阵（测试夹具：页面据此降级）。 */
const CAPABILITIES: VendorCapabilities = {
  reorder: false,
  pin: true,
  browserLogin: true,
  modelAccountRules: true,
  quotaShape: "windows",
  modelVisibilityWrite: "onSave",
  automaticSwitch: true,
};

it("模型卡片写模式：缺状态、缺 capabilities、缺字段都退回 onSave，且都不抛错", () => {
  // 实测踩过（桌面端 0.2.1-rc.2）：`statuses[v]?.capabilities.modelVisibilityWrite` 里的
  // `?.` 只挡住第一层；能力声明由 host 侧经 typert 登记的描述符发布，登记没发生时
  // `capabilities` 整个是 undefined，于是页面在渲染期抛
  // `Cannot read properties of undefined (reading 'modelVisibilityWrite')`，
  // React 丢弃整棵树 → 整段设置页变空白（连标题都没有），像「插件没注册上」。
  expect(modelWriteModeOf(undefined)).toBe("onSave");
  expect(modelWriteModeOf({})).toBe("onSave");
  expect(modelWriteModeOf({ capabilities: {} })).toBe("onSave");
  expect(modelWriteModeOf({ capabilities: { modelVisibilityWrite: "immediate" } })).toBe("immediate");
  expect(modelWriteModeOf({ capabilities: CAPABILITIES })).toBe("onSave");
});

/**
 * usage 远程面上的每一个读口都必须拆信封。
 *
 * 宿主契约：所有一元远程调用 resolve 成 `RemoteResult<T>`（`{ ok: true, value }` 或
 * `{ ok: false, error }`），宿主侧失败**不 reject**。这不是 settings 一处的问题——
 * status / accounts 同样返回信封。实测（桌面端 0.2.1-rc.2）把信封当载荷的
 * 两个后果：页面渲染期抛错整段变空白；侧边栏额度在 `failures.length` 上抛错、
 * 停在初始空态谎报「还没有请求经过这个账号」。
 */
describe("usage 远程面拆信封", () => {
  const status = {
    vendor: "commandcode",
    capabilities: CAPABILITIES,
    pinned: null,
    accounts: [{ ref: "COMMANDCODE_API_KEY_2", label: "sample-user-2", configured: true }],
    failures: [],
  };

  function usageOf(result: unknown): UsageNamespace {
    return {
      status: async () => result,
      accounts: async () => result,
      switches: async () => result,
    } as unknown as UsageNamespace;
  }

  it("读口拆出载荷，而不是把信封交给调用方", async () => {
    const wrapped = { ok: true, value: status };
    expect(await readStatus(usageOf(wrapped), "commandcode")).toEqual(status);
    expect(await readAccounts(usageOf(wrapped), "commandcode")).toEqual(status);
  });

  it("ok:false 与裸载荷都按「读不到」降级，不把信封漏给渲染层", async () => {
    const refused = { ok: false, error: { code: "gateway/internal", message: "usage service absent" } };
    expect(await readStatus(usageOf(refused), "commandcode")).toBeUndefined();
    // 裸载荷（本地替身 / 其它宿主形状）仍然可用。
    expect(await readStatus(usageOf(status), "commandcode")).toEqual(status);
  });

  it("状态读数带得出 capabilities 与 failures（侧边栏与卡片都依赖这两个字段）", async () => {
    const next = await readStatus(usageOf({ ok: true, value: status }), "commandcode");
    // 这两行正是此前崩在渲染期 / 谎报空态的地方。
    expect(next?.capabilities).toEqual(CAPABILITIES);
    expect(next?.failures.length).toBe(0);
  });

  /**
   * 读不到时必须带得出**原因**。
   *
   * `status === undefined` 有四种病因而症状一模一样（远程面没挂上 / 读口没装配 /
   * 调用报错 / 形状不认识）。只把它压成 `undefined` 的话，界面只能说一句对任何病因都
   * 成立的「账号数据暂不可用」——本机实测里已经为这句话猜错了好几轮。
   */
  it("readStatusDetail 带得出原因：命名空间缺席、读口缺席、信封报错、reject", async () => {
    const missing = await readStatusDetail(undefined, "commandcode");
    expect(missing.status).toBeUndefined();
    expect(missing.problem).toContain(USAGE_NAMESPACE);

    const noStatus = await readStatusDetail({} as UsageNamespace, "commandcode");
    expect(noStatus.status).toBeUndefined();
    expect(noStatus.problem).toContain("status()");

    // 信封的 ok:false：把宿主的 code 与 message 都带出来（排查要靠 code）。
    const refused = await readStatusDetail(
      usageOf({ ok: false, error: { code: "gateway/internal", message: "usage service absent" } }),
      "commandcode",
    );
    expect(refused.status).toBeUndefined();
    expect(refused.problem).toContain("gateway/internal");
    expect(refused.problem).toContain("usage service absent");

    // 只有装配层故障才会 reject；它也必须给出原因，而不是又一个 undefined。
    const throwing = {
      status: async () => {
        throw new Error("arity mismatch on status()");
      },
    } as unknown as UsageNamespace;
    expect((await readStatusDetail(throwing, "commandcode")).problem).toContain("arity mismatch");

    // 成功时没有原因。
    expect(await readStatusDetail(usageOf({ ok: true, value: status }), "commandcode")).toEqual({
      status,
      problem: undefined,
    });
  });
});

/** 一个假 `remote.settings`：记录 mutate 调用。 */
function fakeSettings(rows: readonly { ns?: string; id?: string; value?: unknown; revision?: number }[] = []): {
  service: RemoteSettings;
  mutations: { ns: string; ops: readonly unknown[]; revision: number | undefined }[];
  fail?: Error;
} {
  const holder: { service: RemoteSettings; mutations: { ns: string; ops: readonly unknown[]; revision: number | undefined }[]; fail?: Error } = {
    mutations: [],
    service: {
      describe: async () => [...rows],
      mutate: async (ns, ops, revision) => {
        if (holder.fail !== undefined) throw holder.fail;
        holder.mutations.push({ ns, ops, revision });
        return undefined;
      },
    },
  };
  return holder;
}

/** 一个假客户端上下文：`effect` 立刻执行并留下释放器，`inject` 立刻回调。 */
function fakeContext(remote: unknown): { ctx: ClientSeamContext; disposers: (() => void)[]; injected: string[][] } {
  const disposers: (() => void)[] = [];
  const injected: string[][] = [];
  const ctx: ClientSeamContext = {
    remote,
    inject: (names, callback) => {
      injected.push([...names]);
      return callback(ctx);
    },
    effect: (callback) => {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
      return () => undefined;
    },
  };
  return { ctx, disposers, injected };
}

/** 一个已挂载的远程命名空间：所有方法都可被覆盖，未覆盖的返回空结果。 */
function fakeNamespace(overrides: Partial<UsageNamespace> = {}): UsageNamespace {
  const empty = async (): Promise<never[]> => [];
  return {
    status: async () => ({ vendor: "commandcode", capabilities: CAPABILITIES, pinned: null, accounts: [], failures: [] }),
    accounts: empty,
    switches: empty,
    addAccount: async () => ({ ref: "r", label: "l", configured: false, active: false }),
    renameAccount: async () => undefined,
    replaceKey: async () => undefined,
    removeAccount: async () => undefined,
    selectAccount: async () => undefined,
    moveAccount: async () => undefined,
    setAutoSwitch: async () => undefined,
    loginBegin: async () => ({ state: "waiting" }),
    loginStatus: async () => ({ state: "idle" }),
    loginCancel: async () => undefined,
    ...overrides,
  };
}

it("发现厂商：只认注册表里声明过的命名空间，行 id 与命名空间两种键都接受", async () => {
  const settings = fakeSettings([
    { ns: "llm-commandcode", value: { apiBase: "https://a" }, revision: 3 },
    { id: "opencode-go", value: { usageDisplay: "off" }, revision: 1 },
    { ns: "some-other-plugin", value: {}, revision: 9 },
    { ns: "llm-ghost", value: {}, revision: 2 },
  ]);
  const { ctx } = fakeContext({ settings: settings.service });

  const snapshots = await describeVendorSnapshots(ctx, VENDORS);
  // `opencode-go` 是**行 id**，核心命名空间是 `llm-opencode-go`：两个都要认（与装配层同一顺序）。
  expect(snapshots.map((snapshot) => snapshot.ns)).toEqual(["llm-commandcode", "llm-opencode-go"]);
  expect(snapshots[1]).toMatchObject({ ns: "llm-opencode-go", revision: 1, value: { usageDisplay: "off" } });
  // 命中的**行名**带进快照：写路径必须用它（opencode 的行 id 与命名空间不同）。
  expect(snapshots[0]!.row).toBe("llm-commandcode");
  expect(snapshots[1]!.row).toBe("opencode-go");
});

it("发现厂商：远程缺席、没有 settings、describe 抛错都退化为空列表（不把页面弄崩）", async () => {
  const none = fakeContext(undefined);
  await expect(describeVendorSnapshots(none.ctx, VENDORS)).resolves.toEqual([]);
  const noSettings = fakeContext({});
  await expect(describeVendorSnapshots(noSettings.ctx, VENDORS)).resolves.toEqual([]);

  const boom = fakeContext({ settings: { describe: async () => { throw new Error("nope"); }, mutate: async () => undefined } });
  await expect(describeVendorSnapshots(boom.ctx, VENDORS)).resolves.toEqual([]);
});

it("凭据订阅：订阅 credentials/reference-updated，退订交回宿主给的函数", () => {
  const off = vi.fn();
  const listeners: (() => void)[] = [];
  const { ctx } = fakeContext({ $on: (_event: string, listener: () => void) => (listeners.push(listener), off) });
  const seen = vi.fn();

  const unsubscribe = subscribeCredentials(ctx, seen);
  expect(listeners).toHaveLength(1);
  listeners[0]!();
  expect(seen).toHaveBeenCalledTimes(1);
  unsubscribe();
  expect(off).toHaveBeenCalledTimes(1);
});

it("凭据订阅：宿主没有 $on 时返回空操作，而不是抛错", () => {
  const { ctx } = fakeContext({});
  const unsubscribe = subscribeCredentials(ctx, () => undefined);
  expect(typeof unsubscribe).toBe("function");
  expect(() => unsubscribe()).not.toThrow();
});

it("挂载远程面：把同一份描述符交给宿主的 $mount，再从 remote.<namespace> 取命名空间", async () => {
  const status = { vendor: "commandcode", capabilities: CAPABILITIES, pinned: null, accounts: [], failures: [] };
  const namespace = fakeNamespace({ status: async () => status });
  const mounted: { package: string; descriptors: readonly unknown[] }[] = [];
  const hostDispose = vi.fn();
  const remote: Record<string, unknown> = {
    // 真实顺序：Gateway 在 `$mount` 解决后才提供命名空间，所以注入回调里就能读到它。
    [USAGE_NAMESPACE]: namespace,
    $mount: async (contribution: { package: string; descriptors: readonly unknown[] }) => {
      mounted.push(contribution);
      return hostDispose;
    },
  };
  const { ctx, injected } = fakeContext(remote);
  const changes: unknown[] = [];

  const handle = mountUsageRemote(ctx, (value, error) => changes.push([value, error]));
  await vi.waitFor(() => expect(handle.namespace()).toBeDefined());

  expect(mounted).toHaveLength(1);
  expect(mounted[0]!.package).toBe(USAGE_PACKAGE);
  expect(mounted[0]!.descriptors).toHaveLength(usageDescriptors().length);
  // 挂载成功后才注入命名空间（旧插件的顺序：先 $mount 再 inject）。
  expect(injected).toEqual([[`remote.${USAGE_NAMESPACE}`]]);

  expect(changes.length).toBeGreaterThan(0);
  expect(handle.error()).toBeUndefined();
  await expect(readStatus(namespace, "commandcode")).resolves.toEqual(status);
});

it("挂载远程面：挂载失败时给出可读原因，且不抛到调用方", async () => {
  const { ctx } = fakeContext({ $mount: async () => { throw new Error("no gateway"); } });
  const handle = mountUsageRemote(ctx);

  await vi.waitFor(() => expect(handle.error()).toBeDefined());
  expect(handle.error()).toContain("no gateway");
  expect(handle.namespace()).toBeUndefined();
});

it("挂载远程面：宿主没有 $mount 时立即降级并说明原因", () => {
  const { ctx } = fakeContext({});
  const handle = mountUsageRemote(ctx);
  expect(handle.error()).toContain("$mount");
  expect(handle.namespace()).toBeUndefined();
});

it("挂载远程面：还没挂上就卸下时，迟到的挂载结果被释放掉（竞态）", async () => {
  let resolveMount: ((dispose: () => void) => void) | undefined;
  const lateDispose = vi.fn();
  const { ctx } = fakeContext({
    $mount: () => new Promise<() => void>((resolve) => { resolveMount = resolve; }),
  });

  const handle = mountUsageRemote(ctx);
  expect(handle.disposed()).toBe(false);
  handle.dispose();
  expect(handle.disposed()).toBe(true);
  resolveMount?.(lateDispose);
  await vi.waitFor(() => expect(lateDispose).toHaveBeenCalledTimes(1));
  expect(handle.namespace()).toBeUndefined();
});

it("挂载远程面：所在作用域清理后句柄报告已卸下（共享面据此重挂）", () => {
  const disposers: (() => void)[] = [];
  const ctx: ClientSeamContext = {
    remote: { $mount: async () => () => undefined },
    inject: (_names, callback) => callback(ctx),
    effect: (callback) => {
      const dispose = callback();
      if (typeof dispose === "function") disposers.push(dispose);
      return () => undefined;
    },
  };

  const handle = mountUsageRemote(ctx);
  expect(handle.disposed()).toBe(false);
  disposers[0]!();
  expect(handle.disposed()).toBe(true);
  expect(handle.namespace()).toBeUndefined();
});

it("远程读取：命名空间缺席或方法不全时返回 undefined（页面据此显示「不可用」）", async () => {
  await expect(readStatus(undefined, "commandcode")).resolves.toBeUndefined();
  await expect(readAccounts({} as never, "commandcode")).resolves.toBeUndefined();
});

it("保存设置：写**命中的行名**（不是核心命名空间），按字段逐条 set，带上修订号", async () => {
  const settings = fakeSettings();
  const { ctx } = fakeContext({ settings: settings.service });

  // opencode 的行 id 是 `opencode-go`、命名空间是 `llm-opencode-go`：写行名。
  await expect(
    saveSettings(ctx, "opencode-go", [{ key: "baseURL", value: "https://b" }, { key: "requestTimeoutMs", value: 30_000 }], 7),
  ).resolves.toBeUndefined();
  expect(settings.mutations).toEqual([
    {
      ns: "opencode-go",
      revision: 7,
      ops: [
        { op: "set", path: ["baseURL"], value: "https://b" },
        { op: "set", path: ["requestTimeoutMs"], value: 30_000 },
      ],
    },
  ]);
});

it("保存设置：失败返回可读原因（不静默 —— 用户以为保存成功而实际没有，比报错更糟）", async () => {
  const settings = fakeSettings();
  const { ctx } = fakeContext({ settings: settings.service });

  settings.fail = new Error("revision conflict");
  await expect(saveSettings(ctx, "llm-commandcode", [{ key: "apiBase", value: "https://c" }], 8)).resolves.toContain("revision conflict");
  // 没有字段要写：不算失败，也不发一次空写入。
  await expect(saveSettings(ctx, "llm-commandcode", [], 8)).resolves.toBeUndefined();
  expect(settings.mutations).toEqual([]);

  const noSettings = fakeContext({});
  await expect(saveSettings(noSettings.ctx, "llm-commandcode", [{ key: "apiBase", value: "x" }], 1)).resolves.toContain("settings service");
});

it("中栏面板接缝：宿主没有 layout.selectPanel 时返回 false（供调用方降级）", () => {
  const select = vi.fn();
  const withPanel = fakeContext({});
  withPanel.ctx.layout = { selectPanel: select };
  expect(selectPanel(withPanel.ctx, "llm-account")).toBe(true);
  expect(select).toHaveBeenCalledWith("llm-account");

  const without = fakeContext({});
  expect(selectPanel(without.ctx, "llm-account")).toBe(false);
});

it("canSelectPanel：只探不发 —— 有接缝报 true、没有报 false，都不真的调用", () => {
  // 「转到设置」按钮按它决定渲不渲染：探针本身不能有副作用（发一次 selectPanel(null)
  // 会把用户已经打开的面板关掉）。
  const select = vi.fn();
  const withPanel = fakeContext({});
  withPanel.ctx.layout = { selectPanel: select };
  expect(canSelectPanel(withPanel.ctx)).toBe(true);
  expect(select).not.toHaveBeenCalled();
  expect(canSelectPanel(fakeContext({}).ctx)).toBe(false);
});

// —— Task 8：侧边栏卡片的注册接缝 ——

it("侧边栏卡片注册：插槽名与形状逐字对齐旧插件", () => {
  const registered: { entry: Record<string, unknown>; component: unknown }[] = [];
  const slots = {
    inject: (name: string, callback: () => unknown) => {
      // 旧插件的两层：先 `slots.inject(slotName, () => slots.register(entry, C))`。
      expect(name).toBe("sidebar.footer.action");
      return callback();
    },
    register: (entry: Record<string, unknown>, component: unknown) => {
      registered.push({ entry, component });
      return undefined;
    },
  };
  const ctx: ClientSeamContext = {
    inject: (_names, callback) => callback({ slots }),
    slots,
  };

  registerSidebarCard(ctx, { id: "llm-account-quota", order: 1, locale: "settings.llm-account", component: "Component" });

  expect(registered).toHaveLength(1);
  expect(registered[0]!.entry).toMatchObject({
    name: "sidebar.footer.action",
    id: "llm-account-quota",
    order: 1,
    locale: "settings.llm-account",
  });
  // `inject` 是**工厂**（旧插件的形状是返回 `{ hooks, ...回调 }`）。
  expect(typeof registered[0]!.entry.inject).toBe("function");
  expect((registered[0]!.entry.inject as () => unknown)()).toMatchObject({ hooks: {} });
  expect(registered[0]!.component).toBe("Component");
});

it("侧边栏卡片重复回调时只保留一份（插件市场会反复重注册 section）", () => {
  const registered: { entry: Record<string, unknown>; component: unknown }[] = [];
  const disposers: boolean[] = [];
  let rearm: (() => void) | undefined;
  const slots = {
    inject: (name: string, callback: () => unknown) => {
      expect(name).toBe("sidebar.footer.action");
      rearm = () => {
        callback();
      };
      return callback();
    },
    register: (entry: Record<string, unknown>, component: unknown) => {
      const index = registered.length;
      registered.push({ entry, component });
      const off = (): void => {
        disposers[index] = true;
      };
      return off as unknown;
    },
  };
  const ctx: ClientSeamContext = { inject: (_names, callback) => callback({ slots }), slots };

  const dispose = registerSidebarCard(ctx, { id: "llm-account-quota", order: 1, locale: "settings.llm-account", component: "Component" });
  expect(registered).toHaveLength(1);
  expect(disposers).toEqual([]);

  // 宿主重新声明槽位（市场开关 section gate 会让它发生）：先撤旧的再注册新的。
  rearm?.();
  expect(registered).toHaveLength(2);
  expect(disposers[0]).toBe(true);
  expect(disposers[1]).not.toBe(true);

  dispose();
  expect(disposers[1]).toBe(true);
});

it("槽位重注册抛错时不该把 inject 控制器带走（设置页会永久消失）", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    let rearm: (() => void) | undefined;
    let fail = false;
    const slots = {
      inject: (_name: string, callback: () => unknown) => {
        rearm = () => {
          callback();
        };
        return callback();
      },
      register: () => {
        if (fail) throw new Error("slot busy");
        return () => undefined;
      },
    };
    const ctx: ClientSeamContext = { inject: (_names, callback) => callback({ slots }), slots };
    registerSidebarCard(ctx, { id: "x", order: 1, locale: "l", component: "C" });
    // 宿主重新声明槽位，而这时注册被拒（其它插件正在重注册）。
    fail = true;
    expect(() => rearm?.()).not.toThrow();
    expect(errors).toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

it("中栏面板重复回调时也只保留一份", () => {
  const registered: unknown[] = [];
  const disposers: boolean[] = [];
  let rearm: (() => void) | undefined;
  const slots = {
    inject: (_name: string, callback: () => unknown) => {
      rearm = () => {
        callback();
      };
      return callback();
    },
    register: (entry: Record<string, unknown>, component: unknown) => {
      const index = registered.length;
      registered.push({ entry, component });
      return () => {
        disposers[index] = true;
      };
    },
  };

  const dispose = registerPanelCard({ slots }, { key: "llm-account-dashboard", locale: "settings.llm-account", component: "Panel" });
  expect(registered).toHaveLength(1);
  rearm?.();
  expect(registered).toHaveLength(2);
  expect(disposers[0]).toBe(true);
  dispose();
  expect(disposers[1]).toBe(true);
});

it("中栏面板注册用 key 而不是 id（旧插件的 main 插槽形状）", () => {
  const registered: { entry: Record<string, unknown>; component: unknown }[] = [];
  const slots = {
    inject: (name: string, callback: () => unknown) => {
      expect(name).toBe("main");
      return callback();
    },
    register: (entry: Record<string, unknown>, component: unknown) => {
      registered.push({ entry, component });
      return undefined;
    },
  };

  registerPanelCard({ slots }, { key: "llm-account-dashboard", locale: "settings.llm-account", component: "Panel" });

  expect(registered).toHaveLength(1);
  expect(registered[0]!.entry).toMatchObject({
    name: "main",
    // 面板按 **key** 选择（壳层用 layout.selectPanel(key) 打开）；写成 `id` 会让面板永远打不开。
    key: "llm-account-dashboard",
    locale: "settings.llm-account",
  });
  expect(registered[0]!.entry["id"]).toBeUndefined();
  expect(registered[0]!.entry["order"]).toBeUndefined();
  expect(typeof registered[0]!.entry["inject"]).toBe("function");
  expect(registered[0]!.component).toBe("Panel");
});


it("侧边栏卡片注册失败不把客户端带走（与旧插件同样只留一行错误）", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const ctx: ClientSeamContext = {
      inject: (_names, callback) => callback({ slots: { inject: () => { throw new Error("no such slot"); }, register: () => undefined } }),
    };
    expect(() => registerSidebarCard(ctx, { id: "x", order: 1, locale: "l", component: "C" })).not.toThrow();
    expect(errors).toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

// —— Task 5：账户操作的派发（容器不参与单测，判定放在这里） ——

it("账户操作派发：添加/重命名/换密钥各自调用对应的远程方法", async () => {
  const calls: unknown[] = [];
  const namespace = fakeNamespace({
    addAccount: async (vendor, input) => {
      calls.push(["add", vendor, input]);
      return { ref: "new", label: input.label, configured: true, active: false };
    },
    renameAccount: async (vendor, ref, label) => void calls.push(["rename", vendor, ref, label]),
    replaceKey: async (vendor, ref, key) => void calls.push(["replaceKey", vendor, ref, key]),
  });

  await dispatchAccountAction(namespace, "commandcode", { kind: "add", label: "work", key: "sk-1" });
  await dispatchAccountAction(namespace, "commandcode", { kind: "add", label: "no-key", key: "" });
  await dispatchAccountAction(namespace, "commandcode", { kind: "rename", ref: "a", label: "renamed", key: "" });
  await dispatchAccountAction(namespace, "commandcode", { kind: "key", ref: "a", label: "", key: "sk-2" });

  expect(calls).toEqual([
    ["add", "commandcode", { label: "work", key: "sk-1" }],
    // 没填密钥：只建条目（`key` 字段整个不传，而不是传空串 —— 空串会被宿主当成「要写空密钥」）。
    ["add", "commandcode", { label: "no-key" }],
    ["rename", "commandcode", "a", "renamed"],
    ["replaceKey", "commandcode", "a", "sk-2"],
  ]);
});

it("账户操作派发：输入不合法或远程面不可用时**不发调用**（返回 undefined）", () => {
  const add = vi.fn();
  const namespace = fakeNamespace({ addAccount: add as never });

  // 空名称：宿主会拒绝，我们连调用都不发。
  expect(dispatchAccountAction(namespace, "commandcode", { kind: "add", label: "   ", key: "sk" })).toBeUndefined();
  // 空密钥不提交（那等于清掉账号的密钥）。
  expect(dispatchAccountAction(namespace, "commandcode", { kind: "key", ref: "a", label: "", key: "  " })).toBeUndefined();
  // 重命名必须有目标与名称。
  expect(dispatchAccountAction(namespace, "commandcode", { kind: "rename", label: "x", key: "" })).toBeUndefined();
  expect(dispatchAccountAction(namespace, "commandcode", { kind: "rename", ref: "a", label: " ", key: "" })).toBeUndefined();
  // 远程面还没挂上：什么都不做，也不抛。
  expect(dispatchAccountAction(undefined, "commandcode", { kind: "add", label: "x", key: "y" })).toBeUndefined();

  expect(add).not.toHaveBeenCalled();
});

it("账户操作派发：名称与密钥在边界上 trim（粘贴常带换行/尾随空格）", async () => {
  const calls: unknown[] = [];
  const namespace = fakeNamespace({
    addAccount: async (vendor, input) => {
      calls.push(["add", vendor, input]);
      return { ref: "new", label: input.label, configured: true, active: false };
    },
    renameAccount: async (vendor, ref, label) => void calls.push(["rename", vendor, ref, label]),
    replaceKey: async (vendor, ref, key) => void calls.push(["replaceKey", vendor, ref, key]),
  });

  await dispatchAccountAction(namespace, "commandcode", { kind: "add", label: "  work \n", key: " sk-1\n" });
  await dispatchAccountAction(namespace, "commandcode", { kind: "rename", ref: "a", label: "  renamed  ", key: "" });
  await dispatchAccountAction(namespace, "commandcode", { kind: "key", ref: "a", label: "", key: "\tsk-2 " });

  expect(calls).toEqual([
    ["add", "commandcode", { label: "work", key: "sk-1" }],
    ["rename", "commandcode", "a", "renamed"],
    ["replaceKey", "commandcode", "a", "sk-2"],
  ]);
});

// —— 插件级共享状态：usage 远程面单例 + 侧边栏开关存储 + 设置镜像 ——

afterEach(() => {
  resetSeams();
});

/** 两份设置行：opencode 用**行 id** 回来（与命名空间不同），另一家用命名空间。 */
function settingsRows(toggle: boolean): { ns?: string; id?: string; value: Record<string, unknown>; revision: number }[] {
  return [
    { ns: "llm-commandcode", value: { showSidebarQuota: toggle }, revision: 1 },
    { id: "opencode-go", value: { showSidebarQuota: toggle }, revision: 1 },
  ];
}

it("共享 usage 远程面：两个 profile 行（两次 ensure）只 $mount 一次", async () => {
  const mounted: { package: string; descriptors: readonly unknown[] }[] = [];
  const namespace = fakeNamespace();
  const { ctx } = fakeContext({
    [USAGE_NAMESPACE]: namespace,
    $mount: async (contribution: { package: string; descriptors: readonly unknown[] }) => {
      mounted.push(contribution);
      return () => undefined;
    },
  });

  const first = ensureUsageRemote(ctx);
  const second = ensureUsageRemote(ctx);
  expect(first).toBe(second);
  await vi.waitFor(() => expect(first.namespace()).toBe(namespace));
  expect(mounted).toHaveLength(1);
  expect(mounted[0]!.package).toBe(USAGE_PACKAGE);
  expect(mounted[0]!.descriptors).toHaveLength(usageDescriptors().length);
});

it("onUsageReady：先用当前值调用一次，命名空间挂上后再调用；退订后不再调用", async () => {
  const namespace = fakeNamespace();
  const { ctx } = fakeContext({ [USAGE_NAMESPACE]: namespace, $mount: async () => () => undefined });
  const seen: (UsageNamespace | undefined)[] = [];

  const off = onUsageReady(ctx, (value) => seen.push(value));
  expect(seen).toEqual([undefined]); // 挂载还是异步的：先给当前值（还没有）
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  expect(seen[1]).toBe(namespace);

  off();
  ensureUsageRemote(ctx).dispose();
  await vi.waitFor(() => expect(seen).toHaveLength(2)); // 卸下也不通知已退订的监听者
});

it("usageNamespace：先问共享句柄，再回落到 ctx.remote 上的命名空间", async () => {
  const namespace = fakeNamespace();
  const { ctx } = fakeContext({ [USAGE_NAMESPACE]: namespace, $mount: async () => () => undefined });
  await vi.waitFor(() => expect(ensureUsageRemote(ctx).namespace()).toBe(namespace));
  expect(usageNamespace(ctx)).toBe(namespace);

  // 回落路径：共享句柄不可用（没有 $mount），但上下文上直接挂着命名空间。
  resetSeams();
  const bare = fakeContext({ [USAGE_NAMESPACE]: namespace });
  expect(usageNamespace(bare.ctx)).toBe(namespace);
});

it("共享 usage 远程面：卸下后下一个消费者把它重挂回来（两行中一行卸载的自愈）", async () => {
  const mounted: unknown[] = [];
  const namespace = fakeNamespace();
  const remote: Record<string, unknown> = {
    [USAGE_NAMESPACE]: namespace,
    $mount: async () => {
      mounted.push(null);
      return () => undefined;
    },
  };
  const { ctx } = fakeContext(remote);

  const first = ensureUsageRemote(ctx);
  await vi.waitFor(() => expect(first.namespace()).toBe(namespace));
  first.dispose();
  expect(first.disposed()).toBe(true);

  const second = ensureUsageRemote(ctx);
  expect(second).not.toBe(first);
  await vi.waitFor(() => expect(second.namespace()).toBe(namespace));
  expect(mounted).toHaveLength(2);
});

it("侧边栏开关存储：按标签页顺序取第一家开启的厂商，关掉即清空", () => {
  const commandCode = { ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 };
  const opencode = { ns: "llm-opencode-go", row: "opencode-go", value: { showSidebarQuota: true }, revision: 1 };

  noteSidebarSnapshots(VENDORS, [commandCode, opencode]);
  expect(sidebarVendor()).toBe("commandcode");

  noteSidebarSnapshots(VENDORS, [opencode]);
  expect(sidebarVendor()).toBe("dsh-opencode-go");

  noteSidebarSnapshots(VENDORS, [{ ...commandCode, value: { showSidebarQuota: false } }, { ...opencode, value: { showSidebarQuota: false } }]);
  expect(sidebarVendor()).toBeUndefined();
});

it("侧边栏开关存储：空快照不清空、不 seed；非布尔值不算开启", () => {
  noteSidebarSnapshots(VENDORS, [{ ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 }]);
  expect(sidebarVendor()).toBe("commandcode");

  // 空读（宿主设置服务缺席/未就绪）既不清掉已开启的厂商，也不把存储标记成已 seed ——
  // 否则冷启动兜底就不再补救，一次时序抖动就会把卡片永久关掉。
  noteSidebarSnapshots(VENDORS, []);
  expect(sidebarVendor()).toBe("commandcode");
  expect(sidebarVendorSeeded()).toBe(true);

  resetSeams();
  noteSidebarSnapshots(VENDORS, [{ ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: "true" }, revision: 1 }]);
  expect(sidebarVendorSeeded()).toBe(true);
  expect(sidebarVendor()).toBeUndefined();
});

it("侧边栏开关存储：订阅者在变化时收到通知，值不变不重复通知", () => {
  const seen: (string | undefined)[] = [];
  const off = subscribeSidebarVendor((vendor) => seen.push(vendor));
  const on = { ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 };

  noteSidebarSnapshots(VENDORS, [on]);
  noteSidebarSnapshots(VENDORS, [on]); // 同值：不通知
  noteSidebarSnapshots(VENDORS, []); // 空快照：不通知
  noteSidebarSnapshots(VENDORS, [{ ...on, value: { showSidebarQuota: false } }]);
  expect(seen).toEqual(["commandcode", undefined]);

  off();
  noteSidebarSnapshots(VENDORS, [on]);
  expect(seen).toHaveLength(2);
});

it("quotaRefreshMs：分钟换算毫秒，缺省/非法回落到 60s，并夹在 [1, 120] 分钟", () => {
  expect(quotaRefreshMs(undefined)).toBe(60_000); // 缺省 = 1 分钟，与旧插件一致的体验
  expect(quotaRefreshMs("not-a-number")).toBe(60_000);
  expect(quotaRefreshMs(NaN)).toBe(60_000);
  expect(quotaRefreshMs(5)).toBe(5 * 60_000);
  expect(quotaRefreshMs(1)).toBe(60_000);
  expect(quotaRefreshMs(120)).toBe(120 * 60_000);
  // 越界值被夹回边界，而不是原样放大成荒谬的间隔。
  expect(quotaRefreshMs(0)).toBe(60_000);
  expect(quotaRefreshMs(-3)).toBe(60_000);
  expect(quotaRefreshMs(10_000)).toBe(120 * 60_000);
});

it("侧边栏设置存储：随快照刷新当前厂商的设置值，厂商不变但间隔改了也要即时生效", () => {
  const commandCode = { ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: true, quotaRefreshMinutes: 5 }, revision: 1 };

  noteSidebarSnapshots(VENDORS, [commandCode]);
  expect(sidebarVendor()).toBe("commandcode");
  expect(sidebarVendorSettings()).toMatchObject({ quotaRefreshMinutes: 5 });

  // 同一家、只把间隔从 5 改到 30：厂商没变（不触发 vendor 通知），但设置值必须刷新 ——
  // 否则 `pollInterval` 读到的是旧的 5 分钟，用户在设置页改了间隔不会在下一拍生效。
  noteSidebarSnapshots(VENDORS, [{ ...commandCode, value: { showSidebarQuota: true, quotaRefreshMinutes: 30 } }]);
  expect(sidebarVendor()).toBe("commandcode");
  expect(sidebarVendorSettings()).toMatchObject({ quotaRefreshMinutes: 30 });

  // 关闭后设置值清空（卡片不再需要它）。
  noteSidebarSnapshots(VENDORS, [{ ...commandCode, value: { showSidebarQuota: false } }]);
  expect(sidebarVendor()).toBeUndefined();
  expect(sidebarVendorSettings()).toBeUndefined();
});

it("设置镜像：首读 seed 存储，settings/document-updated 触发重读（事件潮合并）", async () => {
  let toggle = false;
  let describes = 0;
  const listeners: (() => void)[] = [];
  const { ctx } = fakeContext({
    settings: {
      describe: async () => {
        describes += 1;
        return settingsRows(toggle);
      },
      mutate: async () => undefined,
    },
    $on: (_event: string, listener: () => void) => {
      listeners.push(listener);
      return () => undefined;
    },
  });

  startSidebarMirror(ctx, VENDORS);
  await vi.waitFor(() => expect(sidebarVendorSeeded()).toBe(true));
  const afterStart = describes;
  expect(afterStart).toBeGreaterThanOrEqual(1);

  toggle = true;
  listeners[0]!();
  listeners[0]!(); // 同一轮微任务里的两次事件只读一次
  await vi.waitFor(() => expect(sidebarVendor()).toBe("commandcode"));
  expect(describes).toBe(afterStart + 1);

  // 幂等：第二次 start 不重复读、不重复订阅。
  const before = describes;
  startSidebarMirror(ctx, VENDORS);
  await Promise.resolve();
  expect(describes).toBe(before);
  expect(listeners).toHaveLength(1);
});

it("startSharedState：远程面与设置镜像都就位（apply 期引导，幂等）", async () => {
  let toggle = false;
  let mounts = 0;
  const listeners: (() => void)[] = [];
  const { ctx } = fakeContext({
    settings: { describe: async () => settingsRows(toggle), mutate: async () => undefined },
    $mount: async () => {
      mounts += 1;
      return () => undefined;
    },
    $on: (_event: string, listener: () => void) => {
      listeners.push(listener);
      return () => undefined;
    },
  });

  startSharedState(ctx, VENDORS);
  startSharedState(ctx, VENDORS); // 第二个 profile 行：无副作用
  await vi.waitFor(() => expect(sidebarVendorSeeded()).toBe(true));
  expect(mounts).toBe(1);
  expect(sidebarVendor()).toBeUndefined();

  // 开关被拨开（设置页里的保存会走宿主发出的事件；这里直接触发它）。
  toggle = true;
  listeners[0]!();
  await vi.waitFor(() => expect(sidebarVendor()).toBe("commandcode"));
  expect(mounts).toBe(1); // 远程面没有重挂
});

it("sidebarRotateMs：轮播间隔按分钟换算，缺省 1 分钟，夹在 [1, 60] 分钟", () => {
  expect(sidebarRotateMs(undefined)).toBe(60_000);
  expect(sidebarRotateMs("nope")).toBe(60_000);
  expect(sidebarRotateMs(0)).toBe(60_000);
  expect(sidebarRotateMs(3)).toBe(3 * 60_000);
  expect(sidebarRotateMs(120)).toBe(60 * 60_000); // 上限 1 小时
});

it("registerSharedSurfaces：只注册仪表盘一条主栏面板（「转到设置」面板已去掉）", () => {
  const registered: { slot: string; entry: Record<string, unknown> }[] = [];
  const slots = {
    inject: (_name: string, callback: () => unknown) => callback(),
    register: (entry: Record<string, unknown>) => {
      registered.push({ slot: String(entry["name"]), entry });
      return undefined;
    },
  };
  const ctx = { slots, inject: (_names: string[], callback: (value: unknown) => unknown) => callback({ slots }) } as unknown as ClientSeamContext;
  registerSharedSurfaces({ ctx, entries: VENDORS, t: (key: string) => key, localeNs: "settings.llm-account" });

  const main = registered.filter((item) => item.slot === "main");
  expect(main).toHaveLength(1);
  expect(main[0]!.entry).toMatchObject({ name: "main", key: DASHBOARD_PANEL_ID, locale: "settings.llm-account" });
  expect(main[0]!.entry["id"]).toBeUndefined();
  expect(main[0]!.entry["order"]).toBeUndefined();
});
