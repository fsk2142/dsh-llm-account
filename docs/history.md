# 实现时间线

按时间顺序记录「什么时候做了什么、为什么」。**这里不是手册** —— 需要可操作的结论时
看上面几份主题文档；这里用于追溯「这个行为是哪一轮加的」以及当时的取舍。

---

## 账号轮播与限额换模型（2026-10-19）

日期：2026-10-19（本轮，接在「统计搬到账号下面」之后）
涉及提交：`1ee3498`（轮播 + 换模型雏形）、`9827db6`（候选限制在可选范围）、`7ad6ba0`（跨厂商委托）

这两件事都是用户在同一天里逐步澄清出来的，需求演化过程比结果更值得记下来 —— 因为它解释了
为什么代码里有几处看起来「绕」的地方。

---

## 一、侧边栏账号轮播

### 需求怎么变的

| 时点 | 法 | 含义 |
| --- | --- | --- |
| 最初 | 「循环显示不同账号的额度是否一直没有成功」 | 以为是 bug |
| 查清后 | —— | 不是 bug：`showSidebarQuota` 是**按厂商**存的，profile 里只给 commandcode 开了 |
| 再澄清 | 「自己选择轮播哪些账号进行显示，默认为所有账号轮播」 | 从**厂商级**改成**账号级** |

### 最终行为

- 轮播单位是 **(厂商, 账号)**，不是厂商；
- 默认**所有已配置账号**都参与（`sidebarAccounts` 未配置时不过滤）；
- 间隔 `sidebarRotateMinutes`（三家 Config 都有，默认 1 分钟，范围 1–60）；
- 侧边栏卡片整块可点 → 打开用量面板（刷新区在面板上）；
- 卡片内**两行**：第一行 5 小时档（带重置时间），第二行每周 + 每月并排。

### 关键实现点（以及为什么这么绕）

**1. 循环依赖**：账号清单住在 `status()` 里，而「该读哪一家」又取决于当前显示哪个账号。

解法：把清单当**独立数据**。一次 `status(某家)` 就同时带回「该家所有账号」和「额度」，所以：

```
启动 → 各开启的家各读一次 status（建清单）→ 之后每拍只重读目标账号所在的那一家
```

**2. `targets` 必须渲染期现算，不能进 state**：第一版放进 state，形成
「清单变 → setState → 重渲染 → 清单键又变」的回环，`turn` 每次被重置，
**轮播永远停在第一个账号**（实测：卡片上反复出现同一个账号名）。
现在 `sidebarTargetsOf(vendors, statuses, selection)` 是纯函数、渲染期直接算。

**3. 渲染条件看 `vendors.length`，不看 `targets.length`**：清单要先读一次 status 才有，
用清单当条件会死锁 —— 卡片不渲染 → 轮询不启动 → 永远不读 → 清单永远空 → 永远空白。

**4. `resetSeams()` 必须复位轮播的三份模块级状态**（`sidebarVendorsValue` /
`sidebarAccountKeysValue` / `sidebarSelectionConfiguredValue`）。漏了之后测试互相污染，
表现为「单独跑能过、连跑就失败」。

### 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/client/page-state.ts` | `sidebarTargetsOf` / `sidebarAccountKeysOf` / `sidebarSelectionConfigured` / `sidebarIncludesAccount`；`SIDEBAR_ACCOUNTS_KEY` |
| `src/client/seams.ts` | 容器：建清单、轮播定时器、`targets` 现算、`noteSidebarSnapshots` 填充清单 |
| `src/client/sidebar-card.ts` | `accountRef` 属性（显示指定账号）、两行额度版式 |

---

## 二、限额时换模型

### 需求怎么变的

原话：「遇到账号限额的时候自动切换到同等类型的模型还有思考强度，但是排除官方的 API」。
追问后澄清：

- **「同等类型」= 同名模型**，没有同名就停手（不是按 flash↔pro 这种档位猜）；
- 用户可自选范围：「增加一个选项，可以有用户指定选择在那些模型中进行切换，但是优先切换相同名称的模型」；
- 「排除官方的 API」= 排除 DeepSeek 官方直连；
- 时机：**失败后重试**，本次请求就换。

### 最终规则（`src/core/switching/model-fallback.ts`，纯函数 + 单测）

1. **只认同名**：`modelKeyOf` 去掉厂商前缀、转小写、抹掉 `-`/`.`/`_` 后比较。
   `deepseek/deepseek-v4.1-flash` ≡ `deepseek-v4.1-flash` ≡ `DeepSeek-V4.1-Flash`；
   但 `deepseek-v4-pro` 与 flash **不同名**，不会互替。
2. **找不到同名就返回 `undefined`** —— 停手。限额是要省钱，不是把用户悄悄降到更弱的模型。
3. **排除官方直连**：`isOfficialProvider`（`deepseek` / `deepseek-*`）。
4. **思考强度尽量保留**（`fallbackEffort`）：替代模型支持原档位就保留；不支持则取该模型
   **最高**档；替代模型没有档位就不发字段。

### 候选只在「用户可选范围内」

这一条是用户当天追加的，而且我第一版**漏了**：

> 「还有一个可自选模型范围的怎么没做，根据当前的可选模型配置切换模型名单」

第一版候选取自 `catalogModels()`，而它的契约明确写着「**不受** `visibleModels` /
`modelVisibility` 过滤，供设置页勾选」。后果是：用户在设置页关掉的模型，限额换模型时
**照样会被选中** —— 那是绕过用户明确表达过的偏好，比不换更糟。

现在注册源改用 `listModels(provider)`（已按用户配置过滤）。相关规则见
`src/core/catalog.ts`：
- 白名单非空 → 只放名单内的；
- 逐模型显式 `false` **优先于**白名单；
- **从未配置可见性 → 全部关闭**（安全默认，因此换模型没有候选）。

### 跨厂商执行（`delegateStream`）

瓶颈：宿主的 `GenerateOptions.provider` 由路由决定，一个 adapter **不能**以别家身份发请求。

解法：注册表（`src/vendors/model-catalog-registry.ts`）除了模型清单，还登记各家的
`stream`。换到别家时由 `delegateStream(target, options)` 调**目标那一家的 adapter**：

- 只换 `provider` / `model` 两个字段，`messages` / `tools` / `signal` 原样透传
  （测试用引用相等钉住）；
- 目标家没登记或没 `stream` → 返回 `undefined`，调用方按「换不了」处理（**不硬切**）；
- 官方直连**永不**被委托（挑候选时排除一次，`delegateStream` 里再挡一次）。

