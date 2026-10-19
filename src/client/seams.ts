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

import { AccountsPanel } from "./accounts-panel";
import { dictionaryOf } from "./copy";
import { CSS_CLASS } from "./css";
import { Dashboard } from "./dashboard";
import { closeLoginWindow, openLoginWindow, pointLoginWindowAt, type LoginWindowHandle } from "./login-window";
import { SidebarCard } from "./sidebar-card";
import { useWebSearchPanel } from "./web-search-panel";
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
  sidebarVendorsOf,
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
import { ReadingCache } from "./reading-cache";
import type { VendorEntry } from "./registry";
import { USAGE_NAMESPACE, USAGE_PACKAGE, usageDescriptors, type AccountView, type AccountUsageStatus, type CatalogModelsResult, type SwitchRuntimeState, type UsageNamespace, type UsageReportView, type UsageWindowView, type VendorUsageStatus } from "./usage-contract";
import { AccountUsageBlock, UsageCard } from "./usage-card";

/**
 * 把账号 ref 翻成可读名（用量卡片显示用）。
 *
 * 找不到就原样返回 ref —— 台账里可能留着已经被删掉的账号，显示 ref 比显示空白有用。
 * @param accounts - 该厂商当前的账号表。
 * @param ref - 台账里的账号 ref。
 * @returns 可读标签。
 */
function accountLabelOf(accounts: readonly AccountUsageStatus[], ref: string): string {
  return accounts.find((account) => account.ref === ref)?.label ?? ref;
}

