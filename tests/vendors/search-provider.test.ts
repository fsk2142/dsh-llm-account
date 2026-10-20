/**
 * 搜索提供方的**行为**测试（2026-10-20 用户要求：统一用 DeepSeek 搜索、网关额度优先）。
 *
 * 重点钉住三条（每一条都对应一个实测踩过的坑）：
 * 1. 200 但没有 `web_search_tool_result` → **必须抛错**，不能返回空 sources 冒充成功；
 * 2. 走错协议再怎么样都不该被当成"搜到了"；
 * 3. 选路按「opendesign + DeepSeek」判定，其余回退 API key。
 */
import { describe, expect, it } from "vitest";

import { createSearchProvider, SearchUnavailableError, sourcesOf } from "../../src/vendors/search-provider";

/** 一份「真的搜到了」的响应（形状取自实测）。 */
function searchResponse() {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [
      { type: "server_tool_use", id: "call_1", name: "web_search", input: { query: "q" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "call_1",
        content: [
          { type: "web_search_result", title: "Result A", url: "https://a.example/x" },
          { type: "web_search_result", title: "Result B", url: "https://b.example/y" },
        ],
      },
    ],
  };
}

/** 一份「200 但静默忽略」的响应（实测的 chat/completions 降级形态）。 */
function silentIgnoreResponse() {
  return {
    id: "chat_1",
    choices: [{ message: { role: "assistant", content: "\t\t\tweb_search query: xxx" } }],
  };
}

/** 造一个假 fetch：返回给定正文与状态。 */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** 一组默认依赖：网关可用、API key 也在。 */
function deps(overrides: Partial<Parameters<typeof createSearchProvider>[0]> = {}) {
  return {
    fetchImpl: fakeFetch(searchResponse()).impl,
    sessionRoute: () => ({ provider: "opendesign" as string | undefined, model: "deepseek-v4.1-flash" as string | undefined }),
    preferGateway: () => true,
    gatewayAccess: async () => ({ baseURL: "https://amr-link.open-design.ai/v1", key: "sk-gw" }),
    resolveApiKey: async () => "sk-api",
    ...overrides,
  };
}

describe("sourcesOf：抽结果，没有结果块就抛错", () => {
  it("正常响应抽出全部来源", () => {
    const result = sourcesOf(searchResponse());
    expect(result.sources.map((source) => source.url)).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  it("**200 但静默忽略** → 抛错（这是最危险的降级形态）", () => {
    expect(() => sourcesOf(silentIgnoreResponse())).toThrow(SearchUnavailableError);
  });

  it("没有 content 数组 → 抛错", () => {
    expect(() => sourcesOf({})).toThrow(SearchUnavailableError);
  });

  it("结果块在但里面是空的 → 不抛（那是「真的没搜到」，与「没执行」不同）", () => {
    const result = sourcesOf({ content: [{ type: "web_search_tool_result", content: [] }] });
    expect(result.sources).toEqual([]);
  });

  it("缺 title 时用 url 兜底（不丢这一条）", () => {
    const result = sourcesOf({
      content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://x.example" }] }],
    });
    expect(result.sources[0]?.title).toBe("https://x.example");
  });
});

describe("选路", () => {
  it("opendesign + DeepSeek → 打网关基地址、带网关密钥", async () => {
    const { impl, calls } = fakeFetch(searchResponse());
    const provider = createSearchProvider(deps({ fetchImpl: impl }));
    await provider.search({ query: "hello" });
    expect(calls[0]?.url).toBe("https://amr-link.open-design.ai/v1/messages");
    expect((calls[0]?.init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-gw");
  });

  it("非 DeepSeek 模型 → 回退 API 基地址、带 API key", async () => {
    const { impl, calls } = fakeFetch(searchResponse());
    const provider = createSearchProvider(
      deps({
        fetchImpl: impl,
        sessionRoute: () => ({ provider: "opendesign", model: "glm-5.3-flash" }),
      }),
    );
    await provider.search({ query: "hello" });
    expect(calls[0]?.url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect((calls[0]?.init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-api");
  });

  it("两条路都不可用 → 抛错并说明原因（不发请求）", async () => {
    const { impl, calls } = fakeFetch(searchResponse());
    const provider = createSearchProvider(
      deps({
        fetchImpl: impl,
        sessionRoute: () => ({ provider: "commandcode", model: "deepseek/x" }),
        resolveApiKey: async () => undefined,
      }),
    );
    await expect(provider.search({ query: "hello" })).rejects.toBeInstanceOf(SearchUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it("请求体带正确的工具类型与模型（裸 web_search 会被当成普通工具）", async () => {
    const { impl, calls } = fakeFetch(searchResponse());
    const provider = createSearchProvider(deps({ fetchImpl: impl }));
    await provider.search({ query: "hello" });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
  });

  it("maxResults 生效：多出来的截掉并标 truncated", async () => {
    const provider = createSearchProvider(deps());
    const result = await provider.search({ query: "hello", maxResults: 1 });
    expect(result.sources).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("HTTP 400 → 抛错并带状态码（网关不支持时要说清楚）", async () => {
    const { impl } = fakeFetch({ error: "bad" }, 400);
    const provider = createSearchProvider(deps({ fetchImpl: impl }));
    await expect(provider.search({ query: "hello" })).rejects.toThrow(/HTTP 400/);
  });
});
