import { expect, it, vi } from "vitest";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { createOpencodeLogin } from "../../src/vendors/opencode/login";
import { refreshOAuthCredential, serializeOAuthCredential } from "../../src/vendors/opencode/oauth";
import { createCredentialGuard } from "../../src/core/credential-guard";
import { RotationEngine } from "../../src/core/switching/rotation";
import type { AccountPort } from "../../src/core/adapter";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const listing = (id: string) => json({ data: [{ id }] });
const expired = { v: 1 as const, access: "expired-access", refresh: "fake-refresh", expiresAt: 1, orgId: "fake-org" };
const rotation = () => new RotationEngine({ order: ["A", "B"], pinned: "A", rules: [] });
const quota = { snapshot: async () => ({ windows: [], failures: [] }) };

it("binds the directory request to the account selected for its cache entry", async () => {
  let reads = 0;
  let active = "A";
  const requests: string[] = [];
  const adapter = createOpencodeAdapter({
    config: () => ({}), rotation: rotation(), quota,
    accounts: { list: async () => {
      const ref = active;
      if (++reads === 1) active = "B";
      return [{ ref, configured: true, active: true }];
    } } as AccountPort,
    resolveStored: async (ref) => `key-${ref}`,
    fetchImpl: async (url, init) => {
      if (String(url).includes("models.dev")) return json({});
      const bearer = new Headers(init?.headers).get("authorization") ?? "";
      requests.push(bearer);
      return listing(bearer === "Bearer key-A" ? "A-only" : "B-only");
    },
  });
  expect((await adapter.catalogModels()).map((row) => row.id)).toEqual(["A-only"]);
  expect((await adapter.catalogModels()).map((row) => row.id)).toEqual(["B-only"]);
  active = "A";
  expect((await adapter.catalogModels()).map((row) => row.id)).toEqual(["A-only"]);
  expect(requests).toEqual(["Bearer key-A", "Bearer key-B"]);
});

it("reads the new subscription after a key replacement on the same account", async () => {
  let stored = "old-key";
  const credentialGuard = createCredentialGuard();
  const adapter = createOpencodeAdapter({
    config: () => ({}), rotation: rotation(), quota, credentialGuard,
    accounts: { list: async () => [{ ref: "A", configured: true, active: true }] } as AccountPort,
    resolveStored: async () => stored,
    fetchImpl: async (url, init) => String(url).includes("models.dev") ? json({})
      : listing(new Headers(init?.headers).get("authorization") === "Bearer old-key" ? "old-only" : "new-only"),
  });
  expect((await adapter.catalogModels()).map((row) => row.id)).toEqual(["old-only"]);
  await credentialGuard.runUserWrite("A", async () => { stored = "new-key"; });
  expect((await adapter.catalogModels()).map((row) => row.id)).toEqual(["new-only"]);
});

it("discovers models after cold-start OAuth expiry using the shared refresh and org header", async () => {
  let stored = serializeOAuthCredential(expired);
  const refresh = vi.fn(() => json({ access_token: "fresh-access", refresh_token: "new-refresh", expires_in: 3600 }));
  const adapter = createOpencodeAdapter({
    config: () => ({ visibleModels: ["subscribed"] }), rotation: rotation(), quota,
    accounts: { list: async () => [{ ref: "A", configured: true, active: true }] } as AccountPort,
    resolveStored: async () => stored,
    persistStored: async (_ref, value) => { stored = value; },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/token")) return refresh();
      if (String(url).includes("models.dev")) return json({});
      const headers = new Headers(init?.headers);
      return headers.get("authorization") === "Bearer fresh-access" && headers.get("x-opencode-org-id") === "fake-org"
        ? listing("subscribed") : json({ error: "unauthorized" }, 401);
    },
  });
  expect((await adapter.listModels("dsh-opencode-go")).map((row) => row.id)).toEqual(["subscribed"]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(stored).toContain("new-refresh");
});

it("stops an in-flight poll at device expiry and issues a fresh code on retry", async () => {
  vi.useFakeTimers();
  let codes = 0;
  let signal: AbortSignal | undefined;
  const storeKey = vi.fn(async () => {});
  const login = createOpencodeLogin({
    storeKey, sleep: async () => {},
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/code")) return json({ device_code: `d${++codes}`, user_code: `U${codes}`, verification_uri: "/console/device", expires_in: 1 });
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    },
  });
  try {
    expect((await login.begin()).userCode).toBe("U1");
    const firstSignal = signal;
    expect(firstSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(firstSignal?.aborted).toBe(true);
    expect(await login.status()).toEqual({ state: "failed", reason: "timeout" });
    expect((await login.begin()).userCode).toBe("U2");
    expect(storeKey).not.toHaveBeenCalled();
  } finally {
    await login.cancel();
    vi.useRealTimers();
  }
});

it("releases a stalled device-code request with a timeout", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const login = createOpencodeLogin({ storeKey: async () => {}, fetchImpl: async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  } });
  try {
    const started = vi.fn();
    void login.begin().then(started);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal?.aborted).toBe(true);
    expect(started).toHaveBeenCalledWith({ state: "failed", reason: "timeout" });
  } finally {
    await login.cancel();
    vi.useRealTimers();
  }
});

it("does not forward a refresh token through a cross-origin HTTP 307", async () => {
  const origins: string[] = [];
  const dispatcher = { dispatch(options: { origin: string }, handler: {
    onConnect: (abort: () => void) => void;
    onHeaders: (status: number, headers: Buffer[], resume: () => void, statusText: string) => void;
    onData: (data: Buffer) => void;
    onComplete: (trailers: never[]) => void;
  }) {
    queueMicrotask(() => {
      origins.push(options.origin);
      handler.onConnect(() => {});
      const first = options.origin === "https://opencode.ai";
      const headers = first ? ["location", "https://off-list.invalid/token"] : ["content-type", "application/json"];
      handler.onHeaders(first ? 307 : 200, headers.map((value) => Buffer.from(value)), () => {}, first ? "Temporary Redirect" : "OK");
      if (!first) handler.onData(Buffer.from(JSON.stringify({ access_token: "unexpected", expires_in: 3600 })));
      handler.onComplete([]);
    });
    return true;
  } };
  const fetchImpl: typeof fetch = (input, init) => fetch(input, { ...init, dispatcher } as RequestInit);
  await expect(refreshOAuthCredential({ fetchImpl }, expired)).rejects.toThrow();
  expect(origins).toEqual(["https://opencode.ai"]);
});
