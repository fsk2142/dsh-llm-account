import { describe, expect, it, vi } from "vitest";

import { createOpencodeLogin } from "../../src/vendors/opencode/login";

/**
 * 获取设备码期间取消必须生效（2026-11-04 外部审查 U05）。
 *
 * ## 审查原文
 *
 * > `begin` 等待设备码仍 idle，`cancel` 返回后迟到设备码继续 waiting 和轮询；
 * > 主要触发面为卸载/清理。
 *
 * ## 根因
 *
 * `cancel()` 原来以 `state !== "waiting"` 直接返回。而 `begin()` 在
 * `await beginDeviceFlow()` 期间状态还是 `idle` —— 那段时间里点取消**什么都不做**。
 * 迟到的设备码随后把状态写成 `waiting` 并启动轮询。
 */
/** 一个 200 JSON 响应。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 一个永远不 resolve 的 fetch（模拟「设备码请求还没回来」）。 */
function hangingFetch(): { fetchImpl: typeof fetch; released: () => void } {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async () => {
    await gate;
    return json({
      device_code: "late-device",
      user_code: "LATE-CODE",
      verification_uri: "https://opencode.ai/auth",
      expires_in: 900,
      interval: 1,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, released: () => release?.() };
}

describe("U05 · 启动中取消必须生效", () => {
  it("**begin 还没返回时 cancel → 迟到设备码不得进入 waiting**", async () => {
    const { fetchImpl, released } = hangingFetch();
    const storeKey = vi.fn(async () => undefined);
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey,
      now: () => Date.now(),
      sleep: async () => {},
    });

    // 启动：此时 fetch 挂起，状态仍是 idle。
    const pending = login.begin();
    await Promise.resolve();
    expect((await login.status()).state, "还没拿到设备码").toBe("idle");

    // 用户在「启动中」点了取消。
    await login.cancel();
    expect((await login.status()).state, "取消应当立刻落定").toBe("failed");
    expect((await login.status()).reason).toBe("cancelled");

    // 设备码迟到返回。
    released();
    await pending;

    const after = await login.status();
    expect(after.state, "迟到的设备码不能把状态带回 waiting").not.toBe("waiting");
    expect(after.reason, "应当保持 cancelled").toBe("cancelled");
  });

  it("**取消后不得启动轮询**（不会去换 token）", async () => {
    let tokenPolls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/device/code")) {
        await gate;
        return json({
          device_code: "late-device",
          user_code: "LATE-CODE",
          verification_uri: "https://opencode.ai/auth",
          expires_in: 900,
          interval: 1,
        });
      }
      tokenPolls += 1;
      return json({ access_token: "should-not-happen", expires_in: 3600 });
    }) as unknown as typeof fetch;

    const storeKey = vi.fn(async () => undefined);
    const login = createOpencodeLogin({ fetchImpl, storeKey, now: () => Date.now(), sleep: async () => {} });

    const pending = login.begin();
    await Promise.resolve();
    await login.cancel();
    release?.();
    await pending;

    // 给后台任务一点机会（若错误地启动了轮询，这里会看到调用）。
    await Promise.resolve();
    await Promise.resolve();

    expect(tokenPolls, "取消之后不该再换 token").toBe(0);
    expect(storeKey, "取消之后不该写入账号").not.toHaveBeenCalled();
  });

  it("**终态不受影响**（已成功的尝试不被 cancel 改写）", async () => {
    // 让登录直接成功：设备码 → 立即拿到 token。
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return json({
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://opencode.ai/auth",
          expires_in: 900,
          interval: 1,
        });
      }
      if (calls === 2) {
        // 先给一次 authorization_pending（轮询的真实第一步），再成功。
        return json({ error: "authorization_pending" }, 400);
      }
      if (calls === 3) {
        return json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });
      }
      // 第 4 步：列工作区（登录成功后要选 org）。
      return json([{ id: "org-1", name: "Default" }]);
    }) as unknown as typeof fetch;

    const storeKey = vi.fn(async () => undefined);
    const login = createOpencodeLogin({ fetchImpl, storeKey, now: () => Date.now(), sleep: async () => {} });

    await login.begin();
    // 等轮询把状态推到 success。
    for (let i = 0; i < 20; i += 1) {
      if ((await login.status()).state === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect((await login.status()).state, "先要成功").toBe("success");

    await login.cancel();
    expect((await login.status()).state, "成功之后 cancel 不该改写终态").toBe("success");
  });
});
