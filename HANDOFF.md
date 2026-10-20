# 交接：dsh-llm-account 多账号额度插件

**交接时间**：2026-10-20 07:5x（Asia/Shanghai）
**仓库**：`D:\work\llm-acct-repo`（branch `main`）
**工作树**：干净（临时脚本已清）

---

## 0. 本轮已解决：「模型名称又不一致了」

### 根因（已用线上数据验证，不是推测）

同一个模型在三家网关的 id 与 name 写法都不同，而**只有 Open Design 走了名称规则**：

| 网关 | 目录里的 id | 目录给的 name | 以前界面显示 |
| --- | --- | --- | --- |
| commandcode | `deepseek/deepseek-v4.1-flash` | `DeepSeek V4.1 Flash (CC)` | 照搬 → 带 `(CC)` |
| opencode | `deepseek-v4.1-flash` | models.dev 的 `DeepSeek V4.1 Flash` | 照搬 → 空格写法 |
| opendesign | `deepseek-v4.1-flash` | 无 | 规则生成 → `DeepSeek-V4.1-Flash` |

同一个模型，宿主的模型选择器里有**三种写法**。此外还有两条同源路径：

1. **目录读不到时 `resolveModel` 退回原始 slug**（`name: entry?.name ?? model`）——
   而目录读不到是常态（网络抖动 / 密钥未配 / 5xx）。
2. **归一后撞名**：`Qwen/Qwen3.8-Max` 与 `Qwen/Qwen3.8-Max-0902` 都变成 `Qwen3.8-Max`，
   界面上两个一模一样、选哪个都不知道。

### 修法（`src/core/model-names.ts` 单一规则）

- **展示名一律由 id 派生**，与是哪个网关无关；厂商的 `name` 只用来判断这一行是否有效，
  不再进界面（`commandcode/catalog.ts`、`opencode/catalog.ts` 都改了）。
- opencode 的**合并步**也要重新派生：`createOpencodeCatalog` 的 `load()` 以前用 models.dev
  的 `name` 把清单层刚统一好的名字盖了回去。元数据仍提供上下文/上限/档位/模态/协议。
- `resolveModel` 的三处回退改成 `officialModelName(model)`，目录拉不到也同名。
- **大小写不参与语义**：`meituan/LongCat-2.0` 与 `longcat-2.0` 必须同名（实测两家写出
  `LongCat` / `Longcat` 两种）。
- **`assignUniqueNames`**：同目录内撞名时借被规则吃掉的差异区分（`Qwen3.8-Max (0902)`、
  `Ling-3.1-Flash (free)`），且**短名归没带快照后缀的那个 id** —— 否则 `Qwen3.8-Max`
  会被它的日期变体挤成 `Qwen3.8-Max (2)`，跟别家又对不上。
- 机器可读的 `:free` 限定不再印进名字（以前显示 `Ling-3.1-Flash:free`）。

**验收**：三份真实目录（commandcode 85 / opencode 33 / opendesign 12）里 28 个跨网关同名
模型**零不一致**；实测 `DeepSeek-V4.1-Flash`、`LongCat-2.0` 三家写法相同。

测试：`tests/core/model-names-unified.test.ts`（11）、
`tests/vendors/opencode-catalog-merge.test.ts`（3）、
`tests/vendors/resolve-model-name.test.ts`（4）。

---

## 0.1 仍未解决：「模型不可用了」

这条**不是名称问题**，本轮没动它。已核实的证据：

- 台账里 opendesign 的请求**全部成功**；同一台账**没有** `deepseek-account` 的记录。
- 会话的 `model/selection` 记录了两次**宿主侧**切到 `deepseek-account/deepseek-flash`：
  `2026-10-19T15:42:48Z` 与 `2026-10-19T16:00:38Z`（后者紧接着切回 opendesign）。
- 那两次之后紧跟的 `assistant/attempt` 都报
  `CONTEXT_WINDOW_EXCEEDED`：`requested 1417839 tokens … 256000 in the completion`。

**新线索**：报错里的 `maxTokens` 是 **256000**（宿主对 `deepseek-flash` 的默认输出预算），
而会话上下文当时已经 110 万+ token。也就是说「模型不可用」的直接原因是**上下文 + 输出预算
超过 1M 窗口**，与本插件无关（本插件的 adapter 根本没被调用）。要接着查宿主侧：

- 为什么宿主把 `provider` 切到 `deepseek-account`（用户手动切？还是模型列表刷新后回落？）；
- `maxTokens: 256000` 是谁给的（`adapterDefaults.maxTokens: true` 说明是适配器默认值）。

---

## 0.2 本轮顺带做的代码整理（用户批准 A + B）

- **A：17 个全仓库零引用的导出符号已删**（`remainingOf`、`emptyReport`、`usageDirectoryOf`、
  `ensureUsageDirectory`、`resetSharedUsageLedger`、`unregisterCatalogSource`、
  `primeModelCandidates`、`AccountScopedFailureKind`、`OpencodeLoginReason`、
  `OpenDesignLoginReason`、`SettingsIcon`、`BackIcon`、`VendorAdapter` + 只被它引用的
  `CatalogPort` / `TransportPort`、`periodRemainingText` + 随之变死的 `emptyBucket`、
  `usage.remaining` 文案键）。
- **B：两张早已断线的卡片删除**：`models-card.ts`、`all-models-card.ts` 及其测试，
  连带 `ConnectedPageOptions.renderVendorCards` 扩展点（`index.ts` 从来没传过它）、
  `VendorCardsContext`、`modelCardContext`、`modelWriteModeOf`、`PageShellProps.catalogs`
  （传了但从不读）、`vendorCardKinds`、模型编辑管线（`ModelEdit` / `applyModelEdit` /
  `modelEditTarget` / `ModelEditPatch`）。`ModelsWriteMode` 类型搬到 `core/adapter.ts`。
- 净删 **1863 行**，新增 197 行。`lib/client.js` 里已不含 `data-model-filter`
  等标记（确认死代码没进产物）。

**基线**：`typecheck` 干净、`893 passed (67 files)`、`build` 通过。

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
& $node $pnpm test               # 全量（67 文件 / 893 用例）
& $node $pnpm run build          # 必须跑，lib/ 是 gitignore 的，用户看不到未构建的改动
```

**基线状态（2026-10-20 实测）**：`typecheck` 干净，`893 passed (67 files)`，`build` 通过。

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
   按原始 id 分组会把同一模型劈成两行。要显示名字就用 `officialModelName`（与模型选择器
   同一份规则，别另写一套，否则又是「名称不一致」）。
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

「模型名称不一致」已经修完（§0）。**剩下的只有「模型不可用了」，而且它大概率不在本仓库。**

1. 先看 §0.1 的新线索：那两次失败都是 `CONTEXT_WINDOW_EXCEEDED`（110 万 token 的会话 +
   256000 的输出预算 > 1M 窗口），而且**没走到本插件的 adapter**（台账没有记录）。
2. 要复现就查宿主侧：谁把 `provider` 切到 `deepseek-account`、`maxTokens: 256000` 从哪来。
3. 如果用户再报「不可用」，先确认是**报错**还是**这个模型选不到** —— 后者才可能是本插件的
   `visibleModels` / `modelVisibility` 问题（名称已经不是问题了）。

改代码前**先写失败测试**（`tests/` 下已有 67 个文件可参考写法）。
