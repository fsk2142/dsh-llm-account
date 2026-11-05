/**
 * OpenCode 实验性网页登录：设备码状态机。
 *
 * 流程：`begin` 申请设备码 → `waiting`（带 user code 与授权网址）→ 后台轮询 →
 * 成功时读工作区、把 `ocoauth1:` blob 交给注入的 `storeKey`；用户取消 / 过期 / 拒绝 /
 * 工作区读不到都落到**可指名**的失败原因。终态之后的下一次 `begin` 才开新尝试。
 *
 * 与适配器的分工：本模块只负责「拿到 blob 并写进凭据槽」，不碰设置文档、账号表或轮换；
 * 账号条目的创建由装配层的 `storeKey` 决定（同标签已存在就换密钥，不存在就新增）。
 * @module dsh-llm-account/src/vendors/opencode/login
 */
import type { LoginPort, LoginStatus, VendorId } from "../../core/adapter";
import { accountRef } from "../../core/accounts";
import {
  beginDeviceFlow,
  fetchOAuthOrg,
  pollDeviceToken,
  serializeOAuthCredential,
  type DeviceCode,
  type OAuthHttpDeps,
} from "./oauth";

/** 本登录流所属的 provider 路由（ref 生成的厂商段）。 */
export const OPENCODE_LOGIN_VENDOR: VendorId = "dsh-opencode-go";

/**
 * `slow_down` 一次后面隔增加多少毫秒。
 *
 * RFC 8628 §3.5 的原文是「increase the interval by 5 seconds」——
 * 这是**规范要求**，不是调参余地。
 */
const SLOW_DOWN_STEP_MS = 5_000;

/** 登录依赖。 */
export interface OpencodeLoginDeps extends OAuthHttpDeps {
  /**
   * 把凭据写进账号表/凭据服务。
   * @param ref - 由工作区名推导的凭据引用（可能已被同标签账号调整成别的槽）。
   * @param key - `ocoauth1:` 开头的 blob。
   * @param userName - 工作区名（账号标签的兜底）。
   */
  storeKey: (ref: string, key: string, userName: string) => Promise<void>;
  /** 轮询等待（测试注入；缺省是可被 abort 的 `setTimeout`）。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** 登录端口 + 当前授权网址。 */
export type OpencodeLogin = LoginPort & {
  /** 等待授权时的授权网址；其余状态下为 `undefined`。 */
  readonly authUrl?: string;
};

/** 默认等待：可被 abort 的定时器。 */
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

/** 一次登录尝试（单飞：等待中重复 `begin()` 返回同一个状态）。 */
class OpencodeLoginFlow implements OpencodeLogin {
  readonly #deps: OpencodeLoginDeps;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  #status: LoginStatus = { state: "idle" };
  #abort: AbortController | undefined;
  #starting: Promise<LoginStatus> | undefined;

  /**
   * @param deps - 传输、凭据落库与等待注入点。
   */
  constructor(deps: OpencodeLoginDeps) {
    this.#deps = deps;
    this.#sleep = deps.sleep ?? defaultSleep;
  }

  /** @returns 等待授权时的授权网址。 */
  get authUrl(): string | undefined {
    return this.#status.authUrl;
  }

