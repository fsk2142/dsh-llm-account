# dsh-llm-account 第 1b 期 + 侧边栏卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付客户端三件事 —— 客户端 bundle 的浏览器目标构建、统一设置页（顶部厂商标签页 + Command Code 式卡片）、侧边栏额度卡片与中栏仪表盘（**跟随自动切换后的生效账号**，修正旧插件缺陷）。

**Architecture:** 宿主侧新增「生效账号」概念（轮换引擎记录最近一次选中/成功的 ref 与切换通知），由宿主侧的远程服务发布给客户端；客户端是一个浏览器 bundle，逐字沿用两个旧插件已验证的接缝（`window.__ModuleLoader__.load`、`settings.section`、`hooks`→`use*`、`sidebar.footer.action` + `main` + `layout.selectPanel`、`locale.register/bind`、`remote.credentials/settings`、`<style data-plugin-css>`），用模块级厂商注册表把同一包的两个实例收敛成**一个**设置页。

**Tech Stack:** TypeScript（strict）、React（宿主提供）、`@deepseek-ai/dsh-client-ui-primitives`（`Button`/`Tag`/`Switch`/`Menu`）、tsdown（浏览器目标）、vitest。

**Spec:** `docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`（§8 客户端统一页面、**§8.1 侧边栏卡片与生效账号**、§7.3 能力矩阵、§14 风险）

## Global Constraints

- provider 路由 id 固定为 `commandcode` 与 `dsh-opencode-go`；设置命名空间固定为 `llm-commandcode` 与 `llm-opencode-go`；profile 行 id 固定为 `llm-commandcode` 与 `opencode-go`。
- 客户端 bundle 的 id 必须与包名一致（`window.__ModuleLoader__.load({ id: "dsh-llm-account", … })`），并导出 `{ apply, inject }`。
- 密钥只进凭据服务；客户端**只**通过 `remote.credentials` 读写密钥，绝不从设置文档读明文。
- 界面只用宿主 `--dsw-*` CSS 变量；自带 `<style data-plugin-css>`；不修改宿主 DOM 结构（查看/装饰已存在的节点除外）。
- 侧边栏卡片**默认关闭**；**关闭时不得发起任何后台用量查询**（轮询随卡片生命周期起停）。
- 额度数据缺失不得渲染为 0；`{}`、`undefined`、漂移形状都必须与「真的是 0」区分。
- 写 `visibleModels` 前必须丢弃空串与纯空白条目（`[""]` 是「非空白名单」，会让所有模型消失）。
- Node ≥ 22.19；TS `strict: true`；禁止 `any`（`unknown` + 收窄）。
- `src/core/**`、`src/vendors/**` 的第 1a 期成果已复核：本计划只在明确点名的位置修改它们（Task 2 改 `rotation.ts`，Task 3 改两个 entry 与新增一个远程模块）。

## Review Focus

1. **生效账号的正确性** —— 自动切换发生后，卡片必须显示**实际在服务**的那个账号；固定账号与生效账号不同时两者都要可见，不能让用户以为固定设置没生效。
2. **关闭即静默** —— 卡片关闭时不得有任何后台用量请求（含组件卸载、切换厂商标签、页面隐藏后恢复）。
3. **凭据只写** —— 客户端任何路径都不得把明文密钥写入设置文档或日志。
4. **额度不编造** —— 缺失字段、漂移形状、未知状态都要与 0 区分；空串白名单不得清空模型列表。
5. **接缝假设集中** —— 所有未验证的客户端接缝只出现在 Task 1 与 Task 4 的一个薄层里，1c 实测后只改那一层。

---

### Task 0: 客户端 bundle 的浏览器目标构建

**Files:**
- Create: `src/client/index.ts`, `tests/client/build.test.ts`
- Modify: `tsdown.config.ts`, `package.json`

**Interfaces:**
- Consumes: 第 1a 期的 `package.json`（`exports` 已含 `./client` → `./lib/client.js`、`dsh.client.inject`、`dsh.client.platform: "web"`）
- Produces: 一个能被打包成**浏览器产物**的 `lib/client.js`（包成 `window.__ModuleLoader__.load({ id: "dsh-llm-account", factory })` 并导出 `{ apply, inject }`）

