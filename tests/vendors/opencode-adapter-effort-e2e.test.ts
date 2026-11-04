import { describe, expect, it } from "vitest";

import { ReasoningEffortId, type GenerateOptions, type StreamChunk } from "@deepseek-ai/dsh-llm";

import { RotationEngine } from "../../src/core/switching/rotation";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";

// 目录只允许 opencode.ai 域（`assertOpencodeBase`）。用假域名会让整个目录读取失败，
// 于是 resolveModel 拿不到档位、宿主也不会把 reasoningEffort 传给 adapter —— 测试就测了个空。
const BASE_URL = "https://opencode.ai/zen/go/v1";

const LISTING = {
  object: "list",
  data: [
    {
      id: "m-anthropic",
      capabilities: { reasoning: { supported: true, effort: ["low", "high", "max"] } },
      limit: { context: 128_000, output: 8_000 },
    },
    {
      id: "m-openai",
      capabilities: { reasoning: { supported: true, effort: ["low", "high", "max"] } },
      limit: { context: 128_000, output: 8_000 },
    },
  ],
};

const METADATA = {
  "opencode-go": {
    models: {
      // `reasoning` 与 `reasoning_options` 都从 models.dev 来；缺了它们 buildPiModel
      // 会拿到 reasoning:false，两条协议都不会去读档位。
      "m-openai": {
        reasoning: true,
        reasoning_options: { type: "effort", values: ["low", "high", "max"] },
        provider: { npm: "@ai-sdk/openai-compatible" },
      },
      "m-anthropic": {
        reasoning: true,
        reasoning_options: { type: "effort", values: ["low", "high", "max"] },
        provider: { npm: "@ai-sdk/anthropic" },
      },
    },
  },
};

function sse(api: "anthropic-messages" | "openai-completions"): Response {
  if (api === "anthropic-messages") {
    const frames = [
      ["message_start", { type: "message_start", message: { id: "m1", role: "assistant", content: [], model: "m", stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const body =
    'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n' +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function request(model: string): GenerateOptions {
  return { model, messages: [{ role: "user", content: "hi" }], sessionId: "s1" } as unknown as GenerateOptions;
}

async function bodiesFor(model: string, effort: string | undefined): Promise<Record<string, unknown>[]> {
  const isAnthropic = model === "m-anthropic";
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.includes("models.dev")) return new Response(JSON.stringify(METADATA), { status: 200 });
    if (url.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return sse(isAnthropic ? "anthropic-messages" : "openai-completions");
  }) as unknown as typeof fetch;

  const adapter = createOpencodeAdapter({
    config: () => ({ apiBase: BASE_URL }),
    rotation: new RotationEngine({ order: ["a"], rules: [], pinned: null }),
    quota: {
      snapshot: async () => ({ windows: [], failures: [] }),
      record: async () => {},
      read: async () => undefined,
    } as never,
    accounts: {
      list: async () => [{ ref: "a", label: "A", apiKeyEnv: "A" }],
      activeRefOf: () => "a",
    } as never,
    fetchImpl,
    resolveStored: async () => "sk-a",
  });

  const stream = adapter.stream({
    ...request(model),
    ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
  } as GenerateOptions);
  for await (const _chunk of stream as AsyncIterable<StreamChunk>) {
    // 只关心出站正文
  }
  return bodies;
}

function effortOf(body: Record<string, unknown>): unknown {
  if (body.reasoning_effort !== undefined) return body.reasoning_effort;
  const outputConfig = body.output_config;
  if (outputConfig !== null && typeof outputConfig === "object") {
    return (outputConfig as Record<string, unknown>).effort;
  }
  return undefined;
}

describe("U06 · anthropic-messages 协议", () => {
  for (const level of ["low", "high", "max"] as const) {
    it(`选中「${level}」→ 出站 output_config.effort: ${level}`, async () => {
      const bodies = await bodiesFor("m-anthropic", level);
      expect(bodies.length, "应当发出生成请求").toBeGreaterThan(0);
      expect(effortOf(bodies[0]!), "anthropic 靠 output_config.effort；缺 forceAdaptiveThinking 会整段消失").toBe(level);
    });
  }

  it("不选档位时不带 output_config.effort（不编默认值）", async () => {
    const bodies = await bodiesFor("m-anthropic", undefined);
    expect(bodies.length).toBeGreaterThan(0);
    expect(effortOf(bodies[0]!), "没选就不该有 effort").toBeUndefined();
  });
});

describe("U06 · openai-completions 协议", () => {
  for (const level of ["low", "high", "max"] as const) {
    it(`选中「${level}」→ 出站 reasoning_effort: ${level}`, async () => {
      const bodies = await bodiesFor("m-openai", level);
      expect(bodies.length, "应当发出生成请求").toBeGreaterThan(0);
      expect(bodies[0]!.reasoning_effort, "openai 靠顶层 reasoning_effort").toBe(level);
    });
  }

  it("不选档位时不带 reasoning_effort", async () => {
    const bodies = await bodiesFor("m-openai", undefined);
    expect(bodies.length).toBeGreaterThan(0);
    expect("reasoning_effort" in bodies[0]!).toBe(false);
  });
});

describe("U06 · 三条档位不能塌成同一个值", () => {
  it("anthropic 线三档互不相同", async () => {
    const seen = await Promise.all(
      (["low", "high", "max"] as const).map(async (level) => effortOf((await bodiesFor("m-anthropic", level))[0]!)),
    );
    expect(seen).toEqual(["low", "high", "max"]);
    expect(new Set(seen).size, "被 clamp 成同一个值就说明映射没生效").toBe(3);
  });

  it("openai 线三档互不相同", async () => {
    const seen = await Promise.all(
      (["low", "high", "max"] as const).map(
        async (level) => (await bodiesFor("m-openai", level))[0]!.reasoning_effort,
      ),
    );
    expect(seen).toEqual(["low", "high", "max"]);
    expect(new Set(seen).size).toBe(3);
  });
});
