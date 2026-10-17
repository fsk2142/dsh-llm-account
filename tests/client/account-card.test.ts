/**
 * Task 5 测试：Command Code 账户卡片。
 *
 * 卡片是**纯 props → 元素树**（与 `page.ts` 同样的纪律，Ruling 22）：测试直接调用它并遍历返回的
 * 树，用 `data-*` 标记定位控件、用回调断言「点了会发生什么」。
 *
 * 本文件覆盖计划 T5 Step 1 的三条与 Step 6/7 的验收点：
 * 1. 额度缺失**不得渲染成 0**；
 * 2. `⋯` 菜单按能力降级（无排序能力时没有手柄、无 pin 能力时没有固定项）；
 * 3. 密钥输入**只**走 `onReplaceKey`（不能变成设置字段、不能被回显）；
 * 4. 固定账号与生效账号不同时两个都标注（§8.1 第 4 条）；
 * 5. 登录失败原因可读（含 `credential-slot-taken`）。
 */
import { expect, it, vi } from "vitest";

import { AccountCard, type AccountCardProps } from "../../src/client/account-card";
import { dictionaryOf } from "../../src/client/copy";
import type { AccountUsageStatus, VendorCapabilities, VendorUsageStatus } from "../../src/client/usage-contract";
import type { StubElement } from "../support/react-stub";

/** Command Code 的能力矩阵（规格 §7.3）。 */
const COMMAND_CODE: VendorCapabilities = {
  reorder: false,
  pin: true,
  browserLogin: true,
  modelAccountRules: true,
  quotaShape: "windows",
  modelVisibilityWrite: "onSave",
  automaticSwitch: true,
};

/** OpenCode 的能力矩阵（无 pin、无网页登录、可排序）。 */
const OPENCODE: VendorCapabilities = {
  reorder: true,
  pin: false,
  browserLogin: false,
  modelAccountRules: false,
  quotaShape: "percent",
  modelVisibilityWrite: "immediate",
  automaticSwitch: true,
};

/** 一个账号行；默认「已配置 + 有 5h 额度」。 */
function row(overrides: Partial<AccountUsageStatus> & Pick<AccountUsageStatus, "ref">): AccountUsageStatus {
  return { label: overrides.ref, configured: true, active: false, effective: false, ...overrides };
}

/** 一份状态。 */
function statusOf(options: {
  capabilities?: VendorCapabilities;
  accounts: AccountUsageStatus[];
  pinned?: string | null;
  effective?: string;
}): VendorUsageStatus {
  return {
    vendor: "commandcode",
    capabilities: options.capabilities ?? COMMAND_CODE,
    pinned: options.pinned === undefined ? null : options.pinned,
    ...(options.effective === undefined ? {} : { effective: { ref: options.effective, at: 1_700_000_000_000 } }),
    accounts: options.accounts,
    failures: [],
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

/** 树里所有文本（已修剪），便于断言「某段文字出现了/没出现」。 */
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

/** 渲染一次卡片；除覆盖项外所有回调都是 vi.fn()。 */
function renderCard(overrides: Partial<AccountCardProps> & Pick<AccountCardProps, "status">): {
  tree: StubElement;
  props: AccountCardProps;
} {
  const props: AccountCardProps = {
    t: dictionaryOf("zh"),
    onOpenAction: vi.fn(),
    onActionField: vi.fn(),
    onConfirmAction: vi.fn(),
    onCancelAction: vi.fn(),
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onToggleExpand: vi.fn(),
    onLoginBegin: vi.fn(),
    ...overrides,
  };
  return { tree: AccountCard(props), props };
}

/** 触发一个元素的回调（模拟用户操作）。 */
function fire(element: StubElement, name: string, event: unknown = {}): void {
  const handler = element.props[name];
  expect(typeof handler, `${name} handler`).toBe("function");
  (handler as (value: unknown) => void)(event);
}

// —— Step 1：额度缺失不渲染成 0 ——

it("额度字段缺失时显示「暂无数据」，绝不渲染成 0", () => {
  const { tree } = renderCard({
    status: statusOf({
      accounts: [
        row({
          ref: "a",
          quota: { windows: [{ key: "5h" }, { key: "weekly", used: 0, cap: 0 }], failures: [] },
        }),
      ],
    }),
  });

  const windows = elementsOf(tree).filter((element) => element.props["data-quota-window"] !== undefined);
  expect(windows.map((element) => element.props["data-quota-window"])).toEqual(["5h", "weekly"]);
  // 第一个窗口什么数都没有：文案是「暂无额度数据」，**不是** 0/0 或 0%。
  expect(textsOf(windows[0])).toContain(dictionaryOf("zh")("account.quotaMissing"));
  expect(textsOf(windows[0]).join(" ")).not.toMatch(/\b0\b/);
  // 第二个窗口是真的 0/0（厂商就是这么报告的）：按原样显示，和「缺失」区分开。
  expect(textsOf(windows[1]).join(" ")).toContain("0/0");
});

it("没有额度摘要的账号连额度条都不渲染（缺失不是 0）", () => {
  const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  expect(elementsOf(tree).filter((element) => element.props["data-quota-window"] !== undefined)).toEqual([]);
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.quotaMissing"));
});

it("百分比形状的读数（opencode）同样只按存在的字段渲染", () => {
  const { tree } = renderCard({
    status: statusOf({
      capabilities: OPENCODE,
      accounts: [row({ ref: "a", quota: { windows: [{ key: "rolling", percent: 40 }], failures: [] } })],
    }),
  });
  const window = elementsOf(tree).find((element) => element.props["data-quota-window"] === "rolling")!;
  expect(textsOf(window).join(" ")).toContain("40%");
  expect(textsOf(window).join(" ")).not.toContain("0/0");
});

// —— Step 1：菜单按能力降级 ——

it("`⋯` 菜单按能力降级：无排序能力时没有拖拽手柄，无 pin 能力时没有固定项", () => {
  const commandCode = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) }).tree;
  const ccElements = elementsOf(commandCode);
  // commandcode：`reorder: false` → 没有手柄；`pin: true` → 有固定项；`browserLogin: true` → 有登录按钮。
  expect(ccElements.filter((element) => element.props["data-drag-handle"] !== undefined)).toEqual([]);
  expect(ccElements.filter((element) => element.props["data-action"] === "pin")).toHaveLength(1);
  expect(ccElements.filter((element) => element.props["data-action"] === "login")).toHaveLength(1);

  const opencode = renderCard({
    status: statusOf({ capabilities: OPENCODE, accounts: [row({ ref: "a" })] }),
  }).tree;
  const ocElements = elementsOf(opencode);
  // opencode：`reorder: true` → 有手柄；`pin: false` → 没有固定项；没有网页登录 → 没有登录按钮。
  expect(ocElements.filter((element) => element.props["data-drag-handle"] !== undefined)).toHaveLength(1);
  expect(ocElements.filter((element) => element.props["data-action"] === "pin")).toEqual([]);
  expect(ocElements.filter((element) => element.props["data-action"] === "login")).toEqual([]);
});

