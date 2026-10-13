# Task 12 Report — opencode 适配器 · LlmAdapter、协议、目录与失败映射

- 分支：`work`
- 提交：`d6257ea feat(opencode): adapter, protocol, catalog and failure mapping`（主体）、
  `b184243 docs(opencode): 校正重试策略注释的出处（旧包没有 providerRetryPolicy）`（注释勘误）
- 基线：`27fc044`（开工时），提交时 HEAD 已由**另一路并发工作者**推进到
  `f85a298 fix(commandcode): 投递的代际裁决…`（见「并发观察」一节）
- 结果：`pnpm typecheck` 干净；`pnpm test` **12 文件 / 160 用例全绿**（本任务新增 8 个）

---

## 1. 实现了什么

四个新文件（全部落在允许范围内）：

| 文件 | 内容 |
| --- | --- |
| `src/vendors/opencode/protocol.ts` | 常量（`DEFAULT_BASE_URL` 等）、域校验、目录/元数据请求形状、网关证据记录器、pi-ai 的 `Model` 装配、`GenerateOptions → pi-ai Context` 投影、`AssistantMessageEvent → StreamChunk` 转换、`streamOpencode()`（真正发请求） |
| `src/vendors/opencode/failures.ts` | `classifyGatewayFailure`（旧包 `classifyGatewayError` 的逐条对照）+ `gatewayLlmError` |
| `src/vendors/opencode/catalog.ts` | `parseModels`（`/models` 清单）、`parseModelMetadata`（models.dev）、`createOpencodeCatalog`（内存 TTL，可注入 `fetchImpl`/时钟） |
| `src/vendors/opencode/adapter.ts` | `OpencodeConfig` / `OpencodeAdapterDeps` / `createOpencodeAdapter`，轮换循环、`modelLimits`、`providerRetryPolicy` |

Produces 清单（四项全部落地；`DEFAULT_BASE_URL` 与 `classifyGatewayFailure` 的签名逐字一致）：

- `classifyGatewayFailure(status: number, body: unknown): Rejection | undefined` —— 在 `failures.ts`
- `parseModels(payload: unknown): { entries: CatalogEntry[]; ignored: number }` —— 在 `catalog.ts`。
  **与计划文档的措辞不一致**：`docs/.../phase1-host.md` 第 696 行写的是 `parseModels(payload): CatalogEntry[]`，
  但第 711 行的必需用例是 `const { entries, ignored } = parseModels({ data: [...] })`。用例是硬约束，
  故按用例（也是 commandcode 的 `parseCatalog` 形状）返回 `{ entries, ignored }`。
- `DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"` —— 在 `protocol.ts`
- `createOpencodeAdapter(deps: OpencodeAdapterDeps): LlmAdapter` —— 在 `adapter.ts`；
  `OpencodeAdapterDeps` = 计划要求的 5 个字段（`config` / `rotation` / `quota` / `accounts` / `fetchImpl`）
  **加 2 个可选凭据来源注入点** `resolveStored?` / `resolveEnvironment?`（`pickApiKey` 的 `stored` /
  `environment` 来源必须是注入点；commandcode 的 `CommandCodeAdapterDeps` 也是这个写法，字面量只用 `config.apiKey`）。

## 2. 宿主 `LlmAdapter` 的成员与真实签名

按 `node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts`（第 130-188 行）实现；唯一抽象成员是 `stream`。

| 成员 | 真实签名（宿主声明） | 本适配器 |
| --- | --- | --- |
| `stream` | `abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>` | ✅ `async *stream(options)` —— 轮换循环 |
| `providerInfo` | `providerInfo(provider: string): LlmProviderInfo` | ✅ `{ id: provider, name: "OpenCode Go" }` |
| `providerRetryPolicy` | `providerRetryPolicy(_provider: string): ResolvedRetryPolicy \| undefined` | ✅ 裁决 12 的白名单（含两个超时码） |
| `listModels` | `listModels(_provider: string): Promise<readonly LlmModelInfo[]>` | ✅ 目录 → `selectVisible` → 宿主形状 |
| `resolveModel` | `resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>` | ✅ 上下文 / `defaultMaxTokens` / 推理档位 + `modelLimits` 覆盖 |
| `imageRequestPricing` | `imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing \| undefined` | 不覆盖（本路由不声明图片计价，第 3 期） |
| `prepareCall` | `prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>` | 不覆盖（宿主基类默认实现；Task 9 同样没覆盖） |

