/**
 * opencode 的线协议与传输：端点、发现请求、pi-ai SDK 的请求构造与事件 → chunk 转换。
 *
 * 一切形状逐条对照旧插件 `dsh-opencode-go/lib/index.js`（行号写在各定义上方）。
 * **传输是 pi-ai SDK**（`dsh-opencode-go` 的同一做法：npm 别名依赖 + 构建期内联，
 * 别名 `opencode-go-pi-ai`）：本模块不自己发 HTTP、不自己解 SSE，只做四件事：
 *
 * 1. 把宿主目录条目装成 pi-ai 的 `Model`（`buildPiModel`）；
 * 2. 把宿主的 `GenerateOptions` 投影成 pi-ai 的 `Context`（`toPiContext`）；
 * 3. 用 `createProvider(...).streamSimple(...)` 发出请求，并把宿主注入的 `fetch`
 *    （`OpencodeAdapterDeps.fetchImpl`）与 attribution 头一起交给 SDK；
 * 4. 把 pi-ai 的 `AssistantMessageEvent` 流翻回宿主的 `StreamChunk` 流（`toHostChunks`）。
 *
 * 失败分类所需的（HTTP 状态，正文）由 {@link recordGatewayFetch} 在 `fetch` 边界截获 ——
 * 旧插件用 `GatewayDiagnostics`（第 7094-7260 行）做同一件事：pi-ai 的错误事件只带
 * `errorMessage`，凭它无法还原 `classifyGatewayError` 需要的状态与正文。
 *
 * **本期范围**：文本、工具声明与工具调用/结果。图片与文件投影、缓存断点、
 * `thinkingBudgets`、协议覆盖、代理与诊断导出属第 2/3 期（设计 §15）。
 * @module dsh-llm-account/src/vendors/opencode/protocol
 */
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmError,
  ToolCallId,
  attributionHeaders,
} from "@deepseek-ai/dsh-llm";
import type { ContentBlock, GenerateOptions, StreamChunk, TokenUsage, ToolSchema } from "@deepseek-ai/dsh-llm";
import type {
  AssistantMessageEvent,
  Context as PiContext,
  JsonObject,
  Message as PiMessage,
  Model as PiModel,
  ProviderStreams,
  Tool as PiTool,
} from "opencode-go-pi-ai";
import { createProvider, isContextOverflow, normalizeContext } from "opencode-go-pi-ai";
import * as anthropicMessages from "opencode-go-pi-ai/api/anthropic-messages";
import * as openaiCompletions from "opencode-go-pi-ai/api/openai-completions";
import * as openaiResponses from "opencode-go-pi-ai/api/openai-responses";

/** 网关默认基地址（旧插件 `src/catalog.ts` 第 6408 行）。 */
export const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

/** 目录端点路径（旧插件第 6463 行 `${baseURL}/models`）。 */
export const MODELS_PATH = "/models";

/** 模型元数据来源（旧插件 `MODEL_METADATA_URL` 第 6104 行）。 */
export const MODEL_METADATA_URL = "https://models.dev/api.json";

/** pi-ai 里这条网关的 provider 标识（旧插件 `SDK_PROVIDER_ID`，数据文件里的 `provider`）。 */
export const SDK_PROVIDER_ID = "opencode-go";

/** 目录请求预算（旧插件 `MODELS_FETCH_TIMEOUT_MS` 第 6409 行）。 */
export const MODELS_FETCH_TIMEOUT_MS = 10_000;

/** 元数据请求预算（旧插件 `METADATA_FETCH_TIMEOUT_MS` 第 6410 行）。 */
export const METADATA_FETCH_TIMEOUT_MS = 30_000;

/** 一次目录请求最多读多少字节（旧插件 `MODEL_LISTING_MAX_BYTES` 第 6412 行）。 */
export const MODELS_MAX_BYTES = 1024 * 1024;

/** 元数据响应最多读多少字节。 */
export const METADATA_MAX_BYTES = 8 * 1024 * 1024;

/** 错误正文最多读多少字符（旧插件 `MAX_BODY_BYTES` 第 7073 行同样封顶 16 KiB）。 */
export const ERROR_BODY_LIMIT = 16 * 1024;