- [ ] **Step 1: 写失败测试**

```ts
it("构建产物是客户端 bundle：调用 __ModuleLoader__.load 且 id 正确", () => {
  // 读 lib/client.js，断言含 __ModuleLoader__.load 且 id 为 "dsh-llm-account"
});
it("客户端入口不导入任何 node 内置模块", () => {
  // 断言 lib/client.js 里没有 from "node:*" / require("node:*
});
```
（测试在 Task 0 里可以先断言"文件不存在"而失败，构建完成后转绿。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/client/build.test.ts`
Expected: FAIL，`lib/client.js` 不存在

- [ ] **Step 3: 加浏览器目标构建**

`tsdown.config.ts` 增加第二个 build：entry 为对象 `{ client: "src/client/index.ts" }`，`platform: "browser"`，`format: "cjs"`（**T0 已实测：loader 注入 `require` 并读 `module.exports`，旧插件产物就是 CJS；计划原先写的 `iife` 是错的，已按实现校正**），外部依赖为宿主提供的 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`（**凡按值导入的宿主客户端包都必须加进这个列表**，见 Ruling 4）。`src/client/index.ts` 先导出最小的 `{ apply, inject }` 骨架，其中 **`inject` 写 cordis 服务名**（`slots`/`locale`/`remote`，用到 `remote.credentials` 就加），**不是** `package.json` 里的 npm 包 id（Ruling 7）。

- [ ] **Step 4: 构建并跑测试**

Run: `pnpm build && pnpm vitest run tests/client/build.test.ts`
Expected: PASS；`lib/client.js` 存在且为浏览器形态

- [ ] **Step 5: 提交**

```bash
git add tsdown.config.ts package.json src/client/index.ts tests/client/build.test.ts
git commit -m "feat(client): browser-target build for the client bundle"
```

---

### Task 1: 客户端插件骨架、厂商注册表与调试计数

**Files:**
- Create: `src/client/registry.ts`, `src/client/shell.ts`, `tests/client/registry.test.ts`
- Modify: `src/client/index.ts`

**Interfaces:**
- Consumes: Task 0 的构建；`docs/superpowers/notes/2026-10-13-host-seam-assumptions.md`（三条假设）
- Produces: `registerVendor(entry)` / `vendors()`（模块级单例注册表）；`apply(clientCtx)`；`applyCount`（**调试计数**，1c 用它区分 `apply` 被调用一次还是两次）

**厂商识别（控制器裁决 2，2026-10-14）**：本包只有**一个** `./client`，两行都会加载它，因此**不要**试图从实例身份判断「这次 `apply` 属于哪家」—— 那是未验证接缝。改为**由设置命名空间发现厂商**：页面读 `remote.settings.describe()`，谁存在（`llm-commandcode` / `llm-opencode-go`）就渲染谁的标签页。这样「`apply` 被调用一次还是两次」这个未决点对功能**完全无关紧要**，只影响调试计数。

- [ ] **Step 1: 写失败测试**

```ts
it("同一包两个实例注册进同一个注册表，且只注册一次设置页", () => {
  // 用假 clientCtx 调 apply 两次（模拟两行），断言 vendors().length === 2 且 settings.section 只注册一次
});
it("apply 计数随每次调用递增（1c 的观测点）", () => {
  // 断言 applyCount === 2
});
it("客户端插件导出 { apply, inject }，inject 含 slots/locale/remote", () => {});
```
（宿主侧接缝（`ctx.slots.register` 等的真实形状）**只**在这一层出现；1c 实测后只改这里。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/client/registry.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现注册表与骨架**