### 三个 adapter 里的换模型分支

在 `rotation.pick()` 返回空（所有账号都被拒绝）之后：

```
① 同 provider 有同名候选 → 换 model id、清 tried、continue（不走递归！）
② 别家有同名候选 → delegateStream(...)，把流接过来
③ 都不能 → 抛原来那个失败
```

两个必须记住的坑：

- **不能递归调 `this.stream()`**：那会重跑 `beforeRequest`（可能再次触发账号切换）并把
  `tried` 清空。实测表现是「换模型后又用空密钥重试一次」（`gateway.keys` 里多出一个空串）。
- **只在「确实有账号被拒绝」时才尝试**（`lastFailure` 存在且不是 `invalid-credential`）。
  一条凭据都没解析到时直接抛 `MISSING_CREDENTIAL`，不为此去打目录端点 —— 「一条密钥都没有
  时零 HTTP」是既有纪律，不该为换模型让步。

### 候选缓存

`modelCandidates()` 带 60 秒 TTL。真实填充路径是**适配器读目录成功时**顺手
`noteCatalogModels`（本来就要为模型选择器读），不在失败路径上现打三家端点。

### 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/core/switching/model-fallback.ts` | 纯判定：`isOfficialProvider` / `modelKeyOf` / `pickFallbackModel` / `fallbackEffort` |
| `src/vendors/model-catalog-registry.ts` | 跨厂商候选 + `delegateStream` / `canDelegate` |
| `src/vendors/*/adapter.ts` | 换模型分支（同家换 id / 跨家委托）、`#fallbackModel`、`listModels` 里 `noteCatalogModels` |
| `src/vendors/*/index.ts` | 登记目录读口 + `stream` 委托入口 |

---

## 三、测试锚点

| 文件 | 钉住什么 |
| --- | --- |
| `tests/core/model-fallback.test.ts` | 同名判定、排除官方、不猜档位、思考强度回落 |
| `tests/core/fallback-scope.test.ts` | **候选只来自可选范围**；被关掉的同名模型不会被选中 |
| `tests/vendors/model-delegation.test.ts` | 委托只换两字段、不能委托时返回 `undefined`、官方永不被委托 |
| `tests/client/container-simulation.test.ts` | 账号级轮播真的换账号（CC → OC → CC）、跳过无账号的家 |
| `tests/client/sidebar-card.test.ts` | 两行版式、整卡点击、缺档不占位 |

---

## 四、仍需知道的边界

1. **adapter 只能服务自己的 provider** —— 这是宿主的契约，不是本包的取舍。跨厂商换模型
   靠 `delegateStream` 转给目标家的 adapter，前提是那家**已在同一进程 apply 过**。
2. **委托是一次性的**：目标家自己再遇到限额不会继续往下换（避免跨厂商来回弹球）。
3. **不可见模型 = 没有候选**：如果用户把所有模型都关掉，换模型不会发生。这是刻意的安全默认。
4. **轮播不会为空转**：`targets.length <= 1` 时不排定时器；一个账号都没有时卡片显示空态。
---

## OpenDesign 接入施工过程（2026-10-18）

> 从 [vendors.md](vendors.md) 移入（2026-10-22 整理）。这些是**当时**的施工轮次记录，
> 其中若干结论后来被修正过（尤其是额度换算率），**不要当成现状依据** ——
> 现状看 vendors.md 的「厂商事实」与「窗口上限的口径」。
### 施工结果（2026-10-18 晚，接手 agent）

- `src/vendors/opendesign/index.ts` 已装配（`name = "llm-opendesign"`、`inject = ["llm"]`、
  `PROVIDER_ID = "opendesign"`、`SETTINGS_ROWS = ["opendesign", "llm-opendesign"]`、全 volatile Config、
  能力声明、`enabled` 门 + `loader/volatile-update` 重判、`credentials/reference-updated` 清拒绝记忆、
  `applyUsageRemote` 三家共宿、`disableSettingsAutoForm`）。
- **与施工单的差异**：没有接 `promoteServed`（适配器 deps 无该回调，本期没实现「服务账号上报」）——
  `index.ts` 里有段落注释说明原因与后续补法；不影响账号轮换与模型链路。
- `OpenDesignBundle.accounts` 的类型改为 `OpenDesignAccounts`（`add` 多收 `controlKey` / `workspaceId`）：
  运行时本来就是它，之前收窄成 `AccountPort` 让装配测试的类型检查丢了这两个可选字段。
- 客户端：`VENDORS` 第三条（order 30）、`VendorId`、`VENDOR_IDS`、`shell.ts` 的卡片字段、
  `copy.ts` 的 `vendor.opendesign` / `field.workspaceId` / `field.walletBase`、`web-search-panel` 的
  `VENDOR_ROWS` 第三行。
- 测试：`opendesign-quota`（11）、`opendesign-login`（10）、`opendesign`（9，装配）、
  **`opendesign-adapter`（14，模型路径：listModels / catalogModels / resolveModel / stream /
  档位闸门 / 401 换号 / 400 不换号 / 空响应 / 工具调用）**；`fuzz.test.ts` 的第三家纯函数属性块（4 条）。
- 既有断言同步：`registry`（三家 ns）、`container-simulation`（徽标三家、`statusCalls` 2→3、刷新增量 +3、
  TTL/缓存按厂商逐家判定 —— opendesign 无账号时读数完整、进缓存）、`randomized-simulation`
  （`firstEnabledVendor` 加第三家、TABS 加 `llm-opendesign`、字段加 `workspaceId`）、`build.test.ts`。
- 假宿主 `tests/support/fake-host.ts` 补第三行设置（行 id `opendesign`，与命名空间不同 —— 与 opencode
  同一形状，写入必须落在行 id 上），`browserLogin` 能力与真实声明对齐（commandcode / opendesign）。

**结果**：`tsc` 0 错；`vitest` 58 文件 / 761 例全绿；`tsdown` 产出 `lib/opendesign.js`、
`lib/opendesign.d.ts` 与更新后的 `lib/client.js`；四个宿主入口都能被 Node 直接 import
（`name` / `inject` / `apply` / `Config` 形状正确）。

### 实测修正（2026-10-18 21:50，用户报「加了 API 没有额度也没有模型」）

用户添加了纯 API Key 的 Open Design 账号后，模型与额度都读不到。实测与修正：

