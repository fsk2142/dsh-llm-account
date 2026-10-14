/**
 * Task 6 测试：OpenCode 账户卡片（排序与 autoSwitch）。
 *
 * 卡片同样是**纯 props → 元素树**（Ruling 22/29）：排序与开关的当前值由页面状态/设置快照给出，
 * 卡片只把「用户想做什么」报出去；真正的调用参数由 `dispatchAccountAction` 与这两个新回调决定。
 */
import { expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { OpenCodeAccountCard, type OpenCodeAccountCardProps } from "../../src/client/opencode-account-card";
import type { AccountUsageStatus, VendorCapabilities, VendorUsageStatus } from "../../src/client/usage-contract";
import type { StubElement } from "../support/react-stub";

/** OpenCode 的能力矩阵（规格 §7.3：可排序、无 pin、无网页登录）。 */
const OPENCODE: VendorCapabilities = {
  reorder: true,
  pin: false,
  browserLogin: false,
  modelAccountRules: false,
  quotaShape: "percent",
  modelVisibilityWrite: "immediate",
  automaticSwitch: true,
};

/** Command Code 的矩阵（不可排序）——用来验证降级。 */
const COMMAND_CODE: VendorCapabilities = { ...OPENCODE, reorder: false, pin: true, browserLogin: true };

/** 一个账号行。 */
function row(ref: string, overrides: Partial<AccountUsageStatus> = {}): AccountUsageStatus {
  return { ref, label: ref, configured: true, active: false, effective: false, ...overrides };
}

/** 一份状态。 */
function statusOf(accounts: AccountUsageStatus[], capabilities: VendorCapabilities = OPENCODE): VendorUsageStatus {
  return { vendor: "dsh-opencode-go", capabilities, pinned: null, accounts, failures: [] };
}

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

/** 渲染一次卡片。 */
function renderCard(overrides: Partial<OpenCodeAccountCardProps> & Pick<OpenCodeAccountCardProps, "status">): {
  tree: StubElement;
  props: OpenCodeAccountCardProps;
} {
  const props: OpenCodeAccountCardProps = {
    t: dictionaryOf("zh"),
    settings: {},
    onOpenAction: vi.fn(),
    onActionField: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onToggleExpand: vi.fn(),
    onLoginBegin: vi.fn(),
    onMove: vi.fn(),
    onSetAutoSwitch: vi.fn(),
    ...overrides,
  };
  return { tree: OpenCodeAccountCard(props), props };
}

/** 触发一个元素的回调。 */
function fire(element: StubElement, name: string, event: unknown = {}): void {
  const handler = element.props[name];
  expect(typeof handler, `${name} handler`).toBe("function");
  (handler as (value: unknown) => void)(event);
}

// —— Step 1：排序 ——

it("上移/下移把目标 ref 与**最终下标**交给 onMove（能力支持时）", () => {
  const { tree, props } = renderCard({
    status: statusOf([row("a"), row("b"), row("c")]),
  });
  const moves = elementsOf(tree).filter((element) => element.props["data-move"] !== undefined);
  // 三个账号 × 上/下 = 6 个控件；首行的「上移」与末行的「下移」禁用（不能越界）。
  expect(moves.map((element) => [element.props["data-move-ref"], element.props["data-move"], element.props.disabled])).toEqual([
    ["a", "up", true],
    ["a", "down", false],
    ["b", "up", false],
    ["b", "down", false],
    ["c", "up", false],
    ["c", "down", true],
  ]);

  const down = moves.find((element) => element.props["data-move-ref"] === "a" && element.props["data-move"] === "down")!;
  fire(down, "onClick");
  expect(props.onMove).toHaveBeenCalledWith("a", 1);

  const up = moves.find((element) => element.props["data-move-ref"] === "c" && element.props["data-move"] === "up")!;
  fire(up, "onClick");
  expect(props.onMove).toHaveBeenLastCalledWith("c", 1);
});

it("不支持排序的厂商（commandcode）没有移动控件", () => {
  const { tree } = renderCard({ status: statusOf([row("a"), row("b")], COMMAND_CODE) });
  expect(elementsOf(tree).filter((element) => element.props["data-move"] !== undefined)).toEqual([]);
});

// —— Step 1：autoSwitch ——

it("autoSwitch 开关读当前值，拨动时**立即**调用 onSetAutoSwitch（不等保存条）", () => {
  const off = renderCard({ status: statusOf([row("a")]), settings: { autoSwitch: false } });
  const toggle = elementsOf(off.tree).find((element) => element.props["data-auto-switch"] !== undefined)!;
  expect(toggle.props.checked).toBe(false);
  fire(toggle, "onChange", { target: { checked: true } });
  expect(off.props.onSetAutoSwitch).toHaveBeenCalledWith(true);

  const on = renderCard({ status: statusOf([row("a")]), settings: { autoSwitch: true } });
  const onToggle = elementsOf(on.tree).find((element) => element.props["data-auto-switch"] !== undefined)!;
  expect(onToggle.props.checked).toBe(true);
  fire(onToggle, "onChange", { target: { checked: false } });
  expect(on.props.onSetAutoSwitch).toHaveBeenCalledWith(false);
});

it("设置文档里没有 autoSwitch 时按关闭处理（默认值），不编造 true", () => {
  const { tree } = renderCard({ status: statusOf([row("a")]), settings: {} });
  const toggle = elementsOf(tree).find((element) => element.props["data-auto-switch"] !== undefined)!;
  expect(toggle.props.checked).toBe(false);
});

// —— Step 1：rename 不改 ref ——

it("重命名只改名称：打开重命名时带上 ref，卡片不自己重推 ref", () => {
  const { tree, props } = renderCard({
    status: statusOf([row("a", { label: "work" })]),
    action: { kind: "rename", ref: "a", label: "renamed", key: "" },
  });
  const elements = elementsOf(tree);

  // 编辑器绑定的目标 ref 必须是原 ref（不是名称、也不是新推导出来的东西）。
  const editor = elements.find((element) => element.props["data-editor"] === "rename")!;
  expect(editor.props["data-editor-ref"]).toBe("a");
  expect(elements.find((element) => element.props["data-rename-input"] !== undefined)!.props.value).toBe("renamed");

  fire(elements.find((element) => element.props["data-action"] === "confirmRename")!, "onClick");
  expect(props.onConfirmAction).toHaveBeenCalledTimes(1);
  // 重命名走的是账户操作（`renameAccount(vendor, ref, label)`），不是设置字段。
  expect(props).not.toHaveProperty("onSetField");
});

// —— 与共享卡片一致的底线 ——

it("额度缺失仍然不渲染成 0，且账号行沿用共享卡片的形状", () => {
  const { tree } = renderCard({
    status: statusOf([row("a", { quota: { windows: [{ key: "rolling" }], failures: [] } })]),
  });
  const window = elementsOf(tree).find((element) => element.props["data-quota-window"] === "rolling")!;
  expect(textsOf(window)).toContain(dictionaryOf("zh")("account.quotaMissing"));
  expect(textsOf(window).join(" ")).not.toMatch(/\b0\b/);
});

it("opencode 没有 pin 与网页登录能力，卡片也不渲染它们", () => {
  const { tree } = renderCard({ status: statusOf([row("a")]) });
  const elements = elementsOf(tree);
  expect(elements.filter((element) => element.props["data-action"] === "pin")).toEqual([]);
  expect(elements.filter((element) => element.props["data-action"] === "login")).toEqual([]);
  // 但账户操作仍然在（重命名/换密钥/移除）。
  expect(elements.filter((element) => element.props["data-action"] === "rename")).toHaveLength(1);
});

it("状态还没到时给出说明而不是空白", () => {
  const { tree } = renderCard({ status: undefined });
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.quotaMissing"));
});
