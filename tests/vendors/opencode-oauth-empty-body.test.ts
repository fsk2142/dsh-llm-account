/**
 * F18 / F19：空正文容错的两个边界（2026-11-05 外部审查）。
 *
 * ## F18：`slow_down` 必须归零连续计数
 *
 * `slow_down` 是服务端**明确、结构化**的回应 —— 说明请求被正确解析了，只是要放慢。
 * 它证明端点仍然健康，所以前面那些空正文 400 不该继续累积；否则
 * 「偶发空正文 + 一次 slow_down + 偶发空正文」会被误判成连续故障。
 *
 * ## F19：非空的坏 JSON 不是空正文
 *
 * OAuth 用**空正文 400** 表达 pending，所以空正文要兜底。但**非空的坏 JSON**
 * 是另一回事（HTML 错误页、被代理改写的响应、协议变更）。上一版两者都折叠成
 * `undefined`，于是坏 JSON 也被当成「用户还没授权」，一路等到设备码过期。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeLogin } from "../../src/vendors/opencode/login";
import {
  EMPTY_BODY_PENDING_TOLERANCE,
  pollDeviceToken,
} from "../../src/vendors/opencode/oauth";

const DEVICE = {
  deviceCode: "dev-1",
  userCode: "AAAA-BBBB",
  verificationUri: "https://opencode.ai/console/device?user_code=AAAA-BBBB",
  intervalMs: 1_000,
  expiresAt: Date.now() + 600_000,
};

/** 只回固定响应的 fetch。 */
function fixed(body: string, status = 400): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("F19 · 空正文与坏 JSON 必须区分", () => {
  it("**非空坏 JSON 立刻报错**，不当成 pending", async () => {
    const result = await pollDeviceToken({ fetchImpl: fixed("<html>502 Bad Gateway</html>") }, DEVICE);
    expect(result.status, "坏 JSON 是协议错误，不是「还没授权」").toBe("error");
    expect((result as { message?: string }).message).toContain("non-JSON");
  });

  it("非空坏 JSON 即使连续很多次也不会变成 pending", async () => {
    for (const streak of [0, 1, EMPTY_BODY_PENDING_TOLERANCE, EMPTY_BODY_PENDING_TOLERANCE + 5]) {
      const result = await pollDeviceToken({ fetchImpl: fixed("{ truncated") }, DEVICE, undefined, streak);
      expect(result.status, `streak=${streak} 时仍是 error`).toBe("error");
    }
  });

  it("空正文仍然按 pending 兜底（正常协议形态不受影响）", async () => {
    const result = await pollDeviceToken({ fetchImpl: fixed("") }, DEVICE);
    expect(result).toEqual({ status: "pending", emptyBody: true });
  });

  it("两者在同一串响应里交替时，坏 JSON 立刻终止", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return call === 1 ? new Response("", { status: 400 }) : new Response("<html>oops</html>", { status: 400 });
    }) as unknown as typeof fetch;

    const first = await pollDeviceToken({ fetchImpl }, DEVICE, undefined, 0);
    expect(first.status).toBe("pending");
    const second = await pollDeviceToken({ fetchImpl }, DEVICE, undefined, 1);
    expect(second.status, "第二拍是坏 JSON → 立刻报错").toBe("error");
  });
});

