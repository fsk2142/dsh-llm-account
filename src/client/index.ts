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
 * Host client services this plugin needs. Kept in the entry (not only in
 * `package.json` `dsh.client.inject`) because the loader arms these
 * dependencies before calling `apply`.
 */
export const inject = [
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-api-remotes",
];

export function apply(): void {
  // Intentionally empty: this build only proves the browser bundle loads.
  console.debug("[dsh-llm-account] client bundle loaded");
}
