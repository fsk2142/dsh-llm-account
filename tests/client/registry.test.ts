/**
 * Task 1 tests: the client plugin skeleton — module-level vendor registry,
 * single `settings.section` registration, and the debug `apply` counter.
 *
 * The host loads this package's ONE client bundle once and mounts it once per
 * profile row, so `apply` may run twice against the same module instance. These
 * tests drive that shape with a fake client context (no browser, no host): the
 * seams are the call shapes recorded in
 * `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md` §3 and mirrored
 * from the legacy bundles (file:line cited in `src/client/shell.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apply, applyCount, inject } from "../../src/client/index";
import { registerVendor, vendors } from "../../src/client/registry";
import { resetShell } from "../../src/client/shell";

/** A `settings.section` registration as the fake host captures it. */
interface RecordedSection {
  name: string;
  id?: string;
  key?: string;
  order?: number;
  label: unknown;
  locale: unknown;
  inject: unknown;
}

/** Fake `ctx.slots`: resolves the one owned slot eagerly, like the host loader. */
function createSlots() {
  const registrations: RecordedSection[] = [];
  const register = vi.fn((registration: RecordedSection, component: unknown) => {
    registrations.push(registration);
    return { registration, component };
  });
  const inject = vi.fn((_slotName: string, callback: () => unknown) => callback());
  return { slots: { register, inject }, register, inject, registrations };
}

/**
 * Fake client context: only the cordis services this package injects. A missing
 * service is therefore not silently tolerated — a seam that reaches for
 * something else throws a `TypeError` here.
 */
function createClientContext() {
  const owned = createSlots();
  const localeNamespaces = new Map<string, Record<string, unknown>>();
  const injectedServices: string[][] = [];
  return {
    context: {
      slots: owned.slots,
      locale: {
        register: vi.fn((namespace: string, messages: Record<string, unknown>) => {
          localeNamespaces.set(namespace, messages);
          return () => localeNamespaces.delete(namespace);
        }),
        bind: vi.fn((namespace: string) => (key: string) => `${namespace}.${key}`),
      },
      remote: {},
      effect: vi.fn((callback: () => unknown) => callback()),
      inject: vi.fn((serviceNames: readonly string[], callback: (scoped: unknown) => unknown) => {
        injectedServices.push([...serviceNames]);
        return callback({});
      }),
    },
    ...owned,
    localeNamespaces,
    injectedServices,
  };
}

