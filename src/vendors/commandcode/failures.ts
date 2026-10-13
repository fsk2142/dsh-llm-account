/**
 * Command Code 原始失败到统一分类的映射表。
 *
 * 本模块是纯函数：只读入 HTTP 状态与已解析的错误正文，产出一个 {@link Rejection}；
 * 不做 I/O、不持有状态、不认识账号。分类口径逐条对照旧插件
 * `@mars-sea/dsh-commandcode-provider/lib/index.js` 的 `classifyAccountRejection`
 * （第 3720-3735 行）、`readWindowLimitEvidence`（第 3753-3766 行）与
 * `httpErrorCode`（第 3652-3657 行）：只有**账号级**失败才返回 Rejection
 * （调用方据此换账号），请求本身被拒（400/403/404/409/422 的通用拒绝）返回
 * `undefined`，避免把一个畸形请求在账号池里走一遍。
 * @module dsh-llm-account/src/vendors/commandcode/failures
 */
import { LlmError } from "@deepseek-ai/dsh-llm";

import type { FailureKind, Rejection } from "../../core/adapter";
import { rejection } from "../../core/failures";

/**
 * 与状态无关的「本账号无法服务这次请求」结构化码（旧插件第 3714-3719 行）。
 *
 * 刻意不按状态过滤：5xx 携带这些码时同样要换账号而不是当瞬时故障重试，
 * 因为同一个账号的同一个请求不可能成功。
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "USAGE_EXCEEDED",
  "INSUFFICIENT_CREDITS",
  "PREMIUM_CREDITS_EXHAUSTED",
  "MODEL_NOT_IN_PLAN",
]);

/**
 * 旧插件在第 3733-3734 行对 4xx 正文做的散文扫描（下划线折成空格后小写匹配）。
 * 供应商有时把结构化码写进人话里，只认码会漏判。
 */
const UNAVAILABLE_PROSE: readonly RegExp[] = [
  /insufficient credits/,
  /premium credits exhausted/,
  /model not in plan/,
  /insufficient (credit|balance)/,
  /out of credit/,
  /not (available|included)[^.]{0,40}plan/,
  /upgrade your plan/,
];

/**
 * 正文里公布的重置时刻最多允许领先当前时刻多久。
 *
 * 只用于**从错误文案里推断**出来的 ISO 时间戳（`resets at <ISO>`）：这类推断最容易
 * 因为一段无关文本命中年份数字而得出荒谬的远期时间。供应商在
 * `error.rateLimit.reset` 里显式公布的秒数原样采信（旧插件第 3756-3761 行）。
 */
const MAX_STAMP_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