1. **目录要鉴权（真 bug）**：`GET https://amr-link.open-design.ai/v1/models` 不带密钥直接回
   `401 {"error":{"code":"missing_api_key"}}` —— 计划 §0 写的「目录是公开的」在本网关上不成立，
   所以 `catalogRequest()` 一直不带 `Authorization`，模型列表**永远为空**。
   修法：`catalogRequest(base, key?)` 带上推理密钥；适配器新增 `#catalogKey()`（优先当前生效
   账号，其次第一个已配置账号 —— 目录是厂商级资源，任意可用账号的密钥都能读）。
2. **加完账号后不重读目录**：目录读取的 effect 依赖只有 `[usage, modelVendorKey]`，加账号
   （`accountRevision`）不会重读，界面停在挂载时那次空目录上。修法：依赖加 `accountRevision`
   （失败读数不进缓存，所以必会真读一次）。
3. **额度需要两样东西，以前没告诉用户**：
   - 控制面密钥：手动添加只收一把 API key（表单没有控制面字段）。新增**回退**——没有独立
     控制面密钥时用推理密钥试一次（账单/余额与推理同一个 Bearer）；真被拒会有失败项。
   - 工作区：额度窗口**只来自** vela 的 `codingPlan.windows`；没有 `workspaceId` 就一条窗口都
     没有。以前这条路径是**静默跳过**（界面「没条」与「厂商没有」长得一样）。现在记一句
     人话失败：「该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在
     设置里手填）」。
4. 探测到的事实（未带密钥的 401/404 形状）：`/api/v1/wallet/balance` 存在（`{ balanceUsd }`，
   仍未接：客户端契约没有余额展示位，计划 §2.5 的同一判断）；`/api/v1/billing/usage`、
   `/api/v1/usage`、`/api/v1/credits` 不存在（404）。

测试：opendesign-adapter 的 `listModels` 断言改为"带账号推理密钥"；opendesign-quota 的
workspace 缺失用例改为"不查 vela + 必须给出原因"。

### 第三轮（22:00）：思考强度 / 套餐 / 显示名

用户报三点：① 模型选不了思考强度；② 套餐信息也没有；③ 显示名称要统一成模型官方名。

1. **思考强度（档位）**：根因同 Command Code 那次 —— 宿主的档位选择器**完全**由
   `resolveModel().reasoning.efforts` 驱动，而 Open Design 的 `GET /v1/models` 是 OpenAI 形状
   （`{id,object,created,owned_by}`），**从不公布档位**，于是永远没有可选项。
   - 新增 `src/vendors/opendesign/efforts.ts`：**模型族兜底**（claude/anthropic、
     gpt-5..9 与 o 系列、gemini、grok → `low/medium/high`；deepseek/glm/kimi/qwen →
     `low/high`；认不出的族**不声明**）。目录哪天自己公布档位就以目录为准。
   - 声明（`resolveModel`）与闸门（`#declaredEffort`）用**同一份**判定，不存在「声明了却不发」
     或「发了没声明」。
   - 保险：网关若回 400 且正文点名 `reasoning_effort`，**去掉该字段重发一次**（档位退化为
     厂商默认，但回答照常拿到）；与档位无关的 400 不重放。
2. **显示名**：新增 `src/core/model-names.ts` 的 `officialModelName(id)` —— 品牌词官方大写、
   相邻数字拼版本号（`4-5` → `4.5`）、去掉日期快照后缀、`GPT`/`GLM` 与版本号用连字符。
   `parseCatalog` 在没有 `name`（或 name 只是回显 id）时用它生成展示名；**请求永远用 id**。
   拼接用**连字符**（用户补充：官方名中间是有中心线的）—— `Claude-Sonnet-4.5`、`GPT-5.1-Codex`、
   `Qwen3-Max`、`DeepSeek-V4-Pro`。
3. **套餐**：
   - 账单摘要失败现在**带上原因**（`HTTP 502` / `账单接口不可达（…）`），以前只有一句
     「没有数据」，用户无从判断是被拒、超时还是没有订阅。
   - `planOf` 对字段名**宽容读取**：`membershipTier|membership|tier|plan|subscriptionTier`、
     `subscriptionStatus|status|subscriptionState`、`subscriptionCurrentPeriodEnd|currentPeriodEnd|
     periodEnd|renewsAt`，也认 `subscription` 子对象。
   - 仍然如实说明：**套餐来自账单单据**；纯 API Key 的账号如果没有订阅，就没有套餐可显示
     —— 这不是界面丢了数据。

测试：`tests/core/model-names.test.ts`（5）、`tests/vendors/opendesign-catalog.test.ts`（7，
目录命名 + 档位族）、adapter +3（族兜底声明、400 去字段重放、无关 400 不重放）、quota +1（宽容读套餐）。

### 第四轮（22:25）：工作区自动发现

用户网页登录成功后问「工作区怎么设置」。实测 `~/.amr/config.json` 的 profile **只带两把
密钥与 user，没有 workspaceId**（`profile[prod] keys: apiUrl, controlKey, linkUrl, runtimeKey, user`），
所以登录并不会自动填上工作区 —— 而周期额度必须有它。

- 新增 `discoverWorkspaceId()`（`login.ts`）：跑 `vela team-projects list`，从
  `{"workspaceId":"…"}` 里取当前工作区；找不到 vela / 非零 / 输出不是 JSON / 空 id 一律读作
  「没发现」（附加动作，不能把登录判成失败）。5 秒预算。
- `index.ts` 的 `storeKey`：`input.workspaceId ?? await discoverWorkspaceId()`。
  - 新账号：直接写进账号条目；
  - 已有账号：写**顶层** `workspaceId`（条目没配时的回退）—— 只补空，不覆盖用户填过的值。
- 本机实测：`vela team-projects list` → `sample-workspace-id`；
  `vela billing preflight --workspace-id sample-workspace-id --format json` 正常返回两条窗口
  （18000s / 50000 credits、604800s / 150000 credits），账单摘要 `Membership: go, active monthly`。

**手动路径**（已有账号、或不想重新登录）：设置页 →「LLM 账号」→ 顶部「设置对象」选 Open Design →
「集成与显示」卡片里的「工作区 ID」→ 粘贴 → 保存。

### 第五轮（22:40）：思考档位改为「逐模型实测表」，DeepSeek 拿到 max

用户问：「opendesign 的 DeepSeek 不能设置 max 思考吗？」—— 不能，因为第三轮按**模型族**给的
保守集是 `low / high`，而实测这家支持到 8 档。

**怎么测出来的**：这个网关对不认识的档位回 400，且正文把该模型的白名单念出来：

