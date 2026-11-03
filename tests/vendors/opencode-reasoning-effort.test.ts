import { describe, expect, it } from "vitest";

import { buildPiModel, streamOpencode } from "../../src/vendors/opencode/protocol";

/**
 * 思考强度的透传：**选什么发什么，不静默改写**（2026-11-03 报障）。
 *
 * ## 现象一：选择被丢掉
 *
 * 用户选了 `max`，请求里却从来没有 `reasoning_effort`。插件只把档位当作**界面选项**
 * 报给宿主（`resolveModel().reasoning.efforts`），组装请求时把选择丢了 ——
 * 界面能选，实际一直是网关默认强度。
 *
 * ## 现象二：选择被改写
 *
 * 补上透传后仍不对：pi-ai 的 `clampThinkingLevel` 只保留「`thinkingLevelMap` 里出现过」
 * 的档位，其余降级成邻近档位 —— 实测 `max` 变成了 `high`。
 *
 * ## 边界：只认真实存在的档位
 *
 * deepseek-v4.1-flash 的网关实测只公布 **`low` / `high` / `max`** 三个
 * （`GET /models` 的 `capabilities.reasoning.effort`，与 models.dev 的
 * `reasoning_options` 一致）。所以映射表只写这三个，**不谎报** `minimal` / `medium` /
 * `xhigh` —— 给模型塞它没有的档位，也是一类「整错档位」。
 */
const BASE_URL = "https://opencode.ai/zen/go/v1";

/** 造一份能跑通的 SSE 响应（一个文本增量 + 结束）。 */
function sseResponse(): Response {
  const sse =
    'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":1}}\n\n' +
    "data: [DONE]\n\n";
  return new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** 网关为 deepseek-v4.1-flash 公布的档位（实测）。 */
type Declared = "low" | "high" | "max";

/**
 * 收集一次调用发出的请求正文。
 * @param effort - 用户选的档位（`undefined` = 没选）。
 * @returns 出站请求体。
 */
async function bodyOf(effort: Declared | undefined): Promise<Record<string, unknown>> {
  const seen: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    if (typeof init?.body === "string") seen.push(JSON.parse(init.body) as Record<string, unknown>);
    return sseResponse();
  }) as unknown as typeof fetch;

  const model = buildPiModel(
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      api: "openai-completions",
      reasoning: true,
      // 与网关公布的一致：只有这三个。
      efforts: ["low", "high", "max"],
      inputModalities: ["text"],
    },
    BASE_URL,
  );
  const stream = streamOpencode({
    model,
    context: { messages: [{ role: "user", content: "hi" }] } as never,
    apiKey: "test-key",
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
    fetchImpl,
  });
  // 把流跑完，请求才会真的发出。
  for await (const _chunk of stream) {
    // 丢弃 chunk，只关心出站正文
  }
  expect(seen.length, "应当发出恰好一次请求").toBeGreaterThan(0);
  return seen[0]!;
}

describe("思考强度必须透传到请求正文", () => {
  it("未指定档位时**不带**这个字段（不能凭空发一个默认值）", async () => {
    const body = await bodyOf(undefined);
    expect("reasoning_effort" in body, "没选档位就不该发").toBe(false);
  });
});

describe("**厂商公布的每个档位都原样发送**", () => {
  for (const level of ["low", "high", "max"] as const satisfies readonly Declared[]) {
    it(`「${level}」→ reasoning_effort: ${level}`, async () => {
      const body = await bodyOf(level);
      expect(body.reasoning_effort, `${level} 不能被改写成别的档位`).toBe(level);
    });
  }

  it("`max` 不会被降级成 `high`（这是原来最隐蔽的那个 bug）", async () => {
    const body = await bodyOf("max");
    expect(body.reasoning_effort).not.toBe("high");
    expect(body.reasoning_effort).toBe("max");
  });
});

describe("不谎报厂商没公布的档位", () => {
  /**
   * 模型只声明 `low` / `high` / `max`。用户若被塞一个 `medium`（外部状态、旧配置），
   * SDK 会按它自己的规则就近取 —— 但**我们绝不把 medium 写进映射表假装支持**。
   * 这里断言的是「映射表只含真实档位」这个事实，而不是某个具体降级结果。
   */
  it("映射表只包含 low / high / max", () => {
    const model = buildPiModel(
      {
        id: "deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        api: "openai-completions",
        reasoning: true,
        efforts: ["low", "high", "max"],
        inputModalities: ["text"],
      },
      BASE_URL,
    ) as unknown as { thinkingLevelMap?: Record<string, unknown> };
    expect(Object.keys(model.thinkingLevelMap ?? {}).sort()).toEqual(["high", "low", "max"]);
  });

  it("模型没声明档位时不产出映射表（不替它编一组）", () => {
    const model = buildPiModel(
      {
        id: "grok-4.7",
        name: "Grok 4.7",
        api: "openai-completions",
        reasoning: false,
        inputModalities: ["text"],
      },
      BASE_URL,
    ) as unknown as { thinkingLevelMap?: Record<string, unknown> };
    expect(model.thinkingLevelMap).toBeUndefined();
  });
});
