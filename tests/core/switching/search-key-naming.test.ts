/**
 * 搜索密钥的**自动命名与列表管理**。
 *
 * 需求：「建议只保留保存密钥那个，没添加一个就自动显示添加了一个，然后还可以点x删除
 * 已经添加的」。
 *
 * 所以界面从「填引用名 + 填密钥」两件事，简化成**只填密钥**：
 * - 添加时自动分配一个没用过的引用名；
 * - 添加成功就自动出现在列表里（用户不用再点保存）；
 * - 已添加的可以点 × 删除。
 *
 * 那份引用名列表仍存在设置文档里（`searchApiKeyRefs`），但**不再由用户直接编辑** ——
 * 由这两个动作维护。这样搜索时按它逐个尝试的顺序依然稳定。
 */
import { describe, expect, it } from "vitest";

import { nextKeyRef, removeKeyRef } from "../../../src/core/switching/search-keys";

describe("自动分配引用名", () => {
  it("空列表 → 用基础名", () => {
    expect(nextKeyRef([], "DEEPSEEK_API_KEY")).toBe("DEEPSEEK_API_KEY");
  });

  it("基础名已占用 → 加 _2", () => {
    expect(nextKeyRef(["DEEPSEEK_API_KEY"], "DEEPSEEK_API_KEY")).toBe("DEEPSEEK_API_KEY_2");
  });

  it("_2 也占用 → 加 _3（依次往上，不跳号）", () => {
    expect(nextKeyRef(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_2"], "DEEPSEEK_API_KEY")).toBe(
      "DEEPSEEK_API_KEY_3",
    );
  });

  it("删掉中间那条之后再添加，名字回到那个空洞（编号不越涨越大）", () => {
    // 1 与 3 存在、2 空着（用户删掉了 2）：返回 2，而不是一路涨到 4。
    expect(nextKeyRef(["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_3"], "DEEPSEEK_API_KEY")).toBe(
      "DEEPSEEK_API_KEY_2",
    );
  });

  it("不相关的前缀不影响编号", () => {
    expect(nextKeyRef(["OTHER_KEY"], "DEEPSEEK_API_KEY")).toBe("DEEPSEEK_API_KEY");
    expect(nextKeyRef(["OTHER_KEY", "DEEPSEEK_API_KEY"], "DEEPSEEK_API_KEY")).toBe("DEEPSEEK_API_KEY_2");
  });

  it("分配出来的名字必须是可解析的引用名", () => {
    const ref = nextKeyRef([], "DEEPSEEK_API_KEY");
    expect(ref).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/);
  });
});

describe("删除一条", () => {
  it("从列表里摘掉指定的那条，保持其它顺序", () => {
    expect(removeKeyRef(["A", "B", "C"], "B")).toEqual(["A", "C"]);
  });

  it("删不存在的引用名是无操作（不抛）", () => {
    expect(removeKeyRef(["A"], "Z")).toEqual(["A"]);
  });

  it("删最后一条 → 空列表（搜索随之不可用，这是用户的明确选择）", () => {
    expect(removeKeyRef(["A"], "A")).toEqual([]);
  });
});
