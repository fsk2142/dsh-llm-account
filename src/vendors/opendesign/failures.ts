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
import { LlmError, isQuotaExceededError } from "@deepseek-ai/dsh-llm";

import type { FailureKind, Rejection } from "../../core/adapter";
import { rejection } from "../../core/failures";

/** 结构化词表：`error.type` / `error.code` 归一化后逐项比对。 */
const UNKNOWN_MODEL_TYPES: ReadonlySet<string> = new Set(["modelerror", "modelnotfound", "unknownmodel", "invalidmodel"]);

/** 额度用尽（OpenAI 系网关的两种常见拼法 + 余额不足）。 */
const QUOTA_TYPES: ReadonlySet<string> = new Set([
  "insufficientquota",
  "quotaexceeded",
  "insufficientcredits",
  "creditsexhausted",
  "outofcredits",
  "insufficientbalance",
  "nobalance",
]);

/** 密钥/登录失效（401 的结构化写法）。 */
const INVALID_CREDENTIAL_TYPES: ReadonlySet<string> = new Set([
  "autherror",
  "authenticationerror",
  "invalidapikey",
  "invalidkey",
  "expiredtoken",
  "tokenexpired",
  "loginrequired",
  "unauthenticated",
]);

/** 上游拒绝 / 地域 / 权限闸门：同一账号换 key 也过不去，归 `unavailable`。 */
const UNAVAILABLE_TYPES: ReadonlySet<string> = new Set([
  "upstreamerror",
  "upstreamfailure",
  "upstreamrefusal",
  "regionerror",
  "datapolicyerror",
  "permissionerror",
  "permissiondenied",
  "accountdisabled",
  "accountsuspended",
]);

/** 限流。 */
const RATE_LIMIT_TYPES: ReadonlySet<string> = new Set(["ratelimiterror", "ratelimitexceeded", "toomanyrequests"]);

/** 401 文案里点名登录/密钥失效。 */
const INVALID_KEY_PROSE = /(?:invalid|incorrect|expired|revoked)[ _-]?(?:api[ _-]?)?key|invalid credential|login (?:has )?expired|token (?:has )?expired|not (?:logged|signed) in/i;

/**
 * 没有 HTTP 状态时的文案判据。这张表存在的理由与其它厂商一致：**「认不出来」不等于
 * 「网络抖动」** —— 只有文案真的像传输问题（`network` / `connection` / `socket` / `fetch` /
 * `ECONN*` / `premature close` / 流提前结束…）才当瞬时故障；认不出来的确定性命终态返回
 * `undefined`，既不换账号重放、也不该被宿主重试。
 */
const IN_BAND_RULES: readonly { readonly pattern: RegExp; readonly kind: FailureKind | undefined }[] = [
  { pattern: /\b401\b|unauthori[sz]ed/i, kind: "invalid-credential" },
  { pattern: /\b40[23]\b|forbidden|upstream (?:refused|rejected)/i, kind: "unavailable" },
  { pattern: /\b429\b|rate.?limit/i, kind: "rate-limit" },
  {
    pattern: /\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i,
    kind: undefined,
  },
  { pattern: /\b400\b|invalid.?request/i, kind: undefined },
  { pattern: /\b5\d\d\b/, kind: "server" },
  { pattern: /\btime(?:d)?\s*out\b|timeout/i, kind: "network" },
  { pattern: /stream ended (?:before|without)\b/i, kind: "network" },
  { pattern: /\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i, kind: "network" },
  { pattern: /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i, kind: "network" },
  { pattern: /\bterminated\b|premature close/i, kind: "network" },
];

/** 正文里的诊断字段（嵌套一层 `error` 与平铺两种形状都支持）。 */
interface GatewayError {
  /** 结构化类型（`error.type`）。 */
  type?: string;
  /** 结构化码（`error.code`）。 */
  code?: string;
  /** 面向人的说明。 */
  message?: string;
  /** 归一化后的类型词表（`type` 与 `code` 都折进来，去除非字母数字后小写）。 */
  types: string[];
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取非空字符串字段。 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * 归一化一份错误正文。
 * @param body - 已解析的正文，或原始文本。
 * @returns 诊断字段与归一化词表。
 */
function readGatewayError(body: unknown): GatewayError {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = undefined;
    }
  }
  const root = isRecord(parsed) ? parsed : undefined;
  const nested = root !== undefined && isRecord(root.error) ? root.error : undefined;
  const source = nested ?? root;
  if (source === undefined) return { types: [] };
  const type = stringValue(source.type);
  const code = stringValue(source.code);
  const message = stringValue(source.message);
  const types = [type, code]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase());
  return {
    ...(type === undefined ? {} : { type }),
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    types,
  };
}

