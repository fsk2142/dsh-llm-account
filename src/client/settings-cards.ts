/**
 * 设置页的四张卡片：**按功能分组**，而不是按厂商分 tab（2026-10-20 用户要求）。
 *
 * 用户原话：
 * 1. 「三家设置合并在一起，除非某个设置是专门针对某一家网关的」
 * 2. 「不要那个设置对象，就按照可收起的卡片形式」
 * 3. 「显示设置，切换设置，搜索设置，高级设置，要四个卡片」
 *
 * ## 为什么把这份清单放在独立模块
 *
 * 「三家共有」与「厂商专属」的区分是**写回语义**，不只是排版：
 * - `shared` 里的字段写到任意一家都要**镜像**到另外两家（它们读各自的文档）；
 * - `specific` 里的字段只写它自己那一家（`apiBase` 对 opencode 毫无意义）。
 *
 * 把这条规则单独成表，写回逻辑与渲染逻辑都从同一份真相读取 —— 两处各写一份迟早分叉。
 * @module dsh-llm-account/src/client/settings-cards
 */

/** 卡片 id（顺序即渲染顺序）。 */
export type SettingsCardId = "display" | "switching" | "search" | "advanced";

/** 一个厂商专属字段：它只对某一家网关有效。 */
export interface SpecificField {
  /** 设置文档里的字段名。 */
  key: string;
  /** 归属的网关（`providerId`）。 */
  vendor: string;
}

/** 一张卡片。 */
export interface SettingsCard {
  id: SettingsCardId;
  /** 可折叠标题的文案键。 */
  labelKey: string;
  /** 说明文案键。 */
  hintKey: string;
  /** **三家共有**的字段名：写到任意一家都会镜像。 */
  shared: readonly string[];
  /** **厂商专属**字段：只写它自己那一家。 */
  specific: readonly SpecificField[];
}

/**
 * 四张卡片的声明（顺序即渲染顺序）。
 *
 * 分组依据是「用户在哪一刻需要它」，不是技术分层：
 * - 显示 → 「侧边栏上我能看到什么」
 * - 切换 → 「账号/模型什么时候换」
 * - 搜索 → 「联网搜索怎么走」
 * - 高级 → 「端点、超时、上限」（平时不动）
 */
export const SETTINGS_CARDS: readonly SettingsCard[] = [
  {
    id: "display",
    labelKey: "card.display",
    hintKey: "card.display.hint",
    shared: ["showSidebarQuota", "quotaRefreshMinutes"],
    specific: [],
  },
  {
    id: "switching",
    labelKey: "card.switching",
    hintKey: "card.switching.hint",
    shared: ["autoSwitchModelOnQuota", "autoContinueOnError", "autoContinueOnTruncate", "autoContinueMaxAttempts"],
    specific: [],
  },
  {
    id: "search",
    labelKey: "card.search",
    hintKey: "card.search.hint",
    shared: ["searchPreferGateway", "searchApiKeyEnv"],
    specific: [],
  },
  {
    id: "advanced",
    labelKey: "card.advanced",
    hintKey: "card.advanced.hint",
    // 超时两家同义（都叫这个名字），所以算共有。
    shared: ["requestTimeoutMs", "streamIdleTimeoutMs"],
    specific: [
      // Command Code：端点、线协议、输出上限
      { key: "apiBase", vendor: "commandcode" },
      { key: "protocol", vendor: "commandcode" },
      { key: "defaultMaxTokens", vendor: "commandcode" },
      // OpenCode / OpenDesign：端点（同名但各自独立）
      { key: "baseURL", vendor: "dsh-opencode-go" },
      { key: "baseURL", vendor: "opendesign" },
      // OpenDesign：工作区与额度服务地址
      { key: "workspaceId", vendor: "opendesign" },
      { key: "walletBase", vendor: "opendesign" },
    ],
  },
];

/** 卡片的渲染顺序（供渲染层直接用）。 */
export const SETTINGS_CARD_ORDER: readonly SettingsCardId[] = SETTINGS_CARDS.map((card) => card.id);

/**
 * 一个字段是不是「三家共有」（写回时要镜像）。
 * @param key - 设置字段名。
 * @returns 是否共有。
 */
export function isSharedField(key: string): boolean {
  return SETTINGS_CARDS.some((card) => card.shared.includes(key));
}

/**
 * 某个厂商专属字段归属哪一家。
 * @param key - 设置字段名。
 * @param vendor - 当前正在写的厂商。
 * @returns 该字段在这个厂商下是否适用（共有字段一律适用）。
 */
export function fieldAppliesTo(key: string, vendor: string): boolean {
  if (SETTINGS_CARDS.some((card) => card.shared.includes(key))) return true;
  return SETTINGS_CARDS.some((card) => card.specific.some((field) => field.key === key && field.vendor === vendor));
}

/**
 * 卡片 id → 它的主开关字段名。**当前为空**：2026-10-20 用户去掉了「启用自动切换 /
 * 开启网页搜索」两个界面开关（卡片本来就能用箭头收起，多一个开关反而让人误以为关掉会
 * 禁用功能）。保留这个结构是为了将来真出现「整卡级开关」时不必再改渲染层。
 */
export const PRIMARY_SWITCH_FIELDS: readonly string[] = [];

/**
 * 一张卡片的主开关字段名。
 * @param _id - 卡片 id（当前没有主开关，参数保留以兼容调用方）。
 * @returns 恒为 `undefined`。
 */
export function primarySwitchOf(_id: SettingsCardId): string | undefined {
  return undefined;
}

/**
 * 一张卡片里的字段（当前没有主开关，所以就是声明的全部）。
 * @param id - 卡片 id。
 * @returns 字段名。
 */
export function subordinateFieldsOf(id: SettingsCardId): readonly string[] {
  return SETTINGS_CARDS.find((item) => item.id === id)?.shared ?? [];
}

/**
 * 一张卡片的配置区当前是否可用。
 *
 * 当前**恒为 true**：没有任何卡片级开关。参数保留是为了让渲染层不必因为「将来加回开关」
 * 而改签名。
 * @param _value - 设置文档（当前不使用）。
 * @param _id - 卡片 id（当前不使用）。
 * @returns 恒为 `true`。
 */
export function isConfigEnabled(_value: Readonly<Record<string, unknown>>, _id: SettingsCardId): boolean {
  return true;
}
