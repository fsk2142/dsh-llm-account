/**
 * Open Design 线协议：端点、请求头、请求体构造与 SSE 解码。
 *
 * **只有一条传输**：Chat Completions（OpenAI 形状，计划 §0 的线上事实）——
 * `GET /models` 是 `{object:"list",data:[…]}`，`POST /chat/completions` 是标准的
 * OpenAI 流式响应（工具调用同 OpenAI 形状，增量在 `delta.tool_calls` 里）。
 *
 * **为什么这是一份自带实现，而不是 import `../commandcode/protocol` 的导出件**（计划 §2.2
 * 要求二选一并在报告里说明）：那个模块的 OpenAI 半边**没有导出**任何可复用的东西 ——
 * `buildRequestBody` / `decodeStream` 虽然导出，但签名绑死了 `CommandCodeProtocol`
 * （`"openai" | "messages" | "cli"`）与 Command Code 自己的端点路径（`/provider/v1/…`）、
 * 错误文案（`Command Code stream error`）。要复用就必须改动别家厂商的模块（扩大导出面、
 * 放宽协议参数），而工作纪律明确不允许改别家厂商的行为。所以这里按同一形状重写 OpenAI 半边：
 * 端点常量、请求体构造、SSE 解码都只看 OpenAI 协议，去掉 Messages 与 CLI 传输。
 *
 * 本模块**只**做线协议：不认识账号、额度、设置，也不做时间预算（那是
 * `src/core/transport.ts` 的 `runStream`）。
 * @module dsh-llm-account/src/vendors/opendesign/protocol
 */
import { EMPTY_RESPONSE_CODE, ToolCallId, attributionHeaders, LlmError } from "@deepseek-ai/dsh-llm";
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

/** 推理网关默认基地址（计划 §1：`amr-link` 是运行时链路的入口）。 */
export const DEFAULT_BASE_URL = "https://amr-link.open-design.ai/v1";

/** 目录端点路径（OpenAI 形状：基地址已含 `/v1`）。 */
export const MODELS_PATH = "/models";

/** Chat Completions 端点路径。 */
export const CHAT_COMPLETIONS_PATH = "/chat/completions";

/** 默认整请求 deadline（与另两家同一档：长回答允许跑满 5 分钟）。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

/** 默认流空闲看门狗（毫秒）。 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

/** 默认输出上限（未指定 `maxTokens` 时的封顶）。 */
export const DEFAULT_GENERATE_MAX_TOKENS = 131_072;

/** 身份传输头：中间压缩会破坏 SSE 的逐字节时间语义。 */
export const IDENTITY_ENCODING_HEADER: Readonly<Record<string, string>> = { "accept-encoding": "identity" };

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

/** 去掉基地址末尾的斜杠（用户可能把 `/v1/` 写进来）。 */
function trimBase(base: string): string {
  return base.replace(/\/+$/, "");
}

/** Chat Completions 端点（唯一一条传输）。 */
export function generateEndpoint(base: string): string {
  return `${trimBase(base)}${CHAT_COMPLETIONS_PATH}`;
}

/**
 * 目录请求。
 *
 * **必须带 Authorization**：`GET /v1/models` 与推理是同一条 Bearer（2026-10-18 实测该网关
 * 不带密钥直接回 `401 {"error":{"code":"missing_api_key"}}`）。计划 §0 早期写的是「目录是
 * 公开的」，那条假设在本网关上不成立 —— 不带密钥的结果是**模型列表永远为空**。
 * @param base - 网关基地址。
 * @param key - 推理密钥（缺省时仍按无鉴权发，宿主没配账号时由端点自己报 401）。
 * @returns URL 与请求头。
 */
export function catalogRequest(base: string, key?: string): { url: string; headers: Record<string, string> } {
  return {
    url: `${trimBase(base)}${MODELS_PATH}`,
    headers: {
      accept: "application/json",
      ...IDENTITY_ENCODING_HEADER,
      ...(key === undefined || key === "" ? {} : { Authorization: `Bearer ${key}` }),
      ...attributionHeaders(),
    },
  };
}