/** 原始正文的文本形态（类型词表全不命中时，状态回落与文案匹配都在它上面做）。 */
function rawTextOf(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === undefined || body === null) return "";
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
export function classifyOpenDesignFailure(status: number, body: unknown): Rejection | undefined {
  const parsed = readGatewayError(body);
  const rawText = rawTextOf(body);
  const message = parsed.message ?? rawText;
  const has = (set: ReadonlySet<string>): boolean => parsed.types.some((type) => set.has(type));

  if (has(UNKNOWN_MODEL_TYPES)) {
    return undefined;
  }
  if (has(QUOTA_TYPES)) {
    return rejection("quota", `Open Design 拒绝了本次请求（${parsed.type ?? parsed.code ?? "quota"}）：该账号的额度已用尽`);
  }
  if (has(INVALID_CREDENTIAL_TYPES)) {
    return rejection("invalid-credential", "Open Design 返回鉴权失败：该账号的登录已过期，请重新登录或更换密钥");
  }
  if (has(UNAVAILABLE_TYPES)) {
    return rejection("unavailable", `Open Design 拒绝了本次请求（${parsed.type ?? parsed.code ?? "upstream"}）：上游拒绝了这次请求`);
  }
  if (has(RATE_LIMIT_TYPES)) {
    return rejection("rate-limit", "Open Design 返回限流：当前账号被限流，未公布重置时间，按短冷却处理");
  }

  if (status <= 0) {
    // 流中途的事件或传输失败：事件里没有状态，只能靠文案定类。
    if (isQuotaExceededError(message)) {
      return rejection("quota", `Open Design 请求失败：${message}`);
    }
    if (INVALID_KEY_PROSE.test(message)) {
      return rejection("invalid-credential", `Open Design 请求失败：${message}`);
    }
    const rule = IN_BAND_RULES.find((entry) => entry.pattern.test(message));
    if (rule === undefined) {
      // 认不出来的流内失败 = 确定性的终态：既不当账号级失败换号重放，也不该被宿主重试。
      return undefined;
    }
    if (rule.kind === undefined) return undefined;
    if (rule.kind === "network") {
      const detail = message === "" ? "连接失败（网络或代理问题）" : message;
      return rejection("network", `Open Design 请求未获得响应：${detail}，已按瞬时故障处理`);
    }
    return rejection(rule.kind, `Open Design 流内失败（${rule.kind}）：${message}`);
  }

  if ([401, 402, 403, 429].includes(status) && isQuotaExceededError(message)) {
    return rejection("quota", `Open Design 返回 HTTP ${status}：该账号的额度已用尽`);
  }
  if (status === 401) {
    // 厂商事实：401 = 登录过期（凭据问题）。若正文点名配额已在上一条分支处理。
    return rejection("invalid-credential", "Open Design 返回 401：该账号的登录已过期，请重新登录或更换密钥");
  }
  if (status === 402 || status === 403) {
    // 402 是**上游拒绝**：绝不归因成密钥失效（计划 §0 的明确要求）。
    return rejection("unavailable", `Open Design 返回 HTTP ${status}：上游拒绝了这次请求（不是密钥过期）`);
  }
  if (status === 404) {
    // 模型不存在：请求级，不该在账号池里走一遍。
    return undefined;
  }
  if (status === 429) {
    return rejection("rate-limit", "Open Design 返回 429：当前账号被限流，未公布重置时间，按短冷却处理");
  }
  if (status === 408 || status === 504 || status >= 500) {
    return rejection("server", `Open Design 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
  }
  if (status === 400 || status === 413 || status === 422) {
    // 请求本身被拒（包括上下文超限）：换账号不可能改变结果。
    return undefined;
  }
  return undefined;
}

/** 分类到宿主错误码的映射（与另两家适配器共用一套词汇表）。 */
const FAILURE_CODES: Readonly<Record<FailureKind, string>> = {
  quota: "QUOTA",
  "rate-limit": "RATE_LIMIT",
  "invalid-credential": "INVALID_CREDENTIAL",
  unavailable: "PROVIDER_HTTP_ERROR",
  server: "SERVER",
  network: "TRANSPORT",
};

/**
 * 把一次拒绝翻译成宿主认识的 `LlmError`（保留原始 HTTP 状态与 cause）。
 * @param value - 已分类的拒绝。
 * @param status - 观察到的 HTTP 状态；未拿到响应时省略。
 * @param cause - 原始异常（诊断用）。
 * @returns 带稳定 `code` 的宿主错误。
 */
export function openDesignLlmError(value: Rejection, status?: number, cause?: unknown): LlmError {
  const options = {
    ...(status !== undefined && status > 0 ? { status } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
  return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
