/**
 * **按键隔离**的目录读取：TTL 缓存 + 并发去重 + 独立取消 + 内部超时。
 *
 * ## 为什么需要这个模块（2026-11-05 外部审查 F15 / F17）
 *
 * 三家适配器原来各写一份目录读取，其中两家是同一个形状：
 *
 * ```ts
 * if (this.#catalogInFlight !== undefined) return this.#catalogInFlight;  // ← 不分键
 * const pending = this.#fetchCatalog(config, signal);
 * this.#catalogInFlight = pending;
 * ```
 *
 * 这段代码有四个独立缺陷，每一个都能单独把用户搞糊涂：
 *
 * | 缺陷 | 表现 |
 * | --- | --- |
 * | **在途请求不分键** | 切网关/切账号后，新配置复用了旧配置的 Promise，模型列表串用 |
 * | **`fresh` 不复位** | 刷新按钮在请求在途时返回旧 Promise，「点了没反应」 |
 * | **取消串扰** | 所有等待者共用第一个调用方的 signal，A 取消把还在等的 B 一起弄死 |
 * | **超时丢失**（F17） | `signal ?? AbortSignal.timeout(10s)` —— 调用方一给 signal，10 秒上限就没了 |
 *
 * opencode 那家已经修过同一类问题（F01），用的是「代号 + 独立 controller + 等待者
 * 计数」。这里把那份已验证的思路抽成通用件，让另两家复用 —— 与
 * `docs/HANDOVER-2.0.0.md` §5.5 同一条纪律：同一逻辑分散多处，迟早漏一家。
 *
 * ## 语义
 *
 * | 场景 | 行为 |
 * | --- | --- |
 * | 缓存命中且未过期且未 `fresh` | 直接返回缓存，不发请求 |
 * | 同键并发 | 共用同一次请求（去重） |
 * | 不同键并发 | **各自发请求**（不串数据） |
 * | `fresh` | **另起一代**，不复用任何在途请求，旧一代不再能写缓存 |
 * | 某个等待者取消 | 只有它自己 reject；共享请求活到最后一个等待者也走掉 |
 * | 全部等待者离开 | abort 共享请求 |
 * | 读超时（内部） | 每个请求都有 `timeoutMs` 的硬上限，**与调用方 signal 同时生效** |
 *
 * @module dsh-llm-account/src/core/catalog-flight
 */

/** 一次在途读取。 */
interface Flight<T> {
  /** 复合键（基地址 + 凭据标识等）。 */
  readonly key: string;
  /** 本次加载的唯一代号：只有最新一代能写缓存。 */
  readonly generation: number;
  /** 共享取消入口：所有等待者都走了才 abort。 */
  readonly controller: AbortController;
  /** 结果 promise（所有等待者共用同一次网络请求）。 */
  promise: Promise<T>;
  /** 仍在等待的调用方数量。 */
  waiters: number;
}

/** 读请求的可选项。 */
export interface CatalogReadOptions {
  /** 调用方取消信号；**只取消自己的等待**。 */
  signal?: AbortSignal;
  /** 绕过 TTL 缓存与在途请求，重读（刷新按钮）。 */
  fresh?: boolean;
}

/** 构造参数。 */
export interface CatalogFlightOptions<T> {
  /** 缓存有效期（毫秒）。 */
  ttlMs: number;
  /**
   * **每个请求自己的**硬超时（毫秒）。
   *
   * 与调用方 `signal` **同时生效**，不是二选一（F17）。调用方给了 signal 却永不
   * abort 时，这一层仍然会按时放弃，不会把 socket 挂到天荒地老。
   */
  timeoutMs: number;
  /** 时钟注入（测试用）；缺省 `Date.now`。 */
  now?: () => number;
  /**
   * 真正取一次数据。
   * @param key - 复合键（换行的实现自己解析，取不到就报错）。
   * @param signal - **已合并**的取消信号（调用方取消、整体超时、隐性放弃都算数）。
   * @returns 取到的值。
   */
  load: (key: string, signal: AbortSignal) => Promise<T>;
}

/** 目录读取端口。 */
export interface CatalogFlight<T> {
  /**
   * 读一次。
   * @param key - 复合键；不同键**绝不共用**在途请求。
   * @param options - 取消信号与 `fresh`。
   * @returns 取到的值。
   */
  read(key: string, options?: CatalogReadOptions): Promise<T>;
}

