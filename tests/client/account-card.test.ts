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
  expect(textsOf(windows[1]).join(" ")).toContain("已用 0 / 共 0");
});

it("没有额度摘要时画空进度条（缺失不是 0）", () => {
  const { tree } = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  const windows = elementsOf(tree).filter((element) => element.props["data-quota-window"] !== undefined);
  expect(windows.map((element) => element.props["data-quota-window"])).toEqual(["5h", "weekly", "monthlyCredits"]);
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-fill"] !== undefined)).toBe(false);
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("account.quotaMissing"));
});

it("厂商明说不限的窗口照常出现（标「不限」），不假装缺失也不画空条（2026-10-18 线报）", () => {
  const { tree } = renderCard({
    status: statusOf({
      accounts: [
        row({
          ref: "a",
          quota: {
            windows: [
              { key: "fiveHour", unlimited: true },
              { key: "weekly", unlimited: true },
              { key: "monthlyCredits", used: 62.21 },
            ],
            failures: [],
          },
        }),
      ],
    }),
  });
  const windows = elementsOf(tree).filter((element) => element.props["data-quota-window"] !== undefined);
  expect(windows.map((element) => element.props["data-quota-window"])).toEqual(["fiveHour", "weekly", "monthlyCredits"]);
  expect(elementsOf(tree).filter((element) => element.props["data-quota-bar-level"] === "unlimited")).toHaveLength(2);
  // 「不限」的窗口没有条（空条 = 用光了），月度那条只有 used、画不出条 —— 整张卡片都没有填充。
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-fill"] !== undefined)).toBe(false);
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("quota.unlimited"));
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
  expect(textsOf(window).join(" ")).not.toContain("已用 0 / 共 0");
});

it("额度读取的部分失败（端点级）在账号行上列出来，不做静默（与仪表盘同一纪律）", () => {
  // 场景：`billing/credits` 读不到时只剩月度一条 —— 不列失败就等于把一次不完整的读数
  // 呈现成完整的，用户会以为 5 小时/每周额度凭空消失。
  const { tree } = renderCard({
    status: statusOf({
      accounts: [row({ ref: "a", quota: { windows: [{ key: "monthlyCredits", used: 62.21 }], failures: ["credits"] } })],
    }),
  });
  const notes = elementsOf(tree).filter((element) => element.props["data-account-quota-failure"] !== undefined);
  expect(notes).toHaveLength(1);
  // 端点短名（`credits`）不再原样上屏：2026-10-18 报障的「多了一些英文」就是它；
  // 宿主原文留在 data 属性里供排查（界面文案可以本地化，证据不能）。
  expect(textsOf(notes[0]!).join(" ")).toContain(dictionaryOf("zh")("usage.failure.credits"));
  expect(textsOf(notes[0]!).join(" ")).not.toContain("credits");
  expect(notes[0]!.props["data-failure-detail"]).toBe("credits");
});

it("额度读取超时的失败项显示人话（账号名留着），原文仍可溯源", () => {
  const { tree } = renderCard({
    status: statusOf({
      accounts: [
        row({
          ref: "a",
          // 宿主侧的真实形状（usage-remote.ts）：外层含 `timeout after Nms`，界面据此换人话。
          quota: { windows: [], failures: ['quota: commandcode "Work" read failed (timeout after 30000ms)'] },
        }),
      ],
    }),
  });
  const note = elementsOf(tree).find((element) => element.props["data-account-quota-failure"] !== undefined)!;
  const texts = textsOf(note).join(" ");
  // 账号名（有用信息）留着；原因与诊断句翻成人话，不再出现 `read failed`。
  expect(texts).toContain("账号 Work 的额度读取失败");
  expect(texts).toContain(dictionaryOf("zh")("usage.failure.timeout"));
  expect(texts).not.toContain("read failed");
  expect(note.props["data-failure-detail"]).toContain("timeout after 30000ms");
});

// —— Step 1：菜单按能力降级 ——