模块级单例注册表（同一份 bundle = 同一个模块实例，两个插件实例共享它）；`apply` 每次把自己的厂商数据写进注册表并递增计数；**只有第一个**实例注册那唯一一个 `settings.section`（id `llm-account`、order 12），并用 Task 1 的接缝假设文档里记录的 call-site 形状（`{ name, id, order, label, locale, inject }` + `hooks` 映射）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/client/registry.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/client tests/client
git commit -m "feat(client): plugin skeleton, module-level vendor registry and apply counter"
```

---

### Task 2: 生效账号（内核）与切换通知

**Files:**
- Modify: `src/core/rotation.ts`, `tests/core/rotation.test.ts`
**Interfaces:**
- Consumes: 现有 `RotationEngine`
- Produces: `noteSelected(ref)` / `noteSettled(ref)` / `effectiveAccount(): { ref: string; at: number } | undefined`、`switchNotice(): { fromRef: string; toRef: string; reason: "quota" | "rate-limit" | "invalid-credential" | "manual"; at: number } | undefined`、`noteManualSwitch(ref)`

- [ ] **Step 1: 写失败测试**

```ts
it("第一次选中即成为生效账号", () => {});
it("额度拒绝后切到另一个账号：生效账号随之改变，并产生切换通知（谁→谁、原因、时间）", () => {});
it("成功完成请求后生效账号更新为最近成功者", () => {});
it("手动切换产生原因为 manual 的切换通知", () => {});
it("没有任何请求时生效账号为 undefined（不编造）", () => {});
```
（这就是 §8.1 第 1 条的落地：生效账号 = 最近一次真正被选中去发请求的 ref；成功后更新为最近成功者。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/core/rotation.test.ts`
Expected: FAIL，新方法未定义

- [ ] **Step 3: 实现**

只加状态与方法，**不改** `pick` 的既有语义（选择顺序、拒绝表、`fallbackAllowed` 全部不动）；`now` 继续可注入。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/core/rotation.test.ts`
Expected: PASS（既有 19 条不得回归）

- [ ] **Step 5: 提交**

```bash
git add src/core/rotation.ts tests/core/rotation.test.ts
git commit -m "feat(core): effective account and switch notice"
```

---

### Task 3: 宿主侧发布「生效账号 / 切换通知 / 每账号额度」

**Files:**
- Create: `src/vendors/usage-remote.ts`
- Modify: `src/vendors/commandcode/index.ts`, `src/vendors/opencode/index.ts`, `src/vendors/commandcode/adapter.ts`, `src/vendors/opencode/adapter.ts`（**只**加「请求成功后回报成功账号」的调用）
- Test: `tests/vendors/usage-remote.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `effectiveAccount()` / `switchNotice()`；两个厂商的 `QuotaPort`；`TypertRemoteService`
- Produces: 一个远程命名空间（例如 `llmAccountUsage`），方法：`status()`（生效账号 + 是否固定 + 每账号额度摘要）、`accounts()`、`switches()`（切换记录，含厂商）

- [ ] **Step 1: 写失败测试**：`status()` 返回生效账号与固定账号两个字段；无请求时生效账号缺省；切换记录按时间倒序；额度缺失字段不进摘要。
- [ ] **Step 2: 运行测试确认失败**：`pnpm vitest run tests/vendors/usage-remote.test.ts` → FAIL
- [ ] **Step 3: 实现**：远程服务 + 两个 entry 注册它；适配器在请求**成功**后调用 `rotation.noteSettled(ref)`（失败/未输出后的轮换由 Task 2 的 `noteSelected` 覆盖）。**同时**在两个 entry 的 `apply` 里调用 `ctx.settings.configure({ auto: false }, ctx.fiber)`（第 1a 期交接项：旧 Command Code 插件正是这么关掉宿主自动生成的设置表单的，不做的话自动表单会和我们的统一页面并排出现）。
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: 提交**：`feat(host): publish effective account, switch notices and per-account quota`

---

### Task 4: 客户端薄层（接缝适配）+ 设置页外壳

**Files:**
- Create: `src/client/seams.ts`, `src/client/page.tsx`, `src/client/copy.ts`, `tests/client/page.test.ts`
- Modify: `src/client/index.ts`

**Interfaces:**
- Consumes: Task 1 的注册表、Task 3 的远程
- Produces: `PageShell`（标题/简介/厂商标签页/底部保存条/高级折叠）；**通用字段卡片**（数据驱动地渲染厂商声明的三组：隐私与安全 / 集成与显示 / 高级设置 —— 每组只列字段与文案，具体字段由各厂商注册表提供；侧边栏卡片的开关就住在「集成与显示」里，T8 依赖它）；`seams.ts` 收拢所有未验证接缝（插槽注册、`hooks` 映射、`layout.selectPanel`、`remote.*` 读取、`credentials/reference-updated` 订阅）；i18n 命名空间 `settings.llm-account`（zh/en）

