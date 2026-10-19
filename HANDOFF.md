# 交接：dsh-llm-account 多账号额度插件

**交接时间**：2026-10-20 00:0x（Asia/Shanghai）
**仓库**：`D:\work\llm-acct-repo`（branch `main`，已推到 `origin/main` = `15f7d1a`）
**工作树**：干净，只有一个未跟踪的临时脚本 `scripts/probe-lastused.mts`（可删，是调试残留）

---

## 0. 先读这一段（当前未解决的事）

交接时用户报了**两个现象，都还没修**：

1. **「模型不可用了」**
2. **「模型名称又不一致了」**

### 已核实的证据（别重复查）

- 台账 `C:\Users\me\.dsh\llm-account\usage\usage-2026-10-20.jsonl` 里，opendesign 的请求
  **全部成功**（最近 5 条 `opendesign/deepseek-v4.1-flash` 都是 `success`）。
- 同一台账里**没有** `deepseek-account`（官方直连）的任何记录。
- 但会话的系统提示两次显示模型切换：
  `→ deepseek-account/deepseek-flash`，随后又 `→ opendesign/deepseek-v4.1-flash`。
- 桌面 profile 的 `agent-default-model` 是：
  `provider: opendesign` / `model: deepseek-v4.1-flash` / `reasoningEffort: max`。

### 我的判断（**未验证，不要当成结论**）

台账记的是「走到 `stream` 的请求」，而会话提示记的是「宿主路由到哪个 provider」。
两者不一致说明：**可能在请求进入本插件 adapter 之前就被宿主路由到官方 provider 了**，
所以本插件既没发请求、也没记台账、更没机会拦截。

要验证这件事，下一步该查宿主侧：
- 宿主为什么把请求路由到 `deepseek-account`（可能是模型选择回落到默认模型、
  或 `deepseek/deepseek-v4.1-flash` 这个 id 被宿主认成了官方模型）；
- 本插件的 `visibleModels` / `modelVisibility` 与宿主的模型列表是否对得上
  （commandcode 配的是 `deepseek/deepseek-v4.1-flash`，opendesign 配的是
  `deepseek-v4.1-flash`，**两个 id 写法不同**——这就是「名称不一致」的来源）。

> ⚠️ 我上一轮刚因为「没验证就改」踩过坑（见 §4 的 `reportOf` 事故）。这次请**先拿证据再动手**。

---

## 1. 这个项目是什么

DSH（DeepSeek Harness）的第三方插件，把三家**订阅制网关**接进来做多账号管理：

| 厂商（provider id） | 命名空间（ns） | 说明 |
| --- | --- | --- |
| `commandcode` | `llm-commandcode` | Command Code 网关 |
| `dsh-opencode-go` | `llm-opencode-go` | OpenCode Go（**注意 ns 与 providerId 不同**） |
| `opendesign` | `llm-opendesign` | OpenDesign（vela 控制面 + 推理面） |

功能面：账号增删改、额度查询、侧边栏额度卡片、中栏用量面板、设置页、自动切号、
额度用尽换模型。

---

## 2. 环境与命令（**照抄，别自己拼**）

```powershell
$env:PATH="C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;"+$env:PATH
$node="C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$pnpm="C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
Set-Location D:\work\llm-acct-repo

& $node $pnpm run typecheck      # tsc --noEmit
& $node $pnpm vitest run tests/xxx.test.ts   # 单文件
& $node $pnpm test               # 全量（66 文件 / 897 用例）
& $node $pnpm run build          # 必须跑，lib/ 是 gitignore 的，用户看不到未构建的改动
```

**基线状态（交接时实测）**：`typecheck` 干净，`897 passed (66 files)`，`build` 通过。

### PowerShell 坑（我踩了很多次，请避开）

1. **相对路径会解析到别处**：`Remove-Item tests/x.ts` 曾被解析成
   `C:\Users\me\.dsh\profiles\desktop\tests\x.ts`。**一律用绝对路径**。
