# Task 14 修复报告 Round 1

> 本任务 Round 0（`src/vendors/*/index.ts`、`cordis.patch.yml`、`tests/vendors/assembly.test.ts`、`package.json` 的装配实现）由一位在提交前死掉的实现者写出，控制器复核后**原样提交**为 `8efca3c`，所以没有 Round 0 的实现者报告；本文件从 Round 1 开始。
>
> 独立评审给 Task 14 开了 3 条 Important + 1 条 Minor。本轮修 **2 条 Important + 1 条授权 Minor**；第 3 条 Important（`IntentLog.replay` 未接线）由控制器**改期**到计划 1b/1c，本轮**故意不做**（见文末「本轮没做的事」）。

修订提交：`e1c83bc` `fix(opencode): 认 enabled 开关、补宿主冒烟记录与 client.platform（复审 Round 1）`
（父提交 `8efca3c`；分支 `work`；**没有** `--amend`，是一个全新提交。）

本轮改了 4 个文件，全部是允许改的：

| 文件 | 改动 |
| --- | --- |
| `src/vendors/opencode/index.ts` | Fix 1：认 `enabled` |
| `tests/vendors/assembly.test.ts` | Fix 1 的覆盖测试（+2 条，共 8 条） |
| `docs/superpowers/notes/2026-10-13-host-smoke.md` | Fix 2：新建（Task 14 Step 4 的交付物） |
| `package.json` | Fix 3：`dsh.client.platform = "web"` |

`src/core/**`、`src/vendors/assembly.ts`、以及两个厂商被评审并关闭的模块（`protocol.ts` / `failures.ts` / `catalog.ts` / `adapter.ts` / `quota.ts` / `accounts.ts` / `login.ts`）**一行未动**；`src/vendors/commandcode/index.ts` 也**没有**动（它的 `Config` 里没有 `enabled`，本轮没有改它的理由）。

---

## Fix 1（Important）— opencode 行的 `enabled` 开关被声明但没人认

**复审发现**：`Config` 里 `enabled: z.boolean().default(true)`（旧第 82 行）声明了，但 `apply` 无条件 `ctx.llm.registerAdapter([PROVIDER_ID], adapter)`（旧第 195 行）。用户真实的 profile 行恰好是 `enabled: false`（`C:\Users\me\.dsh\profiles\desktop\cordis.patch.yml` 的 `opencode-go` 行），所以照原样装上去会把 OpenCode Go 的路由与模型**上线**——一个直接违反用户自身配置的可见回归。

**旧插件的语义**（本轮核对过的原文，不是转述）：

- `dsh-opencode-go/lib/index.js` 第 8612-8627 行的 `applyRoute(configured)`：`current().enabled` 为假且已有注册时调用注册句柄 `registration()` 并置空，日志 `disabled by configuration; the route and its models are withdrawn`；为真且尚未注册时才 `ctx.llm.registerAdapter([PROVIDER_ID], adapter)`。
- `dsh-opencode-go/lib/types/index.d.ts` 第 18 行：`enabled: true  # false withdraws the route; the plugin stays mounted`。
- `dsh-opencode-go/lib/index.js` 第 8686 行：`ctx.on("loader/volatile-update", syncRoute)` —— volatile 变更由这个事件通知，宿主**不会**为 volatile 变更重跑 `apply`。

**改了什么**（`src/vendors/opencode/index.ts`）：

1. 注册从「一次调用」改成「按现读的 `enabled` 校准」的 `applyRoute()`：
   - `enabled !== false`（缺省、非布尔值都算启用）且尚无句柄 → `ctx.llm.registerAdapter([PROVIDER_ID], adapter)`；
   - `enabled === false` 且已有句柄 → 调用句柄释放路由、置空句柄，并 `ctx.logger.info("llm-opencode-go: disabled by configuration; the route and its models are withdrawn")`；
   - 其余情况什么都不做 ⇒ 重复触发**幂等**（不会注册两次）。
