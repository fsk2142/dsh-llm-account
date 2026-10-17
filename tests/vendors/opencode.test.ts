/**
 * opencode 适配器：失败映射、目录解析、可见性过滤与账号轮换端到端。
 *
 * 请求路径上的「假传输」就是假 `fetchImpl`：适配器把它交给 pi-ai SDK，SDK 的
 * 每个 HTTP 请求都经过它，于是「换没换账号」= 假 fetch 看到的密钥序列。
 * @module dsh-llm-account/tests/vendors/opencode
 */
import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, LlmError } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, RequestMessage, StreamChunk } from "@deepseek-ai/dsh-llm";
import { expect, it, vi } from "vitest";

import type { AccountPort, QuotaPort } from "../../src/core/adapter";
import { MAX_TRIED, RotationEngine } from "../../src/core/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT } from "../../src/core/transport";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { parseModels } from "../../src/vendors/opencode/catalog";
import { classifyGatewayFailure } from "../../src/vendors/opencode/failures";
import { BODY_READ_TIMEOUT_MS, recordGatewayFetch } from "../../src/vendors/opencode/protocol";
import { serializeOAuthCredential } from "../../src/vendors/opencode/oauth";

const BASE_URL = "https://opencode.ai/zen/go/v1";
const MODELS_URL = `${BASE_URL}/models`;
const METADATA_URL = "https://models.dev/api.json";

/** 账号 ref → 密钥（`resolveStored` 的假实现）。 */
const KEYS: Readonly<Record<string, string>> = { a: "key-a", b: "key-b" };

/** 目录响应：两个模型；`modelVisibility` 用来关掉 m2。 */
const LISTING = { object: "list", data: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }] };

/** 本文件里的假的账号端口：这些用例都不经账号写路径（Task 13 负责）。 */
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
function request(model = "m1"): GenerateOptions {
  return { provider: "dsh-opencode-go", model, messages: [userMessage("hi")] };
}

/** 把流收集成数组；`for await` 在提前退出时关闭流，与宿主的消费方式一致。 */
async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

/** 收集到一半失败时的结果：已经产出的 chunk 与抛出的异常。 */
async function collectSettled(source: AsyncIterable<StreamChunk>): Promise<{ chunks: StreamChunk[]; error: unknown }> {
  const chunks: StreamChunk[] = [];
  let error: unknown;
  try {
    for await (const chunk of source) chunks.push(chunk);
  } catch (failure) {
    error = failure;
  }
  return { chunks, error };
}

/** 收集到的可见文本。 */
function textOf(chunks: readonly StreamChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<StreamChunk, { type: "text-delta" }> => chunk.type === "text-delta")
    .map((chunk) => chunk.text)
    .join("");
}

/** 把若干 Anthropic Messages 事件拼成一段 SSE 正文（pi-ai 的 anthropic-messages 传输要的形状）。 */
function anthropicSse(frames: readonly (readonly [string, unknown])[]): string {
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** 一个 200 的 SSE 响应。 */
function sseResponse(frames: readonly (readonly [string, unknown])[]): Response {
  return new Response(anthropicSse(frames), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** 一个 JSON 响应（网关级拒绝或目录清单）。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** SSE 的开场帧：`message_start` + 一个文本块的开始。 */
function opener(inputTokens = 4): readonly (readonly [string, unknown])[] {
  return [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "m1",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 1 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ];
}

/** 一次干净的文本回复（"hello"）。 */
const TEXT_FRAMES: readonly (readonly [string, unknown])[] = [
  ...opener(),
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
  ],
  ["message_stop", { type: "message_stop" }],
];

/**
 * 打到输出上限却一个字都没产出的回复：**不开任何内容块**（`content` 是块数组，开一个空块
 * 也算「有内容」），`stop_reason: "max_tokens"` 经 pi-ai 映射为 `stopReason: "length"`。
 */
const EMPTY_LENGTH_FRAMES: readonly (readonly [string, unknown])[] = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "m1",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 8, output_tokens: 0 },
      },
    },
  ],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: 0 } },
  ],
  ["message_stop", { type: "message_stop" }],
];

