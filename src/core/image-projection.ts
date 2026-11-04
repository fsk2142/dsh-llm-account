/**
 * 图片投影：把宿主的 `ImageBlock` 变成**各协议能发包的形状**（2026-11-04 外部审查 U07）。
 *
 * ## 为什么要有这个模块
 *
 * 审查确认：
 *
 * > 目录宣称image能力，混图出站只剩文字，纯图可变为空消息；流仍正常完成，
 * > 用户无法知道模型没收到图。
 *
 * 根因是两处叠加：opencode / commandcode 的协议层只调 `textOf(content)` 取文本，
 * 而它们的 adapter 连取字节的 `resolveImage` 依赖都没有 —— 只有 Open Design 接了。
 * 于是「勾选了识图模型、发了图、模型什么也没看到」，且**没有任何报错**。
 *
 * 把「取字节」与「投影成协议形状」放进 core，三家共用同一份，避免再次各写一半。
 *
 * ## 取不到字节时的行为
 *
 * **降级成文字占位，绝不静默丢弃**：用户至少能从模型反应／请求正文里看出「这里本该有图」。
 * 这与宿主 `textOnlyImageText` 的意图一致。
 *
 * @module dsh-llm-account/src/core/image-projection
 */
import type { ContentBlock } from "@deepseek-ai/dsh-llm";

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 宿主给的持久化图片引用（`ImageBlock.attachment`）。 */
export interface ImageRefLike {
  attachmentId: string;
  mediaType?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

/** 取到的图片字节。 */
export interface RequestImageBytes {
  /** 附件 id（历史里同一张图可能出现多次，用它去重）。 */
  attachmentId: string;
  /** 编码后的字节。 */
  data: Uint8Array;
  /** MIME 类型。 */
  mediaType: string;
}

/**
 * 从插件上下文取一张图的字节。
 *
 * 走宿主的 `attachments.readImageRequest(ref, target, signal)`：
 * 它负责解码、缩放、并按 `maxBytes` 决定是否内联。
 *
 * **必须传完整的 `ImageRefLike`**（2026-10-20 真机报障）：宿主会用
 * `mediaType` / `bytes` / `width` / `height` 做引用校验，只给 `attachmentId`
 * 会被拒绝，表现就是「图片未能发送」。
 * @param ctx - 插件上下文（用来 `get("attachments")`）。
 * @param ref - 宿主给的持久化图片引用。
 * @param signal - 请求取消信号。
 * @returns 编码后的字节与 MIME；拿不到时 `undefined`（由调用方降级成占位文本）。
 */
export async function readImageBytes(
  ctx: unknown,
  ref: ImageRefLike,
  signal?: AbortSignal,
): Promise<RequestImageBytes | undefined> {
  try {
    const get = (ctx as { get?: (name: string) => unknown }).get;
    const attachments = typeof get === "function" ? get.call(ctx, "attachments") : undefined;
    // `isRecord` 已排除 `null`：旧写法对 `null` 不成立，会落到下一行读属性并抛错。
    if (!isRecord(attachments)) return undefined;
    const read = (attachments as { readImageRequest?: unknown }).readImageRequest;
    if (typeof read !== "function") return undefined;
    // 目标尺寸交给编码器自己收敛：`width/height` 给源图上限量级，`maxBytes` 高于内联上限。
    const target = { width: 4096, height: 4096, maxBytes: 5 * 1024 * 1024 };
    const result: unknown = await (
      read as (r: unknown, t: unknown, s?: AbortSignal) => Promise<unknown>
    ).call(attachments, ref, target, signal);
    if (!isRecord(result)) return undefined;
    const data = (result as Record<string, unknown>).data;
    const mediaType = (result as Record<string, unknown>).mediaType;
    if (!(data instanceof Uint8Array) || typeof mediaType !== "string" || mediaType === "") {
      return undefined;
    }
    return { attachmentId: ref.attachmentId, data, mediaType };
  } catch {
    return undefined;
  }
}

/**
 * 收集一次请求里所有需要取字节的图片引用（按 attachment id 去重）。
 * @param messages - 宿主的请求消息。
 * @returns id → 引用。
 */
export function wantedImagesOf(
  messages: readonly { content: readonly ContentBlock[] }[],
): Map<string, ImageRefLike> {
  const wanted = new Map<string, ImageRefLike>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== "image") continue;
      const ref = block.attachment as ImageRefLike | undefined;
      const id = ref?.attachmentId;
      if (typeof id === "string" && id !== "") wanted.set(id, ref as ImageRefLike);
    }
  }
  return wanted;
}

/**
 * 一次请求里是否含图片块。
 * @param content - 消息内容块。
 * @returns 是否含图。
 */
export function hasImageBlock(content: readonly ContentBlock[]): boolean {
  return content.some((block) => block.type === "image");
}

/**
 * 取不到字节时的文字占位。
 *
 * **不能静默丢弃**：审查的原话是「流仍正常完成，用户无法知道模型没收到图」。
 * 有了这一行，模型至少知道「这里本该有一张图」，用户也能从回答里察觉异常。
 * @param attachmentId - 附件 id（可能为空）。
 * @returns 占位文本。
 */
export function missingImagePlaceholder(attachmentId: string | undefined): string {
  return `[图片未能发送：${attachmentId ?? "未知附件"}]`;
}

/** 把编码后的字节拼成 data URL（OpenAI / Anthropic 都认的通用形状）。 */
export function dataUrlOf(image: RequestImageBytes): string {
  return `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}

/**
 * 把 base64 单独算出来（Anthropic 的 `source.base64` 只要数据部分，不要 `data:` 前缀）。
 * @param image - 图片字节。
 * @returns base64 字符串。
 */
export function base64Of(image: RequestImageBytes): string {
  return Buffer.from(image.data).toString("base64");
}
