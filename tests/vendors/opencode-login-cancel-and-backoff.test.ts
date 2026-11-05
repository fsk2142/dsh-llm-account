/**
 * 设备码登录：取消必须 abort 底层 HTTP；`slow_down` 必须按 RFC 增加间隔。
 *
 * 两件事来自 2026-11-05 外部审查的 F02 与 F03，但根因不同，所以分开断言：
 *
 * - **F02**：`beginDeviceFlow` / `pollDeviceToken` / `fetchOAuthOrg` 三个网络函数
 *   原来都不收 `AbortSignal`。`cancel()` 只能改本地状态，已经发出的 `fetch` 继续挂着，
 *   `begin()` 也就永远等不到它。旧的 U05 测试用「手动 `released()` 的 hangingFetch」
 *   验证了状态机，但**没有**验证 socket 会被关掉 —— 这正是审查指出的假绿。
 * - **F03**：`slow_down` 只 `continue`，间隔从不增加。RFC 8628 §3.5 要求
 *   每次 +5 秒（本次及后续）。
 *
 * 本文件的两组断言都从 `createOpencodeLogin()` 进入，直接观察生产代码交给 `fetch`
 * 的 `init.signal` 与 `sleep()` 收到的毫秒数 —— 不是复刻逻辑再测副本。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeLogin } from "../../src/vendors/opencode/login";

const DEVICE_RESPONSE = {
  device_code: "dev-1",
  user_code: "AAAA-BBBB",
  verification_uri_complete: "/console/device?user_code=AAAA-BBBB",
  interval: 5,
  expires_in: 600,
};

/** 记录每次请求的 URL 与 signal；设备码/轮询/工作区各有默认行为，可覆盖。 */
function recordingFetch(overrides: Partial<Record<"code" | "token" | "orgs", (init?: RequestInit) => Promise<Response>>>): {
  fetchImpl: typeof fetch;
  signals: Record<"code" | "token" | "orgs", (AbortSignal | undefined)[]>;
} {
  const signals = { code: [], token: [], orgs: [] } as Record<"code" | "token" | "orgs", (AbortSignal | undefined)[]>;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const text = String(url);
    if (text.endsWith("/console/auth/device/code")) {
      signals.code.push(init?.signal ?? undefined);
      return (overrides.code ?? (async () => new Response(JSON.stringify(DEVICE_RESPONSE), { status: 200 })))(init);
    }
    if (text.endsWith("/console/auth/device/token")) {
      signals.token.push(init?.signal ?? undefined);
      return (overrides.token ?? (async () => new Response(JSON.stringify({ _tag: "DeviceTokenError", error: "authorization_pending" }), { status: 400 })))(init);
    }
    if (text.endsWith("/console/api/orgs")) {
      signals.orgs.push(init?.signal ?? undefined);
      return (overrides.orgs ?? (async () => new Response(JSON.stringify([{ id: "org-1", name: "A" }]), { status: 200 })))(init);
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, signals };
}

/**
 * 永不产出、**但遵守 abort 契约**的响应 —— 真实 `fetch` 就是这样。
 *
 * 桩若忽略 `init.signal`，取消之后 `begin()` 仍然会挂在那里等，测试就超时，
 * 而超时会被误读成「生产代码没处理取消」。这里必须让桩像真 fetch 一样
 * 在 signal abort 时 reject，才能测出「signal 到底有没有传下去」。
 */
