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
  | "saving"
  | "settingsTarget"
  | "settingsTarget.hint"
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
  | "options.switchScheduled"
  | "field.scheduledIntervalMinutes"
  | "field.scheduledIntervalMinutes.hint"
  | "duration.days"
  | "duration.hours"
  | "duration.minutes"
  | "switch.title"
  | "switch.panelTitle"
  | "switch.current"
  | "switch.noCurrent"
  | "switch.now"
  | "switch.pending"
  | "switch.nextIn"
  | "switch.nextSwitchIn"
  | "switch.switchDue"
  | "switch.due"
  | "switch.order"
  | "switch.noInterval"
  | "switch.unknown"
  | "field.showSidebarQuota"
  | "field.showSidebarQuota.hint"
  | "field.quotaRefreshMinutes"
  | "field.quotaRefreshMinutes.hint"
  | "field.sidebarRotateMinutes"
  | "field.sidebarRotateMinutes.hint"
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
  | "vendor.opendesign"
  | "field.workspaceId"
  | "field.workspaceId.hint"
  | "field.walletBase"
  | "field.walletBase.hint"
  | "credentials.updated"
  | "account.configured"
  | "account.missing"
  | "account.empty"
  | "account.count"
  | "account.unavailable"
  | "account.loading"
  | "account.add"
  | "account.addFor"
  | "account.loginFor"
  | "account.addAccount"
  | "account.addAccount.hint"
  | "account.orderTitle"
  | "account.orderHint"
  | "account.rename"
  | "account.replaceKey"
  | "account.pin"
  | "account.use"
  | "account.current"
  | "account.models"
  | "account.remove"
  | "account.menu"
  | "account.expand"
  | "account.collapse"
  | "account.plan"
  | "account.pinnedBy"
  | "account.effectiveBy"
  | "account.liveBy"
  | "account.quotaMissing"
  | "quota.used"
  | "quota.capOnly"
  | "quota.usedOf"
  | "quota.usedPercent"
  | "quota.remaining"
  | "quota.unlimited"
  | "quota.resetToday"
  | "quota.resetTomorrow"
  | "quota.resetAtLong"
  | "quota.resetUnknown"
  | "quota.resetAt"
  | "quota.window.fiveHour"
  | "quota.window.rolling"
  | "quota.window.daily"
  | "quota.window.weekly"
  | "quota.window.monthly"
  | "quota.window.monthlyCredits"
  | "quota.window.plan"
  | "quota.window.unknown"
  | "quota.planMonthly"
  | "quota.planPeriodEnd"
  | "quota.planStatus.trialing"
  | "quota.planStatus.past_due"
  | "quota.planStatus.canceled"
  | "quota.planStatus.incomplete"
  | "account.newLabel"
  | "account.newLabel.placeholder"
  | "account.newKey.placeholder"
  | "account.newKey"
  | "account.newKey.hint"
  | "account.addTitle"
  | "account.labelRequired"
  | "account.keyRequired"
  | "account.serviceNotReady"
  | "account.confirm"
  | "account.cancel"
  | "account.login"
  | "account.loginWaiting"
  | "account.loginCode"
  | "account.loginStarting"
  | "account.loginCancel"
  | "account.loginFailed"
  | "account.loginExpired"
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
  | "models.refresh"
  | "models.refreshing"
  | "models.refreshAccount"
  | "models.newBadge"
  | "models.removedTitle"
  | "models.removedHint"
  | "models.restore"
  | "models.addTitle"
  | "models.updatedAt"
  | "models.freeGroup"
  | "models.otherCompany"
  | "models.allTitle"
  | "models.allHint"
  | "models.hideGroup"
  | "models.showGroup"
  | "models.hideVendor"
  | "models.showVendor"
  | "sidebar.pinned"
  | "sidebar.effective"
  | "sidebar.open"
  | "sidebar.noRequest"
  | "usage.failed"
  | "usage.failure.timeout"
  | "usage.failure.whoami"
  | "usage.failure.usage"
  | "usage.failure.credits"
  | "usage.failure.subscriptions"
  | "usage.failure.window"
  | "usage.failure.quota"
  | "usage.failure.accountQuota"
  | "usage.failure.models"
  | "usage.failure.modelsUnsupported"
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
  | "switch.reason.scheduled"
  | "dashboard.title"
  | "dashboard.close"
  | "dashboard.refresh"
  | "dashboard.accounts"
  | "dashboard.noData"
  | "dashboard.unknown"
  | "account.reason.credential-slot-taken"
  | "account.reason.invalid-key"
  | "account.reason.unavailable"
  | "account.reason.cancelled"
  | "account.reason.timeout"
  | "account.reason.denied"
  | "account.reason.network"
  | "account.reason.vela-missing"
  | "account.reason.no-signin"
  | "account.reason.config-invalid"
  | "account.reason.error"
  | "empty.noVendor"
  | "webSearch.title"
  | "webSearch.hint"
  | "webSearch.loading"
  | "webSearch.readFailed"
  | "webSearch.option.account"
  | "webSearch.option.account.hint"
  | "webSearch.option.deepseek"
  | "webSearch.option.deepseek.hint"
  | "webSearch.option.custom"
  | "webSearch.option.custom.hint"
  | "webSearch.effective"
  | "webSearch.effective.none"
  | "webSearch.route"
  | "webSearch.supported"
  | "webSearch.unsupported"
  | "webSearch.noModel"
  | "webSearch.account.keyConfigured"
  | "webSearch.account.keyMissing"
  | "webSearch.field.endpoint"
  | "webSearch.field.endpoint.hint"
  | "webSearch.field.method"
  | "webSearch.field.queryParam"
  | "webSearch.field.queryParam.hint"
  | "webSearch.field.queryField"
  | "webSearch.field.queryField.hint"
  | "webSearch.field.keyField"
  | "webSearch.field.keyField.hint"
  | "webSearch.field.resultsPath"
  | "webSearch.field.resultsPath.hint"
  | "webSearch.field.authHeader"
  | "webSearch.field.authHeader.hint"
  | "webSearch.field.authScheme"
  | "webSearch.field.authScheme.hint"
  | "webSearch.key"
  | "webSearch.key.keep"
  | "webSearch.key.placeholder"
  | "webSearch.key.configured"
  | "webSearch.key.missing"
  | "webSearch.key.unreadable"
  | "webSearch.key.unavailable"
  | "webSearch.deepseek.hint"
  | "webSearch.save"
  | "webSearch.saving"
  | "webSearch.saveHint"
  | "webSearch.failure"
  | "webSearch.saved"
  | "webSearch.rowMissing"
  | "webSearch.webRowMissing"
  | "webSearch.blocked"
  | "webSearch.blocked.endpoint"
  | "webSearch.blocked.noKey"
  | "webSearch.blocked.noModel"
  | "webSearch.blocked.unsupported";

