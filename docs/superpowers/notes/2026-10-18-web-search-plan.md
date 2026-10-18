# 网页搜索设置施工单（2026-10-18）

用户需求（已确认的落点）：在 dsh-llm-account 设置页新增「网页搜索」卡片，三选一：
1. **跟随模型账号**（账号网关原生搜索，不另配 key）——我去验证支持性，不支持就明确说明；
2. **DeepSeek 官方**（宿主内置的 `deepseek-official` 原生搜索）；
3. **第三方 API**（通用自定义：自己填接口地址 + Key）。

## 0. 宿主事实（已从 app.asar 提取原件，逐条对齐）

- 搜索 seam：`@deepseek-ai/dsh-web` 提供 `ctx.web.registerSearchProvider(provider)`；
  插件声明 `const inject = ["web"]` 即可拿到 `ctx.web`（`dsh-web-search-deepseek` 的原件写法）。
- Provider 契约（asar @96662117）：
  ```ts
  interface WebSearchProvider { id: string; available(): boolean; search(req: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>; }
  interface WebSearchRequest { query: string; maxResults?: number; }
  interface WebSearchResult { content?: string; sources: readonly WebSearchSource[]; truncated: boolean; }
  interface WebSearchSource { url: string; title?: string; snippet?: string; publishedAt?: string; }
  ```
- 选择规则（`dsh-web` 文档）：配置了 `searchProvider` 就用它；没配且恰好一个可用 provider 用时就用它；
  配置的 id 不可用/歧义/没有可用 provider → `WEB_PROVIDER_UNAVAILABLE` / `WEB_PROVIDER_AMBIGUOUS`。
