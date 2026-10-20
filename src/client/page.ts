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
import { cardGroupsOf, FEATURE_TAB_NS, fieldsOf, isDirty, type DraftField, type PageState } from "./page-state";
import { isConfigEnabled, primarySwitchOf, SETTINGS_CARDS, subordinateFieldsOf, type SettingsCard } from "./settings-cards";
import type { VendorEntry } from "./registry";

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
  // 「一个厂商都没发现」是**页面级**的事实，与选中哪个设置对象无关（功能页常驻之后
  // `active` 几乎不再为 undefined）。
  const noVendor = !state.tabs.some((tab) => tab.ns !== FEATURE_TAB_NS);
  // 四张卡片把三家的字段合并渲染。功能页（切换/搜索）的字段也属于这几张卡，
  // 所以它**参与合并**，只是它没有自己的 tab 了。
  const vendors = entries;
  /** 合并后的设置值：判定主开关状态用（草稿优先于基线）。 */
  const merged = cardSettingsValue(props, vendors);

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
    // 空态提示：独立于任何选择显示一次（见上面 noVendor 的说明）。
    noVendor
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
      : null,
    // 四张卡片（按功能分组，三家合并）。用户 2026-10-20：「三家设置合并在一起，
    // 除非某个设置是专门针对某一家网关的」「不要那个设置对象，就按照可收起的卡片形式」。
    //
    // 卡片**永远都在**：主开关（启用自动切换 / 启用网页搜索）关掉时只把下方配置置灰，
    // 卡片不消失 —— 用户随时能重新打开，也不会分不清「自己关掉了」还是「坏了」。
    ...SETTINGS_CARDS.map((card) => settingsCardElement(props, vendors, card, merged)),
    // 保存条：**任何一行**有未保存改动时出现（含功能页 —— 它的字段也存在承载行文档里）。
    // 只看厂商行会让「启用自动切换」这类开关改了之后没有保存按钮（2026-10-20 报障）。
    vendors.some((entry) => isDirty(props.state, entry.ns))
      ? mergedSaveBar(props, vendors)
      : null,
  );
}

/**
 * 合并后的设置值：用于判断「显示切换策略 / 显示网页搜索」这两个开关。
 *
 * 三个来源按优先级叠加，与控件本身的读法一致：
 * 1. 各家的**基线**（宿主文档）；
 * 2. 各家的**草稿**（用户刚点、还没保存）。
 *
 * 为什么按顺序覆盖而不是只取一家：功能页的开关存在承载行（commandcode）上，但用户也可能
 * 直接改那一行；取「最后一份非空」会在两家值不同时抖动，所以按「谁有值用谁」逐键合并 ——
 * 这些字段本来就该三家一致（写回时会镜像）。
 * @param props - 页面属性。
 * @param vendors - 厂商行（含功能页，它的值代表承载行）。
 * @returns 合并后的值。
 */
function cardSettingsValue(
  props: PageShellProps,
  vendors: readonly VendorEntry[],
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (const entry of vendors) {
    const baseline = props.state.snapshots[entry.ns]?.value;
    if (baseline !== undefined) Object.assign(merged, baseline);
    const draft = props.state.drafts[entry.ns];
    if (draft !== undefined) Object.assign(merged, draft);
  }
  return merged;
}

/**
 * 一张功能卡片：把三家（以及功能页）里属于这张卡的字段**合并去重**后渲染。
 *
 * 卡片的形状（用户 2026-10-20 澄清）：
 * 1. **主开关在最上面**（「启用自动切换」/「启用网页搜索」）—— 它是这张卡的重点；
 * 2. 主开关下面是**相关配置**；主开关关掉时这些配置变**禁用但仍在**（不隐藏）—— 隐藏会
 *    让整块消失、不留线索，用户也分不清是自己关掉了还是坏了；
 * 3. `specific` 字段只渲染它归属的那一家，并标注厂商徽标。
 * @param props - 页面属性。
 * @param vendors - 参与合并的厂商行（含功能页，它的值代表承载行）。
 * @param card - 卡片声明。
 * @param value - 合并后的设置值（用于判定主开关状态）。
 * @returns 可折叠卡片元素。
 */
