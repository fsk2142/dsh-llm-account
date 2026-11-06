import { collectImageBytes } from "../../core/image-projection";
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

import type { AccountPort, AccountView, FailureKind, CatalogEntry, CatalogModel, CatalogModelsPort, QuotaPort, Rejection } from "../../core/adapter";
import { normalizeVisibility, selectVisible } from "../../core/catalog";
import { createCatalogFlight, type CatalogFlight } from "../../core/catalog-flight";
import { pickApiKey } from "../../core/credentials";
import { pickExhaustedFailure } from "../../core/failures";
import { pickFallbackModel, type FallbackCandidate as ModelFallbackCandidate } from "../../core/switching/model-fallback";
import { officialModelName } from "../../core/model-names";
import { delegateStream, noteCatalogModels } from "../model-catalog-registry";
import { NOOP_USAGE_PORT, type UsagePort } from "../../core/usage/port";
import { MAX_TRIED, RotationEngine } from "../../core/switching/rotation";
import { LLM_REQUEST_TIMEOUT, LLM_STREAM_IDLE_TIMEOUT, RequestDeadline, runStream } from "../../core/transport";
import { parseCatalog } from "./catalog";
import { allowedEffortsIn, effortsFor, upgradeAllowedEffort } from "./efforts";
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
import type { BodyFacts, RequestImageBytes } from "./protocol";

/**
 * 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
 * `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
 */
const ABORTED_CODE = "ABORTED";

/** 目录请求的预算（与另两家的同一档）。 */
const MODELS_TIMEOUT_MS = 10_000;

/**
 * 目录读数的缓存时长（毫秒）。
 *
 * 每次 `resolveModel`（宿主的模型选择器、每个请求的身份解析）都会问一次目录，而目录是**厂商级**
 * 资源、按分钟级变化。不缓存等于每个请求多打一次网络（2026-10-18 审计：一次对话里能重复十几次）。
 * 60 秒足够让「刚在设置里勾了模型」立刻生效，也足够省掉这些重复请求；失败不缓存。
 */
const CATALOG_TTL_MS = 60_000;

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
  /**
   * 出站 `messages[]` 的条数上限；缺省 {@link DEFAULT_MAX_REQUEST_ITEMS}。
   *
   * 网关对 `messages[]` 有 1000 条的硬上限（实测 `deepseek-v4.1-flash` 第 1001 条即
   * 400 `context_length_exceeded`），而宿主只有 token 概念、**没有条数概念**，所以条数
   * 无法被提前纳入压缩判定。
   *
   * 超限时这里**裁掉最旧的历史并插入明确提示**，而不是让整轮失败。这是兜底：
   * 条数超限本身也是**可自愈**的（宿主把它认成 `CONTEXT_WINDOW_EXCEEDED`，剪枝、
   * 压缩后自动重发，见 `core/wire-limit.ts` 的模块注释），裁剪只是省掉那一次白跑的
   * 请求。设成 `0` 可关闭裁剪（不建议）。
   */
  maxRequestItems?: number;
  /**
   * **覆盖宿主计量的上下文窗口**（全局）；缺省用目录公布值。
   *
   * 为什么需要这个旋钮：宿主的自动压缩阈值是
   * `floor(min(W×0.8, W−O−B))`，`W` 就是我们通过 `resolveModel` 上报的
   * `context.contextWindow`。网关 `/v1/models` 的 `metadata` 里容量字段有好几个，
   * 语义完全不同（2026-11-06 二分实测定案）：
   *
   * - `context_limit` **约 104.8 万**，是真天花板：prompt 104,8239 token 仍 200，
   *   首个失败点 ≈ 1,050,419（`400 upstream_error`）。目录取的就是它。
   * - `context_budget` 23~40 万，是「预算」不是能力上限。曾经误取它，`W` 变成
   *   328,000 → 阈值掉到 134,464 token（约 270 条消息）→ 会话刚开始就压缩。
   *
   * 这个字段留一个**不改代码就能纠正**的逃生阀：网关口径再变时，改设置即可。
   */
  contextWindow?: number;
  /** 按模型覆盖上下文窗口（键为模型 id）；优先级高于 {@link contextWindow}。 */
  contextWindowOverrides?: Readonly<Record<string, number>>;
  /** 模型白名单（设置文档字段，形状不可信）。 */
  visibleModels?: readonly string[];
  /** 逐模型显式可见性开关（设置文档字段，形状不可信）。 */
  modelVisibility?: Readonly<Record<string, boolean>>;
}

