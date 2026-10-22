# 运维与排查手册

「DSH 起不来」「额度不显示」「刷新后界面没了」这类问题的**排查顺序与已验证结论**。
每节都以症状开头：先找到你的症状，再照着证据链走。

---

## 两次「DSH 起不来」（2026-10-19）

> **合并说明（2026-10-20）**：本文件由两份独立记录合并 —— `2026-10-19-startup-failure.md`
> （可选依赖在加载期被静态 import）与 `2026-10-19-desktop-welcome-crash-cookies.md`
> （本地鉴权 Cookie 撑爆 16KB 请求头）。
>
> 合在一起的理由：两次的症状都是「DSH 起不来」，用户与未来的排查者最先问的就是这个；
> 分成两份时容易只查到一份就下结论（第一次的根因在**插件**里，第二次**与插件无关** ——
> 这个区分本身就是最有用的信息）。原文逐节保留。

---

# 一、插件侧的「起不来」：可选依赖在加载期被静态 import

## 现象

用户报：插件改动之后 DSH Desktop 无法启动。

### 排查过程（可复现的证据链）

1. **产物语法与加载**：所有 `lib/*.js` `node --check` 通过；用宿主同款的
   `window.__ModuleLoader__.load({ id, factory })` 模拟客户端启动 → `apply` 正常跑完，
   注册 `settings.section(llm-account)` 与 `main(llm-account-dashboard)`，无异常。
2. **单测**：67 文件 / 879 例全绿。
3. **依赖闭包**：列出产物里全部裸导入，再去**宿主 profile** 的 node_modules 里逐个找 ——
   `@deepseek-ai/dsh-web` 在 `~/.dsh/profiles/desktop/node_modules` 里**不存在**（桌面端搜索
   没装/没随 profile 安装），而 `lib/web-search.js` 顶部就有 `import ... from "@deepseek-ai/dsh-web"`。

### 根因

`@deepseek-ai/dsh-web` 是**可选**依赖（`inject: ["web"]` 只保证「没有 web 服务时不调用 apply」），
但我们把 `WebError` 当**值**静态 import 了它。静态 import 在**加载期**解析：包不在 →
`ERR_MODULE_NOT_FOUND` → 这一行插件加载失败 → 宿主起不来。`inject` 挡不住加载期这一层。

### 修法

> **现状（2026-10-22）**：网页搜索功能后来被整体移除，`src/web-search/` 目录与
> `@deepseek-ai/dsh-web` 依赖都已不存在。下面这段是当时的修法记录，保留是因为它
> 解释了「静态 import 一个可选依赖会让宿主起不来」这个**通用**教训 ——
> 换任何一个可选 peer 依赖，同一个坑仍然成立。

- 新增 `src/web-search/web-error.ts`：本地镜像 `WebError`（`name: "WebError"`、`code` 逐字对齐，
  支持 `cause`）。四个调用点（`anthropic` / `custom` / `provider` / `util`）改用它；
  `import type { WebSearchResult … }` 保持不变（类型导入编译期擦除，零运行时依赖）。
- `package.json`：`peerDependenciesMeta["@deepseek-ai/dsh-web"].optional = true`。
- 回归测试两条：
  1. `build.test.ts` 的 `HOST_BUNDLES` 明确断言 `lib/web-search.js` **不含** dsh-web；
  2. 新增「任何产物都不得 `from "@deepseek-ai/dsh-web"`」的全 `lib/*.js` 扫描。

### 验收

`tsc` 0 错；67 文件 / 879 例全绿；`tsdown` 重建后产物裸依赖只剩
`dsh-credentials` / `dsh-llm` / `schemastery`（宿主自带）；客户端启动模拟仍 BOOT OK。

> **2026-10-20 补记**：`lib/` 已改为**提交进版本库**（此前被 `.gitignore` 忽略，导致
> GitHub 安装后 `package.json` 的 `exports` 指向不存在的文件、「校验未通过」）。原因写在
> `.gitignore` 里。上面第 2 条那条「产物不含 dsh-web」的扫描因此仍然有效且更重要 ——
> 产物一旦进版本库，构建错误会被直接分发出去。

