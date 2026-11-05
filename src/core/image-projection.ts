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
import { fileHandleText, LlmError } from "@deepseek-ai/dsh-llm";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Preserve the host's file handle contract; never invent a filesystem path or PDF text. */
export function fileBlockText(block: Extract<ContentBlock, { type: "file" }>): string {
  const ref: unknown = block.attachment;
  if (!isRecord(ref) || typeof ref.attachmentId !== "string" || ref.attachmentId.trim() === "" ||
      typeof ref.name !== "string" || ref.name.trim() === "" || typeof ref.bytes !== "number" ||
      !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
    throw new LlmError("Cannot project a file block with an invalid attachment reference", "UNSUPPORTED_CONTENT");
  }
  return fileHandleText(block.attachment, undefined);
}

/**
 * Assistant 历史图片的占位文本（2026-11-05 外部审查 F10）。
 *
 * ## 为什么不再拼 attachmentId
 *
 * 占位的作用是**告诉模型「这里原本有一张图，但这次没有内联」**。上一版把宿主的
 * `attachmentId` 也拼了进去 —— 模型无法凭这个 id 读到附件（它只是本地持久化标识），
 * 所以那段字符纯属无用输入：每张历史图都白吃一段 prompt。
 *
 * 同时它还是**内部标识的最小化问题**：附件 id 属于宿主内部命名空间，没有必要
 * 出现在发往上游的正文里。
 *
 * 需要区分多张图时用**请求内序号**（见 {@link assistantImageText} 的 `index`），
 * 那既够用又不暴露内部 id。
 * @param block - assistant 消息里的图片块。
 * @param index - 本次请求内第几张 assistant 历史图（从 1 开始；缺省不带序号）。
 * @returns 占位文本。
 */
export function assistantImageText(block: Extract<ContentBlock, { type: "image" }>, index?: number): string {
  // 序号拼在最前面：`[历史 assistant 图片 #2：已卸载，…]`。
  // 没有序号时不能留空槽 —— `图片 ：` 这种多一个空格的形状很显眼。
  const ordinal = index === undefined ? "" : ` #${index}`;
  const offloaded = block.offloaded === true ? "已卸载，" : "";
  return `[历史 assistant 图片${ordinal}：${offloaded}原图未内联，本次仅保留占位，不能据此推断图片内容]`;
}

