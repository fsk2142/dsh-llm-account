# 功能分页、自动继续与统一搜索 —— 设计

**日期**：2026-10-20
**状态**：待用户确认
**涉及仓库**：`D:\work\llm-acct-repo`（当前 HEAD `a1f2318`）

---

## 1. 为什么要做

用户在一次会话里提了四件事，它们互相牵连，所以放在一份设计里：

1. **切换策略与网页搜索各自独立出来**，不再散落在三家厂商的选项卡里。
2. **自动继续**：会话非人为中断后自动接着跑。
3. **统一搜索**：优先用网关订阅额度，没有则用用户写入的 DeepSeek API key。
4. **按功能分文件夹**：现在 `src/client/seams.ts` 已经 2900+ 行，改一个功能容易碰坏另一个。

第 4 条不是洁癖，是前三件的**前置条件**：再往一个 2900 行的文件里塞两张选项卡 + 一个搜索提供方，
回归风险会失控。

---

## 2. 已核实的事实（不要重新查）

### 2.1 宿主的三条接缝都存在，都是正规 API

| 需求 | 接缝 | 依据 |
| --- | --- | --- |
| 功能分页 | `settings.section` 页面自己渲染 tab；`createConnectedPage` 目前只喂厂商条目 | `src/client/page.ts` `tabRow` / `settingsTargetSelect` |
| 自动继续（请求失败） | `agent/request-error`：**让监听器重试失败的模型请求** | `dsh-agent/README.zh.md:67` |
| 自动继续（回答截断） | `agent/turn-stopping`：**可通过 steer 使本轮保持打开** | `dsh-agent/README.zh.md:67` |
| 搜索提供方 | `ctx.web.registerSearchProvider`；`dsh-web` 的 `searchProvider` 固定优先级 | `dsh-web/README.zh.md` |
| 会话/agent 上下文 | `ctx.agents.currentInitiator()?.session` | `dsh-web-search-deepseek/lib/index.js:309` |

### 2.2 搜索：网关侧的实测结论（2026-10-20 用真实密钥验证）

| 组合 | 结果 |
| --- | --- |
| opendesign `/v1/messages` + `deepseek-v4.1-flash` + `tools:[{type:"web_search_20250305"}]` | **200，真结果 20 条**（含 `server_tool_use` + `web_search_tool_result`） |
| opendesign + `glm-5.3-flash` / `claude-haiku-5.5` | **400**（不支持） |
| opendesign `/v1/chat/completions` + `tools:[{type:"web_search"}]` | **200 但静默忽略**：模型只输出「web_search query: …」文本，0 结果 |
| opendesign `/v1/messages` + 裸 `{type:"web_search"}` | 200，被当成**普通工具**（`tool_use`），0 结果 |
| commandcode `/provider/v1/messages` + DeepSeek | **400**：该端点只收 Claude 系，DeepSeek 必须走 chat/completions，而那条不支持服务端搜索 |

**三条硬结论**：
1. 服务端搜索**只对 opendesign + DeepSeek 系模型**可用；
2. 工具类型必须是 `web_search_20250305`，写 `web_search` 会被当普通工具；
3. 走错协议时**返回 200 却没有任何结果** —— 这是最危险的降级形态，实现必须显式检测
   `web_search_tool_result` 块，没有就报错，绝不把模型的「我要搜索」文本当结果。

### 2.3 宿主的搜索凭据逻辑（不可改，但要知道）

`dsh-web-search-deepseek/lib/index.js:303-328`：

```js
resolveAccountToken: async (endpoint) => {
  if (currentInitiator()?.session.requestContext()?.provider !== "deepseek-account") return undefined;
  return await ctx.get("deepseekAccount")?.resolveToken(endpoint);
}
```

即：**官方模型用登录 token，其他模型回退 `DEEPSEEK_API_KEY`**。这本就是用户最初描述的行为，
但用户已明确要「网关订阅额度优先」，所以插件要注册自己的提供方，抢在宿主的之前。

### 2.5 三个关键假设都已实测验证

| 假设 | 验证方式 | 结论 |
| --- | --- | --- |
| 新设置字段不会被宿主丢弃 | 读 `commandcode/index.ts` 的 `Config`：`markVolatileFields({...z.object...})` | **必须显式声明**。schemastery 会丢掉未声明字段，不能靠"宽松模式" |
| `session.requestContext()` 能给出 provider + model | 解压真实会话日志，取一条 `request/context` 事件 | ✅ `{"provider":"deepseek-account","model":"deepseek-flash","contextWindow":1000000,...}` |
| `requestContext()` 的来源 | 读 `dsh-session/lib/index.js` | 它是 `request/context` 事件的 fold，返回 `{...event.data}`（无事件时为 `undefined`） |

### 2.6 当前凭据库现状

`.credentials.yaml` 的 refs 里**没有** `DEEPSEEK_API_KEY`（只有 commandcode 两把、
opendesign 三把）。所以 API 兜底路径现在是空的，必须先让用户填。