---

# 二、桌面端的「起不来」：本地鉴权 Cookie 撑爆 16KB 请求头

## 现象

桌面端启动即崩，崩溃报告固定为：

```
phase: startup
Error: desktop welcome: Web authentication failed
    at connectDesktopWelcome (.../app.asar/lib/main.js:8886:31)
    at async Object.start (.../app.asar/lib/main.js:12195:22)
```

当天 13:19–13:48 共 10 份崩溃日志，全部同一条错误；渲染进程没有任何错误输出。

### 根因（已用证据闭环）

1. 桌面端启动流程（`main.js` 12190–12195）：
   `host.start()` → `authenticateWebHost(ready.url)` → `connectDesktopWelcome(ready.url, net.fetch)`。
   `connectDesktopWelcome` 用 Electron `net.fetch`（Chromium 会话）GET 本地宿主的启动 URL，
   **任何非 2xx 都会抛 "desktop welcome: Web authentication failed"**。
2. 宿主每次启动监听**随机端口**，并为该端口签发一条本地鉴权 Cookie：
   名字是 `dsh-auth-<base64url(sha256("127.0.0.1:<port>"))>`，值约 171–173 字节，
   `Path=/`、持久化 30 天（`dsh-client-connection` 的 `cookieName` / `sessionCookie`）。
3. 端口每次不同 → 每次启动都**新增**一条 Cookie，旧的全部留在 Chromium 罐里。
   Chromium 对同一主机（`127.0.0.1`）的所有请求都会把**全部** Cookie 塞进一个 `Cookie:` 头。
4. 宿主是 Node HTTP 服务器，默认 `maxHeaderSize = 16384` 字节。
   实测：71 条 Cookie 时头部已 **16,082 字节**（加 `cookie: ` 前缀 16,090），
   再叠加 UA / Accept / Accept-Encoding / sec-fetch-* 等常规头 → 超过 16KB →
   **431 Request Header Fields Too Large**。
5. 第 71 条 Cookie 的创建时间 = `2026-10-19T05:19:50.408Z`，第一份崩溃日志 =
   `05:19:50.498Z`（相隔 90ms）。之后每次启动在**第一个请求**就 431，
   连新 Cookie 都写不进去，所以 Cookie 数量冻结在 71，崩溃永久化。

### 证据

- 真实库：71 条全部是 `127.0.0.1` 的 `dsh-auth-*`，`PRAGMA integrity_check` 正常。
- 用宿主的真实启动 URL 实测：
  - 只带新 Cookie `GET /` → **200**；
  - 带「71 条旧 + 1 条新」`GET /` → **431**。
- 浏览器同款请求头 + 本地 Node HTTP 服务：n=70 → 200，**n=71 → 431**。
- 同一个插件、同一份 profile，用**全新 Electron user-data 目录**启动桌面端：
  45 秒内无崩溃，并正常写入 1 条新 `dsh-auth-*`（握手走通）。
- 清空 71 条后，用真实配置启动：90 秒无新崩溃日志，且只写入 1 条新 Cookie。

### 与插件无关

- 崩溃栈没有一帧落在插件代码里，失败点是桌面端 shell 对自己的本地宿主做 HTTP 握手。
- 用完整插件与 profile、仅更换 Electron user-data 目录即可正常启动。
- 插件构建出的宿主侧服务用 Node fetch 实测 `GET /` 200、`settings/describe` RPC 200。
- 时间上的巧合：第 71 次启动正好发生在插件返修之后，实际是 Cookie 累积到阈值。

### 修复（已执行）

1. 备份真实 Cookie 库到 `%TEMP%/opencode/backups/Cookies-<时间戳>`。
2. 删除 `cookies` 表中全部 `host_key='127.0.0.1' AND name LIKE 'dsh-auth-%'` 的行
   （共 71 条；该库当时只有这些行）。
3. 重启验证通过（见上）。

