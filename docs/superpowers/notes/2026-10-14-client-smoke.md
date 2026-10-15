# 客户端冒烟记录 —— dsh-llm-account（第 1b 期，2026-10-14）

> 本文档记录**本期（1b）在进程内能证明的部分**，以及**只能由计划 1c 在真机上回答的部分**。
> 上游：计划 `docs/superpowers/plans/2026-10-14-dsh-llm-account-phase1b-client.md`（Task 10）；
> 宿主侧的同名记录见 `2026-10-13-host-smoke.md`。
> 环境事实：本机 PATH 上的 `dsh` 是 0.1.1-rc.2，桌面端引擎是 0.2.0-rc.2 —— **没有与桌面端同版本的引擎**，
> 所以「真机启动 + 真渲染」本机做不到（与 1a 的结论一致）。

## 0. 一句话

客户端有 **25 个测试文件 / 347 条测试**全绿；浏览器产物 `lib/client.js` 形如旧插件、**零 `node:`、
只 `require("react")`**；假客户端 ctx 能把 `apply` 的注册路径走一遍。
**真机渲染、远程面是否真的被 Gateway 接受、以及所有写路径**仍是未验证假设（§3 清单）。

## 1. 全量验证（Task 10 Step 1）

```
$ pnpm typecheck   → tsc --noEmit，exit 0
$ pnpm test        → Test Files 25 passed (25) | Tests 347 passed (347)
$ pnpm build       → Build complete（id 见下）
```

产物形态（`lib/client.js`，110 433 B）：

| 断言 | 观测 |
| --- | --- |
| 首行是加载器协议 | `window.__ModuleLoader__.load({` |
| 尾行是工厂返回 | `});`（工厂体内 `return module.exports;`） |
| 导出的插件面 | `exports.apply` / `exports.applyCount` / `exports.inject` |
| 零 `node:` 内置 | 命中 **0** |
| 裸导入白名单 | **只有** `require("react")`（`react/jsx-runtime` 与 `ui-primitives` 本期未按值导入） |
| 自包含 | 不相对引用任何分块 |
| 关键实现确实进包了 | 含 `data-card`、`sidebar.footer.action`、`llm-account-dashboard`、`visibilitychange` |

宿主侧产物（`lib/index.js` / `commandcode.js` / `opencode.js`）仍保持**裸导入** `@deepseek-ai/dsh-llm`、
`@deepseek-ai/schemastery`，且 `@deepseek-ai/dsh-typert-protocol` 在共享分块里保持外部导入 —— 这三条由
`tests/client/build.test.ts` 逐文件精确断言（T3 的 Ruling 20）。

## 2. 假客户端冒烟（Task 10 Step 2，`tests/client/smoke.test.ts`）

不启动宿主、不渲染 React，用假客户端 ctx 直接调 `apply` / 接缝函数：

| 断言 | 结果 |
| --- | --- |
| 客户端入口导出 `{ apply, inject }`，`inject` 是 cordis 服务名 | `["slots", "locale", "remote"]` ✓ |
| 两个 profile 行各调一次 `apply` → 设置页只注册一次 | `settings.section` 恰好 1 次（id `llm-account`、order 12、locale `settings.llm-account`）✓ |
| 侧边栏卡片与中栏面板**常驻注册**，各一次 | `sidebar.footer.action` `{id: llm-account-quota, order: 1}`、`main` `{key: llm-account-dashboard}`（无 `id`）各 1 次 ✓ |
| usage 远程面两个行只 `$mount` 一次 | 插件级共享单例（Ruling 44）✓ |
| 设置行里 `showSidebarQuota: true` → 开关存储认得出该厂商 | `describeVendorSnapshots` + `noteSidebarSnapshots` → `commandcode` ✓ |
| `settings/document-updated` 事件让开关存储在设置页之外保持新鲜 | 事件潮按微任务合并，两次事件只读一次 ✓ |
| `layout.selectPanel` 打开/关闭面板 | 依次收到 `llm-account-dashboard`、`null` ✓ |
| 宿主没有 `layout` 服务时 `selectPanel` 返回 `false` | ✓（调用方据此降级） |
| 插槽注册抛错时 `apply` 仍然完成 | 三条注册路径都只留一行 `console.error`，不抛出 ✓ |

