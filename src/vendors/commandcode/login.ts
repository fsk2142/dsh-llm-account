/**
 * Command Code 网页登录：回环回调服务器 + `/alpha/whoami` 校验 + 凭据落库回调（Task 11）。
 *
 * 流程与官方 `command-code login` CLI 一致，逐条对照旧插件
 * `@mars-sea/dsh-commandcode-provider/lib/index.js`（只读参照，行号为该文件）：
 * 1. 在 `127.0.0.1` 上从 5959 起逐个探测端口（最多 10 个，`findPort` 第 8688-8696 行、
 *    `checkPortAvailable` 第 8501-8508 行）；
 * 2. 生成随机 state，拼出 `{studio}/studio/auth/cli?callback=http://localhost:{port}/callback&state=…`
 *    （`buildCommandAuthUrl` 第 8457-8460 行、`STUDIO_AUTH_PATH` 第 8449 行）；Studio 基地址按
 *    网关推导（`studioBaseForApiBase` 第 8462-8466 行）；
 * 3. Studio 页面把 `{ apiKey, state, userId, userName, keyName }` POST 回回环地址
 *    （`isCallbackCredentials` 第 8510-8514 行）；
 * 4. 落库前先用 `GET {apiBase}/alpha/whoami` 验证这把 key 真的能用
 *    （`validateCommandApiKey` 第 8472-8499 行）：401 → `invalid-key`，其它非 OK → `error`，
 *    传输失败 → `network`；`Authorization: Bearer …` 与 `accept-encoding: identity`
 *    两个头照抄（`IDENTITY_ENCODING_HEADER` 第 2915 行）。
 *
 * **HTTP 契约**（`handleCallback` 第 8728-8806 行、`corsOrigin` 第 8922-8925 行）：只绑
 * `127.0.0.1`；`OPTIONS` → 204；`/callback` 以外的路径 → 404；非 `POST` → 405；请求体上限
 * 10 000 字节（超出直接断连，不给响应）；非法 JSON → 400；字段不全 → 400；`state` 对不上 →
 * 403 且**不作废**本次尝试（用户可以继续在浏览器里完成授权）；响应一律 `Connection: close`；
 * CORS 只回显白名单里的 Origin。
 *
 * **三项加固**（旧插件头部注释第 8421-8424 行自述）：① Origin 只在白名单里才回显；
 * ② `Connection: close`，不把回调连接留成 keep-alive；③ 拒绝分支先查 `state` 再结算。
 *
 * **代际守卫**：`whoami` 与 `storeKey` 都是 await，用户可能在这段时间里取消或重新登录。
 * 每次尝试有唯一的 `attemptSeq`，`ownsAttempt()`（第 8873-8875 行）在**每个** await 之后
 * 复检；所有权判据是「代际相等 + 状态还是 `waiting`」，所以终结路径（`settleTerminal`）
 * 必须**先同步改状态、再 await 关服务器** —— 顺序反了，等待关闭的窗口里一次迟到的
 * `whoami` 成功会看到「还拥有尝试」，把用户已经取消的密钥写进凭据服务。
 *
 * 同一个守卫也适用于**投递**：服务器对象在它被 `closeCallback()` 优雅停下之后仍会服务
 * 已经建立的连接，所以一条旧请求可能在重新登录之后才把请求体送完。处理器因此把「接受
 * 这条请求的 `server` 与 `attempt`」带在闭包里（`#bindServer`），决定性投递必须通过
 * `#settleAttempt` 的代际裁决（三者对齐：当前服务器 + 当前代际 + 本次尝试的 settle 挂钩）——
 * 被替换掉的投递既不能写凭据，也不能关掉当前尝试的监听或偷走它的挂钩。
 *
 * **句柄卫生**：超时/成功/失败/取消四条路径都清定时器、中止在途验证、关掉服务器并
 * **等它真正关闭**（`close()` 的回调）——端口因此立刻可被复用，测试进程也不会被残留的
 * 监听或定时器拖住。收下决定性回调时只做优雅关闭（`closeCallback`，第 8894-8898 行）：
 * 监听端口即时释放，但正在写出的那个 JSON 响应不会被截断。
 *
 * 本模块只产出「`storeKey(ref, key)` 的调用契约」：不导入宿主 ctx、不读写设置文档、不碰
 * `AccountPort`，密钥只经注入的 `storeKey` 出去（Global Constraints）。客户端登录界面与
 * 装配留给计划 1b / Task 14。
 * @module dsh-llm-account/src/vendors/commandcode/login
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { LoginPort, LoginStatus, VendorId } from "../../core/adapter";
import { accountRef } from "../../core/accounts";

/** 登录总期限包含浏览器回调、密钥验证与存储（旧插件第 8435 行）。 */
export const LOGIN_TIMEOUT_MS = 120_000;

