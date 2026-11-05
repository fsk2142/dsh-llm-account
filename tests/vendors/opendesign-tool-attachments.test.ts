import { expect, it } from "vitest";
import type { GenerateOptions, RequestMessage } from "@deepseek-ai/dsh-llm";
import { buildRequestBody } from "../../src/vendors/opendesign/protocol";

const image = { type: "image", attachment: { attachmentId: "shot", mediaType: "image/png", bytes: 3, width: 1, height: 1 } };
const file = { type: "file", attachment: { attachmentId: "doc", name: "report.pdf", bytes: 42 } };
const images = new Map([["shot", { attachmentId: "shot", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }]]);
const project = (messages: unknown[]) => buildRequestBody({ provider: "opendesign", model: "vision", messages: messages as RequestMessage[] } as GenerateOptions, { maxTokens: 100, systemText: "" }, images) as { messages: Record<string, unknown>[] };

it("keeps consecutive tool results adjacent, followed by their image bytes and call identities", () => {
  const body = project([
    { role: "assistant", content: ["one", "two"].map((id) => ({ type: "tool-call", id, name: "read", arguments: "{}" })) },
    { role: "tool", toolCallId: "one", content: [image] },
    { role: "tool", toolCallId: "two", content: [{ type: "text", text: "second" }, image] },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ]);
  expect(body.messages.map((message) => message.role)).toEqual(["assistant", "tool", "tool", "user", "assistant"]);
  expect(body.messages.slice(1, 3).map((message) => message.tool_call_id)).toEqual(["one", "two"]);
  expect(body.messages.slice(1, 3).every((message) => typeof message.content === "string" && message.content.length > 0)).toBe(true);
  expect(JSON.stringify(body.messages[3])).toContain("data:image/png;base64,AQID");
  expect(JSON.stringify(body.messages[3])).toContain("one");
  expect(JSON.stringify(body.messages[3])).toContain("two");
});

it.each(["user", "tool", "assistant"])("does not silently drop %s file attachments", (role) => {
  const body = project([{ role, toolCallId: "one", content: [{ type: "text", text: "before" }, file, { type: "text", text: "after" }] }]);
  const wire = JSON.stringify(body);
  expect(wire).toContain("report.pdf");
  expect(wire).toContain("42");
  expect(wire).not.toContain("data:application/pdf");
});

it("preserves file handles mixed with user images and text", () => {
  const body = project([{ role: "user", content: [{ type: "text", text: "look" }, image, file] }]);
  const wire = JSON.stringify(body);
  expect(wire).toContain("look");
  expect(wire).toContain("report.pdf");
  expect(wire).toContain("data:image/png;base64,AQID");
});

it.each([false, true])("keeps missing or offloaded tool images visible without sending bytes (offloaded=%s)", (offloaded) => {
  const attachment = offloaded ? image.attachment : { ...image.attachment, attachmentId: "unavailable" };
  const body = project([{ role: "tool", toolCallId: "one", content: [{ ...image, attachment, ...(offloaded ? { offloaded: true } : {}) }] }]);
  expect(body.messages.map((message) => message.role)).toEqual(["tool", "user"]);
  const wire = JSON.stringify(body);
  expect(wire).toContain(offloaded ? "shot" : "unavailable");
  expect(wire).not.toContain("image_url");
});

it.each([undefined, "compaction", "session-title"])("preserves assistant image history as text for purpose %s", (purpose) => {
  const body = buildRequestBody({ provider: "opendesign", model: "vision", ...(purpose === undefined ? {} : { purpose }), messages: [
    { role: "assistant", content: [{ type: "text", text: "historical text" }, image] },
    { role: "user", content: [{ type: "text", text: "continue" }] },
  ] } as unknown as GenerateOptions, { maxTokens: 100, systemText: "" }, images) as { messages: Record<string, unknown>[] };
  expect(body.messages.map((message) => message.role)).toEqual(["assistant", "user"]);
  expect(body.messages[0]?.content).toContain("historical text");
  // 占位在，但**不带内部 attachmentId**（2026-11-05 外部审查 F10）。
  expect(body.messages[0]?.content).toContain("历史 assistant 图片");
  expect(body.messages[0]?.content).not.toContain("shot");
  expect(JSON.stringify(body)).not.toContain("data:image");
  expect(JSON.stringify(body)).not.toContain("image_url");
});

it.each(["system", "developer"])("preserves raw %s file handles alongside the supplied system text", (role) => {
  const body = buildRequestBody({ provider: "opendesign", model: "vision", messages: [{ role, content: [file] }] } as unknown as GenerateOptions, { maxTokens: 100, systemText: "existing system instructions" }, images) as { messages: Record<string, unknown>[] };
  expect(body.messages[0]?.role).toBe("system");
  expect(body.messages[0]?.content).toContain("existing system instructions");
  expect(body.messages[0]?.content).toContain("report.pdf");
  expect(body.messages[0]?.content).toContain("42");
});
