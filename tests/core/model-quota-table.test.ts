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
  OPENCODE_MODEL_QUOTA,
  OPENDESIGN_MODEL_QUOTA,
  modelQuotaOf,
  normalizeModelKey,
  planKeyOf,
  quotaTableOf,
  planModelsOf,
  COMMANDCODE_PLAN_MODELS,
  modelAvailableIn,
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
  it("**GOAT 用 docs/plans/goat 的 60 行完整表**：闭源模型也有额度", () => {
    // 用户 2026-10-21 报障「commandcode 没看到每个模型各自的可用额度」。
    // 根因是当时用的是 pricing 页那张 7 行表（只有开源模型），查不到 Claude 系列；
    // 官方 docs/plans/goat 页把全部 60 个模型的 monthly credits 都列了出来。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Claude Sonnet 5.5")).toEqual({ kind: "usd", amount: 10 });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Claude Haiku 5.5")).toEqual({ kind: "usd", amount: 20 });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "GPT-5.6 Sol")).toEqual({ kind: "usd", amount: 20 });
  });

  it("GOAT 表里各模型额度差异巨大，不是套餐总额的固定比例", () => {
    // Ling 3.1 Flash 的 $100 比套餐总额 $70 还高；Claude Sonnet 5.5 只有 $10。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Ling 3.1 Flash")).toEqual({ kind: "usd", amount: 100 });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Claude Sonnet 5.5")).toEqual({ kind: "usd", amount: 10 });
  });

  it("MiniMax M3 在 GOAT 下是 $47（与官方页面一致）", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "MiniMax M3")).toEqual({ kind: "usd", amount: 47 });
  });

  it("目录里的 id 写法（带公司前缀、连字符）也能命中", () => {
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "minimax-m3")).toEqual({ kind: "usd", amount: 47 });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "cc/claude-sonnet-5.5")).toEqual({ kind: "usd", amount: 10 });
  });

  it("**表里明确没有的模型给 undefined**（Claude Opus 需 Pro/Max，GOAT 无额度）", () => {
    // 官方原文：「The rest of the premium lineup needs Pro or Max」。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Claude Opus 5.5")).toBeUndefined();
  });

  it("非 GOAT 档位仍用 pricing 页那张 7 行表（唯一给出这些档位数据的来源）", () => {
    // Go 档在 pricing 页有 MiniMax M3 = $8。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "Go", "MiniMax M3")).toEqual({ kind: "usd", amount: 8 });
    // 那些档位没有 Claude 的数据：不猜。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "Go", "Claude Sonnet 5.5")).toBeUndefined();
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

describe("OpenCode：官方逐模型额度", () => {
  // 数据来自公开页 https://opencode.ai/go 的 Monthly usage 列（2026-10-21 抓取）。
  // 这家只有 Go（$10/月）与 Go Plus（$40/月）两档。
  it("Go 下 Kimi K3 是 $15，DeepSeek V4.1 Flash 是 $80", () => {
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go", "Kimi K3")).toEqual({ kind: "usd", amount: 15 });
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go", "DeepSeek V4.1 Flash")).toEqual({ kind: "usd", amount: 80 });
  });

  it("Go Plus 的数字更大（同一模型是 $160）", () => {
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go Plus", "DeepSeek V4.1 Flash")).toEqual({ kind: "usd", amount: 160 });
  });

  it("官方标 Free 的模型（`∞`）给 free", () => {
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go", "Beam")).toEqual({ kind: "free" });
  });

  it("目录里的连字符写法也能命中（`GLM-5.3-Flash`）", () => {
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go", "glm-5.3-flash")).toEqual({ kind: "usd", amount: 60 });
  });

  it("表里没有的模型给 undefined", () => {
    expect(modelQuotaOf(OPENCODE_MODEL_QUOTA, "Go", "gpt-5")).toBeUndefined();
  });
});

describe("按套餐判断模型可用性（用户 2026-10-21）", () => {
  it("GOAT 清单覆盖 71 个模型", () => {
    expect(COMMANDCODE_PLAN_MODELS.goat.size).toBe(71);
  });

  it("**GOAT 包含的模型返回 true**（含闭源模型）", () => {
    // 官方：「Every model below is included on the GOAT plan」。
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "Claude Sonnet 5.5")).toBe(true);
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "MiniMax M3")).toBe(true);
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "deepseek/deepseek-v4.1-flash")).toBe(true);
  });

  it("**需要 Pro/Max 的模型返回 false**（应从列表里隐藏）", () => {
    // 官方：「The rest of the premium lineup needs Pro or Max」。
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "Claude Opus 5.5")).toBe(false);
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "Claude Fable 5")).toBe(false);
  });

  it("**没有该档位清单时返回 undefined**（不知道，不能藏）", () => {
    // 目前只有 GOAT 有官方完整清单；别的档位没有依据，必须返回 undefined。
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "Pro", "Claude Opus 5.5")).toBeUndefined();
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, undefined, "MiniMax M3")).toBeUndefined();
  });

  it("官方名里的 `(latest)` / `(exp)` 标注不影响匹配", () => {
    // 官方表写 `DeepSeek V4.1 Flash (latest)`，目录 id 是 `deepseek-v4.1-flash`。
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "DeepSeek V4.1 Flash (latest)")).toBe(true);
    expect(modelAvailableIn(COMMANDCODE_PLAN_MODELS, "GOAT", "DeepSeek V4 Flash Vision (exp)")).toBe(true);
  });
});

