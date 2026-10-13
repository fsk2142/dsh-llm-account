# Task 10 Report — commandcode 适配器 · 额度与账号端口

- 分支：`work`（提交前 HEAD `5860601`，树干净）
- 提交：`d7dce69` — `feat(commandcode): quota normalization and account port (add credential describe)`
- 改动面：4 文件 / +1364 行（`src/core/adapter.ts` **只有** +7 行的 `CredentialPort.describe`；其余为两个新模块与新测试文件）
- 验证：`pnpm typecheck` 干净；`pnpm test` **129/129**（原 104 + 新 25）

---

## 1. 实现了什么

### `src/vendors/commandcode/quota.ts`（341 行）

- **`toQuotaSnapshot(parts: { whoami?; usage?; credits?; subscriptions?; failures }): QuotaSnapshot`**
  —— 纯函数，产出 `windows` / `plan` / `failures`，不做 I/O、不缓存。
- **`createCommandCodeQuota(deps): QuotaPort`** —— 计划 Interfaces 只列了纯函数，但 Step 3 明确要求
  「`whoami` 拿 `orgId` 后并行拉三个端点，各自 try/catch 记名到 `failures`」，所以取数逻辑有归属：
  `snapshot()` = 解析当前账号 ref 的密钥 → `whoami` → 并行 `usage/summary` + `billing/credits` +
  `billing/subscriptions`（带 `orgId`）→ 交给 `toQuotaSnapshot`。（Task 13 是同构形状：纯归一化 +
  取数端口，其 brief 第 2 条同样要求把端点错误语义「做进你返回的错误里」。）
- 依赖注入：`ref()`、`resolveKey(ref)`、`fetchImpl`、`apiBase?`、`timeoutMs?` —— 不依赖 `ctx`，
  与 `CommandCodeAdapterDeps` 的注入风格一致。
- 无可用密钥：抛 `LlmError(code = "MISSING_CREDENTIAL")`，**一个端点都不请求**（旧插件
  `getUsage` 第 7213-7221 行同一语义）。
- 未做（本任务范围外）：缓存（旧插件的 `billingAccess` 5 分钟 TTL 是给套餐过滤用的）、套餐过滤、
  费用估算。

### `src/vendors/commandcode/accounts.ts`（418 行）

- **`createCommandCodeAccounts(deps: { settings; credentials; intents }): AccountPort`**。
- 实现：`list` / `add` / `rename` / `replaceKey` / `remove` / `select`；**刻意不实现 `move`**
  （Command Code 不支持排序，设计 §7.3 `reorder: false`，能力声明由 Task 14 关掉），
  `setAutoSwitch` 同样不实现（见 §7 决策 3）。
- 每个操作都是「`intents.append` → 提交（设置变更 / 凭据写入）→ `intents.settle`」，
  没有任何路径把次序倒过来；`add` 带 key 时是 append → settings.mutate → credentials.set → settle。
- 导出 `COMMAND_CODE_SETTINGS_NS = "llm-commandcode"` 与 `ACTIVE_ACCOUNT_AUTO = "auto"`，供 Task 14 装配复用。

### `src/core/adapter.ts`（唯一授权改动）

只在 `CredentialPort` 内新增一个成员（+7 行，`git diff` 已确认文件里没有别的任何改动）：

```ts
describe(refs: string[]): Promise<Record<string, { configured: boolean; writable?: boolean }>>;
```

### 测试 `tests/vendors/commandcode-quota.test.ts`（598 行 / 25 条）

brief 要求的 5 条**原文照抄**（用例名与断言逐字一致，仅在第 2 条上多加了一条 `resetAt` 断言），
另加 1 条 `CredentialPort.describe` 契约测试与 19 条补充测试（见 §5）。

---

## 2. 对照的旧插件行号（`@mars-sea/dsh-commandcode-provider/lib/index.js`）

