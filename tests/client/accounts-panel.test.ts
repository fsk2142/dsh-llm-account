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

it("全局添加入口只剩「网页登录」：每家一个，各自路由到自己的厂商", () => {
  const { tree, props } = render();
  // 2026-10-20 用户要求去掉「使用 API Key」入口（官方入口已提供 API 添加）。
  expect(elementsOf(tree).some((element) => element.props["data-add-for"] !== undefined)).toBe(false);
  const loginCc = elementsOf(tree).find((element) => element.props["data-login-for"] === "commandcode");
  const loginOc = elementsOf(tree).find((element) => element.props["data-login-for"] === "dsh-opencode-go");
  fire(loginCc, "onClick");
  fire(loginOc, "onClick");
  expect(props.onLoginBegin).toHaveBeenNthCalledWith(1, "commandcode");
  expect(props.onLoginBegin).toHaveBeenNthCalledWith(2, "dsh-opencode-go");
});

it("添加入口按厂商分组：每家一个小标题 + 一个「网页登录」动作（2026-10-20 收敛）", () => {
  const { tree } = render();
  const groups = elementsOf(tree).filter((element) => element.props["data-add-vendor-group"] !== undefined);
  expect(groups.map((element) => element.props["data-add-vendor-group"])).toEqual(["commandcode", "dsh-opencode-go"]);
  // 平铺按钮时「往哪家加」只在按钮文字的前缀里；现在每家一块，标题就是厂商名。
  expect(textsOf(groups[0]).join(" ")).toContain("Command Code");
  expect(textsOf(groups[0]).join(" ")).toContain("网页登录");
  // 「使用 API Key」不再出现（用户要求只保留网页授权）。
  expect(textsOf(groups[0]).join(" ")).not.toContain("使用 API Key");
  // 按钮文字不再重复厂商名（标题已经写了），厂商在 data-* 上，自动化与测试都能直接定位。
  expect(textsOf(groups[0]).join(" ")).not.toContain("Command Code · ");
  expect(
    elementsOf(groups[1]).some((element) => element.props["data-login-for"] === "dsh-opencode-go"),
  ).toBe(true);
});

