# Task 14 宿主冒烟记录：构建、子路径解析与装配测试

日期：2026-10-13（Round 1 修复后于 2026-10-14 重跑记录）
项目：`dsh-llm-account`（一个包，两行：`llm-commandcode` / `opencode-go`）
上游：计划 `docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md`（Task 14，Step 2–4）；绑定规格 `docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`（§5 装配、§6.2 端口、§12 测试策略）
相关：`docs/superpowers/notes/2026-10-13-host-seam-assumptions.md`（**§4 是计划 1c 的必测清单**，本文件 §5 与它逐条对应）

## 0. 这份文档是什么、不是什么

本文件记录 Task 14 在**进程内**能证明的三件事：构建产物形状、两个子路径导出的解析结果、装配测试覆盖了什么。

**它不是真机验收记录。** 本机没有与桌面端同版本（`0.2.0-rc.2`）的 `dsh` CLI（事实与证据见 host-seam-assumptions 文档 §1），因此本文档里**没有任何一条结论来自真实宿主启动**。凡是只有真机能回答的问题，一律进 §5 的未验证清单，交给计划 1c 在用户在场时实测。

## 1. 构建：`pnpm build`

命令：`pnpm build`（= `tsdown`，配置 `tsdown.config.ts`）
结果：`✔ Build complete`，`12 files, total: 1.83 MB`，无警告级错误（只有一条 `deps.onlyBundle` 的提示）。

逐字摘录（长度已截断）：

```
ℹ entry: src/index.ts, src/vendors/commandcode/index.ts, src/vendors/opencode/index.ts
ℹ target: node22
ℹ lib\opencode.js                     1.51 MB
ℹ lib\commandcode.js                136.74 kB │ gzip: 46.37 kB
ℹ lib\index.js                        0.10 kB │ gzip:  0.10 kB
ℹ lib\node-Cx2m3WEb.js              106.22 kB │ gzip: 27.93 kB
ℹ lib\failures-B2mU4SVo.js           38.24 kB │ gzip: 15.21 kB
ℹ lib\promise-Byk-o4CM.js            17.24 kB │ gzip:  5.50 kB
ℹ lib\rolldown-runtime-B4iAMlE-.js    1.58 kB │ gzip:  0.74 kB
ℹ lib\node-d5a64Vo_.js                0.96 kB │ gzip:  0.49 kB
ℹ lib\opencode.d.ts                   3.94 kB │ gzip:  2.26 kB
ℹ lib\commandcode.d.ts                3.71 kB │ gzip:  2.14 kB
ℹ lib\index.d.ts                      0.09 kB │ gzip:  0.11 kB
ℹ lib\assembly-wmcGD5PI.d.ts         16.15 kB │ gzip:  7.11 kB
```

产物形状（`lib/` 的 12 个文件）：

| 文件 | 角色 |
| --- | --- |
| `lib/index.js`（101 B）、`lib/index.d.ts`（92 B） | 包根：只导出包名常数，真实入口是两条子路径（与 `exports` 一致） |
| `lib/commandcode.js`（136 738 B）、`lib/commandcode.d.ts`（3 714 B） | `exports["./commandcode"]` 的目标：`cordis.patch.yml` 里 `llm-commandcode` 行的 `name` |
| `lib/opencode.js`（1 506 433 B）、`lib/opencode.d.ts`（3 942 B） | `exports["./opencode"]` 的目标：`opencode-go` 行的 `name`。体积大是因为内联了非宿主依赖（`@earendil-works/pi-ai` 及其 `openai` / `@anthropic-ai/sdk` / `standardwebhooks` / `partial-json` 等），**不是**宿主包 |
| `lib/assembly-wmcGD5PI.d.ts`（16 153 B） | `dts` 生成的共享声明块（content hash 命名，每次构建可能换名） |
| `lib/node-*.js`、`lib/promise-*.js`、`lib/failures-*.js`、`lib/rolldown-runtime-*.js` | rolldown 的共享运行时代码块（content hash 命名） |

**`lib/client.js` 不存在**——这是刻意的：`exports["./client"]` 与 `package.json` 的 `dsh.client` 声明保留，但 `tsdown.config.ts` 的 `entry` 只有 `index` / `commandcode` / `opencode`（当前配置是 `platform: "node"`，用它构建浏览器产物只会产出一个装不进 GUI 的 bundle）。客户端 bundle 是计划 1b 的交付物，见 §5 第 7 项。

三条 tsdown 硬约束（Task 0 实测结论，控制器补充第 2 条）的落地情况：① `entry` 是**对象**映射，产物是扁平的 `lib/commandcode.js` / `lib/opencode.js`，与 `exports` 的扁平目标一致；② `fixedExtension: false` 保留，产物是 `.js` 而不是强制 `.mjs`；③ 没有用 node 目标去构建 `./client`。