| 事项 | 行号 | 我实现的位置 |
| --- | --- | --- |
| `GET /alpha/whoami`（`getUsage`） | **7246** | `WHOAMI_PATH` |
| `GET /alpha/usage/summary`（`getUsage`） | **7249** | `USAGE_SUMMARY_PATH` |
| `GET /alpha/billing/credits`（`getUsage`） | **7250** | `BILLING_CREDITS_PATH` |
| `GET /alpha/billing/subscriptions`（`getUsage`） | **7251** | `BILLING_SUBSCRIPTIONS_PATH` |
| `?orgId=${encodeURIComponent(orgId)}` 的拼法 | **7251** | `subscriptionsPath` |
| whoami 先拿 `org.id`，其余三个并行 | 7246-7252 | `snapshot()` |
| 请求头 `accountHeaders` | **6994-7005** | `accountHeaders` |
| ↳ `Authorization: Bearer` + `assertUsableApiKey` | 6999 | `Authorization`（空密钥在更早一步就抛 MISSING_CREDENTIAL） |
| ↳ `IDENTITY_ENCODING_HEADER`（`accept-encoding: identity`） | 7000（定义 **2915**） | 复用 `protocol.ts` 的 `IDENTITY_ENCODING_HEADER` |
| ↳ `x-command-code-version` | 7001（常量 **5360** = `1.79.2`） | 复用 `protocol.ts` 的 `COMMAND_CODE_CLI_VERSION` |
| ↳ `x-cli-environment: production` | 7002 | 同名头 |
| ↳ `attributionHeaders()` | 7003 | 同名调用 |
| 每个端点的预算用**聊天请求**那一档（不是目录的 10s 探测预算） | **7204-7207**、调用点 **7226** | `timeoutMs` 缺省 `DEFAULT_REQUEST_TIMEOUT_MS` |
| `fetchJson`：非 2xx / 非对象正文都算失败 | **7016-7038**（7021 / 7026-7037） | `getJson` 的三条失败分支 |
| 每端点独立失败 → `failures` 记名 | **7222-7244**（`failures.push(...)` 7228/7240） | `failed` 集合 → 固定顺序的短名 |
| 窗口形状 `{ used, cap, exceeded, resetAt }` | `parseWindowLimit` **6384-6393** | `windowOf` |
| `windowLimits.fiveHour` / `windowLimits.weekly`（两个都要读） | `parseCreditLimits` 6401-6403、`probeWindowLimits` **7305-7312**（只读 fiveHour 会误判可用的 issue #51） | `WINDOW_KEYS` = `["fiveHour","weekly"]` |
| `credits.credits.{monthlyCredits,planId}` | 6400/6406/7111/7258 | `creditsRecord` |
| usage 的 `totalCredits` | `parseUsageTotals` **6372** | `monthlyCreditsWindowOf` 的 `used` |
| `planId`：subscriptions 优先，退回 credits | **7259**（active 状态那条规则在 7113-7117，只服务套餐过滤） | `planIdOf` |
| ISO 字符串或毫秒 → 毫秒 | `periodEndValue` **5514-5522** | `epochMillis` |
| 四个端点全失败才归类（本任务不做 blocked 归类） | 6436-6442 | 不实现（`QuotaSnapshot` 无 blocked 字段） |
| 账号条目形状 `{ label, apiKeyEnv, apiKey? }` | Config schema **10059-10064** | `LABEL_FIELD` / `REF_FIELD` |
| `activeAccount` / `credentialCleanupRefs` / `modelAccountRules` 字段名 | **10065 / 10066 / 10077-10080** | 同名常量 |
| `remove` 的四步（条目 / 规则 / 固定标记 / 待清理 ref） | `cleanup` **9221-9234**（9225 / 9226 / 9227 / 9228） | `remove` 的 ops |
| 只记录待清理、确认后再 `unset` | **9236-9242**、清理 ref 回写 **9243-9246** | 本任务只记录（见 §7 决策 4） |
| `change()`：一次读 + 一次带修订号的 mutate，ops 是 `{op:"set", path:[key], value}` | **9262-9275** | `#mutate` 的 ops 形状 |
| `name()`：只改 label（trim 后写），绝不重推身份 | **9035-9068**（9046-9049） | `rename` |
| `run()`：ref 占用集合（顶层 base + accounts + credentialCleanupRefs + 报名任务）与 128 次后缀尝试 | **9099-9118** | `freeRef`（不含报名任务，见 §7 决策 6） |
| `store()`：先 `credentials.set` 再确认 | **9205-9215** | `add` 的 `credentials.set` + 事后 `describe` |
| 自动轮换常量 `ACTIVE_ACCOUNT_AUTO = "auto"`、TUI 写入它 | **9523**、**9720-9736** | `ACTIVE_ACCOUNT_AUTO` |
| 空串也读作自动轮换 | `preferredId` **10153-10156** | `activeRefOf` |

---

## 3. `QuotaWindow` 的 key 命名与单位

`key` 必须自带单位含义（控制器补充第 2 条），因为 `used`/`cap` 在不同 key 下单位不同：

| key | `used` / `cap` 单位 | 来源 |
| --- | --- | --- |
| `fiveHour` | **token 数**（端点的用量窗口） | `billing/credits` 的 `windowLimits.fiveHour` |
| `weekly` | **token 数** | `billing/credits` 的 `windowLimits.weekly` |
| `monthlyCredits` | **额度（credits）**：`used` = 本期已消耗额度，`cap` = 月度额度上限 | `usage/summary.totalCredits` + `billing/credits.credits.monthlyCredits` |

顺序固定为 `fiveHour` → `weekly` → `monthlyCredits`（并发完成次序不影响读数）。

其它字段契约（写在 `quota.ts` 的类型注释里，因为 `QuotaWindow` 在封闭的 `adapter.ts` 里、
本任务只允许给它加 `describe`）：

- `percent` 若填，**0–100**；端点给的范围外取值视为未报告（不夹取、不倒算）。
- `resetAt` 一律 **epoch 毫秒**：数字原样（旧插件 `parseWindowLimit` 第 6391 行就是这么用的），
  ISO 字符串用 `Date.parse` 转换，解析不了或缺失保持 `undefined`（不补 0、不补当前时间）。
- `used` / `cap` / `exceeded` **缺失即未知**，绝不倒成 0 / false。
- 阶段 1 不把 `subscriptions.data.currentPeriodEnd` 当 `monthlyCredits` 的 `resetAt`（那是额外
  推导，留给第 2 期）。

---

## 4. 冲突重放怎么工作（Review Focus 5）

```
add/rename/remove/select:
  intents.append(意图)                     ← 一次，先落盘
  #mutate(build):
    loop:
      snapshot = settings.describe(ns)     ← 每轮重读，拿最新 revision 与最新文档
      { ops, result } = build(snapshot.value)   ← 用**最新文档**重算 ops
      try:
        committed = settings.mutate(ns, ops, snapshot.revision)
        return { result, value: committed.value }
      catch e:
        if e.code !== "SETTINGS_CONFLICT" or attempt >= 8: throw e
        # 下一轮重读 → 重放本次操作（不覆盖对方写入）
  （需要凭据时）credentials.set(...)         ← add / replaceKey
  intents.settle(意图 id)                    ← 全部成功后才收尾
```

要点：

- **重放的是「用户的操作」而不是过期的 ops**：`build` 每轮都拿刚读到的文档重算数组，所以对方的
  新增条目不会被我们的旧快照覆盖。
