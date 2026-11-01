/**
 * S01 第四处缺口：**用户写进行中新请求取得的代际**
 *
 * ## 报告给出的精确时序
 *
 * 只在 `runUserWrite` 入队时 bump 还有一个漏洞：
 *
 * ```
 * T0  用户点换 key → runUserWrite 入队，代际 E+1（用户 set 还在队列里没执行）
 * T1  新请求开始 → epochOf() 读到 E+1，resolveStored 读到**旧 OAuth**
 * T2  用户 set 提交完成（槽里现在是新 key）
 * T3  T1 的刷新写回：校验 E+1 === E+1 → **通过** → 把旧 OAuth 写回去
 *     ↑ 用户的新 key 被覆盖
 * ```
 *
 * 报告实测提交顺序为 `key → oauth`，`userKeySurvives = false`。
 *
 * ## 修法
 *
 * `runUserWrite` **完成后再推进一次代际**。于是 T1 那种「在用户写进行中取得的代际」
 * 在 T3 校验时看到 E+2，放弃写回。
 *
 * 代价是一次本来能成功的刷新白跑一次 —— 正确取舍：宁可多刷一次，不能让旧值盖掉
 * 用户刚存的东西。
 */
import { describe, expect, it } from "vitest";

import { createCredentialGuard } from "../../src/core/credential-guard";

describe("S01：用户写进行中取得的代际必须失效", () => {
  it("**报告的时序：用户 set 未提交时新请求借到新代际，刷新仍会覆盖**", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    /** 让用户写的 `write()` 挂住，模拟「set 尚未提交」。 */
    let releaseUserWrite = () => {};
    const userWrite = guard.runUserWrite("acc", async () => {
      await new Promise<void>((resolve) => {
        releaseUserWrite = resolve;
      });
      written.push("user-key");
    });
    /**
     * **等一个宏任务**，让 `write()` 真正开始执行 —— `runUserWrite` 的写体跑在
     * `Promise.resolve().then(...)` 里，所以刚调用的那一刻 `releaseUserWrite`
     * 还是初始空函数。第一版没等这一拍，`releaseUserWrite()` 什么也没做，
     * 于是 `await userWrite` 永远挂着（00ms 超时）。
     */
    await new Promise((resolve) => setTimeout(resolve, 10));
    /**
     * T1：用户写还没提交，新请求开始并取得「当前」代际 ——
     * 那是 `runUserWrite` 入队时 bump 出来的（E+1）。
     */
    const epochSeenByRefresh = guard.epochOf("acc");
    // T2：放行用户写，让它完成（完成时会再 bump）。
    releaseUserWrite();
    await userWrite;
    /**
     * T3：刷新用它在 T1 看到的代际去写回旧 OAuth。
     *
     * **必须先发起、再断言**：`guard.run` 会排队等用户写完成，所以不能在这之前
     * await 它（那会死锁 —— 第一版就是这样超时的）。
     *
     * 修复前：E+1 === E+1 → 通过 → 旧 OAuth 覆盖用户的新 key。
     * 修复后：代际已到 E+2 → 放弃。
     */
    const wrote = await guard.run("acc", epochSeenByRefresh, async () => {
      written.push("stale-oauth");
    });
    expect(wrote, "**刷新写回必须放弃**（用户写完成后代际又推进了）").toBe(false);
    expect(written, "只有用户的新 key 落地").toEqual(["user-key"]);
  });
  it("用户写完成之后**新发起**的刷新可以正常写（代际取的是最新的）", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    await guard.runUserWrite("acc", async () => {
      written.push("user-key");
    });
    // 之后发起的刷新：取当前代际，应当能写。
    const epoch = guard.epochOf("acc");
    const wrote = await guard.run("acc", epoch, async () => {
      written.push("fresh-oauth");
    });
    expect(wrote, "之后发起的刷新不该被误杀").toBe(true);
    expect(written).toEqual(["user-key", "fresh-oauth"]);
  });

  it("用户写失败时代际也推进（不能留下一个「借来的」代际）", async () => {
    const guard = createCredentialGuard();
    await expect(
      guard.runUserWrite("acc", async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow(/disk full/u);
    /**
     * 写失败了，但期间可能有请求借到了入队时的代际 —— 它们同样必须失效：
     * 那些请求读到的是**写入前**的槽值。
     */
    const stale = guard.epochOf("acc") - 1;
    const wrote = await guard.run("acc", stale, async () => {});
    expect(wrote, "写失败也要让借来的代际失效").toBe(false);
  });
});