/**
 * 生成请求的头与 URL：`Content-Type` + 身份编码 + `Authorization: Bearer` +
 * attribution + `Accept: text/event-stream`。
 * @param input - 基地址、密钥与已序列化请求体。
 * @returns 可直接交给 `fetch` 的 URL、请求头与请求体。
 */
export function generateRequest(input: { base: string; key: string; body: string }): WireRequest {
  return {
    url: generateEndpoint(input.base),
    headers: {
      "Content-Type": "application/json",
      ...IDENTITY_ENCODING_HEADER,
      Authorization: `Bearer ${input.key}`,
      ...attributionHeaders(),
      Accept: "text/event-stream",
    },
    body: input.body,
  };
}

/** 请求体构造所需的请求事实（由适配器算好后传进来，协议层不再读配置）。 */
export interface BodyFacts {
  /** 本次请求的输出上限（已按模型上限收紧）。 */
  maxTokens: number;
  /** 已折叠的系统提示文本；空串表示没有。 */
  systemText: string;
  /** 已选定的推理档位 id；缺省表示不发这个字段。 */
  reasoningEffort?: string;
}

/** 把一段内容压成纯文本（文件/图片块属于后续期次，这里只取文本块）。 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === "text") parts.push(block.text);
  return parts.join("");
}

/** 把 `tool.parameters` 包成对象（宿主已保证它是对象）。 */
function toolSchema(parameters: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: true, ...parameters };
}

/** Chat Completions 的 messages 数组（OpenAI 形状：user / assistant(+tool_calls) / tool）。 */
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

/**
 * 构造一次请求的请求体（Chat Completions 形状）。
 *
 * **本期范围**：文本、工具声明与工具调用/结果；图片与文件投影、缓存断点、
 * `max_tokens` 自学习收紧不属于本期。
 * @param options - 宿主的完整请求。
 * @param facts - 由适配器算出的请求事实。
 * @returns 可 `JSON.stringify` 的请求体。
 */