2. `applyRoute()` 在 `apply` 里**先跑一次**（挂载时就认，用户的 `enabled: false` 从第一刻起就不上线），再 `ctx.on("loader/volatile-update", () => applyRoute())`（后续改写重判）。监听器用与凭据事件同一形状的裸 `ctx.on`：真实 cordis 会把监听器绑到当前 fiber，卸载时自动摘掉。
3. `ctx.effect` 的释放路径改成释放**当前**句柄（`registration?.(); registration = undefined;`），标签不变。
4. `loader/volatile-update` 在本次 typecheck 用的 `@deepseek-ai/cordis` / `@deepseek-ai/dsh-*` 里**没有声明**（本机没有 loader 包，已逐包 grep 确认），所以按两个旧插件的做法在本文件顶部自行补声明 `declare module "@deepseek-ai/cordis" { interface Events { "loader/volatile-update"(paths): void } }`，签名逐字取自 `dsh-opencode-go/lib/types/index.d.ts` 第 37 行。构建后该声明出现在 `lib/opencode.d.ts:21`。
5. 模块头与 `Config.enabled` 的文档块补上了这条语义（含旧插件行号），`OpencodeBundle.adapter` 的注释改成「`enabled: false` 时构造但**不**注册」。

**「行仍然挂载」**这句话本轮的落地方式：`enabled: false` 时适配器、轮换引擎、意图日志、账号端口、额度端口、`credentials/reference-updated` 订阅**全部照旧构造**（旧插件同样如此），被撤下的只有 provider 路由。

**覆盖测试**（`tests/vendors/assembly.test.ts`）：

- `it("opencode 的 enabled 为 false 时不注册路由，为 true 时注册一次")` —— 用**用户现有的配置形状**（`OPENCODE_SHAPE`，`enabled: false`）装配：`registrations` 为空、`liveRoutes()` 为空；同时断言行仍挂载（`bundle.adapter` 存在、`accounts.list` / `quota.snapshot` 是函数、凭据事件与 volatile 事件各订阅一次）。再用 `enabled: true` 断言恰好注册一条 `["dsh-opencode-go"]`。
- `it("opencode 的 enabled 改成 false 会撤下已注册的路由")` —— 已解析配置 + 一个可控的 volatile `enabled`（`Object.freeze({ get })`，即 `isVolatileRef` 认的形状）：起始 true ⇒ 注册一次；广播两次 `loader/volatile-update` ⇒ 仍只有一次注册（幂等）；改成 false 再广播 ⇒ `liveRoutes()` 为空、注册记录仍是 1 条（是**撤下**不是重新注册）、行仍挂载；再改回 true ⇒ 重新注册（注册记录 2 条）。
- 原有的 `it("两个入口各注册一次自己的 provider 路由")` 里 opencode 那一侧改用 `{ ...OPENCODE_SHAPE, enabled: true }`：这条测试断言的是「入口注册自己的路由」，而用户现有形状是禁用态，用启用态断言才不与该开关的语义冲突；`Config 能解析用户现有的 opencode 配置形状` 那条仍然用 `enabled: false` 断言原样保留。
- 假宿主相应升级：`registerAdapter` 的句柄现在会把记录标记成 `active: false`，`FakeHost` 新增 `liveRoutes()`（撤下的注册不计入），这样「撤下」是可观察的而不是只能靠「注册了几次」猜。

## Fix 2（Important）— 任务书要求的冒烟记录缺失

**复审发现**：Task 14 Step 4 的交付物 `docs/superpowers/notes/2026-10-13-host-smoke.md` 既不在 `8efca3c` 里也不在工作树里。

**改了什么**：新建该文件（中文，与 `2026-10-13-host-seam-assumptions.md` 同一格式与语气），内容**全部来自本轮真实重跑的输出**，不引用任何我没执行过的命令：

