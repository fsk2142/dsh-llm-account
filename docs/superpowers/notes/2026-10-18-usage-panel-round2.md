# 用量面板第二轮返修：英文、切换记录、缓存冻结、单位、思考档位（2026-10-18）

日期：2026-10-18
项目：`dsh-llm-account`
范围：`src/client/**`（`failure-text.ts` 新增、`quota.ts`、`dashboard.ts`、`account-card.ts`、`models-card.ts`、`sidebar-card.ts`、`seams.ts`、`copy.ts`、`css.ts`）、`src/vendors/commandcode/**`（`efforts.ts` 新增、`adapter.ts`、`protocol.ts`、`quota.ts`）
背景：用户验收第一轮后带回六件事 —— ① whoami 用量面板里多了英文；② 不需要保留切换记录；
③ 重新点开设置后原来显示的额度信息又不见了；④ 额度信息带上单位；⑤ 月额度信息也没有
（「无法获取吗？」）；⑥ 选择模型后仍然无法继续选择思考模式。

## 1. 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 面板里有英文 | 诊断原文直接上屏：端点短名（`whoami`、`credits`、`usage`）、宿主包装过的 `quota: commandcode "Work" read failed (timeout after 30000ms)`、以及客户端接缝自己产的 `the llm-account remote namespace has no models()` | 新增 `client/failure-text.ts`：已知形状**映射成人话**（含带引号账号名的包装 →「账号 X 的额度读取失败（读取超时）」），认不出的形状**原样返回**（宿主能力错误要看得见）；原文一律留在 `data-*`（`data-failure-detail` / `data-account-quota-failure` / `data-dashboard-failure` …）。接线的四处：账户卡片（厂商级失败 + 额度失败 + 目录失败）、仪表盘（厂商级失败 + 账号额度失败）、侧边栏卡片、模型卡片（`failureListText` 处理 `；` 连接的多条） |
| ② 不要切换记录 | 记录只说明过去发生过什么，用户要的是「现在哪张卡还有额度」 | 客户端**全部**移除：仪表盘的记录区（读取 + 渲染 + `switches` prop）、`seams.ts` 的 `readSwitches` 与仪表盘加载、`copy.ts` 的 `dashboard.switches`/`dashboard.noSwitches`、`css.ts` 的 `.dsl-switch*`/`[data-switch-record]`/`CSS_CLASS.switchNotice`/`switchRoute`。**宿主侧的 `switches()` 与 `rotation` 的记录保留**（跨行观测要它：设置页/侧边栏跟随真实账号），`switch-card` 的「即将切换」倒计时也保留 —— 那是将来的事，不是历史 |
| ③ 重新打开设置额度又不见了 | **缓存冻结**：一次瞬时失败（单端点超时）的读数被写进 60s TTL 的设置页读数缓存，重开设置直接吃这份残缺读数，看起来像额度凭空消失 | 新增 `seams.ts` 的 `completeReading(status)`：只有**完整**读数够格进缓存（failures 为空 + 每个「已配置」账号都有非空 quota 且 `quota.failures` 为空）；不完整照旧每次现读。三个写缓存点（设置页状态 effect、侧边栏写回、仪表盘写回）都过这道闸 |
| ④ 额度信息带上单位 | 单位是**厂商给的事实**，不能由界面猜 | `QuotaUnit = "usd"`（`core/adapter.ts`），CC 的 `quota.ts` 给每个数字窗口标 `unit: "usd"`（不限窗口没有数字，不标）；界面 `quotaAmount` = `$` + 两位小数（旧插件 `formatMoney` 第 1516 行同一口径：`$7.22`、`$0.12 / $3.00`）；没给单位的窗口照旧裸数字（不替别家猜单位）。原始浮点仍在状态与 `data-*` 里 |
| ⑤ 月额度也没有 | **不是端点故障**：实测 `whoami` → `usage`/`billing/credits`/`billing/window-limits` 四端点全部 200，`usage.totalCredits = 62.2122`；月度额度来自 `usage`，此前只要它那一次读取瞬时失败，界面就只剩失败行 | 同 ③（残缺读数不再进缓存，重开必现读）；并且月度窗口本来就只在 `usage` 给数时才出现（缺失 ≠ 0）。`usage` 失败时窗口列表与失败项分开呈现：读到的照旧显示，失败项给人话 |
| ⑥ 不能选思考模式 | 宿主的档位选择器**完全**由 `resolveModel().reasoning.efforts` 驱动，而 CC 网关的 `/provider/v1/models` 从不公布档位（实测 85 个模型的键只有 `id`/`name`/`reasoning`/`contextWindow`/`maxTokens`）—— 不声明就等于没有档位可选 | 新增 `vendors/commandcode/efforts.ts`：官方 CLI 模型表的静态档位快照（58 个模型，与旧插件 `KNOWN_EFFORTS` 在 command-code@1.79.2 上校验过）；`resolveModel` 用它声明档位（负载自己哪天公布了就以负载为准）；请求路径按表**再收一次口**（宿主的「关闭」会送来 `off`，表里只有部分模型认它；表外的值一律不发字段）；Messages 传输在有可选档位时打开 `thinking: { type: "adaptive" }`（旧插件第 6624 行：那个端点只认 adaptive，且不开它 `output_config.effort` 不起作用） |

## 2. 关键决策与依据

- **本地化 ≠ 抹掉证据**：`failureText` 只翻「认得出形状」的诊断；认不出的原样上屏（宿主能力
  错误 `the host remote service has no $mount()` 这类必须看得见）。每处都保留 `data-*`
  原文属性，排查路径不变。
- **表外模型就是不声明档位**：自动思考、由厂商决定深度的模型（旧插件 `KNOWN_THINKING_MODELS`
  的那批）本来就没有可选档位；猜一组只会换来一个发出去就被厂商拒的请求。opencode 侧无需改动
  —— models.dev 的 `reasoning_options` 已经声明了档位（探测 32 个模型中 26 个有）。
- **`off` 的处理跟着表走**：旧插件把「关闭思考」编码成 `off` 档位，网关对不认它的模型会拒字段，
  所以请求路径校验一次（`supported.includes(...)`），声明与发送同一条纪律。
- **单位只标在数字上**：「不限」窗口没有数字，标单位没有意义；月度窗口（`monthlyCredits`）是
  余额也是美元，同样标。

## 3. 验证

- `vitest run`：**639 通过 / 0 失败**（47 个文件）。本轮新增/改写：`quota.test.ts` 的美元排版、
  `dashboard.test.ts` 的美元排版与 `data-failure-detail`、`account-card.test.ts` 与
  `models-card.test.ts` 的人话文案、`commandcode.test.ts` 的档位声明 / 请求收口 / Messages
  `thinking.adaptive`（三条）、`commandcode-quota.test.ts` 的 `unit: "usd"`、
  `container-simulation.test.ts` 的「完整读数才进缓存 / 残缺读数重开必现读」两条。
- `tsc --noEmit` 通过；`tsdown` 构建通过（`lib/client.js` 内含 `failureListText`/`completeReading`
  与四条人话文案；`lib/commandcode.js` 内含档位表与 `adaptive`）。
- 未提交 git（等用户重启验收）。

## 4. 已知边界

- 档位表是**静态快照**：厂商上新模型后，新模型在表里没有条目就**不声明档位**（诚实降级，
  不猜）；补表要重新对官方 CLI 的模型表。
- 侧边栏额度与设置页共用 `readStatus`，但侧边栏只在「侧边栏开着」时写回缓存；侧边栏没开过的
  情况下设置页第一次打开仍然是现读（这正是 ③ 想要的方向）。
