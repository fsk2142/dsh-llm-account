/**
 * Command Code 线协议：端点、请求头、传输选择与回退、请求体构造、SSE 解码。
 *
 * 一切形状逐条对照旧插件 `@mars-sea/dsh-commandcode-provider/lib/index.js`
 * （行号写在各定义上方）。本模块**只**做线协议：不认识账号、额度、设置，也不做
 * 时间预算（那是 `src/core/transport.ts` 的 `runStream`）。
 *
 * 传输回退顺序（旧插件 `stream()` 第 7506-7519 行）：
 * 1. 按模型选初始协议（`claude-*` 强制 Messages，其余 Chat Completions）；
 * 2. 403 且正文是 `upgrade_required` 一类的套餐网关拒绝时，同一账号改用 CLI 传输重发一次；
 * 3. 其余失败交给适配器的失败分类（不在这里换账号）。
 * @module dsh-llm-account/src/vendors/commandcode/protocol
 */
import { ToolCallId, attributionHeaders, LlmError } from "@deepseek-ai/dsh-llm";
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from "@deepseek-ai/dsh-llm";
import { randomUUID } from "node:crypto";

/** 网关默认基地址（旧插件第 5361 行）。 */
export const DEFAULT_API_BASE = "https://api.commandcode.ai";

/** CLI 版本头 `x-command-code-version` 的取值（旧插件第 5360 行）。 */
export const COMMAND_CODE_CLI_VERSION = "1.79.2";

/** 目录端点路径（旧插件第 6788 行）。 */
export const MODELS_PATH = "/provider/v1/models";

/** CLI 传输端点路径（旧插件 `protocolEndpoint` 第 6651 行）。 */
export const CLI_GENERATE_PATH = "/alpha/generate";

/** Messages 传输端点路径。 */
export const MESSAGES_PATH = "/provider/v1/messages";

/** Chat Completions 传输端点路径。 */
export const CHAT_COMPLETIONS_PATH = "/provider/v1/chat/completions";

/** 默认整请求 deadline（旧插件配置默认值 `requestTimeoutMs` 第 10096 行）。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/** 默认流空闲看门狗（旧插件配置默认值 `streamIdleTimeoutMs` 第 10097 行）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

/** 默认输出上限（旧插件 `DEFAULT_GENERATE_MAX_TOKENS` 第 5390 行）。 */
export const DEFAULT_GENERATE_MAX_TOKENS = 131_072;

/** 身份传输头：中间压缩会破坏 SSE 的逐字节时间语义（旧插件第 2915 行）。 */
export const IDENTITY_ENCODING_HEADER: Readonly<Record<string, string>> = { "accept-encoding": "identity" };

/** 三条线协议。`openai` 即 `/provider/v1/chat/completions`（旧插件同名）。 */
export type CommandCodeProtocol = "openai" | "messages" | "cli";

/**
 * 线上只接受 Messages 端点的模型（旧插件 `MESSAGES_ONLY_MODELS` 第 673-684 行）。
 * 目录声明了 `supported_endpoints` 时以目录为准，这里是兜底。
 */
const MESSAGES_ONLY_MODELS: ReadonlySet<string> = new Set([
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
]);

/** 一次线请求：URL、请求头与已序列化的请求体。 */
export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取非空字符串。 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 读取有限数字。 */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 去掉基地址末尾的斜杠（旧插件在搜索路径上做同样的归一化，第 9438 行）。 */
function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * 一条协议对应的端点（旧插件 `protocolEndpoint` 第 6650-6653 行）。
 * @param protocol - 线协议。
 * @param base - 网关基地址。
 * @returns 绝对端点 URL。
 */
export function protocolEndpoint(protocol: CommandCodeProtocol, base: string): string {
  const root = trimBase(base);
  if (protocol === "cli") return `${root}${CLI_GENERATE_PATH}`;
  return protocol === "messages" ? `${root}${MESSAGES_PATH}` : `${root}${CHAT_COMPLETIONS_PATH}`;
}

/**
 * 该模型是否只能走 Messages 端点（旧插件第 686-688 行：目录声明的
 * `supported_endpoints` 优先，`claude-*` 兜底）。
 * @param model - 模型 id。
 * @param supportedEndpoints - 目录为该模型声明的端点；缺省表示目录没说。
 * @returns 是否必须走 Messages。
 */
export function requiresMessagesEndpoint(model: string, supportedEndpoints?: readonly string[]): boolean {
  if (supportedEndpoints !== undefined && supportedEndpoints.length > 0) {
    return supportedEndpoints.includes("/messages") && !supportedEndpoints.includes("/chat/completions");
  }
  return MESSAGES_ONLY_MODELS.has(model) || model.startsWith("claude-");
}

