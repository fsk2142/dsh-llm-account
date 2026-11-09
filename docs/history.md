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

### 四、根治：容量取 `context_limit`（当天下午推翻，见第六节）

> **这一节的结论已被同日晚间的第六节推翻，保留原文只为记录当时的推理链。**

前一节都是**在出站口打补丁**。当时以为真正的根因在这一节。

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

第 1 点的价值不是「算得更准」，而是**算错了不用改代码**。默认值在第六节定案为
`context_limit`，但网关口径随时可能再变；有了 `contextWindow` / `contextWindowOverrides`，
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

额度恢复后用真实网关把每个模型的每个档位都打了一遍（其中一个账号有额度；另两个
`coding_plan_exhausted`）。方法与结论如下。

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

> 现在 DeepSeek 只声明 `low/high/max`，选择器里**没有「关闭思考」这一项**。
> 若要恢复，官方值是 `none`（`off` 不是官方命名）。
>
> **已决（2026-11-06）：不加 `none`** —— 用户原话「基本没有不开思考的时候」。
> 所以 DeepSeek 就保持 `low / high / max` 三档，选择器里没有「关闭思考」这一项。
> 真要关思考时，DeepSeek 官方还留了另一条路：OpenAI 格式发 `thinking.type: "disabled"`，
> 那是**开关**而不是档位，不该混进档位选择器。

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

## 终裁：上下文窗口取 `context_limit` 100 万（2026-11-06 晚）

用户报「最新版本很快就压缩了」，并且直接指出：**「opendesign 的模型最大上下文不正确，
opencode 的是对的」**——他是对的。下午那版把 `context_budget`（328000）当成容量，
是错的。

### 一、二分实测：真实天花板 ≈ 105 万 token

不用信目录，直接用真实 `prompt_tokens` 打网关（构造足够长的 filler 消息，逐档加）：

| prompt_tokens | HTTP |
| --- | --- |
| 978,039 | 200 |
| 1,017,039 | 200 |
| 1,036,239 | 200 |
| 1,045,839 | 200 |
| **1,048,239** | **200** |
| 1,048,576 | 400 `[code=upstream_error]` |
| 1,048,700 / 1,049,000 / 1,049,500 / 1,050,000 | 400 |

首个失败点 ≈ **1,050,419**。天花板落在 1,048,239 与 1,048,576 之间，正好对上
`metadata.context_limit = 1,048,000`（≈1 MiB），与 328,000 毫无关系。opencode 那边
公布的 `limit.context = 1000000` 是同一件事的另一种写法。

### 二、328000 造成的后果，正是「很快就压缩」

宿主的阈值是 `floor(min(W×0.8, W−O−B))`（`O` = 预留输出 128000，`B` = headroom 65536）：

```
W = 1,048,000 → floor(min(838400, 854464)) = 838,400 token
W =   328,000 → floor(min(262400, 134464)) = 134,464 token   ← 约 270 条消息
```

阈值掉到六分之一，所以会话刚开一会儿就开始压缩。

线上日志也印证：某一个会话的 `request/context` 时间线里，2026-11-05T01:04 到
2026-11-06T01:02 的每一次 opendesign 请求都是 `contextWindow: 1048000`，只有 2026-11-06T06:30
那一版是 `328000` —— 328K 是那十个小时里才出现的回归。

### 三、为什么不靠「调低阈值」去绕条数上限

下午的思路是「让 token 阈值落在 1000 条之前，压缩就不会摸到条数上限」。这个推理本身
成立，但代价是把用户的上下文从 100 万砍到 13 万。

而且它解决的问题并没有那么严重：**条数超限是可自愈的**。官方的
`isContextWindowExceededError` 认网关那条「1001 > 1000」的 400，`agent/request-error`
接缝会先剪枝、再压缩、然后返回 `{kind:"retry"}` 重发；而压缩时重放的
`buildSummarizationInput` 读的是**会话日志**，不是那份超限的投影 —— 所以「压缩请求自身
也超限、形成死循环」这个结论是错的（`wire-limit.ts` 与 `protocol.ts` 里那段注释已改）。

真正的取舍是：**条数上限交给官方自愈，容量报真实值**。

### 四、改动

- `catalog.ts`：优先级改为 `扁平字段 > metadata.context_limit > metadata.context_budget >
  metadata.contextWindow`（`context_limit` 在前）。两者都在时取 `context_limit`，
  只有别家网关不公布天花板时才轮到预算；
- 测试同步：`opendesign-catalog.test.ts`、`opendesign-adapter.test.ts` 的夹具与断言
  改为 1,048,000（`context_budget` 仍留在夹具里，用来证明**不被采纳**）；