/** 默认目录 TTL（旧插件 `refreshMs` 的默认值在配置层，这里取同一量级的内存 TTL）。 */
export const DEFAULT_CATALOG_TTL_MS = 5 * 60_000;

/** 默认整请求 deadline（旧插件配置默认值 `requestTimeoutMs`）。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/** 默认流空闲看门狗（旧插件配置默认值 `streamIdleTimeoutMs`）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

/** 未指定 `maxTokens` 时的输出上限；再受模型自报上限收紧（旧插件第 7626 行）。 */
export const DEFAULT_GENERATE_MAX_TOKENS = 131_072;

/**
 * 读一段诊断正文的期限（旧插件 `BODY_READ_TIMEOUT_MS` 第 7074 行，同为 1000 ms）。
 *
 * 这个上限是**必需**的：`await gateway.evidence()` 发生在 `runStream` 清掉自己的定时器之后，
 * 一条不肯结束的错误正文会把整次请求无限期挂住（只有调用方中止能解开）。
 */
export const BODY_READ_TIMEOUT_MS = 1_000;

/** 目录不可用时装模型用的上下文窗口兜底（只影响 pi-ai 的溢出判定，不影响目录展示）。 */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** pi-ai 的 `maxRetries`：一次适配器调用就是一次 SDK 尝试（旧插件第 7694 行）。 */
export const SDK_MAX_RETRIES = 0;

/**
 * pi-ai 扇出的三条线协议（设计 §7.2「pi-ai SDK 扇出」）。
 * `apiForNpm` 按 models.dev 的 `provider.npm` 决定每条模型走哪条（旧插件第 6188 行）。
 */
export type OpencodeApi = "anthropic-messages" | "openai-completions" | "openai-responses";

/**
 * 元数据缺失时的默认线协议。opencode 网关自带目录里**每条**模型的 `api` 都是
 * `anthropic-messages`（旧插件第 1849 行的 `opencode_go_default`），所以这是安全缺省。
 */
export const DEFAULT_API: OpencodeApi = "anthropic-messages";

/** 旧插件第 6188 行的 npm 包名 → 线协议映射。 */
export function apiForNpm(npm: unknown): OpencodeApi | undefined {
  if (npm === "@ai-sdk/anthropic") return "anthropic-messages";
  if (npm === "@ai-sdk/openai") return "openai-responses";
  if (npm === "@ai-sdk/openai-compatible") return "openai-completions";
  return undefined;
}

/**
 * 基地址是否落在 `opencode.ai` 域（含子域）。发现请求只认这个域：旧插件对别的地址
 * 直接拒（`DISCOVERY_UNSUPPORTED`，第 8662-8665 行）。
 * @param baseUrl - 待检查的基地址。
 * @returns 是否属于 `opencode.ai`。
 */
export function isOpencodeHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "opencode.ai" || host.endsWith(".opencode.ai");
  } catch {
    return false;
  }
}

/**
 * 断言基地址属于 `opencode.ai` 域，否则抛出「不支持该域发现」的错误。
 * @param baseUrl - 配置里的基地址。
 * @throws {LlmError} `DISCOVERY_UNSUPPORTED`：非 opencode.ai 的地址不是目录来源。
 */
export function assertOpencodeBase(baseUrl: string): void {
  if (!isOpencodeHost(baseUrl)) {
    throw new LlmError(
      `llm-opencode-go: model discovery is only supported for the opencode.ai domain, not ${baseUrl}`,
      "DISCOVERY_UNSUPPORTED",
    );
  }
}

/** 去掉基地址末尾的斜杠（旧插件第 6463 行同样归一化）。 */
export function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * 目录请求（旧插件 `fetchLiveModelIds` 第 6462-6472 行）：不带 Authorization，
 * 只带 `accept`、身份编码与 attribution 头。
 * @param baseUrl - 网关基地址。
 * @returns URL 与请求头。
 */
export function catalogRequest(baseUrl: string): { url: string; headers: Record<string, string> } {
  return {
    url: `${trimBase(baseUrl)}${MODELS_PATH}`,
    headers: { accept: "application/json", "accept-encoding": "identity", ...attributionHeaders() },
  };
}

/**
 * 元数据请求（旧插件 `refreshMetadata` 第 6603-6611 行）。
 * @returns URL 与请求头。
 */
