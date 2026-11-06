/**
 * Open Design 适配器的**模型路径**测试（`src/vendors/opendesign/adapter.ts`）。
 *
 * 为什么单独一个文件：`opendesign.test.ts` 覆盖的是装配（注册、配置、意图日志、账号与额度端口），
 * 登录与额度各有一个文件 —— 但「宿主的模型选择器看到什么」与「一次请求真发到哪儿、带什么」是
 * 用户最直接的体感（**账户接进来之后模型能不能用**），此前零覆盖。本文件把它补齐：
 * 1. `listModels`：打 `GET /models`（不带 Authorization），按可见性规则过滤；
 * 2. `catalogModels`：**不**过滤（隐藏的模型也要能回到勾选列表里）；
 * 3. `resolveModel`：目录声明的上下文/输出上限/档位/图片能力原样带出；目录不可用时退化成裸模型
 *    （名字仍走统一展示名，不是原始 id）；
 * 4. `stream` 正常链路：URL、Bearer、请求体（model/messages/stream/max_tokens）、chunk 顺序、
 *    usage 与 finish；
 * 5. `stream` 的档位闸门：**只有目录为这个模型声明过**才发 `reasoning_effort`；
 * 6. `stream` 的失败语义：没有密钥 → `MISSING_CREDENTIAL`（零请求）；401 → 换下一个账号；
 *    400（请求级）→ 不换账号；`stop` → `UNSUPPORTED_OPTION`；
 * 7. 工具调用：`delta.tool_calls` 拼成一个工具块（含伪造 id 的兜底）。
 */
import { LlmError, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, RequestMessage, StreamChunk } from "@deepseek-ai/dsh-llm";
import { describe, expect, it, vi } from "vitest";

import type { AccountPort, AccountView, QuotaPort } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";
import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import type { OpenDesignAdapterDeps } from "../../src/vendors/opendesign/adapter";
import { decodeStream } from "../../src/vendors/opendesign/protocol";

/** 请求路径不读账号写口与额度口：给最小桩（与另两家的适配器测试同一做法）。 */
function stubAccounts(views: readonly AccountView[] = []): AccountPort {
  return {
    list: async () => [...views],
    add: async () => {
      throw new Error("not used in this test");
    },
    rename: async () => {},
    replaceKey: async () => {},
    remove: async () => {},
    select: async () => {},
  };
}

function stubQuota(): QuotaPort {
  return { snapshot: async () => ({ windows: [], failures: [] }) };
}

/** 一条最小用户消息。 */
function userMessage(text: string): RequestMessage {
  return { role: "user", content: [{ type: "text", text }] } as unknown as RequestMessage;
}

/** 目标模型与一条用户消息，够 `stream()` 组出请求。 */
function request(model = "od-1"): GenerateOptions {
  return { provider: "opendesign", model, messages: [userMessage("hi")] };
}

/** 收齐一条 chunk 流（与宿主 `for await` 的消费方式一致）。 */
async function collect(source: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

/** 一次被记录的请求：URL、Bearer 密钥与已解析的请求体。 */
interface RecordedCall {
  url: string;
  key: string | undefined;
  body: unknown;
  method: string | undefined;
}

/**
 * 按脚本作答的假 `fetch`：脚本按调用顺序消费，并记录每次的 URL / 密钥 / 请求体。
 * 生成请求（`/chat/completions`）与目录请求（`/models`）都能用同一份脚本表达。
 * @param script - 每次调用的响应工厂（可以抛错，模拟传输失败）。
 * @returns 假 fetch 与调用记录。
 */
function scriptedFetch(script: readonly (() => Response | never)[]): typeof fetch & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const impl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const raw = init?.body === undefined || init.body === null ? undefined : String(init.body);
    let body: unknown;
    try {
      body = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      body = raw;
    }
    calls.push({
      url,
      key: headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
      body,
      method: init?.method,
    });
    const step = script[index];
    index += 1;
    if (step === undefined) throw new Error(`unexpected request #${index}: ${url}`);
    return step();
  }) as typeof fetch;
  return Object.assign(impl, { calls });
}