describe("GOAT 表必须是**合并**而不是覆盖（2026-10-21 回归）", () => {
  it("**pricing 页标 Free 的三个模型不能消失**", () => {
    // 踩过的 bug：写成 `goat: expandSingle(GOAT_RAW)` 会整桶覆盖，
    // 把 docs 页 Monthly credits 表里没有的 Free 模型（Beam / Glyph / Laguna）弄丢，
    // 界面上从「免费」变成空白。现在两张表合并。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Beam 1.0")).toEqual({ kind: "free" });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Glyph Cluster")).toEqual({ kind: "free" });
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "Laguna S 2.1")).toEqual({ kind: "free" });
  });

  it("docs 页的数字仍然优先（Free 只补缺，不覆盖真数字）", () => {
    // MiniMax M3.1 Flash 在 pricing 页 GOAT 列是 Free，但 docs 页给了 $20 ——
    // 完整表在前，所以 $20 胜出。
    expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", "MiniMax M3.1 Flash")).toEqual({ kind: "usd", amount: 20 });
  });

  it("合并后 GOAT 覆盖 63 个模型（60 个有额度 + 3 个 Free）", () => {
    expect(Object.keys(COMMANDCODE_MODEL_QUOTA.goat ?? {}).length).toBe(63);
  });
});

describe("厂商 → 额度表的显式映射（防子串误配）", () => {
  it("三个真实 providerId 各自命中正确的表", () => {
    // 以前靠 `vendor.includes(...)` 的顺序侥幸正确：`opendesign` 与 `opencode`
    // 共享 `openc` 前缀，顺序一改就会静默查错表 —— 显示另一家的额度，且不报错。
    expect(quotaTableOf("commandcode")).toBe(COMMANDCODE_MODEL_QUOTA);
    expect(quotaTableOf("opendesign")).toBe(OPENDESIGN_MODEL_QUOTA);
    expect(quotaTableOf("dsh-opencode-go")).toBe(OPENCODE_MODEL_QUOTA);
  });

  it("大小写不敏感，认不出的 id 返回 undefined（不猜）", () => {
    expect(quotaTableOf("CommandCode")).toBe(COMMANDCODE_MODEL_QUOTA);
    expect(quotaTableOf("open-design")).toBeUndefined();
    expect(quotaTableOf("unknown-vendor")).toBeUndefined();
    expect(quotaTableOf("")).toBeUndefined();
  });

  it("**opendesign 不会被 opencode 的规则抢走**（前缀重叠）", () => {
    // 这是子串匹配最容易出错的地方：两者都以 openc 开头。
    const design = quotaTableOf("opendesign");
    const code = quotaTableOf("dsh-opencode-go");
    expect(design).not.toBe(code);
    expect(design).toBe(OPENDESIGN_MODEL_QUOTA);
    expect(code).toBe(OPENCODE_MODEL_QUOTA);
  });

  it("只有 commandcode 有「套餐包含哪些模型」的官方清单", () => {
    expect(planModelsOf("commandcode")).toBe(COMMANDCODE_PLAN_MODELS);
    expect(planModelsOf("opendesign")).toBeUndefined();
    expect(planModelsOf("dsh-opencode-go")).toBeUndefined();
  });
});
