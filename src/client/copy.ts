/**
 * 统一设置页的文案（i18n 命名空间 `settings.llm-account`，规格 §8 的「`zh` / `en` 两套文案」）。
 *
 * 形状与旧插件一致：`ctx.locale.register(ns, { zh, en })`，字典是**扁平键表**；页面用
 * `ctx.locale.bind(ns)(key)` 取词。文案键集中在这里，厂商注册表只声明 `labelKey`/`hintKey`，
 * 不各自写死字符串 —— 这样「厂商声明的字段」与「文案」可以分开演进，缺文案也能被测试抓到。
 *
 * @module dsh-llm-account/src/client/copy
 */

/** 页面文案的键。`vendor.*` 前缀的是厂商标签页标题，其余是外壳与通用卡片。 */
export type CopyKey =
  | "nav"
  | "title"
  | "intro"
  | "save"
  | "saveHint"
  | "advanced"
  | "advancedHint"
  | "group.switch"
  | "group.switch.hint"
  | "group.privacy"
  | "group.privacy.hint"
  | "group.accounts"
  | "group.accounts.hint"
  | "group.integrations"
  | "group.integrations.hint"
  | "group.advanced"
  | "group.advanced.hint"
  | "field.autoSwitch"
  | "field.autoSwitch.hint"
  | "field.switchStrategy"
  | "field.switchStrategy.hint"
  | "field.switchIntervalMinutes"
  | "field.switchIntervalMinutes.hint"
  | "field.switchAtTurnEnd"
  | "field.switchAtTurnEnd.hint"
  | "options.switchOrder"
  | "options.switchBestQuota"
  | "duration.days"
  | "duration.hours"
  | "duration.minutes"
  | "switch.title"
  | "switch.now"
  | "switch.pending"
  | "switch.nextIn"
  | "switch.due"
  | "switch.order"
  | "switch.noInterval"
  | "switch.unknown"
  | "field.showSidebarQuota"
  | "field.showSidebarQuota.hint"
  | "field.quotaRefreshMinutes"
  | "field.quotaRefreshMinutes.hint"
  | "field.apiBase"
  | "field.apiBase.hint"
  | "field.baseURL"
  | "field.baseURL.hint"
  | "field.protocol"
  | "field.protocol.hint"
  | "field.requestTimeoutMs"
  | "field.requestTimeoutMs.hint"
  | "field.streamIdleTimeoutMs"
  | "field.streamIdleTimeoutMs.hint"
  | "field.defaultMaxTokens"
  | "field.defaultMaxTokens.hint"
  | "options.openai"
  | "options.messages"
  | "options.cli"
  | "vendor.commandcode"
  | "vendor.opencodeGo"
  | "credentials.updated"
  | "account.configured"
  | "account.missing"
  | "account.empty"
  | "account.unavailable"
  | "account.add"
  | "account.addFor"
  | "account.loginFor"
  | "account.rename"
  | "account.replaceKey"
  | "account.pin"
  | "account.remove"
  | "account.menu"
  | "account.expand"
  | "account.collapse"
  | "account.plan"
  | "account.pinnedBy"
  | "account.effectiveBy"
  | "account.quotaMissing"
  | "account.newLabel"
  | "account.newLabel.placeholder"
  | "account.newKey.placeholder"
  | "account.newKey"
  | "account.confirm"
  | "account.cancel"
  | "account.login"
  | "account.loginWaiting"
  | "account.loginCode"
  | "account.moveUp"
  | "account.moveDown"
  | "account.autoSwitch"
  | "account.autoSwitch.hint"
  | "models.title"
  | "models.onSave"
  | "models.immediate"
  | "models.empty"
  | "models.add"
  | "models.remove"
  | "models.placeholder"
  | "models.searchPlaceholder"
  | "models.filtered"
  | "models.noMatch"
  | "models.loading"
  | "models.summary"
  | "models.retry"
  | "models.freeGroup"
  | "models.otherCompany"
  | "models.allTitle"
  | "models.allHint"
  | "sidebar.pinned"
  | "sidebar.effective"
  | "sidebar.open"
  | "sidebar.noRequest"
  | "usage.failed"
  | "usage.remoteUnavailable"
  | "usage.stale"
  | "usage.refresh"
  | "time.now"
  | "time.minutes"
  | "time.hours"
  | "time.days"
  | "rejection.unavailable"
  | "rejection.server"
  | "rejection.network"
  | "save.failed"
  | "switch.reason.quota"
  | "switch.reason.rate-limit"
  | "switch.reason.invalid-credential"
  | "switch.reason.manual"
  | "switch.reason.balance"
  | "dashboard.title"
  | "dashboard.close"
  | "dashboard.refresh"
  | "dashboard.accounts"
  | "dashboard.switches"
  | "dashboard.noSwitches"
  | "dashboard.noData"
  | "dashboard.unknown"
  | "account.reason.credential-slot-taken"
  | "account.reason.invalid-key"
  | "account.reason.unavailable"
  | "account.reason.cancelled"
  | "account.reason.timeout"
  | "account.reason.denied"
  | "account.reason.network"
  | "account.reason.error"
  | "empty.noVendor";