1. §1 `pnpm build` 的逐字输出与 `lib/` 12 个文件的形状表；说明 `lib/opencode.js` 体积来自被内联的**非宿主**依赖，宿主包不在其中；说明 `lib/client.js` 刻意不存在（1b 补浏览器目标构建）。
2. §2 两个子路径导出的解析结果：`commandcode: ["Config","PROVIDER_ID","apply","inject","name"]`、`opencode: ["Config","PROVIDER_ID","apply","inject","name"]`（包根是 `["PACKAGE_NAME"]`），无 `ERR_MODULE_NOT_FOUND`；并写明这一步只证明 **Node** 能解析，不等于宿主加载器能解析。
3. §3 `lib/**/*.js` 里宿主包是**裸导入**的 grep 证据（`from "@deepseek-ai/dsh-llm"` / `dsh-schemastery` / `dsh-credentials` / `dsh-launch-environment`），以及它与 Ruling 11（devDeps → peerDeps）的因果关系。
4. §4 装配测试逐条「证明什么」的表（8 条），以及全量套件 14 文件 / 195 条。
5. §5 **本期无法验证的清单**（8 项，逐项给出「为什么本期验证不了」与「1c 怎么测」）：真机启动、真实路由注册（含 `enabled` 改写所依赖的 `loader/volatile-update` 接缝在目标宿主上是否真的可用）、模型目录在选择器里出现、客户端页面注册次数、`settings.section` 的 `order` 是否生效、`settings.describe/mutate` 对 `accountIntents` / `accounts` / `activeAccount` 的写路径是否过真实宿主校验器、**声明了但未构建的 `./client` 导出与 `dsh.client.platform` 是否挡住行挂载**、`apply` 被调用几次。

## Fix 3（Minor，控制器授权）— 补 `client.platform`

**改了什么**：`package.json` 的 `dsh.client` 补 `"platform": "web"`（放在 `inject` 前面）。依据：`dsh-opencode-go/package.json` 与 `@mars-sea/dsh-commandcode-provider/package.json` 的 `dsh.client` 都有这一条（本轮读文件核对）。它**不改变**任何运行时代码；`docs/superpowers/notes/2026-10-13-host-smoke.md` §5 第 7 项仍然把「真机是否因此挂载成功」列为未验证。

---

## 变异证据（证明新测试真的盯住了 Fix 1）

把 `applyRoute` 里的现读改成常量（即复审指出的缺陷本身）：

```ts
const enabled = true; // MUTATION: ignore the declared switch
```

聚焦文件：**恰好 2 条新测试失败**，其余 6 条通过。

```text
$ pnpm vitest run tests/vendors/assembly.test.ts --reporter=verbose
 ❯ tests/vendors/assembly.test.ts:271:29    ...  expect(host.liveRoutes()).toEqual([])
 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
[exit code: 1]
```

（失败的两条正是 `opencode 的 enabled 为 false 时不注册路由，为 true 时注册一次` 与 `opencode 的 enabled 改成 false 会撤下已注册的路由`。）随后用**反向编辑**还原那一行（**没有**用 `git checkout`，避免 task-13 那次自伤的同类风险），`git status` 复核工作树与本提交一致。

## 我实际跑的命令与输出

```text
$ pnpm typecheck
$ tsc --noEmit
(无输出 = 干净)

$ pnpm test
 ✓ tests/vendors/assembly.test.ts (8 tests) 10ms
 Test Files  14 passed (14)
      Tests  195 passed (195)
(Round 0 是 193 条，本轮 +2 条)

$ pnpm build
 ℹ entry: src/index.ts, src/vendors/commandcode/index.ts, src/vendors/opencode/index.ts
 ℹ lib\opencode.js                     1.51 MB
 ℹ lib\commandcode.js                136.74 kB │ gzip: 46.37 kB
 ℹ 12 files, total: 1.83 MB
 ✔ Build complete in 1647ms

$ node -e 'import("dsh-llm-account/commandcode").then((m) => console.log(JSON.stringify(Object.keys(m).sort())))'
commandcode: ["Config","PROVIDER_ID","apply","inject","name"]
$ node -e 'import("dsh-llm-account/opencode").then((m) => console.log(JSON.stringify(Object.keys(m).sort())))'
opencode: ["Config","PROVIDER_ID","apply","inject","name"]

$ Get-ChildItem lib -Filter *.js | Select-String -Pattern 'from\s*"@deepseek-ai/[^"]+"' -AllMatches
commandcode.js: from "@deepseek-ai/dsh-llm"
commandcode.js: from "@deepseek-ai/schemastery"
failures-B2mU4SVo.js: from "@deepseek-ai/dsh-credentials"
failures-B2mU4SVo.js: from "@deepseek-ai/dsh-launch-environment"
failures-B2mU4SVo.js: from "@deepseek-ai/dsh-llm"
opencode.js: from "@deepseek-ai/dsh-llm"
opencode.js: from "@deepseek-ai/schemastery"
```

