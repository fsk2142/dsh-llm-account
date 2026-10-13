# Task 13 报告 — opencode 适配器 · 额度与账号端口

分支 `work`，提交 `be40f57`（父提交 `b184243`）。`pnpm typecheck` 干净，`pnpm test` **178 passed**（此前 160）。

## 1. 实现了什么

### `src/vendors/opencode/quota.ts`（287 行）

- `toQuotaSnapshot(payload: unknown): QuotaSnapshot` —— 纯函数，把 `{ usage: { rolling, weekly, monthly } }` 归一化：
  - `key` 用窗口名（`rolling` / `weekly` / `monthly`），输出顺序固定；
  - `percent` 原样保留（端点给的范围外的值视为「未报告」，不夹取）；
  - 端点的 `resetsAt`（ISO 字符串）→ `QuotaWindow.resetAt`（**epoch 毫秒**）；
  - `status === "rate-limited"` → `exceeded: true`，`"ok"` → `exceeded: false`；
  - **缺失的窗口不造出来**；形状不认识或字段非法的窗口丢弃并把窗口名记进 `failures`（不倒成 0，也不让一次形状漂移让整个面板变空）。
- `OpencodeUsageError extends LlmError` —— 见第 2 节。
- `createOpencodeQuota(deps)` —— `GET {base}/usage`，Bearer 鉴权，`AbortSignal.timeout(10s)`，`redirect: "error"`，正文上限 `USAGE_MAX_BYTES = 1 MiB`（先按 `content-length` 拦，再按真实字节数兜底）。没有可用密钥时抛 `retryable: false` 且**一个请求都不发**。
- 导出常量：`USAGE_PATH`、`USAGE_MAX_BYTES`、`DEFAULT_USAGE_TIMEOUT_MS`、`USAGE_UNAVAILABLE_CODE`、`OpencodeQuotaKey`、`OpencodeQuotaDeps`。

### `src/vendors/opencode/accounts.ts`（567 行）

- `createOpencodeAccounts(deps: { settings; credentials; intents }): AccountPort` —— 七条命令**全部**实现：`add`、`remove`、`rename`、`replaceKey`、`select`、`move`、`setAutoSwitch`（`move` 与 `setAutoSwitch` 是可选成员，本厂商能力清单里 `reorder` 为真，所以实现）。
- `MAX_ACCOUNTS = 20`；`OPENCODE_SETTINGS_NS = "llm-opencode-go"`；`OPENCODE_ACCOUNT_REF_PREFIX`、`OPENCODE_DEFAULT_REF = "OPENCODE_API_KEY"`、`opencodeAccountRef(label)`。
- 每条命令：`intents.append` → （设置变更 / 凭据写入）→ `intents.settle`。

## 2. `/usage` 的请求形状与错误语义（我选了什么形状 + 对照的旧插件行号）

### 请求（旧插件 `fetchUsage` 第 7898-7906 行）

| 项 | 取值 | 旧插件行号 |
| --- | --- | --- |
| 端点 | `GET {baseURL}/usage` | 7899、7902 |
| 鉴权 | `Authorization: Bearer <key>` | 7903 |
| 接受类型 | `Accept: application/json` | 7903 |
| 预算 | `AbortSignal.timeout(10_000)` | 7904 |
| 重定向 | `redirect: "error"` | 7905 |
| 正文上限 | `USAGE_MAX_BYTES = 1024 * 1024` | 7822 |
| 附加 | `attributionHeaders()` | 7903 |

### 负载（旧插件 `parseGoUsage` 第 7762-7783 行）

窗口在顶层 `usage` 对象里；每项 `{ status: "ok" | "rate-limited", percent: 0–100, resetsAt: ISO }`。旧插件对三项是**全有**要求（第 7777 行把任何缺失/非法判为整次读取失败）。

**我做的取舍**：把「全有或全无」拆成「坏窗口丢弃 + 记名」。理由是设计 §12 Review Focus 4 的同一纪律 —— 缺失或不可信的字段绝不能倒成 0：如果保留旧插件的全有语义，一条窗口形状漂移就会让三个窗口全部消失；如果反过来把缺失字段补 0，就会把「不知道」画成「用量 0%」。记名进 `failures` 同时给了 UI 一个「这块数据不完整」的信号。

