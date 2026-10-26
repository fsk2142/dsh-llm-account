/**
 * 搜索密钥的**写入**。
 *
 * 实际情况：「我加了 api，点了保存但是还是显示未添加」。
 *
 * 根因：设置页那个输入框填的是**引用名**（`DEEPSEEK_API_KEY`），属于「设置字段」——
 * 点保存只是把这个名字写进 `cordis.patch.yml`，**真 key 从来没有进过凭据库**。
 * 所以徽标显示「未添加」是实话，不是 bug。
 *
 * 修法：搜索卡里加一个**密码框 + 保存密钥按钮**，把真 key 写进凭据库
 * （引用名用上面那个字段的值）。这与账号卡片「更换密钥」是同一条路径。
 */
import { describe, expect, it } from "vitest";

import { parseSecretRefs, validateSecretInput } from "../../../src/core/switching/search-keys";

describe("解析密钥要写进哪几个引用名", () => {
  it("单个引用名", () => {
    expect(parseSecretRefs("DEEPSEEK_API_KEY")).toEqual(["DEEPSEEK_API_KEY"]);
  });

  it("逗号分隔的多个（与设置字段同一种写法）", () => {
    expect(parseSecretRefs("A_KEY, B_KEY")).toEqual(["A_KEY", "B_KEY"]);
  });

  it("中文逗号与空白也认（用户可能从别处粘过来）", () => {
    expect(parseSecretRefs("A_KEY，B_KEY\nC_KEY")).toEqual(["A_KEY", "B_KEY", "C_KEY"]);
  });

  it("去重并保留顺序", () => {
    expect(parseSecretRefs("B, A, B")).toEqual(["B", "A"]);
  });

  it("空串/纯空白 → 空数组（调用方据此不发请求）", () => {
    expect(parseSecretRefs("")).toEqual([]);
    expect(parseSecretRefs("   ")).toEqual([]);
    expect(parseSecretRefs(",,")).toEqual([]);
  });

  it("非法引用名被丢掉（不能让一个带空格的引用名落库）", () => {
    expect(parseSecretRefs("GOOD_KEY, bad key, GOOD_2")).toEqual(["GOOD_KEY", "GOOD_2"]);
  });
});

describe("密钥输入本身的校验", () => {
  it("正常 key 通过", () => {
    expect(validateSecretInput("sk-abcdef123456", ["DEEPSEEK_API_KEY"])).toBeUndefined();
  });

  it("空 key 拒绝（写空等于清掉密钥，不该用这个按钮做）", () => {
    expect(validateSecretInput("", ["DEEPSEEK_API_KEY"])).toMatch(/密钥/);
    expect(validateSecretInput("   ", ["DEEPSEEK_API_KEY"])).toMatch(/密钥/);
  });

  it("没有引用名时拒绝（不知道往哪个槽写）", () => {
    expect(validateSecretInput("sk-abc", [])).toMatch(/引用名/);
  });

  it("首尾空白会被去掉后判定（粘贴常带换行）", () => {
    expect(validateSecretInput("  sk-abc  ", ["A"])).toBeUndefined();
  });

  it("key 里带空格 → 拒绝（几乎必然是粘错了，例如把两段粘在一起）", () => {
    expect(validateSecretInput("sk-abc sk-def", ["A"])).toMatch(/空格/);
  });
});