/** 语言字典：键 → 文案。 */
export type CopyDictionary = Record<string, string>;

/** 两套文案。键必须成对出现（由 `missingCopyKeys` 与测试保证）。 */
export const COPY: { readonly zh: CopyDictionary; readonly en: CopyDictionary } = {
  zh: {
    nav: "LLM 账号",
    title: "LLM 账号中心",
    intro: "统一管理 Command Code 与 OpenCode 的账号、额度与模型可见性。",
    save: "保存",
    saveHint: "账号操作立即生效；这里的保存只作用于下方设置字段。",
    advanced: "高级设置",
    advancedHint: "默认折叠。这些值影响请求构造与超时。",
    "group.switch": "切换策略",
    "group.switch.hint": "当前账号、手动顺序与额度优先的切换行为。",
    "group.privacy": "隐私与安全",
    "group.privacy.hint": "数据保留与联网相关开关。",
    "group.accounts": "账户",
    "group.accounts.hint": "账号操作立即生效；密钥只写入凭据服务。",
    "group.integrations": "集成与显示",
    "group.integrations.hint": "与宿主界面交互的开关。",
    "group.advanced": "高级设置",
    "group.advanced.hint": "请求构造、协议与超时。",
    "field.autoSwitch": "自动切换账号",
    "field.autoSwitch.hint": "关闭后只使用当前账号，额度耗尽也不换。",
    "field.switchStrategy": "切换方式",
    "field.switchStrategy.hint": "手动顺序只在上一个账号额度用尽时切；额度优先按间隔比较剩余额度。",
    "field.switchIntervalMinutes": "额度评估间隔（分钟）",
    "field.switchIntervalMinutes.hint": "仅额度优先模式使用。最大 30 天；分钟满 60 进小时、小时满 24 进天。全为 0 表示只在当前账号耗尽时评估。",
    "field.switchAtTurnEnd": "等任务结束后再切换",
    "field.switchAtTurnEnd.hint": "开启时回合内只记录决定，下一回合的首次请求才真正换号。",
    "options.switchOrder": "按手动顺序",
    "options.switchBestQuota": "按可用额度优先",
    "duration.days": "天",
    "duration.hours": "小时",
    "duration.minutes": "分钟",
    "switch.title": "切换倒计时",
    "switch.now": "立即切换",
    "switch.pending": "已决定切换到 {target}，等待本回合结束后生效。",
    "switch.nextIn": "距离下次额度评估：{time}",
    "switch.due": "即将评估",
    "switch.order": "当前账号额度耗尽时自动切换。",
    "switch.noInterval": "仅在当前账号额度耗尽时评估。",
    "switch.unknown": "切换状态暂不可用。",
    "field.showSidebarQuota": "侧边栏额度卡片",
    "field.showSidebarQuota.hint": "开启后侧边栏底部显示额度卡片；关闭时不发起任何后台用量查询。",
    "field.quotaRefreshMinutes": "用量刷新间隔（分钟）",
    "field.quotaRefreshMinutes.hint": "侧边栏卡片刷新用量数据的间隔；标签页隐藏时暂停刷新，连续的刷新失败会自动放慢。",
    "field.apiBase": "API 基地址",
    "field.apiBase.hint": "留空使用默认地址。",
    "field.baseURL": "服务地址",
    "field.baseURL.hint": "OpenCode 网关地址。",
    "field.protocol": "传输协议",
    "field.protocol.hint": "覆盖默认的协议选择。",
    "field.requestTimeoutMs": "整请求超时（毫秒）",
    "field.requestTimeoutMs.hint": "留空使用内置默认值。",
    "field.streamIdleTimeoutMs": "流空闲超时（毫秒）",
    "field.streamIdleTimeoutMs.hint": "超过此时长没有任何数据即判定失败。",
    "field.defaultMaxTokens": "默认最大输出 token",
    "field.defaultMaxTokens.hint": "留空使用模型默认值。",
    "options.openai": "OpenAI 兼容",
    "options.messages": "Anthropic Messages",
    "options.cli": "CLI",
    "vendor.commandcode": "Command Code",
    "vendor.opencodeGo": "OpenCode",
    "credentials.updated": "凭据已更新",
    "account.configured": "已配置",
    "account.missing": "未配置",
    "account.empty": "还没有添加任何账户。",
    "account.unavailable": "账号数据暂不可用。",
    "account.add": "添加账户",
    "account.addFor": "添加 {vendor} 账户",
    "account.loginFor": "{vendor} 网页登录",
    "account.rename": "重命名",
    "account.replaceKey": "更换密钥",
    "account.pin": "切换到此账户",
    "account.remove": "移除",
    "account.menu": "更多操作",
    "account.expand": "展开完整报告",
    "account.collapse": "收起报告",
    "account.plan": "套餐",
    "account.pinnedBy": "已指定",
    "account.effectiveBy": "当前使用",
    "account.quotaMissing": "暂无额度数据",
    "account.newLabel": "账户名称",
    "account.newLabel.placeholder": "例如：工作账号",
    "account.newKey.placeholder": "粘贴 API Key",
    "account.newKey": "密钥",
    "account.confirm": "确定",
    "account.cancel": "取消",
    "account.login": "网页登录",
    "account.loginWaiting": "在浏览器里完成授权，然后回到这里。",
    "account.loginCode": "在浏览器里输入代码：{code}",
    "account.moveUp": "上移",
    "account.moveDown": "下移",
    "account.autoSwitch": "额度耗尽时自动切换账号",
    "account.autoSwitch.hint": "立即生效。关闭后一次额度拒绝不会把请求打到下一个账号上。",
    "models.title": "模型",
    "models.onSave": "改动在底部保存后生效。",
    "models.immediate": "改动立即生效。",
    "models.empty": "还没有配置模型。",
    "models.add": "添加模型",
    "models.remove": "移除",
    "models.placeholder": "模型 id，例如 deepseek/deepseek-v4.1-flash",
    "models.searchPlaceholder": "搜索模型…",
    "models.filtered": "显示 {n} / {total} 个模型",
    "models.noMatch": "没有匹配这个关键词的模型。",
    "models.loading": "正在读取模型目录…",
    "models.summary": "已显示 {n} / 共 {total} 个模型",
    "models.retry": "重试",
    "models.freeGroup": "免费模型",
    "models.otherCompany": "其他",
    "models.allTitle": "全部模型",
    "models.allHint": "两家厂商的模型放在一起；勾选立即写入所属厂商。",
    "sidebar.pinned": "已指定",
    "sidebar.effective": "当前使用",
    "sidebar.open": "打开用量面板",
    "sidebar.noRequest": "还没有请求经过这个账号。",
    "usage.failed": "用量读取失败",
    "usage.remoteUnavailable": "用量远程面还没挂上",
    "usage.stale": "上次数据",
    "usage.refresh": "刷新",
    "time.now": "刚刚",
    "time.minutes": "{n} 分钟前",
    "time.hours": "{n} 小时前",
    "time.days": "{n} 天前",
    "rejection.unavailable": "服务暂不可用",
    "rejection.server": "服务端错误",
    "rejection.network": "网络错误",
    "save.failed": "保存失败，请重试。",
    "switch.reason.quota": "额度耗尽",
    "switch.reason.rate-limit": "被限流",
    "switch.reason.invalid-credential": "凭据失效",
    "switch.reason.manual": "手动切换",
    "switch.reason.balance": "额度更充足",
    "dashboard.title": "账号与用量",
    "dashboard.close": "关闭",
    "dashboard.refresh": "刷新",
    "dashboard.accounts": "账号",
    "dashboard.switches": "切换记录",
    "dashboard.noSwitches": "还没有发生过自动或手动切换。",
    "dashboard.noData": "还没有可显示的用量数据。",
    "dashboard.unknown": "未知",
    "account.reason.credential-slot-taken": "该凭据槽已被另一个账号占用，密钥未写入；请先重命名或移除那个账号。",
    "account.reason.invalid-key": "密钥被拒绝，请确认它属于这个账号。",
    "account.reason.unavailable": "登录服务暂时不可用。",
    "account.reason.cancelled": "已取消。",
    "account.reason.timeout": "等待授权超时。",
    "account.reason.denied": "授权被拒绝。",
    "account.reason.network": "网络错误。",
    "account.reason.error": "登录失败。",
    "empty.noVendor": "没有可显示的厂商。",
  },
  en: {
    nav: "LLM accounts",
    title: "LLM account centre",
    intro: "Manage Command Code and OpenCode accounts, quota and model visibility in one place.",
    save: "Save",
    saveHint: "Account changes take effect immediately; Save only applies to the settings fields below.",
    advanced: "Advanced",
    advancedHint: "Collapsed by default. These values affect request construction and timeouts.",
    "group.switch": "Switching",
    "group.switch.hint": "Current account, manual order, and quota-first switching.",
    "group.privacy": "Privacy & security",
    "group.privacy.hint": "Data retention and web-related switches.",
    "group.accounts": "Accounts",
    "group.accounts.hint": "Account changes take effect immediately; keys are written only to the credentials service.",
    "group.integrations": "Integrations & display",
    "group.integrations.hint": "Switches that interact with the host UI.",
    "group.advanced": "Advanced",
    "group.advanced.hint": "Request construction, protocol and timeouts.",
    "field.autoSwitch": "Switch accounts automatically",
    "field.autoSwitch.hint": "Off keeps using the current account even after its quota is exhausted.",
    "field.switchStrategy": "Switching mode",
    "field.switchStrategy.hint": "Manual order switches only when the previous account is exhausted; quota-first compares remaining quota on an interval.",
    "field.switchIntervalMinutes": "Quota evaluation interval (minutes)",
    "field.switchIntervalMinutes.hint": "Quota-first only. Up to 30 days; 60 minutes carry into an hour and 24 hours into a day. All zero evaluates only when the current account is exhausted.",
    "field.switchAtTurnEnd": "Wait until the turn ends",
    "field.switchAtTurnEnd.hint": "When on, a decision is parked during the turn and applied on the first request of the next turn.",
    "options.switchOrder": "Manual order",
    "options.switchBestQuota": "Quota-first",
    "duration.days": "days",
    "duration.hours": "hours",
    "duration.minutes": "minutes",
    "switch.title": "Switch countdown",
    "switch.now": "Switch now",
    "switch.pending": "Switching to {target} after this turn ends.",
    "switch.nextIn": "Next quota check in {time}",
    "switch.due": "Due now",
    "switch.order": "Switches automatically when the current account is exhausted.",
    "switch.noInterval": "Only checked when the current account is exhausted.",
    "switch.unknown": "Switch state is unavailable.",
    "field.showSidebarQuota": "Sidebar quota card",
    "field.showSidebarQuota.hint": "Shows a quota card at the bottom of the sidebar; while off, no background usage request is made.",
    "field.quotaRefreshMinutes": "Usage refresh interval (minutes)",
    "field.quotaRefreshMinutes.hint": "How often the sidebar card refreshes usage data; paused while the tab is hidden, and failures are slowed down automatically.",
    "field.apiBase": "API base URL",
    "field.apiBase.hint": "Leave blank for the default endpoint.",
    "field.baseURL": "Service URL",
    "field.baseURL.hint": "OpenCode gateway address.",
    "field.protocol": "Transport protocol",
    "field.protocol.hint": "Overrides the default protocol selection.",
    "field.requestTimeoutMs": "Request timeout (ms)",
    "field.requestTimeoutMs.hint": "Leave blank for the built-in default.",
    "field.streamIdleTimeoutMs": "Stream idle timeout (ms)",
    "field.streamIdleTimeoutMs.hint": "Fail when no data arrives for this long.",
    "field.defaultMaxTokens": "Default max output tokens",
    "field.defaultMaxTokens.hint": "Leave blank for the model default.",
    "options.openai": "OpenAI compatible",
    "options.messages": "Anthropic Messages",
    "options.cli": "CLI",
    "vendor.commandcode": "Command Code",
    "vendor.opencodeGo": "OpenCode",
    "credentials.updated": "Credentials updated",
    "account.configured": "Configured",
    "account.missing": "Not configured",
    "account.empty": "No accounts yet.",
    "account.unavailable": "Account data is not available yet.",
    "account.add": "Add account",
    "account.addFor": "Add {vendor} account",
    "account.loginFor": "{vendor} web login",
    "account.rename": "Rename",
    "account.replaceKey": "Replace key",
    "account.pin": "Switch to this account",
    "account.remove": "Remove",
    "account.menu": "More actions",
    "account.expand": "Show full report",
    "account.collapse": "Hide report",
    "account.plan": "Plan",
    "account.pinnedBy": "Selected",
    "account.effectiveBy": "In use",
    "account.quotaMissing": "No quota data",
    "account.newLabel": "Account name",
    "account.newLabel.placeholder": "e.g. work",
    "account.newKey.placeholder": "Paste the API key",
    "account.newKey": "API key",
    "account.confirm": "Confirm",
    "account.cancel": "Cancel",
    "account.login": "Sign in with browser",
    "account.loginWaiting": "Finish signing in in your browser, then come back here.",
    "account.loginCode": "Enter this code in the browser: {code}",
    "account.moveUp": "Move up",
    "account.moveDown": "Move down",
    "account.autoSwitch": "Switch accounts automatically when quota runs out",
    "account.autoSwitch.hint": "Takes effect immediately. While off, one quota rejection will not send the request to the next account.",
    "models.title": "Models",
    "models.onSave": "Changes take effect when you press Save below.",
    "models.immediate": "Changes take effect immediately.",
    "models.empty": "No models configured yet.",
    "models.add": "Add model",
    "models.remove": "Remove",
    "models.placeholder": "model id, for example deepseek/deepseek-v4.1-flash",
    "models.searchPlaceholder": "Search models…",
    "models.filtered": "Showing {n} of {total} models",
    "models.noMatch": "No model matches this keyword.",
    "models.loading": "Loading the model catalog…",
    "models.summary": "{n} of {total} models shown",
    "models.retry": "Retry",
    "models.freeGroup": "Free models",
    "models.otherCompany": "Other",
    "models.allTitle": "All models",
    "models.allHint": "Models from both providers; a toggle writes through to its provider immediately.",
    "sidebar.pinned": "Selected",
    "sidebar.effective": "In use",
    "sidebar.open": "Open the usage panel",
    "sidebar.noRequest": "No request has used this account yet.",
    "usage.failed": "Usage read failed",
    "usage.remoteUnavailable": "Usage remote is not mounted",
    "usage.stale": "Last data",
    "usage.refresh": "Refresh",
    "time.now": "just now",
    "time.minutes": "{n} min ago",
    "time.hours": "{n} h ago",
    "time.days": "{n} d ago",
    "rejection.unavailable": "Service unavailable",
    "rejection.server": "Server error",
    "rejection.network": "Network error",
    "save.failed": "Save failed, please try again.",
    "switch.reason.quota": "quota exhausted",
    "switch.reason.rate-limit": "rate limited",
    "switch.reason.invalid-credential": "credential rejected",
    "switch.reason.manual": "switched manually",
    "switch.reason.balance": "more quota available",
    "dashboard.title": "Accounts & usage",
    "dashboard.close": "Close",
    "dashboard.refresh": "Refresh",
    "dashboard.accounts": "Accounts",
    "dashboard.switches": "Switch history",
    "dashboard.noSwitches": "No automatic or manual switch has happened yet.",
    "dashboard.noData": "No usage data to show yet.",
    "dashboard.unknown": "Unknown",
    "account.reason.credential-slot-taken": "That credential slot already belongs to another account, so the key was not written. Rename or remove that account first.",
    "account.reason.invalid-key": "The key was rejected; check that it belongs to this account.",
    "account.reason.unavailable": "The sign-in service is temporarily unavailable.",
    "account.reason.cancelled": "Cancelled.",
    "account.reason.timeout": "Timed out waiting for authorisation.",
    "account.reason.denied": "Authorisation was denied.",
    "account.reason.network": "Network error.",
    "account.reason.error": "Sign-in failed.",
    "empty.noVendor": "No vendor to display.",
  },
};