### 错误语义（旧插件第 7864-7934 行）

旧插件抛 `RemoteError("opencode-go/usage-unavailable", msg, { retryable, retainPrevious, source })`。现有端口类型里没有这个形状（`LlmError` 的 `options` 只有 `status` / `providerRetryAfterMs` / `requestId` / `offloadImages`），所以我**没有**改共享内核，而是在本适配器里定义：

```ts
export class OpencodeUsageError extends LlmError {
  readonly retryable: boolean;
  readonly retainPrevious: boolean;
}
```

`code` 固定为 `"opencode-go/usage-unavailable"`（宿主按 `code` 判重试，row 与旧插件一致），HTTP 状态经 `LlmError` 的 `options.status` 落进 `error.failure.status`，两个判定字段是本适配器附加的只读属性。`QuotaPort.snapshot()` 照常 reject。

| 情形 | `retryable` | `retainPrevious` | 旧插件行号 |
| --- | --- | --- | --- |
| 没有可用密钥 / 凭据解析失败且非 MISSING | `false` / `true`（本实现统一 `false`：没有密钥不重试） | `false` | 7864-7881 |
| 传输失败（连接、超时、重定向被拒） | `true` | `true` | 7907-7914 |
| 正文不是 JSON | `true` | `false` | 7908、7912 |
| 正文超字节上限 | `true` | `false` | 7909、7912 |
| HTTP 408 / 429 / 5xx | `true` | `true` | 7918、7920-7921 |
| 其它 HTTP 状态 | `false` | `false` | 7918-7921 |

`source`（旧插件给每次读一个随机标识用于去重并发读取，第 7883-7896 行）**没有**搬：那是它 `readRef` 的并发去重键，属于进程内缓存策略，本项目没有读取去重层，造一个字段只会是死的。

## 3. ref 生成规则与存储位置

### 生成（`opencodeAccountRef(label)`）

形状 `DSH_OPENCODE_GO_ACCOUNT_<标签转义>_<12 位十六进制哈希>`：

- 前缀用**旧插件的槽名前缀** `DSH_OPENCODE_GO_ACCOUNT_`（旧插件第 6781 行 `ACCOUNT_REF_PREFIX`），存量账号零迁移；
- 标签先转大写、非 `[A-Za-z0-9_]` 替换成 `_`；
- 后缀是原始标签的 64 位 FNV-1a 哈希前 12 位，所以「标签不同、转义后同名」（`Team A` 与 `Team-A`）仍然是两个 ref；
- **add 时生成一次**；撞名时加 `_2`…`_128`（与 commandcode 同一上限）；
- **`rename` 绝不重新推导 ref**：只按字段覆盖 `name`，其它字段原样保留。

### 存储位置

- ref 存在账号条目的 **`apiKeyEnv`** 字段（旧插件 Config schema 第 6828 行）：条目形状 `{ id, name, apiKeyEnv }`；`id` 也写成同一个 ref（确定性，重放可对齐）。
- 顶层 `apiKeyEnv` 是**当前账号**（旧插件第 6824 行）；`select(null)` 写回 `OPENCODE_DEFAULT_REF`（旧插件 `accountRefOf` 第 6784-6786 行把空串归一成它）。
- **设置文档里只有凭据引用名，没有任何明文密钥**：`key` 一律走 `credentials.set`，且**先提交账号条目、再写凭据槽**（旧插件 `begin()` → `credentials.set` 的次序，第 8393-8396 行）。测试断言 `JSON.stringify(doc)` 不含密钥字面量。

## 4. 冲突重放怎么工作

`#mutate(build)` 每次循环：

