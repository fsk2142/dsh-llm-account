/**
 * The client seam layer — every unverified host call shape lives here and
 * nowhere else (plan Review Focus 5). When plan 1c measures the real host, only
 * this file changes.
 *
 * Call shapes are mirrored from the legacy plugins' compiled client bundles:
 * - `settings.section` registration + `hooks` mapping factory:
 *   `@mars-sea/dsh-commandcode-provider/lib/client.js:7970-7977` (id `commandcode`,
 *   order 12, `label: () => ctx.locale.bind(ns)("nav")`, `inject: () => ({ hooks: {...} })`),
 *   `dsh-better-sidebar/lib/client.js:29695-29704`.
 * - nested service injection (`ctx.inject(["remote.credentials"], (remoteCtx) => ...)`
 *   then `remoteCtx.remote.credentials`): commandcode client, lines 7764-7765.
 * - dot-form service name in the top-level list (`"remote.session"`):
 *   `dsh-better-sidebar/lib/client.js:29451-29459`, whose comment records the
 *   failure mode: a missing inject entry throws
 *   `cannot get property "remote.session" without inject`.
 *
 * @module dsh-llm-account/src/client/shell
 */
import { injectPluginCss, PAGE_CSS, PAGE_CSS_ID } from "./css";
import { FEATURE_TAB_NS, FEATURE_TAB_PROVIDER } from "./page-state";
import { registerVendor, resetRegistry, type VendorEntry } from "./registry";

/** One page locale namespace for the whole unified page (`settings.llm-account`). */
export const PAGE_LOCALE_NS = "settings.llm-account";

/** The single `settings.section` this package registers. */
export const PAGE_ID = "llm-account";

/**
 * Nav order for the unified page (legacy: commandcode 12, better-sidebar 100;
 * this page replaces commandcode's, so it keeps commandcode's slot).
 */
export const PAGE_ORDER = 12;

/**
 * The vendors this package hosts, with the generic field cards each one declares.
 *
 * Static data, deliberately: the controller's vendor-discovery ruling
 * (2026-10-14) forbids deriving a vendor from instance identity, because one
 * bundle serves both profile rows. The page still discovers vendors from the
 * settings namespaces that exist (`remote.settings.describe()`); these entries
 * only carry what discovery cannot supply (tab order, locale key, card fields).
 *
 * Field keys are the **real** settings-document fields from each vendor's own
 * Config schema (`src/vendors/commandcode/index.ts` / `opencode/index.ts`) — the
 * page must not invent settings the host cannot persist:
 * - commandcode declares `showSidebarQuota` (integrations; `default(false)`) and
 *   `apiBase` / `protocol` / `requestTimeoutMs` / `streamIdleTimeoutMs` /
 *   `defaultMaxTokens` (advanced);
 * - opencode declares `showSidebarQuota` (integrations) and `baseURL` /
 *   `requestTimeoutMs` / `streamIdleTimeoutMs` (advanced);
 * - opendesign declares `showSidebarQuota` / `quotaRefreshMinutes` / `workspaceId`
 *   (integrations) and `baseURL` / `walletBase` / `requestTimeoutMs` /
 *   `streamIdleTimeoutMs` (advanced) — 2026-10-18 第三家，施工单
 *   `docs/vendors.md` §3.3。
 *
 * **No privacy group for either vendor** (Ruling 23): plan 1a deliberately left
 * `zdr` and `webSearch` out of the commandcode Config schema (see that entry's
 * module header), so there is no field to render and the group stays hidden. When
 * those fields arrive, declaring them here lights the card up with no page change.
 *
 * `ns` values mirror `COMMAND_CODE_SETTINGS_NS` / `OPENCODE_SETTINGS_NS`, and
 * `providerId` mirrors `VendorId` (`src/core/adapter.ts`) — kept as literals
 * rather than imported, because `src/vendors/**` and `src/core/**` pull host and
 * SDK dependencies that must never reach the browser bundle.
 */
