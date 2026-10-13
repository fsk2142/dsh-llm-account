# Task 11 报告 — commandcode 适配器 · 网页登录

- 分支：`work`（未 amend，未 stash/revert 任何他人工作）
- 提交：`27fc044 feat(commandcode): loopback browser login`（新增两个文件，1290 行）
- 验证：`pnpm typecheck` 干净退出；`pnpm test` → **11 个文件 / 151 个用例全绿，wall ≈ 1.1s，进程正常退出**（无卡住）
- 交付：`src/vendors/commandcode/login.ts`（新建，唯一实现文件）+ `tests/vendors/commandcode-login.test.ts`（既有未跟踪文件，已随本次提交入库）

---

## 1. 既有测试要求了什么，我改了哪些

### 1.1 判定：既有测试与 brief 一致，予以保留

`tests/vendors/commandcode-login.test.ts`（上一轮尝试写下、未提交，543 行）覆盖了 brief 的 4 个计划用例
（state 不匹配不落库 / 取消后回调不落库 / 5959+10 端口默认值 / 超时 → timeout）**以及**控制器补充 3 的
全部健壮性条目（405/204/404/400、体积超限、malformed JSON、取消后服务器关闭且端口释放、成功路径
「先 whoami 后 storeKey」的顺序断言、401 → `invalid-key` 且不写入），外加控制器未点名但合理的四条：
`begin()` 单飞、绑定期间 cancel 后可重新开始、10 个端口全占时的可读错误、Studio 基地址推导与授权 URL 编码。

我逐条比对 brief、Global Constraints、计划 Task 11 全文与旧插件合同，**没有发现与 brief 相矛盾的断言**
（详见 1.4 的三处「与旧插件不同但正确」的差异），因此**全部保留**，默认实现去满足它们。仅做了下面两处修改：

### 1.2 改动一（修缺陷）：第 294 行不能通过类型检查

`tests/vendors/commandcode-login.test.ts:294` 原文：

```ts
expect((await get.json()).error).toBe("Method not allowed. Use POST.");
```

`Response.json()` 在 `@types/node` 的 undici 形状里返回 `Promise<unknown>`，所以这是全仓库**唯一**一个
`tsc` 错误：

```
tests/vendors/commandcode-login.test.ts(294,10): error TS2571: Object is of type 'unknown'.
```

（GREEN 之前 `pnpm typecheck` 因此是红的 —— brief 第 7 条要求提交前跑通它，所以这不是可选项。）

改法（唯一一处对既有断言的改动，且是**加强**而非放宽，与同一用例里其它断言的风格一致）：

```ts
// `Response.json()` 的静态类型是 `unknown`（@types/node 的 undici 形状），所以整身体比较，
// 顺带和同一用例里其它几条断言一样钉住完整响应。
expect(await get.json()).toEqual({ success: false, error: "Method not allowed. Use POST." });
```

### 1.3 改动二（补一个用例）：`cancel()` 的窗口

自审时我改了 `cancel()` 的一处语义（见第 6 节），按 TDD 铁律为新行为补了第 17 个用例：

> `it("验证中再次 begin 后立即 cancel：新启动也必须退场（cancel 不让任何尝试存活）")`

它先让一次 `whoami` 悬停（监听已收、状态仍 `waiting`），再 `begin()` 一次并立刻 `cancel()`，断言
两次调用都落到 `failed/cancelled` 且迟到的验证成功不落库。**先验证过它在没有修复时是红的**：

```
FAIL tests/vendors/commandcode-login.test.ts > 验证中再次 begin 后立即 cancel：新启动也必须退场
AssertionError: expected { state: 'waiting', …(1) } to deeply equal { Object (state, reason) }
  +   "authUrl": "https://commandcode.ai/studio/auth/cli?callback=http%3A%2F%2Flocalhost%3A5959%2Fcallback&state=…",
  +   "state": "waiting",
```

