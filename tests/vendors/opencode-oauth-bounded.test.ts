/**
 * OAuth 端点的 F13 / F14 回归（2026-11-05 外部审查）。
 *
 * ## F13：响应体没有大小上限
 *
 * 四个 OAuth 流程（设备码、轮询、刷新、工作区）原来共用一个
 * `await response.text()` 的 `readJson`。复现过：17 MiB 正文被完整读进内存。
 *
 * ## F14：空正文 400 被一律当成 pending
 *
 * 复现过：mock 端点持续回空正文 400 → 轮询 **300 次**才结束，最终原因是
 * `timeout`。真实协议错误被伪装成「用户还没授权」，界面上什么提示都没有。
 *
 * 两条都必须从**真实入口**测（`beginDeviceFlow` / `pollDeviceToken` /
 * `refreshOAuthCredential` / `fetchOAuthOrg`），不是只测工具函数 ——
 * 那是 U06/U07 反复踩过的假绿。
 */
import { describe, expect, it } from "vitest";

import { BodyTooLargeError } from "../../src/core/bounded-body";
import {
  EMPTY_BODY_PENDING_TOLERANCE,
  beginDeviceFlow,
  fetchOAuthOrg,
  pollDeviceToken,
  refreshOAuthCredential,
} from "../../src/vendors/opencode/oauth";

/** 一个正好超过 256 KiB 上限的正文。 */
const OVERSIZED = `{"error":"${"x".repeat(300 * 1024)}"}`;

/** 只关心「请求发出去了、响应体怎么被处理」的 fetch。 */
function fetchReturning(body: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

const DEVICE = {
  deviceCode: "dev-1",
  userCode: "AAAA-BBBB",
  verificationUri: "https://opencode.ai/console/device?user_code=AAAA-BBBB",
  intervalMs: 5_000,
  expiresAt: Date.now() + 600_000,
};

describe("F13 · 四个 OAuth 流程都有正文上限", () => {
  it("`beginDeviceFlow` 超限 → BodyTooLargeError", async () => {
    await expect(beginDeviceFlow({ fetchImpl: fetchReturning(OVERSIZED) })).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("`pollDeviceToken` 超限 → BodyTooLargeError（不被空正文兜底吞掉）", async () => {
    await expect(
      pollDeviceToken({ fetchImpl: fetchReturning(OVERSIZED, 400) }, DEVICE),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("`refreshOAuthCredential` 超限 → BodyTooLargeError", async () => {
    const credential = { v: 1 as const, access: "a", refresh: "r", expiresAt: 0, orgId: "o" };
    await expect(
      refreshOAuthCredential({ fetchImpl: fetchReturning(OVERSIZED) }, credential),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("`fetchOAuthOrg` 超限 → BodyTooLargeError", async () => {
    await expect(fetchOAuthOrg({ fetchImpl: fetchReturning(OVERSIZED) }, "acc")).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("正常大小的响应照旧解析（上限没有误伤）", async () => {
    const body = JSON.stringify({
      device_code: "d",
      user_code: "U",
      verification_uri: "/console/device",
      expires_in: 600,
      interval: 5,
    });
    await expect(beginDeviceFlow({ fetchImpl: fetchReturning(body) })).resolves.toMatchObject({ deviceCode: "d" });
  });

  it("**超限后立刻停读**（不是先读完再抛）", async () => {
    let chunksRead = 0;
    let cancelled = false;
    const encoder = new TextEncoder();
    /**
     * ## 这个流必须是**有界**的（2026-11-05 事故）
     *
     * 最初版本写成「每次 pull 都吐 100 KiB，永不结束」—— 那样一旦被测代码
     * 没有 cancel（比如变异回 `response.text()`），读取就会无限进行、
     * 无限吃内存，**把整机内存耗尽**。做过两次变异检验，崩了两次。
     *
     * 测试夹具绝不能依赖被测代码「一定会停」：夹具自己得先有上界。
     * 现在最多吐 {@link CHUNK_CAP} 块（共 2 MiB），足够证明「超限后提前停」
     * （上限 256 KiB，正常应读 3 块就停），又不可能失控。
     */
    const CHUNK_CAP = 20;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksRead >= CHUNK_CAP) {
          controller.close();
          return;
        }
        chunksRead += 1;
        controller.enqueue(encoder.encode("x".repeat(100 * 1024)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;

    await expect(beginDeviceFlow({ fetchImpl })).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled, "超限必须 cancel 正文").toBe(true);
    expect(chunksRead, "上限 256 KiB / 块 100 KiB → 读到第 3 块就停").toBeLessThanOrEqual(4);
  });
});

describe("F14 · 空正文 400 不再无限当成 pending", () => {
  it("首次空正文 400 仍按 pending，但标记来源", async () => {
    const result = await pollDeviceToken({ fetchImpl: fetchReturning("", 400) }, DEVICE);
    expect(result).toEqual({ status: "pending", emptyBody: true });
  });

  it("服务端明确说 pending 时不带标记（计数要能归零）", async () => {
    const result = await pollDeviceToken(
      { fetchImpl: fetchReturning(JSON.stringify({ error: "authorization_pending" }), 400) },
      DEVICE,
    );
    expect(result).toEqual({ status: "pending" });
  });

  it("**连续超过容忍次数 → 明确报错，而不是等到过期**", async () => {
    const verdict = await pollDeviceToken(
      { fetchImpl: fetchReturning("", 400) },
      DEVICE,
      undefined,
      EMPTY_BODY_PENDING_TOLERANCE,
    );
    expect(verdict.status).toBe("error");
    expect(JSON.stringify(verdict), "错误信息要点出连续次数，便于定位").toContain(
      String(EMPTY_BODY_PENDING_TOLERANCE + 1),
    );
  });

  it("容忍次数是正数（改成 0 会让偶发抖动直接打死登录）", () => {
    expect(EMPTY_BODY_PENDING_TOLERANCE).toBeGreaterThan(0);
  });

  it("其它状态码的空正文仍按 error（只有 400 有这层兜底）", async () => {
    const verdict = await pollDeviceToken({ fetchImpl: fetchReturning("", 503) }, DEVICE);
    expect(verdict.status).toBe("error");
  });
});
