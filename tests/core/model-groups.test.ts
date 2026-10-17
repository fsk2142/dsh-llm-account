/**
 * 模型分组：公司归属、免费模型、分组顺序。
 */
import { expect, it } from "vitest";

import { companyKeyOf, companyLabelOf, groupModels, isFreeModel } from "../../src/core/model-groups";

it("公司键：优先 canonical，缺失时按 id 前缀兜底，认不出来是 other", () => {
  expect(companyKeyOf("claude-haiku-5-5")).toBe("anthropic");
  expect(companyKeyOf("gpt-6-luna")).toBe("openai");
  expect(companyKeyOf("o3-mini")).toBe("openai");
  expect(companyKeyOf("gemini-4-argon")).toBe("google");
  expect(companyKeyOf("grok-4.7")).toBe("xai");
  expect(companyKeyOf("deepseek-v4.1-flash")).toBe("deepseek");
  expect(companyKeyOf("glm-5.3")).toBe("zhipuai");
  expect(companyKeyOf("qwen3.8-max")).toBe("alibaba");
  expect(companyKeyOf("kimi-k3")).toBe("moonshotai");
  expect(companyKeyOf("minimax-m3")).toBe("minimax");
  expect(companyKeyOf("mimo-v2.6-pro")).toBe("xiaomi");
  expect(companyKeyOf("hy3")).toBe("tencent");
  expect(companyKeyOf("longcat-2.0")).toBe("meituan");
  expect(companyKeyOf("step-5-preview")).toBe("stepfun");
  // canonical 优先于前缀猜测。
  expect(companyKeyOf("mystery-model", "meta")).toBe("meta");
  expect(companyKeyOf("space-bunny")).toBe("other");
});

it("公司展示名：已知品牌用规范名，未知键原样返回", () => {
  expect(companyLabelOf("anthropic")).toBe("Anthropic");
  expect(companyLabelOf("zhipuai")).toBe("Zhipu AI");
  expect(companyLabelOf("other")).toBe("其他");
  expect(companyLabelOf("some-new-lab")).toBe("some-new-lab");
});

it("免费判定：目录标记优先，id 里的 free 段兜底", () => {
  expect(isFreeModel("beam-free", true)).toBe(true);
  expect(isFreeModel("longcat-2.5-preview-free")).toBe(true);
  expect(isFreeModel("step-5-preview-free")).toBe(true);
  expect(isFreeModel("cat-jam-free")).toBe(true);
  expect(isFreeModel("freeform-model")).toBe(false);
  expect(isFreeModel("claude-haiku-5-5")).toBe(false);
});

it("分组：免费组第一，公司按首次出现顺序，other 最后，组内保持输入顺序", () => {
  const groups = groupModels([
    { id: "deepseek-v4.1-flash" },
    { id: "claude-haiku-5-5" },
    { id: "beam-free", free: true },
    { id: "space-bunny" },
    { id: "glm-5.3" },
    { id: "gpt-6-luna" },
    { id: "step-5-preview-free" },
  ]);
  expect(groups.map((group) => group.key)).toEqual(["free", "deepseek", "anthropic", "zhipuai", "openai", "other"]);
  expect(groups[0]?.models).toEqual(["beam-free", "step-5-preview-free"]);
  expect(groups[1]?.models).toEqual(["deepseek-v4.1-flash"]);
  expect(groups[4]?.models).toEqual(["gpt-6-luna"]);
  expect(groups[5]?.models).toEqual(["space-bunny"]);
});

it("分组：空输入与全免费输入", () => {
  expect(groupModels([])).toEqual([]);
  expect(groupModels([{ id: "a-free" }, { id: "b-free" }])).toEqual([{ key: "free", models: ["a-free", "b-free"] }]);
});
