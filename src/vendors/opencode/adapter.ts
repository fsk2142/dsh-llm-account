/**
 * opencode 的宿主适配器：把共享内核串成一次真实请求。
 *
 * 一次 `stream()` 的固定顺序（设计 §9.1）：
 * 1. `rotation.pick({ model, tried })` 选账号 —— 决策顺序在轮换引擎里，这里不另写规则；
 * 2. 收集凭据来源（凭据库 / 环境变量）交给 `pickApiKey`；
 * 3. 经 **pi-ai SDK** 发出请求（见 `./protocol`），用 `runStream` 套上整请求 deadline
 *    与流空闲看门狗；
 * 4. 失败时用 `classifyGatewayFailure` 分类、`markRejected` 记入轮换引擎，
 *    **只在 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真时**才换下一个账号；
 * 5. `tried.size` 达到 `MAX_TRIED` 时停止轮换，并把最后一次失败抛给宿主。
 *
 * 与 commandcode 适配器的两处刻意差别（都来自旧插件 `streamAccounts` 第 7511-7607 行）：
 * - **usage chunk 不计入 `emitted`**：已消耗 token 由 `totalTokens` 单独表达，于是
 *   「零用量的失败」仍然允许换账号，而「报过用量的失败」不允许；
 * - **usage chunk 先缓冲**：失败尝试的用量不交给宿主，成功收尾时才随 finish 一起交出。
 *
 * 本任务**不**做：网页登录（opencode 没有）、额度读取（Task 13）、账号增删改（Task 13）、
 * 代理与协议覆盖（第 3 期）、客户端页面（计划 1b）、诊断导出（第 3 期）。
 * @module dsh-llm-account/src/vendors/opencode/adapter
 */
import { LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk, TokenUsage } from "@deepseek-ai/dsh-llm";