- 原生搜索的**官方参照实现**（`@deepseek-ai/dsh-web-search-deepseek`，asar 提取到
  `%TEMP%\opencode\asar-extract\dshdsh-web-search-deepseek\`）：
  - `POST {baseURL}/messages`，headers：`x-api-key` + `authorization: Bearer` +
    `anthropic-version: 2023-06-01` + `content-type` + `accept`，`redirect: "error"`；
  - body：`{ model, max_tokens, messages: [{role:"user", content:[{type:"text", text:"Perform a web search for the query: <q>"}]}], tools: [{type:"web_search_20250305", name:"web_search", max_uses}], thinking:{type:"disabled"} }`；
  - 解析：只认结构化块 —— `web_search_tool_result` → `content[]` 里的 `web_search_result`
    （`url` / `title` / `page_age`→`publishedAt`），snippet 来自 text 块 `citations[].cited_text`
    按 url 取首个；按 url 去重；`content` 一律不返回（模型散文不可信）；无结果块 = 报错不降级；
  - 错误码：缺凭据 `WEB_PROVIDER_CREDENTIAL_MISSING`、取消 `WEB_ABORTED`、其余（含无结果块、HTTP、解析）
    `WEB_PROVIDER_ERROR`；错误文案里给出「怎么配置」的指引。
  - Config 用 schemastery：`z.string().role("secret"|"credential-ref").volatile()`、`z.number().step(1).min(1).default(...)`；
    默认值可回落到 `launchEnvironmentOf(ctx).get(ENV)`。
- 宿主自己的「Web 搜索」卡片（`@deepseek-ai/dsh-client-ui-settings-web-search`）：
  只提供 DeepSeek 两种（`searchProvider`: `deepseek-official` / `deepseek-search-api`；
  `fetchProvider`: `http` / `deepseek-fetch-api`），Key 通过 `ctx.remote.credentials.set(ref, value)` 写；
  订阅 `credentials/reference-updated` 事件；**它不认第三方 provider**（它只列自己的两个选项）。
- 客户端写设置：`remote.settings.describe()` → 命中行名（`row.ns`/`row.id`）→
  `settings.mutate(row, [{op:"set",path:[field],value}], revision)`（本项目 `seams.ts::saveSettings` 已有）。
  宿主只允许写 **volatile** 路径。
- 客户端凭据：`ctx.remote.credentials.describe([ref])` / `.set(ref, value)`（宿主卡片同款；客户端注入
  `"remote.credentials"`）。

## 1. 命名与决定

| 项 | 取值 |
|---|---|
| provider id（写进 `web.searchProvider`） | `llm-account-web` |
| 设置行 id | `llm-account-web-search` |
| 模块说明符 | `"dsh-llm-account/web-search"`（包内 patch 插入行） |
| 包侧命名空间 | `llm-account-web-search` |
| 第三方 Key 默认引用 | `LLM_ACCOUNT_SEARCH_KEY` |
| 卡片位置 | 设置页底部（厂商 tab 主体之后、跨厂商），`PageShellProps.webSearch` |

模式：`mode: "account" | "custom"`（宿主 `web.searchProvider` 指向 `deepseek-official` 时本模块不参与）。

**账号模式支持面（v1）**：只对「Anthropic 兼容且网关会转发 `web_search` 服务端工具声明」的厂商开放。
实查：Command Code Provider API 文档原文「built-in declarations such as `web_search` are forwarded for
the upstream to accept or refuse」→ 支持（上游可能拒绝，拒绝即报错不降级）；OpenDesign（AMR）与 opencode
是 OpenAI Chat Completions 协议，无可声明的服务端搜索工具 → 卡片上明确显示「不支持」并给出原因，绝不假装能用。
以后要扩：在 `src/web-search/support.ts` 的 `NATIVE_SEARCH_VENDORS` 里加一条（端点/鉴权构造）。

## 2. 服务端（新目录 `src/web-search/`）

1. `support.ts`（纯数据，前后端共用，无 Node 依赖）
   - `WEB_SEARCH_PROVIDER_ID = "llm-account-web"`、`WEB_SEARCH_NAMESPACE = "llm-account-web-search"`、
     `DEFAULT_SEARCH_KEY_REF = "LLM_ACCOUNT_SEARCH_KEY"`；
   - `NATIVE_SEARCH_VENDORS: Record<VendorId, { label: string; supported: boolean; reason?: string }>`
     （v1：commandcode = supported；`dsh-opencode-go`/`opendesign` = unsupported + 人话原因）。
2. `config.ts` — schemastery `Config`（**全部 `.volatile()`**）：
   `mode`、`endpoint`、`method`(GET/POST)、`queryParam`(默认 `q`)、`queryField`(默认 `query`)、
   `keyField`(默认空：Key 放请求体时的字段名)、`resultsPath`(默认空=自动探测)、
   `apiKeyEnv`(`.role("credential-ref")` 默认 `LLM_ACCOUNT_SEARCH_KEY`)、`authHeader`(默认 `Authorization`)、
   `authScheme`(默认 `Bearer`，可为空=裸值)、`maxResults`(默认 8)。
3. `account.ts` — 账号模式：
   - `activeRoute(settings)`：`describe()` 找行 `agent-default-model` → `{provider, model}`；
   - 映射厂商行：`commandcode` → 行 `llm-commandcode`（读 `apiKeyEnv`、可选 `baseURL`）；
   - `searchViaAccount({...})`：POST `{base}/v1/messages`（CC 的 Anthropic 端点，基址与鉴权与
     `src/vendors/commandcode/protocol.ts` 对齐，注释标明「同源，改一处要改两处」），
     body/解析/错误码照 `dsh-web-search-deepseek` 的原件（MIT，注释注明来源与差异）；
   - 不解厂商 → `WebError`（`WEB_PROVIDER_ERROR`）人话说明「当前模型账号（…）不支持原生联网搜索，
     请在「网页搜索」里改选 DeepSeek 官方或第三方 API」。
4. `custom.ts` — 第三方模式：GET（`queryParam` 拼 query）或 POST（JSON body `{[queryField]: query, max_results}`，
   `keyField` 非空时 Key 进 body；否则走 `authHeader`/`authScheme` 头）；结果数组自动探测
   （`resultsPath` 优先，其次 `results`/`data`/`data.results`/`data.web.results`/`web.results`/`organic`/
   `organic_results`/`items`/`hits`），字段自动映射（url←url|link|href，title←title|name|headline，
   snippet←snippet|content|description|text|summary，publishedAt←publishedAt|published_at|date|page_age）；
   `content` 取顶层 `answer`/`data.answer`/`summary`（字符串时）；HTTP/解析失败 → `WebError` 且带端点与状态；
   数组探测失败 → 报错并提示「把 resultsPath 填成结果数组的字段路径」。
5. `index.ts` — 模块入口：`export const name = "web-search"`、`export const inject = ["web"]`、`Config`、
   `apply(ctx, config)` 注册 `new LlmAccountWebSearchProvider(providerOptions)`（每次调用重新快照 Config，
   照宿主的 thunk 模式）。可选注入（settings/credentials）一律 `ctx.get(...)?.` 取，缺席时按未配置处理。

## 3. 客户端

6. `src/client/web-search-card.ts` — 纯 props → 元素树（无 Hook/状态）：
   - 三个单选（`data-web-search-mode`）+ 每项说明；当前生效 `web.searchProvider` 显示（`data-web-search-effective`，
     漂移时提示「已由其它设置改动」）；
   - 账号模式的厂商支持状态行（`data-web-search-account`：直接人话，含理由）；
   - DeepSeek 官方模式的提示行（「需要 DeepSeek Key：在宿主自带的『网页搜索』卡片里填」）；
   - 自定义模式的字段（endpoint / 高级：method、queryParam、queryField、keyField、resultsPath、authHeader、
     authScheme、maxResults）+ Key 输入（`type=password`，显示「已配置/未配置」，写 `remote.credentials.set`）；
   - 保存按钮 + 失败原因（`data-web-search-error`，原文进 data 属性）。
7. `seams.ts` — 容器组件 + 数据/动作：
   - 读：`describe()` 取三行（`llm-account-web-search` / `web` / `agent-default-model` / `llm-commandcode`），
     `remote.credentials.describe([ref])` 判 Key 是否已配置；
   - 写：`saveSettings(我们的行, fields, rev)` + 需要时同时写 `web.searchProvider`（同一保存动作两行都写，
     任一失败都要显示原因，不静默）；Key 走 `remote.credentials.set`；
   - 订阅 `settings/document-updated` 与 `credentials/reference-updated` 刷新；
   - 兜底：宿主拒绝跨行写 → 显示宿主原因 + 提示「也可以去宿主自带的『Web 搜索』卡片选 DeepSeek 官方」。
8. `page.ts` — `PageShellProps.webSearch?: ReactNode`，渲染在厂商主体之后。
9. `copy.ts` — 新增键（zh+en 成对）：`webSearch.*`（title/intro/mode 三条/字段标签与提示/保存与失败/
   当前生效/账号不支持/Key 已配置等）。
10. `css.ts` — 复用现有 class；最多加一个单选行 class。

## 4. 注册点与构建

- `package.json`：`exports` 加 `"./web-search"`；`peerDependencies` 加 `"@deepseek-ai/dsh-web"`（devDeps 已有）。
- `tsdown.config.ts`：entry 加 `web-search: "src/web-search/index.ts"`。
- `cordis.patch.yml`：insert 行 `- id: llm-account-web-search` / `name: "dsh-llm-account/web-search"`。
- 用户 profile patch **不需要**手动加行（bundle patch 会插入）；config 覆盖按行 id 即可。

## 5. 测试

- `tests/web-search/account.test.ts`：假 fetch —— 正常结果块映射（url/title/page_age/引用 snippet、去重）、
  无结果块→`WEB_PROVIDER_ERROR`、401/402 文案、取消→`WEB_ABORTED`、缺 key→`WEB_PROVIDER_CREDENTIAL_MISSING`。
- `tests/web-search/custom.test.ts`：GET/POST 组装（含 `keyField` 进 body）、结果数组自动探测各形态、
  resultsPath 覆盖、字段映射、失败不静默。
- `tests/web-search/support.test.ts`：`available()` 语义（端点非法、mode=custom 未配置端点、账号模式厂商不支持）。
- 客户端：`tests/client/web-search-card.test.ts`（纯渲染：三个单选、按 mode 显示字段、失败文案）。
- 既有断言同步：`tests/client/registry.test.ts`（新增命名空间）、`boot-graph.test.ts`（新行 id）、
  `build.test.ts`（`lib/web-search.js` 的 import 白名单）。

## 6. 验收

1. 设置页底部出现「网页搜索」卡片；三个选项齐全，账号模式下若当前模型账号是 Command Code 显示「支持」，
   是 opencode/OpenDesign 显示「不支持 + 原因」。
2. 选「第三方 API」并填端点/Key 后保存 → 宿主 `web.searchProvider` 变为 `llm-account-web`；
   让会话里的模型调用 `web_search` 能返回结果（端点若是 Tavily/Serper 等通用形态）。
3. 选「DeepSeek 官方」→ 写回 `deepseek-official`；自定义 Key 只写入宿主凭据库，绝不进设置文档或日志。
4. 任何失败（网关拒绝、跨行写被拒、端点 404）都在卡片上显示人话原因，不静默。
5. `tsc --noEmit` 0 错；`vitest run` 全绿；`tsdown` 产出 `lib/web-search.js`。

## 7. 纪律

- 不 `git commit`；厂商行为不动；卡片纯函数；文案 zh/en 成对；诊断原文只进 `data-*`。
- 账号模式的请求里不落任何密钥到日志/会话事件；参照宿主的 `web/deepseek-search-llm-request` 事件无需照搬。

## 8. 施工进展（2026-10-18 晚 · 实施记录）

已完成（`tsc --noEmit` 0 错；新测试 48 例全绿）：

- **服务端**（与计划的差异：`config.ts`/`account.ts` 合并掉了）
  - `src/web-search/support.ts`：规格里的纯数据表，另加 `nativeSearchSupportOf()`（未登记厂商一律「不支持 + 报路由 id」）。
  - `src/web-search/util.ts`：`WebError` 构造、`stringField`、abort 判定等共用件。
  - `src/web-search/anthropic.ts`：账号模式（CC 网关的 Anthropic Messages + `web_search` 服务端工具），
    与 `dsh-web-search-deepseek` 原件 1:1（另加 401/402 分文案与 identity/attribution 头）。
  - `src/web-search/custom.ts`：第三方模式（GET/POST、`keyField` 进 body 或认证头、结果数组自动探测 + 字段别名映射）。
  - `src/web-search/provider.ts`：`WebSearchProvider` 实现（`available()` 语义：账号模式下厂商支持且密钥已配置）。
  - `src/web-search/index.ts`：行入口（`name`/`inject: ["web"]`/全 volatile `Config`/`apply` 注册 provider），
    服务端按候选行名现读 `settings.describe()`（与 `assembly.ts::requireSettingsRow` 同判据：数组 + `row.ns`）。
  - **差异**：没有做 `maxResults` 配置项（不发结果数参数，截断由宿主 seam 决定）。
  - 测试：`tests/web-search/{anthropic,custom,provider}.test.ts`（32 例）。
- **客户端**（与计划的差异：容器独立成文件，`seams.ts` 只加一行挂载；`css.ts` 未改，全用现有 class）
  - `src/client/web-search-card.ts`：纯渲染。实际 data 属性名：`data-web-search`（根）、
    `data-web-search-option` / `data-web-search-radio`（三选一）、`data-web-search-effective`、
    `data-web-search-route` / `-supported` / `-account-key` / `-account-ref`（账号模式）、
    `data-web-search-field`（第三方字段）、`data-web-search-key` / `-key-status` / `-key-ref`、
    `data-web-search-save` / `-notice` / `-error` / `-problem`。
  - `src/client/web-search-panel.ts`：容器（自持 `useState`/`useEffect` + `subscribeCredentials`）。
    保存语义：① 总是写本行（mode + 第三方字段）；② 第三方 Key 非空才 `credentials.set`；
    ③ 前提不满足**不切**宿主 `web.searchProvider`，提示「已保存设置；未切换搜索来源：<原因>」。
  - 测试：`tests/client/web-search-card.test.ts`（8 例）+ `tests/client/web-search-panel.test.ts`（8 例，迷你 React 真挂载）。

待接线（等 OpenDesign 子代理完工，避免同文件冲突）：

1. `src/client/copy.ts`：`webSearch.*` 键（zh+en 成对；当前卡片/面板引用的键见两个新文件的 `t(...)` 调用）。
2. `src/client/page.ts`：`PageShellProps.webSearch?: ReactNode` + 在厂商主体之后渲染。
3. `src/client/seams.ts`：`import { WebSearchPanel }` + `PageShell({ ..., webSearch: createElement(WebSearchPanel, { ctx, t }) })`。
4. `package.json`：`exports` 加 `"./web-search"`；`peerDependencies` 加 `"@deepseek-ai/dsh-web"`（范围与其它 dsh-* 一致）。
5. `tsdown.config.ts`：host entry 加 `"web-search": "src/web-search/index.ts"`。
6. `cordis.patch.yml`：insert 行 `- id: llm-account-web-search` / `name: "dsh-llm-account/web-search"`（子路径形式，不新增 scan-visible 源）。
7. 既有断言同步：`tests/client/boot-graph.test.ts`（行 id 清单）、`tests/client/build.test.ts`（`HOST_BUNDLES` 加 `lib/web-search.js`，期望集合以构建产物为准）、
   `tests/client/registry.test.ts`（若该清单断言了命名空间全集）。
8. `tsdown` 重建 `lib/`（`lib/web-search.js` 必须存在，`./web-search` 导出才可被宿主加载）→ 请用户重启宿主验收。
9. 真机验收：本机没有 `DEEPSEEK_API_KEY`，所以「DeepSeek 官方」一条只验证「写回 `deepseek-official`」，
   不验证宿主搜索能否成功；账号模式要人在会话里让模型调 `web_search` 才能端到端证明 CC 网关真的转发。

## 接线完成（2026-10-18 晚，接手 agent）

上面「待接线」清单 1–8 **全部完成**，逐条对应：

1. `src/client/copy.ts`：`webSearch.*` 键已进 `CopyKey` 联合类型 + zh/en 两字典（53 个键，含 field/key 的字段与提示）。
2. `src/client/page.ts`：`PageShellProps.webSearch?: ReactNode`，在 `vendorBody` 之后渲染。
3. `src/client/seams.ts`：`createConnectedPage` 内 `const webSearch = useWebSearchPanel(ctx, t);` 传给 `PageShell`。
   **与施工单的差异**：面板做成**自定义 Hook**（`useWebSearchPanel`）而不是独立容器组件 ——
   迷你 React 夹具只把挂载根当 Hook 实例，带 Hook 的子元素会在测试遍历树时于渲染外展开
   （`mini-react: useState outside of render`，实测 12 条）。Hook 全落根实例，符合 Ruling 22。
4. `package.json`：`exports["./web-search"]` + `peerDependencies["@deepseek-ai/dsh-web"]` 已加。
5. `tsdown.config.ts`：host entry 已加 `"web-search": "src/web-search/index.ts"`。
6. `cordis.patch.yml`：已加 `- id: llm-account-web-search` / `name: "dsh-llm-account/web-search"`（子路径形式）。
7. 既有断言同步：`boot-graph.test.ts`（四行）、`build.test.ts`（`HOST_BUNDLES` 加 `lib/web-search.js`，
   期望集合按产物：`dsh-credentials`、`dsh-llm`、`dsh-web`、`schemastery`）、`registry.test.ts`（三家）。
8. `tsdown` 已重建：`lib/web-search.js` + `lib/web-search.d.ts` 存在，导出可被宿主加载（四个宿主入口都已用 Node 直接 import 验证过）。

**待真机验收**（同第 9 条）：需要用户重启宿主，并在会话里让模型调 `web_search` 才能端到端证明。
