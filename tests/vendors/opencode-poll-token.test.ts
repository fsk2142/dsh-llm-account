/**
 * `pollDeviceToken` 的**真机报障根因**回归（2026-11-02）。
 *
 * ## 症状
 *
 * 用户点 opencode「网页登录」→ 浏览器授权 → 界面显示
 * **「登录服务暂时不可用」**，账户也没添加。
 *
 * ## 真机实测（`POST /console/auth/device/token`）
 *
 * | 请求体 | 服务端返回 |
 * | --- | --- |
 * | `{client_id, device_code}` | **HTTP 400 + 空 body** |
 * | `{client_id, device_code, grant_type}` | `{"_tag":"DeviceTokenError","error":"authorization_pending"}` |
 *
 * 缺 `grant_type` 时服务端当成**畸形请求**，返回空 body。于是客户端：
 *
 * 1. `readJson` 拿到 `undefined`；
 * 2. `error` 取不到 → 落到 `status: "error"`；
 * 3. 登录结算成 `reason: "unavailable"` —— **第一次轮询就死**，用户还没授权完。
 *
 * 这条测试锁住「请求体必须带 grant_type」，以及错误映射的完整语义。
 */
import { describe, expect, it } from "vitest";

import { DEVICE_CODE_GRANT_TYPE, pollDeviceToken } from "../../src/vendors/opencode/oauth";

/** 造一个设备码（形状与 `beginDeviceFlow` 的返回一致）。 */
const DEVICE = {
  deviceCode: "DEV-CODE",
  userCode: "RVFK-SRHG",
  verificationUri: "https://opencode.ai/console/device?user_code=RVFK-SRHG",
  intervalMs: 5_000,
  expiresAt: Date.now() + 600_000,
};

/**
 * 造一个记录请求体的假 fetch。
 * @param response - 要返回的响应。
 * @returns fetch 与捕获到的请求体解析结果。
 */
function fetchCapturing(response: Response): { fetchImpl: typeof fetch; bodies: () => unknown[] } {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const raw = init?.body;
    bodies.push(typeof raw === "string" ? JSON.parse(raw) : raw);
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies: () => bodies };
}

describe("pollDeviceToken：请求体必须带 grant_type", () => {
  it("**缺 grant_type 时服务端返回空 400 → 流程第一拍就死**（真机根因）", async () => {
    /**
     * 这条断言的是**请求体形状**：没有 `grant_type`，真机就会得到空 400。
     * 有了它，服务端才给结构化的 `error`。
     */
    const { fetchImpl, bodies } = fetchCapturing(
      new Response(JSON.stringify({ _tag: "DeviceTokenError", error: "authorization_pending" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await pollDeviceToken({ fetchImpl }, DEVICE);
    const body = bodies()[0] as Record<string, unknown>;
    expect(body.grant_type, "**必须带 grant_type**，否则服务端返回空 400").toBe(DEVICE_CODE_GRANT_TYPE);
    expect(body.client_id).toBe("opencode-cli");
    expect(body.device_code).toBe("DEV-CODE");
  });

  it("pending → 继续轮询（不是失败）", async () => {
    const result = await pollDeviceToken(
      {
        fetchImpl: fetchCapturing(
          new Response(JSON.stringify({ _tag: "DeviceTokenError", error: "authorization_pending" }), {
            status: 400,
          }),
        ).fetchImpl,
      },
      DEVICE,
    );
    expect(result).toEqual({ status: "pending" });
  });

  it("slow_down / access_denied / expired_token 各自映射", async () => {
    const cases: Array<[string, string]> = [
      ["slow_down", "slow_down"],
      ["access_denied", "denied"],
      ["expired_token", "expired"],
    ];
    for (const [error, expected] of cases) {
      const result = await pollDeviceToken(
        {
          fetchImpl: fetchCapturing(
            new Response(JSON.stringify({ _tag: "DeviceTokenError", error }), { status: 400 }),
          ).fetchImpl,
        },
        DEVICE,
      );
      expect(result, `error=${error}`).toEqual({ status: expected });
    }
  });

  it("**空 body 的 400 兜底按 pending**（不让用户还有机会时把流程打死）", async () => {
    /**
     * 上一版正是这里出问题：空 body 落进 `status: "error"`。
     * 现在即使服务端再出现「空 body 但其实是 pending」，也继续轮询到 `expiresAt`。
     */
    const result = await pollDeviceToken(
      { fetchImpl: fetchCapturing(new Response("", { status: 400 })).fetchImpl },
      DEVICE,
    );
    expect(result).toEqual({ status: "pending" });
  });

  it("5xx 仍按 error（真正的服务端故障不该被当成 pending）", async () => {
    const result = await pollDeviceToken(
      { fetchImpl: fetchCapturing(new Response("", { status: 503 })).fetchImpl },
      DEVICE,
    );
    expect(result.status).toBe("error");
  });

  it("成功 → 解析出 access/refresh/expiresAt", async () => {
    const now = 1_700_000_000_000;
    const result = await pollDeviceToken(
      {
        fetchImpl: fetchCapturing(
          new Response(
            JSON.stringify({
              _tag: "DeviceTokenSuccess",
              access_token: "ACC",
              refresh_token: "REF",
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        ).fetchImpl,
        now: () => now,
      },
      DEVICE,
    );
    expect(result).toMatchObject({ status: "success", access: "ACC", refresh: "REF" });
    expect(result).toHaveProperty("expiresAt", now + 3_600_000);
  });

  it("成功载荷包在 `value` 里也能解析（_tag 风格编码）", async () => {
    const result = await pollDeviceToken(
      {
        fetchImpl: fetchCapturing(
          new Response(
            JSON.stringify({
              _tag: "Success",
              value: { access_token: "ACC2", refresh_token: "REF2", expires_in: 60 },
            }),
            { status: 200 },
          ),
        ).fetchImpl,
      },
      DEVICE,
    );
    expect(result).toMatchObject({ status: "success", access: "ACC2" });
  });

  it("成功但缺字段 → error（不静默返回半成品）", async () => {
    const result = await pollDeviceToken(
      {
        fetchImpl: fetchCapturing(
          new Response(JSON.stringify({ access_token: "ACC" }), { status: 200 }),
        ).fetchImpl,
      },
      DEVICE,
    );
    expect(result.status).toBe("error");
  });
});