1. `settings.describe(ns)` 拿**最新**文档与修订号；
2. `build(最新文档)` 重算 ops 与返回值；
3. `ops.length === 0` → 直接返回、**不落盘**（这次操作在最新文档上已经成立：`add` 发现冻结的 ref 已存在、`move` 发现位置没变）；
4. 否则 `settings.mutate(ns, ops, 刚读到的 revision)`；
5. 抛 `code === "SETTINGS_CONFLICT"` → 回到第 1 步重读、用**新修订号重放用户的操作**（不是覆盖对方的写入），上限 `MAX_CONFLICT_RETRIES = 8`，耗尽后原样抛出。

意图日志贯穿重放：`#transaction` 只在 `append` 之后才调用 `submit`，`settle` 在全部成功之后，所以重放的每一轮都发生在「意图已落盘、尚未收尾」的窗口里。测试断言冲突后 `mutations.map(m => m.revision) === [3, 7]`、对方写入的账号仍在列表里、`store.writeCount() === 2`（append + settle 各一次）、重放期间意图始终在日志里。

## 5. 测了什么（18 条）

**额度和归一化**（4 条）：三窗口 percent/resetsAt 保留 + `resetAt` 转 epoch 毫秒 + 缺失窗口不造；`rate-limited → exceeded: true`、`ok → exceeded: false`；三窗口齐全的顺序与数值；形状不认识/字段非法（`percent` 150、`resetsAt` 非日期、`status` 未知、`percent` 是字符串）的窗口丢弃并记名，同一份读数里好窗口照常返回。

**额度端口**（2 条）：`GET /usage`、`Bearer`、`Accept: application/json`、`redirect: "error"`、`DEFAULT_USAGE_TIMEOUT_MS === 10_000`、`USAGE_MAX_BYTES === 1 MiB`；无 ref / 空白密钥时抛错且一个请求都不发。错误语义矩阵：429/503 → `retryable+retainPrevious`；404 → 都 false + `failure.status === 404`；传输失败 → `true+true`；非 JSON → `true+false`；超字节上限（按 `content-length` 提前拦）→ `true+false`。

**账号端口**（12 条）：`MAX_ACCOUNTS === 20` 且第 21 个**抛错拒绝**（拒绝发生在写意图之前：0 次落盘、0 次提交）；`append` 先于 `mutate` 且提交成功后 `settle`（`writeCount === 2`）；`add` 返回新 ref、条目落盘、密钥只进凭据服务、view 的 `configured/active` 正确；`add` 的意图在 `append` 之前就带着最终 ref；`rename` 只改 label 且保留条目上的其它字段、不重推 ref；ref 撞名 `_2` 后缀 + 转义同名靠哈希区分；`replaceKey` 只走凭据服务、0 次设置提交；`select` 写顶层 `apiKeyEnv`、`null` 回默认、未知 ref 抛错；`remove` 摘条目 + 记清理 ref + 当前账号回落到剩余第一个 + 删空回默认 + 幂等 + 其它字段原样保留；`move` 用 `reorder` 改顺序并把当前账号跟到队首、位置没变时不落盘；`list` 的 `configured/active`（空值不算已配置）；**冲突重放**（第 5 条必测项）。

## 6. TDD 证据

### RED

```text
$ pnpm vitest run tests/vendors/opencode-quota.test.ts

 ❯ tests/vendors/opencode-quota.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/vendors/opencode-quota.test.ts [ tests/vendors/opencode-quota.test.ts ]
Error: Cannot find module '../../src/vendors/opencode/accounts' imported from C:/Work/dsh-llm-account/tests/vendors/opencode-quota.test.ts
 ❯ tests/vendors/opencode-quota.test.ts:16:1

 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

**为什么是预期的失败原因**：`accounts.ts` / `quota.ts` 都还不存在，所以失败在模块解析（`Cannot find module`），而不是某个断言 —— 这正是简报 Step 2 的「FAIL，模块不存在」。它证明这 18 条测试确实**先**写了下来，而不是事后补的。

（实现过程中还出现过 3 次中间失败，都不是「模块不存在」而是真实的行为差异，我逐个查了原因：`LlmError` 的状态在 `error.failure.status` 而不是顶层 `status`；假 `fetch` 按整个路径名路由，但请求路径是 `/zen/go/v1/usage`；账号数上限最初只在 `#mutate` 里判，导致先落盘了一条意图 —— 后者是**真 bug**：简报要求「超过 `MAX_ACCOUNTS` 必须拒绝而不是静默丢弃」，而校验必须在 `append` 之前才能不在日志里留下永远应用不了的意图，已修成 append 前先判 + 提交时按最新文档再判一次。）

