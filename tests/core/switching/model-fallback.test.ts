/**
 * 限额换模型的纯判定测试。
 *
 * 用户 2026-10-19 晚定的四级优先（原话：「优先原则就是同供应商同模型，其次就是不同供应商
 * 同模型，再其次就是同供应商不同模型，原则为参数能力什么的接近，最后就是不同供应商不同模型」，
 * 并明确「供应商」= 网关，同一级里随机选）。
 */
import { describe, expect, it } from "vitest";

import {
  capabilityDistance,
  fallbackEffort,
  fallbackTierOf,
  isOfficialProvider,
  modelKeyOf,
  pickFallbackModel,
  type FallbackCandidate,
} from "../../../src/core/switching/model-fallback";

/** 造一个候选。 */
function at(provider: string, model: string, extra: Partial<FallbackCandidate> = {}): FallbackCandidate {
  return { provider, model, ...extra };
}

/** 固定随机源（返回 0 → 永远取第一个；让随机行为可断言）。 */
const first = (): number => 0;
/** 固定随机源（返回 0.999 → 取最后一个）。 */
const last = (): number => 0.999;

describe("排除官方直连", () => {
  it("官方路由被认出来", () => {
    expect(isOfficialProvider("deepseek")).toBe(true);
    expect(isOfficialProvider("deepseek-account")).toBe(true);
    expect(isOfficialProvider("DeepSeek")).toBe(true);
  });

  it("本包托管的三个网关不被误判成官方", () => {
    expect(isOfficialProvider("commandcode")).toBe(false);
    expect(isOfficialProvider("dsh-opencode-go")).toBe(false);
    expect(isOfficialProvider("opendesign")).toBe(false);
  });
});

describe("模型归一化键", () => {
  it("厂商前缀、大小写、分隔符都不影响同名判定", () => {
    expect(modelKeyOf("deepseek/deepseek-v4.1-flash")).toBe("deepseekv41flash");
    expect(modelKeyOf("deepseek-v4.1-flash")).toBe("deepseekv41flash");
    expect(modelKeyOf("DeepSeek-V4.1-Flash")).toBe("deepseekv41flash");
  });

  it("不同档位的模型不会被当成同名", () => {
    expect(modelKeyOf("deepseek-v4.1-flash")).not.toBe(modelKeyOf("deepseek-v4-pro"));
  });
});

describe("四级判定", () => {
  const current = at("commandcode", "deepseek-v4.1-flash");

  it("同网关 + 同名 = 第 1 级", () => {
    expect(fallbackTierOf(current, at("commandcode", "deepseek/deepseek-v4.1-flash"))).toBe(1);
  });

  it("跨网关 + 同名 = 第 2 级", () => {
    expect(fallbackTierOf(current, at("opendesign", "deepseek-v4.1-flash"))).toBe(2);
  });

  it("同网关 + 异名 = 第 3 级", () => {
    expect(fallbackTierOf(current, at("commandcode", "kimi-k3"))).toBe(3);
  });

  it("跨网关 + 异名 = 第 4 级", () => {
    expect(fallbackTierOf(current, at("opendesign", "kimi-k3"))).toBe(4);
  });
});

