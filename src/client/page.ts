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
import { ChevronIcon, RemoveIcon } from "./icons";
import { cardGroupsOf, FEATURE_TAB_NS, fieldsOf, specOf, type DraftField, type PageState } from "./page-state";
import { parseSecretRefs, summarizeKeyStatus, validateSecretInput } from "../core/switching/search-keys";
import { savesImmediately } from "./registry";
import type { CredentialProbe } from "./usage-contract";
import type { UpdateState } from "./update-check";
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
  /**
   * 改一个字段。
   *
   * 该不该立刻落盘由**容器**决定（判据是控件种类，见 `registry.ts` 的 `savesImmediately`）：
   * 开关/下拉改了就存；输入类只更新草稿，等卡片上的保存按钮。页面是纯渲染层，不判断存不存。
   */
  onSetField: (ns: string, key: string, value: unknown) => void;
  /**
   * 保存**一张卡片**里某一家尚未落盘的输入（卡片底部的「保存」按钮）。
   *
   * 用户 2026-10-20：「一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」。
   * @param ns - 要保存的那一家（宿主按条目 id 寻址，容器负责把 ns 换成行名）。
   */
  onSave: (ns: string) => void;
  /** 正在保存的那一家（只禁用它对应的按钮，并显示「保存中…」）。 */
  savingNs?: string;
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
  /** 删除一把已添加的密钥（列表每行的 ×）。 */
  onRemoveSecret?: (ref: string) => void;
  /**
   * 测试一把密钥能不能用（每行的「测试」按钮）。
   *
   * 用户 2026-10-20：「或者多增加一个测试按钮，让用户可以自行测试密钥的有效性」。
   * 缺省时按钮不渲染（老宿主没有实测通道 —— 不留一个点了没反应的死按钮）。
   */
  onTestSecret?: (ref: string) => void;
  /** 各把密钥的实测结论（`ref → 结论`）；没测过的不在里面。 */
  keyProbes?: Readonly<Record<string, CredentialProbe>>;
  /** 正在测试哪一把（按钮禁用 + 换文案）。 */
  keyProbing?: string;
  /**
   * 是否显示「插件已更新，刷新页面」的提示条。
   *
   * 由容器判定：设置页已经能打开、但侧边栏卡片没挂上 —— 那正是「插件没进客户端启动图」的
   * 可观测症状。这种情况下页面自己刷新一次就能修好，不必重启宿主。
   */
  reloadHint?: boolean;
  /** 「刷新页面」的动作（缺省时按钮仍显示，但点了没反应 —— 生产总会传）。 */
  onReload?: () => void;
  /**
   * 插件自身的更新状态（缺省 = 容器没有提供，整块不渲染）。
   *
   * 三种结论由 `update-check.ts` 判定：`available` 才画「更新」按钮；
   * `not-applicable`（本地链接安装）如实说明它不会更新 —— 那种装法跟着源码走。
   */
  update?: UpdateState;
  /** 正在检查或正在更新（按钮禁用 + 换文案）。 */
  updateBusy?: boolean;
  /** 主动检查一次。 */
  onCheckUpdate?: () => void;
  /** 开始更新（只在 `available` 时可用）。 */
  onUpdate?: () => void;
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

/**
 * 「插件已更新，刷新页面即可」的提示条（用户 2026-10-20 要求）。
 *
 * 为什么需要它：宿主把**客户端启动图**在页面加载那一刻就定下来了，之后新装/更新的插件不会
 * 自动进图 —— 于是侧边栏卡片、中台面板都「不出现」，只有重启宿主才行。而**刷新页面**会让
 * 浏览器重走一遍启动图，效果与重启等价。
 *
 * 什么时候显示：由容器判断（`reloadHint`）。判据是「设置页已经能打开、但侧边栏卡片没挂上」——
 * 那正是「插件没进启动图」的可观测症状。页面层只负责渲染，不自己猜。
 * @param props - 页面属性。
 * @param t - 取词函数。
 * @returns 提示条；不需要提示时 `null`。
 */