---

## 3. 目标与非目标

### 目标

- 设置页出现一张**「切换与搜索」**选项卡，包含两台功能（切换策略、网页搜索），
  每台都可整体**开关隐藏**。
- 自动继续：请求失败重试 **和** 回答截断补继续，两者都可单独开关，默认**关闭**。
- 搜索：插件注册提供方，按「opendesign + DeepSeek 系 → 网关额度；否则 → API key」选路。
- 目录重构：把 `client/` 与 `core/` 按功能分文件夹，`seams.ts` 拆分。

### 非目标（明确不做）

- **不给 commandcode 做服务端搜索**：它结构上不支持（实测 400）。
- **不劫持用户手动停止**：用户按停止就是不继续。
- **不改宿主包**：`dsh-web-search-deepseek` 是宿主的，我们只在它旁边注册自己的提供方。
- **不重写 UI 版式**：选项卡沿用现有 `.dsl-card` / tab 样式。

---

## 4. 设计

### 4.1 「功能页」概念（新）

现在 `state.tabs` 全部由厂商条目生成。新增**第二类 tab**：功能页（feature page）。

```
tabs = [ ...厂商页(commandcode, opencode, opendesign), ...功能页(switch+search) ]
```

- 功能页的 `ns` 是一个虚拟命名空间（如 `llm-account-features`），不对应任何厂商设置文档；
  它的值存在**承载行**上（见 4.2）。
- 功能页由插件静态声明，不经 `discoverVendors`。
- **可隐藏**：功能页内部每台功能有一个 `enabled` 布尔；关闭时该台整块不渲染，
  但**选项卡本身保留**（否则用户没有入口把它重新打开——这与「移除模型后仍需可见入口」
  是同一条既有纪律）。

### 4.2 设置存放位置

新增的设置字段放进**已有的承载行**，不新建 profile 行（少一行少一份启动风险）：

| 字段 | 归属 ns | 含义 |
| --- | --- | --- |
| `featureSwitchEnabled` | `llm-commandcode` | 切换功能整块显示与否 |
| `featureSearchEnabled` | `llm-commandcode` | 搜索功能整块显示与否 |
| `autoContinueOnError` | `llm-commandcode` | 请求失败自动重试 |
| `autoContinueOnTruncate` | `llm-commandcode` | 回答截断自动继续 |
| `autoContinueMaxRetries` | `llm-commandcode` | 重试上限（默认 3） |
| `searchPreferGateway` | `llm-commandcode` | 优先用网关额度（默认 true） |
| `searchApiKeyEnv` | `llm-commandcode` | API key 的凭据引用名（默认 `DEEPSEEK_API_KEY`） |

**为什么都挂 `llm-commandcode`**：它已是本插件的配置行，且 `commandcode` 在启动顺序里最先
注册。功能页的设置是**全局**的，与厂商无关，所以只需要一个固定承载处，不需要镜像到三家
（现存的 `sharedKeys` 镜像机制对新字段不再适用，这反而简化了逻辑）。

> 各家的 `Config` schema 需要接受这些新字段（`z.object` 宽松 or 显式声明）。**必须显式声明**，
> 否则宿主的 schemastery 会把未知字段丢掉。

### 4.3 搜索提供方选路

```
registerSearchProvider({
  id: "llm-account-gateway",
  // 可用性：至少有一条路能走
  available: () => hasGatewayPath() || hasApiKey(),
  search: async (request) => {
    // 1) 开关关掉 → 直接 throw（不该被选中，但纵深防御）
    // 2) 会话在 opendesign 且模型属 DeepSeek 系 → 走网关 /v1/messages
    // 3) 否则 → 走 api.deepseek.com/anthropic/v1/messages + API key
  }
})
```

选路的**判定依据**：`ctx.agents.currentInitiator()?.session.requestContext()` 给出会话的
`provider` 与 `model`。

- `provider === "opendesign"` 且 model 命中 DeepSeek 系（复用 `modelKeyOf` / 前缀判定）
  → 网关路；
- 其余 → API 路。

**硬性断言**：响应里没有 `web_search_tool_result` 块 → 抛 `WEB_PROVIDER_ERROR`，
文案说明「网关没有真正执行搜索」。绝不返回空 sources 冒充成功。

### 4.4 自动继续

两个独立开关，都用宿主的对应接缝：

**A. 请求失败重试（`agent/request-error`）**
- 条件：`autoContinueOnError` 开；失败分类属**瞬时**（`server`/`network`/`timeout`/
  `rate-limit`），不含 `invalid-credential`、`quota`、`context_window_exceeded`。
- 退避：指数退避，上限 `autoContinueMaxRetries`（默认 3）；超过后放行原错误。
- **不许**重试用户主动中止（`ABORTED`）。

