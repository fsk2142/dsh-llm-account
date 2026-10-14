/**
 * Task 8 测试：侧边栏额度卡片（跟随生效账号）。
 *
 * 计划 Step 1 的五条都在这里：默认关闭不注册/不请求、开启后显示生效账号的额度、
 * 生效≠固定时的切换提示与双标注、没有请求过时是占位而不是 0%、关闭后停止轮询。
 *
 * 轮询/注册的生命周期在 `createSidebarCardController` 里（不依赖 React，可用假定时器完整测）。
 */
import { afterEach, expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { createPageState, sidebarQuotaEnabled, sidebarVendorOf } from "../../src/client/page-state";
import { createSidebarCardController } from "../../src/client/seams";
import { SidebarCard } from "../../src/client/sidebar-card";
import { VENDORS } from "../../src/client/shell";
import type { AccountUsageStatus, VendorUsageStatus } from "../../src/client/usage-contract";
import type { StubElement } from "../support/react-stub";

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 树里所有文本。 */
function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value !== null && typeof value === "object" && "props" in (value as StubElement)) {
      walk((value as StubElement).props.children);
    }
  };
  walk(node);
  return out;
}

/** 一个账号行。 */
function row(ref: string, overrides: Partial<AccountUsageStatus> = {}): AccountUsageStatus {
  return { ref, label: ref, configured: true, active: false, effective: false, ...overrides };
}

/** 一份状态。 */
function statusOf(overrides: Partial<VendorUsageStatus> = {}): VendorUsageStatus {
  return { vendor: "commandcode", capabilities: { reorder: false, pin: true, browserLogin: true, modelAccountRules: true, quotaShape: "windows", modelVisibilityWrite: "onSave", automaticSwitch: true }, pinned: null, accounts: [], failures: [], ...overrides };
}

/** 渲染一次卡片。 */
function renderCard(status: VendorUsageStatus | undefined): StubElement {
  return SidebarCard({ t: dictionaryOf("zh"), status, onOpen: vi.fn() });
}

afterEach(() => {
  vi.useRealTimers();
});

// —— 卡片渲染 ——

it("开启后显示**生效账号**的额度（不是固定账号的）", () => {
  const tree = renderCard(
    statusOf({
      pinned: "fixed",
      effective: { ref: "serving", at: 1_700_000_000_000 },
      accounts: [
        row("fixed", { quota: { windows: [{ key: "5h", used: 1, cap: 10 }], failures: [] } }),
        row("serving", { label: "Serving", effective: true, quota: { plan: "pro", windows: [{ key: "5h", used: 7, cap: 10 }, { key: "weekly", used: 30, cap: 100 }], failures: [] } }),
      ],
    }),
  );
  const windows = elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined);
  expect(windows.map((element) => element.props["data-sidebar-window"])).toEqual(["5h", "weekly"]);
  // 数字来自生效账号那一行（7/10），不是固定账号的（1/10）。
  expect(textsOf(windows[0]!)).toContain("7/10");
  expect(textsOf(tree)).toContain("Serving · pro");
});

it("生效账号与固定账号不同时：顶部给切换提示（谁→谁、原因、时间），并同时标注两个账号", () => {
  const tree = renderCard(
    statusOf({
      pinned: "fixed",
      effective: { ref: "serving", at: 1_700_000_000_000 },
      switch: { fromRef: "fixed", toRef: "serving", reason: "quota", at: 1_700_000_000_000 },
      accounts: [row("fixed"), row("serving", { effective: true })],
    }),
  );
  const notice = elementsOf(tree).find((element) => element.props["data-switch-notice"] !== undefined)!;
  expect(notice.props["data-switch-from"]).toBe("fixed");
  expect(notice.props["data-switch-to"]).toBe("serving");
  expect(notice.props["data-switch-reason"]).toBe("quota");
  // 时间以 ISO 放在 `dateTime` 上（可断言、不依赖本地化文本）。
  const time = elementsOf(notice).find((element) => element.props["data-switch-at"] !== undefined)!;
  expect(time.props.dateTime).toBe(new Date(1_700_000_000_000).toISOString());
  expect(textsOf(notice)).toContain(dictionaryOf("zh")("switch.reason.quota"));

  // 两个账号都标注出来了（规格 §8.1 第 4 条：不能让用户以为固定设置没生效）。
  expect(elementsOf(tree).find((element) => element.props["data-sidebar-pinned"] !== undefined)!.props["data-sidebar-pinned"]).toBe("fixed");
  expect(elementsOf(tree).find((element) => element.props["data-sidebar-effective"] !== undefined)!.props["data-sidebar-effective"]).toBe("serving");
});