/** 一份目录负载（OpenAI 形状：`{ object: "list", data: [...] }`）。 */
function catalogResponse(rows: readonly Record<string, unknown>[]): Response {
  return new Response(JSON.stringify({ object: "list", data: rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 一条 SSE 文本响应。 */
function sseResponse(events: readonly string[]): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** 造适配器依赖；`fetchImpl` 与轮换引擎按用例覆盖。 */
function adapterDeps(overrides: Partial<OpenDesignAdapterDeps> = {}): OpenDesignAdapterDeps {
  return {
    config: () => ({}),
    rotation: new RotationEngine({ order: ["a"], rules: [], pinned: null }),
    quota: stubQuota(),
    accounts: stubAccounts(),
    fetchImpl: globalThis.fetch,
    ...overrides,
  };
}

/** 按 ref 返回密钥的凭据读取口。 */
function keysOf(map: Record<string, string>): (ref: string) => Promise<string | undefined> {
  return async (ref) => map[ref];
}

/** 收齐一条流，返回 chunk 与请求记录（每个用例都要看「发了什么」）。 */
async function runStream(
  options: GenerateOptions,
  deps: OpenDesignAdapterDeps,
): Promise<{ chunks: StreamChunk[]; calls: RecordedCall[] }> {
  const adapter = createOpenDesignAdapter(deps);
  const chunks = await collect(adapter.stream(options));
  return { chunks, calls: (deps.fetchImpl as unknown as { calls?: RecordedCall[] }).calls ?? [] };
}

/** 取请求体里的字段（请求体形状不可信，读之前先断言是对象）。 */
function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

it("listModels：打 GET /models，带**账号的推理密钥**（该网关目录要鉴权），按可见性规则过滤", async () => {
  const fetchImpl = scriptedFetch([
    () =>
      catalogResponse([
        { id: "od-1", name: "OD One", context_length: 200_000, max_output_tokens: 64_000, efforts: ["low", "high"] },
        { id: "od-hidden", name: "Hidden" },
        { id: "od-image", name: "Vision", image: true },
      ]),
  ]);
  const adapter = createOpenDesignAdapter(
    adapterDeps({
      // 可见性纪律（2026-10-18）：白名单/显式开关之外的模型**默认关闭**，
      // 所以这里显式把两个要看的打开、一个关掉。
      config: () => ({
        apiBase: "https://amr-link.example/v1/",
        modelVisibility: { "od-1": true, "od-image": true, "od-hidden": false },
      }),
      fetchImpl,
      // 目录是厂商级资源，但要鉴权：用任意一个可用账号的推理密钥（2026-10-18 实测
      // `GET /v1/models` 不带密钥回 401 missing_api_key —— 之前不带密钥，模型永远为空）。
      accounts: stubAccounts([{ ref: "od-ref", label: "Work", configured: true, active: true }]),
      resolveStored: keysOf({ "od-ref": "sk-od" }),
    }),
  );

  const models = await adapter.listModels("opendesign");

  // 只发一次目录请求，且带的是账号的推理密钥（Bearer）。
  expect(fetchImpl.calls).toHaveLength(1);
  expect(fetchImpl.calls[0]!.url).toBe("https://amr-link.example/v1/models");
  expect(fetchImpl.calls[0]!.key).toBe("sk-od");
  // 显式关闭的模型不出现；其余按目录顺序。
  expect(models.map((model) => model.id)).toEqual(["od-1", "od-image"]);
  expect(models[0]).toMatchObject({ provider: "opendesign", name: "OD One" });
  expect(models[1]).toMatchObject({ inputModalities: ["text", "image"] });
});

it("catalogModels：**不**应用可见性过滤（隐藏的模型也要能回到勾选列表）", async () => {
  const fetchImpl = scriptedFetch([
    () =>
      catalogResponse([
        { id: "od-1", name: "OD One" },
        { id: "od-hidden", name: "Hidden" },
      ]),
  ]);
  const adapter = createOpenDesignAdapter(
    adapterDeps({ config: () => ({ modelVisibility: { "od-hidden": false } }), fetchImpl }),
  );

  const models = await adapter.catalogModels();

  expect(models.map((model) => model.id)).toEqual(["od-1", "od-hidden"]);
});

it("resolveModel：上下文/输出上限/档位/图片能力都来自目录声明（未公布就不声称）", async () => {
  const payload = () =>
    catalogResponse([
      {
        id: "od-1",
        name: "OD One",
        context_length: 200_000,
        max_output_tokens: 64_000,
        efforts: ["low", "high"],
        modalities: ["text", "image"],
      },
      { id: "od-minimal", name: "OD Minimal" },
    ]);
  // 每次 `resolveModel` 各拉一次目录（目录不缓存）：脚本按调用顺序消费。
  const fetchImpl = scriptedFetch([payload, payload]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl }));

  const resolved = await adapter.resolveModel("opendesign", "od-1");
  expect(resolved).toMatchObject({
    provider: "opendesign",
    id: "od-1",
    name: "OD One",
    inputModalities: ["text", "image"],
    context: { contextWindow: 200_000 },
    defaultMaxTokens: 64_000,
  });
  expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toEqual([
    ReasoningEffortId("low"),
    ReasoningEffortId("high"),
  ]);

  // 目录里只给了 id：不猜上下文、不声明档位（宿主的档位选择器随之不出现）。
  const minimal = await adapter.resolveModel("opendesign", "od-minimal");
  expect(minimal).toMatchObject({ id: "od-minimal", name: "OD Minimal", inputModalities: ["text"] });
  expect(minimal.context).toBeUndefined();
  expect(minimal.defaultMaxTokens).toBeUndefined();
  expect(minimal.reasoning).toBeUndefined();
});

it("resolveModel：目录拉不到时退化成裸模型，请求照旧能发出去", async () => {
  const fetchImpl = scriptedFetch([() => Promise.reject(new Error("ECONNREFUSED")) as never]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl }));

  // 名字仍然是**统一展示名**（不是原始 slug）：目录读不到是常态，而宿主的模型选择器用
  // `resolveModel().name` 显示当前模型 —— 退回 slug 就与目录可用的那家写出两套名字
  // （2026-10-20 报障「模型名称又不一致了」的第二条路径）。
  await expect(adapter.resolveModel("opendesign", "od-unknown")).resolves.toMatchObject({
    provider: "opendesign",
    id: "od-unknown",
    name: "Od-Unknown",
    inputModalities: ["text"],
  });
});

