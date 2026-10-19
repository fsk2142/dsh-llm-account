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

import { CSS_CLASS } from "./css";
import { durationPartsOf, minutesOfDurationParts } from "./duration";
import { ChevronIcon } from "./icons";
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
   * 常驻的合并账户面板（标签页之上）。
   *
   * 账户不属于某一家厂商的标签页 —— 它是「这台机器上我有哪些账号」，所以由容器渲染一张
   * 跨厂商面板，页面外壳只负责把它放在标题与标签页之间（设计 §7.2）。
   */
  accounts?: ReactNode;
  /**
   * 该厂商的专属卡片（模型卡片……）。
   *
   * 扩展点：T5–T7 的卡片由此注入，页面外壳不需要认识它们 —— 外壳只保证顺序（专属卡片在通用
   * 字段卡片**之前**，与规格 §8 的卡片顺序一致）。
   */
  renderVendorCards?: (ns: string) => ReactNode;
  /** 合并标签页：不渲染供应商 tab 行，改为一个「设置对象」下拉。 */
  mergeTabs?: boolean;
  /** 当前是否正在保存（保存按钮的即时反馈）。 */
  saving?: boolean;
}

/**
 * 统一设置页的外壳：标题 / 简介 / 厂商标签页 / 当前厂商的卡片与保存条。
 *
 * 整个渲染包在一层错误边界里：React 会丢弃**整棵**已渲染的树，所以渲染期抛错在页面上
 * 表现为「这一段完全空白」——连标题都没有，与「没有可显示的厂商」那种有明确文案的空态
 * 完全不同，排查时极易误判成「没注册上」。这里把异常原样显示出来。
 * @param props - 见 {@link PageShellProps}。
 * @returns 元素树。
 */
export function PageShell(props: PageShellProps): ReactElement {
  try {
    return pageBody(props);
  } catch (error) {
    return renderErrorPanel(error);
  }
}

/** 渲染失败时的兜底：**不调用 `t()`**（取词本身可能就是抛错的原因）。 */
function renderErrorPanel(error: unknown): ReactElement {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return createElement(
    "div",
    { "data-page": "llm-account", className: CSS_CLASS.root },
    createElement("h1", null, "LLM 账号"),
    createElement("pre", { "data-render-error": "true", className: CSS_CLASS.diagnostic }, `render failed: ${detail}`),
  );
}

/** 外壳本体（假定不抛；抛了由 {@link PageShell} 接住）。 */
function pageBody(props: PageShellProps): ReactElement {
  const { state, entries, t } = props;
  const active = entries.find((entry) => entry.ns === state.activeNs);

  return createElement(
    "div",
    { "data-page": "llm-account", className: CSS_CLASS.root },
    createElement(
      "header",
      { className: CSS_CLASS.header },
      createElement("h1", null, t("title")),
      createElement("p", { "data-intro": "true", className: CSS_CLASS.intro }, t("intro")),
    ),
    props.accounts === undefined ? null : props.accounts,
    props.mergeTabs === true ? null : tabRow(props),
    active === undefined
      ? createElement(
          Fragment,
          null,
          createElement("p", { "data-empty": "vendor", className: CSS_CLASS.empty }, t("empty.noVendor")),
          // 「发现不到厂商」有四种病因（远程面缺席 / describe 抛错 / 形状不认识 /
          // 命名空间对不上），而症状完全一样。把原因显示出来，否则只能靠猜。
          state.discovery === undefined
            ? null
            : createElement(
                "pre",
                { "data-discovery": state.discovery.kind, className: CSS_CLASS.diagnostic },
                `${state.discovery.kind}: ${state.discovery.detail}`,
              ),
        )
      : vendorBody(props, active),
  );
}

