/**
 * Command Code 的宿主适配器：把共享内核串成一次真实请求。
 *
 * 一次 `stream()` 的固定顺序（设计 §9.1）：
 * 1. `rotation.pick({ model, tried })` 选账号 —— 决策顺序在轮换引擎里，这里不另写规则；
 * 2. 收集凭据来源（字面量 / 凭据库 / 环境变量 / auth.json 兜底）交给 `pickApiKey`；
 * 3. 按模型选线协议、构造请求体、发出请求，用 `runStream` 套上整请求 deadline 与流空闲看门狗；
 * 4. 失败时用 `classifyCommandCodeFailure` 分类、`markRejected` 记入轮换引擎，
 *    **只在 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真时**才换下一个账号；
 * 5. `tried.size` 达到 `MAX_TRIED` 时停止轮换，并把最后一次失败抛给宿主。
 *
 * 本任务**不**做：网页登录（Task 11）、额度读取（Task 10）、账号增删改（Task 10）、
 * 客户端代码（计划 1b）、套餐过滤与费用估算（第 2 期）。
 * @module dsh-llm-account/src/vendors/commandcode/adapter
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

import type { AccountPort, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { pickFallbackModel, type FallbackCandidate as ModelFallbackCandidate } from "../../core/model-fallback";
import { noteCatalogModels } from "../model-catalog-registry";
import { NOOP_USAGE_PORT, type UsagePort } from "../../core/usage-port";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { pickApiKey } from "../../core/credentials";
import { MAX_TRIED, RotationEngine } from "../../core/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, runStream } from "../../core/transport";
import { parseCatalog } from "./catalog";
import { knownEfforts } from "./efforts";
import { classifyCommandCodeFailure, commandCodeLlmError } from "./failures";
import {
  CommandCodeStreamFailure,
  DEFAULT_API_BASE,
  DEFAULT_GENERATE_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  buildRequestBody,
  catalogRequest,
  decodeStream,
  generateRequest,
  isUpgradeRequired,
  resolveProtocol,
} from "./protocol";
import type { BodyFacts, CommandCodeProtocol } from "./protocol";

/**
 * 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
 * `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
 */
const ABORTED_CODE = "ABORTED";

/** 目录请求的预算（旧插件 `MODELS_TIMEOUT_MS` 第 5391 行）。 */
const MODELS_TIMEOUT_MS = 10_000;

/**
 * 目录读数的缓存时长（毫秒）。
 *
 * 宿主的模型选择器与每个请求的身份解析（`resolveModel`）都会问一次目录，而目录是**厂商级**
 * 资源、按分钟级变化。不缓存等于每个请求多打一次网络。60 秒足够让「刚在设置里勾了模型」
 * 立刻生效，也足够省掉重复请求；失败不缓存。
 */
const CATALOG_TTL_MS = 60_000;

/** 错误正文最多读多少字符（旧插件 `readGenerateErrorBody` 第 6661 行同样封顶 64 KiB）。 */
const ERROR_BODY_LIMIT = 65_536;

/** 重试延迟上限（旧插件 `RETRY_MAX_DELAY_MS` 第 2974 行）。 */
const RETRY_MAX_DELAY_MS = 900_000;

/**
 * 路由的重试白名单（控制器裁决 12）。`LLM_REQUEST_TIMEOUT` 与
 * `LLM_STREAM_IDLE_TIMEOUT` **不在**宿主的 `DEFAULT_RETRYABLE_CODES` 里，必须在此显式列出；
 * 保留这两个具体码（不退化成一个 `TIMEOUT`）是为了区分「整请求超时」与「流空闲超时」。
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
 * Command Code 的配置形状。
 *
 * 全部字段缺省即可用（默认值与旧插件一致）；`apiKey` 是组合配置里
 * `role("secret")` 那种**非持久化**字段，是唯一的字面量来源 —— 绝不允许从设置文档里
 * 读明文密钥（全局约束）。
 */
