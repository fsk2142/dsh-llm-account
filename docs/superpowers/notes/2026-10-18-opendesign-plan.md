# OpenDesign 厂商接入施工单（2026-10-18）

目标：在 `dsh-llm-account` 里新增第三家厂商 `opendesign`（Open Design / open-design.ai 的 AMR 模型网关），
与 commandcode / opencode 同构：多账号管理、网页登录（设备授权）、导入本机登录、手工密钥、额度面板、模型目录。

## 0. 厂商事实（实现依据，已完成调研）

- 推理（runtime key，`Authorization: Bearer <key>`）：
  - `GET  https://amr-link.open-design.ai/v1/models`（OpenAI 形状：`{object:"list",data:[{id,...}]}`）
  - `POST https://amr-link.open-design.ai/v1/chat/completions`（OpenAI Chat Completions + SSE；工具调用同 OpenAI 形状）
  - 401 = 登录过期；**402 = 上游拒绝（不是密钥过期）**，不要归因成密钥失效。
- 额度/账单（control key，同一 Bearer 头）：
  - `GET https://amr-api.open-design.ai/api/v1/wallet/balance` → `{ balanceUsd }`（也可能包一层 `data`）
  - `GET https://amr-api.open-design.ai/api/v1/billing/summary` → `{ membershipTier, subscriptionStatus, subscriptionCurrentPeriodEnd, subscriptionCancelAtPeriodEnd, creditsPerUsd }`
- 周期额度（Coding Plan，可选）：本机 `vela` CLI
  - `vela billing preflight --workspace-id <id> --format json` → `{ workspaceId, codingPlan:{eligible?:boolean, windows:[{ usedCredits, limitCredits, remainingCredits, durationSeconds, resetsAt }] } }`
  - 只在该账号配置了 workspaceId 且本机能解析到 vela 时查询；失败只记 `failures`，不拖垮整体，绝不倒成 0。
- 本机登录产物：`~/.amr/config.json` → `profiles.<slot>`（默认 `prod`）=
  `{ controlKey, runtimeKey, apiUrl, linkUrl, user:{id,email,name,plan} }`。只读导入，绝不改写该文件。
- 网页登录 = 设备授权（浏览器批准），由官方 `vela login` 完成：
  - stdout 先出现 `Open this URL to continue:` 下一行是网址（形如 `https://<host>/cli/activate?deviceId=...`），随后 `Code: XXXX`；
  - 浏览器批准后 vela 退出 0 并写入 `~/.amr/config.json`（还会打印 `Login successful for <email>.`）。
- vela 解析顺序（用于登录）：环境变量 `VELA_BIN` → 桌面端内置
  `%LOCALAPPDATA%\Programs\Open Design\resources\open-design\bin\vela.exe` → PATH 上的 `vela.exe` / `vela`。
  都找不到 → 登录失败 reason `vela-missing`（文案提示：装 Open Design 桌面端，或 `npm i -g @powerformer/vela-cli`）。
- 参考实现（只读参考，不要整段抄）：社区插件 `ezdemo/opencode-opendesign-auth`（只做导入）、`AstroQore/opendesign2api`（读 `profiles.prod.runtimeKey`/`linkUrl`）。

## 1. 命名与全局决定（先定死，后面全部引用）

| 项 | 取值 |
|---|---|
| provider route id（`VendorId`） | `"opendesign"` |
| 设置命名空间 | `"llm-opendesign"` |
| settings 行候选 | `["opendesign", "llm-opendesign"]`（行 id 在前） |
| 默认 runtime 凭据引用 | `OPENDESIGN_API_KEY` |
| 默认 control 凭据引用 | `OPENDESIGN_CONTROL_KEY`（账号自带 `controlKeyEnv` 时以账号为准） |
| host 入口 | `src/vendors/opendesign/index.ts` → `lib/opendesign.js` |
| 客户端 tab order | `30`（commandcode 12 / opencode 20 之后） |
| 中文名 | `Open Design` |

