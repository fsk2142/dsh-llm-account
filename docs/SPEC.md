# 设计规格（唯一权威）

本文件是本仓库的**设计与契约权威**。实现与本文冲突时以本文为准；要改设计先改这里。

三份分期规格按时间顺序并入：第 1 期（架构与装配）、第 2 期（切换策略与界面密度）、
第 3 期（功能分页、自动继续与统一搜索）。后面的期次**增量覆盖**前面的对应小节。

---

## 第 1 期：架构、装配与适配器

- 日期：2026-10-13
- 状态：待用户评审
- 范围：第 1 期（共享内核 + 统一账号中心）
- 目标读者：本项目的实现者与验收者

## 1. 背景与目标

用户本机（DSH profile `desktop`）已安装两个互相独立的 LLM provider 插件：

| 包 | 版本 | 能力 |
| --- | --- | --- |
| `@mars-sea/dsh-commandcode-provider` | 0.12.10 | 网页登录、多账号轮换、额度面板、实时模型目录、Models 页卡片、联网搜索、费用估算、ZDR、TUI 设置页 |
| `dsh-opencode-go` | 0.1.22 | 多账号、订阅用量胶囊、代理、协议覆盖、图片配额、错误诊断导出 |

两者都能管「多个账号」，但各管各的：两个设置页、两套账号列表、两套轮换逻辑、两套额度 UI。

**目标**：做一个插件 `dsh-llm-account`，**一个设置页统一管理多个厂商的账号**，聊天时按所选模型路由到对应厂商；首期接入 Command Code 与 OpenCode Go 两家，架构上预留第三家。

**最终目标形态**是「全量对齐」两个插件的现有能力（用户已确认），但按三期交付。

### 成功标准（第 1 期）

1. 装一个新包，卸载两个旧包后，`commandcode/<model>` 与 `dsh-opencode-go/<model>` 两条链路都能正常出字。
2. 一个设置页里能同时看到并操作两家厂商的账号：添加、重命名、换 key、删除、选当前账号。
3. 每个账号能显示额度/状态（两种数据形状都能渲染）。
4. 多账号自动轮换可用：额度耗尽/密钥失效时切到下一个账号；请求一旦开始输出就不再切。
5. 用户现有配置（两个 CC 账号、`visibleModels` 白名单、开关、OC 的 `modelVisibility` 与 `autoSwitch`）**零迁移**继续生效。
6. 用户现有按 provider id 的引用（`subagent-director`、子代理模型白名单）不需要改动。

## 2. 来自对话的约束（已确认的决定）

| 决定 | 选择 |
| --- | --- |
| 插件形态 | 统一账号中心：一个插件、一个设置页、多厂商账号 |
| 首期厂商 | 仅 Command Code + OpenCode Go |
| 功能范围 | 全量对齐，但分三期交付 |
| 分期 | 已认可三期拆法（见 §3） |
| 装配方式 | **方案 A：同包双行**（见 §5） |

### 兼容性约束（硬性）

- provider 路由 id 必须是 `commandcode` 与 `dsh-opencode-go`。
- 设置命名空间必须沿用 `llm-commandcode` 与 `llm-opencode-go`。
- 配置文件的行 id 必须沿用 `llm-commandcode` 与 `opencode-go`。

理由：用户 profile patch 里 `subagent-director`（`defaultProvider: commandcode`）、子代理模型白名单（`provider: commandcode`）等都按 provider id 引用；两个命名空间里有真实账号与模型可见性配置。

## 3. 分期

| 期 | 内容 |
| --- | --- |
| **第 1 期**（本文档） | 厂商适配器接口、账号存储与凭据、统一设置页（添加/重命名/换 key/登录/固定/排序）、模型目录与选择器、请求转发内核、多账号轮换与手动切换、额度读取 —— 两条链路可对话 |
| 第 2 期 | 侧边栏额度卡片（**必须跟随自动切换后的生效账号，见 §8.1 —— 这是对旧插件缺陷的修正**）、用量面板与斜杠命令、Models 页快捷卡片、会话费用估算、TUI 设置页、模型白名单/思考档位/上下文覆盖等选择器细节（**摆放与卡片形状对齐现有 Command Code 插件**） |
| 第 3 期 | 联网搜索承载、ZDR、代理、图片 offload 与预算、Responses 协议覆盖、错误诊断导出、图片与超时等边界处理 |

每期各自走「设计 → 计划 → 实现 → 验收」闭环。

## 4. 调研事实（设计依据）

### 4.1 宿主接缝（两插件共用的部分）

- 宿主插件形状：`{ name, inject: ["llm"], apply(ctx, config), Config }`；`LlmAdapter` 子类实现 `listModels` / `resolveModel` / `stream`（async generator of `StreamChunk`）。
- 配置：schemastery `Config`，字段全部 `.volatile()`，每次请求重新读取 —— 这是「改完立即生效」的机制。
- 凭据：`credentialRef(name)` + `credentials.resolve/set/unset/describe`，环境变量与启动环境兜底。
- 设置：`ctx.inject(["settings"])` + 修订号围栏的 `settings.mutate(ns, ops, revision)`。
- 客户端远程：`TypertRemoteService` + `ctx.typert.register({ package, face: "host", invocations })`。
- 客户端插件：`window.__ModuleLoader__.load({ id, factory })` 导出 `{ apply, inject }`，通过 `settings.section` 插槽注册页面，`hooks` 映射成 `use*` props。
- 立即生效：volatile 字段 + `loader/volatile-update` 监听 + 凭据变更推送。

### 4.2 两家厂商的差异（必须在适配器里处理）

| 关注点 | Command Code | OpenCode Go |
| --- | --- | --- |
| 线协议 | 三套传输（`/alpha/generate`、`/provider/v1/chat/completions`、`/provider/v1/messages`）可回退 | pi-ai SDK 扇出（anthropic-messages / openai-completions / openai-responses） |
| 账号操作 | 设置变更（`remote.settings.mutate`） | 专用远程命令 `opencodeGoAccounts.execute` |
| 账号记账键 | API key | 凭据引用 ref |
| 轮换 | 按 key 状态 + 冷却 + 失效标记，`tried` 上限 16 | 按 ref + TTL 拒绝记忆 + 崩溃恢复意图日志 + 自动切换落库 |
| 排序 | **不支持** | 支持（原生 DnD + 键盘上下移 + `move` 命令） |
| 固定账号 | 有（pin = `activeAccount`） | 没有 pin（`select` + `autoSwitch`） |
| 按模型绑定账号 | 有（`modelAccountRules`） | 没有 |
| 额度 | `whoami` + `usage/summary` + `billing/credits` + `billing/subscriptions`，形状 `{used, cap, exceeded, resetAt}` | 单端点 `GET /usage`，形状 `{status, percent, resetsAt}` |
| 目录 | `/provider/v1/models` + 本地缓存 + 套餐过滤 | `/models` + models.dev 元数据 + TTL 缓存 |
| 网页登录 | 有（本机回环回调，起始端口 5959，超时 12 万 ms） | 没有（控制台复制 key） |
| 模型可见性写入 | 保存时成对写 `visibleModels` + `modelVisibility` | 逐模型开关立即写 |
| 请求超时 | 有请求/流空闲超时配置，但无整请求 deadline 包装 | 三层 deadline + idle watchdog |
| 输出后是否可切账号 | 按轮换上限（可能已输出后仍继续尝试） | 明确「已输出/已消耗 token/已中止」则不切 |

## 5. 装配方案（选定 A）

### 5.1 选定方案

一个 npm 包 `dsh-llm-account`，**装一次**；它的 `cordis.patch.yml` 插入**两行**：

```yaml
- insert:
    - id: llm-commandcode
      name: "dsh-llm-account/commandcode"
    - id: opencode-go
      name: "dsh-llm-account/opencode"
```

- 行 id、设置命名空间、provider id 与原插件完全一致 → 用户 profile patch 的按 id 覆盖继续生效，账号与白名单零迁移。
- 客户端只有一个设置页（`settings.section`，id `llm-account`，order 12）。

`dsh-llm-account/commandcode` 这类子路径说明符必须写进 `package.json` 的 `exports`，否则加载器会 `ERR_MODULE_NOT_FOUND`。这一条在上机第一步就要验证（连同行 id 与命名空间一起）。

### 5.2 被否方案

| 方案 | 内容 | 否决理由 |
| --- | --- | --- |
| B · 单行新命名空间 | 一行、`config.vendors`、设置键改为 `llm-accounts` | 需要迁移用户真实账号与两张模型可见性表，迁移失败会丢配置 |
| C · 包装现有两包 | 新包依赖两个旧包、复用其适配器 | 两个旧包内部会各自注册路由与设置页，无法真正做到统一；上游升级即可能失效 |

### 5.3 与旧插件互斥

两个旧包的 bundle patch 也插入同样的行 id。**同一行 id 只能由一个层插入**，所以不能「新包与旧包并存」。切换步骤必须是「卸旧装新」，且切换前做快照（见 §13）。

