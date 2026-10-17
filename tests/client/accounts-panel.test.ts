/**
 * 合并账户面板：一张卡片、两家分组、动作按厂商路由。
 *
 * 这不是「渲染得像不像」，而是验证容器接线最关键的一条：同一个「添加/固定/登录」控件
 * 出现在哪一家分组里，回调就必须带上哪一家的 provider id。
 */
import { expect, it, vi } from "vitest";

import { AccountsPanel, type AccountsPanelProps } from "../../src/client/accounts-panel";
import { dictionaryOf } from "../../src/client/copy";
import type { VendorEntry } from "../../src/client/registry";
import type { AccountUsageStatus, VendorCapabilities, VendorUsageStatus } from "../../src/client/usage-contract";
import type { StubElement } from "../support/react-stub";

const COMMAND_CODE: VendorCapabilities = {
  reorder: true,
  pin: true,
  browserLogin: true,
  modelAccountRules: true,
  quotaShape: "windows",
  modelVisibilityWrite: "onSave",
  automaticSwitch: true,
};
const OPENCODE: VendorCapabilities = {
  reorder: true,
  pin: false,
  browserLogin: false,
  modelAccountRules: false,
  quotaShape: "percent",
  modelVisibilityWrite: "immediate",
  automaticSwitch: true,
};

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 一份最小账号行。 */
function account(ref: string): AccountUsageStatus {
  return { ref, label: ref, configured: true, active: false, effective: false };
}

/** 一份最小状态。 */
function status(vendor: string, capabilities: VendorCapabilities, accounts: AccountUsageStatus[] = [account("a")]): VendorUsageStatus {
  return { vendor, capabilities, pinned: null, accounts, failures: [] };
}

const COMMAND_CODE_ENTRY: VendorEntry = {
  ns: "llm-commandcode",
  rowIds: ["llm-commandcode"],
  providerId: "commandcode",
  order: 12,
  labelKey: "vendor.commandcode",
  cards: [],
};
const OPENCODE_ENTRY: VendorEntry = {
  ns: "llm-opencode-go",
  rowIds: ["opencode-go", "llm-opencode-go"],
  providerId: "dsh-opencode-go",
  order: 20,
  labelKey: "vendor.opencodeGo",
  cards: [],
};

/** 渲染一次。 */
function render(overrides: Partial<AccountsPanelProps> = {}): { tree: StubElement; props: AccountsPanelProps } {
  const props: AccountsPanelProps = {
    t: dictionaryOf("zh"),
    vendors: [
      { entry: COMMAND_CODE_ENTRY, status: status("commandcode", COMMAND_CODE) },
      { entry: OPENCODE_ENTRY, status: status("dsh-opencode-go", OPENCODE) },
    ],
    onOpenAction: vi.fn(),
    onActionField: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onToggleExpand: vi.fn(),
    onLoginBegin: vi.fn(),
    ...overrides,
  };
  return { tree: AccountsPanel(props), props };
}

/** 某一家分组里的全部元素。 */
function groupOf(tree: StubElement, vendor: string): StubElement {
  const group = elementsOf(tree).find((element) => element.props["data-accounts-vendor"] === vendor);
  expect(group, `group for ${vendor}`).toBeDefined();
  return group!;
}

/** 某一家分组里的一个菜单/行内动作按钮。 */
function actionIn(tree: StubElement, vendor: string, action: string): StubElement | undefined {
  return elementsOf(groupOf(tree, vendor).props.children).find((element) => element.props["data-action"] === action);
}

/** 触发回调。 */
function fire(element: StubElement | undefined, name: string): void {
  expect(element, `element with ${name}`).toBeDefined();
  const handler = element!.props[name];
  expect(typeof handler).toBe("function");
  (handler as () => void)();
}

it("两家在同一个卡片里各成一个分组，顺序与传入顺序一致", () => {
  const { tree } = render();
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-accounts-vendor"] !== undefined)
    .map((element) => element.props["data-accounts-vendor"]);
  expect(groups).toEqual(["commandcode", "dsh-opencode-go"]);
  // 行渲染复用共享实现：每家分组里都有自己的账号行。
  expect(elementsOf(groupOf(tree, "commandcode").props.children).some((element) => element.props["data-account"] === "a")).toBe(true);
  expect(elementsOf(groupOf(tree, "dsh-opencode-go").props.children).some((element) => element.props["data-account"] === "a")).toBe(true);
});

it("「添加账户」把动作路由到所在分组的那一家", () => {
  const { tree, props } = render();
  fire(actionIn(tree, "dsh-opencode-go", "add"), "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith("dsh-opencode-go", { kind: "add" });
});

it("固定账号只出现在声明了 pin 的能力矩阵里，并带上厂商", () => {
  const { tree, props } = render();
  const pin = actionIn(tree, "commandcode", "pin");
  expect(pin).toBeDefined();
  fire(pin, "onClick");
  expect(props.onSelect).toHaveBeenCalledWith("commandcode", "a");
  // OpenCode 的 pin 是 false：它的菜单里没有固定项。
  expect(actionIn(tree, "dsh-opencode-go", "pin")).toBeUndefined();
});

it("某一家读不到状态时，原因显示在它自己的分组里", () => {
  const { tree } = render({
    vendors: [
      { entry: COMMAND_CODE_ENTRY, status: status("commandcode", COMMAND_CODE) },
      { entry: OPENCODE_ENTRY, problem: "opencode status read failed" },
    ],
  });
  const problem = elementsOf(groupOf(tree, "dsh-opencode-go").props.children).find(
    (element) => element.props["data-usage-problem"] !== undefined,
  );
  expect(problem?.props.children).toBe("opencode status read failed");
});

it("网页登录入口按厂商路由；没有能力的那家不出现", () => {
  const { tree, props } = render();
  fire(actionIn(tree, "commandcode", "login"), "onClick");
  expect(props.onLoginBegin).toHaveBeenCalledWith("commandcode");
  expect(actionIn(tree, "dsh-opencode-go", "login")).toBeUndefined();
});
