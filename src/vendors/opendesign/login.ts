/**
 * Open Design 网页登录：设备授权（浏览器批准），由官方 `vela login` 完成（计划 §2.6）。
 *
 * 流程与厂商事实（计划 §0）逐条对照：
 * 1. `begin()` 按 VELA_BIN → 桌面端内置 → PATH 的顺序解析 vela（{@link findVelaBinary}），
 *    `spawn(vela, ["login"])`；
 * 2. `stdout` 先出现 `Open this URL to continue:`，**下一行**是激活网址
 *    （`https://<host>/cli/activate?deviceId=…`），随后 `Code: XXXX`；在**有界的**
 *    {@link VELA_PARSE_TIMEOUT_MS} 内解析出来就进入 `waiting`（带 `authUrl`/`userCode`/
 *    `expiresAt`），解析超时 → `failed/reason:"timeout"`；
 * 3. 找不到 vela 时：`~/.amr/config.json` 已有可用 profile 就**直接导入**并 `success`
 *    （本机登录产物就是登录结果，没必要逼用户再装一个 CLI），否则 `failed/reason:"vela-missing"`；
 * 4. 后台等「子进程退出」或「配置文件出现」两个条件中**先到的那个**；成功后把
 *    `runtimeKey`/`controlKey`/工作区交给注入的 `storeKey`（装配层负责「同 ref 换密钥，否则
 *    add」）；配置文件坏掉 → `failed/reason:"config-invalid"`，子进程正常退出却没留下登录
 *    产物 → `failed/reason:"no-signin"`，子进程异常退出 → `failed/reason:"unavailable"`；
 * 5. `status()` 纯读内存；`cancel()` kill 子进程（`waiting` 中取消 → `failed/reason:"cancelled"`）；
 *    终态之后的下一次 `begin()` 才开新尝试；`ctx.effect` 卸载时 `cancel()`。
 *
 * **只读不改写** `~/.amr/config.json`（计划 §0 的明确要求）：本模块只用 `readFile` 读它。
 * **不 import 宿主 ctx**：`spawn`/`readFile`/`sleep`/`now`/`resolveVela`/`storeKey` 全部注入，
 * 离线可单测（计划 §2.6 的最后一条）。
 *
 * 同一份实现还导出 {@link createVelaPreflight}：`vela billing preflight --workspace-id <id>
 * --format json` 的读取器，供额度端口注入（`quota.ts` 的 `preflight` 依赖）。它共用这里的
 * vela 解析与「收完子进程输出」的小工具，不重复一份 CLI 事实。
 * @module dsh-llm-account/src/vendors/opendesign/login
 */
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { LoginPort, LoginStatus, VendorId } from "../../core/adapter";
import { accountRef } from "../../core/accounts";
import { normalizeKey } from "../../core/credentials";

/** 本登录流所属的 provider 路由（ref 生成的厂商段）。 */
export const OPEN_DESIGN_LOGIN_VENDOR: VendorId = "opendesign";

/**
 * 等待浏览器授权的总期限（`waiting` 的 `expiresAt` = 开始等待的时刻 + 它）。
 * 三分钟够用户在浏览器里走完设备授权；再长只会让页面挂着一个过期的等待。
 */
export const LOGIN_TIMEOUT_MS = 180_000;

/** 有界解析窗口：vela 启动后多久内必须把激活网址与验证码打出来（计划 §2.6 的「如 30s」）。 */
export const VELA_PARSE_TIMEOUT_MS = 30_000;

/** 后台等待的两个条件轮询间隔（等子进程退出 / 等配置文件出现）。 */
export const VELA_POLL_INTERVAL_MS = 1_000;

/** `billing preflight` 的预算（毫秒）。 */
export const VELA_PREFLIGHT_TIMEOUT_MS = 20_000;

/** 本机登录产物的默认路径（只读，见模块头）。 */
export function defaultProfilePath(): string {
  return join(homedir(), ".amr", "config.json");
}

/** vela 子进程的一个输出流（只认 `data`：两个流都逐块读）。 */
export interface VelaStream {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
}

