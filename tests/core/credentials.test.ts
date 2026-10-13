import { expect, it } from "vitest";

import { normalizeKey, pickApiKey } from "../../src/core/credentials";

it("优先级：字面量 > 凭据库 > 环境变量 > auth.json", () => {
  expect(pickApiKey({ literal: "a", stored: "b", environment: "c", authFile: "d" }).source).toBe("literal");
  expect(pickApiKey({ stored: "b", environment: "c" }).source).toBe("stored");
  expect(pickApiKey({ environment: "c" }).source).toBe("environment");
  expect(pickApiKey({ authFile: "d" }).source).toBe("auth-file");
});

it("空串与纯空白视为未配置", () => {
  expect(pickApiKey({ stored: "   ", environment: "c" }).source).toBe("environment");
  expect(pickApiKey({ stored: "" })).toEqual({ key: undefined, source: undefined });
});

it("前后空白被裁剪", () => {
  expect(pickApiKey({ stored: " key " }).key).toBe("key");
});

it("normalizeKey 只接受裁剪后非空的字符串", () => {
  expect(normalizeKey("  key  ")).toBe("key");
  expect(normalizeKey("   ")).toBeUndefined();
  expect(normalizeKey("")).toBeUndefined();
  expect(normalizeKey(undefined)).toBeUndefined();
  expect(normalizeKey(null)).toBeUndefined();
  expect(normalizeKey(42)).toBeUndefined();
  expect(normalizeKey({ key: "key" })).toBeUndefined();
});
