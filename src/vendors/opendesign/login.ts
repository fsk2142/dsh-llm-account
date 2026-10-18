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

/** 失败原因的稳定文案键（`LoginStatus.reason`；客户端按 `account.reason.<key>` 取词）。 */
export type OpenDesignLoginReason =
  | "cancelled"
  | "timeout"
  | "unavailable"
  /** 本机既没有 vela，也没有可用的本机登录产物。 */
  | "vela-missing"
  /** vela 正常结束，但登录产物没出现（浏览器里没批准）。 */
  | "no-signin"
  /** 登录产物的形状不认得（缺 `runtimeKey` 之类）。 */
  | "config-invalid";

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

/** 默认的启动方式：两个输出流都接管道，Windows 下不弹控制台窗口。 */
function defaultSpawn(command: string, args: readonly string[]): VelaChild {
  return nodeSpawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

/** vela 候选可执行文件名（Windows 优先 `.exe`）。 */
const VELA_FILE_NAMES: readonly string[] = ["vela.exe", "vela"];

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
    try {
      // 走**字段**而不是 `deps.resolveVela`：构造时已经把缺省解析器装进字段，直接读 deps
      // 会绕过缺省值（它还是可选属性 ——  TS 会判「可能未定义」）。
      vela = await this.#resolveVela();
    } catch {
      vela = undefined;
    }
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();

    if (vela === undefined) return await this.#importWithoutVela(attempt, abort.signal);

    let child: VelaChild;
    try {
      child = this.#spawn(vela, ["login"]);
    } catch {
      this.#statusValue = { state: "failed", reason: "unavailable" };
      return { ...this.#statusValue };
    }
    this.#child = child;
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();

    const prompt = await this.#promptWithin(child, abort.signal, this.#parseTimeoutMs);
    if (abort.signal.aborted || this.#cancelPending) return this.#settleCancelled();
    if (prompt?.authUrl === undefined) {
      // 有界窗口内没等到激活提示：vela 起不来、或它的输出形状变了。收掉子进程再报超时。
      this.#teardown();
      this.#statusValue = { state: "failed", reason: "timeout" };
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
  async #promptWithin(child: VelaChild, signal: AbortSignal, timeoutMs: number): Promise<VelaPrompt | undefined> {
    let text = "";
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
    child.on("error", onEnd);
    const timedOut = this.#sleep(timeoutMs, signal).then(
      () => undefined,
      () => undefined,
    );
    const prompt = await Promise.race([found, timedOut]);
    return prompt !== undefined && prompt.authUrl !== undefined ? prompt : undefined;
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
        const profile = parseAmrProfile(text);
        if (profile !== undefined) {
          await this.#complete(attempt, profile);
          return;
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
