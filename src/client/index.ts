/**
 * Client-side (browser) entry for `dsh-llm-account`.
 *
 * The host GUI loads `lib/client.js` through the DSH module loader
 * (`window.__ModuleLoader__.load`), so this module is a CommonJS-shaped
 * bundle whose host-provided dependencies (`react`, `react/jsx-runtime`,
 * `@deepseek-ai/dsh-client-ui-primitives`) arrive through the loader's
 * injected `require`.
 *
 * Task 0 scope: the minimal `{ apply, inject }` skeleton only. No slots, no
 * pages, no styles — the account UI is registered by later tasks.
 */

/**
 * Host **client services** this plugin needs, in cordis service-name form.
 *
 * Deliberately NOT the npm module ids listed under `package.json`
 * `dsh.client.inject` — the two lists answer different questions and are
 * expected to differ:
 *  - `package.json` `dsh.client.inject` = host client modules that must be
 *    loaded and available to this bundle;
 *  - this export = the cordis services `apply(ctx)` may touch. The loader
 *    arms exactly these before calling `apply`; touching an unlisted service
 *    throws.
 *
 * Matches the legacy client bundles: `@mars-sea/dsh-commandcode-provider/lib/client.js:8049-8053`
 * exports `["slots", "locale", "remote"]` while its `package.json:32-39` declares the npm ids;
 * `dsh-fpga-workbench/lib/client.js` exports `["slots"]`;
 * `dsh-plugin-save-token/lib/client.js` documents `{ inject: ['slots', 'locale'], apply(ctx) }`.
 *
 * `remote` is the host Remote service (`ctx.remote`); Task 1+ reaches
 * credentials through it. No legacy bundle injects a separate
 * `"remote.credentials"` entry.
 */
export const inject = ["slots", "locale", "remote"];

export function apply(_ctx: unknown): void {
  // Intentionally empty: this build only proves the browser bundle loads.
  console.debug("[dsh-llm-account] client bundle loaded");
}
