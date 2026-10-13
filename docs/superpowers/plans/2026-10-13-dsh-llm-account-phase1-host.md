# dsh-llm-account 第 1 期（宿主侧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可用的 DSH provider 插件 `dsh-llm-account`：一个包、两行装配，保留 `commandcode` 与 `dsh-opencode-go` 两条路由、两个设置命名空间，具备共享的账号库、凭据解析、多账号轮换、模型目录与请求内核。

**Architecture:** 共享内核（`src/core/`，不含任何厂商名字）定义端口与语义；两家厂商各写一个适配器（`src/vendors/<vendor>/`）实现这些端口；插件入口按厂商各导出一份 `{ name, inject, apply, Config }`，由 `cordis.patch.yml` 插入 `llm-commandcode` 与 `opencode-go` 两行。客户端统一页面不在本计划内（计划 1b）。

**Tech Stack:** TypeScript（strict）、Node ≥ 22.19、tsdown 产出 `lib/`、vitest、`@deepseek-ai/schemastery`、宿主 peer 包（`dsh-llm` / `dsh-credentials` / `dsh-settings` / `dsh-typert-protocol` / `dsh-timeout` / `dsh-launch-environment`）。

**Spec:** `docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`

## Global Constraints

- 包名 `dsh-llm-account`；`exports` 必须包含 `./commandcode`、`./opencode`、`./client`、`./package.json`。
- provider 路由 id 固定为 `commandcode` 与 `dsh-opencode-go`，不得更改。
- 设置命名空间固定为 `llm-commandcode` 与 `llm-opencode-go`；profile 行 id 固定为 `llm-commandcode` 与 `opencode-go`。
- `src/core/` 中不得出现 `commandcode`、`opencode` 等厂商字样（类型联合除外）。
- 密钥只进凭据服务；设置文档里只允许出现凭据引用名（`^[A-Za-z_][A-Za-z0-9_]*$`）。
- 请求一旦开始输出（`emitted === true`）或已消耗 token 或调用方已中止，禁止切换账号。
- 额度数据缺失（字段不存在）不得渲染为 0。
- 账号操作必须先写意图日志再提交，崩溃后可重放。
- Node ≥ 22.19；TS `strict: true`；禁止 `any`（`unknown` + 收窄）。
- 所有宿主 peer 包版本范围写成与目标宿主一致的析取，不用 `^`/`>=` 放行未验证版本。

## Review Focus

1. **两个账号共用同一个 API key** —— 用户可能把同一个 key 粘进两个账号槽。期望：状态按账号槽隔离，且同一 key 只在轮换里出现一次，不互相污染额度/失效标记。
2. **请求已开始输出后额度耗尽** —— 期望：报错并说明，绝不静默换账号（否则用户看到半句回复接上半句无关内容）。
3. **凭据库存在但值为空串/纯空白** —— 期望：视为未配置，不允许发出 `Authorization: Bearer ` 空值请求。
4. **额度端点部分字段缺失** —— 期望：缺失显示为「未知」，不倒成 0%，也不整段失败。
5. **设置修订号冲突（并发写账号列表）** —— 期望：重读后重放用户操作，而不是覆盖对方写入。

测试代码里出现的 `okFetch`、`sleep`、`post`、`memoryStore`、`never()`、`fromArray()`、`collect()`、`stallAfterOne()` 等是各任务自带的本地测试辅助：实现者把它们写在同一个测试文件里，不做跨任务共享（除了明显该共享的桩，也不要提前抽公共模块）。

---

### Task 0: 工作区环境与脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `src/index.ts`, `tests/smoke.test.ts`, `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `pnpm build`（产出 `lib/`）、`pnpm test`（vitest）、`pnpm typecheck`；git 仓库已初始化

- [x] **Step 1: 修复工作区文件权限（2026-10-13 已完成）**

已用 `diagnose-windows-sandbox-acl` 技能的那一条脚本命令完成：判定为缺少所有权权限 → 给当前用户补完全控制（`GRANTED=1`，重读验证通过），备份与回滚脚本在 `D:\work\llm-acct-repo-acl-recovery\acl-backup-4d04cebfe3244089a4dd32728fafd16c.json(.ps1)`。修复后沙箱内重跑成功：node 24.19.0、git 2.55.0、pnpm 11.24.0。

Run: `pwsh -Command "pwd; node -v; git --version"`
Expected: 打印工作区路径与版本号，不再出现 `SetNamedSecurityInfoW failed`

- [ ] **Step 2: 初始化项目与依赖**

`package.json` 要点：`"name": "dsh-llm-account"`、`"type": "module"`、`"private": true`（本期不发 npm）、`exports` 按 Global Constraints、脚本 `build`（tsdown）、`typecheck`（tsc --noEmit）、`test`（vitest run）。`exports` 现在就写全（`./commandcode`、`./opencode`、`./client`、`./package.json`），即使入口文件要到 Task 14 才存在 —— 这样 Task 14 只需补 `dsh.bundle.patch` 与入口本身。

Run: `pnpm install --save-dev typescript@6 tsdown vitest @types/node`
Expected: 安装成功，生成 `pnpm-lock.yaml`

- [ ] **Step 3: 写最小可编译入口与冒烟测试**

`src/index.ts` 导出 `export const PACKAGE_NAME = "dsh-llm-account"`。`tests/smoke.test.ts` 断言 `PACKAGE_NAME === "dsh-llm-account"`。

- [ ] **Step 4: 跑通三条命令**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: 三条都成功，`lib/index.js` 存在

- [ ] **Step 5: 初始化 git 并提交**

`.gitignore` 必须包含 `node_modules/`、`lib/`、`*.tsbuildinfo`、`.superpowers/`（最后一项是 SDD 的 ledger 与 brief 目录，属于临时工作区）。

Run: `git init -b work && git add -A && git commit -m "chore: scaffold dsh-llm-account"`
Expected: 默认分支为 `work`（不在 main/master 上实现），首次提交成功且 `git status` 干净

---

### Task 1: 宿主接缝结论（实验已取消，改为记录假设）

**Files:**
- Create: `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md`

**Interfaces:**
- Consumes: Task 0 的脚手架
- Produces: 一份假设清单，供计划 1b 与 Task 14 使用

**背景（用户决定，2026-10-13）**：跳过宿主接缝实验。原因：本机 PATH 上的 `dsh` CLI 是 `0.1.1-rc.2`（旧引擎），而桌面端实际引擎是 `0.2.0-rc.2`（`C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json`），用旧 CLI 建 profile 得出的结论不可信；同时客户端 `apply` 的调用次数只能在真实浏览器里观察。

