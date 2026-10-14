/**
 * 客户端**接缝层**：所有「猜出来的宿主调用形状」都收在这里（计划 Review Focus 5）。
 *
 * 与 T1 的 `shell.ts` 的分工：`shell.ts` 负责「把一个页面注册进插槽 / 注册文案」这类**注册原语**，
 * 本文件负责**远程面与订阅**——`ctx.remote.$mount`、`remote.<namespace>.<method>`、
 * `remote.settings.describe/mutate`、`remote.$on("credentials/reference-updated")`、
 * `layout.selectPanel`。1c 真机实测后只改这两层。
 *
 * 逐条证据（本机已装的插件产物）：
 * - 挂载 + 取命名空间：`@mars-sea/dsh-commandcode-provider/lib/client.js:8900-8939`
 *   （`ctx.remote.$mount({package, descriptors})` → 成功后 `ctx.inject(["remote.<ns>"], …)`
 *   → `remoteCtx.remote.<ns>`，并带 `cancelled` 竞态旗标与 `ctx.effect` 清理）；
 * - 凭据订阅：同文件 `8882-8894`（`remote.$on("credentials/reference-updated", …)` 返回退订函数）
 *   与 `439-440`（调用前先 `typeof context.remote.$on === "function"` 判定）；
 * - 设置面：同文件 `8864-8870`（`ctx.inject(["remote.settings"], settingsCtx => settingsCtx.remote.settings)`）。
 *
 * **全部未验证**：本机没有与桌面端同版本（0.2.0-rc.2）的引擎，这些形状来自已装插件的**旁证**。
 * @module dsh-llm-account/src/client/seams
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { dictionaryOf } from "./copy";
import { createPageState, dirtyFields, noteCredentialChange, selectTab, setField, type PageState, type VendorSnapshot } from "./page-state";
import { PageShell } from "./page";
import type { VendorEntry } from "./registry";
import {
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  usageDescriptors,
  type AccountView,
  type SwitchRecord,
  type UsageNamespace,
  type VendorUsageStatus,
} from "./usage-contract";

/** 一个「设置命名空间」在客户端看到的面（`remote.settings`）。 */
export interface RemoteSettings {
  describe(): Promise<{ ns?: string; id?: string; value?: unknown; revision?: number }[]>;
  mutate(ns: string, ops: readonly { op: "set"; path: readonly string[]; value: unknown }[], revision?: number): Promise<unknown>;
}

/** 宿主 `ctx.remote` 的最小形状（只认本包用到的成员）。 */
export interface RemoteService {
  settings?: RemoteSettings;
  $on?: (event: string, listener: (...args: unknown[]) => void) => () => void;
  $mount?: (contribution: { package: string; descriptors: readonly unknown[] }) => Promise<() => void>;
  /** 已经挂载好的命名空间对象（`remote["llm-account"]`）。 */
  [namespace: string]: unknown;
}

/** 客户端上下文里本模块用到的部分。 */
export interface ClientSeamContext {
  remote?: unknown;
  inject?(names: readonly string[], callback: (scoped: ClientSeamContext) => unknown): unknown;
  effect?(callback: () => (() => void) | void, label?: string): unknown;
  /** 中栏面板（仪表盘）的宿主入口，T9 使用。 */
  layout?: { selectPanel?(panel: string): unknown };
}

/** 取 `ctx.remote`；形状不认识时返回 `undefined`（调用方一律按「远程不可用」降级）。 */
export function remoteOf(ctx: ClientSeamContext): RemoteService | undefined {
  const remote = ctx.remote;
  if (typeof remote !== "object" || remote === null) return undefined;
  return remote as RemoteService;
}

/**
 * 读已注册厂商的设置快照（页面「发现厂商」的依据，Ruling 2）。
 *
 * 只保留注册表里声明过的命名空间：宿主上可能还有别的插件命名空间，页面不该把它们当厂商。
 * @param ctx - 客户端上下文。
 * @param entries - 注册表里的厂商声明。
 * @returns 快照；远程不可用或读取失败时返回空数组（页面显示「没有可显示的厂商」，而不是崩掉）。
 */
