# Task 5 Report — 轮换引擎

状态：**DONE_WITH_CONCERNS**（无阻塞；concerns 均为裁决未覆盖的边界决策与一处双点维护提示）

- 分支：`work`
- 提交：`c049494 feat(core): account rotation engine`（任务提交，含三个新文件）
- 提交：`bbf71bc docs(core): fix typo in rotation cooldown comment`（自查发现的注释错别字，独立新提交；未使用 `--amend`）
- 验证：`pnpm typecheck` exit 0；`pnpm test` → 5 文件 / **35 tests passed**（任务前 17，本任务新增 18）

## 1. What I implemented

### `src/core/failures.ts`（35 行）
- `re-export type { FailureKind, Rejection }`（来自 `./adapter`，只做类型再导出，无运行时代码）。
- `TransientFailureKind = Extract<FailureKind, "server" | "network">`；`AccountScopedFailureKind = Exclude<FailureKind, TransientFailureKind>`。用 `Extract`/`Exclude` 而不是重抄联合成员，`FailureKind` 增删成员时这里自动跟随。
- `rejection(kind, message, resetAt?)`：构造 `Rejection`；`resetAt` 缺省时**不写该字段**（让「未知重置时刻」与「已知重置时刻」在数据上可区分，引擎据此选冷却策略）。
- **没有任何厂商错误码映射表**（裁决要求；那些属于 Task 9/12）。文件里不出现厂商字样。

### `src/core/rotation.ts`（189 行，`RotationEngine` + 两个常量）
- 常量：`MAX_TRIED = 16`、`RATE_LIMIT_COOLDOWN_MS = 300_000`。
- `pick({ model, tried })`：候选序列就是「规则命中 → 固定 → 顺序」——`[rule?.account, pinned, ...order]`，返回第一个既不在 `tried` 中、又没有生效拒绝的 ref；任一候选不可用都继续往下走，全不可用才 `undefined`。读取拒绝时**惰性清理**过期条目。
- `markRejected(ref, rejection)`：`server`/`network` 直接返回（不入表、也不清除既有条目）；其余分类写入 `{ rejection 副本, expiresAt }`，`expiresAt` 由分类 + `resetAt` + 当前时刻算出。同一 ref 后写覆盖先写。
- `clearCredentialRejection(ref)`：只删 `kind === "invalid-credential"` 的条目，其它分类与不存在的 ref 都是恒等变换。
- `rejections()`：返回**新建**的 `ReadonlyMap`（调用方改不动内部状态），顺带清理过期条目。
- `fallbackAllowed({ emitted, totalTokens, aborted })`：`!emitted && !aborted && totalTokens <= 0`。
- 构造参数 `RotationConfig = AccountState & { now?: () => number }`：**复制** `order`/`rules`（含 `models` 数组），之后不再读调用方对象；时钟可注入，缺省 `Date.now`。
- 纯逻辑：无 I/O、无定时器（过期惰性判定）、无类以外的状态；仅 `import type` 自 `./adapter` 与 `./failures`。

## 2. 每种 `FailureKind` 的拒绝生命周期（实现即裁决表）

| kind | 是否记入拒绝表 | 失效方式（`expiresAt`） | 对 `pick` 的效果 |
| --- | --- | --- | --- |
| `quota` | 是 | `resetAt ?? now + RATE_LIMIT_COOLDOWN_MS` | 到点前跳过，到点即恢复 |
| `rate-limit` | 是 | `now + RATE_LIMIT_COOLDOWN_MS`（**不看** `resetAt`，按裁决表字面） | 冷却 5 分钟后恢复 |
| `invalid-credential` | 是 | `undefined`（永不自愈） | 只有 `clearCredentialRejection(ref)` 能恢复 |
| `unavailable` | 是 | 与 `quota` 同规则 | 同 `quota` |
| `server` | **否** | — | 无痕迹；同一请求内靠 `tried` 防重复选择 |
| `network` | **否** | — | 同 `server` |

