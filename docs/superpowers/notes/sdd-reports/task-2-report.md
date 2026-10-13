# Task 2 Report — 内核类型与能力声明

- 任务书：`.superpowers/sdd/2026-10-13-dsh-llm-account-phase1-host/task-2-brief.md`
- 分支：`work`；提交：`cf6784e feat(core): vendor adapter port types`（父提交 `a1da884`，新提交，未使用 `--amend`）
- 结论：**DONE**（无阻塞项；下列 9 条为已披露的判断点，供控制器复核）

## 1. 实现了什么

`src/core/adapter.ts`（226 行，纯类型 + 1 个纯函数）：

| Produces 名称 | 位置 | 形状 |
| --- | --- | --- |
| `VendorId` | L10 | `"commandcode" \| "dsh-opencode-go"`（类型联合，全局约束允许的唯一厂商字样出现处） |
| `FailureKind` | L13 | `"quota" \| "rate-limit" \| "invalid-credential" \| "unavailable" \| "server" \| "network"` |
| `Rejection` | L22 | `{ kind; resetAt?: number; message }` |
| `AccountView` | L32 | `{ ref; label; configured; active }` |
| `ModelRule` | L44 | `{ models: string[]; account: string }` |
| `AccountState` | L50 | `{ order: string[]; rules: ModelRule[]; pinned: string \| null }` |
| `VendorCapabilities` | L57 | 七个字段：`reorder`/`pin`/`browserLogin`/`modelAccountRules`/`quotaShape`/`modelVisibilityWrite`/`automaticSwitch` |
| `AccountPort` | L75 | §6.3 逐字：`list/add/rename/replaceKey/remove/select` + 可选 `move?/setAutoSwitch?` |
| `CredentialPort` | L91 | `resolve(ref)` / `set(ref, value)` / `unset(ref)` |
| `QuotaWindow` | L104 | `key` 必填；`used`/`cap`/`percent`/`resetAt`/`exceeded` 可选 |
| `QuotaSnapshot` | L120 | `{ windows: QuotaWindow[]; plan?: string; failures: string[] }` |
| `QuotaPort` | L129 | `snapshot(): Promise<QuotaSnapshot>` |
| `CatalogEntry` | L134 | `{ id; name; contextWindow?; maxTokens?; efforts?; inputModalities }` |
| `CatalogPort` | L150 | `list(): Promise<CatalogEntry[]>` |
| `LoginStatus` | L155 | `{ state: "idle" \| "waiting" \| "success" \| "failed"; authUrl?; reason? }` |
| `LoginPort` | L164 | `begin()` / `status()` / `cancel()` |
| `TransportPort` | L174 | `stream(options: GenerateOptions): AsyncIterable<StreamChunk>` |
| `SettingsPort` | L195 | `describe(ns)` / `mutate(ns, ops, revision)`，两者都返回 `SettingsSnapshot` |
| `VendorAdapter` | L201 | §6.3 九字段 + 宿主适配器实例引用 `llm: LlmAdapter` |
| `supports(caps, feature)` | L223 | 布尔能力按取值；非布尔能力（`quotaShape`/`modelVisibilityWrite`）按是否声明；无副作用 |

宿主类型只做 `import type`（L7）：`GenerateOptions`、`LlmAdapter`、`ModelModality`、`StreamChunk`。没有值导入、没有类、没有 I/O、没有 Task 3–8 的实现。

## 2. 测试与结果

`tests/core/adapter.test.ts` 两个用例（任务书 Step 1 的两条，`import { expect, it } from "vitest"`）：

1. `reorder 未声明时判定为不支持` — `{ reorder: false }` → `false`
2. `quotaShape 两种取值都合法` — `"percent"` 与 `"windows"` → 均 `true`

结果：

- `pnpm typecheck` → exit 0（`tsc --noEmit` 无输出）
- `pnpm test` → **2 files / 3 tests passed**（`tests/smoke.test.ts` 1 + `tests/core/adapter.test.ts` 2），exit 0
- `pnpm build` → exit 0（`lib/index.js` 0.10 kB、`lib/index.d.ts` 0.09 kB；`lib/` 已被 `.gitignore` 忽略，无脏文件）

输出干净：无警告、无未处理拒绝、无 console 噪声。

## 3. TDD 证据

**RED #1**（Step 1 → Step 2，先写测试再建实现文件）

命令：`pnpm vitest run tests/core/adapter.test.ts`

```
 FAIL  tests/core/adapter.test.ts [ tests/core/adapter.test.ts ]
Error: Cannot find module '../../src/core/adapter' imported from C:/Work/dsh-llm-account/tests/core/adapter.test.ts
 Test Files  1 failed (1)      Tests  no tests        [exit code: 1]
```

为什么符合预期：实现文件尚不存在，导入无法解析，测试必须在实现之前失败。

**RED #2**（Step 3 前半：先落类型，可执行部分留空）

命令：`pnpm vitest run tests/core/adapter.test.ts`

```
 FAIL  tests/core/adapter.test.ts > reorder 未声明时判定为不支持
TypeError: supports is not a function
 FAIL  tests/core/adapter.test.ts > quotaShape 两种取值都合法
TypeError: supports is not a function
 Test Files  1 failed (1)      Tests  2 failed (2)      [exit code: 1]
```

为什么符合预期：这正是任务书 Step 2 写明的失败原因（「`supports` 未定义」）。我先落类型再做函数，让 RED 落在指定的原因上，而不是停在「模块不存在」。

**GREEN**（Step 3 后半 + Step 4）

命令：`pnpm vitest run tests/core/adapter.test.ts`

```
 ✓ tests/core/adapter.test.ts (2 tests) 2ms
 Test Files  1 passed (1)      Tests  2 passed (2)
```

