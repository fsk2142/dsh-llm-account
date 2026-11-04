import { describe, expect, it } from "vitest";

import { resolveOAuthCredential, serializeOAuthCredential, type OAuthCredential } from "../../src/vendors/opencode/oauth";

/**
 * 认证刷新必须**可被调用者停止**（2026-11-04 外部审查 U03）。
 *
 * ## 审查原文
 *
 * > 刷新请求挂起时，1ms 请求期限加停止后 25ms 仍 pending；fetch 无 signal。
 * > 宿主收不到失败，不能启动重试。500 还会变成缺密钥。
 *
 * ## 后果
 *
 * 用户点「停止」后，请求**既没有完成也没有抛错** —— 宿主等不到终态，于是：
 *
 * - 停止按钮看起来没反应；
 * - 自动重试永远等不到机会（因为它要等前一次失败落定）。
 *
 * 这两条正是用户反馈「自动重试经常没用」的直接来源之一。
 */
const BASE = "https://opencode.ai";

/** 造一个「已过期」的凭据，保证走刷新路径。 */
function expiredCredential(): { raw: string; credential: OAuthCredential } {
  const credential: OAuthCredential = {
    v: 1,
    access: "old-access",
    refresh: "old-refresh",
    expiresAt: Date.now() - 60_000,
    orgId: "org-1",
  };
  return { raw: serializeOAuthCredential(credential), credential };
}

describe("U03 · 刷新必须响应取消", () => {
  it("**fetch 必须收到 signal**（原来一个 signal 都不传）", async () => {
    const { raw } = expiredCredential();
    let seenSignal: AbortSignal | undefined;

    const controller = new AbortController();
    await resolveOAuthCredential(
      raw,
      {
        fetchImpl: (async (_input: unknown, init?: RequestInit) => {
          seenSignal = init?.signal ?? undefined;
          return new Response(JSON.stringify({ access_token: "new", refresh_token: "new-r", expires_in: 3600 }), {
            status: 200,
          });
        }) as unknown as typeof fetch,
      },
      { signal: controller.signal },
    );

    expect(seenSignal, "刷新请求没有 signal 就无法被停止，宿主收不到失败也开不了重试").toBeDefined();
  });

  it("**调用者一停，刷新等待立刻结束**（不能挂在那里）", async () => {
    const { raw } = expiredCredential();
    const controller = new AbortController();

    /**
     * 永不 resolve 的 fetch，但**响应 signal**（真实 fetch 就是这样）。
     * 桩若不响应 signal，下面的 `await` 会挂死 —— 那本身就说明生产代码没把手柄传下去。
     */
    const hangingFetch = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        if (signal === undefined) return; // 没有 signal：永远挂着（就是被修的那个 bug）
        const fail = (): void => reject(new Error("aborted"));
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      })) as unknown as typeof fetch;

    const pending = resolveOAuthCredential(
      raw,
      { fetchImpl: hangingFetch, authBase: BASE },
      { signal: controller.signal },
    );

    // 稍等再停，确保请求已发出。
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    const outcome = await Promise.race([
      pending.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("STILL PENDING"), 500)),
    ]);

    expect(outcome, "停止之后不能还挂着（宿主会收不到终态）").not.toBe("STILL PENDING");
  });

  it("刷新失败时返回 undefined（调用方按缺凭据处理，不抛给宿主）", async () => {
    const { raw } = expiredCredential();
    const result = await resolveOAuthCredential(raw, {
      fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
    });
    expect(result).toBeUndefined();
  });
});

describe("U03 · 共享刷新：一方取消不破坏另一方", () => {
  /**
   * 审查的验收要求是这两条**同时**成立：
   *
   * > 永不返回的刷新可被调用者停止/总期限结束；共享刷新中一方取消不破坏另一方。
   *
   * 所以 signal **不能**原样塞进共享的 fetch —— 那样 A 一停，等同一份刷新的 B 也会被连带中止。
   * 正确分工：共享工作不绑任何单个调用者的 signal；每个调用者各自 race 自己的 signal。
   */
  it("两个调用者共享一次刷新：A 取消后 B 仍能拿到新 token", async () => {
    const { raw } = expiredCredential();
    let fetchCount = 0;

    /** 慢一点但成功的刷新（模拟真实网络往返）。 */
    const slowFetch = (async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "fresh-r", expires_in: 3600 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const deps = { fetchImpl: slowFetch };
    const aController = new AbortController();

    const a = resolveOAuthCredential(raw, deps, { signal: aController.signal });
    const b = resolveOAuthCredential(raw, deps, {});

    // A 在被取消后应当尽快结束。
    await new Promise((resolve) => setTimeout(resolve, 10));
    aController.abort();
    const aOutcome = await Promise.race([
      a.then(
        () => "done",
        () => "done",
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("STILL PENDING"), 400)),
    ]);
    expect(aOutcome, "取消的一方必须立刻结束").not.toBe("STILL PENDING");

    // B 不受影响：仍然拿到新 token。
    const bResult = await b;
    expect(bResult?.key, "另一方不能被连累").toBe("fresh");

    /**
     * 这里**不**断言 fetch 只发生一次：去重（single-flight）在 adapter 层
     * （`#refreshShared`），本测试直接调 `resolveOAuthCredential`，绕过了那一层。
     * 断言它会是错的期望 —— 那层由 `opencode.test.ts` 的并发用例覆盖。
     */
    expect(fetchCount, "两次独立调用会各发一次（去重在 adapter 层）").toBeGreaterThanOrEqual(1);
  });
});
