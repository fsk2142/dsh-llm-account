/**
 * Task 9 测试：中栏仪表盘。
 *
 * 计划 Step 1 的四条：逐账号列出额度与状态；生效账号高亮；未知字段显示为「未知」；部分失败
 * 照旧列出（人话文案 + `data-*` 里的诊断原文）。
 *
 * 与其它卡片同样的纪律（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态；数据由
 * 面板容器取好递进来。
 */
import { expect, it, vi } from "vitest";

import { Dashboard, type DashboardProps } from "../../src/client/dashboard";
import { dictionaryOf } from "../../src/client/copy";
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
function statusOf(accounts: AccountUsageStatus[], overrides: Partial<VendorUsageStatus> = {}): VendorUsageStatus {
  return {
    vendor: "commandcode",
    capabilities: { reorder: false, pin: true, browserLogin: true, modelAccountRules: true, quotaShape: "windows", modelVisibilityWrite: "onSave", automaticSwitch: true },
    pinned: null,
    accounts,
    failures: [],
    ...overrides,
  };
}

/** 渲染一次仪表盘。 */
function render(overrides: Partial<DashboardProps> = {}): { tree: StubElement; props: DashboardProps } {
  const props: DashboardProps = {
    t: dictionaryOf("zh"),
    status: statusOf([row("a")]),
    onClose: vi.fn(),
    ...overrides,
  };
  return { tree: Dashboard(props), props };
}

it("逐账号列出状态与额度（每个窗口一行，缺失不写 0）", () => {
  const { tree } = render({
    status: statusOf([
      row("a", { label: "Account A", configured: false, quota: { plan: { id: "individual-pro-v1", name: "Pro", status: "active", monthlyCredits: 80 }, windows: [{ key: "5h", used: 10, cap: 100 }, { key: "weekly" }], failures: ["billing: timeout"] } }),
      row("b", { label: "Account B", rejection: { kind: "quota", until: 1_700_000_060_000 } }),
    ]),
  });

  const rows = elementsOf(tree).filter((element) => element.props["data-dashboard-account"] !== undefined);
  expect(rows.map((element) => element.props["data-dashboard-account"])).toEqual(["a", "b"]);

  const first = rows[0]!;
  expect(textsOf(first)).toContain("Account A");
  expect(textsOf(first)).toContain("已用 10 / 共 100");
  // 订阅套餐也要出现在仪表盘上：名称 + 每月额度（2026-10-18 用户要求套餐信息）。
  const plan = elementsOf(first).find((element) => element.props["data-dashboard-plan"] !== undefined)!;
  expect(plan.props["data-dashboard-plan"]).toBe("individual-pro-v1");
  expect(textsOf(plan)).toContain("套餐 Pro · 每月 $80.00");
  // 未报告的套餐状态不写上屏（`active` 是常态）。
  expect(textsOf(plan)).not.toContain("生效");
  // 没有订阅的账号一行都不画。
  expect(elementsOf(rows[1]!).some((element) => element.props["data-dashboard-plan"] !== undefined)).toBe(false);
  // 缺数字的窗口显示「暂无额度数据」，不是 0。
  const weekly = elementsOf(first).find((element) => element.props["data-dashboard-window"] === "weekly")!;
  expect(textsOf(weekly)).toContain(dictionaryOf("zh")("account.quotaMissing"));
  // 端点失败项照旧显示（部分失败不扩大）：给人话文案，原文只留在 data 属性上
  // （把 `billing: timeout` 印在界面上就是调试输出）。
  expect(textsOf(first).join(" ")).toContain(dictionaryOf("zh")("usage.failure.timeout"));
  const failure = elementsOf(first).find((element) => element.props["data-dashboard-account-failure"] !== undefined)!;
  expect(failure.props["data-failure-detail"]).toBe("billing: timeout");
  // 未配置凭据也要看得出来。
  expect(first.props["data-dashboard-configured"]).toBe(false);

  const second = rows[1]!;
  expect(second.props["data-dashboard-rejection-kind"]).toBe("quota");
});