## 2. 子路径导出解析（Task 14 Step 2）

命令与逐字输出：

```
$ node -e 'import("dsh-llm-account/commandcode").then((m) => console.log("commandcode:", JSON.stringify(Object.keys(m).sort())))'
commandcode: ["Config","PROVIDER_ID","apply","inject","name"]
$ node -e 'import("dsh-llm-account/opencode").then((m) => console.log("opencode:", JSON.stringify(Object.keys(m).sort())))'
opencode: ["Config","PROVIDER_ID","apply","inject","name"]
$ node -e 'import("dsh-llm-account").then((m) => console.log("root:", JSON.stringify(Object.keys(m).sort())))'
root: ["PACKAGE_NAME"]
```

结论：两个入口都能被 Node 按 `exports` 解析，无 `ERR_MODULE_NOT_FOUND`，各自导出 `{ Config, PROVIDER_ID, apply, inject, name }`。

**这一步证明的是「Node 能解析该导出」**，不等于「宿主加载器能解析」（host-seam-assumptions 假设 ① 的后半段）——后者只有真机启动能回答，见 §5 第 1、2 项。

## 3. 宿主包在 `lib/` 里是裸导入（Ruling 11 的验收步骤）

命令（在仓库根执行）：

```powershell
Get-ChildItem lib -Filter *.js | Select-String -Pattern 'from\s*"@deepseek-ai/[^"]+"' -AllMatches
```

命中的导入语句（去重）：

| 文件 | 导入说明符 |
| --- | --- |
| `lib/commandcode.js` | `@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery` |
| `lib/opencode.js` | `@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery` |
| `lib/failures-B2mU4SVo.js` | `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-launch-environment`、`@deepseek-ai/dsh-llm` |

结论：宿主包是**裸导入**（`from "@deepseek-ai/..."`），没有被内联进 `lib/`。这正是把宿主包从 `devDependencies` 提升为 `peerDependencies` 的效果：`LlmAdapter` 这类被**值导入**的宿主符号不会出现第二份副本，宿主侧 `instanceof` 判定不会被打破。（`@deepseek-ai/cordis` 只在类型位置使用，所以不出现在 JS 里。）

## 4. 装配测试：`tests/vendors/assembly.test.ts`

命令：`pnpm vitest run tests/vendors/assembly.test.ts --reporter=verbose`
结果：`8 passed (8)`。全量套件：`pnpm test` → `Test Files 14 passed (14)`、`Tests 195 passed (195)`。

| 测试 | 证明什么 |
| --- | --- |
| 两个入口各注册一次自己的 provider 路由 | `commandcode` 入口注册 `["commandcode"]`、opencode 入口（启用态）注册 `["dsh-opencode-go"]`，各一次；`inject` / `name` / `PROVIDER_ID` 与全局约束一致 |
| opencode 的 enabled 为 false 时不注册路由，为 true 时注册一次 | 用户现有 profile 行 `enabled: false`（零迁移的机器可验证部分）：**不注册路由**，但行仍挂载（适配器、账号端口、额度端口照旧构造，凭据事件照旧订阅）；`enabled: true` 时注册一次 |
| opencode 的 enabled 改成 false 会撤下已注册的路由 | 已解析配置上的 `enabled` 被改写后，经 `loader/volatile-update` 重判：释放注册句柄（路由与模型目录撤下）、重复广播不重复注册、再打开时重新注册一次。与旧插件 `applyRoute`（`dsh-opencode-go/lib/index.js` 第 8613-8626 行）及 `lib/types/index.d.ts` 第 18 行「false withdraws the route; the plugin stays mounted」同义 |
| Config 能解析用户现有的 commandcode 配置形状 | 用户 profile 里的 `apiKeyEnv` / `visibleModels` / `modelVisibility` / `showSidebarQuota` / `accounts` / `activeAccount` / `modelAccountRules` 解析后字段值原样保留 |
| Config 能解析用户现有的 opencode 配置形状 | 用户的 `usageDisplay` / `modelVisibility` / `autoSwitch` / `enabled: false` 解析后原样保留 |
| 同一设置命名空间只构造一个意图日志 | `IntentLog`「一份存储只配一个实例」的前置条件（Task 8）：同一命名空间两次装配拿到同一实例，另一条路由拿到另一个 |
| 凭据变更后清除该账号的失效标记 | Ruling 23：`credentials/reference-updated` 能清掉该账号的 `invalid-credential` 标记（补上密钥后重新参与轮换） |
| opencode 的固定命名空间在宿主上解析到 profile 行 id | 设置命名空间 `llm-opencode-go` 在假宿主上解析到行 id `opencode-go`：读与写都落在行 id 上，写 `llm-opencode-go` 会落空 |

