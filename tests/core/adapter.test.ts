import { expect, it } from "vitest";

import { supports, type VendorCapabilities } from "../../src/core/adapter";

it("reorder 未声明时判定为不支持", () => {
  const caps = { reorder: false } as VendorCapabilities;
  expect(supports(caps, "reorder")).toBe(false);
});

it("quotaShape 两种取值都合法", () => {
  expect(supports({ quotaShape: "percent" } as VendorCapabilities, "quotaShape")).toBe(true);
  expect(supports({ quotaShape: "windows" } as VendorCapabilities, "quotaShape")).toBe(true);
});
