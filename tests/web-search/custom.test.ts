/**
 * 第三方搜索接口（通用自定义）的请求组装与响应映射。
 * @module dsh-llm-account/tests/web-search/custom
 */
import { WebError } from "../../src/web-search/web-error";
import { expect, it } from "vitest";

import {
  buildCustomSearchRequest,
  mapCustomSearchPayload,
  searchViaCustomApi,
  type CustomSearchOptions,
} from "../../src/web-search/custom";

/** 捕获拒绝的错误。 */
async function rejectionOf(run: () => Promise<unknown>): Promise<WebError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WebError) return error;
    throw new Error(`expected a WebError, got ${String(error)}`);
  }
  throw new Error("expected the call to reject");
}

/** 一份默认的请求形状（GET + 无认证）。 */
function optionsOf(overrides: Partial<CustomSearchOptions> = {}): CustomSearchOptions {
  return {
    endpoint: "https://search.example/api",
    method: "GET",
    queryParam: "q",
    queryField: "query",
    keyField: "",
    resultsPath: "",
    authHeader: "Authorization",
    authScheme: "Bearer",
    ...overrides,
  };
}

it("GET：查询进参数，原有参数保留", () => {
  const built = buildCustomSearchRequest(optionsOf({ endpoint: "https://search.example/api?count=5" }), "hello world");
  const url = new URL(built.url);
  expect(url.searchParams.get("q")).toBe("hello world");
  expect(url.searchParams.get("count")).toBe("5");
  expect(built.init.method).toBe("GET");
  expect(built.init.body).toBeUndefined();
});

it("GET：自定义查询参数名", () => {
  const built = buildCustomSearchRequest(optionsOf({ queryParam: "query" }), "hi");
  expect(new URL(built.url).searchParams.get("query")).toBe("hi");
});

it("POST：查询与 Key 都进请求体（Tavily 形状），不带认证头", () => {
  const built = buildCustomSearchRequest(
    optionsOf({ method: "POST", queryField: "q", keyField: "api_key", key: "tvly-1" }),
    "hi",
  );
  expect(built.init.method).toBe("POST");
  expect(JSON.parse(String(built.init.body))).toEqual({ q: "hi", api_key: "tvly-1" });
  expect(new Headers(built.init.headers).get("authorization")).toBeNull();
});

it("POST：Key 走头时只带查询体", () => {
  const built = buildCustomSearchRequest(optionsOf({ method: "POST", key: "k-1" }), "hi");
  expect(JSON.parse(String(built.init.body))).toEqual({ query: "hi" });
  expect(new Headers(built.init.headers).get("authorization")).toBe("Bearer k-1");
});

it("认证头：方案可空（裸值）、头名可空（不带认证）", () => {
  const raw = buildCustomSearchRequest(optionsOf({ key: "k-1", authScheme: "" }), "hi");
  expect(new Headers(raw.init.headers).get("authorization")).toBe("k-1");
  const none = buildCustomSearchRequest(optionsOf({ key: "k-1", authHeader: "" }), "hi");
  expect(new Headers(none.init.headers).get("authorization")).toBeNull();
  const noKey = buildCustomSearchRequest(optionsOf(), "hi");
  expect(new Headers(noKey.init.headers).get("authorization")).toBeNull();
});

it("映射：Tavily 形状（results + answer）", () => {
  const result = mapCustomSearchPayload(
    {
      answer: "简答",
      results: [
        { title: "T", url: "https://t.example", content: "内容", published_date: "2026-01-02" },
        { title: "没有 url", content: "丢弃" },
      ],
    },
    "",
  );
  expect(result.content).toBe("简答");
  expect(result.sources).toEqual([
    { url: "https://t.example", title: "T", snippet: "内容", publishedAt: "2026-01-02" },
  ]);
});

it("映射：Brave / Serper / 字符串数组三种形状都能探测", () => {
  const brave = mapCustomSearchPayload(
    { web: { results: [{ title: "B", url: "https://b.example", description: "描述", age: "2 days" }] } },
    "",
  );
  expect(brave.sources[0]).toEqual({ url: "https://b.example", title: "B", snippet: "描述", publishedAt: "2 days" });

  const serper = mapCustomSearchPayload({ organic: [{ title: "S", link: "https://s.example", snippet: "摘要" }] }, "");
  expect(serper.sources[0]).toEqual({ url: "https://s.example", title: "S", snippet: "摘要" });

  const strings = mapCustomSearchPayload(["https://one.example", "不是 URL"], "");
  expect(strings.sources).toEqual([{ url: "https://one.example" }]);
});

it("映射：resultsPath 覆盖自动探测", () => {
  const result = mapCustomSearchPayload({ data: { hits: [{ link: "https://h.example" }] } }, "data.hits");
  expect(result.sources).toEqual([{ url: "https://h.example" }]);
});

it("映射：探测不到结果数组就报错并提示 resultsPath", async () => {
  const error = await rejectionOf(async () => mapCustomSearchPayload({ ok: true }, ""));
  expect(error.code).toBe("WEB_PROVIDER_ERROR");
  expect(error.message).toContain("no result array");
  expect(error.message).toContain("resultsPath");
});

it("映射：resultsPath 指到非数组也是错误", async () => {
  const error = await rejectionOf(async () => mapCustomSearchPayload({ data: { hits: "nope" } }, "data.hits"));
  expect(error.message).toContain("data.hits");
});

it("请求：成功时按配置发出去并返回映射结果", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ results: [{ url: "https://r.example", title: "R" }] }), { status: 200 });
  }) as typeof fetch;

  const result = await searchViaCustomApi(optionsOf({ endpoint: "https://search.example/api" }), "hello", undefined, fetchImpl);
  expect(result.sources).toEqual([{ url: "https://r.example", title: "R" }]);
  expect(new URL(calls[0]?.url ?? "").searchParams.get("q")).toBe("hello");
});

it("请求：HTTP 失败与非法地址都带端点报错", async () => {
  const failing = (async (): Promise<Response> => new Response("boom", { status: 500 })) as typeof fetch;
  const httpError = await rejectionOf(() =>
    searchViaCustomApi(optionsOf({ endpoint: "https://search.example/api" }), "q", undefined, failing),
  );
  expect(httpError.code).toBe("WEB_PROVIDER_ERROR");
  expect(httpError.message).toContain("HTTP 500");
  expect(httpError.message).toContain("https://search.example/api");

  const invalid = await rejectionOf(() => searchViaCustomApi(optionsOf({ endpoint: "not a url" }), "q", undefined, failing));
  expect(invalid.message).toContain("not a valid URL");
});

it("请求：非 JSON 响应报错带原文片段", async () => {
  const fetchImpl = (async (): Promise<Response> => new Response("<html>oops</html>", { status: 200 })) as typeof fetch;
  const error = await rejectionOf(() => searchViaCustomApi(optionsOf(), "q", undefined, fetchImpl));
  expect(error.message).toContain("did not return JSON");
  expect(error.message).toContain("<html>oops</html>");
});

it("请求：取消态直接 WEB_ABORTED，不发请求", async () => {
  let called = 0;
  const fetchImpl = (async (): Promise<Response> => {
    called += 1;
    return new Response("{}");
  }) as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  const error = await rejectionOf(() => searchViaCustomApi(optionsOf(), "q", controller.signal, fetchImpl));
  expect(error.code).toBe("WEB_ABORTED");
  expect(called).toBe(0);
});