推理基地址默认 `https://amr-link.open-design.ai/v1`；额度基地址默认 `https://amr-api.open-design.ai/api/v1`。

## 2. 新文件（`src/vendors/opendesign/`，按依赖顺序）

1. `failures.ts` — 错误→`FailureKind` 分类。模板 `src/vendors/opencode/failures.ts`（较简单的那份）。
2. `protocol.ts` — 端点常量 + 请求体构造 + SSE 解码。模板 `src/vendors/commandcode/protocol.ts` 的 **OpenAI 半边**
   （`buildRequestBody("openai", …)` / `openAiMessages()` / `decodeStream` / `openAiChunks` / `StreamAssembler` / `decodeLine` 的 `[DONE]` 分支），
   去掉 Anthropic Messages 部分。若不想搬 800 行，可以 `import` commandcode/protocol 的导出件（先确认它导出了哪些），
   但**必须**保证本目录有独立入口且对外签名与厂商模板一致；两种方案二选一，在报告里说明。
3. `catalog.ts` — `GET /models` → `CatalogModel[]`；可见性过滤（`visibleModels`/`modelVisibility`/`removedModels`）。模板 `commandcode/catalog.ts`。
4. `accounts.ts` — 账号端口。模板 `opencode/accounts.ts`。
   - 文档字段：`accounts: [{ id, name, apiKeyEnv, controlKeyEnv?, workspaceId? }] | null`、`apiKeyEnv`、`accountOrder`、
     `autoSwitch`、`modelAccountRules`、`credentialCleanupRefs`、`accountIntents`（hidden）。
   - `select` = 写顶层 `apiKeyEnv`；`move` = 队首回写；`setOrder`/`setAutoSwitch` 同模板；`MAX_ACCOUNTS = 20`。
   - 每操作「写意图 → 提交 → settle」，冲突重读重放；密钥永远只进凭据库，绝不进设置文档。
5. `quota.ts` — 额度端口（control key；USD 口径）。模板 `commandcode/quota.ts`（USD windows 那份）：
   - `plan`：`{ id: membershipTier, name: membershipTier, status: subscriptionStatus, periodEnd: subscriptionCurrentPeriodEnd }`；
   - `windows`：有 preflight 时，按 `durationSeconds` 映射 `5h → fiveHour`、`7d → weekly`（未知时长原样 key），
     `creditsPerUsd > 0` 时折美元 `{ key, used, cap, unit:"usd", resetAt }`；**没有 creditsPerUsd 时改用 percent 口径**
     （`{ key, percent: used/limit*100, resetAt }`），绝不无单位地摆信用点；
   - 余额 `balanceUsd`：若现有客户端契约没有展示位（先看 `usage-contract.ts`/`client/quota.ts`/账号卡），**v1 不硬塞**，在报告里说明留待后续；
   - 任何端点失败 → `failures.push(人话原因)`，缺失不倒 0；402 单独归因「上游拒绝」。
6. `login.ts` — `LoginPort`（`begin/status/cancel`，签名见 §3.7）。流程：
   - `begin()`：解析 vela（§0 顺序）→ `spawn(vela,["login"])` → 有界超时（如 30s）内解析出激活网址 + 验证码 →
     返回 `{ state:"waiting", authUrl, userCode, expiresAt }`；解析超时 → `failed/reason:"timeout"`；
     找不到 vela → 若 `~/.amr/config.json` 已有可用 profile → 直接导入并 `success`；否则 `failed/reason:"vela-missing"`。
   - 后台：等子进程退出/等配置文件出现（两个条件任一，越早越好）；成功后把 `runtimeKey/controlKey/email` 交给注入的
     `storeKey({ ref, key, controlKey, workspaceId, label })`（装配层负责「同 ref 换密钥 / 否则 add」）。
   - `status()` 纯读内存；`cancel()` kill 子进程 + 清定时器；`waiting` 中取消 → `failed/reason:"cancelled"`；终态后 `begin` 开新尝试；
     `ctx.effect` 卸载时 `cancel()`。
   - 依赖全部注入（`spawn`/`readFile`/`sleep`/`now`/`resolveVela`/`storeKey`），不 import 宿主 ctx，便于离线单测。