## 6. 架构

### 6.1 包结构

```
dsh-llm-account/
  package.json          # exports: ./commandcode ./opencode ./client；dsh.bundle.patch；dsh.client.inject
  cordis.patch.yml      # 插入两行（§5.1）
  src/core/             # 共享内核：不得出现任何厂商名字
    adapter.ts          # VendorAdapter 接口与能力声明
    accounts.ts         # 账号库：不变量、顺序、固定、按模型规则
    credentials.ts      # 凭据端口
    rotation.ts         # 轮换引擎与拒绝记忆
    catalog.ts          # 目录缓存与可见性规则
    transport.ts        # 请求内核：超时、重试、错误码、图片预算
  src/vendors/commandcode/
    index.ts protocol.ts catalog.ts quota.ts login.ts
  src/vendors/opencode/
    index.ts protocol.ts catalog.ts quota.ts
  src/client/
    registry.ts page.tsx vendor-card.tsx account-list.tsx
  tests/
```

构建：`tsdown` 产出 `lib/`（与 `@mars-sea/dsh-commandcode-provider` 一致）；类型检查 `tsc --noEmit`；测试 `vitest`。

### 6.2 内核端口

| 端口 | 职责 | Command Code 实现 | OpenCode 实现 |
| --- | --- | --- | --- |
| `accounts` | 账号增删改查、排序、固定、按模型路由 | 设置变更（`accounts`/`activeAccount`/`modelAccountRules`/`credentialCleanupRefs`） | 远程命令 `accounts.execute`（含 `move`） |
| `credentials` | 解析/写入/校验 API key | `COMMANDCODE_API_KEY*` + 只读兜底 `~/.commandcode/auth.json` | `OPENCODE_API_KEY*`（无 auth.json） |
| `quota` | 额度与套餐状态 | 4 个 `/alpha/*` 端点 → 窗口形状 | `GET /usage` → 百分比形状 |
| `catalog` | 模型目录与元数据 | `/provider/v1/models` + 本地缓存 | `/models` + models.dev + TTL 缓存 |
| `login` | 网页登录（可选能力） | 本机回环回调 | 无 |
| `transport` | 流式请求与协议 | 三套传输可回退 | pi-ai SDK |
| `capabilities` | 声明本厂商支持哪些 UI 能力 | 见 §7.3 | 见 §7.3 |

### 6.3 适配器接口（草案）

```ts
export interface VendorAdapter {
  readonly providerId: string;          // "commandcode" | "dsh-opencode-go"
  readonly displayName: string;
  readonly capabilities: VendorCapabilities;
  readonly accounts: AccountPort;
  readonly credentials: CredentialPort;
  readonly catalog: CatalogPort;
  readonly quota: QuotaPort;
  readonly transport: TransportPort;
  readonly login?: LoginPort;           // 仅 Command Code 提供
}

export interface VendorCapabilities {
  reorder: boolean;
  pin: boolean;
  browserLogin: boolean;
  modelAccountRules: boolean;
  quotaShape: "windows" | "percent";
  modelVisibilityWrite: "onSave" | "immediate";
  automaticSwitch: boolean;
}

export interface AccountPort {
  list(): Promise<AccountView[]>;
  add(input: { label: string; key?: string }): Promise<AccountView>;
  rename(ref: string, label: string): Promise<void>;
  replaceKey(ref: string, key: string): Promise<void>;
  remove(ref: string): Promise<void>;
  select(ref: string | null): Promise<void>;        // null = 自动轮换
  move?(ref: string, toIndex: number): Promise<void>;
  setAutoSwitch?(value: boolean): Promise<void>;
}

export interface TransportPort {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;   // 宿主 @deepseek-ai/dsh-llm 的真实请求类型
}
```

未实现的可选方法（`move` / `setAutoSwitch`）由能力声明关闭，UI 对应控件隐藏。

### 6.4 关键语义决定

1. **账号身份统一用凭据引用 ref 做键**（OpenCode 的做法）。Command Code 现在按 key 记账，两个账号共用同一 key 会互相污染状态。
2. **轮换以 OpenCode 的语义为基准**：请求一旦开始输出、已消耗 token、或调用方已中止，就不再切账号；Command Code 的「轮换到上限 16 次」只作为上限保留。
3. **统一失败分类**：`quota | rate-limit | invalid-credential | unavailable | server | network`，附带可选 `resetAt`。两家的原始错误到该分类的映射表放在各自适配器里。
4. **保留 Command Code 的两项能力**：按模型绑定账号（`modelAccountRules`，一个模型同一时间只属于一个账号）与固定账号（透支时允许回落，窗口重置后恢复固定）。
5. **OpenCode 的两项可靠性机制改为两家共用**：`autoSwitch` 落库、崩溃恢复意图日志（账号操作先写意图、重放后提交，事务化）。
6. **请求内核补上 Command Code 缺失的部分**：整请求 deadline、流空闲看门狗、统一 `stop` 拒绝、图片预算与 offload 投影、usage 事件透传。

## 7. 厂商适配器

### 7.1 commandcode

- **传输**：沿用现有的三套传输与默认回退顺序（实现时与旧包逐一对照，不自行发挥）。
- **目录**：`/provider/v1/models`；套餐过滤、免费置顶、能力描述（Image / 上下文长度）保持现状。
- **额度**：先 `whoami` 拿 `orgId`，再并行拉 `usage/summary`、`billing/credits`、`billing/subscriptions`；单个失败不拖垮整体，汇总成 `failures[]`。
- **登录**：本机回环回调 —— 空闲端口探测（5959 起，最多 10 次）、`state` 随机令牌、回调只接受 `POST /callback`、`state` 不符返回 403、拿到 key 后用 `whoami` 验证、成功写凭据库、12 万 ms 超时、取消后迟到的结果不落库。
- **账号**：真源在设置里，所以 `AccountPort` 用设置变更实现；`remove` 需要写入 `credentialCleanupRefs` 并清理凭据，保持现状语义。

### 7.2 opencode

- **传输**：pi-ai SDK 打包进 `lib/`（与旧包一致：别名依赖 + 构建期内联）。
- **目录**：`/models` + models.dev 元数据 + TTL 缓存；`modelLimits` 覆盖 `contextWindow`/`maxTokens`/`thinkingBudgets`；仅接受 `opencode.ai` 域的发现请求。
- **额度**：`GET /usage`，解析失败/超时按可重试处理并保留上一次读数。
- **账号**：远程命令 + 崩溃恢复意图日志 + 自动切换落库（`apiKeyEnv` 被改写为选中的 ref）。
- **拒绝记忆**：按 ref + 网关记录 TTL 拒绝；凭据更新时清除。

### 7.3 能力矩阵（UI 降级依据）

| 能力 | commandcode | opencode |
| --- | --- | --- |
| `reorder` | 否 | 是 |
| `pin` | 是 | 否（用 `select`） |
| `browserLogin` | 是 | 否 |
| `modelAccountRules` | 是 | 否 |
| `quotaShape` | `windows` | `percent` |
| `modelVisibilityWrite` | `onSave` | `immediate` |
| `automaticSwitch` | 是 | 是 |

## 8. 客户端统一页面

- **注册**：一个 `settings.section`（id `llm-account`，order 12），取代旧插件的两个页面。
- **页面结构（用户要求：摆放与现有 Command Code 插件「差不多」）**：页面顶部是**厂商标签页**（Command Code / OpenCode），选中哪家就渲染那家的完整一套卡片；标签之外的壳（标题、简介、底部浮动保存条、高级设置默认折叠）是共用的。每个标签页内部的卡片顺序沿用 Command Code 的设置页：**账户卡片**（每个账号一行：名称、套餐、状态、5 小时/每周额度条，可展开看完整报告，行尾 `⋯` 菜单含重命名/更换密钥/固定使用此账户/移除，卡片底部「添加账户」）→ **模型卡片**（隐藏套餐外模型、可见模型多选）→ **隐私与安全** → **集成与显示** → **高级设置**（默认折叠）。厂商不支持的卡片不渲染（例如 OpenCode 没有 ZDR 与联网搜索卡片）；厂商专属的高级项（OpenCode 的代理、协议覆盖、上下文/思考预算覆盖）放进该厂商的高级设置里。
- **界面摆放（第 2 期）**：同样对齐 Command Code —— 侧边栏底部（Settings 正上方）的额度卡片、点开后在中栏打开的用量面板、输入框下方的会话费用读数。这些属于第 2 期；第 1 期只保证标签页里的设置页形态一致。**其中额度卡片必须修正旧插件的缺陷**：见 §8.1。
- **数据源**：通过 `remote.settings.describe()` 读两个命名空间；每个厂商自己的远程命名空间（CC 的 usage/login/enrollment、OC 的 usage/accounts/models）提供额度与账号操作。
- **跨实例协调**：同一个包插入两行时，客户端 `apply` 的调用次数是未决问题（§14）。**主路径**是模块级单例注册表：各实例把自己的厂商数据注册进注册表，只有主实例注册那唯一一个设置页。**兜底路径**是若宿主只调用一次 `apply`（或注册表机制不可用），页面改为直接按命名空间读取两家数据，不依赖每实例注入的状态。两条路径的页面组件与数据形状相同，只换数据来源。
- **能力降级**：按 §7.3 隐藏或置灰不可用控件，并给出文字说明（例如「该厂商的账号顺序由配置决定」）。
- **额度条**：一个组件同时接受 `{used, cap, exceeded, resetAt}` 与 `{status, percent, resetsAt}`。
- **保存语义**：账号操作**立即生效**（两家都是）；页面底部的保存只作用于设置字段（沿用旧插件的语义）。
- **i18n**：一个命名空间 `settings.llm-account`，`zh` / `en` 两套文案，跟随宿主语言。
- **样式**：自带 `<style data-plugin-css>`，只用宿主 `--dsw-*` 变量，不改宿主 DOM。

