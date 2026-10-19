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

it("远程面把可省略字段序列化成 null 时也不崩（渲染路径抛错会整块面板变空白）", () => {
  // 契约里 `effective` 是可省略字段（`effective?: { ref; at }`），跨远程边界后可能被写成 null。
  // `null !== undefined`，旧写法会走进 effective 分支再读 `.ref` —— TypeError。
  const nulled = statusOf({ effective: null as never, pinned: "a", accounts: [row("a")] });
  const tree = renderCard(nulled);
  // 没有生效账号时回落到已配置账号，至少显示账号名和空额度条，且不抛。
  expect(textsOf(tree).join(" ")).toContain("a");
  // 没有额度读数时画**空占位**（三档回退窗口各一列），但不画填充条（缺失 ≠ 用光）。
  expect(elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined).length).toBeGreaterThan(0);
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-fill"] !== undefined)).toBe(false);
  expect(textsOf(tree).join(" ")).not.toContain("undefined");
  expect(textsOf(tree).join(" ")).not.toContain("null");
});

it("开启后显示**生效账号**的额度：第一行 5 小时，第二行每周（有几档画几档）", () => {
  const tree = renderCard(
    statusOf({
      pinned: "fixed",
      effective: { ref: "serving", at: 1_700_000_000_000 },
      accounts: [
        row("fixed", { quota: { windows: [{ key: "5h", used: 1, cap: 10 }], failures: [] } }),
        row("serving", { label: "Serving", effective: true, quota: { plan: { id: "individual-pro", name: "Pro" }, windows: [{ key: "5h", used: 7, cap: 10 }, { key: "weekly", used: 30, cap: 100 }], failures: [] } }),
      ],
    }),
  );
  const windows = elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined);
  expect(windows.map((element) => element.props["data-sidebar-window"])).toEqual(["5h", "weekly"]);
  // 数字来自生效账号那一行（7/10 → 剩 30%），不是固定账号的（1/10 → 剩 90%）。
  expect(textsOf(windows[0]!)).toContain("30%");
  expect(textsOf(windows[1]!)).toContain("70%");
  expect(textsOf(tree)).toContain("Serving");
  // 第一行是主档（5 小时），第二行放其余档。
  const primary = elementsOf(tree).find((element) => element.props["data-sidebar-row"] === "primary")!;
  expect(elementsOf(primary).some((element) => element.props["data-sidebar-window"] === "5h")).toBe(true);
  const secondary = elementsOf(tree).find((element) => element.props["data-sidebar-row"] === "secondary")!;
  expect(elementsOf(secondary).some((element) => element.props["data-sidebar-window"] === "weekly")).toBe(true);
});

it("三档齐全：第一行 5 小时，第二行每周 + 每月并排", () => {
  const resetAt = new Date(2026, 9, 19, 20, 0, 0).getTime();
  const tree = renderCard(
    statusOf({
      effective: { ref: "a", at: 1 },
      accounts: [
        row("a", {
          effective: true,
          quota: {
            windows: [
              { key: "5h", percent: 20, resetAt },
              { key: "weekly", percent: 50 },
              { key: "monthly", used: 3, cap: 120, unit: "usd" },
            ],
            failures: [],
          },
        }),
      ],
    }),
  );
  const windows = elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined);
  expect(windows.map((element) => element.props["data-sidebar-window"])).toEqual(["5h", "weekly", "monthly"]);
  // 第一行只有 5 小时，且**带重置时间**（用户要求「第一行是 5 小时额度带重置时间」）。
  const primary = elementsOf(tree).find((element) => element.props["data-sidebar-row"] === "primary")!;
  expect(elementsOf(primary).filter((element) => element.props["data-sidebar-window"] !== undefined)).toHaveLength(1);
  expect(elementsOf(primary).some((element) => element.props["data-sidebar-reset"] !== undefined)).toBe(true);
  // 第二行是周 + 月，**不带**重置时间（半行宽放不下，也不常看）。
  const secondary = elementsOf(tree).find((element) => element.props["data-sidebar-row"] === "secondary")!;
  expect(elementsOf(secondary).map((element) => element.props["data-sidebar-window"]).filter(Boolean)).toEqual([
    "weekly",
    "monthly",
  ]);
  expect(elementsOf(secondary).some((element) => element.props["data-sidebar-reset"] !== undefined)).toBe(false);
  expect(textsOf(tree).join(" ")).toContain("5 小时");
  expect(textsOf(tree).join(" ")).toContain("每周");
  expect(textsOf(tree).join(" ")).toContain("每月");
});