```
deepseek-v4-pro: [code=invalid_request_error] reasoning effort is unsupported for
  deepseek-v4-pro; use one of none, minimal, low, medium, high, xhigh, ultra, max
glm-5.3-flash:   ... use one of low, high, max
kimi-k2.7-code:  ... use one of none, minimal, low, medium, high, xhigh      ← 没有 max
claude-haiku-5.5: [code=upstream_error] reasoning_effort: Invalid option:
  expected one of "max"|"xhigh"|"high"|"medium"|"low"|"minimal"|"none"        ← 没有 ultra
```

于是用本机登录产物（`~/.amr/config.json` 的 `runtimeKey` + `x-vela-workspace-id`）对账号可用的
**12 个模型逐个**打一次 `reasoning_effort: __probe__`，把白名单抄成
`src/vendors/opendesign/efforts.ts` 的 `MEASURED_EFFORTS`：

| 模型 | 白名单 |
|---|---|
| deepseek-v4-pro / -flash / -flash-vision-exp / v4.1-flash | none, minimal, low, medium, high, xhigh, **ultra**, **max** |
| claude-haiku-5.5 / hy4-preview / mimo-v2.6-flash / -pro | none, minimal, low, medium, high, xhigh, **max** |
| glm-5.3-flash / -flashx | low, high, **max** |
| kimi-k2.7-code | none, minimal, low, medium, high, xhigh（**无 max**） |
| gpt-6-luna | 全档（含 ultra） |

**实测证明档位真的生效**（同一条行程题，deepseek-v4-pro）：

| reasoning_effort | completion tokens | reasoning tokens |
|---|---|---|
| `none` | 555 | 0（不想） |
| `high` | 1629 | 1159 |
| `max` | 3052 | **2571** |

**改动**：
1. `efforts.ts` 改为「实测表优先 → 模型族兜底」：表里有的只用表（含顺序，由弱到强）；
   族兜底现在也带 `max`（claude/gpt 七档、deepseek 八档、glm 三档、kimi 到 xhigh）；
   未实测的族（gemini/grok/qwen）给含 `max` 的保守集；认不出的照旧不声明。
2. 适配器的 400 兜底从「去掉字段重发」升级为**按网关念出的白名单降一档重发**
   （`allowedEffortsIn` + `nearestAllowedEffort`）：推错档位最多退一档，不再整段丢失；
   读不出白名单才退回去掉字段。
3. 测试：`opendesign-catalog` 12 例（实测表逐模型差异、两种 400 口吻、降档挑选）、
   `opendesign-adapter` 18 例（新增「网关拒绝 max 时降成 high 重发」）。

结果：`tsc` 0 错；**61 文件 / 811 例全绿**；`tsdown` 已重建。

### 第六轮（22:55）：档位按官方口径收敛 + 额度自动发现工作区

**用户确认**：DeepSeek 官方只有四档 `off / low / high / max`。上一轮把网关接受的别名全摆出来
（8 档）是错的 —— 网关确实接受 `none/minimal/medium/xhigh/ultra`（摊平到上游四档），但界面
该按官方口径只给四档。`efforts.ts` 已改为：

| 族 | 声明档位 |
|---|---|
| deepseek | `off, low, high, max` |
| claude / gpt / hy4 / mimo | `low, medium, high, xhigh, max` |
| glm | `low, high, max` |
| kimi-k2.7-code | `low, high`（网关不接受 max） |

另外 `off` 与 `none` 视为同一档（`STRENGTH_ORDER` 里 off 排最前）：网关只认 `none` 时降档会
落到 `none`，不会升成 `max`。

**额度不显示（真 bug）**：网页登录产物 `~/.amr/config.json` 只有 runtimeKey/controlKey/user，
**没有 workspaceId**；而周期额度窗口只来自 `vela billing preflight --workspace-id`。以前的
"登录时发现一次" 只覆盖登录当刻，手动加的 API 账号走不到那条路径。

- `quota.ts` 的 `workspaceIdOf` 允许返回 Promise；`index.ts` 新增 `workspaceFor()`：
  条目/顶层都没有时问一次 `vela team-projects list`，成功即写回顶层设置并进程内常驻
  （失败缓存 1 分钟）。
- 本机实测：`sample-workspace-id` → preflight 返回两条窗口（906/50000、906/150000 credits），
  账单 `membershipTier: go`、`creditsPerUsd: 10000`。

### 第七轮（23:15）：月度额度 + 账单摘要改走 vela 回退

用户报「opendesign 缺少月额度信息」。查了厂商自己的文档（`open-design.ai/model-credits`）：

| 套餐 | 月度上限 | 7 天窗口 | 5 小时窗口 | 计划模型额度 |
|---|---|---|---|---|
| Go | **$120** | $30 | $10 | $0 |
| Plus | $180 | $160 + $20 | — | $20 |
| Pro | $480 | $360 + $120 | — | $120 |
| Max | $900 | $600 + $300 | — | $300 |

**结论**：月度上限**存在**（写在套餐卡上），但 `billing preflight` 只发 5 小时与 7 天两个窗口，
月度的**用量**在接口里读不到（控制面 HTTP 403、vela CLI 也不给）。所以实现为：

- `toQuotaSnapshot` 在厂商没发月度窗口时补一行 `{ key: "monthly", unit: "usd", cap }`，
  `cap` 取官方套餐表（go 120 / plus 180 / pro 480 / max 900），**`used` 留空**（不编 0）；
  `resetAt` 取订阅本期结束（摘要里的 `subscriptionCurrentPeriodEnd`）。
- 客户端新增 `quotaReading` 的 `cap` 形状 + 文案 `quota.capOnly`（「上限 {cap}」），
  否则「只有上限」会被当成「额度数据暂缺」而不显示。
- `DURATION_KEYS` 补 30/31 天 → `monthly`：厂商哪天开始发月度窗口就直接映射，不再变成裸秒数键。

**顺带修掉一个真 bug**：控制面的 `GET /billing/summary` 对本机的 runtimeKey / controlKey **都回 403**
（试过带/不带 workspace 头），所以套餐与换算率一直是空的。`vela billing summary --format json`
却能读到同一份数据（`membershipTier: go`、`creditsPerUsd: 10000`、`subscriptionCurrentPeriodEnd`）。
额度端口新增 `summaryFallback`，HTTP 失败时回退到 vela；两边都失败才记失败项。

结果：`tsc` 0 错；61 文件 / 815 例全绿；`tsdown` 重建。


---

### 网页登录的三类症状与修法（2026-10-18）

实测（设置页 → 账户面板）：

