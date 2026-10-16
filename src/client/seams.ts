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
import { createElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { dictionaryOf } from "./copy";
import { Dashboard } from "./dashboard";
import { SidebarCard } from "./sidebar-card";
import {
  applyModelEdit,
  closeAction,
  createPageState,
  dirtyFields,
  modelEditTarget,
  normalizeModels,
  noteCredentialChange,
  noteSaveResult,
  openAction,
  selectTab,
  setActionField,
  setField,
  sidebarVendorOf,
  toggleExpanded,
  vendorCardKinds,
  type AccountAction,
  type ModelEdit,
  type PageState,
  type VendorSnapshot,
} from "./page-state";
import type { LoginView } from "./account-card";
import type { ModelsWriteMode } from "./models-card";
import { PageShell } from "./page";
import type { VendorEntry } from "./registry";
import { USAGE_NAMESPACE, USAGE_PACKAGE, usageDescriptors, type AccountView, type SwitchRecord, type UsageNamespace, type VendorUsageStatus } from "./usage-contract";

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
  /** cordis 的服务读取（旧插件用 `ctx.get("layout")` 拿面板服务）。 */
  get?(name: string): unknown;
  /** 插槽服务（`sidebar.footer.action` 等插槽由它注册）。 */
  slots?: unknown;
  /** 中栏面板（仪表盘）的宿主入口，T9 使用。 */
  layout?: { selectPanel?(panel: string | null): unknown };
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
  // 作为页面身份（标签页与草稿都以 `ns` 为键），同时把**命中的行名**带进快照：写路径必须用
  // 行名（宿主设置服务按条目 id 寻址），用 `ns` 会让 opencode 的保存落在一个不存在的条目上。
  const byRow = new Map<string, VendorEntry>();
  for (const entry of entries) {
    for (const rowId of entry.rowIds) byRow.set(rowId, entry);
    byRow.set(entry.ns, entry);
  }
  const snapshots: VendorSnapshot[] = [];
  for (const row of rows) {
    const rowName = [row.ns, row.id].find((candidate): candidate is string => typeof candidate === "string");
    if (rowName === undefined) continue;
    const entry = byRow.get(rowName);
    if (entry === undefined) continue;
    const value = typeof row.value === "object" && row.value !== null ? (row.value as Record<string, unknown>) : {};
    snapshots.push({ ns: entry.ns, row: rowName, value, revision: typeof row.revision === "number" ? row.revision : 0 });
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
 *
 * 两种形状都认：旧插件用的是 `ctx.get("layout")?.selectPanel(id)`
 * （`@mars-sea/dsh-commandcode-provider/lib/client.js:9122`），而 1a 的假设文档里写的是
 * `ctx.layout.selectPanel`。先试服务读取，再回落到属性访问。
 * @param ctx - 客户端上下文。
 * @param panel - 面板标识；`null` 表示关闭面板。
 * @returns 是否真的打开了（宿主没有这个接缝时为 `false`，调用方可据此降级）。
 */
export function selectPanel(ctx: ClientSeamContext, panel: string | null): boolean {
  const fromService = typeof ctx.get === "function" ? ctx.get("layout") : undefined;
  const layout = (fromService ?? ctx.layout) as { selectPanel?: (value: string | null) => unknown } | undefined;
  if (layout === undefined || typeof layout.selectPanel !== "function") return false;
  layout.selectPanel(panel);
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
  /** 是否已卸下（所在作用域清理或主动 `dispose` 之后为 `true`；共享面据此重挂）。 */
  disposed(): boolean;
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
  let gone = false;
  let unmount: (() => void) | undefined;

  const notify = (): void => onChange?.(namespace, failure);

  const release = (): void => {
    cancelled = true;
    namespace = undefined;
    unmount?.();
  };

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
          gone = true;
          release();
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
    disposed: () => gone,
    dispose: () => {
      gone = true;
      release();
    },
  };
}

/**
 * 把一次账户操作草稿翻译成一次远程调用。
 *
 * 为什么单独成函数：**哪个操作调哪个方法**、以及「空名称/空密钥不提交」这类判定都属于
 * 会出错的地方，而容器组件（唯一的 Hook 宿主）不参与单测（Ruling 22）。放在这里就能被测到。
 *
 * 名称与密钥都在**边界上 trim**：用户粘贴的密钥常带换行/尾随空格，名称常带无意空格，
 * 原样提交会把它们写进宿主（标签页显示、凭据槽内容）。
 * @param usage - 已挂载的远程命名空间；还没挂上时为 `undefined`。
 * @param vendor - 厂商 id。
 * @param action - `page-state.ts` 里的操作草稿。
 * @returns 远程调用；不可用或输入不合法时为 `undefined`（调用方据此不关草稿）。
 */
export function dispatchAccountAction(
  usage: UsageNamespace | undefined,
  vendor: string,
  action: AccountAction,
): Promise<unknown> | undefined {
  if (usage === undefined) return undefined;
  switch (action.kind) {
    case "add": {
      // 空名称不提交（宿主会拒绝，但我们先不发这次调用）。
      const label = action.label.trim();
      if (label === "") return undefined;
      const key = action.key.trim();
      // 空密钥只建条目：`key` 字段整个不传，而不是传空串（那会被当成「要写空密钥」）。
      return usage.addAccount(vendor, key === "" ? { label } : { label, key });
    }
    case "rename": {
      if (action.ref === undefined) return undefined;
      const label = action.label.trim();
      if (label === "") return undefined;
      return usage.renameAccount(vendor, action.ref, label);
    }
    case "key": {
      // 空密钥不提交：那等于把账号的密钥清掉，用户不会想用这个方式做。
      if (action.ref === undefined) return undefined;
      const key = action.key.trim();
      if (key === "") return undefined;
      return usage.replaceKey(vendor, action.ref, key);
    }
  }
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
   * 容器把「当前可用的远程命名空间 + 页面状态里与卡片有关的那些字段 + 一组回调」交给它：
   * 卡片自己是纯函数（Ruling 22），所以状态与回调必须由容器递进来。
   */
  renderVendorCards?: (context: VendorCardsContext) => ReactNode;
}

/** 交给专属卡片的一切：数据 + 状态切片 + 回调。 */
export interface VendorCardsContext {
  /** 厂商的设置命名空间。 */
  ns: string;
  /** 该厂商的远程 id（`commandcode` / `dsh-opencode-go`）。 */
  vendor: string;
  /** 已挂载的远程命名空间；还没挂上时为 `undefined`（卡片必须自己降级）。 */
  usage: UsageNamespace | undefined;
  /** 该厂商最新的状态（生效账号、账号行、额度摘要）；还没读到时为 `undefined`。 */
  status: VendorUsageStatus | undefined;
  /** 该厂商设置文档的当前值（`autoSwitch` 等设置类控件的当前值来源）。 */
  settings: Record<string, unknown>;
  t: (key: string) => string;
  /** 正在进行的账户操作草稿。 */
  action: AccountAction | undefined;
  /** 展开完整报告的账号。 */
  expandedRef: string | undefined;
  /** 该厂商的登录状态（没有登录入口的厂商为 `undefined`）。 */
  login: LoginView | undefined;
  openAction: (action: { kind: AccountAction["kind"]; ref?: string }) => void;
  setActionField: (field: "label" | "key", value: string) => void;
  confirmAction: () => void;
  cancelAction: () => void;
  toggleExpand: (ref: string) => void;
  select: (ref: string | null) => void;
  remove: (ref: string) => void;
  /** 调整账号顺序（`toIndex` 是移动后的**最终下标**）。 */
  move: (ref: string, toIndex: number) => void;
  /** 写自动切换开关（立即生效）。 */
  setAutoSwitch: (value: boolean) => void;
  /** 这家要渲染哪些专属卡片（顺序即规格 §8 的卡片顺序）；规则在 `vendorCardKinds` 里。 */
  cardKinds: readonly ("accounts" | "models")[];
  /** 要展示的模型 id（白名单 ∪ 显隐表里有记录的，已清洗）。 */
  models: string[];
  /** 逐模型显隐（缺省视为可见）。 */
  modelVisibility: Record<string, boolean>;
  /** 「添加模型」输入框的当前草稿。 */
  modelDraft: string;
  /** 该厂商模型改动的生效时机。 */
  modelMode: ModelsWriteMode;
  setModelDraft: (value: string) => void;
  /** 做一次模型编辑（按生效时机分派到草稿或立刻写）。 */
  editModel: (edit: ModelEdit) => void;
  loginBegin: () => void;
}

/** 登录轮询间隔（毫秒）。等待授权时的轮询是**唯一的**后台请求来源，且随状态起停。 */
export const LOGIN_POLL_MS = 1_000;

/**
 * 是否继续轮询登录状态：只有 `waiting` 才需要（其余状态是终态或还没开始）。
 *
 * 单独成函数是为了能被单测：容器里的定时器本身不参与单测（Ruling 22），但「什么时候该继续
 * 问」是会出错的地方，而且它关系到「不做无谓的后台请求」这条要求。
 * @param login - 当前登录状态。
 * @returns 是否继续轮询。
 */
export function shouldPollLogin(login: LoginView | undefined): boolean {
  return login?.state === "waiting";
}

/** 造**容器组件**：持有页面状态、订阅宿主推送与共享远程面、把回调接上，然后渲染 `PageShell`。
 *
 * 这是本层唯一使用 Hook 的地方，刻意做得极薄：所有判定都在 `page-state.ts` / `dispatchAccountAction`
 * / `shouldPollLogin` 里（纯函数、完整单测），这里只负责「状态放哪、什么时候重新读」。
 * 因此它**不参与单测**（测试用的 React 替身会把 Hook 调用判为失败）—— 自觉的取舍，1c 的真机
 * 渲染是它的验证。
 *
 * 远程面是**插件级共享**的（`ensureUsageRemote`）：本容器只订阅它的可用性，不持有它的生命周期 ——
 * 设置页关掉不该把侧边栏卡片与中栏面板的数据源一起带走（旧插件把 usage remote 挂在 apply 期，
 * 本机产物可读）。
 * @param options - 见 {@link ConnectedPageOptions}。
 * @returns 一个 React 函数组件。
 */
export function createConnectedPage(options: ConnectedPageOptions): () => ReactElement {
  const { entries, ctx } = options;
  const t = options.t ?? dictionaryOf("zh");

  return function ConnectedPage(): ReactElement {
    const [state, setState] = useState<PageState>(() => createPageState(entries, []));
    const [usage, setUsage] = useState<UsageNamespace | undefined>(undefined);
    const [logins, setLogins] = useState<Record<string, LoginView | undefined>>({});
    const [statuses, setStatuses] = useState<Record<string, VendorUsageStatus | undefined>>({});
    /** 「添加模型」的输入草稿（按厂商分开）。 */
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
    /** 账户操作计数：每次成功的操作 +1，用来触发一次状态重读。 */
    const [accountRevision, setAccountRevision] = useState(0);

    /** 采纳一次快照读取：页面状态与侧边栏开关存储（同一来源、两个消费者）。 */
    const adopt = (snapshots: VendorSnapshot[]): void => {
      // 只有拿到快照才重建：宿主设置服务缺席时不要用一个空快照把页面清空，也不要把开关存储抹掉。
      if (snapshots.length === 0) return;
      noteSidebarSnapshots(entries, snapshots);
      setState((current) => createPageState(entries, snapshots, current));
    };

    useEffect(() => {
      let alive = true;
      const guarded = (snapshots: VendorSnapshot[]): void => {
        if (alive) adopt(snapshots);
      };
      void describeVendorSnapshots(ctx, entries).then(guarded);
      const off = subscribeCredentials(ctx, () => setState((current) => noteCredentialChange(current)));
      // 远程面在挂载完成后才可用；挂载前卡片按「数据不可用」显示。
      // 只订阅、不 dispose：它的生命周期属于插件，不属于这个页面。
      const offUsage = onUsageReady(ctx, (namespace) => {
        if (alive) setUsage(namespace);
      });
      return () => {
        alive = false;
        off();
        offUsage();
      };
    }, []);

    // 读状态与设置快照：远程面挂上时、凭据变更时、账户操作成功后各读一次。
    // **不做常驻轮询**：规格 §8.1 第 6 条要的是「关闭即静默」，只有登录等待期才需要定时问（见下）。
    useEffect(() => {
      let alive = true;
      // 账户操作（排序、autoSwitch、增删改）会改设置文档，所以每次都把快照重读一遍；
      // 用户的未保存草稿由 `createPageState(…, previous)` 保留。
      void describeVendorSnapshots(ctx, entries).then((snapshots) => {
        if (alive) adopt(snapshots);
      });
      if (usage !== undefined) {
        for (const entry of entries) {
          void readStatus(usage, entry.providerId).then((status) => {
            if (alive && status !== undefined) setStatuses((current) => ({ ...current, [entry.providerId]: status }));
          });
        }
      }
      return () => {
        alive = false;
      };
    }, [usage, state.credentialRevision, accountRevision]);

    // 登录轮询：只在等待授权时跑（规格 §8.1 第 6 条的「关闭即静默」精神 —— 没有等待就不问）。
    const waitingVendors = entries.map((entry) => entry.providerId).filter((vendor) => shouldPollLogin(logins[vendor]));
    useEffect(() => {
      if (usage === undefined || waitingVendors.length === 0) return;
      const timer = setInterval(() => {
        for (const vendor of waitingVendors) {
          void usage.loginStatus(vendor).then((status) => setLogins((current) => ({ ...current, [vendor]: status })));
        }
      }, LOGIN_POLL_MS);
      return () => clearInterval(timer);
    }, [usage, waitingVendors.join(",")]);

    // 侧边栏卡片与中栏面板的注册在 apply 期一次完成（`registerSharedSurfaces`，常驻），
    // 门控在卡片组件里按**已存储**的开关做（`createSidebarCardView`）—— 这里不再碰插槽。

    const activeEntry = entries.find((entry) => entry.ns === state.activeNs);
    const activeVendor = activeEntry?.providerId;

    return PageShell({
      state,
      entries,
      t,
      onSelectTab: (ns) => setState((current) => selectTab(current, ns)),
      onSetField: (ns, key, value) => setState((current) => setField(current, ns, key, value)),
      onSave: (ns) => {
        const fields = dirtyFields(state, ns);
        if (fields.length === 0) return;
        // 写**命中的行名**（opencode 的行 id 与命名空间不同，用 ns 会写到一个不存在的条目上）。
        const snapshot = state.snapshots[ns];
        void saveSettings(ctx, snapshot?.row ?? ns, fields, snapshot?.revision ?? 0).then((error) => {
          // 成败都记下来：失败时保存条显示可读原因（此前完全静默 —— 用户以为保存成功了）；
          // 成功即清除。随后一律重读一遍宿主：基线以宿主为准，不猜修订号（紧接着的第二次
          // 保存不会带着猜出来的围栏再次失败），已落盘的草稿条目随之清掉。
          setState((current) => noteSaveResult(current, ns, error));
          void describeVendorSnapshots(ctx, entries).then((snapshots) => adopt(snapshots));
        });
      },
      ...(options.renderVendorCards === undefined || activeEntry === undefined || activeVendor === undefined
        ? {}
        : {
            renderVendorCards: (ns: string) =>
              options.renderVendorCards?.({
                ns,
                vendor: activeVendor,
                usage,
                status: statuses[activeVendor],
                settings: state.snapshots[activeEntry.ns]?.value ?? {},
                t,
                action: state.action,
                expandedRef: state.expandedRef,
                login: logins[activeVendor],
                openAction: (action) => setState((current) => openAction(current, action)),
                setActionField: (field, value) => setState((current) => setActionField(current, field, value)),
                confirmAction: () => {
                  // 派发判定在 `dispatchAccountAction` 里（可单测）；这里只负责「成了就关草稿并重读」。
                  const pending = state.action === undefined ? undefined : dispatchAccountAction(usage, activeVendor, state.action);
                  if (pending === undefined) return;
                  void pending.then(() => {
                    setState((current) => closeAction(current));
                    setAccountRevision((current) => current + 1);
                  });
                },
                cancelAction: () => setState((current) => closeAction(current)),
                toggleExpand: (ref) => setState((current) => toggleExpanded(current, ref)),
                select: (ref) => {
                  void usage?.selectAccount(activeVendor, ref).then(() => setAccountRevision((current) => current + 1));
                },
                remove: (ref) => {
                  void usage?.removeAccount(activeVendor, ref).then(() => setAccountRevision((current) => current + 1));
                },
                move: (ref, toIndex) => {
                  void usage?.moveAccount(activeVendor, ref, toIndex).then(() => setAccountRevision((current) => current + 1));
                },
                setAutoSwitch: (value) => {
                  void usage?.setAutoSwitch(activeVendor, value).then(() => setAccountRevision((current) => current + 1));
                },
                ...modelCardContext({
                  entry: activeEntry,
                  state,
                  mode: statuses[activeVendor]?.capabilities.modelVisibilityWrite ?? "onSave",
                  draft: modelDrafts[activeEntry.ns] ?? "",
                  setDraft: (value) => setModelDrafts((current) => ({ ...current, [activeEntry.ns]: value })),
                  draftInto: (ns, fields) => setState((current) => fields.reduce((acc, field) => setField(acc, ns, field.key, field.value), current)),
                  writeNow: (ns, fields) => {
                    // 立刻写（`immediate` 能力）：同样写行名；失败不静默 —— 记进保存错误，
                    // 下一次快照重读会让控件回落到已存储的值（用户看得出这次没写进去）。
                    const target = state.snapshots[ns];
                    void saveSettings(ctx, target?.row ?? ns, fields, target?.revision ?? 0).then((error) => {
                      setState((current) => noteSaveResult(current, ns, error));
          void describeVendorSnapshots(ctx, entries).then((snapshots) => adopt(snapshots));
                      if (error === undefined) setAccountRevision((current) => current + 1);
                    });
                  },
                }),
                loginBegin: () => {
                  void usage?.loginBegin(activeVendor).then((status) => {
                    setLogins((current) => ({ ...current, [activeVendor]: status }));
                  });
                },
              }),
          }),
    });
  };
}

/**
 * 模型卡片要的数据与回调。
 *
 * 把「两次 `setField` → 草稿」与「`saveSettings` → 立刻写」这两条路线的选择放在这里，是因为
 * 容器本身不参与单测（Ruling 22）；分流判定 `modelEditTarget` 与补丁计算 `applyModelEdit`
 * 都是纯函数、各自有测试。这里只负责接线。
 * @param input - 当前厂商、页面状态、生效时机与两个写入方式。
 * @returns 模型卡片那部分上下文。
 */
function modelCardContext(input: {
  entry: VendorEntry;
  state: PageState;
  mode: ModelsWriteMode;
  draft: string;
  setDraft: (value: string) => void;
  draftInto: (ns: string, fields: readonly { key: string; value: unknown }[]) => void;
  writeNow: (ns: string, fields: readonly { key: string; value: unknown }[]) => void;
}): Pick<
  VendorCardsContext,
  "cardKinds" | "models" | "modelVisibility" | "modelDraft" | "modelMode" | "setModelDraft" | "editModel"
> {
  const { entry, state, mode } = input;
  const spec = entry.models;
  const settings = state.snapshots[entry.ns]?.value ?? {};
  const visible = spec === undefined ? [] : normalizeModels(settings[spec.visible]);
  const rawVisibility = spec === undefined ? undefined : settings[spec.visibility];
  const modelVisibility =
    typeof rawVisibility === "object" && rawVisibility !== null && !Array.isArray(rawVisibility)
      ? { ...(rawVisibility as Record<string, boolean>) }
      : {};
  // 列表 = 白名单 ∪ 显隐表里出现过的模型（后者让「显式隐藏了一个不在白名单里的模型」也看得见，
  // 否则用户没有任何入口把它改回来）。
  const models = [...new Set([...visible, ...Object.keys(modelVisibility)])];

  return {
    cardKinds: vendorCardKinds(entry),
    models,
    modelVisibility,
    modelDraft: input.draft,
    modelMode: mode,
    setModelDraft: input.setDraft,
    editModel: (edit: ModelEdit) => {
      if (spec === undefined) return;
      const patch = applyModelEdit({ visible: settings[spec.visible], visibility: settings[spec.visibility] }, edit);
      const fields = [
        { key: spec.visible, value: patch.visibleModels },
        { key: spec.visibility, value: patch.modelVisibility },
      ];
      // 生效时机由能力声明决定：`onSave` 进草稿（底部保存条提交），`immediate` 立刻写。
      if (modelEditTarget(mode) === "now") input.writeNow(entry.ns, fields);
      else input.draftInto(entry.ns, fields);
      // 添加完成后清空输入框（草稿已经落到设置里）。
      if (edit.kind === "add") input.setDraft("");
    },
  };
}

/** 侧边栏底部卡片的插槽名（旧插件 `lib/client.js:9141` 用的就是它）。 */
export const SIDEBAR_SLOT = "sidebar.footer.action";

/** 侧边栏卡片的注册参数。 */
export interface SidebarCardRegistration {
  /** 该厂商 id（插槽里的稳定身份）。 */
  id: string;
  /** 同一插槽内的排序。 */
  order: number;
  /** 文案命名空间。 */
  locale: string;
  /** 要注册的组件。 */
  component: unknown;
  /** `inject` 工厂（旧插件的形状是返回 `{ hooks, ...回调 }`）。 */
  face?: () => Record<string, unknown>;
}

/**
 * 把侧边栏卡片注册进 `sidebar.footer.action`。
 *
 * 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:9139-9151`）：
 * `ctx.inject(["layout"], layoutCtx => layoutCtx.slots.inject(SLOT, () => layoutCtx.slots.register({…}, C)))`，
 * 并且**用 try/catch 包住** —— 旧插件在那里打印一行错误就继续（注册失败不该把整个客户端带走）。
 * @param ctx - 客户端上下文。
 * @param registration - 注册参数。
 * @returns 注销函数；没注册成功时是空操作。
 */
export function registerSidebarCard(ctx: ClientSeamContext, registration: SidebarCardRegistration): () => void {
  const inject = ctx.inject;
  if (typeof inject !== "function") return () => undefined;
  let dispose: (() => void) | undefined;
  inject(["layout"], (layoutCtx: ClientSeamContext) => {
    try {
      const slots = slotsOf(layoutCtx);
      if (slots === undefined) return;
      slots.inject(SIDEBAR_SLOT, () =>
        slots.register(
          {
            name: SIDEBAR_SLOT,
            id: registration.id,
            order: registration.order,
            locale: registration.locale,
            inject: registration.face ?? (() => ({ hooks: {} })),
          },
          registration.component,
        ),
      );
      // 插槽服务不返回注销句柄，所以退订走 `ctx.effect` 的语义：由调用方在 effect 里登记本函数。
      dispose = () => undefined;
    } catch (error) {
      // 与旧插件同一处置：留一行错误，不让整个客户端因为一次注册失败而失效。
      console.error("[dsh-llm-account] could not register the sidebar footer card:", error);
    }
  });
  return () => dispose?.();
}

/** 读一个上下文上的插槽服务。 */
function slotsOf(ctx: ClientSeamContext): { inject(name: string, callback: () => unknown): unknown; register(entry: object, component: unknown): unknown } | undefined {
  const slots = (ctx as unknown as { slots?: unknown }).slots;
  if (typeof slots !== "object" || slots === null) return undefined;
  const candidate = slots as { inject?: unknown; register?: unknown };
  if (typeof candidate.inject !== "function" || typeof candidate.register !== "function") return undefined;
  return candidate as { inject(name: string, callback: () => unknown): unknown; register(entry: object, component: unknown): unknown };
}

/**
 * 侧边栏卡片的生命周期控制器（**不依赖 React**，因此可完整单测）。
 *
 * 它存在的理由正是本任务的两条硬要求：
 * 1. **默认关闭、关闭时零后台查询**：没开启就不注册、不读额度、不起定时器；
 * 2. **轮询与卡片挂载绑定**：开启时注册并起轮询、关闭或卸载即停（`dispose`）。
 *
 * 关掉开关必须把**已注册的卡片撤下来**（否则侧边栏还挂着一个不再更新的卡片）。
 */
export interface SidebarCardController {
  /** 按当前开关同步注册与轮询；返回同步后是否处于注册状态。 */
  sync(enabled: boolean): boolean;
  /** 当前是否已注册。 */
  registered(): boolean;
  /** 当前是否有轮询在跑。 */
  polling(): boolean;
  /**
   * 手动刷新一次（`visibilitychange` 恢复时调用）。
   * **关闭状态下什么都不做** —— 这正是「关闭时不后台刷新」在可见性恢复这条路径上的落点。
   */
  refreshIfEnabled(): void;
  /** 卸载：停轮询 + 撤注册。 */
  dispose(): void;
}

/** 侧边栏卡片的轮询间隔（毫秒）。与旧插件一样按需起停，不做常驻。 */
export const SIDEBAR_POLL_MS = 60_000;

/** 失败退避的上限（毫秒）：连续失败时最多慢到 5 分钟一问，再慢用户就该以为是坏了。 */
export const SIDEBAR_POLL_MAX_MS = 300_000;

/**
 * 失败退避间隔：连续失败 `failures` 次之后的下一次轮询间隔。
 *
 * 两个参考插件在读取失败时都仍按固定 60s 全速重问（参考实现的胶囊 `setInterval(refresh, 60_000)`
 * 里没有任何退避），于是一次上游故障会让每个可见标签页每分钟空打一次。这里按连续失败
 * 次数翻倍，到 {@link SIDEBAR_POLL_MAX_MS} 封顶；任何一次成功读数把计数清零、恢复常速。
 *
 * 纯函数（不藏时钟、不藏随机）：容器每次排下一拍时间时问它一次。
 * @param base - 常规间隔（毫秒）。
 * @param failures - 连续失败次数（`<= 0` 按常规间隔）。
 * @returns 下一次轮询的间隔（毫秒）。
 */
export function backoffInterval(base: number, failures: number): number {
  if (failures <= 0) return base;
  const doubled = base * 2 ** Math.min(failures, 10);
  return Math.min(doubled, SIDEBAR_POLL_MAX_MS);
}

/** 侧边栏用量轮询的基础间隔（毫秒），由设置字段 `quotaRefreshMinutes`（分钟）换算而来。
 *
 * 缺省/非法值回落到 {@link SIDEBAR_POLL_MS}（1 分钟），与旧插件一致；同时把值夹在
 * `[1, 120]` 分钟之间（再长用量基本就是过期的）。纯函数、不藏时钟，便于单测。
 * @param value - 设置文档里的 `quotaRefreshMinutes`（不可信，按 `unknown` 处理）。
 * @returns 轮询间隔（毫秒）。
 */
export function quotaRefreshMs(value: unknown): number {
  const minutes = typeof value === "number" && Number.isFinite(value) ? value : SIDEBAR_POLL_MS / 60_000;
  const clamped = Math.max(1, Math.min(120, minutes));
  return clamped * 60_000;
}

/**
 * 造侧边栏卡片控制器。
 * @param deps - 注册/注销、一次读取与轮询间隔。
 * @returns 控制器。
 */
export function createSidebarCardController(deps: {
  register: () => () => void;
  load: () => void;
  intervalMs?: number;
  /**
   * 动态轮询间隔（失败退避用）：每一拍重排时问一次，缺省用固定 `intervalMs`。
   *
   * 用「读完一拍再排下一拍」的 `setTimeout` 链而不是 `setInterval`：间隔要能跟着
   * 读取结果变化（失败后退避、成功后恢复），`setInterval` 建好就改不了。
   */
  pollInterval?: () => number;
}): SidebarCardController {
  const intervalMs = deps.intervalMs ?? SIDEBAR_POLL_MS;
  let unregister: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopPolling = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  /** 排下一拍（动态间隔下每拍重问，固定间隔下等价于常驻间隔）。 */
  const schedule = (): void => {
    stopPolling();
    const next = deps.pollInterval === undefined ? intervalMs : deps.pollInterval();
    timer = setTimeout(() => {
      timer = undefined;
      deps.load();
      schedule();
    }, next);
  };

  return {
    sync(enabled: boolean): boolean {
      if (!enabled) {
        stopPolling();
        unregister?.();
        unregister = undefined;
        return false;
      }
      if (unregister === undefined) {
        unregister = deps.register();
        // 开启的那一刻先读一次：否则要等一个轮询周期才有数字。
        deps.load();
        schedule();
      }
      return true;
    },
    registered: () => unregister !== undefined,
    polling: () => timer !== undefined,
    refreshIfEnabled(): void {
      if (unregister === undefined) return;
      deps.load();
    },
    dispose(): void {
      stopPolling();
      unregister?.();
      unregister = undefined;
    },
  };
}

/** 中栏仪表盘的面板 id（`layout.selectPanel` 用它打开/关闭）。 */
export const DASHBOARD_PANEL_ID = "llm-account-dashboard";

/** 侧边栏卡片在插槽里的注册参数。 */
export const SIDEBAR_CARD_ID = "llm-account-quota";

/**
 * 造**侧边栏卡片的容器组件**：厂商从模块级开关存储里取，渲染与轮询都按它门控。
 *
 * **为什么门控在组件里而不是注册时**（旧插件 `CommandCodeFooterEntry` 的同一条判定，本机
 * 已装产物可读）：插槽注册是**常驻**的（`apply` 期一次，注释原话 "The entry stays
 * REGISTERED — this is a render decision, so nothing churns the slot ledger"），组件按
 * **已存储**的开关决定 `if (!visible) return null`，并让自动刷新随 `visible` 起停。
 * 反过来做（注册按开关条件化）看起来更干净，但插槽服务**不返回注销句柄** —— 关掉开关时
 * 撤不下已注册的条目，卡片会带着定时器继续每 60s 请求，直接违背规格 §8.1 第 6 条。
 *
 * 存储的写者：插件级设置镜像（`settings/document-updated` 事件 + 首读）与设置页容器
 * （每次快照重读后）——两者算的是同一个 `sidebarVendorOf`，幂等。
 *
 * 关闭状态（存储里没有厂商）：渲染 `null`、不轮询、不注册 `visibilitychange` ——
 * 「关闭即静默」在**每一条路径**上成立（开启→关闭、卸载、从未开启）。
 * @param options - 上下文、厂商声明、取词函数与「打开仪表盘」的动作。
 * @returns 一个 React 函数组件。
 */
export function createSidebarCardView(options: {
  ctx: ClientSeamContext;
  entries: readonly VendorEntry[];
  t: (key: string) => string;
  onOpen: () => void;
  intervalMs?: number;
}): () => ReactElement {
  const { ctx, entries, t } = options;
  return function ConnectedSidebarCard(): ReactElement {
    const [vendor, setVendor] = useState<string | undefined>(() => sidebarVendor());
    // 一份合并的视图状态：要显示的状态 + 最近一次读的失败 + 是否在显示旧数据。
    // 合成一个 state（而不是三个）是为了让「失败时保留上一份好数据」在一次 setState 里
    // 原子完成 —— 三个各自 set 的中间态会闪一下「有数据但没标过期」。
    const [view, setView] = useState<{ status?: VendorUsageStatus; failure?: string; stale: boolean }>({ stale: false });
    // 渲染期间不重读的两个可变值（引用：不触发渲染，只在读取/排程时被读）。
    const inFlight = useRef(false);
    const failures = useRef(0);

    /**
     * 读一次状态。`manual` 为真时（用户点「刷新」）无视页面可见性 —— 手动要的就是立刻问；
     * 其余读取在页面不可见时**跳过**（参考实现 UsagePill 的同一条：
     * `!manual && document.visibilityState === 'hidden' → return`）：后台标签页继续每分钟
     * 打用量请求是白烧用户的流量与上游配额，浏览器节流也只是让它慢一点，不会停。
     *
     * 单飞（`inFlight`）：慢网络下不叠请求（参考实现的 busy 守卫同一条）。
     *
     * 失败时**保留上一次完整读数**并标「上次数据」：把一次瞬时故障显示成「还没有请求经过
     * 这个账号」是谎报（与空态文案同一族的问题）；部分失败（账号读到了、额度没读到）
     * 同样按失败处理 —— 额度那一半的数据不可信。
     */
    const read = (manual: boolean): void => {
      if (!manual && domDocument()?.visibilityState === "hidden") return;
      if (inFlight.current) return;
      const usage = usageNamespace(ctx);
      if (usage === undefined) return;
      inFlight.current = true;
      void readStatus(usage, vendor ?? "").then((next) => {
        inFlight.current = false;
        if (next === undefined) return;
        if (next.failures.length > 0) {
          failures.current += 1;
          const failure = next.failures[0] ?? t("usage.failed");
          setView((current) => ({ status: current.status, failure, stale: current.status !== undefined }));
          return;
        }
        failures.current = 0;
        setView({ status: next, stale: false });
      });
    };

    // 订阅开关存储：设置页里保存（或外部改动设置文档）时，这里随之开关。
    useEffect(() => subscribeSidebarVendor(setVendor), []);

    // 冷启动兜底：设置页从未打开过时存储是冷的，卡片自己读一次已存储的开关
    // （一次设置读取，不是用量查询；读不到就保持关闭，绝不轮询）。
    useEffect(() => {
      if (sidebarVendorSeeded()) return;
      let alive = true;
      void describeVendorSnapshots(ctx, entries).then((snapshots) => {
        if (alive) noteSidebarSnapshots(entries, snapshots);
      });
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      // 关闭：停轮询、撤监听、清数据（旧插件同一分支：`if (!visible) return null`）。
      if (vendor === undefined) {
        setView({ stale: false });
        return;
      }
      const controller = createSidebarCardController({
        register: () => () => undefined,
        load: () => read(false),
        ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
        // 基础间隔由用户设置的 `quotaRefreshMinutes`（分钟）决定（见 `quotaRefreshMinutes` 字段）；
        // 失败退避：连续失败翻倍、封顶 5 分钟；成功后由 `failures` 归零恢复常速。
        // 每次重排都现读设置值，所以用户在设置页改了间隔会在下一个轮询周期即时生效。
        pollInterval: () => backoffInterval(quotaRefreshMs(sidebarVendorSettings()?.["quotaRefreshMinutes"]), failures.current),
      });
      controller.sync(true);
      // 远程面挂载完成前那次读取会落空，挂上时要补读一次 —— 但**只在第一次真的落空过**时补：
      // 远程面已经挂上（插件级单例，两个行共享，`apply` 期就引导了）的话，`sync(true)` 里那次
      // 读取已经成功，`onUsageReady` 的立即回调再补一次就是白白多打一请求。
      let readBeforeMount = usageNamespace(ctx) === undefined;
      const offReady = onUsageReady(ctx, (namespace) => {
        if (namespace === undefined || !readBeforeMount) return;
        readBeforeMount = false;
        controller.refreshIfEnabled();
      });
      const onVisible = (): void => {
        // 只有真的可见时才刷新（`document` 缺席时这个监听根本不会注册）。
        const dom = domDocument();
        if (dom?.visibilityState === "visible") controller.refreshIfEnabled();
      };
      const dom = domDocument();
      if (typeof dom?.addEventListener === "function") dom.addEventListener("visibilitychange", onVisible);
      return () => {
        offReady();
        const current = domDocument();
        if (typeof current?.removeEventListener === "function") current.removeEventListener("visibilitychange", onVisible);
        controller.dispose();
      };
    }, [vendor]);

    if (vendor === undefined) return null as unknown as ReactElement;
    return SidebarCard({
      t,
      status: view.status,
      ...(view.failure === undefined ? {} : { failure: view.failure }),
      ...(view.stale ? { stale: true } : {}),
      onOpen: () => options.onOpen(),
      onRefresh: () => read(true),
    });
  };
}

/**
 * 读浏览器的 `document`。
 *
 * tsconfig 的 `lib` 里**没有** DOM（刻意的：宿主侧代码不该用 DOM API），所以这里做一次窄化读取，
 * 而不是给整个工程加 `DOM`。非浏览器环境（测试、SSR）拿到 `undefined`，调用方据此跳过。
 * @returns 只含本模块用到的两个方法的形状。
 */
function domDocument():
  | {
      visibilityState?: string;
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    }
  | undefined {
  return (globalThis as { document?: ReturnType<typeof domDocument> }).document;
}

/** 中栏面板的插槽名（旧插件 `lib/client.js:9130` 用的就是它）。 */
export const MAIN_SLOT = "main";

/**
 * 把中栏面板注册进 `main` 插槽。
 *
 * 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:9130-9138`）：
 * `ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, locale, inject }, Component))`。
 *
 * **注意这里用的是 `key`，不是 `id`**，而且没有 `order` —— `main` 插槽按 key 选择面板（壳层用
 * `layout.selectPanel(key)` 打开它）。抄错成 `id` 会让面板永远打不开。
 * @param ctx - 客户端上下文。
 * @param registration - 面板 key、文案命名空间、组件与可选 `inject` 工厂。
 * @returns 注销函数（本实现是空操作，见 `registerSidebarCard` 的说明）。
 */
export function registerPanelCard(
  ctx: ClientSeamContext,
  registration: { key: string; locale: string; component: unknown; face?: () => Record<string, unknown> },
): () => void {
  const slots = slotsOf(ctx);
  if (slots === undefined) return () => undefined;
  try {
    slots.inject(MAIN_SLOT, () =>
      slots.register(
        {
          name: MAIN_SLOT,
          key: registration.key,
          locale: registration.locale,
          inject: registration.face ?? (() => ({ hooks: {} })),
        },
        registration.component,
      ),
    );
  } catch (error) {
    // 与侧边栏卡片同一处置：留一行错误，不让整个客户端因为一次注册失败而失效。
    console.error("[dsh-llm-account] could not register the centre-column panel:", error);
  }
  return () => undefined;
}

/**
 * 造**仪表盘容器组件**：厂商同样从模块级开关存储里取（仪表盘由侧边栏卡片打开，
 * 两者本就是同一家），挂载/切换时读一次，手动刷新时再读一次。
 *
 * **没有常驻轮询**：面板只在用户主动打开时存在，打开即读一次；之后由「刷新」按钮或重新打开
 * 触发。规格 §8.1 第 6 条的「不做无谓后台查询」在这里同样适用。
 *
 * 存储里没有厂商（侧边栏开关关闭、且没有任何一家开启）时显示占位文案 —— 面板虽常驻注册，
 * 但没有可显示的厂商就不编造一个。
 * @param options - 上下文、厂商声明、取词函数与关闭动作。
 * @returns 一个 React 函数组件。
 */
export function createDashboardView(options: {
  ctx: ClientSeamContext;
  entries: readonly VendorEntry[];
  t: (key: string) => string;
  onClose: () => void;
}): () => ReactElement {
  const { ctx, entries, t } = options;
  return function ConnectedDashboard(): ReactElement {
    const [vendor, setVendor] = useState<string | undefined>(() => sidebarVendor());
    const [status, setStatus] = useState<VendorUsageStatus | undefined>(undefined);
    const [switches, setSwitches] = useState<SwitchRecord[] | undefined>(undefined);

    useEffect(() => subscribeSidebarVendor(setVendor), []);

    // 冷启动兜底：与侧边栏卡片同一条（设置页从未打开过时存储是冷的）。
    useEffect(() => {
      if (sidebarVendorSeeded()) return;
      let alive = true;
      void describeVendorSnapshots(ctx, entries).then((snapshots) => {
        if (alive) noteSidebarSnapshots(entries, snapshots);
      });
      return () => {
        alive = false;
      };
    }, []);

    useEffect(() => {
      if (vendor === undefined) {
        setStatus(undefined);
        setSwitches(undefined);
        return;
      }
      const load = (): void => {
        const usage = usageNamespace(ctx);
        if (usage === undefined) return;
        void readStatus(usage, vendor).then((next) => {
          if (next !== undefined) setStatus(next);
        });
        void readSwitches(usage, vendor).then((next) => {
          if (next !== undefined) setSwitches(next);
        });
      };
      load();
      // 远程面挂载完成前读取会落空：挂上时补读一次。
      const offReady = onUsageReady(ctx, (namespace) => {
        if (namespace !== undefined) load();
      });
      return offReady;
    }, [vendor]);

    if (vendor === undefined) {
      return createElement("p", { "data-dashboard-empty": "true" }, t("dashboard.noData")) as ReactElement;
    }
    return Dashboard({
      t,
      status,
      switches,
      onClose: () => options.onClose(),
      onRefresh: () => {
        const usage = usageNamespace(ctx);
        if (usage === undefined) return;
        void readStatus(usage, vendor).then((next) => {
          if (next !== undefined) setStatus(next);
        });
        void readSwitches(usage, vendor).then((next) => {
          if (next !== undefined) setSwitches(next);
        });
      },
    });
  };
}

/**
 * 把侧边栏卡片与中栏面板注册进各自的插槽 —— **常驻、无条件**。
 *
 * 形状逐字对齐旧插件（`lib/client.js:9321-9341`）：`main` 用 `ctx.slots` + `key`，
 * `sidebar.footer.action` 用 `ctx.inject(["layout"], …)` + `id`/`order`，两处都 try/catch
 * （注册失败只留一行错误，不把整个客户端带走）。
 *
 * **为什么无条件**：插槽服务不返回注销句柄，条件注册一旦开启就撤不下来（关掉开关时卡片会
 * 带着定时器继续请求）。旧插件的处置是把条目**常驻**在插槽里，让组件按已存储的开关做渲染
 * 决策（"The entry stays REGISTERED — this is a render decision, so nothing churns the
 * slot ledger"）—— 本函数照此办理；门控在 {@link createSidebarCardView} 里。
 *
 * **幂等由调用方保证**：`applyShell` 的模块级守卫（与页面同一个）确保两个 profile 行各调
 * 一次 `apply` 也只注册一份；直接调用本函数（测试）每次都会注册。
 * @param options - 上下文、厂商声明、取词函数与文案命名空间。
 * @returns 撤销函数（插槽注册不可撤，见上；保留形状供调用方在 effect 里登记）。
 */
export function registerSharedSurfaces(options: {
  ctx: ClientSeamContext;
  entries: readonly VendorEntry[];
  t: (key: string) => string;
  localeNs: string;
}): () => void {
  const { ctx, entries, t, localeNs } = options;
  const disposeSidebar = registerSidebarCard(ctx, {
    id: SIDEBAR_CARD_ID,
    order: 1,
    locale: localeNs,
    component: createSidebarCardView({
      ctx,
      entries,
      t,
      onOpen: () => {
        selectPanel(ctx, DASHBOARD_PANEL_ID);
      },
    }),
  });
  const disposePanel = registerPanelCard(ctx, {
    key: DASHBOARD_PANEL_ID,
    locale: localeNs,
    component: createDashboardView({
      ctx,
      entries,
      t,
      onClose: () => {
        selectPanel(ctx, null);
      },
    }),
  });
  return () => {
    disposeSidebar();
    disposePanel();
  };
}

// —— 插件级共享状态：usage 远程面单例 + 侧边栏开关存储 + 设置镜像 ——
//
// 这个 bundle 被两个 profile 行共享（同一份模块实例），而三个界面（设置页、侧边栏卡片、
// 中栏面板）分属不同的 React 根。下面三样东西因此都必须是**模块级**的：
// 1. usage 远程面：$mount 一次，不随设置页开闭起落（旧插件挂在 apply 期，本机产物可读）；
// 2. 侧边栏开关存储：哪一家的卡片该显示；
// 3. 设置镜像：`settings/document-updated` 订阅 + 首读，让 2 在设置页关闭时也保持新鲜。

/** 共享的 usage 远程面（`$mount` 只发一次）。 */
let sharedUsage: UsageRemoteHandle | undefined;

/** 远程面可用性变化的监听者（设置页容器、卡片、面板都挂在这里）。 */
const usageReadyListeners = new Set<(namespace: UsageNamespace | undefined) => void>();

/** 造一个不带 `effect` 的委托上下文：重挂不能挂在某一行（可能已卸载）的作用域上。 */
function detachedContext(ctx: ClientSeamContext): ClientSeamContext {
  return {
    remote: ctx.remote,
    inject: (names, callback) => ctx.inject?.(names, callback),
  };
}

/**
 * 取共享的 usage 远程面，必要时（首次、或上次已卸下/挂载失败）挂载。
 *
 * 重挂用**不带 effect 的委托上下文**：初次挂载归第一个调用者的作用域（与旧插件同形），
 * 而那一行被卸载后，还活着的那一行要能把它救回来 —— 挂在任何单个行作用域上都会再次
 * 随着那一行死掉。
 * @param ctx - 调用方的客户端上下文（只在需要挂载时用到）。
 * @returns 共享句柄；挂载进行中时 `namespace()` 为 `undefined`。
 */
export function ensureUsageRemote(ctx: ClientSeamContext): UsageRemoteHandle {
  const current = sharedUsage;
  if (current !== undefined && !current.disposed() && !(current.namespace() === undefined && current.error() !== undefined)) {
    return current;
  }
  const handle = mountUsageRemote(current === undefined ? ctx : detachedContext(ctx), (namespace) => {
    for (const listener of [...usageReadyListeners]) listener(namespace);
  });
  sharedUsage = handle;
  return handle;
}

/**
 * 订阅远程面的可用性：先用当前值调用一次，之后每次变化再调用。
 *
 * 设置页容器用它拿命名空间（而**不持有**远程面的生命周期 —— 页面关掉不该把两个插槽界面的
 * 数据源一起带走）；卡片与面板用在「挂载完成前读取落空」的补读上。
 * @param ctx - 客户端上下文。
 * @param listener - 可用性变化回调（`undefined` = 还没挂上或已卸下）。
 * @returns 退订函数。
 */
export function onUsageReady(ctx: ClientSeamContext, listener: (namespace: UsageNamespace | undefined) => void): () => void {
  const handle = ensureUsageRemote(ctx);
  listener(handle.namespace());
  usageReadyListeners.add(listener);
  return () => {
    usageReadyListeners.delete(listener);
  };
}

/**
 * 当前可用的 usage 命名空间：先问共享句柄，再回落到上下文上的命名空间（旧宿主可能直接挂在
 * `ctx.remote` 上）。两者都没有就是 `undefined`（调用方按「数据不可用」降级）。
 * @param ctx - 客户端上下文。
 * @returns 命名空间；还没挂上时为 `undefined`。
 */
export function usageNamespace(ctx: ClientSeamContext): UsageNamespace | undefined {
  return ensureUsageRemote(ctx).namespace() ?? usageNamespaceOf(ctx);
}

/** 侧边栏卡片该显示哪一家（providerId）；没有开启的厂商时为 `undefined`。 */
let sidebarVendorValue: string | undefined;

/** 当前侧边栏厂商的设置文档值（轮询间隔等设置类控件从这里取，见 `quotaRefreshMs`）。 */
let sidebarVendorSettingsValue: Record<string, unknown> | undefined;

/** 存储是否已被一次**非空**的设置读取 seed 过（冷启动兜底的依据）。 */
let sidebarVendorSeededValue = false;

/** 开关存储的监听者（侧边栏卡片与仪表盘容器）。 */
const sidebarVendorListeners = new Set<(vendor: string | undefined) => void>();

/** 当前侧边栏卡片该显示的厂商；存储是冷的时为 `undefined`。 */
export function sidebarVendor(): string | undefined {
  return sidebarVendorValue;
}

/** 当前侧边栏厂商的设置文档值；存储是冷的时为 `undefined`。 */
export function sidebarVendorSettings(): Record<string, unknown> | undefined {
  return sidebarVendorSettingsValue;
}

/** 存储是否已 seed（有过一次非空读取）。冷启动兜底只在未 seed 时读一次。 */
export function sidebarVendorSeeded(): boolean {
  return sidebarVendorSeededValue;
}

/** 订阅开关存储变化。 */
export function subscribeSidebarVendor(listener: (vendor: string | undefined) => void): () => void {
  sidebarVendorListeners.add(listener);
  return () => {
    sidebarVendorListeners.delete(listener);
  };
}

/**
 * 用一次设置快照读取更新开关存储（**唯一的写入口**）。
 *
 * 空快照不写入也不 seed：宿主设置服务缺席/未就绪时的一次空读，不该把「已经开着」的卡片
 * 关掉，也不该把存储标记成已 seed（那样冷启动兜底就不再补救）。
 * @param entries - 注册表里的厂商声明。
 * @param snapshots - `describeVendorSnapshots` 的结果。
 */
export function noteSidebarSnapshots(entries: readonly VendorEntry[], snapshots: readonly VendorSnapshot[]): void {
  if (snapshots.length === 0) return;
  const map: Record<string, VendorSnapshot> = {};
  for (const snapshot of snapshots) map[snapshot.ns] = snapshot;
  const entry = sidebarVendorOf(entries, map);
  const vendor = entry?.providerId;
  sidebarVendorSeededValue = true;
  // 始终用最新快照刷新设置值：厂商没变但轮询间隔等设置改了也要即时生效（不能因为
  // `vendor === sidebarVendorValue` 提前返回就漏掉这次更新）。
  sidebarVendorSettingsValue = entry === undefined ? undefined : map[entry.ns]?.value;
  if (vendor === sidebarVendorValue) return;
  sidebarVendorValue = vendor;
  for (const listener of [...sidebarVendorListeners]) listener(vendor);
}

/** 设置镜像是否已启动（模块级守卫）。 */
let sidebarMirrorStarted = false;

/**
 * 启动插件级的设置镜像：首读一次 + 订阅 `settings/document-updated` 事件重读。
 *
 * 事件名与旧插件逐字相同（`lib/client.js` 的 `createSettingsScope`：`remote.$on(
 * "settings/document-updated", …)` 后 `mirror.ensure()`）—— 它是宿主在设置文档变化时发出的
 * 失效信号。没有它，用户在**设置页之外**改动开关（外部工具、patch 文件）时，侧边栏卡片
 * 要到下次宿主重启才知道。
 *
 * 事件潮合并：同一轮微任务里的多次事件只读一次（镜像的读是全量 describe，没必要重复）。
 * @param ctx - 客户端上下文（apply 期的那个）。
 * @param entries - 注册表里的厂商声明。
 */
export function startSidebarMirror(ctx: ClientSeamContext, entries: readonly VendorEntry[]): void {
  if (sidebarMirrorStarted) return;
  sidebarMirrorStarted = true;
  const read = (): void => {
    void describeVendorSnapshots(ctx, entries).then((snapshots) => noteSidebarSnapshots(entries, snapshots));
  };
  read();
  // 设置命名空间可能晚到：注入回调里再读一次（旧插件同一顺序 —— 命名空间落地后才有的读）。
  if (typeof ctx.inject === "function") {
    ctx.inject(["remote.settings"], (scoped: ClientSeamContext) => {
      void describeVendorSnapshots(scoped, entries).then((snapshots) => noteSidebarSnapshots(entries, snapshots));
    });
  }
  const remote = remoteOf(ctx);
  if (typeof remote?.$on === "function") {
    let scheduled = false;
    remote.$on("settings/document-updated", () => {
      if (scheduled) return;
      scheduled = true;
      void Promise.resolve().then(() => {
        scheduled = false;
        read();
      });
    });
  }
}

/**
 * 启动插件级共享状态：usage 远程面 + 设置镜像（幂等，两个 profile 行各调一次无副作用）。
 * @param ctx - 客户端上下文（apply 期的那个）。
 * @param entries - 注册表里的厂商声明。
 */
export function startSharedState(ctx: ClientSeamContext, entries: readonly VendorEntry[]): void {
  ensureUsageRemote(ctx);
  startSidebarMirror(ctx, entries);
}

/** 复位全部模块级共享状态（测试隔离钩子；生产代码只增不减地复用同一份）。 */
export function resetSeams(): void {
  sharedUsage?.dispose();
  sharedUsage = undefined;
  usageReadyListeners.clear();
  sidebarVendorValue = undefined;
  sidebarVendorSettingsValue = undefined;
  sidebarVendorSeededValue = false;
  sidebarVendorListeners.clear();
  sidebarMirrorStarted = false;
}

/**
 * 读当前已挂载的远程命名空间。
 *
 * 卡片容器是独立组件，拿不到设置页容器 state 里的那份 —— 所以从上下文里现取（挂载完成后由
 * Gateway 提供，见 `mountUsageRemote`）。
 * @param ctx - 客户端上下文。
 * @returns 命名空间；还没挂上时为 `undefined`。
 */
function usageNamespaceOf(ctx: ClientSeamContext): UsageNamespace | undefined {
  const remote = remoteOf(ctx);
  const namespace = remote?.[USAGE_NAMESPACE];
  return typeof namespace === "object" && namespace !== null ? (namespace as UsageNamespace) : undefined;
}

/**
 * 保存字段到设置文档。
 *
 * 写的是 describe 时**命中的行名**（`row`，不是核心命名空间）：宿主设置服务按 profile 条目 id
 * 寻址（`SettingsForms.write` 找 `row.options.id === ns`），而 opencode 的条目 id
 * （`opencode-go`）与核心命名空间（`llm-opencode-go`）不同 —— 用 `ns` 写会落到一个不存在
 * 的条目上，保存必然失败。修订号做并发围栏。
 * @param ctx - 客户端上下文。
 * @param row - 宿主上的设置行名（`describeVendorSnapshots` 快照里的 `row`）。
 * @param fields - 要写的字段。
 * @param revision - 读取时拿到的修订号。
 * @returns `undefined` 表示写入成功；否则是宿主给出的可读失败原因（调用方显示给用户，
 *   不静默 —— 用户以为保存成功而实际没有，比报错更糟）。
 */
export async function saveSettings(
  ctx: ClientSeamContext,
  row: string,
  fields: readonly { key: string; value: unknown }[],
  revision: number,
): Promise<string | undefined> {
  const settings = remoteOf(ctx)?.settings;
  if (settings === undefined || typeof settings.mutate !== "function") return "the host settings service is unavailable";
  if (fields.length === 0) return undefined;
  const ops = fields.map((field) => ({ op: "set" as const, path: [field.key], value: field.value }));
  try {
    await settings.mutate(row, ops, revision);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
