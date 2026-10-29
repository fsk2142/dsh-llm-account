import { A as markVolatileFields, B as readAccountSlot, C as createSettingsIntentStore, D as intentLogFor, E as environmentValue, F as accountRef, H as normalizeKey, I as assignModelsToAccount, L as dedupeByRef, M as writeModelRules, N as writeSwitchSettings, O as isParsedConfig, P as CREDENTIAL_REF_PATTERN, R as globalOrderOfVendor, S as createRotationAccess, T as disableSettingsAutoForm, U as pickApiKey, V as reorder, _ as registerCatalogSource, a as applyUsageRemote, b as pickFallbackModel, c as LLM_REQUEST_TIMEOUT, d as normalizeVisibility, f as selectVisible, g as noteCatalogModels, h as modelCandidates, i as SwitchingController, j as unwrapVolatileConfig, k as isRecord$6, l as LLM_STREAM_IDLE_TIMEOUT, m as delegateStream, o as createUsagePort, p as NOOP_USAGE_PORT, s as rejection, t as createSearchSlotSync, u as runStream, v as assignUniqueNames, w as createSettingsPort, x as createCredentialsPort, y as officialModelName, z as moveFirst } from "./search-release-BWvuKYpB.js";
import { n as registerGatewayAccess } from "./gateway-access-B1KtcMWy.js";
import z from "@deepseek-ai/schemastery";
import { EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, ReasoningEffortId, ToolCallId, attributionHeaders, isQuotaExceededError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
//#region src/vendors/opendesign/catalog.ts
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串（目录里的 id/name 必须是非空字符串才算有效）。 */
function stringValue$3(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
/** 读取正数（上下文窗口与输出上限为 0 或负数时视为未公布）。 */
function positiveNumber$1(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/**
* 从一份负载里取出模型数组。
*
* 线上是 `{ object: "list", data: [...] }`；网关的其它端点与本地缓存可能给
* `{ models: [...] }`（与另两家同一份容错），两种都认。
* @param payload - 目录负载。
* @returns 待解析的原始行；形状不认识时为空数组。
*/
function rowsOf(payload) {
	if (Array.isArray(payload.data)) return payload.data;
	if (Array.isArray(payload.models)) return payload.models;
	return [];
}
/**
* 读出一行的输入模态。
*
* **opendesign 把能力放在嵌套的 `architecture` 里**（2026-10-20 用真实目录实测）：
*
* ```json
* "architecture": { "input_modalities": ["text","image"], "output_modalities": ["text"] }
* ```
*
* 顶层**没有** `modalities` / `image` 字段。只认顶层的旧实现因此把所有模型都读成
* 「仅文本」—— 包括上游明确声明支持图片的 `deepseek-v4.1-flash`（`[text,image]`）、
* `deepseek-v4-flash-vision-exp`、`kimi-k2.7-code` 等，宿主的图片按钮就永远不出现。
*
* 取值优先级：顶层 `modalities` / `image`（若有）> `architecture.input_modalities`。
* `video` / `audio` / `file` 这类**不映射**到宿主的模态判定：宿主的 `ModelModality` 只有
* 文本与图片两档，把 `file` 也算成图片会让「能读附件」的模型误显示为能读图。
* @param row - 一行原始目录数据。
* @returns 至少含 `"text"` 的模态列表。
*/
function inputModalitiesOf(row) {
	const declared = row.modalities;
	const fromList = Array.isArray(declared) && declared.includes("image");
	const inputs = (isRecord$5(row.architecture) ? row.architecture : void 0)?.input_modalities;
	const fromArchitecture = Array.isArray(inputs) && inputs.includes("image");
	if (fromList || fromArchitecture || row.image === true) return ["text", "image"];
	return ["text"];
}
/**
* 读出一行声明的推理档位。
*
* 只信负载自己声明的档位（`efforts` / `supported_efforts` / `reasoning_efforts`）：未声明
* 就是**未知**，不猜（适配器随之不向宿主声明档位）。
* @param row - 一行原始目录数据。
* @returns 档位 id（按负载顺序）；未声明时为空数组。
*/
function effortsOf(row) {
	const declared = row.efforts ?? row.supported_efforts ?? row.reasoning_efforts;
	if (!Array.isArray(declared)) return [];
	return declared.filter((item) => typeof item === "string" && item !== "");
}
/**
* 解析一份 Open Design 目录负载。
*
* 有效的行只要有非空 `id`：OpenAI 形状的 `/v1/models` 常常**不带展示名**（线上就是
* `{ id, object, created, owned_by }`），照搬另两家「缺 name 就忽略」会把整份目录丢光；
* 缺 `name` 时按 `name = id` 收下，页面本来也是这么兜底的。
* `contextWindow` / `maxTokens` 缺失时**不写**该字段，让「未公布」与「公布为 0」在数据上可区分。
*
* 展示名与另两家同一套：由 id 派生（{@link assignUniqueNames}）。负载给的 `name` 与 id
* 不同时仍然优先 —— 这家哪天开始公布真名就以它为准，那是更新的真相；但它必须与另两家
* 的写法一致才用得上（`name === id` 的回显照旧走规则）。
* @param payload - 已解析的响应正文（形状不可信）。
* @returns 可用条目与被忽略的行数。
*/
function parseCatalog(payload) {
	if (!isRecord$5(payload)) return {
		entries: [],
		ignored: 0
	};
	const rows = rowsOf(payload);
	const entries = [];
	/** 每行声明的 name（可能缺省）；与 id 相同视为「没公布」。 */
	const declaredNames = [];
	let ignored = 0;
	for (const raw of rows) {
		if (!isRecord$5(raw)) {
			ignored += 1;
			continue;
		}
		const id = stringValue$3(raw.id);
		if (id === void 0) {
			ignored += 1;
			continue;
		}
		const declared = stringValue$3(raw.name);
		declaredNames.push(declared !== void 0 && declared !== id ? declared : void 0);
		const meta = isRecord$5(raw.metadata) ? raw.metadata : void 0;
		const contextWindow = positiveNumber$1(raw.context_length ?? raw.contextWindow ?? meta?.context_limit ?? meta?.contextWindow);
		const maxTokens = positiveNumber$1(raw.max_output_tokens ?? raw.maxTokens ?? raw.publishedMaxTokens ?? meta?.output_budget ?? meta?.max_output_tokens);
		const efforts = effortsOf(raw);
		entries.push({
			id,
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens },
			...efforts.length === 0 ? {} : { efforts },
			inputModalities: inputModalitiesOf(raw)
		});
	}
	const generated = assignUniqueNames(entries.map((entry) => entry.id));
	return {
		entries: entries.map((entry, index) => ({
			...entry,
			name: declaredNames[index] ?? generated[index] ?? officialModelName(entry.id) ?? entry.id
		})),
		ignored
	};
}
//#endregion
//#region src/vendors/opendesign/efforts.ts
/**
* Open Design 的推理档位：**逐模型实测表优先，模型族兜底**。
*
* 为什么需要这份表：`GET /v1/models` 走 OpenAI 目录形状（`{ id, object, created, owned_by,
* metadata, architecture }`），**不公布档位**。而宿主的思考强度选择器完全由
* `resolveModel().reasoning.effects` 驱动 —— 不声明就等于这家没有档位可选。
*
* 为什么能"实测"：这个网关对**不认识的档位**会回 400，而且正文直接把该模型的白名单念出来
* （`use one of none, minimal, low, medium, high, xhigh, ultra, max` /
* `expected one of "max"|"xhigh"|…`）。2026-10-18 用本机登录产物对每个可用模型各打一次
* `reasoning_effort: __probe__`，把网关自己说的白名单抄成了 {@link MEASURED_EFFORTS}。
* 这份表比推断可靠得多 —— 之前按族给的 `low/high` 漏掉了 DeepSeek 的 `max`（实际情况：
* 「opendesign 的 DeepSeek 不能设置 max 思考吗？」），而实测它支持到 8 档。
*
* 纪律：
* 1. 表里有的模型**只用表**（网关亲口说的）；
* 2. 表里没有的按模型族兜底（顺序即选择器顺序，由弱到强）；
* 3. 族也认不出就**不声明**：猜一组档位换来的是发出去就被拒的请求，比「没有档位可选」更糟；
* 4. 目录哪天自己公布档位（`efforts` / `supported_efforts` / `reasoning_efforts`）就以目录为准。
* @module dsh-llm-account/src/vendors/opendesign/efforts
*/
/**
* DeepSeek 的**官方四档**：`off / low / high / max`。
*
* 网关其实还接受 `none / minimal / medium / xhigh / ultra`（把别名摊平成上游的四档），
* 但全摆出来只会让选择器变成一张让人选不清的表 —— 官方口径是四档，界面就四档。
*/
const DEEPSEEK_TIERS = [
	"off",
	"low",
	"high",
	"max"
];
/** Claude / GPT / 未实测族：官方档位到 `max`（`none`/`minimal` 是网关别名，不摆出来）。 */
const FIVE_TIERS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/** GLM 只认三档（网关原文：`use one of low, high, max`）。 */
const GLM_TIERS = [
	"low",
	"high",
	"max"
];
/** Kimi：网关明确不接受 `max`（原文只到 `xhigh`），官方口径也就两档。 */
const KIMI_TIERS = ["low", "high"];
/** 未实测族用的保守集：有 `max`，但不声明只有部分厂商认的 `none` / `minimal` / `ultra`。 */
const GENERIC_TIERS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* 网关实测的逐模型白名单（2026-10-18，账号可用的 12 个模型全部覆盖）。
*
* 键是小写 id（比对时统一小写）；值按由弱到强排列，选择器直接用这个顺序。
*/
const MEASURED_EFFORTS = {
	"claude-haiku-5.5": FIVE_TIERS,
	"deepseek-v4-flash": DEEPSEEK_TIERS,
	"deepseek-v4-flash-vision-exp": DEEPSEEK_TIERS,
	"deepseek-v4-pro": DEEPSEEK_TIERS,
	"deepseek-v4.1-flash": DEEPSEEK_TIERS,
	"glm-5.3-flash": GLM_TIERS,
	"glm-5.3-flashx": GLM_TIERS,
	"gpt-6-luna": FIVE_TIERS,
	"hy4-preview": FIVE_TIERS,
	"kimi-k2.7-code": KIMI_TIERS,
	"mimo-v2.6-flash": FIVE_TIERS,
	"mimo-v2.6-pro": FIVE_TIERS
};
/** 模型族 → 档位。顺序即优先级，命中即停（只对**表里没有**的模型生效）。 */
const FAMILIES = [
	{
		pattern: /(?:^|[/_-])(?:claude|anthropic)(?:[/_-]|$)/i,
		efforts: FIVE_TIERS
	},
	{
		pattern: /(?:^|[/_-])deepseek(?:[/_-]|$)/i,
		efforts: DEEPSEEK_TIERS
	},
	{
		pattern: /(?:^|[/_-])(?:glm|z-ai|zai)(?:[/_-]|$)/i,
		efforts: GLM_TIERS
	},
	{
		pattern: /(?:^|[/_-])(?:kimi|moonshot)(?:[/_-]|$)/i,
		efforts: KIMI_TIERS
	},
	{
		pattern: /(?:^|[/_-])(?:gpt-?[5-9]|o[1-9](?:$|[/_-]))/i,
		efforts: FIVE_TIERS
	},
	{
		pattern: /(?:^|[/_-])gemini(?:[/_-]|$)/i,
		efforts: GENERIC_TIERS
	},
	{
		pattern: /(?:^|[/_-])grok(?:[/_-]|$)/i,
		efforts: GENERIC_TIERS
	},
	{
		pattern: /(?:^|[/_-])qwen(?:[/_-]|\d)/i,
		efforts: GENERIC_TIERS
	},
	{
		pattern: /(?:^|[/_-])(?:mimo|hy\d)(?:[/_-]|\d)/i,
		efforts: GENERIC_TIERS
	}
];
/**
* 查一个模型在**没有目录声明**时的可选档位。
* @param model - 模型 id。
* @returns 档位列表；既不在实测表里、族也认不出时为空数组（不声明）。
*/
function familyEfforts(model) {
	const measured = MEASURED_EFFORTS[model.trim().toLowerCase()];
	if (measured !== void 0) return measured;
	for (const family of FAMILIES) if (family.pattern.test(model)) return family.efforts;
	return [];
}
/**
* 一个模型最终声明的档位：目录声明优先，其次是实测表 / 模型族兜底。
* @param model - 模型 id。
* @param declared - 目录里声明的档位（可为空/缺省）。
* @returns 档位列表；都认不出时为空数组。
*/
function effortsFor(model, declared) {
	if (declared !== void 0 && declared.length > 0) return declared;
	return familyEfforts(model);
}
/** 档位强弱顺序（用于「网关拒绝时降一档」）。`off` 是 `none` 的别名，排在它前面。 */
const STRENGTH_ORDER = [
	"off",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"ultra",
	"max"
];
/**
* 从网关的 400 正文里读出它认的档位白名单。
*
* 这个网关两种口吻都出现过：
* - `[code=invalid_request_error] reasoning effort is unsupported for deepseek-v4-pro; use one of none, minimal, …`
* - `[code=upstream_error] reasoning_effort: Invalid option: expected one of "max"|"xhigh"|…`
* @param body - 已解析的错误正文（对象或原始文本）。
* @returns 白名单（可能为空）。
*/
function allowedEffortsIn(body) {
	const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
	const after = text.includes("use one of") ? text.slice(text.indexOf("use one of") + 10) : text.includes("expected one of") ? text.slice(text.indexOf("expected one of") + 15) : "";
	if (after === "") return [];
	const found = after.match(/[a-z]+/gi) ?? [];
	const allowed = [];
	for (const token of found) {
		const value = token.toLowerCase();
		if (!STRENGTH_ORDER.includes(value)) {
			if (allowed.length > 0) break;
			continue;
		}
		if (!allowed.includes(value)) allowed.push(value);
	}
	return allowed;
}
/**
* 网关拒绝了某个档位时，挑一个「不高于它、但被允许」的最强档位。
* @param requested - 用户/宿主选的档位。
* @param allowed - 网关白名单。
* @returns 可用的替代档位；没有更弱的可选项时为 `undefined`（调用方会去掉字段重发）。
*/
function nearestAllowedEffort(requested, allowed) {
	const wanted = STRENGTH_ORDER.indexOf(requested.toLowerCase());
	const usable = allowed.map((value) => ({
		value,
		rank: STRENGTH_ORDER.indexOf(value)
	})).filter((entry) => entry.rank >= 0).sort((left, right) => left.rank - right.rank);
	if (usable.length === 0) return void 0;
	if (wanted < 0) return usable[usable.length - 1].value;
	let best;
	for (const entry of usable) {
		if (entry.rank > wanted) break;
		best = entry.value;
	}
	return best ?? usable[0].value;
}
//#endregion
//#region src/vendors/opendesign/failures.ts
/**
* Open Design 网关原始失败 → 统一失败分类。
*
* 本模块是纯函数：只读入 HTTP 状态与已解析的错误正文，产出一个 {@link Rejection}；
* 不做 I/O、不持有状态、不认识账号。分类口径来自厂商事实（`2026-10-18-opendesign-plan.md` §0）：
*
* - **401 = 登录过期**（凭据问题，换账号有意义 → `invalid-credential`）；
* - **402 = 上游拒绝**，**不是**密钥过期：绝不归因成凭据失效，按账号级不可用处置
*   （`unavailable`，有冷却窗口、可被后续请求换号）；
* - 403 = 权限/地域闸门（`unavailable`）；404 = 模型不存在（请求级，不换号）；
* - 429 = 限流；408/504 与 5xx = 服务端瞬时（`server`，不进拒绝表）；
* - 400/413/422 = 请求本身被拒（请求级，换账号没有意义）。
*
* 结构化词表（`error.type` / `error.code` 归一化后比对）优先于状态回落 —— 顺序即优先级，
* 与两个既有厂商的分类器同一形状。词表全不命中时才看 HTTP 状态；没有状态（`status <= 0`，
* 流中途事件或传输失败）时先看文案是否点名配额/凭据，再按文案表归类，
* **认不出来就返回 `undefined`**：确定性的流内终态既不换账号重放，也不该被宿主当瞬时故障重试。
* @module dsh-llm-account/src/vendors/opendesign/failures
*/
/** 结构化词表：`error.type` / `error.code` 归一化后逐项比对。 */
const UNKNOWN_MODEL_TYPES = /* @__PURE__ */ new Set([
	"modelerror",
	"modelnotfound",
	"unknownmodel",
	"invalidmodel"
]);
/** 额度用尽（OpenAI 系网关的两种常见拼法 + 余额不足）。 */
const QUOTA_TYPES = /* @__PURE__ */ new Set([
	"insufficientquota",
	"quotaexceeded",
	"insufficientcredits",
	"creditsexhausted",
	"outofcredits",
	"insufficientbalance",
	"nobalance"
]);
/** 密钥/登录失效（401 的结构化写法）。 */
const INVALID_CREDENTIAL_TYPES = /* @__PURE__ */ new Set([
	"autherror",
	"authenticationerror",
	"invalidapikey",
	"invalidkey",
	"expiredtoken",
	"tokenexpired",
	"loginrequired",
	"unauthenticated"
]);
/** 上游拒绝 / 地域 / 权限闸门：同一账号换 key 也过不去，归 `unavailable`。 */
const UNAVAILABLE_TYPES = /* @__PURE__ */ new Set([
	"upstreamerror",
	"upstreamfailure",
	"upstreamrefusal",
	"regionerror",
	"datapolicyerror",
	"permissionerror",
	"permissiondenied",
	"accountdisabled",
	"accountsuspended"
]);
/** 限流。 */
const RATE_LIMIT_TYPES = /* @__PURE__ */ new Set([
	"ratelimiterror",
	"ratelimitexceeded",
	"toomanyrequests"
]);
/** 401 文案里点名登录/密钥失效。 */
const INVALID_KEY_PROSE = /(?:invalid|incorrect|expired|revoked)[ _-]?(?:api[ _-]?)?key|invalid credential|login (?:has )?expired|token (?:has )?expired|not (?:logged|signed) in/i;
/**
* 没有 HTTP 状态时的文案判据。这张表存在的理由与其它厂商一致：**「认不出来」不等于
* 「网络抖动」** —— 只有文案真的像传输问题（`network` / `connection` / `socket` / `fetch` /
* `ECONN*` / `premature close` / 流提前结束…）才当瞬时故障；认不出来的确定性命终态返回
* `undefined`，既不换账号重放、也不该被宿主重试。
*/
const IN_BAND_RULES = [
	{
		pattern: /\b401\b|unauthori[sz]ed/i,
		kind: "invalid-credential"
	},
	{
		pattern: /\b40[23]\b|forbidden|upstream (?:refused|rejected)/i,
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
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串字段。 */
function stringValue$2(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* 归一化一份错误正文。
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
	const root = isRecord$4(parsed) ? parsed : void 0;
	const source = (root !== void 0 && isRecord$4(root.error) ? root.error : void 0) ?? root;
	if (source === void 0) return { types: [] };
	const type = stringValue$2(source.type);
	const code = stringValue$2(source.code);
	const message = stringValue$2(source.message);
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
* Open Design 状态/正文 → 统一失败分类。
*
* 口径（顺序即优先级）：
* - 词表命中模型不存在 → `undefined`：请求级，换账号没有意义；
* - 词表命中 {@link QUOTA_TYPES} → `quota`；{@link INVALID_CREDENTIAL_TYPES} → `invalid-credential`；
*   {@link UNAVAILABLE_TYPES} → `unavailable`；{@link RATE_LIMIT_TYPES} → `rate-limit`；
* - 未拿到响应（`status <= 0`）→ 先看文案是否点名配额/密钥失效，再按 {@link IN_BAND_RULES}
*   归入限流 / 5xx / 超时 / 传输；**认不出来就返回 `undefined`**；
* - 401/402/403/429 且文案像配额用尽 → `quota`；
* - 401 → `invalid-credential`（厂商事实：401 = 登录过期）；
* - 402/403 → `unavailable`（**402 是上游拒绝，不是密钥过期**）；
* - 404 → `undefined`；429 → `rate-limit`；
* - 408/504 与 5xx → `server`（瞬时，不污染账号状态）；
* - 400/413/422 → `undefined`（请求本身被拒）；其余 → `undefined`。
* @param status - HTTP 状态码；`0` 表示没拿到响应（流中途事件或传输失败）。
* @param body - 已解析的响应正文，或原始文本。
* @returns 账号级失败分类；请求级（不可轮换）拒绝时为 `undefined`。
*/
function classifyOpenDesignFailure(status, body) {
	const parsed = readGatewayError(body);
	const rawText = rawTextOf(body);
	const message = parsed.message ?? rawText;
	const has = (set) => parsed.types.some((type) => set.has(type));
	if (has(UNKNOWN_MODEL_TYPES)) return;
	if (has(QUOTA_TYPES)) return rejection("quota", `Open Design 拒绝了本次请求（${parsed.type ?? parsed.code ?? "quota"}）：该账号的额度已用尽`);
	if (has(INVALID_CREDENTIAL_TYPES)) return rejection("invalid-credential", "Open Design 返回鉴权失败：该账号的登录已过期，请重新登录或更换密钥");
	if (has(UNAVAILABLE_TYPES)) return rejection("unavailable", `Open Design 拒绝了本次请求（${parsed.type ?? parsed.code ?? "upstream"}）：上游拒绝了这次请求`);
	if (has(RATE_LIMIT_TYPES)) return rejection("rate-limit", "Open Design 返回限流：当前账号被限流，未公布重置时间，按短冷却处理");
	if (status <= 0) {
		if (isQuotaExceededError(message)) return rejection("quota", `Open Design 请求失败：${message}`);
		if (INVALID_KEY_PROSE.test(message)) return rejection("invalid-credential", `Open Design 请求失败：${message}`);
		const rule = IN_BAND_RULES.find((entry) => entry.pattern.test(message));
		if (rule === void 0) return;
		if (rule.kind === void 0) return void 0;
		if (rule.kind === "network") return rejection("network", `Open Design 请求未获得响应：${message === "" ? "连接失败（网络或代理问题）" : message}，已按瞬时故障处理`);
		return rejection(rule.kind, `Open Design 流内失败（${rule.kind}）：${message}`);
	}
	if ([
		401,
		402,
		403,
		429
	].includes(status) && isQuotaExceededError(message)) return rejection("quota", `Open Design 返回 HTTP ${status}：该账号的额度已用尽`);
	if (status === 401) return rejection("invalid-credential", "Open Design 返回 401：该账号的登录已过期，请重新登录或更换密钥");
	if (status === 402 || status === 403) return rejection("unavailable", `Open Design 返回 HTTP ${status}：上游拒绝了这次请求（不是密钥过期）`);
	if (status === 404) return;
	if (status === 429) return rejection("rate-limit", "Open Design 返回 429：当前账号被限流，未公布重置时间，按短冷却处理");
	if (status === 408 || status === 504 || status >= 500) return rejection("server", `Open Design 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
	if (status === 400 || status === 413 || status === 422) return;
}
/** 分类到宿主错误码的映射（与另两家适配器共用一套词汇表）。 */
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
function openDesignLlmError(value, status, cause) {
	const options = {
		...status !== void 0 && status > 0 ? { status } : {},
		...cause === void 0 ? {} : { cause }
	};
	return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
//#endregion
//#region src/vendors/opendesign/protocol.ts
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
/** 推理网关默认基地址（计划 §1：`amr-link` 是运行时链路的入口）。 */
const DEFAULT_BASE_URL = "https://amr-link.open-design.ai/v1";
/** 目录端点路径（OpenAI 形状：基地址已含 `/v1`）。 */
const MODELS_PATH = "/models";
/** Chat Completions 端点路径。 */
const CHAT_COMPLETIONS_PATH = "/chat/completions";
/** 默认整请求 deadline（与另两家同一档：长回答允许跑满 5 分钟）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e5;
/** 默认流空闲看门狗（毫秒）。 */
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
/** 默认输出上限（未指定 `maxTokens` 时的封顶）。 */
const DEFAULT_GENERATE_MAX_TOKENS = 131072;
/** 身份传输头：中间压缩会破坏 SSE 的逐字节时间语义。 */
const IDENTITY_ENCODING_HEADER = { "accept-encoding": "identity" };
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串。 */
function stringValue$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** 读取有限数字。 */
function numberValue$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/** 去掉基地址末尾的斜杠（用户可能把 `/v1/` 写进来）。 */
function trimBase$1(base) {
	return base.replace(/\/+$/, "");
}
/** Chat Completions 端点（唯一一条传输）。 */
function generateEndpoint(base) {
	return `${trimBase$1(base)}${CHAT_COMPLETIONS_PATH}`;
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
function catalogRequest(base, key) {
	return {
		url: `${trimBase$1(base)}${MODELS_PATH}`,
		headers: {
			accept: "application/json",
			...IDENTITY_ENCODING_HEADER,
			...key === void 0 || key === "" ? {} : { Authorization: `Bearer ${key}` },
			...attributionHeaders()
		}
	};
}
/**
* 生成请求的头与 URL：`Content-Type` + 身份编码 + `Authorization: Bearer` +
* attribution + `Accept: text/event-stream`。
* @param input - 基地址、密钥与已序列化请求体。
* @returns 可直接交给 `fetch` 的 URL、请求头与请求体。
*/
function generateRequest(input) {
	return {
		url: generateEndpoint(input.base),
		headers: {
			"Content-Type": "application/json",
			...IDENTITY_ENCODING_HEADER,
			Authorization: `Bearer ${input.key}`,
			...attributionHeaders(),
			Accept: "text/event-stream"
		},
		body: input.body
	};
}
/** 把一段内容压成纯文本（文件块仍属后续期次；图片见 {@link openAiUserContent}）。 */
function textOf(content) {
	const parts = [];
	for (const block of content) if (block.type === "text") parts.push(block.text);
	return parts.join("");
}
/**
* 把 user 消息的内容转成 OpenAI 形状。
*
* 文本 + 图片混排时用 **content 数组**（`[{type:"text"},{type:"image_url"}]`）；
* 只有文本时仍然发纯字符串 —— 那是绝大多数请求，也避免给所有上游塞一个数组。
*
* 图片按 `image_url` 发 data URL（OpenAI 兼容网关的通用形状）。**取不到字节的图片
* 会降级成文字占位**，绝不静默丢弃：用户至少能看到「这里本该有一张图」。
* @param content - 一条 user 消息的内容块。
* @param images - 已取到字节的图片，按 attachment id 索引。
* @returns OpenAI 形状的 `content`（字符串或内容数组）。
*/
function openAiUserContent(content, images) {
	if (!content.some((block) => block.type === "image")) return textOf(content);
	const parts = [];
	for (const block of content) {
		if (block.type === "text") {
			if (block.text !== "") parts.push({
				type: "text",
				text: block.text
			});
			continue;
		}
		if (block.type !== "image") continue;
		const id = block.attachment?.attachmentId;
		const bytes = typeof id === "string" ? images?.get(id) : void 0;
		if (bytes === void 0) {
			parts.push({
				type: "text",
				text: `[图片未能发送：${typeof id === "string" ? id : "未知附件"}]`
			});
			continue;
		}
		parts.push({
			type: "image_url",
			image_url: { url: dataUrlOf(bytes) }
		});
	}
	return parts.length === 0 ? "" : parts;
}
/** 把编码后的字节拼成 data URL。 */
function dataUrlOf(image) {
	const base64 = Buffer.from(image.data).toString("base64");
	return `data:${image.mediaType};base64,${base64}`;
}
/** 把 `tool.parameters` 包成对象（宿主已保证它是对象）。 */
function toolSchema(parameters) {
	return {
		type: "object",
		properties: {},
		additionalProperties: true,
		...parameters
	};
}
/** Chat Completions 的 messages 数组（OpenAI 形状：user / assistant(+tool_calls) / tool）。 */
function openAiMessages(messages, images) {
	const out = [];
	for (const message of messages) {
		if (message.role === "system" || message.role === "developer") continue;
		if (message.role === "user") {
			out.push({
				role: "user",
				content: openAiUserContent(message.content, images)
			});
			continue;
		}
		if (message.role === "assistant") {
			const calls = message.content.filter((block) => block.type === "tool-call");
			const text = textOf(message.content);
			out.push({
				role: "assistant",
				content: text,
				...calls.length === 0 ? {} : { tool_calls: calls.map((call) => ({
					id: call.id,
					type: "function",
					function: {
						name: call.name,
						arguments: call.arguments
					}
				})) }
			});
			continue;
		}
		out.push({
			role: "tool",
			tool_call_id: message.toolCallId,
			content: textOf(message.content)
		});
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
function buildRequestBody(options, facts, images) {
	const tools = options.tools ?? [];
	return {
		model: options.model,
		messages: [...facts.systemText === "" ? [] : [{
			role: "system",
			content: facts.systemText
		}], ...openAiMessages(options.messages, images)],
		...tools.length === 0 ? {} : { tools: tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: toolSchema(tool.parameters)
			}
		})) },
		max_tokens: facts.maxTokens,
		temperature: options.temperature ?? .3,
		stream: true,
		...options.stop === void 0 || options.stop.length === 0 ? {} : { stop: [...options.stop] },
		...facts.reasoningEffort === void 0 ? {} : { reasoning_effort: facts.reasoningEffort }
	};
}
/** 错误原因的最大长度（够看清，又不至于把界面撑爆）。 */
const ERROR_REASON_LIMIT = 300;
/**
* 从厂商的**错误正文**里抽出可读原因（诊断用）。
*
* 为什么需要：`Open Design stream error (status 400)` 这句话里只有
* 状态码，而 400 的**真实原因**（上下文超限 / 参数错 / 该模型不支持这个字段）全在正文里。
* 正文早已被 `readErrorBody` 读出来并存进 `body`，却从来没人把它转成人话 —— 用户只能拿一个
* 「400」去猜。
*
* 只做**保守提取**：认得几种常见形状（`error.message` / `message` / 纯文本），
* 取不到就返回 `undefined`，绝不编造。截断到 {@link ERROR_REASON_LIMIT}，避免把整段
* HTML 错误页贴到界面上。
* @param body - `readErrorBody` 的结果（可能是对象、字符串或 `undefined`）。
* @returns 可读原因；提取不到时 `undefined`。
*/
function errorReasonOf(body) {
	const pick = (value) => {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		if (trimmed === "") return void 0;
		return trimmed.length <= ERROR_REASON_LIMIT ? trimmed : `${trimmed.slice(0, ERROR_REASON_LIMIT)}…`;
	};
	if (typeof body === "string") return pick(body);
	if (!isRecord$3(body)) return void 0;
	const nested = isRecord$3(body.error) ? body.error : void 0;
	const known = pick(nested?.message) ?? pick(body.message) ?? pick(nested?.type) ?? pick(body.type);
	if (known !== void 0) return known;
	if (Object.values(body).flatMap((value) => typeof value === "string" ? [value] : isRecord$3(value) ? Object.values(value).filter((item) => typeof item === "string") : []).join("").replace(/\s/g, "") === "") return void 0;
	return pick(JSON.stringify(body));
}
/**
* 流中途报告的拒绝（SSE `error` 事件或非 2xx 响应）。
*
* 刻意不是 `LlmError`：它承载的是「厂商原始状态 + 原始正文」，由适配器用
* {@link classifyOpenDesignFailure} 统一分类；直接抛给宿主会丢掉分类所需的证据。
*
* 消息里**带上从正文提取的原因**（如果提取得到）：只报状态码的报错，用户无法自查。
*/
var OpenDesignStreamFailure = class extends Error {
	/** 厂商给出的 HTTP 状态；流中途事件未带状态时为 `0`。 */
	status;
	/** 厂商给出的原始错误正文。 */
	body;
	/**
	* @param status - HTTP 状态；`0` 表示事件里没带。
	* @param body - 原始错误正文。
	*/
	constructor(status, body) {
		const reason = errorReasonOf(body);
		super(`Open Design stream error (status ${status})${reason === void 0 ? "" : `：${reason}`}`);
		this.name = "OpenDesignStreamFailure";
		this.status = status;
		this.body = body;
	}
};
/** 把一次 SSE `error` 事件/正文转成 {@link OpenDesignStreamFailure}。 */
function streamFailure(body) {
	return new OpenDesignStreamFailure(isRecord$3(body) ? numberValue$1(body.statusCode) ?? numberValue$1(body.status) ?? 0 : 0, body);
}
/** Chat Completions 的 usage 形状 → 宿主计数（缓存命中要从 prompt 里减出来）。 */
function openAiUsage(raw) {
	if (!isRecord$3(raw)) return void 0;
	const prompt = numberValue$1(raw.prompt_tokens) ?? 0;
	const cached = numberValue$1((isRecord$3(raw.prompt_tokens_details) ? raw.prompt_tokens_details : void 0)?.cached_tokens) ?? 0;
	const completion = numberValue$1(raw.completion_tokens) ?? 0;
	const usage = {
		inputTokens: Math.max(0, prompt - cached),
		outputTokens: completion,
		cacheReadTokens: cached
	};
	const total = numberValue$1(raw.total_tokens);
	if (total !== void 0) usage.totalTokens = total;
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
function mapFinishReason(raw, producedContent) {
	switch (raw) {
		case "tool_calls":
		case "function_call":
		case "tool_use": return { kind: "tool-calls" };
		case "length":
		case "max_tokens":
			if (!producedContent) return {
				kind: "error",
				failure: {
					message: "the model produced no content at its output cap (finish_reason \"length\"). The prompt may leave too little room for an answer. Compact the context or raise this model's max output, then retry",
					code: "INVALID_REQUEST"
				}
			};
			return { kind: "max-tokens" };
		default: return { kind: "stop" };
	}
}
/** 一次 usage 计入的 token 总数（缺 `totalTokens` 时按分项相加，缺分项按 0）。 */
function usageTotalOf(usage) {
	return usage.totalTokens ?? usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/**
* 一条 chunk 是否代表「流真的产出了东西」。
*
* 用来在**没有任何终止事件**的情况下区分「空响应」（必须报可重试错误）与
* 「有内容但被截断」（补一条 finish）。
* @param chunk - 已装配好、即将交给宿主的 chunk。
* @returns 是否算作内容。
*/
function chunkIsContent(chunk) {
	switch (chunk.type) {
		case "text-delta":
		case "reasoning-delta": return chunk.text !== "";
		case "tool-call-delta": return chunk.argumentsDelta !== "" || chunk.name !== "";
		case "block-end": return chunk.block.type === "tool-call";
		case "usage": return usageTotalOf(chunk.usage) > 0;
		default: return false;
	}
}
/**
* 块装配器：把一个响应的增量拼成宿主的分块事件流（`block-start` / `*-delta` /
* `block-end`），并保证同一时间只有一个文本块与一个推理块处于打开状态。
*/
var StreamAssembler = class {
	#nextIndex = 0;
	#textIndex = -1;
	#text = "";
	#reasoningIndex = -1;
	#reasoning = "";
	#openAiTools = [];
	#finished = false;
	/** 本流是否真的产出过内容（文本/推理/工具调用）。 */
	#producedContent = false;
	#openText() {
		if (this.#textIndex >= 0) return [];
		this.#textIndex = this.#nextIndex;
		this.#nextIndex += 1;
		return [{
			type: "block-start",
			index: this.#textIndex,
			blockType: "text"
		}];
	}
	#openReasoning() {
		if (this.#reasoningIndex >= 0) return [];
		this.#reasoningIndex = this.#nextIndex;
		this.#nextIndex += 1;
		return [{
			type: "block-start",
			index: this.#reasoningIndex,
			blockType: "reasoning"
		}];
	}
	/** 关闭文本块并交出装配好的内容。 */
	closeText() {
		if (this.#textIndex < 0) return [];
		const chunk = {
			type: "block-end",
			index: this.#textIndex,
			block: {
				type: "text",
				text: this.#text
			}
		};
		this.#textIndex = -1;
		this.#text = "";
		return [chunk];
	}
	/** 关闭推理块并交出装配好的内容。 */
	closeReasoning() {
		if (this.#reasoningIndex < 0) return [];
		const chunk = {
			type: "block-end",
			index: this.#reasoningIndex,
			block: {
				type: "reasoning",
				text: this.#reasoning
			}
		};
		this.#reasoningIndex = -1;
		this.#reasoning = "";
		return [chunk];
	}
	/** 追加一段可见文本（顺带关闭推理块）。 */
	textDelta(text) {
		if (text === "") return [];
		const chunks = [...this.closeReasoning(), ...this.#openText()];
		this.#text += text;
		this.#producedContent = true;
		chunks.push({
			type: "text-delta",
			index: this.#textIndex,
			text
		});
		return chunks;
	}
	/** 追加一段推理文本（顺带关闭文本块）。 */
	reasoningDelta(text) {
		if (text === "") return [];
		const chunks = [...this.closeText(), ...this.#openReasoning()];
		this.#reasoning += text;
		this.#producedContent = true;
		chunks.push({
			type: "reasoning-delta",
			index: this.#reasoningIndex,
			text
		});
		return chunks;
	}
	/** 合并一个 Chat Completions 工具调用片段。 */
	addOpenAiToolCall(fragment) {
		this.#producedContent = true;
		let existing = this.#openAiTools.find((call) => call.index === fragment.index);
		if (existing === void 0) {
			existing = {
				index: fragment.index,
				id: fragment.id ?? "",
				name: fragment.name ?? "",
				arguments: ""
			};
			this.#openAiTools.push(existing);
		} else {
			if (fragment.id !== void 0 && existing.id === "") existing.id = fragment.id;
			if (fragment.name !== void 0 && existing.name === "") existing.name = fragment.name;
		}
		if (fragment.arguments !== void 0) existing.arguments += fragment.arguments;
	}
	/**
	* 是否还缓冲着尚未交出的 OpenAI 工具调用片段。
	*
	* 它已经是「有内容」的证据（收到 `delta.tool_calls` 的当刻就算产出），但这些片段要到
	* {@link flushOpenAiToolCalls} 才变成 chunk —— 只看已产出的 chunk 会在流末把它误判成
	* 空响应，并连带丢掉一个真实的工具调用。
	*/
	get hasBufferedToolCall() {
		return this.#openAiTools.length > 0;
	}
	/** 本流是否真的产出过内容（文本/推理/工具调用）；供结束原因映射使用。 */
	get producedOutput() {
		return this.#producedContent;
	}
	/** 交出所有缓冲的 Chat Completions 工具调用（在 finish 之前调用）。 */
	flushOpenAiToolCalls() {
		const chunks = [];
		for (const call of this.#openAiTools) {
			const index = this.#nextIndex;
			this.#nextIndex += 1;
			const id = ToolCallId(call.id === "" ? randomUUID() : call.id);
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
	finish(reason) {
		if (this.#finished) return [];
		this.#finished = true;
		return [
			...this.closeText(),
			...this.closeReasoning(),
			...this.flushOpenAiToolCalls(),
			{
				type: "finish",
				reason
			}
		];
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
	endOfStream(sawContent) {
		if (this.#finished) return [];
		if (!sawContent) throw new LlmError("Open Design API returned an empty response: the stream produced no content and ended without a terminal event", EMPTY_RESPONSE_CODE);
		return this.finish({ kind: "stop" });
	}
};
/** Chat Completions 的一行事件。 */
function openAiChunks(assembler, event) {
	if (event.error !== void 0) throw streamFailure(event.error);
	const chunks = [];
	const choices = event.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		const usage = openAiUsage(event.usage);
		if (usage !== void 0) chunks.push({
			type: "usage",
			usage
		});
		return chunks;
	}
	const choice = isRecord$3(choices[0]) ? choices[0] : {};
	const delta = isRecord$3(choice.delta) ? choice.delta : {};
	const reasoning = stringValue$1(delta.reasoning) ?? stringValue$1(delta.reasoning_content);
	if (reasoning !== void 0) chunks.push(...assembler.reasoningDelta(reasoning));
	const content = stringValue$1(delta.content);
	if (content !== void 0) chunks.push(...assembler.textDelta(content));
	if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
		if (!isRecord$3(raw)) continue;
		const fn = isRecord$3(raw.function) ? raw.function : {};
		const id = stringValue$1(raw.id);
		const name = stringValue$1(fn.name);
		const args = stringValue$1(fn.arguments);
		assembler.addOpenAiToolCall({
			index: numberValue$1(raw.index) ?? 0,
			...id === void 0 ? {} : { id },
			...name === void 0 ? {} : { name },
			...args === void 0 ? {} : { arguments: args }
		});
	}
	if (choice.finish_reason !== void 0 && choice.finish_reason !== null) {
		const usage = openAiUsage(event.usage);
		if (usage !== void 0) chunks.push({
			type: "usage",
			usage
		});
		chunks.push(...assembler.finish(mapFinishReason(stringValue$1(choice.finish_reason), assembler.producedOutput)));
	}
	return chunks;
}
/** 把一行 SSE 文本解析成 chunk（空行、注释、`event:` 行与坏行都跳过）。 */
function decodeLine(assembler, line) {
	const trimmed = line.trim();
	if (trimmed === "" || trimmed.startsWith(":") || trimmed.startsWith("event:")) return [];
	const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
	if (payload === "" || payload === "[DONE]") return [];
	let event;
	try {
		event = JSON.parse(payload);
	} catch {
		return [];
	}
	if (!isRecord$3(event)) return [];
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
async function* decodeStream(body) {
	if (body === null) throw new LlmError("Open Design API returned no response body", "PROVIDER_PROTOCOL_ERROR");
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const assembler = new StreamAssembler();
	let buffer = "";
	let sawContent = false;
	const produced = (chunks) => {
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
		for (const chunk of assembler.endOfStream(sawContent || assembler.hasBufferedToolCall)) yield chunk;
	} finally {
		reader.cancel().catch(() => {});
	}
}
//#endregion
//#region src/vendors/opendesign/adapter.ts
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
/**
* 调用方中止的错误码。宿主 `LlmRuntime` 用同一个字符串判定「这次请求是被取消的」；
* `src/core/transport.ts` 刻意不导出它（它不是内核的公开常量），所以这里直接比字面量。
*/
const ABORTED_CODE = "ABORTED";
/** 目录请求的预算（与另两家的同一档）。 */
const MODELS_TIMEOUT_MS = 1e4;
/**
* 目录读数的缓存时长（毫秒）。
*
* 每次 `resolveModel`（宿主的模型选择器、每个请求的身份解析）都会问一次目录，而目录是**厂商级**
* 资源、按分钟级变化。不缓存等于每个请求多打一次网络（2026-10-18 审计：一次对话里能重复十几次）。
* 60 秒足够让「刚在设置里勾了模型」立刻生效，也足够省掉这些重复请求；失败不缓存。
*/
const CATALOG_TTL_MS = 6e4;
/** 错误正文最多读多少字符（与另两家同一上限）。 */
const ERROR_BODY_LIMIT = 65536;
/** 重试延迟上限（与另两家同一档）。 */
const RETRY_MAX_DELAY_MS = 9e5;
/**
* 路由的重试白名单。`LLM_REQUEST_TIMEOUT` 与 `LLM_STREAM_IDLE_TIMEOUT` **不在**宿主的
* `DEFAULT_RETRYABLE_CODES` 里，必须在此显式列出；保留这两个具体码（不退化成一个 `TIMEOUT`）
* 是为了区分「整请求超时」与「流空闲超时」。
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
	return {
		apiBase: raw.apiBase !== void 0 && raw.apiBase.trim() !== "" ? raw.apiBase : DEFAULT_BASE_URL,
		requestTimeoutMs: positive(raw.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
		streamIdleTimeoutMs: positive(raw.streamIdleTimeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
		defaultMaxTokens: positive(raw.defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS)
	};
}
/** 把系统提示折叠成一段文本（与另两家同一规则）。 */
function systemTextOf(options) {
	const parts = [];
	if (options.system !== void 0 && options.system !== "") parts.push(options.system);
	for (const message of options.messages) {
		if (message.role !== "system") continue;
		const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text !== "") parts.push(text);
	}
	return parts.join("\n\n");
}
/** 一次 usage chunk 计入的 token 总数（缺 `totalTokens` 时按分项相加）。 */
function usageTotal(usage) {
	if (usage.totalTokens !== void 0) return usage.totalTokens;
	return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** 读一份错误正文：最多读 {@link ERROR_BODY_LIMIT}，能解析成 JSON 就解析。 */
async function readErrorBody(response) {
	let text = "";
	try {
		text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
	} catch {
		return;
	}
	if (text.trim() === "") return void 0;
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
function mentionsEffortField(body) {
	const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
	return /reasoning[_\s-]?effort|unsupported[_\s-]?effort|effort[_\s-]?not[_\s-]?supported/i.test(text);
}
/** Open Design 适配器：宿主 `LlmAdapter` 的一个真实子类。 */
var OpenDesignAdapter = class extends LlmAdapter {
	#deps;
	/** 目录缓存：同一基地址 + 同一把密钥在 TTL 内复用；并发的请求共用同一个 promise。 */
	#catalogCache;
	/** 在途的目录请求（并发去重：模型选择器一次能并发问好几条）。 */
	#catalogInFlight;
	/**
	* @param deps - 配置读取、轮换引擎、端口与各 I/O 注入点。
	*/
	constructor(deps) {
		super();
		this.#deps = deps;
	}
	/** @returns 路由的展示元数据（name 用产品名，id 必须是路由 id）。 */
	providerInfo(provider) {
		return {
			id: provider,
			name: "Open Design"
		};
	}
	/**
	* 路由的重试白名单（与另两家同一份）。
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
		}, "llm-opendesign: retryPolicy");
	}
	/**
	* 拉目录 → 应用可见性规则 → 映射为宿主形状（套餐过滤与免费置顶属第 2 期）。
	*/
	async listModels(provider) {
		const raw = this.#deps.config();
		const entries = await this.#catalog(resolveConfig(raw));
		const visible = selectVisible(entries, normalizeVisibility(raw));
		noteCatalogModels(provider, visible.map((entry) => ({
			id: entry.id,
			...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
			...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
		})));
		return visible.map((entry) => ({
			provider,
			id: entry.id,
			name: entry.name,
			inputModalities: entry.inputModalities
		}));
	}
	/**
	* 全部目录条目（**不受** `visibleModels` / `modelVisibility` 过滤），供设置页勾选。
	*
	* 与 `listModels` 的分工：那个回答「宿主的模型选择器该看到什么」，这个回答「厂商现在有哪些
	* 模型」—— 隐藏的模型也要出现在勾选列表里，否则用户没有入口把它重新打开。
	* @returns 目录里的模型 id 与名称。
	*/
	async catalogModels(fresh = false) {
		return (await this.#catalog(resolveConfig(this.#deps.config()), void 0, fresh)).map((entry) => ({
			id: entry.id,
			...entry.name === "" ? {} : { name: entry.name }
		}));
	}
	/**
	* 解析一个模型：目录里有就带上下文、输出上限、推理档位与图片能力；目录不可用或没有该模型时
	* 退化成「只有 id 的目录外模型」，让请求走到 provider 再报错。
	*
	* 档位**只信目录自己声明的**（`./catalog`）：厂商不在别处公布档位，未声明就是不声明（宿主的
	* 档位选择器随之不出现）。
	*/
	async resolveModel(provider, model, signal) {
		const config = resolveConfig(this.#deps.config());
		let entry;
		try {
			entry = (await this.#catalog(config, signal)).find((candidate) => candidate.id === model);
		} catch {
			entry = void 0;
		}
		const efforts = effortsFor(model, entry?.efforts);
		return {
			provider,
			id: model,
			name: entry?.name ?? officialModelName(model),
			inputModalities: entry?.inputModalities ?? ["text"],
			...entry?.contextWindow === void 0 ? {} : { context: { contextWindow: entry.contextWindow } },
			...entry?.maxTokens === void 0 ? {} : { defaultMaxTokens: entry.maxTokens },
			systemPromptUpdate: "in-history",
			toolUpdate: "addition-only",
			...efforts.length === 0 ? {} : { reasoning: { efforts: efforts.map((effort) => ({
				id: ReasoningEffortId(effort),
				name: effort
			})) } }
		};
	}
	/**
	* 流式请求：账号轮换 → 凭据 → 请求 → 时间预算 → 失败分类 → 有条件的账号回退。
	* @param options - 宿主的完整请求；实现必须遵守 `options.signal`。
	* @returns 与线上同序的 chunk 流。
	*/
	async *stream(options) {
		await this.#deps.beforeRequest?.({
			...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },
			...options.purpose === void 0 ? {} : { purpose: options.purpose }
		});
		const config = resolveConfig(this.#deps.config());
		const tried = /* @__PURE__ */ new Set();
		let lastFailure;
		/** 已经换过一次模型了吗（只换一次：替代也限额就停手，不再套娃）。 */
		let swappedOnce = false;
		for (;;) {
			if (options.signal?.aborted === true) throw this.#abortError(options.signal);
			const ref = this.#deps.rotation.pick({
				model: options.model,
				tried
			});
			if (ref === void 0) {
				if (!swappedOnce && lastFailure !== void 0 && lastFailure.rejection.kind !== "invalid-credential") {
					const swapped = await this.#fallbackModel(options, lastFailure.rejection.kind);
					if (swapped !== void 0 && swapped.model !== options.model) {
						swappedOnce = true;
						if (swapped.provider !== options.provider) {
							const delegated = delegateStream(swapped, options);
							if (delegated !== void 0) {
								yield* delegated;
								return;
							}
						} else {
							options = {
								...options,
								model: swapped.model
							};
							tried.clear();
							continue;
						}
					}
				}
				if (lastFailure !== void 0) throw lastFailure.thrown;
				throw new LlmError(`llm-opendesign: 没有可用于模型 "${options.model}" 的 Open Design 账号；请先在账号页添加账号，或把密钥写入凭据库`, "MISSING_CREDENTIAL");
			}
			tried.add(ref);
			const key = await this.#resolveKey(ref);
			if (key === void 0) {
				const rejection = {
					kind: "invalid-credential",
					message: `Open Design 账号 "${ref}" 没有可用的推理密钥`
				};
				this.#deps.rotation.markRejected(ref, rejection);
				lastFailure = {
					rejection,
					thrown: new LlmError(`llm-opendesign: Open Design 账号 "${ref}" 没有可用的推理密钥；请在账号页重新登录，或把密钥写入凭据库、在启动环境里导出它`, "MISSING_CREDENTIAL")
				};
				if (tried.size >= 16) throw lastFailure.thrown;
				continue;
			}
			let emitted = false;
			let totalTokens = 0;
			/** 用量采集：把本次尝试的 usage 逐块累加（厂商可能发多次）。 */
			const counts = {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			};
			const iterator = this.#attempt(config, options, key)[Symbol.asyncIterator]();
			let failure;
			let exhausted = false;
			try {
				for (;;) {
					let step;
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
					const closing = iterator.return?.(void 0);
					if (closing !== void 0) closing.catch(() => {});
				}
			}
			if (exhausted) {
				this.#deps.rotation.noteSettled(ref);
				this.#recordUsage(ref, options.model, "success", counts);
				return;
			}
			if (options.signal?.aborted === true || this.#isAbort(failure)) {
				this.#recordUsage(ref, options.model, "failure", counts, "aborted");
				throw failure;
			}
			const classified = this.#classify(failure);
			if (classified === void 0) {
				this.#recordUsage(ref, options.model, "failure", counts, "request");
				throw failure;
			}
			this.#deps.rotation.markRejected(ref, classified.rejection);
			lastFailure = classified;
			this.#recordUsage(ref, options.model, "failure", counts, classified.rejection.kind);
			if (!this.#deps.rotation.fallbackAllowed({
				emitted,
				totalTokens,
				aborted: false
			})) throw classified.thrown;
			if (tried.size >= 16) throw classified.thrown;
		}
	}
	/** 一次尝试：核对档位 → 构造请求体 → 发出 → 解码并套上时间预算。 */
	async *#attempt(config, options, key) {
		const effort = await this.#declaredEffort(config, options);
		const response = await this.#post(config, options, key, effort);
		if (!response.ok) {
			const body = await readErrorBody(response);
			if (response.status === 400 && effort !== void 0 && mentionsEffortField(body)) {
				const fallback = nearestAllowedEffort(effort, allowedEffortsIn(body));
				const retry = await this.#post(config, options, key, fallback === effort ? void 0 : fallback);
				if (!retry.ok) throw new OpenDesignStreamFailure(retry.status, await readErrorBody(retry));
				yield* runStream(decodeStream(retry.body), {
					requestTimeoutMs: config.requestTimeoutMs,
					streamIdleTimeoutMs: config.streamIdleTimeoutMs
				}, { signal: options.signal });
				return;
			}
			throw new OpenDesignStreamFailure(response.status, body);
		}
		yield* runStream(decodeStream(response.body), {
			requestTimeoutMs: config.requestTimeoutMs,
			streamIdleTimeoutMs: config.streamIdleTimeoutMs
		}, { signal: options.signal });
	}
	/**
	* 发一次生成请求。
	* @param config - 已填默认值的配置。
	* @param options - 宿主的完整请求。
	* @param key - 本次尝试的推理密钥。
	* @param effort - 要带的档位；`undefined` 表示不带这个字段。
	* @returns 原始响应（调用方判状态、读正文）。
	*/
	async #post(config, options, key, effort) {
		const cap = config.defaultMaxTokens;
		const facts = {
			maxTokens: options.maxTokens === void 0 ? cap : Math.min(options.maxTokens, cap),
			systemText: systemTextOf(options),
			...effort === void 0 ? {} : { reasoningEffort: effort }
		};
		const wire = generateRequest({
			base: config.apiBase,
			key,
			body: JSON.stringify(buildRequestBody(options, facts, await this.#imagesOf(options)))
		});
		const init = {
			method: "POST",
			headers: wire.headers,
			body: wire.body
		};
		if (options.signal !== void 0) init.signal = options.signal;
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
	async #imagesOf(options) {
		const resolve = this.#deps.resolveImage;
		const images = /* @__PURE__ */ new Map();
		if (resolve === void 0) return images;
		const wanted = /* @__PURE__ */ new Map();
		for (const message of options.messages) for (const block of message.content) {
			if (block.type !== "image") continue;
			const ref = block.attachment;
			const id = ref?.attachmentId;
			if (typeof id === "string" && id !== "") wanted.set(id, ref);
		}
		for (const [id, ref] of wanted) try {
			const resolved = await resolve(ref, options.signal);
			if (resolved !== void 0) images.set(id, resolved);
		} catch {}
		return images;
	}
	/**
	* 核对宿主给的推理档位：**声明过的（目录或模型族）**才原样返回，否则 `undefined`
	* （不发这个字段）。没有档位需求时不请求目录；目录拉不到时仍按模型族判定。
	* @param config - 已填默认值的配置。
	* @param options - 宿主的完整请求。
	* @returns 可以发出去的档位，或 `undefined`。
	*/
	async #declaredEffort(config, options) {
		const effort = options.reasoningEffort;
		if (effort === void 0) return void 0;
		try {
			const entry = (await this.#catalog(config, options.signal)).find((candidate) => candidate.id === options.model);
			return effortsFor(options.model, entry?.efforts).includes(effort) ? effort : void 0;
		} catch {
			return;
		}
	}
	/** 收集两个凭据来源并按优先级挑选（`stored → environment`；没有字面量与 auth.json 兜底）。 */
	async #resolveKey(ref) {
		const stored = await this.#deps.resolveStored?.(ref);
		const environment = this.#deps.resolveEnvironment?.(ref);
		return pickApiKey({
			...stored === void 0 ? {} : { stored },
			...environment === void 0 ? {} : { environment }
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
	#recordUsage(account, model, outcome, counts, failureKind) {
		const port = this.#deps.usage ?? NOOP_USAGE_PORT;
		try {
			port.record({
				vendor: "opendesign",
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
	/**
	* 拉目录并解析（TTL 缓存 + 并发去重）。
	*
	* 缓存键是「基地址 + 密钥」：换账号/换基地址立即失效；`now` 走真实时钟（60 秒的量级，
	* 不需要注入）。
	* @param config - 已填默认值的配置。
	* @param signal - 宿主的取消信号（有缓存时不发请求，信号自然用不上）。
	* @returns 目录条目。
	*/
	async #catalog(config, signal, fresh = false) {
		const key = await this.#catalogKey();
		const cached = this.#catalogCache;
		if (!fresh && cached !== void 0 && cached.base === config.apiBase && cached.key === key && Date.now() - cached.at <= CATALOG_TTL_MS) return cached.entries;
		if (this.#catalogInFlight !== void 0) return this.#catalogInFlight;
		const pending = this.#fetchCatalog(config, key, signal);
		this.#catalogInFlight = pending;
		try {
			const entries = await pending;
			this.#catalogCache = {
				base: config.apiBase,
				key,
				at: Date.now(),
				entries
			};
			return entries;
		} finally {
			this.#catalogInFlight = void 0;
		}
	}
	/**
	* 真正打一次目录端点。
	* @param config - 已填默认值的配置。
	* @param key - 目录请求用的推理密钥。
	* @param signal - 宿主的取消信号。
	* @returns 目录条目。
	*/
	async #fetchCatalog(config, key, signal) {
		const { url, headers } = catalogRequest(config.apiBase, key);
		const response = await this.#deps.fetchImpl(url, {
			headers,
			signal: signal ?? AbortSignal.timeout(MODELS_TIMEOUT_MS)
		});
		if (!response.ok) throw new LlmError(`Open Design models endpoint returned ${response.status}`, "PROVIDER_HTTP_ERROR", { status: response.status });
		return parseCatalog(await response.json()).entries;
	}
	/**
	* 目录请求用的推理密钥：优先当前生效账号，其次第一个已配置账号。
	*
	* 目录是**厂商级**资源，但网关要鉴权 —— 任意一个可用账号的密钥都能读到同一份目录。
	* 一个账号都没有时返回 `undefined`，请求照旧发出（端点会回 401，界面显示「目录读取失败」
	* 而不是假装「这个厂商没有模型」）。
	* @returns 可用的推理密钥，或 `undefined`。
	*/
	async #catalogKey() {
		let views;
		try {
			views = await this.#deps.accounts.list();
		} catch {
			return;
		}
		if (!Array.isArray(views) || views.length === 0) return void 0;
		const ref = (views.find((view) => view.active === true) ?? views.find((view) => view.configured === true) ?? views[0])?.ref;
		if (typeof ref !== "string" || ref === "") return void 0;
		return this.#resolveKey(ref);
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
			const entry = (await this.#catalog(resolveConfig(this.#deps.config()))).find((item) => item.id === options.model);
			if (entry !== void 0) currentMeta = {
				...entry.contextWindow === void 0 ? {} : { contextWindow: entry.contextWindow },
				...entry.efforts === void 0 ? {} : { effortCount: entry.efforts.length }
			};
		} catch {}
		const picked = pickFallbackModel({
			provider: options.provider,
			model: options.model,
			...currentMeta
		}, candidates.map((item) => ({
			provider: item.provider,
			model: item.model,
			...item.contextWindow === void 0 ? {} : { contextWindow: item.contextWindow },
			...item.effortCount === void 0 ? {} : { effortCount: item.effortCount }
		})), { sameGatewayOnly: failureKind === "network" });
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
	*/
	#classify(error) {
		if (error instanceof OpenDesignStreamFailure) {
			const rejection = classifyOpenDesignFailure(error.status, error.body);
			if (rejection === void 0) return void 0;
			return {
				rejection,
				thrown: openDesignLlmError(rejection, error.status, error)
			};
		}
		if (error instanceof LlmError) {
			if (error.code === ABORTED_CODE) return void 0;
			if (error.code === "LLM_REQUEST_TIMEOUT" || error.code === "LLM_STREAM_IDLE_TIMEOUT") {
				const rejection = classifyOpenDesignFailure(0, { message: error.message });
				if (rejection === void 0) return void 0;
				return {
					rejection,
					thrown: error
				};
			}
			return;
		}
		const rejection = classifyOpenDesignFailure(0, { message: error instanceof Error ? error.message : String(error) });
		if (rejection === void 0) return void 0;
		return {
			rejection,
			thrown: openDesignLlmError(rejection, void 0, error)
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
* 造一个 Open Design 适配器实例（注册到宿主路由由入口完成）。
* @param deps - 配置读取、轮换引擎、端口与 I/O 注入点。
* @returns 宿主 `LlmAdapter` 子类实例。
*/
function createOpenDesignAdapter(deps) {
	return new OpenDesignAdapter(deps);
}
//#endregion
//#region src/vendors/opendesign/accounts.ts
/**
* Open Design 账号端口：真源在设置文档（命名空间 `llm-opendesign`），每个操作
* **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；Review Focus 5）。
*
* 形状以 `opencode/accounts.ts` 为模板（计划 §2.4），按 Open Design 的账号事实扩展：
* - 设置命名空间 `llm-opendesign`（计划 §1）；
* - 账号条目 `{ id, name, apiKeyEnv, controlKeyEnv?, workspaceId? }`：`apiKeyEnv` 是**推理**
*   密钥的槽（runtime key），`controlKeyEnv` 是**控制面**密钥的槽（额度/账单接口用），
*   `workspaceId` 是这台机器上该账号的工作区（vela 周期额度查询用）；
* - 顶层 `apiKeyEnv` 是**当前账号**（`select` 写它、`move` 把队首写回它），缺省
*   {@link OPENDESIGN_DEFAULT_REF}；
* - 账号身份一律是**凭据引用名 ref**（`accountRef("opendesign", label)` 的产物或存量文档里
*   用户手写的引用名），存在条目的 `apiKeyEnv` 字段里。`name` 只用于展示，改名**绝不**重新
*   推导 ref（Task 4 复核护栏）。
*
* **两个凭据槽**：一个账号最多占两个凭据槽（推理 + 控制面）。控制面槽的解析顺序是
* 「条目里合法的 `controlKeyEnv`」→「由 ref 派生的 `_CONTROL` 槽」（{@link opendesignControlRef}）；
* 默认槽（`apiKeyEnv` 恰好是 {@link OPENDESIGN_DEFAULT_REF} 的那一个）的派生控制槽是
* {@link OPENDESIGN_DEFAULT_CONTROL_REF}（计划 §1）。`remove` 把**两个**槽都记进
* `credentialCleanupRefs` —— 只记一个会让控制面密钥在账号删除后永远留在凭据库里。
*
* **写回纪律**：改条目时按字段覆盖（改 `name`、保留其它字段），改数组时只摘除目标条目，
* 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
* 引用名，`key` / `controlKey` 一律走凭据服务。
*
* **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
* 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops。
*
* **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`）；
* `controlKeyEnv` / `workspaceId` 不进意图 —— 意图携带的字段是**身份与去向**，这两个字段
* 每轮从最新文档重算即可（它们由本次调用决定，不依赖旧文档），而 `AccountIntentKind` 是封闭
* 联合，新增字段类型不属于本任务范围。提交还会按最新文档再判一次身份（ref 已在账号表里就
* 不再追加条目、不再写凭据槽）。所有不改状态就可能失败的校验（标签、密钥、账号数上限、没有
* 空闲 ref）都跑在 `append` 之前。
*
* 本任务**不**做：模型可见性（在适配器侧）、套餐过滤、按模型绑定的额外规则。
* @module dsh-llm-account/src/vendors/opendesign/accounts
*/
/** 设置命名空间（计划 §1，全局约束，不得更改）。 */
const OPENDESIGN_SETTINGS_NS = "llm-opendesign";
/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR = "opendesign";
/** 顶层默认账号的推理凭据引用名（计划 §1）。 */
const OPENDESIGN_DEFAULT_REF = "OPENDESIGN_API_KEY";
/** 顶层默认账号的控制面凭据引用名（计划 §1）。 */
const OPENDESIGN_DEFAULT_CONTROL_REF = "OPENDESIGN_CONTROL_KEY";
/** 账号条目的凭据引用字段（推理密钥槽）。 */
const REF_FIELD = "apiKeyEnv";
/** 账号条目的控制面凭据引用字段（额度/账单密钥槽）。 */
const CONTROL_FIELD = "controlKeyEnv";
/** 账号条目的工作区字段（vela 周期额度查询用）。 */
const WORKSPACE_FIELD = "workspaceId";
/** 账号条目的展示名称字段。 */
const LABEL_FIELD = "name";
/**
* 账号条目的**默认名称**（登录时拿到的邮箱，2026-10-22 需求）。
*
* 为什么需要单独存：用户改名会覆盖 `name`，而原始邮箱就此丢失 ——
* 「不想用自定义名了就恢复默认」这件事就做不到了。
*
* **兼容性**：老账号没有这个字段。读取方要能降级：
* - 有它 → 「恢复默认名称」可用；
* - 没有它 → 该菜单项不可用（不猜、不编一个名称出来）。
*
* 它只在登录落库时写一次，`rename` **永不改它** —— 默认值不该被用户的改名影响。
*/
const DEFAULT_LABEL_FIELD = "defaultName";
/** 账号条目的标识字段。 */
const ID_FIELD = "id";
/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";
/** 当前固定账号字段（顶层 `apiKeyEnv`）。 */
const ACTIVE_FIELD = "apiKeyEnv";
/** 全局顺序字段（`vendor:ref` 键；三家文档保存同一份）。 */
const ORDER_FIELD = "accountOrder";
/** 自动切换开关字段（`autoSwitch` 落库是三家共用的可靠性机制）。 */
const AUTO_SWITCH_FIELD = "autoSwitch";
/**
* 待清理凭据引用数组字段。删除账号只**记录**待清理的 ref（推理槽 + 控制面槽），真正
* `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
*/
const CLEANUP_FIELD = "credentialCleanupRefs";
/** ref 撞名时的后缀尝试上限（与另两家的同一上限）。 */
const MAX_REF_ATTEMPTS = 128;
/**
* 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
* 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
*/
const MAX_CONFLICT_RETRIES = 8;
/** 派生的控制面槽后缀（`<ref>_CONTROL`）。 */
const CONTROL_SUFFIX = "_CONTROL";
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$2(value) {
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
/** 读一个合法凭据引用名（不合法的值一律当缺失）。 */
function refValue(value) {
	const ref = normalizeKey(value);
	return ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref) ? ref : void 0;
}
/** 读一个账号条目的 ref（推理槽），读不到时为 `undefined`。 */
function refOf(item) {
	if (!isRecord$2(item)) return void 0;
	return refValue(item[REF_FIELD]);
}
/** 读一个账号条目的展示名称。 */
function labelOf(item) {
	if (!isRecord$2(item)) return void 0;
	return normalizeKey(item[LABEL_FIELD]);
}
/**
* 读一个账号条目的**默认名称**（登录时的邮箱）。
*
* `undefined` 有两种情况，对「恢复默认名称」而言是同一件事（都不可用）：
* - 老账号没有这个字段（2026-10-22 之前建的）；
* - 字段存在但是空白。
*
* 不降级成「ref 里那段转义文本」—— 那是凭据槽名，不是用户能认的邮箱。
* @param item - 账号条目（任意形状）。
* @returns 默认名称，或 `undefined`。
*/
function defaultLabelOf(item) {
	if (!isRecord$2(item)) return void 0;
	return normalizeKey(item[DEFAULT_LABEL_FIELD]);
}
/** 文档里是否已有这个账号条目。 */
function hasAccount(value, ref) {
	return rawAccounts(value).some((item) => refOf(item) === ref);
}
/**
* 由账号 ref 派生控制面凭据槽。
*
* 默认槽（{@link OPENDESIGN_DEFAULT_REF}）派生到 {@link OPENDESIGN_DEFAULT_CONTROL_REF}
* （计划 §1 的两个默认引用名）；其余账号派生到 `<ref>_CONTROL`。派生的槽名必满足凭据引用名
* 的合法字符集（ref 本身合法，后缀只有字母与下划线）。
* @param ref - 账号的推理凭据引用名。
* @returns 控制面凭据引用名。
*/
function derivedControlRef(ref) {
	return ref === "OPENDESIGN_API_KEY" ? OPENDESIGN_DEFAULT_CONTROL_REF : `${ref}${CONTROL_SUFFIX}`;
}
/** 文档里承载某个账号的条目（形状不可信；找不到时为 `undefined`）。 */
function itemOf(value, ref) {
	return rawAccounts(value).find((item) => refOf(item) === ref);
}
/**
* 解析一个账号 **当前生效**的控制面凭据槽：条目里合法的 `controlKeyEnv` 优先（用户手写的
* 或历史文档里的槽名），没有时回落到派生槽（{@link derivedControlRef}）。
* @param value - 现读的设置文档。
* @param ref - 目标账号的推理凭据引用名。
* @returns 该账号的控制面凭据引用名。
*/
function opendesignControlRef(value, ref) {
	const entry = itemOf(value, ref);
	return (isRecord$2(entry) ? refValue(entry[CONTROL_FIELD]) : void 0) ?? derivedControlRef(ref);
}
/**
* 解析一个账号的工作区 id：条目 `workspaceId` 优先，其次顶层 `workspaceId`（计划 §2.5：
* 「只在该账号配置了 workspaceId 且本机能解析到 vela 时查询」）。
* @param value - 现读的设置文档。
* @param ref - 目标账号的推理凭据引用名。
* @returns 工作区 id，或 `undefined`。
*/
function opendesignWorkspaceId(value, ref) {
	const entry = itemOf(value, ref);
	return (isRecord$2(entry) ? normalizeKey(entry[WORKSPACE_FIELD]) : void 0) ?? normalizeKey(value[WORKSPACE_FIELD]);
}
/**
* 固定账号槽：**哨兵词汇只在这一个函数里决定**（缺失、空串与非法值都读作自动轮换）。
*
* `fallback` 是默认引用名 {@link OPENDESIGN_DEFAULT_REF}：顶层 `apiKeyEnv` 就叫这个名字时，
* `slot.ref` 恰好是「默认槽的 ref」。入口的 `pinnedRefOf`/`defaultRefOf` 与端口的
* `activeRefOf`（`list()` 的 active、`remove()` 的回落、`add()` 的返回）都读它。
* @param value - 现读的设置文档。
* @returns 归一化后的槽判定。
*/
function opendesignAccountSlot(value) {
	return readAccountSlot(value[ACTIVE_FIELD], { fallback: OPENDESIGN_DEFAULT_REF });
}
/**
* 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串与非法引用名都算自动）。
* @param value - 现读的设置文档。
* @returns 固定账号的 ref，或 `undefined`（自动轮换）。
*/
function activeRefOf(value) {
	return opendesignAccountSlot(value).pinned ?? void 0;
}
/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label) {
	const next = normalizeKey(label);
	if (next === void 0) throw new Error("llm-opendesign: account name must not be blank");
	return next;
}
/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key, field) {
	const next = normalizeKey(key);
	if (next === void 0) throw new Error(`llm-opendesign: ${field} must not be blank`);
	return next;
}
/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error) {
	return isRecord$2(error) && error.code === "SETTINGS_CONFLICT";
}
/** 未知账号 ref（改名/换 key/固定/排序时用）。 */
function unknownRef(ref) {
	return /* @__PURE__ */ new Error(`llm-opendesign: unknown account ref "${ref}"`);
}
/** 账号数超限（与另两家同一上限与同一拒绝姿态）。 */
function tooManyAccounts() {
	return /* @__PURE__ */ new Error(`llm-opendesign: Open Design supports at most 20 accounts`);
}
/**
* 给新账号挑一个未被占用的 ref：先是 {@link opendesignAccountRef} 的产物，撞名时加数字后缀
* （`_2`、`_3`…）。
*
* 占用集合 = 现有账号条目的 ref ∪ 它们的控制面槽 ∪ 待清理的 ref ∪ 顶层当前账号引用。
* 这条护栏是 Review Focus 1 的机器化保证：两个账号永远不会共用同一个凭据槽，否则它们会
* 互相污染失效标记与额度。
* @param value - 当前设置文档。
* @param label - 新账号的展示名称。
* @returns 未被占用的 ref。
*/
function freeRef(value, label) {
	const occupied = /* @__PURE__ */ new Set();
	for (const item of rawAccounts(value)) {
		const ref = refOf(item);
		if (ref === void 0) continue;
		occupied.add(ref);
		occupied.add(opendesignControlRef(value, ref));
	}
	for (const item of rawCleanupRefs(value)) {
		const ref = normalizeKey(item);
		if (ref !== void 0) occupied.add(ref);
	}
	const fallback = normalizeKey(value[REF_FIELD]);
	if (fallback !== void 0) occupied.add(fallback);
	const first = opendesignAccountRef(label);
	if (!occupied.has(first)) return first;
	for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
		const candidate = `${first}_${suffix}`;
		if (!occupied.has(candidate)) return candidate;
	}
	throw new Error(`llm-opendesign: no free credential reference for name "${label}"`);
}
/**
* 由账号标签推导 Open Design 的账号 ref（同时用作推理凭据槽名）。
*
* 形状为 `DSH_LLM_ACCOUNT_OPENDESIGN_<LABEL>_<HASH>`（`core/accounts.ts` 的 `accountRef`，
* 验收 §7.3 要求凭据写入这套槽位）。标签先转大写并把非 `[A-Za-z0-9_]` 的字符替换成 `_`，
* 后缀是原始标签的短哈希 —— 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足
* 凭据引用名的合法字符集 `^[A-Za-z_][A-Za-z0-9_]*$`。
* @param label - 用户可见名称。
* @returns 该账号的 ref，可安全用作凭据槽名。
*/
function opendesignAccountRef(label) {
	return accountRef(VENDOR, label);
}
/** Open Design 的账号端口（设置变更实现）。 */
var OpenDesignAccountsImpl = class {
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
	* **只列文档里的真账号条目**（与另两家同一姿态：不再合成默认槽行）：顶层 `apiKeyEnv` 那个
	* 引用名只表示「当前账号是谁」，它的行在账号条目里（`open-design login` 与「添加账户」都
	* 会写条目）。当前账号显示在第一行（`moveFirst`，读时提位，不写设置）：`select` 写顶层
	* `apiKeyEnv`、`move` 把队首写回它，所以列表顺序必须让用户一眼看出谁在服务。
	*/
	async list() {
		const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
		const slot = opendesignAccountSlot(snapshot.value);
		const views = rawAccounts(snapshot.value).map((item) => ({
			ref: refOf(item),
			label: labelOf(item),
			defaultLabel: defaultLabelOf(item)
		})).filter((item) => item.ref !== void 0).map((item) => ({
			ref: item.ref,
			label: item.label ?? item.ref,
			...item.defaultLabel === void 0 ? {} : { defaultLabel: item.defaultLabel },
			configured: false,
			active: item.ref === slot.pinned
		}));
		const unique = dedupeByRef(moveFirst(views, slot.ref));
		const order = globalOrderOfVendor(unique.map((view) => view.ref), snapshot.value[ORDER_FIELD], VENDOR);
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
	* **ref 在写意图之前解析**：它先进意图（`{ kind: "add", ref, label }`）、再进提交，提交用的
	* 就是这一个 ref。于是崩溃重放**按 ref 对齐**就够了 —— 同名标签合法（`_2` 后缀），按 label
	* 重新推导分不清「已提交但凭据没写成」「根本没提交」与「同名的存量账号」，会造出重复账号
	* 或把密钥写到错的账号上。
	*
	* **两个凭据槽都在提交之后写**：先落条目、再 `credentials.set(ref, key)`、
	* `credentials.set(controlRef, controlKey)`（与另两家「先条目后凭据」的次序一致）。任一步写
	* 失败都留下未决意图：重放能确认条目已经落地，但**补不回密钥** —— 那条账号会保持
	* `configured: false`，直到用户重新提供密钥。
	*
	* **提交是幂等的**：每一轮（含冲突重试）都拿**刚读到的**文档再判一次身份 —— 冻结的 ref
	* 已经在账号表里就不再追加第二个条目，也不再写凭据槽。
	*
	* 所有**不改状态就可能失败**的校验（标签、两把密钥、账号数上限、没有空闲 ref）都跑在
	* `append` 之前，因此日志里不会留下一条永远应用不了的意图。唯一一条「`append` 之后才可能
	* 失败」的校验是并发填满账号表：那次拒绝**必须先把意图收尾**（见 `#settleQuietly`），否则
	* 日志里会留下一条每次重放都抛错的 `add`，而 `IntentLog.replay` 不吞 `apply` 的错误。
	* @param input - 展示名称、可选的两把密钥与工作区。
	* @returns 新账号的视图。
	*/
	async add(input) {
		const label = requireLabel(input.label);
		const key = input.key === void 0 ? void 0 : requireKey(input.key, "API key");
		const controlKey = input.controlKey === void 0 ? void 0 : requireKey(input.controlKey, "control key");
		const workspaceId = normalizeKey(input.workspaceId);
		const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
		if (rawAccounts(snapshot.value).length >= 20) throw tooManyAccounts();
		const ref = freeRef(snapshot.value, label);
		const controlRef = derivedControlRef(ref);
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
				const entry = {
					[ID_FIELD]: ref,
					[LABEL_FIELD]: label,
					[DEFAULT_LABEL_FIELD]: label,
					[REF_FIELD]: ref,
					[CONTROL_FIELD]: controlRef
				};
				if (workspaceId !== void 0) entry[WORKSPACE_FIELD] = workspaceId;
				const ops = [{
					op: "set",
					path: [ACCOUNTS_FIELD],
					value: [...accounts, entry]
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
			if (applied) {
				if (key !== void 0) await this.#deps.credentials.set(ref, key);
				if (controlKey !== void 0) await this.#deps.credentials.set(controlRef, controlKey);
			}
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
	* 只改展示名称。**绝不**重新推导 ref：ref 是账号的身份键（也是两个凭据槽的名字来源），
	* 重推会让顺序、当前账号标记与凭据全部脱钩。
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
				value: rawAccounts(value).map((item) => {
					if (refOf(item) !== ref || !isRecord$2(item)) return item;
					/**
					* **改名时若还没有默认名，先把当前名存进去**（2026-10-22 补）。
					*
					* 为什么：`defaultName` 是 v0.9.0 才加的字段，之前建的账号都没有它。
					* 那些账号一旦改名，原始名称就**永久丢失** —— 实际情况「改名后还原默认
					* 名称也没有」，正是这个原因（菜单项因为 `defaultLabel === undefined`
					* 而不显示）。
					*
					* 在这里补写是唯一可靠的时机：此刻 `item[LABEL_FIELD]` 还是**改名前的值**，
					* 而它几乎必然就是登录时那个名字（用户第一次改名时，当前名 = 默认名）。
					*
					* 对「已经改过名但没有 defaultName」的账号（历史数据），这里存下的是
					* 上一次的名字而不是最初的 —— 无法更准，但至少让「恢复」从此可用，
					* 且不会编造一个假名字。
					*/
					const preserved = defaultLabelOf(item) === void 0 && normalizeKey(item[LABEL_FIELD]) !== void 0 ? { [DEFAULT_LABEL_FIELD]: item[LABEL_FIELD] } : {};
					return {
						...item,
						...preserved,
						[LABEL_FIELD]: next
					};
				})
			}],
			result: void 0
		})));
	}
	/**
	* 把展示名称**恢复成登录时的默认名称**。
	*
	* 语义：等价于 `rename(ref, defaultLabel)`，但**必须由账号自己记录的默认名驱动**，
	* 不能由调用方传一个「它以为的默认名」进来 —— 那会把「默认值」变成另一个可被改写的字段。
	*
	* 老账号没有 `defaultName` 时抛错（而不是静默无操作）：界面上那个菜单项本来就会
	* 因为 `view.defaultLabel === undefined` 而不显示，能走到这里说明有人直接调了远程方法，
	* 静默失败会让它以为成功了。
	* @param ref - 目标账号的 ref。
	*/
	async restoreDefaultLabel(ref) {
		await this.#require(ref);
		const fallback = defaultLabelOf(rawAccounts((await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS)).value).find((item) => refOf(item) === ref));
		if (fallback === void 0) throw new Error(`llm-opendesign: account "${ref}" has no recorded default name`);
		await this.rename(ref, fallback);
	}
	/**
	* 把工作区写进**这个账号自己的条目**（多账号兼容的关键，2026-10-20）。
	*
	* 为什么必须逐账号：周期额度只来自 `vela billing preflight`，它按 `workspaceId` 查。
	* 旧实现在「同账号重新登录」时把发现到的工作区写进**顶层**字段（`fillTopLevelWorkspace`），
	* 而顶层是所有账号共用的回退 —— 第二个账号登录后会把顶层改成它自己的工作区，于是第一个
	* 账号（自己没配）回退到顶层，拿到的是**第二个账号的工作区**，额度就显示错了人。
	*
	* 空值不写：`undefined` / 空串表示「这次没发现到」，不该把已有值擦掉。
	* @param ref - 目标账号的 ref。
	* @param workspaceId - 工作区 id。
	*/
	async setWorkspace(ref, workspaceId) {
		const next = normalizeKey(workspaceId);
		if (next === void 0) return;
		await this.#require(ref);
		await this.#transaction("set-workspace", {
			ref,
			workspaceId: next
		}, () => this.#mutate((value) => ({
			ops: [{
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: rawAccounts(value).map((item) => refOf(item) === ref && isRecord$2(item) ? {
					...item,
					[WORKSPACE_FIELD]: next
				} : item)
			}],
			result: void 0
		})));
	}
	/**
	* 换推理密钥：只写凭据服务，设置文档一个字都不动（Global Constraints：文档里只允许出现
	* 凭据引用名）。与其它操作一样先写意图，凭据写入成功后才收尾。
	* @param ref - 目标账号的 ref。
	* @param key - 新密钥（空值/纯空白直接拒绝）。
	*/
	async replaceKey(ref, key) {
		const next = requireKey(key, "API key");
		await this.#require(ref);
		await this.#transaction("replace-key", { ref }, async () => {
			await this.#deps.credentials.set(ref, next);
		});
	}
	/**
	* 移除账号：条目、必要时当前账号标记，并把**两个**凭据引用（推理槽 + 控制面槽）记进
	* `credentialCleanupRefs`。**真正删凭据不在本操作内**：只记录，等清理动作确认该 ref 不再
	* 被引用后再 `credentials.unset`。
	*
	* 当前账号的回落顺序：摘掉条目后，若当前账号就是被删的那个，回落到**剩余列表的第一个**；
	* 删空了才回到默认引用名 {@link OPENDESIGN_DEFAULT_REF}。
	*
	* 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
	* @param ref - 目标账号的 ref。
	*/
	async remove(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-opendesign")).value, ref)) return;
		await this.#transaction("remove", { ref }, () => this.#mutate((value) => {
			const accounts = rawAccounts(value).filter((item) => refOf(item) !== ref);
			const controlRef = opendesignControlRef(value, ref);
			const ops = [{
				op: "set",
				path: [ACCOUNTS_FIELD],
				value: accounts
			}, {
				op: "set",
				path: [CLEANUP_FIELD],
				value: [
					...rawCleanupRefs(value).filter((item) => item !== ref && item !== controlRef),
					ref,
					controlRef
				]
			}];
			if (activeRefOf(value) === ref) {
				const next = accounts.map((item) => refOf(item)).find((candidate) => candidate !== void 0);
				ops.push({
					op: "set",
					path: [ACTIVE_FIELD],
					value: next ?? "OPENDESIGN_API_KEY"
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
	* 可选的目标是账号条目自己的 ref；顶层 `apiKeyEnv` 当前是个合法引用名时，也允许固定到它
	* （`list()` 里当前账号被提到第一行，页面拿这一行的 ref 回来固定时必须成立）。
	* 写回的就是这个 ref 本身（`apiKeyEnv` 就是当前账号，没有槽 id 空间）。
	* @param ref - 目标账号的 ref；`null` 表示自动轮换（写回默认引用名）。
	*/
	async select(ref) {
		if (ref !== null) {
			const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
			if (!hasAccount(snapshot.value, ref) && ref !== opendesignAccountSlot(snapshot.value).ref) throw unknownRef(ref);
		}
		await this.#transaction("select", ref === null ? {} : { ref }, () => this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [ACTIVE_FIELD],
				value: ref ?? "OPENDESIGN_API_KEY"
			}],
			result: void 0
		})));
	}
	/**
	* 调整账号顺序。Open Design 的能力清单里 `reorder` 为真，所以本适配器**实现**它：用
	* `core/accounts` 的 `reorder` 算出新顺序，落到 `accounts` 数组。
	*
	* 同时把顶层 `apiKeyEnv` 指向移动后的队首（与 opencode 同一后果）：「列表首项 = 当前账号」
	* 是不变量，避免排序后当前账号与列表首项不一致。
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
	* 写全局顺序（`vendor:ref`；三家文档保存同一份）。
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
	* 写自动切换开关（`autoSwitch` 落库是三家共用的可靠性机制）。
	* @param value - 开关值。
	*/
	async setAutoSwitch(value) {
		await this.#transaction("auto-switch", { value }, () => this.#mutate(() => ({
			ops: [{
				op: "set",
				path: [AUTO_SWITCH_FIELD],
				value
			}],
			result: void 0
		})));
	}
	/**
	* 一次完整事务：先 `append` 意图，再交给 `submit`，全部成功后才 `settle`。顺序不能颠倒：
	* 崩溃时留下的未决意图正是重放的依据。
	* @param kind - 意图类型。
	* @param fields - 意图携带的 ref/label/toIndex/value。
	* @param submit - 真正的提交动作；收到这条意图，便于在「已经 append、才发现不该提交」的
	*   路径上先把它收尾再抛（见 `#settleQuietly`）。
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
	* 把一条**已经 append 但决定不提交**的意图收尾掉（用途只有 `add` 的并发上限复核，见
	* `opencode/accounts.ts` 的同名方法说明）。收尾本身写失败不抛出：那条意图会留在日志里
	* （与「凭据写失败」同一类未决状态），但调用方拿到的仍是这次拒绝的真实原因（满表）。
	* @param intent - 已 append 的意图。
	*/
	async #settleQuietly(intent) {
		try {
			await this.#deps.intents.settle(intent.id);
		} catch {}
	}
	/**
	* 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新文档
	* 重算 ops 后再提交。冲突时**不**覆盖对方的写入。
	*
	* `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add` 发现
	* 冻结的 ref 已经存在、`move` 发现位置没变都是这种情况）：直接返回，**不落盘**。这样
	* 「幂等的提交」不必伪造一次空写，也不会白白推进修订号去作废别人的写入。
	*
	* `build` 允许是 async 的：`add` 的并发上限复核要在「已经读到满表」时先 `settle` 掉那条
	* 意图再抛（见 `#settleQuietly`）。`build` 抛出的错误原样冒泡，且**不计**冲突重试。
	* @param build - 由最新文档算出 ops 与调用方要的结果。
	* @returns 调用方的结果与提交后的文档。
	*/
	async #mutate(build) {
		for (let attempt = 0;; attempt += 1) {
			const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
			const { ops, result } = await build(snapshot.value);
			if (ops.length === 0) return {
				result,
				value: snapshot.value
			};
			try {
				return {
					result,
					value: (await this.#deps.settings.mutate(OPENDESIGN_SETTINGS_NS, ops, snapshot.revision)).value
				};
			} catch (error) {
				if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
			}
		}
	}
	/** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
	async #require(ref) {
		if (!hasAccount((await this.#deps.settings.describe("llm-opendesign")).value, ref)) throw unknownRef(ref);
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
* 造一个 Open Design 账号端口（真源在设置文档，两把密钥都走凭据服务）。
* @param deps - 设置、凭据与意图日志三个端口。
* @returns 账号端口；七条命令全部实现（含 `move`、`setOrder` 与 `setAutoSwitch`）。
*/
function createOpenDesignAccounts(deps) {
	return new OpenDesignAccountsImpl(deps);
}
//#endregion
//#region src/vendors/opendesign/quota.ts
/**
* Open Design 额度：账单摘要 + 可选的 vela 周期额度 → 归一化的 {@link QuotaSnapshot}。
*
* 端点与字段逐条对照厂商事实（计划 §0、§2.5）：
* - 账单摘要：`GET https://amr-api.open-design.ai/api/v1/billing/summary`（**控制面密钥**，
*   `Authorization: Bearer`）→ `{ membershipTier, subscriptionStatus, subscriptionCurrentPeriodEnd,
*   subscriptionCancelAtPeriodEnd, creditsPerUsd }`；
* - 周期额度（Coding Plan，可选）：本机 `vela billing preflight --workspace-id <id> --format json`
*   → `{ workspaceId, codingPlan: { windows: [{ usedCredits, limitCredits, remainingCredits,
*   durationSeconds, resetsAt }] } }`。只在该账号配置了 `workspaceId` 且装配层能解析到 vela 时
*   查询；失败只记 `failures`，不拖垮整体，绝不倒成 0。
*
* **单位**（纪律：有单位必须带）：窗口的原始读数是**信用点**。摘要给了 `creditsPerUsd > 0`
* 时按美元口径折出来（`{ used, cap, unit: "usd" }`）；没有换算率时**不摆无单位信用点**，
* 改用百分比口径（`{ percent }`，超出上限时为 `100` 并置 `exceeded`）。字段缺失一律
* **不写**该字段 —— 「未公布」与「真的是 0」在 UI 上必须是两种读数。
*
* **余额 `wallet/balance` 本期不请求**（计划 §2.5）：现有客户端契约（`usage-contract.ts` 的
* `QuotaSummary`、`client/quota.ts` 的窗口渲染）没有余额的展示位，硬塞会把一个无处安放的数字
* 带进线上契约；留待后续任务（端点事实已记在这里，接的时候只需多拉一次）。
*
* **`subscriptionCancelAtPeriodEnd` 本期丢弃**：`QuotaPlan` 没有对应槽位（计划 §2.5 的同一
* 判断），不为了它扩共享内核。
* @module dsh-llm-account/src/vendors/opendesign/quota
*/
/** 额度/账单链路的默认基地址（计划 §1：`amr-api` 是控制面入口）。 */
const DEFAULT_WALLET_BASE_URL = "https://amr-api.open-design.ai/api/v1";
/** 账单摘要端点路径。 */
const BILLING_SUMMARY_PATH = "/billing/summary";
/**
* 每个端点的预算（毫秒）。额度读数是**后台**请求（侧边栏轮询 / 面板打开），不该占住
* 聊天请求那一档 5 分钟的预算；15 秒足够控制面回应，也不会让页面长时间转圈。
*/
const DEFAULT_QUOTA_TIMEOUT_MS = 15e3;
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** 读取非空字符串。 */
function stringValue(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* 读取有限数字（缺失或非数字一律 `undefined`，不倒成 0）。
*
* **也认数字字符串**：`vela billing preflight` 的 `usedCredits` / `limitCredits` 是
* `"906"` / `"50000"` 这种字符串（2026-10-18 实测），只认 `number` 会让窗口只剩重置时间、
* 没有任何数字 —— 界面上就是「有额度条但没有额度信息」。
* @param value - 端点给的值（数字或数字字符串）。
* @returns 有限数字，或 `undefined`。
*/
function numberValue(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/** 错误对象到一行文案；非 Error 原样转字符串。 */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 试一次 HTTP 版的周期额度。
*
* 成功与失败都返回**结构化的结论**（不是抛错）：调用方要据此决定是退回 vela，
* 还是直接把原因写进失败项。绝不在失败时倒成「零额度」—— 那会让用户以为这个账号用完了。
* @param workspaceId - 该账号的工作区。
* @param deps - 端口依赖（要 `preflightHttp` 与 `resolveControlKey`）。
* @returns `{ ok: true, value }` 或 `{ ok: false, reason }`。
*/
async function tryHttpPreflight(workspaceId, deps) {
	const run = deps.preflightHttp;
	if (run === void 0) return {
		ok: false,
		reason: "这个宿主版本没有 HTTP 周期额度接口"
	};
	let controlKey;
	try {
		controlKey = normalizeKey(await deps.resolveControlKey(deps.ref() ?? ""));
	} catch {
		controlKey = void 0;
	}
	if (controlKey === void 0) return {
		ok: false,
		reason: "没有可用的控制面密钥"
	};
	try {
		const value = await run(workspaceId, controlKey);
		if (value === void 0) return {
			ok: false,
			reason: "HTTP 接口没有返回数据"
		};
		return {
			ok: true,
			value
		};
	} catch (error) {
		return {
			ok: false,
			reason: messageOf(error)
		};
	}
}
/**
* vela 周期额度能不能用在这个账号上（多账号的身份闸门）。
*
* 背景：`vela billing preflight` **没有 `--key` 参数** —— 它永远用本机 vela 登录态那份
* 身份去查。于是同一个网关挂多个账号时：
*
* | 场景 | preflight 返回 | 该不该采信 |
* | --- | --- | --- |
* | 账号与 vela 登录态同一人 | 这个账号的用量 | ✅ 采信 |
* | 账号是另一个人 | **别人的用量** | ❌ 绝不采信 |
* | 任一身份读不到 | 不知道是谁的 | ❌ 不猜 |
*
* 另外 `~/.amr/config.json` 是**单例文件**（只有 `profiles.prod`）：第二个账号走网页登录会
* 覆盖第一个。所以「vela 登录态 = 最后一个登录的账号」是常态，更必须逐次核对身份。
* @param ref - 账号 ref。
* @param deps - 端口依赖（要 `identitiesOf`）。
* @returns `same` 可采信；`different` 不是同一人；`unknown` 判断不了。
*/
async function checkPreflightIdentity(ref, deps) {
	if (deps.identitiesOf === void 0) return "unknown";
	let identities;
	try {
		identities = await deps.identitiesOf(ref);
	} catch {
		return "unknown";
	}
	const account = normalizeKey(identities?.account);
	const vela = normalizeKey(identities?.vela);
	if (account === void 0 || vela === void 0) return "unknown";
	return account === vela ? "same" : "different";
}
/**
* 剥掉网关的 `data` 包装：负载是 `{ data: { … } }` 时取里层，否则用负载自己
* （形状不可信，两种都认；`data: null` 是「没有数据」而不是「读失败」）。
* @param payload - 端点负载。
* @returns 有效载荷对象，或 `undefined`。
*/
function payloadRecord(payload) {
	if (!isRecord$1(payload)) return void 0;
	return isRecord$1(payload.data) ? payload.data : payload;
}
/**
* 把端点的重置时刻转成 epoch 毫秒。数字按毫秒原样收下，字符串按 ISO 解析；缺失或解析不了
* 就是「未知」，不补 0、不补当前时间（与另两家同一纪律）。
* @param value - 端点给的 `resetsAt`。
* @returns epoch 毫秒，或 `undefined`。
*/
function epochMillis(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
	const text = stringValue(value);
	if (text === void 0) return void 0;
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? void 0 : parsed;
}
/** 已知时长（秒）→ 窗口键；5 小时与 7 天是厂商在发的两种，30/31 天留给未来的月度窗口。 */
const DURATION_KEYS = {
	18e3: "fiveHour",
	604800: "weekly",
	2592e3: "monthly",
	2678400: "monthly"
};
/**
* 一个 preflight 窗口的键：已知时长映射成归一化键，未知时长**原样用秒数**当键
* （不猜它是哪种周期），时长缺失时用空键（界面渲染成「额度」）。
* @param duration - 端点给的 `durationSeconds`。
* @returns 窗口键。
*/
function windowKeyOf(duration) {
	const seconds = numberValue(duration);
	if (seconds === void 0) return "";
	return DURATION_KEYS[seconds] ?? String(seconds);
}
/**
* 归一化一个 preflight 窗口。
*
* **上限（`cap`）优先用官方公布的美元值**，而不是从 credits 换算 —— 需求
* 明确要求「按照官方的实际口径来而不是靠推算」。
*
* 理由：接口给的 `creditsPerUsd`（实测 10000）与官方文档的窗口额度（Go 周 $30）
* 对不上，算出来的上限只有实际的一半。与其用接口字段反推，不如直接采信官方文档：
*
* | 套餐 | 7 天窗口 | 5 小时窗口 |
* | --- | --- | --- |
* | Go | $30 | $10 |
* | Plus | $40 | 不设 |
* | Pro | $90 | 不设 |
* | Max | $150 | 不设 |
*
* `used` 仍需要换算率（官方不公布「已用多少美元」），这时用「官方上限 ÷ 接口的
* limitCredits」得到的比率 —— 它由两个已知量相除而来，与 `cap` 自洽。
* @param raw - 端点给的一个窗口。
* @param creditsPerUsd - 换算率（`creditsPerUsd` 或由上限反推，见 {@link ratioOf}）。
* @param officialCap - 官方公布的这个窗口的美元上限（没有时 `undefined`）。
* @returns 归一化窗口；整行不是对象时为 `undefined`。
*/
function windowOf(raw, creditsPerUsd, officialCap) {
	if (!isRecord$1(raw)) return void 0;
	const key = windowKeyOf(raw.durationSeconds);
	const resetAt = epochMillis(raw.resetsAt);
	const usedCredits = numberValue(raw.usedCredits);
	const limitCredits = numberValue(raw.limitCredits);
	const cap = officialCap !== void 0 && officialCap > 0 ? officialCap : creditsPerUsd !== void 0 && creditsPerUsd > 0 && limitCredits !== void 0 ? limitCredits / creditsPerUsd : void 0;
	const ratio = officialCap !== void 0 && officialCap > 0 && limitCredits !== void 0 && limitCredits > 0 ? limitCredits / officialCap : creditsPerUsd !== void 0 && creditsPerUsd > 0 ? creditsPerUsd : void 0;
	if (cap !== void 0 || ratio !== void 0 && usedCredits !== void 0) {
		const window = {
			key,
			unit: "usd"
		};
		if (usedCredits !== void 0 && ratio !== void 0) window.used = usedCredits / ratio;
		if (cap !== void 0) window.cap = cap;
		if (resetAt !== void 0) window.resetAt = resetAt;
		return window;
	}
	const percent = usedCredits !== void 0 && limitCredits !== void 0 && limitCredits > 0 ? Math.min(100, Math.max(0, usedCredits / limitCredits * 100)) : void 0;
	const window = { key };
	if (percent !== void 0) window.percent = percent;
	if (resetAt !== void 0) window.resetAt = resetAt;
	if (usedCredits !== void 0 && limitCredits !== void 0 && limitCredits > 0 && usedCredits > limitCredits) window.exceeded = true;
	return window;
}
/**
* 把 preflight 负载里的窗口都归一化。
*
* 只认 `codingPlan.windows` 这一条路径（计划 §0 的线上形状）；`codingPlan` 缺失表示该账号
* 没有周期套餐（不是失败），返回空数组。
* @param preflight - `billing preflight` 的负载。
* @param creditsPerUsd - 换算率（`creditsPerUsd` 或由官方上限反推）。
* @param tier - 套餐档位；用来查官方窗口上限表（没有时只按换算率折）。
* @returns 归一化窗口，按端点给的顺序。
*/
function windowsOf(preflight, creditsPerUsd, tier) {
	const record = payloadRecord(preflight);
	const codingPlan = record !== void 0 && isRecord$1(record.codingPlan) ? record.codingPlan : void 0;
	const rows = codingPlan !== void 0 && Array.isArray(codingPlan.windows) ? codingPlan.windows : [];
	const caps = tier === void 0 ? void 0 : WINDOW_CAP_USD[tier.trim().toLowerCase()];
	const windows = [];
	for (const row of rows) {
		const duration = isRecord$1(row) ? numberValue(row.durationSeconds) : void 0;
		const field = duration === void 0 ? void 0 : DURATION_TO_CAP[duration];
		const window = windowOf(row, creditsPerUsd, field === void 0 ? void 0 : caps?.[field]);
		if (window !== void 0) windows.push(window);
	}
	return windows;
}
/**
* 从 **preflight** 读套餐档位（`codingPlan.tier`）。
*
* 为什么需要这条来源（2026-10-21 实测）：`billing/summary` 与
* `vela billing summary` **都回 403**，而套餐名一直是从前者读的 —— 于是真机上
* 套餐徽标永远是空的（实际情况「opendesign 部分显示不全」）。同一个账号的
* `billing preflight` 却稳定给出 `codingPlan.tier`（实测 `"go"`），而这份数据本来
* 每次都在读（额度窗口就来自它），等于**白拿**。
*
* 只取档位：`codingPlan` 里没有套餐状态与账期，不编。
* @param preflight - `billing preflight` 的负载。
* @returns 套餐（只有 `id`/`name`）；没有 `codingPlan` 或没给 tier 时 `undefined`。
*/
function planFromPreflight(preflight) {
	const record = payloadRecord(preflight);
	if (record === void 0 || !isRecord$1(record.codingPlan)) return void 0;
	if (record.codingPlan.eligible === false) return void 0;
	const tier = stringValue(record.codingPlan.tier);
	if (tier === void 0) return void 0;
	return {
		id: tier,
		name: tier
	};
}
/**
* 归一化账单摘要里的套餐。`membershipTier` 是标识也是展示名（厂商没有单独的展示名），
* `subscriptionStatus` 原样透传（开放词表，界面认不出的原样显示）。
*
* 字段名**宽容读取**：厂商文档写的是 `membershipTier` / `subscriptionStatus` /
* `subscriptionCurrentPeriodEnd`，但同一家的不同网关/版本用过 `tier`、`plan`、`status`、
* `currentPeriodEnd`，也可能把订阅包在 `subscription` 子对象里。名字对不上就整块套餐消失
* 是用户看到的现象（「套餐信息也没有」），所以这里按优先级依次认。
* @param summary - `/billing/summary` 的负载。
* @returns 套餐；标识与状态都没有时为 `undefined`。
*/
function planOf(summary) {
	const record = payloadRecord(summary);
	if (record === void 0) return void 0;
	const nested = isRecord$1(record.subscription) ? record.subscription : void 0;
	const pick = (names) => {
		for (const name of names) {
			const value = record[name] ?? nested?.[name];
			if (value !== void 0) return value;
		}
	};
	const tier = stringValue(pick([
		"membershipTier",
		"membership",
		"tier",
		"plan",
		"subscriptionTier"
	]));
	const status = stringValue(pick([
		"subscriptionStatus",
		"status",
		"subscriptionState"
	]));
	if (tier === void 0 && status === void 0) return void 0;
	const plan = { id: tier ?? "" };
	if (tier !== void 0) plan.name = tier;
	if (status !== void 0) plan.status = status;
	const periodEnd = epochMillis(pick([
		"subscriptionCurrentPeriodEnd",
		"currentPeriodEnd",
		"periodEnd",
		"renewsAt"
	]));
	if (periodEnd !== void 0) plan.periodEnd = periodEnd;
	const periodStart = epochMillis(pick([
		"subscriptionCurrentPeriodStart",
		"currentPeriodStart",
		"periodStart"
	]));
	if (periodStart !== void 0) plan.periodStart = periodStart;
	return plan;
}
/** 摘要里的换算率（`creditsPerUsd`）；缺失或非正数读作「没有换算率」。 */
function creditsPerUsdOf(summary) {
	const record = payloadRecord(summary);
	const value = record === void 0 ? void 0 : numberValue(record.creditsPerUsd);
	return value !== void 0 && value > 0 ? value : void 0;
}
/**
* 官方公布的**窗口上限（美元）**：`open-design.ai/zh/model-credits` 的套餐构成表
* （抓于 2026-10-21）。
*
* | 套餐 | 月度总额 | 7 天窗口 | 5 小时窗口 |
* | --- | --- | --- | --- |
* | Go | $120 | $30 | $10 |
* | Plus | $180 | $40 | 不设此窗口 |
* | Pro | $480 | $90 | 不设此窗口 |
* | Max | $900 | $150 | 不设此窗口 |
*
* **为什么需要它**：`billing/summary` 回 403（拿不到 `creditsPerUsd`），于是窗口只能
* 退回百分比口径 —— 用户看不到「还剩多少美元」。而官方这张表给了每个窗口的美元上限，
* 拿它除以接口给的 `limitCredits` 就能**反推出换算率**，把美元口径补回来。
*
* 2026-10-21 的实际影响：Go 套餐的周窗口 `limitCredits = 150000`，官方说是 $30，
* 所以换算率是 **5000**；而仓库文档里早期记的 `creditsPerUsd: 10000` 会让同一窗口
* 显示成 $15 —— 用户看到「共 $15.00」就是这个原因（他实际是 $30）。
*/
const WINDOW_CAP_USD = {
	go: {
		monthly: 120,
		weekly: 30,
		fiveHour: 10
	},
	plus: {
		monthly: 180,
		weekly: 40
	},
	pro: {
		monthly: 480,
		weekly: 90
	},
	max: {
		monthly: 900,
		weekly: 150
	}
};
/** 窗口时长（秒）→ 官方上限表里的字段。 */
const DURATION_TO_CAP = {
	18e3: "fiveHour",
	604800: "weekly",
	2592e3: "monthly",
	2678400: "monthly"
};
/**
* 从**官方窗口上限**反推换算率（`creditsPerUsd` 的替代来源）。
*
* 思路：官方告诉我们「这个套餐的 7 天窗口是 $30」，接口告诉我们「这个窗口的
* limitCredits 是 150000」——两者相除就是换算率。只在 `billing/summary` 拿不到
* 换算率时才用，且**必须有一档能对上**，否则返回 `undefined`（不猜）。
*
* @param preflight - `billing preflight` 的负载（提供 `limitCredits`）。
* @param tier - 套餐档位（`codingPlan.tier`）。
* @returns 换算率（credits / USD）；推不出来时 `undefined`。
*/
function creditsPerUsdFromCaps(preflight, tier) {
	if (tier === void 0 || tier === "") return void 0;
	const caps = WINDOW_CAP_USD[tier.trim().toLowerCase()];
	if (caps === void 0) return void 0;
	const record = payloadRecord(preflight);
	if (record === void 0 || !isRecord$1(record.codingPlan)) return void 0;
	const rows = Array.isArray(record.codingPlan.windows) ? record.codingPlan.windows : [];
	for (const row of rows) {
		if (!isRecord$1(row)) continue;
		const duration = numberValue(row.durationSeconds);
		if (duration === void 0) continue;
		const field = DURATION_TO_CAP[duration];
		if (field === void 0) continue;
		const cap = caps[field];
		if (cap === void 0 || cap <= 0) continue;
		const limit = numberValue(row.limitCredits);
		if (limit === void 0 || limit <= 0) continue;
		const rate = limit / cap;
		if (Number.isFinite(rate) && rate > 0) return rate;
	}
}
/**
* 把两个来源的负载归一化成一次额度读数。纯函数：不做 I/O、不缓存。
* @param parts - 账单摘要、preflight 负载与已记名的失败项。
* @returns 归一化读数；窗口顺序 = preflight 给的顺序，**不再追加**任何本地补的窗口。
*/
function toQuotaSnapshot(parts) {
	const plan = planOf(parts.summary) ?? planFromPreflight(parts.preflight);
	/**
	* **窗口上限直接采信官方公布的美元值**（`WINDOW_CAP_USD`），不靠换算推算 ——
	* 2026-10-21 明确的口径：接口的 `creditsPerUsd`（实测 10000）与官方文档
	* （Go 周窗口 $30，对应 5000）对不上，算出来的上限只有实际的一半。
	*
	* 换算率只用来算「已用多少美元」：官方上限 ÷ 接口的 `limitCredits`。
	* 两者都拿不到时退回 `creditsPerUsd`，再不行就进百分比口径。
	*/
	const creditsPerUsd = creditsPerUsdFromCaps(parts.preflight, plan?.id) ?? creditsPerUsdOf(parts.summary);
	return {
		windows: windowsOf(parts.preflight, creditsPerUsd, plan?.id),
		...plan === void 0 ? {} : { plan },
		failures: [...parts.failures]
	};
}
/** 去掉基地址末尾的斜杠（用户可能把 `/api/v1/` 写进来）。 */
function trimBase(base) {
	return base.replace(/\/+$/, "");
}
/**
* Open Design 的额度端口。
*
* `snapshot()` 的顺序：解析当前账号的控制面密钥 → `GET /billing/summary` →（配置了
* workspaceId 且注入了 preflight 时）vela 周期额度。**每个来源各自 try/catch**，失败只把
* 一句人话记进 `failures`，其余照常返回。没有控制面密钥时抛 `MISSING_CREDENTIAL`，一个端点
* 都不请求（与另两家同一语义）：缺密钥是「账号没配全」，不是「额度读不到」。
* @param deps - 账号 ref、密钥解析、工作区解析、`fetch`、vela 与基地址/预算。
* @returns 额度端口。
*/
function createOpenDesignQuota(deps) {
	const base = trimBase(deps.walletBase === void 0 || deps.walletBase.trim() === "" ? DEFAULT_WALLET_BASE_URL : deps.walletBase);
	const timeoutMs = deps.timeoutMs !== void 0 && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_QUOTA_TIMEOUT_MS;
	/**
	* 拉一次账单摘要。失败时**带上原因**：套餐/额度整块缺席时，界面只有一句「没有数据」
	* 对用户毫无帮助（本机报障：「套餐信息也没有」—— 到底是被拒、超时，还是这个账号本来
	* 就没有订阅，三种情况该说三种话）。
	* @param key - 控制面密钥（缺省回退到推理密钥）。
	* @returns 负载，或失败原因（人话）。
	*/
	async function getSummary(key) {
		try {
			const response = await deps.fetchImpl(`${base}${BILLING_SUMMARY_PATH}`, {
				headers: {
					Authorization: `Bearer ${key}`,
					...IDENTITY_ENCODING_HEADER
				},
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (!response.ok) return { problem: `账单接口返回 HTTP ${response.status}` };
			const payload = await response.json();
			if (!isRecord$1(payload)) return { problem: "账单接口返回了认不出的正文" };
			return { payload };
		} catch (error) {
			return { problem: `账单接口不可达（${messageOf(error)}）` };
		}
	}
	return { async snapshot(accountRef) {
		const ref = accountRef ?? deps.ref();
		const key = ref === void 0 ? void 0 : normalizeKey(await deps.resolveControlKey(ref));
		if (key === void 0) {
			const account = ref === void 0 ? "(none selected)" : `"${ref}"`;
			throw new LlmError(`llm-opendesign: no usable control key for Open Design account ${account}; store it through the credentials service, export it in the launching environment, or run \`vela login\``, "MISSING_CREDENTIAL");
		}
		const failures = [];
		const read = await getSummary(key);
		let summary = read.payload;
		let readProblem = read.problem;
		if (summary === void 0 && deps.summaryFallback !== void 0) try {
			const fallback = await deps.summaryFallback();
			if (fallback !== void 0) {
				summary = fallback;
				readProblem = void 0;
			}
		} catch (error) {
			readProblem = `${readProblem ?? "没有返回数据"}；vela 回退也失败（${messageOf(error)}）`;
		}
		if (summary === void 0) {
			const kind = ref === void 0 || deps.controlKeyKind === void 0 ? void 0 : await deps.controlKeyKind(ref);
			if (kind === "inference-only" || kind === "none") failures.push(kind === "inference-only" ? "这个账号只有推理密钥（sk-amr…），没有控制面密钥（vela_ctrl…），所以读不到余额与周期额度。这条链只认控制面密钥 —— 请用**网页登录**重新登录这个账号一次，它会把这个账号的 vela_ctrl… 自动导入；重试或换密钥都无效。" : "这个账号还没有任何可用密钥：余额与周期额度需要控制面密钥（vela_ctrl…），请用网页登录登录一次，或在设置里填一把 API key 用于推理。");
			else failures.push(`账单摘要读取失败（${readProblem ?? "没有返回数据"}）：套餐信息与额度换算单位暂时缺失`);
		}
		let preflight;
		const workspaceId = ref === void 0 ? void 0 : normalizeKey(await deps.workspaceIdOf(ref));
		if (workspaceId !== void 0 && ref !== void 0 && (deps.preflightHttp !== void 0 || deps.preflight !== void 0)) {
			/**
			* **优先走 HTTP**（2026-10-21 发现，多账号额度的正解）。
			*
			* `GET /workspaces/{ws}/billing/preflight` 用**这个账号自己的控制面密钥**鉴权，
			* 返回的东西与 `vela billing preflight` 完全一致（实测字段逐项相同：
			* `codingPlan.windows[].usedCredits / limitCredits / resetsAt`）。
			*
			* 为什么它才是正解：vela CLI 没有 `--key` 参数，永远拿**本机登录态**那份身份去查 ——
			* 同一网关挂第二个人的账号时，它返回的是别人的用量，只能靠身份闸门整段跳过。
			* HTTP 版按账号鉴权，所以**每个账号都能拿到自己的准确数字**，不需要闸门。
			*
			* 顺序有意为之：HTTP 能通就绝不用 vela（那条路有身份歧义）；HTTP 失败
			* （老版本没这个端点 / 网络问题）才退回 vela，那时仍然要过身份闸门。
			*/
			const viaHttp = await tryHttpPreflight(workspaceId, deps);
			if (viaHttp.ok) preflight = viaHttp.value;
			else if (deps.preflight !== void 0) {
				const identityVerdict = await checkPreflightIdentity(ref, deps);
				if (identityVerdict !== "same") failures.push(identityVerdict === "different" ? "周期额度：HTTP 接口不可用，退回本机 vela 查询；而 vela 登录态与本账号不是同一个人，为避免显示别人的用量已跳过（余额与套餐仍然准确）" : "周期额度：HTTP 接口不可用，退回本机 vela 查询；无法确认登录态与本账号是否同一人，已跳过（余额与套餐仍然准确）");
				else try {
					const value = await deps.preflight(workspaceId);
					if (value === void 0) failures.push("周期额度查询没有返回数据：本机 vela 没给出可用的读数");
					else preflight = value;
				} catch (error) {
					failures.push(`周期额度查询失败：${messageOf(error)}`);
				}
			} else failures.push(`周期额度查询失败：${viaHttp.reason}`);
		} else if (workspaceId === void 0) failures.push(ref === void 0 ? "未选中账号：周期额度需要先选一个账号" : "该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在设置里手填）");
		return toQuotaSnapshot({
			...summary === void 0 ? {} : { summary },
			...preflight === void 0 ? {} : { preflight },
			failures
		});
	} };
}
//#endregion
//#region src/vendors/opendesign/login.ts
/**
* Open Design 网页登录：设备授权（浏览器批准），由官方 `vela login` 完成（计划 §2.6）。
*
* 流程与厂商事实（计划 §0）逐条对照：
* 1. `begin()` 按 VELA_BIN → 桌面端内置 → PATH 的顺序解析 vela（{@link findVelaBinary}），
*    `spawn(vela, ["login"])`；
* 2. `stdout` 先出现 `Open this URL to continue:`，**下一行**是激活网址
*    （`https://<host>/cli/activate?deviceId=…`），随后 `Code: XXXX`；在**有界的**
*    {@link VELA_PARSE_TIMEOUT_MS} 内解析出来就进入 `waiting`（带 `authUrl`/`userCode`/
*    `expiresAt`），解析超时 → `failed/reason:"timeout"`；
* 3. 找不到 vela 时：`~/.amr/config.json` 已有可用 profile 就**直接导入**并 `success`
*    （本机登录产物就是登录结果，没必要逼用户再装一个 CLI），否则 `failed/reason:"vela-missing"`；
* 4. 后台等「子进程退出」或「配置文件出现」两个条件中**先到的那个**；成功后把
*    `runtimeKey`/`controlKey`/工作区交给注入的 `storeKey`（装配层负责「同 ref 换密钥，否则
*    add」）；配置文件坏掉 → `failed/reason:"config-invalid"`，子进程正常退出却没留下登录
*    产物 → `failed/reason:"no-signin"`，子进程异常退出 → `failed/reason:"unavailable"`；
* 5. `status()` 纯读内存；`cancel()` kill 子进程（`waiting` 中取消 → `failed/reason:"cancelled"`）；
*    终态之后的下一次 `begin()` 才开新尝试；`ctx.effect` 卸载时 `cancel()`。
*
* **只读不改写** `~/.amr/config.json`（计划 §0 的明确要求）：本模块只用 `readFile` 读它。
* **不 import 宿主 ctx**：`spawn`/`readFile`/`sleep`/`now`/`resolveVela`/`storeKey` 全部注入，
* 离线可单测（计划 §2.6 的最后一条）。
*
* 同一份实现还导出 {@link createVelaPreflight}：`vela billing preflight --workspace-id <id>
* --format json` 的读取器，供额度端口注入（`quota.ts` 的 `preflight` 依赖）。它共用这里的
* vela 解析与「收完子进程输出」的小工具，不重复一份 CLI 事实。
* @module dsh-llm-account/src/vendors/opendesign/login
*/
/** 本登录流所属的 provider 路由（ref 生成的厂商段）。 */
const OPEN_DESIGN_LOGIN_VENDOR = "opendesign";
/** `billing preflight` 的预算（毫秒）。 */
const VELA_PREFLIGHT_TIMEOUT_MS = 2e4;
/** 本机登录产物的默认路径（只读，见模块头）。 */
function defaultProfilePath() {
	return join(homedir(), ".amr", "config.json");
}
/**
* 一次 `vela` 启动该用什么 spawn 参数（纯函数，便于单测）。
*
* **Windows 上非 `.exe` 一律走 shell**（2026-10-20 真机实测）：
*
* | 配置 | 结果 |
* | --- | --- |
* | `shell: false` + `.cmd` | **EINVAL**（`spawn EINVAL`，stdout 零字节） |
* | `shell: true` + `.cmd` | 正常拿到网址与验证码 |
*
* npm 全局安装生成的是 `.cmd`（外加 `.ps1` 与**无扩展名**的 sh 脚本）。旧实现只给
* `.cmd`/`.bat` 开 shell —— 一旦命中的是那个无扩展名的 `vela`，就落到 `shell: false`
* 分支，于是 `EINVAL`（用户在新设备上看到的就是这个）。
*
* 判据因此从「扩展名是不是 cmd/bat」改成「**是不是原生可执行映像**」：
* Windows 上只有 `.exe` 能直接 spawn，其余都交给 cmd.exe。
*
* 关于 `DEP0190`（shell + args 是拼接而非转义）：这里 args 恒为 `["login"]`，
* 没有用户输入参与，不构成注入面。
* @param command - 解析到的 vela 路径。
* @param platform - 平台（缺省取当前进程；注入便于测试 Windows 分支）。
* @returns 直接交给 `nodeSpawn` 的参数。
*/
function spawnOptionsFor(command, platform = process.platform) {
	const native = /\.exe$/i.test(command);
	const base = {
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		windowsHide: true
	};
	if (platform !== "win32" || native) return {
		command,
		options: base
	};
	return {
		command: `"${command}"`,
		options: {
			...base,
			shell: true,
			windowsVerbatimArguments: true
		}
	};
}
/** 默认的启动方式：两个输出流都接管道，Windows 下不弹控制台窗口。 */
function defaultSpawn(command, args) {
	const { command: executable, options } = spawnOptionsFor(command);
	return spawn(executable, [...args], options);
}
/**
* vela 候选可执行文件名（Windows 优先 `.exe`，其次 npm 包装）。
*
* **`.cmd`/`.bat` 是必须的**（2026-10-20 真机）：用 `npm i -g @powerformer/vela-cli` 装的话，
* Windows 上生成的是 `vela.cmd`（外加 `.ps1` 与一个**无扩展名**的 sh 脚本），**没有 `.exe`**。
* 只找 `.exe` / `vela` 的旧清单会命中那个无扩展名的 sh 脚本 —— 而 Windows 不能直接执行它，
* `spawn` 于是触发 `error` 事件、一个字节都不输出，界面上就是
* 「vela 没有任何输出（命令可能没能启动）」。
*
* 顺序有意义：`.exe` 优先（官方安装器给的是原生二进制）；`.cmd` 次之（npm 包装，能跑）；
* 最后才是无扩展名的 `vela`（那是 POSIX shell 脚本，Windows 上基本跑不了，但保留给
* Git Bash / MSYS 之类的环境）。
*/
const VELA_FILE_NAMES = process.platform === "win32" ? [
	"vela.exe",
	"vela.cmd",
	"vela.bat",
	"vela"
] : ["vela"];
/** 桌面端内置 vela 的相对路径（计划 §0 的 `%LOCALAPPDATA%\Programs\Open Design\…`）。 */
const DESKTOP_VELA_RELATIVE = [
	"Programs",
	"Open Design",
	"resources",
	"open-design",
	"bin",
	"vela.exe"
];
/**
* 按 VELA_BIN → 桌面端内置 → PATH 的顺序找 vela（纯函数，注入环境与存在性判定便于单测）。
*
* `VELA_BIN` 非空时**直接采信**（用户显式指定的路径就是权威；它不存在时后续的启动会失败，
* 那是更准确的错误）；桌面端内置按 `%LOCALAPPDATA%` 展开；PATH 逐个目录找
* `vela.exe` / `vela`。
* @param env - 环境变量表（缺省 `process.env`）。
* @param exists - 文件存在性判定（缺省 `fs.existsSync`）。
* @returns vela 的路径，或 `undefined`（三个来源都没有）。
*/
function findVelaBinary(env = process.env, exists = existsSync) {
	const configured = normalizeKey(env.VELA_BIN);
	if (configured !== void 0) return configured;
	const localAppData = normalizeKey(env.LOCALAPPDATA);
	if (localAppData !== void 0) {
		const desktop = join(localAppData, ...DESKTOP_VELA_RELATIVE);
		if (exists(desktop)) return desktop;
	}
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		if (dir.trim() === "") continue;
		for (const name of VELA_FILE_NAMES) {
			const candidate = join(dir, name);
			if (exists(candidate)) return candidate;
		}
	}
}
/** 默认的 vela 解析（生产读 `process.env` 与真实文件系统）。 */
function defaultResolveVela() {
	return Promise.resolve(findVelaBinary());
}
/** 去掉 ANSI 颜色转义：CLI 把提示行染色时，网址与验证码的提取不该被转义码挡住。 */
function stripAnsi(text) {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}
/** 诊断文本的最大长度：够看清原因，又不至于把界面撑爆。 */
const VELA_DIAGNOSTIC_LIMIT = 600;
/**
* 把 vela 的原始输出整理成一句可展示的诊断。
*
* 三条纪律：
* 1. **没有输出本身就是信息**（「命令没有任何输出」指向「启动失败」而非「格式变了」）；
* 2. **截断**到 `VELA_DIAGNOSTIC_LIMIT`，超长时明确标注被截断；
* 3. **抹掉像密钥的片段**：输出理论上不该含密钥，但诊断信息会被贴进聊天窗口，
*    宁可多一层过滤（`sk-…` / `vela_…` / 长十六进制串）。
* @param text - 累计的 stdout+stderr。
* @returns 诊断文本；完全没有输出时也给一句说明（`undefined` 表示不需要展示）。
*/
function describeVelaOutput(text) {
	const cleaned = stripAnsi(text).replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/vela_[A-Za-z0-9_-]{8,}/g, "vela_***").trim();
	if (cleaned === "") return "vela 没有任何输出（命令可能没能启动，或退出得比提示还快）";
	const flat = cleaned.replace(/\s+/g, " ");
	return flat.length <= VELA_DIAGNOSTIC_LIMIT ? flat : `${flat.slice(0, VELA_DIAGNOSTIC_LIMIT)}…（已截断，原长 ${flat.length} 字）`;
}
/** 输出块到文本（真实流给 `Buffer`；测试假实现可以直接给字符串）。 */
function textOfChunk(chunk) {
	if (typeof chunk === "string") return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
	return String(chunk ?? "");
}
/**
* 从 vela 的输出里解析授权网址与验证码（纯函数）。
*
* 网址有两种落法都认：`Open this URL to continue:` 的**下一行**（线上形状），或同一行冒号
* 之后；验证码是 `Code: XXXX` 那一行。解析不了的部分保持缺省 —— 调用方按「还没解析出来」
* 继续等，不猜。
* @param text - 累计的输出文本（含 ANSI 转义也认）。
* @returns 已解析出的部分。
*/
function parseVelaPrompt(text) {
	const lines = stripAnsi(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
	let authUrl;
	let userCode;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const sameLine = /Open this URL to continue:\s*(\S+)/i.exec(line);
		if (sameLine !== null && /^https?:\/\//i.test(sameLine[1] ?? "")) authUrl = sameLine[1];
		else if (/Open this URL to continue:?\s*$/i.test(line)) {
			const next = lines[index + 1];
			if (next !== void 0 && /^https?:\/\//i.test(next)) authUrl = next;
		}
		const code = /^Code:\s*(\S+)/i.exec(line);
		if (code !== null && code[1] !== void 0 && code[1] !== "") userCode = code[1];
	}
	return {
		...authUrl === void 0 ? {} : { authUrl },
		...userCode === void 0 ? {} : { userCode }
	};
}
/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* 解析本机登录产物（纯函数，只读文本）。
*
* 形状：`{ profiles: { <slot>: { controlKey, runtimeKey, apiUrl, linkUrl, user: { id, email, name,
* plan } } } }`。取 `profiles.prod`；没有 `prod` 但**只有一个** profile 时取那一个
* （用户手改过槽名也还能救回来）；其它情况读作不可用。可用性的门槛是**非空 `runtimeKey`**
* —— 没有推理密钥的 profile 导进来只是一个配置不了的账号。工作区从 profile 顶层的
* `workspaceId` 或 `workspace.id` 里取（厂商形状是防御性读取，缺失就是缺省）。
* @param text - 配置文件原文。
* @returns 可导入的 profile，或 `undefined`（不可用/不是 JSON）。
*/
function parseAmrProfile(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (!isRecord(parsed) || !isRecord(parsed.profiles)) return void 0;
	const profiles = parsed.profiles;
	let slot = "prod";
	let candidate = profiles.prod;
	if (!isRecord(candidate)) {
		const keys = Object.keys(profiles);
		if (keys.length !== 1) return void 0;
		slot = keys[0];
		candidate = profiles[slot];
	}
	if (!isRecord(candidate)) return void 0;
	const runtimeKey = normalizeKey(candidate.runtimeKey);
	if (runtimeKey === void 0) return void 0;
	const user = isRecord(candidate.user) ? candidate.user : void 0;
	const workspace = isRecord(candidate.workspace) ? candidate.workspace : void 0;
	const workspaceId = normalizeKey(candidate.workspaceId) ?? (workspace === void 0 ? void 0 : normalizeKey(workspace.id));
	return {
		slot,
		runtimeKey,
		...normalizeKey(candidate.controlKey) === void 0 ? {} : { controlKey: normalizeKey(candidate.controlKey) },
		...normalizeKey(candidate.apiUrl) === void 0 ? {} : { apiUrl: normalizeKey(candidate.apiUrl) },
		...normalizeKey(candidate.linkUrl) === void 0 ? {} : { linkUrl: normalizeKey(candidate.linkUrl) },
		...user === void 0 || normalizeKey(user.id) === void 0 ? {} : { userId: normalizeKey(user.id) },
		...user === void 0 || normalizeKey(user.email) === void 0 ? {} : { email: normalizeKey(user.email) },
		...user === void 0 || normalizeKey(user.name) === void 0 ? {} : { name: normalizeKey(user.name) },
		...user === void 0 || normalizeKey(user.plan) === void 0 ? {} : { plan: normalizeKey(user.plan) },
		...workspaceId === void 0 ? {} : { workspaceId }
	};
}
/**
* 给一个 profile 挑账号标签：邮箱 → 显示名 → profile 槽名。标签只影响展示与 ref 的可见部分
* （`accountRef` 会把它转义 + 哈希，不同标签永远不会共用一个凭据槽）。
* @param profile - 已解析的 profile。
* @returns 账号标签。
*/
function profileLabel(profile) {
	return profile.email ?? profile.name ?? profile.slot;
}
/** 默认等待：可被 abort 的定时器（与 opencode 的 `defaultSleep` 同一形状）。 */
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
/**
* 一次 Open Design 网页登录尝试（单飞：等待中重复 `begin()` 返回同一个状态；解析还没落地时
* 复用在途 promise，避免两次启动各跑一个 vela）。
*/
var OpenDesignLoginFlow = class {
	#deps;
	#spawn;
	#readFile;
	#sleep;
	#now;
	#resolveVela;
	#profilePath;
	#timeoutMs;
	#parseTimeoutMs;
	#pollIntervalMs;
	#statusValue = { state: "idle" };
	/** 当前尝试的 vela 子进程；每次结算都由 `#teardown` 收掉。 */
	#child;
	/** 当前尝试的中止信号：取消/终结/下一次 `begin()` 都会中止它。 */
	#abort;
	/**
	* 尝试代际。profile 读取与 `storeKey` 都是 await，用户可能在这段时间里取消或重新登录；
	* 代际让迟到的结果认出自己已经不再拥有状态面，从而不落库、不改状态。
	*/
	#attemptSeq = 0;
	/** 正在启动的那次 `begin()`：它落地之前状态面还说不出 `waiting`，后来者必须复用。 */
	#starting;
	/** 启动期间到达的 `cancel()`：那次启动落地后自行退场。 */
	#cancelPending = false;
	/**
	* @param deps - 落库回调与各个 I/O 注入点。
	*/
	constructor(deps) {
		this.#deps = deps;
		this.#spawn = deps.spawn ?? defaultSpawn;
		this.#readFile = deps.readFile ?? ((path) => readFile(path, "utf8"));
		this.#sleep = deps.sleep ?? defaultSleep;
		this.#now = deps.now ?? (() => Date.now());
		this.#resolveVela = deps.resolveVela ?? defaultResolveVela;
		this.#profilePath = deps.profilePath ?? defaultProfilePath();
		this.#timeoutMs = deps.timeoutMs ?? 18e4;
		this.#parseTimeoutMs = deps.parseTimeoutMs ?? 3e4;
		this.#pollIntervalMs = deps.pollIntervalMs ?? 1e3;
	}
	/** @returns 等待授权时的授权网址。 */
	get authUrl() {
		return this.#statusValue.authUrl;
	}
	/**
	* 开始（或接续）一次尝试，返回其最新状态。
	* @returns 最新状态（`waiting` 时带授权网址与验证码）。
	*/
	async begin() {
		if (this.#statusValue.state === "waiting") return { ...this.#statusValue };
		if (this.#starting !== void 0) return { ...await this.#starting };
		this.#cancelPending = false;
		const starting = this.#startAttempt();
		this.#starting = starting;
		try {
			return { ...await starting };
		} finally {
			if (this.#starting === starting) this.#starting = void 0;
		}
	}
	/** @returns 当前尝试的状态面（副本：调用方改不动内部状态）。 */
	async status() {
		return { ...this.#statusValue };
	}
	/**
	* 取消等待中的尝试；终态不受影响。启动还没落地时只是标记，等它落地后自行退场。
	* @returns 取消动作完成（子进程已收掉）。
	*/
	async cancel() {
		if (this.#starting !== void 0) this.#cancelPending = true;
		if (this.#statusValue.state !== "waiting") return;
		await this.#settle(this.#attemptSeq, {
			state: "failed",
			reason: "cancelled"
		});
	}
	/**
	* 启动半程：解析 vela → 启动子进程 → 有界解析授权提示 → 进入 `waiting` 并在后台等批准。
	* 调用方只能经 `begin()` 的单飞栅栏进来。
	* @returns 尝试落地后的状态。
	*/
	async #startAttempt() {
		this.#teardown();
		const attempt = this.#attemptSeq += 1;
		const abort = new AbortController();
		this.#abort = abort;
		let vela;
		let resolveProblem;
		try {
			vela = await this.#resolveVela();
		} catch (error) {
			vela = void 0;
			resolveProblem = error instanceof Error ? error.message : String(error);
		}
		if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();
		if (vela === void 0) {
			const imported = await this.#importWithoutVela(attempt, abort.signal);
			return imported.reason === "vela-missing" && resolveProblem !== void 0 ? {
				...imported,
				detail: `查找 vela 时出错：${resolveProblem}`
			} : imported;
		}
		let child;
		try {
			child = this.#spawn(vela, ["login"]);
		} catch (error) {
			this.#statusValue = {
				state: "failed",
				reason: "unavailable",
				detail: `启动 vela 失败：${error instanceof Error ? error.message : String(error)}`
			};
			return { ...this.#statusValue };
		}
		this.#child = child;
		if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();
		const { prompt, output } = await this.#promptWithin(child, abort.signal, this.#parseTimeoutMs);
		if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();
		if (prompt?.authUrl === void 0) {
			this.#teardown();
			this.#statusValue = {
				state: "failed",
				reason: "timeout",
				...describeVelaOutput(output) === void 0 ? {} : { detail: describeVelaOutput(output) }
			};
			return { ...this.#statusValue };
		}
		const expiresAt = this.#now() + this.#timeoutMs;
		this.#statusValue = {
			state: "waiting",
			authUrl: prompt.authUrl,
			...prompt.userCode === void 0 ? {} : { userCode: prompt.userCode },
			expiresAt
		};
		this.#awaitApproval(child, attempt, abort.signal, expiresAt);
		return { ...this.#statusValue };
	}
	/** 取消发生在启动半程时的统一退场：收掉一切，落在 `cancelled`。 */
	#settleCancelled() {
		this.#cancelPending = false;
		this.#teardown();
		this.#statusValue = {
			state: "failed",
			reason: "cancelled"
		};
		return { ...this.#statusValue };
	}
	/**
	* 有界解析授权提示：等 `authUrl` 出现，或等解析窗口用完。
	*
	* 两个输出流都收（有的构建把提示写 stderr），缓冲在同一个文本里按行解析。窗口用注入的
	* `sleep` 计时，因此取消/超时都能立刻退出；订阅关系随子进程一起被丢弃（假实现与真实
	* 子进程都不需要在被 kill 之后还被摘掉监听器）。
	* @param child - 本次尝试的 vela 子进程。
	* @param signal - 本次尝试的中止信号。
	* @param timeoutMs - 解析窗口。
	* @returns 解析到的提示（可能只有一半），或 `undefined`（窗口用完）。
	*/
	async #promptWithin(child, signal, timeoutMs) {
		let text = "";
		let failure = "";
		let resolveFound;
		const found = new Promise((resolve) => {
			resolveFound = resolve;
		});
		const onData = (chunk) => {
			text += textOfChunk(chunk);
			const prompt = parseVelaPrompt(text);
			if (prompt.authUrl !== void 0) resolveFound?.(prompt);
		};
		const onEnd = () => {
			resolveFound?.(parseVelaPrompt(text));
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("exit", onEnd);
		child.on("error", (...rest) => {
			const error = rest[0];
			failure = `vela 启动失败：${error instanceof Error ? error.message : String(error ?? "未知错误")}`;
			onEnd();
		});
		const timedOut = this.#sleep(timeoutMs, signal).then(() => void 0, () => void 0);
		const prompt = await Promise.race([found, timedOut]);
		const diagnostic = [failure, text].filter((part) => part !== "").join("\n");
		return prompt !== void 0 && prompt.authUrl !== void 0 ? {
			prompt,
			output: diagnostic
		} : { output: diagnostic };
	}
	/**
	* 找不到 vela 时的导入路径：本机登录产物已有可用 profile 就直接落库（成功），否则报
	* `vela-missing` —— 用户看到的是「装桌面端或 `npm i -g @powerformer/vela-cli`」的指引，
	* 而不是一个静默的失败。
	* @param attempt - 本次尝试的代际。
	* @param signal - 本次尝试的中止信号。
	* @returns 落地后的状态。
	*/
	async #importWithoutVela(attempt, signal) {
		const text = await this.#readProfileText();
		if (signal.aborted || this.#cancelPending) return this.#settleCancelled();
		const profile = text === void 0 ? void 0 : parseAmrProfile(text);
		if (profile === void 0) {
			this.#statusValue = {
				state: "failed",
				reason: "vela-missing"
			};
			return { ...this.#statusValue };
		}
		this.#statusValue = { state: "waiting" };
		await this.#complete(attempt, profile);
		return { ...this.#statusValue };
	}
	/**
	* 后台等授权完成：等「子进程退出」或「登录产物出现」两个条件中先到的那个。
	* @param child - 本次尝试的 vela 子进程。
	* @param attempt - 本次尝试的代际。
	* @param signal - 本次尝试的中止信号。
	* @param deadline - 等待授权的截止时刻（= `expiresAt`）。
	*/
	async #awaitApproval(child, attempt, signal, deadline) {
		/**
		* **登录开始前**产物的内容，用来判断「文件变了没有」。
		*
		* 为什么必须有它：
		* `~/.amr/config.json` 是 vela 的**固定槽位**文件（`profiles.prod`）—— 无论登录哪个
		* 账号都写同一处。所以登录第二个账号时，文件里**已经有第一个账号的内容**。
		*
		* 旧判据是「文件存在且能解析 → 登录成功」，于是第二轮登录会在第一轮轮询就读到
		* **旧内容**，立刻判定成功，把**第一个账号**的凭据又存一遍：界面显示「登录成功」，
		* 账号列表却毫无变化 —— 正是用户看到的现象。
		*
		* 判据改成「内容与基线不同」：那是 vela 真的写入了这次登录的唯一证据。
		*/
		const baseline = await this.#readProfileText();
		let exited;
		const exit = new Promise((resolve) => {
			child.on("exit", (code) => {
				exited = { code };
				resolve();
			});
			child.on("error", () => {
				exited = { code: null };
				resolve();
			});
		});
		for (;;) {
			if (signal.aborted) return;
			if (this.#now() >= deadline) {
				await this.#settle(attempt, {
					state: "failed",
					reason: "timeout"
				});
				return;
			}
			await Promise.race([exit, this.#sleep(this.#pollIntervalMs, signal).then(() => void 0, () => void 0)]);
			if (signal.aborted) return;
			const text = await this.#readProfileText();
			if (text !== void 0) {
				/**
				* 判断「这次登录到底发生了什么」。
				*
				* **基线不能否决已经发生的事实**（2026-10-22 自查发现）：
				*
				* - 内容与基线**不同** 且能解析 → 本次登录写入了新内容，成功；
				* - 内容与基线**相同**、但子进程**已正常退出** → 也要成功。这是
				*   **重复登录同一个账号**的情况：vela 写回的 profile 与登录前完全一致
				*   （密钥没刷新），旧逻辑会误报 `no-signin`，而用户在浏览器里明明批准了；
				* - 内容与基线相同、子进程**没退出** → 用户还没批准，继续等。
				*/
				const profile = parseAmrProfile(text);
				const changed = text !== baseline;
				if (profile !== void 0) {
					/**
					* 三种组合分别对应真实场景：
					*
					* 1. `changed` → 新账号（或换密钥）：通常这时子进程还没退出，不能等它；
					* 2. `!changed` 且已退出且 code=0 → 重复登录同一账号，批准了，成果就是这份；
					* 3. `!changed` 且未退出 → 还可能只是旧内容，继续等（不能提前采信）。
					*/
					if (changed || exited !== void 0) {
						/**
						* **第 2 种情况要额外确认 code === 0**。
						*
						* 异常退出（非 0）时文件里的是旧账号内容，采信它就把旧账号又存一遍。
						* 这一类错误在 v0.8.3 之前表现为「登录成功但没新账号」，不该重犯。
						*/
						if (changed || exited?.code === 0) {
							await this.#complete(attempt, profile);
							return;
						}
						await this.#settle(attempt, {
							state: "failed",
							reason: "unavailable"
						});
						return;
					}
					continue;
				}
				if (exited !== void 0) {
					await this.#settle(attempt, {
						state: "failed",
						reason: "config-invalid"
					});
					return;
				}
				continue;
			}
			if (exited !== void 0) {
				await this.#settle(attempt, {
					state: "failed",
					reason: exited.code === 0 ? "no-signin" : "unavailable"
				});
				return;
			}
		}
	}
	/**
	* 读本机登录产物；文件不存在或读不了都读作 `undefined`（那是常态，不是错误）。
	* @returns 文件原文，或 `undefined`。
	*/
	async #readProfileText() {
		try {
			const text = await this.#readFile(this.#profilePath);
			return normalizeKey(text) === void 0 ? void 0 : text;
		} catch {
			return;
		}
	}
	/**
	* 收下 profile 并把凭据交给装配层。每个 await 之后都复检所有权：取消之后绝不落库
	* （最后一次复检与 `storeKey` 调用之间没有 await，与另两家同一条纪律）。
	* @param attempt - 本次尝试的代际。
	* @param profile - 已解析的 profile。
	*/
	async #complete(attempt, profile) {
		if (!this.#ownsAttempt(attempt)) return;
		const label = profileLabel(profile);
		try {
			await this.#deps.storeKey({
				ref: accountRef(OPEN_DESIGN_LOGIN_VENDOR, label),
				key: profile.runtimeKey,
				...profile.controlKey === void 0 ? {} : { controlKey: profile.controlKey },
				...profile.workspaceId === void 0 ? {} : { workspaceId: profile.workspaceId },
				label
			});
		} catch {
			await this.#settle(attempt, {
				state: "failed",
				reason: "unavailable"
			});
			return;
		}
		await this.#settle(attempt, { state: "success" });
	}
	/**
	* 终结一次尝试：**先同步改状态**，再收掉子进程与在途信号。所有权判据是「代际相等 +
	* 状态还是 `waiting`」，先改状态是同步的失效动作。
	* @param attempt - 尝试代际。
	* @param status - 终态状态面。
	* @returns 本次调用是否真的终结了这次尝试（不是所有者时什么都不做）。
	*/
	async #settle(attempt, status) {
		if (!this.#ownsAttempt(attempt)) return false;
		this.#cancelPending = false;
		this.#statusValue = status;
		this.#teardown();
		return true;
	}
	/**
	* 这次代际是否仍然拥有状态面：既没被取消/终结，也没被一次新的 `begin()` 顶掉。
	* @param attempt - 尝试代际。
	* @returns 是否仍拥有。
	*/
	#ownsAttempt(attempt) {
		return this.#attemptSeq === attempt && this.#statusValue.state === "waiting";
	}
	/** 收掉本次尝试的痕迹：中止在途信号、kill 子进程（kill 已退出的进程是无害无操作）。 */
	#teardown() {
		this.#abort?.abort();
		this.#abort = void 0;
		const child = this.#child;
		this.#child = void 0;
		try {
			child?.kill();
		} catch {}
	}
};
/**
* 造一个 Open Design 网页登录端口（设备授权，只读本机登录产物）。
* @param deps - 落库回调与各个 I/O 注入点。
* @returns 登录端口。
*/
function createOpenDesignLogin(deps) {
	return new OpenDesignLoginFlow(deps);
}
/**
* 从一段文本里取出 JSON 负载：整体可解析就用整体，否则从后往前找第一条能解析的行
* （CLI 常在自己的日志之后再打 JSON）。
* @param text - 子进程输出。
* @returns 解析出来的值，或 `undefined`。
*/
function parseVelaJson(text) {
	const trimmed = stripAnsi(text).trim();
	if (trimmed === "") return void 0;
	try {
		return JSON.parse(trimmed);
	} catch {}
	const lines = trimmed.split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index].trim();
		if (!line.startsWith("{")) continue;
		try {
			return JSON.parse(line);
		} catch {}
	}
}
/** 收完一个子进程的输出（或到点就 kill 它）。 */
function collectVelaRun(child, timeoutMs) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				code,
				stdout,
				stderr
			});
		};
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {}
			finish(null);
		}, timeoutMs);
		timer.unref?.();
		child.stdout?.on("data", (chunk) => {
			stdout += textOfChunk(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += textOfChunk(chunk);
		});
		child.on("exit", (code) => finish(code));
		child.on("error", () => finish(null));
	});
}
/**
* 问本机 vela 要「当前工作区 id」。
*
* 为什么要问：`~/.amr/config.json` 的 profile **不一定**带 `workspaceId`（本机实测：只有两把
* 密钥与 user，没有工作区）。而周期额度（`billing preflight --workspace-id …`）必须有它 ——
* 没有工作区就是一条额度窗口都读不到，用户还得自己去找 id。`vela team-projects list` 会回
* `{ workspaceId, projects }`，那是 CLI 自己认的当前工作区，正好是这个值。
*
* 任何失败（找不到 vela、命令非零、输出不是 JSON）都读作「没发现」：这条路径是**锦上添花**，
* 不能因为它把登录判成失败。
* @param deps - 注入点（spawn / resolveVela / 预算）。
* @returns 工作区 id，或 `undefined`。
*/
async function discoverWorkspaceId(deps = {}) {
	const vela = await (deps.resolveVela ?? defaultResolveVela)();
	if (vela === void 0) return void 0;
	const spawn = deps.spawn ?? defaultSpawn;
	let child;
	try {
		child = spawn(vela, ["team-projects", "list"]);
	} catch {
		return;
	}
	const run = await collectVelaRun(child, deps.timeoutMs ?? 5e3);
	if (run.code !== 0) return void 0;
	const payload = parseVelaJson(run.stdout);
	if (!isRecord(payload)) return void 0;
	const workspaceId = normalizeKey(payload.workspaceId);
	return workspaceId === void 0 ? void 0 : workspaceId;
}
//#endregion
//#region src/vendors/opendesign/index.ts
/**
* Open Design 入口：一行装配（施工单 §2.8，逐句对照 `opencode/index.ts` 的顺序）。
*
* 厂商事实与命名见 `docs/vendors.md`：推理走
* `amr-link.open-design.ai`（OpenAI Chat Completions，runtime key），额度/账单走
* `amr-api.open-design.ai`（control key），周期额度（Coding Plan）走本机 `vela`。
*
* 与另两行的同构差异（都来自厂商事实，不是偏好）：
* - **两把密钥**：账号条目有 `apiKeyEnv`（推理）与可选的 `controlKeyEnv`（额度面）；
*   控制面槽缺省时派生为 `<ref>_CONTROL`（默认账号是 `OPENDESIGN_CONTROL_KEY`）。
*   `quota` 的密钥解析因此多走一层 {@link opendesignControlRef}。
* - **工作区**：账号条目（或顶层）的 `workspaceId` 是 vela 周期额度的查询参数；
*   没配就不查，也不记失败（`./quota` 的约定）。
* - **网页登录 = 设备授权**：由官方 `vela login` 完成（`./login`），成功产物
*   `~/.amr/config.json` 只读导入；找不到 vela 时给 `vela-missing` 的人话原因。
*
* `enabled` 门与 `loader/volatile-update` 重判、`session/event` 的回合结束门控、
* `credentials/reference-updated` 的拒绝记忆清除、`applyUsageRemote` 的远程面发布与
* `disableSettingsAutoForm` 都与另两行同一套（装配顺序逐句对照 opencode）。
* @module dsh-llm-account/src/vendors/opendesign/index
*/
/** 插件名（fiber 名与日志前缀；profile 行 id 由 patch 层给定，是 `opendesign`）。 */
const name = "llm-opendesign";
/** 本行需要的宿主服务：只声明 `llm`（设置与凭据按需现取，缺席时各自报错/降级）。 */
const inject = ["llm"];
/** provider 路由 id（施工单 §1，全局约束，不得更改）。 */
const PROVIDER_ID = "opendesign";
/** 意图日志在设置文档里的隐藏字段（与另两行同一个字段名）。 */
const INTENTS_FIELD = "accountIntents";
/**
* 设置行候选名（按优先级）：现代宿主按 profile 行 id 建索引，旧宿主用插件自报的命名空间。
* 行 id 必须排在前面（命中它就说明用户 patch 的那一行正在给本插件供配置）。
*/
const SETTINGS_ROWS = ["opendesign", OPENDESIGN_SETTINGS_NS];
/**
* 这一行的 Config：全部字段 volatile（改完立即生效、可经设置表单逐路径写入）。
*
* 账号条目比另两家多两个可选字段（`controlKeyEnv` 控制面密钥槽、`workspaceId` vela
* 工作区）；顶层 `walletBase` 与 `workspaceId` 是本行新增的可配置项（客户端
* 「高级设置」里暴露，`shell.ts` 的卡片声明与这里的字段一一对应）。
*
* 类型上显式标成「宿主要求的最小 Config 面」（{@link PluginConfigSchema}）：schemastery
* 的推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用（TS2883）。
*/
const Config = z.object(markVolatileFields({
	/** `false` 撤下本行的 provider 路由（行仍然挂载、其余产物照旧构造）。 */
	enabled: z.boolean().default(true),
	modelVisibility: z.dict(z.boolean().required()).default({}),
	visibleModels: z.array(z.string()),
	removedModels: z.array(z.string()),
	modelAccountRules: z.array(z.object({
		models: z.array(z.string()),
		account: z.string()
	})),
	/** 顶层**推理**密钥引用（当前账号）。 */
	apiKeyEnv: z.string().role("credential-ref").default(OPENDESIGN_DEFAULT_REF),
	accounts: z.union([z.const(null), z.array(z.object({
		id: z.string(),
		name: z.string(),
		apiKeyEnv: z.string().role("credential-ref"),
		controlKeyEnv: z.string().role("credential-ref"),
		workspaceId: z.string()
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
	* 侧边栏额度卡片开关（规格 §8.1：**默认关闭，关闭时不后台刷新**）。
	* 与另两行同一个字段名、同一个默认值（页面按厂商声明渲染同一个开关）。
	*/
	showSidebarQuota: z.boolean().default(false),
	/** 侧边栏额度卡片的刷新间隔（分钟）；缺省 1、下限 1、上限 120（与另两行同一档）。 */
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
	autoContinueMaxAttempts: z.number().step(1).min(1).max(20).default(3),
	autoContinueIntervalMs: z.number().step(100).min(500).max(6e4).default(2e3),
	searchStrategy: z.union([
		"gateway-first",
		"api-first",
		"gateway-only",
		"api-only",
		"off"
	]).default("gateway-first"),
	searchApiKeyRefs: z.array(z.string().role("credential-ref")).default(["DEEPSEEK_API_KEY"]),
	/** 顶层工作区（账号条目没配 `workspaceId` 时的回退；vela 周期额度用）。 */
	workspaceId: z.string().default(""),
	/** 推理网关基地址（Chat Completions）。 */
	baseURL: z.string().default(DEFAULT_BASE_URL),
	/** 额度/账单基地址（控制面）。 */
	walletBase: z.string().default(DEFAULT_WALLET_BASE_URL),
	requestTimeoutMs: z.number(),
	streamIdleTimeoutMs: z.number(),
	/**
	* 待清理凭据引用数组。删除账号只**记录**待清理的 ref（推理槽 + 控制面槽），
	* 真正 `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
	*/
	credentialCleanupRefs: z.array(z.string().role("credential-ref")),
	accountIntents: z.array(z.any()).hidden()
}));
/**
* 装一行 Open Design。
*
* 只做装配与注册，不做 I/O：请求路径上的读取（配置、凭据、环境）都是按需现取的函数。
* @param ctx - 宿主插件上下文。
* @param config - 宿主解析过的 Config，或程序化构造的原始配置（本函数自己过一遍 `Config`）。
* @returns 装配产物（宿主忽略；装配测试使用）。
*/
function apply(ctx, config) {
	const parsed = parseConfig(config);
	const document = () => unwrapVolatileConfig(parsed);
	const warn = (message) => {
		ctx.logger.warn(message);
	};
	const settings = createSettingsPort(ctx, OPENDESIGN_SETTINGS_NS, SETTINGS_ROWS);
	const credentials = createCredentialsPort(ctx);
	const intents = intentLogFor(OPENDESIGN_SETTINGS_NS, createSettingsIntentStore(settings, OPENDESIGN_SETTINGS_NS, INTENTS_FIELD, warn));
	/**
	* 账号端口外面包一层：**新增账号时自动补上 workspaceId**（需求
	* 「新增账户的时候要自动配置，不能通过你每次修改来配置才可以」）。
	*
	* 为什么必须自动：周期额度（5 小时 / 每周）只来自 `vela billing preflight`，而它需要
	* `workspaceId`。以前只有**网页登录**那条路会探一次工作区；手动填 API Key 添加的账号
	* 永远没有它 → 那部分额度永远不显示，只能靠手改配置。
	*
	* 两条纪律：
	* 1. **已经给了就不动**（`input.workspaceId` 显式优先）；
	* 2. **身份不一致就不写**：`vela team-projects list` 报的是**本机 vela 登录态**的工作区，
	*    把它写给另一个人的账号，后续 preflight 会拿那个工作区查 —— 虽然额度端口还有一道
	*    身份闸门兜着，但**在数据里写错的值本身就是错的**。所以先核对再写。
	*
	* 实现用**原型委托**而不是对象展开：`createOpenDesignAccounts` 返回的是类实例，
	* 方法在原型上，`{ ...base }` 只会拷到自有属性 —— 展开后 `list()` / `remove()` 全没了。
	*/
	const accountsBase = createOpenDesignAccounts({
		settings,
		credentials,
		intents
	});
	/**
	* 包一层只改写 `add`。
	*
	* 为什么用**实例自有的方法**覆盖，而不是 `{ ...base }` 或 `Object.create`：
	* - `{ ...base }` 只拷自有属性，原型上的方法全部丢失（`list()` / `remove()` 变成 undefined）；
	* - `Object.create(proto, desc)` 造出来的对象**不是这个类的实例**，类里用 `#deps` 私有字段的
	*   方法会抛 `Cannot read private member #deps from an object whose class did not declare it`。
	*
	* 实例自有属性优先于原型方法，且对象身份不变 —— 私有字段照常可用。
	*/
	const accounts = accountsBase;
	const baseAdd = accountsBase.add.bind(accountsBase);
	accounts.add = async (input) => {
		if (normalizeKey(input.workspaceId) !== void 0) return await baseAdd(input);
		const discovered = await discoverAccountWorkspace(input);
		return await baseAdd(discovered === void 0 ? input : {
			...input,
			workspaceId: discovered
		});
	};
	/**
	* 给**即将添加的账号**探一次工作区；只有确认是本机 vela 登录态那个人时才返回。
	* @param input - 待添加账号的输入（用它的密钥核对身份）。
	* @returns 工作区 id，或 `undefined`（不写）。
	*/
	async function discoverAccountWorkspace(input) {
		const workspaceId = await discoverWorkspaceId();
		if (workspaceId === void 0) return void 0;
		const accountId = await accountIdentityViaApi(normalizeKey(input.controlKey) ?? normalizeKey(input.key), normalizeKey(document().walletBase) ?? "https://amr-api.open-design.ai/api/v1");
		const velaId = await velaIdentityViaCli();
		if (accountId === void 0 || velaId === void 0 || accountId !== velaId) return void 0;
		return workspaceId;
	}
	const rotation = createRotationAccess(() => accountStateOf(document()));
	/**
	* 能力声明（规格 §7.3 的矩阵）：UI 据此隐藏或置灰控件。**唯一来源在宿主侧**，
	* 经远程 `status()` 发布给页面（客户端不各写一份，否则两边迟早不一致）。
	*
	* `quotaShape: "windows"`：本行的窗口带 `used`/`cap`（美元或百分比口径，`./quota`）；
	* `modelVisibilityWrite: "onSave"`：模型勾选经设置保存落库（与 commandcode 同一档）。
	*/
	const capabilities = {
		reorder: true,
		pin: true,
		browserLogin: true,
		modelAccountRules: true,
		quotaShape: "windows",
		modelVisibilityWrite: "onSave",
		automaticSwitch: true
	};
	/** 工作区发现的失败重试间隔（毫秒）：成功永久缓存，失败一分钟内不再问 vela。 */
	const WORKSPACE_DISCOVERY_RETRY_MS = 6e4;
	/**
	* 进程内的「发现到的工作区」缓存。
	*
	* 网页登录的产物**不带工作区**（本机实测 `~/.amr/config.json` 只有两把密钥与 user），
	* 而周期额度必须有它。所以读额度时缺省就问一次 `vela team-projects list`；成功一次就写回
	* 顶层设置并常驻，失败只缓存一分钟（用户可能刚装好 vela）。
	*/
	let discoveredWorkspace;
	/**
	* 取某账号的工作区：条目/顶层设置优先，缺省时用 vela 兜底发现并写回。
	* @param candidate - 账号 ref。
	* @returns 工作区 id，或 `undefined`（本机没有 vela / 没登录）。
	*/
	const workspaceFor = async (candidate) => {
		const stored = opendesignWorkspaceId(document(), candidate);
		if (stored !== void 0) return stored;
		if (discoveredWorkspace?.value !== void 0) return discoveredWorkspace.value;
		if (discoveredWorkspace !== void 0 && Date.now() - discoveredWorkspace.at < WORKSPACE_DISCOVERY_RETRY_MS) return;
		const found = await discoverWorkspaceId();
		discoveredWorkspace = {
			value: found,
			at: Date.now()
		};
		if (found !== void 0) await fillTopLevelWorkspace(found);
		return found;
	};
	/** 额度端口：每次读数都用当时的配置；`snapshot(ref)` 可读指定账号（切换策略用）。 */
	const quota = { async snapshot(accountRef) {
		const walletBase = normalizeKey(document().walletBase) ?? "https://amr-api.open-design.ai/api/v1";
		const ref = accountRef ?? selectedRefOf(document());
		return createOpenDesignQuota({
			ref: () => ref,
			resolveControlKey: async (candidate) => {
				const control = await resolveAccountKey(ctx, credentials, opendesignControlRef(document(), candidate));
				if (control !== void 0) return control;
				return resolveAccountKey(ctx, credentials, candidate);
			},
			/**
			* 告诉额度端口「这次拿到的是不是真正的控制面密钥」。
			*
			* 两种失败对用户的意义完全不同：
			* - 有 `vela_ctrl_…` 但被拒 = 密钥过期/无权限，**重登一次**应该能好；
			* - 只有 `sk-amr_…`（推理密钥回退）= 这个账号**从来没配过控制面密钥**，
			*   重试一百次也没用，必须走一次**网页登录**把这个账号的 `vela_ctrl_…` 导进来。
			*
			* 早先两种都只报「账单接口返回 HTTP 401」，用户看不出该做什么 —— 这正是
			* 「切到某个账号就看不到额度」最难自查的地方。
			*/
			controlKeyKind: async (candidate) => {
				if (await resolveAccountKey(ctx, credentials, opendesignControlRef(document(), candidate)) !== void 0) return "control";
				return await resolveAccountKey(ctx, credentials, candidate) === void 0 ? "none" : "inference-only";
			},
			workspaceIdOf: (candidate) => workspaceFor(candidate),
			fetchImpl: fetch,
			summaryFallback: velaSummary,
			walletBase,
			preflight: velaPreflight,
			preflightHttp: async (workspaceId, controlKey) => {
				const base = normalizeKey(document().walletBase) ?? "https://amr-api.open-design.ai/api/v1";
				const response = await fetch(`${base.replace(/\/+$/, "")}/workspaces/${encodeURIComponent(workspaceId)}/billing/preflight`, {
					headers: {
						Authorization: `Bearer ${controlKey}`,
						...IDENTITY_ENCODING_HEADER
					},
					signal: AbortSignal.timeout(VELA_PREFLIGHT_TIMEOUT_MS)
				});
				if (!response.ok) throw new Error(`HTTP 周期额度接口返回 ${response.status}`);
				return await response.json();
			},
			identitiesOf: async (ref) => {
				return identitiesFor(normalizeKey(await resolveAccountKey(ctx, credentials, opendesignControlRef(document(), ref))) ?? normalizeKey(await resolveAccountKey(ctx, credentials, ref)), normalizeKey(document().walletBase) ?? "https://amr-api.open-design.ai/api/v1");
			}
		}).snapshot();
	} };
	const switching = new SwitchingController({
		accounts,
		quota,
		rotation,
		document,
		pinnedRef: () => pinnedRefOf(document()),
		warn
	});
	/**
	* 把发现到的工作区补进**顶层**字段（账号条目，读不到时才写这里）。
	*
	* 只补空：用户已经填过（顶层或条目里）就不动 —— 覆盖别人显式配好的值比缺一个 id 更糟。
	* 失败只记一条警告：这是登录收尾的附加动作，失败不该把登录判成失败。
	* @param workspaceId - 发现到的工作区 id。
	*/
	const fillTopLevelWorkspace = async (workspaceId) => {
		if (normalizeKey(document().workspaceId) !== void 0) return;
		try {
			const snapshot = await settings.describe(OPENDESIGN_SETTINGS_NS);
			const stored = snapshot.value.workspaceId;
			if (typeof stored === "string" && stored.trim() !== "") return;
			await settings.mutate(OPENDESIGN_SETTINGS_NS, [{
				op: "set",
				path: ["workspaceId"],
				value: workspaceId
			}], snapshot.revision);
		} catch (error) {
			warn(`dsh-llm-account: could not store the discovered Open Design workspace id (${error instanceof Error ? error.message : String(error)})`);
		}
	};
	const login = createOpenDesignLogin({ storeKey: async (input) => {
		const workspaceId = input.workspaceId ?? await discoverWorkspaceId();
		const views = await accounts.list();
		const existing = views.find((view) => view.ref === input.ref) ?? views.find((view) => view.label === input.label);
		if (existing !== void 0) {
			await credentials.set(existing.ref, input.key);
			if (input.controlKey !== void 0) await credentials.set(opendesignControlRef(document(), existing.ref), input.controlKey);
			if (workspaceId !== void 0) await accounts.setWorkspace(existing.ref, workspaceId);
			return;
		}
		await accounts.add({
			label: input.label,
			key: input.key,
			...input.controlKey === void 0 ? {} : { controlKey: input.controlKey },
			...workspaceId === void 0 ? {} : { workspaceId }
		});
	} });
	ctx.effect(() => () => {
		login.cancel();
	}, "dsh-llm-account: opendesign login port");
	const adapter = createOpenDesignAdapter({
		config: () => adapterConfigOf(document()),
		get rotation() {
			return rotation.current();
		},
		quota,
		accounts,
		fetchImpl: fetch,
		resolveStored: (ref) => credentials.resolve(ref),
		resolveEnvironment: (ref) => environmentValue(ctx, ref),
		beforeRequest: (input) => switching.beforeRequest(input),
		usage: createUsagePort(),
		fallbackCandidates: () => modelCandidates(),
		autoSwitchModel: () => document()["autoSwitchModelOnQuota"] === true,
		resolveImage: (ref, signal) => readImageBytes(ctx, ref, signal)
	});
	registerCatalogSource({
		provider: "opendesign",
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
		stream: (options) => adapter.stream(options)
	});
	registerGatewayAccess(PROVIDER_ID, async () => {
		const doc = document();
		const baseURL = normalizeKey(doc.baseURL) ?? normalizeKey(doc.apiBase) ?? "https://amr-link.open-design.ai/v1";
		for (const ref of orderOf(doc)) {
			const key = await resolveAccountKey(ctx, credentials, ref);
			if (key !== void 0) return {
				baseURL,
				key
			};
		}
	});
	/**
	* 当前这次路由注册的句柄；`enabled: false` 时是 `undefined`（行仍然挂载）。
	*
	* 用「释放 + 重新注册」而不是 `handle.replace([])`：与另两行同一形状，也让
	* 撤下与 `ctx.effect` 的释放路径共用同一个句柄。
	*/
	let registration;
	/** 按**现读**的 `enabled` 校准路由：缺省（含非布尔值）读作启用，只有显式的 `false` 撤下。 */
	const applyRoute = () => {
		const enabled = document().enabled !== false;
		if (enabled && registration === void 0) registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter);
		else if (!enabled && registration !== void 0) {
			registration();
			registration = void 0;
			ctx.logger.info("llm-opendesign: disabled by configuration; the route and its models are withdrawn");
		}
	};
	applyRoute();
	/**
	* 搜索槽位同步（2026-10-28 补）：三家 provider 行都触发，`createSearchSlotSync`
	* 内部合并同拍调用。手改 profile 只动本行的 `searchStrategy` 时也要能同步槽位。
	*/
	const syncSearchSlot = createSearchSlotSync({
		settings,
		strategy: () => document()["searchStrategy"],
		warn
	});
	ctx.on("loader/volatile-update", () => {
		applyRoute();
		syncSearchSlot();
	});
	ctx.on("session/event", (...args) => switching.noteHostEvent(...args));
	ctx.effect(() => () => {
		registration?.();
		registration = void 0;
	}, "dsh-llm-account: opendesign provider route");
	ctx.on("credentials/reference-updated", (ref) => {
		rotation.clearCredentialRejection(ref);
	});
	applyUsageRemote(ctx, {
		vendor: PROVIDER_ID,
		credentials,
		rotation,
		accounts,
		quota,
		pinnedRef: () => pinnedRefOf(document()),
		quotaRef: () => selectedRefOf(document()),
		capabilities,
		login,
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
		setSwitchSettings: (input) => writeSwitchSettings(settings, OPENDESIGN_SETTINGS_NS, input),
		modelRules: () => modelRulesOf(document()),
		setAccountModels: (ref, models) => writeModelRules(settings, OPENDESIGN_SETTINGS_NS, assignModelsToAccount(modelRulesOf(document()), ref, models))
	});
	disableSettingsAutoForm(ctx, OPENDESIGN_SETTINGS_NS);
	return {
		providerId: PROVIDER_ID,
		settingsNs: OPENDESIGN_SETTINGS_NS,
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
* 当成普通值；程序化构造（装配测试）是普通值，必须自己过一遍 `Config`。
* @param config - `apply` 收到的原始配置。
* @returns 字段表（可能是 volatile 引用，也可能是普通值）。
*/
function parseConfig(config) {
	if (isParsedConfig(config)) return config;
	const parsed = Config(config);
	return isRecord$6(parsed) ? parsed : {};
}
/**
* 入口配置 → 适配器配置。
*
* 只有一处改名：文档字段是 `baseURL`（用户文档里就是它），适配器接口叫 `apiBase`。
* 模型可见性原样交给适配器（形状不可信，适配器自己收窄）。
*/
function adapterConfigOf(document) {
	const baseURL = normalizeKey(document.baseURL);
	const apiBase = normalizeKey(document.apiBase);
	const requestTimeoutMs = positiveNumber(document.requestTimeoutMs);
	const streamIdleTimeoutMs = positiveNumber(document.streamIdleTimeoutMs);
	const defaultMaxTokens = positiveNumber(document.defaultMaxTokens);
	const modelVisibility = booleanMap(document.modelVisibility);
	const visibleModels = stringList(document.visibleModels);
	return {
		...apiBase === void 0 ? {} : { apiBase },
		...baseURL === void 0 ? {} : { apiBase: baseURL },
		...requestTimeoutMs === void 0 ? {} : { requestTimeoutMs },
		...streamIdleTimeoutMs === void 0 ? {} : { streamIdleTimeoutMs },
		...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
		...modelVisibility === void 0 ? {} : { modelVisibility },
		...visibleModels === void 0 ? {} : { visibleModels }
	};
}
/** 读一个正有限数（缺省/0/负数/NaN 读作缺省，避免把坏配置变成「立即超时」）。 */
function positiveNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
/** 读一个字符串数组；非数组读作缺省，空数组保留（表示显式清空）。 */
function stringList(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}
/** 读一个 id → 布尔 的映射；非对象读作缺省，一个合法项都没有时也读作缺省。 */
function booleanMap(value) {
	if (!isRecord$6(value)) return void 0;
	const map = {};
	for (const [key, flag] of Object.entries(value)) if (typeof flag === "boolean") map[key] = flag;
	return Object.keys(map).length === 0 ? void 0 : map;
}
/** 按模型分配规则；形状不可信时逐条收窄。 */
function modelRulesOf(document) {
	const raw = document.modelAccountRules;
	if (!Array.isArray(raw)) return [];
	const rules = [];
	for (const item of raw) {
		if (!isRecord$6(item)) continue;
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
/** 账号库状态：顺序、按模型规则与固定账号（`autoSwitch: false` 时候选集只剩当前账号）。 */
function accountStateOf(document) {
	const slot = opendesignAccountSlot(document);
	return {
		order: document.autoSwitch === false ? [slot.ref] : orderOf(document),
		rules: modelRulesOf(document),
		pinned: slot.pinned
	};
}
/** 顶层当前账号的 ref：`apiKeyEnv` 是合法引用名时就是它，否则是内置默认名。 */
function defaultRefOf(document) {
	return opendesignAccountSlot(document).ref;
}
/** `accounts[].apiKeyEnv` 里合法的凭据引用名（合法名才可能是凭据槽；其余条目本期不支持）。 */
function accountRefsOf(document) {
	const accounts = document.accounts;
	if (!Array.isArray(accounts)) return [];
	const refs = [];
	for (const item of accounts) {
		if (!isRecord$6(item)) continue;
		const ref = normalizeKey(item.apiKeyEnv);
		if (ref !== void 0 && CREDENTIAL_REF_PATTERN.test(ref)) refs.push(ref);
	}
	return refs;
}
/**
* 轮换顺序 = 顶层当前账号 + `accounts` 条目（按文档顺序，去重保留第一次出现）。
*
* 顶层 `apiKeyEnv` **必须**进顺序：少了它，只配了顶层密钥的存量用户会让
* `RotationEngine.pick` 返回 `undefined`，适配器直接报 MISSING_CREDENTIAL。
*/
function orderOf(document) {
	const derived = [];
	const seen = /* @__PURE__ */ new Set();
	for (const ref of [defaultRefOf(document), ...accountRefsOf(document)]) {
		if (seen.has(ref)) continue;
		seen.add(ref);
		derived.push(ref);
	}
	return globalOrderOfVendor(derived, document.accountOrder, PROVIDER_ID);
}
/**
* 固定账号：顶层 `apiKeyEnv` 是合法引用名时就是它（`select` 写它，`move` 也把新队首写进去）；
* 字段缺失/空串/非法引用名一律读作自动轮换（判定在账号端口里，两边同一份答案）。
* @param document - 现读的设置文档。
* @returns 固定账号的 ref，或 `null`（自动轮换）。
*/
function pinnedRefOf(document) {
	return opendesignAccountSlot(document).pinned;
}
/** 额度读数报告的账号：固定账号优先，否则顺序里的第一个（下一个请求会用的那个）。 */
function selectedRefOf(document) {
	return pinnedRefOf(document) ?? orderOf(document)[0];
}
/**
* 解析某个账号这一读要用的密钥：按 `stored → environment` 挑第一把。
*
* Open Design 没有 auth.json 兜底（设计 §4.2 的差异表）：密钥只来自凭据库或启动环境。
* @param ctx - 插件上下文（读启动环境）。
* @param credentials - 凭据端口。
* @param ref - 目标账号的凭据引用名（调用方已把控制面槽解析好）。
* @returns 可用的密钥，或 `undefined`。
*/
async function resolveAccountKey(ctx, credentials, ref) {
	const stored = await credentials.resolve(ref);
	if (stored !== void 0) return stored;
	return environmentValue(ctx, ref);
}
/**
* vela 周期额度查询（Coding Plan）：`vela billing preflight --workspace-id <id> --format json`。
*
* 只在这个账号配了 `workspaceId` 时被调用（`./quota` 的门）；本机找不到 vela 时抛错，
* 由额度端口记成一句人话失败 —— 用户配了工作区却查不到，必须让他知道原因，而不是
* 静悄悄地少一个窗口。
* @param workspaceId - 该账号的工作区 id。
* @returns preflight 的 JSON 负载；输出不是对象时读作「没有数据」。
*/
async function velaPreflight(workspaceId) {
	if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(workspaceId)) throw new Error("工作区 id 形状不对（只允许字母、数字、下划线与连字符，且不能以连字符开头）");
	const vela = findVelaBinary();
	if (vela === void 0) throw new Error("本机找不到 vela：安装 Open Design 桌面端，或设置 VELA_BIN 指向 vela 可执行文件");
	const child = spawn(vela, [
		"billing",
		"preflight",
		"--workspace-id",
		workspaceId,
		"--format",
		"json"
	], {
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		windowsHide: true
	});
	const timer = setTimeout(() => {
		child.kill();
	}, VELA_PREFLIGHT_TIMEOUT_MS);
	try {
		const [stdout, code] = await Promise.all([readStream(child.stdout), waitForExit(child)]);
		if (code !== 0) throw new Error(`vela billing preflight 失败（退出码 ${code ?? "unknown"}）`);
		const parsed = JSON.parse(stdout);
		return isRecord$6(parsed) ? parsed : void 0;
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("vela billing preflight 的输出不是 JSON");
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
/**
* 核对「这个账号」与「本机 vela 登录态」是不是同一个人（多账号兼容的身份闸门）。
*
* 为什么必须核对（2026-10-20 用户提出的「一个网关多个账户」）：
*
* 1. `vela billing preflight` **没有 `--key` 参数** —— 它永远用本机 vela 登录态那份身份
*    去查额度。所以网关下挂了第二个人的账号时，采信它就是**显示别人的用量**。
* 2. `~/.amr/config.json` 是**单例文件**（只有 `profiles.prod`）：第二个账号走网页登录会
*    **覆盖**第一个。于是「vela 登录态 = 最后一次登录的账号」是常态，不能假设它等于当前账号。
*
* 两条身份来源：
* - 账号侧：用它自己的控制面密钥查 `GET /me` 的 `id`；
* - vela 侧：`vela whoami` 的输出里有 `ID: <id>`（实测第二行）。
*
* 任一读不到就缺字段，由调用方判成「不采信」—— 宁可没有这档数字，
* 也不显示一个可能属于别人的数字。
* @param key - 该账号的控制面密钥（装配层解析好传进来）。
* @param base - 控制面基地址。
* @returns 两侧的身份 id；任一缺失时对应字段为 `undefined`。
*/
async function identitiesFor(key, base) {
	const account = await accountIdentityViaApi(key, base);
	const vela = await velaIdentityViaCli();
	if (account === void 0 && vela === void 0) return void 0;
	return {
		...account === void 0 ? {} : { account },
		...vela === void 0 ? {} : { vela }
	};
}
/**
* 账号自己的控制面身份：`GET /me` 的 `id`。失败读作「不知道」。
* @param key - 该账号的控制面密钥（由装配层解析好传进来）。
* @param base - 控制面基地址。
* @returns 身份 id，或 `undefined`。
*/
async function accountIdentityViaApi(key, base) {
	if (key === void 0 || key === "") return void 0;
	try {
		const response = await fetch(`${base.replace(/\/+$/, "")}/me`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(VELA_PREFLIGHT_TIMEOUT_MS)
		});
		if (!response.ok) return void 0;
		const payload = await response.json();
		return isRecord$6(payload) ? normalizeKey(payload.id) : void 0;
	} catch {
		return;
	}
}
/** 本机 vela 登录态的身份：`vela whoami` 输出里 `ID: <id>` 那一行。失败读作「不知道」。 */
async function velaIdentityViaCli() {
	const vela = findVelaBinary();
	if (vela === void 0) return void 0;
	try {
		const child = spawn(vela, ["whoami"], {
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
		const timer = setTimeout(() => {
			child.kill();
		}, VELA_PREFLIGHT_TIMEOUT_MS);
		try {
			const [stdout, code] = await Promise.all([readStream(child.stdout), waitForExit(child)]);
			if (code !== 0) return void 0;
			const matched = /^ID:\s*(\S+)\s*$/m.exec(stdout);
			return matched === null ? void 0 : normalizeKey(matched[1]);
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return;
	}
}
/**
* vela 的账单摘要（`vela billing summary --format json`）：套餐、换算率与订阅周期。
*
* 为什么需要：控制面的 `GET /billing/summary` 在本机对 runtimeKey / controlKey 都回 403，
* 而同一份数据 CLI 能拿到。没有这条回退，界面上的套餐行永远是空的（实际情况「套餐信息也没有」）。
* 失败一律读作「没有数据」：这是**附加**来源，不能把额度读取整块拖垮。
* @returns 摘要负载；找不到 vela / 非零退出 / 输出不是 JSON 时为 `undefined`。
*/
async function velaSummary() {
	const vela = findVelaBinary();
	if (vela === void 0) return void 0;
	let child;
	try {
		child = spawn(vela, [
			"billing",
			"summary",
			"--format",
			"json"
		], {
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
	} catch {
		return;
	}
	const timer = setTimeout(() => child.kill(), VELA_PREFLIGHT_TIMEOUT_MS);
	try {
		const [stdout, code] = await Promise.all([readStream(child.stdout), waitForExit(child)]);
		if (code !== 0) return void 0;
		const parsed = JSON.parse(stdout);
		return isRecord$6(parsed) ? parsed : void 0;
	} catch {
		return;
	} finally {
		clearTimeout(timer);
	}
}
/** 读完一个输出流（`null` 流读作空串 —— 假 stdio 时可能没有管道）。 */
async function readStream(stream) {
	if (stream === null) return "";
	const chunks = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}
/** 等子进程退出；启动失败（`error` 事件）读作退出码 `null`。 */
function waitForExit(child) {
	return new Promise((resolve) => {
		child.on("exit", (code) => resolve(code));
		child.on("error", () => resolve(null));
	});
}
/**
* 从宿主的 **attachment 服务**取一张图片的编码字节。
*
* 为什么需要这一层：宿主的 `ImageBlock` 只带 durable ref（`attachmentId`），**不含字节**。
* 官方适配器（`dsh-llm-deepseek`）走的是同一条路：`ctx.get("attachments")` →
* `readImageRequest(ref, target, signal)` → 拿到 `{ data, mediaType, width, height }`。
*
* 三处刻意的保守：
* 1. **服务缺席就返回 `undefined`**（老宿主 / 附件插件未装）—— 图片降级成文字占位，
*    不抛错、不假装发出去；
* 2. **target 用宽高上限兜底**：拿不到原图尺寸时给一个足够大的目标，让附件服务自己按
*    编码器的最优质量档降采样（`maxBytes` 给 5MB，远高于任何网关的内联上限）；
* 3. 任何异常都吞掉并返回 `undefined`：一张图读失败不该让整次对话失败。
* @param ctx - 插件上下文（用来 `get("attachments")`）。
* @param ref - 宿主给的持久化图片引用。
* @param signal - 请求取消信号。
* @returns 编码后的字节与 MIME；拿不到时 `undefined`。
*/
async function readImageBytes(ctx, ref, signal) {
	try {
		const get = ctx.get;
		const attachments = typeof get === "function" ? get.call(ctx, "attachments") : void 0;
		if (!isRecord$6(attachments)) return void 0;
		const read = attachments.readImageRequest;
		if (typeof read !== "function") return void 0;
		const result = await read.call(attachments, ref, {
			width: 4096,
			height: 4096,
			maxBytes: 5242880
		}, signal);
		if (!isRecord$6(result)) return void 0;
		const data = result.data;
		const mediaType = result.mediaType;
		if (!(data instanceof Uint8Array) || typeof mediaType !== "string" || mediaType === "") return void 0;
		return {
			attachmentId: ref.attachmentId,
			data,
			mediaType
		};
	} catch {
		return;
	}
}
//#endregion
export { Config, PROVIDER_ID, apply, inject, name };
