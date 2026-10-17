/**
 * OpenCode 登录状态机：设备码 → 轮询 → 工作区 → 凭据落库。
 * 传输与等待都注入，测试不碰真网、不依赖真实定时器。
 */
import { expect, it, vi } from "vitest";

import { accountRef } from "../../src/core/accounts";
import { createOpencodeLogin } from "../../src/vendors/opencode/login";
import { OAUTH_PREFIX, parseOAuthCredential } from "../../src/vendors/opencode/oauth";

/** 一个 200 JSON 响应。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 按顺序回放响应。 */
function fakeFetch(responses: (() => Response)[]): typeof fetch {
  return (async (): Promise<Response> => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch;
}

/** 等到登录进入终态（轮询是后台启动的，begin() 只返回 waiting）。 */
async function settle(login: ReturnType<typeof createOpencodeLogin>): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const status = await login.status();
    if (status.state !== "waiting") return status.state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return (await login.status()).state;
}

it("设备码登录成功：状态先 waiting（带 user_code），成功后存 ocoauth1 blob", async () => {
  const storeKey = vi.fn(async () => undefined);
  const login = createOpencodeLogin({
    fetchImpl: fakeFetch([
      () => json({ device_code: "dev-1", user_code: "ABCD-EFGH", verification_uri: "https://opencode.ai/device", expires_in: 600, interval: 1 }),
      () => json({ error: "authorization_pending" }, 400),
      () => json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }),
      () => json([{ id: "org-1", name: "Default" }]),
    ]),
    sleep: async () => undefined,
    now: () => 1_000,
    storeKey,
  });

  const waiting = await login.begin();
  expect(waiting).toMatchObject({ state: "waiting", authUrl: "https://opencode.ai/device", userCode: "ABCD-EFGH" });
  expect(await settle(login)).toBe("success");
  expect(storeKey).toHaveBeenCalledTimes(1);
  const [ref, raw, name] = storeKey.mock.calls[0] as unknown as [string, string, string];
  expect(ref).toBe(accountRef("dsh-opencode-go", "Default"));
  expect(name).toBe("Default");
  expect(raw.startsWith(OAUTH_PREFIX)).toBe(true);
  expect(parseOAuthCredential(raw)).toMatchObject({ access: "access-1", refresh: "refresh-1", orgId: "org-1", orgName: "Default" });
});

it("用户取消：进入 failed/cancelled，且不会再写凭据", async () => {
  const storeKey = vi.fn(async () => undefined);
  const login = createOpencodeLogin({
    fetchImpl: fakeFetch([
      () => json({ device_code: "dev-2", user_code: "CODE", verification_uri: "https://opencode.ai/device" }),
      () => json({ error: "authorization_pending" }, 400),
      () => json({ error: "authorization_pending" }, 400),
    ]),
    // 阻塞在轮询等待上，直到 cancel() 中止。
    sleep: (() => new Promise<void>(() => undefined)) as never,
    storeKey,
  });

  await login.begin();
  await login.cancel();
  expect((await login.status()).state).toBe("failed");
  expect((await login.status()).reason).toBe("cancelled");
  expect(storeKey).not.toHaveBeenCalled();
});

it("轮询被拒绝 / 工作区读不到：失败并给出稳定原因", async () => {
  const denied = createOpencodeLogin({
    fetchImpl: fakeFetch([
      () => json({ device_code: "dev-3", user_code: "CODE", verification_uri: "https://opencode.ai/device" }),
      () => json({ error: "access_denied" }, 400),
    ]),
    sleep: async () => undefined,
    storeKey: vi.fn(async () => undefined),
  });
  await denied.begin();
  expect(await settle(denied)).toBe("failed");
  expect((await denied.status()).reason).toBe("denied");

  const noOrg = createOpencodeLogin({
    fetchImpl: fakeFetch([
      () => json({ device_code: "dev-4", user_code: "CODE", verification_uri: "https://opencode.ai/device" }),
      () => json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }),
      () => json({ orgs: [] }),
    ]),
    sleep: async () => undefined,
    storeKey: vi.fn(async () => undefined),
  });
  await noOrg.begin();
  expect(await settle(noOrg)).toBe("failed");
  expect((await noOrg.status()).reason).toBe("unavailable");
});
