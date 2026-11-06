/**
 * Open Design 的目录解析与推理档位（`./catalog` + `./efforts`）。
 *
 * 两个用户可见的报障落在这两个纯函数上：
 * 1. 模型列表里的显示名要统一成官方名（目录只回 id，不回 name）；
 * 2. 思考强度要能选（目录**从不**公布档位，宿主的档位选择器完全由声明驱动）。
 */
import { describe, expect, it } from "vitest";

import { parseCatalog } from "../../src/vendors/opendesign/catalog";
import {
  MEASURED_EFFORTS,
  allowedEffortsIn,
  effortsFor,
  familyEfforts,
  nearestAllowedEffort,
} from "../../src/vendors/opendesign/efforts";

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

describe("容量：opendesign 把 context 放在 metadata 里（2026-10-20 实测）", () => {
  it("**优先取 metadata.context_budget**（网关每次请求的真实额度），退回 context_limit", () => {
    // 线上目录的真实形状（`/v1/models` 实测）：顶层只有 id/object/created/owned_by/
    // architecture/metadata/default/enabled，**没有** context_length / max_output_tokens。
    // 只认顶层的旧实现把 12 个模型全读成「未公布」，连带两个后果：
    //   ① 宿主不显示会话长度；
    //   ② 宿主的自动压缩插件拿到 info.context === undefined 后直接抛错，该路由**完全不压缩**，
    //      最终以 HTTP 400（上下文超限）收场。
    //
    // 2026-11-06：容量改取 `context_budget`。取 `context_limit`（~100 万）时宿主的压缩阈值
    // 是 838k token，而 1000 条消息只有约 49 万 token —— 压缩永远不触发，历史涨到网关的
    // 1000 **条数**上限后每轮 400。取 budget 后阈值落到 134k token，约 270 条就压缩。
    const parsed = parseCatalog({
      object: "list",
      data: [
        {
          id: "deepseek-v4.1-flash",
          object: "model",
          owned_by: "vela",
          metadata: {
            cost: "low",
            capability: "advanced",
            context_limit: 1048000,
            context_budget: 328000,
            output_budget: 128000,
          },
          default: true,
          enabled: true,
        },
      ],
    });
    expect(parsed.entries[0]!.contextWindow).toBe(328000);
    expect(parsed.entries[0]!.maxTokens).toBe(128000);
  });

  it("没有 context_budget 时退回 context_limit（别家网关不公布 budget）", () => {
    const parsed = parseCatalog({
      data: [{ id: "m", metadata: { context_limit: 1_048_000, output_budget: 32_000 } }],
    });
    expect(parsed.entries[0]!.contextWindow).toBe(1_048_000);
  });

  it("扁平字段优先于 metadata（别家网关的形状更好时照旧生效）", () => {
    const parsed = parseCatalog({
      data: [{ id: "m", context_length: 200000, max_output_tokens: 8000, metadata: { context_limit: 999, output_budget: 111 } }],
    });
    expect(parsed.entries[0]!.contextWindow).toBe(200000);
    expect(parsed.entries[0]!.maxTokens).toBe(8000);
  });

  it("metadata 也没有容量时**不编数字**（保持「未公布」）", () => {
    const parsed = parseCatalog({ data: [{ id: "m", metadata: { cost: "low" } }] });
    expect(parsed.entries[0]!.contextWindow).toBeUndefined();
    expect(parsed.entries[0]!.maxTokens).toBeUndefined();
  });

  it("metadata 是坏形状时不抛错（负值/字符串/数组都不当容量）", () => {
    for (const metadata of [-1, "big", [], null, { context_limit: "1048000" }, { context_limit: 0 }]) {
      const parsed = parseCatalog({ data: [{ id: "m", metadata }] });
      expect(parsed.entries[0]!.contextWindow, JSON.stringify(metadata)).toBeUndefined();
    }
  });
});

describe("输入模态：opendesign 放在 architecture.input_modalities（2026-10-20 实测）", () => {
  it("**从 architecture.input_modalities 读到图片**（顶层没有 modalities）", () => {
    // 线上真实形状：`architecture: { input_modalities: ["text","image"] }`，顶层没有
    // `modalities` / `image`。只认顶层的旧实现把**所有**模型读成「仅文本」，
    // 宿主的图片按钮因此永远不出现 —— 包括上游明确声明支持图片的 deepseek-v4.1-flash。
    const parsed = parseCatalog({
      data: [
        { id: "deepseek-v4.1-flash", architecture: { input_modalities: ["text", "image"] } },
        { id: "deepseek-v4-flash", architecture: { input_modalities: ["text"] } },
        { id: "kimi-k2.7-code", architecture: { input_modalities: ["text", "image"] } },
      ],
    });
    expect(parsed.entries[0]!.inputModalities).toEqual(["text", "image"]);
    expect(parsed.entries[1]!.inputModalities).toEqual(["text"]);
    expect(parsed.entries[2]!.inputModalities).toEqual(["text", "image"]);
  });

  it("`file` / `video` / `audio` **不算**图片（宿主只有文本与图片两档）", () => {
    // 把 `file` 当成图片会让「能读附件」的模型误显示为能读图。
    const parsed = parseCatalog({
      data: [
        { id: "a", architecture: { input_modalities: ["text", "file"] } },
        { id: "b", architecture: { input_modalities: ["text", "video"] } },
        { id: "c", architecture: { input_modalities: ["text", "audio"] } },
      ],
    });
    for (const entry of parsed.entries) expect(entry.inputModalities).toEqual(["text"]);
  });

  it("顶层 modalities 仍然优先（别家形状更好时照旧生效）", () => {
    const parsed = parseCatalog({
      data: [{ id: "m", modalities: ["image"], architecture: { input_modalities: ["text"] } }],
    });
    expect(parsed.entries[0]!.inputModalities).toEqual(["text", "image"]);
  });

  it("architecture 是坏形状时不抛错（数组/字符串/null 都不当声明）", () => {
    for (const architecture of [[], "text,image", null, { input_modalities: "image" }, { input_modalities: [1, 2] }]) {
      const parsed = parseCatalog({ data: [{ id: "m", architecture }] });
      expect(parsed.entries[0]!.inputModalities, JSON.stringify(architecture)).toEqual(["text"]);
    }
  });
});