- 注释纠正：`adapter.ts` 的 `maxRequestItems` / `contextWindow`、`index.ts` 的同名设置项、
  `protocol.ts` 的出站投影、`wire-limit.ts` 的模块注释 —— 删掉「死循环」「解药是
  context_budget」这类已被推翻的说法。

### 五、验证

- `tests/vendors/opendesign-*.test.ts` 55 用例通过；全量 **199 文件 / 2074 用例**通过；
- 真机：按 1,048,000 上报后，`request/context` 记录恢复为 1048000，压缩不再在 ~270 条
  消息处触发。

### 待办：条数上限的上层触发（下一步）

官方**没有**条数概念（`LlmModelContext` 只有 `contextWindow`），所以 1000 条的边界只能
这里先认下：现在靠官方「报错→剪枝→压缩→重发」自愈，代价是白跑一次请求。

要在**条数达到上限之前**主动压缩，需要一个插件侧的接缝：在 `agent/pre-step`
（水瀑，`{ agent, messages, signal, step, modelSelection }`，且此时回合是打开的，
`compactRegion` 要求的条件成立）里估算投影后的条数，接近 1000 时调用
`ctx.compaction.compactPressure(agent, header, signal, true)`。条数必须在**投影之后**算
（工具图片会补一条 `user`）。实测 `step` 增长极慢：30369 个 step 里 p99 = 4 条、
p99.9 = 11 条、最大 20 条 —— 所以「999 条触发」留一次 step 的余量就够。

## 2.1.4：容量取最大值（防回归）+ 账号试完抛可重试的那一条（2026-11-06 晚）

### 一、`capacityOf`：不再让「一行顺序调整」改变行为

2.1.1 的事故本质上是**一行 `??` 链的顺序**：把 `context_budget` 挪到 `context_limit`
前面，上报窗口就从 1,048,000 变成 328,000，压缩阈值从 838400 掉到 134464，
而**没有任何报错**能提示这件事发生过。

改成 `capacityOf(meta)`：在 `context_limit` / `context_budget` / `contextWindow` 里
**取最大值**。按定义 `budget = limit − 输出预留`，正常数据里 limit 必然更大；真出现
`budget > limit` 的坏数据，取大值也仍是安全的一侧（报大了只是压缩更晚触发，而上下文
超限**可自愈**；报小了是每一次会话都被提前压缩，用户完全无从察觉）。

变异测试：把 `capacityOf` 换回按名字排序的 `??` 链，新加的 2 条用例立刻红。

### 二、账号试完时抛哪一条：可重试优先

真实事故（同一个用户报告的两个问题之一）：一个请求内连试 3 个账号 —— 第 1 个是瞬时
5xx，后 2 个是 402 `insufficient_balance`。用尽时抛的是**最后一条**（配额），于是：

| 后果 | 原因 |
| --- | --- |
| 用户看到「本轮运行失败，当前请求的额度已用尽」 | 抛的是第 3 个账号的 402 文案 |
| 自动继续没有救回这一轮 | `QUOTA` 在 `NEVER_RETRY_CODES` 里 |
| 手动发「继续」立刻成功 | 新回合重置 `tried`，第 1 个账号本来就没问题 |

也就是说：**抛哪一条，决定了宿主会不会救这一轮**。链条里明明有可自愈的瞬时失败，
却抛出不可重试的终态，等于替用户判了死刑。

修法：`core/failures.ts` 新增 `pickExhaustedFailure()` —— 用尽时优先抛**最后一条可重试
的**失败（`server` / `network` / `rate-limit` / `unavailable`），全是终态时才抛最后一条。
三家适配器（opendesign / commandcode / opencode）统一改成走它；**拒绝表、轮换顺序、
重试次数一概不动**，只改「抛哪一个」。

变异测试：把 `picked = pickExhaustedFailure(failures)` 改回 `picked = lastFailure`，
新加的适配器用例立刻红（断言 `code === "SERVER"` 且文案不含「额度已用尽」）。

### 三、验证

- **200 文件 / 2084 用例**通过（新增 `tests/core/failures.test.ts` 8 条 + 适配器 1 条）；
- 类型检查干净，`build` 通过；
- 线上目录复跑：12 个模型 `W` 全部按最大容量上报。

## 2.1.5：出站裁剪不许被「0」悄悄关掉（2026-11-06 晚，turn 357 事故）

用户在新会话里再次撞上条数上限，而且这次**没能自愈**：

```
turn 357  compaction/end  error: ... (1001 > 1000 items)      ← 压缩请求自己先被拒
turn 357  turn/end        error: ... (1002 > 1000 items)      ← 主请求也被拒
```

旧结论说「条数超限可自愈」，前提是**压缩请求能发出去**；压缩请求自己超限时，
那条自愈路径直接断掉，整轮失败。

### 根因：`0` 在两层都被解释成「关闭裁剪」