/** 支持的语言。 */
export const LANGUAGES = ["zh", "en"] as const;

/** 一种语言。 */
export type Language = (typeof LANGUAGES)[number];

/**
 * 列出两套字典里键不一致的地方（缺哪边就报哪边）。
 *
 * 存在意义：`COPY` 是手工维护的两份表，缺一条文案必须被测试抓到，而不是在界面上显示键名。
 * @returns 人类可读的差异描述；完全一致时为空数组。
 */
export function missingCopyKeys(): string[] {
  const problems: string[] = [];
  const zhKeys = new Set(Object.keys(COPY.zh));
  const enKeys = new Set(Object.keys(COPY.en));
  for (const key of zhKeys) if (!enKeys.has(key)) problems.push(`en is missing "${key}"`);
  for (const key of enKeys) if (!zhKeys.has(key)) problems.push(`zh is missing "${key}"`);
  return problems;
}

/**
 * 取一个语言下的取词函数（与宿主 `ctx.locale.bind(ns)` 的语义一致：键缺失时回退到键名）。
 * @param language - 目标语言。
 * @returns `(key) => 文案`。
 */
export function dictionaryOf(language: Language): (key: string) => string {
  const dictionary = COPY[language] as CopyDictionary;
  return (key: string) => dictionary[key] ?? key;
}