/**
 * 选择本次请求的初始协议（旧插件 `resolveProtocol` 第 7176-7188 行的模型与强制项
 * 部分；按账号缓存的账单分层（Go 套餐 → CLI）需要额度数据，属于 Task 10）。
 * @param input - 模型、可选强制协议与目录声明的端点。
 * @returns 初始协议。
 */
export function resolveProtocol(input: {
  model: string;
  forced?: CommandCodeProtocol;
  supportedEndpoints?: readonly string[];
}): CommandCodeProtocol {
  if (input.forced === "cli") return "cli";
  if (requiresMessagesEndpoint(input.model, input.supportedEndpoints)) return "messages";
  // 未知账号默认 Chat Completions：只有 403 upgrade_required 才回退到 CLI 传输
  // （Go 套餐账单分层那条捷径需要额度数据，属 Task 10）。
  return "openai";
}

/**
 * 该拒绝是否是「Go 套餐没有 Provider API 访问权」的网关闸门 —— 唯一应当回退到
 * CLI 传输的拒绝类别（旧插件 `isUpgradeRequiredError` 第 3774-3784 行）。
 * @param status - HTTP 状态。
 * @param body - 已解析的正文，或原始文本。
 * @returns 是否回退到 CLI 传输。
 */
export function isUpgradeRequired(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  let text: string;
  if (typeof body === "string") text = body;
  else {
    try {
      text = JSON.stringify(body ?? "");
    } catch {
      text = "";
    }
  }
  const lower = text.toLowerCase();
  if (lower.includes("upgrade_required")) return true;
  if (lower.includes("go plan") && lower.includes("api access")) return true;
  if (lower.includes("only plan without api access")) return true;
  return lower.includes("upgrade to goat or higher");
}

/**
 * 由工作目录推导 CLI 传输的 `x-project-slug`（旧插件 `projectSlugFromPath` 第 5715-5717 行）。
 * @param pathName - 工作目录。
 * @returns 小写、以连字符分隔的 slug；无法推导时为 `"project"`。
 */
export function projectSlugFromPath(pathName: string): string {
  const slug = pathName
    .toLowerCase()
    .replace(/^[a-z]:/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return slug === "" ? "project" : slug;
}

/**
 * 目录请求（旧插件 `GatewayFacts` 第 6788-6792 行）：不带 Authorization，
 * 只带 `accept`、身份编码与 attribution 头。
 * @param base - 网关基地址。
 * @returns URL 与请求头。
 */
export function catalogRequest(base: string): { url: string; headers: Record<string, string> } {
  return {
    url: `${trimBase(base)}${MODELS_PATH}`,
    headers: {
      accept: "application/json",
      ...IDENTITY_ENCODING_HEADER,
      ...attributionHeaders(),
    },
  };
}

/**
 * 生成请求的头与 URL（旧插件 `connectGenerate` 第 6720-6737 行）：共享头是
 * `Content-Type` + 身份编码 + `Authorization` + attribution；CLI 传输额外带版本、
 * 环境、项目 slug、体验开关；另两条传输带 `Accept: text/event-stream`。
 * @param input - 协议、基地址、密钥、已序列化请求体与可选工作目录。
 * @returns 可直接交给 `fetch` 的 URL、请求头与请求体。
 */
export function generateRequest(input: {
  protocol: CommandCodeProtocol;
  base: string;
  key: string;
  body: string;
  workingDir?: string;
}): WireRequest {
  const shared: Record<string, string> = {
    "Content-Type": "application/json",
    ...IDENTITY_ENCODING_HEADER,
    Authorization: `Bearer ${input.key}`,
    ...attributionHeaders(),
  };
  if (input.protocol === "cli") {
    return {
      url: protocolEndpoint("cli", input.base),
      headers: {
        ...shared,
        "x-command-code-version": COMMAND_CODE_CLI_VERSION,
        "x-cli-environment": "production",
        "x-project-slug": projectSlugFromPath(input.workingDir ?? process.cwd()),
        "x-taste-learning": "false",
        "x-co-flag": "false",
      },
      body: input.body,
    };
  }
  return {
    url: protocolEndpoint(input.protocol, input.base),
    headers: { ...shared, Accept: "text/event-stream" },
    body: input.body,
  };
}

/** 请求体构造所需的请求事实（由适配器算好后传进来，协议层不再读配置）。 */
export interface BodyFacts {
  /** 本次请求的输出上限（已按模型上限收紧）。 */
  maxTokens: number;
  /** 已折叠的系统提示文本；空串表示没有。 */
  systemText: string;
  /** 已选定的推理档位 id。 */
  reasoningEffort?: string;
  /** CLI 传输的 `config.workingDir`。 */
  workingDir?: string;
  /** 会话身份，用于 CLI 传输的 threadId。 */
  sessionId?: string;
}

/** 把一段内容压成纯文本（文件/图片块属于第 3 期，这里只取文本块）。 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === "text") parts.push(block.text);
  return parts.join("");
}

/** 把 `tool.parameters` 包成对象（宿主已保证它是对象）。 */
function toolSchema(parameters: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: true, ...parameters };
}

