/**
 * Task 11 测试：Command Code 网页登录（回环回调服务器）。
 *
 * 全部走真实 `127.0.0.1` 套接字：起监听 → 连上去投递回调 → 断言状态与落库。不联网、
 * 不启浏览器、不读写设置文档；`fetch` 与 `storeKey` 都是本文件注入的假实现。
 *
 * **确定性做法**（任务报告里复述）：
 * 1. 端口不猜 —— 一律从 `begin()` 返回的授权 URL 的 `callback` 参数里读回来；
 * 2. 需要「迟到结果」的用例用本文件自己的 deferred `fetch`，先断言前置条件
 *    （whoami 请求已经发出）再放行，不靠时间碰运气；
 * 3. 每个用例都经 {@link createLogin} 注册 `onTestFinished` 兜底 `cancel()`，而 `cancel()`
 *    会等服务器**真正关闭**，所以断言失败也不会留下监听或定时器；
 * 4. 断言「端口释放」时立刻在同一个端口上重新绑定，或向它发起一次必然被拒的连接。
 *
 * 测试进程能正常退出本身就是句柄卫生的验尸报告。
 */
import { createServer, request as httpRequest, type Server } from "node:http";
import { expect, it, onTestFinished } from "vitest";

import type { LoginStatus } from "../../src/core/adapter";
import { accountRef } from "../../src/core/accounts";
import {
  LOGIN_ALLOWED_ORIGINS,
  LOGIN_BODY_LIMIT_BYTES,
  LOGIN_PORT_ATTEMPTS,
  LOGIN_START_PORT,
  LOGIN_TIMEOUT_MS,
  buildCommandCodeAuthUrl,
  createCommandCodeLogin,
  studioBaseForApiBase,
  type CommandCodeLogin,
  type CommandCodeLoginDeps,
} from "../../src/vendors/commandcode/login";

/** 假 whoami：总是 200。 */
const okFetch = (async (): Promise<Response> => new Response("{}", { status: 200 })) as typeof fetch;

/** 假 whoami：固定状态码。 */
function statusFetch(status: number): typeof fetch {
  return (async (): Promise<Response> => new Response("{}", { status })) as typeof fetch;
}

/** 假 whoami：传输层直接失败。 */
const throwingFetch = (async (): Promise<Response> => {
  throw new Error("network down");
}) as typeof fetch;

/** 造一个登录端口，并登记兜底取消（断言失败也不会留下监听或定时器）。 */
function createLogin(deps: CommandCodeLoginDeps): CommandCodeLogin {
  const login = createCommandCodeLogin(deps);
  onTestFinished(async () => {
    await login.cancel();
  });
  return login;
}

/** 从授权 URL 里读出回调端口与本次 `state`（浏览器能看到的就这两个）。 */
function authParts(authUrl: string): { port: number; state: string } {
  const url = new URL(authUrl);
  const callback = url.searchParams.get("callback");
  const state = url.searchParams.get("state");
  if (callback === null || state === null) throw new Error(`授权 URL 缺少 callback/state：${authUrl}`);
  return { port: Number(new URL(callback).port), state };
}

/** `begin()` 进入等待并返回端口与 state。 */
async function beginWaiting(login: CommandCodeLogin): Promise<{ port: number; state: string }> {
  const status = await login.begin();
  if (status.state !== "waiting" || status.authUrl === undefined) {
    throw new Error(`begin() 没有进入 waiting：${JSON.stringify(status)}`);
  }
  return authParts(status.authUrl);
}

/** 回环回调地址。 */
function callbackUrl(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

/** 一份合法的回调负载。 */
function credentials(state: string, apiKey: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { apiKey, state, userId: "u-1", userName: "n-1", keyName: "k-1", ...extra };
}

/** 投递一次回调，返回状态码与已解析正文。 */
async function post(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = text;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      // 非 JSON 正文就保留原文：断言会把它与预期形状的差异报出来。
    }
  }
  return { status: response.status, body };
}

/** 投递一次回调，容忍服务器主动断连（体积超限路径不会给出响应）。 */
async function postTolerant(url: string, payload: unknown): Promise<number | undefined> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    await response.arrayBuffer();
    return response.status;
  } catch {
    return undefined;
  }
}

