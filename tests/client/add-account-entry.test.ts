/**
 * 新增账号只剩「网页登录」（2026-10-20 用户要求）。
 *
 * 理由（用户原话）：「API 登录基本没什么用处，毕竟官方入口也留了 API 添加」。核对下来这条
 * 对 Open Design 尤其成立 —— 纯 API key 账号拿不到套餐、workspaceId 与周期额度（账单只走
 * vela 控制面，而控制面凭据只有网页登录产物会产出）；另两家纯 API key 能用，但既然官方
 * 入口已经提供 API 添加，插件里就不必再摆一个更容易出错的重复入口。
 *
 * 三家的 `browserLogin` 能力都是 `true`，所以「只留网页登录」不会让任何一家失去添加入口 ——
 * 这条前提本身就值得钉住：哪天某家不再支持网页登录，它的添加路径会**整条消失**。
 *
 * 保留的东西（用户明确要求）：
 * - 已用 API key 建好的账号仍然可以「更换密钥」——那类账号唯一的维修路径；
 * - 底层的 `addAccount` 能力不删（官方入口与命令行仍可用，以后想加回来不用重写）。
 */
import { describe, expect, it, vi } from "vitest";

import { AccountsPanel, type AccountsPanelProps } from "../../src/client/accounts-panel";
import type { VendorEntry } from "../../src/client/registry";
import type { VendorUsageStatus } from "../../src/client/usage-contract";
import type { StubElement } from "../support/react-stub";

const t = (key: string): string => key;

/** 一个厂商声明（只填面板会用到的字段）。 */
function entry(providerId: string, ns: string, labelKey: string, order: number): VendorEntry {
  return { ns, rowIds: [ns], providerId, order, labelKey, cards: [] } as unknown as VendorEntry;
}

/** 一条厂商状态：一个已配置的账号。 */
function statusOf(vendor: string): VendorUsageStatus {
  return {
    vendor,
    capabilities: {
      reorder: true,
      pin: true,
      browserLogin: true,
      modelAccountRules: true,
      quotaShape: "windows",
      modelVisibilityWrite: "onSave",
      automaticSwitch: true,
    },
    pinned: null,
    accounts: [{ ref: "acc-1", label: "Account 1", configured: true, active: true, effective: true }],
    failures: [],
  };
}

/** 三家都在的面板属性。 */
function panelProps(): AccountsPanelProps {
  return {
    t,
    vendors: [
      { entry: entry("commandcode", "llm-commandcode", "vendor.commandcode", 1), status: statusOf("commandcode") },
      { entry: entry("dsh-opencode-go", "llm-opencode-go", "vendor.opencode", 2), status: statusOf("dsh-opencode-go") },
      { entry: entry("opendesign", "llm-opendesign", "vendor.opendesign", 3), status: statusOf("opendesign") },
    ] as never,
    onOpenAction: vi.fn(),
    onActionField: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onToggleExpand: vi.fn(),
    onLoginBegin: vi.fn(),
  };
}

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 按 data 属性找全部元素。 */
function findAll(tree: unknown, attribute: string, value?: string): StubElement[] {
  return elementsOf(tree).filter((element) => {
    const actual = (element.props as Record<string, unknown>)[attribute];
    return value === undefined ? actual !== undefined : actual === value;
  });
}

describe("新增账号入口", () => {
  it("三家都不再有「新增账号（API key）」按钮", () => {
    const tree = AccountsPanel(panelProps());
    // 旧入口：`data-add-for`（每家一个）。
    expect(findAll(tree, "data-add-for")).toHaveLength(0);
  });

  it("三家都仍然有「网页登录」按钮（一家都不能失去添加入口）", () => {
    const tree = AccountsPanel(panelProps());
    expect(findAll(tree, "data-login-for")).toHaveLength(3);
  });

  it("每家的网页登录按钮都指向自己（不能把三家都塞成同一家）", () => {
    const tree = AccountsPanel(panelProps());
    const vendors = findAll(tree, "data-login-for").map((element) => element.props["data-login-for"]);
    expect(vendors).toEqual(["commandcode", "dsh-opencode-go", "opendesign"]);
  });

  it("添加区块仍然给一句说明（去掉一种入口后，用户要知道现在怎么加）", () => {
    const tree = AccountsPanel(panelProps());
    // 说明文案保留：入口变化不该让这一段变成没有解释的一排按钮。
    expect(findAll(tree, "data-add-chooser")).toHaveLength(1);
  });
});