it("生效与固定相同（或未固定）时不显示切换提示，只标「当前」", () => {
  const same = renderCard(
    statusOf({ pinned: "a", effective: { ref: "a", at: 1 }, switch: { fromRef: "x", toRef: "a", reason: "quota", at: 1 }, accounts: [row("a", { effective: true })] }),
  );
  expect(elementsOf(same).filter((element) => element.props["data-switch-notice"] !== undefined)).toEqual([]);
  expect(elementsOf(same).find((element) => element.props["data-sidebar-effective"] !== undefined)).toBeDefined();

  // 没有固定账号（自动轮换）时同样没有提示。
  const auto = renderCard(statusOf({ pinned: null, effective: { ref: "a", at: 1 }, accounts: [row("a", { effective: true })] }));
  expect(elementsOf(auto).filter((element) => element.props["data-switch-notice"] !== undefined)).toEqual([]);
});

it("没有请求过时显示占位，而不是 0%", () => {
  // 状态还没读到。
  const unknown = renderCard(undefined);
  expect(elementsOf(unknown).some((element) => element.props["data-sidebar-empty"] !== undefined)).toBe(true);
  expect(textsOf(unknown)).toContain(dictionaryOf("zh")("sidebar.noRequest"));
  expect(textsOf(unknown).join(" ")).not.toMatch(/\b0\b/);

  // 读到了状态但还没有任何一次请求 → 没有生效账号。
  const noRequest = renderCard(statusOf({ accounts: [row("a")] }));
  expect(elementsOf(noRequest).some((element) => element.props["data-sidebar-empty"] !== undefined)).toBe(true);
  expect(textsOf(noRequest).join(" ")).not.toMatch(/\b0\b/);
});

it("生效账号的额度字段缺失时不渲染成 0（与账户卡片同一条规则）", () => {
  const tree = renderCard(
    statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a", { effective: true, quota: { windows: [{ key: "5h" }], failures: [] } })] }),
  );
  const window = elementsOf(tree).find((element) => element.props["data-sidebar-window"] === "5h")!;
  expect(window.props["data-sidebar-window-shape"]).toBe("missing");
  expect(textsOf(window)).toContain(dictionaryOf("zh")("account.quotaMissing"));
  expect(textsOf(window).join(" ")).not.toMatch(/\b0\b/);
});