export interface CommandCodeConfig {
  /** 网关基地址；缺省 {@link DEFAULT_API_BASE}。 */
  apiBase?: string;
  /** 组合配置里写死的密钥（非持久化秘密字段）。 */
  apiKey?: string;
  /** 强制线协议；缺省按模型自动选择。 */
  protocol?: CommandCodeProtocol;
  /** 整请求 deadline（毫秒）；缺省 {@link DEFAULT_REQUEST_TIMEOUT_MS}。 */
  requestTimeoutMs?: number;
  /** 流空闲看门狗（毫秒）；缺省 {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}。 */
  streamIdleTimeoutMs?: number;
  /** 未指定 `maxTokens` 时的输出上限；再受 {@link DEFAULT_GENERATE_MAX_TOKENS} 约束。 */
  defaultMaxTokens?: number;
  /** 模型白名单（设置文档字段，形状不可信）。 */
  visibleModels?: readonly string[];
  /** 逐模型显式可见性开关（设置文档字段，形状不可信）。 */
  modelVisibility?: Readonly<Record<string, boolean>>;
  /** CLI 传输的 `config.workingDir` 与 `x-project-slug` 来源。 */
  workingDir?: string;
}

/** 一次请求循环需要的、已填好默认值的配置。 */
interface ResolvedConfig {
  apiBase: string;
  apiKey?: string;
  protocol?: CommandCodeProtocol;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  defaultMaxTokens: number;
  workingDir?: string;
}

/**
 * 适配器的依赖。四个来源读取函数都是注入点：Task 9 不直接依赖 `ctx`（宿主服务在
 * Task 14 接线），测试可以给假实现。
 */
export interface CommandCodeAdapterDeps {
  /** 每次请求重新读取的配置（volatile 字段据此立即生效）。 */
  config: () => CommandCodeConfig;
  /** 本请求的账号轮换与拒绝记忆。 */
  rotation: RotationEngine;
  /** 额度端口（本任务不读，Task 10 用）。 */
  quota: QuotaPort;
  /** 账号端口（本任务不写，Task 10 用）。 */
  accounts: AccountPort;
  /** 注入的 `fetch`（测试用假实现；生产传全局 `fetch`）。 */
  fetchImpl: typeof fetch;
  /** `authFile` 来源：旧插件读 `~/.commandcode/auth.json`，本期只要求接口存在。 */
  authFileFallback?: () => Promise<string | undefined>;
  /** `stored` 来源：凭据库读取（宿主 `credentials.resolve(ref)?.value` 的注入点）。 */
  resolveStored?: (ref: string) => Promise<string | undefined>;
  /** `environment` 来源：启动环境读取（宿主 `launchEnvironmentOf(ctx).get(name)` 的注入点）。 */
  resolveEnvironment?: (name: string) => string | undefined;
  /** 普通对话请求前的切换钩子；辅助调用（compaction/session-title）不调用。 */
  beforeRequest?: (input: { sessionId?: string; purpose?: string }) => Promise<void>;
  /**
   * 用量采集端口（可选）。
   *
   * 记录点在一次尝试结束处：成功与失败都记 —— 只记成功会让成功率永远是 100%。
   * 端口实现必须不阻塞、不抛错（见 `core/usage-port`）。
   */
  usage?: UsagePort;
  /**
   * **限额时换模型**的候选提供者（可选；用户 2026-10-19 要求）。
   *
   * 只在所有账号都被限额拒绝之后被调用一次（失败路径），所以可以是异步的：候选清单要读
   * 各家的模型目录，而目录是网络资源。缺省 = 不换模型（旧行为）。
   */
  fallbackCandidates?: () => readonly ModelFallbackCandidate[] | undefined;
  /** 真找到并换了模型时通知装配层（日志/遥测）。 */
  onModelFallback?: (from: { provider: string; model: string }, to: ModelFallbackCandidate) => void;
}

/** 填默认值；`0`/负数/NaN 一律回落到默认值，避免把坏配置变成「立即超时」。 */
function resolveConfig(raw: CommandCodeConfig): ResolvedConfig {
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    apiBase: raw.apiBase !== undefined && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_API_BASE,
    ...(raw.apiKey === undefined ? {} : { apiKey: raw.apiKey }),
    ...(raw.protocol === undefined ? {} : { protocol: raw.protocol }),
    requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
    ...(raw.workingDir === undefined ? {} : { workingDir: raw.workingDir }),
  };
}

/** 把系统提示折叠成一段文本（旧插件第 7420 行的同一规则）。 */
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