与 Task 9 实测一致：抽象面只有 `stream`，其余都是可选覆盖 —— brief 第 2 条控制器的描述成立，无需提问。

## 3. pi-ai SDK 的接入

- **依赖形态（逐字照做）**：`package.json` 的 *devDependencies* 里加
  `"opencode-go-pi-ai": "npm:@earendil-works/pi-ai@1.1.0"`（npm 别名）。
  `npm view @earendil-works/pi-ai@1.1.0 version` → `1.1.0`，包取得到，**没有触发「停下来报告」的条件**。
- **导入方式**（全部经别名）：
  ```ts
  import { createProvider, isContextOverflow, normalizeContext } from "opencode-go-pi-ai";
  import * as anthropicMessages from "opencode-go-pi-ai/api/anthropic-messages";
  import * as openaiCompletions from "opencode-go-pi-ai/api/openai-completions";
  import * as openaiResponses from "opencode-go-pi-ai/api/openai-responses";
  ```
- **调用形状**：`createProvider<OpencodeApi>({ id: "opencode-go", name, baseUrl, auth, models: [model],
  api: { "anthropic-messages": …, "openai-completions": …, "openai-responses": … } })`
  → `provider.streamSimple(model, normalizeContext(context), { apiKey, fetch, headers: attributionHeaders(),
  maxRetries: 0, signal, temperature?, maxTokens? })`。
  与旧包第 7677-7695 行**逐项对应**（`streamSimple` + `fetch` + `x-opencode-session` 属第 2 期 +
  `maxRetries: 0`）；SDK 的 API 与旧插件的用法一致，没有「为另一个 SDK 造适配器」的情况。
- **是否内联：是（实测，不是推断）**。用 `tsdown` 把 `src/vendors/opencode/adapter.ts` 单独构建到临时目录：
  ```
  adapter.js  1.62 MB（1,615,141 字节）
  顶层 import 只有 3 条：rolldown-runtime / 同包 chunk / node:module
  grep 'from "@anthropic-ai/sdk"|"openai"|"opencode-go-pi-ai"|"@earendil-works/pi-ai"' → 0 命中
  grep 'anthropic-version' → true（@anthropic-ai/sdk 的请求头常量在产物里）
  ```
  即：别名包（连同它带的 `@anthropic-ai/sdk` / `openai` / `@google/genai` 等 83 个包）被**打进产物**，
  没有留成运行时外部依赖 —— 正是因为它在 devDependencies 里（tsdown 只把 `dependencies` 外部化）。
  注：真正的宿主入口 `src/index.ts` 目前只有 `PACKAGE_NAME`，opencode 模块要到 Task 14 装配时才接进 bundle，
  所以上面是「单文件入口」的实测；Task 14 接线后 `lib/*.js` 会包含同一份内联代码。

## 4. 对照旧包的行号

**失败词表（`dsh-opencode-go/lib/index.js`）** —— `classifyGatewayError` 位于 **第 7038-7069 行**：

| 词表 | 行号 | 取值 | 本适配器映射 |
| --- | --- | --- | --- |
| `UNKNOWN_MODEL` | 7046 | `modelerror` / `modelnotfound` / `unknownmodel` | （请求级，见 §5） |
| `QUOTA` | 7047-7054 | `creditserror` / `monthlylimiterror` / `userlimiterror` / `gousagelimiterror` / `insufficientquota` / `quotaexceeded` | `quota` |
| `INVALID_CREDENTIAL` | 7055 | `autherror` / `authenticationerror` / `invalidapikey` / `invalidkey` | `invalid-credential` |
| `AUTH` | 7056 | `regionerror` / `datapolicyerror` / `permissionerror` / `permissiondenied` | `unavailable` |
| `RATE_LIMIT` | 7057 | `ratelimiterror` / `ratelimitexceeded` | `rate-limit` |
| 文案 + 状态回落 | 7058-7069 | `isQuotaExceededError` / 密钥文案正则 / 4xx-5xx 分支 | 见 §5 |
| `isGatewayKeyRejection` | **6981-6983** | `failure.code === "INVALID_CREDENTIAL"` | **不搬**：内核 `RotationEngine.markRejected` 就是同一职责，分类已带 `kind`，不需要第二张短期黑名单（`REJECTED_KEY_TTL_MS` 第 7340 行 / 第 7608-7612 行） |

