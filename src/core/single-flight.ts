/**
 * 按 key 合并并发调用（"single-flight"）。
 *
 * ## 为什么需要它
 *
 * 好几处「同一个 key 上并发的请求应该共享一次工作」：
 *
 * - OAuth 刷新（不共享会让并发请求各刷一次，服务端启用 refresh token 轮换时后一次必失败）；
 * - 将来任何「读一次很贵、读多次无益」的旁路操作。
 *
 * ## 语义（三条，都有测试钉住）
 *
 * 1. **同 key 并发 → 只跑一次**：第二个调用拿到第一个的 promise；
 * 2. **settle 后立刻移除表项**：失败也移除 —— 否则一次失败会被永久缓存，那个 key
 *    再也跑不动；
 * 3. **不同 key 互不影响**：按 key 隔离，不是全局串行。
 *
 * ## 为什么抽成独立模块（2026-10-22）
 *
 * 最初这段逻辑写在 adapter 的私有方法里，测试只能**复刻一份**同样的逻辑做语义验证 ——
 * 于是生产代码写错了测试照样通过（bug 审查复查指出这一点）。抽出来之后测试直接跑
 * 这份实现，变异检验才能真的抓到问题。
 *
 * @module dsh-llm-account/src/core/single-flight
 */

/**
 * 造一个「按 key 合并并发」的执行器。
 *
 * @returns 一个 `run(key, work)` 函数；同一个 key 上并发的调用共享同一次 `work`。
 */
export function createSingleFlight(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  /** 正在进行中的调用，按 key 隔离。 */
  const pending = new Map<string, Promise<unknown>>();

  return <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    /**
     * **先建 promise、同步放进表**，再返回。
     *
     * 顺序很关键：如果先 `await work()` 再入表，两个并发调用都会看到空表、各跑一次 ——
     * 那就完全失去意义。这里从「建表项」到 `return` 之间**没有 await**，所以调用方
     * 不可能观察到中间状态。
     *
     * `work()` 用 `Promise.resolve().then(work)` 包一层：它在**下一个微任务**里执行，
     * 所以即使 `work` 同步抛错也会变成 rejected promise，而不是让 `run` 同步抛出。
     * 契约是「永远返回 Promise」，同步异常会破坏这条（调用方的 `.catch` 就接不住了）。
     */
    const started = Promise.resolve()
      .then(work)
      .finally(() => {
        // 成功与失败都移除：失败不该被缓存成「永远跑不动」。
        pending.delete(key);
      });
    pending.set(key, started);
    return started;
  };
}