/** vela 子进程的最小结构（真实 `ChildProcess` 与测试假实现都满足它）。 */
export interface VelaChild {
  readonly stdout: VelaStream | null;
  readonly stderr: VelaStream | null;
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

/** 启动 vela 的方式（注入点；生产是 {@link defaultSpawn}）。 */
export type VelaSpawn = (command: string, args: readonly string[]) => VelaChild;

/**
 * 一次 `vela` 启动该用什么 spawn 参数（纯函数，便于单测）。
 *
 * **Windows 上非 `.exe` 一律走 shell**（2026-10-20 真机实测）：
 *
 * | 配置 | 结果 |
 * | --- | --- |
 * | `shell: false` + `.cmd` | **EINVAL**（`spawn EINVAL`，stdout 零字节） |
 * | `shell: true` + `.cmd` | 正常拿到网址与验证码 |
 *
 * npm 全局安装生成的是 `.cmd`（外加 `.ps1` 与**无扩展名**的 sh 脚本）。旧实现只给
 * `.cmd`/`.bat` 开 shell —— 一旦命中的是那个无扩展名的 `vela`，就落到 `shell: false`
 * 分支，于是 `EINVAL`（用户在新设备上看到的就是这个）。
 *
 * 判据因此从「扩展名是不是 cmd/bat」改成「**是不是原生可执行映像**」：
 * Windows 上只有 `.exe` 能直接 spawn，其余都交给 cmd.exe。
 *
 * 关于 `DEP0190`（shell + args 是拼接而非转义）：这里 args 恒为 `["login"]`，
 * 没有用户输入参与，不构成注入面。
 * @param command - 解析到的 vela 路径。
 * @param platform - 平台（缺省取当前进程；注入便于测试 Windows 分支）。
 * @returns 直接交给 `nodeSpawn` 的参数。
 */
export function spawnOptionsFor(
  command: string,
  platform: string = process.platform,
): { command: string; options: { shell?: boolean; windowsVerbatimArguments?: boolean; windowsHide?: boolean; stdio: readonly string[] } } {
  const native = /\.exe$/i.test(command);
  const base = { stdio: ["ignore", "pipe", "pipe"] as readonly string[], windowsHide: true };
  if (platform !== "win32" || native) return { command, options: base };
  // 走 cmd.exe：路径自己加引号（用户名里带空格时，路径含空格，例如
  // `…\Some Name\…\vela.cmd`，不加引号会被 cmd.exe 拆成两段），
  // 再用 `windowsVerbatimArguments` 让 Node 原样传递，避免二次转义把引号弄坏。
  return {
    command: `"${command}"`,
    options: { ...base, shell: true, windowsVerbatimArguments: true },
  };
}

/** 默认的启动方式：两个输出流都接管道，Windows 下不弹控制台窗口。 */
function defaultSpawn(command: string, args: readonly string[]): VelaChild {
  const { command: executable, options } = spawnOptionsFor(command);
  return nodeSpawn(executable, [...args], options as Parameters<typeof nodeSpawn>[2]);
}

/**
 * vela 候选可执行文件名（Windows 优先 `.exe`，其次 npm 包装）。
 *
 * **`.cmd`/`.bat` 是必须的**（2026-10-20 真机）：用 `npm i -g @powerformer/vela-cli` 装的话，
 * Windows 上生成的是 `vela.cmd`（外加 `.ps1` 与一个**无扩展名**的 sh 脚本），**没有 `.exe`**。
 * 只找 `.exe` / `vela` 的旧清单会命中那个无扩展名的 sh 脚本 —— 而 Windows 不能直接执行它，
 * `spawn` 于是触发 `error` 事件、一个字节都不输出，界面上就是
 * 「vela 没有任何输出（命令可能没能启动）」。
 *
 * 顺序有意义：`.exe` 优先（官方安装器给的是原生二进制）；`.cmd` 次之（npm 包装，能跑）；
 * 最后才是无扩展名的 `vela`（那是 POSIX shell 脚本，Windows 上基本跑不了，但保留给
 * Git Bash / MSYS 之类的环境）。
 */
const VELA_FILE_NAMES: readonly string[] =
  process.platform === "win32"
    ? ["vela.exe", "vela.cmd", "vela.bat", "vela"]
    : ["vela"];

/** 桌面端内置 vela 的相对路径（计划 §0 的 `%LOCALAPPDATA%\Programs\Open Design\…`）。 */
const DESKTOP_VELA_RELATIVE: readonly string[] = ["Programs", "Open Design", "resources", "open-design", "bin", "vela.exe"];

/**
 * 按 VELA_BIN → 桌面端内置 → PATH 的顺序找 vela（纯函数，注入环境与存在性判定便于单测）。
 *
 * `VELA_BIN` 非空时**直接采信**（用户显式指定的路径就是权威；它不存在时后续的启动会失败，
 * 那是更准确的错误）；桌面端内置按 `%LOCALAPPDATA%` 展开；PATH 逐个目录找
 * `vela.exe` / `vela`。
 * @param env - 环境变量表（缺省 `process.env`）。
 * @param exists - 文件存在性判定（缺省 `fs.existsSync`）。
 * @returns vela 的路径，或 `undefined`（三个来源都没有）。
 */
export function findVelaBinary(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const configured = normalizeKey(env.VELA_BIN);
  if (configured !== undefined) return configured;
  const localAppData = normalizeKey(env.LOCALAPPDATA);
  if (localAppData !== undefined) {
    const desktop = join(localAppData, ...DESKTOP_VELA_RELATIVE);
    if (exists(desktop)) return desktop;
  }
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir.trim() === "") continue;
    for (const name of VELA_FILE_NAMES) {
      const candidate = join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** 默认的 vela 解析（生产读 `process.env` 与真实文件系统）。 */
function defaultResolveVela(): Promise<string | undefined> {
  return Promise.resolve(findVelaBinary());
}

/** 去掉 ANSI 颜色转义：CLI 把提示行染色时，网址与验证码的提取不该被转义码挡住。 */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** 诊断文本的最大长度：够看清原因，又不至于把界面撑爆。 */
const VELA_DIAGNOSTIC_LIMIT = 600;

/**
 * 把 vela 的原始输出整理成一句可展示的诊断。
 *
 * 三条纪律：
 * 1. **没有输出本身就是信息**（「命令没有任何输出」指向「启动失败」而非「格式变了」）；
 * 2. **截断**到 `VELA_DIAGNOSTIC_LIMIT`，超长时明确标注被截断；
 * 3. **抹掉像密钥的片段**：输出理论上不该含密钥，但诊断信息会被贴进聊天窗口，
 *    宁可多一层过滤（`sk-…` / `vela_…` / 长十六进制串）。
 * @param text - 累计的 stdout+stderr。
 * @returns 诊断文本；完全没有输出时也给一句说明（`undefined` 表示不需要展示）。
 */
export function describeVelaOutput(text: string): string | undefined {
  const cleaned = stripAnsi(text)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/vela_[A-Za-z0-9_-]{8,}/g, "vela_***")
    .trim();
  if (cleaned === "") return "vela 没有任何输出（命令可能没能启动，或退出得比提示还快）";
  const flat = cleaned.replace(/\s+/g, " ");
  return flat.length <= VELA_DIAGNOSTIC_LIMIT
    ? flat
    : `${flat.slice(0, VELA_DIAGNOSTIC_LIMIT)}…（已截断，原长 ${flat.length} 字）`;
}

/** 输出块到文本（真实流给 `Buffer`；测试假实现可以直接给字符串）。 */
function textOfChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk ?? "");
}

