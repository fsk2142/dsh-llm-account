# dsh-llm-account

一个 DeepSeek Harness 插件：把 **Command Code**、**OpenCode Go**、**Open Design**
三家 LLM 网关的账号管理、额度查询与模型选择收进同一套界面。

## 它解决什么问题

同一家网关往往可以挂多个账号，而各家都有：

- 多账号之间的自动轮换（某个账号额度用尽时切到下一个）
- 五小时 / 每周 / 每月三档额度窗口，各自的重置时间还不一样
- 套餐档位不同，可用的模型与模型额度也不同

这些信息散在各家的网页控制台里。本插件把它们聚合到一处：侧边栏一张卡片看额度，
设置页统一管理账号与模型。

## 功能

| 能力 | 说明 |
| --- | --- |
| 多账号轮换 | 按顺序 / 按额度自动切换；可固定某个账号 |
| 额度窗口 | 五小时 / 每周 / 每月，显示已用、上限与重置时刻 |
| 用量统计 | 每账号的请求数、成功率、花费、Token（含缓存命中） |
| 模型管理 | 按套餐过滤不可用的模型，显示每个模型的可用额度 |
| 网页登录 | 通过设备授权登录，不需要手工复制密钥 |
| 用量导出 | 导出为 CSV |

## 安装

```bash
dsh plugin --profile <你的profile> add github:fsk2142/dsh-llm-account
```

装好后重启 DSH（或在插件市场里更新后刷新页面），设置页会出现「LLM 账号」入口。

## 支持的网关

| 网关 | 额度单位 | 套餐档位 |
| --- | --- | --- |
| Command Code | 美元 | Go / GOAT / Pro / Max 10× / Max 20× |
| OpenCode Go | 美元 | Go / Go Plus |
| Open Design | 美元 | Go / Plus / Pro / Max |

## 文档

开发与排查的详细文档在 [`docs/`](docs/)：

| 文档 | 讲什么 |
| --- | --- |
| [docs/INDEX.md](docs/INDEX.md) | 索引：哪份文档讲什么、什么时候读 |
| [docs/SPEC.md](docs/SPEC.md) | 设计规格（唯一权威） |
| [docs/operations.md](docs/operations.md) | 排查手册：**出问题时第一个读** |
| [docs/vendors.md](docs/vendors.md) | 三家网关的端点事实与额度口径 |
| [docs/RELEASING.md](docs/RELEASING.md) | 发版清单 |

## 开发

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
pnpm build         # tsdown → lib/
```

**`lib/` 是构建产物，必须提交** —— 宿主直接从 `lib/` 加载。改完源码要
`pnpm build` 并一起提交，否则别人装到的还是旧代码。

### 发版

```bash
# 需要 GITHUB_TOKEN（细粒度 token，权限 Contents = Read and write）
node scripts/release.mjs --note "这次改了什么"
```

它会算版本号、重建产物、跑全量验证、提交、打 tag、推送，并建 GitHub Release
（插件市场靠 Release 显示更新说明）。

版本号按 conventional commits 自动推导，规则见 [docs/RELEASING.md](docs/RELEASING.md)。

## 许可

[MIT](LICENSE)
