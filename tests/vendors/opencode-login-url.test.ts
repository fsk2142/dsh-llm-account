/**
 * opencode 网页登录的**真机报障**回归（2026-11-02）。
 *
 * 用户报的两个症状：
 *
 * 1. **给的网页链接无法打开**；
 * 2. **登录界面很快消失，来不及授权**。
 *
 * ## 症状 1 的根因（真机实测服务端响应）
 *
 * ```json
 * {
 *   "verification_uri": "/console/device",
 *   "verification_uri_complete": "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli"
 * }
 * ```
 *
 * 两个都是**相对路径**。旧实现：
 *
 * - **优先取 `verification_uri`** —— 不含 `user_code`，用户还得手输；
 * - **原样透传给界面** —— `isHttpUrl("/console/device")` 为 `false`，
 *   界面不给 `href`，链接**根本点不动**。
 *
 * ## 症状 2 的根因
 *
 * 轮询 `1s` × 连续失败 `3` 次 = **3 秒**就把等待面板打掉。授权是用户手动操作，
 * 服务端窗口 600 秒 —— 3 秒显然太短。
 */
import { describe, expect, it } from "vitest";

import { LOGIN_POLL_MAX_MISSES, LOGIN_POLL_MS } from "../../src/client/seams";
import { beginDeviceFlow } from "../../src/vendors/opencode/oauth";

/** 造一个假的 `device/code` 响应（真机形状）。 */
function deviceCodeResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      device_code: "DEV-CODE",
      user_code: "RVFK-SRHG",
      verification_uri: "/console/device",
      verification_uri_complete: "/console/device?user_code=RVFK-SRHG&client_id=opencode-cli",
      interval: 5,
      expires_in: 600,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * 造一个只回答 device/code 的 fetch。
 * @param response - 要返回的响应。
 * @returns 注入用的 fetch。
 */
function fetchOf(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

describe("opencode 网页登录：验证链接必须可打开", () => {
  it("**相对路径要补成绝对 URL**（真机：/console/device 点不动）", async () => {
    const device = await beginDeviceFlow({ fetchImpl: fetchOf(deviceCodeResponse()) });
    expect(device.verificationUri, "必须是可直接打开的绝对地址").toMatch(/^https?:\/\//u);
    expect(device.verificationUri).toBe(
      "https://opencode.ai/console/device?user_code=RVFK-SRHG&client_id=opencode-cli",
    );
  });

  it("**优先用 verification_uri_complete**（它带验证码，用户不用手输）", async () => {
    const device = await beginDeviceFlow({ fetchImpl: fetchOf(deviceCodeResponse()) });
    expect(device.verificationUri, "应当包含 user_code").toContain("RVFK-SRHG");
  });

  it("服务端给绝对地址时原样保留（不重复拼域名）", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: fetchOf(
        deviceCodeResponse({
          verification_uri_complete: "https://opencode.ai/console/device?user_code=X-Y",
        }),
      ),
    });
    expect(device.verificationUri).toBe("https://opencode.ai/console/device?user_code=X-Y");
  });

  it("没有 `verification_uri_complete` 时退回 `verification_uri`（仍补绝对地址）", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: fetchOf(
        deviceCodeResponse({
          verification_uri_complete: undefined,
          verification_uri: "/console/device",
        }),
      ),
    });
    expect(device.verificationUri, "兜底也要能点").toBe("https://opencode.ai/console/device");
  });

  it("自定义 authBase 时按它补全", async () => {
    const device = await beginDeviceFlow({
      fetchImpl: fetchOf(deviceCodeResponse({ verification_uri_complete: "/console/device?user_code=X" })),
      authBase: "https://staging.example.test",
    });
    expect(device.verificationUri).toBe("https://staging.example.test/console/device?user_code=X");
  });

  it("两种字段都缺时报错（而不是给出不可点的链接）", async () => {
    await expect(
      beginDeviceFlow({
        fetchImpl: fetchOf(
          deviceCodeResponse({
            verification_uri: undefined,
            verification_uri_complete: undefined,
          }),
        ),
      }),
    ).rejects.toThrow(/missing device_code\/user_code\/verification_uri/u);
  });
});

describe("opencode 网页登录：等待面板不能一闪就没", () => {
  it("**失败判定窗口至少 15 秒**（原来 3 秒，用户来不及授权）", () => {
    const windowMs = LOGIN_POLL_MS * LOGIN_POLL_MAX_MISSES;
    expect(windowMs, `当前 ${LOGIN_POLL_MS}ms × ${LOGIN_POLL_MAX_MISSES} 次 = ${windowMs}ms`).toBeGreaterThanOrEqual(
      15_000,
    );
  });

  it("轮询密度不过分（10 分钟窗口内的调用数应可控）", () => {
    /** 服务端给的授权窗口是 600 秒。 */
    const callsInWindow = (600 * 1_000) / LOGIN_POLL_MS;
    expect(callsInWindow, "10 分钟内不该打上百次请求").toBeLessThanOrEqual(250);
  });

  it("仍然足够灵敏（能及时发现授权成功）", () => {
    expect(LOGIN_POLL_MS, "间隔不该长到让用户等太久").toBeLessThanOrEqual(5_000);
  });
});