### 复发与预防

- 每启动一次桌面端新增 1 条 Cookie，约 **71 次启动**后再次触顶
  （按每天 5–6 次，约 1–2 周）。
- 这些 Cookie 在宿主进程退出后本来就已经作废（签名密钥每进程随机），
  **可以随时全删**；重启后会自动生成一条新的。
- 本仓库提供清理脚本：

  ```powershell
  node scripts/clear-desktop-auth-cookies.mjs
  # 或
  npm run fix:desktop-cookies
  ```

  脚本会先检查桌面端是否在运行、自动备份数据库，再删除 `dsh-auth-*` 行。
- 如果想彻底免手动：可以加一个登录时/每日的计划任务运行上述脚本（未自动创建，需用户确认）。
- 上游建议（供反馈给 DSH 团队）：桌面端启动时清理过期的 `dsh-auth-*` Cookie，
  或让宿主使用稳定端口 / 复用持久化密钥，避免按 `host:port` 无限累积 Cookie。

---

# 两次的区分方法（给以后的排查）

| 特征 | 插件侧（一） | 桌面端 Cookie（二） |
| --- | --- | --- |
| 崩溃栈是否落在插件代码 | 是（`lib/*.js` 加载失败） | 否（`app.asar/lib/main.js`） |
| 错误类型 | `ERR_MODULE_NOT_FOUND` | `Web authentication failed` / HTTP 431 |
| 换全新 user-data 目录能否启动 | 不能（问题在插件产物） | **能** |
| 卸载插件能否启动 | **能** | 不能 |
| 快速自检 | `node --check lib/*.js`、扫产物裸导入 | `npm run fix:desktop-cookies` |


---

## 2026-10-20 两次全量审计

> **合并说明（2026-10-20）**：本文件由两份独立报告合并 ——
> `2026-10-20-audit-search-and-save.md`（第一次，用户要求「检查有没有 bug」）与
> `2026-10-20-review-round2.md`（第二次复审）。两份都是「发现 → 修复 → 回归测试」的记录，
> 结论都已落到代码与测试里；合并是为了让「这个仓库在 2026-10-20 被查过什么」只需读一处。
> 原文逐节保留，被删文件可从 git 历史取回。

---

# 第一次审计：搜索一族 + 设置保存

## 结论

**5 个问题，其中 2 个是真 bug（都会让功能实际不可用），3 个是隐患/套件可靠性**。全部已修，
每条都有测试锁住（变异检验过：把修复改回旧行为，对应测试变红）。

| # | 问题 | 性质 | 用户可见症状 |
|---|---|---|---|
| 1 | 搜索网关路拿错行的密钥与端点 | **真 bug（最严重）** | 配了 commandcode 账号的人，在 opendesign + DeepSeek 会话里搜索**永远失败** |
| 2 | 取消搜索后继续试剩下的 key | **真 bug** | 按了停止，界面报「已尝试 N 个密钥」；多打若干次注定失败的请求 |
| 3 | 密钥实测因加载顺序静默降级 | 隐患 | 某天实测按钮集体变成「这个版本不支持」 |
| 4 | 实测结论可能贴错行 | 隐患 | 「测试」结果显示在别的密钥行上 |
| 5 | 测试套件偶发红 | 套件可靠性 | CI/本地偶尔失败，掩盖真实的回归 |

### 1. 搜索网关路拿错行的数据（真 bug）

**根因**：网关路要读「当前会话所属厂商的行」拿 baseURL 与密钥。旧实现按**固定顺序**取第一个
可用的 provider 行（`commandcode` 优先），而不是按会话实际所属的那家。于是 opendesign 会话
的搜索拿着 commandcode 的端点和密钥去打，必然失败。

**修法**：改为由调用方传入**本次会话的 provider**，按它寻址该行；取不到时明确降级
（不猜另一家）。

### 2. 取消搜索后继续试剩下的 key（真 bug）

**根因**：`searchWithApiKeys` 的循环只在**发起前**检查中止信号，`fetch` 抛 `AbortError`
时被当成「这个 key 不行」继续下一个。

