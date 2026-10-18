/**
 * Open Design 网页登录测试：vela 设备授权 → 本机登录产物 → 凭据落库。
 *
 * 传输（spawn）、文件读取（readFile）、等待（sleep）、时钟（now）与 vela 解析
 * （resolveVela）全部注入：不碰真网、不依赖真实定时器、不读本机 `~/.amr`。
 */
import { expect, it, vi } from "vitest";

import { accountRef } from "../../src/core/accounts";
import {
  findVelaBinary,
  parseAmrProfile,
  parseVelaPrompt,
  profileLabel,
  createOpenDesignLogin,
  createVelaPreflight,
  discoverWorkspaceId,
  type OpenDesignLoginDeps,
  type VelaChild,
} from "../../src/vendors/opendesign/login";

/** 一个可控的假 vela 子进程：缓冲输出，订阅时补放。 */
interface FakeVelaChild extends VelaChild {
  emitData(chunk: string): void;
  emitExit(code: number | null): void;
}

function fakeChild(options: { prompt?: string; exitCode?: number | null } = {}): FakeVelaChild {
  const dataListeners: ((chunk: unknown) => void)[] = [];
  const exitListeners: ((code: number | null) => void)[] = [];
  const errorListeners: ((error: unknown) => void)[] = [];
  let buffered = options.prompt ?? "";
  const child: FakeVelaChild = {
    stdout: {
      on: (event, listener) => {
        if (event !== "data") return undefined;
        dataListeners.push(listener as (chunk: unknown) => void);
        // 订阅时补放缓冲：spawn 与订阅之间产生的输出不该丢（真实流也一样会补）。
        if (buffered !== "") listener(buffered);
        return undefined;
      },
    },
    stderr: { on: () => undefined },
    on: (event, listener) => {
      if (event === "exit") exitListeners.push(listener as (code: number | null) => void);
      if (event === "error") errorListeners.push(listener as (error: unknown) => void);
      return undefined;
    },
    kill: () => undefined,
    emitData: (chunk) => {
      buffered += chunk;
      for (const listener of dataListeners) listener(chunk);
    },
    emitExit: (code) => {
      for (const listener of exitListeners) listener(code);
    },
  };
  if (options.exitCode !== undefined) child.emitExit(options.exitCode);
  return child;
}