### GREEN

```text
$ pnpm typecheck
$ tsc --noEmit
(无输出 = 干净)

$ pnpm vitest run tests/vendors/opencode-quota.test.ts

 ✓ tests/vendors/opencode-quota.test.ts (18 tests) 14ms

 Test Files  1 passed (1)
      Tests  18 passed (18)

$ pnpm test

 Test Files  13 passed (13)
      Tests  178 passed (178)
```

## 7. 文件改动

| 文件 | 状态 | 行数 |
| --- | --- | --- |
| `src/vendors/opencode/quota.ts` | 新增 | 287 |
| `src/vendors/opencode/accounts.ts` | 新增 | 567 |
| `tests/vendors/opencode-quota.test.ts` | 新增 | 597 |

`git show --name-only` 确认提交**只**动了这三个文件：`src/core/**`、`src/vendors/commandcode/**`、`src/vendors/opencode/{protocol,failures,catalog,adapter}.ts` 一行未改。无 `--amend`。

## 8. 自审发现

### 完整性

- 两个 Produces 函数齐全：`toQuotaSnapshot(payload: unknown): QuotaSnapshot`（简报签名）、`createOpencodeAccounts(deps)`。`MAX_ACCOUNTS = 20` 已导出。七条命令全部实现。five required tests 全部落到文件里（第 1、2、3、4 条名字逐字一致，第 5 条冲突重放的断言 `[3, 7]` 逐字一致）。
- **`IntentLog` 前置条件：#4 确认没有绕开。** 本模块只通过 `deps.intents` 使用注入的实例，从不 `new IntentLog(...)`；`accounts.ts` 里没有 `IntentLog` 的构造调用（只在类型位置出现）。一份存储一个实例的责任完全留给装配层（Task 14）。
- 报告里的 `/usage` 端点与错误语义形状见第 2 节。

### 纪律

- 设置文档里无明文密钥（测试断言）。
- 没有速率限制的猜测：`exceeded` **只**来自端点公布的 `status === "rate-limited"`，任何缺失字段都不倒成 0/`false`；`percent` 超出 0–100 视为未报告而不是夹取。
- 测试里没有伪造的窗口：只有端点公布的窗口才出现在 `windows` 里。

### 我修掉的两处

1. **账号数上限最初没在 `append` 之前判**（见 RED 一节）。已修：`add` 先按当前文档判上限，`#mutate` 内再按最新文档判一次（防并发）。测试断言拒绝时 `writeCount === 0`、`mutations` 为空。
2. **`modelAccountRules` 是 commandcode 的字段，opencode 的旧插件里根本没有它**（`grep modelAccountRules` 在旧包里 0 命中）。我最初照 Brief §3 写了「清理该 ref 的规则」，那是对不存在的字段做死代码，而且会给审阅者一个「opencode 支持按模型绑定账号」的错觉。已删除 `RULES_FIELD` / `RULE_ACCOUNT_FIELD` / `ruleAccountOf` 与相应 ops，并在模块头显式写明「旧插件的设置文档里没有 `modelAccountRules` / 没有 `credentialCleanupRefs`；前者属于 opencode 的 `modelVisibility`（第 6819 行）而不在本任务的 `AccountPort` 契约里」。测试改成断言真实旁边字段原样保留。

### 遗留判断

- `credentialCleanupRefs` **不是**旧插件的字段（旧包 0 命中）：这是本项目为「删除账号后清理凭据」引入的字段（与 commandcode 同名同义），因为删除操作本身不删密钥。这意味着**本适配器的设置文档比旧插件多一个字段**；若旧插件以后要读同一份文档，需要它容忍未知字段（旧插件的 Config 是 schema 校验，未知字段会被拒）。这一点我在模块头写明了，提请 Task 14 / 后续迁移决策注意。
- `move` 会把顶层 `apiKeyEnv` 指向移动后的队首，**包括当前值指向一个不在账号表里的引用名时**。这是照旧实现有意选的：旧插件读当前账号时本来就用 `[preferred, ...accounts]`（第 7512-7515 行），「列表首项 = 当前账号」是它的有效语义，所以显式写出来不改变行为。删掉这个写入会让测试里「排序后当前账号跟到队首」的旧插件后果消失，所以保留。