**修法**：新增 `isAbortError()`；捕获到中止立即 `return`（不是 continue）。同时
`strategyCanFallBack()` 区分「策略允许回退」与「这次失败可以回退」—— 用户主动取消不算失败。

### 3. 密钥实测因加载顺序静默降级（隐患）

**根因**：`probeSearchKey` 依赖注入，而注入发生在模块装配的最后一步。若装配顺序变化
（或某个可选依赖缺席提前返回），探测函数是 `undefined`，`probeVerdictOf` 就回
「这个版本不支持」—— 一个装配问题被伪装成版本不支持。

**修法**：`usage-remote.ts` 用 `.find(deps => deps.probeSearchKey !== undefined)` 显式查找
能力提供方，而不是假设位置；找不到时给**明确的**原因（不再是「版本不支持」）。

### 4. 实测结论可能贴错行（隐患）

**根因**：容器按 ref 存探测结论，但渲染时行的 ref 可能因为账号重命名/重排而变化，
导致结论贴到相邻行。

**修法**：`keyProbes` 以 ref 为键并随行一起读取；行身份变化时结论失效而不是错贴。

### 5. 测试套件偶发红（套件可靠性）

**根因**：若干用例依赖真实计时器与固定端口，在慢机上偶发超时。

**修法**：改用假计时器 / 注入时钟；对必须真实的用例放宽超时并写明理由。

### 审计过但**没有**问题的部分

- 设置保存的 revision 围栏（`expectedRevision` 每次写前重读，冲突有明确错误）；
- 串行写队列（并发点击不会互相覆盖）；
- 密钥**明文**从不进设置文档（只存 ref）；
- 搜索 key 的**非 ASCII** 输入在本地判 `invalid`（不浪费一次请求）。

### 验证

typecheck 0 错、全量 vitest 绿、`tsdown` 双产物重建；5 条修复各有回归测试，全部做过
变异检验（改回旧行为 → 对应用例变红）。

---

# 第二次审计（复审）

- 触发：用户要求复审，并提到「deepseek 说没有 bug 了」
- 纪律：**只读审查** —— 未改代码、未提交；`lib/` 重建后确认与已提交产物一致。

## 结论

**没有高/中危功能 bug**（第一次审计的判断基本成立）。严格挑出 **4 个 LOW 级健壮性缺口**，
全部属于同一类：边界形状校验不完整 —— 项目自己的纪律是「线上值形状不可信」，多数模块做到了，
有四处漏了。

### 4 个发现（按危害排序）

### 1. 限流冷却可能被静默绕过 — LOW

- 位置：`src/vendors/commandcode/failures.ts`（30 天重置视野判定）
- 根因：只查上界（`value <= horizon`），不查下界。厂商若回一个**过去**的重置时刻，该值会通过
  校验进入 `Rejection.resetAt`；`RotationEngine` 发现 `now >= expiresAt` 便当场删除拒绝记录
  —— 等于这次限流**完全没有冷却**，账号被立刻重试。
- 对照：opencode / opendesign 不解析正文 resetAt，无此问题。
- 建议修法：`resetAt > now` 才采信，否则退回 `now + 5 分钟冷却`。

### 2. `discoverVendors` 不校验行是否是对象 — LOW（失败形态最难自查）

- 位置：`src/client/seams.ts:218` 附近
- 根因：循环里直接读 `row.ns` / `row.id`。宿主 `describe()` 数组里混进一个 `null` 即抛
  TypeError；而该调用点**没有 `.catch`** → 未处理拒绝 + 设置页永远拿不到快照（症状：设置页
  空白且无任何提示）。
- 对照：同类代码 `completeReading`、`parseCredentialStatus` 都校验了对象形状，唯独这里漏了。

### 3. 额度字段用「长度」判真假，字符串也有 length — LOW