1. 点 Command Code 的「网页登录」后**没有自动弹出浏览器**；
2. 授权链接/等待面板**一直不消失**；
3. 点 OpenCode 与 Open Design 的「网页登录」**没有任何反应**。

### 根因（三条独立成因，都不是「按钮没接上」）

- **没有自动打开**：客户端里根本没有打开窗口的代码。授权网址只以 `<a href>` 的形式列出，
  等用户自己点。三家都这样。
- **面板不消失**：等待面板没有「取消」；`loginStatus` 轮询又只处理 `waiting → 其它`，
  用户不授权时状态一直是 `waiting`，于是链接挂到宿主侧超时才消失（commandcode 是 120s）。
- **另外两家没反应（真 bug）**：`onLoginBegin` 是 `void remoteValue(usage?.loginBegin(v)).then(...)`：
  - 登录流程自己返回 `failed`（opencode 设备码申请失败 → `network`；opendesign 本机没有 vela →
    `vela-missing`）时，**界面只渲染 `waiting`**，`failed` 无处显示 → 看起来什么都没发生；
  - 远程调用 reject / 同步抛错时没有失败分支 → 异常被吞（点击处理器里直接抛 = 页面无变化）。
  - 第三条还有一个放大器：远程命名空间方法在返回 promise **之前**同步抛错时，
    `remoteValue` 根本收不到 promise（`await` 的是已经炸掉的表达式）。

### 修法

- `src/client/login-window.ts`（新）：`openLoginWindow` / `pointLoginWindowAt` / `closeLoginWindow`。
  浏览器只允许在**用户手势的同步阶段**开窗，所以点击当刻先开 `about:blank`，
  拿到 `authUrl` 再导航；失败/取消/success 一律关掉占位窗口（不留空白页）。
  读 `location` 本身也会抛（跨域），整个导航必须包在 try 里。
- `src/client/accounts-panel.ts`：
  - 等待面板加「取消登录」（`data-action="login-cancel"` + `data-login-for`）；
  - 「添加账户」组下面新增三态提示：启动中（`data-login-starting`，按钮 `disabled`+`aria-busy`）、
    流程失败（`data-login-failure` + `data-login-failure-detail`，原因翻成人话）、
    调用失败（`data-login-error` + `data-login-error-detail`，原文只进 data 属性）；
  - `cancelled` 不算失败，不报红。
- `src/client/seams.ts`：
  - `beginLogin(vendor)` 统一两个入口（合并面板与账号行内联登录）：关旧窗口 → 同步开新窗口 →
    进「启动中」→ 调远程 → `waiting` 导航窗口 / `failed` 关窗并记录 / 抛错关窗并记录；
  - `cancelLogin(vendor)`：关窗、清状态、调 `loginCancel`；
  - 新增 `callRemote()`：把命名空间方法的**同步抛错**折成被拒绝的 promise（登录按钮与 1s 轮询
    两处都经它）；
  - 轮询：连续 3 次读不到（`LOGIN_POLL_MAX_MISSES`）才判 `failed/network`；
    本机时钟过了 `expiresAt` 而宿主仍报 `waiting` 时就地收 `failed/timeout`；
  - 页面卸载时关掉未导航的占位窗口。
- `src/vendors/opencode/login.ts`：设备码申请失败按「HTTP 拒绝 → `unavailable`」与
  「传输失败 → `network`」分开报（以前一律 `network`，界面会说错话）。
- `src/client/copy.ts`：新增 `account.loginStarting/loginCancel/loginFailed/loginExpired` 与
  `account.reason.vela-missing/no-signin/config-invalid`（zh/en 成对）。

### 测试

- `tests/client/login-window.test.ts`（9）：无 window / 被拦截 / 导航失败 / 跨域读 location /
  关窗幂等。
- `tests/client/accounts-panel.test.ts`（+5）：取消按钮与回调、失败原因文案、cancelled 不报红、
  启动中禁用、调用失败的原文只在 data 属性。
- `tests/client/container-simulation.test.ts`（+5，真容器）：opencode 路由与自动导航、
  opendesign 失败可见且关窗、取消后停轮询、success 自动消失并重读账号、连续读失败先保面板后收尾。
- `tests/vendors/opencode-login.test.ts`（+1）：HTTP 拒绝 vs 传输失败的两种原因。

结果：`tsc` 0 错、vitest 59 文件 / 781 例全绿、`tsdown` 重建成功。

### 真机待验

- Command Code：点「网页登录」应弹出一个窗口并停在授权页；浏览器里批准后等待面板自动消失、
  账号出现在列表；不批准可点「取消登录」。
- OpenCode：若仍失败，界面会说明原因是网络还是服务端拒绝（以前完全没提示）。
- Open Design：没有 vela 时会明确说「本机找不到 vela…」，装上桌面端/CLI 后应能弹出设备授权页。

### 第二轮（同日 21:45–21:55）：不登录也要自己收起

用户补充两点：① 不登录时链接不消失、必须手点「取消登录」；② 再点一次「新增账户」也应能取消。

- **期限**：Command Code 的 `waiting` 状态以前**不带** `expiresAt`（宿主自己有 120s 定时器，
  但界面不知道）。现在宿主把它报出来（`src/vendors/commandcode/login.ts`），客户端在
  `expiresAt` 到了就地收成 `failed/timeout` 并收起面板；宿主没报期限时按
  `LOGIN_WAITING_TTL_MS = 120s` 兜底。
- **关窗即收起**：用户关掉我们弹出的授权窗口 → 面板收起（**不**取消宿主流程：关闭那一刻
  他可能刚批准，取消会误杀成功；流程自己会超时，轮询到终态即止）。
- **竞态闸门**：定时器每秒一拍，超时判定后仍有多拍在途；迟到的 `waiting` 会把面板闪回来
  （实测）。新增 `loginClosed` 引用：收尾后一律不采纳 `waiting`。
- **再点「新增账户」= 收起区块**：`<details>` 的 `onToggle`（open=false）→
  容器把开着的添加表单（`closeAction`）与等待中的登录（`loginCancel`）一起收掉。
  两者都渲染在 `<details>` 外面，只折叠摘要的话它们会留在卡片上。
- 测试：container-simulation +5（到期收起 / 无 expiresAt 的默认 TTL / 关窗收起且不误取消 /
  收起区块同时清表单与登录 / 加账号后目录重读），accounts-panel +1（onToggle 语义）。


---

### 第三方模型的图片输入：调研结论（2026-10-19）

日期：2026-10-19（本轮）
实测现象：「我发现每次第三方 deepseek 模型不支持图片输入，理论上官方都是支持的，你顺便检查一下」。