function settingsCardElement(
  props: PageShellProps,
  vendors: readonly VendorEntry[],
  card: SettingsCard,
  value: Readonly<Record<string, unknown>>,
): ReactNode {
  const { t } = props;
  const enabled = isConfigEnabled(value, card.id);
  const nodes: ReactNode[] = [];

  /** 在合并后的厂商列表里找某个共有字段的声明（取第一家）。 */
  const sharedField = (key: string): { owner: VendorEntry; field: DraftField } | undefined => {
    for (const entry of vendors) {
      const field = fieldsOf(props.state, entry).find((candidate) => candidate.spec.key === key);
      if (field !== undefined) return { owner: entry, field };
    }
    return undefined;
  };

  // 1) 主开关：单独一块，排最上面（不从属任何「配置」组）。
  const primaryKey = primarySwitchOf(card.id);
  const primary = primaryKey === undefined ? undefined : sharedField(primaryKey);
  if (primary !== undefined) {
    nodes.push(
      createElement(
        "div",
        { key: `${card.id}-primary`, "data-card-primary": card.id, className: CSS_CLASS.inset },
        fieldElement(props, primary.owner, primary.field),
      ),
    );
  }

  // 2) 相关配置：主开关关掉时整体加一个 data 标记（样式据此置灰），但元素仍在。
  const configNodes: ReactNode[] = [];
  for (const key of subordinateFieldsOf(card.id)) {
    const found = sharedField(key);
    if (found === undefined) continue;
    configNodes.push(fieldElement(props, found.owner, found.field));
  }
  // 3) 厂商专属字段。
  for (const vendor of vendors) {
    for (const field of fieldsOf(props.state, vendor)) {
      const declared = card.specific.find((item) => item.key === field.spec.key && item.vendor === vendor.providerId);
      if (declared === undefined) continue;
      configNodes.push(fieldElement(props, vendor, field, labelOf(props, vendor)));
    }
  }
  if (configNodes.length > 0) {
    nodes.push(
      createElement(
        "div",
        {
          key: `${card.id}-config`,
          "data-card-config": card.id,
          // 主开关关掉 → 配置区禁用（视觉置灰 + 说明），但**不隐藏**。
          ...(enabled ? {} : { "data-card-disabled": "true" }),
          className: CSS_CLASS.inset,
        },
        ...(enabled ? [] : [createElement("small", { key: "off", className: CSS_CLASS.note }, t("card.disabledHint"))]),
        ...configNodes,
      ),
    );
  }

  if (nodes.length === 0) return null;

  // 原生 `<details>` 自带可收起语义（与页面里其它卡片一致，不需要额外状态）。
  return createElement(
    "details",
    {
      key: card.id,
      "data-card": card.id,
      // 高级设置默认收起（平时不动）；其余默认展开。
      ...(card.id === "advanced" ? {} : { open: true }),
      className: CSS_CLASS.card,
    },
    createElement(
      "summary",
      { className: CSS_CLASS.modelSummary, "data-card-collapse": card.id },
      createElement("span", { className: CSS_CLASS.modelSummaryTitle }, t(card.labelKey)),
      createElement(ChevronIcon, null),
    ),
    createElement("small", { className: CSS_CLASS.note }, t(card.hintKey)),
    ...nodes,
  );
}

/** 厂商的展示名（用于「这一项只对某家生效」的标注）。 */
function labelOf(props: PageShellProps, entry: VendorEntry): string {
  return props.t(entry.labelKey);
}

/**
 * 合并视图的保存条：三家共用一条。
 *
 * 为什么要合并：四张卡片里三家字段是混排的，若每家各一条保存条，用户会看到三根按钮却分不清
 * 哪一根管哪一行。这里一次性提交**所有脏行**。
 * @param props - 页面属性。
 * @param vendors - 厂商行。
 * @returns 保存条元素。
 */
