/**
 * Task 9 测试：中栏仪表盘。
 *
 * 计划 Step 1 的四条：逐账号列出额度与状态；生效账号高亮；切换记录按时间倒序；未知字段显示为「未知」。
 *
 * 与其它卡片同样的纪律（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态；数据由
 * 面板容器取好递进来。
 */
import { expect, it, vi } from "vitest";

import { Dashboard, type DashboardProps } from "../../src/client/dashboard";
import { dictionaryOf } from "../../src/client/copy";
import type { AccountUsageStatus, SwitchRecord, VendorUsageStatus } from "../../src/client/usage-contract";
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
    switches: [],
    onClose: vi.fn(),
    ...overrides,
  };
  return { tree: Dashboard(props), props };
}

it("逐账号列出状态与额度（每个窗口一行，缺失不写 0）", () => {
  const { tree } = render({
    status: statusOf([
      row("a", { label: "Account A", configured: false, quota: { plan: "pro", windows: [{ key: "5h", used: 10, cap: 100 }, { key: "weekly" }], failures: ["billing: timeout"] } }),
      row("b", { label: "Account B", rejection: { kind: "quota", until: 1_700_000_060_000 } }),
    ]),
  });

  const rows = elementsOf(tree).filter((element) => element.props["data-dashboard-account"] !== undefined);
  expect(rows.map((element) => element.props["data-dashboard-account"])).toEqual(["a", "b"]);

  const first = rows[0]!;
  expect(textsOf(first)).toContain("Account A");
  expect(textsOf(first)).toContain("已用 10 / 共 100");
  // 缺数字的窗口显示「暂无额度数据」，不是 0。
  const weekly = elementsOf(first).find((element) => element.props["data-dashboard-window"] === "weekly")!;
  expect(textsOf(weekly)).toContain(dictionaryOf("zh")("account.quotaMissing"));
  // 端点失败项照旧显示（部分失败不扩大）。
  expect(textsOf(first).join(" ")).toContain("timeout");
  // 未配置凭据也要看得出来。
  expect(first.props["data-dashboard-configured"]).toBe(false);

  const second = rows[1]!;
  expect(second.props["data-dashboard-rejection-kind"]).toBe("quota");
});

it("生效账号高亮；固定与生效不同时两者都标注", () => {
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
  // 「固定」也标注出来了。
  expect(elementsOf(fixed).some((element) => element.props["data-dashboard-pinned"] !== undefined)).toBe(true);
});

it("切换记录按给定顺序（最新在前）渲染，带原因与时间", () => {
  const switches: SwitchRecord[] = [
    { fromRef: "b", toRef: "a", reason: "manual", at: 3_000, vendor: "commandcode" },
    { fromRef: "a", toRef: "b", reason: "quota", at: 2_000, vendor: "commandcode" },
  ];
  const { tree } = render({ switches });

  const entries = elementsOf(tree).filter((element) => element.props["data-switch-record"] !== undefined);
  expect(entries.map((element) => element.props["data-switch-record"])).toEqual(["b→a", "a→b"]);
  expect(entries[0]!.props["data-switch-reason"]).toBe("manual");
  expect(entries[0]!.props["data-switch-at"]).toBe(3_000);
  expect(textsOf(entries[0]!)).toContain(dictionaryOf("zh")("switch.reason.manual"));
  // 倒序保持：第一条的时间比第二条新。
  expect(Number(entries[0]!.props["data-switch-at"])).toBeGreaterThan(Number(entries[1]!.props["data-switch-at"]));
});

it("没有切换记录时给出说明，而不是空列表", () => {
  const { tree } = render({ switches: [] });
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("dashboard.noSwitches"));
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
