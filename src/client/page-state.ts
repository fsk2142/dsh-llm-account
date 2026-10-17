/**
 * 统一设置页的**状态机**（纯函数，完全不碰 React）。
 *
 * 为什么单独一层：页面要在标签页之间保持草稿、判断「有没有改动」、按厂商声明决定渲染哪几组
 * 卡片、并在凭据变更推送到达时刷新徽标 —— 这些都会出错，而它们不该靠渲染组件来验证。
 * React 那层只做「状态 → 元素树」的翻译（`page.ts`），本文件负责所有判定。
 *
 * 不可变约定：每个函数都返回**新**状态对象（`noteCredentialChange` 保留未动字段的引用，
 * 让宿主能靠引用比较决定是否重渲染）。
 * @module dsh-llm-account/src/client/page-state
 */
import type { CardGroupSpec, FieldSpec, VendorEntry } from "./registry";
import type { DiscoveryProblem } from "./seams";

/** 宿主设置命名空间的一份快照：值 + 修订号（保存时要用它做并发围栏）。 */
export interface VendorSnapshot {
  ns: string;
  /**
   *  describe 时**命中的行名**：写路径必须用它，不能用 `ns`。
   *
   * 宿主设置服务按 profile 条目 id 寻址（`SettingsForms.write` 找 `row.options.id === ns`），
   * 而 opencode 的条目 id（`opencode-go`）与本包的核心命名空间（`llm-opencode-go`）**不同** ——
   * 用 `ns` 写会落到一个不存在的条目上（commandcode 两者相同，所以只有 opencode 会中招）。
   * 旧宿主上两者相同时，这个值就等于 `ns`。
   */
  row: string;
  value: Record<string, unknown>;
  revision: number;
}

/** 一个标签页。 */
export interface VendorTab {
  ns: string;
  providerId: string;
  labelKey: string;
  order: number;
}

/** 一个字段的渲染状态。 */
export interface DraftField {
  spec: FieldSpec;
  /** 草稿 → 基线 → 声明默认值。都没有就是 `undefined`（没有默认值的可选字段）。 */
  value: unknown;
  /** 是否与基线不同。 */
  changed: boolean;
}

/**
 * 账户卡片正在进行的操作（**受控草稿**）。
 *
 * 为什么放在这里而不是卡片里：卡片是纯函数（Ruling 22 的 Humble Object 切分），不能持有状态；
 * 而「用户输入到一半的账户名/密钥」必须活得比一次渲染久。放在 `page-state` 里它就能被完整单测，
 * 卡片只负责把值渲染出来、把变化报出去。
 *
 * `key` 是**明文密钥的临时草稿**：它只经 `replaceKey`/`addAccount` 那次远程调用出去，
 * 永远不进设置文档，也不进设置草稿（`drafts`）——两者是刻意分开的两套状态。
 */
export interface AccountAction {
  kind: "add" | "rename" | "key";
  /** `rename`/`key` 的目标账号；`add` 时为 `undefined`。 */
  ref?: string;
  /** 用户正在输入的名称（`add`/`rename`）。 */
  label: string;
  /** 用户正在输入的密钥（`add`/`key`）。 */
  key: string;
}

/** 页面状态。 */
export interface PageState {
  /** 全部已注册厂商（含宿主上不存在的，供诊断）。 */
  readonly entries: readonly VendorEntry[];
  /** 真正要渲染的标签页：已注册 **且** 宿主上存在该设置命名空间，按 `order` 升序。 */
  readonly tabs: readonly VendorTab[];
  /** 当前标签页；没有标签页时为 `undefined`。 */
  readonly activeNs: string | undefined;
  /** 草稿：ns → 字段 → 值（**只放与基线不同**的字段）。 */
  readonly drafts: Readonly<Record<string, Record<string, unknown>>>;
  /** 基线快照：ns → 值 + 修订号。 */
  readonly snapshots: Readonly<Record<string, VendorSnapshot>>;
  /** 凭据变更计数：每次推送 +1，「已配置」徽标据此刷新。 */
  readonly credentialRevision: number;
  /** 正在进行的账户操作（`⋯` 菜单/添加账户/换密钥）；没有就是 `undefined`。 */
  readonly action: AccountAction | undefined;
  /** 展开完整报告的账号 ref；没有就是 `undefined`。 */
  readonly expandedRef: string | undefined;
  /**
   * 保存失败的可读原因：ns → 宿主给出的文案。
   *
   * 存在理由：保存失败此前**完全静默**（`saveSettings` 返回 false 后被丢掉），用户点了保存
   * 以为落盘了，其实没有 —— 草稿还在，刷新页面即丢失。失败原因显示在保存条上，保存成功
   * 即清除。
   */
  readonly saveErrors: Readonly<Record<string, string>>;
  /**
   * 厂商发现的失败原因；`undefined` 表示发现成功（或还没有发现过）。
   *
   * 与 `saveErrors` 同理：没有它，「没有可显示的厂商」这一句话对应四种完全不同的病因
   * （远程面缺席 / `describe()` 抛错 / 返回形状不认识 / 命名空间对不上），页面无法自证，
   * 排障只能靠猜。空态把它显示出来。
   */
  readonly discovery: DiscoveryProblem | undefined;
}