export const VENDORS: readonly VendorEntry[] = [
  {
    ns: "llm-commandcode",
    rowIds: ["llm-commandcode"],
    providerId: "commandcode",
    order: 12,
    labelKey: "vendor.commandcode",
    models: { visible: "visibleModels", visibility: "modelVisibility", removed: "removedModels" },
    cards: [
      {
        group: "integrations",
        fields: [
          {
            key: "showSidebarQuota",
            kind: "boolean",
            labelKey: "field.showSidebarQuota",
            hintKey: "field.showSidebarQuota.hint",
            fallback: false,
          },
          {
            key: "quotaRefreshMinutes",
            kind: "number",
            labelKey: "field.quotaRefreshMinutes",
            hintKey: "field.quotaRefreshMinutes.hint",
            // 与各自 Config 的 `default(1)` 对齐：宿主文档没给这个字段时，页面按 1 分钟显示，
            // 而不是空白或 undefined（用户没配过就该看到与旧插件一致的 1 分钟体验）。
            fallback: 1,
          },
          {
            key: "autoSwitchModelOnQuota",
            kind: "boolean",
            labelKey: "field.autoSwitchModelOnQuota",
            hintKey: "field.autoSwitchModelOnQuota.hint",
            // 与 Config 的 `default(false)` 对齐：默认**不**自动换模型。
            fallback: false,
          },
        ],
      },
      {
        group: "advanced",
        fields: [
          { key: "apiBase", kind: "text", labelKey: "field.apiBase", hintKey: "field.apiBase.hint" },
          {
            key: "protocol",
            kind: "select",
            labelKey: "field.protocol",
            hintKey: "field.protocol.hint",
            options: [
              { value: "openai", labelKey: "options.openai" },
              { value: "messages", labelKey: "options.messages" },
              { value: "cli", labelKey: "options.cli" },
            ],
          },
          {
            key: "requestTimeoutMs",
            kind: "number",
            labelKey: "field.requestTimeoutMs",
            hintKey: "field.requestTimeoutMs.hint",
          },
          {
            key: "streamIdleTimeoutMs",
            kind: "number",
            labelKey: "field.streamIdleTimeoutMs",
            hintKey: "field.streamIdleTimeoutMs.hint",
          },
          {
            key: "defaultMaxTokens",
            kind: "number",
            labelKey: "field.defaultMaxTokens",
            hintKey: "field.defaultMaxTokens.hint",
          },
        ],
      },
    ],
  },
  {
    ns: "llm-opencode-go",
    // 行 id 与核心命名空间**不同**（宿主侧 `SETTINGS_ROWS = ["opencode-go", "llm-opencode-go"]`）。
    rowIds: ["opencode-go", "llm-opencode-go"],
    providerId: "dsh-opencode-go",
    order: 20,
    labelKey: "vendor.opencodeGo",
    models: { visible: "visibleModels", visibility: "modelVisibility", removed: "removedModels" },
    cards: [
      {
        group: "integrations",
        fields: [
          {
            key: "showSidebarQuota",
            kind: "boolean",
            labelKey: "field.showSidebarQuota",
            hintKey: "field.showSidebarQuota.hint",
            fallback: false,
          },
          {
            key: "quotaRefreshMinutes",
            kind: "number",
            labelKey: "field.quotaRefreshMinutes",
            hintKey: "field.quotaRefreshMinutes.hint",
            // 与各自 Config 的 `default(1)` 对齐：宿主文档没给这个字段时，页面按 1 分钟显示，
            // 而不是空白或 undefined（用户没配过就该看到与旧插件一致的 1 分钟体验）。
            fallback: 1,
          },
          {
            key: "autoSwitchModelOnQuota",
            kind: "boolean",
            labelKey: "field.autoSwitchModelOnQuota",
            hintKey: "field.autoSwitchModelOnQuota.hint",
            // 与 Config 的 `default(false)` 对齐：默认**不**自动换模型。
            fallback: false,
          },
          // **刻意不声明 `usageDisplay`**（自动/常驻/关闭）：那个三模式开关属于参考插件的
          // **会话内用量胶囊**，而胶囊是本期声明不做的东西（`vendors/opencode/index.ts`
          // 模块头的非目标清单）。在页面上放一个没有任何代码读取的开关，就是把「看起来
          // 能配、其实无效」的控件卖给用户 —— 用户拨到「常驻」什么都不会发生。
          // 字段本身仍留在 opencode 的 Config schema 里（存量 profile patch 兼容），
          // 只是不从本页提供编辑入口。
        ],
      },
      {
        group: "advanced",
        fields: [
          { key: "baseURL", kind: "text", labelKey: "field.baseURL", hintKey: "field.baseURL.hint" },
          {
            key: "requestTimeoutMs",
            kind: "number",
            labelKey: "field.requestTimeoutMs",
            hintKey: "field.requestTimeoutMs.hint",
          },
          {
            key: "streamIdleTimeoutMs",
            kind: "number",
            labelKey: "field.streamIdleTimeoutMs",
            hintKey: "field.streamIdleTimeoutMs.hint",
          },
        ],
      },
    ],
  },
  {
    ns: "llm-opendesign",
    // 行 id 与命名空间**不同**（宿主侧 `SETTINGS_ROWS = ["opendesign", "llm-opendesign"]`）。
    rowIds: ["opendesign", "llm-opendesign"],
    providerId: "opendesign",
    order: 30,
    labelKey: "vendor.opendesign",
    models: { visible: "visibleModels", visibility: "modelVisibility", removed: "removedModels" },
    cards: [
      {
        group: "integrations",
        fields: [
          {
            key: "showSidebarQuota",
            kind: "boolean",
            labelKey: "field.showSidebarQuota",
            hintKey: "field.showSidebarQuota.hint",
            fallback: false,
          },
          {
            key: "quotaRefreshMinutes",
            kind: "number",
            labelKey: "field.quotaRefreshMinutes",
            hintKey: "field.quotaRefreshMinutes.hint",
            // 与 Config 的 `default(1)` 对齐（见 commandcode 条目同款注释）。
            fallback: 1,
          },
          {
            key: "autoSwitchModelOnQuota",
            kind: "boolean",
            labelKey: "field.autoSwitchModelOnQuota",
            hintKey: "field.autoSwitchModelOnQuota.hint",
            // 与 Config 的 default(false) 对齐：默认不自动换模型。
            fallback: false,
          },
          {
            key: "workspaceId",
            kind: "text",
            labelKey: "field.workspaceId",
            hintKey: "field.workspaceId.hint",
          },
        ],
      },
      {
        group: "advanced",
        fields: [
          { key: "baseURL", kind: "text", labelKey: "field.baseURL", hintKey: "field.baseURL.hint" },
          // 控制面（额度/账单）基地址；与推理基地址分开是因为它们是两个域名。
          { key: "walletBase", kind: "text", labelKey: "field.walletBase", hintKey: "field.walletBase.hint" },
          {
            key: "requestTimeoutMs",
            kind: "number",
            labelKey: "field.requestTimeoutMs",
            hintKey: "field.requestTimeoutMs.hint",
          },
          {
            key: "streamIdleTimeoutMs",
            kind: "number",
            labelKey: "field.streamIdleTimeoutMs",
            hintKey: "field.streamIdleTimeoutMs.hint",
          },
        ],
      },
    ],
  },
  // —— 功能页（跨厂商）：切换策略 + 网页搜索 ——
  //
  // 它**不是**一家厂商：`providerId` 是虚拟值、`rowIds` 指向承载行（本插件的
  // `llm-commandcode` 配置行）。这两台功能与「用哪家网关」无关，所以单独一张选项卡，
  // 每台都能用 `featureSwitchEnabled` / `featureSearchEnabled` 整块隐藏。
  //
  // 容器里所有「按厂商做什么」的路径必须排除它（读状态、读目录、账号表）——
  // 它没有额度、没有模型、没有账号。见 `seams.ts` 的 `availableEntries`。
  {
    ns: FEATURE_TAB_NS,
    rowIds: ["llm-commandcode"],
    providerId: FEATURE_TAB_PROVIDER,
    order: 9_999,
    labelKey: "vendor.features",
    cards: [
      {
        group: "switch",
        fields: [
          // 2026-10-20 用户去掉了「启用自动切换 / 开启网页搜索」两个界面开关：
          // 卡片本来就能用箭头收起，多一个开关反而让人误以为关掉会禁用功能。
          // —— 自动继续（两台开关，默认都关）——
          {
            key: "autoContinueOnError",
            kind: "boolean",
            labelKey: "field.autoContinueOnError",
            hintKey: "field.autoContinueOnError.hint",
            // 默认关：自动重试会改变对话内容、也可能烧额度。
            fallback: false,
          },
          {
            key: "autoContinueOnTruncate",
            kind: "boolean",
            labelKey: "field.autoContinueOnTruncate",
            hintKey: "field.autoContinueOnTruncate.hint",
            fallback: false,
          },
          {
            key: "autoContinueMaxAttempts",
            kind: "number",
            labelKey: "field.autoContinueMaxAttempts",
            hintKey: "field.autoContinueMaxAttempts.hint",
            fallback: 3,
          },
          // —— 搜索 ——
          {
            key: "searchStrategy",
            kind: "select",
            labelKey: "field.searchStrategy",
            hintKey: "field.searchStrategy.hint",
            // 两条路的成本结构不同（网关路按 token、API 路按请求次数），让用户选。
            options: [
              { value: "gateway-first", labelKey: "options.searchGatewayFirst" },
              { value: "api-first", labelKey: "options.searchApiFirst" },
              { value: "gateway-only", labelKey: "options.searchGatewayOnly" },
              { value: "api-only", labelKey: "options.searchApiOnly" },
              // 需求：下拉里要有「不使用网页搜索」。
              { value: "off", labelKey: "options.searchOff" },
            ],
            fallback: "gateway-first",
          },
        ],
      },
    ],
  },
];