/** vela 打出来的授权提示。 */
export interface VelaPrompt {
  /** 要用户在浏览器里打开的激活网址。 */
  authUrl?: string;
  /** 要输入的设备验证码。 */
  userCode?: string;
}

/**
 * 从 vela 的输出里解析授权网址与验证码（纯函数）。
 *
 * 网址有两种落法都认：`Open this URL to continue:` 的**下一行**（线上形状），或同一行冒号
 * 之后；验证码是 `Code: XXXX` 那一行。解析不了的部分保持缺省 —— 调用方按「还没解析出来」
 * 继续等，不猜。
 * @param text - 累计的输出文本（含 ANSI 转义也认）。
 * @returns 已解析出的部分。
 */
export function parseVelaPrompt(text: string): VelaPrompt {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  let authUrl: string | undefined;
  let userCode: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const sameLine = /Open this URL to continue:\s*(\S+)/i.exec(line);
    if (sameLine !== null && /^https?:\/\//i.test(sameLine[1] ?? "")) {
      authUrl = sameLine[1];
    } else if (/Open this URL to continue:?\s*$/i.test(line)) {
      const next = lines[index + 1];
      if (next !== undefined && /^https?:\/\//i.test(next)) authUrl = next;
    }
    const code = /^Code:\s*(\S+)/i.exec(line);
    if (code !== null && code[1] !== undefined && code[1] !== "") userCode = code[1];
  }
  return {
    ...(authUrl === undefined ? {} : { authUrl }),
    ...(userCode === undefined ? {} : { userCode }),
  };
}

/**
 * 本机登录产物的一份可导入 profile（`~/.amr/config.json` 的 `profiles.<slot>`）。
 * 只读导入，绝不改写那个文件。
 */
