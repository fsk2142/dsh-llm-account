/**
 * 刷新必须**绕过目录缓存**（用户 2026-10-19 报障「opendesign 的账号刷新不起作用」，
 * commandcode 正常）。
 *
 * 根因：`catalogModels()` 走 `#catalog` 的 60 秒 TTL 缓存。TTL 内点刷新拿到的是缓存，
 * 一次请求都不发 —— 界面上就是「点了没反应」。
 *
 * 修法：`catalogModels(fresh)` 透传给 `#catalog`，远程 `models()` 传 `true`。
 */
import { describe, expect, it } from "vitest";

import { createOpenDesignAdapter } from "../../src/vendors/opendesign/adapter";
import { createCommandCodeAdapter } from "../../src/vendors/commandcode/adapter";

/** 造一个 opendesign adapter（只关心目录路径）。 */
function openDesignAdapter(calls: string[]) {
  const fetchImpl = (async (input: unknown) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({ object: "list", data: [{ id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return createOpenDesignAdapter({
    config: () => ({ apiBase: "https://amr-link.open-design.ai/v1" }),
    rotation: { current: () => ({}) } as never,
    quota: {} as never,
    accounts: { list: async () => [{ ref: "od-1", label: "OD", configured: true, active: true }] } as never,
    fetchImpl,
    resolveStored: async () => "sk-test-1",
  } as never);
}

/** 造一个 commandcode adapter（只关心目录路径）。 */
function commandCodeAdapter(calls: string[]) {
  const fetchImpl = (async (input: unknown) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ models: [{ id: "m1", name: "M1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return createCommandCodeAdapter({
    config: () => ({ apiBase: "https://api.commandcode.ai" }),
    rotation: { current: () => ({}) } as never,
    quota: {} as never,
    accounts: { list: async () => [{ ref: "cc-1", label: "CC", configured: true, active: true }] } as never,
    fetchImpl,
    resolveStored: async () => "sk-test-1",
  } as never);
}

describe("catalogModels 的 fresh 参数", () => {
  it("opendesign：默认走缓存，fresh 绕过去", async () => {
    const calls: string[] = [];
    const adapter = openDesignAdapter(calls);

    await adapter.catalogModels();
    expect(calls.length).toBe(1);
    // 默认（模型选择器的常规读）：TTL 内命中缓存，不再打网络。
    await adapter.catalogModels();
    expect(calls.length).toBe(1);
    // fresh（刷新按钮）：必须真的重读。
    await adapter.catalogModels(true);
    expect(calls.length).toBe(2);
  });

  it("commandcode：同样支持 fresh", async () => {
    const calls: string[] = [];
    const adapter = commandCodeAdapter(calls);

    await adapter.catalogModels();
    await adapter.catalogModels();
    expect(calls.length).toBe(1);
    await adapter.catalogModels(true);
    expect(calls.length).toBe(2);
  });
});
