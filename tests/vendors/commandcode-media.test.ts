import { describe, expect, it } from "vitest";
import type { GenerateOptions, RequestMessage } from "@deepseek-ai/dsh-llm";
import { buildRequestBody } from "../../src/vendors/commandcode/protocol";
import type { RequestImageBytes } from "../../src/core/image-projection";

const image = (state: "bytes" | "offloaded" | "missing" = "bytes") => ({
  type: "image", attachment: { attachmentId: "sha256:image", mediaType: "image/png", bytes: 4, width: 1, height: 1 },
  ...(state === "offloaded" ? { offloaded: true } : {}),
});
const file = { type: "file", attachment: { attachmentId: "sha256:1234567890", name: "report.txt", mediaType: "text/plain", bytes: 7 } };
const images: ReadonlyMap<string, RequestImageBytes> = new Map([["sha256:image", {
  attachmentId: "sha256:image", mediaType: "image/png", data: Uint8Array.from([137, 80, 78, 71]),
}]]);
const text = { type: "text", text: "result text" };
const protocols = ["openai", "messages", "cli"] as const;
function request(protocol: typeof protocols[number], messages: unknown[], state: "bytes" | "offloaded" | "missing" = "bytes", purpose?: GenerateOptions["purpose"]): any {
  const body = buildRequestBody(protocol, { provider: "commandcode", model: "fixture", messages, ...(purpose === undefined ? {} : { purpose }) } as GenerateOptions,
    { maxTokens: 32, systemText: "" }, state === "missing" ? undefined : images) as any;
  return protocol === "cli" ? body.params : body;
}
function calls(): RequestMessage {
  return { role: "assistant", content: [
    { type: "tool-call", id: "call-1", name: "capture", arguments: "{}" },
    { type: "tool-call", id: "call-2", name: "capture", arguments: "{}" },
  ] } as unknown as RequestMessage;
}

describe.each(protocols)("CommandCode %s preserves media through the complete request body", (protocol) => {
  it.each(["bytes", "offloaded", "missing"] as const)("user image (%s) keeps bytes or an explicit placeholder", (state) => {
    const body = request(protocol, [{ role: "user", content: [text, file, image(state)] }], state);
    const serialized = JSON.stringify(body.messages);
    expect(serialized).toContain("result text");
    expect(serialized).toContain("report.txt");
    if (state === "bytes") {
      expect(serialized).toContain("iVBORw==");
      expect(serialized).toContain(protocol === "messages" ? '"type":"image"' : '"type":"image_url"');
    } else {
      expect(serialized).toContain(state === "offloaded" ? "已卸载" : "未能发送");
      expect(serialized).not.toContain("iVBORw==");
    }
  });

  it.each(["bytes", "offloaded", "missing"] as const)("tool images (%s) preserve both results and legal message ordering", (state) => {
    const body = request(protocol, [calls(),
      { role: "tool", toolCallId: "call-1", content: [text, file, image(state)], isError: true },
      { role: "tool", toolCallId: "call-2", content: [image(state)] },
      { role: "assistant", content: [{ type: "text", text: "analysis after images" }] },
    ], state);
    const serialized = JSON.stringify(body.messages);
    expect(serialized).toContain("result text");
    expect(serialized).toContain("report.txt");
    if (protocol === "messages") {
      const results = body.messages.flatMap((message: any) => message.content ?? []).filter((block: any) => block.type === "tool_result");
      expect(results.map((result: any) => result.tool_use_id)).toEqual(["call-1", "call-2"]);
      expect(results[0].is_error).toBe(true);
      expect(results.every((result: any) => Array.isArray(result.content))).toBe(true);
      if (state === "bytes") expect(results[1].content[0].type).toBe("image");
    } else {
      const results = body.messages.filter((message: any) => message.role === "tool");
      expect(results.map((result: any) => result.tool_call_id)).toEqual(["call-1", "call-2"]);
      expect(results.every((result: any) => typeof result.content === "string" && result.content.length > 0)).toBe(true);
      const resultIndexes = body.messages.map((message: any, index: number) => message.role === "tool" ? index : -1).filter((index: number) => index >= 0);
      const imageUserIndex = body.messages.findIndex((message: any) => message.role === "user" && JSON.stringify(message.content).includes("image_url"));
      if (state === "bytes") {
        expect(imageUserIndex).toBe(Math.max(...resultIndexes) + 1);
        expect(body.messages[imageUserIndex + 1].role).toBe("assistant");
      } else expect(imageUserIndex).toBe(-1);
    }
    if (state === "bytes") expect(serialized).toContain("iVBORw==");
    else {
      expect(serialized).toContain(state === "offloaded" ? "已卸载" : "未能发送");
      expect(serialized).not.toContain("iVBORw==");
    }
  });

  for (const purpose of [undefined, "compaction", "session-title"] as const) {
    it.each(["bytes", "offloaded", "missing"] as const)(`assistant history image (%s) for ${purpose ?? "chat"} preserves text and an image placeholder`, (state) => {
      const body = request(protocol, [{ role: "assistant", content: [text, file, image(state)] }], state, purpose);
      const serialized = JSON.stringify(body.messages);
      expect(serialized).toContain("result text");
      expect(serialized).toContain("report.txt");
      // 占位仍说明「这里原本有图」，但**不带内部 attachmentId**（2026-11-05 外部审查 F10）。
      expect(serialized).toContain("历史 assistant 图片");
      expect(serialized).not.toContain("sha256:image");
      expect(serialized).not.toContain("iVBORw==");
      expect(serialized).not.toContain("image_url");
      expect(serialized).not.toContain('"type":"image"');
    });
    it.each(["system", "developer"] as const)(`%s images remain explicitly unsupported for ${purpose ?? "chat"}`, (role) => {
      expect(() => request(protocol, [{ role, content: [text, image()] }], "bytes", purpose)).toThrow(
        expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }),
      );
    });
  }
  it("pure assistant history images stay visible as a placeholder during compaction", () => {
    const body = request(protocol, [{ role: "assistant", content: [image()] }], "bytes", "compaction");
    expect(body.messages).toHaveLength(1);
    expect(JSON.stringify(body.messages[0])).toContain("历史 assistant 图片");
    expect(JSON.stringify(body.messages[0])).not.toContain("sha256:image");
    expect(JSON.stringify(body.messages[0])).not.toContain("iVBORw==");
  });

  it.each(["user", "tool", "assistant", "system", "developer"] as const)("%s file retains the host file handle", (role) => {
    const message = { role, ...(role === "tool" ? { toolCallId: "call-1" } : {}), content: [text, file] };
    const body = request(protocol, [message]);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("report.txt");
    expect(serialized).toContain("7 bytes");
    expect(serialized).toContain("12345678");
    expect(serialized).toContain("cannot access a readable path");
  });

  it.each(["user", "tool", "assistant", "system", "developer"] as const)("%s malformed file fails explicitly", (role) => {
    expect(() => request(protocol, [{ role, toolCallId: "call-1", content: [{ type: "file", attachment: {} }] }])).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_CONTENT" }),
    );
  });
});
