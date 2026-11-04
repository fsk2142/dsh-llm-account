import { expect, it, vi } from "vitest";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { createOpencodeQuota } from "../../src/vendors/opencode/quota";
import { createOpencodeLogin } from "../../src/vendors/opencode/login";
import { serializeOAuthCredential, parseOAuthCredential } from "../../src/vendors/opencode/oauth";
import { RotationEngine } from "../../src/core/switching/rotation";
import { createCredentialGuard } from "../../src/core/credential-guard";

const expired = () => serializeOAuthCredential({ v: 1, access: "old-access", refresh: "old-refresh", expiresAt: 1, orgId: "org" });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(fetchImpl: typeof fetch, timeout = 1000) {
  let stored = expired();
  const guard = createCredentialGuard();
  const adapter = createOpencodeAdapter({
    config: () => ({ requestTimeoutMs: timeout }),
    rotation: new RotationEngine({ order: ["ACCOUNT_A"], pinned: "ACCOUNT_A", rules: [] }),
    accounts: { list: async () => [] } as never,
    quota: { snapshot: async () => ({ windows: [], failures: [] }) },
    resolveStored: async () => stored,
    persistStored: async (_ref, value) => { stored = value; },
    credentialGuard: guard,
    fetchImpl,
  });
  return { adapter, stored: () => stored, setStored: (value: string) => guard.runUserWrite("ACCOUNT_A", async () => { stored = value; }) };
}

it("quota and chat share refresh, persist rotated tokens, and reuse the new access token", async () => {
  let finish!: (response: Response) => void;
  const refresh = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const headers: string[] = [];
  const f = fixture((async (url, init) => {
    if (String(url).endsWith("/token")) return refresh();
    headers.push(new Headers(init?.headers).get("authorization")!);
    return json({ usage: {} });
  }) as typeof fetch);
  const quota = createOpencodeQuota({ ref: () => "ACCOUNT_A", resolveKey: async () => f.stored(), resolveAuth: (ref, signal) => f.adapter.resolveAccountAuth(ref, signal), fetchImpl: (async (_url, init) => { headers.push(new Headers(init?.headers).get("authorization")!); return json({ usage: {} }); }) as typeof fetch });
  const reading = quota.snapshot();
  const chat = f.adapter.resolveAccountAuth("ACCOUNT_A");
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  finish(json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
  await Promise.all([reading, chat]);
  expect(parseOAuthCredential(f.stored())?.refresh).toBe("new-refresh");
  await quota.snapshot();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(headers).toEqual(["Bearer new-access", "Bearer new-access"]);
});

it("a user key replacement wins over an in-flight quota refresh", async () => {
  let finish!: (response: Response) => void;
  const f = fixture((async () => await new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch);
  const pending = f.adapter.resolveAccountAuth("ACCOUNT_A");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await f.setStored("user-new-key");
  finish(json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
  await pending;
  expect(f.stored()).toBe("user-new-key");
});

it("a refresh without caller signal obeys request timeout", async () => {
  const f = fixture((async () => await new Promise<Response>(() => {})) as typeof fetch, 5);
  await expect(f.adapter.resolveAccountAuth("ACCOUNT_A")).rejects.toMatchObject({ code: "LLM_REQUEST_TIMEOUT" });
});

it("a transient refresh HTTP failure remains retryable", async () => {
  const f = fixture((async () => json({}, 500)) as typeof fetch);
  await expect(f.adapter.resolveAccountAuth("ACCOUNT_A")).rejects.toMatchObject({ code: "SERVER" });
});

it("canceling one refresh waiter does not cancel another or discard the rotated credential", async () => {
  let finish!: (response: Response) => void;
  const f = fixture((async () => await new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch);
  const abort = new AbortController();
  const cancelled = f.adapter.resolveAccountAuth("ACCOUNT_A", abort.signal);
  const active = f.adapter.resolveAccountAuth("ACCOUNT_A");
  const rejected = expect(cancelled).rejects.toMatchObject({ code: "ABORTED" });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  abort.abort(); await rejected;
  finish(json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
  expect((await active)?.key).toBe("new-access");
  expect(parseOAuthCredential(f.stored())?.refresh).toBe("new-refresh");
});

it("cancel works during a retry starting from a failed login", async () => {
  let calls = 0, finish!: (response: Response) => void;
  const storeKey = vi.fn();
  const login = createOpencodeLogin({ fetchImpl: (async () => { if (++calls === 1) throw Error("network"); return await new Promise<Response>(resolve => { finish = resolve; }); }) as typeof fetch, storeKey, sleep: async () => new Promise(() => {}) });
  expect((await login.begin()).state).toBe("failed");
  const retry = login.begin(); await login.cancel();
  finish(json({ device_code: "device", user_code: "ABCD", verification_uri: "https://example.test/activate" }));
  expect(await retry).toMatchObject({ state: "failed", reason: "cancelled" });
  expect(storeKey).not.toHaveBeenCalled();
});
