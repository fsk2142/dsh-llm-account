# 设计裁决记录（Ruling 1–46）

施工期做出的 **46 条裁决**及其理由。代码与测试里有 **30 处**注释直接引用这里的编号
（`Ruling 22` 一处就被引用 15 次）—— 这不是历史存档，是那些取舍的唯一书面依据。

**新增裁决请继续编号追加，不要改写既有编号。**

---

## 第一期施工 ledger（2026-10-13）

> **2026-10-20 注（文档清理时复核）**：本 ledger 引用的 1a 期计划与 `2026-10-13-host-smoke.md`
> 已在清理时删除（描述的是已完成、且被后续多轮重构取代的阶段）。
>
> **本文件为什么不能删**：`src/` 与 `tests/` 里有 **30 处**注释直接引用这里的编号裁决
> （`Ruling 1` / `2` / `16` / `19` / `22` / `23` / `34`，其中 `Ruling 22` 被引用 15 次）——
> 那不是装饰，是那些代码取舍的**唯一书面依据**（例如 Ruling 22 解释了为什么测试用 React
> 替身、为什么组件必须是无 Hook 的纯函数）。删掉本文件会让这 30 处引用变成悬空指路。
> 需要被删文档的原文时从 git 历史取回。

Spec: docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md（已读，是绑定权威；计划与它有冲突时按 spec 裁决）
Workspace: D:\work\llm-acct-repo\.superpowers\sdd\2026-10-13-dsh-llm-account-phase1-host\

### 环境记录

- 2026-10-13：本机 `bash` 不存在（Windows），SDD 技能自带的 `scripts/sdd-workspace` / `task-brief` / `review-package` 无法执行。以等价手工方式替代：workspace 目录手工创建；任务 brief 用手工抽取写入 `<workspace>/task-N-brief.md`；review package 用 `git log --oneline` + `git diff --stat` + `git diff -U10` 重定向到一个唯一命名文件（技能明确允许此替代）。
- 2026-10-13：工作区权限修复已执行 —— `VERDICT=PRECONDITION`（缺少所有权权限）→ `GRANTED=1`、`verification.status=verified`；备份与回滚脚本在 `D:\work\llm-acct-repo-acl-recovery\acl-backup-4d04cebfe3244089a4dd32728fafd16c.json(.ps1)`。修复后在沙箱内重跑原操作成功（node 24.19.0 / git 2.55.0 / pnpm 11.24.0）。
- 2026-10-13：会话文件策略改为 danger-full-access，批准提示关闭；不再请求任何提权。

### Pre-flight scan（Task 1 之前，逐行核对后写出）

### 任务对之间共享文件/接口的行

| 任务对 | 共享物 | 一个产出 vs 另一个消费 | 结论 |
| --- | --- | --- | --- |
| T1 ↔ T14 | 一次性 profile、`cordis.patch.yml` | T1 用 profile `spike` + `examples/spike/cordis.patch.yml`；T14 用 profile `spike2` + 根 `cordis.patch.yml` | 不冲突 |
| T0 ↔ T14 | `package.json` | T0 建（含完整 `exports`）；T14 只加 `dsh.bundle.patch` 与入口 | Ruling 1 |
| T2 → T3..T14 | 核心类型 | 已声明 `ModelRule`/`AccountState`/`SettingsPort`/`LoginStatus`/`QuotaSnapshot`/`QuotaWindow` | 自审已修 |
| T5 → T9..T14 | `RotationEngine` | **没有任何任务消费它** | Ruling 1（缺陷） |
| T7 → T9/T12 | `runStream` | **没有任何任务消费它** | Ruling 1（缺陷） |
| T9/T12 → T10/T13 | `classify*Failure` | T10/T13 不消费；应由适配器的 stream 消费 | Ruling 1（缺陷） |
| T6 → T9/T12 | `selectVisible` | T9/T12 未声明消费 | Ruling 1 |
| T3 → T10/T11/T13 | `pickApiKey` | 适配器需负责收集 sources（字面量/凭据库/环境变量/auth.json） | Ruling 1 |
| T8 → T13 | `IntentLog` | T13 Consumes 已声明 | OK |
| T11 → T14 | `LoginPort` | T11 产出；T14 需构造并挂载 | Ruling 1 |
| T4 → T5/T10/T13 | `accountRef`/`dedupeByRef`/`assignModelRule`/`dropAccount` | T5 只用 `ModelRule`；T10/T13 的账号端口负责调用 | OK |

### 每个任务自身文本一致性的行

| 任务 | 测试 vs 代码、建的文件 vs 后续修改 | 结论 |
| --- | --- | --- |
| T0 | 三步命令 + `.gitignore`；`exports` 指向 T14 才存在的入口 | 见 Ruling 1（T0 写完整 exports，入口缺失不影响 T0 的三条命令） |
| T1 | client.js 的 apply 计数与三问一致 | OK |
| T2 | `supports()` 两个测试对应两个能力字段 | OK |
| T3 | 三条测试对应 `pickApiKey`/`normalizeKey` | OK |
| T4 | 四条测试对应四个纯函数 | OK |
| T5 | 七条测试对应 `pick`/`markRejected`/`fallbackAllowed`/`clearCredentialRejection` 与两个常量 | OK |
| T6 | 三条测试对应 `isModelVisible`/`normalizeVisibility` | OK |
| T7 | 三条测试对应 `runStream` 的两个超时与正常透传 | OK |
| T8 | 两条测试对应 `replay` 的清除与轮次上限 | OK |
| T9 | 四条测试对应 `classifyCommandCodeFailure`/`parseCatalog` | 见 Ruling 1（补 stream 装配与其端到端测试） |
| T10 | 三条测试对应 `toQuotaSnapshot`；`createCommandCodeAccounts` 无测试 | 见 Ruling 1（补账号端口测试） |
| T11 | 四条测试对应 begin/status/cancel 与两个默认常量 | OK |
| T12 | 四条测试对应 `classifyGatewayFailure`/`parseModels` | 见 Ruling 1 |
| T13 | 五条测试对应 `toQuotaSnapshot`、MAX_ACCOUNTS、意图顺序、冲突重放 | OK |
| T14 | 三步验证对应入口导出与两条路由 | 见 Ruling 1（补 login 构造） |

### Rulings

- Ruling 1（预检，2026-10-13）：**计划遗漏了「把内核串成一个 LlmAdapter」这一层** —— `RotationEngine`（T5）、`runStream`（T7）、`classify*Failure`（T9/T12）、`selectVisible`（T6）、`pickApiKey`（T3）全都没有消费者，没有任何任务产出宿主真正调用的 `LlmAdapter.stream()`。决定：把 T9 与 T12 扩写为「LlmAdapter 与协议」，各自产出 `createCommandCodeAdapter(deps): LlmAdapter` 与 `createOpencodeAdapter(deps): LlmAdapter`（实现 `listModels`/`resolveModel`/`stream`，stream 内串「轮换 → 传输内核 → 失败分类」，`listModels` 走 `selectVisible`）；T9/T10 补账号端口与 stream 的端到端测试；T14 增加构造 login 端口并挂载；T0 的 `package.json` 直接写完整 `exports`，`.gitignore` 增加 `.superpowers/`。依据：spec §6.3（适配器接口）、§6.4（关键语义）、§9.1（请求路径）。**若判断错误**：适配器文件比原计划大一档，后续第 2/3 期若要按协议再拆需要一次重构；不影响接口边界与命名。
  - 已执行：计划文件已按本裁决改写（T0 exports/.gitignore、T9 标题+Interfaces+测试+Step3、T10 Interfaces+测试+Step3、T12 标题+Interfaces+测试+Step3、T14 Interfaces+Step1）。同时把 T10 的账号操作改为与 T13 同语义（先写意图日志再提交），依据是 spec §6.4.5「两家共用」。
- Ruling 2（环境，2026-10-13）：本机无 `bash`，SDD 技能的三个脚本无法执行；改用等价手工流程（brief 手工写入 `<workspace>/task-N-brief.md`，review package 用 `git log --oneline` + `git diff --stat` + `git diff -U10` 重定向到文件）。代价：若手工抽取 brief 时漏段，实现者会少需求 —— 缓解办法是 brief 里附上该任务的 Interfaces 与 Global Constraints 全文。
- Ruling 3（模型选择，2026-10-13）：本会话只有一条可用的子代理路由（`commandcode` / `deepseek/deepseek-v4.1-flash`），因此技能要求的「按任务难度分级选模型」与「第 4-5 轮修复升级模型」都无法执行；所有派发都显式写这一条路由。代价：难任务的实现与复核没有能力提升空间，只能靠更细的 brief 与更严的复核兜底。

### 需求变更（执行期间，用户追加）

- 变更 1（2026-10-13，用户）：**设置页与界面摆放要对齐现在用的 Command Code 插件**；账号分组方式由用户选定为**顶部厂商标签页切换**。已落进绑定规格：设计文档 §8 新增「页面结构（摆放与现有 Command Code 插件差不多）」与「界面摆放（第 2 期）」两条，§3 第 2 期行补注「摆放与卡片形状对齐」；计划末尾的 1b 说明也同步了。影响面：只在计划 1b（客户端页面）与第 2 期；1a（宿主侧）不受影响，继续执行。

### 任务记录