/** 三组卡片的规范顺序（规格 §8 的卡片顺序：隐私与安全 → 集成与显示 → 高级设置）。 */
const GROUP_ORDER: readonly CardGroupSpec["group"][] = ["privacy", "integrations", "advanced"];

/**
 * 建一个页面状态。
 * @param entries - 注册表里的厂商声明。
 * @param snapshots - 宿主上实际存在的设置命名空间快照（发现的依据，见 Ruling 2）。
 * @param previous - 上一个状态：提供了就**保留草稿与凭据计数**（重新读设置不该把用户没保存的
 *   输入丢掉）。与快照已经一致的草稿会被清掉（那种「改动」已经没有意义）。
 * @param discovery - 本次厂商发现的失败原因（`undefined` 表示成功，空态据此自证）。
 * @returns 新状态：没有草稿时选中的是第一个标签页。
 */
export function createPageState(
  entries: readonly VendorEntry[],
  snapshots: readonly VendorSnapshot[],
  previous?: PageState,
  discovery?: DiscoveryProblem,
): PageState {
  const available = new Set(snapshots.map((snapshot) => snapshot.ns));
  const tabs = entries
    .filter((entry) => available.has(entry.ns))
    .sort((left, right) => left.order - right.order)
    .map((entry): VendorTab => ({ ns: entry.ns, providerId: entry.providerId, labelKey: entry.labelKey, order: entry.order }));
  const snapshotMap: Record<string, VendorSnapshot> = {};
  for (const snapshot of snapshots) {
    snapshotMap[snapshot.ns] = { ns: snapshot.ns, row: snapshot.row, value: { ...snapshot.value }, revision: snapshot.revision };
  }

  const drafts: Record<string, Record<string, unknown>> = {};
  for (const [ns, draft] of Object.entries(previous?.drafts ?? {})) {
    const baseline = snapshotMap[ns]?.value ?? {};
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!Object.is(baseline[key], value)) kept[key] = value;
    }
    if (Object.keys(kept).length > 0) drafts[ns] = kept;
  }

  const activeNs = previous !== undefined && tabs.some((tab) => tab.ns === previous.activeNs)
    ? previous.activeNs
    : tabs[0]?.ns;
  return {
    entries,
    tabs,
    activeNs,
    drafts,
    snapshots: snapshotMap,
    credentialRevision: previous?.credentialRevision ?? 0,
    // 账户操作的草稿跨快照刷新保留（重读设置不该把用户输入到一半的名字/密钥丢掉）。
    action: previous?.action,
    // 展开状态也保留；卡片只在对应账号行存在时才用得上它。
    expandedRef: previous?.expandedRef,
    // 保存失败的原因同样跨刷新保留：它描述的还是当前这份草稿的问题，下一次保存才可能改变它。
    saveErrors: previous?.saveErrors ?? {},
    // 发现成功即清空失败原因：上一次「读不到」不该在恢复后继续显示。
    discovery,
  };
}

/**
 * 记一次保存的结果：成功清除该厂商的失败原因，失败把可读原因放进去。
 * @param state - 当前状态。
 * @param ns - 设置命名空间。
 * @param error - 失败原因；`undefined` 表示保存成功。
 * @returns 新状态；结果没有变化时是恒等变换。
 */
export function noteSaveResult(state: PageState, ns: string, error: string | undefined): PageState {
  const current = state.saveErrors[ns];
  if (error === undefined ? current === undefined : current === error) return state;
  const saveErrors = { ...state.saveErrors };
  if (error === undefined) delete saveErrors[ns];
  else saveErrors[ns] = error;
  return { ...state, saveErrors };
}

