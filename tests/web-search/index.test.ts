/**
 * 行入口（`src/web-search/index.ts`）的**装配**测试。
 *
 * provider 自己的行为由 `provider.test.ts` 覆盖；这一层守的是接线：
 * 1. `Config` 的形状与 volatile 解包（卡片逐路径写的前置条件）；
 * 2. `apply` 是否把 provider 注册进 `ctx.web`（`inject: ["web"]` 的那一半）；
 * 3. 设置行与密钥都从 `ctx` **现取** —— 两次搜索之间改设置/补密钥必须立即生效，不许缓存
 *    （这是「跟随模型账号」的字面含义，也是本行不重启就能改设置的全部理由）。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { WebSearchProvider } from "@deepseek-ai/dsh-web";
import { afterEach, expect, it, vi } from "vitest";

import { Config, apply, inject, name, snapshotOf } from "../../src/web-search/index";
import {
  DEFAULT_SEARCH_KEY_REF,
  WEB_SEARCH_NAMESPACE,
  WEB_SEARCH_PROVIDER_ID,
} from "../../src/web-search/support";
import { unwrapVolatileConfig } from "../../src/vendors/assembly";

/** 假宿主 ctx：只实现本行入口真正用到的接缝（web 注册 + `ctx.get`）。 */
function fakeHost(services: Readonly<Record<string, unknown>> = {}): {
  ctx: Context;
  providers: WebSearchProvider[];
} {
  const providers: WebSearchProvider[] = [];
  const serviceMap = new Map(Object.entries(services));
  const host = {
    web: {
      registerSearchProvider(provider: WebSearchProvider): void {
        providers.push(provider);
      },
    },
    get: (serviceName: string): unknown => serviceMap.get(serviceName),
  };
  return { ctx: host as unknown as Context, providers };
}

/**
 * 服务端设置服务。
 *
 * `describe()` 返回**行数组**（`{ns, value, revision}`），与 `assembly.ts::requireSettingsRow`
 * 的判据一致 —— 客户端 remote 的信封（`{namespaces}`）是另一条路径，不要混。
 */
function settingsWith(rows: Record<string, Record<string, unknown>>): unknown {
  return {
    describe: (): unknown[] =>
      Object.entries(rows).map(([ns, value], index) => ({ ns, value, revision: index + 1 })),
    mutate: async (): Promise<void> => undefined,
  };
}

/** 宿主凭据服务（`credentialRef()` 运行时是带品牌的字符串，直接按名索引即可）。 */
function credentialsWith(keys: Record<string, string>): unknown {
  return {
    resolve: async (ref: string) => ({ value: keys[ref] }),
    describe: async (ref: string) => ({ configured: (keys[ref] ?? "").trim() !== "" }),
    set: async (ref: string, value: string): Promise<void> => {
      keys[ref] = value;
    },
    unset: async (ref: string): Promise<void> => {
      delete keys[ref];
    },
  };
}

/** 默认模型 = Command Code（账号模式唯一受支持的厂商）。 */
function commandCodeRows(): Record<string, Record<string, unknown>> {
  return {
    "agent-default-model": { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
    "llm-commandcode": { apiKeyEnv: "COMMANDCODE_API_KEY", apiBase: "https://api.commandcode.ai" },
  };
}

/** 一次成功的 Messages 搜索响应（一个结果块）。 */
function searchPayload(): unknown {
  return {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          {
            type: "web_search_result",
            url: "https://r.example",
            title: "R",
            page_age: "2026-02-02",
          },
        ],
      },
    ],
  };
}

/** 捕获 fetch 调用并按载荷作答。 */
function fetchRecorder(payload: unknown): { calls: { url: string; init?: RequestInit }[]; impl: typeof fetch } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, impl };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("行身份：模块名就是设置命名空间，注入面只进 web", () => {
  expect(name).toBe(WEB_SEARCH_NAMESPACE);
  expect(inject).toEqual(["web"]);
});

it("Config：默认值齐全，且解包 volatile 后就是运行期快照", () => {
  const parsed = Config({} as never) as unknown as Record<string, unknown>;
  expect(snapshotOf(unwrapVolatileConfig(parsed))).toEqual({
    mode: "account",
    endpoint: "",
    method: "GET",
    queryParam: "q",
    queryField: "query",
    keyField: "",
    resultsPath: "",
    apiKeyEnv: DEFAULT_SEARCH_KEY_REF,
    authHeader: "Authorization",
    authScheme: "Bearer",
  });
});

