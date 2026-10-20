/**
 * Search API 路：直连 `POST /v1/tools/search`（2026-10-20 用户要求）。
 *
 * 与网关路的区别（官方文档确认）：
 * - 端点：`https://api.deepseek.com/v1/tools/search`，`Authorization: Bearer <key>`
 * - 请求：`{ query, count?, ori_question?, localization?, need_content? }`
 * - 响应：`{ results: [{ title, url, snippet, summary, content, site_name, date, authority, rerank_score }] }`
 * - 计费：每 1000 次**成功**请求 5 元（不吃 token）
 *
 * 这条路的两个要点：
 * 1. **不烧对话 token** —— 不用让模型先决定搜什么；
 * 2. **失败要能区分**：402（余额不足）/ 401（key 无效）/ 429（QPS）各自给出可读原因，
 *    而不是统一一句「搜索失败」。
 */
import { describe, expect, it } from "vitest";

import { probeSearchKey, searchViaApi, SEARCH_API_PATH } from "../../src/vendors/search-api";

/** 一份成功的响应。 */
function okResponse() {
  return {
    results: [
      {
        title: "今日热点",
        url: "https://news.example/a",
        snippet: "短摘要",
        summary: "长摘要，适合给模型读",
        content: "",
        site_name: "Example News",
        date: "2026-10-20T00:00:00+00:00",
        authority: 3,
        rerank_score: 2.4,
      },
      { title: "第二条", url: "https://news.example/b", snippet: "s2" },
    ],
  };
}

/** 造一个假 fetch。 */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("请求形状", () => {
  it("打到 /v1/tools/search，带 Bearer 鉴权", async () => {
    const { impl, calls } = fakeFetch(okResponse());
    await searchViaApi({ query: "今日热点新闻", key: "sk-test", fetchImpl: impl });
    expect(calls[0]?.url).toBe(`https://api.deepseek.com${SEARCH_API_PATH}`);
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("count 取自 maxResults（官方范围 1–50，超出会 400）", async () => {
    const { impl, calls } = fakeFetch(okResponse());
    await searchViaApi({ query: "q", key: "sk", maxResults: 5, fetchImpl: impl });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.count).toBe(5);
  });

  it("maxResults 超上限时夹到 50，不把非法值发出去", async () => {
    const { impl, calls } = fakeFetch(okResponse());
    await searchViaApi({ query: "q", key: "sk", maxResults: 999, fetchImpl: impl });
    expect((JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>).count).toBe(50);
  });

  it("不传 maxResults 时不编一个值（让服务端用它的默认）", async () => {
    const { impl, calls } = fakeFetch(okResponse());
    await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    expect((JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>).count).toBeUndefined();
  });

  it("不请求正文（need_content 默认 false，正文不进上下文）", async () => {
    const { impl, calls } = fakeFetch(okResponse());
    await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.need_content).not.toBe(true);
  });
});

describe("响应解析", () => {
  it("把 results 映射成统一的 sources（url + title）", async () => {
    const { impl } = fakeFetch(okResponse());
    const result = await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    expect(result.sources).toEqual([
      { url: "https://news.example/a", title: "今日热点" },
      { url: "https://news.example/b", title: "第二条" },
    ]);
  });

  it("缺 url 的条目丢掉（不能渲染一个点不动的链接）", async () => {
    const { impl } = fakeFetch({ results: [{ title: "no url" }, { url: "https://x.example", title: "ok" }] });
    const result = await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.url).toBe("https://x.example");
  });

  it("缺 title 时用 url 兜底", async () => {
    const { impl } = fakeFetch({ results: [{ url: "https://x.example" }] });
    const result = await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    expect(result.sources[0]?.title).toBe("https://x.example");
  });

  it("空 results 是**合法**结果（真的没搜到），不是错误", async () => {
    const { impl } = fakeFetch({ results: [] });
    const result = await searchViaApi({ query: "q", key: "sk", fetchImpl: impl });
    expect(result.sources).toEqual([]);
  });

  it("没有 results 字段 → 抛错（形状不认识，不能当「没搜到」）", async () => {
    const { impl } = fakeFetch({ ok: true });
    await expect(searchViaApi({ query: "q", key: "sk", fetchImpl: impl })).rejects.toThrow(/results/);
  });
});