function mergedSaveBar(props: PageShellProps, vendors: readonly VendorEntry[]): ReactElement {
  const { t } = props;
  // 功能页与承载行（`rowIds[0]`，本插件是 `llm-commandcode`）**共用同一份设置文档**。
  // 功能页字段的草稿存在 `FEATURE_TAB_NS` 下，但保存必须落到承载行上 ——
  // 否则那些开关永远存不下去（2026-10-20 报障「点了没反应」的深层原因之一）。
  const carrierNs = vendors.find((entry) => entry.ns === FEATURE_TAB_NS)?.rowIds[0];
  const dirty = vendors.filter((entry) => {
    if (entry.ns !== FEATURE_TAB_NS) return isDirty(props.state, entry.ns);
    // 功能页：只有承载行自己没脏时才替它出按钮（避免同一份文档出现两根保存按钮）。
    return (
      carrierNs !== undefined &&
      !vendors.some((other) => other.ns === carrierNs && isDirty(props.state, other.ns)) &&
      isDirty(props.state, entry.ns)
    );
  });
  const saving = props.saving === true;
  return createElement(
    "div",
    { "data-save-bar": "true", className: CSS_CLASS.save },
    ...dirty.map((entry) => {
      // 功能页的按钮写的是承载行（宿主按条目 id 寻址，功能页没有自己的行）。
      const target = entry.ns === FEATURE_TAB_NS && carrierNs !== undefined ? carrierNs : entry.ns;
      return createElement(
        "button",
        {
          key: entry.ns,
          type: "button",
          "data-save": target,
          className: CSS_CLASS.buttonPrimary,
          disabled: saving,
          onClick: () => props.onSave(target),
        },
        saving ? t("saving") : t("save"),
      );
    }),
    createElement("small", null, t("saveHint")),
    ...dirty
      .filter((entry) => props.state.saveErrors[entry.ns] !== undefined)
      .map((entry) =>
        createElement(
          "small",
          {
            key: `error-${entry.ns}`,
            // 值与旧版一致：**命名空间**（调用方与测试都靠它定位是哪一家失败了）。
            "data-save-error": entry.ns,
            "data-save-error-reason": props.state.saveErrors[entry.ns],
            className: CSS_CLASS.failure,
          },
          t("save.failed"),
        ),
      ),
  );
}

/**
 * 一组通用字段卡片。
 *
 * 「集成与显示」与「高级」都用原生 `<details>` **默认折叠**（用户 2026-10-19 要求前者
 * 也能收）：这两组都是配置一次就不常动的字段，摊开会让设置页显得很长；账号与额度是
 * 常用区，保持展开。
 */

/**
 * 一个字段：标签 + 控件 + 说明。控件种类由字段声明决定，不认识的一律不渲染。
 * @param props - 页面属性。
 * @param entry - 这个字段所属的厂商行（写回按它走）。
 * @param field - 字段的控件状态。
 * @param vendorLabel - 厂商专属字段的归属标注；共有字段不传（它们三家通用，标了反而让人
 *   以为「改这一家不影响别家」）。
 * @returns 字段元素；控件认不出时为 `null`。
 */
function fieldElement(
  props: PageShellProps,
  entry: VendorEntry,
  field: DraftField,
  vendorLabel?: string,
): ReactNode {
  const { t } = props;
  const { spec } = field;
  const control = fieldControl(props, entry, field);
  if (control === undefined) return null;
  const hint = spec.hintKey === undefined ? null : createElement("small", { "data-field-hint": spec.key }, t(spec.hintKey));
  // 说明放在**标签下面**，与控件同一行的只有标签本身：否则一段长说明会和输入框一起
  // 把标签列挤到只剩一两个字宽（真机截图里「用量刷新间隔（分钟）」就是竖排的）。
  return createElement(
    "label",
    {
      key: spec.key,
      "data-field": spec.key,
      // 厂商专属字段带上归属，便于排查「这项只对某家生效」。
      ...(vendorLabel === undefined ? {} : { "data-field-vendor": entry.providerId }),
      className: CSS_CLASS.field,
    },
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement(
        "span",
        null,
        ...(vendorLabel === undefined
          ? [t(spec.labelKey)]
          : [
              t(spec.labelKey),
              createElement("small", { key: "vendor", className: CSS_CLASS.vendorBadge }, vendorLabel),
            ]),
      ),
      hint,
    ),
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

/**
 * 该厂商声明的卡片组（供容器组件与 T5–T7 复用，避免它们各自再实现一遍规则）。
 * @param entry - 厂商声明。
 * @returns 要渲染的组。
 */
export { cardGroupsOf };