### 1.4 与旧插件不同、但我判定为「正确且必须保留」的三处

| 差异 | 旧插件 | 本任务测试与实现 | 理由 |
| --- | --- | --- | --- |
| 状态面不携带 `message` | 失败态带 `message`（第 8636、8838、8860 行） | 只有 `state`/`reason`/`authUrl` | Task 2 的 `LoginStatus`（`src/core/adapter.ts:162-168`）只有这三个字段；`toEqual` 会因为多余的 `message` 失败。稳定文案键就是 `reason`。 |
| 常量名 `LOGIN_PORT_ATTEMPTS` | `LOGIN_MAX_PORT_ATTEMPTS`（第 8439 行） | 测试 import 的是 `LOGIN_PORT_ATTEMPTS` | brief 只规定了 `startPortDefault`/`portAttemptsDefault` 与 deps 的 `portAttempts`，没有规定导出常量名；测试是唯一消费者，取与 deps 同名的那个。 |
| 多导出两个纯函数与五个常量 | 仅内部函数（`buildCommandAuthUrl`、`studioBaseForApiBase`） | `buildCommandCodeAuthUrl`、`studioBaseForApiBase`、`LOGIN_*` 均导出 | 测试直接断言它们（brief 控制器补充 1 要求对齐旧的 URL/端口/体积/白名单契约）；这两组是纯函数与常量，无副作用、无宿主依赖。 |

`storeKey` 的 ref 由 `userName` 推导（`accountRef("commandcode", userName)`）也是测试钉死的；它与
Global Constraints 的「账号标识一律用 ref 标识空间」一致，但有一个残余风险，见第 8 节。

---

## 2. 与旧插件逐条对齐的行号

参照文件：`C:\Users\me\.dsh\profiles\desktop\node_modules\@mars-sea\dsh-commandcode-provider\lib\index.js`（只读）

| 契约 | 旧插件行号 | 本实现 |
| --- | --- | --- |
| 总期限 120 000 ms | 8435 `LOGIN_TIMEOUT_MS = 12e4` | `LOGIN_TIMEOUT_MS` |
| 起始端口 5959 | 8437 `LOGIN_START_PORT` | `LOGIN_START_PORT` |
| 最多 10 个端口 | 8439 `LOGIN_MAX_PORT_ATTEMPTS` | `LOGIN_PORT_ATTEMPTS` |
| 请求体上限 10 000 字节 | 8441 `LOGIN_BODY_LIMIT_BYTES = 1e4` | `LOGIN_BODY_LIMIT_BYTES` |
| 允许来源三项（顺序一致） | 8443-8447 `LOGIN_ALLOWED_ORIGINS` | `LOGIN_ALLOWED_ORIGINS` |
| Studio 授权路由 `/studio/auth/cli` | 8449 `STUDIO_AUTH_PATH` | `STUDIO_AUTH_PATH` |
| 授权 URL 形状 + `encodeURIComponent` 两处编码 + 回调用 `localhost` 字面量 | 8457-8460 | `buildCommandCodeAuthUrl` |
| Studio 基地址三档推导（staging / localhost / 正式，正则一致） | 8462-8466 | `studioBaseForApiBase` |
| `whoami` 判决：401 → invalid_key、其它非 OK → server_error、传输失败 → network_error；`Authorization: Bearer`；`accept-encoding: identity`；体放掉 | 8472-8499（`IDENTITY_ENCODING_HEADER` 见 2915） | `validateApiKey` |
| 端口探测（探针绑上再放开） | 8501-8508 `checkPortAvailable` | `checkPortAvailable` |
| 负载字段判定（`apiKey` 非空，其余为字符串） | 8510-8514 `isCallbackCredentials` | `parseCredentials` |
| 端口逐个探测 + 失败文案逐字一致 | 8688-8696 `findPort` | `#findPort`（报错串与测试期望完全一致） |
| 只绑 `127.0.0.1`；绑定前错误 reject、绑定后错误结算为带标签失败 | 8702-8726 `bindServer` | `#bindServer` |
| 判定顺序 OPTIONS → 路径 → 方法 → 体积/JSON → 字段 → state；响应头四件套；`Connection: close`；CORS 只回显白名单 | 8728-8806 `handleCallback`、8922-8925 `corsOrigin` | `#handleCallback`、`corsOrigin` |
| 「应答 → 停监听 → 结算」的次序 | 8808-8816 `settleAttempt` | `#settleAttempt` |
| 代际守卫：每个 await 之后复检所有权；401/网络/其它 → invalid-key/network/error；`storeKey` 抛错 → unavailable；成功才推 `success` | 8828-8871 `complete`、8873-8875 `ownsAttempt`、8877-8886 `failFrom` | `#complete`、`#ownsAttempt`、`#failFrom` |
| 收下回调后只收监听、**保留总期限**约束后续验证 | 8894-8898 `closeCallback` | `#closeCallback` |
| 三项加固的自述（白名单才回显 / `Connection: close` / 拒绝分支先查 state 再结算） | 8421-8424 | 模块头注释 + `handleCallback` |