/** 分类出的一次失败：分类结果，以及轮换用尽时要抛给宿主的错误。 */
interface AttemptFailure {
  rejection: Rejection;
  thrown: unknown;
}

/** 命令码适配器：宿主 `LlmAdapter` 的一个真实子类。 */
class CommandCodeAdapter extends LlmAdapter implements CatalogModelsPort {
  readonly #deps: CommandCodeAdapterDeps;

  /** 目录缓存：同一基地址在 TTL 内复用；换配置（基地址变化）立即失效。 */
  #catalogCache: { base: string; at: number; entries: CatalogEntry[] } | undefined;

  /** 在途的目录请求（并发去重：模型选择器一次能并发问好几条）。 */
  #catalogInFlight: Promise<CatalogEntry[]> | undefined;

  /**
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: CommandCodeAdapterDeps) {
    super();
    this.#deps = deps;
  }

  /** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "Command Code" };
  }

  /**
   * 路由的重试白名单（控制器裁决 12；依据是旧插件 `providerRetryPolicy` 第 6893-6911 行）。
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
      "llm-commandcode: retryPolicy",
    );
  }

  /**
   * 拉目录 → 应用可见性规则 → 映射为宿主形状（旧插件 `listModels` 第 6927-6946 行的
   * 可见性部分；套餐过滤与免费置顶属第 2 期）。
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const raw = this.#deps.config();
    const entries = await this.#catalog(resolveConfig(raw));
    const visible = selectVisible(entries, normalizeVisibility(raw));
    // 把目录交给跨厂商注册表：限额换模型时走缓存，不再现打网络。
    noteCatalogModels(provider, visible.map((entry) => entry.id));
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
   * 与 `listModels` 的分工：那个回答「宿主的模型选择器该看到什么」，这个回答「厂商现在
   * 有哪些模型」—— 隐藏的模型也要出现在勾选列表里，否则用户没有入口把它重新打开。
   * @returns 目录里的模型 id 与名称。
   */
  async catalogModels(): Promise<CatalogModel[]> {
    const entries = await this.#catalog(resolveConfig(this.#deps.config()));
    return entries.map((entry) => ({ id: entry.id, ...(entry.name === "" ? {} : { name: entry.name }) }));
  }

  /**
   * 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力；目录不可用或
   * 没有该模型时退化成「只有 id 的目录外模型」（旧插件 `resolveModel` 第 6971-6992 行）。
   *
   * 档位的来源是 {@link knownEfforts} 的静态表（网关从不公布档位），负载自己哪天公布了就
   * 以负载为准 —— 那是更新的真相。表里没有的模型**不声明**档位：宿主的选择器随之不出现，
   * 与旧插件同一行为。
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
    const efforts = entry?.efforts ?? knownEfforts(model) ?? [];
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
      // 宿主契约：不支持的 stop 序列由适配器拒绝（旧插件第 7398 行的同一条）。
      throw new LlmError("Command Code adapter does not support stop sequences", "UNSUPPORTED_OPTION");
    }
    // 账号切换策略：在选号之前决定要不要换当前账号（辅助调用直接跳过）。
    await this.#deps.beforeRequest?.({
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    });
    const config = resolveConfig(this.#deps.config());
    const tried = new Set<string>();
    let lastFailure: AttemptFailure | undefined;
    /** 已经换过一次模型了吗（只换一次：替代也限额就停手，不再套娃）。 */
    let swappedOnce = false;