- Task 10: dispatched（implementer agent `e8392e2a-be95-40a0-9fcc-5377c6c348f9`），BASE = `5860601`。完成，提交 `d7dce69`（`quota.ts` 341 行 + `accounts.ts` 418 行 + 测试 598 行；`src/core/adapter.ts` **只加 7 行** = `CredentialPort.describe`）。`pnpm typecheck` 干净、`pnpm test` **129/129**。
- **Ruling 25（Task 10 concern 1，2026-10-13）**：账号条目把 ref 存在**旧字段 `apiKeyEnv`** 里（零迁移必需；用户现有配置就是这个形状）。接受。**若判断错误**：Task 13/14 需改一个常量。
- **Ruling 26（concern 2）**：「自动」哨兵值为 `"auto"`；`remove` 掉当前账号时写 `"auto"` 而不是旧的空串。接受，并把「Task 14 映射 `activeAccount` → `pinned` 时必须把 `"auto"` 与 `""` 都当自动」写进 Task 14 brief。
- **Ruling 27（concern 3）**：`remove` 只把 ref 记进 `credentialCleanupRefs`，**不**立刻 `credentials.unset`（与 brief 的测试 5 一致，与旧插件的延后清理一致）。接受；真正的清理动作留给后续（计划 1b/1c 决定触发时机）。
- **Ruling 28（concern 4）**：`monthlyCredits` 窗口只在 `usage.totalCredits` 与 `credits.monthlyCredits` **同时存在**时才产出（brief 测试 1 钉住「只有 credits.monthlyCredits 时 windows 为空」）。接受实现者的读法：测试是验收标准，且符合「缺失数据不得编造」。
- **Ruling 29（concern 5）**：`add` 的意图**不带 ref**（空 ref 依赖最新文档）。接受，但要求 Task 14 的重放逻辑对未决 `add` 意图：按 label 找到已创建的账号；若密钥写入从未发生，就把它**保留在列表里等补填密钥**（与旧插件「未能写入 Key 的新增账号保留在列表，可补填或删除」一致），不得静默丢弃。
- **Ruling 30（concern 6）**：条目上**已存在的**内联明文 `apiKey` 字段在重写设置时**原样保留**（不做删除），但我们**不读取它**作为凭据来源（`literal` 仍只来自组合配置的秘密字段）；计划 1b 应提供一个「把内联 key 迁移进凭据库」的动作。依据：删掉它会静默废掉该账号，读它会违反「密钥只进凭据服务」。
- **Ruling 31（concern 7）**：可用 ref 的占用集合 = `accounts` + `credentialCleanupRefs` + 顶层 `apiKeyEnv`；同名账号第二个拿到 `_2` 后缀。接受（与 Review Focus 1 一致）。
- Task 10: 复核结论 = **Needs fixes**（2 条 Important，无 Critical；复核自行跑了该测试文件 25/25 通过）。复核独立核实了 `src/core/adapter.ts` 只多了那 7 行、以及旧插件端点/请求头/占用规则的行号对照。
- **Ruling 32（Task 10 Important 1，2026-10-13）**：月度窗口不得编造利用率。`credits.credits.monthlyCredits` 的真实语义（额度上限 vs 剩余余额）无法从代码确证：brief 称之为「月度**余额**」，而旧插件把它与其它池相加当余额（`balanceTotal = monthlyCredits + purchasedCredits`，legacy 7738），真正的月度总额来自静态套餐表（legacy 941-995）。决定：月度窗口只产出**消耗量** `{ key: "monthlyCredits", used: usage.totalCredits }`，**不产出 `cap`/`percent`**，并在 JSDoc 写明「本期不知道额度总额，因此不算比例」；总额留到第 2 期接套餐表。**若判断错误**：本期额度面板看不到月度百分比（信息少一个数字，但不会显示荒谬值）。
- **Ruling 33（Task 10 Important 2，2026-10-13）**：`add` 必须**先解析出 ref 再写意图**，并把 ref 放进意图（`AccountIntent.ref` 本就有该字段），提交时用同一个 ref —— 这样崩溃重放是确定的（按 ref 而不是按可能重名的 label）。另外，任何「不改状态就会失败」的校验（可用 ref 耗尽、label 校验）必须在 append **之前**完成，避免留下永远无法应用的意图；真正的写入失败（如冲突重试耗尽）留下待重放意图是正确的。**若判断错误**：无 —— 这是把不确定性换成确定性。
- Task 10: fix round 1/5 完成，提交 `4fe97dd`（`pnpm test` **132/132**；变异检验：把月度窗口还原成拿余额当 cap、把 `add` 还原成不固定 ref，**恰好**那 4 条更新/新增测试失败）。复审 dispatched。
- **Ruling 34（并行执行，2026-10-13）**：Task 10 的修复已在复审中（文件已冻结），Task 11 只新增 `login.ts` 与其测试、与任何在途文件零交集，因此**并行启动 Task 11** 以节省墙上时间。**若判断错误**：若 Task 10 复审判定未解决，我会有两件在途事项；两者的文件不相交，回退成本仅为重新排序。
- Task 10: fix round 1/5 复审结论 = **两条都 ADDRESSED，但修复引入一条新的 Important** → 第 2 轮：`accounts.ts:266` 冻结的 ref 在每次 `#mutate` 重试时不再校验，而 `accountRef` 是确定性哈希，所以两个交错执行的同名 `add` 会先后追加同一个 ref（文档里出现 `[R, R]`，两条都写同一个凭据槽），推翻了 `accounts.ts:193-194` 明示的「两个账号永不共用凭据槽」保证；`list()` 的 `dedupeByRef` 还会把重复行藏起来。修复要求：保留裁决的确定性（意图带冻结 ref、只提交该 ref），但每次重试都要对**最新文档**做幂等/存在性校验（已存在就不追加、不重复写凭据槽），并补三条测试；同时修正 `accounts.ts:255-257` 的 JSDoc 过度声称（凭据写失败留下的意图**无法**补回密钥，只能补填）。
- Task 11: 实现完成（第二次派发，agent `8a48bee9-…`；第一次 `5d43a25a-…` 写完测试后死亡），提交 `27fc044`（`login.ts` 711 行 + 测试 579 行）。`pnpm typecheck` 干净、`pnpm test` **151/151**、登录文件连跑 9 次零抖动。实现者判断既有测试符合 brief，只改了一处不能编译的断言（`undici-types` 下 `json()` 返回 `unknown` → TS2571）并自审新增一条 `cancel()` 竞态测试。
- Task 11: 复核结论 = **Needs fixes**（1 条 Important，无 Critical；复核自行跑该文件 17/17）。缺陷：settle 钩子与 server 句柄是实例级、未按代际隔离 —— 被取代的旧连接若在新 `begin()` 之后完成，会用**旧** state 校验却触发**新**尝试的 settle（可能把密钥写进 state 不匹配的尝试），并关掉正在用的监听器（用户真实回调被拒、卡到 120s 超时）。**Ruling 35**：接受复核建议的修法（handler 绑定自己的 attempt 与 server，settle/close 前要求 `this.#server === server && this.#ownsAttempt(attempt)`），并补一条「重新 begin 后向旧端口投递回调」的回归测试。依据：这是凭据写入路径，属于「必须修」而非可延期。**若判断错误**：修复 diff 很小、仅限 login.ts 的 handler 闭包。
- Task 11: fix round 1/5 复审结论 = **ADDRESSED，无新增 Critical/Important**。复审逐条验证：handler 现按代际绑定自己的 attempt + server（`login.ts:453-458`），决定性投递在 settle/close 前做三重身份判定（`login.ts:614-623`），`#closeCallback(server)` 只关自己的 server；并确认没有合法路径被这次修复破坏（正常单次、同端口重启、超时路径都跑通，18/18）。Task 11 **complete**（`27fc044`, `f85a298`）。
- Task 12: 实现完成（implementer agent `ce838773-…`），提交 `d6257ea` + `b184243`（4 个新文件 + 测试；`pnpm typecheck` 干净、`pnpm test` **160/160**）。pi-ai 以 **devDependency 别名** `opencode-go-pi-ai: npm:@earendil-works/pi-ai@1.1.0` 引入，实现者用真实 tsdown 构建验证已被**内联**（产物 1.62MB、零 SDK 外部导入）。
- **Ruling 37（Task 12 concern 1，2026-10-13）**：接受提交 `pnpm-workspace.yaml`。原因：pnpm 11 在安装时自动生成该文件并留下未填的 `allowBuilds` 占位符，导致**所有** `pnpm` 命令退出 1（`ERR_PNPM_IGNORED_BUILDS`）；不提交它，新克隆就跑不了测试。**若判断错误**：该文件与项目其它配置等价，可随时改内容或迁移位置。
- **Ruling 38（Task 12 concern 2/3）**：接受 `parseModels` 返回 `{ entries, ignored }`（brief 自带测试就是这样解构的）；接受本期不移植 `x-opencode-session` 头与图片/文件块（属第 2/3 期，且未对真实网关验证过）。
- Task 12: 复核结论 = **3 条 Important**（无 Critical）。复核独立确认了依赖形态与内联的**结构性保证**（tsdown 只外部化 dependencies+peerDependencies+optionalDependencies，devDependency 别名不可能被外部化）、`pnpm-workspace.yaml` 的内容合法且最小、七条必需测试 1:1 且非空转，并对 `classifyGatewayError`/`/models`/`withModelLimit`/`maxRetries: 0` 等逐行核对旧包一致。
- **Ruling 39（Task 12 三条 Important，2026-10-13）**：全部接受并派修复：① 带内/无 HTTP 的错误不能一律归 `network`（否则上下文溢出这类**确定性**失败会在账号池里重放到 `MAX_TRIED`，且宿主失去 compaction 信号）—— 要先按旧插件顺序判 `isContextOverflow`，只有文案确实像传输问题才归 `network`；② 补两条必需测试（`providerRetryPolicy` 的两个超时码、`MAX_TRIED` 上限可达）；③ 失败路径的正文预览读取必须有上限（旧插件是 1000ms），否则非 2xx 响应体卡住会把请求挂死到调用方中止。**若判断错误**：①② 改变的是分类与测试，③ 只是加一个超时 —— 都不动轮换设计与接口。
- Task 12: fix round 1/5 dispatched（resume `ce838773`）。
- Task 13: 实现完成（implementer agent `e37e6702-…`），提交 `be40f57`（`quota.ts` 287 + `accounts.ts` 567 + 测试 597；`pnpm typecheck` 干净、`pnpm test` **178/178**）。`/usage` 请求形状与错误矩阵对照旧包 `usage` 相关行；错误用本适配器新增的 `OpencodeUsageError`（code `opencode-go/usage-unavailable`，带 `retryable`/`retainPrevious`）。
- **Ruling 40（Task 13 concern 1，2026-10-13）**：ref 用 `DSH_OPENCODE_GO_ACCOUNT_` 前缀（而不是 `accountRef("dsh-opencode-go", label)` 的产物）。依据：旧 opencode 插件的凭据槽名就是这个前缀，零迁移要求沿用；brief 补充 3 也是这么要求的。**若判断错误**：3 行改动 + 1 条正则断言。
- **Ruling 41（Task 13 concern 2/3）**：接受删除 `modelAccountRules` 处理（那是 commandcode 的字段；opencode 用 `modelVisibility`，且本厂商的能力声明里没有按模型绑定账号）；接受 `credentialCleanupRefs` 作为本厂商也使用的「待清理凭据」记录字段（旧 opencode schema 不认识它，属于我们新增的字段，已在报告里说明）。
- Task 13: 复核 dispatched（agent `530a06b3-…`），package = `.superpowers/sdd/.../review-task-13.md`（range `b184243..be40f57`）。
- Task 12: fix round 1/5 完成，提交 `ea12154`（3 条 Important 全修：`error` 路径先判上下文溢出、带内规则表按旧包逐行移植、未分类错误改为**非重试**的 `PI_AI_ERROR`、补两条必需测试、诊断正文读取加 1000ms 上限并支持调用方中止）。实现者注入了 5 个变异体、逐一确认覆盖测试变红后逐字节还原。`pnpm test` **183/183**。
- Task 12: fix round 1/5 复审结论 = **全部 ADDRESSED，无新增 Critical/Important**；复审逐行核对带内规则表与旧包 `classifyPiAiError` 同正则同顺序、确认 `PI_AI_ERROR` 不在我们与宿主的重试白名单里（所以确定性失败不会被反复重放）、并实测卡住的响应体在 1008ms 内降级为「只有状态」的证据。
- Task 12: **complete** (commits `d6257ea`, `b184243`, `ea12154`)。
- Task 12: minor (deferred)：带内裸 401/403 现在映射为账号级 `unavailable`（5 分钟冷却），而旧的带内 AUTH 不触发轮换 —— 有意为之，但与修复前行为不同；配额行去掉了 `/quota|credit/i` 宽匹配（与旧包一致，但相对 `b184243` 是行为变化）；`PI_AI_ERROR` 的载体丢掉了 HTTP status（仅影响诊断）；截断时跳过一次解码器冲刷可能让诊断文本出现 U+FFFD；正文读取的**调用方中止**分支没有测试；一个既非 `LlmError` 也非 `OpencodeStreamFailure` 的异常仍会裸抛；旧包的 `harnessOverflow`（`isContextWindowExceededError`）两处路径都没移植（该断言在本机 `dsh-llm` 里未导出）。
- Task 13: fix round 1/5 完成，提交 `1b2238d`（3 条 Important 全修：`resolveKey` 失败分类化、无法识别的载荷改为分类失败、`MAX_ACCOUNTS` 竞态改为「先 settle 再抛」以免留下永远失败的意图）。`pnpm test` **187/187**；变异检验：把三处修复要点一起还原，**恰好**那 3 条覆盖测试失败。
- **Ruling 42（Task 13 修复过程事故，2026-10-13）**：实现者披露它在做变异检验时对**未跟踪**文件跑了 `git checkout -- <file>`，把自己的 Round 1 改动回退了；它自查发现后手工重做并重新验证。处置：**接受**其自述，但要求复审**独立核对提交内容**（不得再用任何写仓库的 git 命令做变异），并已写进复审提示。**若判断错误**：手工重做可能漏掉某处改动 —— 复审的逐条核对就是为此设的。
- Task 13: fix round 1/5 复审 dispatched（agent `a65607f0-…`），package = `.superpowers/sdd/.../review-task-13-fix1.md`（range `be40f57..1b2238d`）。
- Task 14: dispatched（最后一个任务：两行装配、peerDependencies、假 ctx 冒烟）。与 Task 13 的复审文件不相交（只新增两个 `index.ts` + `cordis.patch.yml` + 装配测试 + `package.json`）。
- Task 13: fix round 1/5 复审结论 = **三条全部 ADDRESSED，无新增 Critical/Important**。复审在**仓库外的临时副本**（不是写本仓库）里反向打补丁做变异：提交的测试恰好 3 条失败，与三条 findings 一一对应；并逐条与 `review-task-13.md` 对照确认**没有半还原的碎片、没有丢掉既有行为**（这正针对实现者手工重做那次事故）。Task 13 **complete**（`be40f57`, `1b2238d`）。
- Task 14: **实现者写完产物后静默死亡、未提交**（与 Task 8 同一失败模式）。控制器按 Ruling 14 先例接手验证：`pnpm typecheck` 干净、`pnpm test` **193/193**、`pnpm build` 成功产出 `lib/{index,commandcode,opencode}.js`；`node -e "import('dsh-llm-account/commandcode')"` 与 `.../opencode` 都返回 `{Config, PROVIDER_ID, apply, inject, name}`；`lib/*.js` 里对宿主包是**裸导入**（`import ... from "@deepseek-ai/dsh-llm"` 等），未内联 —— Ruling 11 的验收由此通过。产物**原样**代为提交为 `8efca3c`。
- Task 14: 产物含一个 brief 未列的文件 `src/vendors/assembly.ts`（共享装配模块，两个 `index.ts` 复用它）；已明确要求复核判定它是否正当、还是范围蔓延。
- Task 13: 复核 dispatched（agent `530a06b3-…`）—— 该轮已完成，结论见下。
- Task 14: 复核 dispatched（agent `c984fff5-…`），package = `.superpowers/sdd/.../review-task-14.md`（range `1b2238d..8efca3c`）。
- Task 14: 复核结论 = **0 Critical / 3 Important**。复核逐项确认：两行 patch 的 id 与子路径名正确、peerDeps 是精确析取（与旧插件发布的范围逐字一致）、`src` 里所有 `@deepseek-ai/*` 都是已声明的 peer（唯一非 peer 运行期依赖是第三方 `opencode-go-pi-ai`，设计 §7.2 要求它内联）、每个命名空间只构造一个 `IntentLog`、`clearCredentialRejection` 的宿主接缝在真实主机上**确实可达**（`CredentialProvider.fanOut` 派发时不带 emitting context，cordis 不会过滤兄弟监听器）、路由注册用的是带 disposer/`replace` 的句柄、Command Code 的 `activeAccount` 哨兵 `"auto"`/`""`/缺失都正确映射为不固定。三条 Important：
  - **Ruling 43（Important 2，必须修）**：opencode 行声明了 `enabled` 却完全忽略它，而**用户现有配置里这一行正是 `enabled: false`** —— 照现状切换后会**违背用户配置**把 OpenCode Go 的路由与模型重新启用。旧插件是按它门控注册与撤销的。处置：修（按 `enabled` 门控注册、变化时撤销/重注册，并补三条测试）。
  - **Ruling 44（Important 3，必须补）**：`docs/superpowers/notes/2026-10-13-host-smoke.md` 是 brief 明列的交付物，提交与工作树里都不存在。处置：补写，内容含「本期无法验证、列为 1c 必测」的清单。
  - **Ruling 45（Important 1，显式改期）**：`IntentLog.replay` 在 `src/` 里没有任何调用方 —— 崩溃恢复那半边是死的。**裁决改期到 1b/1c**，理由是它需要新增端口级接口（每厂商一个 `applyIntent` 供重放回调），而本期没有任何真实路径能产生账号变更（账号界面要到 1b）。这不是遗忘：已写进计划的「1a 结束时明确改期未做的项」，并在 1c 的真机验收里加一条崩溃重放演练。**若判断错误**：本期交付的语义是「先写意图再提交」但没有恢复半边，一次中途崩溃会留下未决意图直到 1b 接上。