it("额度带单位：美元窗口在面板上排版成 `$`（user 2026-10-18：额度信息带上单位）", () => {
  const { tree } = render({
    status: statusOf([row("a", { quota: { windows: [{ key: "monthlyCredits", used: 62.2122, unit: "usd" }], failures: [] } })]),
  });
  const texts = textsOf(tree).join(" ");
  expect(texts).toContain("已用 $62.21");
  // 原始浮点不再上屏（它仍在状态与 data 属性里）。
  expect(texts).not.toContain("62.2122");
});

it("生效账号高亮；「当前使用」只标在真正生效的那个账号上（不是选中的那个）", () => {
  const { tree } = render({
    status: statusOf([row("fixed", { active: true }), row("serving", { effective: true })], {
      pinned: "fixed",
      effective: { ref: "serving", at: 1_700_000_000_000 },
      switch: { fromRef: "fixed", toRef: "serving", reason: "quota", at: 1_700_000_000_000 },
    }),
  });
  const rows = elementsOf(tree).filter((element) => element.props["data-dashboard-account"] !== undefined);

  const serving = rows.find((element) => element.props["data-dashboard-account"] === "serving")!;
  expect(serving.props["data-dashboard-effective"]).toBe(true);
  const fixed = rows.find((element) => element.props["data-dashboard-account"] === "fixed")!;
  expect(fixed.props["data-dashboard-effective"]).toBe(false);
  // 高亮只有一个。
  expect(rows.filter((element) => element.props["data-dashboard-effective"] === true)).toHaveLength(1);
  // 每家只标一个「当前使用」：生效账号存在时就是它，不再给「选中的」另画一个徽标。
  const current = elementsOf(tree).filter((element) => element.props["data-dashboard-current"] !== undefined);
  expect(current).toHaveLength(1);
  expect(current[0]!.props["data-dashboard-current"]).toBe("serving");
  expect(elementsOf(tree).some((element) => element.props["data-dashboard-pinned"] !== undefined)).toBe(false);
});

it("多厂商视图：每家的账号用自己厂商的兜底窗口与固定标注", () => {
  // 旧实现把第一个厂商的 status 同时递给所有 accountBlock：第二家（opencode）缺额度
  // 数据时画的是 commandcode 的窗口（5 小时/每周/月度额度），pinned 也可能错认。
  const { tree } = render({
    status: statusOf([row("a", { label: "A" })]),
    vendors: [
      { label: "Command Code", status: statusOf([row("a", { label: "A", active: true })], { pinned: "a" }) },
      { label: "OpenCode", status: { ...statusOf([row("b", { label: "B" })]), vendor: "dsh-opencode-go" } },
    ],
  });
  const sections = elementsOf(tree).filter((element) => element.props["data-dashboard-account"] !== undefined);
  const b = sections.find((element) => element.props["data-dashboard-account"] === "b")!;
  const windows = elementsOf(b)
    .filter((element) => element.props["data-dashboard-window"] !== undefined)
    .map((element) => element.props["data-dashboard-window"]);
  // opencode 的形状是滚动窗口/每周/每月；commandcode 的是 5 小时/每周/月度额度。
  expect(windows).toEqual(["rolling", "weekly", "monthly"]);
  // 「当前使用」只标在第一家选中的那个账号上，不张冠李戴（第二家没有 active 账号就不标）。
  const current = elementsOf(tree).filter((element) => element.props["data-dashboard-current"] !== undefined);
  expect(current).toHaveLength(1);
  expect(current[0]!.props["data-dashboard-current"]).toBe("a");
});

