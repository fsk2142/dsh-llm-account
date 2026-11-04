import { describe, expect, it, vi } from "vitest";

import { createOpenDesignLogin, type VelaChild } from "../../src/vendors/opendesign/login";

/**
 * 子进程在「读基线期间」退出也必须被捕获（2026-11-04 外部审查 U04）。
 *
 * ## 审查原文
 *
 * > 基线读取期间子进程成功退出，因监听太晚漏掉 exit；最后 timeout 且未添加账号。
 *
 * ## 根因
 *
 * `#awaitApproval` 里先 `await this.#readProfileText()`（异步读盘），之后才挂
 * `child.on("exit", …)`。授权很快（或磁盘慢）时，子进程可能在那次读取**期间**
 * 退出 —— 事件已经过去，监听器等不到，只能等到 deadline，报「超时」且账号没导入。
 *
 * ## 这份测试怎么复现
 *
 * `readFile` 在第一次调用（读基线）时**同步触发 exit**，模拟「读取完成前就退了」。
 * 修复前那个 exit 落在「还没挂监听」的窗口里，于是必然超时。
 */
const PROMPT = "Open this URL to continue:\nhttps://open-design.ai/cli/activate\nCode: ABCD";
const PROFILE = JSON.stringify({
  profiles: {
    prod: {
      controlKey: "ctrl-1",
      runtimeKey: "rt-1",
      apiUrl: "https://amr-link.open-design.ai/v1",
      linkUrl: "https://amr-link.open-design.ai",
      user: { id: "u1", email: "fsk@example.com", name: "FSK", plan: "GOAT" },
      workspaceId: "ws-1",
    },
  },
});

/** 造一个可手动触发 exit 的假子进程。 */
function fakeChild(): { child: VelaChild; emitExit: (code: number | null) => void } {
  const exitListeners: ((code: number | null) => void)[] = [];
  const child = {
    stdout: {
      on: (event: string, listener: (chunk: unknown) => void) => {
        if (event === "data") queueMicrotask(() => listener(PROMPT));
        return undefined;
      },
    },
    stderr: { on: () => undefined },
    on: (event: string, listener: (...args: never[]) => void) => {
      if (event === "exit") exitListeners.push(listener as unknown as (code: number | null) => void);
      return undefined;
    },
    kill: () => undefined,
  } as unknown as VelaChild;
  return {
    child,
    emitExit: (code) => {
      for (const listener of exitListeners) listener(code);
    },
  };
}