- [ ] **Step 1: 写失败测试**：标签页只渲染已注册厂商；切换标签不丢草稿；文案跟随语言；保存条只在有改动时出现；**三组通用字段卡片按厂商声明渲染，厂商未声明的组不出现**；**「集成与显示」里的侧边栏卡片开关默认关闭**；凭据变更推送到达时「已配置」徽标刷新（订阅 `credentials/reference-updated`，与两个旧插件一致）。
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现**：用旧插件已编译 bundle 里的 call-site 形状逐字对齐（`ctx.locale.register/bind`、`ctx.slots.inject(name, () => ctx.slots.register({...}, Component))`）；所有不确定的接缝集中在 `seams.ts`。
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: 提交**：`feat(client): page shell, vendor tabs and the seam adapter layer`

---

### Task 5: Command Code 账户卡片

**Files:**
- Create: `src/client/account-card.tsx`, `tests/client/account-card.test.ts`

**Interfaces:**
- Consumes: Task 3 的额度摘要、Task 4 的外壳、`remote.credentials`（只写密钥）
- Produces: 账号行（名称/套餐/状态/5 小时·每周额度条/展开报告/`⋯` 菜单：重命名·更换密钥·固定使用此账户·移除）、底部「添加账户」、网页登录入口

- [ ] **Step 1: 写失败测试**：额度缺失不渲染成 0；`⋯` 菜单项按能力降级（无排序能力时不显示手柄）；密钥输入只调用 `credentials.set`，不出现在任何设置写入。
- [ ] **Step 2–5**: 跑失败 → 实现 → 跑通过 → `git commit -m "feat(client): command code account card"`
- [ ] **Step 6: 补一条验收断言**：固定账号与生效账号不同时，两个都标注（§8.1 第 4 条）。

- [ ] **Step 7: 接线网页登录并处理 ref 撞名（第 1a 期交接项）**：登录成功后把结果交给 `storeKey` 时，必须先检查该 ref 是否已被**另一个**账号占用：占用则改分配一个新的 ref 或拒绝并提示，**不得静默覆盖**别人的凭据槽。补一条测试：目标 ref 已属于另一个账号时，不写凭据且给出可读错误。

---

### Task 6: OpenCode 账户卡片（含排序与 autoSwitch）

**Files:**
- Create: `src/client/opencode-account-card.tsx`, `tests/client/opencode-account-card.test.ts`

- [ ] **Step 1: 写失败测试**：拖动排序调用 `move`（能力支持时）；`autoSwitch` 开关立即生效；`rename` 不改 ref（用假远程断言调用参数）。
- [ ] **Step 2–5**: 跑失败 → 实现 → 通过 → `git commit -m "feat(client): opencode account card with ordering and auto-switch"`

---

### Task 7: 模型卡片（可见性与白名单）

**Files:**
- Create: `src/client/models-card.tsx`, `tests/client/models-card.test.ts`

- [ ] **Step 1: 写失败测试**：写 `visibleModels` 前丢弃空串与纯空白；按 `modelVisibilityWrite` 能力区分「保存后生效」与「立即生效」；厂商不支持的卡片不渲染。
- [ ] **Step 2–5**: 跑失败 → 实现 → 通过 → `git commit -m "feat(client): models card with visibility and allowlist"`

---

### Task 8: 侧边栏额度卡片（跟随生效账号）

**Files:**
- Create: `src/client/sidebar-card.tsx`, `tests/client/sidebar-card.test.ts`
- Modify: `src/client/index.ts`（注册 `sidebar.footer.action` 插槽，默认**不**注册/不渲染）

**Interfaces:**
- Consumes: Task 3 的 `status()`/`switches()`
- Produces: 侧边栏卡片（套餐 + 当前窗口额度 + 切换提示 + 「固定：A / 当前：B」）；默认关闭；关闭时**零**后台查询

- [ ] **Step 1: 写失败测试**