it("菜单操作打开对应操作并带上目标账号（值与提交由页面状态负责）", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a", label: "Account A" }), row({ ref: "b" })] }),
  });
  const elements = elementsOf(tree);

  fire(elements.find((element) => element.props["data-action"] === "pin")!, "onClick");
  expect(props.onSelect).toHaveBeenCalledWith("a");
  fire(elements.find((element) => element.props["data-action"] === "rename")!, "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith({ kind: "rename", ref: "a" });
  fire(elements.find((element) => element.props["data-action"] === "replaceKey")!, "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith({ kind: "key", ref: "a" });
  fire(elements.find((element) => element.props["data-action"] === "remove")!, "onClick");
  expect(props.onRemove).toHaveBeenCalledWith("a");
});

it("展开报告按钮切换展开状态", () => {
  const collapsed = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  const toggle = elementsOf(collapsed.tree).find((element) => element.props["data-action"] === "expand")!;
  expect(toggle.props["aria-expanded"]).toBe(false);
  fire(toggle, "onClick");
  expect(collapsed.props.onToggleExpand).toHaveBeenCalledWith("a");

  // 展开态：完整报告区出现（额度窗口在这里也渲染一遍）。
  const expanded = renderCard({
    status: statusOf({
      accounts: [row({ ref: "a", quota: { windows: [{ key: "5h", used: 3, cap: 10 }], failures: ["billing: timeout"] } })],
    }),
    expandedRef: "a",
  });
  const elements = elementsOf(expanded.tree);
  expect(elements.find((element) => element.props["data-action"] === "expand")!.props["aria-expanded"]).toBe(true);
  const report = elements.find((element) => element.props["data-report"] === "a")!;
  expect(textsOf(report).join(" ")).toContain("3/10");
  expect(textsOf(report).join(" ")).toContain("timeout");
});

