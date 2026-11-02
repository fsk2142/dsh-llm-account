import { describe, expect, it } from "vitest";

import { OPENCODE_DEFAULT_REF } from "../../src/vendors/opencode/accounts";
import { orderOf } from "../../src/vendors/opencode/index";

/**
 * 真机报障回归（2026-11-02）。
 *
 * ## 现象
 *
 * 界面上账号显示「Default · 已配置」，但一发请求就报：
 *
 * ```
 * llm-opencode-go: no API key for OpenCode Go account "OPENCODE_API_KEY";
 * store it through the credentials service or export it in the launching environment
 * ```
 *
 * ## 根因
 *
 * `orderOf` 原来 = `[defaultRefOf(document), ...accountRefsOf(document)]`。
 * `defaultRefOf` 在顶层 `apiKeyEnv` 缺失时回退到内置默认名 `OPENCODE_API_KEY`；
 * 而 `Config` 里 `apiKeyEnv` 还有 `.default(OPENCODE_DEFAULT_REF)` ——
 * **默认值可能被写进文档**，于是连"缺失"都不成立，`pinned` 直接等于那个幽灵名。
 *
 * 结果轮换顺序首位永远是 `OPENCODE_API_KEY`（凭据库里不存在），
 * `pick()` 拿到它 → 适配器抛 no API key，**真实账号从来没被尝试**。
 *
 * 界面显示正常是因为账号卡片读的是 `accounts[]`（有真实条目）。
 *
 * 这里直接调生产函数 `orderOf`（不是复刻一份逻辑）。
 */
const REAL = "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f";

describe("orderOf：不能把幽灵默认账号排进轮换顺序", () => {
  it("**schema 默认值被写进文档时也不算「用户指定」**（真机形态）", () => {
    /**
     * 这是最关键的用例：文档里 `apiKeyEnv` 显式等于 `OPENCODE_API_KEY`
     * —— 它是 schema 默认值，不是用户填的。凭据库里没有这个 ref。
     */
    const order = orderOf({
      apiKeyEnv: OPENCODE_DEFAULT_REF,
      accounts: [{ id: REAL, name: "Default", apiKeyEnv: REAL }],
    });
    expect(order[0], "顺序首位必须是真实账号").toBe(REAL);
    expect(order, "幽灵名字不该出现在顺序里").not.toContain(OPENCODE_DEFAULT_REF);
  });

  it("顶层缺失、账号表非空 → 只用账号表", () => {
    const order = orderOf({
      accounts: [{ id: REAL, name: "Default", apiKeyEnv: REAL }],
    });
    expect(order).toEqual([REAL]);
  });

  it("顶层显式写了真实 ref → 它排第一（存量行为不变）", () => {
    const OTHER = "DSH_OPENCODE_GO_ACCOUNT_OTHER";
    const order = orderOf({
      apiKeyEnv: OTHER,
      accounts: [
        { id: REAL, name: "Default", apiKeyEnv: REAL },
        { id: OTHER, name: "Other", apiKeyEnv: OTHER },
      ],
    });
    expect(order[0], "显式指定优先").toBe(OTHER);
    expect(order).toContain(REAL);
  });

  it("顶层显式 ref 不在账号表里 → 仍排第一（旧插件 legacy 槽行为）", () => {
    const LEGACY = "DSH_LEGACY_ONLY";
    const order = orderOf({ apiKeyEnv: LEGACY, accounts: [] });
    expect(order).toEqual([LEGACY]);
  });

  it("**完全没配** → 才退回默认槽（这样报错信息才有意义）", () => {
    expect(orderOf({})).toEqual([OPENCODE_DEFAULT_REF]);
    expect(orderOf({ accounts: [] })).toEqual([OPENCODE_DEFAULT_REF]);
  });

  it("accountOrder 覆盖仍生效（用户手动排序）", () => {
    const A = "DSH_A";
    const B = "DSH_B";
    const order = orderOf({
      accounts: [
        { id: A, name: "A", apiKeyEnv: A },
        { id: B, name: "B", apiKeyEnv: B },
      ],
      accountOrder: [B, A],
    });
    expect(order).toEqual([B, A]);
  });
});
