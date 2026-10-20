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
import { parseSecretRefs, summarizeKeyStatus, validateSecretInput } from "../core/switching/search-keys";
import { SETTINGS_CARDS, type SettingsCard } from "./settings-cards";
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
  /**
   * 凭据引用名 → 是否**真的**配置了（界面用来显示「已添加 / 未添加」）。
   *
   * 为什么由容器传进来：判断要读宿主的凭据服务，那是远程调用；页面外壳是纯函数。
   * 缺省（还没读到）时**不显示任何徽标** —— 不猜「未添加」，那会误报。
   */
  credentialStatus?: Readonly<Record<string, boolean>>;
  /**
   * 写入一把密钥到凭据库（搜索设置卡的「保存密钥」）。
   *
   * 为什么需要：那个「引用名」输入框只写**名字**，真 key 必须另有一条通道进凭据库 ——
   * 否则用户填完名字点保存，库里仍然没有 key（2026-10-20 报障的根因）。
   * 缺省表示宿主不支持（老宿主）：那时整块密钥输入不渲染。
   * @returns `undefined` 表示成功；否则是人话原因。
   */
  onSaveSecret?: (ref: string, secret: string) => Promise<string | undefined>;
  /** 正在写密钥（按钮禁用 + 换文案）。 */
  secretSaving?: boolean;
  /** 密码框的当前值（受控：页面是纯函数，草稿由容器持有）。 */
  secretDraft?: string;
  onSecretDraftChange?: (value: string) => void;
  /** 上一次写密钥的结果（`undefined`/空串 = 成功；否则是人话原因）。 */
  onSecretError?: (error: string | undefined) => void;
  secretError?: string | undefined;
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
    ...SETTINGS_CARDS.map((card) => settingsCardElement(props, vendors, card)),
    // 保存条：**任何一行**有未保存改动时出现（含功能页 —— 它的字段也存在承载行文档里）。
    // 只看厂商行会让「启用自动切换」这类开关改了之后没有保存按钮（2026-10-20 报障）。
    vendors.some((entry) => isDirty(props.state, entry.ns))
      ? mergedSaveBar(props, vendors)
      : null,
  );
}


/**
 * 一张功能卡片：把三家（以及功能页）里属于这张卡的字段**合并去重**后渲染。
 *
 * 形状：
 * 1. 共有字段只渲染**一次**（三家同名同义，写回时会镜像）；
 * 2. `specific` 字段只渲染它归属的那一家，并标注厂商徽标；
 * 3. 没有卡片级开关 —— 收起/展开由 `<details>` 的箭头负责（2026-10-20 用户要求去掉
 *    「启用自动切换 / 开启网页搜索」两个界面开关：卡片本来就能收起，多一个开关反而
 *    让人误以为关掉会禁用功能）。
 * @param props - 页面属性。
 * @param vendors - 参与合并的厂商行（含功能页，它的值代表承载行）。
 * @param card - 卡片声明。
 * @returns 可折叠卡片元素。
 */
