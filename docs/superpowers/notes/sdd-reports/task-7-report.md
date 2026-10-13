# Task 7 Report — 请求内核（整请求 deadline + 流空闲看门狗）

**Status:** DONE
**Branch:** `work`
**Commits:**
- `2ac5bf5` — `feat(core): request deadline and idle watchdog`（模块 + 13 条测试，brief 指定的提交信息逐字一致）
- `6b41111` — `test(core): cover consumer think-time and yield-term deadline paths`（自审后补的 2 条测试，见「Self-review findings」）

> 注意：控制器的 review package `review-task-7.md` 是在 `2ac5bf5` 之后生成的（range `17279f3..2ac5bf5`），只含第一个提交；第二个提交 `6b41111` 只加测试、不改源码，review 时请把 range 换到 `17279f3..6b41111`。

## What I implemented

`src/core/transport.ts`（新建，173 行）+ `tests/core/transport.test.ts`（新建，334 行）。没有改动任何其它文件。

**Produces 与 brief 一致：**

```ts
export const LLM_REQUEST_TIMEOUT = "LLM_REQUEST_TIMEOUT";
export const LLM_STREAM_IDLE_TIMEOUT = "LLM_STREAM_IDLE_TIMEOUT";
export interface StreamBudget { requestTimeoutMs: number; streamIdleTimeoutMs: number }
export async function* runStream<T>(source: AsyncIterable<T>, budget: StreamBudget,
  opts: RunStreamOptions = {}): AsyncIterable<T>
export interface RunStreamOptions { signal?: AbortSignal; now?: () => number }
```

`RunStreamOptions` 是把 brief 里内联的 `{ signal?, now? }` 起了个名字（结构完全相同，纯增量）。除这两个码与 `ABORTED` 外没有新增常量。

### 错误类型：用宿主的 `LlmError`（三个码都用）

先读了类型声明再决定：`node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts:48-72` —
`class LlmError extends HarnessError`，`constructor(message: string, code: string, options?: LlmErrorOptions)`，`readonly failure: LlmFailure`；构造时会校验 message/code 非空、`status` 100–599 等。它能直接承载我们这三个码，所以没有退回本地 `Error` 子类。

**为什么值导入 `@deepseek-ai/dsh-llm` 是安全的**（这点我专门查了宿主消费路径，因为本包把宿主包放在 devDependencies）：宿主 `normalizeLlmFailure()`（`dsh-llm/lib/index.js`）**不靠 `instanceof` 分类**，它用 `getOwnPropertyDescriptor(error, "code")` 读**自有数据属性** `code`，并用自有的 `failure` 快照做 `carried.code === ownErrorCode(error)` 校验；`instanceof HarnessError` 只在没有自有 `code` 时兜底（`harnessErrorCode`），而 `LlmError` 一定写自有 `code` + 自有 `failure`。所以即使打包时把宿主代码内联成第二份副本，宿主仍能按 `code`/`failure` 正确归一化，不会因类身份不同而丢分类。`failure` 快照还给宿主一份可序列化的事实（终态 finish chunk 用得上）。

- `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT`：按 brief 导出为常量。
- `ABORTED`：宿主 `LlmRuntime` 用同一个字符串判定取消（`signal?.aborted || failure.code === "ABORTED"`），但宿主没有导出这个常量；它不在 Produces 列表里，所以做成**模块内私有常量**，不导出。`ABORTED` 分支会把调用方的 `signal.reason` 作为 `cause` 挂上（有值时才写，避免留下 `cause: undefined`）。

### 关键实现决定（含一处与「等 return() 完成」的刻意偏离）

1. **关闭原始流是尽力而为：只发 `return()` 请求，不等它完成。** 实测（`node -e`：一个 `try { await new Promise(()=>{}) } finally {…}` 的异步生成器，`it.next()` 后 `it.return()`）：
   `VERDICT: return() HANGS on a never-settling await` —— 卡在永不落地的 `await` 上的异步生成器**不处理** `return()`，`await iterator.return()` 会永久挂起。而「上游卡死」正是看门狗要救的场景：若在 `finally` 里 await 它，**brief 自己的 `never()` / `stallAfterOne()` 两条测试就会永久挂起**，看门狗也随之为失效。因此 `closeQuietly()` 只发请求并吞掉拒绝/同步抛出（关闭失败不改写已经确定的错误、也不产生未处理拒绝）。brief 的额外测试 3 要求的也正是「`return()` 被调用」，而非「等待其完成」。
