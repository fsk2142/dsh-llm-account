# 用量面板三轮返修（2026-10-18）

> **合并说明（2026-10-20）**：本文件由三份独立记录合并而成 ——
> `2026-10-18-usage-panel-fixes.md`（第一轮）、`…-round2.md`（第二轮）、`…-round3.md`（第三轮）。
> 三轮是同一功能的连续修复，分散在三个文件里读不到完整脉络（尤其「缓存冻结」这条根因
> 横跨第一、二轮）。原文逐节保留，只加了轮次标题；被删文件可从 git 历史取回。
>
> 三轮的共同背景：用户每次验收后带一批具体问题回来，本轮只解决当轮的问题，
> **不动账户/切换/额度语义**（那是 `2026-10-19-rotation-and-model-fallback.md`
> 与 specs 的范围）。

---

# 第一轮：账户信息超时、平铺列表、转到设置、按账户刷新

日期：2026-10-18
范围：`src/vendors/usage-remote.ts`、`src/client/**`（仪表盘、账户面板、接缝层、样式、文案）与十条级测试
背景：用户带一张用量面板截图提了五件事 —— 「经常获取不到账户信息」「不要按供应商分组，直接显示
账号信息和对应供应商」「面板再增加一个转到设置」「重新获取模型应该刷新单个账户而不是所有」
「每个账户缺少单独刷新的按钮」。本轮全部落在客户端与 usage 远程服务，不动账户/切换/额度语义。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| 经常获取不到账户信息 | 单账号额度读取预算 8s，而 Command Code 端口是 `whoami` → 三端点并行的**两跳**，慢网下每跳 4-5s；端口自身端点预算 300s。8s 必然砍掉正常读取 | `QUOTA_READ_TIMEOUT_MS` 8s → **30s**，超时后**重试一次**（只重试超时，确定性失败不重试）；失败项改用**账号名称**（不再泄漏内部 ref） |
| 不要按供应商分组 | 旧仪表盘按厂商分 section，两个标题两个区块 | 平铺列表：所有厂商的账号一份列表，供应商是账号名后的**徽标**（`data-account-vendor`，与设置页账户行同一类）；兜底窗口与固定标注按账号**自己所属厂商**算 |
| 面板增加「转到设置」 | 宿主**没有**「打开设置对话框」的插件接缝（设置开关住在 ui-settings-general 的模块级 store，未注册为 cordis 服务；`ctx.layout` 只有 `selectPanel`/`toggleSidebar`/`openRightbar`/`closeRightbar`；shortcuts 不能程序化触发 —— app.asar 逐一排除） | 把**同一份设置页组件**注册进 `main` 插槽（key `llm-account-settings`，宿主明文支持的 keyed 面板）；按钮调 `layout.selectPanel`，宿主没这个接缝时用 `canSelectPanel` 探针**不渲染**按钮；面板带返回栏回仪表盘（不是 `selectPanel(null)`：用户从仪表盘来的） |
| 重新获取模型应刷新单个账户 | 旧实现是面板头部一个全局按钮 + 计数器，点了对**全部厂商**重读 | 全局按钮删除；**每个账号行**一个刷新按钮（`data-account-refresh-models`），回调带厂商：目录是厂商级资源（`models()` 按厂商寻址），一次读取惠及该厂商所有账号但不碰别家；加载中禁用并转圈（`aria-busy` + `dsl-spin`） |
| 每个账户缺少单独刷新按钮 | 同上 | 账号行动作区第三个图标按钮；模型区读失败时的「重试」与它是同一个动作 |

附带：仪表盘与账号级的失败项，给人话文案（超时 →「读取超时」），原文留在 `data-failure-detail`
上 —— 把 `timeout after 30000ms` 印在界面上就是调试输出。（第二轮把这条纪律
推广成 `client/failure-text.ts` 的逐条本地化。）

## 关键决策与依据

- **「转到设置」= 主栏面板而不是对话框**：宿主没有打开设置对话框的插件接缝（本轮大量逆向
  app.asar 证实，注释留在 `SETTINGS_PANEL_ID` 上）。`main` 插槽的 keyed 面板是宿主明文支持的
  扩展点（Plugins 页、任务管理器同款），所以「转到设置」在主栏打开同一份设置页组件，带一条
  返回栏。页面工厂由 `index.ts` 用宿主绑定的 `t` 造，经 `shell.ts` 透传给 `registerSharedSurfaces`
  （`settings.section` 的页面与这个面板是同一份组件的两个实例、两个 React 根）。

---

# 第二轮：英文、切换记录、缓存冻结、单位、思考档位

