/**
 * 全局模型卡片：两家厂商的模型**合并**成一张列表，按免费/模型公司分组，行上标供应商。
 *
 * 公司分组是跨供应商的：同一家 Anthropic 的模型无论来自 Command Code 还是 OpenCode 都
 * 在一组里，组上只有一个「全开本组/全关本组」按钮；点击时按行所属厂商分别写回。
 * 默认关闭（`isModelIdVisible` 白名单为空返回 false），需要勾选或按组开启。
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
  removedModels?: readonly string[];
  newModels?: readonly string[];
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
  /** 批量设置一组模型的可见性；同组可能跨两家，由卡片按厂商拆分。 */
  onGroupVisibility: (vendor: string, models: readonly string[], visible: boolean) => void;
  onAdd: (vendor: string, model: string) => void;
  /** 重新拉取两家目录并重新分组。 */
  onRefresh: () => void;
  refreshing?: boolean;
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
  fresh: boolean;
}

interface Group {
  key: string;
  rows: Row[];
}

/** 收集一家厂商的行（目录 ∪ 白名单 ∪ 显隐表）。 */
function rowsOf(vendor: AllModelsVendor): Row[] {
  const catalog = new Map(vendor.catalog.map((model) => [model.id, model]));
  const removed = new Set(vendor.removedModels ?? []);
  const fresh = new Set(vendor.newModels ?? []);
  const ids = [
    ...new Set([...vendor.catalog.map((model) => model.id), ...vendor.visibleModels, ...Object.keys(vendor.visibility)]),
  ].filter((id) => !removed.has(id));
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
      fresh: fresh.has(id),
    };
  });
}

/** 免费 → 公司首次出现 → 其他。跨厂商。 */
function groupsOf(rows: readonly Row[]): Group[] {
  const free: Row[] = [];
  const byCompany = new Map<string, Row[]>();
  for (const row of rows) {
    if (row.free) {
      free.push(row);
      continue;
    }
    const key = companyKeyOf(row.id, row.company);
    // Command Code 的目录 id 有时是内部编号；名称里的「Claude / GPT / Qwen…」是最后一条线索。
    const resolved = key === "other" && row.name !== undefined ? companyKeyOf(row.name, undefined) : key;
    const bucket = byCompany.get(resolved);
    if (bucket === undefined) byCompany.set(resolved, [row]);
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
  const allRows = props.vendors.flatMap((vendor) => rowsOf(vendor));
  const matching =
    needle === "" ? allRows : allRows.filter((row) => `${row.id} ${row.name ?? ""}`.toLowerCase().includes(needle));
  const groups = groupsOf(matching);
  const visibleCount = allRows.filter((row) => row.visible).length;
  const failures = props.vendors.flatMap((vendor) => (vendor.failure === undefined ? [] : [`${vendor.label}: ${vendor.failure}`]));
  const loading = props.vendors.some((vendor) => vendor.loading === true);
  const addVendor = props.vendors.find((vendor) => vendor.vendor === props.draftVendor) ?? props.vendors[0];

  const body: ReactNode[] = [];
  if (allRows.length === 0) {
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
        { key: "summary", "data-all-model-summary": `${visibleCount}/${allRows.length}`, className: CSS_CLASS.searchCount },
        t("models.summary").replace("{n}", String(visibleCount)).replace("{total}", String(allRows.length)),
      ),
    );
    if (needle !== "" && matching.length === 0) {
      body.push(createElement("p", { key: "no-match", className: CSS_CLASS.empty }, t("models.noMatch")));
    }
    for (const group of groups) {
      const label = groupLabel(t, group.key);
      const show = allVisible(group.rows);
      body.push(
        createElement(
          "details",
          {
            key: group.key,
            "data-all-model-group": group.key,
            className: CSS_CLASS.modelGroup,
            open: true,
          },
          createElement(
            "summary",
            { className: CSS_CLASS.modelGroupSummary, "data-all-model-group-collapse": group.key },
            createElement("span", { className: CSS_CLASS.modelGroupTitle }, label),
            createElement("small", null, `${group.rows.filter((row) => row.visible).length}/${group.rows.length}`),
            createElement(
              "button",
              {
                type: "button",
                "data-all-model-group-toggle": group.key,
                className: CSS_CLASS.buttonGhost,
                onClick: (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
                  event?.preventDefault?.();
                  event?.stopPropagation?.();
                  // 同一家公司可能跨两家厂商：按厂商拆开写回，各自保持自己的白名单/显隐表。
                  const byVendor = new Map<string, string[]>();
                  for (const row of group.rows) {
                    const bucket = byVendor.get(row.vendor) ?? [];
                    bucket.push(row.id);
                    byVendor.set(row.vendor, bucket);
                  }
                  for (const [vendor, ids] of byVendor) props.onGroupVisibility(vendor, ids, !show);
                },
              },
              show ? t("models.hideGroup") : t("models.showGroup"),
            ),
            createElement(ChevronIcon, null),
          ),
          ...group.rows.map((row) => modelRow(props, row)),
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
    createElement(
      "div",
      { className: CSS_CLASS.actions },
      createElement(
        "button",
        {
          type: "button",
          "data-all-model-refresh": "true",
          className: CSS_CLASS.buttonGhost,
          disabled: props.refreshing === true,
          onClick: () => props.onRefresh(),
        },
        props.refreshing === true ? t("models.refreshing") : t("models.refresh"),
      ),
    ),
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
        row.fresh ? createElement("span", { "data-model-new": "true", className: CSS_CLASS.newBadge }, props.t("models.newBadge")) : null,
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
    createElement(
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
    ),
  );
}
