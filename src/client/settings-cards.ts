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
    // 「搜索方式」四选一。密钥列表**不再是设置字段**（2026-10-20 用户要求：
    // 「只保留保存密钥那个」）—— 它由搜索卡里的「添加/删除」动作维护。
    shared: ["searchStrategy"],
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

/**
 * 卡片 id → 它的主开关字段名。**当前为空**：2026-10-20 用户去掉了「启用自动切换 /
 * 开启网页搜索」两个界面开关（卡片本来就能用箭头收起，多一个开关反而让人误以为关掉会
 * 禁用功能）。
 *
 * 那次移除曾留下三个**空壳**导出（全返回恒值、源码零调用、只有测试在断言它们恒为恒值 ——
 * 也就是「测死代码的测试」）。2026-10-20 的清扫已把它们删除；若将来真需要整卡级开关，
 * 按那时的需求重新设计信号，而不是恢复一个永远返回 true 的函数。
 */