/** A slot registration as the host receives it (legacy: `{ name, id, order, label, locale, inject }`). */
export interface PageRegistration {
  name: string;
  id: string;
  order: number;
  label: () => string;
  locale: string;
  /** The `hooks` mapping factory the page reads its data through (Task 4 fills the hooks in). */
  inject: () => { hooks: Record<string, unknown> };
}

/** Host slots service: `ctx.slots` (only the two call shapes this package uses). */
export interface SlotsService {
  inject(slotName: string, callback: () => unknown): unknown;
  register(registration: PageRegistration, component: PlaceholderComponent): unknown;
}

/** Host locale service: `ctx.locale`. */
export interface LocaleService {
  /**
   * Register one namespace's **per-locale dictionaries** and return the disposer.
   *
   * The payload is keyed by locale, and each dictionary holds the message keys:
   * `@mars-sea/dsh-commandcode-provider/lib/client.js:7756-7763` is
   * `ctx.locale.register("settings.commandcode", { zh, en })`, where `zh`/`en`
   * are flat key→string maps. A flat `{ nav: "…" }` payload is therefore wrong:
   * it registers a locale literally named `nav`, and `bind(ns)("nav")` has
   * nothing to resolve.
   *
   * Alternative spelling, also installed on this machine:
   * `dsh-better-sidebar/lib/client.js:29474-29475` calls the 3-arg form
   * `register(ns, "zh", dict)` once per locale. Which one the 0.2.0 desktop host
   * accepts is an unverified seam — plan 1c decides, and only this layer changes.
   */
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown;
  bind(namespace: string): (key: string) => string;
}