/**
 * 打开一个账户操作（`⋯` 菜单项 / 添加账户）。重复打开同一目标时**不重置**已有输入。
 * @param state - 当前状态。
 * @param action - 要打开的操作（`label`/`key` 可省略，默认空串）。
 * @returns 新状态。
 */
export function openAction(state: PageState, action: { kind: AccountAction["kind"]; ref?: string }): PageState {
  if (state.action?.kind === action.kind && state.action.ref === action.ref) return state;
  return { ...state, action: { kind: action.kind, ...(action.ref === undefined ? {} : { ref: action.ref }), label: "", key: "" } };
}

/**
 * 改一个账户操作草稿字段。
 * @param state - 当前状态。
 * @param field - `label` 或 `key`。
 * @param value - 新值。
 * @returns 新状态；没有正在进行的操作时是恒等变换。
 */
export function setActionField(state: PageState, field: "label" | "key", value: string): PageState {
  if (state.action === undefined) return state;
  return { ...state, action: { ...state.action, [field]: value } };
}

/**
 * 关掉正在进行的账户操作（取消，或提交完成）。
 * @param state - 当前状态。
 * @returns 新状态。
 */
export function closeAction(state: PageState): PageState {
  if (state.action === undefined) return state;
  return { ...state, action: undefined };
}

/**
 * 展开/收起某个账号的完整报告。
 * @param state - 当前状态。
 * @param ref - 目标账号。
 * @returns 新状态。
 */
export function toggleExpanded(state: PageState, ref: string): PageState {
  return { ...state, expandedRef: state.expandedRef === ref ? undefined : ref };
}

/**
 * 切到某个标签页。未知的 ns 是恒等变换（不制造一个没有对应标签页的选中态）。
 * @param state - 当前状态。
 * @param ns - 目标设置命名空间。
 * @returns 新状态（草稿原样保留）。
 */
export function selectTab(state: PageState, ns: string): PageState {
  if (!state.tabs.some((tab) => tab.ns === ns)) return state;
  if (state.activeNs === ns) return state;
  return { ...state, activeNs: ns };
}

/**
 * 改一个字段的值。
 *
 * 写回与基线相同的值**不算改动**（草稿条目被丢掉）：否则「碰过这个输入框」会被误判成
 * 「有改动」，保存条就会在没有任何实际变化时出现。
 * @param state - 当前状态。
 * @param ns - 该厂商的设置命名空间。
 * @param key - 字段名。
 * @param value - 新值。
 * @returns 新状态。
 */
export function setField(state: PageState, ns: string, key: string, value: unknown): PageState {
  const draft: Record<string, unknown> = { ...(state.drafts[ns] ?? {}) };
  if (Object.is(state.snapshots[ns]?.value[key], value)) delete draft[key];
  else draft[key] = value;
  const drafts = { ...state.drafts };
  if (Object.keys(draft).length === 0) delete drafts[ns];
  else drafts[ns] = draft;
  return { ...state, drafts };
}

/**
 * 该厂商是否有未保存的改动（保存条的显示依据）。
 * @param state - 当前状态。
 * @param ns - 设置命名空间。
 * @returns 有改动为 `true`。
 */
export function isDirty(state: PageState, ns: string): boolean {
  return Object.keys(state.drafts[ns] ?? {}).length > 0;
}

/**
 * 该厂商待保存的字段（保存动作的输入）。
 * @param state - 当前状态。
 * @param ns - 设置命名空间。
 * @returns 字段与目标值，按用户改动的先后顺序。
 */
export function dirtyFields(state: PageState, ns: string): { key: string; value: unknown }[] {
  return Object.entries(state.drafts[ns] ?? {}).map(([key, value]) => ({ key, value }));
}

/**
 * 记一次凭据变更（宿主推送 `credentials/reference-updated`）。计数变化会让页面重新读
 * 「已配置」状态。
 * @param state - 当前状态。
 * @returns 新状态；未动的字段保持同一引用。
 */
export function noteCredentialChange(state: PageState): PageState {
  return { ...state, credentialRevision: state.credentialRevision + 1 };
}

/**
 * 该厂商声明的卡片组：**字段为空的组不渲染**（预检 Ruling 1），并按规范顺序排列。
 * @param entry - 厂商声明。
 * @returns 要渲染的组。
 */
