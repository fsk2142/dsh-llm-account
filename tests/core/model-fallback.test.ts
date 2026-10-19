/**
 * 限额时换模型的纯判定测试。
 *
 * 这些规则会被用户当**承诺**读，所以每条都要钉住：
 * - 只换同名（不猜档位，避免「限额时悄悄降智」）；
 * - 官方直连永远排除；
 * - 思考强度尽量保留，保不住就取该模型最高档，而不是发一个它不认的值。
 */
import { describe, expect, it } from "vitest";

import {
  fallbackEffort,
  isOfficialProvider,
  modelKeyOf,
  pickFallbackModel,
  type FallbackCandidate,
} from "../../src/core/model-fallback";

/** 造一个候选。 */
function at(provider: string, model: string): FallbackCandidate {
  return { provider, model };
}

describe("排除官方直连", () => {
  it("官方路由被认出来", () => {
    expect(isOfficialProvider("deepseek")).toBe(true);
    expect(isOfficialProvider("deepseek-account")).toBe(true);
    expect(isOfficialProvider("DeepSeek")).toBe(true);
    expect(isOfficialProvider("deepseek-official")).toBe(true);
  });

  it("本包托管的三个网关不被误判成官方", () => {
    expect(isOfficialProvider("commandcode")).toBe(false);
    expect(isOfficialProvider("dsh-opencode-go")).toBe(false);
    expect(isOfficialProvider("opendesign")).toBe(false);
  });

  it("空串不是官方（拿不到 provider 时不乱排除）", () => {
    expect(isOfficialProvider("")).toBe(false);
    expect(isOfficialProvider("  ")).toBe(false);
  });
});

describe("模型归一化键", () => {
  it("厂商前缀、大小写、分隔符都不影响同名判定", () => {
    expect(modelKeyOf("deepseek/deepseek-v4.1-flash")).toBe("deepseekv41flash");
    expect(modelKeyOf("deepseek-v4.1-flash")).toBe("deepseekv41flash");
    expect(modelKeyOf("DeepSeek-V4.1-Flash")).toBe("deepseekv41flash");
    expect(modelKeyOf("deepseek_v4_1_flash")).toBe("deepseekv41flash");
  });

  it("不同档位的模型不会被当成同名", () => {
    expect(modelKeyOf("deepseek-v4.1-flash")).not.toBe(modelKeyOf("deepseek-v4-pro"));
  });
});

describe("挑替代模型", () => {
  const current = at("commandcode", "deepseek/deepseek-v4.1-flash");

  it("同一网关内换到**同名**模型（adapter 的能力边界内）", () => {
    const picked = pickFallbackModel(current, [
      current,
      at("commandcode", "deepseek-v4.1-flash"),
      at("commandcode", "kimi-k3"),
    ]);
    expect(picked).toEqual(at("commandcode", "deepseek-v4.1-flash"));
  });

  it("默认**不**跨 provider：adapter 不能替别家发请求", () => {
    // 宿主的 `GenerateOptions.provider` 由路由决定，adapter 改不了它 ——
    // 所以跨厂商换模型必须由上层编排，这里不替它做主。
    const picked = pickFallbackModel(current, [current, at("opendesign", "deepseek-v4.1-flash")]);
    expect(picked).toBeUndefined();
  });

  it("显式允许时可以跨 provider（供上层编排复用同一份判定）", () => {
    const picked = pickFallbackModel(
      current,
      [current, at("opendesign", "deepseek-v4.1-flash")],
      { allowCrossProvider: true },
    );
    expect(picked).toEqual(at("opendesign", "deepseek-v4.1-flash"));
  });

  it("不会换到不同档位的模型（不猜）", () => {
    const picked = pickFallbackModel(current, [
      current,
      at("commandcode", "deepseek-v4-pro"),
      at("commandcode", "claude-sonnet-5"),
    ]);
    expect(picked).toBeUndefined();
  });

  it("排除官方直连：同名但走官方路由的不选", () => {
    const picked = pickFallbackModel(
      current,
      [current, at("deepseek", "deepseek-v4.1-flash"), at("opendesign", "deepseek-v4.1-flash")],
      { allowCrossProvider: true },
    );
    expect(picked).toEqual(at("opendesign", "deepseek-v4.1-flash"));
  });

  it("只有官方同名时不换（宁可停手）", () => {
    const picked = pickFallbackModel(
      current,
      [current, at("deepseek", "deepseek-v4.1-flash")],
      { allowCrossProvider: true },
    );
    expect(picked).toBeUndefined();
  });

  it("跳过自己（同一个 provider + model 不算替代）", () => {
    const picked = pickFallbackModel(current, [current]);
    expect(picked).toBeUndefined();
  });

  it("按候选顺序取第一个可用（偏好顺序由调用方决定）", () => {
    const picked = pickFallbackModel(
      current,
      [current, at("dsh-opencode-go", "deepseek-v4.1-flash"), at("opendesign", "deepseek-v4.1-flash")],
      { allowCrossProvider: true },
    );
    expect(picked?.provider).toBe("dsh-opencode-go");
  });
});

