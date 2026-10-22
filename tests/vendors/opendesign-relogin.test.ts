/**
 * 重复登录**同一个账号**时不该误报「没有登录」（2026-10-22 自查发现）。
 *
 * ## 场景
 *
 * 用户已经登录过账号 A，文件里是 A 的内容。此时再点一次「网页登录」，重新登录
 * 账号 A —— 如果 vela 写入的内容与登录前**完全相同**（密钥没刷新），
 * 基于「内容与基线不同」的判据会认为「文件没变 → 没登录」，报 `no-signin`。
 *
 * 但那次登录其实是成功的：用户在浏览器里批准了，vela 也正常退出。
 *
 * ## 判据该怎么改
 *
 * 「内容变了」不是唯一证据，**「子进程正常退出且产物有效」也是证据**。
 * 正确的组合是：
 *
 * - 内容与基线**不同** 且能解析 → 成功（本次登录写入了新内容）
 * - 内容与基线**相同** 但子进程**已正常退出** → 也成功（本次登录重新签发了同一份内容）
 * - 内容与基线相同 且子进程**没退出** → 继续等（用户还没批准）
 * - 子进程正常退出、产物无效 → 失败
 *
 * 简单说：**基线只用来判断「是否已经写入」，不能用来否决「已经发生的事实」。**
 */
import { describe, expect, it, vi } from "vitest";

import { createOpenDesignLogin, type OpenDesignLoginDeps } from "../../src/vendors/opendesign/login";

/** 同一个账号的登录产物（重复登录时 vela 写回完全相同的这份）。 */
const SAME_PROFILE = JSON.stringify({
  profiles: {
    prod: {
      controlKey: "ctrl-A",
      runtimeKey: "rt-A",
      apiUrl: "https://amr-link.open-design.ai",
      linkUrl: "https://amr-api.open-design.ai",
      user: { id: "uA", email: "a@example.com", name: "a" },
    },
  },
});

/** vela 的授权提示。 */
const VELA_PROMPT = "Open this URL to continue:\nhttps://open-design.ai/cli/activate?deviceId=abc\nCode: WXYZ\n";

/** 造一个能输出提示、可控退出的假子进程。 */
function fakeChild(): {
  child: never;
  emitExit: (code: number) => void;
} {
  const exitListeners: ((code: number | null) => void)[] = [];
  const dataListeners: ((chunk: unknown) => void)[] = [];
  let buffered = VELA_PROMPT;
  const child = {
    stdout: {
      on: (event: string, listener: (chunk: unknown) => void) => {
        if (event !== "data") return undefined;
        dataListeners.push(listener);
        if (buffered !== "") listener(buffered);
        return undefined;
      },
    },
    stderr: { on: () => undefined },
    on: (event: string, listener: (code: number | null) => void) => {
      if (event === "exit") exitListeners.push(listener);
      return undefined;
    },
    kill: () => undefined,
  } as never;
  return {
    child,
    emitExit: (code: number) => {
      for (const listener of exitListeners) listener(code);
    },
  };
}

/** 造登录依赖。 */
function loginDeps(overrides: Partial<OpenDesignLoginDeps> = {}): OpenDesignLoginDeps {
  return {
    storeKey: vi.fn(async () => undefined),
    spawn: () => fakeChild().child,
    readFile: async () => SAME_PROFILE,
    sleep: async () => undefined,
    now: () => 1_000,
    resolveVela: async () => "C:\\vela.exe",
    timeoutMs: 180_000,
    parseTimeoutMs: 30_000,
    pollIntervalMs: 1_000,
    ...overrides,
  };
}

/** 排空后台轮询。 */
async function settle(login: ReturnType<typeof createOpenDesignLogin>): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const status = await login.status();
    if (status.state !== "waiting") return status.state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return (await login.status()).state;
}

describe("重复登录同一个账号", () => {
  it("**内容与基线相同、但 vela 正常退出 → 应当成功**（不能误报没登录）", async () => {
    const storeKey = vi.fn(async () => undefined);
    const { child, emitExit } = fakeChild();
    const login = createOpenDesignLogin(
      loginDeps({
        storeKey,
        spawn: () => child,
        // 登录前后内容完全一致：重复登录同一账号、密钥没刷新。
        readFile: async () => SAME_PROFILE,
        sleep: (async () => {
          // 用户在浏览器里批准了：vela 正常退出。
          emitExit(0);
          await Promise.resolve();
        }) as OpenDesignLoginDeps["sleep"],
      }),
    );

    await login.begin();
    const state = await settle(login);

    expect(state, "批准过就该成功，内容没变不代表没登录").toBe("success");
    expect(storeKey, "应当把凭据存一遍（刷新已有账号）").toHaveBeenCalled();
  });

  it("内容与基线相同、vela **没退出** → 继续等（用户还没批准）", async () => {
    const storeKey = vi.fn(async () => undefined);
    const { child } = fakeChild();
    let clock = 1_000;
    const login = createOpenDesignLogin(
      loginDeps({
        storeKey,
        spawn: () => child,
        readFile: async () => SAME_PROFILE,
        // 永不退出：用户在浏览器里还没点批准。
        sleep: (async () => {
          await Promise.resolve();
        }) as OpenDesignLoginDeps["sleep"],
        // 时钟推进让 `deadline` 最终到点，测试不会真的等到 3 分钟。
        now: () => (clock += 60_000),
        timeoutMs: 180_000,
      }),
    );

    await login.begin();
    const state = await settle(login);

    // 没批准 → 超时，但**不能**当成成功（也不该写入凭据）。
    expect(state).toBe("failed");
    expect(storeKey).not.toHaveBeenCalled();
  });
});
