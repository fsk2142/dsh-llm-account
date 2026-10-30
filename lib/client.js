window.__ModuleLoader__.load({
	id: "dsh-llm-account",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/copy.ts
		/** 两套文案。键必须成对出现（由 `missingCopyKeys` 与测试保证）。 */
		const COPY = {
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
				"field.switchStrategy.hint": "额度用尽后：按顺序切到下一个账号。额度优先：按间隔比较剩余额度。定时：按间隔轮换。",
				"field.switchIntervalMinutes": "额度评估间隔（分钟）",
				"field.switchIntervalMinutes.hint": "仅「额度优先」用。最大 30 天，可填天/小时/分钟；全 0 表示只在当前账号耗尽时评估。",
				"field.switchAtTurnEnd": "等任务结束后再切换",
				"field.switchAtTurnEnd.hint": "开启后回合内只记录决定，下回合首次请求才真正换号。",
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
				"field.showSidebarQuota.hint": "开启后侧边栏显示额度卡片；关闭时不做后台用量查询。",
				"field.quotaRefreshMinutes": "用量刷新间隔（分钟）",
				"field.autoSwitchModelOnQuota": "额度用尽后自动切换模型",
				"field.autoSwitchModelOnQuota.hint": "账号额度用尽时换一个模型继续：同网关同名 → 跨网关同名 → 同网关同类 → 跨网关同类（同档内取能力最接近的）。只在该账号已勾选的模型里挑。",
				"field.quotaRefreshMinutes.hint": "侧边栏与设置页读取用量的间隔（设置页缓存同步失效）；标签页隐藏时暂停，失败自动放慢。",
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
				"field.autoContinue": "异常中断时自动重试",
				"field.autoContinue.hint": "请求失败后自动重试；只有手动停止不重试。上下文超长、密钥无效、额度用尽这类重试必然失败的除外。（回答被截断的自动续写暂不支持：DSH 还没提供需要的宿主接口。）",
				"field.autoContinueMaxAttempts": "每轮最多重试次数",
				"field.autoContinueMaxAttempts.hint": "封顶，防止无限重试烧额度。缺省 3。",
				"field.autoContinueIntervalMs": "重试间隔（毫秒）",
				"field.autoContinueIntervalMs.hint": "每次重试前等待多久。缺省 2000 毫秒；三次重试共约 6 秒。",
				"field.searchStrategy": "搜索方式",
				"field.searchStrategy.hint": "网关路：模型调服务端搜索工具，按 token 计费。API 路：直连 /v1/tools/search，按请求次数计费，需填下面的 key。",
				"options.searchGatewayFirst": "网关优先（省 API 余额）",
				"options.searchApiFirst": "API 优先（省 token）",
				"options.searchGatewayOnly": "只用网关",
				"options.searchApiOnly": "只用 API",
				"field.searchApiKeyRefs": "DeepSeek API key 引用名",
				"field.searchApiKeyRefs.hint": "凭据库里的引用名（非明文）。多个用逗号分隔，按顺序轮替：前一个无效或余额不足时换下一个。",
				"options.searchOff": "不启用网页搜索",
				"search.secretAdd": "添加密钥",
				"search.secretRemove": "删除",
				"search.secretEmpty": "还没有添加密钥。",
				"search.secretSave": "保存密钥",
				"search.secretSaving": "保存中…",
				"search.secretPlaceholder": "粘贴 DeepSeek API key",
				"search.secretHint": "密钥只写入本机凭据库，设置文件里不留明文。",
				"search.secretNeedRef": "先在上面填一个凭据引用名，这里才能保存密钥。",
				"search.keyConfigured": "已添加",
				"search.keyMissing": "未添加",
				"search.keyTest": "测试",
				"search.keyTesting": "测试中…",
				"search.keyOk": "可用",
				"search.keyInvalid": "不可用",
				"search.keyUnknown": "暂时无法验证",
				"card.display": "显示设置",
				"card.display.hint": "侧边栏额度卡片要不要显示、多久刷新一次。三家共用。",
				"card.switching": "切换设置",
				"card.switching.hint": "什么时候换号/换模型、中断后要不要自动继续。三家共用。",
				"card.search": "搜索设置",
				"card.search.hint": "联网搜索走哪条路：优先网关订阅额度，否则用下面这个 API key。三家共用。",
				"card.advanced": "高级设置",
				"card.advanced.hint": "端点、超时与输出上限。带厂商徽标的项只对那一家生效。",
				"vendor.features": "切换与搜索",
				"vendor.opencodeGo": "OpenCode",
				"vendor.opendesign": "Open Design",
				"field.workspaceId": "工作区 ID",
				"field.workspaceId.hint": "vela 查周期额度（Coding Plan）用的工作区；账号条目里配了则以条目为准。",
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
				"account.restoreName": "恢复默认名称",
				"account.replaceKey": "更换密钥",
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
				"quota.estimatedPrefix": "约 ",
				"quota.resetAt": "重置于",
				"quota.window.fiveHour": "5 小时",
				"quota.window.rolling": "滚动窗口",
				"quota.window.daily": "每日",
				"quota.window.weekly": "每周",
				"quota.window.monthly": "每月",
				"sidebar.usagePeriod": "用量周期",
				"sidebar.resetTime": "重置时间",
				"quota.window.monthlyCredits": "月度额度",
				"quota.capOnly": "上限 {cap}",
				"usage.title": "用量",
				"usage.window.today": "今日",
				"usage.window.7d": "近 7 天",
				"usage.window.30d": "近 30 天",
				"usage.window.all": "全部",
				"usage.requests": "请求",
				"usage.okShort": "成功",
				"usage.failedShort": "失败",
				"usage.requestsValue": "{total} 次（成功 {ok} · 失败 {failed}）",
				"usage.successRate": "成功率",
				"usage.tokens": "Token",
				"usage.input": "未命中输入",
				"usage.output": "输出",
				"usage.inputShort": "入",
				"usage.outputShort": "出",
				"usage.cacheRead": "缓存命中",
				"usage.cacheWrite": "缓存写入",
				"usage.cacheHitRate": "缓存命中率",
				"usage.cost": "花费",
				"usage.spent": "本周期已花",
				"usage.spentWindow": "{window} 窗口已用",
				"usage.lastAt": "最近一次请求",
				"usage.failuresTitle": "失败明细",
				"usage.exportCsv": "导出 CSV",
				"usage.exporting": "导出中…",
				"usage.exportFailed": "导出失败",
				"usage.clearFailed": "清空失败",
				"usage.clear": "清空",
				"usage.clearConfirm": "清空全部用量记录？此操作不可撤销。",
				"usage.clearConfirmAction": "确认清空",
				"usage.clearing": "清空中…",
				"usage.officialCost": "≈ 按 DeepSeek 官方价",
				"usage.officialShort": "官方价",
				"usage.localOnly": "仅本机",
				"usage.costPartial": "≈ 仅统计了有官方价的模型，不是全部花费",
				"usage.fromVendor": "官方账号口径",
				"usage.localSpent": "本机折合",
				"usage.priceUnknown": "未公开",
				"usage.period": "本周期",
				"usage.periodRange": "账期 {from} – {to}",
				"usage.periodFrom": "自 {from} 起",
				"usage.periodFromVendor": "按厂商重置时间",
				"usage.periodEstimated": "按自然{kind}推算",
				"usage.perAccount": "按账号（各自记账周期）",
				"usage.total": "合计（当前窗口）",
				"usage.empty": "还没有用量记录。发一次请求后这里就会出现数字。",
				"usage.emptyAccount": "这个账号还没有用量记录。发一次请求后这里就会出现统计。",
				"usage.loading": "正在读取用量…",
				"usage.readFailed": "用量读取失败",
				"usage.kind.five-hour": "5 小时",
				"usage.kind.day": "日",
				"usage.kind.week": "周",
				"usage.kind.month": "月",
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
				"account.loginWaiting": "等待浏览器授权。完成后自动消失；没弹出浏览器时点下面链接打开。",
				"account.loginCode": "在浏览器里输入代码：{code}",
				"account.loginStarting": "正在启动网页登录…",
				"account.loginCancel": "取消登录",
				"account.loginFailed": "网页登录没能启动。",
				"account.loginExpired": "这次登录已过期。点「网页登录」重新开始。",
				"account.moveUp": "上移",
				"account.moveDown": "下移",
				"account.autoSwitch": "额度耗尽时自动切换账号",
				"account.autoSwitch.hint": "立即生效。关闭后一次额度拒绝不会把请求打到下一个账号上。",
				"models.loading": "正在读取模型目录…",
				"models.retry": "重试",
				"models.refreshAccount": "刷新此账号的模型",
				"models.freeGroup": "免费模型",
				"models.otherCompany": "其他",
				"models.selectAll": "全选",
				"models.clearAll": "取消全选",
				"models.quotaHint": "这个模型在当前套餐下的可用额度（官方公布值）",
				"models.quotaFree": "免费",
				"models.quotaApprox": "约 {amount}",
				"models.quotaUnknown": "未知",
				"drift.title": "插件已更新",
				"drift.body": "当前页面运行的是 {page}，磁盘上已是 {disk}。刷新后才能使用新功能。",
				"drift.reload": "立即刷新",
				"drift.later": "稍后",
				"sidebar.pinned": "已指定",
				"sidebar.effective": "当前使用",
				"sidebar.open": "点击打开用量面板",
				"sidebar.noRequest": "还没有请求经过这个账号。",
				"sidebar.noShortWindow": "没有 5 小时 / 每周额度数据（这里只显示这两档）。",
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
				"account.vela.title": "怎么快速把环境装上",
				"account.vela.step1": "① 最省事：装 Open Design 桌面端（安装包内自带 vela，装完不用再配 PATH）：https://open-design.ai/download",
				"account.vela.step2": "② 或只装命令行（已装 Node.js 时）：在终端执行下面这条命令",
				"account.vela.step3": "③ 装完回到这里点「网页登录」重试；若 vela 不在 PATH 里，可设环境变量 VELA_BIN 指向它的完整路径，然后重启 DSH",
				"account.vela.command": "npm i -g @powerformer/vela-cli",
				"account.vela.retry": "重试网页登录",
				"update.title": "插件已更新",
				"update.body": "新装的插件要等页面重新加载后才会出现在界面上（侧边栏卡片、中台面板都是）。刷新一下本页即可，不用重启 DSH。",
				"update.action": "刷新页面",
				"update.check": "检查更新",
				"update.notChecked": "还没检查过。点「检查更新」看有没有新版本。",
				"update.checking": "正在检查…",
				"update.section": "插件更新",
				"update.start": "更新到新版本",
				"update.available": "有新版本：{installed} → {latest}",
				"update.current": "已是最新版本（{installed}）。",
				"update.notApplicable": "当前是**本地链接安装**（{installed}），它跟着源码走，不会通过更新按钮变化 —— 改了代码刷新页面即可。要装发行版，请从插件市场重新安装一次。",
				"update.unknown": "暂时查不到更新信息：{reason}",
				"update.availableShort": "有新版本",
				"update.currentShort": "已是最新",
				"update.notApplicableShort": "本地链接安装，不会更新",
				"update.unknownShort": "查不到更新信息：{reason}",
				"update.starting": "正在更新…",
				"update.done": "装好了。刷新页面后新版本才会生效（下面那个「刷新页面」按钮）。",
				"update.failed": "更新失败：{reason}",
				"account.reason.no-signin": "浏览器里没有完成授权（vela 已退出）。请重试并在浏览器里批准。",
				"account.reason.config-invalid": "本机的登录产物形状不认识（缺少 runtime key）。请重新登录一次。",
				"account.reason.error": "登录失败。",
				"empty.noVendor": "没有可显示的厂商。"
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
				"field.switchStrategy.hint": "Order: switch when the current account is exhausted. Quota-first: compare remaining quota on an interval. Scheduled: rotate on an interval.",
				"field.switchIntervalMinutes": "Quota evaluation interval (minutes)",
				"field.switchIntervalMinutes.hint": "Quota-first only. Max 30 days (days/hours/minutes); all zero evaluates only when the current account is exhausted.",
				"field.switchAtTurnEnd": "Wait until the turn ends",
				"field.switchAtTurnEnd.hint": "When on, the switch is parked during the turn and applied on the next turn's first request.",
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
				"field.showSidebarQuota.hint": "Shows a quota card in the sidebar; while off, no background usage request is made.",
				"field.quotaRefreshMinutes": "Usage refresh interval (minutes)",
				"field.autoSwitchModelOnQuota": "Auto-switch model when quota runs out",
				"field.autoSwitchModelOnQuota.hint": "When on, running out of quota switches to another model automatically: same gateway + same model first, then cross-gateway same model, then same gateway + comparable model, then cross-gateway comparable model (closest capability within a tier). Only models enabled for that account are considered. Off by default.",
				"field.quotaRefreshMinutes.hint": "How often the sidebar and settings page read usage (settings cache expires on the same schedule); paused while hidden, slowed on failures.",
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
				"field.autoContinue": "Auto-retry interrupted runs",
				"field.autoContinue.hint": "Retries failed requests; only a manual stop is left alone. Deterministic failures (context too long, invalid key, quota) are not retried. (Auto-continuing a truncated answer is not supported yet: DSH does not expose the host API it needs.)",
				"field.autoContinueMaxAttempts": "Max retries per turn",
				"field.autoContinueMaxAttempts.hint": "Caps the loop so it cannot burn quota forever. Default 3.",
				"field.autoContinueIntervalMs": "Retry interval (ms)",
				"field.autoContinueIntervalMs.hint": "Wait before each retry. Default 2000 ms; three retries take about 6 s.",
				"field.searchStrategy": "Search route",
				"field.searchStrategy.hint": "Gateway: the model calls the server-side search tool; billed per token. API: calls /v1/tools/search directly; billed per request, needs the key below.",
				"options.searchGatewayFirst": "Gateway first (save API balance)",
				"options.searchApiFirst": "API first (save tokens)",
				"options.searchGatewayOnly": "Gateway only",
				"options.searchApiOnly": "API only",
				"options.searchOff": "Web search off",
				"field.searchApiKeyRefs": "DeepSeek API key references",
				"field.searchApiKeyRefs.hint": "Credential reference names, not literal secrets. Comma-separated; tried in order when one is invalid or out of balance.",
				"search.secretAdd": "Add key",
				"search.secretRemove": "Remove",
				"search.secretEmpty": "No keys added yet.",
				"search.secretSave": "Save key",
				"search.secretSaving": "Saving…",
				"search.secretPlaceholder": "Paste the DeepSeek API key",
				"search.secretHint": "The key is written to the local credential store; the settings file never holds it.",
				"search.secretNeedRef": "Fill in a credential reference name above first, then you can save the key here.",
				"search.keyConfigured": "added",
				"search.keyMissing": "not added",
				"search.keyTest": "Test",
				"search.keyTesting": "Testing…",
				"search.keyOk": "Works",
				"search.keyInvalid": "Not working",
				"search.keyUnknown": "Could not verify",
				"card.display": "Display",
				"card.display.hint": "Whether the sidebar quota card shows, and how often it refreshes. Shared by all vendors.",
				"card.switching": "Switching",
				"card.switching.hint": "When to switch account/model, and whether to continue after an interruption. Shared.",
				"card.search": "Search",
				"card.search.hint": "Which route web search takes: gateway subscription quota first, then this API key. Shared.",
				"card.advanced": "Advanced",
				"card.advanced.hint": "Endpoints, timeouts and output limits. Items with a vendor badge apply to that vendor only.",
				"vendor.features": "Switching & Search",
				"vendor.opencodeGo": "OpenCode",
				"vendor.opendesign": "Open Design",
				"field.workspaceId": "Workspace ID",
				"field.workspaceId.hint": "Workspace for vela periodic quota (Coding Plan); an account entry's own value wins.",
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
				"account.restoreName": "Restore default name",
				"account.replaceKey": "Replace key",
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
				"quota.estimatedPrefix": "approx. ",
				"quota.resetAt": "Resets at",
				"quota.window.fiveHour": "5 hours",
				"quota.window.rolling": "Rolling window",
				"quota.window.daily": "Daily",
				"quota.window.weekly": "Weekly",
				"quota.window.monthly": "Monthly",
				"sidebar.usagePeriod": "Period",
				"sidebar.resetTime": "Resets",
				"quota.window.monthlyCredits": "Monthly credits",
				"quota.capOnly": "Cap {cap}",
				"usage.title": "Usage",
				"usage.window.today": "Today",
				"usage.window.7d": "Last 7 days",
				"usage.window.30d": "Last 30 days",
				"usage.window.all": "All",
				"usage.requests": "Requests",
				"usage.okShort": "ok",
				"usage.failedShort": "failed",
				"usage.requestsValue": "{total} (ok {ok} · failed {failed})",
				"usage.successRate": "Success rate",
				"usage.tokens": "Tokens",
				"usage.input": "Uncached input",
				"usage.output": "Output",
				"usage.inputShort": "in",
				"usage.outputShort": "out",
				"usage.cacheRead": "Cache read",
				"usage.cacheWrite": "Cache write",
				"usage.cacheHitRate": "Cache hit rate",
				"usage.cost": "Cost",
				"usage.spent": "Spent this period",
				"usage.spentWindow": "{window} window used",
				"usage.lastAt": "Last request",
				"usage.failuresTitle": "Failures",
				"usage.exportCsv": "Export CSV",
				"usage.exporting": "Exporting…",
				"usage.exportFailed": "Export failed",
				"usage.clearFailed": "Clear failed",
				"usage.clear": "Clear",
				"usage.clearConfirm": "Clear all usage records? This cannot be undone.",
				"usage.clearConfirmAction": "Clear all",
				"usage.clearing": "Clearing…",
				"usage.officialCost": "≈ at DeepSeek list price",
				"usage.officialShort": "list price",
				"usage.localOnly": "this device only",
				"usage.costPartial": "≈ priced models only; not the full amount",
				"usage.fromVendor": "vendor account scope",
				"usage.localSpent": "local equivalent",
				"usage.priceUnknown": "not published",
				"usage.period": "This period",
				"usage.periodRange": "Billing period {from} – {to}",
				"usage.periodFrom": "Since {from}",
				"usage.periodFromVendor": "anchored to the vendor reset",
				"usage.periodEstimated": "estimated from the natural {kind}",
				"usage.perAccount": "Per account (own billing period)",
				"usage.total": "Total (current window)",
				"usage.empty": "No usage recorded yet. Send a request and the numbers appear here.",
				"usage.emptyAccount": "No usage recorded for this account yet. Send one request and its stats appear here.",
				"usage.loading": "Reading usage…",
				"usage.readFailed": "Could not read usage",
				"usage.kind.five-hour": "5 hours",
				"usage.kind.day": "day",
				"usage.kind.week": "week",
				"usage.kind.month": "month",
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
				"account.loginWaiting": "Waiting for browser sign-in. Disappears once done; if no browser opened, use the link below.",
				"account.loginCode": "Enter this code in the browser: {code}",
				"account.loginStarting": "Starting the browser sign-in…",
				"account.loginCancel": "Cancel sign-in",
				"account.loginFailed": "The browser sign-in could not start.",
				"account.loginExpired": "This sign-in attempt expired. Start it again with “Sign in with browser”.",
				"account.moveUp": "Move up",
				"account.moveDown": "Move down",
				"account.autoSwitch": "Switch accounts automatically when quota runs out",
				"account.autoSwitch.hint": "Takes effect immediately. While off, one quota rejection will not send the request to the next account.",
				"models.loading": "Loading the model catalog…",
				"models.retry": "Retry",
				"models.refreshAccount": "Refresh this account's models",
				"models.freeGroup": "Free models",
				"models.otherCompany": "Other",
				"models.selectAll": "Select all",
				"models.clearAll": "Clear all",
				"models.quotaHint": "Allowance this model gets under the current plan (official figure)",
				"models.quotaFree": "Free",
				"models.quotaApprox": "~{amount}",
				"models.quotaUnknown": "Unknown",
				"drift.title": "Plugin updated",
				"drift.body": "This page runs {page}, but {disk} is installed. Reload to use the new version.",
				"drift.reload": "Reload now",
				"drift.later": "Later",
				"sidebar.pinned": "Selected",
				"sidebar.effective": "In use",
				"sidebar.open": "Click to open the usage panel",
				"sidebar.noRequest": "No request has used this account yet.",
				"sidebar.noShortWindow": "No 5-hour / weekly quota data (only those two are shown here).",
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
				"account.vela.title": "How to install what's missing",
				"account.vela.step1": "① Easiest: install the Open Design desktop app — it bundles vela, no PATH setup needed: https://open-design.ai/download",
				"account.vela.step2": "② Or install just the CLI (requires Node.js). Run this in a terminal:",
				"account.vela.step3": "③ Then come back and press “Sign in with browser” again. If vela is not on PATH, set VELA_BIN to its full path and restart DSH.",
				"account.vela.command": "npm i -g @powerformer/vela-cli",
				"account.vela.retry": "Retry browser sign-in",
				"update.title": "The plugin was updated",
				"update.body": "A newly installed plugin only shows up after the page reloads (sidebar card, middle panel). Reload this page — no need to restart DSH.",
				"update.action": "Reload page",
				"update.check": "Check for updates",
				"update.notChecked": "Not checked yet. Click \"Check for updates\" to see if a newer version exists.",
				"update.checking": "Checking…",
				"update.section": "Plugin update",
				"update.start": "Update to the new version",
				"update.available": "New version: {installed} → {latest}",
				"update.current": "You're on the latest version ({installed}).",
				"update.notApplicable": "This is a **linked local install** ({installed}); it follows the source tree and never changes through an update button — edit the code and reload the page. To use a release build, install it from the plugin market again.",
				"update.unknown": "Could not check for updates: {reason}",
				"update.availableShort": "Update available",
				"update.currentShort": "Up to date",
				"update.notApplicableShort": "Linked install — no updates",
				"update.unknownShort": "Update check failed: {reason}",
				"update.starting": "Updating…",
				"update.done": "Installed. Reload the page to start using the new version (the button below).",
				"update.failed": "Update failed: {reason}",
				"account.reason.no-signin": "The browser never finished signing in (vela exited). Try again and approve in the browser.",
				"account.reason.config-invalid": "The local sign-in data has an unrecognised shape (no runtime key). Sign in again.",
				"account.reason.error": "Sign-in failed.",
				"empty.noVendor": "No vendor to display."
			}
		};
		/**
		* 取一个语言下的取词函数（与宿主 `ctx.locale.bind(ns)` 的语义一致：键缺失时回退到键名）。
		* @param language - 目标语言。
		* @returns `(key) => 文案`。
		*/
		function dictionaryOf(language) {
			const dictionary = COPY[language];
			return (key) => dictionary[key] ?? key;
		}
		/**
		* 拒绝分类（`FailureKind`）→ 文案键。
		*
		* 四种「能指名」的切换原因沿用切换提示的文案（额度耗尽/被限流/凭据失效 —— 同一件事的两种
		* 读法，文案通用）；其余三种失败分类有各自的拒绝文案。**未知分类不在这张表里**：调用方
		* 回退到「未知」，绝不把原始枚举或键名印到界面上。
		*/
		const REJECTION_COPY_KEYS = {
			quota: "switch.reason.quota",
			"rate-limit": "switch.reason.rate-limit",
			"invalid-credential": "switch.reason.invalid-credential",
			unavailable: "rejection.unavailable",
			server: "rejection.server",
			network: "rejection.network"
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
		function rejectionText(t, kind) {
			const key = REJECTION_COPY_KEYS[kind];
			if (key === void 0) return t("dashboard.unknown");
			const text = t(key);
			return text === key ? t("dashboard.unknown") : text;
		}
		//#endregion
		//#region src/client/css.ts
		/**
		* 统一页面与各卡片的样式表。
		*
		* 约束（Global Constraints）：界面**只用宿主 `--dsw-*` 变量**、自带 `<style data-plugin-css>`、
		* 不修改宿主 DOM 结构。所以这里：
		* - **没有**任何硬编码颜色（`#rrggbb`/`rgb()`/`hsl()`/颜色名一律不出现）—— 主题切换与深浅色由宿主变量承担；
		* - 尺寸用 px（间距/半径不属于主题），字号尽量取宿主的刻度；
		* - 变量名取自**本机已装宿主实际发布的集合**（从桌面端主题包与前端产物里逐个核对出来的，不是编的），例如
		*   `--dsw-alias-label-primary`、`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l2`、
		*   `--dsw-alias-button-primary-fill`、`--dsw-alias-state-business-primary`、`--dsw-radius-md`。
		*   **若某个变量在目标宿主上不存在**：该属性回落到继承/默认值（或用 `var(--x, var(--y))` 给第二选择），
		*   最坏情形是这一处没有颜色，不会崩。
		*
		* 设计语言（与宿主设置页一致）：
		* - 卡片：发丝描边 + `--dsw-radius-xl` + 设置卡片的填充色，扁平、没有投影；
		* - 行：标签在左（附说明在其下）、控件在右；行与行之间是发丝线，不是方框；
		* - 控件：32px 高、`--dsw-radius-md`、发丝描边；行内动作小一档；
		* - 强调色只用于状态（成功/警示/错误）与进度条；主按钮走宿主的「反色」主按钮；
		* - 图标按钮 28px 见方，悬停才浮出底色；破坏性动作平时安静。
		*
		* 作用域：本包只给自己的元素加类（`dsl-` 前缀）与 `data-*` 属性，不动宿主节点、不用 `!important`。
		* @module dsh-llm-account/src/client/css
		*/
		/**
		* 本包在 npm 上的名字。
		*
		* 用它而不是手写 `"@dsh-llm-account"`：插件市场与宿主的诊断工具都按**包名**找人
		* （`data-plugin="<包名>"`），写错一个前缀就让「这个样式是谁注入的」查不到。
		*/
		const PACKAGE_NAME = "dsh-llm-account";
		/** 本包样式表的 id（`<style data-plugin-css="…">` 的值，注入幂等的依据）。 */
		const PAGE_CSS_ID = "@dsh-llm-account/page.css";
		/**
		* 组合类名。
		*
		* 「档位」（颜色/角色）与「尺寸」（行内小一档）必须能自由组合，所以渲染层要拼两三个类。
		* 放在这里是因为类名常量就住在这个模块：**渲染层与样式表共用一个真值来源**。
		* 样式表那边每个类各自都是完整按钮（见按钮一节），所以这里即便拼错，也只是少一层
		* 颜色或尺寸，不会掉回浏览器默认样式。
		* @param names - 类名（都是 {@link CSS_CLASS} 里的常量）。
		* @returns 空格分隔的类名。
		*/
		function cls(...names) {
			return names.join(" ");
		}
		/**
		* 统一页面 + 卡片 + 侧边栏 + 仪表盘的样式。
		*
		* 三处界面（设置页 / 侧边栏额度卡 / 中栏用量面板）共用这一套 token 与形状，**这是它们
		* 看起来像同一个东西的唯一依据**——分成三份样式各写各的，是「一边精致一边像调试输出」
		* 的根源。
		*/
		const PAGE_CSS = `
/* ═══ 页面骨架 ═══ */
.dsl-root { display: flex; flex-direction: column; gap: 12px; max-width: 720px; padding-bottom: 56px;
  font-family: var(--dsw-font-family); font-size: 14px; line-height: 22px;
  color: var(--dsw-alias-label-primary); }
.dsl-header { display: flex; flex-direction: column; gap: 4px; }
/* 标题行：名字在左、版本与更新控件在右。
   两端对齐 + 允许换行：窄侧边栏里控件掉到第二行，而不是把标题挤没。 */
.dsl-title-row { display: flex; align-items: center; justify-content: space-between;
  gap: 8px; flex-wrap: wrap; }
/* 右侧控件：版本号 / 状态 / 按钮三段横排，都压到 12px 以免比标题还显眼。 */
.dsl-update-meter { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 12px; line-height: 18px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
/* 版本号用等宽字形：v0.1.0 这类短串在比例字体里会跳字。 */
.dsl-update-version { font-family: var(--dsw-font-family-mono, ui-monospace, monospace);
  font-size: 12px; color: var(--dsw-alias-label-secondary); text-wrap: nowrap; }
.dsl-update-state { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsl-root h1 { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; letter-spacing: normal; }
.dsl-root h2 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; letter-spacing: normal; }
.dsl-root h3, .dsl-root h4 { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px;
  letter-spacing: normal; color: var(--dsw-alias-label-secondary); }
.dsl-intro { margin: 0; font-size: 13px; line-height: 20px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
.dsl-root p { margin: 0; }
.dsl-root small { display: block; font-size: 12px; line-height: 18px; letter-spacing: normal;
  color: var(--dsw-alias-label-tertiary); }
.dsl-mono { font-family: var(--dsw-font-mono); letter-spacing: 0; }

/* ═══ 标签页：与宿主设置页同款的下划线标签 ═══ */
.dsl-tabs { display: flex; flex-direction: row; gap: 24px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsl-tab { display: inline-flex; align-items: center; height: auto; margin: 0 0 -1px; padding: 6px 0 8px;
  border: none; border-bottom: 2px solid transparent; border-radius: 0; background: none;
  color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; letter-spacing: normal; cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease; }
.dsl-tab:hover { color: var(--dsw-alias-label-primary); }
.dsl-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-brand-primary); }
.dsl-tab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; border-radius: var(--dsw-radius-xs); }

/* ═══ 卡片：宿主设置卡片的原样形状（发丝描边 + radius-xl + 扁平） ═══ */
.dsl-card { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; padding: 14px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill); }
.dsl-card > h2 { flex: none; }
.dsl-card > [data-card-hint] { margin-top: -8px; }
.dsl-card > summary { display: flex; flex-direction: row; align-items: center; gap: 8px; padding: 0;
  color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px;
  list-style: none; cursor: pointer; }
.dsl-card > summary::-webkit-details-marker { display: none; }
.dsl-card > summary > svg { flex: none; color: var(--dsw-alias-label-tertiary); }
.dsl-card[open] > summary > svg { transform: rotate(180deg); }
/* 可收起卡片的标题行：标题占满，当前状态缩到右端（收起时也能读到关键信息）。 */
.dsl-card-summary-title { flex: 1 1 auto; min-width: 0; }
.dsl-card-summary > small { flex: none; margin: 0; text-align: right; }
/* 收起状态下不显示正文的额外间距（details 自动隐藏，这里只补布局）。 */
.dsl-card[open] > summary { margin-bottom: 2px; }
.dsl-model-summary-title { font-size: 15px; font-weight: 600; line-height: 24px; }
.dsl-model-vendor-group { display: flex; flex-direction: column; gap: 4px; padding-top: 8px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-model-vendor-group:first-of-type { border-top: none; padding-top: 0; }
.dsl-model-group { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 2px 10px; }
.dsl-model-group-summary { display: flex; flex-direction: row; align-items: center; gap: 6px;
  padding: 2px 0; list-style: none; cursor: pointer; color: var(--dsw-alias-label-secondary); }
.dsl-model-group-summary::-webkit-details-marker { display: none; }
.dsl-model-group-summary > svg { flex: none; transition: transform 150ms ease; }
.dsl-model-group-summary > button { flex: none; margin-left: auto; padding: 0 6px; font-size: 11px; line-height: 18px; }
.dsl-model-group[open] > .dsl-model-group-summary > svg,
.dsl-model-vendor-group[open] > .dsl-model-group-summary > svg { transform: rotate(180deg); }
.dsl-model-group-title { font-size: 12px; line-height: 18px; font-weight: 600; }
.dsl-model-add { display: flex; flex-direction: column; gap: 8px; padding-top: 12px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-model-add-title { font-size: 13px; line-height: 20px; font-weight: 600; }
.dsl-model-add-row { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsl-model-add-select { flex: 0 0 auto; min-width: 120px; border: 0; background: transparent;
  padding: 4px 0; color: var(--dsw-alias-label-secondary); }
.dsl-model-add-input { flex: 1 1 220px; min-width: 0; border: 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2); border-radius: 0; background: transparent; padding: 6px 0; }
.dsl-model-add .dsl-actions { justify-content: flex-end; }
/* 「这个模型在这个套餐下能用多少额度」：次要文字，紧挨在开关左边。
   margin-inline-start:auto 让它靠右（模型名在左、额度与开关在右），
   与「模型名 …… 额度信息 开关」的出现顺序一致。 */
.dsl-model-quota { flex: none; margin-inline-start: auto; padding-inline-end: 8px;
  font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary); text-wrap: nowrap; }
/* 「未知」：官方没公布这个模型的额度。
   比正常额度更淡一档，读作「这里没有数据」而不是「额度是这个词」。 */
.dsl-model-quota-unknown { color: var(--dsw-alias-label-tertiary); }
.dsl-card > summary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 4px; border-radius: var(--dsw-radius-xs); }
/* 卡片底部的常驻开关（如 OpenCode 的自动切换）：一条分隔线把它们与账号列表分开。 */
.dsl-card-footer { display: flex; flex-direction: row; align-items: center; gap: 16px;
  padding-top: 12px; border-top: .5px solid var(--dsw-alias-border-l1); }

/* ═══ 设置行：标签与说明在左、控件在右，行间一条发丝线 ═══ */
.dsl-field { display: flex; flex-direction: row; align-items: center; gap: 16px; padding: 8px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l1); font-size: 14px; line-height: 22px; }
.dsl-field:last-child { border-bottom: none; }
.dsl-field-text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0;
  color: var(--dsw-alias-label-primary); font-weight: 400; }
.dsl-field-text > small { font-weight: 400; }

/* ═══ 输入控件 ═══ */
.dsl-field input[type="text"], .dsl-field input[type="number"], .dsl-field input[type="password"],
.dsl-field select, .dsl-inline input[type="text"], .dsl-inline input[type="password"],
.dsl-add-field input[type="text"], .dsl-add-field input[type="password"],
.dsl-search input, .dsl-actions input[type="text"], .dsl-actions input[type="password"] {
  box-sizing: border-box; height: 32px; width: 100%; margin: 0; padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 13px;
  line-height: 20px; transition: border-color 120ms ease; }
.dsl-field input:hover, .dsl-field select:hover, .dsl-inline input:hover, .dsl-add-field input:hover,
.dsl-search input:hover, .dsl-actions input:hover { border-color: var(--dsw-alias-border-l4); }
.dsl-field input:focus, .dsl-field select:focus, .dsl-inline input:focus, .dsl-add-field input:focus,
.dsl-search input:focus, .dsl-actions input:focus { outline: none;
  border-color: var(--dsw-alias-state-business-primary); }
.dsl-field input::placeholder, .dsl-inline input::placeholder, .dsl-add-field input::placeholder,
.dsl-search input::placeholder, .dsl-actions input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsl-duration { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 6px; flex: none; }
.dsl-duration-part { display: inline-flex; flex-direction: row; align-items: center; gap: 4px;
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsl-duration-part > input { width: 64px; }
.dsl-field input:disabled, .dsl-field select:disabled { cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); }
.dsl-field input[type="number"] { font-variant-numeric: tabular-nums; }
/* 控件贴右、宽度按内容：留给标签列的宽度永远是整行剩余部分（标签不再被挤成竖排单字）。 */
.dsl-field > input[type="text"], .dsl-field > input[type="password"] { flex: 0 0 240px; width: 240px; }
.dsl-field > input[type="number"] { flex: 0 0 140px; width: 140px; }
.dsl-field > select { flex: 0 0 180px; width: 180px; }
/* 还有未保存输入的字段：左侧留一道提示条，让「卡片里那个保存按钮管哪几项」一眼可见。
 * 自动保存没有进度暗示，这个标记是用户唯一能看出「我改的东西还在草稿里」的线索。 */
.dsl-field[data-field-pending="true"] { position: relative; }
.dsl-field[data-field-pending="true"]::before { content: ""; position: absolute; left: -6px;
  top: 50%; transform: translateY(-50%); width: 2px; height: 16px; border-radius: 999px;
  background: var(--dsw-alias-state-business-primary); }

/* ═══ 搜索密钥列表（已添加的那几条） ═══
 * 需求：「添加后那个默认名占的位置太宽，降低一下高度」。
 *
 * 这些是**列表项**，不是可编辑的设置行，所以不复用 14px 字号 + 上下 8px 内边距：
 * 那条设置行给的是「标签 + 说明 + 控件」的三段高度，而这里只有「一个名字 + 一个 ×」。
 * 压到 12px 字号、上下各 2px，并把状态徽标改成同一行的尾注（不再另起一行）。
 */
.dsl-secret-row { gap: 10px; padding: 2px 0; font-size: 12px; line-height: 18px;
  border-bottom: none; align-items: center; }
.dsl-secret-row .dsl-field-text { flex-direction: row; align-items: center; gap: 8px;
  flex-wrap: nowrap; min-width: 0; font-size: 12px; line-height: 18px; }
/* 引用名可能很长（DEEPSEEK_API_KEY_12）：省略而不是把行撑宽或把 × 挤出去。 */
.dsl-secret-row .dsl-mono { min-width: 0; overflow: hidden; text-overflow: ellipsis;
  text-wrap: nowrap; }
.dsl-secret-row .dsl-field-text > small { flex: none; }
/* × 也矮一档：图标按钮默认 28px，在这一行里比文字高出一截。 */
.dsl-secret-row > .dsl-icon-danger { width: 22px; height: 22px; }
.dsl-secret-row > .dsl-icon-danger svg { width: 14px; height: 14px; }
/* 列表容器：几条紧挨着，不要 8px 的整段间隙（否则「矮了」看不出来）。 */
[data-secret-rows] { gap: 0; padding: 2px 10px; }
[data-secret-rows] > small { font-size: 12px; line-height: 18px; }

/* ═══ 「插件已更新，刷新页面」提示条（2026-10-20） ═══
 * 只在「设置页打得开、侧边栏卡片却没挂上」时出现。用提示色而不是错误色：这不是故障，
 * 是一次正常的安装/更新需要浏览器重新走一遍启动图。
 */
.dsl-notice { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2);
  border-left: 2px solid var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.dsl-notice-title { font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-primary); }
.dsl-notice > small { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
/* 按钮不该被纵向 flex 拉成通栏。 */
.dsl-notice > button { align-self: flex-start; }

/* ═══ vela 缺失时的安装指引（只在这一种登录失败时出现） ═══
 * 三档可执行路径 + 一行可复制的命令。刻意用内嵌面板（dsl-inset）而不是一句话：
 * 需求 要的是「如何快速安装环境」，不是「请先安装」。
 */
.dsl-vela-guide-title { font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-primary); }
/* 命令块：等宽、可整行选中、允许横向滚动（命令不长，但别让它把卡片撑破）。 */
.dsl-inset > code { display: block; box-sizing: border-box; max-width: 100%; padding: 6px 8px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono); font-size: 12px; line-height: 18px;
  overflow-x: auto; text-wrap: nowrap; user-select: all; }

/* ═══ 开关（appearance:none 画出来的滑轨，比默认复选框更符合「开/关」语义） ═══ */
.dsl-toggle { appearance: none; -webkit-appearance: none; position: relative; flex: none;
  box-sizing: border-box; width: 34px; height: 20px; margin: 0; padding: 0; border: none;
  border-radius: 999px; background: var(--dsw-alias-border-l2); cursor: pointer;
  transition: background 150ms ease; }
.dsl-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; box-sizing: border-box;
  width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-static-neutral-bluish-00);
  transition: transform 150ms ease; }
.dsl-toggle:checked { background: var(--dsw-alias-state-business-primary); }
.dsl-toggle:checked::after { transform: translateX(14px); }
.dsl-toggle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; }
.dsl-toggle:disabled { cursor: not-allowed; opacity: .5; }

/* ═══ 搜索框：发丝边 + 左侧留白给放大镜（两个伪元素画出来，不引图标字体） ═══ */
.dsl-search { position: relative; display: flex; flex-direction: row; align-items: center; }
.dsl-search input { padding-left: 32px; }
.dsl-search::before { content: ""; position: absolute; left: 12px; top: 50%; margin-top: -6px;
  box-sizing: border-box; width: 10px; height: 10px; border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-radius: 50%; pointer-events: none; }
.dsl-search::after { content: ""; position: absolute; left: 21px; top: 50%; margin-top: 3px;
  width: 6px; height: 1.5px; background: var(--dsw-alias-label-tertiary);
  transform: rotate(45deg); pointer-events: none; }
.dsl-search-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }

/* ═══ 按钮 ═══
 * 两条纪律：
 * 1. 我们渲染的每一个按钮都有形状：:where() 把容器那半截选择器的特异度归零，所以这里只管
 *    「没挂任何档位类」的兜底，档位类永远压得过它。
 * 2. 每个档位类**各自都是完整按钮**：只挂一个也是这个形状。
 */
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button,
.dsl-button, .dsl-button-primary, .dsl-button-secondary, .dsl-button-ghost, .dsl-button-danger,
.dsl-button-sm, .dsl-icon, .dsl-icon-danger, .dsl-item {
  display: inline-flex; flex-direction: row; align-items: center; justify-content: center; gap: 6px;
  box-sizing: border-box; height: 32px; padding: 0 12px; margin: 0;
  border: .5px solid transparent; border-radius: var(--dsw-radius-md); background: none;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500;
  line-height: 20px; letter-spacing: normal; text-align: center; text-wrap: nowrap;
  cursor: pointer; transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  -webkit-appearance: none; appearance: none; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button svg,
.dsl-button svg, .dsl-button-primary svg, .dsl-button-secondary svg, .dsl-button-ghost svg,
.dsl-button-danger svg, .dsl-button-sm svg, .dsl-icon svg, .dsl-icon-danger svg, .dsl-item svg {
  flex: none; width: 16px; height: 16px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button:focus-visible,
.dsl-button:focus-visible, .dsl-button-primary:focus-visible, .dsl-button-secondary:focus-visible,
.dsl-button-ghost:focus-visible, .dsl-button-danger:focus-visible, .dsl-button-sm:focus-visible,
.dsl-icon:focus-visible, .dsl-icon-danger:focus-visible, .dsl-item:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px; }
:where(.dsl-root, .dsl-dashboard, .dsl-sidebar, .dsl-settings-panel) button:disabled { cursor: not-allowed; }
.dsl-button-primary { background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground); }
.dsl-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsl-button-primary:disabled { border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); }
.dsl-button-secondary { border-color: var(--dsw-alias-border-l3); }
.dsl-button-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-button-secondary:disabled { border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-dimmed); }
.dsl-button-ghost { color: var(--dsw-alias-label-secondary); }
.dsl-button-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-button-ghost:disabled, .dsl-button-danger:disabled, .dsl-button-sm:disabled {
  color: var(--dsw-alias-label-dimmed); }
.dsl-button-danger { color: var(--dsw-alias-state-error-primary); }
.dsl-button-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover)); }
/* 行内动作小一档：宿主 rowActions 的原样数值（28px / 12px / radius-sm） */
.dsl-button-sm { height: 28px; padding: 0 10px; border-radius: var(--dsw-radius-sm);
  font-size: 12px; line-height: 18px; }
.dsl-button-sm svg { width: 14px; height: 14px; }
/* 图标按钮：见方、无文字，悬停浮出底色；破坏性版本平时也保持安静，悬停才变色。 */
.dsl-icon, .dsl-icon-danger { width: 28px; height: 28px; padding: 0;
  border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); }
.dsl-icon:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-icon-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger,
  var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-state-error-primary); }
.dsl-icon[aria-expanded="true"] svg { transform: rotate(180deg); }
.dsl-icon svg, .dsl-icon-danger svg, .dsl-card > summary > svg {
  transition: transform 150ms ease; transform-box: fill-box; transform-origin: center; }
/* 按账户刷新模型的加载态：图标转圈（aria-busy 由渲染层挂上，与 disabled 同时出现）。 */
@keyframes dsl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dsl-icon[aria-busy="true"] svg { animation: dsl-spin 900ms linear infinite; }
/* 菜单项：占满菜单宽度的左对齐行 */
.dsl-item { justify-content: flex-start; width: 100%; height: 30px; padding: 0 8px; gap: 8px;
  border-radius: var(--dsw-radius-sm); font-size: 13px; font-weight: 400; text-align: left; }
.dsl-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsl-item.dsl-button-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-state-error-primary); }
/* 溢出菜单：一个原生 details，摘要就是 28px 的图标按钮；面板绝对定位在它的右下角。 */
.dsl-menu { position: relative; flex: none; }
.dsl-menu > summary { list-style: none; }
.dsl-menu > summary::-webkit-details-marker { display: none; }
.dsl-menu[open] > summary { background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary); }
.dsl-menu-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; min-width: 176px;
  padding: 5px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-shadow-lv3); }
.dsl-actions { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-actions > input[type="text"], .dsl-actions > input[type="password"] {
  flex: 1 1 180px; width: auto; min-width: 0; }
.dsl-inline { display: flex; flex-direction: row; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsl-inline input[type="text"], .dsl-inline input[type="password"] { flex: 1 1 180px; }

/* ═══ 内嵌面板：展开报告、编辑器、登录说明、错误详情 ═══ */
.dsl-inset { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 10px 12px;
  border: .5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-inset p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere; }
.dsl-inset[data-report] p { font-family: var(--dsw-font-mono); }
.dsl-inset .dsl-inline { padding: 0; }
/* 编辑器是「一行输入 + 两个按钮」：inset 与 inline 同时挂上时按行排（否则纵向布局会把
 * 输入框的 flex-basis 当高度用，面板被撑成一整块空白）。 */
.dsl-inset.dsl-inline { flex-direction: row; align-items: center; gap: 8px; }
/* 内嵌面板是纵向 flex：按钮不该被拉成通栏（登录入口曾经是一整条 660px 的框）。 */
.dsl-inset > button, .dsl-inset > .dsl-actions, .dsl-inset > .dsl-add { align-self: flex-start; }
/* 卡片里的独立按钮同样不该被拉成通栏（卡片是纵向 flex，默认 align-items:stretch）。 */
.dsl-card > button { align-self: flex-start; }
.dsl-link { color: var(--dsw-alias-link); font-family: var(--dsw-font-mono); font-size: 12px;
  line-height: 18px; overflow-wrap: anywhere; }

/* ═══ 空态：虚线框里一句话，不是一段裸文本 ═══ */
.dsl-note { margin: 0; padding: 2px 0; color: var(--dsw-alias-label-tertiary); font-size: 13px;
  line-height: 20px; }
.dsl-empty { box-sizing: border-box; margin: 0; padding: 14px 12px; text-align: center;
  border: .5px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ═══ 添加账户：收起时是一个入口，展开时是一张表单 ═══ */
.dsl-add { display: flex; flex-direction: column; gap: 8px; }
.dsl-add > .dsl-field { border-bottom: none; padding: 0; }
/* 表单标题：说明「正在往哪家加账号」（面板底部只有一个表单位置，前后两家共用）。 */
.dsl-add-title { font-size: 13px; line-height: 20px; font-weight: 600; }
/* 表单字段：标签在上、输入占满整行（添加表单不是设置行，标签不需要与输入抢同一行）。 */
.dsl-add-field { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-field > small { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dsl-add-field > input { width: 100%; }
.dsl-add-trigger { display: flex; flex-direction: row; align-items: center; justify-content: center;
  gap: 6px; align-self: stretch; box-sizing: border-box; height: 38px; padding: 0 12px;
  border: .5px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-lg);
  background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px;
  line-height: 20px; cursor: pointer; transition: background 120ms ease, border-color 120ms ease,
  color 120ms ease; }
.dsl-add-trigger::before { content: "+"; font-size: 15px; line-height: 1;
  color: var(--dsw-alias-label-tertiary); }
.dsl-add-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l4); color: var(--dsw-alias-label-primary); }
.dsl-add-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px; }

/* ═══ 账户面板头部：标题 + 账号数 + 右侧动作（重新获取模型） ═══ */
.dsl-panel-head { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsl-panel-head > h2 { flex: none; }
.dsl-panel-count { flex: none; box-sizing: border-box; padding: 1px 8px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsl-panel-head > .dsl-actions { margin-left: auto; }

/* ═══ 账号行：身份行（名称 + 标记 + 动作）在上，额度表在其下 ═══
 * 2026-10-18 起改成**内嵌卡片**：一张账号一块浅色填充 + 发丝描边 + radius-lg，
 * 行与行之间用间距分隔而不是分割线 —— 与中栏用量面板的账号卡片同一形状，
 * 两处界面看起来才是同一个东西。生效账号用强调色描边标出，与用量面板的
 * data-dashboard-effective 同一条语义。 */
.dsl-account-list { display: flex; flex-direction: column; gap: 8px; }
.dsl-account { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 12px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-settings-card-fill); }
/* 生效账号：强调色描边（与用量面板的 data-dashboard-effective 同一条语义）；
 * 被拒绝（冷却/额度用尽）的账号用警示色描边，扫一眼就能看出谁在冷却。 */
.dsl-account[data-effective="true"] { border-color: var(--dsw-alias-state-business-primary); }
.dsl-account[data-rejection-kind] { border-color: var(--dsw-alias-state-warn-primary); }
.dsl-account-group { display: flex; flex-direction: column; gap: 8px; padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l1); }
.dsl-account-group:first-of-type { border-top: none; padding-top: 0; }
.dsl-account-group > h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600;
  color: var(--dsw-alias-label-secondary); }
.dsl-account-head { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsl-account-actions { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center;
  gap: 2px; margin-left: auto; }
.dsl-account-actions > .dsl-actions { gap: 2px; flex-wrap: nowrap; }
.dsl-vendor-badge { flex: none; padding: 1px 6px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: 999px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; }
.dsl-new-badge { flex: none; padding: 1px 6px; border-radius: 999px; background:
  var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-inverse, var(--dsw-alias-label-primary));
  font-size: 10px; line-height: 16px; font-weight: 600; }
.dsl-add-chooser { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-group { display: flex; flex-direction: column; gap: 6px; }
.dsl-add-summary { display: inline-flex; flex-direction: row; align-items: center; align-self: flex-start;
  gap: 4px; list-style: none; cursor: pointer; color: var(--dsw-alias-state-business-primary);
  font-size: 13px; line-height: 20px; }
.dsl-add-summary::-webkit-details-marker { display: none; }
.dsl-order-summary { display: inline-flex; align-self: flex-start; list-style: none; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 600; line-height: 20px; }
.dsl-order-summary::-webkit-details-marker { display: none; }
.dsl-add-chooser > .dsl-actions { flex-wrap: wrap; }
.dsl-dot { flex: none; box-sizing: border-box; width: 7px; height: 7px; border-radius: 50%;
  background: var(--dsw-alias-border-l3); transition: background 150ms ease; }
.dsl-account[data-effective="true"] .dsl-dot,
.dsl-dashboard section[data-dashboard-effective="true"] .dsl-dot {
  background: var(--dsw-alias-state-success-primary); }
.dsl-account[data-rejection-kind] .dsl-dot,
.dsl-dashboard section[data-dashboard-rejection-kind] .dsl-dot {
  background: var(--dsw-alias-state-warn-primary); }
/* 身份块贴着自己的内容（不抢剩余宽度）：名称、标记按顺序排在一起，右端留给动作。 */
.dsl-identity { display: flex; flex-direction: row; align-items: center; gap: 9px;
  flex: 0 1 auto; min-width: 0; }
.dsl-identity-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsl-identity-text > small { font-size: 12px; line-height: 18px; }
.dsl-name-row { display: flex; flex-direction: row; align-items: center; gap: 6px; min-width: 0; }
.dsl-name-row > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap;
  font-size: 14px; font-weight: 500; line-height: 22px; }
/* 拒绝原因（冷却/额度用尽/服务端拒绝）：单独一行可读文本，用警示色，不装成标签。 */
.dsl-rejection { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-state-warn-primary); overflow-wrap: anywhere; }
/* 拖拽手柄：六个点（径向渐变点阵），不引图标字体、不引外部资源。 */
.dsl-drag { flex: none; width: 12px; height: 18px; margin-left: 2px; opacity: .55;
  cursor: grab; background-image: radial-gradient(circle at 2px 2px,
  var(--dsw-alias-label-tertiary) 1px, transparent 1.2px); background-size: 6px 6px; }

/* ═══ 标签（宿主 rowTag 的形状） ═══ */
.dsl-mark { flex: none; box-sizing: border-box; padding: 0 6px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 16px; font-weight: 400; text-wrap: nowrap; }
.dsl-mark[data-state="success"], .dsl-mark[data-mark="effective"] {
  color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.dsl-mark[data-state="warn"] {
  color: var(--dsw-alias-state-warn-label); border-color: var(--dsw-alias-state-warn-primary); }
.dsl-mark[data-mark="plan"] { color: var(--dsw-alias-label-secondary);
  border-color: var(--dsw-alias-border-l3); }

/* ═══ 额度：每个窗口一小块（标签 + 读数 + 4px 进度条） ═══ */
.dsl-meters { display: flex; flex-direction: column; gap: 10px; }
.dsl-sidebar .dsl-ring-row { flex-wrap: nowrap; gap: 2px; padding: 4px 0 0; }
.dsl-sidebar .dsl-ring { flex: 1 1 0; min-width: 0; }
.dsl-sidebar .dsl-ring-chart,
.dsl-sidebar .dsl-ring-svg { width: 38px; height: 38px; }
.dsl-sidebar .dsl-ring-percent { font-size: 11px; }
.dsl-sidebar .dsl-ring-label { font-size: 12px; line-height: 16px; }
.dsl-sidebar .dsl-ring-note { display: none; }
.dsl-sidebar .dsl-ring-reset { font-size: 10px; line-height: 13px; text-align: center; }
.dsl-sidebar .dsl-meters { display: flex; flex-direction: column; gap: 9px; }
.dsl-quota-row { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsl-meter-head { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between;
  gap: 8px; min-width: 0; font-size: 12px; line-height: 18px; }
.dsl-meter-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap;
  color: var(--dsw-alias-label-tertiary); }
.dsl-quota-value { flex: none; color: var(--dsw-alias-label-primary); font-size: 12px;
  line-height: 18px; font-variant-numeric: tabular-nums; }
.dsl-quota-hint { flex: none; margin-left: 6px; color: var(--dsw-alias-label-tertiary);
  font-size: 11px; line-height: 18px; }
/* 账号用量块：紧贴额度条下方，靠一条细分隔线与额度分开 —— 账号卡片本身就是外框，
   不再套第二层框（两层边框+两层内边距会把一行账号撑成一屏）。 */
.dsl-usage-section { display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
  padding-top: 8px; border-top: .5px dashed var(--dsw-alias-border-l1); }
.dsl-usage-head { display: flex; flex-direction: row; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dsl-usage-title { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-usage-period { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums; }
.dsl-usage-muted { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.dsl-usage-hint { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
/* 指标块：四块等宽横排，窄容器自动折行（设置页可能很窄）。 */
.dsl-usage-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
.dsl-usage-metric { display: flex; flex-direction: column; gap: 1px; box-sizing: border-box; padding: 7px 9px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-l1); min-width: 0; }
.dsl-usage-metric-value { font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: normal;
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dsl-usage-metric-label { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
.dsl-usage-metric-hint { font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; }
.dsl-usage-metric[data-tone="ok"] .dsl-usage-metric-value { color: var(--dsw-alias-state-success-primary); }
.dsl-usage-metric[data-tone="warn"] .dsl-usage-metric-value { color: var(--dsw-alias-state-warn-primary); }
.dsl-usage-metric[data-tone="muted"] .dsl-usage-metric-value { color: var(--dsw-alias-label-tertiary); }
/* 核对用的补充数（命中率、缓存读写、最近一次请求）：一行小字，不占指标位。 */
.dsl-usage-foot { display: flex; flex-direction: row; flex-wrap: wrap; gap: 2px 12px;
  font-size: 11px; line-height: 15px; }
.dsl-quota-bar-list { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.dsl-quota-bar { display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%; }
.dsl-quota-bar-head { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsl-quota-bar-label { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-quota-bar-percent { flex: none; font-size: 13px; line-height: 18px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-state-success-primary); }
.dsl-quota-bar[data-quota-bar-level="error"] .dsl-quota-bar-percent { color: var(--dsw-alias-state-error-primary); }
.dsl-quota-bar[data-quota-bar-level="missing"] .dsl-quota-bar-percent,
.dsl-quota-bar[data-quota-bar-level="unlimited"] .dsl-quota-bar-percent { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dsl-quota-bar-track { display: block; overflow: hidden; height: 8px; border-radius: 999px;
  background: var(--dsw-alias-border-l1); }
.dsl-quota-bar-fill { display: block; height: 100%; border-radius: inherit;
  background: var(--dsw-alias-state-success-primary); transition: width 200ms ease; }
.dsl-quota-bar-fill[data-level="error"] { background: var(--dsw-alias-state-error-primary); }
.dsl-quota-bar-meta { display: flex; flex-direction: row; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px;
  font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsl-quota-bar-reset { color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar .dsl-quota-bar-list { gap: 9px; }
.dsl-sidebar .dsl-quota-bar { gap: 3px; }
.dsl-sidebar .dsl-quota-bar-label,
.dsl-sidebar .dsl-quota-bar-percent { font-size: 12px; line-height: 17px; }
.dsl-sidebar .dsl-quota-bar-track { height: 6px; }
.dsl-sidebar .dsl-quota-bar-meta { font-size: 10px; line-height: 14px; }
.dsl-ring { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 64px; }
.dsl-ring-chart { position: relative; width: 40px; height: 40px; }
.dsl-ring-svg { display: block; width: 40px; height: 40px; }
.dsl-ring-track { fill: none; stroke: var(--dsw-alias-border-l2); stroke-width: 3; }
.dsl-ring-fill { fill: none; stroke-width: 3; stroke-linecap: round; transition: stroke-dasharray 200ms ease; }
.dsl-ring-fill[data-level="ok"] { stroke: var(--dsw-alias-state-success-primary); }
.dsl-ring-fill[data-level="warn"] { stroke: var(--dsw-alias-state-warn-primary); }
.dsl-ring-fill[data-level="error"] { stroke: var(--dsw-alias-state-error-primary); }
.dsl-ring-percent { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dsl-ring[data-quota-ring-level="ok"] .dsl-ring-percent { color: var(--dsw-alias-state-success-primary); }
.dsl-ring[data-quota-ring-level="warn"] .dsl-ring-percent { color: var(--dsw-alias-state-warn-primary); }
.dsl-ring[data-quota-ring-level="error"] .dsl-ring-percent { color: var(--dsw-alias-state-error-primary); }
.dsl-ring-label { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsl-ring-note { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsl-ring-reset { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-secondary); }
.dsl-ring-row { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 6px 0 2px; }
.dsl-ring-cell { display: flex; justify-content: center; }
.dsl-quota-track { display: block; flex: none; overflow: hidden; box-sizing: border-box; width: 100%;
  height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); }
.dsl-quota-fill { display: block; height: 100%; border-radius: inherit;
  background: var(--dsw-alias-state-business-primary); transition: width 200ms ease; }
.dsl-quota-fill[data-quota-level="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsl-quota-fill[data-quota-level="error"] { background: var(--dsw-alias-state-error-primary); }
.dsl-quota-missing { margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsl-quota { display: flex; flex-direction: column; gap: 8px; }
.dsl-failure { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-warn-primary);
  overflow-wrap: anywhere; }
.dsl-diagnostic { box-sizing: border-box; max-height: 240px; margin: 0; padding: 10px 12px;
  overflow: auto; border: .5px solid var(--dsw-alias-border-l2); border-left: 2px solid var(--dsw-alias-state-error-primary);
  border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-mono); font-size: 11px;
  line-height: 17px; overflow-wrap: anywhere; }
/* 渲染兜底面板：只在子树抛错时出现。虚线框 —— 它不是一个正常的分组，别让人误以为这是新功能。 */
.dsl-boundary { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 12px;
  border: 1px dashed var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-boundary > h2 { margin: 0; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.dsl-boundary > button { align-self: flex-start; }

/* ═══ 卡片内的保存条（只在有未保存输入时出现；放在卡片末尾，不浮动遮挡） ═══
 * 需求：「一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」。
 * 它现在住在**卡片里**（data-card-save），不再是页面底部那条 —— 所以这里只负责
 * 「一行按钮 + 一行小字」的排布，像一条分隔线，而不是一条横贯页面的操作栏。
 */
.dsl-save { position: static; display: flex; flex-direction: row;
  align-items: center; gap: 12px; box-sizing: border-box; margin-top: 12px; padding: 10px 14px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1); }
.dsl-save > small { flex: 1 1 auto; min-width: 0; }
/* 一行按钮不该被卡片（纵向 flex）拉成通栏，也不该把两个厂商名挤掉。 */
.dsl-save > button { align-self: flex-start; flex: none; }

/* ═══ 侧边栏额度卡（紧凑一档） ═══
 * 宿主侧边栏收起时，「sidebar.footer.action」 槽位只有约 35px 宽；整张卡片塞不进去会向左溢出到
 * 窗口外。外壳声明成宽度容器，窄的时候由容器查询换成单个图标按钮（完整卡片整个隐藏）。
 */
.dsl-sidebar-shell { display: block; box-sizing: border-box; width: 100%; min-width: 0;
  container-type: inline-size; }
.dsl-sidebar-compact { display: none; }
@container (max-width: 190px) {
  .dsl-sidebar-shell .dsl-sidebar { display: none; }
  .dsl-sidebar-shell .dsl-sidebar-compact { display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px; }
}
.dsl-sidebar { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 10px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill); color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; }
/* 整张卡片是一个按钮：点哪里都打开用量面板。
   所以它要长得像能点的：左对齐、指针、悬停浮起；且**不能**沿用按钮的居中与内边距。 */
.dsl-sidebar-button { width: 100%; text-align: left; font: inherit; cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease; }
.dsl-sidebar-button:hover { background: var(--dsw-alias-bg-l2);
  border-color: var(--dsw-alias-border-l3); }
.dsl-sidebar-button:active { background: var(--dsw-alias-bg-l1); }
.dsl-sidebar h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px;
  color: var(--dsw-alias-label-primary); }
.dsl-sidebar-head { display: flex; flex-direction: row; align-items: flex-start; gap: 8px; }
.dsl-sidebar-head > h3 { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  text-wrap: nowrap; }
/* 标题行的三种文字，视觉权重按「账号 > 厂商 > 套餐徽标」递减：
 * 只有**账号名**是深色加粗的主信息；厂商与套餐跟「用量周期」同色（tertiary），
 * 读作陪衬而不是第二个标题。
 *
 * **字号必须写死**：账号与厂商在 h3 里（13px），而套餐徽标是 h3 的兄弟节点、
 * 继承的是 .dsl-sidebar 的 12px —— 不加这一行两者会差 1px（需求 问
 * 「确认一下字号是否是统一的」，就是这一处）。 */
.dsl-sidebar-account { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsl-sidebar-vendor { font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar-vendor::before { content: " · "; }
/* 套餐徽标：**靠右对齐**。
 * margin-inline-start:auto 把它推到行尾；不换行，太长时由标题让位（h3 已可省略号）。
 * 字号与 h3 对齐见上一条注释。 */
.dsl-sidebar-plan { flex: none; margin-inline-start: auto; font-size: 13px; font-weight: 400;
  color: var(--dsw-alias-label-tertiary); text-wrap: nowrap; }
/* 额度行：**一条一行**，「标签 — 进度条 — 重置时间」横向三样。
 *
 * **对齐的关键**：列宽必须定义在**外层容器**上，不能每个行各写一套 —— 每一行是独立网格时，
 * 「5 小时」与「每周」标签宽度不同，后两列的起点就会错开（实际情况「对齐一下两个进度条」）。
 * 现在容器定义一次三列，每行用 display: contents 把子元素直接交给外层网格。 */
.dsl-sidebar-row-primary,
.dsl-sidebar-row-secondary { display: contents; }
.dsl-sidebar-windows { display: grid; grid-template-columns: max-content minmax(40px, 1fr) max-content;
  align-items: center; gap: 6px 8px; width: 100%; min-width: 0; }
/* 表头：「用量周期 / 重置时间」。字号更小、颜色更淡，读作标题而不是数据。
 * 中间那格是空的（对应进度条列），这样三列与下面的数据行严格对齐。 */
.dsl-sidebar-windows-head { display: contents; }
.dsl-sidebar-windows-head > .dsl-sidebar-window-label,
.dsl-sidebar-windows-head > .dsl-sidebar-window-reset { font-size: 10px; line-height: 14px;
  font-weight: 500; color: var(--dsw-alias-label-tertiary); }
.dsl-sidebar-window { display: contents; }
.dsl-sidebar-window-head { display: contents; }
.dsl-sidebar-window-label { font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary);
  text-wrap: nowrap; }
/* 重置时间：两行都有。等宽数字 + 固定不换行，两行的右边界因此对齐。 */
.dsl-sidebar-window-reset { font-size: 10px; line-height: 14px; justify-self: end;
  color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; text-wrap: nowrap; }
/* 百分比数值不再单独一行：条已经表达了比例（见 sidebarMeter 的说明）。 */
.dsl-sidebar-window-value { display: none; }
.dsl-sidebar-window[data-sidebar-window-level="error"] .dsl-sidebar-window-track {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l1)); }
.dsl-sidebar-window-track { display: block; overflow: hidden; height: 6px; border-radius: 999px;
  background: var(--dsw-alias-border-l1); min-width: 0; width: 100%; }
.dsl-sidebar-foot { display: flex; flex-direction: row; gap: 8px; }
.dsl-sidebar-foot > button { flex: 1 1 auto; }
.dsl-sidebar .dsl-empty { padding: 10px; font-size: 12px; line-height: 18px; }
.dsl-marks { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px;
  color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }

/* ═══ 中栏仪表盘 ═══
 *
 * **必须能滚动**：面板内容随账号数无限
 * 增长（每个账号一段额度 + 用量块），而中栏高度是固定的。给容器高度上限并让它自己滚 ——
 * 否则内容被裁掉、又没有滚动条，后面的账号根本看不到。
 *
 * 收缩的必要条件：默认 min-height 是 auto，会撑破父容器，于是 overflow 永远不生效 ——
 * 这是「加了 overflow 也不能滚」最常见的原因。 */
.dsl-dashboard { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;
  max-width: 760px; padding: 16px 20px 32px; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px;
  max-height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3) transparent; }
.dsl-dashboard::-webkit-scrollbar { width: 10px; }
.dsl-dashboard::-webkit-scrollbar-track { background: transparent; }
.dsl-dashboard::-webkit-scrollbar-thumb { border-radius: 999px; border: 3px solid transparent;
  background-clip: content-box; background-color: var(--dsw-alias-border-l3); }
.dsl-dashboard::-webkit-scrollbar-thumb:hover { background-color: var(--dsw-alias-label-tertiary); }
.dsl-dashboard > header { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.dsl-dashboard > header > h2 { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 16px;
  font-weight: 500; line-height: 24px; }
.dsl-dashboard h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px;
  color: var(--dsw-alias-label-secondary); }
.dsl-dashboard h4 { margin: 0; min-width: 0; font-size: 14px; font-weight: 500; line-height: 22px;
  overflow: hidden; text-overflow: ellipsis; text-wrap: nowrap; }
.dsl-dashboard p { margin: 0; font-size: 12px; line-height: 18px; }
.dsl-dashboard ul { margin: 0; padding-left: 16px; color: var(--dsw-alias-state-warn-primary);
  font-size: 12px; line-height: 18px; }
.dsl-dashboard small { display: block; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); }
.dsl-dashboard section { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
  padding: 12px 14px; border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-settings-card-fill); }
.dsl-dashboard section[data-dashboard-effective="true"] {
  border-color: var(--dsw-alias-state-business-primary); }

/* ═══ 主栏设置页外壳（「转到设置」打开的面板）═══
 * 一层薄壳：一条返回栏 + 设置页组件本体（dsl-root 自己管排版）。返回栏与仪表盘头部
 * 同形（左对齐一个幽灵按钮），下面直接接页面，不再套一层卡片 —— 设置页自己就有卡片分组。 */
.dsl-settings-panel { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;
  max-width: 760px; padding: 16px 20px 32px; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px; }
.dsl-settings-back { display: flex; flex-direction: row; align-items: center; }

/* ═══ 版本漂移提示（插件更新后页面仍跑旧代码）═══
 * 自建的覆盖层：宿主没有通用对话框 API（2026-10-22 查证）。
 *
 * **z-index 取 9999 而不是 2147483000**：那个最大值会压过宿主自己的模态框与菜单，
 * 用户点开确认框时可能被我们的提示挡住 —— 一个「提醒刷新」的框不该有这种权力。
 * 9999 足以盖过本插件自己的菜单（20）与常见面板（1000 级），又给宿主留了余地。
 * 只做一件事：告诉用户该刷新，并给两个按钮。 */
.dsl-drift-notice { position: fixed; inset: 0; z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 24px; box-sizing: border-box;
  background: var(--dsw-alias-bg-mask, var(--dsw-alias-bg-l1)); }
.dsl-drift-notice-card { display: flex; flex-direction: column; gap: 12px;
  box-sizing: border-box; width: 100%; max-width: 420px; padding: 20px 22px;
  border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-l2));
  color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px;
  box-shadow: 0 8px 32px var(--dsw-alias-bg-l1); }
.dsl-drift-notice-title { margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; }
.dsl-drift-notice-body { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsl-drift-notice-actions { display: flex; flex-direction: row; justify-content: flex-end; gap: 8px;
  padding-top: 4px; }
.dsl-drift-notice-later,
.dsl-drift-notice-reload { flex: none; padding: 6px 14px; border-radius: var(--dsw-radius-md);
  font: inherit; cursor: pointer; }
.dsl-drift-notice-later { border: .5px solid var(--dsw-alias-border-l2); background: transparent;
  color: var(--dsw-alias-label-secondary); }
.dsl-drift-notice-reload { border: 0; background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-button-primary-foreground, var(--dsw-alias-label-primary)); }
`;
		/** 各元素用到的类名（渲染层与样式表共用的唯一来源，避免两边写错字）。 */
		const CSS_CLASS = {
			root: "dsl-root",
			header: "dsl-header",
			intro: "dsl-intro",
			diagnostic: "dsl-diagnostic",
			boundary: "dsl-boundary",
			tabs: "dsl-tabs",
			tab: "dsl-tab",
			card: "dsl-card",
			cardFooter: "dsl-card-footer",
			panelHead: "dsl-panel-head",
			panelCount: "dsl-panel-count",
			account: "dsl-account",
			accountList: "dsl-account-list",
			accountGroup: "dsl-account-group",
			vendorBadge: "dsl-vendor-badge",
			newBadge: "dsl-new-badge",
			addChooser: "dsl-add-chooser",
			addSummary: "dsl-add-summary",
			orderSummary: "dsl-order-summary",
			cardSummary: "dsl-card-summary",
			cardSummaryTitle: "dsl-card-summary-title",
			modelSummary: "dsl-model-summary",
			modelSummaryTitle: "dsl-model-summary-title",
			modelGroup: "dsl-model-group",
			modelVendorGroup: "dsl-model-vendor-group",
			modelGroupSummary: "dsl-model-group-summary",
			modelGroupTitle: "dsl-model-group-title",
			modelAdd: "dsl-model-add",
			modelAddTitle: "dsl-model-add-title",
			modelQuota: "dsl-model-quota",
			modelQuotaUnknown: "dsl-model-quota-unknown",
			modelAddRow: "dsl-model-add-row",
			modelAddSelect: "dsl-model-add-select",
			modelAddInput: "dsl-model-add-input",
			duration: "dsl-duration",
			durationPart: "dsl-duration-part",
			mark: "dsl-mark",
			quota: "dsl-quota",
			quotaRow: "dsl-quota-row",
			quotaMissing: "dsl-quota-missing",
			failure: "dsl-failure",
			field: "dsl-field",
			secretRow: "dsl-secret-row",
			fieldText: "dsl-field-text",
			inline: "dsl-inline",
			inset: "dsl-inset",
			velaGuideTitle: "dsl-vela-guide-title",
			notice: "dsl-notice",
			noticeTitle: "dsl-notice-title",
			titleRow: "dsl-title-row",
			updateMeter: "dsl-update-meter",
			updateVersion: "dsl-update-version",
			updateState: "dsl-update-state",
			empty: "dsl-empty",
			note: "dsl-note",
			actions: "dsl-actions",
			add: "dsl-add",
			addField: "dsl-add-field",
			addTitle: "dsl-add-title",
			addGroup: "dsl-add-group",
			search: "dsl-search",
			searchCount: "dsl-search-count",
			button: "dsl-button",
			buttonPrimary: "dsl-button-primary",
			buttonSecondary: "dsl-button-secondary",
			buttonGhost: "dsl-button-ghost",
			buttonDanger: "dsl-button-danger",
			buttonSm: "dsl-button-sm",
			icon: "dsl-icon",
			iconDanger: "dsl-icon-danger",
			item: "dsl-item",
			menu: "dsl-menu",
			menuPanel: "dsl-menu-panel",
			addTrigger: "dsl-add-trigger",
			link: "dsl-link",
			accountHead: "dsl-account-head",
			accountActions: "dsl-account-actions",
			nameRow: "dsl-name-row",
			rejection: "dsl-rejection",
			drag: "dsl-drag",
			meters: "dsl-meters",
			meterHead: "dsl-meter-head",
			meterLabel: "dsl-meter-label",
			quotaValue: "dsl-quota-value",
			quotaHint: "dsl-quota-hint",
			quotaBar: "dsl-quota-bar",
			quotaBarHead: "dsl-quota-bar-head",
			quotaBarLabel: "dsl-quota-bar-label",
			quotaBarPercent: "dsl-quota-bar-percent",
			quotaBarTrack: "dsl-quota-bar-track",
			quotaBarFill: "dsl-quota-bar-fill",
			quotaBarMeta: "dsl-quota-bar-meta",
			quotaBarReset: "dsl-quota-bar-reset",
			quotaBarList: "dsl-quota-bar-list",
			usageSection: "dsl-usage-section",
			usageHead: "dsl-usage-head",
			usageTitle: "dsl-usage-title",
			usagePeriod: "dsl-usage-period",
			usageMuted: "dsl-usage-muted",
			usageHint: "dsl-usage-hint",
			usageMetrics: "dsl-usage-metrics",
			usageMetric: "dsl-usage-metric",
			usageMetricValue: "dsl-usage-metric-value",
			usageMetricLabel: "dsl-usage-metric-label",
			usageMetricHint: "dsl-usage-metric-hint",
			usageFoot: "dsl-usage-foot",
			ring: "dsl-ring",
			ringChart: "dsl-ring-chart",
			ringSvg: "dsl-ring-svg",
			ringTrack: "dsl-ring-track",
			ringFill: "dsl-ring-fill",
			ringPercent: "dsl-ring-percent",
			ringLabel: "dsl-ring-label",
			ringNote: "dsl-ring-note",
			ringReset: "dsl-ring-reset",
			ringRow: "dsl-ring-row",
			ringCell: "dsl-ring-cell",
			identity: "dsl-identity",
			identityText: "dsl-identity-text",
			mono: "dsl-mono",
			dot: "dsl-dot",
			toggle: "dsl-toggle",
			quotaTrack: "dsl-quota-track",
			quotaFill: "dsl-quota-fill",
			save: "dsl-save",
			sidebar: "dsl-sidebar",
			sidebarButton: "dsl-sidebar-button",
			sidebarWindows: "dsl-sidebar-windows",
			sidebarWindowsHead: "dsl-sidebar-windows-head",
			sidebarRowPrimary: "dsl-sidebar-row-primary",
			sidebarRowSecondary: "dsl-sidebar-row-secondary",
			sidebarWindow: "dsl-sidebar-window",
			sidebarWindowHead: "dsl-sidebar-window-head",
			sidebarWindowLabel: "dsl-sidebar-window-label",
			sidebarWindowReset: "dsl-sidebar-window-reset",
			sidebarWindowValue: "dsl-sidebar-window-value",
			sidebarWindowTrack: "dsl-sidebar-window-track",
			sidebarShell: "dsl-sidebar-shell",
			sidebarCompact: "dsl-sidebar-compact",
			sidebarHead: "dsl-sidebar-head",
			sidebarAccount: "dsl-sidebar-account",
			sidebarVendor: "dsl-sidebar-vendor",
			sidebarPlan: "dsl-sidebar-plan",
			sidebarFoot: "dsl-sidebar-foot",
			marks: "dsl-marks",
			dashboard: "dsl-dashboard"
		};
		/**
		* 注入本包的样式表（`<style data-plugin-css="…">`）。
		*
		* 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:8809-8818`）：
		* `document` 缺席（非浏览器）→ 空操作；**同 id 已存在 → 空操作**（这就是幂等的依据：两行各调一次
		* 也只注入一份）；否则建一个 `<style data-plugin="…" data-plugin-css="id">` 挂到 `head`，并返回移除器。
		*
		* `document` 的类型：tsconfig 的 `lib` 里没有 DOM（刻意的：宿主侧代码不该用 DOM API），所以这里做
		* 一次窄化结构读取，不给整个工程加 `DOM`。样式表与插槽注册是两件独立的事：注册失败不影响样式。
		* @param id - 样式表 id（`data-plugin-css` 的值）。
		* @param css - 样式文本。
		* @returns 移除器；没注入时是空操作。
		*/
		function injectPluginCss(id, css) {
			const dom = globalThis.document;
			if (dom?.head === void 0) return () => void 0;
			if (typeof dom.querySelector === "function" && dom.querySelector(`style[data-plugin-css="${id}"]`) !== null) return () => void 0;
			if (typeof dom.createElement !== "function") return () => void 0;
			const tag = dom.createElement("style");
			tag.setAttribute("data-plugin", PACKAGE_NAME);
			tag.setAttribute("data-plugin-css", id);
			tag.textContent = css;
			dom.head.appendChild(tag);
			return () => tag.remove?.();
		}
		//#endregion
		//#region src/core/model-groups.ts
		/** 公司键 → 展示名；未知公司回退到键本身。 */
		const COMPANY_LABELS = {
			anthropic: "Anthropic",
			openai: "OpenAI",
			google: "Google",
			xai: "xAI",
			deepseek: "DeepSeek",
			zhipuai: "Zhipu AI",
			alibaba: "Alibaba",
			moonshotai: "Moonshot AI",
			minimax: "MiniMax",
			xiaomi: "Xiaomi",
			tencent: "Tencent",
			meituan: "Meituan",
			stepfun: "StepFun",
			meta: "Meta",
			reflection: "Reflection",
			mistralai: "Mistral AI",
			cohere: "Cohere",
			baidu: "Baidu",
			bytedance: "ByteDance",
			opencode: "OpenCode",
			perplexity: "Perplexity",
			amazon: "Amazon",
			microsoft: "Microsoft",
			nvidia: "NVIDIA",
			ibm: "IBM",
			ai21: "AI21",
			nousresearch: "Nous Research",
			liquid: "Liquid AI",
			allenai: "Allen Institute",
			iflytek: "iFlytek",
			sensetime: "SenseTime",
			"01ai": "01.AI",
			baichuan: "Baichuan",
			shanghai_ai_laboratory: "Shanghai AI Lab",
			other: "其他"
		};
		/** models.dev / 目录里的公司别名（路径段 → 统一键）。 */
		const COMPANY_ALIASES = {
			"x-ai": "xai",
			xai: "xai",
			"meta-llama": "meta",
			meta: "meta",
			"z-ai": "zhipuai",
			zhipu: "zhipuai",
			zhipuai: "zhipuai",
			moonshot: "moonshotai",
			moonshotai: "moonshotai",
			alibaba: "alibaba",
			qwen: "alibaba",
			google: "google",
			anthropic: "anthropic",
			openai: "openai",
			deepseek: "deepseek",
			mistral: "mistralai",
			mistralai: "mistralai",
			cohere: "cohere",
			perplexity: "perplexity",
			amazon: "amazon",
			microsoft: "microsoft",
			nvidia: "nvidia",
			ibm: "ibm",
			ai21: "ai21",
			nousresearch: "nousresearch",
			liquid: "liquid",
			allenai: "allenai",
			iflytek: "iflytek",
			sensetime: "sensetime",
			"01ai": "01ai",
			baichuan: "baichuan"
		};
		/** id 前缀 → 公司键；顺序有意义（`gpt` 先于更泛的规则）。 */
		const ID_PREFIXES = [
			[/^claude(?:[-_]|$)/i, "anthropic"],
			[/^(?:gpt|codex)(?:[-_]|$)/i, "openai"],
			[/^o[1-9](?:[-_]|$)/i, "openai"],
			[/^gemini(?:[-_]|$)/i, "google"],
			[/^gemma(?:[-_]|$)/i, "google"],
			[/^grok(?:[-_]|$)/i, "xai"],
			[/^deepseek(?:[-_]|$)/i, "deepseek"],
			[/^glm(?:[-_]|$)/i, "zhipuai"],
			[/^(?:qwen|qwq)(?:[-_]|\d)/i, "alibaba"],
			[/^(?:kimi|moonshot)(?:[-_]|$)/i, "moonshotai"],
			[/^minimax(?:[-_]|$)/i, "minimax"],
			[/^mimo(?:[-_]|$)/i, "xiaomi"],
			[/^hy\d/i, "tencent"],
			[/^hunyuan(?:[-_]|$)/i, "tencent"],
			[/^longcat(?:[-_]|$)/i, "meituan"],
			[/^step(?:[-_]|$)/i, "stepfun"],
			[/^muse(?:[-_]|$)/i, "meta"],
			[/^llama(?:[-_]|$)/i, "meta"],
			[/^(?:mistral|codestral|devstral|magistral)(?:[-_]|$)/i, "mistralai"],
			[/^command(?:[-_]|$)/i, "cohere"],
			[/^ernie(?:[-_]|$)/i, "baidu"],
			[/^(?:doubao|seed)(?:[-_]|$)/i, "bytedance"],
			[/^phi(?:[-_]|$)/i, "microsoft"],
			[/^nova(?:[-_]|$)/i, "amazon"],
			[/^sonar(?:[-_]|$)/i, "perplexity"],
			[/^jamba(?:[-_]|$)/i, "ai21"],
			[/^granite(?:[-_]|$)/i, "ibm"],
			[/^nemotron(?:[-_]|$)/i, "nvidia"],
			[/^olmo(?:[-_]|$)/i, "allenai"],
			[/^lfm(?:[-_]|$)/i, "liquid"],
			[/^hermes(?:[-_]|$)/i, "nousresearch"],
			[/^yi(?:[-_]|$)/i, "01ai"],
			[/^internlm(?:[-_]|$)/i, "shanghai_ai_laboratory"],
			[/^baichuan(?:[-_]|$)/i, "baichuan"],
			[/^spark(?:[-_]|$)/i, "iflytek"],
			[/^sense(?:[-_]|$)/i, "sensetime"],
			[/^(?:chatglm|codegeex)(?:[-_]|$)/i, "zhipuai"],
			[/^beam(?:[-_]|$)/i, "reflection"]
		];
		/**
		* 归属公司键；优先用适配器给的 canonical 公司，缺省时按 id 前缀兜底。
		* @param id - 模型 id。
		* @param company - 适配器带下来的公司键。
		* @returns 公司键；认不出来是 `"other"`。
		*/
		function companyKeyOf(id, company) {
			if (company !== void 0 && company.trim() !== "") return company.trim();
			const segments = id.toLowerCase().split("/");
			for (const segment of segments.slice(0, -1)) {
				const alias = COMPANY_ALIASES[segment];
				if (alias !== void 0) return alias;
				if (Object.prototype.hasOwnProperty.call(COMPANY_LABELS, segment) && segment !== "other") return segment;
			}
			const base = segments.at(-1) ?? id;
			const normalized = base.replace(/\s+/g, "-").toLowerCase();
			for (const [pattern, key] of ID_PREFIXES) if (pattern.test(base) || pattern.test(normalized) || pattern.test(id)) return key;
			return "other";
		}
		/**
		* 公司展示名。
		* @param key - 公司键。
		* @returns 展示名；未知键原样返回（不丢信息）。
		*/
		function companyLabelOf(key) {
			if (key === "other") return COMPANY_LABELS.other;
			return COMPANY_LABELS[key] ?? key;
		}
		/**
		* 是否免费模型。目录的 `cost` 明确为 0 时优先；否则按 id 里的 `free` 段兜底
		* （`beam-free`、`step-5-preview-free`、`cat-jam-free`）。
		* @param id - 模型 id。
		* @param free - 目录的免费标记。
		* @returns 是否免费。
		*/
		function isFreeModel(id, free) {
			return free === true || /(?:^|[-_/])free(?:$|[-_/])/i.test(id) || /-free$/i.test(id);
		}
		/**
		* 分组：免费组永远第一，其余按公司首次出现顺序；`other` 放最后。
		* 输入顺序即目录顺序，组内也保持它。
		* @param models - 模型列表。
		* @returns 分组；空输入返回空数组。
		*/
		function groupModels(models) {
			const free = [];
			const groups = /* @__PURE__ */ new Map();
			for (const model of models) {
				if (isFreeModel(model.id, model.free)) {
					free.push(model.id);
					continue;
				}
				const key = companyKeyOf(model.id, model.company);
				const bucket = groups.get(key);
				if (bucket === void 0) groups.set(key, [model.id]);
				else bucket.push(model.id);
			}
			const out = [];
			if (free.length > 0) out.push({
				key: "free",
				models: free
			});
			for (const [key, ids] of groups) {
				if (key === "other") continue;
				out.push({
					key,
					models: ids
				});
			}
			const other = groups.get("other");
			if (other !== void 0 && other.length > 0) out.push({
				key: "other",
				models: other
			});
			return out;
		}
		//#endregion
		//#region src/client/failure-text.ts
		/**
		* 失败原文 → 界面上的人话。
		*
		* 为什么需要这一层：`failures[]` 是**诊断字符串** —— 有端点短名（`whoami`、`credits`），
		* 也有带厂商名与原因的包装（`quota: commandcode "工作账号" read failed (…)`）。直接印给用户
		* 看就是调试输出：2026-10-18 实际情况「用量面板里面多了一些英文」，看到的就是 Command Code
		* 端口记下的端点短名 `whoami`。这一层把**已知形状**映射成人话；原文由各渲染处留在 `data-*`
		* 属性里供排查。
		*
		* 认不出的形状**原样返回**：自证优先于美观 —— 真正意外的失败（宿主的能力缺失原文、远程面
		* 没挂上之类）要看得见；翻译不了的东西不假装翻译。
		* @module dsh-llm-account/src/client/failure-text
		*/
		/** 端点短名 → 文案键（Command Code 的 `QUOTA_ENDPOINTS`、OpenCode 的窗口键）。 */
		const SHORT_NAMES = {
			whoami: "usage.failure.whoami",
			usage: "usage.failure.usage",
			credits: "usage.failure.credits",
			subscriptions: "usage.failure.subscriptions",
			rolling: "usage.failure.window",
			weekly: "usage.failure.window",
			monthly: "usage.failure.window",
			"5h": "usage.failure.window",
			fiveHour: "usage.failure.window",
			daily: "usage.failure.window",
			day: "usage.failure.window"
		};
		/**
		* 把一条失败原文翻成人话。
		*
		* 已知形状（按顺序判定）：
		* 1. `quota: <厂商> "<账号名>" read failed (…)` —— 账号名留着（它是有用信息），原因泛化；
		* 2. `quota: …` / `models: …` 的其他包装 —— 只说哪一类读取失败；
		* 3. 含 `timeout` —— 「读取超时」；
		* 4. 端点短名 —— 逐名映射（`whoami` → 账号信息读取失败…）；
		* 5. 客户端接缝自己的诊断（`no models()` / `returned no value`）—— 归到模型目录读取失败；
		* 6. 其余原样返回。
		* @param t - 取词函数。
		* @param raw - 宿主或端口给出的失败原文。
		* @returns 界面文案（可能是原文）。
		*/
		function failureText(t, raw) {
			const text = raw.trim();
			if (text === "") return t("usage.failed");
			const accountQuota = /^quota:\s*\S+\s+"([^"]*)"\s+read failed\b/i.exec(text);
			if (accountQuota !== null) {
				const line = t("usage.failure.accountQuota").replace("{account}", accountQuota[1] ?? "");
				return /timeout/i.test(text) ? `${line}（${t("usage.failure.timeout")}）` : line;
			}
			if (/^quota:/i.test(text)) return t("usage.failure.quota");
			if (/^models:/i.test(text)) return /does not expose|no models\(\)/i.test(text) ? t("usage.failure.modelsUnsupported") : t("usage.failure.models");
			if (/timeout/i.test(text)) return t("usage.failure.timeout");
			if (Object.hasOwn(SHORT_NAMES, text)) return t(SHORT_NAMES[text]);
			if (/no models\(\)|returned no value/i.test(text)) return t("usage.failure.models");
			return text;
		}
		/**
		* 多条失败（客户端接缝用 `；` 连接，如模型目录的失败项）→ 人话。
		* @param t - 取词函数。
		* @param raw - 连接后的失败原文。
		* @returns 连接后的人话。
		*/
		function failureListText(t, raw) {
			return raw.split("；").map((item) => failureText(t, item)).join("；");
		}
		//#endregion
		//#region src/client/icons.ts
		/**
		* 行内图标：几个 16×16 的线性 SVG，用 `currentColor` 着色。
		*
		* 为什么自己画而不是引图标库：客户端产物**只能带宿主已提供的东西**（`tsdown.config.ts` 的
		* `CLIENT_EXTERNALS` 只有 react），引一个图标包会把整套字体/组件塞进浏览器产物；而宿主也不提供
		* 一个「取图标」的服务。四个图标各一条 path，比一个依赖便宜得多，也不受网络影响。
		*
		* 颜色全部是 `currentColor`：由按钮/文字的档位类决定，主题切换自动跟随。
		* @module dsh-llm-account/src/client/icons
		*/
		/** 所有图标的公共外壳（16×16、无填充、装饰性——文案在按钮的 aria-label 上）。 */
		const FRAME = {
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "none",
			xmlns: "http://www.w3.org/2000/svg",
			"aria-hidden": "true",
			focusable: "false"
		};
		/** 一条描边路径。 */
		function stroke(path, extra = {}) {
			return (0, react.createElement)("path", {
				d: path,
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				...extra
			});
		}
		/**
		* 展开/收起用的 V 形箭头。
		*
		* 展开态**不换图标**：`.dsl-icon[aria-expanded="true"] svg` 在样式表里把它转 180°，
		* 这样动画只有一条 transform，不用为两个方向各画一份。
		* @returns svg 元素。
		*/
		function ChevronIcon() {
			return (0, react.createElement)("svg", FRAME, stroke("M4 6.25 8 10.25 12 6.25"));
		}
		/** 「更多操作」的三点。 */
		function MoreIcon() {
			const dot = (cx) => (0, react.createElement)("circle", {
				cx,
				cy: 8,
				r: 1.25,
				fill: "currentColor"
			});
			return (0, react.createElement)("svg", FRAME, dot(3.5), dot(8), dot(12.5));
		}
		/** 关闭（×）。 */
		function CloseIcon() {
			return (0, react.createElement)("svg", FRAME, stroke("M4.5 4.5 11.5 11.5"), stroke("M11.5 4.5 4.5 11.5"));
		}
		/** 刷新（一圈箭头）。 */
		function RefreshIcon() {
			return (0, react.createElement)("svg", FRAME, stroke("M13 8a5 5 0 1 1-1.5-3.6"), stroke("M13.25 2.75v3h-3"));
		}
		/** 删除一行（叉）。 */
		function RemoveIcon() {
			return (0, react.createElement)("svg", FRAME, stroke("M4.5 4.5 11.5 11.5"), stroke("M11.5 4.5 4.5 11.5"));
		}
		/** 上移 / 下移的箭头（排序控件用）。 */
		function MoveIcon(direction) {
			return (0, react.createElement)("svg", FRAME, stroke(direction === "up" ? "M8 12.5v-9" : "M8 3.5v9"), stroke(direction === "up" ? "M4.25 7.75 8 3.5l3.75 4.25" : "M4.25 8.25 8 12.5l3.75-4.25"));
		}
		/** 用量（三根柱子）：侧边栏收起时唯一的可见入口。 */
		function UsageIcon() {
			const bar = (x, y, height) => (0, react.createElement)("rect", {
				x,
				y,
				width: 2,
				height,
				rx: 1,
				fill: "currentColor"
			});
			return (0, react.createElement)("svg", FRAME, bar(3, 9, 4), bar(7, 5, 8), bar(11, 7.5, 5.5));
		}
		//#endregion
		//#region src/client/login-window.ts
		/** 取全局 `window.open`（没有就返回 `undefined`）。 */
		function defaultOpenWindow() {
			const win = globalThis.window;
			if (win === void 0 || typeof win.open !== "function") return void 0;
			return (url, target) => win.open(url, target);
		}
		/** 把任意返回值收窄成句柄（浏览器返回 `Window`，被拦截时返回 `null`）。 */
		function asHandle(value) {
			if (typeof value !== "object" || value === null) return void 0;
			return value;
		}
		/**
		* 在用户手势里先开一个空白窗口，留给稍后拿到的授权网址。
		*
		* **必须同步调用**（直接写在点击处理器里），否则弹窗拦截器会拦掉。
		* @param openWindow - 打开窗口的实现；缺省用全局 `window.open`。
		* @returns 句柄；没有 `window`、被拦截或抛错时为 `undefined`（调用方退回显示链接）。
		*/
		function openLoginWindow(openWindow) {
			const open = openWindow ?? defaultOpenWindow();
			if (open === void 0) return void 0;
			try {
				return asHandle(open("about:blank", "_blank"));
			} catch {
				return;
			}
		}
		/**
		* 把占位窗口导航到授权网址。
		* @param handle - {@link openLoginWindow} 的返回值。
		* @param url - 授权网址。
		* @returns 是否成功导航（失败时调用方应关掉窗口，别留空白页）。
		*/
		/**
		* 授权网址是否可安全打开：只接受 `http:` / `https:`。
		*
		* 网址来自厂商（`authUrl` / `verificationUri`），而它最终会进 `window.location` 或 `<a href>` ——
		* `javascript:` / `data:` 这类协议在 Electron 宿主里等于执行任意脚本。协议白名单是这里唯一
		* 可靠的闸门（渲染层 React 不会逃逸 href 的协议）。
		* @param url - 厂商给的网址。
		* @returns 可以打开时为 `true`。
		*/
		function isHttpUrl(url) {
			try {
				const parsed = new URL(url);
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		}
		function pointLoginWindowAt(handle, url) {
			if (!isHttpUrl(url)) return false;
			if (handle === void 0 || handle.closed === true) return false;
			try {
				const location = handle.location;
				if (location === void 0 || location === null) return false;
				location.href = url;
				return true;
			} catch {
				return false;
			}
		}
		/**
		* 关掉占位窗口（登录失败/取消/无需浏览器时）。
		* @param handle - {@link openLoginWindow} 的返回值；`undefined` 时什么都不做。
		*/
		function closeLoginWindow(handle) {
			if (handle === void 0 || handle.closed === true) return;
			try {
				handle.close?.();
			} catch {}
		}
		//#endregion
		//#region src/client/quota.ts
		/**
		* 读数里的数字：最多两位小数，整数的尾巴不留 0。
		*
		* 线上给的是原始浮点（`70.06581737679998`、`5.0011194891`、`0.30000000000000004`），
		* 直接上屏既长又像调试输出，还会把「标签 …… 数值」那一行撑开。额度是展示口径，
		* 两位小数足够 —— 数字本身仍然原样保留在状态与 `data-*` 属性里，只是不这样印出来。
		* @param value - 原始数值。
		* @returns 展示用文本。
		*/
		function formatNumber(value) {
			if (!Number.isFinite(value)) return String(value);
			return String(Math.round(value * 100) / 100);
		}
		/**
		* 一个额度数字的上屏写法：厂商给了单位就按单位排版，没给就按裸数字。
		*
		* `usd` = `$` + 两位小数（旧插件 `formatMoney` 第 1516 行的同一口径：`$7.22`、
		* `$0.12 / $3.00`）。这是**显示**口径，原始浮点仍在状态与 `data-*` 属性里。
		* @param value - 原始数值。
		* @param unit - 厂商给的单位；缺省表示没给。
		* @returns 展示用文本。
		*/
		function quotaAmount(value, unit) {
			if (unit === "usd") return `$${value.toFixed(2)}`;
			return formatNumber(value);
		}
		/**
		* 把窗口读成「形状 + 可用的数值」——**这里是那个固定顺序的唯一一份实现**。
		*
		* `quotaShape` 与 `quotaWindowText` 都从这里取，避免两处各写一遍 `if (used !== undefined…)`
		* 而先后顺序悄悄分叉（症状会是「条画了、字没写」这种没人看得懂的东西）。
		* @param window - 归一化后的额度窗口。
		* @returns 判别联合。
		*/
		function quotaReading(window) {
			if (window.unlimited === true) return { shape: "unlimited" };
			const { used, cap, percent } = window;
			if (used !== void 0 && cap !== void 0) return {
				shape: "used-cap",
				used,
				cap
			};
			if (percent !== void 0) return {
				shape: "percent",
				percent
			};
			if (used !== void 0) return {
				shape: "used",
				used
			};
			if (cap !== void 0) return {
				shape: "cap",
				cap
			};
			return { shape: "missing" };
		}
		/**
		* 额度窗口的中文名称。
		* @param t - 取词函数。
		* @param key - 厂商窗口键。
		* @returns 可读名称；未知键原样返回。
		*/
		function quotaWindowLabel(t, key) {
			switch (key) {
				case "fiveHour":
				case "5h": return t("quota.window.fiveHour");
				case "rolling": return t("quota.window.rolling");
				case "daily":
				case "day": return t("quota.window.daily");
				case "weekly":
				case "week": return t("quota.window.weekly");
				case "monthly":
				case "month": return t("quota.window.monthly");
				case "monthlyCredits": return t("quota.window.monthlyCredits");
				case "plan": return t("quota.window.plan");
				case "": return t("quota.window.unknown");
				default: return key;
			}
		}
		/**
		* 一个窗口的读数文案。
		* @param t - 取词函数（缺失时要用到 `account.quotaMissing`）。
		* @param window - 额度窗口。
		* @returns 人类可读的读数；什么都没有时为「暂无额度数据」。
		*/
		function quotaWindowText(t, window) {
			const reading = quotaReading(window);
			const suffix = window.usedSource === "local" ? `（${t("usage.localOnly")}）` : "";
			switch (reading.shape) {
				case "used-cap": return t("quota.usedOf").replace("{used}", quotaAmount(reading.used, window.unit)).replace("{cap}", quotaAmount(reading.cap, window.unit)) + suffix;
				case "percent": return t("quota.usedPercent").replace("{percent}", formatNumber(reading.percent)) + suffix;
				case "used": return t("quota.used").replace("{used}", quotaAmount(reading.used, window.unit)) + suffix;
				case "cap": return t("quota.capOnly").replace("{cap}", quotaAmount(reading.cap, window.unit));
				case "unlimited": return t("quota.unlimited");
				case "missing": return t("account.quotaMissing");
			}
		}
		/**
		* 额度读数还没回来时，先按厂商的窗口形状画空进度条。
		*
		* 只给窗口名，不给数值：空条 +「暂无额度数据」，既保持版面一致，也不把未知写成 0。
		* @param vendor - 厂商 id。
		* @returns 该厂商常规的窗口列表。
		*/
		function fallbackQuotaWindows(vendor) {
			if (vendor.includes("opencode")) return [
				{ key: "rolling" },
				{ key: "weekly" },
				{ key: "monthly" }
			];
			if (vendor.includes("command")) return [
				{ key: "5h" },
				{ key: "weekly" },
				{ key: "monthlyCredits" }
			];
			return [{ key: "" }];
		}
		/**
		* 额度窗口的重置时间文案（本地时间；今天/明天用相对日）。
		*
		* **估算值要带「约」**（2026-10-20）：5 小时/周的重置时间是按「`used` 首次变正 + 窗口长度」
		* 推算的，不是厂商给的。四条返回路径都必须带上这个前缀 —— 只在其中一条加会让同一个时刻
		* 在不同界面上看起来可信度不同。
		* @param t - 取词函数。
		* @param window - 额度窗口。
		* @returns 文案；没有 resetAt 时为 `undefined`。
		*/
		function quotaResetText(t, window) {
			const at = window.resetAt;
			if (at === void 0 || !Number.isFinite(at) || at <= 0) return void 0;
			const date = new Date(at);
			if (Number.isNaN(date.getTime())) return void 0;
			const now = /* @__PURE__ */ new Date();
			const time = date.toLocaleTimeString(void 0, {
				hour: "2-digit",
				minute: "2-digit"
			});
			const approximate = window.resetEstimated === true ? t("quota.estimatedPrefix") : "";
			if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return approximate + t("quota.resetToday").replace("{time}", time);
			const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
			if (date.getFullYear() === tomorrow.getFullYear() && date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate()) return approximate + t("quota.resetTomorrow").replace("{time}", time);
			const day = date.toLocaleDateString(void 0, {
				month: "2-digit",
				day: "2-digit"
			});
			return approximate + t("quota.resetAtLong").replace("{date}", day).replace("{time}", time);
		}
		/**
		* 重置时刻的**日期**文案（侧边栏用）：`10-19 20:00`。
		*
		* 为什么与 {@link quotaResetText} 分开：那个用「今天 / 明天」这种相对说法（设置页与账号
		* 卡片里读起来自然），但侧边栏两行上下并排时，「明天 20:00」与「10-25 10:00」混在一起
		* 既不对齐也不好比较。
		* 统一成绝对日期后两行格式一致、宽窄稳定。
		*
		* 跨年时带上年份 —— 否则 `01-05` 会让人以为已经过去。
		*
		* **估算值要带「约」**（2026-10-20）：Command Code 的 5 小时/周窗口不公布重置时间，我们用
		* 「`used` 首次变正 + 窗口长度」推算。推算值必须一眼可辨，否则用户会把它当成厂商给的
		* 精确时刻去安排事情。`estimated` 由 `QuotaWindow.resetEstimated` 传进来。
		* @param at - 重置时刻（epoch 毫秒）。
		* @param now - 现在（判断是否需要年份；缺省 `Date.now()`）。
		* @param estimated - 这个时刻是不是估算出来的（是则加「约」）。
		* @returns `MM-DD HH:mm`（同年）或 `YYYY-MM-DD HH:mm`（跨年）；估算时前缀「约 」；
		*   时刻不可用时 `undefined`。
		*/
		function quotaResetDateText(at, now = Date.now(), estimated = false) {
			if (at === void 0 || !Number.isFinite(at) || at <= 0) return void 0;
			const date = new Date(at);
			if (Number.isNaN(date.getTime())) return void 0;
			const pad = (value) => String(value).padStart(2, "0");
			const month = pad(date.getMonth() + 1);
			const day = pad(date.getDate());
			const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
			const text = date.getFullYear() === new Date(now).getFullYear() ? `${month}-${day} ${time}` : `${date.getFullYear()}-${month}-${day} ${time}`;
			return estimated ? `约 ${text}` : text;
		}
		/**
		* 套餐行的文案：`套餐 GOAT · 每月 $70.00 · 本期至 2026-11-14`。
		*
		* 三块独立存在、缺一就不出现：名称（表里没有时退回标识原文）、状态（`active` 是常态，
		* 不重复写；其余状态原文照排 —— 状态是厂商开放词表，认不出的原样显示）、每月额度、
		* 本期结束。**没有套餐时返回 `undefined`**：界面据此不画这一行（未订阅不是错误）。
		* @param t - 取词函数。
		* @param plan - 归一化的套餐。
		* @returns 一行文案；`plan.id` 为空且没有状态时为 `undefined`。
		*/
		function quotaPlanText(t, plan) {
			const parts = [];
			const name = plan.name ?? plan.id;
			if (name !== "") parts.push(`${t("account.plan")} ${name}`);
			if (plan.status !== void 0 && plan.status !== "" && plan.status !== "active") parts.push(quotaPlanStatusText(t, plan.status));
			if (plan.monthlyCredits !== void 0) parts.push(t("quota.planMonthly").replace("{amount}", quotaAmount(plan.monthlyCredits, "usd")));
			if (plan.periodEnd !== void 0) {
				const date = new Date(plan.periodEnd);
				if (!Number.isNaN(date.getTime())) parts.push(t("quota.planPeriodEnd").replace("{date}", date.toLocaleDateString(void 0, {
					year: "numeric",
					month: "2-digit",
					day: "2-digit"
				})));
			}
			return parts.length === 0 ? void 0 : parts.join(" · ");
		}
		/** 套餐状态的本地化文案；词表外的状态原样返回（不给厂商的状态编翻译）。 */
		function quotaPlanStatusText(t, status) {
			const key = `quota.planStatus.${status}`;
			const text = t(key);
			return text === key ? status : text;
		}
		/**
		* 把窗口折算成进度条；画不出来时返回 `undefined`（**绝不补一条 0%**）。
		*
		* 三条口径，账户卡片、侧边栏与仪表盘共用同一份实现：
		* 1. 有 `percent` 就用它（契约写明是「已用百分比」）；
		* 2. 没有 `percent` 但 `used` 与 `cap` 都在，就算得出来（`cap` 为 0 时不算，除零）；
		* 3. 用得越多越糟：`≥80` 红、`≥50` 黄、其余蓝；厂商自己说 `exceeded` 的一律红。
		* @param window - 额度窗口。
		* @returns 条宽与档位；一个数都没有时为 `undefined`。
		*/
		function quotaMeter(window) {
			if (window.unlimited === true) return void 0;
			const reported = window.percent;
			const derived = reported === void 0 && window.used !== void 0 && window.cap !== void 0 && window.cap > 0 ? window.used / window.cap * 100 : void 0;
			const percent = reported ?? derived;
			if (percent === void 0 || !Number.isFinite(percent)) return void 0;
			const level = window.exceeded === true || percent >= 80 ? "error" : percent >= 50 ? "warn" : "ok";
			return {
				percent: Math.max(0, Math.min(100, Math.round(percent))),
				level
			};
		}
		//#endregion
		//#region src/client/quota-bar.ts
		/**
		* 额度条形进度条：一行一个窗口，绿色部分表示**剩余**额度。
		*
		* 统一账户卡片、侧边栏与仪表盘：标题、剩余百分比、进度条、已用读数、重置时间。
		* 纯 props → 元素树，不做任何取数。
		* @module dsh-llm-account/src/client/quota-bar
		*/
		/**
		* 一个额度窗口的条形进度。
		* @param props - 见 {@link QuotaBarProps}。
		* @returns 元素树。
		*/
		function QuotaBar(props) {
			const { t, window } = props;
			const unlimited = window.unlimited === true;
			const meter = quotaMeter(window);
			const remaining = meter === void 0 ? void 0 : Math.max(0, Math.min(100, 100 - meter.percent));
			const level = unlimited ? "unlimited" : remaining === void 0 ? "missing" : remaining > 0 ? "ok" : "error";
			const reset = quotaResetText(t, window) ?? t("quota.resetUnknown");
			return (0, react.createElement)("div", {
				"data-quota-bar": window.key,
				"data-quota-bar-level": level,
				...remaining === void 0 ? {} : { "data-quota-bar-remaining": remaining },
				className: CSS_CLASS.quotaBar
			}, (0, react.createElement)("div", { className: CSS_CLASS.quotaBarHead }, (0, react.createElement)("span", { className: CSS_CLASS.quotaBarLabel }, quotaWindowLabel(t, window.key)), (0, react.createElement)("span", {
				"data-quota-bar-percent": unlimited ? "unlimited" : remaining === void 0 ? "missing" : String(remaining),
				className: CSS_CLASS.quotaBarPercent
			}, unlimited ? t("quota.unlimited") : remaining === void 0 ? "—" : t("quota.remaining").replace("{percent}", String(remaining)))), unlimited ? null : (0, react.createElement)("span", { className: CSS_CLASS.quotaBarTrack }, meter === void 0 ? null : (0, react.createElement)("span", {
				"data-quota-bar-fill": window.key,
				"data-level": level,
				className: CSS_CLASS.quotaBarFill,
				style: { width: `${remaining}%` }
			})), unlimited ? null : (0, react.createElement)("div", { className: CSS_CLASS.quotaBarMeta }, (0, react.createElement)("span", { "data-quota-bar-value": window.key }, quotaWindowText(t, window)), (0, react.createElement)("span", {
				key: "reset",
				"data-quota-bar-reset": window.resetAt ?? "unknown",
				className: CSS_CLASS.quotaBarReset
			}, reset)));
		}
		//#endregion
		//#region src/client/account-card.ts
		/**
		* 账户卡片：账号行、额度表、操作菜单、添加账户与网页登录入口。
		*
		* 与 `page.ts` 同样的纪律（Ruling 22）：**纯 props → 元素树**，没有 Hook、没有内部状态。
		* 用户输入到一半的名称/密钥住在 `page-state.ts` 的 `action` 草稿里（可完整单测），
		* 卡片只负责渲染它、把变化报出去 —— 这条由测试用替身机械保证（Hook 一律抛错）。
		*
		* 三条不可退让的规则：
		* 1. **额度缺失不得渲染成 0**：窗口里没有的字段就是没有，宁可显示「暂无额度数据」。
		* 2. **密钥只走账户操作**：密钥输入不带设置字段标记（`data-field`），因此进不了设置草稿与保存条。
		* 3. **按能力降级**：菜单项与登录入口都由宿主发布的能力声明决定（规格 §7.3），不是写死的。
		*
		* 视觉结构（2026-10-17 的界面重做）：
		* - 一行账号 = **身份行**（状态点 + 名称 + 标记 + 行尾动作）+ **额度表**（每个窗口一小块，
		*   标签与读数一行、进度条一条）两段；两段之间不再让名称与额度抢同一行的宽度；
		* - 行内动作只留三个图标按钮（刷新模型、展开报告、更多操作），重命名/恢复默认名称/
		*   换密钥/移除/上移/下移全部收进 `⋯` 菜单 —— 一行五个带边框的文字按钮是「像调试输出」
		*   的主要来源；
		* - 展开报告、编辑器、登录等待都是内嵌面板（`dsl-inset`），不是散落在行间的裸文本。
		*
		* **注**：菜单里**没有**「固定账号」项 —— 那在 2026-10-19 被有意移除（切换账号改走
		* 全局切换面板的顺序列表）。2026-10-23 修正了本注释此前仍列着「固定」的过时描述。
		* @module dsh-llm-account/src/client/account-card
		*/
		/**
		* 「恢复默认名称」这个动作**应当恢复成什么**。
		*
		* 需求：「账号名称修改后如果不想用了可以恢复为默认名称，就是账户原本的名称」，
		* 并明确默认名称 = 登录邮箱。
		*
		* 三个返回 `undefined` 的情形，对界面都是同一件事（菜单项不显示）：
		*
		* - 账号没有记录默认名（2026-10-22 之前建的老账号）——**不猜**；
		* - 默认名是空白；
		* - 当前名**已经等于**默认名 —— 没有什么可恢复的。
		* @param account - 账号视图（`defaultLabel` 可选）。
		* @returns 应当恢复成的名称，或 `undefined`（不可恢复）。
		*/
		function restoreDefaultLabelOf(account) {
			const fallback = account.defaultLabel?.trim() ?? "";
			if (fallback === "") return void 0;
			if (fallback === account.label.trim()) return void 0;
			return fallback;
		}
		/**
		* 只渲染账号行与失败项（不含空态/添加/登录），供平铺账户列表使用。
		* @param props - 见 {@link AccountCardProps}。
		* @returns 元素数组；调用方自己决定空态与全局添加区。
		*/
		function accountRows(props) {
			return [...(props.status?.accounts ?? []).filter((account) => typeof account === "object" && account !== null).map((account, index) => accountRow(props, account, index)), ...failureNotes(props)];
		}
		/** 添加入口/表单（平铺列表复用）。 */
		function accountAddSection(props) {
			return addSection(props);
		}
		/** 一行账号：身份行（名称 + 标记 + 动作）在上，额度表在下。 */
		function accountRow(props, account, index) {
			const { t } = props;
			const pinned = props.status?.pinned === account.ref;
			const effective = account.effective;
			const marks = [];
			if (account.active === true || pinned) marks.push((0, react.createElement)("span", {
				key: "effective",
				"data-mark": "effective",
				className: CSS_CLASS.mark
			}, t("account.effectiveBy")));
			else if (effective) marks.push((0, react.createElement)("span", {
				key: "live",
				"data-mark": "live",
				className: CSS_CLASS.mark
			}, t("account.liveBy")));
			const rejectionOf = account.rejection ?? void 0;
			const rejection = rejectionOf === void 0 ? null : (0, react.createElement)("p", {
				key: "rejection",
				"data-rejection-kind": rejectionOf.kind,
				className: CSS_CLASS.rejection,
				...rejectionOf.until === void 0 ? {} : { "data-rejection-until": rejectionOf.until }
			}, rejectionText(t, rejectionOf.kind));
			const editingKey = actionOf(props, "key", account.ref);
			const editingRename = actionOf(props, "rename", account.ref);
			const quotaOf = account.quota ?? void 0;
			const statusText = account.configured ? t("account.configured") : t("account.missing");
			return (0, react.createElement)("div", {
				key: account.ref,
				"data-account": account.ref,
				className: CSS_CLASS.account,
				"data-effective": effective,
				...rejectionOf === void 0 ? {} : { "data-rejection-kind": rejectionOf.kind },
				...rejectionOf?.until === void 0 ? {} : { "data-rejection-until": rejectionOf.until }
			}, (0, react.createElement)("div", { className: CSS_CLASS.accountHead }, (0, react.createElement)("span", { className: CSS_CLASS.identity }, (0, react.createElement)("span", { className: CSS_CLASS.dot }), (0, react.createElement)("span", { className: CSS_CLASS.identityText }, (0, react.createElement)("span", { className: CSS_CLASS.nameRow }, (0, react.createElement)("strong", { "data-account-label": account.ref }, account.label), ...props.vendorLabel === void 0 ? [] : [(0, react.createElement)("small", {
				key: "vendor",
				"data-account-vendor": props.vendorLabel,
				className: CSS_CLASS.vendorBadge
			}, props.vendorLabel)], ...marks), (0, react.createElement)("small", { "data-account-status": account.configured ? "configured" : "missing" }, statusText), ...(() => {
				const plan = quotaOf?.plan;
				if (plan === void 0) return [];
				const text = quotaPlanText(t, plan);
				if (text === void 0) return [];
				return [(0, react.createElement)("small", {
					key: "plan",
					"data-account-plan": plan.id,
					className: CSS_CLASS.note
				}, text)];
			})())), (0, react.createElement)("div", { className: CSS_CLASS.accountActions }, effective || account.active === true && props.status?.effective === void 0 ? null : (0, react.createElement)("button", {
				type: "button",
				"data-account-use": account.ref,
				className: CSS_CLASS.buttonGhost,
				onClick: () => props.onSelect(account.ref)
			}, t("account.use")), ...props.onRetryCatalog === void 0 ? [] : [(0, react.createElement)("button", {
				key: "refresh-models",
				type: "button",
				"data-account-refresh-models": account.ref,
				"aria-label": t("models.refreshAccount"),
				title: t("models.refreshAccount"),
				className: CSS_CLASS.icon,
				disabled: props.catalogLoading === true,
				...props.catalogLoading === true ? { "aria-busy": "true" } : {},
				onClick: () => props.onRetryCatalog?.()
			}, (0, react.createElement)(RefreshIcon, null))], accountMenu(props, account, index))), rejection, ...(quotaOf?.failures ?? []).map((failure, index) => (0, react.createElement)("small", {
				key: `quota-failure-${index}`,
				"data-account-quota-failure": account.ref,
				"data-failure-detail": failure,
				className: CSS_CLASS.failure
			}, failureText(t, failure))), ...(() => {
				const windows = quotaOf?.windows?.length ? quotaOf.windows : fallbackQuotaWindows(props.status?.vendor ?? "");
				return [(0, react.createElement)("div", {
					key: "meters",
					className: CSS_CLASS.meters
				}, ...quotaBars(props, windows))];
			})(), props.usageOf?.(account.ref) ?? null, editingRename ? renameEditor(props, account) : null, editingKey ? keyEditor(props, account) : null, accountModelsSection(props, account));
		}
		/** 每个账号下的模型选择；同一模型可以同时出现在多个账号里。 */
		function accountModelsSection(props, account) {
			if (props.onSetAccountModels === void 0) return null;
			if (props.catalog === void 0) {
				if (props.catalogLoading === true) return (0, react.createElement)("p", {
					key: "models-loading",
					"data-account-models-loading": account.ref,
					className: CSS_CLASS.note
				}, props.t("models.loading"));
				if (props.catalogFailure !== void 0) return (0, react.createElement)("div", {
					key: "models-failure",
					"data-account-models-failure": account.ref,
					className: cls(CSS_CLASS.inline, CSS_CLASS.inset)
				}, (0, react.createElement)("p", {
					"data-failure-detail": props.catalogFailure,
					className: CSS_CLASS.failure
				}, failureListText(props.t, props.catalogFailure)), ...props.onRetryCatalog === void 0 ? [] : [(0, react.createElement)("button", {
					key: "retry",
					type: "button",
					"data-account-models-retry": account.ref,
					className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
					onClick: () => props.onRetryCatalog?.()
				}, (0, react.createElement)(RefreshIcon, null), props.t("models.retry"))]);
				return null;
			}
			const selected = new Set(props.modelRules?.find((rule) => rule.account === account.ref)?.models ?? []);
			/**
			* **只列出本套餐真正能用的模型**。
			*
			* 网关返回的是全站目录（不知道你的档位），所以过滤必须在客户端做。判据由容器给
			* （`props.modelAvailable`）：返回 `false` 才是「明确不可用」并隐藏；返回
			* `undefined` 表示这家没有官方清单，**照常显示** —— 没有依据就藏模型会让用户
			* 以为功能坏了。
			*
			* 已勾选的模型即使不在清单里也保留（`selected.has`）：那是用户此前的选择，
			* 悄悄让他「丢了一个已启用的模型」比留一行更糟。
			*/
			const visible = props.catalog.filter((model) => props.modelAvailable?.(account, model.id) !== false || selected.has(model.id));
			const groups = groupModels(visible.map((model) => ({
				id: model.id,
				company: model.company,
				free: model.free
			})));
			const byId = new Map(visible.map((model) => [model.id, model]));
			const groupLabel = (key) => key === "free" ? props.t("models.freeGroup") : key === "other" ? props.t("models.otherCompany") : companyLabelOf(key);
			return (0, react.createElement)("details", {
				"data-account-models": account.ref,
				className: CSS_CLASS.inset
			}, (0, react.createElement)("summary", { className: CSS_CLASS.orderSummary }, `${props.t("account.models")} (${selected.size}/${visible.length})`), ...props.catalogFailure === void 0 ? [] : [(0, react.createElement)("div", {
				key: "catalog-failure",
				className: cls(CSS_CLASS.inline, CSS_CLASS.inset)
			}, (0, react.createElement)("p", {
				"data-failure-detail": props.catalogFailure,
				className: CSS_CLASS.failure
			}, failureListText(props.t, props.catalogFailure)), ...props.onRetryCatalog === void 0 ? [] : [(0, react.createElement)("button", {
				key: "retry",
				type: "button",
				"data-account-models-retry": account.ref,
				className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
				onClick: () => props.onRetryCatalog?.()
			}, (0, react.createElement)(RefreshIcon, null), props.t("models.retry"))])], ...groups.map((group) => {
				const all = group.models.every((id) => selected.has(id));
				return (0, react.createElement)("details", {
					key: group.key,
					"data-account-model-group": group.key,
					className: CSS_CLASS.modelGroup
				}, (0, react.createElement)("summary", { className: CSS_CLASS.modelGroupSummary }, (0, react.createElement)("span", { className: CSS_CLASS.modelGroupTitle }, groupLabel(group.key)), (0, react.createElement)("small", null, `${group.models.filter((id) => selected.has(id)).length}/${group.models.length}`), (0, react.createElement)("button", {
					type: "button",
					"data-account-model-group-toggle": group.key,
					className: CSS_CLASS.buttonGhost,
					onClick: (event) => {
						event?.preventDefault?.();
						event?.stopPropagation?.();
						const next = new Set(selected);
						for (const id of group.models) if (all) next.delete(id);
						else next.add(id);
						props.onSetAccountModels?.(account.ref, [...next]);
					}
				}, all ? props.t("models.clearAll") : props.t("models.selectAll")), (0, react.createElement)(ChevronIcon, null)), ...group.models.map((id) => {
					const model = byId.get(id);
					const quotaText = props.modelQuotaOf?.(account, id);
					return (0, react.createElement)("label", {
						key: id,
						className: CSS_CLASS.field
					}, (0, react.createElement)("span", { className: CSS_CLASS.fieldText }, (0, react.createElement)("span", { className: CSS_CLASS.mono }, model?.name ?? id)), (0, react.createElement)("span", {
						key: "quota",
						className: quotaText === void 0 ? `${CSS_CLASS.modelQuota} ${CSS_CLASS.modelQuotaUnknown}` : CSS_CLASS.modelQuota,
						"data-model-quota": `${account.ref}:${id}`,
						title: props.t("models.quotaHint")
					}, quotaText ?? props.t("models.quotaUnknown")), (0, react.createElement)("input", {
						type: "checkbox",
						className: CSS_CLASS.toggle,
						"data-account-model": `${account.ref}:${id}`,
						checked: selected.has(id),
						onChange: (event) => {
							const next = new Set(selected);
							if (event.target?.checked === true) next.add(id);
							else next.delete(id);
							props.onSetAccountModels?.(account.ref, [...next]);
						}
					}));
				}));
			}));
		}
		/** 该厂商的能力声明；状态还没到时按「什么都没有」处理（不渲染任何高级控件）。 */
		function capabilitiesOf(props) {
			return props.status?.capabilities ?? {
				reorder: false,
				pin: false,
				browserLogin: false,
				modelAccountRules: false,
				quotaShape: "windows",
				modelVisibilityWrite: "onSave",
				automaticSwitch: false
			};
		}
		/** 该行是否正在做某个账户操作。 */
		function actionOf(props, kind, ref) {
			return props.action?.kind === kind && props.action.ref === ref;
		}
		/**
		* `⋯` 菜单：把行内动作收进一个原生 `<details>`。
		*
		* 为什么是 `<details>`：它自带开合、键盘可达与「点外部不自动关」之外的一切语义，不需要
		* 状态（卡片是纯函数）。点菜单项后由面板的冒泡处理器关闭自己。
		*/
		function accountMenu(props, account, index) {
			const label = props.t("account.menu");
			const extras = props.rowExtras?.(account, index);
			return (0, react.createElement)("details", {
				key: "menu",
				className: CSS_CLASS.menu,
				"data-account-menu": account.ref
			}, (0, react.createElement)("summary", {
				className: CSS_CLASS.icon,
				"aria-label": label,
				title: label,
				role: "button"
			}, (0, react.createElement)(MoreIcon, null)), (0, react.createElement)("div", {
				className: CSS_CLASS.menuPanel,
				onClick: closeMenu
			}, ...menuButtons(props, account), extras === void 0 || extras === null ? null : extras, ...capabilitiesOf(props).reorder && props.onMove !== void 0 ? [(0, react.createElement)(react.Fragment, { key: "move" }, moveItems({
				t: props.t,
				onMove: props.onMove
			}, account, index, Math.max(props.status?.accounts?.length ?? 0, index + 1)))] : []));
		}
		/** 点了菜单里的任何东西就把菜单收起来（原生 details 不会自己关）。 */
		function closeMenu(event) {
			const details = event.currentTarget?.closest?.("details");
			if (details !== null && details !== void 0) details.open = false;
		}
		/**
		* 菜单项：重命名 / 更换密钥 / 固定 / 移除 —— 全部按能力降级。
		*
		* 「移除」是红字（宿主的 dangerButton 同款），悬停才浮出危险底色 —— 破坏性动作平时安静、
		* 指到时才醒目。
		*/
		function menuButtons(props, account) {
			const { t } = props;
			/**
			* 可恢复的默认名称。
			*
			* `undefined` 时**不显示**这个菜单项：没有记录默认名的老账号、默认名是空白、
			* 或当前名已等于默认名 —— 三种情况都没有「可恢复」的东西（见 `restoreDefaultLabelOf`）。
			*/
			const restorable = restoreDefaultLabelOf(account);
			const buttons = [
				(0, react.createElement)("button", {
					key: "rename",
					type: "button",
					"data-action": "rename",
					className: CSS_CLASS.item,
					onClick: () => props.onOpenAction({
						kind: "rename",
						ref: account.ref
					})
				}, t("account.rename")),
				...restorable === void 0 ? [] : [(0, react.createElement)("button", {
					key: "restoreName",
					type: "button",
					"data-action": "restoreName",
					className: CSS_CLASS.item,
					/**
					* **一键恢复**（2026-10-22 改）：不打开表单、不需要再确认一次。
					*
					* 恢复默认名是确定且可逆的操作（默认名就存在账号条目里），多一步确认只是
					* 麻烦。真正的写入由宿主按账号自己记录的 `defaultName` 完成 —— 客户端
					* 只负责说「点的是哪个账号」。
					*/
					onClick: () => props.onOpenAction({
						kind: "restoreName",
						ref: account.ref
					})
				}, t("account.restoreName"))],
				(0, react.createElement)("button", {
					key: "key",
					type: "button",
					"data-action": "replaceKey",
					className: CSS_CLASS.item,
					onClick: () => props.onOpenAction({
						kind: "key",
						ref: account.ref
					})
				}, t("account.replaceKey"))
			];
			buttons.push((0, react.createElement)("button", {
				key: "remove",
				type: "button",
				"data-action": "remove",
				className: cls(CSS_CLASS.item, CSS_CLASS.buttonDanger),
				onClick: () => props.onRemove(account.ref)
			}, t("account.remove")));
			return buttons;
		}
		/**
		* 额度表：**每个存在的窗口一小块**（标签 + 读数 + 进度条）。
		*
		* 数字只在读数里真的有那个字段时才渲染 —— `used`/`cap` 缺任何一个都不拼 `x/y`，
		* `percent` 缺失也不补 0。全都缺就显示「暂无额度数据」。
		*/
		function quotaBars(props, windows) {
			return [(0, react.createElement)("div", {
				key: "bars",
				className: CSS_CLASS.quotaBarList
			}, ...windows.map((window) => (0, react.createElement)("div", {
				key: window.key,
				"data-quota-window": window.key
			}, QuotaBar({
				t: props.t,
				window
			}))))];
		}
		/** 一个输入框上的回车 = 点「确定」：账号操作是单行表单，回车提交是用户的默认预期。 */
		function enterConfirms(props) {
			return (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault?.();
				props.onConfirmAction();
			};
		}
		/** 编辑器/表单里的失败提示（容器给的人话）；没有就不画。 */
		function actionErrorLine(props) {
			const error = props.actionError;
			if (error === void 0 || error === "") return [];
			return [(0, react.createElement)("small", {
				key: "action-error",
				"data-action-error": "true",
				className: CSS_CLASS.failure
			}, error)];
		}
		/** 重命名编辑器（受控）。 */
		function renameEditor(props, account) {
			const label = props.action?.label ?? "";
			return (0, react.createElement)("div", {
				"data-editor": "rename",
				"data-editor-ref": account.ref,
				className: cls(CSS_CLASS.inline, CSS_CLASS.inset)
			}, (0, react.createElement)("input", {
				"data-rename-input": account.ref,
				type: "text",
				value: label,
				autoFocus: true,
				placeholder: props.t("account.newLabel"),
				onChange: (event) => props.onActionField("label", event.target?.value ?? ""),
				onKeyDown: enterConfirms(props)
			}), (0, react.createElement)("button", {
				type: "button",
				"data-action": "confirmRename",
				className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm),
				onClick: () => props.onConfirmAction()
			}, props.t("account.confirm")), (0, react.createElement)("button", {
				type: "button",
				"data-action": "cancel",
				className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm),
				onClick: () => props.onCancelAction()
			}, props.t("account.cancel")), ...actionErrorLine(props));
		}
		/**
		* 更换密钥编辑器（受控）。
		*
		* 输入框刻意**不带** `data-field`：那是设置字段的标记，带上它就会和设置草稿/保存条共用一条通道。
		* 密钥只经 `onActionField`/`onConfirmAction` 走到账户操作，再由宿主写进凭据服务。
		*/
		function keyEditor(props, account) {
			return (0, react.createElement)("div", {
				"data-editor": "key",
				"data-editor-ref": account.ref,
				className: cls(CSS_CLASS.inline, CSS_CLASS.inset)
			}, (0, react.createElement)("input", {
				"data-key-input": account.ref,
				type: "password",
				value: props.action?.key ?? "",
				autoFocus: true,
				placeholder: props.t("account.newKey"),
				onChange: (event) => props.onActionField("key", event.target?.value ?? ""),
				onKeyDown: enterConfirms(props)
			}), (0, react.createElement)("button", {
				type: "button",
				"data-action": "confirmKey",
				className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm),
				onClick: () => props.onConfirmAction()
			}, props.t("account.confirm")), (0, react.createElement)("button", {
				type: "button",
				"data-action": "cancel",
				className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm),
				onClick: () => props.onCancelAction()
			}, props.t("account.cancel")), ...actionErrorLine(props));
		}
		/**
		* 服务端失败项提示。
		*
		* 诊断原文（端点短名 `whoami`、包装过的 `quota: … read failed (…)`）翻成人话再上屏，
		* 原文一律留在 `data-failure-detail` 上供排查；认不出的形状（宿主能力错误）原样显示。
		*/
		function failureNotes(props) {
			return (props.status?.failures ?? []).map((failure, index) => (0, react.createElement)("p", {
				key: `failure-${index}`,
				"data-failure": index,
				"data-failure-detail": failure,
				className: CSS_CLASS.failure
			}, failureText(props.t, failure)));
		}
		/**
		* 失败原因文案：认识的原因用专门文案，不认识的回退到通用文案（**不打印原因键**）。
		*
		* 导出给合并面板复用：账号行与面板级的登录失败提示必须用同一套口径，否则同一句原因
		* 在两个位置会显示成两种说法。
		*/
		function reasonText(t, reason) {
			const key = `account.reason.${reason ?? "error"}`;
			if (reason === void 0) return t("account.reason.error");
			const text = t(key);
			return text === key ? t("account.reason.error") : text;
		}
		/**
		* `vela` 缺失时的**安装指引**块（只对这一种原因渲染，其余失败保持一句话）。
		*
		* 需求：「opendesign 新增账户的时候如果使用网页登录，用户缺少环境的时候给出提示，
		* 如何快速安装环境」。为什么值得单独做一块：
		*
		* - 这是**唯一**一种用户自己就能修好的登录失败（其余是网络/未批准/凭据问题，用户改不了）；
		* - 「请先安装 vela」对普通用户等于没说 —— 他们不知道 vela 是什么、从哪来、装完怎么确认。
		*   所以给三档可执行路径（装桌面端最省事 / 只装 CLI / 设 VELA_BIN），命令单独一行便于复制。
		*
		* @param t - 取词函数。
		* @param reason - 登录失败原因键。
		* @param onRetry - 「重试网页登录」的回调；缺省时不渲染那个按钮。
		* @returns 指引块；原因不是 `vela-missing` 时为 `null`。
		*/
		function velaInstallGuide(t, reason, onRetry) {
			if (reason !== "vela-missing") return null;
			return (0, react.createElement)("div", {
				key: "vela-guide",
				"data-vela-guide": "true",
				className: CSS_CLASS.inset
			}, (0, react.createElement)("strong", { className: CSS_CLASS.velaGuideTitle }, t("account.vela.title")), (0, react.createElement)("small", null, t("account.vela.step1")), (0, react.createElement)("small", null, t("account.vela.step2")), (0, react.createElement)("code", {
				"data-vela-command": "true",
				className: CSS_CLASS.mono
			}, t("account.vela.command")), (0, react.createElement)("small", null, t("account.vela.step3")), onRetry === void 0 ? null : (0, react.createElement)("button", {
				type: "button",
				"data-vela-retry": "true",
				className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
				onClick: onRetry
			}, t("account.vela.retry")));
		}
		/**
		* 底部「添加账户」：**收起的入口 → 展开的表单**。
		*
		* 为什么必须是收起的：先前两个输入框一直摊在卡片底部，按钮直接叫「添加账户」。用户点它时
		* 字段是空的，`dispatchAccountAction` 按规矩不发调用（空名称/空密钥不提交），于是**这一次
		* 点击没有任何可见反应**——按钮像是坏的。空提交不发调用这条是对的（那能防住误写一个空账号），
		* 错的是让「入口」和「提交」共用一个按钮：点击没有反应，用户无从判断是坏了还是自己没填。
		*
		* 现在点入口必然展开表单（可见的变化），提交是表单里那个独立的「添加」。表单内仍保留
		* 「第一次输入即打开 add」的幂等接线（`openAction` 对同一 kind 返回原对象），这样即便宿主
		* 或未来调用方绕过入口直接改字段，操作状态也已经是打开的。
		*
		* 2026-10-18 需求「新增账号那个地方优化一下操作逻辑」，这一版补了五件事：
		* ① 表单顶上写明**在往哪家加账户**（面板底部只有一个表单位置，两家共用）；
		* ② 名称框自动聚焦（点开就能打字）；③ 回车 = 确定（单行表单的默认预期）；
		* ④ 空名称点确定会看到一行人话原因（`actionError`），不再是死按钮；
		* ⑤ 密钥框下方写明它去哪（本机凭据库），并说明网页登录是另一条路。
		*/
		function addSection(props) {
			const { t, action } = props;
			if (!(action?.kind === "add")) return (0, react.createElement)("div", {
				"data-card": "add-account",
				className: CSS_CLASS.add
			}, (0, react.createElement)("button", {
				key: "add",
				type: "button",
				"data-action": "add",
				className: CSS_CLASS.addTrigger,
				onClick: () => props.onOpenAction({ kind: "add" })
			}, t("account.add")));
			const edit = (field, value) => props.onActionField(field, value);
			const vendor = props.vendorLabel;
			return (0, react.createElement)("div", {
				"data-card": "add-account",
				className: cls(CSS_CLASS.add, CSS_CLASS.inset)
			}, ...vendor === void 0 ? [] : [(0, react.createElement)("p", {
				key: "title",
				"data-add-title": vendor,
				className: CSS_CLASS.addTitle
			}, t("account.addTitle").replace("{vendor}", vendor))], (0, react.createElement)("label", { className: CSS_CLASS.addField }, (0, react.createElement)("small", null, t("account.newLabel")), (0, react.createElement)("input", {
				"data-add-label": "true",
				type: "text",
				value: action?.label ?? "",
				autoFocus: true,
				placeholder: t("account.newLabel.placeholder"),
				onChange: (event) => edit("label", event.target?.value ?? ""),
				onKeyDown: enterConfirms(props)
			})), (0, react.createElement)("label", { className: CSS_CLASS.addField }, (0, react.createElement)("small", null, t("account.newKey")), (0, react.createElement)("input", {
				"data-add-key": "true",
				type: "password",
				value: action?.key ?? "",
				placeholder: t("account.newKey.placeholder"),
				onChange: (event) => edit("key", event.target?.value ?? ""),
				onKeyDown: enterConfirms(props)
			})), (0, react.createElement)("small", {
				key: "key-hint",
				className: CSS_CLASS.note
			}, t("account.newKey.hint")), ...actionErrorLine(props), (0, react.createElement)("div", { className: CSS_CLASS.actions }, (0, react.createElement)("button", {
				key: "ok",
				type: "button",
				"data-action": "confirmAdd",
				className: CSS_CLASS.buttonPrimary,
				onClick: () => props.onConfirmAction()
			}, t("account.confirm")), (0, react.createElement)("button", {
				key: "cancel",
				type: "button",
				"data-action": "cancel",
				className: CSS_CLASS.buttonGhost,
				onClick: () => props.onCancelAction()
			}, t("account.cancel"))));
		}
		/**
		* 排序控件（供 `opencode-account-card.ts` 通过 {@link AccountCardProps.rowExtras} 注入）。
		*
		* 导出在这里而不是让厂商卡片自己画：菜单项的类与形状只有一份（`dsl-item`），
		* 由行渲染决定它们长什么样，厂商卡片只提供「上移/下移」两个语义。
		* @param props - 渲染所需的文案与回调。
		* @param account - 目标账号。
		* @param index - 当前下标。
		* @param count - 账号总数（判断越界）。
		* @returns 两个菜单项；越界的一侧禁用。
		*/
		function moveItems(props, account, index, count) {
			const move = (direction) => {
				const disabled = direction === "up" ? index === 0 : index === count - 1;
				const label = direction === "up" ? props.t("account.moveUp") : props.t("account.moveDown");
				return (0, react.createElement)("button", {
					key: direction,
					type: "button",
					"data-move": direction,
					"data-move-ref": account.ref,
					disabled,
					"aria-label": label,
					className: CSS_CLASS.item,
					onClick: () => props.onMove(account.ref, direction === "up" ? index - 1 : index + 1)
				}, (0, react.createElement)(MoveIcon, { direction }), label);
			};
			return (0, react.createElement)(react.Fragment, null, move("up"), move("down"));
		}
		//#endregion
		//#region src/client/failure-list.ts
		/**
		* 用量页的两个小块：**失败明细**与**导出按钮**。
		*
		* 为什么单独一个文件：两者都只在用量区域出现，且都是纯 props → 元素树（不取数、不留状态），
		* 与 `usage-card` 的版式主体分开更好读。
		*
		* ## 失败明细
		*
		* 台账一直记着 `failureKind`（实测出现过 `network`），但界面从来没读过它 —— 用户只看到一个
		* 「成功率 99.6%」，报障时无从判断是网络抖动、限额，还是凭据失效。把已经落盘的原因显示出来，
		* 排查成本几乎全在这里。
		*
		* 分类名复用 `rejection.<kind>` 那套文案（拒绝表与失败明细说的是同一件事）；**认不出的分类
		* 原样显示** —— 编一个中文名会把「分类器不认识它」这个有用的事实藏起来。
		*
		* @module dsh-llm-account/src/client/failure-list
		*/
		/**
		* 一个失败分类的展示名。
		*
		* 与 {@link rejectionText} 的差别只有一处：**未收录的分类原样返回键名**，而不是「未知」。
		* 失败明细是排障界面，用户最需要知道的就是「出现了一个我没想到的原因」；
		* 把它显示成「未知」等于把这个信号抹掉。（账户卡片的拒绝状态仍用 `rejectionText`：
		* 那里空间小，显示键名会挤坏版式。）
		* @param t - 取词函数。
		* @param kind - 失败分类（形状不可信）。
		* @returns 展示名。
		*/
		function failureKindLabel(t, kind) {
			const text = rejectionText(t, kind);
			return text === t("dashboard.unknown") ? kind : text;
		}
		/**
		* 失败明细。
		*
		* 一条失败都没有时返回 `null`：不给用户一行「失败 0 次」——那既不是他想看的信息，
		* 也会让「没有失败」与「明细读不到」长得不一样（两者都该安静）。
		* @param props - 文案与明细行。
		* @returns 元素树，或 `null`。
		*/
		function FailureKindList(props) {
			if (props.rows.length === 0) return null;
			return (0, react.createElement)("div", {
				"data-failure-kinds": "true",
				className: CSS_CLASS.usageFoot
			}, (0, react.createElement)("small", { className: CSS_CLASS.usageMuted }, props.t("usage.failuresTitle")), ...props.rows.map((row) => (0, react.createElement)("small", {
				key: row.kind,
				"data-failure-kind": row.kind,
				"data-failure-count": row.count,
				className: CSS_CLASS.usageMuted
			}, `${failureKindLabel(props.t, row.kind)} × ${row.count}`)));
		}
		/**
		* 台账导出按钮。
		* @param props - 文案、回调与进行中标记。
		* @returns 元素树，或 `null`（没有导出能力时）。
		*/
		function UsageExportButton(props) {
			const onExport = props.onExport;
			if (onExport === void 0) return null;
			const busy = props.busy === true;
			return (0, react.createElement)("button", {
				type: "button",
				"data-usage-export": "true",
				disabled: busy,
				className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
				onClick: () => onExport()
			}, busy ? props.t("usage.exporting") : props.t("usage.exportCsv"));
		}
		/**
		* 台账清空按钮（带二次确认）。
		*
		* 为什么要有：远程方法 `usageClear` 一直在，但界面入口在某次删卡片时被连带砍掉，
		* 两条文案的消费者降到 0 —— 用户没有任何办法清空历史（2026-10-20 审计）。
		*
		* 二次确认用**受控状态**而不是 `window.confirm`：宿主是浏览器里的插件，`confirm` 会阻塞
		* 渲染线程、无法被单测覆盖；这里的确认面板是纯元素，状态由容器持有。
		* @param props - 文案、回调、进行中标记与「是否已确认」。
		* @returns 元素树，或 `null`（没有清空能力时）。
		*/
		function UsageClearButton(props) {
			const onClear = props.onClear;
			if (onClear === void 0) return null;
			const busy = props.busy === true;
			if (!(props.confirming === true)) return (0, react.createElement)("button", {
				type: "button",
				"data-usage-clear": "true",
				disabled: busy,
				className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
				onClick: () => props.onRequestConfirm?.()
			}, busy ? props.t("usage.clearing") : props.t("usage.clear"));
			return (0, react.createElement)("div", {
				"data-usage-clear-panel": "true",
				className: CSS_CLASS.actions
			}, (0, react.createElement)("small", { className: CSS_CLASS.failure }, props.t("usage.clearConfirm")), (0, react.createElement)("button", {
				type: "button",
				"data-usage-clear-confirm": "true",
				disabled: busy,
				className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
				onClick: () => onClear()
			}, busy ? props.t("usage.clearing") : props.t("usage.clearConfirmAction")), (0, react.createElement)("button", {
				type: "button",
				"data-usage-clear-cancel": "true",
				className: `${CSS_CLASS.buttonGhost} ${CSS_CLASS.buttonSm}`,
				onClick: () => props.onCancel?.()
			}, props.t("account.cancel")));
		}
		//#endregion
		//#region src/client/accounts-panel.ts
		/**
		* 合并账户面板：各厂商的账号**平铺**在同一张卡片里，账号名后跟供应商标签。
		*
		* 为什么平铺：账号是「这台机器上有哪些额度」，按厂商分组会让同一个
		* 列表出现多个标题、多个添加入口；用户想直接看到所有账号，再决定用哪家的。
		*
		* 添加/网页登录是**全局入口**：先选供应商（Command Code / OpenCode），再选手动或网页登录；
		* 账户动作仍按厂商路由（`onOpenAction(vendor, …)` 等），面板自己不持有状态。
		* @module dsh-llm-account/src/client/accounts-panel
		*/
		/**
		* 合并账户面板。
		* @param props - 见 {@link AccountsPanelProps}。
		* @returns 元素树。
		*/
		function AccountsPanel(props) {
			const { t, vendors } = props;
			const total = vendors.reduce((count, group) => count + (group.status?.accounts ?? []).filter((account) => typeof account === "object" && account !== null).length, 0);
			const addVendor = vendors.find((group) => group.action?.kind === "add");
			const addProps = addVendor === void 0 ? void 0 : accountPropsFor(props, addVendor);
			const anyLoading = vendors.some((group) => group.loading === true);
			return (0, react.createElement)("section", {
				"data-card": "accounts-panel",
				className: CSS_CLASS.card
			}, (0, react.createElement)("div", {
				"data-panel-head": "accounts",
				className: CSS_CLASS.panelHead
			}, (0, react.createElement)("h2", null, t("group.accounts")), (0, react.createElement)("span", {
				"data-accounts-count": total,
				className: CSS_CLASS.panelCount
			}, t("account.count").replace("{n}", String(total))), (0, react.createElement)(UsageExportButton, {
				t,
				onExport: props.onExportUsage === void 0 ? void 0 : () => void props.onExportUsage?.(),
				busy: props.exportBusy === true
			}), (0, react.createElement)(UsageClearButton, {
				t,
				onClear: props.onClearUsage,
				...props.onRequestClearConfirm === void 0 ? {} : { onRequestConfirm: props.onRequestClearConfirm },
				...props.onCancelClear === void 0 ? {} : { onCancel: props.onCancelClear },
				...props.clearConfirming === void 0 ? {} : { confirming: props.clearConfirming },
				...props.clearBusy === void 0 ? {} : { busy: props.clearBusy }
			})), props.exportError === void 0 ? null : (0, react.createElement)("small", {
				key: "export-error",
				"data-usage-export-error": true,
				"data-usage-export-error-detail": props.exportError,
				className: CSS_CLASS.failure
			}, `${t("usage.exportFailed")}：${props.exportError}`), props.clearError === void 0 ? null : (0, react.createElement)("small", {
				key: "clear-error",
				"data-usage-clear-error": true,
				"data-usage-clear-error-detail": props.clearError,
				className: CSS_CLASS.failure
			}, `${t("usage.clearFailed")}：${props.clearError}`), (0, react.createElement)("details", {
				"data-add-chooser": "true",
				className: CSS_CLASS.addChooser,
				onToggle: (event) => {
					if (event?.currentTarget?.open !== false) return;
					props.onCollapseAddChooser?.();
				}
			}, (0, react.createElement)("summary", { className: CSS_CLASS.addSummary }, t("account.addAccount")), (0, react.createElement)("small", { className: CSS_CLASS.note }, t("account.addAccount.hint")), (0, react.createElement)("div", {
				"data-account-add-actions": "true",
				className: CSS_CLASS.addGroup
			}, ...vendors.map((group) => (0, react.createElement)("div", {
				key: group.entry.providerId,
				"data-add-vendor-group": group.entry.providerId,
				className: CSS_CLASS.addGroup
			}, (0, react.createElement)("small", { className: CSS_CLASS.note }, t(group.entry.labelKey)), (0, react.createElement)("div", { className: CSS_CLASS.actions }, (0, react.createElement)("button", {
				key: `${group.entry.providerId}-login`,
				type: "button",
				"data-action": group.entry.providerId === "commandcode" ? "login" : `login-${group.entry.providerId}`,
				"data-login-for": group.entry.providerId,
				className: CSS_CLASS.buttonSecondary,
				...props.loginStarting?.[group.entry.providerId] === true ? {
					disabled: true,
					"aria-busy": "true"
				} : {},
				onClick: () => props.onLoginBegin(group.entry.providerId)
			}, t("account.loginFor"))), ...loginNotes(props, group.entry.providerId))))), ...waitingLogins(props), ...vendors.flatMap((group) => group.status !== void 0 ? [] : group.loading === true ? [(0, react.createElement)("p", {
				key: `${group.entry.providerId}-loading`,
				"data-accounts-loading": group.entry.providerId,
				className: CSS_CLASS.note
			}, `${t(group.entry.labelKey)}: ${t("account.loading")}`)] : [(0, react.createElement)("p", {
				key: `${group.entry.providerId}-unavailable`,
				"data-accounts-vendor": group.entry.providerId,
				className: CSS_CLASS.note
			}, `${t(group.entry.labelKey)}: ${t("account.unavailable")}`), ...group.problem === void 0 ? [] : [(0, react.createElement)("pre", {
				key: `${group.entry.providerId}-problem`,
				"data-usage-problem": true,
				className: CSS_CLASS.diagnostic
			}, group.problem)]]), ...total === 0 && !anyLoading ? [(0, react.createElement)("p", {
				key: "empty",
				"data-accounts-empty": "true",
				className: CSS_CLASS.note
			}, t("account.empty"))] : [], (0, react.createElement)("div", {
				"data-account-list": "true",
				className: CSS_CLASS.accountList
			}, ...vendors.flatMap((group) => accountRows(accountPropsFor(props, group)))), addProps === void 0 ? null : (0, react.createElement)("div", {
				key: "add-form",
				"data-add-panel": addVendor.entry.providerId,
				className: CSS_CLASS.inset
			}, accountAddSection(addProps)));
		}
		/** 某一家等待授权的登录面板（设备码 / 授权网址 / 取消）。 */
		function waitingLogins(props) {
			return props.vendors.flatMap((group) => {
				const login = group.login;
				if (login?.state !== "waiting") return [];
				return [(0, react.createElement)("div", {
					key: `login-${group.entry.providerId}`,
					"data-login-panel": group.entry.providerId,
					className: CSS_CLASS.inset
				}, (0, react.createElement)("p", null, `${props.t(group.entry.labelKey)} · ${props.t("account.loginWaiting")}`), ...login.userCode === void 0 ? [] : [(0, react.createElement)("p", {
					key: "code",
					"data-login-code": login.userCode,
					className: CSS_CLASS.mono
				}, props.t("account.loginCode").replace("{code}", login.userCode))], ...login.authUrl === void 0 ? [] : [(0, react.createElement)("a", {
					key: "url",
					"data-login-url": true,
					...isHttpUrl(login.authUrl) ? { href: login.authUrl } : {},
					target: "_blank",
					rel: "noreferrer",
					className: CSS_CLASS.link
				}, login.authUrl)], ...props.onLoginCancel === void 0 ? [] : [(0, react.createElement)("div", {
					key: "cancel",
					className: CSS_CLASS.actions
				}, (0, react.createElement)("button", {
					type: "button",
					"data-action": "login-cancel",
					"data-login-for": group.entry.providerId,
					className: CSS_CLASS.buttonSecondary,
					onClick: () => props.onLoginCancel?.(group.entry.providerId)
				}, props.t("account.loginCancel")))])];
			});
		}
		/**
		* 某一家在「添加账户」组下面的登录提示：启动中 / 流程失败 / 调用失败。
		*
		* 三态分开是有原因的：以前只有 `waiting` 有界面，`failed` 与「调用根本没发出去」都
		* 静默 —— 用户点了「网页登录」只看到什么都没发生（这正是本机报障的现象）。
		* @param props - 面板属性。
		* @param vendor - 厂商 id。
		* @returns 要渲染的提示（可能为空）。
		*/
		function loginNotes(props, vendor) {
			const notes = [];
			if (props.loginStarting?.[vendor] === true) notes.push((0, react.createElement)("small", {
				key: `${vendor}-login-starting`,
				"data-login-starting": vendor,
				className: CSS_CLASS.note
			}, props.t("account.loginStarting")));
			const login = props.vendors.find((group) => group.entry.providerId === vendor)?.login;
			if (login?.state === "failed" && login.reason !== "cancelled") {
				notes.push((0, react.createElement)("small", {
					key: `${vendor}-login-failure`,
					"data-login-failure": vendor,
					"data-login-failure-detail": login.reason ?? "error",
					className: CSS_CLASS.failure
				}, reasonText(props.t, login.reason)));
				if (login.detail !== void 0 && login.detail !== "") notes.push((0, react.createElement)("pre", {
					key: `${vendor}-login-detail`,
					"data-login-detail": login.detail,
					className: CSS_CLASS.diagnostic
				}, login.detail));
				const guide = velaInstallGuide(props.t, login.reason, () => props.onLoginBegin?.(vendor));
				if (guide !== null) notes.push(guide);
			}
			const error = props.loginError?.[vendor];
			if (error !== void 0) notes.push((0, react.createElement)("small", {
				key: `${vendor}-login-error`,
				"data-login-error": vendor,
				"data-login-error-detail": error,
				className: CSS_CLASS.failure
			}, props.t("account.loginFailed")));
			return notes;
		}
		/** 把面板回调包装成该厂商的 AccountCardProps。 */
		function accountPropsFor(props, group) {
			const vendor = group.entry.providerId;
			return {
				t: props.t,
				status: group.status,
				problem: group.problem,
				action: group.action,
				...props.actionError === void 0 ? {} : { actionError: props.actionError },
				expandedRef: group.expandedRef,
				login: group.login,
				vendorLabel: props.t(group.entry.labelKey),
				onOpenAction: (action) => props.onOpenAction(vendor, action),
				onActionField: props.onActionField,
				onConfirmAction: () => props.onConfirmAction(vendor),
				onCancelAction: props.onCancelAction,
				onSelect: (ref) => props.onSelect(vendor, ref),
				onRemove: (ref) => props.onRemove(vendor, ref),
				onToggleExpand: (ref) => props.onToggleExpand(vendor, ref),
				onLoginBegin: () => props.onLoginBegin(vendor),
				...group.catalog === void 0 ? {} : { catalog: group.catalog },
				...group.catalogFailure === void 0 ? {} : { catalogFailure: group.catalogFailure },
				...group.catalogLoading === void 0 ? {} : { catalogLoading: group.catalogLoading },
				...props.onRefreshModels === void 0 ? {} : { onRetryCatalog: () => props.onRefreshModels?.(vendor) },
				...group.modelRules === void 0 ? {} : { modelRules: group.modelRules },
				...props.onSetAccountModels === void 0 ? {} : { onSetAccountModels: (ref, models) => props.onSetAccountModels?.(vendor, ref, models) },
				...props.usageOf === void 0 ? {} : { usageOf: (ref) => props.usageOf?.(vendor, ref) },
				...props.modelQuotaOf === void 0 ? {} : { modelQuotaOf: (account, modelId) => props.modelQuotaOf?.(vendor, account, modelId) },
				...props.modelAvailable === void 0 ? {} : { modelAvailable: (account, modelId) => props.modelAvailable?.(vendor, account, modelId) }
			};
		}
		//#endregion
		//#region src/client/boundary.ts
		/**
		* 渲染兜底：**子组件**抛错也不许把宿主页面带走。
		*
		* 为什么必须是一层真正的 React 错误边界，而不是 `try { component() } catch`：后者只覆盖
		* 「调用本组件函数」这一次求值，而 React 是在**之后**的工作循环里逐个渲染子组件的 ——
		* 账号行、额度条、用量块都在那一步才求值。那里一抛，最近的错误边界接住（没有就整棵根树
		* 卸载），症状就是用户报的「每次刷新用量统计，整个设置页消失」。
		*
		* 边界自己渲染成一块可读面板并留一个「重试」：错误是一次具体的渲染失败，重试是有意义的
		* （数据变了就可能好了），比让用户关掉设置页再来一次好。
		* @module dsh-llm-account/src/client/boundary
		*/
		/**
		* 一层错误边界。
		*
		* 只挡住**子树**：边界自身与它之上的宿主界面（设置页的其它分组、侧边栏）不受影响。
		*/
		var RenderBoundary = class extends react.Component {
			/** 由 React 在渲染期抛出后调用（把异常记进 state，渲染期换成面板）。 */
			static getDerivedStateFromError(error) {
				return { failure: error };
			}
			/** 初始状态：正常渲染。 */
			state = {};
			/**
			* 记一条控制台日志。
			*
			* 面板上的消息可能被用户一句「页面坏了」盖过去，控制台这条带组件栈，排障时要的就是它。
			* @param error - 捕获到的异常。
			* @param info - React 给的组件栈。
			*/
			componentDidCatch(error, info) {
				console.error("[dsh-llm-account] the settings page subtree crashed while rendering:", error, info?.componentStack);
			}
			/** 渲染子树或失败面板。 */
			render() {
				const failure = this.state?.failure;
				if (failure === void 0) return this.props.children;
				return failurePanel(this.props, failure, () => {
					if (typeof this.setState === "function") this.setState({ failure: void 0 });
				});
			}
		};
		/**
		* 失败面板。
		* @param props - 边界的文案。
		* @param failure - 捕获到的异常。
		* @param retry - 重置边界，重新尝试渲染。
		* @returns 面板元素。
		*/
		function failurePanel(props, failure, retry) {
			const detail = failure instanceof Error ? failure.stack ?? failure.message : String(failure);
			const mark = props.mark ?? "data-render-error";
			if (props.variant === "inline") return (0, react.createElement)("p", {
				[mark]: "true",
				"data-render-error-inline": "true",
				className: CSS_CLASS.failure
			}, `${props.title ?? "这一块"}渲染失败：${failure instanceof Error ? failure.message : String(failure)}`, (0, react.createElement)("button", {
				type: "button",
				"data-boundary-retry": "true",
				className: CSS_CLASS.buttonGhost,
				onClick: retry
			}, props.retryLabel ?? "重试"));
			return (0, react.createElement)("section", {
				[mark]: "true",
				className: CSS_CLASS.boundary
			}, (0, react.createElement)("h2", null, props.title ?? "LLM 账号"), (0, react.createElement)("p", { className: CSS_CLASS.note }, props.note ?? "这一块渲染失败了，其余设置不受影响。"), (0, react.createElement)("pre", { className: CSS_CLASS.diagnostic }, detail), (0, react.createElement)("button", {
				type: "button",
				"data-boundary-retry": "true",
				className: CSS_CLASS.buttonSecondary,
				onClick: retry
			}, props.retryLabel ?? "重试"));
		}
		//#endregion
		//#region src/client/dashboard.ts
		/**
		* 中栏仪表盘（Task 9）：逐账号列出额度与状态、生效账号高亮。
		*
		* 规格 §8.1 第 5 条：「点开中栏仪表盘：逐账号列出额度、状态、拒绝/冷却与切换记录；生效账号
		* 高亮」。**切换记录一栏已按需求移除**（2026-10-18）—— 记录只说明过去发生过什么，用户
		* 要的是「现在哪张卡还有额度」；宿主侧的记录本身仍在（`switches()` 远程方法未动）。
		*
		* 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态、不发起请求。
		*
		* 视觉（2026-10-17 重做，2026-10-18 平铺）：标题行带刷新/关闭两个图标按钮；每个账号是一张卡片
		* （生效账号的描边用强调色），卡片内是「身份行 + 标记 + 额度表」。
		*
		* **账号平铺不按厂商分组**：用户要看的是「这台机器上有哪些账号、
		* 各自多少额度」，按厂商分组会让同一个列表出现两个标题、两个区块；供应商是账号的一个属性，
		* 所以它是账号名后面的一个徽标，不是一个分组标题。
		* @module dsh-llm-account/src/client/dashboard
		*/
		/**
		* 中栏仪表盘。
		* @param props - 见 {@link DashboardProps}。
		* @returns 元素树。
		*/
		function Dashboard(props) {
			const { t, status } = props;
			const failure = props.failure;
			return (0, react.createElement)("div", {
				"data-card": "dashboard",
				className: CSS_CLASS.dashboard
			}, (0, react.createElement)("header", null, (0, react.createElement)("h2", null, t("dashboard.title")), (0, react.createElement)("div", { className: CSS_CLASS.actions }, ...props.onRefresh === void 0 ? [] : [(0, react.createElement)("button", {
				key: "refresh",
				type: "button",
				"data-dashboard-refresh": "true",
				/**
				* 加载态标记。**点在读的这段时间里**必须存在，否则用户点完看不到任何
				* 变化 —— 那正是 2026-10-22 报障的现象（「既不转圈也不刷新内容」）。
				*
				* `aria-busy` 复用 `css.ts` 里已有的旋转规则
				* （`.dsl-icon[aria-busy="true"] svg { animation: dsl-spin ... }`），
				* 不新造一套动画。
				*/
				...props.refreshing === true ? {
					"data-dashboard-refreshing": "true",
					"aria-busy": "true",
					disabled: true
				} : { "aria-busy": "false" },
				"aria-label": t("dashboard.refresh"),
				title: t("dashboard.refresh"),
				className: CSS_CLASS.icon,
				onClick: () => props.onRefresh?.()
			}, (0, react.createElement)(RefreshIcon, null))], (0, react.createElement)("button", {
				key: "close",
				type: "button",
				"data-dashboard-close": "true",
				"aria-label": t("dashboard.close"),
				title: t("dashboard.close"),
				className: CSS_CLASS.icon,
				onClick: () => props.onClose()
			}, (0, react.createElement)(CloseIcon, null)))), ...failure === void 0 ? [] : [(0, react.createElement)("p", {
				key: "failure",
				"data-dashboard-failure": "true",
				className: CSS_CLASS.failure,
				...failure === "" ? {} : { "data-dashboard-failure-detail": failure }
			}, t("usage.failed"), failure === "" ? "" : `：${failure}`, props.stale === true ? (0, react.createElement)("small", {
				key: "stale",
				"data-dashboard-stale": "true"
			}, `（${t("usage.stale")}）`) : null)], ...status === void 0 && props.vendors === void 0 ? [failure === void 0 ? (0, react.createElement)("p", {
				key: "nodata",
				"data-dashboard-empty": "true",
				className: CSS_CLASS.empty
			}, t("dashboard.noData")) : (0, react.createElement)("p", {
				key: "nodata-failed",
				"data-dashboard-empty": "true",
				className: CSS_CLASS.empty
			}, t("usage.failed"))] : [
				(0, react.createElement)("h3", { key: "accounts-title" }, t("dashboard.accounts")),
				...accountEntries(props).map((entry) => accountBlock(props, entry.account, entry.status, entry.label, entry.vendor)),
				...vendorFailureNotes(props)
			]);
		}
		/**
		* 把所有厂商的账号收成一份平铺列表（厂商声明顺序即展示顺序）。
		*
		* 与旧的「一家一个 section」的区别不只是少一个标题：固定标注与缺额度时的兜底窗口都按
		* **账号自己所属厂商**的状态算，第二家的账号不会画错窗口形状（2026-10-18 修）。
		*/
		function accountEntries(props) {
			const entries = [];
			const collect = (vendor, label, vendorStatus) => {
				for (const account of vendorStatus?.accounts ?? []) {
					if (typeof account !== "object" || account === null) continue;
					entries.push({
						account,
						status: vendorStatus,
						label,
						vendor
					});
				}
			};
			if (props.vendors === void 0) collect(props.status?.vendor ?? "", "", props.status);
			else for (const vendor of props.vendors) collect(vendor.vendor ?? vendor.status?.vendor ?? "", vendor.label, vendor.status);
			return entries;
		}
		/**
		* 厂商级失败项（`status.failures`，如某账号额度读取超时）。
		*
		* 逐条翻成人话（`failureText`：端点短名、包装过的超时诊断），原文留在 `data-failure-detail`
		* 上供排查 ——
		* 把 `timeout after 30000ms` 这种原文直接印在界面上就是调试输出。非超时失败同样映射：
		* 宿主侧现在用账号**名称**记失败（`quota: commandcode "工作账号" read failed (…)`），
		* 可读，所以原样显示。
		*/
		function vendorFailureNotes(props) {
			const { t } = props;
			const failures = props.vendors === void 0 ? props.status?.failures ?? [] : props.vendors.flatMap((vendor) => vendor.status?.failures ?? []);
			if (failures.length === 0) return [];
			return [(0, react.createElement)("div", {
				key: "failures",
				"data-dashboard-failures": "true"
			}, ...failures.map((item, index) => (0, react.createElement)("p", {
				key: index,
				"data-failure": index,
				"data-failure-detail": item,
				className: CSS_CLASS.failure
			}, failureText(t, item))))];
		}
		/** 一个账号的区块：名称、状态、固定/生效标注、拒绝、逐窗口额度。
		*
		* `status` 是**这个账号所属厂商**的状态（多厂商视图里各家不同）：固定标注与缺额度时的
		* 兜底窗口都必须按它算。旧实现用 `props.status`（第一个厂商的），第二家的账号会画错
		* 窗口形状、固定标注也可能张冠李戴（2026-10-18 修）。
		*
		* `label` 是供应商标签：平铺列表里它渲染成账号名后面的徽标（供应商是账号的属性，
		* 不是一个分组标题 —— 2026-10-18 需求）。单厂商旧调用路径传空串，不渲染徽标。
		*/
		function accountBlock(props, account, status = props.status, label = "", vendor = props.status?.vendor ?? "") {
			const { t } = props;
			const effective = account.effective;
			const current = (status?.accounts ?? []).some((candidate) => typeof candidate === "object" && candidate !== null && candidate.effective === true) ? effective : account.active === true;
			const rejectionOf = account.rejection ?? void 0;
			const quotaOf = account.quota ?? void 0;
			return (0, react.createElement)("section", {
				key: account.ref,
				"data-dashboard-account": account.ref,
				"data-dashboard-effective": effective,
				"data-dashboard-configured": account.configured,
				...label === "" ? {} : { "data-dashboard-vendor": label },
				...rejectionOf === void 0 ? {} : { "data-dashboard-rejection-kind": rejectionOf.kind },
				...rejectionOf?.until === void 0 ? {} : { "data-dashboard-rejection-until": rejectionOf.until }
			}, (0, react.createElement)("div", { className: CSS_CLASS.accountHead }, (0, react.createElement)("span", { className: CSS_CLASS.identity }, (0, react.createElement)("span", { className: CSS_CLASS.dot }), (0, react.createElement)("span", { className: CSS_CLASS.identityText }, (0, react.createElement)("span", { className: CSS_CLASS.nameRow }, (0, react.createElement)("h4", null, account.label), ...label === "" ? [] : [(0, react.createElement)("small", {
				key: "vendor",
				"data-account-vendor": label,
				className: CSS_CLASS.vendorBadge
			}, label)], ...current ? [(0, react.createElement)("span", {
				key: "current",
				"data-dashboard-current": account.ref,
				className: CSS_CLASS.mark
			}, t("account.effectiveBy"))] : []), (0, react.createElement)("small", { key: "configured" }, account.configured ? t("account.configured") : t("account.missing")), ...(() => {
				const plan = quotaOf?.plan;
				if (plan === void 0) return [];
				const text = quotaPlanText(t, plan);
				if (text === void 0) return [];
				return [(0, react.createElement)("small", {
					key: "plan",
					"data-dashboard-plan": plan.id,
					className: CSS_CLASS.note
				}, text)];
			})()))), ...rejectionOf === void 0 ? [] : [(0, react.createElement)("p", {
				key: "rejection",
				"data-dashboard-rejection-label": rejectionOf.kind,
				className: CSS_CLASS.rejection
			}, rejectionText(t, rejectionOf.kind))], ...(quotaOf?.failures ?? []).map((item, index) => (0, react.createElement)("small", {
				key: `qf-${index}`,
				"data-dashboard-account-failure": `${account.ref}:${index}`,
				"data-failure-detail": item,
				className: CSS_CLASS.failure
			}, failureText(t, item))), (0, react.createElement)("div", {
				key: "meters",
				className: CSS_CLASS.meters
			}, ...(quotaOf?.windows?.length ? quotaOf.windows : fallbackQuotaWindows(status?.vendor ?? "")).map((window) => windowBlock(t, window))), props.usageOf?.(vendor, account.ref) ?? null);
		}
		/** 一个额度窗口（条形）。 */
		function windowBlock(t, window) {
			return (0, react.createElement)("div", {
				key: window.key,
				"data-dashboard-window": window.key
			}, QuotaBar({
				t,
				window
			}));
		}
		//#endregion
		//#region src/client/sidebar-card.ts
		/**
		* 侧边栏额度卡片 —— 用户的第一诉求（规格 §8.1）。
		*
		* 要修掉的旧缺陷：旧卡片显示「配置里固定的那个账号」，而多账号轮换是每次请求临时决定的，
		* 用量打满被自动切走后卡片数字不变。所以本卡片显示的是**生效账号**（`status().effective`）。
		*
		* 纪律与其它卡片相同（Ruling 22/29）：**纯 props → 元素树**，没有 Hook、没有内部状态，也不会在
		* 这里发起任何请求 —— 轮询由 `seams.ts` 的控制器按挂载/开关状态起停。
		*
		* 视觉：
		* - **整张卡片就是一个按钮**：点哪里都打开用量面板。原先底部那个「打开用量面板」通栏按钮
		*   删掉了 —— 它占一整行却只做一件「点卡片」也能做的事；
		* - **手动刷新搬到面板里**：侧边栏是常驻的窄条，上面摆一个刷新图标容易被误点，而它要刷的
		*   本来就是面板里的东西；
		* - 额度一行放下**三档**（5 小时 / 每周 / 每月）：每档一列「名称 + 剩余百分比 + 细条」，
		*   不再只报 5 小时。
		*
		* 收起态（槽位只有 ~35px）仍然只渲染一个图标按钮，动作与整卡点击相同。
		* @module dsh-llm-account/src/client/sidebar-card
		*/
		/**
		* 一行里要显示的三档窗口，按这个顺序找（键的写法各家不一，见 {@link windowOfKind}）。
		*
		* 需求：「看看能不能在一行空间内显示 5 小时、一周、一个月的额度消耗情况」。
		* 找不到的档位**不占位**（`undefined` 直接跳过）——三家并不都有月度窗口：
		*
		* - **Open Design**：厂商只发五小时与每周两档，**没有月度**（曾本地补过一个，2026-10-23 移除）；
		* - **Command Code**：月度来自 `credits` 的 `monthlyCredits`（真实余额派生）；
		* - **OpenCode Go**：月度来自 `usage.monthly`（厂商 API 直接给）。
		*/
		const ROW_KINDS = [
			{
				kind: "five-hour",
				keys: [
					"fiveHour",
					"5h",
					"5H",
					"rolling"
				]
			},
			{
				kind: "week",
				keys: [
					"weekly",
					"week",
					"Weekly"
				]
			},
			{
				kind: "month",
				keys: [
					"monthly",
					"month",
					"monthlyCredits",
					"Monthly"
				]
			}
		];
		/**
		* 从窗口列表里挑出某一档。
		* @param windows - 归一化后的窗口。
		* @param kind - 目标档位。
		* @returns 该档窗口；没有就是 `undefined`（不占位）。
		*/
		function windowOfKind(windows, kind) {
			const wanted = ROW_KINDS.find((entry) => entry.kind === kind);
			if (wanted === void 0) return void 0;
			for (const key of wanted.keys) {
				const hit = windows.find((window) => window.key === key);
				if (hit !== void 0) return hit;
			}
		}
		/**
		* 侧边栏额度卡片。
		* @param props - 见 {@link SidebarCardProps}。
		* @returns 元素树。
		*/
		function SidebarCard(props) {
			const { t, status } = props;
			const effective = status?.effective ?? void 0;
			const rows = Array.isArray(status?.accounts) ? status.accounts : [];
			const wantedRow = props.accountRef === void 0 ? void 0 : rows.find((account) => account.ref === props.accountRef);
			const effectiveRow = effective === void 0 ? void 0 : rows.find((account) => account.ref === effective.ref);
			const currentRow = wantedRow ?? effectiveRow ?? rows.find((account) => account.active === true) ?? rows.find((account) => account.effective === true) ?? rows.find((account) => account.configured === true);
			const hasData = status !== void 0 && currentRow !== void 0;
			return (0, react.createElement)("div", { className: CSS_CLASS.sidebarShell }, (0, react.createElement)("button", {
				type: "button",
				"data-card": "sidebar-quota",
				"data-sidebar-open": "true",
				"data-sidebar-whole": "true",
				"aria-label": `${titleOf(props, currentRow)} · ${t("sidebar.open")}`,
				title: t("sidebar.open"),
				className: cls(CSS_CLASS.sidebar, CSS_CLASS.sidebarButton),
				onClick: () => props.onOpen()
			}, (0, react.createElement)("div", { className: CSS_CLASS.sidebarHead }, (0, react.createElement)("h3", { "data-sidebar-title": "true" }, (0, react.createElement)("span", { "data-sidebar-account": "true" }, titleOf(props, currentRow)), vendorOf(props) === void 0 ? null : (0, react.createElement)("span", {
				"data-sidebar-vendor": "true",
				className: CSS_CLASS.sidebarVendor
			}, vendorOf(props))), planBadgeOf(currentRow) === void 0 ? null : (0, react.createElement)("span", {
				"data-sidebar-plan": planBadgeOf(currentRow),
				className: CSS_CLASS.sidebarPlan
			}, planBadgeOf(currentRow))), ...hasData ? [...quotaRows(props, currentRow), ...quotaRows(props, currentRow).length === 0 ? [(0, react.createElement)("p", {
				key: "no-short-window",
				"data-sidebar-empty": "short-window",
				className: CSS_CLASS.empty
			}, t("sidebar.noShortWindow"))] : []] : [props.failure === void 0 ? (0, react.createElement)("p", {
				key: "empty",
				"data-sidebar-empty": "true",
				className: CSS_CLASS.empty
			}, t("sidebar.noRequest")) : failureNote(props)], ...hasData && props.failure !== void 0 ? [failureNote(props)] : []), (0, react.createElement)("div", { className: CSS_CLASS.sidebarCompact }, (0, react.createElement)("button", {
				type: "button",
				"data-sidebar-open": "true",
				"data-sidebar-compact": "true",
				"aria-label": t("sidebar.open"),
				title: t("sidebar.open"),
				className: CSS_CLASS.icon,
				onClick: () => props.onOpen()
			}, (0, react.createElement)(UsageIcon, null))));
		}
		/**
		* 额度概览：**两行**，每行一条「标签 — 进度条 — 重置时间」。
		*
		* 第一行 5 小时档、第二行周档。为什么不并排：侧边栏只有两百多像素宽，并排后档位名要截断、
		* 重置时间完全放不下；横排一行一条才塞得下这三样，而且和「还剩多少 + 什么时候恢复」的
		* 阅读顺序一致。
		*
		* 缺少某一档时**不占位**（三家并不都有周窗口）。两档都缺时**一行都不画**，由调用方
		* 显示「没有短周期数据」的说明 —— 绝不拿月度等其它档位顶替（需求：
		* 「小时额度信息和周额度信息没有的话也不能显示月度额度信息啊」）。
		* @param props - 卡片属性。
		* @param row - 当前账号。
		* @returns 要追加的行元素。
		*/
		function quotaRows(props, row) {
			const { t } = props;
			const vendor = props.status?.vendor ?? "";
			const windows = row?.quota?.windows?.length ? row.quota.windows : fallbackQuotaWindows(vendor);
			/**
			* **只显示「5 小时」与「每周」这两档**。
			*
			* 以前的兜底是「一档都认不出来就用第一个能读的窗口」——于是当小时/周读数缺失、只剩月度窗口
			* 时，界面会**单独显示月度额度**。那是不对的：侧边栏的版式与语义就是「本周期还剩多少」的
			* 短周期视图，缺了短周期数据时正确做法是**如实说没有**，而不是拿一档不相干的数字顶上去
			* （需求：「小时额度信息和周额度信息没有的话也不能显示月度额度信息啊」）。
			*/
			const rows = [windowOfKind(windows, "five-hour"), windowOfKind(windows, "week")].filter((item) => item !== void 0);
			if (rows.length === 0) return [];
			return [(0, react.createElement)("div", {
				key: "windows",
				"data-sidebar-windows": "true",
				className: CSS_CLASS.sidebarWindows
			}, (0, react.createElement)("div", {
				key: "head",
				"data-sidebar-head": "true",
				className: CSS_CLASS.sidebarWindowsHead
			}, (0, react.createElement)("span", { className: CSS_CLASS.sidebarWindowLabel }, t("sidebar.usagePeriod")), (0, react.createElement)("span", null, ""), (0, react.createElement)("span", { className: CSS_CLASS.sidebarWindowReset }, t("sidebar.resetTime"))), ...rows.map((window, index) => (0, react.createElement)("div", {
				key: window.key,
				"data-sidebar-row": index === 0 ? "primary" : "secondary",
				className: CSS_CLASS.sidebarRowPrimary
			}, sidebarMeter(t, window))))];
		}
		/**
		* 一档窗口的一行读数：**标签 — 进度条 — 重置时间**（横向三样，需求 定稿）。
		*
		* 条的长度是两个读数的比值：左侧填色 = **剩余**比例（与 QuotaBar 同一口径），
		* 所以「条越长越安全」。百分比数字不再单列一行 —— 条本身已经表达了比例，重置时间更重要。
		*
		* 缺失数据时的表现：条不填色、重置时间写「未知」，都不猜成 0。
		* @param t - 取词。
		* @param window - 该档窗口。
		* @returns 一行元素。
		*/
		function sidebarMeter(t, window) {
			const meter = quotaMeter(window);
			const remaining = meter === void 0 ? void 0 : Math.max(0, Math.min(100, 100 - meter.percent));
			const unlimited = window.unlimited === true;
			const reading = quotaReading(window);
			const level = unlimited ? "unlimited" : remaining === void 0 ? "missing" : remaining > 0 ? "ok" : "error";
			const reset = quotaResetDateText(window.resetAt, Date.now(), window.resetEstimated === true) ?? t("quota.resetUnknown");
			const bar = meter === void 0 || unlimited ? null : (0, react.createElement)("span", {
				"data-quota-bar-fill": window.key,
				"data-level": level,
				className: CSS_CLASS.quotaBarFill,
				style: { width: `${remaining}%` }
			});
			return (0, react.createElement)("div", {
				key: window.key,
				"data-sidebar-window": window.key,
				"data-sidebar-window-shape": reading.shape,
				"data-sidebar-window-level": level,
				className: CSS_CLASS.sidebarWindow
			}, (0, react.createElement)("span", { className: CSS_CLASS.sidebarWindowLabel }, quotaWindowLabel(t, window.key)), (0, react.createElement)("span", {
				"data-sidebar-track": window.key,
				"aria-label": unlimited ? t("quota.unlimited") : remaining === void 0 ? t("account.quotaMissing") : `${remaining}%`,
				className: CSS_CLASS.sidebarWindowTrack
			}, bar), (0, react.createElement)("small", {
				"data-sidebar-reset": window.resetAt ?? "unknown",
				className: CSS_CLASS.sidebarWindowReset
			}, reset));
		}
		/**
		* 失败提示行：可读的原因文案 + 「上次数据」标记。
		*
		* 原因文本由容器从宿主读数里带出来（`status.failures`）；没有文本时只显示通用文案，
		* 不留一行光秃秃的「失败」。诊断原文（端点短名之类的英文）翻成人话再上屏，原文留在
		* `data-sidebar-failure-detail` 上供排查；认不出的形状原样显示。
		*/
		function failureNote(props) {
			const { t } = props;
			const detail = props.failure ?? "";
			return (0, react.createElement)("p", {
				key: "failure",
				"data-sidebar-failure": "true",
				className: CSS_CLASS.failure,
				...detail === "" ? {} : { "data-sidebar-failure-detail": detail }
			}, t("usage.failed"), detail === "" ? "" : `：${failureText(t, detail)}`, props.stale === true ? (0, react.createElement)("small", {
				key: "stale",
				"data-sidebar-stale": "true"
			}, `（${t("usage.stale")}）`) : null);
		}
		/** 卡片标题：只显示当前账号名称；没有账号时用页面名兜底。 */
		function titleOf(props, row) {
			const account = row === void 0 ? props.status?.effective?.ref ?? "" : row.label;
			return account === "" ? props.t("nav") : account;
		}
		/**
		* 这家厂商的显示名（`Command Code` / `Open Design` / `OpenCode`）。
		*
		* 需求：「侧边栏现在只有账号名显示，没有对应个网关厂商显示了」——
		* 多账号轮播到别家时，光看账号名分不清是哪家。
		* @param props - 卡片属性。
		* @returns 显示名；认不出这家时为 `undefined`（不占位）。
		*/
		function vendorOf(props) {
			const key = props.vendorLabelKey;
			if (key === void 0 || key === "") return void 0;
			const label = props.t(key);
			return label === key || label === "" ? void 0 : label;
		}
		/**
		* 当前套餐的**短徽标**（`[GOAT]` / `[GO]` / `[PRO]`…），显示在标题行右侧。
		*
		* 需求：「套餐建议加一个[]括起来，另外都用大写表示」——
		* 方括号把它与账号名、厂商名区分开（否则一长串会被读成同一个名字）；
		* 大写是档位标识的惯例写法。
		*
		* 只取档位名：徽标要能塞进一行且不换行。
		* @param row - 当前账号。
		* @returns 带方括号的徽标文字；没有套餐信息时 `undefined`（不占位）。
		*/
		function planBadgeOf(row) {
			const plan = row?.quota?.plan;
			if (plan === void 0) return void 0;
			const name = (plan.name ?? plan.id).trim();
			return name === "" ? void 0 : `[${name.toUpperCase()}]`;
		}
		//#endregion
		//#region src/core/last-used.ts
		/**
		* 这次读数还「新鲜」吗（用于决定要不要作为「当前账号」显示）。
		*
		* 为什么需要期限：如果用户一整天没发过请求，那「最近一次」是昨天的 —— 把它当成「当前」显示
		* 会误导。超过期限就退回轮播（或按标签页顺序显示第一家）。
		* @param at - 那次请求的时刻（epoch 毫秒）。
		* @param now - 现在。
		* @param ttlMs - 期限（毫秒）；缺省 30 分钟。
		* @returns 是否仍然新鲜。
		*/
		function isLastUsedFresh(at, now, ttlMs = DEFAULT_FRESH_TTL_MS) {
			if (!Number.isFinite(at) || at <= 0) return false;
			return now - at <= ttlMs;
		}
		/** 「最近用过」的默认新鲜期：30 分钟。 */
		const DEFAULT_FRESH_TTL_MS = 18e5;
		//#endregion
		//#region src/client/page-state.ts
		/**
		* 功能页的虚拟命名空间：**不是**任何厂商的设置文档，而是一张专门放跨厂商功能的选项卡
		* （切换策略 + 网页搜索）。
		*
		* 为什么它必须是一个 tab 而不是塞进某家厂商页：这两台功能与「用哪家网关」无关 ——
		* 切号策略对三家同时生效，搜索是全局能力。放在某一家下面会让人以为只对那家生效。
		*
		* **它不是厂商**：容器里所有「按厂商做什么」的路径（读状态、读模型目录、账号表）
		* 都必须显式排除它，否则会多打注定失败的请求。
		*/
		const FEATURE_TAB_NS = "llm-account-features";
		/** 功能页的虚拟 providerId（不冒充任何厂商；`discoverVendors` 永不产出它）。 */
		const FEATURE_TAB_PROVIDER = "features";
		/**
		* 功能页的排序值：远大于任何厂商 order，保证它永远排最后。
		*
		* 用常量而不是「最大值 + 1」：厂商 order 是插件自己声明的（12/22/32 这个量级），
		* 常量更稳定，也不会因为某家改了 order 而让功能页跑到中间去。
		*/
		const FEATURE_TAB_ORDER = 9999;
		/** 三组卡片的规范顺序（规格 §8 的卡片顺序：隐私与安全 → 集成与显示 → 高级设置）。 */
		const GROUP_ORDER = [
			"switch",
			"privacy",
			"integrations",
			"advanced"
		];
		/**
		* 建一个页面状态。
		* @param entries - 注册表里的厂商声明。
		* @param snapshots - 宿主上实际存在的设置命名空间快照（发现的依据，见 Ruling 2）。
		* @param previous - 上一个状态：提供了就**保留草稿与凭据计数**（重新读设置不该把用户没保存的
		*   输入丢掉）。与快照已经一致的草稿会被清掉（那种「改动」已经没有意义）。
		* @param discovery - 本次厂商发现的失败原因（`undefined` 表示成功，空态据此自证）。
		* @returns 新状态：没有草稿时选中的是第一个标签页。
		*/
		function createPageState(entries, snapshots, previous, discovery) {
			const available = new Set(snapshots.map((snapshot) => snapshot.ns));
			const tabs = [...entries.filter((entry) => entry.ns !== "llm-account-features" && available.has(entry.ns)).sort((left, right) => left.order - right.order).map((entry) => ({
				ns: entry.ns,
				providerId: entry.providerId,
				labelKey: entry.labelKey,
				order: entry.order
			})), {
				ns: FEATURE_TAB_NS,
				providerId: FEATURE_TAB_PROVIDER,
				labelKey: "vendor.features",
				order: FEATURE_TAB_ORDER
			}];
			const snapshotMap = {};
			for (const snapshot of snapshots) snapshotMap[snapshot.ns] = {
				ns: snapshot.ns,
				row: snapshot.row,
				value: { ...snapshot.value },
				revision: snapshot.revision
			};
			const hostRow = entries.find((entry) => entry.ns === FEATURE_TAB_NS)?.rowIds.find((row) => snapshotMap[row] !== void 0);
			if (hostRow !== void 0 && snapshotMap["llm-account-features"] === void 0) {
				const host = snapshotMap[hostRow];
				snapshotMap[FEATURE_TAB_NS] = {
					ns: FEATURE_TAB_NS,
					row: hostRow,
					value: { ...host.value },
					revision: host.revision
				};
			}
			const drafts = {};
			for (const [ns, draft] of Object.entries(previous?.drafts ?? {})) {
				const baseline = snapshotMap[ns]?.value ?? {};
				const kept = {};
				for (const [key, value] of Object.entries(draft)) if (!Object.is(baseline[key], value)) kept[key] = value;
				if (Object.keys(kept).length > 0) drafts[ns] = kept;
			}
			const firstVendorTab = tabs.find((tab) => tab.ns !== FEATURE_TAB_NS);
			const previousStillThere = previous !== void 0 && tabs.some((tab) => tab.ns === previous.activeNs);
			return {
				entries,
				tabs,
				activeNs: previousStillThere && previous.activeNs === "llm-account-features" && firstVendorTab !== void 0 && (previous.tabs ?? []).every((tab) => tab.ns === "llm-account-features") ? firstVendorTab.ns : previousStillThere ? previous.activeNs : (firstVendorTab ?? tabs[0])?.ns,
				drafts,
				snapshots: snapshotMap,
				credentialRevision: previous?.credentialRevision ?? 0,
				action: previous?.action,
				actionVendor: previous?.actionVendor,
				expandedRef: previous?.expandedRef,
				expandedVendor: previous?.expandedVendor,
				saveErrors: previous?.saveErrors ?? {},
				saveErrorFields: previous?.saveErrorFields ?? {},
				discovery
			};
		}
		/**
		* 记一次保存的结果：成功清除该厂商的失败原因，失败把可读原因放进去。
		* @param state - 当前状态。
		* @param ns - 设置命名空间。
		* @param error - 失败原因；`undefined` 表示保存成功。
		* @param fields - 这次失败涉及哪些字段（缺省沿用上一次；成功时清空）。
		* @returns 新状态；结果没有变化时是恒等变换。
		*/
		function noteSaveResult(state, ns, error, fields) {
			const current = state.saveErrors[ns];
			const previousFields = state.saveErrorFields[ns];
			if (error === void 0 ? current === void 0 : current === error) return state;
			const saveErrors = { ...state.saveErrors };
			const saveErrorFields = { ...state.saveErrorFields };
			if (error === void 0) {
				delete saveErrors[ns];
				delete saveErrorFields[ns];
			} else {
				saveErrors[ns] = error;
				const keys = fields ?? previousFields;
				if (keys !== void 0 && keys.length > 0) saveErrorFields[ns] = [...keys];
			}
			return {
				...state,
				saveErrors,
				saveErrorFields
			};
		}
		/**
		* 打开一个账户操作（`⋯` 菜单项 / 添加账户）。重复打开同一目标时**不重置**已有输入。
		* @param state - 当前状态。
		* @param action - 要打开的操作（`label`/`key` 可省略，默认空串）。
		* @returns 新状态。
		*/
		function openAction(state, action, vendor) {
			if (state.action?.kind === action.kind && state.action.ref === action.ref && state.actionVendor === vendor) return state;
			return {
				...state,
				action: {
					kind: action.kind,
					...action.ref === void 0 ? {} : { ref: action.ref },
					label: action.label ?? "",
					key: ""
				},
				actionVendor: vendor
			};
		}
		/**
		* 改一个账户操作草稿字段。
		* @param state - 当前状态。
		* @param field - `label` 或 `key`。
		* @param value - 新值。
		* @returns 新状态；没有正在进行的操作时是恒等变换。
		*/
		function setActionField(state, field, value) {
			if (state.action === void 0) return state;
			return {
				...state,
				action: {
					...state.action,
					[field]: value
				}
			};
		}
		/**
		* 关掉正在进行的账户操作（取消，或提交完成）。
		* @param state - 当前状态。
		* @returns 新状态。
		*/
		function closeAction(state) {
			if (state.action === void 0) return state;
			return {
				...state,
				action: void 0,
				actionVendor: void 0
			};
		}
		/**
		* 展开/收起某个账号的完整报告。
		* @param state - 当前状态。
		* @param ref - 目标账号。
		* @returns 新状态。
		*/
		function toggleExpanded(state, ref, vendor) {
			if (state.expandedRef === ref && state.expandedVendor === vendor) return {
				...state,
				expandedRef: void 0,
				expandedVendor: void 0
			};
			return {
				...state,
				expandedRef: ref,
				expandedVendor: vendor
			};
		}
		/**
		* 切到某个标签页。未知的 ns 是恒等变换（不制造一个没有对应标签页的选中态）。
		* @param state - 当前状态。
		* @param ns - 目标设置命名空间。
		* @returns 新状态（草稿原样保留）。
		*/
		function selectTab(state, ns) {
			if (!state.tabs.some((tab) => tab.ns === ns)) return state;
			if (state.activeNs === ns) return state;
			return {
				...state,
				activeNs: ns
			};
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
		/**
		* 改一个字段之后，`ns` 那一份草稿应该长什么样（纯函数，**不**动状态）。
		*
		* 单独暴露的理由：容器在事件回调里立刻要一份「最新的草稿」去落盘，而此刻 React 还没重渲染
		* （`state` 闭包是旧的）。用同一个函数算，渲染与落盘就不会各算一套规则。
		* @param draft - `ns` 现有的草稿（**调用方给最新那份**，不要传旧闭包里的）。
		* @param baseline - 该 `ns` 已存储的值（判断「改回原值」的依据）。
		* @param key - 字段名。
		* @param value - 新值。
		* @returns 新草稿；与基线一致时返回 `undefined`（这条草稿应当消失）。
		*/
		function draftsAfterChange(draft, baseline, key, value) {
			const next = { ...draft ?? {} };
			if (Object.is(baseline?.[key], value)) delete next[key];
			else next[key] = value;
			return Object.keys(next).length === 0 ? void 0 : next;
		}
		function setField(state, ns, key, value) {
			const draft = draftsAfterChange(state.drafts[ns], state.snapshots[ns]?.value, key, value);
			const drafts = { ...state.drafts };
			if (draft === void 0) delete drafts[ns];
			else drafts[ns] = draft;
			return {
				...state,
				drafts
			};
		}
		/**
		* 记一次凭据变更（宿主推送 `credentials/reference-updated`）。计数变化会让页面重新读
		* 「已配置」状态。
		* @param state - 当前状态。
		* @returns 新状态；未动的字段保持同一引用。
		*/
		function noteCredentialChange(state) {
			return {
				...state,
				credentialRevision: state.credentialRevision + 1
			};
		}
		/**
		* 该厂商声明的卡片组：**字段为空的组不渲染**（预检 Ruling 1），并按规范顺序排列。
		* @param entry - 厂商声明。
		* @returns 要渲染的组。
		*/
		function cardGroupsOf(entry) {
			return [...entry.cards].filter((group) => group.fields.length > 0).sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
		}
		/** 声明里的全部字段（按卡片组的规范顺序展平）。 */
		function declaredFields(entry) {
			return cardGroupsOf(entry).flatMap((group) => group.fields);
		}
		/**
		* 找一个字段的声明。
		* @param state - 当前状态（用它的注册表）。
		* @param ns - 设置命名空间。
		* @param key - 字段名。
		* @returns 声明；该厂商没声明这个字段时为 `undefined`。
		*/
		function specOf(state, ns, key) {
			const entry = state.entries.find((candidate) => candidate.ns === ns);
			return entry === void 0 ? void 0 : declaredFields(entry).find((spec) => spec.key === key);
		}
		/**
		* 一个字段当前应显示的值：草稿 → 基线 → 声明默认值。都没有就是 `undefined`（**不编造**）。
		* @param state - 当前状态。
		* @param ns - 设置命名空间。
		* @param key - 字段名。
		* @returns 当前值。
		*/
		function fieldValue(state, ns, key) {
			const draft = state.drafts[ns];
			if (draft !== void 0 && key in draft) return draft[key];
			const snapshot = state.snapshots[ns];
			if (snapshot !== void 0 && key in snapshot.value) return snapshot.value[key];
			return specOf(state, ns, key)?.fallback;
		}
		/**
		* 一个厂商要渲染的全部字段（按卡片顺序展平，带当前值与「是否改动」）。
		* @param state - 当前状态。
		* @param entry - 厂商声明。
		* @returns 字段渲染状态。
		*/
		function fieldsOf(state, entry) {
			const baseline = state.snapshots[entry.ns]?.value ?? {};
			return declaredFields(entry).map((spec) => {
				const value = fieldValue(state, entry.ns, spec.key);
				return {
					spec,
					value,
					changed: !Object.is(baseline[spec.key], value)
				};
			});
		}
		/** 侧边栏额度卡片开关的字段名（规格 §8.1 第 6 条：它住在「集成与显示」里）。 */
		const SIDEBAR_TOGGLE_KEY = "showSidebarQuota";
		/**
		* 侧边栏**轮播清单**的字段名（`vendor:ref` 键；空数组 = 全部账号）。
		*
		* 需求：「自己选择轮播哪些账号进行显示，默认为所有账号轮播」。
		*
		* 为什么用「空 = 全部」而不是「默认时把全部账号写进文档」：账号是会变的（新增/删除/
		* 换密钥），把当时的清单冻结进文档意味着新加的账号默认不显示 —— 与「默认为所有账号」
		* 正好相反。空数组表达的是「不限制」，新账号自然就进来了。
		*
		* 存 `vendor:ref`（与 `accountOrder` 同一套键）：同一个 ref 在两家可能重名。
		*/
		const SIDEBAR_ACCOUNTS_KEY = "sidebarAccounts";
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
		function sidebarQuotaEnabled(storedValue) {
			if (storedValue === void 0) return false;
			if (Array.isArray(storedValue["sidebarAccounts"])) return storedValue[SIDEBAR_ACCOUNTS_KEY].length > 0;
			return storedValue[SIDEBAR_TOGGLE_KEY] === true;
		}
		/**
		* 轮播清单里显式勾中的账号键（`vendor:ref`）。
		*
		* **跨厂商合并**：三份设置文档各自存一份完整清单（与 `accountOrder` 同一个模式），这里取
		* 并集 —— 用户在任意一家标签页里改的都是同一件事（「侧边栏显示哪些账号」）。
		*
		* 返回空数组有两种含义，调用方必须用 {@link sidebarSelectionConfigured} 区分：
		* 未配置 = 全部账号（默认）；配置成空 = 一个都不要。
		* @param values - 各厂商的设置文档值（按命名空间）。
		* @returns 去重后的 `vendor:ref` 键（保持首次出现顺序）。
		*/
		function sidebarAccountKeysOf(values) {
			const out = [];
			const seen = /* @__PURE__ */ new Set();
			for (const value of Object.values(values)) {
				if (value === null || typeof value !== "object") continue;
				const raw = value[SIDEBAR_ACCOUNTS_KEY];
				if (!Array.isArray(raw)) continue;
				for (const item of raw) {
					if (typeof item !== "string") continue;
					const key = item.trim();
					if (!key.includes(":")) continue;
					const [vendor, ...rest] = key.split(":");
					const ref = rest.join(":");
					if (vendor === "" || vendor === void 0 || ref === "") continue;
					if (seen.has(key)) continue;
					seen.add(key);
					out.push(key);
				}
			}
			return out;
		}
		/**
		* 轮播清单**是否被显式配置过**（三份文档里至少有一份带这个字段）。
		* @param values - 各厂商的设置文档值。
		* @returns 是否配置过。
		*/
		function sidebarSelectionConfigured$1(values) {
			for (const value of Object.values(values)) {
				if (value === null || typeof value !== "object") continue;
				if (Array.isArray(value["sidebarAccounts"])) return true;
			}
			return false;
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
		function sidebarVendorOf(entries, snapshots) {
			return entries.find((entry) => sidebarQuotaEnabled(snapshots[entry.ns]?.value));
		}
		/**
		* 侧边栏卡片要**轮播**的厂商清单（按标签页顺序，只含开启的）。
		*
		* 需求：侧边栏不要只显示一家 —— 所有开启的厂商各自的「当前使用」账号额度
		* 轮流显示，切换间隔按分钟在设置里配。只有一个开启时，行为与单家完全一致（不轮播）。
		* @param entries - 注册表里的厂商声明（已按页面顺序排列）。
		* @param snapshots - 各厂商的设置文档。
		* @returns 厂商 id 列表；一家都没开时为空数组。
		*/
		function sidebarVendorsOf(entries, snapshots) {
			return entries.filter((entry) => sidebarQuotaEnabled(snapshots[entry.ns]?.value)).map((entry) => entry.providerId);
		}
		/**
		* 侧边栏**跟随模式**下要读的厂商清单：**全部已注册厂商**，不管各自的开关。
		*
		* 为什么与 {@link sidebarVendorsOf} 不同（2026-10-19）：用户把显示方式改成「跟随当前会话」
		* 之后，`showSidebarQuota` 那种**按厂商**的开关就不再合适 —— 用户在一个 opendesign 的会话里
		* 发消息，侧边栏却因为「opendesign 的开关没开」而不显示它，这正是用户报的
		* 「一直显示 commandcode，opendesign 从来没显示过」。
		*
		* 新的语义是：**谁在服务当前会话就显示谁**。所以跟随模式下要读全部厂商，由
		* `lastUsed` 决定最终显示哪一个。
		* @param entries - 注册表里的厂商声明（已按页面顺序排列）。
		* @returns 全部厂商 id（按页面顺序）。
		*/
		function sidebarFollowVendorsOf(entries) {
			return entries.map((entry) => entry.providerId);
		}
		/**
		* 侧边栏现在该用哪套厂商清单。
		*
		* 跟随模式（默认，2026-10-19 起）用全部厂商；只有当用户**显式**关掉了全部开关、且没有任何
		* 厂商设置过清单时才退回「按开关过滤」—— 换句话说：只要配置里还有一家开着，就按跟随语义
		* 走（因为开关是旧语义的残留，不该继续限制跟随）。
		* @param entries - 注册表里的厂商声明。
		* @param snapshots - 各厂商的设置文档。
		* @returns 参与侧边栏的厂商 id。
		*/
		function sidebarScopeOf(entries, snapshots) {
			if (sidebarVendorsOf(entries, snapshots).length === 0) return [];
			return sidebarFollowVendorsOf(entries);
		}
		/**
		* 由「各厂商读数」算出**轮播目标清单**（纯函数，可完整单测）。
		*
		* 需求：「自己选择轮播哪些账号进行显示，默认为所有账号轮播」。
		*
		* 规则：
		* 1. 按 `vendors` 给的顺序（= 标签页顺序）逐家展开，家内按读数里的账号顺序；
		* 2. 只要**已配置**的账号（没密钥的账号显示出来也只是一条空额度）；
		* 3. 有勾选清单时只收勾中的（键是 `vendor:ref`）；勾选为空表示「全部」（默认）；
		* 4. 某一家还没有读数（`undefined`）时跳过 —— 它读到之后会被自动补进来。
		*
		* @param vendors - 要参与轮播的厂商 id（按标签页顺序）。
		* @param statuses - 各厂商的读数（键是厂商 id）。
		* @param selection - 勾选状态：`keys` 是 `vendor:ref`，`configured` 表示用户是否显式配置过。
		* @returns 轮播目标清单。
		*/
		function sidebarTargetsOf(vendors, statuses, selection) {
			const targets = [];
			for (const vendor of vendors) {
				const status = statuses[vendor];
				if (status === void 0) continue;
				const accounts = Array.isArray(status.accounts) ? status.accounts : [];
				for (const account of accounts) {
					if (typeof account !== "object" || account === null) continue;
					if (account.configured !== true) continue;
					if (!sidebarIncludesAccount(selection.configured, selection.keys, vendor, account.ref)) continue;
					targets.push({
						vendor,
						ref: account.ref
					});
				}
			}
			return targets;
		}
		/**
		* 现在该显示哪一个账号（**不轮播**，需求 明确要求去掉轮播）。
		*
		* 优先级：
		* 1. **最近一次请求的账号**，且它仍在清单里、且足够新鲜 → 用它（这就是「跟随当前会话」）；
		* 2. 否则用清单里的**第一个**（确定性、可解释 —— 按标签页顺序，第一家那个账号）。
		*
		* 为什么「最近一次请求」够用：宿主的 `remote.session` 没有「前端当前打开哪个会话」的接口
		* （2026-10-19 扫过全部调用点确认）。而刚发过请求的会话几乎必然就是用户在看的那个。
		* 界面上**不再标注**这一点，但它仍然是「最近发过请求」
		* 的含义、不是实时跟随：翻看一个旧会话而没发消息时，显示的会是上次真正发过请求的账号。
		*
		* @param targets - 目标清单（按当前供应商排过序）。
		* @param lastUsed - 最近一次请求的账号；没有时为 `undefined`。
		* @param now - 现在（用于判断新鲜度）。
		* @returns 要显示的目标；清单为空时为 `undefined`。
		*/
		function sidebarCurrentTarget(targets, lastUsed, now = Date.now()) {
			if (targets.length === 0) return void 0;
			if (lastUsed !== void 0 && isLastUsedFresh(lastUsed.at, now)) {
				const hit = targets.find((item) => item.vendor === lastUsed.vendor && item.ref === lastUsed.account);
				if (hit !== void 0) return hit;
			}
			return targets[0];
		}
		/**
		* 一个账号键（`vendor:ref`）在不在勾选清单里。
		*
		* 「没配置过」= 全部账号轮播（用户要的默认）；「配置成空数组」= 一个都不要。
		* @param configured - 用户是否显式配置过。
		* @param keys - 勾中的键。
		* @param vendor - 厂商 id。
		* @param ref - 账号 ref。
		* @returns 是否参与轮播。
		*/
		function sidebarIncludesAccount(configured, keys, vendor, ref) {
			if (!configured) return true;
			return keys.includes(accountOrderKey(vendor, ref));
		}
		/**
		* 一个账号在勾选清单里的键。
		* @param vendor - 厂商 id。
		* @param ref - 账号 ref。
		* @returns `vendor:ref`。
		*/
		function accountOrderKey(vendor, ref) {
			return `${vendor}:${ref}`;
		}
		//#endregion
		//#region src/core/switching/search-keys.ts
		/**
		* 一个引用名是否「可解析」的形状（与项目其它凭据引用同一条纪律）。
		*
		* 不允许空格、不允许以 `-` 开头（那会被命令行当成选项）、长度 1–64。
		* @param ref - 引用名。
		* @returns 形状是否合法。
		*/
		function isResolvableKeyRef(ref) {
			return /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(ref.trim());
		}
		/**
		* 把逐条状态汇总成界面能直接用的一句事实。
		*
		* 为什么要分四档而不是一个布尔：**「填了名字但库里没有」是最容易被误会的状态** ——
		* 用户以为自己加好了，其实搜索仍然用不了。那一档必须单独说出口。
		* @param rows - 逐条状态。
		* @returns 汇总结果。
		*/
		function summarizeKeyStatus(rows) {
			const total = rows.length;
			const configured = rows.filter((row) => row.configured).length;
			const missing = rows.filter((row) => !row.configured).map((row) => row.ref);
			return {
				state: total === 0 ? "none" : configured === 0 ? "missing" : configured === total ? "configured" : "partial",
				configured,
				total,
				missing
			};
		}
		/**
		* 从「引用名」字段的文本里解析出要写入的引用名列表。
		*
		* **只按逗号切分**，不按空白：引用名本身不允许空格，所以 `bad key` 是一个**写错的条目**，
		* 不能被切成 `bad` 与 `key` 两个合法名字 —— 那会把密钥写进两个错误的凭据槽。
		* 形状非法的条目直接丢掉，并保留顺序去重。
		* @param text - 用户填的引用名文本。
		* @returns 合法的引用名（去重、保序）。
		*/
		function parseSecretRefs(text) {
			const out = [];
			for (const item of text.split(/[,，\n\r]+/)) {
				const ref = item.trim();
				if (ref === "" || !isResolvableKeyRef(ref)) continue;
				if (!out.includes(ref)) out.push(ref);
			}
			return out;
		}
		/**
		* 校验「保存密钥」这个动作的输入。
		*
		* 三条拒绝理由都是真实会踩的：
		* - 空 key：写空等于清掉密钥，不该用这个按钮做；
		* - 没有引用名：不知道往哪个槽写；
		* - key 里带空格：几乎必然是粘错（把两段粘在一起）。
		* @param secret - 用户贴进来的密钥。
		* @param refs - 目标引用名。
		* @returns 拒绝原因（人话）；合格时为 `undefined`。
		*/
		function validateSecretInput(secret, refs) {
			if (secret.trim() === "") return "请先填写密钥。";
			if (refs.length === 0) return "请先在上面填写凭据引用名（例如 DEEPSEEK_API_KEY）。";
			if (/\s/.test(secret.trim())) return "密钥里不能有空格，请检查是否粘错。";
		}
		/**
		* 给「再加一把密钥」分配一个没用过的引用名。
		*
		* 用户不再自己填名字（2026-10-20：「只保留保存密钥那个」），所以名字要自动生成：
		* 第一个用基础名，之后依次 `_2`、`_3`……
		*
		* **会复用空洞**：删掉中间那条之后再加，名字回到那个空洞（`{基础名, 基础名_3}` → `_2`）。
		* 这样编号不会越涨越大 —— 用户删了再加，看到的是「还是那几个名字」而不是一路涨到 `_17`。
		* @param existing - 已有的引用名。
		* @param base - 基础名（缺省 `DEEPSEEK_API_KEY`）。
		* @returns 可用的引用名。
		*/
		function nextKeyRef(existing, base = "DEEPSEEK_API_KEY") {
			if (!existing.includes(base)) return base;
			let index = 2;
			while (existing.includes(`${base}_${index}`)) index += 1;
			return `${base}_${index}`;
		}
		/**
		* 从列表里摘掉一条。
		* @param refs - 当前列表。
		* @param ref - 要删除的引用名。
		* @returns 新列表（删不存在的条目是无操作）；不修改入参。
		*/
		function removeKeyRef(refs, ref) {
			return refs.filter((item) => item !== ref);
		}
		//#endregion
		//#region src/core/model-quota-table.ts
		/**
		* 官方展示名末尾的**标注性后缀**，它们不是模型身份的一部分。
		*
		* 官方页写成 `DeepSeek V4.1 Flash (latest)` / `DeepSeek V4 Flash Vision (exp)`，
		* 而网关目录里的 id 是 `deepseek-v4.1-flash` / `...-vision-exp` —— 不剥掉这些后缀，
		* 两边永远对不上（2026-10-21 实测：带 `(latest)` 的都匹配失败）。
		*
		* 注意 `exp` 有两种写法：官方写 `(exp)`、目录写 `-exp`，所以它单独按词处理，
		* 不能只剥括号。
		*/
		const ANNOTATION_PATTERN = /\((?:latest|exp|experimental|preview|beta)\)/gi;
		/** 目录 id 里作为「标注」的同义尾部词（`-exp` / `-latest`）。 */
		const TRAILING_MARKERS = /(?:^|\s)(?:latest|exp|experimental|beta)$/i;
		/**
		* 把模型 id / 展示名归一化成查表用的键。
		*
		* 规则：转小写、把连字符与下划线都换成单空格、压缩多余空白、剥掉标注性后缀。于是
		* `deepseek/deepseek-v4.1-flash`、`DeepSeek V4.1 Flash (latest)` 得到同一个键
		* `deepseek v4.1 flash`。
		*
		* 只保留最后一段（`company/model` 只取 `model`）：官方表不区分公司前缀，
		* 而目录里同一个模型可能带不同前缀。
		* @param name - 模型 id 或展示名。
		* @returns 归一化键；空输入返回空串。
		*/
		function normalizeModelKey(name) {
			const trimmed = name.trim();
			if (trimmed === "") return "";
			const segments = trimmed.split("/");
			let key = (segments[segments.length - 1] ?? trimmed).replace(ANNOTATION_PATTERN, " ").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
			key = key.replace(TRAILING_MARKERS, "").replace(/\s+/g, " ").trim();
			return key;
		}
		/** 把官方表格里的 `$47` / `~$100` / `Free` 解析成 {@link ModelQuotaAmount}。 */
		function amountOf(raw) {
			const text = raw.trim();
			if (text === "") return void 0;
			if (/^free$/i.test(text)) return { kind: "free" };
			const approx = text.startsWith("~") || text.startsWith("约");
			const digits = text.replace(/[^\d.]/g, "");
			if (digits === "") return void 0;
			const value = Number(digits);
			if (!Number.isFinite(value) || value < 0) return void 0;
			return approx ? {
				kind: "approx",
				amount: value
			} : {
				kind: "usd",
				amount: value
			};
		}
		/**
		* Command Code **GOAT 套餐**的逐模型额度（官方 `docs/plans/goat` 的 `Monthly credits` 列，
		* 抓于 2026-10-21）。
		*
		* 为什么单独一张：GOAT 是用户实际在用的档位，而官方在这一页把**全部 60 个模型**都列了
		* 各自的 monthly credits（含 Claude / GPT / Gemini 等闭源模型）。pricing 页那张只有 7 个
		* 开源模型的五档表覆盖不了它 —— 需求 报障「commandcode 没看到每个模型各自的
		* 可用额度」，根因就是当时用的是那张 7 行表。
		*
		* 数据特点（官方原样）：
		* - 同一模型在不同档位拿到的 credits 不同，这里只取 GOAT 那列；
		* - `$100`（Ling 3.1 Flash）比套餐总额 $70 还高 —— 官方按模型定价折算，不是固定比例；
		* - Claude Sonnet 5.5 只有 $10，Claude Haiku 5.5 有 $20（官方原文：GOAT 上的 premium
		*   models 每月 $10 credits，Claude Haiku 5.5 除外拿 $20）。
		*/
		/**
		* Command Code **Go / Pro / Max** 三档的逐模型额度（官方 `docs/plans/{go,pro,max}`
		* 的 Monthly credits 列，抓于 2026-10-21）。
		*
		* 为什么需要：GOAT 那张表只覆盖 GOAT 档。用户切到其他档位时，若没有这些表，
		* 除了 pricing 页那 7 个开源模型之外**全部显示「未知」** —— 而官方其实公布了完整数字
		* （Go 47 个 / Pro 75 个 / Max 97 个）。
		*
		* Max 档的列头在官网上叫 `Max 10× credits`（对应 $150/月那档）。
		*/
		const COMMANDCODE_GO_RAW = {
			"DeepSeek V4 Flash (latest)": "$6",
			"DeepSeek V4 Flash Fast": "$8",
			"DeepSeek V4 Flash Vision (exp)": "$6",
			"DeepSeek V4 Pro (latest)": "$6",
			"DeepSeek V4.1 Flash (latest)": "$10",
			"DeepSeek V4.1 Flash Fast (latest)": "$6",
			"GLM-5.2": "$10",
			"GLM-5.2 Fast": "$9",
			"GLM-5.3": "$10",
			"GLM-5.3 Flash": "$10",
			"GLM-5.3 FlashX": "$6",
			"GPT-5.6 Luna": "$6",
			"GPT-6 Luna": "$6",
			"Grok 4.5": "$6",
			"Inkling": "$6",
			"Inkling Small": "$6",
			"Kimi K2.7 Code": "$9",
			"Kimi K2.7 Code HighSpeed": "$6",
			"Kimi K3": "$8",
			"Ling 3.1 Flash": "$6",
			"LongCat 2.0": "$10",
			"MiMo V2.5": "$6",
			"MiMo V2.5 Pro": "$6",
			"MiMo V2.6 Flash": "$6",
			"MiMo V2.6 Pro": "$6",
			"MiniMax M3": "$8",
			"MiniMax M3.1 Flash": "$6",
			"Mistral Large 4": "$6",
			"Muse Spark 1.2 Contributor": "$6",
			"Muse Spark 1.3 Contributor": "$6",
			"Muse Spark Open": "$6",
			"Nemotron 3 Ultra": "$6",
			"Nemotron 3.5 Super VL": "$6",
			"Ornith 1.5 122B": "$6",
			"Qwen 3.6 Plus": "$10",
			"Qwen 3.7 Max": "$10",
			"Qwen 3.7 Plus": "$10",
			"Qwen 3.8 27B": "$10",
			"Qwen 3.8 Flash": "$6",
			"Qwen 3.8 Max": "$7",
			"Qwen 3.8 Max 0902": "$7",
			"Qwen 3.8 Omni Flash": "$6",
			"Step 3.5 Flash": "$6",
			"Step 3.7 Flash": "$6",
			"Step 5 Preview": "$6",
			"Tencent Hy3": "$10",
			"Tencent Hy4 Preview": "$6"
		};
		const COMMANDCODE_PRO_RAW = {
			"Claude Haiku 4.5": "$20",
			"Claude Haiku 5.5": "$30",
			"Claude Sonnet 4.6": "$20",
			"Claude Sonnet 5": "$20",
			"Claude Sonnet 5.5": "$20",
			"DeepSeek V4 Flash (latest)": "$70",
			"DeepSeek V4 Flash Fast": "$30",
			"DeepSeek V4 Flash Vision (exp)": "$30",
			"DeepSeek V4 Pro (latest)": "$30",
			"DeepSeek V4.1 Flash (latest)": "$90",
			"DeepSeek V4.1 Flash Fast (latest)": "$70",
			"Gemini 3.1 Flash Lite": "$20",
			"Gemini 3.5 Flash": "$20",
			"Gemini 3.5 Flash Lite": "$20",
			"Gemini 3.6 Flash": "$20",
			"Gemini 3.7 Flash": "$50",
			"Gemini 3.8 Flash": "$50",
			"Gemini 4 Argon": "$20",
			"GLM-5.2": "$80",
			"GLM-5.2 Fast": "$30",
			"GLM-5.3": "$30",
			"GLM-5.3 Flash": "$90",
			"GLM-5.3 FlashX": "$30",
			"GPT-5.3 Codex": "$20",
			"GPT-5.4": "$20",
			"GPT-5.4 Mini": "$20",
			"GPT-5.5": "$20",
			"GPT-5.6 Luna": "$30",
			"GPT-5.6 Sol": "$30",
			"GPT-5.6 Terra": "$20",
			"GPT-6 Luna": "$30",
			"GPT-6 Sol": "$20",
			"Grok 4.5": "$30",
			"Grok 4.6": "$30",
			"Grok 4.7": "$30",
			"Inkling": "$30",
			"Inkling Small": "$30",
			"Jev": "$30",
			"Jev 1.14.0": "$30",
			"Kimi K2.7 Code": "$70",
			"Kimi K2.7 Code HighSpeed": "$30",
			"Kimi K3": "$30",
			"Ling 3.1 Flash": "$110",
			"LongCat 2.0": "$60",
			"MiMo V2.5": "$40",
			"MiMo V2.5 Pro": "$30",
			"MiMo V2.6 Flash": "$30",
			"MiMo V2.6 Pro": "$30",
			"MiMo V2.6 Pro UltraSpeed": "$20",
			"MiniMax M3": "$57",
			"MiniMax M3.1 Flash": "$30",
			"Mistral Large 4": "$30",
			"Muse Spark 1.1": "$20",
			"Muse Spark 1.2": "$30",
			"Muse Spark 1.2 Contributor": "$30",
			"Muse Spark 1.3": "$30",
			"Muse Spark 1.3 Contributor": "$30",
			"Muse Spark Open": "$30",
			"Nemotron 3 Ultra": "$30",
			"Nemotron 3.5 Super VL": "$30",
			"Ornith 1.5 122B": "$30",
			"Qwen 3.6 Plus": "$43",
			"Qwen 3.7 Max": "$43",
			"Qwen 3.7 Plus": "$43",
			"Qwen 3.8 27B": "$80",
			"Qwen 3.8 Flash": "$30",
			"Qwen 3.8 Max": "$30",
			"Qwen 3.8 Max 0902": "$30",
			"Qwen 3.8 Max Prime": "$30",
			"Qwen 3.8 Omni Flash": "$30",
			"Step 3.5 Flash": "$30",
			"Step 3.7 Flash": "$30",
			"Step 5 Preview": "$30",
			"Tencent Hy3": "$80",
			"Tencent Hy4 Preview": "$30"
		};
		const COMMANDCODE_MAX10_RAW = {
			"Beam 1.0": "Free",
			"Claude Fable 5": "$100",
			"Claude Fable 5.1": "$100",
			"Claude Haiku 4.5": "$100",
			"Claude Haiku 5.5": "$150",
			"Claude Opus 4.6": "$100",
			"Claude Opus 4.7": "$100",
			"Claude Opus 4.8": "$100",
			"Claude Opus 5": "$100",
			"Claude Opus 5.5": "$100",
			"Claude Sonnet 4.6": "$100",
			"Claude Sonnet 5": "$100",
			"Claude Sonnet 5.5": "$150",
			"DeepSeek V4 Flash (latest)": "$150",
			"DeepSeek V4 Flash Fast": "$150",
			"DeepSeek V4 Flash Vision (exp)": "$150",
			"DeepSeek V4 Pro (latest)": "$150",
			"DeepSeek V4.1 Flash (latest)": "$150",
			"DeepSeek V4.1 Flash Fast (latest)": "$150",
			"Fugu Ultra": "$100",
			"Gemini 3.1 Flash Lite": "$100",
			"Gemini 3.5 Flash": "$100",
			"Gemini 3.5 Flash Lite": "$100",
			"Gemini 3.6 Flash": "$100",
			"Gemini 3.7 Flash": "$150",
			"Gemini 3.8 Flash": "$150",
			"Gemini 4 Argon": "$100",
			"GLM-5": "$150",
			"GLM-5.1": "$150",
			"GLM-5.2": "$150",
			"GLM-5.2 Fast": "$150",
			"GLM-5.3": "$150",
			"GLM-5.3 Flash": "$150",
			"GLM-5.3 FlashX": "$150",
			"Glyph Cluster": "Free",
			"GPT-5.3 Codex": "$100",
			"GPT-5.4": "$100",
			"GPT-5.4 Mini": "$100",
			"GPT-5.5": "$100",
			"GPT-5.6 Luna": "$150",
			"GPT-5.6 Sol": "$150",
			"GPT-5.6 Terra": "$100",
			"GPT-6 Astra": "$100",
			"GPT-6 Luna": "$150",
			"GPT-6 Sol": "$100",
			"GPT-6.1 Sol": "$100",
			"Grok 4.5": "$150",
			"Grok 4.6": "$150",
			"Grok 4.7": "$150",
			"Inkling": "$150",
			"Inkling Small": "$150",
			"Jev": "$150",
			"Jev 1.14.0": "$150",
			"Kimi K2.5": "$150",
			"Kimi K2.6": "$150",
			"Kimi K2.7 Code": "$150",
			"Kimi K2.7 Code HighSpeed": "$150",
			"Kimi K3": "$150",
			"Laguna S 2.1": "Free",
			"Ling 3.1 Flash": "$150",
			"LongCat 2.0": "$150",
			"MiMo V2.5": "$150",
			"MiMo V2.5 Pro": "$150",
			"MiMo V2.6 Flash": "$150",
			"MiMo V2.6 Pro": "$150",
			"MiMo V2.6 Pro UltraSpeed": "$150",
			"MiniMax M2.5": "$150",
			"MiniMax M2.7": "$150",
			"MiniMax M3": "$150",
			"MiniMax M3.1 Flash": "$150",
			"Mistral Large 4": "$150",
			"Muse Spark 1.1": "$100",
			"Muse Spark 1.2": "$150",
			"Muse Spark 1.2 Contributor": "$150",
			"Muse Spark 1.3": "$150",
			"Muse Spark 1.3 Contributor": "$150",
			"Muse Spark Open": "$150",
			"Muse Wonder": "$100",
			"Nemotron 3 Ultra": "$150",
			"Nemotron 3.5 Super VL": "$150",
			"Ornith 1.5 122B": "$150",
			"Qwen 3.6 Max Preview": "$150",
			"Qwen 3.6 Plus": "$150",
			"Qwen 3.7 Flash": "$150",
			"Qwen 3.7 Max": "$150",
			"Qwen 3.7 Plus": "$150",
			"Qwen 3.8 27B": "$150",
			"Qwen 3.8 Flash": "$150",
			"Qwen 3.8 Max": "$150",
			"Qwen 3.8 Max 0902": "$150",
			"Qwen 3.8 Max Prime": "$150",
			"Qwen 3.8 Omni Flash": "$150",
			"Step 3.5 Flash": "$150",
			"Step 3.7 Flash": "$150",
			"Step 5 Preview": "$150",
			"Tencent Hy3": "$150",
			"Tencent Hy4 Preview": "$150"
		};
		const COMMANDCODE_MAX20_RAW = {
			"Beam 1.0": "Free",
			"Claude Fable 5": "$200",
			"Claude Fable 5.1": "$200",
			"Claude Haiku 4.5": "$200",
			"Claude Haiku 5.5": "$300",
			"Claude Opus 4.6": "$200",
			"Claude Opus 4.7": "$200",
			"Claude Opus 4.8": "$200",
			"Claude Opus 5": "$200",
			"Claude Opus 5.5": "$200",
			"Claude Sonnet 4.6": "$200",
			"Claude Sonnet 5": "$200",
			"Claude Sonnet 5.5": "$300",
			"DeepSeek V4 Flash (latest)": "$300",
			"DeepSeek V4 Flash Fast": "$300",
			"DeepSeek V4 Flash Vision (exp)": "$300",
			"DeepSeek V4 Pro (latest)": "$300",
			"DeepSeek V4.1 Flash (latest)": "$300",
			"DeepSeek V4.1 Flash Fast (latest)": "$300",
			"Fugu Ultra": "$200",
			"Gemini 3.1 Flash Lite": "$200",
			"Gemini 3.5 Flash": "$200",
			"Gemini 3.5 Flash Lite": "$200",
			"Gemini 3.6 Flash": "$200",
			"Gemini 3.7 Flash": "$300",
			"Gemini 3.8 Flash": "$300",
			"Gemini 4 Argon": "$200",
			"GLM-5": "$300",
			"GLM-5.1": "$300",
			"GLM-5.2": "$300",
			"GLM-5.2 Fast": "$300",
			"GLM-5.3": "$300",
			"GLM-5.3 Flash": "$300",
			"GLM-5.3 FlashX": "$300",
			"Glyph Cluster": "Free",
			"GPT-5.3 Codex": "$200",
			"GPT-5.4": "$200",
			"GPT-5.4 Mini": "$200",
			"GPT-5.5": "$200",
			"GPT-5.6 Luna": "$300",
			"GPT-5.6 Sol": "$300",
			"GPT-5.6 Terra": "$200",
			"GPT-6 Astra": "$200",
			"GPT-6 Luna": "$300",
			"GPT-6 Sol": "$200",
			"GPT-6.1 Sol": "$200",
			"Grok 4.5": "$300",
			"Grok 4.6": "$300",
			"Grok 4.7": "$300",
			"Inkling": "$300",
			"Inkling Small": "$300",
			"Jev": "$300",
			"Jev 1.14.0": "$300",
			"Kimi K2.5": "$300",
			"Kimi K2.6": "$300",
			"Kimi K2.7 Code": "$300",
			"Kimi K2.7 Code HighSpeed": "$300",
			"Kimi K3": "$300",
			"Laguna S 2.1": "Free",
			"Ling 3.1 Flash": "$300",
			"LongCat 2.0": "$300",
			"MiMo V2.5": "$300",
			"MiMo V2.5 Pro": "$300",
			"MiMo V2.6 Flash": "$300",
			"MiMo V2.6 Pro": "$300",
			"MiMo V2.6 Pro UltraSpeed": "$300",
			"MiniMax M2.5": "$300",
			"MiniMax M2.7": "$300",
			"MiniMax M3": "$300",
			"MiniMax M3.1 Flash": "$300",
			"Mistral Large 4": "$300",
			"Muse Spark 1.1": "$200",
			"Muse Spark 1.2": "$300",
			"Muse Spark 1.2 Contributor": "$300",
			"Muse Spark 1.3": "$300",
			"Muse Spark 1.3 Contributor": "$300",
			"Muse Spark Open": "$300",
			"Muse Wonder": "$200",
			"Nemotron 3 Ultra": "$300",
			"Nemotron 3.5 Super VL": "$300",
			"Ornith 1.5 122B": "$300",
			"Qwen 3.6 Max Preview": "$300",
			"Qwen 3.6 Plus": "$300",
			"Qwen 3.7 Flash": "$300",
			"Qwen 3.7 Max": "$300",
			"Qwen 3.7 Plus": "$300",
			"Qwen 3.8 27B": "$300",
			"Qwen 3.8 Flash": "$300",
			"Qwen 3.8 Max": "$300",
			"Qwen 3.8 Max 0902": "$300",
			"Qwen 3.8 Max Prime": "$300",
			"Qwen 3.8 Omni Flash": "$300",
			"Step 3.5 Flash": "$300",
			"Step 3.7 Flash": "$300",
			"Step 5 Preview": "$300",
			"Tencent Hy3": "$300",
			"Tencent Hy4 Preview": "$300"
		};
		const COMMANDCODE_GOAT_RAW = {
			"Ling 3.1 Flash": "$100",
			"DeepSeek V4.1 Flash": "$80",
			"GLM-5.3 Flash": "$80",
			"GLM-5.2": "$70",
			"Tencent Hy3": "$70",
			"Qwen 3.8 27B": "$70",
			"DeepSeek V4 Flash": "$60",
			"DeepSeek V4.1 Flash Fast": "$60",
			"Kimi K2.7 Code": "$60",
			"LongCat 2.0": "$50",
			"MiniMax M3": "$47",
			"Gemini 3.8 Flash": "$40",
			"Qwen 3.7 Max": "$33",
			"Qwen 3.7 Plus": "$33",
			"Qwen 3.6 Plus": "$33",
			"MiMo V2.5": "$30",
			"GPT-5.6 Sol": "$20",
			"GPT-5.6 Luna": "$20",
			"Qwen 3.8 Max": "$20",
			"Mistral Large 4": "$20",
			"DeepSeek V4 Pro": "$20",
			"MiMo V2.5 Pro": "$20",
			"Claude Sonnet 5.5": "$10",
			"Claude Haiku 5.5": "$20",
			"Kimi K3": "$20",
			"GPT-6 Luna": "$20",
			"Qwen 3.8 Omni Flash": "$20",
			"Qwen 3.8 Max Prime": "$20",
			"Qwen 3.8 Max 0902": "$20",
			"Tencent Hy4 Preview": "$20",
			"MiniMax M3.1 Flash": "$20",
			"Ornith 1.5 122B": "$20",
			"Qwen 3.8 Flash": "$20",
			"GLM-5.3 FlashX": "$20",
			"DeepSeek V4 Flash Vision (exp)": "$20",
			"DeepSeek V4 Flash Fast": "$20",
			"GLM-5.3": "$20",
			"Muse Spark 1.3": "$20",
			"Muse Spark 1.3 Contributor": "$20",
			"Muse Spark 1.2": "$20",
			"Muse Spark 1.2 Contributor": "$20",
			"Muse Spark Open": "$20",
			"Kimi K2.7 Code HighSpeed": "$20",
			"Grok 4.5": "$20",
			"Grok 4.6": "$20",
			"Grok 4.7": "$20",
			"Gemini 3.7 Flash": "$40",
			"GLM-5.2 Fast": "$20",
			"Inkling": "$20",
			"Inkling Small": "$20",
			"MiMo V2.6 Pro": "$20",
			"MiMo V2.6 Flash": "$20",
			"MiMo V2.6 Pro UltraSpeed": "$10",
			"Step 5 Preview": "$20",
			"Step 3.7 Flash": "$20",
			"Step 3.5 Flash": "$20",
			"Nemotron 3 Ultra": "$20",
			"Nemotron 3.5 Super VL": "$20",
			"Jev": "$20",
			"Jev 1.14.0": "$20"
		};
		/**
		* Command Code 的**五档**逐模型额度（官方 pricing 页的 `Usage` 表，抓于 2026-10-21）。
		*
		* 只覆盖 7 个开源模型 —— 它比不上面的 GOAT 表全，但它是唯一给出 Go / Pro / Max 各档
		* 数字的来源，所以保留。查表时 **GOAT 优先用 {@link COMMANDCODE_GOAT_RAW}**，
		* 其余档位才落到这张表。
		*
		* 官方原文里 `Free` 表示「容量期内不扣 credits」；`~$` 是官方自己标了约等号。
		*/
		const COMMANDCODE_RAW = {
			"MiniMax M3": [
				"$8",
				"$47",
				"$57",
				"~$300",
				"~$600"
			],
			"MiMo V2.5": [
				"~$60",
				"~$100",
				"~$150",
				"~$750",
				"~$1,500"
			],
			"Laguna S 2.1": [
				"Free",
				"Free",
				"Free",
				"Free",
				"Free"
			],
			"Glyph Cluster": [
				"Free",
				"Free",
				"Free",
				"Free",
				"Free"
			],
			"Beam 1.0": [
				"Free",
				"Free",
				"Free",
				"Free",
				"Free"
			],
			"MiniMax M3.1 Flash": [
				"Free",
				"Free",
				"Free",
				"Free",
				"Free"
			],
			"Ornith 1.5 122B": [
				"Free",
				"Free",
				"Free",
				"Free",
				"Free"
			]
		};
		/** Command Code 在表里的五档套餐键（与 `plans.ts` 的展示名一致，小写）。 */
		const COMMANDCODE_PLAN_ORDER = [
			"go",
			"goat",
			"pro",
			"max10x",
			"max20x"
		];
		/**
		* OpenCode 的逐模型额度（官方公开页 `https://opencode.ai/go` 的 `Monthly usage` 列，
		* 抓于 2026-10-21）。
		*
		* 列顺序 = Go / Go Plus 两档（官网表格每行前一组是 5 小时请求数、后一组是月度额度，
		* 这里只取后一组）。`∞` 是官方原文：免费模型不计额度。
		*
		* **注意**：opencode 的额度接口（`usage.rolling` / `weekly` / `monthly`）**不上报套餐名**，
		* 所以查表时调用方传进来的档位可能为空 —— 那时用 Go（$10/月，官网的默认档）兜底。
		*/
		const OPENCODE_RAW = {
			"Kimi K3": ["$15", "$60"],
			"Gemini 4 Argon Contributor": ["$30", "$60"],
			"Kimi K2.7 Code": ["$60", "$180"],
			"Step 5 Preview": ["$15", "$60"],
			"MiniMax M3": ["$60", "$180"],
			"Claude Haiku 5.5": ["$15", "$60"],
			"GPT 6 Luna": ["$15", "$60"],
			"Qwen3.7 Plus": ["$60", "$180"],
			"GLM-5.3-Flash": ["$60", "$180"],
			"MiMo-V2.6-Flash": ["$60", "$120"],
			"DeepSeek V4.1 Flash": ["$80", "$160"],
			"Muse Spark 1.3 Contributor": ["$60", "$120"],
			"LongCat 2.5 Preview": ["Free", "Free"],
			"MiniMax M3.1 Flash": ["Free", "Free"],
			"Beam": ["Free", "Free"]
		};
		/** OpenCode 在表里的两档套餐键。 */
		const OPENCODE_PLAN_ORDER = ["go", "goplus"];
		/**
		* Open Design 的逐模型额度（官方 `Design Plan usage` 表，抓于 2026-10-21）。
		*
		* 表头的「每月使用额度」是**该套餐额度池里分给这个模型的份额**（不是套餐价格）：
		* 官网 zh/model-credits 页把套餐构成写得很清楚 ——
		* Go 原价 $10/月、每月最高总额度 $120、7 天窗口 $30、5 小时窗口 $10。
		* 所以 `go` 这一列的数字（如 DeepSeek V4.1 Flash = $120）与套餐总额度同量级是对的。
		*
		* 三列 = Go / Plus / Pro。**Max 列官方页面是空的**，所以这里也没有 —— 不猜。
		*/
		const OPENDESIGN_RAW = {
			"GLM-5.3 Flash-X": [
				"$30",
				"$40",
				"$90"
			],
			"DeepSeek V4 Pro": [
				"$60",
				"$80",
				"$180"
			],
			"Kimi K2.7 Code": [
				"$60",
				"$80",
				"$180"
			],
			"Hunyuan H4 Preview": [
				"$60",
				"$80",
				"$180"
			],
			"Claude Haiku 5.5": [
				"$30",
				"$40",
				"$90"
			],
			"GPT-6 Luna": [
				"$15",
				"$20",
				"$45"
			],
			"GLM-5.3 Flash": [
				"$60",
				"$80",
				"$180"
			],
			"DeepSeek V4 Flash Vision Exp": [
				"$60",
				"$80",
				"$180"
			],
			"MiMo V2.6 Pro": [
				"$60",
				"$80",
				"$180"
			],
			"DeepSeek V4 Flash": [
				"$60",
				"$80",
				"$180"
			],
			"MiMo V2.6 Flash": [
				"$60",
				"$80",
				"$180"
			],
			"DeepSeek V4.1 Flash": [
				"$120",
				"$160",
				"$360"
			]
		};
		/** Open Design 在表里的套餐键。 */
		const OPENDESIGN_PLAN_ORDER = [
			"go",
			"plus",
			"pro"
		];
		/**
		* 把「模型 → 各套餐原始字符串」的紧凑表展开成按套餐索引的查表结构。
		* @param raw - 官方表格的逐行原文。
		* @param planOrder - 列顺序对应的套餐键。
		* @returns `套餐键 → (归一化模型名 → 额度)`。
		*/
		function expand(raw, planOrder) {
			const table = {};
			for (const plan of planOrder) table[plan] = {};
			for (const [model, cells] of Object.entries(raw)) {
				const key = normalizeModelKey(model);
				if (key === "") continue;
				cells.forEach((cell, index) => {
					const plan = planOrder[index];
					if (plan === void 0) return;
					const amount = amountOf(cell);
					if (amount === void 0) return;
					table[plan][key] = amount;
				});
			}
			return table;
		}
		/** 把「模型 → 单个额度字符串」的单档表展开（只有一列数字的表用）。 */
		function expandSingle(raw) {
			const bucket = {};
			for (const [model, cell] of Object.entries(raw)) {
				const key = normalizeModelKey(model);
				if (key === "") continue;
				const amount = amountOf(cell);
				if (amount !== void 0) bucket[key] = amount;
			}
			return bucket;
		}
		/**
		* Command Code 的查表结构。
		*
		* **GOAT 合并两张表**，不是覆盖：
		* - `docs/plans/goat` 的 60 行完整表（含闭源模型，用户实际在用的数据）；
		* - pricing 页那 7 行表里的 `goat` 列 —— 它标了 `Free` 的那几个模型
		*   （Beam 1.0 / Glyph Cluster / Laguna S 2.1）在 docs 页的 `Monthly credits`
		*   表里**没有对应行**（它们不扣额度，所以不列额度数字）。
		*
		* 2026-10-21 踩过：一开始写成 `{ ...expand(RAW), goat: expandSingle(GOAT_RAW) }`，
		* 整桶覆盖导致那 3 个 Free 模型消失 —— 界面上从「免费」变成空白。
		* 合并顺序：完整表在前、Free 兜底在后（后者的 `Free` 只补前者缺的键）。
		*/
		const COMMANDCODE_MODEL_QUOTA = (() => {
			const fiveTier = expand(COMMANDCODE_RAW, COMMANDCODE_PLAN_ORDER);
			const merge = (plan, full) => ({
				...fiveTier[plan] ?? {},
				...expandSingle(full)
			});
			return {
				...fiveTier,
				go: merge("go", COMMANDCODE_GO_RAW),
				goat: merge("goat", COMMANDCODE_GOAT_RAW),
				pro: merge("pro", COMMANDCODE_PRO_RAW),
				max10x: merge("max10x", COMMANDCODE_MAX10_RAW),
				max20x: merge("max20x", COMMANDCODE_MAX20_RAW)
			};
		})();
		/** Open Design 的查表结构。 */
		const OPENDESIGN_MODEL_QUOTA = expand(OPENDESIGN_RAW, OPENDESIGN_PLAN_ORDER);
		/** OpenCode 的查表结构（只能区分 Go / Go Plus 两档）。 */
		const OPENCODE_MODEL_QUOTA = expand(OPENCODE_RAW, OPENCODE_PLAN_ORDER);
		/**
		* Command Code **GOAT 套餐**包含的全部模型（官方 `docs/plans/goat` 的
		* 「Models included」表，抓于 2026-10-21，共 71 个唯一名字）。
		*
		* 官方原话：「Every model below is included on the GOAT plan」；同页还写着
		* 「The rest of the premium lineup needs Pro or Max」—— 所以不在这张表里的模型
		* （如 Claude Opus 系列）在 GOAT 下确实不可用。
		*/
		const COMMANDCODE_GOAT_MODELS = [
			"Beam 1.0",
			"Claude Haiku 5.5",
			"Claude Sonnet 5.5",
			"DeepSeek V4 Flash",
			"DeepSeek V4 Flash Fast",
			"DeepSeek V4 Flash Vision",
			"DeepSeek V4 Pro",
			"DeepSeek V4.1 Flash",
			"DeepSeek V4.1 Flash Fast",
			"Gemini 3.7 Flash",
			"Gemini 3.8 Flash",
			"GLM-5",
			"GLM-5.1",
			"GLM-5.2",
			"GLM-5.2 Fast",
			"GLM-5.3",
			"GLM-5.3 Flash",
			"GLM-5.3 FlashX",
			"Glyph Cluster",
			"GPT-5.6 Luna",
			"GPT-5.6 Sol",
			"GPT-6 Luna",
			"Grok 4.5",
			"Grok 4.6",
			"Grok 4.7",
			"Inkling",
			"Inkling Small",
			"Jev",
			"Jev 1.14.0",
			"Kimi K2.5",
			"Kimi K2.6",
			"Kimi K2.7 Code",
			"Kimi K2.7 Code HighSpeed",
			"Kimi K3",
			"Laguna S 2.1",
			"Ling 3.1 Flash",
			"LongCat 2.0",
			"MiMo V2.5",
			"MiMo V2.5 Pro",
			"MiMo V2.6 Flash",
			"MiMo V2.6 Pro",
			"MiMo V2.6 Pro UltraSpeed",
			"MiniMax M2.5",
			"MiniMax M2.7",
			"MiniMax M3",
			"MiniMax M3.1 Flash",
			"Mistral Large 4",
			"Muse Spark 1.2",
			"Muse Spark 1.2 Contributor",
			"Muse Spark 1.3",
			"Muse Spark 1.3 Contributor",
			"Muse Spark Open",
			"Nemotron 3 Ultra",
			"Nemotron 3.5 Super VL",
			"Ornith 1.5 122B",
			"Qwen 3.6 Max Preview",
			"Qwen 3.6 Plus",
			"Qwen 3.7 Flash",
			"Qwen 3.7 Max",
			"Qwen 3.7 Plus",
			"Qwen 3.8 27B",
			"Qwen 3.8 Flash",
			"Qwen 3.8 Max",
			"Qwen 3.8 Max 0902",
			"Qwen 3.8 Max Prime",
			"Qwen 3.8 Omni Flash",
			"Step 3.5 Flash",
			"Step 3.7 Flash",
			"Step 5 Preview",
			"Tencent Hy3",
			"Tencent Hy4 Preview"
		];
		/** 把一串官方展示名转成归一化键的集合。 */
		function keySetOf(names) {
			const set = /* @__PURE__ */ new Set();
			for (const name of names) {
				const key = normalizeModelKey(name);
				if (key !== "") set.add(key);
			}
			return set;
		}
		/** Command Code 各档位的可用模型集合。目前只有 GOAT 有官方完整清单。 */
		const COMMANDCODE_PLAN_MODELS = { goat: keySetOf(COMMANDCODE_GOAT_MODELS) };
		/**
		* 某个模型是否在指定套餐的可用清单里。
		*
		* 三档结论：
		* - `true`：在清单里，可以显示；
		* - `false`：**明确不在**清单里，应当隐藏；
		* - `undefined`：这家厂商/这个档位没有官方清单（不知道），**不要隐藏** ——
		*   没有依据就藏模型会让用户以为功能坏了。
		* @param table - 该厂商的可用模型集合。
		* @param planName - 套餐展示名。
		* @param modelName - 模型 id 或展示名。
		* @returns 是否可用；没有该档清单时 `undefined`。
		*/
		function modelAvailableIn(table, planName, modelName) {
			if (planName === void 0) return void 0;
			const plan = planKeyOf(planName);
			if (plan === void 0) return void 0;
			const set = table[plan];
			if (set === void 0) return void 0;
			return set.has(normalizeModelKey(modelName));
		}
		/**
		* 从套餐展示名（`GOAT` / `Go` / `Max 10×` / `Plus`…）得到查表用的套餐键。
		*
		* 官方名字带空格与 `×`（`Max 10×`），表里用 `max10x` 这种紧凑写法；大小写与空格的
		* 差异不该让整行数据消失，所以这里统一归一化。
		* @param planName - 套餐展示名（`QuotaPlanSummary.name` 或 `id`）。
		* @returns 套餐键；认不出时 `undefined`（不猜）。
		*/
		function planKeyOf(planName) {
			const key = planName.toLowerCase().replace(/[×✕x]/g, "x").replace(/[\s_-]+/g, "").trim();
			if (key === "") return void 0;
			if (key === "go" || key === "goat" || key === "pro" || key === "plus") return key;
			if (key === "goplus") return "goplus";
			if (key === "max10x" || key === "max20x") return key;
		}
		/**
		* 查一个模型在某个套餐下的额度。
		*
		* 返回 `undefined` 的三种情况都**不该显示任何数字**：套餐认不出、模型不在表里、
		* 该组合官方没给数据。这与「额度缺失不倒成 0」是同一条纪律。
		* @param table - 该厂商的表。
		* @param planName - 套餐展示名。
		* @param modelName - 模型 id 或展示名。
		* @returns 额度；查不到时 `undefined`。
		*/
		function modelQuotaOf(table, planName, modelName) {
			if (planName === void 0) return void 0;
			const plan = planKeyOf(planName);
			if (plan === void 0) return void 0;
			const bucket = table[plan];
			if (bucket === void 0) return void 0;
			return bucket[normalizeModelKey(modelName)];
		}
		/**
		* 厂商行 id → 该厂商的额度表。
		*
		* **为什么用显式映射而不是子串匹配**：以前写的是
		* `vendor.includes("opendesign") ? … : vendor.includes("opencode") ? …`，
		* 靠顺序侥幸不出错 —— 但 `opendesign` 与 `opencode` 共享 `openc` 前缀，一旦将来出现
		* 一个同时含两者的 id（或顺序被调整），就会静默查错表，界面上显示的是**另一家**的额度。
		* 这种错误不会报错、只会显示错数字，是最难发现的一类。
		*
		* 表里没有的 id 返回 `undefined`（不猜），调用方据此不显示额度。
		* @param vendorId - 厂商行 id（`commandcode` / `dsh-opencode-go` / `opendesign`）。
		* @returns 对应的额度表；认不出时 `undefined`。
		*/
		function quotaTableOf(vendorId) {
			const id = vendorId.trim().toLowerCase();
			if (id === "commandcode") return COMMANDCODE_MODEL_QUOTA;
			if (id === "opendesign") return OPENDESIGN_MODEL_QUOTA;
			if (id === "dsh-opencode-go" || id === "opencode" || id === "opencode-go") return OPENCODE_MODEL_QUOTA;
		}
		/**
		* 厂商行 id → 该厂商的「套餐包含哪些模型」清单。
		* @param vendorId - 厂商行 id。
		* @returns 可用模型清单；该厂商没有官方清单时 `undefined`。
		*/
		function planModelsOf(vendorId) {
			return vendorId.trim().toLowerCase() === "commandcode" ? COMMANDCODE_PLAN_MODELS : void 0;
		}
		//#endregion
		//#region src/client/duration.ts
		/**
		* 「额度评估间隔」的时长换算：分钟是存储单位，页面按天/小时/分钟展示。
		*
		* 规则（需求）：最大 30 天；分钟满 60 进小时，小时满 24 进天；超过 30 天夹到 30 天。
		* 纯函数，页面与测试共用；不碰设置文档。
		* @module dsh-llm-account/src/client/duration
		*/
		/** 30 天，单位分钟。 */
		const MAX_DURATION_MINUTES = 43200;
		/** 把任意值夹成 0..MAX 的整数分钟。 */
		function clampDuration(value) {
			return Math.min(MAX_DURATION_MINUTES, Math.max(0, typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0));
		}
		/**
		* 分钟 → 天/小时/分钟（自动进位；超过 30 天夹到 30 天 0 小时 0 分）。
		* @param value - 存储的分钟数。
		* @returns 展示用三段值。
		*/
		function durationPartsOf(value) {
			const total = clampDuration(value);
			return {
				days: Math.floor(total / 24 / 60),
				hours: Math.floor(total % 1440 / 60),
				minutes: total % 60
			};
		}
		/**
		* 天/小时/分钟 → 分钟（小时/分钟可超界，自动进位；负数按 0；总时长夹到 30 天）。
		* @param parts - 三段值。
		* @returns 存储用分钟数。
		*/
		function minutesOfDurationParts(parts) {
			const number = (value) => typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
			return clampDuration(number(parts.days) * 24 * 60 + number(parts.hours) * 60 + number(parts.minutes));
		}
		//#endregion
		//#region src/client/registry.ts
		/**
		* 这种控件「改了就存」还是「留在草稿里等卡片上的保存按钮」。
		*
		* 需求 的两条要求合起来是这一条规则：
		* 1. 「任何选项修改了就是直接保存，不需要那个保存按钮了」→ 开关/下拉：一次点击就是完整决定；
		* 2. 「输入框那个…一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」
		*    → 文本/数字/时长：键盘输入是**过程**不是决定，所以留在草稿里，由**所在卡片**的保存按钮
		*    提交；没有未保存输入时那个按钮根本不渲染。
		*
		* 为什么输入类不能每敲一个字符就写：(a) 中间态会进设置文档（`https://` 会短暂成为生效值）；
		* (b) 打字比一次往返快得多，后一次写入拿着过期修订号，会撞上自己刚写出来的冲突。
		*
		* 放在注册表旁边：这是「控件语义」，不是某个页面的排版选择。
		* @param kind - 字段的控件种类。
		* @returns 是否改了就立刻写入设置文档。
		*/
		function savesImmediately(kind) {
			return kind === "boolean" || kind === "select";
		}
		/** Registrations keyed by settings namespace: a namespace names exactly one vendor. */
		const vendorRegistry = /* @__PURE__ */ new Map();
		/**
		* Register (or update) one vendor. Idempotent by `ns`: a namespace maps to one
		* vendor, so re-registering the same vendor never produces a duplicate entry.
		* @param entry - the vendor metadata.
		*/
		function registerVendor(entry) {
			vendorRegistry.set(entry.ns, entry);
		}
		//#endregion
		//#region src/client/update-check.ts
		/**
		* 插件自身的**更新检查**。
		*
		* ## 为什么不是「一个更新按钮」那么简单
		*
		* 宿主侧有一个公开的更新 API（`dshmarket` 的 `/dsh-market/api/v1/*`，见该包的
		* `UPDATE-API-V1.md`）。但它**只对「从仓库/npm 装」的包有意义**：实测本机
		*
		* ```
		* GET /dsh-market/api/v1/updates?name=dsh-llm-account&force=1
		* → { "package": { "source": "linked", "installedVersion": "0.1.0",
		*                  "latestVersion": null, "updateAvailable": false } }
		* ```
		*
		* `source: "linked"` 表示这个 profile 行是指向源码目录的符号链接（开发模式）——
		* 那种安装**永远不会有更新**：它跟着源码走，改代码刷新页面就生效。
		*
		* 所以本模块的职责是：**如实区分三种状态**，而不是一律画一个「更新」按钮：
		*
		* | source | 含义 | 界面该说什么 |
		* | --- | --- | --- |
		* | `linked` | 本地链接/开发模式 | 不会更新，说明原因（不要给假按钮） |
		* | `npm`/`git` 等 | 可更新 | 有新版本就显示「更新」 |
		* | 查不到 | 市场缺席 / 该版本没有这个 API | 说明查不到，不猜 |
		*
		* ## 为什么走宿主 HTTP 而不是 `ctx` 服务
		*
		* 更新 API 是**同源 HTTP 接口**（浏览器里 fetch 自带 DSH 的会话 cookie）。宿主没有为它
		* 暴露 cordis 服务，所以客户端只能用 `fetch`。这也是 API 文档给插件 UI 的用法。
		*
		* @module dsh-llm-account/src/client/update-check
		*/
		/** 本包在宿主上的名字（更新 API 的 `name` 参数）。 */
		const UPDATE_PACKAGE = "dsh-llm-account";
		/**
		* 本插件的**真实版本号**（构建期由 `tsdown.config.ts` 的 `define` 烧进来）。
		*
		* 为什么不从更新接口取：那个接口只暴露 commit SHA、不暴露版本号 ——
		* `routes.js` 里是 `installedVersion: update.current ?? update.version`，
		* 而 `current` 是 git commit 且**优先**。所以 git 安装时界面上只能拿到一串 SHA
		*。
		*
		* 客户端 bundle 跑在浏览器里读不到 `package.json`，所以只能构建期注入。
		*/
		const PLUGIN_VERSION = "1.5.2";
		/** 市场更新 API 的版本化前缀（文档：`dsh-market/update-api/v1`）。 */
		const MARKET_API = "/dsh-market/api/v1";
		/** 从响应里取 `package` 对象（形状不可信，逐项校验）。 */
		function packageOf(payload) {
			if (typeof payload !== "object" || payload === null) return void 0;
			const pkg = payload.package;
			if (typeof pkg !== "object" || pkg === null) return void 0;
			return pkg;
		}
		/** 把 `source` 归一成小写字符串。 */
		function sourceOf(pkg) {
			return typeof pkg.source === "string" ? pkg.source.trim().toLowerCase() : "";
		}
		/**
		* 哪些 `source` 意味着「这种安装不会通过更新按钮变化」。
		*
		* `linked` 是实测到的（junction / symlink 到源码目录）。`file` 同理（本地路径安装）。
		*/
		const NON_UPDATABLE_SOURCES = /* @__PURE__ */ new Set([
			"linked",
			"file",
			"directory",
			"workspace"
		]);
		/**
		* 把一次 `/updates` 响应翻成界面能直接用的结论（纯函数，便于单测）。
		*
		* 判断顺序有意为之：先看「这种安装能不能更新」，再看有没有新版 —— 否则一个链接安装
		* 会显示成「已是最新」，而那是**错的**（它根本不是「更新」这条路）。
		* @param payload - 已解析的 JSON。
		* @returns 更新结论。
		*/
		function updateStateOf(payload) {
			const pkg = packageOf(payload);
			if (pkg === void 0) return {
				kind: "unknown",
				reason: "更新接口没有返回 package 字段"
			};
			const source = sourceOf(pkg);
			const installed = typeof pkg.installedVersion === "string" ? pkg.installedVersion : "";
			const latest = typeof pkg.latestVersion === "string" ? pkg.latestVersion : "";
			if (NON_UPDATABLE_SOURCES.has(source)) return {
				kind: "not-applicable",
				installed,
				source
			};
			if (pkg.updateAvailable === true && latest !== "") return {
				kind: "available",
				installed,
				latest,
				source
			};
			if (pkg.updateAvailable === false && installed !== "") return {
				kind: "current",
				installed,
				source
			};
			return {
				kind: "unknown",
				reason: `更新接口的回答不认识（source=${source || "?"}）`
			};
		}
		/**
		* 问宿主要一次更新结论。
		*
		* 失败一律归 `unknown` 并带上可读原因：**更新检查失败不该看起来像「已是最新」**——
		* 那会让用户以为没有新版本（与额度「缺数据不补 0」同一条纪律）。
		* @param deps - 注入点。
		* @returns 更新结论。
		*/
		async function checkForUpdate(deps = {}) {
			const doFetch = deps.fetchImpl ?? globalThis.fetch;
			if (doFetch === void 0) return {
				kind: "unknown",
				reason: "这个环境没有 fetch"
			};
			let response;
			try {
				response = await doFetch(`${MARKET_API}/updates?name=${encodeURIComponent(UPDATE_PACKAGE)}&force=1`, {
					method: "GET",
					credentials: "same-origin",
					headers: { accept: "application/json" }
				});
			} catch (error) {
				return {
					kind: "unknown",
					reason: error instanceof Error ? error.message : String(error)
				};
			}
			if (!response.ok) return {
				kind: "unknown",
				reason: response.status === 404 ? "这个宿主没有插件更新接口" : `更新检查失败（HTTP ${response.status}）`
			};
			try {
				return updateStateOf(await response.json());
			} catch (error) {
				return {
					kind: "unknown",
					reason: error instanceof Error ? error.message : String(error)
				};
			}
		}
		/**
		* 从 202 回执里取 `operationId`，**两种形状都认**。
		*
		* 官方文档（`UPDATE-API-V1.md`）只说「返回 202 并带一个 operationId」，没说包在哪儿；
		* 而宿主实际实现（`dshmarket` 的 `routes.ts`）把它**包在 `operation` 里**：
		*
		* ```json
		* { "schema": "dsh-market/update-api/v1",
		*   "operation": { "operationId": "boot-update-1", "state": "running", ... } }
		* ```
		*
		* 2026-10-21 实际情况「查不到更新信息：宿主接受了请求但没有给出 operationId」就是
		* 只看顶层导致的：请求其实**成功了**，操作也在跑，只是 id 没被取到，界面据此判定失败，
		* 于是更新永远点不动。
		*
		* 顶层形状保留着，因为文档字面上允许它，且别的兼容实现可能真的那么回（客户端要独立校验，
		* 见文档「Provider clients should still compare...」那段的精神）。
		* @param payload - 已解析的 202 响应体。
		* @returns 操作 id；取不到时 `undefined`。
		*/
		function operationIdOf(payload) {
			if (typeof payload !== "object" || payload === null) return void 0;
			const top = payload.operationId;
			if (typeof top === "string" && top !== "") return top;
			const operation = payload.operation;
			if (typeof operation !== "object" || operation === null) return void 0;
			const nested = operation.operationId;
			return typeof nested === "string" && nested !== "" ? nested : void 0;
		}
		/**
		* 发起一次更新（**会真的改动 profile**）。
		*
		* 只在用户点「更新」时调用。返回 `operationId` 供轮询；失败给可读原因。
		* @param deps - 注入点。
		* @returns 操作 id，或失败原因。
		*/
		async function startUpdate(deps = {}) {
			const doFetch = deps.fetchImpl ?? globalThis.fetch;
			if (doFetch === void 0) return {
				ok: false,
				reason: "这个环境没有 fetch"
			};
			try {
				const response = await doFetch(`${MARKET_API}/updates`, {
					method: "POST",
					credentials: "same-origin",
					headers: {
						"content-type": "application/json",
						accept: "application/json"
					},
					body: JSON.stringify({ packageName: UPDATE_PACKAGE })
				});
				if (!response.ok) return {
					ok: false,
					reason: `请求被拒绝（HTTP ${response.status}）`
				};
				const id = operationIdOf(await response.json());
				return id !== void 0 ? {
					ok: true,
					operationId: id
				} : {
					ok: false,
					reason: "宿主接受了请求但没有给出 operationId"
				};
			} catch (error) {
				return {
					ok: false,
					reason: error instanceof Error ? error.message : String(error)
				};
			}
		}
		/**
		* 查一次更新操作的进度。
		* @param operationId - `startUpdate` 给的回执。
		* @param deps - 注入点。
		* @returns 进度；查询本身失败时 `state: "unknown"`。
		*/
		async function pollUpdate(operationId, deps = {}) {
			const doFetch = deps.fetchImpl ?? globalThis.fetch;
			if (doFetch === void 0) return { state: "unknown" };
			try {
				const response = await doFetch(`${MARKET_API}/operations?operationId=${encodeURIComponent(operationId)}`, {
					method: "GET",
					credentials: "same-origin",
					headers: { accept: "application/json" }
				});
				if (!response.ok) return { state: "unknown" };
				const payload = await response.json();
				const op = typeof payload === "object" && payload !== null ? payload.operation ?? payload : void 0;
				if (typeof op !== "object" || op === null) return { state: "unknown" };
				const record = op;
				const raw = typeof record.state === "string" ? record.state : "";
				return {
					state: [
						"queued",
						"running",
						"succeeded",
						"failed",
						"cancelled",
						"rolled-back"
					].includes(raw) ? raw : "unknown",
					...typeof record.code === "string" ? { code: record.code } : {},
					...typeof record.message === "string" ? { message: record.message } : {},
					...record.refreshRequired === true ? { refreshRequired: true } : {}
				};
			} catch {
				return { state: "unknown" };
			}
		}
		//#endregion
		//#region src/client/settings-cards.ts
		/**
		* 四张卡片的声明（顺序即渲染顺序）。
		*
		* 分组依据是「用户在哪一刻需要它」，不是技术分层：
		* - 显示 → 「侧边栏上我能看到什么」
		* - 切换 → 「账号/模型什么时候换」
		* - 搜索 → 「联网搜索怎么走」
		* - 高级 → 「端点、超时、上限」（平时不动）
		*/
		const SETTINGS_CARDS = [
			{
				id: "display",
				labelKey: "card.display",
				hintKey: "card.display.hint",
				shared: ["showSidebarQuota", "quotaRefreshMinutes"],
				specific: []
			},
			{
				id: "switching",
				labelKey: "card.switching",
				hintKey: "card.switching.hint",
				shared: [
					"autoSwitchModelOnQuota",
					"autoContinue",
					"autoContinueMaxAttempts",
					"autoContinueIntervalMs"
				],
				specific: []
			},
			{
				id: "search",
				labelKey: "card.search",
				hintKey: "card.search.hint",
				shared: ["searchStrategy"],
				specific: []
			},
			{
				id: "advanced",
				labelKey: "card.advanced",
				hintKey: "card.advanced.hint",
				shared: ["requestTimeoutMs", "streamIdleTimeoutMs"],
				specific: [
					{
						key: "apiBase",
						vendor: "commandcode"
					},
					{
						key: "protocol",
						vendor: "commandcode"
					},
					{
						key: "defaultMaxTokens",
						vendor: "commandcode"
					},
					{
						key: "baseURL",
						vendor: "dsh-opencode-go"
					},
					{
						key: "baseURL",
						vendor: "opendesign"
					},
					{
						key: "workspaceId",
						vendor: "opendesign"
					},
					{
						key: "walletBase",
						vendor: "opendesign"
					}
				]
			}
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
		//#endregion
		//#region src/client/page.ts
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
		/**
		* 统一设置页的外壳：标题 / 简介 / 厂商标签页 / 当前厂商的卡片与保存条。
		*
		* 整个渲染包在一层错误边界里：React 会丢弃**整棵**已渲染的树，所以渲染期抛错在页面上
		* 表现为「这一段完全空白」——连标题都没有，与「没有可显示的厂商」那种有明确文案的空态
		* 完全不同，排查时极易误判成「没注册上」。这里把异常原样显示出来。
		* @param props - 见 {@link PageShellProps}。
		* @returns 元素树。
		*/
		function PageShell(props) {
			try {
				return pageBody(props);
			} catch (error) {
				return renderErrorPanel(error);
			}
		}
		/**
		* 「插件已更新，刷新页面即可」的提示条。
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
		function reloadNotice(props, t) {
			if (props.reloadHint !== true) return null;
			return (0, react.createElement)("div", {
				"data-reload-hint": "true",
				className: CSS_CLASS.notice
			}, (0, react.createElement)("strong", { className: CSS_CLASS.noticeTitle }, t("update.title")), (0, react.createElement)("small", null, t("update.body")), (0, react.createElement)("button", {
				type: "button",
				"data-reload-now": "true",
				className: `${CSS_CLASS.buttonPrimary} ${CSS_CLASS.buttonSm}`,
				onClick: () => props.onReload?.()
			}, t("update.action")));
		}
		/**
		* 「检查更新 / 更新」区块（需求：「希望加一个更新，这样有新版本的时候直接更新
		* 就可以，就不用每次卸载后重新装」）。
		*
		* 三种结论分别渲染，**尤其不把「链接安装」说成「已是最新」**：
		* 后者会让用户等一个永远不会来的按钮（那种装法跟着源码走，本来就没有「新版本」这回事）。
		* @param props - 页面属性。
		* @param t - 取词函数。
		* @returns 区块元素；容器没有提供更新状态时为 `null`（老宿主不渲染死按钮）。
		*/
		/**
		* 把更新接口给的版本值格式化成**给人看的样子**。
		*
		* 为什么需要它（2026-10-21 用户在新设备报障）：「不是版本号，是一串字符」——
		* 用户装的是 **git 仓库**，而 git 安装的 `latestVersion` 是**commit SHA**
		* （市场插件 `updates.js` 的 github 分支用 `resolveHeadCommit` 取值），
		* 于是无条件加的 `v` 前缀把 `032c5469b9c3adce…` 变成了 `v032c5469…`。
		*
		* 规则：
		* - 形如版本号（`1.2.3` / `1.2.3-beta.1` / 带 `v` 前缀）→ 补 `v` 并原样显示；
		* - 形如 commit（7–40 位十六进制）→ **截短到 7 位**、不加 `v`、前面标「提交」，
		*   让人一眼看出这是 git 提交而不是版本号；
		* - 其它（不该出现的形状）→ 原样显示，不猜。
		* @param value - 接口给的版本串（可能为空）。
		* @returns 给人看的文本；空值时 `undefined`。
		*/
		function formatVersionLabel(value) {
			if (value === void 0 || value.trim() === "") return void 0;
			const raw = value.trim();
			if (/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(raw)) return raw.startsWith("v") ? raw : `v${raw}`;
			if (/^[0-9a-f]{7,40}$/i.test(raw)) return `提交 ${raw.slice(0, 7)}`;
			return raw;
		}
		/**
		* 标题行右侧的**版本与更新**控件。
		*
		* 需求：「检查更新那个建议放到设置页最开头 LL 账号的最右边，检查完就提示是否有新版本，
		* 版本号多少，显示是否更新」。
		*
		* 版式（一行，从左到右）：`当前版本 v0.1.0` → 状态文字 → 动作按钮。
		*
		* - 未检查：`v0.1.0` + 「检查更新」
		* - 检查中：「正在检查…」（按钮禁用）
		* - 有新版本：`v0.1.0 → v0.2.0` + 「更新到新版本」
		* - 已最新：`v0.1.0` + 「已是最新」+ 仍保留「检查更新」以便手动重查
		* - 本地链接安装：如实说明它不会更新（跟着源码走），**不给假按钮**
		* - 查不到：`v0.1.0` + 「查不到更新信息：<原因>」
		*
		* `props.update` 为 `undefined` 时也要渲染（那是「还没查过」的初值）——
		* 早先这里直接 `return null`，导致整块永远不出现、用户根本没有入口。
		* @param props - 页面属性（用 `update` / `updateBusy` / `onCheckUpdate` / `onUpdate`）。
		* @param t - 取词函数。
		* @returns 控件元素；容器既没结论也没回调时才不渲染。
		*/
		function updateMeter(props, t) {
			const state = props.update;
			if (state === void 0 && props.onCheckUpdate === void 0) return null;
			const replace = (template, values) => template.replace(/\{(\w+)\}/g, (whole, name) => values[name] ?? whole);
			const installed = (() => {
				const fromInterface = state !== void 0 && "installed" in state && state.installed !== "" ? state.installed : void 0;
				return formatVersionLabel(fromInterface)?.startsWith("v") === true ? fromInterface : void 0;
			})() ?? "1.5.2";
			const canUpdate = state?.kind === "available";
			const latest = state?.kind === "available" ? state.latest : void 0;
			const installedText = formatVersionLabel(installed);
			const latestText = formatVersionLabel(latest);
			const versionText = installedText === void 0 ? void 0 : latestText === void 0 ? installedText : `${installedText} → ${latestText}`;
			const label = props.updateBusy === true ? t("update.checking") : state === void 0 ? "" : state.kind === "available" ? t("update.availableShort") : state.kind === "current" ? t("update.currentShort") : state.kind === "not-applicable" ? t("update.notApplicableShort") : replace(t("update.unknownShort"), { reason: state.reason });
			return (0, react.createElement)("div", {
				"data-update-meter": state?.kind ?? "unchecked",
				className: CSS_CLASS.updateMeter,
				title: state === void 0 ? t("update.notChecked") : state.kind === "available" ? replace(t("update.available"), {
					installed: installedText ?? state.installed,
					latest: latestText ?? state.latest
				}) : state.kind === "current" ? replace(t("update.current"), { installed: installedText ?? state.installed }) : state.kind === "not-applicable" ? replace(t("update.notApplicable"), { installed: installedText ?? state.installed }) : state.kind === "unknown" ? replace(t("update.unknown"), { reason: state.reason }) : ""
			}, versionText === void 0 ? null : (0, react.createElement)("span", {
				"data-update-version": state?.kind ?? "unchecked",
				className: CSS_CLASS.updateVersion
			}, versionText), label === "" ? null : (0, react.createElement)("span", {
				"data-update-state": state?.kind ?? "unchecked",
				className: CSS_CLASS.updateState
			}, label), canUpdate ? (0, react.createElement)("button", {
				type: "button",
				"data-update-start": "true",
				className: `${CSS_CLASS.buttonPrimary} ${CSS_CLASS.buttonSm}`,
				disabled: props.updateBusy === true,
				onClick: () => props.onUpdate?.()
			}, props.updateBusy === true ? t("update.starting") : t("update.start")) : (0, react.createElement)("button", {
				type: "button",
				"data-update-check": "true",
				className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
				disabled: props.updateBusy === true,
				onClick: () => props.onCheckUpdate?.()
			}, t("update.check")));
		}
		/** 渲染失败时的兜底：**不调用 `t()`**（取词本身可能就是抛错的原因）。 */
		function renderErrorPanel(error) {
			const detail = error instanceof Error ? error.stack ?? error.message : String(error);
			return (0, react.createElement)("div", {
				"data-page": "llm-account",
				className: CSS_CLASS.root
			}, (0, react.createElement)("h1", null, "LLM 账号"), (0, react.createElement)("pre", {
				"data-render-error": "true",
				className: CSS_CLASS.diagnostic
			}, `render failed: ${detail}`));
		}
		/** 外壳本体（假定不抛；抛了由 {@link PageShell} 接住）。 */
		function pageBody(props) {
			const { state, entries, t } = props;
			const noVendor = !state.tabs.some((tab) => tab.ns !== FEATURE_TAB_NS);
			const vendors = entries;
			return (0, react.createElement)("div", {
				"data-page": "llm-account",
				className: CSS_CLASS.root
			}, (0, react.createElement)("header", { className: CSS_CLASS.header }, (0, react.createElement)("div", {
				"data-title-row": "true",
				className: CSS_CLASS.titleRow
			}, (0, react.createElement)("h1", null, t("title")), updateMeter(props, t)), (0, react.createElement)("p", {
				"data-intro": "true",
				className: CSS_CLASS.intro
			}, t("intro"))), reloadNotice(props, t), props.accounts === void 0 ? null : props.accounts, noVendor ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)("p", {
				"data-empty": "vendor",
				className: CSS_CLASS.empty
			}, t("empty.noVendor")), state.discovery === void 0 ? null : (0, react.createElement)("pre", {
				"data-discovery": state.discovery.kind,
				className: CSS_CLASS.diagnostic
			}, `${state.discovery.kind}: ${state.discovery.detail}`)) : null, ...SETTINGS_CARDS.map((card) => settingsCardElement(props, vendors, card)));
		}
		/**
		* 一张功能卡片：把三家（以及功能页）里属于这张卡的字段**合并去重**后渲染。
		*
		* 形状：
		* 1. 共有字段只渲染**一次**（三家同名同义，写回时会镜像）；
		* 2. `specific` 字段只渲染它归属的那一家，并标注厂商徽标；
		* 3. 没有卡片级开关 —— 收起/展开由 `<details>` 的箭头负责（2026-10-20 需求去掉
		*    「启用自动切换 / 开启网页搜索」两个界面开关：卡片本来就能收起，多一个开关反而
		*    让人误以为关掉会禁用功能）。
		* @param props - 页面属性。
		* @param vendors - 参与合并的厂商行（含功能页，它的值代表承载行）。
		* @param card - 卡片声明。
		* @returns 可折叠卡片元素。
		*/
		function settingsCardElement(props, vendors, card) {
			const { t } = props;
			const nodes = [];
			/** 在合并后的厂商列表里找某个共有字段的声明（取第一家）。 */
			const sharedField = (key) => {
				for (const entry of vendors) {
					const field = fieldsOf(props.state, entry).find((candidate) => candidate.spec.key === key);
					if (field !== void 0) return {
						owner: entry,
						field
					};
				}
			};
			for (const key of card.shared) {
				const found = sharedField(key);
				if (found === void 0) continue;
				nodes.push(fieldElement(props, found.owner, found.field));
			}
			for (const vendor of vendors) for (const field of fieldsOf(props.state, vendor)) {
				if (card.specific.find((item) => item.key === field.spec.key && item.vendor === vendor.providerId) === void 0) continue;
				nodes.push(fieldElement(props, vendor, field, labelOf(props, vendor)));
			}
			if (card.id === "search") nodes.push(secretBlockOf(props, vendors));
			const saveBar = cardSaveBar(props, card, pendingSavesOf(props, vendors, card));
			if (saveBar !== null) nodes.push(saveBar);
			for (const item of cardErrorsOf(props, vendors, card)) nodes.push((0, react.createElement)("small", {
				key: `save-error-${item.ns}`,
				"data-save-error": item.ns,
				"data-save-error-reason": item.error,
				className: CSS_CLASS.failure
			}, t("save.failed")));
			if (nodes.length === 0) return null;
			return (0, react.createElement)("details", {
				key: card.id,
				"data-card": card.id,
				...card.id === "advanced" ? {} : { open: true },
				className: CSS_CLASS.card
			}, (0, react.createElement)("summary", {
				className: CSS_CLASS.modelSummary,
				"data-card-collapse": card.id
			}, (0, react.createElement)("span", { className: CSS_CLASS.modelSummaryTitle }, t(card.labelKey)), (0, react.createElement)(ChevronIcon, null)), (0, react.createElement)("small", { className: CSS_CLASS.note }, t(card.hintKey)), ...nodes);
		}
		/** 厂商的展示名（用于「这一项只对某家生效」的标注）。 */
		function labelOf(props, entry) {
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
		function pendingSavesOf(props, vendors, card) {
			const out = [];
			for (const entry of vendors) {
				const draft = props.state.drafts[entry.ns];
				if (draft === void 0) continue;
				if (Object.keys(draft).some((key) => {
					const spec = specOf(props.state, entry.ns, key);
					if (spec === void 0 || savesImmediately(spec.kind)) return false;
					return cardCarries(card, vendors, entry, key);
				})) out.push({
					ns: entry.ns,
					label: labelOf(props, entry)
				});
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
		function cardCarries(card, vendors, entry, key) {
			if (card.shared.includes(key)) return vendors.find((candidate) => specOfFor(candidate, key) !== void 0)?.ns === entry.ns;
			return card.specific.some((declared) => declared.key === key && declared.vendor === entry.providerId);
		}
		/** 某一家是否声明了这个字段（与 `specOf` 同义，但只需要「有没有」，不需要状态）。 */
		function specOfFor(entry, key) {
			return fieldsOfKeys(entry).includes(key) ? true : void 0;
		}
		/** 一家声明过的全部字段名。 */
		function fieldsOfKeys(entry) {
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
		function cardErrorsOf(props, vendors, card) {
			const out = [];
			for (const entry of vendors) {
				const error = props.state.saveErrors[entry.ns];
				if (typeof error !== "string" || error === "") continue;
				const failed = props.state.saveErrorFields[entry.ns];
				if (failed !== void 0 && failed.length > 0 ? failed.some((key) => cardCarries(card, vendors, entry, key)) : isFirstCarryingCard(vendors, entry, card)) out.push({
					ns: entry.ns,
					error
				});
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
		function isFirstCarryingCard(vendors, entry, card) {
			const keys = fieldsOfKeys(entry);
			for (const candidate of SETTINGS_CARDS) if ([...candidate.shared, ...candidate.specific.map((item) => item.key)].some((key) => keys.includes(key) && cardCarries(candidate, vendors, entry, key))) return candidate.id === card.id;
			return false;
		}
		/**
		* 搜索密钥那一块：**输入框 + 添加按钮 + 已添加列表**。
		*
		* 需求：「只保留保存密钥那个，没添加一个就自动显示添加了一个，然后还可以点 x
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
		function secretBlockOf(props, vendors) {
			const save = props.onSaveSecret;
			if (save === void 0) return null;
			const { t } = props;
			const pick = (entry) => {
				const draft = props.state.drafts[entry.ns]?.["searchApiKeyRefs"];
				return draft !== void 0 ? draft : props.state.snapshots[entry.ns]?.value?.["searchApiKeyRefs"];
			};
			const raw = vendors.map(pick).find((value) => value !== void 0);
			const refs = Array.isArray(raw) ? raw.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : parseSecretRefs(typeof raw === "string" ? raw : "");
			const rows = refs.length === 0 ? [(0, react.createElement)("small", {
				key: "empty",
				"data-secret-empty": true,
				className: CSS_CLASS.note
			}, t("search.secretEmpty"))] : refs.map((ref) => {
				const configured = props.credentialStatus?.[ref];
				const probe = props.keyProbes?.[ref];
				const probing = props.keyProbing === ref;
				return (0, react.createElement)("div", {
					key: ref,
					"data-secret-row": ref,
					className: `${CSS_CLASS.field} ${CSS_CLASS.secretRow}`
				}, (0, react.createElement)("span", { className: CSS_CLASS.fieldText }, (0, react.createElement)("span", { className: CSS_CLASS.mono }, ref), configured === void 0 ? null : (0, react.createElement)("small", {
					key: "state",
					"data-secret-state": configured ? "configured" : "missing",
					className: configured ? CSS_CLASS.mark : CSS_CLASS.failure
				}, configured ? t("search.keyConfigured") : t("search.keyMissing")), probe === void 0 ? null : (0, react.createElement)("small", {
					key: "probe",
					"data-secret-probe": probe.state,
					...probe.reason === void 0 ? {} : { "data-secret-probe-reason": probe.reason },
					className: probe.state === "ok" ? CSS_CLASS.mark : CSS_CLASS.failure
				}, probe.state === "ok" ? t("search.keyOk") : probe.state === "invalid" ? t("search.keyInvalid") : t("search.keyUnknown"))), props.onTestSecret === void 0 ? null : (0, react.createElement)("button", {
					type: "button",
					"data-secret-test": ref,
					className: CSS_CLASS.buttonSm,
					disabled: probing,
					onClick: () => props.onTestSecret?.(ref)
				}, probing ? t("search.keyTesting") : t("search.keyTest")), (0, react.createElement)("button", {
					type: "button",
					"data-secret-remove": ref,
					className: CSS_CLASS.iconDanger,
					title: t("search.secretRemove"),
					"aria-label": t("search.secretRemove"),
					onClick: () => props.onRemoveSecret?.(ref)
				}, (0, react.createElement)(RemoveIcon)));
			});
			return (0, react.createElement)("div", {
				key: "secret",
				"data-secret-block": "true",
				className: CSS_CLASS.inset
			}, (0, react.createElement)("div", { className: CSS_CLASS.actions }, (0, react.createElement)("input", {
				"data-secret-input": "true",
				type: "password",
				value: props.secretDraft ?? "",
				placeholder: t("search.secretPlaceholder"),
				autoComplete: "off",
				onChange: (event) => props.onSecretDraftChange?.(event.target?.value ?? "")
			}), (0, react.createElement)("button", {
				type: "button",
				"data-secret-add": "true",
				className: CSS_CLASS.buttonPrimary,
				disabled: props.secretSaving === true,
				onClick: () => {
					const secret = props.secretDraft ?? "";
					const problem = validateSecretInput(secret, ["pending"]);
					if (problem !== void 0) {
						props.onSecretError?.(problem);
						return;
					}
					save("", secret.trim()).then((error) => props.onSecretError?.(error));
				}
			}, props.secretSaving === true ? t("search.secretSaving") : t("search.secretAdd"))), (0, react.createElement)("small", { className: CSS_CLASS.note }, t("search.secretHint")), props.secretError === void 0 || props.secretError === "" ? null : (0, react.createElement)("small", {
				"data-secret-error": true,
				className: CSS_CLASS.failure
			}, props.secretError), (0, react.createElement)("div", {
				key: "rows",
				"data-secret-rows": "true",
				className: CSS_CLASS.inset
			}, ...rows));
		}
		/**
		* 一组通用字段卡片。
		*
		* 「集成与显示」与「高级」都用原生 `<details>` **默认折叠**（需求前者
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
		function fieldElement(props, entry, field, vendorLabel) {
			const { t } = props;
			const { spec } = field;
			const control = fieldControl(props, entry, field);
			if (control === void 0) return null;
			const hint = spec.hintKey === void 0 ? null : (0, react.createElement)("small", { "data-field-hint": spec.key }, t(spec.hintKey));
			const credentialBadge = credentialBadgeOf(props, field);
			const pending = Object.hasOwn(props.state.drafts[entry.ns] ?? {}, spec.key);
			return (0, react.createElement)("label", {
				key: spec.key,
				"data-field": spec.key,
				...vendorLabel === void 0 ? {} : { "data-field-vendor": entry.providerId },
				...pending ? { "data-field-pending": "true" } : {},
				className: CSS_CLASS.field
			}, (0, react.createElement)("span", { className: CSS_CLASS.fieldText }, (0, react.createElement)("span", null, ...vendorLabel === void 0 ? [t(spec.labelKey)] : [t(spec.labelKey), (0, react.createElement)("small", {
				key: "vendor",
				className: CSS_CLASS.vendorBadge
			}, vendorLabel)], ...credentialBadge === null ? [] : [credentialBadge]), hint), control);
		}
		/**
		* 一张卡片底部的保存按钮：**只有真有未落盘的输入时才渲染**。
		*
		* 需求：「一个卡片保留一个保存按钮，点完保存后按钮消失，如果复原则不显示保存」。
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
		function cardSaveBar(props, card, pending) {
			if (pending.length === 0) return null;
			const { t } = props;
			const busy = props.savingNs !== void 0 && pending.some((item) => item.ns === props.savingNs);
			return (0, react.createElement)("div", {
				key: "save",
				"data-card-save": card.id,
				className: CSS_CLASS.save
			}, ...pending.map((item) => (0, react.createElement)("button", {
				key: item.ns,
				type: "button",
				"data-save": item.ns,
				className: CSS_CLASS.buttonPrimary,
				disabled: props.savingNs !== void 0,
				onClick: () => props.onSave(item.ns)
			}, busy && props.savingNs === item.ns ? t("saving") : t("save"), pending.length > 1 ? (0, react.createElement)("small", { key: "vendor" }, item.label) : null)));
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
		function credentialBadgeOf(props, field) {
			const status = props.credentialStatus;
			if (status === void 0) return null;
			const spec = field.spec;
			if (spec.kind !== "text" || !/KeyRefs?$|ApiKey/i.test(spec.key)) return null;
			const refs = String(field.value ?? "").split(/[,，\s]+/).map((item) => item.trim()).filter((item) => item !== "");
			if (refs.length === 0) return null;
			const summary = summarizeKeyStatus(refs.map((ref) => ({
				ref,
				configured: status[ref] === true
			})));
			const label = summary.state === "configured" ? props.t("search.keyConfigured") : summary.state === "partial" ? `${props.t("search.keyConfigured")} ${summary.configured}/${summary.total}` : props.t("search.keyMissing");
			return (0, react.createElement)("small", {
				key: "credential",
				"data-credential-status": summary.state,
				"data-credential-missing": summary.missing.join(","),
				className: summary.state === "configured" ? CSS_CLASS.mark : CSS_CLASS.failure
			}, label);
		}
		/** 字段的控件。 */
		function fieldControl(props, entry, field) {
			const { spec, value } = field;
			const change = (next) => props.onSetField(entry.ns, spec.key, next);
			if (spec.kind === "boolean") return (0, react.createElement)("input", {
				"data-field-input": spec.key,
				type: "checkbox",
				className: CSS_CLASS.toggle,
				checked: value === true,
				onChange: (event) => change(event.target?.checked === true)
			});
			if (spec.kind === "select") return (0, react.createElement)("select", {
				"data-field-input": spec.key,
				value: value === void 0 ? "" : String(value),
				onChange: (event) => change(event.target?.value ?? "")
			}, ...(spec.options ?? []).map((option) => (0, react.createElement)("option", {
				key: option.value,
				value: option.value
			}, props.t(option.labelKey))));
			if (spec.kind === "duration") {
				const parts = durationPartsOf(value);
				const changePart = (part, raw) => {
					change(minutesOfDurationParts({
						...parts,
						[part]: Number(raw)
					}));
				};
				return (0, react.createElement)("div", {
					className: CSS_CLASS.duration,
					"data-duration-input": spec.key
				}, ...[
					["days", 30],
					["hours", 24],
					["minutes", 60]
				].map(([part, max]) => (0, react.createElement)("span", {
					key: part,
					className: CSS_CLASS.durationPart
				}, (0, react.createElement)("input", {
					type: "number",
					min: 0,
					max,
					value: String(parts[part]),
					"data-duration-part": part,
					onChange: (event) => changePart(part, event.target?.value ?? "")
				}), (0, react.createElement)("span", null, props.t(`duration.${part}`)))));
			}
			if (spec.kind === "number" || spec.kind === "text") return (0, react.createElement)("input", {
				"data-field-input": spec.key,
				type: spec.kind === "number" ? "number" : "text",
				value: value === void 0 || value === null ? "" : String(value),
				onChange: (event) => {
					const raw = event.target?.value ?? "";
					if (spec.kind !== "number") {
						change(raw);
						return;
					}
					const parsed = raw.trim() === "" ? void 0 : Number(raw);
					change(parsed !== void 0 && Number.isFinite(parsed) ? parsed : void 0);
				}
			});
		}
		//#endregion
		//#region src/client/reading-cache.ts
		/**
		* 按 key（本包用厂商 id）存放读数的缓存。
		*
		* 新鲜期是「距上次 `put` 不超过 `ttlMs`」；命中时返回值，过期或没有时返回 `undefined`
		* （调用方据此去读）。命中边界取闭区间（`age === ttlMs` 仍算新鲜），这样「60 秒 TTL」
		* 与侧边栏的 60 秒轮询节奏严格对齐。
		*/
		var ReadingCache = class {
			ttlMs;
			now;
			entries = /* @__PURE__ */ new Map();
			/**
			* @param ttlMs - 新鲜期（毫秒）；`<= 0` 表示永不命中（调用方每次都会重读）。
			* @param now - 取当前时刻（毫秒；测试注入假时钟）。
			*/
			constructor(ttlMs, now = () => Date.now()) {
				this.ttlMs = ttlMs;
				this.now = now;
			}
			/** 当前生效的新鲜期（毫秒）：允许传函数 —— 用户改「刷新间隔」时不必重建缓存。 */
			ttl() {
				return typeof this.ttlMs === "function" ? this.ttlMs() : this.ttlMs;
			}
			/**
			* 取一条仍然新鲜的读数。
			* @param key - 读数的主体。
			* @returns 读数；没有或已过新鲜期时为 `undefined`。
			*/
			get(key) {
				const entry = this.entries.get(key);
				if (entry === void 0) return void 0;
				if (this.now() - entry.at > this.ttl()) {
					this.entries.delete(key);
					return;
				}
				return entry.value;
			}
			/**
			* 记下一条读数（同键覆盖，重新计时）。
			* @param key - 读数的主体。
			* @param value - 读数。
			*/
			put(key, value) {
				this.entries.set(key, {
					value,
					at: this.now()
				});
			}
			/** 清空全部条目（宿主侧失效信号与测试隔离用）。 */
			clear() {
				this.entries.clear();
			}
		};
		//#endregion
		//#region src/client/usage-contract.ts
		/** 贡献所属的 npm 包（描述符 id 的前缀）。 */
		const USAGE_PACKAGE = "dsh-llm-account";
		/** 宿主侧 cordis 服务键；两个 profile 行共享同一个实例。 */
		const USAGE_SERVICE_KEY = "llmAccountUsage";
		/** 线上命名空间：端点 = `<namespace>/<method>`，客户端侧服务名 = `remote.<namespace>`。 */
		const USAGE_NAMESPACE = "llm-account";
		/** 本包托管的三条厂商路由（客户端只做参数校验，不认识厂商语义）。 */
		const VENDOR_IDS = [
			"commandcode",
			"dsh-opencode-go",
			"opendesign"
		];
		/** 边界校验失败：说出是哪个端点、哪个字段。 */
		function boundaryError(endpoint, detail) {
			return /* @__PURE__ */ new Error(`${USAGE_PACKAGE}: ${endpoint} boundary violation: ${detail}`);
		}
		/**
		* 把一个边界值写进错误消息。
		*
		* **不能直接用 `JSON.stringify`**：它对 BigInt 抛 `TypeError`、对循环引用也抛 ——
		* 于是「报一个边界错误」这件事自己先崩了，调用方拿到的是一个跟边界毫无关系的
		* TypeError（主机与客户端同进程，线上值不一定是 JSON 能序列化的东西）。
		* @param value - 待描述的边界值。
		* @returns 一段安全的文本；序列化不了就退到类型名。
		*/
		function describeValue(value) {
			try {
				return JSON.stringify(value) ?? String(value);
			} catch {
				return Object.prototype.toString.call(value);
			}
		}
		/** 判定「普通对象」。 */
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/**
		* 校验线上厂商 id。
		* @param value - 边界值。
		* @returns 合法的厂商 id。
		*/
		function parseVendorId(value) {
			if (typeof value === "string" && VENDOR_IDS.includes(value)) return value;
			throw boundaryError(`${USAGE_NAMESPACE}/vendor`, `expected a known vendor id, got ${describeValue(value)}`);
		}
		/**
		* 校验状态结果：结构 + **逐项洗 `quota`**。
		*
		* 为什么不能只查顶层（2026-10-20 复审发现）：页面用 `quota?.windows?.length` 判「有没有
		* 额度数据」—— 字符串也有 `length`，所以 `windows: "oops"` 会通过那个假值检查，紧接着
		* `.map` 抛错。虽然三处卡片都有 `RenderBoundary` 兜底（不会白屏），但那块面板会降级成
		* 「面板失败 + 重试」—— 一个坏字段换掉整个面板。
		*
		* 与 `parseCatalogModels` 同一条纪律：**边界上逐项清洗**，让下游可以信任形状。
		* `windows` / `failures` 不是数组时直接归空数组（而不是丢掉整行）：账号本身还有
		* `label` / `configured` 这些有用信息。
		* @param endpoint - 调用方端点名（错误消息要指名是哪条调用）。
		* @param value - 边界值。
		*/
		function parseVendorUsageStatus(endpoint, value) {
			if (!isRecord(value) || !Array.isArray(value.accounts)) throw boundaryError(endpoint, "expected an object with an accounts array");
			const accounts = value.accounts.map((account) => {
				if (!isRecord(account)) return account;
				const quota = account.quota;
				if (!isRecord(quota)) return quota === null || quota === void 0 ? account : {
					...account,
					quota: void 0
				};
				const windows = (Array.isArray(quota.windows) ? quota.windows : []).map(cleanQuotaWindow).filter(isDefined);
				const failures = Array.isArray(quota.failures) ? quota.failures : [];
				return {
					...account,
					quota: {
						...quota,
						windows,
						failures
					}
				};
			});
			return {
				...value,
				accounts
			};
		}
		/** 类型守卫：过滤掉 `undefined`。 */
		function isDefined(value) {
			return value !== void 0;
		}
		/**
		* 洗一个额度窗口：只保留**形状正确**的字段。
		*
		* 数字字段必须是有限数字（`NaN` / 字符串 / `null` 一律归缺失 —— 缺失 ≠ 0，界面上
		* 「没有这个数」与「这个数是零」是两回事）；`unit` 只认已知单位；`key` 必须是非空字符串。
		* 认不出 `key` 的整条丢掉：没有键就没有标签可显示，留着只会渲染出一个空行。
		* @param raw - 线上来的一个窗口元素。
		* @returns 干净的窗口，或 `undefined`（连 key 都没有）。
		*/
		function cleanQuotaWindow(raw) {
			if (!isRecord(raw)) return void 0;
			const key = raw.key;
			if (typeof key !== "string" || key.trim() === "") return void 0;
			const window = { key };
			const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
			const used = number(raw.used);
			if (used !== void 0) window.used = used;
			const cap = number(raw.cap);
			if (cap !== void 0) window.cap = cap;
			const percent = number(raw.percent);
			if (percent !== void 0) window.percent = percent;
			const resetAt = number(raw.resetAt);
			if (resetAt !== void 0) window.resetAt = resetAt;
			if (raw.unit === "usd") window.unit = "usd";
			if (raw.exceeded === true) window.exceeded = true;
			if (raw.unlimited === true) window.unlimited = true;
			if (raw.resetEstimated === true) window.resetEstimated = true;
			if (raw.usedSource === "local" || raw.usedSource === "vendor") window.usedSource = raw.usedSource;
			return window;
		}
		/** 校验账号行数组。 */
		function parseAccountViews(endpoint, value) {
			if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of account views");
			return value;
		}
		/** 校验切换记录数组。 */
		function parseSwitchRecords(endpoint, value) {
			if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of switch records");
			return value;
		}
		/** 校验一次登录尝试的状态。 */
		function parseLoginStatus(endpoint, value) {
			if (!isRecord(value) || typeof value.state !== "string") throw boundaryError(endpoint, "expected a login status object with a state field");
			return value;
		}
		/**
		* 校验模型目录结果。
		*
		* 只查结构、逐项清洗：目录与失败原因都来自宿主，但页面不该因为一个坏行就整块崩掉；
		* 读不出内容的行直接丢弃，失败项只保留字符串。
		*/
		function parseCatalogModels(endpoint, value) {
			if (!isRecord(value) || !Array.isArray(value.models)) throw boundaryError(endpoint, "expected a models result with a models array");
			return {
				models: value.models.filter((item) => isRecord(item)).filter((item) => typeof item.id === "string").map((item) => ({
					id: item.id,
					...typeof item.name === "string" ? { name: item.name } : {},
					...typeof item.company === "string" ? { company: item.company } : {},
					...item.free === true ? { free: true } : {}
				})),
				failures: Array.isArray(value.failures) ? value.failures.filter((item) => typeof item === "string") : []
			};
		}
		/** 校验一条账号行。 */
		function parseAccountView(endpoint, value) {
			if (!isRecord(value) || typeof value.ref !== "string") throw boundaryError(endpoint, "expected an account view with a ref");
			return value;
		}
		/** 无返回值的调用（宿主方法返回 `void`）：接受任何值并归一到 `undefined`。 */
		function parseVoid() {}
		/**
		* 校验「磁盘已安装版本」：必须是非空字符串。
		*
		* 拒绝空串：空版本号会让漂移检测永远判为「不一致」，于是每次加载都弹刷新提示 ——
		* 那比不提示更糟。宁可在这里失败（客户端据此视为「读不到」，不弹）。
		* @param endpoint - 调用点（错误信息里点名）。
		* @param value - 宿主返回值。
		* @returns 版本字符串。
		*/
		function parseInstalledVersion(endpoint, value) {
			const text = typeof value === "string" ? value.trim() : "";
			if (text === "") throw new Error(`${endpoint}: expected a non-empty version string`);
			return text;
		}
		/**
		* 校验导出结果：必须是一段**非空**的 CSV 文本。
		*
		* 为什么拒绝空串：真实导出**永远至少有表头**（`ledgerCsvOf` 对空台账也返回表头），所以
		* 空串只可能来自坏掉的宿主。接受它会让用户下载到一个 0 字节文件，还以为导出成功了 ——
		* 那是这条路径上最糟的失败形态（静默地给出一个看起来成功的结果）。
		* @param endpoint - 调用点（错误信息里点名）。
		* @param value - 线上值。
		* @returns CSV 文本。
		*/
		function parseUsageCsv(endpoint, value) {
			if (typeof value !== "string") throw boundaryError(endpoint, `expected the CSV text, got ${describeValue(value)}`);
			if (value === "") throw boundaryError(endpoint, "expected a CSV header, got an empty string");
			return value;
		}
		/**
		* 校验「凭据状态」的结果。
		*
		* 只收 `{ ref, configured }` 两项：这是**布尔摘要**，绝不搬运密钥本身
		* （那会把它传进浏览器内存，而界面上从来不需要它）。
		* 形状不合格的行丢掉；一条都不剩时返回空数组（界面据此显示「未添加」）。
		* @param endpoint - 调用点。
		* @param value - 线上值。
		* @returns 逐条状态。
		*/
		function parseCredentialStatus(endpoint, value) {
			if (!Array.isArray(value)) throw boundaryError(endpoint, `expected an array of credential statuses, got ${describeValue(value)}`);
			const out = [];
			for (const row of value) {
				if (!isRecord(row)) continue;
				const ref = row.ref;
				const configured = row.configured;
				if (typeof ref !== "string" || ref === "") continue;
				if (typeof configured !== "boolean") continue;
				out.push({
					ref,
					configured
				});
			}
			return out;
		}
		/**
		* 校验「密钥实测」的结果。
		*
		* 形状不可信：缺 `state`、出现三档之外的值、`ref` 为空，一律丢掉 —— 界面宁可什么都不显示，
		* 也不能把一个猜出来的结论当成事实呈现（这条与全项目「不猜」的纪律一致）。
		* @param endpoint - 调用点。
		* @param value - 线上值。
		* @returns 合格的结果列表（可能为空）。
		*/
		function parseCredentialProbes(endpoint, value) {
			if (!Array.isArray(value)) throw boundaryError(endpoint, `expected an array of credential probes, got ${describeValue(value)}`);
			const out = [];
			for (const row of value) {
				if (!isRecord(row)) continue;
				const ref = row.ref;
				const state = row.state;
				if (typeof ref !== "string" || ref === "") continue;
				if (state !== "ok" && state !== "invalid" && state !== "unknown") continue;
				const reason = typeof row.reason === "string" && row.reason !== "" ? row.reason : void 0;
				out.push(reason === void 0 ? {
					ref,
					state
				} : {
					ref,
					state,
					reason
				});
			}
			return out;
		}
		/**
		* 校验用量报表。
		*
		* **必须逐层校验**，不能只看顶层：渲染时会直接解引用 `account.period.kind` /
		* `bucket.*` / `total.bucket`，任何一层缺失都会在渲染期抛 TypeError —— React 因此
		* 丢弃整棵子树，表现就是「刷新用量统计时整块内容消失」（2026-10-19 报障）。
		*
		* 策略：不认识的行**丢弃**而不是整体报错 —— 少一行明细好过整页消失。
		*/
		function parseUsageReport(endpoint, value) {
			if (!isRecord(value) || !isRecord(value.total) || !Array.isArray(value.accounts)) throw boundaryError(endpoint, "expected a usage report with accounts and total");
			const total = value.total;
			if (!isRecord(total.bucket)) throw boundaryError(endpoint, "expected total.bucket to be an object");
			const accounts = value.accounts.filter(isAccountUsageRow);
			const byVendor = Array.isArray(total.byVendor) ? total.byVendor.filter(isVendorBucketRow) : [];
			const lastUsed = lastUsedOf(value.lastUsed);
			const failuresByKind = failuresByKindOf(value.failuresByKind);
			const failuresByAccount = failuresByAccountOf(value.failuresByAccount);
			return {
				accounts,
				total: {
					window: isUsageWindow(total.window) ? total.window : "today",
					bucket: total.bucket,
					byVendor,
					...typeof total.lastAt === "number" && Number.isFinite(total.lastAt) ? { lastAt: total.lastAt } : {}
				},
				...lastUsed === void 0 ? {} : { lastUsed },
				...failuresByKind === void 0 ? {} : { failuresByKind },
				...failuresByAccount === void 0 ? {} : { failuresByAccount }
			};
		}
		/**
		* 校验并搬运「按账号的失败明细」。
		*
		* 逐行核对：`account` 非空、`rows` 是数组且其中每一行形状合格。坏行**丢弃**（一行坏掉不该
		* 让整块消失）；`rows` 全坏时整个账号条目丢弃。一条都没有时返回 `undefined`。
		* @param value - 线上值（形状不可信）。
		* @returns 按账号的明细；没有合格条目时为 `undefined`。
		*/
		function failuresByAccountOf(value) {
			if (!Array.isArray(value)) return void 0;
			const out = [];
			for (const entry of value) {
				if (!isRecord(entry)) continue;
				const vendor = entry.vendor;
				const account = entry.account;
				if (typeof vendor !== "string" || vendor === "") continue;
				if (typeof account !== "string") continue;
				const rows = failuresByKindOf(entry.rows);
				if (rows === void 0) continue;
				out.push({
					vendor,
					account,
					rows
				});
			}
			return out.length === 0 ? void 0 : out;
		}
		/**
		* 校验并搬运失败明细。
		*
		* 逐行核对四个字段：形状不合格的行**丢弃**（一行坏掉不该让整块消失）。一行都不剩时返回
		* `undefined` —— 界面上「没有失败」与「明细读不到」因此长得一样，这正是我们要的：
		* 不给用户一条「失败 0 次」的行。
		* @param value - 线上值（形状不可信）。
		* @returns 明细行；没有合格行时为 `undefined`。
		*/
		function failuresByKindOf(value) {
			if (!Array.isArray(value)) return void 0;
			const rows = value.filter((row) => {
				if (!isRecord(row)) return false;
				return typeof row.kind === "string" && row.kind !== "" && typeof row.count === "number" && Number.isFinite(row.count) && typeof row.lastAt === "number" && Number.isFinite(row.lastAt) && typeof row.lastAccount === "string";
			});
			return rows.length === 0 ? void 0 : rows;
		}
		/** 合法的窗口值。 */
		function isUsageWindow(value) {
			return value === "today" || value === "7d" || value === "30d" || value === "all";
		}
		/**
		* 校验并搬运「最近一次请求的账号」。
		*
		* 四个字段（vendor / account / at 必须有效，model 可空）都核对过才收下 —— 缺一块的读数
		* 拿去渲染只会让侧边栏挑不到账号，静默退回清单第一个（看起来像「不跟随」）。
		* @param value - 线上值（形状不可信）。
		* @returns 校验后的读数；不合格时为 `undefined`（当作「没有」，不猜）。
		*/
		function lastUsedOf(value) {
			if (!isRecord(value)) return void 0;
			const { vendor, account, at } = value;
			if (typeof vendor !== "string" || vendor === "") return void 0;
			if (typeof account !== "string" || account === "") return void 0;
			if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return void 0;
			return {
				vendor,
				account,
				model: typeof value.model === "string" ? value.model : "",
				at
			};
		}
		/**
		* 一行账号用量是否**可渲染**：`period` 与 `bucket` 必须在。
		*
		* 只查渲染会直接解引用的字段；数字缺失由渲染层兜底（显示破折号），但对象整体缺失
		* 必须在边界挡掉 —— 那正是「渲染期 TypeError → 整块消失」的来源。
		*/
		function isAccountUsageRow(value) {
			if (!isRecord(value)) return false;
			const period = value.period;
			if (!isRecord(period) || typeof period.kind !== "string" || typeof period.key !== "string") return false;
			if (typeof period.start !== "number" || typeof period.fromResetAt !== "boolean") return false;
			return isRecord(value.bucket);
		}
		/** 一家厂商的桶是否可渲染（`byVendor` 的每一行）。 */
		function isVendorBucketRow(value) {
			return isRecord(value) && typeof value.vendor === "string" && isRecord(value.bucket);
		}
		/** 校验「添加账户」的输入。 */ function parseAddAccountInput(value) {
			if (!isRecord(value) || typeof value.label !== "string") throw boundaryError(`${USAGE_NAMESPACE}/addAccount`, "expected { label }");
			const key = value.key;
			return typeof key === "string" ? {
				label: value.label,
				key
			} : { label: value.label };
		}
		/** 校验一个必填字符串。 */
		function parseString(endpoint, value) {
			if (typeof value !== "string") throw boundaryError(endpoint, `expected a string, got ${describeValue(value)}`);
			return value;
		}
		/** 校验一个数字（账号下标）。 */
		function parseNumber(endpoint, value) {
			if (typeof value !== "number" || !Number.isFinite(value)) throw boundaryError(endpoint, `expected a finite number, got ${describeValue(value)}`);
			return value;
		}
		/** 校验一个布尔值。 */
		function parseBoolean(endpoint, value) {
			if (typeof value !== "boolean") throw boundaryError(endpoint, `expected a boolean, got ${describeValue(value)}`);
			return value;
		}
		/** 校验「立即切换」的结果。 */
		function parseSwitchNowResult(endpoint, value) {
			if (!isRecord(value) || typeof value.switched !== "boolean") throw boundaryError(endpoint, "expected { switched: boolean }");
			return {
				switched: value.switched,
				...typeof value.target === "string" ? { target: value.target } : {},
				...typeof value.reason === "string" ? { reason: value.reason } : {}
			};
		}
		/** 校验一个字符串数组。 */
		function parseStringArray(endpoint, value) {
			if (!Array.isArray(value)) throw boundaryError(endpoint, "expected an array of strings");
			return value.filter((item) => typeof item === "string");
		}
		/** 校验全局切换设置。 */
		function parseSwitchSettings(endpoint, value) {
			if (!isRecord(value)) throw boundaryError(endpoint, "expected a switch settings object");
			return {
				strategy: value.strategy === "best-quota" ? "best-quota" : value.strategy === "scheduled" ? "scheduled" : "order",
				intervalMinutes: typeof value.intervalMinutes === "number" && Number.isFinite(value.intervalMinutes) ? Math.min(43200, Math.max(0, Math.floor(value.intervalMinutes))) : 60,
				atTurnEnd: value.atTurnEnd !== false,
				autoSwitch: value.autoSwitch !== false
			};
		}
		/** 校验一个可空的字符串（`null` 表示「回到自动轮换」）。 */
		function parseNullableString(endpoint, value) {
			if (value === null || value === void 0) return null;
			return parseString(endpoint, value);
		}
		/** 造一个强类型结果编解码（与旧插件 `makeStrictCodec` 同形）。 */
		function strictCodec(typeSymbol, parse) {
			return {
				mode: "strict",
				typeSymbol: `${USAGE_PACKAGE}#${typeSymbol}`,
				create: () => ({ parse })
			};
		}
		/**
		* 三个只读方法共用的参数：厂商 id。
		*
		* `parseVendorId` 只收一个值（它自己的语义），而描述符契约要双参 —— 所以这里**适配**，
		* 不能直接把单参函数挂上去。挂错了的后果是运行时才暴露的：`parameterOf` 会把端点名
		* （`"llm-account/status#vendor"`）当成 vendor 值去比对白名单，于是**每一次**带 vendor 的
		* 调用都在网关边界上被拒（真机报错：`wire field "vendor" failed boundary validation`），
		* 状态 / 账号 / 开关 / 增删改全线失效，而页面只会显示「账号数据暂不可用」。
		*/
		const VENDOR_PARAM = {
			name: "vendor",
			typeSymbol: "VendorId",
			parse: (_endpoint, value) => parseVendorId(value)
		};
		/** 账号 ref 参数。 */
		const REF_PARAM = {
			name: "ref",
			typeSymbol: "AccountRef",
			parse: parseString
		};
		/** 模型 id 数组参数。 */
		const MODELS_PARAM = {
			name: "models",
			typeSymbol: "AccountModels",
			parse: parseStringArray
		};
		/** 凭据引用名数组参数（查询它们是否真的配置了）。 */
		const REFS_PARAM = {
			name: "refs",
			typeSymbol: "CredentialRefs",
			parse: parseStringArray
		};
		/** 密钥本身（只在这一条上行，绝不回读）。 */
		const SECRET_PARAM = {
			name: "secret",
			typeSymbol: "CredentialSecret",
			parse: (endpoint, value) => {
				if (typeof value !== "string" || value.trim() === "") throw boundaryError(endpoint, "expected a non-empty secret");
				return value;
			}
		};
		/**
		* 用量窗口参数（`today` / `7d` / `30d` / `all`）。
		*
		* 取值一旦不认识就退回 `today`：宁可少显示，也不要因为一个拼错的窗口让整块报表报错。
		*/
		const WINDOW_PARAM = {
			name: "window",
			typeSymbol: "UsageWindow",
			optional: true,
			parse: (_endpoint, value) => {
				if (typeof value !== "string") return "today";
				return value === "today" || value === "7d" || value === "30d" || value === "all" ? value : "today";
			}
		};
		/**
		* 造一个参数描述符。
		*
		* 护栏：`parse` 的形参数必须 ≥ 2。这是唯一能机械拦住上面那类 arity 错误的检查 ——
		* 类型系统放行，形状测试也放行，只有把真值喂进 `codec.create().parse()` 才会炸。
		* @param spec - 参数规格。
		* @param method - 所属方法名（拼端点用）。
		*/
		function parameterOf(spec, method) {
			if (spec.parse.length < 2) throw new Error(`${USAGE_PACKAGE}: parameter "${spec.name}" of ${USAGE_NAMESPACE}/${method} needs a (endpoint, value) parser, got one with ${spec.parse.length} argument(s)`);
			const parameterEndpoint = `${USAGE_NAMESPACE}/${method}#${spec.name}`;
			return {
				name: spec.name,
				wire: spec.name,
				source: "json",
				...spec.optional === true ? { acceptsUndefined: true } : {},
				codec: {
					mode: "strict",
					typeSymbol: `${USAGE_PACKAGE}#${spec.typeSymbol}`,
					create: () => ({ parse: (value) => spec.parse(parameterEndpoint, value) })
				}
			};
		}
		/** 造一个强类型调用描述符（端点 = `<namespace>/<method>`）。 */
		function makeDescriptor(method, typeSymbol, parse, parameters) {
			const endpoint = `${USAGE_NAMESPACE}/${method}`;
			return {
				id: `${USAGE_PACKAGE}#${endpoint}`,
				service: USAGE_SERVICE_KEY,
				namespace: USAGE_NAMESPACE,
				method,
				invocation: { kind: "direct" },
				parameters: parameters.map((spec) => parameterOf(spec, method)),
				result: strictCodec(typeSymbol, (value) => parse(endpoint, value))
			};
		}
		/**
		* 全部远程方法的描述符（每次调用返回新数组，避免调用方改到共享常量）。
		* @returns 描述符列表。
		*/
		function usageDescriptors() {
			return [
				makeDescriptor("status", "VendorUsageStatus", parseVendorUsageStatus, [VENDOR_PARAM]),
				makeDescriptor("accounts", "AccountViewList", parseAccountViews, [VENDOR_PARAM]),
				makeDescriptor("switches", "SwitchRecordList", parseSwitchRecords, [VENDOR_PARAM]),
				makeDescriptor("installedVersion", "InstalledVersion", parseInstalledVersion, []),
				makeDescriptor("models", "CatalogModels", parseCatalogModels, [VENDOR_PARAM]),
				makeDescriptor("addAccount", "AccountView", parseAccountView, [VENDOR_PARAM, {
					name: "input",
					typeSymbol: "AddAccountInput",
					parse: (_endpoint, value) => parseAddAccountInput(value)
				}]),
				makeDescriptor("renameAccount", "Void", parseVoid, [
					VENDOR_PARAM,
					REF_PARAM,
					{
						name: "label",
						typeSymbol: "AccountLabel",
						parse: parseString
					}
				]),
				makeDescriptor("restoreAccountName", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
				makeDescriptor("replaceKey", "Void", parseVoid, [
					VENDOR_PARAM,
					REF_PARAM,
					{
						name: "key",
						typeSymbol: "ApiKey",
						parse: parseString
					}
				]),
				makeDescriptor("removeAccount", "Void", parseVoid, [VENDOR_PARAM, REF_PARAM]),
				makeDescriptor("selectAccount", "Void", parseVoid, [VENDOR_PARAM, {
					name: "ref",
					typeSymbol: "NullableAccountRef",
					parse: parseNullableString,
					optional: true
				}]),
				makeDescriptor("moveAccount", "Void", parseVoid, [
					VENDOR_PARAM,
					REF_PARAM,
					{
						name: "toIndex",
						typeSymbol: "AccountIndex",
						parse: parseNumber
					}
				]),
				makeDescriptor("setAutoSwitch", "Void", parseVoid, [VENDOR_PARAM, {
					name: "value",
					typeSymbol: "AutoSwitch",
					parse: parseBoolean
				}]),
				makeDescriptor("switchNow", "SwitchNowResult", parseSwitchNowResult, [VENDOR_PARAM]),
				makeDescriptor("setAccountOrder", "Void", parseVoid, [{
					name: "order",
					typeSymbol: "AccountOrder",
					parse: parseStringArray
				}]),
				makeDescriptor("setSwitchSettings", "Void", parseVoid, [{
					name: "settings",
					typeSymbol: "SwitchSettingsWrite",
					parse: parseSwitchSettings
				}]),
				makeDescriptor("setAccountModels", "Void", parseVoid, [
					VENDOR_PARAM,
					REF_PARAM,
					MODELS_PARAM
				]),
				makeDescriptor("loginBegin", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
				makeDescriptor("loginStatus", "LoginStatus", parseLoginStatus, [VENDOR_PARAM]),
				makeDescriptor("loginCancel", "Void", parseVoid, [VENDOR_PARAM]),
				makeDescriptor("usageReport", "UsageReport", parseUsageReport, [WINDOW_PARAM]),
				makeDescriptor("usageClear", "Void", parseVoid, []),
				makeDescriptor("usageExportCsv", "UsageCsv", parseUsageCsv, [{
					name: "limit",
					typeSymbol: "ExportLimit",
					parse: parseNumber,
					optional: true
				}]),
				makeDescriptor("credentialStatus", "CredentialStatusList", parseCredentialStatus, [REFS_PARAM]),
				makeDescriptor("setCredential", "Void", parseVoid, [REF_PARAM, SECRET_PARAM]),
				makeDescriptor("probeSearchCredential", "CredentialProbes", parseCredentialProbes, [REFS_PARAM])
			];
		}
		//#endregion
		//#region src/client/drift-notice.ts
		/** 是否已经弹过（每次页面加载只弹一次）。 */
		let shownThisPage = false;
		/**
		* 读浏览器的 `document`。
		*
		* tsconfig 的 `lib` 里没有 DOM（刻意的：宿主侧代码不该用 DOM API），所以窄化读取。
		* @returns 只含本模块用到的成员的形状。
		*/
		function domDocument$1() {
			return globalThis.document;
		}
		/** 造一个元素。 */
		function elementOf(doc, tag) {
			return doc.createElement?.(tag) ?? {};
		}
		/**
		* 弹出「插件已更新，请刷新」提示。
		*
		* @param text - 文案（调用方已按语言取好）。
		* @param onReload - 点「立即刷新」时执行（生产传 `reloadPage`）。
		* @returns 句柄；没有 DOM 或已经弹过时返回 `undefined`。
		*/
		function showDriftNotice(text, onReload) {
			const doc = domDocument$1();
			if (doc?.body?.appendChild === void 0 || typeof doc.createElement !== "function") return void 0;
			if (shownThisPage) return void 0;
			if (typeof doc.getElementById === "function" && doc.getElementById("dsl-drift-notice") !== null) return void 0;
			shownThisPage = true;
			const root = elementOf(doc, "div");
			root.id = "dsl-drift-notice";
			root.className = "dsl-drift-notice";
			root.setAttribute("role", "alertdialog");
			root.setAttribute("aria-live", "assertive");
			const card = elementOf(doc, "div");
			card.className = "dsl-drift-notice-card";
			const title = elementOf(doc, "h3");
			title.className = "dsl-drift-notice-title";
			title.textContent = text.title;
			const body = elementOf(doc, "p");
			body.className = "dsl-drift-notice-body";
			body.textContent = text.body;
			const actions = elementOf(doc, "div");
			actions.className = "dsl-drift-notice-actions";
			const later = elementOf(doc, "button");
			later.className = "dsl-drift-notice-later";
			later.setAttribute("type", "button");
			later.textContent = text.later;
			const reload = elementOf(doc, "button");
			reload.className = "dsl-drift-notice-reload";
			reload.setAttribute("type", "button");
			reload.textContent = text.reload;
			const dismiss = () => {
				if (typeof root.remove === "function") root.remove();
				else root.textContent = "";
			};
			later.addEventListener("click", dismiss);
			reload.addEventListener("click", () => {
				dismiss();
				onReload();
			});
			actions.appendChild(later);
			actions.appendChild(reload);
			card.appendChild(title);
			card.appendChild(body);
			card.appendChild(actions);
			root.appendChild(card);
			doc.body.appendChild(root);
			return { dismiss };
		}
		//#endregion
		//#region src/client/time.ts
		/**
		* 相对时间文案。
		*
		* 为什么需要它：切换记录与切换提示此前把 `toISOString()` 直接印在界面上
		* （`2026-10-17T13:28:58.000Z`）—— 精确但对人没有意义。这里换成「刚刚 / 3 分钟前 /
		* 2 小时前 / 5 天前」，机器可读的 ISO 仍然留在 `<time dateTime>` 上（测试断言的就是它）。
		*
		* 纯函数、无 React：`now` 可注入，测试不必依赖真实时钟。
		* @module dsh-llm-account/src/client/time
		*/
		const MINUTE = 6e4;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		/**
		* 把时刻格式化成相对文案。
		* @param t - 取词函数（`copy.ts` 的 `time.*` 键）。
		* @param at - 目标时刻（epoch 毫秒）。
		* @param now - 当前时刻（epoch 毫秒，默认 `Date.now()`；时钟回拨时按「刚刚」处理）。
		* @returns 可读的相对时间。
		*/
		function relativeTime(t, at, now = Date.now()) {
			const delta = now - at;
			if (!Number.isFinite(delta) || delta < MINUTE) return t("time.now");
			if (delta < HOUR) return t("time.minutes").replace("{n}", String(Math.floor(delta / MINUTE)));
			if (delta < DAY) return t("time.hours").replace("{n}", String(Math.floor(delta / HOUR)));
			return t("time.days").replace("{n}", String(Math.floor(delta / DAY)));
		}
		//#endregion
		//#region src/client/usage-card.ts
		/**
		* 账号用量区块：**长在账号自己下面**的那一小块统计。
		*
		* 两次要求叠出来的形状（需求）：
		* 1. 「每个账号只统计自己的记账周期」→ 每个账号按**它自己的账期**聚合，不跟着页面上的时间窗口走；
		* 2. 「只在每个账号下面统计本身的用量」→ 页面上**没有**一张跨账号的大卡片了。额度是「还剩多少」，
		*    用量是「用了多少」，同一账号的两面贴在一起读才对得上。
		*
		* 版式对齐用户给的参考图：一行标题（「用量」+ 账期区间 + 口径来源），下面四个指标块
		* （请求 / 成功率 / 花费 / Token），每个块带一行小字补充（成功失败数、官方价折算、入/出 token）。
		* 缓存命中率与最近一次请求不占指标位，收在脚下那一行 —— 它们是核对用的，不该跟结论抢版面。
		*
		* 纯 props → 元素树：不取数、不留状态、不设定时器。
		* @module dsh-llm-account/src/client/usage-card
		*/
		/** 一个数值字段是否可信（线上可能是 null / 字符串 / NaN）。 */
		function finite(value) {
			return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		/**
		* 紧凑数字（`4600` → `4.6K`，`2_100_000_000` → `2.1B`）。
		*
		* 为什么不像以前那样只加千分位：账号卡片一行里要塞四个数，`4,600` 与 `2,100,000,000`
		* 长度差三倍，标题会被最长的那一个撑开；参考图用的就是 K/M/B。
		* @param value - 数值；缺失或非有限值时给破折号（**不是 0**）。
		* @returns 可读的紧凑文本。
		*/
		function compact(value) {
			if (value === void 0) return "—";
			const sign = value < 0 ? "-" : "";
			const magnitude = Math.abs(value);
			if (magnitude < 1e3) return `${sign}${Math.round(magnitude)}`;
			for (const [suffix, size] of [
				["B", 1e9],
				["M", 1e6],
				["K", 1e3]
			]) {
				if (magnitude < size) continue;
				const scaled = Math.round(magnitude / size * 10) / 10;
				return `${sign}${scaled % 1 === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
			}
			return `${sign}${Math.round(magnitude)}`;
		}
		/**
		* 百分比（0–1 → 「93.45%」），**保留两位小数**。
		*
		* 为什么不是四舍五入到整数：
		* `1131 成功 / 1 失败` 是 99.91%，整数舍入会显示成 100% —— 那是在报告一个**没有失败**的
		* 假象。两位小数能把这个差别露出来（99.91%）。
		*
		* 恰好 1 时仍显示「100%」（不写 100.00%，那是无意义的精度）。
		* 缺失 → 破折号（缺失不是 0%）。
		* @param rate - 0–1 的比率。
		* @returns 展示用文本。
		*/
		function percent(rate) {
			if (rate === void 0) return "—";
			const value = Math.round(rate * 1e4) / 100;
			if (value >= 100) return rate >= 1 ? "100%" : "99.99%";
			return `${value.toFixed(2)}%`;
		}
		/** 金额：小于 1 分也显示成 `<0.01`，不要显示成 0（那会让人以为是免费）。 */
		function money(value, unknownText) {
			if (value === void 0) return unknownText;
			if (value > 0 && value < .01) return "<$0.01";
			return `$${value.toFixed(2)}`;
		}
		/** 账期端点 → `2026/10/14`（本地时区；账期本来就是按用户本地日历算的）。 */
		function dateText(at) {
			if (at === void 0 || at <= 0) return void 0;
			const date = new Date(at);
			return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
		}
		/**
		* 账期区间文案（`2026/10/14 – 2026/11/14`）。
		*
		* 端点缺失时只写起点（`自 2026/10/14`）：`end` 缺失表示厂商没说什么时候重置，
		* 编一个终点比不写更糟。两个都没有就不画这一行。
		* @param t - 取词。
		* @param start - 账期起点（epoch 毫秒）。
		* @param end - 账期终点（epoch 毫秒，可缺）。
		* @returns 文案；没有可用端点时为 `undefined`。
		*/
		function periodRangeText(t, start, end) {
			const from = dateText(finite(start));
			const to = dateText(finite(end));
			if (from !== void 0 && to !== void 0) return t("usage.periodRange").replace("{from}", from).replace("{to}", to);
			if (from !== void 0) return t("usage.periodFrom").replace("{from}", from);
		}
		/** 成功率/命中率的健康色：好→绿、一般→黄、缺失→灰。 */
		function rateTone(rate) {
			if (rate === void 0) return "muted";
			if (rate >= .9) return "ok";
			return "warn";
		}
		/**
		* 一张**指标块**：大数字 + 标签 + 一行小字补充。
		*
		* 结构对参考图：数字在上、标签在中、补充说明在下，四块等宽横排（窄容器自动折行）。
		* @param props - 取词与数值。
		* @returns 指标块。
		*/
		function metric(props) {
			return (0, react.createElement)("div", {
				key: props.key,
				"data-usage-metric": props.attribute,
				"data-tone": props.tone ?? "plain",
				className: CSS_CLASS.usageMetric,
				...props.data
			}, (0, react.createElement)("span", { className: CSS_CLASS.usageMetricValue }, props.value), (0, react.createElement)("span", { className: CSS_CLASS.usageMetricLabel }, props.label), ...props.hint === void 0 ? [] : [(0, react.createElement)("small", {
				key: "hint",
				className: CSS_CLASS.usageMetricHint
			}, props.hint)]);
		}
		/** 脚下那一行的一小项（`缓存命中率 75%`）。 */
		function footItem(key, text, attribute, extra) {
			return (0, react.createElement)("span", {
				key,
				"data-usage-foot": attribute,
				className: CSS_CLASS.usageHint,
				...extra
			}, text);
		}
		/**
		* 一个账号的用量区块。
		*
		* 渲染层**绝不因为一条数据形状不对就抛**：一抛就是整棵子树被丢弃，表现为「刷新用量统计时
		* 整块内容消失」（2026-10-19 报障）。边界校验器（`usage-contract`）已挡掉大部分坏行，
		* 这里再兜住残留 —— 每个字段都过 {@link finite}，缺失一律显示破折号。
		* @param props - 取词、账号用量、可选的账号名（只用于无障碍标签）。
		* @returns 区块元素。
		*/
		function AccountUsageBlock(props) {
			const { t, entry } = props;
			const period = entry.period ?? {};
			const fromVendor = period.fromResetAt === true;
			const kindKey = `usage.kind.${typeof period.kind === "string" ? period.kind : "month"}`;
			const kindText = t(kindKey) === kindKey ? t("usage.kind.month") : t(kindKey);
			const sourceText = fromVendor ? t("usage.periodFromVendor") : t("usage.periodEstimated").replace("{kind}", kindText);
			const bucket = entry.bucket ?? {};
			const requests = finite(bucket.requests);
			const ok = finite(bucket.ok);
			const failed = finite(bucket.failed);
			const input = finite(bucket.inputTokens);
			const output = finite(bucket.outputTokens);
			const cacheRead = finite(bucket.cacheReadTokens);
			const cacheWrite = finite(bucket.cacheWriteTokens);
			const successRate = finite(bucket.successRate);
			const cacheHitRate = finite(bucket.cacheHitRate);
			const officialCost = finite(bucket.officialCost);
			const vendorCost = finite(bucket.vendorCost);
			const lastAt = finite(entry.lastAt);
			const tokenParts = [
				input,
				output,
				cacheRead,
				cacheWrite
			];
			const tokens = tokenParts.every((part) => part === void 0) ? void 0 : tokenParts.reduce((sum, part) => sum + (part ?? 0), 0);
			const vendorSpent = finite(entry.spent);
			const localSpent = finite(entry.localSpent);
			const cost = vendorSpent ?? vendorCost ?? localSpent;
			const costData = {};
			if (vendorSpent !== void 0) costData["data-usage-spent"] = vendorSpent;
			if (localSpent !== void 0) costData["data-usage-local-spent"] = localSpent;
			if (officialCost !== void 0) costData["data-usage-official"] = officialCost;
			const costScope = vendorSpent !== void 0 ? "vendor" : localSpent !== void 0 ? "local" : void 0;
			const officialPartial = bucket.officialCostPartial === true;
			const vendorCostPartial = bucket.vendorCostPartial === true;
			const costPartial = costScope === "local" && officialPartial || costScope === "vendor" && vendorCostPartial;
			/** 「按官方牌价折算」那半句：没有折算值时为 undefined（不写假的 $0.00）。 */
			const officialHint = officialCost === void 0 ? void 0 : `${t("usage.officialShort")} ≈ ${money(officialCost, "—")}`;
			/** 「只含本机」那半句：本机口径才有意义（厂商口径本来就含所有设备）。 */
			const localHint = costScope === "local" ? t("usage.localOnly") : void 0;
			const costHintRaw = officialHint === void 0 && localHint === void 0 ? void 0 : [officialHint, localHint].filter((part) => part !== void 0).join(" · ");
			const costHint = costPartial ? t("usage.costPartial") : costHintRaw;
			const head = (0, react.createElement)("div", { className: CSS_CLASS.usageHead }, (0, react.createElement)("span", { className: CSS_CLASS.usageTitle }, t("usage.title")), ...(() => {
				const range = periodRangeText(t, period.start, period.end);
				if (range === void 0) return [];
				return [(0, react.createElement)("small", {
					key: "period",
					"data-usage-period": period.key,
					"data-usage-period-source": fromVendor ? "vendor" : "estimated",
					className: CSS_CLASS.usagePeriod
				}, range), (0, react.createElement)("small", {
					key: "source",
					className: CSS_CLASS.usageMuted
				}, sourceText)];
			})());
			const metrics = (0, react.createElement)("div", {
				"data-usage-metrics": "true",
				className: CSS_CLASS.usageMetrics
			}, metric({
				key: "requests",
				attribute: "requests",
				label: t("usage.requests"),
				value: compact(requests),
				...ok === void 0 && failed === void 0 ? {} : { hint: `${compact(ok)} ${t("usage.okShort")} / ${compact(failed)} ${t("usage.failedShort")}` }
			}), metric({
				key: "success",
				attribute: "success-rate",
				label: t("usage.successRate"),
				value: percent(successRate),
				tone: rateTone(successRate)
			}), metric({
				key: "cost",
				attribute: "cost",
				label: t("usage.cost"),
				value: money(cost, t("usage.priceUnknown")),
				tone: cost === void 0 ? "muted" : "plain",
				...costHint === void 0 ? {} : { hint: costHint },
				...costScope === void 0 ? {} : { data: {
					...costData,
					"data-usage-cost-scope": costScope
				} }
			}), metric({
				key: "tokens",
				attribute: "tokens",
				label: t("usage.tokens"),
				value: compact(tokens),
				...input === void 0 && output === void 0 ? {} : { hint: `${compact(input)} ${t("usage.inputShort")} / ${compact(output)} ${t("usage.outputShort")}` }
			}));
			const foot = [];
			if (cacheHitRate !== void 0) foot.push(footItem("hit", `${t("usage.cacheHitRate")} ${percent(cacheHitRate)}`, "cache-hit-rate"));
			if (cacheRead !== void 0 || cacheWrite !== void 0) foot.push(footItem("cache", `${t("usage.cacheRead")} ${compact(cacheRead)} · ${t("usage.cacheWrite")} ${compact(cacheWrite)}`, "cache-tokens"));
			if (lastAt !== void 0) foot.push(footItem("last", `${t("usage.lastAt")} ${relativeTime(t, lastAt, props.now)}`, "last-at", { "data-usage-last-at": lastAt }));
			return (0, react.createElement)("section", {
				"data-usage-account": typeof entry.account === "string" ? entry.account : void 0,
				"data-usage-vendor": typeof entry.vendor === "string" ? entry.vendor : void 0,
				"aria-label": props.label,
				className: CSS_CLASS.usageSection
			}, head, metrics, ...foot.length === 0 ? [] : [(0, react.createElement)("div", {
				key: "foot",
				className: CSS_CLASS.usageFoot
			}, ...foot)], (0, react.createElement)(FailureKindList, {
				key: "failures",
				t,
				rows: props.failures ?? []
			}));
		}
		//#endregion
		//#region src/client/seams.ts
		/**
		* 客户端**接缝层**：所有「猜出来的宿主调用形状」都收在这里（计划 Review Focus 5）。
		*
		* 与 T1 的 `shell.ts` 的分工：`shell.ts` 负责「把一个页面注册进插槽 / 注册文案」这类**注册原语**，
		* 本文件负责**远程面与订阅**——`ctx.remote.$mount`、`remote.<namespace>.<method>`、
		* `remote.settings.describe/mutate`、`remote.$on("credentials/reference-updated")`、
		* `layout.selectPanel`。1c 真机实测后只改这两层。
		*
		* 逐条证据（本机已装的插件产物）：
		* - 挂载 + 取命名空间：`@mars-sea/dsh-commandcode-provider/lib/client.js:8900-8939`
		*   （`ctx.remote.$mount({package, descriptors})` → 成功后 `ctx.inject(["remote.<ns>"], …)`
		*   → `remoteCtx.remote.<ns>`，并带 `cancelled` 竞态旗标与 `ctx.effect` 清理）；
		* - 凭据订阅：同文件 `8882-8894`（`remote.$on("credentials/reference-updated", …)` 返回退订函数）
		*   与 `439-440`（调用前先 `typeof context.remote.$on === "function"` 判定）；
		* - 设置面：同文件 `8864-8870`（`ctx.inject(["remote.settings"], settingsCtx => settingsCtx.remote.settings)`）。
		*
		* **验证状态（2026-10-24 更正）**：这里原本写着「全部未验证」—— 那已经过时。下文
		* 各节记录了 21 处**桌面端实测**（`0.2.1-rc.1` / `0.2.1-rc.2` / `0.2.1-rc.3`）。
		*
		* 仍然保留**未知形状的防御式读取**（形状不可信时按缺省处理）：宿主的返回形状在
		* minor 版本间变过。但「这些接口存在、且调用方式如此」这件事已经用真机确认。
		* @module dsh-llm-account/src/client/seams
		*/
		/**
		* 把账号 ref 翻成可读名（用量卡片显示用）。
		*
		* 找不到就原样返回 ref —— 台账里可能留着已经被删掉的账号，显示 ref 比显示空白有用。
		* @param accounts - 该厂商当前的账号表。
		* @param ref - 台账里的账号 ref。
		* @returns 可读标签。
		*/
		function accountLabelOf(accounts, ref) {
			return accounts.find((account) => account.ref === ref)?.label ?? ref;
		}
		/**
		* 取 `ctx.remote`；形状不认识时返回 `undefined`（调用方一律按「远程不可用」降级）。
		*
		* **永不抛错**：宿主上下文是活对象，`ctx.remote` 可能是个 getter，在服务未就绪、插件被
		* 卸载或实现变更时直接抛。这个函数被渲染路径与 effect 大量调用，任何一次抛出都会变成
		* 「页面空白」或未处理异常，而它的语义本来就是「拿不到就降级」。
		* @param ctx - 客户端上下文。
		* @returns 远程服务面，或 `undefined`。
		*/
		function remoteOf(ctx) {
			try {
				const remote = ctx?.remote;
				if (typeof remote !== "object" || remote === null) return void 0;
				return remote;
			} catch {
				return;
			}
		}
		/**
		* 读已注册厂商的设置快照（页面「发现厂商」的依据，Ruling 2）。
		*
		* 只保留注册表里声明过的命名空间：宿主上可能还有别的插件命名空间，页面不该把它们当厂商。
		*
		* **返回形状（2026-10-17 在桌面端 0.2.1-rc.2 实测）**：`remote.settings.describe()` 返回的是
		* **一个对象**，命名空间数组包在 `namespaces` 里——不是裸数组：
		*
		* ```js
		* // 宿主 SettingsController.describe()（app.asar @21028751）
		* describe() {
		*   return {
		*     writable: settings.writable,
		*     hasDocument: true,
		*     namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),
		*   };
		* }
		* // namespaceView()（app.asar @21024548）：身份是 ns，不是 id
		* { ns, autoGenerate, schema, value, base?, user?, applies, secrets, revision }
		* ```
		*
		* 之前把返回值当数组遍历，于是永远遍历不到元素 → 页面显示「没有可显示的厂商」。
		* 这里两种形状都认（对象包 `namespaces` / 裸数组），不认识则按「读不到」降级并**报告原因**。
		*
		* @param ctx - 客户端上下文。
		* @param entries - 注册表里的厂商声明。
		* @returns 快照与失败诊断（读不到时快照为空数组、problem 有值）。
		*/
		async function discoverVendors(ctx, entries) {
			const settings = remoteOf(ctx)?.settings;
			if (settings === void 0 || typeof settings.describe !== "function") return {
				snapshots: [],
				problem: {
					kind: "remote-absent",
					detail: `ctx.remote${settings === void 0 ? "" : ".settings"} is unavailable; injected services: ${describeInject(ctx)}`
				}
			};
			let described;
			try {
				described = await settings.describe();
			} catch (error) {
				return {
					snapshots: [],
					problem: {
						kind: "describe-failed",
						detail: error instanceof Error ? error.message : String(error)
					}
				};
			}
			const unwrapped = unwrapRemote(described);
			if (!unwrapped.ok) return {
				snapshots: [],
				problem: {
					kind: "describe-failed",
					detail: unwrapped.error
				}
			};
			const rows = namespaceRowsOf(unwrapped.value);
			if (rows === void 0) return {
				snapshots: [],
				problem: {
					kind: "unknown-shape",
					detail: `describe() returned ${describeShape(unwrapped.value)}`
				}
			};
			const byRow = /* @__PURE__ */ new Map();
			for (const entry of entries) {
				if (entry.ns === "llm-account-features") continue;
				for (const rowId of entry.rowIds) byRow.set(rowId, entry);
				byRow.set(entry.ns, entry);
			}
			const snapshots = [];
			for (const row of rows) {
				if (typeof row !== "object" || row === null) continue;
				const rowName = [row.ns, row.id].find((candidate) => typeof candidate === "string");
				if (rowName === void 0) continue;
				const entry = byRow.get(rowName);
				if (entry === void 0) continue;
				const value = typeof row.value === "object" && row.value !== null ? row.value : {};
				snapshots.push({
					ns: entry.ns,
					row: rowName,
					value,
					revision: typeof row.revision === "number" ? row.revision : 0
				});
			}
			if (snapshots.length === 0) {
				const seen = rows.map((row) => typeof row === "object" && row !== null ? [row.ns, row.id].find((candidate) => typeof candidate === "string") : void 0).filter((name) => name !== void 0);
				const wanted = entries.flatMap((entry) => [entry.ns, ...entry.rowIds]);
				return {
					snapshots,
					problem: {
						kind: "no-match",
						detail: `host namespaces: ${seen.length ? seen.join(", ") : "(none)"} | this package looks for: ${wanted.join(", ")}`
					}
				};
			}
			return { snapshots };
		}
		/**
		* 读已注册厂商的设置快照（页面「发现厂商」的依据，Ruling 2）。
		*
		* 只要快照的薄封装；需要失败原因时用 {@link discoverVendors}。
		* @param ctx - 客户端上下文。
		* @param entries - 注册表里的厂商声明。
		* @returns 快照；读不到时为空数组。
		*/
		async function describeVendorSnapshots(ctx, entries) {
			return (await discoverVendors(ctx, entries)).snapshots;
		}
		/**
		* 拆开宿主远程调用的信封。
		*
		* 宿主契约（app.asar @17916049，`dsh-client-runtime` 的文档字符串）：**每一次一元调用都
		* resolve 成 `RemoteResult<T>`**，即 `{ ok: true, value }` 或 `{ ok: false, error }`，
		* **并且不会因为宿主侧失败而 reject**——离线载波与调用方中断都被折进 error 分支
		* （`gateway/cancelled`）。只有装配层面的故障（arity 不对、方法未挂载、贡献被撤回、
		* 缺 Context adapter）才会 reject。
		*
		* 实测（2026-10-17 桌面端 0.2.1-rc.1）：`remote.settings.describe()` 返回
		* `{ ok: true, value: { writable, hasDocument, namespaces } }`——**不是**裸载荷。
		* 之前把返回值直接当载荷，于是「命名空间列表」读成了信封本身。
		*
		* 未包信封的裸载荷也认（`ok` 缺席时整体当作载荷），这样本地替身与其它宿主形状都能用。
		* @param result - 远程调用的原始返回值。
		* @returns 成功时带载荷，失败时带可读原因（`error` 是活的 `RemoteError`，能取到 code）。
		*/
		function unwrapRemote(result) {
			if (typeof result !== "object" || result === null || !("ok" in result)) return {
				ok: true,
				value: result
			};
			const envelope = result;
			if (envelope.ok === true) return {
				ok: true,
				value: envelope.value
			};
			if (envelope.ok === false) return {
				ok: false,
				error: describeRemoteError(envelope.error)
			};
			return {
				ok: true,
				value: result
			};
		}
		/** 把宿主的 `RemoteError` 压成一行可读文本（`code` 与 message 都带，排查要靠 code）。 */
		function describeRemoteError(error) {
			if (typeof error === "string") return error;
			if (typeof error === "object" && error !== null) {
				const record = error;
				const code = typeof record.code === "string" ? record.code : void 0;
				const message = typeof record.message === "string" ? record.message : JSON.stringify(error);
				return code === void 0 ? message : `${code}: ${message}`;
			}
			return String(error);
		}
		/** 宿主返回值的形状摘要（诊断用，不含任何值）。 */
		function describeShape(value) {
			if (value === null) return "null";
			if (Array.isArray(value)) return `an array of ${value.length}`;
			if (typeof value !== "object") return typeof value;
			return `an object with keys [${Object.keys(value).join(", ")}]`;
		}
		/** 本包在客户端读到的服务（诊断用：说明哪些接缝到位了）。 */
		function describeInject(ctx) {
			const remote = remoteOf(ctx);
			if (remote === void 0) return "no ctx.remote at all";
			return `ctx.remote keys [${Object.keys(remote).join(", ")}]`;
		}
		/**
		* Pull the namespace list out of whatever `describe()` returned.
		*
		* @param described - the raw remote return value.
		* @returns the rows, or `undefined` when the shape is not recognised.
		*/
		function namespaceRowsOf(described) {
			if (Array.isArray(described)) return described;
			if (typeof described !== "object" || described === null) return void 0;
			const namespaces = described.namespaces;
			return Array.isArray(namespaces) ? namespaces : void 0;
		}
		/**
		* 订阅凭据变更推送。
		*
		* 与旧插件同样的防御：`$on` 缺席时返回一个什么都不做的退订函数，而不是抛错 —— 凭据徽标不刷新
		* 是降级，整个页面挂掉不是。
		* @param ctx - 客户端上下文。
		* @param listener - 收到推送时调用（本包用它 +1 凭据计数）。
		* @returns 退订函数。
		*/
		function subscribeCredentials(ctx, listener) {
			const remote = remoteOf(ctx);
			if (remote?.$on === void 0 || typeof remote.$on !== "function") return () => void 0;
			try {
				const off = remote.$on("credentials/reference-updated", () => listener());
				return typeof off === "function" ? off : () => void 0;
			} catch (error) {
				console.warn("[dsh-llm-account] could not subscribe to credential updates:", error);
				return () => void 0;
			}
		}
		/**
		* 打开中栏面板（仪表盘，T9）。
		*
		* 两种形状都认：旧插件用的是 `ctx.get("layout")?.selectPanel(id)`
		* （`@mars-sea/dsh-commandcode-provider/lib/client.js:9122`），而 1a 的假设文档里写的是
		* `ctx.layout.selectPanel`。先试服务读取，再回落到属性访问。
		* @param ctx - 客户端上下文。
		* @param panel - 面板标识；`null` 表示关闭面板。
		* @returns 是否真的打开了（宿主没有这个接缝时为 `false`，调用方可据此降级）。
		*/
		function selectPanel(ctx, panel) {
			const layout = (typeof ctx.get === "function" ? ctx.get("layout") : void 0) ?? ctx.layout;
			if (layout === void 0 || typeof layout.selectPanel !== "function") return false;
			layout.selectPanel(panel);
			return true;
		}
		/**
		* 远程读口统一拆信封。
		*
		* 宿主契约：每一次一元远程调用都 resolve 成 `RemoteResult<T>`（`{ ok: true, value }` 或
		* `{ ok: false, error }`），**宿主侧失败不 reject**（app.asar @17916049）。
		*
		* 这不是 `settings.describe()` 一处的问题——usage 远程面上的每一个读口（status /
		* accounts / switches / login / 额度）同样返回信封。实测（桌面端 0.2.1-rc.2）：
		* `namespace.status(vendor)` 给出的是信封，于是
		*   - `status.capabilities` 为 undefined → 页面渲染期抛错 → 整段设置页变空白；
		*   - `status.failures` 为 undefined → 侧边栏额度读口在 `.length` 上抛错 →
		*     状态从未更新，界面停在初始空态，显示「还没有请求经过这个账号」——**谎报**。
		* 两个症状都源于同一个「把信封当载荷」。
		* @param result - 远程调用的原始返回值（通常是一个 Promise）。
		* @returns 载荷；调用失败或形状不认识时为 `undefined`（调用方一律按「远程不可用」降级）。
		*/
		/**
		* 调一次远程读口，把**同步**抛错也折成被拒绝的 promise。
		*
		* 为什么需要：`remoteValueDetailed` 只等 promise，如果命名空间方法在返回 promise 之前就抛
		* （宿主代理未装、方法被撤下），异常会从调用点直接冒出去 —— 在登录按钮的点击处理器里
		* 就是「页面报错、界面毫无变化」，在 1s 的轮询定时器里就是未捕获异常。两条路都必须能落地。
		* @param call - 真正的远程调用（可能返回 `undefined`：远程面还没挂上）。
		* @returns 可供 {@link remoteValueDetailed} 消费的 promise；`undefined` 表示远程面缺席。
		*/
		function callRemote(call) {
			try {
				return call();
			} catch (error) {
				return Promise.reject(error);
			}
		}
		async function remoteValue(result) {
			const detailed = await remoteValueDetailed(result);
			return detailed.ok ? detailed.value : void 0;
		}
		/**
		* {@link remoteValue} 的带原因版本：失败时把宿主给的原文一起带出来。
		*
		* 为什么需要它：`remoteValue` 把失败压成 `undefined`，而界面只能说「账号数据暂不可用」——
		* 一句对四种不同病因（远程面没挂上 / 读口未装配 / 调用报错 / 形状不认识）都成立的空话。
		* 把原因一路带到卡片上，空态才能自证；这也是本地实测里唯一起作用的办法。
		* @param result - 远程调用的原始返回值。
		* @returns 成功时带载荷；失败时 `ok: false` 且 `problem` 是宿主原文（可读一行）。
		*/
		async function remoteValueDetailed(result) {
			let raw;
			try {
				raw = await result;
			} catch (error) {
				return {
					ok: false,
					problem: error instanceof Error ? error.message : String(error)
				};
			}
			const unwrapped = unwrapRemote(raw);
			return unwrapped.ok ? {
				ok: true,
				value: unwrapped.value
			} : {
				ok: false,
				problem: unwrapped.error
			};
		}
		/** 带原因的状态读口：命名空间缺席也要给出原因（那是最常见的一种）。 */
		async function readStatusDetail(namespace, vendor) {
			if (namespace === void 0) return {
				status: void 0,
				problem: `the ${USAGE_NAMESPACE} remote namespace is not mounted`
			};
			if (typeof namespace.status !== "function") return {
				status: void 0,
				problem: `the ${USAGE_NAMESPACE} remote namespace has no status()`
			};
			const detailed = await remoteValueDetailed(namespace.status(vendor));
			return detailed.ok ? {
				status: detailed.value,
				problem: void 0
			} : {
				status: void 0,
				problem: detailed.problem
			};
		}
		/**
		* 读一个厂商的**未过滤**模型目录（设置页勾选列表）。
		*
		* 失败不抛：页面要显示可读原因与「重试」，而不是把「读不到」渲染成「没有模型」。
		* @param namespace - 已挂载的远程命名空间。
		* @param vendor - 厂商 id。
		* @returns 目录与失败项。
		*/
		async function readModels(namespace, vendor) {
			if (namespace === void 0 || typeof namespace.models !== "function") return {
				models: [],
				failures: [`the ${USAGE_NAMESPACE} remote namespace has no models()`]
			};
			const detailed = await remoteValueDetailed(namespace.models(vendor));
			if (detailed.ok && detailed.value !== void 0) return detailed.value;
			return {
				models: [],
				failures: [detailed.ok ? `${USAGE_NAMESPACE}/models returned no value` : detailed.problem]
			};
		}
		/**
		* 读磁盘上**当前安装**的版本（宿主侧的 `package.json.version`）。
		*
		* 用途：插件刚更新完时，给「请刷新页面」的提示填上真实的新版本号。
		* 读不到就返回 `undefined` —— 提示照弹（核心信息是「该刷新了」），只是不显示版本。
		* @param namespace - 已挂载的远程命名空间。
		* @returns 版本字符串，或 `undefined`。
		*/
		async function readInstalledVersion(namespace) {
			if (namespace === void 0 || typeof namespace.installedVersion !== "function") return void 0;
			try {
				const detailed = await remoteValueDetailed(namespace.installedVersion());
				if (!detailed.ok) return void 0;
				const value = detailed.value;
				return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
			} catch {
				return;
			}
		}
		/**
		* 挂载客户端侧的远程面，并在它出现后取到命名空间对象。
		*
		* 形状逐字对齐旧插件（`lib/client.js:8911-8939`）：`$mount` 是异步的，成功后**再**注入
		* `remote.<namespace>`；用 `cancelled` 旗标处理「还没挂上就卸载」的竞态；全部经 `ctx.effect`
		* 登记释放。
		* @param ctx - 客户端上下文。
		* @param onChange - 命名空间可用性变化时调用（成功与失败都会调用）。
		* @returns 观察窗口；宿主没有 `$mount` 时返回一个「不可用」的句柄。
		*/
		function mountUsageRemote(ctx, onChange) {
			const remote = remoteOf(ctx);
			let namespace;
			let failure;
			let cancelled = false;
			let gone = false;
			let unmount;
			const notify = () => onChange?.(namespace, failure);
			const release = () => {
				cancelled = true;
				namespace = void 0;
				unmount?.();
			};
			const start = () => {
				if (remote?.$mount === void 0 || typeof remote.$mount !== "function") {
					failure = `the host remote service has no $mount(); the ${USAGE_NAMESPACE} remote cannot be used`;
					notify();
					return;
				}
				remote.$mount({
					package: USAGE_PACKAGE,
					descriptors: usageDescriptors()
				}).then((dispose) => {
					if (cancelled) {
						dispose();
						return;
					}
					unmount = dispose;
					const inject = ctx.inject;
					if (typeof inject !== "function") {
						failure = `this host context has no inject(); the ${USAGE_NAMESPACE} namespace cannot be read`;
						notify();
						return;
					}
					inject([`remote.${USAGE_NAMESPACE}`], (scoped) => {
						namespace = remoteOf(scoped)?.[USAGE_NAMESPACE];
						notify();
					});
				}, (error) => {
					failure = error instanceof Error ? error.message : String(error);
					notify();
				});
			};
			if (typeof ctx.effect === "function") ctx.effect(() => {
				start();
				return () => {
					gone = true;
					release();
				};
			}, "dsh-llm-account: usage remote");
			else start();
			return {
				namespace: () => namespace,
				error: () => failure,
				disposed: () => gone,
				dispose: () => {
					gone = true;
					release();
				}
			};
		}
		/**
		* 派发一次账户操作。
		*
		* 名称与密钥都在**边界上 trim**：用户粘贴的密钥常带换行/尾随空格，名称常带无意空格，
		* 原样提交会把它们写进宿主（标签页显示、凭据槽内容）。
		* @param usage - 已挂载的远程命名空间；还没挂上时为 `undefined`。
		* @param vendor - 厂商 id。
		* @param action - `page-state.ts` 里的操作草稿。
		* @returns 已**拆信封**的结果；不可用或输入不合法时为 `undefined`（调用方据此不关草稿）。
		*/
		function dispatchAccountAction(usage, vendor, action) {
			if (usage === void 0) return void 0;
			/**
			* 解开宿主信封。
			*
			* 非信封（裸载荷 / `undefined`）一律按成功处理：老宿主可能直接 resolve 结果本身，
			* 那种形状没有 `ok` 字段，按 `unwrapRemote` 的同一条规则。
			*/
			const unwrap = async (pending) => {
				const result = await pending;
				if (typeof result !== "object" || result === null || !("ok" in result)) return {
					ok: true,
					value: result
				};
				const envelope = result;
				if (envelope.ok === false) return {
					ok: false,
					problem: describeRemoteError(envelope.error)
				};
				return {
					ok: true,
					value: envelope.value
				};
			};
			switch (action.kind) {
				case "add": {
					const label = action.label.trim();
					if (label === "") return void 0;
					const key = action.key.trim();
					return unwrap(usage.addAccount(vendor, key === "" ? { label } : {
						label,
						key
					}));
				}
				case "rename": {
					if (action.ref === void 0 || action.ref === null) return void 0;
					const label = action.label.trim();
					if (label === "") return void 0;
					return unwrap(usage.renameAccount(vendor, action.ref, label));
				}
				case "key": {
					if (action.ref === void 0 || action.ref === null) return void 0;
					const key = action.key.trim();
					if (key === "") return void 0;
					return unwrap(usage.replaceKey(vendor, action.ref, key));
				}
				case "restoreName":
					/**
					* 一键恢复默认名。
					*
					* 与「改名」的区别：不打开表单、不需要用户再确认一次 —— 恢复成默认名是个**确定
					* 且可逆**的操作（默认名就在账号条目里），多一步确认只是麻烦。
					*
					* 走 `restoreAccountName` 而不是客户端算好默认名再调 `renameAccount`：默认名的
					* 唯一真相在宿主侧，客户端读到的副本可能已经过期（另一个窗口刚改过名）。
					*/
					if (action.ref === void 0 || action.ref === null) return void 0;
					if (typeof usage.restoreAccountName !== "function") return void 0;
					return unwrap(usage.restoreAccountName(vendor, action.ref));
				case "select":
					/**
					* 切换到此账户（2026-10-22 补上）。
					*
					* 这个分支以前**完全不存在** —— `capabilities.pin` 声明支持、宿主也有
					* `selectAccount`，但客户端的动作类型里没有 `select`，于是账户卡上那个
					* 「切换到此账户」菜单项发不出任何调用。用户选不了账号，侧边栏只能回退到
					* `accounts[0]`（报障原话：「侧边栏没跟随我选定的账号」）。
					*
					* `ref === null` 表示回到自动轮换，这是宿主契约里明确的语义，所以**不能**把
					* `null` 当成「没选」而提前 return —— 那会让「取消固定」这个操作失效。
					*/
					if (action.ref === void 0) return void 0;
					return unwrap(usage.selectAccount(vendor, action.ref));
			}
		}
		/** 登录轮询间隔（毫秒）。等待授权时的轮询是**唯一的**后台请求来源，且随状态起停。 */
		const LOGIN_POLL_MS = 1e3;
		/**
		* 是否继续轮询登录状态：只有 `waiting` 才需要（其余状态是终态或还没开始）。
		*
		* 单独成函数是为了能被单测：容器里的定时器本身不参与单测（Ruling 22），但「什么时候该继续
		* 问」是会出错的地方，而且它关系到「不做无谓的后台请求」这条要求。
		* @param login - 当前登录状态。
		* @returns 是否继续轮询。
		*/
		function shouldPollLogin(login) {
			return login?.state === "waiting";
		}
		/**
		* 登录状态读不出来时的落点。
		*
		* 必须是**非 waiting** 状态：读失败却写成 `waiting` 会让轮询永不停（每 1s 一次
		* 注定失败的远程调用）。`idle` 让卡片回到「未开始」，与「没登录过」一致。
		*/
		const LOGIN_UNKNOWN = { state: "idle" };
		/**
		* 读用量报表时传的窗口。
		*
		* 账号下面的数字是**该账号自己的账期**聚合（`AccountUsage.period`），与这个窗口无关 ——
		* 窗口只影响报表里那份总账（界面已经不显示它了）。仍旧传一个合法的值，是因为宿主的
		* 边界校验要求它在白名单里；`all` 最省事：不受时间影响，重读时不会因为跨天而变。
		*/
		const USAGE_REPORT_WINDOW = "all";
		/**
		* 把远程读回来的载荷整理成**一定能安全渲染**的报表。
		*
		* 两道保险，缺一不可：
		* 1. 载荷可能不是对象（宿主 resolve 成 `undefined` / `null`）：给一份空报表，别把
		*    `undefined` 塞进 `usageReport` —— 渲染层每个账号都要 `usageReport.accounts.find(...)`，
		*    一次 `.find of undefined` 就是整页崩（2026-10-19 真实报障）。
		* 2. `accounts` 不是数组时同样归零：边界校验器（`usage-contract`）在**远程描述符**那一侧会
		*    挡掉坏形状并抛错，但那条路径只在宿主真的走 typert 网关时生效；客户端本地替身、
		*    旧宿主、以及「信封里包着一个半成品」的情况都得在这里兜住。
		* @param value - 远程调用解包后的载荷。
		* @returns 可安全渲染的报表；没有数据时为 `undefined`（不画用量块）。
		*/
		function reportOf(value) {
			if (typeof value !== "object" || value === null) return void 0;
			const accounts = Array.isArray(value.accounts) ? value.accounts : [];
			const total = typeof value.total === "object" && value.total !== null ? value.total : void 0;
			if (total === void 0 || typeof total.bucket !== "object" || total.bucket === null) return {
				accounts,
				...value.lastUsed === void 0 ? {} : { lastUsed: value.lastUsed },
				...value.failuresByKind === void 0 ? {} : { failuresByKind: value.failuresByKind },
				...value.failuresByAccount === void 0 ? {} : { failuresByAccount: value.failuresByAccount },
				total: {
					window: USAGE_REPORT_WINDOW,
					bucket: {
						period: USAGE_REPORT_WINDOW,
						since: 0,
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						requests: 0,
						ok: 0,
						failed: 0
					},
					byVendor: []
				}
			};
			return {
				accounts,
				total: {
					window: total.window ?? USAGE_REPORT_WINDOW,
					bucket: total.bucket,
					byVendor: Array.isArray(total.byVendor) ? total.byVendor : [],
					...typeof total.lastAt === "number" && Number.isFinite(total.lastAt) ? { lastAt: total.lastAt } : {}
				},
				...value.lastUsed === void 0 ? {} : { lastUsed: value.lastUsed },
				...value.failuresByKind === void 0 ? {} : { failuresByKind: value.failuresByKind },
				...value.failuresByAccount === void 0 ? {} : { failuresByAccount: value.failuresByAccount }
			};
		}
		/**
		* 把 CSV 文本变成一次浏览器下载。
		*
		* 为什么用 Blob + `a[download]` 而不是让宿主写文件：浏览器侧本来就有下载能力，写盘会把
		* 「文件存在哪、要不要覆盖」变成两个新问题；而这段代码跑在页面里，下载目录由浏览器决定。
		*
		* 三处必须记得收尾（否则会漏内存或留下隐藏节点）：`createObjectURL` 要 `revoke`、
		* 临时 `<a>` 要摘掉。`document` 缺席时（纯单测环境）**静默跳过** —— 这不是失败路径，
		* 导出本身已经成功了。
		* @param csv - CSV 文本。
		* @param fileName - 文件名（缺省带日期，便于多次导出区分）。
		*/
		function downloadCsv(csv, fileName) {
			const doc = globalThis.document;
			if (doc === void 0 || typeof URL.createObjectURL !== "function") return;
			const stamp = /* @__PURE__ */ new Date();
			const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
			const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const anchor = doc.createElement("a");
			anchor.href = url;
			anchor.download = fileName ?? `dsh-usage-${day}.csv`;
			anchor.style.display = "none";
			doc.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 0);
		}
		/** 造**容器组件**：持有页面状态、订阅宿主推送与共享远程面、把回调接上，然后渲染 `PageShell`。
		*
		* 这是本层唯一使用 Hook 的地方，刻意做得极薄：所有判定都在 `page-state.ts` / `dispatchAccountAction`
		* / `shouldPollLogin` 里（纯函数、完整单测），这里只负责「状态放哪、什么时候重新读」。
		* 因此它**不参与单测**（测试用的 React 替身会把 Hook 调用判为失败）—— 自觉的取舍，1c 的真机
		* 渲染是它的验证。
		*
		* 远程面是**插件级共享**的（`ensureUsageRemote`）：本容器只订阅它的可用性，不持有它的生命周期 ——
		* 设置页关掉不该把侧边栏卡片与中栏面板的数据源一起带走（旧插件把 usage remote 挂在 apply 期，
		* 本机产物可读）。
		* @param options - 见 {@link ConnectedPageOptions}。
		* @returns 一个 React 函数组件。
		*/
		function createConnectedPage(options) {
			const component = createConnectedPageBody(options);
			return () => (0, react.createElement)(RenderBoundary, {
				title: "LLM 账号",
				note: "这一块渲染失败了，其它设置不受影响。可以点「重试」，或把下面的信息反馈给插件作者。",
				retryLabel: "重试"
			}, renderWithBoundary(component));
		}
		/**
		* 同步渲染兜底：容器自身抛错时返回可读面板，而不是让异常穿到宿主。
		* @param component - 容器本体。
		* @returns 页面树或错误面板。
		*/
		function renderWithBoundary(component) {
			try {
				return component();
			} catch (error) {
				console.error("[dsh-llm-account] the settings page crashed while rendering:", error);
				return renderBoundaryPanel(error);
			}
		}
		/**
		* 渲染失败时的可读面板（与 `PageShell` 的兜底同形）。
		*
		* 设置条目在、点进去空白，是「渲染期抛错」的典型症状 —— React 丢弃整棵子树，控制台
		* 之外没有任何线索。把异常原文印在页面上，用户能直接把它贴回来。
		* @param error - 捕获到的异常。
		* @returns 错误面板元素。
		*/
		function renderBoundaryPanel(error) {
			const detail = error instanceof Error ? error.stack ?? error.message : String(error);
			return (0, react.createElement)("div", {
				"data-page": "llm-account",
				"data-render-error": "true",
				className: CSS_CLASS.root
			}, (0, react.createElement)("h1", null, "LLM 账号"), (0, react.createElement)("p", { className: CSS_CLASS.intro }, "页面渲染失败，请把下面这段信息反馈给插件作者。"), (0, react.createElement)("pre", { className: CSS_CLASS.diagnostic }, `render failed: ${detail}`));
		}
		/** 容器本体（Hook + 组装）；由 {@link createConnectedPage} 包进错误边界。 */
		function createConnectedPageBody(options) {
			const { ctx } = options;
			const entries = options.entries.filter((entry) => entry.ns !== FEATURE_TAB_NS);
			const allEntries = options.entries;
			const t = options.t ?? dictionaryOf("zh");
			return function ConnectedPage() {
				const [state, setState] = (0, react.useState)(() => createPageState(allEntries, []));
				const [usage, setUsage] = (0, react.useState)(void 0);
				/** usage 远程面**挂载**失败的原因（`undefined` = 没失败或在挂载中）。 */
				const [usageProblem, setUsageProblem] = (0, react.useState)(void 0);
				/** 逐厂商的状态读口失败原因（读口在、但调用失败）。 */
				const [statusProblems, setStatusProblems] = (0, react.useState)({});
				const [logins, setLogins] = (0, react.useState)({});
				/** 正在启动网页登录的厂商（远程调用还没回来）：按钮禁用 + 「正在启动…」。 */
				const [loginStarting, setLoginStarting] = (0, react.useState)({});
				/**
				* 网页登录**调用没能发出去**的原因（宿主原文），按厂商。
				*
				* 与 `logins[vendor].reason` 分工：那里是登录流程给的稳定原因键；这里是远程面没挂上、
				* 宿主装配报错这类「流程根本没跑起来」的原文。以前这类失败被 `void … .then(…)`
				* 静默吞掉 —— 点了「网页登录」什么都不发生（本机报障的第二种现象）。
				*/
				const [loginErrors, setLoginErrors] = (0, react.useState)({});
				/**
				* 已收起的等待面板（按厂商）。
				*
				* 两种进入方式：用户**关掉了弹出的授权窗口**（他已不打算继续），或期限到了。
				* 收起只是不渲染，**不取消**宿主流程 —— 关闭那一刻他可能刚批准，取消会把成功误杀；
				* 轮询继续到终态，成功后账号照常刷新。
				*/
				const [loginDismissed, setLoginDismissed] = (0, react.useState)({});
				const [statuses, setStatuses] = (0, react.useState)({});
				/** 首次状态读取是否仍在进行（区分加载中/读失败）。 */
				const [statusLoading, setStatusLoading] = (0, react.useState)(() => Object.fromEntries(entries.map((entry) => [entry.providerId, true])));
				/** 每个厂商的未过滤目录（`models()` 的结果）；还没读到时缺省。 */
				const [modelCatalogs, setModelCatalogs] = (0, react.useState)({});
				/** 目录读取中（按厂商）。 */
				const [modelCatalogLoading, setModelCatalogLoading] = (0, react.useState)({});
				/** 正在保存的命名空间（卡片级保存按钮的即时反馈）。 */
				const [savingNs, setSavingNs] = (0, react.useState)(void 0);
				/** 账户操作计数：每次成功的操作 +1，用来触发一次状态重读。 */
				const [accountRevision, setAccountRevision] = (0, react.useState)(0);
				/** 导出进行中（按钮禁用，避免连点导出两份）。 */
				const [exportBusy, setExportBusy] = (0, react.useState)(false);
				/** 上一次导出失败的原因（人话）；成功即清掉。 */
				const [exportError, setExportError] = (0, react.useState)(void 0);
				/** 清空台账：进行中、二次确认是否展开、失败原因。 */
				const [clearBusy, setClearBusy] = (0, react.useState)(false);
				const [clearConfirming, setClearConfirming] = (0, react.useState)(false);
				const [clearError, setClearError] = (0, react.useState)(void 0);
				/**
				* 上一次账户操作没提交出去的原因（人话）。
				*
				* 只在「容器知道为什么没发出去」时设置：空名称/空密钥（`dispatchAccountAction` 的规矩）、
				* 远程面还没挂上、以及远程调用真的 reject（以前是**静默丢失**的 —— `void pending.then(…)`
				* 没有失败分支）。用户一改字段或取消就清掉。
				*/
				const [actionError, setActionError] = (0, react.useState)(void 0);
				/**
				* 挂载后的**第一次**状态读取是否已经发生：只有那一次允许吃模块级缓存。
				* 修订号变化（凭据 / 账号操作）意味着数据真的变了，必须现读（见 `STATUS_READING_TTL_MS`）。
				*/
				const initialStatusRead = (0, react.useRef)(false);
				/** 本轮登录为授权页开的占位窗口（用户手势里同步打开，见 `login-window.ts`）。 */
				const loginPopup = (0, react.useRef)(void 0);
				/** 登录轮询连续失败次数（按厂商）：单次抖动不该把等待面板打掉，连续失败才判成读不到。 */
				const loginPollMisses = (0, react.useRef)({});
				/** 每家的等待期限（epoch 毫秒）：宿主报了 `expiresAt` 就用它，否则按首次观察 + 默认 TTL。 */
				const loginDeadlines = (0, react.useRef)({});
				/**
				* 这一家的这次等待是否**已经收尾**（超时/取消/终态）。
				*
				* 为什么需要：定时器是每秒一拍，`advanceTimers` 或慢网络下会有**多拍同时在途**；
				* 第一拍判定超时后，后面几拍迟到的 `waiting` 响应会把面板又装回去（实测：到期后面板
				* 闪回来）。收尾之后一律不再采纳 `waiting`。
				*/
				const loginClosed = (0, react.useRef)({});
				/** 采纳一次发现结果：页面状态与侧边栏开关存储（同一来源、两个消费者）。 */
				const adopt = (discovery) => {
					const { snapshots, problem } = discovery;
					if (snapshots.length === 0) {
						if (problem !== void 0) setState((current) => createPageState(allEntries, snapshots, current, problem));
						return;
					}
					latestSnapshots.current = Object.fromEntries(snapshots.map((snapshot) => [snapshot.ns, snapshot]));
					const carrier = allEntries.find((entry) => entry.ns === FEATURE_TAB_NS)?.rowIds[0];
					const carrierRow = carrier === void 0 ? void 0 : latestSnapshots.current[carrier];
					if (carrierRow !== void 0) latestSnapshots.current[FEATURE_TAB_NS] = {
						ns: FEATURE_TAB_NS,
						row: carrierRow.row,
						value: { ...carrierRow.value },
						revision: carrierRow.revision
					};
					noteSidebarSnapshots(entries, snapshots);
					setState((current) => createPageState(allEntries, snapshots, current, problem));
				};
				/**
				* 设置写入的**串行队列**（每次写入完成前，下一次排队等它）。
				*
				* 为什么必须有：宿主用修订号做并发围栏（`mutate(row, ops, expectedRevision)`），而每次成功
				* 写入都会把修订号 +1。用户快速拨两个开关（或点两次「填入」）时，第二次调用若拿着**渲染时**
				* 那份快照的修订号，就会撞上自己前一次写入刚产生的新修订号 —— 表现是「刚改的又被改回去」
				* 或界面上冒出一条莫名其妙的冲突错误。排队保证：任何时刻只有一次写入在途，且它用的永远是
				* **最近一次**读到的修订号。
				*/
				const writeQueue = (0, react.useRef)(Promise.resolve());
				/**
				* 每次读取/写入后的最新快照（同步可读）。
				*
				* `state` 是渲染时的闭包变量，异步回调里读到的永远是**那一刻**的值。写入排队后必须要拿到
				* 「轮到我的时候」的修订号与行名，所以另存一份同步镜像，由 `adopt` 与写入结果共同维护。
				*/
				const latestSnapshots = (0, react.useRef)({});
				/** 正在保存的行（同一个 ns 不并发发两份写）。 */
				const savingRowInFlight = (0, react.useRef)(/* @__PURE__ */ new Set());
				/**
				* 「在途期间又被要求写一次」的行（2026-10-20 独立审查发现 1）。
				*
				* 修的是这个缺陷：旧实现在在途时**提前返回**在途的 promise 而**不排队**，注释却写着
				* 「把这一轮排到它后面」—— 于是同一行的第二次写入既没落盘、也没有任何提示。
				* 可达路径：搜索密钥的删除按钮没有 busy 守卫，一次往返内点两个删除，第二个就被静默吞掉
				* （磁盘上的 `searchApiKeyRefs` 仍留着用户以为已经删掉的引用名）。
				*
				* 现在：在途时只做标记，由在途那轮**收尾时再排一轮**，那一轮会现读最新草稿 ——
				* 两次点击的效果都能落盘。
				*/
				const saveRowPending = (0, react.useRef)(/* @__PURE__ */ new Set());
				/**
				* 最新草稿的**同步镜像**（按 ns）。`state` 在异步回调/排队回调里是旧闭包，见 `saveRow`。
				* 由渲染期（每次渲染都写）与 `setField` 的结果共同维护。
				*/
				const latestDrafts = (0, react.useRef)({});
				/**
				* 把**某一家**的全部草稿写入设置文档（卡片底部的保存按钮）。
				*
				* 串行队列 + 每次现取修订号（见 {@link writeQueue}）：
				* 1. 排队期间用户又改了别的字段 —— 轮到执行时重新读一次草稿，写进去的是**最新**那一份；
				* 2. 修订号在轮到执行时才取，所以连续两次保存不会撞上自己上一次写入产生的修订号。
				*
				* 失败不静默：原因进 `saveErrors`，页面在**对应卡片里**显示。
				* 成功与失败都重读设置文档：成功是为了拿到新修订号，失败更是必须 —— 用户再点一次保存时，
				* 若基线还停在旧修订号，那次重试会撞上同一个冲突，看起来像「怎么存都存不上」。
				* @param ns - 设置命名空间（页面身份，也是错误归属的键）。
				* @returns 这次写入的完成信号（调用方通常不 await）。
				*/
				const saveRow = (ns) => {
					if (savingRowInFlight.current.has(ns)) {
						saveRowPending.current.add(ns);
						return writeQueue.current;
					}
					const snapshot = latestSnapshots.current[ns];
					if (snapshot === void 0) {
						setState((current) => noteSaveResult(current, ns, "this namespace has not been read yet"));
						return Promise.resolve();
					}
					savingRowInFlight.current.add(ns);
					setSavingNs(ns);
					writeQueue.current = writeQueue.current.then(async () => {
						const fields = draftFieldsOf(ns);
						if (fields.length === 0) return;
						const latest = latestSnapshots.current[ns] ?? snapshot;
						const error = await saveSettings(ctx, latest.row ?? ns, fields, latest.revision);
						setState((current) => noteSaveResult(current, ns, error, fields.map((field) => field.key)));
						adopt(await discoverVendors(ctx, entries));
					}).catch((error) => {
						setState((current) => noteSaveResult(current, ns, error instanceof Error ? error.message : String(error)));
					}).then(() => {
						savingRowInFlight.current.delete(ns);
						if (savingRowInFlight.current.size === 0) setSavingNs(void 0);
						if (saveRowPending.current.delete(ns)) saveRow(ns);
					});
					return writeQueue.current;
				};
				/**
				* 某一家当前的草稿字段（**同步**，从最新的页面状态取）。
				*
				* 不能读渲染闭包里的 `state`：`saveRow` 是排队的，轮到它时闭包已经过期了。
				* @param ns - 设置命名空间。
				* @returns 待写的字段；没有草稿时为空数组。
				*/
				const draftFieldsOf = (ns) => Object.entries(latestDrafts.current[ns] ?? {}).map(([key, value]) => ({
					key,
					value
				}));
				/**
				* 立刻写**一个**字段并重读（不经过草稿，也不等卡片上的保存按钮）。
				*
				* 用于那些「本身就是一次完整动作」的设置写入 —— 目前只有搜索密钥的引用名列表：
				* 加钥匙 / 删钥匙都是一个已经完成的决定，没有「填完再点保存」的中间状态。
				* 走同一条串行队列，所以不会与用户同时拨的开关撞修订号。
				* @param ns - 设置命名空间。
				* @param key - 字段名。
				* @param value - 新值。
				* @returns 这次写入的完成信号。
				*/
				const saveOneField = (ns, key, value) => {
					const baseline = latestSnapshots.current[ns]?.value;
					const next = draftsAfterChange(latestDrafts.current[ns], baseline, key, value);
					const drafts = { ...latestDrafts.current };
					if (next === void 0) delete drafts[ns];
					else drafts[ns] = next;
					latestDrafts.current = drafts;
					setState((current) => setField(current, ns, key, value));
					return saveRow(ns);
				};
				/**
				* 承载行当前的密钥引用名（**草稿优先**）。
				*
				* 为什么先看草稿：用户刚添加一条，列表先进草稿，`adopt` 要等一次往返才把它吸收进快照。
				* 期间点删除（或紧接着再加一条）若只读快照，就会看不见刚刚那条 —— 症状是「点了 × 没反应」。
				* @returns 引用名列表。
				*/
				const currentKeyRefsOf = () => {
					const raw = latestDrafts.current["llm-account-features"]?.["searchApiKeyRefs"] ?? latestSnapshots.current["llm-account-features"]?.value?.["searchApiKeyRefs"] ?? state.snapshots["llm-account-features"]?.value?.["searchApiKeyRefs"];
					if (Array.isArray(raw)) return raw.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
					return parseSecretRefs(typeof raw === "string" ? raw : "");
				};
				latestDrafts.current = state.drafts;
				(0, react.useEffect)(() => {
					let alive = true;
					const guarded = (discovery) => {
						if (alive) adopt(discovery);
					};
					discoverVendors(ctx, entries).then(guarded).catch((error) => {
						console.warn("[dsh-llm-account] could not read the vendor snapshots:", error);
					});
					let off = () => void 0;
					try {
						off = subscribeCredentials(ctx, () => setState((current) => noteCredentialChange(current)));
					} catch (error) {
						console.warn("[dsh-llm-account] could not subscribe to credential updates:", error);
					}
					let offUsage = () => void 0;
					try {
						offUsage = onUsageReady(ctx, (namespace, problem) => {
							if (!alive) return;
							setUsage(namespace);
							setUsageProblem(problem);
						});
					} catch (error) {
						console.warn("[dsh-llm-account] could not watch the usage remote:", error);
					}
					return () => {
						alive = false;
						off();
						offUsage();
					};
				}, []);
				(0, react.useEffect)(() => {
					let alive = true;
					discoverVendors(ctx, entries).then((discovery) => {
						if (alive) adopt(discovery);
					}).catch((error) => {
						console.warn("[dsh-llm-account] could not read the vendor snapshots:", error instanceof Error ? error.message : String(error));
					});
					if (usage !== void 0) {
						const useCache = !initialStatusRead.current;
						initialStatusRead.current = true;
						for (const entry of entries) {
							const cached = useCache ? statusReadings.get(entry.providerId) : void 0;
							if (cached !== void 0) {
								setStatuses((current) => ({
									...current,
									[entry.providerId]: cached
								}));
								setStatusProblems((current) => ({
									...current,
									[entry.providerId]: void 0
								}));
								setStatusLoading((current) => ({
									...current,
									[entry.providerId]: false
								}));
								continue;
							}
							readStatusDetail(usage, entry.providerId).then(({ status, problem }) => {
								if (!alive) return;
								if (status !== void 0 && completeReading(status)) statusReadings.put(entry.providerId, status);
								if (status !== void 0) setStatuses((current) => ({
									...current,
									[entry.providerId]: status
								}));
								setStatusProblems((current) => ({
									...current,
									[entry.providerId]: problem
								}));
								setStatusLoading((current) => ({
									...current,
									[entry.providerId]: false
								}));
							});
						}
					}
					return () => {
						alive = false;
					};
				}, [
					usage,
					state.credentialRevision,
					accountRevision
				]);
				(0, react.useEffect)(() => {
					if (usageProblem === void 0) return;
					setStatusLoading(Object.fromEntries(entries.map((entry) => [entry.providerId, false])));
				}, [usageProblem]);
				(0, react.useEffect)(() => () => {
					closeLoginWindow(loginPopup.current);
					loginPopup.current = void 0;
				}, []);
				const waitingVendors = entries.map((entry) => entry.providerId).filter((vendor) => shouldPollLogin(logins[vendor]));
				(0, react.useEffect)(() => {
					if (usage === void 0 || waitingVendors.length === 0) return;
					const timer = setInterval(() => {
						for (const vendor of waitingVendors) remoteValueDetailed(callRemote(() => usage.loginStatus(vendor))).then((detail) => {
							if (loginClosed.current[vendor] === true) return;
							if (!detail.ok || detail.value === void 0) {
								const misses = (loginPollMisses.current[vendor] ?? 0) + 1;
								loginPollMisses.current[vendor] = misses;
								if (misses >= 3) {
									setLogins((current) => ({
										...current,
										[vendor]: {
											state: "failed",
											reason: "network"
										}
									}));
									setLoginErrors((current) => ({
										...current,
										[vendor]: detail.ok ? t("account.loginFailed") : detail.problem
									}));
								}
								return;
							}
							loginPollMisses.current[vendor] = 0;
							const status = detail.value;
							if (status.state === "waiting") {
								const deadline = status.expiresAt ?? loginDeadlines.current[vendor] ?? Date.now() + 12e4;
								loginDeadlines.current[vendor] = deadline;
								if (Date.now() >= deadline) {
									loginClosed.current[vendor] = true;
									setLogins((current) => ({
										...current,
										[vendor]: {
											state: "failed",
											reason: "timeout"
										}
									}));
									setLoginErrors((current) => ({
										...current,
										[vendor]: void 0
									}));
									setLoginDismissed((current) => current[vendor] === void 0 ? current : {
										...current,
										[vendor]: false
									});
									loginDeadlines.current[vendor] = void 0;
									return;
								}
								if (loginPopup.current?.closed === true) setLoginDismissed((current) => current[vendor] === true ? current : {
									...current,
									[vendor]: true
								});
								setLogins((current) => ({
									...current,
									[vendor]: status
								}));
								return;
							}
							loginClosed.current[vendor] = true;
							loginDeadlines.current[vendor] = void 0;
							setLoginDismissed((current) => current[vendor] === void 0 ? current : {
								...current,
								[vendor]: false
							});
							setLogins((current) => ({
								...current,
								[vendor]: status
							}));
							if (status.state === "success") setAccountRevision((current) => current + 1);
						});
					}, LOGIN_POLL_MS);
					return () => clearInterval(timer);
				}, [usage, waitingVendors.join(",")]);
				const availableEntries = entries.filter((entry) => entry.ns !== "llm-account-features" && state.tabs.some((tab) => tab.ns === entry.ns));
				const modelVendorKey = availableEntries.map((entry) => entry.providerId).join(",");
				const credentialKey = currentKeyRefsOf().join(",");
				(0, react.useEffect)(() => {
					const status = usage?.credentialStatus;
					if (status === void 0) return;
					if (credentialKey === "") {
						setCredentialStatus({});
						return;
					}
					let alive = true;
					const ask = status;
					const keyNow = credentialKey;
					remoteValue(callRemote(() => ask(keyNow.split(",")))).then((rows) => {
						if (!alive) return;
						if (!Array.isArray(rows)) return;
						const next = {};
						for (const row of rows) if (typeof row?.ref === "string") next[row.ref] = row.configured === true;
						setCredentialStatus(next);
					}).catch(() => {});
					return () => {
						alive = false;
					};
				}, [
					usage,
					credentialKey,
					state.credentialRevision
				]);
				(0, react.useEffect)(() => {
					if (usage === void 0) return;
					const targets = entries.filter((entry) => state.tabs.some((tab) => tab.ns === entry.ns));
					if (targets.length === 0) return;
					let alive = true;
					const toRead = [];
					for (const entry of targets) {
						const cached = catalogReadings.get(entry.providerId);
						if (cached === void 0) {
							toRead.push(entry);
							continue;
						}
						setModelCatalogs((current) => ({
							...current,
							[entry.providerId]: cached
						}));
						setModelCatalogLoading((current) => ({
							...current,
							[entry.providerId]: false
						}));
					}
					if (toRead.length > 0) {
						setModelCatalogLoading((current) => {
							const next = { ...current };
							for (const entry of toRead) next[entry.providerId] = true;
							return next;
						});
						for (const entry of toRead) readModels(usage, entry.providerId).then((result) => {
							if (!alive) return;
							if (result.failures.length === 0) catalogReadings.put(entry.providerId, result);
							setModelCatalogs((current) => ({
								...current,
								[entry.providerId]: result
							}));
							setModelCatalogLoading((current) => ({
								...current,
								[entry.providerId]: false
							}));
						});
					}
					return () => {
						alive = false;
					};
				}, [
					usage,
					modelVendorKey,
					accountRevision
				]);
				const refreshVendorCatalog = (vendor) => {
					const current = usageNamespace(ctx);
					if (current === void 0) return;
					setModelCatalogLoading((loading) => ({
						...loading,
						[vendor]: true
					}));
					readModels(current, vendor).then((result) => {
						if (result.failures.length === 0) catalogReadings.put(vendor, result);
						setModelCatalogs((catalogs) => ({
							...catalogs,
							[vendor]: result
						}));
						setModelCatalogLoading((loading) => ({
							...loading,
							[vendor]: false
						}));
					});
				};
				const catalogFailureOf = (vendor) => {
					const catalog = modelCatalogs[vendor];
					if (catalog === void 0 || catalog.failures.length === 0) return void 0;
					return catalog.failures.join("；");
				};
				/**
				* 发起一次网页登录。
				*
				* 三件以前没做的事，缺任何一件用户看到的就是「点了没反应」：
				* 1. **同步开一个占位窗口**（弹窗拦截器只认用户手势；授权网址是异步回来的）；
				* 2. 立刻进「正在启动」态（按钮禁用 + 文案），点击到出结果之间不再是空白；
				* 3. **失败必须落地**：流程给了 `failed/reason` 就记进 `logins`，调用本身没发出去 /
				*    抛错就记进 `loginErrors`（原文进 `data-*`，界面说人话）。
				* @param vendor - 厂商 id。
				*/
				const beginLogin = (vendor) => {
					closeLoginWindow(loginPopup.current);
					loginClosed.current[vendor] = false;
					const popup = openLoginWindow();
					loginPopup.current = popup;
					setLoginErrors((current) => ({
						...current,
						[vendor]: void 0
					}));
					setLoginStarting((current) => ({
						...current,
						[vendor]: true
					}));
					const remote = callRemote(() => usage?.loginBegin(vendor));
					if (remote === void 0) {
						closeLoginWindow(popup);
						loginPopup.current = void 0;
						setLoginStarting((current) => ({
							...current,
							[vendor]: false
						}));
						setLoginErrors((current) => ({
							...current,
							[vendor]: t("account.serviceNotReady")
						}));
						return;
					}
					remoteValueDetailed(remote).then((detail) => {
						setLoginStarting((current) => ({
							...current,
							[vendor]: false
						}));
						if (!detail.ok || detail.value === void 0) {
							loginClosed.current[vendor] = true;
							closeLoginWindow(loginPopup.current);
							loginPopup.current = void 0;
							setLoginErrors((current) => ({
								...current,
								[vendor]: detail.ok ? t("account.loginFailed") : detail.problem
							}));
							return;
						}
						const status = detail.value;
						if (!(status.state === "waiting" && status.authUrl !== void 0 ? pointLoginWindowAt(popup, status.authUrl) : false)) {
							closeLoginWindow(popup);
							loginPopup.current = void 0;
						}
						if (status.state === "waiting") {
							loginDeadlines.current[vendor] = status.expiresAt ?? Date.now() + 12e4;
							setLoginDismissed((current) => current[vendor] === void 0 ? current : {
								...current,
								[vendor]: false
							});
						}
						setLogins((current) => ({
							...current,
							[vendor]: status
						}));
						if (status.state === "success") setAccountRevision((current) => current + 1);
					});
				};
				/**
				* 取消某一家等待中的登录：宿主侧停掉流程（释放本地端口/子进程），界面立即回到未开始。
				* @param vendor - 厂商 id。
				*/
				const cancelLogin = (vendor) => {
					closeLoginWindow(loginPopup.current);
					loginPopup.current = void 0;
					loginClosed.current[vendor] = true;
					loginPollMisses.current[vendor] = 0;
					loginDeadlines.current[vendor] = void 0;
					setLogins((current) => ({
						...current,
						[vendor]: LOGIN_UNKNOWN
					}));
					setLoginErrors((current) => ({
						...current,
						[vendor]: void 0
					}));
					setLoginDismissed((current) => current[vendor] === void 0 ? current : {
						...current,
						[vendor]: false
					});
					remoteValue(callRemote(() => usage?.loginCancel(vendor)));
				};
				const [usageReport, setUsageReport] = (0, react.useState)(void 0);
				const [usageStatsProblem, setUsageStatsProblem] = (0, react.useState)(void 0);
				/**
				* 凭据引用名 → 是否真的配置了（搜索 key 的「已添加 / 未添加」徽标）。
				*
				* 缺省 `undefined` 表示**还没读到**：那时页面不显示任何徽标，而不是猜「未添加」
				*。
				*/
				const [credentialStatus, setCredentialStatus] = (0, react.useState)(void 0);
				/** 「保存密钥」的草稿 / 进行中 / 失败原因（搜索卡里那一块）。 */
				const [secretDraft, setSecretDraft] = (0, react.useState)("");
				const [secretSaving, setSecretSaving] = (0, react.useState)(false);
				const [secretError, setSecretError] = (0, react.useState)(void 0);
				/**
				* 插件自身的更新状态（`undefined` = 还没查过）。
				*
				* **打开设置页就自动查一次**（需求：「每次打开设置页就自动检查更新并提示吧，
				* 别手动点了」）。早先刻意不自动查（怕每次开关设置页都打一次网络），但用户显然更在意
				* 「一进来就知道有没有新版」；折中办法是**模块级缓存**：同一页面会话内查过一次就不再问，
				* 反复开关设置页不会重复打网络，而刷新页面后会重新查。
				*/
				const [updateState, setUpdateState] = (0, react.useState)(() => cachedUpdateState());
				const [updateBusy, setUpdateBusy] = (0, react.useState)(false);
				/**
				* 是否显示「刷新页面」提示。
				*
				* 两个来源：① 共享界面没注册成功（`sharedSurfacesReady()` 为 false）；
				* ② 刚刚通过更新按钮装好了新版本 —— 那时页面里跑的还是旧代码。
				*/
				const [reloadHint, setReloadHint] = (0, react.useState)(false);
				/**
				* 密钥实测结论（`ref → 结论`）与正在测试的那一把。
				*
				* 需求：「添加了 key 后就发起一次小请求验证一下是否可用，不可用的话就进行提示」
				* +「多增加一个测试按钮，让用户可以自行测试密钥的有效性」。
				* 结论**只在真的测过之后**存在：没测过就是 `undefined`，界面不给任何暗示。
				*/
				const [keyProbes, setKeyProbes] = (0, react.useState)({});
				const [keyProbing, setKeyProbing] = (0, react.useState)(void 0);
				/**
				* 定时重读计数：设置页会开着好一会儿，30 秒一次让数字跟上。
				*
				* 为什么不是「请求完成就刷新」：客户端没有可订阅的回合结束事件（宿主的
				* `session/event` 只在 host 插件上下文里可用）。页面不可见时不读（与侧边栏同纪律）。
				*
				* 2026-10-21 性能审计：以前是「定时器照常跑，回调里判 hidden 再 return」——
				* 空转的定时器仍会按点唤醒主线程、触发一次 `domDocument()` 判断，纯属白烧。
				* 现在改成**隐藏就真的停表**、重新可见时恢复，并在恢复那一刻补一次读数
				* （否则切回来最长要等 30 秒数字才动）。
				*/
				const [usageTick, setUsageTick] = (0, react.useState)(0);
				(0, react.useEffect)(() => {
					const dom = domDocument();
					let timer;
					const tick = () => setUsageTick((current) => current + 1);
					const start = () => {
						if (timer !== void 0) return;
						timer = setInterval(tick, 3e4);
					};
					const stop = () => {
						if (timer === void 0) return;
						clearInterval(timer);
						timer = void 0;
					};
					const onVisibility = () => {
						if (dom?.visibilityState === "hidden") {
							stop();
							return;
						}
						if (timer === void 0) tick();
						start();
					};
					start();
					if (typeof dom?.addEventListener === "function") dom.addEventListener("visibilitychange", onVisibility);
					return () => {
						stop();
						const current = domDocument();
						if (typeof current?.removeEventListener === "function") current.removeEventListener("visibilitychange", onVisibility);
					};
				}, []);
				(0, react.useEffect)(() => {
					let alive = true;
					const load = () => {
						if (!alive) return;
						try {
							const api = usageNamespace(ctx);
							if (api === void 0) return;
							if (api.usageReport === void 0) {
								setUsageReport(void 0);
								return;
							}
							remoteValueDetailed(callRemote(() => api.usageReport?.(USAGE_REPORT_WINDOW))).then((detail) => {
								if (!alive) return;
								if (!detail.ok) {
									setUsageStatsProblem(detail.problem);
									return;
								}
								setUsageReport(reportOf(detail.value));
								setUsageStatsProblem(void 0);
							});
						} catch (error) {
							if (!alive) return;
							setUsageStatsProblem(error instanceof Error ? error.message : String(error));
						}
					};
					try {
						load();
						const offReady = onUsageReady(ctx, (namespace) => {
							if (namespace !== void 0) load();
						});
						return () => {
							alive = false;
							offReady();
						};
					} catch (error) {
						alive = false;
						setUsageStatsProblem(error instanceof Error ? error.message : String(error));
						return () => {
							alive = false;
						};
					}
				}, [accountRevision, usageTick]);
				/**
				* 已经报过「用量读不到」的厂商（每次渲染重建）。
				*
				* 读数失败要在**用量本该出现的位置**说话，但同一句原因在三个账号下面重复三遍只是噪音：
				* 同一家只报一次。
				*/
				const usageProblemShown = /* @__PURE__ */ new Set();
				/**
				* 某个**账号**在这个窗口里的失败明细。
				*
				* 必须是按账号查，不是按厂商：用量块渲染在每个账号下面，而报表的全局汇总若直接拿来用，
				* 会让同厂商的所有账号显示同一份明细 —— 重复，而且失败属于 A 却显示在 B 下面
				* （2026-10-20 审计发现的真 bug）。
				* @param ref - 账号 ref。
				* @returns 该账号的明细行；没有失败或报表还没读到时为 `undefined`。
				*/
				const failuresOf = (vendor, ref) => {
					const entries = usageReport?.failuresByAccount;
					if (!Array.isArray(entries)) return void 0;
					const rows = entries.find((item) => item?.vendor === vendor && item?.account === ref)?.rows;
					return Array.isArray(rows) && rows.length > 0 ? rows : void 0;
				};
				/**
				* 某个账号的用量块（渲染在它自己的额度条下方）。
				* @param vendor - 厂商。
				* @param ref - 账号 ref。
				* @returns 用量块；没有该账号的读数时为 `undefined`（不占位）。
				*/
				const accountUsageOf = (vendor, ref) => {
					if (usageStatsProblem !== void 0) {
						if (usageProblemShown.has(vendor)) return void 0;
						usageProblemShown.add(vendor);
						return (0, react.createElement)("small", {
							"data-usage-failure": "true",
							className: CSS_CLASS.failure
						}, `${t("usage.readFailed")}：${usageStatsProblem}`);
					}
					const accounts = usageReport?.accounts;
					if (!Array.isArray(accounts)) return void 0;
					const row = accounts.find((entry) => entry?.vendor === vendor && entry?.account === ref);
					if (row === void 0) {
						if (usageReport === void 0) return void 0;
						return (0, react.createElement)("small", {
							"data-usage-empty": ref,
							className: CSS_CLASS.note
						}, t("usage.emptyAccount"));
					}
					return (0, react.createElement)(RenderBoundary, {
						variant: "inline",
						title: t("usage.title"),
						retryLabel: t("models.retry")
					}, (0, react.createElement)(AccountUsageBlock, {
						t,
						entry: row,
						label: accountLabelOf(statuses[vendor]?.accounts ?? [], ref),
						...failuresOf(vendor, ref) === void 0 ? {} : { failures: failuresOf(vendor, ref) }
					}));
				};
				/**
				* 每个模型在**该账号当前套餐**下的可用额度。
				*
				* 数据表是内置的官方表格（`core/model-quota-table`），没有 API 可查。查不到的
				* 三种情况一律返回 `undefined`（界面留空）：这家厂商没有表、套餐认不出、
				* 模型不在表里 —— 与「额度缺失不倒成 0」同一条纪律。
				*
				* 套餐名从该账号已读到的额度摘要里取（`account.quota.plan`），所以它与额度条
				* 显示的是同一个套餐，不会出现「上面写 GOAT、下面按 Go 算额度」。
				* @param vendor - 厂商行 id。
				* @param account - 该账号。
				* @param modelId - 模型 id。
				* @returns 已格式化的额度文字；查不到时 `undefined`。
				*/
				const modelQuotaOf$1 = (vendor, account, modelId) => {
					const table = quotaTableOf(vendor);
					if (table === void 0) return void 0;
					const plan = account.quota?.plan;
					const planName = plan?.name ?? plan?.id;
					const isOpencode = vendor.trim().toLowerCase() === "dsh-opencode-go" || vendor.trim().toLowerCase() === "opencode";
					const amount = modelQuotaOf(table, planName ?? (isOpencode ? "Go" : void 0), modelId);
					if (amount === void 0) return void 0;
					if (amount.kind === "free") return t("models.quotaFree");
					const usd = `$${amount.amount.toFixed(amount.amount % 1 === 0 ? 0 : 2)}`;
					return amount.kind === "approx" ? t("models.quotaApprox").replace("{amount}", usd) : usd;
				};
				/**
				* 这个模型在**该账号当前套餐**下能不能用（需求：不要把本套餐用不了的
				* 模型也列出来）。
				*
				* 只有拿到官方「该档位包含哪些模型」的清单时才返回 `false`；没有清单（如 Open
				* Design、OpenCode 目前都没有按档位的完整模型表）返回 `undefined` —— 那表示
				* 「不知道」，界面会照常显示。没有依据就藏模型，用户会以为插件坏了。
				* @param vendor - 厂商行 id。
				* @param account - 该账号。
				* @param modelId - 模型 id。
				* @returns 是否可用；未知时 `undefined`。
				*/
				const modelAvailable = (vendor, account, modelId) => {
					const planModels = planModelsOf(vendor);
					if (planModels === void 0) return void 0;
					const plan = account.quota?.plan;
					return modelAvailableIn(planModels, plan?.name ?? plan?.id, modelId);
				};
				const accountsPanel = (0, react.createElement)(AccountsPanel, {
					usageOf: accountUsageOf,
					modelQuotaOf: modelQuotaOf$1,
					modelAvailable,
					t,
					vendors: availableEntries.map((entry) => ({
						entry,
						status: statuses[entry.providerId],
						problem: usageProblem ?? statusProblems[entry.providerId],
						...state.actionVendor === entry.providerId && state.action !== void 0 ? { action: state.action } : {},
						...state.expandedVendor === entry.providerId && state.expandedRef !== void 0 ? { expandedRef: state.expandedRef } : {},
						...logins[entry.providerId] === void 0 || loginDismissed[entry.providerId] === true ? {} : { login: logins[entry.providerId] },
						...modelCatalogs[entry.providerId] === void 0 ? {} : { catalog: modelCatalogs[entry.providerId].models },
						...catalogFailureOf(entry.providerId) === void 0 ? {} : { catalogFailure: catalogFailureOf(entry.providerId) },
						...modelCatalogLoading[entry.providerId] === true ? { catalogLoading: true } : {},
						...statuses[entry.providerId]?.modelRules === void 0 ? {} : { modelRules: statuses[entry.providerId].modelRules },
						...statusLoading[entry.providerId] === true ? { loading: true } : {}
					})),
					...actionError === void 0 ? {} : { actionError },
					onRefreshModels: (vendor) => refreshVendorCatalog(vendor),
					onOpenAction: (vendor, action) => {
						setActionError(void 0);
						setState((current) => openAction(current, action, vendor));
					},
					onActionField: (field, value) => {
						setActionError(void 0);
						setState((current) => setActionField(current, field, value));
					},
					onConfirmAction: (vendor) => {
						const action = state.action;
						if (action === void 0) return;
						if (usage === void 0) {
							setActionError(t("account.serviceNotReady"));
							return;
						}
						const pending = dispatchAccountAction(usage, vendor, action);
						if (pending === void 0) {
							setActionError(action.kind === "key" ? t("account.keyRequired") : t("account.labelRequired"));
							return;
						}
						setActionError(void 0);
						pending.then((result) => {
							if (!result.ok) {
								setActionError(result.problem);
								return;
							}
							setState((current) => closeAction(current));
							setAccountRevision((current) => current + 1);
						});
					},
					onCancelAction: () => {
						setActionError(void 0);
						setState((current) => closeAction(current));
					},
					onSelect: (vendor, ref) => {
						usage?.selectAccount(vendor, ref).then(() => setAccountRevision((current) => current + 1));
					},
					onRemove: (vendor, ref) => {
						usage?.removeAccount(vendor, ref).then(() => setAccountRevision((current) => current + 1));
					},
					onMove: (vendor, ref, toIndex) => {
						usage?.moveAccount(vendor, ref, toIndex).then(() => setAccountRevision((current) => current + 1));
					},
					onSetAccountModels: (vendor, ref, models) => {
						usage?.setAccountModels?.(vendor, ref, models).then(() => setAccountRevision((current) => current + 1));
					},
					onToggleExpand: (vendor, ref) => setState((current) => toggleExpanded(current, ref, vendor)),
					onLoginBegin: (vendor) => beginLogin(vendor),
					onLoginCancel: (vendor) => cancelLogin(vendor),
					onCollapseAddChooser: () => {
						setActionError(void 0);
						setState((current) => current.action === void 0 ? current : closeAction(current));
						for (const [vendor, value] of Object.entries(logins)) if (value?.state === "waiting") cancelLogin(vendor);
					},
					loginStarting,
					loginError: loginErrors,
					onExportUsage: usage?.usageExportCsv === void 0 ? void 0 : async () => {
						setExportBusy(true);
						setExportError(void 0);
						try {
							const unwrapped = unwrapRemote(await usage.usageExportCsv());
							if (!unwrapped.ok) {
								setExportError(unwrapped.error);
								return;
							}
							if (typeof unwrapped.value !== "string") {
								setExportError(t("usage.exportFailed"));
								return;
							}
							downloadCsv(unwrapped.value);
						} catch (error) {
							setExportError(error instanceof Error ? error.message : String(error));
						} finally {
							setExportBusy(false);
						}
					},
					exportBusy,
					...exportError === void 0 ? {} : { exportError },
					onClearUsage: usage?.usageClear === void 0 ? void 0 : () => {
						setClearBusy(true);
						setClearError(void 0);
						usage.usageClear().then((result) => {
							const unwrapped = unwrapRemote(result);
							if (!unwrapped.ok) {
								setClearError(unwrapped.error);
								return;
							}
							setClearConfirming(false);
							setAccountRevision((current) => current + 1);
						}).catch((error) => {
							setClearError(error instanceof Error ? error.message : String(error));
						}).finally(() => setClearBusy(false));
					},
					clearBusy,
					clearConfirming,
					onRequestClearConfirm: () => setClearConfirming(true),
					onCancelClear: () => setClearConfirming(false),
					...clearError === void 0 ? {} : { clearError }
				});
				const accounts = availableEntries.length === 0 ? void 0 : accountsPanel;
				/**
				* 测试一把密钥能不能用（添加后自动调一次；「测试」按钮也调它）。
				*
				* 三档结论直接来自宿主（`probeSearchCredential`）：`ok` / `invalid` / `unknown`。
				* **`unknown` 绝不当成失败**：网络抖动不该让用户去换一把其实没问题的密钥。
				* 失败本身不抛：结论进 `keyProbes`，界面上就是那一行的小标签。
				* @param ref - 凭据引用名。
				*/
				/**
				* 查一次更新（用户点「检查更新」时）。
				*
				* 失败**不静默**：`checkForUpdate` 失败一律给 `unknown` + 可读原因，界面会把它显示出来。
				* 「查不到」与「已是最新」是两件不同的事 —— 混为一谈会让用户以为没有新版本。
				*/
				const runUpdateCheck = async () => {
					setUpdateBusy(true);
					try {
						const next = await checkForUpdate();
						setUpdateState(next);
						noteUpdateState(next);
					} finally {
						setUpdateBusy(false);
					}
				};
				/**
				* **打开设置页就自动查一次**。
				*
				* 三条约束：
				* 1. 只在**本页面会话还没查过**时发起（`updateCheckCache` 命中就直接用）；
				* 2. 已经手动查过/正在查时不重复发；
				* 3. 卸载后不写状态（`alive` 守卫）—— 用户在检查途中关掉设置页是常事。
				*/
				(0, react.useEffect)(() => {
					if (cachedUpdateState() !== void 0) return;
					let alive = true;
					setUpdateBusy(true);
					checkForUpdate().then((next) => {
						noteUpdateState(next);
						if (alive) setUpdateState(next);
					}).catch(() => {
						const fallback = {
							kind: "unknown",
							reason: "更新检查没有完成"
						};
						noteUpdateState(fallback);
						if (alive) setUpdateState(fallback);
					}).finally(() => {
						if (alive) setUpdateBusy(false);
					});
					return () => {
						alive = false;
					};
				}, []);
				/**
				* 开始更新（只在真有新版时可用）。
				*
				* 走宿主官方插件入口的更新接口；**它自己会改 profile**，所以只在用户明确点击时调用。
				* 成功后提示「刷新页面」——插件的新代码要页面重载才会加载（与 `reloadPage` 同一条理由）。
				*/
				const runUpdate = async () => {
					setUpdateBusy(true);
					try {
						const started = await startUpdate();
						if (!started.ok) {
							setUpdateState({
								kind: "unknown",
								reason: started.reason
							});
							return;
						}
						for (let tick = 0; tick < 60; tick += 1) {
							const progress = await pollUpdate(started.operationId);
							if (progress.state === "succeeded") {
								setUpdateState({
									kind: "unknown",
									reason: t("update.done")
								});
								setReloadHint(true);
								/**
								* 读一次磁盘上的新版本，用于提示文案。
								*
								* 读不到就用 `"?"`：提示的核心信息是「该刷新了」，版本号只是辅助。
								* 不值得因为它失败就不弹 —— 一次成功的更新之后不提示，用户才会真卡住。
								*/
								const diskVersionAfterUpdate = await readInstalledVersion(usage);
								/**
								* **同时弹一个全局提示**。
								*
								* 为什么不能只靠 `reloadHint`：那个提示画在**设置页**里，而用户更新完常常
								* 直接去看侧边栏额度卡片 —— 他在那里看不到任何提示，只看到渲染异常的旧界面。
								*
								* 这里是唯一能拿到「刚更新完」这个时机的地方（`apply` 只在页面加载时跑，
								* 更新后不会重跑，所以版本漂移检测那条路根本抓不到这一刻）。
								*/
								showDriftNotice({
									title: t("drift.title"),
									body: t("drift.body").replace("{page}", PLUGIN_VERSION).replace("{disk}", diskVersionAfterUpdate ?? "?"),
									reload: t("drift.reload"),
									later: t("drift.later")
								}, () => {
									reloadPage();
								});
								return;
							}
							if (progress.state === "failed" || progress.state === "cancelled" || progress.state === "rolled-back") {
								setUpdateState({
									kind: "unknown",
									reason: [progress.code, progress.message].filter((part) => typeof part === "string" && part !== "").join("：") || "更新没有完成"
								});
								return;
							}
							await new Promise((resolve) => setTimeout(resolve, 1e3));
						}
						setUpdateState({
							kind: "unknown",
							reason: "更新还在进行中，请稍后刷新页面确认"
						});
					} finally {
						setUpdateBusy(false);
					}
				};
				const testSecret = async (ref) => {
					const probe = usage?.probeSearchCredential;
					if (probe === void 0) return;
					setKeyProbing(ref);
					try {
						const result = unwrapRemote(await callRemote(() => probe([ref])));
						const verdict = result.ok ? result.value?.find((row) => row.ref === ref) : void 0;
						setKeyProbes((probes) => ({
							...probes,
							[ref]: verdict === void 0 ? {
								ref,
								state: "unknown",
								reason: result.ok ? "宿主没有返回结论" : result.error
							} : verdict
						}));
					} catch (error) {
						setKeyProbes((probes) => ({
							...probes,
							[ref]: {
								ref,
								state: "unknown",
								reason: error instanceof Error ? error.message : String(error)
							}
						}));
					} finally {
						setKeyProbing((current) => current === ref ? void 0 : current);
					}
				};
				return PageShell({
					state,
					entries: allEntries,
					t,
					accounts,
					mergeTabs: true,
					...reloadHint || !sharedSurfacesReady() ? { reloadHint: true } : {},
					onReload: () => {
						reloadPage();
					},
					...updateState === void 0 ? {} : { update: updateState },
					...updateBusy ? { updateBusy: true } : {},
					onCheckUpdate: () => {
						runUpdateCheck();
					},
					onUpdate: () => {
						runUpdate();
					},
					onSelectTab: (ns) => setState((current) => selectTab(current, ns)),
					onSetField: (ns, key, value) => {
						const baseline = latestSnapshots.current[ns]?.value;
						const next = draftsAfterChange(latestDrafts.current[ns], baseline, key, value);
						const drafts = { ...latestDrafts.current };
						if (next === void 0) delete drafts[ns];
						else drafts[ns] = next;
						latestDrafts.current = drafts;
						setState((current) => setField(current, ns, key, value));
						const kind = specOf(state, ns, key)?.kind;
						if (kind === void 0 || !savesImmediately(kind)) return;
						saveRow(ns);
					},
					onSave: (ns) => void saveRow(ns),
					...savingNs === void 0 ? {} : { savingNs },
					...credentialStatus === void 0 ? {} : { credentialStatus },
					secretDraft,
					secretSaving,
					onSecretDraftChange: (value) => {
						setSecretDraft(value);
						setSecretError(void 0);
					},
					onSecretError: (error) => setSecretError(error),
					...secretError === void 0 ? {} : { secretError },
					onSaveSecret: usage?.setCredential === void 0 ? void 0 : async (_ref, secret) => {
						setSecretSaving(true);
						setSecretError(void 0);
						try {
							const existing = currentKeyRefsOf();
							const ref = nextKeyRef(existing);
							const unwrapped = unwrapRemote(await await callRemote(() => usage.setCredential(ref, secret)));
							if (!unwrapped.ok) return unwrapped.error;
							setSecretDraft("");
							await saveOneField(FEATURE_TAB_NS, "searchApiKeyRefs", [...existing, ref]);
							setState((current) => ({
								...current,
								credentialRevision: current.credentialRevision + 1
							}));
							testSecret(ref);
							return;
						} catch (error) {
							return error instanceof Error ? error.message : String(error);
						} finally {
							setSecretSaving(false);
						}
					},
					...usage?.probeSearchCredential === void 0 ? {} : { onTestSecret: (ref) => void testSecret(ref) },
					...Object.keys(keyProbes).length === 0 ? {} : { keyProbes },
					...keyProbing === void 0 ? {} : { keyProbing },
					onRemoveSecret: (ref) => {
						const current = currentKeyRefsOf();
						setKeyProbes((probes) => {
							if (probes[ref] === void 0) return probes;
							const next = { ...probes };
							delete next[ref];
							return next;
						});
						saveOneField(FEATURE_TAB_NS, "searchApiKeyRefs", removeKeyRef(current, ref)).then(() => setState((s) => ({
							...s,
							credentialRevision: s.credentialRevision + 1
						})));
					}
				});
			};
		}
		/** 侧边栏底部卡片的插槽名（旧插件 `lib/client.js:9141` 用的就是它）。 */
		const SIDEBAR_SLOT = "sidebar.footer.action";
		/**
		* 把侧边栏卡片注册进 `sidebar.footer.action`。
		*
		* 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:9139-9151`）：
		* `ctx.inject(["layout"], layoutCtx => layoutCtx.slots.inject(SLOT, () => layoutCtx.slots.register({…}, C)))`，
		* 并且**用 try/catch 包住** —— 旧插件在那里打印一行错误就继续（注册失败不该把整个客户端带走）。
		* @param ctx - 客户端上下文。
		* @param registration - 注册参数。
		* @returns 注销函数；没注册成功时是空操作。
		*/
		function registerSidebarCard(ctx, registration) {
			const inject = ctx.inject;
			if (typeof inject !== "function") return () => void 0;
			let unregister;
			const disposeAll = () => {
				const off = unregister;
				unregister = void 0;
				if (typeof off === "function") off();
			};
			inject(["layout"], (layoutCtx) => {
				try {
					const slots = slotsOf(layoutCtx);
					if (slots === void 0) return;
					slots.inject(SIDEBAR_SLOT, () => {
						try {
							disposeAll();
							const off = slots.register({
								name: SIDEBAR_SLOT,
								id: registration.id,
								order: registration.order,
								locale: registration.locale,
								inject: registration.face ?? (() => ({ hooks: {} }))
							}, registration.component);
							unregister = typeof off === "function" ? off : void 0;
							return off;
						} catch (error) {
							console.error("[dsh-llm-account] could not re-register the sidebar footer card:", error);
							return () => void 0;
						}
					});
				} catch (error) {
					console.error("[dsh-llm-account] could not register the sidebar footer card:", error);
				}
			});
			return disposeAll;
		}
		/** 读一个上下文上的插槽服务。 */
		function slotsOf(ctx) {
			const slots = ctx.slots;
			if (typeof slots !== "object" || slots === null) return void 0;
			const candidate = slots;
			if (typeof candidate.inject !== "function" || typeof candidate.register !== "function") return void 0;
			return candidate;
		}
		/** 侧边栏卡片的轮询间隔（毫秒）。与旧插件一样按需起停，不做常驻。 */
		const SIDEBAR_POLL_MS = 6e4;
		/** 失败退避的上限（毫秒）：连续失败时最多慢到 5 分钟一问，再慢用户就该以为是坏了。 */
		const SIDEBAR_POLL_MAX_MS = 3e5;
		/**
		* 失败退避间隔：连续失败 `failures` 次之后的下一次轮询间隔。
		*
		* 两个参考插件在读取失败时都仍按固定 60s 全速重问（参考实现的胶囊 `setInterval(refresh, 60_000)`
		* 里没有任何退避），于是一次上游故障会让每个可见标签页每分钟空打一次。这里按连续失败
		* 次数翻倍，到 {@link SIDEBAR_POLL_MAX_MS} 封顶；任何一次成功读数把计数清零、恢复常速。
		*
		* 纯函数（不藏时钟、不藏随机）：容器每次排下一拍时间时问它一次。
		* @param base - 常规间隔（毫秒）。
		* @param failures - 连续失败次数（`<= 0` 按常规间隔）。
		* @returns 下一次轮询的间隔（毫秒）。
		*/
		function backoffInterval(base, failures) {
			if (failures <= 0) return base;
			const doubled = base * 2 ** Math.min(failures, 10);
			return Math.min(doubled, SIDEBAR_POLL_MAX_MS);
		}
		/** 侧边栏用量轮询的基础间隔（毫秒），由设置字段 `quotaRefreshMinutes`（分钟）换算而来。
		*
		* 缺省/非法值回落到 {@link SIDEBAR_POLL_MS}（1 分钟），与旧插件一致；同时把值夹在
		* `[1, 120]` 分钟之间（再长用量基本就是过期的）。纯函数、不藏时钟，便于单测。
		* @param value - 设置文档里的 `quotaRefreshMinutes`（不可信，按 `unknown` 处理）。
		* @returns 轮询间隔（毫秒）。
		*/
		function quotaRefreshMs(value) {
			const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
			return Math.max(1, Math.min(120, Number.isFinite(parsed) ? parsed : SIDEBAR_POLL_MS / 6e4)) * 6e4;
		}
		/**
		* 造侧边栏卡片控制器。
		* @param deps - 注册/注销、一次读取与轮询间隔。
		* @returns 控制器。
		*/
		function createSidebarCardController(deps) {
			const intervalMs = deps.intervalMs ?? 6e4;
			let unregister;
			let timer;
			const stopPolling = () => {
				if (timer === void 0) return;
				clearTimeout(timer);
				timer = void 0;
			};
			/** 排下一拍（动态间隔下每拍重问，固定间隔下等价于常驻间隔）。 */
			const schedule = () => {
				stopPolling();
				const next = deps.pollInterval === void 0 ? intervalMs : deps.pollInterval();
				timer = setTimeout(() => {
					timer = void 0;
					deps.load();
					schedule();
				}, next);
			};
			return {
				sync(enabled) {
					if (!enabled) {
						stopPolling();
						unregister?.();
						unregister = void 0;
						return false;
					}
					if (unregister === void 0) {
						unregister = deps.register();
						deps.load();
						schedule();
					}
					return true;
				},
				registered: () => unregister !== void 0,
				polling: () => timer !== void 0,
				refreshIfEnabled() {
					if (unregister === void 0) return;
					deps.load();
				},
				dispose() {
					stopPolling();
					unregister?.();
					unregister = void 0;
				}
			};
		}
		/** 中栏仪表盘的面板 id（`layout.selectPanel` 用它打开/关闭）。 */
		const DASHBOARD_PANEL_ID = "llm-account-dashboard";
		/** 侧边栏卡片在插槽里的注册参数。 */
		const SIDEBAR_CARD_ID = "llm-account-quota";
		/**
		* 造**侧边栏卡片的容器组件**：厂商从模块级开关存储里取，渲染与轮询都按它门控。
		*
		* **为什么门控在组件里而不是注册时**（旧插件 `CommandCodeFooterEntry` 的同一条判定，本机
		* 已装产物可读）：插槽注册是**常驻**的（`apply` 期一次，注释原话 "The entry stays
		* REGISTERED — this is a render decision, so nothing churns the slot ledger"），组件按
		* **已存储**的开关决定 `if (!visible) return null`，并让自动刷新随 `visible` 起停。
		* 反过来做（注册按开关条件化）看起来更干净，但插槽服务**不返回注销句柄** —— 关掉开关时
		* 撤不下已注册的条目，卡片会带着定时器继续每 60s 请求，直接违背规格 §8.1 第 6 条。
		*
		* 存储的写者：插件级设置镜像（`settings/document-updated` 事件 + 首读）与设置页容器
		* （每次快照重读后）——两者算的是同一个 `sidebarVendorOf`，幂等。
		*
		* 关闭状态（存储里没有厂商）：渲染 `null`、不轮询、不注册 `visibilitychange` ——
		* 「关闭即静默」在**每一条路径**上成立（开启→关闭、卸载、从未开启）。
		* @param options - 上下文、厂商声明、取词函数与「打开仪表盘」的动作。
		* @returns 一个 React 函数组件。
		*/
		function createSidebarCardView(options) {
			const { ctx, entries, t } = options;
			return function ConnectedSidebarCard() {
				/** 参与侧边栏的厂商（跟随模式下是全部；见 `sidebarScopeOf`）。 */
				const [vendors, setVendors] = (0, react.useState)(() => sidebarVendorList());
				/**
				* 设置值变化时**重渲染**（让 `refreshKey` 重新计算），从而按新间隔重建控制器。
				*
				* 这里只要 setter：值本身不参与渲染，依赖用 `refreshKey` 的取值而不是修订号 ——
				* 见下面控制器 effect 的注释。
				*/
				const [, setSettingsRevision] = (0, react.useState)(0);
				const [view, setView] = (0, react.useState)(() => {
					const target0 = sidebarCurrentTarget(sidebarTargetsOf(sidebarVendorList(), sidebarStatuses(), {
						keys: sidebarAccountKeys(),
						configured: sidebarSelectionConfigured()
					}), sidebarLastUsed());
					const cached = target0 === void 0 ? void 0 : sidebarStatuses()[target0.vendor];
					return cached === void 0 ? { stale: false } : {
						status: cached,
						stale: true
					};
				});
				const inFlight = (0, react.useRef)(false);
				const failures = (0, react.useRef)(0);
				/** 组件是否还挂着（异步回调据此丢弃过期的 setState）。 */
				const aliveRef = (0, react.useRef)(true);
				(0, react.useEffect)(() => () => {
					aliveRef.current = false;
				}, []);
				/**
				* 各厂商的最新读数：**建清单**用（`sidebarTargetsOf` 从这里展开）。
				*
				* 与 `view` 的分工：`view` 是「当前该显示什么」（只有一家、一次读数）；这里是
				* 「各家的账号表现在长什么样」（用于算出轮播清单）。
				*/
				const [statuses, setStatuses] = (0, react.useState)(() => sidebarStatuses());
				/**
				* **最近一次请求**是哪个账号（侧边栏跟随当前会话）。
				*
				* 从用量报表的 `lastUsed` 来（宿主侧从台账算好）。它比轮播更贴近用户预期：
				* 用户在一个会话里发消息，侧边栏就该显示那个会话正在用的账号。
				*/
				const [lastUsed, setLastUsed] = (0, react.useState)(() => sidebarLastUsed());
				/**
				* 轮播清单的勾选：`keys` 是 `vendor:ref`，`configured` 表示用户是否显式配置过。
				* 未配置 = 全部账号轮播。
				*/
				const [selection, setSelection] = (0, react.useState)(() => ({
					keys: sidebarAccountKeys(),
					configured: sidebarSelectionConfigured()
				}));
				/**
				* 现在该显示哪个账号。**不轮播**。
				*
				* 需求：「根据该会话的模型所属账号显示当前账号信息，就不需要轮播显示了」，
				* 随后又说「不用轮播那个了，直接去掉」。宿主的 `remote.session` 没有「前端当前打开
				* 哪个会话」的接口（扫过 asar 里全部调用点确认），所以用**最近一次请求的账号**代替
				* —— 刚发过请求的会话几乎必然就是用户在看的那个。
				*/
				const target = sidebarCurrentTarget(sidebarTargetsOf(vendors, statuses, selection), lastUsed);
				const vendor = target?.vendor;
				/**
				* 读一次状态。`manual` 为真时（用户点「刷新」）无视页面可见性 —— 手动要的就是立刻问；
				* 其余读取在页面不可见时**跳过**（参考实现 UsagePill 的同一条：
				* `!manual && document.visibilityState === 'hidden' → return`）：后台标签页继续每分钟
				* 打用量请求是白烧用户的流量与上游配额，浏览器节流也只是让它慢一点，不会停。
				*
				* 单飞（`inFlight`）：慢网络下不叠请求（参考实现的 busy 守卫同一条）。
				*
				* 失败时**保留上一次完整读数**并标「上次数据」：把一次瞬时故障显示成「还没有请求经过
				* 这个账号」是谎报（与空态文案同一族的问题）；部分失败（账号读到了、额度没读到）
				* 同样按失败处理 —— 额度那一半的数据不可信。
				*/
				const read = (manual) => {
					if (!manual && domDocument()?.visibilityState === "hidden") return;
					if (inFlight.current) return;
					const usage = usageNamespace(ctx);
					if (usage === void 0) {
						failures.current += 1;
						setView((current) => ({
							status: current.status,
							failure: usageRemoteProblem(ctx) ?? t("usage.remoteUnavailable"),
							stale: current.status !== void 0
						}));
						return;
					}
					const readVendor = vendor ?? vendors[0];
					if (readVendor === void 0) return;
					inFlight.current = true;
					readStatusDetail(usage, readVendor).then(({ status: next, problem }) => {
						inFlight.current = false;
						if (!aliveRef.current) return;
						if (next === void 0) {
							failures.current += 1;
							setView((current) => ({
								status: current.status,
								failure: problem ?? t("usage.failed"),
								stale: current.status !== void 0
							}));
							return;
						}
						setStatuses((current) => {
							const merged = {
								...current,
								[readVendor]: next
							};
							noteSidebarStatuses(merged);
							return merged;
						});
						if (next.failures.length > 0) {
							failures.current += 1;
							const raw = next.failures[0] ?? "";
							setView({
								status: next,
								failure: raw,
								stale: false
							});
							return;
						}
						failures.current = 0;
						try {
							if (completeReading(next)) statusReadings.put(readVendor, next);
						} catch (error) {
							console.warn("[dsh-llm-account] could not cache the usage reading:", error);
						}
						setView({
							status: next,
							stale: false
						});
					});
				};
				(0, react.useEffect)(() => subscribeSidebarVendors(setVendors), []);
				(0, react.useEffect)(() => subscribeSidebarVendors(() => {
					setSelection({
						keys: sidebarAccountKeys(),
						configured: sidebarSelectionConfigured()
					});
				}), []);
				(0, react.useEffect)(() => subscribeSidebarSettings(() => {
					setSettingsRevision((current) => current + 1);
				}), []);
				/**
				* 读「最近一次请求是哪个账号」（侧边栏跟随当前会话）。
				*
				* 一次 `usageReport` 就带回它（宿主从台账算好，不额外打网络）。读失败不抛：拿不到就
				* 退回轮播，侧边栏不该因此变空。
				*/
				(0, react.useEffect)(() => {
					const usage = usageNamespace(ctx);
					if (usage?.usageReport === void 0) return;
					let live = true;
					remoteValueDetailed(callRemote(() => usage.usageReport?.(USAGE_REPORT_WINDOW))).then((detail) => {
						if (!live || !detail.ok) return;
						const report = reportOf(detail.value);
						setLastUsed(report?.lastUsed);
						noteLastUsed(report?.lastUsed);
					});
					return () => {
						live = false;
					};
				}, [statuses]);
				/**
				* **建清单**：各开启的家读一次（每家一次，读到的账号表进 `statuses`）。
				*
				* 账号级轮播必须知道「有哪些账号」，而账号表住在 `status()` 里 —— 这是唯一需要
				* 「读所有家」的时刻。之后每拍只重读清单里那些账号所在的**一家**。
				*
				* 读完的读数同时喂给 `statuses`，`sidebarTargetsOf` 据此算出清单。
				*/
				(0, react.useEffect)(() => {
					if (vendors.length === 0) return;
					const usage = usageNamespace(ctx);
					if (usage === void 0) return;
					let cancelled = false;
					for (const name of vendors) readStatusDetail(usage, name).then(({ status }) => {
						if (cancelled || status === void 0) return;
						setStatuses((current) => {
							const merged = {
								...current,
								[name]: status
							};
							noteSidebarStatuses(merged);
							return merged;
						});
						if (completeReading(status)) statusReadings.put(name, status);
					});
					return () => {
						cancelled = true;
					};
				}, [vendors.join(",")]);
				/**
				* 轮询间隔的取值指纹：只有它变了才需要重建控制器（读一次新的间隔）。
				*
				* **轮播已移除**：不再有`setTurn` /
				* `setInterval`，对应的设置项 `sidebarRotateMinutes` 也一并从设置页删掉了。
				*/
				const refreshKey = quotaRefreshMs(sidebarVendorSettings()?.["quotaRefreshMinutes"]);
				(0, react.useEffect)(() => {
					if (sidebarVendorSeeded()) return;
					let alive = true;
					describeVendorSnapshots(ctx, entries).then((snapshots) => {
						if (alive) noteSidebarSnapshots(entries, snapshots);
					});
					return () => {
						alive = false;
					};
				}, []);
				(0, react.useEffect)(() => {
					if (vendors.length === 0) {
						setView({ stale: false });
						return;
					}
					const controller = createSidebarCardController({
						register: () => () => void 0,
						load: () => read(false),
						...options.intervalMs === void 0 ? {} : { intervalMs: options.intervalMs },
						pollInterval: () => backoffInterval(quotaRefreshMs(sidebarVendorSettings()?.["quotaRefreshMinutes"]), failures.current)
					});
					controller.sync(true);
					let readBeforeMount = usageNamespace(ctx) === void 0;
					const offReady = onUsageReady(ctx, (namespace) => {
						if (namespace === void 0 || !readBeforeMount) return;
						readBeforeMount = false;
						controller.refreshIfEnabled();
					});
					const onVisible = () => {
						if (domDocument()?.visibilityState === "visible") controller.refreshIfEnabled();
					};
					const dom = domDocument();
					if (typeof dom?.addEventListener === "function") dom.addEventListener("visibilitychange", onVisible);
					return () => {
						offReady();
						const current = domDocument();
						if (typeof current?.removeEventListener === "function") current.removeEventListener("visibilitychange", onVisible);
						controller.dispose();
					};
				}, [
					vendors.join(","),
					vendor,
					refreshKey
				]);
				if (vendors.length === 0) return null;
				return SidebarCard({
					t,
					status: view.status,
					...vendorLabelKeyOf(entries, target?.vendor ?? view.status?.vendor) === void 0 ? {} : { vendorLabelKey: vendorLabelKeyOf(entries, target?.vendor ?? view.status?.vendor) },
					...target === void 0 ? {} : { accountRef: target.ref },
					...view.failure === void 0 ? {} : { failure: view.failure },
					...view.stale ? { stale: true } : {},
					onOpen: () => options.onOpen()
				});
			};
		}
		/**
		* 按 providerId 找该厂商显示名的文案键（`vendor.commandcode` 等）。
		*
		* 为什么按 providerId 找而不是直接拼键名：三家的键名拼写与 id 不成规律
		* （`dsh-opencode-go` → `vendor.opencodeGo`），拼出来会猜错。
		* @param entries - 全部厂商条目。
		* @param providerId - 厂商行 id。
		* @returns 文案键；找不到时 `undefined`。
		*/
		function vendorLabelKeyOf(entries, providerId) {
			if (providerId === void 0 || providerId === "") return void 0;
			return entries.find((entry) => entry.providerId === providerId)?.labelKey;
		}
		/**
		* 读浏览器的 `document`。
		*
		* tsconfig 的 `lib` 里**没有** DOM（刻意的：宿主侧代码不该用 DOM API），所以这里做一次窄化读取，
		* 而不是给整个工程加 `DOM`。非浏览器环境（测试、SSR）拿到 `undefined`，调用方据此跳过。
		* @returns 只含本模块用到的两个方法的形状。
		*/
		function domDocument() {
			return globalThis.document;
		}
		/** 中栏面板的插槽名（旧插件 `lib/client.js:9130` 用的就是它）。 */
		const MAIN_SLOT = "main";
		/**
		* 把中栏面板注册进 `main` 插槽。
		*
		* 形状逐字对齐旧插件（`@mars-sea/dsh-commandcode-provider/lib/client.js:9130-9138`）：
		* `ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, locale, inject }, Component))`。
		*
		* **注意这里用的是 `key`，不是 `id`**，而且没有 `order` —— `main` 插槽按 key 选择面板（壳层用
		* `layout.selectPanel(key)` 打开它）。抄错成 `id` 会让面板永远打不开。
		* @param ctx - 客户端上下文。
		* @param registration - 面板 key、文案命名空间、组件与可选 `inject` 工厂。
		* @returns 注销函数（本实现是空操作，见 `registerSidebarCard` 的说明）。
		*/
		function registerPanelCard(ctx, registration) {
			const slots = slotsOf(ctx);
			if (slots === void 0) return () => void 0;
			let unregister;
			const disposeAll = () => {
				const off = unregister;
				unregister = void 0;
				if (typeof off === "function") off();
			};
			try {
				slots.inject(MAIN_SLOT, () => {
					try {
						disposeAll();
						const off = slots.register({
							name: MAIN_SLOT,
							key: registration.key,
							locale: registration.locale,
							inject: registration.face ?? (() => ({ hooks: {} }))
						}, registration.component);
						unregister = typeof off === "function" ? off : void 0;
						return off;
					} catch (error) {
						console.error("[dsh-llm-account] could not re-register the centre-column panel:", error);
						return () => void 0;
					}
				});
			} catch (error) {
				console.error("[dsh-llm-account] could not register the centre-column panel:", error);
			}
			return disposeAll;
		}
		/**
		* 造**仪表盘容器组件**：厂商同样从模块级开关存储里取（仪表盘由侧边栏卡片打开，
		* 两者本就是同一家），挂载/切换时读一次，手动刷新时再读一次。
		*
		* **没有常驻轮询**：面板只在用户主动打开时存在，打开即读一次；之后由「刷新」按钮或重新打开
		* 触发。规格 §8.1 第 6 条的「不做无谓后台查询」在这里同样适用。
		*
		* 存储里没有厂商（侧边栏开关关闭、且没有任何一家开启）时显示占位文案 —— 面板虽常驻注册，
		* 但没有可显示的厂商就不编造一个。
		* @param options - 上下文、厂商声明、取词函数与关闭动作。
		* @returns 一个 React 函数组件。
		*/
		function createDashboardView(options) {
			const { ctx, entries, t } = options;
			return function ConnectedDashboard() {
				const [statuses, setStatuses] = (0, react.useState)({});
				/** 读不到数据时的原因（远程面没挂上 / 读口报错）；`undefined` = 没失败。 */
				const [problem, setProblem] = (0, react.useState)(void 0);
				/**
				* 用量报表（每账号自己的账期）。
				*
				* 需求：「用量面板中还没有这个统计」。与设置页**同一份数据、同一份渲染**，
				* 所以这里也只存报表，渲染交给 `AccountUsageBlock`。
				*
				* **不设定时器**：面板是用户打开的、带显式刷新按钮的视图。给它挂 30 秒轮询会让一个
				* 打开着的面板在后台不停读状态与台账 —— 而「面板静默」是侧边栏那条开关纪律的一部分
				* （关掉卡片就不该再有任何请求）。要新数字，点刷新。
				*/
				const [usageReport, setUsageReport] = (0, react.useState)(void 0);
				/**
				* 是否正在读取。
				*
				* 旧实现里 `load()` 是同步函数，把结果吞在 `.then` 里立刻返回 —— 于是点刷新后
				* 面板**没有任何可观测变化**，用户只能怀疑按钮坏了。
				*
				* 现在由这个状态驱动：请求发起时置 true（按钮转圈 + disabled），全部结束后置 false。
				*/
				const [refreshing, setRefreshing] = (0, react.useState)(false);
				/**
				* 读一次状态与用量报表。
				*
				* **返回 Promise**：调用方（刷新按钮）需要知道「读完了没有」，否则无法显示加载态。
				* 内部两个读口并发，任一失败都不抛（失败信息进 `problem` / 保持旧数据）。
				* @returns 读完后的 Promise（从不 reject）。
				*/
				const load = async () => {
					const usage = usageNamespace(ctx);
					if (usage === void 0) {
						setProblem(usageRemoteProblem(ctx) ?? t("usage.remoteUnavailable"));
						return;
					}
					await Promise.all([Promise.all(entries.map(async (entry) => ({
						entry,
						detail: await readStatusDetail(usage, entry.providerId)
					}))).then((results) => {
						const nextStatuses = {};
						const problems = [];
						for (const result of results) {
							nextStatuses[result.entry.providerId] = result.detail.status;
							if (result.detail.status !== void 0 && completeReading(result.detail.status)) statusReadings.put(result.entry.providerId, result.detail.status);
							if (result.detail.problem !== void 0) problems.push(result.detail.problem);
						}
						setStatuses(nextStatuses);
						setProblem(problems[0]);
					}), usage.usageReport === void 0 ? Promise.resolve() : remoteValueDetailed(callRemote(() => usage.usageReport?.(USAGE_REPORT_WINDOW))).then((detail) => {
						if (!detail.ok) return;
						setUsageReport(reportOf(detail.value));
					})]);
				};
				/**
				* 刷新按钮的落点：带加载态地读一次。
				*
				* `finally` 里复位：即使 `load` 内部某处抛出（理论上不该，但渲染路径上的异常会
				* 让按钮**永久 disabled**），也必须把按钮恢复可点。
				* @returns 读完后的 Promise（从不 reject）。
				*/
				const refresh = () => {
					setRefreshing(true);
					load().catch(() => void 0).finally(() => {
						setRefreshing(false);
					});
				};
				(0, react.useEffect)(() => {
					load();
					return onUsageReady(ctx, (namespace) => {
						if (namespace !== void 0) load();
					});
				}, []);
				if (entries.length === 0) return (0, react.createElement)("p", {
					"data-dashboard-empty": "true",
					className: CSS_CLASS.empty
				}, t("dashboard.noData"));
				const usageOf = (vendor, ref) => {
					const accounts = usageReport?.accounts;
					if (!Array.isArray(accounts)) return void 0;
					const row = accounts.find((entry) => entry?.vendor === vendor && entry?.account === ref);
					if (row === void 0) return void 0;
					return (0, react.createElement)(RenderBoundary, {
						variant: "inline",
						title: t("usage.title"),
						retryLabel: t("models.retry")
					}, (0, react.createElement)(AccountUsageBlock, {
						t,
						entry: row
					}));
				};
				return Dashboard({
					t,
					status: statuses[entries[0].providerId],
					vendors: entries.map((entry) => ({
						label: t(entry.labelKey),
						vendor: entry.providerId,
						status: statuses[entry.providerId]
					})),
					onClose: () => options.onClose(),
					onRefresh: refresh,
					refreshing,
					failure: problem,
					usageOf
				});
			};
		}
		/**
		* 把侧边栏卡片与中栏面板注册进各自的插槽 —— **常驻、无条件**。
		*
		* 形状逐字对齐旧插件（`lib/client.js:9321-9341`）：`main` 用 `ctx.slots` + `key`，
		* `sidebar.footer.action` 用 `ctx.inject(["layout"], …)` + `id`/`order`，两处都 try/catch
		* （注册失败只留一行错误，不把整个客户端带走）。
		*
		* **为什么无条件**：插槽服务不返回注销句柄，条件注册一旦开启就撤不下来（关掉开关时卡片会
		* 带着定时器继续请求）。旧插件的处置是把条目**常驻**在插槽里，让组件按已存储的开关做渲染
		* 决策（"The entry stays REGISTERED — this is a render decision, so nothing churns the
		* slot ledger"）—— 本函数照此办理；门控在 {@link createSidebarCardView} 里。
		*
		* **幂等由调用方保证**：`applyShell` 的模块级守卫（与页面同一个）确保两个 profile 行各调
		* 一次 `apply` 也只注册一份；直接调用本函数（测试）每次都会注册。
		* @param options - 上下文、厂商声明、取词函数与文案命名空间。
		* @returns 撤销函数（插槽注册不可撤，见上；保留形状供调用方在 effect 里登记）。
		*/
		function registerSharedSurfaces(options) {
			const { ctx, t, localeNs } = options;
			const entries = options.entries.filter((entry) => entry.ns !== FEATURE_TAB_NS);
			/**
			* 给插槽组件套一层错误边界。
			*
			* **这是「刷新额度时侧边栏消失」最可能的真凶**（2026-10-20 第二次报障）：设置页早就有
			* `RenderBoundary`，而侧边栏卡片与中台面板**没有** —— 一旦它们的渲染/副作用抛一次错
			* （尺寸异常的读数、形状不可信的额度、宿主对象缺字段……），React 会**卸载整棵子树**，
			* 于是一个瞬间异常的表现就是「卡片凭空消失」，而且没有任何提示可查。
			*
			* 套上之后：异常只毁它自己那一块，并显示原因与「重试」；侧边栏其余部分照常。
			* 边界只在**首次挂载**时包一次（组件身份稳定，不会每次渲染重建）。
			*/
			const wrap = (component, title) => function Bounded() {
				return (0, react.createElement)(RenderBoundary, {
					title,
					variant: "inline",
					note: "这一块渲染失败了。其它界面不受影响。可以点「重试」。",
					retryLabel: "重试"
				}, (0, react.createElement)(component));
			};
			const disposeSidebar = registerSidebarCard(ctx, {
				id: SIDEBAR_CARD_ID,
				order: 1,
				locale: localeNs,
				component: wrap(createSidebarCardView({
					ctx,
					entries,
					t,
					onOpen: () => {
						selectPanel(ctx, DASHBOARD_PANEL_ID);
					}
				}), t("sidebar.effective"))
			});
			const disposePanel = registerPanelCard(ctx, {
				key: DASHBOARD_PANEL_ID,
				locale: localeNs,
				component: wrap(createDashboardView({
					ctx,
					entries,
					t,
					onClose: () => {
						selectPanel(ctx, null);
					}
				}), t("dashboard.title"))
			});
			noteSharedSurfacesRegistered();
			return () => {
				disposeSidebar();
				disposePanel();
			};
		}
		/**
		* 设置页**成功读数**的模块级缓存（`reading-cache.ts` 说明来由）。
		*
		* TTL 内重新打开设置直接复用，不重打网络；两个设置页实例（设置节与主栏面板版本）以及侧边栏
		* 写回的读数共享同一份。失效路径：TTL 到期、凭据变更（apply 期的常驻订阅，见
		* {@link startSharedState}）、账号/凭据修订号变化（容器强制现读并覆盖）、手动刷新（绕过缓存
		* 并覆盖）。
		*/
		const STATUS_READING_TTL_MS = 6e4;
		const CATALOG_READING_TTL_MS = 3e5;
		/**
		* 状态读数的新鲜期：**跟随用户设置的「用量刷新间隔」**。
		*
		* 2026-10-18 实际情况「刷新频率到底有没有用？我每次点设置它都自己刷一遍」。事实是旧的
		* TTL 写死 60 秒、和设置里的 `quotaRefreshMinutes`（默认 1 分钟）无关，改设置只影响侧边栏
		* 轮询。现在缓存新鲜期就是那个设置值：设 10 分钟，10 分钟内重开设置直接吃缓存，不再重打
		* 网络；设 1 分钟，1 分钟后才重读。
		*/
		let statusReadingTtlMs = STATUS_READING_TTL_MS;
		/** 状态读数：只存**成功**的（读失败照旧每次重试 —— 缓存一次瞬时故障会把它假装成事实）。 */
		const statusReadings = new ReadingCache(() => statusReadingTtlMs);
		/** 模型目录：只存完整成功的（`failures` 为空）；部分失败与失败都留给下次重读。 */
		const catalogReadings = new ReadingCache(CATALOG_READING_TTL_MS);
		/**
		* 更新检查的**结论**（模块级，2026-10-21）。
		*
		* 为什么单独放一份：需求「打开设置页就自动检查」，而设置页会被反复开关。
		* 没有这份缓存，每次开关都打一次更新接口 —— 那是纯浪费。这里只存**结论**
		* （而不是「要重查」），所以重开设置页直接显示上次结果，`undefined` 才表示该查了。
		*
		* 刷新页面会重置它（模块重新求值），因此「想强制重查」的语义仍然存在。
		*/
		let updateCheckCache;
		/** 读更新结论缓存（`undefined` = 本页面会话还没查过）。 */
		function cachedUpdateState() {
			return updateCheckCache;
		}
		/** 写更新结论缓存。 */
		function noteUpdateState(state) {
			updateCheckCache = state;
		}
		/**
		* 这份状态读数够格进缓存吗？—— **不完整就不缓存**。
		*
		* 2026-10-18 实际情况「重新点开设置后原来显示的额度信息又不见了」的根因：缓存本意是省一次
		* 网络，但它把**部分失败**的读数也当成功存了下来 —— 一次瞬时故障（端点超时、某个端点坏了）
		* 就此在 60 秒 TTL 里变成「事实」，重开设置吃缓存，额度数字看起来凭空消失。判据：
		* 1. 厂商级没有任何失败项；
		* 2. 每个**已配置**的账号都拿到了非空额度读数（额度缺席、额度自己报失败、一个窗口都没有，
		*    三种都说明这次读得不完整）。
		*
		* 不完整照旧每次重读：下一次要么完整（进缓存），要么还是失败（界面显示那一行中文原因，下次
		* 打开再试）。未配置的账号不参与判定 —— 它没有密钥，本来就没有额度可读。
		* @param status - 一次厂商状态读数。
		* @returns 够格进缓存时为 `true`。
		*/
		function completeReading(status) {
			const failures = status.failures;
			if (Array.isArray(failures) && failures.length > 0) return false;
			const accounts = Array.isArray(status.accounts) ? status.accounts : [];
			for (const account of accounts) {
				if (typeof account !== "object" || account === null) continue;
				if (account.configured !== true) continue;
				const quota = account.quota;
				if (typeof quota !== "object" || quota === null) return false;
				if (Array.isArray(quota.failures) && quota.failures.length > 0) return false;
				if (!Array.isArray(quota.windows) || quota.windows.length === 0) return false;
			}
			return true;
		}
		/** 共享的 usage 远程面（`$mount` 只发一次）。 */
		let sharedUsage;
		const usageReadyListeners = /* @__PURE__ */ new Set();
		/** 造一个不带 `effect` 的委托上下文：重挂不能挂在某一行（可能已卸载）的作用域上。 */
		function detachedContext(ctx) {
			return {
				remote: remoteOf(ctx),
				inject: (names, callback) => ctx.inject?.(names, callback)
			};
		}
		/**
		* 取共享的 usage 远程面，必要时（首次、或上次已卸下/挂载失败）挂载。
		*
		* 重挂用**不带 effect 的委托上下文**：初次挂载归第一个调用者的作用域（与旧插件同形），
		* 而那一行被卸载后，还活着的那一行要能把它救回来 —— 挂在任何单个行作用域上都会再次
		* 随着那一行死掉。
		* @param ctx - 调用方的客户端上下文（只在需要挂载时用到）。
		* @returns 共享句柄；挂载进行中时 `namespace()` 为 `undefined`。
		*/
		function ensureUsageRemote(ctx) {
			const current = sharedUsage;
			if (current !== void 0 && !current.disposed() && !(current.namespace() === void 0 && current.error() !== void 0)) return current;
			const handle = mountUsageRemote(current === void 0 ? ctx : detachedContext(ctx), (namespace, problem) => {
				for (const listener of [...usageReadyListeners]) listener(namespace, problem);
			});
			sharedUsage = handle;
			return handle;
		}
		/**
		* 订阅远程面的可用性：先用当前值调用一次，之后每次变化再调用。
		*
		* 设置页容器用它拿命名空间（而**不持有**远程面的生命周期 —— 页面关掉不该把两个插槽界面的
		* 数据源一起带走）；卡片与面板用在「挂载完成前读取落空」的补读上。
		* @param ctx - 客户端上下文。
		* @param listener - 可用性变化回调（`undefined` = 还没挂上或已卸下；第二参是失败原因）。
		* @returns 退订函数。
		*/
		function onUsageReady(ctx, listener) {
			const handle = ensureUsageRemote(ctx);
			listener(handle.namespace(), handle.error());
			usageReadyListeners.add(listener);
			return () => {
				usageReadyListeners.delete(listener);
			};
		}
		/**
		* 当前可用的 usage 命名空间：先问共享句柄，再回落到上下文上的命名空间（旧宿主可能直接挂在
		* `ctx.remote` 上）。两者都没有就是 `undefined`（调用方按「数据不可用」降级）。
		* @param ctx - 客户端上下文。
		* @returns 命名空间；还没挂上时为 `undefined`。
		*/
		function usageNamespace(ctx) {
			return ensureUsageRemote(ctx).namespace() ?? usageNamespaceOf(ctx);
		}
		/**
		* usage 远程面**挂载**失败的原因；没失败（或还在挂载中）时为 `undefined`。
		*
		* 与 {@link usageNamespace} 配套：两者都给出「命名空间不可用」这一事实，但只有它能说明
		* 为什么。侧边栏与设置页都靠它把「读不到」从空态里区分出来。
		* @param ctx - 客户端上下文。
		* @returns 可读的失败原因。
		*/
		function usageRemoteProblem(ctx) {
			return ensureUsageRemote(ctx).error();
		}
		/** 侧边栏卡片该显示哪一家（providerId）；没有开启的厂商时为 `undefined`。 */
		let sidebarVendorValue;
		/** 侧边栏要**轮播**的厂商清单（按标签页顺序，只含开启的；见 `sidebarVendorsOf`）。 */
		let sidebarVendorsValue = [];
		/**
		* 轮播清单里显式勾中的账号键（`vendor:ref`；见 `sidebarAccountKeysOf`）。
		*
		* 空数组 + {@link sidebarSelectionConfiguredValue} 为 `false` = 「全部账号轮播」（默认）。
		*/
		let sidebarAccountKeysValue = [];
		/** 轮播清单是否被显式配置过（区分「没配 = 全部」与「配成空 = 一个都不要」）。 */
		let sidebarSelectionConfiguredValue = false;
		/**
		* **上一次读到的「最近一次请求的账号」**（模块级，跨挂载保留）。
		*
		* 为什么需要：侧边栏每次打开（面板重挂、刷新页面、面板切换）都会重新挂载组件，而
		* `lastUsed` 要等一次异步 `usageReport` 才回来。没有这份缓存时**首帧**只能显示清单
		* 第一个（commandcode），随后才跳到真正在用的那家 —— 用户看到的就是「每次默认都是
		* commandcode」（2026-10-19 报障）。
		*
		* 与其它侧边栏模块级状态同一条纪律：同步可读，复位只给测试用。
		*/
		/**
		* **上一次读到的各厂商读数**（模块级，跨挂载保留）。
		*
		* 与 {@link lastUsedValue} 同一个理由：侧边栏重新挂载时首帧什么都还没有，
		* 只能显示「还没有请求」——连账号名都出不来。缓存上一次的读数让它首帧就有内容。
		*/
		let statusesValue = {};
		/**
		* 上一次读到的各厂商读数（**同步**；从没读过时为空对象）。
		* @returns 缓存的读数（键是厂商 id）。
		*/
		function sidebarStatuses() {
			return statusesValue;
		}
		/**
		* 记下一次各厂商读数（每次轮询/补读回来后调用）。
		* @param value - 新的读数映射。
		*/
		function noteSidebarStatuses(value) {
			statusesValue = { ...value };
		}
		let lastUsedValue;
		/**
		* 上一次读到的「最近一次请求的账号」（**同步**；没有时为 `undefined`）。
		*
		* 组件用它作 `useState` 的初值，于是首帧就显示上次那家，不会先闪一下清单第一个。
		* @returns 缓存的读数。
		*/
		function sidebarLastUsed() {
			return lastUsedValue;
		}
		/**
		* 记下一次「最近一次请求的账号」（读回来后调用）。
		* @param value - 新的读数；`undefined` 表示这次没读到（保留旧值更好：首帧仍然有东西可显示）。
		*/
		function noteLastUsed(value) {
			if (value !== void 0) lastUsedValue = value;
		}
		/** 当前侧边栏厂商的设置文档值（轮询间隔等设置类控件从这里取，见 `quotaRefreshMs`）。 */
		let sidebarVendorSettingsValue;
		/** 存储是否已被一次**非空**的设置读取 seed 过（冷启动兜底的依据）。 */
		let sidebarVendorSeededValue = false;
		/** 开关存储的监听者（侧边栏卡片与仪表盘容器）。 */
		const sidebarVendorListeners = /* @__PURE__ */ new Set();
		/** 设置值变化的监听者（刷新间隔等，即使厂商没变也要让轮询器重排）。 */
		const sidebarSettingsListeners = /* @__PURE__ */ new Set();
		/**
		* 刷新本页（等价于用户按 F5）。
		*
		* **为什么插件需要它**：宿主把客户端启动图在页面加载那一刻定下来，之后新装/更新的插件不会
		* 自动进图 —— 侧边栏卡片与中台面板于是「不出现」，只有重启宿主才行。刷新页面会让浏览器重走
		* 一遍启动图，效果与重启等价、成本却低得多。
		*
		* 非浏览器环境（测试 / SSR）是空操作：`location` 不存在时什么也不做。
		* @returns 是否真的发起了刷新。
		*/
		function reloadPage() {
			const location = globalThis.location;
			if (location === void 0 || typeof location.reload !== "function") return false;
			location.reload();
			return true;
		}
		/**
		* 侧边栏槽位是否已经**在本页**注册过。
		*
		* 判据只有一条：「设置页已经渲染出来」本身就证明本插件的客户端 bundle 已被加载并执行过
		* `apply`。而 `apply` 里设置页与侧边栏是**同一次**注册的（见 `index.ts` 的 apply 顺序），
		* 所以只要 `apply` 跑过、`registerSharedSurfaces` 没有抛错，侧边栏卡片就应该在。
		*
		* 于是「设置页在、卡片不在」只可能是宿主侧没把这个槽位渲染出来（启动图早于插件安装，
		* 或者槽位在页面加载时已经定型）。这种情况下**刷新页面**是唯一不需要重启的解法。
		*/
		let sharedSurfacesRegistered = false;
		/** 记一次共享界面注册成功（`registerSharedSurfaces` 末尾调用）。 */
		function noteSharedSurfacesRegistered() {
			sharedSurfacesRegistered = true;
		}
		/**
		* 共享界面（侧边栏卡片 / 中台面板）是否注册过。
		*
		* 页面用它决定要不要显示「刷新页面」的提示：`false` 意味着 `apply` 还没跑到注册那一步
		* （或注册抛错），此时用户的正确动作是刷新页面而不是重启宿主。
		* @returns 是否注册过。
		*/
		function sharedSurfacesReady() {
			return sharedSurfacesRegistered;
		}
		/** 当前侧边栏厂商的设置文档值；存储是冷的时为 `undefined`。 */
		function sidebarVendorSettings() {
			return sidebarVendorSettingsValue;
		}
		/** 存储是否已 seed（有过一次非空读取）。冷启动兜底只在未 seed 时读一次。 */
		function sidebarVendorSeeded() {
			return sidebarVendorSeededValue;
		}
		/** 当前要轮播的厂商清单（空数组 = 一家都没开）。 */
		function sidebarVendorList() {
			return sidebarVendorsValue;
		}
		/** 轮播清单里勾中的账号键（空 + 未配置 = 全部账号）。 */
		function sidebarAccountKeys() {
			return sidebarAccountKeysValue;
		}
		/** 轮播清单是否被显式配置过。 */
		function sidebarSelectionConfigured() {
			return sidebarSelectionConfiguredValue;
		}
		/** 「轮播清单」的监听者。 */
		const sidebarVendorsListeners = /* @__PURE__ */ new Set();
		/** 订阅「轮播清单」变化（开关或厂商集合变了）。 */
		function subscribeSidebarVendors(listener) {
			sidebarVendorsListeners.add(listener);
			return () => {
				sidebarVendorsListeners.delete(listener);
			};
		}
		/** 订阅设置值变化（刷新间隔等）。 */
		function subscribeSidebarSettings(listener) {
			sidebarSettingsListeners.add(listener);
			return () => {
				sidebarSettingsListeners.delete(listener);
			};
		}
		/**
		* 用一次设置快照读取更新开关存储（**唯一的写入口**）。
		*
		* 空快照不写入也不 seed：宿主设置服务缺席/未就绪时的一次空读，不该把「已经开着」的卡片
		* 关掉，也不该把存储标记成已 seed（那样冷启动兜底就不再补救）。
		* @param entries - 注册表里的厂商声明。
		* @param snapshots - `describeVendorSnapshots` 的结果。
		*/
		function noteSidebarSnapshots(entries, snapshots) {
			if (snapshots.length === 0) return;
			const map = {};
			for (const snapshot of snapshots) map[snapshot.ns] = snapshot;
			const entry = sidebarVendorOf(entries, map);
			const vendor = entry?.providerId;
			const nextVendors = sidebarScopeOf(entries, map);
			const vendorsChanged = nextVendors.length !== sidebarVendorsValue.length || nextVendors.some((item, index) => item !== sidebarVendorsValue[index]);
			sidebarVendorsValue = nextVendors;
			sidebarVendorSeededValue = true;
			const nextSettings = entry === void 0 ? void 0 : map[entry.ns]?.value;
			const settingsChanged = nextSettings !== sidebarVendorSettingsValue;
			sidebarVendorSettingsValue = nextSettings;
			statusReadingTtlMs = quotaRefreshMs(nextSettings?.["quotaRefreshMinutes"]);
			if (settingsChanged) for (const listener of [...sidebarSettingsListeners]) listener();
			const values = {};
			for (const snapshot of snapshots) values[snapshot.ns] = snapshot.value;
			const nextKeys = sidebarAccountKeysOf(values);
			const nextConfigured = sidebarSelectionConfigured$1(values);
			const selectionChanged = nextConfigured !== sidebarSelectionConfiguredValue || nextKeys.length !== sidebarAccountKeysValue.length || nextKeys.some((item, index) => item !== sidebarAccountKeysValue[index]);
			sidebarAccountKeysValue = nextKeys;
			sidebarSelectionConfiguredValue = nextConfigured;
			if (vendorsChanged || selectionChanged) for (const listener of [...sidebarVendorsListeners]) listener(nextVendors);
			if (vendor === sidebarVendorValue) return;
			sidebarVendorValue = vendor;
			for (const listener of [...sidebarVendorListeners]) listener(vendor);
		}
		/** 设置镜像是否已启动（模块级守卫）。 */
		let sidebarMirrorStarted = false;
		/**
		* 启动插件级的设置镜像：首读一次 + 订阅 `settings/document-updated` 事件重读。
		*
		* 事件名与旧插件逐字相同（`lib/client.js` 的 `createSettingsScope`：`remote.$on(
		* "settings/document-updated", …)` 后 `mirror.ensure()`）—— 它是宿主在设置文档变化时发出的
		* 失效信号。没有它，用户在**设置页之外**改动开关（外部工具、patch 文件）时，侧边栏卡片
		* 要到下次宿主重启才知道。
		*
		* 事件潮合并：同一轮微任务里的多次事件只读一次（镜像的读是全量 describe，没必要重复）。
		* @param ctx - 客户端上下文（apply 期的那个）。
		* @param entries - 注册表里的厂商声明。
		*/
		function startSidebarMirror(ctx, entries) {
			if (sidebarMirrorStarted) return;
			sidebarMirrorStarted = true;
			const read = () => {
				describeVendorSnapshots(ctx, entries).then((snapshots) => noteSidebarSnapshots(entries, snapshots));
			};
			read();
			if (typeof ctx.inject === "function") ctx.inject(["remote.settings"], (scoped) => {
				describeVendorSnapshots(scoped, entries).then((snapshots) => noteSidebarSnapshots(entries, snapshots));
			});
			const remote = remoteOf(ctx);
			if (typeof remote?.$on === "function") {
				let scheduled = false;
				remote.$on("settings/document-updated", () => {
					if (scheduled) return;
					scheduled = true;
					Promise.resolve().then(() => {
						scheduled = false;
						read();
					});
				});
			}
		}
		/**
		* 启动插件级共享状态：usage 远程面 + 设置镜像 + 凭据失效订阅（幂等，两个 profile 行各调一次无副作用）。
		* @param ctx - 客户端上下文（apply 期的那个）。
		* @param entries - 注册表里的厂商声明。
		*/
		function startSharedState(ctx, entries) {
			ensureUsageRemote(ctx);
			startSidebarMirror(ctx, entries);
			watchCredentialInvalidation(ctx);
		}
		/** 凭据失效订阅是否已建立（apply 期一次）。 */
		let credentialWatchStarted = false;
		/**
		* 凭据变更时让状态缓存失效。
		*
		* 为什么需要（而不只是容器里的 `subscribeCredentials`）：网页登录可能在设置页**关闭**时完成 ——
		* 那时容器订阅不在场，事件白白过去；重新打开设置若命中 TTL 缓存，就会拿着登录前的旧账号表
		* 当新鲜数据（刚加的账号「消失」最多一分钟）。这个订阅挂在 apply 期（插件生命周期），保证
		* 任何时刻的凭据变更都清掉缓存。
		* @param ctx - 客户端上下文。
		*/
		function watchCredentialInvalidation(ctx) {
			if (credentialWatchStarted) return;
			credentialWatchStarted = true;
			subscribeCredentials(ctx, () => {
				statusReadings.clear();
			});
		}
		/**
		* 读当前已挂载的远程命名空间。
		*
		* 卡片容器是独立组件，拿不到设置页容器 state 里的那份 —— 所以从上下文里现取（挂载完成后由
		* Gateway 提供，见 `mountUsageRemote`）。
		* @param ctx - 客户端上下文。
		* @returns 命名空间；还没挂上时为 `undefined`。
		*/
		function usageNamespaceOf(ctx) {
			const namespace = remoteOf(ctx)?.[USAGE_NAMESPACE];
			return typeof namespace === "object" && namespace !== null ? namespace : void 0;
		}
		/**
		* 保存字段到设置文档。
		*
		* 写的是 describe 时**命中的行名**（`row`，不是核心命名空间）：宿主设置服务按 profile 条目 id
		* 寻址（`SettingsForms.write` 找 `row.options.id === ns`），而 opencode 的条目 id
		* （`opencode-go`）与核心命名空间（`llm-opencode-go`）不同 —— 用 `ns` 写会落到一个不存在
		* 的条目上，保存必然失败。修订号做并发围栏。
		* @param ctx - 客户端上下文。
		* @param row - 宿主上的设置行名（`describeVendorSnapshots` 快照里的 `row`）。
		* @param fields - 要写的字段。
		* @param revision - 读取时拿到的修订号。
		* @returns `undefined` 表示写入成功；否则是宿主给出的可读失败原因（调用方显示给用户，
		*   不静默 —— 用户以为保存成功而实际没有，比报错更糟）。
		*/
		async function saveSettings(ctx, row, fields, revision) {
			const settings = remoteOf(ctx)?.settings;
			if (settings === void 0 || typeof settings.mutate !== "function") return "the host settings service is unavailable";
			if (fields.length === 0) return void 0;
			const ops = fields.map((field) => ({
				op: "set",
				path: [field.key],
				value: field.value
			}));
			let result;
			try {
				result = await settings.mutate(row, ops, revision);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			const unwrapped = unwrapRemote(result);
			return unwrapped.ok ? void 0 : unwrapped.error;
		}
		//#endregion
		//#region src/client/shell.ts
		/**
		* The client seam layer — every unverified host call shape lives here and
		* nowhere else (plan Review Focus 5). When plan 1c measures the real host, only
		* this file changes.
		*
		* Call shapes are mirrored from the legacy plugins' compiled client bundles:
		* - `settings.section` registration + `hooks` mapping factory:
		*   `@mars-sea/dsh-commandcode-provider/lib/client.js:7970-7977` (id `commandcode`,
		*   order 12, `label: () => ctx.locale.bind(ns)("nav")`, `inject: () => ({ hooks: {...} })`),
		*   `dsh-better-sidebar/lib/client.js:29695-29704`.
		* - nested service injection (`ctx.inject(["remote.credentials"], (remoteCtx) => ...)`
		*   then `remoteCtx.remote.credentials`): commandcode client, lines 7764-7765.
		* - dot-form service name in the top-level list (`"remote.session"`):
		*   `dsh-better-sidebar/lib/client.js:29451-29459`, whose comment records the
		*   failure mode: a missing inject entry throws
		*   `cannot get property "remote.session" without inject`.
		*
		* @module dsh-llm-account/src/client/shell
		*/
		/** One page locale namespace for the whole unified page (`settings.llm-account`). */
		const PAGE_LOCALE_NS = "settings.llm-account";
		/** The single `settings.section` this package registers. */
		const PAGE_ID = "llm-account";
		/**
		* The vendors this package hosts, with the generic field cards each one declares.
		*
		* Static data, deliberately: the controller's vendor-discovery ruling
		* (2026-10-14) forbids deriving a vendor from instance identity, because one
		* bundle serves both profile rows. The page still discovers vendors from the
		* settings namespaces that exist (`remote.settings.describe()`); these entries
		* only carry what discovery cannot supply (tab order, locale key, card fields).
		*
		* Field keys are the **real** settings-document fields from each vendor's own
		* Config schema (`src/vendors/commandcode/index.ts` / `opencode/index.ts`) — the
		* page must not invent settings the host cannot persist:
		* - commandcode declares `showSidebarQuota` (integrations; `default(false)`) and
		*   `apiBase` / `protocol` / `requestTimeoutMs` / `streamIdleTimeoutMs` /
		*   `defaultMaxTokens` (advanced);
		* - opencode declares `showSidebarQuota` (integrations) and `baseURL` /
		*   `requestTimeoutMs` / `streamIdleTimeoutMs` (advanced);
		* - opendesign declares `showSidebarQuota` / `quotaRefreshMinutes` / `workspaceId`
		*   (integrations) and `baseURL` / `walletBase` / `requestTimeoutMs` /
		*   `streamIdleTimeoutMs` (advanced) — 2026-10-18 第三家，施工单
		*   `docs/vendors.md` §3.3。
		*
		* **No privacy group for either vendor** (Ruling 23): plan 1a deliberately left
		* `zdr` and `webSearch` out of the commandcode Config schema (see that entry's
		* module header), so there is no field to render and the group stays hidden. When
		* those fields arrive, declaring them here lights the card up with no page change.
		*
		* `ns` values mirror `COMMAND_CODE_SETTINGS_NS` / `OPENCODE_SETTINGS_NS`, and
		* `providerId` mirrors `VendorId` (`src/core/adapter.ts`) — kept as literals
		* rather than imported, because `src/vendors/**` and `src/core/**` pull host and
		* SDK dependencies that must never reach the browser bundle.
		*/
		const VENDORS = [
			{
				ns: "llm-commandcode",
				rowIds: ["llm-commandcode"],
				providerId: "commandcode",
				order: 12,
				labelKey: "vendor.commandcode",
				models: {
					visible: "visibleModels",
					visibility: "modelVisibility",
					removed: "removedModels"
				},
				cards: [{
					group: "integrations",
					fields: [
						{
							key: "showSidebarQuota",
							kind: "boolean",
							labelKey: "field.showSidebarQuota",
							hintKey: "field.showSidebarQuota.hint",
							fallback: false
						},
						{
							key: "quotaRefreshMinutes",
							kind: "number",
							labelKey: "field.quotaRefreshMinutes",
							hintKey: "field.quotaRefreshMinutes.hint",
							fallback: 1
						},
						{
							key: "autoSwitchModelOnQuota",
							kind: "boolean",
							labelKey: "field.autoSwitchModelOnQuota",
							hintKey: "field.autoSwitchModelOnQuota.hint",
							fallback: false
						}
					]
				}, {
					group: "advanced",
					fields: [
						{
							key: "apiBase",
							kind: "text",
							labelKey: "field.apiBase",
							hintKey: "field.apiBase.hint"
						},
						{
							key: "protocol",
							kind: "select",
							labelKey: "field.protocol",
							hintKey: "field.protocol.hint",
							options: [
								{
									value: "openai",
									labelKey: "options.openai"
								},
								{
									value: "messages",
									labelKey: "options.messages"
								},
								{
									value: "cli",
									labelKey: "options.cli"
								}
							]
						},
						{
							key: "requestTimeoutMs",
							kind: "number",
							labelKey: "field.requestTimeoutMs",
							hintKey: "field.requestTimeoutMs.hint"
						},
						{
							key: "streamIdleTimeoutMs",
							kind: "number",
							labelKey: "field.streamIdleTimeoutMs",
							hintKey: "field.streamIdleTimeoutMs.hint"
						},
						{
							key: "defaultMaxTokens",
							kind: "number",
							labelKey: "field.defaultMaxTokens",
							hintKey: "field.defaultMaxTokens.hint"
						}
					]
				}]
			},
			{
				ns: "llm-opencode-go",
				rowIds: ["opencode-go", "llm-opencode-go"],
				providerId: "dsh-opencode-go",
				order: 20,
				labelKey: "vendor.opencodeGo",
				models: {
					visible: "visibleModels",
					visibility: "modelVisibility",
					removed: "removedModels"
				},
				cards: [{
					group: "integrations",
					fields: [
						{
							key: "showSidebarQuota",
							kind: "boolean",
							labelKey: "field.showSidebarQuota",
							hintKey: "field.showSidebarQuota.hint",
							fallback: false
						},
						{
							key: "quotaRefreshMinutes",
							kind: "number",
							labelKey: "field.quotaRefreshMinutes",
							hintKey: "field.quotaRefreshMinutes.hint",
							fallback: 1
						},
						{
							key: "autoSwitchModelOnQuota",
							kind: "boolean",
							labelKey: "field.autoSwitchModelOnQuota",
							hintKey: "field.autoSwitchModelOnQuota.hint",
							fallback: false
						}
					]
				}, {
					group: "advanced",
					fields: [
						{
							key: "baseURL",
							kind: "text",
							labelKey: "field.baseURL",
							hintKey: "field.baseURL.hint"
						},
						{
							key: "requestTimeoutMs",
							kind: "number",
							labelKey: "field.requestTimeoutMs",
							hintKey: "field.requestTimeoutMs.hint"
						},
						{
							key: "streamIdleTimeoutMs",
							kind: "number",
							labelKey: "field.streamIdleTimeoutMs",
							hintKey: "field.streamIdleTimeoutMs.hint"
						}
					]
				}]
			},
			{
				ns: "llm-opendesign",
				rowIds: ["opendesign", "llm-opendesign"],
				providerId: "opendesign",
				order: 30,
				labelKey: "vendor.opendesign",
				models: {
					visible: "visibleModels",
					visibility: "modelVisibility",
					removed: "removedModels"
				},
				cards: [{
					group: "integrations",
					fields: [
						{
							key: "showSidebarQuota",
							kind: "boolean",
							labelKey: "field.showSidebarQuota",
							hintKey: "field.showSidebarQuota.hint",
							fallback: false
						},
						{
							key: "quotaRefreshMinutes",
							kind: "number",
							labelKey: "field.quotaRefreshMinutes",
							hintKey: "field.quotaRefreshMinutes.hint",
							fallback: 1
						},
						{
							key: "autoSwitchModelOnQuota",
							kind: "boolean",
							labelKey: "field.autoSwitchModelOnQuota",
							hintKey: "field.autoSwitchModelOnQuota.hint",
							fallback: false
						},
						{
							key: "workspaceId",
							kind: "text",
							labelKey: "field.workspaceId",
							hintKey: "field.workspaceId.hint"
						}
					]
				}, {
					group: "advanced",
					fields: [
						{
							key: "baseURL",
							kind: "text",
							labelKey: "field.baseURL",
							hintKey: "field.baseURL.hint"
						},
						{
							key: "walletBase",
							kind: "text",
							labelKey: "field.walletBase",
							hintKey: "field.walletBase.hint"
						},
						{
							key: "requestTimeoutMs",
							kind: "number",
							labelKey: "field.requestTimeoutMs",
							hintKey: "field.requestTimeoutMs.hint"
						},
						{
							key: "streamIdleTimeoutMs",
							kind: "number",
							labelKey: "field.streamIdleTimeoutMs",
							hintKey: "field.streamIdleTimeoutMs.hint"
						}
					]
				}]
			},
			{
				ns: FEATURE_TAB_NS,
				rowIds: ["llm-commandcode"],
				providerId: FEATURE_TAB_PROVIDER,
				order: 9999,
				labelKey: "vendor.features",
				cards: [{
					group: "switch",
					fields: [
						{
							key: "autoContinue",
							kind: "boolean",
							labelKey: "field.autoContinue",
							hintKey: "field.autoContinue.hint",
							fallback: false
						},
						{
							key: "autoContinueMaxAttempts",
							kind: "number",
							labelKey: "field.autoContinueMaxAttempts",
							hintKey: "field.autoContinueMaxAttempts.hint",
							fallback: 3
						},
						{
							key: "autoContinueIntervalMs",
							kind: "number",
							labelKey: "field.autoContinueIntervalMs",
							hintKey: "field.autoContinueIntervalMs.hint",
							fallback: 2e3
						},
						{
							key: "searchStrategy",
							kind: "select",
							labelKey: "field.searchStrategy",
							hintKey: "field.searchStrategy.hint",
							options: [
								{
									value: "gateway-first",
									labelKey: "options.searchGatewayFirst"
								},
								{
									value: "api-first",
									labelKey: "options.searchApiFirst"
								},
								{
									value: "gateway-only",
									labelKey: "options.searchGatewayOnly"
								},
								{
									value: "api-only",
									labelKey: "options.searchApiOnly"
								},
								{
									value: "off",
									labelKey: "options.searchOff"
								}
							],
							fallback: "gateway-first"
						}
					]
				}]
			}
		];
		/**
		* React stand-in for the page component. Deliberately does not import
		* `react`: Task 4 replaces it with the real component, and an unused value
		* import would put React into the bundle's dependency list for nothing.
		*/
		const PLACEHOLDER_PAGE = () => null;
		/** `apply` invocations observed so far — the debug counter plan 1c reads. */
		let applyCountValue = 0;
		/**
		* 已经**在本轮激活里**注册过页面的宿主上下文。
		*
		* 为什么用 `WeakSet` 而不是布尔值、也不是「记住最后一个 ctx」：
		* - 布尔值永不复位 → 宿主刷新 / 重新激活后第二次 `apply` 直接 return，页面永久消失
		*   （2026-10-19 报障的根因）；
		* - 「记住最后一个 ctx」也不够：宿主可能同时持有多个 ctx（两行各一个），判重只在
		*   **同一个 ctx** 内成立。
		*
		* `WeakSet` 正好表达这个语义：同一个 ctx 只注册一次；换了新 ctx 自动视为未注册。
		* 用 WeakSet 而非 Set，是为了不让宿主上下文被我们长期持有（避免内存泄漏）。
		*/
		let pageRegisteredFor = /* @__PURE__ */ new WeakSet();
		/** 已经在本轮激活里注册过侧边栏卡片 / 中栏面板的宿主上下文（理由同 {@link pageRegisteredFor}）。 */
		let sharedSurfacesRegisteredFor = /* @__PURE__ */ new WeakSet();
		/**
		* How many times the host called `apply` (assumption ② in
		* `docs/operations.md`). Read it from
		* the browser console (`dsh-llm-account`), or assert it here.
		* @returns the current count.
		*/
		function applyCount() {
			return applyCountValue;
		}
		/**
		* The one client-plugin body. Runs once per mounted profile row.
		* @param rawContext - the client cordis context (typed narrowly on purpose: a
		*   seam reached for through an unmodeled property fails loudly).
		* @param options - page component factory and copy (see {@link ApplyShellOptions}).
		*/
		function applyShell(rawContext, options = {}) {
			const context = rawContext;
			injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
			for (const vendor of VENDORS) registerVendor(vendor);
			applyCountValue += 1;
			registerPageOnce(context, options);
			registerSharedSurfacesOnce(context, options);
			context.inject(["remote.credentials"], () => void 0);
		}
		/**
		* 注册页面。
		*
		* **没有外层"只注册一次"的守卫**，这是 2026-10-19「刷新后设置页消失」的最终修法。
		*
		* 历史：这里原来有一个模块级布尔 `pageRegistered`，后来又改成"按上下文对象记"。
		* 两次都错在同一个前提上 —— 那个守卫想在 `apply` 层面去重，但**去重本来就该发生在
		* 注册内部**：`registerPage` 自己会先撤销上一条再注册（`registered?.()`），所以重复
		* 调用是幂等的、安全的。而外层守卫一旦判"已经注册过"，在宿主重建（刷新 / 重新激活）
		* 时就再也不会重新注册 —— 页面直接消失。
		*
		* 结论：让每次 `apply` 都走一遍幂等注册，比任何形式的"记住注册过"都正确。
		* @param context - 这次激活的宿主上下文。
		* @param options - 页面工厂与文案。
		*/
		function registerPageOnce(context, options) {
			if (pageRegisteredFor.has(context)) return;
			try {
				registerPage(context, options);
				pageRegisteredFor.add(context);
			} catch (error) {
				console.error("[dsh-llm-account] could not register the settings page:", error);
			}
		}
		/**
		* 侧边栏卡片与中栏面板（同样**不加外层守卫**，理由见 {@link registerPageOnce}）。
		*
		* `registerSharedSurfaces` 内部同样是「先撤销再注册」，所以重复调用幂等。
		* @param context - 这次激活的宿主上下文。
		* @param options - 注册工厂。
		*/
		function registerSharedSurfacesOnce(context, options) {
			if (sharedSurfacesRegisteredFor.has(context)) return;
			try {
				options.sharedSurfaces?.(context, context.locale.bind(PAGE_LOCALE_NS));
				sharedSurfacesRegisteredFor.add(context);
			} catch (error) {
				console.error("[dsh-llm-account] could not register the sidebar card and the usage panel:", error);
			}
		}
		/**
		* Register the single `settings.section` page.
		*
		* Shape mirrored from the legacy call sites (header), including the nested
		* `slots.inject(name, () => slots.register(...))` form: the host resolves the
		* "settings.section" slot, and the callback registers our entry into it.
		* @param context - the client context.
		* @param options - page component factory and copy (see {@link ApplyShellOptions}).
		*/
		function registerPage(context, options) {
			const t = context.locale.bind(PAGE_LOCALE_NS);
			/**
			* 文案注册**必须先撤销上一条**。
			*
			* 宿主的 `locale.register` 对同一命名空间的**同一 locale 会直接抛错**
			* （`dsh-client-locale`：`if (locales.has(localeKey(locale))) throw new Error(...)`）。
			* 而 `ctx.effect(cb)` 的 cb 在插件重新激活时会再跑一次 —— 于是第二次注册就抛，
			* 整个 `apply` 被炸掉，表现是**刷新一次设置页就不见了**（2026-10-19 报障）。
			*/
			let unregisterCopy;
			context.effect(() => {
				try {
					unregisterCopy?.();
					const off = context.locale.register(PAGE_LOCALE_NS, options.copy ?? PAGE_COPY);
					unregisterCopy = typeof off === "function" ? off : void 0;
				} catch (error) {
					console.warn("[dsh-llm-account] could not register the page copy:", error);
				}
				return () => {
					unregisterCopy?.();
					unregisterCopy = void 0;
				};
			}, "dsh-llm-account: page copy");
			const component = options.pageComponent?.(t) ?? PLACEHOLDER_PAGE;
			/**
			* 上一次注册的撤销句柄。
			*
			* 宿主的 `slots.inject(name, cb)` 会在**每次槽位可用时**回调（设置对话框重开、其它插件
			* 重新注册都可能再触发一次）。以前这里直接 discard 了 `register` 的返回值，于是每次回调都
			* 追加一条同名 section；一旦宿主按句柄失效旧条目，点我们的 tab 就「打不开」
			* （市场自己就是靠 gate 反复重注册的，两边会互相顶掉）。
			* 现在：注册前先撤销上一条，并把撤销挂到 fiber 上随插件卸载收尾。
			*/
			let registered;
			context.effect(() => () => {
				registered?.();
				registered = void 0;
			}, "dsh-llm-account: settings section");
			context.slots.inject("settings.section", () => {
				try {
					registered?.();
					registered = void 0;
					const off = context.slots.register({
						name: "settings.section",
						id: PAGE_ID,
						order: 12,
						/** Legacy shape: `() => ctx.locale.bind(ns)("nav")`. */
						label: () => t("nav"),
						locale: PAGE_LOCALE_NS,
						/** Legacy shape: a factory returning `{ hooks: { ... } }`. */
						inject: () => ({ hooks: {} })
					}, component);
					registered = typeof off === "function" ? off : void 0;
					return off;
				} catch (error) {
					console.error("[dsh-llm-account] could not register the settings section (will retry on the next slot change):", error);
					return () => void 0;
				}
			});
		}
		/**
		* Page copy namespace, as **per-locale dictionaries** (the shape the legacy
		* commandcode page registers, `lib/client.js:7756-7763`).
		*
		* Fallback only: `index.ts` passes the full dictionaries from `copy.ts`. This
		* carries just the nav label so a bare `applyShell` (tests, or a host without the
		* page) still registers a labelled entry.
		*/
		const PAGE_COPY = {
			zh: { nav: "LLM 账号" },
			en: { nav: "LLM accounts" }
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* Client-side (browser) entry for `dsh-llm-account`.
		*
		* The host GUI loads `lib/client.js` through the DSH module loader
		* (`window.__ModuleLoader__.load`), so this module is a CommonJS-shaped
		* bundle whose host-provided dependencies (`react`, `react/jsx-runtime`,
		* `@deepseek-ai/dsh-client-ui-primitives`) arrive through the loader's
		* injected `require`.
		*
		* Task 1 scope: the real `apply` body — the module-level vendor registry
		* (`./registry`) and every host seam (`./shell`). No UI yet: the page component
		* arrives in Task 4.
		*/
		/**
		* Host **client services** this plugin needs, in cordis service-name form.
		*
		* Deliberately NOT the npm module ids listed under `package.json`
		* `dsh.client.inject` — the two lists answer different questions and are
		* expected to differ:
		*  - `package.json` `dsh.client.inject` = host client modules that must be
		*    loaded and available to this bundle;
		*  - this export = the cordis services `apply(ctx)` may touch. The loader
		*    arms exactly these before calling `apply`; touching an unlisted service
		*    throws.
		*
		* Matches the legacy client bundles: `@mars-sea/dsh-commandcode-provider/lib/client.js:8049-8053`
		* exports `["slots", "locale", "remote"]` while its `package.json:32-39` declares the npm ids;
		* `dsh-fpga-workbench/lib/client.js` exports `["slots"]`;
		* `dsh-plugin-save-token/lib/client.js` documents `{ inject: ['slots', 'locale'], apply(ctx) }`.
		*
		* `remote.credentials` is **not** listed here, and that is a deliberate choice,
		* not an impossibility — an earlier revision of this comment claimed "no legacy
		* bundle injects a separate `remote.credentials` entry", which is false:
		*  - `@mars-sea/dsh-commandcode-provider/lib/client.js:7764` is
		*    `ctx.inject(["remote.credentials"], (remoteCtx) => ...)`, a **nested**
		*    injection (so it never shows up in that bundle's top-level list), and the
		*    next line reads `remoteCtx.remote.credentials`;
		*  - `dsh-better-sidebar/lib/client.js:29451-29459` lists the dotted sub-service
		*    `"remote.session"` directly in its top-level `inject`, and its comment
		*    records the failure mode: a missing entry throws
		*    `cannot get property "remote.session" without inject` — which, thrown from
		*    a render path, blanks the whole panel.
		*
		* Both spellings are therefore valid host contracts. This package uses the
		* **nested** one: `src/client/shell.ts` arms `["remote.credentials"]` inside
		* `applyShell`. Do not declare a service here that `apply` does not need.
		*
		* **`remote.settings` IS required here** (measured 2026-10-17 on desktop
		* 0.2.1-rc.2). The settings page discovers its vendors through
		* `remote.settings.describe()`; without this entry the service is not bound to
		* the context and the page renders the empty notice — 「没有可显示的厂商」 — with
		* no error anywhere. Cordis throws `cannot get property "remote.settings"
		* without inject` when code touches an un-injected service, but our accessor
		* (`seams.ts` `remoteOf`) deliberately *degrades* instead of throwing, which is
		* right for a missing optional seam and wrong here: it turned a missing inject
		* entry into a silently empty page. Every official bundle that reads settings
		* lists it (`app.asar`: ui-settings, agent-preset, permission presets all carry
		* `"remote.settings"` in `inject`).
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings"
		];
		/**
		* The one client-plugin body. Runs once per mounted profile row, and both rows
		* share this module instance, so the page is registered only by the first call
		* (see `registerPageOnce` in `./shell`).
		*
		* Composition (single direction, no cycles):
		* `index` → `shell` (slot/locale registration primitives) and
		* `index` → `seams` → `page` → `page-state`. `shell` never imports the page layer;
		* it asks for a component factory and supplies the host-bound `t` itself.
		* @param ctx - the client cordis context.
		*/
		function apply(ctx) {
			console.debug("[dsh-llm-account] client bundle loaded");
			const seamContext = ctx;
			const guarded = (step, run) => {
				try {
					run();
				} catch (error) {
					console.error(`[dsh-llm-account] ${step} failed:`, error);
				}
			};
			guarded("shared state (usage remote + settings mirror)", () => startSharedState(seamContext, VENDORS));
			const pageComponent = (t) => createConnectedPage({
				entries: VENDORS,
				ctx: seamContext,
				t
			});
			guarded("shell registration (settings section + sidebar card + dashboard)", () => applyShell(ctx, {
				copy: {
					zh: COPY.zh,
					en: COPY.en
				},
				pageComponent,
				sharedSurfaces: (context, t) => registerSharedSurfaces({
					ctx: context,
					entries: VENDORS,
					t,
					localeNs: PAGE_LOCALE_NS
				})
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.applyCount = applyCount;
		exports.inject = inject;
		return module.exports;
	}
});
