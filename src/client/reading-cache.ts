/**
 * 一次**成功**读数的短期缓存：有新鲜数据就不重取。
 *
 * 为什么存在（2026-10-18 用户提问：「每次打开设置就会重新获取一次账号信息，理论上授权后
 * 需要每次都重新获取吗？」）：设置页容器**每次打开都会重新挂载**，挂载 effect 会把每一家的
 * `status()`（逐账号读额度；Command Code 每个账号 4 个 HTTP 端点）与 `models()` 全部重打
 * 一遍。用户的判断是对的 —— 授权之后没有理由每次打开设置都重问一遍。
 *
 * 纪律：
 * - 只缓存**成功**的读数（由调用方决定什么算成功）；失败照旧每次重试 —— 把一次瞬时故障
 *   缓存进 TTL，会让它在这段时间里假装成「事实」；
 * - `now` 可注入：TTL 的边界在单测里钉死，不靠真实时钟跑 60 秒来验证。
 * @module dsh-llm-account/src/client/reading-cache
 */

/** 一条读数与它的存放时刻。 */
interface CacheEntry<T> {
  value: T;
  at: number;
}

/**
 * 按 key（本包用厂商 id）存放读数的缓存。
 *
 * 新鲜期是「距上次 `put` 不超过 `ttlMs`」；命中时返回值，过期或没有时返回 `undefined`
 * （调用方据此去读）。命中边界取闭区间（`age === ttlMs` 仍算新鲜），这样「60 秒 TTL」
 * 与侧边栏的 60 秒轮询节奏严格对齐。
 */
export class ReadingCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  /**
   * @param ttlMs - 新鲜期（毫秒）；`<= 0` 表示永不命中（调用方每次都会重读）。
   * @param now - 取当前时刻（毫秒；测试注入假时钟）。
   */
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * 取一条仍然新鲜的读数。
   * @param key - 读数的主体。
   * @returns 读数；没有或已过新鲜期时为 `undefined`。
   */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * 记下一条读数（同键覆盖，重新计时）。
   * @param key - 读数的主体。
   * @param value - 读数。
   */
  put(key: string, value: T): void {
    this.entries.set(key, { value, at: this.now() });
  }

  /** 清空全部条目（宿主侧失效信号与测试隔离用）。 */
  clear(): void {
    this.entries.clear();
  }
}
