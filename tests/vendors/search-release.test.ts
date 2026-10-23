/**
 * 搜索关闭时让出 `web.searchProvider` 槽位（2026-10-23）。
 *
 * ## 为什么需要（用户报障的场景）
 *
 * 用户的 profile 显式写着 `searchProvider: llm-account-deepseek`。宿主的选路是
 * 「按 id 精确匹配，命中就用」，于是：
 *
 * - 用户选「不启用」→ `search()` 抛错，**但宿主仍然把请求交给本插件**，别的搜索
 *   插件排不上队；
 * - 装第二个插件 + 删掉 `searchProvider` 行 → 两个 provider 都 `available()`，
 *   宿主报 `WEB_PROVIDER_AMBIGUOUS`，两个都用不了。
 *
 * ## 修法
 *
 * 切到 `off` 时把 `web.searchProvider` 置空（走「未指定 id」的选路，让出名额）；
 * 切回启用态时写回本插件 id。
 *
 * 下面用真实的设置端口替身验证这些路径，**不依赖宿主**。
 */
import { describe, expect, it, vi } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import { SEARCH_PROVIDER_ID, WEB_ROW_ID, syncSearchProviderSlot } from "../../src/vendors/search-release";

/** 造一个只含 `web` 行的设置端口替身，并记录写入。 */
function webSettings(initial: Record<string, unknown>): {
  settings: {
    describe: (ns: string) => Promise<{ value: unknown; revision: number }>;
    mutate: (ns: string, ops: readonly SettingsOp[], revision: number) => Promise<unknown>;
  };
  value: () => Record<string, unknown>;
  writes: { ns: string; ops: unknown[] }[];
} {
  let value = { ...initial };
  let revision = 0;
  const writes: { ns: string; ops: unknown[] }[] = [];
  return {
    settings: {
      describe: async (ns: string) => {
        if (ns !== WEB_ROW_ID) throw new Error(`no row ${ns}`);
        return { value, revision };
      },
      mutate: async (ns: string, ops: readonly SettingsOp[], expected: number) => {
        expect(expected, "必须带上读到的 revision").toBe(revision);
        writes.push({ ns, ops: [...ops] });
        for (const op of ops) {
          if (op.op !== "set") continue;
          value = { ...value, [op.path[0]!]: op.value };
        }
        revision += 1;
        return { value, revision };
      },
    },
    value: () => value,
    writes,
  };
}

describe("同步 web.searchProvider 槽位", () => {
  it("**切到 off 时把本插件的绑定置空**（让出名额给别的搜索插件）", async () => {
    const store = webSettings({ searchProvider: SEARCH_PROVIDER_ID });
    const changed = await syncSearchProviderSlot({
      settings: store.settings as never,
      strategy: () => "off",
    });

    expect(changed, "应当真的改了配置").toBe(true);
    expect(store.value().searchProvider, "置空后宿主走「未指定 id」的选路").toBe("");
    expect(store.writes, "只写一次").toHaveLength(1);
  });

  it("**切回启用态时写回**本插件的 id", async () => {
    const store = webSettings({ searchProvider: "" });
    const changed = await syncSearchProviderSlot({
      settings: store.settings as never,
      strategy: () => "api-first",
    });

    expect(changed).toBe(true);
    expect(store.value().searchProvider).toBe(SEARCH_PROVIDER_ID);
  });

  it("**用户显式指向别的插件时不抢**（off 态也不清掉别人的）", async () => {
    const store = webSettings({ searchProvider: "ddg" });
    const changed = await syncSearchProviderSlot({
      settings: store.settings as never,
      strategy: () => "off",
    });

    expect(changed, "不是自己的绑定，不动").toBe(false);
    expect(store.value().searchProvider, "别人的 provider 必须留着").toBe("ddg");
    expect(store.writes).toHaveLength(0);
  });

  it("启用态且已绑定本插件时不重复写（避免无意义的配置变动）", async () => {
    const store = webSettings({ searchProvider: SEARCH_PROVIDER_ID });
    const changed = await syncSearchProviderSlot({
      settings: store.settings as never,
      strategy: () => "gateway-first",
    });

    expect(changed).toBe(false);
    expect(store.writes).toHaveLength(0);
  });

  it("没有 `web` 行（没装 dsh-web）时静默返回，不抛错", async () => {
    const warn = vi.fn();
    const changed = await syncSearchProviderSlot({
      settings: {
        describe: async () => {
          throw new Error("no such row");
        },
        mutate: async () => undefined,
      } as never,
      strategy: () => "off",
      warn,
    });

    expect(changed).toBe(false);
    expect(warn, "这不是错误，不该警告").not.toHaveBeenCalled();
  });

  it("写失败时记一条 warning，但不抛错（搜索仍按 available() 工作）", async () => {
    const warn = vi.fn();
    const changed = await syncSearchProviderSlot({
      settings: {
        describe: async () => ({ value: { searchProvider: SEARCH_PROVIDER_ID }, revision: 1 }),
        mutate: async () => {
          throw new Error("read-only profile");
        },
      } as never,
      strategy: () => "off",
      warn,
    });

    expect(changed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("未能让出");
  });

  it("策略值形状不可信（undefined / 数字 / 空串）时按启用处理", async () => {
    for (const strategy of [undefined, 42, "", "  "]) {
      const store = webSettings({ searchProvider: SEARCH_PROVIDER_ID });
      const changed = await syncSearchProviderSlot({
        settings: store.settings as never,
        strategy: () => strategy,
      });
      expect(changed, `strategy=${String(strategy)} 不该触发让位`).toBe(false);
      expect(store.value().searchProvider).toBe(SEARCH_PROVIDER_ID);
    }
  });
});
