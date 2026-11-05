/**
 * 图片聚合预算（2026-11-05 外部审查 F06）。
 *
 * ## 缺陷
 *
 * 三家适配器原来各写一个 `for (const [id, ref] of wantedImagesOf(...))` 循环：
 * 只受**单张** 5 MiB 上限约束，没有总张数、总字节约束，也没有并发控制。
 * 20 张满额图片 = 100 MiB 原始字节 → base64 约 133 MiB → 再序列化成一份 JSON 请求体。
 *
 * ## 修复的纪律
 *
 * - 超预算的图片**降级成占位文本**，不是静默丢弃（与 U13 同一条原则）；
 * - 预算判断下沉到 `core/image-projection` 的 `collectImageBytes`，三家共用一份；
 * - **优先保留最近的图片**：预算不够时，对话尾部才是这一轮真正要看的图。
 *
 * 测试直接从 `collectImageBytes` 进入 —— 它是三家共同的实现，测它等于测三家。
 * （另有一条从 `opencode/adapter.stream` 进入的端到端断言在 image 相关测试里。）
 */
import { describe, expect, it } from "vitest";

import type { ContentBlock } from "@deepseek-ai/dsh-llm";

import {
  IMAGE_REQUEST_BUDGET_BYTES,
  IMAGE_REQUEST_BUDGET_COUNT,
  collectImageBytes,
  type ImageRefLike,
  type RequestImageBytes,
} from "../../src/core/image-projection";

/** 造一条 user 消息，里面放 n 张图（id 依次递增）。 */
function userWithImages(ids: readonly string[]): { role: "user"; content: ContentBlock[] } {
  return {
    role: "user",
    content: ids.map(
      (id) =>
        ({
          type: "image",
          attachment: { attachmentId: id, mediaType: "image/png", bytes: 1, width: 1, height: 1, name: `${id}.png` },
        }) as unknown as ContentBlock,
    ),
  };
}

/** 按 id 返回固定大小的字节。 */
function resolverOf(sizeById: Readonly<Record<string, number>>, calls?: string[]): (ref: ImageRefLike) => Promise<RequestImageBytes> {
  return async (ref: ImageRefLike) => {
    calls?.push(ref.attachmentId);
    const size = sizeById[ref.attachmentId] ?? 1024;
    return { attachmentId: ref.attachmentId, mediaType: "image/png", data: new Uint8Array(size) };
  };
}

describe("F06 · 单请求图片总预算", () => {
  it("总字节超预算后停止内联，并把剩下的记进 skipped", async () => {
    // 每张 10 MiB，预算 24 MiB → 只能内联 2 张。
    const tenMiB = 10 * 1024 * 1024;
    const ids = ["a", "b", "c", "d"];
    const { images, skipped } = await collectImageBytes(
      [userWithImages(ids)],
      resolverOf(Object.fromEntries(ids.map((id) => [id, tenMiB]))),
    );

    expect(images.size, "只内联预算装得下的张数").toBe(2);
    expect(skipped.size).toBe(2);
    const used = [...images.values()].reduce((sum, image) => sum + image.data.byteLength, 0);
    expect(used).toBeLessThanOrEqual(IMAGE_REQUEST_BUDGET_BYTES);
  });

  it("**优先保留最近的图片**（预算紧张时丢旧的、留新的）", async () => {
    const tenMiB = 10 * 1024 * 1024;
    const ids = ["old-1", "old-2", "new-1"];
    const { images } = await collectImageBytes(
      [userWithImages(ids)],
      resolverOf(Object.fromEntries(ids.map((id) => [id, tenMiB]))),
    );

    expect([...images.keys()], "最新那张必须在，最旧那张被降级").toEqual(expect.arrayContaining(["new-1"]));
    expect(images.has("old-1"), "最旧的被跳过").toBe(false);
  });

  it("张数上限独立生效（大量小图不能刷满请求）", async () => {
    const ids = Array.from({ length: IMAGE_REQUEST_BUDGET_COUNT + 8 }, (_unused, index) => `img-${index}`);
    const { images, skipped } = await collectImageBytes([userWithImages(ids)], resolverOf({}));

    expect(images.size).toBeLessThanOrEqual(IMAGE_REQUEST_BUDGET_COUNT);
    expect(images.size + skipped.size, "每张图都被归类，不丢也不重复").toBe(ids.length);
  });

  it("单张读失败只影响那一张（不打断整次请求）", async () => {
    const ids = ["ok-1", "broken", "ok-2"];
    const resolve = async (ref: ImageRefLike): Promise<RequestImageBytes | undefined> => {
      if (ref.attachmentId === "broken") throw new Error("boom");
      return { attachmentId: ref.attachmentId, mediaType: "image/png", data: new Uint8Array(16) };
    };
    const { images, skipped } = await collectImageBytes([userWithImages(ids)], resolve);

    expect([...images.keys()].sort()).toEqual(["ok-1", "ok-2"]);
    expect([...skipped]).toEqual(["broken"]);
  });

  it("已卸载（offloaded）的图片不读取也不内联，且不算 skipped", async () => {
    const calls: string[] = [];
    const message = {
      role: "user" as const,
      content: [
        { type: "image", offloaded: true, attachment: { attachmentId: "off", mediaType: "image/png", bytes: 1, width: 1, height: 1 } },
        { type: "image", attachment: { attachmentId: "on", mediaType: "image/png", bytes: 1, width: 1, height: 1 } },
      ] as unknown as ContentBlock[],
    };
    const { images, skipped } = await collectImageBytes([message], resolverOf({}, calls));

    expect(calls, "卸载的图不该被读").toEqual(["on"]);
    expect([...images.keys()]).toEqual(["on"]);
    expect(skipped.has("off"), "卸载不等于预算跳过").toBe(false);
  });

  it("没有注入解析器时返回空结果（协议层全员占位）", async () => {
    const { images, skipped } = await collectImageBytes([userWithImages(["a"])], undefined);
    expect(images.size).toBe(0);
    expect(skipped.size).toBe(0);
  });

  it("取消后不再继续读取（不烧无谓的解码）", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const resolve = async (ref: ImageRefLike): Promise<RequestImageBytes | undefined> => {
      calls.push(ref.attachmentId);
      controller.abort();
      return { attachmentId: ref.attachmentId, mediaType: "image/png", data: new Uint8Array(16) };
    };
    const { images } = await collectImageBytes([userWithImages(["a", "b", "c"])], resolve, controller.signal);

    expect(images.size, "取消后停止").toBe(1);
    expect(calls).toHaveLength(1);
  });
});
