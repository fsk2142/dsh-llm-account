import { describe, expect, it } from "vitest";

import { OPENCODE_DEFAULT_REF, opencodeAccountSlot } from "../../src/vendors/opencode/accounts";

/**
 * 用**真机配置**验证账号槽解析（2026-11-02 排查：
 * 请求报 `no API key for OpenCode Go account "OPENCODE_API_KEY"`，
 * 但配置与凭据库里都是 `DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f`）。
 */
describe("真机配置下的 opencode 账号槽", () => {
  const CONFIG = {
    modelVisibility: { "deepseek-v4.1-flash": true },
    visibleModels: ["deepseek-v4.1-flash"],
    modelAccountRules: [
      { models: ["deepseek-v4.1-flash"], account: "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f" },
    ],
    apiKeyEnv: "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f",
    accounts: [
      {
        id: "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f",
        name: "Default",
        apiKeyEnv: "DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f",
      },
    ],
    accountIntents: [],
  };

  it("顶层 apiKeyEnv 是合法 ref → pinned/ref 都是它", () => {
    const slot = opencodeAccountSlot(CONFIG);
    expect(slot.ref).toBe("DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f");
    expect(slot.pinned).toBe("DSH_OPENCODE_GO_ACCOUNT_DEFAULT_11326fd2590f");
  });

  it("**顶层 apiKeyEnv 缺失 → 回退内置默认 ref**（当前报错的形态）", () => {
    const { apiKeyEnv: _drop, ...withoutTop } = CONFIG;
    const slot = opencodeAccountSlot(withoutTop);
    expect(slot.ref, "缺失时回退默认").toBe(OPENCODE_DEFAULT_REF);
    expect(slot.pinned, "且不固定任何账号").toBeNull();
  });

  it("顶层 apiKeyEnv 为空串 → 同样回退默认", () => {
    const slot = opencodeAccountSlot({ ...CONFIG, apiKeyEnv: "" });
    expect(slot.ref).toBe(OPENCODE_DEFAULT_REF);
  });

  it("顶层 apiKeyEnv 是非法名（含 - 等）→ 回退默认", () => {
    const slot = opencodeAccountSlot({ ...CONFIG, apiKeyEnv: "bad-ref-with-dash" });
    expect(slot.ref).toBe(OPENCODE_DEFAULT_REF);
  });
});