/**
 * ## 上下文窗口的覆盖旋钮（2026-11-06）
 *
 * 宿主的压缩阈值完全由 `context.contextWindow` 决定：
 * `floor(min(W×0.8, W−O−B))`，`B = 65536`。
 *
 * 事故回顾：目录里 `context_limit: 1048000`（真实天花板，二分实测 1048239 仍 200、
 * 1048576 起 400）与 `context_budget: 328000`（预算，不是容量）并存。曾经误取 budget，
 * 阈值被压到 134464 token —— 约 270 条消息就压缩，用户看到的是「最新版本很快就压缩了」。
 *
 * 默认值已在目录层定为一档（取 `context_limit`）；这里是**不改代码就能纠正**的逃生阀：
 * 按模型覆盖 → 全局覆盖 → 目录值。
 */
describe("resolveModel：上下文窗口可被设置覆盖", () => {
  /** 造一个「目录公布 100 万窗口、输出 12.8 万」的响应。 */
  const wide = () =>
    catalogResponse([
      {
        id: "od-wide",
        name: "OD Wide",
        metadata: { context_limit: 1_048_000, context_budget: 328_000, output_budget: 128_000 },
      },
    ]);

  it("按模型覆盖优先于全局覆盖，也优先于目录", async () => {
    const fetchImpl = scriptedFetch([wide, wide]);
    const adapter = createOpenDesignAdapter(
      adapterDeps({
        fetchImpl,
        config: () => ({ contextWindow: 500_000, contextWindowOverrides: { "od-wide": 200_000 } }),
      }),
    );
    const resolved = await adapter.resolveModel("opendesign", "od-wide");
    expect(resolved.context?.contextWindow, "按模型的值赢").toBe(200_000);
  });

  it("没有按模型覆盖时用全局值", async () => {
    const fetchImpl = scriptedFetch([wide]);
    const adapter = createOpenDesignAdapter(
      adapterDeps({ fetchImpl, config: () => ({ contextWindow: 500_000 }) }),
    );
    const resolved = await adapter.resolveModel("opendesign", "od-wide");
    expect(resolved.context?.contextWindow).toBe(500_000);
  });

  it("都不设时用目录值（默认取 context_limit，不是 context_budget）", async () => {
    const fetchImpl = scriptedFetch([wide]);
    const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl }));
    const resolved = await adapter.resolveModel("opendesign", "od-wide");
    expect(resolved.context?.contextWindow, "1048000 是二分实测出的真实天花板").toBe(1_048_000);
  });

  it("坏值（0/负数/小数/超界/非数字）一律忽略，回落到下一级", async () => {
    for (const bad of [0, -1, 1.5, 20_000_000, Number.NaN, "500000"]) {
      const fetchImpl = scriptedFetch([wide]);
      const adapter = createOpenDesignAdapter(
        adapterDeps({
          fetchImpl,
          config: () => ({
            contextWindow: bad as unknown as number,
            contextWindowOverrides: { "od-wide": bad as unknown as number },
          }),
        }),
      );
      const resolved = await adapter.resolveModel("opendesign", "od-wide");
      expect(resolved.context?.contextWindow, `坏值 ${String(bad)} 不该被采用`).toBe(1_048_000);
    }
  });

  it("输出上限给压缩留出余量（只夹到窗口本身仍会让预算变负）", async () => {
    const fetchImpl = scriptedFetch([wide, wide]);
    const adapter = createOpenDesignAdapter(
      adapterDeps({ fetchImpl, config: () => ({ contextWindow: 100_000, contextWindowOverrides: {} }) }),
    );
    const resolved = await adapter.resolveModel("opendesign", "od-wide");
    // 目录公布 output_budget = 128000，比窗口 100000 还大。
    expect(resolved.context?.contextWindow).toBe(100_000);
    // 100000 − 65536（压缩余量）− 8192（最低消息预算）= 26272
    expect(resolved.defaultMaxTokens, "必须留出 65536 余量 + 8192 消息预算").toBe(26_272);
    // 关键不变量：W − O − B > 0，否则宿主压缩直接抛错、该路由完全不压缩。
    expect(100_000 - 26_272 - 65_536).toBeGreaterThan(0);
  });

  it("窗口装不下余量时原样返回目录值（让宿主的配置报错如实冒出来）", async () => {
    const fetchImpl = scriptedFetch([wide]);
    // 60000 < 65536 + 8192：无论怎么夹都不可能有正的预算。
    const adapter = createOpenDesignAdapter(
      adapterDeps({ fetchImpl, config: () => ({ contextWindow: 60_000, contextWindowOverrides: {} }) }),
    );
    const resolved = await adapter.resolveModel("opendesign", "od-wide");
    expect(resolved.defaultMaxTokens, "不伪造 1 token 的输出上限").toBe(128_000);
  });
});