describe("F18 · slow_down 归零连续空正文计数", () => {
  it("**slow_down 之后计数归零**：偶发空正文不会累计成故障", async () => {
    // 序列：空正文400 → 空正文400 → slow_down → 空正文400 → 空正文400 → ...
    // 计数若不在 slow_down 归零，第 4 次空正文就会被判成协议错误。
    const script: ("empty" | "slow" | "pending")[] = ["empty", "empty", "slow", "empty", "empty", "empty"];
    let index = 0;
    let clock = 1_000_000;
    const fetchImpl = (async (url: string) => {
      const text = String(url);
      if (text.includes("/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "d",
            user_code: "U",
            verification_uri: "/console/device",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 },
        );
      }
      if (text.includes("/device/token")) {
        const step = script[index] ?? "pending";
        index += 1;
        if (step === "slow") {
          return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 });
        }
        // 脚本用完后回到**结构化 pending**：那是正常等待，好让流程跑到过期。
        if (step === "pending") {
          return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 });
        }
        return new Response("", { status: 400 });
      }
      return new Response(JSON.stringify([{ id: "o", name: "O" }]), { status: 200 });
    }) as unknown as typeof fetch;

    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    });

    await login.begin();
    for (let i = 0; i < 200 && (await login.status()).state === "waiting"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const status = await login.status();
    /**
     * 断言的是**时序**而不是终态：脚本用完前流程必须还活着。
     *
     * 为什么不能只看最终 `reason`：脚本用完后回落到结构化 pending，那条路径会把
     * 计数清零 —— 于是「slow_down 有没有归零」被完全掩盖（变异检验确认过：
     * 去掉 slow_down 的归零，只看终态的写法仍然全绿）。
     *
     * 正确判据：第 4、5 次空正文（slow_down 之后的那两次）**必须还是 pending**。
     * 计数若没归零，第 4 次就会累计到 3 并立刻失败。
     */
    expect(index, "脚本跑完了 6 拍").toBeGreaterThanOrEqual(6);
    expect(status.state, "仍然存活（没有在第 4 拍被判成协议错误）").toBe("failed");
    expect(status.reason, "终态是等到过期，不是协议错误").toBe("timeout");
  });

  it("**slow_down 归零的直接证据**：第 4 拍仍然是 pending", async () => {
    // 只用 4 拍：空、空、slow_down、空。若不归零，第 4 拍累计 = 3 → 立刻 error。
    let tokenCalls = 0;
    const fetchImpl = (async (url: string) => {
      const text = String(url);
      if (text.includes("/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "d",
            user_code: "U",
            verification_uri: "/console/device",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 },
        );
      }
      if (text.includes("/device/token")) {
        tokenCalls += 1;
        if (tokenCalls === 3) return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 });
        /**
         * 第 5 拍起**挂住不返回**（一个永不 settle 的 promise，不是无限流 ——
         * 没有内存增长）。这样第 4 拍的结论不会被后面的拍数覆盖，
         * 也不会因为继续累计空正文而把状态推到 error。
         */
        if (tokenCalls >= 5) return await new Promise<Response>(() => {});
        return new Response("", { status: 400 });
      }
      return new Response(JSON.stringify([{ id: "o", name: "O" }]), { status: 200 });
    }) as unknown as typeof fetch;

    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => 1_000_000,
      sleep: async () => {},
    });

    await login.begin();
    // 等到第 5 拍挂住（说明第 4 拍已经处理完）。
    for (let i = 0; i < 200 && tokenCalls < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    const status = await login.status();
    // 收尾：那条挂住的请求不该泄漏到用例之外（cancel 会 abort 它）。
    await login.cancel();

    expect(tokenCalls, "已经跑到第 5 拍（第 4 拍处理完毕）").toBeGreaterThanOrEqual(5);
    expect(
      status.state,
      "**第 4 拍仍是 waiting** —— 若 slow_down 没归零，这里会变成 failed",
    ).toBe("waiting");
  });

  it("没有 slow_down 时，连续空正文确实会报协议错误（F14 仍然有效）", async () => {
    let clock = 1_000_000;
    let tokenCalls = 0;
    const fetchImpl = (async (url: string) => {
      const text = String(url);
      if (text.includes("/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "d",
            user_code: "U",
            verification_uri: "/console/device",
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 },
        );
      }
      if (text.includes("/device/token")) {
        tokenCalls += 1;
        return new Response("", { status: 400 });
      }
      return new Response(JSON.stringify([{ id: "o", name: "O" }]), { status: 200 });
    }) as unknown as typeof fetch;

    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    });

    await login.begin();
    for (let i = 0; i < 200 && (await login.status()).state === "waiting"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const status = await login.status();
    expect(tokenCalls, "只轮询了容忍次数 + 1 次就停").toBeLessThanOrEqual(EMPTY_BODY_PENDING_TOLERANCE + 2);
    expect(status.state, "立刻失败，不必等到过期").toBe("failed");
    expect(status.reason, "不是 timeout").toBe("unavailable");
  });
});