/**
 * 出站 `messages[]` 的默认条数上限（2026-11-05 修「1003 > 1000」）。
 *
 * 取网关对 `deepseek-v4.1-flash` 的实测硬上限。其它模型的实测上限更高（3000），
 * 但统一按 1000 兜底有两个好处：**绝不会 400**，且 1000 条消息本来就远超任何正常
 * 会话长度 —— 这个阈值只在「本来就要失败」的请求上生效。
 *
 * 需要在长会话里保留更多条时可以调高它。
 */
export const DEFAULT_MAX_REQUEST_ITEMS = 1_000;

/**
 * 合法上下文窗口的上下界。
 *
 * 与主流实现一致：必须是**安全整数**且在 `[1, 10_000_000]` 内。越界或非整数一律
 * 当作「没设」——宁可回落到目录值，也不要让请求带着一个网关必然拒绝的窗口上线。
 */
const MIN_CONTEXT_WINDOW = 1;
const MAX_CONTEXT_WINDOW = 10_000_000;

/**
 * 判断一个值能不能当上下文窗口用。
 * @param value - 待检查的值。
 * @returns 是否是合法的窗口（安全整数、在界内）。
 */
export function isValidContextWindow(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_CONTEXT_WINDOW &&
    value <= MAX_CONTEXT_WINDOW
  );
}

/**
 * 宿主压缩插件的**默认压力余量**（`@deepseek-ai/dsh-compaction-basic` 的
 * `headroomTokens` 缺省值）。
 *
 * 它的预算公式是 `W − O − B`，`O` 取请求的 `maxTokens`（`reservedCompletionTokens`
 * 先读会话请求头、再退回模型声明的 `defaultMaxTokens`），`B` 就是这个余量。
 * 三者关系一旦不满足 `W > O + B`，插件会在首次解析该模型时抛
 * `TargetPressureConfigError` —— 那条路由**完全不压缩**。所以输出上限必须留出它。
 *
 * 注意：用户可以改宿主的 `headroomTokens`。这里按**默认值**留量；若调大余量，
 * 需要同步调大窗口或调小输出上限。
 */
const COMPACTION_HEADROOM_TOKENS = 65_536;

/** 给对话历史保留的最低预算（token）；低于它就没什么可压缩的了。 */
const MIN_MESSAGE_BUDGET_TOKENS = 8_192;

/**
 * 把输出上限压到「窗口 − 压缩余量 − 最低消息预算」以内。
 *
 * @param declared - 目录公布的输出上限（可能未公布）。
 * @param contextWindow - 生效的上下文窗口（可能未公布）。
 * @returns 夹取后的输出上限；窗口小到装不下余量时**原样返回目录值**
 * （让宿主的配置报错如实冒出来，而不是伪造一个 1 token 的输出上限）。
 */
export function clampOutputToWindow(
  declared: number | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (declared === undefined || contextWindow === undefined) return declared;
  const cap = contextWindow - COMPACTION_HEADROOM_TOKENS - MIN_MESSAGE_BUDGET_TOKENS;
  if (cap < 1) return declared;
  return Math.min(declared, cap);
}

/**
 * 只保留合法条目的按模型覆盖表；空表/非对象/坏值一律视为未设置。
 * @param raw - 设置文档里的原始值（形状不可信）。
 * @returns 清洗后的覆盖表；没有合法条目时为 `undefined`。
 */
export function readContextWindowOverrides(raw: unknown): Record<string, number> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry) => entry[0] !== "" && isValidContextWindow(entry[1]),
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries as [string, number][]);
}

/**
 * 一个模型最终上报的上下文窗口：**按模型覆盖 → 全局覆盖 → 目录公布值**。
 *
 * 优先级照抄成熟实现（`@mars-sea/dsh-commandcode-provider` 的
 * `effectiveContextWindow`）：覆盖值只在合法时生效，坏值静默回落到下一级，
 * 绝不把非法窗口交给宿主 —— 那会让压缩预算算成 0 或负数。
 * @param catalog - 目录公布的值（可能未公布）。
 * @param model - 模型 id。
 * @param config - 适配器配置（可能带覆盖）。
 * @returns 生效的窗口；全都取不到时为 `undefined`（不宣告）。
 */