- 意图**只追加一次**、**只收尾一次**；冲突重试不重新 append（测试断言落盘次数恰为 2）。
- 凭据写入失败时不 `settle`，未决意图留给崩溃恢复重放（Task 14 的 `replay.apply`）。
- 冲突轮数上限 8，耗尽后把最后一次 `SETTINGS_CONFLICT` 抛给调用方（不给无限循环）。
- 测试用例：假设置端口第 1 次 `mutate` 模拟「另一个写者加了账号 `c` 并把修订号从 3 推到 7」，
  断言 `mutations.map(m => m.revision) === [3, 7]`，最终账号顺序是 `["a","c",<新账号>]`。

---

## 5. 测了什么（25 条）

**brief 要求的 5 条（原文照抄）**

1. 窗口缺失时保持 `undefined`，不倒成 0（Review Focus 4）——`credits: { monthlyCredits: 100 }` → `windows: []`。
2. 五小时/每周窗口映射为 `used/cap/exceeded/resetAt`（含 ISO → epoch ms：`1_791_921_600_000`）。
3. 单个端点失败不拖垮整体，失败项进入 `failures`。
4. 账号操作先写意图再提交，提交成功后意图被清除（Review Focus 5）——在 `mutate` 发起的那一刻读取
   意图日志快照，断言里面**已经有**这条意图；结束断言日志为空且落盘恰 2 次（append + settle）。
5. `remove` 清掉该账号的模型规则并清理凭据——`accounts` 只剩 A、`modelAccountRules` 为空、
   `credentialCleanupRefs` 含 `b`、`activeAccount` 回到 `auto`、**没有**调用 `credentials.unset`。

**补充的 20 条**

- 额度归一化：字段逐个独立（`{used:7}` → `{key,used}`，`{cap:100}` → `{key,cap}`）；坏 `resetAt`
  保持 `undefined`；`percent` 越界视为未报告、50 透传；`monthlyCredits` 窗口的两端依赖（只有上限
  或只有消耗都不建窗口）；`plan` 的三段回退。
- 额度端口：四个端点的路径与顺序、`?orgId=org_1`、四个请求头（Bearer / identity /
  `1.79.2` / production）；whoami 失败只记名且订阅退回无 query；两个端点各自失败（503 + 非 JSON）
  → `failures` 固定顺序 `["usage","credits"]`；传输抛错只记名；空密钥 / 无 ref → `MISSING_CREDENTIAL`
  且**零请求**。
- 凭据契约：`describe` 对空值 / 纯空白 / 缺失一律 `configured: false`，且每个被查询的 ref 都出现在结果里。
- 账号端口：`list` 的 `configured` / `active` 与 describe 的衔接、服务漏报时的容错、重复 ref 只留第一个；
  `add` 建 ref 且明文字符串不出现在设置文档里、密钥进凭据服务；同名标签得到 `_2` 后缀（Review Focus 1）；
  `rename` 只改 label 且保留条目其它字段；`replaceKey` 不碰设置文档；`select("a")` / `select(null)`;
  `move` 不存在；冲突重放。

---

## 6. TDD 证据

**RED**（`pnpm vitest run tests/vendors/commandcode-quota.test.ts`，实现前）：

```
 ❯ tests/vendors/commandcode-quota.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/vendors/commandcode-quota.test.ts [ tests/vendors/commandcode-quota.test.ts ]
Error: Cannot find module '../../src/vendors/commandcode/accounts' imported from C:/Work/dsh-llm-account/tests/vendors/commandcode-quota.test.ts
 ❯ tests/vendors/commandcode-quota.test.ts:20:1

 Test Files  1 failed (1)
      Tests  no tests
```

为什么符合预期：`src/vendors/commandcode/{quota,accounts}.ts` 还不存在，测试文件第 20 行起从
`accounts` 取值导入 → vitest 连套件都加载不了（0 test）。这正是 brief Step 2 的
「FAIL，模块不存在」。

**GREEN**（实现后同一命令 / 再跑全量）：

```
 ✓ tests/vendors/commandcode-quota.test.ts (25 tests) 24ms
 Test Files  1 passed (1)
      Tests  25 passed (25)

pnpm typecheck  → $ tsc --noEmit（无输出）
pnpm test       → Test Files  10 passed (10)
                  Tests  129 passed (129)
```

实现过程中用例先红后绿的两次「实现侧」修正也记在这里（都不是实现缺陷，是我自己的测试笔误）：

1. `resetAt` 常量写错：`1_792_000_800_000` → `1_791_921_600_000`（`node -e "Date.parse('2026-10-13T20:00:00Z')"`
   = `1791921600000` 独立复算）。
2. 测试辅助 `quotaPort(routes, undefined)` 触发了默认参数（`undefined` 走 `"acc-a"` 默认值），
   改成 `null` 哨兵后才真正走到「没有 ref」的分支。
3. 「传输抛错」用例原断言 3 个窗口，实际 2 个：usage 失败会连带没有 `monthlyCredits` 窗口
   （它的 `used` 来自 usage）—— 断言改成 2 并在注释里写明依赖关系。

---

## 7. 自审发现与决策（含需要控制器裁决的项）

**先做了三处代码修正/收尾（在提交前）**

- `ruleAccountOf` 一开始误读 `item["accounts"]`（规则里应该是 `item["account"]`）；在跑测试前就改掉，
  否则 `remove` 会保留该规则、第 5 条用例会红（该用例正是这条护栏）。
- 补齐 `quota.ts` 的类型注释（`percent` 0–100 / `resetAt` epoch ms / 缺失即未知），因为 `adapter.ts`
  只允许加 `describe`，契约只能写在适配器文件里。
- 请求头与端点常量复用 `protocol.ts`（`IDENTITY_ENCODING_HEADER` / `COMMAND_CODE_CLI_VERSION` /
  `DEFAULT_API_BASE` / `DEFAULT_REQUEST_TIMEOUT_MS`），不另抄一份字面量。