export interface OpenDesignProfile {
  /** profile 在文件里的槽名（`prod` 或唯一的那个键）。 */
  slot: string;
  /** 推理密钥（必填：没有它的 profile 不可用，见 {@link parseAmrProfile}）。 */
  runtimeKey: string;
  /** 控制面密钥（额度接口用）。 */
  controlKey?: string;
  /** 控制面/网关地址（厂商自己记的，本包不据此改配置）。 */
  apiUrl?: string;
  /** 桌面端链路地址。 */
  linkUrl?: string;
  /** 账号 id。 */
  userId?: string;
  /** 邮箱（账号标签的首选）。 */
  email?: string;
  /** 显示名（邮箱缺失时的标签）。 */
  name?: string;
  /** 套餐标识。 */
  plan?: string;
  /** 工作区 id（vela 周期额度查询用）。 */
  workspaceId?: string;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析本机登录产物（纯函数，只读文本）。
 *
 * 形状：`{ profiles: { <slot>: { controlKey, runtimeKey, apiUrl, linkUrl, user: { id, email, name,
 * plan } } } }`。取 `profiles.prod`；没有 `prod` 但**只有一个** profile 时取那一个
 * （用户手改过槽名也还能救回来）；其它情况读作不可用。可用性的门槛是**非空 `runtimeKey`**
 * —— 没有推理密钥的 profile 导进来只是一个配置不了的账号。工作区从 profile 顶层的
 * `workspaceId` 或 `workspace.id` 里取（厂商形状是防御性读取，缺失就是缺省）。
 * @param text - 配置文件原文。
 * @returns 可导入的 profile，或 `undefined`（不可用/不是 JSON）。
 */
export function parseAmrProfile(text: string): OpenDesignProfile | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.profiles)) return undefined;
  const profiles = parsed.profiles;
  let slot = "prod";
  let candidate: unknown = profiles.prod;
  if (!isRecord(candidate)) {
    const keys = Object.keys(profiles);
    if (keys.length !== 1) return undefined;
    slot = keys[0]!;
    candidate = profiles[slot];
  }
  if (!isRecord(candidate)) return undefined;
  const runtimeKey = normalizeKey(candidate.runtimeKey);
  if (runtimeKey === undefined) return undefined;
  const user = isRecord(candidate.user) ? candidate.user : undefined;
  const workspace = isRecord(candidate.workspace) ? candidate.workspace : undefined;
  const workspaceId = normalizeKey(candidate.workspaceId) ?? (workspace === undefined ? undefined : normalizeKey(workspace.id));
  return {
    slot,
    runtimeKey,
    ...(normalizeKey(candidate.controlKey) === undefined ? {} : { controlKey: normalizeKey(candidate.controlKey) }),
    ...(normalizeKey(candidate.apiUrl) === undefined ? {} : { apiUrl: normalizeKey(candidate.apiUrl) }),
    ...(normalizeKey(candidate.linkUrl) === undefined ? {} : { linkUrl: normalizeKey(candidate.linkUrl) }),
    ...(user === undefined || normalizeKey(user.id) === undefined ? {} : { userId: normalizeKey(user.id) }),
    ...(user === undefined || normalizeKey(user.email) === undefined ? {} : { email: normalizeKey(user.email) }),
    ...(user === undefined || normalizeKey(user.name) === undefined ? {} : { name: normalizeKey(user.name) }),
    ...(user === undefined || normalizeKey(user.plan) === undefined ? {} : { plan: normalizeKey(user.plan) }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

/**
 * 给一个 profile 挑账号标签：邮箱 → 显示名 → profile 槽名。标签只影响展示与 ref 的可见部分
 * （`accountRef` 会把它转义 + 哈希，不同标签永远不会共用一个凭据槽）。
 * @param profile - 已解析的 profile。
 * @returns 账号标签。
 */
export function profileLabel(profile: OpenDesignProfile): string {
  return profile.email ?? profile.name ?? profile.slot;
}

/** 一次登录尝试成功后的落库输入（装配层据此换密钥或新增账号）。 */
export interface OpenDesignStoreInput {
  /** 由标签派生的凭据引用名（`accountRef("opendesign", label)`）。 */
  ref: string;
  /** 推理密钥（已通过 profile 的门槛校验，非空）。 */
  key: string;
  /** 控制面密钥；profile 没给时缺省。 */
  controlKey?: string;
  /** 工作区 id；profile 没给时缺省。 */
  workspaceId?: string;
  /** 账号标签（`email` / `name` / profile 槽名）。 */
  label: string;
}

/** 登录依赖：全部由装配层注入，本模块不认识宿主 `ctx`（计划 §2.6）。 */
export interface OpenDesignLoginDeps {
  /**
   * 凭据落库。装配层负责「同 ref/同标签换密钥，否则新增账号」；本模块从不写设置文档，
   * 只把它从 profile 读到的三样东西交出去。
   */
  storeKey: (input: OpenDesignStoreInput) => Promise<void>;
  /** 启动 vela 的方式；缺省 {@link defaultSpawn}。 */
  spawn?: VelaSpawn;
  /** 读文本文件；缺省 `fs/promises` 的 `readFile(path, "utf8")`。 */
  readFile?: (path: string) => Promise<string>;
  /** 等待（毫秒，可被中止）；缺省是可被 abort 的定时器。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 当下时刻；缺省 `Date.now`。 */
  now?: () => number;
  /** 解析 vela 可执行文件；缺省按 {@link findVelaBinary} 读本机。 */
  resolveVela?: () => Promise<string | undefined>;
  /** 本机登录产物的路径；缺省 {@link defaultProfilePath}。 */
  profilePath?: string;
  /** 等待授权的总期限；缺省 {@link LOGIN_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 有界解析窗口；缺省 {@link VELA_PARSE_TIMEOUT_MS}。 */
  parseTimeoutMs?: number;
  /** 后台轮询间隔；缺省 {@link VELA_POLL_INTERVAL_MS}。 */
  pollIntervalMs?: number;
}

/** 登录端口 + 当前授权网址。 */
export type OpenDesignLogin = LoginPort & {
  /** 等待授权时的授权网址；其余状态下为 `undefined`。 */
  readonly authUrl?: string;
};

/** 默认等待：可被 abort 的定时器（与 opencode 的 `defaultSleep` 同一形状）。 */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 一次 Open Design 网页登录尝试（单飞：等待中重复 `begin()` 返回同一个状态；解析还没落地时
 * 复用在途 promise，避免两次启动各跑一个 vela）。
 */
class OpenDesignLoginFlow implements OpenDesignLogin {
  readonly #deps: OpenDesignLoginDeps;
  readonly #spawn: VelaSpawn;
  readonly #readFile: (path: string) => Promise<string>;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  readonly #resolveVela: () => Promise<string | undefined>;
  readonly #profilePath: string;
  readonly #timeoutMs: number;
  readonly #parseTimeoutMs: number;
  readonly #pollIntervalMs: number;
  #statusValue: LoginStatus = { state: "idle" };
  /** 当前尝试的 vela 子进程；每次结算都由 `#teardown` 收掉。 */
  #child: VelaChild | undefined;
  /** 当前尝试的中止信号：取消/终结/下一次 `begin()` 都会中止它。 */
  #abort: AbortController | undefined;
  /**
   * 尝试代际。profile 读取与 `storeKey` 都是 await，用户可能在这段时间里取消或重新登录；
   * 代际让迟到的结果认出自己已经不再拥有状态面，从而不落库、不改状态。
   */
  #attemptSeq = 0;
  /** 正在启动的那次 `begin()`：它落地之前状态面还说不出 `waiting`，后来者必须复用。 */
  #starting: Promise<LoginStatus> | undefined;
  /** 启动期间到达的 `cancel()`：那次启动落地后自行退场。 */
  #cancelPending = false;

  /**
   * @param deps - 落库回调与各个 I/O 注入点。
   */
  constructor(deps: OpenDesignLoginDeps) {
    this.#deps = deps;
    this.#spawn = deps.spawn ?? defaultSpawn;
    this.#readFile = deps.readFile ?? ((path) => readFileAsync(path, "utf8"));
    this.#sleep = deps.sleep ?? defaultSleep;
    this.#now = deps.now ?? (() => Date.now());
    this.#resolveVela = deps.resolveVela ?? defaultResolveVela;
    this.#profilePath = deps.profilePath ?? defaultProfilePath();
    this.#timeoutMs = deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
    this.#parseTimeoutMs = deps.parseTimeoutMs ?? VELA_PARSE_TIMEOUT_MS;
    this.#pollIntervalMs = deps.pollIntervalMs ?? VELA_POLL_INTERVAL_MS;
  }

  /** @returns 等待授权时的授权网址。 */
  get authUrl(): string | undefined {
    return this.#statusValue.authUrl;
  }

  /**
   * 开始（或接续）一次尝试，返回其最新状态。
   * @returns 最新状态（`waiting` 时带授权网址与验证码）。
   */
  async begin(): Promise<LoginStatus> {
    if (this.#statusValue.state === "waiting") return { ...this.#statusValue };
    if (this.#starting !== undefined) return { ...(await this.#starting) };
    this.#cancelPending = false;
    const starting = this.#startAttempt();
    this.#starting = starting;
    try {
      return { ...(await starting) };
    } finally {
      if (this.#starting === starting) this.#starting = undefined;
    }
  }

  /** @returns 当前尝试的状态面（副本：调用方改不动内部状态）。 */
  async status(): Promise<LoginStatus> {
    return { ...this.#statusValue };
  }

  /**
   * 取消等待中的尝试；终态不受影响。启动还没落地时只是标记，等它落地后自行退场。
   * @returns 取消动作完成（子进程已收掉）。
   */
  async cancel(): Promise<void> {
    if (this.#starting !== undefined) this.#cancelPending = true;
    if (this.#statusValue.state !== "waiting") return;
    await this.#settle(this.#attemptSeq, { state: "failed", reason: "cancelled" });
  }

  /**
   * 启动半程：解析 vela → 启动子进程 → 有界解析授权提示 → 进入 `waiting` 并在后台等批准。
   * 调用方只能经 `begin()` 的单飞栅栏进来。
   * @returns 尝试落地后的状态。
   */
  async #startAttempt(): Promise<LoginStatus> {
    this.#teardown();
    const attempt = (this.#attemptSeq += 1);
    const abort = new AbortController();
    this.#abort = abort;

    let vela: string | undefined;
    let resolveProblem: string | undefined;
    try {
      // 走**字段**而不是 `deps.resolveVela`：构造时已经把缺省解析器装进字段，直接读 deps
      // 会绕过缺省值（它还是可选属性 ——  TS 会判「可能未定义」）。
      vela = await this.#resolveVela();
    } catch (error) {
      // 解析器自己抛错 ≠ 没装 vela。以前这里把错误吞成 `undefined`，于是权限问题、
      // 路径里有非法字符这类故障都会被报成「没装 vela / 没有可导入的登录产物」——
      // 用户照着装一遍环境也不会好。把原文留下来，交给失败状态带去界面。
      vela = undefined;
      resolveProblem = error instanceof Error ? error.message : String(error);
    }
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();

    if (vela === undefined) {
      const imported = await this.#importWithoutVela(attempt, abort.signal);
      // 导入也没成（`vela-missing`）且解析器**报过错**：那条真错误才是原因。
      return imported.reason === "vela-missing" && resolveProblem !== undefined
        ? { ...imported, detail: `查找 vela 时出错：${resolveProblem}` }
        : imported;
    }

    let child: VelaChild;
    try {
      child = this.#spawn(vela, ["login"]);
    } catch (error) {
      // spawn 同步抛错（参数非法、路径不可执行）：同样把原文带出去，不只是 `unavailable`。
      this.#statusValue = {
        state: "failed",
        reason: "unavailable",
        detail: `启动 vela 失败：${error instanceof Error ? error.message : String(error)}`,
      };
      return { ...this.#statusValue };
    }
    this.#child = child;
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();

    const { prompt, output } = await this.#promptWithin(child, abort.signal, this.#parseTimeoutMs);
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();
    if (prompt?.authUrl === undefined) {
      // 有界窗口内没等到激活提示：vela 起不来、崩了、或它的输出形状变了。收掉子进程再报超时。
      //
      // **把 vela 的实际输出带出去**（2026-10-20）：这个分支以前只写 `reason: "timeout"`，
      // 于是「命令没启动」「启动后崩了」「输出格式变了」「用户没批准」四种病因在界面上
      // 全都是同一句「等待授权超时」，连排查都无从下手。users 手动跑 `vela login` 正常、
      // 插件里却超时 —— 那种差异只有看真实输出才能定位。
      this.#teardown();
      this.#statusValue = {
        state: "failed",
        reason: "timeout",
        ...(describeVelaOutput(output) === undefined ? {} : { detail: describeVelaOutput(output)! }),
      };
      return { ...this.#statusValue };
    }

    // 期限先取成局部常量：`LoginStatus.expiresAt` 在类型上是可选的，直接读属性过不了
    // 「可能未定义」这一关（也读不出刚刚赋的值）。
    const expiresAt = this.#now() + this.#timeoutMs;
    this.#statusValue = {
      state: "waiting",
      authUrl: prompt.authUrl,
      ...(prompt.userCode === undefined ? {} : { userCode: prompt.userCode }),
      expiresAt,
    };
    void this.#awaitApproval(child, attempt, abort.signal, expiresAt);
    return { ...this.#statusValue };
  }

  /** 取消发生在启动半程时的统一退场：收掉一切，落在 `cancelled`。 */
  #settleCancelled(): LoginStatus {
    this.#cancelPending = false;
    this.#teardown();
    this.#statusValue = { state: "failed", reason: "cancelled" };
    return { ...this.#statusValue };
  }

  /**
   * 有界解析授权提示：等 `authUrl` 出现，或等解析窗口用完。
   *
   * 两个输出流都收（有的构建把提示写 stderr），缓冲在同一个文本里按行解析。窗口用注入的
   * `sleep` 计时，因此取消/超时都能立刻退出；订阅关系随子进程一起被丢弃（假实现与真实
   * 子进程都不需要在被 kill 之后还被摘掉监听器）。
   * @param child - 本次尝试的 vela 子进程。
   * @param signal - 本次尝试的中止信号。
   * @param timeoutMs - 解析窗口。
   * @returns 解析到的提示（可能只有一半），或 `undefined`（窗口用完）。
   */
  async #promptWithin(child: VelaChild, signal: AbortSignal, timeoutMs: number): Promise<{ prompt?: VelaPrompt; output: string }> {
    let text = "";
    let failure = "";
    let resolveFound: ((prompt: VelaPrompt | undefined) => void) | undefined;
    const found = new Promise<VelaPrompt | undefined>((resolve) => {
      resolveFound = resolve;
    });
    const onData = (chunk: unknown): void => {
      text += textOfChunk(chunk);
      const prompt = parseVelaPrompt(text);
      if (prompt.authUrl !== undefined) resolveFound?.(prompt);
    };
    const onEnd = (): void => {
      resolveFound?.(parseVelaPrompt(text));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onEnd);
    // `error` 是**启动失败**（ENOENT / EINVAL / 权限），此时 stdout 一个字节都不会有。
    // 不把它记下来，「命令没能启动」就只剩下「没有任何输出」这一句毫无指向性的话
    // （2026-10-20 真机：npm 装的 `vela.cmd` 就是这么静默失败的）。
    child.on("error", (...rest: unknown[]) => {
      const error = rest[0];
      failure = `vela 启动失败：${error instanceof Error ? error.message : String(error ?? "未知错误")}`;
      onEnd();
    });
    const timedOut = this.#sleep(timeoutMs, signal).then(
      () => undefined,
      () => undefined,
    );
    const prompt = await Promise.race([found, timedOut]);
    // **总是把累计输出（含启动失败原因）带出去**：调用方在「没解析到网址」时要把它当作诊断
    // 信息交给用户，否则真实的错误会被一句「超时」吞掉。
    const diagnostic = [failure, text].filter((part) => part !== "").join("\n");
    return prompt !== undefined && prompt.authUrl !== undefined
      ? { prompt, output: diagnostic }
      : { output: diagnostic };
  }

  /**
   * 找不到 vela 时的导入路径：本机登录产物已有可用 profile 就直接落库（成功），否则报
   * `vela-missing` —— 用户看到的是「装桌面端或 `npm i -g @powerformer/vela-cli`」的指引，
   * 而不是一个静默的失败。
   * @param attempt - 本次尝试的代际。
   * @param signal - 本次尝试的中止信号。
   * @returns 落地后的状态。
   */
  async #importWithoutVela(attempt: number, signal: AbortSignal): Promise<LoginStatus> {
    const text = await this.#readProfileText();
    if (signal.aborted || this.#cancelPending) return this.#settleCancelled();
    const profile = text === undefined ? undefined : parseAmrProfile(text);
    if (profile === undefined) {
      this.#statusValue = { state: "failed", reason: "vela-missing" };
      return { ...this.#statusValue };
    }
    // 交给统一的 complete 路径（它会过一遍所有权检查）；为了让它成立先进入 waiting。
    this.#statusValue = { state: "waiting" };
    await this.#complete(attempt, profile);
    return { ...this.#statusValue };
  }

  /**
   * 后台等授权完成：等「子进程退出」或「登录产物出现」两个条件中先到的那个。
   * @param child - 本次尝试的 vela 子进程。
   * @param attempt - 本次尝试的代际。
   * @param signal - 本次尝试的中止信号。
   * @param deadline - 等待授权的截止时刻（= `expiresAt`）。
   */
  async #awaitApproval(child: VelaChild, attempt: number, signal: AbortSignal, deadline: number): Promise<void> {
    /**
     * **登录开始前**产物的内容，用来判断「文件变了没有」。
     *
     * 为什么必须有它：
     * `~/.amr/config.json` 是 vela 的**固定槽位**文件（`profiles.prod`）—— 无论登录哪个
     * 账号都写同一处。所以登录第二个账号时，文件里**已经有第一个账号的内容**。
     *
     * 旧判据是「文件存在且能解析 → 登录成功」，于是第二轮登录会在第一轮轮询就读到
     * **旧内容**，立刻判定成功，把**第一个账号**的凭据又存一遍：界面显示「登录成功」，
     * 账号列表却毫无变化 —— 正是用户看到的现象。
     *
     * 判据改成「内容与基线不同」：那是 vela 真的写入了这次登录的唯一证据。
     */
    const baseline = await this.#readProfileText();
    let exited: { code: number | null } | undefined;
    const exit = new Promise<void>((resolve) => {
      child.on("exit", (code) => {
        exited = { code };
        resolve();
      });
      child.on("error", () => {
        exited = { code: null };
        resolve();
      });
    });
    for (;;) {
      if (signal.aborted) return;
      if (this.#now() >= deadline) {
        await this.#settle(attempt, { state: "failed", reason: "timeout" });
        return;
      }
      // 一轮等待：子进程退出或轮询间隔到点（哪个先到都能推进）。
      await Promise.race([
        exit,
        this.#sleep(this.#pollIntervalMs, signal).then(
          () => undefined,
          () => undefined,
        ),
      ]);
      if (signal.aborted) return;
      const text = await this.#readProfileText();
      if (text !== undefined) {
        /**
         * 判断「这次登录到底发生了什么」。
         *
         * **基线不能否决已经发生的事实**（2026-10-22 自查发现）：
         *
         * - 内容与基线**不同** 且能解析 → 本次登录写入了新内容，成功；
         * - 内容与基线**相同**、但子进程**已正常退出** → 也要成功。这是
         *   **重复登录同一个账号**的情况：vela 写回的 profile 与登录前完全一致
         *   （密钥没刷新），旧逻辑会误报 `no-signin`，而用户在浏览器里明明批准了；
         * - 内容与基线相同、子进程**没退出** → 用户还没批准，继续等。
         */
        const profile = parseAmrProfile(text);
        const changed = text !== baseline;
        if (profile !== undefined) {
          /**
           * 三种组合分别对应真实场景：
           *
           * 1. `changed` → 新账号（或换密钥）：通常这时子进程还没退出，不能等它；
           * 2. `!changed` 且已退出且 code=0 → 重复登录同一账号，批准了，成果就是这份；
           * 3. `!changed` 且未退出 → 还可能只是旧内容，继续等（不能提前采信）。
           */
          if (changed || exited !== undefined) {
            /**
             * **第 2 种情况要额外确认 code === 0**。
             *
             * 异常退出（非 0）时文件里的是旧账号内容，采信它就把旧账号又存一遍。
             * 这一类错误在 v0.8.3 之前表现为「登录成功但没新账号」，不该重犯。
             */
            if (changed || exited?.code === 0) {
              await this.#complete(attempt, profile);
              return;
            }
            await this.#settle(attempt, { state: "failed", reason: "unavailable" });
            return;
          }
          continue;
        }
        // 文件在但形状还不可用：子进程已经退出时就是最终判决；否则可能是半截写入，再等一轮。
        if (exited !== undefined) {
          await this.#settle(attempt, { state: "failed", reason: "config-invalid" });
          return;
        }
        continue;
      }
      if (exited !== undefined) {
        // 正常退出却没留下登录产物 = 浏览器里没批准；异常退出 = 本机链路坏了。
        await this.#settle(attempt, {
          state: "failed",
          reason: exited.code === 0 ? "no-signin" : "unavailable",
        });
        return;
      }
    }
  }

  /**
   * 读本机登录产物；文件不存在或读不了都读作 `undefined`（那是常态，不是错误）。
   * @returns 文件原文，或 `undefined`。
   */
  async #readProfileText(): Promise<string | undefined> {
    try {
      const text = await this.#readFile(this.#profilePath);
      return normalizeKey(text) === undefined ? undefined : text;
    } catch {
      return undefined;
    }
  }

  /**
   * 收下 profile 并把凭据交给装配层。每个 await 之后都复检所有权：取消之后绝不落库
   * （最后一次复检与 `storeKey` 调用之间没有 await，与另两家同一条纪律）。
   * @param attempt - 本次尝试的代际。
   * @param profile - 已解析的 profile。
   */
  async #complete(attempt: number, profile: OpenDesignProfile): Promise<void> {
    if (!this.#ownsAttempt(attempt)) return;
    const label = profileLabel(profile);
    try {
      await this.#deps.storeKey({
        ref: accountRef(OPEN_DESIGN_LOGIN_VENDOR, label),
        key: profile.runtimeKey,
        ...(profile.controlKey === undefined ? {} : { controlKey: profile.controlKey }),
        ...(profile.workspaceId === undefined ? {} : { workspaceId: profile.workspaceId }),
        label,
      });
    } catch {
      await this.#settle(attempt, { state: "failed", reason: "unavailable" });
      return;
    }
    await this.#settle(attempt, { state: "success" });
  }

  /**
   * 终结一次尝试：**先同步改状态**，再收掉子进程与在途信号。所有权判据是「代际相等 +
   * 状态还是 `waiting`」，先改状态是同步的失效动作。
   * @param attempt - 尝试代际。
   * @param status - 终态状态面。
   * @returns 本次调用是否真的终结了这次尝试（不是所有者时什么都不做）。
   */
  async #settle(attempt: number, status: LoginStatus): Promise<boolean> {
    if (!this.#ownsAttempt(attempt)) return false;
    this.#cancelPending = false;
    this.#statusValue = status;
    this.#teardown();
    return true;
  }

  /**
   * 这次代际是否仍然拥有状态面：既没被取消/终结，也没被一次新的 `begin()` 顶掉。
   * @param attempt - 尝试代际。
   * @returns 是否仍拥有。
   */
  #ownsAttempt(attempt: number): boolean {
    return this.#attemptSeq === attempt && this.#statusValue.state === "waiting";
  }

  /** 收掉本次尝试的痕迹：中止在途信号、kill 子进程（kill 已退出的进程是无害无操作）。 */
  #teardown(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    const child = this.#child;
    this.#child = undefined;
    try {
      child?.kill();
    } catch {
      // 已经退出或从未启动：不构成错误。
    }
  }
}

