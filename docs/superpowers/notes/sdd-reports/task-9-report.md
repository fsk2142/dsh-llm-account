# Task 9 报告 — commandcode 适配器 · LlmAdapter、协议、目录与失败映射

- 状态：**DONE**
- 提交：`4f587af feat(commandcode): adapter, protocol, catalog and failure mapping`
- 分支：`work`（父提交 `15ae164`；提交前确认控制器未在此期间提交，HEAD 未被吞掉）
- 验证：`pnpm typecheck` 干净；`pnpm test` → 9 文件 / **85 tests passed**（Task 8 结束时 77，本任务 +8）
- 工作树：提交后 `git status --porcelain` 为空

## 1. 实现了什么

四个新文件（只这四份 + 一份测试，`src/core/**` 未改、`src/vendors/opencode/**` 未碰）：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/vendors/commandcode/protocol.ts` | 902 | 端点/请求头/传输选择与回退/请求体构造/SSE→`StreamChunk` 解码 |
| `src/vendors/commandcode/failures.ts` | 214 | 状态+正文 → `Rejection` 分类表、分类 → 宿主错误码 |
| `src/vendors/commandcode/catalog.ts` | 123 | 目录负载 → `CatalogEntry[]`（坏行计数） |
| `src/vendors/commandcode/adapter.ts` | 493 | 宿主 `LlmAdapter` 子类 + `createCommandCodeAdapter` 工厂 |
| `tests/vendors/commandcode.test.ts` | 202 | 8 条测试（brief 的 7 条 + 裁决 12 的重试码断言） |

Produces 四个名字全部落地：`classifyCommandCodeFailure(status, body)`、`parseCatalog(payload) → { entries, ignored }`、
`catalogRequest(base) → { url, headers }`、`createCommandCodeAdapter(deps) → LlmAdapter`（外加类型 `CommandCodeAdapterDeps`、`CommandCodeConfig`）。

请求循环（`adapter.ts` `stream()`）：
1. `options.stop` 非空 → `LlmError(UNSUPPORTED_OPTION)`（旧插件第 7398 行同一条，宿主契约由适配器负责）；
2. `rotation.pick({ model, tried })` 选账号 → 该 ref 加入 `tried`；
3. 收集四个凭据来源（`literal` = 组合配置 `apiKey` 非持久化字段 / `stored` 注入读取 / `environment` 注入读取 / `authFile` 注入兜底）交给 `pickApiKey`；
4. 按模型选协议（`claude-*`/目录声明的 Messages 优先、`config.protocol` 可强制）→ 构造请求体 → `fetch`；
5. 403 `upgrade_required` → 同账号同一次尝试改用 CLI 传输重发一次（旧插件第 7512-7519 行）；
6. `runStream(decodeStream(...), { requestTimeoutMs, streamIdleTimeoutMs }, { signal: options.signal })` —— **宿主运行时持有的同一个 `AbortSignal`**（Task 7 结论①）；`ABORTED` 按字面量比较（结论②）；
7. 失败 → `classifyCommandCodeFailure` → `markRejected(ref, rejection)` → **只有 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真才换账号**，否则把错误抛给宿主；`tried.size >= MAX_TRIED(16)` 时停止并把最后一次失败抛出。

## 2. 宿主 `LlmAdapter` 的实际成员与签名

从 `node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts`（第 130-188 行）读取的真实抽象面：

| 成员 | 真实签名 | 本任务 |
| --- | --- | --- |
| 抽象 `stream` | `abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>` | 实现（完整请求循环） |
| `listModels` | `listModels(_provider: string): Promise<readonly LlmModelInfo[]>` | 覆盖：目录 → `selectVisible` → `{ provider, id, name, inputModalities }` |
| `resolveModel` | `resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>` | 覆盖：带 `context.contextWindow` / `defaultMaxTokens` / `reasoning.efforts` / `inputModalities`；目录不可用时退化成「只有 id」 |
| `providerInfo` | `providerInfo(provider: string): LlmProviderInfo` | 覆盖：`{ id: provider, name: "Command Code" }` |
| `providerRetryPolicy` | `providerRetryPolicy(_provider: string): ResolvedRetryPolicy \| undefined` | 覆盖（裁决 12）：`mode: "normal"`、`maxRetries: 1000`、backoff 500ms/900s/0.1，白名单含 `LLM_REQUEST_TIMEOUT`、`LLM_STREAM_IDLE_TIMEOUT` |
| `imageRequestPricing` | `imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing \| undefined` | **未覆盖**（基类默认 `undefined`；视觉 token 计价属第 3 期，见 concern 5） |
| `prepareCall` | `prepareCall(provider, model, signal?): Promise<PreparedAdapterCall>` | **未覆盖**（基类默认实现够用；本适配器不缓存「生成代」） |

结论：抽象面**并不**比 brief 假设的大 —— 只有一个抽象成员（`stream`）。其余都是可覆盖的非抽象方法，已按真实签名实现需要的那几个。

## 3. 逐行对照的旧插件行号

参照文件：`C:\Users\me\.dsh\profiles\desktop\node_modules\@mars-sea\dsh-commandcode-provider\lib\index.js`（只 grep + 分段读，未通读）。

**端点**
- `protocolEndpoint` 第 **6650-6653** 行：`cli → {apiBase}/alpha/generate`、`messages → {apiBase}/provider/v1/messages`、否则 `{apiBase}/provider/v1/chat/completions`。
- 目录：第 **6788** 行 `GET {apiBase}/provider/v1/models`。
- 基地址默认值 `DEFAULT_API_BASE = "https://api.commandcode.ai"`：第 **5361** 行；`COMMAND_CODE_CLI_VERSION = "1.79.2"`：第 **5360** 行。

**请求头**
- `connectGenerate` 第 **6720-6737** 行：
  - 共享：`Content-Type: application/json`、`...IDENTITY_ENCODING_HEADER`（第 **2915** 行 `{"accept-encoding":"identity"}`）、`Authorization: Bearer <key>`、`...attributionHeaders()`；
  - CLI 分支：`x-command-code-version`（**6729**）、`x-cli-environment: "production"`、`x-project-slug`（由 `projectSlugFromPath` 第 **5715-5717** 行推导）、`x-taste-learning: "false"`、`x-co-flag: "false"`；
  - 另两条传输：`Accept: text/event-stream`。
- 目录请求头第 **6788-6792** 行：`accept: application/json` + identity + attribution（**不带** Authorization）。
- `projectSlugFromPath` 第 **5715-5717** 行：小写 → 去盘符 → 非字母数字折成 `-` → 去首尾 `-` → 空则 `"project"`。

**传输选择与回退顺序**
- `requiresMessagesEndpoint` 第 **686-688** 行 + `MESSAGES_ONLY_MODELS` 第 **673-684** 行（目录声明优先、`claude-*` 兜底）。
- `resolveProtocol` 第 **7176-7188** 行：强制项 → Messages 模型 → 缓存协议 → Go 套餐账单分层（`GO_TIER_WEIGHT`）→ 默认 `openai`。
- `isUpgradeRequiredError` 第 **3774-3784** 行（403 + `upgrade_required` / "go plan"+"api access" / "only plan without api access" / "upgrade to goat or higher"）。
- 回退分支第 **7512-7519** 行（`protocol = "cli"`，同账号同一次尝试重发）；轮换上限 `MAX_ACCOUNT_ROTATIONS = 16`：第 **5397** 行。
- 默认值：`requestTimeoutMs` / `streamIdleTimeoutMs` 各 `300000`：第 **10096-10097** 行；`DEFAULT_GENERATE_MAX_TOKENS = 131072`：第 **5390** 行；`MODELS_TIMEOUT_MS = 10000`：第 **5391** 行；错误正文封顶 64 KiB：第 **6661** 行。
- 凭据来源：`credentials.resolve(ref)?.value` 第 **10158-10159** 行；`launchEnvironmentOf(ctx).get(ref)` 第 **10160-10161** 行（环境变量名就是 ref）；auth.json 形状（`apiKey` 或 `commandcode.{key|access}`）第 **5718-5734** 行。
- 事件行解析第 **4345-4355** 行（trim → 跳过空行/`:`/`event:` → 去 `data:` → 忽略 `[DONE]` → JSON.parse，坏行跳过）；三条传输的处理器：CLI **4435-4550**、Chat Completions **4557-4644**、Messages **4678 起**；请求体构造 **6527-6641**（`cliSystem` **6475-6482**、`cliThreadId` **6457-6465**）。
- 重试策略第 **6893-6911** 行（`maxRetries: 1e3`，码 `EMPTY_RESPONSE`/`RATE_LIMIT`/`THROTTLED`/`SERVER`/`TIMEOUT`/`TRANSPORT`，backoff `500/900000/0.1`），`RETRY_MAX_DELAY_MS = 900000` 第 **2974** 行，`THROTTLED_CODE = "THROTTLED"` 第 **2926** 行。
- 宿主侧对照：`DEFAULT_RETRYABLE_CODES`（`node_modules/@deepseek-ai/dsh-llm/lib/types/retry-policy.js` 第 **16-22** 行）确实只有 `EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT` —— 两个超时码必须自己加。

## 4. 错误映射表（status/正文 → `Rejection.kind`）

| 输入 | kind | 说明 |
| --- | --- | --- |
| `status <= 0` 且无结构化码（fetch 抛错、DNS/代理失败、流中途无码错误） | `network` | 瞬时；`rotation.markRejected` 不入表 |
| 401 | `invalid-credential` | 只有换 key（`clearCredentialRejection`）能清除 |
| 429 或 `code/type == "RATE_LIMITED"` | `rate-limit` | 正文点名窗口且给出重置时刻时带 `resetAt`（epoch 毫秒） |
| `USAGE_EXCEEDED` / `INSUFFICIENT_CREDITS` / `PREMIUM_CREDITS_EXHAUSTED` / `MODEL_NOT_IN_PLAN` | `unavailable` | **不按状态过滤**（5xx 携带这些码也照样换账号） |
| 4xx 正文散文命中（`insufficient credits`、`premium credits exhausted`、`model not in plan`、`insufficient (credit\|balance)`、`out of credit`、`not (available\|included)…plan`、`upgrade your plan`），下划线折空格后小写匹配 | `unavailable` | 旧插件第 3733-3734 行同一张表 |
| 408 / ≥500 | `server` | 瞬时 |
| 其余 4xx（畸形请求、体积超限、上下文超限等） | **`undefined`** | 请求级拒绝：不在账号池里走一遍 |
| 流中途 `error` 事件带 `statusCode` | 按上表 | 无状态则 `status = 0`，有码先按码判（`RATE_LIMITED` → `rate-limit`） |

`resetAt` 单位：`error.rateLimit.reset` 是**秒**，×1000 转 epoch 毫秒（旧插件第 3756-3760 行）。

## 5. 测试了什么

`tests/vendors/commandcode.test.ts`（8 条，全部走真实代码路径）：

1. 401 → `invalid-credential`；
2. 429 + `error.rateLimit{window:"fiveHour",reset:1_800_000_000}` → `kind === "rate-limit"` 且 `resetAt === 1_800_000_000_000`；
3. 400 + `code:"USAGE_EXCEEDED"` → `unavailable`；
4. `parseCatalog({models:[有效行, 缺 id 行]})` → `entries` 只含有效行、`ignored === 1`；
5. **端到端换账号**：假 `fetchImpl` 按 `Authorization` 区分账号；账号 a 返回 429（带窗口证据）且零输出，账号 b 返回 SSE `text-delta` + `finish`。断言 `fetch` 调用序列 `["key-a","key-b"]`、最终产出 `{type:"text-delta",index:0,text:"hello"}` 与末 chunk `{type:"finish",reason:{kind:"stop"}}`、`rotation.markRejected` 被调用**一次**且参数 `("a", {kind:"rate-limit"})`；
6. **已输出不换账号（真的走适配器 `stream()`，不是只测引擎）**：账号 a 先产出 `text-delta`，随后同一响应内报告 429 限流事件。断言抛出的 `LlmError.code === "RATE_LIMIT"`、`fetch` 调用序列只有 `["key-a"]`（b 从未被请求）、`markRejected` 仍被调用一次；
7. `listModels` 应用可见性规则：目录 m1/m2 + `modelVisibility:{m2:false}` → 只返回 m1，且形状 `{provider:"commandcode", name:"M1", inputModalities:["text"]}`；
8. `providerRetryPolicy` 白名单含 `LLM_REQUEST_TIMEOUT`、`LLM_STREAM_IDLE_TIMEOUT`、`RATE_LIMIT`；`providerInfo` → `{id:"commandcode", name:"Command Code"}`。

### TDD 证据

**RED**（先写测试，`src/vendors/commandcode/**` 尚不存在）：

```
> pnpm vitest run tests/vendors/commandcode.test.ts

 FAIL  tests/vendors/commandcode.test.ts [ tests/vendors/commandcode.test.ts ]
Error: Cannot find module '../../src/vendors/commandcode/adapter' imported from C:/Work/dsh-llm-account/tests/vendors/commandcode.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

为什么是「正确的失败原因」：brief Step 2 的期望就是「FAIL，模块不存在」。四个模块都还没写，所以失败发生在**收集阶段**（`0 test`），不是断言失败 —— 说明测试确实依赖待实现的生产代码，而不是碰巧通过的空壳。

**GREEN**（实现四个模块后）：

```
> pnpm vitest run tests/vendors/commandcode.test.ts

 ✓ tests/vendors/commandcode.test.ts (8 tests) 21ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**全量**（提交后复跑，工作树干净）：

```
> pnpm typecheck && pnpm test

 ✓ tests/core/accounts.test.ts (10)   ✓ tests/core/rotation.test.ts (19)
 ✓ tests/core/recovery.test.ts (14)   ✓ tests/core/credentials.test.ts (4)
 ✓ tests/core/catalog.test.ts (12)    ✓ tests/core/adapter.test.ts (2)
 ✓ tests/smoke.test.ts (1)            ✓ tests/vendors/commandcode.test.ts (8)
 ✓ tests/core/transport.test.ts (15)
 Test Files  9 passed (9)      Tests  85 passed (85)
```

## 6. 改了哪些文件

新增（提交 `4f587af`，5 files, +1934）：
`src/vendors/commandcode/protocol.ts`、`src/vendors/commandcode/failures.ts`、`src/vendors/commandcode/catalog.ts`、
`src/vendors/commandcode/adapter.ts`、`tests/vendors/commandcode.test.ts`。
**未修改**任何既有文件（`src/core/**`、`package.json`、配置一律没碰）。无 `--amend`。

## 7. 自审发现（已当场修掉）

1. **消费方错误会被误判成厂商失败**：初版用 `for await (...) { yield }` 包在 `try/catch` 里，消费方在 `yield` 处抛错会被 catch 抓住并（瞬时分类）触发换账号重放。改为手动 `iterator.next()`：**只有 `next()` 的失败**进入分类，`yield` 处的消费方中断原样冒泡；并用 `finally` 在非正常结束时尽力关闭上游（`void iterator.return?.(undefined).catch(...)`，与 `runStream` 的「只发关闭请求，不等它完成」同一纪律）。
2. **`iterator.return?.()`** 在 `AsyncGenerator` 的 lib 类型下 `return` 的参数是必需的 → 补成 `return?.(undefined)`（typecheck 报 TS2554 后修正）。
3. **死代码**：初版 `catalog.ts` 导出了没人用的 `supportedEndpointsOf`，`protocol.ts` 里有 `return input.forced === "openai" ? "openai" : "openai"` 这种等价分支 —— 已删除/收敛。
4. **重复调用 `stringValue`** 3 次拼 `tool_calls` 片段 → 收成局部变量。
5. **`maxTokens` 初版算式**绕且等价于错的（把 cap 与 options 混在一起）→ 改成 `cap = min(defaultMaxTokens, DEFAULT_GENERATE_MAX_TOKENS)`、`min(options.maxTokens, cap)`。
6. 逐条核对 brief 的硬性要求：`literal` 只取 `config.apiKey`（无任何设置文档明文读写）；无账号写操作、无登录、无额度读取、无客户端代码；未新增 `any`（grep `\bany\b` 无命中）；`MAX_TRIED` 与 `fallbackAllowed` 是循环里**唯一**的停止/换号条件，没有自造条件。

## 8. Concerns（请控制器裁决 / 带到后续任务）

1. **「超过 30 天的 reset 丢弃」与 brief 自带测试冲突（需要裁决）**：brief 第 2 条测试要求
   `reset: 1_800_000_000`（秒）→ `resetAt === 1_800_000_000_000`，即 `2027-01-15T08:00:00Z`，
   而今天是 2026-10-13 —— 距当前约 **94 天**，严格套用旧插件第 3761 行的「≤30 天」过滤会得到 `undefined`，
   **该测试必然失败**。我的取舍：把 30 天上限只用在**从文案推断**的 ISO 时间戳（`resets at <ISO>`，最容易被无关文本命中误判），
   显式公布的 `error.rateLimit.reset` 秒数原样采信（`MAX_STAMP_AHEAD_MS` 常量在 `failures.ts` 里，注释写明理由）。
   若控制器要求两条路径都严格封顶 30 天，则该测试的期望值需要改成当前时刻附近的值。
2. **旧插件的三张已知模型表没有搬**（`KNOWN_EFFORTS` 第 115-461 行、`KNOWN_IMAGE_MODELS` 第 462 行起、
   `MODEL_OUTPUT_TOKEN_LIMITS` 第 723 行起，合计约 600 行数据）：本任务的 `resolveModel` 只在目录行**自己声明**时
   给出 `reasoning.efforts` 与 `image` 模态，未声明就留空（不猜，与「额度缺失不倒成 0」同一纪律）。
   计划里「模型白名单/思考档位/上下文覆盖」本就写在**第 2 期**（设计 §3），但请确认 Task 9 的验收是否要求这些表。
3. **`stream()` 不拉目录**：因此协议选择只用「模型 id 规则 + `config.protocol` 强制 + 403 回退」，
   没用目录的 `supported_endpoints`（`resolveProtocol` 已留该参数，等有 TTL 缓存的调用方接上），
   `maxTokens` 也只用配置默认值而不是目录里每个模型的输出上限。旧插件每次请求都用 `GatewayFacts`（带 TTL 缓存）读这些事实；
   加 TTL 缓存属于 Task 10 / 第 2 期，本任务刻意不做以避免每请求多一次网络往返。
4. **超时与会话轮换**：`LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` 被视为传输级瞬时失败（kind `network`，
   轮换引擎不入拒绝表），未输出时可以换下一个账号；但**抛给宿主的始终是原始 `LlmError`**，两个具体码原样保留，
   不会被退化成 `TRANSPORT`/`TIMEOUT`（裁决 12 的意图）。
5. **`imageRequestPricing` 未覆盖** → 图片计价回落到消费方自己的中性估算（旧插件按 `KNOWN_IMAGE_MODELS` 给视觉 token 定价）；
   图片 offload 与预算是第 3 期（设计 §15）。
6. **429 的 `providerRetryAfterMs` 未附加**：旧插件会把 `resetAt` 换算成等待时间（封顶 900s）挂到 `LlmError` 上，
   让宿主重试正好等到窗口重置。本任务只做了「换账号 + 记冷却」，宿主重试仍按自己的 backoff —— 若第 2 期要求「等到窗口重置」，
   需要在这里补 `providerRetryAfterMs`。
7. **CLI 传输的 `threadId` 是近似**：旧插件用 sha1（含 `THREAD_ID_NAMESPACE` 常量）从 sessionId 派生稳定 UUID；
   本任务在 sessionId 已是 UUID 时直接用，否则随机 UUID。影响 CLI 传输（Go 套餐回退路径）的跨请求线程连续性，属第 2 期对齐项。
8. **`CommandCodeAdapterDeps` 比计划里的 Produces 多两个可选字段**：`resolveStored?`、`resolveEnvironment?`
   （brief 控制器补充第 5 条要求把 `stored`/`environment` 读取作为注入点、不直接依赖 `ctx`）。
   计划里列出的 6 个字段（`config`/`rotation`/`quota`/`accounts`/`fetchImpl`/`authFileFallback`）名称与类型完全一致，新增字段全部可选，Task 12 可照抄。
9. **`parseCatalog` 同时认两种负载形状**：brief 测试用的 `{ models: [...] }`（也是旧插件 CLI 缓存形状）
   与 Provider API 的真实形状 `{ object: "list", data: [...] }`。若上游只有一种，这条兼容不会有害，但请在 Task 10 的额度/目录实读时确认。
10. `attributionHeaders()` 已进入目录与两条生成请求的头（宿主强制要求）；CLI 分支同样带头。
11. 本任务未写任何缓存文件（brief 明确「本期不要求写缓存文件」），`~/.commandcode/auth.json` 只以注入接口存在（真实读取留 Task 14）。

---

# Task 9 修复报告 — 429 的 30 天 reset 视野统一覆盖两条证据路径

- 状态：**DONE**
- 提交：`97e89d0 fix(commandcode): 429 reset 的 30 天视野对所有证据路径统一生效`（父提交 `4f587af`，**新提交，未 `--amend`**）
- 分支：`work`；提交后 `git status --porcelain` 为空
- 验证命令：`pnpm typecheck && pnpm test`（见 §4 原始输出）
- 结果：typecheck 干净；`pnpm test` → **9 文件 / 88 tests passed**（修复前 85，本修复 +3 条测试）

## 1. 裁决与落地（上文 Concern 1 的结案）

控制器裁决：**30 天上限适用于两条路径**——显式 `error.rateLimit.reset` 秒数字段与文案推断的
`resets at <ISO>` 时间戳一视同仁，凡超出 `now + 30 天` 的候选重置时刻一律丢弃，`Rejection`
于是不带 `resetAt`，轮换引擎退回 `RATE_LIMIT_COOLDOWN_MS`（300s）短冷却。
采纳理由：远期/单位混淆的 reset 会把健康账号**无限期**钉出轮换（静默失效），
而丢弃它只多花几次重试并在窗口真正重置后自愈；代价是真实超过 30 天的窗口被忽略。

`src/vendors/commandcode/failures.ts` 的变化（**分类口径其余部分未动**）：

| 变更 | 说明 |
| --- | --- |
| `MAX_STAMP_AHEAD_MS` → `MAX_RESET_AHEAD_MS` | 名字不再暗示「只用于文案时间戳」；注释改写为「所有证据路径统一视野」并写上取舍与代价 |
| `readWindowLimitEvidence(parsed, now)` | 新增 `now` 参数；`horizon = now + MAX_RESET_AHEAD_MS`，用同一个 `withinHorizon(value)` 判定显式秒数与 ISO 时间戳两条路径 |
| `classifyCommandCodeFailure(status, body, now = Date.now())` | **加法式**签名变更：第三参数可选、缺省读系统时钟，既有调用方（`adapter.ts`）与既有测试无需改动 |
| 无 `resetAt` 时的说明文案 | 从「服务商未公布重置时间」改为「没有可用的重置时间（未公布，或公布的重置时间超出 30 天视野），按短冷却处理」——否则在被丢弃的情况下文案与实际不符 |

保留的证据优先顺序（未变）：显式秒数优先；若显式值超出视野被丢弃，仍会尝试文案 ISO 时间戳
（这条在修复前不可达，因为显式值存在时函数直接返回；它只会让结果**更**准确，不会放宽视野）。

## 2. 覆盖测试（`tests/vendors/commandcode.test.ts`）

| 测试名 | 断言 |
| --- | --- |
| `429 带窗口证据时带 resetAt，rate-limit → 冷却`（**改**） | fixture 由 `reset: 1_800_000_000`（≈94 天，与裁决冲突）改为 `Math.floor(Date.now() / 1000) + 60`，断言 `resetAt === resetSeconds * 1000` |
| `429 显式 reset 超出 30 天视野时丢弃 resetAt（裁决：两条路径统一封顶）`（**新**） | `now = Date.UTC(2026,0,1)`，`reset = (now + 90 天)/1000` → `kind === "rate-limit"` 且 `resetAt === undefined` |
| `429 文案 ISO 时间戳超出 30 天视野时丢弃 resetAt（同一条视野）`（**新**） | `message` 含 `resets at <now + 90 天的 ISO>` → `kind === "rate-limit"` 且 `resetAt === undefined` |
| `429 文案 ISO 时间戳在 30 天视野内时仍带 resetAt`（**新**） | `resets at <now + 60s 的 ISO>` → `resetAt === Date.parse(stamp)`（防止过度封顶把正常的文案时间戳也丢掉） |

三条新测试都用注入的 `now`（不依赖系统时钟与运行日期），因此不会随日期漂移。

### 新测试确实约束生产代码（变异检查）

把 `published` 分支的 `withinHorizon(published)` 临时改回修复前的 `Number.isFinite(published)`，
只跑「显式 reset 超出 30 天视野」这条：

```
> pnpm vitest run tests/vendors/commandcode.test.ts -t "显式 reset 超出 30 天视野"

- Expected: undefined
+ Received: 1775001600000
 ❯ tests/vendors/commandcode.test.ts:96:27
 Tests  1 failed | 10 skipped (11)
```

（`1775001600000` = `Date.UTC(2026,0,1) + 90 天`，即修复前会采信的远期 reset。）
随后**原样恢复**该行并复跑全量，88 条通过 —— 说明新测试钉的是这条守卫，不是空断言。

## 3. 其余 Task 9 行为仍绿

401 → `invalid-credential`；`USAGE_EXCEEDED` → `unavailable`；`parseCatalog` 过滤与计数；
「未输出时换账号」端到端（429 带 `reset: now+3600s` 仍在视野内，故 `markRejected("a", {kind:"rate-limit"})` 行为不变）；
「已输出后不换账号」端到端；`listModels` 可见性；`providerRetryPolicy`（`mode: "normal"`，
白名单含 `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` / `RATE_LIMIT`）与 `providerInfo` —— 全部通过，未作任何修改。

## 4. 验证命令与原始输出

```
> pnpm typecheck && pnpm test

$ tsc --noEmit
$ vitest run

 ✓ tests/core/accounts.test.ts (10 tests) 8ms
 ✓ tests/core/catalog.test.ts (12 tests) 7ms
 ✓ tests/core/recovery.test.ts (14 tests) 12ms
 ✓ tests/core/rotation.test.ts (19 tests) 7ms
 ✓ tests/smoke.test.ts (1 test) 3ms
 ✓ tests/core/credentials.test.ts (4 tests) 4ms
 ✓ tests/core/adapter.test.ts (2 tests) 2ms
 ✓ tests/vendors/commandcode.test.ts (11 tests) 28ms
 ✓ tests/core/transport.test.ts (15 tests) 141ms

 Test Files  9 passed (9)
      Tests  88 passed (88)
```

## 5. 本修复改动的文件

`src/vendors/commandcode/failures.ts`、`tests/vendors/commandcode.test.ts`（2 files changed, 71 insertions(+), 16 deletions(-)）。
未新增/删除文件，未碰 `src/core/**`、`package.json`、配置文件；无 `--amend`。

---

# Task 9 修复报告 2 — Messages 终止唯一化 / usage 合并 / 4xx 扫描整段正文（独立评审 1 Critical + 2 Important + 裁决小项）

提交：`ef0f633`（新提交，未 `--amend`）；基线 `97e89d0`。

## 0. 结论与取舍声明

- **Finding 1（Critical）**：采用评审给的**第一条**方案 —— 「记住 `message_delta` 的 `stop_reason`，
  只在 `message_stop` 发出 finish」（旧插件第 4814-4832 行的原样口径），**没有**另外给
  `finish()` 加幂等守卫。理由：该方案的语义与旧插件逐行一致，且把「谁负责终止」变成结构上
  唯一（`finish()` 仍是 OpenAI/CLI 两条传输的收尾入口，未改动），比事后守卫更能防住同类回归。
- **Finding 2（Important）**：`message_start` 的 usage 存进装配器，与 `message_delta` 的合并后
  **只**交出一次；`message_delta` 若完全不带 usage，则留到 `message_stop` 补发（仍在 finish 之前）。
- **Finding 3（Important）**：4xx 散文扫描与 429 窗口证据的第二条路径都改为扫描整段原始正文，
  分类**优先级顺序未动**。
- **裁决小项**：缺凭据路径的 `invalid-credential` 现在真的写入轮换引擎的拒绝表。

## 1. Finding 1 — 一条 Messages 响应只有一条终止 finish

**问题**：`messagesChunks` 在 `message_delta.delta.stop_reason` 存在时（旧 :799）发一次
`finish`，`message_stop`（旧 :803-804）再发一次；`StreamAssembler.finish` 无幂等守卫。
网关实测序列固定是 `message_delta` → `message_stop`，所以**每个** Claude 响应都有两条 finish，
宿主只保留最后一条（`dsh-llm` getter），结束原因被覆盖成 `stop`，并且只有 `max-tokens` 时才
丢弃半装工具块的逻辑失效。

**改动**（`src/vendors/commandcode/protocol.ts`）：
- `StreamAssembler` 新增 `#messagesFinishReason`、`setMessagesFinishReason()`、`messagesStop()`。
- `message_delta`：只 `setMessagesFinishReason(stringValue(delta.stop_reason))`；不再发 finish。
- `message_stop`：`return assembler.messagesStop()`，即「补发未交出的 usage + 唯一一条 finish」，
  reason 由 `mapFinishReason(#messagesFinishReason)` 得出（缺失时默认 `stop`，与旧插件 4830 行一致）。

**覆盖测试**（`tests/vendors/commandcode.test.ts`）：
- `Messages 流只发出一个 finish，结束原因取自 message_delta 的 stop_reason（Finding 1）`
  —— fixture `tests/fixtures/commandcode/messages-tool-use.sse`（`message_start` → `ping` →
  text 块 → `tool_use` 块两个 `input_json_delta` 片段 → `message_delta{stop_reason:"tool_use"}`
  → `message_stop`）；断言 `finish` 数组等于 `[{ kind: "tool-calls" }]`（**恰好一条**，且不是默认
  `stop`，所以「忘了记住 reason」也会被抓到），并断言工具块参数被拼成 `{"path":"a.txt"}`。
- `Messages 的 max_tokens 截断只有一条 finish，且 reason 是 max-tokens（Finding 1）`
  —— fixture `messages-max-tokens.sse`；断言 `finish` 长度为 1 且 reason 为 `max-tokens`。

## 2. Finding 2 — Messages usage 合并 `message_start`，且只发一条 usage

**问题**：`messagesUsage` 把缺失字段读成 0（旧 :500-510），`messagesChunks` 没有 `message_start`
分支（旧 :779-806）；Claude 路径上 `inputTokens`/cache-read/cache-write 全被报成 0，违反
「缺失字段绝不能被当成 0」的约束。同时宿主对第二条 usage chunk 直接判失败
（`node_modules/@deepseek-ai/dsh-llm/lib/invariant.js:48-50`：`LLM stream emitted usage more than once`），
所以不能照抄旧插件「message_start 发一条 + message_delta 再发一条」的写法。

**改动**（`protocol.ts`）：
- `messagesUsage(raw, previous?)`：每个字段 `本次负载 ?? previous ?? 0`（旧 :4657-4661 的合并口径；
  `previous` 是唯一使 0 不成为「假事实」的来源）。
- `message_start` 分支：`messagesUsage(message.usage)` → `setMessagesUsage()`，**不**当场交出。
- `message_delta` 分支：`mergeMessagesUsage(event.usage)` 合并后交出（`#messagesUsageEmitted`
  保证全流只有一条）；负载不是对象时返回 `[]`。
- `message_stop`：先 `#emitMessagesUsage()` 补发（若 `message_delta` 没带 usage），再发 finish ——
  顺序保证 usage 永远在终止 chunk 之前（宿主的 `emitted ... after terminal finish` 不变式）。

**覆盖测试**：
- `Messages usage 合并 message_start 与 message_delta，且只发一条 usage（Finding 2）`
  —— fixture 里 `message_start.usage` 只有输入/缓存计数（4096 / 128 / 2048），
  `message_delta.usage` **只有** `output_tokens:8192`；断言 usage chunk **恰好一条**、
  等于 `{ inputTokens: 4096, outputTokens: 8192, cacheReadTokens: 2048, cacheWriteTokens: 128 }`，
  且位置在 finish 之前。
- `message_delta 完全不带 usage 时，message_start 的输入计数仍只发一条 usage（Finding 2）`
  —— 内联 SSE（`stop_reason:"end_turn"`），断言只有一条 usage 且 `inputTokens: 777` 存活，
  末条为 `{ kind: "stop" }`。

## 3. Finding 3 — 4xx 散文扫描与 429 窗口证据都看整段原始正文

**问题**：只在 `parsed.message` 上做散文匹配（旧 :193-195），而 `readProviderError`（:91-105）
只会从嵌套 `error` 或根对象读 `message`。后果：纯文本 400（"insufficient credits"）、
带平铺 `detail`、或 `error` 无 message 但根级有 `message` 的正文，都分类成 `undefined` →
`adapter.ts:354` 原样抛出非 `LlmError`，账号既不被标记也不轮换；429 的
`resets at <ISO>` / 计划窗口文案只要不在 `error.message` 里就会被漏掉，真实窗口重置退化成
300s 冷却。

**改动**（`src/vendors/commandcode/failures.ts`）：
- 新增 `rawTextOf(body)`：字符串原样，其余 `JSON.stringify`（失败则 `""`）——等价于旧插件的
  `errText`（旧 :3733-3734 一直在原始正文上匹配）。
- 4xx 分支：`const lower = rawText.toLowerCase().replaceAll("_", " ")`。
- `readWindowLimitEvidence(parsed, now, rawText)`：`usage limit for your plan` 与
  `resets at <ISO>` 都是「先 `error.message`、再整段原文」两条路径（旧 :3757-3758）；
  30 天视野对两条路径的封顶逻辑**未改**，分类优先级顺序**未改**。

**覆盖测试**：
- `纯文本 400 正文命中余额耗尽文案：标记 unavailable 并换账号（Finding 3）`
  —— 端到端：账号 a 返回 `400` + `text/plain` 正文 `insufficient credits for this account`，
  账号 b 正常；断言 `calls === ["key-a","key-b"]` 且
  `markRejected("a", { kind: "unavailable" })`。
- `429 的重置证据落在 error.message 之外（根级 message / detail）时仍解析出 resetAt（Finding 3）`
  —— `{ error: { type: "rate_limit_error" }, message: "usage limit for your plan, resets at <now+30min>" }`
  与同形状的 `detail` 版本，均断言 `kind === "rate-limit"` 且 `resetAt === Date.parse(stamp)`
  （注入 `now`，落在 30 天视野内）。

## 4. 裁决小项 — 缺凭据账号入拒绝表

**改动**（`adapter.ts:305-321`）：`#resolveKey` 返回 `undefined` 时，先构造 `invalid-credential`
的 `Rejection` 并 `this.#deps.rotation.markRejected(ref, rejection)`，再沿用原来的
`lastFailure` / `MAX_TRIED` / `continue` 流程；抛给宿主的错误与文本不变（仍是 `MISSING_CREDENTIAL`）。

**覆盖测试**：`缺凭据的账号被记入拒绝表，后续请求不再重选它（裁决：missing-credential 入表）`
—— 账号 a 四个来源全空、账号 b 有 key；断言只请求了 `key-b`、
`rotation.rejections().get("a")` 匹配 `{ kind: "invalid-credential" }`。

## 5. 新测试确实约束生产代码（变异检查）

把三个生产文件（`src/vendors/commandcode/**`）用 `git stash push -- src` 暂回修复前，
仅保留新测试与 fixture 后复跑：

```
   × Messages 流只发出一个 finish，结束原因取自 message_delta 的 stop_reason（Finding 1）
   × Messages 的 max_tokens 截断只有一条 finish，且 reason 是 max-tokens（Finding 1）
   × Messages usage 合并 message_start 与 message_delta，且只发一条 usage（Finding 2）
   × 纯文本 400 正文命中余额耗尽文案：标记 unavailable 并换账号（Finding 3）
   × 429 的重置证据落在 error.message 之外（根级 message / detail）时仍解析出 resetAt（Finding 3）
   × 缺凭据的账号被记入拒绝表，后续请求不再重选它（裁决：missing-credential 入表）
 Test Files  1 failed | 8 passed (9)
      Tests  6 failed | 88 passed (94)
```

随后 `git stash pop` 原样恢复并复跑全量全绿（见下）——说明 6 条新测试各自钉住一个真实缺陷，
且修复没有改动任何既有行为。

## 6. 验证命令与原始输出

```
> pnpm typecheck && pnpm test

$ tsc --noEmit
$ vitest run

 RUN  v5.0.4 C:/Work/dsh-llm-account

 ✓ tests/core/credentials.test.ts (4 tests) 3ms
 ✓ tests/core/accounts.test.ts (10 tests) 10ms
 ✓ tests/core/recovery.test.ts (14 tests) 11ms
 ✓ tests/core/catalog.test.ts (12 tests) 7ms
 ✓ tests/core/rotation.test.ts (19 tests) 9ms
 ✓ tests/core/adapter.test.ts (2 tests) 4ms
 ✓ tests/smoke.test.ts (1 test) 2ms
 ✓ tests/vendors/commandcode.test.ts (18 tests) 25ms
 ✓ tests/core/transport.test.ts (15 tests) 152ms

 Test Files  9 passed (9)
      Tests  95 passed (95)
```

## 7. 本次改动的文件

- `src/vendors/commandcode/protocol.ts`、`src/vendors/commandcode/failures.ts`、
  `src/vendors/commandcode/adapter.ts`
- `tests/vendors/commandcode.test.ts`（新增 7 条测试）
- 新增 fixture：`tests/fixtures/commandcode/messages-tool-use.sse`、
  `tests/fixtures/commandcode/messages-max-tokens.sse`

未碰 `src/core/**`、`src/vendors/opencode/**`、`package.json`、任何配置与锁定文件；
未扩到三条 finding + 裁决项之外的其它观察项；无 `--amend`（新提交 `ef0f633`）。

---

# Task 9 修复报告 3 — 断流（终止事件之前正文结束）时补一条 finish

提交：`8ec18c7`（新提交，未 `--amend`）；上一轮 `ef0f633`。

## 1. 问题（Fix round 1 引入的回归）

Fix round 1 把 Messages 的 finish 从 `message_delta` 挪到 `message_stop` 之后，
`decodeStream`（`protocol.ts:941-969`）**没有任何流末兜底**：正文在 `message_delta` 之后
干净结束（缺 `message_stop`、正文被截断）时，整条流交出 **0 条** finish；宿主按
`node_modules/@deepseek-ai/dsh-llm/lib/invariant.js:59`
（`LLM stream ended without a terminal finish chunk`）直接判流失败。修复前该路径是合法的
（`message_delta` 自己会发 finish）。

同一缺口也存在于共用 `decodeStream` 的 `openai` / `cli` 两条解码路径（缺 `finish_reason` /
`finish` 事件），控制器裁决在同一轮一并关闭。

## 2. 改动

**`src/vendors/commandcode/protocol.ts`**

- `StreamAssembler` 新增 `#finished` 标记：`finish()` 与 `messagesStop()` 交出终止 chunk 时置位。
- 新增 `endOfStream()`：
  - 已经交出过 finish → 返回 `[]`（**每条流恰好一条** finish，杜绝重复补发）；
  - 否则补一条：`[...#emitMessagesUsage(), ...this.finish(mapFinishReason(#messagesFinishReason))]`。
    Messages 用 `message_delta` 记下的 `stop_reason`；`openai`/`cli` 没有记住的原因，
    `mapFinishReason(undefined)` 落到 `{ kind: "stop" }`。
  - 补发走 `finish()`，因此仍打开的文本/推理块会被关闭、缓冲的 OpenAI 工具调用会被交出 ——
    只补 finish 而不关块会撞上宿主另一条不变式（`finished with N open block(s)`）。
  - 尚未交出的 usage 排在 finish **之前**（宿主的 `emitted ... after terminal finish` 不变式）。
- `decodeStream()`：在读完尾部缓冲（`decodeLine(buffer)`）之后追加
  `for (const chunk of assembler.endOfStream()) yield chunk;`。
  顺序保证尾部缓冲里的终止事件先被处理（置位 `#finished`），不会被兜底重复补发。
  **只在正常读完整个正文之后**执行：调用方提前 `return()`/中止时生成器直接走 `finally` 并
  `reader.cancel()`，不会补出假 finish。

## 3. 覆盖测试（`tests/vendors/commandcode.test.ts`，新增 4 条）

1. `Messages 在 message_delta 之后断流（缺 message_stop）时补一条带 stop_reason 的 finish（Fix 2）`
   —— 内联 SSE `message_start` → `message_delta{stop_reason:"max_tokens"}` 后 EOF；
   断言恰好一条 `{ kind: "max-tokens" }`（**不是**默认 `stop`，说明用的是记住的原因），
   且断流前交出的 usage 不重复（仍是 `{ inputTokens: 321, outputTokens: 50, cacheReadTokens: 0 }`）。
2. `Messages 已经发出 message_stop 的流在 EOF 时不会补第二条 finish（Fix 2）`
   —— 复用 fixture `messages-tool-use.sse`（正常 `message_stop` 收尾）；断言 finish 恰好一条。
   这条是 no-double-flush 守卫。
3. `openai 流在缺 finish_reason 的情况下 EOF 时补一条 finish，并关闭打开的文本块（Fix 2）`
   —— `{"choices":[{"delta":{"content":"hi"}}]}` 后 EOF；断言恰好一条 `{ kind: "stop" }`，
   且打开的文本块被 `block-end`（`block: { type: "text", text: "hi" }`）关闭。
4. `cli 流在缺 finish 事件的情况下 EOF 时补一条 finish（Fix 2）`
   —— `{"type":"text-delta","text":"hi"}` 后 EOF；断言恰好一条 `{ kind: "stop" }`。

测试辅助：新增按协议解码的 `decodeSse(protocol, text)`，`decodeMessagesSse()` 改为它的
Messages 便捷封装（既有测试未改语义）。

## 4. 变异检查

### 4.1 对修复前的 src（`git stash push -- src`，只保留新测试）

```
   × Messages 在 message_delta 之后断流（缺 message_stop）时补一条带 stop_reason 的 finish（Fix 2）
   × openai 流在缺 finish_reason 的情况下 EOF 时补一条 finish，并关闭打开的文本块（Fix 2）
   × cli 流在缺 finish 事件的情况下 EOF 时补一条 finish（Fix 2）
 Test Files  1 failed | 8 passed (9)
      Tests  3 failed | 96 passed (99)
```

说明：**测试 1/3/4** 分别钉住一条修复前的真实缺陷。**测试 2**（no-double-flush 守卫）
在修复前必然通过 —— 修复前根本没有兜底补发，「不会补第二条」无从违反；它的作用是钉住修复的
正确性（见下一项变异）。

### 4.2 对修复本身的反向变异（去掉 `#finished` 守卫的无条件补发）

把 `endOfStream()` 的 `if (this.#finished) return [];` 暂时删掉（其余不变）后复跑
`tests/vendors/commandcode.test.ts`：

```
   × Messages 流只发出一个 finish，结束原因取自 message_delta 的 stop_reason（Finding 1）
   × Messages 的 max_tokens 截断只有一条 finish，且 reason 是 max-tokens（Finding 1）
   × Messages 已经发出 message_stop 的流在 EOF 时不会补第二条 finish（Fix 2）
      Tests  3 failed | 19 passed (22)
```

测试 2 被杀死 → 它确实约束实现「恰好一条 finish」，不是空断言。随后**原样恢复**该守卫
（`protocol.ts:813`）并复跑全量（见下）。

## 5. 验证命令与原始输出

```
> pnpm typecheck && pnpm test

$ tsc --noEmit
$ vitest run

 RUN  v5.0.4 C:/Work/dsh-llm-account

 ✓ tests/core/recovery.test.ts (14 tests) 9ms
 ✓ tests/core/adapter.test.ts (2 tests) 3ms
 ✓ tests/core/accounts.test.ts (10 tests) 8ms
 ✓ tests/core/catalog.test.ts (12 tests) 6ms
 ✓ tests/smoke.test.ts (1 test) 2ms
 ✓ tests/core/rotation.test.ts (19 tests) 9ms
 ✓ tests/core/credentials.test.ts (4 tests) 5ms
 ✓ tests/vendors/commandcode.test.ts (22 tests) 27ms
 ✓ tests/core/transport.test.ts (15 tests) 152ms

 Test Files  9 passed (9)
      Tests  99 passed (99)
```

（上一轮 95 条 → 本轮 99 条。）

## 6. 本次改动的文件

- `src/vendors/commandcode/protocol.ts`（`#finished` 标记、`endOfStream()`、`decodeStream` 流末补发）
- `tests/vendors/commandcode.test.ts`（新增 4 条测试 + `decodeSse` 辅助）

未碰 `src/core/**`、`src/vendors/opencode/**`、`package.json`、配置与锁定文件；无 `--amend`。

## 7. 残留观察（未改，供控制器记录）

本次按指令把「断流」翻译成一条**正常**的 finish，因此一条完全空/被截断的响应现在会以
`{ kind: "stop" }` 静默成功收尾。旧插件在同样的 `else` 分支里反而显式失败：无内容抛
`EMPTY_RESPONSE`、有内容抛可重试的 `STREAM_CLOSED`（旧插件 `lib/index.js:4209-4222`）。
两者对**宿主不变式**是等价的（都以终止 chunk 收尾：抛错路径由适配器翻译成带码的 `LlmError`），
差别只在语义（「模型主动结束」vs「请求失败可重试」）。若控制器希望恢复旧插件的
`EMPTY_RESPONSE`/`STREAM_CLOSED` 区分，需要的是 `decodeStream` 层新增
`sawContent`/未终止标记并在适配器里映射成错误码 —— 那超出本轮授权范围，故未实现。

---

# Task 9 修复报告 4 — 空/截断流不再伪装成正常收尾；排空 Messages 的打开块

提交：`5860601`（新提交，未 `--amend`）；上一轮 `8ec18c7`。

## 1. Item A — 无内容 + 无终止事件 → 可重试的 EMPTY_RESPONSE

**问题**：round 2 的流末兜底把 0 字节/早期截断的正文变成一条 `{finish, reason:{kind:"stop"}}`，
空答案与真实答案无法区分、也永远不会重试（`EMPTY_RESPONSE` 原本只出现在
`adapter.ts:70` 的白名单里，没有任何代码会产出它）。旧插件在同一分支（`lib/index.js:4209-4222`）
是明确失败的：无内容抛可重试的 `EMPTY_RESPONSE`，有内容但流被关闭抛 `STREAM_CLOSED`。

**改动**（`src/vendors/commandcode/protocol.ts`）：

- 新增 `chunkIsContent(chunk)` + `usageTotalOf(usage)`：一条 chunk 是否代表「真的产出了东西」——
  文本/推理 delta 非空、工具调用 delta 带 name/arguments、`block-end(tool-call)`、或**非零** usage
  （旧插件 `asm.sawContent` 第 4405-4800 行的口径 + 控制器的 usage 口径）。
- `decodeStream` 用一个共享账本 `sawContent` 记下三条传输产出的每一条 chunk（`produced()` 包裹
  `decodeLine` 的两个出口），流末把它交给 `endOfStream(sawContent)`。
- `endOfStream(sawContent)`：已经有 finish → `[]`（不重复）；`!sawContent` → 抛
  `LlmError(..., EMPTY_RESPONSE_CODE)`（`EMPTY_RESPONSE_CODE` 从 `@deepseek-ai/dsh-llm` 导入，
  值即 `"EMPTY_RESPONSE"`，与 `adapter.ts` 白名单里的字面量一致 → 宿主会重试）；有内容 → 仍恰好
  补一条 finish（Messages 沿用记住的 `stop_reason`）。
- **缓冲的 OpenAI 工具调用也算内容**：`flushOpenAiToolCalls` 之前它们还不是 chunk，
  round 2 的「只看已产出 chunk」口径会在流末把它误判成空响应并连带丢掉一个真实工具调用。
  新增 `hasBufferedToolCall` getter（依据旧插件第 4610 行：收到 `delta.tool_calls` 当刻即算内容），
  调用处为 `endOfStream(sawContent || assembler.hasBufferedToolCall)`。
- **截断的 finish reason：保持 `stop`**。查 `node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts:131-151`，
  `FinishReasonMap` 只有 `stop` / `tool-calls` / `max-tokens` / `aborted{failure}` / `error{failure}`：
  `aborted`/`error` 需要 `LlmFailure` 负载，是宿主表达**失败回合**的通道（宿主自己就用
  `adapterFailureChunk`（`lib/index.js:2376-2388`）把适配器抛出的异常转成 `{kind:"error"}`），
  没有「截断/流被关闭」这一类取值；用它会把一份**可用的部分答案**变成失败回合，超出本轮授权，
  故按控制器的备选口径保持 `stop`（本节即记录）。
- 空响应走抛错路径不会撞宿主不变式：`validateStream` 的 `fail("ended without a terminal finish")`
  只在 `for await` 正常结束才执行，抛错直接冒泡，宿主再由 `adapterFailureChunk` 收成
  `{kind:"error"}` 终止 chunk（开块检查对 `error` 豁免）。
- 前置检查：`runProviderError`/空响应判定只发生在**正常读完整个正文之后**；调用方提前
  `return()`/中止时生成器直接走 `finally`，不会误报空响应。

## 2. Item B — 流末 finish 之前排空 Messages 的打开块

**问题**：`finish()` 只关闭文本/推理块与缓冲的 openai 工具调用（`protocol.ts:754-757`），
`#messagesBlocks` 从不排空。于是 EOF 时仍打开的 Messages `tool_use` 块会留在宿主账本里，
流末补发的 finish 被 `invariant.js:53` 以 `LLM stream finished with N open block(s)` 拒绝
（round 2 的文档注释也把 `finish()` 的作用说过头了）。

**改动**：新增 `closeMessagesBlocks()`，对每个仍打开的 Messages 原生块调用 `messagesBlockStop`
（等价于补发 `content_block_stop`：文本/推理交出 `block-end`，工具块交出带累计参数的
`block-end`），并把它放在 `finish()` 的**最前面**。正常路径下 `#messagesBlocks` 已空，返回 `[]`，
因此行为不变（第 4/5 条守卫测试即为此）。

## 3. 覆盖测试（`tests/vendors/commandcode.test.ts`，新增 5 条）

**改动前会失败的 2 条（本轮修复的直接证据）**

1. `没有内容也没有终止事件的流抛可重试的 EMPTY_RESPONSE，而不是补一条 stop finish（Fix 3）`
   —— 0 字节 Messages 正文、usage 全 0 的 `message_start` 后断流、以及 openai 空正文：
   三者都断言 `LlmError` 且 `code === "EMPTY_RESPONSE"`。
2. `Messages 的 tool_use 块在 EOF 仍打开时被排空，且只有一条 finish（Fix 3，Item B）`
   —— `content_block_start(tool_use)` + 半个 `input_json_delta` 后 EOF；断言
   `openBlockIndices(chunks)` 为空（宿主账本无打开块）、补发的 `block-end` 带累计的局部参数、
   且恰好一条 `{kind:"stop"}`。

**回归守卫 3 条（改动前后都应通过，用于钉住本轮不得破坏的行为）**

3. `openai 流在缺 finish_reason 的情况下 EOF 时补一条 finish，并关闭打开的文本块（Fix 2）`
   —— round 2 的守卫，本轮未改（仍通过）。
4. `正常收尾的 Messages 流不变：恰好一条 finish、一条 usage、无打开块（Fix 3，回归守卫）`
   —— fixture `messages-tool-use.sse`：恰好一条 finish、恰好一条 usage、无打开块。
5. `openai 流只缓冲了工具调用、随后断流：工具调用被交出，不是空响应（Fix 3，回归守卫）`
   —— 钉住「缓冲工具调用算内容」；反向变异验证见 §4.2。

另外把 `EMPTY_RESPONSE` 显式加进既有的 `providerRetryPolicy 把两个超时码列入 retryableCodes`
测试的断言（`expect(policy.retryableCodes).toContain("EMPTY_RESPONSE")`），证明空响应真的会被宿主重试。

新增测试辅助 `openBlockIndices(chunks)`：按宿主的开块账本（`invariant.js:20-55`）统计流结束时仍
打开的块索引。

## 4. 变异证据

### 4.1 对改动前的 src（`git stash push -- src`，只保留新测试）

```
   × 没有内容也没有终止事件的流抛可重试的 EMPTY_RESPONSE，而不是补一条 stop finish（Fix 3）
   × Messages 的 tool_use 块在 EOF 仍打开时被排空，且只有一条 finish（Fix 3，Item B）
 Test Files  1 failed | 8 passed (9)
      Tests  2 failed | 102 passed (104)
```

两条 must-fix 测试分别钉住 Item A 与 Item B。守卫 3/4/5 在改动前必然通过（它们钉的是
round 2 已经正确的行为，本轮不得回退），故此处不出现。

### 4.2 对本轮新逻辑的反向变异（去掉「缓冲工具调用算内容」）

把调用处由 `endOfStream(sawContent || assembler.hasBufferedToolCall)` 暂时改回
`endOfStream(sawContent)` 后复跑 `tests/vendors/commandcode.test.ts`：

```
   × openai 流只缓冲了工具调用、随后断流：工具调用被交出，不是空响应（Fix 3，回归守卫）
      Tests  1 failed | 26 passed (27)
```

守卫 5 被精确杀死 → 它确实约束本轮新增的判定，不是空断言。随后**原样恢复**该调用处
（`protocol.ts:1084`）并复跑全量（见下）。

## 5. 验证命令与原始输出

```
> pnpm typecheck && pnpm test

$ tsc --noEmit
$ vitest run

 RUN  v5.0.4 C:/Work/dsh-llm-account

 ✓ tests/core/recovery.test.ts (14 tests) 9ms
 ✓ tests/core/rotation.test.ts (19 tests) 9ms
 ✓ tests/core/adapter.test.ts (2 tests) 3ms
 ✓ tests/smoke.test.ts (1 test) 2ms
 ✓ tests/core/accounts.test.ts (10 tests) 8ms
 ✓ tests/core/catalog.test.ts (12 tests) 8ms
 ✓ tests/core/credentials.test.ts (4 tests) 6ms
 ✓ tests/vendors/commandcode.test.ts (27 tests) 30ms
 ✓ tests/core/transport.test.ts (15 tests) 152ms

 Test Files  9 passed (9)
      Tests  104 passed (104)
```

（上一轮 99 条 → 本轮 104 条。）

## 6. 本次改动的文件

- `src/vendors/commandcode/protocol.ts`（`chunkIsContent`/`usageTotalOf`、`sawContent` 账本、
  `endOfStream(sawContent)` 的 EMPTY_RESPONSE 分支、`hasBufferedToolCall`、`closeMessagesBlocks()`）
- `tests/vendors/commandcode.test.ts`（新增 5 条测试 + `openBlockIndices` 辅助 + 白名单断言）

未碰 `src/core/**`、`src/vendors/opencode/**`、`package.json`、配置与锁定文件；无 `--amend`。

## 7. 残留观察（未改，供控制器记录）

1. **截断（有内容、无终止事件）仍是 `stop`**：宿主 `FinishReasonMap` 没有「截断」取值（§1）。
   若要恢复旧插件的严格口径（`STREAM_CLOSED` 可重试失败、丢弃部分答案），需要 `decodeStream`
   把「未终止」事实经适配器映射成带码的 `LlmError`；那会改变本轮要求「恰好一条 finish」的语义，
   故未做。
2. **有内容 + 未终止时的 finish 不会被 `max-tokens` 规则丢弃工具块**：宿主只在
   `finish.kind === "max-tokens"` 时丢弃 `tool-call` 块（`lib/index.js:1051-1054`）。
   本轮 Item B 要求把打开的 `tool_use` 块补 `block-end` 交出（否则 finish 被开块不变式拒绝），
   于是「截断在半装的工具调用上」会交给宿主一个参数不完整的工具块，reason 是 `stop`。
   这是 Item A/Item B 两条要求在宿主现有词汇表下的一个不可避免的取舍（要么拒绝 finish，
   要么交出半装工具块），记录备案。
