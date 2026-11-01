/**
 * 按 key **串行化**的写操作队列，配合**代际**让迟到的写自动失效。
 *
 * ## 为什么需要（2026-11-01 修 S01 第二版）
 *
 * 凭据覆盖问题的本质是「读—判—写」不是原子的：
 *
 * ```
 * T0  刷新开始，记住 raw
 * T1  刷新返回，写回前重新读 → 还是 raw → 准备写
 * T2  **暂停**（事件循环让出）
 * T3  用户换 key，完整提交
 * T4  继续执行 T1 的写 → 覆盖用户的新 key
 * ```
 *
 * 第二轮复审准确指出：**再加一次普通读取解决不了**，因为读取与写入之间永远有窗口。
 * 宿主 `CredentialPort` 没有 CAS / 版本条件更新，插件侧无法做到真正的原子写。
 *
 * ## 这个模块能保证什么、不能保证什么
 *
 * **能**：本插件内**所有**对同一 ref 的凭据写入都经过这里排队，并且每次写入前
 * 校验代际 —— 用户操作（换 key / 重新登录 / 删除）会推进代际，于是**在它之前**
 * 发起的刷新不会写回。
 *
 * **不能**：插件外部（宿主凭据页、别的插件）的写入不经过这个队列。所以这不是
 * 「整个宿主的原子性」，只是「本插件内的顺序一致」。这个边界必须说清楚，不能
 * 宣传成更强的东西。
 *
 * @module dsh-llm-account/src/core/credential-guard
 */

/**
 * 造一个按 key 串行化、带代际的代写守卫。
 *
 * @returns 守卫实例。
 */
export function createCredentialGuard(): {
  /**
   * 记下一代（用户意图变更时调用）。
   * @param key - 账号 ref。
   * @returns 新的代号。
   */
  bump(key: string): number;
  /**
   * 取当前代号。
   * @param key - 账号 ref。
   * @returns 代号（从未 bump 过时为 0）。
   */
  epochOf(key: string): number;
  /**
   * 排队执行一次写操作；执行前校验代际。
   * @param key - 账号 ref。
   * @param expected - 调用方发起写时看到的代号。
   * @param write - 实际写操作。
   * @returns 是否真的写了（代际不符时返回 `false`）。
   */
  run(key: string, expected: number, write: () => Promise<void>): Promise<boolean>;
} {
  /** 每个 key 的当前代际。 */
  const epochs = new Map<string, number>();
  /** 每个 key 的写队列尾（用它串行化）。 */
  const tails = new Map<string, Promise<unknown>>();

  return {
    bump(key) {
      const next = (epochs.get(key) ?? 0) + 1;
      epochs.set(key, next);
      return next;
    },

    epochOf(key) {
      return epochs.get(key) ?? 0;
    },

    run(key, expected, write) {
      /** 前一个写的完成（无论成败）都算队列推进。 */
      const previous = tails.get(key) ?? Promise.resolve();
      const started = previous
        .catch(() => {})
        .then(async () => {
          /**
           * **排队之后、真正写之前**再校验一次代际。
           *
           * 这是关键：调用方在发起时看的是 `expected`，但它可能在队列里等过 ——
           * 等待期间用户换了 key（代际已推进），这次写必须放弃。
           */
          if ((epochs.get(key) ?? 0) !== expected) return false;
          await write();
          return true;
        })
        .finally(() => {
          // 队尾已经推进过就不再回退（避免把后来的写也拆掉）。
          if (tails.get(key) === started) tails.delete(key);
        });
      tails.set(key, started);
      return started;
    },
  };
}

/** 守卫的类型（供装配层与适配器引用）。 */
export type CredentialGuard = ReturnType<typeof createCredentialGuard>;