**实现侧新增（旧插件没有、本任务要求）**：`cancel()` 返回前**等服务器真正关闭**（`close()` 的回调，
旧插件是 sync fire-and-forget，见 8908-8912）；取消/超时时用 `closeAllConnections()` 强关、收下回调时
只做优雅关闭；`request.resume()` 排空提前应答分支的请求体；`#settleTerminal` 强制「先同步改状态、再
await 关服务器」的次序（见第 6 节）。

---

## 3. 我实际强制的 HTTP 契约

服务器只 `listen(port, "127.0.0.1")`（无 `0.0.0.0`、无 IPv6 通配）。每个响应都带
`Connection: close`、`Access-Control-Allow-Origin`（仅白名单回显，否则空）、`Access-Control-Allow-Methods: POST, OPTIONS`、`Access-Control-Allow-Headers: Content-Type`、`Content-Type: application/json`。

| 请求 | 响应 |
| --- | --- |
| `OPTIONS` 任意路径 | `204`，无正文 |
| 非 `/callback` 路径（任意方法） | `404 {"success":false,"error":"Not found"}` |
| `/callback` 非 POST | `405 {"success":false,"error":"Method not allowed. Use POST."}` |
| `POST /callback` 体 > 10 000 字节 | **断连，不给响应**（`request.destroy()`），不落库、不作废尝试 |
| `POST /callback` 非法 JSON | `400 {"success":false,"error":"Invalid JSON"}` |
| `POST /callback` 字段不全（`apiKey` 空/缺，或 state/userId/userName/keyName 非字符串） | `400 {"success":false,"error":"Missing required fields"}` |
| `POST /callback` 带 `error` 字段（Studio 拒绝回执）且 state 不符 | `403 {"success":false,"error":"Invalid state token"}` |
| 合法负载但 state 不符 | `403 {"success":false,"error":"Invalid state token"}`，**状态仍是 `waiting`**（用户可以继续在浏览器里完成授权） |
| 合法负载且 state 相符 | `200 {"success":true}`，随即收监听（优雅关闭），然后 `GET {apiBase}/alpha/whoami` 验证 |

`whoami` 请求（`https://api.example/alpha/whoami`）：`GET`，头 `Content-Type: application/json`、
`accept-encoding: identity`、`Authorization: Bearer <key>`，可带尝试的中止信号；体被放掉。判决 →
状态面：`401` → `{state:"failed",reason:"invalid-key"}`；其它非 OK → `reason:"error"`；throw → `"network"`。
验证通过才调用 `storeKey(accountRef("commandcode", userName), apiKey)`，写成功 → `{state:"success"}`，
抛出 → `reason:"unavailable"`。四条终态（成功/失败/超时/取消）之后 `status()` 一律是
`{state, reason?}`（无 `message`）。