export function cardGroupsOf(entry: VendorEntry): readonly CardGroupSpec[] {
  return [...entry.cards]
    .filter((group) => group.fields.length > 0)
    .sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
}

/** 声明里的全部字段（按卡片组的规范顺序展平）。 */
function declaredFields(entry: VendorEntry): readonly FieldSpec[] {
  return cardGroupsOf(entry).flatMap((group) => group.fields);
}

/**
 * 找一个字段的声明。
 * @param state - 当前状态（用它的注册表）。
 * @param ns - 设置命名空间。
 * @param key - 字段名。
 * @returns 声明；该厂商没声明这个字段时为 `undefined`。
 */
export function specOf(state: PageState, ns: string, key: string): FieldSpec | undefined {
  const entry = state.entries.find((candidate) => candidate.ns === ns);
  return entry === undefined ? undefined : declaredFields(entry).find((spec) => spec.key === key);
}

/**
 * 一个字段当前应显示的值：草稿 → 基线 → 声明默认值。都没有就是 `undefined`（**不编造**）。
 * @param state - 当前状态。
 * @param ns - 设置命名空间。
 * @param key - 字段名。
 * @returns 当前值。
 */
export function fieldValue(state: PageState, ns: string, key: string): unknown {
  const draft = state.drafts[ns];
  if (draft !== undefined && key in draft) return draft[key];
  const snapshot = state.snapshots[ns];
  if (snapshot !== undefined && key in snapshot.value) return snapshot.value[key];
  return specOf(state, ns, key)?.fallback;
}

/**
 * 一个厂商要渲染的全部字段（按卡片顺序展平，带当前值与「是否改动」）。
 * @param state - 当前状态。
 * @param entry - 厂商声明。
 * @returns 字段渲染状态。
 */
export function fieldsOf(state: PageState, entry: VendorEntry): DraftField[] {
  const baseline = state.snapshots[entry.ns]?.value ?? {};
  return declaredFields(entry).map((spec) => {
    const value = fieldValue(state, entry.ns, spec.key);
    return { spec, value, changed: !Object.is(baseline[spec.key], value) };
  });
}

/** 侧边栏额度卡片开关的字段名（规格 §8.1 第 6 条：它住在「集成与显示」里）。 */
export const SIDEBAR_TOGGLE_KEY = "showSidebarQuota";

/**
 * 清洗一个模型 id 列表。
 *
 * **丢弃空串与纯空白**（全局约束）：`[""]` 会被当作「非空白名单」，让所有模型从选择器里消失 ——
 * 这是既有的真实缺陷形态。顺带去掉首尾空白、丢掉非字符串、去重（保持首次出现的顺序）。
 * @param value - 原始值（可能来自设置文档，形状不可信）。
 * @returns 清洗后的模型 id 列表。
 */
export function normalizeModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 侧边栏额度卡片是否开启。
 *
 * **只读已存储的设置文档**（`snapshots[ns].value`），不看草稿 —— 旧插件的同一判定写得很清楚
 * （`@mars-sea/dsh-commandcode-provider/lib/client.js:7331-7334`）：「an unsaved draft cannot show
 * the card」。用 `fieldValue` 会把草稿也算进来，于是用户刚拨动开关（还没保存）卡片就亮了，
 * 而宿主其实还没落盘 —— 那正是「关闭时不后台刷新」要防的状态。
 * @param storedValue - 该厂商设置文档的当前值（不是草稿）。
 * @returns 是否开启（只有显式 `true` 才算）。
 */
export function sidebarQuotaEnabled(storedValue: Record<string, unknown> | undefined): boolean {
  return storedValue?.[SIDEBAR_TOGGLE_KEY] === true;
}

/**
 * 侧边栏卡片该显示哪一家。
 *
 * 插槽只有一个，而开关是按厂商存的：取**第一个**开启的厂商（按标签页顺序），确定性且可解释。
 * 两家都开时另一家的额度仍在各自的设置页标签页里看得到。
 * @param entries - 注册表里的厂商声明（已按页面顺序排列）。
 * @param snapshots - 各厂商的设置文档。
 * @returns 要显示的厂商；没有开启的厂商时为 `undefined`（此时**不注册卡片**）。
 */