export function metadataRequest(): { url: string; headers: Record<string, string> } {
  return { url: MODEL_METADATA_URL, headers: { accept: "application/json", ...attributionHeaders() } };
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 一次请求里在 `fetch` 边界观察到的网关证据（旧插件 `GatewayDiagnostics` 的同一职责）。
 * 适配器据此调用 `classifyGatewayFailure(status, body)`。
 */
export interface GatewayEvidence {
  /** HTTP 状态。 */
  status: number;
  /** 已解析的错误正文，或原始文本。 */
  body: unknown;
}

/** 截获网关证据的 `fetch` 包装。 */
export interface GatewayRecorder {
  /** 交给 pi-ai 的 `fetch`。 */
  readonly fetch: typeof fetch;
  /** 清空上一次尝试的证据（每次尝试前调用）。 */
  reset(): void;
  /** 上一次尝试观察到的证据；没有失败响应时为 `undefined`。 */
  evidence(): Promise<GatewayEvidence | undefined>;
}

/**
 * 从响应体里读一段有界的正文预览（旧插件 `previewBody` 第 7094-7135 行的同一目的与同一上限）。
 *
 * 三条纪律：
 * - 只读前 {@link ERROR_BODY_LIMIT} 字节 —— 绝不因为读诊断正文而把整个响应体拉进内存；
 * - **有期限**：`AbortSignal.any([调用方信号, AbortSignal.timeout(BODY_READ_TIMEOUT_MS)])`
 *   与旧插件第 7100 行逐字一致；读超时就交出**已经读到的部分**（通常没有），绝不让调用方
 *   等一个不落的正文；
 * - 只读克隆体：原响应仍归 pi-ai 的 SDK 消费。
 * @param response - 已经拿到的响应。
 * @param callerSignal - 调用方取消信号（旧插件的 `callerSignal` 参数）。
 * @returns 解析后的正文，或原始文本；读不到时为 `undefined`。
 */
async function previewBody(response: Response, callerSignal: AbortSignal | undefined): Promise<unknown> {
  const signal =
    callerSignal === undefined
      ? AbortSignal.timeout(BODY_READ_TIMEOUT_MS)
      : AbortSignal.any([callerSignal, AbortSignal.timeout(BODY_READ_TIMEOUT_MS)]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let text = "";
  let truncated = false;
  try {
    signal.throwIfAborted();
    reader = response.clone().body?.getReader();
    if (reader !== undefined) {
      const decoder = new TextDecoder();
      // 读与「信号中止」赛跑：`reader.read()` 卡住时靠它脱身（旧插件第 7111 行同法）。
      const aborted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      for (;;) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done === true) break;
        text += decoder.decode(part.value, { stream: true });
        if (text.length >= ERROR_BODY_LIMIT) {
          truncated = true;
          break;
        }
      }
      if (!truncated) text += decoder.decode();
    }
  } catch {
    // 读超时、调用方中止、流错误：都退化成「有多少算多少」，状态照旧可用。
  } finally {
    if (reader !== undefined) void reader.cancel().catch(() => {});
  }
  const bounded = text.slice(0, ERROR_BODY_LIMIT);
  if (bounded.trim() === "") return undefined;
  try {
    return JSON.parse(bounded);
  } catch {
    return bounded;
  }
}

/**
 * 包一层 `fetch`：每次非 2xx 响应记下（状态，正文），供失败分类使用。
 * @param fetchImpl - 宿主注入的 `fetch`（测试给假实现）。
 * @param callerSignal - 调用方取消信号；中止时放弃读诊断正文（不拖住取消）。
 * @returns 记录器；`fetch` 字段交给 pi-ai。
 */
export function recordGatewayFetch(fetchImpl: typeof fetch, callerSignal?: AbortSignal): GatewayRecorder {
  let evidence: Promise<GatewayEvidence | undefined> = Promise.resolve(undefined);
  const wrapped = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const response = await fetchImpl(input, init);
    if (!response.ok) {
      // 先记状态：正文读不动时至少还能按状态分类（`previewBody` 自带期限）。
      evidence = previewBody(response, callerSignal).then((body) => ({ status: response.status, body }));
    }
    return response;
  }) as typeof fetch;
  return {
    fetch: wrapped,
    reset(): void {
      evidence = Promise.resolve(undefined);
    },
    evidence(): Promise<GatewayEvidence | undefined> {
      return evidence;
    },
  };
}