- Task 14: fix round 1/5 dispatched（新派实现者 `a1ebf4ec-…`，只修 Ruling 43/44 + 授权的一条 Minor：补 `dsh.client.platform = "web"`）。→ 完成，提交 `e1c83bc`（`enabled` 门控 + 撤销、补冒烟记录 125 行、`client.platform`）。`pnpm test` **195/195**，`pnpm build` 通过；变异检验：把 `enabled` 强制为 true，**恰好**那 2 条新测试失败。
- Task 14: fix round 1/5 复审结论 = **全部 ADDRESSED，无新增 Critical/Important**。复审独立复现了冒烟记录里的每一项（lib 12 个产物与字节数、三个子路径的导出键、裸导入表、8 条装配测试），确认 `enabled` 门控在挂载与撤销两条路径都正确（撤销用的是宿主返回的**真实** registerAdapter 句柄，true→false→true 不重复注册也不泄漏），并且**在已装的 `app.asar`（121MB）里找到了 `loader/volatile-update`**，所以那个接缝不是凭空假设（rc.2 目标仍列为 1c 必测）。
- Task 14: **complete** (commits `8efca3c`, `e1c83bc`)。**14 个任务全部完成。**
- Task 14: out-of-scope（1c 需查）：opencode 的注册只按 `enabled` 门控，不像旧插件还要求 `configured`（有 enabled 但没 key 时会把路由与目录亮出来）；`registerAdapter` 没有 try/catch（旧插件容错，遇到 DUPLICATE_ADAPTER 会保持挂载而不是让 apply 失败）；假宿主记录的 effect disposer 没有测试真正调用（卸载释放路径未被行使）。
- **最终全分支复核 dispatched**（agent `c8d117fc-…`），package = `.superpowers/sdd/.../review-final.md`（提交历史 + 交付物行数清单 + 指向 ledger 的延期 Minor 分诊）。复核范围：`src/**`、`tests/**` 与根配置；**不审** `docs/**` 与 `.superpowers/**`；禁止 `pnpm build`（会写 `lib/`）。
- 最终全分支复核结论 = **0 Critical / 3 Important**，判定「With fixes」。复核独立核对：`src/core/` 里厂商字样只剩 `VendorId` 类型联合一处；`providerRetryPolicy`/Config 字段/凭据优先级与旧插件逐行一致；测试用真实 SSE fixture、真实回环 socket、真实 pi-ai + 注入 fetch、以及 `fallbackAllowed` 间谍证明「没切换」是门控的判定而非运气；`git grep` 无明文密钥；`lib/**` 只导入 peer 与 `node:*`（pi-ai 及其传递依赖已内联）。它还把 ledger 里 **34 条延期 Minor 逐条分诊**（结论：没有一条是 1a 的承重项），并列出 11 条「不予判定」项（1b/1c/第 2、3 期）。
- **Ruling 46（最终复核的 3 条 Important + 1 条护栏，2026-10-13）**：全部接受并作为**一次修复波**派发（不按条拆开）：**I1** 账号端口 `list()` 缺默认槽、`active` 判错（用户真实配置下 CC 会看不到正在服务的账号、OC 直接是空列表）→ 单源化哨兵词汇 + 两个端口都合成默认槽；**I2** opencode 从设置文档读内联 `apiKey` 却未声明为 secret 槽（不脱敏、会明文下发到设置客户端，且与它自己的额度路径不一致）→ 整条配置面删掉，凭据来源只剩 stored → environment；**I3** `autoSwitch` 写了但从没读（开关无效且偏离旧插件语义）→ 在 `accountStateOf` 里认它；**护栏** `finish()`/`messagesStop()` 不查 `#finished`（畸形网关发两个终止事件会产生两条 finish）→ 补守卫。依据：这三条都是**下一期（1b 页面）会直接构建在其上的契约**，而 I1 在用户现有配置下已经真实错位。**若判断错误**：改动集中在两个账号端口与一个配置面，回退成本小。
- 最终修复波完成，提交 `2e71aed`（11 文件，596 插入 / 97 删除），`pnpm typecheck` 干净、`pnpm test` **205/205**（+10 条新测试、改 4 条旧断言）、`pnpm build` 通过；5 次变异各自恰好失败对应测试。scoped re-review dispatched（agent `538f8d30-…`）。
- **控制器留档（清理项，未执行）**：实现者做变异检验时在 `D:\work\mut` 留了一个仓库副本（含指回本项目 `node_modules` 的 junction）。它的删除被 dsh-safety 以「确认删除区」拦下，实现者按规则没有绕行；仓库 `node_modules` 已核对完好（14 条目）。处置需用户显式批准（先摘 junction 再 safe_delete）。同类残留还有更早的 `C:\Users\me\AppData\Local\Temp\dsh-prefix-probe-166099379`。
- Task 13: minor (deferred，收尾分诊)：① `quota.ts` 的 `MISSING_CREDENTIAL` 分支丢掉了原始错误（旧插件两个分支都挂 `cause`，仅影响诊断）；② `{usage:{data:{...}}}` 这类「`usage` 仍是对象」的漂移仍会被当成干净空读数（空形状不是可证明的防漂移）；③ `protocol.ts` 成功路径上留了一个 abort 监听器注册（`{once:true}` 只在真正 abort 时触发；正常路径每次尝试新建 recorder，所以有界）；④ 空白密钥被判为缺失，而旧插件 `!key` 会当成存在并发出 `Bearer    `；⑤ 浅层 payload（窗口键在顶层）被接受，旧插件不接受；⑥ `accounts.ts` 把 `refOf` 读不出的条目也计入 `MAX_ACCOUNTS`；⑦ 一处 `.rejects.not.toThrow(/transport failure/)` 断言偏弱（承重断言在相邻行）。
- Task 13: 与 Task 12 复核并行启动（只新增 `opencode/{quota,accounts}.ts` 与其测试，与在途文件零交集；依据 Ruling 34/36 的并行先例）。
- Task 11: **complete** (commits `27fc044`, `f85a298`)。
- Task 11: minor (deferred)：新测试里 403 与普通 state 不匹配的响应逐字节相同，第 ④ 步单独不能区分「被代际护栏拒绝」与「落在新 server 上 state 不匹配」——承重证据是第 ⑤ 步与 `whoamiAuth`/`stored` 的顺序；测试也没断言自己的前提（该连接确实在 `#closeCallback` 之前被**第一个** server 接受）。另：缺少 denial-receipt（`access_denied`）分支的测试；同一次尝试重复投递现在返回 403 而非 200（有意的仲裁结果）；`checkPortAvailable` 的探测-绑定 TOCTOU；`startPortDefault`/`portAttemptsDefault` 返回被覆盖后的值而非常量；`CommandCodeLoginReason` 导出无消费者；多数 socket 测试占用 5959–5968 固定窗口。
- **携带到 Task 14 的约束（Task 11 结论）**：登录得到的 ref 由**可变的 `userName`** 推导（`userId` 已解析但未使用），可能与既有账号的凭据槽撞名 —— 组装层（`storeKey` 的实现）必须自己判定：撞名时改分配新 ref 或拒绝，不能静默覆盖别人的槽。
- **Ruling 36（并行执行，2026-10-13）**：Task 12（`src/vendors/opencode/**` + 新增依赖）与 Task 11 修复（`login.ts`）文件不相交，继续并行；实现者报告里出现的「repo 级 typecheck/test 红」属于对方**在写的中间态**，判定以各自文件与本任务提交时的快照为准。
- Task 10: fix round 2/5 复审结论 = **ADDRESSED，无新增 Critical/Important**；复审在仓库外的临时副本里把 `accounts.ts` 还原到 `4fe97dd` 复现了缺陷（交错时出现 `[R, R]`），证明新测试是真的；并额外用 20ms 真实延迟探了一条不同时序，结论一致。
- Task 10: **complete** (commits `d7dce69`, `4fe97dd`, `f9e7091`；2 条 Important 修复 + 1 条修复引入的 Important 回归修复，全部复审通过)。
- Task 10: minor (deferred)：交错测试里 `expect(settings.mutations).toHaveLength(1)` 比要求更严（假实现会在冲突检查前记账，另一种时序下 mutations=2 而 entries=1，会误报）；失败的并发 `add` 会静默丢弃自己的 key 并返回 `configured:false`（这是修复规定的行为，视图诚实）；`#mutate` 新增了「空 ops 不写」的路径（目前只有 `add` 能触发）。
- **携带到 Task 14 的契约（Task 10 fix round 2 结论）**：重放的 `apply` 必须**按 `intent.ref` 对齐**，ref 已在文档里就视为已提交；**不得**让 `add` 去重写凭据槽（会覆盖已有 key）——补填密钥必须是显式的 `credentials.set`/`replaceKey` 步骤。
- **控制器留档（清理项，未执行）**：复审在 `C:\Users\me\AppData\Local\Temp\dsh-prefix-probe-166099379` 留了一个临时副本，其中 `node_modules` 是指向本项目 `node_modules` 的目录联接。用 trash 通道移动它可能牵连真实依赖，因此**未删除**；它在 `%TEMP%` 下，收尾时告知用户手动清理更安全。