`cancel()`：等待中 → `{state:"failed",reason:"cancelled"}`；**终态不受影响**；返回时端口已释放。
超时（默认 120 000 ms，`timeoutMs` 可覆盖）→ `{state:"failed",reason:"timeout"}`。
端口全占 → `begin()` 抛 `No available port found after 10 attempts starting from port <start>`，状态仍 `idle`。

---

## 4. 套接字测试的确定性与句柄卫生

既有测试文件已经用了正确的确定性手法（我在 17 个用例上原样沿用并复验）：

1. **端口不猜**：一律从 `begin()` 返回的授权 URL 的 `callback` 参数里读回来（`authParts`），
   只有端口耗尽用例才显式给 `startPort`（先向内核要一段空闲端口 `occupyRange`）。
2. **不靠时间碰运气**：需要「迟到结果」的用例用文件内自己的 deferred `fetch` + 有界轮询
   `waitFor`（500 × 2 ms，失败时报出等的是什么），先确认前置条件（`whoami` 已发出）再放行。
   唯一的 `sleep` 只出现在「前置条件已成立」之后作有限让步。
3. **每条用例都有兜底**：`createLogin()` 通过 `onTestFinished` 注册 `cancel()`；而 `cancel()`
   **会等 `server.close()` 的回调**，所以断言失败也不会留下监听或定时器。
4. **端口释放是断言**：`listenOn(port)` 在同一端口重新绑上（3 处），或在取消后向该端口投递必然
   被拒的连接（`rejects.toThrow()`）。
5. **实现侧的四条保证**：终态/取消统一走 `#settleTerminal` → `#clearTimer()` + `abort()` +
   `#closeServer(true)`（强关连接并 await 真正关闭）；收下回调的 `#closeCallback()` 只做优雅关闭
   （监听端口同步释放，正在写出的 JSON 不会被截断）；超时定时器 `unref()`；`Connection: close`
   不留 keep-alive 连接。
6. **我额外实测了这条测试所依赖的 Windows 前提**（之前无人跑过这个文件，不能凭直觉）：
   - 占用端口上再绑 → `EADDRINUSE`（所以 `checkPortAvailable` 的探针与端口耗尽用例成立）；
   - `close()` 之后立刻重绑同一端口 → OK（即使刚刚有过一个 keep-alive 客户端）→ 3 处端口释放断言成立。
7. **实测**：登录文件连跑 5 轮、每轮 16/16（加新用例后连跑 4 轮、每轮 17/17）全绿；全套
   `pnpm test` wall ≈ 1.1s 且正常退出 —— 「进程能退出」本身就是句柄卫生的验尸报告。

---

## 5. TDD 证据

**RED（既有测试 vs 尚无实现）** —— `pnpm exec vitest run tests/vendors/commandcode-login.test.ts`：

```
 ❯ tests/vendors/commandcode-login.test.ts (0 test)
 FAIL  tests/vendors/commandcode-login.test.ts [ tests/vendors/commandcode-login.test.ts ]
Error: Cannot find module '../../src/vendors/commandcode/login' imported from
       C:/Work/dsh-llm-account/tests/vendors/commandcode-login.test.ts
 ❯ tests/vendors/commandcode-login.test.ts:22:1
 Test Files  1 failed (1)     Tests  no tests
```

**第二段 RED（`cancel()` 窗口加固）**：见 1.3 的失败输出（新启动在 cancel 之后仍发布了 `waiting`）。

**GREEN** —— 同一命令：

```
 ✓ 16 passed (16)          # 实现落地后
 ✓ 17 passed (17)          # 加固 + 补测试后（连跑 4 轮稳定）
```

**全量**：

```
pnpm typecheck  → exit 0（无输出）
pnpm test       → Test Files 11 passed (11) │ Tests 151 passed (151) │ exit 0 │ wall ≈ 1.1s
```

