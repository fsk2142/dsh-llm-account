/**
 * 侧边栏标题：`账号 · 厂商 ……… [套餐]`（用户 2026-10-21 要求）。
 *
 * 用户原话：「侧边栏现在只有账号名显示，没有对应个网关厂商显示了，最好把套餐类型也标出来」
 * + 「账号 · 厂商 ……… [套餐] 这样更好，套餐类型靠右对齐」
 * + 「厂商、套餐类型的名字颜色和用量周期那些一样，只有账号名称加黑加粗」。
 *
 * 这里钉住：三样信息各自出现、账号名单独一个元素（配色靠它）、
 * 厂商与套餐**查不到时都不占位**（不编造、也不冒内部标识符）。
 */
import { describe, expect, it, vi } from "vitest";

import { SidebarCard } from "../../src/client/sidebar-card";
import type { VendorUsageStatus } from "../../src/client/usage-contract";

/** 极简取词：只认本用例关心的键，其余原样返回键名（模拟「词表里没有」）。 */
function dictionary(extra: Record<string, string> = {}): (key: string) => string {
  const table: Record<string, string> = {
    "sidebar.open": "点击打开用量面板",
    "sidebar.usagePeriod": "用量周期",
    "sidebar.resetTime": "重置时间",
    "account.plan": "套餐",
    "quota.planMonthly": "每月 {amount}",
    "vendor.commandcode": "Command Code",
    ...extra,
  };
  return (key: string) => table[key] ?? key;
}

/** 造一份厂商状态：一个账号、带套餐、带一个 5 小时窗口。 */
function statusWith(plan: { id: string; name?: string; monthlyCredits?: number } | undefined): VendorUsageStatus {
  return {
    vendor: "commandcode",
    accounts: [
      {
        ref: "COMMANDCODE_API_KEY",
        label: "sample-user",
        configured: true,
        active: true,
        effective: true,
        ...(plan === undefined
          ? {}
          : { quota: { plan, windows: [{ key: "fiveHour", percent: 20 }], failures: [] } }),
      },
    ],
    failures: [],
  } as unknown as VendorUsageStatus;
}

/** 收集树里所有元素。 */
function elements(node: unknown): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = [];
  const walk = (value: unknown): void => {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const element = value as { props?: Record<string, unknown> };
    if (element.props === undefined) return;
    out.push({ props: element.props });
    walk(element.props.children);
  };
  walk(node);
  return out;
}

/** 渲染一次。 */
function render(options: {
  status?: VendorUsageStatus;
  vendorLabelKey?: string;
}): { props: Record<string, unknown> }[] {
  return elements(
    SidebarCard({
      t: dictionary(),
      status: options.status ?? statusWith(undefined),
      ...(options.vendorLabelKey === undefined ? {} : { vendorLabelKey: options.vendorLabelKey }),
      onOpen: vi.fn(),
    }),
  );
}

describe("侧边栏标题的三样信息", () => {
  it("账号名在自己的元素里（配色靠它：加黑加粗）", () => {
    const account = render({ vendorLabelKey: "vendor.commandcode" }).find(
      (element) => element.props["data-sidebar-account"] !== undefined,
    );
    expect(account).toBeDefined();
    expect(account?.props.children).toBe("sample-user");
  });

  it("厂商名显示出来（这是用户报障的那一项）", () => {
    const vendor = render({ vendorLabelKey: "vendor.commandcode" }).find(
      (element) => element.props["data-sidebar-vendor"] !== undefined,
    );
    expect(vendor).toBeDefined();
    expect(vendor?.props.children).toBe("Command Code");
  });

  it("套餐徽标只显示档位名：不带金额，也不加悬浮提示", () => {
    // 用户 2026-10-21：「不用这个悬浮显示，没必要」。
    // 一行能读到的是档位名本身，金额不必再藏进 title。
    const tree = render({
      status: statusWith({ id: "individual-goat", name: "GOAT", monthlyCredits: 70 }),
      vendorLabelKey: "vendor.commandcode",
    });
    const plan = tree.find((element) => element.props["data-sidebar-plan"] !== undefined);
    expect(plan).toBeDefined();
    expect(plan?.props["data-sidebar-plan"]).toBe("GOAT");
    expect(plan?.props.title).toBeUndefined();
    expect(String(plan?.props.children)).not.toContain("$");
  });

  it("没有套餐信息时不渲染徽标（不占位、不编造）", () => {
    const tree = render({ status: statusWith(undefined), vendorLabelKey: "vendor.commandcode" });
    expect(tree.some((element) => element.props["data-sidebar-plan"] !== undefined)).toBe(false);
  });

  it("厂商键在词表里查不到时不显示（避免冒出 vendor.xxx 这种内部标识）", () => {
    const tree = render({ vendorLabelKey: "vendor.unknown" });
    expect(tree.some((element) => element.props["data-sidebar-vendor"] !== undefined)).toBe(false);
  });

  it("容器没给 vendorLabelKey 时，账号与套餐照常显示（不因为新字段缺失而空白）", () => {
    const tree = render({ status: statusWith({ id: "goat", name: "GOAT" }) });
    expect(tree.some((element) => element.props["data-sidebar-account"] !== undefined)).toBe(true);
    expect(tree.some((element) => element.props["data-sidebar-plan"] !== undefined)).toBe(true);
    expect(tree.some((element) => element.props["data-sidebar-vendor"] !== undefined)).toBe(false);
  });
});
