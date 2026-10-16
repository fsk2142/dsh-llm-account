import { expect, it } from "vitest";

import type { CatalogEntry } from "../../src/core/adapter";
import { isModelVisible, normalizeVisibility, selectVisible } from "../../src/core/catalog";

const entry = (id: string): CatalogEntry => ({ id, name: id, inputModalities: ["text"] });

it("显式布尔覆盖优先于白名单", () => {
  expect(
    isModelVisible(entry("m"), { visibleModels: ["m"], modelVisibility: { m: false } }),
  ).toBe(false);
  expect(isModelVisible(entry("m"), { visibleModels: [], modelVisibility: { m: true } })).toBe(
    true,
  );
});

it("白名单为空表示显示全部", () => {
  expect(isModelVisible(entry("m"), { visibleModels: [] })).toBe(true);
});

it("非布尔值被忽略", () => {
  expect(normalizeVisibility({ m: "yes" })).toEqual({});
});

it("未提供可见性时显示全部", () => {
  expect(isModelVisible(entry("m"), {})).toBe(true);
});

it("白名单非空时，不在名单内的模型隐藏", () => {
  expect(isModelVisible(entry("a"), { visibleModels: ["b"] })).toBe(false);
  expect(isModelVisible(entry("b"), { visibleModels: ["b"] })).toBe(true);
});

it("normalizeVisibility 丢弃 visibleModels 中的非字符串元素", () => {
  expect(normalizeVisibility({ visibleModels: ["a", 7, null, undefined, {}, "b"] })).toEqual({
    visibleModels: ["a", "b"],
  });
});

it("normalizeVisibility 只保留 modelVisibility 中的布尔键值对", () => {
  expect(normalizeVisibility({ modelVisibility: { a: true, b: false, c: "yes", d: 0 } })).toEqual({
    modelVisibility: { a: true, b: false },
  });
});

it("normalizeVisibility 丢弃白名单里的空串与纯空白（[] 不能把模型全部筛掉）", () => {
  // `[""]` 是非空白名单：不过滤的话所有模型都不命中，选择器里一个都不出。
  expect(normalizeVisibility({ visibleModels: ["a", "", "  ", "b"] })).toEqual({ visibleModels: ["a", "b"] });
  expect(isModelVisible(entry("a"), normalizeVisibility({ visibleModels: [""] }))).toBe(true);
  expect(isModelVisible(entry("a"), normalizeVisibility({ visibleModels: ["  "] }))).toBe(true);
  // 显隐表里的空串键同样丢弃（它永远匹配不上任何真实 id）。
  expect(normalizeVisibility({ modelVisibility: { "": true, " ": false, a: true } })).toEqual({ modelVisibility: { a: true } });
});

it("normalizeVisibility 对非对象输入返回空可见性", () => {
  expect(normalizeVisibility(undefined)).toEqual({});
  expect(normalizeVisibility(null)).toEqual({});
  expect(normalizeVisibility("m")).toEqual({});
  expect(normalizeVisibility(42)).toEqual({});
  expect(normalizeVisibility(["m"])).toEqual({});
});

it("normalizeVisibility 丢弃形状不合法的字段，保留合法字段", () => {
  expect(normalizeVisibility({ visibleModels: "m", modelVisibility: { m: true } })).toEqual({
    modelVisibility: { m: true },
  });
});

it("selectVisible 过滤结果保持输入顺序且不修改入参", () => {
  const entries: CatalogEntry[] = [entry("a"), entry("b"), entry("c")];
  const snapshot = entries.slice();

  const result = selectVisible(entries, { visibleModels: ["c", "a"] });

  expect(result.map((e) => e.id)).toEqual(["a", "c"]);
  expect(result).not.toBe(entries);
  expect(entries).toEqual(snapshot);
});

it("selectVisible 在覆盖与白名单组合下按同一规则逐条判定", () => {
  const entries: CatalogEntry[] = [entry("a"), entry("b"), entry("c"), entry("d")];

  const result = selectVisible(entries, {
    visibleModels: ["a", "b"],
    modelVisibility: { a: false, c: true },
  });

  expect(result.map((e) => e.id)).toEqual(["b", "c"]);
});

it("selectVisible 在无可见性约束时返回全部条目", () => {
  const entries: CatalogEntry[] = [entry("a"), entry("b")];

  expect(selectVisible(entries, {}).map((e) => e.id)).toEqual(["a", "b"]);
});