`resolveConfig` 里写着「`0` 或负数 = 不裁剪，用户自愿承担 400 的风险」，
`adapterConfigOf` 又用 `nonNegativeNumber` 把设置文档里的 `0` 原样传下去。于是只要
设置文档把这一项落成 `0`（schema 写的是 `z.number()`，**没有默认值**，很容易发生），
出站裁剪就静默失效 —— 而网管的 1000 条硬上限不会因此消失。

为什么认定是「裁剪没跑」而不是「裁剪算错」：裁剪会把丢弃量按 64 组向上对齐，跑起来
会砍到 **938 条**左右；而网关报的是 **1001/1002 条**，正好是原始历史长度，说明一个
字都没裁。

顺带把计数规则复测清楚（直接打网关，2026-11-06）：

| 形状 | 结果 |
| --- | --- |
| 1000 条消息 | 200 |
| 1001 条消息 | 400 `(1001 > 1000)` |
| 998 条 + 2 个 `tool_calls` | 200 |
| 950 条 + 58 个工具 | 200 |
| 1000 条、其中 1 条 content 是 2~3 段数组 | 200 |

也就是**只数 `messages[]` 的条数**：`tools[]` 不额外计数，content 分片不拆分计数。

### 改动

- `adapter.ts` 的 `resolveConfig`：非正数/非有限值一律回落到 `DEFAULT_MAX_REQUEST_ITEMS`，
  **不再有「0 = 关闭」这条语义**；
- `adapter.ts` 的 `#post`：**无条件**把上限传进 `BodyFacts`，不再有「> 0 才传」的分支；
- `index.ts` 的 `adapterConfigOf`：`nonNegativeNumber` 换成 `positiveNumber`，
  删掉那个已无人使用的辅助函数；
- `index.ts` 的 schema：`maxRequestItems: z.number().default(DEFAULT_MAX_REQUEST_ITEMS)`，
  设置文档里不会再出现那个要命的 `0`。

### 验证

- 端到端用例改成「配置写 `0` / `-1` / `NaN` 时**仍然裁剪**」，并走过真实的适配器
  出口（`outboundBody`），断言出站条数 ≤ 1000 且带省略提示；
- 全量 **200 文件 / 2084 用例**通过；类型检查干净。

## 2.1.8：DSML 工具调用被当成文本吞掉（2026-11-07 真机）

用户报「用 opencode 时输出一点就被截断、任务中断」，而且连续发生好几次。

### 现场

`dsh-opencode-go` 上的 `deepseek-v4.1-flash` 偶尔不返回结构化 `tool_calls`，而是把工具调用
按 DeepSeek 的 DSML 语法**写进推理通道**，`finish` 还是 `stop`：

```text
<｜DSML｜ calls>
<｜DSML｜ invoke name="terminal_send">
<｜DSML｜ parameter name="sessionId" string="true">pty-9</｜DSML｜ parameter>
<｜DSML｜ parameter name="text" string="true">Get-Content _r7_top.log | Select-String Warning</｜DSML｜ parameter>
</｜DSML｜ invoke>
</｜DSML｜ calls>
```

网关没有把它解析成 `tool_calls`，插件照原样透传。后果很隐蔽：

- 正文**一个字都没有**，整段都在 reasoning 里；
- `finish` 是 `stop`，宿主看到「没有工具调用 + 模型自己停了」→ 这一轮**空着结束**；
- 用户看到的就是「输出一点就被截断、任务莫名中断」。

实测 2026-11-07 11:08–11:37 连着 4 次（session-c0aacab8 的 seq 88150 / 88192 / 88234 / 88268），
每次都是「正文为空 + stop + reasoning 里带 DSML」。

### 修法

`src/vendors/opencode/dsml.ts`：把 DSML 文本解析成工具调用（真机样本当用例）。

`adapter.ts` 的流循环里加一道**抢救**：一边流一边累计正文与 reasoning 的文本，到 `finish`
时如果**一个工具调用都没出现过**、而文本里有 DSML 块，就把它们补发成真正的工具调用块，
并把 finish 改成 `tool-calls`。只在「本来就没有工具调用」时才做 —— 网关已经给了结构化
`tool_calls` 时不重复执行。

### 验证

- 新增 `tests/vendors/opencode-dsml.test.ts` 7 条（真机样本、多调用、半角变体、数值参数、
  无标记不误判、重复调用幂等）；
- `opencode.test.ts` 加 2 条端到端：DSML 流必须补发出 `terminal_send` 且 finish 变
  `tool-calls`；普通文本回复不受影响；
- 变异测试：把抢救条件改成 `false`，端到端用例立刻红；
- 全量 **201 文件 / 2095 用例**通过。

## 2.1.9：把「尝试策略」从三家重复代码里抽出来（2026-11-07 重构）

用户问：「官方 API 怎么从来没这些问题，咱们插件怎么补丁越来越多？」