function settingsCardElement(
  props: PageShellProps,
  vendors: readonly VendorEntry[],
  card: SettingsCard,
): ReactNode {
  const { t } = props;
  const nodes: ReactNode[] = [];

  /** 在合并后的厂商列表里找某个共有字段的声明（取第一家）。 */
  const sharedField = (key: string): { owner: VendorEntry; field: DraftField } | undefined => {
    for (const entry of vendors) {
      const field = fieldsOf(props.state, entry).find((candidate) => candidate.spec.key === key);
      if (field !== undefined) return { owner: entry, field };
    }
    return undefined;
  };

  // 1) 共有字段：第一次出现时渲染一次。
  for (const key of card.shared) {
    const found = sharedField(key);
    if (found === undefined) continue;
    nodes.push(fieldElement(props, found.owner, found.field));
  }

  // 2) 厂商专属字段：按厂商顺序渲染，并标注归属。
  for (const vendor of vendors) {
    for (const field of fieldsOf(props.state, vendor)) {
      const declared = card.specific.find((item) => item.key === field.spec.key && item.vendor === vendor.providerId);
      if (declared === undefined) continue;
      nodes.push(fieldElement(props, vendor, field, labelOf(props, vendor)));
    }
  }

  // 3) 搜索卡额外挂一块「保存密钥」：引用名输入框只写名字，真 key 得另行入库。
  if (card.id === "search") nodes.push(secretBlockOf(props, sharedField("searchApiKeyRefs")?.field));

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
 * 「保存密钥」那一块：密码框 + 按钮。
 *
 * 为什么必须单独一块：搜索卡的「引用名」是个**设置字段**，点保存只把名字写进
 * `cordis.patch.yml`；真 key 要走凭据服务。少了这一块，用户填完名字点保存，
 * 库里仍然没有 key，徽标一直显示「未添加」（2026-10-20 报障的根因）。
 *
 * 输入框**不带 `data-field`**：那是设置字段的标记，带上它会和设置草稿/保存条共用一条通道，
 * 而这个值绝不能进设置文档。
 * @param props - 页面属性。
 * @param refsField - 引用名字段（用它当前的值决定写到哪个槽）；没有该字段时整块不渲染。
 * @returns 元素；宿主不支持写凭据（`onSaveSecret` 缺省）时为 `null`。
 */
function secretBlockOf(props: PageShellProps, refsField: DraftField | undefined): ReactNode {
  const save = props.onSaveSecret;
  if (save === undefined || refsField === undefined) return null;
  const { t } = props;
  const refs = parseSecretRefs(String(refsField.value ?? ""));
  const ref = refs[0];
  if (ref === undefined) {
    // 还没有引用名：说清楚要先填上面那一项（否则这个按钮点了也不知道往哪写）。
    return createElement(
      "div",
      { key: "secret", "data-secret-block": "no-ref", className: CSS_CLASS.inset },
      createElement("small", { className: CSS_CLASS.note }, t("search.secretNeedRef")),
    );
  }
  return createElement(
    "div",
    { key: "secret", "data-secret-block": ref, className: CSS_CLASS.inset },
    createElement(
      "div",
      { className: CSS_CLASS.actions },
      createElement("input", {
        "data-secret-input": ref,
        type: "password",
        // 受控值由容器持有（页面是纯函数，不留状态）。
        value: props.secretDraft ?? "",
        placeholder: t("search.secretPlaceholder"),
        autoComplete: "off",
        onChange: (event: { target?: { value?: string } }) => props.onSecretDraftChange?.(event.target?.value ?? ""),
      }),
      createElement(
        "button",
        {
          type: "button",
          "data-secret-save": ref,
          className: CSS_CLASS.buttonPrimary,
          disabled: props.secretSaving === true,
          onClick: () => {
            const secret = props.secretDraft ?? "";
            const problem = validateSecretInput(secret, refs);
            if (problem !== undefined) {
              props.onSecretError?.(problem);
              return;
            }
            void save(ref, secret.trim()).then((error) => props.onSecretError?.(error));
          },
        },
        props.secretSaving === true ? t("search.secretSaving") : t("search.secretSave"),
      ),
    ),
    createElement("small", { className: CSS_CLASS.note }, t("search.secretHint")),
    props.secretError === undefined || props.secretError === ""
      ? null
      : createElement("small", { "data-secret-error": true, className: CSS_CLASS.failure }, props.secretError),
  );
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
  // 凭据类字段的「已添加 / 未添加」徽标。
  //
  // 用户报障：「添加 API KEY 后保存了，没有显示我是否已经添加」。那个框填的是**引用名**，
  // 真 key 在凭据库里 —— 填了名字不等于库里有 key，所以必须去查一次并显示出来。
  // 查不到（还没读回来）时**什么都不显示**：猜「未添加」会误报。
  const credentialBadge = credentialBadgeOf(props, field);
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
        // 「已添加 / 未添加」徽标（只在凭据类字段上出现）。
        ...(credentialBadge === null ? [] : [credentialBadge]),
      ),
      hint,
    ),
    control,
  );
}

/**
 * 凭据类字段的「已添加 / 未添加」徽标。
 *
 * 只对**引用名类**字段生效（搜 key 的那个），值可能是逗号分隔的多个引用名：
 * 逐个查库，全部配好才说「已添加」，部分配置说「部分已添加」并点名缺哪个。
 * @param props - 页面属性（含容器传进来的状态表）。
 * @param field - 字段的控件状态。
 * @returns 徽标元素；不适用或状态还没读回来时为 `null`。
 */
function credentialBadgeOf(props: PageShellProps, field: DraftField): ReactNode {
  const status = props.credentialStatus;
  if (status === undefined) return null; // 还没读回来：不猜
  const spec = field.spec;
  if (spec.kind !== "text" || !/KeyRefs?$|ApiKey/i.test(spec.key)) return null;
  const refs = String(field.value ?? "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
  if (refs.length === 0) return null;
  const rows = refs.map((ref) => ({ ref, configured: status[ref] === true }));
  const summary = summarizeKeyStatus(rows);
  const label =
    summary.state === "configured"
      ? props.t("search.keyConfigured")
      : summary.state === "partial"
        ? `${props.t("search.keyConfigured")} ${summary.configured}/${summary.total}`
        : props.t("search.keyMissing");
  return createElement(
    "small",
    {
      key: "credential",
      "data-credential-status": summary.state,
      "data-credential-missing": summary.missing.join(","),
      className: summary.state === "configured" ? CSS_CLASS.mark : CSS_CLASS.failure,
    },
    label,
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