/** 等一小段时间（只用于「前置条件已成立」之后的有限让步，不做时间竞猜）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 在一个回环端口上开一条「请求头 + 半个请求体」的回调投递。
 *
 * 用来构造「旧服务器上**已经被接受**、但请求体在被替换之后才送完」的投递：`write()` 出去
 * 的头 + 半个体足以让服务器解析出请求并挂上 `data`/`end` 监听，而 `end` 只会在调用方主动
 * `finish()` 之后才到 —— 所以结算时机完全由测试决定，不靠睡眠对齐。
 *
 * 按字节切分（而不是按字符串下标），多字节字符也不会切坏 `Content-Length`。
 * @param port - 目标回环端口。
 * @param payload - 完整请求体（JSON 文本）。
 * @returns `finish()` 补完剩下半个体并读出响应；`destroy()` 供兜底清理。
 */
function openSplitCallback(
  port: number,
  payload: string,
): { finish: () => Promise<{ status: number; body: unknown }>; destroy: () => void } {
  const bytes = Buffer.from(payload, "utf8");
  const half = Math.floor(bytes.length / 2);
  const request = httpRequest({
    host: "127.0.0.1",
    port,
    path: "/callback",
    method: "POST",
    headers: { "content-type": "application/json", "content-length": bytes.length },
  });
  const response = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    request.on("response", (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      incoming.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // 非 JSON 正文就保留原文：断言会把它与预期形状的差异报出来。
        }
        resolve({ status: incoming.statusCode ?? 0, body });
      });
    });
    request.on("error", reject);
  });
  request.write(bytes.subarray(0, half));
  return {
    finish: async () => {
      request.end(bytes.subarray(half));
      return response;
    },
    destroy: () => {
      request.destroy();
    },
  };
}

/** 有界轮询：等一个前置条件成立，失败时报出等的是什么。 */
async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) return;
    await sleep(2);
  }
  throw new Error(`等待超时：${label}`);
}

/** 等到尝试落到终态（`success` / `failed`）。 */
async function untilSettled(login: CommandCodeLogin): Promise<LoginStatus> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const status = await login.status();
    if (status.state === "success" || status.state === "failed") return status;
    await sleep(2);
  }
  throw new Error("登录尝试没有落到终态");
}

/** 绑一个回环监听器（失败即 reject）；`port` 传 0 表示问内核要一个空闲端口。 */
function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** 关掉一个回环监听器，并等它真的关闭（连带的连接一起断掉，避免句柄残留）。 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** 问内核要一个当前空闲的端口（绑上再放开）。 */
async function freePort(): Promise<number> {
  const server = await listenOn(0);
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  await closeServer(server);
  return port;
}

/** 占住一段连续端口，用来验证「10 个候选端口全被占」的可读错误。 */
async function occupyRange(count: number): Promise<{ start: number; release: () => Promise<void> }> {
  for (let start = 34_000; start < 45_000; start += count) {
    const servers: Server[] = [];
    for (let index = 0; index < count; index += 1) {
      try {
        servers.push(await listenOn(start + index));
      } catch {
        break;
      }
    }
    if (servers.length === count) {
      return {
        start,
        release: async () => {
          for (const server of servers) await closeServer(server);
        },
      };
    }
    for (const server of servers) await closeServer(server);
  }
  throw new Error("找不到一段连续空闲端口来做端口耗尽用例");
}

it("state 不匹配的回调被拒绝，且不写入凭据", async () => {
  const stored: string[] = [];
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port } = await beginWaiting(login);
  const delivery = await post(callbackUrl(port), {
    apiKey: "k",
    state: "wrong",
    userId: "u",
    userName: "n",
    keyName: "x",
  });
  expect(delivery.status).toBe(403);
  expect(delivery.body).toEqual({ success: false, error: "Invalid state token" });
  expect(stored).toEqual([]);
  // 一次伪造投递不作废本次登录：用户还可以继续在浏览器里完成授权。
  expect((await login.status()).state).toBe("waiting");
});

