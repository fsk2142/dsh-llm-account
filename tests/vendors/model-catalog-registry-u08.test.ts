import { beforeEach, describe, expect, it } from "vitest";

import {
  delegateStream,
  modelCandidates,
  registerCatalogSource,
  resetCatalogSources,
  type CatalogSource,
} from "../../src/vendors/model-catalog-registry";

/**
 * 禁用厂商不能被跨网关自动调用（2026-11-04 外部审查 U08）。
 *
 * ## 审查原文
 *
 * > `enabled:false` 时宿主 route 注册 0 次，但候选仍有该厂商，`delegateStream`
 * > 仍实际发出一次假推理请求。
 *
 * ## 为什么
 *
 * `enabled: false` 只撤下**宿主路由**（`registration`），而 `registerCatalogSource`
 * 登记的 `stream` 一直在注册表里。所以「所有账号都被拒绝 → 换模型」这条路径
 * 照样能把请求转给一家用户明确关掉的厂商。
 *
 * ## 两道防线
 *
 * 1. 候选清单不收录禁用厂商（`modelCandidates`）；
 * 2. 委托**执行前**再复核一次（`delegateStream`）—— 候选有 60 秒缓存，
 *    用户在这段时间里禁用，光靠第 1 条拦不住。
 */
const PROVIDER = "dsh-opencode-go";

/** 造一个可切换启用状态的登记项，并记录 stream 是否被调用。 */
function sourceOf(state: { enabled: boolean; streamCalls: number }): CatalogSource {
  return {
    provider: PROVIDER,
    models: async () => [{ id: "m1" }, { id: "m2" }],
    stream: () => {
      state.streamCalls += 1;
      return (async function* () {
        yield { type: "text-delta", text: "ok" };
      })();
    },
    // **现读**，不是快照 —— 与生产实现同一形状。
    available: () => state.enabled,
  };
}

/** 把一次委托跑完（只为触发 stream 调用）。 */
async function drain(iterable: AsyncIterable<unknown> | undefined): Promise<void> {
  if (iterable === undefined) return;
  for await (const _chunk of iterable) {
    // 丢弃
  }
}

describe("U08 · 禁用厂商不能被跨网关调用", () => {
  beforeEach(() => {
    resetCatalogSources();
  });

  it("**启用时**：候选里有它，委托会真的发出请求（对照，确保没把功能改坏）", async () => {
    const state = { enabled: true, streamCalls: 0 };
    registerCatalogSource(sourceOf(state));

    const candidates = await modelCandidates();
    expect(candidates.map((candidate) => candidate.model)).toEqual(["m1", "m2"]);

    await drain(delegateStream({ provider: PROVIDER, model: "m1" }, {}));
    expect(state.streamCalls, "启用时委托必须正常工作").toBe(1);
  });

  it("**禁用时**：候选清单不收录这家", async () => {
    const state = { enabled: false, streamCalls: 0 };
    registerCatalogSource(sourceOf(state));

    const candidates = await modelCandidates();
    expect(candidates, "禁用厂商不该出现在候选里").toEqual([]);
  });

  it("**禁用时**：即使强行委托（模拟缓存里的旧候选）也不发请求", async () => {
    const state = { enabled: false, streamCalls: 0 };
    registerCatalogSource(sourceOf(state));

    // 直接构造一个候选绕过 `modelCandidates` —— 等价于「缓存里还留着旧候选」。
    const iterable = delegateStream({ provider: PROVIDER, model: "m1" }, {});
    expect(iterable, "执行前复核必须拦住").toBeUndefined();

    await drain(iterable);
    expect(state.streamCalls, "禁用后一次请求都不该发出").toBe(0);
  });

  it("**运行中禁用立刻生效**：同一个登记项，改状态后下一次委托就被拦住", async () => {
    const state = { enabled: true, streamCalls: 0 };
    registerCatalogSource(sourceOf(state));

    await drain(delegateStream({ provider: PROVIDER, model: "m1" }, {}));
    expect(state.streamCalls).toBe(1);

    // 用户在这期间关掉了厂商。
    state.enabled = false;

    await drain(delegateStream({ provider: PROVIDER, model: "m1" }, {}));
    expect(state.streamCalls, "禁用后不该再有新请求").toBe(1);
  });

  it("没登记 `available` 的源缺省视为可用（不能把既有厂商弄坏）", async () => {
    let called = 0;
    registerCatalogSource({
      provider: PROVIDER,
      models: async () => [{ id: "m1" }],
      stream: () => {
        called += 1;
        return (async function* () {
          yield { type: "text-delta", text: "ok" };
        })();
      },
      // 故意不写 available
    });

    await drain(delegateStream({ provider: PROVIDER, model: "m1" }, {}));
    expect(called, "没声明 available 的源必须照常可用").toBe(1);
    expect(await modelCandidates(), "候选也照常").toHaveLength(1);
  });
});

describe("U08 · 不能误伤正常路径", () => {
  beforeEach(() => {
    resetCatalogSources();
  });

  it("**同厂商内换模型不受 available 影响**（拦截只针对跨厂商委托）", async () => {
    /**
     * `available` 只在两个地方生效：
     * 1. `modelCandidates`（跨厂商候选池）；
     * 2. `delegateStream`（跨厂商委托入口）。
     *
     * 「同家换模型」走 adapter 自己的 `#fallbackModel`，provider 不变，
     * 既不查候选池也不走委托 —— 所以即便这家 available 为 false，
     * 同家换模型的行为也**完全不变**。
     *
     * 这条测试用「两个源」构造对照：禁用 A 之后，B 的候选与委托仍然正常。
     */
    const stateA = { enabled: false, streamCalls: 0 };
    const stateB = { enabled: true, streamCalls: 0 };
    registerCatalogSource({ ...sourceOf(stateA), provider: "dsh-opencode-go" });
    registerCatalogSource({ ...sourceOf(stateB), provider: "opendesign" });

    const candidates = await modelCandidates();
    expect(
      candidates.every((candidate) => candidate.provider === "opendesign"),
      "只剩启用的那家",
    ).toBe(true);
    expect(candidates.length, "启用的那家候选照常").toBe(2);

    // 委托到启用那家照常工作。
    await drain(delegateStream({ provider: "opendesign", model: "m1" }, {}));
    expect(stateB.streamCalls, "启用的那家必须仍能接收委托").toBe(1);
  });
});