2. **中文 + 反引号 + 引号嵌套极易把脚本搞坏**：写复杂补丁时**改用 `write` 工具写
   `.mjs` 脚本再 `node` 执行**，不要用一长串 PowerShell 字符串替换。
3. **`css.ts` 是模板字符串**：里面写 CSS 注释时**绝对不能出现反引号**，
   否则模板提前闭合，报一堆莫名其妙的 `TS1005`。我因此浪费过两轮。
4. `git commit` 中文长消息用 `git commit -F 文件`（PowerShell 引号会吃掉内容）。

---

## 3. 架构要点（读代码前先看这些）

### 客户端 bundle

`src/client/index.ts` 导出 `inject = ["slots", "locale", "remote", "remote.settings"]`。
`remote.settings` **必须在顶层**，缺了不会报错，而是静默降级成「没有可显示的厂商」（看起来
像没配置）。`remote.credentials` 用**嵌套** inject（只有设置页需要）。

### 三个插槽

| 插槽 | id | 文件 |
| --- | --- | --- |
| `settings.section` | `llm-account`（order 12） | `shell.ts` |
| `sidebar.footer.action` | `llm-account-quota` | `seams.ts` |
| `main` | `llm-account-dashboard` | `seams.ts` |

注册纪律：`slots.inject` 回调会被**多次调用**，所以三处都是「先 `unregister` 再 `register`」，
并用 `WeakSet<object>`（按宿主上下文）判重。失败时不打标记，下次槽位变化重试。

### 远程边界（**最容易出 bug 的地方，重点看 §4**）

宿主远程调用返回信封 `{ ok, value }`。客户端有两层会**重建对象**：

1. `src/client/usage-contract.ts` → `parseUsageReport()`  ← 远程边界校验器
2. `src/client/seams.ts` → `reportOf()`                     ← 再normalize一次

**这两层每加一个字段都必须同步搬运**，漏了就等于把字段抹掉。已经因此出过两次同样的 bug。

### 数据存储

- 用量台账：`~/.dsh/llm-account/usage/usage-YYYY-MM-DD.jsonl`，保留 120 天；
  `DSH_LLM_ACCOUNT_USAGE_DIR` 可覆盖（测试用，见 `tests/setup-usage-dir.ts`）。
- 每条记录字段：`at / vendor / account / model / outcome / failureKind? / tokens / ...`
  —— 注意 **`model` 和 `failureKind` 已经记了但界面从没用过**（见 §6 可做功能）。

### 换模型（四级优先，最近刚重写）

`src/core/model-fallback.ts`，纯函数、可注入 `random`：

1. 同网关 + 同名模型
2. 跨网关 + 同名模型
3. 同网关 + 异名模型（先按 `capabilityDistance` 收窄到最接近的一档，再随机）
4. 跨网关 + 异名模型

- 「供应商」= **网关**（用户澄清过），不是模型厂商。
- 候选池 = 该账号**已勾选**的模型（`listModels` 已按可见性过滤）。用户明确：可以降级，
  但**严格限定在已勾选的模型里**。
- 永远排除官方直连（`deepseek` / `deepseek-account` 前缀）。
- 开关 `autoSwitchModelOnQuota`，**默认 false**（用户指定）。

---

## 4. 已修过的坑（**别重犯**）

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| 设置页刷新用量时整个消失 | 只有同步 try/catch，子组件 render 抛错把 root 带走 | 真正的 class 错误边界 `boundry.ts` 的 `RenderBoundary` |
| 侧边栏一直显示 commandcode | `reportOf()` 重建对象漏了 `lastUsed` | 显式搬运 + 注释警告 |
| 侧边栏不显示额度 / 用量中心空 | **同上，第二次**：`parseUsageReport()` 也漏了 `lastUsed` | 同上 + `lastUsedOf()` 字段校验 |
| 侧边栏重开先闪 commandcode | 三个 useState 初值都在等异步（`lastUsed` / `statuses` / `view.status`） | 三份都加模块级缓存 + 写穿 |
| 失败 1 次但成功率显示 100% | `Math.round(rate*100)` 把 99.91 抹成 100 | 两位小数 |
| 刷新模型点了没反应 | `catalogModels()` 走 60s TTL 缓存，无绕过入口 | 加 `fresh` 参数，远程 `models()` 传 `true` |
| 列表页签下 `#catalog` 与 `listModels` 混用 | —— | `listModels` 走可见性过滤；`catalogModels` 不过滤（设置页要能重新打开） |