随后 `pnpm typecheck && pnpm test` 全绿（见 §2）。

## 4. 安装的宿主 devDependencies（`package.json` 逐字）

全部为**精确版本**（无 `^`/`>=`），与 Step 0 命令一致：

```
"@deepseek-ai/cordis": "4.0.4",
"@deepseek-ai/dsh-attachment": "0.2.0-rc.2",
"@deepseek-ai/dsh-credentials": "0.2.0-rc.2",
"@deepseek-ai/dsh-launch-environment": "0.2.0-rc.2",
"@deepseek-ai/dsh-llm": "0.2.0-rc.2",
"@deepseek-ai/dsh-settings": "0.2.0-rc.2",
"@deepseek-ai/dsh-timeout": "0.2.0-rc.2",
"@deepseek-ai/dsh-typert-protocol": "0.2.0-rc.2",
"@deepseek-ai/dsh-web": "0.2.0-rc.2",
"@deepseek-ai/schemastery": "3.18.4",
```

（原有 `@types/node ^26.6.5` / `tsdown ^0.23.1` / `typescript ^6.0.3` / `vitest ^5.0.4` 未改动。安装输出：`Packages: +45 -3`，`Done in 5.5s`，`pnpm-lock.yaml` 已更新。）

## 5. 变更文件

- 新增 `src/core/adapter.ts`
- 新增 `tests/core/adapter.test.ts`
- 修改 `package.json`（devDependencies）
- 修改 `pnpm-lock.yaml`
- 提交：`cf6784e`（4 files changed, 830 insertions(+), 7 deletions(-)）

## 6. 自查发现

- **完整性**：Produces 的 20 个名字全部存在，`ModelRule`/`AccountState`/`VendorCapabilities`/`AccountPort`/`TransportPort` 与任务书给出的逐字形状一致。
- **约束**：`src/core/` 中 `commandcode|opencode` 只出现在 L10 的类型联合（全局约束允许）；无 `any`（`unknown` + 收窄）；`verbatimModuleSyntax` 下类型导入全部 `import type`；`tsc --noEmit` 覆盖 `tests/`，两个 `as VendorCapabilities` 断言可编译。
- **纪律**：文件仅类型 + `supports()`，无类、无 I/O、无 Task 3–8 逻辑；`supports()` 只做查询。
- **测试**：两条用例检查真实行为（布尔能力按取值、非布尔能力按声明），非空断言；输出干净。

### 已披露的判断点（请控制器复核）

1. **`TransportPort.stream(options: GenerateOptions)`** —— §6.3 草案写的是 `RequestOptions`，但 `@deepseek-ai/dsh-llm@0.2.0-rc.2` **不存在**该类型；宿主对应类型是 `GenerateOptions`（已核对宿主 d.ts 与两个旧包的 `stream(options: GenerateOptions)`）。未自造本地替身。若控制器另有意图，这是唯一需要改的签名。
2. **`VendorAdapter.llm: LlmAdapter`** —— §6.3 未列该字段，但 Step 3 要求本文件引用宿主 `LlmAdapter`；`llm` 是唯一合理落点（值为注册到宿主路由的适配器实例）。Tasks 3–13 均不消费 `VendorAdapter`，风险受控。
3. **额外导出 `SettingsOp` / `SettingsSnapshot`** —— 由强制的 `mutate(ns, ops, revision)` 与「返回体里带修订号」逼出；形状照宿主路径 op 词汇（`set|unset` + `path`）但不 import 宿主类型，符合「不绑定宿主 settings 具体类型」。`mutate` 冲突语义以文档注明（`code` 为 `SETTINGS_CONFLICT`），未引入类型。
4. **`QuotaWindow.resetAt?: number`（epoch 毫秒）** —— 任务书未给类型；取毫秒与 `Rejection.resetAt?: number` 保持一致。Task 10/13 必须把 ISO 字符串（`resetAt`/`resetsAt`）转成毫秒。
5. **`LoginStatus.state` 取值 `"idle" | "waiting" | "success" | "failed"`** —— 取自旧插件 `CommandCodeLoginStatus`（Task 11 对标同一流程），非臆造；`reason?: string` 覆盖测试要的 `"timeout"`。
6. **`CredentialPort` 用 `resolve/set/unset`** —— 对齐设计 §4.1 与宿主接缝词汇，而非 `read/write/remove`。
7. **`AccountView` 只保留 4 个字段**（`ref`/`label`/`configured`/`active`，来自 Task 4 测试的字面量）—— §8 的 UI 还需要套餐/状态/额度，但那属于计划 1b，按 YAGNI 不提前加（后续为加法，不破坏）。
8. **`CatalogPort.list()` / `QuotaPort.snapshot()` 方法名** —— §6.3 与计划都未固定；`CatalogPort` 在本期甚至无人消费（Task 9/12 的 deps 里没有 catalog），改名的代价限于本文件。
9. **测试改动两处**：`it`/`expect` 从 `vitest` 显式导入（`vitest.config.ts` 未开 `globals`，裸 `it` 会 `it is not defined`）；第二条用例补了 `"windows"` 断言，使其与用例名「两种取值都合法」相符。

## 7. 问题与风险

- 无阻塞。唯一实质风险是判断点 1（`GenerateOptions` 取代草案里的 `RequestOptions`）：若控制器认为应另立项目内类型，改动只在 `src/core/adapter.ts` 一行与 `TransportPort`。
- 其余判断点都是加名字/选词汇层面的事，未消费方（Tasks 3–13）按 Produces 名单里的名字编程不受影响。
- 未做也不应做的事：未改 `tsdown.config.ts`，未建 `cordis.patch.yml`，未动 `src/index.ts`，未触碰组合文件（无需重启 dsh）。
