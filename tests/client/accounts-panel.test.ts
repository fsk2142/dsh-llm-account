/**
 * 平铺账户面板：所有账号在同一列表里，账号名后跟供应商；添加/登录是全局入口。
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
  browserLogin: true,
  modelAccountRules: false,
  quotaShape: "percent",
  modelVisibilityWrite: "immediate",
  automaticSwitch: true,
};

function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

function account(ref: string, label = ref): AccountUsageStatus {
  return { ref, label, configured: true, active: false, effective: false };
}

function status(vendor: string, capabilities: VendorCapabilities, accounts: AccountUsageStatus[]): VendorUsageStatus {
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

function render(overrides: Partial<AccountsPanelProps> = {}): { tree: StubElement; props: AccountsPanelProps } {
  const props: AccountsPanelProps = {
    t: dictionaryOf("zh"),
    vendors: [
      { entry: COMMAND_CODE_ENTRY, status: status("commandcode", COMMAND_CODE, [account("cc-1", "Work")]) },
      { entry: OPENCODE_ENTRY, status: status("dsh-opencode-go", OPENCODE, [account("oc-1", "Personal")]) },
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

function fire(element: StubElement | undefined, name: string): void {
  expect(element, `element with ${name}`).toBeDefined();
  const handler = element!.props[name];
  expect(typeof handler).toBe("function");
  (handler as () => void)();
}

/** 树里所有文本。 */
function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
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

it("账号平铺在同一列表：没有供应商分组标题，账号名后跟供应商标签", () => {
  const { tree } = render();
  const rows = elementsOf(tree).filter((element) => element.props["data-account"] !== undefined);
  expect(rows.map((element) => element.props["data-account"])).toEqual(["cc-1", "oc-1"]);
  const badges = elementsOf(tree)
    .filter((element) => element.props["data-account-vendor"] !== undefined)
    .map((element) => element.props["data-account-vendor"]);
  expect(badges).toEqual(["Command Code", "OpenCode"]);
  expect(elementsOf(tree).filter((element) => element.props["data-accounts-group"] !== undefined)).toEqual([]);
});

it("全局添加入口：Command Code 与 OpenCode 各自路由到自己的厂商", () => {
  const { tree, props } = render();
  const addCc = elementsOf(tree).find((element) => element.props["data-action"] === "add");
  const addOc = elementsOf(tree).find((element) => element.props["data-action"] === "add-dsh-opencode-go");
  fire(addCc, "onClick");
  fire(addOc, "onClick");
  expect(props.onOpenAction).toHaveBeenNthCalledWith(1, "commandcode", { kind: "add" });
  expect(props.onOpenAction).toHaveBeenNthCalledWith(2, "dsh-opencode-go", { kind: "add" });
});

it("全局网页登录入口：两家都能发起；等待时显示 user code 与授权网址", () => {
  const { tree, props } = render();
  fire(elementsOf(tree).find((element) => element.props["data-action"] === "login"), "onClick");
  fire(elementsOf(tree).find((element) => element.props["data-action"] === "login-dsh-opencode-go"), "onClick");
  expect(props.onLoginBegin).toHaveBeenNthCalledWith(1, "commandcode");
  expect(props.onLoginBegin).toHaveBeenNthCalledWith(2, "dsh-opencode-go");

  const waiting = render({
    vendors: [
      {
        entry: OPENCODE_ENTRY,
        status: status("dsh-opencode-go", OPENCODE, []),
        login: { state: "waiting", userCode: "ABCD", authUrl: "https://opencode.ai/device" },
      },
    ],
  }).tree;
  expect(textsOf(waiting).join(" ")).toContain("ABCD");
  expect(elementsOf(waiting).some((element) => element.props["data-login-panel"] === "dsh-opencode-go")).toBe(true);
});

it("没有账号时只显示一次空态；某家状态读不到时原因带厂商名", () => {
  const { tree } = render({
    vendors: [
      { entry: COMMAND_CODE_ENTRY, status: status("commandcode", COMMAND_CODE, []) },
      { entry: OPENCODE_ENTRY, problem: "opencode status read failed" },
    ],
  });
  expect(elementsOf(tree).filter((element) => element.props["data-accounts-empty"] !== undefined)).toHaveLength(1);
  expect(textsOf(tree).join(" ")).toContain("opencode status read failed");
  expect(textsOf(tree).join(" ")).toContain("OpenCode");
});