it("stream：请求发到 /chat/completions，带 Bearer 与 OpenAI 形状的请求体；chunk 顺序与 finish 正确", async () => {
  const fetchImpl = scriptedFetch([
    () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "你好" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "世界" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }),
      ]),
  ]);
  const { chunks, calls } = await runStream(request(), adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }));

  // 端点与鉴权：唯一一条 Chat Completions 传输。
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://amr-link.open-design.ai/v1/chat/completions");
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.key).toBe("sk-a");
  expect(calls[0]!.body).toMatchObject({ model: "od-1", stream: true, max_tokens: 131_072 });
  expect(field(calls[0]!.body, "messages")).toEqual([{ role: "user", content: "hi" }]);

  // chunk 顺序：开文本块 → 两个增量 → usage → 关块 → finish
  // （`finish` 一步关掉仍打开的块，所以 `block-end` 紧挨在 `finish` 之前）。
  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "block-start",
    "text-delta",
    "text-delta",
    "usage",
    "block-end",
    "finish",
  ]);
  expect(chunks[1]).toMatchObject({ type: "text-delta", text: "你好" });
  expect(chunks[3]).toMatchObject({ type: "usage", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
  expect(chunks[4]).toMatchObject({ type: "block-end", block: { type: "text", text: "你好世界" } });
  expect(chunks[5]).toMatchObject({ type: "finish", reason: { kind: "stop" } });
});