/**
 * Host-provided module table: `register` receives the React component type Task 4
 * supplies. Until then the placeholder below stands in.
 */
type PlaceholderComponent = () => null;

/**
 * React stand-in for the page component. Deliberately does not import
 * `react`: Task 4 replaces it with the real component, and an unused value
 * import would put React into the bundle's dependency list for nothing.
 */
const PLACEHOLDER_PAGE: PlaceholderComponent = () => null;

/** The client context surface this module touches. Everything else is unreachable by construction. */
export interface ClientShell {
  slots: SlotsService;
  locale: LocaleService;
  /**
   * The host Remote service. Listed because `index.ts` injects it, but read by
   * nothing in Task 1 — the page's settings/credential reads (Task 4) are the
   * first consumer, through the nested `remote.credentials` injection below.
   */
  remote: unknown;
  /** `ctx.effect(callback, label)`: runs `callback` in the plugin's scope and keeps its disposer. */
  effect(callback: () => unknown, label?: string): unknown;
  /** `ctx.inject(serviceNames, callback)`: runs `callback` once the named services exist. */
  inject(serviceNames: readonly string[], callback: (scoped: ClientShell) => unknown): unknown;
}

/** `apply` invocations observed so far — the debug counter plan 1c reads. */
let applyCountValue = 0;