边界语义：`now >= expiresAt` 即视为过期（半开区间 `[记录时刻, 到期时刻)`），到点那一刻账号已可用（测试显式钉住）。`resetAt` 单位是 epoch 毫秒。

## 3. What I tested and the results

`tests/core/rotation.test.ts`，18 条测试，全部通过。覆盖：

| # | 测试 | 钉住的行为 |
| --- | --- | --- |
| 1 | 按模型规则优先选择账号 | 规则优先于顺序 |
| 2 | 固定账号优先，但被标记失效后回落到其它账号 | `pinned` 优先级 + quota(`resetAt`) 回落 |
| 3 | 已尝试过的账号不重复选择；全部试过返回 `undefined` | `tried` 语义 |
| 4 | 尝试上限为 16 | `MAX_TRIED` |
| 5 | 已输出 / 已消耗 token / 已中止时禁止切换 | `fallbackAllowed` 四个象限（Review Focus 2） |
| 6 | invalid-credential 在凭据更新后清除标记 | `clearCredentialRejection` 主路径 |
| 7 | rate-limit 冷却 5 分钟后自动恢复 | `rate-limit` + 注入时钟 |
| 8 | quota 没有 resetAt 时按 `RATE_LIMIT_COOLDOWN_MS` 冷却 | 裁决表 quota 行后半句 + 冷却边界 |
| 9 | quota 带 resetAt 时到 resetAt（毫秒）为止，到点即恢复 | 裁决表 quota 行前半句 + `resetAt` 是毫秒 |
| 10 | unavailable 与 quota 同规则（无 resetAt 按冷却，带 resetAt 到点恢复） | 裁决表 `unavailable` 行（后三种之一） |
| 11 | server 是瞬时失败：不进拒绝表，账号仍在轮换里 | 裁决表 `server` 行（后三种之二） |
| 12 | network 是瞬时失败：不进拒绝表，账号仍在轮换里 | 裁决表 `network` 行（后三种之三） |
| 13 | 瞬时失败既不写入也不清除既有拒绝条目 | `server`/`network` 不留痕迹 |
| 14 | `clearCredentialRejection` 只清 invalid-credential，对其它分类无效果 | 裁决补充要求 §3（含清除不存在的 ref 为恒等变换） |
| 15 | 规则账号已被拒绝时继续往固定 → 顺序走 | 裁决补充要求 §4（规则命中不可用 → 固定也不能用 → 顺序） |
| 16 | 规则账号已在 tried 中时同样继续往固定 → 顺序走 | 裁决补充要求 §4 的另一半 |
| 17 | `pick` 惰性清理已过期条目，且不改动调用方的 order / rules / tried | 「惰性清理」「不修改外部状态」 |
| 18 | `rejection()` 只在给出 resetAt 时带上该字段 | `failures.ts` 助手契约 |

每条断言都对应一条独立分支（非空断言检查）：若 `markRejected` 误记 `server`，测试 11/12 会在 `rejections().size` 与 `pick` 两处失败；若 `clearCredentialRejection` 清得过宽，测试 14 的 `rejections().has(ref)` 与末尾 `pick(...) === undefined` 会失败；若 `pick` 在规则账号不可用时直接返回 `undefined`，测试 15 失败。

## 4. TDD evidence

**RED**（实现前，`tests/core/rotation.test.ts` 已写好）：

```
$ pnpm vitest run tests/core/rotation.test.ts

 RUN  v5.0.4 C:/Work/dsh-llm-account

 ❯ tests/core/rotation.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/core/rotation.test.ts [ tests/core/rotation.test.ts ]
Error: Cannot find module '../../src/core/failures' imported from C:/Work/dsh-llm-account/tests/core/rotation.test.ts
 ❯ tests/core/rotation.test.ts:3:1
      3| import { rejection } from "../../src/core/failures";

 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

为何正是预期失败：这是全新模块，`src/core/failures.ts` 与 `src/core/rotation.ts` 都还不存在，所以 vitest 在**模块解析**阶段就失败（`0 test`），而不是跑出一条断言失败。任务说明也预先指出：新模块的 RED 是模块解析失败，而非 brief 里「FAIL，模块不存在」的字面转述。

**GREEN**（实现后）：

```
$ pnpm vitest run tests/core/rotation.test.ts
 ✓ tests/core/rotation.test.ts (18 tests) 4ms
 Test Files  1 passed (1)
      Tests  18 passed (18)