**结论先说：这不是一个「声明写错了」的小修，而是图片通路根本没做。** 本包目前既没有把图片
内容块序列化进请求，也没有声明图片模态；只改声明会让模型**收到一个它看不见的图片**然后
若无其事地回答，比现在明确拒绝更糟。所以本轮只做调研，没有改代码。

### 证据 1：厂商目录里根本没有模态字段

`%USERPROFILE%\.dsh\commandcode\commandcode-models.json`（旧插件落盘的线上目录，85 个模型）
每一行的键只有 `id` / `name` / `reasoning` / `contextWindow` / `maxTokens`。deepseek 家族全都在，
一行示例：

```json
{"id":"deepseek/deepseek-v4-flash-vision-exp","name":"DeepSeek V4 Flash Vision (exp) (CC)","reasoning":false,"contextWindow":1000000,"maxTokens":65536}
```

本包 `src/vendors/commandcode/catalog.ts` 与 `.../opendesign/catalog.ts` 的
`inputModalitiesOf()` 只认 `modalities` 数组里的 `"image"` 或布尔 `image: true` —— 负载什么都没
声明，于是每个模型都按 `["text"]` 广告。宿主的语义是「显式省略 = 否定能力」，所以界面/分发
层就认定这些模型不能收图。

### 证据 2：请求侧把图片块直接丢掉了

`src/vendors/commandcode/protocol.ts` 的 `textOf()`（opendesign 同形）：

```ts
/** 把一段内容压成纯文本（文件/图片块属于第 3 期，这里只取文本块）。 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) if (block.type === "text") parts.push(block.text);
  return parts.join("");
}
```

opencode 的 `toPiContext()` 同样只产出 `{ type: "text" }` 的 part。也就是说：**即使**把
`inputModalities` 改成 `["text","image"]`，图片也到不了厂商。

### 证据 3：官方通路是怎么做的

宿主自带的官方 DeepSeek 适配器（`app.asar` → `@deepseek-ai/dsh-llm-deepseek/lib/index.js`）：

- 目录里 `DEFAULT_MODELS` 只有两条，其中 **`deepseek-flash`（DeepSeek-V4.1-Flash）声明了
  `inputModalities: ["text","image"]`，`deepseek-v4-pro` 没有声明**（= 只有文本）；
- 送图要注入 `ctx.get("attachments")`，调 `attachments.readImageRequest(ref, target, signal)`
  拿到请求版的字节，再序列化成 `{ type: "image", source: { type: "base64", media_type, data } }`；
- 还有一整套图片预算 / offload 投影（`LlmImageRequestBudget`、`requiredImageOffload`、
  `imagePixelBudget`）、视觉 token 计价与 Files API 回退。

`@earendil-works/pi-ai` 的静态模型表（本包 opencode 路由用的就是这份库）给出的模态：

| 模型 | input |
| --- | --- |
| `deepseek-flash`（= V4.1 Flash） | text, image |
| `deepseek-v4.1-flash` | text, image |
| `deepseek-v4-flash-vision-exp` | text, image |
| `deepseek-v4-flash` / `deepseek-v4-pro` | text |

所以「官方都支持」这个前提本身要修正：**官方也只有 V4.1-Flash（及其 vision-exp 变体）支持
图片**，V4-Pro 是纯文本。

### 要做的话，需要三步（属设计文档的第 3 期）

1. **按证据补模态**：负载没声明时，按一张已知表兜底（`deepseek-v4.1-flash`、
   `deepseek-v4-flash-vision-exp`、`deepseek-flash` → image；`-vision` 命名也算证据）。
   ✅ 这一步本身很小，但只做它会让行为更假 —— 必须有第 2 步。
2. **真的送图**：注入 `ctx.get("attachments")`，把 `ImageBlock` 解析成请求版字节，按三种协议
   序列化（Chat Completions 的 `image_url`、Messages 的 `image` 源块、pi-ai 的 image part），
   并处理 offload 占位与字节预算。
3. **计价与限额**：视觉 token 计价（现在 `imageRequestPricing` 仍是基类的 `undefined`）、
   图片像素/字节上限。

工作量与风险都不小（要动三个协议的请求构造 + 附件服务注入 + 一整套预算逻辑），
建议单独立项，而不是塞进这一轮 UI 修整里。

---

## 思考档位对齐官方文档 + `tools[]` 计入条目上限（2026-11-06）

日期：2026-11-06。两个独立问题，都是用户现场报来的。

### 一、`off` 这个档位是我们自己编的

用户问：「deepseek 的模型应该只有 default/low/high/max 吧，好像没有 off」—— 他是对的。

逐家核对官方文档：

| 厂商 | 官方档位 | 关闭思考的方式 | 来源 |
| --- | --- | --- | --- |
| DeepSeek | `low` / `high` / `max` | OpenAI 格式 `thinking.type: "disabled"`；Anthropic 格式 `reasoning.effort: "none"` | api-docs.deepseek.com 思考模式 |
| GLM-5.3 | `low` / `high` / `max`（默认 `max`） | 不支持关闭（`thinking.type` 只收 `enabled`） | docs.bigmodel.cn |
| Kimi k3.1 | `low` / `high` / `max`（默认 `max`） | 不支持关闭 | platform.kimi.ai 推理强度 |
| Kimi k2.7-code | **不支持 `reasoning_effort`** | 思考强制开启 | platform.kimi.ai 思考模型 |
| OpenAI | `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`（按模型而异） | `none` | OpenAI SDK `ReasoningEffort` |
| Claude | `low` / `medium` / `high` / `max` | — | Anthropic effort 文档 |

**五家里没有一家把 `off` 写进文档。** 它出现在 `DEEPSEEK_TIERS` 和 commandcode 的
`KNOWN_EFFORTS` 里，属于本插件自造。

代价是实打实的：Open Design 适配器有一条「网关拒绝档位就按它念出的白名单降一档重发」的
兜底，所以用户每次选 `off` 都会**先吃一个 400、再降成 `none` 重发** —— 功能上能用，
白多一轮往返，日志里还多一条错。这个兜底本来是给「推断错了」用的，不该被一个自己编的值
常态化触发。

顺带修正的两处：

- `CLAUDE_TIERS` 原来用 `FIVE_TIERS`（含 `xhigh`）。`xhigh` 是 OpenAI 的值，Anthropic 没有。
- `kimi-k2.7-code` 官方根本不收 `reasoning_effort`，改为**显式空数组**（不摆选择器），
  而不是给一个发出去会被拒的列表。