> **2026-10-15 机制变更（Ruling 43，提交 `9960569`）**：插槽注册从「按开关条件化」改为
> **常驻注册 + 组件按已存储开关门控** —— 插槽服务不返回注销句柄，条件注册一旦开启就撤不下来
> （关掉开关时卡片会带着定时器继续每 60s 请求，直接违背规格 §8.1 第 6 条）。旧插件
> `CommandCodeFooterEntry` 就是这么做的（"The entry stays REGISTERED — this is a render
> decision"）。因此上表里「关闭时零注册」一行随之失效：现在**关闭时零请求、零可见面**
> （组件渲染 `null`、轮询不起），注册本身常在。渲染门控发生在 React 容器里，只有真挂载才会跑
> —— 它的判定依据（模块级开关存储）与轮询语义（`createSidebarCardController`）都有进程内
> 覆盖，真机渲染是最后一环（C13）。

## 3. 计划 1c 的客户端必测清单

以下每项都是**本机无法证明**的假设。判定点与「测什么、怎么算通过」：

| # | 必测项 | 为什么本期验不了 | 通过标准 |
| --- | --- | --- | --- |
| C1 | **客户端 bundle 被加载器接受**：`lib/client.js` 能挂进页面、`apply` 真的被调用 | 需要真实浏览器与桌面端引擎 | 控制台出现 `[dsh-llm-account] client bundle loaded`，且设置里能打开统一页面 |
| C2 | **`apply` 被调用几次**（假设 ②） | 假 ctx 的调用次数由测试决定 | 数控制台里那行日志的次数；应为 2（每行一次，见 `applyCount`） |
| C3 | **设置页只出现一次**（假设 ③ 的前半段） | 假 ctx 不经过插槽系统 | 设置里恰好一个 id `llm-account` 的页面；`order: 12` 生效（位置在旧 Command Code 插件的位置） |
| C4 | **`remote.llm-account` 这个客户端服务名成立** | 我们按旧插件 `remote.commandcode` 的形状推导，未在真机验证 | `ctx.inject(["remote.llm-account"])` 能拿到命名空间，`status(vendor)` 返回数据（不是 `undefined`、不抛错） |
| C5 | **`ctx.remote.$mount({package, descriptors})` 被 Gateway 接受** | 同上 | 挂载成功后命名空间可用；失败时页面上出现可读原因（`mountUsageRemote` 的 `error()`） |
| C6 | **`ctx.typert.register(contribution)` 的宿主面贡献被接受**（T3） | 同上 | 上面 C4/C5 通过即蕴含这一条成立 |
| C7 | **`ctx.locale.register(ns, {zh, en})` 的载荷形状**（T1 的 Ruling 13） | 两个已装插件用了**两种**签名（对象式 vs 三参式），本机无法判定 0.2.0 吃哪种 | 页面标题随语言切换而变化；若为空，改用三参式 `register(ns, "zh", dict)` |
| C8 | **`slots.inject("settings.section", () => slots.register({...}, Component))`** | 假 ctx 是我们自己写的替身 | 页面出现且能渲染（含 `hooks` 为空对象时不报错） |
| C9 | **`hooks` 映射是否被投影成 `use<Key>` props**（1a 假设 ③ 的后半段） | 同上；我们目前传空 `{}` | 1c 决定统一页面的取数通道：若 hooks 可用就走 hooks，否则走 `remote.settings.describe()`（页面已按后者实现） |
| C10 | **账户写路径**：重命名 / 换密钥 / 固定 / 移除 / 添加 / 排序 / `autoSwitch` 在真机上被宿主接受 | 远程面与宿主端的契约是**推导**出来的 | 每个操作后页面数字/顺序确实变化；密钥操作后**设置文档里没有明文** |
| C11 | **登录流程与撞名拒绝**（T5 Step 7） | 需要真的浏览器登录 | 正常登录能写入密钥；撞名时页面显示「该凭据槽已被另一个账号占用」且宿主侧凭据未被覆盖 |
| C12 | **侧边栏卡片跟随生效账号**（用户的第一诉求） | 需要真实请求触发自动切换 | 打满一个账号的额度 → 卡片主体与顶部提示都应指向**新的**生效账号；固定账号与生效账号并列可见 |
| C13 | **关闭开关 = 零后台请求**（规格 §8.1 第 6 条） | 需要真实网络观测 | 关闭时 DevTools 网络面板**没有**任何用量请求；开启后才有，且只按间隔出现。（机制侧已有进程内证据：常驻注册 + 组件门控 + 开关存储 + 控制器起停；真机要验的是**组件真的渲染 null、定时器真的停**） |
| C14 | **可见性恢复只在开启时刷新** | 同上 | 切走标签页再回来：开启时有且仅有一次刷新；关闭时没有 |
| C15 | **排序交互的形态**（Ruling 31：上移/下移 vs 拖动） | 本期没有 DOM，拖动既写不出也测不了 | 用户是否接受按钮形态；若要拖动，在同一个 `onMove` 回调前加手势层（语义与参数不变） |
| C16 | **窄侧栏（56px）的呈现** | 壳层给的宽度标记本期没用上 | 若窄栏下卡片溢出/难看，按壳层标记加紧凑形态（旧插件收成 36px 图标按钮） |
| C17 | **两家都开侧边栏开关时的呈现** | 插槽只有一个，我们取第一个开启的厂商 | 用户是否可以接受；若不可接受，需要设计多卡片或多标签 |
| C18 | **模型卡片的模型来源**（Ruling 32） | 远程面没有发布模型目录，页面列的是设置文档里的模型 | 用户是否接受手动添加 id；若要可勾选的实时目录，加 `catalog(vendor)` 接上已有的 `CatalogPort` |
| C19 | **opencode 标签页的保存落盘**（Ruling 45，2026-10-15 新增） | 客户端按 describe 命中的**行名**（`opencode-go`）写入；宿主是否按条目 id 寻址只有真机能验证（`SettingsForms.write` 找 `row.options.id === ns`，本机只能读到类型与实现、不能读到运行行为） | 在 opencode 标签页改一个字段保存，重新进入页面值已变；若失败，保存条应显示可读原因（Ruling 46）而不是静默 |
| C20 | **`settings/document-updated` 事件是否真的发出**（2026-10-15 新增） | 事件名逐字取自旧插件，但 0.2.0 宿主发出与否无法在进程内观察 | 在设置页之外改一次开关（patch 文件/其它工具），看侧边栏卡片是否跟随；不发也不崩（降级 = 下次宿主重启时冷启动 describe 兜底） |

## 4. 与其它部分的衔接

- **宿主侧**：`2026-10-13-host-smoke.md` §5 的 8 项（路由注册、`enabled` 改写、写路径校验器等）与本文档的 C1–C20 一并构成 1c 的完整清单。
- **未知接缝都收在两层**：`src/client/shell.ts`（插槽/文案注册原语）与 `src/client/seams.ts`（远程面、订阅、面板、模块级共享状态）。1c 实测后**只改这两层**（计划 Review Focus 5）。
- **1b 未做的项**（显式）：滑动排序手势、窄栏紧凑形态、实时模型目录、`IntentLog.replay` 的崩溃重放演练（后者本就排在 1c）。
- **2026-10-15 续**（交接文件复盘后的修复，Ruling 43–47，提交 `9960569`/`147bd68`/`c6b5ef6`）：见 ledger 同日期节；本文件 §2 的注册表格与 C13/C19/C20 已随之更新。测试总数 373（1b 收尾时 354）。