日期：2026-10-18
范围：`src/client/**`（`failure-text.ts` 新增、`quota.ts`、`dashboard.ts`、`account-card.ts`、`models-card.ts`、`sidebar-card.ts`、`seams.ts`、`copy.ts`、`css.ts`）、`src/vendors/commandcode/**`（`efforts.ts` 新增、`adapter.ts`、`protocol.ts`、`quota.ts`）
背景：用户验收第一轮后带回六件事 —— ① whoami 用量面板里多了英文；② 不需要保留切换记录；
③ 重新点开设置后原来显示的额度信息又不见了；④ 额度信息带上单位；⑤ 月额度信息也没有
（「无法获取吗？」）；⑥ 选择模型后仍然无法继续选择思考模式。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 面板里有英文 | 诊断原文直接上屏：端点短名（`whoami`、`credits`、`usage`）、宿主包装过的 `quota: commandcode "Work" read failed (timeout after 30000ms)`、以及客户端接缝自己产的 `the llm-account remote namespace has no models()` | 新增 `client/failure-text.ts`：已知形状**映射成人话**（含带引号账号名的包装 →「账号 X 的额度读取失败（读取超时）」），认不出的形状**原样返回**（宿主能力错误要看得见）；原文一律留在 `data-*`（`data-failure-detail` / `data-account-quota-failure` / `data-dashboard-failure` …）。接线的四处：账户卡片（厂商级失败 + 额度失败 + 目录失败）、仪表盘（厂商级失败 + 账号额度失败）、侧边栏卡片、模型卡片（`failureListText` 处理 `；` 连接的多条） |
| ② 不要切换记录 | 记录只说明过去发生过什么，用户要的是「现在哪张卡还有额度」 | 客户端**全部**移除：仪表盘的记录区（读取 + 渲染 + `switches` prop）、`seams.ts` 的 `readSwitches` 与仪表盘加载、`copy.ts` 的 `dashboard.switches`/`dashboard.noSwitches`、`css.ts` 的 `.dsl-switch*`/`[data-switch-record]`/`CSS_CLASS.switchNotice`/`switchRoute`。**宿主侧的 `switches()` 与 `rotation` 的记录保留**（跨行观测要它：设置页/侧边栏跟随真实账号），`switch-card` 的「即将切换」倒计时也保留 —— 那是将来的事，不是历史 |
| ③ 重新打开设置额度又不见了 | **缓存冻结**：一次瞬时失败（单端点超时）的读数被写进 60s TTL 的设置页读数缓存，重开设置直接吃这份残缺读数，看起来像额度凭空消失 | 新增 `seams.ts` 的 `completeReading(status)`：只有**完整**读数够格进缓存（failures 为空 + 每个「已配置」账号都有非空 quota 且 `quota.failures` 为空）；不完整照旧每次现读。三个写缓存点（设置页状态 effect、侧边栏写回、仪表盘写回）都过这道闸 |
| ④ 额度信息带上单位 | 单位是**厂商给的事实**，不能由界面猜 | `QuotaUnit = "usd"`（`core/adapter.ts`），CC 的 `quota.ts` 给每个数字窗口标 `unit: "usd"`（不限窗口没有数字，不标）；界面 `quotaAmount` = `$` + 两位小数（旧插件 `formatMoney` 第 1516 行同一口径：`$7.22`、`$0.12 / $3.00`）；没给单位的窗口照旧裸数字（不替别家猜单位）。原始浮点仍在状态与 `data-*` 里 |
| ⑤ 月额度也没有 | **不是端点故障**：实测 `whoami` → `usage`/`billing/credits`/`billing/window-limits` 四端点全部 200，`usage.totalCredits = 62.2122`；月度额度来自 `usage`，此前只要它那一次读取瞬时失败，界面就只剩失败行 | 同 ③（残缺读数不再进缓存，重开必现读）；并且月度窗口本来就只在 `usage` 给数时才出现（缺失 ≠ 0）。`usage` 失败时窗口列表与失败项分开呈现：读到的照旧显示，失败项给人话 |
| ⑥ 不能选思考模式 | 宿主的档位选择器**完全**由 `resolveModel().reasoning.efforts` 驱动，而 CC 网关的 `/provider/v1/models` 从不公布档位（实测 85 个模型的键只有 `id`/`name`/`reasoning`/`contextWindow`/`maxTokens`）—— 不声明就等于没有档位可选 | 新增 `vendors/commandcode/efforts.ts`：官方 CLI 模型表的静态档位快照（58 个模型，与旧插件 `KNOWN_EFFORTS` 在 command-code@1.79.2 上校验过）；`resolveModel` 用它声明档位（负载自己哪天公布了就以负载为准）；请求路径按表**再收一次口**（宿主的「关闭」会送来 `off`，表里只有部分模型认它；表外的值一律不发字段）；Messages 传输在有可选档位时打开 `thinking: { type: "adaptive" }`（旧插件第 6624 行：那个端点只认 adaptive，且不开它 `output_config.effort` 不起作用） |

## 关键决策与依据