关键点保留了：**先按归一化后的 `error.type` / `error.code` 字符串匹配，词表全不命中才回落到 HTTP 状态**
（旧包第 7045-7046 行先做 `replace(/[^a-z0-9]/gi,"").toLowerCase()`，我用同样的归一化）。

**目录来源**：

| 事实 | 行号 |
| --- | --- |
| `DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"` | 6408 |
| `MODELS_FETCH_TIMEOUT_MS` / `METADATA_FETCH_TIMEOUT_MS` / `STALE_WHILE_REVALIDATE_MS` / `MODEL_LISTING_MAX_BYTES` | 6409 / 6410 / 6411 / 6412 |
| 清单端点 `${baseURL}/models` | 6463 |
| `readLiveModelIds`（只有非空 `id` 算有效行） | 6444-6461 |
| `fetchLiveModelIds`（不带 Authorization；非空清单零有效 id = 发现失败） | 6462-6489 |
| `MODEL_METADATA_URL = "https://models.dev/api.json"` | 6104 |
| `readModelMetadata`：`payload["opencode-go"].models` | 6168-6231（取用键：6169） |
| `modalities.input` → `input` | 6179 / 6220 |
| `provider.npm` → 线协议（`@ai-sdk/anthropic`→anthropic-messages、`@ai-sdk/openai`→openai-responses、`@ai-sdk/openai-compatible`→openai-completions） | 6188 |
| `name` / `limit.context` / `limit.output` | 6214 / 6221 / 6222 |
| `reasoning_options` 的 `type: "effort"` 取值 | 6131-6138 |
| 清单决定成员、元数据决定怎么调用 | 6639-6641 |
| 磁盘缓存路径（本期**不做**） | 6363 |
| `modelBaseURL`（anthropic-messages 去掉结尾 `/v1`） | 6161-6164 |
| 发现只接受 `opencode.ai` 域（`DISCOVERY_UNSUPPORTED`） | 8662-8665 |

其余对照：`modelLimits` schema 6847-6849、`withModelLimit` 7341-7350、`listModels` 7390-7399、
`resolveModel` 7400-7402、`modelInfo` 7437-7453、`stream`/`dispatch` 7464-7510、`streamAccounts` 7511-7607、
`accountFallback` 6968-6980、`streamAttempt` 7618-7748（输出上限收紧 7625-7626）、
`toStreamChunks` 1761-1843、`mapUsage` 1689-1697、`mapStopReason` 1712-1760、
`foreignAssistant` 1139-1176、`parseArguments` 1042-1051、`harnessApiKeyAuth` 6490-6495、
`buildProvider` 6496-6509、`previewBody`/`MAX_BODY_BYTES` 7072-7260/7073、
SDK 的 `normalizeContext`（第 579-583 行，`utils/transcript`）。
**修正**：`RETRY_MAX_DELAY_MS` 原先引用了 commandcode 旧包的行号，opencode 旧包全文没有
`providerRetryPolicy`；已改成「沿用裁决 12 / Task 9 同值」，见第二个提交。

## 5. 状态/正文 → `Rejection.kind` 的映射表

顺序即优先级（先词表、后状态），与旧包第 7038-7069 行一致：