$ pnpm typecheck && pnpm test
$ tsc --noEmit            # exit 0
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/core/credentials.test.ts (4 tests)
 ✓ tests/core/accounts.test.ts (10 tests)
 ✓ tests/core/adapter.test.ts (2 tests)
 ✓ tests/core/rotation.test.ts (18 tests)
 Test Files  5 passed (5)
      Tests  35 passed (35)
```

## 5. Files changed

- 新增 `src/core/failures.ts`（35 行）
- 新增 `src/core/rotation.ts`（189 行）
- 新增 `tests/core/rotation.test.ts`（172 行）
- 未改动 `src/core/adapter.ts`、`src/core/accounts.ts`、`src/index.ts` 或任何配置/锁文件；`git status` 干净。

## 6. Self-review findings

- **完整**：五个方法（`pick`/`markRejected`/`clearCredentialRejection`/`rejections`/`fallbackAllowed`）与两个常量齐备；裁决表六行逐行有测试（见 §3），四条补充要求（瞬时失败不留痕迹、惰性清理且不改外部状态、清除只限 invalid-credential、规则回落）各有测试。
- **纪律**：无厂商错误码映射、无厂商字样（`src/core/` 内仅 `adapter.ts` 既有的 `VendorId` 类型联合含厂商名，属约束豁免）、无 `any`、无 I/O、无定时器、无 `await`；新文件只用 `import type`。
- **顺手修的**：`RATE_LIMIT_COOLDOWN_MS` 的 JSDoc 里把「冷却」误写成「冷缺」，已用独立新提交修正（`bbf71bc`，非 amend）。
- **一次刻意的重复**：`server`/`network` 的存在性在 `TRANSIENT_KINDS` 与 `rejectionExpiry()` 的 `switch` 里各写了一遍。前者决定「是否入表」，后者只为穷尽联合类型（实际不可达，已注释）。若将来给 `FailureKind` 加第 7 个成员，这两处都要跟上；`adapter.ts` 已封版，改动它的评审需要同时看这里。
- **`rejections()` 会顺手清理过期条目**：它是「读取」，但会改动引擎内部状态（清掉死条目）。对外可观察行为正确（过期条目不再出现），且不触碰外部对象；已在 JSDoc 写明。

## 7. Issues / concerns（都不阻塞，按字面裁决实现，供评审确认）

1. **`MAX_TRIED` 不在引擎内执行**：只导出常量。`pick` 不按 `tried.size` 截断，因为 `tried` 可能含不属于本 `order` 的账号（例如同请求里为别的模型试过的账号），按大小截断会误判「无可用账号」。裁决与 brief 的测试都只要求常量值为 16，执行上限归请求内核（Task 13）。已在 JSDoc 明确「由调用方执行」。
2. **`rate-limit` 不看 `resetAt`**（**已被下方「修复轮 1」推翻**）：裁决表 `rate-limit` 行的恢复方式只写了 `RATE_LIMIT_COOLDOWN_MS`，与 `quota`/`unavailable` 行显式区分「有/无 resetAt」形成对照，故起初按字面实现：即使厂商给了 `resetAt`（如 `Retry-After`），仍按记录时刻 + 5 分钟冷却。控制器裁定该表不完整，现改为 `resetAt ?? now + RATE_LIMIT_COOLDOWN_MS`，与 `quota` 对称。
3. **规则/固定账号即使不在 `order` 里也会被选中**：brief 的候选顺序把「规则命中」与「固定」排在「顺序」之前，且只以「已被拒绝 / 已在 tried」为淘汰条件。实际不可达（`dropAccount()` 会连带删除该账号的规则并把 `pinned` 清成 `null`），所以这里按字面实现，不做额外的「必须在 order 内」限制——那会让一条规则静默永不生效。
4. **同一 ref 的新拒绝覆盖旧拒绝**（例如先 `quota` 后 `invalid-credential`）：裁决未规定，取「最新观测优先」。测试 13 只钉住「瞬时失败不覆盖既有条目」这一半。
5. **换行警告**（非本任务引入）：提交时 git 提示 `LF will be replaced by CRLF`，仓库既有行为，未处理。

## 修复轮 1（控制器裁决）

**裁决**：`rate-limit` 必须与 `quota` 对称 —— 厂商给出 `resetAt` 时用它，缺省时才退回 `RATE_LIMIT_COOLDOWN_MS`。brief 表格里那句「rate-limit → 冷却」是裁决不完整，不是「刻意忽略 resetAt」的决定。理由：429 常带一个有意义的窗口重置，忽略它要么浪费一次轮换窗口，要么过早重试。**本节推翻本文档 §2 表格与 §7 concern #2 中「rate-limit 不看 resetAt」的描述，以本节为准。**

**改动**：`src/core/rotation.ts` 的 `rejectionExpiry()` —— `rate-limit` 从独立分支合并进 `quota`/`unavailable` 分支：

```ts
case "rate-limit":
case "quota":
case "unavailable":
  // 有重置时刻就用到点为止（429 常带一个有意义的窗口重置）；没有就退回冷却时长。
  return resetAt ?? now + RATE_LIMIT_COOLDOWN_MS;
