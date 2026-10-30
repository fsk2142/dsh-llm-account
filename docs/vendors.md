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
$env:Path = "%USERPROFILE%\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin;" + $env:Path
cd <WORKTREE>
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

> **施工过程记录已移出**：2026-10-18 那几轮接入过程中的「第 N 轮」修订记录
> 属于时间线内容，见 [history.md](history.md#opendesign-接入施工过程2026-10-18)。
> 本文件只保留**当前有效**的厂商事实与口径。


## 模型额度展示（2026-10-21）

需求：每个模型上显示额度信息，且按订阅套餐获取，不要把不是
本套餐可用的模型也放到模型中」。实现落在 `src/core/model-quota-table.ts`。

**数据全部来自官网 HTML（没有 API），抓取日期 2026-10-21**：

| 厂商 | 页面 | 覆盖 |
|---|---|---|
| commandcode | `commandcode.ai/docs/plans/goat` 的 `Monthly credits` 列 | 60 个模型（GOAT） |
| commandcode | `commandcode.ai/pricing` 的 `Usage` 表 | 7 个模型 × 5 档 |
| opendesign | `open-design.ai/pricing` 的 `Design Plan usage` 表 | 12 个模型 × Go/Plus/Pro |
| opencode | `opencode.ai/go` 的 `Monthly usage` 列 | 15 个模型 × Go/Go Plus |

**为什么不能用「套餐总额 × 百分比」算**：GOAT（$70/月）里 Ling 3.1 Flash 的额度是
$100（比总额还高）、Claude Sonnet 5.5 只有 $10 —— 官方按模型计价折算，不是固定比例。

**套餐可用模型过滤**（`COMMANDCODE_PLAN_MODELS`）：官方 `docs/plans/goat` 写着
「Every model below is included on the GOAT plan」，71 个唯一模型；同页
「The rest of the premium lineup needs Pro or Max」说明 Claude Opus 等在 GOAT 下不可用。
网关的 `/provider/v1/models` 返回的是全站目录（98 个），所以过滤只能在客户端做。

**三态语义**（`modelAvailableIn`）：`true` 可用 / `false` **明确不可用**（隐藏）/
`undefined` 没有官方清单（照常显示）。第三态是刻意的：没有依据就藏模型会让用户
以为插件坏了。目前只有 Command Code 的 GOAT 有完整清单。

**模型名归一化**（`normalizeModelKey`）要剥掉官方展示名里的标注后缀
（`(latest)` / `(exp)` / `(preview)`）与目录侧的 `-exp` / `-latest`：官方写
`DeepSeek V4.1 Flash (latest)`，目录 id 是 `deepseek-v4.1-flash`，不剥就永远匹配不上。

**套餐来源的坑（opendesign）**：`billing/summary` 与 `vela billing summary` **都回 403**，
所以套餐名改为在摘要为空时回退到 `billing preflight` 的 `codingPlan.tier`
（实测稳定给 `"go"`，且这份数据本来每次都在读）。注意 `eligible: false` 时不信 tier。
另外 `workspace-snapshot` 的 `billingState: "free"` 只描述钱包计费范围，
**不代表没有订阅** —— 用户实际是 Go 月付、钱包另有 $1 余额，两者并存。

## 窗口上限的口径（2026-10-22 定案）

**上限一律采信官方公布的美元值，不按接口字段换算。**

早先的实现把 `/billing/summary` 返回的 `creditsPerUsd`（实测 10000）当作换算率，
于是 Go 套餐的周窗口（`limitCredits = 150000`）显示成 **$15**，而官方
`zh/model-credits` 页明确写的是 **$30**。差了一倍。

问题在于：同一个界面上月度窗口是对的（$120，来自硬编码表），只有 5 小时与周窗口
是错的（$5 / $15，来自换算）——「一对一错」这个对比才是定位病因的关键。

现在的口径：

| 项 | 来源 | 说明 |
| --- | --- | --- |
| `cap`（上限） | `WINDOW_CAP_USD` 硬编码表 | 官方文档原文，Go: 周 $30 / 5 小时 $10 |
| `used`（已用） | `usedCredits ÷ (limitCredits ÷ cap)` | 官方不公布已用金额，只能按比率折 |
| 换算率 | 由上面两者相除得出 | **不再**采信 `creditsPerUsd` |

这样 `used` 与 `cap` 用的是同一个比率，不会出现「已用 $5.28 / 共 $30」这种两个
不同换算率拼出来的读数。

**注意**：接口的 `creditsPerUsd: 10000` 仍然存在于响应里，但它与官方文档不符，
不要再用它做上限换算。它只在完全拿不到官方上限时作为最后的回落。

### 月度窗口已移除（2026-10-23）

上面提到的那个「月度 $120（来自硬编码表）」后来被**整个删掉**了。原因：

1. 这家厂商的 `billing preflight` **只发五小时与每周两档**，从来没有月度窗口；
2. 那个 $120 是本地 `MONTHLY_MAX_USD` 表里的数，厂商从没在接口里说过；
3. 它的 `used` 用本机台账填，**只含这一台机器** —— 其他设备的用量不在里面。

三者凑成一根进度条，看起来像「账户月度总额度」，实际是「本地编的上限 + 本机用量」。
拿它在另一台设备上判断余额会出错，所以去掉。

现在只发布厂商真实返回的窗口。**另外两家不受影响**：

| 网关 | 月度窗口来源 |
| --- | --- |
| OpenCode Go | 厂商 API 的 `usage.monthly` 字段（真实） |
| Command Code | `billing/credits` 的 `monthlyCredits` 余额派生（真实） |
| Open Design | **不存在，不再合成** |

套餐行仍显示「每月 $120」—— 那来自 `/billing/summary` 的 `subscriptionCreditsUsd`，
是厂商真实数据，与本地产的窗口不同。

**厂商 → 表的映射**改用显式枚举（`quotaTableOf` / `planModelsOf`），
不再用 `vendor.includes(...)` 的子串匹配 —— `opendesign` 与 `opencode` 共享
`openc` 前缀，靠顺序侥幸正确太脆，认错表会静默显示另一家的额度。
## 登录成功的判据（2026-10-22 定案）

`~/.amr/config.json` 是 vela 的**固定槽位**文件：不管登录哪个账号，都写
`profiles.prod`。这个事实决定了「怎么判断一次登录成功了」，而且踩过两次坑。

### 判据必须同时满足三条

| 条件 | 为什么 |
| --- | --- |
| 文件内容与**登录前的基线不同** | 固定槽位意味着登录前就有上一个账号的内容；只看「文件存在且能解析」会把旧账号重新存一遍并谎报成功 |
| 内容能解析成 profile | 半截写入不算成功 |
| 或：内容没变但**子进程正常退出（code === 0）** | 重复登录**同一个**账号时，vela 可能写回完全相同的 profile（密钥没刷新）—— 那时「内容没变」不代表没登录 |

### 两次真实故障都在这里

| 版本 | 症状 | 根因 |
| --- | --- | --- |
| v0.8.3 及之前 | 登录第二个账号 → 界面说成功，账号列表没变 | 只判「文件存在且能解析」，读到的是**第一个账号**的旧内容 |
| v0.8.4 | 重复登录同一账号 → 报「没有登录」 | 改成只判「内容不同」，但重复登录时内容真的可能相同 |

**定案的组合判据**：

| 内容 vs 基线 | 子进程 | 结论 |
| --- | --- | --- |
| 不同 | 任意 | 成功（本次写入了新内容） |
| 相同 | 已退出且 code=0 | **成功**（重复登录，同一份内容） |
| 相同 | 已退出但 code≠0 | 失败（异常退出，文件里是旧账号） |
| 相同 | 未退出 | 继续等（还没批准） |

### 对「导入本机登录」的影响

`vela` 不在本机时，`#importWithoutVela` 会直接读那个文件导入。它只能导入
**最后登录过**的那个账号 —— 这是固定槽位的限制，不是我们的 bug。添加第二个账号
必须走网页登录（设备授权）。

### 一次导入 vs 持续读取

登录产物只在**登录时**一次性导入成普通凭据（`DSH_LLM_ACCOUNT_OPENDESIGN_*`），
之后**发请求不再读那个文件**。这条由 `tests/vendors/opendesign-two-accounts.test.ts`
里的源码契约断言守着（`adapter.ts` 里不得出现 `.amr/config.json`）。

否则 vela 覆盖固定槽位后，两个账号会退化成「都用最后一个登录的」。