上面的 `pnpm build` / 子路径解析 / 裸导入三条是在**提交后的工作树**上重跑的（提交前也跑过一次，结果一致）。

## 诚实披露

- 提交正文里有多处多余的**反斜杠**（出现在「false 时」「volatile-update」「Step 4 的」「清单）」等换行处）—— 是我在 PowerShell 里拼 `-m` 参数时的引号失误，只是文案瑕疵，提交内容（4 个文件）不受影响。规则禁止 `--amend`，所以我没有改它，在这里留痕。
- `loader/volatile-update` 这一事件名**本轮无法在目标宿主上验证**（本机没有同版本的 `dsh` CLI，安装目录的 asar 也读不出内容）。它的依据是**两个旧插件都监听它**（`dsh-opencode-go/lib/index.js:8686`、`@mars-sea/dsh-commandcode-provider/lib/index.js:10410`），不是我的观察。挂载时的 `enabled` 门（这次回归的实质）不依赖这个接缝，是真机一定能生效的那一半；**改写后的撤下**依赖它，已列入 `2026-10-13-host-smoke.md` §5 第 2 项，1c 必须实测（若宿主不发这个事件，需要换机制，例如在请求路径上复查或监听设置命名空间的变更）。

## 本轮没做的事（按控制器裁决）

- **不改 `IntentLog.replay` 的接线**：`src/` 里没有任何地方调用 `IntentLog.replay`，控制器已把它**改期**到计划 1b/1c（需要新增端口级 `applyIntent`，而本期没有能产生账号变更的活路径 —— 账号 UI 到 1b 才有），并作为**显式未做项**记进计划文档「1a 结束时明确『改期未做』的项」。关于复审「是否可能更小地接线」的问法，我的判断是：**在本轮允许的改动面内做不到**。理由：`replay` 的回调必须能**施加**一条 `AccountIntent`，而唯一的施加口在 `accounts.ts`（两个厂商各自一份，都是被评审并关闭的模块）里，且那两处只把 IntentLog 当**记录**用、没有「按意图改文档」的入口；在 entry 里另写一份意图施加逻辑等于把账号写入规则抄第二遍，与 `assembly.ts` 模块头「宿主接缝的读法只有这一份」是同一条理由下的坏味道，而且没有测试锚点会立刻变成漂移源。所以维持控制器裁决：1b 设计时新增 `applyIntent` + 启动时 `replay`，1c 真机做一次「崩溃后重放」演练。
- 不碰第 2 条 Important 之外的其它评审项；本轮只动上表 4 个文件。

## 遗留 / 关注点

1. **`enabled` 的改写重判依赖 `loader/volatile-update`**（见上「诚实披露」），1c 必测；这是本轮唯一一处「有依据但未验证」的宿主接缝。
2. `Config.enabled` 的**非布尔值**读作启用（`enabled !== false`）：schemastery 会把文档里的值归一化成 boolean，这条兜底只针对程序化构造/手改文档；理由是「宁可注册路由也不能凭空静音一个用户没禁用的行」，与被禁用时「撤下路由」的保守方向相反，属于有意的取舍。
3. 冒烟记录里的 `lib/` 文件名带 content hash（`assembly-wmcGD5PI.d.ts` 等），下次构建可能换名；表里已注明这一点。

---

# 最终修复波（整分支复审：I1 / I2 / I3 + 终止事件护栏）

分支 `work`，起点 `655bad8`（195 条测试全绿、工作树干净）。本轮**只**做复审点名的四项，一个提交，未 `--amend`、未 `checkout`/`stash`。

**提交：`2e71aed`**（`fix: 整分支复审四项（默认槽可见/可固定、opencode 不读内联 key、autoSwitch 门、终止事件护栏）`，11 个文件，596 插入 / 97 删除；工作树里除本报告与别人改的那条计划文档外与提交一致）。

## I1（Important）— `AccountPort.list()` 漏掉默认槽、`active` 判错