it("stream：system 提示折进 messages[0]，maxTokens 按配置封顶", async () => {
  const fetchImpl = scriptedFetch([
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const { calls } = await runStream(
    { ...request(), system: "你是助手", maxTokens: 999_999 },
    adapterDeps({ fetchImpl, config: () => ({ defaultMaxTokens: 4096 }), resolveStored: keysOf({ a: "sk-a" }) }),
  );

  expect(field(calls[0]!.body, "max_tokens")).toBe(4096);
  expect(field(calls[0]!.body, "messages")).toEqual([
    { role: "system", content: "你是助手" },
    { role: "user", content: "hi" },
  ]);
});

it("stream：用户选的档位**原样发送**，不因为目录没声明就静默丢掉", async () => {
  // 2026-11-03 用户要求：
  //   「确定每个档位都是正常可用的，别给我整错档位了，max 就是 max……」
  //
  // 旧行为是「目录声明过才发」：目录没声明（元数据抓取失败、或厂商根本不公布档位）时
  // 直接不发 —— 用户选了 high，请求里却没有档位字段，等于悄悄换成了厂商默认档。
  // 静默改档和显式降档是两回事：前者用户无从发现，后者至少是网关明确拒绝后的自适应。
  //
  // 现在一律原样发送；真被网关拒绝时，下面那条「400 → 按白名单降一档重发」的兜底仍然生效。
  const fetchImpl = scriptedFetch([
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const deps = adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) });

  await runStream({ ...request(), reasoningEffort: ReasoningEffortId("high") }, deps);
  expect(field(fetchImpl.calls[0]!.body, "reasoning_effort")).toBe("high");

  await runStream({ ...request(), reasoningEffort: ReasoningEffortId("off") }, deps);
  expect(
    field(fetchImpl.calls[1]!.body, "reasoning_effort"),
    "目录没声明 off 也要原样发，不能静默换成默认档",
  ).toBe("off");
});

it("stream：没有可用密钥 → MISSING_CREDENTIAL，且一条请求都不发", async () => {
  const fetchImpl = scriptedFetch([]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl }));

  const error = await collect(adapter.stream(request())).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(LlmError);
  expect((error as LlmError).code).toBe("MISSING_CREDENTIAL");
  expect(fetchImpl.calls).toHaveLength(0);
});

it("stream：401 是账号级失败 → 换下一个账号重试（第二个密钥成功）", async () => {
  const fetchImpl = scriptedFetch([
    () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "from-b" }, finish_reason: "stop" }] })]),
  ]);
  const { chunks, calls } = await runStream(request(), adapterDeps({
    fetchImpl,
    rotation: new RotationEngine({ order: ["a", "b"], rules: [], pinned: null }),
    resolveStored: keysOf({ a: "sk-a", b: "sk-b" }),
  }));

  expect(calls.map((call) => call.key)).toEqual(["sk-a", "sk-b"]);
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.text === "from-b")).toBe(true);
});

it("stream：400 是请求级失败 → 不换账号（换号不可能改变结果）", async () => {
  const fetchImpl = scriptedFetch([
    () => new Response(JSON.stringify({ error: { message: "context too long" } }), { status: 400 }),
  ]);
  const adapter = createOpenDesignAdapter(
    adapterDeps({
      fetchImpl,
      rotation: new RotationEngine({ order: ["a", "b"], rules: [], pinned: null }),
      resolveStored: keysOf({ a: "sk-a", b: "sk-b" }),
    }),
  );

  const error = await collect(adapter.stream(request())).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect(fetchImpl.calls.map((call) => call.key)).toEqual(["sk-a"]);
});

it("**stop 序列会发到请求体**（2026-10-20 对齐官方：不再拒绝）", async () => {
  // 官方 `dsh-llm-deepseek` 直接透传 `options.stop`；旧实现在这里抛 UNSUPPORTED_OPTION
  // 是因为当时没实现。现在实现了，宿主传下来的 stop 必须真的到达上游 ——
  // 少传它，模型只能自己停（代码生成会一路写到 max_tokens）。
  const fetchImpl = scriptedFetch([
    () => sseResponse(['{"choices":[{"delta":{"content":"ok"}}]}', '{"choices":[{"delta":{},"finish_reason":"stop"}]}', "[DONE]"]),
  ]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }));

  await collect(adapter.stream({ ...request(), stop: ["STOP", "\n\nUser:"] })).catch(() => undefined);
  expect(fetchImpl.calls.length).toBeGreaterThan(0);
  const body = fetchImpl.calls[0]!.body as { stop?: string[] };
  // OpenAI 兼容形状的字段名是 `stop`（不是 Anthropic 的 `stop_sequences`）。
  expect(body.stop).toEqual(["STOP", "\n\nUser:"]);
});

