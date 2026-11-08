/**
 * 跨厂商换模型的**执行层**（`delegateStream`）。
 *
 * 为什么需要这一层：宿主的 `GenerateOptions.provider` 由路由决定，一个 adapter 无法「以
 * 别家身份」发请求。所以换到别家同名模型时，只能由**目标那一家的 adapter** 自己发 ——
 * 注册表登记它的 `stream`，这里负责转过去。
 *
 * 这些用例钉住三条安全性质：
 * 1. 只转 `provider` / `model`，其余字段（消息、工具、signal）**原样透传**；
 * 2. 目标家没登记或没提供 `stream` → 返回 `undefined`（调用方按「换不了」处理，不硬切）；
 * 3. 官方直连**永不**被委托（纵深防御：挑候选时已排除，这里再挡一次）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetCatalogSources, delegateStream, registerCatalogSource, canDelegate } from "../../src/vendors/model-catalog-registry";

/** 造一个假的流（只关心它是不是被调用）。 */
function fakeStream(chunks: unknown[]) {
  return (options: unknown): AsyncIterable<unknown> => {
    return (async function* () {
      yield options;
      for (const chunk of chunks) yield chunk;
    })();
  };
}

afterEach(() => {
  resetCatalogSources();
});

describe("委托给另一家", () => {
  it("把 provider 与 model 换掉，其余字段原样透传", async () => {
    const seen: unknown[] = [];
    registerCatalogSource({
      provider: "opendesign",
      models: async () => ["deepseek-v4.1-flash"].map((id) => ({ id })),
      stream: ((options: unknown) => {
        seen.push(options);
        return (async function* () {
          yield { type: "text", text: "from opendesign" };
        })();
      }) as never,
    });

    const original = {
      provider: "commandcode",
      model: "deepseek/deepseek-v4.1-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [{ name: "read" }],
      signal: new AbortController().signal,
      temperature: 0.2,
    };
    const stream = delegateStream({ provider: "opendesign", model: "deepseek-v4.1-flash" }, original);
    expect(stream).toBeDefined();

    const chunks: unknown[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    expect(chunks).toEqual([{ type: "text", text: "from opendesign" }]);

    // 转过去的那份 options：provider/model 换了，其余一模一样。
    const forwarded = seen[0] as Record<string, unknown>;
    expect(forwarded.provider).toBe("opendesign");
    expect(forwarded.model).toBe("deepseek-v4.1-flash");
    expect(forwarded.messages).toBe(original.messages);
    expect(forwarded.tools).toBe(original.tools);
    expect(forwarded.signal).toBe(original.signal);
    expect(forwarded.temperature).toBe(0.2);
  });

  it("目标家没登记 → 不能委托（调用方按「换不了」处理）", () => {
    expect(delegateStream({ provider: "opendesign", model: "x" }, {})).toBeUndefined();
    expect(canDelegate("opendesign")).toBe(false);
  });

  it("登记了但没提供 stream → 不能委托", () => {
    registerCatalogSource({ provider: "opendesign", models: async () => ["x"].map((id) => ({ id })) });
    expect(canDelegate("opendesign")).toBe(false);
    expect(delegateStream({ provider: "opendesign", model: "x" }, {})).toBeUndefined();
  });

  it("官方直连**根本登记不进来**（2026-11-08 收紧：白名单在登记处就拦）", () => {
    const spy = vi.fn(fakeStream([]));
    registerCatalogSource({ provider: "deepseek", models: async () => ["deepseek-v4.1-flash"].map((id) => ({ id })), stream: spy as never });
    // 以前这里断言 `canDelegate("deepseek") === true` —— 即「登记成功、只在委托时挡」。
    // 现在登记处就是闸门（白名单），所以它**压根没进表**，自然也不能被委托。
    // 两道判据（登记 + 委托）都留着：登记处挡的是「别的插件把 stream 塞进我们的表」，
    // 委托处挡的是「表里万一已经有脏数据」。
    expect(canDelegate("deepseek")).toBe(false);
    expect(delegateStream({ provider: "deepseek", model: "deepseek-v4.1-flash" }, {})).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("**三家之外的任何 provider 都登记不进来**（需求：只准三个网关互切）", () => {
    // 这条才是需求本身：这台机器同时装着 pi-ai / anthropic 等别的 LLM 插件，
    // 黑名单只挡得住已知名字，白名单才保证「绝对不出这三个」。
    for (const provider of ["pi-ai", "anthropic", "some-other-gateway", "deepseek-account"]) {
      const spy = vi.fn(fakeStream([]));
      registerCatalogSource({ provider, models: async () => [{ id: "x" }], stream: spy as never });
      expect(delegateStream({ provider, model: "x" }, {}), `${provider} 不该被委托`).toBeUndefined();
      expect(spy, `${provider} 的 stream 不该被调用`).not.toHaveBeenCalled();
    }
  });

  it("没有 stream 的家不参与委托，别家照旧可用", () => {
    registerCatalogSource({ provider: "opendesign", models: async () => ["x"].map((id) => ({ id })) });
    registerCatalogSource({ provider: "dsh-opencode-go", models: async () => ["x"].map((id) => ({ id })), stream: fakeStream([]) as never });
    expect(canDelegate("opendesign")).toBe(false);
    expect(canDelegate("dsh-opencode-go")).toBe(true);
  });
});
