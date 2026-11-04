import { describe, expect, it } from "vitest";

import { createOpencodeAdapter } from "../../src/vendors/opencode/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";

/**
 * 环境变量里的凭据也必须让模型列表可用（2026-11-04 外部审查 U09）。
 *
 * ## 审查原文
 *
 * > 列表凭据门槛只读 stored，实际 stream 允许 environment；仅环境凭据有模型却选不了。
 *
 * ## 根因
 *
 * `stream` 解析密钥走 `resolveStored → resolveEnvironment` 两个来源，
 * 而 `#hasAnyAccount`（模型列表的前置门槛）只看 `resolveStored`。
 * 于是「密钥配在环境变量里」的用户：能正常聊天，但模型选择器是空的。
 *
 * ## 这份测试盯的是**两个来源的次序与判定一致**
 */
const PROVIDER = "dsh-opencode-go";

function adapterWith(deps: {
  stored?: (ref: string) => Promise<string | undefined>;
  environment?: (ref: string) => string | undefined;
}): ReturnType<typeof createOpencodeAdapter> {
  return createOpencodeAdapter({
    config: () => ({ apiBase: "https://opencode.ai/zen/go/v1", modelVisibility: { m1: true } }),
    rotation: new RotationEngine({ order: ["acc"], rules: [], pinned: null }),
    quota: { snapshot: async () => undefined } as never,
    accounts: {
      list: async () => [{ ref: "acc", label: "acc" }],
      add: async () => { throw new Error("not used"); },
      rename: async () => {},
      replaceKey: async () => {},
      remove: async () => {},
      select: async () => {},
    } as never,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
    ...(deps.stored === undefined ? {} : { resolveStored: deps.stored }),
    ...(deps.environment === undefined ? {} : { resolveEnvironment: deps.environment }),
  });
}

describe("U09 · 仅环境凭据时模型列表仍可用", () => {
  it("**stored 为空但 environment 有值 → 模型列表不为空**", async () => {
    const adapter = adapterWith({
      stored: async () => undefined,
      environment: () => "sk-from-env",
    });

    const models = await adapter.listModels(PROVIDER);
    expect(models.length, "环境凭据可用时必须列出模型").toBeGreaterThan(0);
  });

  it("**两个来源都没有 → 列表为空**（真的没凭据）", async () => {
    const adapter = adapterWith({
      stored: async () => undefined,
      environment: () => undefined,
    });

    expect(await adapter.listModels(PROVIDER)).toEqual([]);
  });

  it("stored 有值时照常（不受影响）", async () => {
    const adapter = adapterWith({
      stored: async () => "sk-stored",
      environment: () => undefined,
    });

    const models = await adapter.listModels(PROVIDER);
    expect(models.length).toBeGreaterThan(0);
  });

  it("**两个来源都没注入 → 按「无法判定」放过**（原有语义不能弄丢）", async () => {
    // 这正是既有测试夹具的形态：deps 里根本没有这两个函数。
    // 若实现改成「都没注入就判死」，所有不关心凭据的调用点都会被误伤。
    const adapter = adapterWith({});

    const models = await adapter.listModels(PROVIDER);
    expect(models.length, "无法判定时应当放过，不是判死").toBeGreaterThan(0);
  });
});