- 位置：`src/client/account-card.ts` / `dashboard.ts`
- 根因：`quotaOf?.windows?.length ? quotaOf.windows : 兜底` 与 `(quotaOf?.failures ?? []).map(...)`。
  若线上 `quota.windows` 是**字符串**，长度检查通过，随后 `.map` 抛错。更深的根因：
  `parseVendorUsageStatus` 只验顶层形状、不逐项校验 `quota`（而 `parseCatalogModels` 是逐项洗的）。
- 影响面：有 `RenderBoundary` 兜底，不会白屏，但对应面板降级为「面板失败 + 重试」。

### 4. 三行不对称（信息性） — INFO

- commandcode 的 Config 不声明 `enabled` 字段（opencode / opendesign 都有）。
- 后果：用户手改 profile 把 commandcode 行配成 `enabled: false` **不会生效**。宿主插件管理器
  级禁用不受影响。
- 不是门失效（commandcode 本就无条件注册），是字段缺失导致的三行不一致。

### 顺带记录（非缺陷）

- 死语句 `void currentKey;`（`src/core/switching/model-fallback.ts:191`）。
- `fallbackEffort` 生产未接线（仅测试使用）；档位安全性由 `#declaredEffort` 声明闸门保证，
  功能不缺。
- 第一次审计已修的真 bug 本轮复核**未回归**。

### 证伪记录

曾假设 `src/core/transport.ts` 的 `Promise.race` 落败者晚到 rejection 会造成未处理拒绝。
写独立复现脚本实测**不成立**：`Promise.race` 给两个输入都挂了 handler，晚到 rejection 被其
吞掉；对照组（裸 `Promise.reject`）验证了检测器有效。故未计入发现。教训：先复现、再报告。

### 审查覆盖与证据

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错 |
| vitest 全量 | 109 文件 / 1244 例全绿 |
| tsdown 构建 | 15 文件；四个宿主入口均可加载 |
| 客户端启动冒烟 | 三条注册 + 三次注入，形状正确 |
| CSS 模板字面量 | 62 个反引号配对；源码与产物 `.dsl-*` 类名数一致（138 = 138） |
| 逐层审查 | core 纯函数；三家适配器 stream 主循环与装配；usage-remote 远程面；客户端页面/容器/样式/更新检查 |

### 修复记录（控制器实施，2026-10-20 晚）

四条**全部**已修，各带回归测试与变异检验（把修复改回旧行为，对应用例变红）：

| # | 修法 | 测试 |
| --- | --- | --- |
| 1 | `withinHorizon` 加上下界 `value > now`：过去的时刻不是证据，丢弃让调用方退回短冷却 | `commandcode.test.ts` +2（显式秒数 / 文案 ISO 时间戳落在过去） |
| 2 | `discoverVendors` 的循环先验 `typeof row === "object" && row !== null`；空态统计同样跳过坏元素 | `settings-describe-shape.test.ts` +2（混进 null/非对象 / 全是坏元素） |
| 3 | 在**边界**上逐项洗 `quota`（`parseVendorUsageStatus`）：`windows`/`failures` 非数组归空、`quota` 非对象归缺失。一处修复覆盖三张卡片 | `usage-contract.test.ts` +3（坏 windows / 坏 quota / 真形状原样通过） |
| 4 | commandcode 的 Config 补 `enabled`（`default(true)`）并据此 `registerAdapter`/撤下 | `assembly.test.ts` +2（false 不注册 / 缺省按启用） |

**发现 3 的根因位置**值得记一笔：报告指出的三处 `.length` 假值检查只是**症状**，真正的缺口在
`parseVendorUsageStatus` 只验顶层、把 `quota` 原样透传（而同文件 `parseCatalogModels` 是逐项
清洗的）。修在边界上，三张卡片就不必各自防御 —— 这也是项目既有的分工。

「顺带记录」两条的处理：死语句 `void currentKey;` 与其**随之变死的局部变量** `currentKey`
已删除（`model-fallback.ts` 里那行 `const currentKey = modelKeyOf(...)` 定义后只在死语句里被
引用过）；`fallbackEffort` **未动** —— 它由 `#declaredEffort` 声明闸门保证安全，不是缺陷，
改动它反而增加风险。


