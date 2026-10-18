/** 额度条：显示剩余百分比，绿色；没有读数不补 0。 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { QuotaBar } from "../../src/client/quota-bar";
import type { StubElement } from "../support/react-stub";

function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

it("剩余额度为绿色，显示剩余百分比与已用读数", () => {
  const tree = QuotaBar({ t: dictionaryOf("zh"), window: { key: "fiveHour", used: 7, cap: 10 } });
  const bar = elementsOf(tree).find((element) => element.props["data-quota-bar"] !== undefined)!;
  expect(bar.props["data-quota-bar-level"]).toBe("ok");
  expect(bar.props["data-quota-bar-remaining"]).toBe(30);
  const fill = elementsOf(tree).find((element) => element.props["data-quota-bar-fill"] !== undefined)!;
  expect((fill.props.style as { width: string }).width).toBe("30%");
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-percent"] === "30")).toBe(true);
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-value"] === "fiveHour")).toBe(true);
});

it("没有读数时显示暂无额度数据，不画填充", () => {
  const tree = QuotaBar({ t: dictionaryOf("zh"), window: { key: "monthly" } });
  const bar = elementsOf(tree).find((element) => element.props["data-quota-bar"] !== undefined)!;
  expect(bar.props["data-quota-bar-level"]).toBe("missing");
  expect(elementsOf(tree).some((element) => element.props["data-quota-bar-fill"] !== undefined)).toBe(false);
});