/** 首个候选端口（旧插件 `LOGIN_START_PORT` 第 8437 行）。 */
export const LOGIN_START_PORT = 5959;

/** 从 {@link LOGIN_START_PORT} 起连续尝试的端口个数（旧插件 `LOGIN_MAX_PORT_ATTEMPTS` 第 8439 行）。 */
export const LOGIN_PORT_ATTEMPTS = 10;

/** 回调请求体上限（旧插件 `LOGIN_BODY_LIMIT_BYTES` 第 8441 行）。 */
export const LOGIN_BODY_LIMIT_BYTES = 10_000;

/** 允许向回环服务器 POST 凭据的 Studio 来源（旧插件第 8443-8447 行）。 */
export const LOGIN_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "https://staging.commandcode.ai",
  "https://commandcode.ai",
];

/** Studio 页面里承担浏览器登录的路由（旧插件 `STUDIO_AUTH_PATH` 第 8449 行）。 */
const STUDIO_AUTH_PATH = "/studio/auth/cli";

/** 回环服务器唯一接受的路径。 */
const CALLBACK_PATH = "/callback";

/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR: VendorId = "commandcode";

/** 失败原因的稳定文案键（`LoginStatus.reason`）。 */
export type CommandCodeLoginReason =
  | "cancelled"
  | "timeout"
  | "denied"
  | "invalid-key"
  | "network"
  | "error"
  | "unavailable";

/**
 * 网页登录端口的依赖。全部由装配层注入，本模块不认识宿主 `ctx`（控制器补充 4）。
 */
export interface CommandCodeLoginDeps {
  /** `whoami` 校验与（将来的）其它调用的传输实现；测试注入假实现即可。 */
  fetchImpl: typeof fetch;
  /** 网关基地址，`/alpha/whoami` 挂在它下面。 */
  apiBase: string;
  /** 首个候选端口，默认 {@link LOGIN_START_PORT}。 */
  startPort?: number;
  /** 候选端口个数，默认 {@link LOGIN_PORT_ATTEMPTS}。 */
  portAttempts?: number;
  /** 登录总期限，默认 {@link LOGIN_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /**
   * 凭据落库。ref 由本模块按 `userName` 推导（ref 标识空间，Global Constraints），
   * key 是 Studio 交付、已通过 `whoami` 验证的密钥；本模块从不写设置文档。
   */
  storeKey: (ref: string, key: string) => Promise<void>;
}

/** 登录端口 + 状态查询里需要的只读事实。 */
export type CommandCodeLogin = LoginPort & {
  /** 等待授权时的授权网址；其余状态下为 `undefined`。 */
  readonly authUrl?: string;
  /** 本次实例实际使用的起始端口（`deps.startPort` 覆盖后）。 */
  readonly startPortDefault: number;
  /** 本次实例实际使用的候选端口个数（`deps.portAttempts` 覆盖后）。 */
  readonly portAttemptsDefault: number;
};

/** Studio 页面 POST 回来的凭据负载（形状不可信，逐字段收窄）。 */
interface CallbackCredentials {
  readonly apiKey: string;
  readonly state: string;
  readonly userId: string;
  readonly userName: string;
  readonly keyName: string;
}