/**
 * 先产出可见文本、再在流中途报错的回复。
 *
 * 报错文案刻意选**账号级可归类**的额度措辞：这两条用例要问的是「闸门在已输出时是否
 * 拦住换号」，不是一个认不出来的失败碰巧没换号（后者由专门的用例覆盖）。
 */
const AFTER_OUTPUT_FRAMES: readonly (readonly [string, unknown])[] = [
  ...opener(),
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }],
  ["error", { type: "error", error: { type: "overloaded_error", message: "insufficient quota for this account" } }],
];

/**
 * 没有任何可见输出（没有开过任何内容块）、但已经报告过用量的失败回复。
 * 这是「已消耗 token」与「已输出」两条判定的分水岭：用量到了，chunk 一个都没交给宿主。
 */
const TOKENS_THEN_ERROR_FRAMES: readonly (readonly [string, unknown])[] = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "m1",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 9, output_tokens: 0 },
      },
    },
  ],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: null, stop_sequence: null }, usage: { output_tokens: 6 } },
  ],
  ["error", { type: "error", error: { type: "api_error", message: "insufficient quota for this account" } }],
];

/**
 * 上下文溢出**以 200 的流内事件**送达（旧插件在 `mapStopReason` 里第一个判它，第 1712-1723 行）：
 * 这是宿主的压缩信号，不是「这个账号不行」。
 */
const OVERFLOW_FRAMES: readonly (readonly [string, unknown])[] = [
  ...opener(8),
  [
    "error",
    { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 300000 tokens > 200000 maximum" } },
  ],
];

/** 一个**认不出来**的流内失败：既不像传输问题，也不像账号问题。 */
const UNCLASSIFIED_FRAMES: readonly (readonly [string, unknown])[] = [
  ...opener(8),
  ["error", { type: "error", error: { type: "api_error", message: "the model declined to answer this request" } }],
];

/** 一次干净的结束，但一点内容都没有（宿主的 EMPTY_RESPONSE 场景）。 */
const EMPTY_FRAMES: readonly (readonly [string, unknown])[] = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "m1",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    },
  ],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null } }],
  ["message_stop", { type: "message_stop" }],
];

/**
 * 造一个适配器：假 fetch 提供目录与生成两条路径，生成响应按密钥分流。
 * @param generate - 密钥到响应的映射：返回 `Response`，或抛错模拟网络失败。
 * @param modelVisibility - 逐模型可见性开关。
 * @param order - 账号顺序；缺省两个账号（`a`/`b`）。
 * @returns 适配器、轮换引擎、`fallbackAllowed` 的探针与假 fetch 看到的密钥序列。
 */
function harness(
  generate: (key: string) => Response,
  modelVisibility?: Record<string, boolean>,
  order: readonly string[] = ["a", "b"],
  promoteServed?: (ref: string) => void,
  keys: Readonly<Record<string, string>> = KEYS,
) {
  const calls: string[] = [];
  const headersSeen: Headers[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url: string }).url);
    if (url === MODELS_URL) return jsonResponse(200, LISTING);
    if (url === METADATA_URL) return jsonResponse(503, { error: { message: "metadata unavailable" } });
    const headers = new Headers(init?.headers);
    headersSeen.push(headers);
    const key = (headers.get("x-api-key") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    calls.push(key);
    return generate(key);
  }) as typeof fetch;

  const rotation = new RotationEngine({ order: [...order], rules: [], pinned: null });
  // 探针：把「适配器拿什么去问轮换引擎」原样记下来 —— 「有没有真的走那道闸」不看结果猜。
  const gate = vi.spyOn(rotation, "fallbackAllowed");
  const adapter = createOpencodeAdapter({
    config: () => ({ apiBase: BASE_URL, ...(modelVisibility === undefined ? {} : { modelVisibility }) }),
    rotation,
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl,
    resolveStored: async (ref) => keys[ref] ?? `key-${ref}`,
    ...(promoteServed === undefined ? {} : { promoteServed }),
  });
  return { adapter, rotation, gate, calls, headersSeen };
}

