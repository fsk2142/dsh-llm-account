/**
 * 全局切换面板：策略 + 账户顺序同卡；间隔三段在**一行**里。
 */
import { expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { SwitchPanel, type SwitchPanelProps } from "../../src/client/switch-panel";
import type { StubElement } from "../support/react-stub";

function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

function render(overrides: Partial<SwitchPanelProps> = {}): { tree: StubElement; props: SwitchPanelProps } {
  const props: SwitchPanelProps = {
    t: dictionaryOf("zh"),
    state: { strategy: "order", intervalMinutes: 60, atTurnEnd: true, autoSwitch: true, evaluatedAt: 1_000 },
    now: 1_000,
    order: [
      { key: "commandcode:cc", label: "Work", vendorLabel: "Command Code", vendor: "commandcode", ref: "cc" },
      { key: "dsh-opencode-go:oc", label: "Personal", vendorLabel: "OpenCode", vendor: "dsh-opencode-go", ref: "oc" },
    ],
    onChange: vi.fn(),
    onReorder: vi.fn(),
    onSwitchNow: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  return { tree: SwitchPanel(props), props };
}

it("策略、间隔、自动切换与账户顺序在同一张卡片；间隔三段在一行", () => {
  const { tree } = render();
  expect(elementsOf(tree).some((element) => element.props["data-switch-strategy"] !== undefined)).toBe(true);
  expect(elementsOf(tree).some((element) => element.props["data-switch-order"] !== undefined)).toBe(true);
  const parts = elementsOf(tree)
    .filter((element) => element.props["data-switch-duration-part"] !== undefined)
    .map((element) => [element.props["data-switch-duration-part"], element.props.value]);
  expect(parts).toEqual([
    ["days", "0"],
    ["hours", "1"],
    ["minutes", "0"],
  ]);
  // 三段在同一个 flex 行容器里（CSS 的 nowrap 之外，结构上也必须是一个容器）。
  const interval = elementsOf(tree).find((element) => element.props["data-switch-interval"] !== undefined)!;
  expect(elementsOf(interval.props.children).filter((element) => element.props["data-switch-duration-part"] !== undefined)).toHaveLength(3);
});

it("修改策略/间隔/开关立刻上报", () => {
  const strategy = render();
  const select = elementsOf(strategy.tree).find((element) => element.props["data-switch-strategy"] !== undefined)!;
  (select.props.onChange as (event: unknown) => void)({ target: { value: "best-quota" } });
  expect(strategy.props.onChange).toHaveBeenCalledWith({ strategy: "best-quota" });

  const interval = render();
  const minutes = elementsOf(interval.tree).find((element) => element.props["data-switch-duration-part"] === "minutes")!;
  (minutes.props.onChange as (event: unknown) => void)({ target: { value: "90" } });
  // 当前是 0 天 1 小时 0 分，再加 90 分钟 → 150 分钟（自动进位由 duration 单测覆盖）。
  expect(interval.props.onChange).toHaveBeenCalledWith({ intervalMinutes: 150 });

  const turnEnd = render();
  const toggle = elementsOf(turnEnd.tree).find((element) => element.props["data-switch-toggle"] === "switchAtTurnEnd")!;
  (toggle.props.onChange as (event: unknown) => void)({ target: { checked: false } });
  expect(turnEnd.props.onChange).toHaveBeenCalledWith({ atTurnEnd: false });
});

it("自动切换是面板的第一个选项", () => {
  const { tree } = render();
  const controls = elementsOf(tree)
    .map((element) =>
      element.props["data-switch-toggle"] !== undefined
        ? `toggle:${element.props["data-switch-toggle"]}`
        : element.props["data-switch-strategy"] !== undefined
          ? "strategy"
          : element.props["data-switch-interval"] !== undefined
            ? "interval"
            : undefined,
    )
    .filter((value): value is string => value !== undefined);
  expect(controls[0]).toBe("toggle:autoSwitch");
});

it("顺序上移/下移提交完整全局顺序；可以直接选某个账号", () => {
  const { tree, props } = render();
  const down = elementsOf(tree).find((element) => element.props["data-order-down"] === "commandcode:cc")!;
  (down.props.onClick as () => void)();
  expect(props.onReorder).toHaveBeenCalledWith(["dsh-opencode-go:oc", "commandcode:cc"]);

  const use = elementsOf(tree).find((element) => element.props["data-order-select"] === "dsh-opencode-go:oc")!;
  (use.props.onClick as () => void)();
  expect(props.onSelect).toHaveBeenCalledWith("dsh-opencode-go", "oc");

  const now = elementsOf(tree).find((element) => element.props["data-switch-now"] !== undefined)!;
  (now.props.onClick as () => void)();
  expect(props.onSwitchNow).toHaveBeenCalledTimes(1);
  expect(elementsOf(tree).some((element) => element.props["data-switch-countdown"] !== undefined)).toBe(true);
});