顺带一个前提校正：任务说明里的「132 tests green」，在**不含**登录测试文件时实测是 **134**
（`tests/smoke.test.ts + tests/core/* + commandcode.test.ts + commandcode-quota.test.ts` = 10 文件 / 134 用例）。
加 17 个登录用例 = 151。差异不影响结论，仅作记录。

---

## 6. 自审发现（含一处我自己引入并修掉的 bug）

1. **`cancel()` 的窗口（真 bug，已修 + 已补测试）**：上一次尝试还在 `whoami`（状态 `waiting`、监听
   已收）时用户又 `begin()` 一次 —— 那次启动的 `attemptSeq` 还没落地（`#startAttempt` 的第一个
   `await` 之前）—— 此时 `cancel()` 只走「状态分支」就会漏掉新启动，于是取消之后**又冒出一个
   `waiting` 的监听与授权 URL**。改为「先标记在途启动、再终结状态面」，两件事都做。旧插件同位置也有
   这个洞（第 8649-8660 行，它的 `cancel()` 同样是 while-away-validating 时漏掉新启动），本实现
   严格更强：`cancel()` 之后不可能有尝试存活（新用例把它钉住）。`begin()` 每次都会清掉
   `#cancelPending`，所以不会误伤后来的尝试。
2. **终结次序**：`#settleTerminal` 必须**先同步改状态**（所有权判据是「代际相等 + 状态仍是
   `waiting`」）**再** `await` 关服务器。若反过来，等待关闭的窗口里一次迟到的 `whoami` 成功会认为
   自己仍拥有尝试，把用户已取消的密钥写进凭据服务。测试第 438 行那条只覆盖了「取消发生在
   `whoami` 未返回时」，覆盖不到这个次序；我把次序写进注释并定为不可协商。
3. **`storeKey` 之前不留 await**：最后一次所有权复检与 `storeKey(...)` 的**调用**之间没有 await
   （`#complete` 里紧邻两行），所以「没交出去的写绝不交出去」是结构性的，而不是靠运气。已交出去的
   写收不回来（本模块不提供旧插件 `cancelAndDrain` 那样的补偿；新 API 没有这个缝，见第 8 节）。
4. **提前应答分支的请求体**（加固）：`OPTIONS`/404/405 三条分支在应答前 `request.resume()` 排空
   请求体。带 `Connection: close` 关掉一个还有未读数据的连接，对端可能读成连接重置而拿不到刚写出的
   状态码；小体积请求几乎碰不上，但没必要赌。
5. **没有多余 API**：不实现 `onChange`/`dispose`/`cancelAndDrain`（Produces 签名里没有，Task 14
   只把端口挂到插件实例上）；`authUrl` 是 getter；`begin()`/`status()` 返回**副本**，调用方改不动
   内部状态。
6. **合规**：未修改 `src/core/**` 与任何已关闭的 commandcode 文件（`protocol.ts`、`failures.ts`、
   `catalog.ts`、`adapter.ts`、`quota.ts`、`accounts.ts` 一行未动）；新文件不含 `any`、不 import
   宿主 `ctx`、不读写设置文档、不启浏览器、不联网（唯一网络出口是注入的 `fetchImpl`）；`git status`
   干净，提交为新提交（非 `--amend`）。

---

## 7. 变更文件

| 文件 | 变更 |
| --- | --- |
| `src/vendors/commandcode/login.ts` | 新建（711 行）：常量、`buildCommandCodeAuthUrl`、`studioBaseForApiBase`、`createCommandCodeLogin` 与状态机 |
| `tests/vendors/commandcode-login.test.ts` | 既有未跟踪文件入库（579 行）；改 1 行（类型缺陷）+ 新增 1 个用例（cancel 窗口） |

提交：`27fc044 feat(commandcode): loopback browser login`（2 files changed, 1290 insertions(+)）

---

## 8. 结论与遗留关注点

