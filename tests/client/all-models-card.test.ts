/**
 * 全局模型卡片：两家的模型放在同一张卡片，按公司/免费分组，行上标供应商。
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
    onAdd: vi.fn(),
    draft: "",
    onDraftChange: vi.fn(),
    draftVendor: "dsh-opencode-go",
    onDraftVendorChange: vi.fn(),
    ...overrides,
  };
  return { tree: AllModelsCard(props), props };
}

it("两家的模型平铺分组：免费组第一，公司组按出现顺序，行上带供应商", () => {
  const { tree } = render();
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-all-model-group"] !== undefined)
    .map((element) => element.props["data-all-model-group"]);
  expect(groups).toEqual(["free", "anthropic", "openai"]);
  const rows = elementsOf(tree).filter((element) => element.props["data-all-model"] !== undefined);
  expect(rows.map((element) => element.props["data-all-model"])).toEqual([
    "dsh-opencode-go:beam-free",
    "commandcode:claude-haiku-5-5",
    "dsh-opencode-go:gpt-6-luna",
  ]);
  const vendors = elementsOf(tree)
    .filter((element) => element.props["data-model-vendor"] !== undefined)
    .map((element) => element.props["data-model-vendor"]);
  expect(vendors).toEqual(["dsh-opencode-go", "commandcode", "dsh-opencode-go"]);
  expect(textsOf(tree)).toContain("全部模型");
});

it("勾选/移除/添加都路由到模型所属厂商；可见性按各自设置", () => {
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

  const add = elementsOf(tree).find((element) => element.props["data-all-model-add"] === "true")!;
  expect(add.props.disabled).toBe(true);
  const withDraft = render({ draft: "my-model" });
  (elementsOf(withDraft.tree).find((element) => element.props["data-all-model-add"] === "true")!.props.onClick as () => void)();
  expect(withDraft.props.onAdd).toHaveBeenCalledWith("dsh-opencode-go", "my-model");
});

it("搜索只过滤行；整张卡片可折叠", () => {
  const { tree } = render({ filter: "beam" });
  const rows = elementsOf(tree).filter((element) => element.props["data-all-model"] !== undefined);
  expect(rows.map((element) => element.props["data-all-model"])).toEqual(["dsh-opencode-go:beam-free"]);
  expect(elementsOf(tree).some((element) => element.props["data-all-model-collapse"] === "true")).toBe(true);
});