it("creditserror / userlimiterror / insufficientquota 映射为 quota", () => {
  expect(classifyGatewayFailure(402, { error: { type: "insufficientquota" } })?.kind).toBe("quota");
  expect(classifyGatewayFailure(402, { error: { type: "creditserror" } })?.kind).toBe("quota");
  expect(classifyGatewayFailure(429, { error: { type: "userlimiterror" } })?.kind).toBe("quota");
});

it("autherror / invalidapikey 映射为 invalid-credential", () => {
  expect(classifyGatewayFailure(401, { error: { type: "invalidapikey" } })?.kind).toBe("invalid-credential");
  expect(classifyGatewayFailure(401, { error: { type: "autherror" } })?.kind).toBe("invalid-credential");
});

it("regionerror / datapolicyerror 映射为 unavailable", () => {
  expect(classifyGatewayFailure(403, { error: { type: "datapolicyerror" } })?.kind).toBe("unavailable");
  expect(classifyGatewayFailure(403, { error: { type: "regionerror" } })?.kind).toBe("unavailable");
});

it("目录解析忽略坏行并计数", () => {
  const { entries, ignored } = parseModels({ data: [{ id: "m", name: "M" }, {}] });
  expect(entries).toHaveLength(1);
  expect(ignored).toBe(1);
  expect(entries[0]?.id).toBe("m");
});

it("未输出时 quota 拒绝切到下一个账号；已输出时报错不切（Review Focus 2 端到端）", async () => {
  // (1) 账号 a 直接 402：切到 b，b 的 chunk 被产出，a 被记进拒绝表。
  const switched = harness((key) =>
    key === "key-a" ? jsonResponse(402, { error: { type: "insufficientquota" } }) : sseResponse(TEXT_FRAMES),
  );
  const chunks = await collect(switched.adapter.stream(request()));
  expect(textOf(chunks)).toBe("hello");
  expect(switched.calls).toEqual(["key-a", "key-b"]);
  expect(switched.rotation.rejections().get("a")?.kind).toBe("quota");
  // 那次 402 是**零输出零用量**的失败：闸门被问到，并且答的是「可以换」。
  expect(switched.gate).toHaveBeenCalledWith({ emitted: false, totalTokens: 0, aborted: false });

  // (2) 账号 a 先输出再报错：已经交出去的 "partial" 不能被重放，于是原样抛出，
  //     且账号 b **从未被联系**（换账号会重复已经交付给调用方的输出）。
  const afterOutput = harness((key) => (key === "key-a" ? sseResponse(AFTER_OUTPUT_FRAMES) : sseResponse(TEXT_FRAMES)));
  const settled = await collectSettled(afterOutput.adapter.stream(request()));
  expect(textOf(settled.chunks)).toBe("partial");
  expect(settled.error).toBeDefined();
  expect(afterOutput.calls).toEqual(["key-a"]);
  // 闸门确实被问到，而且看到的正是「已输出」：不换账号是这个判定的结果，不是运气。
  expect(afterOutput.gate).toHaveBeenCalledTimes(1);
  expect(afterOutput.gate.mock.calls[0]?.[0]).toMatchObject({ emitted: true, aborted: false });
});