---

## 宿主接缝假设与真机验收清单（2026-10-13）

日期：2026-10-13
项目：`dsh-llm-account`（一个包，托管两条 provider 路由：`commandcode`、`dsh-opencode-go`）
上游：计划 `docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md`（Task 1）；规格 `docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`（§4.1、§8、§14）

> **2026-10-20 注**：本文件提到的 1a 期计划 `2026-10-13-dsh-llm-account-phase1-host.md` 与冒烟记录
> `2026-10-13-host-smoke.md` 已在文档清理时删除（它们描述的是已完成且被后续重构取代的阶段，
> 其中「未验证项」清单的结论已并入后续文档）。**本文的假设条目仍然有效**，需要原文时从 git 历史取回。

### 0. 这份文档是什么

原计划的「宿主接缝试验」（写一个最小插件、在本机建 profile、启动宿主观察行为）已被用户取消。本文件把原本要靠试验回答的问题**改写成假设**，供两个下游使用：

- **计划 1b**（客户端统一页面）：按假设 ②③ 的兜底实现方式写代码。
- **Task 14**（两行装配与宿主冒烟）：用假 ctx 覆盖装配逻辑，只做得到的一小部分验证。
- **计划 1c**（真机切换验收）：必须逐条实测本文件 §4 的清单，把假设变成结论。

**读法**：§2 的三条都是**未验证假设，不是结论**。任何人不得把它们当作已确认的宿主行为引用。假设错误的后果已经写进每条里，目的是让 1b 的改动面最小。

### 1. 为什么跳过试验：两条硬事实

| 事实 | 证据 | 对试验的影响 |
| --- | --- | --- |
| 本机 PATH 上的 `dsh` CLI 是 **0.1.1-rc.2**（旧引擎） | 启动器 `C:\Users\me\AppData\Roaming\npm\dsh.ps1` → `C:\Users\me\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\package.json`，`"version": "0.1.1-rc.2"`（写作本文档时读文件核对；未执行任何 `dsh` 命令） | 用旧引擎建 profile 得到的宿主接缝结论不可信：桌面端不跑这个引擎 |
| 桌面端实际引擎是 **0.2.0-rc.2** | `C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json`，`"desktopVersion": "0.2.0-rc.2"`（写作本文档时读文件核对） | 结论必须在与桌面端同版本的引擎上取；本机没有 |

**第三条取消理由**：客户端 `apply` 被调用几次（假设 ②）只能在**真实浏览器**里观察，本机没有这条观察通道 —— 它不是 CLI 能回答的问题。

### 2. 三条假设

### 假设 ① 子路径导出能被宿主加载器解析

- **假设**：宿主加载器能解析 `dsh-llm-account/commandcode` 与 `dsh-llm-account/opencode` 这类子路径导出，因此 `cordis.patch.yml` 里两行可以各自指向一个子路径入口。
- **依据**：Node 的 `exports` 字段解析规则；Task 0 已按 Global Constraints 写全 `exports`（`./commandcode`、`./opencode`、`./client`、`./package.json`）。
- **验证方式**：Task 14 Step 2 —— `pnpm build && node -e "import('dsh-llm-account/commandcode').then(m => console.log(Object.keys(m)))"`，期望打印出 `apply`、`Config`、`inject`、`PROVIDER_ID` 且无 `ERR_MODULE_NOT_FOUND`。
  注意：这一步只证明 **Node 能解析**该导出，不等于**宿主加载器**能解析；宿主加载器一侧列在 §4 清单第 2 项，由计划 1c 实测。
