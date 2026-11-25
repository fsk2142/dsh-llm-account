import { $ as CREDENTIAL_REF_PATTERN, A as assignUniqueNames, B as disableSettingsAutoForm, C as NOOP_USAGE_PORT, D as modelCandidates, E as invalidateCatalogCandidates, F as recentlyNetworkDown, G as markVolatileFields, H as intentLogFor, I as createCredentialsPort, J as unwrapVolatileConfig, K as optionalStep, L as createRotationAccess, M as hasImageInput, N as pickFallbackModel, O as noteCatalogModels, P as noteNetworkFailure, R as createSettingsIntentStore, S as selectVisible, T as delegateStream, U as isParsedConfig, V as environmentValue, W as isRecord$4, X as writeSwitchSettings, Y as writeModelRules, _ as withRequestDeadline, a as assistantImageText, at as readAccountSlot, b as isModelIdVisible, ct as pickApiKey, d as projectImageBudget, et as accountRef, f as readImageBytes, g as runStream, i as assertProjectableContent, it as moveFirst, j as officialModelName, k as registerCatalogSource, l as fileBlockText, m as LLM_STREAM_IDLE_TIMEOUT, n as applyUsageRemote, nt as dedupeByRef, o as base64Of, ot as reorder, p as LLM_REQUEST_TIMEOUT, q as registerRouteOrExplain, r as createUsagePort, rt as globalOrderOfVendor, s as collectImageBytes, st as normalizeKey, t as SwitchingController, tt as assignModelsToAccount, u as missingImagePlaceholder, v as runAttemptLoop, w as catalogCandidateRevision, x as normalizeVisibility, y as rejection, z as createSettingsPort } from "./switching-Bvjs4Dji.js";
import { n as wireAutoContinue, t as autoContinueEnabledOf } from "./auto-continue-wiring-CdJ6Vfnr.js";
import z from "@deepseek-ai/schemastery";
import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, attributionHeaders, isQuotaExceededError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { createHash, randomUUID } from "node:crypto";
//#region src/core/bounded-body.ts
/**
* **有界**响应体读取：分块累加字节数，超限立刻停读并取消正文。
*
* ## 为什么要有这个模块
*
* 「先 `await response.text()` 再量长度」是同一类缺陷的重复出现：
*
* | 位置 | 发现于 |
* | --- | --- |
* | `vendors/opencode/catalog.ts` | 2026-11-05 外部审查 F05 |
* | `vendors/opencode/oauth.ts` | 2026-11-05 外部审查 F13 |
*
* 两处都是先完整读入内存再检查，而且比的是 `text.length` —— 那是 UTF-16 码元数，
* 不是字节数，中文正文的实际字节数是它的 3 倍。注释写着「byte limit」，放行的
* 是 3 倍额度。
*
* 与其在每个调用点各写一遍，不如共用一份**已经验证过**的实现。这也是
* `docs/HANDOVER-2.0.0.md` §5.5 那条纪律：同一逻辑分散多处，迟早漏一家。
*
* ## 边界
*
* - 按 **UTF-8 字节**算，不是字符串长度；
* - 有 `Content-Length` 时先快速拒绝，不去读必然失败的正文；
* - 分块读，**一超限就 `reader.cancel()`** —— 后面的 chunk 不再索取；
* - 保持 `AbortSignal` 语义：`fetch` 拿到的 signal 仍然管用，本模块只负责读取。
* @module dsh-llm-account/src/core/bounded-body
*/
/**
* 正文超过上限。
*
* 单独一个错误类而不是复用 `LlmError`：调用方对「超限」的处理各不相同
* （目录侧是 `DISCOVERY_FAILED`，OAuth 侧要区分端点语义），让它们自己翻译，
* 比在这里猜语义更安全。
*/
var BodyTooLargeError = class extends Error {
	limit;
	received;
	/**
	* @param limit - 上限（字节）。
	* @param received - 已知的字节数（读了这么多才发现超限，或 `Content-Length` 值）。
	*/
	constructor(limit, received) {
		super(`response body exceeds the ${limit} byte limit (got at least ${received})`);
		this.limit = limit;
		this.received = received;
		this.name = "BodyTooLargeError";
	}
};
/**
* 读一段有界的响应文本。
*
* @param response - 已拿到响应头的响应。
* @param limit - 允许的最大**UTF-8 字节**数。
* @returns 正文文本（可能是空串）。
* @throws {@link BodyTooLargeError} 超过上限时。抛出前已取消正文读取。
*/
async function readBoundedText$1(response, limit) {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > limit) {
		await cancelQuietly(response);
		throw new BodyTooLargeError(limit, declared);
	}
	if (response.body === null) {
		const text = await response.text();
		const bytes = Buffer.byteLength(text, "utf8");
		if (bytes > limit) throw new BodyTooLargeError(limit, bytes);
		return text;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done === true) break;
			if (value === void 0) continue;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				throw new BodyTooLargeError(limit, total);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
/**
* 读一段有界的 JSON 正文，**保留「空」与「非法」的区别**。
* @param response - 已拿到响应头的响应。
* @param limit - 允许的最大 UTF-8 字节数。
* @returns 三态结论。
* @throws {@link BodyTooLargeError} 超过上限时。
*/
async function readBoundedJsonResult(response, limit) {
	const text = await readBoundedText$1(response, limit);
	if (text.trim() === "") return { kind: "empty" };
	try {
		return {
			kind: "json",
			value: JSON.parse(text)
		};
	} catch {
		return { kind: "invalid" };
	}
}
/**
* 读一段有界的 JSON 正文（折叠版）。
*
* 空正文与非法 JSON 都返回 `undefined`。需要区分两者时用
* {@link readBoundedJsonResult}。
* @param response - 已拿到响应头的响应。
* @param limit - 允许的最大 UTF-8 字节数。
* @returns 解析后的值；空正文或非法 JSON 时 `undefined`。
* @throws {@link BodyTooLargeError} 超过上限时。
*/
async function readBoundedJson(response, limit) {
	const result = await readBoundedJsonResult(response, limit);
	return result.kind === "json" ? result.value : void 0;
}
/**
* 尽力取消正文；失败不影响调用方的结论（连接可能已经关了）。
* @param response - 要取消的响应。
*/
async function cancelQuietly(response) {
	try {
		await response.body?.cancel();
	} catch {}
}
//#endregion
//#region src/vendors/opencode/session.ts
/**
* OpenCode Go 的**会话标识**请求头（2026-11-02 真机报障）。
*
* ## 为什么必须带
*
* 真机返回：
*
* ```
* 400: {"type":"MissingSessionID",
*       "message":"Request is missing x-opencode-session and cannot be routed
*                  efficiently. Please see
*                  https://opencode.ai/v2/docs/console/go/#where-can-i-use-it"}
* ```
*
* 官方文档「Where can I use it?」对客户端的要求（3 条）：
*
* 1. 发典型的编码 agent 流量；
* 2. 用**自己的** user agent 标识自己（不是通用 SDK 名）—— 宿主的
*    `attributionHeaders()` 已经给了 `deepseek-harness/<version> (+url)`，满足；
* 3. **在 `x-opencode-session` 里为每个会话发一个稳定的 ID**，用于路由与
*    prompt caching 优化。
*
* 缺这个头时网关直接 400，请求根本到不了模型。
*
* ## 取值
*
* 优先用宿主给的 `sessionId`（DSH 每个会话一个，天然稳定且按会话隔离）。
* 会话 id 缺失时（辅助调用：标题生成、compaction）退回**进程级稳定 id** ——
* 宁可所有辅助请求共用一个 id，也不要每发一次就换一个（那会破坏缓存）。
*
* @module dsh-llm-account/src/vendors/opencode/session
*/
/** 请求头名字（与网关要求一致）。 */
const OPENCODE_SESSION_HEADER = "x-opencode-session";
/**
* 进程级兜底会话 id。
*
* 只在调用方给不出会话 id 时使用。必须是**常量**（每次请求现生成会破坏路由与缓存）。
*/
const PROCESS_SESSION_ID = randomUUID();
/**
* 造 `x-opencode-session` 头。
*
* 值会做一次白名单清洗：HTTP 头不能含控制字符/空格，而宿主 id 理论上可能是
* `session/<uuid>` 这类带分隔符的形态 —— 只保留 `A-Za-z0-9._-`，清洗后为空就退回
* 进程级 id。
* @param sessionId - 宿主的会话 id（可空）。
* @returns 可直接合并进请求头的对象。
*/
function opencodeSessionHeaders(sessionId) {
	const safe = (typeof sessionId === "string" ? sessionId.trim() : "").replace(/[^A-Za-z0-9._-]/gu, "");
	return { [OPENCODE_SESSION_HEADER]: safe.length > 0 ? safe : PROCESS_SESSION_ID };
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js
var FifoQueue = class {
	incoming = [];
	outgoing = [];
	get length() {
		return this.incoming.length + this.outgoing.length;
	}
	enqueue(value) {
		this.incoming.push(value);
	}
	dequeue() {
		if (this.outgoing.length === 0) while (this.incoming.length > 0) this.outgoing.push(this.incoming.pop());
		return this.outgoing.pop();
	}
};
var EventStream = class {
	queue = new FifoQueue();
	waiting = new FifoQueue();
	done = false;
	finalResultPromise;
	resolveFinalResult;
	isComplete;
	extractResult;
	constructor(isComplete, extractResult) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}
	push(event) {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.dequeue();
		if (waiter) waiter({
			value: event,
			done: false
		});
		else this.queue.enqueue(event);
	}
	end(result) {
		this.done = true;
		if (result !== void 0) this.resolveFinalResult(result);
		while (this.waiting.length > 0) this.waiting.dequeue()({
			value: void 0,
			done: true
		});
	}
	async *[Symbol.asyncIterator]() {
		while (true) if (this.queue.length > 0) yield this.queue.dequeue();
		else if (this.done) return;
		else {
			const result = await new Promise((resolve) => this.waiting.enqueue(resolve));
			if (result.done) return;
			yield result.value;
		}
	}
	result() {
		return this.finalResultPromise;
	}
};
/**
* Event stream of one assistant response. It also times the response: the final message (`done` or `error` event, or
* the result passed to `end()`) gets `durationMs`, measured with a monotonic clock from the stream's creation, unless
* the message already has one or its `timestamp` predates the stream. A stream that forwards a response which started
* elsewhere, such as a deferred result fetched later, therefore leaves it untimed.
*/
var AssistantMessageEventStream = class extends EventStream {
	#startedAt = Date.now();
	#startedAtMonotonic = performance.now();
	constructor() {
		super((event) => event.type === "done" || event.type === "error", (event) => {
			if (event.type === "done") return event.message;
			else if (event.type === "error") return event.error;
			throw new Error("Unexpected event type for final result");
		});
	}
	push(event) {
		if (event.type === "done") this.#time(event.message);
		else if (event.type === "error") this.#time(event.error);
		super.push(event);
	}
	end(result) {
		if (result !== void 0) this.#time(result);
		super.end(result);
	}
	#time(message) {
		if (this.done || message.durationMs !== void 0 || message.timestamp < this.#startedAt) return;
		message.durationMs = Math.max(0, Math.round(performance.now() - this.#startedAtMonotonic));
	}
};
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/api/lazy.js
function createSetupErrorMessage(model, error, timestamp) {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0
			}
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp
	};
}
function hasResult(source) {
	return typeof source.result === "function";
}
async function forwardStream(target, source) {
	for await (const event of source) target.push(event);
	target.end(hasResult(source) ? await source.result() : void 0);
}
/**
* Returns a stream synchronously while running async setup (auth resolution,
* lazy module loading) behind it. Setup failures terminate the stream with an
* error event.
*/
function lazyStream(model, setup) {
	const startedAt = Date.now();
	const outer = new AssistantMessageEventStream();
	setup().then((inner) => forwardStream(outer, inner)).catch((error) => {
		const message = createSetupErrorMessage(model, error, startedAt);
		outer.push({
			type: "error",
			reason: "error",
			error: message
		});
		outer.end(message);
	});
	return outer;
}
function lazyApi(load, capabilities) {
	const api = {
		stream: (model, context, options) => lazyStream(model, async () => (await load()).stream(model, context, options)),
		streamSimple: (model, context, options) => lazyStream(model, async () => (await load()).streamSimple(model, context, options))
	};
	if (capabilities?.fetchDeferred) api.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = await load();
		if (!implementation.fetchDeferred) throw new Error("API does not support deferred responses");
		return implementation.fetchDeferred(model, handle, options);
	});
	if (capabilities?.cancelDeferred) api.cancelDeferred = async (model, handle, options) => {
		const implementation = await load();
		if (!implementation.cancelDeferred) throw new Error("API cannot cancel deferred responses");
		await implementation.cancelDeferred(model, handle, options);
	};
	return api;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/diagnostics.js
