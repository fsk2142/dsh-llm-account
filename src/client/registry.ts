/**
 * Client-side **vendor registry** — the module-level singleton shared by every
 * plugin instance of this package.
 *
 * The host loads ONE client bundle (`lib/client.js`, id `dsh-llm-account`) and
 * mounts it once per profile row (`llm-commandcode`, `opencode-go`). Both rows
 * therefore resolve to the same module instance, so a registry declared here is
 * shared by both `apply` calls. That matters for the one `settings.section`
 * page (see `shell.ts`) and for nothing else: per the controller's
 * vendor-discovery ruling, this package cannot tell which vendor a given
 * `apply` call belongs to, so the page discovers vendors from the settings
 * namespaces that exist (`remote.settings.describe()`) and uses this registry
 * only for the vendor metadata that discovery cannot provide (display order,
 * locale key).
 *
 * @module dsh-llm-account/src/client/registry
 */

/** The two provider routes this package hosts (`src/core/adapter.ts` `VendorId`). */
export interface VendorEntry {
  /** Settings namespace — the vendor's stable identity here (`llm-commandcode` / `llm-opencode-go`). */
  ns: string;
  /** Image/model route id (`commandcode` / `dsh-opencode-go`), for later tasks' remote calls. */
  providerId: string;
  /** Page-side tab order (ascending). */
  order: number;
  /** Key into the page's locale namespace for this vendor's tab label. */
  labelKey: string;
}

/** Registrations keyed by settings namespace: a namespace names exactly one vendor. */
const vendorRegistry = new Map<string, VendorEntry>();

/**
 * Register (or update) one vendor. Idempotent by `ns`: a namespace maps to one
 * vendor, so re-registering the same vendor never produces a duplicate entry.
 * @param entry - the vendor metadata.
 */
export function registerVendor(entry: VendorEntry): void {
  vendorRegistry.set(entry.ns, entry);
}

/**
 * The registered vendors, in tab order.
 * @returns a fresh array (callers cannot mutate the registry by accident).
 */
export function vendors(): VendorEntry[] {
  return [...vendorRegistry.values()].sort((left, right) => left.order - right.order);
}

/**
 * Forget every registration.
 *
 * Test isolation hook: the registry is module state, so a test that observes
 * `apply` must start from a known state. Production code never calls it.
 */
export function resetRegistry(): void {
  vendorRegistry.clear();
}
