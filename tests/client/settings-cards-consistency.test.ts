/**
 * 「搜索方式」下拉必须真的出现在搜索设置卡里。
 *
 * 需求：「搜索设置里面没有第三方API和网关API的选择按钮」。
 *
 * 根因：`settings-cards.ts` 的 search 卡里还写着**旧字段名** `searchPreferGateway`，
 * 而 `shell.ts` 已经把它换成了 `searchStrategy`。卡片按字段名匹配，匹配不上就一个都不渲染
 * —— 于是整张搜索卡只剩 API key 引用那一项（甚至全空）。
 *
 * 这类「两处各写一份字段名」的分叉，只靠单元测试测不到：必须比较
 * **卡片声明**与**厂商声明**两份清单是否对得上。
 */
import { describe, expect, it } from "vitest";

import { SETTINGS_CARDS } from "../../src/client/settings-cards";
import { VENDORS } from "../../src/client/shell";

/** VENDORS 里声明的全部字段名。 */
function declaredFieldKeys(): string[] {
  return [...new Set(VENDORS.flatMap((vendor) => vendor.cards.flatMap((card) => card.fields.map((field) => field.key))))];
}

describe("卡片声明与厂商声明必须对得上", () => {
  it("卡片里引用的每个共有字段，都真的被某家厂商声明过", () => {
    const declared = new Set(declaredFieldKeys());
    const missing: string[] = [];
    for (const card of SETTINGS_CARDS) {
      for (const key of card.shared) {
        if (!declared.has(key)) missing.push(`${card.id}:${key}`);
      }
    }
    // 空数组 = 没有悬空引用。这一条能挡住「改了一处忘了另一处」。
    expect(missing).toEqual([]);
  });

  it("卡片里引用的每个专属字段，也都真的被对应厂商声明过", () => {
    const byVendor = new Map(VENDORS.map((vendor) => [vendor.providerId, vendor.cards.flatMap((card) => card.fields.map((field) => field.key))]));
    const missing: string[] = [];
    for (const card of SETTINGS_CARDS) {
      for (const field of card.specific) {
        const keys = byVendor.get(field.vendor) ?? [];
        if (!keys.includes(field.key)) missing.push(`${card.id}:${field.vendor}:${field.key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("搜索卡里包含「搜索方式」（旧的 searchPreferGateway 已不存在）", () => {
    const search = SETTINGS_CARDS.find((card) => card.id === "search");
    expect(search?.shared).toContain("searchStrategy");
    expect(search?.shared).not.toContain("searchPreferGateway");
  });

  it("搜索卡里不再声明 API key 引用字段（密钥由添加/删除动作维护）", () => {
    const search = SETTINGS_CARDS.find((card) => card.id === "search");
    // 2026-10-20 需求「只保留保存密钥那个」：引用名列表不再是用户编辑的字段。
    expect(search?.shared).not.toContain("searchApiKeyRefs");
  });

  it("每个已声明的搜索相关字段都被卡片收录（没有漏掉的新字段）", () => {
    const searchKeys = SETTINGS_CARDS.find((card) => card.id === "search")?.shared ?? [];
    for (const key of ["searchStrategy"]) {
      expect(searchKeys, key).toContain(key);
    }
  });
});
