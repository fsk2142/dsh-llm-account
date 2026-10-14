/**
 * 模型卡片（Task 7）：白名单（`visibleModels`）与逐模型显隐（`modelVisibility`）。
 *
 * 纯 props → 元素树（Ruling 22/29）。三条底线：
 * 1. 写入前必须**丢弃空串与纯空白**（`normalizeModels`，全局约束）；
 * 2. 生效时机由能力声明决定（`modelVisibilityWrite`）：`onSave` 走底部保存条，`immediate` 立刻写；
 * 3. 厂商没声明模型可见性（`VendorEntry.models` 缺席）时**整张卡片不渲染**（规格 §8）。
 *
 * 卡片不自己决定写哪里：它只把「哪个模型、什么值」报出去，由容器按 `modelEditTarget` 分流。
 * @module dsh-llm-account/src/client/models-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

/** 模型卡片的写模式（来自宿主的 `capabilities.modelVisibilityWrite`）。 */
export type ModelsWriteMode = "onSave" | "immediate";

/** 模型卡片属性。 */
export interface ModelsCardProps {
  t: (key: string) => string;
  /** 要展示的模型 id（白名单 ∪ 显式声明过可见性的模型，已清洗）。 */
  models: readonly string[];
  /** 逐模型显隐；缺省视为可见。 */
  visibility: Record<string, boolean>;
  /** 「添加模型」输入框的当前草稿（受控）。 */
  draft: string;
  /** 该厂商的写入时机。 */
  mode: ModelsWriteMode;
  onToggleModel: (model: string, visible: boolean) => void;
  onRemoveModel: (model: string) => void;
  onDraftChange: (value: string) => void;
  onAddModel: (model: string) => void;
}

/**
 * 模型卡片。
 * @param props - 见 {@link ModelsCardProps}。
 * @returns 元素树。
 */
export function ModelsCard(props: ModelsCardProps): ReactElement {
  const { t } = props;
  return createElement(
    "section",
    { "data-card": "models" },
    createElement("h2", null, t("models.title")),
    // 提示必须与真实行为一致：立即生效时不该再出现「保存后生效」。
    createElement("small", { "data-models-mode": props.mode }, props.mode === "immediate" ? t("models.immediate") : t("models.onSave")),
    ...(props.models.length === 0 ? [createElement("p", { key: "empty" }, t("models.empty"))] : []),
    ...props.models.map((model) => modelRow(props, model)),
    addRow(props),
  );
}

/** 一行模型：名称 + 可见开关 + 移除。 */
function modelRow(props: ModelsCardProps, model: string): ReactNode {
  const { t } = props;
  // 只有显式 `false` 才算不可见（与宿主侧 `modelVisibility` 的语义一致）。
  const visible = props.visibility[model] !== false;
  return createElement(
    "div",
    { key: model, "data-model": model },
    createElement("span", { "data-model-label": model }, model),
    createElement("input", {
      "data-model-visible": model,
      type: "checkbox",
      checked: visible,
      onChange: (event: { target?: { checked?: boolean } }) => props.onToggleModel(model, event.target?.checked === true),
    }),
    createElement("button", { type: "button", "data-model-remove": model, onClick: () => props.onRemoveModel(model) }, t("models.remove")),
  );
}

/** 「添加模型」行：受控输入 + 提交。空白草稿时按钮禁用。 */
function addRow(props: ModelsCardProps): ReactNode {
  const { t } = props;
  const submit = (): void => props.onAddModel(props.draft);
  return createElement(
    "div",
    { "data-card": "models-add" },
    createElement("input", {
      "data-model-draft": "true",
      type: "text",
      value: props.draft,
      placeholder: t("models.placeholder"),
      onChange: (event: { target?: { value?: string } }) => props.onDraftChange(event.target?.value ?? ""),
    }),
    createElement(
      "button",
      {
        type: "button",
        "data-model-add": "true",
        // 空白草稿不提交：它注定会被 `normalizeModels` 丢掉。
        disabled: props.draft.trim() === "",
        onClick: submit,
      },
      t("models.add"),
    ),
  );
}
