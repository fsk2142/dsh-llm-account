/**
 * 断流与「协议正常结束」的区分（2026-11-12 审查 A03，用户选 A）。
 *
 * ## 用户定的方向
 *
 * > 半截断流（网关提前 EOF，没有 `finish_reason`）时，报**失败**而不是当成正常结束。
 *
 * 他要的是「更诚实、能触发续写」。旧行为是合成一条 `finish: stop` —— 界面看起来
 * 一切正常，而回答其实只写了一半，且**不会**触发任何续写/重试。
 *
 * ## 为什么不是直接抛错
 *
 * 抛错会让**已经流出去的半截文本**在界面上消失（宿主视这次 attempt 为失败、
 * 有的路径会回滚显示）。用户明确说「半截内容仍在对话里」是要保留的。
 *
 * 所以这里的做法是：**交出一条 `finish`，但它的 reason 是 `error`**。
 * 宿主拿到 `error` 会：
 * 1. 把这一轮标记为失败（不再假装成功）；
 * 2. 已经收到并渲染的正文仍然留在对话里；
 * 3. 走到失败分类/重试路径（是否重试由 code 决定）。
 *
 * ## 为什么用 `PROVIDER_STREAM_TRUNCATED` 这个码
 *
 * 它**不在**三家的 `RETRYABLE_CODES` 里 —— 这是有意的：
 *
 * - 半截回答**不能自动重放**（那会让已经执行的工具调用重跑一遍，等于重复副作用）；
 * - 用户要的是「看到失败 + 自己决定继续」，不是「悄悄重来一次」。
 *
 * 想看自动续写的场景（输出打到 `max_tokens`）由 `max-tokens` 那条既有路径负责，
 * 与这里无关。
 *
 * @module dsh-llm-account/src/core/stream-truncation
 */

import { LlmError } from "@deepseek-ai/dsh-llm";

/**
 * 「流被截断」的稳定错误码。
 *
 * 刻意**不加入**任何 `RETRYABLE_CODES`：理由见文件头（不能重放已产生的内容）。
 */
export const STREAM_TRUNCATED_CODE = "PROVIDER_STREAM_TRUNCATED";

/**
 * 截断时给用户看的那句话。
 *
 * 必须同时说清三件事：**发生了什么**、**已有的内容还算数**、**该怎么继续**。
 * 只写「连接中断」会让人以为要重新提问，而其实接着发「继续」就够。
 */
const TRUNCATED_MESSAGE =
  "the provider ended the stream without a terminal event, so this reply may be incomplete; " +
  "the text received so far is kept in the conversation. Send \"continue\" to resume";

/**
 * 造一条「流被截断」的 finish reason。
 *
 * @param vendor - 厂商名（只用于错误消息的可读性）。
 * @returns 可直接交给 `finish()` 的 reason。
 */
export function truncatedReason(vendor: string): {
  kind: "error";
  failure: { message: string; code: string };
} {
  void vendor;
  return {
    kind: "error",
    failure: { message: TRUNCATED_MESSAGE, code: STREAM_TRUNCATED_CODE },
  };
}

/**
 * 造一个可抛出的截断错误（给不走 finish 的路径用）。
 * @returns `LlmError`。
 */
export function truncatedError(): LlmError {
  return new LlmError(TRUNCATED_MESSAGE, STREAM_TRUNCATED_CODE);
}
