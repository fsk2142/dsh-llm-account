/**
 * `llm-account-web` provider：把「网页搜索」的两种来源接进宿主 `ctx.web`。
 *
 * 选项快照做成 thunk（每次操作现取一次），设置改了立即生效、不用重注册 provider
 * ——宿主自己的实现也是这个理由（`dsh-web-search-deepseek` 的 `resolveOptions` 注释）。
 *
 * 账号模式的路由事实（当前默认模型 → 厂商 → 端点/密钥）全部**现读宿主设置**：
 * 「跟随模型账号」的字面含义就是跟着 `agent-default-model` 走，而不是自己再存一份。
 * @module dsh-llm-account/src/web-search/provider
 */
import { WebError } from "@deepseek-ai/dsh-web";
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from "@deepseek-ai/dsh-web";

import { DEFAULT_API_BASE, protocolEndpoint } from "../vendors/commandcode/protocol";
import { searchViaAnthropicMessages } from "./anthropic";
import { searchViaCustomApi } from "./custom";
import { WEB_SEARCH_PROVIDER_ID, nativeSearchSupportOf, type WebSearchMode } from "./support";
import { stringField } from "./util";

/** 本模块配置的一次快照（provider 的每个操作开头取一份，操作中途不再变）。 */
export interface WebSearchConfigSnapshot {
  readonly mode: WebSearchMode;
  readonly endpoint: string;
  readonly method: "GET" | "POST";
  readonly queryParam: string;
  readonly queryField: string;
  readonly keyField: string;
  readonly resultsPath: string;
  readonly apiKeyEnv: string;
  readonly authHeader: string;
  readonly authScheme: string;
}

/** provider 的运行期依赖（全部按需现取，便于测试替身）。 */
export interface WebSearchDeps {
  /** 现读本模块配置。 */
  readonly config: () => WebSearchConfigSnapshot;
  /** 现读宿主设置里某一行（按候选行名，找不到返回 `undefined`）。 */
  readonly settingsRow: (candidateIds: readonly string[]) => Record<string, unknown> | undefined;
  /** 现读凭据。 */
  readonly resolveCredential: (ref: string) => Promise<string | undefined>;
  /** 测试注入的 fetch（缺省用全局 fetch）。 */
  readonly fetchImpl?: typeof fetch;
}

/** 当前默认模型所在的行名（宿主的 profile 行 id）。 */
const DEFAULT_MODEL_ROWS: readonly string[] = ["agent-default-model"];

/** 厂商路由 id → 该厂商设置行的候选名（行 id 与核心命名空间都列上）。 */
const VENDOR_ROWS: Readonly<Record<string, readonly string[]>> = {
  commandcode: ["llm-commandcode", "commandcode"],
  "dsh-opencode-go": ["llm-opencode-go", "opencode-go"],
  opendesign: ["llm-opendesign", "opendesign"],
};

/** 一次「跟随模型账号」解析出的路由事实。 */
export interface ActiveRoute {
  readonly providerId: string;
  readonly model: string;
}

/**
 * 从设置行里解析当前默认模型的路由（导出给测试）。
 * @param settingsRow - 现读一行的函数。
 * @returns 路由事实；行缺失或字段不合法时 `undefined`。
 */
export function activeRouteOf(settingsRow: WebSearchDeps["settingsRow"]): ActiveRoute | undefined {
  const value = settingsRow(DEFAULT_MODEL_ROWS);
  const providerId = stringField(value, "provider");
  const model = stringField(value, "model");
  if (providerId === undefined || providerId.length === 0) return undefined;
  if (model === undefined || model.length === 0) return undefined;
  return { providerId, model };
}

/**
 * 支持表的**可执行半边**：账号行的基地址 → Messages 端点。
 *
 * 端点构造是服务端知识（要拖 `@deepseek-ai/dsh-llm` 等依赖），不进客户端 bundle；
 * 客户端只读 `support.ts` 的纯数据表。
 * @param providerId - 厂商路由 id。
 * @param vendor - 该厂商的设置行值。
 * @returns Messages 端点；该厂商没有可执行支持时 `undefined`。
 */
function accountEndpointOf(providerId: string, vendor: Record<string, unknown> | undefined): string | undefined {
  if (providerId === "commandcode") {
    const base = stringField(vendor, "apiBase");
    return protocolEndpoint("messages", base !== undefined && base.length > 0 ? base : DEFAULT_API_BASE);
  }
  return undefined;
}

/** 账号行里的密钥引用（`apiKeyEnv`，宿主凭据服务的引用名）。 */
function accountKeyRef(vendor: Record<string, unknown> | undefined): string | undefined {
  const ref = stringField(vendor, "apiKeyEnv");
  return ref !== undefined && ref.length > 0 ? ref : undefined;
}