补丁多的机械原因之一：**同一段逻辑抄了三份**。每个适配器都有一份几乎相同的回合策略——
`tried` 集合、失败链、`maxTried` 判断、「用尽时抛哪一条」。「额度已用尽」误报（2.1.4）
当初就是三家一起错；条数上限（2.1.5–2.1.7）又只修了 opendesign，另两家还留着同样的坑。

### 改动

新增 `src/core/attempt-ledger.ts`（`AttemptLedger`）：纯策略，不碰网络、不认识任何厂商
字样，只回答「还能再试吗」「试完了该抛谁」。三家适配器改为共用它，各自只保留真正的
差异（凭据解析、协议投影、失败分类表）。

行为**完全不变**（2000+ 条既有用例是护栏）；变的是「以后一处修复只落一次」。

### 防回退

新增 `tests/vendors/attempt-loop-contract.test.ts`（源码契约，10 条）：直接读三家适配器
源码，断言它们不再自己选「抛哪一条」、不再自己维护 `tried` 与上限比较、不再各自声明
`AttemptFailure`。行为用例保不住这个性质 —— 谁把策略抄回去，行为仍然对、测试全绿，
直到某天漏改一家才会炸。

### 验证

- 全量 **203 文件 / 2112 用例**通过（新增 7 条记账层用例 + 10 条契约用例）；
- 类型检查干净；三家各自的用例（opendesign 74 / commandcode 86 / opencode 19）逐一复跑通过。

## 2.1.10：整个回合循环收进共享层（2026-11-07 重构第二步）

2.1.9 只抽了「记账层」（`tried`、失败链、上限、抛哪一条）。这一步把**整个控制流**也收进去：

新增 `src/core/attempt-loop.ts`（`runAttemptLoop`）持有全部回合控制流 —— 选账号、换号闸门
（`fallbackAllowed`）、试用上限、换模型（只换一次）、跨厂商委托、chunk 透传、用量累加、
成功/取消/失败三条出口。三家适配器的 `stream()` 从 90 行循环缩成「一组钩子 + 一次调用」。

净效果：三家共删掉 406 行重复代码（652 删 / 246 增）。各家只剩真正的差异：凭据怎么取、
请求怎么发、失败怎么分类、chunk 要不要改写。

### 三个行为开关（默认值与抽取前完全一致）

| 开关 | 作用 | 谁用 |
| --- | --- | --- |
| `deferUsage` | usage 块延后到下一个内容块再发 | opencode |
| `usageCountsAsEmitted` | usage 块算不算「已输出」 | opencode（不算） |
| `onChunk` | chunk 改写/补发（DSML 抢救）与 pi-ai 终态转换 | opencode |

另外 `wrapRequestLevelError` 保留 opencode 的「请求级拒绝要换成 `PI_AI_ERROR`」行为。

### 验证

- 全部 **204 文件 / 2130 用例**通过（含新增 `tests/core/attempt-loop.test.ts` 15 条，覆盖
  成功 / 换号 / 已输出不换号 / 用尽抛可重试那条 / 上限现读 / 缺凭据 / 取消 / 换模型 /
  usage 累加与延后 / chunk 改写）；
- 变异测试：把「已输出就不换号」那道闸门改成恒真，对应用例立刻红；
- 契约用例同步升级为「三家必须走 `runAttemptLoop`、不许自己调 `rotation.pick` /
  `fallbackAllowed`」。

## 2.1.12：Eco 模型 + 官方调价同步（2026-11-07）

用户报「opendesign 多了 eco 模型，额度每月 220 美元，但账号里显示未知」。

### 现场核对（都是打真网关 / 抓官网量出来的）

- 网关 `/v1/models` 现在有 **14 个模型**，新增 `deepseek-v4.1-flash-eco`；
- 官方 `pricing` 页的 Design Plan usage 表新增一行：
  `DeepSeek V4.1 Flash Eco` → **Go $220 / Go Plus $290**（只公布两列）；
- 官方 `model-credits` 页的套餐构成表**整体调价**：
  Go 月度 $120→**$220**、周 $30→**$55**、5 小时 $10→**$18**；
  Plus 月度 $180→**$310**、周 $40→**$74**。Pro / Max 未变。

### 修掉的问题

1. **eco 不在额度表** → 补 `DeepSeek V4.1 Flash Eco`（两列，Pro/Max 不猜）。
2. **两个模型一直显示「未知」**：官方写 `GLM-5.3 Flash-X` / `Hunyuan H4 Preview`，
   网关 id 是 `glm-5.3-flashx` / `hy4-preview`。归一化只做大小写与分隔符，
   `flash x` vs `flashx`、`hunyuan h4` vs `hy4` 对不上 → 加**显式别名表**
   （不用模糊匹配：那会把 `glm-5.3-flash` 与 `glm-5.3-flashx` 合并，显示成对方的额度）。