### 8.1 侧边栏额度卡片与仪表盘（第 2 期，含对旧插件的明确改进）

**用户要求（2026-10-14 追加）**：卡片要**跟随自动切换后的账号**，而不是像旧插件那样固定显示配置里的那个账号。

**旧插件的缺陷与根因**：旧卡片的额度取自「配置里固定的账号」（Command Code 的 `activeAccount`），而多账号轮换是**每次请求临时决定**的 —— 旧插件不把「这一次实际是谁在服务」发布给界面，所以用量打满被自动切走后，卡片仍然显示原来那个账号的数字。OpenCode 旧插件反而有 `lastSwitch` 通知与「切换后落库」，两家行为不一致。

**我们要求的行为**：

1. **生效账号（effective account）成为一等概念**：轮换引擎在每次真正选中某个 ref 去发请求时记录「最近一次生效的 ref 与时刻」；成功完成请求后更新为「最近一次成功服务的 ref」。这个概念属于内核（`src/core/switching/rotation.ts`），并由宿主侧的 usage 远程对外发布。
2. **卡片主体显示生效账号**：套餐名 + 5 小时/每周（OpenCode 为 rolling/weekly/monthly）额度，与旧卡片的信息密度一致。
3. **切换提示**：当生效账号与「配置里固定/首选的账号」不同时，卡片顶部显示一条提示：**谁 → 谁、原因（额度耗尽 / 限流 / 凭据失效 / 手动切换）、时间**。OpenCode 复用其 `lastSwitch` 语义；Command Code 由我们的轮换引擎产生同样形状的通知。
4. **固定账号与生效账号并列标注**：两者不同时都可见（例如「固定：A；当前：B」），避免用户以为自己的固定设置没生效。
5. **点开中栏仪表盘**：逐账号列出额度、状态、拒绝/冷却与切换记录；生效账号高亮。
6. **默认关闭、关闭时不后台刷新**：与旧插件一致 —— 用户开启后卡片才渲染，才轮询；关闭时不为它做任何后台用量查询（轮询随卡片生命周期起停，而不是常驻）。

#### 8.1.1 实际实现：显示哪个账号（2026-10-22 补，修正第 2 条）

第 2 条写的「卡片主体显示生效账号」是**2026-10-14 的设计意图**。2026-10-19 用户改成
「跟随当前会话」之后，实际实现变成了**两层**，这里写清楚，避免按第 2 条理解代码：

| 层 | 位置 | 决定什么 |
| --- | --- | --- |
| ① 容器选账号 | `seams.ts` 的 `sidebarCurrentTarget` | 传 `accountRef` 给卡片 |
| ② 卡片兜底链 | `sidebar-card.ts` 的 `currentRow` | 没有 `accountRef` 时按序回退 |

**第 ① 层的优先级**（这是实际生效的那条）：

1. **最近一次真正发过请求的账号**（`lastUsed`），前提是：30 分钟内（`DEFAULT_FRESH_TTL_MS`）、且仍在轮播清单里；
2. 否则用**轮播清单的第一个**（= 配置里 `accounts` 数组顺序的第一个）。

**第 ② 层的兜底链**（仅当第 ① 层没给 `accountRef`）：

```
wantedRow（传入的 ref）
  ?? effectiveRow（status().effective，轮换引擎记的最近生效账号）
  ?? rows.find(active === true)
  ?? rows.find(effective === true)
  ?? rows.find(configured === true)
```

**为什么第 ① 层不看 `effective`**：`effective` 是「最近一次被选中去发请求的账号」，
而用户要的是「当前会话在用谁」。2026-10-19 的结论是后者更贴近真实需求，而 `lastUsed`
（从台账算）比 `effective`（进程内状态）更可靠 —— 后者重启就没了。

**`lastUsed` 的来源**：宿主台账（`~/.dsh/llm-account/usage/usage-YYYY-MM-DD.jsonl`）里
最近一条**属于仍然存在的账号**的记录，由 `lastUsedAccountOf` 算出，经
`usageReport.lastUsed` 发布给客户端。

**已知局限**（`docs/client.md` 也记了）：宿主不提供「前端当前打开哪个会话」的接口
（2026-10-19 扫过 asar 的全部 `remote.session` 调用点）。所以「翻看一个旧会话但没发消息」
时，显示的是**上一次真正发过请求**的账号，不是当前会话的账号。

**依赖与前置**：① 客户端 bundle 的**浏览器目标构建**（`./client` 目前只有声明没有产物，见计划 1b 的交接项 3）；② 内核新增「生效账号」概念 + 对应的宿主侧远程；③ OpenCode 侧复用已有 `lastSwitch`，Command Code 侧新增同等形状的通知。

## 9. 数据流

### 9.1 请求路径

1. 宿主按模型 id 选中 provider 路由（`commandcode` 或 `dsh-opencode-go`）。
2. 适配器解析模型 → 目录里查元数据（上下文、推理档位、图片能力）。
3. 轮换引擎选账号：`modelAccountRules` 命中 → 固定账号 → 顺序中第一个可用账号。
4. 传输层发请求，带 deadline 与 idle watchdog。
5. 失败时分类：`quota`/`rate-limit`/`invalid-credential`/`unavailable` 记入拒绝状态并**在未输出前**换下一个账号；已输出则直接报错。
6. usage 事件透传给宿主；额度相关状态在下次额度轮询时刷新。

### 9.2 设置与凭据写入路径

1. 页面发操作 → 厂商 `AccountPort` / 设置变更。
2. 密钥永远走 `credentials.set/unset`，从不写入设置文档。
3. 设置变更带修订号；冲突时重新读取并重放用户操作。
4. 变更通过 `loader/volatile-update` 与凭据推送即时生效，无需重启。

## 10. 错误处理

- 用户可见文案统一由分类映射产生，例如额度耗尽要说明「哪个账号、何时重置、已切到哪个账号」。
- 密钥失效：标记该账号并在 UI 上显示，提示重新登录或粘贴。
- 全部账号不可用：抛出带原因的明确错误，而不是裸 HTTP 状态码。
- 网络/超时：可重试错误交由宿主重试策略；不可重试错误直接报错。
- 部分失败不扩大：额度四个端点中一个失败，其余照常显示，失败项列在 `failures[]`。

## 11. 安全与隐私

- 只与用户自己的厂商账号通信；无遥测。
- 密钥只进凭据库；设置文档里只有凭据引用名，没有明文。
- 本地只读写凭据库与必要的模型缓存文件（`~/.commandcode/auth.json` 只读兜底）。
- 登录回环服务器只绑定 `127.0.0.1`，只接受带正确 `state` 的 `POST /callback`。

## 12. 测试策略

| 层次 | 内容 |
| --- | --- |
| 内核单测（vitest） | 轮换决策（含「已输出不切」）、失败分类映射、账号不变量（一个模型只属一个账号）、凭据解析优先级、额度两种形状归一化 |
| 适配器契约测试 | 用录制的响应样本核对解析与错误映射；不依赖真实网络 |
| 宿主冒烟 | 启动 dsh，确认两条路由注册成功、模型目录可读、设置页可打开 |
| 手工验收 | 见下 |

### 手工验收清单

- CC：两个账号都能出字；额度条显示 5 小时 / 每周；网页登录能把第二个账号加进来。
- OC：粘贴一个 key 能出字；能拖动排序；打开 `autoSwitch` 后额度耗尽能切换。
- 页面：两家的账号在同一页可见可操作；切换语言后文案跟随。
- 回退：禁用新插件、恢复旧插件后，配置与账号仍在。

## 13. 部署与回退

1. `safety_snapshot` 快照当前组合。
2. 构建新包（`pnpm install` + `pnpm build`）。
3. 本地以 `file:C:/Work/dsh-llm-account` 形式添加（仓库里已有同类先例：`dsh-fpga-workbench`）。
4. 从 profile 依赖里移除两个旧包（**必须移除，不能并存**：两个 bundle 会插入相同的行 id）。
5. 重启 dsh，刷新页面验证。
6. 回退：恢复快照并重新安装两个旧包（设置命名空间未变，账号与配置一直都在）。

