/**
 * assistant 历史图片占位**不得携带内部 attachmentId**（2026-11-05 外部审查 F10）。
 *
 * ## 缺陷
 *
 * 占位文本原来是 `[历史 assistant 图片：<attachmentId>；…]`。模型无法用这个 id 读到
 * 附件（它只是宿主本地的持久化标识），所以那段字符是纯无用输入 —— 每张历史图都
 * 白吃一段 prompt；同时把宿主内部命名空间抖给了上游。
 *
 * ## 修复后的契约
 *
 * 1. 占位仍然存在（绝不能静默丢弃，U07 的纪律）；
 * 2. 不再出现 attachmentId；
 * 3. 需要区分多张时用**请求内序号**。
 */
import { describe, expect, it } from "vitest";

import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";

import { assistantImageText } from "../../src/core/image-projection";
import { toPiContext } from "../../src/vendors/opencode/protocol";

const ID = AttachmentId(`sha256:${"a".repeat(64)}`);

/** 一个最小 assistant 图片块。 */
const block = {
  type: "image",
  attachment: { attachmentId: ID, mediaType: "image/png", bytes: 8, width: 1, height: 1, name: "h.png" },
} as unknown as Parameters<typeof assistantImageText>[0];

describe("F10 · assistant 历史图片占位", () => {
  it("占位仍在（绝不静默丢弃）", () => {
    expect(assistantImageText(block)).toContain("历史 assistant 图片");
    expect(assistantImageText(block)).toContain("未内联");
  });

  it("**不再包含 attachmentId**", () => {
    expect(assistantImageText(block)).not.toContain(ID);
  });

  it("已卸载时保留「已卸载」语义", () => {
    const offloaded = { ...block, offloaded: true } as Parameters<typeof assistantImageText>[0];
    expect(assistantImageText(offloaded)).toContain("已卸载");
  });

  it("可用请求内序号区分多张（不靠内部 id）", () => {
    expect(assistantImageText(block, 2)).toContain("#2");
    expect(assistantImageText(block, 2)).not.toContain(ID);
  });
});

describe("F10 · 端到端：OpenCode 投影里没有 attachmentId", () => {
  it("assistant 历史图 → 投影结果只有占位文本", () => {
    const options: GenerateOptions = {
      provider: "dsh-opencode-go",
      model: "m",
      messages: [
        createUserMessage({ content: [{ type: "text", text: "draw" }], source: { kind: "user" } }),
        createAssistantMessage({
          content: [{ type: "image", attachment: { attachmentId: ID, mediaType: "image/png", bytes: 8, width: 1, height: 1, name: "h.png" } }],
          source: { provider: "image-generator", model: "image-m" },
        }),
        createUserMessage({ content: [{ type: "text", text: "again" }], source: { kind: "user" } }),
      ],
    };
    const projected = JSON.stringify(toPiContext(options, new Map()));
    expect(projected, "占位在").toContain("历史 assistant 图片");
    expect(projected, "内部 id 不在").not.toContain(ID);
  });
});