/** 现读一个厂商的设置行（未登记的厂商返回 `undefined`）。 */
function vendorRowOf(deps: WebSearchDeps, providerId: string): Record<string, unknown> | undefined {
  const candidates = VENDOR_ROWS[providerId];
  if (candidates === undefined) return undefined;
  return deps.settingsRow(candidates);
}

/**
 * 「网页搜索」provider。
 *
 * - `available()`：便宜的本地判定（不发网络），与宿主契约一致；
 * - `search()`：`account` 走账号网关的原生搜索，`custom` 走第三方接口；两条路的失败都
 *   以 `WebError` 抛出并带人话原因（哪一步、去哪里修），绝不静默。
 */
export class LlmAccountWebSearchProvider implements WebSearchProvider {
  readonly id = WEB_SEARCH_PROVIDER_ID;
  private readonly deps: WebSearchDeps;

  constructor(deps: WebSearchDeps) {
    this.deps = deps;
  }

  available(): boolean {
    const config = this.deps.config();
    if (config.mode === "custom") return URL.canParse(config.endpoint);
    const route = activeRouteOf(this.deps.settingsRow);
    if (route === undefined) return false;
    if (!nativeSearchSupportOf(route.providerId).supported) return false;
    const vendor = vendorRowOf(this.deps, route.providerId);
    return accountEndpointOf(route.providerId, vendor) !== undefined && accountKeyRef(vendor) !== undefined;
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const config = this.deps.config();
    if (config.mode === "custom") return this.searchCustom(config, request, signal);
    return this.searchAccount(request, signal);
  }

  /** 第三方接口这条路：端点来自配置，密钥来自本模块自己的凭据引用。 */
  private async searchCustom(
    config: WebSearchConfigSnapshot,
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResult> {
    if (!URL.canParse(config.endpoint)) {
      throw new WebError(
        `the third-party search endpoint is not a valid URL: ${JSON.stringify(
          config.endpoint,
        )}; set it in the plugin's 网页搜索 card (third-party API)`,
        "WEB_PROVIDER_ERROR",
      );
    }
    const ref = config.apiKeyEnv.trim();
    const key = ref.length === 0 ? undefined : await this.deps.resolveCredential(ref);
    return searchViaCustomApi(
      {
        endpoint: config.endpoint,
        method: config.method,
        queryParam: config.queryParam,
        queryField: config.queryField,
        keyField: config.keyField,
        resultsPath: config.resultsPath,
        ...(key === undefined || key.length === 0 ? {} : { key }),
        authHeader: config.authHeader,
        authScheme: config.authScheme,
      },
      request.query,
      signal,
      this.fetchOf(),
    );
  }

  /** 账号网关这条路：路由、端点与密钥全部现读宿主设置与凭据。 */
  private async searchAccount(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const route = activeRouteOf(this.deps.settingsRow);
    if (route === undefined) {
      throw new WebError(
        'no chat model account is configured (the "agent-default-model" settings row is missing or carries no provider/model), so the account-native web search cannot run; pick "DeepSeek 官方" or a third-party search API in the plugin\'s 网页搜索 card',
        "WEB_PROVIDER_ERROR",
      );
    }
    const support = nativeSearchSupportOf(route.providerId);
    const vendor = vendorRowOf(this.deps, route.providerId);
    const endpoint = support.supported ? accountEndpointOf(route.providerId, vendor) : undefined;
    if (endpoint === undefined) {
      throw new WebError(
        `the current model account (${support.label}) cannot run native web search: ${
          support.reason ?? "the gateway has no server-side search tool to declare"
        }. Pick "DeepSeek 官方" or a third-party search API in the plugin's 网页搜索 card`,
        "WEB_PROVIDER_ERROR",
      );
    }
    const ref = accountKeyRef(vendor);
    if (ref === undefined) {
      throw new WebError(
        `the ${support.label} account has no credential reference (apiKeyEnv) in its settings row, so the account-native web search has nothing to authenticate with; add or import an account in the ${support.label} card`,
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }
    const key = await this.deps.resolveCredential(ref);
    if (key === undefined || key.length === 0) {
      throw new WebError(
        `the credential "${ref}" is not configured; add or import an account in the ${support.label} card so the account-native web search can use it`,
        "WEB_PROVIDER_CREDENTIAL_MISSING",
      );
    }
    return searchViaAnthropicMessages({ endpoint, key, model: route.model }, request.query, signal, this.fetchOf());
  }

  /** 本次操作的 fetch 实现。 */
  private fetchOf(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }
}