> profile 的 `package.json` 与 `cordis.patch.yml` 是受保护文件，改动前需要用户明确批准，并先快照。

## 14. 风险与未决问题

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 同包两行时客户端 `apply` 调用次数未知 | 可能出现两个设置页或只注册一个 | 上机前用最小插件实测；模块级单例注册表兜底 |
| 宿主 `settings.section` 契约（`order` 范围、`hooks` → `use*` 映射、`key` 与 `id` 语义）无法从已装文件读出（宿主包在不可读的 asar 里） | 页面注册方式可能需要调整 | 最小实验插件先验证，再写正式页面 |
| 新旧插件并存会重复注册 provider 路由与行 id | 启动失败 | 切换必须互斥（§13 第 4 步） |
| 旧插件的隐藏行为未完全记录（超大 UI 区域、部分诊断路径） | 个别细节需要回读旧包源码补齐 | 实现时按 `lib/` 逐段对照，遇到偏差记录在实现计划里 |
| 第 1 期同时改动凭据、账号、路由与页面，回归面大 | 问题定位慢 | 内核与适配器分测；冒烟清单逐项过 |
| 工作区 Windows 权限异常，`pwsh` 无法启动 | 无法构建与测试 | 实现前用一条诊断修复命令处理（需用户批准） |

## 15. 非目标（第 1 期明确不做）

- 侧边栏额度卡片、用量面板、`/commandcode` 斜杠命令、Models 页快捷卡片、会话费用估算、TUI 设置页（→ 第 2 期）
- 联网搜索承载、ZDR、代理、图片 offload 与预算、Responses 协议覆盖、错误诊断导出（→ 第 3 期）
- 第三家厂商、发布到 npm、CI 流水线
- 任何对旧插件源码的修改（旧包只作行为参照，切换后移除）


---

## 第 2 期：账号切换、模型勾选与界面紧凑化

- 日期：2026-10-17
- 状态：待评审（写完先由用户评审，评审通过后才出实施计划）
- 项目：`dsh-llm-account`
- 关联：`docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`、`docs/superpowers/notes/2026-10-17-ui-redesign.md`
- 范围：`src/core/**`、`src/vendors/**`、`src/client/**`、测试；不改凭据语义、不改 provider 路由 id、不新增持久化存储

## 0. 一句话

给两家厂商增加**可配置的账号切换策略**（手动顺序 / 额度优先）、**只在任务轮次结束后应用切换**、两家都能**手动排序**；把两家账号**合并到设置页顶部的一张常驻账户卡片**（仍各管各的凭据与顺序）；把模型卡片从「只显示已配置的模型」改为「厂商目录 ∪ 已配置」的勾选式可见性；并给 OpenCode 增加**实验性的设备码网页登录**（手动 API key 保留）；最后把设置页间距整体收紧一档。所有新行为都有默认值，默认值与现状一致（零迁移、零行为突变）。

## 1. 现状与证据

### 1.1 账号

- 持久字段 `activeAccount`（Command Code）/ 顶层 `apiKeyEnv`（OpenCode）目前被读作 **fixed/pinned**：UI 显示「固定」，菜单项叫「固定使用此账户」。
- 轮换决策在**每次请求内**：`RotationEngine.pick` = 按模型规则 → pinned → 顺序里第一个未被拒绝的账号；失败后在同一请求内回退（受 `autoSwitch` 门与「已输出/已消耗 token 不换」约束）。
- 跨请求没有主动换号；没有「间隔」「轮次」概念。
- 宿主把 `turn/end` 作为会话事件追加（`dsh-agent-loop/lib/index.js`），且 `ctx.on("session/event", (session, event) => …)` 已被本机其他插件使用（`@suagr_xl/dsh-safety`、`@changfenhuang/dsh-genui`），事件带 `event.type` 与 `session.id`。
- 手动排序：只有 OpenCode 声明 `reorder: true` 并实现 `move`（写 `accounts` 数组 + 顶层 `apiKeyEnv`）；Command Code 声明 `reorder: false`，没有排序入口；且 Command Code 的 `orderOf` 把顶层默认账号**永远放在第一位**，仅重排 `accounts` 无法真正排序。

### 1.2 模型可见性

- 设置里有 `visibleModels`（白名单）与 `modelVisibility`（逐模型布尔）；宿主 `listModels` 用 `core/catalog` 的 `selectVisible` 过滤。
- 页面的模型卡片列表 = `visibleModels ∪ keys(modelVisibility)`。**没有任何地方把厂商目录提供给页面**，所以新用户的卡片是空的，没有可勾选的模型。
- 两家适配器各自有目录能力（OpenCode 有 TTL 缓存；Command Code 目前每次直取），但目录只用于 `listModels` / `resolveModel`。

### 1.3 间距

- 行内 padding 12px、卡片内边距 16px、卡片 gap 12px、页面/区块 gap 16px，配合 13/14px 字号显得松。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| **当前账号（current）** | 下一次请求会优先使用的账号。由持久化选择（现有 pinned 字段）给出；没有显式选择或它已不可用时，取顺序里第一个可用账号。UI 上只叫「当前使用」。 |
| **生效账号（effective）** | 最近一次真正被选中/服务完成的账号（现有概念，保留）。 |
| **轮次边界（turn boundary）** | 会话事件 `turn/end`；用于「任务结束后再切换」。 |
| **额度用尽（exhausted）** | 活的 `quota` / `rate-limit` 拒绝，或最近一次已知额度读数里某个窗口剩余 ≤ 0 / `exceeded: true`。 |
| **评估（evaluate）** | 算出「下一个该用谁」，**不等于**已经切换；应用（apply）才写持久字段。 |
| **策略（strategy）** | `order`（手动顺序）或 `best-quota`（额度优先）。 |

## 3. 不变量（不可退让）

1. **不在同一轮次内主动换号**：`switchAtTurnEnd` 为真时，评估出的切换必须等到该会话出现 `turn/end` 之后的下一次请求才应用。
2. **额度未知 ≠ 0**：没有读数就是未知；未知不参与「用尽」判定，也不因为读不到就把当前账号换掉。
3. **默认零变化**：不配置任何新字段时，行为与现在完全一致（测试必须锁死）。
4. **不新增存储**：只用现有设置文档字段与既有凭据端口；凭据本身永不被切换逻辑读写。
5. **标题/压缩请求不触发切换**：`purpose` 为 `session-title` / `compaction` 的调用不评估、不应用、不清 pending。
6. **切换与排序都写设置文档**，不直接改运行时内存里的顺序；读写路径仍只有 `SettingsPort` / `AccountPort`。
7. **不做后台轮询**：`order` 策略或 `interval = 0` 时不注册任何定时器；`best-quota` 的评估也只在「请求前」或「轮次边界后的第一次请求」按间隔触发。
8. **OAuth 凭据只进凭据服务**：access/refresh token 不写设置文档、不进日志、不进错误文案；设置文档只存工作区名。
9. **登录只由用户触发**：没有点击「网页登录」就不会发起设备码或创建账号。

## 4. 设置面

两家厂商的 `Config` 各新增以下字段（全部 volatile；都可以经设置页保存）：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `switchStrategy` | `"order" \| "best-quota"` | `"order"` | 切换策略。 |
| `switchIntervalMinutes` | number，0–1440，step 1 | `0` | **只对 `best-quota` 生效**：多久重新评估一次。0 = 不按间隔重评（只在额度用尽时换）。`order` 策略下该值不参与决策。 |
| `switchAtTurnEnd` | boolean | `true` | 等当前轮次结束再应用切换。 |
| `accountOrder` | `string[]`（可选） | 缺省 | 手动排序覆盖。缺省/清洗后为空 → 沿用现有派生顺序。 |

保留现有 `autoSwitch`（失败时是否允许在同一请求内回退到其它账号），但把它的 UI 从 OpenCode 专属 footer 移到两家共用的「切换规则」卡片里；语义不变。

设置页的卡片：新增通用组 `switch`（`CardGroupId`），标题「切换规则」，字段顺序：

1. 切换策略（select：手动顺序 / 额度优先）
2. 切换间隔（number；提示「仅额度优先使用；0 表示不主动重评」）
3. 任务结束后再切换（boolean）
4. 失败时自动切换（boolean，即 `autoSwitch`）

标签页内的渲染顺序：厂商专属卡片（模型）→ 切换规则 → 集成与显示 → 高级设置。`GROUP_ORDER` 增加 `"switch"` 并排在 `"integrations"` 之前。账户卡片移出标签页，常驻在标签页上方（见 §8.1）。

文案（`copy.ts` 的 `CopyKey` 与 zh/en 两份字典都要加）：

- `group.switch`、`group.switch.hint`
- `field.switchStrategy`、`field.switchStrategy.hint`、`options.switchOrder`、`options.switchBestQuota`
- `field.switchIntervalMinutes`、`field.switchIntervalMinutes.hint`
- `field.switchAtTurnEnd`、`field.switchAtTurnEnd.hint`
- `field.autoSwitch`、`field.autoSwitch.hint`（从 `account.autoSwitch*` 迁移或复用）
- `switch.reason.balance`：额度更优（新增切换原因）
- 移除/改写「固定」相关文案：`account.pin` → 「切换到此账户」；`account.pinnedBy` → 删除或改名 `account.current`「当前使用」；`sidebar.pinned` → 不再显示。

