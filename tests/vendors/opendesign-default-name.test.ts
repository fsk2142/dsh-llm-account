/**
 * 改名后能恢复默认名称 —— 含**老账号**（2026-10-22 用户报障）。
 *
 * 用户原话：「改名后还原默认名称也没有」。
 *
 * ## 根因
 *
 * `defaultName` 是 v0.9.0 才加的字段，之前建的账号都没有它。而「恢复默认名称」菜单项
 * 的依据是 `view.defaultLabel`，老账号拿到的是 `undefined` → 菜单项**不显示** →
 * 用户看不到这个功能。
 *
 * ## 修法
 *
 * **改名时若还没有默认名，先把当前名存进去**。此刻 `item.name` 还是改名前的值，
 * 而它几乎必然就是登录时那个名字（用户第一次改名时，当前名 = 默认名）。
 *
 * 对「已经改过名但没有 defaultName」的历史数据，这里存下的是上一次的名字而非最初的 ——
 * 无法更准，但至少让「恢复」从此可用，且**不编造**一个假名字。
 */
import { describe, expect, it } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import { createOpenDesignAccounts } from "../../src/vendors/opendesign/accounts";

/** 一个最小的设置端口：只实现 accounts 用到的那几个方法。 */
function fakeSettings(initial: Record<string, unknown>): {
  settings: {
    describe: (ns: string) => Promise<{ value: Record<string, unknown>; revision: number }>;
    mutate: (
      ns: string,
      ops: readonly SettingsOp[],
      revision: number,
    ) => Promise<{ value: Record<string, unknown>; revision: number }>;
  };
  value: () => Record<string, unknown>;
} {
  let value = initial;
  let revision = 0;
  /** 把一条 `set` 应用到（不可变的）文档上。 */
  const apply = (doc: Record<string, unknown>, op: SettingsOp): Record<string, unknown> => {
    if (op.op !== "set") return doc;
    const path = Array.isArray(op.path) ? op.path : [];
    if (path.length === 0) return op.value as Record<string, unknown>;
    if (path.length === 1) return { ...doc, [String(path[0])]: op.value };
    return doc;
  };
  return {
    settings: {
      describe: async () => ({ value, revision }),
      // **注意参数顺序**：`mutate(ns, ops, revision)` —— ops 在中间。
      mutate: async (_ns, ops) => {
        for (const op of ops) value = apply(value, op);
        revision += 1;
        return { value, revision };
      },
    },
    value: () => value,
  };
}

/** 一个只记账的凭据端口。 */
const credentials = {
  describe: async (refs: readonly string[]) => refs.map((ref) => ({ ref, configured: true })),
  set: async () => undefined,
  unset: async () => undefined,
};

/** 一个什么都不做的意图日志。 */
const intents = {
  append: async () => undefined,
  settle: async () => undefined,
  read: async () => [],
} as never;

/** 造一个带两个老账号（无 defaultName）的文档。 */
function oldDocument(): Record<string, unknown> {
  return {
    accounts: [
      { id: "ACC_A", name: "原始名A", apiKeyEnv: "ACC_A", controlKeyEnv: "ACC_A_CONTROL" },
      { id: "ACC_B", name: "原始名B", apiKeyEnv: "ACC_B", controlKeyEnv: "ACC_B_CONTROL" },
    ],
  };
}

/** 从文档里取某个账号条目。 */
function entryOf(value: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  const accounts = value.accounts;
  if (!Array.isArray(accounts)) return undefined;
  return accounts.find((item): item is Record<string, unknown> => (item as { id?: string })?.id === ref);
}

describe("老账号改名时补写默认名", () => {
  it("**第一次改名时，把改名前的名字存为 defaultName**", async () => {
    const store = fakeSettings(oldDocument());
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    await accounts.rename("ACC_A", "我的小号");

    const entry = entryOf(store.value(), "ACC_A");
    expect(entry?.name, "改成新名字").toBe("我的小号");
    expect(entry?.defaultName, "**改名前的名字被记为默认名**").toBe("原始名A");
  });

  it("**第二次改名不覆盖已记录的 defaultName**（默认值不该被后续改名影响）", async () => {
    const store = fakeSettings(oldDocument());
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    await accounts.rename("ACC_A", "第一次改");
    await accounts.rename("ACC_A", "第二次改");

    const entry = entryOf(store.value(), "ACC_A");
    expect(entry?.name).toBe("第二次改");
    expect(entry?.defaultName, "仍然是最初那个名字").toBe("原始名A");
  });

  it("已经有 defaultName 的账号改名时不动它", async () => {
    const doc = {
      accounts: [
        { id: "ACC_C", name: "现在的名", defaultName: "登录邮箱@example.com", apiKeyEnv: "ACC_C" },
      ],
    };
    const store = fakeSettings(doc);
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    await accounts.rename("ACC_C", "又改了");

    const entry = entryOf(store.value(), "ACC_C");
    expect(entry?.name).toBe("又改了");
    expect(entry?.defaultName).toBe("登录邮箱@example.com");
  });

  it("**rename 后 list() 能带出 defaultLabel**（界面据此显示菜单项）", async () => {
    const store = fakeSettings(oldDocument());
    const accounts = createOpenDesignAccounts({
      settings: store.settings as never,
      credentials: credentials as never,
      intents,
    });

    // 改名之前：老账号没有默认名，界面不显示「恢复默认名称」。
    const before = await accounts.list();
    expect(before.find((view) => view.ref === "ACC_A")?.defaultLabel).toBeUndefined();

    await accounts.rename("ACC_A", "我的小号");

    // 改名之后：有了默认名，菜单项会出现。
    const after = await accounts.list();
    expect(after.find((view) => view.ref === "ACC_A")?.defaultLabel).toBe("原始名A");
  });
});