**决策（按重要性排序，前两条请控制器确认）**

1. **账号条目的 ref 字段沿用 `apiKeyEnv`**。brief 只说「用 ref 标识空间」，没有点名字段名；
   旧插件 Config schema（第 10059-10064 行）就是用 `apiKeyEnv` 存凭据引用名，而设置命名空间
   固定为 `llm-commandcode`、目标是**账号零迁移**（设计 §2、§5.1），Task 14 brief 第 44 行的
   零迁移用例也是 `accounts: [{ label, apiKeyEnv }]`。所以 ref 的值存在 `apiKeyEnv` 里，`label`
   只做展示。若 Task 14/13 决定用 `ref` 字段，我这边只需改 `REF_FIELD` 一处（读路径已集中）。
2. **`activeAccount` 的自动轮换值用 `"auto"`**（旧插件导出的 `ACTIVE_ACCOUNT_AUTO`，第 9523 行；
   TUI 的下拉框写的就是它，第 9720-9736 行）。`remove` 掉当前固定账号时写 `"auto"` 而不是旧插件
   第 9227 行的空串：两者语义等价（读取方 `preferredId` 第 10153-10156 行把空串也读作自动）。
   **Task 14 把 `activeAccount` 映射成 `AccountState.pinned` 时必须把 `"auto"` 与空串都当成
   `null`**，我已把常量导出为 `ACTIVE_ACCOUNT_AUTO` 供它引用。
3. **`setAutoSwitch` 不实现**（brief 的操作清单里没有它；旧插件 commandcode 的文档里也没有
   `autoSwitch` 字段——那是 opencode 的；§7.3 的 `automaticSwitch: true` 描述的是轮换引擎行为）。
   `move` 按 brief 不实现；`reorder: false` 的能力声明属于 Task 14 的装配（现在 `src/` 里还没有
   能力对象）。
4. **`remove` 只记录待清理 ref，不在本操作里 `credentials.unset`**（控制器补充第 5 条允许）。
   依据：brief 的第 5 条用例要求 `remove` 之后 `credentialCleanupRefs` 里能看到该 ref；旧插件也是
   「先记名 → 复查引用 → 再 unset → 最后把 ref 从清理列表移除」（第 9236-9246 行）。真正删除与
   确认的排空动作留给后续任务（或 1b 的页面动作）。
5. **`monthlyCredits` 窗口需要两端都给数才生成**：控制器补充第 2 条点名 `monthlyCredits` 是一个
   自带单位（额度）的 key，而 brief 第 1 条用例又钉住「只有 `credits.monthlyCredits` 时 `windows`
   必须为空」。两者只有在「usage 的 `totalCredits`（used）与 credits 的 `monthlyCredits`（cap）
   同时给出才建窗口」这条规则下才同时成立，已按此实现并写了正反两组断言。若控制器本意是
   「阶段 1 根本不产出 `monthlyCredits` 窗口」，删掉 `monthlyCreditsWindowOf` 一处即可（其余用例不受影响）。
6. **`add` 的意图不带 `ref`**（`recovery.ts` 明确写了「`add` 时尚不存在，可缺省」）：空闲 ref 依赖
   最新文档（占用集合），只能在冲突重放循环里算。因此**崩溃发生在「设置已提交、凭据未写」之间时，
   留下的是没有 ref 的 `add` 意图**；Task 14 的 `replay.apply` 需要按 label 重新推导 ref
   （`accountRef(vendor,label)` + 占用扫描，确定性）或按 label 找回条目，再补写凭据。已在此点名。
7. **存量条目里的其它字段原样保留**：改数组时只摘除目标条目，改条目时按字段覆盖。旧插件的条目
   允许内联明文 `apiKey`（第 10062-10063 行），本模块**从不写入**这种字段（新条目只有
   `{label, apiKeyEnv}`，测试断言明文密钥不出现在文档里），但**也不主动删**存量里已有的——删掉会让
   那个账号静默失去密钥。把字面量迁进凭据服务是迁移决策，需要控制器给方向。
8. `freeRef` 的占用集合 = 现有条目 ∪ `credentialCleanupRefs` ∪ 顶层 `apiKeyEnv`（旧插件第 9099-9105 行
   的同一集合，**不含**旧插件的 `accountEnrollmentTasks`——新包的开通流程是 Task 11，本任务的文档契约里
   没有该字段；若 Task 11 复用它，需要把它的 ref 加进占用集合）。撞名后缀 `_2`…`_128`，
   这条护栏是 Review Focus 1（两个账号不共用凭据槽）的机器化保证。
9. 校验类行为：`add`/`rename` 拒绝空白标签，`add`/`replaceKey` 拒绝空白密钥，`rename`/`replaceKey`/
   `select(ref)` 对未知 ref 抛错（先读一次确认，避免留下一条永远重放不了的意图）；`remove` 对未知 ref
   **幂等无操作**（重放已提交的移除不会产生多余写入）。这些 brief 都没写，是我加的最小护栏，均已注释。
10. `whoami` 的负载不贡献任何输出字段（`QuotaSnapshot` 没有账号字段，`plan` 来自 subscriptions/credits），
    它只提供订阅端点的 `orgId`；`whoami` 失败时 `plan` 可能缺失但窗口照常返回——符合控制器补充第 2 条。
11. `percent` 越界（>100）按「未报告」处理而不是夹到 100：夹取会伪造一个端点没给的读数。
12. `list()` 用 `dedupeByRef`（Task 4）去重，重复 ref 只保留第一条（Review Focus 1）；条目缺 label 时
    回退显示 ref。本任务没有写 `order` 字段：账号顺序就是 `accounts[]` 的数组顺序（旧插件 `slots()`
    第 10140-10152 行同样按下标读），而 commandcode 的排序能力是关闭的。