2. **两个预算各用独立真实定时器**，各自带自己的码（不靠时钟比较来判是谁到点）。唤醒只由真实定时器负责；注入的 `now` 只用于 deadline 边界判定（见下一节）。
3. **延迟上膛前夹上界**：`armDelay = Math.min(ms, 2_147_483_647)`。Node 会把超过该值的延迟夹到 1ms（等于立刻触发），所以不加夹子时「一个足够大的数」会**立刻超时**（下面有 mutation 证据）。夹住之后 `Number.MAX_SAFE_INTEGER`（以及 `Infinity`）都自然表示「不限制」，**因此不需要引入任何哨兵值常量**（brief 明确不要）。`MAX_TIMER_DELAY_MS` 这个数值我在本地重写了一份（宿主 `@deepseek-ai/dsh-timeout` 也导出同名常量），理由见「Concerns 5」。
4. **不 `unref()`**：与宿主 `dsh-timeout` 的做法一致（它也不 unref）；定时器只在流的生命周期内存在，`finally` 里一律清掉。
5. **`runStream` 本身就是 async generator** → 在第一次 `next()` 之前一行代码都不执行：调用 `runStream()` 不启动原始流、不上膛定时器，「拿到流却从不消费」不会泄漏 handle；错误也统一从迭代面抛出（不会同步抛）。代价是预算**从第一次索取开始计**，不是从调用时刻 —— 已写进模块头注释。`finish` 后不调用原始流的 `return()`（它已经结束）；只有「提前放弃」才关闭。

## How the two budgets interact

- **互不抑制**：整请求 deadline 在第一次索取时上膛**一次**（`deadlineAt = now() + requestTimeoutMs`），产出再多也不重置；空闲看门狗在**每一次未完成的索取**上膛，一拿到 chunk（或 `done`）立刻清掉——所以消费方处理 chunk 的停顿不算「厂商空闲」。
- **谁会先到**：谁的通知先落到内部的 `interrupted` promise 上就报谁的码。**同一时刻都该到点时整请求 deadline 赢**——它在上膛顺序上总在最前（空闲计时每轮新插一次）。因此两个预算同时到期时结果是确定的，不靠时钟比较。
- **越过 deadline 的 chunk 不下发**：yield 之前有一次 `now() >= deadlineAt` 判定。定时器回调还没排到时（同 tick 内的竞态），这次判定仍会把越预算的 chunk 拒掉，报 `LLM_REQUEST_TIMEOUT`。这就是注入 `now` 的**全部**用途——它从不替代定时器。
- **deadline 在消费方手里继续走**：消费方拿到 chunk 后挂在 `yield` 上处理，整请求计时照走；停留超过剩余预算时，**下一次索取**立刻报 `LLM_REQUEST_TIMEOUT`（有测试）。
- **调用方中止优先于超时吗**：中止有自己的监听器，会打断当前等待并报 `ABORTED`（不会报成超时码）。如果 deadline 已经在同一瞬间先落地，报的是 `LLM_REQUEST_TIMEOUT`——两种解释都成立，而宿主本身按 `signal?.aborted` 重新归类，取消仍然表现为取消。这一点我按「先到的通知赢」实现，没有再为平局加机制（见「Concerns 4」）。

## What I tested and the results

15 条测试（brief 的 3 条逐字保留，其余是必须补的和自审后补的）：

