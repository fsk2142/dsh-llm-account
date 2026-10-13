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
import { LlmError, isQuotaExceededError } from "@deepseek-ai/dsh-llm";

import type { FailureKind, Rejection } from "../../core/adapter";
import { rejection } from "../../core/failures";

/** 结构化词表：`error.type` / `error.code` 归一化后逐项比对（旧插件第 7046-7057 行）。 */
const UNKNOWN_MODEL_TYPES: ReadonlySet<string> = new Set(["modelerror", "modelnotfound", "unknownmodel"]);

/** 额度用尽（旧插件第 7047-7054 行）。 */
const QUOTA_TYPES: ReadonlySet<string> = new Set([
  "creditserror",
  "monthlylimiterror",
  "userlimiterror",
  "gousagelimiterror",
  "insufficientquota",
  "quotaexceeded",
]);

/** 密钥失效（旧插件第 7055 行）。 */
const INVALID_CREDENTIAL_TYPES: ReadonlySet<string> = new Set([
  "autherror",
  "authenticationerror",
  "invalidapikey",
  "invalidkey",
]);

/** 地域/数据政策/权限闸门（旧插件第 7056 行的 `AUTH`）：同一账号换 key 也过不去，归 `unavailable`。 */
const UNAVAILABLE_TYPES: ReadonlySet<string> = new Set([
  "regionerror",
  "datapolicyerror",
  "permissionerror",
  "permissiondenied",
]);

/** 限流（旧插件第 7057 行）。 */
const RATE_LIMIT_TYPES: ReadonlySet<string> = new Set(["ratelimiterror", "ratelimitexceeded"]);

/** 401/403 文案里点名密钥失效（旧插件第 7060 行）。 */
const INVALID_KEY_PROSE = /(?:invalid|incorrect|expired)[ _-]?(?:api[ _-]?)?key|invalid credential/i;

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
 * 归一化一份错误正文（旧插件第 7039-7045 行）。
 *
 * 旧插件拿到的是**原始响应文本**，先 `JSON.parse`，失败就什么都不认；成功时优先取
 * 嵌套的 `error` 对象，没有则把根对象当错误对象。类型词表由 `type` 与 `code` 各取一个，
 * 去掉所有非字母数字字符再小写（`insufficient_quota` 与 `InsufficientQuota` 折成同一个
 * `insufficientquota`）。
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
 * opencode 状态/正文 → 统一失败分类（旧插件 `classifyGatewayError` 第 7038-7069 行）。
 *
 * 口径（顺序即优先级）：
 * - 词表命中模型不存在 → `undefined`：请求级，换账号没有意义；
 * - 词表命中 {@link QUOTA_TYPES} → `quota`；{@link INVALID_CREDENTIAL_TYPES} → `invalid-credential`；
 *   {@link UNAVAILABLE_TYPES} → `unavailable`；{@link RATE_LIMIT_TYPES} → `rate-limit`；
 * - 未拿到响应（`status <= 0`）→ 先看文案是否点名配额/密钥失效/限流，否则 `network`；
 * - 401/402/403/429 且文案像配额用尽 → `quota`；401/403 且文案点名密钥失效 → `invalid-credential`；
 * - 401/402/403 → `unavailable`；404 → `undefined`；429 → `rate-limit`；
 * - 408/504 与 5xx → `server`（瞬时，不污染账号状态）；
 * - 400/413/422 → `undefined`（请求本身被拒）；
 * - 其余 → `undefined`。
 * @param status - HTTP 状态码；`0` 表示没拿到响应（流中途事件或传输失败）。
 * @param body - 已解析的响应正文，或原始文本。
 * @returns 账号级失败分类；请求级（不可轮换）拒绝时为 `undefined`。
 */
export function classifyGatewayFailure(status: number, body: unknown): Rejection | undefined {
  const parsed = readGatewayError(body);
  const rawText = rawTextOf(body);
  const message = parsed.message ?? rawText;
  const has = (set: ReadonlySet<string>): boolean => parsed.types.some((type) => set.has(type));

  if (has(UNKNOWN_MODEL_TYPES)) {
    return undefined;
  }
  if (has(QUOTA_TYPES)) {
    return rejection("quota", `opencode 拒绝了本次请求（${parsed.type ?? parsed.code ?? "quota"}）：该账号的额度已用尽`);
  }
  if (has(INVALID_CREDENTIAL_TYPES)) {
    return rejection("invalid-credential", "opencode 返回鉴权失败：该账号的 API 密钥缺失或无效，请重新登录或更换密钥");
  }
  if (has(UNAVAILABLE_TYPES)) {
    return rejection("unavailable", `opencode 拒绝了本次请求（${parsed.type ?? parsed.code ?? "auth"}）：该账号在当前地域或政策下无法服务这个模型`);
  }
  if (has(RATE_LIMIT_TYPES)) {
    return rejection("rate-limit", "opencode 返回限流：当前账号被限流，未公布重置时间，按短冷却处理");
  }

  if (status <= 0) {
    // 流中途的事件或传输失败：事件里没有状态，只能靠文案判一判，否则按网络抖动。
    if (isQuotaExceededError(message) || /quota|credit/i.test(message)) {
      return rejection("quota", `opencode 请求失败：${message}`);
    }
    if (INVALID_KEY_PROSE.test(message)) {
      return rejection("invalid-credential", `opencode 请求失败：${message}`);
    }
    if (/rate.?limit|\b429\b/i.test(message)) {
      return rejection("rate-limit", `opencode 请求失败：${message}，未公布重置时间，按短冷却处理`);
    }
    return rejection("network", `opencode 请求未获得响应：${message === "" ? "连接失败（网络或代理问题）" : message}，已按瞬时故障处理`);
  }

  if ([401, 402, 403, 429].includes(status) && isQuotaExceededError(message)) {
    return rejection("quota", `opencode 返回 HTTP ${status}：该账号的额度已用尽`);
  }
  if ((status === 401 || status === 403) && INVALID_KEY_PROSE.test(message)) {
    return rejection("invalid-credential", "opencode 返回 401/403：该账号的 API 密钥缺失或无效，请重新登录或更换密钥");
  }
  if (status === 401 || status === 402 || status === 403) {
    return rejection("unavailable", `opencode 返回 HTTP ${status}：该账号无法完成这次请求（地域、数据政策或账号权限）`);
  }
  if (status === 404) {
    // 模型不存在：请求级，不该在账号池里走一遍。
    return undefined;
  }
  if (status === 429) {
    return rejection("rate-limit", "opencode 返回 429：当前账号被限流，未公布重置时间，按短冷却处理");
  }
  if (status === 408 || status === 504 || status >= 500) {
    return rejection("server", `opencode 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
  }
  if (status === 400 || status === 413 || status === 422) {
    // 请求本身被拒（包括上下文超限）：换账号不可能改变结果。
    return undefined;
  }
  return undefined;
}

/**
 * 分类到宿主错误码的映射（与 commandcode 适配器共用一套词汇表）。dsh-llm-retry 只按
 * 错误码决定重试，所以瞬时/可恢复的分类必须落在 `providerRetryPolicy` 的白名单里。
 */
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
export function gatewayLlmError(value: Rejection, status?: number, cause?: unknown): LlmError {
  const options = {
    ...(status !== undefined && status > 0 ? { status } : {}),
    ...(cause === undefined ? {} : { cause }),
  };
  return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
