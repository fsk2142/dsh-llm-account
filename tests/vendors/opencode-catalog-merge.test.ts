/**
 * opencode 目录的**合并**步骤也要用统一展示名（2026-10-20）。
 *
 * `parseModels` 只在清单那一层派生了名字，而 `createOpencodeCatalog` 的 `load()` 又用
 * models.dev 元数据里的 `name` 盖了回去 —— 于是清单层刚刚统一好的名字在合并后被换掉：
 * Command Code 的同一模型写 `DeepSeek-V4.1-Flash`，opencode 写 `DeepSeek V4.1 Flash`，
 * 用户在宿主的模型选择器里看到的就是两个不同的东西。
 *
 * 元数据仍然提供**上下文窗口、输出上限、档位、模态、协议**（这些只有它知道）；只有 `name`
 * 不再覆盖展示名。
 */
import { describe, expect, it } from "vitest";

import { createOpencodeCatalog } from "../../src/vendors/opencode/catalog";

const LISTING_URL = "https://opencode.ai/zen/go/v1/models";
const METADATA_URL = "https://models.dev/api.json";

/** 造一份假 fetch：清单与元数据各给一份固定负载。 */
function catalogWith(listing: unknown, metadata: unknown) {
  const fetchImpl = (async (input: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as { url: string }).url);
    if (url === LISTING_URL) return new Response(JSON.stringify(listing), { status: 200 });
    if (url === METADATA_URL) return new Response(JSON.stringify(metadata), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return createOpencodeCatalog({ baseUrl: "https://opencode.ai/zen/go/v1", fetchImpl });
}

/** 一份 models.dev 形状的元数据：provider 键是 `opencode-go`。 */
function metadataWith(id: string, name: string, contextWindow: number) {
  return {
    "opencode-go": {
      npm: "@ai-sdk/openai-compatible",
      models: {
        [id]: {
          name,
          limit: { context: contextWindow, output: 8192 },
          modalities: { input: ["text"] },
        },
      },
    },
  };
}

describe("合并 models.dev 元数据时，展示名仍然是统一规则那一份", () => {
  it("元数据的 name 不覆盖展示名（三家同一模型必须同名）", async () => {
    const catalog = catalogWith(
      { object: "list", data: [{ id: "deepseek-v4.1-flash" }] },
      // 线上 models.dev 给的就是这个写法（空格分隔），与另两家不一致。
      metadataWith("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", 1_000_000),
    );
    const records = await catalog.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.entry.name).toBe("DeepSeek-V4.1-Flash");
  });

  it("元数据仍然提供能力事实（名字不覆盖，别的照样拿）", async () => {
    const catalog = catalogWith(
      { object: "list", data: [{ id: "gpt-5.6-luna" }] },
      metadataWith("gpt-5.6-luna", "GPT-5.6 Luna", 1_050_000),
    );
    const [record] = await catalog.list();
    expect(record!.entry.contextWindow).toBe(1_050_000);
    expect(record!.entry.maxTokens).toBe(8192);
    expect(record!.entry.name).toBe("GPT-5.6-Luna");
  });

  it("元数据缺失时名字照旧可用（清单层就已经派生好了）", async () => {
    const catalog = catalogWith({ object: "list", data: [{ id: "minimax-m3" }] }, {});
    const [record] = await catalog.list();
    expect(record!.entry.name).toBe("MiniMax-M3");
  });
});
