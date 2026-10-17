/**
 * 全局模型卡片：两家厂商的模型放在同一张卡片里，按公司/免费分组，行上标供应商。
 *
 * 与旧的按标签页模型卡的区别：模型是「这台机器能用哪些模型」，不该因为正在看哪家的设置而
 * 消失。勾选/移除由容器**立即写回所属厂商**的设置文档（草稿先更新，界面立刻有反馈）。
 * 纯 props → 元素树；搜索、折叠与添加草稿由容器持有。
 * @module dsh-llm-account/src/client/all-models-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import type { CatalogModel } from "../core/adapter";
import { companyKeyOf, companyLabelOf, isFreeModel } from "../core/model-groups";
import { isModelIdVisible } from "../core/catalog";
import { CSS_CLASS } from "./css";
import { ChevronIcon, RemoveIcon } from "./icons";

/** 一个厂商的模型视图。 */
export interface AllModelsVendor {
  /** provider id（动作路由键）。 */
  vendor: string;
  /** 展示名（Command Code / OpenCode）。 */
  label: string;
  /** 未过滤目录。 */
  catalog: readonly CatalogModel[];
  /** 白名单。 */
  visibleModels: readonly string[];
  /** 逐模型显隐。 */
  visibility: Record<string, boolean>;
  /** 目录读取中。 */
  loading?: boolean;
  /** 目录读取失败原因。 */
  failure?: string;
}

/** 全局模型卡片属性。 */
export interface AllModelsCardProps {
  t: (key: string) => string;
  vendors: readonly AllModelsVendor[];
  filter: string;
  onFilterChange: (value: string) => void;
  onToggle: (vendor: string, model: string, visible: boolean) => void;
  onRemove: (vendor: string, model: string) => void;
  onAdd: (vendor: string, model: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  /** 手动添加的目标厂商。 */
  draftVendor: string;
  onDraftVendorChange: (vendor: string) => void;
}

/** 展示行。 */
interface Row {
  vendor: string;
  label: string;
  id: string;
  name?: string;
  company?: string;
  free: boolean;
  visible: boolean;
  configured: boolean;
}

/** 分组。 */
interface Group {
  key: string;
  rows: Row[];
}

/** 收集一家厂商的行（目录 ∪ 白名单 ∪ 显隐表）。 */
function rowsOf(vendor: AllModelsVendor): Row[] {
  const catalog = new Map(vendor.catalog.map((model) => [model.id, model]));
  const ids = [
    ...new Set([
      ...vendor.catalog.map((model) => model.id),
      ...vendor.visibleModels,
      ...Object.keys(vendor.visibility),
    ]),
  ];
  const configured = new Set([...vendor.visibleModels, ...Object.keys(vendor.visibility)]);
  const visibility = { visibleModels: vendor.visibleModels, modelVisibility: vendor.visibility };
  return ids.map((id) => {
    const model = catalog.get(id);
    return {
      vendor: vendor.vendor,
      label: vendor.label,
      id,
      ...(model?.name === undefined ? {} : { name: model.name }),
      ...(model?.company === undefined ? {} : { company: model.company }),
      free: isFreeModel(id, model?.free),
      visible: isModelIdVisible(id, visibility),
      configured: configured.has(id),
    };
  });
}

/** 按免费 → 公司首次出现 → 其他 分组；组内保持两种目录的输入顺序。 */
function groupsOf(rows: readonly Row[]): Group[] {
  const free: Row[] = [];
  const byCompany = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.free) {
      free.push(row);
      continue;
    }
    const key = companyKeyOf(row.id, row.company);
    const bucket = byCompany.get(key);
    if (bucket === undefined) byCompany.set(key, [row]);
    else bucket.push(row);
  }
  const groups: Group[] = [];
  if (free.length > 0) groups.push({ key: "free", rows: free });
  for (const [key, items] of byCompany) {
    if (key === "other") continue;
    groups.push({ key, rows: items });
  }
  const other = byCompany.get("other");
  if (other !== undefined) groups.push({ key: "other", rows: other });
  return groups;
}

/**
 * 全局模型卡片。
 * @param props - 见 {@link AllModelsCardProps}。
 * @returns 元素树。
 */