describe("失败原因要能区分", () => {
  it("401 → 说明 key 无效", async () => {
    const { impl } = fakeFetch({ error: { message: "bad key" } }, 401);
    await expect(searchViaApi({ query: "q", key: "sk", fetchImpl: impl })).rejects.toThrow(/401/);
  });

  it("402 → 说明余额不足（这是最需要人话的一条）", async () => {
    const { impl } = fakeFetch({ error: { message: "insufficient balance" } }, 402);
    await expect(searchViaApi({ query: "q", key: "sk", fetchImpl: impl })).rejects.toThrow(/余额/);
  });

  it("429 → 说明限流", async () => {
    const { impl } = fakeFetch({ error: { message: "rate limited" } }, 429);
    await expect(searchViaApi({ query: "q", key: "sk", fetchImpl: impl })).rejects.toThrow(/429/);
  });

  it("把服务端给的 message 带进错误（不吞掉诊断信息）", async () => {
    const { impl } = fakeFetch({ error: { message: "'count' must be between 1 and 50" } }, 400);
    await expect(searchViaApi({ query: "q", key: "sk", fetchImpl: impl })).rejects.toThrow(/count/);
  });
});

describe("密钥实测：分档决定界面上说什么", () => {
  it("200 → ok（哪怕一条结果都没有，也说明鉴权与配额都通过了）", async () => {
    const { impl } = fakeFetch({ results: [] });
    await expect(probeSearchKey({ key: "sk-ok", fetchImpl: impl })).resolves.toEqual({ state: "ok" });
  });

  it("401/402/403 → invalid（服务端明确说这把密钥不行）", async () => {
    for (const status of [401, 402, 403]) {
      const { impl } = fakeFetch({ error: { message: "nope" } }, status);
      const result = await probeSearchKey({ key: "sk-x", fetchImpl: impl });
      expect(result.state, `HTTP ${status}`).toBe("invalid");
      expect(result.reason).toBeDefined();
    }
  });

  it("429 / 5xx → unknown（那不是密钥的问题，不能让人去换一把好密钥）", async () => {
    for (const status of [429, 500, 503]) {
      const { impl } = fakeFetch({ error: { message: "later" } }, status);
      const result = await probeSearchKey({ key: "sk-x", fetchImpl: impl });
      expect(result.state, `HTTP ${status}`).toBe("unknown");
    }
  });

  it("网络层抛错 → unknown", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await probeSearchKey({ key: "sk-x", fetchImpl: impl });
    expect(result.state).toBe("unknown");
    expect(result.reason).toContain("fetch failed");
  });

  it("**含非 ASCII 的密钥 → invalid，且根本不发请求**", async () => {
    // 2026-10-20 真机数据：用户把一段中文误存成 DEEPSEEK_API_KEY，`configured` 一直是 true，
    // 而每次搜索都在构造请求头时就抛 ByteString 错误。实测必须当场说清楚。
    let called = 0;
    const impl = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await probeSearchKey({ key: "继续全力修补", fetchImpl: impl });
    expect(result.state).toBe("invalid");
    expect(result.reason).toContain("非 ASCII");
    expect(called, "本地就能判定的错误不该发请求（也不花钱）").toBe(0);
  });

  it("实测请求是最小的一次（count: 1），计费按请求次数所以必须小", async () => {
    const { impl, calls } = fakeFetch({ results: [] });
    await probeSearchKey({ key: "sk-ok", fetchImpl: impl });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.count).toBe(1);
  });
});