export async function describeVendorSnapshots(ctx: ClientSeamContext, entries: readonly VendorEntry[]): Promise<VendorSnapshot[]> {
  const settings = remoteOf(ctx)?.settings;
  if (settings === undefined || typeof settings.describe !== "function") return [];
  let rows: { ns?: string; id?: string; value?: unknown; revision?: number }[];
  try {
    rows = await settings.describe();
  } catch {
    return [];
  }
  // 宿主按 profile 行 id 建索引，旧宿主用命名空间，而 opencode 的**行 id 与核心命名空间不同**
  // （`opencode-go` vs `llm-opencode-go`）—— 所以按注册表声明的候选行名匹配，命中后一律用 `ns`
  // 作为页面身份（标签页与草稿都以 `ns` 为键）。
  const byRow = new Map<string, VendorEntry>();
  for (const entry of entries) {
    for (const rowId of entry.rowIds) byRow.set(rowId, entry);
    byRow.set(entry.ns, entry);
  }
  const snapshots: VendorSnapshot[] = [];
  for (const row of rows) {
    const rowName = [row.ns, row.id].find((candidate): candidate is string => typeof candidate === "string");
    const entry = rowName === undefined ? undefined : byRow.get(rowName);
    if (entry === undefined) continue;
    const value = typeof row.value === "object" && row.value !== null ? (row.value as Record<string, unknown>) : {};
    snapshots.push({ ns: entry.ns, value, revision: typeof row.revision === "number" ? row.revision : 0 });
  }
  return snapshots;
}

/**
 * 订阅凭据变更推送。
 *
 * 与旧插件同样的防御：`$on` 缺席时返回一个什么都不做的退订函数，而不是抛错 —— 凭据徽标不刷新
 * 是降级，整个页面挂掉不是。
 * @param ctx - 客户端上下文。
 * @param listener - 收到推送时调用（本包用它 +1 凭据计数）。
 * @returns 退订函数。
 */
export function subscribeCredentials(ctx: ClientSeamContext, listener: () => void): () => void {
  const remote = remoteOf(ctx);
  if (remote?.$on === undefined || typeof remote.$on !== "function") return () => undefined;
  const off = remote.$on("credentials/reference-updated", () => listener());
  return typeof off === "function" ? off : () => undefined;
}

/**
 * 打开中栏面板（仪表盘，T9）。
 * @param ctx - 客户端上下文。
 * @param panel - 面板标识。
 * @returns 是否真的打开了（宿主没有这个接缝时为 `false`，调用方可据此降级）。
 */
export function selectPanel(ctx: ClientSeamContext, panel: string): boolean {
  const select = ctx.layout?.selectPanel;
  if (typeof select !== "function") return false;
  select.call(ctx.layout, panel);
  return true;
}

/**
 * 读一个厂商的状态（生效账号、逐账号额度与拒绝）。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 状态；命名空间缺席时为 `undefined`。
 */
export async function readStatus(namespace: UsageNamespace | undefined, vendor: string): Promise<VendorUsageStatus | undefined> {
  if (namespace === undefined || typeof namespace.status !== "function") return undefined;
  return namespace.status(vendor);
}

/**
 * 读一个厂商的账号行。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 账号行；命名空间缺席时为 `undefined`。
 */
export async function readAccounts(namespace: UsageNamespace | undefined, vendor: string): Promise<AccountView[] | undefined> {
  if (namespace === undefined || typeof namespace.accounts !== "function") return undefined;
  return namespace.accounts(vendor);
}

/**
 * 读一个厂商的切换记录。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 记录；命名空间缺席时为 `undefined`。
 */
export async function readSwitches(namespace: UsageNamespace | undefined, vendor: string): Promise<SwitchRecord[] | undefined> {
  if (namespace === undefined || typeof namespace.switches !== "function") return undefined;
  return namespace.switches(vendor);
}