---

## 5. 界面版式（用户逐轮定稿，**别擅自改**）

侧边栏（`sidebar-card.ts` + `css.ts`）：

```
<账号名>
用量周期              重置时间
5 小时  ▓▓▓▓▓▓▓░░░░░  10-25 10:00
每周    ▓▓▓▓▓░░░░░░░  10-25 10:00
```

- 两行，每行「标签 — 进度条 — 重置时间」横向三样。
- **列宽定义在外层容器** `.dsl-sidebar-windows`（grid），行用 `display: contents`
  —— 这是两条进度条能对齐的关键（每行各写一套网格会错开，用户报过一次）。
- 重置时间用**日期格式**（`10-25 10:00`），不用「今天/明天」（用户明确要求）。
- 百分比数字不单列（条本身表达比例），条上挂 `aria-label`。

---

## 6. 下一步可做（用户上次问「还有什么功能」，我给了清单，他没选）

**已有数据但界面没用**，性价比最高：

1. **按模型用量统计** —— 台账有 `model` 字段。
   ⚠️ **必须先归一化 id**（复用 `modelKeyOf`）：实测同一模型存在两种写法
   （`deepseek-v4.1-flash` 1523 条 / `deepseek/deepseek-v4.1-flash` 1 条），
   按原始 id 分组会把同一模型劈成两行。
2. **失败明细** —— 台账有 `failureKind`（实测出现过 `network`）。
3. **台账导出**（CSV/JSON）—— 纯读，零风险。
4. **错误诊断一键复制** —— 用户报障时最省事。
5. 预算告警、按天趋势图（需要新聚合）。

**不建议**：按成本切账号（三家订阅制都不公布逐 token 单价，算出来是假数字）。

---

## 7. 关键设计约束（用户反复强调过的）

- **不补 0**：缺数据就显示「—」或「未知」，绝不猜成 0。
- **不猜模型档位**：没有对应表就不换模型。
- **关闭即静默**：开关关掉时不起后台轮询。
- **失败路径不加请求**：候选走缓存优先。
- **诚实标注口径**：本机消费 vs 账号全部设备消费要分清。
- 默认模型 `agent-default-model` 是**宿主行**，本插件现在**不读它**
  （早前读过，属于跨插件依赖，已移除——别再引回来）。

---

## 8. 参考文档

`docs/superpowers/notes/` 下：

- `2026-10-19-compatibility-audit.md` —— 插件冲突审计（结论：无 id 冲突）
- `2026-10-19-usage-per-account.md` —— 每账号用量
- `2026-10-19-rotation-and-model-fallback.md` —— 轮播与换模型
- `2026-10-19-image-input-audit.md` —— 图片输入调研（大工程，别轻易开工）
- `2026-10-13-dsh-llm-account-design.md` —— 最初设计（分期表）

---

## 9. 接手后的第一步建议

**不要急着改代码。** 先把 §0 那两个现象的证据补齐：

1. 让用户描述「模型不可用」的具体表现（哪一个模型、在哪选、报什么）；
2. 查宿主为什么路由到 `deepseek-account`（本插件管不到那段）；
3. 对比 `deepseek/deepseek-v4.1-flash`（commandcode 配置）与 `deepseek-v4.1-flash`
   （opendesign 配置）这两个 id，确认「名称不一致」是否就是这两者混用导致。

拿到证据再动手。**先写失败测试，再改**（`tests/` 下已有 66 个文件可参考写法）。