it("没有 stop 时不发这个字段（不给绝大多数请求塞空数组）", async () => {
  const fetchImpl = scriptedFetch([
    () => sseResponse(['{"choices":[{"delta":{"content":"ok"}}]}', '{"choices":[{"delta":{},"finish_reason":"stop"}]}', "[DONE]"]),
  ]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }));
  await collect(adapter.stream(request())).catch(() => undefined);
  const body = fetchImpl.calls[0]!.body as { stop?: unknown };
  expect(body.stop).toBeUndefined();
});

it("解码：delta.tool_calls 拼成一个工具块（缺 id 时补一个，finish 为 tool-calls）", async () => {
  const text = [
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "look_up", arguments: "{\"q\":" } }] } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"x\"}" } }] }, finish_reason: "tool_calls" }] })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  const chunks = await collect(decodeStream(new Response(text).body));

  const toolCall = chunks.find((chunk) => chunk.type === "block-end" && chunk.block.type === "tool-call");
  expect(toolCall).toMatchObject({
    type: "block-end",
    block: { type: "tool-call", id: "call_1", name: "look_up", arguments: "{\"q\":\"x\"}" },
  });
  expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: { kind: "tool-calls" } });
});

it("解码：没有任何内容也没有终止事件的流 → EMPTY_RESPONSE（空响应不能伪装成正常收尾）", async () => {
  const chunks = decodeStream(new Response("data: \n\n").body);
  const error = await collect(chunks).catch((reason: unknown) => reason);
  expect((error as LlmError).code).toBe("EMPTY_RESPONSE");
});

it("beforeRequest 只对普通对话调用（辅助调用跳过），且失败原样上抛", async () => {
  const beforeRequest = vi.fn(async () => undefined);
  const fetchImpl = scriptedFetch([
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  await runStream({ ...request(), sessionId: "s-1" } as GenerateOptions, adapterDeps({
    fetchImpl,
    resolveStored: keysOf({ a: "sk-a" }),
    beforeRequest,
  }));
  expect(beforeRequest).toHaveBeenCalledWith({ sessionId: "s-1" });
});

it("resolveModel：目录不声明档位时按模型族兜底（宿主的思考强度选择器靠它）", async () => {
  // OpenAI 形状的目录只有 id：没有兜底就永远没有档位可选（实际情况）。
  const fetchImpl = scriptedFetch([() => catalogResponse([{ id: "claude-sonnet-4-5-20250929" }])]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl }));

  const resolved = await adapter.resolveModel("opendesign", "claude-sonnet-4-5-20250929");

  // Claude 族官方四档（`xhigh` 是 OpenAI 的值，Anthropic 官方没有 —— 2026-11-06 去掉）。
  expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toEqual([
    ReasoningEffortId("low"),
    ReasoningEffortId("medium"),
    ReasoningEffortId("high"),
    ReasoningEffortId("max"),
  ]);
  // 同一份目录里展示名也统一成官方名。
  expect(resolved.name).toBe("Claude-Sonnet-4.5");
});

it("stream：网关拒绝档位时**向上**挑白名单里更强的档位重发（不降档）", async () => {
  const fetchImpl = scriptedFetch([
    // ① 带 xhigh 的请求被网关拒，白名单最高只到 high（真实口吻，2026-10-18 实测）。
    () =>
      new Response(
        JSON.stringify({
          error: {
            message: "[code=invalid_request_error] reasoning effort is unsupported for claude-haiku-5.5; use one of low, medium, high",
          },
        }),
        { status: 400 },
      ),
    // ② 重发。
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const { chunks, calls } = await runStream(
    { ...request("claude-haiku-5.5"), reasoningEffort: ReasoningEffortId("low") },
    adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }),
  );

  expect(calls).toHaveLength(2);
  expect(field(calls[0]!.body, "reasoning_effort")).toBe("low");
  // 白名单里比 low 强的第一个是 medium —— 升档，而不是退回 low 或去掉。
  expect(field(calls[1]!.body, "reasoning_effort"), "升档优先，绝不降档").toBe("medium");
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.text === "ok")).toBe(true);
});

