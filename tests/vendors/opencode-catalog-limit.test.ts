/**
 * ## 网关 `/models` 自己给的容量必须被采信（2026-11-08 修「opencode 不显示上下文」）
 *
 * 用户看到的现象：**模型上下文窗口不显示了**。
 *
 * 根因不在最近几次改动（那些只碰了 `model-quota-table` 与 opendesign），而是
 * `parseModels` 从**第一版**起就只认 `context_length` / `contextWindow` 这两个字段名 ——
 * 那是别家网关的写法。而这条网关的行里用的是 `limit: { context, output }`：
 *
 * ```json
 * {"id":"deepseek-v4.1-flash","limit":{"context":1000000,"output":384000}, ...}
 * ```
 *
 * 于是网关亲口给的 100 万上下文被整行丢掉，`contextWindow` 只剩下 models.dev
 * 那一路来源。而 models.dev 是**第三方站点**、预算只有 4 秒，模块注释里就记着
 * 实测「2.8s / 18.5s 失败 / 197s」—— 它一超时，上下文就不显示。
 *
 * 这与 2026-11-03 那次「档位只从 models.dev 来」是同一种错误：把一个**建议性**的
 * 第三方数据当成唯一来源，而无视必需请求里已经写着的事实。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeCatalog, parseModels } from "../../src/vendors/opencode/catalog";

/** 真实的 `deepseek-v4.1-flash` 行（2026-11-08 抓自网关）。 */
const REAL_ROW = {
  id: "deepseek-v4.1-flash",
  name: "DeepSeek V4.1 Flash",
  modalities: { input: ["text", "image/jpeg", "image/png", "image/gif", "image/webp"], output: ["text"] },
  capabilities: { reasoning: { supported: true, effort: ["low", "high", "max"] } },
  limit: { context: 1_000_000, output: 384_000 },
};

describe("opencode 清单解析：网关自己给的容量", () => {
  it("**`limit.context` / `limit.output` 被读出来**（这是用户报的那一项）", () => {
    const entry = parseModels({ data: [REAL_ROW] }).entries[0];
    expect(entry?.contextWindow, "网关明写 100 万，不该显示为空").toBe(1_000_000);
    expect(entry?.maxTokens).toBe(384_000);
  });

  it("网关的 MIME 写法 `image/jpeg` 也算图片输入（原来只认全等 `image`）", () => {
    // 以前 `declared.includes("image")` 对 `["text","image/jpeg"]` 为 false，
    // 于是**网关明确声明支持图片**的模型被记成「只支持文本」，图片附件直接被拒。
    const entry = parseModels({ data: [REAL_ROW] }).entries[0];
    expect(entry?.inputModalities).toEqual(["text", "image"]);
  });

  it("原来的字段名仍然优先（别家网关用 `context_length`）", () => {
    // 不破坏既有形状：显式字段赢过 `limit.*`。
    const entry = parseModels({
      data: [{ id: "m", context_length: 200_000, max_output_tokens: 8_000, limit: { context: 1_000_000, output: 384_000 } }],
    }).entries[0];
    expect(entry?.contextWindow).toBe(200_000);
    expect(entry?.maxTokens).toBe(8_000);
  });

  it("**两个来源都没有时不编**（缺失就是缺失，不补 0）", () => {
    const entry = parseModels({ data: [{ id: "m" }] }).entries[0];
    expect(entry?.contextWindow).toBeUndefined();
    expect(entry?.maxTokens).toBeUndefined();
    expect(entry === undefined ? false : "contextWindow" in entry, "未公布时连字段都不该出现").toBe(false);
  });

  it("**models.dev 拿不到时上下文仍然显示**（这才是用户遇到的场景）", async () => {
    // 用一份只给清单、元数据 404 的 fetch 跑完整目录装配。
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [REAL_ROW] }), { status: 200 });
      return new Response("{}", { status: 404 }); // models.dev 挂了
    }) as typeof fetch;
    const catalog = createOpencodeCatalog({ baseUrl: "https://opencode.ai/zen/go/v1", fetchImpl });
    const rows = await catalog.list(undefined, false);
    expect(rows[0]?.entry.contextWindow, "元数据挂了也必须用网关公布的值").toBe(1_000_000);
  });
});