function hanging(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal: AbortSignal | null | undefined = init?.signal;
    if (signal === undefined || signal === null) return; // 没有 signal → 永远挂着（正是缺陷形态）
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

describe("F02 · 取消必须中止在途 HTTP", () => {
  it("设备码申请阶段取消 → fetch 收到的 signal 已 abort", async () => {
    const { fetchImpl, signals } = recordingFetch({ code: hanging });
    const login = createOpencodeLogin({ fetchImpl, storeKey: async () => {}, now: () => 1_000_000 });

    const started = login.begin();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals.code, "设备码请求已发出").toHaveLength(1);
    expect(signals.code[0], "**必须把 signal 交给 fetch**").toBeDefined();
    expect(signals.code[0]?.aborted).toBe(false);

    await login.cancel();
    expect(signals.code[0]?.aborted, "取消后设备码请求必须被 abort").toBe(true);
    await expect(started).resolves.toMatchObject({ state: "failed", reason: "cancelled" });
  });

  it("轮询阶段取消 → token 请求被 abort，且不误报成 network 失败", async () => {
    const { fetchImpl, signals } = recordingFetch({ token: hanging });
    let clock = 1_000_000;
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    });

    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals.token.length, "已经进入轮询").toBeGreaterThanOrEqual(1);
    expect(signals.token[0]?.aborted, "轮询请求也带 signal").toBe(false);

    await login.cancel();
    expect(signals.token[0]?.aborted, "取消后轮询必须被 abort").toBe(true);
    expect((await login.status()).reason, "取消不是 network 失败").toBe("cancelled");
  });

  it("读工作区阶段取消 → orgs 请求被 abort", async () => {
    const { fetchImpl, signals } = recordingFetch({
      token: async () =>
        new Response(JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_in: 3600 }), { status: 200 }),
      orgs: hanging,
    });
    let clock = 1_000_000;
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    });

    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals.orgs.length, "拿到 token 后去读工作区").toBe(1);
    expect(signals.orgs[0]?.aborted).toBe(false);

    await login.cancel();
    expect(signals.orgs[0]?.aborted, "取消后工作区查询必须被 abort").toBe(true);
  });
});

describe("F03 · slow_down 必须按 RFC 8628 §3.5 增加间隔", () => {
  it("设备码 interval=5s → slow_down 后 10s → 再之后 15s", async () => {
    const sleeps: number[] = [];
    let clock = 1_000_000;
    let tokenCalls = 0;
    const { fetchImpl } = recordingFetch({
      token: async () => {
        tokenCalls += 1;
        const error = tokenCalls === 1 ? "authorization_pending" : "slow_down";
        return new Response(JSON.stringify({ _tag: "DeviceTokenError", error }), { status: 400 });
      },
    });
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length >= 4) throw new Error("stop");
      },
    });

    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(sleeps.slice(0, 4), "首轮 base，之后每遇 slow_down 加 5s").toEqual([5_000, 5_000, 10_000, 15_000]);
  });

  it("间隔只增不减（连续 pending 不会把 slow_down 的效果抹掉）", async () => {
    const sleeps: number[] = [];
    let clock = 1_000_000;
    let tokenCalls = 0;
    const { fetchImpl } = recordingFetch({
      token: async () => {
        tokenCalls += 1;
        const error = tokenCalls === 2 ? "slow_down" : "authorization_pending";
        return new Response(JSON.stringify({ _tag: "DeviceTokenError", error }), { status: 400 });
      },
    });
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length >= 4) throw new Error("stop");
      },
    });

    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(sleeps.slice(0, 4), "第二次 slow_down 之后保持 10s，不回退").toEqual([5_000, 5_000, 10_000, 10_000]);
  });

  it("每次新的登录尝试从设备码的 interval 重新开始", async () => {
    const sleeps: number[] = [];
    let clock = 1_000_000;
    let tokenCalls = 0;
    const { fetchImpl } = recordingFetch({
      token: async () => {
        tokenCalls += 1;
        const error = tokenCalls <= 2 ? "slow_down" : "authorization_pending";
        return new Response(JSON.stringify({ _tag: "DeviceTokenError", error }), { status: 400 });
      },
    });
    const login = createOpencodeLogin({
      fetchImpl,
      storeKey: async () => {},
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
        if (sleeps.length >= 4) throw new Error("stop");
      },
    });

    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));
    // 两次 slow_down → 5s / 10s / 15s。
    expect(sleeps.slice(0, 3)).toEqual([5_000, 10_000, 15_000]);

    // 新一轮：初值回到 5000（不复用上一轮被抬高过的间隔）。
    await login.cancel();
    const before = sleeps.length;
    await login.begin();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sleeps[before], "新尝试的第一次等待回到 interval").toBe(5_000);
  });
});
