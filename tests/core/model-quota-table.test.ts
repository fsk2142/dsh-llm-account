/**
 * 「每个模型在这个套餐下能用多少额度」的数据表（2026-10-21 用户要求）。
 *
 * 用户原话：「各家套餐对于不同的模型有不同的额度限制，所以每个模型上能否增加一下额度
 * 信息显示……打个比方说 deepseek 就是 120，那就写 120 美刀，使用 gpt6.1 sol 只有
 * 30 美刀 那就写 30 美刀」。
 *
 * 这里钉住三件容易错的事：
 * 1. **额度不是套餐总额的固定比例** —— GOAT（$70）里 MiMo V2.5 是 $100，比总额还高；
 * 2. **模型 id 的各种写法要落到同一个键**（`deepseek/deepseek-v4.1-flash` 与
 *    `DeepSeek V4.1 Flash` 必须命中同一行）；
 * 3. **查不到就不给数字**（套餐认不出 / 模型不在表里 / 官方没给），绝不猜一个。
 */
import { describe, expect, it } from "vitest";

import {
  COMMANDCODE_MODEL_QUOTA,
  OPENDESIGN_MODEL_QUOTA,
  modelQuotaOf,
  normalizeModelKey,
  planKeyOf,
} from "../../src/core/model-quota-table";

describe("normalizeModelKey：各种写法落到同一个键", () => {
  it("公司前缀只取最后一段", () => {
    expect(normalizeModelKey("deepseek/deepseek-v4.1-flash")).toBe("deepseek v4.1 flash");
    expect(normalizeModelKey("anthropic/claude-sonnet-4-5")).toBe("claude sonnet 4 5");
  });

  it("连字符、下划线、空格当成同一个东西", () => {
    expect(normalizeModelKey("DeepSeek V4.1 Flash")).toBe("deepseek v4.1 flash");
    expect(normalizeModelKey("deepseek-v4.1-flash")).toBe("deepseek v4.1 flash");
    expect(normalizeModelKey("deepseek_v4.1_flash")).toBe("deepseek v4.1 flash");
  });

  it("大小写不参与语义", () => {
    expect(normalizeModelKey("MiniMax-M3")).toBe(normalizeModelKey("minimax m3"));
  });

  it("空输入给空串", () => {
    expect(normalizeModelKey("")).toBe("");
    expect(normalizeModelKey("   ")).toBe("");
  });
});

describe("planKeyOf：套餐展示名归一化", () => {
  it("常见档位都认", () => {
    expect(planKeyOf("Go")).toBe("go");
    expect(planKeyOf("GOAT")).toBe("goat");
    expect(planKeyOf("Pro")).toBe("pro");
    expect(planKeyOf("Plus")).toBe("plus");
  });

  it("`Max 10×` 这种带空格与乘号的写法也认", () => {
    expect(planKeyOf("Max 10×")).toBe("max10x");
    expect(planKeyOf("Max 20×")).toBe("max20x");
    expect(planKeyOf("max-20x")).toBe("max20x");
  });

  it("认不出的档位给 undefined（不猜）", () => {
    expect(planKeyOf("Enterprise")).toBeUndefined();
    expect(planKeyOf("")).toBeUndefined();
  });
});

describe("Command Code：官方逐模型额度", () => {
  it("**GOAT 里 MiMo V2.5 是 $100，比套餐总额 $70 还高**（不是固定比例）", () => {
    // 这是「不能用百分比推算」最直接的反例：如果按 $70 × 比例 算，永远算不出 $100。
    const amount = modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "MiMo V2.5");
    expect(amount).toEqual({ kind: "approx", amount: 100 });
  });

  it("MiniMax M3 在 GOAT 下是确定的 $47", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "MiniMax M3")).toEqual({ kind: "usd", amount: 47 });
  });

  it("官方标 Free 的模型给 free（不是 0 美元）", () => {
    // `Free` 的语义是「容量期内不扣额度」，与「额度是 0」完全不同。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Ornith 1.5 122B")).toEqual({ kind: "free" });
  });

  it("目录里的 id 写法（带公司前缀、连字符）也能命中", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "goat", "deepseek/deepseek-v4.1-flash")).toBeUndefined();
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "minimax-m3")).toEqual({ kind: "usd", amount: 47 });
  });

  it("表里没有的模型给 undefined，不编一个数字", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "claude-opus-4.8")).toBeUndefined();
  });

  it("表里没有的套餐给 undefined", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "Enterprise", "MiniMax M3")).toBeUndefined();
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, undefined, "MiniMax M3")).toBeUndefined();
  });
});

describe("Open Design：官方逐模型额度", () => {
  it("Go 下 DeepSeek V4.1 Flash 是 $120（能吃满整个套餐）", () => {
    expect(modelQuotaOf(OPENDESIGN_MODEL_QUOTA, "Go", "deepseek-v4.1-flash")).toEqual({ kind: "usd", amount: 120 });
  });

  it("Go 下 GPT-6 Luna 只有 $15（同一个套餐里差 8 倍）", () => {
    // 用户举的例子正是这类差距：同一个套餐，不同模型可用额度天差地别。
    expect(modelQuotaOf(OPENDESIGN_MODEL_QUOTA, "Go", "gpt-6-luna")).toEqual({ kind: "usd", amount: 15 });
  });

  it("换套餐数字跟着变（Pro 下同一模型是 $360）", () => {
    expect(modelQuotaOf(OPENDESIGN_MODEL_QUOTA, "Pro", "DeepSeek V4.1 Flash")).toEqual({ kind: "usd", amount: 360 });
  });

  it("**Max 档官方没给美元列**：不猜，返回 undefined", () => {
    // 官方页面的 Max 列是空的。照着 Go/Plus/Pro 的比例去推会编出一个假数字。
    expect(modelQuotaOf(OPENDESIGN_MODEL_QUOTA, "Max", "DeepSeek V4.1 Flash")).toBeUndefined();
  });

  it("不在表里的模型给 undefined", () => {
    expect(modelQuotaOf(OPENDESIGN_MODEL_QUOTA, "Go", "claude-opus-5")).toBeUndefined();
  });
});
