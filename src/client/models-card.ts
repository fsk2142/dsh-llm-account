/**
 * 模型卡片（Task 7）：白名单（`visibleModels`）与逐模型显隐（`modelVisibility`）。
 *
 * 纯 props → 元素树（Ruling 22/29）。四条底线：
 * 1. 写入前必须**丢弃空串与纯空白**（`normalizeModels`，全局约束）；
 * 2. 生效时机由能力声明决定（`modelVisibilityWrite`）：`onSave` 走底部保存条，`immediate` 立刻写；
 * 3. 厂商没声明模型可见性（`VendorEntry.models` 缺席）时**整张卡片不渲染**（规格 §8）；
 * 4. **隐藏的模型也必须出现在列表里**：目录（厂商全量）∪ 已配置项一起渲染，否则用户没有入口
 *    把隐藏的模型重新勾上。勾选状态走 `core/catalog` 的同一份可见性规则（显式布尔 → 白名单 →
 *    全可见），与宿主模型选择器的过滤永远一致。
 *
 * 卡片不自己决定写哪里：它只把「哪个模型、什么值」报出去，由容器按 `modelEditTarget` 分流。
 * @module dsh-llm-account/src/client/models-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { isModelIdVisible } from "../core/catalog";
import { companyLabelOf, groupModels } from "../core/model-groups";
import { CSS_CLASS, cls } from "./css";
import { failureListText } from "./failure-text";
import { ChevronIcon, RemoveIcon } from "./icons";

/** 模型卡片的写模式（来自宿主的 `capabilities.modelVisibilityWrite`）。 */
export type ModelsWriteMode = "onSave" | "immediate";

/** 模型卡片属性。 */
export interface ModelsCardProps {
  t: (key: string) => string;
  /**
   * 要展示的模型 id：厂商目录 ∪ 白名单 ∪ 显式声明过可见性的模型（已去重）。
   *
   * 目录项可能不在设置里 —— 那正是「勾选显示/隐藏」的入口；已配置项可能不在目录里 ——
   * 手工添加的模型也必须能继续管理。
   */
  models: readonly string[];
  /** 逐模型显隐；缺省视为可见。 */
  visibility: Record<string, boolean>;
  /** 白名单；缺省或为空表示不按白名单限制。 */
  visibleModels?: readonly string[];
  /** 目录带下来的公司/免费标记（分组用）；缺省时按 id 前缀兜底。 */
  modelInfo?: Record<string, { company?: string; free?: boolean }>;
  /** 目录读取失败原因（宿主原文）；读取正常时缺省。 */
  catalogFailure?: string;
  /** 目录正在读取（还没有结果）。 */
  catalogLoading?: boolean;
  /** 重新读取目录。 */
  onRetryCatalog?: () => void;
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
  const visibleModels = props.visibleModels ?? [];
  const visibility = { visibleModels, modelVisibility: props.visibility };
  // 只有出现在设置里的模型才有「移除」：目录项只是候选，勾掉即可，没有可删的记录。
  // `visibleModels` 缺省（老调用方/纯单元测试）时没有「目录」概念，列表里的每一项都算已配置。
  const configured =
    props.visibleModels === undefined
      ? new Set<string>(props.models)
      : new Set<string>([...props.visibleModels, ...Object.keys(props.visibility)]);
  // 过滤是**纯展示**的：搜索框只缩小要渲染的行，一个模型都不会因此从设置里消失。
  // 关键词为空时列表与过滤前逐字相同（没有任何「默认排序」偷偷生效）。
  const needle = props.filter.trim().toLowerCase();
  const shown = needle === "" ? props.models : props.models.filter((model) => model.toLowerCase().includes(needle));
  const filtered = needle !== "" && shown.length !== props.models.length;
  const shownVisible = props.models.filter((model) => isModelIdVisible(model, visibility)).length;
  const loading = props.catalogLoading === true && props.catalogFailure === undefined;
  const catalogFailure =
    props.catalogFailure === undefined
      ? null
      : createElement(
          "p",
          { key: "catalog-failure", "data-model-catalog-failure": "true", "data-failure-detail": props.catalogFailure, className: CSS_CLASS.failure },
          failureListText(props.t, props.catalogFailure),
        );
  const retry =
    props.catalogFailure === undefined || props.onRetryCatalog === undefined
      ? null
      : createElement(
          "button",
          {
            key: "catalog-retry",
            type: "button",
            "data-model-catalog-retry": "true",
            className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
            onClick: () => props.onRetryCatalog?.(),
          },
          t("models.retry"),
        );

  // 分组只影响展示：免费组第一，其余按公司首次出现顺序（`core/model-groups` 单测）。
  const groups = groupModels(
    shown.map((id) => ({ id, ...(props.modelInfo?.[id] ?? {}) })),
  );
  const groupNodes = groups.map((group) =>
    createElement(
      "div",
      { key: group.key, "data-model-group": group.key, className: CSS_CLASS.modelGroup },
      createElement(
        "h3",
        null,
        group.key === "free" ? t("models.freeGroup") : group.key === "other" ? t("models.otherCompany") : companyLabelOf(group.key),
      ),
      ...group.models.map((model) => modelRow(props, model, visibility, configured)),
    ),
  );
  const emptyState: ReactNode[] = loading
    ? [createElement("p", { key: "loading", "data-models-loading": "true", className: CSS_CLASS.note }, t("models.loading"))]
    : props.catalogFailure !== undefined
      ? [catalogFailure, ...(retry === null ? [] : [retry])]
      : [createElement("p", { key: "empty", className: CSS_CLASS.empty }, t("models.empty"))];

  return createElement(
    "details",
    { "data-card": "models", className: CSS_CLASS.card, open: true },
    createElement(
      "summary",
      { className: CSS_CLASS.modelSummary, "data-model-collapse": "true" },
      createElement("span", { className: CSS_CLASS.modelSummaryTitle }, t("models.title")),
      createElement(ChevronIcon, null),
    ),
    // 提示必须与真实行为一致：立即生效时不该再出现「保存后生效」。
    createElement("small", { "data-models-mode": props.mode }, props.mode === "immediate" ? t("models.immediate") : t("models.onSave")),
    ...(props.models.length === 0
      ? emptyState
      : [
          createElement(
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
          createElement(
            "small",
            { key: "summary", "data-model-summary": `${shownVisible}/${props.models.length}`, className: CSS_CLASS.searchCount },
            t("models.summary").replace("{n}", String(shownVisible)).replace("{total}", String(props.models.length)),
          ),
          ...(catalogFailure === null ? [] : [catalogFailure]),
          ...(retry === null ? [] : [retry]),
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
          ...groupNodes,
        ]),
    addRow(props),
  );
}

/** 一行模型：名称 + 可见开关 + 移除（仅设置里存在的模型有移除）。 */
function modelRow(
  props: ModelsCardProps,
  model: string,
  visibility: { visibleModels: readonly string[]; modelVisibility: Record<string, boolean> },
  configured: ReadonlySet<string>,
): ReactNode {
  const { t } = props;
  const visible = isModelIdVisible(model, visibility);
  const removable = configured.has(model);
  const removeLabel = t("models.remove");
  return createElement(
    "div",
    { key: model, "data-model": model, "data-model-configured": removable, className: CSS_CLASS.field },
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
    removable
      ? createElement(
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
        )
      : null,
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
