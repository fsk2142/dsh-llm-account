/**
 * 换模型时的**能力约束**（2026-11-12 审查 A06）。
 *
 * ## 被钉住的缺陷
 *
 * `pickFallbackModel` 原来只比三样东西：provider、model 名、以及
 * `contextWindow` / `effortCount` 这两个「接近度」判据。**它不看模态能力**。
 *
 * 后果：一轮请求里带了图片，原模型限额后自动换模型 —— 可能换到一个只吃 `text` 的模型，
 * 于是图片被**静默丢掉**（不报错，模型只是「没看到图」）。用户看到的是
 * 「模型好像没理解我发的图」。
 *
 * ## 修法
 *
 * 候选上带 `inputModalities`，`pickFallbackModel` 接受一个「本轮请求需要什么」的描述
 * （`requiresImages`），**把不识图的候选直接排除**。排除后仍然按原来的四级优先挑。
 *
 * 这条用例固定两件事：
 * 1. 需要图片时，识图候选优先；不识图的**绝不**被选中；
 * 2. 不需要图片时，识图的候选照常可用（新闸门不得误伤正常路径）。
 */
import { describe, expect, it } from "vitest";

import { pickFallbackModel, type FallbackCandidate } from "../../../src/core/switching/model-fallback";

/** 造一个候选；`modalities` 缺省表示「厂商没声明」。 */
function at(
  provider: string,
  model: string,
  extra: Partial<FallbackCandidate> = {},
  modalities?: readonly string[],
): FallbackCandidate {
  return {
    provider,
    model,
    ...extra,
    ...(modalities === undefined ? {} : { inputModalities: modalities }),
  };
}

/** 固定随机源：永远取第一个（让随机行为可断言）。 */
const first = (): number => 0;

describe("A06：换模型必须看模态能力", () => {
  it("**需要图片时，不识图的候选被排除**（不许静默丢图）", () => {
    const current = at("opendesign", "deepseek-v4.1-flash", {}, ["text", "image"]);
    const candidates = [
      // 更接近（同网关 + 同窗口）但**不识图** —— 旧实现会选它。
      at("opendesign", "text-only-model", { contextWindow: 1_000_000 }, ["text"]),
      // 跨网关且识图：这才是应该被选中的那个。
      at("commandcode", "vision-model", { contextWindow: 1_000_000 }, ["text", "image"]),
    ];
    const picked = pickFallbackModel(current, candidates, {
      random: first,
      requiresImages: true,
    });
    expect(picked, "必须选一个识图的候选").toBeDefined();
    expect(picked!.model, "不识图的候选必须先被排除").toBe("vision-model");
  });

  it("**需要图片时，一个识图候选都没有 → 返回 undefined**（宁可停手，不乱选）", () => {
    const current = at("opendesign", "deepseek-v4.1-flash", {}, ["text", "image"]);
    const candidates = [at("opendesign", "text-only-model", {}, ["text"])];
    expect(
      pickFallbackModel(current, candidates, { random: first, requiresImages: true }),
      "没有识图候选时不能退回一个不识图的",
    ).toBeUndefined();
  });

  it("不需要图片时，识图之外的能力照常可用（新闸门不得误伤）", () => {
    const current = at("opendesign", "deepseek-v4.1-flash", {}, ["text"]);
    const candidates = [at("commandcode", "plain-model", { contextWindow: 1_000_000 }, ["text"])];
    const picked = pickFallbackModel(current, candidates, { random: first, requiresImages: false });
    expect(picked?.model, "纯文本请求仍然可以换到纯文本模型").toBe("plain-model");
  });

  it("**厂商没声明模态时不做排除**（未知不等于「不支持」）", () => {
    /*
     * 这条是刻意的不对称：`inputModalities` 缺失说明**我们不知道**，
     * 而不是「它一定不支持」。把它当不支持会让一批没公布模态的模型永远换不过去。
     *
     * 真实的图片丢失风险由「原模型识图 + 目标未知」这一种组合承担 ——
     * 而它比「一律禁止换到未知模型」小得多。
     */
    const current = at("opendesign", "deepseek-v4.1-flash", {}, ["text", "image"]);
    const candidates = [at("commandcode", "unknown-modalities", { contextWindow: 1_000_000 })];
    const picked = pickFallbackModel(current, candidates, { random: first, requiresImages: true });
    expect(picked?.model, "未声明模态的候选不应被预先排除").toBe("unknown-modalities");
  });

  it("不传 `requiresImages` 时行为完全不变（向后兼容）", () => {
    const current = at("opendesign", "m1", {}, ["text", "image"]);
    const candidates = [at("opendesign", "m2", {}, ["text"])];
    const picked = pickFallbackModel(current, candidates, { random: first });
    expect(picked?.model, "老调用点不该因为这个新参数而改变行为").toBe("m2");
  });
});
