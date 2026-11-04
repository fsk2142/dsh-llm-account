import { expect, it } from "vitest";
import { createAssistantMessage, createDeveloperMessage, createMessage, createToolResultMessage, createUserMessage, ToolCallId } from "@deepseek-ai/dsh-llm";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import type { ContentBlock, GenerateOptions } from "@deepseek-ai/dsh-llm";
import { buildPiModel, streamOpencode, toPiContext } from "../../src/vendors/opencode/protocol";
import type { RequestImageBytes } from "../../src/core/image-projection";

const attachment = { attachmentId: AttachmentId("sha256:" + "a".repeat(64)), mediaType: "image/png" as const, bytes: 68, width: 1, height: 1 };
const image: Extract<ContentBlock, { type: "image" }> = { type: "image", attachment };
const file: Extract<ContentBlock, { type: "file" }> = { type: "file", attachment: { attachmentId: AttachmentId("sha256:" + "b".repeat(64)), name: "report.pdf", bytes: 100 } };
const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const images = new Map<string, RequestImageBytes>([[attachment.attachmentId, { attachmentId: attachment.attachmentId, mediaType: "image/png", data }]]);
const base64 = Buffer.from(data).toString("base64");
function request(user: readonly ContentBlock[], tool: readonly ContentBlock[]): GenerateOptions {
  return { provider: "dsh-opencode-go", model: "m", messages: [
    createUserMessage({ content: user, source: { kind: "user" } }),
    createAssistantMessage({ content: [{ type: "tool-call", id: ToolCallId("call1"), name: "inspect", arguments: "{}" }], source: { provider: "dsh-opencode-go", model: "m" } }),
    createToolResultMessage({ callId: ToolCallId("call1"), content: tool, isError: true }),
  ] };
}
async function outbound(api: "anthropic-messages" | "openai-completions" | "openai-responses", options: GenerateOptions, bytes = images) {
  let body: Record<string, unknown> | undefined;
  const stream = streamOpencode({
    model: buildPiModel({ id: "m", name: "M", api, reasoning: false, inputModalities: ["text", "image"] }, "https://example.test/v1"),
    context: toPiContext(options, bytes), apiKey: "fake-key",
    fetchImpl: (async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ error: { message: "request capture complete" } }), { status: 400, headers: { "content-type": "application/json" } }); }) as typeof fetch,
  });
  try { for await (const _chunk of stream) {} } catch { /* The SDK received a deliberate terminal fake response. */ }
  expect(body).toBeDefined(); return body!;
}

it("real tool-role messages retain their call identity, outcome and mixed image/file content", () => {
  const context = toPiContext(request([{ type: "text", text: "inspect" }], [{ type: "text", text: "result" }, image, file]), images);
  const tool = context.messages.find(message => message.role === "toolResult");
  expect(tool).toMatchObject({ role: "toolResult", toolCallId: "call1", toolName: "inspect", isError: true });
  expect(tool?.content).toContainEqual({ type: "image", mimeType: "image/png", data: base64 });
  expect(JSON.stringify(tool?.content)).toContain("report.pdf");
});

for (const api of ["anthropic-messages", "openai-completions", "openai-responses"] as const) {
  it(`${api}: the actual SDK sends user AND tool images with file handles`, async () => {
    const body = await outbound(api, request([image, file], [{ type: "text", text: "tool-result-text" }, image, file]));
    const text = JSON.stringify(body);
    expect(text.split(base64).length - 1).toBe(2);
    expect(text.split("report.pdf").length - 1).toBe(2);
    expect(text).toContain("tool-result-text");
    expect(text).toContain("call1");
    if (api === "anthropic-messages") expect(text).toContain('"is_error":true');
    if (api === "openai-completions") expect(text).toContain('"image_url"');
    if (api === "openai-responses") expect(text).toContain('"input_image"');
  });
}

it("tool offloaded/missing images are explicit text and never disappear or resend bytes", async () => {
  const context = toPiContext(request([{ type: "text", text: "inspect" }], [{ ...image, offloaded: true }, { ...image, attachment: { ...attachment, attachmentId: AttachmentId("sha256:" + "c".repeat(64)) } }]), images);
  const tool = context.messages.find(message => message.role === "toolResult");
  expect(JSON.stringify(tool)).toContain("图片已卸载");
  expect(JSON.stringify(tool)).toContain("图片未能发送");
  expect(JSON.stringify(tool)).not.toContain(base64);
});

it("system and developer files become handles instead of disappearing", () => {
  const options = request([], []);
  const context = toPiContext({ ...options, messages: [createMessage({ role: "system", content: [file], source: { kind: "system-prompt" } }), createDeveloperMessage({ content: [file], source: { kind: "user" } })] });
  expect((context.systemPrompt ?? "").split("report.pdf").length - 1).toBe(2);
});

it("an assistant history image becomes an explicit text record without resending its bytes", () => {
  const options = request([], []);
  const context = toPiContext({ ...options, messages: [createAssistantMessage({ content: [image], source: { provider: "dsh-opencode-go", model: "m" } })] }, images);
  expect(JSON.stringify(context)).toContain(attachment.attachmentId);
  expect(JSON.stringify(context)).not.toContain(base64);
});

it("an SDK route that cannot take images rejects before sending a request", () => {
  expect(() => streamOpencode({ model: buildPiModel({ id: "m", name: "M", api: "openai-completions", reasoning: false, inputModalities: ["text"] }, "https://example.test/v1"), context: toPiContext(request([image], []), images), apiKey: "fake", fetchImpl: (() => { throw Error("must not fetch"); }) as typeof fetch })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }));
});
