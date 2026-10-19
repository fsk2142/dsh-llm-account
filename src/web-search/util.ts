/**
 * web-search 模块内部的小工具：形状收窄、字段读取与取消错误的统一形状。
 *
 * 这里刻意**不依赖** `../vendors/assembly`（那个模块拖着重装配）：本目录里只有
 * `support.ts` 会进客户端 bundle，其余文件都只在服务端使用，保持依赖窄。
 * @module dsh-llm-account/src/web-search/util
 */
import { WebError } from "./web-error";

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取字符串字段：非字符串（含缺席）一律 `undefined`；**空串保留**（「显式留空」有含义，
 * 例如 `authScheme: ""` 表示裸密钥值）。
 * @param source - 来源记录。
 * @param key - 字段名。
 * @returns 字符串，或 `undefined`。
 */
export function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 在一组候选字段里取首个非空字符串。
 * @param source - 来源记录；不是记录时返回 `undefined`。
 * @param keys - 候选字段名，按优先级排列。
 * @returns 首个非空字符串，或 `undefined`。
 */
export function firstString(source: unknown, keys: readonly string[]): string | undefined {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    const value = stringField(source, key);
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

/**
 * 取消：与宿主同码（`WEB_ABORTED`），保留调用方的取消原因。
 * @param signal - 调用方的取消信号。
 * @param cause - 备用的原因（信号没有 reason 时用）。
 * @returns 取消错误。
 */
export function abortedError(signal: AbortSignal | undefined, cause?: unknown): WebError {
  return new WebError("the web search was aborted", "WEB_ABORTED", {
    cause: signal?.aborted === true ? signal.reason : cause,
  });
}

/**
 * 已在取消态就直接抛（不发起已经没意义的请求）。
 * @param signal - 调用方的取消信号。
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortedError(signal);
}

/**
 * 判定 fetch / `AbortSignal` 的取消错误（宿主实现同判据）。
 * @param error - 捕获到的错误。
 * @returns 是否为取消错误。
 */
export function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}