/** Reject unsupported image roles before attachment I/O instead of silently dropping data. */
export function assertProjectableContent(messages: readonly { role?: string; content: readonly ContentBlock[] }[]): void {
  for (const message of messages) for (const block of message.content) {
    if (block.type === "file") fileBlockText(block);
    if (block.type === "image" && message.role !== undefined && message.role !== "user" && message.role !== "tool" && message.role !== "assistant") {
      throw new LlmError(`Image blocks in ${message.role} messages are not supported by this route`, "UNSUPPORTED_CONTENT");
    }
  }
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
 * 单张图片的字节上限（与宿主 `readImageRequest` 的内联额度同量级）。
 *
 * 注意：这是**单张**上限，挡不住「20 张各 5 MiB」—— 总预算见
 * {@link IMAGE_REQUEST_BUDGET_BYTES} 与 {@link collectImageBytes}。
 */
const SINGLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 一次请求的**图片总预算**（2026-11-05 外部审查 F06）。
 *
 * ## 为什么需要
 *
 * 上一版只有单张 5 MiB 上限，没有任何总量约束。20 张满额图片 = 100 MiB 原始字节，
 * base64 后约 133 MiB，还要再序列化成一份 JSON 请求体 —— 内存峰值不可预测。
 * 长图文会话里这足以拖慢甚至拖垮一次请求，而用户看不出原因。
 *
 * ## 为什么是 24 MiB
 *
 * - 常见长会话的图片总量在个位数 MiB；
 * - 24 MiB 原始字节 ≈ 32 MiB base64，对一次 chat 请求已是很大的正文档位；
 * - 与「保留必要的视觉上下文」不冲突：超预算的旧图片降级成**占位文本**而不是
 *   被静默删掉 —— 模型仍知道那里有图，只是这一张没内联。
 */
export const IMAGE_REQUEST_BUDGET_BYTES = 24 * 1024 * 1024;

/** 一次请求最多内联多少张图片（与字节预算同时生效，防止小图刷满条数）。 */
export const IMAGE_REQUEST_BUDGET_COUNT = 24;

/** 图片收集的结论。 */
export interface CollectedImages {
  /** attachment id → 字节（只含真正内联的那些）。 */
  images: Map<string, RequestImageBytes>;
  /** 因超出预算而没内联的图片 id（协议层据此发占位文本）。 */
  skipped: Set<string>;
}

/**
 * 按**总预算**收集一次请求需要的图片字节（2026-11-05 外部审查 F06）。
 *
 * ## 与上一版的区别
 *
 * 三家适配器原来各写一个 `for (const [id, ref] of wantedImagesOf(...))` 循环：
 * 只受单张上限约束，没有总数/总字节上限，也没有并发控制。判断散落三处还会漏
 * （U13 就是这么漏掉两家的）。
 *
 * 现在统一在这里：
 *
 * 1. **串行读取**：`readImageBytes` 是解码 + 可能缩放的 CPU/IO 混合操作，
 *    `Promise.all` 同时加载多张大图只会把峰值叠起来；
 * 2. **总字节 / 总张数预算**：任一耗尽就**停止内联**，剩下的交给占位文本；
 * 3. **先来先得**：`wantedImagesOf` 按消息顺序产出，所以优先内联**较早**的图？
 *    —— 不，这里反过来：预算紧张时应当优先保留**最近**出现的图片，
 *    因此遍历前先反转成「最近的优先」，命中后按 id 放回 Map（Map 顺序不影响出站）。
 *
 * **绝不静默丢弃**：没内联的 id 会进 `skipped`，协议层照旧输出占位文本。
 * @param messages - 宿主的请求消息。
 * @param resolve - 单张图片的字节读取注入点；缺席时返回空结果（协议层全员占位）。
 * @param signal - 请求取消信号。
 * @returns 内联的字节与因预算跳过 id 集合。
 */
export async function collectImageBytes(
  messages: readonly { role?: string; content: readonly ContentBlock[] }[],
  resolve: ((ref: ImageRefLike, signal?: AbortSignal) => Promise<RequestImageBytes | undefined>) | undefined,
  signal?: AbortSignal,
  budget: { maxBytes?: number; maxCount?: number } = {},
): Promise<CollectedImages> {
  const images = new Map<string, RequestImageBytes>();
  const skipped = new Set<string>();
  if (resolve === undefined) return { images, skipped };

  const maxBytes = budget.maxBytes ?? IMAGE_REQUEST_BUDGET_BYTES;
  const maxCount = budget.maxCount ?? IMAGE_REQUEST_BUDGET_COUNT;

  // 最近出现的图片优先：预算紧张时保留对话尾部（那才是这一轮真正要看的图）。
  const wanted = [...wantedImagesOf(messages).entries()].reverse();
  let usedBytes = 0;
  for (const [id, ref] of wanted) {
    if (signal?.aborted === true) break;
    if (images.size >= maxCount) {
      skipped.add(id);
      continue;
    }
    let bytes: RequestImageBytes | undefined;
    try {
      bytes = await resolve(ref, signal);
    } catch {
      // 单张读失败：交给占位文本，不打断整次请求。
      bytes = undefined;
    }
    if (bytes === undefined) {
      skipped.add(id);
      continue;
    }
    const size = bytes.data.byteLength;
    if (usedBytes + size > maxBytes) {
      // 超预算：**这一张也不发**（发一半的图没有意义），交给占位文本。
      skipped.add(id);
      continue;
    }
    usedBytes += size;
    images.set(id, bytes);
  }
  return { images, skipped };
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
    const target = { width: 4096, height: 4096, maxBytes: SINGLE_IMAGE_MAX_BYTES };
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
  messages: readonly { role?: string; content: readonly ContentBlock[] }[],
): Map<string, ImageRefLike> {
  assertProjectableContent(messages);
  const wanted = new Map<string, ImageRefLike>();
  for (const message of messages) {
    if (message.role === "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "image") continue;
      /**
       * **已卸载的图片不收集**（2026-11-04 外部审查 U13）。
       *
       * `offloaded: true` 的含义是「这张图已从请求里卸载」—— 宿主要求各条路由只发
       * 「命名图片及其只读路径」的占位文本。把它收进来读字节，等于把卸载又撤销了：
       * 请求被撑回原大小，用户为长对话做的缩减全部失效。
       *
       * 放在这个**共享**函数里而不是各家的 adapter：三家都从这里取，
       * 少写一家的判断就少一个漏洞（这一轮正是 commandcode 漏了）。
       */
      if (block.offloaded === true) continue;
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