/** 登录产物的原文（`~/.amr/config.json` 的形状）。 */
const PROFILE_TEXT = JSON.stringify({
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

/** vela 的授权提示（线上形状：`Open this URL to continue:` 的下一行是网址，随后 `Code:`）。 */
const VELA_PROMPT = "Open this URL to continue:\nhttps://open-design.ai/cli/activate?deviceId=abc\nCode: WXYZ\n";

/** 造一次登录尝试的依赖。 */
function loginDeps(overrides: Partial<OpenDesignLoginDeps> = {}): OpenDesignLoginDeps {
  return {
    storeKey: vi.fn(async () => undefined),
    spawn: () => fakeChild({ prompt: VELA_PROMPT }),
    readFile: async () => PROFILE_TEXT,
    sleep: async () => undefined,
    now: () => 1_000,
    resolveVela: async () => "C:\\vela.exe",
    timeoutMs: 180_000,
    parseTimeoutMs: 30_000,
    pollIntervalMs: 1_000,
    ...overrides,
  };
}

/** 排空后台轮询（`begin()` 只返回 waiting，授权等待在后台）。 */
async function settle(login: ReturnType<typeof createOpenDesignLogin>): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const status = await login.status();
    if (status.state !== "waiting") return status.state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return (await login.status()).state;
}

it("设备授权成功：状态先 waiting（带授权网址与验证码），批准后三样东西一起落库", async () => {
  const storeKey = vi.fn(async () => undefined);
  const child = fakeChild({ prompt: VELA_PROMPT });
  const login = createOpenDesignLogin(loginDeps({ storeKey, spawn: () => child }));

  const waiting = await login.begin();
  expect(waiting).toMatchObject({
    state: "waiting",
    authUrl: "https://open-design.ai/cli/activate?deviceId=abc",
    userCode: "WXYZ",
  });
  expect(await settle(login)).toBe("success");

  expect(storeKey).toHaveBeenCalledTimes(1);
  const [input] = storeKey.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(input).toMatchObject({
    ref: accountRef("opendesign", "fsk@example.com"),
    key: "rt-1",
    controlKey: "ctrl-1",
    workspaceId: "ws-1",
    label: "fsk@example.com",
  });
});

it("找不到 vela 但本机已有登录产物：直接导入并成功（不逼用户再装一个 CLI）", async () => {
  const storeKey = vi.fn(async () => undefined);
  const spawn = vi.fn(() => fakeChild());
  const login = createOpenDesignLogin(loginDeps({ storeKey, spawn, resolveVela: async () => undefined }));

  expect(await login.begin()).toMatchObject({ state: "success" });
  expect(spawn).not.toHaveBeenCalled();
  expect(storeKey).toHaveBeenCalledTimes(1);
});

it("找不到 vela 也没有本机登录产物：failed/vela-missing，不写任何凭据", async () => {
  const storeKey = vi.fn(async () => undefined);
  const login = createOpenDesignLogin(
    loginDeps({ storeKey, resolveVela: async () => undefined, readFile: async () => Promise.reject(new Error("ENOENT")) }),
  );
  expect(await login.begin()).toMatchObject({ state: "failed", reason: "vela-missing" });
  expect(storeKey).not.toHaveBeenCalled();
});

it("有界窗口内没解析出授权提示：failed/timeout（vela 起不来或输出形状变了）", async () => {
  // sleep 立即返回：解析窗口瞬间用完，而 stdout 什么都没有。
  const login = createOpenDesignLogin(loginDeps({ spawn: () => fakeChild() }));
  expect(await login.begin()).toMatchObject({ state: "failed", reason: "timeout" });
});

it("用户在浏览器里没批准（vela 正常退出却没留下产物）：failed/no-signin", async () => {
  const child = fakeChild({ prompt: VELA_PROMPT });
  const login = createOpenDesignLogin(
    loginDeps({
      spawn: () => child,
      readFile: async () => Promise.reject(new Error("ENOENT")),
      // 第一次 sleep 是解析窗口（立即放行，让 begin() 落到 waiting），其后每轮等待都让子进程退出。
      sleep: (async () => {
        child.emitExit(0);
        await Promise.resolve();
      }) as OpenDesignLoginDeps["sleep"],
    }),
  );
  expect(await login.begin()).toMatchObject({ state: "waiting" });
  expect(await settle(login)).toBe("failed");
  expect((await login.status()).reason).toBe("no-signin");
});

it("产物在但形状不认（缺 runtimeKey）且子进程已退出：failed/config-invalid", async () => {
  const child = fakeChild({ prompt: VELA_PROMPT });
  const login = createOpenDesignLogin(
    loginDeps({
      spawn: () => child,
      readFile: async () => '{"profiles":{"prod":{"controlKey":"only-control"}}}',
      sleep: (async () => {
        child.emitExit(0);
        await Promise.resolve();
      }) as OpenDesignLoginDeps["sleep"],
    }),
  );
  await login.begin();
  expect(await settle(login)).toBe("failed");
  expect((await login.status()).reason).toBe("config-invalid");
});

it("等待授权时取消：failed/cancelled，且绝不写凭据", async () => {
  const storeKey = vi.fn(async () => undefined);
  const login = createOpenDesignLogin(
    loginDeps({
      storeKey,
      // 轮询等待永不返回：只有 cancel() 的中止能让流程继续。
      sleep: (() => new Promise<void>(() => undefined)) as OpenDesignLoginDeps["sleep"],
    }),
  );
  expect(await login.begin()).toMatchObject({ state: "waiting" });
  await login.cancel();
  expect((await login.status()).state).toBe("failed");
  expect((await login.status()).reason).toBe("cancelled");
  expect(storeKey).not.toHaveBeenCalled();
});

it("登录产物解析：prod 槽优先、单槽回退、没有 runtimeKey 不可用", () => {
  expect(parseAmrProfile(PROFILE_TEXT)).toMatchObject({ slot: "prod", runtimeKey: "rt-1", workspaceId: "ws-1" });
  // 手改过槽名也救得回来：只有一个 profile 时取它。
  expect(parseAmrProfile('{"profiles":{"custom":{"runtimeKey":"k"}}}')).toMatchObject({ slot: "custom", runtimeKey: "k" });
  // 没有推理密钥的 profile 导进来只是一个配置不了的账号。
  expect(parseAmrProfile('{"profiles":{"prod":{"controlKey":"c"}}}')).toBeUndefined();
  // 多个槽又没有 prod：形状不明，不猜。
  expect(parseAmrProfile('{"profiles":{"a":{"runtimeKey":"1"},"b":{"runtimeKey":"2"}}}')).toBeUndefined();
  expect(parseAmrProfile("not json")).toBeUndefined();
  // 标签：邮箱 → 显示名 → 槽名。
  expect(profileLabel(parseAmrProfile(PROFILE_TEXT)!)).toBe("fsk@example.com");
  expect(profileLabel(parseAmrProfile('{"profiles":{"prod":{"runtimeKey":"k","user":{"name":"N"}}}}')!)).toBe("N");
  expect(profileLabel(parseAmrProfile('{"profiles":{"solo":{"runtimeKey":"k"}}}')!)).toBe("solo");
});

it("授权提示解析：下一行是网址、Code 行是验证码，认不出的部分保持缺省", () => {
  expect(parseVelaPrompt(VELA_PROMPT)).toEqual({
    authUrl: "https://open-design.ai/cli/activate?deviceId=abc",
    userCode: "WXYZ",
  });
  // 同一行冒号之后的写法也认。
  expect(parseVelaPrompt("Open this URL to continue: https://x.test/activate\nCode: ABCD")).toMatchObject({
    authUrl: "https://x.test/activate",
    userCode: "ABCD",
  });
  expect(parseVelaPrompt("nothing here")).toEqual({});
});

it("vela 解析顺序：VELA_BIN 直接采信，桌面端内置按 LOCALAPPDATA 展开，PATH 逐个目录找", () => {
  // VELA_BIN 非空时直接采信（用户显式指定的路径就是权威）。
  expect(findVelaBinary({ VELA_BIN: "D:\\custom\\vela.exe" }, () => false)).toBe("D:\\custom\\vela.exe");
  // 桌面端内置：按 `%LOCALAPPDATA%\Programs\Open Design\resources\open-design\bin\vela.exe` 展开。
  expect(
    findVelaBinary({ LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local", PATH: "" }, (path) => path.includes("Open Design")),
  ).toContain("AppData\\Local\\Programs\\Open Design");
  // PATH 逐个目录找 `vela.exe` / `vela`。
  expect(findVelaBinary({ PATH: "C:\\bin" }, (path) => path.endsWith("vela.exe"))).toContain("C:\\bin");
  // 三个来源都没有：undefined（调用方据此走导入路径或报 vela-missing）。
  expect(findVelaBinary({}, () => false)).toBeUndefined();
});

// —— 工作区发现：登录产物通常只有两把密钥，工作区要问 vela（2026-10-18 本机实测） ——

/**
 * 跑一次发现：假子进程要等 `spawn` 真的被调用之后再 `emitExit`（退出事件是按订阅派发的，
 * 提前发等于没发）。
 */
async function discoverWith(promptText: string, code: number): Promise<string | undefined> {
  const child = fakeChild({ prompt: promptText });
  const spawn = vi.fn(() => child);
  const pending = discoverWorkspaceId({ spawn, resolveVela: async () => "vela", timeoutMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  child.emitExit(code);
  return pending;
}

it("discoverWorkspaceId：从 vela team-projects list 的 JSON 里取当前工作区", async () => {
  const child = fakeChild({ prompt: '{"workspaceId":"ws-abc","projects":[]}' });
  const spawn = vi.fn(() => child);
  const pending = discoverWorkspaceId({ spawn, resolveVela: async () => "vela", timeoutMs: 500 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  child.emitExit(0);

  expect(await pending).toBe("ws-abc");
  expect(spawn).toHaveBeenCalledWith("vela", ["team-projects", "list"]);
});

it("discoverWorkspaceId：找不到 vela / 命令失败 / 输出不是 JSON / 空 id 都读作「没发现」", async () => {
  expect(await discoverWorkspaceId({ spawn: vi.fn(), resolveVela: async () => undefined })).toBeUndefined();
  expect(await discoverWith("boom", 1)).toBeUndefined();
  expect(await discoverWith("not json at all", 0)).toBeUndefined();
  expect(await discoverWith('{"workspaceId":"  "}', 0)).toBeUndefined();
});

it("vela preflight 拒绝形状不对的工作区 id（参数注入闸门）", async () => {
  const spawn = vi.fn();
  const preflight = createVelaPreflight({ spawn, resolveVela: async () => "vela" });
  // `--format` / 空格 / 换行都不能进到参数列表里。
  await expect(preflight("ws --format yaml")).rejects.toThrow(/工作区 id/);
  await expect(preflight("--help")).rejects.toThrow(/工作区 id/);
  await expect(preflight("ws\nrm -rf /")).rejects.toThrow(/工作区 id/);
  expect(spawn).not.toHaveBeenCalled();
});