export function effectiveContextWindow(
  catalog: number | undefined,
  model: string,
  config: Pick<OpenDesignConfig, "contextWindow" | "contextWindowOverrides">,
): number | undefined {
  const overrides = readContextWindowOverrides(config.contextWindowOverrides);
  const perModel = overrides?.[model];
  if (isValidContextWindow(perModel)) return perModel;
  if (isValidContextWindow(config.contextWindow)) return config.contextWindow;
  return catalog;
}

/** 一次请求循环需要的、已填好默认值的配置。 */
interface ResolvedConfig {
  apiBase: string;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  defaultMaxTokens: number;
  maxRequestItems: number;
  contextWindow?: number;
  contextWindowOverrides?: Readonly<Record<string, number>>;
}

/**
 * 宿主 `ImageAttachmentRef` 的结构子集。
 *
 * **五个字段缺一不可**（2026-10-20 真机报障）：宿主的 `readImageRequest` 会用
 * `mediaType` / `bytes` / `width` / `height` 校验引用与存储内容是否一致；只给
 * `attachmentId` 会被拒绝，表现就是界面上那句「图片未能发送」。
 *
 * 声明成结构类型而不是 import 宿主的类型：适配器不该依赖 `@deepseek-ai/dsh-attachment`
 * 的包形状（那是宿主内部约定），只要字段对得上就能用。
 */
