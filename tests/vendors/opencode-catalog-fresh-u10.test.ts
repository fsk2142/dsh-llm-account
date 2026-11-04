import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";

/**
 * 主动刷新必须真的重读（2026-11-04 外部审查 U10）。
 *
 * ## 审查原文
 *
 * > `catalogModels(true)` 没有接 fresh，5 分钟 TTL 内 HTTP 只发一次，
 * > 服务已变列表仍旧。
 *
 * ## 后果
 *
 * 设置页的「刷新」按钮调用 `catalogModels(true)`，实现却忽略这个参数 ——
 * 用户在 TTL 内点刷新，看到的是同一份旧列表，界面表现就是**「点了没反应」**。
 */
const BASE = "https://opencode.ai/zen/go/v1";

/** 假网关：每次调用递增返回的模型 id，便于区分「重读」还是「命中缓存」。 */
function scriptedFetch(): { fetchImpl: typeof fetch; calls: () => number } {
  let n = 0;
  const fetchImpl = (async () => {
    n += 1;
    return new Response(
      JSON.stringify({ data: [{ id: `m${n}`, name: `Model ${n}` }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => n };
}

describe("U10 · catalogModels(fresh) 必须绕过 TTL", () => {
  it("**fresh=true 时重新请求**（TTL 内也重读）", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: 5 * 60_000 });

    const first = await catalog.list(undefined, false);
    const afterFirst = calls();
    expect(afterFirst, "第一次要发请求").toBeGreaterThan(0);
    expect(first[0]?.entry.id, "第一份目录").toBeTruthy();

    // TTL 内：普通读取走缓存，不再发请求。
    const cachedRead = await catalog.list(undefined, false);
    expect(calls(), "TTL 内普通读取不该再发请求").toBe(afterFirst);
    expect(cachedRead[0]?.entry.id, "缓存内容不变").toBe(first[0]?.entry.id);

    // 点刷新：必须真的重读。
    const refreshed = await catalog.list(undefined, true);
    expect(calls(), "**fresh 必须重新发请求**").toBeGreaterThan(afterFirst);
    expect(refreshed[0]?.entry.id, "刷新后要看到新模型").not.toBe("m1");
  });

  it("刷新后普通读取命中的是**新**缓存（不是旧那份）", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: 5 * 60_000 });

    await catalog.list(undefined, false); // 第一次
    await catalog.list(undefined, true); // 刷新
    const afterRefreshCalls = calls();
    const afterRefresh = await catalog.list(undefined, false);

    expect(calls(), "刷新后的普通读取应命中缓存").toBe(afterRefreshCalls);
    expect(afterRefresh[0]?.entry.id, "缓存必须被刷新结果替换").not.toBe("m1");
  });

  it("不传 fresh 时保持原行为（TTL 内复用）", async () => {
    const { fetchImpl, calls } = scriptedFetch();
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: 5 * 60_000 });

    await catalog.list();
    const afterFirst = calls();
    await catalog.list();
    await catalog.list();
    expect(calls(), "后续普通读取不该再发请求").toBe(afterFirst);
  });
});