function reloadNotice(props: PageShellProps, t: (key: string) => string): ReactElement | null {
  if (props.reloadHint !== true) return null;
  return createElement(
    "div",
    { "data-reload-hint": "true", className: CSS_CLASS.notice },
    createElement("strong", { className: CSS_CLASS.noticeTitle }, t("update.title")),
    createElement("small", null, t("update.body")),
    createElement(
      "button",
      {
        type: "button",
        "data-reload-now": "true",
        className: `${CSS_CLASS.buttonPrimary} ${CSS_CLASS.buttonSm}`,
        // 页面是纯函数：真正的刷新由容器给的回调做（测试里可以注入替身）。
        onClick: () => props.onReload?.(),
      },
      t("update.action"),
    ),
  );
}

/**
 * 「检查更新 / 更新」区块（用户 2026-10-20：「希望加一个更新，这样有新版本的时候直接更新
 * 就可以，就不用每次卸载后重新装」）。
 *
 * 三种结论分别渲染，**尤其不把「链接安装」说成「已是最新」**：
 * 后者会让用户等一个永远不会来的按钮（那种装法跟着源码走，本来就没有「新版本」这回事）。
 * @param props - 页面属性。
 * @param t - 取词函数。
 * @returns 区块元素；容器没有提供更新状态时为 `null`（老宿主不渲染死按钮）。
 */
function updateBlock(props: PageShellProps, t: (key: string) => string): ReactElement | null {
  const state = props.update;
  if (state === undefined) return null;
  const replace = (template: string, values: Record<string, string>): string =>
    template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

  const canUpdate = state.kind === "available";
  const label =
    state.kind === "available"
      ? replace(t("update.available"), { installed: state.installed, latest: state.latest })
      : state.kind === "current"
        ? replace(t("update.current"), { installed: state.installed })
        : state.kind === "not-applicable"
          ? replace(t("update.notApplicable"), { installed: state.installed })
          : replace(t("update.unknown"), { reason: state.kind === "unknown" ? state.reason : "" });
  return createElement(
    "div",
    { "data-update-block": state.kind, className: CSS_CLASS.notice },
    createElement("strong", { className: CSS_CLASS.noticeTitle }, t("update.section")),
    createElement("small", null, props.updateBusy === true ? t("update.checking") : label),
    // 「更新」只在**真的有新版**时出现（`not-applicable` / `current` 都不画一个点不动的按钮）。
    canUpdate
      ? createElement(
          "button",
          {
            type: "button",
            "data-update-start": "true",
            className: `${CSS_CLASS.buttonPrimary} ${CSS_CLASS.buttonSm}`,
            disabled: props.updateBusy === true,
            onClick: () => props.onUpdate?.(),
          },
          props.updateBusy === true ? t("update.starting") : t("update.start"),
        )
      : // 其余情况给「检查一次」：用户随时可以主动问，而不是等它自己刷新。
        createElement(
          "button",
          {
            type: "button",
            "data-update-check": "true",
            className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
            disabled: props.updateBusy === true,
            onClick: () => props.onCheckUpdate?.(),
          },
          t("update.check"),
        ),
  );
}

/** 渲染失败时的兜底：**不调用 `t()`**（取词本身可能就是抛错的原因）。 */
function renderErrorPanel(error: unknown): ReactElement {  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return createElement(
    "div",
    { "data-page": "llm-account", className: CSS_CLASS.root },
    createElement("h1", null, "LLM 账号"),
    createElement("pre", { "data-render-error": "true", className: CSS_CLASS.diagnostic }, `render failed: ${detail}`),
  );
}