export interface ImageRefLike {
  attachmentId: string;
  mediaType?: string;
  bytes?: number;
  width?: number;
  height?: number;
  name?: string;
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
  /**
   * **图片字节解析**（可选；接上宿主 `attachments` 服务后才有）。
   *
   * 宿主的 `ImageBlock` 只带 durable ref（`attachmentId`），**不含字节**；要发图必须经
   * `AttachmentStore.readImageRequest(ref, target, signal)` 把它编码成请求版本。
   * 装配层（`index.ts`）用 `ctx.get("attachments")` 拿到该服务后注入这里 ——
   * 协议层保持纯函数，不依赖宿主服务。
   *
   * 缺席（宿主没有 attachments 服务 / 老宿主）= 不发图：图片降级成文字占位，
   * 与宿主自己对纯文本模型的处理一致（**绝不静默丢弃**）。
   * @param ref - 宿主给的持久化图片引用。
   * @param signal - 请求取消信号。
   * @returns 编码后的字节与 MIME；拿不到时 `undefined`。
   */
  resolveImage?: (
    ref: ImageRefLike,
    signal?: AbortSignal,
  ) => Promise<{ attachmentId: string; data: Uint8Array; mediaType: string } | undefined>;
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
function resolveConfig(raw: OpenDesignConfig): ResolvedConfig {
  const positive = (value: number | undefined, fallback: number): number =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    apiBase: raw.apiBase !== undefined && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_BASE_URL,
    requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
    defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
    /**
     * 条数上限允许**显式关闭**（`0` 或负数 = 不裁剪）。
     *
     * 与上面几个不同：那些是「越小越糟」的超时/额度，`0` 明显是坏配置；
     * 而这里 `0` 是一个有意义的取值（用户自己承担 400 的风险）。
     */
    maxRequestItems:
      raw.maxRequestItems === undefined || !Number.isFinite(raw.maxRequestItems)
        ? DEFAULT_MAX_REQUEST_ITEMS
        : raw.maxRequestItems <= 0
          ? 0
          : Math.floor(raw.maxRequestItems),
    // 覆盖值只在合法时进入解析结果；坏值当作没设，回落到目录公布值。
    ...(isValidContextWindow(raw.contextWindow) ? { contextWindow: raw.contextWindow } : {}),
    ...(() => {
      const overrides = readContextWindowOverrides(raw.contextWindowOverrides);
      return overrides === undefined ? {} : { contextWindowOverrides: overrides };
    })(),
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

/**
 * 目录缓存的复合键：基地址 + 密钥。
 *
 * 用 `\0` 当分隔符而不是 `:` / `|` —— 基地址是 URL、密钥是任意字符串，
 * 两个常见分隔符都可能出现在其中，那会让「不同的 (base, key) 拼出同一个键」，
 * 于是把**别人的缓存**当成自己的。`\0` 在两个源里都不可能出现。
 * @param apiBase - 网关基地址。
 * @param key - 目录请求用的密钥（可能缺省）。
 * @returns 复合键。
 */
function catalogKeyOf(apiBase: string, key: string | undefined): string {
  return `${apiBase}\u0000${key ?? ""}`;
}

/**
 * 拆回复合键。
 * @param composite - `catalogKeyOf` 的产物。
 * @returns 基地址与密钥。
 */
function parseCatalogKey(composite: string): { apiBase: string; key: string | undefined } {
  const at = composite.indexOf("\u0000");
  if (at < 0) return { apiBase: composite, key: undefined };
  const key = composite.slice(at + 1);
  return { apiBase: composite.slice(0, at), key: key === "" ? undefined : key };
}

/** Open Design 适配器：宿主 `LlmAdapter` 的一个真实子类。 */
class OpenDesignAdapter extends LlmAdapter implements CatalogModelsPort {
  readonly #deps: OpenDesignAdapterDeps;

  /**
   * 目录读取（TTL + **按「基地址 + 密钥」分键** + 独立取消 + 内部超时）。
   *
   * 抽到 `core/catalog-flight`（2026-11-05 外部审查 F15/F17）：原来这里是裸
   * `#catalogInFlight`，键只在**缓存**里比较、在途请求却不分键 —— 换账号密钥后
   * 新配置会复用旧密钥的在途请求；`fresh` 也複用它；等待者共用第一个 signal。
   */
  readonly #catalogFlight: CatalogFlight<CatalogEntry[]>;

  /**
   * @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
   */
  constructor(deps: OpenDesignAdapterDeps) {
    super();
    this.#deps = deps;
    this.#catalogFlight = createCatalogFlight<CatalogEntry[]>({
      ttlMs: CATALOG_TTL_MS,
      timeoutMs: MODELS_TIMEOUT_MS,
      // 键是 `apiBase\0key`（见 `#catalogKeyOf`）：两家都靠键隔离，不靠额外状态。
      load: async (composite, signal) => {
        const { apiBase, key } = parseCatalogKey(composite);
        return await this.#fetchCatalog(apiBase, key, signal);
      },
    });
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
   * 与 `listModels` 的分工：那个回答「宿主的模型选择器该看到什么」，这个回答「厂商现在有哪些
   * 模型」—— 隐藏的模型也要出现在勾选列表里，否则用户没有入口把它重新打开。
   * @returns 目录里的模型 id 与名称。
   */
  async catalogModels(fresh = false): Promise<CatalogModel[]> {
    const entries = await this.#catalog(resolveConfig(this.#deps.config()), undefined, fresh);
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
    // 不兜底就永远没有思考强度可选，实际情况原话）。
    const efforts = effortsFor(model, entry?.efforts);
    // 上下文窗口：覆盖优先（按模型 → 全局 → 目录）。宿主的压缩阈值完全由它决定。
    const contextWindow = effectiveContextWindow(entry?.contextWindow, model, config);
    /**
     * 输出上限必须给压缩留出余量（**不能只夹到窗口本身**）。
     *
     * 宿主的压缩预算是 `W − O − B`（`B = 65536`，`O` 取请求的 `maxTokens`）。
     * 若只做 `min(O, W)`，`O = W` 时预算正好是 `−B` —— 仍然是负数，压缩仍然抛
     * `TargetPressureConfigError`。所以要按 `W − B − 最低消息预算` 来夹。
     */
    const maxTokens = clampOutputToWindow(entry?.maxTokens, contextWindow);
    return {
      provider,
      id: model,
      name: entry?.name ?? officialModelName(model),
      inputModalities: entry?.inputModalities ?? ["text"],
      ...(contextWindow === undefined ? {} : { context: { contextWindow } }),
      ...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
      // **能力声明**（2026-10-20 对齐官方实现）：官方 `dsh-llm-deepseek` 在目录里硬编码
      // 等同的两项。它们影响的是「中途改系统提示 / 增删工具」时的缓存策略，不是用户选项：
      // - `in-history`：任意位置的 `system` 消息都读作最新系统提示，改提示只需追加；
      // - `addition-only`：认 `deferLoading` + `tool-addition`，新工具不必重发完整列表。
      // Open Design 是 OpenAI 兼容的 Chat Completions，两者都成立。
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
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // **停止序列已支持**（2026-10-20 对齐官方）：Open Design 是 OpenAI 兼容的
    // Chat Completions，`stop` 是标准字段（见 `protocol.ts` 的 `buildRequestBody`）。
    // 旧实现在这里抛 `UNSUPPORTED_OPTION` 是因为当时没实现；现在实现了，
    // 那个拒绝必须去掉，否则宿主传下来的 stop 依然被自己挡掉。
    // 账号切换策略：在选号之前决定要不要换当前账号（辅助调用直接跳过）。
    await this.#deps.beforeRequest?.({
      ...(options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) }),
      ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
    });
    const config = resolveConfig(this.#deps.config());
    const tried = new Set<string>();
    let lastFailure: AttemptFailure | undefined;
    /**
     * 本请求内**按尝试顺序**记录的全部失败（2026-11-06 修：「额度已用尽」误报）。
     *
     * 用尽时不能直接抛最后一条：链条里有可自愈的瞬时失败、最后一条却是不可重试的
     * 终态时，会把一个本来能救回来的回合判死。选择逻辑见 {@link pickExhaustedFailure}。
     */
    const failures: AttemptFailure[] = [];
    /** 试完了：抛「最值得让宿主重试」的那一条，而不是碰巧最后失败的那一条。 */
    const throwExhausted = (): never => {
      const picked = pickExhaustedFailure(failures) ?? lastFailure;
      if (picked === undefined) {
        throw new LlmError(`llm-opendesign: 模型 "${options.model}" 的所有 Open Design 账号都不可用`, "MISSING_CREDENTIAL");
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

    for (;;) {
      const aborted = options.signal?.aborted === true;
      if (aborted) throw this.#abortError(options.signal);

      const ref = this.#deps.rotation.pick({ model: options.model, tried });
      if (ref === undefined) {
        // 换模型的机会：所有账号都被**拒绝**了（继续换账号已无意义，换同名模型往往还能服务）。
        //
        // **不递归调 `this.stream()`**：那会重跑 `beforeRequest`（可能再次触发账号切换）并把
        // `tried` 清空，实测表现为「换模型后又用空密钥重试一次」。改成继续循环：换掉当前模型、
        // 清空已试账号，让下一轮去选新模型的账号。
        //
        // 只在「确实有账号被拒绝」时才尝试 —— `lastFailure === undefined` 意味着一条凭据都
        // 没解析到，那种情况换模型毫无意义，而且查候选要读各家目录（会发额外请求）。
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
              continue;
            }
          }
        }
        if (lastFailure !== undefined) throwExhausted();
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
        failures.push(lastFailure);
        if (tried.size >= this.#maxTried()) throwExhausted();
        continue;
      }

      let emitted = false;
      let totalTokens = 0;
      /** 用量采集：把本次尝试的 usage 逐块累加（厂商可能发多次）。 */
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
        // 请求由这个账号**服务完了**：记一次成功（卡片跟随真实账号）。
        this.#deps.rotation.noteSettled(ref);
        this.#recordUsage(ref, options.model, "success", counts);
        return;
      }

      if (options.signal?.aborted === true || this.#isAbort(failure)) {
        // 用户主动取消：不算厂商失败，但 token 已经花掉了 —— 仍然记一条。
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
      failures.push(classified);
      this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
      // 唯一的换账号条件：已输出 / 已消耗 token / 已中止都不换。
      if (!this.#deps.rotation.fallbackAllowed({ emitted, totalTokens, aborted: false })) throw classified.thrown;
      if (tried.size >= this.#maxTried()) throwExhausted();
    }
  }

  /** 一次尝试：核对档位 → 构造请求体 → 发出 → 解码并套上时间预算。 */
  async *#attempt(config: ResolvedConfig, options: GenerateOptions, key: string): AsyncGenerator<StreamChunk> {
    const effort = await this.#declaredEffort(config, options);
    /**
     * **一个 deadline，所有阶段共用剩余时间**（2026-11-01 修 R02 第二版）。
     *
     * 原来只有下面的 `runStream` 受 `requestTimeoutMs` 管 —— 而它在流**已经开始
     * 产出之后**才生效。网关接受连接但永不返回响应头时（半开连接、上游挂起），
     * 用户配的超时完全不起作用。
     *
     * 上一版给每段各套一次预算，导致每段都从当下重算 —— 「头 60ms + 正文 60ms」
     * 在 90ms 预算下整体跑 120ms。现在共用 `RequestDeadline` 的剩余时间。
     */
    const deadline = new RequestDeadline(config.requestTimeoutMs);
    const signalOpts = { ...(options.signal === undefined ? {} : { signal: options.signal }) };
    const deadlineOf = <T,>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> =>
      deadline.run(operation, config.streamIdleTimeoutMs, signalOpts);
    let response = await deadlineOf((signal) => this.#post(config, options, key, effort, signal));
    if (!response.ok) {
      const body = await deadlineOf(() => readErrorBody(response));
      // 兜底：网关不认这个档位（400 + 点名 reasoning_effort）时，按它念出的白名单**升一档**重发。
      //
      // **故意向上而不是向下**（2026-11-06 用户要求）：降档会把用户的意图悄悄削弱 ——
      // 用户点 `xhigh`、网关只认到 `high`，那次请求的思考量就比他要求的少。升档的代价只是
      // 多花 token，而降档的代价是答案质量下降。没有更强的档位时返回 `undefined`，
      // 这里会去掉字段、交回厂商默认，**不退回一个更弱的显式档位**。
      if (response.status === 400 && effort !== undefined && mentionsEffortField(body)) {
        const fallback = upgradeAllowedEffort(effort, allowedEffortsIn(body));
        const retry = await deadlineOf((signal) =>
          this.#post(config, options, key, fallback === effort ? undefined : fallback, signal),
        );
        if (!retry.ok) {
          const retryBody = await deadlineOf(() => readErrorBody(retry));
          throw new OpenDesignStreamFailure(retry.status, retryBody);
        }
        yield* runStream(
          decodeStream(retry.body),
          // 流式阶段用**剩余**预算，不重置整请求 deadline。
          deadline.streamBudget(config.streamIdleTimeoutMs),
          {
            signal: options.signal,
            abortNetwork: deadline.networkAbort(),
          },
        );
        return;
      }
      throw new OpenDesignStreamFailure(response.status, body);
    }
    yield* runStream(
      decodeStream(response.body),
      deadline.streamBudget(config.streamIdleTimeoutMs),
      {
        signal: options.signal,
        /**
         * **普通 200 分支也要接 `abortNetwork`**（2026-11-01 修第四处）。
         *
         * 上一版只在「档位回退」那个分支接了，主力路径（正常 200）漏掉 ——
         * 报告实测：OD 成功正文停住至 idle/total 超时后，外层正确返回错误，
         * 但 signal 未 abort、reader 未取消、body 仍开着。
         */
        abortNetwork: deadline.networkAbort(),
      },
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
  /**
   * 发一次生成请求。
   * @param config - 已解析的配置。
   * @param options - 宿主的请求。
   * @param key - 密钥。
   * @param effort - 档位。
   * @param signal - **实际传给 `fetch` 的信号**（2026-11-01 修 R03）。
   *
   *   这里必须**收参数**而不是直接用 `options.signal`：`withRequestDeadline`
   *   会传入「调用方取消 **或** 超时」合并后的信号。用 `options.signal` 的话超时
   *   永远无法 abort 底层请求 —— 界面报超时、socket 继续挂着。
   */
  async #post(
    config: ResolvedConfig,
    options: GenerateOptions,
    key: string,
    effort: string | undefined,
    signal?: AbortSignal,
  ): Promise<Response> {
    const cap = config.defaultMaxTokens;
    const facts: BodyFacts = {
      maxTokens: options.maxTokens === undefined ? cap : Math.min(options.maxTokens, cap),
      systemText: systemTextOf(options),
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
      // 出站条数硬上限（`0` = 关闭）。见 `core/wire-limit.ts` 的完整来由。
      ...(config.maxRequestItems > 0 ? { maxRequestItems: config.maxRequestItems } : {}),
    };
    const wire = generateRequest({
      base: config.apiBase,
      key,
      body: JSON.stringify(buildRequestBody(options, facts, await this.#imagesOf(options))),
    });
    const init: RequestInit = { method: "POST", headers: wire.headers, body: wire.body };
    const effective = signal ?? options.signal;
    if (effective !== undefined) init.signal = effective;
    return this.#deps.fetchImpl(wire.url, init);
  }

  /**
   * 收集本请求里出现过的图片字节（按 attachment id 索引，同一张图只读一次）。
   *
   * 宿主的 `ImageBlock` 只有 durable ref，字节要经注入的 `resolveImage` 去附件服务取。
   * **一遍失败不影响其它图片**，也不让整次请求失败：取不到的那张会降级成文字占位
   * （见 `openAiUserContent`）—— 用户至少知道「这里本该有一张图」。
   * @param options - 宿主的完整请求。
   * @returns attachment id → 字节；没有图片或没有解析器时为空 Map。
   */
  async #imagesOf(options: GenerateOptions): Promise<ReadonlyMap<string, RequestImageBytes>> {
    if (this.#deps.resolveImage === undefined) return new Map();
    /**
     * **必须传完整的 `ImageAttachmentRef`**（2026-10-20 真机报障）：宿主的
     * `readImageRequest` 会用 `mediaType` / `bytes` / `width` / `height` 做引用校验，
     * 只给 `attachmentId` 会被拒绝，表现就是「图片未能发送」的占位。
     *
     * 总预算统一在 core 里执行（2026-11-05 外部审查 F06）：
     * 单张上限挡不住「很多张大图」，判断散落三家会漏（U13 的教训）。
     */
    const { images } = await collectImageBytes(options.messages, this.#deps.resolveImage, options.signal);
    return images;
  }

  /**
   * 核对宿主给的推理档位：**声明过的（目录或模型族）**才原样返回，否则 `undefined`
   * （不发这个字段）。没有档位需求时不请求目录；目录拉不到时仍按模型族判定。
   * @param config - 已填默认值的配置。
   * @param options - 宿主的完整请求。
   * @returns 可以发出去的档位，或 `undefined`。
   */
  /**
   * 用户选的档位：**原样发送**，不做白名单过滤（2026-11-03 用户要求）。
   *
   * 旧实现会把「目录没声明过的档位」静默换成 `undefined`（= 不带这个字段），
   * 于是用户选了 `high` 却发出一个没有档位的请求 —— 实际用的是厂商默认档，
   * 而界面上仍显示 `high`。这是**静默改档**，用户无从发现。
   *
   * 现在一律原样发：真的不被网关接受时，{@link #stream} 里那条
   * 「400 + 点名 reasoning_effort → 按网关念出的白名单降一档重发」的兜底会接手 ——
   * 那是**网关明确拒绝之后**的显式自适应，与静默改写是两回事。
   * @param _config - 已解析配置（保留参数位，避免调用点改动）。
   * @param options - 生成选项。
   * @returns 要写进请求体的档位；用户没选就是 `undefined`。
   */
  async #declaredEffort(_config: ResolvedConfig, options: GenerateOptions): Promise<string | undefined> {
    return options.reasoningEffort;
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
        vendor: "opendesign",
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
   * 缓存与在途请求都按**「基地址 + 密钥」**分键：换账号或换基地址 → 新键 →
   * 不复用旧请求（2026-11-05 外部审查 F15）。取消与超时的语义见
   * `core/catalog-flight.ts`。
   * @param config - 已填默认值的配置。
   * @param signal - 宿主的取消信号（只影响**本调用方**的等待）。
   * @param fresh - 绕过缓存与在途请求重读（刷新按钮）。
   * @returns 目录条目。
   */
  async #catalog(config: ResolvedConfig, signal?: AbortSignal, fresh = false): Promise<CatalogEntry[]> {
    const key = await this.#catalogKey();
    return await this.#catalogFlight.read(catalogKeyOf(config.apiBase, key), {
      ...(signal === undefined ? {} : { signal }),
      fresh,
    });
  }

  /**
   * 真正打一次目录端点。
   *
   * `signal` 由 `catalog-flight` 传入，**已经合并**了调用方取消与 10 秒内部超时
   * （F17：原来写的是 `signal ?? timeout`，调用方一给 signal，上限就没了）。
   * @param apiBase - 目录端点基地址。
   * @param key - 目录请求用的推理密钥。
   * @param signal - 已合并的取消信号。
   * @returns 目录条目。
   */
  async #fetchCatalog(apiBase: string, key: string | undefined, signal: AbortSignal): Promise<CatalogEntry[]> {
    // 目录与推理同一条 Bearer（2026-10-18 实测：不带密钥回 401 missing_api_key）。
    const { url, headers } = catalogRequest(apiBase, key);
    const response = await this.#deps.fetchImpl(url, { headers, signal });
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
   */
  #classify(error: unknown): AttemptFailure | undefined {
    // Context pressure belongs to the host compaction engine, including in-band errors.
    if (error instanceof LlmError && error.code === "CONTEXT_WINDOW_EXCEEDED") return undefined;
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
