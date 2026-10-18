/**
 * Open Design 的宿主适配器：把共享内核串成一次真实请求。
 *
 * 一次 `stream()` 的固定顺序（与另两家同一套）：
 * 1. `beforeRequest` 先问切换策略要不要换当前账号（辅助调用直接跳过）；
 * 2. `rotation.pick({ model, tried })` 选账号 —— 决策顺序在轮换引擎里，这里不另写规则；
 * 3. 收集凭据来源（凭据库 / 启动环境）交给 `pickApiKey`。**没有字面量与 auth.json 兜底**：
 *    Open Design 的 `Config` 没有 `role("secret")` 字段（计划 §2.7），本机登录产物则由登录
 *    端口一次性导入成普通凭据，请求路径不再读文件；
 * 4. 构造 Chat Completions 请求体（唯一的线协议，见 `./protocol`）发出，用 `runStream` 套上
 *    整请求 deadline 与流空闲看门狗；
 * 5. 失败时用 `classifyOpenDesignFailure` 分类、`markRejected` 记入轮换引擎，
 *    **只在 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真时**才换下一个账号；
 * 6. `tried.size` 达到 `MAX_TRIED` 时停止轮换，并把最后一次失败抛给宿主。
 *
 * **推理档位**：Open Design 的目录**不公布档位**（OpenAI 形状），所以声明与闸门都以
 * `./efforts` 的**逐模型实测表**（其次模型族）为准（目录哪天公布了就以目录为准）。宿主给了
 * `reasoningEffort` 时只核对一次，不在集合里的值**不发**。真的被网关拒（400 并点名
 * `reasoning_effort`）时按它回的白名单**降一档重发**，读不出白名单才去掉字段 —— 用户的选择
 * 最多退一档，不至于因为推错一个档位就整次请求失败。没有档位需求的请求不产生额外请求。
 *
 * 本任务**不**做：账号增删改（`./accounts`）、额度读取（`./quota`）、网页登录（`./login`）、
 * 套餐过滤与费用估算（第 2 期）。
 * @module dsh-llm-account/src/vendors/opendesign/adapter
 */
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
  TokenUsage,
} from "@deepseek-ai/dsh-llm";