it("取消后到达的回调不再写入凭据（服务器已关闭、端口已释放）", async () => {
  const stored: string[] = [];
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port, state } = await beginWaiting(login);
  await login.cancel();
  await expect(post(callbackUrl(port), credentials(state, "k-late"))).rejects.toThrow();
  expect(stored).toEqual([]);
  expect(await login.status()).toEqual({ state: "failed", reason: "cancelled" });
  const rebind = await listenOn(port); // 端口确实释放了
  await closeServer(rebind);
});

it("默认起始端口 5959，最多尝试 10 个端口", () => {
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async () => {},
  });
  expect(login.startPortDefault).toBe(5959);
  expect(login.portAttemptsDefault).toBe(10);
  expect(LOGIN_START_PORT).toBe(5959);
  expect(LOGIN_PORT_ATTEMPTS).toBe(10);
  expect(LOGIN_TIMEOUT_MS).toBe(120_000);
  expect(LOGIN_BODY_LIMIT_BYTES).toBe(10_000);
  expect([...LOGIN_ALLOWED_ORIGINS]).toEqual([
    "http://localhost:3000",
    "https://staging.commandcode.ai",
    "https://commandcode.ai",
  ]);
  expect(login.authUrl).toBeUndefined();
});

it("超时后状态为 failed 且原因为 timeout", async () => {
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    timeoutMs: 20,
    storeKey: async () => {},
  });
  await login.begin();
  await sleep(50);
  expect((await login.status()).state).toBe("failed");
  expect((await login.status()).reason).toBe("timeout");
});