| # | 测试 | 钉住的行为 |
| --- | --- | --- |
| 1 | 两个错误码常量与设计约定的字符串一致 | 其它任务 import 的常量值就是宿主路由用的字符串 |
| 2 | 整请求超时抛出 `LLM_REQUEST_TIMEOUT` | brief 测试；`never()` 源 |
| 3 | 流空闲超时抛出 `LLM_STREAM_IDLE_TIMEOUT` | brief 测试；产出一个后卡住 |
| 4 | 正常流按原顺序透传所有 chunk（含 usage） | brief 测试；含 `usage` 透传、顺序不变 |
| 5 | 超时抛的是宿主的 `LlmError`，并主动关闭原始流 | **额外测试 3**：`instanceof LlmError`、`code` 正确、`return()` 恰好被调用 1 次、`next()` 真的被索取过 |
| 6 | 调用方中止抛出 `ABORTED` 而不是超时码，并关闭原始流 | **额外测试 1**：等待中 abort → `ABORTED` + 关闭 |
| 7 | 消费前已中止：抛 `ABORTED`，且完全不索取原始流 | 已取消的请求不发出：`next()` 0 次、`return()` 0 次 |
| 8 | 消费方提前退出（break）时关闭原始流，并清掉全部定时器 | 消费方 `return()` 路径的清理与关闭 |
| 9 | 流正常结束后不残留定时器 | **额外测试 2**：峰值 ≥2（确实上过 deadline+idle）、结束时归零 |
| 10 | 每次产出后空闲计时重置：产出间隔始终短于空闲预算的长流不会误报空闲超时 | 看门狗真的会「重置」（只上膛一次的实现会挂） |
| 11 | 交出 chunk 后（消费方处理期间）只留整请求 deadline，空闲计时已清 | 空闲 = 只在有未完成索取时存在；deadline 跨 yield 一直活着 |
| 12 | 消费方在 yield 上停留超过整请求 deadline 时，下一次索取就报整请求超时 | 整请求预算把消费方处理时间算在内 |
| 13 | 整请求 deadline 由注入的 `now` 判定：越预算的 chunk 不再下发 | `now` 被真正使用（Fake clock 前进越过 deadline） |
| 14 | 原始流的错误原样抛出，不被包装成超时码 | 上游失败不被改写（适配器要据此分类）；出错路径也清定时器 |
| 15 | 两个预算用足够大的数表示「不限制」：慢一点的正常流照样透传 | 夹子存在；「足够大的数」= 不限制 |

**结果：** `pnpm typecheck` 无输出（通过）；`pnpm test` = **7 files / 63 tests passed**（原有 48 + 本任务 15），vitest 报告 `Duration 318ms`；`pnpm typecheck && pnpm test` 整体 wall **2.08 s**，进程正常退出（没有挂住）。单跑本文件 5 次：每次都 `Tests 15 passed (15)`。

**mutation 验证（证明测试不是摆设）：**

1. 去掉夹子（`armDelay` 直接返回 `ms`）→
   `TimeoutOverflowWarning: 9007199254740991 does not fit into a 32-bit signed integer. Timeout duration was set to 1.`，第 15 条测试失败。→ 夹子必需、且该测试真的在守它。
2. 空闲看门狗改成只上膛一次（不回置）→ 第 10 条测试以 `LLM_STREAM_IDLE_TIMEOUT` 失败。→ 该测试真的在守「重置」。

## TDD evidence

**RED**（`pnpm vitest run tests/core/transport.test.ts`，实现之前）：

```
 ❯ tests/core/transport.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/core/transport.test.ts [ tests/core/transport.test.ts ]
Error: Cannot find module '../../src/core/transport' imported from C:/Work/dsh-llm-account/tests/core/transport.test.ts
 ❯ tests/core/transport.test.ts:4:1

 Test Files  1 failed (1)
      Tests  no tests
   Duration  248ms
```

为什么这就是预期：`src/core/transport.ts` 是全新模块，测试文件 import 它 → 模块解析失败，符合 brief Step 2 的「FAIL，模块不存在」。（此时还没有任何断言被求值。）

**GREEN**（写完实现后，同一命令）：

```
 ✓ tests/core/transport.test.ts (12 tests) 66ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  201ms
```

首轮 12 条全过（brief 3 条 + 额外 3 条 + 我加的 6 条）。补完第 11/12 条后本轮最终为 `Tests 15 passed (15)`。

## How I established there are no leaked timers / handles