export function sidebarVendorOf(
  entries: readonly VendorEntry[],
  snapshots: Readonly<Record<string, VendorSnapshot>>,
): VendorEntry | undefined {
  return entries.find((entry) => sidebarQuotaEnabled(snapshots[entry.ns]?.value));
}

/**
 * 该厂商要渲染哪些专属卡片，顺序即规格 §8 的卡片顺序（账户卡片 → 模型卡片）。
 *
 * 单独成函数：`index.ts` 的接线不参与单测（Ruling 22），而「厂商不支持的卡片不渲染」是计划
 * 明确要求的验收点（T7 Step 1）。这里把规则变成可测的纯函数。
 * @param entry - 厂商声明。
 * @returns 要渲染的卡片种类。
 */
export function vendorCardKinds(entry: VendorEntry): readonly ("accounts" | "models")[] {
  return entry.models === undefined ? ["accounts"] : ["accounts", "models"];
}

/**
 * 一次模型编辑算出的新设置值。
 *
 * 两个字段一起算：白名单（`visibleModels`）与逐模型显隐（`modelVisibility`）是同一件事的两种
 * 表达，分开改会出现「在白名单里但被显式隐藏」这种自相矛盾的状态。
 */
export interface ModelEditPatch {
  visibleModels: string[];
  modelVisibility: Record<string, boolean>;
}

/** 一次模型编辑。 */
export type ModelEdit =
  | { kind: "toggle"; model: string; visible: boolean }
  | { kind: "add"; model: string }
  | { kind: "remove"; model: string };

/**
 * 把一次模型编辑应用到当前设置值上（纯函数）。
 * @param current - 当前设置文档里的两个字段（形状不可信，一律先清洗）。
 * @param edit - 要做的编辑。
 * @returns 两个字段的新值（白名单已清洗：空串与纯空白绝不会被写回去）。
 */
export function applyModelEdit(current: { visible: unknown; visibility: unknown }, edit: ModelEdit): ModelEditPatch {
  const visibleModels = normalizeModels(current.visible);
  const rawVisibility = current.visibility;
  const modelVisibility =
    typeof rawVisibility === "object" && rawVisibility !== null && !Array.isArray(rawVisibility)
      ? { ...(rawVisibility as Record<string, boolean>) }
      : {};

  // id 先统一清洗：白名单里存的是 trim 过的，显隐的**键**也必须是同一个 —— 否则
  // `" m2 "` 会造出一条永远匹配不上的显隐记录（测试抓出过这个 bug）。
  const model = edit.model.trim();
  if (model === "") return { visibleModels, modelVisibility };

  if (edit.kind === "toggle") {
    modelVisibility[model] = edit.visible;
    return { visibleModels, modelVisibility };
  }
  if (edit.kind === "add") {
    // 用户点「添加」的意图就是「让它可用」：进白名单，同时显式可见（清掉可能存在的 false）。
    const next = normalizeModels([...visibleModels, model]);
    modelVisibility[model] = true;
    return { visibleModels: next, modelVisibility };
  }
  // remove：从白名单里去掉，并清掉它的显隐条目（否则它会因为还存在 visibility 键而回到列表里）。
  delete modelVisibility[model];
  return { visibleModels: visibleModels.filter((candidate) => candidate !== model), modelVisibility };
}

/**
 * 一次模型可见性编辑该走哪条路。
 *
 * `onSave`（Command Code）→ 进设置草稿，由底部保存条提交；`immediate`（OpenCode）→ 立刻写。
 * 单独成函数：这是计划 Step 1 要求「按能力区分」的那条判定本身，而容器的定时器/状态不参与单测。
 * @param mode - 该厂商声明的写入时机。
 * @returns `draft` 表示进草稿等保存，`now` 表示立刻写。
 */
export function modelEditTarget(mode: "onSave" | "immediate"): "draft" | "now" {
  return mode === "immediate" ? "now" : "draft";
}

/**
 * 取该厂商「集成与显示」里的侧边栏卡片开关声明。
 * @param entry - 厂商声明。
 * @returns 开关声明；该厂商没声明时 `undefined`（此时不渲染卡片，也不轮询）。
 */
export function sidebarToggleField(entry: VendorEntry): FieldSpec | undefined {
  const integrations = cardGroupsOf(entry).find((group) => group.group === "integrations");
  return integrations?.fields.find((spec) => spec.key === SIDEBAR_TOGGLE_KEY);
}