| 输入 | 结果 |
| --- | --- |
| `error.type`/`error.code` ∈ `modelerror`/`modelnotfound`/`unknownmodel` | `undefined`（请求级，不换账号） |
| ∈ QUOTA 六个词 | `quota` |
| ∈ `autherror`/`authenticationerror`/`invalidapikey`/`invalidkey` | `invalid-credential` |
| ∈ `regionerror`/`datapolicyerror`/`permissionerror`/`permissiondenied` | `unavailable` |
| ∈ `ratelimiterror`/`ratelimitexceeded` | `rate-limit` |
| `status <= 0`（没拿到响应：网络/流中途事件） | 文案先看：配额 → `quota`；密钥文案 → `invalid-credential`；限流 → `rate-limit`；否则 `network` |
| 401/402/403/429 且 `isQuotaExceededError(文案)` | `quota` |
| 401/403 且文案匹配 `(invalid\|incorrect\|expired)[ _-]?(api[ _-]?)?key\|invalid credential` | `invalid-credential` |
| 401/402/403 | `unavailable` |
| 404 | `undefined`（模型不存在） |
| 429 | `rate-limit` |
| 408 / 504 / ≥500 | `server`（瞬时，`markRejected` 不入表） |
| 400 / 413 / 422 | `undefined`（请求畸形或上下文超限） |
| 其它 | `undefined` |

`Rejection` → 宿主错误码：`quota→QUOTA`、`rate-limit→RATE_LIMIT`、`invalid-credential→INVALID_CREDENTIAL`、
`unavailable→PROVIDER_HTTP_ERROR`、`server→SERVER`、`network→TRANSPORT`（与 Task 9 共用一套词汇表）。

## 6. 测了什么（8 个用例，brief 要求的 7 个全在）

1. `creditserror / userlimiterror / insufficientquota` → `quota`（402/429 各一）
2. `autherror / invalidapikey` → `invalid-credential`（401）
3. `regionerror / datapolicyerror` → `unavailable`（403）
4. `parseModels({data:[{id,name},{}]})` → 1 条 + `ignored === 1`
5. **端到端轮换**（Review Focus 2）：a 的 402 → 切到 b、b 的 chunk 产出、`a` 进拒绝表，
   且闸门收到的正是 `{emitted:false,totalTokens:0,aborted:false}`；a 先输出再报错 → 已交付的 `"partial"`
   不变、抛出该失败、**b 从未被联系**、闸门收到 `emitted:true`
6. **已消耗 token / 已中止**：a 报过用量但零输出 → 闸门收到 `{emitted:false,totalTokens>0}`，不换；
   调用方预中止 → 抛错、`fetch` 一次都没发、闸门未被调用
7. `listModels` 应用 `modelVisibility: {m2:false}` → 只返回 `m1`
8. （额外，守护我在自审里改掉的一条行为）干净结束但零内容 → 抛宿主的 `EMPTY_RESPONSE`，
   **不换账号**（终态错误交给宿主的重试/压缩策略，不被轮换吞掉）

两个端到端用例**真的驱动 `adapter.stream()`**：假 `fetchImpl` 就是「假传输」，它经 pi-ai SDK 解析真实
Anthropic Messages SSE；「换没换账号」= 假 fetch 看到的密钥序列。用例 5 的第二分支与用例 6 的第一分支
都用 `vi.spyOn(rotation, "fallbackAllowed")` 断言**闸门被问到、且看到的入参正确** —— 不是只看结果猜。

## 7. TDD 证据

**RED（Step 1-2）**

```
$ pnpm vitest run tests/vendors/opencode.test.ts
 ❯ tests/vendors/opencode.test.ts (0 test)
⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯
 FAIL  tests/vendors/opencode.test.ts [ tests/vendors/opencode.test.ts ]
Error: Cannot find module '../../src/vendors/opencode/adapter' imported from
C:/Work/dsh-llm-account/tests/vendors/opencode.test.ts
 ❯ tests/vendors/opencode.test.ts:13:1
 Test Files  1 failed (1)
      Tests  no tests
```
为什么这是「对的原因」：brief Step 2 期望的就是「FAIL，模块不存在」；失败发生在第一个 import 的解析上，
没有任何断言被执行，所以它证明的是「实现缺失」，不是「断言写错」。

**GREEN（Step 4）**