/** Chat Completions 的 messages 数组（旧插件 `buildOpenAIBody` 第 6564-6586 行）。 */
function openAiMessages(messages: readonly RequestMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "user") {
      out.push({ role: "user", content: textOf(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const calls = message.content.filter((block) => block.type === "tool-call");
      const text = textOf(message.content);
      out.push({
        role: "assistant",
        content: text,
        ...(calls.length === 0
          ? {}
          : {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }),
      });
      continue;
    }
    out.push({ role: "tool", tool_call_id: message.toolCallId, content: textOf(message.content) });
  }
  return out;
}

/** Messages 的 content 数组块。 */
type MessagesBlock = Record<string, unknown>;

/**
 * Messages 的 messages 数组（旧插件 `buildMessagesBody` 第 6617-6641 行的消息部分）。
 * 相邻同角色消息合并，避免上游对连续 user 消息的校验失败。
 */
function anthropicMessages(messages: readonly RequestMessage[]): unknown[] {
  const out: { role: string; content: MessagesBlock[] }[] = [];
  const push = (role: string, blocks: MessagesBlock[]): void => {
    const last = out.at(-1);
    if (last !== undefined && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") continue;
    if (message.role === "user") {
      push("user", [{ type: "text", text: textOf(message.content) }]);
      continue;
    }
    if (message.role === "assistant") {
      const blocks: MessagesBlock[] = [];
      const text = textOf(message.content);
      if (text !== "") blocks.push({ type: "text", text });
      for (const block of message.content) {
        if (block.type !== "tool-call") continue;
        blocks.push({ type: "tool_use", id: block.id, name: block.name, input: parseToolArguments(block.arguments) });
      }
      if (blocks.length > 0) push("assistant", blocks);
      continue;
    }
    push("user", [
      { type: "tool_result", tool_use_id: message.toolCallId, content: textOf(message.content), is_error: message.isError === true },
    ]);
  }
  return out;
}

/** 工具的 arguments 是原始 JSON 字符串，Messages 线上要对象（旧插件第 6261-6268 行）。 */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** CLI 传输的 system 段形状（旧插件 `cliSystem` 第 6475-6482 行）。 */
function cliSystem(systemText: string): string | MessagesBlock[] {
  if (systemText === "") return "";
  return [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
}

/**
 * CLI 传输的 threadId（旧插件 `cliThreadId` 第 6457-6465 行做 sha1 派生；本期先用
 * 会话 id 本身或随机 UUID —— 派生细节属于第 2 期的缓存对齐项）。
 */
function cliThreadId(sessionId: string | undefined): string {
  if (sessionId !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return sessionId;
  }
  return randomUUID();
}

/**
 * 构造一次请求的请求体（三条传输各自的线上形状）。
 *
 * **本期范围**：文本、工具声明与工具调用/结果；图片与文件投影、缓存断点、
 * `max_tokens` 自学习收紧属于第 2/3 期（设计 §15）。
 * @param protocol - 目标传输。
 * @param options - 宿主的完整请求。
 * @param facts - 由适配器算出的请求事实。
 * @returns 可 `JSON.stringify` 的请求体。
 */
export function buildRequestBody(protocol: CommandCodeProtocol, options: GenerateOptions, facts: BodyFacts): unknown {
  const tools: readonly ToolSchema[] = options.tools ?? [];
  if (protocol === "openai") {
    return {
      model: options.model,
      messages: [...(facts.systemText === "" ? [] : [{ role: "system", content: facts.systemText }]), ...openAiMessages(options.messages)],
      ...(tools.length === 0
        ? {}
        : {
            tools: tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: toolSchema(tool.parameters) },
            })),
          }),
      max_tokens: facts.maxTokens,
      temperature: options.temperature ?? 0.3,
      stream: true,
      ...(facts.reasoningEffort === undefined ? {} : { reasoning_effort: facts.reasoningEffort }),
    };
  }
  if (protocol === "messages") {
    return {
      model: options.model,
      max_tokens: facts.maxTokens,
      stream: true,
      messages: anthropicMessages(options.messages),
      ...(facts.systemText === "" ? {} : { system: [{ type: "text", text: facts.systemText, cache_control: { type: "ephemeral" } }] }),
      ...(facts.reasoningEffort === undefined ? {} : { output_config: { effort: facts.reasoningEffort } }),
      ...(tools.length === 0
        ? {}
        : {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: toolSchema(tool.parameters),
            })),
          }),
    };
  }
  // CLI 传输（旧插件 `buildCliBody` 第 6527-6562 行）：消息与工具沿用 Chat Completions 形状。
  return {
    config: {
      workingDir: facts.workingDir ?? process.cwd(),
      date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: null,
    taste: null,
    skills: null,
    permissionMode: "standard",
    params: {
      model: options.model,
      messages: openAiMessages(options.messages),
      tools: tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        input_schema: toolSchema(tool.parameters),
      })),
      system: cliSystem(facts.systemText),
      max_tokens: facts.maxTokens,
      temperature: options.temperature ?? 0.3,
      stream: true,
      ...(facts.reasoningEffort === undefined ? {} : { reasoning_effort: facts.reasoningEffort }),
    },
    threadId: cliThreadId(facts.sessionId),
  };
}

