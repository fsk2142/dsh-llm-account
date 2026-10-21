/**
 * 按套餐过滤模型列表（用户 2026-10-21 要求）。
 *
 * 用户原话：「因为套餐不同，能够使用的模型和模型用量也不同，因此模型获取的时候要
 * 根据订阅的套餐来获取，不要把不是本套餐可用的模型也放到模型中」。
 *
 * 这里钉住三件最要紧的事：
 * 1. **`false` 才隐藏，`undefined` 照常显示** —— 没有官方清单就藏模型是最坏的选择，
 *    用户会以为插件坏了；
 * 2. **已勾选的模型不能被隐藏** —— 那是用户此前的选择；
 * 3. 标题里的分母要跟着过滤后的数量走，否则「1/96」与只画 71 行的列表对不上。
 */
import { describe, expect, it, vi } from "vitest";

import { accountRows } from "../../src/client/account-card";
import { dictionaryOf } from "../../src/client/copy";
import type { AccountUsageStatus } from "../../src/client/usage-contract";

/** 造一个账号。 */
function accountOf(): AccountUsageStatus {
  return {
    ref: "acct",
    label: "sample-user",
    configured: true,
    active: true,
    effective: true,
  } as AccountUsageStatus;
}

/** 渲染模型区。 */
function render(options: {
  catalog: { id: string; name: string }[];
  available?: (account: AccountUsageStatus, modelId: string) => boolean | undefined;
  selected?: string[];
}) {
  return accountRows({
    t: dictionaryOf("zh"),
    status: { vendor: "commandcode", accounts: [accountOf()], failures: [] } as never,
    catalog: options.catalog,
    modelRules: [{ account: "acct", models: options.selected ?? [] }] as never,
    onSetAccountModels: vi.fn(),
    ...(options.available === undefined ? {} : { modelAvailable: options.available }),
  } as never);
}

/** 收集树里所有元素。 */
function elements(node: unknown): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = [];
  const walk = (value: unknown): void => {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const element = value as { props?: Record<string, unknown> };
    if (element.props === undefined) return;
    out.push({ props: element.props });
    walk(element.props.children);
  };
  walk(node);
  return out;
}

/** 列表里实际渲染出来的模型行。 */
function renderedModels(tree: unknown): string[] {
  return elements(tree)
    .filter((element) => typeof element.props["data-account-model"] === "string")
    .map((element) => String(element.props["data-account-model"]).split(":")[1] as string);
}

const CATALOG = [
  { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
  { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
  { id: "minimax-m3", name: "MiniMax M3" },
];

describe("按套餐过滤模型", () => {
  it("**返回 false 的模型被隐藏**", () => {
    // 官方：Claude Opus 需要 Pro 或 Max，GOAT 下不可用。
    const tree = render({
      catalog: CATALOG,
      available: (_account, id) => id !== "claude-opus-5.5",
    });
    const shown = renderedModels(tree);
    expect(shown).not.toContain("claude-opus-5.5");
    expect(shown).toContain("claude-sonnet-5.5");
    expect(shown).toContain("minimax-m3");
  });

  it("**返回 undefined 的模型照常显示**（没有官方清单时不能猜）", () => {
    const tree = render({ catalog: CATALOG, available: () => undefined });
    expect(renderedModels(tree)).toEqual(["claude-sonnet-5.5", "claude-opus-5.5", "minimax-m3"]);
  });

  it("容器没提供过滤函数时全部显示（老行为不变）", () => {
    const tree = render({ catalog: CATALOG });
    expect(renderedModels(tree)).toHaveLength(3);
  });

  it("**已勾选的模型即使被判定不可用也要保留**", () => {
    // 用户此前选过它；悄悄让一个已启用的模型消失，比留一行更糟。
    const tree = render({
      catalog: CATALOG,
      available: (_account, id) => id !== "claude-opus-5.5",
      selected: ["claude-opus-5.5"],
    });
    expect(renderedModels(tree)).toContain("claude-opus-5.5");
  });

  it("标题里的分母用**过滤后**的数量（否则与列表行数对不上）", () => {
    const tree = render({
      catalog: CATALOG,
      available: (_account, id) => id !== "claude-opus-5.5",
    });
    const summary = elements(tree).find(
      (element) => typeof element.props.children === "string" && String(element.props.children).includes("可用模型"),
    );
    expect(summary).toBeDefined();
    // 3 个里藏了 1 个 → 分母是 2。
    expect(String(summary?.props.children)).toContain("/2)");
  });
});
