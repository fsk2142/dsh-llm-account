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
import { createElement, Fragment, type ReactNode } from "react";

import { AccountCard, type AccountCardProps } from "./account-card";
import { COPY } from "./copy";
import { ModelsCard } from "./models-card";
import { OpenCodeAccountCard } from "./opencode-account-card";
import { createConnectedPage, registerSharedSurfaces, startSharedState, type ClientSeamContext, type VendorCardsContext } from "./seams";
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
        // 专属卡片：账户卡片（Task 5）。模型卡片在 T7 接到这里，顺序即规格 §8 的卡片顺序。
        renderVendorCards: (cards) => renderVendorCards(cards),
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

/**
 * 该厂商的专属卡片。
 *
 * OpenCode 多一层（排序 + `autoSwitch`），因为它有这两项独有语义；其余一切（账号行、额度条、
 * `⋯` 菜单、添加账户）两个厂商共用同一份实现，差异全由宿主发布的能力声明驱动
 * （`capabilities.pin`/`browserLogin`/`reorder`），不重复实现两遍。
 * @param cards - 容器递进来的数据与回调。
 * @returns 元素树。
 */
function renderVendorCards(cards: VendorCardsContext): ReactNode {
  const shared: AccountCardProps = {
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
  };
  const accountCard =
    cards.vendor === "dsh-opencode-go"
      ? createElement(OpenCodeAccountCard, {
          ...shared,
          settings: cards.settings,
          onMove: cards.move,
          onSetAutoSwitch: cards.setAutoSwitch,
        })
      : createElement(AccountCard, shared);
  // 模型卡片：规则在 `vendorCardKinds` 里（可单测）——厂商没声明模型可见性时整张不渲染。
  if (!cards.cardKinds.includes("models")) return accountCard;
  return createElement(Fragment, null, accountCard, modelsCard(cards));
}

/** 模型卡片（T7）；该厂商没声明模型可见性时由调用方跳过。 */
function modelsCard(cards: VendorCardsContext): ReactNode {
  return createElement(ModelsCard, {
    t: cards.t,
    models: cards.models,
    visibility: cards.modelVisibility,
    draft: cards.modelDraft,
    mode: cards.modelMode,
    onToggleModel: (model: string, visible: boolean) => cards.editModel({ kind: "toggle", model, visible }),
    onRemoveModel: (model: string) => cards.editModel({ kind: "remove", model }),
    onDraftChange: cards.setModelDraft,
    onAddModel: (model: string) => cards.editModel({ kind: "add", model }),
  });
}
