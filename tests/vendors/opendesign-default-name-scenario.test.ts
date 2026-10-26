/**
 * 端到端验证用户的实际场景（2026-10-22 确认）。
 *
 * 需求：「现在的就是默认名称了，以后我修改成别的再恢复为默认名称的时候，
 * 默认名称应该就是现在这个」
 *
 * 场景：
 * 1. 当前配置：name = defaultName = 邮箱
 * 2. 用户改名成「我的小号」
 * 3. 点「恢复默认名称」→ 应当回到邮箱（而不是回到「我的小号」）
 *
 * 这条测试用**真实配置形状**跑一遍，证明 `rename` 不会覆盖已有的 defaultName。
 */
import { describe, expect, it } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import { createOpenDesignAccounts } from "../../src/vendors/opendesign/accounts";

/** 复刻用户当前的真实配置形状。 */
function fakeStore(): {
  settings: {
    describe: () => Promise<{ value: Record<string, unknown>; revision: number }>;
    mutate: (ns: string, ops: readonly SettingsOp[], revision: number) => Promise<{ value: Record<string, unknown>; revision: number }>;
  };
  value: () => Record<string, unknown>;
} {
  let value: Record<string, unknown> = {
    accounts: [
      // 用户已手工把 defaultName 设为当前名。
      { id: "ACC1", name: "first@example.com", defaultName: "first@example.com", apiKeyEnv: "ACC1" },
      { id: "ACC2", name: "second@example.com", defaultName: "second@example.com", apiKeyEnv: "ACC2" },
    ],
  };
  let revision = 0;
  return {
    settings: {
      describe: async () => ({ value, revision }),
      mutate: async (_ns, ops) => {
        for (const op of ops) {
          if (op.op === "set" && Array.isArray(op.path) && op.path.length === 1) {
            value = { ...value, [String(op.path[0])]: op.value };
          }
        }
        revision += 1;
        return { value, revision };
      },
    },
    value: () => value,
  };
}

/** 只记账的凭据端口。 */
const credentials = {
  describe: async (refs: readonly string[]) => refs.map((ref) => ({ ref, configured: true })),
  set: async () => undefined,
  unset: async () => undefined,
};

/** 什么都不做的意图日志。 */
const intents = { append: async () => undefined, settle: async () => undefined, read: async () => [] } as never;

describe("用户场景：改了名之后能恢复到现在这个默认名", () => {
  it("**改名不覆盖已存在的 defaultName**，恢复时回到它", async () => {
    const store = fakeStore();
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    // 初始：名字就是默认名。
    const before = await accounts.list();
    const first = before.find((view) => view.ref === "ACC1");
    expect(first?.label).toBe("first@example.com");
    expect(first?.defaultLabel).toBe("first@example.com");

    // 用户改名。
    await accounts.rename("ACC1", "我的小号");
    const renamed = (await accounts.list()).find((view) => view.ref === "ACC1");
    expect(renamed?.label, "名字变了").toBe("我的小号");
    expect(renamed?.defaultLabel, "**默认名没被覆盖**").toBe("first@example.com");

    // 点「恢复默认名称」。
    await accounts.restoreDefaultLabel?.("ACC1");
    const restored = (await accounts.list()).find((view) => view.ref === "ACC1");
    expect(restored?.label, "**恢复到用户设定的那个默认名**").toBe("first@example.com");
  });

  it("多次改名后默认名仍然不变", async () => {
    const store = fakeStore();
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    await accounts.rename("ACC1", "第一次改");
    await accounts.rename("ACC1", "第二次改");
    await accounts.rename("ACC1", "第三次改");

    const view = (await accounts.list()).find((row) => row.ref === "ACC1");
    expect(view?.label).toBe("第三次改");
    expect(view?.defaultLabel, "无论改几次，默认名都是最初那个").toBe("first@example.com");
  });

  it("两个账号各管各的默认名（不会串）", async () => {
    const store = fakeStore();
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    await accounts.rename("ACC1", "小号A");
    await accounts.rename("ACC2", "小号B");

    const list = await accounts.list();
    expect(list.find((row) => row.ref === "ACC1")?.defaultLabel).toBe("first@example.com");
    expect(list.find((row) => row.ref === "ACC2")?.defaultLabel).toBe("second@example.com");
  });
});
