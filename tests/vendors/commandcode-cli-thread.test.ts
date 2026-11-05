/**
 * CLI 传输的 `threadId` 必须从 sessionId **稳定派生**（2026-11-05 外部审查 F09）。
 *
 * ## 上一版的确切行为
 *
 * ```ts
 * if (/^<uuid>$/.test(sessionId)) return sessionId;
 * return randomUUID();            // ← 每次都不同
 * ```
 *
 * 审查当时把它列为「条件性风险：需先确认宿主 ID 格式」。确认结果：本机 240 个会话
 * 里 **85 个是 `session-<uuid>` 前缀形态**（含最新的主会话），纯 UUID 的 155 个全部
 * 是 `origin: subagent` 派生会话。主会话因此 100% 落到 `randomUUID()`。
 *
 * 后果：同一会话每次请求 threadId 都变 → 服务端会话无法复用、prompt cache 命中率掉。
 *
 * ## 为什么这里用「同一会话两次请求必须相同」来断言
 *
 * 那是缓存/复用成立的最小条件，也是审查给的验收标准原文：
 * 「同一 DSH 会话连续两次请求得到稳定 threadId；不同会话得到不同 threadId」。
 */
import { describe, expect, it } from "vitest";

import { buildRequestBody } from "../../src/vendors/commandcode/protocol";

/** 造一次 CLI 传输的请求体，取它的 threadId。 */
function threadIdOf(sessionId: string | undefined): string {
  const options = {
    provider: "llm-commandcode",
    model: "deepseek/deepseek-v4.1-flash",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  } as unknown as Parameters<typeof buildRequestBody>[1];
  // sessionId 走 **BodyFacts**（适配器从 options.sessionId 取出来填进 facts）。
  const body = buildRequestBody("cli", options, {
    maxTokens: 16,
    systemText: "",
    ...(sessionId === undefined ? {} : { sessionId }),
  }) as { threadId?: unknown };
  return String(body.threadId);
}

describe("F09 · CLI threadId 稳定派生", () => {
  it("**同一会话连续两次请求得到相同 threadId**", () => {
    const id = "session-7daef554-0000-4000-8000-000000000001";
    expect(threadIdOf(id)).toBe(threadIdOf(id));
  });

  it("真实宿主形态（`session-` 前缀）也稳定 —— 这正是上一版会失效的输入", () => {
    const prefixed = "session-31f25379-0000-4000-8000-000000000002";
    expect(threadIdOf(prefixed)).toBe(threadIdOf(prefixed));
  });

  it("纯 UUID（subagent 派生会话）同样稳定", () => {
    const plain = "a6b03926-e81f-4a36-bc0e-f121dc4cb2e6";
    expect(threadIdOf(plain)).toBe(threadIdOf(plain));
  });

  it("**不同会话得到不同 threadId**", () => {
    const a = threadIdOf("session-aaa");
    const b = threadIdOf("session-bbb");
    expect(a).not.toBe(b);
  });

  it("输出是固定长度的十六进制串（任何端点都接受的字符集）", () => {
    expect(threadIdOf("session-whatever")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("缺省 sessionId（标题/压缩等辅助调用）也有进程级稳定值，不是随机", () => {
    expect(threadIdOf(undefined)).toBe(threadIdOf(undefined));
    expect(threadIdOf(undefined)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("辅助调用的 threadId 与任何真实会话都不同", () => {
    expect(threadIdOf(undefined)).not.toBe(threadIdOf("session-x"));
  });
});