## 5. 账号顺序（两家共用）

### 5.1 派生顺序与覆盖

每个厂商新增一个纯函数（放各自 `index.ts` 或抽到 `core/accounts.ts`，以能单测为准）：

```
orderWithOverride(derived: string[], override: unknown): string[]
```

- `override` 必须是数组；逐项只收非空字符串，去重，去掉不在 `derived` 里的 ref（不存在的账号不参与轮换）。
- 结果 = 覆盖里合法的项（按覆盖顺序）+ `derived` 中未出现的项（保持派生顺序，追加在末尾）。
- 结果为空 → 返回 `derived`。

`derived` 仍是现在的 `orderOf`（顶层默认账号 + `accounts[]`，去重）。因此：

- 没有 `accountOrder` 的存量用户：顺序与现在逐字一致。
- 第一次手动排序后写入 `accountOrder`；删除账号时从 `accountOrder` 里摘掉该 ref；新增账号自动出现在末尾。

### 5.2 排序写入

- 两家都实现 `AccountPort.move(ref, toIndex)`：用当前顺序（含覆盖）做 `reorder`，把结果写进 `accountOrder`。
- OpenCode 现有 `move` 改为写 `accountOrder`（不再重排 `accounts` 数组、不再改顶层 `apiKeyEnv`）。**行为变化**：排序不再顺带把队首设成当前账号；当前账号只由「切换到此账户」与策略改变。旧数据没有 `accountOrder`，所以默认顺序不变。
- Command Code 的能力声明 `reorder` 改为 `true`；两家账户行的菜单都出现「上移 / 下移」。
- `AccountPort.list()` 按顺序返回，不再把当前账号 `moveFirst` 到首位（现在 UI 有「当前使用」标记，不需要靠顺序表达当前）。合成的默认槽按覆盖顺序落位；没有覆盖时仍在第一位。
- 移除账号时同步从 `accountOrder` 删除该 ref。

## 6. 切换控制器

### 6.1 分层

- **纯决策**（`src/vendors/switching.ts`，无 I/O、可完整单测）：
  - `remainingScore(snapshot): number | undefined`：一个账号的「最紧窗口剩余比例」（0–1）。窗口剩 = `1 - used/cap` 或 `1 - percent/100`；`exceeded` → 0；没有可计算窗口 → `undefined`。
  - `rankCandidates(input): Candidate[]`：输入 = 顺序、拒绝表、配置状态、额度分数、策略；过滤掉被拒绝/未配置的账号；输出带分数（未知分数排最后）。
  - `nextInOrder(order, current, usable): string | undefined`。
  - `shouldSwitch(input): { target, reason } | undefined`：实现 §6.3 的两种策略与迟滞。
- **运行时控制器**（`src/vendors/switching.ts`，两家共用）：
  - 构造参数：`now`、`settings()`（现读文档）、`accounts.list()`、`select(ref)`（持久化）、`quota(ref)`（按 ref 读额度）、`rotation()`（拒绝表/生效账号）、`logger`。
  - 状态：`lastEvaluatedAt`、`pending: { target, reason } | undefined`、`turnEnds: Map<sessionId, at>`（上限 128，LRU 淘汰）、`lastRequestAt: Map<sessionId, at>`、`inFlight` promise（串行化 apply）。
  - `noteSessionEvent(session, event)`：只认 `event?.type === "turn/end"`，记录 `session.id` 的边界时刻。
  - `beforeRequest({ sessionId, purpose })`：见 §6.2。
  - 应用切换：`await accounts.select(target)` → `rotation().noteAutoSwitch(target, reason)`（新增方法，记录生效账号与切换原因）。写入失败（修订冲突等）只记日志、保留 pending，下一次再试；**绝不让请求因切换失败而失败**。

### 6.2 请求前流程（每次模型请求调用一次，位于 `pick` 之前）

1. `purpose` 为标题/压缩 → 直接返回。
2. 读取当前账号：持久化选择（pinned）若仍可用，否则顺序里第一个可用账号。
3. 若有 pending：
   - 允许应用的条件：`switchAtTurnEnd === false`，或没有 `sessionId`，或该会话在 `lastRequestAt` 之后出现过 `turn/end`；
   - 满足 → 重新评估（目标可能已被拒绝/移除），应用后清 pending；不满足 → 保留 pending，继续用当前账号。
4. 没有 pending 时做一次评估（按策略）：
   - `order`：当前账号「用尽」→ 目标 = 顺序里当前之后的下一个可用账号（绕回一次）。
   - `best-quota`：当前账号「用尽」→ 目标 = 排名最高者；若排名读不出来（全部未知/读取失败）→ 退化为 `order` 的下一个账号（绝不因为读不到而留在已用尽的账号上）。当前账号没有用尽、但 `interval > 0` 且 `now - lastEvaluatedAt >= interval` → 读候选额度并排名，目标 = 排名最高者，但仅当它比当前高至少 **10 个百分点**（迟滞，防抖动）。**当前账号的分数未知时不做这类「更优」切换**（没有可比对象），只在用尽/被拒时切。
   - `interval = 0` 的 `best-quota` 与 `order` 一样只在用尽时评估。
5. 评估出目标后：
   - 目标 === 当前 → 什么都不做；
   - `switchAtTurnEnd === true` 且该会话还没有出现过轮次边界 → 记 pending（reason 见 §6.4）；
   - 否则立即应用。
6. `lastEvaluatedAt` 在**每次实际评估**后更新（包括没有命中目标）；`lastRequestAt[sessionId] = now`。

字段清洗（读取时，全部按「坏值 = 保守默认」处理）：`switchStrategy` 只认 `"order"` / `"best-quota"`，其余读作 `"order"`；`switchIntervalMinutes` 只收 0–1440 的有限整数，其余读作 0；`switchAtTurnEnd` 只认布尔值，其余读作 `true`；`accountOrder` 见 §5.1。

**保存时机**：四个新字段与 `autoSwitch` 都走设置页的保存条（`onSave`），不新增远程写方法。控制器每次请求现读设置文档，所以保存后下一次请求即生效。

**「用尽」的数据来源**（按优先级）：

1. 拒绝表里当前账号的活条目 `quota` / `rate-limit` / `invalid-credential`；
2. 控制器缓存里当前账号最近一次额度读数（窗口剩余 ≤ 0 / `exceeded`）；
3. 都没有 → 不算用尽（不猜）。

### 6.3 `best-quota` 的额度读取

- `QuotaPort.snapshot(ref?: string)`：带 ref 时读该账号，否则读当前选中账号（现有行为）。两家 `create*Quota` 的 `ref` 依赖从「无参 getter」改成 `(explicit?: string) => string | undefined`；密钥解析走同一个 `resolveKey(ref)`。
- 控制器自带缓存：`ref → { snapshot, at }`；TTL = `max(switchIntervalMinutes, 5)` 分钟。评估时只读缓存过期或未知的候选；并发上限 2；单次读取沿用该厂商的请求超时；整体评估预算 20 秒，超时/失败一律记为未知。
- 只读**配置状态为已配置**且未被拒绝的账号；账号列表来自 `accounts.list()`。
- 未知分数排在已知之后；当前账号不是用尽状态时，**绝不**因为读不到其它账号而把它换掉。

### 6.4 切换通知

- 新增 `SwitchReason` 取值 `"balance"`（文案「额度更优」），`core/rotation.ts` 与客户端 `usage-contract.ts` 两处联合类型都要加（客户端那份是独立定义的，不是 re-export）。
- 原因映射：用尽触发的切换沿用触发它的拒绝分类（`quota` / `rate-limit` / `invalid-credential`）；没有拒绝、仅因已知额度剩余为 0 的用尽 → `quota`；`best-quota` 的重评切换 → `balance`；用户点「切换到此账户」→ `manual`。
- `RotationEngine` 新增 `noteAutoSwitch(ref, reason)`：更新生效账号并记一条切换提示；与 `noteManualSwitch` 的区别只有原因。没有可指名原因时不记提示（保持现有纪律）。
- 侧边栏/仪表盘的切换记录因此能显示策略切换。

### 6.5 与现有 `pick` / `autoSwitch` 的关系

- `pick` 的候选**来源**不变（账号来自设置文档），但**优先级在 2026-10-22 改过** —— 见 §6.6。
- `autoSwitch: false` 仍然把候选收窄到当前账号；控制器的用尽切换会改变「当前账号」，因此在 `autoSwitch` 关闭时也生效（「额度用尽后切换下一个」与「失败回退」是两件事）。在文档与提示里写清楚。
- `autoSwitch` 从「OpenCode footer 立即写」变成「两家共用的切换规则卡片、随保存条保存」；字段与默认值不变，只有写入时机变化（保存后下一次请求生效）。