/** 语言字典：键 → 文案。 */
export type CopyDictionary = Record<string, string>;

/** 两套文案。键必须成对出现（由 `missingCopyKeys` 与测试保证）。 */
export const COPY: { readonly zh: CopyDictionary; readonly en: CopyDictionary } = {
  zh: {
    nav: "LLM 账号",
    title: "LLM 账号中心",
    intro: "统一管理 Command Code、OpenCode 与 Open Design 的账号、额度与模型可见性。",
    save: "保存",
    saving: "保存中…",
    settingsTarget: "设置对象",
    "settingsTarget.hint": "通用显示设置各家同步；高级字段只写当前这家。",
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
    "field.switchStrategy.hint": "额度用尽后切换：当前账号耗尽时按顺序切；额度优先按间隔比较剩余额度；定时按间隔轮换。",
    "field.switchIntervalMinutes": "额度评估间隔（分钟）",
    "field.switchIntervalMinutes.hint": "仅额度优先模式使用。最大 30 天；分钟满 60 进小时、小时满 24 进天。全为 0 表示只在当前账号耗尽时评估。",
    "field.switchAtTurnEnd": "等任务结束后再切换",
    "field.switchAtTurnEnd.hint": "开启时回合内只记录决定，下一回合的首次请求才真正换号。",
    "options.switchOrder": "额度用尽后切换",
    "options.switchBestQuota": "按可用额度优先",
    "options.switchScheduled": "定时切换",
    "duration.days": "天",
    "duration.hours": "小时",
    "duration.minutes": "分钟",
    "switch.title": "切换倒计时",
    "switch.panelTitle": "切换策略与账户顺序",
    "switch.current": "当前使用：{account}",
    "switch.noCurrent": "未选择当前账号",
    "switch.now": "立即切换",
    "switch.pending": "已决定切换到 {target}，等待本回合结束后生效。",
    "switch.nextIn": "距离下次额度评估：{time}",
    "switch.nextSwitchIn": "距离下次定时切换：{time}",
    "switch.switchDue": "即将按定时切换",
    "field.scheduledIntervalMinutes": "定时切换间隔（分钟）",
    "field.scheduledIntervalMinutes.hint": "到点后按顺序切到下一个账号，不看额度。最大 30 天。",
    "switch.due": "即将评估",
    "switch.order": "当前账号额度耗尽时自动切换。",
    "switch.noInterval": "仅在当前账号额度耗尽时评估。",
    "switch.unknown": "切换状态暂不可用。",
    "field.showSidebarQuota": "侧边栏额度卡片",
    "field.showSidebarQuota.hint": "开启后侧边栏底部显示额度卡片；关闭时不发起任何后台用量查询。",
    "field.quotaRefreshMinutes": "用量刷新间隔（分钟）",
    "field.quotaRefreshMinutes.hint": "侧边栏卡片与设置页读取用量数据的间隔（设置页缓存也按它失效）；标签页隐藏时暂停刷新，连续失败会自动放慢。",
    "field.sidebarRotateMinutes": "侧边栏轮播间隔（分钟）",
    "field.sidebarRotateMinutes.hint": "多家厂商都打开侧边栏额度时，卡片每隔这么久换一家显示（按标签页顺序，只显示各家当前使用的账号）。",
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
    "vendor.opendesign": "Open Design",
    "field.workspaceId": "工作区 ID",
    "field.workspaceId.hint": "本机 vela 查询周期额度（Coding Plan）用的工作区；账号条目里单独配了就以条目为准。",
    "field.walletBase": "额度服务地址",
    "field.walletBase.hint": "额度与账单接口的基地址，与推理地址分开。",
    "credentials.updated": "凭据已更新",
    "account.configured": "已配置",
    "account.missing": "未配置",
    "account.empty": "还没有添加任何账户。",
    "account.count": "共 {n} 个账号",
    "account.unavailable": "账号数据暂不可用。",
    "account.loading": "正在读取账号数据…",
    "account.add": "添加账户",
    "account.addFor": "使用 API Key",
    "account.loginFor": "网页登录",
    "account.addAccount": "新增账户",
    "account.addAccount.hint": "先选供应商，再选 API Key 或网页登录。",
    "account.orderTitle": "切换顺序",
    "account.orderHint": "全局顺序；额度用尽/定时可调整顺序，额度优先只展示顺序和当前账号。",
    "account.rename": "重命名",
    "account.replaceKey": "更换密钥",
    "account.pin": "切换到此账户",
    "account.use": "使用",
    "account.current": "当前使用",
    "account.models": "可用模型",
    "account.remove": "移除",
    "account.menu": "更多操作",
    "account.expand": "展开完整报告",
    "account.collapse": "收起报告",
    "account.plan": "套餐",
    "account.pinnedBy": "已指定",
    "account.effectiveBy": "当前使用",
    "account.liveBy": "生效中",
    "account.quotaMissing": "暂无额度数据",
    "quota.used": "已用 {used}",
    "quota.usedOf": "已用 {used} / 共 {cap}",
    "quota.usedPercent": "已用 {percent}%",
    "quota.remaining": "剩余 {percent}%",
    "quota.unlimited": "不限",
    "quota.resetToday": "今天 {time} 重置",
    "quota.resetTomorrow": "明天 {time} 重置",
    "quota.resetAtLong": "{date} {time} 重置",
    "quota.resetUnknown": "重置时间未提供",
    "quota.resetAt": "重置于",
    "quota.window.fiveHour": "5 小时",
    "quota.window.rolling": "滚动窗口",
    "quota.window.daily": "每日",
    "quota.window.weekly": "每周",
    "quota.window.monthly": "每月",
    "quota.window.monthlyCredits": "月度额度",
    "quota.capOnly": "上限 {cap}",
    "quota.window.plan": "套餐",
    "quota.window.unknown": "额度",
    "quota.planMonthly": "每月 {amount}",
    "quota.planPeriodEnd": "本期至 {date}",
    "quota.planStatus.trialing": "试用中",
    "quota.planStatus.past_due": "已逾期未付",
    "quota.planStatus.canceled": "已取消",
    "quota.planStatus.incomplete": "付款未完成",
    "account.newLabel": "账户名称",
    "account.newLabel.placeholder": "例如：工作账号",
    "account.newKey.placeholder": "粘贴 API Key",
    "account.newKey": "密钥",
    "account.newKey.hint": "密钥只写入本机凭据库，设置文件里不留明文。",
    "account.addTitle": "添加{vendor}账户",
    "account.labelRequired": "请先填写账户名称。",
    "account.keyRequired": "请先填写密钥。",
    "account.serviceNotReady": "账户服务还没就绪，请稍后再试。",
    "account.confirm": "确定",
    "account.cancel": "取消",
    "account.login": "网页登录",
    "account.loginWaiting": "正在等待浏览器里的授权。授权完成后这里会自动消失；没弹出浏览器时，点下面的链接手动打开。",
    "account.loginCode": "在浏览器里输入代码：{code}",
    "account.loginStarting": "正在启动网页登录…",
    "account.loginCancel": "取消登录",
    "account.loginFailed": "网页登录没能启动。",
    "account.loginExpired": "这次登录已过期。点「网页登录」重新开始。",
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
    "models.refresh": "重新获取模型",
    "models.refreshing": "重新获取中…",
    "models.refreshAccount": "刷新此账号的模型",
    "models.newBadge": "New",
    "models.removedTitle": "已移除的模型",
    "models.removedHint": "恢复后不会自动开启，只会回到列表。",
    "models.restore": "恢复",
    "models.addTitle": "手动添加模型",
    "models.updatedAt": "更新于 {time}",
    "models.freeGroup": "免费模型",
    "models.otherCompany": "其他",
    "models.allTitle": "全部模型",
    "models.allHint": "三家厂商的模型放在一起；勾选立即写入所属厂商。默认关闭，勾选或按组开启后才会出现在模型选择里。",
    "models.hideGroup": "隐藏本组全部模型",
    "models.showGroup": "显示本组全部模型",
    "models.hideVendor": "隐藏该厂商全部模型",
    "models.showVendor": "显示该厂商全部模型",
    "sidebar.pinned": "已指定",
    "sidebar.effective": "当前使用",
    "sidebar.open": "打开用量面板",
    "sidebar.noRequest": "还没有请求经过这个账号。",
    "usage.failed": "用量读取失败",
    "usage.failure.timeout": "读取超时",
    "usage.failure.whoami": "账号信息读取失败",
    "usage.failure.usage": "用量读数读取失败",
    "usage.failure.credits": "额度余额读取失败",
    "usage.failure.subscriptions": "订阅信息读取失败",
    "usage.failure.window": "部分额度窗口读数缺失",
    "usage.failure.quota": "额度读取失败",
    "usage.failure.accountQuota": "账号 {account} 的额度读取失败",
    "usage.failure.models": "模型目录读取失败",
    "usage.failure.modelsUnsupported": "该厂商不提供模型目录",
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
    "switch.reason.scheduled": "定时切换",
    "dashboard.title": "账号与用量",
    "dashboard.close": "关闭",
    "dashboard.refresh": "刷新",
    "dashboard.accounts": "账号",
    "dashboard.noData": "还没有可显示的用量数据。",
    "dashboard.unknown": "未知",
    "account.reason.credential-slot-taken": "该凭据槽已被另一个账号占用，密钥未写入；请先重命名或移除那个账号。",
    "account.reason.invalid-key": "密钥被拒绝，请确认它属于这个账号。",
    "account.reason.unavailable": "登录服务暂时不可用。",
    "account.reason.cancelled": "已取消。",
    "account.reason.timeout": "等待授权超时。",
    "account.reason.denied": "授权被拒绝。",
    "account.reason.network": "网络错误。",
    "account.reason.vela-missing": "本机找不到 vela，也没有可导入的登录产物。请先安装 Open Design 桌面端（或 vela CLI）再重试。",
    "account.reason.no-signin": "浏览器里没有完成授权（vela 已退出）。请重试并在浏览器里批准。",
    "account.reason.config-invalid": "本机的登录产物形状不认识（缺少 runtime key）。请重新登录一次。",
    "account.reason.error": "登录失败。",
    "empty.noVendor": "没有可显示的厂商。",
    "webSearch.title": "网页搜索",
    "webSearch.hint": "选择会话里联网搜索由谁执行：跟随模型账号走账号网关的原生搜索，也可以改用 DeepSeek 官方或任何第三方搜索 API。",
    "webSearch.loading": "正在读取网页搜索设置…",
    "webSearch.readFailed": "网页搜索设置读取失败",
    "webSearch.option.account": "跟随模型账号",
    "webSearch.option.account.hint": "用当前默认模型所属厂商的网关执行搜索，不另配密钥（需网关支持）。",
    "webSearch.option.deepseek": "DeepSeek 官方",
    "webSearch.option.deepseek.hint": "使用宿主内置的 DeepSeek 搜索；密钥在宿主自带的「网页搜索」卡片里配置。",
    "webSearch.option.custom": "第三方 API",
    "webSearch.option.custom.hint": "通用自定义：填写接口地址与密钥，适配 Tavily、Serper 等常见形态。",
    "webSearch.effective": "当前生效：{provider}",
    "webSearch.effective.none": "宿主还没有设置搜索来源（未选择任何提供方）。",
    "webSearch.route": "当前默认模型：{vendor} 的 {model}",
    "webSearch.supported": "该账号网关支持原生联网搜索。",
    "webSearch.unsupported": "该账号网关不支持原生搜索",
    "webSearch.noModel": "还没有设置默认模型，无法确定要跟随哪个账号。",
    "webSearch.account.keyConfigured": "账号网关密钥已配置（{ref}）。",
    "webSearch.account.keyMissing": "账号网关密钥未配置（{ref}）。",
    "webSearch.field.endpoint": "接口地址",
    "webSearch.field.endpoint.hint": "搜索结果 JSON 的完整 URL，例如 https://api.tavily.com/search。",
    "webSearch.field.method": "请求方法",
    "webSearch.field.queryParam": "查询参数名",
    "webSearch.field.queryParam.hint": "GET 时拼进 URL 的参数名，通常为 q 或 query。",
    "webSearch.field.queryField": "正文字段名",
    "webSearch.field.queryField.hint": "POST JSON body 里承载查询的字段名。",
    "webSearch.field.keyField": "密钥字段名",
    "webSearch.field.keyField.hint": "留空表示密钥走请求头；填写后密钥会放进 body 的这个字段。",
    "webSearch.field.resultsPath": "结果数组路径",
    "webSearch.field.resultsPath.hint": "留空自动探测；形如 data.results，指向结果数组所在的位置。",
    "webSearch.field.authHeader": "密钥请求头",
    "webSearch.field.authHeader.hint": "承载密钥的请求头名称，通常为 Authorization。",
    "webSearch.field.authScheme": "认证方案",
    "webSearch.field.authScheme.hint": "请求头里密钥的前缀，通常为 Bearer；留空表示只放裸值。",
    "webSearch.key": "搜索 API 密钥",
    "webSearch.key.keep": "已保存的密钥不会回显；仅在需要更换时填写。",
    "webSearch.key.placeholder": "粘贴新的 API 密钥（留空表示不修改）",
    "webSearch.key.configured": "密钥已配置（{ref}）。",
    "webSearch.key.missing": "密钥未配置（{ref}）。",
    "webSearch.key.unreadable": "读不到密钥状态（凭据服务不可用）。",
    "webSearch.key.unavailable": "凭据服务不可用，无法写入密钥。",
    "webSearch.deepseek.hint": "密钥在宿主自带的「网页搜索」卡片里填写；这里只负责把搜索来源切过去。",
    "webSearch.save": "保存搜索设置",
    "webSearch.saving": "保存中…",
    "webSearch.saveHint": "保存后立即生效；只写入本插件自己的设置行。",
    "webSearch.failure": "保存失败",
    "webSearch.saved": "已保存，搜索来源已切换。",
    "webSearch.rowMissing": "本插件的设置行还没有被宿主创建，暂时无法保存。",
    "webSearch.webRowMissing": "宿主的「网页搜索」设置行不存在，无法切换来源；设置已保存。",
    "webSearch.blocked": "已保存设置；未切换搜索来源：{reason}",
    "webSearch.blocked.endpoint": "第三方接口地址还没填或不是合法的 URL。",
    "webSearch.blocked.noKey": "账号网关密钥未配置（{ref}）。",
    "webSearch.blocked.noModel": "还没有设置默认模型。",
    "webSearch.blocked.unsupported": "当前账号网关不支持原生联网搜索。",
  },
  en: {
    nav: "LLM accounts",
    title: "LLM account centre",
    intro: "Manage Command Code, OpenCode and Open Design accounts, quota and model visibility in one place.",
    save: "Save",
    saving: "Saving…",
    settingsTarget: "Settings for",
    "settingsTarget.hint": "Display settings sync across providers; advanced fields write only to this one.",
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
    "options.switchOrder": "Switch when exhausted",
    "options.switchBestQuota": "Quota-first",
    "options.switchScheduled": "Scheduled",
    "duration.days": "days",
    "duration.hours": "hours",
    "duration.minutes": "minutes",
    "switch.title": "Switch countdown",
    "switch.panelTitle": "Switching & account order",
    "switch.current": "Current: {account}",
    "switch.noCurrent": "No current account",
    "switch.now": "Switch now",
    "switch.pending": "Switching to {target} after this turn ends.",
    "switch.nextIn": "Next quota check in {time}",
    "switch.nextSwitchIn": "Next scheduled switch in {time}",
    "switch.switchDue": "Scheduled switch due",
    "field.scheduledIntervalMinutes": "Scheduled switch interval (minutes)",
    "field.scheduledIntervalMinutes.hint": "Switch to the next account in order when due, regardless of quota. Up to 30 days.",
    "switch.due": "Due now",
    "switch.order": "Switches automatically when the current account is exhausted.",
    "switch.noInterval": "Only checked when the current account is exhausted.",
    "switch.unknown": "Switch state is unavailable.",
    "field.showSidebarQuota": "Sidebar quota card",
    "field.showSidebarQuota.hint": "Shows a quota card at the bottom of the sidebar; while off, no background usage request is made.",
    "field.quotaRefreshMinutes": "Usage refresh interval (minutes)",
    "field.quotaRefreshMinutes.hint": "How often the sidebar card and the settings page read usage data (the settings cache expires on the same schedule); paused while the tab is hidden, and failures are slowed down automatically.",
    "field.sidebarRotateMinutes": "Sidebar rotation interval (minutes)",
    "field.sidebarRotateMinutes.hint": "When several providers show quota in the sidebar, the card switches provider every this many minutes (tab order, current account of each).",
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
    "vendor.opendesign": "Open Design",
    "field.workspaceId": "Workspace ID",
    "field.workspaceId.hint": "Workspace used by the local vela CLI for periodic quota (Coding Plan); an account entry's own value wins.",
    "field.walletBase": "Quota service URL",
    "field.walletBase.hint": "Base URL of the quota and billing API, separate from the inference URL.",
    "credentials.updated": "Credentials updated",
    "account.configured": "Configured",
    "account.missing": "Not configured",
    "account.empty": "No accounts yet.",
    "account.count": "{n} account(s) in total",
    "account.unavailable": "Account data is not available yet.",
    "account.loading": "Loading accounts…",
    "account.add": "Add account",
    "account.addFor": "Use an API key",
    "account.loginFor": "Web login",
    "account.addAccount": "Add account",
    "account.addAccount.hint": "Pick a provider, then an API key or web login.",
    "account.orderTitle": "Switch order",
    "account.orderHint": "One global order shared by both providers; each rotates its own projection.",
    "account.rename": "Rename",
    "account.replaceKey": "Replace key",
    "account.pin": "Switch to this account",
    "account.use": "Use",
    "account.current": "Current",
    "account.models": "Models",
    "account.remove": "Remove",
    "account.menu": "More actions",
    "account.expand": "Show full report",
    "account.collapse": "Hide report",
    "account.plan": "Plan",
    "account.pinnedBy": "Selected",
    "account.effectiveBy": "In use",
    "account.liveBy": "Serving",
    "account.quotaMissing": "No quota data",
    "quota.used": "Used {used}",
    "quota.usedOf": "Used {used} of {cap}",
    "quota.usedPercent": "Used {percent}%",
    "quota.remaining": "{percent}% left",
    "quota.unlimited": "Unlimited",
    "quota.resetToday": "Resets today at {time}",
    "quota.resetTomorrow": "Resets tomorrow at {time}",
    "quota.resetAtLong": "Resets {date} {time}",
    "quota.resetUnknown": "Reset time not provided",
    "quota.resetAt": "Resets at",
    "quota.window.fiveHour": "5 hours",
    "quota.window.rolling": "Rolling window",
    "quota.window.daily": "Daily",
    "quota.window.weekly": "Weekly",
    "quota.window.monthly": "Monthly",
    "quota.window.monthlyCredits": "Monthly credits",
    "quota.capOnly": "Cap {cap}",
    "quota.window.plan": "Plan",
    "quota.window.unknown": "Quota",
    "quota.planMonthly": "{amount} per month",
    "quota.planPeriodEnd": "Period ends {date}",
    "quota.planStatus.trialing": "Trialing",
    "quota.planStatus.past_due": "Past due",
    "quota.planStatus.canceled": "Canceled",
    "quota.planStatus.incomplete": "Payment incomplete",
    "account.newLabel": "Account name",
    "account.newLabel.placeholder": "e.g. work",
    "account.newKey.placeholder": "Paste the API key",
    "account.newKey": "API key",
    "account.newKey.hint": "The key is stored in the local credential store only; settings never keep the plaintext.",
    "account.addTitle": "Add a {vendor} account",
    "account.labelRequired": "Enter an account name first.",
    "account.keyRequired": "Enter a key first.",
    "account.serviceNotReady": "The account service isn't ready yet; try again in a moment.",
    "account.confirm": "Confirm",
    "account.cancel": "Cancel",
    "account.login": "Sign in with browser",
    "account.loginWaiting": "Waiting for the browser to finish signing in. This goes away by itself once it does; if no browser opened, use the link below.",
    "account.loginCode": "Enter this code in the browser: {code}",
    "account.loginStarting": "Starting the browser sign-in…",
    "account.loginCancel": "Cancel sign-in",
    "account.loginFailed": "The browser sign-in could not start.",
    "account.loginExpired": "This sign-in attempt expired. Start it again with “Sign in with browser”.",
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
    "models.refresh": "Refresh models",
    "models.refreshing": "Refreshing…",
    "models.refreshAccount": "Refresh this account's models",
    "models.newBadge": "New",
    "models.removedTitle": "Removed models",
    "models.removedHint": "Restoring only puts it back in the list; it stays off.",
    "models.restore": "Restore",
    "models.addTitle": "Add a model manually",
    "models.updatedAt": "Updated at {time}",
    "models.freeGroup": "Free models",
    "models.otherCompany": "Other",
    "models.allTitle": "All models",
    "models.allHint": "Models from all three providers; a toggle writes through to its provider immediately. Models start off until checked or enabled by group.",
    "models.hideGroup": "Hide all models in this group",
    "models.showGroup": "Show all models in this group",
    "models.hideVendor": "Hide all models from this provider",
    "models.showVendor": "Show all models from this provider",
    "sidebar.pinned": "Selected",
    "sidebar.effective": "In use",
    "sidebar.open": "Open the usage panel",
    "sidebar.noRequest": "No request has used this account yet.",
    "usage.failed": "Usage read failed",
    "usage.failure.timeout": "Timed out",
    "usage.failure.whoami": "Account info read failed",
    "usage.failure.usage": "Usage read failed",
    "usage.failure.credits": "Credit balance read failed",
    "usage.failure.subscriptions": "Subscription info read failed",
    "usage.failure.window": "Some quota windows are missing",
    "usage.failure.quota": "Quota read failed",
    "usage.failure.accountQuota": "Quota read failed for account {account}",
    "usage.failure.models": "Model catalog read failed",
    "usage.failure.modelsUnsupported": "This vendor exposes no model catalog",
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
    "switch.reason.scheduled": "scheduled switch",
    "dashboard.title": "Accounts & usage",
    "dashboard.close": "Close",
    "dashboard.refresh": "Refresh",
    "dashboard.accounts": "Accounts",
    "dashboard.noData": "No usage data to show yet.",
    "dashboard.unknown": "Unknown",
    "account.reason.credential-slot-taken": "That credential slot already belongs to another account, so the key was not written. Rename or remove that account first.",
    "account.reason.invalid-key": "The key was rejected; check that it belongs to this account.",
    "account.reason.unavailable": "The sign-in service is temporarily unavailable.",
    "account.reason.cancelled": "Cancelled.",
    "account.reason.timeout": "Timed out waiting for authorisation.",
    "account.reason.denied": "Authorisation was denied.",
    "account.reason.network": "Network error.",
    "account.reason.vela-missing": "vela is not installed here and there is no local sign-in to import. Install the Open Design desktop app (or the vela CLI) and try again.",
    "account.reason.no-signin": "The browser never finished signing in (vela exited). Try again and approve in the browser.",
    "account.reason.config-invalid": "The local sign-in data has an unrecognised shape (no runtime key). Sign in again.",
    "account.reason.error": "Sign-in failed.",
    "empty.noVendor": "No vendor to display.",
    "webSearch.title": "Web search",
    "webSearch.hint": "Choose who performs web search in a session: follow the model account's native search, or switch to DeepSeek official or any third-party search API.",
    "webSearch.loading": "Reading the web search settings…",
    "webSearch.readFailed": "Could not read the web search settings",
    "webSearch.option.account": "Follow the model account",
    "webSearch.option.account.hint": "Run search through the current default model's provider gateway, no extra key needed (the gateway must support it).",
    "webSearch.option.deepseek": "DeepSeek official",
    "webSearch.option.deepseek.hint": "Use the host's built-in DeepSeek search; the key is configured in the host's own \"Web search\" card.",
    "webSearch.option.custom": "Third-party API",
    "webSearch.option.custom.hint": "Generic custom endpoint: fill in the URL and key; fits common shapes such as Tavily or Serper.",
    "webSearch.effective": "Currently in effect: {provider}",
    "webSearch.effective.none": "The host has no search source configured (no provider selected).",
    "webSearch.route": "Current default model: {model} on {vendor}",
    "webSearch.supported": "This account gateway supports native web search.",
    "webSearch.unsupported": "This account gateway does not support native search",
    "webSearch.noModel": "No default model is set, so there is no account to follow.",
    "webSearch.account.keyConfigured": "Account gateway key configured ({ref}).",
    "webSearch.account.keyMissing": "Account gateway key not configured ({ref}).",
    "webSearch.field.endpoint": "Endpoint URL",
    "webSearch.field.endpoint.hint": "Full URL returning search results as JSON, e.g. https://api.tavily.com/search.",
    "webSearch.field.method": "HTTP method",
    "webSearch.field.queryParam": "Query parameter",
    "webSearch.field.queryParam.hint": "Parameter name appended to the URL for GET, usually q or query.",
    "webSearch.field.queryField": "Body field",
    "webSearch.field.queryField.hint": "Field name carrying the query in the POST JSON body.",
    "webSearch.field.keyField": "Key field",
    "webSearch.field.keyField.hint": "Leave empty to send the key in a header; filled in, the key goes into this body field.",
    "webSearch.field.resultsPath": "Results array path",
    "webSearch.field.resultsPath.hint": "Leave empty to auto-detect; e.g. data.results, pointing at the results array.",
    "webSearch.field.authHeader": "Key header",
    "webSearch.field.authHeader.hint": "Header name carrying the key, usually Authorization.",
    "webSearch.field.authScheme": "Auth scheme",
    "webSearch.field.authScheme.hint": "Prefix before the key in the header, usually Bearer; empty means the raw value.",
    "webSearch.key": "Search API key",
    "webSearch.key.keep": "A saved key is never shown again; fill it in only to replace it.",
    "webSearch.key.placeholder": "Paste a new API key (leave empty to keep)",
    "webSearch.key.configured": "Key configured ({ref}).",
    "webSearch.key.missing": "Key not configured ({ref}).",
    "webSearch.key.unreadable": "Key status unavailable (credential service unreachable).",
    "webSearch.key.unavailable": "The credential service is unavailable, so the key could not be written.",
    "webSearch.deepseek.hint": "The key goes in the host's own \"Web search\" card; this card only switches the search source.",
    "webSearch.save": "Save web search",
    "webSearch.saving": "Saving…",
    "webSearch.saveHint": "Takes effect immediately; only writes this plugin's own settings row.",
    "webSearch.failure": "Save failed",
    "webSearch.saved": "Saved; the search source has been switched.",
    "webSearch.rowMissing": "This plugin's settings row has not been created by the host yet, so saving is unavailable.",
    "webSearch.webRowMissing": "The host's \"Web search\" settings row does not exist, so the source cannot be switched; settings were saved.",
    "webSearch.blocked": "Settings saved; search source not switched: {reason}",
    "webSearch.blocked.endpoint": "The third-party endpoint is empty or not a valid URL.",
    "webSearch.blocked.noKey": "Account gateway key not configured ({ref}).",
    "webSearch.blocked.noModel": "No default model is set.",
    "webSearch.blocked.unsupported": "The current account gateway does not support native web search.",
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
