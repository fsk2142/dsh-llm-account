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
    onRestore: vi.fn(),
    onRefresh: vi.fn(),
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

it("两家模型合并后按公司/免费分组，行上标供应商；分组跨厂商", () => {
  const { tree } = render();
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-all-model-group"] !== undefined)
    .map((element) => element.props["data-all-model-group"]);
  expect(groups).toEqual(["free", "anthropic", "openai"]);
  expect(elementsOf(tree).filter((element) => element.props["data-all-model-group-collapse"] !== undefined)).toHaveLength(3);
  // 没有供应商一级分组：Command Code / OpenCode 的模型在同一张列表里。
  expect(elementsOf(tree).some((element) => element.props["data-all-model-vendor-group"] !== undefined)).toBe(false);
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
});

it("公司分组可以一次性开启/关闭全组（跨厂商按厂商拆分）", () => {
  const { tree, props } = render();
  // 默认关闭：anthropic 全不可见 → 按钮是「全开本组」，点击按厂商写回。
  const showAnthropic = elementsOf(tree).find(
    (element) => element.props["data-all-model-group-toggle"] === "anthropic",
  )!;
  (showAnthropic.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("commandcode", ["claude-haiku-5-5"], true);

  const showOpenai = elementsOf(tree).find((element) => element.props["data-all-model-group-toggle"] === "openai")!;
  (showOpenai.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("dsh-opencode-go", ["gpt-6-luna"], true);
});

it("同一家公司的模型跨供应商合并到一组，组开关按厂商分别写回", () => {
  const { tree, props } = render({
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
        catalog: [{ id: "claude-opus-5", name: "Claude Opus 5", company: "anthropic" }],
        visibleModels: [],
        visibility: {},
      },
    ],
  });
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-all-model-group"] !== undefined)
    .map((element) => element.props["data-all-model-group"]);
  expect(groups).toEqual(["anthropic"]);
  expect(
    elementsOf(tree)
      .filter((element) => element.props["data-all-model"] !== undefined)
      .map((element) => element.props["data-all-model"]),
  ).toEqual(["commandcode:claude-haiku-5-5", "dsh-opencode-go:claude-opus-5"]);

  const toggle = elementsOf(tree).find((element) => element.props["data-all-model-group-toggle"] === "anthropic")!;
  (toggle.props.onClick as () => void)();
  expect(props.onGroupVisibility).toHaveBeenCalledWith("commandcode", ["claude-haiku-5-5"], true);
  expect(props.onGroupVisibility).toHaveBeenCalledWith("dsh-opencode-go", ["claude-opus-5"], true);
});

it("移除的模型不再显示；刷新按钮回调；新模型带 New 标记", () => {
  const { tree } = render({
    vendors: [
      {
        vendor: "commandcode",
        label: "Command Code",
        catalog: [
          { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", company: "anthropic" },
          { id: "gpt-gone", name: "Gone", company: "openai" },
        ],
        visibleModels: [],
        visibility: {},
        removedModels: ["gpt-gone"],
        newModels: ["claude-haiku-5-5"],
      },
    ],
  });
  const rows = elementsOf(tree)
    .filter((element) => element.props["data-all-model"] !== undefined)
    .map((element) => element.props["data-all-model"]);
  expect(rows).toEqual(["commandcode:claude-haiku-5-5"]);
  expect(elementsOf(tree).some((element) => element.props["data-model-new"] !== undefined)).toBe(true);
  // 每一行都有移除按钮（目录项也能移除），所以开关列对齐。
  expect(elementsOf(tree).some((element) => element.props["data-all-model-remove"] !== undefined)).toBe(true);
});

it("重新获取模型按钮触发一次刷新", () => {
  const { tree, props } = render();
  const refresh = elementsOf(tree).find((element) => element.props["data-all-model-refresh"] !== undefined)!;
  (refresh.props.onClick as () => void)();
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});

it("名称带 Free 的模型先归免费组；已移除的模型有恢复入口", () => {
  const { tree, props } = render({
    vendors: [
      {
        vendor: "commandcode",
        label: "Command Code",
        catalog: [{ id: "glm-5.2-fast", name: "GLM-5.2 Free", company: "zhipuai" }],
        visibleModels: [],
        visibility: {},
        removedModels: ["old-model"],
      },
    ],
  });
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-all-model-group"] !== undefined)
    .map((element) => element.props["data-all-model-group"]);
  expect(groups[0]).toBe("free");
  expect(elementsOf(tree).some((element) => element.props["data-all-models-removed"] !== undefined)).toBe(true);
  const restore = elementsOf(tree).find((element) => element.props["data-all-model-restore"] === "commandcode:old-model")!;
  (restore.props.onClick as () => void)();
  expect(props.onRestore).toHaveBeenCalledWith("commandcode", "old-model");
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