/** 一个「设置命名空间」在客户端看到的面（`remote.settings`）。 */
export interface RemoteSettings {
  /** 返回命名空间视图；宿主实际返回 `{ writable, hasDocument, namespaces }`（见下）。 */
  describe(): Promise<unknown>;
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

/**
 * 取 `ctx.remote`；形状不认识时返回 `undefined`（调用方一律按「远程不可用」降级）。
 *
 * **永不抛错**：宿主上下文是活对象，`ctx.remote` 可能是个 getter，在服务未就绪、插件被
 * 卸载或实现变更时直接抛。这个函数被渲染路径与 effect 大量调用，任何一次抛出都会变成
 * 「页面空白」或未处理异常，而它的语义本来就是「拿不到就降级」。
 * @param ctx - 客户端上下文。
 * @returns 远程服务面，或 `undefined`。
 */
export function remoteOf(ctx: ClientSeamContext): RemoteService | undefined {
  try {
    const remote = ctx?.remote;
    if (typeof remote !== "object" || remote === null) return undefined;
    return remote as RemoteService;
  } catch {
    return undefined;
  }
}

/**
 * 厂商发现的结果：**快照 + 失败诊断**。
 *
 * 诊断不是调试脚手架，而是一个设置页该有的诚实：发现不到厂商时，用户（和排障的人）
 * 需要知道是「远程面缺席」「`describe()` 抛错」「返回形状不认识」还是「命名空间对不上」。
 * 之前每条失败路径都返回空数组且丢掉原因，页面只显示一句「没有可显示的厂商」——
 * 同一个症状对应四种完全不同的病因，排查只能靠猜。
 */
export interface VendorDiscovery {
  /** 命中的厂商快照（页面身份用 `ns`，写路径用 `row`）。 */
  snapshots: VendorSnapshot[];
  /** 发现失败的原因；`undefined` 表示成功。 */
  problem?: DiscoveryProblem;
}

/** 发现失败的分类，附带足以定位的细节。 */
export type DiscoveryProblem =
  | { kind: "remote-absent"; detail: string }
  | { kind: "describe-failed"; detail: string }
  | { kind: "unknown-shape"; detail: string }
  | { kind: "no-match"; detail: string };

/**
 * 读已注册厂商的设置快照（页面「发现厂商」的依据，Ruling 2）。
 *
 * 只保留注册表里声明过的命名空间：宿主上可能还有别的插件命名空间，页面不该把它们当厂商。
 *
 * **返回形状（2026-10-17 在桌面端 0.2.1-rc.2 实测）**：`remote.settings.describe()` 返回的是
 * **一个对象**，命名空间数组包在 `namespaces` 里——不是裸数组：
 *
 * ```js
 * // 宿主 SettingsController.describe()（app.asar @21028751）
 * describe() {
 *   return {
 *     writable: settings.writable,
 *     hasDocument: true,
 *     namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
 *   };
 * }
 * // namespaceView()（app.asar @21024548）：身份是 ns，不是 id
 * { ns, autoGenerate, schema, value, base?, user?, applies, secrets, revision }
 * ```
 *
 * 之前把返回值当数组遍历，于是永远遍历不到元素 → 页面显示「没有可显示的厂商」。
 * 这里两种形状都认（对象包 `namespaces` / 裸数组），不认识则按「读不到」降级并**报告原因**。
 *
 * @param ctx - 客户端上下文。
 * @param entries - 注册表里的厂商声明。
 * @returns 快照与失败诊断（读不到时快照为空数组、problem 有值）。
 */
export async function discoverVendors(ctx: ClientSeamContext, entries: readonly VendorEntry[]): Promise<VendorDiscovery> {
  const settings = remoteOf(ctx)?.settings;
  if (settings === undefined || typeof settings.describe !== "function") {
    return {
      snapshots: [],
      problem: {
        kind: "remote-absent",
        detail: `ctx.remote${settings === undefined ? "" : ".settings"} is unavailable; injected services: ${describeInject(ctx)}`,
      },
    };
  }
  let described: unknown;
  try {
    described = await settings.describe();
  } catch (error) {
    // 只有装配故障会走到这里（宿主契约：宿主侧失败走 ok:false 分支，不 reject）。
    return {
      snapshots: [],
      problem: { kind: "describe-failed", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  const unwrapped = unwrapRemote(described);
  if (!unwrapped.ok) {
    return { snapshots: [], problem: { kind: "describe-failed", detail: unwrapped.error } };
  }
  const rows = namespaceRowsOf(unwrapped.value);
  if (rows === undefined) {
    return {
      snapshots: [],
      problem: { kind: "unknown-shape", detail: `describe() returned ${describeShape(unwrapped.value)}` },
    };
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
  if (snapshots.length === 0) {
    const seen = rows
      .map((row) => [row.ns, row.id].find((candidate): candidate is string => typeof candidate === "string"))
      .filter((name): name is string => name !== undefined);
    const wanted = entries.flatMap((entry) => [entry.ns, ...entry.rowIds]);
    return {
      snapshots,
      problem: {
        kind: "no-match",
        detail: `host namespaces: ${seen.length ? seen.join(", ") : "(none)"} | this package looks for: ${wanted.join(", ")}`,
      },
    };
  }
  return { snapshots };
}

/**
 * 读已注册厂商的设置快照（页面「发现厂商」的依据，Ruling 2）。
 *
 * 只要快照的薄封装；需要失败原因时用 {@link discoverVendors}。
 * @param ctx - 客户端上下文。
 * @param entries - 注册表里的厂商声明。
 * @returns 快照；读不到时为空数组。
 */
export async function describeVendorSnapshots(ctx: ClientSeamContext, entries: readonly VendorEntry[]): Promise<VendorSnapshot[]> {
  return (await discoverVendors(ctx, entries)).snapshots;
}

/**
 * 拆开宿主远程调用的信封。
 *
 * 宿主契约（app.asar @17916049，`dsh-client-runtime` 的文档字符串）：**每一次一元调用都
 * resolve 成 `RemoteResult<T>`**，即 `{ ok: true, value }` 或 `{ ok: false, error }`，
 * **并且不会因为宿主侧失败而 reject**——离线载波与调用方中断都被折进 error 分支
 * （`gateway/cancelled`）。只有装配层面的故障（arity 不对、方法未挂载、贡献被撤回、
 * 缺 Context adapter）才会 reject。
 *
 * 实测（2026-10-17 桌面端 0.2.1-rc.1）：`remote.settings.describe()` 返回
 * `{ ok: true, value: { writable, hasDocument, namespaces } }`——**不是**裸载荷。
 * 之前把返回值直接当载荷，于是「命名空间列表」读成了信封本身。
 *
 * 未包信封的裸载荷也认（`ok` 缺席时整体当作载荷），这样本地替身与其它宿主形状都能用。
 * @param result - 远程调用的原始返回值。
 * @returns 成功时带载荷，失败时带可读原因（`error` 是活的 `RemoteError`，能取到 code）。
 */
function unwrapRemote(result: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof result !== "object" || result === null || !("ok" in result)) {
    return { ok: true, value: result };
  }
  const envelope = result as { ok?: unknown; value?: unknown; error?: unknown };
  if (envelope.ok === true) return { ok: true, value: envelope.value };
  if (envelope.ok === false) return { ok: false, error: describeRemoteError(envelope.error) };
  // `ok` 存在但既非 true 也非 false：不是信封，按裸载荷处理。
  return { ok: true, value: result };
}

/** 把宿主的 `RemoteError` 压成一行可读文本（`code` 与 message 都带，排查要靠 code）。 */
function describeRemoteError(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof record.code === "string" ? record.code : undefined;
    const message = typeof record.message === "string" ? record.message : JSON.stringify(error);
    return code === undefined ? message : `${code}: ${message}`;
  }
  return String(error);
}

/** 宿主返回值的形状摘要（诊断用，不含任何值）。 */
function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value !== "object") return typeof value;
  return `an object with keys [${Object.keys(value as Record<string, unknown>).join(", ")}]`;
}

/** 本包在客户端读到的服务（诊断用：说明哪些接缝到位了）。 */
function describeInject(ctx: ClientSeamContext): string {
  // 走 `remoteOf`：它是唯一允许碰 `ctx.remote` 的地方（那里永不抛错）。
  // 这个函数只用于「为什么读不到」的诊断串，绝不能成为新的故障点。
  const remote = remoteOf(ctx);
  if (remote === undefined) return "no ctx.remote at all";
  return `ctx.remote keys [${Object.keys(remote as Record<string, unknown>).join(", ")}]`;
}

/** One namespace view as the host reports it: `ns` is the identity, `id` is the legacy field name. */
type NamespaceRow = { ns?: string; id?: string; value?: unknown; revision?: number };

/**
 * Pull the namespace list out of whatever `describe()` returned.
 *
 * @param described - the raw remote return value.
 * @returns the rows, or `undefined` when the shape is not recognised.
 */
function namespaceRowsOf(described: unknown): NamespaceRow[] | undefined {
  if (Array.isArray(described)) return described as NamespaceRow[];
  if (typeof described !== "object" || described === null) return undefined;
  const namespaces = (described as { namespaces?: unknown }).namespaces;
  return Array.isArray(namespaces) ? (namespaces as NamespaceRow[]) : undefined;
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
  // `$on` 由宿主实现，可能因为事件通道未就绪而抛；订阅失败只意味着「不会自动刷新」，
  // 不该把整页带走 —— 所以这里降级成空订阅，而不是让异常传进 effect。
  try {
    const off = remote.$on("credentials/reference-updated", () => listener());
    return typeof off === "function" ? off : () => undefined;
  } catch (error) {
    console.warn("[dsh-llm-account] could not subscribe to credential updates:", error);
    return () => undefined;
  }
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
 * 宿主是否真的能选面板（{@link selectPanel} 的「只探不发」版本）。
 *
 * 界面据此决定**要不要渲染**依赖 `selectPanel` 的入口（如仪表盘的「转到设置」）：渲染一个
 * 点了没反应的按钮，比不渲染更糟 —— 与「远程面没挂上就不渲染刷新按钮」同一条纪律。
 * @param ctx - 客户端上下文。
 * @returns 解析得出 `selectPanel` 存在时为 `true`。
 */
export function canSelectPanel(ctx: ClientSeamContext): boolean {
  const fromService = typeof ctx.get === "function" ? ctx.get("layout") : undefined;
  const layout = (fromService ?? ctx.layout) as { selectPanel?: (value: string | null) => unknown } | undefined;
  return layout !== undefined && typeof layout.selectPanel === "function";
}

/**
 * 远程读口统一拆信封。
 *
 * 宿主契约：每一次一元远程调用都 resolve 成 `RemoteResult<T>`（`{ ok: true, value }` 或
 * `{ ok: false, error }`），**宿主侧失败不 reject**（app.asar @17916049）。
 *
 * 这不是 `settings.describe()` 一处的问题——usage 远程面上的每一个读口（status /
 * accounts / switches / login / 额度）同样返回信封。实测（桌面端 0.2.1-rc.2）：
 * `namespace.status(vendor)` 给出的是信封，于是
 *   - `status.capabilities` 为 undefined → 页面渲染期抛错 → 整段设置页变空白；
 *   - `status.failures` 为 undefined → 侧边栏额度读口在 `.length` 上抛错 →
 *     状态从未更新，界面停在初始空态，显示「还没有请求经过这个账号」——**谎报**。
 * 两个症状都源于同一个「把信封当载荷」。
 * @param result - 远程调用的原始返回值（通常是一个 Promise）。
 * @returns 载荷；调用失败或形状不认识时为 `undefined`（调用方一律按「远程不可用」降级）。
 */
/**
 * 调一次远程读口，把**同步**抛错也折成被拒绝的 promise。
 *
 * 为什么需要：`remoteValueDetailed` 只等 promise，如果命名空间方法在返回 promise 之前就抛
 * （宿主代理未装、方法被撤下），异常会从调用点直接冒出去 —— 在登录按钮的点击处理器里
 * 就是「页面报错、界面毫无变化」，在 1s 的轮询定时器里就是未捕获异常。两条路都必须能落地。
 * @param call - 真正的远程调用（可能返回 `undefined`：远程面还没挂上）。
 * @returns 可供 {@link remoteValueDetailed} 消费的 promise；`undefined` 表示远程面缺席。
 */
function callRemote(call: () => Promise<unknown> | undefined): Promise<unknown> | undefined {
  try {
    return call();
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

async function remoteValue<T>(result: Promise<unknown> | unknown): Promise<T | undefined> {
  const detailed = await remoteValueDetailed<T>(result);
  return detailed.ok ? detailed.value : undefined;
}

/**
 * {@link remoteValue} 的带原因版本：失败时把宿主给的原文一起带出来。
 *
 * 为什么需要它：`remoteValue` 把失败压成 `undefined`，而界面只能说「账号数据暂不可用」——
 * 一句对四种不同病因（远程面没挂上 / 读口未装配 / 调用报错 / 形状不认识）都成立的空话。
 * 把原因一路带到卡片上，空态才能自证；这也是本地实测里唯一起作用的办法。
 * @param result - 远程调用的原始返回值。
 * @returns 成功时带载荷；失败时 `ok: false` 且 `problem` 是宿主原文（可读一行）。
 */
async function remoteValueDetailed<T>(
  result: Promise<unknown> | unknown,
): Promise<{ ok: true; value: T | undefined } | { ok: false; problem: string }> {
  let raw: unknown;
  try {
    raw = await result;
  } catch (error: unknown) {
    // 只有装配层面的故障会走到这里（读口调用本身不该 reject），但仍要给出原因而不是空话。
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
  const unwrapped = unwrapRemote(raw);
  return unwrapped.ok ? { ok: true, value: unwrapped.value as T | undefined } : { ok: false, problem: unwrapped.error };
}

/** 带原因的状态读口：命名空间缺席也要给出原因（那是最常见的一种）。 */
export async function readStatusDetail(
  namespace: UsageNamespace | undefined,
  vendor: string,
): Promise<{ status: VendorUsageStatus | undefined; problem: string | undefined }> {
  if (namespace === undefined) {
    return { status: undefined, problem: `the ${USAGE_NAMESPACE} remote namespace is not mounted` };
  }
  if (typeof namespace.status !== "function") {
    return { status: undefined, problem: `the ${USAGE_NAMESPACE} remote namespace has no status()` };
  }
  const detailed = await remoteValueDetailed<VendorUsageStatus>(namespace.status(vendor));
  return detailed.ok ? { status: detailed.value, problem: undefined } : { status: undefined, problem: detailed.problem };
}

/**
 * 读一个厂商的状态（生效账号、逐账号额度与拒绝）。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 状态；命名空间缺席、调用失败或形状不认识时为 `undefined`。
 */
export async function readStatus(namespace: UsageNamespace | undefined, vendor: string): Promise<VendorUsageStatus | undefined> {
  if (namespace === undefined || typeof namespace.status !== "function") return undefined;
  return remoteValue<VendorUsageStatus>(namespace.status(vendor));
}

/**
 * 读一个厂商的账号行。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 账号行；命名空间缺席或读取失败时为 `undefined`。
 */
export async function readAccounts(namespace: UsageNamespace | undefined, vendor: string): Promise<AccountView[] | undefined> {
  if (namespace === undefined || typeof namespace.accounts !== "function") return undefined;
  return remoteValue<AccountView[]>(namespace.accounts(vendor));
}

/**
 * 读一个厂商的**未过滤**模型目录（设置页勾选列表）。
 *
 * 失败不抛：页面要显示可读原因与「重试」，而不是把「读不到」渲染成「没有模型」。
 * @param namespace - 已挂载的远程命名空间。
 * @param vendor - 厂商 id。
 * @returns 目录与失败项。
 */
export async function readModels(namespace: UsageNamespace | undefined, vendor: string): Promise<CatalogModelsResult> {
  if (namespace === undefined || typeof namespace.models !== "function") {
    return { models: [], failures: [`the ${USAGE_NAMESPACE} remote namespace has no models()`] };
  }
  const detailed = await remoteValueDetailed<CatalogModelsResult>(namespace.models(vendor));
  if (detailed.ok && detailed.value !== undefined) return detailed.value;
  return {
    models: [],
    failures: [detailed.ok ? `${USAGE_NAMESPACE}/models returned no value` : detailed.problem],
  };
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
  /**
   * 状态读不出来时的**原因**（挂载失败或读口报错时的宿主原文）。
   *
   * 与 `status === undefined` 配套：症状一样（读不到数据），病因不同（远程面没挂上 vs
   * 读口调用失败 vs 形状不认识）。空态必须显示它，否则就只能猜。
   */
  problem: string | undefined;
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
  /** 要展示的模型 id（厂商目录 ∪ 白名单 ∪ 显隐表里有记录的，已去重）。 */
  models: string[];
  /** 白名单；缺省或为空表示不按白名单限制。 */
  visibleModels: readonly string[];
  /** 逐模型显隐（缺省视为可见）。 */
  modelVisibility: Record<string, boolean>;
  /** 目录带下来的公司/免费标记（供模型卡片分组）；页面会按 id 前缀兜底。 */
  modelInfo: Record<string, { company?: string; free?: boolean }>;
  /** 模型目录读取失败原因（宿主原文）；读取正常时缺省。 */
  catalogFailure?: string;
  /** 模型目录正在读取。 */
  catalogLoading?: boolean;
  /** 重新读取模型目录。 */
  onRetryCatalog?: () => void;
  /** 「添加模型」输入框的当前草稿。 */
  modelDraft: string;
  /** 模型搜索框关键词（纯展示过滤，不改任何设置）。 */
  modelFilter: string;
  setModelFilter: (value: string) => void;
  /** 该厂商模型改动的生效时机。 */
  modelMode: ModelsWriteMode;
  setModelDraft: (value: string) => void;
  /** 做一次模型编辑（按生效时机分派到草稿或立刻写）。 */
  editModel: (edit: ModelEdit) => void;
  /** 切换策略运行态（倒计时/待切换）。 */
  switchState?: SwitchRuntimeState;
  /** 容器每秒推进的时钟（卡片自己不设定时器）。 */
  now: number;
  /** 立即执行一次切换。 */
  switchNow: () => void;
  loginBegin: () => void;
}

/** 登录轮询间隔（毫秒）。等待授权时的轮询是**唯一的**后台请求来源，且随状态起停。 */
export const LOGIN_POLL_MS = 1_000;

/**
 * 登录轮询连续失败多少次才判成「读不到」。
 *
 * 一次远程调用失败（宿主忙、页面刚挂载）不该把等待面板打掉 —— 那会让授权链接莫名消失，
 * 而用户可能正在浏览器里操作。连续 3 次（约 3 秒）才认为这轮状态面真的读不到了。
 */
export const LOGIN_POLL_MAX_MISSES = 3;

/**
 * 等待授权的默认期限（毫秒），只在宿主**没有**报 `expiresAt` 时兜底。
 *
 * 为什么需要：不登录时宿主状态会一直停在 `waiting`，界面若只等「状态变终态」，
 * 授权链接就会一直挂着（用户报障：必须手动点取消）。Command Code 的真实窗口是 120 秒
 * （`LOGIN_TIMEOUT_MS`），这里用同一档兜底；宿主报了自己的期限时以宿主为准。
 */
export const LOGIN_WAITING_TTL_MS = 120_000;

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

/**
 * 登录状态读不出来时的落点。
 *
 * 必须是**非 waiting** 状态：读失败却写成 `waiting` 会让轮询永不停（每 1s 一次
 * 注定失败的远程调用）。`idle` 让卡片回到「未开始」，与「没登录过」一致。
 */
const LOGIN_UNKNOWN: LoginView = { state: "idle" };

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
  const component = createConnectedPageBody(options);
  // 把容器包进一层渲染兜底。
  //
  // 为什么必须有：`PageShell` 的 try/catch 只覆盖 `pageBody()`，而容器的 Hook 初始化、
  // `useWebSearchPanel` 以及进入 `PageShell` 之前的全部求值都在它之外。那里一抛错，
  // React 丢弃整棵子树 —— 用户看到的就是「设置里有条目，点进去一片空白」，控制台之外
  // 没有任何线索。
  //
  // 为什么这里用 try/catch 就够：返回的函数**就是**注册给宿主的组件，React 调用它的
  // 身体来渲染；`useState` 等 Hook 也是在这段身体里执行的，所以同步异常在这里就能接住，
  // 然后换成一块可读的错误面板（真实 React 与测试的迷你运行时同一条路径）。
  return () => renderWithBoundary(component);
}

/**
 * 同步渲染兜底：容器自身抛错时返回可读面板，而不是让异常穿到宿主。
 * @param component - 容器本体。
 * @returns 页面树或错误面板。
 */
function renderWithBoundary(component: () => ReactElement): ReactElement {
  try {
    return component();
  } catch (error) {
    console.error("[dsh-llm-account] the settings page crashed while rendering:", error);
    return renderBoundaryPanel(error);
  }
}

/**
 * 渲染失败时的可读面板（与 `PageShell` 的兜底同形）。
 *
 * 设置条目在、点进去空白，是「渲染期抛错」的典型症状 —— React 丢弃整棵子树，控制台
 * 之外没有任何线索。把异常原文印在页面上，用户能直接把它贴回来。
 * @param error - 捕获到的异常。
 * @returns 错误面板元素。
 */
function renderBoundaryPanel(error: unknown): ReactElement {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return createElement(
    "div",
    { "data-page": "llm-account", "data-render-error": "true", className: CSS_CLASS.root },
    createElement("h1", null, "LLM 账号"),
    createElement("p", { className: CSS_CLASS.intro }, "页面渲染失败，请把下面这段信息反馈给插件作者。"),
    createElement("pre", { className: CSS_CLASS.diagnostic }, `render failed: ${detail}`),
  );
}

/** 容器本体（Hook + 组装）；由 {@link createConnectedPage} 包进错误边界。 */
function createConnectedPageBody(options: ConnectedPageOptions): () => ReactElement {
  const { entries, ctx } = options;
  const t = options.t ?? dictionaryOf("zh");

  return function ConnectedPage(): ReactElement {
    const [state, setState] = useState<PageState>(() => createPageState(entries, []));
    const [usage, setUsage] = useState<UsageNamespace | undefined>(undefined);
    /** usage 远程面**挂载**失败的原因（`undefined` = 没失败或在挂载中）。 */
    const [usageProblem, setUsageProblem] = useState<string | undefined>(undefined);
    /** 逐厂商的状态读口失败原因（读口在、但调用失败）。 */
    const [statusProblems, setStatusProblems] = useState<Record<string, string | undefined>>({});
    const [logins, setLogins] = useState<Record<string, LoginView | undefined>>({});
    /** 正在启动网页登录的厂商（远程调用还没回来）：按钮禁用 + 「正在启动…」。 */
    const [loginStarting, setLoginStarting] = useState<Record<string, boolean | undefined>>({});
    /**
     * 网页登录**调用没能发出去**的原因（宿主原文），按厂商。
     *
     * 与 `logins[vendor].reason` 分工：那里是登录流程给的稳定原因键；这里是远程面没挂上、
     * 宿主装配报错这类「流程根本没跑起来」的原文。以前这类失败被 `void … .then(…)`
     * 静默吞掉 —— 点了「网页登录」什么都不发生（本机报障的第二种现象）。
     */
    const [loginErrors, setLoginErrors] = useState<Record<string, string | undefined>>({});
    /**
     * 已收起的等待面板（按厂商）。
     *
     * 两种进入方式：用户**关掉了弹出的授权窗口**（他已不打算继续），或期限到了。
     * 收起只是不渲染，**不取消**宿主流程 —— 关闭那一刻他可能刚批准，取消会把成功误杀；
     * 轮询继续到终态，成功后账号照常刷新。
     */
    const [loginDismissed, setLoginDismissed] = useState<Record<string, boolean | undefined>>({});
    const [statuses, setStatuses] = useState<Record<string, VendorUsageStatus | undefined>>({});
    /** 首次状态读取是否仍在进行（区分加载中/读失败）。 */
    const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>(() =>
      Object.fromEntries(entries.map((entry) => [entry.providerId, true])),
    );
    /** 「添加模型」的输入草稿（按厂商分开）。 */
    const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
    /** 模型搜索关键词（按厂商分开；纯展示，不进设置草稿、不进保存条）。 */
    const [modelFilters, setModelFilters] = useState<Record<string, string>>({});
    /** 每个厂商的未过滤目录（`models()` 的结果）；还没读到时缺省。 */
    const [modelCatalogs, setModelCatalogs] = useState<Record<string, CatalogModelsResult | undefined>>({});
    /** 目录读取中（按厂商）。 */
    const [modelCatalogLoading, setModelCatalogLoading] = useState<Record<string, boolean | undefined>>({});
    /** 正在保存的命名空间（保存按钮立即反馈）。 */
    const [savingNs, setSavingNs] = useState<string | undefined>(undefined);
    /** 账户操作计数：每次成功的操作 +1，用来触发一次状态重读。 */
    const [accountRevision, setAccountRevision] = useState(0);
    /**
     * 上一次账户操作没提交出去的原因（人话）。
     *
     * 只在「容器知道为什么没发出去」时设置：空名称/空密钥（`dispatchAccountAction` 的规矩）、
     * 远程面还没挂上、以及远程调用真的 reject（以前是**静默丢失**的 —— `void pending.then(…)`
     * 没有失败分支）。用户一改字段或取消就清掉。
     */
    const [actionError, setActionError] = useState<string | undefined>(undefined);
    /**
     * 挂载后的**第一次**状态读取是否已经发生：只有那一次允许吃模块级缓存。
     * 修订号变化（凭据 / 账号操作）意味着数据真的变了，必须现读（见 `STATUS_READING_TTL_MS`）。
     */
    const initialStatusRead = useRef(false);
    /** 本轮登录为授权页开的占位窗口（用户手势里同步打开，见 `login-window.ts`）。 */
    const loginPopup = useRef<LoginWindowHandle | undefined>(undefined);
    /** 登录轮询连续失败次数（按厂商）：单次抖动不该把等待面板打掉，连续失败才判成读不到。 */
    const loginPollMisses = useRef<Record<string, number>>({});
    /** 每家的等待期限（epoch 毫秒）：宿主报了 `expiresAt` 就用它，否则按首次观察 + 默认 TTL。 */
    const loginDeadlines = useRef<Record<string, number | undefined>>({});
    /**
     * 这一家的这次等待是否**已经收尾**（超时/取消/终态）。
     *
     * 为什么需要：定时器是每秒一拍，`advanceTimers` 或慢网络下会有**多拍同时在途**；
     * 第一拍判定超时后，后面几拍迟到的 `waiting` 响应会把面板又装回去（实测：到期后面板
     * 闪回来）。收尾之后一律不再采纳 `waiting`。
     */
    const loginClosed = useRef<Record<string, boolean | undefined>>({});

    /** 采纳一次发现结果：页面状态与侧边栏开关存储（同一来源、两个消费者）。 */
    const adopt = (discovery: VendorDiscovery): void => {
      const { snapshots, problem } = discovery;
      // 读不到时**不**用空快照清空页面（宿主设置服务缺席不该抹掉已有状态），
      // 但要把失败原因记进状态：空态据此自证，而不是只说一句「没有可显示的厂商」。
      if (snapshots.length === 0) {
        if (problem !== undefined) {
          setState((current) => createPageState(entries, snapshots, current, problem));
        }
        return;
      }
      noteSidebarSnapshots(entries, snapshots);
      setState((current) => createPageState(entries, snapshots, current, problem));
    };

    useEffect(() => {
      let alive = true;
      const guarded = (discovery: VendorDiscovery): void => {
        if (alive) adopt(discovery);
      };
      void discoverVendors(ctx, entries)
        .then(guarded)
        .catch((error: unknown) => {
          console.warn("[dsh-llm-account] could not read the vendor snapshots:", error);
        });
      // 订阅类调用也要各自兜住：effect 里抛出的是**未处理异常**（try/catch 在渲染期之外
      // 接不到），一处失败会让整页看起来「没有数据」，而混在 React 的清理链里极难定位。
      let off: () => void = () => undefined;
      try {
        off = subscribeCredentials(ctx, () => setState((current) => noteCredentialChange(current)));
      } catch (error) {
        console.warn("[dsh-llm-account] could not subscribe to credential updates:", error);
      }
      // 远程面在挂载完成后才可用；挂载前卡片按「数据不可用」显示。
      // 只订阅、不 dispose：它的生命周期属于插件，不属于这个页面。
      let offUsage: () => void = () => undefined;
      try {
        offUsage = onUsageReady(ctx, (namespace, problem) => {
          if (!alive) return;
          setUsage(namespace);
          setUsageProblem(problem);
        });
      } catch (error) {
        console.warn("[dsh-llm-account] could not watch the usage remote:", error);
      }
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
      void discoverVendors(ctx, entries).then((discovery) => {
        if (alive) adopt(discovery);
      });
      if (usage !== undefined) {
        // 「打开设置就重新获取一次」的对策（2026-10-18 用户提问：授权后每次打开都要重取吗？）：
        // 挂载后的第一次读取先看模块级缓存 —— TTL 内直接采纳上一次的读数（含设置页面板版本
        // 与侧边栏写回的那份），一次网络调用都不发。修订号变化时**绕过**缓存：那意味着
        // 账号/凭据真的变了（缓存会随这次现读被覆盖）。
        const useCache = !initialStatusRead.current;
        initialStatusRead.current = true;
        for (const entry of entries) {
          const cached = useCache ? statusReadings.get(entry.providerId) : undefined;
          if (cached !== undefined) {
            setStatuses((current) => ({ ...current, [entry.providerId]: cached }));
            setStatusProblems((current) => ({ ...current, [entry.providerId]: undefined }));
            setStatusLoading((current) => ({ ...current, [entry.providerId]: false }));
            continue;
          }
          // 用带原因的读口：状态读不出来时把宿主原文存起来，卡片据此自证，
          // 而不是只显示一句对任何病因都成立的「账号数据暂不可用」。
          void readStatusDetail(usage, entry.providerId).then(({ status, problem }) => {
            if (!alive) return;
            // 只有**完整**的读数进缓存：部分失败（端点级失败、某个账号没读到额度）照旧每次
            // 重读 —— 把一次瞬时故障缓存 60 秒，就是用户看到的「额度信息又不见了」。
            if (status !== undefined && completeReading(status)) statusReadings.put(entry.providerId, status);
            if (status !== undefined) setStatuses((current) => ({ ...current, [entry.providerId]: status }));
            setStatusProblems((current) => ({ ...current, [entry.providerId]: problem }));
            setStatusLoading((current) => ({ ...current, [entry.providerId]: false }));
          });
        }
      }
      return () => {
        alive = false;
      };
    }, [usage, state.credentialRevision, accountRevision]);

    // 远程面本身挂载失败：结束加载态，让面板显示「暂不可用 + 原因」，而不是一直转圈。
    useEffect(() => {
      if (usageProblem === undefined) return;
      setStatusLoading(Object.fromEntries(entries.map((entry) => [entry.providerId, false])));
    }, [usageProblem]);

    // 页面卸载时关掉还没导航的占位窗口：授权网址还没回来用户就走了，别留一个空白页。
    useEffect(
      () => () => {
        closeLoginWindow(loginPopup.current);
        loginPopup.current = undefined;
      },
      [],
    );

    // 登录轮询：只在等待授权时跑（规格 §8.1 第 6 条的「关闭即静默」精神 —— 没有等待就不问）。
    const waitingVendors = entries.map((entry) => entry.providerId).filter((vendor) => shouldPollLogin(logins[vendor]));
    useEffect(() => {
      if (usage === undefined || waitingVendors.length === 0) return;
      const timer = setInterval(() => {
        for (const vendor of waitingVendors) {
          void remoteValueDetailed<LoginView>(callRemote(() => usage.loginStatus(vendor))).then((detail) => {
            // 这一拍出发后局面已经收尾（超时/取消/终态）：迟到的响应一律丢掉，
            // 否则它会把刚收起的等待面板又装回去。
            if (loginClosed.current[vendor] === true) return;
            if (!detail.ok || detail.value === undefined) {
              // 单次失败不该把等待面板打掉（那会让授权链接莫名消失）；连续失败才判成读不到，
              // 并把原因落到提示里 —— 否则面板会挂到过期，用户以为「链接永远在」。
              const misses = (loginPollMisses.current[vendor] ?? 0) + 1;
              loginPollMisses.current[vendor] = misses;
              if (misses >= LOGIN_POLL_MAX_MISSES) {
                setLogins((current) => ({ ...current, [vendor]: { state: "failed", reason: "network" } }));
                setLoginErrors((current) => ({
                  ...current,
                  [vendor]: detail.ok ? t("account.loginFailed") : detail.problem,
                }));
              }
              return;
            }
            loginPollMisses.current[vendor] = 0;
            const status = detail.value;
            if (status.state === "waiting") {
              // 期限：宿主报了 `expiresAt` 就用它；没报（旧宿主/其它厂商）就按首次观察 + 默认 TTL。
              // **不登录时状态会一直停在 `waiting`**，所以到期必须由界面自己收尾 ——
              // 否则授权链接会一直挂着，只能手点取消（用户报障）。
              const deadline = status.expiresAt ?? loginDeadlines.current[vendor] ?? Date.now() + LOGIN_WAITING_TTL_MS;
              loginDeadlines.current[vendor] = deadline;
              if (Date.now() >= deadline) {
                loginClosed.current[vendor] = true;
                setLogins((current) => ({ ...current, [vendor]: { state: "failed", reason: "timeout" } }));
                setLoginErrors((current) => ({ ...current, [vendor]: undefined }));
                setLoginDismissed((current) => (current[vendor] === undefined ? current : { ...current, [vendor]: false }));
                loginDeadlines.current[vendor] = undefined;
                return;
              }
              // 用户把弹出的授权窗口关了 = 他不打算继续：收起面板（**不**取消宿主流程 ——
              // 关闭那一刻他可能刚批准，取消会把成功误杀；流程自己会超时，轮询到终态即止）。
              if (loginPopup.current?.closed === true) {
                setLoginDismissed((current) => (current[vendor] === true ? current : { ...current, [vendor]: true }));
              }
              setLogins((current) => ({ ...current, [vendor]: status }));
              return;
            }
            // 终态：清理期限与「已收起」，让失败原因/成功都能正常显示。
            loginClosed.current[vendor] = true;
            loginDeadlines.current[vendor] = undefined;
            setLoginDismissed((current) => (current[vendor] === undefined ? current : { ...current, [vendor]: false }));
            setLogins((current) => ({ ...current, [vendor]: status }));
            // 登录成功后账号表多了一条/换了密钥：重读一次，别让面板停在旧列表上。
            if (status.state === "success") setAccountRevision((current) => current + 1);
          });
        }
      }, LOGIN_POLL_MS);
      return () => clearInterval(timer);
    }, [usage, waitingVendors.join(",")]);

    // 侧边栏卡片与中栏面板的注册在 apply 期一次完成（`registerSharedSurfaces`，常驻），
    // 门控在卡片组件里按**已存储**的开关做（`createSidebarCardView`）—— 这里不再碰插槽。

    const activeEntry = entries.find((entry) => entry.ns === state.activeNs);
    const activeVendor = activeEntry?.providerId;

    const availableEntries = entries.filter((entry) => state.tabs.some((tab) => tab.ns === entry.ns));
    const modelVendorKey = availableEntries.map((entry) => entry.providerId).join(",");

    // 读**所有**可用厂商的未过滤模型目录：全局模型卡要把两家放在一起；只读当前标签页会让
    // 另一家的模型在切换标签页前一直缺一块。刷新走 {@link refreshVendorCatalog}（按账户
    // 逐个读），不在这里靠计数器重跑 —— 见那里的说明。
    useEffect(() => {
      if (usage === undefined) return;
      const targets = entries.filter((entry) => state.tabs.some((tab) => tab.ns === entry.ns));
      if (targets.length === 0) return;
      let alive = true;
      // 目录是厂商级资源：TTL 内跨挂载复用（换一个设置对象标签页也不该把两家的目录重问一遍）。
      // 手动入口（账号行的刷新、失败重试）走 {@link refreshVendorCatalog}：它绕过缓存并覆盖它。
      const toRead: VendorEntry[] = [];
      for (const entry of targets) {
        const cached = catalogReadings.get(entry.providerId);
        if (cached === undefined) {
          toRead.push(entry);
          continue;
        }
        setModelCatalogs((current) => ({ ...current, [entry.providerId]: cached }));
        setModelCatalogLoading((current) => ({ ...current, [entry.providerId]: false }));
      }
      if (toRead.length > 0) {
        setModelCatalogLoading((current) => {
          const next = { ...current };
          for (const entry of toRead) next[entry.providerId] = true;
          return next;
        });
        for (const entry of toRead) {
          void readModels(usage, entry.providerId).then((result) => {
            if (!alive) return;
            if (result.failures.length === 0) catalogReadings.put(entry.providerId, result);
            setModelCatalogs((current) => ({ ...current, [entry.providerId]: result }));
            setModelCatalogLoading((current) => ({ ...current, [entry.providerId]: false }));
          });
        }
      }
      // 依赖里的 `accountRevision`：**账号变了目录也会变** —— 目录要鉴权（Open Design 的
      // `/v1/models` 不带密钥回 401），加完账号/换完密钥不重读的话，界面会一直停在挂载时
      // 那次「读不到」的空目录上（用户报障：加了 API 却没模型）。失败读数不进缓存，
      // 所以这里必定会真读一次。
      return () => {
        alive = false;
      };
    }, [usage, modelVendorKey, accountRevision]);

    // 合并账户面板：两家放在同一张卡片里，动作按厂商路由（设计 §7.2）。
    // 按账户刷新模型目录（2026-10-18 用户要求：「重新获取模型不是刷新所有的，应该是刷新
    // 单个账户的」）：账号行上每个账号都有自己的刷新按钮，点的就是**这一家**的目录重读 ——
    // 目录是厂商级资源（`models()` 按厂商寻址），一次读取惠及该厂商的所有账号，但不碰别家，
    // 也不重跑挂载时那个「读全部」的 effect。远程面还没挂上时静默返回：那时任何点击都发不出去。
    const refreshVendorCatalog = (vendor: string): void => {
      const current = usageNamespace(ctx);
      if (current === undefined) return;
      setModelCatalogLoading((loading) => ({ ...loading, [vendor]: true }));
      void readModels(current, vendor).then((result) => {
        if (result.failures.length === 0) catalogReadings.put(vendor, result);
        setModelCatalogs((catalogs) => ({ ...catalogs, [vendor]: result }));
        setModelCatalogLoading((loading) => ({ ...loading, [vendor]: false }));
      });
    };
    const catalogFailureOf = (vendor: string): string | undefined => {
      const catalog = modelCatalogs[vendor];
      if (catalog === undefined || catalog.failures.length === 0) return undefined;
      // 保持**原文**：翻译在下游渲染处做（`failureListText`），这样 `data-*` 里留得下诊断原样。
      return catalog.failures.join("；");
    };

    /**
     * 发起一次网页登录。
     *
     * 三件以前没做的事，缺任何一件用户看到的就是「点了没反应」：
     * 1. **同步开一个占位窗口**（弹窗拦截器只认用户手势；授权网址是异步回来的）；
     * 2. 立刻进「正在启动」态（按钮禁用 + 文案），点击到出结果之间不再是空白；
     * 3. **失败必须落地**：流程给了 `failed/reason` 就记进 `logins`，调用本身没发出去 /
     *    抛错就记进 `loginErrors`（原文进 `data-*`，界面说人话）。
     * @param vendor - 厂商 id。
     */
    const beginLogin = (vendor: string): void => {
      // 连点两次不该堆出两个窗口：先关掉上一次的占位窗口。
      closeLoginWindow(loginPopup.current);
      // 新的一次尝试：解除"已收尾"（上一次的迟到响应不该再被采纳）。
      loginClosed.current[vendor] = false;
      const popup = openLoginWindow();
      loginPopup.current = popup;
      setLoginErrors((current) => ({ ...current, [vendor]: undefined }));
      setLoginStarting((current) => ({ ...current, [vendor]: true }));
      const remote = callRemote(() => usage?.loginBegin(vendor));
      if (remote === undefined) {
        // 远程面还没挂上：以前这里静默返回（点一下什么都不发生）。
        closeLoginWindow(popup);
        loginPopup.current = undefined;
        setLoginStarting((current) => ({ ...current, [vendor]: false }));
        setLoginErrors((current) => ({ ...current, [vendor]: t("account.serviceNotReady") }));
        return;
      }
      void remoteValueDetailed<LoginView>(remote).then((detail) => {
        setLoginStarting((current) => ({ ...current, [vendor]: false }));
        if (!detail.ok || detail.value === undefined) {
          // 调用失败（宿主侧装配故障 / 形状不认识）：关掉占位窗口，把原因记下来。
          loginClosed.current[vendor] = true;
          closeLoginWindow(loginPopup.current);
          loginPopup.current = undefined;
          setLoginErrors((current) => ({
            ...current,
            [vendor]: detail.ok ? t("account.loginFailed") : detail.problem,
          }));
          return;
        }
        const status = detail.value;
        const opened = status.state === "waiting" && status.authUrl !== undefined
          ? pointLoginWindowAt(popup, status.authUrl)
          : false;
        // 不需要浏览器的状态（failed/success/idle）或导航失败：别留一个空白页。
        if (!opened) {
          closeLoginWindow(popup);
          loginPopup.current = undefined;
        }
        if (status.state === "waiting") {
          // 记下这次等待的期限：宿主报了 `expiresAt` 就用它，否则按现在 + 默认 TTL 兜底。
          // 不登录时状态会一直停在 `waiting`，没有期限界面就只能等用户手点取消（用户报障）。
          loginDeadlines.current[vendor] = status.expiresAt ?? Date.now() + LOGIN_WAITING_TTL_MS;
          setLoginDismissed((current) => (current[vendor] === undefined ? current : { ...current, [vendor]: false }));
        }
        setLogins((current) => ({ ...current, [vendor]: status }));
        if (status.state === "success") setAccountRevision((current) => current + 1);
      });
    };

    /**
     * 取消某一家等待中的登录：宿主侧停掉流程（释放本地端口/子进程），界面立即回到未开始。
     * @param vendor - 厂商 id。
     */
    const cancelLogin = (vendor: string): void => {
      closeLoginWindow(loginPopup.current);
      loginPopup.current = undefined;
      loginClosed.current[vendor] = true;
      loginPollMisses.current[vendor] = 0;
      loginDeadlines.current[vendor] = undefined;
      setLogins((current) => ({ ...current, [vendor]: LOGIN_UNKNOWN }));
      setLoginErrors((current) => ({ ...current, [vendor]: undefined }));
      setLoginDismissed((current) => (current[vendor] === undefined ? current : { ...current, [vendor]: false }));
      void remoteValue(callRemote(() => usage?.loginCancel(vendor)));
    };

    // —— 用量统计的 state 与读取 ——
    //
    // 必须**在 `accountsPanel` 之前**声明：账号行要内嵌各自的用量（用户要求「单个账号的
    // 统计放在该账号下面」），而构造面板时就要用到 `usageReport`。所有 Hook 仍然集中在
    // 渲染体顶部，顺序在每次渲染之间不变。
    const [usageWindow, setUsageWindow] = useState<UsageWindowView>("today");
    const [usageReport, setUsageReport] = useState<UsageReportView | undefined>(undefined);
    const [usageStatsProblem, setUsageStatsProblem] = useState<string | undefined>(undefined);
    const [usageLoading, setUsageLoading] = useState(true);
    /**
     * 定时重读计数：设置页会开着好一会儿，30 秒一次让数字跟上。
     *
     * 为什么不是「请求完成就刷新」：客户端没有可订阅的回合结束事件（宿主的
     * `session/event` 只在 host 插件上下文里可用）。页面不可见时不读（与侧边栏同纪律）。
     */
    const [usageTick, setUsageTick] = useState(0);
    useEffect(() => {
      const timer = setInterval(() => {
        const dom = domDocument();
        if (dom?.visibilityState === "hidden") return;
        setUsageTick((current) => current + 1);
      }, 30_000);
      return () => clearInterval(timer);
    }, []);
    useEffect(() => {
      let alive = true;
      const load = (): void => {
        if (!alive) return;
        const api = usageNamespace(ctx);
        if (api === undefined) {
          // 远程面**还没挂上**（`usageNamespace` 走懒挂载：挂载完成才有命名空间）。
          // 保持 loading，等下面的 `onUsageReady` 在挂载完成时再调一次 —— 否则卡片
          // 会永久不出现（首次渲染几乎总是早于挂载完成）。
          setUsageLoading(true);
          return;
        }
        if (api.usageReport === undefined) {
          // 命名空间在、但没有这个方法：宿主版本太旧或本次发布没带它。这时**确定**没有，
          // 收起 loading 且不渲染卡片（不是「还在等」）。
          setUsageLoading(false);
          setUsageReport(undefined);
          return;
        }
        setUsageLoading(true);
        void api.usageReport(usageWindow).then(
          (report) => {
            if (!alive) return;
            setUsageReport(report);
            setUsageStatsProblem(undefined);
            setUsageLoading(false);
          },
          (error: unknown) => {
            if (!alive) return;
            setUsageStatsProblem(error instanceof Error ? error.message : String(error));
            setUsageLoading(false);
          },
        );
      };
      load();
      // 远程面挂载完成时补读一次（与侧边栏卡片、仪表盘同一条纪律）。
      const offReady = onUsageReady(ctx, (namespace) => {
        if (namespace !== undefined) load();
      });
      return () => {
        alive = false;
        offReady();
      };
    }, [usageWindow, accountRevision, usageTick]);
    /**
     * 某个账号的用量块（渲染在它自己的额度条下方）。
     * @param vendor - 厂商。
     * @param ref - 账号 ref。
     * @returns 用量块；没有该账号的读数时为 `undefined`（不占位）。
     */
    const accountUsageOf = (vendor: string, ref: string): ReactNode => {
      const row = usageReport?.accounts.find((entry) => entry.vendor === vendor && entry.account === ref);
      if (row === undefined) return undefined;
      return AccountUsageBlock({
        t,
        entry: row,
        label: accountLabelOf(statuses[vendor]?.accounts ?? [], ref),
        compact: true,
      });
    };

    const accountsPanel = createElement(AccountsPanel, {
      usageOf: accountUsageOf,
      t,
      vendors: availableEntries.map((entry) => ({
        entry,
        status: statuses[entry.providerId],
        problem: usageProblem ?? statusProblems[entry.providerId],
        ...(state.actionVendor === entry.providerId && state.action !== undefined ? { action: state.action } : {}),
        ...(state.expandedVendor === entry.providerId && state.expandedRef !== undefined
          ? { expandedRef: state.expandedRef }
          : {}),
        // 已收起的等待面板（用户关掉了授权窗口）：不渲染，但轮询继续到终态。
        ...(logins[entry.providerId] === undefined || loginDismissed[entry.providerId] === true
          ? {}
          : { login: logins[entry.providerId] }),
        ...(modelCatalogs[entry.providerId] === undefined
          ? {}
          : { catalog: modelCatalogs[entry.providerId]!.models }),
        ...(catalogFailureOf(entry.providerId) === undefined
          ? {}
          : { catalogFailure: catalogFailureOf(entry.providerId) }),
        ...(modelCatalogLoading[entry.providerId] === true ? { catalogLoading: true } : {}),
        ...(statuses[entry.providerId]?.modelRules === undefined
          ? {}
          : { modelRules: statuses[entry.providerId]!.modelRules! }),
        ...(statusLoading[entry.providerId] === true ? { loading: true } : {}),
      })),
      ...(actionError === undefined ? {} : { actionError }),
      // 按账户刷新：每个账号行的刷新按钮 → 重读**该账号所属厂商**的目录（见 refreshVendorCatalog）。
      onRefreshModels: (vendor: string) => refreshVendorCatalog(vendor),
      onOpenAction: (vendor: string, action: { kind: AccountAction["kind"]; ref?: string }) => {
        setActionError(undefined);
        setState((current) => openAction(current, action, vendor));
      },
      onActionField: (field: "label" | "key", value: string) => {
        setActionError(undefined);
        setState((current) => setActionField(current, field, value));
      },
      onConfirmAction: (vendor: string) => {
        const action = state.action;
        if (action === undefined) return;
        if (usage === undefined) {
          setActionError(t("account.serviceNotReady"));
          return;
        }
        const pending = dispatchAccountAction(usage, vendor, action);
        if (pending === undefined) {
          // 空名称/空密钥：不发调用是设计（防误写空账号），但**必须**告诉用户为什么。
          setActionError(action.kind === "key" ? t("account.keyRequired") : t("account.labelRequired"));
          return;
        }
        setActionError(undefined);
        void pending.then(
          () => {
            setState((current) => closeAction(current));
            setAccountRevision((current) => current + 1);
          },
          // 远程侧拒绝（宿主校验、凭据服务报错）：以前没有失败分支，错误直接被丢掉。
          (error: unknown) => setActionError(error instanceof Error ? error.message : String(error)),
        );
      },
      onCancelAction: () => {
        setActionError(undefined);
        setState((current) => closeAction(current));
      },
      onSelect: (vendor: string, ref: string | null) => {
        void usage?.selectAccount(vendor, ref).then(() => setAccountRevision((current) => current + 1));
      },
      onRemove: (vendor: string, ref: string) => {
        void usage?.removeAccount(vendor, ref).then(() => setAccountRevision((current) => current + 1));
      },
      onMove: (vendor: string, ref: string, toIndex: number) => {
        void usage?.moveAccount(vendor, ref, toIndex).then(() => setAccountRevision((current) => current + 1));
      },
      onSetAccountModels: (vendor: string, ref: string, models: readonly string[]) => {
        void usage?.setAccountModels?.(vendor, ref, models).then(() => setAccountRevision((current) => current + 1));
      },
      onToggleExpand: (vendor: string, ref: string) => setState((current) => toggleExpanded(current, ref, vendor)),
      onLoginBegin: (vendor: string) => beginLogin(vendor),
      // 等待面板的「取消登录」：宿主停流程、界面立刻回到未开始。
      onLoginCancel: (vendor: string) => cancelLogin(vendor),
      // 再点一次「新增账户」（收起区块）= 后退一步：开着的添加表单与等待中的登录都收掉。
      onCollapseAddChooser: () => {
        setActionError(undefined);
        setState((current) => (current.action === undefined ? current : closeAction(current)));
        for (const [vendor, value] of Object.entries(logins)) {
          if (value?.state === "waiting") cancelLogin(vendor);
        }
      },
      loginStarting,
      loginError: loginErrors,
    });
    const accounts = availableEntries.length === 0 ? undefined : accountsPanel;
    // 网页搜索卡片：跨厂商，放在厂商主体之后。以自定义 Hook 调用（而不是子元素组件）——
    // Hook 必须落在本容器这一个挂载根上（Ruling 22；子元素里的 Hook 过不了迷你夹具）。
    // 无条件挂载：读取/凭据/写回的每种失败面板内部都有人话出口，缺席接缝不该让整块
    // 设置页少一张卡（那看起来像功能没装）。
    const webSearchSave = useRef<(() => Promise<void>) | undefined>(undefined);
    const [webSearchDirty, setWebSearchDirty] = useState(false);
    const webSearch = useWebSearchPanel(ctx, t, {
      saveRef: webSearchSave,
      onDirty: setWebSearchDirty,
    });

    const usageCard =
      usageReport === undefined && usageStatsProblem === undefined && !usageLoading
        ? undefined
        : UsageCard({
            t,
            window: usageWindow,
            accounts: usageReport?.accounts ?? [],
            total: usageReport?.total ?? {
              window: usageWindow,
              bucket: {
                period: usageWindow,
                since: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                requests: 0,
                ok: 0,
                failed: 0,
              },
              byVendor: [],
            },
            onWindow: setUsageWindow,
            // 清空：先二次确认（不可撤销），成功后立即重读。
            onClear: () => {
              // `confirm` 只在浏览器里有；没有它的环境（测试/非浏览器宿主）一律按「不确认」，
              // 免得一个不可撤销的操作在没有确认框的地方被触发。
              const ask = (globalThis as { confirm?: (message: string) => boolean }).confirm;
              if (typeof ask !== "function" || ask.call(globalThis, t("usage.clearConfirm")) !== true) return;
              const api = usageNamespace(ctx);
              if (api?.usageClear === undefined) return;
              void api.usageClear().then(() => setUsageTick((current) => current + 1));
            },
            ...(usageStatsProblem === undefined ? {} : { failure: usageStatsProblem }),
            ...(usageLoading ? { loading: true } : {}),
            labelOf: (vendor, account) => accountLabelOf(statuses[vendor]?.accounts ?? [], account),
          });

    return PageShell({
      state,
      entries,
      t,
      accounts,
      mergeTabs: true,
      webSearchDirty,
      saving: savingNs === state.activeNs,
      onSelectTab: (ns) => setState((current) => selectTab(current, ns)),
      onSetField: (ns, key, value) => setState((current) => setField(current, ns, key, value)),
      onSave: (ns) => {
        // 一个「保存」同时落两处：网页搜索卡片（独立设置行）与当前厂商字段。
        void webSearchSave.current?.();
        const fields = dirtyFields(state, ns);
        if (fields.length === 0) return;
        setSavingNs(ns);
        // 写**命中的行名**（opencode 的行 id 与命名空间不同，用 ns 会写到一个不存在的条目上）。
        const snapshot = state.snapshots[ns];
        void saveSettings(ctx, snapshot?.row ?? ns, fields, snapshot?.revision ?? 0).then((error) => {
          // 成败都记下来：失败时保存条显示可读原因（此前完全静默 —— 用户以为保存成功了）；
          // 成功即清除。随后一律重读一遍宿主：基线以宿主为准，不猜修订号（紧接着的第二次
          // 保存不会带着猜出来的围栏再次失败），已落盘的草稿条目随之清掉。
          setState((current) => noteSaveResult(current, ns, error));
          setSavingNs(undefined);
          void discoverVendors(ctx, entries).then((discovery) => adopt(discovery));
        });
        // 切换策略 / 自动切换是**全局**设置：在一家保存后把同样的字段镜像到另一家，
        // 两家控制器读各自的文档，但看到的是同一套策略。模型与其余字段不镜像。
        const sharedKeys = new Set([
          "switchStrategy",
          "switchIntervalMinutes",
          "switchAtTurnEnd",
          "autoSwitch",
          "showSidebarQuota",
          "quotaRefreshMinutes",
        ]);
        const shared = fields.filter((field) => sharedKeys.has(field.key));
        if (shared.length > 0) {
          for (const entry of entries) {
            if (entry.ns === ns) continue;
            const other = state.snapshots[entry.ns];
            if (other === undefined) continue;
            void saveSettings(ctx, other.row ?? entry.ns, shared, other.revision).then((otherError) => {
              setState((current) => noteSaveResult(current, entry.ns, otherError));
              void discoverVendors(ctx, entries).then((discovery) => adopt(discovery));
            });
          }
        }
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
                // 挂载失败的原因优先（那时连读口都发不出去），其次是读口本身的报错。
                problem: usageProblem ?? statusProblems[activeVendor],
                settings: state.snapshots[activeEntry.ns]?.value ?? {},
                t,
                action: state.action,
                expandedRef: state.expandedRef,
                login: loginDismissed[activeVendor] === true ? undefined : logins[activeVendor],
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
                  mode: modelWriteModeOf(statuses[activeVendor]),
                  draft: modelDrafts[activeEntry.ns] ?? "",
                  setDraft: (value) => setModelDrafts((current) => ({ ...current, [activeEntry.ns]: value })),
                  filter: modelFilters[activeEntry.ns] ?? "",
                  setFilter: (value) => setModelFilters((current) => ({ ...current, [activeEntry.ns]: value })),
                  catalog: modelCatalogs[activeVendor],
                  catalogLoading: modelCatalogLoading[activeVendor] === true,
                  // 单卡模式的重试同样是按厂商读（与合并面板的账号行刷新同一个动作）。
                  onRetryCatalog: () => refreshVendorCatalog(activeVendor),
                  draftInto: (ns, fields) => setState((current) => fields.reduce((acc, field) => setField(acc, ns, field.key, field.value), current)),
                  writeNow: (ns, fields) => {
                    // 立刻写（`immediate` 能力）：同样写行名；失败不静默 —— 记进保存错误，
                    // 下一次快照重读会让控件回落到已存储的值（用户看得出这次没写进去）。
                    const target = state.snapshots[ns];
                    void saveSettings(ctx, target?.row ?? ns, fields, target?.revision ?? 0).then((error) => {
                      setState((current) => noteSaveResult(current, ns, error));
                      if (error === undefined) setAccountRevision((current) => current + 1);
                      // 重读：基线以宿主为准，已落盘的草稿随之清掉。
                      void discoverVendors(ctx, entries).then((discovery) => adopt(discovery));
                    });
                  },
                }),
                switchState: statuses[activeVendor]?.switchState,
                // 切换面板已不再渲染；这里给一个静态时间，避免整页每秒重渲染。
                now: Date.now(),
                switchNow: () => {
                  if (usage === undefined || typeof usage.switchNow !== "function") return;
                  void usage.switchNow(activeVendor).then(() => setAccountRevision((current) => current + 1));
                },
                // 账号行上的行内登录入口：与合并面板的「网页登录」走同一条路径
                // （同一个占位窗口 / 同一个「正在启动」态 / 同一套失败落地）。
                loginBegin: () => beginLogin(activeVendor),
              }),
          }),
      webSearch,
      ...(usageCard === undefined ? {} : { usage: usageCard }),
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
/**
 * 模型卡片的写模式：来自宿主发布的能力声明 `capabilities.modelVisibilityWrite`。
 *
 * **两级都要判空**（实测 2026-10-17，桌面端 0.2.1-rc.2）：能力声明由本包 host 侧经
 * typert 登记的描述符发布，登记没发生时 `status.capabilities` 整个是 `undefined`。
 * 写成 `statuses[v]?.capabilities.modelVisibilityWrite` 时 `?.` 只挡住了 `statuses[v]`
 * 本身，挡不住它的属性——页面在渲染期抛 `Cannot read properties of undefined`，
 * React 丢弃整棵树，于是**整段设置页变空白**（连标题都没有），极易误判成没注册上。
 *
 * 缺能力时退回最保守的一档：跟保存条走，绝不假装支持立即写。
 * @param status - 宿主发布的厂商状态，可能整体缺席或缺 `capabilities`。
 * @returns 写模式。
 */
export function modelWriteModeOf(status: { capabilities?: { modelVisibilityWrite?: ModelsWriteMode } } | undefined): ModelsWriteMode {
  return status?.capabilities?.modelVisibilityWrite ?? "onSave";
}

function modelCardContext(input: {
  entry: VendorEntry;
  state: PageState;
  mode: ModelsWriteMode;
  draft: string;
  setDraft: (value: string) => void;
  /** 搜索关键词（纯展示）。 */
  filter: string;
  setFilter: (value: string) => void;
  draftInto: (ns: string, fields: readonly { key: string; value: unknown }[]) => void;
  writeNow: (ns: string, fields: readonly { key: string; value: unknown }[]) => void;
  /** 厂商目录（未过滤）；还没读到时为 `undefined`。 */
  catalog: CatalogModelsResult | undefined;
  /** 目录正在读取。 */
  catalogLoading: boolean;
  /** 重新读取目录。 */
  onRetryCatalog: () => void;
}): Pick<
  VendorCardsContext,
  | "cardKinds"
  | "models"
  | "visibleModels"
  | "modelVisibility"
  | "modelInfo"
  | "modelDraft"
  | "modelMode"
  | "setModelDraft"
  | "modelFilter"
  | "setModelFilter"
  | "editModel"
  | "catalogFailure"
  | "catalogLoading"
  | "onRetryCatalog"
> {
  const { entry, state, mode } = input;
  const spec = entry.models;
  // **草稿覆盖基线**：`onSave` 模式下控件必须立刻反映用户刚点的值；只看基线会让勾选看起来
  // 「点了没反应」，直到按保存。连续点两个模型也不能互相覆盖（第二次要以第一次的草稿为底）。
  const baseline = state.snapshots[entry.ns]?.value ?? {};
  const settings = { ...baseline, ...(state.drafts[entry.ns] ?? {}) };
  const visible = spec === undefined ? [] : normalizeModels(settings[spec.visible]);
  const rawVisibility = spec === undefined ? undefined : settings[spec.visibility];
  const modelVisibility =
    typeof rawVisibility === "object" && rawVisibility !== null && !Array.isArray(rawVisibility)
      ? { ...(rawVisibility as Record<string, boolean>) }
      : {};
  // 列表 = 厂商目录 ∪ 白名单 ∪ 显隐表里出现过的模型：
  // - 目录项让「还没配置过的模型」有勾选入口；
  // - 白名单/显隐项让「目录里暂时没有、但用户手工加过」的模型继续可管理；
  // - 显式隐藏了一个不在目录里的模型时，它也看得见（否则没有入口改回来）。
  const catalogIds = (input.catalog?.models ?? []).map((model) => model.id);
  const models = [...new Set([...catalogIds, ...visible, ...Object.keys(modelVisibility)])];
  const modelInfo = Object.fromEntries(
    (input.catalog?.models ?? []).map((model) => [
      model.id,
      {
        ...(model.company === undefined ? {} : { company: model.company }),
        ...(model.free === true ? { free: true } : {}),
      },
    ]),
  );
  const catalogFailure = input.catalog === undefined || input.catalog.failures.length === 0
    ? undefined
    : input.catalog.failures.join("；");

  return {
    cardKinds: vendorCardKinds(entry),
    models,
    visibleModels: visible,
    modelVisibility,
    modelInfo,
    modelDraft: input.draft,
    modelMode: mode,
    setModelDraft: input.setDraft,
    modelFilter: input.filter,
    setModelFilter: input.setFilter,
    ...(catalogFailure === undefined ? {} : { catalogFailure }),
    catalogLoading: input.catalogLoading,
    onRetryCatalog: input.onRetryCatalog,
    editModel: (edit: ModelEdit) => {
      if (spec === undefined) return;
      const patch = applyModelEdit({ visible: settings[spec.visible], visibility: settings[spec.visibility] }, edit);
      const fields = [
        { key: spec.visible, value: patch.visibleModels },
        { key: spec.visibility, value: patch.modelVisibility },
      ];
      // 生效时机由能力声明决定：`onSave` 进草稿（底部保存条提交），`immediate` 立刻写。
      // 两种模式都**先写草稿**：控件立即反映点击；immediate 的落盘成功后重读基线、清掉草稿。
      input.draftInto(entry.ns, fields);
      if (modelEditTarget(mode) === "now") input.writeNow(entry.ns, fields);
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
  // `slots.inject` 会在槽位声明每次变化时重新回调（宿主重开设置、别的插件重新注册
  // —— 插件市场的 section gate 就是反复重注册的）。旧实现丢弃了 `slots.register`
  // 的返回句柄，于是每次回调都追加一份同名卡片，且旧条目不会被撤销。
  let unregister: (() => void) | undefined;
  const disposeAll = (): void => {
    const off = unregister;
    unregister = undefined;
    if (typeof off === "function") off();
  };
  inject(["layout"], (layoutCtx: ClientSeamContext) => {
    try {
      const slots = slotsOf(layoutCtx);
      if (slots === undefined) return;
      slots.inject(SIDEBAR_SLOT, () => {
        // 回调由宿主在每次槽位声明变化时重跑；抛错会被宿主当成致命错误并停掉控制器，
        // 之后卡片再也不出现。自己兜住，让控制器活着等下一次机会。
        try {
          // 先撤销上一条，再注册新的：任何时刻都只有一份。
          disposeAll();
          const off = slots.register(
            {
              name: SIDEBAR_SLOT,
              id: registration.id,
              order: registration.order,
              locale: registration.locale,
              inject: registration.face ?? (() => ({ hooks: {} })),
            },
            registration.component,
          );
          unregister = typeof off === "function" ? (off as () => void) : undefined;
          return off;
        } catch (error) {
          console.error("[dsh-llm-account] could not re-register the sidebar footer card:", error);
          return () => undefined;
        }
      });
    } catch (error) {
      // 与旧插件同一处置：留一行错误，不让整个客户端因为一次注册失败而失效。
      console.error("[dsh-llm-account] could not register the sidebar footer card:", error);
    }
  });
  return disposeAll;
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
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  const minutes = Number.isFinite(parsed) ? parsed : SIDEBAR_POLL_MS / 60_000;
  const clamped = Math.max(1, Math.min(120, minutes));
  return clamped * 60_000;
}

/** 侧边栏轮播的默认间隔（毫秒）：1 分钟。 */
export const SIDEBAR_ROTATE_MS = 60_000;

/**
 * 侧边栏轮播间隔（毫秒），由设置字段 `sidebarRotateMinutes`（分钟）换算而来。
 *
 * 缺省/非法值 1 分钟，夹在 `[1, 60]` 分钟之间：轮播是「看一眼别家」，比刷新间隔更短才有意义，
 * 但低于 1 分钟只会让人眼花（且每切一次都要读一次状态）。
 * @param value - 设置文档里的 `sidebarRotateMinutes`（不可信，按 `unknown` 处理）。
 * @returns 轮播间隔（毫秒）。
 */
export function sidebarRotateMs(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  const minutes = Number.isFinite(parsed) ? parsed : SIDEBAR_ROTATE_MS / 60_000;
  return Math.max(1, Math.min(60, minutes)) * 60_000;
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
    /** 所有开启的厂商（顺序即标签页顺序）：卡片按 `turn` 轮播它们。 */
    const [vendors, setVendors] = useState<string[]>(() => sidebarVendorList());
    const [turn, setTurn] = useState(0);
    const vendor = vendors.length === 0 ? undefined : vendors[turn % vendors.length];
    /**
     * 设置值变化时**重渲染**（让 `refreshKey` 重新计算），从而按新间隔重建控制器。
     *
     * 这里只要 setter：值本身不参与渲染，依赖用 `refreshKey` 的取值而不是修订号 ——
     * 见下面控制器 effect 的注释。
     */
    const [, setSettingsRevision] = useState(0);
    // 一份合并的视图状态：要显示的状态 + 最近一次读的失败 + 是否在显示旧数据。
    // 合成一个 state（而不是三个）是为了让「失败时保留上一份好数据」在一次 setState 里
    // 原子完成 —— 三个各自 set 的中间态会闪一下「有数据但没标过期」。
    const [view, setView] = useState<{ status?: VendorUsageStatus; failure?: string; stale: boolean }>({ stale: false });
    // 渲染期间不重读的两个可变值（引用：不触发渲染，只在读取/排程时被读）。
    const inFlight = useRef(false);
    const failures = useRef(0);
    /** 连续跳过「这一家没有已配置账号」的次数：一轮之内全都没账号时停在最后一家，不空转。 */
    const skips = useRef(0);

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
      if (usage === undefined) {
        // 远程面还没挂上是一次**失败**，不是「还没有请求经过这个账号」—— 静默返回会让卡片
        // 一直停在谎报的空态上（这正是本机实测看到的症状）。
        failures.current += 1;
        setView((current) => ({
          status: current.status,
          failure: usageRemoteProblem(ctx) ?? t("usage.remoteUnavailable"),
          stale: current.status !== undefined,
        }));
        return;
      }
      inFlight.current = true;
      void readStatusDetail(usage, vendor ?? "").then(({ status: next, problem }) => {
        inFlight.current = false;
        if (next === undefined) {
          // 读口调用失败：同样记成失败（附宿主原文），而不是假装「还没有请求」。
          failures.current += 1;
          setView((current) => ({ status: current.status, failure: problem ?? t("usage.failed"), stale: current.status !== undefined }));
          return;
        }
        if (next.failures.length > 0) {
          failures.current += 1;
          // 原文直接交给卡片（`failureText` 在渲染处翻人话，原文留在 data 属性上）：
          // 端点短名（`whoami`）与超时包装在这里不该被压成一句泛泛的「读取失败」。
          const raw = next.failures[0] ?? "";
          // 单个账号的额度读取失败不应该把整张卡片的账号信息清空：状态仍然可用，
          // 失败只作为附加提示；否则侧边栏只剩一个「LLM 账号」标题。
          setView({ status: next, failure: raw, stale: false });
          return;
        }
        // 这一家一个已配置账号都没有：轮播直接跳到下一家，不把「未配置」摆给用户看
        // （2026-10-18 用户要求）。一轮都跳完还找不到，就停在最后一家显示空态。
        const configured = next.accounts.some(
          (account) => typeof account === "object" && account !== null && account.configured === true,
        );
        if (!configured && vendors.length > 1 && skips.current < vendors.length - 1) {
          skips.current += 1;
          setTurn((current) => current + 1);
          return;
        }
        skips.current = 0;
        failures.current = 0;
        // 写回设置页的读数缓存：同一份 `status()` 读数，让「侧边栏开着」时打开设置直接吃最新的那份。
        // 与设置页同一条纪律：只有**完整**的读数进缓存（见 completeReading）。
        if (vendor !== undefined && completeReading(next)) statusReadings.put(vendor, next);
        setView({ status: next, stale: false });
      });
    };

    // 订阅开关存储：设置页里保存（或外部改动设置文档）时，这里随之开关。
    useEffect(() => subscribeSidebarVendors(setVendors), []);
    useEffect(
      () =>
        subscribeSidebarSettings(() => {
          setSettingsRevision((current) => current + 1);
        }),
      [],
    );

    // 轮播：每隔 `sidebarRotateMinutes` 分钟切到下一家。只有一家时完全不排定时器（行为不变）。
    const rotateMs = sidebarRotateMs(sidebarVendorSettings()?.["sidebarRotateMinutes"]);
    /** 两个轮询间隔的取值指纹：只有它们变了才需要重建控制器（读一次新的间隔）。 */
    const refreshKey = `${quotaRefreshMs(sidebarVendorSettings()?.["quotaRefreshMinutes"])}:${rotateMs}`;
    useEffect(() => {
      if (vendors.length <= 1) return;
      const timer = setInterval(() => setTurn((current) => current + 1), rotateMs);
      return () => clearInterval(timer);
    }, [vendors.join(","), rotateMs]);

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
      // 依赖用**间隔的取值**而不是设置的修订号：宿主每次重读设置都会给出新对象，
      // 用修订号会让「打开设置页」白读一次状态（用户看到的「点设置就自己刷新」）。
    }, [vendor, refreshKey]);

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
  // 与 `registerSidebarCard` 同一条生命周期纪律：`slots.inject` 会重复回调，
  // 每次回调都要先撤销上一条，否则会累积多份同 key 的面板。
  let unregister: (() => void) | undefined;
  const disposeAll = (): void => {
    const off = unregister;
    unregister = undefined;
    if (typeof off === "function") off();
  };
  try {
    slots.inject(MAIN_SLOT, () => {
      try {
        disposeAll();
        const off = slots.register(
          {
            name: MAIN_SLOT,
            key: registration.key,
            locale: registration.locale,
            inject: registration.face ?? (() => ({ hooks: {} })),
          },
          registration.component,
        );
        unregister = typeof off === "function" ? (off as () => void) : undefined;
        return off;
      } catch (error) {
        console.error("[dsh-llm-account] could not re-register the centre-column panel:", error);
        return () => undefined;
      }
    });
  } catch (error) {
    // 与侧边栏卡片同一处置：留一行错误，不让整个客户端因为一次注册失败而失效。
    console.error("[dsh-llm-account] could not register the centre-column panel:", error);
  }
  return disposeAll;
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
    const [statuses, setStatuses] = useState<Record<string, VendorUsageStatus | undefined>>({});
    /** 读不到数据时的原因（远程面没挂上 / 读口报错）；`undefined` = 没失败。 */
    const [problem, setProblem] = useState<string | undefined>(undefined);

    const load = (): void => {
      const usage = usageNamespace(ctx);
      if (usage === undefined) {
        // 远程面还没挂上：记原因，别让面板显示「暂无数据」把故障说成空态。
        setProblem(usageRemoteProblem(ctx) ?? t("usage.remoteUnavailable"));
        return;
      }
      void Promise.all(
        entries.map(async (entry) => ({ entry, detail: await readStatusDetail(usage, entry.providerId) })),
      ).then((results) => {
        const nextStatuses: Record<string, VendorUsageStatus | undefined> = {};
        const problems: string[] = [];
        for (const result of results) {
          nextStatuses[result.entry.providerId] = result.detail.status;
          // 成功读数写回设置页缓存：从仪表盘「转到设置」时看到的是同一份（面板刷新也顺带暖缓存）。
          // 与设置页、侧边栏同一条纪律：**不完整**的读数不进缓存（见 completeReading）。
          if (result.detail.status !== undefined && completeReading(result.detail.status)) {
            statusReadings.put(result.entry.providerId, result.detail.status);
          }
          if (result.detail.problem !== undefined) problems.push(result.detail.problem);
        }
        setStatuses(nextStatuses);
        setProblem(problems[0]);
      });
    };

    useEffect(() => {
      load();
      // 远程面挂载完成前读取会落空：挂上时补读一次。
      return onUsageReady(ctx, (namespace) => {
        if (namespace !== undefined) load();
      });
    }, []);

    if (entries.length === 0) {
      return createElement("p", { "data-dashboard-empty": "true", className: CSS_CLASS.empty }, t("dashboard.noData")) as ReactElement;
    }
    return Dashboard({
      t,
      status: statuses[entries[0]!.providerId],
      vendors: entries.map((entry) => ({ label: t(entry.labelKey), status: statuses[entry.providerId] })),
      onClose: () => options.onClose(),
      onRefresh: () => load(),
      failure: problem,
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

/**
 * 设置页**成功读数**的模块级缓存（`reading-cache.ts` 说明来由）。
 *
 * TTL 内重新打开设置直接复用，不重打网络；两个设置页实例（设置节与主栏面板版本）以及侧边栏
 * 写回的读数共享同一份。失效路径：TTL 到期、凭据变更（apply 期的常驻订阅，见
 * {@link startSharedState}）、账号/凭据修订号变化（容器强制现读并覆盖）、手动刷新（绕过缓存
 * 并覆盖）。
 */
export const STATUS_READING_TTL_MS = 60_000;
export const CATALOG_READING_TTL_MS = 300_000;
/**
 * 状态读数的新鲜期：**跟随用户设置的「用量刷新间隔」**。
 *
 * 2026-10-18 用户报障「刷新频率到底有没有用？我每次点设置它都自己刷一遍」。事实是旧的
 * TTL 写死 60 秒、和设置里的 `quotaRefreshMinutes`（默认 1 分钟）无关，改设置只影响侧边栏
 * 轮询。现在缓存新鲜期就是那个设置值：设 10 分钟，10 分钟内重开设置直接吃缓存，不再重打
 * 网络；设 1 分钟，1 分钟后才重读。
 */
let statusReadingTtlMs = STATUS_READING_TTL_MS;
/** 状态读数：只存**成功**的（读失败照旧每次重试 —— 缓存一次瞬时故障会把它假装成事实）。 */
const statusReadings = new ReadingCache<VendorUsageStatus>(() => statusReadingTtlMs);
/** 模型目录：只存完整成功的（`failures` 为空）；部分失败与失败都留给下次重读。 */
const catalogReadings = new ReadingCache<CatalogModelsResult>(CATALOG_READING_TTL_MS);

/**
 * 这份状态读数够格进缓存吗？—— **不完整就不缓存**。
 *
 * 2026-10-18 用户报障「重新点开设置后原来显示的额度信息又不见了」的根因：缓存本意是省一次
 * 网络，但它把**部分失败**的读数也当成功存了下来 —— 一次瞬时故障（端点超时、某个端点坏了）
 * 就此在 60 秒 TTL 里变成「事实」，重开设置吃缓存，额度数字看起来凭空消失。判据：
 * 1. 厂商级没有任何失败项；
 * 2. 每个**已配置**的账号都拿到了非空额度读数（额度缺席、额度自己报失败、一个窗口都没有，
 *    三种都说明这次读得不完整）。
 *
 * 不完整照旧每次重读：下一次要么完整（进缓存），要么还是失败（界面显示那一行中文原因，下次
 * 打开再试）。未配置的账号不参与判定 —— 它没有密钥，本来就没有额度可读。
 * @param status - 一次厂商状态读数。
 * @returns 够格进缓存时为 `true`。
 */
export function completeReading(status: VendorUsageStatus): boolean {
  if (status.failures.length > 0) return false;
  for (const account of status.accounts) {
    // 与账户行同一条纪律：线上 `accounts` 可能混进渲染不了的行（null / 非对象）。
    if (typeof account !== "object" || account === null) continue;
    if (account.configured !== true) continue;
    const quota = account.quota;
    if (quota === undefined || quota.failures.length > 0 || quota.windows.length === 0) return false;
  }
  return true;
}

/** 共享的 usage 远程面（`$mount` 只发一次）。 */
let sharedUsage: UsageRemoteHandle | undefined;

/**
 * 远程面可用性变化的监听者（设置页容器、卡片、面板都挂在这里）。
 *
 * 第二个参数是**挂载失败的原因**：挂载失败时命名空间仍是 `undefined`，与「还在挂载中」
 * 症状完全一样。不把原因一并送来，界面就只能显示一句「账号数据暂不可用」——而本机
 * 实测里让空态自证的原因，永远是同一个：那一句空话本身。
 */
type UsageReadyListener = (namespace: UsageNamespace | undefined, problem?: string) => void;

const usageReadyListeners = new Set<UsageReadyListener>();

/** 造一个不带 `effect` 的委托上下文：重挂不能挂在某一行（可能已卸载）的作用域上。 */
function detachedContext(ctx: ClientSeamContext): ClientSeamContext {
  return {
    // 用 `remoteOf` 读一次并保存快照：`ctx.remote` 是活 getter，直接转发会把「什么时候读」
    // 变成调用方的事，也可能在服务未就绪时抛。
    remote: remoteOf(ctx),
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
  const handle = mountUsageRemote(current === undefined ? ctx : detachedContext(ctx), (namespace, problem) => {
    for (const listener of [...usageReadyListeners]) listener(namespace, problem);
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
 * @param listener - 可用性变化回调（`undefined` = 还没挂上或已卸下；第二参是失败原因）。
 * @returns 退订函数。
 */
export function onUsageReady(ctx: ClientSeamContext, listener: UsageReadyListener): () => void {
  const handle = ensureUsageRemote(ctx);
  listener(handle.namespace(), handle.error());
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

/**
 * usage 远程面**挂载**失败的原因；没失败（或还在挂载中）时为 `undefined`。
 *
 * 与 {@link usageNamespace} 配套：两者都给出「命名空间不可用」这一事实，但只有它能说明
 * 为什么。侧边栏与设置页都靠它把「读不到」从空态里区分出来。
 * @param ctx - 客户端上下文。
 * @returns 可读的失败原因。
 */
export function usageRemoteProblem(ctx: ClientSeamContext): string | undefined {
  return ensureUsageRemote(ctx).error();
}

/** 侧边栏卡片该显示哪一家（providerId）；没有开启的厂商时为 `undefined`。 */
let sidebarVendorValue: string | undefined;

/** 侧边栏要**轮播**的厂商清单（按标签页顺序，只含开启的；见 `sidebarVendorsOf`）。 */
let sidebarVendorsValue: string[] = [];

/** 当前侧边栏厂商的设置文档值（轮询间隔等设置类控件从这里取，见 `quotaRefreshMs`）。 */
let sidebarVendorSettingsValue: Record<string, unknown> | undefined;

/** 存储是否已被一次**非空**的设置读取 seed 过（冷启动兜底的依据）。 */
let sidebarVendorSeededValue = false;

/** 开关存储的监听者（侧边栏卡片与仪表盘容器）。 */
const sidebarVendorListeners = new Set<(vendor: string | undefined) => void>();
/** 设置值变化的监听者（刷新间隔等，即使厂商没变也要让轮询器重排）。 */
const sidebarSettingsListeners = new Set<() => void>();

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

/** 当前要轮播的厂商清单（空数组 = 一家都没开）。 */
export function sidebarVendorList(): string[] {
  return sidebarVendorsValue;
}

/** 「轮播清单」的监听者。 */
const sidebarVendorsListeners = new Set<(vendors: string[]) => void>();

/** 订阅「轮播清单」变化（开关或厂商集合变了）。 */
export function subscribeSidebarVendors(listener: (vendors: string[]) => void): () => void {
  sidebarVendorsListeners.add(listener);
  return () => {
    sidebarVendorsListeners.delete(listener);
  };
}

/** 订阅开关存储变化。 */
export function subscribeSidebarVendor(listener: (vendor: string | undefined) => void): () => void {
  sidebarVendorListeners.add(listener);
  return () => {
    sidebarVendorListeners.delete(listener);
  };
}

/** 订阅设置值变化（刷新间隔等）。 */
export function subscribeSidebarSettings(listener: () => void): () => void {
  sidebarSettingsListeners.add(listener);
  return () => {
    sidebarSettingsListeners.delete(listener);
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
  // 轮播清单：所有开启的厂商（顺序即标签页顺序）。只有一家时卡片行为与从前完全一致。
  const nextVendors = sidebarVendorsOf(entries, map);
  const vendorsChanged =
    nextVendors.length !== sidebarVendorsValue.length ||
    nextVendors.some((item, index) => item !== sidebarVendorsValue[index]);
  sidebarVendorsValue = nextVendors;
  sidebarVendorSeededValue = true;
  // 始终用最新快照刷新设置值：厂商没变但轮询间隔等设置改了也要即时生效（不能因为
  // `vendor === sidebarVendorValue` 提前返回就漏掉这次更新）。
  const nextSettings = entry === undefined ? undefined : map[entry.ns]?.value;
  const settingsChanged = nextSettings !== sidebarVendorSettingsValue;
  sidebarVendorSettingsValue = nextSettings;
  // 设置页缓存的新鲜期跟着「用量刷新间隔」走（同一家：第一家开启的厂商）。
  statusReadingTtlMs = quotaRefreshMs(nextSettings?.["quotaRefreshMinutes"]);
  if (settingsChanged) for (const listener of [...sidebarSettingsListeners]) listener();
  if (vendorsChanged) for (const listener of [...sidebarVendorsListeners]) listener(nextVendors);
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
 * 启动插件级共享状态：usage 远程面 + 设置镜像 + 凭据失效订阅（幂等，两个 profile 行各调一次无副作用）。
 * @param ctx - 客户端上下文（apply 期的那个）。
 * @param entries - 注册表里的厂商声明。
 */
export function startSharedState(ctx: ClientSeamContext, entries: readonly VendorEntry[]): void {
  ensureUsageRemote(ctx);
  startSidebarMirror(ctx, entries);
  watchCredentialInvalidation(ctx);
}

/** 凭据失效订阅是否已建立（apply 期一次）。 */
let credentialWatchStarted = false;

/**
 * 凭据变更时让状态缓存失效。
 *
 * 为什么需要（而不只是容器里的 `subscribeCredentials`）：网页登录可能在设置页**关闭**时完成 ——
 * 那时容器订阅不在场，事件白白过去；重新打开设置若命中 TTL 缓存，就会拿着登录前的旧账号表
 * 当新鲜数据（刚加的账号「消失」最多一分钟）。这个订阅挂在 apply 期（插件生命周期），保证
 * 任何时刻的凭据变更都清掉缓存。
 * @param ctx - 客户端上下文。
 */
function watchCredentialInvalidation(ctx: ClientSeamContext): void {
  if (credentialWatchStarted) return;
  credentialWatchStarted = true;
  subscribeCredentials(ctx, () => {
    statusReadings.clear();
  });
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
  sidebarSettingsListeners.clear();
  sidebarMirrorStarted = false;
  credentialWatchStarted = false;
  statusReadings.clear();
  catalogReadings.clear();
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
  let result: unknown;
  try {
    result = await settings.mutate(row, ops, revision);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  // 宿主契约：宿主侧失败**不 reject**，而是 resolve 成 `{ ok: false, error }`。
  // 不拆信封就会把一次被拒绝的保存当成成功——用户以为存上了，实际没有，
  // 而草稿刷新即丢。这正是 `saveErrors` 这条状态存在的原因。
  const unwrapped = unwrapRemote(result);
  return unwrapped.ok ? undefined : unwrapped.error;
}
