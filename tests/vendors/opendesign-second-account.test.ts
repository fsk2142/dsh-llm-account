/**
 * 第二个账号登录。
 *
 * ## 表现
 *
 * 用**不同邮箱**登录第二个账号，界面显示登录成功，但账号列表没有新增。
 *
 * ## 根因
 *
 * `#awaitApproval` 的判据是「登录产物文件**存在且能解析**」，它**不检查内容是否变化**：
 *
 * ```ts
 * const text = await this.#readProfileText();
 * if (text !== undefined) {
 *   const profile = parseAmrProfile(text);
 *   if (profile !== undefined) { await this.#complete(attempt, profile); return; }
 * }
 * ```
 *
 * 而 `~/.amr/config.json` 是 vela 的**固定槽位**文件：无论登录哪个账号，它都写在
 * `profiles.prod`。所以登录第二个账号时，文件里**已经有第一个账号的内容** ——
 * 循环第一轮就读到旧内容，立刻判定「登录成功」，把**第一个账号**的凭据又存了一遍。
 *
 * 症状因此在两处同时成立：
 *
 * - 界面上「登录成功」（因为确实走了 success 分支）
 * - 账号列表没变（因为 storeKey 收到的是第一个账号的 label/ref）
 *
 * ## 这条测试钉住的契约
 *
 * **登录前已存在的登录产物不能当作「本次登录完成」的证据。**
 * 判据必须是「文件内容与登录前不同」。
 */
import { describe, expect, it, vi } from "vitest";

import { createOpenDesignLogin, type OpenDesignLoginDeps } from "../../src/vendors/opendesign/login";
import { accountRef } from "../../src/core/accounts";

/** 第一个账号的登录产物（登录前就在磁盘上）。 */
const FIRST_PROFILE = JSON.stringify({
  profiles: {
    prod: {
      controlKey: "ctrl-FIRST",
      runtimeKey: "rt-FIRST",
      apiUrl: "https://amr-link.open-design.ai",
      linkUrl: "https://amr-api.open-design.ai",
      user: { id: "u1", email: "first@example.com", name: "first" },
    },
  },
});

/** 第二个账号的登录产物（浏览器批准后 vela 会覆盖成这个）。 */
const SECOND_PROFILE = JSON.stringify({
  profiles: {
    prod: {
      controlKey: "ctrl-SECOND",
      runtimeKey: "rt-SECOND",
      apiUrl: "https://amr-link.open-design.ai",
      linkUrl: "https://amr-api.open-design.ai",
      user: { id: "u2", email: "second@example.com", name: "second" },
    },
  },
});

/** 一次设备授权的输出。 */
const VELA_PROMPT =
  "Open this URL to continue:\nhttps://open-design.ai/cli/activate?deviceId=abc\nCode: WXYZ\n";

/**
 * 造一个「文件先有旧内容、几轮后变成新内容」的 readFile。
 *
 * 这正是真实 vela 的行为：登录**开始前** `profiles.prod` 里已有上一个账号。
 * @param afterRounds - 第几轮读取开始返回新内容。
 * @returns 读取函数与调用计数。
 */
function rotatingReadFile(afterRounds: number): { read: () => Promise<string>; calls: () => number } {
  let count = 0;
  return {
    read: async () => {
      count += 1;
      return count > afterRounds ? SECOND_PROFILE : FIRST_PROFILE;
    },
    calls: () => count,
  };
}

/** 造一次登录尝试的依赖。 */
function loginDeps(overrides: Partial<OpenDesignLoginDeps> = {}): OpenDesignLoginDeps {
  return {
    storeKey: vi.fn(async () => undefined),
    spawn: () =>
      ({
        stdout: { on: () => undefined },
        stderr: { on: () => undefined },
        on: (event: string, handler: (value: unknown) => void) => {
          if (event === "exit") setTimeout(() => handler(0), 0);
        },
        kill: () => undefined,
      }) as never,
    readFile: async () => FIRST_PROFILE,
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

describe("第二个账号登录", () => {
  it("**登录前已存在的产物不算登录成功**（必须等内容变化）", async () => {
    const storeKey = vi.fn(async () => undefined);
    const reader = rotatingReadFile(3);
    // 时钟每读一次前进 1 秒，`deadline` 是 `now() + timeoutMs`（180 秒），足够读到新内容。
    let clock = 1_000;
    const login = createOpenDesignLogin(
      loginDeps({
        storeKey,
        readFile: reader.read,
        // 子进程**不退出**：真实场景里 vela 要等浏览器批准才退出。
        spawn: () => fakeChildWithoutExit(),
        pollIntervalMs: 1_000,
        now: () => (clock += 1_000),
      }),
    );

    await login.begin();
    const state = await settle(login);

    expect(state, "读到新内容后应当成功").toBe("success");
    // 关键断言：存进去的必须是**第二个**账号，而不是磁盘上原有的第一个。
    const [input] = storeKey.mock.calls[0] as unknown as [{ label: string; key: string; ref: string }];
    expect(input.label, "存的必须是第二个账号的 label").toBe("second@example.com");
    expect(input.key, "存的必须是第二个账号的密钥").toBe("rt-SECOND");
    expect(input.ref).toBe(accountRef("opendesign", "second@example.com"));
  });

  it("产物一直不变时不该判定成功（那是旧账号，不是本次登录）", async () => {
    const storeKey = vi.fn(async () => undefined);
    const login = createOpenDesignLogin(
      loginDeps({
        storeKey,
        // 永远返回第一个账号：模拟「用户没批准 / vela 没写入新内容」。
        readFile: async () => FIRST_PROFILE,
        spawn: () => fakeChild(),
        pollIntervalMs: 1_000,
        now: (() => {
          let t = 0;
          return () => (t += 30_000);
        })(),
      }),
    );

    await login.begin();
    const state = await settle(login);

    // 不该成功：磁盘上那份是旧账号。
    expect(state).not.toBe("success");
    expect(storeKey, "不该把旧账号的凭据重新存一遍").not.toHaveBeenCalled();
  });
});

/** 一个只提供 `exit` 事件的假子进程。 */
function fakeChild(): never {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on: (event: string, handler: (value: unknown) => void) => {
      if (event === "exit") setTimeout(() => handler(0), 0);
    },
    kill: () => undefined,
  } as never;
}

/**
 * 假子进程：**永不退出**。
 *
 * 真实场景里 vela 要等用户在浏览器批准后才退出；如果测试里它立刻退出，
 * `#awaitApproval` 会走「正常退出却没留下新产物 = 没批准」那条分支。
 * @returns 假子进程。
 */
function fakeChildWithoutExit(): never {
  const dataListeners: ((chunk: unknown) => void)[] = [];
  let buffered = VELA_PROMPT;
  return {
    stdout: {
      on: (event: string, listener: (chunk: unknown) => void) => {
        if (event !== "data") return undefined;
        dataListeners.push(listener);
        // 订阅时补放缓冲：提示文本在 spawn 与订阅之间产生。
        if (buffered !== "") listener(buffered);
        return undefined;
      },
    },
    stderr: { on: () => undefined },
    // **永不触发 exit**：真实 vela 要等用户在浏览器批准后才退出。
    on: () => undefined,
    kill: () => undefined,
  } as never;
}