- [ ] **Step 1: 写下三条假设、各自的依据、以及假设错误的后果**

① 子路径导出（`dsh-llm-account/commandcode`）能被宿主加载器解析 —— 依据 Node 的 `exports` 解析规则；Task 14 Step 2 用 `node -e "import(...)"` 验证。错的话：两行的 `name` 要退回包根 + 参数化的单入口。
② 同一个包插入两行时，客户端 `apply` 会被调用**两次**（每行一次）—— 未验证。因此计划 1b 走**兜底路径**：统一页面不依赖每实例注入的状态，而是直接按命名空间读取两家数据。错的话：页面可以简化（依赖注入的状态），成本是白写了一层数据源适配。
③ `settings.section` 的 `order` 被接受、`hooks` 键被投影成 `use<Key>` props —— 未验证。计划 1b 按旧插件的调用点形状实现（`{ name, id, order, label, locale?, inject }` + `hooks` 映射），并把这一层收在一个薄适配层里，实测后只改那一层。

- [ ] **Step 2: 记录「计划 1c 必须实测」的清单**

真机启动、两条路由是否注册、页面被注册几次、`order` 是否生效、模型目录是否出现在选择器里。

- [ ] **Step 3: 提交**

```bash
git add docs/superpowers/notes/2026-10-13-host-seam-assumptions.md
git commit -m "docs: host seam assumptions (spike skipped)"
```

---

### Task 2: 内核类型与能力声明