  /** 开始（或接续）一次尝试。 */
  async begin(): Promise<LoginStatus> {
    if (this.#status.state === "waiting") return { ...this.#status };
    if (this.#starting !== undefined) return { ...(await this.#starting) };
    const starting = this.#startAttempt();
    this.#starting = starting;
    try {
      return { ...(await starting) };
    } finally {
      if (this.#starting === starting) this.#starting = undefined;
    }
  }

  async #startAttempt(): Promise<LoginStatus> {
    // 上一次尝试的轮询必须停掉，否则它会继续往这个实例的状态面里写。
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    // A retry must not retain the previous terminal state while starting.
    this.#status = { state: "idle" };
    let device: DeviceCode;
    try {
      // **把本次尝试的 signal 交给设备码申请**（2026-11-05 外部审查 F02）：
      // 用户取消后这个 fetch 必须立刻结束，而不是继续挂在网络上。
      device = await beginDeviceFlow(this.#deps, abort.signal);
    } catch (error: unknown) {
      if (this.#abort !== abort || abort.signal.aborted) return { state: "failed", reason: "cancelled" };
      // 端点回了 HTTP 4xx/5xx（服务端拒绝、路由变了）**不是**网络错误：两种原因对用户
      // 的含义完全不同（该等/该查网络 vs 该找厂商），界面上必须分开说。
      const message = error instanceof Error ? error.message : String(error);
      const httpRejected = /HTTP \d{3}/.test(message);
      this.#status = { state: "failed", reason: httpRejected ? "unavailable" : "network" };
      return { ...this.#status };
    }
    if (this.#abort !== abort) return { state: "failed", reason: "cancelled" };
    if (abort.signal.aborted) {
      this.#status = { state: "failed", reason: "cancelled" };
      return { ...this.#status };
    }
    this.#status = {
      state: "waiting",
      authUrl: device.verificationUri,
      userCode: device.userCode,
      expiresAt: device.expiresAt,
    };
    void this.#run(device, abort.signal);
    return { ...this.#status };
  }

  /** @returns 当前状态副本。 */
  async status(): Promise<LoginStatus> {
    return { ...this.#status };
  }

  /**
   * 取消等待中的尝试；终态不受影响。
   *
   * **「启动中」也必须能取消**（2026-11-04 外部审查 U05）。
   *
   * `begin()` 里 `await beginDeviceFlow()` 期间状态还是 `idle`（还没拿到设备码），
   * 原来这里以 `state !== "waiting"` 直接返回 —— 于是：
   *
   * 1. 用户点了取消，界面没反应；
   * 2. `begin()` 随后拿到设备码，检查 `abort.signal.aborted` 时信号没置位；
   * 3. 迟到的设备码把状态写成 `waiting` 并启动轮询，**取消被彻底忽略**。
   *
   * 现在无论处于哪个中间态都 abort 当前 controller：`begin()` 在拿码之后会检查
   * `abort.signal.aborted` 并落到 `cancelled`，不会启动轮询、也不会写入账号。
   * 终态（success/failed）仍然不受影响 —— 已经结束的尝试不该被改写。
   */
  async cancel(): Promise<void> {
    if (this.#status.state === "success") return;
    // 已经因取消/超时/失败落定的，保持原样（不把 `timeout` 改写成 `cancelled`）。
    if (this.#status.state === "failed") return;
    this.#status = { state: "failed", reason: "cancelled" };
    this.#starting = undefined;
    this.#abort?.abort();
  }

  /**
   * 后台轮询：直到成功、失败、过期或取消。
   * @param device - 设备码。
   * @param signal - 本次尝试的取消信号。
   */
  async #run(device: DeviceCode, signal: AbortSignal): Promise<void> {
    const now = this.#deps.now ?? (() => Date.now());
    /**
     * **轮询间隔是可变的**（2026-11-05 外部审查 F03）。
     *
     * RFC 8628 §3.5：收到 `slow_down` 之后，**本次及后续**请求的轮询间隔必须
     * 增加 5 秒。上一版只 `continue`，注释还写着「间隔保持」—— 那是把 bug 当设计，
     * 对着规范读会觉得理直气壮，对着服务端读就是持续过快打 token 端点，
     * 更容易被限流甚至暂时封锁。
     *
     * 初始值取设备码响应的 `interval`；每次 `slow_down` 累加 5s，不再回退。
     * 不在登录尝试之间复用（`#run` 每次尝试重新初置）。
     */
    let pollIntervalMs = device.intervalMs;
    while (!signal.aborted) {
      if (now() >= device.expiresAt) {
        this.#settle({ state: "failed", reason: "timeout" }, signal);
        return;
      }
      try {
        await this.#sleep(pollIntervalMs, signal);
      } catch {
        return;
      }
      if (signal.aborted) return;
      let result: Awaited<ReturnType<typeof pollDeviceToken>>;
      try {
        result = await pollDeviceToken(this.#deps, device, signal);
      } catch {
        // 取消优先于「网络失败」：用户点了停止不该被报成 `network`。
        if (signal.aborted) return;
        this.#settle({ state: "failed", reason: "network" }, signal);
        return;
      }
      if (signal.aborted) return;
      if (result.status === "pending") continue;
      if (result.status === "slow_down") {
        // RFC 8628 §3.5：慢下来就是真的慢下来，之后每一轮都用新间隔。
        pollIntervalMs += SLOW_DOWN_STEP_MS;
        continue;
      }
      if (result.status === "denied") {
        this.#settle({ state: "failed", reason: "denied" }, signal);
        return;
      }
      if (result.status === "expired") {
        this.#settle({ state: "failed", reason: "timeout" }, signal);
        return;
      }
      if (result.status === "error") {
        this.#settle({ state: "failed", reason: "unavailable" }, signal);
        return;
      }

      let org: Awaited<ReturnType<typeof fetchOAuthOrg>>;
      try {
        org = await fetchOAuthOrg(this.#deps, result.access, signal);
      } catch {
        // 取消优先（F02）：被 abort 的 org 查询不是「服务不可用」。
        if (signal.aborted) return;
        org = undefined;
      }
      if (signal.aborted) return;
      if (org === undefined) {
        this.#settle({ state: "failed", reason: "unavailable" }, signal);
        return;
      }
      const name = org.name ?? org.id;
      const blob = serializeOAuthCredential({
        v: 1,
        access: result.access,
        refresh: result.refresh,
        expiresAt: result.expiresAt,
        orgId: org.id,
        ...(org.name === undefined ? {} : { orgName: org.name }),
        userName: name,
        ...(this.#deps.authBase === undefined ? {} : { authBase: this.#deps.authBase }),
      });
      try {
        await this.#deps.storeKey(accountRef(OPENCODE_LOGIN_VENDOR, name), blob, name);
      } catch {
        this.#settle({ state: "failed", reason: "unavailable" }, signal);
        return;
      }
      if (signal.aborted) return;
      this.#settle({ state: "success" }, signal);
      return;
    }
  }

  /**
   * 把等待中的尝试结算成终态；不是等待中就什么都不做（迟到的轮询结果不能覆盖取消）。
   * @param status - 终态。
   */
  #settle(status: LoginStatus, signal: AbortSignal): void {
    if (signal.aborted || this.#abort?.signal !== signal || this.#status.state !== "waiting") return;
    this.#status = status;
  }
}

/**
 * 造一个 OpenCode 登录端口。
 * @param deps - 传输、落库与等待注入点。
 * @returns 登录端口。
 */
export function createOpencodeLogin(deps: OpencodeLoginDeps): OpencodeLogin {
  return new OpencodeLoginFlow(deps);
}
