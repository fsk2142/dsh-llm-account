/**
 * OAuth 目标地址的信任边界（2026-11-05 复审的安全加固项）。
 *
 * ## 威胁模型（先说清楚它值多少）
 *
 * `authBase` 决定 **refresh token 被发到哪个端点**，来源有两个：
 *
 * 1. `deps.authBase`（装配层注入）—— 生产路径上**从不设置**（`git grep authBase
 *    src/vendors/opencode/index.ts` 为空），所以这条目前不可达；
 * 2. **凭据 blob 里的 `authBase` 字段** —— 要利用得先能写本机凭据库。
 *
 * 所以这是**纵深防御**，不是当前可利用的漏洞。上一轮复审我曾据此把它判为
 * paper finding；这次仍然做了，因为它便宜，而漏掉的后果（token 外泄）不可逆。
 *
 * 同样的道理适用于 `verification_uri`：服务端可以在 `device/code` 里返回
 * `https://opencode.ai.evil.test/...`，用户看到前半段以为是真的。
 */
import { describe, expect, it } from "vitest";

import { beginDeviceFlow, fetchOAuthOrg, pollDeviceToken, refreshOAuthCredential } from "../../src/vendors/opencode/oauth";

/** 一个 200 JSON 响应。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 设备码响应的最小负载。 */
function devicePayload(verification = "/console/device"): unknown {
  return {
    device_code: "d",
    user_code: "U",
    verification_uri: verification,
    expires_in: 600,
    interval: 5,
  };
}

const DEVICE = { deviceCode: "d", userCode: "U", verificationUri: "x", intervalMs: 5_000, expiresAt: 0 };
const CREDENTIAL = { v: 1 as const, access: "a", refresh: "r", expiresAt: 0, orgId: "o" };

describe("authBase 信任边界", () => {
  it("默认只放行 opencode.ai 与其子域", async () => {
    await expect(beginDeviceFlow({ fetchImpl: (async () => json(devicePayload())) as typeof fetch })).resolves.toBeDefined();

    for (const host of ["https://api.opencode.ai", "https://opencode.ai"]) {
      await expect(
        beginDeviceFlow({ fetchImpl: (async () => json(devicePayload())) as typeof fetch, authBase: host }),
      ).resolves.toBeDefined();
    }
  });

  it("**不可信主机被拒绝**，且请求根本没发出去", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json(devicePayload());
    }) as unknown as typeof fetch;

    await expect(beginDeviceFlow({ fetchImpl, authBase: "https://evil.test" })).rejects.toThrow(/not allowed/);
    expect(calls, "**校验在发请求之前** —— 不能让 token 先出门再报错").toBe(0);
  });

  it("**四个网络路径都过同一道校验**（漏一处就前功尽弃）", async () => {
    const fetchImpl = (async () => json({})) as unknown as typeof fetch;
    const bad = { fetchImpl, authBase: "https://evil.test" };

    await expect(beginDeviceFlow(bad)).rejects.toThrow(/not allowed/);
    await expect(pollDeviceToken(bad, DEVICE)).rejects.toThrow(/not allowed/);
    await expect(refreshOAuthCredential(bad, CREDENTIAL)).rejects.toThrow(/not allowed/);
    await expect(fetchOAuthOrg(bad, "acc")).rejects.toThrow(/not allowed/);
  });

  it("**凭据 blob 里的 authBase 也要过校验**（第二来源不可信）", async () => {
    const fetchImpl = (async () => json({})) as unknown as typeof fetch;
    // 没有 deps.authBase，只有 blob 里的 —— 这条路径同样必须被挡住。
    const poisoned = { ...CREDENTIAL, authBase: "https://evil.test" };
    await expect(refreshOAuthCredential({ fetchImpl }, poisoned)).rejects.toThrow(/not allowed/);
  });

  it("http:// 被拒绝（不静默升级、不静默回落）", async () => {
    await expect(
      beginDeviceFlow({ fetchImpl: (async () => json(devicePayload())) as typeof fetch, authBase: "http://opencode.ai" }),
    ).rejects.toThrow(/https/);
  });

  it("无法解析的 authBase 被拒绝", async () => {
    await expect(
      beginDeviceFlow({ fetchImpl: (async () => json(devicePayload())) as typeof fetch, authBase: "not a url" }),
    ).rejects.toThrow(/not a valid URL/);
  });

  it("显式 allowAuthHosts 可以放宽（自建/预发）", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: (async () => json(devicePayload())) as typeof fetch,
      authBase: "https://staging.internal.test",
      allowAuthHosts: ["internal.test"],
    });
    expect(device.verificationUri).toBe("https://staging.internal.test/console/device");
  });
});

describe("verification_uri 信任边界", () => {
  it("相对路径拼到已校验的 authBase 上（正常路径不受影响）", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: (async () => json(devicePayload("/console/device?user_code=X"))) as typeof fetch,
    });
    expect(device.verificationUri).toBe("https://opencode.ai/console/device?user_code=X");
  });

  it("**指向不可信主机的绝对地址被拒绝**（不返回看起来能点的链接）", async () => {
    await expect(
      beginDeviceFlow({
        fetchImpl: (async () => json(devicePayload("https://opencode.ai.evil.test/steal"))) as typeof fetch,
      }),
    ).rejects.toThrow(/untrusted host/);
  });

  it("`https://evil.test` 同样被拒绝", async () => {
    await expect(
      beginDeviceFlow({ fetchImpl: (async () => json(devicePayload("https://evil.test/x"))) as typeof fetch }),
    ).rejects.toThrow(/untrusted host/);
  });

  it("**http:// 的绝对地址被拒绝**（登录页不该明文）", async () => {
    await expect(
      beginDeviceFlow({ fetchImpl: (async () => json(devicePayload("http://opencode.ai/x"))) as typeof fetch }),
    ).rejects.toThrow(/untrusted host/);
  });

  it("放行主机上的绝对地址照常可用（服务端将来给全绝对地址也不会坏）", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: (async () => json(devicePayload("https://opencode.ai/console/device?user_code=Y"))) as typeof fetch,
    });
    expect(device.verificationUri).toBe("https://opencode.ai/console/device?user_code=Y");
  });
});
