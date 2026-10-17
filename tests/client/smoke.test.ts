/**
 * Task 10 测试：**假客户端上下文的冒烟**（不启动宿主、不渲染 React）。
 *
 * 真机启动与真渲染是计划 1c 的事（本机没有与桌面端同版本的引擎）。这里覆盖：
 * 1. `apply` 被两个 profile 行各调一次时，设置页 / 侧边栏卡片 / 中栏面板都只注册一次；
 * 2. 插槽是**常驻注册**的（旧插件同形：门控是渲染决策，不是注册决策）；
 * 3. 侧边栏开关存储：已存储的开关为真时认得出厂商，`settings/document-updated`
 *    事件让存储在设置页之外也保持新鲜；
 * 4. usage 远程面两个行只 `$mount` 一次（插件级共享）；
 * 5. `layout.selectPanel` 能被用来打开/关闭这块面板；
 * 6. 注册失败不会把客户端带走。
 *
 * **渲染门控本身**（关闭 → `null` + 停轮询）发生在 React 容器里，只有真挂载才会跑；
 * 它的判定依据（存储）与轮询语义（`createSidebarCardController`）分别在本文件与
 * `sidebar-card.test.ts` 里覆盖，1c 的真机渲染是最后一环。
 */
import { expect, it, vi } from "vitest";

import { apply, inject } from "../../src/client/index";
import {
  DASHBOARD_PANEL_ID,
  registerSharedSurfaces,
  resetSeams,
  selectPanel,
  sidebarVendor,
  sidebarVendorSeeded,
  startSharedState,
  type ClientSeamContext,
} from "../../src/client/seams";
import { resetShell, VENDORS } from "../../src/client/shell";
import { dictionaryOf } from "../../src/client/copy";

/** 一次被记录的插槽注册。 */
interface Registered {
  slot: string;
  entry: Record<string, unknown>;
  component: unknown;
}

/** 一个假客户端上下文：只实现本包真正调用的那些接缝。 */
function fakeClientContext(options: { describe?: () => Promise<unknown>; remote?: Record<string, unknown> } = {}): {
  ctx: ClientSeamContext;
  registered: Registered[];
  locale: { namespace: string; dictionaries: Record<string, unknown> }[];
  panels: (string | null)[];
  listeners: Map<string, (() => void)[]>;
  mounts: { package: string; descriptors: readonly unknown[] }[];
} {
  const registered: Registered[] = [];
  const locale: { namespace: string; dictionaries: Record<string, unknown> }[] = [];
  const panels: (string | null)[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const mounts: { package: string; descriptors: readonly unknown[] }[] = [];

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
        describe: options.describe ?? (async () => ({ writable: true, hasDocument: true, namespaces: [] })),
        mutate: async () => undefined,
      },
      $on: (event: string, listener: () => void) => {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
        return () => undefined;
      },
      $mount: async (contribution: { package: string; descriptors: readonly unknown[] }) => {
        mounts.push(contribution);
        return () => undefined;
      },
      ...(options.remote ?? {}),
    },
  } as unknown as ClientSeamContext;

  return { ctx, registered, locale, panels, listeners, mounts };
}

/**
 * 宿主设置行：把某个厂商的开关设成给定值（opencode 用**行 id** 回来，与命名空间不同）。
 *
 * 按真机形状包一层 `namespaces`：宿主 `SettingsController.describe()` 返回的是对象
 * （app.asar @21028751），不是裸数组。测试替身必须与真机一致，否则形状回归测不出来。
 */
function rowsWith(toggle: boolean): { writable: boolean; hasDocument: boolean; namespaces: { ns?: string; id?: string; value: Record<string, unknown>; revision: number }[] } {
  return {
    writable: true,
    hasDocument: true,
    namespaces: [
      { ns: "llm-commandcode", value: { showSidebarQuota: toggle }, revision: 1 },
      { id: "opencode-go", value: { showSidebarQuota: toggle }, revision: 1 },
    ],
  };
}

/** 触发一次宿主推送（凭据/设置失效信号）。 */
function fire(host: ReturnType<typeof fakeClientContext>, event: string): void {
  for (const listener of host.listeners.get(event) ?? []) listener();
}

/** 每个用到 `apply`/共享状态的测试都从干净状态开始（模块级单例 + 守卫）。 */
function resetAll(): void {
  resetShell();
  resetSeams();
}

it("客户端入口导出 { apply, inject }，inject 是 cordis 服务名", () => {
  expect(typeof apply).toBe("function");
  // `remote.settings` is a separate cordis service, not a property that shows up
  // on `remote` once `remote` alone is injected; the page needs it bound.
  expect(inject).toEqual(["slots", "locale", "remote", "remote.settings"]);
});

