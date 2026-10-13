# dsh-llm-account 设计文档（第 1 期）

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
| 第 2 期 | 侧边栏额度卡片、用量面板与斜杠命令、Models 页快捷卡片、会话费用估算、TUI 设置页、模型白名单/思考档位/上下文覆盖等选择器细节（**摆放与卡片形状对齐现有 Command Code 插件**） |
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
- **界面摆放（第 2 期）**：同样对齐 Command Code —— 侧边栏底部（Settings 正上方）的额度卡片、点开后在中栏打开的用量面板、输入框下方的会话费用读数。这些属于第 2 期；第 1 期只保证标签页里的设置页形态一致。
- **数据源**：通过 `remote.settings.describe()` 读两个命名空间；每个厂商自己的远程命名空间（CC 的 usage/login/enrollment、OC 的 usage/accounts/models）提供额度与账号操作。
- **跨实例协调**：同一个包插入两行时，客户端 `apply` 的调用次数是未决问题（§14）。**主路径**是模块级单例注册表：各实例把自己的厂商数据注册进注册表，只有主实例注册那唯一一个设置页。**兜底路径**是若宿主只调用一次 `apply`（或注册表机制不可用），页面改为直接按命名空间读取两家数据，不依赖每实例注入的状态。两条路径的页面组件与数据形状相同，只换数据来源。
- **能力降级**：按 §7.3 隐藏或置灰不可用控件，并给出文字说明（例如「该厂商的账号顺序由配置决定」）。
- **额度条**：一个组件同时接受 `{used, cap, exceeded, resetAt}` 与 `{status, percent, resetsAt}`。
- **保存语义**：账号操作**立即生效**（两家都是）；页面底部的保存只作用于设置字段（沿用旧插件的语义）。
- **i18n**：一个命名空间 `settings.llm-account`，`zh` / `en` 两套文案，跟随宿主语言。
- **样式**：自带 `<style data-plugin-css>`，只用宿主 `--dsw-*` 变量，不改宿主 DOM。

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
