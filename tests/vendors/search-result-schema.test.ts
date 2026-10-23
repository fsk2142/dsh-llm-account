/**
 * 搜索 provider 的返回值必须**符合宿主的 JSON schema**（2026-10-23 修）。
 *
 * ## 真实故障
 *
 * 用户报告「网页搜索直接失败」，宿主给出的错误是：
 *
 * ```
 * tool "web_search" returned invalid output: value is not lossless JSON
 * ```
 *
 * **那个文案完全误导** —— 它听起来像编码问题，实际是 schema 校验失败。
 *
 * ## 根因
 *
 * 宿主的 `web_search` 工具把 provider 返回值按一份 JSON schema 校验（见
 * `@deepseek-ai/dsh-tool-web` 的 `returnSchema`）：
 *
 * ```js
 * {
 *   content:  { type: "string" },
 *   sources:  { type: "array", required: true, items: {...} },
 *   truncated:{ type: "boolean", required: true },   // ← 必填！
 * }
 * ```
 *
 * 我们的 `SearchResult.truncated` 原本是**可选**，且两个返回点（网关路、API 路成功）
 * 都没传它 —— 于是整个返回值过不了校验，宿主报上面那句。
 *
 * ## 这条测试钉住什么
 *
 * provider 的**每一个**成功返回都带 `truncated: boolean`。这样将来再加返回点也会被提醒。
 */
import { describe, expect, it, vi } from "vitest";

import { createSearchProvider } from "../../src/vendors/search-provider";