/**
 * 已经**在本轮激活里**注册过页面的宿主上下文。
 *
 * 为什么用 `WeakSet` 而不是布尔值、也不是「记住最后一个 ctx」：
 * - 布尔值永不复位 → 宿主刷新 / 重新激活后第二次 `apply` 直接 return，页面永久消失
 *   （2026-10-19 报障的根因）；
 * - 「记住最后一个 ctx」也不够：宿主可能同时持有多个 ctx（两行各一个），判重只在
 *   **同一个 ctx** 内成立。
 *
 * `WeakSet` 正好表达这个语义：同一个 ctx 只注册一次；换了新 ctx 自动视为未注册。
 * 用 WeakSet 而非 Set，是为了不让宿主上下文被我们长期持有（避免内存泄漏）。
 */
let pageRegisteredFor = new WeakSet<object>();

/** 已经在本轮激活里注册过侧边栏卡片 / 中栏面板的宿主上下文（理由同 {@link pageRegisteredFor}）。 */
let sharedSurfacesRegisteredFor = new WeakSet<object>();

/**
 * How many times the host called `apply` (assumption ② in
 * `docs/operations.md`). Read it from
 * the browser console (`dsh-llm-account`), or assert it here.
 * @returns the current count.
 */
export function applyCount(): number {
  return applyCountValue;
}

/**
 * Forget every client-side registration and reset the debug counter.
 *
 * Test isolation hook (the counter and the page guard are module state, so a
 * test that drives `apply` twice must start from a known state). Production code
 * never calls it — the host mounts the plugin once per page load.
 */
export function resetShell(): void {
  applyCountValue = 0;
  resetRegistry();
}

/**
 * 注册页面时可注入的两件东西（由 `index.ts` 组合，避免本层依赖 `seams.ts`/`page.ts`）。
 *
 * 为什么用「工厂」而不是直接给组件：页面需要**宿主绑定的取词函数**（`ctx.locale.bind(ns)`），
 * 而它只有本层拿得到；`index.ts` 拿到 `t` 之后再去构造容器组件（`createConnectedPage`）。
 * 这样分层是单向的：`index` → `shell` → 宿主，`index` → `seams` → `page` → `page-state`。
 */
export interface ApplyShellOptions {
  /**
   * 页面组件工厂：收到宿主的取词函数，返回要注册进 `settings.section` 的组件。
   * 缺省用占位组件（返回 `null`）——那只是为了在没有页面实现时也能验证注册路径。
   */
  pageComponent?: (t: (key: string) => string) => unknown;
  /** 页面文案字典（`{ zh, en }`）；缺省只有内置的 `nav`。 */
  copy?: Record<string, Record<string, string>>;
  /**
   * 侧边栏卡片与中栏面板的注册工厂（T8/T9 的常驻插槽）。
   *
   * **无条件、每个 bundle 一次**（与页面同样只有第一个实例注册）：插槽服务不返回注销句柄，
   * 条件注册一旦开启就撤不下来，所以门控放在组件里按**已存储**的开关做（旧插件
   * `CommandCodeFooterEntry` 的同一条判定）。两行各调一次 `apply` 也只注册一份。
   *
   */
  sharedSurfaces?: (context: ClientShell, t: (key: string) => string) => void;
}

/**
 * The one client-plugin body. Runs once per mounted profile row.
 * @param rawContext - the client cordis context (typed narrowly on purpose: a
 *   seam reached for through an unmodeled property fails loudly).
 * @param options - page component factory and copy (see {@link ApplyShellOptions}).
 */