it("HTTP 契约：OPTIONS 204、非 POST 405、未知路径 404、非法 JSON 400、跨源只回显白名单", async () => {
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async () => {},
  });
  const { port } = await beginWaiting(login);
  const base = `http://127.0.0.1:${port}`;

  const options = await fetch(`${base}/callback`, {
    method: "OPTIONS",
    headers: { origin: "https://commandcode.ai" },
  });
  expect(options.status).toBe(204);
  expect(options.headers.get("access-control-allow-origin")).toBe("https://commandcode.ai");
  expect(options.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  expect(options.headers.get("access-control-allow-headers")).toBe("Content-Type");

  const get = await fetch(`${base}/callback`, { headers: { origin: "https://evil.example" } });
  expect(get.status).toBe(405);
  // `Response.json()` 的静态类型是 `unknown`（@types/node 的 undici 形状），所以整身体比较，
  // 顺带和同一用例里其它几条断言一样钉住完整响应。
  expect(await get.json()).toEqual({ success: false, error: "Method not allowed. Use POST." });
  expect(get.headers.get("access-control-allow-origin") ?? "").toBe(""); // 非白名单来源不回显

  const missing = await post(`${base}/nope`, {});
  expect(missing).toEqual({ status: 404, body: { success: false, error: "Not found" } });

  const broken = await fetch(`${base}/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(broken.status).toBe(400);
  expect(await broken.json()).toEqual({ success: false, error: "Invalid JSON" });

  const incomplete = await post(`${base}/callback`, { state: "wrong" });
  expect(incomplete).toEqual({ status: 400, body: { success: false, error: "Missing required fields" } });
});

it("请求体超过 10 000 字节被拒绝，且不写凭据、不作废本次登录", async () => {
  const stored: string[] = [];
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port, state } = await beginWaiting(login);
  const oversized = JSON.stringify(credentials(state, "k", { pad: "x".repeat(12_000) }));
  expect(oversized.length).toBeGreaterThan(LOGIN_BODY_LIMIT_BYTES);
  const status = await postTolerant(callbackUrl(port), oversized);
  expect(status).not.toBe(200);
  expect(stored).toEqual([]);
  expect((await login.status()).state).toBe("waiting");
});

it("成功路径：whoami 通过之后才 storeKey，状态推到 success 且服务器关闭", async () => {
  const stored: { ref: string; key: string }[] = [];
  const order: string[] = [];
  let whoamiInit: RequestInit | undefined;
  let releaseWhoami: (() => void) | undefined;
  let whoamiSettled = false;
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    order.push(String(input));
    whoamiInit = init;
    await new Promise<void>((resolve) => {
      releaseWhoami = resolve;
    });
    whoamiSettled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const login = createLogin({
    fetchImpl,
    apiBase: "https://api.example",
    storeKey: async (ref, key) => {
      order.push("store");
      stored.push({ ref, key });
    },
  });
  expect(await login.status()).toEqual({ state: "idle" });

  const { port, state } = await beginWaiting(login);
  expect(await post(callbackUrl(port), credentials(state, "k-1"))).toEqual({
    status: 200,
    body: { success: true },
  });

  await waitFor(() => releaseWhoami !== undefined, "whoami 请求发出");
  expect(whoamiInit?.method).toBe("GET");
  expect(new Headers(whoamiInit?.headers).get("authorization")).toBe("Bearer k-1");
  expect(new Headers(whoamiInit?.headers).get("accept-encoding")).toBe("identity");
  expect(order).toEqual(["https://api.example/alpha/whoami"]);
  expect(stored).toEqual([]); // 验证还没回来：一个字节都没落库

  releaseWhoami?.();
  await waitFor(() => whoamiSettled, "whoami 完成");
  await waitFor(() => stored.length === 1, "凭据落库");
  expect(order).toEqual(["https://api.example/alpha/whoami", "store"]);
  expect(stored[0]).toEqual({ ref: accountRef("commandcode", "n-1"), key: "k-1" });
  expect(await login.status()).toEqual({ state: "success" });

  await login.cancel(); // 终态不受取消影响
  expect(await login.status()).toEqual({ state: "success" });
  const rebind = await listenOn(port);
  await closeServer(rebind);
});

it("whoami 401 → failed / invalid-key，且不写凭据", async () => {
  const stored: string[] = [];
  const login = createLogin({
    fetchImpl: statusFetch(401),
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port, state } = await beginWaiting(login);
  expect(await post(callbackUrl(port), credentials(state, "k"))).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await untilSettled(login)).toEqual({ state: "failed", reason: "invalid-key" });
  expect(stored).toEqual([]);
  const rebind = await listenOn(port);
  await closeServer(rebind);
});

it("whoami 非 401 的拒绝映射为 error，传输失败映射为 network", async () => {
  const cases: { fetchImpl: typeof fetch; reason: string }[] = [
    { fetchImpl: statusFetch(500), reason: "error" },
    { fetchImpl: throwingFetch, reason: "network" },
  ];
  for (const item of cases) {
    const stored: string[] = [];
    const login = createLogin({
      fetchImpl: item.fetchImpl,
      apiBase: "https://api.example",
      storeKey: async (_ref, key) => {
        stored.push(key);
      },
    });
    const { port, state } = await beginWaiting(login);
    await post(callbackUrl(port), credentials(state, "k"));
    expect(await untilSettled(login)).toEqual({ state: "failed", reason: item.reason });
    expect(stored).toEqual([]);
  }
});

it("storeKey 抛错 → failed / unavailable，且不残留监听", async () => {
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async () => {
      throw new Error("credentials service down");
    },
  });
  const { port, state } = await beginWaiting(login);
  await post(callbackUrl(port), credentials(state, "k"));
  expect(await untilSettled(login)).toEqual({ state: "failed", reason: "unavailable" });
  const rebind = await listenOn(port);
  await closeServer(rebind);
});

it("取消之后迟到的 whoami 结果不落库（代际守卫）", async () => {
  const stored: string[] = [];
  let releaseWhoami: (() => void) | undefined;
  let whoamiSettled = false;
  const fetchImpl = (async (): Promise<Response> => {
    await new Promise<void>((resolve) => {
      releaseWhoami = resolve;
    });
    whoamiSettled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const login = createLogin({
    fetchImpl,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port, state } = await beginWaiting(login);
  // 回调已被收下、验证在路上 —— 此刻用户取消。
  await post(callbackUrl(port), credentials(state, "k-late"));
  await waitFor(() => releaseWhoami !== undefined, "whoami 请求发出");
  await login.cancel();
  expect(await login.status()).toEqual({ state: "failed", reason: "cancelled" });

  releaseWhoami?.(); // 验证结果「迟到」地成功返回
  await waitFor(() => whoamiSettled, "迟到的 whoami 完成");
  await sleep(5); // 让 #complete 的后续微任务跑完：迟到的成功不得落库
  expect(stored).toEqual([]);
  expect(await login.status()).toEqual({ state: "failed", reason: "cancelled" });
});

it("旧服务器上已被接受的投递在重新 begin 之后到达：不落库、不打断新尝试", async () => {
  const stored: string[] = [];
  const whoamiAuth: string[] = [];
  let releaseFirstWhoami: (() => void) | undefined;
  let firstWhoamiSettled = false;
  const fetchImpl = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
    whoamiAuth.push(new Headers(init?.headers).get("authorization") ?? "");
    if (whoamiAuth.length === 1) {
      // 第一次尝试的验证永远停在这里：它的状态停在 waiting，而监听已经在收下回调时收了，
      // 所以用户可以再 begin 一次 —— 这正是「旧服务器被替换掉」的前提。
      await new Promise<void>((resolve) => {
        releaseFirstWhoami = resolve;
      });
      firstWhoamiSettled = true;
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const login = createLogin({
    fetchImpl,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });

  const firstStatus = await login.begin();
  if (firstStatus.authUrl === undefined) throw new Error("第一次 begin() 没有返回授权 URL");
  const first = authParts(firstStatus.authUrl);

  // ① 在旧服务器上开一条「头 + 半个体」的投递：请求已被接受，`end` 还没到。
  const stale = openSplitCallback(first.port, JSON.stringify(credentials(first.state, "k-stale")));
  onTestFinished(() => {
    stale.destroy(); // 断言失败也不留下剩下半条连接
  });

  // ② 让第一次尝试收下一次决定性投递（监听优雅关闭，但上面那条连接还活着），
  //    它的 whoami 于是停在路上：状态仍是 waiting，而当前监听已经不是它了。
  expect(await post(callbackUrl(first.port), credentials(first.state, "k-first"))).toEqual({
    status: 200,
    body: { success: true },
  });
  await waitFor(() => releaseFirstWhoami !== undefined, "第一次 whoami 请求发出");

  // ③ 重新开始：第二次尝试有自己的 state，它的服务器才是「当前」的那个。
  const secondStatus = await login.begin();
  if (secondStatus.authUrl === undefined) throw new Error("第二次 begin() 没有返回授权 URL");
  const second = authParts(secondStatus.authUrl);
  expect(second.state).not.toBe(first.state);

  // ④ 补完旧连接上的请求体：它以旧服务器的 expectedState 通过了字段与 state 校验，但它既不是
  //    当前服务器接受的那条请求，也不属于当前代际 —— 代际裁决必须拒绝它。
  const staleResponse = await stale.finish();
  expect(staleResponse.status).toBe(403);
  expect(staleResponse.body).toEqual({ success: false, error: "Invalid state token" });
  expect(stored).toEqual([]); // 迟到的凭据一个字节都没落库
  expect(await login.status()).toEqual({ state: "waiting", authUrl: secondStatus.authUrl });

  // ⑤ 新尝试自己的浏览器投递照常成功：监听没被那条迟到请求关掉，也没有挂到总期限。
  expect(await post(callbackUrl(second.port), credentials(second.state, "k-2"))).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await untilSettled(login)).toEqual({ state: "success" });
  expect(stored).toEqual(["k-2"]);
  expect(whoamiAuth).toEqual(["Bearer k-first", "Bearer k-2"]); // k-stale 从未走到验证

  // ⑥ 第一次尝试那条一直停在路上的 whoami 后来成功返回：它早已不是所有者，不许落库。
  releaseFirstWhoami?.();
  await waitFor(() => firstWhoamiSettled, "第一次 whoami 完成");
  await sleep(5);
  expect(stored).toEqual(["k-2"]);
  expect(await login.status()).toEqual({ state: "success" });
});

it("begin 单飞：并发 begin 复用同一次尝试（同一 state 与端口）", async () => {
  const stored: string[] = [];
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const [first, second] = await Promise.all([login.begin(), login.begin()]);
  expect(second.authUrl).toBe(first.authUrl);
  if (first.authUrl === undefined) throw new Error("begin() 没有返回授权 URL");
  const { port, state } = authParts(first.authUrl);
  expect(await post(callbackUrl(port), credentials(state, "k-1"))).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await untilSettled(login)).toEqual({ state: "success" });
  expect(stored).toEqual(["k-1"]);
});

it("绑定期间 cancel：尝试落到 failed / cancelled，之后还能重新开始", async () => {
  const startPort = await freePort();
  const login = createLogin({
    fetchImpl: okFetch,
    apiBase: "https://api.example",
    startPort,
    storeKey: async () => {},
  });
  const starting = login.begin();
  await login.cancel();
  expect(await starting).toEqual({ state: "failed", reason: "cancelled" });
  expect(await login.status()).toEqual({ state: "failed", reason: "cancelled" });

  const { port, state } = await beginWaiting(login);
  // 上一次尝试若泄漏了监听，这里会拿到 startPort + 1。
  expect(port).toBe(startPort);
  expect(await post(callbackUrl(port), credentials(state, "k-2"))).toEqual({
    status: 200,
    body: { success: true },
  });
  expect(await untilSettled(login)).toEqual({ state: "success" });
});

it("验证中再次 begin 后立即 cancel：新启动也必须退场（cancel 不让任何尝试存活）", async () => {
  const stored: string[] = [];
  let releaseWhoami: (() => void) | undefined;
  const fetchImpl = (async (): Promise<Response> => {
    await new Promise<void>((resolve) => {
      releaseWhoami = resolve;
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const login = createLogin({
    fetchImpl,
    apiBase: "https://api.example",
    storeKey: async (_ref, key) => {
      stored.push(key);
    },
  });
  const { port, state } = await beginWaiting(login);
  // 回调已被收下、验证在路上：监听已经收了，但状态还是 waiting。
  await post(callbackUrl(port), credentials(state, "k-first"));
  await waitFor(() => releaseWhoami !== undefined, "whoami 请求发出");

  // 上一次尝试还在验证时再 begin 一次（旧插件的 begin 允许这么做），随后立刻取消：
  // 那次新启动的代际还没落地，cancel 也必须让它退场。
  const starting = login.begin();
  await login.cancel();
  expect(await starting).toEqual({ state: "failed", reason: "cancelled" });
  expect(await login.status()).toEqual({ state: "failed", reason: "cancelled" });

  releaseWhoami?.(); // 迟到的验证成功不得落库
  await sleep(5);
  expect(stored).toEqual([]);
});

it("10 个候选端口全被占用时 begin 抛出可读错误", async () => {
  const range = await occupyRange(LOGIN_PORT_ATTEMPTS);
  try {
    const login = createLogin({
      fetchImpl: okFetch,
      apiBase: "https://api.example",
      startPort: range.start,
      storeKey: async () => {},
    });
    await expect(login.begin()).rejects.toThrow(
      `No available port found after ${LOGIN_PORT_ATTEMPTS} attempts starting from port ${range.start}`,
    );
    expect(await login.status()).toEqual({ state: "idle" });
  } finally {
    await range.release();
  }
});

it("Studio 基地址按网关推导（staging / 本机 / 正式）", () => {
  expect(studioBaseForApiBase("https://staging-api.commandcode.ai")).toBe("https://staging.commandcode.ai");
  expect(studioBaseForApiBase("http://localhost:8787")).toBe("http://localhost:3000");
  expect(studioBaseForApiBase("https://api.commandcode.ai")).toBe("https://commandcode.ai");
});

it("授权 URL 指向 Studio 授权页，回调与 state 都做了编码", () => {
  expect(buildCommandCodeAuthUrl({ studioBase: "https://commandcode.ai", port: 5959, state: "a b&c" })).toBe(
    "https://commandcode.ai/studio/auth/cli?callback=http%3A%2F%2Flocalhost%3A5959%2Fcallback&state=a%20b%26c",
  );
});