import type { AccountPort, AccountView, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { pickApiKey } from "../../core/credentials";
import { MAX_TRIED, RotationEngine } from "../../core/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, runStream } from "../../core/transport";
import { parseCatalog } from "./catalog";
import { allowedEffortsIn, effortsFor, nearestAllowedEffort } from "./efforts";
import { classifyOpenDesignFailure, openDesignLlmError } from "./failures";
import {
  DEFAULT_BASE_URL,
  DEFAULT_GENERATE_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpenDesignStreamFailure,
  buildRequestBody,
  catalogRequest,
  decodeStream,
  generateRequest,
} from "./protocol";
import type { BodyFacts } from "./protocol";

/**
 * 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
 * `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
 */
const ABORTED_CODE = "ABORTED";

/** 目录请求的预算（与另两家的同一档）。 */
const MODELS_TIMEOUT_MS = 10_000;

/** 错误正文最多读多少字符（与另两家同一上限）。 */
const ERROR_BODY_LIMIT = 65_536;

/** 重试延迟上限（与另两家同一档）。 */
const RETRY_MAX_DELAY_MS = 900_000;

/**
 * 路由的重试白名单。`LLM_REQUEST_TIMEOUT` 与 `LLM_STREAM_IDLE_TIMEOUT` **不在**宿主的
 * `DEFAULT_RETRYABLE_CODES` 里，必须在此显式列出；保留这两个具体码（不退化成一个 `TIMEOUT`）
 * 是为了区分「整请求超时」与「流空闲超时」。
 */
const RETRYABLE_CODES: readonly string[] = [
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "THROTTLED",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
  LLM_REQUEST_TIMEOUT,
  LLM_STREAM_IDLE_TIMEOUT,
];

/**
 * Open Design 的配置形状。
 *
 * 全部字段缺省即可用；**没有** `apiKey` 这种字面量字段 —— Open Design 的密钥只来自凭据库或
 * 启动环境（全局约束：绝不允许从设置文档里读明文密钥）。
 */
export interface OpenDesignConfig {
  /** 网关基地址（文档字段名是 `baseURL`，入口映射过来）；缺省 {@link DEFAULT_BASE_URL}。 */
  apiBase?: string;
  /** 整请求 deadline（毫秒）；缺省 {@link DEFAULT_REQUEST_TIMEOUT_MS}。 */
  requestTimeoutMs?: number;
  /** 流空闲看门狗（毫秒）；缺省 {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}。 */
  streamIdleTimeoutMs?: number;
  /** 未指定 `maxTokens` 时的输出上限；缺省 {@link DEFAULT_GENERATE_MAX_TOKENS}。 */
  defaultMaxTokens?: number;
  /** 模型白名单（设置文档字段，形状不可信）。 */
  visibleModels?: readonly string[];
  /** 逐模型显式可见性开关（设置文档字段，形状不可信）。 */
  modelVisibility?: Readonly<Record<string, boolean>>;
}

/** 一次请求循环需要的、已填好默认值的配置。 */
interface ResolvedConfig {
  apiBase: string;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  defaultMaxTokens: number;
}

/**
 * 适配器的依赖。四个来源读取函数都是注入点：本模块不直接依赖 `ctx`（宿主服务在 `index.ts`
 * 接线），测试可以给假实现。
 */
export interface OpenDesignAdapterDeps {
  /** 每次请求重新读取的配置（volatile 字段据此立即生效）。 */
  config: () => OpenDesignConfig;
  /** 本请求的账号轮换与拒绝记忆。 */
  rotation: RotationEngine;
  /** 额度端口（本模块不读，由入口构造并使用）。 */
  quota: QuotaPort;
  /** 账号端口（本模块不写，由入口构造并使用）。 */
  accounts: AccountPort;
  /** 注入的 `fetch`（测试用假实现；生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /** `stored` 来源：凭据库读取（宿主 `credentials.resolve(ref)` 的注入点）。 */
  resolveStored?: (ref: string) => Promise<string | undefined>;
  /** `environment` 来源：启动环境读取（宿主 `launchEnvironmentOf(ctx).get(name)` 的注入点）。 */
  resolveEnvironment?: (name: string) => string | undefined;
  /** 普通对话请求前的切换钩子；辅助调用（compaction/session-title）不调用。 */
  beforeRequest?: (input: { sessionId?: string; purpose?: string }) => Promise<void>;
}

/** 填默认值；`0`/负数/NaN 一律回落到默认值，避免把坏配置变成「立即超时」。 */
function resolveConfig(raw: OpenDesignConfig): ResolvedConfig {
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    apiBase: raw.apiBase !== undefined && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_BASE_URL,
    requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
  };
}

/** 把系统提示折叠成一段文本（与另两家同一规则）。 */
function systemTextOf(options: GenerateOptions): string {
  const parts: string[] = [];
  if (options.system !== undefined && options.system !== "") parts.push(options.system);
  for (const message of options.messages) {
    if (message.role !== "system") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text !== "") parts.push(text);
  }
  return parts.join("\n\n");
}