### 6.6 请求内失败的重试链（2026-10-22 补，之前文档缺失）

> 用户 2026-10-22 问「额度用尽后自动切换模型那个规则还在吧」，并描述了他理解的优先级。
> 核实后发现**代码本来就是这样**，但文档里从没写过这条链路 —— 补上以免再次误解。

这一节讲的是**单次请求内部**发生什么，与 §6.2 的「请求前主动切换」是两件不同的事：

| | 触发时机 | 判据 | 结果 |
| --- | --- | --- | --- |
| §6.2 请求前切换 | 每次请求**之前** | 额度读数的主动比较 | 先换好账号再发 |
| §6.6 请求内重试 | 请求**失败之后** | 失败分类（quota/rate-limit/…） | 当场换账号重试 |

#### 两层，不是并列的四级

**关键理解：账号维度由「拒绝表」承担，所以换模型的四级里不需要再区分账号。**

```
① pick(model=X) 在**同一个模型**下逐个试账号
     A 失败（quota）→ markRejected(A) → #live(A) 有值 → 跳过
     试 B（仍是模型 X）        ← 换账号，模型不变
     B 也失败 → 试 C …
   若某个账号成功 → 请求结束，不再换模型

② 所有账号都没有模型 X 可用（pick 返回 undefined）
     才进入 #fallbackModel —— 换模型
```

因此「同账号不同模型」与「同网关不同账号不同模型」在**换模型阶段是同一档**：能走到那一步的账号，都是额度尚未耗尽的账号。额度耗尽的账号已经在第 ① 层被拒绝表挡掉了。

#### 换模型的四级优先（`src/core/switching/model-fallback.ts`）

| 级 | 条件 | 含义 |
| --- | --- | --- |
| 1 | 同网关 + 同名模型 | 还是这家发，等级不变 |
| 2 | 跨网关 + 同名模型 | 换一家发，等级不变 |
| 3 | 同网关 + 异名模型 | 换等级但不出这家；按上下文窗口与推理档位接近度排 |
| 4 | 跨网关 + 异名模型 | 最后手段 |

同一级里有多个候选时**随机**选一个（用户 2026-10-19 要求「随机切换」，避免总压在同一个上）。排除 DeepSeek 官方直连，以及自己（同网关同 id）。

#### 硬性约束（每条都有代码依据）

| 约束 | 值 / 位置 | 为什么 |
| --- | --- | --- |
| 已输出内容就不换账号 | `fallbackAllowed({ emitted, totalTokens, aborted })` = `!emitted && !aborted && totalTokens <= 0` | 已经吐字给用户了，换账号会重复输出 |
| 单次请求最多试几个账号 | `MAX_TRIED = 16` | 防止账号很多时无限重试 |
| 换模型只换一次 | `swappedOnce` | 替代也限额就停手，不套娃 |
| 换模型后清空 `tried` | `tried.clear()` | 换模型后要重新试所有账号（新模型可能所有账号都有额度） |
| 凭据失效不换模型 | `lastFailure.rejection.kind !== "invalid-credential"` | 密钥坏了换模型没用；只有额度/限流类才值得换模型 |
| 拒绝条目的过期 | `resetAt ?? now + RATE_LIMIT_COOLDOWN_MS`；`invalid-credential` **永不自动过期** | 额度有重置时刻就用到点；凭据失效只能显式清除 |

#### 为什么这套优先级是正确的

用户的原话是「额度用尽后理论上就是要切账号了」。三层判据合起来正好满足：

1. **额度尽了就换账号** —— `markRejected(kind=quota)` 让它进拒绝表，`#live` 跳过它；
2. **换账号优先用同模型** —— 第 ① 层在同一个 model 下逐账号试；
3. **所有账号都没这模型才换模型** —— 只有 `pick` 返回 `undefined` 才进 `#fallbackModel`。

这三条是**串行**的，不是并列的分级。早期文档与注释里把它们混在一起描述，是误解的来源。

#### 第 ① 层内部的候选顺序（2026-10-22 改）

`RotationEngine.pick` 决定「同一个模型下先试哪个账号」：

| 顺序 | 来源 |
| --- | --- |
| 1 | **用户选定的账号**（`pinned`，即设置里的「使用此账户」） |
| 2 | 模型绑定规则里的账号（`modelAccountRules`，按全局顺序） |
| 3 | 绑定了但不在顺序里的账号 |
| 4 | 全局账号顺序（兜底） |

**改动历史**：之前 `pinned` 只在「它恰好也在该模型的绑定列表里」时才排第一，否则绑定列表压过它。用户报「我选定了 A 账号，请求却走到 B」正是这个原因（同一个模型被绑到两个账号时）。

**现在的口径**：人的显式选择比规则表权威。模型绑定因此只承担「这个模型能用哪些账号」的信息作用 —— `pinned` 不在绑定列表里时仍优先，从绑定列表挑不到才退回普通顺序。

## 7. 远程契约

### 7.1 状态

- `VendorUsageStatus` 新增 `current: string | null`：宿主计算的下一次请求会用的账号。口径与控制器一致：pinned 若存在、已配置且未被拒绝 → 它；否则顺序里第一个已配置且未被拒绝的账号；都没有 → `null`。
- 保留 `pinned`（现状字段，不破坏既有测试/客户端），但页面不再用它显示「固定」；等未来版本再考虑移除。
- `status()` 的额度读取仍只归属 `quotaRef`（不扩大到所有账号）。

### 7.2 模型目录

- `USAGE_METHODS` 增加 `"models"`；对应的 typert 描述符与客户端 `$mount` 一起更新。
- 方法：`models(vendor) => { models: { id: string; name?: string }[]; failures: string[] }`。
- 宿主 adapter 新增 `catalogModels(): Promise<{ id; name? }[]>`：
  - OpenCode：复用现有 `#catalog`（TTL 缓存）。
  - Command Code：给目录加一个按 `apiBase` 的短 TTL 缓存（与 OpenCode 同款），避免设置页每次打开都直取。
- `UsageVendorDeps` 增加 `models?: () => Promise<CatalogModel[]>`；两家 `index.ts` 传入 adapter 的实现；没有实现的厂商该方法返回 `failures: ["models: not supported"]`。
- 目录读取失败不抛：返回 `{ models: [], failures: [原因] }`；页面对「失败」和「目录为空」显示不同文案。

### 7.3 登录状态

- `LoginStatus`（core 与客户端 `usage-contract` 两处）新增 `userCode?`（设备码）、`expiresAt?`（设备码过期时刻）。
- 现有 `loginBegin` / `loginStatus` / `loginCancel` 三个方法与描述符不变；OpenCode 的登录端口实现同一套接口。
- 登录成功不返回 token（只返回 `success` 与账号名）；token 只在宿主侧写入凭据服务。

## 8. 页面

### 8.1 页面结构（账户合并、其余仍按厂商）

- 顺序：标题/简介 → **统一账户卡片（常驻，不属于任何标签页）** → 厂商标签页 → 当前标签页内容。
- 统一账户卡片：一个 `dsl-card`、标题「账户」，内部按厂商分组：
  - 组头：厂商名（`vendor.commandcode` / `vendor.opencodeGo`）+ 右侧小号「添加账户」按钮；
  - 组内：该厂商的账号行（顺序 = 该厂商的 `list()` 顺序）；
  - 组尾：该厂商的「添加账户」展开表单（点组头按钮后在该组内展开）；
  - 已发现但读不到状态的厂商：整组显示「账号数据暂不可用」+ 原因（不显示假的空列表）。
- 标签页只承载模型、切换规则、集成与显示、高级设置；**账户不再出现在标签页里**。
- 两家的状态数据容器已经一次性读取（`seams.ts` 的状态 effect 遍历全部 entries），合并账户不需要新增请求。
- 两家账号仍是两套凭据/两条 provider 路由，**不共用账号**：合并只发生在展示与管理层；每个厂商的「当前使用」、顺序、额度各自独立。
- 账户操作的状态需要带厂商：`AccountAction` 增加 `vendor` 字段（`openAction` 时写入），派发时用 `action.vendor`（不再用 `activeVendor`）。展开报告的状态按 `vendor::ref` 记录，避免两家同 ref 串台（ref 事实上按厂商派生，但状态键显式带上更稳）。
- 组件拆分：从现有 `AccountCard` 抽出「只有行、没有卡片外壳」的 `AccountRows`；`AccountCard` 保持原 API（单厂商外壳）以便既有测试/调用，新面板用 `AccountRows` 在每个厂商组里渲染，避免卡片套卡片。

### 8.2 账户行（两家共用一份渲染）

- 「当前使用」标记：用该厂商 `status.current`（成功色小标）。**移除**「固定」标记与「固定使用此账户」文案。
- 菜单项：`切换到此账户`（对该厂商调用 `selectAccount`，立即生效并持久化）；`上移` / `下移`（两家都出现，按 `capabilities.reorder`）。
- 行顺序 = 该厂商 `list()` 顺序（不再把当前账号提前）。
- 切换成功后：重读该厂商 `status` 与设置快照（已有 `accountRevision` 机制）。
- 网页登录入口由能力声明驱动：Command Code 的现有入口不变；OpenCode 新增设备码登录（实验性），等待态显示链接 + 设备码。

