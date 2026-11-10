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
import {
  DEFAULT_MAX_REQUEST_ITEMS,
  createOpenDesignAdapter,
  effectiveItemLimit,
  itemCapOf,
} from "../../src/vendors/opendesign/adapter";
import { buildRequestBody } from "../../src/vendors/opendesign/protocol";
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
  /** 目标模型（不同模型的条数上限不同，默认用没有硬上限的那个）。 */
  model = "deepseek-v4.1-flash",
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
    model,
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

it("配置缺省时上限是 200000，1003 条**不该**被裁（2026-11-10 修）", async () => {
  // 旧默认值是 1000，于是 1003 条就开始砍历史。砍的是**队首**，等于把 prefix 缓存
  // 整段作废 —— 用户账单上表现为「大 prompt 全额按未命中计费」，会话里表现为
  // 「模型忘了前面」。而 deepseek-v4.1-flash 实测能收 ≥200000 条。
  expect(DEFAULT_MAX_REQUEST_ITEMS).toBe(200_000);
  const body = await outboundBody(() => ({}), 1_003);
  expect(body.messages.length, "远未到上限，必须原样发出").toBe(1_003);
  expect(JSON.stringify(body.messages), "没被裁就不该出现省略提示").not.toContain("省略");
});

it("**配置写 0 不再关闭裁剪**：非正数一律回落到默认上限（2026-11-06 事故）", async () => {  // 旧语义是「0 = 不裁剪，用户自愿承担 400」。实际后果是一次整轮失败：
  // 2026-11-06 18:40，压缩请求 1001 条被拒（`compaction/end` 带 error），紧接的
  // 主请求 1002 条也被拒 —— 连自愈路径都因为「压缩请求自己超限」而断掉。
  //
  // 所以 0/负数/NaN 现在都当作「没设」，由 resolveConfig 回落到 DEFAULT_MAX_REQUEST_ITEMS。
  //
  // 2026-11-10：默认值已提到 200000，所以这里改用**真正有硬上限的** `glm-5.3-flash`
  // 来验证——否则 1003 条根本到不了裁剪线，测不出「回落到默认」这件事。
  for (const value of [0, -1, Number.NaN]) {
    const body = await outboundBody(() => ({ maxRequestItems: value }), 1_003, undefined, "glm-5.3-flash");
    expect(body.messages.length, `maxRequestItems=${String(value)} 时仍要裁剪`).toBeLessThanOrEqual(
      effectiveItemLimit(DEFAULT_MAX_REQUEST_ITEMS, "glm-5.3-flash"),
    );
    expect(JSON.stringify(body.messages)).toContain("省略");
  }
});

it("未超限的请求不被改动（不给正常请求加噪音）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 1_000 }), 6);
  expect(body.messages.length).toBe(6);
  expect(JSON.stringify(body.messages)).not.toContain("省略");
});

it("**配置再大也被该模型的实测上限钳住**（全局旋钮 vs 各模型上限不一致）", async () => {
  // 设置里只有一个全局旋钮，而同一网关不同模型的上限并不一样。
  //
  // **2026-11-07 深夜复测后这张表变了**：`deepseek-v4.1-flash` 不再是 1000
  // （1000 / 5000 / 20000 / 30000 / 200000 条都 200，且 prompt_tokens 随条数线性增长，
  // 藏针也确认首条消息能送达）。现在只剩 `glm-5.3-flash` 还是 1000。
  // 这条用例的价值不在于「记住某个数字」，而在于固定「按模型取小」这道机制。
  expect(itemCapOf("glm-5.3-flash"), "实测第 1001 条即 400").toBe(1_000);
  /**
   * 2026-11-10：这两个模型本该早就在表里。
   *
   * 它们缺席时 `itemCapOf` 回落到 `ITEM_CAP_FALLBACK`（3000），再和默认值取小 ——
   * 而当时的默认值是 1000，于是**本来能收 20 万条的模型被砍到 1000 条**。
   * 这条断言固定住「宽松模型必须显式登记」，避免再次因为「表里没有」而被保守值接管。
   */
  expect(itemCapOf("deepseek-v4.1-flash"), "实测 ≥200000 条仍 200").toBe(200_000);
  expect(itemCapOf("deepseek-v4.1-flash-eco"), "与 flash 同一套配额").toBe(200_000);
  expect(itemCapOf("没量过的模型"), "没量过就按 3000 兜底").toBe(3_000);

  expect(effectiveItemLimit(3_000, "glm-5.3-flash"), "配置 3000 也要压到 1000").toBe(1_000);
  expect(effectiveItemLimit(9_000, "glm-5.3-flash"), "配置再大也压到 1000").toBe(1_000);
  expect(effectiveItemLimit(200, "glm-5.3-flash"), "配置更小时听配置的").toBe(200);
  expect(effectiveItemLimit(200_000, "deepseek-v4.1-flash"), "该模型已不受 1000 限制").toBe(200_000);
  expect(effectiveItemLimit(200_000, "没量过的模型"), "没量过仍被 3000 兜住").toBe(3_000);

  /**
   * 端到端：配置写 9000、请求 5000 条 —— 对 `glm-5.3-flash` 出站仍必须 ≤1000。
   *
   * 用这个模型跑，是因为它是**目前唯一**还有硬上限的那个；拿 flash 跑会得到
   * 5000 条原样发出，看不出钳制有没有生效。
   */
  const body = await outboundBody(() => ({ maxRequestItems: 9_000 }), 5_000, undefined, "glm-5.3-flash");
  expect(body.messages.length).toBeLessThanOrEqual(1_000);
  expect(JSON.stringify(body.messages)).toContain("省略");
});