## 9. Concerns

1. **需要控制器裁决的一处形状上的矛盾**：Brief 的 Interfaces 写「Consumes: Task 4 的 `accountRef`」，但控制器补充 3 又要求 ref 用 `DSH_OPENCODE_GO_ACCOUNT_` 前缀；`accountRef("dsh-opencode-go", label)` 的产物是 `DSH_LLM_ACCOUNT_DASH_OPENCODE_GO_<LABEL>_<HASH>`，与旧插件的存量槽名不统一。我按**补充 3 的前缀**实现（存量零迁移优先，且 Interfaces 只可能指「同构的确定性推导」），哈希/后缀规则沿用 Task 4 的思路。**如果控制器要的是 `accountRef()` 的原样产物，这是一个 3 行的改动**（`opencodeAccountRef` 的 return 换成 `accountRef("dsh-opencode-go", label)`）加一条正则断言 —— 请明确，我好改。
2. **`/usage` 的错误形状是本适配器新增的类型**（`OpencodeUsageError`）。共享内核的 `QuotaPort` 只声明 `snapshot(): Promise<QuotaSnapshot>`，没有错误通道；消费方要用 `retryable` / `retainPrevious` 就必须 `instanceof OpencodeUsageError`（或按 `code` 判后再读字段）。如果 Task 14 / 第 2 期的用量胶囊希望有一条与厂商无关的错误契约，那需要往 `core/adapter.ts` 加类型 —— 本任务不许改 `src/core/**`，所以我没动。
3. **`credentialCleanupRefs` 的兼容性**（见上）：本适配器写入的设置文档比旧插件多一个字段。如果短期内要两个插件共享同一份设置文档，需要在装配层确认旧插件的 schema 能容忍它；否则要换一个旧插件未知但被忽略的位置。
4. **`percent` 的 `exceeded` 语义**：`ok → exceeded: false` 是「端点明确说没超」；`rate-limited → true`。但端点若报告 `percent: 100` 而 `status: "ok"`，我不推断为超出（不猜测）—— 如果 UI 想「100% 也标红」，那是展示层的规则，不该写进归一化。

---

# 修复报告 Round 1

修订提交：`1b2238d` fix(opencode): classify credential and shape failures, settle rejected add intents
（父提交 `ea12154`，即并行任务先落地的 `fix(opencode): 流内失败的定类…`；我的 Round 1 落在它之上。分支 `work`，无 `--amend`。）

只改了这三个文件：`src/vendors/opencode/quota.ts`、`src/vendors/opencode/accounts.ts`、`tests/vendors/opencode-quota.test.ts`。`src/core/**`、`src/vendors/commandcode/**`、其余 opencode 文件一行未动；复审的 Minor 项一律没碰。

## Finding 1 — 未受保护的凭据解析逃逸成未分类错误

**改了什么**（`src/vendors/opencode/quota.ts`）：`snapshot()` 里 `deps.resolveKey(ref)` 现在被 try/catch 包住，三支都变成**已分类**的 `OpencodeUsageError`：

| 分支 | 判定 | `retryable` | `retainPrevious` | cause |
| --- | --- | --- | --- | --- |
| 解析抛错且 `code === "MISSING_CREDENTIAL"` | 这个账号就是没配密钥 | `false` | `false` | 不保留 |
| 解析抛其它错 | 凭据服务/环境读取本身失败，可能瞬时 | `true` | `false` | **保留原始 cause** |
| 解析成功但为空串/纯空白 | 按未配置处理 | `false` | `false` | 不保留 |