it("stream：所选已是白名单最高档时**去掉字段**重发，不退回更弱的档位", async () => {
  const fetchImpl = scriptedFetch([
    // 用户选 max，网关只认到 high：没有更强的档位可升。
    () =>
      new Response(
        JSON.stringify({
          error: {
            message: "[code=invalid_request_error] reasoning effort is unsupported for glm-5.3-flash; use one of low, high",
          },
        }),
        { status: 400 },
      ),
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const { calls } = await runStream(
    { ...request("glm-5.3-flash"), reasoningEffort: ReasoningEffortId("max") },
    adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }),
  );

  expect(calls).toHaveLength(2);
  expect(field(calls[0]!.body, "reasoning_effort")).toBe("max");
  // 关键：**不是** high。降档会让这次请求的思考量低于用户要求。
  expect(field(calls[1]!.body, "reasoning_effort"), "没有更强项时交回厂商默认，不静默降档").toBeUndefined();
});

it("stream：网关不认 reasoning_effort（400）且没念白名单时去掉字段重发一次，回答照常拿到", async () => {
  const fetchImpl = scriptedFetch([
    // ① 带档位的请求被网关拒绝，且正文点名了这个字段。
    //    不再先查目录：用户选的档位一律原样发（2026-11-03）。
    () => new Response(JSON.stringify({ error: { message: "reasoning_effort is not supported for this model" } }), {
      status: 400,
    }),
    // ② 去掉字段重发 → 成功。
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const { chunks, calls } = await runStream(
    { ...request("claude-sonnet-4-5"), reasoningEffort: ReasoningEffortId("high") },
    adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }),
  );

  expect(calls).toHaveLength(2);
  expect(field(calls[0]!.body, "reasoning_effort")).toBe("high");
  expect(field(calls[1]!.body, "reasoning_effort")).toBeUndefined();
  expect(chunks.some((chunk) => chunk.type === "text-delta" && chunk.text === "ok")).toBe(true);
});

it("stream：与档位无关的 400 不重放（上下文超长是确定性失败）", async () => {
  const fetchImpl = scriptedFetch([
    () => new Response(JSON.stringify({ error: { message: "context too long" } }), { status: 400 }),
  ]);
  const adapter = createOpenDesignAdapter(adapterDeps({ fetchImpl, resolveStored: keysOf({ a: "sk-a" }) }));

  await expect(collect(adapter.stream(request("claude-sonnet-4-5")))).rejects.toBeInstanceOf(Error);
  expect(fetchImpl.calls).toHaveLength(1);
});

/**
 * **已卸载的图片不能再读字节**（2026-11-04 外部审查 U13）。
 *
 * 审查原文：
 *
 * > `offloaded:true` 仍 `resolveImage` 并发 base64，违反本地 dsh-llm 的 ImageBlock 契约，
 * > 图片卸载缩减请求的决定失效。
 *
 * 宿主把 `offloaded: true` 写在 `ImageBlock` 上，含义是「这张图已从请求里卸载」——
 * 契约要求各条路由只发「命名图片及其只读路径」的占位文本，**不能**再读字节。
 * 否则卸载就白做了：请求又被撑回原大小。
 *
 * 三个厂商都要遵守（opencode / commandcode 已修，这条盯 opendesign）。
 */
it("U13：offloaded 的图片不读字节，只发占位文本", async () => {
  let readCalls = 0;
  const fetchImpl = scriptedFetch([
    () => sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })]),
  ]);
  const adapter = createOpenDesignAdapter(
    adapterDeps({
      fetchImpl,
      resolveStored: keysOf({ a: "sk-a" }),
      resolveImage: async (ref: { attachmentId: string }) => {
        readCalls += 1;
        return { attachmentId: ref.attachmentId, data: new Uint8Array([1, 2, 3]), mediaType: "image/png" };
      },
    }),
  );

  const content = [
    { type: "text" as const, text: "这张图是什么？" },
    {
      type: "image" as const,
      attachment: { attachmentId: "att-1", mediaType: "image/png", bytes: 3, width: 1, height: 1 },
      offloaded: true as const,
    },
  ];

  await collect(
    adapter.stream({
      ...request("claude-sonnet-4-5"),
      messages: [{ role: "user", content: content as never }],
    } as never),
  );

  expect(readCalls, "已卸载的图片不该再读字节（否则卸载失去意义）").toBe(0);

  // 出站正文里应当只有占位文本，没有图片块。
  const body = fetchImpl.calls.at(-1)?.body;
  const serialized = JSON.stringify(body ?? {});
  expect(serialized, "不该出现 base64 图片").not.toContain("image_url");
  expect(serialized, "要有占位说明").toContain("图片已卸载");
});