**根因**：哨兵 `activeAccount: "default"` 只被入口的 `pinnedRefOf` 认识，端口的 `activeRefOf`（`commandcode/accounts.ts`）只认 `""`/`"auto"`；opencode 端口则完全只列 `accounts[]`。于是「正在服务请求的那个账号」既没有行，也 `select` 不动（`unknown account ref`）；`remove()` 的「是不是当前账号」判定继承同一个盲点。

**改了什么**：
1. **哨兵词汇单源化**：`src/core/accounts.ts` 新增 `readAccountSlot(raw, vocabulary)` + `AccountSlotReading`（`pinned` / `ref` / `auto` / `isDefaultSlot` / `invalid`）与共享的 `CREDENTIAL_REF_PATTERN`。缺失、空串、`auto`、`default`、合法 ref、坏值六种输入只在这一处归一。四个调用点全部改读它：CC 入口 `pinnedRefOf` + `warnAboutActiveAccount`（改看 `slot.invalid`）、CC 端口 `activeRefOf`（`list`/`remove`/`add` 都吃它）、OC 入口 `pinnedRefOf`/`defaultRefOf`/`accountStateOf`、OC 端口 `activeRefOf`。两个厂商各导出一个词汇函数（`commandCodeAccountSlot` / `opencodeAccountSlot`），入口从**端口模块**导入 —— 同一份文档再也不可能在两处读成两种结果。顺带把四个文件里各自一份的 ref 正则收成 `core/accounts.ts` 的 `CREDENTIAL_REF_PATTERN`。
2. **两个 `list()` 都合成默认槽行**（旧插件模型：CC `slots()` 第一项 `id: "default"`，OC `accountsOf` 的 `legacy:<ref>`）：顶层默认 ref 不在 `accounts[]` 里时，把它作为**第一行**列出（与轮换顺序首项同一个 ref），`active` = 该 ref 是不是当前固定账号；真账号条目占用了同一 ref 时**不**合成（不出现同 ref 两行）。CC 行 label 用旧插件的 `Default`，OC 行 label 用该 ref 本身（旧插件的 `name` 是空串，本端口对无名条目的既有兜底就是 ref）。
3. **`select` 接受合成槽的 ref**（「pinnable and selectable」）：CC 选中合成默认槽时写回旧插件的槽 id `"default"`（用户现有文档因此**一字不改**，且以后改顶层 `apiKeyEnv` 时固定跟随默认槽，而不是钉在一个可能已不在顺序里的旧 ref 上）；真实条目照旧写自己的 ref。OC 直接写那个 ref（它的当前账号字段就是 ref，没有槽 id 空间）。认不出的 ref 照旧抛 `unknown account ref`。
4. **`remove` 不把合成槽当可移除账号**：它本来就在 `hasAccount` 之前返回（幂等无操作），现在这条语义被测试钉住；`rename`/`replaceKey` 对它抛 `unknown account ref`。

**覆盖测试**：
- `commandcode-quota.test.ts`：`用户真实形状：默认槽被 activeAccount: default 固定时可见、可固定、不可移除（I1）`（用户真实 CC 形状：`list()` 两行、默认槽 `active: true`、`select("COMMANDCODE_API_KEY")` 写回 `default`、`remove` 零写入/零待清理/凭据不动/改名换钥匙被拒）、`真账号条目占用了顶层默认 ref 时不合成第二行（同 ref 不重复）`；两条既有 list 测试按新形状更新（多出默认槽行 + `describe` 多查一个 ref）。
- `opencode-quota.test.ts`：`用户真实形状（没有 accounts 键）：顶层当前账号仍然列出并标成 active，且可固定、不可移除（I1）`、`当前账号已在账号表里时不合成第二行（真条目仍是可改名的那一行）`；既有 list 测试补注释（该形状不合成）。
- `assembly.test.ts`：`commandcode 的 activeAccount: default 与账号中心读同一份文档：固定到顶层默认账号（I1）`（入口的轮换引擎：`pick` 得到顶层默认 ref，第二个候选才是真账号 → 入口与端口同一判定）；既有「opencode 固定命名空间」用例的 `list()` 期望按合成行更新。

## I2（Important）— opencode 从设置文档读内联 `apiKey`，且未声明为秘密

