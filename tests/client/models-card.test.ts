/**
 * Task 7 测试：模型卡片（可见性与白名单）。
 *
 * 计划 Step 1 的三条：写 `visibleModels` 前**丢弃空串与纯空白**；按 `modelVisibilityWrite` 能力区分
 * 「保存后生效」与「立即生效」；厂商不支持的卡片**不渲染**。
 *
 * 卡片同样是纯 props → 元素树（Ruling 22/29），用户的模型编辑住在页面状态里。
 */
import { expect, it, vi } from "vitest";

import { dictionaryOf } from "../../src/client/copy";
import { ModelsCard, type ModelsCardProps } from "../../src/client/models-card";
import { applyModelEdit, modelEditTarget, normalizeModels, vendorCardKinds } from "../../src/client/page-state";
import type { VendorEntry } from "../../src/client/registry";
import type { StubElement } from "../support/react-stub";

/** 展平元素树。 */
function elementsOf(node: unknown): StubElement[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => elementsOf(child));
  const element = node as StubElement;
  if (!("props" in element) || !("type" in element)) return [];
  return [element, ...elementsOf(element.props.children)];
}

/** 树里所有文本。 */
function textsOf(node: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value).trim());
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

/** 渲染一次卡片。 */
function renderCard(overrides: Partial<ModelsCardProps> & Pick<ModelsCardProps, "mode">): {
  tree: StubElement;
  props: ModelsCardProps;
} {
  const props: ModelsCardProps = {
    t: dictionaryOf("zh"),
    models: ["m1", "m2"],
    visibility: {},
    draft: "",
    filter: "",
    onFilterChange: vi.fn(),
    onToggleModel: vi.fn(),
    onRemoveModel: vi.fn(),
    onDraftChange: vi.fn(),
    onAddModel: vi.fn(),
    ...overrides,
  };
  return { tree: ModelsCard(props), props };
}

/** 触发回调。 */
function fire(element: StubElement, name: string, event: unknown = {}): void {
  const handler = element.props[name];
  expect(typeof handler, `${name} handler`).toBe("function");
  (handler as (value: unknown) => void)(event);
}

// —— 白名单清洗：丢弃空串与纯空白 ——

it("normalizeModels 丢弃空串与纯空白，并去掉首尾空白、去重", () => {
  // `[""]` 是「非空白名单」——它会让所有模型消失，必须被丢掉。
  expect(normalizeModels([""])).toEqual([]);
  expect(normalizeModels(["   ", "\t", "\n"])).toEqual([]);
  expect(normalizeModels([" m1 ", ""])).toEqual(["m1"]);
  expect(normalizeModels(["m1", "m1", " m1 "])).toEqual(["m1"]);
  expect(normalizeModels([1, null, undefined, "m2"])).toEqual(["m2"]);
  expect(normalizeModels(undefined)).toEqual([]);
});

// —— 卡片渲染 ——

it("每个模型一行：显示名称、可见开关、移除按钮", () => {
  const { tree } = renderCard({ mode: "onSave", models: ["m1", "m2"], visibility: { m2: false } });
  const rows = elementsOf(tree).filter((element) => element.props["data-model"] !== undefined);

  expect(rows.map((element) => element.props["data-model"])).toEqual(["m1", "m2"]);
  const toggles = elementsOf(rows[0]!).find((element) => element.props["data-model-visible"] !== undefined)!;
  expect(toggles.props.checked).toBe(false);
  // 默认关闭；只有显式 true 或白名单命中才开启。
  const second = elementsOf(rows[1]!).find((element) => element.props["data-model-visible"] !== undefined)!;
  expect(second.props.checked).toBe(false);
});

it("切换某个模型的可见性把模型与目标值报出去", () => {
  const { tree, props } = renderCard({ mode: "onSave" });
  const toggle = elementsOf(tree).find((element) => element.props["data-model-visible"] !== undefined)!;
  fire(toggle, "onChange", { target: { checked: false } });
  expect(props.onToggleModel).toHaveBeenCalledWith("m1", false);

  const remove = elementsOf(tree).find((element) => element.props["data-model-remove"] !== undefined)!;
  fire(remove, "onClick");
  expect(props.onRemoveModel).toHaveBeenCalledWith("m1");
});