it("「添加账户」是收起的入口：点它只打开表单，不提交", () => {
  // 回归：先前入口与提交是同一个按钮。空字段点下去派发按规矩不发调用，于是**这一次点击
  // 没有任何可见反应** —— 用户看到的是「按钮坏了」。
  const { tree, props } = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  const trigger = elementsOf(tree).find((element) => element.props["data-action"] === "add")!;
  // 收起状态下没有输入框：表单是点开才有的。
  expect(elementsOf(tree).find((element) => element.props["data-add-label"] !== undefined)).toBeUndefined();
  fire(trigger, "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith({ kind: "add" });
  expect(props.onConfirmAction).not.toHaveBeenCalled();
});

it("表单打开后是受控输入：值来自状态，变化与提交各自报出去", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "add", label: "work", key: "sk-1" },
  });
  const elements = elementsOf(tree);

  // 受控：输入框显示的就是状态里的值（卡片自己不留状态）。
  expect(elements.find((element) => element.props["data-add-label"] !== undefined)!.props.value).toBe("work");
  expect(elements.find((element) => element.props["data-add-key"] !== undefined)!.props.value).toBe("sk-1");

  fire(elements.find((element) => element.props["data-add-label"] !== undefined)!, "onChange", { target: { value: "work-2" } });
  expect(props.onActionField).toHaveBeenCalledWith("label", "work-2");

  // 提交是表单里那个独立的按钮，不再是那个入口。
  fire(elements.find((element) => element.props["data-action"] === "confirmAdd")!, "onClick");
  expect(props.onConfirmAction).toHaveBeenCalledTimes(1);
});

// —— Step 1：密钥只走 onReplaceKey ——

it("密钥输入只经过 onConfirmAction：不是设置字段、受控且不回显、不碰其它回调", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "key", ref: "a", label: "", key: "sk-secret" },
  });
  const elements = elementsOf(tree);

  const input = elements.find((element) => element.props["data-key-input"] === "a")!;
  // 密钥输入**不能**带 `data-field`：那个标记是设置字段的通道，带上它就会进草稿/保存条。
  expect(input.props["data-field"]).toBeUndefined();
  // 受控：显示状态里的值。
  expect(input.props.value).toBe("sk-secret");
  fire(input, "onChange", { target: { value: "sk-rotated" } });
  expect(props.onActionField).toHaveBeenCalledWith("key", "sk-rotated");

  const confirm = elements.find((element) => element.props["data-action"] === "confirmKey")!;
  fire(confirm, "onClick");
  expect(props.onConfirmAction).toHaveBeenCalledTimes(1);
  // 密钥**不进设置草稿**：卡片从不把密钥交给设置字段的那条通道（没有 onSetField 这类 prop）。
  expect(Object.keys(props)).not.toContain("onSetField");
});

it("非编辑态下没有密钥输入框（避免把密钥长期摆在界面上）", () => {
  const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  expect(elementsOf(tree).filter((element) => element.props["data-key-input"] !== undefined)).toEqual([]);
  // 密钥草稿不应因为别的账号在编辑而泄露到界面上。
  const other = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" }), row({ ref: "b" })] }),
    action: { kind: "key", ref: "b", label: "", key: "sk-only-for-b" },
  });
  const rows = elementsOf(other.tree).filter((element) => element.props["data-account"] !== undefined);
  const first = rows.find((element) => element.props["data-account"] === "a")!;
  expect(textsOf(first).join(" ")).not.toContain("sk-only-for-b");
});

// —— Step 6：固定账号与生效账号并列标注 ——

it("固定账号与生效账号不同时，两个都标注（§8.1 第 4 条）", () => {
  const { tree } = renderCard({
    status: statusOf({
      pinned: "a",
      effective: "b",
      accounts: [row({ ref: "a", label: "Account A", active: true }), row({ ref: "b", label: "Account B", effective: true })],
    }),
  });
  const elements = elementsOf(tree);
  const t = dictionaryOf("zh");

  const pinnedRow = elements.find((element) => element.props["data-account"] === "a")!;
  const effectiveRow = elements.find((element) => element.props["data-account"] === "b")!;
  expect(textsOf(pinnedRow)).toContain(t("account.pinnedBy"));
  expect(textsOf(pinnedRow)).not.toContain(t("account.effectiveBy"));
  expect(textsOf(effectiveRow)).toContain(t("account.effectiveBy"));
  expect(textsOf(effectiveRow)).not.toContain(t("account.pinnedBy"));
});

it("两者相同时只标注一次（不重复刷屏）", () => {
  const { tree } = renderCard({
    status: statusOf({ pinned: "a", effective: "a", accounts: [row({ ref: "a", active: true, effective: true })] }),
  });
  const row1 = elementsOf(tree).find((element) => element.props["data-account"] === "a")!;
  const texts = textsOf(row1);
  expect(texts.filter((text) => text === dictionaryOf("zh")("account.pinnedBy"))).toHaveLength(0);
  expect(texts.filter((text) => text === dictionaryOf("zh")("account.effectiveBy"))).toHaveLength(1);
});

// —— 状态与拒绝 ——