3. **`MiniMax M3.1 Flash` 漏行**（官方一直在列） → 补 `$60/$80/$180`。
4. **`planKeyOf("Max")` 认不出** → Open Design 的 Max 档用户，**每个模型**都显示「未知」。
   补 `max` / `Go Max` 两个写法（Command Code 的 `max10x`/`max20x` 不受影响）。
5. **`WINDOW_CAP_USD` 全部过期** → 更新为调价后的官方值。
   影响具体：Go 用户周额度会显示成「$30 / $55」，即永远只有真实值一半多一点；
   而换算率正是从这张表反推的，「已用多少」也跟着整体偏小。
6. **条数上限表过期**：2026-11-07 深夜逐模型复测，`deepseek-v4.1-flash` 已不再是 1000
   （1000 / 5000 / 20000 / 30000 / 200000 条全部 200，且 `prompt_tokens` 随条数线性增长、
   藏针复测确认首条消息能送达）。现在**只剩 `glm-5.3-flash` 还是 1000**。

### 验证

- 全量 **204 文件 / 2138 用例**通过；
- 新增用例用**网关真实 id** 逐条断言「Go 档都查得到额度」，并把别名不许串味、
  Eco 的 Pro/Max 不猜、Max 档认得出来都固定住；
- 一处**本机验证不了的假设**写进了测试文件头：官方调价后 `limitCredits` 是否同比例放大。
  本机 `vela billing preflight` 回 403，没有真实样本，所以只固定机制、写下假设。

## 2.1.13：五轮自检修掉的 5 个问题（2026-11-08）

用户要求「先自检至少 5 次，确认没有 BUG 再提交推送」。2.1.12 已发布，这一版是自检产物。

### 第 1 轮（数据源复核）——3 个问题

1. **Open Design 的 `Go Max` 列一直有数字，上一版却没抓**。
   官方 `Design Plan usage` 表是**四列**（Go / Go Plus / Go Pro / Go Max），2.1.12 只写了三列，
   注释还写着「Max 列官方页面是空的」——那句当时就是错的。后果：Max 档用户的**每一个模型**
   都显示「未知」。
2. **`Go Plus` / `Go Pro` 查不到任何模型**。`planKeyOf("Go Plus")` 给 `goplus`，而 Open Design
   表里的桶叫 `plus`；`Go Pro` 更是直接归成 `undefined`。同样是「整列数据消失」级别的问题。
3. **官方已把 `Hunyuan H4 Preview` 改写成 `Hy4 Preview`**，表名与注释都过期了。

### 第 2 轮（逐行审查 diff）——2 个问题

4. `aliased()` 会**静默覆写**已存在的键。若哪天官方同时列出 `GLM-5.3 FlashX` 与
   `GLM-5.3 Flash-X` 两个不同价位的模型，别名就会把官方数据盖掉。改成「官方数据优先」。
5. `PLAN_KEY_FALLBACK` 里的 `gomax` 是**永远走不到的死映射**（`planKeyOf` 已把 `Go Max` 归成 `max`）。

### 第 3 轮（消费端路径）

照 `client/seams.ts` 的取数链（`quotaTableOf` → `planKeyOf` → `modelQuotaOf`）走了一遍，
确认「未知」只由 `models.quotaUnknown` 产生。补了 **28 种档位写法**的回归矩阵
（`Go Plus` / `go_plus` / `GOPLUS` / `Go Max` / `gomax` …），并把「认不出的档位仍给 undefined
（不猜成 Go）」也钉住。

### 第 4 轮（边界 + 跨厂商）

6. **三处注释还在说「`deepseek-v4.1-flash` 硬上限 1000 条」**，而实测早已放宽、1000 现在属于
   `glm-5.3-flash`。这类注释是「为什么是 1000」的唯一记录，写错会让下一个人把值改大而踩坑。
   `adapter.ts` ×3、`index.ts` ×1、`protocol.ts` ×3 全部更正。
   `DEFAULT_MAX_REQUEST_ITEMS = 1000` 的理由改成「取最严模型的上限」，并写明真正的钳制在
   `min(配置, 该模型实测上限)`。
7. 顺带确认 `minimax-m3.1-flash` 缺 `output_budget` 是安全的（有 `context_limit`，输出走默认）；
   opendesign 全部模型都不声明 `efforts`（按设计只信 payload），eco 不需要额外登记。

### 第 5 轮（真数据端到端）——发现一条重要事实，推翻上一版的假设

**拿到了真机 preflight**：用账号自己的控制器密钥直连
`{walletBase}/workspaces/{id}/billing/preflight`（`vela` CLI 那条路要本机登录态，所以一直 403）。
三个账号实测：

