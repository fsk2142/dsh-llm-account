/**
 * Task 4 测试：客户端**接缝层**（`src/client/seams.ts`）。
 *
 * 这里测的是「猜出来的宿主形状」被调用时**我们这一侧**的行为：调用参数对不对、成功/失败分别
 * 怎么降级、卸载时有没有把东西收干净。宿主那一侧到底接不接受这些形状，本机无法验证（计划 1c）。
 */
import { expect, it, vi } from "vitest";

import {
  describeVendorSnapshots,
  dispatchAccountAction,
  mountUsageRemote,
  readAccounts,
  readStatus,
  readSwitches,
  saveSettings,
  selectPanel,
  subscribeCredentials,
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
  handle.dispose();
  resolveMount?.(lateDispose);
  await vi.waitFor(() => expect(lateDispose).toHaveBeenCalledTimes(1));
  expect(handle.namespace()).toBeUndefined();
});

it("远程读取：命名空间缺席或方法不全时返回 undefined（页面据此显示「不可用」）", async () => {
  await expect(readStatus(undefined, "commandcode")).resolves.toBeUndefined();
  await expect(readAccounts({} as never, "commandcode")).resolves.toBeUndefined();
  await expect(readSwitches(undefined, "commandcode")).resolves.toBeUndefined();
});

it("保存设置：按字段逐条 set，带上修订号；失败返回 false 且不谎报成功", async () => {
  const settings = fakeSettings();
  const { ctx } = fakeContext({ settings: settings.service });

  await expect(
    saveSettings(ctx, "llm-commandcode", [{ key: "apiBase", value: "https://b" }, { key: "protocol", value: "cli" }], 7),
  ).resolves.toBe(true);
  expect(settings.mutations).toEqual([
    {
      ns: "llm-commandcode",
      revision: 7,
      ops: [
        { op: "set", path: ["apiBase"], value: "https://b" },
        { op: "set", path: ["protocol"], value: "cli" },
      ],
    },
  ]);

  settings.fail = new Error("revision conflict");
  await expect(saveSettings(ctx, "llm-commandcode", [{ key: "apiBase", value: "https://c" }], 8)).resolves.toBe(false);
  // 没有字段要写：不算失败，也不发一次空写入。
  await expect(saveSettings(ctx, "llm-commandcode", [], 8)).resolves.toBe(true);

  const noSettings = fakeContext({});
  await expect(saveSettings(noSettings.ctx, "llm-commandcode", [{ key: "apiBase", value: "x" }], 1)).resolves.toBe(false);
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
