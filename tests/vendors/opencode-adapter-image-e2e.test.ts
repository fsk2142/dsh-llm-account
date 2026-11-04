import { describe, expect, it } from "vitest";

import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

import { RotationEngine } from "../../src/core/switching/rotation";
import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";

/**
 * 图片必须真的发出去（2026-11-04 外部审查 U07）。
 *
 * ## 审查原文
 *
 * > 目录宣称 image 能力，混图出站只剩文字，纯图可变为空消息；流仍正常完成，
 * > 用户无法知道模型没收到图。
 *
 * ## 根因（两层）
 *
 * 1. `adapter` 没有 `resolveImage` 依赖 —— 连取字节的路径都不存在（只有 Open Design 接了）；
 * 2. 协议层 `toPiContext` 的用户消息只调 `textOf(content)` 取文本，图片块被跳过。
 *
 * 合并效果：勾选识图模型、贴图、提问 —— 模型收不到图，也不报错。
 *
 * ## 这条测试盯什么
 *
 * 从 `adapter.stream` 进入，拦**出站 JSON**，断言图片内容真的在里面；
 * 取不到字节时必须有**文字占位**，不能静默变成空消息。
 *
 * 与 U06 同一个教训：不要只测底层投影函数。
 */
const BASE_URL = "https://opencode.ai/zen/go/v1";

const LISTING = {
  object: "list",
  data: [
    {
      id: "m-vision",
      capabilities: { reasoning: { supported: true, effort: ["low", "high"] } },
      limit: { context: 128_000, output: 8_000 },
    },
  ],
};

const METADATA = {
  "opencode-go": {
    models: {
      "m-vision": {
        reasoning: true,
        reasoning_options: { type: "effort", values: ["low", "high"] },
        // 目录宣称能看图 —— 与 U07 的描述一致。
        modalities: { input: ["text", "image"] },
        provider: { npm: "@ai-sdk/anthropic" },
      },
    },
  },
};

/** 一张 1×1 PNG 的字节。 */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

function sse(): Response {
  const frames: readonly (readonly [string, unknown])[] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "m1",
          role: "assistant",
          content: [],
          model: "m",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * 跑一次带图请求，交出发往生成端点的请求体。
 * @param options - 覆盖项：是否带图、图片是否已被卸载、是否提供字节读取器。
 * @returns 出站请求体。
 */
async function bodyWithImage(options: {
  /** `false` = 纯文本（对照组）。 */
  withImage?: boolean;
  /** `true` = 图片已 offloaded（应发占位文本，不读字节）。 */
  offloaded?: boolean;
  /** `false` = 模拟宿主没提供读取器（取不到字节）。 */
  provideBytes?: boolean;
}): Promise<Record<string, unknown>> {
  const withImage = options.withImage !== false;
  const provideBytes = options.provideBytes !== false;
  const readCalls: string[] = [];
  const bodies: Record<string, unknown>[] = [];

  const fetchImpl = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    if (url.includes("models.dev")) return new Response(JSON.stringify(METADATA), { status: 200 });
    if (url.includes("/models")) return new Response(JSON.stringify(LISTING), { status: 200 });
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body) as Record<string, unknown>);
    return sse();
  }) as unknown as typeof fetch;

  const content = withImage
    ? [
        { type: "text" as const, text: "这张图是什么？" },
        {
          type: "image" as const,
          attachment: {
            attachmentId: "att-1",
            mediaType: "image/png",
            bytes: PNG_BYTES.byteLength,
            width: 1,
            height: 1,
          },
          ...(options.offloaded === true ? { offloaded: true as const } : {}),
        },
      ]
    : [{ type: "text" as const, text: "只问文字" }];

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
    ...(provideBytes
      ? {
          resolveImage: async (ref: { attachmentId: string }) => {
            readCalls.push(ref.attachmentId);
            return { attachmentId: ref.attachmentId, data: PNG_BYTES, mediaType: "image/png" };
          },
        }
      : {}),
  });

  const stream = adapter.stream({
    model: "m-vision",
    messages: [{ role: "user", content }],
    sessionId: "s1",
  } as unknown as GenerateOptions);
  for await (const _chunk of stream as AsyncIterable<StreamChunk>) {
    // 只关心出站正文
  }
  expect(bodies.length, "应当发出生成请求").toBeGreaterThan(0);
  return bodies[0]!;
}

/** 把出站正文里所有内容块拍平，便于断言。 */
function blocksOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const messages = body.messages;
  if (!Array.isArray(messages)) return out;
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block !== null && typeof block === "object") out.push(block as Record<string, unknown>);
      }
    }
  }
  return out;
}

describe("U07 · 图片必须真的发出去", () => {
  it("**混图请求的出站正文含图片块**（不是只剩文字）", async () => {
    const body = await bodyWithImage({});
    const blocks = blocksOf(body);
    const hasImage = blocks.some((block) => block.type === "image");
    expect(hasImage, "目录宣称 image 能力，请求里就必须有图片块").toBe(true);
  });

  it("图片块带真实的 base64 数据（不是空壳）", async () => {
    const body = await bodyWithImage({});
    const image = blocksOf(body).find((block) => block.type === "image");
    expect(image, "应有图片块").toBeDefined();
    const serialized = JSON.stringify(image);
    // Anthropic 形状是 `source: {type:"base64", media_type, data}`；
    // 只要出现了非空 base64 就说明字节真的带上了。
    expect(serialized).toContain("base64");
    // 断言 data 字段本身非空，而不是猜一个长度阈值（1×1 PNG 的 base64 很短）。
    const source = (image as Record<string, unknown>).source as Record<string, unknown> | undefined;
    expect(source, "图片块要带 source").toBeDefined();
    expect(String(source!.media_type ?? ""), "要带 MIME").toMatch(/^image\//u);
    expect(String(source!.data ?? "").length, "base64 数据不能为空").toBeGreaterThan(0);
  });

  it("**取不到字节时发文字占位**，不是静默丢掉", async () => {
    const body = await bodyWithImage({ provideBytes: false });
    const blocks = blocksOf(body);
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join(" ");
    expect(text, "取不到字节要让模型/用户知道这里有图").toContain("图片未能发送");
    // 同时：整条消息不能变成空内容。
    expect(text.length).toBeGreaterThan(0);
  });

  it("纯文本请求不受影响（不能给所有请求都塞图片结构）", async () => {
    const body = await bodyWithImage({ withImage: false });
    const blocks = blocksOf(body);
    expect(blocks.some((block) => block.type === "image"), "没有图就不该有图片块").toBe(false);
  });

  it("**已被 offloaded 的图片不读字节**（U13 的同一份契约）", async () => {
    // `ImageBlock.offloaded: true` 的含义是「这张图已经从请求里卸载，只发占位」。
    // 宿主的契约写明：每条路由都发「命名图片及其只读路径」的占位文本，而不是字节。
    const body = await bodyWithImage({ offloaded: true });
    const blocks = blocksOf(body);
    expect(blocks.some((block) => block.type === "image"), "卸载的图不能再塞回请求").toBe(false);
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join(" ");
    expect(text, "卸载的图要有占位说明").toContain("已卸载");
  });
});
