/**
 * Client-side (browser) entry for `dsh-llm-account`.
 *
 * The host GUI loads `lib/client.js` through the DSH module loader
 * (`window.__ModuleLoader__.load`), so this module is a CommonJS-shaped
 * bundle whose host-provided dependencies (`react`, `react/jsx-runtime`,
 * `@deepseek-ai/dsh-client-ui-primitives`) arrive through the loader's
 * injected `require`.
 *
 * Task 1 scope: the real `apply` body — the module-level vendor registry
 * (`./registry`) and every host seam (`./shell`). No UI yet: the page component
 * arrives in Task 4.
 */
import { COPY } from "./copy";
import { createConnectedPage, registerSharedSurfaces, startSharedState, type ClientSeamContext } from "./seams";
import { applyShell, PAGE_LOCALE_NS, VENDORS } from "./shell";

/**
 * Debug counter: how many times the host called `apply` (plan 1c reads it to
 * settle assumption ②, "two rows call `apply` twice"). Re-exported from
 * `./shell`, where the counting actually happens.
 */
export { applyCount } from "./shell";

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
 * `remote.credentials` is **not** listed here, and that is a deliberate choice,
 * not an impossibility — an earlier revision of this comment claimed "no legacy
 * bundle injects a separate `remote.credentials` entry", which is false:
 *  - `@mars-sea/dsh-commandcode-provider/lib/client.js:7764` is
 *    `ctx.inject(["remote.credentials"], (remoteCtx) => ...)`, a **nested**
 *    injection (so it never shows up in that bundle's top-level list), and the
 *    next line reads `remoteCtx.remote.credentials`;
 *  - `dsh-better-sidebar/lib/client.js:29451-29459` lists the dotted sub-service
 *    `"remote.session"` directly in its top-level `inject`, and its comment
 *    records the failure mode: a missing entry throws
 *    `cannot get property "remote.session" without inject` — which, thrown from
 *    a render path, blanks the whole panel.
 *
 * Both spellings are therefore valid host contracts. This package uses the
 * **nested** one: `src/client/shell.ts` arms `["remote.credentials"]` inside
 * `applyShell`. Do not declare a service here that `apply` does not need.
 *
 * **`remote.settings` IS required here** (measured 2026-10-17 on desktop
 * 0.2.1-rc.2). The settings page discovers its vendors through
 * `remote.settings.describe()`; without this entry the service is not bound to
 * the context and the page renders the empty notice — 「没有可显示的厂商」 — with
 * no error anywhere. Cordis throws `cannot get property "remote.settings"
 * without inject` when code touches an un-injected service, but our accessor
 * (`seams.ts` `remoteOf`) deliberately *degrades* instead of throwing, which is
 * right for a missing optional seam and wrong here: it turned a missing inject
 * entry into a silently empty page. Every official bundle that reads settings
 * lists it (`app.asar`: ui-settings, agent-preset, permission presets all carry
 * `"remote.settings"` in `inject`).
 */
export const inject = ["slots", "locale", "remote", "remote.settings"];

/**
 * The one client-plugin body. Runs once per mounted profile row, and both rows
 * share this module instance, so the page is registered only by the first call
 * (see `registerPageOnce` in `./shell`).
 *
 * Composition (single direction, no cycles):
 * `index` → `shell` (slot/locale registration primitives) and
 * `index` → `seams` → `page` → `page-state`. `shell` never imports the page layer;
 * it asks for a component factory and supplies the host-bound `t` itself.
 * @param ctx - the client cordis context.
 */
export function apply(ctx: unknown): void {
  console.debug("[dsh-llm-account] client bundle loaded");
  const seamContext = ctx as ClientSeamContext;
  // 插件级共享状态：usage 远程面单例 + 侧边栏开关的设置镜像。旧插件把这两样都挂在 apply 期
  // （`lib/client.js` 的 `applyClientSurfaces`），不随设置页开闭起落 —— 侧边栏卡片与中栏
  // 面板是独立的 React 根，设置页关掉不该带走它们的数据源。幂等：两行各调一次无副作用。
  startSharedState(seamContext, VENDORS);
  applyShell(ctx, {
    copy: { zh: COPY.zh, en: COPY.en },
    pageComponent: (t) =>
      createConnectedPage({
        entries: VENDORS,
        ctx: seamContext,
        t,
      }),
    // 侧边栏卡片与中栏面板：常驻注册一次（守卫在 shell 里），门控在组件里按已存储的开关做。
    sharedSurfaces: (context, t) =>
      registerSharedSurfaces({
        ctx: context as ClientSeamContext,
        entries: VENDORS,
        t,
        localeNs: PAGE_LOCALE_NS,
      }),
  });
}

