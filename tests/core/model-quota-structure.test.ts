/**
 * 额度表与可用清单的**结构性一致性防护**（2026-10-21）。
 *
 * 起因是一次真实回归：加 GOAT 完整表时写成整桶覆盖，把 pricing 页标为 `Free` 的
 * 三个模型（Beam / Glyph / Laguna）冲掉了。1373 个测试全绿——因为没有一条测试是
 * 「旧数据还在不在」，全都在验「新数据对不对」。
 *
 * 这里加的是**结构性**检查，不依赖具体数字：任何一次覆盖/误删只要改变了两个表之间的
 * 包含关系，就会立刻失败。
 */
import { describe, expect, it } from "vitest";

import {
  COMMANDCODE_MODEL_QUOTA,
  COMMANDCODE_PLAN_MODELS,
  modelQuotaOf,
} from "../../src/core/model-quota-table";

describe("结构防护：额度表 ⊆ 可用清单", () => {
  it("**额度表里的每个模型都必须在可用清单里**", () => {
    // 反过来的情况（在可用清单但没额度）是正常的：官方没公布数字 → 界面显示「未知」。
    // 但「有额度却不可用」说明数据自相矛盾（比如某次改动把不同档位的表混了）。
    const available = COMMANDCODE_PLAN_MODELS.goat;
    expect(available).toBeDefined();
    const quotaKeys = Object.keys(COMMANDCODE_MODEL_QUOTA.goat ?? {});
    const orphaned = quotaKeys.filter((key) => !available!.has(key));
    expect(orphaned, `这些模型有额度却不在 GOAT 可用清单里: ${orphaned.join(", ")}`).toEqual([]);
  });

  it("**免费模型不会被后续覆盖冲掉**", () => {
    // 这三个是 pricing 页标 Free、docs 页 Monthly credits 表里没有行的模型。
    // 它们是这次回归的受害者，单独钉住。
    for (const name of ["Beam 1.0", "Glyph Cluster", "Laguna S 2.1"]) {
      expect(modelQuotaOf(COMMANDCODE_MODEL_QUOTA, "GOAT", name), `${name} 应为 free`).toEqual({ kind: "free" });
    }
  });

  it("合并后 GOAT 桶的规模稳定（60 个有额度 + 3 个 Free）", () => {
    // 规模变化本身不是错，但突变通常意味着某一侧被误改。
    expect(Object.keys(COMMANDCODE_MODEL_QUOTA.goat ?? {}).length).toBe(63);
  });

  it("**五个档位都有各自的完整表**（2026-10-21 从各自 docs 页补齐）", () => {
    // 之前只有 GOAT 有完整表，其余档位只有 pricing 页那 7 个开源模型 ——
    // 用户切档位就是大片「未知」。现在每档都从 `docs/plans/{go,pro,max}` 补齐。
    const expected: Record<string, number> = { go: 50, goat: 63, pro: 78, max10x: 97, max20x: 97 };
    for (const [plan, count] of Object.entries(expected)) {
      expect(Object.keys(COMMANDCODE_MODEL_QUOTA[plan] ?? {}).length, `${plan} 档覆盖数`).toBe(count);
    }
  });

  it("**同一模型在不同档位拿到不同额度**（不能串档）", () => {
    const of = (plan: string) => modelQuotaOf(COMMANDCODE_MODEL_QUOTA, plan, "Claude Sonnet 5.5");
    expect(of("goat")).toEqual({ kind: "usd", amount: 10 });
    expect(of("pro")).toEqual({ kind: "usd", amount: 20 });
    expect(of("max10x")).toEqual({ kind: "usd", amount: 150 });
    expect(of("max20x")).toEqual({ kind: "usd", amount: 300 });
    // Go 档没有 Claude（官方 Go 页没列它）。
    expect(of("go")).toBeUndefined();
  });

  it("每个档位都有桶（不会被某次合并意外丢掉整档）", () => {
    for (const plan of ["go", "goat", "pro", "max10x", "max20x"]) {
      expect(COMMANDCODE_MODEL_QUOTA[plan], `缺 ${plan} 桶`).toBeDefined();
    }
  });
});