    for (;;) {
      const aborted = options.signal?.aborted === true;
      if (aborted) throw this.#abortError(options.signal);

      const ref = this.#deps.rotation.pick({ model: options.model, tried });
      if (ref === undefined) {
        // 换模型的机会：所有账号都被**拒绝**了（继续换账号已无意义，换同名模型往往还能服务）。
        //
        // 只在「确实有账号被拒绝」时才尝试 —— `lastFailure === undefined` 意味着一条凭据都
        // 没解析到（`MISSING_CREDENTIAL`），那种情况换模型毫无意义，而且查候选要读各家目录
        // （会发额外请求）。先抛确定性的失败，别为一次注定失败的请求去打网络。
        if (!swappedOnce && lastFailure !== undefined && lastFailure.rejection.kind !== "invalid-credential") {
          const swapped = this.#fallbackModel(options);
          if (swapped !== undefined && swapped.model !== options.model) {
            swappedOnce = true;
            options = { ...options, model: swapped.model };
            tried.clear();
            continue;
          }
        }
        if (lastFailure !== undefined) throw lastFailure.thrown;
        throw new LlmError(
          `llm-commandcode: no Command Code account is available for model "${options.model}"; add an account or store its API key`,
          "MISSING_CREDENTIAL",
        );
      }
      tried.add(ref);

      const key = await this.#resolveKey(config, ref);
      if (key === undefined) {
        // 没有可用密钥的账号不可能自行恢复：立刻记入拒绝表（`invalid-credential`
        // 只能被显式清除），否则每次请求都会重新选中它并再次失败。
        const rejection: Rejection = {
          kind: "invalid-credential",
          message: `Command Code account "${ref}" has no usable API key`,
        };
        this.#deps.rotation.markRejected(ref, rejection);
        lastFailure = {
          rejection,
          thrown: new LlmError(
            `llm-commandcode: no API key for Command Code account "${ref}"; store it through the credentials service, export it in the launching environment, set config.apiKey, or run \`command-code login\` to write ~/.commandcode/auth.json`,
            "MISSING_CREDENTIAL",
          ),
        };
        if (tried.size >= MAX_TRIED) throw lastFailure.thrown;
        continue;
      }

      let emitted = false;
      let totalTokens = 0;
      // 用量采集：把这次尝试的 usage 逐块累加成四个计数。厂商可能在流里发多次
      // usage（`message_start` 的输入计数 + `message_delta` 的输出计数），
      // 所以必须**累加而不是覆盖**。
      const counts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
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
          if (chunk.type === "usage") {
            totalTokens += usageTotal(chunk.usage);
            counts.inputTokens += chunk.usage.inputTokens ?? 0;
            counts.outputTokens += chunk.usage.outputTokens ?? 0;
            counts.cacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
            counts.cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0;
          }
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
        // 请求由这个账号**服务完了**：规格 §8.1 第 1 条的「最近成功者」（卡片跟随真实账号）。
        this.#deps.rotation.noteSettled(ref);
        this.#recordUsage(ref, options.model, "success", counts);
        return;
      }