/** 挂载远程面后的观察窗口。 */
export interface UsageRemoteHandle {
  /** 当前可用的命名空间；`undefined` 表示还没挂上或已卸下。 */
  namespace(): UsageNamespace | undefined;
  /** 挂载失败的可读原因（供界面提示）。 */
  error(): string | undefined;
  /** 主动卸下（容器卸载时也会自动卸下）。 */
  dispose(): void;
}

/**
 * 挂载客户端侧的远程面，并在它出现后取到命名空间对象。
 *
 * 形状逐字对齐旧插件（`lib/client.js:8911-8939`）：`$mount` 是异步的，成功后**再**注入
 * `remote.<namespace>`；用 `cancelled` 旗标处理「还没挂上就卸载」的竞态；全部经 `ctx.effect`
 * 登记释放。
 * @param ctx - 客户端上下文。
 * @param onChange - 命名空间可用性变化时调用（成功与失败都会调用）。
 * @returns 观察窗口；宿主没有 `$mount` 时返回一个「不可用」的句柄。
 */
export function mountUsageRemote(ctx: ClientSeamContext, onChange?: (namespace: UsageNamespace | undefined, error?: string) => void): UsageRemoteHandle {
  const remote = remoteOf(ctx);
  let namespace: UsageNamespace | undefined;
  let failure: string | undefined;
  let cancelled = false;
  let unmount: (() => void) | undefined;

  const notify = (): void => onChange?.(namespace, failure);

  const start = (): void => {
    if (remote?.$mount === undefined || typeof remote.$mount !== "function") {
      failure = `the host remote service has no $mount(); the ${USAGE_NAMESPACE} remote cannot be used`;
      notify();
      return;
    }
    void remote
      .$mount({ package: USAGE_PACKAGE, descriptors: usageDescriptors() })
      .then(
        (dispose) => {
          if (cancelled) {
            dispose();
            return;
          }
          unmount = dispose;
          // 挂载成功后才注入命名空间：它是 Gateway 在这一步之后才提供的。
          const inject = ctx.inject;
          if (typeof inject !== "function") {
            failure = `this host context has no inject(); the ${USAGE_NAMESPACE} namespace cannot be read`;
            notify();
            return;
          }
          inject([`remote.${USAGE_NAMESPACE}`], (scoped: ClientSeamContext) => {
            namespace = remoteOf(scoped)?.[USAGE_NAMESPACE] as UsageNamespace | undefined;
            notify();
          });
        },
        (error: unknown) => {
          failure = error instanceof Error ? error.message : String(error);
          notify();
        },
      );
  };

  if (typeof ctx.effect === "function") {
    ctx.effect(
      () => {
        start();
        return () => {
          cancelled = true;
          namespace = undefined;
          unmount?.();
        };
      },
      "dsh-llm-account: usage remote",
    );
  } else {
    start();
  }

  return {
    namespace: () => namespace,
    error: () => failure,
    dispose: () => {
      cancelled = true;
      namespace = undefined;
      unmount?.();
    },
  };
}

/** 页面容器的参数。 */
export interface ConnectedPageOptions {
  entries: readonly VendorEntry[];
  ctx: ClientSeamContext;
  /** 取词函数；缺省按 `zh` 的本地字典（宿主 locale 绑定由 `shell.ts` 负责）。 */
  t?: (key: string) => string;
  /**
   * 该厂商的专属卡片（账户卡片、模型卡片……）。T5–T7 从这里注入。
   *
   * 容器负责把**当前可用的远程命名空间**交给它：挂载是异步的，所以卡片必须能接受
   * 「还没有命名空间」这个状态并自己降级，而不是在挂载完成前崩掉。
   * @param ns - 厂商的设置命名空间。
   * @param usage - 已挂载的远程命名空间；还没挂上时为 `undefined`。
   */
  renderVendorCards?: (ns: string, usage: UsageNamespace | undefined) => ReactNode;
}