- **假设错误的后果**：两行的 `name` 要退回**包根 + 参数化的单入口**（`dsh.bundle.patch` 两行同指包根，入口靠参数区分厂商）。改动集中在装配层，不影响 `src/core/` 与两个适配器。
- **结论（2026-10-17 实测，回填）**：宿主加载器**能**解析子路径（两行都能挂载），但客户端 `client-modules` 的启动图扫描**对子路径返回 `undefined`**——子路径行不产生客户端 source，`./client` bundle 不进启动图，浏览器端**零 UI、零报错**。另：同一个声明 `dsh.client` 的包**只能有一个** source，两行同时可见会失败整个客户端启动；且插入行的相对路径以**本 patch 文件所在目录**为基准（不是 profile）。最终只保留 `llm-commandcode` 一行用子路径，`opencode-go` 行改用 `./lib/opencode.js`；完整证据与设计见 `2026-10-17-client-boot-graph.md`。

### 假设 ② 同一个包插入两行时，客户端 `apply` 被调用两次（每行一次）

- **假设**：两行 → 宿主调用客户端 `apply` 两次，每行一次。
- **依据**：**无** —— 纯未验证，且只能在真实浏览器里观察。规格 §14 把这一项列为未决风险（「可能出现两个设置页或只注册一个」）。
- **因此计划 1b 走兜底路径**：统一设置页**不依赖每实例注入的状态**，而是直接按设置命名空间（`llm-commandcode`、`llm-opencode-go`）读取两家的数据。（规格 §8 的主路径是模块级单例注册表、只有主实例注册那唯一一个页面；1b 采用兜底路径，两条路径页面组件与数据形状相同，只换数据来源。计划 1b 已按此记录。）**注（我们的推理，非宿主观察）**：兜底路径解决的是**数据来源**，不解决页面**重复注册**；若计划 1c 实测发现页面被注册两次，需要另行决定「只让主实例注册页面」。
- **验证方式**：计划 1c 实测两项 —— **(a)** §4 清单第 3 项：页面注册次数；**(b)** 同项要求的调试计数/日志：`apply` 实际被调用几次。**因果链**：(a) 只有在「每行无条件注册页面、且宿主不按 id 去重」时才蕴含 `apply` 的次数 —— 宿主按 id 去重，或 1b 自己加了一次性守卫，都会让「恰好一个」在 `apply` 跑一次或两次时同样成立，所以 (a) 单独不足以判定；(b) 是直接证据。**若只取 (a)，假设 ② 仍属未验证。** 本期与 Task 14 都无法验证（假 ctx 不经过浏览器加载器）。
- **假设错误的后果**：若 `apply` 实际上只被调用一次（或注册表机制可用），页面**可以简化** —— 改为依赖注入的状态，去掉按命名空间直读的那一层；成本是白写了一层数据源适配，不返工页面组件。

### 假设 ③ `settings.section` 接受 `order`，且 `hooks` 键被投影成 `use<Key>` props

- **假设**：客户端插件的 `settings.section` 注册接受 `order` 并据此排序；`hooks` 映射里形如 `commandCodeSettings` 的键，在页面里以 `props.useCommandCodeSettings(selector)` 的形式可用。
- **依据**：旧插件的**调用点形状**（§3），来自**控制器的只读调研**，不是本文档作者的验证；规格 §14 另记：宿主包在不可读的 asar 里，契约无法从已安装文件读出，只能靠行为观察。
- **实现方式（计划 1b）**：按旧插件的调用点形状实现 —— `{ name, id, order, label, locale?, inject }` + `hooks` 映射 —— 并把这一层收在一个**薄适配层**里，实测后只改那一层。统一页面按规格 §8 注册一个 `settings.section`（id `llm-account`，order 12，取代旧插件的两个页面）。
- **验证方式**：Task 14 验证不了（假 ctx 不触发页面注册）；计划 1c 实测三处 —— §4 清单第 4 项（`order` 是否生效）、第 6 项（设置字段能否经 `hooks` 投影出的通道读出并渲染，对应本假设的后半段）、第 3 项（页面是否出现、出现几次）。
- **假设错误的后果**：只改薄适配层，页面主体不动。若 `order` 不被接受，页面在设置里的顺序需要另找机制（例如依赖注册先后或 `id`）；若 `hooks` 键不被投影成 `use<Key>`，该页面拿设置数据的通道需要改为其它可用路径（例如走远程 `settings.describe()`）。

