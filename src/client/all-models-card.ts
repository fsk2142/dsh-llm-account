/**
 * 全局模型卡片：两家厂商的模型放在同一张卡片里；先按供应商分组，再按模型公司分组。
 *
 * 两级都可折叠：供应商分组与公司分组各有一个箭头；每个公司分组（以及供应商分组）都有
 * 「隐藏/显示本组全部模型」，一次点击就能批量处理。勾选/移除/批量由容器立即写回所属厂商。
 * 纯 props → 元素树；搜索与添加草稿由容器持有。
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
  vendor: string;
  label: string;
  catalog: readonly CatalogModel[];
  visibleModels: readonly string[];
  visibility: Record<string, boolean>;
  loading?: boolean;
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
  /** 批量设置一组模型的可见性（公司分组/供应商分组用）。 */
  onGroupVisibility: (vendor: string, models: readonly string[], visible: boolean) => void;
  onAdd: (vendor: string, model: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  draftVendor: string;
  onDraftVendorChange: (vendor: string) => void;
}

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

interface Group {
  key: string;
  rows: Row[];
}

/** 收集一家厂商的行（目录 ∪ 白名单 ∪ 显隐表）。 */
function rowsOf(vendor: AllModelsVendor): Row[] {
  const catalog = new Map(vendor.catalog.map((model) => [model.id, model]));
  const ids = [
    ...new Set([...vendor.catalog.map((model) => model.id), ...vendor.visibleModels, ...Object.keys(vendor.visibility)]),
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

/** 免费 → 公司首次出现 → 其他。 */
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

/** 一组是否全部可见。 */
function allVisible(rows: readonly Row[]): boolean {
  return rows.length > 0 && rows.every((row) => row.visible);
}

/** 组文案。 */
function groupLabel(t: (key: string) => string, key: string): string {
  return key === "free" ? t("models.freeGroup") : key === "other" ? t("models.otherCompany") : companyLabelOf(key);
}

/**
 * 全局模型卡片。
 * @param props - 见 {@link AllModelsCardProps}。
 * @returns 元素树。
 */
export function AllModelsCard(props: AllModelsCardProps): ReactElement {
  const { t } = props;
  const needle = props.filter.trim().toLowerCase();
  const vendorSections = props.vendors.map((vendor) => {
    const all = rowsOf(vendor);
    const matching = needle === "" ? all : all.filter((row) => `${row.id} ${row.name ?? ""}`.toLowerCase().includes(needle));
    return { vendor, all, matching, groups: groupsOf(matching) };
  });
  const totalRows = vendorSections.flatMap((section) => section.all);
  const visibleCount = totalRows.filter((row) => row.visible).length;
  const failures = props.vendors.flatMap((vendor) => (vendor.failure === undefined ? [] : [`${vendor.label}: ${vendor.failure}`]));
  const loading = props.vendors.some((vendor) => vendor.loading === true);
  const addVendor = props.vendors.find((vendor) => vendor.vendor === props.draftVendor) ?? props.vendors[0];

  const body: ReactNode[] = [];
  if (totalRows.length === 0) {
    body.push(
      createElement("p", { key: "empty", className: CSS_CLASS.note }, loading ? t("models.loading") : t("models.empty")),
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
        { key: "summary", "data-all-model-summary": `${visibleCount}/${totalRows.length}`, className: CSS_CLASS.searchCount },
        t("models.summary").replace("{n}", String(visibleCount)).replace("{total}", String(totalRows.length)),
      ),
    );
    if (needle !== "" && vendorSections.every((section) => section.matching.length === 0)) {
      body.push(createElement("p", { key: "no-match", className: CSS_CLASS.empty }, t("models.noMatch")));
    }
    for (const section of vendorSections) {
      if (section.matching.length === 0) continue;
      const showVendor = allVisible(section.matching);
      body.push(
        createElement(
          "details",
          {
            key: section.vendor.vendor,
            "data-all-model-vendor-group": section.vendor.vendor,
            className: CSS_CLASS.modelVendorGroup,
            open: true,
          },
          createElement(
            "summary",
            { className: CSS_CLASS.modelGroupSummary, "data-all-model-vendor-collapse": section.vendor.vendor },
            createElement("span", { className: CSS_CLASS.modelGroupTitle }, section.vendor.label),
            createElement("small", null, `${section.matching.filter((row) => row.visible).length}/${section.matching.length}`),
            createElement(ChevronIcon, null),
          ),
          createElement(
            "button",
            {
              type: "button",
              "data-all-model-vendor-toggle": section.vendor.vendor,
              className: CSS_CLASS.buttonGhost,
              onClick: () =>
                props.onGroupVisibility(
                  section.vendor.vendor,
                  section.matching.map((row) => row.id),
                  !showVendor,
                ),
            },
            showVendor ? t("models.hideVendor") : t("models.showVendor"),
          ),
          ...section.groups.flatMap((group) => {
            const label = groupLabel(t, group.key);
            const show = allVisible(group.rows);
            return [
              createElement(
                "details",
                {
                  key: `${section.vendor.vendor}:${group.key}`,
                  "data-all-model-group": `${section.vendor.vendor}:${group.key}`,
                  className: CSS_CLASS.modelGroup,
                  open: true,
                },
                createElement(
                  "summary",
                  { className: CSS_CLASS.modelGroupSummary, "data-all-model-group-collapse": `${section.vendor.vendor}:${group.key}` },
                  createElement("span", { className: CSS_CLASS.modelGroupTitle }, label),
                  createElement("small", null, `${group.rows.filter((row) => row.visible).length}/${group.rows.length}`),
                  createElement(ChevronIcon, null),
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    "data-all-model-group-toggle": `${section.vendor.vendor}:${group.key}`,
                    className: CSS_CLASS.buttonGhost,
                    onClick: () =>
                      props.onGroupVisibility(
                        section.vendor.vendor,
                        group.rows.map((row) => row.id),
                        !show,
                      ),
                  },
                  show ? t("models.hideGroup") : t("models.showGroup"),
                ),
                ...group.rows.map((row) => modelRow(props, row)),
              ),
            ];
          }),
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
            ...props.vendors.map((vendor) => createElement("option", { key: vendor.vendor, value: vendor.vendor }, vendor.label)),
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

/** 一行模型。 */
function modelRow(props: AllModelsCardProps, row: Row): ReactNode {
  return createElement(
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
            title: props.t("models.remove"),
            "aria-label": props.t("models.remove"),
            onClick: () => props.onRemove(row.vendor, row.id),
          },
          createElement(RemoveIcon, null),
        )
      : null,
  );
}