- 未实测族（gemini/grok/qwen/mimo/hy）从 `low/medium/xhigh/max` 收到 `low/medium/high`：
  这三档是各家官方文档的公共交集，而 `xhigh`/`ultra` 谁都没写在官方文档里。

`STRENGTH_ORDER` 里**保留**了 `off` —— 它现在只服务于「解析旧设置里的历史值并按最弱档
降级」，不再参与声明。删掉它反而会让老用户的 `off` 被当成「未知 → 取最高可用档」，
那是一次静默升档。

### 二、`tools[]` 也占网关的 "input items"

第一次修复（2026-11-05）把 `messages[]` 裁到 `maxRequestItems`（默认 1000）以内，
解决了当时的 `1003 > 1000`。但同事那边又报出 **`1017 > 1000`**，而且装的是最新版。

关键算术：我们裁完 `messages[]` 正好 **1000** 条，网关却数出 **1017**。差 17 —— 正好是
那一轮的工具个数。也就是说网关的 "input items" = `messages[]` + `tools[]`，而我们只约束了前者，
**零余量**。这个错误还会自我循环：消息裁到 1000、工具数不变，于是每一轮都 1017、每一轮都 400。

修法：`messageLimit = maxRequestItems - tools.length`。工具多到占满上限时直接抛
`INVALID_REQUEST` 并说清原因，而不是发一个必然被拒的请求（与 F16 同一条纪律）。

> 这一条是**推断**，没能实测坐实：本机额度耗尽，网关先返回 402
> `insufficient_balance` 才轮到条数校验，探针打不进去。但变异测试给出的数字与现场完全一致 ——
> 把预算改回「不扣工具」，新测试立刻报 `expected 1017 to be less than or equal to 1000`。
> 即便网关其实不数工具，代价也只是少裁十几条历史，不会误伤。

### 三、裁剪把前缀缓存打碎了（同一天发现的副作用）

用户报：**Open Design 缓存命中率暴跌，opencode 不受影响**。

范围恰好对上 —— `trimWireMessages` 只接在 `opendesign/protocol.ts` 里，另两家没有这条路径。
机制有两重，都会破坏「从头开始连续相同的 token」这个缓存前提：

1. 窗口取的是「最近 N 组」，每多一轮对话就往后挪一格 → 第二条消息就和上一轮不同；
2. 提示文案里的 `${dropped}` 条数每轮都在变，而它被并进**第一条 system**。

实测连续两轮的公共前缀是 **0 条（0.0%）** —— 连 system 都命中不了。最阴险的是肉眼看不出来：
system 前 70 个字符完全一样，差异在末尾追加的那句「更早的 N 条已省略」。

修法：把「丢弃多少组」向上量化到 `DROP_BLOCK_GROUPS = 64` 的整数倍。一个块内窗口起点
**保持不动**，请求退化成「在末尾追加」，缓存整段命中；每积满一块才跳一次，跳的那轮全量失效，
其余轮次正常。修完实测公共前缀从 0% 回到 **100%**。

量化必须**向上**取整（丢得更多）才保证不超限；但取整越界时（短请求，组数不到一个块）
要退回原始起点 —— 否则只剩最后一组，会把工具调用所在的整组上下文全切掉。
这个边界是测试先抓出来的（`expected 0 to be greater than 0`）。

变异测试：把量化去掉，三条缓存用例立刻失败，其中一条正是 `expected 0 to be greater than 900`。

### 四、根治：容量取 `context_budget`，让压缩在条数上限之前触发

前三节都是**在出站口打补丁**。真正的根因在这一节。

网关的 `/v1/models` 对每个模型公布两个容量字段：

```
"metadata": { "context_limit": 1048000, "context_budget": 328000, "output_budget": 128000 }
```

`context_limit` 是模型的理论上限，`context_budget` 是**网关每次请求真正给的额度**。
旧实现取的是前者（`context_limit`），于是宿主的压缩阈值被算成：

```
floor(min(1048000 × 0.8, 1048000 − 128000 − 65536)) = 838400 token
```

而实测 **1000 条消息只有约 49 万 token** —— 阈值是它的 1.7 倍。换句话说：

> 压缩被配置成在 1711 条消息左右才触发，而网关在 1000 条就拒绝。
> **压缩永远排在条数上限之后，等于永不触发。**

所以条数超限不是「压缩策略不对」，而是**压缩的触发点根本够不着**。这也解释了为什么
2026-11-05 加的出站裁剪会让缓存塌掉：那是在用一个「每轮都改前缀」的手段，去掩盖一个
「压缩没被正确配置」的问题。

改成取 `context_budget` 之后（deepseek-v4.1-flash）：

```
floor(min(328000 × 0.8, 328000 − 128000 − 65536)) = 134464 token ≈ 274 条消息
```

274 条 ≪ 1000 条 —— 压缩从此会在条数上限之前触发，历史被摘要收拢，**条数上限再也摸不到**，
出站裁剪退化成纯兜底（正常使用不会触发），缓存自然也不再受影响。

逐模型核对（`W` 取 budget、`O` 取 output_budget、`B = 65536`）：

| 模型 | 旧阈值 → 约合条数 | 新阈值 → 约合条数 |
| --- | --- | --- |
| deepseek-v4.1-flash | 838400 → 1711 | 134464 → **274** |
| deepseek-v4-flash | 838400 → 1711 | 134464 → **274** |
| glm-5.3-flash | 838400 → 1711 | 134464 → **274** |
| gpt-6-luna | 840000 → 1714 | 206464 → **421** |
| claude-haiku-5.5 | 800000 → 1633 | 34464 → **70** |
| kimi-k2.7-code | 164464 → 336 | 164464 → 336（本来就合理） |

顺带纠正一个当天早上的错误推测：曾以为网关把 `tools[]` 也数进 items（依据是同事那条
`1017 > 1000`），于是让裁剪预算扣掉工具数。复核 2.0.0 交接文档的实测记录 ——
**`tools` 不计入、`system` 计入**（1000 条 → 200，1001 条 → 400）。所以 `1017` 的真实
含义是「对方那台根本没在裁剪」，装的是旧产物。扣工具数会白丢几十条历史（这次会话
tools=58），已经撤回。

> 完整的因果链：容量取错（`context_limit` 而非 `context_budget`）→ 压缩阈值 838k
> 偏高到够不着 → 历史涨到 1000 **条数**上限 → 网关 400 → 加出站裁剪兜底 → 裁剪每轮
> 移动窗口 → 前缀缓存全灭。修最上游那一环，后面三个症状一起消失。