/** 一次尝试的 settle 挂钩。 */
interface AttemptSettle {
  /** 这个挂钩属于哪一代尝试：迟到的投递即使蒙对 state，也不许用别人的挂钩结算。 */
  readonly attempt: number;
  resolve(credentials: CallbackCredentials): void;
  reject(failure: LoginSettleError): void;
}

/** `whoami` 的判定结果（旧插件第 8484-8498 行的三种判决）。 */
type KeyVerdict = { readonly valid: true } | { readonly valid: false; readonly reason: CommandCodeLoginReason };

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读一个字段的字符串值；非字符串一律当缺失。 */
function textOf(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * 收窄回调负载：`apiKey` 必须非空，其余字段必须是字符串（旧插件 `isCallbackCredentials`
 * 第 8510-8514 行逐字对照）。
 * @param value - 已解析的 JSON。
 * @returns 合法负载，或 `undefined`（调用方回 400）。
 */
function parseCredentials(value: unknown): CallbackCredentials | undefined {
  if (!isRecord(value)) return undefined;
  const apiKey = textOf(value, "apiKey");
  const state = textOf(value, "state");
  const userId = textOf(value, "userId");
  const userName = textOf(value, "userName");
  const keyName = textOf(value, "keyName");
  if (
    apiKey === undefined ||
    apiKey === "" ||
    state === undefined ||
    userId === undefined ||
    userName === undefined ||
    keyName === undefined
  ) {
    return undefined;
  }
  return { apiKey, state, userId, userName, keyName };
}

/**
 * 拼出 Studio 授权网址（纯函数，旧插件 `buildCommandAuthUrl` 第 8457-8460 行）。
 *
 * 两处都用 `encodeURIComponent` 逐段编码：`callback` 里的 `:`、`/` 必须编码，`state` 里的
 * 空格必须是 `%20`（`URLSearchParams` 会写成 `+`，与旧插件产物不一致）。回调地址用的是
 * `localhost` 字面量（浏览器侧），监听本身只绑 `127.0.0.1`。
 * @param options - Studio 基地址、回调端口与本次 state。
 * @returns 授权网址。
 */
export function buildCommandCodeAuthUrl(options: { studioBase: string; port: number; state: string }): string {
  const callback = `http://localhost:${options.port}${CALLBACK_PATH}`;
  return `${options.studioBase}${STUDIO_AUTH_PATH}?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(options.state)}`;
}

/**
 * 按网关基地址推导 Studio 基地址（纯函数，旧插件第 8462-8466 行）。
 * @param apiBase - 网关基地址。
 * @returns 与之配套的 Studio 基地址。
 */
export function studioBaseForApiBase(apiBase: string): string {
  if (/^https:\/\/staging-api\.commandcode\.ai/i.test(apiBase)) return "https://staging.commandcode.ai";
  if (/^http:\/\/localhost(:\d+)?$/i.test(apiBase)) return "http://localhost:3000";
  return "https://commandcode.ai";
}

/** 只在白名单里回显 Origin，其它一律空（旧插件 `corsOrigin` 第 8922-8925 行）。 */
function corsOrigin(origin: string | string[] | undefined): string {
  if (typeof origin !== "string") return "";
  return LOGIN_ALLOWED_ORIGINS.includes(origin) ? origin : "";
}

/** 一个候选端口现在是否空闲（旧插件第 8501-8508 行：探针绑上再放开）。 */
function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => {
      resolve(false);
    });
    probe.once("listening", () => {
      probe.close(() => {
        resolve(true);
      });
    });
    probe.listen(port, "127.0.0.1");
  });
}

/** 关掉一个监听器，吞掉「没在监听/已经关过」这类无害错误（旧插件第 8908-8912 行）。 */
function closeQuietly(server: Server | undefined): void {
  try {
    server?.close();
  } catch {
    // 已经关闭或从未监听：不构成错误。
  }
}