```
$ pnpm vitest run tests/vendors/opencode.test.ts
 ✓ tests/vendors/opencode.test.ts (8 tests) 23ms
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ pnpm typecheck      # tsc --noEmit，无输出
$ pnpm test
 Test Files  12 passed (12)
      Tests  160 passed (160)
```

**第二、第三个 RED→GREEN 循环（加强断言时真的红了）**：

- 加上 `emitted/totalTokens` 探针断言后，用例 6 先红：
  `AssertionError: expected true to be false`（在 `expect(seen?.emitted).toBe(false)`）。
  原因是我那时的 fixture 里带了 `content_block_start`，`emitted` 合法地为 `true` ——
  说明断言咬得住；把 fixture 改成「只用量的无内容失败流」后转绿，且 `totalTokens > 0` 成立。
- 用例 8 先红：`expected 'TRANSPORT' to be 'EMPTY_RESPONSE'`，因为 EMPTY fixture 缺 `message_delta`，
  pi-ai 报的是 `Anthropic stream ended without a stop reason`（传输级）。补上 `message_delta` 后
  `EMPTY_RESPONSE` 才真的从宿主错误码通道出来 —— 测试确实在驱动 pi-ai 的解析路径，不是在自说自话。

## 8. 改动文件

```
 M package.json                     # + opencode-go-pi-ai 别名 devDependency
 M pnpm-lock.yaml                   # 依赖解析结果
 A pnpm-workspace.yaml              # ⚠️ pnpm 11 在安装时自动生成（见「关注点 1」）
 A src/vendors/opencode/protocol.ts
 A src/vendors/opencode/failures.ts
 A src/vendors/opencode/catalog.ts
 A src/vendors/opencode/adapter.ts
 A tests/vendors/opencode.test.ts
```
`src/core/**`、`src/vendors/commandcode/**` 与任何既有测试文件**未改**（`git diff --cached --name-only` 可验）。

## 9. 自审发现（已修 / 已固化）

1. **终态错误原先会被轮换吞掉**：`toHostChunks` 把「空响应 / 上下文溢出」包成 `finish{kind:"error"}`，
   我最初把它转成 `OpencodeStreamFailure` 走分类 → 状态 0 → `network` → 闸门允许时**换账号重放**，
   于是宿主的 `EMPTY_RESPONSE` 重试账本再也看不到它。已按 commandcode 的写法改成直接抛
   `LlmError(码来自 pi-ai)`，`#classify` 对非中止/非超时的宿主错误返回 `undefined` → 原样上抛。
   并用第 8 个用例固化（旧包 `accountFallback` 第 6968-6980 行同样只对 QUOTA/凭据失败换账号）。
2. **usage 与 `emitted` 分离**：按旧包 `streamAccounts` 第 7573-7576 行，usage chunk **不算已输出**
   （只累加 `totalTokens`）、并且**先缓冲**，成功收尾才随 finish 交出。否则「402 零输出」也会被判成
   「已输出」，Review Focus 2 的换账号行为就不成立了。
3. **`AbortSignal` 收窄陷阱**：`options.signal?.aborted === true` 在循环顶检查之后，TS 把后面的同名比较
   收窄成「恒假」（`TS2367`）。改成先取局部布尔量（与 commandcode 第 291 行同法）。
4. **`as never` 型断言去掉**：协议表改成 `Readonly<Record<OpencodeApi, ProviderStreams>>` 后，
   `createProvider<OpencodeApi>` 的类型是自洽的，不需要 `as never`。
5. **`ToolCallId("")`**：宿主 brand 不做校验（`brand.d.ts` 原文「no validation is performed」），
   与旧包第 1798 行一致；但空的 tool-call id 仍然只可能来自 pi-ai 的异常事件，未额外加随机 id 兜底。
6. **`/models` 的鉴权**：与旧包一致**不带** `Authorization`（只有 `accept` + 身份编码 + attribution）。
7. **目录失败语义**：非空清单零有效 id → `DISCOVERY_FAILED`（旧包第 6458 行）；元数据失败 → 降级为
   清单事实（名字退回 id、无上限），**不补 0**。