it("`⋯` 菜单按能力降级：拖拽手柄已移除，固定项已移除", () => {
  const commandCode = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) }).tree;
  const ccElements = elementsOf(commandCode);
  expect(ccElements.filter((element) => element.props["data-drag-handle"] !== undefined)).toEqual([]);
  expect(ccElements.filter((element) => element.props["data-action"] === "pin")).toEqual([]);
  expect(ccElements.filter((element) => element.props["data-action"] === "login")).toHaveLength(1);

  const opencode = renderCard({
    status: statusOf({ capabilities: OPENCODE, accounts: [row({ ref: "a" })] }),
  }).tree;
  const ocElements = elementsOf(opencode);
  // 拖拽手柄已从行内移除；pin/login 仍按能力降级。
  expect(ocElements.filter((element) => element.props["data-drag-handle"] !== undefined)).toHaveLength(0);
  expect(ocElements.filter((element) => element.props["data-action"] === "pin")).toEqual([]);
  expect(ocElements.filter((element) => element.props["data-action"] === "login")).toEqual([]);
});

it("菜单操作打开对应操作并带上目标账号（值与提交由页面状态负责）", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a", label: "Account A" }), row({ ref: "b" })] }),
  });
  const elements = elementsOf(tree);

  fire(elements.find((element) => element.props["data-action"] === "rename")!, "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith({ kind: "rename", ref: "a" });
  fire(elements.find((element) => element.props["data-action"] === "replaceKey")!, "onClick");
  expect(props.onOpenAction).toHaveBeenCalledWith({ kind: "key", ref: "a" });
  fire(elements.find((element) => element.props["data-action"] === "remove")!, "onClick");
  expect(props.onRemove).toHaveBeenCalledWith("a");
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

it("表单打开后：写明在往哪家加账户、名称框自动聚焦、回车 = 确定（2026-10-18 操作逻辑）", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    vendorLabel: "Command Code",
    action: { kind: "add", label: "", key: "" },
  });
  const elements = elementsOf(tree);

  // 面板底部只有一个表单位置（两家共用），标题说的是「现在这家」。
  const title = elements.find((element) => element.props["data-add-title"] !== undefined)!;
  expect(title.props["data-add-title"]).toBe("Command Code");
  expect(textsOf(title)).toContain("添加Command Code账户");

  const label = elements.find((element) => element.props["data-add-label"] !== undefined)!;
  // 点开就能打字：名称框自动聚焦（React 的 autoFocus 只在挂载时生效一次）。
  expect(label.props.autoFocus).toBe(true);

  // 回车 = 点「确定」：两个框都算，且不让事件继续冒泡（表单里回车默认会做别的事）。
  const prevented: string[] = [];
  for (const field of [label, elements.find((element) => element.props["data-add-key"] !== undefined)!]) {
    fire(field, "onKeyDown", { key: "Enter", preventDefault: () => prevented.push("enter") });
  }
  expect(props.onConfirmAction).toHaveBeenCalledTimes(2);
  expect(prevented).toEqual(["enter", "enter"]);
  // 非回车不提交。
  fire(label, "onKeyDown", { key: "a" });
  expect(props.onConfirmAction).toHaveBeenCalledTimes(2);
});

it("空名称点「确定」时容器给的原因显示在表单里（不再是毫无反应），没有原因就不画", () => {
  const { tree } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "add", label: "", key: "" },
    actionError: "请先填写账户名称。",
  });
  const error = elementsOf(tree).find((element) => element.props["data-action-error"] !== undefined);
  expect(error).toBeDefined();
  expect(textsOf(error)).toContain("请先填写账户名称。");

  const clean = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "add", label: "", key: "" },
  });
  expect(elementsOf(clean.tree).find((element) => element.props["data-action-error"] !== undefined)).toBeUndefined();
});

