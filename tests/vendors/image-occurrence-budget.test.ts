import { describe, expect, it } from "vitest";
import type { ContentBlock, GenerateOptions, RequestMessage } from "@deepseek-ai/dsh-llm";
import { collectImageBytes, type ImageRefLike, type RequestImageBytes } from "../../src/core/image-projection";
import { buildRequestBody as commandCodeBody } from "../../src/vendors/commandcode/protocol";
import { toPiContext } from "../../src/vendors/opencode/protocol";
import { buildRequestBody as openDesignBody } from "../../src/vendors/opendesign/protocol";

interface ProjectedMessage {
  role: string;
  content: unknown;
}

const facts = { maxTokens: 32, systemText: "" };
const request = (messages: RequestMessage[]): GenerateOptions => ({ provider: "test", model: "fixture", messages });
const image = (id: string): ContentBlock => ({ type: "image", attachment: { attachmentId: id } }) as unknown as ContentBlock;
const user = (...content: ContentBlock[]): RequestMessage => ({ role: "user", content });
const resolve = async (ref: ImageRefLike): Promise<RequestImageBytes> => ({
  attachmentId: ref.attachmentId, data: Uint8Array.of(1, 2, 3, 4), mediaType: "image/png",
});
const projects: Record<string, (options: GenerateOptions, images: ReadonlyMap<string, RequestImageBytes>) => readonly ProjectedMessage[]> = {
  commandcode: (options, images) => (commandCodeBody("openai", options, facts, images) as { messages: ProjectedMessage[] }).messages,
  "commandcode/messages": (options, images) => (commandCodeBody("messages", options, facts, images) as { messages: ProjectedMessage[] }).messages,
  "commandcode/cli": (options, images) => (commandCodeBody("cli", options, facts, images) as { params: { messages: ProjectedMessage[] } }).params.messages,
  opencode: (options, images) => toPiContext(options, images).messages as ProjectedMessage[],
  opendesign: (options, images) => (openDesignBody(options, facts, images) as { messages: ProjectedMessage[] }).messages,
};

function partsOf(messages: readonly ProjectedMessage[]): unknown[] {
  return messages.flatMap((message) => Array.isArray(message.content) ? message.content : [message.content]);
}

function inlineCount(messages: readonly ProjectedMessage[]): number {
  return partsOf(messages).filter((part) => part !== null && typeof part === "object" && "type" in part && (part.type === "image" || part.type === "image_url")).length;
}

describe.each(Object.keys(projects))("%s outbound image occurrences", (provider) => {
  const project = projects[provider]!;
  it("counts repeated references against the count budget while reusing decoded bytes", async () => {
    const sharedImage = image("A");
    // Reuse the exact same block and array in more than one message.
    const sameMessage = user(sharedImage, sharedImage);
    const options = request([sameMessage, sameMessage]);
    const reads: string[] = [];
    const { images } = await collectImageBytes(options.messages, async (ref) => {
      reads.push(ref.attachmentId);
      return resolve(ref);
    }, undefined, { maxCount: 2 });
    const messages = project(options, images);
    expect(inlineCount(messages)).toBe(2);
    expect(reads).toEqual(["A"]);
    expect(JSON.stringify(messages)).toMatch(/预算|上限/);
    expect(sameMessage.content).toEqual([sharedImage, sharedImage]);
  });

  it("charges the bytes for each outbound occurrence", async () => {
    const options = request([user(image("A"), image("A"), image("A"))]);
    const { images } = await collectImageBytes(options.messages, resolve, undefined, { maxBytes: 8 });
    expect(inlineCount(project(options, images))).toBe(2);
  });

  it("prioritizes the latest occurrence even if the attachment first appeared earlier", async () => {
    const options = request([user(image("A")), user(image("B")), user(image("A"))]);
    const { images } = await collectImageBytes(options.messages, resolve, undefined, { maxCount: 1 });
    expect([...images.keys()]).toEqual(["A"]);
    const parts = partsOf(project(options, images));
    expect(inlineCount(project(options, images))).toBe(1);
    expect(parts.at(-1)).toMatchObject({ type: expect.stringMatching(/^image(_url)?$/) });
  });
});

it("Open Design sends every tool result before appending images across skipped developer messages", async () => {
  const options = request([
    { role: "assistant", content: [{ type: "tool-call", id: "first", name: "capture", arguments: "{}" }, { type: "tool-call", id: "second", name: "capture", arguments: "{}" }] },
    { role: "tool", toolCallId: "first", content: [image("A")] },
    { role: "developer", content: [{ type: "text", text: "tool metadata changed" }] },
    { role: "tool", toolCallId: "second", content: [{ type: "text", text: "second result" }] },
  ] as unknown as RequestMessage[]);
  const { images } = await collectImageBytes(options.messages, resolve);
  const messages = projects.opendesign!(options, images);
  expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "tool", "user"]);
  expect(inlineCount(messages)).toBe(1);
});