### 8.3 切换规则卡片（两家共用形状，各自一份）

- 在**该厂商的标签页内**渲染，标题「切换规则」，四行字段（§4）。`switchStrategy = order` 时间隔输入禁用并显示提示；`best-quota` 时可用。
- 卡片底部/提示里说明：策略切换只在轮次边界生效；`autoSwitch` 管的是失败回退，两者独立。

### 8.4 模型卡片

- 在各自厂商的标签页内；数据：`目录 ∪ visibleModels ∪ keys(modelVisibility)`，目录顺序在前，新增/手工项在后，去重。
- 每行：模型 id（目录给名字且不同时显示名字）、勾选框、移除按钮。
  - 勾选状态用 `isModelVisible(id, { visibleModels, modelVisibility })`（直接复用 `core/catalog` 的纯函数，保证与宿主过滤同一份规则）。
  - 勾选/取消：`modelVisibility[id] = boolean`（走现有 `applyModelEdit` 的 toggle）。
  - 移除：仅当该 id 出现在设置里（白名单或显隐表）时显示；删除两处记录。
- 「添加模型」输入保留（目录外的手工 id），语义不变（进白名单 + 显式可见）。
- 计数行：显示 `已显示 N / 共 M`；搜索只过滤展示，不改设置。
- 目录读取失败：列表仍显示已配置项，附一行可读原因与「重试」按钮；不显示「还没有配置模型」。
- 目录只在该厂商标签页第一次渲染时拉一次；不参与后台轮询。

### 8.5 侧边栏 / 仪表盘

- 「当前」标记改用 `current`；与 `effective` 不同时仍给切换提示（文案从「固定」改为「当前使用」）。
- 切换记录新增 `balance` 原因文案。

### 8.6 间距（紧凑化）

字号不变，只动间距：

| 位置 | 现在 | 改为 |
| --- | --- | --- |
| `.dsl-field` 行内 padding | 12px 0 | 8px 0 |
| `.dsl-account` padding | 14px 0 | 10px 0 |
| `.dsl-card` padding / gap | 16px / 12px | 14px / 10px |
| `.dsl-root` gap | 16px | 12px |
| `.dsl-account` gap | 10px | 8px |
| `.dsl-meters` 行 gap | 12px | 10px |
| `.dsl-sidebar` padding / gap | 12px / 10px | 10px / 8px |
| `.dsl-dashboard` padding / gap | 20px 24px 40px / 14px | 16px 20px 32px / 12px |
| `.dsl-dashboard section` padding / gap | 14px 16px / 10px | 12px 14px / 8px |

## 9. OpenCode 网页登录（实验性）

### 9.1 实机探针证据（2026-10-17）

- 设备码流程可用：`POST https://opencode.ai/console/auth/device/code`（client_id `opencode-cli`）→ 浏览器批准 → `POST /auth/device/token` 拿到 access/refresh，有效期约 30 天。
- 该账号只有一个工作区（`Default`）；请求必须带 `x-opencode-org-id`。
- 本插件网关 `GET https://opencode.ai/zen/go/v1/models`：带 `x-opencode-org-id` → 200（37 个模型）；不带 → 403 `Workspace selection is required`。
- 本插件额度端点 `GET https://opencode.ai/zen/go/v1/usage`：403 `EntitlementError: OpenCode Go subscription required` —— 当前工作区**没有 Go 订阅**，这是权益失败，不是 token 被拒。
- 聊天链路未验证：需要已订阅 Go 的账号才能测。

**结论**：鉴权层可行（token + org 头被网关接受），因此提供实验性的「网页登录」；手动粘贴 API key 的路径**完整保留**。聊天链路在用 Go 订阅账号真机跑通之前，登录入口与文档都标注实验性。

### 9.2 凭据格式与刷新

- 登录成功后，凭据服务里存一个带前缀的 JSON：`ocoauth1:` + `{ v:1, type:"oauth", access, refresh, expires, org, orgName }`。
- 设置文档**不存 token**；账号条目仍是 `{ id, name, apiKeyEnv }`，`name` 用工作区名。`org` 只在凭据 blob 里。
- 读取凭据：前缀命中 → OAuth 材料；否则按 API key 处理（存量账号行为不变）。
- 过期前 5 分钟用 `POST /console/auth/device/token`（`grant_type=refresh_token`）刷新，把新 blob 写回凭据服务。刷新失败按凭据失效处理（进入现有 `invalid-credential` 拒绝/提示路径）。
- 刷新按 ref 做进程内单飞锁：并发请求共用一次刷新，写回一次；失败后下一次请求再试。

### 9.3 请求头

- OAuth 账号的目录、推理与额度请求都带：`Authorization: Bearer <access>`、`User-Agent: opencode/cli`、`x-opencode-org-id: <org>`。
- API key 账号保持现状：只有 `Authorization: Bearer <key>` 与 attribution 头。
- 推理链路：opencode 适配器的凭据解析从「返回字符串 key」升级为「返回 `{ apiKey, headers }`」，交给 pi-ai provider 的 auth 配置；额度端口写同一组头。
- 目录请求：OAuth 账号加认证头；API key 账号保持现状（目录原本不带 Authorization）。
- `x-opencode-session` 暂不引入（Go 文档的建议项；未验证的路由/缓存影响留给后续）。

### 9.4 登录端口（复用现有远程方法）

- 新模块 `src/vendors/opencode/login.ts` 实现现有 `LoginPort`（`begin`/`status`/`cancel`），**不新增远程方法**。
- `begin`：`POST /console/auth/device/code`（client_id `opencode-cli`），保存 attempt（deviceCode、userCode、verificationUrl、interval、expiresAt、generation），返回 `waiting` + `authUrl` + `userCode` + `expiresAt`。
- `status`：只有到达轮询间隔才真正请求 `POST /auth/device/token`；`authorization_pending` → 继续 waiting；`slow_down` → interval += 5s；拿到 token → 读 `/console/api/orgs`，取**第一个**工作区，调用账号端口 `add({ label: 工作区名, key: oauthBlob })` → `success`（附 label）；`access_denied` / `expired_token` / 网络 → `failed` + 稳定 reason 键。
- `cancel`：清空 attempt；迟到的响应按 generation 丢弃（与 Command Code 登录同一条纪律）。
- 10 分钟超时；同一时间只有一个 attempt，新的 `begin` 取代旧的。
- 账号创建失败（账号数上限、设置冲突）→ `failed` + 可读原因；因为 `add` 先写账号条目再写凭据，不会出现「凭据写了账号没落地」。
- 多工作区：本期取第一个并在成功状态里显示工作区名；工作区选择器留到后续。

### 9.5 客户端

- `LoginStatus`（core 与客户端契约同步）新增 `userCode?`、`expiresAt?`；客户端账户卡片的 `LoginView` 同步加 `userCode?`，等待态才能显示设备码。
- 等待态：显示「在浏览器打开链接并输入代码：XXXX」；链接沿用 `authUrl`；现有 1s 轮询继续（登录端口自己按 device interval 限流）。
- 成功：刷新账号列表与状态；失败：按原因显示可读文案（新增 `account.reason.login-expired`、`account.reason.login-denied`、`account.reason.login-network`）。
- 能力：OpenCode 的 `browserLogin` 改为 `true`；登录入口由能力驱动，出现在合并账户卡的 OpenCode 组。
- 账户行不区分 OAuth / API key（凭据内容不对外）；「更换密钥」仍可用，会用 API key 覆盖该账号的 OAuth 凭据。
- 同一工作区重复登录会创建一个同名新账号（ref 自动加 `_2`），实验期接受；文档提示可删除旧的，不做静默覆盖（避免冲掉手动 key）。

### 9.6 额度与目录的错误语义

- `/usage` 的 403 `EntitlementError` 映射为可读失败「需要 OpenCode Go 订阅」，而不是通用「读取失败」。
- 目录 401/403（OAuth 头缺失或 token 失效）同样给出可读失败，不把「读不到」显示成「没有模型」。

## 10. 测试计划

