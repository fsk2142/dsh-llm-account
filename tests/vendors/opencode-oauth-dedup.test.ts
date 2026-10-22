/**
 * `resolveOAuthCredential` 的**真实行为**（2026-10-22 收敛）。
 *
 * 本文件原本有 4 条测试，其中 3 条**复刻了 adapter 的去重逻辑**做语义验证 —— bug 审查
 * 复查指出：「如果生产代码写错了，测试照样通过」。
 *
 * 那个缺陷已修：去重逻辑抽到 `core/single-flight.ts`，由
 * `tests/core/single-flight.test.ts` **直测生产代码**（两个变异都能抓到）。
 *
 * 这里只保留唯一一条测真实生产函数行为的：token 没过期就不该打认证端点。
 */
import { describe, expect, it } from "vitest";

import { resolveOAuthCredential } from "../../src/vendors/opencode/oauth";

/** 造一个凭据（形状与 `parseOAuthCredential` 一致）。 */
function credential(access: string, expiresAt: number): string {
  return `ocoauth1:${JSON.stringify({
    v: 1,
    access,
    refresh: "r",
    expiresAt,
    orgId: "org-1",
  })}`;
}

describe("resolveOAuthCredential", () => {
  it("token 仍有效时**不打认证端点**，直接用现值", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const fresh = credential("valid-access", Date.now() + 3_600_000);
    const resolved = await resolveOAuthCredential(fresh, { fetchImpl, authBase: "https://auth.example" });

    expect(resolved?.key).toBe("valid-access");
    expect(calls, "没过期就不该刷新").toBe(0);
  });
});