- **本地化 ≠ 抹掉证据**：`failureText` 只翻「认得出形状」的诊断；认不出的原样上屏（宿主能力
  错误 `the host remote service has no $mount()` 这类必须看得见）。每处都保留 `data-*`
  原文属性，排查路径不变。
- **表外模型就是不声明档位**：自动思考、由厂商决定深度的模型（旧插件 `KNOWN_THINKING_MODELS`
  的那批）本来就没有可选档位；猜一组只会换来一个发出去就被厂商拒的请求。opencode 侧无需改动
  —— models.dev 的 `reasoning_options` 已经声明了档位（探测 32 个模型中 26 个有）。
- **`off` 的处理跟着表走**：旧插件把「关闭思考」编码成 `off` 档位，网关对不认它的模型会拒字段，
  所以请求路径校验一次（`supported.includes(...)`），声明与发送同一条纪律。

---

# 第三轮：套餐信息、月度额度、新增账号操作逻辑

日期：2026-10-18
范围：`src/core/adapter.ts`、`src/vendors/commandcode/plans.ts`（新增）、`src/vendors/commandcode/quota.ts`、`src/vendors/usage-remote.ts`、`src/client/**`（`usage-contract.ts`、`quota.ts`、`account-card.ts`、`dashboard.ts`、`accounts-panel.ts`、`seams.ts`、`copy.ts`、`css.ts`）
背景：用户验收第二轮后带回四件事 —— ① 「套餐信息没办法获得吗？我这个是订阅的套餐」；
② 「月度额度也没有显示」；③ 「再添加一个 opencode 的账号添加」；④ 「新增账号那个地方也优化一下
操作逻辑」；另有「再看看还有没有可以优化的地方」。

## 先纠正一个事实：套餐**是**能读到的

第一轮/第二轮的判断（「套餐必须手填」）建立在两把**未订阅**密钥的实测上。本轮把
`~/.dsh/.credentials.yaml` 里**三把** ref 都跑了一遍（脚本 `cc-third.mjs`）：第三把
`DSH_LLM_ACCOUNT_SAMPLE` 正是**订阅账号**，四个端点全绿：

| 端点 | 形态 |
| --- | --- |
| `/alpha/whoami` | `user = sample-user`（user@example.com） |
| `/alpha/billing/subscriptions` | `data = { id: sub_…, status: "active", planId: "individual-goat", currentPeriodStart: 2026-10-14, currentPeriodEnd: 2026-11-14, cancelAtPeriodEnd: false, orgId: null }` |
| `/alpha/billing/credits` | `credits.monthlyCredits = 55.7714050703`（余额）、`purchasedCredits = 0`、`freeCredits = 0`；`windowLimits = { limited: true, fiveHour: { used: 0.0024, cap: 14 }, weekly: { used: 14.2285949297, cap: 35 } }` |
| `/alpha/usage/summary` | `totalCredits = 14.24`、`periodBasis = "billing-period"`、`periodStart = 2026-10-14`（订阅账期，不再是无订阅账号的滚动 30 天） |

三条交叉验证，把「套餐 → 月度配给」这层语义钉死了：

1. `fiveHour.cap = 14`、`weekly.cap = 35` 正好是 **70 的 1/5 与 1/2** —— GOAT 的每月额度是 70；
2. `70 − 55.7714050703 = 14.2285949297` 与该账号 `weekly.used` **一字不差**；
3. 官方 CLI `command-code@1.84.0` 的 `getPlanInfo` / `getPlanTotalCredits` 的静态表
   （`Sr`/`wr`）里 `individual-goat → { name: "GOAT", monthlyCredits: 70 }`，与旧插件
   `KNOWN_SUBSCRIPTION_PLANS`（第 941-995 行）一致。

