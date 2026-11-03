import { describe, expect, it } from "vitest";

import { parseModels } from "../../src/vendors/opencode/catalog";

/**
 * 网关 `/models` 自己公布的推理档位（2026-11-03 报障）。
 *
 * ## 现象
 *
 * ```
 * provider "dsh-opencode-go" model "deepseek-v4.1-flash" does not support reasoning effort "max"
 * ```
 *
 * 用户选了 `max`，**有时能用、有时报这个错**，重发一次又能继续。
 *
 * ## 根因
 *
 * 档位只从 models.dev 元数据（`reasoning_options`）来：
 * `adapter.ts` 的 `record?.efforts ?? entry?.efforts ?? []`。
 * 那次抓取**失败或没带到档位**时，`efforts` 变成空数组 → 宿主认为这个模型没有档位
 * → 下一次带 `max` 的请求被宿主直接拒掉。所以它是**间歇性**的：元数据好的时候能跑。
 *
 * ## 但网关本来就公布档位
 *
 * `GET {base}/models` 的每条模型带 `capabilities.reasoning.effort`，实测
 * `deepseek-v4.1-flash` 是 `["low","high","max"]` —— 这个端点是**必需请求**
 * （目录本身就是从它来的），所以它的档位**永远拿得到**，比 models.dev 更可靠。
 */
describe("网关 /models 公布的推理档位", () => {
  const PAYLOAD = {
    object: "list",
    data: [
      {
        id: "deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        capabilities: { reasoning: { supported: true, effort: ["low", "high", "max"] } },
        limit: { context: 1_000_000, output: 384_000 },
      },
      {
        id: "grok-4.7",
        name: "Grok 4.7",
        capabilities: { reasoning: { supported: false } },
      },
    ],
  };

  it("**把 `capabilities.reasoning.effort` 读成档位**（这是修掉间歇性 max 报错的关键）", () => {
    const { entries } = parseModels(PAYLOAD);
    const flash = entries.find((entry) => entry.id === "deepseek-v4.1-flash");
    expect(flash, "模型应在目录里").toBeDefined();
    expect(flash!.efforts, "网关公布的档位必须被读进来").toEqual(["low", "high", "max"]);
  });

  it("没声明档位的模型不编造（`supported: false` → 无档位）", () => {
    const { entries } = parseModels(PAYLOAD);
    const grok = entries.find((entry) => entry.id === "grok-4.7");
    expect(grok, "模型应在目录里").toBeDefined();
    expect(grok!.efforts, "不能凭空给一组档位").toBeUndefined();
  });

  it("`effort` 数组里的非字符串/空串被过滤掉（形状不可信）", () => {
    const { entries } = parseModels({
      object: "list",
      data: [
        {
          id: "m1",
          capabilities: { reasoning: { supported: true, effort: ["low", "", null, 3, "max"] } },
        },
      ],
    });
    expect(entries[0]!.efforts).toEqual(["low", "max"]);
  });

  it("`effort` 为空数组时不产出 efforts 字段（不是 `[]`）", () => {
    const { entries } = parseModels({
      object: "list",
      data: [{ id: "m2", capabilities: { reasoning: { supported: true, effort: [] } } }],
    });
    expect(entries[0]!.efforts).toBeUndefined();
  });
});
