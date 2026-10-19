/**
 * 账号网关原生搜索（Anthropic Messages + `web_search_20250305`）的请求组装与解析。
 * @module dsh-llm-account/tests/web-search/anthropic
 */
import { WebError } from "../../src/web-search/web-error";
import { expect, it } from "vitest";

import {
  ANTHROPIC_VERSION,
  SEARCH_MAX_TOKENS,
  SEARCH_MAX_USES,
  WEB_SEARCH_TOOL_TYPE,
  buildAnthropicSearchBody,
  mapAnthropicSearchResponse,
  searchViaAnthropicMessages,
} from "../../src/web-search/anthropic";

/** 捕获拒绝的错误（断言 code 用；不是 WebError 也要显式失败）。 */
async function rejectionOf(run: () => Promise<unknown>): Promise<WebError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WebError) return error;
    throw new Error(`expected a WebError, got ${String(error)}`);
  }
  throw new Error("expected the call to reject");
}

/** 一份成功的 Messages 响应（结果块 + citation）。 */
function successPayload(urlA = "https://a.example", urlB = "https://b.example"): unknown {
  return {
    content: [
      {
        type: "text",
        text: "Here is what I found",
        citations: [
          { type: "web_search_result_location", url: urlA, cited_text: "A snippet" },
          { type: "web_search_result_location", url: urlA, cited_text: "另一个不该覆盖首个" },
        ],
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "t1",
        content: [
          { type: "web_search_result", url: urlA, title: "A", page_age: "2026-01-01" },
          { type: "web_search_result", url: urlB, title: "B" },
        ],
      },
    ],
  };
}

it("请求体逐字段对齐宿主原生搜索", () => {
  const body = buildAnthropicSearchBody({ model: "deepseek/deepseek-v4.1-flash", query: "今天的新闻" });
  expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
  expect(body.max_tokens).toBe(SEARCH_MAX_TOKENS);
  expect(body.tools).toEqual([{ type: WEB_SEARCH_TOOL_TYPE, name: "web_search", max_uses: SEARCH_MAX_USES }]);
  expect(body.thinking).toEqual({ type: "disabled" });
  expect(body.messages).toEqual([
    { role: "user", content: [{ type: "text", text: "Perform a web search for the query: 今天的新闻" }] },
  ]);
});

it("结果块 + citation 映射成来源，snippet 取首个 citation", () => {
  const result = mapAnthropicSearchResponse(successPayload());
  expect(result.truncated).toBe(false);
  expect(result.content).toBeUndefined();
  expect(result.sources).toEqual([
    { url: "https://a.example", title: "A", snippet: "A snippet", publishedAt: "2026-01-01" },
    { url: "https://b.example", title: "B" },
  ]);
});

it("同一 url 在多块/多条里只留一条", () => {
  const payload = {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.example", title: "第一" },
          { type: "web_search_result", url: "https://a.example", title: "重复" },
        ],
      },
    ],
  };
  const result = mapAnthropicSearchResponse(payload);
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0]?.title).toBe("第一");
});

it("没有结果块就是错误，不降级刮散文", async () => {
  const error = await rejectionOf(async () =>
    mapAnthropicSearchResponse({ content: [{ type: "text", text: "我搜到了几个链接 https://fake" }] }, "https://ep.example"),
  );
  expect(error.code).toBe("WEB_PROVIDER_ERROR");
  expect(error.message).toContain("web_search_tool_result");
  expect(error.message).toContain("https://ep.example");
});

it("一次成功请求带上鉴权头、版本头与查询体", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(successPayload()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await searchViaAnthropicMessages(
    { endpoint: "https://api.example/provider/v1/messages", key: "fsk-1", model: "m1" },
    "hello",
    undefined,
    fetchImpl,
  );

  expect(result.sources).toHaveLength(2);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://api.example/provider/v1/messages");
  expect(calls[0]?.init?.method).toBe("POST");
  const headers = new Headers(calls[0]?.init?.headers);
  expect(headers.get("authorization")).toBe("Bearer fsk-1");
  expect(headers.get("anthropic-version")).toBe(ANTHROPIC_VERSION);
  expect(headers.get("content-type")).toBe("application/json");
  const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string; messages: unknown[] };
  expect(body.model).toBe("m1");
  expect(JSON.stringify(body.messages)).toContain("Perform a web search for the query: hello");
});

it("401 的文案指向账号密钥（而不是端点）", async () => {
  const fetchImpl = (async (): Promise<Response> =>
    new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })) as typeof fetch;
  const error = await rejectionOf(() =>
    searchViaAnthropicMessages({ endpoint: "https://ep.example", key: "bad", model: "m" }, "q", undefined, fetchImpl),
  );
  expect(error.code).toBe("WEB_PROVIDER_ERROR");
  expect(error.message).toContain("401");
  expect(error.message).toContain("invalid api key");
  expect(error.message).toContain("account key was rejected");
});

it("402 的文案说明这是上游拒绝、不是密钥过期", async () => {
  const fetchImpl = (async (): Promise<Response> =>
    new Response("payment required", { status: 402 })) as typeof fetch;
  const error = await rejectionOf(() =>
    searchViaAnthropicMessages({ endpoint: "https://ep.example", key: "k", model: "m" }, "q", undefined, fetchImpl),
  );
  expect(error.code).toBe("WEB_PROVIDER_ERROR");
  expect(error.message).toContain("402");
  expect(error.message).toContain("not an expired key");
});

it("已在取消态就不发请求（WEB_ABORTED）", async () => {
  let called = 0;
  const fetchImpl = (async (): Promise<Response> => {
    called += 1;
    return new Response("{}");
  }) as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  const error = await rejectionOf(() =>
    searchViaAnthropicMessages({ endpoint: "https://ep.example", key: "k", model: "m" }, "q", controller.signal, fetchImpl),
  );
  expect(error.code).toBe("WEB_ABORTED");
  expect(called).toBe(0);
});