```ts
it("默认关闭时不注册卡片、且不发出任何用量请求", () => {});
it("开启后显示生效账号的额度", () => {});
it("生效账号与固定账号不同时，顶部显示切换提示（谁→谁、原因、时间），并同时标注两个账号", () => {});
it("没有请求过时显示占位而不是 0%", () => {});
it("关闭开关会停止轮询（卸载后不再有请求）", () => {});
```
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现**：轮询生命周期与卡片挂载绑定（卸载即停）；`visibilitychange` 恢复时只在开启状态刷新。
- [ ] **Step 4: 通过**
- [ ] **Step 5: 提交**：`feat(client): sidebar quota card following the effective account`

---

### Task 9: 中栏仪表盘

**Files:**
- Create: `src/client/dashboard.tsx`, `tests/client/dashboard.test.ts`
- Modify: `src/client/index.ts`（注册 `main` 插槽 + `layout.selectPanel` 打开）

- [ ] **Step 1: 写失败测试**：逐账号列出额度与状态；生效账号高亮；切换记录按时间倒序；未知字段显示为「未知」。
- [ ] **Step 2–5**: 跑失败 → 实现 → 通过 → `git commit -m "feat(client): center-column quota dashboard with switch history"`

---

### Task 10: 装配、构建与假客户端冒烟

**Files:**
- Create: `docs/superpowers/notes/2026-10-14-client-smoke.md`
- Modify: `package.json`（若需要）、`docs/superpowers/notes/2026-10-13-host-smoke.md`（更新 1c 必测项）

- [ ] **Step 1: 全量验证**：`pnpm typecheck && pnpm test && pnpm build`；断言 `lib/client.js` 为浏览器形态、`lib/*.js` 仍保持宿主包裸导入。
- [ ] **Step 2: 假客户端 ctx 冒烟**：用假 ctx 跑 `apply`，断言设置页注册一次、侧边栏插槽在关闭时不注册、`main` 面板可被 `layout.selectPanel` 打开。
- [ ] **Step 3: 写客户端冒烟记录**：列出**无法在本地验证**的项（真实宿主的插槽 DOM 契约、`hooks`→`use*` 投影、`order` 生效、两行时 `apply` 的真实调用次数、`sidebar.footer.action` 与 `main` 的真实渲染位置），并映射到 1c 的验收清单。
- [ ] **Step 4: 提交**：`feat(client): assembly, build verification and client smoke note`

---

## 计划 1c（真机验收）

> 2026-10-15 补写。入口清单**不在这里重抄**：宿主侧 8 项见
> `docs/superpowers/notes/2026-10-13-host-smoke.md` §5，客户端侧 C1–C18 见
> `docs/superpowers/notes/2026-10-14-client-smoke.md` §3，接缝假设的判定点见
> `docs/superpowers/notes/2026-10-13-host-seam-assumptions.md` §4。
> 本节只写**怎么做、按什么顺序、出现偏差改哪里**。

### 前置条件（缺一不可）

1. **与桌面端同版本的引擎**：本机 PATH 上的 `dsh` 是 `0.1.1-rc.2`，桌面端是 `0.2.0-rc.2` —— 用旧引擎得到的结论不可信（host-seam-assumptions §1）。需要用户在 GUI 里配合，或提供同版本 CLI。
2. **用户在场**：真机验收包含GUI 观察（设置页落位、侧边栏卡片、DevTools 网络面板）与一次崩溃重放演练。
3. **互斥切换**（规格 §13）：先 `safety_snapshot` 快照当前组合 → 从 profile 依赖里**移除两个旧插件**（`@mars-sea/dsh-commandcode-provider`、`dsh-opencode-go`；并存会插相同的行 id）→ 以 `file:C:/Work/dsh-llm-account` 形式装入本包 → 重启。**回退路径**：恢复快照 + 重装两个旧包（设置命名空间未变，账号与配置一直都在）。
4. **先构建**：`pnpm build`（`lib/` 被 gitignore，宿主加载的是磁盘产物）。

### 建议动作顺序