/** 外壳本体（假定不抛；抛了由 {@link PageShell} 接住）。 */
function pageBody(props: PageShellProps): ReactElement {  const { state, entries, t } = props;
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
    reloadNotice(props, t),
    props.accounts === undefined ? null : props.accounts,
    updateBlock(props, t),
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
    // 底部**不再有保存条**（用户 2026-10-20：「任何选项修改了就是直接保存，不需要那个保存
    // 按钮了」）。改动由容器在 `onSetField` 里立刻落盘；失败原因挂在**各自卡片里**显示。
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

  // 3) 搜索卡额外挂一块「密钥管理」：引用名列表**不再是设置字段**（用户不填它），
  // 所以这里直接从承载行的值读，而不是通过字段声明。
  if (card.id === "search") nodes.push(secretBlockOf(props, vendors));

  // 4) 保存条：**本卡有未保存输入时**才出现（用户 2026-10-20：「一个卡片保留一个保存按钮，
  // 点完保存后按钮消失，如果复原则不显示保存」）。开关/下拉改了就存，不产生草稿，所以它们
  // 永远不点亮这根按钮 —— 只有输入类（文本/数字/时长）会。
  const pending = pendingSavesOf(props, vendors, card);
  const saveBar = cardSaveBar(props, card, pending);
  if (saveBar !== null) nodes.push(saveBar);

  // 5) 保存失败原因：挂在**卡片里**（错误必须能看见 —— 静默失败会让人以为改成功了）。
  //
  // 只挂在本卡**确实承载了那家字段**的时候：否则四张卡会把同一条错误各印一遍，看起来像四处都坏了。
  for (const item of cardErrorsOf(props, vendors, card)) {
    nodes.push(
      createElement(
        "small",
        {
          key: `save-error-${item.ns}`,
          "data-save-error": item.ns,
          "data-save-error-reason": item.error,
          className: CSS_CLASS.failure,
        },
        t("save.failed"),
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
 * 这张卡片里**有未保存输入**的那些厂商行。
 *
 * 判据只有一条：本卡承载的字段里，存在**留在草稿中**且属于输入类的键。
 * 于是三种情况自动成立，不需要额外状态：
 * - 开关/下拉 → 改了立刻落盘 → 草稿被容器消化 → 不进这个清单（保存按钮不出现）；
 * - 输入类改了 → 进清单 → 卡片底部出现保存按钮；
 * - 用户把输入改回原值 → `setField` 删掉草稿条目（与基线相同）→ 退出清单 → 按钮自己消失。
 *
 * **不能用 `DraftField.changed` 判断**：它把「文档里没有这个键」与「声明的默认值」也算成改动，
 * 于是每家都会命中（实测：只改 commandcode 的 apiBase，三家各冒出一根按钮）。
 * @param props - 页面属性。
 * @param vendors - 参与合并的厂商行。
 * @param card - 卡片声明。
 * @returns 未保存输入的归属（ns + 展示名），按厂商顺序。
 */
function pendingSavesOf(
  props: PageShellProps,
  vendors: readonly VendorEntry[],
  card: SettingsCard,
): { ns: string; label: string }[] {
  const out: { ns: string; label: string }[] = [];
  for (const entry of vendors) {
    const draft = props.state.drafts[entry.ns];
    if (draft === undefined) continue;
    const dirty = Object.keys(draft).some((key) => {
      const spec = specOf(props.state, entry.ns, key);
      // 只认输入类；开关/下拉是「改了就存」，它们此刻还在草稿里说明写入尚未回来或失败了，
      // 那种情况由下面第四步的错误提示负责，不该再给一个保存按钮。
      if (spec === undefined || savesImmediately(spec.kind)) return false;
      // 这个字段归本卡吗（共有字段算承载它的第一家）。
      return cardCarries(card, vendors, entry, key);
    });
    if (dirty) out.push({ ns: entry.ns, label: labelOf(props, entry) });
  }
  return out;
}

/**
 * 一个字段是否由「这一家 × 这一张卡」渲染。
 *
 * 共有字段只渲染一次（承载者是厂商顺序里的第一家），所以只有那一家算数 —— 否则三家会各出一根
 * 按钮、各印一条错误。专属字段看本卡的声明。
 * @param card - 卡片声明。
 * @param vendors - 参与合并的厂商行。
 * @param entry - 字段所属厂商行。
 * @param key - 字段名。
 * @returns 是否归这张卡的这一家。
 */
function cardCarries(
  card: SettingsCard,
  vendors: readonly VendorEntry[],
  entry: VendorEntry,
  key: string,
): boolean {
  if (card.shared.includes(key)) {
    const owner = vendors.find((candidate) => specOfFor(candidate, key) !== undefined);
    return owner?.ns === entry.ns;
  }
  return card.specific.some((declared) => declared.key === key && declared.vendor === entry.providerId);
}

/** 某一家是否声明了这个字段（与 `specOf` 同义，但只需要「有没有」，不需要状态）。 */
function specOfFor(entry: VendorEntry, key: string): true | undefined {
  return fieldsOfKeys(entry).includes(key) ? true : undefined;
}

/** 一家声明过的全部字段名。 */
function fieldsOfKeys(entry: VendorEntry): string[] {
  return cardGroupsOf(entry).flatMap((group) => group.fields.map((field) => field.key));
}

/**
 * 这张卡片该显示哪些保存失败原因。
 *
 * 判据是「本卡**是否承载**了这一家的字段」：三家字段合并渲染，一条失败只该出现在用户刚动过
 * 那一项的那张卡下面。全部无条件显示的话，四张卡会把同一条错误各印一遍 —— 用户会以为自己
 * 弄坏了四张卡。找不到归属时（该家字段都不在本卡）不显示，而不是猜一张。
 * @param props - 页面属性。
 * @param vendors - 参与合并的厂商行。
 * @param card - 卡片声明。
 * @returns 该显示的失败原因（ns + 可读原因）。
 */
function cardErrorsOf(
  props: PageShellProps,
  vendors: readonly VendorEntry[],
  card: SettingsCard,
): { ns: string; error: string }[] {
  const out: { ns: string; error: string }[] = [];
  for (const entry of vendors) {
    const error = props.state.saveErrors[entry.ns];
    if (typeof error !== "string" || error === "") continue;
    // 优先按**失败的字段**归属：那条错误只该出现在用户刚填的那一项所在的卡里。
    const failed = props.state.saveErrorFields[entry.ns];
    const carries =
      failed !== undefined && failed.length > 0
        ? failed.some((key) => cardCarries(card, vendors, entry, key))
        : // 没有字段清单（老状态/直接构造的状态）：退化为「只在该家的第一张卡里印一次」。
          isFirstCarryingCard(vendors, entry, card);
    if (carries) out.push({ ns: entry.ns, error });
  }
  return out;
}

/**
 * 这张卡是不是「该家在页面上出现的第一张」。
 *
 * 没有失败字段清单时的退化归属：至少保证一条错误只印一次，而不是在有该家字段的每张卡里各印一遍。
 * @param vendors - 参与合并的厂商行。
 * @param entry - 出错的厂商行。
 * @param card - 卡片声明。
 * @returns 是否是第一张承载该家字段的卡。
 */
function isFirstCarryingCard(
  vendors: readonly VendorEntry[],
  entry: VendorEntry,
  card: SettingsCard,
): boolean {
  const keys = fieldsOfKeys(entry);
  for (const candidate of SETTINGS_CARDS) {
    const carries = [...candidate.shared, ...candidate.specific.map((item) => item.key)].some(
      (key) => keys.includes(key) && cardCarries(candidate, vendors, entry, key),
    );
    if (carries) return candidate.id === card.id;
  }
  return false;
}

/**
 * 搜索密钥那一块：**输入框 + 添加按钮 + 已添加列表**。
 *
 * 用户 2026-10-20：「只保留保存密钥那个，没添加一个就自动显示添加了一个，然后还可以点 x
 * 删除已经添加的」。所以：
 * 1. 不再让用户填「引用名」—— 那份列表（`searchApiKeyRefs`）由添加/删除动作维护；
 * 2. 添加成功就出现在下面的列表里（每条显示「已添加 / 未添加」）；
 * 3. 每条带 × 删除。
 *
 * 输入框**不带 `data-field`**：那是设置字段的标记，带上会与设置草稿/保存条共用一条通道，
 * 而密钥这个值绝不能进设置文档。
 * @param props - 页面属性。
 * @param refsField - 承载现有引用名列表的设置字段；没有该字段时整块不渲染。
 * @returns 元素；宿主不支持写凭据（`onSaveSecret` 缺省）时为 `null`。
 */
function secretBlockOf(props: PageShellProps, vendors: readonly VendorEntry[]): ReactNode {
  const save = props.onSaveSecret;
  if (save === undefined) return null;
  const { t } = props;
  // 引用名列表住在承载行的设置文档里，但它**不是**用户可编辑的字段，所以不走 `fieldsOf`。
  //
  // **必须先看草稿**：添加/删除写的是草稿（还没落盘）。只看快照就等于「点了没反应」——
  // 用户的改动要等下一次宿主重读才进快照，而那期间界面已经渲染过一轮了。
  const pick = (entry: VendorEntry): unknown => {
    const draft = props.state.drafts[entry.ns]?.["searchApiKeyRefs"];
    return draft !== undefined ? draft : props.state.snapshots[entry.ns]?.value?.["searchApiKeyRefs"];
  };
  const raw = vendors.map(pick).find((value) => value !== undefined);
  const refs = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
    : parseSecretRefs(typeof raw === "string" ? raw : "");

  const rows =
    refs.length === 0
      ? [
          createElement(
            "small",
            { key: "empty", "data-secret-empty": true, className: CSS_CLASS.note },
            t("search.secretEmpty"),
          ),
        ]
      : refs.map((ref) => {
          const configured = props.credentialStatus?.[ref];
          // 实测结论（`undefined` = 还没测过）：用户 2026-10-20 要求「添加后就验证一次」+
          // 「多一个测试按钮让他自己测」。三档都显示出来 —— `unknown` 不能说成「不可用」。
          const probe = props.keyProbes?.[ref];
          const probing = props.keyProbing === ref;
          return createElement(
            "div",
            {
              key: ref,
              "data-secret-row": ref,
              // 紧凑一档：这些是**列表项**，不是设置行。沿用 `dsl-field` 的 14px 字号 + 上下 8px
              // 内边距会让每条占将近 40px，两三条就把「高级/搜索」卡片撑得很长（用户反馈「默认名
              // 占的位置太宽，降低一下高度」）。类名另给，不靠覆盖去压设置行的规则。
              className: `${CSS_CLASS.field} ${CSS_CLASS.secretRow}`,
            },
            createElement(
              "span",
              { className: CSS_CLASS.fieldText },
              createElement("span", { className: CSS_CLASS.mono }, ref),
              // 状态未知（还没读回来）时不显示徽标 —— 不猜「未添加」。
              configured === undefined
                ? null
                : createElement(
                    "small",
                    {
                      key: "state",
                      "data-secret-state": configured ? "configured" : "missing",
                      className: configured ? CSS_CLASS.mark : CSS_CLASS.failure,
                    },
                    configured ? t("search.keyConfigured") : t("search.keyMissing"),
                  ),
              probe === undefined
                ? null
                : createElement(
                    "small",
                    {
                      key: "probe",
                      "data-secret-probe": probe.state,
                      // 宿主给的原因挂在 data 属性上：界面上是短标签，排查时能拿到原文。
                      ...(probe.reason === undefined ? {} : { "data-secret-probe-reason": probe.reason }),
                      className: probe.state === "ok" ? CSS_CLASS.mark : CSS_CLASS.failure,
                    },
                    probe.state === "ok"
                      ? t("search.keyOk")
                      : probe.state === "invalid"
                        ? t("search.keyInvalid")
                        : t("search.keyUnknown"),
                  ),
            ),
            // 测试按钮：随时自己验一次（添加时会自动验，这个按钮是「再验一次」与「排查」用）。
            props.onTestSecret === undefined
              ? null
              : createElement(
                  "button",
                  {
                    type: "button",
                    "data-secret-test": ref,
                    className: CSS_CLASS.buttonSm,
                    disabled: probing,
                    onClick: () => props.onTestSecret?.(ref),
                  },
                  probing ? t("search.keyTesting") : t("search.keyTest"),
                ),
            createElement(
              "button",
              {
                type: "button",
                "data-secret-remove": ref,
                className: CSS_CLASS.iconDanger,
                title: t("search.secretRemove"),
                "aria-label": t("search.secretRemove"),
                onClick: () => props.onRemoveSecret?.(ref),
              },
              createElement(RemoveIcon),
            ),
          );
        });

  return createElement(
    "div",
    { key: "secret", "data-secret-block": "true", className: CSS_CLASS.inset },
    createElement(
      "div",
      { className: CSS_CLASS.actions },
      createElement("input", {
        "data-secret-input": "true",
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
          "data-secret-add": "true",
          className: CSS_CLASS.buttonPrimary,
          disabled: props.secretSaving === true,
          onClick: () => {
            const secret = props.secretDraft ?? "";
            const problem = validateSecretInput(secret, ["pending"]);
            if (problem !== undefined) {
              props.onSecretError?.(problem);
              return;
            }
            // 引用名由容器分配（`nextKeyRef`），界面不参与命名。
            void save("", secret.trim()).then((error) => props.onSecretError?.(error));
          },
        },
        props.secretSaving === true ? t("search.secretSaving") : t("search.secretAdd"),
      ),
    ),
    createElement("small", { className: CSS_CLASS.note }, t("search.secretHint")),
    props.secretError === undefined || props.secretError === ""
      ? null
      : createElement("small", { "data-secret-error": true, className: CSS_CLASS.failure }, props.secretError),
    createElement("div", { key: "rows", "data-secret-rows": "true", className: CSS_CLASS.inset }, ...rows),
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
  //
  // 有未落盘的输入时标出来：卡片级保存按钮是「还在草稿里」的唯一线索，这个标记让用户看得出
  // 是哪几个字段没存（按钮只说「这张卡有东西没存」）。
  //
  // 判据是**草稿里有这个键**，不是 `field.changed`：后者会把「文档没写这个键、界面用了声明默认值」
  // 也算成改动（`autoSwitchModelOnQuota` 默认 false 就会永远亮着）。
  const pending = Object.hasOwn(props.state.drafts[entry.ns] ?? {}, spec.key);
  return createElement(
    "label",
    {
      key: spec.key,
      "data-field": spec.key,
      // 厂商专属字段带上归属，便于排查「这项只对某家生效」。
      ...(vendorLabel === undefined ? {} : { "data-field-vendor": entry.providerId }),
      ...(pending ? { "data-field-pending": "true" } : {}),
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
 * 一张卡片底部的保存按钮：**只有真有未落盘的输入时才渲染**。
 *
 * 用户 2026-10-20：「一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」。
 *
 * 三条都由这里保证：
 * 1. 没有未保存的输入 → 返回 `null`（按钮不出现，页面不常驻一根没用的按钮）；
 * 2. 保存中 → 显示「保存中…」并禁用（避免连点），保存成功后草稿与基线一致，下一帧按钮自己消失；
 * 3. 用户改回原值 → `setField` 会把草稿条目删掉（与基线相同），于是这里又是 `null`。
 *
 * 为什么按**厂商行**分别出一根按钮，而不是全页一根：四张卡里的字段来自三家，而保存是写某一家的
 * 设置文档（宿主按条目 id 寻址）。一根按钮要跨三家写，失败时也说不清是哪家失败了。同一张卡里
 * 若两家都有未保存输入，就并排出现两根（各自带厂商名，不会认错）。
 * @param props - 页面属性。
 * @param card - 卡片声明。
 * @param pending - 这张卡里**未保存输入**的归属（ns + 展示名）。
 * @returns 保存条元素；没有任何未保存输入时为 `null`。
 */
function cardSaveBar(
  props: PageShellProps,
  card: SettingsCard,
  pending: readonly { ns: string; label: string }[],
): ReactElement | null {
  if (pending.length === 0) return null;
  const { t } = props;
  const busy = props.savingNs !== undefined && pending.some((item) => item.ns === props.savingNs);
  return createElement(
    "div",
    { key: "save", "data-card-save": card.id, className: CSS_CLASS.save },
    ...pending.map((item) =>
      createElement(
        "button",
        {
          key: item.ns,
          type: "button",
          "data-save": item.ns,
          className: CSS_CLASS.buttonPrimary,
          disabled: props.savingNs !== undefined,
          onClick: () => props.onSave(item.ns),
        },
        busy && props.savingNs === item.ns ? t("saving") : t("save"),
        // 两家同时有未保存输入时才标厂商名：只有一家时那是废话。
        pending.length > 1 ? createElement("small", { key: "vendor" }, item.label) : null,
      ),
    ),
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