it("已消耗 token 或调用方已中止时同样不切账号", async () => {
  // (1) 没有任何可见输出、但报过用量（totalTokens > 0）：闸门看到的是 token，不换账号。
  const tokens = harness((key) => (key === "key-a" ? sseResponse(TOKENS_THEN_ERROR_FRAMES) : sseResponse(TEXT_FRAMES)));
  const settled = await collectSettled(tokens.adapter.stream(request()));
  expect(textOf(settled.chunks)).toBe("");
  expect(settled.error).toBeDefined();
  expect(tokens.calls).toEqual(["key-a"]);
  expect(tokens.gate).toHaveBeenCalledTimes(1);
  const seen = tokens.gate.mock.calls[0]?.[0];
  expect(seen?.emitted).toBe(false);
  expect(seen?.totalTokens).toBeGreaterThan(0);

  // (2) 调用方已中止：不切账号（第 1 步就抛，连第一次尝试都不发）。
  const aborted = harness(() => sseResponse(TEXT_FRAMES));
  const controller = new AbortController();
  controller.abort();
  await expect(
    collect(aborted.adapter.stream({ ...request(), signal: controller.signal })),
  ).rejects.toThrow();
  expect(aborted.calls).toEqual([]);
  expect(aborted.gate).not.toHaveBeenCalled();
});

it("listModels 应用 modelVisibility（能力声明为 immediate 的逐模型开关）", async () => {
  const { adapter } = harness(() => sseResponse(TEXT_FRAMES), { m2: false });
  const models = await adapter.listModels("dsh-opencode-go");
  expect(models.map((model) => model.id)).toEqual(["m1"]);
});

it("网页登录的 ocoauth1 blob：用 access token 发请求，并带 x-opencode-org-id", async () => {
  const blob = serializeOAuthCredential({
    v: 1,
    access: "access-1",
    refresh: "refresh-1",
    expiresAt: Date.now() + 3_600_000,
    orgId: "org-1",
    orgName: "Default",
    userName: "Default",
  });
  const withOauth = harness(() => sseResponse(TEXT_FRAMES), undefined, ["a"], undefined, { a: blob });

  const chunks = await collect(withOauth.adapter.stream(request()));

  expect(textOf(chunks)).toBe("hello");
  expect(withOauth.calls).toEqual(["access-1"]);
  expect(withOauth.headersSeen.at(-1)?.get("x-opencode-org-id")).toBe("org-1");
  // 普通 key 的请求**没有**这个头：org 头只属于网页登录的凭据。
  const plain = harness(() => sseResponse(TEXT_FRAMES), undefined, ["a"]);
  await collect(plain.adapter.stream(request()));
  expect(plain.headersSeen.at(-1)?.get("x-opencode-org-id")).toBeNull();
});

it("网页登录 blob 过期且刷新成功：请求用新 token，并回写凭据槽", async () => {
  const blob = serializeOAuthCredential({
    v: 1,
    access: "old-access",
    refresh: "refresh-1",
    expiresAt: 0,
    orgId: "org-1",
    orgName: "Default",
  });
  const writes: { ref: string; value: string }[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/console/auth/device/token")) {
      return jsonResponse(200, { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    }
    if (url === MODELS_URL) return jsonResponse(200, LISTING);
    if (url === METADATA_URL) return jsonResponse(503, { error: { message: "metadata unavailable" } });
    const headers = new Headers(init?.headers);
    calls.push((headers.get("x-api-key") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/, ""));
    return sseResponse(TEXT_FRAMES);
  }) as typeof fetch;
  const rotation = new RotationEngine({ order: ["a"], rules: [], pinned: null });
  const adapter = createOpencodeAdapter({
    config: () => ({ apiBase: BASE_URL }),
    rotation,
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl,
    resolveStored: async () => blob,
    persistStored: async (ref, value) => {
      writes.push({ ref, value });
    },
  });

  await collect(adapter.stream(request()));

  expect(calls).toEqual(["new-access"]);
  expect(writes).toHaveLength(1);
  expect(writes[0]?.ref).toBe("a");
  expect(writes[0]?.value).toContain("new-access");
  expect(writes[0]?.value).toContain("new-refresh");
});

