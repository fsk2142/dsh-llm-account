/**
 * Command Code 的宿主适配器：把共享内核串成一次真实请求。
 *
 * 一次 `stream()` 的固定顺序（设计 §9.1）：
 * **回合循环本身不在本文件**：选账号、换号闸门（`rotation.fallbackAllowed`）、试用上限、
 * 「用尽时抛哪一条」、换模型与跨厂商委托，全部由 `core/attempt-loop` 统一实现
 * （2026-11-07 抽出；此前三家各写一份，同一个 bug 要修三次且总会漏）。
 * 本文件只提供本家特有的东西：凭据怎么取、请求怎么发、失败怎么分类、chunk 要不要改写。
 */

import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from "@deepseek-ai/dsh-llm";

import type { AccountPort, FailureKind, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { noteNetworkFailure, recentlyNetworkDown } from "../../core/switching/gateway-health";
import { hasImageInput, pickFallbackModel, type FallbackCandidate as ModelFallbackCandidate } from "../../core/switching/model-fallback";
import { officialModelName } from "../../core/model-names";
import { catalogCandidateRevision, delegateStream, noteCatalogModels } from "../model-catalog-registry";
import { NOOP_USAGE_PORT, type UsagePort } from "../../core/usage/port";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { createCatalogFlight, type CatalogFlight } from "../../core/catalog-flight";
import { pickApiKey } from "../../core/credentials";
import type { AttemptFailure } from "../../core/attempt-ledger";
import { runAttemptLoop } from "../../core/attempt-loop";
import { MAX_TRIED, RotationEngine } from "../../core/switching/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, RequestDeadline, runStream } from "../../core/transport";
import {
  collectImageBytes,
  type ImageRefLike,
  type RequestImageBytes,
} from "../../core/image-projection";
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
  /**
   * 图片字节读取（2026-11-04 外部审查 U07 的注入点）。
   *
   * 原来没有这一项，协议层只取文本，图片被静默丢弃。
   */
  resolveImage?: (ref: ImageRefLike, signal?: AbortSignal) => Promise<RequestImageBytes | undefined>;
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
   * **限额时换模型**的候选提供者（可选；需求）。
   *
   * 只在所有账号都被限额拒绝之后被调用一次（失败路径），所以可以是异步的：候选清单要读
   * 各家的模型目录，而目录是网络资源。缺省 = 不换模型（旧行为）。
   */
  /**
   * 候选清单（**用户可选范围内**的模型；见 model-catalog-registry）。
   *
   * 可以返回 promise：缓存缺失时要读一次目录才答得上来。只在限额失败后调用一次。
   */
  fallbackCandidates?: () => readonly ModelFallbackCandidate[] | undefined | Promise<readonly ModelFallbackCandidate[]>;
  /**
   * **额度用尽后是否自动切换模型**。
   *
   * 关着的时候，账号全部被限额拒绝就直接报错 —— 不替用户换模型。打开后才按四级优先
   * （同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名）随机挑一个。
   */
  autoSwitchModel?: () => boolean;
  /** 真找到并换了模型时通知装配层（日志/遥测）。 */
  onModelFallback?: (from: { provider: string; model: string }, to: ModelFallbackCandidate) => void;
  /**
   * **一次请求内最多试几个账号**（2026-10-30 加）。
   *
   * 原来是硬编码 `MAX_TRIED = 16`，与用户配置的 `autoContinueMaxAttempts` 无关。
   * 现在统一：适配器内换账号与宿主层重试共用同一个上限，用户设 5 次就是 5 次。
   * 缺省 `undefined` 时退回 `MAX_TRIED`。
   */
  maxTried?: () => number | undefined;
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

/** 分类出的一次失败：分类结果，以及轮换用尽时要抛给宿主的错误（共享类型见 `core/attempt-ledger`）。 */

/** 命令码适配器：宿主 `LlmAdapter` 的一个真实子类。 */
class CommandCodeAdapter extends LlmAdapter implements CatalogModelsPort {
  readonly #deps: CommandCodeAdapterDeps;

  /**
   * 目录读取（TTL + 按键并发去重 + 独立取消 + 内部超时）。
   *
   * **抽到 `core/catalog-flight`**（2026-11-05 外部审查 F15/F17）：原来这里的
   * `#catalogInFlight` 是一个裸 Promise，不区分基地址 —— 用户切网关后新配置会
   * 复用旧配置的在途请求，模型列表串用；`fresh` 也不复位它（刷新按钮无效）；
   * 所有等待者共用第一个调用方的 signal（取消串扰）；且 `signal ?? timeout`
   * 让调用方一给 signal，10 秒上限就消失了。
   */
  readonly #catalogFlight: CatalogFlight<CatalogEntry[]>;

  /**
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: CommandCodeAdapterDeps) {
    super();
    this.#deps = deps;
    /**
     * 目录读取器：**按基地址分键**。
     *
     * Command Code 的目录只属于端点（`/models` 不带账号语义），所以键就是基地址；
     * 缓存与在途请求都按它隔离。换基地址 → 天生的新键，不会复用旧 Promise。
     */
    this.#catalogFlight = createCatalogFlight<CatalogEntry[]>({
      ttlMs: CATALOG_TTL_MS,
      timeoutMs: MODELS_TIMEOUT_MS,
      load: async (base, signal) => this.#fetchCatalog(base, signal),
    });
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
    /**
     * **没有账号时不返回任何模型**（2026-10-30 修）。
     *
     * 模型清单来自网关目录 / 静态表，与凭据无关 —— 所以账号被移除、
     * `accounts: []` 之后仍会照旧列出来。用户选中这样的模型，请求时 `pick()`
     * 返回 undefined，立刻报「没有可用账号」。
     *
     * 这里提前挡住：一个账号都没有就返回空清单，模型选择器里不会出现
     * 注定用不了的条目。读取账号失败时**不**返回空（宁可照旧列出，也不要因为
     * 一次读失败把整个模型列表清空）。
     */
    const hasAccount = await this.#hasAnyAccount();
    if (!hasAccount) return [];
    const revision = catalogCandidateRevision();
    const raw = this.#deps.config();
    const entries = await this.#catalog(resolveConfig(raw));
    const visible = selectVisible(entries, normalizeVisibility(raw));
    // 把目录交给跨厂商注册表：限额换模型时走缓存，不再现打网络。
    noteCatalogModels(
      provider,
      // 带上能力信息：换模型时的「参数能力接近」要用上下文窗口与档位数。
      visible.map((entry) => ({
        id: entry.id,
        ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
        ...(entry.efforts === undefined ? {} : { effortCount: entry.efforts.length }),
      })),
      undefined,
      revision,
    );
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
  async catalogModels(fresh = false): Promise<CatalogModel[]> {
    const entries = await this.#catalog(resolveConfig(this.#deps.config()), undefined, fresh);
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
      name: entry?.name ?? officialModelName(model),
      inputModalities: entry?.inputModalities ?? ["text"],
      ...(entry?.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } }),
      ...(entry?.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens }),
      // **能力声明**（2026-10-20 对齐官方实现）：官方 `dsh-llm-deepseek` 在目录里硬编码
      // 等同的两项。它们影响「中途改系统提示 / 增删工具」时的缓存策略，不是用户选项：
      // - `in-history`：任意位置的 `system` 消息都读作最新系统提示，改提示只需追加；
      // - `addition-only`：认 `deferLoading` + `tool-addition`，新工具不必重发完整列表。
      systemPromptUpdate: "in-history",
      toolUpdate: "addition-only",
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
  /**
   * 流式请求：账号轮换、失败分类、有条件的账号回退，**全部交给共享的回合循环**
   * （`core/attempt-loop`，2026-11-07 抽出；此前三家各写一份，同一个 bug 要修三次且总会漏）。
   *
   * 这里只提供 Command Code 特有的四件事：配置解析、凭据读取、一次尝试、失败分类表。
   * @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
   * @returns 与线上同序的 chunk 流。
   */
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    /**
     * 配置在**选号之后**才读（与抽取前同一顺序）：`beforeRequest` 可能改设置，
     * 先读会拿到旧值。用惰性 + 记忆化，一个请求内只解析一次。
     */
    let resolved: ResolvedConfig | undefined;
    const config = (): ResolvedConfig => (resolved ??= resolveConfig(this.#deps.config()));
    return runAttemptLoop<ResolvedConfig, string, undefined>(
      {
        label: "llm-commandcode",
        rotation: this.#deps.rotation,
        maxTried: () => this.#maxTried(),
        resolveConfig: config,
        isAbort: (error) => this.#isAbort(error),
        abortError: (signal) => this.#abortError(signal),
        beforeRequest: (input) => this.#deps.beforeRequest?.(input),
        fallbackModel: (current, kind) => this.#fallbackModel(current, kind),
        delegate: (target, current) =>
          delegateStream(target, current as unknown as Record<string, unknown>) as AsyncIterable<StreamChunk> | undefined,
        resolveCredential: (ref) => this.#resolveKey(config(), ref),
        missingCredential: (ref) => {
          // 没有可用密钥的账号不可能自行恢复：立刻记入拒绝表（`invalid-credential`
          // 只能被显式清除），否则每次请求都会重新选中它并再次失败。
          const rejection: Rejection = {
            kind: "invalid-credential",
            message: `Command Code account "${ref}" has no usable API key`,
          };
          this.#deps.rotation.markRejected(ref, rejection);
          return {
            rejection,
            thrown: new LlmError(
              `llm-commandcode: no API key for Command Code account "${ref}"; store it through the credentials service, export it in the launching environment, set config.apiKey, or run \`command-code login\` to write ~/.commandcode/auth.json`,
              "MISSING_CREDENTIAL",
            ),
          };
        },
        attempt: (resolved, current, key) => this.#attempt(resolved, current, key),
        classify: (error) => this.#classify(error),
        recordUsage: (ref, model, outcome, counts, kind) => this.#recordUsage(ref, model, outcome, counts, kind),
        noteSettled: (ref) => this.#deps.rotation.noteSettled(ref),
        // 「一个账号都没有」与「全试过了」是两种处境，给的建议不同（抽取前就是两条文案）。
        noAccount: (model) =>
          new LlmError(
            `llm-commandcode: no Command Code account is available for model "${model}"; add an account or store its API key`,
            "MISSING_CREDENTIAL",
          ),
      },
      options,
    );
  }

  /** 一次尝试：选协议 → 发请求 → （必要时）回退 CLI 传输 → 解码并套上时间预算。 */
  async *#attempt(config: ResolvedConfig, options: GenerateOptions, key: string): AsyncGenerator<StreamChunk> {
    const cap = Math.min(config.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS);
    /**
     * 档位**原样发送**，不再按静态表收口（2026-11-03 用户要求）。
     *
     * 旧写法只发「静态表里有的值」，表外一律不发 —— 于是用户选了 `off`（或某个表里
     * 没有的档位）时，请求里没有档位字段，实际用的是厂商默认档，而界面仍显示所选值。
     * 这是**静默改档**，用户无从发现；而「发出去被厂商拒」至少是一个可见的失败。
     *
     * 静态表 `knownEfforts` 仍然有用，但只用来**声明**宿主的可选档位（`resolveModel`），
     * 不再充当发送闸门。
     */
    const declared = options.reasoningEffort;
    // 静态表仍用于「这个模型有没有可选档位」的协议选择（与「发不发用户选的值」无关）。
    const supported = knownEfforts(options.model) ?? [];
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
    /**
     * **一个 deadline，所有阶段共用剩余时间**（2026-11-01 修 R02 第二版）。
     *
     * 原来只有下面的 `runStream` 受 `requestTimeoutMs` 管 —— 而它在流**已经开始
     * 产出之后**才生效。网关接受连接但永不返回响应头时（半开连接、上游挂起），
     * 用户配的超时完全不起作用。
     *
     * ## 为什么用 `RequestDeadline` 而不是每段各传一次预算
     *
     * 上一版给每段都套 `withRequestDeadline(budget)`，但每个都从**当下**重新算完整
     * 预算。于是「等响应头 60ms + 读错误正文 60ms」在 90ms 预算下**整体跑了 120ms**
     * —— 每段单独看都没超时。复审用整请求 90ms、每段 60ms 的夹具确认了这一点。
     *
     * 现在 `RequestDeadline` 在进入这次尝试时建立一次，后面每段只取剩余毫秒。
     * 流式阶段（`runStream`）同样用剩余预算，不再重置。
     */
    const deadline = new RequestDeadline(config.requestTimeoutMs);
    /**
     * 取本次请求需要的图片字节（2026-11-04 外部审查 U07）。
     *
     * 只取未被 offloaded 的图片；没有注入时返回空表，协议层会降级成占位文本 ——
     * 仍然不静默丢弃。
     *
     * **总预算统一在 core 里执行**（2026-11-05 外部审查 F06）：单张上限挡不住
     * 「很多张大图」，而那正是长图文会话的常态。
     */
    const images = (await collectImageBytes(options.messages, this.#deps.resolveImage, options.signal)).images;
    const signalOpts = { ...(options.signal === undefined ? {} : { signal: options.signal }) };
    const deadlineOf = <T,>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> =>
      deadline.run(operation, config.streamIdleTimeoutMs, signalOpts);
    let response = await deadlineOf((signal) =>
      this.#post(config, protocol, key, buildRequestBody(protocol, options, facts, images), signal ?? options.signal),
    );
    if (!response.ok) {
      const body = await deadlineOf(() => readErrorBody(response));
      if (protocol !== "cli" && isUpgradeRequired(response.status, body)) {
        // 回退顺序（旧插件第 7512-7519 行）：同一个账号、同一次尝试改用 CLI 传输重发。
        protocol = "cli";
        response = await deadlineOf((signal) =>
          this.#post(config, protocol, key, buildRequestBody(protocol, options, facts, images), signal ?? options.signal),
        );
        if (!response.ok) {
          const retryBody = await deadlineOf(() => readErrorBody(response));
          throw new CommandCodeStreamFailure(response.status, retryBody);
        }
      } else {
        throw new CommandCodeStreamFailure(response.status, body);
      }
    }
    yield* runStream(
      decodeStream(protocol, response.body),
      // 流式阶段用**剩余**预算，不重置整请求 deadline。
      deadline.streamBudget(config.streamIdleTimeoutMs),
      {
        signal: options.signal,
        /**
         * **超时/取消时连底层网络一起停**（2026-11-01 修 R03 第三版）。
         *
         * 报告实测：正文停住后 `reader.cancel` 仍是 0、body 仍开着 —— `runStream`
         * 的 `closeQuietly` 依赖迭代器响应 `return()`，而卡在 `read()` 上的
         * Web Stream reader 不会响应。接上共享 controller 后，abort 让 read 立刻
         * reject，socket 随之释放。
         */
        abortNetwork: deadline.networkAbort(),
      },
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
   * 拉目录并解析（TTL 缓存 + 按键并发去重 + 独立取消）。
   *
   * 缓存与在途请求都按**基地址**分键：换基地址 → 新键 → 不复用旧请求
   * （2026-11-05 外部审查 F15）。取消与超时的语义见 `core/catalog-flight.ts`。
   * @param config - 已填默认值的配置。
   * @param signal - 宿主的取消信号（只影响**本调用方**的等待）。
   * @param fresh - 绕过缓存与在途请求重读（刷新按钮）。
   * @returns 目录条目。
   */
  async #catalog(config: ResolvedConfig, signal?: AbortSignal, fresh = false): Promise<CatalogEntry[]> {
    return await this.#catalogFlight.read(config.apiBase, { ...(signal === undefined ? {} : { signal }), fresh });
  }

  /**
   * 真正打一次目录端点。
   *
   * `signal` 由 `catalog-flight` 传入，**已经合并**了调用方取消与 10 秒内部超时
   * （F17：原来写的是 `signal ?? timeout`，调用方一给 signal，上限就没了）。
   * @param apiBase - 目录端点基地址（就是分键用的键）。
   * @param signal - 已合并的取消信号。
   * @returns 目录条目。
   */
  async #fetchCatalog(apiBase: string, signal: AbortSignal): Promise<CatalogEntry[]> {
    const { url, headers } = catalogRequest(apiBase);
    const response = await this.#deps.fetchImpl(url, { headers, signal });
    if (!response.ok) {
      throw new LlmError(`Command Code models endpoint returned ${response.status}`, "PROVIDER_HTTP_ERROR", {
        status: response.status,
      });
    }
    const payload: unknown = await response.json();
    return parseCatalog(payload).entries;
  }

  /**
   * 当前是否**至少有一个**可用的账号条目。
   *
   * 「可用」= 账号端口能列出条目，且凭据能解析出 key（与发请求时的判定一致）。
   * 读账号/读凭据失败时返回 `true`（**宁可放过**）：一次读失败不该把整个模型
   * 列表清空，那比多列几个用不了的模型更糟。
   * @returns 是否有账号。
   */
  async #hasAnyAccount(): Promise<boolean> {
    let rows: readonly { ref: string }[];
    try {
      rows = await this.#deps.accounts.list();
    } catch {
      return true;
    }
    if (rows.length === 0) return false;
    /**
     * 有条目但全都解析不出 key（凭据被删）：视为「没有可用账号」。
     *
     * **判定必须与实际解析路径一致**（2026-11-04 外部审查 U09）：`stream` 走
     * `resolveStored → resolveEnvironment` 两个来源，而这里原来只看 `resolveStored`。
     * 「密钥配在环境变量里」的用户因此会看到空模型列表，却能正常聊天。
     *
     * 两种来源都没注入时**仍按「无法判定」放过**（原有语义，不能弄丢）。
     */
    for (const row of rows) {
      try {
        const stored = this.#deps.resolveStored;
        const environment = this.#deps.resolveEnvironment;
        if (stored === undefined && environment === undefined) return true;
        // 与 `resolveAccountKey` 同一次序：stored 优先，其次 environment。
        if (stored !== undefined && (await stored(row.ref)) !== undefined) return true;
        if (environment !== undefined && environment(row.ref) !== undefined) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  /**
   * 一次请求内最多试几个账号（2026-10-30）。
   *
   * 与宿主层重试共用同一个上限（`autoContinueMaxAttempts`），用户设 5 次就是 5 次。
   * 读不到/非正数时退回 {@link MAX_TRIED}。
   * @returns 上限。
   */
  #maxTried(): number {
    const value = this.#deps.maxTried?.();
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : MAX_TRIED;
  }

  /**
   * 额度用尽后换模型的判定。
   *
   * 只在**所有账号都被拒绝**之后调用，且必须先过开关（`autoSwitchModel`，默认关闭）。
   *
   * 四级优先由 `core/model-fallback` 的纯函数实现：同网关同名 → 跨网关同名 →
   * 同网关异名（按上下文窗口与推理档位接近度收窄）→ 跨网关异名；同一级里随机。
   *
   * **网络层失败只在同网关内换**（2026-10-28）：`fetch failed` / DNS / 代理不通意味着
   * 这台机器出不去，换到另一家走的是同一条路由 —— 必然同样失败，只是白烧一次请求。
   * 服务侧的失败（额度、鉴权、上游 5xx）不设这个限制：换一家真的可能绕过。
   * @param options - 当前请求。
   * @param failureKind - 触发本次换模型的失败分类（缺省按服务侧处理）。
   * @returns 替代目标；开关关着 / 不该换 / 没有候选时都是 `undefined`。
   */
  async #fallbackModel(options: GenerateOptions, failureKind?: FailureKind): Promise<ModelFallbackCandidate | undefined> {
    // 开关（默认关闭）：关着就完全不换，让调用方抛原来的限额错误。
    if (this.#deps.autoSwitchModel?.() !== true) return undefined;
    const candidates = await this.#deps.fallbackCandidates?.();
    if (candidates === undefined || candidates.length === 0) return undefined;
    // 当前模型的上下文窗口 / 档位数：从自己的目录里查，供「能力接近」排序用。
    let currentMeta: { contextWindow?: number; effortCount?: number } = {};
    try {
      const entry = (await this.#catalog(resolveConfig(this.#deps.config()))).find((item) => item.id === options.model);
      if (entry !== undefined) {
        currentMeta = {
          ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
          ...(entry.efforts === undefined ? {} : { effortCount: entry.efforts.length }),
        };
      }
    } catch {
      // 目录读不到：能力信息缺失（排序会给大惩罚），但仍可换同名模型。
    }
    /*
     * 本次是 network 失败：把**本家**记进失败表（2026-11-12 审查 A07）。
     *
     * 旧写法是 sameGatewayOnly: failureKind === "network"，它把
     * 「整台机器出不去」和「只有这家域名连不上」混成一件事，于是后一种情况下
     * **恰好不让救援**（用户开 VPN 时遇到的就是这种）。
     *
     * 现在按网关判断：只记本家，换模型时只排除「最近网络失败过的那几家」。
     * 整网断时它们很快全被记进去（不会无限试），只有一家挂时别家仍可救援。
     */
    if (failureKind === "network") noteNetworkFailure(options.provider);
    const picked = pickFallbackModel(
      { provider: options.provider, model: options.model, ...currentMeta },
      // 候选只有「用户已允许的模型」（注册表用 listModels 过滤，只含账号里已显示的）。
      candidates.map((item) => ({
        provider: item.provider,
        model: item.model,
        ...(item.contextWindow === undefined ? {} : { contextWindow: item.contextWindow }),
        ...(item.effortCount === undefined ? {} : { effortCount: item.effortCount }),
        // 模态带到判定层：本轮带图时用它排除不识图的候选（审查 A06）。
        ...(item.inputModalities === undefined ? {} : { inputModalities: item.inputModalities }),
      })),
      // 网络层失败（`network`）不跨网关：换一家走的是同一条路由，必然同样失败。
      {
        /*
         * **网关健康闸门**（2026-11-12 审查 A07）。
         *
         * 旧写法是 sameGatewayOnly: failureKind === "network" —— 那个判断把
         * 「整台机器出不去」和「只有这家域名连不上」混成一件事，于是在后一种情况下
         * **恰好不让救援**（用户开 VPN 时遇到的就是这种）。
         *
         * 现在按网关判断：本次是 network 失败就只排除**本家**，别家仍可救援。
         * 每次 network 失败都记进 gateway-health，累计几轮后整网断也会自然停手。
         */
        excludeProviders: failureKind === "network" ? recentlyNetworkDown() : [],
        // 本轮带图片时，只允许换到**明确声明**支持 image 的候选（审查 A06）。
        requiresImages: hasImageInput(options.messages),
      },
    );
    if (picked === undefined) return undefined;
    this.#deps.onModelFallback?.({ provider: options.provider, model: options.model }, picked);
    return picked;
  }

  /**
   * 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
   * （换账号没有意义），调用方应原样上抛。
   */
  #classify(error: unknown): AttemptFailure | undefined {
    // Context pressure belongs to the host compaction engine, including in-band errors.
    if (error instanceof LlmError && error.code === "CONTEXT_WINDOW_EXCEEDED") return undefined;
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