/**
 * 一次尝试失败时抛出的原始证据载体。
 *
 * 刻意不是 `LlmError`：它承载 pi-ai 的错误文案，HTTP 状态与正文由
 * {@link GatewayRecorder} 提供；适配器把两者合起来才能分类（与 commandcode 的
 * `CommandCodeStreamFailure` 同一角色）。
 */
export class OpencodeStreamFailure extends Error {
  /** pi-ai 观察到的 HTTP 状态；事件里没带时为 `0`。 */
  readonly status: number;
  /** pi-ai 给出的错误正文（通常只有文案）。 */
  readonly body: unknown;

  /**
   * @param status - HTTP 状态；未知为 `0`。
   * @param body - 原始错误正文。
   * @param message - pi-ai 的错误文案。
   */
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "OpencodeStreamFailure";
    this.status = status;
    this.body = body;
  }
}

/** 装一条模型所需的目录事实（目录与元数据合并后的结果）。 */
export interface OpencodeModelFacts {
  /** 模型 id。 */
  id: string;
  /** 用户可见名称。 */
  name: string;
  /** 线协议。 */
  api: OpencodeApi;
  /** 上下文窗口；未公布时缺省。 */
  contextWindow?: number;
  /** 最大输出 token；未公布时缺省。 */
  maxTokens?: number;
  /** 是否声明了推理能力。 */
  reasoning: boolean;
  /** 接受的输入模态。 */
  inputModalities: readonly ("text" | "image")[];
}

/**
 * 把目录事实装成 pi-ai 的 `Model`（旧插件第 6227-6246 行的 `readModelMetadata` 产出的
 * 同一形状；`cost` 全 0 —— 费用估算属第 2 期，这里只需要形状成立）。
 * @param facts - 目录事实与基地址。
 * @param baseUrl - 网关基地址。
 * @returns pi-ai 模型描述。
 */
export function buildPiModel(facts: OpencodeModelFacts, baseUrl: string): PiModel<OpencodeApi> {
  const base = trimBase(baseUrl);
  return {
    id: facts.id,
    name: facts.name,
    api: facts.api,
    provider: SDK_PROVIDER_ID,
    // anthropic-messages 用的是 `base/v1/messages`，所以基地址要去掉结尾的 `/v1`
    // （旧插件 `modelBaseURL` 第 6161-6164 行）。
    baseUrl: facts.api === "anthropic-messages" ? base.replace(/\/v1$/, "") : base,
    reasoning: facts.reasoning,
    input: [...facts.inputModalities],
    // pi-ai 的 `Model` 要求两个容量字段是数字：目录没公布时用网关量级的兜底值，
    // 只影响 SDK 的溢出判定与钳制，不改目录展示（展示里缺字段就是不写）。
    contextWindow: facts.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: facts.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

/** 把系统提示折叠成一段文本（旧插件 `splitSystemPrompt` 的同一规则）。 */
function systemTextOf(options: GenerateOptions): string {
  const parts: string[] = [];
  if (options.system !== undefined && options.system !== "") parts.push(options.system);
  for (const message of options.messages) {
    if (message.role !== "system" && message.role !== "developer") continue;
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text !== "") parts.push(text);
  }
  return parts.join("\n\n");
}

/** 把一段内容压成纯文本（文件/图片块属于第 3 期，这里只取文本块）。 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === "text") parts.push(block.text);
  return parts.join("");
}

/** 工具的 arguments 是原始 JSON 字符串，pi-ai 要对象（旧插件 `parseArguments` 第 1042-1051 行）。 */
function parseArguments(raw: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

/** 工具声明（旧插件第 1518 行把 `ToolSchema.parameters` 直接当 TSchema 传下去）。 */
function toPiTool(tool: ToolSchema): PiTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as PiTool["parameters"],
  };
}

/**
 * 宿主的 `GenerateOptions` → pi-ai 的 `Context`。
 *
 * 消息投影顺序与旧插件 `toPiContext`（第 1600-1684 行）一致：系统提示折成
 * `systemPrompt`；用户消息里的 `tool-result` 块拆成 pi-ai 的 `toolResult` 消息
 * （块顺序保持）；assistant 消息的文本/推理/工具调用一一对应。**本期不带图片、
 * 不带 replay 状态**（第 2/3 期）。
 * @param options - 宿主的完整请求。
 * @returns pi-ai 的请求上下文（尚未 `normalizeContext`）。
 */
