/**
 * 模型 id → 官方展示名（`src/core/model-names.ts`）。
 *
 * 这层存在的理由：有的网关（Open Design 的 `/v1/models`）只回 id、不回 name。界面直接印
 * `claude-sonnet-4-5-20250929` 会让同一张列表里「Command Code 是 Claude Sonnet 4.5、
 * Open Design 是原始 slug」——需求统一成官方名。
 */
import { describe, expect, it } from "vitest";

import { officialModelName } from "../../src/core/model-names";

describe("officialModelName", () => {
  it("Claude 系：版本号连成点、日期快照后缀去掉", () => {
    expect(officialModelName("claude-sonnet-4-5-20250929")).toBe("Claude-Sonnet-4.5");
    expect(officialModelName("claude-opus-4-1")).toBe("Claude-Opus-4.1");
    expect(officialModelName("claude-haiku-4-5-2025-09-29")).toBe("Claude-Haiku-4.5");
    expect(officialModelName("claude-fable-5")).toBe("Claude-Fable-5");
  });

  it("GPT / GLM：品牌缩写与版本号之间用连字符", () => {
    expect(officialModelName("gpt-5.1-codex")).toBe("GPT-5.1-Codex");
    expect(officialModelName("gpt5.1")).toBe("GPT-5.1");
    expect(officialModelName("gpt-5")).toBe("GPT-5");
    expect(officialModelName("glm-5")).toBe("GLM-5");
    expect(officialModelName("glm5.3-flash")).toBe("GLM-5.3-Flash");
  });

  it("其它家：版本号保留、词按官方写法大写", () => {
    expect(officialModelName("gemini-2.5-pro")).toBe("Gemini-2.5-Pro");
    expect(officialModelName("deepseek-chat")).toBe("DeepSeek-Chat");
    expect(officialModelName("deepseek-v4-pro")).toBe("DeepSeek-V4-Pro");
    expect(officialModelName("qwen3-max")).toBe("Qwen3-Max");
    expect(officialModelName("grok-4.5")).toBe("Grok-4.5");
    expect(officialModelName("kimi-k3")).toBe("Kimi-K3");
  });

  it("公司前缀只取最后一段（公司另有分组标签，名字里不重复）", () => {
    expect(officialModelName("anthropic/claude-sonnet-4-5")).toBe("Claude-Sonnet-4.5");
    expect(officialModelName("openai/gpt-5.1")).toBe("GPT-5.1");
  });

  it("认不出的 id 也至少是可读的词（不抛、不返回空）", () => {
    expect(officialModelName("some-unknown-model-2")).toBe("Some-Unknown-Model-2");
    expect(officialModelName("internal_thing")).toBe("Internal-Thing");
    expect(officialModelName("")).toBe("");
  });
});
