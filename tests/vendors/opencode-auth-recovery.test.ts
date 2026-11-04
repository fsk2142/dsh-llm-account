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
import { LlmError } from "@deepseek-ai/dsh-llm";

it("a new request after replacing a key cannot join the old credential flight", async () => {
  let finish!: (response: Response) => void;
  const f = fixture((async () => await new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch);
  const old = f.adapter.resolveAccountAuth("ACCOUNT_A");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await f.setStored("new-user-key");
  const next = f.adapter.resolveAccountAuth("ACCOUNT_A");
  finish(json({ access_token: "old-account-access", refresh_token: "old-account-refresh", expires_in: 3600 }));
  expect((await next)?.key).toBe("new-user-key");
  await old;
  expect(f.stored()).toBe("new-user-key");
});

it("temporary auth failure tries B and preserves B's context error for the host", async () => {
  const reads: string[] = [];
  const context = new LlmError("B reached", "CONTEXT_WINDOW_EXCEEDED");
  const adapter = createOpencodeAdapter({
    config: () => ({}), rotation: new RotationEngine({ order: ["A", "B"], pinned: "A", rules: [] }),
    accounts: { list: async () => [] } as never, quota: { snapshot: async () => ({ windows: [], failures: [] }) },
    resolveStored: async (ref) => { reads.push(ref); if (ref === "B") throw context; return expired(); },
    fetchImpl: (async () => json({}, 500)) as typeof fetch, maxTried: () => 3,
  });
  await expect(adapter.stream({ provider: "dsh-opencode-go", model: "m", messages: [] })[Symbol.asyncIterator]().next()).rejects.toBe(context);
  expect(reads).toEqual(["A", "B"]);
});

it("concurrent device-code begins share startup instead of canceling the newest attempt", async () => {
  let finish!: (response: Response) => void;
  const fetchImpl = vi.fn(async () => await new Promise<Response>(resolve => { finish = resolve; }));
  const login = createOpencodeLogin({ fetchImpl: fetchImpl as typeof fetch, storeKey: vi.fn(), sleep: async () => new Promise(() => {}) });
  const first = login.begin(), second = login.begin();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  finish(json({ device_code: "device", user_code: "ABCD", verification_uri: "https://example.test/activate" }));
  expect(await first).toEqual(await second);
  expect((await login.status()).state).toBe("waiting");
  await login.cancel();
});

it("a canceled startup cannot overwrite a later attempt when its device response arrives", async () => {
  const pending: ((response: Response) => void)[] = [];
  const login = createOpencodeLogin({ fetchImpl: (async () => await new Promise<Response>(resolve => pending.push(resolve))) as typeof fetch, storeKey: vi.fn(), sleep: async () => new Promise(() => {}) });
  const old = login.begin(); await login.cancel(); const fresh = login.begin();
  pending[1]!(json({ device_code: "new", user_code: "NEW", verification_uri: "https://example.test/new" }));
  expect((await fresh).state).toBe("waiting");
  pending[0]!(json({ device_code: "old", user_code: "OLD", verification_uri: "https://example.test/old" }));
  await old;
  expect(await login.status()).toMatchObject({ state: "waiting", userCode: "NEW" });
  await login.cancel();
});
