/** 额度圆环：中心显示剩余百分比，颜色按剩余额度分档。 */
import { expect, it } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { QuotaRing } from "../../src/client/quota-ring";
import type { StubElement } from "../support/react-stub";

function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

it("剩余额度百分比与颜色分档", () => {
  const tree = QuotaRing({ t: dictionaryOf("zh"), window: { key: "fiveHour", used: 7, cap: 10 } });
  const ring = elementsOf(tree).find((element) => element.props["data-quota-ring"] !== undefined)!;
  expect(ring.props["data-quota-ring-level"]).toBe("warn");
  expect(ring.props["data-quota-ring-remaining"]).toBe(30);
  expect(elementsOf(tree).some((element) => element.props["data-quota-ring-text"] === "30")).toBe(true);
});

it("剩余 90% 为绿色；没有读数时显示破折号且不补 0", () => {
  const healthy = QuotaRing({ t: dictionaryOf("zh"), window: { key: "weekly", percent: 10 } });
  const healthyRing = elementsOf(healthy).find((element) => element.props["data-quota-ring"] !== undefined)!;
  expect(healthyRing.props["data-quota-ring-level"]).toBe("ok");
  expect(healthyRing.props["data-quota-ring-remaining"]).toBe(90);

  const missing = QuotaRing({ t: dictionaryOf("zh"), window: { key: "monthly" } });
  expect(elementsOf(missing).some((element) => element.props["data-quota-ring-text"] === "missing")).toBe(true);
  expect(elementsOf(missing).some((element) => element.props["data-quota-ring"] !== undefined)).toBe(true);
});