/**
 * 拿交付的密钥问一次 `GET {apiBase}/alpha/whoami`（旧插件第 8472-8499 行）。
 *
 * 只认「能通过」与三种失败：401 → `invalid-key`（key 确实不对），其它非 OK → `error`
 * （服务端问题，换把 key 也没用），传输层失败 → `network`。任何情况下都不抛：调用方
 * 需要的是一个判决，而不是异常。
 * @param fetchImpl - 注入的传输实现。
 * @param apiBase - 网关基地址。
 * @param apiKey - 待验证的密钥。
 * @param signal - 尝试的中止信号（取消/超时后让在途请求尽快结束）。
 * @returns 判决结果。
 */
async function validateApiKey(
  fetchImpl: typeof fetch,
  apiBase: string,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<KeyVerdict> {
  try {
    const response = await fetchImpl(`${apiBase}/alpha/whoami`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "accept-encoding": "identity",
        Authorization: `Bearer ${apiKey}`,
      },
      ...(signal === undefined ? {} : { signal }),
    });
    // 只要判决，不要正文：把体重放掉，避免在 keep-alive 池里积着没人读的响应（旧插件同）。
    response.body?.cancel().catch(() => undefined);
    if (response.status === 401) return { valid: false, reason: "invalid-key" };
    if (response.ok) return { valid: true };
    return { valid: false, reason: "error" };
  } catch {
    return { valid: false, reason: "network" };
  }
}

/** 一次决定性失败的稳定原因（`reason` 直接进状态面）。 */
class LoginSettleError extends Error {
  readonly reason: CommandCodeLoginReason;

  /**
   * @param reason - 稳定文案键。
   * @param message - 供日志阅读的说明（**不进**状态面：`LoginStatus` 只有稳定的键）。
   */
  constructor(reason: CommandCodeLoginReason, message: string) {
    super(message);
    this.name = "LoginSettleError";
    this.reason = reason;
  }
}

/**
 * 一次网页登录尝试的状态机（单飞）：`begin()` 在等待中时返回同一次尝试，绑定还没落地时
 * 返回同一个在途 promise；终态之后的下一次 `begin()` 才开新尝试。
 */
class CommandCodeLoginFlow implements CommandCodeLogin {
  readonly #deps: CommandCodeLoginDeps;
  readonly #startPort: number;
  readonly #portAttempts: number;
  #statusValue: LoginStatus = { state: "idle" };
  #server: Server | undefined;
  #timer: NodeJS.Timeout | undefined;
  #attemptAbort: AbortController | undefined;
  /** 当前尝试的 settle 挂钩；收下决定性回调后失效。 */
  #settle: AttemptSettle | undefined;
  /**
   * 尝试代际。交付的密钥会在 `complete()` 里异步验证，这段窗口对取消与重新登录都是敞开的；
   * 代际让迟到的结果认出自己已经不再拥有状态面，从而不落库、不改状态。
   */
  #attemptSeq = 0;
  /**
   * 正在绑定端口的那次 `begin()`。它落地之前状态面还说不出 `waiting`，所以后来者必须
   * 复用它：两次独立的启动会各绑一个回环服务器，而只有最后一个能被 teardown 关掉 ——
   * 孤儿服务器会在进程余生里继续应答 `/callback`，十次就能把端口窗口耗光。
   */
  #starting: Promise<LoginStatus> | undefined;
  /** 绑定期间到达的 `cancel()`：那次启动落地后自行退场（旧插件第 8659、8611-8620 行）。 */
  #cancelPending = false;

  /**
   * @param deps - 传输、网关基地址、端口/期限覆盖与凭据落库回调。
   */
  constructor(deps: CommandCodeLoginDeps) {
    this.#deps = deps;
    this.#startPort = deps.startPort ?? LOGIN_START_PORT;
    this.#portAttempts = deps.portAttempts ?? LOGIN_PORT_ATTEMPTS;
  }

  /** @returns 等待授权时的授权网址。 */
  get authUrl(): string | undefined {
    return this.#statusValue.authUrl;
  }

  /** @returns 本次实例实际使用的起始端口。 */
  get startPortDefault(): number {
    return this.#startPort;
  }

  /** @returns 本次实例实际使用的候选端口个数。 */
  get portAttemptsDefault(): number {
    return this.#portAttempts;
  }