describe("effortsFor：思考强度", () => {
  it("目录声明优先（厂商自己公布时以它为准）", () => {
    expect(effortsFor("claude-sonnet-4-5", ["low", "max"])).toEqual(["low", "max"]);
  });

  it("DeepSeek 按**官方三档**声明：low / high / max（官方文档没有 off）", () => {
    // 官方文档 reasoning_effort 只收 low/high/max；关闭思考是 thinking.type / reasoning.effort，
    // 不是 reasoning_effort 的取值 —— 所以选择器里不该出现 off。
    for (const model of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(effortsFor(model)).toEqual(["low", "high", "max"]);
      expect(effortsFor(model)).not.toContain("off");
    }
    // 大小写与空白不该让实测表失配（目录 id 一直小写，但别指望）。
    expect(effortsFor("  DeepSeek-V4-Pro  ")).toEqual(MEASURED_EFFORTS["deepseek-v4-pro"]);
  });

  it("实测的逐模型差异照抄：GLM 三档、Kimi K2.7 官方不支持档位", () => {
    expect(effortsFor("glm-5.3-flash")).toEqual(["low", "high", "max"]);
    expect(effortsFor("glm-5.3-flashx")).toEqual(["low", "high", "max"]);
    // 官方：kimi-k2.7-code 思考强制开启，**不收 reasoning_effort** —— 不摆选择器。
    expect(effortsFor("kimi-k2.7-code")).toEqual([]);
  });

  it("目录没声明时按模型族兜底（每档都能对上官方文档）", () => {
    expect(effortsFor("claude-sonnet-4-5-20250929")).toEqual(["low", "medium", "high", "max"]);
    expect(effortsFor("anthropic/claude-opus-4-1")).toEqual(["low", "medium", "high", "max"]);
    expect(effortsFor("gpt-5.1")).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
    // 未实测的族：只给各家官方都认的三档。
    expect(effortsFor("gemini-2.5-pro")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("grok-4.5")).toEqual(["low", "medium", "high"]);
    expect(effortsFor("qwen3-max")).toEqual(["low", "medium", "high"]);
  });

  it("任何族都不该声明官方没有的 `off`（2026-11-06 修正）", () => {
    for (const model of ["deepseek-v4-pro", "claude-opus-5", "gpt-5.1", "glm-5.3-flash", "gemini-2.5-pro", "kimi-k3.1-pro"]) {
      expect(effortsFor(model)).not.toContain("off");
    }
  });

  it("认不出的模型**不声明**档位（猜一组只会换来 400）", () => {
    expect(familyEfforts("some-random-model")).toEqual([]);
    expect(effortsFor("some-random-model")).toEqual([]);
    expect(effortsFor("some-random-model", [])).toEqual([]);
  });
});

describe("网关白名单的两种口吻都能读（降一档重发靠它）", () => {
  it("`use one of a, b, c`（invalid_request_error）", () => {
    const body = {
      error: {
        message:
          "[code=invalid_request_error] reasoning effort is unsupported for glm-5.3-flash; use one of low, high, max",
      },
    };
    expect(allowedEffortsIn(body)).toEqual(["low", "high", "max"]);
  });

  it("`expected one of \"a\"|\"b\"`（upstream_error）", () => {
    const body = {
      error: {
        message:
          '[code=upstream_error] reasoning_effort: Invalid option: expected one of \"max\"|\"xhigh\"|\"high\"|\"low\"',
      },
    };
    expect(allowedEffortsIn(body)).toEqual(["max", "xhigh", "high", "low"]);
  });

  it("正文里没有白名单 / 不是档位词 → 空（调用方退回「去掉字段」）", () => {
    expect(allowedEffortsIn({ error: { message: "reasoning_effort is not supported" } })).toEqual([]);
    expect(allowedEffortsIn("boom")).toEqual([]);
    expect(allowedEffortsIn(undefined)).toEqual([]);
  });

  it("降一档挑「不高于所选、且被允许」的最强项", () => {
    expect(nearestAllowedEffort("max", ["low", "high", "max"])).toBe("max");
    // `ultra` 比 `max` 弱一档（实测顺序 none…xhigh, ultra, max）：降档只能退到 high。
    expect(nearestAllowedEffort("ultra", ["low", "high", "max"])).toBe("high");
    expect(nearestAllowedEffort("max", ["none", "minimal", "low", "medium", "high", "xhigh"])).toBe("xhigh");
    expect(nearestAllowedEffort("low", ["medium", "high"])).toBe("medium");
    expect(nearestAllowedEffort("low", [])).toBeUndefined();
    // `off` 与 `none` 是同一档：网关只认 `none` 时降成它，不会升成 max。
    expect(nearestAllowedEffort("off", ["none", "low", "high", "max"])).toBe("none");
    // 自定义档位 id（不在强弱表里）：按最强可用项处理。
    expect(nearestAllowedEffort("enterprise", ["low", "high"])).toBe("high");
  });
});