- `tests/core/switching.test.ts`（新）：`remainingScore` 的单位/未知/除零/`exceeded`；排名与迟滞；`nextInOrder` 绕回；未知不触发换出。
- `tests/vendors/switching.test.ts`（新）：控制器状态机（假时钟、假事件、假额度）：轮次边界前不应用、边界后应用、pending 失效重算、写入冲突保留 pending、purpose 跳过、并发串行。
- `tests/vendors/*-ordering.test.ts`：`accountOrder` 清洗/追加/缺失；`move` 写覆盖；删除账号清理；`list()` 顺序；能力声明。
- `tests/vendors/usage-remote.test.ts`：`current` 字段、`models` 方法成功/失败、描述符与 arity。
- `tests/client/page-state.test.ts`：模型可见性判定与 toggle；策略字段的默认值/清洗。
- `tests/client/models-card.test.ts`：目录 ∪ 设置、勾选状态、手工添加、目录失败态、重试。
- `tests/client/accounts-panel.test.ts`（新）：两家账号在一张卡里按厂商分组；两家的「当前使用」互不影响；组内添加表单落在正确的厂商组；操作携带 vendor；同 ref 的展开状态不串台；一个厂商读不到状态时只影响该组。
- `tests/client/account-card.test.ts`：「当前使用」、菜单文案、两家排序项；`AccountRows` 与 `AccountCard` 的拆分不改变既有结构断言。
- `tests/client/seams.test.ts`：账户操作按 `action.vendor` 派发；登录、排序、添加、移除都走到对应厂商。
- `tests/vendors/opencode-login.test.ts`（新）：设备流程状态机（fake fetch）——waiting / slow_down / success / access_denied / expired / cancel / 迟到响应丢弃；工作区读取；账号创建失败；10 分钟超时。
- `tests/vendors/opencode-auth.test.ts`（新）：`ocoauth1:` blob 解析、过期前刷新、刷新单飞、刷新失败转凭据失效；OAuth 头注入（推理/额度/目录）；API key 账号头不变；token 不出现在设置/日志/错误文案。
- `tests/client/account-card.test.ts` 增补：等待态显示 userCode + 链接；成功刷新账号；失败原因文案。
- `tests/client/style-contract.test.ts` / `css.test.ts`：新类名/按钮类、无硬编码颜色、间距契约（可选：钉住关键 padding）。
- 现有 518 条测试全部更新并保持绿色；`pnpm typecheck` / `pnpm build`。

## 11. 风险与未验证接缝

| 风险 | 处理 |
| --- | --- |
| `session/event` 的 `turn/end` 形状 | **已核验（0.2.1-rc.2）**：`ctx.on("session/event", (session, event) => …)`，`event.type === "turn/end"`，`session.id` 是会话 id；代码在 `dsh-agent-loop/lib/index.js` 与 `dsh-session/lib/index.js` 里。控制器兼容 `(session, event)`、`(sessionId, event)` 与 `{ sessionId, event }` 三种形状。 |
| 切换写入设置与用户保存设置冲突（修订号） | `select` 失败只记日志、保留 pending；不会重试循环；下一次边界再试。 |
| `best-quota` 读取 N 个账号额度（每账号 3–4 个端点） | 只在间隔评估点读、TTL 缓存、并发 2、20 秒预算；失败按未知处理；界面上不承诺实时。 |
| 目录端点需要可用凭据 | 失败时显示已配置项 + 原因 + 重试，不把「读不到」当空。 |
| `accountOrder` 改变了 OpenCode 的排序副作用（不再顺带改当前账号） | 文档与测试明确：排序只改顺序，切换只走「切换到此账户」/策略。 |
| 新 typert 方法 `models` 的 arity/描述符不一致会在边界被拒 | 与现有方法同款：`parameters`/`result` 描述符 + 边界测试。 |
| 取消/中止时控制器仍在应用切换 | `apply` 不依赖请求 AbortSignal；只写设置，不阻塞请求失败路径。 |
| OpenCode OAuth 的聊天链路尚未用 Go 订阅账号验证（探针只证明了鉴权层） | 登录标注实验性；手动 API key 完整保留；失败时按凭据失效提示重新登录；后续用已订阅账号做一次真机聊天验证。 |
| OAuth token 刷新与请求并发（多个请求同时发现过期） | 按 ref 的进程内单飞锁；写回一次；失败只影响该账号的请求，不波及其它账号。 |
| 设备码被用户取消/过期 | 登录端口返回 `failed` + 稳定 reason；页面显示原因与「重试」；不残留 attempt。 |
| 把 refresh token 写进设置文档或日志 | 凭据只进凭据服务；设置文档只存工作区名；日志与错误文案只出现账号名，不出现 token。 |

## 12. 兼容与迁移

- 新字段全部有默认值，存量文档不加字段也能启动；`accountOrder` 缺省时顺序与现在一致。
- 不迁移、不改写现有 `visibleModels` / `modelVisibility` / `autoSwitch` / 账号数组。
- 移除 OpenCode 专属的 autoSwitch footer 只是 UI 变化，字段与写入路径不变（现在从通用卡片保存）。
- 「固定」相关文案删除；`VendorUsageStatus.pinned` 字段暂时保留（兼容），页面不再显示它。
- 账户合并是**页面结构变化**，不影响两套账号文档/凭据/远程方法；账户操作状态多带一个 `vendor` 字段（内部状态，不持久化）。
- 标签页仍按厂商存在；账户卡片移出标签页后，任何标签页下都能看到与操作两家账号。
- OpenCode 的 OAuth 凭据以 `ocoauth1:` 前缀存进凭据服务；没有该前缀的值一律按 API key 读，存量账号零迁移。
- OpenCode 的 `browserLogin` 由 `false` 改为 `true`，只是多一个登录入口；不登录的用户完全不受影响。

## 13. 非目标

- 不做跨厂商负载均衡、不做按模型绑定账号的 UI（`modelAccountRules` 仍是配置级能力）。
- 不做后台定时轮询（`order` 或间隔 0 时零定时器；`best-quota` 只在评估点读）。
- 不在用户未点击登录时自动创建/登录账号；登录只由账户组里的按钮触发。
- OpenCode 登录不提供多工作区选择器与「登出」按钮（删除账号会走现有凭据清理）；多工作区取第一个。
- 不重做仪表盘视觉，只补「当前使用/balance」文案与必要标记。
- 不改变「已输出/已消耗 token 不换号」的请求内回退规则。

## 14. 验收标准

1. 不配置新字段时，行为与现在一致（既有测试不因默认值改变语义）。
2. 手动顺序：当前账号额度用尽后，轮次结束后的下一次请求切到下一个可用账号；界面「当前使用」跟随。
3. 额度优先：每隔设定的间隔重新评估，目标比当前高至少 10 个百分点才切；绝不在轮次中途切；额度未知不导致换出。
4. 关闭「任务结束后再切换」时才允许在请求前立即应用。
5. 两家都能手动排序并持久化；没有 `accountOrder` 的存量配置顺序不变；删除账号后顺序自动清理。
6. 模型卡片显示厂商目录；取消勾选后宿主模型选择器不再出现该模型，重新勾选恢复；目录读取失败有可读原因与重试；手工添加仍可用。
7. 设置页顶部一张常驻账户卡片同时显示两家账号：分组、各自的「当前使用」、各自的排序与操作都正确；切换标签页不影响账户卡片；一个厂商读不到状态只影响它那一组。
8. OpenCode 网页登录（实验性）：点击后显示设备码 + 链接，浏览器批准后自动创建账号；取消/过期有可读原因；手动粘贴 API key 仍可用；token 不进入设置文档/日志。聊天链路在已订阅 Go 的账号上做一次真机验证（未通过前保持实验性标注）。
9. 设置页间距明显收紧，不出现竖排标签或挤压；暗色主题不坏。
10. `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿。


---

## 第 3 期：功能分页、自动继续与统一搜索

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




---

# 版本号

本仓库遵循 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)。**判据是「会不会让老用户出问题」，
不是「改动大不大」** —— 这是最容易误解的一条。

| 段 | 什么时候抬 | 常见误判 |
| --- | --- | --- |
| **PATCH**（第三级） | 修 bug：行为变得正确、接口不变 | — |
| **MINOR**（第二级） | **新增**功能，旧用法照旧可用 | 「大功能」不一定是 MAJOR |
| **MAJOR**（第一级） | 已有用户升级后**必须改代码或改配置** | 「架构重构」如果对外行为不变，**不是** MAJOR |

## `0.x` 特例

SemVer 规范第 4 条：主版本为 0 时公开 API 视为**不稳定**。因此本仓库在 `0.x` 期间：

- 破坏性变更抬 **MINOR**（`0.2.0 → 0.3.0`），**不**抬到 `1.0.0`；
- 抬到 `1.0.0` 等于承诺「从此不再破坏兼容」，而本包还在跟宿主的 `0.2.x-rc` 适配；
- 真正准备冻结对外契约（`exports` 的 5 个入口 + 设置文档字段形状）时才进 `1.0.0`。

## 自动计算

版本号由提交信息自动推导，不靠人记：

```bash
node scripts/next-version.mjs          # 只打印
node scripts/next-version.mjs --write  # 写回 package.json
```

| 提交标记 | 抬哪一段 |
| --- | --- |
| `feat!:` / `BREAKING CHANGE:` 页脚 | MAJOR（`0.x` 时抬 MINOR） |
| `feat:` | MINOR |
| `fix:` / `perf:` | PATCH |
| `chore:` / `docs:` / `test:` / `build:` / `ci:` / `refactor:` / `style:` | 不抬 |

**因此提交信息必须带前缀** —— 那是这套机制的唯一输入。操作步骤见
[RELEASING.md](RELEASING.md)。