/**
 * 造一个 Open Design 网页登录端口（设备授权，只读本机登录产物）。
 * @param deps - 落库回调与各个 I/O 注入点。
 * @returns 登录端口。
 */
export function createOpenDesignLogin(deps: OpenDesignLoginDeps): OpenDesignLogin {
  return new OpenDesignLoginFlow(deps);
}

/**
 * 从一段文本里取出 JSON 负载：整体可解析就用整体，否则从后往前找第一条能解析的行
 * （CLI 常在自己的日志之后再打 JSON）。
 * @param text - 子进程输出。
 * @returns 解析出来的值，或 `undefined`。
 */
export function parseVelaJson(text: string): unknown {
  const trimmed = stripAnsi(text).trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // 逐行回退。
  }
  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // 继续往前找。
    }
  }
  return undefined;
}

/** vela 子进程的完整输出与退出码。 */
interface VelaRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** 收完一个子进程的输出（或到点就 kill 它）。 */
function collectVelaRun(child: VelaChild, timeoutMs: number): Promise<VelaRunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 已经退出：不构成错误。
      }
      finish(null);
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (chunk) => {
      stdout += textOfChunk(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += textOfChunk(chunk);
    });
    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}

/** 发现工作区的预算（毫秒）：登录收尾时的一次查询，不该把收尾拖住。 */
export const WORKSPACE_DISCOVERY_TIMEOUT_MS = 5_000;