describe("按四级优先挑替代", () => {
  const current = at("commandcode", "deepseek-v4.1-flash", { contextWindow: 1_000_000, effortCount: 3 });

  it("优先同网关同名（即使跨网关同名也在候选里）", () => {
    const sameGateway = at("commandcode", "deepseek/deepseek-v4.1-flash");
    const picked = pickFallbackModel(current, [at("opendesign", "deepseek-v4.1-flash"), sameGateway], {
      random: first,
    });
    expect(picked).toEqual(sameGateway);
  });

  it("没有同网关同名时，选跨网关同名（第 2 级优先于第 3 级）", () => {
    const crossGateway = at("opendesign", "deepseek-v4.1-flash");
    const picked = pickFallbackModel(current, [at("commandcode", "kimi-k3"), crossGateway], { random: first });
    expect(picked).toEqual(crossGateway);
  });

  it("同名都没有时，第 3 级优先于第 4 级", () => {
    const sameGateway = at("commandcode", "claude-sonnet-5");
    const picked = pickFallbackModel(current, [at("opendesign", "kimi-k3"), sameGateway], { random: first });
    expect(picked).toEqual(sameGateway);
  });

  it("只剩第 4 级时也能换（不硬性停手）", () => {
    const only = at("opendesign", "kimi-k3");
    expect(pickFallbackModel(current, [only], { random: first })).toEqual(only);
  });

  it("排除官方直连", () => {
    const picked = pickFallbackModel(
      current,
      [at("deepseek", "deepseek-v4.1-flash"), at("opendesign", "deepseek-v4.1-flash")],
      { random: first },
    );
    expect(picked).toEqual(at("opendesign", "deepseek-v4.1-flash"));
  });

  it("排除自己（同网关同 id）", () => {
    expect(pickFallbackModel(current, [current], { random: first })).toBeUndefined();
  });

  it("没有候选时停手", () => {
    expect(pickFallbackModel(current, [], { random: first })).toBeUndefined();
  });
});

describe("同一级里随机", () => {
  const current = at("commandcode", "deepseek-v4.1-flash", { contextWindow: 1_000_000, effortCount: 3 });

  it("第 2 级有两个时，随机源决定选哪个", () => {
    const candidates = [at("opendesign", "deepseek-v4.1-flash"), at("dsh-opencode-go", "deepseek-v4.1-flash")];
    expect(pickFallbackModel(current, candidates, { random: first })).toEqual(candidates[0]);
    expect(pickFallbackModel(current, candidates, { random: last })).toEqual(candidates[1]);
  });

  it("随机源始终落在候选集合内（不越界）", () => {
    const candidates = [at("opendesign", "deepseek-v4.1-flash"), at("dsh-opencode-go", "deepseek-v4.1-flash")];
    for (const value of [0, 0.5, 0.999999, 1]) {
      const picked = pickFallbackModel(current, candidates, { random: () => value });
      expect(candidates).toContainEqual(picked);
    }
  });
});

describe("异名模型的「参数能力接近」", () => {
  it("上下文窗口越接近，距离越小", () => {
    const current = at("commandcode", "a", { contextWindow: 1_000_000, effortCount: 3 });
    const near = capabilityDistance(current, at("commandcode", "b", { contextWindow: 1_000_000, effortCount: 3 }));
    const far = capabilityDistance(current, at("commandcode", "c", { contextWindow: 32_000, effortCount: 3 }));
    expect(near).toBeLessThan(far);
  });

  it("第 3 级里优先选能力最接近的（即使随机源指向别的）", () => {
    const current = at("commandcode", "deepseek-v4.1-flash", { contextWindow: 1_000_000, effortCount: 3 });
    const picked = pickFallbackModel(
      current,
      [
        at("commandcode", "tiny-old", { contextWindow: 32_000, effortCount: 1 }),
        at("commandcode", "same-class", { contextWindow: 1_000_000, effortCount: 3 }),
      ],
      { random: first },
    );
    // 收窄到最接近的那一档后只剩一个，所以随机源是谁都选它。
    expect(picked?.model).toBe("same-class");
  });

  it("上下文窗口未知时给大惩罚分（未知不算恰好合适）", () => {
    const current = at("commandcode", "a", { contextWindow: 1_000_000, effortCount: 3 });
    const known = capabilityDistance(current, at("commandcode", "b", { contextWindow: 900_000, effortCount: 3 }));
    const unknown = capabilityDistance(current, at("commandcode", "c"));
    expect(unknown).toBeGreaterThan(known);
  });
});

describe("思考强度回落", () => {
  it("替代模型支持原档位时原样保留", () => {
    expect(fallbackEffort("max", ["low", "high", "max"])).toBe("max");
  });

  it("不支持原档位时取该模型最高档", () => {
    expect(fallbackEffort("max", ["off", "low", "high"])).toBe("high");
  });

  it("替代模型没有档位时交给厂商决定", () => {
    expect(fallbackEffort("max", [])).toBeUndefined();
  });
});