**DONE** —— 既有测试的判定是「与 brief 一致，予以保留」，只修了一处不能编译的断言并补了一个
新行为的用例；实现逐条对齐旧插件合同；`pnpm typecheck && pnpm test` 全绿且不卡住；两个文件已提交。

关注点（都超出本任务范围，留给 Task 12/14 或计划 1b 的裁决）：

1. **ref 由 `userName` 推导可能撞上存量账号**：`accountRef("commandcode", userName)` 是确定性哈希，
   若用户的账号表里已有同名条目，`storeKey` 会**写进那个已有账号的凭据槽**（Task 10 的 `add` 用
   `freeRef()` 做 `_2`/`_3` 去重，本模块没有这个集合可查，也没有设置端口）。测试把这条钉死了，
   我按测试实现并在注释里记明；装配层若要更严，应在 `storeKey` 里做分配/拒写，而不是改本模块。
2. **验证期间再次 `begin()` 会顶掉在途验证**（旧插件同）：状态仍 `waiting` 但监听已收，此时
   `begin()` 会开新尝试并使旧验证失去所有权（旧尝试的成功不落库）。语义上等同「重新开始」，
   本任务未改，值得在 1b 的 UI 层确认按钮语义。
3. **不提供 `onChange`/补偿**：Produces 签名没有它们，`LoginPort.cancel()` 只承诺「不落库 +
   关服务器」；若 1b 需要订阅状态或「取消但已交出的写要等它结束」，需要另开接口。
4. **未验证的部分**：不联网、不启浏览器，所以真实的 Studio 页面投递、真实 `/alpha/whoami`
   以及真机装配（Task 14）都不在本次证据里；旧插件的 `message` 文案与拒绝回执的
   `denied`/`error` 分支只有单元级覆盖（测试没有覆盖拒绝回执这条分支）。
5. **套接字用例的固有风险已被实测压掉**，但它们仍是真套接字：占用 59xx 端口段的第三方进程、
   或限制回环连接的安全软件会改变结果。重复 9 轮（16×5 + 17×4）无抖动。

---

# 修复报告 Round 1

> 本文件上半部分描述 `27fc044`（原始实现）。本节是 Review Round 1 的修复：**Important** 发现
> 「结算挂钩与服务器句柄是实例级的，不是代际级的」。修复提交 `f85a298`，登录用例 17 → 18 个。
> 受影响的结论以本节为准（提交号、用例数、变异证据）。

## R1.1 缺陷与修法

**发现（Important）**：请求处理器（`#bindServer` 建服务器时）只把 `expectedState` 字符串闭包进去；
`#settleAttempt` 读的是实例上的 `this.#settle`，`#closeCallback()` 关的是实例上的「当前」`#server`。
而服务器对象在 `#closeCallback()` 优雅停下之后**仍会服务已经建立的连接**，所以一条旧请求可能在
重新 `begin()` 之后才把请求体送完。后果：(a) 它用**新尝试**的挂钩结算 → 旧凭据被写进新尝试；
(b) `#closeCallback()` 关掉**新尝试正在用的**监听器、并清掉它的挂钩 → 浏览器真实投递被拒，
登录一直挂到 120 000 ms 总期限。旧插件同形（第 8728-8816 行），保真不是理由。

**修法**（`src/vendors/commandcode/login.ts`）：

1. `#bindServer(port, attempt, expectedState)` 把**接受这条请求的 `server` 与 `attempt`** 一起闭包进
   处理器（与已有的服务器错误分支 `if (this.#server !== server)` 同一个惯用法）：
   `#handleCallback(request, response, attempt, expectedState, server)`。
2. `AttemptSettle` 增加 `readonly attempt`，`#settle` 记成 `{ attempt, resolve, reject }`，让挂钩
   自己带代际。
