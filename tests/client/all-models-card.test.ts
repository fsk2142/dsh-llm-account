/**
 * 全局模型卡片：供应商 → 模型公司两级分组，两级都能折叠/批量隐藏。
 */
import { expect, it, vi } from "vitest";

import { AllModelsCard, type AllModelsCardProps } from "../../src/client/all-models-card";
import { dictionaryOf } from "../../src/client/copy";
import type { StubElement } from "../support/react-stub";

function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value !== null && typeof value === "object" && "props" in (value as StubElement)) {
      walk((value as StubElement).props.children);
    }
  };
  walk(node);
  return out;
}

function render(overrides: Partial<AllModelsCardProps> = {}): { tree: StubElement; props: AllModelsCardProps } {
  const props: AllModelsCardProps = {
    t: dictionaryOf("zh"),
    vendors: [
      {
        vendor: "commandcode",
        label: "Command Code",
        catalog: [{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5", company: "anthropic" }],
        visibleModels: [],
        visibility: {},
      },
      {
        vendor: "dsh-opencode-go",
        label: "OpenCode",
        catalog: [
          { id: "gpt-6-luna", name: "GPT-6 Luna", company: "openai" },
          { id: "beam-free", name: "Beam Free", free: true },
        ],
        visibleModels: ["gpt-6-luna"],
        visibility: { "gpt-6-luna": false },
      },
    ],
    filter: "",
    onFilterChange: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
    onGroupVisibility: vi.fn(),
    onAdd: vi.fn(),
    draft: "",
    onDraftChange: vi.fn(),
    draftVendor: "dsh-opencode-go",
    onDraftVendorChange: vi.fn(),
    ...overrides,
  };
  return { tree: AllModelsCard(props), props };
}

it("先按供应商分组，再按模型公司/免费分组；两级都有折叠箭头", () => {
  const { tree } = render();
  const vendors = elementsOf(tree)
    .filter((element) => element.props["data-all-model-vendor-group"] !== undefined)
    .map((element) => element.props["data-all-model-vendor-group"]);
  expect(vendors).toEqual(["commandcode", "dsh-opencode-go"]);
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-all-model-group"] !== undefined)
    .map((element) => element.props["data-all-model-group"]);
  expect(groups).toEqual(["commandcode:anthropic", "dsh-opencode-go:free", "dsh-opencode-go:openai"]);
  expect(elementsOf(tree).filter((element) => element.props["data-all-model-vendor-collapse"] !== undefined)).toHaveLength(2);
  expect(elementsOf(tree).filter((element) => element.props["data-all-model-group-collapse"] !== undefined)).toHaveLength(3);
  const rows = elementsOf(tree).filter((element) => element.props["data-all-model"] !== undefined);
  expect(rows.map((element) => element.props["data-all-model"])).toEqual([
    "commandcode:claude-haiku-5-5",
    "dsh-opencode-go:beam-free",
    "dsh-opencode-go:gpt-6-luna",
  ]);
});

it("公司分组可以一次性开启/关闭全组；供应商分组也能批量", () => {
  const { tree, props } = render();
  // 默认关闭：commandcode/anthropic 全不可见 → 按钮是「全开本组」，点击传 true。
  const showGroupButton = elementsOf(tree).find(
    (element) => element.props["data-all-model-group-toggle"] === "commandcode:anthropic",
  )!;
  (showGroupButton.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("commandcode", ["claude-haiku-5-5"], true);

  const showVendorButton = elementsOf(tree).find(
    (element) => element.props["data-all-model-vendor-toggle"] === "commandcode",
  )!;
  (showVendorButton.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("commandcode", ["claude-haiku-5-5"], true);

  const showOpenai = elementsOf(tree).find(
    (element) => element.props["data-all-model-group-toggle"] === "dsh-opencode-go:openai",
  )!;
  (showOpenai.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("dsh-opencode-go", ["gpt-6-luna"], true);
});

it("勾选/移除/添加路由到所属厂商；搜索只留匹配行", () => {
  const { tree, props } = render();
  const gptToggle = elementsOf(tree).find(
    (element) => element.props["data-all-model-visible"] === "dsh-opencode-go:gpt-6-luna",
  )!;
  expect(gptToggle.props.checked).toBe(false);
  (gptToggle.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  expect(props.onToggle).toHaveBeenCalledWith("dsh-opencode-go", "gpt-6-luna", true);

  const remove = elementsOf(tree).find(
    (element) => element.props["data-all-model-remove"] === "dsh-opencode-go:gpt-6-luna",
  )!;
  (remove.props.onClick as () => void)();
  expect(props.onRemove).toHaveBeenCalledWith("dsh-opencode-go", "gpt-6-luna");

  const searched = render({ filter: "beam" });
  expect(
    elementsOf(searched.tree)
      .filter((element) => element.props["data-all-model"] !== undefined)
      .map((element) => element.props["data-all-model"]),
  ).toEqual(["dsh-opencode-go:beam-free"]);
  expect(textsOf(searched.tree)).toContain("全部模型");
});