- Task 9: fix round 1/5 —— 复核结论 **Needs fixes**（1 Critical + 2 Important），全部接受：① Critical：Messages 传输重复发出终止 `finish`（`message_delta` 与 `message_stop` 各发一次，`StreamAssembler.finish` 无幂等护栏），宿主取最后一个 → 每次 Claude 轮次终止原因错误，且 `max_tokens` 截断时会保留半个工具调用块（宿主只在该原因下丢弃它）；② Important：Messages 的 usage 忽略 `message_start`，导致输入 token/cache 记为 0（违反「缺失字段不得当 0」）；③ Important：4xx 文本扫描被收窄到 `parsed.message`，纯文本 400 或 `detail` 字段会分类为 `undefined` → 不标记账号、不轮换；同样收窄还会丢掉 429 位于 `error.message` 之外的 reset 证据。
- **Ruling 21（Task 9 fix round 1 范围，2026-10-13）**：修复范围 = 上述 3 条 + 控制器额外授权的一条小修（`adapter.ts:307-309` 构造了 missing-credential 的拒绝却从不记录，导致无密钥账号每次请求都被重新选中）。其余 Minor 一律进 ledger、留给收尾分诊。依据：Critical/Important 必须修；那条小修与同一文件同一路径、成本一行，且不修会让「无密钥」状态每请求重试一次。**若判断错误**：修复轮 diff 略大，但都在同一模块内。
- Task 9: fix round 1/5 复审结论 = **四条 findings 全部 ADDRESSED，但修复引入 1 条 Important 回归** → 进入第 2 轮：Messages 流在缺少 `message_stop` 时一个 finish 都不发（触犯宿主 `invariant.js:59`「流未以终止块结束」，修复前该路径是合法的、旧插件此处抛可重试的 `STREAM_CLOSED`/`EMPTY_RESPONSE`）。
- **Ruling 22（Task 9 fix round 2 范围，2026-10-13）**：同意把「流结束但未发终止块时补发唯一 finish」同时应用到共享 `decodeStream` 的 openai 与 cli 解码路径。依据：同一缺陷、同一宿主后果（`invariant.js:59`），复审虽把它列为「pre-existing/out-of-scope」，但留着就是明知的不变量违规。**若判断错误**：修复 diff 稍大，但三处共享同一段收尾逻辑。
- **Ruling 23（Task 9 复审 out-of-scope 项，2026-10-13）**：`clearCredentialRejection` 在 `src/` 里**没有任何调用方**（只有测试用），意味着密钥后来通过环境变量/auth.json 补齐后，该账号在 `RotationEngine` 生命周期内仍被排除。决定：接线归 Task 14（在凭据变更事件上调用它），并写进 Task 14 的 brief；本期不新增其它事件源。**若判断错误**：用户在会话内补上密钥后需要重启才恢复该账号。
- Task 9: fix round 2/5 复审结论 = **All findings addressed，无新增 Critical/Important breakage**（EOF 补发 finish 对三种协议都生效；正常终止/EOF/已终止/空流/中途报错/调用方中止各路径都恰好一条 finish 或正确地无 finish；`#finished` 护栏双向都被测试钉住）。复审同时给出两条 Minor。
- Task 9: fix round 3/5 复审结论 = **两条全部 ADDRESSED，无新增 Critical/Important**。复审用四个只读 node 探针验证了：内容台账在三种协议下都不会误判（reasoning-only / usage-only / 缓冲工具调用都不算空）、空流错误在早退/中止/空闲超时路径上不会误触发、抛错与宿主不变量不冲突（宿主把适配器抛错转成唯一终止块且 `error`/`aborted` 豁免打开块检查）、排空不会重复关闭宿主索引。
- Task 9: **complete** (commits `4f587af`, `97e89d0`, `ef0f633`, `8ec18c7`, `5860601`；1 Critical + 2 Important + 2 授权项 + 2 追加项全部修复并复审通过，共 3 轮修复)。
- Task 9: minor (deferred，收尾分诊)：① EMPTY_RESPONSE 路径上 `message_start` 的 usage 被丢掉（旧插件会在抛错前冲刷，影响失败尝试的 token 记账）；② `messagesStop()` 不排空打开块，若网关跳过 `content_block_stop` 仍会撞 `invariant.js:53`（pre-existing）；③ `finish()`/`messagesStop()` 都不校验 `#finished`，格式异常的网关发两个终止事件会产生两条 finish（pre-existing）；④ 正常终止但零内容的流仍然以 `{kind:"stop"}` 收尾（本轮被明确授权「真实终止事件不要动」）；⑤ 空流只交给宿主重试策略、适配器内部不轮换账号（`adapter.ts` 对非超时 `LlmError` 返回 undefined）。
- Task 9: 另一处 minor (deferred)：`message_delta` 不带 usage 时会报 `message_start` 的占位输出 token（与旧插件一致）；`failures.ts` 用 rawText 判 weekly（只影响诊断文案）。

