/**
 * 凭据写入守卫的语义测试（2026-11-01 修 S01 第二版的回归）。
 *
 * ## 要证明什么
 *
 * 凭据覆盖的本质是「读—判—写」不原子：
 *
 * ```
 * T0  刷新开始，记住代际
 * T1  刷新返回，准备写
 * T2  用户换 key（代际 +1）
 * T3  刷新继续写 → 覆盖用户的新 key
 * ```
 *
 * `credentialGuard.run(key, expectedEpoch, write)` 必须在**真正写之前**校验代际：
 * 代际已变就放弃，并且返回 `false` 让调用方知道没写。
 *
 * ## 边界（这条守卫不保证什么）
 *
 * 只保证**本插件内**对同一 ref 的写入顺序一致。宿主凭据页或别的插件的写入不经过
 * 这个队列 —— 插件侧做不到跨进程原子写（宿主 `CredentialPort` 没有 CAS）。
 */
import { describe, expect, it } from "vitest";

import { createCredentialGuard } from "../../src/core/credential-guard";

describe("createCredentialGuard", () => {
  it("代际一致时正常写入，返回 true", async () => {
    const guard = createCredentialGuard();
    const writes: string[] = [];
    const epoch = guard.epochOf("acc");
    const wrote = await guard.run("acc", epoch, async () => {
      writes.push("new-value");
    });
    expect(wrote).toBe(true);
    expect(writes).toEqual(["new-value"]);
  });

  it("**代际已推进 → 放弃写入**（这条就是 S01 的核心）", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    // 刷新开始前记下代际。
    const epochAtStart = guard.epochOf("acc");
    // 用户换 key（推进代际）—— 在刷新写回之前。
    guard.bump("acc");
    const wrote = await guard.run("acc", epochAtStart, async () => {
      written.push("stale-refresh");
    });
    expect(wrote, "代际不符必须返回 false").toBe(false);
    expect(written, "绝不能用旧刷新覆盖用户的新 key").toEqual([]);
  });

  it("排队期间推进代际也会被拦住（不只是入队前的检查）", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    const epoch = guard.epochOf("acc");
    /**
     * 第一个写**先完成**（用它占住队列、并在 bump 之前落地）。
     *
     * 注意时序：`bump` 必须在第一个写**开始执行之后、第二个写执行之前**发生。
     * 第一个写内部若还挂着 await，bump 会让它也看到新代际 —— 那是正确行为
     * （它的写同样过期了），但测不出「排队期间」这个边界。
     */
    const first = await guard.run("acc", epoch, async () => {
      written.push("first");
    });
    expect(first).toBe(true);
    // 第二个写排在队尾，用同一个旧代际 —— 此时推进代际。
    const second = guard.run("acc", epoch, async () => {
      written.push("second");
    });
    guard.bump("acc");
    const secondWrote = await second;
    expect(secondWrote, "代际在第二个写落地前变了，必须放弃").toBe(false);
    expect(written).toEqual(["first"]);
  });

  it("**写操作已经落地之后**再推进代际，不影响已完成的那次", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    const epoch = guard.epochOf("acc");
    const wrote = await guard.run("acc", epoch, async () => {
      written.push("done");
    });
    expect(wrote).toBe(true);
    // 之后用户换 key：不影响已经写完的那次。
    guard.bump("acc");
    expect(written).toEqual(["done"]);
  });

  it("同 ref 的写入串行执行（不并发）", async () => {
    const guard = createCredentialGuard();
    const order: string[] = [];
    const epoch = guard.epochOf("acc");
    /** 每个写耗时不同：若并发，短的会先完成。 */
    const slow = guard.run("acc", epoch, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("slow");
    });
    const fast = guard.run("acc", epoch, async () => {
      order.push("fast");
    });
    await Promise.all([slow, fast]);
    expect(order, "必须先完成先入队的").toEqual(["slow", "fast"]);
  });

  it("不同 ref 之间不互相排队", async () => {
    const guard = createCredentialGuard();
    const order: string[] = [];
    const slow = guard.run("a", guard.epochOf("a"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a");
    });
    const fast = guard.run("b", guard.epochOf("b"), async () => {
      order.push("b");
    });
    await Promise.all([slow, fast]);
    expect(order, "不同账号不该互相等").toEqual(["b", "a"]);
  });

  it("写操作抛错时队列仍能继续（不会卡死后续写）", async () => {
    const guard = createCredentialGuard();
    const epoch = guard.epochOf("acc");
    await expect(
      guard.run("acc", epoch, async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow(/disk full/u);
    // 后续写必须照常执行。
    const wrote = await guard.run("acc", epoch, async () => {});
    expect(wrote).toBe(true);
  });
});