function formatThrownValue(value) {
	if (value instanceof Error) return value.message || value.name;
	if (typeof value === "string") return value;
	return String(value);
}
function appendAssistantMessageDiagnostic(message, diagnostic) {
	message.diagnostics = [...message.diagnostics ?? [], diagnostic];
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/models-error.js
var ModelsError = class extends Error {
	code;
	constructor(code, message, options) {
		super(withCauseDetail(message, options?.cause), options);
		this.name = "ModelsError";
		this.code = code;
	}
};
/** Callers surface `error.message` only, so keep the underlying reason in it. */
function withCauseDetail(message, cause) {
	if (cause === void 0 || cause === null) return message;
	const detail = formatThrownValue(cause).trim();
	if (!detail || message.includes(detail)) return message;
	return `${message}: ${detail}`;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/model-operations.js
/** The type of a model. Models without `type` are chat models. */
function getModelType(model) {
	return model.type ?? "chat";
}
/** Runtime-checked model type narrowing, including legacy chat models without `type`. */
function isModelType(model, type) {
	return getModelType(model) === type;
}
function imageErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
function classifierErrorResult(model, error, aborted = false) {
	return {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now()
	};
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/text.js
/** Extract and join text from message content. */
function contentText(content, separator = "\n") {
	if (typeof content === "string") return content;
	return content.filter((block) => block.type === "text").map((block) => block.text).join(separator);
}
/** Render a system message as a complete prompt: its content followed by its sections. */
function getSystemMessageText(message) {
	const parts = [contentText(message.content)];
	for (const text of Object.values(message.sections ?? {})) if (text !== null) parts.push(text);
	return parts.filter((part) => part.length > 0).join("\n\n");
}
/**
* Render a later system message for APIs that accept system messages mid-conversation.
* Section changes are framed by name so the model can relate them to the leading prompt.
* This framing is request-time only and may change between versions.
*/
function renderSystemMessageUpdate(message) {
	const parts = [];
	const text = contentText(message.content);
	if (text.length > 0) parts.push(text);
	for (const [name, value] of Object.entries(message.sections ?? {})) parts.push(value === null ? `Removed system prompt section "${name}".` : `Updated system prompt section "${name}":\n\n${value}`);
	return parts.join("\n\n");
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js
/**
* Build the leading system message for a prompt and tool set. Returns undefined when
* both are empty, so an empty transcript stays empty.
*/
function createInitialSystemMessage(systemPrompt, tools) {
	const hasSystemPrompt = systemPrompt !== void 0 && systemPrompt.length > 0;
	const hasTools = tools !== void 0 && tools.length > 0;
	if (!hasSystemPrompt && !hasTools) return void 0;
	return {
		role: "system",
		content: systemPrompt ?? "",
		...hasTools ? { toolsAdded: tools } : {},
		timestamp: 0
	};
}
/**
* Fold `Context.systemPrompt` and `Context.tools` into a leading system message.
* This is the only entry point that produces a {@link TranscriptContext}; every
* provider-facing function expects the result.
*/
function normalizeContext(context) {
	const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
	return { messages: initialMessage ? [initialMessage, ...context.messages] : context.messages };
}
function isSystemMessage(message) {
	return message.role === "system";
}
/** Return the leading system message, if the transcript starts with one. */
function getInitialSystemMessage(messages) {
	const first = messages[0];
	return first && isSystemMessage(first) ? first : void 0;
}
/** Resolve the tools available after applying every transcript delta in order. */
function getCurrentTools(messages) {
	const tools = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}
	return [...tools.values()];
}
/**
* Replay every system message into one leading system message holding the current
* prompt and tools. Later `content` is appended to the base prompt, `sections` are
* patched by name, and tools are resolved with {@link getCurrentTools}.
*/
function getCurrentSystemMessage(messages) {
	const content = [];
	const sections = /* @__PURE__ */ new Map();
	let timestamp;
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		timestamp ??= message.timestamp;
		const text = contentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) if (value === null) sections.delete(name);
		else sections.set(name, value);
	}
	const tools = getCurrentTools(messages);
	if (timestamp === void 0 && tools.length === 0) return void 0;
	return {
		role: "system",
		content: content.join("\n\n"),
		...sections.size > 0 ? { sections: Object.fromEntries(sections) } : {},
		...tools.length > 0 ? { toolsAdded: tools } : {},
		timestamp: timestamp ?? 0
	};
}
/**
* Rebuild the transcript for APIs without mid-conversation system messages: the replayed
* system message leads, and every later system message is dropped.
*/
function collapseSystemMessages(context) {
	const head = getCurrentSystemMessage(context.messages);
	const messages = context.messages.filter((message) => message.role !== "system");
	return { messages: head ? [head, ...messages] : messages };
}
/** Keep later system messages in place when the model accepts them; otherwise collapse them. */
function resolveTranscript(context, supportsMidConvoSystemMessages) {
	return supportsMidConvoSystemMessages ? context : collapseSystemMessages(context);
}
/** Every definition referenced by transcript tool state, in first-declaration order. */
function getDeclaredTools(messages) {
	const definitions = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of message.toolsAdded ?? []) definitions.set(tool.name, tool);
	}
	return [...definitions.values()];
}
/** Whether tool history contains a removal or same-name redeclaration that an addition-only transport cannot replay. */
function hasNonAdditiveToolChanges(messages) {
	const declared = /* @__PURE__ */ new Set();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		if ((message.toolsRemoved?.length ?? 0) > 0) return true;
		for (const tool of message.toolsAdded ?? []) {
			if (declared.has(tool.name)) return true;
			declared.add(tool.name);
		}
	}
	return false;
}
/**
* Split tool declarations between the top-level request field and in-place additions.
* Transports that can anchor additions at a system message keep the initial tools at the
* top and load later ones where they appear; that only works when no tool was removed or
* redeclared, so everything else sends the current tool list.
*/
function resolveTranscriptTools(messages, supportsToolAdditions) {
	const anchorsAdditions = supportsToolAdditions && !hasNonAdditiveToolChanges(messages);
	return {
		requestTools: anchorsAdditions ? getInitialSystemMessage(messages)?.toolsAdded ?? [] : getCurrentTools(messages),
		anchorsAdditions
	};
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/models.js
const KNOWN_MODEL_TYPES = {
	chat: true,
	image: true,
	classifier: true
};
/** Models from stores and remote sources may have types that only newer versions know. */
function hasKnownModelType(model) {
	return Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));
}
/**
* Builds a provider from parts. Built-in provider factories and models.json
* custom providers both go through this. A single `api` streams all chat
* models; an `api` map dispatches on `model.api`, and a model whose api has
* no entry produces a stream error. One-shot operation maps dispatch on
* `model.api` the same way. At least one concrete implementation across
* `api`/`images`/`classifiers` is required; empty maps are rejected.
*/
function createProvider(input) {
	const single = input.api && typeof input.api.stream === "function" ? input.api : void 0;
	const byApi = single || !input.api ? void 0 : input.api;
	const images = input.images;
	const classifiers = input.classifiers;
	const streams = single ? [single] : Object.values(byApi ?? {}).filter((entry) => entry !== void 0);
	const imageImplementations = Object.values(images ?? {}).filter((entry) => entry !== void 0);
	const classifierImplementations = Object.values(classifiers ?? {}).filter((entry) => entry !== void 0);
	if (streams.length === 0 && imageImplementations.length === 0 && classifierImplementations.length === 0) throw new Error(`Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`);
	const baselineModels = input.models;
	let dynamicModels = [];
	const fetchModels = input.fetchModels;
	const currentModels = () => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex((entry) => getModelType(entry) === getModelType(model) && entry.id === model.id);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	const apiFor = (model) => single ?? byApi?.[model.api];
	const dispatch = (model, run) => {
		const streams = apiFor(model);
		if (!streams) return lazyStream(model, async () => {
			throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
		});
		return run(streams);
	};
	const provider = {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: () => currentModels().filter((model) => isModelType(model, "chat")),
		getAllModels: currentModels,
		refreshModels: fetchModels ? async (context) => {
			if (context.stored) {
				const restored = context.stored.models.filter((model) => model.provider === input.id).map((model) => model);
				if (!await context.publish({ update: () => {
					dynamicModels = restored;
				} })) return;
			}
			if (!context.allowNetwork || context.signal.aborted) return;
			const fetched = await fetchModels(context);
			if (context.signal.aborted) return;
			const refreshed = fetched.filter(hasKnownModelType);
			await context.publish({
				persist: {
					models: refreshed,
					checkedAt: Date.now()
				},
				update: () => {
					dynamicModels = refreshed;
				}
			});
		} : void 0,
		filterModels: input.filterModels,
		filterAllModels: input.filterAllModels,
		stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
		streamSimple: (model, context, options) => dispatch(model, (streams) => streams.streamSimple(model, context, options))
	};
	if (streams.some((entry) => entry.fetchDeferred !== void 0)) provider.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
		const implementation = apiFor(model);
		if (!implementation?.fetchDeferred) throw new ModelsError("provider", `Provider ${input.id} does not support deferred responses for "${model.api}"`);
		return implementation.fetchDeferred(model, handle, options);
	});
	if (streams.some((entry) => entry.cancelDeferred !== void 0)) provider.cancelDeferred = async (model, handle, options) => {
		const implementation = apiFor(model);
		if (!implementation?.cancelDeferred) throw new ModelsError("provider", `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`);
		await implementation.cancelDeferred(model, handle, options);
	};
	if (images && imageImplementations.length > 0) provider.generateImages = async (model, context, options) => {
		const implementation = images[model.api];
		if (!implementation) return imageErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no image generation implementation for "${model.api}"`));
		return implementation.generateImages(model, context, options);
	};
	if (classifiers && classifierImplementations.length > 0) provider.classify = async (model, context, options) => {
		const implementation = classifiers[model.api];
		if (!implementation) return classifierErrorResult(model, new ModelsError("provider", `Provider ${input.id} has no classifier implementation for "${model.api}"`));
		return implementation.classify(model, context, options);
	};
	return provider;
}
function calculateCost(model, usage) {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates = model.cost;
	let matchedThreshold = -1;
	for (const tier of model.cost.tiers ?? []) if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
		rates = tier;
		matchedThreshold = tier.inputTokensAbove;
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = rates.input / 1e6 * usage.input;
	usage.cost.output = rates.output / 1e6 * usage.output;
	usage.cost.cacheRead = rates.cacheRead / 1e6 * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1e6;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
const EXTENDED_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function getSupportedThinkingLevels(model) {
	if (!model.reasoning) return ["off"];
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== void 0;
		return true;
	});
}
function clampThinkingLevel(model, level) {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level)) return level;
	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";
	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js
/**
* Regex patterns to detect context overflow errors from different providers.
*
* These patterns match error messages returned when the input exceeds
* the model's context window.
*
* Provider-specific patterns (with example error messages):
*
* - Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
* - Anthropic: "413 {\"error\":{\"type\":\"request_too_large\",\"message\":\"Request exceeds the maximum size\"}}"
* - OpenAI: "Your input exceeds the context window of this model"
* - OpenAI/LiteLLM: "Requested token count exceeds the model's maximum context length of 131072 tokens"
* - OpenAI-compatible: "Input length (265330) exceeds model's maximum context length (262144)."
* - Google: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)"
* - xAI: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
* - Groq: "Please reduce the length of the messages or completion"
* - OpenRouter: "This endpoint's maximum context length is X tokens. However, you requested about Y tokens"
* - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
* - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
* - llama.cpp: "the request exceeds the available context size, try increasing it"
* - LM Studio: "tokens to keep from the initial prompt is greater than the context length"
* - GitHub Copilot: "prompt token count of X exceeds the limit of Y"
* - MiniMax: "invalid params, context window exceeds limit"
* - Kimi For Coding: "Your request exceeded model token limit: X (requested: Y)"
* - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
* - Cerebras: "400/413 status code (no body)"
* - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
* - z.ai: `{"code":"1261","message":"Prompt too long"}`, `{"code":"1261","message":"Prompt exceeds max length"}` (CN endpoint), or silent overflow via usage.input > contextWindow
* - Xiaomi MiMo: Truncates input to fill contextWindow exactly, then returns finish_reason "length"
*   with output=0 (no room left to generate). Detected via stopReason "length" + zero output +
*   input filling the context window.
* - DashScope/Qwen: "Range of input length should be [1, X]" (HTTP 400 invalid_parameter_error)
* - Ollama: Some deployments truncate silently, others return errors like "prompt too long; exceeded max context length by X tokens"
*/
const OVERFLOW_PATTERNS = [
	/prompt (?:is )?too long/i,
	/prompt exceeds max length/i,
	/request_too_large/i,
	/input is too long for requested model/i,
	/exceeds the context window/i,
	/exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
	/input token count.*exceeds the maximum/i,
	/maximum prompt length is \d+/i,
	/reduce the length of the messages/i,
	/maximum context length is \d+ tokens/i,
	/exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
	/input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
	/exceeds the limit of \d+/i,
	/exceeds the available context size/i,
	/greater than the context length/i,
	/context window exceeds limit/i,
	/exceeded model token limit/i,
	/too large for model with \d+ maximum context length/i,
	/prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
	/model_context_window_exceeded/i,
	/prompt too long; exceeded (?:max )?context length/i,
	/range of input length should be/i,
	/context[_ ]length[_ ]exceeded/i,
	/too many tokens/i,
	/token limit exceeded/i
];
const CEREBRAS_BODYLESS_OVERFLOW_PATTERN = /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i;
/**
* Patterns that indicate non-overflow errors (e.g. rate limiting, server errors).
* Error messages matching any of these are excluded from overflow detection
* even if they also match an OVERFLOW_PATTERN.
*
* Example: Bedrock formats throttling errors as "ThrottlingException: Too many tokens,
* please wait before trying again." which would match the /too many tokens/i overflow
* pattern without this exclusion.
*/
const NON_OVERFLOW_PATTERNS = [
	/^(Throttling error|Service unavailable):/i,
	/rate limit/i,
	/too many requests/i
];
/**
* Check if an assistant message represents a context overflow error.
*
* This handles three cases:
* 1. Error-based overflow: Most providers return stopReason "error" with a
*    specific error message pattern.
* 2. Silent overflow: Some providers accept overflow requests and return
*    successfully. For these, we check if usage.input exceeds the context window.
* 3. Length-stop overflow: Xiaomi MiMo can return "length" with zero output when
*    the input fills the context window.
*
* ## Reliability by Provider
*
* **Reliable detection (returns error with detectable message):**
* - Anthropic: "prompt is too long: X tokens > Y maximum" or "request_too_large"
* - OpenAI (Completions & Responses): "exceeds the context window", "exceeds the model's maximum context length of X tokens", or "exceeds model's maximum context length (X)"
* - Google Gemini: "input token count exceeds the maximum"
* - xAI (Grok): "maximum prompt length is X but request contains Y"
* - Groq: "reduce the length of the messages"
* - Cerebras: 400/413 status code (no body)
* - Mistral: "Prompt contains X tokens ... too large for model with Y maximum context length"
* - OpenRouter (most backends): "maximum context length is X tokens"
* - OpenRouter/Poolside: "Input length X exceeds the maximum allowed input length of Y tokens."
* - Together AI: "The input (X tokens) is longer than the model's context length (Y tokens)."
* - llama.cpp: "exceeds the available context size"
* - LM Studio: "greater than the context length"
* - Kimi For Coding: "exceeded model token limit: X (requested: Y)"
* - DS4: "Prompt has X tokens, but the configured context size is Y tokens"
* - DashScope/Qwen: "Range of input length should be [1, X]"
* - z.ai: "Prompt too long"
*
* **Unreliable detection:**
* - z.ai: Sometimes accepts overflow silently (detectable via usage.input > contextWindow),
*   sometimes returns rate limit errors. Pass contextWindow param to detect silent overflow.
* - Xiaomi MiMo: Truncates input to fit contextWindow then returns stopReason "length" with
*   output=0. Pass contextWindow param to detect via the "filled context + zero output" signal.
* - Ollama: May truncate input silently for some setups, but may also return explicit
*   overflow errors that match the patterns above. Silent truncation still cannot be
*   detected here because we do not know the expected token count.
*
* ## Custom Providers
*
* If you've added custom models via settings.json, this function may not detect
* overflow errors from those providers. To add support:
*
* 1. Send a request that exceeds the model's context window
* 2. Check the errorMessage in the response
* 3. Create a regex pattern that matches the error
* 4. The pattern should be added to OVERFLOW_PATTERNS in this file, or
*    check the errorMessage yourself before calling this function
*
* @param message - The assistant message to check
* @param contextWindow - Optional context window size for detecting silent overflow (z.ai)
* @returns true if the message indicates a context overflow
*/
function isContextOverflow(message, contextWindow) {
	if (message.stopReason === "error" && message.errorMessage) {
		if (!NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage))) {
			if (OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage))) return true;
			if (message.provider === "cerebras" && CEREBRAS_BODYLESS_OVERFLOW_PATTERN.test(message.errorMessage)) return true;
		}
	}
	if (contextWindow && message.stopReason === "stop") {
		if (message.usage.input + message.usage.cacheRead > contextWindow) return true;
	}
	if (contextWindow && message.stopReason === "length" && message.usage.output === 0) {
		if (message.usage.input + message.usage.cacheRead >= contextWindow * .99) return true;
	}
	return false;
}
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.lazy.js
const anthropicMessagesApi = () => lazyApi(() => import("./anthropic-messages-06xIl2sp.js").then((n) => n.t));
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js
const openAICompletionsApi = () => lazyApi(() => import("./openai-completions-DBAg6bdT.js"));
//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-ai@1.1.0_512fb1bd2ed45f93db4357e841872ab3/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.lazy.js
const openAIResponsesApi = () => lazyApi(() => import("./openai-responses--CiFcP-L.js"));
//#endregion
//#region src/vendors/opencode/protocol.ts
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
/** 网关默认基地址（旧插件 `src/catalog.ts` 第 6408 行）。 */
const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
/** 目录端点路径（旧插件第 6463 行 `${baseURL}/models`）。 */
const MODELS_PATH = "/models";
/** 模型元数据来源（旧插件 `MODEL_METADATA_URL` 第 6104 行）。 */
const MODEL_METADATA_URL = "https://models.dev/api.json";
/** pi-ai 里这条网关的 provider 标识（旧插件 `SDK_PROVIDER_ID`，数据文件里的 `provider`）。 */
const SDK_PROVIDER_ID = "opencode-go";
/** 目录请求预算（旧插件 `MODELS_FETCH_TIMEOUT_MS` 第 6409 行）。 */
const MODELS_FETCH_TIMEOUT_MS = 1e4;
/** 一次目录请求最多读多少字节（旧插件 `MODEL_LISTING_MAX_BYTES` 第 6412 行）。 */
const MODELS_MAX_BYTES = 1048576;
/** 元数据响应最多读多少字节。 */
const METADATA_MAX_BYTES = 8388608;
/** 错误正文最多读多少字符（旧插件 `MAX_BODY_BYTES` 第 7073 行同样封顶 16 KiB）。 */
const ERROR_BODY_LIMIT = 16384;
/** 默认目录 TTL（旧插件 `refreshMs` 的默认值在配置层，这里取同一量级的内存 TTL）。 */
const DEFAULT_CATALOG_TTL_MS = 3e5;
/** 默认整请求 deadline（旧插件配置默认值 `requestTimeoutMs`）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e5;
/** 默认流空闲看门狗（旧插件配置默认值 `streamIdleTimeoutMs`）。 */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** 未指定 `maxTokens` 时的输出上限；再受模型自报上限收紧（旧插件第 7626 行）。 */
const DEFAULT_GENERATE_MAX_TOKENS = 131072;
/**
* 读一段诊断正文的期限（旧插件 `BODY_READ_TIMEOUT_MS` 第 7074 行，同为 1000 ms）。
*
* 这个上限是**必需**的：`await gateway.evidence()` 发生在 `runStream` 清掉自己的定时器之后，
* 一条不肯结束的错误正文会把整次请求无限期挂住（只有调用方中止能解开）。
*/
const BODY_READ_TIMEOUT_MS = 1e3;
/** 旧插件第 6188 行的 npm 包名 → 线协议映射。 */
function apiForNpm(npm) {
	if (npm === "@ai-sdk/anthropic") return "anthropic-messages";
	if (npm === "@ai-sdk/openai") return "openai-responses";
	if (npm === "@ai-sdk/openai-compatible") return "openai-completions";
}
/**
* 基地址是否落在 `opencode.ai` 域（含子域）。发现请求只认这个域：旧插件对别的地址
* 直接拒（`DISCOVERY_UNSUPPORTED`，第 8662-8665 行）。
* @param baseUrl - 待检查的基地址。
* @returns 是否属于 `opencode.ai`。
*/
function isOpencodeHost(baseUrl) {
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
function assertOpencodeBase(baseUrl) {
	if (!isOpencodeHost(baseUrl)) throw new LlmError(`llm-opencode-go: model discovery is only supported for the opencode.ai domain, not ${baseUrl}`, "DISCOVERY_UNSUPPORTED");
}
/** 去掉基地址末尾的斜杠（旧插件第 6463 行同样归一化）。 */
function trimBase(baseUrl) {
	return baseUrl.replace(/\/+$/, "");
}
/**
* 目录请求（旧插件 `fetchLiveModelIds` 第 6462-6472 行）。
*
* ## 为什么现在带 Authorization（2026-11-08）
*
* 旧插件与第一版实现都**不带** Bearer，理由是「目录是公开信息」。实测确实如此 ——
* 但不带凭据拿到的是**全部 30 个模型**，而这个账号实际订阅的只有 **6 个**：
*
* ```
* 无凭据：30 个（含 claude-haiku-5-5 / gpt-6-luna / kimi-k3 … 这些用不了的）
* 带凭据： 6 个（真正可用的那批）
* ```
*
* 后果是设置页的勾选列表里躺着一堆**选中也发不出去**的模型。实际现象是
* 「连天界面那里，现在好像又出来了」 —— 上下文本身是另一处的问题，但这条清单
* 一直在误导「哪些模型能用」。
*
* 少给凭据 ≠ 更安全：这条请求与推理走**同一个网关、同一把 key**，而推理请求本来就要带它。
* @param baseUrl - 网关基地址。
* @param key - 推理密钥；缺省时退回无鉴权（端点会回公开清单，不至于整个目录读不到）。
* @returns URL 与请求头。
*/
function catalogRequest(baseUrl, key) {
	return {
		url: `${trimBase(baseUrl)}${MODELS_PATH}`,
		headers: {
			accept: "application/json",
			"accept-encoding": "identity",
			...opencodeSessionHeaders(),
			...key === void 0 || key === "" ? {} : { Authorization: `Bearer ${key}` },
			...attributionHeaders()
		}
	};
}
/**
* 元数据请求（旧插件 `refreshMetadata` 第 6603-6611 行）。
* @returns URL 与请求头。
*/
function metadataRequest() {
	return {
		url: MODEL_METADATA_URL,
		headers: {
			accept: "application/json",
			...attributionHeaders()
		}
	};
}
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
async function previewBody(response, callerSignal) {
	const signal = callerSignal === void 0 ? AbortSignal.timeout(BODY_READ_TIMEOUT_MS) : AbortSignal.any([callerSignal, AbortSignal.timeout(BODY_READ_TIMEOUT_MS)]);
	let reader;
	let text = "";
	let truncated = false;
	try {
		signal.throwIfAborted();
		reader = response.clone().body?.getReader();
		if (reader !== void 0) {
			const decoder = new TextDecoder();
			const aborted = new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
			for (;;) {
				const part = await Promise.race([reader.read(), aborted]);
				if (part.done === true) break;
				text += decoder.decode(part.value, { stream: true });
				if (text.length >= 16384) {
					truncated = true;
					break;
				}
			}
			if (!truncated) text += decoder.decode();
		}
	} catch {} finally {
		if (reader !== void 0) reader.cancel().catch(() => {});
	}
	const bounded = text.slice(0, ERROR_BODY_LIMIT);
	if (bounded.trim() === "") return void 0;
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
function recordGatewayFetch(fetchImpl, callerSignal) {
	let evidence = Promise.resolve(void 0);
	const wrapped = (async (input, init) => {
		const response = await fetchImpl(input, init);
		if (!response.ok) evidence = previewBody(response, callerSignal).then((body) => ({
			status: response.status,
			body
		}));
		return response;
	});
	return {
		fetch: wrapped,
		reset() {
			evidence = Promise.resolve(void 0);
		},
		evidence() {
			return evidence;
		}
	};
}
/**
* 一次尝试失败时抛出的原始证据载体。
*
* 刻意不是 `LlmError`：它承载 pi-ai 的错误文案，HTTP 状态与正文由
* {@link GatewayRecorder} 提供；适配器把两者合起来才能分类（与 commandcode 的
* `CommandCodeStreamFailure` 同一角色）。
*/
var OpencodeStreamFailure = class extends Error {
	/** pi-ai 观察到的 HTTP 状态；事件里没带时为 `0`。 */
	status;
	/** pi-ai 给出的错误正文（通常只有文案）。 */
	body;
	/**
	* @param status - HTTP 状态；未知为 `0`。
	* @param body - 原始错误正文。
	* @param message - pi-ai 的错误文案。
	*/
	constructor(status, body, message) {
		super(message);
		this.name = "OpencodeStreamFailure";
		this.status = status;
		this.body = body;
	}
};
/**
* 把目录事实装成 pi-ai 的 `Model`（旧插件第 6227-6246 行的 `readModelMetadata` 产出的
* 同一形状；`cost` 全 0 —— 费用估算属第 2 期，这里只需要形状成立）。
* @param facts - 目录事实与基地址。
* @param baseUrl - 网关基地址。
* @returns pi-ai 模型描述。
*/
function buildPiModel(facts, baseUrl) {
	const base = trimBase(baseUrl);
	return {
		id: facts.id,
		name: facts.name,
		api: facts.api,
		provider: SDK_PROVIDER_ID,
		baseUrl: facts.api === "anthropic-messages" ? base.replace(/\/v1$/, "") : base,
		reasoning: facts.reasoning,
		/**
		* **档位映射：只映射厂商真正公布的那些档位**（同名，`max` → `max`）。
		*
		* 为什么必须有：pi-ai 的 `getSupportedThinkingLevels` 把 `max` / `xhigh` 当作
		* 「只有显式出现在这里才算支持」，不在表里 `clampThinkingLevel` 就把它降级成邻近档位
		* —— 实测界面选 `max`、实际发出去的是 `high`（2026-11-03 报障）。
		*
		* 为什么不写全：给模型塞它没有的档位等于谎报能力。deepseek-v4.1-flash 的网关只公布
		* `low` / `high` / `max`，那就只映射这三个；`minimal` / `medium` / `xhigh` 一概不写。
		* 用户选的档位若不在表里，SDK 会按它的规则就近取一个 —— 但那种「档位本来就不存在」，
		* 与「存在却被改写」是两回事，后者才是这次的 bug。
		*/
		...facts.efforts === void 0 ? {} : { thinkingLevelMap: Object.fromEntries(facts.efforts.map((level) => [level, level])) },
		/**
		* **按协议把「档位」接到该协议真正读取的地方**（外部审查 U06；两条线都支持）。
		*
		* pi-ai 的两个协议各有自己的开关，缺一个档位就发不出去：
		*
		* | 协议 | 请求里的落点 | 需要的开关 |
		* | --- | --- | --- |
		* | `anthropic-messages` | `output_config.effort` | `compat.forceAdaptiveThinking: true` |
		* | `openai-completions` | `reasoning_effort` | `compat.supportsReasoningEffort`（默认 true）|
		* | `openai-responses` | `reasoning.effort` | 同上 |
		*
		* **anthropic 那条尤其隐蔽**：不设 `forceAdaptiveThinking` 时它走
		* budget-based 分支（`thinkingBudgetTokens`），档位被**完全忽略** ——
		* 无论选 `low` 还是 `max`，出站正文里既没有 `reasoning_effort`
		* 也没有 `output_config`。这正是审查 U06 的现象。
		*
		* openai 那条路线默认 `supportsReasoningEffort: true`，但会被
		* `isGrok` / `isZai` / `isMoonshot` / `isTogether` 等判断关掉；显式置 true
		* 才是「我们声明了这个模型有可选档位」的一致表达。
		*
		* 只在**该模型声明了档位**时才设：没有档位就没有 effort 可表达，
		* 给不支持的模型塞字段只会被厂商拒。
		*/
		...facts.efforts === void 0 ? {} : { compat: {
			forceAdaptiveThinking: true,
			supportsReasoningEffort: true
		} },
		input: [...facts.inputModalities],
		contextWindow: facts.contextWindow ?? 1e6,
		maxTokens: facts.maxTokens ?? 131072,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		}
	};
}
/** 把系统提示折叠成一段文本（旧插件 `splitSystemPrompt` 的同一规则）。 */
function systemTextOf(options) {
	const parts = [];
	if (options.system !== void 0 && options.system !== "") parts.push(options.system);
	for (const message of options.messages) {
		if (message.role !== "system" && message.role !== "developer") continue;
		const text = textOf(message.content);
		if (text !== "") parts.push(text);
	}
	return parts.join("\n\n");
}
/** System/developer text includes explicit file handles; images are checked at entry. */
function textOf(content) {
	const parts = [];
	for (const block of content) if (block.type === "text") parts.push(block.text);
	else if (block.type === "file") parts.push(fileBlockText(block));
	return parts.join("");
}
/** 工具的 arguments 是原始 JSON 字符串，pi-ai 要对象（旧插件 `parseArguments` 第 1042-1051 行）。 */
function parseArguments(raw) {
	try {
		const parsed = JSON.parse(raw);
		return isRecord$3(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
/** 工具声明（旧插件第 1518 行把 `ToolSchema.parameters` 直接当 TSchema 传下去）。 */
function toPiTool(tool) {
	return {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
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
/**
* 把用户消息的内容块投影成 pi-ai 的形状：文本 + 图片（2026-11-04 外部审查 U07）。
*
* Anthropic 的图片形状是：
*
* ```json
* { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "…" } }
* ```
*
* 取不到字节或已被 offloaded 时发**占位文本** —— 两者都不许静默丢弃：
* 审查的原话是「流仍正常完成，用户无法知道模型没收到图」。
* @param content - 宿主的消息内容块。
* @param images - 已取到字节的图片（按 attachment id）。
* @returns pi-ai 的内容块数组。
*/
function piInputContent(content, images) {
	const blocks = [];
	for (const block of content) {
		if (block.type === "text") {
			if (block.text !== "") blocks.push({
				type: "text",
				text: block.text
			});
			continue;
		}
		if (block.type === "file") {
			blocks.push({
				type: "text",
				text: fileBlockText(block)
			});
			continue;
		}
		if (block.type !== "image") continue;
		const id = block.attachment?.attachmentId;
		if (block.offloaded === true) {
			blocks.push({
				type: "text",
				text: offloadedImagePlaceholder(id)
			});
			continue;
		}
		const bytes = typeof id === "string" ? images?.get(id) : void 0;
		if (bytes === void 0) {
			blocks.push({
				type: "text",
				text: missingImagePlaceholder(id)
			});
			continue;
		}
		blocks.push({
			type: "image",
			mimeType: bytes.mediaType,
			data: base64Of(bytes)
		});
	}
	return blocks;
}
/** 已 offloaded 的图片占位文本（宿主契约：命名图片 + 只读路径，不发字节）。 */
function offloadedImagePlaceholder(attachmentId) {
	return `[图片已卸载：${attachmentId ?? "未知附件"}（原图不在本次请求中）]`;
}
function toPiContext(options, images) {
	assertProjectableContent(options.messages);
	const messages = [];
	const toolNames = /* @__PURE__ */ new Map();
	for (const message of projectImageBudget(options.messages, images)) {
		if (message.role === "system" || message.role === "developer") continue;
		if (message.role === "tool") {
			const content = piInputContent(message.content, images);
			messages.push({
				role: "toolResult",
				toolCallId: message.toolCallId,
				toolName: toolNames.get(message.toolCallId) ?? "unknown",
				content: content.length > 0 ? content : [{
					type: "text",
					text: "(no output)"
				}],
				isError: message.isError === true,
				timestamp: 0
			});
			continue;
		}
		if (message.role === "assistant") {
			const blocks = [];
			for (const block of message.content) if (block.type === "text") blocks.push({
				type: "text",
				text: block.text
			});
			else if (block.type === "file") blocks.push({
				type: "text",
				text: fileBlockText(block)
			});
			else if (block.type === "image") blocks.push({
				type: "text",
				text: assistantImageText(block)
			});
			else if (block.type === "reasoning") blocks.push({
				type: "thinking",
				thinking: block.text
			});
			else if (block.type === "tool-call") {
				toolNames.set(block.id, block.name);
				blocks.push({
					type: "toolCall",
					id: block.id,
					name: block.name,
					arguments: parseArguments(block.arguments)
				});
			}
			messages.push({
				role: "assistant",
				content: blocks,
				api: "dsh-foreign",
				provider: "dsh-foreign",
				model: "dsh-foreign",
				usage: emptyUsage(),
				stopReason: blocks.some((block) => block.type === "toolCall") ? "toolUse" : "stop",
				timestamp: 0
			});
			continue;
		}
		/**
		* 用户消息：**文本 + 图片**（2026-11-04 外部审查 U07）。
		*
		* 原来只取 `textOf(...)`，图片块被直接跳过 —— 目录宣称 `image` 能力、用户也贴了图，
		* 出站正文却只剩文字，而且流正常完成，用户完全无法察觉。
		*
		* 三类图分别处理：
		* - `offloaded: true`：宿主已把这张图从请求里卸载，只发**占位文本**，不读字节
		*   （审查 U13：不能把卸载的图又塞回去）；
		* - 能取到字节：按 Anthropic 形状发 `image` + `source.base64`；
		* - 取不到字节：发**占位文本**，绝不静默丢弃。
		*
		* 工具结果**不在这里** —— 宿主把它们放在 `role: "tool"` 的独立消息里（上面那个分支）。
		*/
		const content = piInputContent(message.content, images);
		if (content.length > 0) messages.push({
			role: "user",
			content,
			timestamp: 0
		});
	}
	const tools = (options.tools ?? []).map((tool) => toPiTool(tool));
	return {
		...systemTextOf(options) === "" ? {} : { systemPrompt: systemTextOf(options) },
		messages,
		...tools.length === 0 ? {} : { tools }
	};
}
/** pi-ai 的空用量（历史回合不带真实计数）。 */
function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
/**
* pi-ai 的 usage → 宿主的计数（旧插件 `mapUsage` 第 1689-1697 行）；缓存计数为 0 时省略。
* @param usage - pi-ai 的用量。
* @returns 宿主计数。
*/
function toHostUsage(usage) {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		totalTokens: usage.totalTokens,
		...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
		...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {}
	};
}
/** 一次 usage 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage) {
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
function toHostFinishReason(message, contextWindow) {
	if (isContextOverflow(message, contextWindow)) return {
		kind: "error",
		failure: {
			message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
			code: CONTEXT_WINDOW_EXCEEDED_CODE
		}
	};
	switch (message.stopReason) {
		case "stop": return message.content.length === 0 ? {
			kind: "error",
			failure: {
				message: `opencode model "${message.model}" returned a completed response with no content`,
				code: EMPTY_RESPONSE_CODE
			}
		} : { kind: "stop" };
		case "length":
			if (message.content.length === 0) return {
				kind: "error",
				failure: {
					message: `opencode model "${message.model}" produced no content at its output cap${contextWindow === void 0 ? "" : ` in a ${contextWindow}-token window`}. The prompt may leave too little room for an answer. Compact the context (/compact) or raise this model's max output, then retry`,
					code: "INVALID_REQUEST"
				}
			};
			return { kind: "max-tokens" };
		case "toolUse": return { kind: "tool-calls" };
		case "aborted": return {
			kind: "aborted",
			failure: {
				message: message.errorMessage ?? "opencode stream aborted",
				code: "ABORTED"
			}
		};
		case "error": return {
			kind: "error",
			failure: {
				message: message.errorMessage ?? "opencode stream error",
				code: "PI_AI_ERROR"
			}
		};
		default: return {
			kind: "error",
			failure: {
				message: `pi-ai stream for model "${message.model}" ended ${message.stopReason}`,
				code: "PI_AI_ERROR"
			}
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
async function* toHostChunks(events, contextWindow, signal) {
	const toolIds = /* @__PURE__ */ new Map();
	for await (const event of events) switch (event.type) {
		case "start": break;
		case "text_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "text"
			};
			break;
		case "text_delta":
			yield {
				type: "text-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "text_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "text",
					text: event.content
				}
			};
			break;
		case "thinking_start":
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "reasoning"
			};
			break;
		case "thinking_delta":
			yield {
				type: "reasoning-delta",
				index: event.contentIndex,
				text: event.delta
			};
			break;
		case "thinking_end":
			yield {
				type: "block-end",
				index: event.contentIndex,
				block: {
					type: "reasoning",
					text: event.content
				}
			};
			break;
		case "toolcall_start": {
			const partial = event.partial.content[event.contentIndex];
			const id = partial?.type === "toolCall" ? partial.id : "";
			const name = partial?.type === "toolCall" ? partial.name : "";
			toolIds.set(event.contentIndex, {
				id,
				name
			});
			yield {
				type: "block-start",
				index: event.contentIndex,
				blockType: "tool-call"
			};
			break;
		}
		case "toolcall_delta": {
			const known = toolIds.get(event.contentIndex);
			yield {
				type: "tool-call-delta",
				index: event.contentIndex,
				id: ToolCallId(known?.id ?? ""),
				...known === void 0 || known.name === "" ? {} : { name: known.name },
				argumentsDelta: event.delta
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
					arguments: JSON.stringify(event.toolCall.arguments)
				}
			};
			break;
		case "done": {
			const usage = toHostUsage(event.message.usage);
			if (usageTotal(usage) > 0) yield {
				type: "usage",
				usage
			};
			yield {
				type: "finish",
				reason: toHostFinishReason(event.message, contextWindow)
			};
			return;
		}
		case "error": {
			const usage = toHostUsage(event.error.usage);
			if (usageTotal(usage) > 0) yield {
				type: "usage",
				usage
			};
			if (signal?.aborted !== true && isContextOverflow(event.error, contextWindow)) throw new LlmError(event.error.errorMessage ?? `pi-ai detected context overflow for model "${event.error.model}"`, CONTEXT_WINDOW_EXCEEDED_CODE);
			const reason = signal?.aborted === true ? "aborted" : "error";
			throw new OpencodeStreamFailure(0, void 0, event.error.errorMessage ?? `pi-ai stream ${reason}`);
		}
		default: throw new LlmError(`Unsupported pi-ai stream event`, "UNSUPPORTED_CONTENT");
	}
	throw new LlmError("pi-ai event stream ended without done/error", "STREAM_CLOSED");
}
/** 三条线协议的实现表（旧插件 `buildProvider` 第 6496-6509 行的同一张表）。 */
const PROTOCOLS = {
	"anthropic-messages": anthropicMessagesApi(),
	"openai-completions": openAICompletionsApi(),
	"openai-responses": openAIResponsesApi()
};
/**
* 用 pi-ai SDK 发出一次请求，交出宿主 chunk 流（旧插件 `streamAttempt` 第 7677-7696 行的
* 请求部分）。时间预算由调用方用 `runStream` 套在外面。
* @param input - 模型、上下文、密钥与注入点。
* @returns 与线上同序的 chunk 流。
*/
function streamOpencode(input) {
	if (!input.model.input.includes("image") && input.context.messages.some((message) => (message.role === "user" || message.role === "toolResult") && Array.isArray(message.content) && message.content.some((block) => block.type === "image"))) throw new LlmError(`OpenCode model "${input.model.id}" does not accept image input`, "UNSUPPORTED_CONTENT");
	return toHostChunks(createProvider({
		id: SDK_PROVIDER_ID,
		name: "OpenCode Go",
		baseUrl: input.model.baseUrl,
		auth: { apiKey: {
			name: "OpenCode API key",
			resolve: () => Promise.resolve({
				auth: {},
				source: "OpenCode API key"
			})
		} },
		models: [input.model],
		api: PROTOCOLS
	}).streamSimple(input.model, normalizeContext(input.context), {
		apiKey: input.apiKey,
		fetch: input.fetchImpl,
		headers: {
			...attributionHeaders(),
			...input.headers ?? {}
		},
		maxRetries: 0,
		...input.signal === void 0 ? {} : { signal: input.signal },
		...input.reasoningEffort === void 0 ? {} : { reasoning: input.reasoningEffort },
		...input.temperature === void 0 ? {} : { temperature: input.temperature },
		...input.maxTokens === void 0 ? {} : { maxTokens: input.maxTokens }
	}), input.model.contextWindow, input.signal);
}
//#endregion
//#region src/vendors/opencode/catalog.ts
/**
* opencode 目录：`/models` 清单 + models.dev 元数据 → 统一目录条目。
*
* 纯解析加一层带 TTL 的内存缓存，形状逐条对照旧插件 `dsh-opencode-go/lib/index.js`：
* - 清单：`readLiveModelIds`（**第 6444-6461 行**）、`fetchLiveModelIds`（**第 6462-6489 行**），
*   端点 `${baseURL}/models`（**第 6463 行**），`data` 数组里只有非空字符串 `id` 才算有效行；
* - 元数据：`MODEL_METADATA_URL`（**第 6104 行**）与 `readModelMetadata`（**第 6168-6231 行**），
*   取 `payload["opencode-go"].models[id]` 的 `name` / `limit.context` / `limit.output` /
*   `modalities.input` / `reasoning` / `provider.npm`；
* - 归属：**清单的 id 决定成员，元数据决定怎么调用**（旧插件 `build` 第 6639-6641 行的注释）；
* - 域校验：只把 `opencode.ai` 域当目录来源（旧插件第 8662-8665 行的 `DISCOVERY_UNSUPPORTED`）。
*
* 与旧插件的差别（本期范围）：
* - **不落盘**：旧插件把元数据写进 `~/.dsh/cache/dsh-opencode-go/models.dev.api.json`
*   （第 6363 行）；本期只要求解析 + 可注入 `fetchImpl` + 内存 TTL；
* - **不做 builtin 兜底表**：旧插件有一份内置模型表；本期元数据拿不到就只用清单
*   （名字退回 id、无上下文/输出上限），**不补 0**（缺失就是缺失）；
* - `modelLimits` 覆盖由适配器在 `resolveModel` 里应用，不在这里。
* @module dsh-llm-account/src/vendors/opencode/catalog
*/
/**
* 元数据（models.dev）的默认预算：**4 秒**。
*
* 实测该端点 2.8s 起步、偶发 18s 失败、最坏 197s；而它只提供建议性事实
* （上下文/输出/模态/协议），档位已由网关 `/models` 提供。等它就会「切模型反应好半天」
* （2026-11-04 报障），所以给它一个明显短于网关请求的预算，超时直接用清单事实。
*/
const METADATA_BUDGET_MS = 4e3;
/** models.dev 里这条网关的 provider 键（旧插件 `record(body)["opencode-go"]` 第 6169 行）。 */
const SDK_PROVIDER_KEY = "opencode-go";
/** 读取非空字符串。 */
function stringValue$2(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/** 读取正数（上下文窗口与输出上限为 0 或负数时视为未公布）。 */
function positiveNumber$1(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/**
* 读出一行声明的输入模态；未声明就是未知，不猜。
*
* **两种形状都要认**（2026-11-08）：models.dev 的元数据把模态放在 `modalities.input`
* 下，而网关 `/models` 的行同样用 `modalities.input`（实测
* `deepseek-v4.1-flash` 是 `["text","image/jpeg","image/png","image/gif","image/webp"]`）。
* 以前这里只读裸 `input` —— 那两种形状都不匹配，于是网关明确声明支持图片的模型
* 被记成「只支持文本」，图片附件直接被拒。
*
* 判断按**前缀**而不是全等：网关照 MIME 写（`image/jpeg`），元数据写类别（`image`）。
* @param value - 一行模型数据。
* @returns 支持的输入模态（缺省只有文本）。
*/
function inputModalitiesOf(value) {
	if (!isRecord$3(value)) return ["text"];
	const container = isRecord$3(value.modalities) ? value.modalities : value;
	const declared = isRecord$3(container) ? container.input : void 0;
	if (Array.isArray(declared) && declared.some((item) => typeof item === "string" && item.startsWith("image"))) return ["text", "image"];
	return ["text"];
}
/**
* 解析一份 `/models` 清单（旧插件 `readLiveModelIds` 第 6444-6461 行）。
*
* 有效的行只需要非空 `id`（在线清单常常只给 id，名字与上限来自元数据）；`name` 缺省时
* 退回 id。`contextWindow` / `maxTokens` 未公布时**不写**该字段，让「未公布」与
* 「公布为 0」在数据上可区分。
*
* 展示名由 id 派生（`assignUniqueNames`），与另两家同一套规则；清单里的 `name` 不参与
* 展示（同一模型在三家网关写法不同，见 `core/model-names` 的说明）。
* @param payload - 已解析的响应正文（形状不可信）。
* @returns 可用条目与被忽略的行数。
*/
function parseModels(payload) {
	if (!isRecord$3(payload)) return {
		entries: [],
		ignored: 0
	};
	const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
	const entries = [];
	let ignored = 0;
	for (const raw of rows) {
		if (!isRecord$3(raw)) {
			ignored += 1;
			continue;
		}
		const id = stringValue$2(raw.id);
		if (id === void 0) {
			ignored += 1;
			continue;
		}
		/**
		* **网关自己公布的上下文/输出上限**（2026-11-08 修「opencode 不显示模型上下文」）。
		*
		* 这个网关的行里带 `limit: { context, output }` —— 实测
		* `deepseek-v4.1-flash` 是 `context 1000000 / output 384000`。但这里以前**只**认
		* `context_length` / `contextWindow`（那是别的厂商的字段名），于是网关给的这个值
		* 被整行忽略，`contextWindow` 只能靠 models.dev 元数据补。
		*
		* 后果就是用户看到的现象：models.dev 是**第三方站点**，超时/改结构/漏字段都正常
		* （模块注释里记过实测 2.8s、18.5s 失败、甚至 197s），而它的预算只有 4 秒 ——
		* 一旦那次抓取没赶上，模型上下文就直接显示不出来，尽管**网关刚刚亲口说过**。
		*
		* 与档位那次修复（`capabilities.reasoning.effort`）是同一条道理：
		* `/models` 是目录本身的必需请求，它公布的容量永远拿得到，优先级应当高于第三方元数据。
		*/
		const limit = isRecord$3(raw.limit) ? raw.limit : void 0;
		const contextWindow = positiveNumber$1(raw.context_length ?? raw.contextWindow ?? limit?.context);
		const maxTokens = positiveNumber$1(raw.max_output_tokens ?? raw.maxTokens ?? limit?.output);
		/**
		* 网关自己公布的档位：`capabilities.reasoning.effort`。
		*
		* 2026-11-03 报障 `does not support reasoning effort "max"` 的根因就在这一行之前：
		* 档位**只**从 models.dev 元数据（`reasoning_options`）来，而那次抓取会失败/漏字段，
		* 于是 `efforts` 变成空数组，宿主认为该模型没有档位 —— 用户选着 `max` 的请求被拒。
		* 而 `/models` 是**目录本身的必需请求**，它公布的档位永远拿得到，比 models.dev 可靠。
		*/
		const gatewayEfforts = effortsOfCapabilities(raw.capabilities);
		entries.push({
			id,
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens },
			...gatewayEfforts === void 0 ? {} : { efforts: gatewayEfforts },
			inputModalities: inputModalitiesOf(raw)
		});
	}
	const names = assignUniqueNames(entries.map((entry) => entry.id));
	return {
		entries: entries.map((entry, index) => ({
			...entry,
			name: names[index] ?? entry.id
		})),
		ignored
	};
}
/**
* 解析 models.dev 元数据（旧插件 `readModelMetadata` 第 6168-6231 行）。
*
* 只认 `payload["opencode-go"].models`；单条模型解析不了就跳过该条（旧插件把失败
* 记进 `errors` 并把该 id 标成「元数据不可用」，本期直接用清单事实兜底）。
* @param payload - `https://models.dev/api.json` 的响应正文。
* @returns 模型 id → 元数据。
*/
function parseModelMetadata(payload) {
	const result = /* @__PURE__ */ new Map();
	if (!isRecord$3(payload)) return result;
	const provider = payload[SDK_PROVIDER_KEY];
	if (!isRecord$3(provider) || !isRecord$3(provider.models)) return result;
	const fallbackNpm = provider.npm;
	for (const [id, value] of Object.entries(provider.models)) {
		if (!isRecord$3(value)) continue;
		const limit = isRecord$3(value.limit) ? value.limit : {};
		const metadata = {};
		const name = stringValue$2(value.name);
		if (name !== void 0) metadata.name = name;
		const contextWindow = positiveNumber$1(limit.context);
		if (contextWindow !== void 0) metadata.contextWindow = contextWindow;
		const maxTokens = positiveNumber$1(limit.output);
		if (maxTokens !== void 0) metadata.maxTokens = maxTokens;
		const modalities = isRecord$3(value.modalities) ? value.modalities.input : void 0;
		if (Array.isArray(modalities)) metadata.inputModalities = modalities.includes("image") ? ["text", "image"] : ["text"];
		if (typeof value.reasoning === "boolean") metadata.reasoning = value.reasoning;
		const efforts = effortsOf(value.reasoning_options);
		if (efforts.length > 0) metadata.efforts = efforts;
		const api = apiForNpm((isRecord$3(value.provider) ? value.provider.npm : void 0) ?? fallbackNpm);
		if (api !== void 0) metadata.api = api;
		const canonical = stringValue$2(value.canonical_model_id);
		if (canonical !== void 0) {
			const company = canonical.split("/")[0];
			if (company !== void 0 && company !== "") metadata.company = company;
		}
		const cost = isRecord$3(value.cost) ? value.cost : void 0;
		if (cost !== void 0) {
			const input = typeof cost.input === "number" ? cost.input : void 0;
			const output = typeof cost.output === "number" ? cost.output : void 0;
			if (input === 0 && output === 0) metadata.free = true;
		}
		if (typeof value.open_weights === "boolean") metadata.openWeights = value.open_weights;
		result.set(id, metadata);
	}
	return result;
}
/**
* `reasoning_options` 里 `type: "effort"` 的取值（旧插件第 6131-6138 行）。
*
* **两种形状都要认**（2026-11-04 实测）：
*
* - **对象**（models.dev 现在的真实形状）：
*   `{"type":"effort","values":["low","high","max"]}` —— 取自 live `api.json`；
* - **数组**（旧插件与部分历史快照）：
*   `[{"type":"effort","values":[…]}, …]`。
*
* 原来只认数组，于是线上元数据的档位**永远读不出来**（`effortsOf` 恒返回空数组）。
* 现在先按对象读，不成再按数组遍历。
* @param value - `reasoning_options` 原值。
* @returns 档位数组（可能为空）。
*/
function effortsOf(value) {
	const collect = (option) => {
		if (!isRecord$3(option) || option.type !== "effort" || !Array.isArray(option.values)) return [];
		const efforts = [];
		for (const level of option.values) if (typeof level === "string" && level !== "" && level !== "none") efforts.push(level);
		return efforts;
	};
	if (isRecord$3(value)) return collect(value);
	if (!Array.isArray(value)) return [];
	const efforts = [];
	for (const option of value) efforts.push(...collect(option));
	return efforts;
}
/**
* 网关 `/models` 的 `capabilities.reasoning.effort` → 档位数组。
*
* 2026-11-03 报障 `does not support reasoning effort "max"` 的修复点：
* 之前档位**只**来自 models.dev 元数据（`reasoning_options`），那次抓取失败或漏字段时
* 就是空数组，宿主据此判定「这个模型没有档位」，把用户选的 `max` 请求直接拒掉。
* 而 `/models` 是目录本身的必需请求，公布的档位永远拿得到。
*
* 与 {@link effortsOf} 的区别：那边是 models.dev 的 `{type:"effort",values:[…]}` 形状，
* 这边是网关直接给的字符串数组。
* @param capabilities - `/models` 条目的 `capabilities`。
* @returns 档位数组；没有可用档位时 `undefined`（不产出 `[]`，让「未声明」与「空」可区分）。
*/
function effortsOfCapabilities(capabilities) {
	if (!isRecord$3(capabilities)) return void 0;
	const reasoning = capabilities.reasoning;
	if (!isRecord$3(reasoning)) return void 0;
	if (!Array.isArray(reasoning.effort)) return void 0;
	const efforts = [];
	for (const level of reasoning.effort) {
		if (typeof level !== "string" || level === "") continue;
		efforts.push(level === "none" ? "off" : level);
	}
	return efforts.length === 0 ? void 0 : efforts;
}
/**
* 读一段**真正有界**的 JSON 正文（目录请求用）。
*
* ## 实现已下沉到 `core/bounded-body`（2026-11-05 复审的去重项）
*
* 这里原先有一份完整的分块实现，OAuth 那边（F13）又写了一份**同样的逻辑**。
* 两份实现意味着**两处都要修、两处都可能漏** —— 与
* `docs/HANDOVER-2.0.0.md` §5.5 是同一条教训。现在共用一份，各自保留自己的
* 错误映射：目录侧翻译成 `DISCOVERY_FAILED`，OAuth 侧抛原始错误让调用方分类。
*
* 保留的语义与原来一致：
* - 按 **UTF-8 字节**计（不是字符数）；
* - `Content-Length` 先快速拒绝；
* - 超限**立刻 cancel**，后面的 chunk 不再索取；
* - 非法 JSON → `DISCOVERY_FAILED`。
* @param response - 已拿到响应头的响应。
* @param limit - 允许的最大**字节**数。
* @returns 解析后的 JSON。
* @throws {@link LlmError} 超限或非法 JSON 时（码都是 `DISCOVERY_FAILED`）。
*/
async function readJsonBounded(response, limit) {
	let text;
	try {
		text = await readBoundedText$1(response, limit);
	} catch (error) {
		if (error instanceof BodyTooLargeError) throw new LlmError(`opencode catalog response exceeds the ${limit} byte limit`, "DISCOVERY_FAILED", { cause: error });
		throw error;
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new LlmError("opencode catalog response is not valid JSON", "DISCOVERY_FAILED", { cause: error });
	}
}
/**
* 造一份带 TTL 的内存目录缓存（旧插件 `OpencodeGoCatalog` 第 6510-6710 行的精简版：
* 只保留「清单 + 元数据 → 记录」与刷新窗口，不落盘、不做 ETag/条件请求）。
* @param input - 基地址、注入的 `fetch`、TTL 与时钟。
* @returns 目录来源。
*/
function createOpencodeCatalog(input) {
	const now = input.now ?? Date.now;
	const ttlMs = input.ttlMs !== void 0 && Number.isFinite(input.ttlMs) && input.ttlMs >= 0 ? input.ttlMs : DEFAULT_CATALOG_TTL_MS;
	/**
	* 元数据预算默认取得比网关请求短得多：实测 `models.dev` 一次 2.8s、一次 18.5s 失败、
	* 一次 **197s**。它是建议性的，等它不如用清单事实先把模型列表给出去。
	*/
	const metadataBudgetMs = input.metadataBudgetMs !== void 0 && Number.isFinite(input.metadataBudgetMs) && input.metadataBudgetMs > 0 ? input.metadataBudgetMs : METADATA_BUDGET_MS;
	let cached;
	let expiresAt = 0;
	/** 最新一代的代号：只有它返回的结果允许写缓存。 */
	let generationSeq = 0;
	/** 当前共享的在途加载（并发去重）。 */
	let current;
	const requestSignal = (signal, budgetMs) => signal === void 0 ? AbortSignal.timeout(budgetMs) : AbortSignal.any([signal, AbortSignal.timeout(budgetMs)]);
	/**
	* 现取一次目录请求用的密钥。
	*
	* 读失败一律降级成 `undefined`（无鉴权请求）：目录读不到会让整个厂商的模型列表消失，
	* 而「少几个模型」远好过「这个厂商没有模型」。凭据问题会在真正发推理请求时暴露，
	* 那时用户看到的是准确的错误。
	* @returns 密钥；取不到时 `undefined`。
	*/
	const keyOf = async () => {
		if (input.resolveKey === void 0) return void 0;
		try {
			const key = await input.resolveKey();
			return typeof key === "string" && key !== "" ? key : void 0;
		} catch {
			return;
		}
	};
	const listing = async (signal) => {
		assertOpencodeBase(input.baseUrl);
		/**
		* 凭据每次现取（见 `resolveKey` 的说明）；没装注入点时不 `await` ——
		* `await undefined` 也会让出一轮微任务，那会让「调用 `list()` 之后立刻就有
		* 在途请求」这个既有性质失效（并发去重的测试直接观察它）。
		*/
		const key = input.resolveKey === void 0 ? void 0 : await keyOf();
		const { url, headers } = catalogRequest(input.baseUrl, key);
		const response = await input.fetchImpl(url, {
			headers: {
				...headers,
				...input.authHeaders
			},
			signal: requestSignal(signal, MODELS_FETCH_TIMEOUT_MS)
		});
		if (!response.ok) throw new LlmError(`opencode models endpoint returned ${response.status}`, "DISCOVERY_FAILED", { status: response.status });
		const parsed = parseModels(await readJsonBounded(response, MODELS_MAX_BYTES));
		if (parsed.entries.length === 0 && parsed.ignored > 0) throw new LlmError("the opencode model listing has no valid model ids", "DISCOVERY_FAILED");
		return parsed.entries;
	};
	const metadata = async (signal) => {
		try {
			const { url, headers } = metadataRequest();
			const response = await input.fetchImpl(url, {
				headers,
				signal: requestSignal(signal, metadataBudgetMs)
			});
			if (!response.ok) return /* @__PURE__ */ new Map();
			return parseModelMetadata(await readJsonBounded(response, METADATA_MAX_BYTES));
		} catch {
			return /* @__PURE__ */ new Map();
		}
	};
	const load = async (signal) => {
		/**
		* **两个请求并行发**（2026-11-04 修「切模型反应好半天」）。
		*
		* 原来是 `await listing(); await metadata();` —— 串行。元数据（`models.dev`，5.7 MB）
		* 实测 2.8s / 18.5s 失败 / **197s**，而它只是建议性的，却把整条路径堵在最慢那个上。
		*
		* 现在：
		* - 并行发出，总耗时 ≈ max(清单, 元数据) 而不是两者之和；
		* - 元数据有自己的短预算（{@link METADATA_BUDGET_MS}），超时就用清单事实继续 ——
		*   档位、上下文、模态在清单里都有兜底值（`entry.efforts` 等）；
		* - 清单失败仍然整次失败：没有清单就没有目录，不能编。
		*/
		const [entries, metadataById] = await Promise.all([listing(signal), metadata(signal)]);
		const names = assignUniqueNames(entries.map((entry) => entry.id));
		return entries.map((entry, index) => {
			const meta = metadataById.get(entry.id);
			const contextWindow = meta?.contextWindow ?? entry.contextWindow;
			const maxTokens = meta?.maxTokens ?? entry.maxTokens;
			const efforts = entry.efforts ?? meta?.efforts;
			return {
				entry: {
					id: entry.id,
					name: names[index] ?? entry.name,
					...contextWindow === void 0 ? {} : { contextWindow },
					...maxTokens === void 0 ? {} : { maxTokens },
					...efforts === void 0 ? {} : { efforts },
					inputModalities: meta?.inputModalities ?? entry.inputModalities
				},
				api: meta?.api ?? "anthropic-messages",
				reasoning: meta?.reasoning === true,
				efforts: efforts ?? [],
				...meta?.company === void 0 ? {} : { company: meta.company },
				...meta?.free === true ? { free: true } : {}
			};
		});
	};
	return { 
	/**
	* 读目录（带 TTL 缓存）。
	*
	* @param signal - 调用方取消信号。**只取消自己的等待**，不影响其他等待者（F01）。
	* @param fresh - **绕过缓存**（2026-11-04 外部审查 U10）。
	*
	*   `CatalogModelsPort.catalogModels(fresh)` 的契约就是「刷新按钮必须真的重读」，
	*   而这里原来只收 `signal`、无条件走 TTL —— 用户在 TTL 内点刷新，界面就是
	*   「点了没反应」，服务端已经变了的列表永远看不到。
	*
	* ## 并发语义（2026-11-05 外部审查 F01 重写）
	*
	* | 场景 | 行为 |
	* | --- | --- |
	* | 多个普通读取并发 | 共用同一次网络请求（去重） |
	* | `fresh` | **另起一代**，不复用在途请求；旧一代的结果**不再**能写缓存 |
	* | 某个调用方取消 | 只有它自己 reject；共享请求活到最后一个等待者也走掉 |
	* | 旧加载的 `finally` | 不会清掉新一代的指针（比较 `current === entry`） |
	*/
async list(signal, fresh = false) {
		const stamp = now();
		if (!fresh && cached !== void 0 && stamp < expiresAt) return cached;
		if (signal?.aborted === true) throw cancelledError(signal);
		if (fresh) {
			generationSeq += 1;
			current = void 0;
		}
		const existing = current;
		const entry = existing ?? startLoad();
		if (existing !== void 0) existing.waiters += 1;
		return waitFor(entry, signal);
	} };
	/**
	* 起一代新的加载。
	* @returns 新的在途加载（`waiters` 初始为 1，代表本次调用方）。
	*/
	function startLoad() {
		const controller = new AbortController();
		const entry = {
			generation: generationSeq,
			controller,
			promise: void 0,
			waiters: 1
		};
		entry.promise = load(controller.signal).then((records) => {
			if (entry.generation === generationSeq) {
				cached = records;
				expiresAt = now() + ttlMs;
			}
			return records;
		});
		current = entry;
		entry.promise.catch(() => {}).finally(() => {
			if (current === entry) current = void 0;
		});
		return entry;
	}
	/**
	* 等一份加载的结果，并把「调用方取消」与「加载失败」分开。
	*
	* 取消只 reject **本调用方**；`releaseWaiter` 在最后一个等待者离开时
	* abort 共享请求，所以一个组件取消不会拖死其他人（F01 的第二个缺陷）。
	* @param entry - 在途加载。
	* @param signal - 本调用方的取消信号。
	* @returns 目录记录。
	*/
	async function waitFor(entry, signal) {
		if (signal === void 0) return entry.promise;
		if (signal.aborted) {
			releaseWaiter(entry);
			throw cancelledError(signal);
		}
		let onAbort;
		const aborted = new Promise((_resolve, reject) => {
			onAbort = () => {
				releaseWaiter(entry);
				reject(cancelledError(signal));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([entry.promise, aborted]);
		} finally {
			if (onAbort !== void 0) signal.removeEventListener("abort", onAbort);
		}
	}
	/**
	* 一个等待者放弃；全部走光才 abort 共享请求（否则一个组件取消会拖死其他人）。
	* @param entry - 在途加载。
	*/
	function releaseWaiter(entry) {
		entry.waiters -= 1;
		if (entry.waiters > 0) return;
		if (current === entry) current = void 0;
		if (!entry.controller.signal.aborted) entry.controller.abort();
	}
	/** 调用方取消时的错误（带 `signal.reason`，便于上游区分「谁取消的」）。 */
	function cancelledError(signal) {
		return signal.reason === void 0 ? new LlmError("the caller aborted the catalog read", "ABORTED") : new LlmError("the caller aborted the catalog read", "ABORTED", { cause: signal.reason });
	}
}
//#endregion
//#region src/core/single-flight.ts
/**
* 按 key 合并并发调用（"single-flight"）。
*
* ## 为什么需要它
*
* 好几处「同一个 key 上并发的请求应该共享一次工作」：
*
* - OAuth 刷新（不共享会让并发请求各刷一次，服务端启用 refresh token 轮换时后一次必失败）；
* - 将来任何「读一次很贵、读多次无益」的旁路操作。
*
* ## 语义（三条，都有测试钉住）
*
* 1. **同 key 并发 → 只跑一次**：第二个调用拿到第一个的 promise；
* 2. **settle 后立刻移除表项**：失败也移除 —— 否则一次失败会被永久缓存，那个 key
*    再也跑不动；
* 3. **不同 key 互不影响**：按 key 隔离，不是全局串行。
*
* ## 为什么抽成独立模块（2026-10-22）
*
* 最初这段逻辑写在 adapter 的私有方法里，测试只能**复刻一份**同样的逻辑做语义验证 ——
* 于是生产代码写错了测试照样通过（bug 审查复查指出这一点）。抽出来之后测试直接跑
* 这份实现，变异检验才能真的抓到问题。
*
* @module dsh-llm-account/src/core/single-flight
*/
/**
* 造一个「按 key 合并并发」的执行器。
*
* @returns 一个 `run(key, work)` 函数；同一个 key 上并发的调用共享同一次 `work`。
*/
function createSingleFlight() {
	/** 正在进行中的调用，按 key 隔离。 */
	const pending = /* @__PURE__ */ new Map();
	return (key, work) => {
		const existing = pending.get(key);
		if (existing !== void 0) return existing;
		/**
		* **先建 promise、同步放进表**，再返回。
		*
		* 顺序很关键：如果先 `await work()` 再入表，两个并发调用都会看到空表、各跑一次 ——
		* 那就完全失去意义。这里从「建表项」到 `return` 之间**没有 await**，所以调用方
		* 不可能观察到中间状态。
		*
		* `work()` 用 `Promise.resolve().then(work)` 包一层：它在**下一个微任务**里执行，
		* 所以即使 `work` 同步抛错也会变成 rejected promise，而不是让 `run` 同步抛出。
		* 契约是「永远返回 Promise」，同步异常会破坏这条（调用方的 `.catch` 就接不住了）。
		*/
		const started = Promise.resolve().then(work).finally(() => {
			pending.delete(key);
		});
		pending.set(key, started);
		return started;
	};
}
//#endregion
//#region src/core/credential-guard.ts
/**
* 按 key **串行化**的写操作队列，配合**代际**让迟到的写自动失效。
*
* ## 为什么需要（2026-11-01 修 S01 第二版）
*
* 凭据覆盖问题的本质是「读—判—写」不是原子的：
*
* ```
* T0  刷新开始，记住 raw
* T1  刷新返回，写回前重新读 → 还是 raw → 准备写
* T2  **暂停**（事件循环让出）
* T3  用户换 key，完整提交
* T4  继续执行 T1 的写 → 覆盖用户的新 key
* ```
*
* 第二轮复审准确指出：**再加一次普通读取解决不了**，因为读取与写入之间永远有窗口。
* 宿主 `CredentialPort` 没有 CAS / 版本条件更新，插件侧无法做到真正的原子写。
*
* ## 这个模块能保证什么、不能保证什么
*
* **能**：本插件内**所有**对同一 ref 的凭据写入都经过这里排队，并且每次写入前
* 校验代际 —— 用户操作（换 key / 重新登录 / 删除）会推进代际，于是**在它之前**
* 发起的刷新不会写回。
*
* **不能**：插件外部（宿主凭据页、别的插件）的写入不经过这个队列。所以这不是
* 「整个宿主的原子性」，只是「本插件内的顺序一致」。这个边界必须说清楚，不能
* 宣传成更强的东西。
*
* @module dsh-llm-account/src/core/credential-guard
*/
/**
* 造一个按 key 串行化、带代际的凭据写守卫。
*
* ## 两种写，语义不同（2026-11-01 修 S01 第三版）
*
* 上一版只有 `run(key, expected, write)` —— 它做「代际校验后写」。但那个语义只适合
* **后台刷新**：刷新是「顺带把新 token 存起来」，用户已经改过就不该存。
*
* **用户的写不能这样**：用户点「换 key / 重新登录」是他明确的意图，任何时候都必须
* 落地。上一版让 `replaceKey` 只 `bump()`、直接把 `port.replaceKey()` 调出去，
* 结果它**不在队列里** —— 与在途的刷新写回仍然可以交错。
*
* 所以拆成两个入口：
*
* | 入口 | 代际校验 | 用途 |
* | --- | --- | --- |
* | `run` | ✅ 校验，不符就放弃 | 后台刷新写回 |
* | `runUserWrite` | ❌ 不校验（必写） | 用户换 key / 重登录 / 删除 |
*
* 两者共享**同一条队列**，所以用户写一定会排在在途刷新写回之后或之前，不会交错。
* `runUserWrite` 在入队时 `bump` —— 让**更早发起**的刷新写回在校验时失败。
*
* @returns 守卫实例。
*/
function createCredentialGuard() {
	/** 每个 key 的当前代际。 */
	const epochs = /* @__PURE__ */ new Map();
	/** 每个 key 的写队列尾（用它串行化）。 */
	const tails = /* @__PURE__ */ new Map();
	return {
		bump(key) {
			const next = (epochs.get(key) ?? 0) + 1;
			epochs.set(key, next);
			return next;
		},
		epochOf(key) {
			return epochs.get(key) ?? 0;
		},
		run(key, expected, write) {
			const started = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
				/**
				* **排队之后、真正写之前**再校验一次代际。
				*
				* 这是关键：调用方在发起时看的是 `expected`，但它可能在队列里等过 ——
				* 等待期间用户换了 key（代际已推进），这次写必须放弃。
				*/
				if ((epochs.get(key) ?? 0) !== expected) return false;
				await write();
				return true;
			}).finally(() => {
				if (tails.get(key) === started) tails.delete(key);
			});
			tails.set(key, started);
			return started;
		},
		runUserWrite(key, write) {
			/**
			* **入队就推进代际**：让所有「在这一点之前发起」的后台刷新写回在校验时失败。
			*
			* 必须在校验之前 bump —— 若等队列轮到再 bump，一个已经通过校验、
			* 正在执行的后台写仍可能与用户写交错。
			*/
			epochs.set(key, (epochs.get(key) ?? 0) + 1);
			const started = (tails.get(key) ?? Promise.resolve()).catch(() => {}).then(() => write()).finally(() => {
				if (tails.get(key) === started) tails.delete(key);
				/**
				* **完成后再推进一次代际**（2026-11-01 修第四处 S01 缺口）。
				*
				* ## 报告给出的具体时序
				*
				* 只在入队时 bump 有一个漏洞：用户写**还没提交**时启动的新请求会借到
				* 那个「新」代际，而它读到的仍是槽里的**旧 OAuth**：
				*
				* ```
				* T0  用户点换 key → runUserWrite 入队，代际 E+1（用户 set 还在队列里没执行）
				* T1  新请求开始 → epochOf() 读到 E+1，resolveStored 读到**旧 OAuth**
				* T2  用户 set 提交完成（槽里现在是新 key）
				* T3  T1 的刷新写回：校验 E+1 === E+1 → **通过** → 把旧 OAuth 写回去
				*     ↑ 用户的新 key 被覆盖
				* ```
				*
				* 报告实测提交顺序为 `key → oauth`，`userKeySurvives = false`。
				*
				* 完成时再 bump 一次，把 T1 那种「在用户写进行中取得的代际」也作废 ——
				* 它们在 T3 校验时看到 E+2，放弃写回。
				*
				* 代价：用户写完之后，一次本来可以成功的刷新会白跑一次（重新刷新）。
				* 那是正确的取舍：**宁可多刷一次，不能让旧值盖掉用户刚存的东西**。
				*/
				epochs.set(key, (epochs.get(key) ?? 0) + 1);
			});
			tails.set(key, started);
			return started;
		}
	};
}
//#endregion
//#region src/vendors/opencode/oauth.ts
/**
* OpenCode 网页登录的协议层：设备码、轮询、刷新与凭据 blob（实验性）。
*
* 凭据以 `ocoauth1:` 前缀的 JSON 存进**现有凭据槽**（与 API key 同一个槽位空间），
* 因此账号表、`accountOrder`、凭据服务都不需要为新授权方式加字段；手动 API key 仍然可用，
* 适配器按前缀区分。
*
* 端点（2026-10-17 实测）：
* - `POST {authBase}/console/auth/device/code`，body `{client_id:"opencode-cli"}`；
* - `POST {authBase}/console/auth/device/token`，轮询 `{client_id, device_code}`，
*   刷新 `{grant_type:"refresh_token", refresh_token, client_id}`；
* - `GET {authBase}/console/api/orgs`，Bearer access token。
*
* 本模块只做 HTTP + 归一化，不碰设置、账号或轮换；注入 `fetch` 与时钟，测试无需真网。
* @module dsh-llm-account/src/vendors/opencode/oauth
*/
/** 凭据 blob 前缀（与普通 API key 区分）。 */
const OAUTH_PREFIX = "ocoauth1:";
/** OpenCode CLI 的公共 client id（设备码流程用）。 */
const OAUTH_CLIENT_ID = "opencode-cli";
/** 刷新提前量：过期前 60 秒就刷新，避免请求卡在边界上。 */
const REFRESH_SKEW_MS = 6e4;
/** 解析凭据 blob；不是本前缀或形状不认识时返回 `undefined`（按普通 key 处理）。 */
function parseOAuthCredential(raw) {
	if (typeof raw !== "string" || !raw.startsWith("ocoauth1:")) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(raw.slice(9));
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const value = parsed;
	if (value.v !== 1) return void 0;
	if (typeof value.access !== "string" || value.access === "") return void 0;
	if (typeof value.refresh !== "string" || value.refresh === "") return void 0;
	if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return void 0;
	if (typeof value.orgId !== "string" || value.orgId === "") return void 0;
	return {
		v: 1,
		access: value.access,
		refresh: value.refresh,
		expiresAt: value.expiresAt,
		orgId: value.orgId,
		...typeof value.orgName === "string" && value.orgName !== "" ? { orgName: value.orgName } : {},
		...typeof value.userName === "string" && value.userName !== "" ? { userName: value.userName } : {},
		...typeof value.authBase === "string" && value.authBase !== "" ? { authBase: value.authBase } : {}
	};
}
/** 序列化成凭据槽里存的一行。 */
function serializeOAuthCredential(credential) {
	return `${OAUTH_PREFIX}${JSON.stringify(credential)}`;
}
/** 这个 blob 是否该刷新（过期前 {@link REFRESH_SKEW_MS} 开始）。 */
function needsRefresh(credential, now) {
	return credential.expiresAt - REFRESH_SKEW_MS <= now;
}
/**
* OAuth 响应的字节上限：**256 KiB**（2026-11-05 外部审查 F13）。
*
* 这三个端点正常只回几百字节到几 KB（设备码、token、工作区列表）。256 KiB 是
* 一个非常宽松的上限 —— 正常响应永远碰不到它，而异常响应（代理错误页、服务端
* 把整个 HTML 页面甩回来）不会先把内存吃满再抛错。
*
* 为什么必须有：上一版走 `readJson` 里的 `response.text()`，先把**完整正文**
* 读进内存再解析。多账号并发刷新时这份峰值会叠加。
*/
const OAUTH_MAX_BODY_BYTES = 262144;
/**
* 读 JSON；非 2xx 不抛（调用方按端点语义处理）。
*
* **有界**（F13）：分块读、按 UTF-8 字节计、超限立刻取消正文。超限会抛
* {@link BodyTooLargeError} —— 调用方必须把它与「空正文」「非法 JSON」区分开，
* 尤其不能让 token 轮询把超限误判成 `pending`（那会一直等到设备码过期）。
* @param response - 端点响应。
* @returns 解析后的值；空正文或非法 JSON 时 `undefined`。
* @throws {@link BodyTooLargeError} 正文超过 {@link OAUTH_MAX_BODY_BYTES}。
*/
async function readJson(response) {
	return await readBoundedJson(response, OAUTH_MAX_BODY_BYTES);
}
/** 普通对象。 */
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 从响应里读字符串。 */
function stringOf(value, key) {
	const found = value[key];
	return typeof found === "string" && found !== "" ? found : void 0;
}
/**
* Console 基地址（去掉结尾斜杠），**并校验主机**（安全加固）。
*
* 校验放在这里而不是各调用点：设备码、轮询、刷新、工作区四条路径都经过它，
* 漏一处的后果就是「refresh token 被发到了别处」。
* @param deps - 注入的 HTTP 依赖。
* @param credential - 可选的凭据 blob（它的 `authBase` 是第二来源）。
* @returns 已校验的基地址。
*/
function authBaseOf(deps, credential) {
	const allowed = deps.allowAuthHosts ?? DEFAULT_ALLOWED_AUTH_HOSTS;
	return assertAuthBase(deps.authBase ?? credential?.authBase ?? "https://opencode.ai", allowed);
}
/**
* 允许的 Console 主机（安全加固，2026-11-05 复审）。
*
* ## 为什么需要
*
* `authBase` 会决定**刷新 token 被发到哪个端点**。它有两个来源：
*
* 1. `deps.authBase`（装配层注入，生产路径上从不设置）；
* 2. **凭据 blob 里的 `authBase` 字段** —— 一旦本机凭据库被写入伪造的 blob，
*    刷新时 refresh_token 就会被送到攻击者主机。
*
* 后者需要先能写凭据库（那已经接近完全失控），所以这是**纵深防御**而不是当前
* 可利用的漏洞。但代价极低：把目标限制在我们自己的域名上即可。
*
* ## 为什么默认只放行 opencode.ai
*
* 唯一的真实服务就是它。测试与自建部署通过 `allowAuthHosts` 显式放宽 ——
* 「默认安全，需要时显式开口」比「默认随便连」稳妥。
*/
const DEFAULT_ALLOWED_AUTH_HOSTS = ["opencode.ai"];
/** 主机是否在允许列表里（含子域）。 */
function isAllowedAuthHost(host, allowed) {
	const normalized = host.toLowerCase();
	return allowed.some((entry) => {
		const candidate = entry.toLowerCase();
		return normalized === candidate || normalized.endsWith(`.${candidate}`);
	});
}
/**
* 校验并规范化 Console 基地址。
*
* 不接受 `http://`（token 明文过网）、不允许空主机、不允许非允许列表的主机。
* 校验失败**抛错**而不是静默回落到默认值 —— 静默回落会让「配错了」表现为
* 「登录莫名其妙走错地方」，比直接报错难查得多。
* @param raw - 待校验的基地址。
* @param allowed - 允许的主机列表（含子域）。
* @returns 去掉结尾斜杠的基地址。
* @throws 协议不是 https、无法解析、或主机不在允许列表时。
*/
function assertAuthBase(raw, allowed) {
	const trimmed = raw.trim().replace(/\/+$/, "");
	let url;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`authBase is not a valid URL: ${trimmed}`);
	}
	if (url.protocol !== "https:") throw new Error(`authBase must use https (got ${url.protocol.replace(":", "")}): ${trimmed}`);
	if (!isAllowedAuthHost(url.hostname, allowed)) throw new Error(`authBase host "${url.hostname}" is not allowed (allowed: ${allowed.join(", ")}). Refusing to send credentials to an unrecognized host.`);
	return trimmed;
}
/**
* 把服务端给的验证地址补成**可直接打开**的绝对 URL。
*
* ## 为什么需要（2026-11-02 真机报障）
*
* 真机实测 opencode 的 `device/code` 返回：
*
* ```json
* {
*   "verification_uri": "/console/device",
*   "verification_uri_complete": "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli"
* }
* ```
*
* 两个都是**相对路径**。界面用 `isHttpUrl(authUrl)` 判定能不能给 `href`，相对路径
* 判为 `false` → 链接不可点，用户只看到一串没有域名的文字。
*
* ## 规则（含安全加固）
*
* - 以 `/` 开头（或其它相对形态）→ 接到 `authBase` 后面。这是**唯一**信任的来源，
*   因为 `authBase` 已经过 {@link assertAuthBase} 校验；
* - 已经是绝对 URL → **同样要校验**主机在允许列表内。否则服务端（或中间人）可以
*   返回 `https://opencode.ai.evil.test/...` 把用户导向仿冒登录页，而用户看到的
*   域名前半段是对的；
* - 主机不在允许列表 → **拒绝并抛错**，不返回一个「看起来能点」的链接。
* @param authBase - 已校验的 Console 基地址（已去掉结尾斜杠）。
* @param uri - 服务端给的验证地址（可能是相对路径）。
* @param allowed - 允许的主机列表（含子域）。
* @returns 绝对 URL。
* @throws 相对形态之外、且主机不在允许列表时。
*/
function absoluteVerificationUri(authBase, uri, allowed) {
	if (/^[a-z][a-z0-9+.-]*:/iu.test(uri)) {
		let parsed;
		try {
			parsed = new URL(uri);
		} catch {
			throw new Error(`verification URI is not a valid URL: ${uri}`);
		}
		if (parsed.protocol !== "https:" || !isAllowedAuthHost(parsed.hostname, allowed)) throw new Error(`verification URI points at an untrusted host (${parsed.hostname}); refusing to hand out the link`);
		return uri;
	}
	return `${authBase}${uri.startsWith("/") ? uri : `/${uri}`}`;
}
/** 申请设备码。 */
async function beginDeviceFlow(deps, signal) {
	const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/code`, {
		redirect: "error",
		method: "POST",
		/**
		* **必须带 signal**（2026-11-05 外部审查 F02）。
		*
		* 上一版三个网络函数（设备码 / 轮询 / 读工作区）都没有 `signal` 参数：
		* 用户点「取消」只能改本地状态，已经发出的 `fetch` 继续挂在网络上，
		* `begin()` 也就永远等不到它 —— 界面上像没反应，进程里留下无主的请求。
		*/
		...signal === void 0 ? {} : { signal },
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify({ client_id: OAUTH_CLIENT_ID })
	});
	const payload = await readJson(response);
	if (!response.ok || !isRecord$2(payload)) throw new Error(`device code request failed (HTTP ${response.status})`);
	const deviceCode = stringOf(payload, "device_code");
	const userCode = stringOf(payload, "user_code");
	/**
	* **取 `verification_uri_complete`，并把相对路径补成绝对 URL**
	* （2026-11-02 修真机报障「网页链接无法打开」）。
	*
	* ## 真机实测的服务端响应
	*
	* ```json
	* {
	*   "verification_uri": "/console/device",
	*   "verification_uri_complete": "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli"
	* }
	* ```
	*
	* 两个都是**相对路径**，没有域名。上一版：
	*
	* 1. **优先取 `verification_uri`** —— 它不含 `user_code`，用户还得手输验证码；
	* 2. **原样透传** —— 界面 `isHttpUrl("/console/device")` 为 `false`，于是**不给
	*    `href`**，链接根本点不动，只显示一串没有域名的路径。
	*
	* 现在的顺序：`verification_uri_complete`（带验证码，最省事）→ `verification_uri`
	* （兜底，用户手输）→ 相对当前 `authBase` 解析成绝对地址。
	*/
	const rawUri = stringOf(payload, "verification_uri_complete") ?? stringOf(payload, "verification_uri");
	if (deviceCode === void 0 || userCode === void 0 || rawUri === void 0) throw new Error("device code response is missing device_code/user_code/verification_uri");
	const verificationUri = absoluteVerificationUri(authBaseOf(deps), rawUri, deps.allowAuthHosts ?? DEFAULT_ALLOWED_AUTH_HOSTS);
	const intervalSeconds = typeof payload.interval === "number" && payload.interval > 0 ? payload.interval : 5;
	const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : 600;
	const now = deps.now?.() ?? Date.now();
	return {
		deviceCode,
		userCode,
		verificationUri,
		intervalMs: Math.max(1e3, Math.round(intervalSeconds * 1e3)),
		expiresAt: now + Math.round(expiresIn * 1e3)
	};
}
/**
* 设备码流程的 `grant_type`（OAuth 2.0 Device Authorization Grant 标准值）。
*
* ## 为什么必须带（2026-11-02 真机报障的**根因**）
*
* 真机实测 `POST /console/auth/device/token`：
*
* | 请求体 | 服务端返回 |
* | --- | --- |
* | `{client_id, device_code}` | **HTTP 400 + 空 body**（无法解析） |
* | `{client_id, device_code, grant_type}` | `{"_tag":"DeviceTokenError","error":"authorization_pending"}` |
*
* 缺 `grant_type` 时服务端把它当成**畸形请求**，返回空 body。于是：
*
* 1. `readJson` 拿到 `undefined`；
* 2. `error` 字段取不到 → 落到 `status: "error"`；
* 3. 登录立刻结算成 `reason: "unavailable"` —— 界面上就是
*    **「登录服务暂时不可用」**，而且发生在**第一次轮询**（用户还没授权完）。
*
* 这就是「登录后账户没添加」的直接原因：流程在第一拍就死了，永远到不了
* `fetchOAuthOrg` 与 `storeKey`。
*/
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
/**
* 用设备码换一次 token（可能返回 pending/slow_down）。
*
* @param deps - 注入的 `fetch` 与时钟。
* @param device - 设备码。
* @param signal - 取消信号。
* @param emptyBodyStreak - **此前连续出现过多少次空正文 400**（F14）。
*
*   调用方（`login.ts` 的轮询循环）负责计数并把它传进来：本函数是纯的，
*   不该自己持有跨调用状态（那会让「同一次轮询里第几次」变得不可测）。
*   达到 {@link EMPTY_BODY_PENDING_TOLERANCE} 就不再兜底成 pending，改为报协议错误。
* @returns 轮询结论。
*/
async function pollDeviceToken(deps, device, signal, emptyBodyStreak = 0) {
	const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/auth/device/token`, {
		redirect: "error",
		method: "POST",
		...signal === void 0 ? {} : { signal },
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify({
			client_id: OAUTH_CLIENT_ID,
			device_code: device.deviceCode,
			grant_type: DEVICE_CODE_GRANT_TYPE
		})
	});
	/**
	* **超限不是 pending**（F13）；**坏 JSON 也不是空正文**（F19）。
	*
	* 用三态结论而不是 `undefined`：空正文是 pending 的正常表达，而 HTML 错误页 /
	* 被截断的正文是**协议错误** —— 两者混在一起会让坏 JSON 一直等到过期。
	*/
	const parsed = await readBoundedJsonResult(response, OAUTH_MAX_BODY_BYTES);
	const payload = parsed.kind === "json" ? parsed.value : void 0;
	if (!response.ok) {
		const error = isRecord$2(payload) ? stringOf(payload, "error") : void 0;
		if (error === "authorization_pending") return { status: "pending" };
		if (error === "slow_down") return { status: "slow_down" };
		if (error === "access_denied") return { status: "denied" };
		if (error === "expired_token") return { status: "expired" };
		/**
		* **非空但解析不出来**：不是 pending（F19）。
		*
		* 上一版把「空正文」与「坏 JSON」都折叠成 `undefined`，于是服务端回一页 HTML
		* 错误页时，轮询会把它当成「用户还没授权」，一路等到设备码过期。现在立刻报错，
		* 并把正文长度带进 message 便于排查（不打印正文本身：可能含敏感信息）。
		*/
		if (parsed.kind === "invalid") return {
			status: "error",
			message: `device token endpoint returned HTTP ${response.status} with a non-JSON body`
		};
		/**
		* **空 body 的 400**：有限次兜底成 pending（F14）。
		*
		* 历史上它正是「缺 `grant_type`」的畸形请求形态，所以兜底曾经救过那个 bug。
		* 但同一形态也可能表示参数错、协议变更或被代理拒绝 —— 而兜底成 pending 会让
		* 界面一直停在「等待授权」，直到设备码过期才报 timeout（实测轮询 300 次）。
		*
		* 现在：前 {@link EMPTY_BODY_PENDING_TOLERANCE} 次仍按 pending（容忍偶发抖动，
		* 也兼容真实的服务端行为），连续超过就判定为协议错误，让用户立刻看到问题。
		*/
		if (parsed.kind === "empty" && response.status === 400) {
			if (emptyBodyStreak < 3) return {
				status: "pending",
				emptyBody: true
			};
			return {
				status: "error",
				message: `device token endpoint returned HTTP 400 with an empty body ${emptyBodyStreak + 1} times in a row`
			};
		}
		return {
			status: "error",
			message: `device token request failed (HTTP ${response.status})`
		};
	}
	if (!isRecord$2(payload)) return {
		status: "error",
		message: "device token response is not an object"
	};
	/**
	* 成功载荷可能被包一层（该 Console 用 `_tag` 风格的编码）。
	*
	* 错误响应是 `{"_tag":"DeviceTokenError","error":…}` —— 说明服务端会给每个对象
	* 打上 `_tag`。成功的 token 也可能包在 `value` / `data` 里，所以两个都试，
	* 拿不到再用顶层。
	*/
	const body = isRecord$2(payload.value) && stringOf(payload.value, "access_token") !== void 0 ? payload.value : isRecord$2(payload.data) && stringOf(payload.data, "access_token") !== void 0 ? payload.data : payload;
	const access = stringOf(body, "access_token");
	const refresh = stringOf(body, "refresh_token");
	const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : void 0;
	if (access === void 0 || refresh === void 0 || expiresIn === void 0) return {
		status: "error",
		message: "device token response is missing access_token/refresh_token/expires_in"
	};
	return {
		status: "success",
		access,
		refresh,
		expiresAt: (deps.now?.() ?? Date.now()) + Math.round(expiresIn * 1e3)
	};
}
/** Refresh failures retain HTTP status so temporary outages remain retryable. */
var OAuthRefreshError = class extends Error {
	status;
	constructor(status) {
		super(`token refresh failed (HTTP ${status})`);
		this.status = status;
		this.name = "OAuthRefreshError";
	}
};
/** 刷新一次 token；失败抛出（调用方按「不可用」处理）。 */
async function refreshOAuthCredential(deps, credential, signal) {
	const response = await deps.fetchImpl(`${authBaseOf(deps, credential)}/console/auth/device/token`, {
		redirect: "error",
		method: "POST",
		/**
		* **必须把 signal 传下去**（2026-11-04 外部审查 U03）。
		*
		* 原来这里一个 signal 都不传：刷新请求一旦挂起，调用者的停止与总期限**都不起作用** ——
		* 请求既不完成也不抛错，宿主等不到终态，于是「停止」像没反应，
		* 自动重试也永远等不到机会（它要等前一次失败落定）。
		*/
		...signal === void 0 ? {} : { signal },
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify({
			grant_type: "refresh_token",
			refresh_token: credential.refresh,
			client_id: OAUTH_CLIENT_ID
		})
	});
	const payload = await readJson(response);
	if (!response.ok || !isRecord$2(payload)) throw new OAuthRefreshError(response.status);
	const access = stringOf(payload, "access_token");
	const refresh = stringOf(payload, "refresh_token") ?? credential.refresh;
	const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0 ? payload.expires_in : void 0;
	if (access === void 0 || expiresIn === void 0) throw new Error("token refresh response is missing access_token/expires_in");
	const now = deps.now?.() ?? Date.now();
	return {
		...credential,
		access,
		refresh,
		expiresAt: now + Math.round(expiresIn * 1e3)
	};
}
/** 读工作区；读不到或形状不认识时 `undefined`（登录流按失败处理）。 */
async function fetchOAuthOrg(deps, access, signal) {
	const response = await deps.fetchImpl(`${authBaseOf(deps)}/console/api/orgs`, {
		redirect: "error",
		...signal === void 0 ? {} : { signal },
		headers: {
			authorization: `Bearer ${access}`,
			accept: "application/json"
		}
	});
	if (!response.ok) return void 0;
	const payload = await readJson(response);
	/**
	* 列表可能在顶层、`orgs`、`data`，或包在 `value` 里
	* （该 Console 用 `_tag` 风格的编码 —— 错误响应就是 `{"_tag":"Unauthorized"}`，
	* 成功也可能包一层 value）。
	*/
	const items = Array.isArray(payload) ? payload : isRecord$2(payload) && Array.isArray(payload.orgs) ? payload.orgs : isRecord$2(payload) && Array.isArray(payload.data) ? payload.data : isRecord$2(payload) && Array.isArray(payload.value) ? payload.value : [];
	for (const item of items) {
		if (!isRecord$2(item)) continue;
		const id = stringOf(item, "id");
		if (id === void 0) continue;
		const name = stringOf(item, "name");
		return {
			id,
			...name === void 0 ? {} : { name }
		};
	}
}
/** 把 blob 变成一次请求可用的 access token 与头；过期则刷新。 */
async function resolveOAuthCredential(raw, deps, options) {
	const credential = parseOAuthCredential(raw);
	if (credential === void 0) return void 0;
	if (!needsRefresh(credential, deps.now?.() ?? Date.now())) return {
		key: credential.access,
		headers: { "x-opencode-org-id": credential.orgId }
	};
	if (credential.refresh === "") return void 0;
	try {
		const refreshed = await refreshOAuthCredential(deps, credential, options?.signal);
		return {
			key: refreshed.access,
			headers: { "x-opencode-org-id": refreshed.orgId },
			updated: serializeOAuthCredential(refreshed)
		};
	} catch (error) {
		if (options?.throwOnTransient && (!(error instanceof OAuthRefreshError) || error.status === 408 || error.status === 429 || error.status >= 500)) throw error;
		return;
	}
}
//#endregion
//#region src/vendors/opencode/failures.ts
/**
* opencode 网关原始失败 → 统一失败分类。
*
* 本模块是纯函数：只读入 HTTP 状态与已解析的错误正文，产出一个 {@link Rejection}；
* 不做 I/O、不持有状态、不认识账号。分类口径逐条对照旧插件
* `dsh-opencode-go/lib/index.js` 的 `classifyGatewayError`（**第 7038-7069 行**）：
* **先按 `error.type` / `error.code` 归一化后的字符串匹配**，命中词表就定了分类，
* 只有词表全不命中时才回落到 HTTP 状态 —— 顺序即优先级，不能倒过来。
*
* 与旧插件的差别只有一处：旧插件返回一个内部码（`QUOTA` / `AUTH` / …）再由调用方
* 决定是否换账号；这里直接映射成内核的 {@link Rejection}，并用 `undefined` 表示
* **请求级**拒绝（换账号没有意义：请求畸形、模型不存在、上下文超限）。
*
* 词表命中行号（旧插件）：
* - `UNKNOWN_MODEL`：第 7046 行
* - `QUOTA`：第 7047-7054 行（`creditserror` / `monthlylimiterror` / `userlimiterror` /
*   `gousagelimiterror` / `insufficientquota` / `quotaexceeded`）
* - `INVALID_CREDENTIAL`：第 7055 行（`autherror` / `authenticationerror` /
*   `invalidapikey` / `invalidkey`）
* - `AUTH`（本适配器归入 `unavailable`）：第 7056 行（`regionerror` / `datapolicyerror` /
*   `permissionerror` / `permissiondenied`）
* - `RATE_LIMIT`：第 7057 行（`ratelimiterror` / `ratelimitexceeded`）
* - 文案与状态回落：第 7058-7069 行
*
* 旧插件另有一个 `isGatewayKeyRejection`（**第 6981-6983 行**，判据是
* `failure.code === "INVALID_CREDENTIAL"`），用来把被拒的密钥记进短期黑名单；
* 本适配器不做那张表 —— 内核的 `RotationEngine.markRejected` 就是同一个职责，
* 且分类已经带着 `kind: "invalid-credential"`，不需要第二个判据。
* @module dsh-llm-account/src/vendors/opencode/failures
*/
/** 结构化词表：`error.type` / `error.code` 归一化后逐项比对（旧插件第 7046-7057 行）。 */
const UNKNOWN_MODEL_TYPES = /* @__PURE__ */ new Set([
	"modelerror",
	"modelnotfound",
	"unknownmodel"
]);
/** 额度用尽（旧插件第 7047-7054 行）。 */
const QUOTA_TYPES = /* @__PURE__ */ new Set([
	"creditserror",
	"monthlylimiterror",
	"userlimiterror",
	"gousagelimiterror",
	"insufficientquota",
	"quotaexceeded"
]);
/** 密钥失效（旧插件第 7055 行）。 */
const INVALID_CREDENTIAL_TYPES = /* @__PURE__ */ new Set([
	"autherror",
	"authenticationerror",
	"invalidapikey",
	"invalidkey"
]);
/** 地域/数据政策/权限闸门（旧插件第 7056 行的 `AUTH`）：同一账号换 key 也过不去，归 `unavailable`。 */
const UNAVAILABLE_TYPES = /* @__PURE__ */ new Set([
	"regionerror",
	"datapolicyerror",
	"permissionerror",
	"permissiondenied"
]);
/** 限流（旧插件第 7057 行）。 */
const RATE_LIMIT_TYPES = /* @__PURE__ */ new Set(["ratelimiterror", "ratelimitexceeded"]);
/** 401/403 文案里点名密钥失效（旧插件第 7060 行）。 */
const INVALID_KEY_PROSE = /(?:invalid|incorrect|expired)[ _-]?(?:api[ _-]?)?key|invalid credential/i;
/**
* 没有 HTTP 状态时的文案判据（旧插件 `classifyPiAiError` 第 1698-1710 行）。
*
* 这张表存在的理由和结构化词表一样：**「认不出来」不等于「网络抖动」**。旧插件对无法归类的
* pi-ai 失败返回 `PI_AI_ERROR`（第 1710 行）—— 一个确定性的、不入重试白名单的终态；只有文案
* 真的像传输问题（`network` / `connection` / `socket` / `fetch` / `ECONN*` / `premature close` /
* 流提前结束…）才当瞬时故障。若把「认不出来」一律当 `network`，一个确定性的流内失败
* （例如供应商在 200 的 SSE 里报的拒绝）就会在每个账号上重放，并被宿主当成可重试的 TRANSPORT。
*
* `kind: undefined` 表示请求级（`INVALID_REQUEST` 语义）：换账号没有意义，也不该重试。
*/
const IN_BAND_RULES = [
	{
		pattern: /\b(?:401|403)\b/,
		kind: "unavailable"
	},
	{
		pattern: /\b429\b|rate.?limit/i,
		kind: "rate-limit"
	},
	{
		pattern: /\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i,
		kind: void 0
	},
	{
		pattern: /\b400\b|invalid.?request/i,
		kind: void 0
	},
	{
		pattern: /\b5\d\d\b/,
		kind: "server"
	},
	{
		pattern: /\btime(?:d)?\s*out\b|timeout/i,
		kind: "network"
	},
	{
		pattern: /stream ended (?:before|without)\b/i,
		kind: "network"
	},
	{
		pattern: /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i,
		kind: "network"
	},
	{
		pattern: /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i,
		kind: "network"
	},
	{
		pattern: /\bterminated\b|premature close/i,
		kind: "network"
	}
];
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串字段。 */
function stringValue$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* 归一化一份错误正文（旧插件第 7039-7045 行）。
*
* 旧插件拿到的是**原始响应文本**，先 `JSON.parse`，失败就什么都不认；成功时优先取
* 嵌套的 `error` 对象，没有则把根对象当错误对象。类型词表由 `type` 与 `code` 各取一个，
* 去掉所有非字母数字字符再小写（`insufficient_quota` 与 `InsufficientQuota` 折成同一个
* `insufficientquota`）。
* @param body - 已解析的正文，或原始文本。
* @returns 诊断字段与归一化词表。
*/
function readGatewayError(body) {
	let parsed = body;
	if (typeof body === "string") try {
		parsed = JSON.parse(body);
	} catch {
		parsed = void 0;
	}
	const root = isRecord$1(parsed) ? parsed : void 0;
	const source = (root !== void 0 && isRecord$1(root.error) ? root.error : void 0) ?? root;
	if (source === void 0) return { types: [] };
	const type = stringValue$1(source.type);
	const code = stringValue$1(source.code);
	const message = stringValue$1(source.message);
	const types = [type, code].filter((value) => value !== void 0).map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase());
	return {
		...type === void 0 ? {} : { type },
		...code === void 0 ? {} : { code },
		...message === void 0 ? {} : { message },
		types
	};
}
/** 原始正文的文本形态（类型词表全不命中时，状态回落与文案匹配都在它上面做）。 */
function rawTextOf(body) {
	if (typeof body === "string") return body;
	if (body === void 0 || body === null) return "";
	try {
		return JSON.stringify(body) ?? "";
	} catch {
		return "";
	}
}
/**
* opencode 状态/正文 → 统一失败分类（旧插件 `classifyGatewayError` 第 7038-7069 行）。
*
* 口径（顺序即优先级）：
* - 词表命中模型不存在 → `undefined`：请求级，换账号没有意义；
* - 词表命中 {@link QUOTA_TYPES} → `quota`；{@link INVALID_CREDENTIAL_TYPES} → `invalid-credential`；
*   {@link UNAVAILABLE_TYPES} → `unavailable`；{@link RATE_LIMIT_TYPES} → `rate-limit`；
* - 未拿到响应（`status <= 0`）→ 先看文案是否点名配额/密钥失效，再按旧插件 `classifyPiAiError`
*   第 1698-1710 行的文案表归入限流 / 5xx / 超时 / 传输；**认不出来就返回 `undefined`** ——
*   确定性的流内终态既不换账号重放，也不该被宿主当瞬时故障重试；
* - 401/402/403/429 且文案像配额用尽 → `quota`；401/403 且文案点名密钥失效 → `invalid-credential`；
* - 401/402/403 → `unavailable`；404 → `undefined`；429 → `rate-limit`；
* - 408/504 与 5xx → `server`（瞬时，不污染账号状态）；
* - 400/413/422 → `undefined`（请求本身被拒）；
* - 其余 → `undefined`。
* @param status - HTTP 状态码；`0` 表示没拿到响应（流中途事件或传输失败）。
* @param body - 已解析的响应正文，或原始文本。
* @returns 账号级失败分类；请求级（不可轮换）拒绝时为 `undefined`。
*/
function classifyGatewayFailure(status, body) {
	const parsed = readGatewayError(body);
	const rawText = rawTextOf(body);
	const message = parsed.message ?? rawText;
	const has = (set) => parsed.types.some((type) => set.has(type));
	if (has(UNKNOWN_MODEL_TYPES)) return;
	if (has(QUOTA_TYPES)) return rejection("quota", `opencode 拒绝了本次请求（${parsed.type ?? parsed.code ?? "quota"}）：该账号的额度已用尽`);
	if (has(INVALID_CREDENTIAL_TYPES)) return rejection("invalid-credential", "opencode 返回鉴权失败：该账号的 API 密钥缺失或无效，请重新登录或更换密钥");
	if (has(UNAVAILABLE_TYPES)) return rejection("unavailable", `opencode 拒绝了本次请求（${parsed.type ?? parsed.code ?? "auth"}）：该账号在当前地域或政策下无法服务这个模型`);
	if (has(RATE_LIMIT_TYPES)) return rejection("rate-limit", "opencode 返回限流：当前账号被限流，未公布重置时间，按短冷却处理");
	if (status <= 0) {
		if (isQuotaExceededError(message)) return rejection("quota", `opencode 请求失败：${message}`);
		if (INVALID_KEY_PROSE.test(message)) return rejection("invalid-credential", `opencode 请求失败：${message}`);
		const rule = IN_BAND_RULES.find((entry) => entry.pattern.test(message));
		if (rule === void 0) return;
		if (rule.kind === void 0) return void 0;
		if (rule.kind === "network") return rejection("network", `opencode 请求未获得响应：${message === "" ? "连接失败（网络或代理问题）" : message}，已按瞬时故障处理`);
		return rejection(rule.kind, `opencode 流内失败（${rule.kind}）：${message}`);
	}
	if ([
		401,
		402,
		403,
		429
	].includes(status) && isQuotaExceededError(message)) return rejection("quota", `opencode 返回 HTTP ${status}：该账号的额度已用尽`);
	if ((status === 401 || status === 403) && INVALID_KEY_PROSE.test(message)) return rejection("invalid-credential", "opencode 返回 401/403：该账号的 API 密钥缺失或无效，请重新登录或更换密钥");
	if (status === 401 || status === 402 || status === 403) return rejection("unavailable", `opencode 返回 HTTP ${status}：该账号无法完成这次请求（地域、数据政策或账号权限）`);
	if (status === 404) return;
	if (status === 429) return rejection("rate-limit", "opencode 返回 429：当前账号被限流，未公布重置时间，按短冷却处理");
	if (status === 408 || status === 504 || status >= 500) return rejection("server", `opencode 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
	if (status === 400 || status === 413 || status === 422) return;
}
/**
* 分类到宿主错误码的映射（与 commandcode 适配器共用一套词汇表）。dsh-llm-retry 只按
* 错误码决定重试，所以瞬时/可恢复的分类必须落在 `providerRetryPolicy` 的白名单里。
*/
const FAILURE_CODES = {
	quota: "QUOTA",
	"rate-limit": "RATE_LIMIT",
	"invalid-credential": "INVALID_CREDENTIAL",
	unavailable: "PROVIDER_HTTP_ERROR",
	server: "SERVER",
	network: "TRANSPORT"
};
/**
* 把一次拒绝翻译成宿主认识的 `LlmError`（保留原始 HTTP 状态与 cause）。
* @param value - 已分类的拒绝。
* @param status - 观察到的 HTTP 状态；未拿到响应时省略。
* @param cause - 原始异常（诊断用）。
* @returns 带稳定 `code` 的宿主错误。
*/
function gatewayLlmError(value, status, cause) {
	const options = {
		...status !== void 0 && status > 0 ? { status } : {},
		...cause === void 0 ? {} : { cause }
	};
	return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
//#endregion
//#region src/vendors/opencode/dsml.ts
/**
* DSML 标记的正则片段。
*
* 分隔符在真机日志里是**全角**竖线 `｜`（U+FF5C），但模型偶尔也会输出半角 `|`。
* 两种都认，避免同一份语法因为一个字符就完全失效。
*/
const BAR = "[｜|]";
/** `<｜DSML｜ calls>` … `</｜DSML｜ calls>` 整块。 */
const CALLS_BLOCK = new RegExp(`<${BAR}\\s*DSML\\s*${BAR}\\s*calls>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*calls>`, "g");
/** 块内的每一次 `<｜DSML｜ invoke name="x">` … `</｜DSML｜ invoke>`。 */
const INVOKE_BLOCK = new RegExp(`<${BAR}\\s*DSML\\s*${BAR}\\s*invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*invoke>`, "g");
/** 一次调用里的参数：`<｜DSML｜ parameter name="x" [string="true"]>值</｜DSML｜ parameter>`。 */
const PARAMETER_BLOCK = new RegExp(`<${BAR}\\s*DSML\\s*${BAR}\\s*parameter\\s+name="([^"]+)"([^>]*)>([\\s\\S]*?)<\\/${BAR}\\s*DSML\\s*${BAR}\\s*parameter>`, "g");
/**
* 把一个参数值还原成 JSON 值。
*
* 声明了 `string="true"` 时**一定是字符串**（否则 `sessionId` 这类纯数字 id 会被
* 解析成数字，工具收到的类型就变了）。没有声明时才尝试按 JSON 解析，失败就退回字符串。
* @param value - 标签之间的原文。
* @param attributes - `name` 之后的属性串。
* @returns 可直接 `JSON.stringify` 的值。
*/
function parameterValue(value, attributes) {
	if (/\bstring\s*=\s*"true"/.test(attributes)) return value;
	const trimmed = value.trim();
	if (trimmed === "") return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}