/** `discoverWorkspaceId` 的依赖（全部可选：缺省读本机的 vela）。 */
export interface WorkspaceDiscoveryDeps {
  /** 启动 vela 的方式；缺省 {@link defaultSpawn}。 */
  spawn?: VelaSpawn;
  /** 解析 vela 可执行文件；缺省按 {@link findVelaBinary}。 */
  resolveVela?: () => Promise<string | undefined>;
  /** 预算（毫秒）；缺省 {@link WORKSPACE_DISCOVERY_TIMEOUT_MS}。 */
  timeoutMs?: number;
}

/**
 * 问本机 vela 要「当前工作区 id」。
 *
 * 为什么要问：`~/.amr/config.json` 的 profile **不一定**带 `workspaceId`（本机实测：只有两把
 * 密钥与 user，没有工作区）。而周期额度（`billing preflight --workspace-id …`）必须有它 ——
 * 没有工作区就是一条额度窗口都读不到，用户还得自己去找 id。`vela team-projects list` 会回
 * `{ workspaceId, projects }`，那是 CLI 自己认的当前工作区，正好是这个值。
 *
 * 任何失败（找不到 vela、命令非零、输出不是 JSON）都读作「没发现」：这条路径是**锦上添花**，
 * 不能因为它把登录判成失败。
 * @param deps - 注入点（spawn / resolveVela / 预算）。
 * @returns 工作区 id，或 `undefined`。
 */
