# 厂商适配：端点事实、认证与配额

三家网关（`commandcode`、`dsh-opencode-go`、`opendesign`）的**实测事实**与已知限制。
这里记的是「厂商实际怎么回」，不是「我们希望它怎么回」—— 每条都标注了证据来源。
改适配器之前先读这里，能省掉大量重复探测。

---

## OpenDesign 接入施工单（2026-10-18）

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

## 第四轮（22:25）：工作区自动发现

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

## 第五轮（22:40）：思考档位改为「逐模型实测表」，DeepSeek 拿到 max

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

## 第六轮（22:55）：档位按官方口径收敛 + 额度自动发现工作区

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

## 第七轮（23:15）：月度额度 + 账单摘要改走 vela 回退

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

## 网页登录的三类症状与修法（2026-10-18）

用户报障（设置页 → 账户面板）：

1. 点 Command Code 的「网页登录」后**没有自动弹出浏览器**；
2. 授权链接/等待面板**一直不消失**；
3. 点 OpenCode 与 Open Design 的「网页登录」**没有任何反应**。

## 根因（三条独立成因，都不是「按钮没接上」）

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

## 修法

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

## 测试

- `tests/client/login-window.test.ts`（9）：无 window / 被拦截 / 导航失败 / 跨域读 location /
  关窗幂等。
- `tests/client/accounts-panel.test.ts`（+5）：取消按钮与回调、失败原因文案、cancelled 不报红、
  启动中禁用、调用失败的原文只在 data 属性。
- `tests/client/container-simulation.test.ts`（+5，真容器）：opencode 路由与自动导航、
  opendesign 失败可见且关窗、取消后停轮询、success 自动消失并重读账号、连续读失败先保面板后收尾。
- `tests/vendors/opencode-login.test.ts`（+1）：HTTP 拒绝 vs 传输失败的两种原因。

结果：`tsc` 0 错、vitest 59 文件 / 781 例全绿、`tsdown` 重建成功。

## 真机待验

- Command Code：点「网页登录」应弹出一个窗口并停在授权页；浏览器里批准后等待面板自动消失、
  账号出现在列表；不批准可点「取消登录」。
- OpenCode：若仍失败，界面会说明原因是网络还是服务端拒绝（以前完全没提示）。
- Open Design：没有 vela 时会明确说「本机找不到 vela…」，装上桌面端/CLI 后应能弹出设备授权页。

## 第二轮（同日 21:45–21:55）：不登录也要自己收起

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

## 第三方模型的图片输入：调研结论（2026-10-19）

日期：2026-10-19（本轮）
用户报障：「我发现每次第三方 deepseek 模型不支持图片输入，理论上官方都是支持的，你顺便检查一下」。

**结论先说：这不是一个「声明写错了」的小修，而是图片通路根本没做。** 本包目前既没有把图片
内容块序列化进请求，也没有声明图片模态；只改声明会让模型**收到一个它看不见的图片**然后
若无其事地回答，比现在明确拒绝更糟。所以本轮只做调研，没有改代码。

## 证据 1：厂商目录里根本没有模态字段

`C:\Users\me\.dsh\commandcode\commandcode-models.json`（旧插件落盘的线上目录，85 个模型）
每一行的键只有 `id` / `name` / `reasoning` / `contextWindow` / `maxTokens`。deepseek 家族全都在，
一行示例：

```json
{"id":"deepseek/deepseek-v4-flash-vision-exp","name":"DeepSeek V4 Flash Vision (exp) (CC)","reasoning":false,"contextWindow":1000000,"maxTokens":65536}
```

本包 `src/vendors/commandcode/catalog.ts` 与 `.../opendesign/catalog.ts` 的
`inputModalitiesOf()` 只认 `modalities` 数组里的 `"image"` 或布尔 `image: true` —— 负载什么都没
声明，于是每个模型都按 `["text"]` 广告。宿主的语义是「显式省略 = 否定能力」，所以界面/分发
层就认定这些模型不能收图。

## 证据 2：请求侧把图片块直接丢掉了

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

## 证据 3：官方通路是怎么做的

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

## 要做的话，需要三步（属设计文档的第 3 期）

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

