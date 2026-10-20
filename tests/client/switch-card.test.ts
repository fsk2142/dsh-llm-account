/**
 * 切换倒计时卡片：文案分支与「立即切换」按钮。
 */
import { expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { SwitchCard, countdownText } from "../../src/client/switch-card";
import type { SwitchRuntimeState } from "../../src/core/switching/settings";
import type { StubElement } from "../support/react-stub";

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 一份运行态。 */
function state(overrides: Partial<SwitchRuntimeState> = {}): SwitchRuntimeState {
  return {
    strategy: "best-quota",
    intervalMinutes: 60,
    atTurnEnd: true,
    autoSwitch: true,
    evaluatedAt: 1_000,
    nextAt: 61_000,
    ...overrides,
  };
}

it("倒计时文案：pending 优先；手动顺序/间隔 0 不显示数字倒计时", () => {
  const t = dictionaryOf("zh");
  expect(countdownText(t, state({ pending: { target: "b", reason: "quota" } }), 0)).toContain("b");
  expect(countdownText(t, state({ strategy: "order", nextAt: undefined }), 0)).toBe(t("switch.order"));
  expect(countdownText(t, state({ intervalMinutes: 0, nextAt: undefined }), 0)).toBe(t("switch.noInterval"));
});

it("倒计时文案：到期 / 秒级剩余 / 天小时分钟组合", () => {
  const t = dictionaryOf("zh");
  expect(countdownText(t, state({ nextAt: 10_000 }), 10_000)).toBe(t("switch.due"));
  expect(countdownText(t, state({ nextAt: 10_500 }), 10_000)).toContain("0 分钟");
  expect(countdownText(t, state({ nextAt: 10_000 + 90_000 }), 10_000)).toContain("1 分钟");
  const text = countdownText(t, state({ nextAt: 10_000 + (26 * 60 + 5) * 60_000 }), 10_000);
  expect(text).toContain("1 天");
  expect(text).toContain("2 小时");
  expect(text).toContain("5 分钟");
});

it("卡片：渲染倒计时，按钮触发 onSwitchNow；没有回调时按钮禁用", () => {
  const t = dictionaryOf("zh");
  const onClick = vi.fn();
  const card = SwitchCard({ t, state: state({ nextAt: 61_000 }), now: 1_000, onSwitchNow: onClick });
  const button = elementsOf(card).find((element) => element.props["data-switch-now"] === "true")!;
  expect(button.props.disabled).toBe(false);
  (button.props.onClick as () => void)();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(elementsOf(card).some((element) => element.props["data-switch-countdown"] === "true")).toBe(true);

  const disabled = elementsOf(SwitchCard({ t, state: undefined, now: 0 })).find(
    (element) => element.props["data-switch-now"] === "true",
  )!;
  expect(disabled.props.disabled).toBe(true);
});
