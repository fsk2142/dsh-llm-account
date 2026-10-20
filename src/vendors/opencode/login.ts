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
    // 上一次尝试的轮询必须停掉，否则它会继续往这个实例的状态面里写。
    this.#abort?.abort();
    const abort = new AbortController();
    this.#abort = abort;
    let device: DeviceCode;
    try {
      device = await beginDeviceFlow(this.#deps);
    } catch (error: unknown) {
      // 端点回了 HTTP 4xx/5xx（服务端拒绝、路由变了）**不是**网络错误：两种原因对用户
      // 的含义完全不同（该等/该查网络 vs 该找厂商），界面上必须分开说。
      const message = error instanceof Error ? error.message : String(error);
      const httpRejected = /HTTP \d{3}/.test(message);
      this.#status = { state: "failed", reason: httpRejected ? "unavailable" : "network" };
      return { ...this.#status };
    }
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

  /** 取消等待中的尝试；终态不受影响。 */
  async cancel(): Promise<void> {
    if (this.#status.state !== "waiting") return;
    this.#status = { state: "failed", reason: "cancelled" };
    this.#abort?.abort();
  }

  /**
   * 后台轮询：直到成功、失败、过期或取消。
   * @param device - 设备码。
   * @param signal - 本次尝试的取消信号。
   */
  async #run(device: DeviceCode, signal: AbortSignal): Promise<void> {
    const now = this.#deps.now ?? (() => Date.now());
    while (!signal.aborted) {
      if (now() >= device.expiresAt) {
        this.#settle({ state: "failed", reason: "timeout" });
        return;
      }
      try {
        await this.#sleep(device.intervalMs, signal);
      } catch {
        return;
      }
      if (signal.aborted) return;
      let result: Awaited<ReturnType<typeof pollDeviceToken>>;
      try {
        result = await pollDeviceToken(this.#deps, device);
      } catch {
        this.#settle({ state: "failed", reason: "network" });
        return;
      }
      if (signal.aborted) return;
      if (result.status === "pending") continue;
      if (result.status === "slow_down") {
        // 服务端要求放慢：等下一轮（间隔保持，至少不再更密）。
        continue;
      }
      if (result.status === "denied") {
        this.#settle({ state: "failed", reason: "denied" });
        return;
      }
      if (result.status === "expired") {
        this.#settle({ state: "failed", reason: "timeout" });
        return;
      }
      if (result.status === "error") {
        this.#settle({ state: "failed", reason: "unavailable" });
        return;
      }

      let org: Awaited<ReturnType<typeof fetchOAuthOrg>>;
      try {
        org = await fetchOAuthOrg(this.#deps, result.access);
      } catch {
        org = undefined;
      }
      if (signal.aborted) return;
      if (org === undefined) {
        this.#settle({ state: "failed", reason: "unavailable" });
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
        this.#settle({ state: "failed", reason: "unavailable" });
        return;
      }
      if (signal.aborted) return;
      this.#settle({ state: "success" });
      return;
    }
  }

  /**
   * 把等待中的尝试结算成终态；不是等待中就什么都不做（迟到的轮询结果不能覆盖取消）。
   * @param status - 终态。
   */
  #settle(status: LoginStatus): void {
    if (this.#status.state !== "waiting") return;
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
