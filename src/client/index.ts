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
import { createElement, type ReactNode } from "react";

import { AccountCard } from "./account-card";
import { COPY } from "./copy";
import { createConnectedPage, type ClientSeamContext, type VendorCardsContext } from "./seams";
import { applyShell, VENDORS } from "./shell";

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
 */
export const inject = ["slots", "locale", "remote"];

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
  applyShell(ctx, {
    copy: { zh: COPY.zh, en: COPY.en },
    pageComponent: (t) =>
      createConnectedPage({
        entries: VENDORS,
        ctx: ctx as ClientSeamContext,
        t,
        // 专属卡片：账户卡片（Task 5）。模型卡片在 T7 接到这里，顺序即规格 §8 的卡片顺序。
        renderVendorCards: (cards) => renderVendorCards(cards),
      }),
  });
}

/**
 * 该厂商的专属卡片。
 *
 * 目前只有账户卡片；**Command Code 与 OpenCode 共用这一张**（数据形状相同：都是 `status().accounts`），
 * 差异全由宿主发布的能力声明驱动（`capabilities.pin`/`browserLogin`/`reorder`），所以不需要两份实现；
 * T6 的排序与 `autoSwitch` 会在 T6 里补上专属于 OpenCode 的那部分。
 * @param cards - 容器递进来的数据与回调。
 * @returns 元素树。
 */
function renderVendorCards(cards: VendorCardsContext): ReactNode {
  return createElement(AccountCard, {
    status: cards.status,
    t: cards.t,
    action: cards.action,
    expandedRef: cards.expandedRef,
    login: cards.login,
    onOpenAction: cards.openAction,
    onActionField: cards.setActionField,
    onConfirmAction: cards.confirmAction,
    onCancelAction: cards.cancelAction,
    onSelect: cards.select,
    onRemove: cards.remove,
    onToggleExpand: cards.toggleExpand,
    onLoginBegin: cards.loginBegin,
  });
}