**改了什么**：把 `apiKey` 从 opencode 的配置面**整个删掉** —— `OpencodeConfig` 不再有该字段，`opencode/index.ts` 的 `adapterConfigOf` 不再映射 `document.apiKey`，适配器 `#resolveKey` 不再有 `literal` 来源（现在只有 `stored → environment`），错误文案不再提 `config.apiKey`。理由记在类型上：opencode 旧插件的 Config（`dsh-opencode-go/lib/index.js` 第 6816-6852 行）**根本没有**「配置写死 key」的字段，本包也没有任何界面会写它；而它是 schema 未声明字段（`role("secret")` 不生效）→ 会被原样带到设置客户端。删掉之后，适配器的凭据来源与它自己的额度路径（`resolveAccountKey`：只有 `stored → environment`）一致。

**覆盖测试**：`assembly.test.ts` 的 `设置文档里的 apiKey 不是凭据来源：opencode 只认 stored → environment（I2）` —— 先断言「未声明的 `apiKey` 会被 schemastery 原样带过」（缺陷能被触发的**前提**），再断言凭据服务为空、启动环境没有该名字时抛 `MISSING_CREDENTIAL` 且**一次 HTTP 都不发**。
（没有任何既有测试喂过字面量 key，所以没有测试需要「改成 stored/env」；`pickApiKey` 的 `literal` 分支仍由 `core/credentials` 的测试覆盖。）

## I3（Important）— `autoSwitch` 只写不读

**改了什么**：`opencode/index.ts` 的 `accountStateOf`：`document.autoSwitch === false` 时 `order` 只有当前/默认 ref，否则维持原来的完整顺序（旧插件第 7515 行 `autoSwitch ? [...new Set([preferred, ...accounts])] : [preferred]`）。`pinned` 与 `install` 语义未动。只有**显式** `false` 收窄：programmatic 构造的文档没有这个字段时保持原行为（生产路径上 `Config` 的默认值是 `false`，与旧插件一致）。

**覆盖测试**：`assembly.test.ts` 的 `autoSwitch: false 时只试当前账号：额度拒绝不会打到第二个账号（I3）`（假网关按 Authorization 记密钥：只有 `key-preferred`，抛 `QUOTA`）与对照用例 `autoSwitch: true 时同一个网关会轮到第二个账号（同一份文档只差这个开关）`（`["key-preferred","key-other"]`）—— 同一份文档只差这一个开关，证明收窄来自该字段本身。

## 护栏（2 行）— 第二个终止事件不再产出第二条 finish

**改了什么**：`commandcode/protocol.ts` 的 `finish()` 与 `messagesStop()` 各补一条 `if (this.#finished) return [];`（`endOfStream` 本来就有）。于是畸形网关连发两个终止事件（两个 `message_stop`、两个 `finish_reason`/`finish`）时，第二条不再交出 finish，也不会重复关闭块/重复 usage。

**覆盖测试**：`commandcode.test.ts` 新增 `畸形网关连发两个 message_stop：只有一条 finish，结束原因不被第二条覆盖`（`max-tokens` 保留、usage 一条、无打开块）与 `畸形网关连发两个 finish_reason：只有一条 finish，先到的结束原因保留`（`tool-calls` 保留）。

## 变异证据（在仓库外的副本上做，五次变异各自只失败对应的新测试）

副本：`robocopy D:\work\llm-acct-repo D:\work\mut /E /XD node_modules .git lib` + `mklink /J` 链接回原 `node_modules`（不改仓库工作树；每次变异后从原树 `Copy-Item` 还原并核对 SHA-256 一致）。副本里 `pnpm test` 会触发 pnpm 的 install 检查（副本里失败），所以统一用 `& .\node_modules\.bin\vitest.cmd run`（等价于 `vitest run`）。

