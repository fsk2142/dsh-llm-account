import { describe, expect, it } from "vitest";

import { serializeOAuthCredential, type OAuthCredential } from "../../src/vendors/opencode/oauth";
import { createOpencodeQuota } from "../../src/vendors/opencode/quota";

/**
 * 网页登录账号的额度鉴权（2026-11-04 外部审查 U02）。
 *
 * ## 审查原文
 *
 * > 将整个 ocoauth1 序列化凭据当 Bearer 发送，遗漏 org 头，聊天可用而额度 401。
 *
 * ## 根因
 *
 * 额度端口拿的是 `resolveAccountKey()` 的**原始凭据串**，直接塞进
 * `Authorization: Bearer <key>`。而网页登录的凭据是 `ocoauth1:<base64 blob>`，
 * 里面装着 access / refresh / orgId —— 整串当 Bearer 必然是 401。
 *
 * 聊天路径（adapter）走的是 `resolveOAuthCredential()`：解出 access token，
 * 并额外带 `x-opencode-org-id`。额度路径少了这一步，于是「能聊天、读不到额度」。
 */
const OAUTH_BLOB = serializeOAuthCredential({
  v: 1,
  access: "access-from-web-login",
  refresh: "refresh-from-web-login",
  expiresAt: Date.now() + 3_600_000,
  orgId: "org-from-web-login",
} satisfies OAuthCredential);

/** 记录出站请求头。 */
function quotaWith(key: string): {
  snapshot: Promise<unknown>;
  headers: () => Record<string, string>;
} {
  let seen: Record<string, string> = {};
  const snapshot = createOpencodeQuota({
    ref: () => "acc",
    resolveKey: async () => key,
    fetchImpl: (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
      seen = { ...(init?.headers ?? {}) };
      return new Response(
        JSON.stringify({
          usage: { monthly: { status: "ok", percent: 3, resetsAt: "2026-12-02T14:26:00.000Z" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch,
    apiBase: "https://opencode.ai/zen/go/v1",
  }).snapshot();
  return { snapshot, headers: () => seen };
}

describe("U02 · 网页登录账号的额度鉴权", () => {
  it("**Bearer 必须是解出来的 access token，不是整个 blob**", async () => {
    const { snapshot, headers } = quotaWith(OAUTH_BLOB);
    await snapshot;

    const authorization = headers().authorization ?? headers().Authorization ?? "";
    expect(authorization, "必须带 Bearer").toContain("Bearer");
    expect(
      authorization,
      "不能把 ocoauth1:… 整串当 Bearer（那必然 401）",
    ).not.toContain("ocoauth1");
    expect(authorization, "Bearer 应当是从 blob 解出的 access token").toContain("access-from-web-login");
  });

  it("**必须补 `x-opencode-org-id` 头**（网关按它路由额度）", async () => {
    const { snapshot, headers } = quotaWith(OAUTH_BLOB);
    await snapshot;

    const org = headers()["x-opencode-org-id"];
    expect(org, "网页登录的额度请求必须带 org 头").toBe("org-from-web-login");
  });

  it("**普通 API key 保持不变**（不能给所有请求都塞 org 头）", async () => {
    const { snapshot, headers } = quotaWith("plain-api-key-value");
    await snapshot;

    const authorization = headers().authorization ?? headers().Authorization ?? "";
    expect(authorization).toContain("Bearer plain-api-key-value");
    expect(
      headers()["x-opencode-org-id"],
      "普通 key 没有 org 概念，不该凭空产生这个头",
    ).toBeUndefined();
  });

  it("过期的 blob 仍能拿来换额度（刷新后使用新 access）", async () => {
    const expired = serializeOAuthCredential({
      v: 1,
      access: "expired-access",
      refresh: "still-good-refresh",
      expiresAt: Date.now() - 60_000,
      orgId: "org-x",
    });
    let refreshCalls = 0;
    let seen: Record<string, string> = {};
    const snapshot = createOpencodeQuota({
      ref: () => "acc",
      resolveKey: async () => expired,
      fetchImpl: (async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
        const url = String(input);
        if (url.includes("/device/token")) {
          refreshCalls += 1;
          return new Response(
            JSON.stringify({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600 }),
            { status: 200 },
          );
        }
        seen = { ...(init?.headers ?? {}) };
        return new Response(JSON.stringify({ usage: { monthly: { status: "ok", percent: 1 } } }), { status: 200 });
      }) as unknown as typeof fetch,
      apiBase: "https://opencode.ai/zen/go/v1",
      authBase: "https://opencode.ai",
    }).snapshot();

    await snapshot;
    expect(refreshCalls, "过期时应当刷新一次").toBe(1);
    const authorization = seen.authorization ?? seen.Authorization ?? "";
    expect(authorization, "刷新后用新 access").toContain("Bearer fresh-access");
  });
});
