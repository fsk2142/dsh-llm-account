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
export class BodyTooLargeError extends Error {
  /**
   * @param limit - 上限（字节）。
   * @param received - 已知的字节数（读了这么多才发现超限，或 `Content-Length` 值）。
   */
  constructor(
    readonly limit: number,
    readonly received: number,
  ) {
    super(`response body exceeds the ${limit} byte limit (got at least ${received})`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * 读一段有界的响应文本。
 *
 * @param response - 已拿到响应头的响应。
 * @param limit - 允许的最大**UTF-8 字节**数。
 * @returns 正文文本（可能是空串）。
 * @throws {@link BodyTooLargeError} 超过上限时。抛出前已取消正文读取。
 */
export async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    // 头里就超了：不必读正文，但要释放连接。
    await cancelQuietly(response);
    throw new BodyTooLargeError(limit, declared);
  }

  if (response.body === null) {
    // 没有流（已在内存里的响应）：只能整段量，但**仍按字节**判。
    const text = await response.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > limit) throw new BodyTooLargeError(limit, bytes);
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done === true) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > limit) {
        // **立刻停**：超限之后不再索取任何 chunk。
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
 * 读一段有界的 JSON 正文。
 *
 * 空正文（或纯空白）返回 `undefined` —— OAuth 端点会用「空 400」表达 pending，
 * 那是**正常协议形态**而不是解析失败，所以这里不当作错误。
 * @param response - 已拿到响应头的响应。
 * @param limit - 允许的最大 UTF-8 字节数。
 * @returns 解析后的值；空正文或非法 JSON 时 `undefined`。
 * @throws {@link BodyTooLargeError} 超过上限时。
 */
/**
 * 一次有界 JSON 读取的**三态结论**。
 *
 * 为什么必须区分「空」与「非法」（2026-11-05 外部审查 F19）：
 *
 * OAuth 的 token 端点用**空正文 400** 表达 pending，那是正常协议形态，所以空正文
 * 要能兜底。但**非空的坏 JSON** 是另一回事 —— 那可能是 HTML 错误页、被代理改写的
 * 响应、或协议变更。上一版两者都返回 `undefined`，于是坏 JSON 也被当成
 * 「用户还没授权」，界面一直转圈到设备码过期。
 */
export type BoundedJsonResult =
  /** 正文为空（或纯空白）—— 按端点语义解释。 */
  | { kind: "empty" }
  /** 解析成功的 JSON。 */
  | { kind: "json"; value: unknown }
  /** 非空但解析不出来（HTML 错误页、被截断的正文…）。 */
  | { kind: "invalid" };

/**
 * 读一段有界的 JSON 正文，**保留「空」与「非法」的区别**。
 * @param response - 已拿到响应头的响应。
 * @param limit - 允许的最大 UTF-8 字节数。
 * @returns 三态结论。
 * @throws {@link BodyTooLargeError} 超过上限时。
 */
export async function readBoundedJsonResult(response: Response, limit: number): Promise<BoundedJsonResult> {
  const text = await readBoundedText(response, limit);
  if (text.trim() === "") return { kind: "empty" };
  try {
    return { kind: "json", value: JSON.parse(text) as unknown };
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
export async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const result = await readBoundedJsonResult(response, limit);
  return result.kind === "json" ? result.value : undefined;
}

/**
 * 尽力取消正文；失败不影响调用方的结论（连接可能已经关了）。
 * @param response - 要取消的响应。
 */
async function cancelQuietly(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 取消失败不影响结论。
  }
}