/** 一次 usage chunk 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage: TokenUsage): number {
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** 读一份错误正文：最多读 {@link ERROR_BODY_LIMIT}，能解析成 JSON 就解析。 */
async function readErrorBody(response: Response): Promise<unknown> {
  let text = "";
  try {
    text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
  } catch {
    return undefined;
  }
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 错误正文是否点名了推理档位字段（用于「去掉该字段重发一次」的兜底判定）。
 *
 * 只认明确的字段名/字段语义，别把任意 400 都重放一遍 —— 那会把「上下文超长」这种
 * 确定性失败也发两次。
 * @param body - 已解析的错误正文（可能是对象，也可能是原始文本）。
 * @returns 是否提到档位字段。
 */
function mentionsEffortField(body: unknown): boolean {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return /reasoning[_\s-]?effort|unsupported[_\s-]?effort|effort[_\s-]?not[_\s-]?supported/i.test(text);
}

/** 分类出的一次失败：分类结果，以及轮换用尽时要抛给宿主的错误。 */
interface AttemptFailure {
  rejection: Rejection;
  thrown: unknown;
}

/** Open Design 适配器：宿主 `LlmAdapter` 的一个真实子类。 */
class OpenDesignAdapter extends LlmAdapter implements CatalogModelsPort {
  readonly #deps: OpenDesignAdapterDeps;

  /**
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: OpenDesignAdapterDeps) {
    super();
    this.#deps = deps;
  }

  /** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "Open Design" };
  }

  /**
   * 路由的重试白名单（与另两家同一份）。
   * @returns 已解析的重试策略。
   */
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return resolveRetryPolicy(
      {
        mode: "normal",
        maxRetries: 1_000,
        retryableCodes: [...RETRYABLE_CODES],
        backoff: { initialDelayMs: 500, maxDelayMs: RETRY_MAX_DELAY_MS, jitterRatio: 0.1 },
      },
      "llm-opendesign: retryPolicy",
    );
  }

  /**
   * 拉目录 → 应用可见性规则 → 映射为宿主形状（套餐过滤与免费置顶属第 2 期）。
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const raw = this.#deps.config();
    const entries = await this.#catalog(resolveConfig(raw));
    const visible = selectVisible(entries, normalizeVisibility(raw));
    return visible.map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
    }));
  }

  /**
   * 全部目录条目（**不受** `visibleModels` / `modelVisibility` 过滤），供设置页勾选。
   *
   * 与 `listModels` 的分工：那个回答「宿主的模型选择器该看到什么」，这个回答「厂商现在有哪些
   * 模型」—— 隐藏的模型也要出现在勾选列表里，否则用户没有入口把它重新打开。
   * @returns 目录里的模型 id 与名称。
   */
  async catalogModels(): Promise<CatalogModel[]> {
    const entries = await this.#catalog(resolveConfig(this.#deps.config()));
    return entries.map((entry) => ({ id: entry.id, ...(entry.name === "" ? {} : { name: entry.name }) }));
  }

  /**
   * 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力；目录不可用或没有该模型时
   * 退化成「只有 id 的目录外模型」，让请求走到 provider 再报错。
   *
   * 档位**只信目录自己声明的**（`./catalog`）：厂商不在别处公布档位，未声明就是不声明（宿主的
   * 档位选择器随之不出现）。
   */
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const config = resolveConfig(this.#deps.config());
    let entry: CatalogEntry | undefined;
    try {
      entry = (await this.#catalog(config, signal)).find((candidate) => candidate.id === model);
    } catch {
      // 目录是建议性的：拉不到也应该能解析模型身份，让请求走到 provider 再报错。
      entry = undefined;
    }
    // 目录声明优先，其次逐模型实测表 / 模型族兜底（Open Design 的目录**从不**公布档位 ——
    // 不兜底就永远没有思考强度可选，用户报障原话）。
    const efforts = effortsFor(model, entry?.efforts);
    return {
      provider,
      id: model,
      name: entry?.name ?? model,
      inputModalities: entry?.inputModalities ?? ["text"],
      ...(entry?.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } }),
      ...(entry?.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens }),
      ...(efforts.length === 0
        ? {}
        : { reasoning: { efforts: efforts.map((effort) => ({ id: ReasoningEffortId(effort), name: effort })) } }),
    };
  }

  /**
   * 流式请求：账号轮换 → 凭据 → 请求 → 时间预算 → 失败分类 → 有条件的账号回退。
   * @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
   * @returns 与线上同序的 chunk 流。
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined && options.stop.length > 0) {
      // 宿主契约：不支持的 stop 序列由适配器拒绝。
      throw new LlmError("llm-opendesign: Open Design 适配器不支持 stop 序列", "UNSUPPORTED_OPTION");
    }
    // 账号切换策略：在选号之前决定要不要换当前账号（辅助调用直接跳过）。
    await this.#deps.beforeRequest?.({
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    });
    const config = resolveConfig(this.#deps.config());
    const tried = new Set<string>();
    let lastFailure: AttemptFailure | undefined;

    for (;;) {
      const aborted = options.signal?.aborted === true;
      if (aborted) throw this.#abortError(options.signal);

      const ref = this.#deps.rotation.pick({ model: options.model, tried });
      if (ref === undefined) {
        // 没有可选账号：把最后一次失败原样抛出，否则说明一条可用凭据都没有。
        if (lastFailure !== undefined) throw lastFailure.thrown;
        throw new LlmError(
          `llm-opendesign: 没有可用于模型 "${options.model}" 的 Open Design 账号；请先在账号页添加账号，或把密钥写入凭据库`,
          "MISSING_CREDENTIAL",
        );
      }
      tried.add(ref);

      const key = await this.#resolveKey(ref);
      if (key === undefined) {
        // 没有可用密钥的账号不可能自行恢复：立刻记入拒绝表（`invalid-credential`
        // 只能被显式清除），否则每次请求都会重新选中它并再次失败。
        const rejection: Rejection = {
          kind: "invalid-credential",
          message: `Open Design 账号 "${ref}" 没有可用的推理密钥`,
        };
        this.#deps.rotation.markRejected(ref, rejection);
        lastFailure = {
          rejection,
          thrown: new LlmError(
            `llm-opendesign: Open Design 账号 "${ref}" 没有可用的推理密钥；请在账号页重新登录，或把密钥写入凭据库、在启动环境里导出它`,
            "MISSING_CREDENTIAL",
          ),
        };
        if (tried.size >= MAX_TRIED) throw lastFailure.thrown;
        continue;
      }

      let emitted = false;
      let totalTokens = 0;
      // 逐次索取上游：**只有** `iterator.next()` 的失败算本次尝试的失败；
      // 消费方在 `yield` 处的中断/抛错原样冒泡，不会被当成厂商失败而重放。
      const iterator = this.#attempt(config, options, key)[Symbol.asyncIterator]();
      let failure: unknown;
      let exhausted = false;
      try {
        for (;;) {
          let step: IteratorResult<StreamChunk>;
          try {
            step = await iterator.next();
          } catch (error) {
            failure = error;
            break;
          }
          if (step.done === true) {
            exhausted = true;
            break;
          }
          const chunk = step.value;
          if (chunk.type === "usage") totalTokens += usageTotal(chunk.usage);
          emitted = true;
          yield chunk;
        }
      } finally {
        if (!exhausted) {
          // 与 `runStream` 同一条纪律：只发关闭请求，不等它完成。
          const closing = iterator.return?.(undefined);
          if (closing !== undefined) void closing.catch(() => {});
        }
      }
      if (exhausted) {
        // 请求由这个账号**服务完了**：记一次成功（卡片跟随真实账号）。
        this.#deps.rotation.noteSettled(ref);
        return;
      }

      if (options.signal?.aborted === true || this.#isAbort(failure)) throw failure;
      const classified = this.#classify(failure);
      if (classified === undefined) throw failure; // 请求级拒绝：换账号没有意义
      this.#deps.rotation.markRejected(ref, classified.rejection);
      lastFailure = classified;
      // 唯一的换账号条件：已输出 / 已消耗 token / 已中止都不换。
      if (!this.#deps.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
      if (tried.size >= MAX_TRIED) throw classified.thrown;
    }
  }

  /** 一次尝试：核对档位 → 构造请求体 → 发出 → 解码并套上时间预算。 */
  async *#attempt(config: ResolvedConfig, options: GenerateOptions, key: string): AsyncGenerator<StreamChunk> {
    const effort = await this.#declaredEffort(config, options);
    const response = await this.#post(config, options, key, effort);
    if (!response.ok) {
      const body = await readErrorBody(response);
      // 兜底：网关不认这个档位（400 + 点名 reasoning_effort）时按它念出的白名单**降一档**重发；
      // 白名单读不出来（或没有更弱的选项）才去掉字段。声明档位靠的是实测表 / 模型族推断，
      // 推断错的代价不该是整次请求失败 —— 最多退一档，回答照常拿到。
      if (response.status === 400 && effort !== undefined && mentionsEffortField(body)) {
        const fallback = nearestAllowedEffort(effort, allowedEffortsIn(body));
        const retry = await this.#post(config, options, key, fallback === effort ? undefined : fallback);
        if (!retry.ok) throw new OpenDesignStreamFailure(retry.status, await readErrorBody(retry));
        yield* runStream(
          decodeStream(retry.body),
          { requestTimeoutMs: config.requestTimeoutMs, streamIdleTimeoutMs: config.streamIdleTimeoutMs },
          { signal: options.signal },
        );
        return;
      }
      throw new OpenDesignStreamFailure(response.status, body);
    }
    yield* runStream(
      decodeStream(response.body),
      { requestTimeoutMs: config.requestTimeoutMs, streamIdleTimeoutMs: config.streamIdleTimeoutMs },
      { signal: options.signal },
    );
  }

  /**
   * 发一次生成请求。
   * @param config - 已填默认值的配置。
   * @param options - 宿主的完整请求。
   * @param key - 本次尝试的推理密钥。
   * @param effort - 要带的档位；`undefined` 表示不带这个字段。
   * @returns 原始响应（调用方判状态、读正文）。
   */
  async #post(
    config: ResolvedConfig,
    options: GenerateOptions,
    key: string,
    effort: string | undefined,
  ): Promise<Response> {
    const cap = config.defaultMaxTokens;
    const facts: BodyFacts = {
      maxTokens: options.maxTokens === undefined ? cap : Math.min(options.maxTokens, cap),
      systemText: systemTextOf(options),
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    };
    const wire = generateRequest({
      base: config.apiBase,
      key,
      body: JSON.stringify(buildRequestBody(options, facts)),
    });
    const init: RequestInit = { method: "POST", headers: wire.headers, body: wire.body };
    if (options.signal !== undefined) init.signal = options.signal;
    return this.#deps.fetchImpl(wire.url, init);
  }

  /**
   * 核对宿主给的推理档位：**声明过的（目录或模型族）**才原样返回，否则 `undefined`
   * （不发这个字段）。没有档位需求时不请求目录；目录拉不到时仍按模型族判定。
   * @param config - 已填默认值的配置。
   * @param options - 宿主的完整请求。
   * @returns 可以发出去的档位，或 `undefined`。
   */
  async #declaredEffort(config: ResolvedConfig, options: GenerateOptions): Promise<string | undefined> {
    const effort = options.reasoningEffort;
    if (effort === undefined) return undefined;
    try {
      const entry = (await this.#catalog(config, options.signal)).find((candidate) => candidate.id === options.model);
      // 与 `resolveModel` 同一份判定：声明过的（目录或模型族）才发，别把厂商不认的档位送出去。
      return effortsFor(options.model, entry?.efforts).includes(effort) ? effort : undefined;
    } catch {
      return undefined;
    }
  }

  /** 收集两个凭据来源并按优先级挑选（`stored → environment`；没有字面量与 auth.json 兜底）。 */
  async #resolveKey(ref: string): Promise<string | undefined> {
    const stored = await this.#deps.resolveStored?.(ref);
    const environment = this.#deps.resolveEnvironment?.(ref);
    return pickApiKey({
      ...(stored === undefined ? {} : { stored }),
      ...(environment === undefined ? {} : { environment }),
    }).key;
  }

  /** 拉目录并解析（目录条目不缓存：与另两家一致，TTL 缓存属后续期次）。 */
  async #catalog(config: ResolvedConfig, signal?: AbortSignal): Promise<CatalogEntry[]> {
    // 目录与推理同一条 Bearer（2026-10-18 实测：不带密钥回 401 missing_api_key）。
    const { url, headers } = catalogRequest(config.apiBase, await this.#catalogKey());
    const response = await this.#deps.fetchImpl(url, {
      headers,
      signal: signal ?? AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new LlmError(`Open Design models endpoint returned ${response.status}`, "PROVIDER_HTTP_ERROR", {
        status: response.status,
      });
    }
    const payload: unknown = await response.json();
    return parseCatalog(payload).entries;
  }

  /**
   * 目录请求用的推理密钥：优先当前生效账号，其次第一个已配置账号。
   *
   * 目录是**厂商级**资源，但网关要鉴权 —— 任意一个可用账号的密钥都能读到同一份目录。
   * 一个账号都没有时返回 `undefined`，请求照旧发出（端点会回 401，界面显示「目录读取失败」
   * 而不是假装「这个厂商没有模型」）。
   * @returns 可用的推理密钥，或 `undefined`。
   */
  async #catalogKey(): Promise<string | undefined> {
    let views: readonly AccountView[];
    try {
      views = await this.#deps.accounts.list();
    } catch {
      return undefined;
    }
    if (!Array.isArray(views) || views.length === 0) return undefined;
    const preferred =
      views.find((view) => view.active === true) ??
      views.find((view) => view.configured === true) ??
      views[0];
    const ref = preferred?.ref;
    if (typeof ref !== "string" || ref === "") return undefined;
    return this.#resolveKey(ref);
  }

  /**
   * 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
   * （换账号没有意义），调用方应原样上抛。
   */
  #classify(error: unknown): AttemptFailure | undefined {
    if (error instanceof OpenDesignStreamFailure) {
      const rejection = classifyOpenDesignFailure(error.status, error.body);
      if (rejection === undefined) return undefined;
      return { rejection, thrown: openDesignLlmError(rejection, error.status, error) };
    }
    if (error instanceof LlmError) {
      if (error.code === ABORTED_CODE) return undefined;
      if (error.code === LLM_REQUEST_TIMEOUT || error.code === LLM_STREAM_IDLE_TIMEOUT) {
        // 超时是传输级瞬时失败：可以换账号再试，但抛给宿主的始终是**原始**错误，
        // 以保留「整请求超时 vs 流空闲超时」的区分。
        const rejection = classifyOpenDesignFailure(0, { message: error.message });
        if (rejection === undefined) return undefined;
        return { rejection, thrown: error };
      }
      // 其它宿主错误已经是终态（协议错误、不支持的内容等）：不轮换。
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    const rejection = classifyOpenDesignFailure(0, { message });
    if (rejection === undefined) return undefined;
    return { rejection, thrown: openDesignLlmError(rejection, undefined, error) };
  }

  /** 识别「调用方中止」（`transport.ts` 未导出该码，故比字面量）。 */
  #isAbort(error: unknown): boolean {
    return error instanceof LlmError && error.code === ABORTED_CODE;
  }

  /** 消费前已中止时抛出宿主认识的中止错误。 */
  #abortError(signal: AbortSignal | undefined): LlmError {
    return signal?.reason === undefined
      ? new LlmError("the caller aborted the request", ABORTED_CODE)
      : new LlmError("the caller aborted the request", ABORTED_CODE, { cause: signal.reason });
  }
}

/**
 * 造一个 Open Design 适配器实例（注册到宿主路由由入口完成）。
 * @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
 * @returns 宿主 `LlmAdapter` 子类实例。
 */
export function createOpenDesignAdapter(deps: OpenDesignAdapterDeps): LlmAdapter & CatalogModelsPort {
  return new OpenDesignAdapter(deps);
}