export function buildRequestBody(options: GenerateOptions, facts: BodyFacts): unknown {
  const tools: readonly ToolSchema[] = options.tools ?? [];
  return {
    model: options.model,
    messages: [
      ...(facts.systemText === "" ? [] : [{ role: "system", content: facts.systemText }]),
      ...openAiMessages(options.messages),
    ],
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

/**
 * 流中途报告的拒绝（SSE `error` 事件或非 2xx 响应）。
 *
 * 刻意不是 `LlmError`：它承载的是「厂商原始状态 + 原始正文」，由适配器用
 * {@link classifyOpenDesignFailure} 统一分类；直接抛给宿主会丢掉分类所需的证据。
 */
export class OpenDesignStreamFailure extends Error {
  /** 厂商给出的 HTTP 状态；流中途事件未带状态时为 `0`。 */
  readonly status: number;
  /** 厂商给出的原始错误正文。 */
  readonly body: unknown;

  /**
   * @param status - HTTP 状态；`0` 表示事件里没带。
   * @param body - 原始错误正文。
   */
  constructor(status: number, body: unknown) {
    super(`Open Design stream error (status ${status})`);
    this.name = "OpenDesignStreamFailure";
    this.status = status;
    this.body = body;
  }
}

/** 把一次 SSE `error` 事件/正文转成 {@link OpenDesignStreamFailure}。 */
function streamFailure(body: unknown): OpenDesignStreamFailure {
  const status = isRecord(body) ? (numberValue(body.statusCode) ?? numberValue(body.status) ?? 0) : 0;
  return new OpenDesignStreamFailure(status, body);
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
 * 线上的结束原因 → 宿主结束原因。
 *
 * `length` / `max_tokens` 的特殊处理（与另两家的同一口径）：打到输出上限**却一个字都没产出**
 * 时，不能伪装成正常的 `max-tokens` 收尾 —— 空响应会让这一轮什么都不说地结束，且多半是
 * 提示词/上下文把回答空间挤没了，重试续写无济于事。此时报 `INVALID_REQUEST`
 * （带可执行建议），宿主不重试、不换账号。
 * @param raw - 线上原始结束原因（大小写敏感，按厂商原样传）。
 * @param producedContent - 本流是否真的产出过内容（文本/推理/工具调用）。
 */
function mapFinishReason(raw: string | undefined, producedContent: boolean): FinishReason {
  switch (raw) {
    case "tool_calls":
    case "function_call":
    case "tool_use":
      return { kind: "tool-calls" };
    case "length":
    case "max_tokens":
      if (!producedContent) {
        return {
          kind: "error",
          failure: {
            message:
              'the model produced no content at its output cap (finish_reason "length"). The prompt may leave too little room for an answer. Compact the context or raise this model\'s max output, then retry',
            code: "INVALID_REQUEST",
          },
        };
      }
      return { kind: "max-tokens" };
    default:
      return { kind: "stop" };
  }
}

/** 一次 usage 计入的 token 总数（缺 `totalTokens` 时按分项相加，缺分项按 0）。 */
function usageTotalOf(usage: TokenUsage): number {
  return (
    usage.totalTokens ??
    usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  );
}

/**
 * 一条 chunk 是否代表「流真的产出了东西」。
 *
 * 用来在**没有任何终止事件**的情况下区分「空响应」（必须报可重试错误）与
 * 「有内容但被截断」（补一条 finish）。
 * @param chunk - 已装配好、即将交给宿主的 chunk。
 * @returns 是否算作内容。
 */
function chunkIsContent(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== "";
    case "block-end":
      return chunk.block.type === "tool-call";
    case "usage":
      return usageTotalOf(chunk.usage) > 0;
    default:
      return false;
  }
}

/** Chat Completions 流里缓冲中的一个工具调用片段。 */
interface OpenAiToolCall {
  index: number;
  id: string;
  name: string;
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
  #finished = false;
  /** 本流是否真的产出过内容（文本/推理/工具调用）。 */
  #producedContent = false;

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
    this.#producedContent = true;
    chunks.push({ type: "text-delta", index: this.#textIndex, text });
    return chunks;
  }

  /** 追加一段推理文本（顺带关闭文本块）。 */
  reasoningDelta(text: string): StreamChunk[] {
    if (text === "") return [];
    const chunks = [...this.closeText(), ...this.#openReasoning()];
    this.#reasoning += text;
    this.#producedContent = true;
    chunks.push({ type: "reasoning-delta", index: this.#reasoningIndex, text });
    return chunks;
  }

  /** 合并一个 Chat Completions 工具调用片段。 */
  addOpenAiToolCall(fragment: { index: number; id?: string; name?: string; arguments?: string }): void {
    this.#producedContent = true;
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

  /**
   * 是否还缓冲着尚未交出的 OpenAI 工具调用片段。
   *
   * 它已经是「有内容」的证据（收到 `delta.tool_calls` 的当刻就算产出），但这些片段要到
   * {@link flushOpenAiToolCalls} 才变成 chunk —— 只看已产出的 chunk 会在流末把它误判成
   * 空响应，并连带丢掉一个真实的工具调用。
   */
  get hasBufferedToolCall(): boolean {
    return this.#openAiTools.length > 0;
  }

  /** 本流是否真的产出过内容（文本/推理/工具调用）；供结束原因映射使用。 */
  get producedOutput(): boolean {
    return this.#producedContent;
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
   * 关闭所有仍打开的块（文本、推理、缓冲的工具调用），并以 finish 收尾。
   *
   * **幂等**：已经交出过 finish 时返回 `[]`。每条流恰好一条 finish（宿主保留最后一条，多发的
   * 会覆盖结束原因，且 `max-tokens` 截断时本该丢弃的半装工具块会被留下）。
   * @param reason - 结束原因。
   * @returns 关闭块与唯一一条 finish；已有 finish 时为 `[]`。
   */
  finish(reason: FinishReason): StreamChunk[] {
    if (this.#finished) return [];
    this.#finished = true;
    return [...this.closeText(), ...this.closeReasoning(), ...this.flushOpenAiToolCalls(), { type: "finish", reason }];
  }

  /**
   * 流在**没有任何终止事件**的情况下干净结束时的兜底（正文被截断、`finish_reason` 缺席）。
   *
   * 三条判据：
   * - 已经交出过 finish → 返回 `[]`：每条流**恰好一条** finish，绝不补第二条。
   * - 没交出过 finish 且**什么内容都没产出** → 抛可重试的 {@link EMPTY_RESPONSE_CODE}：
   *   空响应不能伪装成 `{kind:"stop"}` 的正常收尾。
   * - 有内容但缺终止事件（截断）→ 补一条 `stop` 的 finish：宿主 `FinishReason` 没有
   *   「截断」这一类（`aborted`/`error` 是宿主表达失败回合的通道），故截断保持 `stop`；
   *   合成 finish **不**套用「空内容打上限 → INVALID_REQUEST」——那条只针对厂商真正给出的
   *   终止事件，见 {@link openAiChunks}。
   * @param sawContent - 本流是否产出过内容（含仍缓冲在装配器里的工具调用）。
   * @returns 唯一一条兜底 finish；已有 finish 时为 `[]`。
   * @throws {LlmError} `EMPTY_RESPONSE`：没有终止事件且毫无内容。
   */
  endOfStream(sawContent: boolean): StreamChunk[] {
    if (this.#finished) return [];
    if (!sawContent) {
      throw new LlmError(
        "Open Design API returned an empty response: the stream produced no content and ended without a terminal event",
        EMPTY_RESPONSE_CODE,
      );
    }
    return this.finish({ kind: "stop" });
  }
}

/** Chat Completions 的一行事件。 */
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
    chunks.push(...assembler.finish(mapFinishReason(stringValue(choice.finish_reason), assembler.producedOutput)));
  }
  return chunks;
}

/** 把一行 SSE 文本解析成 chunk（空行、注释、`event:` 行与坏行都跳过）。 */
function decodeLine(assembler: StreamAssembler, line: string): StreamChunk[] {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(":") || trimmed.startsWith("event:")) return [];
  const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (payload === "" || payload === "[DONE]") return [];
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    // 坏行跳过：一条解析不了的诊断行不该终结整条流（与另两家一致）。
    return [];
  }
  if (!isRecord(event)) return [];
  return openAiChunks(assembler, event);
}

/**
 * 把 HTTP 响应体解码成宿主的 chunk 流。
 *
 * 行级解析：逐行 trim，跳过空行/注释/`event:` 行，去掉 `data:` 前缀，忽略 `[DONE]`，
 * 其余按 JSON 解析，解析失败的坏行跳过。调用方负责用 `runStream` 套上时间预算。
 *
 * 正文在终止事件之前结束时（缺 `finish_reason`，即断流）由 {@link StreamAssembler.endOfStream}
 * 收尾：有内容就补一条 finish，**毫无内容**则抛可重试的 `EMPTY_RESPONSE`（空响应不能伪装成
 * 正常收尾）。补发/报错只发生在正常读完整个正文之后；调用方提前 `return()`/中止时生成器
 * 直接走 `finally`，不会补出假 finish。
 * @param body - 响应体；`null`（无响应体）时抛协议错误。
 * @returns 与线上事件同序的 chunk 流。
 */
export async function* decodeStream(body: ReadableStream<Uint8Array> | null): AsyncGenerator<StreamChunk> {
  if (body === null) throw new LlmError("Open Design API returned no response body", "PROVIDER_PROTOCOL_ERROR");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const assembler = new StreamAssembler();
  let buffer = "";
  let sawContent = false;
  const produced = (chunks: readonly StreamChunk[]): readonly StreamChunk[] => {
    for (const chunk of chunks) if (chunkIsContent(chunk)) sawContent = true;
    return chunks;
  };
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done === true) break;
      buffer += decoder.decode(read.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        for (const chunk of produced(decodeLine(assembler, line))) yield chunk;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    for (const chunk of produced(decodeLine(assembler, buffer))) yield chunk;
    // 还没交出的缓冲工具调用同样算内容（它要到 finish 才会变成 chunk）。
    for (const chunk of assembler.endOfStream(sawContent || assembler.hasBufferedToolCall)) yield chunk;
  } finally {
    // 尽力而为：不等取消完成（`runStream` 的超时/中止路径正是靠这一点不被拖住）。
    void reader.cancel().catch(() => {});
  }
}