**Files:**
- Create: `src/core/adapter.ts`
- Modify: `package.json`（新增宿主 devDependencies）
- Test: `tests/core/adapter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `VendorId`、`FailureKind`、`Rejection`、`AccountView`、`ModelRule`（`{ models: string[]; account: string }`）、`AccountState`（`{ order: string[]; rules: ModelRule[]; pinned: string | null }`）、`VendorCapabilities`、`AccountPort`、`CredentialPort`、`QuotaPort`、`QuotaSnapshot`、`QuotaWindow`、`CatalogPort`、`CatalogEntry`、`LoginPort`、`LoginStatus`、`TransportPort`、`SettingsPort`（`describe(ns)` / `mutate(ns, ops, revision)`）、`VendorAdapter`、`supports(caps, feature)`

- [ ] **Step 0: 安装宿主 devDependencies（后续所有任务都需要）**

本工作区没有宿主包（运行时由 profile 提供），但后续任务要 import `@deepseek-ai/dsh-llm` 等包的类型与基类，否则 `pnpm typecheck` 与单测都跑不起来。装成 **devDependencies**，版本与桌面端引擎 `0.2.0-rc.2` 对齐（已在 npm 上确认存在）：

Run: `pnpm add -D @deepseek-ai/dsh-llm@0.2.0-rc.2 @deepseek-ai/dsh-credentials@0.2.0-rc.2 @deepseek-ai/dsh-settings@0.2.0-rc.2 @deepseek-ai/dsh-typert-protocol@0.2.0-rc.2 @deepseek-ai/dsh-timeout@0.2.0-rc.2 @deepseek-ai/dsh-launch-environment@0.2.0-rc.2 @deepseek-ai/dsh-attachment@0.2.0-rc.2 @deepseek-ai/dsh-web@0.2.0-rc.2 @deepseek-ai/schemastery@3.18.4 @deepseek-ai/cordis@4.0.4`
Expected: 安装成功；`pnpm-lock.yaml` 更新

- [ ] **Step 1: 写失败测试**

```ts
import { supports, type VendorCapabilities } from "../../src/core/adapter";
it("reorder 未声明时判定为不支持", () => {
  const caps = { reorder: false } as VendorCapabilities;
  expect(supports(caps, "reorder")).toBe(false);
});
it("quotaShape 两种取值都合法", () => {
  expect(supports({ quotaShape: "percent" } as VendorCapabilities, "quotaShape")).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/adapter.test.ts`
Expected: FAIL，`supports` 未定义

- [ ] **Step 3: 实现 `src/core/adapter.ts`**

按设计文档 §6.3 落定接口：`FailureKind = "quota" | "rate-limit" | "invalid-credential" | "unavailable" | "server" | "network"`；`Rejection = { kind: FailureKind; resetAt?: number; message: string }`；`VendorCapabilities` 七个字段（`reorder`/`pin`/`browserLogin`/`modelAccountRules`/`quotaShape`/`modelVisibilityWrite`/`automaticSwitch`）；`supports()` 只做能力查询，不做副作用。`VendorAdapter` 里引用宿主 `LlmAdapter` 与 `StreamChunk` 时用 `import type`，值导入留到 Task 9/12。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/adapter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/adapter.ts tests/core/adapter.test.ts package.json pnpm-lock.yaml
git commit -m "feat(core): vendor adapter port types"
```

---

### Task 3: 凭据解析优先级

**Files:**
- Create: `src/core/credentials.ts`
- Test: `tests/core/credentials.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CredentialPort`
- Produces: `pickApiKey(sources: CredentialSources): { key?: string; source?: CredentialSource }`、`CredentialSources`、`CredentialSource`、`normalizeKey(raw: unknown): string | undefined`

- [ ] **Step 1: 写失败测试**

```ts
it("优先级：字面量 > 凭据库 > 环境变量 > auth.json", () => {
  expect(pickApiKey({ literal: "a", stored: "b", environment: "c", authFile: "d" }).source).toBe("literal");
  expect(pickApiKey({ stored: "b", environment: "c" }).source).toBe("stored");
  expect(pickApiKey({ environment: "c" }).source).toBe("environment");
  expect(pickApiKey({ authFile: "d" }).source).toBe("auth-file");
});
it("空串与纯空白视为未配置", () => {
  expect(pickApiKey({ stored: "   ", environment: "c" }).source).toBe("environment");
  expect(pickApiKey({ stored: "" })).toEqual({ key: undefined, source: undefined });
});
it("前后空白被裁剪", () => {
  expect(pickApiKey({ stored: " key " }).key).toBe("key");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/credentials.test.ts`
Expected: FAIL，`pickApiKey` 未定义

- [ ] **Step 3: 实现 `src/core/credentials.ts`**

`normalizeKey` 裁剪空白后判定非空；`pickApiKey` 按 `literal → stored → environment → authFile` 取第一个通过 `normalizeKey` 的值。本条即 Review Focus 第 3 条的落地。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/credentials.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/credentials.ts tests/core/credentials.test.ts
git commit -m "feat(core): credential resolution precedence"
```

---

### Task 4: 账号库不变量

**Files:**
- Create: `src/core/accounts.ts`
- Test: `tests/core/accounts.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `AccountView`、`ModelRule`、`AccountState`
- Produces: `accountRef(vendor: VendorId, label: string): string`、`dedupeByRef(views: AccountView[]): AccountView[]`、`reorder(order: string[], ref: string, toIndex: number): string[]`、`assignModelRule(rules: ModelRule[], models: string[], account: string): ModelRule[]`、`dropAccount(state: AccountState, ref: string): AccountState`

- [ ] **Step 1: 写失败测试**

```ts
it("同一模型只属于一个账号：改派给另一账号后旧规则移除", () => {
  const r1 = assignModelRule([], ["m1"], "acc-a");
  const r2 = assignModelRule(r1, ["m1"], "acc-b");
  expect(r2).toEqual([{ models: ["m1"], account: "acc-b" }]);
});
it("删除账号会同时清掉它的模型规则与当前账号标记", () => {
  const state = { order: ["a", "b"], rules: [{ models: ["m1"], account: "b" }], pinned: "b" };
  const next = dropAccount(state, "b");
  expect(next.order).toEqual(["a"]);
  expect(next.rules).toEqual([]);
  expect(next.pinned).toBeNull();
});
it("排序把 ref 移到目标位置，越界索引被夹紧", () => {
  expect(reorder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  expect(reorder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
});
it("重复 ref 只保留第一个（Review Focus 1：同一 key 不重复参与轮换）", () => {
  const views = [{ ref: "x", label: "1", configured: true, active: true }, { ref: "x", label: "2", configured: true, active: false }];
  expect(dedupeByRef(views)).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/accounts.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/core/accounts.ts`**

`accountRef` 生成 `DSH_LLM_ACCOUNT_<VENDOR>_<LABEL 大写化>`，标签里的非 `[A-Za-z0-9_]` 字符转 `_`，并以哈希短后缀去重。全部函数为纯函数，不做 I/O。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/accounts.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/accounts.ts tests/core/accounts.test.ts
git commit -m "feat(core): account book invariants"
```

---

### Task 5: 轮换引擎

**Files:**
- Create: `src/core/rotation.ts`, `src/core/failures.ts`
- Test: `tests/core/rotation.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `Rejection`/`FailureKind`，Task 4 的 `ModelRule`
- Produces: `class RotationEngine`，方法 `pick({ model, tried }): string | undefined`、`markRejected(ref, rejection): void`、`clearCredentialRejection(ref): void`、`rejections(): ReadonlyMap<string, Rejection>`、`fallbackAllowed({ emitted, totalTokens, aborted }): boolean`；常量 `MAX_TRIED = 16`、`RATE_LIMIT_COOLDOWN_MS = 300_000`

- [ ] **Step 1: 写失败测试**

```ts
it("按模型规则优先选择账号", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [{ models: ["m1"], account: "b" }] });
  expect(e.pick({ model: "m1", tried: new Set() })).toBe("b");
});
it("固定账号优先，但被标记失效后回落到其它账号", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: "b", rules: [] });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("b");
  e.markRejected("b", { kind: "quota", message: "exhausted", resetAt: Date.now() + 60_000 });
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});
it("已尝试过的账号不重复选择；全部试过返回 undefined", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  expect(e.pick({ model: "m", tried: new Set(["a"]) })).toBeUndefined();
});
it("尝试上限为 16", () => {
  expect(MAX_TRIED).toBe(16);
});
it("已输出 / 已消耗 token / 已中止时禁止切换（Review Focus 2）", () => {
  const e = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  expect(e.fallbackAllowed({ emitted: true, totalTokens: 0, aborted: false })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 12, aborted: false })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 0, aborted: true })).toBe(false);
  expect(e.fallbackAllowed({ emitted: false, totalTokens: 0, aborted: false })).toBe(true);
});
it("invalid-credential 在凭据更新后清除标记", () => {
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [] });
  e.markRejected("a", { kind: "invalid-credential", message: "401" });
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  e.clearCredentialRejection("a");
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});
it("rate-limit 冷却 5 分钟后自动恢复", () => {
  let now = 1_000;
  const e = new RotationEngine({ order: ["a"], pinned: null, rules: [], now: () => now });
  e.markRejected("a", { kind: "rate-limit", message: "429" });
  expect(e.pick({ model: "m", tried: new Set() })).toBeUndefined();
  now += RATE_LIMIT_COOLDOWN_MS + 1;
  expect(e.pick({ model: "m", tried: new Set() })).toBe("a");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/rotation.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/core/rotation.ts` 与 `src/core/failures.ts`**

`RotationEngine` 持有 `order`/`pinned`/`rules` 与拒绝表；`pick` 顺序为「规则命中 → 固定 → 顺序第一个未被拒绝且不在 tried 中的账号」；`now` 可注入以便测试。`failures.ts` 只放类型与构造 `Rejection` 的辅助函数，厂商映射表由适配器提供。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/rotation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/rotation.ts src/core/failures.ts tests/core/rotation.test.ts
git commit -m "feat(core): account rotation engine"
```

---

### Task 6: 目录可见性规则

**Files:**
- Create: `src/core/catalog.ts`
- Test: `tests/core/catalog.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CatalogEntry`
- Produces: `isModelVisible(entry: CatalogEntry, visibility: Visibility): boolean`、`selectVisible(entries: CatalogEntry[], visibility: Visibility): CatalogEntry[]`、`normalizeVisibility(raw: unknown): Visibility`（`readVisibility` 只接受布尔值）

- [ ] **Step 1: 写失败测试**

```ts
it("显式布尔覆盖优先于白名单", () => {
  expect(isModelVisible({ id: "m", name: "m", inputModalities: ["text"] }, { visibleModels: ["m"], modelVisibility: { m: false } })).toBe(false);
  expect(isModelVisible({ id: "m", name: "m", inputModalities: ["text"] }, { visibleModels: [], modelVisibility: { m: true } })).toBe(true);
});
it("白名单为空表示显示全部", () => {
  expect(isModelVisible({ id: "m", name: "m", inputModalities: ["text"] }, { visibleModels: [] })).toBe(true);
});
it("非布尔值被忽略", () => {
  expect(normalizeVisibility({ m: "yes" })).toEqual({});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/catalog.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/core/catalog.ts`**

规则与旧 Command Code 插件一致：显式布尔覆盖 > 白名单命中 > 白名单为空即全部。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/catalog.ts tests/core/catalog.test.ts
git commit -m "feat(core): model visibility rules"
```

---

### Task 7: 请求内核（整请求 deadline + 流空闲看门狗）

**Files:**
- Create: `src/core/transport.ts`
- Test: `tests/core/transport.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `TransportPort`
- Produces: `runStream<T>(source: AsyncIterable<T>, budget: StreamBudget, opts?: { signal?: AbortSignal; now?: () => number }): AsyncIterable<T>`、`StreamBudget = { requestTimeoutMs: number; streamIdleTimeoutMs: number }`、错误码常量 `LLM_REQUEST_TIMEOUT`、`LLM_STREAM_IDLE_TIMEOUT`

- [ ] **Step 1: 写失败测试**

```ts
it("整请求超时抛出 LLM_REQUEST_TIMEOUT", async () => {
  await expect(collect(runStream(never(), { requestTimeoutMs: 10, streamIdleTimeoutMs: 1000 }))).rejects.toMatchObject({ code: "LLM_REQUEST_TIMEOUT" });
});
it("流空闲超时抛出 LLM_STREAM_IDLE_TIMEOUT", async () => {
  await expect(collect(runStream(stallAfterOne(), { requestTimeoutMs: 10_000, streamIdleTimeoutMs: 10 }))).rejects.toMatchObject({ code: "LLM_STREAM_IDLE_TIMEOUT" });
});
it("正常流按原顺序透传所有 chunk（含 usage）", async () => {
  const chunks = [{ type: "text-delta" }, { type: "usage" }, { type: "finish" }];
  expect(await collect(runStream(fromArray(chunks), { requestTimeoutMs: 1000, streamIdleTimeoutMs: 1000 }))).toEqual(chunks);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/transport.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/core/transport.ts`**

用真实定时器 + `AbortSignal` 实现；`now` 可注入；每次 yield 前重置空闲计时；结束时清理全部定时器；`aborted` 时抛出 `ABORTED` 而不是超时。`stop` 参数的拒绝由适配器负责（宿主契约）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/transport.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/transport.ts tests/core/transport.test.ts
git commit -m "feat(core): request deadline and idle watchdog"
```

---

### Task 8: 账号操作意图日志与崩溃恢复

**Files:**
- Create: `src/core/recovery.ts`
- Test: `tests/core/recovery.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `type AccountIntentKind = "add" | "remove" | "rename" | "replace-key" | "select" | "move" | "auto-switch"`、`interface AccountIntent { id: string; kind: AccountIntentKind; ref?: string; label?: string; toIndex?: number; value?: boolean; createdAt: number }`、`class IntentLog`，方法 `append(intent): Promise<void>`、`list(): Promise<AccountIntent[]>`、`settle(id: string): Promise<void>`、`replay(apply: (i: AccountIntent) => Promise<"applied" | "rejected" | "unknown">): Promise<ReplayReport>`

- [ ] **Step 1: 写失败测试**

```ts
it("重放后已提交的意图被清除，未提交的保留", async () => {
  const store = memoryStore([{ id: "1", kind: "add", label: "A", createdAt: 1 }, { id: "2", kind: "remove", ref: "r", createdAt: 2 }]);
  const log = new IntentLog(store);
  const report = await log.replay(async (i) => (i.kind === "add" ? "applied" : "unknown"));
  expect(report).toEqual({ applied: 1, rejected: 0, unknown: 1, remaining: 1 });
  expect((await log.list()).map((i) => i.id)).toEqual(["2"]);
});
it("重放最多 4 轮，避免死循环（Review Focus 5：冲突后重放而不是覆盖）", async () => {
  const store = memoryStore([{ id: "1", kind: "add", label: "A", createdAt: 1 }]);
  let calls = 0;
  const report = await new IntentLog(store).replay(async () => { calls += 1; return "unknown"; });
  expect(calls).toBeLessThanOrEqual(4);
  expect(report.remaining).toBe(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/recovery.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/core/recovery.ts`**

`IntentLog` 只依赖注入的 `{ read, write }` 存储端口；`replay` 最多 4 轮；`applied` 的意图从日志移除，`rejected` 直接移除并计入，`unknown` 保留待下次重放。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/recovery.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/recovery.ts tests/core/recovery.test.ts
git commit -m "feat(core): durable account intent log"
```

---

### Task 9: commandcode 适配器 · LlmAdapter、协议、目录与失败映射

**Files:**
- Create: `src/vendors/commandcode/protocol.ts`, `src/vendors/commandcode/failures.ts`, `src/vendors/commandcode/catalog.ts`, `src/vendors/commandcode/adapter.ts`
- Test: `tests/vendors/commandcode.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CatalogPort`/`CatalogEntry`/`TransportPort`/`LlmAdapter`；Task 3 的 `pickApiKey`；Task 5 的 `RotationEngine`/`Rejection`；Task 6 的 `selectVisible`；Task 7 的 `runStream`
- Produces: `classifyCommandCodeFailure(status: number, body: unknown): Rejection | undefined`、`parseCatalog(payload: unknown): CatalogEntry[]`、`catalogRequest(base: string): { url: string; headers: Record<string, string> }`、`createCommandCodeAdapter(deps: CommandCodeAdapterDeps): LlmAdapter`，其中 `CommandCodeAdapterDeps = { config: () => CommandCodeConfig; rotation: RotationEngine; quota: QuotaPort; accounts: AccountPort; fetchImpl: typeof fetch; authFileFallback?: () => Promise<string | undefined> }`

- [ ] **Step 1: 写失败测试**

```ts
it("401 映射为 invalid-credential", () => {
  expect(classifyCommandCodeFailure(401, {})?.kind).toBe("invalid-credential");
});
it("429 带窗口证据时带 resetAt，rate-limit → 冷却", () => {
  const r = classifyCommandCodeFailure(429, { error: { rateLimit: { window: "fiveHour", reset: 1_800_000_000 } } });
  expect(r?.kind).toBe("rate-limit");
  expect(r?.resetAt).toBe(1_800_000_000_000);
});
it("用量耗尽语义（USAGE_EXCEEDED）映射为 unavailable", () => {
  expect(classifyCommandCodeFailure(400, { error: { code: "USAGE_EXCEEDED" } })?.kind).toBe("unavailable");
});
it("目录解析：仅保留有 id 与 name 的行，其余计入 ignored", () => {
  const { entries, ignored } = parseCatalog({ models: [{ id: "m", name: "M" }, { name: "no-id" }] });
  expect(entries.map((e) => e.id)).toEqual(["m"]);
  expect(ignored).toBe(1);
});
it("未输出时遇到额度拒绝会切到下一个账号（Review Focus 2 端到端）", async () => {
  // 假传输：账号 a 抛 429 且未发出任何 chunk，账号 b 正常返回 text-delta + finish
  // 断言：stream() 最终产出 b 的 chunk，且 rotation.markRejected("a", ...) 被调用一次
});
it("已输出后遇到额度拒绝直接报错，不换账号（Review Focus 2 端到端）", async () => {
  // 假传输：账号 a 先 yield text-delta，随后抛 429
  // 断言：stream() 抛出该失败，账号 b 从未被调用
});
it("listModels 应用目录可见性规则", async () => {
  // 目录含 m1/m2，modelVisibility: { m2: false }
  // 断言：listModels() 只返回 m1
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/vendors/commandcode.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现三个模块**

`classifyCommandCodeFailure` 覆盖 401 / 429（含窗口证据，单位为秒需 ×1000，超过 30 天的 reset 丢弃）/ `USAGE_EXCEEDED`、`INSUFFICIENT_CREDITS`、`PREMIUM_CREDITS_EXHAUSTED`、`MODEL_NOT_IN_PLAN` → `unavailable` / 5xx → `server` / 网络异常 → `network`。`parseCatalog` 忽略坏行并计数。协议层的传输选择与回退顺序**逐行对照** `@mars-sea/dsh-commandcode-provider/lib/index.js` 实现。

另外实现 `createCommandCodeAdapter`：`listModels` = 拉目录 → `selectVisible` → 映射为宿主形状；`resolveModel` 带上下文、推理档位与图片能力；`stream` = `rotation.pick({ model, tried })` 选账号 → 收集凭据来源（字面量 / 凭据库 / 环境变量 / auth.json 兜底）交给 `pickApiKey` → 发请求 → 用 `runStream` 包上整请求 deadline 与流空闲看门狗 → 失败时用 `classifyCommandCodeFailure` 得到 `Rejection`，记入轮换引擎，并且**只在 `rotation.fallbackAllowed({ emitted, totalTokens, aborted })` 为真时**换下一个账号，否则把错误抛给宿主。轮换尝试次数达到 `MAX_TRIED` 就停止并把最后一次失败抛出。

还必须实现 `providerRetryPolicy()`：`LLM_REQUEST_TIMEOUT` 与 `LLM_STREAM_IDLE_TIMEOUT` 不在宿主的默认可重试码里，必须把它们（连同 `EMPTY_RESPONSE`/`RATE_LIMIT`/`THROTTLED`/`SERVER`/`TIMEOUT`/`TRANSPORT` 等）列入 `retryableCodes`（控制器裁决 12；依据：设计 §10 要求超时可重试，且这两个码区分整请求超时与流空闲超时，不应退化成宿主的 `TIMEOUT`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/vendors/commandcode.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vendors/commandcode tests/vendors/commandcode.test.ts
git commit -m "feat(commandcode): protocol, catalog and failure mapping"
```

---

### Task 10: commandcode 适配器 · 额度与账号端口

**Files:**
- Create: `src/vendors/commandcode/quota.ts`, `src/vendors/commandcode/accounts.ts`
- Test: `tests/vendors/commandcode-quota.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `QuotaPort`/`AccountPort`/`AccountView`/`SettingsPort`/`CredentialPort`；Task 8 的 `IntentLog`
- Produces: `toQuotaSnapshot(parts: { whoami?: unknown; usage?: unknown; credits?: unknown; subscriptions?: unknown; failures: string[] }): QuotaSnapshot`、`createCommandCodeAccounts(deps: CommandCodeAccountDeps): AccountPort`，其中 `CommandCodeAccountDeps = { settings: SettingsPort; credentials: CredentialPort; intents: IntentLog }`

- [ ] **Step 1: 写失败测试**

```ts
it("窗口缺失时保持 undefined，不倒成 0（Review Focus 4）", () => {
  const snap = toQuotaSnapshot({ credits: { monthlyCredits: 100 }, failures: [] });
  expect(snap.windows).toEqual([]);
});
it("五小时/每周窗口映射为 used/cap/exceeded/resetAt", () => {
  const snap = toQuotaSnapshot({ credits: { fiveHour: { used: 3, cap: 10, exceeded: false, resetAt: "2026-10-13T20:00:00Z" } }, failures: [] });
  expect(snap.windows[0]).toMatchObject({ key: "fiveHour", used: 3, cap: 10, exceeded: false });
});
it("单个端点失败不拖垮整体，失败项进入 failures", () => {
  const snap = toQuotaSnapshot({ credits: { monthlyCredits: 1 }, failures: ["subscriptions"] });
  expect(snap.failures).toEqual(["subscriptions"]);
  expect(snap.windows.length).toBeGreaterThanOrEqual(0);
});
it("账号操作先写意图再提交，提交成功后意图被清除（与 Task 13 同语义，Review Focus 5）", async () => {
  // 注入内存 IntentLog 与假 settings：断言 intents.append 先于 settings.mutate，
  // mutate 成功后 intents.settle 被调用；mutate 抛 SETTINGS_CONFLICT 时重读并重放
});
it("remove 清掉该账号的模型规则并清理凭据", async () => {
  // accounts 含 a/b，modelAccountRules 指向 b；remove("b") 后
  // 断言：accounts 只剩 a、规则里没有 b、credentialCleanupRefs 含 b 的引用
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/vendors/commandcode-quota.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `quota.ts` 与 `accounts.ts`**

额度：`whoami` 拿 `orgId` 后并行拉三个端点，各自 try/catch 记名到 `failures`。账号端口用设置变更实现，每个操作**先 `intents.append` 再 `settings.mutate`，提交成功后 `intents.settle`**（与 Task 13 同语义）：`add` 追加 `accounts[]` 并返回新 ref；`rename` 改 `label`；`replaceKey` 走凭据服务；`remove` 移除条目、清掉其 `modelAccountRules`、写入 `credentialCleanupRefs`、必要时清 `activeAccount`；`select` 写 `activeAccount`（`null` 表示自动）；`move` 不实现（能力声明已关闭）。`mutate` 返回修订号冲突时重读并重放，不覆盖。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/vendors/commandcode-quota.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vendors/commandcode/quota.ts src/vendors/commandcode/accounts.ts tests/vendors/commandcode-quota.test.ts
git commit -m "feat(commandcode): quota normalization and account port"
```

---

### Task 11: commandcode 适配器 · 网页登录

**Files:**
- Create: `src/vendors/commandcode/login.ts`
- Test: `tests/vendors/commandcode-login.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `LoginPort`
- Produces: `createCommandCodeLogin(deps: CommandCodeLoginDeps): LoginPort & { readonly authUrl?: string; readonly startPortDefault: number; readonly portAttemptsDefault: number }`，其中 `CommandCodeLoginDeps = { fetchImpl: typeof fetch; apiBase: string; startPort?: number; portAttempts?: number; timeoutMs?: number; storeKey: (ref: string, key: string) => Promise<void> }`

- [ ] **Step 1: 写失败测试**

```ts
it("state 不匹配的回调被拒绝，且不写入凭据", async () => {
  const stored: string[] = [];
  const login = createCommandCodeLogin({ fetchImpl: okFetch, apiBase: "https://api.example", storeKey: async (r, k) => { stored.push(k); } });
  const { authUrl } = await login.begin();
  const port = Number(new URL(new URL(authUrl).searchParams.get("callback")!).port);
  await post(`http://127.0.0.1:${port}/callback`, { apiKey: "k", state: "wrong", userId: "u", userName: "n", keyName: "x" });
  expect(stored).toEqual([]);
});
it("取消后到达的回调不再写入凭据", async () => {
  /* 同上前提，先 cancel() 再投递正确 state 的回调 */
  expect(stored).toEqual([]);
});
it("默认起始端口 5959，最多尝试 10 个端口", () => {
  const login = createCommandCodeLogin({ fetchImpl: okFetch, apiBase: "https://api.example", storeKey: async () => {} });
  expect(login.startPortDefault).toBe(5959);
  expect(login.portAttemptsDefault).toBe(10);
});
it("超时后状态为 failed 且原因为 timeout", async () => {
  const login = createCommandCodeLogin({ fetchImpl: okFetch, apiBase: "https://api.example", timeoutMs: 20, storeKey: async () => {} });
  await login.begin();
  await sleep(50);
  expect((await login.status()).state).toBe("failed");
  expect((await login.status()).reason).toBe("timeout");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/vendors/commandcode-login.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `src/vendors/commandcode/login.ts`**

回环服务器只绑定 `127.0.0.1`；只接受 `POST /callback`（`OPTIONS` 返回 204、其他 405、404 路径）；请求体上限 10 000 字节；`state` 校验失败返回 403；成功前先用 `whoami` 验证 key；`attemptSeq` 代际守卫确保取消后迟到的结果不落库；12 万 ms 超时。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/vendors/commandcode-login.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vendors/commandcode/login.ts tests/vendors/commandcode-login.test.ts
git commit -m "feat(commandcode): loopback browser login"
```

---

### Task 12: opencode 适配器 · LlmAdapter、协议、目录与失败映射

**Files:**
- Create: `src/vendors/opencode/protocol.ts`, `src/vendors/opencode/failures.ts`, `src/vendors/opencode/catalog.ts`, `src/vendors/opencode/adapter.ts`
- Test: `tests/vendors/opencode.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CatalogPort`/`CatalogEntry`/`TransportPort`/`LlmAdapter`；Task 3 的 `pickApiKey`；Task 5 的 `RotationEngine`/`Rejection`；Task 6 的 `selectVisible`；Task 7 的 `runStream`
- Produces: `classifyGatewayFailure(status: number, body: unknown): Rejection | undefined`、`parseModels(payload: unknown): CatalogEntry[]`、`DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1"`、`createOpencodeAdapter(deps: OpencodeAdapterDeps): LlmAdapter`，其中 `OpencodeAdapterDeps = { config: () => OpencodeConfig; rotation: RotationEngine; quota: QuotaPort; accounts: AccountPort; fetchImpl: typeof fetch }`

- [ ] **Step 1: 写失败测试**

```ts
it("creditserror / userlimiterror / insufficientquota 映射为 quota", () => {
  expect(classifyGatewayFailure(402, { error: { type: "insufficientquota" } })?.kind).toBe("quota");
});
it("autherror / invalidapikey 映射为 invalid-credential", () => {
  expect(classifyGatewayFailure(401, { error: { type: "invalidapikey" } })?.kind).toBe("invalid-credential");
});
it("regionerror / datapolicyerror 映射为 unavailable", () => {
  expect(classifyGatewayFailure(403, { error: { type: "datapolicyerror" } })?.kind).toBe("unavailable");
});
it("目录解析忽略坏行并计数", () => {
  const { entries, ignored } = parseModels({ data: [{ id: "m", name: "M" }, {}] });
  expect(entries).toHaveLength(1);
  expect(ignored).toBe(1);
});
it("未输出时 quota 拒绝切到下一个账号；已输出时报错不切（Review Focus 2 端到端）", async () => {
  // 假传输：账号 a 先后两种情况看本用例的入参；账号 b 正常返回
  // 断言：第一种情况下 b 的 chunk 被产出且 markRejected("a", {kind:"quota"}) 被调用；
  //       第二种情况下 stream() 抛出该失败且账号 b 从未被调用
});
it("已消耗 token 或调用方已中止时同样不切账号", async () => {
  // 断言：fallbackAllowed 语义在适配器里被真正使用（不是只看 emitted）
});
it("listModels 应用 modelVisibility（能力声明为 immediate 的逐模型开关）", async () => {
  // modelVisibility: { m2: false } → listModels() 只返回 m1
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/vendors/opencode.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现三个模块与适配器**

映射表按旧包 `lib/index.js` 里的 `classifyGatewayError` 逐条对照；目录走 `/models`，带请求缓存 TTL 与「仅接受 `opencode.ai` 域」的校验；传输用 pi-ai SDK（构建期内联，别名依赖 `opencode-go-pi-ai`）。

`createOpencodeAdapter` 与 Task 9 同构：`listModels` = 目录 → `selectVisible` → 宿主形状；`resolveModel` 带上下文、推理档位与 `modelLimits` 覆盖；`stream` = `rotation.pick` → 收集凭据来源交给 `pickApiKey` → 经 pi-ai 发出 → `runStream` 包 deadline/idle → 失败时 `classifyGatewayFailure` 记入轮换引擎，只有 `rotation.fallbackAllowed(...)` 为真才换账号。轮换尝试次数达到 `MAX_TRIED` 就停止并把最后一次失败抛出。`providerRetryPolicy()` 同样必须把 `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_IDLE_TIMEOUT` 列入 `retryableCodes`（控制器裁决 12）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/vendors/opencode.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vendors/opencode tests/vendors/opencode.test.ts
git commit -m "feat(opencode): protocol, catalog and failure mapping"
```

---

### Task 13: opencode 适配器 · 额度与账号端口

**Files:**
- Create: `src/vendors/opencode/quota.ts`, `src/vendors/opencode/accounts.ts`
- Test: `tests/vendors/opencode-quota.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `QuotaPort`/`AccountPort`/`SettingsPort`/`CredentialPort`；Task 8 的 `IntentLog`
- Produces: `toQuotaSnapshot(payload: unknown): QuotaSnapshot`、`createOpencodeAccounts(deps: { intents: IntentLog; settings: SettingsPort; credentials: CredentialPort }): AccountPort`、`MAX_ACCOUNTS = 20`

- [ ] **Step 1: 写失败测试**

```ts
it("rolling/weekly/monthly 的 percent 与 resetsAt 被保留；缺失窗口不补 0（Review Focus 4）", () => {
  const snap = toQuotaSnapshot({ usage: { rolling: { status: "ok", percent: 42, resetsAt: "2026-10-13T20:00:00Z" } } });
  expect(snap.windows).toHaveLength(1);
  expect(snap.windows[0]).toMatchObject({ key: "rolling", percent: 42 });
});
it("rate-limited 状态带 exceeded 标记", () => {
  const snap = toQuotaSnapshot({ usage: { weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-14T00:00:00Z" } } });
  expect(snap.windows[0].exceeded).toBe(true);
});
it("账号操作先写意图再提交，提交成功后意图被清除", async () => {
  /* 注入内存 IntentLog 与假 settings；断言 append 先于 mutate，且 settle 后被清除 */
});
it("上限 20 个账号", async () => {
  expect(MAX_ACCOUNTS).toBe(20);
});
it("设置修订号冲突时重读并重放，而不是覆盖对方写入（Review Focus 5）", async () => {
  // 假 settings：第一次 mutate 抛 SETTINGS_CONFLICT 并把 revision 推进到 7
  // 断言：冲突后重新 describe 拿到 revision 7，再用 7 重试；最终两者都在列表里
  expect(mutations.map((m) => m.revision)).toEqual([3, 7]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/vendors/opencode-quota.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `quota.ts` 与 `accounts.ts`**

账号端口实现全部命令：`add`（32 位十六进制 id，重名重试时复用待处理意图）、`remove`、`rename`、`replaceKey`、`select`、`move`、`setAutoSwitch`；每次操作先 `intents.append` 再提交，提交成功后 `intents.settle`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/vendors/opencode-quota.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vendors/opencode/quota.ts src/vendors/opencode/accounts.ts tests/vendors/opencode-quota.test.ts
git commit -m "feat(opencode): quota normalization and account port"
```

---

### Task 14: 两行装配与宿主冒烟

**Files:**
- Create: `src/vendors/commandcode/index.ts`, `src/vendors/opencode/index.ts`, `cordis.patch.yml`, `tests/vendors/assembly.test.ts`, `docs/superpowers/notes/2026-10-13-host-smoke.md`
- Modify: `package.json`（新增 `dsh.bundle.patch` 与 `dsh.client.inject`；`exports` 在 Task 0 已写好）

**Interfaces:**
- Consumes: Task 9–13 的全部适配器（两个 `createXAdapter`）、Task 11 的 `createCommandCodeLogin`、Task 5 的 `RotationEngine`、Task 8 的 `IntentLog`
- Produces: `export const inject = ["llm"]`、`export function apply(ctx, config)`、`export const Config`、`export const PROVIDER_ID`，供宿主按子路径导入；插件实例上挂载构造好的适配器、轮换引擎、意图日志与（仅 commandcode）登录端口

- [ ] **Step 1: 写入口与 patch**

两个入口各导出 `{ name, inject: ["llm"], apply, Config }`。`apply` 里按 config 构造：轮换引擎（顺序 = 账号列表，固定 = `activeAccount`，规则 = `modelAccountRules`）、意图日志（存储接设置文档的隐藏字段）、额度与账号端口；commandcode 另外构造登录端口（`storeKey` 写凭据服务），**本期只构造并挂在插件实例上，远程暴露留给计划 1b**。`cordis.patch.yml` 按设计文档 §5.1 插入 `llm-commandcode`（`dsh-llm-account/commandcode`）与 `opencode-go`（`dsh-llm-account/opencode`）两行。

构建侧的三条硬约束（Task 0 实测得到，别改回去）：① tsdown 的 `entry` 必须是**对象**映射 `{ index, commandcode, opencode, client }` —— 数组形式会产出 `lib/vendors/...`，与 `exports` 的扁平目标（`./lib/commandcode.js` 等）不匹配；② 保持 `fixedExtension: false`，否则 `platform: "node"` 下会强制 `.mjs`；③ `./client` 是给 GUI 加载的**浏览器**产物，不能用当前 `platform: "node"` 的配置构建 —— 本期（宿主侧）可以先不产出它（`exports` 里的声明保留），但计划 1b 必须先补一个浏览器目标的构建配置，否则页面加载不到客户端 bundle。

第四条（控制器裁决 11，来自 Task 7 的实测发现）：**宿主包必须从 devDependencies 提升为 peerDependencies**（析取范围 `0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-alpha.2`，与旧插件一致），devDependencies 保留供本地 typecheck。原因：tsdown 默认只把 `dependencies` + `peerDependencies` 当外部依赖，宿主包留在 devDeps 会被**内联**进 `lib/`；对 `LlmError` 无碍（宿主按自有属性 `code`/`failure` 归类），但 Task 9/12 值导入的 `LlmAdapter` 一旦出现第二份副本，宿主可能用 `instanceof` 判定失败。验收步骤：构建后 **grep `lib/**/*.js` 确认对 `@deepseek-ai/*` 是裸导入而不是内联代码**。

- [ ] **Step 2: 构建并确认导出可解析**

Run: `pnpm build && node -e "import('dsh-llm-account/commandcode').then(m => console.log(Object.keys(m)))"`
Expected: 打印出 `apply`、`Config`、`inject`、`PROVIDER_ID` 等键，无 `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 用假 ctx 冒烟（不启动宿主）**

本机没有与桌面端同版本（`0.2.0-rc.2`）的 `dsh` CLI，所以真机启动留到计划 1c（用户在场时做）。本期用假 ctx 覆盖装配逻辑，新增 `tests/vendors/assembly.test.ts`：

```ts
it("两个入口各注册一次自己的 provider 路由", () => {
  // 假 ctx：记录 ctx.llm.registerAdapter([providerId], adapter) 的调用
  // 断言：commandcode 入口注册 ["commandcode"]，opencode 入口注册 ["dsh-opencode-go"]，各一次
});
it("Config 能解析用户现有的 commandcode 配置形状", () => {
  // { apiKeyEnv: "COMMANDCODE_API_KEY", visibleModels: ["deepseek/deepseek-v4.1-flash"],
  //   modelVisibility: {}, showSidebarQuota: true, accounts: [{ label: "sample-user-2", apiKeyEnv: "COMMANDCODE_API_KEY_2" }],
  //   activeAccount: "default", modelAccountRules: [] }
  // 断言：解析成功且字段值原样保留（零迁移的机器可验证部分）
});
it("Config 能解析用户现有的 opencode 配置形状", () => {
  // { usageDisplay: "always", modelVisibility: { "space-bunny": true }, autoSwitch: true, enabled: false }
  // 断言：解析成功且字段值原样保留
});
```

Run: `pnpm build && node -e "import('dsh-llm-account/commandcode').then(m => console.log(Object.keys(m)))"` 与 `pnpm vitest run tests/vendors/assembly.test.ts`
Expected: 导出键包含 `apply`/`Config`/`inject`/`PROVIDER_ID`，无 `ERR_MODULE_NOT_FOUND`；装配测试全绿

- [ ] **Step 4: 写冒烟记录**

`docs/superpowers/notes/2026-10-13-host-smoke.md` 记录：构建与解析结果、装配测试结果、**以及本期无法验证的部分与理由**（真机启动、真实路由注册、模型目录在选择器里出现、页面注册次数、`order` 是否生效），这些列为计划 1c 的必测项。

- [ ] **Step 5: 提交**

```bash
git add src/vendors/*/index.ts cordis.patch.yml package.json tests/vendors/assembly.test.ts docs/superpowers/notes
git commit -m "feat: two-row bundle assembly and assembly smoke"
```

---

## 计划 1b（待写）

客户端统一页面（单页多厂商、能力降级、额度两种形状、i18n）在 1a 完成后按 **Task 1 记录的兜底路径**写（页面不依赖每实例注入的状态，直接按命名空间读两家数据）：`docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-client.md`。

页面结构按设计文档 §8（用户要求，2026-10-13 追加）：**顶部厂商标签页**（Command Code / OpenCode），标签内沿用 Command Code 设置页的卡片顺序与交互 —— 账户卡片（每账号一行：名称、套餐、状态、5 小时/每周额度条，可展开，行尾 `⋯` 菜单，底部「添加账户」）→ 模型卡片 → 隐私与安全 → 集成与显示 → 高级设置（默认折叠）→ 底部浮动保存条；厂商不支持的卡片不渲染。界面摆放（侧边栏额度卡片、中栏用量面板、输入框下方费用读数）属第 2 期，同样对齐 Command Code。

1b 还必须兑现 `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md` 的两条要求：在 `apply` 里留一个**调试计数或日志**（1c 用它才能区分「`apply` 被调用一次还是两次」）；统一页面上要留出**设置数据通道的验证点**（对应假设 ③ 的后半段）。另外：1b 写 `visibleModels` 前**必须丢弃空串与纯空白条目** —— `normalizeVisibility` 会保留空串，而 `[""]` 是非空白名单，会让所有模型从选择器里消失（Task 6 复核发现的真实风险）。

## 计划 1c（待写）

切换与回退（卸载旧包、安装新包、真机启动验收、手工验收清单、回退演练）在第 1a 与 1b 都完成后写 —— 它需要与桌面端同版本（`0.2.0-rc.2`）的 `dsh` CLI 或用户在 GUI 里配合，因此必须在用户在场时执行。必测项见 Task 1 Step 2 与 Task 14 Step 4 的记录。写 1c 时必须**补上观测手段**：「页面被注册几次 / `apply` 被调用几次」用 DevTools 控制台还是宿主日志记录，并写明用户在 GUI 里怎么配合（这是 Task 1 复核留下的未决项）。

## 1a 结束时明确「改期未做」的项（Task 14 复审判定 + 控制器裁决）

这三项**不是遗漏，是显式改期**，1b/1c 必须继承：

1. **意图日志的重放未接线**：`src/` 里没有任何地方调用 `IntentLog.replay`（`src/core/recovery.ts` 只定义了它）。恢复那半边要新增端口级接口（每个厂商一个 `applyIntent`，供重放回调使用），而本期没有任何真实路径能产生账号变更 —— 账号界面要到 1b 才有。**1b 设计时必须包含**「新增 `applyIntent` + 启动时 `replay`」；**1c 的真机验收必须包含**一次「崩溃后重放」演练。
2. **登录 ref 撞名处置**：`storeKey`（Task 11 产物）目前没有「新 ref 与既有账号的凭据槽撞名时改分配或拒绝」的判定 —— 撞名静默覆盖会毁掉一个账号。1b 接线 `storeKey` 时补上。
3. **`client` 入口的浏览器构建**：`exports` 里声明了 `./client`、`package.json` 里声明了 `dsh.client.inject`，但本期**不产出**该产物（tsdown 是 node 目标）。1b 必须先补浏览器目标构建，否则页面加载不到客户端 bundle。
4. **两行都要 `ctx.settings.configure({ auto: false }, ctx.fiber)`**（最终复核建议）：旧插件正是这么关掉自动生成设置表单的（`@mars-sea/dsh-commandcode-provider` 的 `lib/index.js:10401`）；不做的话，宿主自动生成的设置表单会和统一页面并排出现。这一条原先不在交接清单里。
5. **两处顺手要做的清理**（最终复核建议，均为少数行）：把 `FAILURE_CODES`/`LlmError` 构造与 `hashText` 各自单源化（现在两个厂商各一份）；把「`lib/*.js` 的裸导入必须是已声明 peer 的子集」这条 Ruling 11 验收**自动化**成一条测试或脚本（本期是手工 grep，且复核发现 bundle 注释里也有类似字样，容易误判）。