it("snapshotOf：手改过的文档里坏值一律回落，不抛也不打断搜索", () => {
  expect(
    snapshotOf({ mode: "断网", method: "DELETE", queryParam: 42, apiKeyEnv: "  ", authScheme: null }),
  ).toEqual({
    mode: "account",
    endpoint: "",
    method: "GET",
    queryParam: "q",
    queryField: "query",
    keyField: "",
    resultsPath: "",
    apiKeyEnv: DEFAULT_SEARCH_KEY_REF,
    authHeader: "Authorization",
    authScheme: "Bearer",
  });
  // 非法引用名（旧插件的 `account-2` 内联槽那种）也回落默认，而不是带着查不到的引用跑。
  expect(snapshotOf({ apiKeyEnv: "account-2" }).apiKeyEnv).toBe(DEFAULT_SEARCH_KEY_REF);
  // 空串有意义的字段保持空串：Key 走请求头、自动探测结果数组、不带认证头。
  const blanks = snapshotOf({ keyField: "", resultsPath: "", authHeader: "", authScheme: "" });
  expect(blanks.keyField).toBe("");
  expect(blanks.resultsPath).toBe("");
  expect(blanks.authHeader).toBe("");
  expect(blanks.authScheme).toBe("");
  // 首尾空白裁掉（否则查询参数名会带着空格发出去）。
  expect(snapshotOf({ queryParam: " q " }).queryParam).toBe("q");
});

it("apply：把 provider 注册进 ctx.web，接缝全缺席时 available() 为 false 而不是抛错", () => {
  const host = fakeHost();
  apply(host.ctx);

  expect(host.providers).toHaveLength(1);
  const provider = host.providers[0]!;
  expect(provider.id).toBe(WEB_SEARCH_PROVIDER_ID);
  expect(typeof provider.available).toBe("function");
  expect(typeof provider.search).toBe("function");
  expect(provider.available()).toBe(false);
});

it("账号模式端到端：设置行与密钥都从 ctx 现取，搜索打到厂商的 Messages 端点", async () => {
  const keys: Record<string, string> = { COMMANDCODE_API_KEY: "sk-cc" };
  const host = fakeHost({
    settings: settingsWith(commandCodeRows()),
    credentials: credentialsWith(keys),
  });
  const { calls, impl } = fetchRecorder(searchPayload());
  vi.stubGlobal("fetch", impl);

  apply(host.ctx);
  const provider = host.providers[0]!;
  expect(provider.available()).toBe(true);

  const result = await provider.search({ query: "今天北京天气" });
  expect(result.sources).toEqual([{ url: "https://r.example", title: "R", publishedAt: "2026-02-02" }]);
  expect(result.truncated).toBe(false);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://api.commandcode.ai/provider/v1/messages");
  const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
  expect(headers.authorization).toBe("Bearer sk-cc");
  expect(headers["anthropic-version"]).toBe("2023-06-01");
  const body = JSON.parse(String(calls[0]?.init?.body)) as {
    model: string;
    tools: { name: string }[];
  };
  expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
  expect(body.tools[0]?.name).toBe("web_search");
});

it("密钥是现读的：第一次搜索报缺密钥，凭据补齐后同一个 provider 立即能搜（不用重注册）", async () => {
  const keys: Record<string, string> = {};
  const host = fakeHost({
    settings: settingsWith(commandCodeRows()),
    credentials: credentialsWith(keys),
  });
  const { calls, impl } = fetchRecorder(searchPayload());
  vi.stubGlobal("fetch", impl);

  apply(host.ctx);
  const provider = host.providers[0]!;
  // 便宜的本地判定只看「行里有没有引用名」，不读凭据值（与宿主契约一致）。
  expect(provider.available()).toBe(true);

  await expect(provider.search({ query: "x" })).rejects.toMatchObject({
    code: "WEB_PROVIDER_CREDENTIAL_MISSING",
  });
  expect(calls).toHaveLength(0);

  keys.COMMANDCODE_API_KEY = "sk-late";
  const result = await provider.search({ query: "x" });
  expect(result.sources).toHaveLength(1);
  expect(calls).toHaveLength(1);
});

it("接入一个不支持的厂商时：搜索前就说明原因（不假装能用）", async () => {
  const host = fakeHost({
    settings: settingsWith({
      "agent-default-model": { provider: "dsh-opencode-go", model: "m" },
      "llm-opencode-go": { apiKeyEnv: "OPENCODE_KEY" },
    }),
    credentials: credentialsWith({ OPENCODE_KEY: "k" }),
  });
  const { calls, impl } = fetchRecorder(searchPayload());
  vi.stubGlobal("fetch", impl);

  apply(host.ctx);
  const provider = host.providers[0]!;
  expect(provider.available()).toBe(false);
  await expect(provider.search({ query: "x" })).rejects.toMatchObject({ code: "WEB_PROVIDER_ERROR" });
  expect(calls).toHaveLength(0);
});
