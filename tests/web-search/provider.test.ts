/**
 * `llm-account-web` provider：路由/可用性判定与两条搜索路径的分派。
 * @module dsh-llm-account/tests/web-search/provider
 */
import { WebError } from "@deepseek-ai/dsh-web";
import { expect, it } from "vitest";

import {
  LlmAccountWebSearchProvider,
  activeRouteOf,
  type WebSearchConfigSnapshot,
  type WebSearchDeps,
} from "../../src/web-search/provider";

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

/** 一份默认配置（账号模式）。 */
function configOf(overrides: Partial<WebSearchConfigSnapshot> = {}): WebSearchConfigSnapshot {
  return {
    mode: "account",
    endpoint: "",
    method: "GET",
    queryParam: "q",
    queryField: "query",
    keyField: "",
    resultsPath: "",
    apiKeyEnv: "LLM_ACCOUNT_SEARCH_KEY",
    authHeader: "Authorization",
    authScheme: "Bearer",
    ...overrides,
  };
}

/** 假的运行期依赖（设置行按候选名现查）。 */
function depsOf(input: {
  config?: Partial<WebSearchConfigSnapshot>;
  rows?: Record<string, Record<string, unknown>>;
  credentials?: Record<string, string>;
  fetchImpl?: typeof fetch;
} = {}): WebSearchDeps {
  const rows = input.rows ?? {};
  return {
    config: () => configOf(input.config),
    settingsRow: (candidateIds) => {
      for (const id of candidateIds) {
        const row = rows[id];
        if (row !== undefined) return row;
      }
      return undefined;
    },
    resolveCredential: async (ref) => input.credentials?.[ref],
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  };
}

/** 一条「模型账号 = Command Code」的设置行。 */
function commandCodeRows(): Record<string, Record<string, unknown>> {
  return {
    "agent-default-model": { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
    "llm-commandcode": { apiKeyEnv: "COMMANDCODE_API_KEY", apiBase: "https://api.commandcode.ai" },
  };
}

/** 一份成功的 Messages 响应。 */
function anthropicPayload(): unknown {
  return {
    content: [
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", url: "https://r.example", title: "R", page_age: "2026-02-02" }],
      },
    ],
  };
}

it("available：账号模式下按默认模型的厂商判定", () => {
  const provider = new LlmAccountWebSearchProvider(
    depsOf({ rows: commandCodeRows(), credentials: { COMMANDCODE_API_KEY: "fsk-1" } }),
  );
  expect(provider.id).toBe("llm-account-web");
  expect(provider.available()).toBe(true);

  const unsupported = new LlmAccountWebSearchProvider(
    depsOf({
      rows: {
        "agent-default-model": { provider: "dsh-opencode-go", model: "m" },
        "llm-opencode-go": { apiKeyEnv: "OPENCODE_KEY" },
      },
    }),
  );
  expect(unsupported.available()).toBe(false);

  const noAccount = new LlmAccountWebSearchProvider(
    depsOf({ rows: { "agent-default-model": { provider: "commandcode", model: "m" } } }),
  );
  expect(noAccount.available()).toBe(false);

  const noModel = new LlmAccountWebSearchProvider(depsOf({ rows: {} }));
  expect(noModel.available()).toBe(false);
});

it("available：第三方模式按端点是否合法判定", () => {
  const good = new LlmAccountWebSearchProvider(depsOf({ config: { mode: "custom", endpoint: "https://s.example" } }));
  expect(good.available()).toBe(true);
  const bad = new LlmAccountWebSearchProvider(depsOf({ config: { mode: "custom", endpoint: "" } }));
  expect(bad.available()).toBe(false);
});

it("activeRouteOf：缺 provider/model 一律 undefined", () => {
  expect(activeRouteOf(depsOf({ rows: commandCodeRows() }).settingsRow)).toEqual({
    providerId: "commandcode",
    model: "deepseek/deepseek-v4.1-flash",
  });
  expect(activeRouteOf(depsOf({ rows: { "agent-default-model": { model: "m" } } }).settingsRow)).toBeUndefined();
  expect(activeRouteOf(depsOf({ rows: {} }).settingsRow)).toBeUndefined();
});