8. **`MAX_TRIED` / `fallbackAllowed` 是唯一的停止/换号条件**：循环里只有
   `!fallbackAllowed(...)` → 抛、`tried.size >= MAX_TRIED` → 抛、`pick` 返回 `undefined` → 抛最后一次失败。
   没有第二处隐含条件。

## 10. 关注点 / 遗留

1. **`pnpm-workspace.yaml`（需要控制器知晓）**：我按 brief 加了 devDependency 后，pnpm 11 在安装时
   自动生成这个文件并写入 `allowBuilds: {'@google/genai': set this to true or false, protobufjs: …}` 占位符；
   占位符没填时**每一次 `pnpm install`/`pnpm test` 都以 `ERR_PNPM_IGNORED_BUILDS` 退出 1**（我最初就是被它挡住的）。
   我把两项填成 `false`（这两个包只在 pi-ai 的云 SDK 分支里用到，我们不需要它们的构建脚本）并**一并提交**，
   否则新克隆的仓库跑不起来。这一步动了 brief 的文件清单之外的一个文件，请复核；如不接受，可回退该文件，
   但需要另定 `allowBuilds` 的去处。
2. **并发工作者**：开工时树是干净的 `27fc044`；期间 `src/vendors/commandcode/login.ts` 被
   **不是我的**改动写入（23:09），随后该改动以 `f85a298` 提交，我的提交落在它上面。我没有碰那个文件，
   也没有 amend 任何提交。
3. **测试总数**：`pnpm test` 现在是 160 个用例；除本任务的 8 个外，其余 152 个来自既有套件
   （brief 记的基线是 151，多出的 1 个来自上面那次并发提交所在的区间，不是本任务新增）。
4. **`parseModels` 的返回形状**与计划文档措辞不一致（§1 已说明），按必需用例实现。
5. **本期刻意不做**（与 brief 第 7 条一致）：网页登录、额度读取、账号增删改、代理与协议覆盖、客户端页面、
   诊断导出、落盘目录缓存、`thinkingBudgets`、图片/文件投影（图片块在 `toPiContext` 里被丢弃，
   与 commandcode 的 `textOf` 同一处理）。
6. **`x-opencode-session` 头**（旧包第 7689 行）没加：它属于会话身份投影，Task 12 范围里没有它；
   真实网关是否强制该头未在本期验证过。

---

# 修复报告 Round 1

针对复审的三条 Important。提交：`ea12154 fix(opencode): 流内失败的定类、重试码与诊断正文读取期限（复审 Round 1）`
（**新提交，未 amend**；落在并行任务 `be40f57` 之上）。改动仅限我自己的四个文件
（`src/vendors/opencode/{protocol,failures,adapter}.ts` + `tests/vendors/opencode.test.ts`），
未碰 `src/core/**`、`src/vendors/commandcode/**`、opencode 的 `quota.ts`/`accounts.ts`，也未动 Minor 项。

## 修复 1 — 流内 / 无状态失败不再一律倒成 `network`

**改了三处，合成一条正确的优先级**：

1. `protocol.ts` `toHostChunks` 的 `error` 分支：先判调用方中止，再判 `isContextOverflow(event.error, contextWindow)`
   —— 溢出抛 `LlmError(…, CONTEXT_WINDOW_EXCEEDED_CODE)`（宿主的压缩信号）。
   与 `done` 分支、与旧插件 `mapStopReason`（**第 1712-1723 行**，它把溢出放在 switch 最前）逐字同序。
2. `failures.ts`：`status <= 0` 分支不再「认不出来 → network」。新增 `IN_BAND_RULES`，逐条照抄旧插件
   `classifyPiAiError`（**第 1698-1710 行**）：裸 401/403→`unavailable`、429/rate-limit→`rate-limit`、
   413/payload-too-large→请求级、400/invalid-request→请求级、5xx→`server`、
   超时与传输词表（`stream ended before|without`、`network|connection|socket|fetch`、`ECONN*`、
   `other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly`、`terminated|premature close`）
   →`network`；**其余一律 `undefined`**（旧插件第 1710 行的 `PI_AI_ERROR` 语义：确定性终态）。
   结构化词表优先于状态的既有优先级一字未动。