/** 合并模式下的设置对象下拉（替代供应商 tab 行）。 */
function settingsTarget(props: PageShellProps): ReactNode {
  const { state, t } = props;
  if (state.tabs.length === 0) return null;
  return createElement(
    "div",
    { "data-settings-target": "true", className: CSS_CLASS.field },
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement("span", null, t("settingsTarget")),
      createElement("small", null, t("settingsTarget.hint")),
    ),
    createElement(
      "select",
      {
        "data-settings-target-select": "true",
        value: state.activeNs ?? state.tabs[0]?.ns ?? "",
        onChange: (event: { target?: { value?: string } }) => {
          if (event.target?.value !== undefined) props.onSelectTab(event.target.value);
        },
      },
      ...state.tabs.map((tab) => createElement("option", { key: tab.ns, value: tab.ns }, t(tab.labelKey))),
    ),
  );
}

/** 标签页一行；没有标签页时什么都不渲染。 */
function tabRow(props: PageShellProps): ReactNode {
  const { state, t } = props;
  if (state.tabs.length === 0) return null;
  return createElement(
    "nav",
    { "data-tabs": "true", role: "tablist", className: CSS_CLASS.tabs },
    state.tabs.map((tab) =>
      createElement(
        "button",
        {
          key: tab.ns,
          type: "button",
          "data-tab": tab.ns,
          role: "tab",
          "aria-selected": tab.ns === state.activeNs,
          className: CSS_CLASS.tab,
          onClick: () => props.onSelectTab(tab.ns),
        },
        t(tab.labelKey),
      ),
    ),
  );
}

/**
 * 当前厂商的主体：通用字段卡片 → 专属卡片 → 保存条。
 *
 * 专属卡片（模型列表）放在设置之后：OpenCode 的模型目录有几十个，若把它放在最前面，
 * 「切换策略」会被推到一屏之外，看起来像消失。模型卡片自己带折叠箭头，需要长时间浏览时
 * 仍可收起。
 */
function vendorBody(props: PageShellProps, entry: VendorEntry): ReactNode {
  const extras = props.renderVendorCards?.(entry.ns);
  return createElement(
    Fragment,
    null,
    ...cardGroupsOf(entry).map((group) => cardGroupElement(props, entry, group)),
    extras === undefined ? null : extras,
    isDirty(props.state, entry.ns) ? saveBar(props, entry) : null,
  );
}

/**
 * 一组通用字段卡片。
 *
 * 「集成与显示」与「高级」都用原生 `<details>` **默认折叠**（用户 2026-10-19 要求前者
 * 也能收）：这两组都是配置一次就不常动的字段，摊开会让设置页显得很长；账号与额度是
 * 常用区，保持展开。
 */
function cardGroupElement(props: PageShellProps, entry: VendorEntry, group: CardGroupSpec): ReactElement {
  const fields = fieldsOf(props.state, entry).filter((field) => group.fields.some((spec) => spec.key === field.spec.key));
  const heading = createElement("h2", null, props.t(`group.${group.group}`));
  const hint = createElement("p", { "data-card-hint": group.group }, props.t(`group.${group.group}.hint`));
  const body = fields.map((field) => fieldElement(props, entry, field));

  if (group.group === "advanced" || group.group === "integrations") {
    return createElement(
      "details",
      { key: group.group, "data-card-group": group.group, className: CSS_CLASS.card },
      createElement(
        "summary",
        null,
        createElement(ChevronIcon, null),
        // 标题用组名，不再写死「高级」—— 折叠组现在不止一个。
        props.t(`group.${group.group}`),
      ),
      // 「设置对象」只对按厂商区分的字段有意义，所以只挂在高级组里。
      group.group === "advanced" && props.mergeTabs === true ? settingsTarget(props) : null,
      hint,
      ...body,
    );
  }
  return createElement("section", { key: group.group, "data-card-group": group.group, className: CSS_CLASS.card }, heading, hint, ...body);
}