```
tier = "go"
5 小时：usedCredits=4568  limitCredits=50000
每周  ：usedCredits=10175 limitCredits=150000
```

8. **`limitCredits` 根本没变** —— 2.1.12 的测试夹具假设它「随调价同比例放大」（写成 90000/275000），
   是错的。现在全部换回真实值 50000/150000，断言值改成真机算出来的
   **$1.64 / $18** 与 **$3.73 / $55**，并额外加了一条「占比必须等于真实 credits 占比」的用例。
9. 换算率随之从 **5000** 变成约 **2727/2777**（同一批 credits 现在值更多美元）。文档里所有
   「换算率 5000」「周 $30」「每月 $120」的当前口径说法全部更正（历史记录保留）。

### 验证

- 全量 **204 文件 / 2168 用例**通过；`tsc --noEmit` 干净；产物重编并核对含新数据；
- 端到端用真实 preflight + 真实网关模型清单跑账号卡片取数链：套餐 `go`、
  窗口 `$1.64/$18` 与 `$3.73/$55`、**14 个模型全部有额度、0 个「未知」**（含 eco $220）。

## 2.1.14：终检（BUG / 隐私 / 临时文件 / 注释）（2026-11-08）

用户要求最后一次自检，重点四件事：软件 BUG、隐私泄露、无用文件与临时文件、含义不明的注释。

### 一、软件 BUG：修掉 1 个真 bug（+1 处一致性问题）

**窗口上限的档位识别只认小写裸名**（`src/vendors/opendesign/quota.ts`）。
`WINDOW_CAP_USD` 的键是 `go` / `plus` / `pro` / `max`，而查询写的是裸
`tier.trim().toLowerCase()`。于是 `tier` 一旦是官方列头那种写法（`Go Plus` / `Go Max`）
或下划线形式（`go_plus`），**整张表都查不到** → 窗口的美元上限凭空消失、回落成
「credits ÷ 接口换算率」的推算值。

最坏的地方是它**看起来没坏**：界面上仍有美元数字，只是数字是错的；而且同一时刻
逐模型额度那条路径（一直用 `planKeyOf`）显示正常 —— 同一个档位「模型有额度、
窗口算错」，很难联想到是档位名解析不一致。

修法：把「档位名 → 该去表里找的键序列」抽成 `planKeyCandidates` 一处导出，
额度表、可用性表、窗口上限表三处共用，不会再分叉。
顺带把 `modelAvailableIn` 也改成同一套候选键（原来它单独 `table[plan]`）。

真实数据不受影响（三账号 `tier` 实测都是 `go`）：修复后逐项复核仍是
`$0.44/$18`、`$4.18/$55`，占比与厂商自己的 credits 占比一致。

**新增 13 条回归用例**（12 种档位写法 × 窗口上限 + 1 条「认不出不猜」）。

### 二、隐私泄露：无

- 仓库内**没有**真实账号标识（`FSK2142_`、`QQ_COM`、`_CONTROL` 实键名均为 0 处）、
  没有 workspace id、没有 `C:\Users\<真实用户名>`；
- 三处 `sk-` 命中全是**测试用的假值**（`sk-FAKEFAKEFAKE0000` 等），用途正是验证脱敏；
- 最近 3 个提交各 1 处「敏感串」是 git 作者行 `fsk2142 <…@users.noreply.github.com>`
  —— 公开的 GitHub 用户名（仓库地址本身就带），非新增泄露；
- 本轮所有探针脚本都是**运行时**从 `~/.dsh/.credentials.yaml` 读密钥，密钥从未落进文件。

### 三、无用文件 / 临时文件

- 清掉 `.tmp/`：`attempt-loop` 的**旧版本备份**（正本 17488 字节已在 src）、
  3 个 11-07 的代码片段快照（`new-stream-*.txt`）；
- 清掉本轮 4 个一次性探针脚本（`_c*.mts`）；
- 剩 `.tmp/asar-u14`、`.tmp/profile-lib-backup` 两个**空目录**：当前审批策略
  （`never` + 目录大小不可界定）拒绝删除，0 字节且被 `.gitignore` 忽略，无实际影响；
- 工作区干净，无未跟踪文件。

### 四、含义不明的注释

- `accounts-panel.ts` ×2：`（本轮实测踩过一次）` / `（本轮实测踩到）` ——
  「本轮」指向不明，后来人无法得知是哪一轮。改成直接说机制与后果；
- `tests/core/attempt-loop.test.ts`：`（自检发现的文案回归）` → `（文案回归）`；
- `tests/core/model-quota-table.test.ts`：`（2026-11-08 第 3 轮自检）` → 改为陈述不变量；
- `model-quota-table.ts`：`上一版只有三列，注释写着…` 这类**改动日记**改成
  陈述当前事实与后果（「四列必须齐全，少一列该档每个模型都显示未知」）；
