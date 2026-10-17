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

import { CSS_CLASS } from "./css";
import { RemoveIcon } from "./icons";

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
  /** 搜索框里的关键词（受控，空串 = 不过滤）。 */
  filter: string;
  onFilterChange: (value: string) => void;
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
  // 过滤是**纯展示**的：搜索框只缩小要渲染的行，一个模型都不会因此从设置里消失。
  // 关键词为空时列表与过滤前逐字相同（没有任何「默认排序」偷偷生效）。
  const needle = props.filter.trim().toLowerCase();
  const shown = needle === "" ? props.models : props.models.filter((model) => model.toLowerCase().includes(needle));
  const filtered = needle !== "" && shown.length !== props.models.length;
  return createElement(
    "section",
    { "data-card": "models", className: CSS_CLASS.card },
    createElement("h2", null, t("models.title")),
    // 提示必须与真实行为一致：立即生效时不该再出现「保存后生效」。
    createElement("small", { "data-models-mode": props.mode }, props.mode === "immediate" ? t("models.immediate") : t("models.onSave")),
    props.models.length === 0
      ? createElement("p", { key: "empty", className: CSS_CLASS.empty }, t("models.empty"))
      : createElement(
          "div",
          { key: "search", className: CSS_CLASS.search },
          createElement("input", {
            "data-model-filter": "true",
            type: "text",
            value: props.filter,
            placeholder: t("models.searchPlaceholder"),
            onChange: (event: { target?: { value?: string } }) => props.onFilterChange(event.target?.value ?? ""),
          }),
        ),
    ...(filtered
      ? [
          createElement(
            "small",
            { key: "count", "data-model-count": `${shown.length}/${props.models.length}`, className: CSS_CLASS.searchCount },
            t("models.filtered").replace("{n}", String(shown.length)).replace("{total}", String(props.models.length)),
          ),
        ]
      : []),
    ...(needle !== "" && shown.length === 0 ? [createElement("p", { key: "no-match", className: CSS_CLASS.empty }, t("models.noMatch"))] : []),
    ...shown.map((model) => modelRow(props, model)),
    addRow(props),
  );
}

/** 一行模型：名称 + 可见开关 + 移除。 */
function modelRow(props: ModelsCardProps, model: string): ReactNode {
  const { t } = props;
  // 只有显式 `false` 才算不可见（与宿主侧 `modelVisibility` 的语义一致）。
  const visible = props.visibility[model] !== false;
  const removeLabel = t("models.remove");
  return createElement(
    "div",
    { key: model, "data-model": model, className: CSS_CLASS.field },
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement("span", { "data-model-label": model, className: CSS_CLASS.mono }, model),
    ),
    createElement("input", {
      "data-model-visible": model,
      type: "checkbox",
      className: CSS_CLASS.toggle,
      checked: visible,
      onChange: (event: { target?: { checked?: boolean } }) => props.onToggleModel(model, event.target?.checked === true),
    }),
    createElement(
      "button",
      {
        type: "button",
        "data-model-remove": model,
        title: removeLabel,
        "aria-label": removeLabel,
        className: CSS_CLASS.iconDanger,
        onClick: () => props.onRemoveModel(model),
      },
      createElement(RemoveIcon, null),
    ),
  );
}

/** 「添加模型」行：受控输入 + 提交。空白草稿时按钮禁用。 */
function addRow(props: ModelsCardProps): ReactNode {
  const { t } = props;
  const submit = (): void => props.onAddModel(props.draft);
  return createElement(
    "div",
    { "data-card": "models-add", className: CSS_CLASS.actions },
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
        className: CSS_CLASS.buttonPrimary,
        // 空白草稿不提交：它注定会被 `normalizeModels` 丢掉。
        disabled: props.draft.trim() === "",
        onClick: submit,
      },
      t("models.add"),
    ),
  );
}