export function toPiContext(options: GenerateOptions): PiContext {
  const messages: PiMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of options.messages) {
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "tool") {
      messages.push({
        role: "toolResult",
        toolCallId: message.toolCallId,
        toolName: toolNames.get(message.toolCallId) ?? "unknown",
        content: [{ type: "text", text: textOf(message.content) || "(no output)" }],
        isError: message.isError === true,
        timestamp: 0,
      });
      continue;
    }
    if (message.role === "assistant") {
      const blocks: Extract<PiMessage, { role: "assistant" }>["content"] = [];
      for (const block of message.content) {
        if (block.type === "text") blocks.push({ type: "text", text: block.text });
        else if (block.type === "reasoning") blocks.push({ type: "thinking", thinking: block.text });
        else if (block.type === "tool-call") {
          toolNames.set(block.id, block.name);
          blocks.push({
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: parseArguments(block.arguments),
          });
        }
      }
      messages.push({
        role: "assistant",
        content: blocks,
        // 历史 assistant 回合不带 replay 状态：标记成一个不可能等于任何目录 API 的
        // 来源（旧插件 `foreignAssistant` 第 1167-1172 行的同一条）。
        api: "dsh-foreign",
        provider: "dsh-foreign",
        model: "dsh-foreign",
        usage: emptyUsage(),
        stopReason: blocks.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
        timestamp: 0,
      });
      continue;
    }
    // 用户消息只取文本块（图片/文件投影属第 3 期）；工具结果**不在这里** ——
    // 宿主把它们放在 `role: "tool"` 的独立消息里（上面那个分支）。
    const text = textOf(message.content);
    if (text !== "") {
      messages.push({ role: "user", content: [{ type: "text", text }], timestamp: 0 });
    }
  }
  const tools = (options.tools ?? []).map((tool) => toPiTool(tool));
  return {
    ...(systemTextOf(options) === "" ? {} : { systemPrompt: systemTextOf(options) }),
    messages,
    ...(tools.length === 0 ? {} : { tools }),
  };
}

/** pi-ai 的空用量（历史回合不带真实计数）。 */
function emptyUsage(): Extract<PiMessage, { role: "assistant" }>["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * pi-ai 的 usage → 宿主的计数（旧插件 `mapUsage` 第 1689-1697 行）；缓存计数为 0 时省略。
 * @param usage - pi-ai 的用量。
 * @returns 宿主计数。
 */
function toHostUsage(usage: Extract<PiMessage, { role: "assistant" }>["usage"]): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}),
    ...(usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}),
  };
}

/** 一次 usage 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage: TokenUsage): number {
  return usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

/**
 * pi-ai 的结束原因 → 宿主的结束原因（旧插件 `mapStopReason` 第 1712-1760 行）。
 *
 * 三种终态错误在这里现形，都交回宿主处理（`EMPTY_RESPONSE` / `CONTEXT_WINDOW_EXCEEDED`
 * 都在路由的重试白名单里，也就意味着**这两个错误不该被账号轮换吞掉**）：
 * 上下文溢出（pi-ai 的 `isContextOverflow`，第 938 行那份实现的导出）、空响应、以及
 * pi-ai 自己报出的 `error`。
 * @param message - pi-ai 交回的完整助手消息。
 * @param contextWindow - 该模型的上下文窗口（判定静默溢出用）。
 * @returns 宿主的结束原因。
 */
