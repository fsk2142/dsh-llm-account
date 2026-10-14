/**
 * 统一设置页的**渲染层**：把 `page-state.ts` 的状态翻译成元素树。
 *
 * 这里刻意**没有状态、没有 Hook、没有副作用**：`PageShell` 是「纯 props → 元素树」的函数，
 * 所有判定都在 `page-state.ts` 里做完。这样测试可以脱离浏览器直接调用它（测试用的 React 替身
 * 会把 Hook 调用直接判为失败），而交互状态由 `seams.ts` 里的容器组件持有。
 *
 * 卡片组与字段都由厂商注册表驱动（预检 Ruling 1）：页面不发明字段，厂商没声明的组不渲染。
 * @module dsh-llm-account/src/client/page
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { cardGroupsOf, fieldsOf, isDirty, type DraftField, type PageState } from "./page-state";
import type { CardGroupSpec, VendorEntry } from "./registry";

/** 页面外壳的属性。全部是数据与回调：外壳自己不留状态。 */
export interface PageShellProps {
  state: PageState;
  /** 注册表里的厂商声明（决定标签页与卡片组）。 */
  entries: readonly VendorEntry[];
  /** 取词函数（`ctx.locale.bind("settings.llm-account")` 或测试字典）。 */
  t: (key: string) => string;
  onSelectTab: (ns: string) => void;
  onSetField: (ns: string, key: string, value: unknown) => void;
  onSave: (ns: string) => void;
  /**
   * 该厂商的专属卡片（账户卡片、模型卡片……）。
   *
   * 扩展点：T5–T7 的卡片由此注入，页面外壳不需要认识它们 —— 外壳只保证顺序（专属卡片在通用
   * 字段卡片**之前**，与规格 §8 的卡片顺序一致）。
   */
  renderVendorCards?: (ns: string) => ReactNode;
}

/**
 * 统一设置页的外壳：标题 / 简介 / 厂商标签页 / 当前厂商的卡片与保存条。
 * @param props - 见 {@link PageShellProps}。
 * @returns 元素树。
 */
export function PageShell(props: PageShellProps): ReactElement {
  const { state, entries, t } = props;
  const active = entries.find((entry) => entry.ns === state.activeNs);

  return createElement(
    "div",
    { "data-page": "llm-account" },
    createElement("h1", null, t("title")),
    createElement("p", { "data-intro": "true" }, t("intro")),
    tabRow(props),
    active === undefined
      ? createElement("p", { "data-empty": "vendor" }, t("empty.noVendor"))
      : vendorBody(props, active),
  );
}

/** 标签页一行；没有标签页时什么都不渲染。 */
function tabRow(props: PageShellProps): ReactNode {
  const { state, t } = props;
  if (state.tabs.length === 0) return null;
  return createElement(
    "nav",
    { "data-tabs": "true", role: "tablist" },
    state.tabs.map((tab) =>
      createElement(
        "button",
        {
          key: tab.ns,
          type: "button",
          "data-tab": tab.ns,
          role: "tab",
          "aria-selected": tab.ns === state.activeNs,
          onClick: () => props.onSelectTab(tab.ns),
        },
        t(tab.labelKey),
      ),
    ),
  );
}

/** 当前厂商的主体：专属卡片 → 通用字段卡片 → 保存条。 */
function vendorBody(props: PageShellProps, entry: VendorEntry): ReactNode {
  const extras = props.renderVendorCards?.(entry.ns);
  return createElement(
    Fragment,
    null,
    extras === undefined ? null : extras,
    ...cardGroupsOf(entry).map((group) => cardGroupElement(props, entry, group)),
    isDirty(props.state, entry.ns) ? saveBar(props, entry) : null,
  );
}

/** 一组通用字段卡片。`advanced` 组用原生 `<details>`：默认折叠（规格 §8），且不需要状态。 */
function cardGroupElement(props: PageShellProps, entry: VendorEntry, group: CardGroupSpec): ReactElement {
  const fields = fieldsOf(props.state, entry).filter((field) => group.fields.some((spec) => spec.key === field.spec.key));
  const heading = createElement("h2", null, props.t(`group.${group.group}`));
  const hint = createElement("p", { "data-card-hint": group.group }, props.t(`group.${group.group}.hint`));
  const body = fields.map((field) => fieldElement(props, entry, field));

  // 高级设置默认折叠：`<details>` 不带 `open`。
  if (group.group === "advanced") {
    return createElement(
      "details",
      { key: group.group, "data-card-group": group.group },
      createElement("summary", null, props.t("advanced")),
      hint,
      ...body,
    );
  }
  return createElement("section", { key: group.group, "data-card-group": group.group }, heading, hint, ...body);
}

/** 一个字段：标签 + 控件 + 说明。控件种类由字段声明决定，不认识的一律不渲染。 */
function fieldElement(props: PageShellProps, entry: VendorEntry, field: DraftField): ReactNode {
  const { t } = props;
  const { spec } = field;
  const control = fieldControl(props, entry, field);
  if (control === undefined) return null;
  const hint = spec.hintKey === undefined ? null : createElement("small", { "data-field-hint": spec.key }, t(spec.hintKey));
  return createElement("label", { key: spec.key, "data-field": spec.key }, createElement("span", null, t(spec.labelKey)), control, hint);
}

/** 字段的控件。 */
function fieldControl(props: PageShellProps, entry: VendorEntry, field: DraftField): ReactNode {
  const { spec, value } = field;
  const change = (next: unknown): void => props.onSetField(entry.ns, spec.key, next);

  if (spec.kind === "boolean") {
    return createElement("input", {
      "data-field-input": spec.key,
      type: "checkbox",
      checked: value === true,
      onChange: (event: { target?: { checked?: boolean } }) => change(event.target?.checked === true),
    });
  }
  if (spec.kind === "select") {
    return createElement(
      "select",
      {
        "data-field-input": spec.key,
        value: value === undefined ? "" : String(value),
        onChange: (event: { target?: { value?: string } }) => change(event.target?.value ?? ""),
      },
      ...(spec.options ?? []).map((option) => createElement("option", { key: option.value, value: option.value }, props.t(option.labelKey))),
    );
  }
  if (spec.kind === "number" || spec.kind === "text") {
    return createElement("input", {
      "data-field-input": spec.key,
      type: spec.kind === "number" ? "number" : "text",
      // 没有值时留空串：不能把「没有值」显示成 0（全局约束）。
      value: value === undefined || value === null ? "" : String(value),
      onChange: (event: { target?: { value?: string } }) => change(event.target?.value ?? ""),
    });
  }
  return undefined;
}

/** 底部保存条：只在有改动时渲染（`vendorBody` 已经判过）。 */
function saveBar(props: PageShellProps, entry: VendorEntry): ReactElement {
  const { t } = props;
  return createElement(
    "div",
    { "data-save-bar": "true" },
    createElement("button", { type: "button", "data-save": entry.ns, onClick: () => props.onSave(entry.ns) }, t("save")),
    createElement("small", null, t("saveHint")),
  );
}

/**
 * 该厂商声明的卡片组（供容器组件与 T5–T7 复用，避免它们各自再实现一遍规则）。
 * @param entry - 厂商声明。
 * @returns 要渲染的组。
 */
export { cardGroupsOf };
