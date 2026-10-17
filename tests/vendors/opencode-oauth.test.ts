/**
 * OpenCode 实验性网页登录：设备码、token 刷新、凭据 blob。
 *
 * 全部走假 `fetch`，不碰真网；登录流程用注入的 `sleep` 跳过等待，因此测试是确定性的。
 */
import { expect, it } from "vitest";

import {
  OAUTH_PREFIX,
  beginDeviceFlow,
  fetchOAuthOrg,
  needsRefresh,
  parseOAuthCredential,
  pollDeviceToken,
  refreshOAuthCredential,
  resolveOAuthCredential,
  serializeOAuthCredential,
} from "../../src/vendors/opencode/oauth";

/** 一个 200 JSON 响应。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 记录请求并按顺序回放响应。 */
function fakeFetch(responses: (() => Response)[]): { fetchImpl: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const CREDENTIAL = {
  v: 1 as const,
  access: "access-1",
  refresh: "refresh-1",
  expiresAt: 100_000,
  orgId: "org-1",
  orgName: "Default",
  userName: "fsk",
};

it("凭据 blob：带前缀、可往返解析；普通 API key 不会被误认", () => {
  const raw = serializeOAuthCredential(CREDENTIAL);
  expect(raw.startsWith(OAUTH_PREFIX)).toBe(true);
  expect(parseOAuthCredential(raw)).toEqual(CREDENTIAL);
  expect(parseOAuthCredential("sk-plain")).toBeUndefined();
  expect(parseOAuthCredential(`${OAUTH_PREFIX}{bad json`)).toBeUndefined();
  expect(parseOAuthCredential(`${OAUTH_PREFIX}{"v":2}`)).toBeUndefined();
});

it("needsRefresh：过期前 60 秒开始刷新", () => {
  expect(needsRefresh(CREDENTIAL, 39_000)).toBe(false);
  expect(needsRefresh(CREDENTIAL, 40_000)).toBe(true);
  expect(needsRefresh(CREDENTIAL, 100_001)).toBe(true);
});

it("beginDeviceFlow：请求设备码并归一化字段", async () => {
  const { fetchImpl, calls } = fakeFetch([
    () => json({ device_code: "dev-1", user_code: "ABCD-EFGH", verification_uri: "https://opencode.ai/device", expires_in: 600, interval: 5 }),
  ]);
  const device = await beginDeviceFlow({ fetchImpl, now: () => 1_000 });

  expect(device).toEqual({
    deviceCode: "dev-1",
    userCode: "ABCD-EFGH",
    verificationUri: "https://opencode.ai/device",
    intervalMs: 5_000,
    expiresAt: 601_000,
  });
  expect(calls[0]?.url).toBe("https://opencode.ai/console/auth/device/code");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ client_id: "opencode-cli" });
});

it("pollDeviceToken：pending → slow_down → success，字段归一化", async () => {
  const pending = fakeFetch([() => json({ error: "authorization_pending" }, 400)]);
  await expect(pollDeviceToken({ fetchImpl: pending.fetchImpl, now: () => 0 }, { deviceCode: "d", userCode: "u", verificationUri: "v", intervalMs: 1, expiresAt: 1 })).resolves.toEqual({ status: "pending" });

  const slow = fakeFetch([() => json({ error: "slow_down" }, 400)]);
  await expect(pollDeviceToken({ fetchImpl: slow.fetchImpl, now: () => 0 }, { deviceCode: "d", userCode: "u", verificationUri: "v", intervalMs: 1, expiresAt: 1 })).resolves.toEqual({ status: "slow_down" });

  const ok = fakeFetch([() => json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 })]);
  await expect(pollDeviceToken({ fetchImpl: ok.fetchImpl, now: () => 5_000 }, { deviceCode: "d", userCode: "u", verificationUri: "v", intervalMs: 1, expiresAt: 1 })).resolves.toEqual({
    status: "success",
    access: "access-2",
    refresh: "refresh-2",
    expiresAt: 3_605_000,
  });
});

it("pollDeviceToken：拒绝与过期是终态，不抛", async () => {
  const denied = fakeFetch([() => json({ error: "access_denied" }, 400)]);
  await expect(pollDeviceToken({ fetchImpl: denied.fetchImpl, now: () => 0 }, { deviceCode: "d", userCode: "u", verificationUri: "v", intervalMs: 1, expiresAt: 1 })).resolves.toEqual({ status: "denied" });
  const expired = fakeFetch([() => json({ error: "expired_token" }, 400)]);
  await expect(pollDeviceToken({ fetchImpl: expired.fetchImpl, now: () => 0 }, { deviceCode: "d", userCode: "u", verificationUri: "v", intervalMs: 1, expiresAt: 1 })).resolves.toEqual({ status: "expired" });
});

it("refreshOAuthCredential：刷新后保留 org 与用户名，更新 access/refresh/expiry", async () => {
  const { fetchImpl, calls } = fakeFetch([() => json({ access_token: "access-3", refresh_token: "refresh-3", expires_in: 3600 })]);
  const refreshed = await refreshOAuthCredential({ fetchImpl, now: () => 0 }, CREDENTIAL);

  expect(refreshed).toEqual({ ...CREDENTIAL, access: "access-3", refresh: "refresh-3", expiresAt: 3_600_000 });
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "opencode-cli" });
  expect(calls[0]?.url).toBe("https://opencode.ai/console/auth/device/token");
});

it("fetchOAuthOrg：兼容数组与 { data } / { orgs } 形状，取第一个", async () => {
  const array = fakeFetch([() => json([{ id: "org-a", name: "A" }])]);
  await expect(fetchOAuthOrg({ fetchImpl: array.fetchImpl }, "access")).resolves.toEqual({ id: "org-a", name: "A" });
  const data = fakeFetch([() => json({ data: [{ id: "org-b", name: "B" }] })]);
  await expect(fetchOAuthOrg({ fetchImpl: data.fetchImpl }, "access")).resolves.toEqual({ id: "org-b", name: "B" });
  const orgs = fakeFetch([() => json({ orgs: [{ id: "org-c", name: "C" }] })]);
  await expect(fetchOAuthOrg({ fetchImpl: orgs.fetchImpl }, "access")).resolves.toEqual({ id: "org-c", name: "C" });
});

it("resolveOAuthCredential：未过期直接用；过期刷新并给出更新后的 blob", async () => {
  const fresh = await resolveOAuthCredential(serializeOAuthCredential(CREDENTIAL), { fetchImpl: fakeFetch([]).fetchImpl, now: () => 0 });
  expect(fresh).toEqual({ key: "access-1", headers: { "x-opencode-org-id": "org-1" } });

  const { fetchImpl } = fakeFetch([() => json({ access_token: "access-4", refresh_token: "refresh-4", expires_in: 3600 })]);
  const refreshed = await resolveOAuthCredential(serializeOAuthCredential(CREDENTIAL), { fetchImpl, now: () => 100_000 });
  expect(refreshed?.key).toBe("access-4");
  expect(refreshed?.headers).toEqual({ "x-opencode-org-id": "org-1" });
  expect(parseOAuthCredential(refreshed?.updated)?.refresh).toBe("refresh-4");
});

it("resolveOAuthCredential：刷新失败返回 undefined，不把旧 token 当可用", async () => {
  const { fetchImpl } = fakeFetch([() => json({ error: "invalid_grant" }, 400)]);
  await expect(resolveOAuthCredential(serializeOAuthCredential(CREDENTIAL), { fetchImpl, now: () => 100_000 })).resolves.toBeUndefined();
});