1. **真实定时器计数（`trackTimers()`）**：临时包裹 `globalThis.setTimeout`/`clearTimeout`，用一个 `Set` 记录「上膛且尚未触发/清除」的句柄（触发或清除都从集合里删）。断言**峰值 ≥2**（证明确实观测到了内核自己上的两个定时器，不是空跑通过）且**结束时为 0**。分别覆盖：正常结束（#9）、消费方 break（#8）、上游抛错（#14）。
2. **假定时器计数**：`vi.useFakeTimers()` 场景收尾断言 `vi.getTimerCount() === 0`（#10）。
3. **挂起在 yield 期间只剩 1 个**（#11）：确认交出 chunk 时空闲计时已清，且整请求 deadline 一直存活到流结束。
4. **代码路径逐条核对**：正常 `done` / 上游错误 / 两个超时 / 调用方中止 / 消费方 break / 消费前已中止（此时**什么都没上膛**，也没注册 abort 监听器）/ 「拿到流但从不消费」（生成器体压根没跑）——`finally` 里 `clearTimeout` 两个定时器 + `removeEventListener`，`abort` 只注册一次、一定移除（否则会挂在调用方的 signal 上，属于真实泄漏）。
5. **不用 await 关闭**（见上文实测）——这也顺带避免了「关不掉就永远卡住」的第二类挂死。
6. **进程级证据**：`pnpm typecheck && pnpm test` 2.08 s 内正常退出，vitest 正常打印汇总；残留 handle 会表现为套件变慢或 worker 不退（brief 提到的正是这个信号）。

**如何避免 flaky（不靠 wall-clock 运气）：** 15 条里 14 条完全不依赖真实时间流逝——
- 10 条用「事件驱动」而非睡眠：假迭代器在被 `next()` 时 resolve 一个 `demanded` promise，测试 `await demanded` 后才 `abort()`/推进时间，因此「内核已经挂起在等待原始流」是确定的，不靠猜时序；
- 3 条超时测试只断言错误码（从不比较耗时），预算取 10ms；
- 需要「时间真的走过去」的空闲重置用 `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(20)` 精确推进（20ms 步进 vs 30ms 空闲预算，比例固定）；
- 第 13 条用注入的 `now` 推进时钟（每次读前进 60s，而 deadline 只有 30s），完全不碰真实时间；
- 只有第 12 条必须让真实时间过去（要的是「定时器真的到点」）：预算 25ms、停留 60ms，两处余量都在注释里写明理由；且它断言的是错误码而不是时长。即使事件循环极端停顿，失败也是明确的断言失败，不会挂住。
- 重复 5 次单文件运行结果一致（15/15 × 5）。

## Files changed

```
 src/core/transport.ts        | 173 +++++++++++++++++++++++++++++  (new)
 tests/core/transport.test.ts | 334 +++++++++++++++++++++++++++++  (new)
```

没有改动其它任何模块。工作区里 `docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md` 的改动**不是我做的**（控制器在并发编辑），我没有 `git add` 它；`git status` 里它仍是未暂存状态。行尾与既有文件一致（`git ls-files --eol`：`i/lf w/lf`，与 `rotation.ts` 相同）。没有用 `--amend`。

## Self-review findings

读了自己完整 diff 后的改动（都在第二个提交里）：

1. **测试卫生**：第 10 条原本用浮空的断言 promise（`const settled = expect(consuming).resolves…` 后再推时间），失败路径上会产生 `PromiseRejectionHandledWarning` + vitest 的 `Unhandled Errors 1 error`（假阳性风险）。改成 `.then(value => ({value}), error => ({error}))` 立刻挂上拒绝处理——mutation 下复查：只剩 1 条断言失败，不再有未处理错误噪声。
2. **去掉了可能挂住的断言**：第 5 条原来在断言后 `await upstream.demanded`（若原始流从未被索取就会挂到超时），换成 `expect(upstream.demandCount()).toBeGreaterThan(0)` —— 同样的保护、立刻失败、诊断更清楚。
3. **补上自审发现的覆盖缺口**（第二个提交）：上游抛错路径的定时器清理、消费方 break 路径、以及「消费方处理时间不计入空闲但计入整请求 deadline」「deadline 在 yield 期间到点」两条我自己写进文档的核心语义。
4. **文档澄清**：`requestTimeoutMs` 的注释里明确「消费方处理已产出 chunk 的时间也算在这个预算里」。
5. **纪律核对**：`src/core/transport.ts` 里没有 `commandcode`/`opencode` 等厂商字样、没有 `any`（grep 过）、没有新哨兵常量、没有 `unref`；`pnpm typecheck` 在 `strict` + `noUnusedLocals/Parameters` + `verbatimModuleSyntax` 下干净。