export function AllModelsCard(props: AllModelsCardProps): ReactElement {
  const { t } = props;
  const vendors = props.vendors;
  const rows = vendors.flatMap((vendor) => rowsOf(vendor));
  const needle = props.filter.trim().toLowerCase();
  const filtered = needle === "" ? rows : rows.filter((row) => `${row.id} ${row.name ?? ""}`.toLowerCase().includes(needle));
  const groups = groupsOf(filtered);
  const visibleCount = rows.filter((row) => row.visible).length;
  const loading = vendors.some((vendor) => vendor.loading === true);
  const failures = vendors.flatMap((vendor) => (vendor.failure === undefined ? [] : [`${vendor.label}: ${vendor.failure}`]));
  const addVendor = vendors.find((vendor) => vendor.vendor === props.draftVendor) ?? vendors[0];

  const body: ReactNode[] = [];
  if (rows.length === 0) {
    body.push(
      createElement(
        "p",
        { key: "empty", className: CSS_CLASS.note },
        loading ? t("models.loading") : t("models.empty"),
      ),
    );
  } else {
    body.push(
      createElement(
        "div",
        { key: "search", className: CSS_CLASS.search },
        createElement("input", {
          "data-all-model-filter": "true",
          type: "text",
          value: props.filter,
          placeholder: t("models.searchPlaceholder"),
          onChange: (event: { target?: { value?: string } }) => props.onFilterChange(event.target?.value ?? ""),
        }),
      ),
      createElement(
        "small",
        { key: "summary", "data-all-model-summary": `${visibleCount}/${rows.length}`, className: CSS_CLASS.searchCount },
        t("models.summary").replace("{n}", String(visibleCount)).replace("{total}", String(rows.length)),
      ),
    );
    if (needle !== "" && filtered.length === 0) {
      body.push(createElement("p", { key: "no-match", className: CSS_CLASS.empty }, t("models.noMatch")));
    }
    for (const group of groups) {
      body.push(
        createElement(
          "div",
          { key: group.key, "data-all-model-group": group.key, className: CSS_CLASS.modelGroup },
          createElement(
            "h3",
            null,
            group.key === "free"
              ? t("models.freeGroup")
              : group.key === "other"
                ? t("models.otherCompany")
                : companyLabelOf(group.key),
          ),
          ...group.rows.map((row) =>
            createElement(
              "div",
              { key: `${row.vendor}:${row.id}`, "data-all-model": `${row.vendor}:${row.id}`, className: CSS_CLASS.field },
              createElement(
                "span",
                { className: CSS_CLASS.fieldText },
                createElement(
                  "span",
                  { className: CSS_CLASS.nameRow },
                  createElement("span", { "data-model-label": row.id, className: CSS_CLASS.mono }, row.name ?? row.id),
                  createElement("small", { "data-model-vendor": row.vendor, className: CSS_CLASS.vendorBadge }, row.label),
                ),
              ),
              createElement("input", {
                "data-all-model-visible": `${row.vendor}:${row.id}`,
                type: "checkbox",
                className: CSS_CLASS.toggle,
                checked: row.visible,
                onChange: (event: { target?: { checked?: boolean } }) =>
                  props.onToggle(row.vendor, row.id, event.target?.checked === true),
              }),
              row.configured
                ? createElement(
                    "button",
                    {
                      type: "button",
                      "data-all-model-remove": `${row.vendor}:${row.id}`,
                      className: CSS_CLASS.iconDanger,
                      title: t("models.remove"),
                      "aria-label": t("models.remove"),
                      onClick: () => props.onRemove(row.vendor, row.id),
                    },
                    createElement(RemoveIcon, null),
                  )
                : null,
            ),
          ),
        ),
      );
    }
  }

  return createElement(
    "details",
    { "data-card": "all-models", className: CSS_CLASS.card, open: true },
    createElement(
      "summary",
      { className: CSS_CLASS.modelSummary, "data-all-model-collapse": "true" },
      createElement("span", { className: CSS_CLASS.modelSummaryTitle }, t("models.allTitle")),
      createElement(ChevronIcon, null),
    ),
    createElement("small", { className: CSS_CLASS.note }, t("models.allHint")),
    ...failures.map((failure) =>
      createElement("p", { key: failure, "data-all-model-failure": "true", className: CSS_CLASS.failure }, failure),
    ),
    ...body,
    addVendor === undefined
      ? null
      : createElement(
          "div",
          { key: "add", "data-card": "all-models-add", className: CSS_CLASS.actions },
          createElement(
            "select",
            {
              "data-all-model-add-vendor": "true",
              value: addVendor.vendor,
              onChange: (event: { target?: { value?: string } }) => props.onDraftVendorChange(event.target?.value ?? ""),
            },
            ...vendors.map((vendor) => createElement("option", { key: vendor.vendor, value: vendor.vendor }, vendor.label)),
          ),
          createElement("input", {
            "data-all-model-add-draft": "true",
            type: "text",
            value: props.draft,
            placeholder: t("models.placeholder"),
            onChange: (event: { target?: { value?: string } }) => props.onDraftChange(event.target?.value ?? ""),
          }),
          createElement(
            "button",
            {
              type: "button",
              "data-all-model-add": "true",
              className: CSS_CLASS.buttonPrimary,
              disabled: props.draft.trim() === "",
              onClick: () => props.onAdd(addVendor.vendor, props.draft),
            },
            t("models.add"),
          ),
        ),
  );
}