it("两个 profile 行各调一次 apply：页面与两块插槽都只注册一次", () => {
  resetAll();
  const host = fakeClientContext();

  apply(host.ctx);
  apply(host.ctx);

  const sections = host.registered.filter((item) => item.slot === "settings.section");
  expect(sections).toHaveLength(1);
  expect(sections[0]!.entry).toMatchObject({ id: "llm-account", order: 12, locale: "settings.llm-account" });
  // 侧边栏卡片与中栏面板是**常驻注册**的（旧插件同形：门控是渲染决策，不是注册决策），
  // 两个行共享一份模块实例，所以各插槽恰好一次。
  const sidebar = host.registered.filter((item) => item.slot === "sidebar.footer.action");
  const panels = host.registered.filter((item) => item.slot === "main");
  expect(sidebar).toHaveLength(1);
  expect(panels).toHaveLength(1);
  expect(sidebar[0]!.entry).toMatchObject({ id: "llm-account-quota", order: 1, locale: "settings.llm-account" });
  // `main` 用 key（不是 id）：抄错会让面板永远打不开。
  expect(panels[0]!.entry).toMatchObject({ key: DASHBOARD_PANEL_ID, locale: "settings.llm-account" });
  expect(panels[0]!.entry["id"]).toBeUndefined();
});

it("usage 远程面两个行只 $mount 一次（插件级共享，不随页面开闭起落）", () => {
  resetAll();
  const host = fakeClientContext();

  apply(host.ctx);
  apply(host.ctx);

  expect(host.mounts).toHaveLength(1);
  expect(host.mounts[0]!.package).toBe("dsh-llm-account");
});

it("侧边栏开关存储：已存储的开关为真时认得出厂商（按标签页顺序取第一家）", async () => {
  resetAll();
  const on = fakeClientContext({ describe: async () => rowsWith(true) });
  startSharedState(on.ctx, VENDORS);
  await vi.waitFor(() => expect(sidebarVendor()).toBe("commandcode"));

  resetAll();
  const off = fakeClientContext({ describe: async () => rowsWith(false) });
  startSharedState(off.ctx, VENDORS);
  // 两家都关：读取完成、存储已 seed，但没有厂商（卡片渲染 null、不轮询）。
  await vi.waitFor(() => expect(sidebarVendorSeeded()).toBe(true));
  expect(sidebarVendor()).toBeUndefined();
});

it("settings/document-updated 事件让开关存储在设置页之外也保持新鲜", async () => {
  resetAll();
  let toggle = false;
  const host = fakeClientContext({ describe: async () => rowsWith(toggle) });
  startSharedState(host.ctx, VENDORS);
  await vi.waitFor(() => expect(host.listeners.get("settings/document-updated")?.length).toBeGreaterThan(0));
  await vi.waitFor(() => expect(sidebarVendorSeeded()).toBe(true));
  expect(sidebarVendor()).toBeUndefined();

  // 外部改动（patch 文件 / 其它工具）把开关拨开：事件到达后存储随之更新。
  toggle = true;
  fire(host, "settings/document-updated");
  await vi.waitFor(() => expect(sidebarVendor()).toBe("commandcode"));

  // 再拨上：存储清空（卡片关闭的那条路）。
  toggle = false;
  fire(host, "settings/document-updated");
  await vi.waitFor(() => expect(sidebarVendor()).toBeUndefined());
});

it("侧边栏卡片与中栏面板的注册形状逐字对齐旧插件", () => {
  resetAll();
  const host = fakeClientContext();
  registerSharedSurfaces({
    ctx: host.ctx,
    entries: [],
    t: dictionaryOf("zh"),
    localeNs: "settings.llm-account",
  });

  const sidebar = host.registered.filter((item) => item.slot === "sidebar.footer.action");
  const panels = host.registered.filter((item) => item.slot === "main");
  expect(sidebar).toHaveLength(1);
  expect(sidebar[0]!.entry).toMatchObject({ id: "llm-account-quota", order: 1, locale: "settings.llm-account" });
  expect(panels).toHaveLength(1);
  expect(panels[0]!.entry).toMatchObject({ key: DASHBOARD_PANEL_ID, locale: "settings.llm-account" });
  expect(panels[0]!.entry["id"]).toBeUndefined();
  expect(panels[0]!.entry["order"]).toBeUndefined();
  // `inject` 是**工厂**（旧插件的形状是返回 `{ hooks, ...回调 }`）。
  expect(typeof sidebar[0]!.entry.inject).toBe("function");
  expect((sidebar[0]!.entry.inject as () => unknown)()).toMatchObject({ hooks: {} });
  expect(() => registerSharedSurfaces({ ctx: host.ctx, entries: [], t: dictionaryOf("zh"), localeNs: "settings.llm-account" })).not.toThrow();
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

it("两个 profile 行各调一次 apply：样式表只注入一次（幂等由 data-plugin-css 保证）", () => {
  resetAll();
  const tags: { attrs: Record<string, string> }[] = [];
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    head: { appendChild: () => undefined },
    querySelector: (selector: string) => {
      const id = /data-plugin-css="([^"]+)"/.exec(selector)?.[1];
      return tags.some((tag) => tag.attrs["data-plugin-css"] === id) ? {} : null;
    },
    createElement: () => {
      const element = {
        attrs: {} as Record<string, string>,
        textContent: "",
        setAttribute(name: string, value: string) {
          element.attrs[name] = value;
        },
        remove: () => undefined,
      };
      tags.push(element);
      return element;
    },
  };
  try {
    const host = fakeClientContext();
    apply(host.ctx);
    apply(host.ctx);
    expect(tags).toHaveLength(1);
    expect(tags[0]!.attrs["data-plugin-css"]).toBe("@dsh-llm-account/page.css");
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});

it("插槽注册抛错时 apply 仍然完成（不让一次注册失败带走客户端）", () => {
  resetAll();
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
