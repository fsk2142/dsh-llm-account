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
import { LlmAdapter, LlmError, ReasoningEffortId, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk, TokenUsage } from "@deepseek-ai/dsh-llm";

import type { AccountPort, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { NOOP_USAGE_PORT, type UsagePort } from "../../core/usage-port";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { pickApiKey } from "../../core/credentials";
import { MAX_TRIED, RotationEngine } from "../../core/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, runStream } from "../../core/transport";
import { createOpencodeCatalog } from "./catalog";
import { OAUTH_PREFIX, resolveOAuthCredential } from "./oauth";
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
import type { GatewayEvidence, GatewayRecorder } from "./protocol";

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
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: OpencodeAdapterDeps) {
    super();
    this.#deps = deps;
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
    const raw = this.#deps.config();
    const records = await this.#catalog(resolveConfig(raw), undefined);
    const visible = selectVisible(
      records.map((record) => record.entry),
      normalizeVisibility(raw),
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
  async catalogModels(): Promise<CatalogModel[]> {
    const records = await this.#catalog(resolveConfig(this.#deps.config()), undefined);
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
      name: entry?.name ?? model,
      inputModalities: entry?.inputModalities ?? ["text"],
      ...(contextWindow === undefined ? {} : { context: { contextWindow } }),
      ...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
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
    /** 本轮第一个被选中的账号；`undefined` 表示还没选过（见下面的晋升判定）。 */
    let firstPick: string | undefined;

    for (;;) {
      // 取成局部布尔量：`options.signal` 是只读参数对象上的属性，直接比较会让
      // TypeScript 把下面的同名比较收窄成「恒假」。
      const aborted = options.signal?.aborted === true;
      if (aborted) throw this.#abortError(options.signal);

      const ref = this.#deps.rotation.pick({ model: options.model, tried });
      if (ref === undefined) {
        // 没有可选账号：把最后一次失败原样抛出，否则说明一条可用凭据都没有。
        if (lastFailure !== undefined) throw lastFailure.thrown;
        throw new LlmError(
          `llm-opencode-go: no OpenCode Go account is available for model "${options.model}"; add an account or store its API key`,
          "MISSING_CREDENTIAL",
        );
      }
      tried.add(ref);
      // 本轮第一个被选中的账号 = 这次的「首选」；后面成功的都是备用账号（晋升判定用）。
      if (firstPick === undefined) firstPick = ref;

      const auth = await this.#resolveAuth(ref);
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
        if (tried.size >= MAX_TRIED) throw lastFailure.thrown;
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
      this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
      // 唯一的换账号条件（Task 5 的判定）：已输出 / 已消耗 token / 已中止都不换。
      if (!this.#deps.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
      if (tried.size >= MAX_TRIED) throw classified.thrown;
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
    const record = await this.#recordFor(config, options.model, options.signal);
    const entry = record?.entry;
    const limits = raw.modelLimits?.[options.model];
    const contextWindow = limits?.contextWindow ?? entry?.contextWindow;
    const modelLimit = limits?.maxTokens ?? entry?.maxTokens;
    const cap = Math.min(config.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS);
    const requested = options.maxTokens === undefined ? cap : Math.min(options.maxTokens, cap);
    const maxTokens = modelLimit === undefined ? requested : Math.min(requested, modelLimit);
    const model = buildPiModel(
      {
        id: options.model,
        name: entry?.name ?? options.model,
        api: record?.api ?? DEFAULT_API,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(modelLimit === undefined ? {} : { maxTokens: modelLimit }),
        reasoning: record?.reasoning === true,
        inputModalities: entry?.inputModalities ?? ["text"],
      },
      config.apiBase,
    );
    yield* runStream(
      streamOpencode({
        model,
        context: toPiContext(options),
        apiKey: auth.key,
        ...(auth.headers === undefined ? {} : { headers: auth.headers }),
        fetchImpl: gateway.fetch,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        maxTokens,
      }),
      { requestTimeoutMs: config.requestTimeoutMs, streamIdleTimeoutMs: config.streamIdleTimeoutMs },
      { ...(options.signal === undefined ? {} : { signal: options.signal }) },
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
  async #resolveAuth(ref: string): Promise<{ key: string; headers?: Record<string, string> } | undefined> {
    const stored = await this.#deps.resolveStored?.(ref);
    const environment = this.#deps.resolveEnvironment?.(ref);
    const raw = pickApiKey({
      ...(stored === undefined ? {} : { stored }),
      ...(environment === undefined ? {} : { environment }),
    }).key;
    if (raw === undefined) return undefined;
    if (!raw.startsWith(OAUTH_PREFIX)) return { key: raw };
    const resolved = await resolveOAuthCredential(raw, {
      fetchImpl: this.#deps.fetchImpl,
      ...(this.#deps.authBase === undefined ? {} : { authBase: this.#deps.authBase }),
      ...(this.#deps.now === undefined ? {} : { now: this.#deps.now }),
    });
    if (resolved === undefined) return undefined;
    // 只回写“从凭据槽读出来的那一份”：环境变量里的 blob 没有可写回的持久位置。
    if (resolved.updated !== undefined && stored === raw) {
      try {
        await this.#deps.persistStored?.(ref, resolved.updated);
      } catch {
        // 回写失败不影响本次请求：新 token 已经在内存里，下一次会再刷新一次。
      }
    }
    return { key: resolved.key, ...(resolved.headers === undefined ? {} : { headers: resolved.headers }) };
  }

  /** 拿（或建）该基地址的目录缓存。 */
  #catalog(config: ResolvedConfig, signal?: AbortSignal): Promise<OpencodeCatalogRecord[]> {
    let catalog = this.#catalogs.get(config.apiBase);
    if (catalog === undefined) {
      catalog = createOpencodeCatalog({
        baseUrl: config.apiBase,
        fetchImpl: this.#deps.fetchImpl,
        ttlMs: config.catalogTtlMs,
      });
      this.#catalogs.set(config.apiBase, catalog);
    }
    return catalog.list(signal);
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
export function createOpencodeAdapter(deps: OpencodeAdapterDeps): LlmAdapter & CatalogModelsPort {
  return new OpencodeAdapter(deps);
}
