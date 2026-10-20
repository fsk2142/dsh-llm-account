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
  it("**从 metadata.context_limit / output_budget 读容量**（顶层没有这两个字段）", () => {
    // 线上目录的真实形状（`/v1/models` 实测）：顶层只有 id/object/created/owned_by/
    // architecture/metadata/default/enabled，**没有** context_length / max_output_tokens。
    // 只认顶层的旧实现把 12 个模型全读成「未公布」，连带两个后果：
    //   ① 宿主不显示会话长度；
    //   ② 宿主的自动压缩插件拿到 info.context === undefined 后直接抛错，该路由**完全不压缩**，
    //      最终以 HTTP 400（上下文超限）收场。
    const parsed = parseCatalog({
      object: "list",
      data: [
        {
          id: "deepseek-v4.1-flash",
          object: "model",
          owned_by: "vela",
          metadata: { cost: "low", capability: "advanced", context_limit: 1048000, output_budget: 128000 },
          default: true,
          enabled: true,
        },
      ],
    });
    expect(parsed.entries[0]!.contextWindow).toBe(1048000);
    expect(parsed.entries[0]!.maxTokens).toBe(128000);
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

describe("effortsFor：思考强度", () => {
  it("目录声明优先（厂商自己公布时以它为准）", () => {
    expect(effortsFor("claude-sonnet-4-5", ["low", "max"])).toEqual(["low", "max"]);
  });

  it("DeepSeek 按**官方四档**声明：off / low / high / max（用户确认的口径）", () => {
    // 网关实际还接受 none/minimal/medium/xhigh/ultra（别名摊平到上游四档），但界面只摆官方四档。
    for (const model of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4-flash-vision-exp"]) {
      expect(effortsFor(model)).toEqual(["off", "low", "high", "max"]);
    }
    // 大小写与空白不该让实测表失配（目录 id 一直小写，但别指望）。
    expect(effortsFor("  DeepSeek-V4-Pro  ")).toEqual(MEASURED_EFFORTS["deepseek-v4-pro"]);
  });

  it("实测的逐模型差异照抄：GLM 三档、Kimi 没有 max", () => {
    expect(effortsFor("glm-5.3-flash")).toEqual(["low", "high", "max"]);
    expect(effortsFor("glm-5.3-flashx")).toEqual(["low", "high", "max"]);
    expect(effortsFor("kimi-k2.7-code")).toEqual(["low", "high"]);
  });

  it("目录没声明时按模型族兜底（含 max，这是选择器能出现的唯一来源）", () => {
    expect(effortsFor("claude-sonnet-4-5-20250929")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("anthropic/claude-opus-4-1")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("gpt-5.1")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // 未实测的族：保守集（有 max，但不声称 none/minimal/ultra）。
    expect(effortsFor("gemini-2.5-pro")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("grok-4.5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortsFor("qwen3-max")).toEqual(["low", "medium", "high", "xhigh", "max"]);
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