describe("思考强度回落", () => {
  it("替代模型支持原档位时原样保留", () => {
    expect(fallbackEffort("max", ["low", "high", "max"])).toBe("max");
  });

  it("不支持原档位时取该模型最高档（尽量想得一样多）", () => {
    expect(fallbackEffort("max", ["off", "low", "high"])).toBe("high");
  });

  it("替代模型没有档位时交给厂商决定", () => {
    expect(fallbackEffort("max", [])).toBeUndefined();
    expect(fallbackEffort(undefined, [])).toBeUndefined();
  });

  it("原本没选档位时也不凭空造一个", () => {
    // 没有 wanted 时仍取最高档：从「厂商自己决定」变成明确指定，是为了对齐用户
    // 「连同思考强度一起切换」的要求；但绝不在无档位模型上发字段。
    expect(fallbackEffort(undefined, ["low", "high"])).toBe("high");
  });
});

describe("自动切换模型白名单", () => {
  const current = { provider: "commandcode", model: "deepseek-v4.1-flash" };
  const candidates = [
    current,
    { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" },
    { provider: "opendesign", model: "deepseek-v4.1-flash" },
  ];

  it("名单为空 = 不限制（退回原来的候选）", () => {
    const picked = pickFallbackModel(current, candidates, { allowCrossProvider: true, whitelist: [] });
    expect(picked).toEqual({ provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" });
  });

  it("名单非空时只收名单内的", () => {
    const picked = pickFallbackModel(current, candidates, {
      allowCrossProvider: true,
      whitelist: ["opendesign-not-a-model"],
    });
    expect(picked).toBeUndefined();
  });

  it("名单命中时正常换过去", () => {
    const picked = pickFallbackModel(current, candidates, {
      allowCrossProvider: true,
      whitelist: ["deepseek-v4.1-flash"],
    });
    // 同名（归一化后相等）且在白名单里 → 选中第一个合格候选。
    expect(picked).toEqual({ provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" });
  });

  it("白名单同样按归一化键比较（写法差异不影响）", () => {
    // 用户填 `deepseek/deepseek-v4.1-flash`，候选是 `deepseek-v4.1-flash` —— 两者同键。
    const picked = pickFallbackModel(
      { provider: "opendesign", model: "deepseek-v4.1-flash" },
      [
        { provider: "opendesign", model: "deepseek-v4.1-flash" },
        { provider: "commandcode", model: "deepseek-v4.1-flash" },
      ],
      { allowCrossProvider: true, whitelist: ["deepseek/deepseek-v4.1-flash"] },
    );
    expect(picked).toEqual({ provider: "commandcode", model: "deepseek-v4.1-flash" });
  });

  it("名单里的空串/空白被忽略（不会把候选全挡掉）", () => {
    const picked = pickFallbackModel(current, candidates, {
      allowCrossProvider: true,
      whitelist: ["", "  "],
    });
    // 清洗后名单为空 → 视为不限制。
    expect(picked).not.toBeUndefined();
  });
});