it("重命名与更换密钥的编辑器同样支持回车提交，并显示失败原因", () => {
  const rename = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "rename", ref: "a", label: "work", key: "" },
    actionError: "请先填写账户名称。",
  });
  const renameInput = elementsOf(rename.tree).find((element) => element.props["data-rename-input"] === "a")!;
  expect(renameInput.props.autoFocus).toBe(true);
  fire(renameInput, "onKeyDown", { key: "Enter" });
  expect(rename.props.onConfirmAction).toHaveBeenCalledTimes(1);
  expect(textsOf(rename.tree)).toContain("请先填写账户名称。");

  const key = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    action: { kind: "key", ref: "a", label: "", key: "" },
    actionError: "请先填写密钥。",
  });
  const keyInput = elementsOf(key.tree).find((element) => element.props["data-key-input"] === "a")!;
  fire(keyInput, "onKeyDown", { key: "Enter" });
  expect(key.props.onConfirmAction).toHaveBeenCalledTimes(1);
  expect(textsOf(key.tree)).toContain("请先填写密钥。");
});

it("订阅套餐显示成一行（名称 + 每月额度 + 本期结束）；没有套餐就不画", () => {
  const { tree } = renderCard({
    status: statusOf({
      accounts: [
        row({
          ref: "a",
          quota: {
            plan: {
              id: "individual-goat",
              name: "GOAT",
              status: "active",
              monthlyCredits: 70,
              periodEnd: Date.parse("2026-11-14T03:23:11.000Z"),
            },
            windows: [],
            failures: [],
          },
        }),
        row({ ref: "b", quota: { windows: [], failures: [] } }),
      ],
    }),
  });
  const plan = elementsOf(tree).find((element) => element.props["data-account-plan"] !== undefined)!;
  expect(plan.props["data-account-plan"]).toBe("individual-goat");
  const text = textsOf(plan).join(" ");
  expect(text).toContain("套餐 GOAT");
  expect(text).toContain("每月 $70.00");
  expect(text).toContain("本期至");
  // `active` 是常态：不把状态再写一遍（非 active 才写，见 quota 的单测）。
  expect(text).not.toContain("生效中");
  // 没有订阅的账号一行都不画：只有 a 有套餐行。
  expect(elementsOf(tree).filter((element) => element.props["data-account-plan"] !== undefined)).toHaveLength(1);
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

it("账号下可以单独配置可用模型；同一模型可同时属于多个账号", () => {
  const { tree, props } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" }), row({ ref: "b" })] }),
    catalog: [
      { id: "m1", name: "M1" },
      { id: "m2", name: "M2" },
    ],
    modelRules: [
      { models: ["m1"], account: "a" },
      { models: ["m1"], account: "b" },
    ],
    onSetAccountModels: vi.fn(),
  });
  const checkbox = elementsOf(tree).find((element) => element.props["data-account-model"] === "a:m2")!;
  expect(checkbox.props.checked).toBe(false);
  fire(checkbox, "onChange", { target: { checked: true } });
  expect(props.onSetAccountModels).toHaveBeenCalledWith("a", ["m1", "m2"]);
  expect(elementsOf(tree).find((element) => element.props["data-account-model"] === "b:m1")!.props.checked).toBe(true);
});

it("目录还在读取时账号模型区显示加载文案，而不是整节消失", () => {
  // 旧行为是 catalog 未就绪就返回 null：用户看到「这个账号没有模型可选」，
  // 与「正在读」「读失败」三种病因混为一谈。
  const { tree } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    catalogLoading: true,
    onSetAccountModels: vi.fn(),
  });
  const rowA = elementsOf(tree).find((element) => element.props["data-account"] === "a")!;
  expect(textsOf(rowA)).toContain(dictionaryOf("zh")("models.loading"));
  expect(elementsOf(rowA).some((element) => element.props["data-account-models"] !== undefined)).toBe(false);
});