/**
* 从一段文本里抢救出所有 DSML 工具调用。
* @param source - 模型输出（正文或 reasoning 的累计文本）。
* @returns 解析出的调用；没有 DSML 块或解析不出调用时为空数组。
*/
function parseDsmlCalls(source) {
	if (!source.includes("DSML")) return [];
	const calls = [];
	CALLS_BLOCK.lastIndex = 0;
	for (let block = CALLS_BLOCK.exec(source); block !== null; block = CALLS_BLOCK.exec(source)) {
		const body = block[1] ?? "";
		INVOKE_BLOCK.lastIndex = 0;
		for (let invoke = INVOKE_BLOCK.exec(body); invoke !== null; invoke = INVOKE_BLOCK.exec(body)) {
			const name = (invoke[1] ?? "").trim();
			if (name === "") continue;
			const parameters = {};
			const inner = invoke[2] ?? "";
			PARAMETER_BLOCK.lastIndex = 0;
			for (let parameter = PARAMETER_BLOCK.exec(inner); parameter !== null; parameter = PARAMETER_BLOCK.exec(inner)) {
				const key = (parameter[1] ?? "").trim();
				if (key === "") continue;
				parameters[key] = parameterValue(parameter[3] ?? "", parameter[2] ?? "");
			}
			calls.push({
				name,
				arguments: JSON.stringify(parameters)
			});
		}
	}
	return calls;
}
//#endregion
//#region src/vendors/opencode/adapter.ts
/**
* opencode 的宿主适配器：把共享内核串成一次真实请求。
*
* 一次 `stream()` 的固定顺序（设计 §9.1）：
* **回合循环本身不在本文件**：选账号、换号闸门（`rotation.fallbackAllowed`）、试用上限、
* 「用尽时抛哪一条」、换模型与跨厂商委托，全部由 `core/attempt-loop` 统一实现
* （2026-11-07 抽出；此前三家各写一份，同一个 bug 要修三次且总会漏）。
* 本文件只提供本家特有的东西：凭据怎么取、请求怎么发、失败怎么分类、chunk 要不要改写。
*/
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
const RETRY_MAX_DELAY_MS = 9e5;
/**
* 路由的重试白名单（控制器裁决 12）。`LLM_REQUEST_TIMEOUT` 与
* `LLM_STREAM_IDLE_TIMEOUT` **不在**宿主的 `DEFAULT_RETRYABLE_CODES` 里，必须在此显式列出；
* 保留这两个具体码（不退化成一个 `TIMEOUT`）是为了区分「整请求超时」与「流空闲超时」。
*/
const RETRYABLE_CODES = [
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"THROTTLED",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT",
	LLM_REQUEST_TIMEOUT,
	LLM_STREAM_IDLE_TIMEOUT
];
/** 填默认值；`0`/负数/NaN 一律回落到默认值，避免把坏配置变成「立即超时」。 */
function resolveConfig(raw) {
	const positive = (value, fallback) => value !== void 0 && Number.isFinite(value) && value > 0 ? value : fallback;
	const ttl = raw.catalogTtlMs;
	return {
		apiBase: raw.apiBase !== void 0 && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_BASE_URL,
		requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
		streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
		defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS),
		catalogTtlMs: ttl !== void 0 && Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_CATALOG_TTL_MS
	};
}
/** 分类出的一次失败：分类结果，以及轮换用尽时要抛给宿主的错误（共享类型见 `core/attempt-ledger`）。 */
/** opencode 适配器：宿主 `LlmAdapter` 的一个真实子类。 */
var OpencodeAdapter = class extends LlmAdapter {
	#deps;
	/**
	* 按「基地址 + 目录令牌」缓存的目录（同一基地址复用 TTL 缓存）。
	*
	* **键里必须带令牌**（2026-11-08 起目录请求带 Bearer）：不同账号可能订阅不同模型，
	* 只按 `baseUrl` 做键会把 A 账号读到的清单当成 B 账号的。
	*/
	#catalogs = /* @__PURE__ */ new Map();
	/**
	* 按账号 ref 合并并发的 OAuth 刷新（2026-10-22 修 bug 审查 LOW-1）。
	*
	* 同一账号上并发的请求共享**一次**刷新：若各自刷，服务端启用 refresh token 轮换时
	* 后一次会用已失效的旧 token，那次刷新失败、该请求失败。实现见
	* `core/single-flight`（抽成独立模块以便直接测生产代码，而不是复刻一份逻辑）。
	*/
	#singleFlight = createSingleFlight();
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
	#credentialGuard;
	/**
	* @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
	*/
	constructor(deps) {
		super();
		this.#deps = deps;
		this.#credentialGuard = deps.credentialGuard ?? createCredentialGuard();
	}
	/** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
	providerInfo(provider) {
		return {
			id: provider,
			name: "OpenCode Go"
		};
	}
	/**
	* 路由的重试白名单（控制器裁决 12）：与 Task 9 的 commandcode 路由同一套值。
	* `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` 必须显式列出（宿主的默认白名单里没有）。
	* @returns 已解析的重试策略。
	*/
	providerRetryPolicy(_provider) {
		return resolveRetryPolicy({
			mode: "normal",
			maxRetries: 1e3,
			retryableCodes: [...RETRYABLE_CODES],
			backoff: {
				initialDelayMs: 500,
				maxDelayMs: RETRY_MAX_DELAY_MS,
				jitterRatio: .1
			}
		}, "llm-opencode-go: retryPolicy");
	}
	/**
	* 拉目录 → 应用可见性规则 → 映射为宿主形状（旧插件 `listModels` 第 7390-7399 行）。
	*/
	async listModels(provider) {
		if (!await this.#hasAnyAccount()) return [];
		const revision = catalogCandidateRevision();
		const raw = this.#deps.config();
		const records = await this.#catalog(resolveConfig(raw), void 0);
		const visible = selectVisible(records.map((record) => record.entry), normalizeVisibility(raw));
		noteCatalogModels(provider, visible.map((entry) => ({
			id: entry.id,
			...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
			...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
		})), void 0, revision);
		return visible.map((entry) => ({
			provider,
			id: entry.id,
			name: entry.name,
			inputModalities: entry.inputModalities
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
	async catalogModels(fresh = false) {
		return (await this.#catalog(resolveConfig(this.#deps.config()), void 0, fresh)).map((record) => ({
			id: record.entry.id,
			...record.entry.name === "" ? {} : { name: record.entry.name },
			...record.company === void 0 ? {} : { company: record.company },
			...record.free === true ? { free: true } : {}
		}));
	}
	/**
	* 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力，再套
	* `modelLimits` 覆盖；目录不可用或没有该模型时退化成「只有 id 的目录外模型」
	* （旧插件 `resolveModel` 第 7400-7402 行 + `withModelLimit` 第 7341-7350 行）。
	*/
	async resolveModel(provider, model, signal) {
		const raw = this.#deps.config();
		const config = resolveConfig(raw);
		let record;
		try {
			record = (await this.#catalog(config, signal)).find((candidate) => candidate.entry.id === model);
		} catch {
			record = void 0;
		}
		const entry = record?.entry;
		const limits = raw.modelLimits?.[model];
		const contextWindow = limits?.contextWindow ?? entry?.contextWindow;
		const maxTokens = limits?.maxTokens ?? entry?.maxTokens;
		const efforts = record?.efforts ?? entry?.efforts ?? [];
		return {
			provider,
			id: model,
			name: entry?.name ?? officialModelName(model),
			inputModalities: entry?.inputModalities ?? ["text"],
			...contextWindow === void 0 ? {} : { context: { contextWindow } },
			...maxTokens === void 0 ? {} : { defaultMaxTokens: maxTokens },
			systemPromptUpdate: "in-history",
			toolUpdate: "addition-only",
			...efforts.length === 0 ? {} : { reasoning: { efforts: efforts.map((effort) => ({
				id: ReasoningEffortId(effort),
				name: effort
			})) } }
		};
	}
	/**
	* 流式请求：账号轮换 → 凭据 → pi-ai 请求 → 时间预算 → 失败分类 → 有条件的账号回退。
	* @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
	* @returns 与线上同序的 chunk 流。
	*/
	/**
	* 流式请求：账号轮换、失败分类、有条件的账号回退，**全部交给共享的回合循环**
	* （`core/attempt-loop`，2026-11-07 抽出；此前三家各写一份，同一个 bug 要修三次且总会漏）。
	*
	* 这里只提供 OpenCode 特有的五件事：配置解析、鉴权（可能抛可重试错误）、一次尝试、
	* 失败分类（要读网关证据）、chunk 改写（DSML 抢救 + pi-ai 终态转换）。
	* @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
	* @returns 与线上同序的 chunk 流。
	*/
	stream(options) {
		/**
		* 配置在**选号之后**才读（与抽取前同一顺序）：`beforeRequest` 可能改设置，
		* 先读会拿到旧值。用惰性 + 记忆化，一个请求内只解析一次。
		*/
		let snapshot;
		const raw = () => snapshot ??= this.#deps.config();
		return runAttemptLoop({
			label: "llm-opencode-go",
			rotation: this.#deps.rotation,
			maxTried: () => this.#maxTried(),
			resolveConfig: raw,
			isAbort: (error) => this.#isAbort(error),
			abortError: (signal) => this.#abortError(signal),
			beforeRequest: (input) => this.#deps.beforeRequest?.(input),
			fallbackModel: (current, kind) => this.#fallbackModel(current, kind),
			delegate: (target, current) => delegateStream(target, current),
			beginAttempt: () => recordGatewayFetch(this.#deps.fetchImpl, options.signal),
			resolveCredential: async (ref, signal) => {
				const epoch = this.#credentialGuard.epochOf(ref);
				const auth = await this.resolveAccountAuth(ref, signal);
				return auth === void 0 ? void 0 : {
					...auth,
					ref,
					epoch
				};
			},
			classifyCredentialError: (error) => {
				if (!(error instanceof LlmError) || ![
					"SERVER",
					"TRANSPORT",
					"RATE_LIMIT",
					"LLM_REQUEST_TIMEOUT",
					"LLM_STREAM_IDLE_TIMEOUT"
				].includes(error.code)) return;
				return {
					rejection: {
						kind: error.code === "RATE_LIMIT" ? "rate-limit" : error.code === "SERVER" ? "server" : "network",
						message: error.message
					},
					thrown: error
				};
			},
			missingCredential: (ref) => {
				const rejection = {
					kind: "invalid-credential",
					message: `OpenCode Go account "${ref}" has no usable API key`
				};
				this.#deps.rotation.markRejected(ref, rejection);
				return {
					rejection,
					thrown: new LlmError(`llm-opencode-go: no API key for OpenCode Go account "${ref}"; store it through the credentials service or export it in the launching environment`, "MISSING_CREDENTIAL")
				};
			},
			attempt: (config, current, auth, gateway) => this.#attempt(config, current, auth, gateway),
			classify: async (error, gateway) => this.#classify(error, await gateway.evidence()),
			recordUsage: (ref, model, outcome, counts, kind) => this.#recordUsage(ref, model, outcome, counts, kind),
			noteSettled: (ref) => this.#deps.rotation.noteSettled(ref),
			promoteServed: (ref) => this.#deps.promoteServed?.(ref),
			/**
			* 请求级拒绝：换账号没有意义。pi-ai 的证据载体换成宿主认识的稳定终态码
			* （`PI_AI_ERROR`），否则宿主会把它当未知错误处理。
			*/
			wrapRequestLevelError: (error) => error instanceof OpencodeStreamFailure ? new LlmError(error.message, PI_AI_ERROR_CODE, { cause: error }) : error,
			noAccount: (model) => new LlmError(`llm-opencode-go: no OpenCode Go account is available for model "${model}"; add an account or store its API key`, "MISSING_CREDENTIAL"),
			/**
			* pi-ai 把「空响应 / 上下文溢出」这类终态包成 finish：它是**宿主**的错误码
			* （EMPTY_RESPONSE / CONTEXT_WINDOW_EXCEEDED 都在重试白名单里），交给宿主，
			* 不在这里当成账号级失败重放。抛出即终止本次尝试，不参与换号分类。
			*/
			onChunk: (state, chunk) => {
				if (chunk.type === "finish" && chunk.reason.kind === "error") throw new LlmError(chunk.reason.failure.message, chunk.reason.failure.code);
				if (chunk.type !== "finish" || state.sawToolCall) return void 0;
				/**
				* DSML 抢救（2026-11-07）：模型把工具调用写成文本，网关没解析。
				*
				* 补发成真正的工具调用块，并把 finish 改成 `tool-calls` —— 否则宿主会当成
				* 「模型自己停了」而结束这一轮（用户看到的就是任务莫名中断）。只在**一个工具
				* 调用都没出现过**时才做：网关已经给了结构化 `tool_calls` 时不重复执行。
				*
				* ## 只扫描用户可见正文（2026-11-10 审查 A02）
				*
				* `state.text` 现在**不含 reasoning**（见 `StreamPumpState.text`）。推理是
				* 模型的自言自语：它完全可能一边思考一边把 DSML 语法写出来（「格式大概是
				* `<｜DSML｜ calls>` 这样……」），把那段当调用意图执行就是在按错误依据行事。
				*
				* ## 工具名必须在**本轮真实提供**的清单里（审查 A02，P1）
				*
				* 原来这里解析出什么就补什么，完全不看 `options.tools`。后果：
				*
				* - 模型在普通回复里**举例**说明 DSML 怎么写时，这段示例会被执行成真实调用；
				* - 名字根本不在本轮工具清单里的调用也会被补发，等于凭空扩大可用工具面。
				*
				* 现在要求**全部**解析结果都在清单内，否则整段放弃（退回普通文本）：
				* 只要有一个名字不在清单里，就说明这段更可能是「示例/回显」而不是真调用，
				* 此时宁可少救一次，也不能误执行一次。
				*
				* 剩余风险（如实记）：如果模型在正文里完整写出一段**引用了已授权工具**的
				* DSML 示例，仍会被救成调用 —— 纯文本层面区分不了「引用」与「意图」。
				* 这道白名单只保证「不会调用未提供的工具」。
				*/
				const salvaged = parseDsmlCalls(state.text);
				if (salvaged.length === 0) return void 0;
				const offered = new Set((options.tools ?? []).map((tool) => tool.name));
				if (salvaged.some((call) => !offered.has(call.name))) return void 0;
				let index = state.lastBlockIndex + 1;
				let ordinal = 0;
				const chunks = [];
				for (const call of salvaged) {
					const id = ToolCallId(`dsml_${index}_${ordinal}`);
					chunks.push({
						type: "block-start",
						index,
						blockType: "tool-call"
					});
					chunks.push({
						type: "tool-call-delta",
						index,
						id,
						name: call.name,
						argumentsDelta: call.arguments
					});
					chunks.push({
						type: "block-end",
						index,
						block: {
							type: "tool-call",
							id,
							name: call.name,
							arguments: call.arguments
						}
					});
					index += 1;
					ordinal += 1;
				}
				chunks.push({
					type: "finish",
					reason: { kind: "tool-calls" }
				});
				return chunks;
			},
			deferUsage: true,
			usageCountsAsEmitted: false
		}, options);
	}
	/**
	* 把一次尝试的结果交给用量端口（旁路：绝不因为统计失败而改变请求结果）。
	* @param account - 服务这次请求的账号 ref。
	* @param model - 模型 id。
	* @param outcome - 成功或失败。
	* @param counts - 本次累计的四个 token 计数。
	* @param failureKind - 失败分类（成功时不传）。
	*/
	#recordUsage(account, model, outcome, counts, failureKind) {
		const port = this.#deps.usage ?? NOOP_USAGE_PORT;
		try {
			port.record({
				vendor: "dsh-opencode-go",
				account,
				outcome,
				...model === void 0 ? {} : { model },
				...counts,
				...failureKind === void 0 ? {} : { failureKind }
			});
		} catch (error) {
			console.warn("[dsh-llm-account] could not record the usage sample:", error);
		}
	}
	/** 一次尝试：装模型 → 投影上下文 → 经 pi-ai 发出 → 套上时间预算。 */
	async *#attempt(raw, options, auth, gateway) {
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
		const attemptSignal = options.signal === void 0 ? network.signal : AbortSignal.any([options.signal, network.signal]);
		const record = await this.#recordFor(config, options.model, attemptSignal, auth);
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
		const requested = options.maxTokens === void 0 ? cap : Math.min(options.maxTokens, cap);
		const maxTokens = modelLimit === void 0 ? requested : Math.min(requested, modelLimit);
		/** 宿主声明的档位（`low`/`high`/`max`），既进 thinkingLevelMap 也决定可选项。 */
		const efforts = record?.efforts ?? entry?.efforts ?? [];
		const model = buildPiModel({
			id: options.model,
			name: entry?.name ?? officialModelName(options.model),
			api: record?.api ?? "anthropic-messages",
			...contextWindow === void 0 ? {} : { contextWindow },
			...modelLimit === void 0 ? {} : { maxTokens: modelLimit },
			reasoning: record?.reasoning === true,
			...efforts.length === 0 ? {} : { efforts },
			inputModalities: entry?.inputModalities ?? ["text"]
		}, config.apiBase);
		yield* runStream(streamOpencode({
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
			headers: {
				...auth.headers ?? {},
				...opencodeSessionHeaders(options.sessionId)
			},
			/**
			* **把用户选的思考强度真正交给协议层**（2026-11-04 外部审查 U06）。
			*
			* 1.9.0 只在 `protocol.ts` 里做了透传，**adapter 这一层没接** —— 于是协议层
			* 永远收不到值，三档出站全部缺失。审查的批评是对的：「不要只测底层协议函数」，
			* 而当时的测试正是只测了协议函数。回归测试现在从 `adapter.stream` 进入。
			*/
			...options.reasoningEffort === void 0 ? {} : { reasoningEffort: options.reasoningEffort },
			fetchImpl: gateway.fetch,
			signal: attemptSignal,
			...options.temperature === void 0 ? {} : { temperature: options.temperature },
			maxTokens
		}), {
			requestTimeoutMs: config.requestTimeoutMs,
			streamIdleTimeoutMs: config.streamIdleTimeoutMs
		}, {
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
			}
		});
	}
	/** 找一条目录记录；目录不可用时退化成「只有 id」的目录外模型（不抛）。 */
	async #recordFor(config, model, signal, auth) {
		try {
			return (await this.#catalog(config, signal, false, auth)).find((candidate) => candidate.entry.id === model);
		} catch {
			return;
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
	async #resolveAuth(ref, epochAtStart) {
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
			...stored === void 0 ? {} : { stored },
			...environment === void 0 ? {} : { environment }
		}).key;
		if (raw === void 0) return void 0;
		if (!raw.startsWith("ocoauth1:")) return { key: raw };
		/**
		* OAuth 刷新按 ref 去重（2026-10-22 修 LOW-1）：同一账号上并发请求共享一次刷新。
		*
		* 只有「需要刷新」时才走这段 —— `resolveOAuthCredential` 内部会先判断 token 是否
		* 即将过期，不新鲜时立即返回，那种情况（绝大多数）不该被去重表串行化。
		*/
		const resolved = await resolveOAuthCredential(raw, {
			fetchImpl: this.#deps.fetchImpl,
			...this.#deps.authBase === void 0 ? {} : { authBase: this.#deps.authBase },
			...this.#deps.now === void 0 ? {} : { now: this.#deps.now }
		}, {
			signal: AbortSignal.timeout(1e4),
			throwOnTransient: true
		});
		if (resolved === void 0) return void 0;
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
		if (resolved.updated !== void 0 && stored === raw) {
			const updated = resolved.updated;
			try {
				await this.#credentialGuard.run(ref, epochAtStart, async () => {
					await this.#deps.persistStored?.(ref, updated);
				});
			} catch {}
		}
		return {
			key: resolved.key,
			...resolved.headers === void 0 ? {} : { headers: resolved.headers }
		};
	}
	/** Chat and quota share refresh AND persistence; each waiter owns its cancellation. */
	async resolveAccountAuth(ref, signal) {
		if (signal?.aborted) throw this.#abortError(signal);
		const timeoutMs = resolveConfig(this.#deps.config()).requestTimeoutMs;
		const epoch = this.#credentialGuard.epochOf(ref);
		const pending = this.#singleFlight(`${ref}:${epoch}`, () => this.#resolveAuth(ref, epoch));
		let timer;
		let onAbort;
		try {
			return await Promise.race([pending, new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(new LlmError("OpenCode authentication timed out", LLM_REQUEST_TIMEOUT)), timeoutMs);
				if (signal !== void 0) {
					onAbort = () => reject(this.#abortError(signal));
					signal.addEventListener("abort", onAbort, { once: true });
				}
			})]);
		} catch (error) {
			if (error instanceof LlmError) throw error;
			const code = error instanceof OAuthRefreshError ? error.status === 429 ? "RATE_LIMIT" : error.status === 408 ? LLM_REQUEST_TIMEOUT : "SERVER" : error instanceof Error && error.name === "TimeoutError" ? LLM_REQUEST_TIMEOUT : "TRANSPORT";
			throw new LlmError(error instanceof Error ? error.message : String(error), code, { cause: error });
		} finally {
			if (timer !== void 0) clearTimeout(timer);
			if (onAbort !== void 0) signal?.removeEventListener("abort", onAbort);
		}
	}
	/** Freeze account and auth together, then cache only that credential's directory. */
	async #catalog(config, signal, fresh = false, attempt) {
		const ref = attempt?.ref ?? await this.#catalogRef();
		const epoch = attempt?.epoch ?? (ref === void 0 ? 0 : this.#credentialGuard.epochOf(ref));
		let auth = attempt;
		if (auth === void 0 && ref !== void 0) {
			const budget = AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS);
			const authSignal = signal === void 0 ? budget : AbortSignal.any([signal, budget]);
			auth = await this.resolveAccountAuth(ref, authSignal).catch(() => {
				signal?.throwIfAborted();
			});
		}
		signal?.throwIfAborted();
		const key = JSON.stringify([config.apiBase, ref]);
		const identity = createHash("sha256").update(JSON.stringify([
			epoch,
			auth?.key,
			auth?.headers
		])).digest("hex");
		const cached = this.#catalogs.get(key);
		if (cached?.identity === identity) return cached.catalog.list(signal, fresh);
		const snapshot = auth;
		const catalog = createOpencodeCatalog({
			baseUrl: config.apiBase,
			fetchImpl: this.#deps.fetchImpl,
			ttlMs: config.catalogTtlMs,
			...snapshot === void 0 ? {} : { resolveKey: () => snapshot.key },
			...snapshot?.headers === void 0 ? {} : { authHeaders: snapshot.headers }
		});
		if (ref === void 0 || epoch === this.#credentialGuard.epochOf(ref)) this.#catalogs.set(key, {
			identity,
			catalog
		});
		return catalog.list(signal, fresh);
	}
	/** Select the account once for both discovery and its cache identity. */
	async #catalogRef() {
		let views;
		try {
			views = await this.#deps.accounts.list();
		} catch {
			return;
		}
		if (!Array.isArray(views) || views.length === 0) return void 0;
		const ref = (views.find((view) => view.active === true) ?? views.find((view) => view.configured === true) ?? views[0])?.ref;
		return typeof ref === "string" && ref !== "" ? ref : void 0;
	}
	/**
	* 当前是否**至少有一个**可用的账号条目。
	*
	* 「可用」= 账号端口能列出条目，且凭据能解析出 key（与发请求时的判定一致）。
	* 读账号/读凭据失败时返回 `true`（**宁可放过**）：一次读失败不该把整个模型
	* 列表清空，那比多列几个用不了的模型更糟。
	* @returns 是否有账号。
	*/
	async #hasAnyAccount() {
		let rows;
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
		for (const row of rows) try {
			const stored = this.#deps.resolveStored;
			const environment = this.#deps.resolveEnvironment;
			if (stored === void 0 && environment === void 0) return true;
			if (stored !== void 0 && await stored(row.ref) !== void 0) return true;
			if (environment !== void 0 && environment(row.ref) !== void 0) return true;
		} catch {
			return true;
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
	#maxTried() {
		const value = this.#deps.maxTried?.();
		return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 16;
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
	async #fallbackModel(options, failureKind) {
		if (this.#deps.autoSwitchModel?.() !== true) return void 0;
		const candidates = await this.#deps.fallbackCandidates?.();
		if (candidates === void 0 || candidates.length === 0) return void 0;
		let currentMeta = {};
		try {
			const entry = (await this.#catalog(resolveConfig(this.#deps.config()), void 0)).find((item) => item.entry.id === options.model)?.entry;
			if (entry !== void 0) currentMeta = {
				...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
				...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
			};
		} catch {}
		if (failureKind === "network") noteNetworkFailure(options.provider);
		const picked = pickFallbackModel({
			provider: options.provider,
			model: options.model,
			...currentMeta
		}, candidates.map((item) => ({
			provider: item.provider,
			model: item.model,
			...item.contextWindow === void 0 ? {} : { contextWindow: item.contextWindow },
			...item.effortCount === void 0 ? {} : { effortCount: item.effortCount },
			...item.inputModalities === void 0 ? {} : { inputModalities: item.inputModalities }
		})), {
			excludeProviders: failureKind === "network" ? recentlyNetworkDown() : [],
			requiresImages: hasImageInput(options.messages)
		});
		if (picked === void 0) return void 0;
		this.#deps.onModelFallback?.({
			provider: options.provider,
			model: options.model
		}, picked);
		return picked;
	}
	/**
	* 把一次尝试的异常分类成账号级拒绝；返回 `undefined` 表示这是请求级失败
	* （换账号没有意义），调用方应原样上抛。
	* @param error - 本次尝试抛出的异常。
	* @param evidence - `fetch` 边界观察到的（HTTP 状态，正文）；没有失败响应时缺省。
	*/
	#classify(error, evidence) {
		if (error instanceof OpencodeStreamFailure) {
			const status = error.status > 0 ? error.status : evidence?.status ?? 0;
			const rejection = classifyGatewayFailure(status, error.body ?? evidence?.body ?? { message: error.message });
			if (rejection === void 0) return void 0;
			return {
				rejection,
				thrown: gatewayLlmError(rejection, status, error)
			};
		}
		if (error instanceof LlmError) {
			if (error.code === ABORTED_CODE) return void 0;
			if (error.code === "LLM_REQUEST_TIMEOUT" || error.code === "LLM_STREAM_IDLE_TIMEOUT") {
				const rejection = classifyGatewayFailure(evidence?.status ?? 0, evidence?.body ?? { message: error.message });
				if (rejection === void 0) return void 0;
				return {
					rejection,
					thrown: error
				};
			}
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		const rejection = classifyGatewayFailure(evidence?.status ?? 0, evidence?.body ?? { message });
		if (rejection === void 0) return void 0;
		return {
			rejection,
			thrown: gatewayLlmError(rejection, evidence?.status, error)
		};
	}
	/** 识别「调用方中止」（`transport.ts` 未导出该码，故比字面量）。 */
	#isAbort(error) {
		return error instanceof LlmError && error.code === ABORTED_CODE;
	}
	/** 消费前已中止时抛出宿主认识的中止错误。 */
	#abortError(signal) {
		return signal?.reason === void 0 ? new LlmError("the caller aborted the request", ABORTED_CODE) : new LlmError("the caller aborted the request", ABORTED_CODE, { cause: signal.reason });
	}
};
/**
* 造一个 opencode 适配器实例（注册到宿主路由由 Task 14 完成）。
* @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
* @returns 宿主 `LlmAdapter` 子类实例。
*/
function createOpencodeAdapter(deps) {
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
async function imagesOf(options, resolve, signal) {
	const { images } = await collectImageBytes(options.messages, resolve, signal ?? options.signal);
	return images;
}
//#endregion
//#region src/vendors/opencode/accounts.ts
/**
* opencode 账号端口：真源在设置文档（命名空间 `llm-opencode-go`），每个操作
* **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；
* Review Focus 5）。
*
* 形状逐条对照旧插件 `dsh-opencode-go/lib/index.js`：
* - 设置命名空间 `llm-opencode-go`（旧插件第 8025 行的 `SETTINGS_NAMESPACE`）；
* - 账号条目 `{ id, name, apiKeyEnv }`（旧插件 Config schema 第 6825-6829 行），
*   身份是 `apiKeyEnv` 里的凭据引用名 ref；顶层 `apiKeyEnv` 是**当前账号**
*   （旧插件第 6824 行，`accountRefOf` 第 6784-6786 行把空串归一成默认引用名）；
* - `autoSwitch`（第 6830 行）；
* - `remove` 的候选回落顺序（旧插件第 8178-8180 行）：摘掉条目 → 若当前账号是它就
*   回落到剩余列表里的第一个（删空了才回到默认引用名）；
* - **合成的默认槽**：当前账号（顶层 `apiKeyEnv`）不在 `accounts[]` 里时，旧插件
*   `accountsOf`（第 6783-6790 行）补一条 `{ id: "legacy:<ref>", name: "", apiKeyEnv: ref }`
*   放在首位。`list()` 因此也补出这一行（`opencodeAccountSlot`），否则用户现有那种
*   「没有 `accounts` 键、只有顶层 `apiKeyEnv`」的行会一行账号都列不出来。
*
* **注意**：旧插件的设置文档里**没有** commandcode 那套 `modelAccountRules`，也**没有**
* `credentialCleanupRefs`（它的恢复状态叫 `accountOperations`，见下）。前者按模型绑定
* 属于 opencode 的模型可见性功能（`modelVisibility`，第 6819 行），不在本任务的
* `AccountPort` 契约里；后者是本项目为「删除账号后清理凭据」引入的字段（与 commandcode
* 同名同义），因为本项目的凭据删除由清理动作而不是删除操作本身负责。
*
* 本任务与计划原文的差异（控制器补充 3 优先）：
* - 计划 Step 3 描述的是旧插件的 `accountOperations` 恢复日志；本项目的意图日志是共享
*   内核的 `IntentLog`（Task 8），所以本模块**不**读写 `accountOperations`：
*   `IntentLog` 已经是「先记意图、崩溃后重放」的那一层。
* - 旧插件的 `move` 会把当前账号顺带改成队首（第 8451-8453 行）；这里保留这个行为
*   （见 `move` 的说明），因为旧插件读当前账号时本来就会把「不在账号表里的引用名」
*   回落到列表第一个。
*
* **标识空间**：账号身份一律是凭据引用名 ref（{@link opencodeAccountRef} 的产物或
* 存量文档里用户手写的引用名），存在条目的 `apiKeyEnv` 字段里。`name` 只用于展示，
* 改名**绝不**重新推导 ref（Task 4 复核护栏）。
*
* **写回纪律**：改条目时按字段覆盖（改 `name`、保留其它字段），改数组时只摘除目标条目，
* 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
* `{ id, name, apiKeyEnv }`，`key` 一律走凭据服务。
*
* **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
* 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops，所以重放的是
* 「用户的操作」而不是过期的 ops。
*
* **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`），
* 提交用的就是同一个 ref —— 重放因此按 ref 对齐，不必按 name 猜（同名标签合法）。提交还会按
* **最新文档**再判一次身份（ref 已在账号表里就不再追加条目、不再写凭据槽）。所有不改状态就
* 可能失败的校验（标签、密钥、账号数上限、没有空闲 ref）都跑在 `append` 之前。
*
* 本任务**不**做：网页登录（opencode 没有）、客户端页面（计划 1b）、代理与协议覆盖与诊断
* 导出（第 3 期）、用量胶囊与 TUI 页（第 2 期）。
* @module dsh-llm-account/src/vendors/opencode/accounts
*/
/** 设置命名空间（全局约束，不得更改）。 */
const OPENCODE_SETTINGS_NS = "llm-opencode-go";
/**
* 新账号 ref 的前缀（旧插件 `ACCOUNT_REF_PREFIX` 第 6781 行）。沿用旧插件的槽名前缀让
* 存量账号零迁移：旧文档里的 ref 就是 `DSH_OPENCODE_GO_ACCOUNT_<32 位十六进制>`，
* 新账号落在同一套命名里。
*/
const OPENCODE_ACCOUNT_REF_PREFIX = "DSH_OPENCODE_GO_ACCOUNT_";
/** 顶层 `apiKeyEnv` 的默认值（旧插件 `DEFAULT_ACCOUNT_REF` 第 6782 行）。 */
const OPENCODE_DEFAULT_REF = "OPENCODE_API_KEY";
/** 账号条目的凭据引用字段（旧插件 Config schema 第 6828 行）。 */
const REF_FIELD = "apiKeyEnv";
/** 账号条目的展示名称字段（旧插件 Config schema 第 6827 行）。 */
const LABEL_FIELD = "name";
/** 账号条目的标识字段（旧插件 Config schema 第 6826 行）。 */
const ID_FIELD = "id";
/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";
/** 当前固定账号字段（顶层 `apiKeyEnv`）。 */
const ACTIVE_FIELD = "apiKeyEnv";
/** 全局顺序字段（`vendor:ref` 键；两家文档保存同一份）。 */
const ORDER_FIELD = "accountOrder";
/**
* 待清理凭据引用数组字段。本项目引入（与 commandcode 同名同义）：删除账号只**记录**待清理的
* ref，真正 `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
*/
const CLEANUP_FIELD = "credentialCleanupRefs";
/** ref 撞名时的后缀尝试上限（与 commandcode 的同一上限）。 */
const MAX_REF_ATTEMPTS = 128;
/**
* 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
* 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
*/
const MAX_CONFLICT_RETRIES = 8;
/** 哈希后缀的十六进制位数（48 位）：足够隔离标签转义碰撞，同时保持槽名可读。 */
const HASH_SUFFIX_LENGTH = 12;
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const UINT64_MASK = 18446744073709551615n;
/**
* 计算文本的 64 位 FNV-1a 哈希，返回 16 位十六进制。
* 与 `core/accounts.ts` 的 `hashText` 同算法：ref 的形状由本适配器决定（旧插件的前缀），
* 但「标签不同、转义后同名」要靠同一个哈希区分。
* @param text - 原始文本。
* @returns 16 位小写十六进制字符串。
*/
function hashText(text) {
	let hash = FNV_OFFSET_BASIS;
	for (const char of text) {
		hash = (hash ^ BigInt(char.codePointAt(0) ?? 0)) & UINT64_MASK;
		hash = hash * FNV_PRIME & UINT64_MASK;
	}
	return hash.toString(16).padStart(16, "0");
}
/**
* 把任意文本折进 `[A-Z0-9_]`：先转大写，再把每个非法字符替换成 `_`（不折叠连续下划线 ——
* 折叠会丢信息，反而让不同标签更容易撞名）。
* @param text - 待转义的文本。
* @returns 只含大写字母、数字与下划线的文本。
*/
function escapeText(text) {
	return text.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}
/**
* 由账号标签推导 opencode 的账号 ref（同时用作凭据槽名）。
*
* 形状为 `DSH_OPENCODE_GO_ACCOUNT_<LABEL>_<HASH>`：沿用**旧插件的槽名前缀**（控制器补充 3，
* 存量账号零迁移），标签先转大写并把非 `[A-Za-z0-9_]` 的字符替换成 `_`，后缀是原始标签的
* 短哈希 —— 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足凭据引用名的合法
* 字符集 `^[A-Za-z_][A-Za-z0-9_]*$`。
*
* 与旧插件的差别：旧插件用随机 32 位十六进制 id，ref 与标签无关；这里让 ref 由标签确定性地
* 推导，好处是并发的同标签 `add` 会冻结到同一个 ref（提交时的身份闸门因此能挡住重复条目），
* 代价是撞名要加 `_2`、`_3`… 后缀（见 `freeRef`）。
* @param label - 用户可见名称。
* @returns 该账号的 ref，可安全用作凭据槽名。
*/
function opencodeAccountRef(label) {
	return `${OPENCODE_ACCOUNT_REF_PREFIX}${escapeText(label)}_${hashText(label).slice(0, HASH_SUFFIX_LENGTH)}`;
}
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 文档里的账号数组（形状不可信，`null` 与非数组一律当空）。 */
function rawAccounts(value) {
	const accounts = value[ACCOUNTS_FIELD];
	return Array.isArray(accounts) ? accounts : [];
}
/** 文档里的待清理引用数组（写回时同样原样保留）。 */
function rawCleanupRefs(value) {
	const refs = value[CLEANUP_FIELD];
	return Array.isArray(refs) ? refs : [];
}
/** 读一个账号条目的 ref（存量的合法凭据引用名），读不到时为 `undefined`。 */
function refOf(item) {
	if (!isRecord(item)) return void 0;
	const ref = normalizeKey(item[REF_FIELD]);
	return ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref) ? ref : void 0;
}
/** 读一个账号条目的展示名称。 */
function labelOf(item) {
	if (!isRecord(item)) return void 0;
	return normalizeKey(item[LABEL_FIELD]);
}
/** 文档里是否已有这个账号条目。 */
function hasAccount(value, ref) {
	return rawAccounts(value).some((item) => refOf(item) === ref);
}
/**
* 当前账号槽：**哨兵词汇只在这一个函数里决定**（缺失、空串与非法值都读作自动轮换 ——
* 旧插件 `accountRefOf` 第 6784-6786 行把空串归一成默认引用名，也就是「没有固定账号」）。
*
* `fallback` 是内置默认引用名 {@link OPENCODE_DEFAULT_REF}：它是旧插件合成默认槽时用的那个
* ref（第 6791-6792 行 `legacy:<ref>` 的 `<ref>`），所以 `slot.ref` 恰好就是「默认槽的 ref」。
* 入口的 `pinnedRefOf`/`defaultRefOf`（轮换引擎的固定账号与顺序首项）与端口的
* `activeRefOf`（`list()` 的 active、`remove()` 的回落）都读它。
* @param value - 现读的设置文档。
* @returns 归一化后的槽判定。
*/
function opencodeAccountSlot(value) {
	return readAccountSlot(value[ACTIVE_FIELD], { fallback: OPENCODE_DEFAULT_REF });
}
/**
* 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串与非法引用名都算自动）。
*/
function activeRefOf(value) {
	return opencodeAccountSlot(value).pinned ?? void 0;
}
/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label) {
	const next = normalizeKey(label);
	if (next === void 0) throw new Error("llm-opencode-go: account name must not be blank");
	return next;
}
/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key) {
	const next = normalizeKey(key);
	if (next === void 0) throw new Error("llm-opencode-go: API key must not be blank");
	return next;
}
/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error) {
	return isRecord(error) && error.code === "SETTINGS_CONFLICT";
}
/** 未知账号 ref（改名/换 key/固定/排序时用）。 */
function unknownRef(ref) {
	return /* @__PURE__ */ new Error(`llm-opencode-go: unknown account ref "${ref}"`);
}
/** 账号数超限（旧插件 `assertAccounts` 第 6798-6800 行的同一上限与同一拒绝姿态）。 */
function tooManyAccounts() {
	return /* @__PURE__ */ new Error(`llm-opencode-go: OpenCode Go supports at most 20 accounts`);
}
/**
* 给新账号挑一个未被占用的 ref：先是 {@link opencodeAccountRef} 的产物，撞名时按旧插件的
* 办法加数字后缀（`_2`、`_3`…）。
*
* 占用集合 = 现有账号条目的 ref ∪ 待清理的 ref ∪ 顶层当前账号引用。这条护栏是
* Review Focus 1 的机器化保证：两个账号永远不会共用同一个凭据槽，否则它们会互相污染
* 失效标记与额度。
* @param value - 当前设置文档。
* @param label - 新账号的展示名称。
* @returns 未被占用的 ref。
*/
function freeRef(value, label) {
	const occupied = /* @__PURE__ */ new Set();
	for (const item of rawAccounts(value)) {
		const ref = refOf(item);
		if (ref !== void 0) occupied.add(ref);
	}
	for (const item of rawCleanupRefs(value)) {
		const ref = normalizeKey(item);
		if (ref !== void 0) occupied.add(ref);
	}
	const fallback = normalizeKey(value[REF_FIELD]);
	if (fallback !== void 0) occupied.add(fallback);
	const first = opencodeAccountRef(label);
	if (!occupied.has(first)) return first;
	for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
		const candidate = `${first}_${suffix}`;
		if (!occupied.has(candidate)) return candidate;
	}
	throw new Error(`llm-opencode-go: no free credential reference for name "${label}"`);
}
/** opencode 的账号端口（设置变更实现）。 */
var OpencodeAccounts = class {
	#deps;
	/**
	* @param deps - 设置、凭据与意图日志三个端口。
	*/
	constructor(deps) {
		this.#deps = deps;
	}
	/**
	* @returns 账号行视图：身份取自 `apiKeyEnv`，`configured` 来自凭据服务。
	*
	* **当前账号显示在第一行**（旧插件 `accountsOf` 第 6783-6790 行 + `moveAccountFirst`
	* 第 6779 行的同一派生）：顶层 `apiKeyEnv` 就是「当前账号」（`select` 写它、`move`
	* 把队首跟到它），所以列表顺序必须让用户一眼看出谁在服务 —— 参考实现的会话面板
	* 「第一行成为当前账号；顺序也决定自动尝试备用账号的次序」说的就是这件事。
	* 派生（读时提位）而不是写设置：`select` 已经改了顶层引用，顺序显示跟着派生即可，
	* 不值得为用户点一次「切换」就多写一次文档。
	*
	* 当前账号不在 `accounts[]` 里时（用户现有的 opencode 行根本没有 `accounts` 键），
	* 合成一条默认槽行补在最前面（旧插件同一形状：`legacy:<ref>`）—— 只列 `accounts[]`
	* 会让正在服务请求的那个账号一行都不显示、也固定不了。真账号条目已占用这个 ref 时
	* 不合成（同 ref 的重复行不该出现）。
	*/
	async list() {
		const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
		const slot = opencodeAccountSlot(snapshot.value);
		const views = [];
		views.push(...rawAccounts(snapshot.value).map((item) => ({
			ref: refOf(item),
			label: labelOf(item)
		})).filter((item) => item.ref !== void 0).map((item) => ({
			ref: item.ref,
			label: item.label ?? item.ref,
			configured: false,
			active: item.ref === slot.pinned
		})));
		const unique = dedupeByRef(moveFirst(views, slot.ref));
		const order = globalOrderOfVendor(unique.map((view) => view.ref), snapshot.value.accountOrder, "dsh-opencode-go");
		const byRef = new Map(unique.map((view) => [view.ref, view]));
		const ordered = order.map((ref) => byRef.get(ref)).filter((view) => view !== void 0);
		const info = await this.#deps.credentials.describe(ordered.map((view) => view.ref));
		return ordered.map((view) => ({
			...view,
			configured: info[view.ref]?.configured === true
		}));
	}
	/**
	* 追加一个账号。
	*
	* **ref 在写意图之前解析**：它先进意图（`{ kind: "add", ref, label }`）、再进提交，
	* 提交用的就是这一个 ref。于是崩溃重放**按 ref 对齐**就够了 —— 同名标签合法（`_2`
	* 后缀），按 label 重新推导分不清「已提交但凭据没写成」「根本没提交」与「同名的存量
	* 账号」，会造出重复账号或把密钥写到错的账号上。
	*
	* **提交是幂等的**：每一轮（含冲突重试）都拿**刚读到的**文档再判一次身份 —— 冻结的
	* ref 已经在账号表里就不再追加第二个条目，也不再写凭据槽。同标签的并发 `add` 会因为
	* `opencodeAccountRef` 的确定性而冻结到同一个 ref：没有这道闸门，两次调用会把同一个
	* 凭据槽写两遍（`list()` 的 `dedupeByRef` 只会把重复行藏起来，文档里仍然留着两条）。
	*
	* 所有**不改状态就可能失败**的校验（标签、密钥、账号数上限、没有空闲 ref）都跑在
	* `append` 之前，因此日志里不会留下一条永远应用不了的意图。真正写失败（凭据服务写失败、
	* 设置冲突重试用尽）才留下未决意图：重放能确认账号条目已经落地，但**补不回密钥** ——
	* 那条账号会保持 `configured: false`，直到用户重新提供密钥（`replaceKey`）。带 `key` 时
	* 先提交账号条目、再写凭据服务（旧插件 `begin()` → `credentials.set` 的次序，第 8393-8396 行）。
	*
	* **并发填满账号表**是唯一一条「`append` 之后才可能失败」的校验：另一次 `add` 在读取与
	* 提交之间把表填满时，本方法的复核会拒绝本次提交。这条拒绝**必须先把意图收尾**（见
	* `#settleQuietly`）——否则日志里会留下一条每次重放都抛错的 `add`，而
	* `IntentLog.replay` 不吞 `apply` 的错误，一条这样的意图会拖停整轮回放。
	* @param input - 展示名称与可选密钥。
	* @returns 新账号的视图。
	*/
	async add(input) {
		const label = requireLabel(input.label);
		const key = input.key === void 0 ? void 0 : requireKey(input.key);
		const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
		if (rawAccounts(snapshot.value).length >= 20) throw tooManyAccounts();
		const ref = freeRef(snapshot.value, label);
		const document = await this.#transaction("add", {
			ref,
			label
		}, async (intent) => {
			const { result: applied, value: current } = await this.#mutate(async (value) => {
				if (hasAccount(value, ref)) return {
					ops: [],
					result: false
				};
				const accounts = rawAccounts(value);
				if (accounts.length >= 20) {
					await this.#settleQuietly(intent);
					throw tooManyAccounts();
				}
				const ops = [{
					op: "set",
					path: [ACCOUNTS_FIELD],
					value: [...accounts, {
						[ID_FIELD]: ref,
						[LABEL_FIELD]: label,
						[REF_FIELD]: ref
					}]
				}];
				if (accounts.length === 0) ops.push({
					op: "set",
					path: [ACTIVE_FIELD],
					value: ref
				});
				return {
					ops,
					result: true
				};
			});
			if (applied && key !== void 0) await this.#deps.credentials.set(ref, key);
			return current;
		});
		return {
			ref,
			label,
			configured: (await this.#deps.credentials.describe([ref]))[ref]?.configured === true,
			active: activeRefOf(document) === ref
		};
	}
	/**
	* 只改展示名称。**绝不**重新推导 ref：ref 是账号的身份键，也是凭据槽名，重推会让顺序、
	* 规则、当前账号标记与凭据全部脱钩。
	* @param ref - 目标账号的 ref。
	* @param label - 新名称。
	*/
	async rename(ref, label) {
		const next = requireLabel(label);
		await this.#require(ref);
		await this.#transaction("rename", {
			ref,
			label: next
		}, () => this.#mutate((value) => ({
			ops: [{
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: rawAccounts(value).map((item) => refOf(item) === ref && isRecord(item) ? {
					...item,
					[LABEL_FIELD]: next
				} : item)
			}],
			result: void 0
		})));
	}
	/**
	* 换密钥：只写凭据服务，设置文档一个字都不动（Global Constraints：文档里只允许出现
	* 凭据引用名）。与其它操作一样先写意图，凭据写入成功后才收尾。
	* @param ref - 目标账号的 ref。
	* @param key - 新密钥（空值/纯空白直接拒绝）。
	*/
	async replaceKey(ref, key) {
		const next = requireKey(key);
		await this.#require(ref);
		await this.#transaction("replace-key", { ref }, async () => {
			await this.#deps.credentials.set(ref, next);
		});
	}
	/**
	* 移除账号：条目、必要时当前账号标记，并把 ref 记进 `credentialCleanupRefs`。**真正删凭据
	* 不在本操作内**：只记录，等清理动作确认该 ref 不再被引用后再 `credentials.unset`。
	*
	* 当前账号的回落顺序按旧插件第 8178-8180 行：摘掉条目后，若当前账号就是被删的那个，
	* 回落到**剩余列表的第一个**；删空了才回到默认引用名。
	*
	* 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
	* @param ref - 目标账号的 ref。
	*/
	async remove(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-opencode-go")).value, ref)) return;
		await this.#transaction("remove", { ref }, () => this.#mutate((value) => {
			const accounts = rawAccounts(value).filter((item) => refOf(item) !== ref);
			const ops = [{
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: accounts
			}, {
				op: "set",
				path: [CLEANUP_FIELD],
				value: [...rawCleanupRefs(value).filter((item) => item !== ref), ref]
			}];
			if (activeRefOf(value) === ref) {
				const next = accounts.map((item) => refOf(item)).find((candidate) => candidate !== void 0);
				ops.push({
					op: "set",
					path: [ACTIVE_FIELD],
					value: next ?? "OPENCODE_API_KEY"
				});
			}
			return {
				ops,
				result: void 0
			};
		}));
	}
	/**
	* 固定账号或回到自动轮换。
	*
	* 可选的目标包含**合成的默认槽**（{@link OPENCODE_DEFAULT_REF} 或顶层 `apiKeyEnv`，即使它
	* 不在 `accounts[]` 里）：`list()` 会把它列成第一行，页面拿这一行的 ref 回来固定时必须成立。
	* 写回的就是这个 ref 本身（opencode 的当前账号字段就是那一个 ref，没有槽 id 空间）。
	* @param ref - 目标账号的 ref；`null` 表示自动轮换（**清空**顶层字段，见下）。
	*/
	async select(ref) {
		if (ref !== null) {
			const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
			if (!hasAccount(snapshot.value, ref) && ref !== opencodeAccountSlot(snapshot.value).ref) throw unknownRef(ref);
		}
		await this.#transaction("select", ref === null ? {} : { ref }, () => this.#mutate(() => ({
			/**
			* 取消固定 = **清空**顶层当前账号字段（2026-11-04 外部审查 U01）。
			*
			* 旧写法在 `ref === null` 时写入 {@link OPENCODE_DEFAULT_REF}
			* （`OPENCODE_API_KEY`）—— 那个名字在凭据库里通常**不存在**，而它又是一个
			* 合法引用名，于是 `opencodeAccountSlot` 把它读成「用户固定了这个账号」。
			* 后果：轮换引擎永远先试这个幽灵槽，`maxAttempts = 1` 时整次请求只打它，
			* 真实账号一个都不试，却报「没有可用账号」。
			*
			* 空串在 `readAccountSlot` 里读作「没指定」（与字段缺失同义），所以清空是最
			* 忠实的表达：既让自动轮换生效，也不留下一个指向空气的固定值。
			*/
			ops: [{
				op: "set",
				path: [ACTIVE_FIELD],
				value: ref ?? ""
			}],
			result: void 0
		})));
	}
	/**
	* 调整账号顺序。opencode 的能力清单里 `reorder` 为真（设计 §7.3），所以本适配器**实现**
	* 它：用 Task 4 的 `reorder` 算出新顺序，落到 `accounts` 数组。
	*
	* 同时把顶层 `apiKeyEnv` 指向移动后的队首（旧插件第 8451-8453 行的同一后果）：旧插件读
	* 当前账号时会把「不在账号表里的引用名」回落到列表第一个（第 7512-7515 行的
	* `[preferred, ...accounts]`），所以「列表首项 = 当前账号」本来就是它的有效语义；这里把它
	* 显式写出来，避免排序后当前账号与列表首项不一致。
	* @param ref - 目标账号的 ref。
	* @param toIndex - 移动后的最终下标；越界时 `reorder` 夹到两端。
	*/
	async move(ref, toIndex) {
		await this.#require(ref);
		await this.#transaction("move", {
			ref,
			toIndex
		}, () => this.#mutate((value) => {
			const accounts = rawAccounts(value);
			const order = [];
			const seen = /* @__PURE__ */ new Set();
			for (const item of accounts) {
				const itemRef = refOf(item);
				if (itemRef === void 0 || seen.has(itemRef)) continue;
				seen.add(itemRef);
				order.push(itemRef);
			}
			const next = reorder(order, ref, toIndex);
			const byRef = /* @__PURE__ */ new Map();
			const extras = [];
			for (const item of accounts) {
				const itemRef = refOf(item);
				if (itemRef === void 0 || byRef.has(itemRef)) extras.push(item);
				else byRef.set(itemRef, item);
			}
			const head = next[0];
			const active = activeRefOf(value);
			const orderChanged = next.join("\0") !== order.join("\0");
			const activeChanged = head !== void 0 && active !== head;
			if (!orderChanged && !activeChanged) return {
				ops: [],
				result: void 0
			};
			const ops = [];
			if (orderChanged) ops.push({
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: [...next.map((candidate) => byRef.get(candidate)), ...extras]
			});
			if (activeChanged) ops.push({
				op: "set",
				path: [ACTIVE_FIELD],
				value: head
			});
			return {
				ops,
				result: void 0
			};
		}));
	}
	/**
	* 写全局顺序（`vendor:ref`；两家文档保存同一份）。
	* @param order - 全局顺序键。
	*/
	async setOrder(order) {
		const clean = order.filter((key) => typeof key === "string" && key.trim() !== "");
		await this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [ORDER_FIELD],
				value: clean
			}],
			result: void 0
		}));
	}
	/**
	* 写自动切换开关（旧插件 `auto-switch` 命令落到 `autoSwitch` 字段，第 8407-8409 行）。
	* @param value - 开关值。
	*/
	async setAutoSwitch(value) {
		await this.#transaction("auto-switch", { value }, () => this.#mutate(() => ({
			ops: [{
				op: "set",
				path: ["autoSwitch"],
				value
			}],
			result: void 0
		})));
	}
	/**
	* 一次完整事务：先 `append` 意图，再交给 `submit`（通常是设置变更），全部成功后才
	* `settle`。顺序不能颠倒：崩溃时留下的未决意图正是重放的依据。
	* @param kind - 意图类型。
	* @param fields - 意图携带的 ref/label/toIndex/value。
	* @param submit - 真正的提交动作；收到这条意图，便于在「已经 append、才发现不该提交」
	*   的路径上先把它收尾再抛（见 `#settleQuietly`）。
	* @returns `submit` 的结果。
	*/
	async #transaction(kind, fields, submit) {
		const intent = this.#intent(kind, fields);
		await this.#deps.intents.append(intent);
		const result = await submit(intent);
		await this.#deps.intents.settle(intent.id);
		return result;
	}
	/**
	* 把一条**已经 append 但决定不提交**的意图收尾掉。
	*
	* 用途只有一处：`add` 的并发上限复核（另一次 `add` 抢先把账号表填满）。那条意图永远
	* 重放不成功 —— 重放时账号表仍然是满的，`apply` 只会再抛一次同样的错；而
	* `IntentLog.replay` 不吞 `apply` 的错误，一条这样的意图会拖停整轮回放（Task 8 的
	* 文档化边界），直到某个账号被删掉为止。所以收尾必须发生在抛出之前。
	*
	* 收尾本身写失败不抛出：那条意图会留在日志里（与「凭据写失败」同一类未决状态），
	* 但调用方拿到的仍是这次拒绝的真实原因（满表），而不是一个收尾失败。
	* @param intent - 已 append 的意图。
	*/
	async #settleQuietly(intent) {
		try {
			await this.#deps.intents.settle(intent.id);
		} catch {}
	}
	/**
	* 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新
	* 文档重算 ops 后再提交。冲突时**不**覆盖对方的写入。
	*
	* `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add`
	* 发现冻结的 ref 已经存在、`move` 发现位置没变都是这种情况）：直接返回，**不落盘**。
	* 这样「幂等的提交」不必伪造一次空写，也不会白白推进修订号去作废别人的写入。
	*
	* `build` 允许是 async 的：`add` 的并发上限复核要在「已经读到满表」时先 `settle` 掉
	* 那条意图再抛（见 `#settleQuietly`）。`build` 抛出的错误原样冒泡，且**不计**冲突重试
	* （它不是修订号冲突）。
	* @param build - 由最新文档算出 ops 与调用方要的结果。
	* @returns 调用方的结果与提交后的文档。
	*/
	async #mutate(build) {
		for (let attempt = 0;; attempt += 1) {
			const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
			const { ops, result } = await build(snapshot.value);
			if (ops.length === 0) return {
				result,
				value: snapshot.value
			};
			try {
				return {
					result,
					value: (await this.#deps.settings.mutate(OPENCODE_SETTINGS_NS, ops, snapshot.revision)).value
				};
			} catch (error) {
				if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
			}
		}
	}
	/** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
	async #require(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-opencode-go")).value, ref)) throw unknownRef(ref);
	}
	/** 造一条带唯一 id 的意图（`createdAt` 仅供展示，不参与排序）。 */
	#intent(kind, fields) {
		return {
			id: randomUUID(),
			kind,
			createdAt: Date.now(),
			...fields.ref === void 0 ? {} : { ref: fields.ref },
			...fields.label === void 0 ? {} : { label: fields.label },
			...fields.toIndex === void 0 ? {} : { toIndex: fields.toIndex },
			...fields.value === void 0 ? {} : { value: fields.value }
		};
	}
};
/**
* 造一个 opencode 账号端口（真源在设置文档，密钥走凭据服务）。
* @param deps - 设置、凭据与意图日志三个端口。
* @returns 账号端口；七条命令全部实现（含 `move` 与 `setAutoSwitch`）。
*/
function createOpencodeAccounts(deps) {
	return new OpencodeAccounts(deps);
}
//#endregion
//#region src/vendors/opencode/quota.ts
/**
* opencode 额度：`GET {baseURL}/usage` → 归一化的 {@link QuotaSnapshot}。
*
* 端点、请求头与归一化口径逐条对照旧插件
* `dsh-opencode-go/lib/index.js`：
* - 端点与请求头（`fetchUsage` **第 7898-7906 行**）：`{baseURL}/usage`、
*   `Accept: application/json`、`Authorization: Bearer <key>`、`AbortSignal.timeout(1e4)`
*   （10 秒预算）、`redirect: "error"`、正文上限 `USAGE_MAX_BYTES = 1 MiB`（第 7822 行）；
* - 负载形状（`parseGoUsage` **第 7762-7783 行**）：窗口在顶层 `usage` 对象里，
*   `usage.rolling` / `usage.weekly` / `usage.monthly`，每项
*   `{ status: "ok" | "rate-limited", percent: 0–100, resetsAt: ISO 字符串 }`；
* - 错误语义（第 7907-7934 行）：408/429/5xx **可重试并保留上一次读数**，其它状态不可
*   重试；传输失败可重试且可保留；正文不可解析或超字节上限时**可重试但不保留**
*   （旧插件的 `invalid` 分支）；凭据**解析失败**（非 `MISSING_CREDENTIAL`）可重试但不保留
*   （第 7864-7873 行），凭据缺失不可重试（第 7875-7881 行）；负载整体认不出来时可重试但
*   不保留（第 7925-7934 行的 `Invalid OpenCode Go usage response`）。
*
* **与旧插件的取舍**：旧插件的 `parseGoUsage` 是全有或全无（任何一条窗口不合法就整次
* 读取失败），本模块按「坏到什么程度」分两档：
* - **负载整体认不出来**（不是对象、没有 `usage`、`usage` 不是对象）仍然整次失败 ——
*   这种 200 响应一次形状漂移就可能把上一次读数换成「干净的空读数」，而 UI 分辨不出
*   「端点报告没有数据」与「端点换了形状」；
* - **`usage` 是对象、只有个别窗口不合法**：合法的窗口照常返回，不合法的窗口**不造出来**、
*   只把窗口名记进 `failures`（设计 §12 Review Focus 4「缺失不倒成 0」），坏数据不会让
*   整个额度面板变空，也不会伪装成 0%。
*
* **单位**：{@link OpencodeQuotaKey} 说明每个 key 的含义；`percent` 一律 0–100（超出范围
* 视为端点未报告），`resetAt` 一律 epoch 毫秒（端点的 `resetsAt` 是 ISO 字符串，在此转换）。
* @module dsh-llm-account/src/vendors/opencode/quota
*/
/** 额度端点路径（旧插件 `fetchUsage` 第 7899 行）。 */
const USAGE_PATH = "/usage";
/**
* 一次额度请求最多读多少字节（旧插件第 7822 行）。
* 超限按旧插件的 `RangeError` 分支处置：可重试、不保留上一次读数。
*/
const USAGE_MAX_BYTES = 1048576;
/** 一次额度请求的预算（旧插件第 7904 行的 `AbortSignal.timeout(1e4)`）。 */
const DEFAULT_USAGE_TIMEOUT_MS = 1e4;
/**
* 旧插件抛出的错误码（第 7840-7933 行）。本适配器用它作 {@link OpencodeUsageError}
* 的 `code`：宿主按 `code` 判重试，`retryable` / `retainPrevious` 是本适配器附加的
* 判定字段，见 {@link OpencodeUsageError}。
*/
const USAGE_UNAVAILABLE_CODE = "opencode-go/usage-unavailable";
/** 会产生窗口的窗口名（顺序即输出顺序，与旧插件 `parseGoUsage` 的循环次序一致）。 */
const WINDOW_KEYS = [
	"rolling",
	"weekly",
	"monthly"
];
/**
* 额度不可用的错误：`code` 固定为 {@link USAGE_UNAVAILABLE_CODE}，额外带上旧插件
* `RemoteError` details 里的两个判定字段。
*
* 用 `LlmError` 子类而不是往共享内核加字段：`LlmError` 是宿主包
* （`@deepseek-ai/dsh-llm`）的类型，挂载本项目的额度语义必须落在本适配器里；
* 而 `LlmError` 的 `options` 已经支持 `status` / `cause`，子类只需要补两个只读字段。
*
* 两个字段的语义（旧插件第 7907-7934 行）：
* - `retryable`：这次失败是否值得重试（408/429/5xx、传输失败、正文/超限失败为 `true`；
*   其它状态与「没有可用密钥」为 `false`）。
* - `retainPrevious`：UI 是否应当**继续显示上一次读数**（旧插件用它区分「暂时读不到」与
*   「读到的东西不可信」：正文解析失败与超限是后者，所以为 `false`）。
*/
var OpencodeUsageError = class extends LlmError {
	/** 这次失败是否值得重试。 */
	retryable;
	/** 是否应当保留并继续显示上一次读数。 */
	retainPrevious;
	/**
	* @param message - 面向人的说明。
	* @param options - 重试判定与（可选的）HTTP 状态、原始异常。
	*/
	constructor(message, options) {
		super(message, USAGE_UNAVAILABLE_CODE, {
			...options.status === void 0 ? {} : { status: options.status },
			...options.cause === void 0 ? {} : { cause: options.cause }
		});
		this.retryable = options.retryable;
		this.retainPrevious = options.retainPrevious;
	}
};
/** 额度端口的依赖。取数用的密钥与账号都要注入，端口自己不依赖 `ctx`。 */
/**
* 把凭据串解成「这次额度请求要用的鉴权」。
*
* **网页登录（`ocoauth1:` 前缀）必须解成 access token + org 头**（审查 U02）：
* 整串 blob 当 Bearer 会 401，表现为「聊天能用、额度读不到」。
*
* 普通 API key 原样返回，且**不产生 org 头**（那类凭据没有 org 概念）。
* @param raw - 凭据原始值。
* @param deps - 额度端口依赖（取 fetch / authBase / now）。
* @returns 请求要用的 key 与额外头。
*/
async function opencodeAuthOf(raw, deps) {
	if (!raw.startsWith("ocoauth1:")) return { key: raw };
	const resolved = await resolveOAuthCredential(raw, {
		fetchImpl: deps.fetchImpl,
		...deps.authBase === void 0 ? {} : { authBase: deps.authBase },
		...deps.now === void 0 ? {} : { now: deps.now }
	}, {
		signal: AbortSignal.timeout(deps.timeoutMs ?? 1e4),
		throwOnTransient: true
	});
	if (resolved === void 0) throw missingKeyError();
	return {
		key: resolved.key,
		headers: resolved.headers
	};
}
/** 读取非空字符串。 */
function stringValue(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* 把端点的 `resetsAt`（ISO 字符串）转成 epoch 毫秒。数字按毫秒原样收下（端点若改了形状
* 也能用），缺失或解析不了就是「未知」，不补 0、不补当前时间。
* @param value - 端点给的 `resetsAt`。
* @returns epoch 毫秒，或 `undefined` 表示未公布/不可解析。
*/
function epochMillis(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	const text = stringValue(value);
	if (text === void 0) return void 0;
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? void 0 : parsed;
}
/**
* 归一化一条窗口读数。旧插件的 `parseGoUsage` 对这三项是**全有**要求（第 7777 行），
* 本模块把整条窗口当成一个不可分割的读数：三项里任何一项缺失或非法，就认为这条窗口
* 「不可信」→ 不产出窗口（调用方记名），绝不把 `percent` 倒成 0 或把 `resetsAt` 丢掉。
* @param raw - 端点给的窗口块。
* @param key - 窗口 key。
* @returns 归一化窗口；形状不认识或字段非法时为 `undefined`。
*/
function windowOf(raw, key) {
	if (!isRecord$3(raw)) return void 0;
	const status = stringValue(raw.status);
	if (status !== "ok" && status !== "rate-limited") return void 0;
	const percent = raw.percent;
	if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return void 0;
	const resetAt = epochMillis(raw.resetsAt);
	if (resetAt === void 0) return void 0;
	return {
		key,
		percent,
		exceeded: status === "rate-limited",
		resetAt
	};
}
/**
* 从端点的顶层负载里取出 `usage` 对象（旧插件第 7926 行的
* `body.usage`；负载自己就是 usage 对象的浅层形状同样接受）。
* @param payload - `/usage` 的已解析负载。
* @returns usage 记录；形状不认识时为 `undefined`。
*/
function usageRecord(payload) {
	if (!isRecord$3(payload)) return void 0;
	if (isRecord$3(payload.usage)) return payload.usage;
	return WINDOW_KEYS.some((key) => Object.hasOwn(payload, key)) ? payload : void 0;
}
/**
* 把「形状不认识」的负载统一成一个已分类的错误（旧插件 `parseGoUsage` 在
* `body.usage` 不合法时抛 `Invalid OpenCode Go usage response`，第 7925-7934 行）。
*
* 旧插件对**每一条窗口**都要求齐全（第 7777 行），所以它的「不合法」覆盖了「窗口字段缺失」
* 与「usage 缺失」两种情况。本模块刻意拆开这两者：
* - **`usage` 缺失或不是对象** → 「端点变了形状」，不可信 → 抛本错误（`retryable: true`、
*   `retainPrevious: false`）；
* - **`usage` 是对象但窗口字段缺失或非法** → 合法但空/部分读数，逐窗口记名（见 `toQuotaSnapshot`）。
*
* 这样一次形状漂移不会被当成「端点报告了空用量」，也不会静默覆盖上一次读数。
* @returns 已分类的错误（由调用方抛出，便于纯函数在 `unknown` 上收窄后直接 `throw`）。
*/
function unknownUsageShape() {
	return new OpencodeUsageError("Invalid OpenCode Go usage response", {
		retryable: true,
		retainPrevious: false
	});
}
/**
* 把 `/usage` 的负载归一化成一次额度读数。
*
* 规则（控制器补充 1）：
* - `key` 用窗口名（`rolling` / `weekly` / `monthly`），输出顺序固定；
* - `percent` 原样保留（0–100），`resetsAt` 转 **epoch 毫秒**；
* - `status === "rate-limited"` → `exceeded: true`，`status === "ok"` → `exceeded: false`；
* - **缺失的窗口不造出来**；形状不认识的**窗口**丢弃并把窗口名记进 `failures`；
* - **负载整体认不出来**（不是对象、没有 `usage`、`usage` 不是对象）→ 抛
*   {@link OpencodeUsageError}（`retryable: true`、`retainPrevious: false`），
*   不返回一个「干净的空读数」。
*
* **合法但空**的形状只有一种：`usage` 是对象而三个窗口字段一个都没有（例如 `{ usage: {} }`）
* —— 那是端点明确报告「当前没有窗口数据」，返回 `{ windows: [], failures: [] }` 是诚实的。
*
* 纯函数：不做 I/O、不缓存（抛错的判定也只看入参）。
* @param payload - `/usage` 的已解析负载（`unknown`：形状不可信，逐字段收窄）。
* @returns 归一化读数。
* @throws {OpencodeUsageError} 负载整体认不出来时。
*/
function toQuotaSnapshot(payload) {
	const usage = usageRecord(payload);
	if (usage === void 0) throw unknownUsageShape();
	const windows = [];
	const failures = [];
	for (const key of WINDOW_KEYS) {
		const raw = usage[key];
		if (raw === void 0) continue;
		const window = windowOf(raw, key);
		if (window === void 0) failures.push(key);
		else windows.push(window);
	}
	const plan = planOf(windows);
	return {
		windows,
		failures,
		failuresFatal: [...failures],
		...plan === void 0 ? {} : { plan }
	};
}
/**
* 把 `monthly` 窗口的重置时刻落成**订阅周期**（2026-11-03 报障）。
*
* ## 为什么需要
*
* 用量面板按「本周期」统计时，`usage-remote.ts` 优先用厂商公布的账期
* （`quota.plan.periodEnd` / `periodStart`）；厂商没公布就退回**最细的一档窗口**
* —— 对 opencode 就是 5 小时窗口。于是三家口径不一致：
*
* - **Open Design**：`subscriptionCurrentPeriodEnd` → 整月；
* - **Command Code**：订阅字段 → 整月；
* - **OpenCode**：`/usage` 只回三个百分比窗口，**从不公布账期** → 掉成 5 小时。
*
* 结果同一块面板里，opencode 显示「最近 5 小时用了 111.6M」，另外两家显示整月 ——
* 用户一眼就看出不对。
*
* ## 依据
*
* opencode 的三个窗口是「5 小时 / 每周 / 每月」，而**每月那个就是订阅周期**：
* 官方文档把 usage limit 定义成「每月的美元额度」，`monthly` 的 `resetsAt`
* 正是本期结束时刻。所以把它当账期是厂商自己的语义，不是我们推测。
*
* 厂商不公布起点，按 `periodEnd` 往前推一个日历月（与 `Command Code` 缺
* `periodStart` 时的处理一致）。
* @param windows - 已解析出的窗口。
* @returns 套餐账期；没有 `monthly` 窗口或它没带重置时刻时返回 `undefined`。
*/
function planOf(windows) {
	const resetAt = windows.find((window) => window.key === "monthly")?.resetAt;
	if (resetAt === void 0) return void 0;
	return {
		id: "go",
		periodEnd: resetAt,
		periodStart: monthBefore(resetAt)
	};
}
/**
* 把一个时刻往前推一个日历月（同一天，月份减一）。
*
* 用日历月而不是固定 30 天：`monthly` 的 `resetsAt` 是「本期结束」，本期起点就是
* 上个月的同一天（opencode 的月度额度按自然月滚动）。跨月天数不齐时（如 3/31 → 2 月）
* 夹到目标月的最后一天，避免溢出到再下一个月。
* @param at - 结束时刻（epoch 毫秒）。
* @returns 起点时刻（epoch 毫秒）。
*/
function monthBefore(at) {
	const day = new Date(at).getUTCDate();
	const shifted = new Date(at);
	shifted.setUTCDate(1);
	shifted.setUTCMonth(shifted.getUTCMonth() - 1);
	const lastDay = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
	shifted.setUTCDate(Math.min(day, lastDay));
	return shifted.getTime();
}
/**
* 读一段有界正文：先按 `content-length` 提前拒绝，再按实际字节数兜底（旧插件的
* `USAGE_MAX_BYTES` 语义；`Response.text()` 无法中途截断，所以先看声明再读）。
* @param response - 已经拿到的响应。
* @returns 正文文本。
* @throws {RangeError} 超过 {@link USAGE_MAX_BYTES} 时。
*/
async function readBoundedText(response) {
	const declared = Number(response.headers.get("content-length") ?? NaN);
	if (Number.isFinite(declared) && declared > 1048576) throw new RangeError(`response exceeds the ${USAGE_MAX_BYTES} byte limit`);
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > 1048576) throw new RangeError(`response exceeds the ${USAGE_MAX_BYTES} byte limit`);
	return text;
}
/** 没有可用密钥（旧插件第 7875-7881 行语义：重试没有意义，也没有可信的旧读数）。 */
function missingKeyError() {
	return new OpencodeUsageError("OpenCode Go API key is not configured", {
		retryable: false,
		retainPrevious: false
	});
}
/**
* opencode 的额度端口。`snapshot()` 的顺序：解析当前账号密钥 → `GET {base}/usage` →
* 归一化。失败一律抛 {@link OpencodeUsageError}（带 `retryable` / `retainPrevious`）；
* 没有可用密钥时抛同一个错误类的 `retryable: false` 分支，**一个请求都不发**
* （旧插件第 7864-7881 行的同一语义）。
* @param deps - 账号 ref、密钥解析、`fetch` 与基地址/预算。
* @returns 额度端口。
*/
function createOpencodeQuota(deps) {
	const base = trimBase(normalizeKey(deps.apiBase) ?? "https://opencode.ai/zen/go/v1");
	const timeoutMs = deps.timeoutMs !== void 0 && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_USAGE_TIMEOUT_MS;
	return { async snapshot(accountRef, signal) {
		const ref = accountRef ?? deps.ref();
		signal?.throwIfAborted();
		const authSignal = signal === void 0 ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
		let auth;
		try {
			if (ref === void 0) throw missingKeyError();
			if (deps.resolveAuth !== void 0) auth = await deps.resolveAuth(ref, authSignal);
			else {
				const key = normalizeKey(await deps.resolveKey(ref));
				if (key === void 0) throw missingKeyError();
				auth = await opencodeAuthOf(key, deps);
			}
			if (auth === void 0) throw missingKeyError();
		} catch (error) {
			if (error instanceof OpencodeUsageError) throw error;
			if (isRecord$3(error) && error.code === "MISSING_CREDENTIAL") throw missingKeyError();
			throw new OpencodeUsageError(`Could not resolve the OpenCode Go API key for account "${ref}"`, {
				retryable: true,
				retainPrevious: false,
				cause: error
			});
		}
		let response;
		try {
			const requestSignal = signal === void 0 ? AbortSignal.timeout(timeoutMs) : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
			response = await deps.fetchImpl(`${base}${USAGE_PATH}`, {
				headers: {
					accept: "application/json",
					Authorization: `Bearer ${auth.key}`,
					...auth.headers ?? {},
					...opencodeSessionHeaders(),
					...attributionHeaders()
				},
				signal: requestSignal,
				redirect: "error"
			});
		} catch (error) {
			throw new OpencodeUsageError(`Could not read ${base}${USAGE_PATH}: transport failure`, {
				retryable: true,
				retainPrevious: true,
				cause: error
			});
		}
		if (!response.ok) {
			const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
			throw new OpencodeUsageError(`OpenCode Go usage unavailable (HTTP ${response.status})`, {
				retryable: temporary,
				retainPrevious: temporary,
				status: response.status
			});
		}
		let payload;
		try {
			payload = JSON.parse(await readBoundedText(response));
		} catch (error) {
			const detail = error instanceof RangeError ? `response exceeds the ${USAGE_MAX_BYTES} byte limit` : error instanceof SyntaxError ? "invalid JSON response" : "unreadable response body";
			throw new OpencodeUsageError(`Could not read ${base}${USAGE_PATH}: ${detail}`, {
				retryable: true,
				retainPrevious: false,
				cause: error
			});
		}
		return toQuotaSnapshot(payload);
	} };
}
//#endregion
//#region src/vendors/opencode/login.ts
/**
* OpenCode 实验性网页登录：设备码状态机。
*
* 流程：`begin` 申请设备码 → `waiting`（带 user code 与授权网址）→ 后台轮询 →
* 成功时读工作区、把 `ocoauth1:` blob 交给注入的 `storeKey`；用户取消 / 过期 / 拒绝 /
* 工作区读不到都落到**可指名**的失败原因。终态之后的下一次 `begin` 才开新尝试。
*
* 与适配器的分工：本模块只负责「拿到 blob 并写进凭据槽」，不碰设置文档、账号表或轮换；
* 账号条目的创建由装配层的 `storeKey` 决定（同标签已存在就换密钥，不存在就新增）。
* @module dsh-llm-account/src/vendors/opencode/login
*/
/** 本登录流所属的 provider 路由（ref 生成的厂商段）。 */
const OPENCODE_LOGIN_VENDOR = "dsh-opencode-go";
/**
* `slow_down` 一次后面隔增加多少毫秒。
*
* RFC 8628 §3.5 的原文是「increase the interval by 5 seconds」——
* 这是**规范要求**，不是调参余地。
*/
const SLOW_DOWN_STEP_MS = 5e3;
const DEVICE_CODE_TIMEOUT_MS = 1e4;
/** 默认等待：可被 abort 的定时器。 */
function defaultSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(/* @__PURE__ */ new Error("aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
/** 一次登录尝试（单飞：等待中重复 `begin()` 返回同一个状态）。 */
var OpencodeLoginFlow = class {
	#deps;
	#sleep;
	#status = { state: "idle" };
	#abort;
	#starting;
	/**
	* @param deps - 传输、凭据落库与等待注入点。
	*/
	constructor(deps) {
		this.#deps = deps;
		this.#sleep = deps.sleep ?? defaultSleep;
	}
	/** @returns 等待授权时的授权网址。 */
	get authUrl() {
		return this.#status.authUrl;
	}
	/** 开始（或接续）一次尝试。 */
	async begin() {
		if (this.#status.state === "waiting") return { ...this.#status };
		if (this.#starting !== void 0) return { ...await this.#starting };
		const starting = this.#startAttempt();
		this.#starting = starting;
		try {
			return { ...await starting };
		} finally {
			if (this.#starting === starting) this.#starting = void 0;
		}
	}
	async #startAttempt() {
		this.#abort?.abort();
		const abort = new AbortController();
		this.#abort = abort;
		this.#status = { state: "idle" };
		let device;
		try {
			device = await withRequestDeadline((signal) => beginDeviceFlow(this.#deps, signal), {
				requestTimeoutMs: DEVICE_CODE_TIMEOUT_MS,
				streamIdleTimeoutMs: DEVICE_CODE_TIMEOUT_MS
			}, { signal: abort.signal });
		} catch (error) {
			if (this.#abort !== abort || abort.signal.aborted) return {
				state: "failed",
				reason: "cancelled"
			};
			const message = error instanceof Error ? error.message : String(error);
			const timeout = error instanceof LlmError && error.code === "LLM_REQUEST_TIMEOUT";
			const httpRejected = /HTTP \d{3}/.test(message);
			this.#status = {
				state: "failed",
				reason: timeout ? "timeout" : httpRejected ? "unavailable" : "network"
			};
			return { ...this.#status };
		}
		if (this.#abort !== abort) return {
			state: "failed",
			reason: "cancelled"
		};
		if (abort.signal.aborted) {
			this.#status = {
				state: "failed",
				reason: "cancelled"
			};
			return { ...this.#status };
		}
		this.#status = {
			state: "waiting",
			authUrl: device.verificationUri,
			userCode: device.userCode,
			expiresAt: device.expiresAt
		};
		this.#run(device, abort);
		return { ...this.#status };
	}
	/** @returns 当前状态副本。 */
	async status() {
		return { ...this.#status };
	}
	/**
	* 取消等待中的尝试；终态不受影响。
	*
	* **「启动中」也必须能取消**（2026-11-04 外部审查 U05）。
	*
	* `begin()` 里 `await beginDeviceFlow()` 期间状态还是 `idle`（还没拿到设备码），
	* 原来这里以 `state !== "waiting"` 直接返回 —— 于是：
	*
	* 1. 用户点了取消，界面没反应；
	* 2. `begin()` 随后拿到设备码，检查 `abort.signal.aborted` 时信号没置位；
	* 3. 迟到的设备码把状态写成 `waiting` 并启动轮询，**取消被彻底忽略**。
	*
	* 现在无论处于哪个中间态都 abort 当前 controller：`begin()` 在拿码之后会检查
	* `abort.signal.aborted` 并落到 `cancelled`，不会启动轮询、也不会写入账号。
	* 终态（success/failed）仍然不受影响 —— 已经结束的尝试不该被改写。
	*/
	async cancel() {
		if (this.#status.state === "success") return;
		if (this.#status.state === "failed") return;
		this.#status = {
			state: "failed",
			reason: "cancelled"
		};
		this.#starting = void 0;
		this.#abort?.abort();
	}
	/** The deadline can close an in-flight poll or org request even if it has not returned. */
	async #run(device, abort) {
		const now = this.#deps.now ?? Date.now;
		const delay = Math.min(2147483647, Math.max(0, device.expiresAt - now()));
		const deadline = setTimeout(() => {
			this.#settle({
				state: "failed",
				reason: "timeout"
			}, abort.signal);
			abort.abort();
		}, delay);
		deadline.unref?.();
		const clearDeadline = () => clearTimeout(deadline);
		abort.signal.addEventListener("abort", clearDeadline, { once: true });
		try {
			await this.#poll(device, abort.signal, clearDeadline);
		} finally {
			clearDeadline();
			abort.signal.removeEventListener("abort", clearDeadline);
		}
	}
	async #poll(device, signal, clearDeadline) {
		const now = this.#deps.now ?? Date.now;
		const expired = () => {
			if (now() < device.expiresAt) return false;
			this.#settle({
				state: "failed",
				reason: "timeout"
			}, signal);
			return true;
		};
		/**
		* **轮询间隔是可变的**（2026-11-05 外部审查 F03）。
		*
		* RFC 8628 §3.5：收到 `slow_down` 之后，**本次及后续**请求的轮询间隔必须
		* 增加 5 秒。上一版只 `continue`，注释还写着「间隔保持」—— 那是把 bug 当设计，
		* 对着规范读会觉得理直气壮，对着服务端读就是持续过快打 token 端点，
		* 更容易被限流甚至暂时封锁。
		*
		* 初始值取设备码响应的 `interval`；每次 `slow_down` 累加 5s，不再回退。
		* 不在登录尝试之间复用（`#run` 每次尝试重新初置）。
		*/
		let pollIntervalMs = device.intervalMs;
		/**
		* 连续多少次轮询拿到「空正文 400」。
		*
		* 计数住在**循环里**而不是 `pollDeviceToken` 里：那个函数是纯的，跨调用状态
		* 放在它内部会让「同一次轮询里第几次」不可测（也能被并发登录串味）。
		* 语义见 {@link EMPTY_BODY_PENDING_TOLERANCE}。
		*/
		let emptyBodyStreak = 0;
		while (!signal.aborted) {
			if (expired()) return;
			try {
				await this.#sleep(pollIntervalMs, signal);
			} catch {
				return;
			}
			if (signal.aborted || expired()) return;
			let result;
			try {
				result = await pollDeviceToken(this.#deps, device, signal, emptyBodyStreak);
			} catch {
				if (signal.aborted) return;
				this.#settle({
					state: "failed",
					reason: "network"
				}, signal);
				return;
			}
			if (signal.aborted || expired()) return;
			if (result.status === "pending") {
				/**
				* 只有**空正文兜底**出来的 pending 才推进计数；服务端明确回
				* `authorization_pending` 时计数归零 —— 那是正常协议形态，用户只是还没授权，
				* 不该因为等得久就被判成协议错误（F14）。
				*/
				emptyBodyStreak = result.emptyBody === true ? emptyBodyStreak + 1 : 0;
				continue;
			}
			if (result.status === "slow_down") {
				pollIntervalMs += SLOW_DOWN_STEP_MS;
				/**
				* **`slow_down` 归零空正文计数**（2026-11-05 外部审查 F18）。
				*
				* `slow_down` 是服务端**明确、结构化的**回应 —— 说明请求本身被正确解析了，
				* 只是要放慢。它证明端点仍然健康，所以前面那些空正文 400 不该继续累积；
				* 否则「偶发空正文 + 一次 slow_down + 偶发空正文」会被误判成连续故障。
				*/
				emptyBodyStreak = 0;
				continue;
			}
			if (result.status === "denied") {
				this.#settle({
					state: "failed",
					reason: "denied"
				}, signal);
				return;
			}
			if (result.status === "expired") {
				this.#settle({
					state: "failed",
					reason: "timeout"
				}, signal);
				return;
			}
			if (result.status === "error") {
				this.#settle({
					state: "failed",
					reason: "unavailable"
				}, signal);
				return;
			}
			let org;
			try {
				org = await fetchOAuthOrg(this.#deps, result.access, signal);
			} catch {
				if (signal.aborted) return;
				org = void 0;
			}
			if (signal.aborted) return;
			if (org === void 0) {
				this.#settle({
					state: "failed",
					reason: "unavailable"
				}, signal);
				return;
			}
			const name = org.name ?? org.id;
			const blob = serializeOAuthCredential({
				v: 1,
				access: result.access,
				refresh: result.refresh,
				expiresAt: result.expiresAt,
				orgId: org.id,
				...org.name === void 0 ? {} : { orgName: org.name },
				userName: name,
				...this.#deps.authBase === void 0 ? {} : { authBase: this.#deps.authBase }
			});
			/**
			* ## 提交前复检：**最后一次确认所有权，然后立刻交出写入**（F12）
			*
			* 每个 await 之后都复检所有权，这已经是本模块的纪律。但 `storeKey` 本身是
			* 一个**不可撤销的异步副作用** —— 一旦交出去，写入就可能完成，而"取消"没法
			* 从凭据库里把已写的东西收回来（底层接口没有条件写/事务）。
			*
			* 所以这里的分工是：
			*
			* - **交出去之前**：任何取消都不写（上面的复检保证）；
			* - **交出去之后**：写入可能已经成功。此时**不能假装什么都没发生**把状态停在
			*   `cancelled` —— 那会让界面说"已取消"、账号表里却多了一条，用户下次看到
			*   一个自己以为没添加过的账号。
			*
			* 于是：写入成功后若发现已取消，仍然落成 `success`，并在 `detail` 里说明
			* 这是取消前的写入。宁可诚实告知，也不要状态与持久化不一致。
			*/
			if (signal.aborted || expired()) return;
			clearDeadline();
			try {
				await this.#deps.storeKey(accountRef(OPENCODE_LOGIN_VENDOR, name), blob, name);
			} catch {
				this.#settle({
					state: "failed",
					reason: "unavailable"
				}, signal);
				return;
			}
			/**
			* 写入已完成。**这里不再以 `signal.aborted` 直接 return**（F12 的核心）。
			*
			* 状态必须是 `success`：账号/凭据确实已经落盘，UI 说"已取消"就是在骗人，
			* 而且用户会在账号列表里看到一个自己以为没添加的条目。
			*/
			this.#settleCommitted(name, signal);
			return;
		}
	}
	/**
	* 凭据**已经写入**之后的收尾（F12）。
	*
	* 与 {@link #settle} 的区别：正常终态只允许从 `waiting` 迁移，而这里要覆盖
	* `cancel()` 抢先写下的 `failed/cancelled` —— 因为持久化的事实比那个乐观状态
	* 更权威。与此同时，如果这次尝试已经被**新的** `begin()` 取代（`#abort` 换了
	* 对象），就不能改写状态：那是下一代的事。
	* @param account - 已写入的账号名。
	* @param signal - 本次尝试的信号。
	*/
	#settleCommitted(account, signal) {
		if (this.#abort?.signal !== signal) return;
		if (this.#status.state === "success") return;
		this.#status = {
			state: "success",
			...this.#status.state === "failed" && this.#status.reason === "cancelled" ? { detail: `账号「${account}」在取消前已写入完成` } : {}
		};
	}
	/**
	* 把等待中的尝试结算成终态；不是等待中就什么都不做（迟到的轮询结果不能覆盖取消）。
	* @param status - 终态。
	*/
	#settle(status, signal) {
		if (signal.aborted || this.#abort?.signal !== signal || this.#status.state !== "waiting") return;
		this.#status = status;
	}
};
/**
* 造一个 OpenCode 登录端口。
* @param deps - 传输、落库与等待注入点。
* @returns 登录端口。
*/
function createOpencodeLogin(deps) {
	return new OpencodeLoginFlow(deps);
}
//#endregion
//#region src/vendors/opencode/index.ts
/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opencode-go`）。 */
const name = "llm-opencode-go";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
const inject = ["llm"];
/** provider 路由 id（全局约束，不得更改）。 */
const PROVIDER_ID = "dsh-opencode-go";
/** 意图日志在设置文档里的隐藏字段（本项目自己的持久化字段，旧插件用的是 `accountOperations`）。 */
const INTENTS_FIELD = "accountIntents";
/**
* 设置行候选名（按优先级）：现代宿主按 profile 行 id 建索引，旧宿主用插件自报的命名空间。
* 行 id 必须排在前面 —— 命中它就说明用户现有 patch 的那一行正在给本插件供配置。
*/
const SETTINGS_ROWS = ["opencode-go", OPENCODE_SETTINGS_NS];
/**
* 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入），字段名逐条
* 对齐用户现有的 profile config（旧插件 `src/config.ts` 第 6816-6852 行的子集）。
*
* 旧插件里本期的非目标字段（`proxyURL`、`refreshMinutes`、`protocolOverrides`、
* `requestPreparationTimeoutMs`、图片预算、`accountOperations` 等）没有声明：schemastery 的
* object 解析会把未声明字段原样带过，所以它们仍然留在文档里，只是本期不读也不改。
* 侧边栏额度卡片的刷新间隔是本期新增的可配置项，对应本包的 `quotaRefreshMinutes`（与旧插件的
* 目录缓存 `refreshMinutes` 是两回事：一个是用量轮询、一个是模型目录缓存，不要混用）。
*
* 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery 的
* 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）；入口
* 本来就把配置读成 `Record<string, unknown>`，这个注解只影响声明文件，不影响运行时的
* schema 对象。
*/
const Config = z.object(markVolatileFields({
	/** `false` 撤下本行的 provider 路由（行仍然挂载、其余产物照旧构造），见模块头。 */
	enabled: z.boolean().default(true),
	usageDisplay: z.union([
		"auto",
		"always",
		"off"
	]).default("auto"),
	modelVisibility: z.dict(z.boolean().required()).default({}),
	visibleModels: z.array(z.string()),
	removedModels: z.array(z.string()),
	modelAccountRules: z.array(z.object({
		models: z.array(z.string()),
		account: z.string()
	})),
	apiKeyEnv: z.string().role("credential-ref").default(OPENCODE_DEFAULT_REF),
	accounts: z.union([z.const(null), z.array(z.object({
		id: z.string(),
		name: z.string(),
		apiKeyEnv: z.string().role("credential-ref")
	}))]).default(null),
	/** 手动排序覆盖；缺省时沿用派生顺序（顶层 `apiKeyEnv` + `accounts[]`）。 */
	accountOrder: z.array(z.string()),
	/**
	* 自动切换开关：关闭后轮换只试当前账号（固定账号；未固定时是顶层默认账号）。
	*
	* **默认 `false`**，与 Command Code 的 `true` 不同 —— Command Code 那边是为了让
	* 旧插件的既有用户零迁移（它一直允许额度耗尽时回落）。本网关没有那个历史包袱，
	* 按「危险能力默认关」的原则留给用户显式打开（与 `autoSwitchModelOnQuota`、
	* 两个自动继续开关同一条纪律）。
	*/
	autoSwitch: z.boolean().default(false),
	/** 切换策略：手动顺序（只在耗尽时切）或额度优先。 */
	switchStrategy: z.union([
		"order",
		"best-quota",
		"scheduled"
	]).default("best-quota"),
	/** 额度优先模式的评估间隔（分钟）；`0` 表示只在当前耗尽时评估。 */
	switchIntervalMinutes: z.number().default(60),
	/** 是否等回合结束再切（默认 `true`，任务进行中不换号）。 */
	switchAtTurnEnd: z.boolean().default(true),
	/**
	* 侧边栏额度卡片开关（规格 §8.1 第 6 条：**默认关闭，关闭时不后台刷新**）。
	*
	* Ruling 34：命令码 Command Code 的 Config 里一直有这个字段，opencode 此前没有 —— 而页面按
	* 厂商声明渲染「集成与显示」里的这个开关，缺失会让这一家的开关写进宿主不认识的字段。
	* 补上它与 commandcode 对称（两个旧插件都有侧边栏卡片，且规格把该卡片当作跨厂商能力）。
	* 默认 `false`：存量文档不受影响，用户不开就不显示、也不轮询。
	*/
	showSidebarQuota: z.boolean().default(false),
	/**
	* 侧边栏额度卡片的刷新间隔（分钟）。规格 §8.1 第 6 条只要求「关闭即静默」、没规定间隔，
	* 旧插件把固定 60s 写死；这里交给用户。缺省 1 分钟（与旧插件一致的体验），下限 1 分钟、
	* 上限 120 分钟（再长用量基本就是过期的，反而误导）。整数是因为 UI 用「分钟」步进输入框。
	*/
	quotaRefreshMinutes: z.number().step(1).min(1).max(120).default(1),
	/**
	* **额度用尽后是否自动切换模型**。
	*
	* 关着时：账号全被限额拒绝就直接报错，不替用户换模型。
	* 打开后按四级优先（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名）随机挑一个，
	* 且**只在该账号已勾选的模型里**。
	*/
	autoSwitchModelOnQuota: z.boolean().default(false),
	autoContinue: z.boolean().default(false),
	/**
	* **旧字段**（v1.4.0 之前拆成两个开关），只为升级兼容保留。
	*
	* zod 的 `z.object` 默认**剥掉未知字段** —— 不在 schema 里声明，`document()`
	* 就读不到它们，兼容代码等于没写。所以这里必须显式声明。
	*
	* 这些字段**不给 default** —— 未提供时就是 `undefined`，与「用户关着」区分得开。
	*
	* 不显示在界面上（`settings-cards.ts` 的 `shared` 列表里没有它们），
	* 只在 `autoContinue` 缺失时作为回退依据：任一为 true 就当作开启。
	* 读侧见 `applyAutoContinue` 调用点的注释。
	*/
	autoContinueOnError: z.boolean(),
	autoContinueOnTruncate: z.boolean(),
	autoContinueMaxAttempts: z.number().step(1).min(1).max(20).default(3),
	autoContinueIntervalMs: z.number().step(100).min(500).max(6e4).default(2e3),
	baseURL: z.string().default(DEFAULT_BASE_URL),
	requestTimeoutMs: z.number(),
	streamIdleTimeoutMs: z.number(),
	modelLimits: z.dict(z.union([z.const(null), z.object({
		contextWindow: z.union([z.const(null), z.number()]),
		maxTokens: z.union([z.const(null), z.number()]),
		/** 推理档位预算属第 2 期：本期只原样保留，不参与请求构造。 */
		thinkingBudgets: z.union([z.const(null), z.array(z.number())])
	})])).default({}),
	credentialCleanupRefs: z.array(z.string().role("credential-ref")),
	accountIntents: z.array(z.any()).hidden()
}));
/**
* 装一行 OpenCode Go。
*
* 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
* @param ctx - 宿主插件上下文。
* @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
* @returns 装配产物（宿主忽略；装配测试与 1b 使用）。
*/
function apply(ctx, config) {
	const parsed = parseConfig(config);
	const document = () => unwrapVolatileConfig(parsed);
	const warn = (message) => {
		ctx.logger.warn(message);
	};
	const settings = createSettingsPort(ctx, OPENCODE_SETTINGS_NS, SETTINGS_ROWS);
	const credentials = createCredentialsPort(ctx);
	const intents = intentLogFor(OPENCODE_SETTINGS_NS, createSettingsIntentStore(settings, OPENCODE_SETTINGS_NS, INTENTS_FIELD, warn));
	const accounts = createOpencodeAccounts({
		settings,
		credentials,
		intents
	});
	/**
	* 凭据写入守卫（2026-11-01 修 S01 第二版）。
	*
	* `adapter` 刷新 OAuth 时用它排队写回并校验代际；**用户操作**在这里推进代际，
	* 于是「在用户操作之前发起」的迟到刷新不会写回。
	*
	* 为什么必须放在装配层：用户的凭据操作走 `accounts` 端口，刷新在 adapter 里 ——
	* 只有这一层同时看得到两边。
	*
	* **边界**：只保证本插件内的顺序一致。宿主凭据页或别的插件的写入不经过这里，
	* 所以不是「整个宿主的原子性」。
	*/
	const credentialGuard = createCredentialGuard();
	/**
	* 把账号端口的用户意图变更通知给守卫（推进代际）。
	*
	* 只包装**会让已发起的刷新失效**的操作：`add` / `replaceKey` / `remove`。
	* `rename` / `select` / `move` 等不影响凭据内容，不必推进（推进只会让在途刷新
	* 白跑一次，没有正确性收益）。
	* @param port - 原始账号端口。
	* @returns 包装后的端口（行为不变）。
	*/
	const guardedAccounts = (port) => ({
		/**
		* **必须逐个委托，不能 `{ ...port }`**（2026-11-01 修）。
		*
		* `port` 是 `OpencodeAccounts` 的**类实例** —— `list` / `rename` / `select` 等
		* 都在**原型**上，对象展开只复制实例自身属性，于是展开后 `list` 变成 `undefined`。
		* 装配测试立刻抓到：`deps.accounts.list is not a function`。
		*/
		list: () => port.list(),
		rename: (ref, label) => port.rename(ref, label),
		select: (ref) => port.select(ref),
		...port.restoreDefaultLabel === void 0 ? {} : { restoreDefaultLabel: (ref) => port.restoreDefaultLabel?.(ref) },
		...port.move === void 0 ? {} : { move: (ref, toIndex) => port.move?.(ref, toIndex) },
		...port.setOrder === void 0 ? {} : { setOrder: (order) => port.setOrder?.(order) },
		...port.setAutoSwitch === void 0 ? {} : { setAutoSwitch: (value) => port.setAutoSwitch?.(value) },
		/**
		* 新增账号：写操作**排队**，落地后推进代际。
		*
		* 报告指出的缺口：上一版只 `bump()`，用户的写**不在队列里** —— 与在途刷新
		* 仍然可以交错。现在走 `runUserWrite`（必写 + 入队时推进代际）。
		*/
		async add(input) {
			/** 新账号的 ref 由端口分配，落地前不知道；先把写排进队列，落地后再 bump 它的 ref。 */
			const added = await credentialGuard.runUserWrite("__pending_add__", () => port.add(input));
			credentialGuard.bump(added.ref);
			return added;
		},
		/**
		* 换 key：**用户写，必须无条件落地**，并且排在队列里（2026-11-01 修 S01 第三版）。
		*
		* 上一版是 `bump()` 之后直接 `port.replaceKey()` —— 它不在队列里，所以与在途的
		* 刷新写回仍然可以交错：刷新已经进入 `persistStored` 时用户换 key，两者谁后落盘
		* 取决于时序，用户的新 key 可能被覆盖。
		*
		* 现在走 `runUserWrite`：入队即推进代际（更早发起的刷新写回会放弃），
		* 且与刷新写回**共享同一条队列**（不会交错）。
		*/
		async replaceKey(ref, key) {
			await credentialGuard.runUserWrite(ref, () => port.replaceKey(ref, key));
		},
		/**
		* 删除账号：用户写，排队 + 推进代际 —— 在途刷新不会把它写回来。
		*/
		async remove(ref) {
			await credentialGuard.runUserWrite(ref, () => port.remove(ref));
		}
	});
	const guarded = guardedAccounts(accounts);
	const rotation = createRotationAccess(() => accountStateOf(document()));
	/**
	* 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
	* 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
	*/
	const capabilities = {
		reorder: true,
		pin: false,
		browserLogin: true,
		modelAccountRules: true,
		quotaShape: "percent",
		modelVisibilityWrite: "immediate",
		automaticSwitch: true
	};
	/** 额度端口：每次读数都用当时的配置（`apiBase` 是构造参数，跟着现读的配置走）。 */
	const quota = { async snapshot(accountRef, signal) {
		const apiBase = normalizeKey(document().baseURL) ?? "https://opencode.ai/zen/go/v1";
		const ref = accountRef ?? selectedRefOf(document());
		return createOpencodeQuota({
			ref: () => ref,
			resolveKey: (candidate) => resolveAccountKey(ctx, credentials, candidate),
			resolveAuth: (candidate, signal) => adapter.resolveAccountAuth(candidate, signal),
			fetchImpl: fetch,
			apiBase
		}).snapshot(ref, signal);
	} };
	const switching = new SwitchingController({
		accounts: guarded,
		quota,
		rotation,
		document,
		pinnedRef: () => pinnedRefOf(document()),
		warn
	});
	const login = createOpencodeLogin({
		fetchImpl: fetch,
		storeKey: async (ref, key, userName) => {
			const views = await accounts.list();
			const existing = views.find((view) => view.ref === ref) ?? views.find((view) => view.label === userName);
			if (existing !== void 0) {
				/**
				* **登录也是用户写**（2026-11-01 修 S01 第三版）。
				*
				* 原来这里直接 `credentials.set(...)` —— 不推进代际、不进队列。于是：
				*
				* ```
				* T0  旧 OAuth 刷新开始（记下旧代际）
				* T1  用户重新登录 → 这里直接写新 blob
				* T2  刷新返回 → 校验代际（没变）→ **把旧 blob 写回去**
				* ```
				*
				* 报告用真实 `apply` 装配复现了这个场景：登录成功后 org 又被旧刷新覆盖回去。
				*
				* 现在走 `runUserWrite`：入队即推进代际，且与刷新写回共享同一条队列。
				*/
				await credentialGuard.runUserWrite(existing.ref, () => credentials.set(existing.ref, key));
				return;
			}
			await accounts.add({
				label: userName,
				key
			});
		}
	});
	ctx.effect(() => () => {
		login.cancel();
	}, "dsh-llm-account: opencode login port");
	/**
	* 备用账号把请求服务完了：把它提成当前账号（旧插件 `GoAccountSelection.adopt` 的同一后果 ——
	* 「开始正常输出的备用账号会移至首位并成为当前账号」）。
	*
	* 策略都在这一层（适配器只报告「这次是备用账号服务的」，判定可单测）：
	* - 只在**显式** `autoSwitch: true` 时提位：关掉自动切换时顺序是用户的地盘，不擅自改；
	* - 已经是当前账号就什么都不做（省掉一次 describe + mutate 往返）；
	* - 按 ref 单飞：并发请求不会为同一账号排一串重复写入。
	*
	* 写入走账号端口的 `move(ref, 0)`：它自带修订围栏与冲突重试，并把顶层 `apiKeyEnv`
	* 跟到新队首 —— 「第一行 = 当前账号」的不变量由此保持，`list()` 的派生顺序也随之跟上。
	* 提位失败只留一行告警：一次成功的请求不该因为记不下功劳而变成失败，下次请求照常轮换。
	*/
	const promoting = /* @__PURE__ */ new Map();
	const promoteServedAccount = (ref) => {
		const current = document();
		if (current.autoSwitch !== true) return;
		if (opencodeAccountSlot(current).ref === ref) return;
		if (promoting.has(ref)) return;
		const move = accounts.move?.bind(accounts);
		if (move === void 0) return;
		const pending = move(ref, 0).then(() => void 0, (error) => {
			warn(`llm-opencode-go: could not make "${ref}" the current account (${String(error)})`);
		});
		promoting.set(ref, pending);
		pending.finally(() => {
			if (promoting.get(ref) === pending) promoting.delete(ref);
		});
	};
	const adapter = createOpencodeAdapter({
		...{
			config: () => adapterConfigOf(document()),
			get rotation() {
				return rotation.current();
			},
			quota,
			accounts: guarded,
			fetchImpl: fetch,
			resolveStored: (ref) => credentials.resolve(ref),
			resolveEnvironment: (ref) => environmentValue(ctx, ref),
			/**
			* 图片字节（2026-11-04 外部审查 U07）。
			*
			* 每次请求现取服务：`ctx.get` 在附件服务可用之前返回 undefined，而插件可能在附件服务
			* 挂载之前就已加载。原来**完全没有这一项**，于是图片被协议层静默跳过 ——
			* 目录宣称 `image` 能力、模型却收不到图。
			*/
			resolveImage: (ref, signal) => readImageBytes(ctx, ref, signal),
			persistStored: (ref, value) => credentials.set(ref, value),
			promoteServed: promoteServedAccount,
			beforeRequest: (input) => switching.beforeRequest(input),
			usage: createUsagePort(),
			fallbackCandidates: () => modelCandidates(),
			autoSwitchModel: () => document()["autoSwitchModelOnQuota"] === true,
			/**
			* 一次请求内最多试几个账号 —— 与 `autoContinueMaxAttempts` 共用同一个上限
			* （2026-10-30 统一）。原来适配器内是硬编码 16，与用户设的次数无关。
			*/
			maxTried: () => typeof document()["autoContinueMaxAttempts"] === "number" ? document()["autoContinueMaxAttempts"] : void 0
		},
		credentialGuard
	});
	registerCatalogSource({
		provider: "dsh-opencode-go",
		models: () => adapter.listModels(PROVIDER_ID).then(async (rows) => Promise.all(rows.map(async (row) => {
			const meta = await adapter.resolveModel(PROVIDER_ID, row.id).then((info) => ({
				...info.context?.contextWindow === void 0 ? {} : { contextWindow: info.context.contextWindow },
				...info.reasoning?.efforts === void 0 ? {} : { effortCount: info.reasoning.efforts.length }
			})).catch(() => ({}));
			return {
				id: row.id,
				...meta
			};
		}))),
		stream: (options) => adapter.stream(options),
		/** 现读该厂商是否启用（审查 U08）：禁用后不得再被跨网关委托。 */
		available: () => document().enabled !== false,
		allowsModel: (model) => isModelIdVisible(model, normalizeVisibility(document()))
	});
	/**
	* 当前这次路由注册的句柄；`enabled: false` 时是 `undefined`（行仍然挂载）。
	*
	* 用「释放 + 重新注册」而不是 `handle.replace([])`：与旧插件 `applyRoute` 同一形状，也让
	* 撤下与 `ctx.effect` 的释放路径共用同一个句柄。
	*/
	let registration;
	/** 按**现读**的 `enabled` 校准路由：缺省（含非布尔值）读作启用，只有显式的 `false` 撤下。 */
	const applyRoute = () => {
		const enabled = document().enabled !== false;
		if (enabled && registration === void 0) registration = registerRouteOrExplain(ctx, PROVIDER_ID, adapter);
		else if (!enabled && registration !== void 0) {
			registration();
			registration = void 0;
			ctx.logger.info("llm-opencode-go: disabled by configuration; the route and its models are withdrawn");
		}
	};
	applyRoute();
	optionalStep("opencode", "volatile-update 订阅", () => ctx.on("loader/volatile-update", () => {
		invalidateCatalogCandidates();
		applyRoute();
	}));
	optionalStep("opencode", "session/event 订阅", () => ctx.on("session/event", (...args) => switching.noteHostEvent(...args)));
	ctx.effect(() => () => {
		registration?.();
		registration = void 0;
	}, "dsh-llm-account: opencode provider route");
	optionalStep("opencode", "凭据变更订阅", () => ctx.on("credentials/reference-updated", (ref) => {
		rotation.clearCredentialRejection(ref);
	}));
	optionalStep("opencode", "用量远程面", () => applyUsageRemote(ctx, {
		vendor: PROVIDER_ID,
		rotation,
		accounts: guarded,
		quota,
		pinnedRef: () => pinnedRefOf(document()),
		quotaRef: () => selectedRefOf(document()),
		capabilities,
		models: () => adapter.catalogModels(true),
		switchState: () => switching.snapshot(),
		switchNow: () => switching.switchNow(),
		accountOrder: () => {
			const order = document().accountOrder;
			return Array.isArray(order) ? order.filter((key) => typeof key === "string") : [];
		},
		setAccountOrder: async (order) => {
			await accounts.setOrder?.(order);
		},
		setSwitchSettings: (input) => writeSwitchSettings(settings, OPENCODE_SETTINGS_NS, input),
		modelRules: () => modelRulesOf(document()),
		setAccountModels: (ref, models) => writeModelRules(settings, OPENCODE_SETTINGS_NS, (current) => assignModelsToAccount(modelRulesOf(current), ref, models)),
		login
	}));
	optionalStep("opencode", "关闭自动生成设置表单", () => disableSettingsAutoForm(ctx, OPENCODE_SETTINGS_NS));
	wireAutoContinue(ctx, () => ({
		enabled: autoContinueEnabledOf(document()),
		maxAttempts: typeof document()["autoContinueMaxAttempts"] === "number" ? document()["autoContinueMaxAttempts"] : 3,
		intervalMs: typeof document()["autoContinueIntervalMs"] === "number" ? document()["autoContinueIntervalMs"] : 2e3
	}), "opencode");
	return {
		providerId: PROVIDER_ID,
		settingsNs: OPENCODE_SETTINGS_NS,
		capabilities,
		adapter,
		rotation,
		intents,
		accounts,
		credentials,
		quota
	};
}
/**
* 解析入口收到的配置。
*
* 宿主交给 `apply` 的是**已解析**的 Config（volatile 引用就是解析产物），重复解析会把活引用
* 当成普通值；程序化构造（装配测试、将来的远程页）是普通值，必须自己过一遍 `Config`。
* @param config - `apply` 收到的原始配置。
* @returns 字段表（可能是 volatile 引用，也可能是普通值）。
*/
function parseConfig(config) {
	if (isParsedConfig(config)) return config;
	const parsed = Config(config);
	return isRecord$4(parsed) ? parsed : {};
}
/**
* 入口配置 → 适配器配置。
*
* 只有一处改名：文档字段是 `baseURL`（旧插件的字段名，用户现有配置里就是它），适配器接口
* 叫 `apiBase`。`modelLimits` 只搬适配器认识的两项（`thinkingBudgets` 属第 2 期）。
*/
function adapterConfigOf(document) {
	const baseURL = normalizeKey(document.baseURL);
	const apiBase = normalizeKey(document.apiBase);
	const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
	const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
	const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
	const catalogTtlMs = nonNegativeNumber(document.catalogTtlMs);
	const modelVisibility = booleanMap(document.modelVisibility);
	const visibleModels = stringList(document.visibleModels);
	const removedModels = stringList(document.removedModels);
	const modelLimits = modelLimitsOf(document.modelLimits);
	return {
		...apiBase === void 0 ? {} : { apiBase },
		...baseURL === void 0 ? {} : { apiBase: baseURL },
		...requestTimeoutMs === void 0 ? {} : { requestTimeoutMs },
		...streamIdleTimeoutMs === void 0 ? {} : { streamIdleTimeoutMs },
		...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
		...catalogTtlMs === void 0 ? {} : { catalogTtlMs },
		...modelVisibility === void 0 ? {} : { modelVisibility },
		...visibleModels === void 0 ? {} : { visibleModels },
		...removedModels === void 0 ? {} : { removedModels },
		...modelLimits === void 0 ? {} : { modelLimits }
	};
}
/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/** 读一个非负有限数（目录 TTL 允许 0 = 不缓存）。 */
function nonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/** 读一个字符串数组；非数组读作缺省，空数组保留（表示显式清空）。 */
function stringList(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}
/** 读一个 id → 布尔 的映射；非对象读作缺省，一个合法项都没有时也读作缺省。 */
function booleanMap(value) {
	if (!isRecord$4(value)) return void 0;
	const map = {};
	for (const [key, flag] of Object.entries(value)) if (typeof flag === "boolean") map[key] = flag;
	return Object.keys(map).length === 0 ? void 0 : map;
}
/** 读 `null | number`（`null` 与适配器接口同义：显式「用目录自报值」）。 */
function nullableNumber(value) {
	if (value === null) return null;
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** 读逐模型的上下文窗口/输出上限覆盖；没有一项可用时读作缺省（适配器用目录自报值）。 */
function modelLimitsOf(value) {
	if (!isRecord$4(value)) return void 0;
	const limits = {};
	for (const [model, entry] of Object.entries(value)) {
		if (!isRecord$4(entry)) continue;
		const contextWindow = nullableNumber(entry.contextWindow);
		const maxTokens = nullableNumber(entry.maxTokens);
		if (contextWindow === void 0 && maxTokens === void 0) continue;
		limits[model] = {
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens }
		};
	}
	return Object.keys(limits).length === 0 ? void 0 : limits;
}
/**
* 账号库状态：顺序、按模型规则（opencode 不支持，恒为空）与固定账号。
*
* **`autoSwitch` 门**（旧插件第 7515 行的同一分支）：`autoSwitch: false` 时候选集只有当前
* 账号 —— `autoSwitch ? [...new Set([preferred, ...accounts])] : [preferred]`。默认值就是
* `false`（旧插件与我们的 Config 都是），所以「关掉自动切换」必须真的只试一个账号，否则一次
* 额度拒绝就会把请求打到用户没允许的第二个账号上。只有**显式** `false` 才收窄：程序化构造的
* 文档没有这个字段时保持完整的顺序（与旧插件 `readConfig` 拿到的归一化值同义）。
*/
/** 按模型分配规则；形状不可信时逐条收窄。 */
function modelRulesOf(document) {
	const raw = document.modelAccountRules;
	if (!Array.isArray(raw)) return [];
	const rules = [];
	for (const item of raw) {
		if (!isRecord$4(item)) continue;
		const models = Array.isArray(item.models) ? item.models.filter((model) => typeof model === "string" && model.trim() !== "") : void 0;
		const account = normalizeKey(item.account);
		if (models === void 0 || models.length === 0 || account === void 0) continue;
		rules.push({
			models,
			account
		});
	}
	return rules;
}
function accountStateOf(document) {
	const derived = orderOf(document);
	return {
		/**
		* `autoSwitch: false` = 只试当前账号。
		*
		* **不能写 `[slot.ref]`**（2026-11-02 真机报障）：顶层 `apiKeyEnv` 缺失时
		* `slot.ref` 回退到内置默认名 `OPENCODE_API_KEY`，而那个凭据槽可能根本不存在 ——
		* 于是「只试当前账号」实际去试了一个幽灵账号，直接报 no API key。
		*
		* 改用派生顺序的首项：没有显式指定时它就是账号表里的第一个**真实**账号。
		*/
		order: document.autoSwitch === false ? derived.slice(0, 1) : derived,
		rules: modelRulesOf(document),
		pinned: pinnedRefOf(document)
	};
}
/** `accounts[].apiKeyEnv` 里合法的凭据引用名（合法名才可能是凭据槽；其余条目本期不支持）。 */
function accountRefsOf(document) {
	const accounts = document.accounts;
	if (!Array.isArray(accounts)) return [];
	const refs = [];
	for (const item of accounts) {
		if (!isRecord$4(item)) continue;
		const ref = normalizeKey(item.apiKeyEnv);
		if (ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref)) refs.push(ref);
	}
	return refs;
}
/**
* 轮换顺序 = 顶层当前账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
*
* 顶层 `apiKeyEnv` **必须**进顺序：旧插件的 `accountsOf` 在顶层引用不在账号表里时，会把它
* 当成 `legacy:<ref>` 补在**列表首位**；本函数是同一顺序的显式写法，账号端口的 `list()` 也会
* 合成同一行。少了它，只配了顶层密钥的存量用户会让 `RotationEngine.pick` 返回 `undefined`，
* 适配器直接报 MISSING_CREDENTIAL。
*
* ## 但**不能**凭空合成一个"幽灵账号"（2026-11-02 真机报障）
*
* 原来的写法是 `[defaultRefOf(document), ...accountRefsOf(document)]`。而
* `defaultRefOf` 在顶层 `apiKeyEnv` **缺失**时会回退到内置默认名
* {@link OPENCODE_DEFAULT_REF}（`OPENCODE_API_KEY`）。于是出现：
*
* ```
* 账号表里有 Default（凭据真实存在）
* 顶层 apiKeyEnv 缺失（或没写上）
*   → 顺序 = [OPENCODE_API_KEY, DSH_OPENCODE_GO_ACCOUNT_DEFAULT_xxx]
*   → pick() 先拿到 OPENCODE_API_KEY
*   → 那个 ref 在凭据库里根本不存在
*   → 适配器抛 “no API key for OpenCode Go account "OPENCODE_API_KEY"”
* ```
*
* 真机现象就是：界面上账号显示「已配置」，但一发请求就报默认 ref 没密钥。
*
* 现在的规则：
*
* 1. 顶层 `apiKeyEnv` **是显式合法引用名** → 它排第一（保持旧行为，存量用户不变）；
* 2. 顶层缺失/为空/非法，但账号表非空 → **只用账号表**，不合成默认槽；
* 3. 两者都空 → 才退回默认槽（真正的"什么都没配"，报错信息才有意义）。
*/
/**
* 轮换顺序（导出供测试直接验证，避免测试复刻一份逻辑）。
*
* @param document - 现读的设置文档。
* @returns 按优先级排列的账号 ref。
*/
function orderOf(document) {
	const derived = [];
	const seen = /* @__PURE__ */ new Set();
	/**
	* **真正显式指定**的当前账号。
	*
	* 这里有两层要区分：
	*
	* 1. `slot.pinned === null` —— 顶层字段缺失/空串/非法名（`opencodeAccountSlot`
	*    已归一）；
	* 2. `slot.pinned === OPENCODE_DEFAULT_REF` —— **schema 的默认值被写进了文档**！
	*
	* 第 2 条正是真机踩到的形态：`apiKeyEnv` 在 `Config` 里有
	* `.default(OPENCODE_DEFAULT_REF)`，于是文档里可能显式带着
	* `"OPENCODE_API_KEY"` 这个**幽灵 ref** —— 它不是用户填的，凭据库里也没有。
	* 若把它当成「用户指定的当前账号」，顺序首位就永远是它，真实账号根本轮不到。
	*
	* 所以：等于内置默认名时，按「没指定」处理。
	*/
	const pinnedRaw = opencodeAccountSlot(document).pinned;
	const pinned = pinnedRaw === "OPENCODE_API_KEY" && !accountRefsOf(document).includes("OPENCODE_API_KEY") ? null : pinnedRaw;
	const accounts = accountRefsOf(document);
	const candidates = pinned !== null ? [pinned, ...accounts] : accounts.length > 0 ? accounts : [OPENCODE_DEFAULT_REF];
	for (const ref of candidates) {
		if (seen.has(ref)) continue;
		seen.add(ref);
		derived.push(ref);
	}
	return globalOrderOfVendor(derived, document.accountOrder, "dsh-opencode-go");
}
/**
* 固定账号：opencode 用顶层 `apiKeyEnv` 表示「当前账号」（`AccountPort.select` 写它，
* `move` 也会把移动后的队首写进去），所以它就是引擎的固定账号；字段缺失/空串/非法引用名一律
* 读作自动轮换。
*
* 判定本身在账号端口里（`opencodeAccountSlot`）：端口的 `list()`/`select()`/`remove()` 与这里
* 必须对同一份文档给出同一个答案，否则又会出现「服务请求的账号没有行」那种裂缝。
* @param document - 现读的设置文档。
* @returns 固定账号的 ref，或 `null`（自动轮换）。
*/
function pinnedRefOf(document) {
	const pinned = opencodeAccountSlot(document).pinned;
	/**
	* **默认引用名不算「固定」**（2026-11-04 外部审查 U01）。
	*
	* `select(null)`（取消固定）把顶层 `apiKeyEnv` 写成内置默认名，而那个名字在凭据库里
	* 通常**不存在**。若把它当成固定账号，轮换引擎「永远先试 pinned」—— 于是
	* `maxAttempts = 1` 时整次请求只打了幽灵槽，真实账号一个都不试，
	* 报出来的却是「没有可用账号」。
	*
	* 与 `orderOf` 的判据保持一致：默认名按「没指定」处理。
	*
	* **但只在账号表里没有这个名字时才这样读**：用户可能真的固定了一个名叫
	* `OPENCODE_API_KEY` 的账号（历史数据或手动命名），那种固定必须照常生效。
	* 判据因此是「默认名 **且** 账号表查无此账号」，不是只看名字。
	*/
	if (pinned === "OPENCODE_API_KEY" && !accountRefsOf(document).includes("OPENCODE_API_KEY")) return null;
	return pinned;
}
/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document) {
	return pinnedRefOf(document) ?? orderOf(document)[0];
}
/**
* 解析某个账号这一读要用的密钥：按 `stored → environment` 挑第一把（opencode 没有
* auth.json 兜底，设计 §4.2 的差异表）。
* @param ctx - 插件上下文（读启动环境）。
* @param credentials - 凭据端口。
* @param ref - 目标账号 ref。
* @returns 可用的密钥，或 `undefined`。
*/
async function resolveAccountKey(ctx, credentials, ref) {
	const stored = await credentials.resolve(ref);
	if (stored !== void 0) return stored;
	return environmentValue(ctx, ref);
}
//#endregion
export { AssistantMessageEventStream as _, name as a, clampThinkingLevel as c, getInitialSystemMessage as d, resolveTranscript as f, appendAssistantMessageDiagnostic as g, renderSystemMessageUpdate as h, inject as i, getCurrentTools as l, getSystemMessageText as m, PROVIDER_ID as n, orderOf as o, resolveTranscriptTools as p, apply as r, calculateCost as s, Config as t, getDeclaredTools as u };