**输出卫生**：无调试输出、无临时文件、无未提交改动；`git status` 干净；未 `--amend`；
计划/规格/其它封闭文件（`src/core/**` 除那一处 `describe`、`src/vendors/commandcode/{protocol,failures,catalog,adapter}.ts`）
一个字节都没动。

---

## 8. Concerns（交接给控制器 / Task 13 / Task 14）

1. **`apiKeyEnv` vs `ref` 字段名**（决策 1）与 **`"auto"` 哨兵**（决策 2）是跨任务接口，请裁决并同步给
   Task 13/14；两者的读路径都集中在一处常量，若要改名成本是一行。
2. **`add` 意图没有 ref**（决策 6）：Task 14 的重放 `apply` 必须自己对上号，否则崩溃在设置提交与凭据
   写入之间时，那条账号会一直没有密钥（可人工 `replaceKey` 恢复，但不是自动的）。
3. **存量明文 `apiKey`**（决策 7）：不写、不删。若团队要求收敛到凭据服务，需要一个明确的迁移步骤
   （我建议放在 Task 14 或计划 1b，不要在账号操作里顺手删）。
4. **`monthlyCredits` 窗口的前提**（决策 5）：若控制器只想要两个 token 窗口，请明确；当前实现是
   「两端都给数才建」。
5. 本任务**未**覆盖的相邻语义（都不在 brief 范围内，列出以便分诊）：额度读数的缓存与 `blocked` 归类
   （旧插件 6436-6442）、`credentialCleanupRefs` 的真正排空（`describe` + `unset` + 移出列表）、
   套餐过滤与费用估算（第 2 期）。

---

# 修复报告 Round 1（独立评审的 2 条 Important）

- 分支：`work`（改动前 HEAD `d7dce69`，树干净）
- 提交：`4fe97dd` — `fix(commandcode): 月度窗口只报消耗（不拿余额当 cap），add 意图在 append 前固定 ref`
- 改动面：3 文件 / +141 −37（`src/vendors/commandcode/quota.ts`、`src/vendors/commandcode/accounts.ts`、
  `tests/vendors/commandcode-quota.test.ts`）。`src/core/**` 与其它厂商文件**一个字节都没动**；
  评审的 Minor 项未触碰（不在本轮范围）。
- 测试：25 → 28 条（本文件），全仓 **132/132**。

## Finding 1 — 月度窗口的 `cap` 是伪造读数

**改成什么（`quota.ts`）**

- `monthlyCreditsWindowOf(credits, usage)` → `monthlyCreditsWindowOf(usage)`：只在 usage 公布了
  `totalCredits` 时产出 `{ key: "monthlyCredits", used }`，**没有 `cap`、没有 `percent`**。
  窗口的产出**不再依赖** `credits.credits.monthlyCredits`（那个字段是月度**余额**，旧插件第 7738 行
  把它与其它额度池加成 `balanceTotal`）。
- JSDoc 改写成控制器的裁决理由：月度**配给总数**来自第 2 期才搬的静态套餐表（旧插件 941-995），
  阶段 1 没有可信上限来源，所以**只报消耗、不算 `used/cap` 比例**（把余额当上限会在快用完的账号上
  得到符号相反、可到百分之几百的伪造读数）；模块头（第 12-15 行）、key 词表（`monthlyCredits` 一行）
  与 `CommandCodeQuotaParts` 的说明同步改写。`fiveHour` / `weekly` 两条窗口路径一字未动。
- 顺带保留的旧行为：usage 没给 `totalCredits` 时不造窗口（缺失不倒成 0）。

**覆盖测试（`tests/vendors/commandcode-quota.test.ts`）**

- `月度窗口只报消耗（monthlyCredits 是余额）：没有 cap、没有 percent，不造比例（Review Focus 4）`
  （原「月度额度窗口用 monthlyCredits 键…且只在两端都给数时出现」按新形状重写）：断言
  `windows === [{ key: "monthlyCredits", used: 12 }]`，并单独断言 `cap` 与 `percent` 都是 `undefined`；
  再断言「只给 usage（不给 credits）」同样产出该窗口、「只给 credits 余额」不产出窗口。
- `额度端口按旧插件的端点与请求头取数…`：全量快照的第三条窗口改为 `{ key: "monthlyCredits", used: 12 }`
  （原来钉着 `cap: 100`）。
- `传输抛错也只记名…` 的注释顺带改为「月度消耗窗口的 used 来自 usage」（行为不变）。
- 五小时 / 每周窗口的 5 条断言（`used/cap/exceeded/resetAt`、字段逐个独立、ISO→epoch、percent 越界）
  原样未动。

**变异证据（把 `monthlyCreditsWindowOf` 临时改回「cap = credits.monthlyCredits，两端都要有」）**

```
$ pnpm vitest run tests/vendors/commandcode-quota.test.ts -t "月度窗口只报消耗"
 FAIL  tests/vendors/commandcode-quota.test.ts > 月度窗口只报消耗（monthlyCredits 是余额）…
 AssertionError: expected [ { key: 'monthlyCredits', …(2) } ] to deeply equal [ { key: 'monthlyCredits', used: 12 } ]
 - Expected
 + Received
   [ { + "cap": 100, "key": "monthlyCredits", "used": 12 } ]
 ❯ tests/vendors/commandcode-quota.test.ts:291:24
 Tests  1 failed | 27 skipped (28)
[exit code: 1]
```

（变异体从备份恢复后重跑全量：132/132 绿；恢复的正确性用 `Select-String monthlyCreditsWindowOf`
确认为 `(usage: unknown)` + 调用点 `(parts.usage)`。）

## Finding 2 — `add` 意图没有身份，崩溃重放不确定