官方文档（`command-code-knowledge/reference/plans.md`）说的「plan is not readable
headlessly；去问用户、去看 `/usage` 浮层或网页」针对的是**哪一个 planId**的问题 ——
有订阅的账号，`subscriptions.data.planId` 就是答案；没订阅的账号，端点如实回报 `data: null`，
那种「没有套餐」本身也是读数。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 套餐信息 | 端点只给 `planId` 与状态，**不给**套餐名与每月额度；名称/额度只有厂商静态表里有（CLI 与旧插件各带一份，内容一致） | 新增 `vendors/commandcode/plans.ts`：9 条 `planId` 前缀 → `{name, monthlyCredits}`（Go 10 / GOAT 70 / Pro 30 / Pro-v1 80 / Provider 15 / Max 150 / Ultra 300 / Teams Pro 40），**最长前缀**匹配（`individual-pro-v1` 用 80 而不是 30）；`adapter.ts` 的 `QuotaSnapshot.plan` 从 `string` 升级为结构化 `QuotaPlan { id, name?, status?, monthlyCredits?, periodEnd? }`；`quota.ts` 的 `planOf` 走 subscriptions 优先、`credits.planId` 回退（CLI 同），`data: null` 视为**没有订阅**（不是读失败）；账号卡与仪表盘各多一行 `data-account-plan` / `data-dashboard-plan`：`套餐 GOAT · 每月 $70.00 · 本期至 2026/11/14` |
| ② 月度额度没显示 | 月度窗口此前**故意**不给上限（`monthlyCredits` 是**余额**，拿它当 cap 会画出百分之几百的伪读数），所以订阅账号也只看到「已用 $14.24」 | 现在**有套餐**时按厂商自己的算法给配给：`cap` = 套餐每月额度、`used` = `cap − 余额`、`resetAt` = 本期结束（旧插件 `monthlyView` 第 5722-5750 行、CLI `getCreditDepletionPct` 同一口径）→ 订阅账号看到 `已用 $14.23 / 共 $70.00` + 20% 的条 + 重置时间；**没有套餐**（未订阅 / 表里没有 / 余额缺失）时退回原来的「只报当期消耗」，一个字都不编 |
| ③ 再加一个 opencode 账号入口 | opencode 的多账号 `add` 早已实现（ref 形如 `DSH_OPENCODE_GO_ACCOUNT_<LABEL>_<HASH>`，上限 20），缺的是**看得清、点得准** | 新增入口按厂商分组：每家一个小标题（`data-add-vendor-group`）+ 两个动作「使用 API Key」/「网页登录」；按钮文字不再自带厂商前缀（标题已经写了），厂商仍留在 `data-add-for` / `data-login-for` 上 |
| ④ 新增账号操作逻辑 | 空名称点「确定」时 `dispatchAccountAction` 按规矩**不发调用**，界面因此**毫无反应** —— 按钮看起来像坏的；远程侧 reject 则被 `void pending.then(…)` 静默丢掉 | ① 容器加 `actionError` 状态：空名称/空密钥 → 「请先填写账户名称。」「请先填写密钥。」；远程面没挂上 → 「账户服务还没就绪」；远程 reject → 原文（以前完全不可见）。② 表单顶上写明「添加 Command Code 账户」（面板底部只有一个表单位置、两家共用）。③ 名称框自动聚焦。④ 两个输入框**回车 = 确定**（重命名/更换密钥的编辑器同样支持）。⑤ 密钥框下方写明「密钥只写入本机凭据库，设置文件里不留明文」。⑥ 一改字段就清掉上一次的错误 |
| ⑤ 还能优化什么 | — | 仪表盘也显示套餐行（与设置页同一形状、同一份 `quotaPlanText`）；`QuotaPlan` 进摘要时**拷贝**出去（测试钉住不是宿主对象引用）；修正 `commandcode/quota.ts` 里「窗口单位是 token 数」的**过时注释**（线上 14/35 与旧插件 `formatMoney` 都证明是美元额度） |

## 关键决策与依据

- **没有套餐就是没有，不猜**：`planOf` 只在端点给了 `planId` 或 `status` 时产出 `QuotaPlan`；
  表里没有的 `planId` 只带 `id`（+状态），`name`/`monthlyCredits` 一律缺省 —— 界面退回标识原文。
  这样厂商上新套餐时界面不会撒谎（只是少两块信息），补表即可。
- **月度窗口的两种口径必须分开**：`cap` 只能来自套餐表，`used` 只能来自「额度 − 余额」或
  「当期消耗」，二者不可混用。余额缺失（端点失败）时**不**降级成 `used = 0`，而是整条退回消耗口径
  —— 否则「读不到余额」会显示成「这个月还没用」。
- **`active` 不写上屏**：状态是常态就不重复；`trialing` / `past_due` / `canceled` /
  `incomplete` 本地化后露出，词表外的原文照排（状态是厂商开放词表）。
- **`actionError` 放容器而不是页面状态**：`PageState` 管的是**可序列化的页面状态**（草稿、
  保存结果），一次性动作错误属于交互反馈，留在容器的 `useState` 里，页面仍是纯函数。

---

# 三轮共同的验证与边界

- 每轮都以 `pnpm run typecheck`（0 错）+ 全量 `vitest` + `tsdown` 双产物重建收尾；
  轮次终点的用例数依次为 8xx → 9xx → 1xxx（具体数字见各轮提交信息）。
- **已知边界**：宿主的 `resolveModel()` 档位声明只在「模型目录已读过」时可用；目录读失败时
  不声明档位，界面就不显示选择器 —— 这是宿主驱动的事实，不是本插件的缺陷。
- **月度额度的 cap 只信套餐表**：厂商上新套餐时必须补 `plans.ts`，否则该套餐只显示「已用」。
  这是刻意的取舍：宁可少一块信息，也不猜一个会画出伪读数的上限。
