/**
 * 展示名**跨网关唯一**（2026-10-20 报障：「模型名称又不一致了」）。
 *
 * 现象与证据：同一个模型在三家网关的 id 写法不同 ——
 * - Command Code：`deepseek/deepseek-v4.1-flash`，目录还自带 `name: "DeepSeek V4.1 Flash (CC)"`；
 * - Open Code：`deepseek-v4.1-flash`，名字来自 models.dev（`DeepSeek V4.1 Flash`）；
 * - Open Design：`deepseek-v4.1-flash`，目录**不给** name（走 `officialModelName`）。
 *
 * 以前只有 Open Design 走名称规则，另两家照搬厂商给的 name，于是宿主的模型选择器里
 * 同一个模型出现三种写法。规则只有一条：**展示名一律由 id 派生**，与是哪个网关无关；
 * 厂商的 name 只用来判断这一行是否有效，不再进界面。
 *
 * 顺带钉住两个真实回归：
 * 1. 大小写敏感会把 `meituan/LongCat-2.0` 写成 `Longcat-2.0`（与另一家的写法不一致）；
 * 2. 去掉快照后缀会让同一份目录里的 `Qwen3.8-Max` 与 `Qwen3.8-Max-0902` 撞成同名两行。
 */
import { describe, expect, it } from "vitest";

import { officialModelName } from "../../src/core/model-names";
import { parseCatalog as parseCommandCodeCatalog } from "../../src/vendors/commandcode/catalog";
import { parseCatalog as parseOpenDesignCatalog } from "../../src/vendors/opendesign/catalog";

describe("同一个模型，不同网关的 id 写法必须得到同一个展示名", () => {
  it("deepseek-v4.1-flash：带公司前缀与不带的写法归一", () => {
    const fromCommandCode = officialModelName("deepseek/deepseek-v4.1-flash");
    const fromOthers = officialModelName("deepseek-v4.1-flash");
    expect(fromCommandCode).toBe(fromOthers);
    expect(fromCommandCode).toBe("DeepSeek-V4.1-Flash");
  });

  it("公司前缀与快照后缀都不改变展示名", () => {
    expect(officialModelName("anthropic/claude-sonnet-4-5-20250929")).toBe(officialModelName("claude-sonnet-4-5"));
    expect(officialModelName("google/gemini-3.8-flash")).toBe(officialModelName("gemini-3.8-flash"));
  });

  it("id 自身的大小写不该让同一模型换个名字（LongCat 回归）", () => {
    expect(officialModelName("meituan/LongCat-2.0")).toBe(officialModelName("longcat-2.0"));
    expect(officialModelName("longcat-2.0")).toBe("LongCat-2.0");
  });

  it("厂商自带的标记不进展示名（`(CC)` / `(latest)` / `(exp)` 是网关的口径，不是模型名）", () => {
    expect(officialModelName("deepseek/deepseek-v4-pro")).toBe("DeepSeek-V4-Pro");
    expect(officialModelName("deepseek/deepseek-v4-flash-vision-exp")).not.toMatch(/\(CC\)|\(latest\)|\(exp\)/);
  });

  it("机器可读的 `:free` 限定不进展示名（它是价格标记，不是模型名）", () => {
    // 线上命令码目录里这两个 id 带着 `:free` 后缀：界面直接印出来是 `Ling-3.1-Flash:free`。
    expect(officialModelName("inclusionai/ling-3.1-flash:free")).toBe("Ling-3.1-Flash");
    expect(officialModelName("inclusionai/ling-3.0-flash-sante:free")).toBe("Ling-3.0-Flash-Sante");
  });

  it("同一模型在三家目录里产出的 name 完全相同（端到端，不是只测纯函数）", () => {
    // Command Code: 目录给了 name，但**不能**用它。
    const commandCode = parseCommandCodeCatalog({
      models: [{ id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (CC)" }],
    });
    // Open Design: 目录只给 id。
    const openDesign = parseOpenDesignCatalog({ data: [{ id: "deepseek-v4.1-flash" }] });
    expect(commandCode.entries[0]!.name).toBe(openDesign.entries[0]!.name);
    expect(commandCode.entries[0]!.name).toBe("DeepSeek-V4.1-Flash");
    // id 保持各自网关的写法：请求永远用 id，展示用 name。
    expect(commandCode.entries[0]!.id).toBe("deepseek/deepseek-v4.1-flash");
    expect(openDesign.entries[0]!.id).toBe("deepseek-v4.1-flash");
  });
});

describe("同一份目录里归一后撞名时，必须仍然可区分", () => {
  it("Qwen3.8-Max 与 Qwen3.8-Max-0902：用被去掉的快照后缀区分", () => {
    const parsed = parseCommandCodeCatalog({
      models: [
        { id: "Qwen/Qwen3.8-Max", name: "Qwen 3.8 Max (CC)" },
        { id: "Qwen/Qwen3.8-Max-0902", name: "Qwen 3.8 Max 0902 (CC)" },
      ],
    });
    const names = parsed.entries.map((entry) => entry.name);
    expect(names).toEqual(["Qwen3.8-Max", "Qwen3.8-Max (0902)"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("短名归「没带快照后缀」的那一个，哪怕它排在目录后面（线上命令码目录就是这个顺序）", () => {
    // 线上实测：命令码目录里 `Qwen/Qwen3.8-Max-0902` 排在 `Qwen/Qwen3.8-Max` **前面**。
    // 先到先得会让前者拿走干净名字，后者变成 `Qwen3.8-Max (2)` —— 而 opencode 目录里只有
    // 短名 `qwen3.8-max`，于是同一模型在两家叫不同名字（正是这次要修的病）。
    const parsed = parseCommandCodeCatalog({
      models: [
        { id: "Qwen/Qwen3.8-Max-0902", name: "Qwen 3.8 Max 0902 (CC)" },
        { id: "Qwen/Qwen3.8-Max", name: "Qwen 3.8 Max (CC)" },
      ],
    });
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["Qwen3.8-Max (0902)", "Qwen3.8-Max"]);
  });

  it("没有快照后缀可借时退回 id 的最后一段（仍然保证唯一）", () => {
    const parsed = parseCommandCodeCatalog({
      models: [
        { id: "vendor-a/same-model", name: "Same Model A (CC)" },
        { id: "vendor-b/same-model", name: "Same Model B (CC)" },
      ],
    });
    const names = parsed.entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("不撞名时一个字符都不改（不许给所有模型加尾巴）", () => {
    const parsed = parseCommandCodeCatalog({
      models: [
        { id: "gpt-5.5", name: "GPT-5.5 (CC)" },
        { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (CC)" },
      ],
    });
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["GPT-5.5", "Gemini-3.8-Flash"]);
  });

  it("`:free` 与不带限定的同名模型同时存在时，用 `(free)` 区分", () => {
    // `:free` 被规则摘掉后会撞名，所以撞名时必须把 free 加回括号里。
    // （注意 `-free` 是名字的一部分，不摘：`Step-5-Preview-Free` 本来就不撞。）
    const parsed = parseCommandCodeCatalog({
      models: [
        { id: "inclusionai/ling-3.1-flash", name: "Ling 3.1 Flash (CC)" },
        { id: "inclusionai/ling-3.1-flash:free", name: "Ling 3.1 Flash Free (CC)" },
      ],
    });
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["Ling-3.1-Flash", "Ling-3.1-Flash (free)"]);
  });
});