7. `adapter.ts` — `LlmAdapter` + `CatalogModelsPort`。模板 `commandcode/adapter.ts`（`CommandCodeAdapterDeps` 形状）：
   `providerInfo`（name `Open Design`）、`providerRetryPolicy`（显式列 `LLM_REQUEST_TIMEOUT`/`LLM_STREAM_IDLE_TIMEOUT`）、
   `listModels`、`stream`（`runStream(source, budget, {signal})` + 轮换 + `beforeRequest`）。
8. `index.ts` — 一行装配，逐句照抄 `opencode/index.ts` 的顺序：settings → credentials → intents → accounts →
   rotation access → capabilities → quota → switching → adapter → login（+ effect 卸载）→ `ctx.llm.registerAdapter(["opendesign"], adapter)` →
   `session/event` → `credentials/reference-updated` → `applyUsageRemote(ctx, deps)` → `disableSettingsAutoForm(ctx, "llm-opendesign")`。
   - `login` 依赖的 `storeKey` 走 `accountRef("opendesign", label)` 派生 ref + `credentials.set`，再 `accounts.add/rename` 落地。
   - capabilities 抄 commandcode，改 `browserLogin: true`，`quotaShape` 与实际产出对齐。

## 3. 注册点（既有文件）

1. `src/core/adapter.ts` `VendorId`：`"commandcode" | "dsh-opencode-go" | "opendesign"`。
2. `src/client/usage-contract.ts` `VENDOR_IDS`：追加 `"opendesign"`（wire 白名单，漏了就 boundary violation）。
3. `src/client/shell.ts` `VENDORS` 末尾追加条目：
   ```ts
   {
     ns: "llm-opendesign",
     rowIds: ["opendesign", "llm-opendesign"],
     providerId: "opendesign",
     order: 30,
     labelKey: "vendor.opendesign",
     models: { visible: "visibleModels", visibility: "modelVisibility", removed: "removedModels" },
     cards: [
       { group: "integrations", fields: [
         { key: "showSidebarQuota", kind: "boolean", labelKey: "field.showSidebarQuota", hintKey: "field.showSidebarQuota.hint", fallback: false },
         { key: "quotaRefreshMinutes", kind: "number", labelKey: "field.quotaRefreshMinutes", hintKey: "field.quotaRefreshMinutes.hint", fallback: 1 },
         { key: "workspaceId", kind: "text", labelKey: "field.workspaceId", hintKey: "field.workspaceId.hint", fallback: "" }, // 新键，需补 copy
       ] },
       { group: "advanced", fields: [
         { key: "baseURL", kind: "text", labelKey: "field.baseURL", hintKey: "field.baseURL.hint" },
         { key: "walletBaseURL", kind: "text", labelKey: "field.walletBaseURL", hintKey: "field.walletBaseURL.hint" }, // 新键
         { key: "requestTimeoutMs", kind: "number", labelKey: "field.requestTimeoutMs", hintKey: "field.requestTimeoutMs.hint" },
         { key: "streamIdleTimeoutMs", kind: "number", labelKey: "field.streamIdleTimeoutMs", hintKey: "field.streamIdleTimeoutMs.hint" },
       ] },
     ],
   }
   ```
   （卡片 `key` 必须是 Config 里真实存在且 volatile 的字段；没有读方的开关不要声明。）
4. `src/client/copy.ts`：`CopyKey` + `COPY.zh` + `COPY.en` 各补 `vendor.opendesign`；所有新引用的 `field.*.hint`、
   `account.reason.*`（`vela-missing`、`no-signin`、`config-invalid`、`timeout`、`cancelled`、`network`）都要 zh+en。
5. `tsdown.config.ts` 的 `entry`：追加 `opendesign: "src/vendors/opendesign/index.ts"`。
6. `package.json` `exports`：追加 `"./opendesign": { types: "./lib/opendesign.d.ts", default: "./lib/opendesign.js" }`。
7. 仓库自带 `cordis.patch.yml`：insert 行 `- id: opendesign` / `name: "dsh-llm-account/opendesign"`（**子路径**，
   不能让 boot-graph 扫描出第二个 client source；不要写 `./lib/opendesign.js`）。