```

半开区间语义不变（`now >= expiresAt` ⇒ 已恢复）。

**覆盖测试**（`tests/core/rotation.test.ts`）：

- `rate-limit 带 resetAt 时到 resetAt 即恢复（修复轮 1 裁决：与 quota 对称）` —— 新加。`resetAt` 早于冷却时：`resetAt - 1` 仍被拒、`resetAt` 当刻可选；`resetAt` 晚于冷却时：冷却到点（`+RATE_LIMIT_COOLDOWN_MS`）仍被拒，再到 `resetAt` 才可选（证明实现不是 `min(resetAt, cooldown)`）。
- `rate-limit 冷却 5 分钟后自动恢复` —— 原有，即「无 `resetAt` 仍按冷却」的那一半（`+RATE_LIMIT_COOLDOWN_MS + 1` 后恢复），保持不变。

新测试对修复前的实现必然失败：旧规则下 `expiresAt = 记录时刻 + 300_000 = 301_000`，而断言时刻 `now = resetAt = 21_000`，`21_000 >= 301_000` 为假 ⇒ 仍判为拒绝 ⇒ `pick` 返回 `undefined`，`toBe("a")` 失败。故它是真实的回归钉子，不是同义反复。

**命令与输出**：

```
$ pnpm typecheck && pnpm test

$ tsc --noEmit            # exit 0
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/core/adapter.test.ts (2 tests)
 ✓ tests/core/credentials.test.ts (4 tests)
 ✓ tests/core/accounts.test.ts (10 tests)
 ✓ tests/core/rotation.test.ts (19 tests)
 Test Files  5 passed (5)
      Tests  36 passed (36)
```

**提交**：`b9914ad fix(core): honor vendor resetAt for rate-limit rejections`（2 files changed, 22 insertions(+), 3 deletions(-)），独立新提交，未使用 `--amend`。

其余四条 concern 由控制器接受并在本轮保持原样：#1 上限执行归请求内核（已带入后续任务）、#3 规则/固定账号可不在 `order`（实际不可达）、#4 最新观测覆盖旧拒绝、#5 瞬时分类两处表达（已记录给终审）。本轮未改动其它任何内容。

任务 5 提交序列：`c049494`（引擎）→ `bbf71bc`（注释错别字）→ `b9914ad`（本轮裁决修复）。