describe("U04 · 读基线期间退出不能丢", () => {
  it("**读基线时子进程退出 → 仍能导入账号**（不该超时）", async () => {
    const storeKey = vi.fn(async () => undefined);
    const { child, emitExit } = fakeChild();
    let reads = 0;

    const login = createOpenDesignLogin({
      spawn: () => child,
      resolveVela: async () => "C:\\vela.exe",
      /**
       * 第一次读（基线）时**同步触发 exit**：这正是审查描述的窗口 ——
       * 子进程在异步读盘期间退出。
       */
      readFile: (async () => {
        reads += 1;
        if (reads === 1) {
          emitExit(0);
          throw new Error("ENOENT: no such file or directory");
        }
        return PROFILE;
      }) as never,
      sleep: async () => undefined,
      /**
       * **递增时钟**：让 deadline 真的会到达。
       *
       * 固定 `now` 会让循环永远不超时，测试卡在 `waiting` —— 那样
       * 「`not.toBe("failed")`」这种弱断言即使实现坏了也能通过（假绿）。
       */
      now: (() => {
        let t = 1_000;
        return () => {
          t += 1_000;
          return t;
        };
      })(),
      timeoutMs: 5_000,
      parseTimeoutMs: 30_000,
      pollIntervalMs: 1_000,
      storeKey,
    });

    const waiting = await login.begin();
    expect(waiting.state, "应当先进入 waiting").toBe("waiting");

    // 等后台收尾。
    for (let i = 0; i < 40; i += 1) {
      if ((await login.status()).state !== "waiting") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const final = await login.status();
    expect(final.state, "子进程已退出且有产物，必须成功").toBe("success");
    expect(storeKey, "账号必须被导入").toHaveBeenCalled();
  });

  it("**对照：没有产物且子进程退出 → 报 no-signin（不是 timeout）**", async () => {
    // 这条盯的是「提前捕获 exit」带来的另一面：退出要能被判定为「用户没批准」，
    // 而不是让循环一直空等到 deadline。
    const storeKey = vi.fn(async () => undefined);
    const { child, emitExit } = fakeChild();

    const login = createOpenDesignLogin({
      spawn: () => child,
      resolveVela: async () => "C:\\vela.exe",
      readFile: (async () => {
        emitExit(0);
        throw new Error("ENOENT: no such file or directory");
      }) as never,
      sleep: async () => undefined,
      /**
       * **递增时钟**：让 deadline 真的会到达。
       *
       * 固定 `now` 会让循环永远不超时，测试卡在 `waiting` —— 那样
       * 「`not.toBe("failed")`」这种弱断言即使实现坏了也能通过（假绿）。
       */
      now: (() => {
        let t = 1_000;
        return () => {
          t += 1_000;
          return t;
        };
      })(),
      timeoutMs: 5_000,
      parseTimeoutMs: 30_000,
      pollIntervalMs: 1_000,
      storeKey,
    });

    await login.begin();
    for (let i = 0; i < 40; i += 1) {
      if ((await login.status()).state !== "waiting") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const final = await login.status();
    expect(final.state, "必须落定（不能卡在 waiting）").toBe("failed");
    expect(final.reason, "有 exit 就该判定为没登录，而不是干等超时").not.toBe("timeout");
    expect(storeKey, "没产物就不该导入").not.toHaveBeenCalled();
  });
});

describe("U04 · 致命场景：重复登录同一账号", () => {
  /**
   * 这是「漏掉 exit」**唯一致命**的路径（代码注释也写明了）：
   *
   * 重复登录**同一个**账号时，vela 写回的 profile 与登录前**完全一致**
   * （密钥没刷新）。此时：
   *
   * - 「内容与基线不同」判定不成立；
   * - 唯一的成功证据就是**子进程正常退出**（`exit`）。
   *
   * 如果 exit 在「读基线期间」发生而没被捕获：
   * 循环永远等不到退出信号 → 一路到 deadline → 报 `timeout`，账号不导入。
   *
   * 短日志里的 `missed-exit` 正是这种形态。
   */
  it("**内容没变 + 子进程已退出 → 仍要成功**", async () => {
    const storeKey = vi.fn(async () => undefined);
    const { child, emitExit } = fakeChild();
    let exitedOnce = false;

    const login = createOpenDesignLogin({
      spawn: () => child,
      resolveVela: async () => "C:\\vela.exe",
      /**
       * 每次读都返回**同一份** profile：重复登录同一账号的真实形态。
       * 第一次（读基线）时就触发 exit —— 正是被漏掉的那个窗口。
       */
      readFile: (async () => {
        /**
         * **只在第一次读取时触发退出** —— 那才是「读基线期间」这个窗口。
         *
         * 若每次读取都 emitExit，即使实现把监听的挂载放在基线之后，
         * 后续读取时的监听已经把事件收到了，变异就跑不出来（假绿）。
         */
        if (!exitedOnce) {
          exitedOnce = true;
          emitExit(0);
        }
        return PROFILE;
      }) as never,
      sleep: async () => undefined,
      now: (() => {
        let t = 1_000;
        return () => {
          t += 1_000;
          return t;
        };
      })(),
      timeoutMs: 5_000,
      parseTimeoutMs: 30_000,
      pollIntervalMs: 1_000,
      storeKey,
    });

    await login.begin();
    for (let i = 0; i < 40; i += 1) {
      if ((await login.status()).state !== "waiting") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const final = await login.status();
    expect(final.state, "内容没变但有正常退出，必须算成功").toBe("success");
    expect(storeKey, "重复登录也要导入（否则界面显示成功却无账号）").toHaveBeenCalled();
  });
});
