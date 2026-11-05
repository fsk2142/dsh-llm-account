/**
 * OpenCode 流式超时必须真的停掉底层网络（2026-11-05 外部审查 F04）。
 *
 * ## 缺陷
 *
 * `opencode/adapter.ts` 调 `runStream()` 时只传了 `signal`，**没有**传 `abortNetwork`。
 * `transport.ts` 的注释写得很清楚：卡在 Web Stream `read()` 上的 reader 不响应
 * `iterator.return()`，只有 abort 才能让 socket 释放。
 *
 * 另两家（`commandcode`、`opendesign`）都传了 `deadline.networkAbort()`；opencode 漏了。
 *
 * ## 为什么从 `adapter.stream` 进入
 *
 * 与 U06/U07 同一条教训（`docs/HANDOVER-2.0.0.md` §5.3）：只测 `runStream` 的通用回调
 * 是假绿 —— 那测的是 transport，不是「opencode 有没有接线」。
 *
 * 这里断言的是**交给 pi-ai 的 signal 真的被 abort 了**，而且是从 adapter 走完整条路径。
 */
import { describe, expect, it } from "vitest";

import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

import { RotationEngine } from "../../src/core/switching/rotation";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";

const BASE_URL = "https://opencode.ai/zen/go/v1";

const LISTING = {
  object: "list",
  data: [{ id: "m", capabilities: { reasoning: { supported: false } }, limit: { context: 128_000, output: 8_000 } }],
};

/** 一个「响应头回来了但正文永远不产出」的 SSE 响应 —— 流空闲看门狗要能打断它。 */
function hangingSse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
      // 之后什么都不发：模拟正文停住。
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function buildAdapter(input: {
  fetchImpl: typeof fetch;
  requestTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
}): ReturnType<typeof createOpencodeAdapter> {
  return createOpencodeAdapter({
    config: () => ({
      apiBase: BASE_URL,
      ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
      ...(input.streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs: input.streamIdleTimeoutMs }),
    }),
    rotation: new RotationEngine({ order: ["a"], rules: [], pinned: null }),
    quota: { snapshot: async () => ({ windows: [], failures: [] }), record: async () => {}, read: async () => undefined } as never,
    accounts: { list: async () => [{ ref: "a", label: "A", apiKeyEnv: "A" }], activeRefOf: () => "a" } as never,
    fetchImpl: input.fetchImpl,
    resolveStored: async () => "sk-a",
  });
}

const REQUEST = { model: "m", messages: [{ role: "user", content: "hi" }], sessionId: "s1" } as unknown as GenerateOptions;

describe("F04 · OpenCode 超时必须 abort 底层网络", () => {
  it("流空闲超时后，交给 pi-ai 的 signal 必须 aborted", async () => {
    let attemptSignal: AbortSignal | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      if (text.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
      attemptSignal = init?.signal ?? undefined;
      return hangingSse();
    }) as unknown as typeof fetch;

    const adapter = buildAdapter({ fetchImpl, requestTimeoutMs: 10_000, streamIdleTimeoutMs: 120 });
    await expect(
      (async () => {
        for await (const _chunk of adapter.stream(REQUEST) as AsyncIterable<StreamChunk>) {
          // 消费到超时
        }
      })(),
    ).rejects.toMatchObject({ code: "LLM_STREAM_IDLE_TIMEOUT" });

    expect(attemptSignal, "推理请求确实带了 signal").toBeDefined();
    expect(attemptSignal?.aborted, "**超时后底层 fetch 的 signal 必须已 abort**").toBe(true);
  });

  it("整请求超时同样 abort 底层网络", async () => {
    let attemptSignal: AbortSignal | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      if (text.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
      attemptSignal = init?.signal ?? undefined;
      return hangingSse();
    }) as unknown as typeof fetch;

    const adapter = buildAdapter({ fetchImpl, requestTimeoutMs: 120, streamIdleTimeoutMs: 10_000 });
    await expect(
      (async () => {
        for await (const _chunk of adapter.stream(REQUEST) as AsyncIterable<StreamChunk>) {
          // 消费到超时
        }
      })(),
    ).rejects.toMatchObject({ code: "LLM_REQUEST_TIMEOUT" });

    expect(attemptSignal?.aborted, "整请求超时也要 abort").toBe(true);
  });

  it("正常完成的请求不受影响（abortNetwork 不能在成功路径上误触发）", async () => {
    let attemptSignal: AbortSignal | undefined;
    // `DEFAULT_API` 是 `anthropic-messages`，所以正常收尾要按 Anthropic 的 SSE 形状写。
    const frames: [string, Record<string, unknown>][] = [
      ["message_start", { type: "message_start", message: { id: "m1", role: "assistant", content: [], model: "m", stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      if (text.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
      attemptSignal = init?.signal ?? undefined;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const adapter = buildAdapter({ fetchImpl });
    const chunks: StreamChunk[] = [];
    for await (const chunk of adapter.stream(REQUEST) as AsyncIterable<StreamChunk>) chunks.push(chunk);

    expect(chunks.at(-1), "正常收尾").toMatchObject({ type: "finish", reason: { kind: "stop" } });
    expect(attemptSignal?.aborted, "成功路径不该 abort").toBe(false);
  });

  it("调用方取消同样会 abort 底层网络", async () => {
    let attemptSignal: AbortSignal | undefined;
    const caller = new AbortController();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const text = String(url);
      if (text.includes("models.dev")) return new Response("{}", { status: 500 });
      if (text.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
      attemptSignal = init?.signal ?? undefined;
      return hangingSse();
    }) as unknown as typeof fetch;

    const adapter = buildAdapter({ fetchImpl, requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10_000 });
    const pumping = (async () => {
      for await (const _chunk of adapter.stream({ ...REQUEST, signal: caller.signal }) as AsyncIterable<StreamChunk>) {
        // 等取消
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 60));
    caller.abort();
    await expect(pumping).rejects.toMatchObject({ code: "ABORTED" });
    expect(attemptSignal?.aborted, "取消也要停掉底层网络").toBe(true);
  });
});