it("空响应这类终态错误交给宿主，不被账号轮换吞掉", async () => {
  // 干净的结束、一点内容都没有：这是宿主的 EMPTY_RESPONSE，不是「这个账号不行」。
  // 换账号重放会把它伪装成一次正常重试，宿主的重试账本就再也看不到它了。
  const empty = harness((key) => (key === "key-a" ? sseResponse(EMPTY_FRAMES) : sseResponse(TEXT_FRAMES)));
  const settled = await collectSettled(empty.adapter.stream(request()));
  expect(settled.error).toBeInstanceOf(LlmError);
  expect((settled.error as LlmError).code).toBe(EMPTY_RESPONSE_CODE);
  expect(empty.calls).toEqual(["key-a"]);
  expect(empty.gate).not.toHaveBeenCalled();
});

it("流内送达的上下文溢出映射为 CONTEXT_WINDOW_EXCEEDED，不换账号也不重试", async () => {
  // 200 的 SSE 里报的溢出：确定性失败。当瞬时故障处理会按账号重放，并把宿主的压缩信号丢掉。
  const overflow = harness((key) => (key === "key-a" ? sseResponse(OVERFLOW_FRAMES) : sseResponse(TEXT_FRAMES)));
  const settled = await collectSettled(overflow.adapter.stream(request()));
  expect(settled.error).toBeInstanceOf(LlmError);
  expect((settled.error as LlmError).code).toBe(CONTEXT_WINDOW_EXCEEDED_CODE);
  expect(overflow.calls).toEqual(["key-a"]);
  expect(overflow.gate).not.toHaveBeenCalled();
});

it("认不出来的流内失败是终态（PI_AI_ERROR），不会伪装成 network 去轮换或重试", async () => {
  // 「认不出来」不等于「网络抖动」：旧插件对这类失败返回 PI_AI_ERROR（不重试），
  // 若倒成 network，它就会被每个账号重放一遍，并被宿主当成可重试的 TRANSPORT。
  expect(classifyGatewayFailure(0, { message: "the model declined to answer this request" })).toBeUndefined();
  // 反过来，真的像传输问题的文案仍然按瞬时故障处理。
  expect(classifyGatewayFailure(0, { message: "fetch failed: other side closed" })?.kind).toBe("network");

  const unclassified = harness((key) => (key === "key-a" ? sseResponse(UNCLASSIFIED_FRAMES) : sseResponse(TEXT_FRAMES)));
  const settled = await collectSettled(unclassified.adapter.stream(request()));
  expect(settled.error).toBeInstanceOf(LlmError);
  expect((settled.error as LlmError).code).toBe("PI_AI_ERROR");
  expect(unclassified.calls).toEqual(["key-a"]);
  expect(unclassified.gate).not.toHaveBeenCalled();
});

it("providerRetryPolicy 保留两个超时码，且不退化成一个 TIMEOUT", () => {
  const { adapter } = harness(() => sseResponse(TEXT_FRAMES));
  const policy = adapter.providerRetryPolicy("dsh-opencode-go");
  expect(policy?.mode).toBe("normal");
  const codes = policy?.mode === "normal" ? policy.retryableCodes : [];
  expect(codes).toContain(LLM_REQUEST_TIMEOUT);
  expect(codes).toContain(LLM_STREAM_IDLE_TIMEOUT);
  // 两个码各自独立存在（不是一个笼统的 TIMEOUT 顶替）：区分「整请求超时」与「流空闲超时」。
  expect(LLM_REQUEST_TIMEOUT).not.toBe(LLM_STREAM_IDLE_TIMEOUT);
  expect(codes).toContain("TIMEOUT");
  expect(codes.filter((code) => code === LLM_REQUEST_TIMEOUT)).toHaveLength(1);
  expect(codes.filter((code) => code === LLM_STREAM_IDLE_TIMEOUT)).toHaveLength(1);
});

