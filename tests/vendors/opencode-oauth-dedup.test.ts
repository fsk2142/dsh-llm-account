/**
 * OAuth 刷新并发去重（bug 审查 LOW-1，2026-10-22 修）。
 *
 * ## 问题
 *
 * `resolveOAuthCredential` 在 token 过期前 60s 会刷新。若同一账号在同一时刻有多个并发
 * 请求（多标签页，或宿主并发跑 compaction / 会话标题），它们都会发现「该刷新了」并各自
 * 发起一次刷新。服务端若启用 refresh token 轮换，第二次会用**已失效**的旧 refresh token
 * —— 那一次刷新失败，按缺凭据处理，该请求失败。
 *
 * ## 修法
 *
 * adapter 侧按账号 ref 去重：同一 ref 只保留一次刷新 promise，并发请求 await 同一个结果。
 * 表项在 settle 后立刻移除（**失败也移除**，否则该账号再也刷不动）。
 *
 * 这里测的是**去重语义本身**（纯函数层面无法触及 adapter 私有方法，所以用一个小模型
 * 复刻同一份逻辑并对 `resolveOAuthCredential` 的调用次数断言）。
 */
import { describe, expect, it } from "vitest";

import { resolveOAuthCredential } from "../../src/vendors/opencode/oauth";

/** 一个即将过期的 OAuth 凭据（带 `oauth:` 前缀的 JSON）。 */
function expiringCredential(access: string, refresh: string): string {
  return `ocoauth1:${JSON.stringify({
    v: 1,
    access,
    refresh,
    expiresAt: Date.now() - 1_000, // 已过期：必然触发刷新
    orgId: "org-1",
  })}`;
}

/** 造一个 OAuth 端点替身：每次刷新返回新的 access。 */
function fakeFetch(seq: { count: number }): typeof fetch {
  return (async () => {
    seq.count += 1;
    const body = JSON.stringify({
      access_token: `access-${seq.count}`,
      refresh_token: `refresh-${seq.count}`,
      expires_in: 3_600,
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("OAuth 刷新并发去重", () => {
  it("**并发请求只触发一次刷新**（复刻 adapter 的去重表逻辑）", async () => {
    const seq = { count: 0 };
    const fetchImpl = fakeFetch(seq);
    const raw = expiringCredential("old-access", "old-refresh");
    const deps = { fetchImpl, authBase: "https://auth.example" };

    /**
     * 复刻 adapter 的 `#refreshShared`：Map<ref, Promise> + settle 后移除。
     */
    const refreshing = new Map<string, Promise<unknown>>();
    const shared = (ref: string): Promise<unknown> => {
      const existing = refreshing.get(ref);
      if (existing !== undefined) return existing;
      const pending = resolveOAuthCredential(raw, deps).finally(() => {
        refreshing.delete(ref);
      });
      refreshing.set(ref, pending);
      return pending;
    };

    // 三个并发请求，同一账号。
    const results = await Promise.all([shared("ACC_1"), shared("ACC_1"), shared("ACC_1")]);

    expect(seq.count, "**只刷新一次**，不是三次").toBe(1);
    // 三个调用拿到同一份结果。
    expect(new Set(results.map((row) => (row as { key: string }).key)).size).toBe(1);
  });

  it("不同账号各自刷新（去重按 ref，不是全局）", async () => {
    const seq = { count: 0 };
    const fetchImpl = fakeFetch(seq);
    const raw = expiringCredential("old-access", "old-refresh");
    const deps = { fetchImpl, authBase: "https://auth.example" };

    const refreshing = new Map<string, Promise<unknown>>();
    const shared = (ref: string): Promise<unknown> => {
      const existing = refreshing.get(ref);
      if (existing !== undefined) return existing;
      const pending = resolveOAuthCredential(raw, deps).finally(() => {
        refreshing.delete(ref);
      });
      refreshing.set(ref, pending);
      return pending;
    };

    await Promise.all([shared("ACC_1"), shared("ACC_2")]);

    expect(seq.count, "两个账号各刷新一次").toBe(2);
  });

  it("**刷新失败后表项被移除**，下一个请求能重新尝试", async () => {
    let attempts = 0;
    const failing = (async () => {
      attempts += 1;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;

    const raw = expiringCredential("old-access", "old-refresh");
    const deps = { fetchImpl: failing, authBase: "https://auth.example" };

    const refreshing = new Map<string, Promise<unknown>>();
    const shared = (): Promise<unknown> => {
      const existing = refreshing.get("ACC_1");
      if (existing !== undefined) return existing;
      const pending = resolveOAuthCredential(raw, deps).finally(() => {
        refreshing.delete("ACC_1");
      });
      refreshing.set("ACC_1", pending);
      return pending;
    };

    // 第一次失败（500 → 解析失败 → undefined）。
    expect(await shared()).toBeUndefined();
    expect(refreshing.has("ACC_1"), "**失败后必须移除表项**").toBe(false);

    // 第二次还能再试（否则该账号永远刷不动）。
    expect(await shared()).toBeUndefined();
    expect(attempts, "两次都真的发了请求").toBe(2);
  });

  it("token 仍有效时不触发刷新（去重表不参与这条路径）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const fresh = `ocoauth1:${JSON.stringify({
      v: 1,
      access: "valid-access",
      refresh: "r",
      expiresAt: Date.now() + 3_600_000, // 1 小时后才过期
      orgId: "org-1",
    })}`;

    const resolved = await resolveOAuthCredential(fresh, { fetchImpl, authBase: "https://auth.example" });
    expect(resolved?.key).toBe("valid-access");
    expect(calls, "没过期就不该打认证端点").toBe(0);
  });
});