it("失败原因只在开着编辑器的那一家渲染（actionError 与 action 同一条路由）", () => {
  const { tree } = render({
    vendors: [
      {
        entry: COMMAND_CODE_ENTRY,
        status: status("commandcode", COMMAND_CODE, [account("cc-1")]),
        action: { kind: "add", label: "", key: "" },
      },
      { entry: OPENCODE_ENTRY, status: status("dsh-opencode-go", OPENCODE, [account("oc-1")]) },
    ],
    actionError: "请先填写账户名称。",
  });
  const errors = elementsOf(tree).filter((element) => element.props["data-action-error"] !== undefined);
  expect(errors).toHaveLength(1);
  expect(textsOf(errors[0]).join(" ")).toContain("请先填写账户名称。");
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

it("还有厂商在首次读取中时不说「还没有添加任何账户」（加载态与空态不矛盾）", () => {
  const { tree } = render({
    vendors: [
      { entry: COMMAND_CODE_ENTRY, loading: true },
      { entry: OPENCODE_ENTRY, loading: true },
    ],
  });
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain(dictionaryOf("zh")("account.loading"));
  expect(texts).not.toContain(dictionaryOf("zh")("account.empty"));
  expect(elementsOf(tree).filter((element) => element.props["data-accounts-empty"] !== undefined)).toEqual([]);
});

it("面板头部显示账号总数", () => {
  const { tree } = render();
  const count = elementsOf(tree).find((element) => element.props["data-accounts-count"] !== undefined);
  expect(count!.props["data-accounts-count"]).toBe(2);
  expect(textsOf(count!)).toContain(dictionaryOf("zh")("account.count").replace("{n}", "2"));
});

it("按账户刷新模型：每个账号行有自己的刷新按钮，回调带厂商；不传回调就不渲染", () => {
  const onRefreshModels = vi.fn();
  // 没传回调时不渲染任何刷新按钮（旧调用方不受影响）。
  const base = render();
  expect(elementsOf(base.tree).some((element) => element.props["data-account-refresh-models"] !== undefined)).toBe(false);
  // 面板头部不再有全局「重新获取模型」按钮（2026-10-18 用户要求：不是刷新所有的）。
  expect(elementsOf(base.tree).some((element) => element.props["data-refresh-models"] !== undefined)).toBe(false);

  const { tree, props } = render({ onRefreshModels });
  // 两个账号各一个按钮（平铺列表里每行一个），文案是「刷新此账号的模型」。
  const buttons = elementsOf(tree).filter((element) => element.props["data-account-refresh-models"] !== undefined);
  expect(buttons.map((element) => element.props["data-account-refresh-models"])).toEqual(["cc-1", "oc-1"]);
  expect(buttons[0]!.props["aria-label"]).toBe(dictionaryOf("zh")("models.refreshAccount"));
  // 点第一行的：回调带**该账号所属的厂商**（目录是厂商级资源，一次读取惠及该厂商所有账号）。
  fire(buttons[0]!, "onClick");
  expect(props.onRefreshModels).toHaveBeenCalledTimes(1);
  expect(props.onRefreshModels).toHaveBeenCalledWith("commandcode");

  // 这家的目录正在读取：按钮禁用并转圈（aria-busy 挂给样式层）。
  const busy = render({
    onRefreshModels,
    vendors: [
      { entry: COMMAND_CODE_ENTRY, status: status("commandcode", COMMAND_CODE, [account("cc-1", "Work")]), catalogLoading: true },
    ],
  });
  const busyButton = elementsOf(busy.tree).find((element) => element.props["data-account-refresh-models"] !== undefined)!;
  expect(busyButton.props["disabled"]).toBe(true);
  expect(busyButton.props["aria-busy"]).toBe("true");
});

it("目录读失败时原因透传到账号行的模型区（附重试）", () => {
  const onRefreshModels = vi.fn();
  const { tree, props } = render({
    onRefreshModels,
    onSetAccountModels: vi.fn(),
    vendors: [
      {
        entry: COMMAND_CODE_ENTRY,
        status: status("commandcode", COMMAND_CODE, [account("cc-1", "Work")]),
        catalogFailure: "models endpoint failed",
      },
    ],
  });
  // 面板把 catalogFailure 原样交给账户卡片（卡片负责渲染）。
  expect(textsOf(tree).join(" ")).toContain("models endpoint failed");
  const retry = elementsOf(tree).find((element) => element.props["data-account-models-retry"] !== undefined);
  expect(retry, "失败时账号模型区要有重试入口").toBeDefined();
  fire(retry!, "onClick");
  expect(props.onRefreshModels).toHaveBeenCalledTimes(1);
  // 重试与账号行刷新是同一个动作：重读这家（commandcode）的目录。
  expect(props.onRefreshModels).toHaveBeenCalledWith("commandcode");
});

it("目录读取中时账号模型区显示加载文案，而不是整节消失", () => {
  const { tree } = render({
    onSetAccountModels: vi.fn(),
    vendors: [
      {
        entry: COMMAND_CODE_ENTRY,
        status: status("commandcode", COMMAND_CODE, [account("cc-1", "Work")]),
        catalogLoading: true,
      },
    ],
  });
  expect(textsOf(tree).join(" ")).toContain(dictionaryOf("zh")("models.loading"));
  expect(elementsOf(tree).some((element) => element.props["data-account-models-loading"] !== undefined)).toBe(true);
});


// —— 网页登录的三态出口（2026-10-18 报障：点了没反应 / 链接不消失） ——

it("等待面板带「取消登录」：点了必须能关掉（否则链接只能等过期）", () => {
  const onLoginCancel = vi.fn();
  const { tree } = render({
    vendors: [
      {
        entry: OPENCODE_ENTRY,
        status: status("dsh-opencode-go", OPENCODE, []),
        login: { state: "waiting", userCode: "ABCD", authUrl: "https://opencode.ai/device" },
      },
    ],
    onLoginCancel,
  });

  const cancel = elementsOf(tree).find((element) => element.props["data-action"] === "login-cancel");
  expect(cancel, "等待面板里要有取消按钮").toBeDefined();
  expect(cancel!.props["data-login-for"]).toBe("dsh-opencode-go");
  fire(cancel, "onClick");
  expect(onLoginCancel).toHaveBeenCalledWith("dsh-opencode-go");
});

it("登录失败必须说清楚为什么（failed + 稳定原因键 → 专门文案）", () => {
  const { tree } = render({
    vendors: [
      {
        entry: OPENCODE_ENTRY,
        status: status("dsh-opencode-go", OPENCODE, []),
        login: { state: "failed", reason: "timeout" },
      },
    ],
  });

  const failure = elementsOf(tree).find((element) => element.props["data-login-failure"] === "dsh-opencode-go");
  expect(failure, "失败不能静默").toBeDefined();
  expect(failure!.props["data-login-failure-detail"]).toBe("timeout");
  expect(textsOf(failure).join(" ")).toContain("等待授权超时");
});

it("用户自己按的取消不算失败：不渲染红色提示", () => {
  const { tree } = render({
    vendors: [
      {
        entry: OPENCODE_ENTRY,
        status: status("dsh-opencode-go", OPENCODE, []),
        login: { state: "failed", reason: "cancelled" },
      },
    ],
  });

  expect(elementsOf(tree).some((element) => element.props["data-login-failure"] !== undefined)).toBe(false);
});

it("启动中：按钮禁用并显示「正在启动…」（点击到出结果之间不再是空白）", () => {
  const { tree } = render({ loginStarting: { "dsh-opencode-go": true } });

  const button = elementsOf(tree).find((element) => element.props["data-action"] === "login-dsh-opencode-go");
  expect(button!.props["disabled"]).toBe(true);
  expect(button!.props["aria-busy"]).toBe("true");
  const note = elementsOf(tree).find((element) => element.props["data-login-starting"] === "dsh-opencode-go");
  expect(note).toBeDefined();
  expect(textsOf(note).join(" ")).toContain("正在启动网页登录");
});

it("调用没发出去（远程面缺席/抛错）：通用人话 + 原文留在 data-* 上", () => {
  const { tree } = render({
    loginError: { opendesign: "the llm-account remote is unavailable" },
    vendors: [
      {
        entry: { ...OPENCODE_ENTRY, providerId: "opendesign", ns: "llm-opendesign", labelKey: "vendor.opendesign" },
        status: status("opendesign", OPENCODE, []),
      },
    ],
  });

  const error = elementsOf(tree).find((element) => element.props["data-login-error"] === "opendesign");
  expect(error, "调用失败也要有出口").toBeDefined();
  expect(error!.props["data-login-error-detail"]).toBe("the llm-account remote is unavailable");
  // 上屏的是人话，不是宿主原文。
  const shown = textsOf(error).join(" ");
  expect(shown).toContain("网页登录没能启动");
  expect(shown).not.toContain("the llm-account remote is unavailable");
});

it("再点一次「新增账户」= 收起区块：通知容器把表单与等待中的登录一起收掉", () => {
  const onCollapseAddChooser = vi.fn();
  const { tree } = render({ onCollapseAddChooser });
  const details = elementsOf(tree).find((element) => element.props["data-add-chooser"] !== undefined);
  expect(details, "添加区块是一个 details").toBeDefined();

  const onToggle = details!.props["onToggle"] as (event: { currentTarget?: { open?: boolean } }) => void;

  // 展开（open: true）不触发。
  onToggle({ currentTarget: { open: true } });
  expect(onCollapseAddChooser).not.toHaveBeenCalled();

  // 收起才触发。
  onToggle({ currentTarget: { open: false } });
  expect(onCollapseAddChooser).toHaveBeenCalledTimes(1);
});