3. `#settleAttempt(server, attempt, json, code, body, failure?, credentials?)` 在**结算与关监听之前**
   要求三者对齐：`this.#server === server` && `this.#ownsAttempt(attempt)` && `settle.attempt === attempt`；
   任一不符即按既有的拒绝形状回 `403 {"success":false,"error":"Invalid state token"}` 并 return
   （不引入新文案键，拒绝词汇表保持与旧插件一致：Invalid JSON 400 / Missing required fields 400 /
   Invalid state token 403 / Method not allowed 405 / Not found 404）。裁决对**两条**决定性路径都生效
   （拒绝回执与凭据）。
4. `#closeCallback(server)` 只关**这条请求自己的**那个服务器：`if (this.#server !== server) return;`，
   不再存在「关掉任意当前服务器」的入口。

有意引入的副作用：同一次尝试里**第二份**决定性投递现在也回 403 并被忽略（此前它会写 200 但什么都不做）。
这比「200 + 静默丢弃」更诚实，也顺带关掉了同一尝试内的重复结算；拒绝词汇表没有新增键。

## R1.2 覆盖测试

**测试名**：`旧服务器上已被接受的投递在重新 begin 之后到达：不落库、不打断新尝试`
（`tests/vendors/commandcode-login.test.ts`，新增辅助 `openSplitCallback`）。

**交错是怎么构造的**（不靠睡眠对齐，全部由前置条件或测试主动放行决定）：

1. `begin()` → 第一次尝试，记下它的端口与 state；
2. 用 `openSplitCallback(port, payload)` 在该端口上开一条 **「请求头 + 半个请求体」** 的投递
   （按**字节**切分，`Content-Length` 是完整体长）：服务器会解析出请求并挂上 `data`/`end` 监听，
   但 `end` 只在测试调用 `finish()` 时才到 —— **结算时机完全由测试决定**；
3. 让第一次尝试收下一条完整、正确 state 的投递：它 200、监听优雅关闭（`closeCallback`，**不**断连），
   所以第 2 步那条已建立的连接继续活着；它的 `whoami` 用 deferred fetch 停在路上（状态仍是 `waiting`，
   监听已经不是它了 —— 这正是可以再 `begin()` 的前提）；
4. `begin()` 第二次 → 新 state、新服务器成为「当前」；
5. `finish()` 补完旧连接上的请求体：它以**旧服务器**的 `expectedState` 通过字段与 state 校验，
   但 `this.#server !== server` 且代际不匹配 → 必须被拒绝。

**断言（对应各条后果）**：
① 迟到投递得到 `403 Invalid state token`（而不是 200）；
② `stored` 一个字节都没落库；
③ 新尝试状态仍是 `{state:"waiting", authUrl:<第二次 begin 的 URL>}`（挂钩没被偷走）；
④ 新尝试自己的合法投递照常 `200 {success:true}` → 最终 `success`、`stored == ["k-2"]`
   （监听没被关掉，登录没有挂到总期限）；
⑤ `whoami` 的 Authorization 序列恰好是 `["Bearer k-first", "Bearer k-2"]` —— `k-stale` 从未走到验证；
⑥ 之后放行第一次尝试那条停在路上的 `whoami`，它成功返回也不落库（代际守卫的第二道）。

**这条测试证明了什么 / 没证明什么**：
- 证明：一条**已被旧服务器接受**、在被替换之后才送完请求体的请求，不能结算新尝试、不能关新尝试的
  监听、不能偷它的挂钩；`whoami` 与 `storeKey` 都不会被它触发；取消/替换之后的迟到结果依旧不落库。
- 没证明：它走的是 `http` 客户端层面的「半个体」交错，不是 TCP 层的**流水线**（pipelined）或重复投递。
  「`end` 之前处理器是否已解析出请求」这一内部时序不影响结果（两种顺序都走到同一个裁决），
  所以**不能**据它断言「解析一定发生在替换之前」。TCP 半开/超时页、经代理的连接不在覆盖范围内。

## R1.3 变异证据（两次，命令与输出）

命令（两次相同，只改被测实现）：