export async function discoverWorkspaceId(deps: WorkspaceDiscoveryDeps = {}): Promise<string | undefined> {
  const vela = await (deps.resolveVela ?? defaultResolveVela)();
  if (vela === undefined) return undefined;
  const spawn = deps.spawn ?? defaultSpawn;
  let child: VelaChild;
  try {
    child = spawn(vela, ["team-projects", "list"]);
  } catch {
    return undefined;
  }
  const run = await collectVelaRun(child, deps.timeoutMs ?? WORKSPACE_DISCOVERY_TIMEOUT_MS);
  if (run.code !== 0) return undefined;
  const payload = parseVelaJson(run.stdout);
  if (!isRecord(payload)) return undefined;
  const workspaceId = normalizeKey(payload.workspaceId);
  return workspaceId === undefined ? undefined : workspaceId;
}

/** `createVelaPreflight` 的依赖（全部可选：缺省读本机的 vela 与 `process.env`）。 */
export interface VelaPreflightDeps {
  /** 启动 vela 的方式；缺省 {@link defaultSpawn}。 */
  spawn?: VelaSpawn;
  /** 解析 vela 可执行文件；缺省按 {@link findVelaBinary}。 */
  resolveVela?: () => Promise<string | undefined>;
  /** 预算（毫秒）；缺省 {@link VELA_PREFLIGHT_TIMEOUT_MS}。 */
  timeoutMs?: number;
}

