import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";

/**
 * 目录加载不能被执行慢的 models.dev 拖死（2026-11-04 报障）。
 *
 * ## 现象
 *
 * > 切模型时候反应好半天
 *
 * ## 实测
 *
 * | 请求 | 延迟 |
 * | --- | --- |
 * | 网关 `/models`（5 KB） | 约 **700 ms**（稳定） |
 * | `models.dev/api.json`（5.7 MB） | **2.8 s / 18.5 s 失败 / 197 s** —— 极不稳定 |
 *
 * 而原来的 `load()` 是**串行**的：`await listing(); await metadata();`。
 * 元数据只是「建议性」的（拿不到就用清单事实，代码注释自己也这么写），
 * 却把关键路径堵在最坏三分钟上 —— 这就是切模型卡住的原因。
 *
 * ## 现在的约定
 *
 * 1. 两个请求**并行**发出（总耗时 ≈ max 而不是 sum）；
 * 2. 元数据有**独立预算**：超时就用清单事实继续，不阻塞目录；
 * 3. 清单本身失败仍然整次失败（没有清单就没有目录）。
 */
const MODELS_ONLY = {
  object: "list",
  data: [
    {
      id: "deepseek-v4.1-flash",
      capabilities: { reasoning: { supported: true, effort: ["low", "high", "max"] } },
      // 网关的字段名是 `limit.context`（parseModels 读它）。
      limit: { context: 128_000 },
    },
  ],
};

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * 模拟 models.dev 卡死：**响应 AbortSignal**（真实 `fetch` 就是这么做的 ——
 * signal 一触发就 reject）。桩不响应 signal 的话，生产代码的超时逻辑没有被测到。
 * @param init - fetch 的 init（带 `signal`）。
 * @returns 永不 resolve 的 Promise，除非 signal 中止。
 */
function hanging(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal ?? undefined;
    if (signal === undefined) return;
    if (signal.aborted) {
      reject(new Error("aborted by signal"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true });
  });
}

describe("目录加载：元数据慢不能拖住切模型", () => {
  it("**元数据卡死时目录仍能返回**（用清单事实），且远早于元数据预算", async () => {
    let modelsCalls = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      const href = String(url);
      if (href.includes("models.dev")) return hanging(init);
      modelsCalls += 1;
      return new Response(JSON.stringify(MODELS_ONLY), { status: 200 });
    };
    const catalog = createOpencodeCatalog({
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      // 元数据预算给得很小（测试用 30ms），目录必须在这个量级返回。
      metadataBudgetMs: 30,
    });

    const started = Date.now();
    const records = await catalog.list();
    const elapsed = Date.now() - started;

    expect(modelsCalls, "清单请求必须发出").toBe(1);
    expect(records.map((record) => record.entry.id)).toEqual(["deepseek-v4.1-flash"]);
    // 用清单自带的档位兜底 —— 不是空目录。
    expect(records[0]!.efforts).toEqual(["low", "high", "max"]);
    expect(elapsed, `实测 ${elapsed}ms，元数据不该拖住目录`).toBeLessThan(2_000);
  });

  it("两个请求**并行**发出（总耗时接近 max 而不是 sum）", async () => {
    const order: string[] = [];
    const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const fetchImpl: FetchLike = async (url) => {
      const href = String(url);
      if (href.includes("models.dev")) {
        order.push("metadata-start");
        await delay(120);
        return new Response(JSON.stringify({ "opencode-go": { models: {} } }), { status: 200 });
      }
      order.push("models-start");
      await delay(120);
      return new Response(JSON.stringify(MODELS_ONLY), { status: 200 });
    };
    const catalog = createOpencodeCatalog({
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      metadataBudgetMs: 5_000,
    });

    const started = Date.now();
    await catalog.list();
    const elapsed = Date.now() - started;

    expect(order, "两个请求都要发出").toHaveLength(2);
    // 串行会是 ~240ms；并行约 120ms。留足余量避免机器抖动。
    expect(elapsed, `实测 ${elapsed}ms，串行应当 ≥240ms`).toBeLessThan(220);
  });

  it("清单请求失败 → 整次失败（没有清单就没有目录，不能编）", async () => {
    const fetchImpl: FetchLike = async (url) => {
      const href = String(url);
      if (href.includes("models.dev")) return new Response("{}", { status: 200 });
      return new Response("boom", { status: 500 });
    };
    const catalog = createOpencodeCatalog({
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      metadataBudgetMs: 5_000,
    });

    await expect(catalog.list()).rejects.toBeInstanceOf(Error);
  });

  it("缓存命中时两个请求都不再发（TTL 内不重复打网络）", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (url) => {
      calls += 1;
      const href = String(url);
      if (href.includes("models.dev")) return new Response(JSON.stringify({ "opencode-go": { models: {} } }), { status: 200 });
      return new Response(JSON.stringify(MODELS_ONLY), { status: 200 });
    };
    const catalog = createOpencodeCatalog({
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      metadataBudgetMs: 5_000,
    });

    await catalog.list();
    const afterFirst = calls;
    await catalog.list();
    expect(calls, "TTL 内第二次不该再发请求").toBe(afterFirst);
  });
});

/**
 * **默认预算**必须足够短（不传 `metadataBudgetMs` 时）。
 *
 * 这条专门盯那个常量：上面几条测试都显式传了预算，所以 `METADATA_BUDGET_MS`
 * 改成 30 秒也不会红 —— 那就等于默认路径没人守。实测 models.dev 最坏 197 秒，
 * 默认预算若回到 30 秒，用户切模型仍会卡半分钟。
 */
describe("默认元数据预算", () => {
  it("元数据卡死时，目录在默认预算内返回（< 6s，而不是 30s）", async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      const href = String(url);
      if (href.includes("models.dev")) return hanging(init);
      return new Response(JSON.stringify(MODELS_ONLY), { status: 200 });
    };
    // 注意：**不传** metadataBudgetMs，走默认常量。
    const catalog = createOpencodeCatalog({
      baseUrl: "https://opencode.ai/zen/go/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
    });

    const started = Date.now();
    const records = await catalog.list();
    const elapsed = Date.now() - started;

    expect(records).toHaveLength(1);
    expect(elapsed, `默认预算实测 ${elapsed}ms —— 超过 6s 说明常量被调大了`).toBeLessThan(6_000);
  });
});
