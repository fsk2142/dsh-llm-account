# 用量统计（2026-10-19）

用户需求（原话要点）：
- 额度下方加用量：请求数与成功/失败、成功率、按官方计价表算价值、token 消耗、
  平均缓存命中率，尽量详细；
- 「厂商价值，然后出个小字约等于官方多少价值」→ 两种口径并列，官方价用小字；
- 「每个账号只统计自己的记账周期，然后单独有一个总的记录」；
- 数据来源：「两者都要」。

## 1. 数据从哪来

**主来源：插件自己采集。** 三个 adapter（Command Code / OpenCode Go / OpenDesign）在
**每次尝试结束处**上报一条样本：

- `stream` 循环里把 `usage` 块逐块累加（厂商可能分多次发：`message_start` 给输入计数、
  `message_delta` 给输出计数）—— 累加而不是覆盖；
- 成功、失败、用户取消三个分支**各记一条**。只记成功会让成功率永远是 100%；
- 采集是**旁路**：端口同步返回，台账内部用写队列串行化落盘。统计坏掉不能影响请求。

**宿主的 `tokenUsage` 没有接入（如实记录）。** 查过 `app.asar`：宿主确实按会话累计
`tokenUsage`（`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` /
`outputTokens`），但字段只挂在 `dsh-api-session-controller` 的**子代理会话描述符**
schema 上，没有一个「按会话/按账号查用量」的公共远程方法。要从客户端读它得依赖宿主私有
结构，宿主机升级就会断 —— 所以这一路留空，等宿主提供正式接口再接。用户选的「两者都要」
因此只落地了自采集这一路。

## 2. 口径（都已用测试钉住）

| 指标 | 口径 | 为什么 |
|---|---|---|
| 成功率 | `成功 / 尝试数` | 失败也是尝试，不记失败就永远是 100% |
| 缓存命中率 | `缓存读 /（缓存读 + 未命中输入）` | 写缓存是「这次没命中、为下次准备」，进分母会系统性低估 |
| 厂商价 | 逐条记录按**该记录的模型**累加 | 一次统计里可能混多个模型，先合 token 再套一个价会算错 |
| 官方折算 | 同一批 token 按 DeepSeek 官方价再算一次 | 用户要的「约等于」 |
| 缺失值 | 一律 `undefined` → 界面显示 `—` 或「未公开」 | 缺失不是 0；`$0.00` 会被读成「免费」 |

## 3. 价格表

**DeepSeek 官方价**（2026-10-19 取自 `api-docs.deepseek.com/quick_start/pricing`）：

| 模型 | 输入(未命中) | 输入(命中) | 输出 |
|---|---|---|---|
| deepseek-flash / v4.1-flash | $0.30 | $0.006 | $1.20 |
| deepseek-v4-pro | $1.32 | $0.044 | $3.96 |

单位是每 1M token。官方分**峰谷两档**（高峰 = UTC 周一至周五 01:00–04:00 与
06:00–10:00，不含中国法定节假日；低谷是高峰的一半）。这里取**高峰价**，因为折算价值
作为「最多花多少」的上界更诚实。

**厂商真实价：当前为空。** Command Code / OpenCode Go 都是订阅 + credit 制，官方定价页
只给「每月多少 credit / 约多少次请求」，**不公布逐模型 token 单价**；OpenDesign 的
`vela billing preflight` 直接给美元消耗，也不需要 token×单价。硬摊成单价只会给出假数字，
所以界面显示「未公开」。要加价时改 `src/core/pricing.ts` 的 `VENDOR_PRICES` 即可。

## 4. 记账周期

「每个账号只统计自己的记账周期」的落地方式：**由额度窗口的 `resetAt` 反推周期起点**。

- 粒度由窗口 key 推断：`fiveHour`/`5h`/`rolling` → 5 小时；`weekly` → 周；`monthly*` → 月；
- 有 `resetAt`：周期 = `[resetAt - 粒度长度, resetAt)`，标 `fromResetAt: true`，
  界面显示「按厂商重置时间」；
- `resetAt` 缺失或已过期：退回自然周期（本地时区；周从周一起算），标
  `fromResetAt: false`，界面显示「按自然 X 推算」—— 不把推算说成厂商的事实。
- 每账号取它**最细**的一档窗口（5 小时比周/月更能反映「最近用了多少」）。

总账是**另一套**聚合：跨账号，按用户选的窗口（今日 / 近 7 天 / 近 30 天 / 全部）。
周期与窗口是两件不同的事，报表里各算各的。

## 5. 文件

| 文件 | 职责 |
|---|---|
| `src/core/usage-stats.ts` | 记录、聚合、计价、窗口（纯函数） |
| `src/core/pricing.ts` | 官方价表 + 厂商价表 + 模型 id 归一查表 |
| `src/core/billing-period.ts` | 由 `resetAt` / 自然边界推导周期 |
| `src/core/usage-ledger.ts` | JSONL 按天落盘、坏行自愈、并发串行、保留 120 天 |
| `src/core/usage-report.ts` | 每账号周期 + 总账 |
| `src/core/usage-port.ts` | adapter 侧的采集端口（不阻塞、不抛错） |
| `src/vendors/usage-store.ts` | 三条 provider 行共用一本台账 |
| `src/client/usage-card.ts` | 界面（纯 props） |

落盘位置：`~/.dsh/llm-account/usage/usage-YYYY-MM-DD.jsonl`。

## 6. 验证

`tsc --noEmit` 0 错；64 文件 / 858 例全绿；`tsdown` 重建。新增 37 例覆盖：成功率与命中率
的分母、双口径计价、缺失值不变 0、模型 id 三种写法、窗口裁剪、周期边界的四个方向、
台账坏行自愈与并发写、卡片渲染（含官方价必须是 `<small>`）。