- `opendesign-window-usd.test.ts` 文件头：把「上一版写着无法验证」改成
  「关键事实 + 为什么这是最容易改错的地方」，避免变成日记。

### 验证

- `tsc --noEmit` 干净；**204 文件 / 2181 用例**全绿；产物重编、末尾换行 339 文件正常；
- 端到端用真实 preflight 复核：`tier=go`、`$0.44/$18`、`$4.18/$55`、eco `$220`；
- 一处**刻意接受的代价**已写进注释：`quota.ts` 现在 import `core/model-quota-table`，
  打包时把静态额度表一并内联进 opendesign 产物（+17KB，180→198KB）。
  换来的是三处档位解析共用一份 —— 另写一份省 17KB，但回退链迟早分叉。

## 2.1.15：opencode 不显示上下文 + 自动切换白名单（2026-11-08）

用户报两件事：
1. 「新版本有问题，opencode 不显示模型上下文」；
2. 「自动切换不要切换到 deepseek 的 API 上边去，只准在 opendesign / commandcode / opencode
   三个网关之间切换」。

### 一、opencode 上下文消失：不是最近几次改动引入的，是**从第一版起就存在**

先排除嫌疑：`git diff --stat v2.1.11..HEAD -- src/vendors/opencode/` 是**空**，
`lib/opencode-*.js` 的 blob 哈希在 2.1.11 与 HEAD 完全相同。最近三次改动只碰了
`model-quota-table` 与 opendesign。

真正的原因在 `parseModels`（`src/vendors/opencode/catalog.ts`）：它只认
`context_length` / `contextWindow` 两个字段名（别家网关的写法），而这条网关的行里用的是
`limit: { context, output }`：

```json
{"id":"deepseek-v4.1-flash","limit":{"context":1000000,"output":384000}, ...}
```

于是网关亲口给的 100 万上下文被整行丢掉，`contextWindow` 只剩 models.dev 这一路来源。
而 models.dev 是**第三方站点**、预算只有 4 秒（模块注释里就记着实测 2.8s / 18.5s 失败 /
197s），它一超时，上下文就不显示 —— 用户看到的现象正是这个。

这与 2026-11-03 那次「档位只从 models.dev 来」是同一种错误：把建议性的第三方数据当成
唯一来源，而无视必需请求里已经写着的事实。顺带修了同一处的模态判定：网关用 MIME 写法
（`image/jpeg`），原来只认全等 `image`，于是**网关明确声明支持图片**的模型被记成只支持
文本。

复测（真实网关 + 真实 models.dev）：修复前 `resolveModel` 返回 `context=undefined`，
修复后 `deepseek-v4.1-flash` 是 `context=1000000 / maxTokens=384000 /
modalities=["text","image"]`。

### 二、自动切换白名单

原来是**黑名单**（`isOfficialProvider`：`deepseek` / `deepseek-account` 前缀）。
它挡住了官方直连，但挡不住**任何没被点名**的 provider —— 这台机器同时装着 `pi-ai`、
`anthropic` 等别的 LLM 插件。实测：`pi-ai` / `anthropic` / 任意第三方都会被切过去。

改成**白名单** `isSwitchableProvider`（`commandcode` / `opendesign` / `dsh-opencode-go`
及其历史别名 `opencode` / `opencode-go`），并在**四个入口**都拦：

| 入口 | 挡的是什么 |
| --- | --- |
| `pickFallbackModel` | 挑候选时（主闸门） |
| `delegateStream` | 执行委托时（表里万一已有脏数据） |
| `registerCatalogSource` | 登记时（别的插件把 stream 塞进我们的表） |
| `noteCatalogModels` | 写缓存时（60 秒 TTL 内的脏数据） |

只拦一处不够：这条链路上有缓存、有跨插件登记、有「先缓存后禁用」的时序。
另外 `excludeOfficial: false` 也**不能**放第三方进来 —— 那个参数历史上只是
「要不要额外跑一遍官方黑名单」，不该成为越狱后门。

### 验证

- `tsc --noEmit` 干净；**205 文件 / 2193 用例**全绿（新增 12 条）；
- 端到端用真实网关验证 opencode 三个模型的 context/maxTokens/modalities 都有值；
- 换模型白名单实测：三家放行，`deepseek` / `pi-ai` / `anthropic` / 任意第三方全部挡住。

## 2.1.16：目录请求带上凭据（2026-11-08）

用户确认「我觉得可以带上」。这一条不是新需求，而是**修正一个长期说破未做的错位**：

| 请求方式 | 返回的模型 | 实际能用 |
| --- | --- | --- |
| 不带 Bearer（旧行为） | **30 个**（含未订阅的） | 6 个 |
| 带 Bearer | **6 个** | 6 个 |

