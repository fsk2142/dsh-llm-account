/**
 * 图片发送（2026-10-20）：`ImageBlock` → OpenAI `image_url`。
 *
 * ## 原来的问题
 *
 * 三家的 `openAiMessages` 都用 `textOf()` 只拼文本块，**图片块被静默丢弃** ——
 * 用户发了图，模型什么都没收到，也没有任何提示。
 *
 * ## 修复后的行为
 *
 * 1. 有字节 → 发 `{ type: "image_url", image_url: { url: "data:image/png;base64,…" } }`；
 * 2. 没字节（附件服务缺席 / 读取失败）→ **降级成文字占位**，绝不静默丢弃；
 * 3. 只有文本时仍然发纯字符串（绝大多数请求，不给上游塞数组）。
 *
 * ## 为什么图片不需要 base64 以外的路径
 *
 * opendesign 是 OpenAI 兼容网关，`image_url` + data URL 是通用形状。官方
 * `dsh-llm-deepseek` 走 Files API 是因为 DeepSeek 原生接口不支持内联图，那是另一套协议。
 */
import { describe, expect, it } from "vitest";

import { buildRequestBody, openAiUserContent } from "../../src/vendors/opendesign/protocol";
import type { RequestImageBytes } from "../../src/vendors/opendesign/protocol";

/** 造一张假图片的编码字节。 */
function imageBytes(id = "sha256:abc", bytes = [137, 80, 78, 71]): RequestImageBytes {
  return { attachmentId: id, data: Uint8Array.from(bytes), mediaType: "image/png" };
}

/** 造一个 user 内容块（文本 + 可选图片）。 */
function userContent(text: string | undefined, imageId?: string): never {
  const blocks: unknown[] = [];
  if (text !== undefined) blocks.push({ type: "text", text });
  if (imageId !== undefined) blocks.push({ type: "image", attachment: { attachmentId: imageId } });
  return blocks as never;
}

describe("openAiUserContent：图片进请求体", () => {
  it("有字节 → 发 image_url + data URL", () => {
    const images = new Map([["sha256:abc", imageBytes()]]);
    const content = openAiUserContent(userContent("看看这张图", "sha256:abc"), images) as unknown[];
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: "text", text: "看看这张图" });
    expect(parts[1]!.type).toBe("image_url");
    // data URL 必须带正确的 MIME 与 base64 头。
    expect(parts[1]!.image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
    // PNG 魔数 137,80,78,71 → base64 是 iVBORw==
    expect(parts[1]!.image_url!.url).toContain("iVBORw==");
  });

  it("**取不到字节 → 文字占位，不静默丢弃**", () => {
    // 附件服务缺席 / 读取失败时，用户至少要看到「这里本该有一张图」。
    const content = openAiUserContent(userContent("看图", "sha256:missing"), new Map()) as unknown[];
    const parts = content as { type: string; text?: string }[];
    expect(parts.some((part) => part.type === "text" && (part.text ?? "").includes("图片未能发送"))).toBe(true);
    // 原文本也还在。
    expect(parts.some((part) => part.text === "看图")).toBe(true);
  });

  it("没有解析器（images 缺省）时同样降级成占位", () => {
    const content = openAiUserContent(userContent("看图", "sha256:abc")) as unknown[];
    const parts = content as { text?: string }[];
    expect(parts.some((part) => (part.text ?? "").includes("图片未能发送"))).toBe(true);
  });

  it("**只有文本时不发数组**（保持纯字符串，与旧行为一致）", () => {
    expect(openAiUserContent(userContent("纯文本"))).toBe("纯文本");
  });

  it("纯图片（没有文本块）也能发", () => {
    const images = new Map([["sha256:abc", imageBytes()]]);
    const content = openAiUserContent(userContent(undefined, "sha256:abc"), images) as unknown[];
    expect(content).toHaveLength(1);
    expect((content[0] as { type: string }).type).toBe("image_url");
  });

  it("同一张图出现两次都能发（各自带自己的 data URL）", () => {
    const images = new Map([["sha256:abc", imageBytes()]]);
    const blocks = [
      { type: "image", attachment: { attachmentId: "sha256:abc" } },
      { type: "text", text: "和" },
      { type: "image", attachment: { attachmentId: "sha256:abc" } },
    ] as never;
    const content = openAiUserContent(blocks, images) as unknown[];
    expect(content.filter((part) => (part as { type: string }).type === "image_url")).toHaveLength(2);
  });
});

describe("buildRequestBody：图片进 messages", () => {
  const options = {
    provider: "opendesign",
    model: "deepseek-v4.1-flash",
    messages: [
      { role: "system", content: [{ type: "text", text: "系统提示" }] },
      { role: "user", content: [{ type: "text", text: "看图" }, { type: "image", attachment: { attachmentId: "sha256:abc" } }] },
      { role: "assistant", content: [{ type: "text", text: "好" }] },
    ],
  } as never;
  const facts = { maxTokens: 1000, systemText: "系统提示" };

  it("user 消息带上 image_url；assistant 仍是纯文本", () => {
    const images = new Map([["sha256:abc", imageBytes()]]);
    const body = buildRequestBody(options, facts, images) as { messages: unknown[] };
    const user = body.messages.find((m) => (m as { role: string }).role === "user") as { content: unknown };
    expect(Array.isArray(user.content)).toBe(true);
    const assistant = body.messages.find((m) => (m as { role: string }).role === "assistant") as { content: unknown };
    expect(assistant.content).toBe("好");
  });

  it("不传 images 时 user 降级成文本（但占位可见）", () => {
    const body = buildRequestBody(options, facts) as { messages: unknown[] };
    const user = body.messages.find((m) => (m as { role: string }).role === "user") as { content: unknown };
    expect(JSON.stringify(user.content)).toContain("图片未能发送");
  });
});