**改成什么（`accounts.ts`，`add`）**

```
-  const committed = await this.#transaction("add", { label }, async () => {
-    const result = await this.#mutate((value) => { const ref = freeRef(value, label); … });
+  const snapshot = await this.#deps.settings.describe(NS);
+  const ref = freeRef(snapshot.value, label);          // ← 校验 + 定型，都在 append 之前
+  const committed = await this.#transaction("add", { ref, label }, async () => {
+    const result = await this.#mutate<undefined>((value) => ({ ops: [ …用这个 ref 追加条目… ] }));
+    if (key !== undefined) await this.#deps.credentials.set(ref, key);
```

- ref 在 `append` **之前**解析，进意图（`{ kind: "add", ref, label }`），提交用的就是同一个 ref
  → 重放按 ref 对齐，不必按 label 猜（同名标签合法，`_2` 后缀）。
- **不改状态就可能失败的校验全部前移到 append 之前**：空白标签 / 空白密钥（本来就在最前面）与
  **没有空闲 ref**（旧代码里它在 `#mutate` 的 build 里抛，此时意图已经落盘 → 留下一条永远应用不了的
  意图）。真正的写入失败（凭据服务写失败、设置冲突重试用尽）仍然留下未决意图，那是**正确**的。
- `add` 的 JSDoc 与模块头新增「**意图与身份**」一段，写明这条时序契约。

**覆盖测试（新增 3 条）**

1. `add 在写意图之前解析 ref：意图带着最终 ref，提交用的就是它（重放因此按 ref 对齐）` ——
   用假设置端口的 `beforeMutate` 钩子在**提交发起的那一刻**读意图日志，断言里面那条意图是
   `{ kind: "add", ref: view.ref, label: "Team A" }`，且文档里的条目用的就是这个 ref。
2. `重放一条「设置已提交、凭据写入失败」的 add 意图：按 ref 对齐即无操作，不产生重复账号` ——
   让假凭据服务的 `set` 抛错（设置条目已提交、意图未收尾的崩溃点），断言未决意图带着**已提交条目的
   ref**；再用 `IntentLog.replay` 配一个按 ref 对齐的 apply（Task 14 的契约形状：ref 缺失即
   `unknown`，条目已存在即 `applied`），断言 `{ applied: 1, rejected: 0, unknown: 0, remaining: 0 }`、
   账号列表仍是**一个**条目、日志清空。
3. `没有空闲 ref 时在写意图之前失败：日志里不留一条永远应用不了的意图` —— 用 `accountRef()` 算出基础
   ref 并占满 `_2…_128`（accounts.ts 的 `MAX_REF_ATTEMPTS = 128`），断言 `add` 抛
   「no free credential reference」，且**一次都没落盘**（`writeCount() === 0`）、日志为空、
   `mutations` 为空。

**变异证据（把 `add` 临时改回 `#transaction("add", { label })` + 在 `#mutate` 的 build 里
`freeRef(value, label)`，即 pre-fix 形状）**

```
$ pnpm vitest run tests/vendors/commandcode-quota.test.ts
 ❯ tests/vendors/commandcode-quota.test.ts (28 tests | 3 failed)
 FAIL  add 在写意图之前解析 ref：意图带着最终 ref，提交用的就是它（重放因此按 ref 对齐）
 AssertionError: expected [ { …(4) } ] to deeply equal [ ObjectContaining{…} ]
   {   "kind": "add", "label": "Team A",  -   "ref": "DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a236090ddb39" }
 FAIL  重放一条「设置已提交、凭据写入失败」的 add 意图：按 ref 对齐即无操作，不产生重复账号
 AssertionError: expected { …(4) } to match object { kind: 'add', …(2) }
   { "kind": "add", "label": "Team A", -  "ref": "DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a236090ddb39" }
 FAIL  没有空闲 ref 时在写意图之前失败：日志里不留一条永远应用不了的意图
 AssertionError: expected 1 to be +0 // Object.is equality   ← store.writeCount()
 Tests  3 failed | 25 passed (28)
[exit code: 1]
```

三条新用例**只**钉住本轮的两处修复；其余 25 条在变异体下照常通过（说明没有顺手改动别人的语义）。

## 验证命令与输出（提交 `4fe97dd` 的工作树）

```
$ pnpm typecheck
$ tsc --noEmit            → 无输出（OK）

$ pnpm test
 ✓ tests/core/recovery.test.ts (14 tests)
 ✓ tests/core/accounts.test.ts (10 tests)
 ✓ tests/core/rotation.test.ts (19 tests)
 ✓ tests/core/credentials.test.ts (4 tests)
 ✓ tests/core/catalog.test.ts (12 tests)
 ✓ tests/core/adapter.test.ts (2 tests)
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/vendors/commandcode-quota.test.ts (28 tests)
 ✓ tests/vendors/commandcode.test.ts (27 tests)
 ✓ tests/core/transport.test.ts (15 tests)
 Test Files  10 passed (10)
      Tests  132 passed (132)
```

`git status --short` 干净（`4fe97dd` 之后无未提交改动）；本报告文件在 `.gitignore` 的 `.superpowers/`
之下，属计划目录、不入提交；未 `--amend`。

## 遗留 / 交接

1. **Task 14 的重放 `apply` 必须按 `intent.ref` 对齐**（本轮把 ref 写进意图，就是为了这一步）：
   `add` + 该 ref 的条目已存在 → 视为已提交（无操作，必要时补写凭据）；不存在 → 用该 ref 提交。
   若某条 `add` 意图**没有** ref（旧版本遗留的日志），它无法确定身份，应当判 `unknown` 留在日志里，
   而不是按 label 猜。