it(`尝试次数到达 MAX_TRIED（${MAX_TRIED}）就停下并抛出最后一次失败`, async () => {
  // 账号数比上限多一个：第 17 个账号从头到尾都不该被联系。
  const order = Array.from({ length: MAX_TRIED + 1 }, (_value, index) => `acct-${index}`);
  const capped = harness(
    (key) => (key.startsWith("key-acct-") ? jsonResponse(402, { error: { type: "insufficientquota" } }) : sseResponse(TEXT_FRAMES)),
    undefined,
    order,
  );
  const settled = await collectSettled(capped.adapter.stream(request()));
  expect(settled.error).toBeInstanceOf(LlmError);
  expect((settled.error as LlmError).code).toBe("QUOTA"); // 抛出的是**最后一次**失败
  expect(capped.calls).toHaveLength(MAX_TRIED);
  expect(capped.calls[0]).toBe("key-acct-0");
  expect(capped.calls.at(-1)).toBe(`key-acct-${MAX_TRIED - 1}`);
  expect(capped.calls).not.toContain(`key-acct-${MAX_TRIED}`);
  expect(capped.gate).toHaveBeenCalledTimes(MAX_TRIED);
});

it("失败响应的正文读不动时按已有证据降级，不会卡住请求", async () => {
  // 一条永不结束的错误正文：读取必须自带期限（旧插件 BODY_READ_TIMEOUT_MS = 1000）。
  // 真带上这条正文的话，pi-ai 自己的 SDK 也会卡在读它上面，所以这条用例直接打在
  // 「证据记录器」这一层 —— 正是 `await gateway.evidence()` 依赖的那段。
  const never = new ReadableStream<Uint8Array>({ start() {} });
  const recorder = recordGatewayFetch((async () => new Response(never, { status: 402 })) as typeof fetch);
  const response = await recorder.fetch(`${BASE_URL}/messages`, { method: "POST" });
  expect(response.status).toBe(402);

  const started = Date.now();
  const evidence = await recorder.evidence();
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(BODY_READ_TIMEOUT_MS + 1_500); // 有期限，不是无限等
  expect(evidence?.status).toBe(402); // 状态永远在：正文读不动就按状态分类
  expect(evidence?.body).toBeUndefined();
});

it("备用账号把请求服务成功后被报告晋升；首选账号服务成功时安静", async () => {
  // (1) a 配额用尽 → b 服务成功：b 是备用账号，适配器必须把它报告给装配层提位
  //     （旧插件 `GoAccountSelection.adopt`：「开始正常输出的备用账号会移至首位并成为当前账号」）。
  const promoted: string[] = [];
  const switched = harness(
    (key) => (key === "key-a" ? jsonResponse(402, { error: { type: "insufficientquota" } }) : sseResponse(TEXT_FRAMES)),
    undefined,
    ["a", "b"],
    (ref) => promoted.push(ref),
  );
  await collect(switched.adapter.stream(request()));
  expect(promoted).toEqual(["b"]);

  // (2) 首选账号一次成功：没有任何晋升报告（每次都报就等于每次请求都写一次设置）。
  const quiet: string[] = [];
  const direct = harness(() => sseResponse(TEXT_FRAMES), undefined, ["a", "b"], (ref) => quiet.push(ref));
  await collect(direct.adapter.stream(request()));
  expect(quiet).toEqual([]);

  // (3) 晋升报告口缺席（装配层没接）也不影响请求路径。
  const bare = harness((key) => (key === "key-a" ? jsonResponse(402, { error: { type: "insufficientquota" } }) : sseResponse(TEXT_FRAMES)));
  expect(textOf(await collect(bare.adapter.stream(request())))).toBe("hello");
});

it("length 终态一个字都没产出时给出可执行建议，而不是伪装成 max-tokens", async () => {
  // 空消息会让一轮什么都不说地结束（dsh-llm 的 EMPTY_RESPONSE_CODE 文档点名的失败模式）。
  const { adapter } = harness(() => sseResponse(EMPTY_LENGTH_FRAMES));
  const settled = await collectSettled(adapter.stream(request()));
  expect(settled.error).toBeDefined();
  expect((settled.error as { code?: string }).code).toBe("INVALID_REQUEST");
  expect(String((settled.error as Error).message)).toContain("/compact");
  expect(String((settled.error as Error).message)).toContain("max output");
});
