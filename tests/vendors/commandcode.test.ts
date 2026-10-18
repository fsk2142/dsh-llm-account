import { LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, RequestMessage, StreamChunk } from "@deepseek-ai/dsh-llm";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

import type { AccountPort, QuotaPort } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/rotation";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";
import { parseCatalog } from "../../src/vendors/commandcode/catalog";
import { classifyCommandCodeFailure } from "../../src/vendors/commandcode/failures";
import { decodeStream } from "../../src/vendors/commandcode/protocol";

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

/** 读一个 SSE fixture（`tests/fixtures/commandcode/`）。 */
function sseFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/commandcode/${name}`, import.meta.url), "utf8");
}

/** 把一段 SSE 文本喂进指定协议的解码器，收齐 chunk。 */
async function decodeSse(protocol: "openai" | "messages" | "cli", text: string): Promise<StreamChunk[]> {
  return collect(decodeStream(protocol, new Response(text).body));
}

/** 把一段真实 SSE 文本喂进 Messages 传输解码器，收齐 chunk。 */
async function decodeMessagesSse(text: string): Promise<StreamChunk[]> {
  return decodeSse("messages", text);
}

/**
 * 模仿宿主不变式的开块账本（`dsh-llm/lib/invariant.js:20-55`）：流结束时仍打开的块索引。
 * 非空即意味着宿主会用 `LLM stream finished with N open block(s)` 拒绝这条流。
 */
function openBlockIndices(chunks: readonly StreamChunk[]): number[] {
  const open = new Map<number, string>();
  for (const chunk of chunks) {
    if (chunk.type === "block-start") open.set(chunk.index, chunk.blockType);
    else if (chunk.type === "block-end") open.delete(chunk.index);
  }
  return [...open.keys()];
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
  const resetSeconds = Math.floor(Date.now() / 1000) + 60;
  const result = classifyCommandCodeFailure(429, { error: { rateLimit: { window: "fiveHour", reset: resetSeconds } } });
  expect(result?.kind).toBe("rate-limit");
  expect(result?.resetAt).toBe(resetSeconds * 1000);
});

it("429 显式 reset 超出 30 天视野时丢弃 resetAt（裁决：两条路径统一封顶）", () => {
  const now = Date.UTC(2026, 0, 1);
  const farSeconds = Math.floor((now + 90 * 24 * 60 * 60 * 1000) / 1000);
  const result = classifyCommandCodeFailure(
    429,
    { error: { rateLimit: { window: "fiveHour", reset: farSeconds } } },
    now,
  );
  expect(result?.kind).toBe("rate-limit");
  expect(result?.resetAt).toBeUndefined();
});

it("429 文案 ISO 时间戳超出 30 天视野时丢弃 resetAt（同一条视野）", () => {
  const now = Date.UTC(2026, 0, 1);
  const farStamp = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  const result = classifyCommandCodeFailure(
    429,
    { error: { message: `usage limit for your plan, resets at ${farStamp}` } },
    now,
  );
  expect(result?.kind).toBe("rate-limit");
  expect(result?.resetAt).toBeUndefined();
});

it("429 文案 ISO 时间戳在 30 天视野内时仍带 resetAt", () => {
  const now = Date.UTC(2026, 0, 1);
  const nearStamp = new Date(now + 60_000).toISOString();
  const result = classifyCommandCodeFailure(
    429,
    { error: { message: `usage limit for your plan, resets at ${nearStamp}` } },
    now,
  );
  expect(result?.kind).toBe("rate-limit");
  expect(result?.resetAt).toBe(Date.parse(nearStamp));
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
    config: () => ({ apiBase: "https://api.example.test", visibleModels: ["m1"], modelVisibility: { m2: false } }),
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
  // Fix round 3：空响应（EMPTY_RESPONSE）必须在白名单里，否则空答案不会被重试。
  expect(policy.retryableCodes).toContain("EMPTY_RESPONSE");
  expect(adapter.providerInfo("commandcode")).toEqual({ id: "commandcode", name: "Command Code" });
});

// ---------------------------------------------------------------------------
// Finding 1：Messages 传输每个响应只能有一条终止 finish。
// 网关实测序列是 message_delta（带 stop_reason）→ message_stop，finish 必须只发一次：
// 宿主保留最后一条 finish，多发的会覆盖结束原因，且 max-tokens 截断时不再丢弃半装的工具块。
// ---------------------------------------------------------------------------

it("Messages 流只发出一个 finish，结束原因取自 message_delta 的 stop_reason（Finding 1）", async () => {
  const chunks = await decodeMessagesSse(sseFixture("messages-tool-use.sse"));

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toEqual([{ type: "finish", reason: { kind: "tool-calls" } }]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } });
  // 内容块仍按线上顺序装配：两个 partial_json 片段拼成完整的工具参数。
  expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
    { type: "text-delta", index: 0, text: "Let me read that file." },
  ]);
  expect(chunks.filter((chunk) => chunk.type === "block-end").at(-1)).toEqual({
    type: "block-end",
    index: 1,
    block: { type: "tool-call", id: "toolu_01K7", name: "read_file", arguments: '{"path":"a.txt"}' },
  });
});

it("Messages 的 max_tokens 截断只有一条 finish，且 reason 是 max-tokens（Finding 1）", async () => {
  const chunks = await decodeMessagesSse(sseFixture("messages-max-tokens.sse"));

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({ type: "finish", reason: { kind: "max-tokens" } });
});

// ---------------------------------------------------------------------------
// 对称修复：打到输出上限却一个字都没产出时，不能伪装成正常的 max-tokens 收尾
// （opencode 已在 toHostFinishReason 修过，commandcode 此前漏了）。三种传输都要报
// INVALID_REQUEST（带可执行建议），宿主不重试、不换账号。
// ---------------------------------------------------------------------------

it("OpenAI 流 finish_reason=length 且无内容时，结束原因是 INVALID_REQUEST 错误（空内容打上限）", async () => {
  const chunks = await decodeSse(
    "openai",
    [
      '{"choices":[{"delta":{},"finish_reason":"length"}]}',
      "[DONE]",
    ].join("\n"),
  );

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({
    type: "finish",
    reason: {
      kind: "error",
      failure: expect.objectContaining({ code: "INVALID_REQUEST" }),
    },
  });
  expect(String((finishes[0] as { reason: { failure: { message: string } } }).reason.failure.message)).toMatch(
    /produced no content at its output cap/i,
  );
});

it("Messages 流 stop_reason=max_tokens 且无内容块时，结束原因是 INVALID_REQUEST 错误", async () => {
  const chunks = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n\n' +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":50}}\n\n' +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n',
  );

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({
    type: "finish",
    reason: {
      kind: "error",
      failure: expect.objectContaining({ code: "INVALID_REQUEST" }),
    },
  });
});

it("CLI 流 finishReason=length 且无内容时，结束原因是 INVALID_REQUEST 错误", async () => {
  const chunks = await decodeSse(
    "cli",
    ['{"type":"finish","finishReason":"length"}'].join("\n"),
  );

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({
    type: "finish",
    reason: {
      kind: "error",
      failure: expect.objectContaining({ code: "INVALID_REQUEST" }),
    },
  });
});

it("OpenAI 流 finish_reason=length 但有内容时仍是正常的 max-tokens（非退化回归）", async () => {
  const chunks = await decodeSse(
    "openai",
    [
      '{"choices":[{"delta":{"content":"partial answer"}}]}',
      '{"choices":[{"delta":{},"finish_reason":"length"}]}',
      "[DONE]",
    ].join("\n"),
  );

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({ type: "finish", reason: { kind: "max-tokens" } });
});

// ---------------------------------------------------------------------------
// Finding 2：usage 只在 message_start 里有输入/缓存计数；合并后仅交出**一条** usage chunk
//（宿主拒绝第二条 usage：dsh-llm 的流不变式 "LLM stream emitted usage more than once"）。
// ---------------------------------------------------------------------------

it("Messages usage 合并 message_start 与 message_delta，且只发一条 usage（Finding 2）", async () => {
  const chunks = await decodeMessagesSse(sseFixture("messages-max-tokens.sse"));

  const usages = chunks.filter((chunk) => chunk.type === "usage");
  expect(usages).toHaveLength(1);
  // input/cache 计数只出现在 message_start，output 计数只出现在 message_delta。
  expect(usages[0]).toEqual({
    type: "usage",
    usage: { inputTokens: 4096, outputTokens: 8192, cacheReadTokens: 2048, cacheWriteTokens: 128 },
  });
  expect(chunks.indexOf(usages[0])).toBeLessThan(chunks.findIndex((chunk) => chunk.type === "finish"));
});

it("message_delta 完全不带 usage 时，message_start 的输入计数仍只发一条 usage（Finding 2）", async () => {
  const chunks = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":777,"cache_read_input_tokens":11,"output_tokens":1}}}\n\n' +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n' +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n',
  );

  expect(chunks.filter((chunk) => chunk.type === "usage")).toEqual([
    { type: "usage", usage: { inputTokens: 777, outputTokens: 1, cacheReadTokens: 11 } },
  ]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
});

// ---------------------------------------------------------------------------
// Finding 3：4xx 散文扫描与窗口证据都要看整段原始正文，而不是只有 error.message。
// ---------------------------------------------------------------------------

it("纯文本 400 正文命中余额耗尽文案：标记 unavailable 并换账号（Finding 3）", async () => {
  const rotation = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
  const markRejected = vi.spyOn(rotation, "markRejected");
  const { fetchImpl, calls } = keyedFetch({
    // 账号 a：400，正文是纯文本（解析不出 JSON），只在散文里点名余额耗尽。
    "key-a": () =>
      new Response("insufficient credits for this account", { status: 400, headers: { "content-type": "text/plain" } }),
    "key-b": () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"ok"}}]}',
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
  expect(markRejected).toHaveBeenCalledWith("a", expect.objectContaining({ kind: "unavailable" }));
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
});

it("429 的重置证据落在 error.message 之外（根级 message / detail）时仍解析出 resetAt（Finding 3）", () => {
  const now = Date.UTC(2026, 0, 1);
  const stamp = new Date(now + 30 * 60 * 1000).toISOString();

  const rootMessage = classifyCommandCodeFailure(
    429,
    { error: { type: "rate_limit_error" }, message: `usage limit for your plan, resets at ${stamp}` },
    now,
  );
  expect(rootMessage?.kind).toBe("rate-limit");
  expect(rootMessage?.resetAt).toBe(Date.parse(stamp));

  const detail = classifyCommandCodeFailure(
    429,
    { error: { type: "rate_limit_error" }, detail: `usage limit for your plan, resets at ${stamp}` },
    now,
  );
  expect(detail?.kind).toBe("rate-limit");
  expect(detail?.resetAt).toBe(Date.parse(stamp));
});

// ---------------------------------------------------------------------------
// 控制器裁决（小项）：缺凭据的账号必须入拒绝表，否则每次请求都会重新选中它。
// ---------------------------------------------------------------------------

it("缺凭据的账号被记入拒绝表，后续请求不再重选它（裁决：missing-credential 入表）", async () => {
  const rotation = new RotationEngine({ order: ["a", "b"], rules: [], pinned: null });
  const { fetchImpl, calls } = keyedFetch({
    "key-b": () =>
      sseResponse([
        '{"choices":[{"delta":{"content":"ok"}}]}',
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
    // 账号 a 没有任何来源的密钥（stored/environment/authFile 全空）。
    resolveStored: async (ref) => (ref === "b" ? "key-b" : undefined),
  });

  const chunks = await collect(adapter.stream(request()));

  expect(calls).toEqual(["key-b"]);
  expect(rotation.rejections().get("a")).toMatchObject({ kind: "invalid-credential" });
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
});

// ---------------------------------------------------------------------------
// Fix round 2：流在终止事件之前干净结束（断流/正文被截断）时，`decodeStream` 必须补**一条**
// finish —— 宿主不变式 "LLM stream ended without a terminal finish chunk"
// （dsh-llm/lib/invariant.js:59）。已经出现过 finish 的流不得补第二条。
// ---------------------------------------------------------------------------

it("Messages 在 message_delta 之后断流（缺 message_stop）时补一条带 stop_reason 的 finish（Fix 2）", async () => {
  const chunks = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":321,"output_tokens":1}}}\n\n' +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":50}}\n\n',
  );

  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([{ type: "finish", reason: { kind: "max-tokens" } }]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "max-tokens" } });
  // 断流前已交出的 usage 不重复，合并后的输入计数仍来自 message_start。
  expect(chunks.filter((chunk) => chunk.type === "usage")).toEqual([
    { type: "usage", usage: { inputTokens: 321, outputTokens: 50, cacheReadTokens: 0 } },
  ]);
});

it("Messages 已经发出 message_stop 的流在 EOF 时不会补第二条 finish（Fix 2）", async () => {
  const chunks = await decodeMessagesSse(sseFixture("messages-tool-use.sse"));

  const finishes = chunks.filter((chunk) => chunk.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(finishes[0]).toEqual({ type: "finish", reason: { kind: "tool-calls" } });
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } });
});

it("畸形网关连发两个 message_stop：只有一条 finish，结束原因不被第二条覆盖", async () => {
  const chunks = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      "event: content_block_delta\n" +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      "event: content_block_stop\n" +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n' +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n\n' +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n\n',
  );

  // 第二个 message_stop 什么都不发：宿主保留最后一条 finish，冒充第二条会覆盖结束原因，
  // 且 usage / 打开的块都会被重复交出。
  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([
    { type: "finish", reason: { kind: "max-tokens" } },
  ]);
  expect(chunks.filter((chunk) => chunk.type === "usage")).toHaveLength(1);
  expect(openBlockIndices(chunks)).toEqual([]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "max-tokens" } });
});

it("畸形网关连发两个 finish_reason：只有一条 finish，先到的结束原因保留", async () => {
  const chunks = await decodeSse(
    "openai",
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
  );

  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([
    { type: "finish", reason: { kind: "tool-calls" } },
  ]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "tool-calls" } });
});

it("openai 流在缺 finish_reason 的情况下 EOF 时补一条 finish，并关闭打开的文本块（Fix 2）", async () => {
  const chunks = await decodeSse("openai", 'data: {"choices":[{"delta":{"content":"hi"}}]}\n');

  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([{ type: "finish", reason: { kind: "stop" } }]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
  // 打开的文本块必须被关闭，否则宿主的 "finished with N open block(s)" 仍会拒。
  expect(chunks.filter((chunk) => chunk.type === "block-end")).toEqual([
    { type: "block-end", index: 0, block: { type: "text", text: "hi" } },
  ]);
});

it("cli 流在缺 finish 事件的情况下 EOF 时补一条 finish（Fix 2）", async () => {
  const chunks = await decodeSse("cli", 'data: {"type":"text-delta","text":"hi"}\n');

  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([{ type: "finish", reason: { kind: "stop" } }]);
  expect(chunks.at(-1)).toEqual({ type: "finish", reason: { kind: "stop" } });
});

// ---------------------------------------------------------------------------
// Fix round 3 —— Item A：流在终止事件之前结束且**毫无内容**时必须报可重试错误，不能伪装成
// `{kind:"stop"}` 的正常收尾（旧插件第 4221 行的 EMPTY_RESPONSE）；有内容但被截断仍补一条 finish。
// ---------------------------------------------------------------------------

it("没有内容也没有终止事件的流抛可重试的 EMPTY_RESPONSE，而不是补一条 stop finish（Fix 3）", async () => {
  // 0 字节正文。
  const empty = await decodeMessagesSse("").catch((thrown: unknown) => thrown);
  expect(empty).toBeInstanceOf(LlmError);
  expect(empty).toMatchObject({ code: "EMPTY_RESPONSE" });

  // 只有 message_start，且 usage 全是 0（非零 usage 才算内容）——随后断流。
  const zeroUsage = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
  ).catch((thrown: unknown) => thrown);
  expect(zeroUsage).toBeInstanceOf(LlmError);
  expect(zeroUsage).toMatchObject({ code: "EMPTY_RESPONSE" });

  // 同一兜底对共用 decodeStream 的 openai 传输同样生效。
  const openaiEmpty = await decodeSse("openai", "").catch((thrown: unknown) => thrown);
  expect(openaiEmpty).toBeInstanceOf(LlmError);
  expect(openaiEmpty).toMatchObject({ code: "EMPTY_RESPONSE" });
});

it("Messages 的 tool_use 块在 EOF 仍打开时被排空，且只有一条 finish（Fix 3，Item B）", async () => {
  const chunks = await decodeMessagesSse(
    "event: message_start\n" +
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n\n' +
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_eof","name":"read_file","input":{}}}\n\n' +
      "event: content_block_delta\n" +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
  );

  // 宿主账本里没有打开的块（否则 invariant.js:53 会拒这条 finish）。
  expect(openBlockIndices(chunks)).toEqual([]);
  expect(chunks.filter((chunk) => chunk.type === "block-end")).toEqual([
    { type: "block-end", index: 0, block: { type: "tool-call", id: "toolu_eof", name: "read_file", arguments: '{"path":' } },
  ]);
  // 有内容（tool-call-delta）→ 仍然恰好一条 finish；宿主 FinishReason 没有「截断」取值，故为 stop。
  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([{ type: "finish", reason: { kind: "stop" } }]);
});

it("有内容但缺终止事件的 openai 流仍然恰好一条 finish 且块已关闭（Fix 3，回归守卫）", async () => {
  const chunks = await decodeSse("openai", 'data: {"choices":[{"delta":{"content":"hi"}}]}\n');

  expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
  expect(openBlockIndices(chunks)).toEqual([]);
});

it("正常收尾的 Messages 流不变：恰好一条 finish、一条 usage、无打开块（Fix 3，回归守卫）", async () => {
  const chunks = await decodeMessagesSse(sseFixture("messages-tool-use.sse"));

  expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
  expect(chunks.filter((chunk) => chunk.type === "usage")).toHaveLength(1);
  expect(openBlockIndices(chunks)).toEqual([]);
});

it("openai 流只缓冲了工具调用、随后断流：工具调用被交出，不是空响应（Fix 3，回归守卫）", async () => {
  const chunks = await decodeSse(
    "openai",
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}]}\n',
  );

  expect(chunks.filter((chunk) => chunk.type === "finish")).toEqual([{ type: "finish", reason: { kind: "stop" } }]);
  expect(openBlockIndices(chunks)).toEqual([]);
  expect(chunks.filter((chunk) => chunk.type === "block-end")).toEqual([
    { type: "block-end", index: 0, block: { type: "tool-call", id: "call_1", name: "read_file", arguments: '{"path":"a.txt"}' } },
  ]);
});
