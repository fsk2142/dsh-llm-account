import { expect, it } from "vitest";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { buildPiModel, streamOpencode, toPiContext } from "../../src/vendors/opencode/protocol";
import type { RequestImageBytes } from "../../src/core/image-projection";

type Api = "anthropic-messages" | "openai-completions" | "openai-responses";
const id = AttachmentId("sha256:" + "d".repeat(64));
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const images = new Map<string, RequestImageBytes>([[id, { attachmentId: id, mediaType: "image/png", data: bytes }]]);
function response(api: Api): Response {
  let events: Record<string, unknown>[];
  if (api === "anthropic-messages") events = [
    { type: "message_start", message: { id: "msg1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "summary" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  else if (api === "openai-completions") events = [
    { id: "chat1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "summary" }, finish_reason: null }] },
    { id: "chat1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ];
  else {
    const item = { id: "msg1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "summary", annotations: [] }] };
    events = [
      { type: "response.created", response: { id: "resp1", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "summary" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "resp1", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } },
    ];
  }
  return new Response(events.map(event => `${api === "openai-completions" ? "" : `event: ${event.type}\n`}data: ${JSON.stringify(event)}\n\n`).join("") + (api === "openai-completions" ? "data: [DONE]\n\n" : ""), { headers: { "content-type": "text/event-stream" } });
}
for (const api of ["anthropic-messages", "openai-completions", "openai-responses"] as const) {
  for (const purpose of [undefined, "compaction", "session-title"] as const) {
    it(`${api}: ${purpose ?? "conversation"} summarizes assistant image history on a text-only model`, async () => {
      const options: GenerateOptions = { provider: "dsh-opencode-go", model: "m", ...(purpose === undefined ? {} : { purpose }), messages: [
        createUserMessage({ content: [{ type: "text", text: "Generate a diagram" }], source: { kind: "user" } }),
        createAssistantMessage({ content: [{ type: "text", text: "Prior answer" }, { type: "image", attachment: { attachmentId: id, mediaType: "image/png", bytes: bytes.length, width: 1, height: 1, name: "history.png" } }], source: { provider: "image-generator", model: "image-m" } }),
        createUserMessage({ content: [{ type: "text", text: "Summarize this history" }], source: { kind: "user" } }),
      ] };
      let body = "";
      const chunks: StreamChunk[] = [];
      for await (const chunk of streamOpencode({
        model: buildPiModel({ id: "m", name: "M", api, reasoning: false, inputModalities: ["text"] }, "https://example.test/v1"),
        context: toPiContext(options, images), apiKey: "fake-key", fetchImpl: (async (_url, init) => { body = String(init?.body); return response(api); }) as typeof fetch,
      })) chunks.push(chunk);
      expect(body).toContain("Prior answer");
      expect(body).toContain("历史 assistant 图片");
      expect(body).toContain("未内联");
      // **不再发送内部 attachmentId**（2026-11-05 外部审查 F10）：它既不能帮模型
      // 读到图，又白吃 prompt，还把宿主内部标识抖给上游。
      expect(body).not.toContain(id);
      expect(body).not.toContain(Buffer.from(bytes).toString("base64"));
      expect(chunks.filter(chunk => chunk.type === "text-delta").map(chunk => chunk.type === "text-delta" ? chunk.text : "").join("")).toBe("summary");
      expect(chunks).toContainEqual(expect.objectContaining({ type: "finish", reason: { kind: "stop" } }));
    });
  }
}