      if (options.signal?.aborted === true || this.#isAbort(failure)) {
        // 用户主动取消：不算厂商失败，也不算成功。仍记一条（token 已经花掉了）。
        this.#recordUsage(ref, options.model, "failure", counts, "aborted");
        throw failure;
      }
      const classified = this.#classify(failure);
      if (classified === undefined) {
        this.#recordUsage(ref, options.model, "failure", counts, "request");
        throw failure; // 请求级拒绝：换账号没有意义
      }
      this.#deps.rotation.markRejected(ref, classified.rejection);
      lastFailure = classified;
      this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
      // 唯一的换账号条件（Task 5 的判定）：已输出 / 已消耗 token / 已中止都不换。
      if (!this.#deps.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
      if (tried.size >= MAX_TRIED) throw classified.thrown;
    }
  }

  /** 一次尝试：选协议 → 发请求 → （必要时）回退 CLI 传输 → 解码并套上时间预算。 */
  async *#attempt(config: ResolvedConfig, options: GenerateOptions, key: string): AsyncGenerator<StreamChunk> {
    const cap = Math.min(config.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS);
    // 档位在**这里**按静态表再收一次口（旧插件第 7416-7419 行同一套）：`resolveModel` 声明的
    // 集合是宿主做前置校验用的，但光靠它不够 —— 宿主的「关闭思考」会送来 `off`，而表里只有
    // 部分模型认 `off`；不在表里的值一律**不发字段**（发出去会被厂商拒）。
    const supported = knownEfforts(options.model) ?? [];
    const declared =
      options.reasoningEffort !== undefined && supported.includes(options.reasoningEffort)
        ? options.reasoningEffort
        : undefined;
    const facts: BodyFacts = {
      maxTokens: options.maxTokens === undefined ? cap : Math.min(options.maxTokens, cap),
      systemText: systemTextOf(options),
      ...(declared === undefined ? {} : { reasoningEffort: declared }),
      // 有可选档位的模型走 Messages 传输时要打开自适应思考（旧插件第 6624 行）：
      // 那个端点只接受 `thinking.type.adaptive`，此时 `output_config.effort` 才生效。
      ...(supported.length === 0 ? {} : { selectableEffort: true }),
      ...(config.workingDir === undefined ? {} : { workingDir: config.workingDir }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    };
    let protocol = resolveProtocol({
      model: options.model,
      ...(config.protocol === undefined ? {} : { forced: config.protocol }),
    });
    let response = await this.#post(config, protocol, key, buildRequestBody(protocol, options, facts), options.signal);
    if (!response.ok) {
      const body = await readErrorBody(response);
      if (protocol !== "cli" && isUpgradeRequired(response.status, body)) {
        // 回退顺序（旧插件第 7512-7519 行）：同一个账号、同一次尝试改用 CLI 传输重发。
        protocol = "cli";
        response = await this.#post(config, protocol, key, buildRequestBody(protocol, options, facts), options.signal);
        if (!response.ok) throw new CommandCodeStreamFailure(response.status, await readErrorBody(response));
      } else {
        throw new CommandCodeStreamFailure(response.status, body);
      }
    }
    yield* runStream(
      decodeStream(protocol, response.body),
      { requestTimeoutMs: config.requestTimeoutMs, streamIdleTimeoutMs: config.streamIdleTimeoutMs },
      { signal: options.signal },
    );
  }

  /** 发一次请求；`fetch` 抛出的网络异常原样上抛，交给失败分类。 */
  async #post(
    config: ResolvedConfig,
    protocol: CommandCodeProtocol,
    key: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const wire = generateRequest({
      protocol,
      base: config.apiBase,
      key,
      body: JSON.stringify(body),
      ...(config.workingDir === undefined ? {} : { workingDir: config.workingDir }),
    });
    const init: RequestInit = { method: "POST", headers: wire.headers, body: wire.body };
    if (signal !== undefined) init.signal = signal;
    return await this.#deps.fetchImpl(wire.url, init);
  }

  /** 收集四个凭据来源并按优先级挑选（`literal → stored → environment → authFile`）。 */
  async #resolveKey(config: ResolvedConfig, ref: string): Promise<string | undefined> {
    const stored = await this.#deps.resolveStored?.(ref);
    const environment = this.#deps.resolveEnvironment?.(ref);
    const authFile = await this.#deps.authFileFallback?.();
    return pickApiKey({
      ...(config.apiKey === undefined ? {} : { literal: config.apiKey }),
      ...(stored === undefined ? {} : { stored }),
      ...(environment === undefined ? {} : { environment }),
      ...(authFile === undefined ? {} : { authFile }),
    }).key;
  }

  /**
   * 把一次尝试的结果交给用量端口。
   *
   * 采集是**旁路**：端口自己保证不抛错，这里再兜一层 —— 统计出问题绝不能让一次本来
   * 成功的对话变成失败（那样用户会觉得「插件把请求弄坏了」）。
   * @param account - 服务这次请求的账号 ref。
   * @param model - 模型 id（缺省为空串，计价会按「未知」处理）。
   * @param outcome - 成功或失败。
   * @param counts - 本次累计的四个 token 计数。
   * @param failureKind - 失败分类（成功时不传）。
   */
  #recordUsage(
    account: string,
    model: string | undefined,
    outcome: "success" | "failure",
    counts: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
    failureKind?: string,
  ): void {
    const port = this.#deps.usage ?? NOOP_USAGE_PORT;
    try {
      port.record({
        vendor: "commandcode",
        account,
        outcome,
        ...(model === undefined ? {} : { model }),
        ...counts,
        ...(failureKind === undefined ? {} : { failureKind }),
      });
    } catch (error) {
      console.warn("[dsh-llm-account] could not record the usage sample:", error);
    }
  }

  /**
   * 拉目录并解析（TTL 缓存 + 并发去重）。
   *
   * 缓存键是**基地址**：换基地址立即失效（目录属于端点，不属于账号）。60 秒的量级用真实
   * 时钟即可，不需要注入。
   * @param config - 已填默认值的配置。
   * @param signal - 宿主的取消信号（有缓存时不发请求，信号自然用不上）。
   * @returns 目录条目。
   */
  async #catalog(config: ResolvedConfig, signal?: AbortSignal): Promise<CatalogEntry[]> {
    const cached = this.#catalogCache;
    if (cached !== undefined && cached.base === config.apiBase && Date.now() - cached.at <= CATALOG_TTL_MS) {
      return cached.entries;
    }
    if (this.#catalogInFlight !== undefined) return this.#catalogInFlight;
    const pending = this.#fetchCatalog(config, signal);
    this.#catalogInFlight = pending;
    try {
      const entries = await pending;
      this.#catalogCache = { base: config.apiBase, at: Date.now(), entries };
      return entries;
    } finally {
      this.#catalogInFlight = undefined;
    }
  }

  /**
   * 真正打一次目录端点。
   * @param config - 已填默认值的配置。
   * @param signal - 宿主的取消信号。
   * @returns 目录条目。
   */
  async #fetchCatalog(config: ResolvedConfig, signal?: AbortSignal): Promise<CatalogEntry[]> {
    const { url, headers } = catalogRequest(config.apiBase);
    const response = await this.#deps.fetchImpl(url, {
      headers,
      signal: signal ?? AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new LlmError(`Command Code models endpoint returned ${response.status}`, "PROVIDER_HTTP_ERROR", {
        status: response.status,
      });
    }
    const payload: unknown = await response.json();
    return parseCatalog(payload).entries;
  }

  /**
   * 限额换模型的判定（用户 2026-10-19：「遇到账号限额的时候自动切换到同等类型的模型」）。
   *
   * 只在所有账号都被**拒绝**之后调用：那时继续换账号已无意义，换一个同名模型往往还能服务。
   * 判定全在 `core/model-fallback`（纯函数、已单测）：
   * - 只认**同名**（去掉厂商前缀/大小写/分隔符后相等），不猜档位 —— 限额是要省钱，不是悄悄
   *   把用户降到更弱的模型；
   * - 排除 DeepSeek 官方直连；
   * - 找不到同名就返回 `undefined`（停手，让调用方抛原来的失败）。
   * @param options - 当前请求。
   * @returns 替代目标；不该/不能换时为 `undefined`。
   */
  #fallbackModel(options: GenerateOptions): ModelFallbackCandidate | undefined {
    const candidates = this.#deps.fallbackCandidates?.();
    if (candidates === undefined || candidates.length === 0) return undefined;
    // 只允许**同 provider 内**换：adapter 不能替别家发请求（`options.provider` 由路由决定）。
    const picked = pickFallbackModel({ provider: options.provider, model: options.model }, candidates);
    if (picked === undefined) return undefined;
    this.#deps.onModelFallback?.({ provider: options.provider, model: options.model }, picked);
    return picked;
  }

  /**
   * 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
   * （换账号没有意义），调用方应原样上抛。
   */
  #classify(error: unknown): AttemptFailure | undefined {
    if (error instanceof CommandCodeStreamFailure) {
      const rejection = classifyCommandCodeFailure(error.status, error.body);
      if (rejection === undefined) return undefined;
      return { rejection, thrown: commandCodeLlmError(rejection, error.status, error) };
    }
    if (error instanceof LlmError) {
      if (error.code === ABORTED_CODE) return undefined;
      if (error.code === LLM_REQUEST_TIMEOUT || error.code === LLM_STREAM_IDLE_TIMEOUT) {
        // 超时是传输级瞬时失败：可以换账号再试，但抛给宿主的始终是**原始**错误，
        // 以保留「整请求超时 vs 流空闲超时」的区分（裁决 12）。
        const rejection = classifyCommandCodeFailure(0, { message: error.message });
        if (rejection === undefined) return undefined;
        return { rejection, thrown: error };
      }
      // 其它宿主错误已经是终态（协议错误、不支持的内容等）：不轮换。
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    const rejection = classifyCommandCodeFailure(0, { message });
    if (rejection === undefined) return undefined;
    return { rejection, thrown: commandCodeLlmError(rejection, undefined, error) };
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
 * 造一个 Command Code 适配器实例（注册到宿主路由由 Task 14 完成）。
 * @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
 * @returns 宿主 `LlmAdapter` 子类实例。
 */
export function createCommandCodeAdapter(deps: CommandCodeAdapterDeps): LlmAdapter & CatalogModelsPort {
  return new CommandCodeAdapter(deps);
}
