/**
 * Open Design 的目录解析与推理档位（`./catalog` + `./efforts`）。
 *
 * 两个用户可见的报障落在这两个纯函数上：
 * 1. 模型列表里的显示名要统一成官方名（目录只回 id，不回 name）；
 * 2. 思考强度要能选（目录**从不**公布档位，宿主的档位选择器完全由声明驱动）。
 */
import { describe, expect, it } from "vitest";

import { parseCatalog } from "../../src/vendors/opendesign/catalog";
import { effortsFor, familyEfforts } from "../../src/vendors/opendesign/efforts";

describe("parseCatalog：显示名", () => {
  it("负载没有 name 时用官方名规则（不再把原始 slug 当展示名）", () => {
    const parsed = parseCatalog({
      object: "list",
      data: [{ id: "claude-sonnet-4-5-20250929" }, { id: "gpt-5.1-codex" }],
    });
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["Claude-Sonnet-4.5", "GPT-5.1-Codex"]);
    // id 保持原样：请求永远用 id，展示用 name。
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["claude-sonnet-4-5-20250929", "gpt-5.1-codex"]);
  });

  it("负载给了 name 就信它；只是把 id 回显一遍时仍然规范化", () => {
    const parsed = parseCatalog({
      data: [
        { id: "claude-opus-4-1", name: "Claude Opus 4.1 (gw)" },
        { id: "claude-haiku-4-5", name: "claude-haiku-4-5" },
      ],
    });
    expect(parsed.entries[0]!.name).toBe("Claude Opus 4.1 (gw)");
    expect(parsed.entries[1]!.name).toBe("Claude-Haiku-4.5");
  });

  it("id 仍只认非空字符串（坏行计数、不丢整份目录）", () => {
    const parsed = parseCatalog({ data: [{ id: "" }, "nope", { id: "gemini-2.5-pro" }] });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.ignored).toBe(2);
  });
});

describe("effortsFor：思考强度", () => {
  it("目录声明优先（厂商自己公布时以它为准）", () => {
    expect(effortsFor("claude-sonnet-4-5", ["low", "max"])).toEqual(["low", "max"]);
  });

  it("目录没声明时按模型族兜底（这是选择器能出现的唯一来源）", () => {
    expect(effortsFor("claude-sonnet-4-5-20250929")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("anthropic/claude-opus-4-1")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("gpt-5.1")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("gpt-6-astra")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("gemini-2.5-pro")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("grok-4.5")).toEqual(["low", "medium", "high"]);
  });

  it("更粗的族只给两档（这几家的网关通常不认 medium）", () => {
    expect(effortsFor("deepseek-v4-pro")).toEqual(["low", "high"]);
    expect(effortsFor("glm-5")).toEqual(["low", "high"]);
    expect(effortsFor("kimi-k3")).toEqual(["low", "high"]);
    expect(effortsFor("qwen3-max")).toEqual(["low", "high"]);
  });

  it("认不出的模型**不声明**档位（猜一组只会换来 400）", () => {
    expect(familyEfforts("some-random-model")).toEqual([]);
    expect(effortsFor("some-random-model")).toEqual([]);
    expect(effortsFor("some-random-model", [])).toEqual([]);
  });
});