三支都**一个请求都不发**。旧插件同一处（第 7864-7873 行）给的正是 `retryable: !missing`、`retainPrevious: false`，所以「非 MISSING 的解析失败」= `retryable: true, retainPrevious: false`；`MISSING_CREDENTIAL` 与「解析成功但为空」保持旧的 `false` 分支（第 7875-7881 行）。`cause` 通过 `LlmError` 的 `ErrorOptions.cause` 保留。

**覆盖测试**：`it("凭据解析抛错也必须是已分类的失败：可重试、不保留，并保留原始 cause（旧插件第 7865-7873 行）")` —— 断言 `instanceof OpencodeUsageError`、`code`、`retryable: true`、`retainPrevious: false`、`cause` 是**同一个** outage 对象实例、`calls` 为空；第二支断言 `MISSING_CREDENTIAL` → `retryable: false`。

## Finding 2 — 认不出来的 200 正文被当成干净的成功空读数

**改了什么**（`src/vendors/opencode/quota.ts`）：`toQuotaSnapshot` 不再把「负载整体认不出来」当成空读数，而是抛 `OpencodeUsageError`（`retryable: true`、`retainPrevious: false`、message `Invalid OpenCode Go usage response`，对应旧插件第 7925-7934 行的 `RemoteError`）。判定用统一的 `usageRecord(payload) === undefined`：**不是对象**、**没有 `usage`**、**`usage` 不是对象**、以及**空数组**都算认不出来。

**我认定「合法但空」的形状只有一种**：`usage` 是对象而三个窗口字段一个都没有 —— 例如 `{ usage: {} }`。那是端点明确报告「当前没有窗口数据」，返回 `{ windows: [], failures: [] }`。判据是「`usage` 这个容器本身在不在、是不是对象」：容器在 → 读数可信（窗口可以缺席）；容器不在/不是对象 → 端点换了形状，不可信。这样 UI 能区分「端点报告没有数据」与「端点漂移了」。

**覆盖测试**：
- `it("负载整体认不出来是一个已分类的失败，而不是干净的空读数（形状漂移不覆盖旧读数）")` —— 对 6 种坏负载（`undefined`/`null`/`{}}`/`{usage:7}`/`{usage:"rolling"}`/`[]`）断言抛 `OpencodeUsageError`；断言 `code`/`retryable: true`/`retainPrevious: false`；断言端口路径（200 + `{usage:7}`）抛同一形状且**不是**空读数、**不是** transport failure；最后断言 `{ usage: {} }` 在纯函数与端口两条路径上都返回诚实的空读数。
- `it("形状不认识或字段非法的窗口被丢弃并记名，而不是倒成 0（整份读数照常返回）")` —— 这条**重写**过：原来把 5 种「整体认不出来」的负载钉成空读数（正是复审指出的问题），现在只保留「窗口级」的坏数据（`percent: 150`、`resetsAt: "not a date"`、`status: "unknown"`、`percent` 是字符串）与 `{ usage: { rolling: undefined } }`（窗口缺席 = 不造窗口、不记名），并保留「好窗口照常返回、坏的只记自己的名」的断言。

## Finding 3 — append 之后的复核会留下一条拖停重放的意图

**改了什么**（`src/vendors/opencode/accounts.ts`）：选了「收尾先于抛出」而不是「删掉复核」（复审给的两条路），因为并发真的可能填满表，删掉复核就等于把上限交给运气。

- 新增 `#settleQuietly(intent)`：把一条已经 append 但决定不提交的意图 `settle` 掉，收尾本身写失败时**不抛出**（不掩盖拒绝原因）。
- `#mutate` 的 `build` 允许是 async 的；`add` 的复核改为 `await this.#settleQuietly(intent); throw tooManyAccounts();`。**先 await 收尾再抛**很重要：第一版写成 `throw this.#rejectAfterAppend(...)`（throw 一个 promise）会让错误路径变成一条悬浮的 promise —— `rejects.toThrow` 拿到空 message，运行时还留下一次 unhandled rejection。现在是先 await 再抛一个普通 `Error`，两条路径（预检 / 复核）的错误形状完全一致。
- `#transaction` 的 `submit` 现在收到 `intent`（`add` 需要它的 id 来收尾），并同步更新了方法文档与 `add` 的文档（不再引用已删除的 `#rejectAfterAppend`）。