describe("client plugin skeleton", () => {
  beforeEach(() => {
    resetShell();
  });

  it("同一包多个实例注册进同一个注册表，且只注册一次设置页", () => {
    const harness = createClientContext();
    const shared = harness.context;

    // Simulate the profile rows mounting the same client bundle.
    const beforeApply = applyCount();
    apply(shared);
    apply(shared);

    // Registry: the package knows all three of its vendors **plus the feature page**,
    // and two `apply` calls do not produce duplicates (metadata is static — instance
    // identity cannot be read, per the controller's vendor-discovery ruling).
    //
    // 功能页（切换与搜索）也是一条注册项，所以这里期望四条；它排在最后，
    // 且它的 ns 不是厂商命名空间（`entries` 里靠它渲染那张选项卡）。
    expect(vendors().map((vendor) => vendor.ns)).toEqual([
      "llm-commandcode",
      "llm-opencode-go",
      "llm-opendesign",
      "llm-account-features",
    ]);

    // Page: exactly ONE `settings.section`, even though both instances ran.
    // The centre-column panel is registered the same way (once): both slots are
    // resident for the bundle's lifetime, and the second instance reaches
    // neither — the guards sit BEFORE `slots.inject`.
    // Three registrations: the settings page, the usage dashboard, and the
    // settings panel the dashboard's「转到设置」button opens (same page component,
    // a second `main` entry keyed differently).
    // 2026-10-18 起只有两条：侧边栏卡片 + 用量仪表盘（「转到设置」面板已去掉）。
    expect(harness.register).toHaveBeenCalledTimes(2);
    expect(harness.registrations).toHaveLength(2);
    const registration = harness.registrations[0]!;
    expect(registration.name).toBe("settings.section");
    expect(registration.id).toBe("llm-account");
    expect(registration.order).toBe(12);
    expect(registration.locale).toBe("settings.llm-account");
    const panel = harness.registrations[1]!;
    expect(panel.name).toBe("main");
    expect(panel.key).toBe("llm-account-dashboard");
    // Legacy call-site shape: `label` binds the locale namespace, `inject` is the
    // `hooks`-mapping factory the page reads its data through.
    expect(registration.label).toBeTypeOf("function");
    expect(registration.inject).toBeTypeOf("function");
    expect((registration.inject as () => unknown)()).toEqual({ hooks: {} });
    expect((registration.label as () => string)()).toBe("settings.llm-account.nav");

    // Only the first instance reached the slots: the guards sit BEFORE
    // `slots.inject`, so the second instance never touches them at all.
    // 两条插槽注入：`settings.section` + `main` 的用量面板（「转到设置」面板已去掉）。
    expect(harness.inject).toHaveBeenCalledTimes(2);
    expect(harness.inject).toHaveBeenCalledWith("settings.section", expect.any(Function));
    expect(harness.inject).toHaveBeenCalledWith("main", expect.any(Function));

    // The credentials service, by contrast, is armed by every instance: it rides
    // a NESTED injection (legacy commandcode client:7764), outside the page guard.
    // The plugin-scoped shared state adds two one-shot injections of its own: the
    // settings mirror (`remote.settings`, for the sidebar toggle store) and the
    // sidebar card's `layout` scope (legacy commandcode client:9331).
    expect(harness.injectedServices).toEqual([
      ["remote.settings"],
      ["layout"],
      ["remote.credentials"],
      ["remote.credentials"],
    ]);

    // Page copy namespace registered once (only the first instance registers the page).
    expect([...harness.localeNamespaces.keys()]).toEqual(["settings.llm-account"]);

    // Debug counter: one increment per `apply` call (1c's observation point).
    expect(applyCount()).toBe(beforeApply + 2);
  });

  it("apply 计数随每次调用递增（1c 的观测点），不依赖任何服务状态", () => {
    const harness = createClientContext();
    const beforeFirst = applyCount();

    apply(harness.context);
    const afterFirst = applyCount();
    apply(harness.context);

    // Asserted as a delta so the test does not depend on suite ordering.
    expect(afterFirst).toBe(beforeFirst + 1);
    expect(applyCount()).toBe(beforeFirst + 2);
  });

  it("导出的 inject 覆盖页面读取的每个远程服务", () => {
    // Measured 2026-10-17 on desktop 0.2.1-rc.2: `settings` is a SEPARATE cordis
    // service (`remote.settings`), not a property that appears on `remote` once
    // `remote` alone is injected. Omitting it left the page rendering
    // 「没有可显示的厂商」 with no error anywhere, because our accessor
    // deliberately degrades instead of throwing.
    //
    // Every official bundle that reads settings lists it (ui-settings,
    // agent-preset, permission presets all carry `"remote.settings"`).
    expect(inject).toContain("remote");
    expect(inject).toContain("remote.settings");
    // `remote.credentials` is armed by a nested injection in shell.ts instead,
    // so it must NOT be duplicated here (declared-but-unused is a contract bug).
    expect(inject).not.toContain("remote.credentials");
  });

  it("页面文案按语言字典注册：locale 契约是 { zh, en } 而非扁平键表", () => {
    const harness = createClientContext();
    apply(harness.context);

    // Observed legacy contract (@mars-sea/dsh-commandcode-provider/lib/client.js:7756-7763):
    // `ctx.locale.register("settings.commandcode", { zh, en })` — the payload is keyed by
    // LOCALE, and each dictionary holds the message keys. A flat `{ nav: "…" }` payload
    // would register a locale named "nav" and leave `bind(ns)("nav")` unresolved.
    const copy = harness.localeNamespaces.get("settings.llm-account");
    expect(copy).toBeDefined();
    expect(Object.keys(copy!).sort()).toEqual(["en", "zh"]);

    for (const dictionary of Object.values(copy!)) {
      expect(dictionary).toBeTypeOf("object");
      const nav = (dictionary as Record<string, unknown>).nav;
      expect(typeof nav).toBe("string");
      expect((nav as string).trim()).not.toBe("");
    }
  });

  it("客户端插件导出 { apply, inject }，inject 含 slots/locale/remote/remote.settings", () => {
    expect(apply).toBeTypeOf("function");
    // Cordis service names, not npm module ids (see `src/client/index.ts`).
    // `remote.settings` joined the list on 2026-10-17: the settings page finds its
    // vendors through that service, and without it the section renders empty.
    expect(inject).toEqual(["slots", "locale", "remote", "remote.settings"]);
    expect(new Set(inject).size).toBe(inject.length);
  });

  it("注册表按设置命名空间收敛：重复注册同一厂商不产生第二条记录", () => {
    const entry = { ns: "llm-commandcode", rowIds: ["llm-commandcode"], providerId: "commandcode", order: 1, labelKey: "nav", cards: [] };
    registerVendor(entry);
    registerVendor({ ...entry, order: 9 });

    expect(vendors()).toHaveLength(1);
    expect(vendors()[0]!.order).toBe(9);
  });

  it("注册表按 order 升序返回（页面标签页顺序）", () => {
    registerVendor({ ns: "b", rowIds: ["b"], providerId: "b", order: 20, labelKey: "nav", cards: [] });
    registerVendor({ ns: "a", rowIds: ["a"], providerId: "a", order: 12, labelKey: "nav", cards: [] });

    expect(vendors().map((vendor) => vendor.ns)).toEqual(["a", "b"]);
  });
});