function toHostFinishReason(
  message: Extract<PiMessage, { role: "assistant" }>,
  contextWindow: number,
): Extract<StreamChunk, { type: "finish" }>["reason"] {
  if (isContextOverflow(message, contextWindow)) {
    return {
      kind: "error",
      failure: {
        message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    };
  }
  switch (message.stopReason) {
    case "stop":
      return message.content.length === 0
        ? {
            kind: "error",
            failure: {
              message: `opencode model "${message.model}" returned a completed response with no content`,
              code: EMPTY_RESPONSE_CODE,
            },
          }
        : { kind: "stop" };
    case "length":
      // 打到输出上限却一个字都没产出：不能伪装成正常的 `max-tokens` 收尾 —— 空消息会让
      // 这一轮什么都不说地结束（`dsh-llm` 的 `EMPTY_RESPONSE_CODE` 文档点名的失败模式）。
      // 旧插件 `mapStopReason` 的同一分支给出**可执行建议**（调大「最大输出」或先
      // `/compact`），这里沿用：请求级错误，不换账号、不进重试白名单。
      if (message.content.length === 0) {
        return {
          kind: "error",
          failure: {
            message: `opencode model "${message.model}" produced no content at its output cap`
              + `${contextWindow === undefined ? "" : ` in a ${contextWindow}-token window`}`
              + ". The prompt may leave too little room for an answer. Compact the context (/compact) or raise this model's max output, then retry",
            code: "INVALID_REQUEST",
          },
        };
      }
      return { kind: "max-tokens" };
    case "toolUse":
      return { kind: "tool-calls" };
    case "aborted":
      return { kind: "aborted", failure: { message: message.errorMessage ?? "opencode stream aborted", code: "ABORTED" } };
    case "error":
      return {
        kind: "error",
        failure: { message: message.errorMessage ?? "opencode stream error", code: "PI_AI_ERROR" },
      };
    default:
      return {
        kind: "error",
        failure: { message: `pi-ai stream for model "${message.model}" ended ${message.stopReason}`, code: "PI_AI_ERROR" },
      };
  }
}

/**
 * pi-ai 的 `AssistantMessageEvent` 流 → 宿主的 `StreamChunk` 流（旧插件
 * `toStreamChunks` 第 1761-1843 行）。
 *
 * 三处与旧插件刻意的差别，都为了把「失败」交给适配器的轮换循环：
 * 1. `error` 事件先交出（非零的）usage，再抛 {@link OpencodeStreamFailure}：
 *    适配器据此累计 token，从而让 `fallbackAllowed` 判定「已消耗 token」；
 * 2. 用量为 0 的 usage chunk 不交出（失败尝试的零用量没有信息量）；
 * 3. 流在没有 `done`/`error` 的情况下结束时抛 `STREAM_CLOSED`（旧插件同）。
 * 因为失败是抛出来的，宿主拿到的错误**必须**保留 `EMPTY_RESPONSE` /
 * `CONTEXT_WINDOW_EXCEEDED` 这类码，让宿主自己的重试与压缩策略接手。
 * @param events - pi-ai 的事件流。
 * @param contextWindow - 该模型的上下文窗口（判定空响应/溢出）。
 * @param signal - 调用方信号（识别「中止」）。
 * @returns 与线上同序的 chunk 流。
 */
export async function* toHostChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  contextWindow: number,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const toolIds = new Map<number, { id: string; name: string }>();
  for await (const event of events) {
    switch (event.type) {
      case "start":
        break;
      case "text_start":
        yield { type: "block-start", index: event.contentIndex, blockType: "text" };
        break;
      case "text_delta":
        yield { type: "text-delta", index: event.contentIndex, text: event.delta };
        break;
      case "text_end":
        yield { type: "block-end", index: event.contentIndex, block: { type: "text", text: event.content } };
        break;
      case "thinking_start":
        yield { type: "block-start", index: event.contentIndex, blockType: "reasoning" };
        break;
      case "thinking_delta":
        yield { type: "reasoning-delta", index: event.contentIndex, text: event.delta };
        break;
      case "thinking_end":
        yield { type: "block-end", index: event.contentIndex, block: { type: "reasoning", text: event.content } };
        break;
      case "toolcall_start": {
        const partial = event.partial.content[event.contentIndex];
        const id = partial?.type === "toolCall" ? partial.id : "";
        const name = partial?.type === "toolCall" ? partial.name : "";
        toolIds.set(event.contentIndex, { id, name });
        yield { type: "block-start", index: event.contentIndex, blockType: "tool-call" };
        break;
      }
      case "toolcall_delta": {
        const known = toolIds.get(event.contentIndex);
        yield {
          type: "tool-call-delta",
          index: event.contentIndex,
          id: ToolCallId(known?.id ?? ""),
          ...(known === undefined || known.name === "" ? {} : { name: known.name }),
          argumentsDelta: event.delta,
        };
        break;
      }
      case "toolcall_end":
        yield {
          type: "block-end",
          index: event.contentIndex,
          block: {
            type: "tool-call",
            id: ToolCallId(event.toolCall.id),
            name: event.toolCall.name,
            // pi-ai 交回的是已解析的参数对象，宿主词汇表要原始 JSON 字符串。
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        };
        break;
      case "done": {
        const usage = toHostUsage(event.message.usage);
        if (usageTotal(usage) > 0) yield { type: "usage", usage };
        yield { type: "finish", reason: toHostFinishReason(event.message, contextWindow) };
        return;
      }
      case "error": {
        const usage = toHostUsage(event.error.usage);
        if (usageTotal(usage) > 0) yield { type: "usage", usage };
        if (signal?.aborted !== true && isContextOverflow(event.error, contextWindow)) {
          // 溢出可能**以 200 的流内事件**送达（旧插件第 1712-1723 行在 `mapStopReason`
          // 里第一个判它，`done` 与 `error` 两条路都要判）。它是宿主的压缩信号：
          // 归类成瞬时故障会按账号重放，且丢掉 `CONTEXT_WINDOW_EXCEEDED`。
          throw new LlmError(
            event.error.errorMessage ?? `pi-ai detected context overflow for model "${event.error.model}"`,
            CONTEXT_WINDOW_EXCEEDED_CODE,
          );
        }
        const reason = signal?.aborted === true ? "aborted" : "error";
        throw new OpencodeStreamFailure(0, undefined, event.error.errorMessage ?? `pi-ai stream ${reason}`);
      }
      default:
        throw new LlmError(`Unsupported pi-ai stream event`, "UNSUPPORTED_CONTENT");
    }
  }
  throw new LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED");
}

/** 一次尝试要交给 pi-ai 的全部事实。 */
export interface OpencodeStreamInput {
  /** 已装好的 pi-ai 模型。 */
  model: PiModel<OpencodeApi>;
  /** 请求上下文。 */
  context: PiContext;
  /** 本账号的密钥。 */
  apiKey: string;
  /** 交给 SDK 的 `fetch`（适配器的录证据包装）。 */
  fetchImpl: typeof fetch;
  /** 调用方信号。 */
  signal?: AbortSignal;
  /** 采样温度。 */
  temperature?: number;
  /** 输出上限。 */
  maxTokens?: number;
}

/** 三条线协议的实现表（旧插件 `buildProvider` 第 6496-6509 行的同一张表）。 */
const PROTOCOLS: Readonly<Record<OpencodeApi, ProviderStreams>> = {
  "anthropic-messages": anthropicMessages,
  "openai-completions": openaiCompletions,
  "openai-responses": openaiResponses,
};

/**
 * 用 pi-ai SDK 发出一次请求，交出宿主 chunk 流（旧插件 `streamAttempt` 第 7677-7696 行的
 * 请求部分）。时间预算由调用方用 `runStream` 套在外面。
 * @param input - 模型、上下文、密钥与注入点。
 * @returns 与线上同序的 chunk 流。
 */
export function streamOpencode(input: OpencodeStreamInput): AsyncIterable<StreamChunk> {
  const provider = createProvider<OpencodeApi>({
    id: SDK_PROVIDER_ID,
    name: "OpenCode Go",
    baseUrl: input.model.baseUrl,
    // 每个 provider 都必须声明鉴权语义；密钥逐请求显式传入（与旧插件
    // `harnessApiKeyAuth` 第 6490-6495 行一致）。
    auth: {
      apiKey: {
        name: "OpenCode API key",
        resolve: () => Promise.resolve({ auth: {}, source: "OpenCode API key" }),
      },
    },
    models: [input.model],
    api: PROTOCOLS,
  });
  const events = provider.streamSimple(input.model, normalizeContext(input.context), {
    apiKey: input.apiKey,
    fetch: input.fetchImpl,
    // 宿主契约：每个 provider 请求都要带 attribution 头；pi-ai 的客户端最后合并
    // `headers`（旧插件第 7687-7691 行）。
    headers: { ...attributionHeaders() },
    maxRetries: SDK_MAX_RETRIES,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
  });
  return toHostChunks(events, input.model.contextWindow, input.signal);
}