于是设置页的勾选列表里长期躺着一批「选中也发不出去」的模型（`claude-haiku-5-5` /
`gpt-6-luna` / `kimi-k3` …），用户以为能切过去。第一版实现沿用了旧插件的写法
（不带 Authorization），理由写的是「目录是公开信息」—— 那句本身没错，但**只对了一半**：
公开 ≠ 是这个账号能用的。

### 为什么不是「顺手调 resolveAccountAuth」

第一版就是这么写的，跑测试立刻炸了两处：

1. `resolveAccountAuth` 会走 OAuth 刷新并**回写凭据槽** —— 于是「读一次模型目录」
   产生了一次凭据写入。用户看到的是「凭据被改了」，而实际只是翻了下列表。
   **这条链路上任何副作用都不可接受**。
2. 它会额外触发一次 OAuth 刷新请求，让本来就慢的目录路径更慢。

现在只读当前已存值：`resolveStored` → `pickApiKey` → OAuth blob 解出 `access`。
不刷新、不回写。取不到密钥就退回无鉴权（公开清单），**绝不**让整个厂商的模型列表消失。

### 缓存键必须带上账号

`#catalogs` 原来只按 `baseUrl` 做键。目录请求带上 Bearer 之后，不同账号可能订阅不同模型，
只按 `baseUrl` 会把 A 账号读到的清单当成 B 账号的。现在键是 `baseUrl\0账号ref`。

用**账号 ref** 而不是密钥字面量：`#catalogs` 的键会在内存里留更久，没必要把密钥
拼进 Map 的键字符串。同一账号换 key 不需要重建目录（同一个订阅）。

### 验证

- `tsc --noEmit` 干净；**206 文件 / 2198 用例**全绿（新增 5 条目录凭据用例）；
- 端到端实测：带凭据 6 个、无凭据 30 个；带凭据那 6 个的 `context` / `maxTokens` 全有值；
- 保留「无凭据时仍然能列出公开清单」这条兜底 —— 目录读不到比多列几个模型更糟。

## 2.1.17：「使用」按钮 + eco 视觉能力（2026-11-09）

用户报两件事：

1. 「额度用尽切换后，正在生效的账号就没有显示使用的那个按钮，无法手动选过去了」
2. 「opendesign 最新的 eco 模型不能发送图片，确认一下网关不支持还是插件问题」

### 一、「使用」按钮：两个语义被混成了一个

| 字段 | 含义 | 由谁决定 |
| --- | --- | --- |
| `effective` | 这个账号刚才**真的在服务请求** | 宿主记录的真实服务者 |
| `active` / `pinned` | **用户选的是它** | 用户的固定选择 |

自动切换之后这两者必然分叉：

```
A 额度耗尽 → 系统自动切到 B → B 变成 effective，但 pinned 仍是 null
→ 旧条件 `effective || (active && 没给 effective)` 让 B 不显示「使用」按钮
→ 用户想把 B 固定下来，无从下手
```

修法：按钮只在 `selected`（与徽标同一个判据）时隐藏。新增 4 条回归用例。

### 二、eco 不能发图片：**网关的声明过时了，插件跟错了**

不是插件读错字段 —— 网关目录里 `deepseek-v4.1-flash-eco` 确实写着
`architecture.input_modalities: ["text"]`。**是这条声明本身过时。**

真机实测（同一把 key、同一个端点）：

| 模型 | 目录声明 | 实际能读图 | 判据 |
| --- | --- | --- | --- |
| `deepseek-v4.1-flash-eco` | `["text"]` | **能** | 图里 `4827`/`1593`/`7391`，三次全对；`prompt_tokens` 39 → 241 |
| `deepseek-v4-flash` | `["text"]` | **能** | 同上三张全对；`prompt_tokens` 39 → 241 |
| `deepseek-v4-pro` | `["text"]` | 不能 | 三张全读不出；`prompt_tokens` 92 → 97（图片没被接收） |

`prompt_tokens` 那一列是关键判据：上游真的编码了图片时多出来的 token 量与图片体积
同量级（+202）；没接收时几乎不变（+5）。只看回答像不像在描述图片会被骗 —— 模型可以猜。
所以每一张图都用「读出一串随机数字」验证，纯色/形状描述只用于辅助观察。

修法：新增 `opendesign/vision.ts` 的**实测覆盖表**，与 `efforts.ts` 同一套道理
（那个文件早就为「目录不公布档位」建了实测表）。只收录三次全对的；表外的模型
一律以目录声明为准 —— `deepseek-v4-pro` 就留在表外，因为它实测确实读不出。

### 验证

`tsc` 干净；**206 文件 / 2204 用例**全绿（新增 7 条）；真实目录解析后 eco 与
v4-flash 都是 `text+image`，v4-pro 仍是 `text`。