  /**
   * 开始（或接续）一次尝试，返回其最新状态。
   * @returns 最新状态（`waiting` 时带授权网址）。
   */
  async begin(): Promise<LoginStatus> {
    if (this.#statusValue.state === "waiting" && this.#server !== undefined) return { ...this.#statusValue };
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
   * 取消等待中的尝试；终态不受影响。绑定还没落地时只是标记，等它落地后自行退场。
   *
   * 返回前**等服务器真正关闭**：这样调用方（与测试）看到 `cancelled` 时端口已经释放，
   * 不必靠睡眠去猜。
   */
  async cancel(): Promise<void> {
    // 先标记在途的启动，再终结状态面。两件事都要做：上一次尝试还在验证（`waiting`，但监听
    // 已经收了）时用户又 `begin()` 一次，那次新启动的 `attemptSeq` 还没落地，只按状态分支
    // 会漏掉它 —— 标记让它在绑定落地后自行退场。反过来，只标记不终结会让「上一次尝试」
    // 的验证结果在取消之后落库。`begin()` 每次都会清掉这个标记，所以它不会误伤后来的尝试。
    if (this.#starting !== undefined) this.#cancelPending = true;
    if (this.#statusValue.state !== "waiting") return;
    await this.#settleTerminal(this.#attemptSeq, { state: "failed", reason: "cancelled" });
  }

  /**
   * 绑定半程：一次尝试、一个服务器、一个 `waiting` 状态。调用方只能经 `begin()` 的单飞栅栏进来。
   * @returns 尝试落地后的状态。
   */
  async #startAttempt(): Promise<LoginStatus> {
    await this.#teardown();
    const attempt = (this.#attemptSeq += 1);
    this.#attemptAbort = new AbortController();
    const port = await this.#findPort();
    const expectedState = randomBytes(32).toString("base64url");
    const settled = new Promise<CallbackCredentials>((resolve, reject) => {
      this.#settle = { attempt, resolve, reject };
    });
    await this.#bindServer(port, attempt, expectedState);
    if (this.#cancelPending) {
      this.#cancelPending = false;
      this.#attemptAbort?.abort();
      this.#attemptAbort = undefined;
      this.#statusValue = { state: "failed", reason: "cancelled" };
      await this.#closeServer(true);
      return this.#statusValue;
    }
    this.#statusValue = {
      state: "waiting",
      authUrl: buildCommandCodeAuthUrl({
        studioBase: studioBaseForApiBase(this.#deps.apiBase),
        port,
        state: expectedState,
      }),
    };
    this.#timer = setTimeout(() => {
      // `settleTerminal` 先同步改状态再 await 关服务器，所以这里不必再判所有权。
      void this.#settleTerminal(attempt, { state: "failed", reason: "timeout" });
    }, this.#deps.timeoutMs ?? LOGIN_TIMEOUT_MS);
    // 不让总期限自己把进程钉住：等待期间服务器本来就撑着事件循环，定时器照常会响。
    this.#timer.unref();
    settled.then(
      (credentials) => {
        void this.#complete(attempt, credentials);
      },
      (failure: unknown) => {
        void this.#failFrom(attempt, failure);
      },
    );
    return this.#statusValue;
  }

  /**
   * 候选端口里的第一个空闲端口（旧插件 `findPort` 第 8688-8696 行）。
   * @returns 可用端口。
   */
  async #findPort(): Promise<number> {
    for (let index = 0; index < this.#portAttempts; index += 1) {
      const candidate = this.#startPort + index;
      if (await checkPortAvailable(candidate)) return candidate;
    }
    throw new Error(
      `No available port found after ${this.#portAttempts} attempts starting from port ${this.#startPort}`,
    );
  }

  /**
   * 绑定本次尝试的回环服务器（旧插件 `bindServer` 第 8702-8726 行）。只绑 `127.0.0.1`：
   * 绑定前的失败从 `begin()` 抛出；绑定后的服务器错误结算为带标签的失败。
   *
   * 处理器**带着自己那一次尝试的代际与服务器句柄**进闭包：服务器对象会一直服务它已经接受的
   * 连接，哪怕它早已不是当前尝试的监听器，所以「这条请求属于哪一代」只能由它自己带来，不能
   * 在结算时去读实例上的当前值。服务器错误分支（下面）本来就是这个写法。
   * @param port - 已探测到的空闲端口。
   * @param attempt - 本次尝试的代际。
   * @param expectedState - 本次尝试的 state（闭包进请求处理器）。
   * @returns 监听已建立。
   */
  #bindServer(port: number, attempt: number, expectedState: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let binding = true;
      const server = createServer((request, response) => {
        this.#handleCallback(request, response, attempt, expectedState, server);
      });
      this.#server = server;
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (this.#server !== server) {
          closeQuietly(server);
          return;
        }
        this.#server = undefined;
        closeQuietly(server);
        const failure = new LoginSettleError(
          "error",
          `Could not bind the login callback server on port ${port}: ${error.code ?? error.message}`,
        );
        if (binding) {
          binding = false;
          reject(failure);
        } else {
          this.#settle?.reject(failure);
        }
      });
      server.listen(port, "127.0.0.1", () => {
        if (!binding) return;
        binding = false;
        resolve();
      });
    });
  }

  /**
   * 一个回调请求（旧插件 `handleCallback` 第 8728-8806 行）。判定顺序是契约的一部分：
   * OPTIONS → 路径 → 方法 → 体积/JSON → 字段 → state。
   *
   * 只有「决定性投递」（拒绝回执与凭据）才需要代际裁决，那两步都交给
   * {@link #settleAttempt}，并把这条请求自己的 `server` 与 `attempt` 一并交过去：本方法本身
   * 不做任何跨代际的读写，所以旧服务器上任何迟到的非决定性应答都无害。
   * @param request - 回环请求。
   * @param response - 回环响应。
   * @param attempt - 接受这条请求的那次尝试的代际。
   * @param expectedState - 那次尝试的 state。
   * @param server - 接受这条请求的那个服务器句柄。
   */
  #handleCallback(
    request: IncomingMessage,
    response: ServerResponse,
    attempt: number,
    expectedState: string,
    server: Server,
  ): void {
    response.setHeader("Connection", "close");
    response.setHeader("Access-Control-Allow-Origin", corsOrigin(request.headers.origin));
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Content-Type", "application/json");
    const json = (code: number, body: unknown): void => {
      response.writeHead(code);
      response.end(JSON.stringify(body));
    };
    if (request.method === "OPTIONS") {
      request.resume();
      response.writeHead(204);
      response.end();
      return;
    }
    // 提前应答的分支要主动排空请求体：留着没读的数据就关连接会被对端读成一次连接重置，
    // 客户端可能因此拿不到刚写出的状态码（小体积请求大多碰不上，但没必要赌）。
    if ((request.url?.split("?")[0] ?? "/") !== CALLBACK_PATH) {
      request.resume();
      json(404, { success: false, error: "Not found" });
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      json(405, { success: false, error: "Method not allowed. Use POST." });
      return;
    }
    let bodyBytes = 0;
    let body = "";
    request.on("data", (chunk: Buffer) => {
      bodyBytes += chunk.length;
      body += chunk.toString();
      // 超过上限就断连，不给响应：调用方只该知道「这次投递不可用」。
      if (bodyBytes > LOGIN_BODY_LIMIT_BYTES) request.destroy();
    });
    request.on("end", () => {
      if (request.destroyed) return;
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        json(400, { success: false, error: "Invalid JSON" });
        return;
      }
      // Studio 的拒绝回执：带 `error` 的负载。先查 state 再结算（加固 ③）。
      if (isRecord(payload) && "error" in payload) {
        if (textOf(payload, "state") !== expectedState) {
          json(403, { success: false, error: "Invalid state token" });
          return;
        }
        const description = textOf(payload, "error_description") ?? textOf(payload, "error") ?? "";
        this.#settleAttempt(
          server,
          attempt,
          json,
          200,
          { success: true },
          new LoginSettleError(
            textOf(payload, "error") === "access_denied" ? "denied" : "error",
            description === "" ? "Authorization failed" : description,
          ),
        );
        return;
      }
      const credentials = parseCredentials(payload);
      if (credentials === undefined) {
        json(400, { success: false, error: "Missing required fields" });
        return;
      }
      if (credentials.state !== expectedState) {
        // 伪造投递不作废本次尝试：用户还可以继续在浏览器里完成授权。
        json(403, { success: false, error: "Invalid state token" });
        return;
      }
      this.#settleAttempt(server, attempt, json, 200, { success: true }, undefined, credentials);
    });
    request.on("error", () => {
      // 客户端半路断开不是服务端错误：这一次投递作废，登录仍在等待。
    });
  }

  /**
   * 应答一次决定性回调、停止监听、结算这次尝试（旧插件 `settleAttempt` 第 8808-8816 行）。
   *
   * **代际裁决**：投递带着接受它的那个 `server` 与 `attempt` 进来，只有「还是当前的服务器 +
   * 还是当前的代际 + 还是当前这次尝试的 settle 挂钩」三者同时成立才准结算与关监听。旧服务器
   * 上一条已经建立的连接（监听器早被 `closeCallback` 优雅关闭了，连接本身还活着）可能在被
   * 替换之后才把请求体送完：若不裁决，它会拿**新尝试**的挂钩结算（于是把旧凭据写进新尝试），
   * 并且关掉新尝试正在用的监听器、偷走它的挂钩（浏览器真实投递被拒，登录一直挂到总期限）。
   * 对当前这次尝试来说，这种 state 本来就不属于它，所以按既有的拒绝形状回 403（不引入新的
   * 文案键，也不改动旧插件的拒绝词汇表）。
   * @param server - 接受这条请求的服务器句柄。
   * @param attempt - 接受这条请求的那次尝试的代际。
   * @param json - 已装配好响应头的应答函数。
   * @param code - 状态码。
   * @param body - 响应体。
   * @param failure - 带标签的失败（拒绝回执）。
   * @param credentials - 通过 state 校验的凭据。
   */
  #settleAttempt(
    server: Server,
    attempt: number,
    json: (code: number, body: unknown) => void,
    code: number,
    body: unknown,
    failure?: LoginSettleError,
    credentials?: CallbackCredentials,
  ): void {
    const settle = this.#settle;
    if (
      this.#server !== server ||
      !this.#ownsAttempt(attempt) ||
      settle === undefined ||
      settle.attempt !== attempt
    ) {
      json(403, { success: false, error: "Invalid state token" });
      return;
    }
    json(code, body);
    this.#closeCallback(server);
    if (failure !== undefined) settle.reject(failure);
    else if (credentials !== undefined) settle.resolve(credentials);
  }

  /**
   * 验证后的收尾：先 `whoami`，再落库，最后推到终态（旧插件 `complete` 第 8828-8871 行）。
   *
   * 每个 await 之后都复检所有权：能在取消之后落库的唯一路径是「最后一次复检与
   * `storeKey` 调用之间没有 await」—— 这里正是如此，写已经交出去就收不回来（本模块不提供
   * 补偿）；但没交出去之前绝不交。
   * @param attempt - 尝试代际。
   * @param credentials - 通过 state 校验的凭据。
   */
  async #complete(attempt: number, credentials: CallbackCredentials): Promise<void> {
    if (!this.#ownsAttempt(attempt)) return;
    const verdict = await validateApiKey(
      this.#deps.fetchImpl,
      this.#deps.apiBase,
      credentials.apiKey,
      this.#attemptAbort?.signal,
    );
    if (!this.#ownsAttempt(attempt)) return;
    if (!verdict.valid) {
      await this.#settleTerminal(attempt, { state: "failed", reason: verdict.reason });
      return;
    }
    try {
      await this.#deps.storeKey(accountRef(VENDOR, credentials.userName), credentials.apiKey);
    } catch {
      await this.#settleTerminal(attempt, { state: "failed", reason: "unavailable" });
      return;
    }
    await this.#settleTerminal(attempt, { state: "success" });
  }

  /**
   * 把一次带标签的失败映射到状态面（旧插件 `failFrom` 第 8877-8886 行）。
   * @param attempt - 尝试代际。
   * @param failure - settle 的拒绝原因。
   */
  async #failFrom(attempt: number, failure: unknown): Promise<void> {
    if (!(failure instanceof LoginSettleError)) return;
    await this.#settleTerminal(attempt, { state: "failed", reason: failure.reason });
  }

  /**
   * 终结一次尝试：清定时器、中止在途验证、**先同步改状态**、再关服务器并等它真的关闭。
   *
   * 顺序不能变：所有权判据是「代际相等 + 状态还是 `waiting`」，先改状态是同步的失效动作；
   * 若先 await 关服务器，窗口里一次迟到的 `whoami` 成功会看到「还拥有尝试」而落库。
   * @param attempt - 尝试代际。
   * @param status - 终态状态面。
   * @returns 本次调用是否真的终结了这次尝试（不是所有者时什么都不做）。
   */
  async #settleTerminal(attempt: number, status: LoginStatus): Promise<boolean> {
    if (!this.#ownsAttempt(attempt)) return false;
    this.#clearTimer();
    this.#attemptAbort?.abort();
    this.#attemptAbort = undefined;
    this.#statusValue = status;
    await this.#closeServer(true);
    return true;
  }

  /**
   * 这次代际是否仍然拥有状态面（旧插件 `ownsAttempt` 第 8873-8875 行）：既没被取消/终结，
   * 也没被一次新的 `begin()` 顶掉。
   * @param attempt - 尝试代际。
   * @returns 是否仍拥有。
   */
  #ownsAttempt(attempt: number): boolean {
    return this.#attemptSeq === attempt && this.#statusValue.state === "waiting";
  }

  /** 清掉总期限定时器：终态之后还挂着定时器就是句柄泄漏。 */
  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * 收下决定性回调后停止监听（旧插件 `closeCallback` 第 8894-8898 行）。只做优雅关闭：
   * 监听端口同步释放，但正在写出的那个 JSON 响应会正常送完；总期限**故意保留**，用它约束
   * 后续的验证与存储。
   *
   * 只关**这一条请求自己的那个服务器**：它可能早就不是当前尝试的监听器了（被替换过），
   * 那时这里什么都不做，绝不去动新尝试的监听器与挂钩。
   * @param server - 接受这条请求的服务器句柄。
   */
  #closeCallback(server: Server): void {
    if (this.#server !== server) return;
    this.#server = undefined;
    this.#settle = undefined;
    closeQuietly(server);
  }

  /**
   * 结束上一次尝试的全部痕迹：定时器、在途验证信号、监听器。不改状态面（调用方决定去向）。
   */
  async #teardown(): Promise<void> {
    this.#clearTimer();
    this.#attemptAbort?.abort();
    this.#attemptAbort = undefined;
    await this.#closeServer(true);
  }

  /**
   * 关掉本次尝试的监听器，并等它**真的关闭**（`close()` 的回调）。取消/成功/超时/失败都要
   * 经过这里，否则端口与句柄会泄漏。
   * @param force - 连已建立的连接一起断掉。取消与超时时没有需要保住的响应，而优雅关闭可能被
   *   一个不守规矩的客户端拖住；收下回调时的关闭走 {@link #closeCallback}，不用这个。
   * @returns 监听器已关闭（或本来就没有）。
   */
  async #closeServer(force: boolean): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#settle = undefined;
    if (server === undefined) return;
    if (force) server.closeAllConnections();
    await new Promise<void>((resolve) => {
      // 回调带不带错误都算「结束了」：这里的目标是「句柄没了」，不是「关得漂亮」。
      server.close(() => {
        resolve();
      });
    });
  }
}

/**
 * 造一个 Command Code 网页登录端口（回环回调，只绑 `127.0.0.1`）。
 * @param deps - 传输、网关基地址、端口/期限覆盖与凭据落库回调。
 * @returns 登录端口。
 */
export function createCommandCodeLogin(deps: CommandCodeLoginDeps): CommandCodeLogin {
  return new CommandCodeLoginFlow(deps);
}