| 变异 | 改动 | 结果 |
| --- | --- | --- |
| M1（I1 哨兵） | `commandCodeAccountSlot` 去掉 `legacyDefault: ACTIVE_ACCOUNT_DEFAULT`（回到「只认 `""`/`auto`」） | `Tests 2 failed \| 203 passed`：`用户真实形状：默认槽被 activeAccount: default 固定时…（I1）`、`commandcode 的 activeAccount: default 与账号中心读同一份文档…（I1）` |
| M2（I1 合成行） | OC `list()` 的 `if (!hasAccount(snapshot.value, slot.ref))` 改成 `if (false)` | `Tests 2 failed \| 203 passed`：`用户真实形状（没有 accounts 键）…（I1）`、`opencode 的固定命名空间在宿主上解析到 profile 行 id` |
| M3（I2） | `adapterConfigOf` 重新映射 `apiKey` + `#resolveKey` 加回 `literal:` | `Tests 1 failed \| 204 passed`：`设置文档里的 apiKey 不是凭据来源…（I2）`（`AssertionError: expected LlmError: …（HTTP 500）… to match object { code: 'MISSING_CREDENTIAL' }` —— 明文 key 真的被用去发请求了） |
| M4（护栏） | `finish()` 与 `messagesStop()` 各删掉 `if (this.#finished) return [];` | `Tests 2 failed \| 203 passed`：两条新的「连发两个终止事件」用例 |
| M5（I3） | `order: document.autoSwitch === false ? [slot.ref] : orderOf(document)` → `order: orderOf(document)` | `Tests 1 failed \| 204 passed`：`autoSwitch: false 时只试当前账号…（I3）` |

每次变异后副本都回到与仓库一致的 205 passed。**副本没删掉**：它里面有一个指回仓库 `node_modules` 的 junction，`dsh-safety` 拦下了「先摘 junction 再删副本」的那条命令（确认删除区），按规则我没有绕（没换工具、没换路径）。副本仍在 `D:\work\mut`（含 junction）；处置它需要用户显式批准（先摘 junction，再用 `safe_delete`），交给控制器/用户决定。它对仓库无影响（`node_modules` 只是链接，仓库工作树不受影响）。

## 我实际跑的命令与输出

```text
$ pnpm typecheck
$ tsc --noEmit
(无输出 = 干净)

$ pnpm test
 ✓ tests/vendors/commandcode-quota.test.ts (32 tests)
 ✓ tests/vendors/commandcode.test.ts (29 tests)
 ✓ tests/vendors/opencode-quota.test.ts (24 tests)
 ✓ tests/vendors/assembly.test.ts (12 tests)
 ✓ tests/vendors/opencode.test.ts (13 tests)
 Test Files  14 passed (14)
      Tests  205 passed (205)
(起点 195 条 → 本轮 +10 条，另改 4 条既有断言)

$ pnpm build
 ℹ lib\opencode.js                     1.51 MB
 ℹ lib\commandcode.js                140.82 kB │ gzip: 47.75 kB
 ℹ 12 files, total: 1.84 MB
 ✔ Build complete in 1635ms
（lib/ 是 gitignore，未提交）
```

## 诚实披露

- **三条既有测试的断言按新形状改了**（不是新增）：CC 的两条 `list` 用例（多出一行合成默认槽 + 多查一个 ref 的 `describe`）与 assembly 的「opencode 固定命名空间」用例。它们原先钉的正是被判定为缺陷的旧形状，改的是期望值而不是被测行为。
- **写回值取舍**：CC 的合成默认槽被选中时写的是旧插件的槽 id `default`（而不是把顶层 ref 写死成字面量）。两种写法读回来等价（槽判定把 `default` 解析成顶层 ref），选 sentinel 的理由是「用户现有文档一字不改」+「改顶层 `apiKeyEnv` 时固定跟随默认槽」。`select` 意图里记的仍是调用方给的那个 ref（账号身份），不是哨兵。
- **I3 只认显式 `false`**（`document.autoSwitch === false`），照 brief 原文；程序化构造、没有这个字段的文档维持旧的完整顺序，生产路径上 `Config` 会把它归一化成 `false`，与旧插件一致。
- **本次修复只动上表 11 个文件（7 个 src + 4 个测试）**。`docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md` 在本轮进行中被**别人**改了两条（新增「两行都要 `ctx.settings.configure({ auto: false })`」与两条清理建议，见 `git diff`）—— 那不是本轮的改动，我**没有** `git add` 它，提交里只有我这 11 个文件；这条未提交的改动仍留在工作树里，交给控制器处置。
- 未碰 `IntentLog.replay` 接线（控制器改期 1b/1c），也未修账本里其它 deferred minors。
