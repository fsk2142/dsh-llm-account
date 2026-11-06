/**
 * 条数上限的**配置接线**：设置文档里的 `maxRequestItems` 必须真的到达出站请求体。
 *
 * ## 为什么单独一个文件
 *
 * 2026-11-05 的修复分三处落地：`core/wire-limit.ts`（裁剪逻辑）、
 * `opendesign/protocol.ts`（投影层调用它）、`opendesign/adapter.ts`（`BodyFacts`）。
 * 三处各自的单测都绿，但**中间任何一段没接上**，现场那个 400 依然会复现 ——
 * 这正是 U06/U07 反复踩过的坑（「只测底层函数」的假绿）。
 *
 * 所以这里从 `adapter.stream()` 进入，读**真正发出去的请求体**。
 * 另外补一条隐私边界：设置文档里没写的字段必须回落到默认值，而不是 `undefined`
 * （`undefined` 会让裁剪整个失效）。
 */
import { expect, it } from "vitest";

import type { ContentBlock, GenerateOptions, RequestMessage, StreamChunk } from "@deepseek-ai/dsh-llm";

import { RotationEngine } from "../../src/core/switching/rotation";
import { DEFAULT_MAX_REQUEST_ITEMS, createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import type { OpenDesignAdapterDeps } from "../../src/vendors/opendesign/adapter";

/** 最小账号/额度桩（本文件不碰那两条路径）。 */
function deps(config: OpenDesignAdapterDeps["config"], fetchImpl: typeof fetch): OpenDesignAdapterDeps {
  return {
    config,
    rotation: new RotationEngine({ order: ["a"], rules: [], pinned: null }),
    quota: { snapshot: async () => ({ windows: [], failures: [] }) },
    accounts: {
      list: async () => [{ ref: "a", label: "A", apiKeyEnv: "A" }],
      add: async () => {},
      rename: async () => {},
      replaceKey: async () => {},
      remove: async () => {},
      select: async () => {},
    },
    fetchImpl,
    resolveStored: async () => "sk-a",
  } as unknown as OpenDesignAdapterDeps;
}

/** 一条 SSE 正常收尾（本文件不关心正文内容）。 */
function sse(): Response {
  return new Response(
    ['data: {"choices":[{"delta":{"content":"ok"},"index":0}]}', 'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}', "data: [DONE]"].join("\n\n") + "\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

/** 造 n 条 user/assistant 往复，投影后**一条对一条**。 */
function longHistory(count: number): RequestMessage[] {
  const messages: { role: "user" | "assistant"; content: ContentBlock[] }[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push({ role: index % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `第 ${index} 条` }] });
  }
  return messages as unknown as RequestMessage[];
}

/** 跑一次 stream，返回**最后一次**生成请求的请求体。 */
async function outboundBody(
  config: OpenDesignAdapterDeps["config"],
  history: number,
  tools?: readonly { name: string; description: string; parameters: Record<string, unknown> }[],
): Promise<{ messages: { role: string }[]; tools?: unknown[] }> {
  let body: { messages: { role: string }[]; tools?: unknown[] } | undefined;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const text = String(url);
    if (text.endsWith("/models")) {
      return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 });
    }
    if (typeof init?.body === "string") body = JSON.parse(init.body) as { messages: { role: string }[] };
    return sse();
  }) as unknown as typeof fetch;

  const adapter = createOpenDesignAdapter(deps(config, fetchImpl));
  const options = {
    provider: "opendesign",
    model: "deepseek-v4.1-flash",
    messages: longHistory(history),
    ...(tools === undefined ? {} : { tools }),
  } as unknown as GenerateOptions;
  for await (const _chunk of adapter.stream(options) as AsyncIterable<StreamChunk>) {
    // 消费完即可
  }
  if (body === undefined) throw new Error("没有截到生成请求");
  return body;
}

/** 造 n 个工具定义（形状与宿主 `ToolSchema` 一致）。 */
function manyTools(count: number): { name: string; description: string; parameters: Record<string, unknown> }[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index}`,
    description: "d",
    parameters: { type: "object", properties: {} },
  }));
}

it("**配置里的 maxRequestItems 真的作用到出站请求体**（端到端）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 20 }), 60);
  expect(body.messages.length, "被裁到配置的上限以内").toBeLessThanOrEqual(20);
  expect(body.messages.length, "确实裁了（不是碰巧 60≤20 不成立而已）").toBeGreaterThan(0);
  expect(JSON.stringify(body.messages), "模型知道历史被省略").toContain("省略");
});

it("配置缺省时回落到 1000（现场那个上限），不是 `undefined`", async () => {
  // 1003 条正是现场报错里的数字。
  const body = await outboundBody(() => ({}), 1_003);
  expect(body.messages.length).toBeLessThanOrEqual(DEFAULT_MAX_REQUEST_ITEMS);
  expect(DEFAULT_MAX_REQUEST_ITEMS).toBe(1_000);
  expect(JSON.stringify(body.messages)).toContain("省略");
});

it("配置写 0 = 关闭裁剪（用户自愿承担 400 的风险）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 0 }), 1_003);
  expect(body.messages.length, "完全不裁").toBe(1_003);
});

it("未超限的请求不被改动（不给正常请求加噪音）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 1_000 }), 6);
  expect(body.messages.length).toBe(6);
  expect(JSON.stringify(body.messages)).not.toContain("省略");
});

/**
 * 2026-11-06 现场第二次报错：`1017 > 1000 items`。
 *
 * 那时 `messages[]` 已经被裁到**正好 1000** 条 —— 零余量。网关把 `tools[]` 也数进
 * input items，1000 + 17 个工具 = 1017，于是每轮都超、每轮都 400。
 * 修法：预算先扣掉工具。
 */
it("**tools[] 也占条目预算**（否则 1000 条消息 + 17 个工具 = 1017 > 1000）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 1_000 }), 1_200, manyTools(17));
  expect(body.tools?.length, "工具原样发出，不丢").toBe(17);
  expect(
    body.messages.length + (body.tools?.length ?? 0),
    "消息 + 工具一起算，必须落在上限以内",
  ).toBeLessThanOrEqual(1_000);
  expect(JSON.stringify(body.messages), "仍然明确告知历史被省略").toContain("省略");
});

it("工具很多时也不越界（预算按工具数动态收缩）", async () => {
  const tools = manyTools(60);
  const body = await outboundBody(() => ({ maxRequestItems: 100 }), 500, tools);
  expect(body.messages.length + 60).toBeLessThanOrEqual(100);
  expect(body.messages.length).toBeGreaterThan(0);
});

it("工具占满上限时给出可行动的报错，而不是发一个必然被拒的请求", async () => {
  await expect(outboundBody(() => ({ maxRequestItems: 5 }), 10, manyTools(5))).rejects.toThrow(/工具定义/);
});