it("添加模型是受控输入：变化报出去，且**空白输入不提交**", () => {
  const blank = renderCard({ mode: "onSave", draft: "   " });
  const input = elementsOf(blank.tree).find((element) => element.props["data-model-draft"] !== undefined)!;
  expect(input.props.value).toBe("   ");
  fire(input, "onChange", { target: { value: "m3" } });
  expect(blank.props.onDraftChange).toHaveBeenCalledWith("m3");

  // 空白草稿：按钮禁用（不发一次注定被丢掉的写入）。
  const addButton = elementsOf(blank.tree).find((element) => element.props["data-model-add"] !== undefined)!;
  expect(addButton.props.disabled).toBe(true);
  // 有内容时可以提交。
  const filled = renderCard({ mode: "onSave", draft: "m3" });
  expect(elementsOf(filled.tree).find((element) => element.props["data-model-add"] !== undefined)!.props.disabled).toBe(false);
  fire(elementsOf(filled.tree).find((element) => element.props["data-model-add"] !== undefined)!, "onClick");
  expect(filled.props.onAddModel).toHaveBeenCalledWith("m3");
});

// —— 生效时机按能力 ——

it("写模式决定提示与提交时机：onSave 提示「保存后生效」，immediate 提示「立即生效」", () => {
  const t = dictionaryOf("zh");
  const onSave = renderCard({ mode: "onSave" });
  expect(textsOf(onSave.tree)).toContain(t("models.onSave"));
  expect(textsOf(onSave.tree)).not.toContain(t("models.immediate"));

  const immediate = renderCard({ mode: "immediate" });
  expect(textsOf(immediate.tree)).toContain(t("models.immediate"));
  // 立即生效时不该再出现「保存后生效」的提示，否则用户不知道该不该按保存。
  expect(textsOf(immediate.tree)).not.toContain(t("models.onSave"));
});

it("没有模型时给出说明，而不是一张空卡片", () => {
  const { tree } = renderCard({ mode: "onSave", models: [] });
  expect(textsOf(tree)).toContain(dictionaryOf("zh")("models.empty"));
  expect(elementsOf(tree).filter((element) => element.props["data-model"] !== undefined)).toEqual([]);
});

// —— 编辑语义与生效时机 ——

it("applyModelEdit：添加/移除/切换一起维护白名单与显隐，且空白永不写回", () => {
  // 添加：进白名单并显式可见。
  expect(applyModelEdit({ visible: ["m1"], visibility: { m1: false } }, { kind: "add", model: " m2 " })).toEqual({
    visibleModels: ["m1", "m2"],
    modelVisibility: { m1: false, m2: true },
  });
  // 添加空白：白名单不变（不写回空串），也不会多出一条显隐记录。
  expect(applyModelEdit({ visible: ["m1"], visibility: {} }, { kind: "add", model: "   " })).toEqual({
    visibleModels: ["m1"],
    modelVisibility: {},
  });
  // 切换：只动显隐。
  expect(applyModelEdit({ visible: ["m1"], visibility: {} }, { kind: "toggle", model: "m1", visible: false })).toEqual({
    visibleModels: ["m1"],
    modelVisibility: { m1: false },
  });
  // 移除：白名单与显隐条目一起清掉（否则它又会回到列表里）。
  expect(applyModelEdit({ visible: ["m1", "m2"], visibility: { m2: false } }, { kind: "remove", model: "m2" })).toEqual({
    visibleModels: ["m1"],
    modelVisibility: {},
  });
  // 形状不可信时先清洗：非数组白名单当作空、非对象显隐当作空。
  expect(applyModelEdit({ visible: "m1", visibility: [] }, { kind: "add", model: "m2" })).toEqual({
    visibleModels: ["m2"],
    modelVisibility: { m2: true },
  });
});