export function applyShell(rawContext: unknown, options: ApplyShellOptions = {}): void {
  // The only structural cast in the client layer — the seam types above are our
  // model of the host, and plan 1c is what turns them into measurements.
  const context = rawContext as ClientShell;

  // 样式表注入（幂等：同 id 已存在就什么都不做），与旧插件同一形状（`lib/client.js:8809-8818`）。
  // 幂等由 `data-plugin-css` 属性保证，两行各调一次也只注入一份。
  injectPluginCss(PAGE_CSS_ID, PAGE_CSS);

  // Vendor metadata first: every instance records the package's vendors, so the
  // registry is populated regardless of how many times `apply` runs.
  for (const vendor of VENDORS) registerVendor(vendor);

  applyCountValue += 1;

  // Only the first instance registers the page, and the guard sits BEFORE
  // `slots.inject`: the second instance never touches the page's slot at all.
  registerPageOnce(context, options);

  // 侧边栏卡片与中栏面板：同样只注册一次（守卫同形）。注册是**无条件**的 —— 门控在组件里
  // 按已存储的开关做，见 {@link ApplyShellOptions.sharedSurfaces}。
  registerSharedSurfacesOnce(context, options);

  // The credentials service is armed through a NESTED injection, exactly as the
  // legacy commandcode client does it (`lib/client.js:7764-7765`), not through
  // the exported top-level `inject` list. The credential-reading work of Task 4+
  // lives inside this callback; here it only proves the service is reachable.
  context.inject(["remote.credentials"], () => undefined);
}

/**
 * 注册页面。
 *
 * **没有外层"只注册一次"的守卫**，这是 2026-10-19「刷新后设置页消失」的最终修法。
 *
 * 历史：这里原来有一个模块级布尔 `pageRegistered`，后来又改成"按上下文对象记"。
 * 两次都错在同一个前提上 —— 那个守卫想在 `apply` 层面去重，但**去重本来就该发生在
 * 注册内部**：`registerPage` 自己会先撤销上一条再注册（`registered?.()`），所以重复
 * 调用是幂等的、安全的。而外层守卫一旦判"已经注册过"，在宿主重建（刷新 / 重新激活）
 * 时就再也不会重新注册 —— 页面直接消失。
 *
 * 结论：让每次 `apply` 都走一遍幂等注册，比任何形式的"记住注册过"都正确。
 * @param context - 这次激活的宿主上下文。
 * @param options - 页面工厂与文案。
 */
function registerPageOnce(context: ClientShell, options: ApplyShellOptions): void {
  if (pageRegisteredFor.has(context)) return;
  try {
    registerPage(context, options);
    pageRegisteredFor.add(context);
  } catch (error) {
    // 与两个插槽注册同样的处置（旧插件在 `main`/`sidebar.footer.action` 上就是这么做的）：
    // 留一行错误继续走完 `apply` —— 后面的凭据注入与 applyCount 不该因为一次注册失败而丢掉。
    // 失败时**不记录**这个 ctx：下一次还有机会。
    console.error("[dsh-llm-account] could not register the settings page:", error);
  }
}

/**
 * 侧边栏卡片与中栏面板（同样**不加外层守卫**，理由见 {@link registerPageOnce}）。
 *
 * `registerSharedSurfaces` 内部同样是「先撤销再注册」，所以重复调用幂等。
 * @param context - 这次激活的宿主上下文。
 * @param options - 注册工厂。
 */
function registerSharedSurfacesOnce(context: ClientShell, options: ApplyShellOptions): void {
  if (sharedSurfacesRegisteredFor.has(context)) return;
  try {
    options.sharedSurfaces?.(context, context.locale.bind(PAGE_LOCALE_NS));
    sharedSurfacesRegisteredFor.add(context);
  } catch (error) {
    // 与页面注册同样的处置：一次注册失败不该把整个客户端带走。
    console.error("[dsh-llm-account] could not register the sidebar card and the usage panel:", error);
  }
}


/**
 * Register the single `settings.section` page.
 *
 * Shape mirrored from the legacy call sites (header), including the nested
 * `slots.inject(name, () => slots.register(...))` form: the host resolves the
 * "settings.section" slot, and the callback registers our entry into it.
 * @param context - the client context.
 * @param options - page component factory and copy (see {@link ApplyShellOptions}).
 */