/**
 * 拒绝分类（`FailureKind`）→ 文案键。
 *
 * 四种「能指名」的切换原因沿用切换提示的文案（额度耗尽/被限流/凭据失效 —— 同一件事的两种
 * 读法，文案通用）；其余三种失败分类有各自的拒绝文案。**未知分类不在这张表里**：调用方
 * 回退到「未知」，绝不把原始枚举或键名印到界面上。
 */
const REJECTION_COPY_KEYS: Readonly<Record<string, CopyKey>> = {
  quota: "switch.reason.quota",
  "rate-limit": "switch.reason.rate-limit",
  "invalid-credential": "switch.reason.invalid-credential",
  unavailable: "rejection.unavailable",
  server: "rejection.server",
  network: "rejection.network",
};

/**
 * 一个拒绝分类的人类可读文案（账户卡片与仪表盘共用的唯一实现）。
 *
 * 与 {@link dictionaryOf} 的回退语义配合：取到的文案等于键名本身（文案缺失）时同样回退到
 * 「未知」—— 显示一个键名比显示「未知」更糟。
 * @param t - 取词函数（页面文案命名空间的）。
 * @param kind - 失败分类（形状不可信，按字符串查表）。
 * @returns 可读文案；未知分类或文案缺失时为「未知」。
 */
export function rejectionText(t: (key: string) => string, kind: string): string {
  const key = REJECTION_COPY_KEYS[kind];
  if (key === undefined) return t("dashboard.unknown");
  const text = t(key);
  return text === key ? t("dashboard.unknown") : text;
}
