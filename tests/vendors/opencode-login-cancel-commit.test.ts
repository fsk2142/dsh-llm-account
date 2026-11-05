/**
 * F12：取消与 `storeKey` 写入之间的**状态一致性**（2026-11-05 外部审查）。
 *
 * ## 审查说的问题，我先复现了
 *
 * 注入一个可控的 `storeKey`，在它挂住时调用 `cancel()`，再放行 —— 结果：
 * 凭据写入了，而状态停在 `failed/cancelled`。**机制描述完全正确。**
 *
 * ## 但修法不是「补偿删除」
 *
 * 审查建议「代际 + 条件写入 + 补偿回滚」。查过实现后我认为那张方案代价大于收益：
 *
 * - `storeKey` 落到 `accounts.add()` → `#transaction()` → 设置文档的修订围栏写入，
 *   底层凭据接口**没有条件写/事务**，写了就是写了；
 * - 按 ref 盲删可能误删用户随后新登录成功的账号（审查自己也提到了这点）。
 *
 * 关键在于：**用户点"取消"的意图是"停止等待"，不是"如果已经验证成功了就把账号撤销"。**
 * 真正的问题不是"账号被写入了"，而是**状态说了谎** —— UI 显示已取消，账号表里却
 * 多了一条，用户下次看到一个自己以为没添加过的账号。
 *
 * ## 所以修的是「状态与持久化一致」
 *
 * - 交出去**之前**：任何取消都不写（原有的复检已保证）；
 * - 交出去**之后**：写入可能已完成 → 状态落 `success`，并用 `detail` 说明
 *   "在取消前已写入完成"。宁可诚实告知，也不要两处不一致。
 *
 * 这比"假装什么都没发生"诚实，也比"盲删可能不属于自己的账号"安全。
 */
import { describe, expect, it, vi } from "vitest";

import { createOpencodeLogin } from "../../src/vendors/opencode/login";

/** 一个 200 JSON 响应。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/**
 * 按 **URL** 作答的成功脚本：可被多次登录复用（每个尝试各自走一遍）。
 *
 * 不能用「调用计数」那种写法 —— 第二次 `begin()` 会接着旧的计数往下取，
 * 拿到的响应完全对不上（`/device/code` 收到 org 列表），测试就假失败。
 * @param onToken - 可选：每次 token 轮询时的回调（用来控制时序）。
 */
function byUrlScript(onToken?: () => void): typeof fetch {
  let tokenCalls = 0;
  return (async (url: string) => {
    const text = String(url);
    if (text.includes("/device/code")) {
      return json({
        device_code: "d",
        user_code: "U",
        verification_uri: "/console/device",
        expires_in: 900,
        interval: 1,
      });
    }
    if (text.includes("/device/token")) {
      tokenCalls += 1;
      onToken?.();
      // 第一拍给结构化 pending（走一遍真实轮询），之后直接给 token。
      if (tokenCalls === 1) return json({ error: "authorization_pending" }, 400);
      return json({ access_token: "a", refresh_token: "r", expires_in: 3600 });
    }
    return json([{ id: "org-1", name: "Org" }]);
  }) as unknown as typeof fetch;
}

/** 等到 `predicate` 成立（最多 200 个宏任务）。 */
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("F12 · storeKey 等待期间取消", () => {
  it("**写入已完成时状态必须是 success，不能停在 cancelled**", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written = 0;
    const storeKey = vi.fn(async () => {
      written += 1;
      await gate;
    });

    const login = createOpencodeLogin({ fetchImpl: byUrlScript(), storeKey, now: () => Date.now(), sleep: async () => {} });
    await login.begin();
    await until(() => storeKey.mock.calls.length > 0);
    expect(storeKey, "已进入写入").toHaveBeenCalled();

    // 就在写入挂住时取消。
    await login.cancel();
    expect((await login.status()).reason, "取消立刻生效").toBe("cancelled");

    // 放行写入：它已经完成，状态必须跟上事实。
    release?.();
    await until(() => written > 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const after = await login.status();
    expect(written, "凭据确实写入了").toBe(1);
    expect(after.state, "**状态必须与持久化一致**").toBe("success");
    expect(after.detail, "并且说明这是取消前的写入").toContain("取消前");
  });

  it("**取消在写入之前 → 绝不写入**（原有纪律不能退化）", async () => {
    let orgCalls = 0;
    const fetchImpl = (async (url: string) => {
      const text = String(url);
      if (text.includes("/device/code")) {
        return json({ device_code: "d", user_code: "U", verification_uri: "/console/device", expires_in: 900, interval: 1 });
      }
      if (text.includes("/device/token")) {
        return json({ access_token: "a", refresh_token: "r", expires_in: 3600 });
      }
      orgCalls += 1;
      /**
       * 让 **org 查询挂住**，在 storeKey 之前留出取消窗口。
       *
       * 原来直接返回 org 再 `until(orgCalls > 0)` 太晚：fetch 一返回，同一次微任务里
       * 就走到 storeKey 了，取消根本插不进去（测试会假失败）。挂住之后取消才有位置，
       * 而且顺带验证了 F02 的 signal 透传 —— 只有取消能让它结束。
       */
      return await new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("no abort observed")), 2_000);
      });
    }) as unknown as typeof fetch;

    const storeKey = vi.fn(async () => {});
    const login = createOpencodeLogin({ fetchImpl, storeKey, now: () => 1_000_000, sleep: async () => {} });

    await login.begin();
    await until(() => orgCalls > 0);
    expect(storeKey, "此刻还卡在 org 查询，确实没写入").not.toHaveBeenCalled();
    await login.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(storeKey, "**取消之后不该写入**").not.toHaveBeenCalled();
    expect((await login.status()).state).toBe("failed");
  });

  it("取消后立即重登：旧尝试不得改写新尝试的状态", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const storeKey = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await gate;
    });

    const login = createOpencodeLogin({ fetchImpl: byUrlScript(), storeKey, now: () => Date.now(), sleep: async () => {} });
    await login.begin();
    await until(() => storeKey.mock.calls.length > 0);

    // 取消 → 立刻重登（新一代）。
    await login.cancel();
    const second = login.begin();
    await until(() => calls >= 2);
    release?.();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 新尝试自己会走到 success；关键是它没有被旧写入的收尾打乱。
    const status = await login.status();
    expect(status.state, "新尝试正常完成").toBe("success");
  });

  it("写入失败仍然是 `unavailable`（失败路径没被改动）", async () => {
    const storeKey = vi.fn(async () => {
      throw new Error("slot taken");
    });
    const login = createOpencodeLogin({ fetchImpl: byUrlScript(), storeKey, now: () => Date.now(), sleep: async () => {} });

    await login.begin();
    await until(() => storeKey.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const status = await login.status();
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("unavailable");
  });
});