- Task 9: dispatched（implementer agent `5d234415-39e6-4457-81e2-442db0e1b858`），BASE = `15ae164`。
- Task 9: 实现完成，状态 DONE，提交 `4f587af`（5 文件：`protocol.ts` 902 行 / `failures.ts` 214 / `catalog.ts` 123 / `adapter.ts` 493 / 测试 202 行；`pnpm typecheck` 干净，`pnpm test` **85/85**）。宿主 `LlmAdapter` 实测**只有一个抽象成员** `stream(options: GenerateOptions)`；另外覆盖了 `listModels`/`resolveModel`/`providerInfo`/`providerRetryPolicy`。轮换循环只用 `MAX_TRIED` + `rotation.fallbackAllowed` 作为停止/切换条件，Ruling 12 的白名单已落实且两个超时码不被降级。
- **Ruling 17（Task 9 concern 1：我自己的 brief 内部矛盾，2026-10-13）**：brief 的 429 用例给 `reset: 1_800_000_000`（≈94 天后）却同时要求「超过 30 天丢弃」；实现者选择「只对散文里的 ISO 时间戳设上限、显式字段直接信任」。决定：**上限对两条路径统一生效**（显式秒字段与散文 ISO 一视同仁，超过 now+30 天一律丢弃）。依据：一个单位搞错或伪造的超远 reset 会把健康账号无限期踢出轮换 —— 这正是该护栏要防的静默故障；被丢弃的代价只是按短冷却重试、窗口真恢复后自愈。**若判断错误**：真实存在 >30 天窗口时会按短冷却重试而非停用该账号。已派修复轮（改 `failures.ts` 统一上限 + 把用例改成近未来并新增「90 天后 reset 被丢弃」的钉子）。
- Task 9: **Ruling 18（concern 2）**：旧插件的 ~600 行已知模型表（`KNOWN_EFFORTS`/`KNOWN_IMAGE_MODELS`/输出上限）**不在第 1 期移植**。依据：第 1 期范围是「共享内核 + 账号中心」，能力信息优先采用目录自报字段，未知就保持未知。代价：目录未声明推理档位的模型在本期不会提供档位选择，第 2 期补。
- Task 9: **Ruling 19（concern 3）**：`stream()` 本期**不拉目录**（无 TTL 缓存），因此协议选择不参考目录的 `supported_endpoints`、`maxTokens` 用配置默认值。依据：传输层已有 403→CLI 回退与多传输解码，本期可用；TTL 缓存与按模型上限列入第 2 期。代价：个别模型的传输可能需要一次回退才会成功。
- Task 9: **Ruling 20（concern 4）**：`CommandCodeAdapterDeps` 增加两个**可选**注入点 `resolveStored?` / `resolveEnvironment?`（brief 第 5 条要求把读取函数注入而不是直接依赖 ctx）—— 接受，计划里六個具名字段保持原名原类型；Task 12 照抄同构。

- **Ruling 14（执行方式，2026-10-13）**：Task 8 的实现者派发**连续三次启动即失败**（前两次留下 "I'll start by reading the task brief." 后中断，第三次无任何消息）。诊断过程：① 最小探针 `ROUTE_OK` 成功；② 「只读 brief 并回报行数」的探针成功（81 行）—— 说明通道与文件都正常，故障落在该次具体派发上。第三次尝试**其实已经写完两个文件**（20:05–20:06），只是死在提交前。处置：控制器亲自 `pnpm typecheck`（干净）+ `pnpm test`（**74/74**，其中 recovery 11 条）验证后，**原样**代为提交为 `749ffb0`，并在提交正文里写明「实现者死亡、控制器验证并提交孤儿产物」；随后照常派独立复核。**若判断错误**：这份代码没有实现者自述报告，复核者只依据 diff 判断 —— 已在复核提示里显式说明这一缺项，并允许它自行跑该测试文件。
- Task 8: 产物 `src/core/recovery.ts`（197 行）+ `tests/core/recovery.test.ts`（210 行 / 11 测试），提交 `749ffb0`。实现要点：每次方法都「读全量 → 改全量 → 写全量」，不缓存；`settle` 对不存在的 id 不落盘；`replay` 用 `attempted` 集合保证同一次调用内每条意图只尝试一次，逐轮落盘，`MAX_REPLAY_ROUNDS = 4`。
- Task 8: 复核结果 = **Approved，但含 1 条 Important**（复核还自行跑了 `pnpm vitest run tests/core/recovery.test.ts` → 11/11 通过）。六条必需行为全部被非空转测试钉住；`ReplayReport.unknown` 的语义经裁定自洽（代码数「unknown 判定次数」，用 `attempted` 保证一次调用内每条只计一次；与计划测试的 `{applied:1,rejected:0,unknown:1,remaining:1}` 一致）。
- **Ruling 15（Task 8 的 Important 处置，2026-10-13）**：`IntentLog` 的 `append`/`settle`/`replay` 写路径必须**串行化**（内部 promise 链），并把 `:10-11` 与 `:99` 的文档改成真实保证（实例内写串行；仍然要求每个 store 只有一个 `IntentLog` 实例，跨进程写者不在保证范围）。依据：并发 `append` 会静默丢一条意图，而本模块存在的意义就是「不丢账号操作」；复核给出的另一选项（只写文档声明单写者前置条件）对 UI 快速连点/多标签页场景不够。**若判断错误**：多一层串行化开销（可忽略），换来的是并发下不丢意图与测试钉住。
- **Ruling 16（执行方式续，2026-10-13）**：修复轮也派发失败（同样启动即死），但**失败前已改了文件**：它写好了文档改动、`#chain` 字段与 `append`/`settle` 包装，却没定义 `#serialize`（文件编译不过）、也没动 `replay`。处置：控制器读完该 diff，补上 `#serialize` 实现（`.then(work, work)` + 链尾吞错，保证一次失败不卡住后续、错误仍抛给本次调用方）与 `replay` 每轮落盘的串行包装，跑 `pnpm typecheck`（干净）与 `pnpm test`（**77/77**，新增 3 条确定性并发测试，用「闸门存储 + deferred」固定交错点，不依赖计时器），提交 `15ae164` 并在提交正文里写明「两段式产出」。**若判断错误**：串行化粒度选错（例如把整个 `replay` 也串行）会导致 `apply` 内部调用 `append` 自锁 —— 我特意只串行「每轮落盘」，并已在复审提示里点名要复核这个死锁风险。
- Task 8: fix round 1/5 复审结论 = **All findings addressed, no new Critical/Important breakage**。复审独立验证了：`#serialize` 在一次写失败后链仍可用且错误仍抛给本次调用方（用 500ms 看门狗 + 越界复现脚本验证）；**不会自锁**（`apply` 在串行段之外调用，`apply` 内部 `append`/`settle` 安全；把整个 `replay` 串行反而会死锁，所以「只串行每轮落盘」是必需的粒度）；三条新测试在修复前**确实会失败**（越界重放修复前函数体得到 `["b"]` / `["1","2"]` / `["1","2"]`，期望分别是 `["a","b"]` / `["2"]` / `["2"]`）。
- Task 8: **complete** (commits `749ffb0`, `15ae164`；1 条 Important 已修并复审通过)。
- Task 8: minor (deferred)：`#serialize` 的 `onRejected` 分支不可达（`#chain` 永不被拒绝），仅是清晰度问题。
- **携带到 Task 10/13 的约束（Task 8 复审发现）**：`IntentLog` 的「一份存储只配一个实例」是**文档化的前置条件、没有任何地方强制**；Task 10/13 接线时必须保证每个设置命名空间只构造一个 `IntentLog`，否则整份覆盖仍会丢意图。另：并发两次 `replay` 可能对同一意图各应用一次（`attempted` 是每次调用独立的），所以调用方的 `apply` 需要幂等。