/**
 * 流中途报告的拒绝（SSE `error` 事件或非 2xx 响应）。
 *
 * 刻意不是 `LlmError`：它承载的是「厂商原始状态 + 原始正文」，由适配器用
 * {@link classifyCommandCodeFailure} 统一分类；直接抛给宿主会丢掉分类所需的证据。
 */
export class CommandCodeStreamFailure extends Error {
  /** 厂商给出的 HTTP 状态；流中途事件未带状态时为 `0`。 */
  readonly status: number;
  /** 厂商给出的原始错误正文。 */
  readonly body: unknown;

  /**
   * @param status - HTTP 状态；`0` 表示事件里没带。
   * @param body - 原始错误正文。
   */
  constructor(status: number, body: unknown) {
    super(`Command Code stream error (status ${status})`);
    this.name = "CommandCodeStreamFailure";
    this.status = status;
    this.body = body;
  }
}

/** 把一次 SSE `error` 事件/正文转成 {@link CommandCodeStreamFailure}。 */
function streamFailure(body: unknown): CommandCodeStreamFailure {
  const status = isRecord(body) ? (numberValue(body.statusCode) ?? numberValue(body.status) ?? 0) : 0;
  return new CommandCodeStreamFailure(status, body);
}

/** Chat Completions 的 usage 形状 → 宿主计数（缓存命中要从 prompt 里减出来）。 */
function openAiUsage(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const prompt = numberValue(raw.prompt_tokens) ?? 0;
  const cached = numberValue((isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined)?.cached_tokens) ?? 0;
  const completion = numberValue(raw.completion_tokens) ?? 0;
  const usage: TokenUsage = {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: completion,
    cacheReadTokens: cached,
  };
  const total = numberValue(raw.total_tokens);
  if (total !== undefined) usage.totalTokens = total;
  return usage;
}

/**
 * Messages 的 usage 形状 → 宿主计数（Anthropic 的 input 已不含缓存读写）。
 *
 * 每个字段先看本次负载，缺失则沿用 `previous`（旧插件 `mapMessagesUsage` 第 4655-4669 行）：
 * 网关实测的 `message_delta.usage` 可能**只有输出计数**，输入/缓存计数只出现在
 * `message_start.message.usage`；不合并就会把已知的输入计数读成 0（项目约束：
 * 缺失字段绝不能被当成 0）。
 * @param raw - 本次事件的 usage 负载。
 * @param previous - 同一响应里此前已见过的 usage（`message_start` 的）。
 * @returns 宿主计数字段；本次负载不是对象时为 `undefined`。
 */
function messagesUsage(raw: unknown, previous?: TokenUsage): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const input = numberValue(raw.input_tokens) ?? previous?.inputTokens ?? 0;
  const output = numberValue(raw.output_tokens) ?? previous?.outputTokens ?? 0;
  const cacheRead = numberValue(raw.cache_read_input_tokens) ?? previous?.cacheReadTokens ?? 0;
  const cacheWrite = numberValue(raw.cache_creation_input_tokens) ?? previous?.cacheWriteTokens ?? 0;
  const usage: TokenUsage = { inputTokens: Math.max(0, input), outputTokens: output, cacheReadTokens: cacheRead };
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite;
  const reasoning =
    numberValue((isRecord(raw.output_tokens_details) ? raw.output_tokens_details : undefined)?.thinking_tokens) ??
    previous?.reasoningTokens;
  if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  return usage;
}