### 3. 旧插件的调用点形状（引用，本文档未验证）

来源：**控制器的只读调研**。安装目录为 `C:\Users\me\.dsh\profiles\desktop\node_modules\`。本文档作者**没有打开**这些包，以下内容逐字来自任务书，未经独立复核。

- Command Code 客户端 `@mars-sea/dsh-commandcode-provider/lib/client.js`：
  - `settings.section` 注册形状 `{ name, id, order, label, locale, inject }`（id `commandcode`，order 12）。
  - `hooks` 键形如 `commandCodeSettings`；页面以 `props.useCommandCodeSettings(selector)` 读取。
- OpenCode 客户端 `dsh-opencode-go/lib/client.js`：
  - 同样 `settings.section`（id `opencode-go`，order 20，**无** `locale` 字段）；页面以 `props.useOpencodeGo(selector)` 读取。
- 两者共同点：都通过 `ctx.remote.$on("credentials/reference-updated", …)` 接收凭据推送；都自带 `<style data-plugin-css>`；都只用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`/`Tag`/`Switch`/`Menu`。

用途：假设 ③ 的依据，以及计划 1b 页面注册与数据读取的书写模板。它是**观察到的旧插件写法**，不等于**宿主接受的契约**。

### 4. 计划 1c 必须实测的清单

计划 1c 要在用户在场、与桌面端同版本（`0.2.0-rc.2`）的引擎上执行。以下每项都是假设转结论的判定点：

| # | 必测项 | 怎么测 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 真机启动 | 卸载旧插件、装入新包后启动桌面端 | 正常启动，无重复注册 provider 路由或行 id 导致的失败（两插件互斥，规格 §13） |
| 2 | 两条路由是否注册 | 在模型选择器/配置里查看路由 | `commandcode` 与 `dsh-opencode-go` 都注册，各一次（同时验证假设 ① 的宿主加载器一侧） |
| 3 | 页面被注册几次 / `apply` 被调用几次 | 打开设置，观察统一页面；同时读计划 1b 在 `apply` 里留下的调试计数或日志（见 §5） | **直接证据**：计数/日志显示的 `apply` 次数（应为 2，每行一次）。**间接**：页面恰好一个（id `llm-account`）—— 不是两个，也不是零个；但它只在「每行无条件注册页面且宿主不按 id 去重」时才蕴含 `apply` 只跑了一次，**仅凭注册次数，假设 ② 仍属未验证** |
| 4 | `order` 是否生效 | 观察统一页面在设置里的位置 | 落在期望的 order 位置；否则记录实际顺序与机制（假设 ③ 的判定点） |
| 5 | 模型目录是否出现在选择器里 | 打开模型选择器 | 两家（按可见性规则应出现的）模型都出现且可选 |
| 6 | 统一页面的设置数据通道可用 | 打开统一页面，切到两个厂商标签，确认两家的设置字段能读出并渲染 | 两家字段都能经宿主把 `hooks` 键投影出的 `use<Key>`（或 1b 最终采用的那条通道）读出并渲染，不是空值且无报错；读不出即假设 ③ 的后半段不成立（假设 ③ 的判定点） |

Task 14 Step 4 的 `docs/superpowers/notes/2026-10-13-host-smoke.md` 需把本期无法验证的部分指向本清单。

### 5. 与其它任务的衔接

- **计划 1b**：用假设 ③ 的形状写薄适配层；按假设 ② 走兜底路径（页面直读两个命名空间）；并在 `apply` 里留一个调试计数或日志，供计划 1c 直接读出 `apply` 的真实调用次数（否则只能靠注册次数间接推断，假设 ② 无法判定，见 §2 ②）。
- **Task 14**：Step 2 验证假设 ① 的 Node 一侧；Step 3 用假 ctx 覆盖装配；Step 4 记录无法验证项。
- **计划 1c**：执行 §4 清单，回填结论；任何一条与本文件假设不符，都只改对应的薄层/装配层。