假 ctx 只覆盖**装配逻辑**：它替身了 `ctx.llm.registerAdapter`、`ctx.on`、`ctx.effect`、`ctx.get("settings")` 与 `ctx.get("credentials")`，不经过宿主加载器、不经过浏览器。

## 5. 本期无法验证的部分（计划 1c 的必测项）

以下每一项都是**未验证**，不是「已验证为真」。判定点与通过标准见 host-seam-assumptions 文档 §4；本表补上「为什么本期做不了」。

| # | 无法验证的项 | 为什么本期验证不了 | 计划 1c 怎么做 |
| --- | --- | --- | --- |
| 1 | **真机启动**：卸载旧插件、装入新包后宿主能正常起来 | 本机没有与桌面端同版本（`0.2.0-rc.2`）的 `dsh` CLI；假 ctx 不加载插件、不解析 `cordis.patch.yml` | 用户在场时真机启动，观察无重复注册 provider 路由 / 行 id 导致的失败（两插件互斥，规格 §13） |
| 2 | **真实路由注册**：`commandcode` 与 `dsh-opencode-go` 在宿主里各注册一次；以及 `enabled: false` 的行在真机上确实不上线 | 同上。特别地，`enabled` 的**改写**重判依赖 `loader/volatile-update` 这一接缝（本包按旧插件的同一事件名声明并订阅，但宿主侧发出与否本期无法观察）；挂载时的 `enabled` 门是进程内可证的，改写路径不是 | 在模型选择器/配置里查看两条路由；再在设置里把 `enabled` 改一次，确认路由与模型随之撤下、且行仍挂载（若不动，说明该接缝在目标宿主上不可用，需要换机制） |
| 3 | **模型目录出现在选择器里**：两家按可见性规则应出现的模型都出现且可选 | 假 ctx 里没有模型选择器，也没有宿主目录服务 | 打开模型选择器逐家核对 |
| 4 | **客户端页面被注册几次** | 需要真实浏览器（host-seam-assumptions 假设 ②）：本机没有这条观察通道 | 打开设置观察统一页面（id `llm-account`）是否恰好一个，并配合 1b 留下的调试计数/日志 |
| 5 | **`settings.section` 的 `order` 是否生效** | 同上；`order` 只在页面注册路径上被消费，假 ctx 不触发页面注册（假设 ③ 的前半段） | 观察页面在设置里的实际落位；不一致时改 1b 的薄适配层 |
| 6 | **`settings.describe` / `settings.mutate` 的写路径对真实宿主校验器**：`accountIntents` / `accounts` / `activeAccount` 能否按本包的形状读写 | 假设置服务是内存实现，只当「顶层 path op + 修订号围栏」这一层替身；真实宿主的校验器（schema 校验、`isVolatilePath` 判定、`hidden()` 字段是否可写）本期无法观察 | 在真机上做一次账号增删/切换，确认写进的是命中的行名（opencode 是行 id `opencode-go`）且不被校验器拒绝 |
| 7 | **声明了但未构建的 `./client` 导出 + `dsh.client` 声明是否影响行挂载** | `exports["./client"]` 指向尚不存在的 `lib/client.js`（§1），本期不产出浏览器 bundle；假 ctx 不经过宿主加载器，无法判断宿主是否因这一条拒绝挂载、或是否要求 `dsh.client.platform`（本包现已声明 `"platform": "web"`，与两个旧插件一致）。浏览器目标构建是计划 1b 的交付物 | 真机启动时确认两行都能挂载（若宿主因 `./client` 缺失而拒绝，则必须在 1b 补出浏览器产物，或临时收窄 `exports`/`dsh.client`） |
| 8 | **`apply` 被调用几次** | 假 ctx 是测试直接调用 `apply`，调用次数由测试自己决定，不反映宿主行为（假设 ② 的直接证据只有真机能给） | 读 1b 在 `apply` 里留下的调试计数或日志（计划 1c 必须先定观测手段：DevTools 控制台还是宿主日志） |

补充：§4 的测试里那条「固定命名空间解析到 profile 行 id」用的是**假**设置服务，因此第 6 项里「真实宿主的 `describe()` 是否按行 id 建索引」同样属未验证假设（host-seam-assumptions §2 假设 ③ 与 §4 清单第 6 项）。

## 6. 与其它任务的衔接

- 计划 1b：客户端页面与统一账号中心、浏览器目标构建（`./client`）、账号写入路径接线、`IntentLog.replay` 的恢复接线（改期为显式未做项，见计划文档「1a 结束时明确『改期未做』的项」）。
- 计划 1c：本文件 §5 的 8 项逐一实测，把 host-seam-assumptions 的假设变成结论。