function registerPage(context: ClientShell, options: ApplyShellOptions): void {
  const t = context.locale.bind(PAGE_LOCALE_NS);
  /**
   * 文案注册**必须先撤销上一条**。
   *
   * 宿主的 `locale.register` 对同一命名空间的**同一 locale 会直接抛错**
   * （`dsh-client-locale`：`if (locales.has(localeKey(locale))) throw new Error(...)`）。
   * 而 `ctx.effect(cb)` 的 cb 在插件重新激活时会再跑一次 —— 于是第二次注册就抛，
   * 整个 `apply` 被炸掉，表现是**刷新一次设置页就不见了**（2026-10-19 报障）。
   */
  let unregisterCopy: (() => void) | undefined;
  context.effect(
    () => {
      // 文案注册失败**不能连累页面注册**：宿主对同一 namespace 的同一 locale 会直接抛错
      // （`already has locale`），而刷新/热重载可能让旧注册还在。文案缺了只是显示 key，
      // 页面不注册则是「整个设置页消失」—— 两者严重程度差一个量级。
      try {
        unregisterCopy?.();
        const off = context.locale.register(PAGE_LOCALE_NS, options.copy ?? PAGE_COPY);
        unregisterCopy = typeof off === "function" ? (off as () => void) : undefined;
      } catch (error) {
        console.warn("[dsh-llm-account] could not register the page copy:", error);
      }
      return () => {
        unregisterCopy?.();
        unregisterCopy = undefined;
      };
    },
    "dsh-llm-account: page copy",
  );
  const component = options.pageComponent?.(t) ?? PLACEHOLDER_PAGE;
  /**
   * 上一次注册的撤销句柄。
   *
   * 宿主的 `slots.inject(name, cb)` 会在**每次槽位可用时**回调（设置对话框重开、其它插件
   * 重新注册都可能再触发一次）。以前这里直接 discard 了 `register` 的返回值，于是每次回调都
   * 追加一条同名 section；一旦宿主按句柄失效旧条目，点我们的 tab 就「打不开」
   * （2026-10-18 报障：打开插件市场后我们的设置打不开 —— 市场自己就是靠 gate 反复重注册的）。
   * 现在：注册前先撤销上一条，并把撤销挂到 fiber 上随插件卸载收尾。
   */
  let registered: (() => void) | undefined;
  context.effect(
    () => () => {
      registered?.();
      registered = undefined;
    },
    "dsh-llm-account: settings section",
  );
  context.slots.inject("settings.section", () => {
    // 这个回调由宿主在**每次槽位声明变化**时重跑（其它插件反复注册/撤销，设置对话框重开）。
    // 一旦回调抛错，宿主会把我们的 inject 控制器整体停掉 —— 之后永远不再回调，设置页也就
    // 再也不出现（y 表现为「打开插件市场后我们的设置打不开」）。所以这里自己兜住：
    // 记一行错误、返回空注销函数，让控制器活着等下一次机会。
    try {
      registered?.();
      registered = undefined;
      const off = context.slots.register(
        {
          name: "settings.section",
          id: PAGE_ID,
          order: PAGE_ORDER,
          /** Legacy shape: `() => ctx.locale.bind(ns)("nav")`. */
          label: () => t("nav"),
          locale: PAGE_LOCALE_NS,
          /** Legacy shape: a factory returning `{ hooks: { ... } }`. */
          inject: () => ({ hooks: {} }),
        },
        component as PlaceholderComponent,
      );
      registered = typeof off === "function" ? (off as () => void) : undefined;
      return off;
    } catch (error) {
      console.error("[dsh-llm-account] could not register the settings section (will retry on the next slot change):", error);
      return () => undefined;
    }
  });
}

/**
 * Page copy namespace, as **per-locale dictionaries** (the shape the legacy
 * commandcode page registers, `lib/client.js:7756-7763`).
 *
 * Fallback only: `index.ts` passes the full dictionaries from `copy.ts`. This
 * carries just the nav label so a bare `applyShell` (tests, or a host without the
 * page) still registers a labelled entry.
 */
const PAGE_COPY: Record<string, Record<string, string>> = {
  zh: { nav: "LLM 账号" },
  en: { nav: "LLM accounts" },
};