it("整张卡片就是一个按钮：点它打开用量面板（不再有单独的按钮）", () => {
  const onOpen = vi.fn();
  const tree = SidebarCard({ t: dictionaryOf("zh"), status: statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a")] }), onOpen });
  const whole = elementsOf(tree).find((element) => element.props["data-sidebar-whole"] === "true")!;
  expect(whole.type).toBe("button");
  (whole.props.onClick as () => void)();
  expect(onOpen).toHaveBeenCalledTimes(1);
  // 卡片上不再有「打开用量面板」文字按钮，也没有刷新按钮（刷新搬到面板里）。
  expect(textsOf(whole).join(" ")).not.toContain("打开用量面板");
  expect(elementsOf(tree).some((element) => element.props["data-sidebar-refresh"] !== undefined)).toBe(false);
});

it("侧边栏只显示当前账号名称，不再标注「已指定/生效」或切换提示", () => {
  const tree = renderCard(
    statusOf({
      pinned: "fixed",
      effective: { ref: "serving", at: 1_700_000_000_000 },
      switch: { fromRef: "fixed", toRef: "serving", reason: "quota", at: 1_700_000_000_000 },
      accounts: [row("fixed"), row("serving", { label: "Serving", effective: true })],
    }),
  );
  expect(textsOf(tree)).toContain("Serving");
  expect(elementsOf(tree).some((element) => element.props["data-switch-notice"] !== undefined)).toBe(false);
  expect(elementsOf(tree).some((element) => element.props["data-sidebar-pinned"] !== undefined)).toBe(false);
  expect(elementsOf(tree).some((element) => element.props["data-sidebar-effective"] !== undefined)).toBe(false);
});

it("没有请求过时显示占位，而不是 0%", () => {
  // 状态还没读到。
  const unknown = renderCard(undefined);
  expect(elementsOf(unknown).some((element) => element.props["data-sidebar-empty"] !== undefined)).toBe(true);
  expect(textsOf(unknown)).toContain(dictionaryOf("zh")("sidebar.noRequest"));
  expect(textsOf(unknown).join(" ")).not.toMatch(/\b0\b/);

  // 读到了状态但还没有任何一次请求 → 显示已配置账号和空额度占位，而不是纯文字或 0。
  const noRequest = renderCard(statusOf({ accounts: [row("a")] }));
  expect(textsOf(noRequest).join(" ")).toContain("a");
  // 没有读数时按厂商的常规档位画占位（一列一档），但填充条一条都不画。
  expect(elementsOf(noRequest).filter((element) => element.props["data-sidebar-window"] !== undefined).length).toBeGreaterThan(0);
  expect(textsOf(noRequest).join(" ")).not.toMatch(/\b0\b/);
});

it("生效账号的额度字段缺失时不渲染成 0（与账户卡片同一条规则）", () => {
  const tree = renderCard(
    statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a", { effective: true, quota: { windows: [{ key: "5h" }], failures: [] } })] }),
  );
  const window = elementsOf(tree).find((element) => element.props["data-sidebar-window"] === "5h")!;
  expect(window.props["data-sidebar-window-shape"]).toBe("missing");
  // 侧边栏用的是紧凑列（名称 + 剩余百分比 + 细条），缺失时百分比是破折号而不是 0%。
  expect(textsOf(window).join(" ")).toContain("—");
  expect(textsOf(window).join(" ")).not.toMatch(/\b0%/);
});

it("点整张卡片就打开仪表盘（收起态的图标按钮也是同一个动作）", () => {
  const onOpen = vi.fn();
  const tree = SidebarCard({ t: dictionaryOf("zh"), status: statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a")] }), onOpen });
  const buttons = elementsOf(tree).filter((element) => element.props["data-sidebar-open"] !== undefined);
  // 展开态（整卡）+ 收起态（图标），两处都能打开。
  expect(buttons).toHaveLength(2);
  for (const button of buttons) (button.props.onClick as () => void)();
  expect(onOpen).toHaveBeenCalledTimes(2);
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
  let state = createPageState(VENDORS, [{ ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: false }, revision: 1 }]);
  state = { ...state, drafts: { "llm-commandcode": { showSidebarQuota: true } } };
  expect(sidebarVendorOf(VENDORS, state.snapshots)).toBeUndefined();

  const stored = createPageState(VENDORS, [{ ns: "llm-commandcode", row: "llm-commandcode", value: { showSidebarQuota: true }, revision: 1 }]);
  expect(sidebarVendorOf(VENDORS, stored.snapshots)?.ns).toBe("llm-commandcode");
});

it("accounts 不是数组时也不崩（跨边界的半成品载荷）", () => {
  // 与上一条同类：`status.accounts` 存在但不是数组时，旧写法的 `.find` 一样会抛，
  // 而这是侧边栏的渲染路径 —— 抛了整块卡片变空白。收敛成空数组后走的是空态文案。
  for (const bad of [null, undefined, {}, "nope", 42]) {
    const status = statusOf({ accounts: bad as never });
    expect(() => renderCard(status)).not.toThrow();
    expect(textsOf(renderCard(status)).join(" ")).toContain("还没有请求经过这个账号");
  }
});