/** 一个字段：标签 + 控件 + 说明。控件种类由字段声明决定，不认识的一律不渲染。 */
function fieldElement(props: PageShellProps, entry: VendorEntry, field: DraftField): ReactNode {
  const { t } = props;
  const { spec } = field;
  const control = fieldControl(props, entry, field);
  if (control === undefined) return null;
  const hint = spec.hintKey === undefined ? null : createElement("small", { "data-field-hint": spec.key }, t(spec.hintKey));
  // 说明放在**标签下面**，与控件同一行的只有标签本身：否则一段长说明会和输入框一起
  // 把标签列挤到只剩一两个字宽（真机截图里「用量刷新间隔（分钟）」就是竖排的）。
  return createElement(
    "label",
    { key: spec.key, "data-field": spec.key, className: CSS_CLASS.field },
    createElement("span", { className: CSS_CLASS.fieldText }, createElement("span", null, t(spec.labelKey)), hint),
    control,
  );
}

/** 字段的控件。 */
function fieldControl(props: PageShellProps, entry: VendorEntry, field: DraftField): ReactNode {
  const { spec, value } = field;
  const change = (next: unknown): void => props.onSetField(entry.ns, spec.key, next);

  if (spec.kind === "boolean") {
    return createElement("input", {
      "data-field-input": spec.key,
      type: "checkbox",
      className: CSS_CLASS.toggle,
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
  if (spec.kind === "duration") {
    const parts = durationPartsOf(value);
    const changePart = (part: "days" | "hours" | "minutes", raw: string): void => {
      change(minutesOfDurationParts({ ...parts, [part]: Number(raw) }));
    };
    return createElement(
      "div",
      { className: CSS_CLASS.duration, "data-duration-input": spec.key },
      ...([
        ["days", 30],
        ["hours", 24],
        ["minutes", 60],
      ] as const).map(([part, max]) =>
        createElement(
          "span",
          { key: part, className: CSS_CLASS.durationPart },
          createElement("input", {
            type: "number",
            min: 0,
            max,
            value: String(parts[part]),
            "data-duration-part": part,
            onChange: (event: { target?: { value?: string } }) => changePart(part, event.target?.value ?? ""),
          }),
          createElement("span", null, props.t(`duration.${part}`)),
        ),
      ),
    );
  }
  if (spec.kind === "number" || spec.kind === "text") {
    return createElement("input", {
      "data-field-input": spec.key,
      type: spec.kind === "number" ? "number" : "text",
      // 没有值时留空串：不能把「没有值」显示成 0（全局约束）。
      value: value === undefined || value === null ? "" : String(value),
      onChange: (event: { target?: { value?: string } }) => {
        const raw = event.target?.value ?? "";
        if (spec.kind !== "number") {
          change(raw);
          return;
        }
        // 设置文档里 `quotaRefreshMinutes` 等是 number；留着字符串会让宿主按「非法值」回落。
        const parsed = raw.trim() === "" ? undefined : Number(raw);
        change(parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);
      },
    });
  }
  return undefined;
}

/** 底部保存条：只在有改动时渲染（`vendorBody` 已经判过）；保存失败时带一条可读原因。 */
function saveBar(props: PageShellProps, entry: VendorEntry): ReactElement {
  const { t } = props;
  // 失败原因原文放在 data 属性上供排查，界面上只显示通用文案（宿主的错误串对用户没有意义）。
  const error = props.state.saveErrors[entry.ns];
  const saving = props.saving === true;
  return createElement(
    "div",
    { "data-save-bar": "true", className: CSS_CLASS.save },
    createElement("button", { type: "button", "data-save": entry.ns, className: CSS_CLASS.buttonPrimary, disabled: saving, onClick: () => props.onSave(entry.ns) }, saving ? t("saving") : t("save")),
    createElement("small", null, t("saveHint")),
    ...(error === undefined
      ? []
      : [
          createElement("small", {
            key: "error",
            "data-save-error": entry.ns,
            "data-save-error-reason": error,
            className: CSS_CLASS.failure,
          }, t("save.failed")),
        ]),
  );
}

/**
 * 该厂商声明的卡片组（供容器组件与 T5–T7 复用，避免它们各自再实现一遍规则）。
 * @param entry - 厂商声明。
 * @returns 要渲染的组。
 */
export { cardGroupsOf };