/** CLI 传输的 totalUsage 形状 → 宿主计数（旧插件第 4521-4536 行）。 */
function cliUsage(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) return undefined;
  const details = isRecord(raw.inputTokenDetails) ? raw.inputTokenDetails : undefined;
  const totalInput = numberValue(raw.inputTokens) ?? 0;
  const cacheRead = numberValue(details?.cacheReadTokens) ?? 0;
  const cacheWrite = numberValue(details?.cacheWriteTokens) ?? 0;
  const usage: TokenUsage = {
    inputTokens: numberValue(details?.noCacheTokens) ?? Math.max(0, totalInput - cacheRead - cacheWrite),
    outputTokens: numberValue(raw.outputTokens) ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
  const reasoning = numberValue((isRecord(raw.outputTokenDetails) ? raw.outputTokenDetails : undefined)?.reasoningTokens) ?? numberValue(raw.reasoningTokens);
  if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  return usage;
}

/** 线上的结束原因 → 宿主结束原因（两套词汇表共用）。 */
function mapFinishReason(raw: string | undefined): FinishReason {
  switch (raw) {
    case "tool_calls":
    case "function_call":
    case "tool_use":
      return { kind: "tool-calls" };
    case "length":
    case "max_tokens":
      return { kind: "max-tokens" };
    default:
      return { kind: "stop" };
  }
}

/** Chat Completions 流里缓冲中的一个工具调用片段。 */
interface OpenAiToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** Messages 流里一个原生内容块到宿主 chunk 的映射。 */
interface MessagesBlockState {
  kind: "text" | "reasoning" | "tool";
  index: number;
  id?: ToolCallId;
  name?: string;
  arguments: string;
}

/**
 * 块装配器：把一个响应的增量拼成宿主的分块事件流（`block-start` / `*-delta` /
 * `block-end`），并保证同一时间只有一个文本块与一个推理块处于打开状态。
 */
class StreamAssembler {
  #nextIndex = 0;
  #textIndex = -1;
  #text = "";
  #reasoningIndex = -1;
  #reasoning = "";
  #openAiTools: OpenAiToolCall[] = [];
  readonly #messagesBlocks = new Map<number, MessagesBlockState>();
  /** `message_start` 的 usage：`message_delta` 只带输出计数时靠它补齐输入/缓存计数。 */
  #messagesUsage: TokenUsage | undefined;
  /** usage 已交出的标志：宿主拒绝第二条 usage chunk（`dsh-llm` 的流不变式）。 */
  #messagesUsageEmitted = false;
  /** `message_delta` 记下的结束原因；真正的 finish 由 `message_stop` 发出。 */
  #messagesFinishReason: string | undefined;