/** 从错误正文里读出的诊断字段（嵌套一层 `error` 与平铺两种形状都支持）。 */
interface ProviderError {
  /** 结构化机器码（`error.code`）。 */
  code?: string;
  /** 结构化类型（`error.type`），旧插件把两者当同一个分类信号。 */
  type?: string;
  /** 面向人的说明。 */
  message?: string;
  /** 窗口证据（`error.rateLimit`）。 */
  rateLimit?: Record<string, unknown>;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取非空字符串字段。 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 读取有限数字字段。 */
function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 归一化一份错误正文：优先读嵌套的 `error` 对象，没有则把正文本身当错误对象
 * （旧插件 `parseProviderError` 第 3577-3597 行的 same-shape 读取）。
 * @param body - 已解析（或字符串）的响应正文。
 * @returns 诊断字段；无法识别时为 `{}`。
 */
function readProviderError(body: unknown): ProviderError {
  const root = isRecord(body) ? body : undefined;
  const nested = root !== undefined && isRecord(root.error) ? root.error : undefined;
  const source = nested ?? root;
  if (source === undefined) return {};
  const result: ProviderError = {};
  const code = stringValue(source.code);
  const type = stringValue(source.type);
  const message = stringValue(source.message);
  if (code !== undefined) result.code = code;
  if (type !== undefined) result.type = type;
  if (message !== undefined) result.message = message;
  if (isRecord(source.rateLimit)) result.rateLimit = source.rateLimit;
  return result;
}

/**
 * 读窗口证据并算出重置时刻。
 *
 * 只有正文**点名窗口**（`error.rateLimit.window` 为 `fiveHour`/`weekly`/`daily`，
 * 或文案写着 "usage limit for your plan"）才算「用量窗口用尽」；裸 429 是突发限流器
 * 或消费上限，调用方不该据此宣称某个窗口用尽（旧插件第 3737-3766 行）。
 * @param parsed - 已归一化的错误字段。
 * @returns 窗口名（未被点名时为 `undefined`）与重置时刻（epoch 毫秒）。
 */
function readWindowLimitEvidence(parsed: ProviderError): { window?: string; resetAt?: number } {
  const named = stringValue(parsed.rateLimit?.window);
  const message = parsed.message ?? "";
  const seconds = numberValue(parsed.rateLimit?.reset);
  const window =
    named === "fiveHour" || named === "weekly" || named === "daily"
      ? named
      : /usage limit for your plan/i.test(message)
        ? /weekly/i.test(message)
          ? "weekly"
          : "fiveHour"
        : undefined;

  // 供应商显式公布的秒数原样采信（单位是秒，×1000 转 epoch 毫秒）。
  const published = seconds !== undefined && seconds > 0 ? Math.round(seconds * 1000) : undefined;
  if (published !== undefined && Number.isFinite(published)) return { window, resetAt: published };

  // 退回到文案里的 `resets at <ISO>` 时间戳；推断出来的时间戳必须落在 30 天内。
  const stamp = /resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(message)?.[1];
  if (stamp === undefined) return { window };
  const parsedStamp = Date.parse(stamp);
  if (Number.isNaN(parsedStamp) || parsedStamp - Date.now() > MAX_STAMP_AHEAD_MS) return { window };
  return { window, resetAt: parsedStamp };
}

/**
 * Command Code 状态/正文 → 统一失败分类（Task 5 的 {@link Rejection}）。
 *
 * 口径（与旧插件逐条对照）：
 * - `status <= 0`：请求根本没拿到响应（连接失败、DNS、代理）→ `network`。
 * - 401 → `invalid-credential`（该账号退出轮换，只有换 key 能清除）。
 * - 429 或码 `RATE_LIMITED` → `rate-limit`；正文点名窗口且给出重置时刻时带上 `resetAt`。
 * - 码落在 {@link UNAVAILABLE_CODES} → `unavailable`（不按状态过滤）。
 * - 4xx 正文命中散文表 → `unavailable`。
 * - 408 / 5xx → `server`（瞬时，不污染账号状态）。
 * - 其余 4xx → `undefined`：请求本身被拒，换账号没有意义。
 * @param status - HTTP 状态码；`0`（或负数）表示未拿到响应。
 * @param body - 已解析的响应正文，或原始文本。
 * @returns 账号级失败分类；请求级（不可轮换）拒绝时为 `undefined`。
 */
export function classifyCommandCodeFailure(status: number, body: unknown): Rejection | undefined {
  const parsed = readProviderError(body);
  const code = (parsed.code ?? parsed.type)?.toUpperCase();

  if (status <= 0 && code === undefined) {
    return rejection("network", `Command Code 请求未获得响应：${parsed.message ?? "连接失败（网络或代理问题）"}，已按瞬时故障处理`);
  }
  if (status === 429 || code === "RATE_LIMITED") {
    const evidence = readWindowLimitEvidence(parsed);
    const detail = evidence.window === undefined ? "服务商未报告用量窗口用尽" : `用量窗口 ${evidence.window} 已用尽`;
    const when = evidence.resetAt === undefined ? "，服务商未公布重置时间" : `，重置时间 ${new Date(evidence.resetAt).toISOString()}`;
    return rejection("rate-limit", `Command Code 返回 429：当前账号被限流（${detail}）${when}`, evidence.resetAt);
  }
  if (status === 401) {
    return rejection("invalid-credential", `Command Code 返回 401：该账号的 API 密钥缺失或无效，请重新登录或更换密钥`);
  }
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) {
    return rejection("unavailable", `Command Code 拒绝了本次请求（${code}）：该账号的余额或套餐无法服务这个模型`);
  }
  if (status <= 0) {
    // 流中途的事件带了码但没带状态：仍是传输级失败，按瞬时故障处理。
    return rejection("network", `Command Code 请求未获得响应（${code ?? "未知码"}），已按瞬时故障处理`);
  }
  if (status >= 400 && status < 500) {
    const lower = (parsed.message ?? "").toLowerCase().replaceAll("_", " ");
    if (UNAVAILABLE_PROSE.some((pattern) => pattern.test(lower))) {
      return rejection("unavailable", `Command Code 拒绝了本次请求（HTTP ${status}）：该账号的余额或套餐无法服务这个模型`);
    }
    return undefined;
  }
  if (status === 408 || status >= 500) {
    return rejection("server", `Command Code 上游暂时无法完成请求（HTTP ${status}），已按瞬时故障处理`);
  }
  return undefined;
}

/**
 * 分类到宿主错误码的映射。dsh-llm-retry 只按错误码（不按状态）决定重试，
 * 所以这里必须让瞬时/可恢复的分类落在重试白名单里（见 `adapter.providerRetryPolicy`）。
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
 * @param cause - 原始异常（网络异常时保留，便于诊断）。
 * @returns 带稳定 `code` 的宿主错误。
 */
export function commandCodeLlmError(value: Rejection, status?: number, cause?: unknown): LlmError {
  const options = {
    ...(status !== undefined && status > 0 ? { status } : {}),
    ...(cause !== undefined ? { cause } : {}),
  };
  return new LlmError(value.message, FAILURE_CODES[value.kind], options);
}
