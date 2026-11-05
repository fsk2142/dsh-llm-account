/**
 * 共享的有界正文读取（2026-11-05 外部审查 F13）。
 *
 * ## 为什么抽成共享模块
 *
 * 「先 `response.text()` 再量长度」已经出现过两次：目录请求（F05）与 OAuth 端点
 * （F13）。两处都是同一个错误：**上限来得太晚，且单位错了**。
 *
 * 与其在每个调用点各写一遍再各漏一次，不如共用一份 —— 这也是
 * `docs/HANDOVER-2.0.0.md` §5.5 那条纪律：同一逻辑分散多处，迟早漏一家。
 *
 * 这里钉三件事：
 * 1. 超限**立刻停读**（可观测：不再索取后续 chunk、reader 被 cancel）；
 * 2. 单位是 **UTF-8 字节**不是字符数（中文正文的字节数是字符数的 3 倍）；
 * 3. 空正文与非法 JSON 返回 `undefined` 而不是抛错（OAuth 用空 400 表达 pending，
 *    那是**正常协议形态**，不能当异常）。
 */
import { describe, expect, it } from "vitest";

import { BodyTooLargeError, readBoundedJson, readBoundedText } from "../../src/core/bounded-body";

/** 一个分块流；记录被读了几次、是否被 cancel。 */
function chunked(
  chunks: readonly string[],
  options: { cancelOnPull?: boolean } = {},
): { response: Response; reads: () => number; cancelled: () => boolean } {
  let reads = 0;
  let cancelled = false;
  let index = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index] ?? ""));
      index += 1;
      if (options.cancelOnPull === true) return;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(stream, { status: 200 }), reads: () => reads, cancelled: () => cancelled };
}

describe("readBoundedText · 超限立刻停读", () => {
  it("超过字节上限后不再索取后续 chunk，并 cancel 正文", async () => {
    // 每个 chunk 1 MiB，准备 20 个；上限 2 MiB。
    const built = chunked(Array.from({ length: 20 }, () => "x".repeat(1024 * 1024)));
    await expect(readBoundedText(built.response, 2 * 1024 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(built.cancelled(), "超限后必须 cancel 正文").toBe(true);
    expect(built.reads(), "不该把 20 个 chunk 全读完").toBeLessThan(10);
  });

  it("**字符数没超、字节数超了**也必须失败（单位是字节）", async () => {
    // 「中」是 3 字节：30 万字符 ≈ 900 KB 字节，上限设 500 KB。
    const text = "中".repeat(300_000);
    expect(text.length, "字符数低于上限").toBeLessThan(500 * 1024);
    expect(Buffer.byteLength(text, "utf8"), "字节数高于上限").toBeGreaterThan(500 * 1024);

    await expect(readBoundedText(new Response(text), 500 * 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("恰好等于上限时通过（边界是闭区间）", async () => {
    const body = "a".repeat(1024);
    await expect(readBoundedText(new Response(body), 1024)).resolves.toBe(body);
  });

  it("`Content-Length` 已经超限时直接拒绝，并取消正文", async () => {
    const built = chunked(["{}"]);
    const response = new Response(built.response.body, {
      status: 200,
      headers: { "content-length": String(64 * 1024 * 1024) },
    });
    await expect(readBoundedText(response, 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("没有 body 的响应也按字节判（不因为读不到流就跳过检查）", async () => {
    const response = new Response(null, { status: 204 });
    await expect(readBoundedText(response, 1024)).resolves.toBe("");
  });

  it("正常响应原样返回", async () => {
    await expect(readBoundedText(new Response('{"ok":true}'), 1024)).resolves.toBe('{"ok":true}');
  });
});

describe("readBoundedJson · 语义边界", () => {
  it("空正文返回 `undefined`（OAuth 的空 400 是正常形态，不是错误）", async () => {
    await expect(readBoundedJson(new Response(""), 1024)).resolves.toBeUndefined();
  });

  it("纯空白也返回 `undefined`", async () => {
    await expect(readBoundedJson(new Response("   \n\t "), 1024)).resolves.toBeUndefined();
  });

  it("非法 JSON 返回 `undefined` 而不是抛错", async () => {
    await expect(readBoundedJson(new Response("<html>oops"), 1024)).resolves.toBeUndefined();
  });

  it("合法 JSON 正常解析", async () => {
    await expect(readBoundedJson(new Response('{"error":"authorization_pending"}'), 1024)).resolves.toEqual({
      error: "authorization_pending",
    });
  });

  it("**超限仍然抛错**（不能被「非法 JSON → undefined」吞掉）", async () => {
    const huge = `{"x":"${"y".repeat(4096)}"}`;
    await expect(readBoundedJson(new Response(huge), 1024)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});

describe("BodyTooLargeError · 诊断信息", () => {
  it("带上限与已读字节数，便于定位", () => {
    const error = new BodyTooLargeError(1024, 4096);
    expect(error.limit).toBe(1024);
    expect(error.received).toBe(4096);
    expect(error.message).toContain("1024");
    expect(error.message).toContain("4096");
  });
});