/**
 * 造**容器组件**：持有页面状态、挂载远程面、订阅宿主推送、把回调接上，然后渲染 `PageShell`。
 *
 * 这是本层唯一使用 Hook 的地方，刻意做得极薄：所有判定都在 `page-state.ts`（纯函数、完整单测），
 * 这里只负责「状态放哪、什么时候重新读」。因此它**不参与单测**（测试用的 React 替身会把 Hook
 * 调用判为失败）—— 这是自觉的取舍，1c 的真机渲染是它的验证。
 * @param options - 见 {@link ConnectedPageOptions}。
 * @returns 一个 React 函数组件。
 */
export function createConnectedPage(options: ConnectedPageOptions): () => ReactElement {
  const { entries, ctx } = options;
  const t = options.t ?? dictionaryOf("zh");

  return function ConnectedPage(): ReactElement {
    const [state, setState] = useState<PageState>(() => createPageState(entries, []));
    const [usage, setUsage] = useState<UsageNamespace | undefined>(undefined);

    useEffect(() => {
      let alive = true;
      void describeVendorSnapshots(ctx, entries).then((snapshots) => {
        // 只有拿到快照才重建：宿主设置服务缺席时不要用一个空快照把页面清空。
        if (alive && snapshots.length > 0) setState((current) => createPageState(entries, snapshots, current));
      });
      const off = subscribeCredentials(ctx, () => setState((current) => noteCredentialChange(current)));
      // 远程面在挂载完成后才可用；挂载前卡片按「数据不可用」显示。
      const handle = mountUsageRemote(ctx, (namespace) => {
        if (alive) setUsage(namespace);
      });
      return () => {
        alive = false;
        off();
        handle.dispose();
      };
    }, []);

    return PageShell({
      state,
      entries,
      t,
      onSelectTab: (ns) => setState((current) => selectTab(current, ns)),
      onSetField: (ns, key, value) => setState((current) => setField(current, ns, key, value)),
      onSave: (ns) => {
        const fields = dirtyFields(state, ns);
        if (fields.length === 0) return;
        void saveSettings(ctx, ns, fields, state.snapshots[ns]?.revision ?? 0).then((saved) => {
          if (!saved) return; // 失败时草稿保留，用户可以重试。
          setState((current) => createPageState(entries, mergeSnapshot(current, ns, fields), current));
        });
      },
      ...(options.renderVendorCards === undefined
        ? {}
        : { renderVendorCards: (ns: string) => options.renderVendorCards?.(ns, usage) }),
    });
  };
}

/** 把刚保存的字段并进快照（乐观更新本地基线，避免再读一次宿主）。 */
function mergeSnapshot(state: PageState, ns: string, fields: readonly { key: string; value: unknown }[]): VendorSnapshot[] {
  const previous = state.snapshots[ns];
  const value: Record<string, unknown> = { ...(previous?.value ?? {}) };
  for (const field of fields) value[field.key] = field.value;
  const merged: VendorSnapshot = { ns, value, revision: (previous?.revision ?? 0) + 1 };
  return Object.values(state.snapshots)
    .filter((snapshot) => snapshot.ns !== ns)
    .concat(merged);
}

/**
 * 保存字段到设置文档。
 *
 * 写的是**宿主上的真实行名**（opencode 的行 id 与核心命名空间不同），并按修订号做并发围栏。
 * @param ctx - 客户端上下文。
 * @param ns - 设置命名空间。
 * @param fields - 要写的字段。
 * @param revision - 读取时拿到的修订号。
 * @returns 是否写入成功。
 */
export async function saveSettings(
  ctx: ClientSeamContext,
  ns: string,
  fields: readonly { key: string; value: unknown }[],
  revision: number,
): Promise<boolean> {
  const settings = remoteOf(ctx)?.settings;
  if (settings === undefined || typeof settings.mutate !== "function") return false;
  if (fields.length === 0) return true;
  const ops = fields.map((field) => ({ op: "set" as const, path: [field.key], value: field.value }));
  try {
    await settings.mutate(ns, ops, revision);
    return true;
  } catch {
    return false;
  }
}