import type { AccountPort, FailureKind, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { pickFallbackModel, type FallbackCandidate as ModelFallbackCandidate } from "../../core/switching/model-fallback";
import { officialModelName } from "../../core/model-names";
import { delegateStream, noteCatalogModels } from "../model-catalog-registry";
import { NOOP_USAGE_PORT, type UsagePort } from "../../core/usage/port";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { pickApiKey } from "../../core/credentials";
import { pickExhaustedFailure } from "../../core/failures";
import { MAX_TRIED, RotationEngine } from "../../core/switching/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, runStream } from "../../core/transport";
import { createOpencodeCatalog } from "./catalog";
import { createSingleFlight } from "../../core/single-flight";
import { collectImageBytes } from "../../core/image-projection";
import type { ImageRefLike, RequestImageBytes } from "../../core/image-projection";
import { opencodeSessionHeaders } from "./session";
import { createCredentialGuard, type CredentialGuard } from "../../core/credential-guard";
import { OAUTH_PREFIX, OAuthRefreshError, resolveOAuthCredential } from "./oauth";
import type { OpencodeCatalog, OpencodeCatalogRecord } from "./catalog";
import { classifyGatewayFailure, gatewayLlmError } from "./failures";
import {
  DEFAULT_API,
  DEFAULT_BASE_URL,
  DEFAULT_CATALOG_TTL_MS,
  DEFAULT_GENERATE_MAX_TOKENS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  OpencodeStreamFailure,
  buildPiModel,
  recordGatewayFetch,
  streamOpencode,
  toPiContext,
} from "./protocol";
import type { ThinkingLevel } from "./protocol";
import type { GatewayEvidence, GatewayRecorder } from "./protocol";
import { parseDsmlCalls } from "./dsml";

/**
 * 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
 * `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
 */
const ABORTED_CODE = "ABORTED";

/**
 * 认不出来的 pi-ai 流内失败交给宿主的错误码（旧插件 `classifyPiAiError` 的兜底，
 * 第 1710 行）：确定性的终态，**不在** {@link RETRYABLE_CODES} 里。
 */
const PI_AI_ERROR_CODE = "PI_AI_ERROR";

/**
 * 重试延迟上限。opencode 的旧插件**没有** `providerRetryPolicy`（旧包全文无此符号），
 * 所以这套值与 Task 9 的 commandcode 路由保持一致 —— 它是控制器裁决 12 定下的路由策略，
 * 不是从某个旧包抄来的。
 */
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

/** 按模型覆盖的上下文窗口/输出上限。`null` 与缺省同义：不改目录自报值。 */
export interface OpencodeModelLimits {
  contextWindow?: number | null;
  maxTokens?: number | null;
}

/**
 * opencode 的配置形状。
 *
 * 全部字段缺省即可用。**没有 `apiKey` 字面量字段**：opencode 的密钥只有 `stored` 与
 * `environment` 两个来源（设计 §4.2 的差异表：opencode 没有 auth.json 兜底，旧插件也没有任何
 * 「配置里写死 key」的字段 —— `dsh-opencode-go/lib/index.js` 第 6816-6852 行的 Config 里全文
 * 没有 `apiKey`）。文档里若手写一个 `apiKey` 字段，schema 会原样带过它，但本适配器**不读**：
 * 它既不是 `role("secret")`（不会被脱敏，会明文流到设置客户端），也不该成为凭据来源。
 */
export interface OpencodeConfig {
  /** 网关基地址；缺省 {@link DEFAULT_BASE_URL}。 */
  apiBase?: string;
  /** 整请求 deadline（毫秒）；缺省 {@link DEFAULT_REQUEST_TIMEOUT_MS}。 */
  requestTimeoutMs?: number;
  /** 流空闲看门狗（毫秒）；缺省 {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}。 */
  streamIdleTimeoutMs?: number;
  /** 未指定 `maxTokens` 时的输出上限；再受 {@link DEFAULT_GENERATE_MAX_TOKENS} 约束。 */
  defaultMaxTokens?: number;
  /** 目录缓存 TTL（毫秒）；缺省 {@link DEFAULT_CATALOG_TTL_MS}。 */
  catalogTtlMs?: number;
  /** 模型白名单（设置文档字段，形状不可信）。 */
  visibleModels?: readonly string[];
  /** 逐模型显式可见性开关（设置文档字段，形状不可信）。 */
  modelVisibility?: Readonly<Record<string, boolean>>;
  /** 逐模型的上下文窗口/输出上限覆盖（`thinkingBudgets` 属第 2 期）。 */
  modelLimits?: Readonly<Record<string, OpencodeModelLimits>>;
}

/** 一次请求循环需要的、已填好默认值的配置。 */
interface ResolvedConfig {
  apiBase: string;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  defaultMaxTokens: number;
  catalogTtlMs: number;
}

/**
 * 适配器的依赖。三个来源读取函数都是注入点：本任务不直接依赖 `ctx`（宿主服务在
 * Task 14 接线），测试可以给假实现。
 */
export interface OpencodeAdapterDeps {
  /** 每次请求重新读取的配置（volatile 字段据此立即生效）。 */
  config: () => OpencodeConfig;
  /** 本请求的账号轮换与拒绝记忆。 */
  rotation: RotationEngine;
  /** 额度端口（本任务不读，Task 13 用）。 */
  quota: QuotaPort;
  /** 账号端口（本任务不写，Task 13 用）。 */
  accounts: AccountPort;
  /** 注入的 `fetch`（测试用假实现；生产传全局 `fetch`）。同时也是 pi-ai 的 HTTP 通道。 */
  fetchImpl: typeof fetch;
  /**
   * 「这次请求由**备用账号**服务成功了」的报告口（策略在装配层，见 `index.ts` 的
   * `promoteServedAccount`）：旧插件把这种账号提成当前账号（`GoAccountSelection.adopt`），
   * 本适配器只负责判定「成功的不是本轮第一个被选中的账号」—— 判定是纯逻辑，可单测；
   * 提位要不要真写设置（自动开关、单飞、写什么）由掌握设置文档的那一层决定。
   */
  promoteServed?: (ref: string) => void;
  /** 普通对话请求前的切换钩子；辅助调用（compaction/session-title）不调用。 */
  beforeRequest?: (input: { sessionId?: string; purpose?: string }) => Promise<void>;
  /** `stored` 来源：凭据库读取（宿主 `credentials.resolve(ref)?.value` 的注入点）。 */
  resolveStored?: (ref: string) => Promise<string | undefined>;
  /** `environment` 来源：启动环境读取（宿主 `launchEnvironmentOf(ctx).get(name)` 的注入点）。 */
  resolveEnvironment?: (name: string) => string | undefined;
  /**
   * 图片字节读取（宿主 `attachments.readImageRequest` 的注入点）。
   *
   * 2026-11-04 外部审查 U07：**原来根本没有这个依赖** —— 协议层只取文本，
   * 图片被静默丢弃，而目录照样宣称 `image` 能力。接上之后，混图请求的图片
   * 才会真的出现在出站正文里；取不到字节时降级成占位文本（仍不静默丢）。
   */
  resolveImage?: (ref: ImageRefLike, signal?: AbortSignal) => Promise<RequestImageBytes | undefined>;
  /** 凭据写入守卫（装配层注入，用于跨方法的代际协调）。 */
  credentialGuard?: CredentialGuard;
  /** 刷新后的 OAuth blob 回写凭据槽（只在原值是 blob、且确实刷新过时调用）。 */
  persistStored?: (ref: string, value: string) => Promise<void>;
  /** Console 基地址（设备码/刷新端点）；缺省 `https://opencode.ai`。 */
  authBase?: string;
  /** 时钟（测试注入）。 */
  now?: () => number;
  /**
   * 用量采集端口（可选）。成功与失败都记 —— 只记成功会让成功率永远是 100%。
   * 端口实现必须不阻塞、不抛错（见 `core/usage-port`）。
   */
  usage?: UsagePort;
  /**
   * **限额时换模型**的候选提供者（可选；需求）。
   *
   * 只在所有账号都被限额拒绝之后被调用一次（失败路径），所以它可以是异步的：
   * 候选清单要读各家的模型目录，而目录是网络资源。
   * 缺省 = 不换模型（旧行为）。
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
function resolveConfig(raw: OpencodeConfig): ResolvedConfig {
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  const ttl = raw.catalogTtlMs;
  return {
    apiBase: raw.apiBase !== undefined && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_BASE_URL,
    requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
    catalogTtlMs: ttl !== undefined && Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_CATALOG_TTL_MS,
  };
}

/** 一次 usage chunk 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage: TokenUsage): number {
  return usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/** 分类出的一次失败：分类结果，以及轮换用尽时要抛给宿主的错误。 */
interface AttemptFailure {
  rejection: Rejection;
  thrown: unknown;
}

/** opencode 适配器：宿主 `LlmAdapter` 的一个真实子类。 */
class OpencodeAdapter extends LlmAdapter implements CatalogModelsPort {
  readonly #deps: OpencodeAdapterDeps;
  /** 按基地址缓存的目录（同一基地址复用 TTL 缓存）。 */
  readonly #catalogs = new Map<string, OpencodeCatalog>();
  /**
   * 按账号 ref 合并并发的 OAuth 刷新（2026-10-22 修 bug 审查 LOW-1）。
   *
   * 同一账号上并发的请求共享**一次**刷新：若各自刷，服务端启用 refresh token 轮换时
   * 后一次会用已失效的旧 token，那次刷新失败、该请求失败。实现见
   * `core/single-flight`（抽成独立模块以便直接测生产代码，而不是复刻一份逻辑）。
   */
  readonly #singleFlight = createSingleFlight();

  /**
   * 凭据写入守卫（2026-11-01 修 S01 第二版）。
   *
   * 见 `core/credential-guard` 的模块注释：宿主 `CredentialPort` 没有 CAS，插件侧
   * 无法做到跨进程原子写。这里能保证的是「本插件内对同一 ref 的写入串行化并校验
   * 代际」—— 用户换 key / 重新登录时推进代际，于是**在那之前发起**的刷新不会写回。
   *
   * **由装配层注入**：用户操作（replaceKey / 重登 / 删除）走的是 accounts 端口，
   * 只有装配层同时看得到「端口」与「本 adapter」，所以代际推进必须在那里做。
   * 不注入时自建一个（单测直接构造 adapter 也能用）。
   *
   * 边界必须说清楚：插件外部（宿主凭据页、别的插件）的写入不经过这个队列。
   */
  readonly #credentialGuard: CredentialGuard;


  /**
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: OpencodeAdapterDeps) {
    super();
    this.#deps = deps;
    this.#credentialGuard = deps.credentialGuard ?? createCredentialGuard();
  }

  /** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: "OpenCode Go" };
  }

  /**
   * 路由的重试白名单（控制器裁决 12）：与 Task 9 的 commandcode 路由同一套值。
   * `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` 必须显式列出（宿主的默认白名单里没有）。
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
      "llm-opencode-go: retryPolicy",
    );
  }

  /**
   * 拉目录 → 应用可见性规则 → 映射为宿主形状（旧插件 `listModels` 第 7390-7399 行）。
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
    const raw = this.#deps.config();
    const records = await this.#catalog(resolveConfig(raw), undefined);
    const visible = selectVisible(
      records.map((record) => record.entry),
      normalizeVisibility(raw),
    );
    // 把目录交给跨厂商注册表：限额换模型时走缓存，不再现打网络。
    noteCatalogModels(
      provider,
      // 带上能力信息：换模型时的「参数能力接近」要用上下文窗口与档位数。
      visible.map((entry) => ({
        id: entry.id,
        ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
        ...(entry.efforts === undefined ? {} : { effortCount: entry.efforts.length }),
      })),
    );
    return visible.map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
    }));
  }

  /**
   * 全部目录条目（不受可见性过滤），供设置页勾选。
   * @returns 目录里的模型 id 与名称。
   */
  /**
   * 全部目录条目（**不受可见性过滤**）。
   *
   * @param fresh - 绕过 TTL 缓存重读（2026-11-04 外部审查 U10）。
   *
   *   `CatalogModelsPort` 的契约写明「刷新按钮必须用它」，本方法原来直接忽略了这个参数：
   *   TTL 内点刷新只会拿到缓存，服务端已变的列表永远看不到 —— 界面上就是「点了没反应」。
   */
  async catalogModels(fresh = false): Promise<CatalogModel[]> {
    const records = await this.#catalog(resolveConfig(this.#deps.config()), undefined, fresh);
    return records.map((record) => ({
      id: record.entry.id,
      ...(record.entry.name === "" ? {} : { name: record.entry.name }),
      ...(record.company === undefined ? {} : { company: record.company }),
      ...(record.free === true ? { free: true } : {}),
    }));
  }

  /**
   * 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力，再套
   * `modelLimits` 覆盖；目录不可用或没有该模型时退化成「只有 id 的目录外模型」
   * （旧插件 `resolveModel` 第 7400-7402 行 + `withModelLimit` 第 7341-7350 行）。
   */
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const raw = this.#deps.config();
    const config = resolveConfig(raw);
    let record: OpencodeCatalogRecord | undefined;
    try {
      record = (await this.#catalog(config, signal)).find((candidate) => candidate.entry.id === model);
    } catch {
      // 目录是建议性的：拉不到也应该能解析模型身份，让请求走到 provider 再报错。
      record = undefined;
    }
    const entry: CatalogEntry | undefined = record?.entry;
    const limits = raw.modelLimits?.[model];
    // 覆盖优先于目录自报值；`null` 与缺省都表示「不改」。缺失字段绝不补 0。
    const contextWindow = limits?.contextWindow ?? entry?.contextWindow;
    const maxTokens = limits?.maxTokens ?? entry?.maxTokens;
    const efforts = record?.efforts ?? entry?.efforts ?? [];
    return {
      provider,
      id: model,
      name: entry?.name ?? officialModelName(model),
      inputModalities: entry?.inputModalities ?? ["text"],
      ...(contextWindow === undefined ? {} : { context: { contextWindow } }),
      ...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
      // **能力声明**（2026-10-20 对齐官方实现）：官方 `dsh-llm-deepseek` 在模型目录里
      // 硬编码等同的两项（`systemPromptUpdate: "in-history"`, `toolUpdate: "addition-only"`）。
      //
      // 它们**不是用户选项**，而是告诉宿主「这个模型怎么读中途变化的系统提示与工具声明」：
      // - `in-history`：模型会把任意位置的 `system` 消息读作最新系统提示，于是改提示文
      //   只需要追加一条，不必重写 message 0（省缓存）；
      // - `addition-only`：模型认 `deferLoading` + 后续 `tool-addition` 块，新增工具可以
      //   跟在缓存历史之后，不必每轮重发完整声明列表。
      //
      // opencode 走 Anthropic Messages（`pi-ai`），两者都是该协议的既有语义。
      systemPromptUpdate: "in-history",
      toolUpdate: "addition-only",
      ...(efforts.length === 0
        ? {}
        : { reasoning: { efforts: efforts.map((effort) => ({ id: ReasoningEffortId(effort), name: effort })) } }),
    };
  }

  /**
   * 流式请求：账号轮换 → 凭据 → pi-ai 请求 → 时间预算 → 失败分类 → 有条件的账号回退。
   * @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
   * @returns 与线上同序的 chunk 流。
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined && options.stop.length > 0) {
      // 宿主契约：不支持的 stop 序列由适配器拒绝（旧插件第 7465-7467 行的同一条）。
      throw new LlmError("OpenCode Go adapter does not support stop sequences", "UNSUPPORTED_OPTION");
    }
    // 账号切换策略：在选号之前决定要不要换当前账号（辅助调用直接跳过）。
    await this.#deps.beforeRequest?.({
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    });
    const raw = this.#deps.config();
    const tried = new Set<string>();
    let lastFailure: AttemptFailure | undefined;
    /**
     * 本请求内**按尝试顺序**记录的全部失败（2026-11-06 与 opendesign 同步）。
     *
     * 用尽时不能直接抛最后一条：链条里有可自愈的瞬时失败、最后一条却是不可重试的
     * 终态（`quota` / `invalid-credential`）时，宿主的自动继续不会重试，会把一个本来
     * 能救回来的回合判死。选择逻辑见 `core/failures.ts` 的 `pickExhaustedFailure`。
     */
    const failures: AttemptFailure[] = [];
    /** 试完了：抛「最值得让宿主重试」的那一条，而不是碰巧最后失败的那一条。 */
    const throwExhausted = (): never => {
      const picked = pickExhaustedFailure(failures) ?? lastFailure;
      if (picked === undefined) {
        throw new LlmError(`llm-opencode-go: all OpenCode Go accounts are unavailable for model "${options.model}"`, "MISSING_CREDENTIAL");
      }
      throw picked.thrown;
    };
    /** 已经换过一次模型了吗（只换一次：替代也限额就停手，不再套娃）。 */
  /**
   * 本次请求是否**已经换过模型**。
   *
   * 从 `options` 里读初值（2026-11-01 修 R01）：跨网关委托时
   * `delegateStream` 会把 options 透传给目标家的 adapter，如果每家都用自己实例
   * 上的 `false` 重新开始，就会出现 **A→B→A** 的无限往返 —— 每家都觉得自己
   * "还没换过"。把标记放进 options，整条委托链共享同一个值。
   */
  let swappedOnce = (options as { swappedOnce?: boolean }).swappedOnce === true;
    /** 本轮第一个被选中的账号；`undefined` 表示还没选过（见下面的晋升判定）。 */
    let firstPick: string | undefined;

    for (;;) {
      // 取成局部布尔量：`options.signal` 是只读参数对象上的属性，直接比较会让
      // TypeScript 把下面的同名比较收窄成「恒假」。
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
          const swapped = await this.#fallbackModel(options, lastFailure.rejection.kind);
          if (swapped !== undefined && (swapped.provider !== options.provider || swapped.model !== options.model)) {
            swappedOnce = true;
            // **跨厂商**：本 adapter 不能以别家身份发请求，转给目标家的 adapter。
            if (swapped.provider !== options.provider) {
              const delegated = delegateStream(swapped, {
                ...options,
                // **把「已换过模型」传给下一家**（2026-11-01 修 R01）。
                // 不传的话每家 adapter 都从 false 开始，A→B→A 可以无限往返。
                swappedOnce: true,
              } as unknown as Record<string, unknown>);
              if (delegated !== undefined) {
                yield* delegated as AsyncIterable<StreamChunk>;
                return;
              }
            } else {
              options = { ...options, model: swapped.model };
              tried.clear();
              firstPick = undefined;
              continue;
            }
          }
        }
        if (lastFailure !== undefined) throwExhausted();
        throw new LlmError(
          `llm-opencode-go: no OpenCode Go account is available for model "${options.model}"; add an account or store its API key`,
          "MISSING_CREDENTIAL",
        );
      }
      tried.add(ref);
      // 本轮第一个被选中的账号 = 这次的「首选」；后面成功的都是备用账号（晋升判定用）。
      if (firstPick === undefined) firstPick = ref;

      let auth: { key: string; headers?: Record<string, string> } | undefined;
      try {
        auth = await this.resolveAccountAuth(ref, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw this.#abortError(options.signal);
        // Only temporary authentication failures may advance to a different account.
        if (!(error instanceof LlmError) || !["SERVER", "TRANSPORT", "RATE_LIMIT", LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT].includes(error.code)) throw error;
        const rejection: Rejection = {
          kind: error.code === "RATE_LIMIT" ? "rate-limit" : error.code === "SERVER" ? "server" : "network",
          message: error.message,
        };
        this.#deps.rotation.markRejected(ref, rejection);
        lastFailure = { rejection, thrown: error };
        failures.push(lastFailure);
        if (tried.size >= this.#maxTried()) throwExhausted();
        continue;
      }
      if (auth === undefined) {
        // 没有可用密钥的账号不可能自行恢复：立刻记入拒绝表（`invalid-credential`
        // 只能被显式清除），否则每次请求都会重新选中它并再次失败。
        const rejection: Rejection = {
          kind: "invalid-credential",
          message: `OpenCode Go account "${ref}" has no usable API key`,
        };
        this.#deps.rotation.markRejected(ref, rejection);
        lastFailure = {
          rejection,
          thrown: new LlmError(
            `llm-opencode-go: no API key for OpenCode Go account "${ref}"; store it through the credentials service or export it in the launching environment`,
            "MISSING_CREDENTIAL",
          ),
        };
        failures.push(lastFailure);
        if (tried.size >= this.#maxTried()) throwExhausted();
        continue;
      }

      let emitted = false;
      let totalTokens = 0;
      let pendingUsage: StreamChunk | undefined;
      /** 用量采集：把本次尝试的 usage 逐块累加（厂商可能发多次）。 */
      const counts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      // 每次尝试一套「网关证据」记录：失败时用它还原（HTTP 状态，正文），
      // 否则 pi-ai 的错误事件只剩一句文案，`classifyGatewayFailure` 无从下手。
      // 调用方信号一并传入：取消时要能放弃读那条诊断正文（正文读取自带 1s 期限）。
      const gateway = recordGatewayFetch(this.#deps.fetchImpl, options.signal);
      // 逐次索取上游：**只有** `iterator.next()` 的失败算本次尝试的失败；
      // 消费方在 `yield` 处的中断/抛错原样冒泡，不会被当成厂商失败而重放。
      const iterator = this.#attempt(raw, options, auth, gateway)[Symbol.asyncIterator]();
      let failure: unknown;
      let exhausted = false;
      /**
       * DSML 抢救状态（2026-11-07）。
       *
       * `deepseek-v4.1-flash` 在这个网关上偶尔把工具调用写成 DeepSeek 的 DSML 文本，
       * 而且是写进 **reasoning 通道**、`finish` 还是 `stop`。网关没解析，插件照原样
       * 透传 —— 宿主只看到「没有工具调用 + 模型自己停了」，这一轮**空着结束**，
       * 用户看到的就是「输出一点就被截断」。
       *
       * 所以这里一边流一边把正文与 reasoning 的文本累起来，到 `finish` 时如果
       * **一个工具调用都没出现过**、而文本里有 DSML 块，就把它们解析成真正的工具调用补发。
       * 详见 `./dsml`。
       */
      let salvageText = "";
      let sawToolCall = false;
      let lastBlockIndex = -1;
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
          // 抢救状态：文本/推理累计 + 是否已经出现过工具调用 + 最大块序号（补发要用下一个）。
          if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") salvageText += chunk.text;
          if (chunk.type === "tool-call-delta" || (chunk.type === "block-start" && chunk.blockType === "tool-call")) {
            sawToolCall = true;
          }
          if (chunk.type === "block-start" || chunk.type === "block-end" || chunk.type === "tool-call-delta") {
            if (chunk.index > lastBlockIndex) lastBlockIndex = chunk.index;
          }
          if (chunk.type === "block-end" && chunk.block.type === "tool-call") sawToolCall = true;
          if (chunk.type === "usage") {
            // usage 不算「已输出」：它只说明这个账号已经产生了计费，由 totalTokens 表达。
            totalTokens += usageTotal(chunk.usage);
            counts.inputTokens += chunk.usage.inputTokens ?? 0;
            counts.outputTokens += chunk.usage.outputTokens ?? 0;
            counts.cacheReadTokens += chunk.usage.cacheReadTokens ?? 0;
            counts.cacheWriteTokens += chunk.usage.cacheWriteTokens ?? 0;
            pendingUsage = chunk;
            continue;
          }
          if (chunk.type === "finish" && chunk.reason.kind === "error") {
            // pi-ai 把「空响应 / 上下文溢出」这类终态包成 finish：它是**宿主**的错误码
            // （EMPTY_RESPONSE / CONTEXT_WINDOW_EXCEEDED 都在重试白名单里），交给宿主，
            // 不在这里当成账号级失败重放（旧插件 `accountFallback` 第 6968-6980 行同样
            // 只对 QUOTA / 凭据失败换账号）。
            throw new LlmError(chunk.reason.failure.message, chunk.reason.failure.code);
          }
          if (pendingUsage !== undefined) {
            yield pendingUsage;
            pendingUsage = undefined;
          }
          if (chunk.type === "finish" && !sawToolCall) {
            /**
             * DSML 抢救（2026-11-07）：模型把工具调用写成了文本，网关没解析。
             *
             * 补发成真正的工具调用块，并把 finish 改成 `tool-calls` —— 否则宿主会当成
             * 「模型自己停了」而结束这一轮（用户看到的就是任务莫名中断）。
             *
             * 只在**一个工具调用都没出现过**时才做：网关已经给了结构化 `tool_calls`
             * 时不重复执行。
             */
            const salvaged = parseDsmlCalls(salvageText);
            if (salvaged.length > 0) {
              let index = lastBlockIndex + 1;
              let ordinal = 0;
              for (const call of salvaged) {
                const id = ToolCallId(`dsml_${index}_${ordinal}`);
                yield { type: "block-start", index, blockType: "tool-call" };
                yield { type: "tool-call-delta", index, id, name: call.name, argumentsDelta: call.arguments };
                yield { type: "block-end", index, block: { type: "tool-call", id, name: call.name, arguments: call.arguments } };
                index += 1;
                ordinal += 1;
              }
              emitted = true;
              yield { type: "finish", reason: { kind: "tool-calls" } };
              continue;
            }
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
        if (pendingUsage !== undefined) yield pendingUsage;
        // 请求由这个账号**服务完了**：规格 §8.1 第 1 条的「最近成功者」（卡片跟随真实账号）。
        this.#deps.rotation.noteSettled(ref);
        this.#recordUsage(ref, options.model, "success", counts);
        // 服务成功的不是本轮首选 → 它是备用账号：报告给装配层提位（旧插件
        // `GoAccountSelection.adopt` 的同一后果）。提位失败不影响这次请求的结果。
        if (firstPick !== undefined && ref !== firstPick) this.#deps.promoteServed?.(ref);
        return;
      }

      if (options.signal?.aborted === true || this.#isAbort(failure)) {
        // 用户主动取消：不算厂商失败，但 token 已经花掉了 —— 仍然记一条。
        this.#recordUsage(ref, options.model, "failure", counts, "aborted");
        throw failure;
      }
      const classified = this.#classify(failure, await gateway.evidence());
      // 请求级拒绝：换账号没有意义。pi-ai 的证据载体换成宿主认识的稳定终态码
      // （`PI_AI_ERROR`，旧插件第 1710 行）：它不在重试白名单里，宿主不会把它当瞬时故障重试。
      if (classified === undefined) {
        this.#recordUsage(ref, options.model, "failure", counts, "request");
        throw failure instanceof OpencodeStreamFailure
          ? new LlmError(failure.message, PI_AI_ERROR_CODE, { cause: failure })
          : failure;
      }
      this.#deps.rotation.markRejected(ref, classified.rejection);
      lastFailure = classified;
      failures.push(classified);
      this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
      // 唯一的换账号条件（Task 5 的判定）：已输出 / 已消耗 token / 已中止都不换。
      if (!this.#deps.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
      if (tried.size >= this.#maxTried()) throwExhausted();
    }
  }

  /**
   * 把一次尝试的结果交给用量端口（旁路：绝不因为统计失败而改变请求结果）。
   * @param account - 服务这次请求的账号 ref。
   * @param model - 模型 id。
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
        vendor: "dsh-opencode-go",
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

  /** 一次尝试：装模型 → 投影上下文 → 经 pi-ai 发出 → 套上时间预算。 */
  async *#attempt(
    raw: OpencodeConfig,
    options: GenerateOptions,
    auth: { key: string; headers?: Record<string, string> },
    gateway: GatewayRecorder,
  ): AsyncGenerator<StreamChunk> {
    const config = resolveConfig(raw);
    /**
     * **每次尝试一个自己的网络 controller**（2026-11-05 外部审查 F04）。
     *
     * 上一版只把 `options.signal` 交给 `runStream`，**没有**传 `abortNetwork`：
     * 整请求/流空闲超时后上层报超时、`iterator.return()` 也发了，但底层 `fetch`
     * 的 signal 从未 abort —— socket 与 reader 一直挂着。
     *
     * `transport.ts` 的注释已经把这事说清楚了：卡在 Web Stream `read()` 上的
     * reader 不响应 `return()`，只能靠 abort。Command Code 与 Open Design 都接了
     * （`commandcode/adapter.ts`、`opendesign/adapter.ts` 的 `deadline.networkAbort()`），
     * 只有 opencode 漏了 —— 这不是新设计，是**补齐第三家**。
     *
     * 为什么是「每次尝试新建」而不是共享一个：一个账号/一次尝试的取消不该影响
     * 同进程里其他并发请求。
     */
    const network = new AbortController();
    /** 调方取消 **或** 本 attempt 的网络超时，任一成立都让底层请求停下。 */
    const attemptSignal =
      options.signal === undefined ? network.signal : AbortSignal.any([options.signal, network.signal]);
    const record = await this.#recordFor(config, options.model, attemptSignal);
    const entry = record?.entry;
    /**
     * 取本次请求需要的图片字节（2026-11-04 外部审查 U07）。
     *
     * 没有 `resolveImage` 注入时返回空表 —— 协议层会把图片降级成占位文本，
     * 仍然不静默丢弃。单张读失败同样只影响那一张。
     */
    const images = await imagesOf(options, this.#deps.resolveImage, attemptSignal);
    const limits = raw.modelLimits?.[options.model];
    const contextWindow = limits?.contextWindow ?? entry?.contextWindow;
    const modelLimit = limits?.maxTokens ?? entry?.maxTokens;
    const cap = Math.min(config.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS);
    const requested = options.maxTokens === undefined ? cap : Math.min(options.maxTokens, cap);
    const maxTokens = modelLimit === undefined ? requested : Math.min(requested, modelLimit);
    /** 宿主声明的档位（`low`/`high`/`max`），既进 thinkingLevelMap 也决定可选项。 */
    const efforts = record?.efforts ?? entry?.efforts ?? [];
    const model = buildPiModel(
      {
        id: options.model,
        name: entry?.name ?? officialModelName(options.model),
        api: record?.api ?? DEFAULT_API,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(modelLimit === undefined ? {} : { maxTokens: modelLimit }),
        reasoning: record?.reasoning === true,
        // 宿主声明的档位：落成 pi-ai 的 thinkingLevelMap，否则 max/xhigh 会被钳成 high。
        ...(efforts.length === 0 ? {} : { efforts }),
        inputModalities: entry?.inputModalities ?? ["text"],
      },
      config.apiBase,
    );
    yield* runStream(
      streamOpencode({
        model,
        context: toPiContext(options, images),
        apiKey: auth.key,
        /**
         * **必须带 `x-opencode-session`**（2026-11-02 真机报障）。
         *
         * 网关对缺这个头的推理请求直接回 400 `MissingSessionID`，请求到不了模型。
         * 值与 `auth.headers`（网页登录的 `x-opencode-org-id`）合并后一起交给
         * pi-ai，由它在最后一步覆盖 —— 两者键不冲突。
         */
        headers: { ...(auth.headers ?? {}), ...opencodeSessionHeaders(options.sessionId) },
        /**
         * **把用户选的思考强度真正交给协议层**（2026-11-04 外部审查 U06）。
         *
         * 1.9.0 只在 `protocol.ts` 里做了透传，**adapter 这一层没接** —— 于是协议层
         * 永远收不到值，三档出站全部缺失。审查的批评是对的：「不要只测底层协议函数」，
         * 而当时的测试正是只测了协议函数。回归测试现在从 `adapter.stream` 进入。
         */
        ...(options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: options.reasoningEffort as ThinkingLevel }),
        fetchImpl: gateway.fetch,
        // 交给 pi-ai 的必须是**合并后**的信号：调用方取消 或 本 attempt 超时都算数。
        signal: attemptSignal,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        maxTokens,
      }),
      { requestTimeoutMs: config.requestTimeoutMs, streamIdleTimeoutMs: config.streamIdleTimeoutMs },
      {
        signal: options.signal,
        /**
         * **超时/取消时连底层网络一起停**（2026-11-05 外部审查 F04）。
         *
         * 与另两家同一行代码：`runStream` 在「没有正常消费完」时会先 `closeQuietly`
         * 再调它。opencode 的正文同样来自 Web Stream，卡在 `read()` 时只有 abort
         * 才能让 socket 释放。
         */
        abortNetwork: () => {
          if (!network.signal.aborted) network.abort();
        },
      },
    );

  }

  /** 找一条目录记录；目录不可用时退化成「只有 id」的目录外模型（不抛）。 */
  async #recordFor(
    config: ResolvedConfig,
    model: string,
    signal: AbortSignal | undefined,
  ): Promise<OpencodeCatalogRecord | undefined> {
    try {
      return (await this.#catalog(config, signal)).find((candidate) => candidate.entry.id === model);
    } catch {
      return undefined;
    }
  }

  /**
   * 收集两个凭据来源并按优先级挑选（`stored → environment`），再把 `ocoauth1:` blob
   * 解析成一次可用的 access token + org 头；过期就在请求前刷新并回写凭据槽。
   *
   * **没有字面量来源**：opencode 的密钥只能来自凭据服务或启动环境（旧插件的 Config 里根本没有
   * 「配置写死 key」的字段，额度路径的 `resolveAccountKey` 也是同一套来源）。
   * @param ref - 账号 ref。
   * @returns 请求凭据；没有可用密钥或刷新失败时为 `undefined`。
   */
  async #resolveAuth(ref: string, epochAtStart: number): Promise<{ key: string; headers?: Record<string, string> } | undefined> {
    /**
     * **在首次异步读取之前**抓代际（2026-11-01 修 S01 第三版）。
     *
     * 报告指出的缺口：上一版把 `epochOf(ref)` 放在 `await resolveStored()` **之后**。
     * 于是「旧快照」与「新代际」可能被错误配对：
     *
     * ```
     * T0  resolveStored 开始（此刻槽里是旧 blob）
     * T1  用户换 key → 代际 +1
     * T2  resolveStored 返回旧 blob
     * T3  epochOf() 读到**新**代际 → 与旧 blob 配对
     * T4  刷新返回 → 校验通过（代际没再变）→ 把旧 blob 写回去
     *     ↑ 用户的新 key 被覆盖
     * ```
     *
     * 放在最前面之后，T0 那一刻的代际与 T0 那一刻读到的 blob 严格对应。
     */
    const stored = await this.#deps.resolveStored?.(ref);
    if (this.#credentialGuard.epochOf(ref) !== epochAtStart) return this.resolveAccountAuth(ref);
    const environment = this.#deps.resolveEnvironment?.(ref);
    const raw = pickApiKey({
      ...(stored === undefined ? {} : { stored }),
      ...(environment === undefined ? {} : { environment }),
    }).key;
    if (raw === undefined) return undefined;
    if (!raw.startsWith(OAUTH_PREFIX)) return { key: raw };
    /**
     * OAuth 刷新按 ref 去重（2026-10-22 修 LOW-1）：同一账号上并发请求共享一次刷新。
     *
     * 只有「需要刷新」时才走这段 —— `resolveOAuthCredential` 内部会先判断 token 是否
     * 即将过期，不新鲜时立即返回，那种情况（绝大多数）不该被去重表串行化。
     */
    // 调用者的 signal：只让「等刷新」这个动作可取消，共享工作本身不受影响（审查 U03）。
    const resolved = await resolveOAuthCredential(raw, {
      fetchImpl: this.#deps.fetchImpl,
      ...(this.#deps.authBase === undefined ? {} : { authBase: this.#deps.authBase }),
      ...(this.#deps.now === undefined ? {} : { now: this.#deps.now }),
    }, { signal: AbortSignal.timeout(10_000), throwOnTransient: true });
    if (resolved === undefined) return undefined;
    /**
     * 只回写「从凭据槽读出来的那一份」：环境变量里的 blob 没有可写回的持久位置。
     *
     * ## 写回前**重新读一次**凭据槽（2026-11-01 修 S01）
     *
     * 原来的判断是 `stored === raw` —— 拿的都是**刷新开始前**的快照。于是：
     *
     * ```
     * T0  读到旧 OAuth blob（raw），发现要刷新，发起请求
     * T1  用户换 key / 重新登录 → 凭据槽写入新值
     * T2  刷新返回 → stored === raw 仍成立（都是 T0 的）→ 把旧 blob 写回去
     * ```
     *
     * **用户刚存的新 key 被迟到的旧刷新覆盖**，而且因为 `#singleFlight` 去重，
     * 整个过程没有任何报错。
     *
     * ## 第二版：光「再读一次」不够（2026-11-01 复审第 2 轮）
     *
     * 上一版加了「写回前再读一次」，但读取与写入之间仍然有窗口：
     *
     * ```
     * T1  刷新返回，二次读取 → 还是 raw
     * T2  **暂停**（事件循环让出）
     * T3  用户换 key，完整提交
     * T4  继续 T1 的写 → 覆盖
     * ```
     *
     * 宿主 `CredentialPort` 只有 `resolve/set/unset/describe`，**没有 CAS 或版本条件
     * 更新**，所以插件侧做不到真正的原子写。现在的做法：
     *
     * 1. 刷新**开始前**记下代际（`epochAtStart`）；
     * 2. 写回时把写操作交给 `#credentialGuard` **排队**并校验代际 —— 用户操作
     *    （换 key / 重登 / 删除）会推进代际，于是排队期间用户改过就放弃写回。
     *
     * **边界**：这只保证本插件内的顺序一致。宿主凭据页或别的插件的写入不经过这个
     * 队列 —— 不能对外宣称「整个宿主的原子性」。
     */
    if (resolved.updated !== undefined && stored === raw) {
      const updated = resolved.updated;
      try {
        await this.#credentialGuard.run(ref, epochAtStart, async () => {
          await this.#deps.persistStored?.(ref, updated);
        });
        // 代际不符时 `run` 返回 false 且不写 —— 用户的新 key 保持不动。
      } catch {
        // 回写失败不影响本次请求：新 token 已经在内存里，下一次会再刷新一次。
      }
    }
    return { key: resolved.key, ...(resolved.headers === undefined ? {} : { headers: resolved.headers }) };
  }

  /** Chat and quota share refresh AND persistence; each waiter owns its cancellation. */
  async resolveAccountAuth(ref: string, signal?: AbortSignal): Promise<{ key: string; headers?: Record<string, string> } | undefined> {
    if (signal?.aborted) throw this.#abortError(signal);
    const timeoutMs = resolveConfig(this.#deps.config()).requestTimeoutMs;
    const epoch = this.#credentialGuard.epochOf(ref);
    const pending = this.#singleFlight(`${ref}:${epoch}`, () => this.#resolveAuth(ref, epoch));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new LlmError("OpenCode authentication timed out", LLM_REQUEST_TIMEOUT)), timeoutMs);
          if (signal !== undefined) {
            onAbort = () => reject(this.#abortError(signal));
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
      ]);
    } catch (error) {
      if (error instanceof LlmError) throw error;
      const code = error instanceof OAuthRefreshError
        ? error.status === 429 ? "RATE_LIMIT" : error.status === 408 ? LLM_REQUEST_TIMEOUT : "SERVER"
        : error instanceof Error && error.name === "TimeoutError" ? LLM_REQUEST_TIMEOUT : "TRANSPORT";
      throw new LlmError(error instanceof Error ? error.message : String(error), code, { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    }
  }

  /** 拿（或建）该基地址的目录缓存。 */
  #catalog(config: ResolvedConfig, signal?: AbortSignal, fresh = false): Promise<OpencodeCatalogRecord[]> {
    let catalog = this.#catalogs.get(config.apiBase);
    if (catalog === undefined) {
      catalog = createOpencodeCatalog({
        baseUrl: config.apiBase,
        fetchImpl: this.#deps.fetchImpl,
        ttlMs: config.catalogTtlMs,
      });
      this.#catalogs.set(config.apiBase, catalog);
    }
    return catalog.list(signal, fresh);
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
     * 于是「密钥配在环境变量里」的用户：`stream` 能成功，模型列表却是空的 ——
     * 表现为「明明能聊天，模型选择器里什么都没有」。
     *
     * 两种来源都没注入时**仍按「无法判定」放过**（宁可多列几个用不了的，
     * 也不误伤 —— 这是原有语义，不能弄丢）。
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
   * @param options - 当前请求。
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
      const record = (await this.#catalog(resolveConfig(this.#deps.config()), undefined)).find((item) => item.entry.id === options.model);
      const entry = record?.entry;
      if (entry !== undefined) {
        currentMeta = {
          ...(entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow }),
          ...(entry.efforts === undefined ? {} : { effortCount: entry.efforts.length }),
        };
      }
    } catch {
      // 目录读不到：能力信息缺失（排序会给大惩罚），但仍可换同名模型。
    }
    const picked = pickFallbackModel(
      { provider: options.provider, model: options.model, ...currentMeta },
      // 候选只有「用户已允许的模型」（注册表用 listModels 过滤，只含账号里已显示的）。
      candidates.map((item) => ({
        provider: item.provider,
        model: item.model,
        ...(item.contextWindow === undefined ? {} : { contextWindow: item.contextWindow }),
        ...(item.effortCount === undefined ? {} : { effortCount: item.effortCount }),
      })),
      // 网络层失败（`network`）不跨网关：换一家走的是同一条路由，必然同样失败。
      { sameGatewayOnly: failureKind === "network" },
    );
    if (picked === undefined) return undefined;
    this.#deps.onModelFallback?.({ provider: options.provider, model: options.model }, picked);
    return picked;
  }
  /**
   * 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
   * （换账号没有意义），调用方应原样上抛。
   * @param error - 本次尝试抛出的异常。
   * @param evidence - `fetch` 边界观察到的（HTTP 状态，正文）；没有失败响应时缺省。
   */
  #classify(error: unknown, evidence: GatewayEvidence | undefined): AttemptFailure | undefined {
    if (error instanceof OpencodeStreamFailure) {
      const status = error.status > 0 ? error.status : (evidence?.status ?? 0);
      const body = error.body ?? evidence?.body ?? { message: error.message };
      const rejection = classifyGatewayFailure(status, body);
      if (rejection === undefined) return undefined;
      return { rejection, thrown: gatewayLlmError(rejection, status, error) };
    }
    if (error instanceof LlmError) {
      if (error.code === ABORTED_CODE) return undefined;
      if (error.code === LLM_REQUEST_TIMEOUT || error.code === LLM_STREAM_IDLE_TIMEOUT) {
        // 超时是传输级瞬时失败：可以换账号再试，但抛给宿主的始终是**原始**错误，
        // 以保留「整请求超时 vs 流空闲超时」的区分（裁决 12）。
        const rejection = classifyGatewayFailure(evidence?.status ?? 0, evidence?.body ?? { message: error.message });
        if (rejection === undefined) return undefined;
        return { rejection, thrown: error };
      }
      // 其它宿主错误已经是终态（协议错误、不支持的内容等）：不轮换。
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    const rejection = classifyGatewayFailure(evidence?.status ?? 0, evidence?.body ?? { message });
    if (rejection === undefined) return undefined;
    return { rejection, thrown: gatewayLlmError(rejection, evidence?.status, error) };
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
 * 造一个 opencode 适配器实例（注册到宿主路由由 Task 14 完成）。
 * @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
 * @returns 宿主 `LlmAdapter` 子类实例。
 */
export function createOpencodeAdapter(deps: OpencodeAdapterDeps): OpencodeAdapter {
  return new OpencodeAdapter(deps);
}

/**
 * 收集本次请求需要发送的图片字节。
 *
 * 只取**未被 offloaded** 的图片：`offloaded: true` 的含义是宿主已把这张图从请求里卸载,
 * 再读字节等于把缩减后的请求又撑回去（审查 U13）。
 *
 * **总预算在 `core/image-projection` 的 `collectImageBytes` 里统一执行**
 * （2026-11-05 外部审查 F06）：单张上限挡不住「很多张大图」，而那正是长图文会话
 * 的常态。判断下沉到 core 而不是三家各写一份 —— 与 U13 同一条教训。
 * @param options - 宿主请求。
 * @param resolve - 字节读取注入点。
 * @param signal - 本次尝试的合并信号（调用方取消或本 attempt 超时）。
 * @returns attachment id → 字节。
 */
async function imagesOf(
  options: GenerateOptions,
  resolve: OpencodeAdapterDeps["resolveImage"],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, RequestImageBytes>> {
  const { images } = await collectImageBytes(options.messages, resolve, signal ?? options.signal);
  return images;
}