## Issues or concerns

1. **打包外部化（影响 Task 9/12/14，建议控制器裁决）**：本包把宿主包都放在 `devDependencies`，而 tsdown 的默认外部化集合来自 `getProductionDeps(pkg)` = `dependencies` + `peerDependencies`（+meta/optional）——**devDependencies 会被内联进 `lib/index.js`**。我这次的值导入 `LlmError` 安全（宿主按自有 `code`/`failure` 分类，不看类身份），但 Task 9/12 必然要值导入 `LlmAdapter` 基类；若宿主对该实例做 `instanceof LlmAdapter` 检查，内联的第二份副本会让它认不出来。旧插件是把宿主包放 `peerDependencies`（其 `lib/index.js` 里是裸 `import … from "@deepseek-ai/dsh-timeout"` = 外部化）。**我没有实测构建**（`src/index.ts` 目前还没 import 本模块，构建证明不了；我也不该动其它文件），所以这是读 tsdown 源码得来的结论，装配任务（14）请落实：把宿主包提到 `dependencies`/`peerDependencies`，或在 tsdown 配置里显式 `deps.neverBundle`。
2. **两个超时码不在宿主的默认可重试集合里**：宿主 `DEFAULT_RETRYABLE_CODES = ["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"]`。规格 §10 说「网络/超时：可重试错误交由宿主重试策略」，但按默认 `normal` 策略，我们的 `LLM_REQUEST_TIMEOUT`/`LLM_STREAM_IDLE_TIMEOUT` **不会**被重试。需要计划层决定：要么 Task 9/12 把这两个码写进 provider 的 `retryableCodes`，要么把超时映射到宿主的 `TIMEOUT` 码（但这会丢掉「整请求 vs 空闲」的区分）。brief 要求的就是这两个常量名，所以我按 brief 实现，没有擅自改名。
3. **预算取值校验不在本模块**：非正数/`NaN` 会交给 `setTimeout` 按 0 处理（立即触发、快速失败），超过 `MAX_TIMER_DELAY_MS` 的按上限夹住（= 不限制）；我没有为此新增哨兵常量（brief 要求）。旧插件是在 Config schema 上校验（`z.number().min(1).max(MAX_TIMER_DELAY_MS)`），Task 9/12 应当同样在设置层校验，内核不再重复。
4. **两个边界（已知、已记录）**：(a) 「拿到流且已开始消费、但之后既不消费也不 `return()`」会让 deadline 定时器一直挂着——这是 async generator 的固有语义，消费方必须用 `for await` 或显式 `return()`；未开始消费则什么都不上膛。(b) 因为关闭是尽力而为，卡在永不落地 `await` 里的上游不会执行它自己的 `finally` 清理；适配器应把调用方 `signal` 接进自己的 I/O，让它自己解开（宿主 `idleWatchdog` 的文档也是这个模型：信号只负责通知）。
5. **重复了一份宿主的常量**：`MAX_TIMER_DELAY_MS = 2_147_483_647` 本地重写，没从 `@deepseek-ai/dsh-timeout` 导入。理由：那是 Node 的定时器语义常量（不是宿主策略），导入它会给这个新模块再添一个运行时宿主依赖（而宿主包目前都在 devDependencies，见 Concern 1）。若项目更看重单一事实来源，把本行换成 `import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout"` 即可，但请与 Concern 1 一起决定。
6. **`now` 的语义**：按 brief 只用它做 deadline 边界判定，从不用它替代定时器；因此注入一个「不随真实时间前进」的 `now` 只会影响「越预算的 chunk 是否下发」，不会影响定时器唤醒（测试 #13 就是这么用它的）。