describe("runUserWrite：用户的写必须无条件落地（S01 第三版）", () => {
  it("**用户写无条件执行**，即使代际已变", async () => {
    const guard = createCredentialGuard();
    const written: string[] = [];
    guard.bump("acc");
    guard.bump("acc");
    await guard.runUserWrite("acc", async () => {
      written.push("user-key");
    });
    expect(written, "用户点换 key 必须落地，不能因代际变化被取消").toEqual(["user-key"]);
  });

  it("**用户写会让更早发起的刷新写回放弃**（核心场景）", async () => {
    /**
     * 报告的真实时序：
     *   T0  刷新开始，记下代际 E
     *   T1  用户换 key（runUserWrite）
     *   T2  刷新返回，用 E 校验 → 必须失败
     */
    const guard = createCredentialGuard();
    const written: string[] = [];
    const epochOfRefresh = guard.epochOf("acc");
    // 用户换 key（在刷新写回之前）。
    await guard.runUserWrite("acc", async () => {
      written.push("user-key");
    });
    // 刷新现在想写回旧 blob。
    const wrote = await guard.run("acc", epochOfRefresh, async () => {
      written.push("stale-refresh");
    });
    expect(wrote, "刷新写回必须放弃").toBe(false);
    expect(written, "**只有用户的新 key 落地**").toEqual(["user-key"]);
  });

  it("**用户写入队即推进代际 → 在途的刷新写回被取消**（不会交错）", async () => {
    /**
     * ## 为什么期望是 `["user"]` 而不是 `["refresh", "user"]`
     *
     * 第一版我写成了「刷新先完成，用户写再落地」—— **测试失败说明实现是对的、
     * 我的期望错了**。
     *
     * `runUserWrite` 在**入队那一刻**就推进代际（而不是等轮到它执行）。所以已经在
     * 队列里等着的刷新写回，轮到它时校验失败 → **不会写**。
     *
     * 这正是想要的语义：用户的意图一旦表达，所有「更早发起」的后台写都该作废 ——
     * 而不是让旧刷新先落盘、用户再覆盖一次（那中间有窗口，进程崩溃就会留下旧值）。
     */
    const guard = createCredentialGuard();
    const order: string[] = [];
    const epoch = guard.epochOf("acc");
    // 刷新写回先入队，故意慢。
    const refresh = guard.run("acc", epoch, async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("refresh");
    });
    // 用户写在它之后入队：入队即 bump，刷新校验会失败。
    const userWrite = guard.runUserWrite("acc", async () => {
      order.push("user");
    });
    const [refreshWrote] = await Promise.all([refresh, userWrite]);
    expect(refreshWrote, "刷新写回必须放弃（代际已推进）").toBe(false);
    expect(order, "**只有用户写落地**").toEqual(["user"]);
  });

  it("刷新**已经通过校验并在执行中**时，用户写仍排在它之后（不交错）", async () => {
    /**
     * 另一条边界：刷新已经开始执行（校验通过、正在 await 写），此时用户入队。
     * 队列保证用户写等它完成 —— 不会两个 `set` 交错。
     */
    const guard = createCredentialGuard();
    const order: string[] = [];
    const epoch = guard.epochOf("acc");
    /** 让刷新的写「已经进入函数体」但还没完成。 */
    let releaseRefresh = () => {};
    const refresh = guard.run("acc", epoch, async () => {
      await new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      order.push("refresh-done");
    });
    // 等刷新真的进入函数体（校验已通过）。
    await new Promise((resolve) => setTimeout(resolve, 10));
    const userWrite = guard.runUserWrite("acc", async () => {
      order.push("user");
    });
    releaseRefresh();
    await Promise.all([refresh, userWrite]);
    expect(order, "刷新先落盘，用户写随后（严格串行）").toEqual(["refresh-done", "user"]);
  });

  it("用户写失败时队列仍能继续", async () => {
    const guard = createCredentialGuard();
    await expect(
      guard.runUserWrite("acc", async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow(/write failed/u);
    const written: string[] = [];
    await guard.runUserWrite("acc", async () => {
      written.push("after");
    });
    expect(written).toEqual(["after"]);
  });
});