/**
 * 造一个 vela 周期额度读取器（`billing preflight --workspace-id <id> --format json`）。
 *
 * 失败一律**抛错**（找不到 vela、退出非零、输出不是 JSON），由额度端口兜成一句人话 ——
 * 这里绝不返回一个假读数（缺失不倒成 0 的同一纪律）。成功时返回解析出来的负载。
 * @param deps - vela 的解析与启动注入点。
 * @returns `(workspaceId) => Promise<unknown>`。
 */
export function createVelaPreflight(deps: VelaPreflightDeps = {}): (workspaceId: string) => Promise<unknown> {
  const spawn = deps.spawn ?? defaultSpawn;
  const resolveVela = deps.resolveVela ?? defaultResolveVela;
  const timeoutMs = deps.timeoutMs ?? VELA_PREFLIGHT_TIMEOUT_MS;
  return async (workspaceId: string): Promise<unknown> => {
    // 工作区 id 来自设置/登录产物（用户可改），最终会成为命令行参数。`--`/空格这类值会被
    // vela 的参数解析器当成开关（参数注入），所以只接受厂商实际使用的字符集，且**不能以
    // `-` 开头**（否则 `--help` 也能过字符集）。与 `index.ts` 的 `velaPreflight` 同一道闸门。
    if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(workspaceId)) {
      throw new Error("工作区 id 形状不对（只允许字母、数字、下划线与连字符，且不能以连字符开头）");
    }
    const vela = await resolveVela();
    if (vela === undefined) {
      throw new Error("本机找不到 vela（VELA_BIN、Open Design 桌面端内置与 PATH 都没有）");
    }
    const child = spawn(vela, ["billing", "preflight", "--workspace-id", workspaceId, "--format", "json"]);
    const result = await collectVelaRun(child, timeoutMs);
    if (result.code !== 0) {
      const detail = normalizeKey(result.stderr) ?? normalizeKey(result.stdout) ?? "vela 没有给出错误说明";
      throw new Error(`vela billing preflight 失败：${detail}`);
    }
    const payload = parseVelaJson(result.stdout);
    if (payload === undefined) {
      throw new Error("vela billing preflight 的输出不是 JSON");
    }
    return payload;
  };
}
