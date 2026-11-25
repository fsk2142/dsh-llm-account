# dsh-llm-account

DeepSeek Harness 插件，把 **Command Code**、**OpenCode Go**、**Open Design** 三家网关的
账号管理、额度查询与模型选择收进同一套界面。

## 功能

| 能力 | 说明 |
| --- | --- |
| 多账号轮换 | 额度用尽或出错时自动切到下一个账号；也可固定某个账号 |
| 自动换模型 | 所有账号都不可用时按四级优先换模型（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名） |
| 自动继续 | 请求失败、达到输出上限或网关断流时自动继续；默认关闭，每轮次数受限 |
| 额度窗口 | 显示已用、上限与重置时刻（五小时 / 每周 / 每月，各网关提供的档位不同） |
| 用量统计 | 每账号的请求数、成功率、花费、Token（含缓存命中） |
| 模型管理 | 按套餐过滤不可用模型，显示每个模型的可用额度 |
| 网页登录 | 设备授权登录，不需手工复制密钥 |
| 账号改名 | 可改显示名；保留登录时的默认名，可一键恢复 |
| 用量导出 | 导出 CSV |
| 网页搜索 | **不再提供**（2026-11-14 已移交宿主的官方实现） |

## 安装

```bash
dsh plugin --profile <你的profile> add github:fsk2142/dsh-llm-account
```

装完重启 DSH。设置页出现「LLM 账号」入口。

## 使用的网关

| 网关 | 额度单位 | 套餐档位 |
| --- | --- | --- |
| Command Code | 美元 | Go / GOAT / Pro / Max 10× / Max 20× |
| OpenCode Go | 美元 | Go / Go Plus |
| Open Design | 美元 | Go / Plus / Pro / Max |

## 操作

### 添加账号

三家统一：设置页 →「LLM 账号」→ 添加账户 → **网页登录**。浏览器完成设备授权后自动落库；
Open Design 会同时导入两把密钥。插件内不再提供「使用 API Key」入口，需要手工密钥时请使用
厂商官方入口；已经用 API Key 建好的账号仍可在账号行「更多操作」里更换密钥。

### 切换账号

**手动**：在账号行点「使用」即可固定该账号；当前账号行显示「当前使用」。

**自动**：设置页打开「自动切换账号」（配置项 `autoSwitch`）。开启后额度用尽时自动选
下一个可用账号。

### 自动换成其他模型

设置页打开「额度用尽后自动切换模型」（配置项 `autoSwitchModelOnQuota`）。

触发条件：**所有账号都被拒绝之后**。四级优先——同网关同名 → 跨网关同名 → 同网关异名
（按上下文窗口与推理档位接近度排序）→ 跨网关异名。

### 自动继续

| 配置项 | 作用 |
| --- | --- |
| `autoContinue` | 总开关：请求失败自动重试，`max-tokens` 与 `PROVIDER_STREAM_TRUNCATED` 截断自动续写。默认关闭 |
| `autoContinueMaxAttempts` | 每轮最多自动继续几次（重试与续写共享预算，默认 3，范围 1–20） |
| `autoContinueIntervalMs` | 请求失败重试前等待多久（默认 2000，范围 500–60000） |

开启后覆盖三类中断：

- **请求失败**：除 `ABORTED`（用户按了停止）、`CONTEXT_WINDOW_EXCEEDED`、
  `INVALID_CREDENTIAL`、`QUOTA` 外，其余（含未知码）按上面的次数与间隔重试；
- **`max-tokens`**：回答达到输出上限时，往当前回合的 inbox 追加一条「继续」；
- **`PROVIDER_STREAM_TRUNCATED`**：网关提前断流时保留已经流出的半截回答，并追加
  「继续」续写，不重放原请求。

同一会话、同一回合的所有厂商共享次数预算；inbox 已有消息时直接跳过，因此一次
`agent/turn-stopping` 最多只追加一条「继续」。达到上限后停止，不会无限续写。

宿主缺少 `session/event`、`agent/turn-stopping` 或 inbox 接缝时**安全降级**：受影响的
续写路径关闭，不影响厂商加载、账号管理与网页登录；设置读取失败时也按关闭处理。

**旧字段迁移**（v1.4.0 合并前）：

| 旧配置项 | 现在 |
| --- | --- |
| `autoContinueOnError` | 并入 `autoContinue`（仅当新字段缺失时读取；显式 `false` 优先） |
| `autoContinueOnTruncate` | 并入 `autoContinue`（同上） |

额度用尽与鉴权失败**不算**瞬时失败，走「换账号」与「换模型」两条路。

### 查看额度

**侧边栏卡片**：需在该网关的配置里开 `showSidebarQuota: true`。

**设置页**：每个账号一行，显示各额度窗口的进度条与重置时刻。

**刷新间隔**：配置项 `quotaRefreshMinutes`（1–120 分钟，默认 1）。标签页隐藏时暂停刷新。

### 网页搜索（已移除）

本插件**不再提供**网页搜索。2026-11-14 起网页搜索由 DeepSeek Harness 官方实现提供，
本插件不再注册任何搜索 provider，也不再维护 `searchStrategy` / `searchApiKeyRefs`。

升级后 profile 里残留的旧字段会被 schema 忽略（不报错），下一次写设置时自动消失。


### 改账号名称

账号卡片行尾 `⋯` → 重命名。

若当前名与登录时的默认名不同，菜单里会多出「恢复默认名称」，点一下即回到默认名。

### 导出用量

设置页 →「LLM 账号」→ **账户面板头部** →「导出 CSV」。

### 常用配置项

| 字段 | 说明 |
| --- | --- |
| `apiKeyEnv` | 当前固定使用的账号（凭据引用名） |
| `accounts` | 账号列表 |
| `visibleModels` / `modelVisibility` | 显示哪些模型 |
| `autoSwitch` | 额度不足时自动换账号 |
| `autoSwitchModelOnQuota` | 账号都不可用时自动换模型 |
| `showSidebarQuota` | 在侧边栏显示本网关的账号卡片 |
| `quotaRefreshMinutes` | 额度刷新间隔（分钟） |
| `baseURL` | 网关地址（一般不用改） |
| `requestTimeoutMs` / `streamIdleTimeoutMs` | 请求与流空闲超时 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/INDEX.md](docs/INDEX.md) | 索引：哪份文档讲什么 |
| [docs/SPEC.md](docs/SPEC.md) | 设计规格 |
| [docs/operations.md](docs/operations.md) | 排查手册 |
| [docs/vendors.md](docs/vendors.md) | 三家网关的端点与额度口径 |
| [docs/RELEASING.md](docs/RELEASING.md) | 发版流程 |
| [docs/DSH-VERSION-RANGE.md](docs/DSH-VERSION-RANGE.md) | 版本兼容声明怎么写 |

## 开发

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
pnpm build         # tsdown → lib/
```

`lib/` 是构建产物，需一并提交——宿主直接从 `lib/` 加载。

发版：

```bash
node scripts/release.mjs --note "这次改了什么"
```

需要 `GITHUB_TOKEN`（细粒度 token，权限 Contents = Read and write）。它会算版本号、
重建产物、跑验证、提交、打 tag、推送并建 GitHub Release。

## 许可

[MIT](LICENSE)
