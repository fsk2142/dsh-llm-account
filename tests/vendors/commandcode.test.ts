import { LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, RequestMessage, StreamChunk } from "@deepseek-ai/dsh-llm";
import { expect, it, vi } from "vitest";

import type { AccountPort, QuotaPort } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/rotation";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { parseCatalog } from "../../src/vendors/commandcode/catalog";
import { classifyCommandCodeFailure } from "../../src/vendors/commandcode/failures";

/** 本文件里的假的账号端口：这些用例都不经账号写路径（Task 10 负责）。 */
function stubAccounts(): AccountPort {
  return {
    list: async () => [],
    add: async () => {
      throw new Error("not used in this test");
    },
    rename: async () => {},
    replaceKey: async () => {},
    remove: async () => {},
    select: async () => {},
  };
}

/** 本文件里的假的额度端口：请求路径不读额度。 */
function stubQuota(): QuotaPort {
  return { snapshot: async () => ({ windows: [], failures: [] }) };
}

/** 一条最小用户消息（一次性输入形状，不需要持久身份）。 */
function userMessage(text: string): RequestMessage {
  return { role: "user", content: [{ type: "text", text }] } as unknown as RequestMessage;
}

/** 目标模型与一条用户消息，够 stream() 组出请求。 */
function request(model = "m"): GenerateOptions {
  return { provider: "commandcode", model, messages: [userMessage("hi")] };
}

/** 把流收集成数组；`for await` 在提前退出时关闭流，与宿主的消费方式一致。 */
async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

/** 把若干 SSE 事件拼成一个 200 响应。 */
function sseResponse(events: readonly string[]): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * 按账号返回响应的假 `fetch`：从 `Authorization` 头取出密钥，据此挑选响应，
 * 并记录每个密钥的调用顺序 —— 「换没换账号」就是看这个顺序。
 * @param handlers - 密钥到响应的映射。
 * @returns 假 fetch 与调用记录。
 */
function keyedFetch(handlers: Record<string, () => Response>): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    void input;
    const headers = new Headers(init?.headers);
    const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    calls.push(key);
    const handler = handlers[key];
    if (handler === undefined) throw new Error(`unexpected credential ${JSON.stringify(key)}`);
    return handler();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

it("401 映射为 invalid-credential", () => {
  expect(classifyCommandCodeFailure(401, {})?.kind).toBe("invalid-credential");
});

it("429 带窗口证据时带 resetAt，rate-limit → 冷却", () => {
  const result = classifyCommandCodeFailure(429, { error: { rateLimit: { window: "fiveHour", reset: 1_800_000_000 } } });
  expect(result?.kind).toBe("rate-limit");
  expect(result?.resetAt).toBe(1_800_000_000_000);
});

it("用量耗尽语义（USAGE_EXCEEDED）映射为 unavailable", () => {
  expect(classifyCommandCodeFailure(400, { error: { code: "USAGE_EXCEEDED" } })?.kind).toBe("unavailable");
});

it("目录解析：仅保留有 id 与 name 的行，其余计入 ignored", () => {
  const { entries, ignored } = parseCatalog({ models: [{ id: "m", name: "M" }, { name: "no-id" }] });
  expect(entries.map((entry) => entry.id)).toEqual(["m"]);
  expect(ignored).toBe(1);
});

it("未输出时遇到额度拒绝会切到下一个账号（Review Focus 2 端到端）", async () => {
  const rotation = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
  const markRejected = vi.spyOn(rotation, "markRejected");
  const { fetchImpl, calls } = keyedFetch({
    // 账号 a：429 且带窗口证据，请求在输出任何 chunk 之前就失败了。
    "key-a": () =>
      new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", rateLimit: { window: "fiveHour", reset: Math.floor(Date.now() / 1000) + 3600 } } }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    // 账号 b：正常产出 text-delta 与 finish。
    "key-b": () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"hello"}}]}',
        '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "[DONE]",
      ]),
  });
  const adapter = createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.example.test" }),
    rotation,
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl,
    resolveStored: async (ref) => (ref === "a" ? "key-a" : ref === "b" ? "key-b" : undefined),
  });

  const chunks = await collect(adapter.stream(request()));

  expect(calls).toEqual(["key-a", "key-b"]);
  expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
    { type: "text-delta", index: 0, text: "hello" },
  ]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
  expect(markRejected).toHaveBeenCalledTimes(1);
  expect(markRejected).toHaveBeenCalledWith("a", expect.objectContaining({ kind: "rate-limit" }));
});

it("已输出后遇到额度拒绝直接报错，不换账号（Review Focus 2 端到端）", async () => {
  const rotation = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
  const markRejected = vi.spyOn(rotation, "markRejected");
  const { fetchImpl, calls } = keyedFetch({
    // 账号 a：先产出一个 text-delta，随后报告限流（同一响应内，无法再换 HTTP 状态）。
    "key-a": () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"partial"}}]}',
        '{"error":{"code":"RATE_LIMITED","message":"usage window exhausted","statusCode":429}}',
      ]),
    "key-b": () => sseResponse(['{"choices":[{"delta":{"content":"should not happen"}}]}']),
  });
  const adapter = createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.example.test" }),
    rotation,
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl,
    resolveStored: async (ref) => (ref === "a" ? "key-a" : ref === "b" ? "key-b" : undefined),
  });

  const error = await collect(adapter.stream(request())).catch((thrown: unknown) => thrown);

  expect(error).toBeInstanceOf(LlmError);
  expect(error).toMatchObject({ code: "RATE_LIMIT" });
  // 账号 b 从未被请求：已输出就不换账号。
  expect(calls).toEqual(["key-a"]);
  // 失败仍被记入轮换引擎（该账号退出轮换），只是本次请求不再重放。
  expect(markRejected).toHaveBeenCalledTimes(1);
  expect(markRejected).toHaveBeenCalledWith("a", expect.objectContaining({ kind: "rate-limit" }));
});

it("listModels 应用目录可见性规则", async () => {
  const fetchImpl = (async (): Promise<Response> =>
    new Response(JSON.stringify({ models: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const adapter = createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.example.test", modelVisibility: { m2: false } }),
    rotation: new RotationEngine({ order: [], rules: [], pinned: null }),
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl,
  });

  const models = await adapter.listModels("commandcode");

  expect(models.map((model) => model.id)).toEqual(["m1"]);
  expect(models[0]).toMatchObject({ provider: "commandcode", name: "M1", inputModalities: ["text"] });
});

it("providerRetryPolicy 把两个超时码列入 retryableCodes（裁决 12）", () => {
  const adapter = createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.example.test" }),
    rotation: new RotationEngine({ order: [], rules: [], pinned: null }),
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl: (async () => new Response("{}")) as typeof fetch,
  });

  const policy = adapter.providerRetryPolicy("commandcode");
  expect(policy?.mode).toBe("normal");
  if (policy === undefined || policy.mode !== "normal") throw new Error("expected a normal retry policy");
  expect(policy.retryableCodes).toContain("LLM_REQUEST_TIMEOUT");
  expect(policy.retryableCodes).toContain("LLM_STREAM_IDLE_TIMEOUT");
  expect(policy.retryableCodes).toContain("RATE_LIMIT");
  expect(adapter.providerInfo("commandcode")).toEqual({ id: "commandcode", name: "Command Code" });
});
