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
import { quotaResetDateText } from "../../src/client/quota";
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

it("两行额度：5 小时 + 每周，每行都是「标签 — 条 — 重置时间」", () => {
  const fiveHourReset = new Date(2026, 9, 19, 20, 0, 0).getTime();
  const weekReset = new Date(2026, 9, 25, 10, 0, 0).getTime();
  const tree = renderCard(
    statusOf({
      effective: { ref: "serving", at: 1_700_000_000_000 },
      accounts: [
        row("serving", {
          label: "Serving",
          effective: true,
          quota: {
            windows: [
              { key: "5h", percent: 20, resetAt: fiveHourReset },
              { key: "weekly", percent: 50, resetAt: weekReset },
              { key: "monthly", used: 3, cap: 120, unit: "usd" },
            ],
            failures: [],
          },
        }),
      ],
    }),
  );
  // 只画两档：5 小时与每周。月度不在侧边栏（去用量面板看）。
  const windows = elementsOf(tree).filter((element) => element.props["data-sidebar-window"] !== undefined);
  expect(windows.map((element) => element.props["data-sidebar-window"])).toEqual(["5h", "weekly"]);
  // 每行都有条 + 重置时间（用户要求「5小时---进度条---重置时间」这种结构，第二行同样）。
  for (const window of windows) {
    expect(elementsOf(window).some((element) => element.props["data-sidebar-track"] !== undefined)).toBe(true);
    expect(elementsOf(window).some((element) => element.props["data-sidebar-reset"] !== undefined)).toBe(true);
  }
  // 两行不再并排：第二行的标记是 secondary。
  const rowsMarker = elementsOf(tree)
    .map((element) => element.props["data-sidebar-row"])
    .filter((value) => value !== undefined);
  expect(rowsMarker).toEqual(["primary", "secondary"]);
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

it("额度字段缺失时不渲染成 0（条不填色、重置写未知）", () => {
  const tree = renderCard(
    statusOf({ effective: { ref: "a", at: 1 }, accounts: [row("a", { effective: true, quota: { windows: [{ key: "5h" }], failures: [] } })] }),
  );
  const window = elementsOf(tree).find((element) => element.props["data-sidebar-window"] === "5h")!;
  expect(window.props["data-sidebar-window-shape"]).toBe("missing");
  // 缺失 ≠ 用光：条不填色（没有 fill 元素）。
  expect(elementsOf(window).some((element) => element.props["data-quota-bar-fill"] !== undefined)).toBe(false);
  // 重置时间写「未知」，不是空白也不是编造的时间。
  expect(textsOf(window).join(" ")).toContain(dictionaryOf("zh")("quota.resetUnknown"));
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

it("重置时间用日期格式，不再写「今天/明天」", () => {
  // 用户 2026-10-19：「小时那个也用日期表示，不用明天这种」。两行上下并排时相对说法对不齐。
  const now = new Date(2026, 9, 19, 15, 0, 0);
  const laterToday = new Date(2026, 9, 19, 20, 0, 0).getTime();
  const nextWeek = new Date(2026, 9, 25, 10, 0, 0).getTime();
  // 同一天：不是「今天 20:00」，而是「10-19 20:00」。
  expect(quotaResetDateText(laterToday, now.getTime())).toBe("10-19 20:00");
  expect(quotaResetDateText(nextWeek, now.getTime())).toBe("10-25 10:00");
  // 跨年要带年份，否则 `01-05` 会被误读为已经过去。
  const nextYear = new Date(2027, 0, 5, 8, 30, 0).getTime();
  expect(quotaResetDateText(nextYear, now.getTime())).toBe("2027-01-05 08:30");
  // 缺失/非法一律 undefined（不猜成现在）。
  expect(quotaResetDateText(undefined, now.getTime())).toBeUndefined();
  expect(quotaResetDateText(0, now.getTime())).toBeUndefined();
});

it("两条进度条共享同一套列宽（对齐：grid 定义在外层容器上）", () => {
  const tree = renderCard(
    statusOf({
      effective: { ref: "a", at: 1 },
      accounts: [
        row("a", {
          label: "A",
          effective: true,
          quota: {
            windows: [
              { key: "5h", percent: 20, resetAt: Date.now() + 3_600_000 },
              { key: "weekly", percent: 50, resetAt: Date.now() + 86_400_000 },
            ],
            failures: [],
          },
        }),
      ],
    }),
  );
  // 外层有一个 grid 容器，两行都在它里面（列宽因此共享）。
  const container = elementsOf(tree).find((element) => element.props["data-sidebar-windows"] === "true");
  expect(container).toBeDefined();
  const rowsInContainer = elementsOf(container!).filter(
    (element) => element.props["data-sidebar-row"] !== undefined,
  );
  expect(rowsInContainer.map((element) => element.props["data-sidebar-row"])).toEqual(["primary", "secondary"]);
});

it("额度区有表头「用量周期 / 重置时间」（用户 2026-10-19 的版式）", () => {
  const tree = renderCard(
    statusOf({
      effective: { ref: "a", at: 1 },
      accounts: [
        row("a", {
          label: "A",
          effective: true,
          quota: {
            windows: [
              { key: "5h", percent: 20, resetAt: Date.now() + 3_600_000 },
              { key: "weekly", percent: 50, resetAt: Date.now() + 86_400_000 },
            ],
            failures: [],
          },
        }),
      ],
    }),
  );
  const head = elementsOf(tree).find((element) => element.props["data-sidebar-head"] === "true");
  expect(head).toBeDefined();
  const texts = textsOf(head!).join(" ");
  expect(texts).toContain("用量周期");
  expect(texts).toContain("重置时间");
  // 表头和数据行在**同一个** grid 容器里（否则列宽不共享，又会对不齐）。
  const container = elementsOf(tree).find((element) => element.props["data-sidebar-windows"] === "true")!;
  expect(elementsOf(container).some((element) => element.props["data-sidebar-head"] === "true")).toBe(true);
});