  #openText(): StreamChunk[] {
    if (this.#textIndex >= 0) return [];
    this.#textIndex = this.#nextIndex;
    this.#nextIndex += 1;
    return [{ type: "block-start", index: this.#textIndex, blockType: "text" }];
  }

  #openReasoning(): StreamChunk[] {
    if (this.#reasoningIndex >= 0) return [];
    this.#reasoningIndex = this.#nextIndex;
    this.#nextIndex += 1;
    return [{ type: "block-start", index: this.#reasoningIndex, blockType: "reasoning" }];
  }

  /** 关闭文本块并交出装配好的内容。 */
  closeText(): StreamChunk[] {
    if (this.#textIndex < 0) return [];
    const chunk: StreamChunk = {
      type: "block-end",
      index: this.#textIndex,
      block: { type: "text", text: this.#text },
    };
    this.#textIndex = -1;
    this.#text = "";
    return [chunk];
  }

  /** 关闭推理块并交出装配好的内容。 */
  closeReasoning(): StreamChunk[] {
    if (this.#reasoningIndex < 0) return [];
    const chunk: StreamChunk = {
      type: "block-end",
      index: this.#reasoningIndex,
      block: { type: "reasoning", text: this.#reasoning },
    };
    this.#reasoningIndex = -1;
    this.#reasoning = "";
    return [chunk];
  }

  /** 追加一段可见文本（顺带关闭推理块）。 */
  textDelta(text: string): StreamChunk[] {
    if (text === "") return [];
    const chunks = [...this.closeReasoning(), ...this.#openText()];
    this.#text += text;
    chunks.push({ type: "text-delta", index: this.#textIndex, text });
    return chunks;
  }

  /** 追加一段推理文本（顺带关闭文本块）。 */
  reasoningDelta(text: string): StreamChunk[] {
    if (text === "") return [];
    const chunks = [...this.closeText(), ...this.#openReasoning()];
    this.#reasoning += text;
    chunks.push({ type: "reasoning-delta", index: this.#reasoningIndex, text });
    return chunks;
  }

  /** 合并一个 Chat Completions 工具调用片段。 */
  addOpenAiToolCall(fragment: { index: number; id?: string; name?: string; arguments?: string }): void {
    let existing = this.#openAiTools.find((call) => call.index === fragment.index);
    if (existing === undefined) {
      existing = { index: fragment.index, id: fragment.id ?? "", name: fragment.name ?? "", arguments: "" };
      this.#openAiTools.push(existing);
    } else {
      if (fragment.id !== undefined && existing.id === "") existing.id = fragment.id;
      if (fragment.name !== undefined && existing.name === "") existing.name = fragment.name;
    }
    if (fragment.arguments !== undefined) existing.arguments += fragment.arguments;
  }

  /** 交出所有缓冲的 Chat Completions 工具调用（在 finish 之前调用）。 */
  flushOpenAiToolCalls(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const call of this.#openAiTools) {
      const index = this.#nextIndex;
      this.#nextIndex += 1;
      const id = ToolCallId(call.id === "" ? randomUUID() : call.id);
      chunks.push({ type: "block-start", index, blockType: "tool-call" });
      chunks.push({ type: "tool-call-delta", index, id, name: call.name, argumentsDelta: call.arguments });
      chunks.push({ type: "block-end", index, block: { type: "tool-call", id, name: call.name, arguments: call.arguments } });
    }
    this.#openAiTools = [];
    return chunks;
  }

  /**
   * 开出一个内容已经完整的一次性工具调用块（CLI 传输的 `tool-call` 事件）。
   * @param id - 工具调用 id。
   * @param name - 工具名。
   * @param args - 已序列化的参数对象。
   * @returns 该块的三个 chunk。
   */
  openToolCall(id: ReturnType<typeof ToolCallId>, name: string, args: string): StreamChunk[] {
    const index = this.#nextIndex;
    this.#nextIndex += 1;
    return [
      { type: "block-start", index, blockType: "tool-call" },
      { type: "tool-call-delta", index, id, name, argumentsDelta: args },
      { type: "block-end", index, block: { type: "tool-call", id, name, arguments: args } },
    ];
  }

  /** Messages 的 `content_block_start`。 */
  messagesBlockStart(nativeIndex: number, block: Record<string, unknown>): StreamChunk[] {
    const nativeType = stringValue(block.type);
    if (nativeType === "text") {
      this.#messagesBlocks.set(nativeIndex, { kind: "text", index: -1, arguments: "" });
      return this.#openText();
    }
    if (nativeType === "thinking" || nativeType === "redacted_thinking") {
      this.#messagesBlocks.set(nativeIndex, { kind: "reasoning", index: -1, arguments: "" });
      return this.#openReasoning();
    }
    if (nativeType !== "tool_use") return [];
    const id = ToolCallId(stringValue(block.id) ?? randomUUID());
    const name = stringValue(block.name) ?? "";
    const index = this.#nextIndex;
    this.#nextIndex += 1;
    this.#messagesBlocks.set(nativeIndex, { kind: "tool", index, id, name, arguments: "" });
    return [
      { type: "block-start", index, blockType: "tool-call" },
      { type: "tool-call-delta", index, id, name, argumentsDelta: "" },
    ];
  }

  /** Messages 的 `content_block_delta`。 */
  messagesBlockDelta(nativeIndex: number, delta: Record<string, unknown>): StreamChunk[] {
    const deltaType = stringValue(delta.type);
    if (deltaType === "text_delta") return this.textDelta(stringValue(delta.text) ?? "");
    if (deltaType === "thinking_delta") return this.reasoningDelta(stringValue(delta.thinking) ?? "");
    if (deltaType !== "input_json_delta") return [];
    const block = this.#messagesBlocks.get(nativeIndex);
    if (block === undefined || block.kind !== "tool" || block.id === undefined) return [];
    const partial = stringValue(delta.partial_json) ?? "";
    if (partial === "") return [];
    block.arguments += partial;
    return [{ type: "tool-call-delta", index: block.index, id: block.id, argumentsDelta: partial }];
  }

  /** Messages 的 `content_block_stop`。 */
  messagesBlockStop(nativeIndex: number): StreamChunk[] {
    const block = this.#messagesBlocks.get(nativeIndex);
    if (block === undefined) return [];
    this.#messagesBlocks.delete(nativeIndex);
    if (block.kind === "text") return this.closeText();
    if (block.kind === "reasoning") return this.closeReasoning();
    if (block.id === undefined) return [];
    return [
      {
        type: "block-end",
        index: block.index,
        block: { type: "tool-call", id: block.id, name: block.name ?? "", arguments: block.arguments },
      },
    ];
  }

  /** 关闭所有打开的块、交出缓冲的工具调用，并以 finish 收尾。 */
  finish(reason: FinishReason): StreamChunk[] {
    return [...this.closeText(), ...this.closeReasoning(), ...this.flushOpenAiToolCalls(), { type: "finish", reason }];
  }

  /** Messages 的 `message_start`：只记下 usage，不在此时交出（全流只发一条 usage）。 */
  setMessagesUsage(usage: TokenUsage): void {
    this.#messagesUsage = usage;
  }

  /**
   * Messages 的 `message_delta`：把本次 usage 与此前 `message_start` 的合并后交出。
   *
   * 本次负载缺失时（`event.usage` 不是对象）**不**交出任何 chunk —— usage 会留到
   * `message_stop` 由 {@link messagesStop} 发出，绝不把组件重复交给宿主。
   * @param raw - `message_delta.usage` 的原始负载。
   * @returns 至多一条 usage chunk。
   */
  mergeMessagesUsage(raw: unknown): StreamChunk[] {
    const merged = messagesUsage(raw, this.#messagesUsage);
    if (merged === undefined) return [];
    this.#messagesUsage = merged;
    return this.#emitMessagesUsage();
  }

  /** Messages 的 `message_delta`：记住 `stop_reason`，finish 留给 `message_stop`。 */
  setMessagesFinishReason(raw: string | undefined): void {
    if (raw !== undefined) this.#messagesFinishReason = raw;
  }

  /**
   * Messages 的 `message_stop`：先补发（若尚未发出的）usage，再交出**唯一**的 finish。
   *
   * 网关实测序列是 `message_delta`（带 `stop_reason` 与最终 usage）→ `message_stop`
   * （旧插件第 4680-4686 行注释）；finish 只在这里发出一次，否则宿主会拿到两条
   * finish chunk 并只保留最后一条 —— 结束原因被覆盖，且 `max-tokens` 截断时本该丢弃的
   * 半装工具块会被留下（旧插件第 4814-4832 行）。
   * @returns usage chunk（有且仅在尚未交出时）+ 一条 finish chunk。
   */
  messagesStop(): StreamChunk[] {
    return [...this.#emitMessagesUsage(), { type: "finish", reason: mapFinishReason(this.#messagesFinishReason) }];
  }

  /** 交出尚未发出的 Messages usage；已经交过或根本没有时为 `[]`。 */
  #emitMessagesUsage(): StreamChunk[] {
    if (this.#messagesUsage === undefined || this.#messagesUsageEmitted) return [];
    this.#messagesUsageEmitted = true;
    return [{ type: "usage", usage: this.#messagesUsage }];
  }
}

/** Chat Completions 的一行事件（旧插件 `handleOpenAIEvent` 第 4557-4644 行）。 */
function openAiChunks(assembler: StreamAssembler, event: Record<string, unknown>): StreamChunk[] {
  if (event.error !== undefined) throw streamFailure(event.error);
  const chunks: StreamChunk[] = [];
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    const usage = openAiUsage(event.usage);
    if (usage !== undefined) chunks.push({ type: "usage", usage });
    return chunks;
  }
  const choice = isRecord(choices[0]) ? choices[0] : {};
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const reasoning = stringValue(delta.reasoning) ?? stringValue(delta.reasoning_content);
  if (reasoning !== undefined) chunks.push(...assembler.reasoningDelta(reasoning));
  const content = stringValue(delta.content);
  if (content !== undefined) chunks.push(...assembler.textDelta(content));
  if (Array.isArray(delta.tool_calls)) {
    for (const raw of delta.tool_calls) {
      if (!isRecord(raw)) continue;
      const fn = isRecord(raw.function) ? raw.function : {};
      const id = stringValue(raw.id);
      const name = stringValue(fn.name);
      const args = stringValue(fn.arguments);
      assembler.addOpenAiToolCall({
        index: numberValue(raw.index) ?? 0,
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(args === undefined ? {} : { arguments: args }),
      });
    }
  }
  if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
    const usage = openAiUsage(event.usage);
    if (usage !== undefined) chunks.push({ type: "usage", usage });
    chunks.push(...assembler.finish(mapFinishReason(stringValue(choice.finish_reason))));
  }
  return chunks;
}

/** Messages 的一行事件（旧插件第 4678 行起的处理器）。 */
function messagesChunks(assembler: StreamAssembler, event: Record<string, unknown>): StreamChunk[] {
  switch (stringValue(event.type)) {
    case "message_start": {
      // 输入/缓存计数只在这里出现：先记进装配器，等 message_delta 合并后统一交出。
      const message = isRecord(event.message) ? event.message : {};
      const usage = messagesUsage(message.usage);
      if (usage !== undefined) assembler.setMessagesUsage(usage);
      return [];
    }
    case "content_block_start": {
      const index = numberValue(event.index) ?? 0;
      const block = isRecord(event.content_block) ? event.content_block : {};
      return assembler.messagesBlockStart(index, block);
    }
    case "content_block_delta": {
      const index = numberValue(event.index) ?? 0;
      const delta = isRecord(event.delta) ? event.delta : {};
      return assembler.messagesBlockDelta(index, delta);
    }
    case "content_block_stop":
      return assembler.messagesBlockStop(numberValue(event.index) ?? 0);
    case "message_delta": {
      // 只交出合并后的 usage；finish 归 message_stop，避免一条响应两条终止 chunk。
      const chunks = assembler.mergeMessagesUsage(event.usage);
      const delta = isRecord(event.delta) ? event.delta : {};
      assembler.setMessagesFinishReason(stringValue(delta.stop_reason));
      return chunks;
    }
    case "message_stop":
      return assembler.messagesStop();
    case "error":
      throw streamFailure(event.error ?? event);
    default:
      return [];
  }
}

/** CLI 传输的一行事件（旧插件 `handleCliEvent` 第 4435-4550 行）。 */
function cliChunks(assembler: StreamAssembler, event: Record<string, unknown>): StreamChunk[] {
  switch (stringValue(event.type)) {
    case "text-delta":
      return assembler.textDelta(stringValue(event.text) ?? "");
    case "reasoning-delta":
      return assembler.reasoningDelta(stringValue(event.text) ?? "");
    case "reasoning-start":
      return assembler.closeText();
    case "reasoning-end":
      return assembler.closeReasoning();
    case "tool-call": {
      const id = ToolCallId(stringValue(event.toolCallId) ?? randomUUID());
      const name = stringValue(event.toolName) ?? "";
      const input = event.input ?? event.args ?? event.arguments;
      const args = JSON.stringify(isRecord(input) ? input : {});
      return assembler.openToolCall(id, name, args);
    }
    case "finish": {
      const chunks: StreamChunk[] = [];
      const usage = cliUsage(event.totalUsage);
      if (usage !== undefined) chunks.push({ type: "usage", usage });
      chunks.push(...assembler.finish(mapFinishReason(stringValue(event.finishReason))));
      return chunks;
    }
    case "error":
      throw streamFailure(event.error ?? event);
    default:
      return [];
  }
}

/** 按协议把一行解析成 chunk。 */
function decodeLine(assembler: StreamAssembler, protocol: CommandCodeProtocol, line: string): StreamChunk[] {
  const trimmed = line.trim();
  // 空行、注释与非 `data:` 字段（`event:` 等）都不是事件（旧插件第 4345-4355 行）。
  if (trimmed === "" || trimmed.startsWith(":") || trimmed.startsWith("event:")) return [];
  const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (payload === "" || payload === "[DONE]") return [];
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    // 坏行跳过：一条解析不了的诊断行不该终结整条流（与旧插件一致）。
    return [];
  }
  if (!isRecord(event)) return [];
  if (protocol === "openai") return openAiChunks(assembler, event);
  if (protocol === "messages") return messagesChunks(assembler, event);
  return cliChunks(assembler, event);
}

/**
 * 把 HTTP 响应体解码成宿主的 chunk 流。
 *
 * 行级解析（与旧插件一致）：逐行 trim，跳过空行/注释/`event:` 行，去掉 `data:` 前缀，
 * 忽略 `[DONE]`，其余按 JSON 解析，解析失败的坏行跳过。调用方负责用
 * `runStream` 套上时间预算。
 * @param protocol - 该响应对应的线协议。
 * @param body - 响应体；`null`（无响应体）时抛协议错误。
 * @returns 与线上事件同序的 chunk 流。
 */
export async function* decodeStream(
  protocol: CommandCodeProtocol,
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<StreamChunk> {
  if (body === null) throw new LlmError("Command Code API returned no response body", "PROVIDER_PROTOCOL_ERROR");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const assembler = new StreamAssembler();
  let buffer = "";
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done === true) break;
      buffer += decoder.decode(read.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        for (const chunk of decodeLine(assembler, protocol, line)) yield chunk;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    for (const chunk of decodeLine(assembler, protocol, buffer)) yield chunk;
  } finally {
    // 尽力而为：不等取消完成（`runStream` 的超时/中止路径正是靠这一点不被拖住）。
    void reader.cancel().catch(() => {});
  }
}
