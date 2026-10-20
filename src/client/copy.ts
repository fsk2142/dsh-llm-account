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
  | "field.autoSwitchModelOnQuota"
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
  | "field.autoContinueOnError"
  | "field.autoContinueOnError.hint"
  | "field.autoContinueOnTruncate"
  | "field.autoContinueOnTruncate.hint"
  | "field.autoContinueMaxAttempts"
  | "field.autoContinueMaxAttempts.hint"
  | "field.searchStrategy"
  | "field.searchStrategy.hint"
  | "options.searchGatewayFirst"
  | "options.searchApiFirst"
  | "options.searchGatewayOnly"
  | "options.searchApiOnly"
  | "field.searchApiKeyRefs"
  | "field.searchApiKeyRefs.hint"
  | "options.searchOff"
  | "search.secretAdd"
  | "search.secretRemove"
  | "search.secretEmpty"
  | "search.secretSave"
  | "search.secretSaving"
  | "search.secretPlaceholder"
  | "search.secretHint"
  | "search.secretNeedRef"
  | "search.keyConfigured"
  | "search.keyMissing"
  /**
   * 密钥实测（用户 2026-10-20：「添加了 key 后就发起一次小请求验证一下是否可用，不可用的话
   * 就进行提示」+「或者多增加一个测试按钮，让用户可以自行测试密钥的有效性」）。
   */
  | "search.keyTest"
  | "search.keyTesting"
  | "search.keyOk"
  | "search.keyInvalid"
  | "search.keyUnknown"
  | "field.searchApiKeyEnv"
  | "field.searchApiKeyEnv.hint"
  | "card.display"
  | "card.display.hint"
  | "card.switching"
  | "card.switching.hint"
  | "card.search"
  | "card.search.hint"
  | "card.advanced"
  | "card.advanced.hint"
  | "vendor.features"
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
  | "usage.title"
  | "usage.window.today"
  | "usage.window.7d"
  | "usage.window.30d"
  | "usage.window.all"
  | "usage.requests"
  | "usage.okShort"
  | "usage.failedShort"
  | "usage.requestsValue"
  | "usage.successRate"
  | "usage.tokens"
  | "usage.input"
  | "usage.output"
  | "usage.cacheRead"
  | "usage.cacheWrite"
  | "usage.cacheHitRate"
  | "usage.cost"
  | "usage.spent"
  | "usage.spentWindow"
  | "usage.lastAt"
  | "usage.failuresTitle"
  | "usage.exportCsv"
  | "usage.exporting"
  | "usage.exportFailed"
  | "usage.clearFailed"
  | "usage.clear"
  | "usage.clearConfirm"
  | "usage.clearConfirmAction"
  | "usage.clearing"
  | "usage.officialCost"
  | "usage.officialShort"
  | "usage.localOnly"
  | "usage.costPartial"
  | "usage.fromVendor"
  | "usage.localSpent"
  | "usage.priceUnknown"
  | "usage.period"
  | "usage.periodRange"
  | "usage.periodFrom"
  | "usage.inputShort"
  | "usage.outputShort"
  | "usage.periodFromVendor"
  | "usage.periodEstimated"
  | "usage.perAccount"
  | "usage.total"
  | "usage.empty"
  | "usage.emptyAccount"
  | "usage.loading"
  | "usage.readFailed"
  | "usage.kind.five-hour"
  | "usage.kind.day"
  | "usage.kind.week"
  | "usage.kind.month"
  | "quota.resetAt"
  | "quota.window.fiveHour"
  | "quota.window.rolling"
  | "quota.window.daily"
  | "quota.window.weekly"
  | "quota.window.monthly"
  | "sidebar.usagePeriod"
  | "sidebar.resetTime"
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
  | "models.loading"
  | "models.retry"
  | "models.refreshAccount"
  | "models.freeGroup"
  | "models.otherCompany"
  /**
   * 一组模型的「全选 / 取消全选」。
   *
   * 用户 2026-10-20：「原来的显示模型可以改成 全选 这样更符合那个按钮的本来含义」。
   * 以前的文案是「显示本组 / 隐藏本组」，读起来像「展开或收起这一段」，而它实际做的是
   * **勾选这一组里所有模型**。改名后与复选框语义一致。
   */
  | "models.selectAll"
  | "models.clearAll"
  | "sidebar.pinned"
  | "sidebar.effective"
  | "sidebar.open"
  | "sidebar.noRequest"
  /**
   * 侧边栏只显示「5 小时」与「每周」两档。这两档缺失时如实说没有，**不拿月度顶替**
   * （用户 2026-10-20：「小时额度信息和周额度信息没有的话也不能显示月度额度信息啊」）。
   */
  | "sidebar.noShortWindow"
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
  /**
   * vela 缺失时的**安装指引**（用户 2026-10-20：「opendesign 新增账户的时候如果使用网页登录，
   * 用户缺少环境的时候给出提示，如何快速安装环境」）。
   *
   * 只给一句「请先安装」没有用 —— 用户不知道装什么、从哪装、装完怎么确认。
   */
  | "account.vela.title"
  | "account.vela.step1"
  | "account.vela.step2"
  | "account.vela.step3"
  | "account.vela.command"
  | "account.vela.retry"
  /**
   * 插件更新后需要**刷新页面**的提示（用户 2026-10-20：「如果我不重启，侧边栏就无法出来，
   * 是否可以提示刷新页面的方式，这样就不需要我重启了」）。
   *
   * 为什么插件自己解决不了：侧边栏卡片属于宿主的**客户端启动图** —— 启动图在页面加载那一刻
   * 就确定了，之后新装/更新的插件不会自动进图（除非重启宿主）。而「刷新页面」会让浏览器重新
   * 走一遍启动图，插件随即被加载，效果与重启等价但成本低得多。
   */
  | "update.title"
  | "update.body"
  | "update.action"
  /**
   * 插件自身的更新检查（用户 2026-10-20：「希望加一个更新，这样有新版本的时候直接更新就可以，
   * 就不用每次卸载后重新装」）。
   *
   * 三种结论各有专门文案 —— 尤其是「链接安装」：那种装法**永远不会**通过更新按钮变化，
   * 把它说成「已是最新」会让用户等一个永远不来的按钮。
   */
  | "update.check"
  | "update.checking"
  | "update.section"
  | "update.start"
  | "update.available"
  | "update.current"
  | "update.notApplicable"
  | "update.unknown"
  | "update.starting"
  | "update.done"
  | "update.failed"
  | "account.reason.no-signin"
  | "account.reason.config-invalid"
  | "account.reason.error"
  | "empty.noVendor"

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
    "field.autoSwitchModelOnQuota": "额度用尽后自动切换模型",
    "field.autoSwitchModelOnQuota.hint":
      "开启后，账号额度用尽时会自动换一个模型继续：优先同网关同名，其次跨网关同名，再其次同网关同类，最后跨网关同类（同一档内取参数能力最接近的）。只在该账号已勾选的模型里挑。默认关闭。",
    "field.quotaRefreshMinutes.hint": "侧边栏卡片与设置页读取用量数据的间隔（设置页缓存也按它失效）；标签页隐藏时暂停刷新，连续失败会自动放慢。",
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
    "field.autoContinueOnError": "请求失败时自动重试",
    "field.autoContinueOnError.hint": "只在网络/服务端/限流这类瞬时失败上重试；用户主动停止与确定性错误（上下文超长、密钥无效）永不重试。",
    "field.autoContinueOnTruncate": "回答被截断时自动续写",
    "field.autoContinueOnTruncate.hint": "只在达到输出上限（finish=length）时补一句「继续」；正常结束不会多说话。",
    "field.autoContinueMaxAttempts": "每轮最多自动继续次数",
    "field.autoContinueMaxAttempts.hint": "两个开关共用这个上限，防止无限续写烧额度。缺省 3。",
    "field.searchStrategy": "搜索方式",
    "field.searchStrategy.hint": "网关路：模型在对话里调用服务端搜索工具，按 token 计费（一次搜索等于一次模型调用）。API 路：直连 /v1/tools/search，按请求次数计费、不烧 token，但需要下面填的那个 key。",
    "options.searchGatewayFirst": "网关优先（省 API 余额）",
    "options.searchApiFirst": "API 优先（省 token）",
    "options.searchGatewayOnly": "只用网关",
    "options.searchApiOnly": "只用 API",
    "field.searchApiKeyRefs": "DeepSeek API key 引用名",
    "field.searchApiKeyRefs.hint": "凭据库里的引用名（不是明文）。多个用逗号分隔，按顺序轮替：前一个无效或余额不足时自动换下一个。",
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
    "usage.localOnly": "仅本机（不含其他设备）",
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
    "models.loading": "正在读取模型目录…",
    "models.retry": "重试",
    "models.refreshAccount": "刷新此账号的模型",
    "models.freeGroup": "免费模型",
    "models.otherCompany": "其他",
    "models.selectAll": "全选",
    "models.clearAll": "取消全选",
    "sidebar.pinned": "已指定",
    "sidebar.effective": "当前使用",
    "sidebar.open": "点击打开用量面板",
    "sidebar.noRequest": "还没有请求经过这个账号。",
    "sidebar.noShortWindow": "没有 5 小时 / 每周额度数据（这里只显示这两档；月度额度请打开用量面板查看）。",
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
    // —— vela 缺失时的安装指引（2026-10-20 用户要求「如何快速安装环境」）——
    // 三步都是**可执行**的：装桌面端（最省事，自带 vela）→ 或装 CLI → 回来点重试。
    // 命令放在 `account.vela.command` 里单独一条，方便用户整行复制。
    "account.vela.title": "怎么快速把环境装上",
    "account.vela.step1": "① 最省事：装 Open Design 桌面端（安装包内自带 vela，装完不用再配 PATH）：https://open-design.ai/download",
    "account.vela.step2": "② 或只装命令行（已装 Node.js 时）：在终端执行下面这条命令",
    "account.vela.step3": "③ 装完回到这里点「网页登录」重试；若 vela 不在 PATH 里，可设环境变量 VELA_BIN 指向它的完整路径，然后重启 DSH",
    "account.vela.command": "npm i -g @powerformer/vela-cli",
    "account.vela.retry": "重试网页登录",
    "update.title": "插件已更新",
    "update.body":
      "新装的插件要等页面重新加载后才会出现在界面上（侧边栏卡片、中台面板都是）。刷新一下本页即可，不用重启 DSH。",
    "update.action": "刷新页面",
    "update.check": "检查更新",
    "update.checking": "正在检查…",
    "update.section": "插件更新",
    "update.start": "更新到新版本",
    "update.available": "有新版本：{installed} → {latest}",
    "update.current": "已是最新版本（{installed}）。",
    "update.notApplicable":
      "当前是**本地链接安装**（{installed}），它跟着源码走，不会通过更新按钮变化 —— 改了代码刷新页面即可。要装发行版，请从插件市场重新安装一次。",
    "update.unknown": "暂时查不到更新信息：{reason}",
    "update.starting": "正在更新…",
    "update.done": "装好了。刷新页面后新版本才会生效（下面那个「刷新页面」按钮）。",
    "update.failed": "更新失败：{reason}",
    "account.reason.no-signin": "浏览器里没有完成授权（vela 已退出）。请重试并在浏览器里批准。",
    "account.reason.config-invalid": "本机的登录产物形状不认识（缺少 runtime key）。请重新登录一次。",
    "account.reason.error": "登录失败。",
    "empty.noVendor": "没有可显示的厂商。",
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
    "field.autoSwitchModelOnQuota": "Auto-switch model when quota runs out",
    "field.autoSwitchModelOnQuota.hint":
      "When on, running out of quota switches to another model automatically: same gateway + same model first, then cross-gateway same model, then same gateway + comparable model, then cross-gateway comparable model (closest capability within a tier). Only models enabled for that account are considered. Off by default.",
    "field.quotaRefreshMinutes.hint": "How often the sidebar card and the settings page read usage data (the settings cache expires on the same schedule); paused while the tab is hidden, and failures are slowed down automatically.",
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
    "field.autoContinueOnError": "Retry failed requests",
    "field.autoContinueOnError.hint": "Retries only transient failures (network/server/rate limit); user stops and deterministic errors are never retried.",
    "field.autoContinueOnTruncate": "Continue truncated answers",
    "field.autoContinueOnTruncate.hint": "Only when the answer hit the output limit (finish=length); normal endings are untouched.",
    "field.autoContinueMaxAttempts": "Max auto-continues per turn",
    "field.autoContinueMaxAttempts.hint": "Shared by both switches, so a loop cannot burn quota forever. Default 3.",
    "field.searchStrategy": "Search route",
    "field.searchStrategy.hint": "Gateway: the model calls the server-side search tool; billed per token (one search = one model call). API: calls /v1/tools/search directly; billed per request, no tokens, needs the key below.",
    "options.searchGatewayFirst": "Gateway first (save API balance)",
    "options.searchApiFirst": "API first (save tokens)",
    "options.searchGatewayOnly": "Gateway only",
    "options.searchApiOnly": "API only",
    "options.searchOff": "Web search off",
    "field.searchApiKeyRefs": "DeepSeek API key references",
    "field.searchApiKeyRefs.hint": "Credential reference names, not literal secrets. Separate several with commas; they are tried in order when one is invalid or out of balance.",
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
    "usage.localOnly": "this device only (excludes other devices)",
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
    "models.loading": "Loading the model catalog…",
    "models.retry": "Retry",
    "models.refreshAccount": "Refresh this account's models",
    "models.freeGroup": "Free models",
    "models.otherCompany": "Other",
    "models.selectAll": "Select all",
    "models.clearAll": "Clear all",
    "sidebar.pinned": "Selected",
    "sidebar.effective": "In use",
    "sidebar.open": "Click to open the usage panel",
    "sidebar.noRequest": "No request has used this account yet.",
    "sidebar.noShortWindow": "No 5-hour / weekly quota data (only those two are shown here; open the usage panel for monthly).",
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
    "update.body":
      "A newly installed plugin only shows up after the page reloads (sidebar card, middle panel). Reload this page — no need to restart DSH.",
    "update.action": "Reload page",
    "update.check": "Check for updates",
    "update.checking": "Checking…",
    "update.section": "Plugin update",
    "update.start": "Update to the new version",
    "update.available": "New version: {installed} → {latest}",
    "update.current": "You're on the latest version ({installed}).",
    "update.notApplicable":
      "This is a **linked local install** ({installed}); it follows the source tree and never changes through an update button — edit the code and reload the page. To use a release build, install it from the plugin market again.",
    "update.unknown": "Could not check for updates: {reason}",
    "update.starting": "Updating…",
    "update.done": "Installed. Reload the page to start using the new version (the button below).",
    "update.failed": "Update failed: {reason}",
    "account.reason.no-signin": "The browser never finished signing in (vela exited). Try again and approve in the browser.",
    "account.reason.config-invalid": "The local sign-in data has an unrecognised shape (no runtime key). Sign in again.",
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
