# 用量面板第三轮返修：套餐信息、月度额度、新增账号操作逻辑（2026-10-18）

日期：2026-10-18
项目：`dsh-llm-account`
范围：`src/core/adapter.ts`、`src/vendors/commandcode/plans.ts`（新增）、`src/vendors/commandcode/quota.ts`、`src/vendors/usage-remote.ts`、`src/client/**`（`usage-contract.ts`、`quota.ts`、`account-card.ts`、`dashboard.ts`、`accounts-panel.ts`、`seams.ts`、`copy.ts`、`css.ts`）
背景：用户验收第二轮后带回四件事 —— ① 「套餐信息没办法获得吗？我这个是订阅的套餐」；
② 「月度额度也没有显示」；③ 「再添加一个 opencode 的账号添加」；④ 「新增账号那个地方也优化一下
操作逻辑」；另有「再看看还有没有可以优化的地方」。

## 0. 先纠正一个事实：套餐**是**能读到的

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

## 1. 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 套餐信息 | 端点只给 `planId` 与状态，**不给**套餐名与每月额度；名称/额度只有厂商静态表里有（CLI 与旧插件各带一份，内容一致） | 新增 `vendors/commandcode/plans.ts`：9 条 `planId` 前缀 → `{name, monthlyCredits}`（Go 10 / GOAT 70 / Pro 30 / Pro-v1 80 / Provider 15 / Max 150 / Ultra 300 / Teams Pro 40），**最长前缀**匹配（`individual-pro-v1` 用 80 而不是 30）；`adapter.ts` 的 `QuotaSnapshot.plan` 从 `string` 升级为结构化 `QuotaPlan { id, name?, status?, monthlyCredits?, periodEnd? }`；`quota.ts` 的 `planOf` 走 subscriptions 优先、`credits.planId` 回退（CLI 同），`data: null` 视为**没有订阅**（不是读失败）；账号卡与仪表盘各多一行 `data-account-plan` / `data-dashboard-plan`：`套餐 GOAT · 每月 $70.00 · 本期至 2026/11/14` |
| ② 月度额度没显示 | 月度窗口此前**故意**不给上限（`monthlyCredits` 是**余额**，拿它当 cap 会画出百分之几百的伪读数），所以订阅账号也只看到「已用 $14.24」 | 现在**有套餐**时按厂商自己的算法给配给：`cap` = 套餐每月额度、`used` = `cap − 余额`、`resetAt` = 本期结束（旧插件 `monthlyView` 第 5722-5750 行、CLI `getCreditDepletionPct` 同一口径）→ 订阅账号看到 `已用 $14.23 / 共 $70.00` + 20% 的条 + 重置时间；**没有套餐**（未订阅 / 表里没有 / 余额缺失）时退回原来的「只报当期消耗」，一个字都不编 |
| ③ 再加一个 opencode 账号入口 | opencode 的多账号 `add` 早已实现（ref 形如 `DSH_OPENCODE_GO_ACCOUNT_<LABEL>_<HASH>`，上限 20），缺的是**看得清、点得准** | 新增入口按厂商分组：每家一个小标题（`data-add-vendor-group`）+ 两个动作「使用 API Key」/「网页登录」；按钮文字不再自带厂商前缀（标题已经写了），厂商仍留在 `data-add-for` / `data-login-for` 上 |
| ④ 新增账号操作逻辑 | 空名称点「确定」时 `dispatchAccountAction` 按规矩**不发调用**，界面因此**毫无反应** —— 按钮看起来像坏的；远程侧 reject 则被 `void pending.then(…)` 静默丢掉 | ① 容器加 `actionError` 状态：空名称/空密钥 → 「请先填写账户名称。」「请先填写密钥。」；远程面没挂上 → 「账户服务还没就绪」；远程 reject → 原文（以前完全不可见）。② 表单顶上写明「添加 Command Code 账户」（面板底部只有一个表单位置、两家共用）。③ 名称框自动聚焦。④ 两个输入框**回车 = 确定**（重命名/更换密钥的编辑器同样支持）。⑤ 密钥框下方写明「密钥只写入本机凭据库，设置文件里不留明文」。⑥ 一改字段就清掉上一次的错误 |
| ⑤ 还能优化什么 | — | 仪表盘也显示套餐行（与设置页同一形状、同一份 `quotaPlanText`）；`QuotaPlan` 进摘要时**拷贝**出去（测试钉住不是宿主对象引用）；修正 `commandcode/quota.ts` 里「窗口单位是 token 数」的**过时注释**（线上 14/35 与旧插件 `formatMoney` 都证明是美元额度） |

