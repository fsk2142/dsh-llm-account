/**
 * 目录正文的**真实字节上限**回归（2026-11-05 外部审查 F05）。
 *
 * ## 上一版为什么不算数
 *
 * ```ts
 * const text = await response.text();   // 整个响应先读进内存
 * if (text.length > limit) throw …     // 再检查，且单位是 UTF-16 码元
 * ```
 *
 * 两个问题各自都能被独立观测：
 *
 * 1. **上限太晚**：超限的响应会先被完整读完，之后才抛错 —— 上限挡不住内存峰值；
 * 2. **单位错**：`text.length` 是 UTF-16 码元数。中文正文的 UTF-8 字节数约为它的
 *    3 倍，所以「按字节设的上限」实际放行了 3 倍额度。
 *
 * ## 这里怎么测
 *
 * - 第 1 条用**读了多少 chunk** 判定：超限之后不应再 `read()`；
 * - 第 2 条用多字节正文：字符数远小于上限、字节数超过上限 —— 必须失败。
 *
 * 都不能只看「是否抛错」：抛错是对的，但「先把 200MB 读进内存再抛错」也是抛错。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";

const BASE = "https://opencode.ai/zen/go/v1";

/** 记录「正文被读了几次 chunk」的 `/models` 响应。 */
function chunkedResponse(chunks: readonly string[], onRead?: () => void): { response: Response; reads: () => number } {
  let reads = 0;
  let index = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      onRead?.();
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index] ?? ""));
      index += 1;
    },
  });
  return { response: new Response(stream, { status: 200 }), reads: () => reads };
}

/** 让 `/models` 返回给定响应，元数据端点快速失败。 */
function fetchReturning(make: () => Response): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("models.dev")) return new Response("{}", { status: 500 });
    return make();
  }) as unknown as typeof fetch;
}

describe("F05 · 超限时立刻停止读取", () => {
  it("超过字节上限后不再索取后续 chunk，并取消 reader", async () => {
    // 1 MiB 一个 chunk，准备 40 个 —— 远超 MODELS_MAX_BYTES（8 MiB），且不许读完。
    const chunk = "x".repeat(1024 * 1024);
    const built = chunkedResponse(Array.from({ length: 40 }, () => chunk));
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: fetchReturning(() => built.response), ttlMs: 1000 });

    await expect(catalog.list()).rejects.toThrow(/byte limit/i);
    // 允许读到「跨过上限的那一个」，但不该把 40 个都读完。
    expect(built.reads(), "超限后必须停读").toBeLessThan(15);
  });

  it("**字符数没超、字节数超了**也必须失败（单位是字节不是码元）", async () => {
    // `MODELS_MAX_BYTES` 是 1 MiB。「中」在 UTF-8 里 3 字节：
    // 40 万字符 → 字符数 40 万（远低于 1 MiB），字节数约 1.2 MiB（超限）。
    // 旧实现比 `text.length`，于是会**放行**这份超限正文。
    const text = JSON.stringify({ data: [{ id: "m", name: "中".repeat(400_000) }] });
    expect(text.length, "字符数故意低于上限").toBeLessThan(1024 * 1024);
    expect(Buffer.byteLength(text, "utf8"), "字节数故意高于上限").toBeGreaterThan(1024 * 1024);

    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: fetchReturning(() => new Response(text)), ttlMs: 1000 });
    await expect(catalog.list()).rejects.toThrow(/byte limit/i);
  });

  it("正常大小的目录照旧解析（上限没有误伤）", async () => {
    const body = JSON.stringify({ data: [{ id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }] });
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: fetchReturning(() => new Response(body)), ttlMs: 1000 });
    const records = await catalog.list();
    expect(records[0]?.entry.id).toBe("deepseek-v4.1-flash");
  });

  it("`Content-Length` 已经超限时直接拒绝，并取消正文（不把它读完）", async () => {
    // 注意：不能断言「pull 没被调用」——`ReadableStream` 的高水位策略会在构造时
    // 先填一格队列，pull 与否不说明有人读了。真正可观测的是**正文被 cancel 而不是被读完**。
    let cancelled = false;
    let enqueued = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        enqueued += 1;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } });
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl: fetchReturning(() => response), ttlMs: 1000 });

    await expect(catalog.list()).rejects.toThrow(/byte limit/i);
    expect(cancelled, "超限时应当 cancel 正文而不是读完它").toBe(true);
    expect(enqueued, "没有为这条超限响应持续读数据").toBeLessThanOrEqual(1);
  });
});