### 五、补两个逃生阀：窗口可覆盖 + 输出上限夹取

用户在提「能不能直接把网关加进官方模型，让压缩走官方那套」时给出了
`Mars-Sea/dsh-commandcode-provider` 作为参照。看过它的实现后，有两点值得抄：

1. **上下文窗口可配置**：`effectiveContextWindow = 按模型覆盖 → 全局覆盖 → 目录值`，
   覆盖值不合法就静默回落到下一级；
2. **`maxTokens` 夹到窗口以内**（`min(目录输出上限, 窗口)`）。

第 2 点尤其要紧：宿主的压缩预算是 `W − O − B`（`B = 65536`）。若 `O ≥ W`，预算 ≤ 0，
`dsh-compaction-basic` 会在首次解析该模型时抛 `TargetPressureConfigError` —— 那条路由
**完全不压缩**。2.0.0 交接文档里记过一次（91.6 万 token 被拒），但当时的修法是「让目录
读得到 capacity」，没有把 `O` 和 `W` 的一致性管起来。现在补上。

第 1 点的价值不是「算得更准」，而是**算错了不用改代码**。我们已经把默认值修正为
`context_budget`，但网关口径随时可能再变；有了 `contextWindow` / `contextWindowOverrides`，
用户改设置即可，不必等我们发版。

顺带澄清一个误解（因为它是这次讨论的起点）：**压缩逻辑一直是官方的**。
`@deepseek-ai/dsh-compaction-basic` 是宿主内置插件，我们从头到尾没有实现过自己的压缩 ——
只负责「发现模型」和「告诉宿主这个模型有多大」。所以「接入官方模型就能用官方压缩」这个
路线并不成立：DSH 根本没有「自定义 OpenAI 兼容网关」的内置 provider（LLM 相关包只有
`dsh-llm-deepseek*`、`dsh-llm-pi-ai` 与核心 `dsh-llm`），第三方网关只能以 provider 插件
的形式接入 —— 那个参照仓库本身也是 provider 插件。

实现细节：

- `isValidContextWindow`：安全整数且在 `[1, 10_000_000]`；
- `readContextWindowOverrides`：丢弃空键与坏值，空表视为未设置；
- 两层校验（设置层 + 适配器层）：设置文档可能被手改，程序化装配也可能绕过 schema；
- `resolveModel` 用生效窗口上报 `context.contextWindow`，并把 `defaultMaxTokens` 夹到窗口内。

变异测试：把覆盖逻辑去掉、`min` 去掉，三条用例立刻失败。

测试：199 文件 / 2072 用例通过。

---

## 档位全量实测：纠正两处过度删减 + 回退方向改为升档（2026-11-06 下午）

额度恢复后用真实网关把每个模型的每个档位都打了一遍（`1018675245@qq.com` 账号有额度；
另两个账号 `coding_plan_exhausted`）。方法与结论如下。

### 实测表格（`reasoning_effort` → HTTP / 推理 token）

| 模型 | 结果 |
| --- | --- |
| deepseek-v4.1-flash | `low` 42 / `high` 78 / `max` 110（单调递增，档位确实生效）；`off` 与 `none` 均 200 且**不产生推理 token** |
| glm-5.3-flash | `low` / `high` / `max` / `medium` 全 200（只有 max 上报推理 token：210） |
| claude-haiku-5.5 | `low` / `medium` / `high` / `max` / `xhigh` 全 200；`ultra` → **400** |
| kimi-k2.7-code | `low` 84 / `high` 102 均 200；**`max` → 400** |
| gpt-6-luna | 声明的 7 档全 200；`ultra` 也 200（未声明） |
| 任意模型 + `bogus` / `xyz` | **400** `invalid_request_error` —— 网关**确实校验**档位 |

### 纠正一：`off` 是我判断错了

上午我断言「`off` 五家官方文档都没有 → 发出去必然 400」。实测 **`off` 返回 200 且不产生推理 token**，
和 `none` 完全等价。用 `bogus` 做的对照实验证明网关确实会拒绝未知值，所以 `off` 不是「被忽略」，
而是**这个网关真的认它**。

不过结论不变：`off` 不是官方取值，`none` 才是（DeepSeek 文档：`reasoning.effort: none` = 关闭思考）。
选择器里继续不摆 `off`；只是当时「会 400」的理由是错的，正确的是「不是官方命名」。

> 遗留问题：现在 DeepSeek 只声明 `low/high/max`，**用户无法关闭思考**。若要恢复这个能力，
> 应加 `none`（官方值）而不是 `off`。待用户决定。

### 纠正二：kimi-k2.7-code 不该声明为空

上午按 Kimi 官方文档（「k2.7-code 不收 `reasoning_effort`」）把它声明成空数组。
实测这个网关**认 `low` / `high`，只有 `max` 报 400**，且思考量随档位变化（84 → 102）。
等于把能用的功能藏掉了，已改回 `low / high`。

同理，Claude 的 `xhigh` 实测也能用，但它不是 Anthropic 官方值 —— 按「只显示官方档位」的口径
继续不声明（与 kimi 的区别：kimi 是官方说不支持而网关支持，claude 是官方只到 max 而网关更宽）。

### 改动三：回退方向从「降档」改为「升档」

用户明确要求：**不生效时自动升档，不要降低档位**。

原来的 `nearestAllowedEffort` 挑「不高于请求值的最强档位」—— 用户点 `xhigh`、网关只认到 `high`，
那次请求的思考量就比他要求的少，属于**静默削弱用户意图**。

改成 `upgradeAllowedEffort`：挑第一个严格更强的允许档位；**没有更强项时返回 `undefined`**，
由调用方去掉字段、交回厂商默认 —— 不退回一个更弱的显式档位。

方向性偏置的理由：档位调高只是多花 token，调低是答案质量下降，而用户选高档次本身就在表达
「愿意为质量付钱」。唯一例外是 `off`：它强于 `none`，所以「升档」会落到 `none`（关思考），
不会莫名其妙跳到 `high`。

### 改动四：Command Code 三个 DeepSeek 模型补上 `low`

`deepseek-v4-flash` / `-vision-exp` / `-v4-pro` 原来只有 `high,max`（照抄 CLI 词表），
但 DeepSeek 官方三档是 `low/high/max`，已补齐。若上游不认，会走上面的升档兜底。

### 验证

- 199 文件 / **2074 用例**通过；
- 变异测试：把升档逻辑改回降档，三条用例立刻失败（含「不静默降档」那条）；
- 线上目录复跑：12 个模型的档位/窗口/输出上限全部符合预期。