it("未配置凭据的账号标出「未配置」，被拒绝的账号标出原因与重置时刻", () => {
  const { tree } = renderCard({
    status: statusOf({
      accounts: [
        row({ ref: "a", configured: false }),
        row({ ref: "b", rejection: { kind: "quota", until: 1_700_000_060_000 } }),
      ],
    }),
  });
  const elements = elementsOf(tree);
  const t = dictionaryOf("zh");

  expect(textsOf(elements.find((element) => element.props["data-account"] === "a")!)).toContain(t("account.missing"));
  const rejected = elements.find((element) => element.props["data-account"] === "b")!;
  expect(rejected.props["data-rejection-kind"]).toBe("quota");
  expect(rejected.props["data-rejection-until"]).toBe(1_700_000_060_000);
  // 界面上是**可读原因**（「额度耗尽」），不是原始枚举（`quota`）；机器可读的值在 data 属性上。
  expect(textsOf(rejected).join(" ")).toContain(t("switch.reason.quota"));
  expect(textsOf(rejected).join(" ")).not.toContain("quota ");
});

it("拒绝原因对全部分类都有可读文案：不把原始枚举或文案键名印到界面上", () => {
  const t = dictionaryOf("zh");
  for (const kind of ["quota", "rate-limit", "invalid-credential", "unavailable", "server", "network"]) {
    const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a", rejection: { kind: kind as never } })] }) });
    const texts = textsOf(elementsOf(tree).find((element) => element.props["data-account"] === "a")!).join(" ");
    expect(texts, kind).not.toContain(kind);
    expect(texts, kind).not.toContain("switch.reason.");
    expect(texts, kind).not.toContain("rejection.");
    expect(texts.length, kind).toBeGreaterThan(0);
  }
  // 未知分类回退到「未知」。
  const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a", rejection: { kind: "something-new" as never } })] }) });
  expect(textsOf(elementsOf(tree).find((element) => element.props["data-account"] === "a")!).join(" ")).toContain(t("dashboard.unknown"));
});

// —— 登录（Step 7 的用户可见面） ——

it("登录等待中显示授权网址；失败时把原因翻译成可读文案（含撞名）", () => {
  const waiting = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    login: { state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x" },
  }).tree;
  const link = elementsOf(waiting).find((element) => element.props["data-login-url"] !== undefined)!;
  expect(link.props.href).toBe("https://commandcode.ai/studio/auth/cli?state=x");
  expect(textsOf(waiting)).toContain(dictionaryOf("zh")("account.loginWaiting"));

  const failed = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    login: { state: "failed", reason: "credential-slot-taken" },
  }).tree;
  const t = dictionaryOf("zh");
  expect(textsOf(failed)).toContain(t("account.reason.credential-slot-taken"));
  // 未知原因回退到通用文案，而不是把原因键原样印出来。
  const unknown = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    login: { state: "failed", reason: "something-new" },
  }).tree;
  expect(textsOf(unknown)).toContain(t("account.reason.error"));
  expect(textsOf(unknown).join(" ")).not.toContain("something-new");
});

it("服务端的失败项（failures）以文字提示，不静默吞掉", () => {
  const status = statusOf({ accounts: [row({ ref: "a" })] });
  const { tree } = renderCard({ status: { ...status, failures: ["quota: commandcode read failed (timeout)"] } });
  expect(textsOf(tree).join(" ")).toContain("timeout");
});

it("状态还没到（远程面未挂载）时给出说明而不是空白", () => {
  const { tree } = renderCard({ status: undefined });
  // 「数据暂不可用」——不是「暂无额度数据」（那不是额度问题），更不是 0。
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.unavailable"));
  expect(textsOf(tree)).not.toContain(dictionaryOf("zh")("account.quotaMissing"));
  // 没有状态就没有账号行可渲染。
  expect(elementsOf(tree).filter((element) => element.props["data-account"] !== undefined)).toEqual([]);
});

it("读不到状态时把原因显示出来（空态必须能自证，不能只有一句空话）", () => {
  const { tree } = renderCard({ status: undefined, problem: "gateway/internal: usage service absent" });
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.unavailable"));
  const pre = elementsOf(tree).filter((element) => element.props["data-usage-problem"] === "true");
  expect(pre).toHaveLength(1);
  expect(textsOf(tree).join(" ")).toContain("gateway/internal");
});

it("有状态时不显示原因条（没有失败就没有诊断噪音）", () => {
  const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }), problem: "stale reason" });
  expect(elementsOf(tree).filter((element) => element.props["data-usage-problem"] === "true")).toEqual([]);
});

it("一家账号都没有时提示添加账户，而不是显示成额度故障", () => {
  const { tree } = renderCard({ status: statusOf({ accounts: [] }) });
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.empty"));
  expect(textsOf(tree)).not.toContain(dictionaryOf("zh")("account.quotaMissing"));
  // 「添加账户」的入口照旧在（空态正是为了引导用户去用它）。
  expect(elementsOf(tree).filter((element) => element.props["data-action"] === "add")).toHaveLength(1);
});
