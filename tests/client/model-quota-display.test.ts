/**
 * 模型行上的「这个模型在这个套餐下能用多少额度」。
 *
 * 用户指定的位置是 `[模型名] ...... [额度信息] [开关]`，所以这里除了「显示什么」，
 * 还要钉住「摆在开关左边」这个顺序 —— 摆错位置用户会看成另一个模型的额度。
 *
 * 另一半是**查不到就不渲染**：官方表里没有的组合留空，绝不编数字。
 */
import { describe, expect, it, vi } from "vitest";

import { accountRows } from "../../src/client/account-card";
import { dictionaryOf } from "../../src/client/copy";
import type { AccountUsageStatus } from "../../src/client/usage-contract";

/** 造一个账号（只有模型相关字段会用到）。 */
function accountOf(): AccountUsageStatus {
  return {
    ref: "acct",
    label: "acct",
    configured: true,
    active: true,
    effective: true,
  } as AccountUsageStatus;
}

/** 渲染一个账号的模型区，传入指定的额度查询函数。 */
function renderWith(modelQuotaOf: ((account: AccountUsageStatus, modelId: string) => string | undefined) | undefined) {
  return accountRows({
    t: dictionaryOf("zh"),
    status: { vendor: "commandcode", accounts: [accountOf()], failures: [] } as never,
    catalog: [
      { id: "minimax-m3", name: "MiniMax M3" },
      { id: "mimo-v2.5", name: "MiMo V2.5" },
    ],
    modelRules: [],
    onSetAccountModels: vi.fn(),
    ...(modelQuotaOf === undefined ? {} : { modelQuotaOf }),
  } as never);
}

/** 收集树里所有元素。 */
function elements(node: unknown): { type: unknown; props: Record<string, unknown> }[] {
  const out: { type: unknown; props: Record<string, unknown> }[] = [];
  const walk = (value: unknown): void => {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    const element = value as { type?: unknown; props?: Record<string, unknown> };
    if (element.props === undefined) return;
    out.push({ type: element.type, props: element.props });
    walk(element.props.children);
  };
  walk(node);
  return out;
}

describe("模型行上的额度信息", () => {
  it("额度文字渲染出来（带 data-model-quota 便于定位）", () => {
    const tree = renderWith((_account, modelId) => (modelId === "minimax-m3" ? "$47" : undefined));
    const node = elements(tree).find((element) => element.props["data-model-quota"] === "acct:minimax-m3");
    expect(node).toBeDefined();
    expect(node?.props.children).toBe("$47");
  });

  it("**额度摆在开关左边**：同一行里额度元素的序号小于开关", () => {
    // 需求的顺序是 `[模型名] ...... [额度信息] [开关]`。
    // 额度如果跑到开关右边（或与开关重叠），看起来就像在描述下一个模型。
    const tree = renderWith((_account, modelId) => (modelId === "minimax-m3" ? "$47" : undefined));
    // 找承载这一行的那层 label：它的 children 里同时有 data-model-quota 与 data-account-model。
    const label = elements(tree).find((element) => {
      const children = element.props.children;
      if (!Array.isArray(children)) return false;
      const hasQuota = children.some(
        (child) => (child as { props?: Record<string, unknown> })?.props?.["data-model-quota"] !== undefined,
      );
      const hasToggle = children.some(
        (child) => (child as { props?: Record<string, unknown> })?.props?.["data-account-model"] !== undefined,
      );
      return hasQuota && hasToggle;
    });
    expect(label).toBeDefined();
    const children = label?.props.children as unknown[];
    const quotaIndex = children.findIndex(
      (child) => (child as { props?: Record<string, unknown> })?.props?.["data-model-quota"] !== undefined,
    );
    const toggleIndex = children.findIndex(
      (child) => (child as { props?: Record<string, unknown> })?.props?.["data-account-model"] !== undefined,
    );
    expect(quotaIndex).toBeGreaterThan(-1);
    expect(toggleIndex).toBeGreaterThan(-1);
    expect(quotaIndex).toBeLessThan(toggleIndex);
  });

  it("**查不到时显示「未知」**（留空看起来像坏了）", () => {
    const tree = renderWith(() => undefined);
    const nodes = elements(tree).filter((element) => element.props["data-model-quota"] !== undefined);
    // 每个模型都有一行「未知」，而不是留空。
    expect(nodes).toHaveLength(2);
    for (const node of nodes) expect(node.props.children).toBe("未知");
  });

  it("容器没提供查询函数时也显示「未知」（不是空白）", () => {
    const tree = renderWith(undefined);
    expect(elements(tree).some((element) => element.props["data-account-model"] === "acct:minimax-m3")).toBe(true);
    const quota = elements(tree).find(
      (element) => element.props["data-model-quota"] === "acct:minimax-m3",
    );
    expect(quota?.props.children).toBe("未知");
  });

  it("不同模型各显示各自的值", () => {
    const values: Record<string, string> = { "minimax-m3": "$47", "mimo-v2.5": "约 $100" };
    const tree = renderWith((_account, modelId) => values[modelId]);
    const got = elements(tree)
      .filter((element) => element.props["data-model-quota"] !== undefined)
      .map((element) => element.props.children);
    expect(got).toEqual(["$47", "约 $100"]);
  });
});
