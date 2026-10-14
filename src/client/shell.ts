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
 * The vendors this package hosts.
 *
 * Static data, deliberately: the controller's vendor-discovery ruling
 * (2026-10-14) forbids deriving a vendor from instance identity, because one
 * bundle serves both profile rows. The page still discovers vendors from the
 * settings namespaces that exist (`remote.settings.describe()`); these entries
 * only carry what discovery cannot supply (tab order, locale key).
 *
 * `ns` values mirror `COMMAND_CODE_SETTINGS_NS` / `OPENCODE_SETTINGS_NS`, and
 * `providerId` mirrors `VendorId` (`src/core/adapter.ts`) — kept as literals
 * rather than imported, because `src/vendors/**` and `src/core/**` pull host and
 * SDK dependencies that must never reach the browser bundle.
 */
export const VENDORS: readonly VendorEntry[] = [
  { ns: "llm-commandcode", providerId: "commandcode", order: 12, labelKey: "vendor.commandcode.nav" },
  { ns: "llm-opencode-go", providerId: "dsh-opencode-go", order: 20, labelKey: "vendor.opencodeGo.nav" },
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
 * Whether the one `settings.section` has been registered. Module-level, like the
 * registry: both profile rows share this module instance, so this guard is what
 * turns "two `apply` calls" into exactly one page.
 */
let pageRegistered = false;

/**
 * How many times the host called `apply` (assumption ② in
 * `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md`). Read it from
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
  pageRegistered = false;
  resetRegistry();
}

/**
 * The one client-plugin body. Runs once per mounted profile row.
 * @param rawContext - the client cordis context (typed narrowly on purpose: a
 *   seam reached for through an unmodeled property fails loudly).
 */
export function applyShell(rawContext: unknown): void {
  // The only structural cast in the client layer — the seam types above are our
  // model of the host, and plan 1c is what turns them into measurements.
  const context = rawContext as ClientShell;

  // Vendor metadata first: every instance records the package's vendors, so the
  // registry is populated regardless of how many times `apply` runs.
  for (const vendor of VENDORS) registerVendor(vendor);

  applyCountValue += 1;

  // Only the first instance registers the page, and the guard sits BEFORE
  // `slots.inject`: the second instance never touches the page's slot at all.
  registerPageOnce(context);

  // The credentials service is armed through a NESTED injection, exactly as the
  // legacy commandcode client does it (`lib/client.js:7764-7765`), not through
  // the exported top-level `inject` list. Task 1 has nothing to read yet, so the
  // callback is empty; Task 4 — the first task that calls `remote.credentials` —
  // does its credential work inside here.
  context.inject(["remote.credentials"], () => undefined);
}

/** Check-and-set the page guard, then register the page on the first pass only. */
function registerPageOnce(context: ClientShell): void {
  if (pageRegistered) return;
  pageRegistered = true;
  registerPage(context);
}

/**
 * Register the single `settings.section` page.
 *
 * Shape mirrored from the legacy call sites (header), including the nested
 * `slots.inject(name, () => slots.register(...))` form: the host resolves the
 * "settings.section" slot, and the callback registers our entry into it.
 * @param context - the client context.
 */
function registerPage(context: ClientShell): void {
  context.effect(
    () => context.locale.register(PAGE_LOCALE_NS, PAGE_COPY),
    "dsh-llm-account: page copy",
  );
  context.slots.inject("settings.section", () =>
    context.slots.register(
      {
        name: "settings.section",
        id: PAGE_ID,
        order: PAGE_ORDER,
        /** Legacy shape: `() => ctx.locale.bind(ns)("nav")`. */
        label: () => context.locale.bind(PAGE_LOCALE_NS)("nav"),
        locale: PAGE_LOCALE_NS,
        /** Legacy shape: a factory returning `{ hooks: { ... } }`; Task 4 supplies the hooks. */
        inject: () => ({ hooks: {} }),
      },
      PLACEHOLDER_PAGE,
    ),
  );
}

/**
 * Page copy namespace, as **per-locale dictionaries** (the shape the legacy
 * commandcode page registers, `lib/client.js:7756-7763`).
 *
 * Task 1 has no UI, so this carries only the nav label; the page's full zh/en
 * copy arrives with the page in Task 4 (`src/client/copy.ts`).
 */
const PAGE_COPY: Record<string, Record<string, string>> = {
  zh: { nav: "LLM 账号" },
  en: { nav: "LLM accounts" },
};