**覆盖测试**：
- `it("并发填满账号表时收尾先于抛出：那条 add 意图不会留在日志里拖停整轮回放")` —— 起点 19 个账号（保证**预检通过**，所以拒绝一定来自 append 之后的复核）；受控的 `settings.mutate` 包装先让「并发的另一个写者」提交第 20 个账号，本端口的复核因此撞上满表。断言抛 `/at most 20 accounts/`、账号表保持对方写的 20 个且**没有**本端口条目、`await intents.list()` **为空**（关键）、`store.writeCount() === 2`（append + settle 各一次真实落盘）。
- `it("账号表在 append 之前就已经满：add 直接拒绝，一个字节都不写")` —— 保留并明确成**预检路径**的测试：满表时 `add` 直接拒绝，`writeCount` 为 0、`mutations` 为空、日志空。
- `it("上限 20 个账号")` 相应瘦身成只钉 `MAX_ACCOUNTS === 20`（原来与上面那条重复），避免同一契约在两条测试里各钉一遍。

## 变异证据（每条修复都验证过「改回去就红」）

把三处修复的**实质**各自改回缺陷版，同时跑聚焦文件：**3 个变异 → 恰好 3 条覆盖测试失败**，一一对应。

```text
# 变异 1：去掉 resolveKey 的 guard（变成裸 await，错误逃逸出未分类）
# 变异 2：if (usage === undefined) return { windows: [], failures: [] };  （回到干净空读数）
# 变异 3：if (accounts.length >= MAX_ACCOUNTS) throw tooManyAccounts();     （不先 settle）
$ pnpm vitest run tests/vendors/opencode-quota.test.ts

 ❯ tests/vendors/opencode-quota.test.ts (22 tests | 3 failed) 21ms
   × 负载整体认不出来是一个已分类的失败，而不是干净的空读数（形状漂移不覆盖旧读数） 3ms
   × 凭据解析抛错也必须是已分类的失败：可重试、不保留，并保留原始 cause（旧插件第 7865-7873 行） 1ms
   × 并发填满账号表时收尾先于抛出：那条 add 意图不会留在日志里拖停整轮回放 3ms
 Test Files  1 failed (1)
      Tests  3 failed | 19 passed (22)
[exit code: 1]
```

还原（`git checkout HEAD --` 两个源文件）后同一命令 22/22 通过。

### 诚实披露：还原过程中的一次自伤

做变异证据时我先用 `git checkout -- <file>` 还原，但两个源文件当时还是**未跟踪**的（Round 1 的修改尚未提交），那条命令对未跟踪文件不生效，源文件保持变异状态；我紧接着用 `git checkout HEAD --` 才真正还原 —— 结果是**把 Round 1 的修改一起还原掉了**（文件回到 `be40f57` 的版本）。我确认了这一点（marker 计数全为 0），然后**逐条重新施加了全部三处修复**，并用 `tsc` + 22/22 与 marker 复查（`unknownUsageShape` / `missingKeyError` / `isRecord, trimBase` / `settleQuietly` / `await build(`）确认重新施加的版本与预期一致。提交 `1b2238d` 里的内容就是重新施加后的版本，测试全绿。没有丢失任何复审要求的内容。

## 我实际跑的命令与输出

```text
$ pnpm typecheck
$ tsc --noEmit
(无输出 = 干净)

$ pnpm vitest run tests/vendors/opencode-quota.test.ts

 ✓ tests/vendors/opencode-quota.test.ts (22 tests) 15ms

 Test Files  1 passed (1)
      Tests  22 passed (22)

$ pnpm test

 Test Files  13 passed (13)
      Tests  187 passed (187)
```

仓库全量套件也是绿的（13 个文件 / 187 条），其中包含并行任务已经落地的 `tests/vendors/opencode.test.ts`（13 条，比我 Round 0 时多 5 条）—— 说明并行任务的在途修改此刻没有把套件弄红。