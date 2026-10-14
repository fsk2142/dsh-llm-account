/**
 * Task 10 测试：**假客户端上下文的冒烟**（不启动宿主、不渲染 React）。
 *
 * 真机启动与真渲染是计划 1c 的事（本机没有与桌面端同版本的引擎）。这里覆盖：
 * 1. `apply` 被两个 profile 行各调一次时，设置页只注册一次；
 * 2. 侧边栏开关**关闭**时既不注册侧边栏卡片、也不注册中栏面板；
 * 3. 开关**开启**时两者各注册一次，且面板用的是 `main` 插槽要的 `key`；
 * 4. `layout.selectPanel` 能被用来打开/关闭这块面板；
 * 5. 注册失败不会把客户端带走。
 */
import { expect, it, vi } from "vitest";

import { apply, inject } from "../../src/client/index";
import { DASHBOARD_PANEL_ID, selectPanel, syncSidebarAndPanel, type ClientSeamContext } from "../../src/client/seams";
import { resetShell } from "../../src/client/shell";
import { dictionaryOf } from "../../src/client/copy";

/** 一次被记录的插槽注册。 */
interface Registered {
  slot: string;
  entry: Record<string, unknown>;
  component: unknown;
}

/** 一个假客户端上下文：只实现本包真正调用的那些接缝。 */
function fakeClientContext(options: { describe?: () => Promise<unknown> } = {}): {
  ctx: ClientSeamContext;
  registered: Registered[];
  locale: { namespace: string; dictionaries: Record<string, unknown> }[];
  panels: (string | null)[];
  listeners: Map<string, (() => void)[]>;
} {
  const registered: Registered[] = [];
  const locale: { namespace: string; dictionaries: Record<string, unknown> }[] = [];
  const panels: (string | null)[] = [];
  const listeners = new Map<string, (() => void)[]>();

  const slots = {
    inject: (_slot: string, callback: () => unknown) => {
      callback();
      return () => undefined;
    },
    register: (entry: Record<string, unknown>, component: unknown) => {
      // 插槽名在 entry 上（`name`），记录下来供断言。
      registered.push({ slot: String(entry["name"]), entry, component });
      return () => undefined;
    },
  };

  const layout = {
    selectPanel: (panel: string | null) => {
      panels.push(panel);
      return undefined;
    },
  };

  const ctx: ClientSeamContext = {
    slots,
    layout,
    // `locale`：页面注册文案要用它（`register` 收字典、`bind` 返回取词函数）。
    locale: {
      register: (namespace: string, dictionaries: Record<string, unknown>) => {
        locale.push({ namespace, dictionaries });
        return () => undefined;
      },
      bind: (namespace: string) => (key: string) => `${namespace}.${key}`,
    },
    get: (name: string) => (name === "layout" ? layout : undefined),
    inject: (_names: readonly string[], callback: (scoped: ClientSeamContext) => unknown) => callback(ctx),
    effect: (callback: () => unknown) => {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => undefined;
    },
    remote: {
      settings: {
        describe: options.describe ?? (async () => []),
        mutate: async () => undefined,
      },
      $on: (event: string, listener: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => undefined;
      },
      $mount: async () => () => undefined,
    },
  } as unknown as ClientSeamContext;

  return { ctx, registered, locale, panels, listeners };
}

/** 宿主设置行：把某个厂商的开关设成给定值。 */
function rowsWith(toggle: boolean): { ns: string; value: Record<string, unknown>; revision: number }[] {
  return [
    { ns: "llm-commandcode", value: { showSidebarQuota: toggle }, revision: 1 },
    { ns: "llm-opencode-go", value: { showSidebarQuota: toggle }, revision: 1 },
  ];
}