it("厂商级失败项给人话：端点短名与超时都不再原样上屏，原文留 data 属性", () => {
  // 2026-10-18 用户报障「用量面板里多了一些英文」：`status.failures` 里是端口记的端点短名
  // （`whoami`）与包装过的诊断（`quota: commandcode "Work" read failed (timeout …)`）。
  const { tree } = render({
    status: statusOf([row("a")], {
      failures: ["whoami", `quota: commandcode "工作账号" read failed (timeout after 30000ms)`],
    }),
  });
  const notes = elementsOf(tree).filter((element) => element.props["data-failure-detail"] !== undefined);
  expect(notes.map((element) => element.props["data-failure-detail"])).toEqual([
    "whoami",
    `quota: commandcode "工作账号" read failed (timeout after 30000ms)`,
  ]);
  expect(textsOf(notes[0]!)).toContain(dictionaryOf("zh")("usage.failure.whoami"));
  expect(textsOf(notes[1]!).join("")).toContain("账号 工作账号 的额度读取失败");
  expect(textsOf(notes[1]!).join("")).toContain(dictionaryOf("zh")("usage.failure.timeout"));
  // 认不出的形状原样保留（自证优先）：宿主的能力错误要看得见。
  const host = render({ status: statusOf([row("a")], { failures: ["the host remote service has no $mount()"] }) });
  expect(textsOf(host.tree).join(" ")).toContain("the host remote service has no $mount()");
});

it("未知字段显示为「未知」，不把原始值糊到界面上", () => {
  const { tree } = render({
    status: statusOf([row("a", { rejection: { kind: "something-new" as never } })]),
  });
  const row1 = elementsOf(tree).find((element) => element.props["data-dashboard-account"] === "a")!;
  expect(textsOf(row1)).toContain(dictionaryOf("zh")("dashboard.unknown"));
  expect(textsOf(row1).join(" ")).not.toContain("something-new");
});

it("拒绝原因对全部分类都有可读文案：不把原始枚举或文案键名印到界面上", () => {
  // 旧实现只认识四种「切换原因」，`unavailable`/`server`/`network` 会回退成键名原文
  // （`switch.reason.server`）显示给用户 —— 这里逐分类钉住。
  for (const kind of ["quota", "rate-limit", "invalid-credential", "unavailable", "server", "network"]) {
    const { tree } = render({ status: statusOf([row("a", { rejection: { kind: kind as never } })]) });
    const texts = textsOf(elementsOf(tree).find((element) => element.props["data-dashboard-account"] === "a")!).join(" ");
    expect(texts, kind).not.toContain(kind);
    expect(texts, kind).not.toContain("switch.reason.");
    expect(texts, kind).not.toContain("rejection.");
  }
  // 认识的原因用对应文案（额度耗尽那条与切换提示共用）。
  const { tree } = render({ status: statusOf([row("a", { rejection: { kind: "rate-limit" } })]) });
  expect(textsOf(elementsOf(tree).find((element) => element.props["data-dashboard-account"] === "a")!)).toContain(
    dictionaryOf("zh")("switch.reason.rate-limit"),
  );
});

it("拒绝文案缺失时回退到「未知」，不把键名印到界面上", () => {
  // 取词函数坏掉（或某条文案被删）的形状：键原样返回。此时显示键名比显示「未知」更糟。
  const keyed = (key: string): string => key;
  const { tree } = render({ t: keyed, status: statusOf([row("a", { rejection: { kind: "quota" } })]) });
  const texts = textsOf(elementsOf(tree).find((element) => element.props["data-dashboard-account"] === "a")!).join(" ");
  expect(texts).toContain("dashboard.unknown");
  expect(texts).not.toContain("switch.reason.");
});

it("状态还没到时给出占位说明；关闭与刷新按钮把意图报出去", () => {
  const empty = render({ status: undefined });
  expect(textsOf(empty.tree)).toContain(dictionaryOf("zh")("dashboard.noData"));

  const { tree, props } = render({ onRefresh: vi.fn() });
  const close = elementsOf(tree).find((element) => element.props["data-dashboard-close"] !== undefined)!;
  (close.props.onClick as () => void)();
  expect(props.onClose).toHaveBeenCalledTimes(1);

  const refresh = elementsOf(tree).find((element) => element.props["data-dashboard-refresh"] !== undefined)!;
  (refresh.props.onClick as () => void)();
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

