/**
 * **网关健康状态的短期记忆**（2026-11-12 审查 A07）。
 *
 * ## 被钉住的问题
 *
 * 三家适配器的 `#fallbackModel` 都写着：
 *
 * ```ts
 * { sameGatewayOnly: failureKind === "network" }
 * ```
 *
 * 那个取舍的理由是「`fetch failed` / DNS / 代理不通意味着**这台机器出不去**，
 * 换一家走的是同一条路由、必然同样失败」。
 *
 * 但它把两件不同的事混成了一件：
 *
 * | 真实情况 | 旧行为 | 应该 |
 * | --- | --- | --- |
 * | 整台机器断网 | 同网关内换，白试 | 不跨网关（旧行为正确） |
 * | **只有 A 家域名挂了 / 被 VPN 分流拦住** | 同网关内换，A 家本来就不可达 | **跨到 B 家救援** |
 *
 * 后者正是用户实际遇到的场景（「开 VPN 时某些网关连不上」）。
 *
 * ## 修法：按网关记「谁刚刚网络失败过」
 *
 * 不再用「一个 network 错误码推断全网不可达」，改成**按目标网关判断可达性**：
 *
 * 1. 某家发生网络层失败时，把它记进这张表；
 * 2. 换模型时，把**最近网络失败过的网关**从候选里排除；
 * 3. 于是「整网断」的时候，第二家也很快被记进去，不会无限试；
 *    「只有 A 家挂」的时候，B 家仍可选 —— 这正是要救援的情形。
 *
 * 窗口取 {@link NETWORK_DOWN_WINDOW_MS}：短到「网络恢复了就立刻重新可用」，
 * 长到足以覆盖一次失败请求的重试节奏。
 *
 * @module dsh-llm-account/src/core/switching/gateway-health
 */

/**
 * 一个网关「网络失败」的记录保留多久（毫秒）。
 *
 * 60 秒：与目录缓存同档。太短会让「刚失败又立刻重试」反复撞墙；
 * 太长则 VPN 恢复后仍被当成不可用。
 */
export const NETWORK_DOWN_WINDOW_MS = 60_000;

/** provider → 最近一次网络层失败的时刻。 */
const networkDownAt = new Map<string, number>();

/**
 * 记一次网络层失败。
 * @param provider - 网关 id。
 * @param at - 失败时刻（毫秒）。
 */
export function noteNetworkFailure(provider: string, at: number = Date.now()): void {
  if (typeof provider !== "string" || provider === "") return;
  networkDownAt.set(provider, at);
}

/**
 * 最近网络失败过的网关清单。
 * @param now - 现在（毫秒）。
 * @param windowMs - 保留窗口（缺省 {@link NETWORK_DOWN_WINDOW_MS}）。
 * @returns 应被排除的网关 id。
 */
export function recentlyNetworkDown(
  now: number = Date.now(),
  windowMs: number = NETWORK_DOWN_WINDOW_MS,
): readonly string[] {
  const down: string[] = [];
  for (const [provider, at] of networkDownAt) {
    if (now - at <= windowMs) down.push(provider);
  }
  return down;
}

/**
 * 某家现在是否算「网络不可达」。
 * @param provider - 网关 id。
 * @param now - 现在（毫秒）。
 * @param windowMs - 保留窗口。
 * @returns 是否在窗口内失败过。
 */
export function isNetworkDown(
  provider: string,
  now: number = Date.now(),
  windowMs: number = NETWORK_DOWN_WINDOW_MS,
): boolean {
  const at = networkDownAt.get(provider);
  return at !== undefined && now - at <= windowMs;
}

/**
 * 复位本模块的全部状态（**测试隔离钩子**）。
 *
 * 生产代码不调用：这张表本来就是个进程级的小缓存，跨请求保留才有意义。
 */
export function resetGatewayHealth(): void {
  networkDownAt.clear();
}