3. `adapter.ts`：分类为 `undefined` 且失败是 `OpencodeStreamFailure` 时，抛
   `new LlmError(failure.message, "PI_AI_ERROR", { cause })` 而不是那个裸的证据载体 —— 宿主拿到稳定且
   **不在 `RETRYABLE_CODES` 里**的终态码；非 `OpencodeStreamFailure` 的失败（`EMPTY_RESPONSE` /
   `CONTEXT_WINDOW_EXCEEDED` 等）仍原样上抛，码不被改写。

**覆盖用例**（新增 2 个）：

- `流内送达的上下文溢出映射为 CONTEXT_WINDOW_EXCEEDED，不换账号也不重试` —— 200 的 SSE `error` 事件
  （`prompt is too long: 300000 tokens > 200000 maximum`）：断言宿主码是 `CONTEXT_WINDOW_EXCEEDED`、
  `fetch` 只见过 key-a、闸门一次都没被调用。
- `认不出来的流内失败是终态（PI_AI_ERROR），不会伪装成 network 去轮换或重试` —— 一头断言纯函数
  「认不出的文案 → `undefined`、真传输文案 → `network`」，另一头断言端到端宿主码是 `PI_AI_ERROR`、
  账号 b 从未被联系、闸门未被调用。

**连带改动（必须说明）**：既有两条「闸门拦住换号」用例（`已输出时报错不切`、`已消耗 token…不切`）
原先用的流内文案是 `gateway exploded mid-stream` / `gateway failed after usage` —— 修复后这类文案是
**不可换号**的终态，那两条就再也不经过闸门了。故把 fixture 文案换成**可归类的额度措辞**
（`insufficient quota for this account`），断言本身未放松（仍然是「闸门被调用 + b 从未被联系」）。
这正是修复 1 的语义：能走到闸门的前提是「这确实是个账号级失败」。

## 修复 2 — 两条要求补上用例

- **(a) 重试白名单**：新增 `providerRetryPolicy 保留两个超时码，且不退化成一个 TIMEOUT`。
  断言 `LLM_REQUEST_TIMEOUT` 与 `LLM_STREAM_IDLE_TIMEOUT` 都在 `retryableCodes` 里、**各自恰好一次**、
  两者互不相等，并且笼统的 `TIMEOUT` 仍在（是并列而不是顶替）。
- **(b) `MAX_TRIED` 上限**：新增 ``尝试次数到达 MAX_TRIED（16）就停下并抛出最后一次失败``。
  账号池给 17 个（`acct-0…acct-16`），全部 402 `insufficientquota`：断言 `fetch` 恰好被调用 **16** 次、
  第一次是 `key-acct-0`、最后一次是 `key-acct-15`、**`key-acct-16` 从未出现**、闸门恰好被调用 16 次，
  且抛出的是**最后一次**失败（宿主码 `QUOTA`）。

## 修复 3 — 诊断正文读取有期限

- `protocol.ts` 新增 `BODY_READ_TIMEOUT_MS = 1_000`（旧插件 `BODY_READ_TIMEOUT_MS` 第 7074 行）。
- `previewBody` 按旧插件 `previewBody`（**第 7094-7135 行**）重写：
  `AbortSignal.any([调用方信号, AbortSignal.timeout(1000)])`（旧插件第 7100 行同式）+
  `Promise.race([reader.read(), aborted])`（第 7111 行同法）+ `finally` 里 `reader.cancel()`；
  超时/中止时**交出已读到的部分**（旧插件返回部分 `text`），`undefined` 表示一个字都没读到。
- `recordGatewayFetch(fetchImpl, callerSignal?)`：状态**先记**（读不动也能按状态分类），
  调用方信号由适配器传入（`recordGatewayFetch(this.#deps.fetchImpl, options.signal)`），
  取消时立刻放弃读诊断正文。