it("打开仪表盘的按钮把意图报出去", () => {
  const onOpen = vi.fn();
  const tree = SidebarCard({ t: dictionaryOf("zh"), status: statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a")] }), onOpen });
  const button = elementsOf(tree).find((element) => element.props["data-sidebar-open"] !== undefined)!;
  (button.props.onClick as () => void)();
  expect(onOpen).toHaveBeenCalledTimes(1);
});

// —— 生命周期（默认关闭 / 零后台查询 / 关闭即停） ——

it("默认关闭时不注册卡片、且不发出任何用量请求", () => {
  vi.useFakeTimers();
  const register = vi.fn(() => vi.fn());
  const load = vi.fn();
  const controller = createSidebarCardController({ register, load, intervalMs: 100 });

  expect(controller.sync(false)).toBe(false);
  expect(controller.registered()).toBe(false);
  expect(controller.polling()).toBe(false);
  vi.advanceTimersByTime(1_000);
  expect(load).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

it("开启后注册一次并立刻读一次，随后按周期读", () => {
  vi.useFakeTimers();
  const register = vi.fn(() => vi.fn());
  const load = vi.fn();
  const controller = createSidebarCardController({ register, load, intervalMs: 100 });

  expect(controller.sync(true)).toBe(true);
  expect(controller.registered()).toBe(true);
  expect(controller.polling()).toBe(true);
  expect(load).toHaveBeenCalledTimes(1); // 开启那一刻先读一次
  vi.advanceTimersByTime(300);
  expect(load).toHaveBeenCalledTimes(4);
});

it("重复开启是幂等的：不重复注册、不重复起定时器", () => {
  vi.useFakeTimers();
  const register = vi.fn(() => vi.fn());
  const load = vi.fn();
  const controller = createSidebarCardController({ register, load, intervalMs: 100 });

  controller.sync(true);
  controller.sync(true);
  expect(register).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(200);
  // 两个定时器会读 4 次；只有一个定时器时应该是 2 次。
  expect(load).toHaveBeenCalledTimes(3);
});

it("关闭开关会停止轮询并撤下注册（卸载后不再有请求）", () => {
  vi.useFakeTimers();
  const unregister = vi.fn();
  const load = vi.fn();
  const controller = createSidebarCardController({ register: () => unregister, load, intervalMs: 100 });

  controller.sync(true);
  const afterEnable = load.mock.calls.length;
  expect(controller.sync(false)).toBe(false);
  expect(controller.registered()).toBe(false);
  expect(controller.polling()).toBe(false);
  expect(unregister).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(1_000);
  expect(load.mock.calls.length).toBe(afterEnable); // 关闭之后一次都不再读
});

it("可见性恢复只在开启状态刷新：关闭时 refreshIfEnabled 什么都不做", () => {
  vi.useFakeTimers();
  const load = vi.fn();
  const controller = createSidebarCardController({ register: () => vi.fn(), load, intervalMs: 100 });

  controller.refreshIfEnabled();
  expect(load).not.toHaveBeenCalled(); // 关闭状态：零请求

  controller.sync(true);
  const afterEnable = load.mock.calls.length;
  controller.refreshIfEnabled();
  expect(load.mock.calls.length).toBe(afterEnable + 1);
});

it("dispose 停轮询并撤注册（卡片挂载生命周期结束）", () => {
  vi.useFakeTimers();
  const unregister = vi.fn();
  const load = vi.fn();
  const controller = createSidebarCardController({ register: () => unregister, load, intervalMs: 100 });

  controller.sync(true);
  controller.dispose();
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(controller.polling()).toBe(false);
  vi.advanceTimersByTime(500);
  expect(load).toHaveBeenCalledTimes(1); // 只剩开启时那一次
});

// —— 开关来源：只认已存储的文档 ——

it("开关只读已存储的设置文档：草稿把开关拨开也不算", () => {
  expect(sidebarQuotaEnabled({ showSidebarQuota: true })).toBe(true);
  expect(sidebarQuotaEnabled({ showSidebarQuota: false })).toBe(false);
  expect(sidebarQuotaEnabled({})).toBe(false); // 缺省 = 关闭
  expect(sidebarQuotaEnabled(undefined)).toBe(false);
  // 非布尔值不算开启（宿主文档可能被手改坏）。
  expect(sidebarQuotaEnabled({ showSidebarQuota: "true" })).toBe(false);

  // 页面状态里：草稿为 true、已存储为 false → 仍然不注册（旧插件同一条判定）。
  let state = createPageState(VENDORS, [{ ns: "llm-commandcode", value: { showSidebarQuota: false }, revision: 1 }]);
  state = { ...state, drafts: { "llm-commandcode": { showSidebarQuota: true } } };
  expect(sidebarVendorOf(VENDORS, state.snapshots)).toBeUndefined();

  const stored = createPageState(VENDORS, [{ ns: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 }]);
  expect(sidebarVendorOf(VENDORS, stored.snapshots)?.ns).toBe("llm-commandcode");
});