it("设置行里开关为真时，发现厂商能认出来（页面据此注册侧边栏卡片）", async () => {
  const host = fakeClientContext({ describe: async () => rowsWith(true) });
  // 纯粹的发现逻辑（与容器里的调用同一个函数）。
  const { describeVendorSnapshots } = await import("../../src/client/seams");
  const { sidebarVendorOf, createPageState } = await import("../../src/client/page-state");
  const { VENDORS } = await import("../../src/client/shell");

  const snapshots = await describeVendorSnapshots(host.ctx, VENDORS);
  const state = createPageState(VENDORS, snapshots);
  expect(sidebarVendorOf(VENDORS, state.snapshots)?.ns).toBe("llm-commandcode");
});

it("客户端入口导出 { apply, inject }，inject 是 cordis 服务名", () => {
  expect(typeof apply).toBe("function");
  expect(inject).toEqual(["slots", "locale", "remote"]);
});

it("两个 profile 行各调一次 apply：设置页只注册一次，且不碰侧边栏/中栏插槽", () => {
  resetShell();
  const host = fakeClientContext();

  apply(host.ctx);
  apply(host.ctx);

  const sections = host.registered.filter((item) => item.slot === "settings.section");
  expect(sections).toHaveLength(1);
  expect(sections[0]!.entry).toMatchObject({ id: "llm-account", order: 12, locale: "settings.llm-account" });
  // 开关默认关闭：这两条插槽一个都不注册（也就不可能有后台用量请求）。
  expect(host.registered.filter((item) => item.slot === "sidebar.footer.action")).toEqual([]);
  expect(host.registered.filter((item) => item.slot === "main")).toEqual([]);
});

it("开关开启时才注册侧边栏卡片与中栏面板（各一次，面板用 key）", () => {
  const host = fakeClientContext();
  const dispose = syncSidebarAndPanel({
    ctx: host.ctx,
    enabled: true,
    vendor: "commandcode",
    t: dictionaryOf("zh"),
    localeNs: "settings.llm-account",
  });

  const sidebar = host.registered.filter((item) => item.slot === "sidebar.footer.action");
  const panels = host.registered.filter((item) => item.slot === "main");
  expect(sidebar).toHaveLength(1);
  expect(sidebar[0]!.entry).toMatchObject({ id: "llm-account-quota", order: 1, locale: "settings.llm-account" });
  expect(panels).toHaveLength(1);
  // `main` 用 key（不是 id）：抄错会让面板永远打不开。
  expect(panels[0]!.entry).toMatchObject({ key: DASHBOARD_PANEL_ID, locale: "settings.llm-account" });
  expect(panels[0]!.entry["id"]).toBeUndefined();

  expect(() => dispose()).not.toThrow();
});

it("关闭时不注册任何东西（关闭即零后台查询的注册面）", () => {
  const host = fakeClientContext();
  syncSidebarAndPanel({ ctx: host.ctx, enabled: false, vendor: "commandcode", t: dictionaryOf("zh"), localeNs: "settings.llm-account" });
  expect(host.registered).toEqual([]);
});

it("layout.selectPanel 能打开与关闭这块面板", () => {
  const host = fakeClientContext();
  expect(selectPanel(host.ctx, DASHBOARD_PANEL_ID)).toBe(true);
  expect(selectPanel(host.ctx, null)).toBe(true);
  expect(host.panels).toEqual([DASHBOARD_PANEL_ID, null]);
});

it("宿主没有 layout 服务时 selectPanel 返回 false（调用方据此降级）", () => {
  const bare: ClientSeamContext = { slots: undefined, get: () => undefined };
  expect(selectPanel(bare, DASHBOARD_PANEL_ID)).toBe(false);
});

it("插槽注册抛错时 apply 仍然完成（不让一次注册失败带走客户端）", () => {
  resetShell();
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const host = fakeClientContext();
    const broken = {
      ...host.ctx,
      inject: (_names: readonly string[], callback: (scoped: ClientSeamContext) => unknown) => callback(host.ctx),
      slots: {
        inject: () => {
          throw new Error("no such slot");
        },
        register: () => undefined,
      },
    } as ClientSeamContext;

    expect(() => apply(broken)).not.toThrow();
    expect(errors).toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});