/** 调用方取消时的错误码（与 `core/transport` 的 `ABORTED` 同一约定）。 */
const ABORTED = "ABORTED";

/**
 * 造一个按键隔离的目录读取器。
 * @param options - TTL、超时与加载函数。
 * @returns 读取端口。
 */
export function createCatalogFlight<T>(options: CatalogFlightOptions<T>): CatalogFlight<T> {
  const now = options.now ?? Date.now;
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : 0;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 0;

  /** 键 → 缓存条目。**按键入**：不同网关/账号各有各的缓存。 */
  const cache = new Map<string, { at: number; value: T }>();
  /** 键 → 在途请求。 */
  const flights = new Map<string, Flight<T>>();
  /** 全局代号：任何一次新加载都推进它，旧一代据此知道自己过期了。 */
  let generationSeq = 0;

  return {
    async read(key: string, readOptions: CatalogReadOptions = {}): Promise<T> {
      const { signal, fresh = false } = readOptions;

      if (!fresh) {
        const cached = cache.get(key);
        if (cached !== undefined && now() - cached.at <= ttlMs) return cached.value;
      }

      // 已取消的调用方：连共享请求都不该发起，也不该占用别人的在途。
      if (signal?.aborted === true) throw abortedError(signal);

      // `fresh` = 旧一代作废，且**不复用同键的在途请求**（那是「点了没反应」的根因）。
      if (fresh) {
        generationSeq += 1;
        flights.delete(key);
      }

      const existing = flights.get(key);
      const flight = existing ?? startFlight(key);
      if (existing !== undefined) existing.waiters += 1;
      return waitFor(flight, signal);
    },
  };

  /**
   * 起一次新加载。
   * @param key - 复合键。
   * @returns 在途条目（`waiters` 初始为 1）。
   */
  function startFlight(key: string): Flight<T> {
    const controller = new AbortController();
    const flight: Flight<T> = {
      key,
      generation: generationSeq,
      controller,
      promise: undefined as unknown as Promise<T>,
      waiters: 1,
    };
    // **合并调用方的取消与内部超时**（F17）：两者任一成立都让底层请求停下。
    const signals: AbortSignal[] = [controller.signal];
    if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
    const requestSignal = signals.length === 1 ? (signals[0] as AbortSignal) : AbortSignal.any(signals);

    flight.promise = options.load(key, requestSignal).then((value) => {
      // **只有最新一代能写缓存**：旧请求晚到时不能覆盖刚刷新出来的结果。
      if (flight.generation === generationSeq) {
        cache.set(key, { at: now(), value });
      }
      return value;
    });
    flights.set(key, flight);
    // 指针清理用**身份比较**：旧一代的 finally 不能把新一代抹掉。
    void flight.promise
      .catch(() => {})
      .finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
    return flight;
  }

  /**
   * 等一次加载的结果，把「调用方取消」与「加载失败」分开。
   * @param flight - 在途条目。
   * @param signal - 本调用方的取消信号。
   * @returns 加载结果。
   */
  async function waitFor(flight: Flight<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return flight.promise;
    if (signal.aborted) {
      releaseWaiter(flight);
      throw abortedError(signal);
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = (): void => {
        releaseWaiter(flight);
        reject(abortedError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([flight.promise, aborted]);
    } finally {
      // 正常返回后摘掉监听：长命的调用方 signal 不该累积监听器。
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * 一个等待者放弃；全部走光才 abort 共享请求（否则一个组件取消会拖死其他人）。
   * @param flight - 在途条目。
   */
  function releaseWaiter(flight: Flight<T>): void {
    flight.waiters -= 1;
    if (flight.waiters > 0) return;
    if (flights.get(flight.key) === flight) flights.delete(flight.key);
    if (!flight.controller.signal.aborted) flight.controller.abort();
  }
}

/**
 * 调用方取消时的错误。
 *
 * 用 `code: "ABORTED"` 而不是自定义类：上游（适配器的失败分类）已经按这个码
 * 区分「用户取消」与「真实故障」，复用同一条判定比新增一套更不容易漏。
 * @param signal - 已取消的信号。
 * @returns 带 `ABORTED` 码的错误。
 */
function abortedError(signal: AbortSignal): Error {
  const error = new Error("the caller aborted the catalog read");
  Object.assign(error, { code: ABORTED, ...(signal.reason === undefined ? {} : { cause: signal.reason }) });
  return error;
}