it("目录读失败时账号模型区显示原因并给重试", () => {
  const onRetryCatalog = vi.fn();
  const { tree } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    catalogFailure: "llm-account/models returned no value",
    onRetryCatalog,
    onSetAccountModels: vi.fn(),
  });
  const rowA = elementsOf(tree).find((element) => element.props["data-account"] === "a")!;
  expect(textsOf(rowA).join(" ")).toContain(dictionaryOf("zh")("usage.failure.models"));
  expect(textsOf(rowA).join(" ")).not.toContain("llm-account/models returned no value");
  // 诊断原文仍留在 data 属性上（自证路径不受本地化影响）。
  const detail = elementsOf(rowA).find((element) => element.props["data-failure-detail"] !== undefined)!;
  expect(detail.props["data-failure-detail"]).toBe("llm-account/models returned no value");
  const retry = elementsOf(rowA).find((element) => element.props["data-account-models-retry"] !== undefined)!;
  fire(retry, "onClick");
  expect(onRetryCatalog).toHaveBeenCalledTimes(1);
});

it("账号行有「刷新此账号的模型」按钮（按账户刷新）；读取中禁用并转圈", () => {
  const onRetryCatalog = vi.fn();
  const { tree } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    onRetryCatalog,
  });
  const rowA = elementsOf(tree).find((element) => element.props["data-account"] === "a")!;
  const button = elementsOf(rowA).find((element) => element.props["data-account-refresh-models"] !== undefined)!;
  expect(button.props["aria-label"]).toBe(dictionaryOf("zh")("models.refreshAccount"));
  fire(button, "onClick");
  expect(onRetryCatalog).toHaveBeenCalledTimes(1);

  // 没传 onRetryCatalog 时不渲染（旧调用方/纯测试不受影响）。
  const bare = renderCard({ status: statusOf({ accounts: [row({ ref: "a" })] }) });
  expect(elementsOf(bare.tree).some((element) => element.props["data-account-refresh-models"] !== undefined)).toBe(false);

  // 目录读取中：禁用 + aria-busy（样式层据此转圈）。
  const busy = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    onRetryCatalog,
    catalogLoading: true,
  });
  const busyButton = elementsOf(busy.tree).find((element) => element.props["data-account-refresh-models"] !== undefined)!;
  expect(busyButton.props["disabled"]).toBe(true);
  expect(busyButton.props["aria-busy"]).toBe("true");
});

it("目录读到了一部分（部分失败）时列表照常渲染，失败也照常说", () => {
  const { tree } = renderCard({
    status: statusOf({ accounts: [row({ ref: "a" })] }),
    catalog: [{ id: "m1", name: "M1" }],
    catalogFailure: "timeout on second page",
    onSetAccountModels: vi.fn(),
  });
  const rowA = elementsOf(tree).find((element) => element.props["data-account"] === "a")!;
  // 不列失败就等于把一次不完整的目录呈现成完整的。
  expect(textsOf(rowA).join(" ")).toContain(dictionaryOf("zh")("usage.failure.timeout"));
  expect(elementsOf(rowA).find((element) => element.props["data-account-model"] === "a:m1")).toBeDefined();
});

it("手动切换到 A 后 A 标当前使用，仍在完成请求的 B 标生效中", () => {
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
  expect(textsOf(pinnedRow)).toContain(t("account.effectiveBy"));
  expect(textsOf(pinnedRow)).not.toContain(t("account.liveBy"));
  expect(textsOf(effectiveRow)).toContain(t("account.liveBy"));
  expect(textsOf(effectiveRow)).not.toContain(t("account.effectiveBy"));
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
    login: { state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?state=x", userCode: "ABCD-EFGH" },
  }).tree;
  const link = elementsOf(waiting).find((element) => element.props["data-login-url"] !== undefined)!;
  expect(link.props.href).toBe("https://commandcode.ai/studio/auth/cli?state=x");
  expect(textsOf(waiting)).toContain(dictionaryOf("zh")("account.loginWaiting"));
  // 设备码流程：user code 必须显示出来，用户才知道在浏览器里输入什么。
  expect(textsOf(waiting).join(" ")).toContain("ABCD-EFGH");

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
  const note = elementsOf(tree).find((element) => element.props["data-failure"] !== undefined)!;
  expect(note.props["data-failure-detail"]).toContain("timeout");
  // 带引号账号名的包装才有账号可留；这一条没有账号名，所以是通用文案。
  expect(textsOf(note).join(" ")).toContain(dictionaryOf("zh")("usage.failure.quota"));
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