it("modelEditTarget：按能力把编辑分流到草稿或立刻写", () => {
  // onSave（Command Code）：进草稿，等底部保存条。
  expect(modelEditTarget("onSave")).toBe("draft");
  // immediate（OpenCode）：立刻写。
  expect(modelEditTarget("immediate")).toBe("now");
});

it("厂商不支持的卡片不渲染：没声明 models 的厂商没有专属卡片", () => {
  const withModels: VendorEntry = { ns: "llm-commandcode", rowIds: ["llm-commandcode"], providerId: "commandcode", order: 1, labelKey: "vendor.commandcode", cards: [], models: { visible: "visibleModels", visibility: "modelVisibility" } };
  const withoutModels: VendorEntry = { ...withModels, models: undefined };

  expect(vendorCardKinds(withModels)).toEqual(["models"]);
  expect(vendorCardKinds(withoutModels)).toEqual([]);
});

it("目录里的模型也出现在列表里，勾选状态按可见性规则算（白名单外 = 未勾选）", () => {
  const { tree, props } = renderCard({ mode: "onSave", models: ["m1", "m2"], visibleModels: ["m1"] });
  const toggles = elementsOf(tree).filter((element) => element.props["data-model-visible"] !== undefined);
  expect(toggles.map((element) => [element.props["data-model-visible"], element.props.checked])).toEqual([
    ["m1", true],
    ["m2", false],
  ]);
  // m1 出现在设置里 → 有移除；m2 只是目录项 → 没有可删的记录。
  expect(
    elementsOf(tree)
      .filter((element) => element.props["data-model-remove"] !== undefined)
      .map((element) => element.props["data-model-remove"]),
  ).toEqual(["m1"]);
  fire(toggles[1]!, "onChange", { target: { checked: true } });
  expect(props.onToggleModel).toHaveBeenCalledWith("m2", true);
});

it("目录读取中/失败时不谎报空态：显示加载或原因 + 重试", () => {
  const loading = renderCard({ mode: "onSave", models: [], catalogLoading: true });
  expect(elementsOf(loading.tree).some((element) => element.props["data-models-loading"] === "true")).toBe(true);
  expect(textsOf(loading.tree)).not.toContain(dictionaryOf("zh")("models.empty"));

  const onRetry = vi.fn();
  const failed = renderCard({ mode: "onSave", models: [], catalogFailure: "models: boom", onRetryCatalog: onRetry });
  expect(textsOf(failed.tree).join(" ")).toContain("boom");
  expect(textsOf(failed.tree)).not.toContain(dictionaryOf("zh")("models.empty"));
  const retry = elementsOf(failed.tree).find((element) => element.props["data-model-catalog-retry"] !== undefined)!;
  fire(retry, "onClick");
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("模型按公司分组，免费组第一，并带折叠箭头", () => {
  const { tree } = renderCard({
    mode: "onSave",
    models: ["claude-haiku-5-5", "gpt-6-luna", "beam-free"],
    modelInfo: { "claude-haiku-5-5": { company: "anthropic" }, "gpt-6-luna": { company: "openai" }, "beam-free": { free: true } },
  });
  const groups = elementsOf(tree)
    .filter((element) => element.props["data-model-group"] !== undefined)
    .map((element) => element.props["data-model-group"]);
  expect(groups).toEqual(["free", "anthropic", "openai"]);
  const labels = elementsOf(tree)
    .filter((element) => element.props["data-model-group"] !== undefined)
    .map((element) => textsOf(element)[0]);
  expect(labels).toEqual(["免费模型", "Anthropic", "OpenAI"]);
  // 整张卡片是可收起的 details；箭头就是 summary 的 chevron。
  const collapse = elementsOf(tree).find((element) => element.props["data-model-collapse"] === "true");
  expect(collapse).toBeDefined();
  const details = elementsOf(tree).find((element) => element.props["data-card"] === "models");
  expect(details?.props.open).toBe(true);
});