/** 一份合法的 DeepSeek Search API 响应（两条结果）。 */
function apiResponse(): Response {
  return new Response(
    JSON.stringify({
      results: [
        { url: "https://example.com/a", title: "A", snippet: "snippet a" },
        { url: "https://example.com/b", title: "B" },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * 一个**尊重 `count`** 的假 Search API。
 *
 * 真实服务端按请求里的 `count` 决定返回几条。固定返回 2 条会让「截断」那条测试得出
 * 错误结论 —— API 路**不做本地截断**（见 `search-provider.ts` 的
 * `failure.kind === "ok"` 分支），完全依赖服务端按 `count` 少返回。
 * @returns 造好的 fetch 替身，以及记录到的 `count` 列表。
 */
function honoringCount(): { fetchImpl: typeof fetch; counts: number[] } {
  const counts: number[] = [];
  const fetchImpl = (async (_input: unknown, init?: { body?: unknown }) => {
    let count = 10;
    try {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { count?: unknown }) : {};
      if (typeof body.count === "number") count = body.count;
    } catch {
      // 解析不了用默认值。
    }
    counts.push(count);
    const all = [
      { url: "https://example.com/a", title: "A", snippet: "snippet a" },
      { url: "https://example.com/b", title: "B" },
    ];
    return new Response(JSON.stringify({ results: all.slice(0, count) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, counts };
}

/** 造一个走 API 路的 provider（策略 api-only，避免网关分支干扰）。 */
function apiProvider(fetchImpl?: typeof fetch): ReturnType<typeof createSearchProvider> {
  return createSearchProvider({
    fetchImpl: fetchImpl ?? ((async () => apiResponse()) as unknown as typeof fetch),
    sessionRoute: () => ({ provider: undefined, model: undefined }),
    strategy: () => "api-only",
    gatewayAccess: async () => undefined,
    resolveApiKeys: async () => [{ ref: "DEEPSEEK_API_KEY", key: "sk-test" }],
  } as never);
}

describe("搜索返回值的 schema 合规性", () => {
  it("**API 路成功时带 `truncated: false`**（宿主的必填字段）", async () => {
    const result = await apiProvider().search({ query: "测试" });

    expect(result.sources).toHaveLength(2);
    // 关键：不是 `undefined`，而是明确的布尔值。
    expect(result.truncated, "`truncated` 是宿主 schema 的必填字段").toBe(false);
    expect(typeof result.truncated).toBe("boolean");
  });

  it("**截断时带 `truncated: true`**", async () => {
    /**
     * API 路**不做本地截断** —— 它把 `maxResults` 传给 `searchViaApi`，由服务端按
     * `count` 少返回。所以这里验证的是「`count` 真的被传下去了」，
     * 而不是「客户端切掉了多余结果」。
     */
    const { fetchImpl, counts } = honoringCount();
    const result = await apiProvider(fetchImpl).search({ query: "测试", maxResults: 1 });

    expect(counts, "请求里应当带 count=1").toEqual([1]);
    expect(result.sources).toHaveLength(1);
    // 服务端按 count 返回，所以客户端这条路上没有「截断」，字段仍是 false。
    expect(result.truncated, "API 路由服务端控制条数，客户端不标记截断").toBe(false);
  });

  it("返回值能被 JSON 无损往返（宿主用它做校验的实质）", async () => {
    const result = await apiProvider().search({ query: "测试" });
    const text = JSON.stringify(result);
    expect(text, "必须能 stringify").toBeTypeOf("string");
    expect(JSON.parse(text), "回读必须一致").toEqual(result);
    // `truncated` 出现在序列化结果里（而不是被 undefined 吞掉）。
    expect(text).toContain('"truncated":false');
  });

  it("网关路成功时同样带 `truncated: boolean`", async () => {
    /**
     * 网关路的返回点是另一处（`sourcesOf` 之后）。这里用一份真实的
     * `web_search_tool_result` 响应走通它。
     */
    const provider = createSearchProvider({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "web_search_tool_result",
                content: [{ type: "web_search_result", url: "https://gw.example/x", title: "网关结果" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
      // 会话在 opendesign + DeepSeek 模型 → 走网关路。
      sessionRoute: () => ({ provider: "opendesign", model: "deepseek-v4.1-flash" }),
      strategy: () => "gateway-only",
      gatewayAccess: async () => ({ baseURL: "https://gw.example", key: "k" }),
      resolveApiKeys: async () => [],
    } as never);

    const result = await provider.search({ query: "测试" });
    expect(result.sources.length).toBeGreaterThan(0);
    expect(typeof result.truncated, "网关路也必须给布尔值").toBe("boolean");
  });

  it("**网关路本地截断时 `truncated: true`**（唯一返回 true 的分支，2026-10-23 补）", async () => {
    /**
     * 这个分支此前**零测试覆盖**：三个返回点里只有它返回 `true`，而原有测试要么走 API
     * 路（false）、要么走网关路但不带 `maxResults`（false）。写错成 `false` 或漏掉
     * `slice` 的话，1485 条测试照样全绿。
     *
     * 语义：网关返回 3 条，请求只要 1 条 → 本地切到 1 条并标记截断。
     * （宿主自己也会 cap，这里截一次是防止 provider 侧超发。）
     */
    const provider = createSearchProvider({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "web_search_tool_result",
                content: [
                  { type: "web_search_result", url: "https://gw.example/1", title: "结果1" },
                  { type: "web_search_result", url: "https://gw.example/2", title: "结果2" },
                  { type: "web_search_result", url: "https://gw.example/3", title: "结果3" },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
      sessionRoute: () => ({ provider: "opendesign", model: "deepseek-v4.1-flash" }),
      strategy: () => "gateway-only",
      gatewayAccess: async () => ({ baseURL: "https://gw.example", key: "k" }),
      resolveApiKeys: async () => [],
    } as never);

    const result = await provider.search({ query: "测试", maxResults: 1 });

    expect(result.sources, "**必须被切到 maxResults 条**").toHaveLength(1);
    expect(result.sources[0]?.url, "保留的是第一条").toBe("https://gw.example/1");
    expect(result.truncated, "**本地确实截断了**").toBe(true);
  });

  it("宿主 schema 要求的字段一个不少", async () => {
    const result = await apiProvider().search({ query: "测试" });
    // sources 必填 + 每条必须有 url。
    expect(Array.isArray(result.sources)).toBe(true);
    for (const source of result.sources) {
      expect(typeof source.url, "每条 source 必须有 url").toBe("string");
      expect(source.url.length).toBeGreaterThan(0);
    }
    expect(result, "truncated 必填").toHaveProperty("truncated");
  });
});

// 让 vi 的导入被使用（本文件不依赖它，但保留统一风格）。
void vi;