/**
 * ## `tools[]` **不**占条目预算（2026-11-06 复核，推翻当天早上的推测）
 *
 * 早上看到 `1017 > 1000`，先入为主地以为「1000 条消息 + 17 个工具 = 1017」。
 * 复核 `docs/HANDOVER-2.0.0.md` 的实测记录：网关**不数 tools、数 system**
 * （1000 条 → 200，1001 条 → 400）。所以 1017 的真实含义是「那一版根本没在裁剪」——
 * 对方装的是旧产物，不是工具被算了进去。
 *
 * 结论：裁剪预算只按消息算。如果扣掉工具数，会白丢几十条历史（这次会话 tools=58），
 * 却换不来任何保护。
 */
it("裁剪预算**不扣工具数**（实测 tools 不计入网关的 item 上限）", async () => {
  const body = await outboundBody(() => ({ maxRequestItems: 1_000 }), 1_200, manyTools(17));
  expect(body.tools?.length, "工具原样发出，不丢").toBe(17);
  expect(body.messages.length, "按消息数裁到上限，不为工具让位").toBeLessThanOrEqual(1_000);
  expect(body.messages.length, "不该因为 17 个工具就少留 17 条").toBeGreaterThan(900);
  expect(JSON.stringify(body.messages), "仍然明确告知历史被省略").toContain("省略");
});

it("工具再多也不影响消息预算", async () => {
  const withTools = await outboundBody(() => ({ maxRequestItems: 100 }), 500, manyTools(60));
  const withoutTools = await outboundBody(() => ({ maxRequestItems: 100 }), 500);
  expect(withTools.messages.length).toBe(withoutTools.messages.length);
  expect(withTools.messages.length).toBeLessThanOrEqual(100);
});

/**
 * ## 协议层兜底：`BodyFacts.maxRequestItems` 缺失时**仍然要裁**
 *
 * 2026-11-06 turn 357 的事故里，网关报的是 `(1001 > 1000 items)` 和 `(1002 > 1000 items)`
 * —— 正好是原始历史长度。裁剪一旦生效会按 64 组对齐砍到 938 条左右，所以那两个数字
 * 说明**一个字都没裁**：`trimWireMessages` 拿到了 `undefined` 就原样返回。
 *
 * 上游任何一环（设置文档 → `adapterConfigOf` → `resolveConfig` → `#post`）把它弄丢，
 * 都不该让这一层裸奔。这条用例固定住「拿不到上限就按 1000 裁」。
 */
it("**不传上限时协议层自己兜底**（上游配置断链也不许裸奔）", () => {
  // 兜底值随默认上限一起从 1000 提到 200000（2026-11-10）—— 「1000」本身正是
  // prefix 缓存被打碎的原因。这条固定的是「**有**兜底」，不是「兜底值是 1000」。
  const messages = longHistory(1_003);
  const body = buildRequestBody({ provider: "opendesign", model: "deepseek-v4.1-flash", messages }, {
    maxTokens: 1_024,
    systemText: "SYS",
  }) as { messages: { role: string }[] };
  expect(body.messages.length, "1003 条历史 + 1 条 system，原样发出").toBe(1_004);
  expect(JSON.stringify(body.messages), "没触发裁剪就不该有省略提示").not.toContain("省略");
});
