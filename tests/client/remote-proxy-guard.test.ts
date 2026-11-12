/**
 * `ctx.remote` 的服务代理在**未注入的成员**上会直接抛（2026-11-12 真机报障）。
 *
 * ## 被钉住的两个崩溃
 *
 * 控制台里刷了两条，来自两处调用链、同一根因：
 *
 * ```
 * Error: cannot get property "remote.llm-account" without inject
 *   at usageNamespaceOf / useUsageNamespace → ConnectedSidebarCard
 *
 * [dsh-llm-account] the settings page subtree crashed while rendering:
 *   Error: cannot get property "remote.llm-account" without inject
 * ```
 *
 * 用户当时**没有重启**：浏览器已经重新拉了新版 `client.js`，而宿主侧的远程命名空间
 * 还是旧状态 —— 那个窗口正好让「读一个还不存在的命名空间」成为常态。
 *
 * ## 为什么可选链挡不住
 *
 * 旧写法 `remote?.[USAGE_NAMESPACE]` / `remoteOf(ctx)?.settings` 只挡 `remote` 为
 * `null`/`undefined`。宿主把 `ctx.remote` 实现成 cordis 服务代理，**读成员这个动作本身**
 * 会走 get 陷阱并 `throw`。可选链对 throw 无能为力。
 *
 * 这条用例用一个**读即抛**的假代理复现，要求调用方一律降级成 `undefined` 而不是崩。
 */
import { describe, expect, it } from "vitest";

import { usageNamespace } from "../../src/client/seams";

/**
 * 造一个「读任何成员都抛」的 `ctx.remote` 代理（与宿主未注入时的行为同形）。
 * @returns 会抛错的代理。
 */
function hostileRemote(): unknown {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`cannot get property "remote.${String(property)}" without inject`);
      },
    },
  );
}

/** 一个最小可用的客户端上下文（只有 `remote`）。 */
function contextWith(remote: unknown): { remote?: unknown } {
  return { remote };
}

describe("ctx.remote 代理抛错时一律降级（不得从渲染路径抛出）", () => {
  it("**读未注入的命名空间不抛**：usageNamespace 返回 undefined", () => {
    expect(() => usageNamespace(contextWith(hostileRemote()) as never)).not.toThrow();
    expect(usageNamespace(contextWith(hostileRemote()) as never)).toBeUndefined();
  });

  it("`remote` 本身缺失时也返回 undefined（老路径不变）", () => {
    expect(usageNamespace({} as never)).toBeUndefined();
    expect(usageNamespace(contextWith(undefined) as never)).toBeUndefined();
  });

  it("正常的命名空间仍然读得到（新防线不误伤 happy path）", () => {
    const namespace = { status: async () => undefined };
    expect(usageNamespace(contextWith({ "llm-account": namespace }) as never)).toBe(namespace);
  });
});
