# Task 0 Report — 工作区环境与脚手架

- 任务：`docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md` Task 0（brief：`.superpowers/sdd/2026-10-13-dsh-llm-account-phase1-host/task-0-brief.md`）
- 工作目录：`D:\work\llm-acct-repo`
- 完成时间：2026-10-13 17:53 (+08:00)
- 状态：DONE_WITH_CONCERNS（唯一 concern 是工作树里有一份**控制器自己**的 plan 修订未提交，见「问题与顾虑 1」）

## 1. 实现内容

严格按 brief 的 Files 清单，只创建这 7 个文件（外加 pnpm 生成的锁文件）：

| 文件 | 内容 |
| --- | --- |
| `package.json` | `name: dsh-llm-account`、`private: true`、`type: module`、完整 `exports`（`.`、`./commandcode`、`./opencode`、`./client`、`./package.json`，每条带 `types` 条件）、`scripts`（`build`=tsdown、`typecheck`=tsc --noEmit、`test`=vitest run）、`engines.node = >=22.19.0`、devDependencies |
| `tsconfig.json` | `strict: true`、`noEmit: true`、`module: preserve` + `moduleResolution: bundler`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters`、`include: src/tests/两个 config` |
| `tsdown.config.ts` | `entry: ["src/index.ts"]`（本期**只**这一个入口）、`outDir: lib`、`format: esm`、`platform: node`、`target: node22`、`dts: true`、`clean: true`、**`fixedExtension: false`** |
| `vitest.config.ts` | `environment: node`、`include: ["tests/**/*.test.ts"]` |
| `src/index.ts` | `export const PACKAGE_NAME = "dsh-llm-account";`（一行，无多余内容） |
| `tests/smoke.test.ts` | 断言 `PACKAGE_NAME === "dsh-llm-account"`，直接导入真实源码，无 mock |
| `.gitignore` | 恰好四条：`node_modules/`、`lib/`、`*.tsbuildinfo`、`.superpowers/` |

依赖安装按 brief 原命令执行：`pnpm install --save-dev typescript@6 tsdown vitest @types/node`，解析为
`@types/node ^26.6.5`、`tsdown ^0.23.1`、`typescript ^6.0.3`、`vitest ^5.0.4`，生成 `pnpm-lock.yaml`。

本任务**未**创建 `src/core/`、`src/vendors/`、`src/client/`、`cordis.patch.yml`，未安装任何 `@deepseek-ai/*` 宿主包，未改动任何本任务之外的文件。

### 1.1 两个关键实现决策（后续任务需要知道）

1. **`fixedExtension: false` 是必须的。** tsdown 0.23.1 的 `fixedExtension` 默认为 `platform === "node"`，即 `true`，此时 ESM 产物被强制命名为 `.mjs`。第一次 `pnpm build` 实际产出的是 `lib/index.mjs` + `lib/index.d.mts`，**不满足 brief Step 4 的 “`lib/index.js` 存在”**。显式设 `fixedExtension: false` 后（包自身 `type: module`）产物变为 `lib/index.js` + `lib/index.d.ts`。这一点已写入 `tsdown.config.ts` 注释。
2. **`exports` 的目标路径选了扁平命名**：`./commandcode` → `./lib/commandcode.js`、`./opencode` → `./lib/opencode.js`、`./client` → `./lib/client.js`（`types` 指向同名 `.d.ts`）。理由是与设计文档 §6.1 “与 `@mars-sea/dsh-commandcode-provider` 一致”对齐 —— 旧包的 `./client` 正是 `./lib/client.js`。
   **对 Task 14 的约束**：要产出这些文件名，Task 14 必须把 `tsdown.config.ts` 的 `entry` 从数组改成对象映射，例如
   `{ index: "src/index.ts", commandcode: "src/vendors/commandcode/index.ts", opencode: "src/vendors/opencode/index.ts", client: "src/client/index.ts" }`；
   若改用 `entry: ["src/index.ts", "src/vendors/commandcode/index.ts", ...]` 数组形式，产物会变成 `lib/vendors/commandcode/index.js`，与本期写下的 `exports` 不匹配（届时须同时改 `exports`）。这一点写进了 `tsdown.config.ts` 的注释，并在第 6 节列为顾虑。
   另：本包 `exports` 存在，因此**包内自引用**可解析 —— 已验证 `node -e "import('dsh-llm-account')"` → `["PACKAGE_NAME"]`，Task 14 Step 2 的 `import('dsh-llm-account/commandcode')` 走同一条解析路径。

## 2. 测试与验证结果

全部在 `D:\work\llm-acct-repo` 下执行。

| 命令 | 结果 |
| --- | --- |
| `pwsh -Command "pwd; node -v; git --version"`（Step 1 复核） | `D:\work\llm-acct-repo` / `v24.19.0` / `git version 2.55.0.windows.3`；`pnpm -v` → `11.24.0`；无 `SetNamedSecurityInfoW failed` |
| `pnpm install --save-dev typescript@6 tsdown vitest @types/node` | 退出 0，`+ @types/node 26.6.5 / tsdown 0.23.1 / typescript 6.0.3 / vitest 5.0.4`，生成 `pnpm-lock.yaml` |
| `pnpm typecheck` | 退出 0，无任何诊断输出 |
| `pnpm test` | `Test Files 1 passed (1)` / `Tests 1 passed (1)` |
| `pnpm build` | 退出 0，`lib\index.js 0.10 kB`、`lib\index.d.ts 0.09 kB` |
| `pnpm build && node -e "import('dsh-llm-account')..."`（自加） | `OK ["PACKAGE_NAME"] dsh-llm-account`，退出 0 |
| `pnpm install --frozen-lockfile`（自加） | `Already up to date`，退出 0 —— 锁文件与 `package.json` 自洽 |
| `git check-ignore -v .superpowers/progress.md node_modules lib/index.js`（自加） | 三者分别命中 `.gitignore` 第 4/1/2 行，确认忽略生效 |

输出干净：tsc、vitest、tsdown 均无 warning/error；tsdown 只有 `ℹ` 级别的正常日志。（唯一的字节级噪音是 git 在 `git add` 时对文本文件的 CRLF 提示，见第 6 节。）

## 3. TDD 证据（真实观察到的红→绿）

本任务的「行为」就是冒烟测试本身，按 brief 的 Step 3 顺序执行：先写 `tests/smoke.test.ts`，再看它失败，最后写实现。

**RED — 命令**：`pnpm vitest run tests/smoke.test.ts`（此时 `src/index.ts` 尚不存在）

```
 ❯ tests/smoke.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/smoke.test.ts [ tests/smoke.test.ts ]
Error: Cannot find module '../src/index' imported from C:/Work/dsh-llm-account/tests/smoke.test.ts
 ❯ tests/smoke.test.ts:3:1
      1| import { expect, test } from "vitest";
      2|
      3| import { PACKAGE_NAME } from "../src/index";
       | ^
 Test Files  1 failed (1)
      Tests  no tests
EXIT=1
```

失败原因是**功能缺失**（模块不存在），不是笔误或环境问题 —— 符合 RED 的要求。

**GREEN — 命令**：写入最小实现 `src/index.ts`（单行导出）后，`pnpm vitest run tests/smoke.test.ts`

```
 RUN  v5.0.4 C:/Work/dsh-llm-account

 ✓ tests/smoke.test.ts (1 test) 2ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
EXIT=0
```

**提交前全量**（Step 4 原命令）：`pnpm typecheck && pnpm test && pnpm build` → `CHAIN_EXIT=0`，`lib/index.js` 存在（`Test-Path` → `True`）。

## 4. 变更文件

首次提交 `609a477`，共 10 files changed，2272 insertions(+)：

```
.gitignore                                                     |   4 +
docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md | 852 +++  （已存在于工作区，非本任务创作）
docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md    | 327 +++  （已存在于工作区，非本任务创作）
package.json                                                   |  42 +
pnpm-lock.yaml                                                 | 992 +
src/index.ts                                                   |   1 +
tests/smoke.test.ts                                            |   7 +
tsconfig.json                                                  |  21 +
tsdown.config.ts                                               |  18 +
vitest.config.ts                                               |   8 +
```

> 说明：两份 docs 是本任务开始前工作区里仅有的未跟踪文件，按 Step 5 的 `git add -A` 一并进入首次提交（brief 未要求排除它们）。

## 5. 自审结果

- **完整性**：brief Files 清单 7 项逐一比对，全部创建，无缺项；未创建清单外文件；`src/core`、`src/vendors`、`src/client`、`cordis.patch.yml` 均未创建（步 1 的额外说明）。
- **Global Constraints**：`exports` 四条子路径齐全 ✔；包名正确 ✔；未触碰 provider id／设置命名空间／profile 行 id（本任务不涉及）✔；`tsconfig` 为 `strict: true` 且未引入 `any`（本任务无类型代码）✔；未安装宿主 peer 包 ✔。
- **纪律（YAGNI）**：`src/index.ts` 只有 brief 指定的那一行导出，没有提前写 `apply`/`Config`/`inject`，没有为缺失入口造空文件，没有提前装 `@deepseek-ai/*`，没有引入 eslint/prettier/CI 等 brief 未列工具。
- **命名与结构**：每个文件单一用途；`tsdown.config.ts` 里用注释（而非文档散落）记录了「vendor/client 入口由 Task 14 加入」和 `fixedExtension` 的原因。
- **测试诚实性**：测试断言的是真实模块导出的常量，被测代码就是实现本身；先观察到与预期一致的失败原因，再写实现。测试文件名与断言描述清晰。
- **输出洁净**：三条命令零警告；`lib/` 内只有预期两个产物。

## 6. 问题与顾虑

1. **工作树不干净，原因是控制器的并发编辑（不是我做的）。** `git status --short` 显示
   ` M docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md`。
   证据：该文件 `LastWriteTime = 17:51:49`，而我的提交时间是 `17:51:46`、`git add -A` 更早（17:51:3x）——即 Plan 文件是在我暂存之后被改写的；`git diff` 内容全是 Task 14（改为假 ctx 的 `tests/vendors/assembly.test.ts` 装配测试）与计划 1b/1c 的说明，**完全不涉及 Task 0**，且与我的任何写入无关。我刻意**没有**提交它（避免把他人进行中的编辑记入本任务提交，也避免 amend 掉提交时间线）。文件哈希在 4 秒内保持不变，看起来已写完。**请控制器自行 `git add` + 提交（或 amend 首次提交）**；如需我代提交请明确指示。
2. **`exports` 目标路径与 Task 14 的 tsdown entry 形式强耦合。** 我已选定扁平的 `lib/commandcode.js` / `lib/opencode.js` / `lib/client.js`（对齐旧包 `lib/client.js` 约定），Task 14 必须用对象形式 `entry` 映射才能一致；否则需要同时改 `exports`。这不是缺陷，但是后续任务的硬约束，已写入 `tsdown.config.ts` 注释。
3. **tsconfig 比 Global Constraints 更严一点。** 除 `strict: true` 外我加了 `noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。目的是让后续 14 个任务不留死代码／隐式 any 风格的导入。若后续任务感到过严，可在某个后续任务里放宽并说明（本任务只有一行实现，不受影响）。
4. **`@types/node` 解析到 `^26.6.5`，本机运行时是 Node 24.19.0。** 这是 brief 给出的安装命令（`@types/node` 不锁版本）的自然结果。本期无影响；若后续任务要用 Node 24 才有的类型行为，建议显式钉到 `@types/node@24`。
5. **CRLF 提示（环境，非代码问题）。** 本机 `core.autocrlf=true`，`git add` 对 10 个文本文件打印 “LF will be replaced by CRLF”。不影响内容与构建。我没有添加 `.gitattributes`，因为 brief 的文件清单里没有它、且那会改动全仓换行策略 —— 如需消除该提示，请把它作为独立变更处理。
6. **本任务无法验证的部分**（与 Task 14/1c 相关，不是本任务的缺口）：`./commandcode`、`./opencode`、`./client` 三个子路径目前按设计**不可解析**（目标文件要到 Task 14 才存在）。本期只验证了根子路径 `.` 的自引用解析。真机 `dsh` 启动验证本机也确实做不了（控制器已在修订后的 Task 14 Step 3 里改为假 ctx 装配测试）。

## 7. 提交与分支

- 分支：`work`（`git branch --show-current` → `work`），无 main/master 提交。
- 提交信息与 brief 一致：`chore: scaffold dsh-llm-account`。
- `git log --oneline` 原始输出：

```
609a477 chore: scaffold dsh-llm-account
```

- 短 SHA：`609a477`；完整 SHA：`609a4776290041016c267144bc24abf1f52e2047`。
