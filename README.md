# dsh-llm-account

DeepSeek Harness 插件，把 **Command Code**、**OpenCode Go**、**Open Design** 三家网关的
账号管理、额度查询与模型选择收进同一套界面。

## 功能

| 能力 | 说明 |
| --- | --- |
| 多账号轮换 | 额度用尽或出错时自动切到下一个账号；也可固定某个账号 |
| 自动换模型 | 所有账号都不可用时按四级优先换模型（同网关同名 → 跨网关同名 → 同网关异名 → 跨网关异名） |
| 自动继续 | 请求瞬时失败时自动重试；回答被输出上限截断时自动续写 |
| 额度窗口 | 显示已用、上限与重置时刻（五小时 / 每周 / 每月，各网关提供的档位不同） |
| 用量统计 | 每账号的请求数、成功率、花费、Token（含缓存命中） |
| 模型管理 | 按套餐过滤不可用模型，显示每个模型的可用额度 |
| 网页登录 | 设备授权登录，不需手工复制密钥 |
| 账号改名 | 可改显示名；保留登录时的默认名，可一键恢复 |
| 用量导出 | 导出 CSV |
| 网页搜索 | 注册为宿主的搜索 provider，支持直连 API 与网关工具两条路 |

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

**Command Code / OpenCode Go**：设置页 →「LLM 账号」→ 添加账户 → 填 API key。

**Open Design**：添加账户 → 网页登录（浏览器完成设备授权，自动导入两把密钥）。
也可手工填控制面密钥（`vela_ctrl…`）。

### 切换账号

**手动**：账号卡片行尾的 `⋯` → 菜单。或在全局切换面板里选择。

**自动**：设置页打开「自动切换账号」（配置项 `autoSwitch`）。开启后额度用尽时自动选
下一个可用账号。

### 自动换成其他模型

设置页打开「额度用尽后自动切换模型」（配置项 `autoSwitchModelOnQuota`）。

触发条件：**所有账号都被拒绝之后**。四级优先——同网关同名 → 跨网关同名 → 同网关异名
（按上下文窗口与推理档位接近度排序）→ 跨网关异名。

### 自动重试

| 配置项 | 作用 |
| --- | --- |
| `autoContinue` | 总开关：异常中断（请求失败）后自动重试。默认关 |
| `autoContinueMaxAttempts` | 每轮最多自动重试几次（默认 3，范围 1–20） |
| `autoContinueIntervalMs` | 每次重试前等待多久（默认 2000，范围 500–60000） |

不重试的失败码只有四类：`ABORTED`（用户按了停止）、`CONTEXT_WINDOW_EXCEEDED`、
`INVALID_CREDENTIAL`、`QUOTA`。其余（含未知码）都会按上面的次数与间隔重试。

**旧字段迁移**（v1.4.0 合并前）：

| 旧配置项 | 现在 |
| --- | --- |
| `autoContinueOnError` | 并入 `autoContinue`（仍被读取，任一为 `true` 即视为开启） |
| `autoContinueOnTruncate` | 并入 `autoContinue`（同上） |

额度用尽与鉴权失败**不算**瞬时失败，走「换账号」与「换模型」两条路。

> **「回答被截断时自动续写」当前不可用。** 它需要读宿主的完成原因并往对话队列里
> 追加一条消息，而 DSH 目前没有暴露这样的公开 API —— 生产装配里那个探针从未传入，
> 相应事件因此不会注册。要恢复这个能力，得先有稳定的宿主接口；在那之前可以靠自动
> 重试（`autoContinue`）覆盖「请求失败」这一类中断。

### 查看额度

**侧边栏卡片**：需在该网关的配置里开 `showSidebarQuota: true`。

**设置页**：每个账号一行，显示各额度窗口的进度条与重置时刻。

**刷新间隔**：配置项 `quotaRefreshMinutes`（1–120 分钟，默认 1）。标签页隐藏时暂停刷新。

### 网页搜索

配置项 `searchStrategy`：

| 值 | 行为 | 计费 |
| --- | --- | --- |
| `api-first` | 优先直连 DeepSeek Search API，失败回退网关 | 按请求次数 |
| `gateway-first` | 优先用网关的 `web_search` 工具，失败回退 API | 按 token（走套餐额度） |
| `api-only` / `gateway-only` | 只用其中一条，不可用就明确失败 | — |
| `off` | 关闭本插件的搜索，并把 host 的 `searchProvider` 槽位让出来 | — |

选 `off` 后本插件不再占用该槽位，其他搜索插件可以接管。

### 改账号名称

账号卡片行尾 `⋯` → 重命名。

若当前名与登录时的默认名不同，菜单里会多出「恢复默认名称」，点一下即回到默认名。

### 导出用量

设置页 →「用量」→ 导出，得到 CSV。

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