| 步 | 动作 | 看什么 | 对应清单 |
| --- | --- | --- | --- |
| 1 | 启动桌面端 | 正常起来；控制台出现 `[dsh-llm-account] client bundle loaded`；无重复注册行 id 的报错 | host §5-1/7、C1 |
| 2 | 打开模型选择器 | `commandcode` 与 `dsh-opencode-go` 两条路由都在（用户现有的 opencode 行是 `enabled: false`，其路由**不应**出现 —— 这正是它的既有状态） | host §5-2/3、假设 ① 的宿主一侧 |
| 3 | 打开设置 | 统一页面（id `llm-account`）恰好一个、落在 order 12 的位置；两个厂商标签页都在（opencode 的标签页依赖行 id 发现，Ruling 25） | C3、假设 ③、host §5-4/5 |
| 4 | 读控制台的 `applyCount` / 日志次数 | 直接证据：`apply` 被调用几次（假设 ②；页面数量只是间接证据） | C2、host §5-8 |
| 5 | 逐标签页读设置字段 | 两家的字段都能读出并渲染（走 `remote.settings.describe()`，不是 hooks 投影） | C9、host §5-6、假设 ③ 后半段 |
| 6 | **改一个字段并保存**（先 commandcode，再 opencode） | 保存后重新打开页面值已变；**opencode 的保存必须落盘** —— 它写的是行 id `opencode-go` 而不是命名空间（Ruling 45，本机无法验证宿主按条目 id 寻址，这是最可能失败的一处）；失败时保存条应显示可读原因而不是静默 | C10、host §5-6、Ruling 46 |
| 7 | 动一次账号（改密钥 / 固定 / 排序 / autoSwitch / 增删） | 每个操作后页面数字/顺序确实变化；**设置文档里没有明文密钥** | C10 |
| 8 | 打满一个账号的额度（或临时把额度端点配成失败） | 侧边栏卡片主体与顶部提示指向**新的**生效账号；固定与生效并列标注 | C12、规格 §8.1 |
| 9 | 关掉侧边栏开关，看 DevTools 网络面板 | 关闭后**零**用量请求（卡片渲染 null、定时器停）；再开启才有、且只按 60s 间隔出现 | C13、Ruling 43 |
| 10 | 切走浏览器标签页再回来 | 开启时有且仅有一次刷新；关闭时没有 | C14 |
| 11 | 外部改一次开关（改 profile patch 文件后触发宿主重载，或让另一工具写设置） | 卡片跟随（`settings/document-updated` 镜像）；事件不发也不崩（降级 = 重启后冷启动兜底） | 本次新增 |
| 12 | 登录撞名（T5 Step 7 的场景） | 撞名时页面显示「该凭据槽已被另一个账号占用」，宿主侧凭据未被覆盖 | C11 |
| 13 | `IntentLog.replay` 崩溃重放演练 | 在一次账号操作中途杀掉宿主进程，重启后未决意图被重放且不重复应用（spec §6.4.5） | 1b 显式未做项 |
| 14 | 语言切换 | 页面文案跟随（`locale.register(ns,{zh,en})` 载荷形状；为空则改三参式） | C7 |
| 15 | 残余观察项 | 排序交互形态（按钮 vs 拖动）、窄侧栏呈现、两家同开、模型目录来源（手动 id vs 实时目录） | C15–C18 |

### 改动纪律

- 未验证接缝只在**四个薄层**里：宿主侧 `src/vendors/assembly.ts` 与两个 entry；客户端侧 `src/client/shell.ts` 与 `src/client/seams.ts`（本次修复新增的共享状态也都在 `seams.ts` 内）。实测要改形状时只改那几处，别扩散。
- 每个偏差都要**记裁决**（ledger 追加 Ruling 48+）再改代码；改完全量复跑 `pnpm build && pnpm typecheck && pnpm test`。
- 若某条假设被证伪（例如宿主不按条目 id 寻址、`settings/document-updated` 不存在），按各条「假设错误的后果」处理 —— 那些后果都已写进接缝假设文档与本次 ledger。
- 已知缺口（进程内覆盖不到，由本计划覆盖）：`onSave` 失败落账的**容器接线**（纯函数有单测、wiring 没有，见 ledger 2026-10-15 节的变异报告）。