无需改动：`src/index.ts`、`src/vendors/usage-remote.ts`、`src/vendors/assembly.ts`、`src/client/seams.ts`、
`accounts-panel.ts`（新厂商自动拿到 `add-opendesign`/`login-opendesign` 标记）、`dashboard.ts`、`models-card.ts`。

## 4. 测试

- 跑法：先构建，再全量测试（见 §6）。新增：
  - `tests/vendors/opendesign.test.ts`（装配冒烟，模板 `tests/vendors/assembly.test.ts`）
  - `tests/vendors/opendesign-login.test.ts`（模板 `tests/vendors/opencode-login.test.ts`：假 spawn/假时钟/假文件）
  - `tests/vendors/opendesign-quota.test.ts`（模板 `tests/vendors/commandcode-quota.test.ts`：假 fetch；形状不认识 → failures、不倒 0、402 归因）
- 既有断言同步（否则必挂）：
  - `tests/client/registry.test.ts` 的两个 ns 列表 → 三家
  - `tests/client/boot-graph.test.ts` 的行 id 列表 → 追加 `opendesign`；「唯一可见行 = opencode-go」必须保持
  - `tests/client/build.test.ts` 的逐文件 import 白名单 → 追加 `lib/opendesign.js` 的
    `["@deepseek-ai/dsh-llm","@deepseek-ai/schemastery"]`
  - `tests/client/usage-contract.test.ts` → `parseVendorId("opendesign")` 通过
  - `tests/vendors/assembly.test.ts` → 第三条路由 `["opendesign"]`
  - 若 `tests/property/fuzz.test.ts` 覆盖了两家 decode/quota，把新实现也加进去

## 5. 纪律

- 不改别家厂商行为、不动 `usage-remote.ts`/`assembly.ts`/`seams.ts`；不 `git commit`、不 `git add`（工作树里有用户未提交的改动，绝不动）。
- 界面文案一律中文进 `copy.ts`（en 同键）；原始诊断文本留在 `data-*` 属性，界面显示人话。
- 额度三态：缺失 / 真的是 0 / 不限，绝不造 0；有单位必须带；`failures` 用人话。
- 卡片 = 纯 props → 元素树（无 Hook、无内部状态）。
- 所有新代码风格跟随相邻文件（注释中文、命名同款）。

## 6. 命令（PowerShell，先补 PATH）

```powershell
$env:Path = "C:\Users\me\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin;" + $env:Path
cd D:\work\llm-acct-repo
.\node_modules\.bin\tsc.CMD --noEmit          # 0 错
.\node_modules\.bin\vitest.CMD run            # 全绿
.\node_modules\.bin\tsdown.CMD                # 重建 lib/（含 lib/opendesign.js、lib/client.js）
```

## 7. 验收

1. `tsc` 0 错；`vitest` 全绿（含 §4 改动）；`tsdown` 产出 `lib/opendesign.js`、`lib/opendesign.d.ts`、更新后的 `lib/client.js`。
2. 设置页出现第三个厂商分组「Open Design」；账户面板出现「使用 API Key / 网页登录」两个入口；
   `status/accounts/quota` 远程调用不再被 `parseVendorId` 拒绝。
3. 网页登录：点击后显示激活网址 + 验证码；授权完成后凭据写入 `DSH_LLM_ACCOUNT_OPENDESIGN_*` 槽位，账号出现在列表。
4. 无 vela 且无本机登录 → 明确的人话失败原因（`vela-missing`），不是静默/英文报错。
5. 拔出 opendesign 行后另两家不受影响。

## 施工结果（2026-10-18 晚，接手 agent）

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

## 实测修正（2026-10-18 21:50，用户报「加了 API 没有额度也没有模型」）

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

## 第三轮（22:00）：思考强度 / 套餐 / 显示名

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