## 2. 关键决策与依据

- **没有套餐就是没有，不猜**：`planOf` 只在端点给了 `planId` 或 `status` 时产出 `QuotaPlan`；
  表里没有的 `planId` 只带 `id`（+状态），`name`/`monthlyCredits` 一律缺省 —— 界面退回标识原文。
  这样厂商上新套餐时界面不会撒谎（只是少两块信息），补表即可。
- **月度窗口的两种口径必须分开**：`cap` 只能来自套餐表，`used` 只能来自「额度 − 余额」或
  「当期消耗」，二者不可混用。余额缺失（端点失败）时**不**降级成 `used = 0`，而是整条退回消耗口径
  —— 否则「读不到余额」会显示成「这个月还没用」。
- **`active` 不写上屏**：状态是常态就不重复；`trialing` / `past_due` / `canceled` /
  `incomplete` 本地化后露出，词表外的原文照排（状态是厂商开放词表）。
- **`actionError` 放容器而不是页面状态**：`PageState` 管的是**可序列化的页面状态**（草稿、
  展开、动作），一次「刚才为什么没提交」属于**渲染生命周期内的瞬态**，随下一次输入或取消消失；
  放容器（唯一的 Hook 宿主，Ruling 22）既能被仿真测试走到，又不污染 `page-state` 的不变量。
- **失败可见化**：`void pending.then(ok)` 改成 `then(ok, err => setActionError(原文))`。
  宿主校验/凭据服务的拒绝以前看不见，用户只会以为按钮坏了。

## 3. 验证

- `vitest run`：**654 通过 / 0 失败**（48 个文件）。本轮新增/改写：
  `commandcode-plans.test.ts`（新增 5 条：表与 CLI 对照、最长前缀、规范化、表外不猜）、
  `commandcode-quota.test.ts`（套餐行结构、两种月度口径、`data: null`、未知标识、
  「usage 失败不影响套餐口径」）、`quota.test.ts`（`quotaPlanText` 四块独立）、
  `account-card.test.ts`（标题/自动聚焦/回车/错误行/套餐行）、
  `accounts-panel.test.ts`（分组入口 + 错误只落在编辑中的那一家）、
  `container-simulation.test.ts`（空名称点确定：有原因、零调用；输入后原因消失；只带名称也能提交）、
  `usage-remote.test.ts` / `dashboard.test.ts` / `sidebar-card.test.ts`（结构化 plan 与拷贝语义）。
- `tsc --noEmit` 通过；`tsdown` 重建 `lib/`：`lib/commandcode.js` 含套餐表与 `planOf`，
  `lib/client.js` 含 `data-account-plan` / `data-action-error` / 新文案。
- 未提交 git（工作树另有用户改动；等重启验收）。

## 4. 已知边界

- **没有订阅的账号不显示套餐行**：端点回报 `data: null` 时就是没有可显示的事实。
  用户若想给无订阅账号手工指定套餐，那是另一件事（设置项），本轮没做 —— 先看真实账号的效果。
- **套餐表是静态快照**：厂商上新套餐后，表外的 `planId` 只显示标识与状态；补表要重新对
  `command-code@1.84.0` 的 `Sr`/`wr` 或旧插件 `KNOWN_SUBSCRIPTION_PLANS`。
- **`credits.planId` 回退路径**：订阅端点只给状态、不给标识时会用它（CLI 同样把它当身份章）；
  两个来源都没有时只有状态、没有标识。
- **「opendesign」按「opencode」理解**：仓库与磁盘上没有任何 `opendesign` 命中；若用户指的是
  另一家厂商（新路由），需要新开一家（入口 + 凭据 + 额度端口）。