**覆盖用例**：`失败响应的正文读不动时按已有证据降级，不会卡住请求` —— 一个**永不 enqueue、永不 close**
的 `ReadableStream` 作为 402 的正文，直接打在 `recordGatewayFetch` 上：断言 1s 量级内返回、
`evidence().status === 402`（状态永远在）、`body` 为 `undefined`。
**为什么打在记录器这一层**：真把这条不落的正文交给 pi-ai，SDK 自己也会卡在读它上面（`response.text()`
构造 APIError），那不是本适配器能修的；`await gateway.evidence()` 依赖的正是 `previewBody` 这段。

## 变异证据（每条都先注入缺陷、跑到对应用例变红，再逐字节还原）

命令：`pnpm vitest run tests/vendors/opencode.test.ts`（注入后运行；还原后再跑一次 13/13 绿）。

| # | 注入的缺陷 | 观察到的输出 |
| --- | --- | --- |
| M1 | `protocol.ts`：把 error 分支的 `isContextOverflow(event.error, contextWindow)` 换成 `false` | `× 流内送达的上下文溢出映射为 CONTEXT_WINDOW_EXCEEDED…` / `AssertionError: expected 'PI_AI_ERROR' to be 'CONTEXT_WINDOW_EXCEEDED'` / `Tests 1 failed \| 12 passed (13)` |
| M2 | `failures.ts`：`status<=0` 的兜底 `return undefined` 换回 `return rejection("network", …)` | `× 认不出来的流内失败是终态（PI_AI_ERROR）…` / `AssertionError: expected { kind: 'network', …(1) } to be undefined` / `Tests 1 failed \| 12 passed (13)` |
| M3 | `protocol.ts`：`AbortSignal.timeout(BODY_READ_TIMEOUT_MS)` → 永不中止的信号（期限消失） | `× 失败响应的正文读不动时按已有证据降级，不会卡住请求 5006ms` / `pass a timeout value … testTimeout` / `Tests 1 failed \| 12 passed (13)`（即：没有期限就挂住） |
| M4 | `adapter.ts`：从 `RETRYABLE_CODES` 删掉 `LLM_STREAM_IDLE_TIMEOUT` | `× providerRetryPolicy 保留两个超时码…` / `AssertionError: expected [ Array(7) ] to include 'LLM_STREAM_IDLE_TIMEOUT'` / `Tests 1 failed` |
| M5 | `adapter.ts`：删掉 `if (tried.size >= MAX_TRIED) throw classified.thrown;` | `× 尝试次数到达 MAX_TRIED（16）就停下并抛出最后一次失败` / `AssertionError: expected [ 'key-acct-0', … ] to have a length of 16 but got 17` / `Tests 1 failed` |

还原后：`Tests 13 passed (13)`；`git diff --stat` 只剩四个预期文件，无残留变异。

## Round 1 的验证命令与输出

```
$ pnpm typecheck
$ tsc --noEmit            # 干净（仓库级，含并行任务的 opencode-quota 用例）

$ pnpm vitest run tests/vendors/opencode.test.ts
 ✓ tests/vendors/opencode.test.ts (13 tests) 1042ms
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ pnpm test
 ✓ 13 files / 183 tests passed
   （本任务 13 个；并行任务新加的 tests/vendors/opencode-quota.test.ts 18 个也一并跑通）
```

## Round 1 的遗留 / 关注点

1. `PI_AI_ERROR` 是我们自己引入的字符串码（照旧插件第 1710 行），不在宿主的常量表里。
   它与宿主关系正确（不在重试白名单 → 不重试），但若后续想让宿主识别它，需要提升成常量。
2. 1s 的正文读取期限意味着「慢于 1s 的错误正文」会退化成部分/仅状态分类 —— 这是旧插件
   （`BODY_READ_TIMEOUT_MS = 1000`）的取舍，代价可接受：状态永远在，词表命中优先于状态。
3. `IN_BAND_RULES` 把旧插件的 `TIMEOUT` 与 `TRANSPORT` 合并进 `network`：内核只有一个瞬时传输档，
   两者行为一致（都不入拒绝表、都允许同请求内换账号），差别只在文案。