2. 原文第 8 节 Concern 2（「`add` 意图没有 ref」）与 Concern 4（`monthlyCredits` 窗口的前提）
   **已被本轮裁决取代**：现在是「意图一定带 ref」与「月度窗口只报消耗、没有 cap」。
3. `credits.credits.monthlyCredits`（月度余额）本轮**只读未用**：它既不进窗口也不进 `plan`，
   已留给第 2 期的套餐表 / 余额展示。

---

# 修复报告 Round 2（Round 1 修复引入的 1 条 Important 回归 + 1 条 Minor 文档）

- 分支：`work`（改动前 HEAD `4fe97dd`，我改动的两个文件树干净）
- 提交：`f9e7091` — `fix(commandcode): add 的提交按最新文档幂等（冻结 ref 已存在则不重复追加、不重写凭据槽）`
- 改动面：2 文件 / +115 −13（`src/vendors/commandcode/accounts.ts`、`tests/vendors/commandcode-quota.test.ts`）。
  `src/core/**`、`quota.ts` 与其它厂商文件**一个字节都没动**。
- 测试：本文件 28 → 30 条；仓库内 10 个受控测试文件 **134/134**。

## Finding（Important，Round 1 引入）— 冻结的 ref 在重试/并发时被重复追加

**根因确认**：Round 1 把 `freeRef` 提到 append 之前（为了意图携带身份），但 `#mutate` 每轮都
重新 `describe` 而不重新判定 ref：`accountRef` 对 `(vendor, label)` 是确定性的，所以两个同标签的
并发 `add` 会冻结到同一个 ref `R` —— 第一个提交 `[R]`，第二个拿新文档仍然追加 → `[R, R]`，
带 `key` 时还把同一个凭据槽写两遍；`list()` 的 `dedupeByRef` 只把重复行藏起来，文档里仍是两条。

**采用了哪种形状，为什么**：**`hasAccount(value, ref)` 闸门 + 空 ops 不落盘**（而不是「重试时重新
校验 free 并让本次尝试失败」）。理由：

- 每轮的 `build` 都用**刚读到的**文档判定（闸门在 `#mutate` 的 build 里，和算 ops 用的是同一份
  文档），所以没有 TOCTOU 窗口 —— 若把判定放在 `#mutate` 之前，判定与提交之间又能插进一个写者。
- 「ref 已存在 = 这次 add 已经成立」既覆盖自己的冲突重试，也覆盖并发同标签，语义与 Round 1 的
  重放契约（按 ref 对齐、已存在即已提交）**完全一致**，不需要给用户新造一个错误：并发的第二次
  `add` 返回既有的那个账号视图，而不是抛错。
- 凭据槽只在**真正追加了条目**的那一次写（`if (applied && key !== undefined)`）：绝不覆盖别人的
  密钥。代价是并发落败方的密钥被丢弃、视图如实 `configured: false`（用户可 `replaceKey`）——
  这比两个账号互相污染凭据槽安全。
- `#mutate` 新增一条通用契约：`build` 返回**空 ops** 表示「在这个文档上已成立」，直接返回**不落盘**。
  这样幂等提交不必伪造一次空写、也不会平白推进修订号去作废别人的写入（这条也被测试钉住）。

## Minor — `add` 的 JSDoc 对「凭据写失败可重放」过度声明

`add` 的 JSDoc 原文写「真正的写入失败（凭据写入、设置冲突耗尽）才留下未决意图，那是给崩溃恢复
重放的，正确」。改为：未决意图的作用是**不让账号被静默丢掉**，重放只能确认条目已经落地，
**补不回密钥** —— 那条账号会一直 `configured: false`，直到用户重新提供密钥（`replaceKey`）。

## 覆盖测试（新增 2 条，本文件 30 条）

1. `并发同标签的两个 add 冻结到同一个 ref：文档里只有一个条目，凭据槽最多写一次（Review Focus 1）`
   —— 用假设置端口把**第一次** `mutate` 停在「意图日志里已经出现第二条意图」之后（即两个 `add`
   都已经 append，因此都已经从**还没有提交**的文档里冻结出 ref），再放行。断言：两次 `add` 返回
   同一个 ref（= `accountRef("commandcode","Team A")`，这正是重复条目的来源）、`accounts` 恰好
   一条、`settings.mutations` 恰好一次（空 ops 不是一次空写）、`credentials.sets` 恰好一条且 ref
   正确、两条意图都被收尾。
   **这条测试证明什么／不证明什么**：它证明「提交按最新文档再判一次身份」这道闸门在**真实的
   交错**（后一次读取发生在第一次提交之前）下拦住了重复条目与重复凭据写入；闸门由意图日志的
   第二条 append 触发，因此**不依赖** `Promise.all` 的微任务顺序运气。它**不**证明真正的跨进程
   并发（那是 Task 14 的 `replay`/宿主顺序问题），也**不**覆盖「两个 add 想拿到两个不同账号」的
   产品诉求（按裁决，冻结 ref 的语义就是：同一个 ref 只能有一个账号）。
2. `冲突重试时冻结的 ref 已经在文档里：不再追加条目、不再写凭据槽（幂等提交）` —— 假设置端口第
   1 次 `mutate` 模拟「另一个写者抢先提交了**同一个 ref**并把修订号 3 → 7」后返回 `conflict`。
   断言：`settings.mutations` 只有 1 次（重试没有再提交）、`accounts` 只有一条、`credentials.sets`
   为空、视图是 `{ label: "Team A", configured: false, active: false }`、意图日志清空。
3. 顺序同标签的用例（Round 0 就有，本轮未改）：`同名标签的第二个账号得到不同的 ref（不共用同一个
   凭据槽，Review Focus 1）` —— 仍然得到 `_2` 两个不同 ref ✓（满足「顺序场景退化」的回归要求）。

## 变异证据

