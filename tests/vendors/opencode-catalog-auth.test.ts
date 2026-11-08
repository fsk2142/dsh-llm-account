/**
 * ## 目录请求带上凭据（2026-11-08）
 *
 * 用户确认「我觉得可以带上」。这条需求背后是一个一直没说破的错位：
 *
 * | 请求方式 | 返回的模型 | 实际能用 |
 * | --- | --- | --- |
 * | 不带 Bearer（旧行为） | **30 个**（含未订阅的） | 6 个 |
 * | 带 Bearer | **6 个** | 6 个 |
 *
 * 于是设置页的勾选列表里长期躺着一批「选中也发不出去」的模型，用户以为能切过去。
 *
 * ## 为什么不是「顺手调 resolveAccountAuth」
 *
 * 第一版就是这么写的，跑测试立刻炸：`resolveAccountAuth` 会走 OAuth 刷新并**回写凭据槽**，
 * 于是「读一次模型目录」产生了一次凭据写入。用户看到的是「凭据被改了」，而实际只是
 * 翻了下列表 —— 这条链路上任何副作用都是不可接受的。现在只读当前已存值，不刷新、不回写。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";
import { catalogRequest } from "../../src/vendors/opencode/protocol";

const BASE = "https://opencode.ai/zen/go/v1";

describe("目录请求的凭据", () => {
  it("**带上 Bearer**（旧行为是完全不带）", () => {
    const headers = catalogRequest(BASE, "sk-test-123").headers;
    expect(headers["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("没有密钥时**不带那个头**（不是发一个空 Bearer）", () => {
    expect(catalogRequest(BASE).headers["Authorization"], "缺省不该出现这个头").toBeUndefined();
    expect(catalogRequest(BASE, "").headers["Authorization"], "空串也不该发出").toBeUndefined();
  });

  it("会话头与 attribution 头照旧（别把既有要求挤掉）", () => {
    const headers = catalogRequest(BASE, "k").headers;
    expect(Object.keys(headers).some((name) => name.toLowerCase() === "x-opencode-session")).toBe(true);
    expect(headers.accept).toBe("application/json");
  });

  it("**`resolveKey` 每次都现取**（换号后目录跟着走新身份，不是创建时的快照）", async () => {
    const seen: (string | undefined)[] = [];
    let current = "key-1";
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith("/models")) {
        seen.push(new Headers(init?.headers).get("authorization") ?? undefined);
        return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const catalog = createOpencodeCatalog({ baseUrl: BASE, fetchImpl, ttlMs: 0, resolveKey: () => current });
    await catalog.list(undefined, true);
    current = "key-2";
    await catalog.list(undefined, true);
    expect(seen).toEqual(["Bearer key-1", "Bearer key-2"]);
  });

  it("`resolveKey` 抛错时**退回无鉴权**，不让整个厂商的模型列表消失", async () => {
    let sent: string | null = "unset";
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith("/models")) {
        sent = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const catalog = createOpencodeCatalog({
      baseUrl: BASE,
      fetchImpl,
      ttlMs: 0,
      resolveKey: () => {
        throw new Error("凭据库读失败");
      },
    });
    const rows = await catalog.list(undefined, true);
    expect(rows).toHaveLength(1);
    expect(sent, "取不到密钥就不该发 Authorization").toBeNull();
  });
});