**B. 回答截断补继续（`agent/turn-stopping`）**
- 条件：`autoContinueOnTruncate` 开；本轮 `finish.reason === "length"`。
- 动作：`steer` 一条用户消息（内容可配置，默认「继续」），使本轮保持打开。
- 同样受 `autoContinueMaxRetries` 约束，防止无限续写。

**共同的防失控**：每轮最多 N 次、同一轮内计数、开关关掉即停。

### 4.5 目录重构（分文件夹）

目标结构（只列会变的）：

```
src/
  core/                       # 纯逻辑，保持扁平（已有 20 个文件，但每个都小）
    usage/                    # ← 新：用量统计一族
      stats.ts ledger.ts report.ts export.ts failures.ts billing-period.ts
  features/                   # ← 新：每台功能一目录
    switching/                # 切换策略（原 core/rotation + core/switching + core/model-fallback）
    autocon­tinue/            # 自动继续（新）
    search/                   # 搜索提供方（新）
  client/
    usage/                    # ← 新：用量 UI
    switching/                # ← 新：切换 UI
    search/                   # ← 新：搜索 UI
    seams/                    # ← seams.ts 拆分
      index.ts remote.ts state.ts registration.ts
```

**顺序要求**：先做 4.5 的**机械搬迁**（不改逻辑，只移动 + 改 import），跑测试确认全绿，
再做新功能。否则新功能会与重构混在一起，出问题分不清是谁的错。

---

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 网关 200 但无结果（实测撞到） | 显式检测 `web_search_tool_result`，缺失即报错 |
| 自动继续无限循环 | 次数上限 + 瞬时失败白名单 + 用户中止不重试 |
| 目录重构把功能改坏 | 先纯搬迁、跑全量测试、单独提交，再动功能 |
| 新设置字段被宿主丢弃 | 三家 `Config` 显式声明字段（不靠 schema 宽松） |
| 功能被隐藏后没有入口 | 选项卡常驻，只隐藏内部块；与「移除模型仍可见」同一条纪律 |
| `seams.ts` 拆分引入循环依赖 | 按 index → remote → state → 注册 单向依赖；用 `tsc` + 现有 78 个测试文件兜底 |

---

## 6. 分期

| 期 | 内容 | 可否独立验收 |
| --- | --- | --- |
| P0 | 目录机械搬迁 + `seams.ts` 拆分，**不改任何行为** | 是（全量测试全绿） |
| P1 | 功能页 tab + 两台功能的开关隐藏 | 是（设置页可见） |
| P2 | 自动继续（两个开关） | 是（可观测重试/续写） |
| P3 | 搜索提供方 + 选路 + 硬性断言 | 是（手工搜一次看来源） |

每期独立提交、独立推送。P1 依赖 P0 的结构，P2/P3 互不依赖。

---

## 7. 待用户确认

1. **自动继续的默认值**：我按「默认关闭」设计（与 `autoSwitchModelOnQuota` 一致）。
   要不要默认开？
2. **承载行**：功能页设置挂在 `llm-commandcode` 行上。若你希望它独立成一行，
   需要新增 profile 行——多一份启动风险，我不建议。
3. **API key 由谁填**：需要你在设置页填一次 `DEEPSEEK_API_KEY`（或改 `searchApiKeyEnv`
   指向已有凭据）。我无法代填。
4. **分期顺序**：建议 P0 → P1 → P2 → P3。若要先把搜索用起来，可以 P0 → P1 → P3 → P2。

---

## 8. 未解决的技术疑点（实现时要先验证，不要假设）

1. **`agent/request-error` 的确切签名与分发 mode**：`dsh-agent/README.zh.md:67` 说它「让监听器
   重试失败的模型请求」，但参数形状、返回值语义（返回什么表示"我重试了"）没有在 README 里
   展开。**实现前必须去 `docs/subsystems/core.zh.md` 的生成区块或包源码里读确切签名。**
2. **`agent/turn-stopping` 的 steer 用法**：同样只有一句话描述。需要确认是
   `steer(message)` 还是通过 `Agent.inbox.append`。
3. **`ctx.web.registerSearchProvider` 的 provider 接口形状**：`dsh-web` README 只给了
   `searchProvider` 配置字段与选择策略，没给 `registerSearchProvider` 的参数签名。
   实现前要从 `dsh-web/lib/index.js` 读真实形状，或照抄
   `dsh-web-search-deepseek/lib/index.js:330-340` 的 `apply()` 写法。
4. **opendesign 适配器加第二条协议的成本**：搜索走 `/v1/messages`，而适配器现在只有
   `chat/completions`。可以在搜索提供方里**直接发 HTTP**，不必改动画器 —— 这样耦合最小，
   但等于在 `features/search/` 里重复一份最小请求构造。**倾向后者**（隔离优于复用）。

> 这四条都是"实现前必须先读源码确认"的，不能靠猜。设计文档把它们列出来，是为了避免
> 实现者（包括我自己）照着 README 的一句话描述去写代码。

