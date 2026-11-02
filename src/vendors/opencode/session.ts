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
import { randomUUID } from "node:crypto";

/** 请求头名字（与网关要求一致）。 */
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

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
export function opencodeSessionHeaders(sessionId?: string): Record<string, string> {
  const raw = typeof sessionId === "string" ? sessionId.trim() : "";
  const safe = raw.replace(/[^A-Za-z0-9._-]/gu, "");
  return { [OPENCODE_SESSION_HEADER]: safe.length > 0 ? safe : PROCESS_SESSION_ID };
}