```
pnpm exec vitest run tests/vendors/commandcode-login.test.ts -t "旧服务器上已被接受的投递"
```

**变异 1 —— 去掉整个裁决，回到「读实例上的当前值」的旧形状**（结算与关监听都不做身份检查）：

```
 FAIL  tests/vendors/commandcode-login.test.ts > 旧服务器上已被接受的投递在重新 begin 之后到达：不落库、不打断新尝试
AssertionError: expected 200 to be 403 // Object.is equality
- Expected
+ Received
- 403
+ 200
 ❯ tests/vendors/commandcode-login.test.ts:582:32
    582|   expect(staleResponse.status).toBe(403);
 Test Files  1 failed (1)      Tests  1 failed | 17 skipped (18)
```

**变异 2 —— 「半修」：裁决只用在响应码上，结算与关监听照旧**（更接近真实误修）：

```
 FAIL  tests/vendors/commandcode-login.test.ts > 旧服务器上已被接受的投递在重新 begin 之后到达：不落库、不打断新尝试
AssertionError: expected [ 'k-stale' ] to deeply equal []
- Expected
+ Received
- []
+ [ "k-stale" ]
 ❯ tests/vendors/commandcode-login.test.ts:584:18
    584|   expect(stored).toEqual([]); // 迟到的凭据一个字节都没落库
 Test Files  1 failed (1)      Tests  1 failed | 17 skipped (18)
```

两次变异都**先跑红、再恢复实现**（提交前已 grep 确认 `src/vendors/commandcode/login.ts` 里没有
`MUTATION` 残留）。变异 1 证明测试能识别「迟到投递被当成本次尝试来结算」；变异 2 证明 ②③④ 这几条
断言不是装饰 —— 只把状态码改对，`k-stale` 照样落库。

## R1.4 修复后的验证

```
pnpm exec vitest run tests/vendors/commandcode-login.test.ts   → 18 passed (18)，连跑 4 轮全绿
```

**共享工作区里出现的不属于本任务的失败**（另一个任务正在同一棵工作树上写 Task 12/13 的 opencode
文件；我上一次提交 `27fc044` 当时是全绿 151/151）：

- `pnpm typecheck` → 失败项全部落在另一个任务的**在途**文件里，且两次运行之间错误清单还在变
  （先见 `tests/vendors/opencode.test.ts` 模块找不到，后变成 `src/vendors/opencode/{adapter,protocol}.ts`
  的 `TS6192/TS2367/TS2304/TS2552/TS2322/TS2339` 与 `tests/vendors/opencode.test.ts(200)` 的
  `Cannot find name 'errorResponse'`）。**我的文件零错误**（`tsc` 输出里没有任何 `commandcode` 匹配）。
- `pnpm test` → `Test Files 1 failed | 11 passed (12)`、`Tests 1 failed | 158 passed (159)`；
  唯一失败是 `tests/vendors/opencode.test.ts > 未输出时 quota 拒绝切到下一个账号；已输出时报错不切
  （Review Focus 2 端到端）`（同文件第 205 行，与上面缺 `errorResponse` 同源）。
  我的登录文件 18/18 通过，其余 10 个既有文件（134 用例）全绿，进程正常退出（wall ≈ 2.8s）。
- 提交只 stage 了我的两个文件：另一个任务的 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、
  `src/vendors/opencode/`、`tests/vendors/opencode.test.ts` 我一行没动、也没提交。未使用 `--amend`，
  未 stash/revert 任何人的工作。

## R1.5 修复提交

`f85a298 fix(commandcode): 投递的代际裁决（旧服务器上迟到的回调不得结算新尝试）`
（2 files changed, 195 insertions(+), 13 deletions(-)）

范围：只碰 `src/vendors/commandcode/login.ts` 与 `tests/vendors/commandcode-login.test.ts`。
Reviewer 的 Minor 项未动（按要求不由本任务处理）。