it("账号搜索：打到厂商的 Messages 端点，带上账号密钥与当前模型", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(anthropicPayload()), { status: 200 });
  }) as typeof fetch;

  const provider = new LlmAccountWebSearchProvider(
    depsOf({ rows: commandCodeRows(), credentials: { COMMANDCODE_API_KEY: "fsk-1" }, fetchImpl }),
  );
  const result = await provider.search({ query: "hello" });

  expect(result.sources).toEqual([{ url: "https://r.example", title: "R", publishedAt: "2026-02-02" }]);
  expect(calls[0]?.url).toBe("https://api.commandcode.ai/provider/v1/messages");
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer fsk-1");
  const body = JSON.parse(String(calls[0]?.init?.body)) as { model: string };
  expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
});

it("账号搜索：厂商行里的 apiBase 覆盖默认基址", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    calls.push(String(input));
    return new Response(JSON.stringify(anthropicPayload()), { status: 200 });
  }) as typeof fetch;
  const rows = commandCodeRows();
  rows["llm-commandcode"] = { apiKeyEnv: "COMMANDCODE_API_KEY", apiBase: "https://proxy.internal" };
  const provider = new LlmAccountWebSearchProvider(
    depsOf({ rows, credentials: { COMMANDCODE_API_KEY: "k" }, fetchImpl }),
  );
  await provider.search({ query: "q" });
  expect(calls[0]).toBe("https://proxy.internal/provider/v1/messages");
});

it("账号搜索：密钥缺失走 WEB_PROVIDER_CREDENTIAL_MISSING，不发请求", async () => {
  let called = 0;
  const fetchImpl = (async (): Promise<Response> => {
    called += 1;
    return new Response("{}");
  }) as typeof fetch;
  const provider = new LlmAccountWebSearchProvider(depsOf({ rows: commandCodeRows(), fetchImpl }));
  const error = await rejectionOf(() => provider.search({ query: "q" }));
  expect(error.code).toBe("WEB_PROVIDER_CREDENTIAL_MISSING");
  expect(error.message).toContain("COMMANDCODE_API_KEY");
  expect(called).toBe(0);
});

it("账号搜索：厂商不支持时给出人话原因（不假装能用）", async () => {
  const provider = new LlmAccountWebSearchProvider(
    depsOf({
      rows: {
        "agent-default-model": { provider: "dsh-opencode-go", model: "m" },
        "llm-opencode-go": { apiKeyEnv: "OPENCODE_KEY" },
      },
      credentials: { OPENCODE_KEY: "k" },
    }),
  );
  const error = await rejectionOf(() => provider.search({ query: "q" }));
  expect(error.code).toBe("WEB_PROVIDER_ERROR");
  expect(error.message).toContain("OpenCode");
  expect(error.message).toContain("OpenAI Chat Completions");
});

it("账号搜索：没有默认模型行时也说清原因", async () => {
  const provider = new LlmAccountWebSearchProvider(depsOf({ rows: {} }));
  const error = await rejectionOf(() => provider.search({ query: "q" }));
  expect(error.message).toContain("agent-default-model");
});

it("第三方搜索：按配置发出去，缺密钥时不带认证头", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ results: [{ url: "https://x.example" }] }), { status: 200 });
  }) as typeof fetch;

  const provider = new LlmAccountWebSearchProvider(
    depsOf({ config: { mode: "custom", endpoint: "https://s.example/api" }, fetchImpl }),
  );
  const result = await provider.search({ query: "hi" });
  expect(result.sources).toEqual([{ url: "https://x.example" }]);
  expect(new URL(calls[0]?.url ?? "").searchParams.get("q")).toBe("hi");
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
});

it("第三方搜索：端点非法时先报错（available 也会是 false）", async () => {
  const provider = new LlmAccountWebSearchProvider(depsOf({ config: { mode: "custom", endpoint: "nope" } }));
  expect(provider.available()).toBe(false);
  const error = await rejectionOf(() => provider.search({ query: "hi" }));
  expect(error.message).toContain("not a valid URL");
});