沙箱 = 仓库的**副本**（`src`/`tests`/配置 + 指向主树 `node_modules` 的 junction），跑完即整体回收，
**共享工作树全程没有被改动**（因为 Task 11 的并行代理正在同一棵树上写文件）。沙箱内基线 30/30 绿。

**变异 A：去掉 `add` 里的 `hasAccount` 闸门（= 评审报告的回归形状，每次都追加）**

```
$ pnpm vitest run tests/vendors/commandcode-quota.test.ts      # 沙箱内
 ❯ tests/vendors/commandcode-quota.test.ts (30 tests | 2 failed) 32ms
 FAIL  并发同标签的两个 add 冻结到同一个 ref：…
 AssertionError: expected [ { label: 'Team A', …(1) }, …(1) ] to deeply equal [ { label: 'Team A', …(1) } ]
 +   { "apiKeyEnv": "DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a236090ddb39", "label": "Team A" },   ← 第二个条目
 FAIL  冲突重试时冻结的 ref 已经在文档里：不再追加条目、不再写凭据槽（幂等提交）
 AssertionError: expected [ …(2) ] to have a length of 1 but got 2                     ← settings.mutations
 Tests  2 failed | 28 passed (30)
[exit code: 1]
```

**变异 B：去掉 `#mutate` 的「空 ops 不落盘」短路（幂等提交退化成一次空写）**

```
$ pnpm vitest run tests/vendors/commandcode-quota.test.ts      # 沙箱内
 ❯ tests/vendors/commandcode-quota.test.ts (30 tests | 2 failed) 33ms
 FAIL  并发同标签的两个 add 冻结到同一个 ref：…
 AssertionError: expected [ …(2) ] to have a length of 1 but got 2                     ← settings.mutations
 FAIL  冲突重试时冻结的 ref 已经在文档里：不再追加条目、不再写凭据槽（幂等提交）
 AssertionError: expected [ …(2) ] to have a length of 1 but got 2                     ← settings.mutations
 Tests  2 failed | 28 passed (30)
[exit code: 1]
```

两种变异下都只有本轮新增的这 2 条用例变红、其余 28 条照常通过（说明没有顺手改动别人的语义）。
沙箱已用 `safe_delete` 整体回收（trash id `20261013-224027-b8s9cj`，junction 只是被一起重命名，
主树 `node_modules` 未受影响，回收后主树 134/134 复跑绿）。

## 验证命令与输出

```
$ pnpm tsc --ignoreConfig --noEmit --strict … src/vendors/commandcode/accounts.ts \
    src/vendors/commandcode/quota.ts tests/vendors/commandcode-quota.test.ts
ISOLATED TYPECHECK OK (my 3 files + transitive imports)

$ pnpm vitest run tests/core tests/smoke.test.ts \
    tests/vendors/commandcode-quota.test.ts tests/vendors/commandcode.test.ts
 ✓ tests/core/accounts.test.ts (10)   ✓ tests/core/recovery.test.ts (14)
 ✓ tests/core/credentials.test.ts (4) ✓ tests/smoke.test.ts (1)
 ✓ tests/core/catalog.test.ts (12)    ✓ tests/core/adapter.test.ts (2)
 ✓ tests/core/rotation.test.ts (19)   ✓ tests/vendors/commandcode-quota.test.ts (30)
 ✓ tests/vendors/commandcode.test.ts (27) ✓ tests/core/transport.test.ts (15)
 Test Files  10 passed (10)
      Tests  134 passed (134)
```

**环境说明（重要，不是本轮的改动）**：`pnpm typecheck` 与 `pnpm test` 的**全量**输出此刻是红的，
红点是**并行代理正在写的 Task 11 文件** `tests/vendors/commandcode-login.test.ts`（未跟踪）——
它导入的 `src/vendors/commandcode/login.ts` 还不存在（对方处于 TDD 的 RED 阶段）：

```
$ pnpm typecheck
tests/vendors/commandcode-login.test.ts(33,8): error TS2307: Cannot find module
  '../../src/vendors/commandcode/login' …
[ELIFECYCLE] Command failed with exit code 2.

$ pnpm test
 FAIL  tests/vendors/commandcode-login.test.ts [ tests/vendors/commandcode-login.test.ts ]
Error: Cannot find module '../../src/vendors/commandcode/login'
 Test Files  1 failed | 10 passed (11)
      Tests  134 passed (134)
```

本轮的提交**只** add 了我的两个文件（`git add <两个路径>`，未跟踪的 login 测试文件不在提交里）；
`git log` 确认 `f9e7091` 的改动面是 2 文件 / +115 −13。等 Task 11 的实现落地后，全量 typecheck/test
应当自然转绿；本轮据此另行给出了「我的 3 个文件隔离 typecheck」与「仓库内 10 个受控测试文件全绿」
两条独立证据。

## 遗留 / 交接（Round 2 追加）

1. **Task 14 的 `replay.apply` 与 `add` 的闸门语义要对齐**：`add` + ref 已存在 → 视为已提交、
   **不再写凭据槽**。重放若需要给「已提交但缺密钥」的账号补密钥，必须显式 `credentials.set`
   （`replaceKey` 语义），不要指望 `add` 再写一次 —— 否则会覆盖槽里现有的密钥。
2. 并发同标签 `add` 的产品语义是「同一个 ref 只允许一个账号」：落败方拿到既有账号的视图，
   自己的 `key` 被丢弃（`configured` 如实反映槽里的状态）。若产品要「双击两次 = 两个账号」，
   需要在 UI/调用侧去重或串行化，不能靠 `add` 内部重新推导 ref（那会重新引入重放歧义）。
3. 本轮未触碰评审的 Minor 之外任何项；`quota.ts` 与两个 token 窗口的语义保持 Round 1 的状态。