- Task 7: dispatched（implementer agent `fbf13c59-7b04-4a83-ac03-04083702af75`），BASE = `90f05b0`（注意：控制器的文档提交 `17279f3` 落在其后，复核范围用 `17279f3..6b41111`）。
- Task 7: 实现完成，状态 DONE，提交 `2ac5bf5`（模块 + 13 测试）+ `6b41111`（自审补 2 条测试）。错误用宿主 `LlmError`（含 `ABORTED`），并核实宿主按 own property `code`/`failure` 归类、不依赖 `instanceof`。
- **Ruling 11（打包，2026-10-13，来自 Task 7 concern）**：tsdown 默认只把 `dependencies` + `peerDependencies` 视为外部依赖，宿主包现在只在 devDependencies 里，会被**内联**进 `lib/`。对 `LlmError` 无碍（宿主只读自有属性），但 Task 9/12 要 **值导入** `LlmAdapter`，若宿主用 `instanceof` 判断，内联的第二份副本会破坏它。决定：Task 14 把宿主包声明为 **peerDependencies**（析取范围 `0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-alpha.2`），保留 devDependencies 供本地 typecheck，并**验证 `lib/` 里是对 `@deepseek-ai/*` 的裸导入而不是内联代码**（grep 检查，写进 Task 14 的验收步骤）。依据：旧插件就是这么发布的（`lib/` 里是裸导入）。**若判断错误**：宿主侧出现两份 `LlmAdapter` 类导致适配器注册被拒 —— Task 14 的 grep 检查会先暴露。
- **Ruling 12（超时重试，2026-10-13，来自 Task 7 concern）**：`LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` 不在宿主的 `DEFAULT_RETRYABLE_CODES` 里，默认策略不会重试超时，而设计 §10 要求超时可重试。决定：**保留这两个具体错误码**（它们区分「整请求超时」与「流空闲超时」，对诊断有价值），由 Task 9/12 实现 `providerRetryPolicy()` 覆盖，把这两个码（以及既有的可重试码）列进 `retryableCodes`。依据：旧 Command Code 插件正是用 `providerRetryPolicy` 覆盖重试白名单。**若判断错误**：超时变成一次性失败，用户需要手动重发。
- Task 7: **complete** (commits `2ac5bf5`, `6b41111`；review clean — Approved，0 Critical / 0 Important，6 Minor)。复核确认：两个预算各自独立定时器、各自携带中断类型（不靠比时钟推断谁先触发）；`finally` 在全部 6 条退出路径上清定时器 + 摘监听器；`Promise.race` 给两侧都挂了处理器，避免被放弃的 `next()` 迟到拒绝变成 unhandled rejection；三条必需行为都有不会空转的测试（含「观察到的定时器峰值 ≥2」这种反空转断言）。
- Task 7: 复核⚠️项：因本模块在计划里被要求注入 `now`，Task 9/12 必须把**宿主运行时持有的同一个 signal** 传进 `runStream`（这条写进 Task 9/12 brief）。
- **携带到 Task 9/12 的事实**：`ABORTED` 只在 `src/core/transport.ts` 内部（未导出），适配器识别「调用方中止」时必须**硬编码字面量 `"ABORTED"``**；另外宿主 `LlmError` 按自有属性 `code`/`failure` 归类（不依赖 `instanceof`），所以内联副本不会破坏归类（复核已核实 `lib/types/error.js:17`、`lib/types/index.js:93`、`lib/index.js:402-405`）。
- Task 7: minor (deferred)：截止时间已触发后再到达的 abort 会报 `LLM_REQUEST_TIMEOUT` 而不是 `ABORTED`（宿主仍按 aborted 归类，只影响本模块契约）；abort 若恰好发生在 `source[Symbol.asyncIterator]()` 内部会被漏掉（监听器注册晚于该调用）；`deadlineAt` 早于定时器布置；未 `unref()`（「无限预算」的废弃流最多持有约 24.8 天）；`:271` 是全套里唯一依赖真实时间流逝的测试（可用 `advanceTimersByTimeAsync` 变确定）；`:140` 的 10ms 空闲在慢机器上可能「报对了码但理由错」。

- Task 5: dispatched（implementer agent `50430a2d-e588-4721-af8f-3d0c9ea0fac2`），BASE = `d212702`。
- Task 5: 实现完成，状态 DONE_WITH_CONCERNS，提交 `c049494`（3 文件 +396，18 条测试）+ `baf71bc`（自审发现注释错字）。`RotationEngine` 的候选顺序 = 规则命中 → 固定 → 顺序，被阻断的候选继续下探而不是直接返回 undefined；拒绝表存 `{rejection, expiresAt}` 并惰性过期；`server`/`network` 完全不进拒绝表。
- **Ruling 9（Task 5 concern #1，2026-10-13）**：`MAX_TRIED = 16` 由**调用方**（请求循环，Task 9/12）强制，而不是在 `pick` 内部按 `tried.size` 截断 —— 因为 `tried` 可能含 `order` 之外的 ref，按大小截断会误报「没有可用账号」。已执行的落地动作：把「请求循环必须在 MAX_TRIED 次尝试后停止轮换」写进 Task 9/12 的 brief。**若判断错误**：某些异常序列下轮换次数可能多于 16（有 `tried` 去重兜底，不会死循环）。
- Task 5: **complete** (commits `c049494`, `bbf71bc`, `b9914ad`; review clean — Approved，0 Critical / 0 Important，6 Minor)。复核逐行确认六种 `FailureKind` 的裁决表都已实现且被测试钉住（含修正后的 rate-limit 行与半开区间边界），`pick` 的候选顺序用 `continue` 下探而非终止，`server`/`network` 既不记录也不清除既有条目，`fallbackAllowed` 四个象限都有测试。
- Task 5: 复核 ⚠️ 项已由控制器确认：`dropAccount` 确实会删除该账号的规则并在其被固定时把 `pinned` 置空（Task 4 的实现与测试已钉住），所以「规则/固定引用可能不在 order 里」确实不可达。
- Task 5: minor (deferred)：`rejections()` 返回内部对象引用（`Rejection` 字段非 readonly），调用方改动会污染决策表；建议返回副本。建议在请求内核消费本模块时顺手修。
- Task 5: minor (deferred)：`rejectionExpiry` 的穷尽性只靠 `number | undefined` 返回类型，新增第 7 种 `FailureKind` 会静默落入「永不过期」分支且不报编译错；建议加 `never` 兜底（`TRANSIENT_KINDS` 同样需要更新）。
- Task 5: minor (deferred)：`failures.ts` 的 `AccountScopedFailureKind` 与再导出无消费者；`RATE_LIMIT_COOLDOWN_MS` 的值没有被测试钉住；没有测试传入含 `order` 之外 ref 的 `tried` 集合（Ruling 9 的「不由 pick 截断」因此未被测试保护）。
- Task 5: minor (deferred)：过去的 `resetAt`（时钟偏移或 `Retry-After: 0`）会得到已过期条目、下一次请求立刻重选该账号；`Math.max(resetAt, now)` 更防御，但与裁决的字面语义冲突，留待收尾决定。
- Task 6: dispatched（implementer agent `5decf64d-91d6-4360-8cfa-c6418753f479`），BASE = `b9914ad`。
- Task 6: 实现完成，状态 DONE，提交 `90f05b0`（`src/core/catalog.ts` + `tests/core/catalog.test.ts`，2 文件 178 行，12 测试；未触碰任何已关闭模块）。规则 1 用 `override !== undefined`（按存在性判断，不是真值判断），所以显式 `false` 能压过白名单命中。
- Task 6: **complete** (commit `90f05b0`, review clean — Approved，0 Critical / 0 Important，6 Minor)。复核确认：无优先级反转、未从不可信输入接受非布尔值、`selectVisible` 不修改入参且保序。
- **已转成计划约束的 Task 6 风险**：`normalizeVisibility` 保留空串，而 `[""]` 是「非空白名单」，会让**所有模型消失**。已写入计划 1b 说明：1b 写 `visibleModels` 前必须丢弃空/纯空白条目。
- Task 6: minor (deferred)：`catalog.ts:73` 的 `visibility.modelVisibility?.[entry.id]` 会沿原型链取值 —— 若模型 id 恰为 `toString`/`constructor`，规则 1 会返回非布尔真值（实际厂商 id 不可达）；建议用 `Object.hasOwn` 或 `Object.create(null)` 硬化。
- Task 6: minor (deferred)：`normalizeVisibility` 不是规范形（显式空数组保留、全非法对象丢弃），只有未来任务对它做 `toEqual` 或回写设置时才有影响。
- Task 6: minor (deferred)：计划自带的第 3 条测试（`normalizeVisibility({ m: "yes" })`）是空转的（该对象两个键都没有），真正钉住行为的是实现者补的那条；`Visibility.visibleModels` 是可变 `string[]`；`normalizeVisibility` 不改入参这一点只有代码可读性、无测试。

- Task 4: dispatched（implementer agent `a0c25975-a5e8-402b-bfaa-1a053d90d88f`），BASE = `047c885`。
- Task 4: 实现完成，状态 DONE，提交 `d212702`（`src/core/accounts.ts` 134 行 + `tests/core/accounts.test.ts` 106 行 / 10 测试；`adapter.ts` 未动）。`accountRef` = `DSH_LLM_ACCOUNT_<转义厂商>_<转义标签>_<FNV-1a-64 前 12 位十六进制>`，对原始 `(vendor,label)` 取哈希，保证转义后同名也得到不同 ref；产物始终匹配 `^[A-Za-z_][A-Za-z0-9_]*$`。
- **携带到 Task 10/13 的约束（实现者披露，需保留）**：① ref 必须在 `add` 时**只生成一次**并持久化，改名只改 label、**绝不重新推导 ref**，否则已存状态（顺序/规则/固定/凭据槽）会脱钩；② 哈希后缀是无条件碰撞护栏，不要缩短；③ `assignModelRule` 是追加而非按账号合并，消费者必须**按模型**查规则（Task 5 的 `pick` 正是如此），不能按账号查。
- Task 4: **complete** (commit `d212702`, review clean — Approved，0 Critical / 0 Important，7 Minor)。复核独立复算（一次性 `node -e`，未写文件）逐字节复现了报告里的两个示例 ref，并验证产物匹配凭据引用名正则；另确认 `reorder` 的「最终位置」语义无 off-by-one、`dropAccount` 只清自己的规则与指向自己的固定标记。
- Task 4: minor (deferred)：`accountRef` 的 JSDoc 没写「add 时生成一次、改名不重推」这条护栏（护栏已在 ledger 与 Task 10/13 brief 中，但模块本身没写）；`tests:199` 注释与紧邻断言矛盾；`tests:247` 名称说「原样返回」但实现返回副本；`accounts.ts:65` 的 `?? 0` 不可达；纯度测试没覆盖 `assignModelRule` 的 `models` 入参拷贝；`assignModelRule` 不对 `models` 去重；ref 长度无上限（若凭据槽名有长度上限才有影响）。

- Task 3: dispatched（implementer agent `a95e139d-3493-486e-b65d-72b94b80dfcd`），BASE = `af90093`。
- Task 3: 实现完成，状态 DONE，提交 `047c885`（2 文件 / 86 行）：`pickApiKey` 单一有序表实现优先级、`normalizeKey` 把非字符串/空串/纯空白判为未配置（落地 Review Focus 3）。实现者主动多加了第 4 条测试覆盖 `normalizeKey` 的 `unknown` 窄化分支（复核判定为正当覆盖，不是范围蔓延）。typecheck/test 全绿（3 文件 7 测试）。
- Task 3: **complete** (commit `047c885`, review clean — Approved，0 Critical / 0 Important，3 Minor)。
- **携带到 Task 9/12 的约束（来自 Task 3 复核的跨任务提醒）**：`pickApiKey` 的 `literal` 来源**只能**取自组合配置里 `apiKey`（`role("secret")`）那种非持久化字段，**绝不能**从设置文档里读或写明文密钥 —— 否则违反 Global Constraints 的「密钥只进凭据服务」。写 Task 9/12 brief 时要把这条写进去。
- Task 3: minor (deferred)：`tests/core/credentials.test.ts:5-19` 没有把 `environment` 与 `authFile` 同时给出，调换 `credentials.ts:49/:50` 两行仍然全绿；补一条断言即可。
- Task 3: minor (deferred)：RED 证据是模块解析错误（0 test 执行），无法证明断言本身可失败；新建文件任务的 brief Step 2 预测应改为「模块不存在」。
- Task 3: minor (deferred)：`credentials.ts:9` 的联合类型顺序与 `:46-51` 的实际优先级表靠约定保持一致，建议用 `const PRECEDENCE = [...] as const` 单一来源。

- Task 2: dispatched（implementer agent `c706f6c2-196b-485f-bb71-539c14eeb213`），BASE = `a1da884`。
- Task 2: **complete** (commit `cf6784e`, review clean — Approved，0 Critical / 0 Important，5 Minor)。复核独立核实了 Ruling 7：`RequestOptions` 在 `@deepseek-ai/dsh-llm@0.2.0-rc.2` 的 .d.ts 里 0 命中，`GenerateOptions` 在 `lib/types/types.d.ts:489` 并由 `lib/types/index.d.ts:20` 导出，`LlmAdapter` 同包导出（`index.d.ts:130`）。
- Ruling 8（Task 2 复核 Minor 1 的处置，2026-10-13）：`CredentialPort` 目前只有 `resolve`/`set`/`unset`，缺少规格 §4.1 列的 `describe`；而 `AccountView.configured` 必须靠它填充，所以计划 1b 的「已配置」状态也依赖它。决定：**不改已复核通过的 Task 2 文件**，把扩展交给 **Task 10**（第一个必须填充 `configured` 的任务）——在该任务里给 `CredentialPort` 加 `describe(refs: string[]): Promise<Record<string, { configured: boolean; writable?: boolean }>>` 并附测试，Task 13 复用。依据：Minor 不进修复循环，且首个消费者拥有该扩展最自然。**若判断错误**：Task 10 多一处小改动；反过来若现在不改，Tasks 10/13 会各自发明读取「是否已配置」的方式。
- Task 2: minor (deferred) 其余四项：`QuotaWindow.percent` 应写明 0–100 且 `used`/`cap` 的单位要由 `key` 明确（并入 Task 10/13 的 brief）；`ModelRule.account` / `AccountState.order` / `pinned` 应注明是 **ref 标识空间**（并入 Task 4 brief）；`VendorAdapter.llm` 是规格未列字段（无消费者，收尾时再定）；测试名「reorder 未声明时」的用例实际声明了 `reorder: false`，缺 `modelVisibilityWrite` 用例（收尾时再定）。
- Task 2: 复核 ⚠️ 项由控制器确认：(a) `exports` 的四个子路径来自 Task 0（已核）；(b) 宿主 `peerDependencies` 析取范围不在本 diff，属 Task 14 打包范畴；(c) `SettingsOp` 与宿主 settings op 词表的翻译由接线任务负责；(d) typecheck/test/build 未复跑，按流程采信实现者报告。
- **Ruling 7（Task 2 报告与规格 §6.3 冲突，2026-10-13）**：实现者指出 `@deepseek-ai/dsh-llm@0.2.0-rc.2` 中**不存在** `RequestOptions`，宿主真实请求类型是 `GenerateOptions`（两个旧插件的 `stream(options)` 也用它）。决定：采纳 `GenerateOptions`，并**改正规格 §6.3**（`TransportPort.stream(options: RequestOptions)` → `GenerateOptions`）—— 规格是绑定权威，但它在这里写错了宿主类型，实现者的事实核查优先。依据：§6.3 的意图是"引用宿主请求类型"，而非某个特定名字。**若判断错误**：若宿主在其他版本里改回别的名字，Task 9/12 只需改这一处签名。
- Task 2 待复核的 9 条自述判断（交由任务复核裁定，控制器已裁决第 1 条）：② `VendorAdapter.llm` 是规格未列的附加字段；③ 额外导出 `SettingsOp`/`SettingsSnapshot`；④ `QuotaWindow.resetAt` 为 epoch ms（Task 10/13 需把 ISO 字符串转 ms）；⑤ `LoginStatus` 词表取自旧插件；⑥ `CredentialPort` 用 resolve/set/unset；⑦ `AccountView` 保持 4 字段；⑧ `CatalogPort.list()` / `QuotaPort.snapshot()` 方法名自定；⑨ 测试从 vitest 显式导入。

- Task 0: dispatched 2026-10-13，implementer agent `64862ded-cc19-4293-ac85-4767184c1416`；BASE = 无（本任务创建仓库的首次提交），复核范围 = 首次提交自身。
- Task 0: 实现完成，状态 DONE_WITH_CONCERNS，提交 `609a477`（分支 `work`，根提交，10 文件 / 2272 行）。`pnpm typecheck && pnpm test && pnpm build` 三条全绿，vitest 1 passed，`lib/index.js` 存在；TDD 有 RED（`Cannot find module '../src/index'`）→ GREEN 证据；自引用解析 `import('dsh-llm-account')` 通过。
- Task 0: 控制器提交 `062a252`（我在子代理运行期间改的计划文档；子代理正确地没有提交别人的在途改动）。
- Task 0: 复核 dispatched，reviewer agent `2e07a6d3-a954-41a1-b20a-a9e77e03b881`；review package = `.superpowers/sdd/2026-10-13-dsh-llm-account-phase1-host/review-task-0.md`。
- **携带到 Task 14 的硬约束（来自 Task 0 的实测，勿丢）**：① `exports` 是扁平目标（`./lib/commandcode.js`、`./lib/opencode.js`、`./lib/client.js`），所以 Task 14 的 tsdown 必须用**对象**形式的 entry map（`{ index, commandcode, opencode, client }`），数组形式会产出 `lib/vendors/...` 并破坏这些路径；② tsdown 0.23.1 在 `platform: "node"` 下默认 `fixedExtension: true` 会强制 `.mjs`，Task 0 已显式设 `fixedExtension: false` 才得到 `lib/index.js` —— Task 14 不要把它改回去。
- **携带到后续任务的小项**：`@types/node` 解析到 `^26.6.5`（本任务命令未钉版本）而运行时是 Node 24.19.0；tsconfig 比最低要求更严（`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`、`noImplicitOverride`、`noFallthroughCasesInSwitch`），后续任务写代码要按此（类型导入用 `import type`）。
- Task 0: complete (commits 609a477..609a477, review clean — Approved，0 Critical / 0 Important)
- Task 0: minor (deferred): `@types/node` 是 `^26.6.5`，比声明的 Node 下限（`>=22.19.0`）与环境（24.19.0）都新；建议在收尾时钉到 `^24`（package.json:37）。
- Task 0: minor (deferred): `exports` 的扁平目标（`lib/commandcode.js` 等）是实现者推断、不是 spec 规定；设计文档只说 tsdown 产出 `lib/`。若 Task 14 发现更合适的命名，改 `exports` 与构建配置一起改即可。
- Task 0: minor (deferred): `vitest.config.ts` 把 include 收窄成 `tests/**/*.test.ts`，`src/` 下同目录测试会被静默跳过（当前计划无影响）。
- Task 0: minor (deferred): tsconfig 严格项（`noUnusedParameters` 等）对 cordis `apply(ctx, config)` 形状的签名会有前瞻摩擦，用 `_` 前缀即可。
- Task 1: dispatched，implementer agent `0cbb4d06-4667-4ce4-b108-197fe91f14a2`；BASE = `062a252`（HEAD at dispatch）。任务性质：纯文档（一条假设清单），不碰代码、不碰 profile、不启动 dsh。
- Task 1: 实现完成，状态 DONE，提交 `52e6814`（曾以 `911ffcc` 提交后 `--amend`，最终 SHA 以 `52e6814` 为准）。产出 `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md`（83 行）：两条硬事实（PATH `dsh` 0.1.1-rc.2 / 桌面引擎 0.2.0-rc.2）+ 三条假设（各含依据、验证步骤、错误的后果）+ 旧插件调用点形状（标注为控制器的只读调研）+ 计划 1c 必测清单。
- Task 1: 控制器提交 `7b8b5fa`（需求变更：设置页布局对齐 Command Code + 厂商标签页，改的是 spec/plan 文档）。子代理正确地没有把别人的在途改动混进自己的提交。
- Task 1: 复核 dispatched，reviewer agent `9ae28019-456b-44c8-bf6a-304749150e3e`；review package = `.superpowers/sdd/.../review-task-1.md`（range `062a252..52e6814`）。
- **携带到计划 1c 的待补项（来自 Task 1 的 concern 2）**：1c 目前没有写明「页面注册几次」的观测手段（devtools 还是宿主日志），写 1c 时必须补上，且需要用户在场配合 GUI。
- Task 1: 复核结果 = Needs fixes（1 条 ⚠️ + 无 Critical + 2 条 Important：③ 的 hooks 投影没有任何可证伪的检查；② 用「页面注册次数」当判定点无法区分 apply 跑了一次还是两次）。已记入 ledger 的延期 Minor（不进修复循环）：
  - minor (deferred): assumptions.md:21-22「写作本文档时读文件核对」把任务书已给的事实说成第一手复核，与 §3 的免责声明风格不一致。
  - minor (deferred): assumptions.md:24「本机没有这条观察通道」是推断却写成事实（桌面运行时是装着的，Electron devtools 可争议）。
  - minor (deferred): assumptions.md:31 把「Task 0 已写全 exports」当事实断言，超出本 diff。
  - minor (deferred): assumptions.md:32 把解析检查与具体导出名绑定，可能产生与解析无关的失败。
  - minor (deferred): assumptions.md:48 引入 `llm-account` / order 12 但未标注来源（应引 plan/spec §8）。
  - minor (deferred): assumptions.md:42/:50「不返工页面组件」「页面主体不动」是把设计预测写成定论。
- Task 1: **complete** (commits `52e6814`, fix `9704e54`; review clean after 1 fix round)。复审结论：两条 Important 均 ADDRESSED，无新增 Critical/Important。
- Task 1: minor (deferred，复审在修复 diff 里新发现)：`host-seam-assumptions.md:76` 把通道写成「`hooks` 键投影出的 `use<Key>`（或 1b 最终采用的那条通道）」，而 :49 把它特指为 hooks 通道；因为 1b 走兜底路径，这条可能被替代通道满足而 hooks 投影从未被真正检验。建议收尾时二选一：去掉括号内的让步，或把第 6 行拆成 6a/6b。
- Task 1: out-of-scope observation 已被控制器转化为计划改动（提交见下）：1b 必须留 `apply` 调试计数/日志 + 设置数据通道验证点；1c 必须补观测手段。依据是复审的 handoff fragility 提示。
- Ruling 6（流程，2026-10-13）：**本工作区禁止 `git commit --amend`**。原因：控制器与子代理会并发提交，实测已发生一次误 amend（实现者把控制器的 `7b8b5fa` amend 掉了）。事件与处置：实现者用 `git reset --soft 7b8b5fa` 恢复，控制器独立核验通过 —— `7b8b5fa` subject 与改动面完好（plan +4 / spec +4-1）、`52e6814` 仍是单文件 83 行、`9704e54` 只碰笔记文件、工作树干净、需求变更文字仍在（spec L243 / plan L871）。**若判断错误**：无实质代价，只是修复轮次各留一个提交、历史略长；反过来继续允许 amend 的代价是可能再次吞掉别人的提交。
  - 已执行：该约束写入每次修复轮次的派发消息；后续所有修复一律新增提交。
- Task 1: 复核者的 ⚠️ 项由控制器确认：plan/spec 的两处在途修改**早于**本任务（那是控制器的需求变更提交 `7b8b5fa`）；`.superpowers/` 是 gitignored 工作区，不属于交付物；`llm-account` / order 12 确实由 spec §8 与计划 Task 14 规定。
- Task 0 抽查：`lib/index.js` 与 `lib/index.d.ts` 存在 ✓（复核者的 ⚠️ 项已由控制器确认）。

### 追加裁决（Task 0 运行期间）

- Ruling 4（用户决定，2026-10-13）：**跳过宿主接缝实验**。用户选择「跳过实验」。事实依据：PATH 上的 `dsh` CLI 是 `0.1.1-rc.2`，而桌面端实际引擎是 `0.2.0-rc.2`（`runtime.json` 的 `desktopVersion`），旧 CLI 建的 profile 结论不可信；且客户端 `apply` 调用次数只能在真实浏览器里观察（`web_fetch` 不执行 JS）。已执行：Task 1 改写为「记录三条假设」的文档任务（含每条的验收方式与假设错误的后果）；Task 14 Step 3 的「一次性 profile 启动 + dsh web」替换为**假 ctx 装配测试**（断言两条 provider id 各注册一次 + 两个 Config 能解析用户现有配置形状），真机启动验收推到计划 1c（用户在场时做）；计划 1b 明确走兜底路径（页面按命名空间读两家数据，不依赖每实例注入状态）。**若判断错误**：1b 的页面数据源多写一层适配（成本已隔离在一个薄适配层内），真机问题推迟到 1c 才暴露。
- Ruling 5（宿主类型依赖，2026-10-13）：工作区没有 `@deepseek-ai/*` 宿主包（运行时由 profile 提供），后续任务无法 typecheck/单测。已在 npm 确认 `@deepseek-ai/dsh-*` 的 `0.2.0-rc.2`、`@deepseek-ai/schemastery@3.18.4`、`@deepseek-ai/cordis@4.0.4` 均存在。已执行：Task 2 增加 Step 0，把宿主包装成 **devDependencies**（版本对齐桌面端引擎），并说明 `VendorAdapter` 引用宿主类型时用 `import type`、值导入留到 Task 9/12。**若判断错误**：devDeps 版本与真实宿主不一致导致类型漂移 —— 缓解办法是 Task 14 的 `peerDependencies` 写成与插件一致的精确析取，并在计划 1c 真机验收时暴露。

### 补记：正文曾被后续编辑替换掉的 4 条裁决（内容据当时的执行记录补回，保证裁决清单穷尽）
- **Ruling 10（Task 5 concern #2，2026-10-13）**：`rate-limit` **有** `resetAt` 时按 `resetAt` 恢复，**没有**时才用 `RATE_LIMIT_COOLDOWN_MS`（与 `quota` 行对称）。我原 brief 的表格漏了这个从句，属于裁决不完整而非有意忽略。依据：旧 Command Code 插件就读取厂商的限流窗口重置时间。**若判断错误**：同一账号多一次失败尝试或轮换略延迟。已作为「复核前先修正的正确性 concern」派回原实现者（新增测试钉住两半与半开区间边界）。
- **Ruling 13（流程，2026-10-13）**：**实现者运行期间不要提交控制器的文档改动**，否则任务的 diff 范围会被夹进无关提交（Task 7 已发生一次，靠 `-- <paths>` 限定范围解决）。**若判断错误**：无实质代价，只是复核包要多一步范围限定。
- **Ruling 24（Task 9 fix round 3 范围，2026-10-13）**：不接受把两条 Minor 留给收尾，追加第 3 轮修复：**A** 空/截断响应不得伪装成正常收尾（旧插件抛可重试的 `EMPTY_RESPONSE`/`STREAM_CLOSED`，且我们自己的重试白名单里就有 `EMPTY_RESPONSE`）；**B** Messages 的 `tool_use` 块在 EOF 时未排空，导致补发的 finish 被宿主以 `invariant.js:53` 拒绝。依据：设计 §10「可重试错误交由宿主重试策略」+「明确错误而非静默成功」。**若判断错误**：用掉第 3 轮（上限 5），diff 仍在同一终止逻辑内。
- **Ruling 35（Task 11 fix round 1 范围，2026-10-13）**：接受复核对 login 代际隔离缺陷的判定与修法 —— handler 绑定自己的 `attempt` 与 `server`，settle/close 前要求 `this.#server === server && this.#ownsAttempt(attempt)`，并补一条「重新 begin 后向旧端口投递回调」的回归测试。依据：这是**凭据写入路径**（被取代的旧连接可能把密钥写进 state 不匹配的新尝试、并关掉正在用的监听器），属于必须修而非可延期。**若判断错误**：修复 diff 很小、仅限 `login.ts` 的 handler 闭包。


