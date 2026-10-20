# 独立代码审查报告（2026-10-20 深夜）

- 仓库：`<repo>`
- 审查 HEAD：`708f84e`（`fix: 图片引用要传完整 ref…`），远端已同步，工作树干净
- 触发：用户要求「重新完整审查一次，忘掉你之前的审查结果」
- 纪律：**只读** —— 未改代码、未提交、未推送、未碰文档结构
- 方法：不带既有结论重新测绘（构建配置 → 四个宿主入口 → core → 三家适配器 → 客户端 → 交叉验证）

## 基线

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 错 |
| vitest 全量 | **111 文件 / 1283 例全绿** |
| git 状态 | 工作树干净，未推送 0（与远端一致） |

审查期间仓库新增 3 个提交（opendesign 图片支持、stop 序列透传、图片 ref 修复），属本轮首次覆盖的新代码。

## 结论

**没有高 / 中危功能 bug。** 3 个发现全部集中在「边界与并发纪律」，其中 1 个是本轮唯一的实质缺陷（LOW–MEDIUM），另 2 个分别不可达（LOW）与纯可读性（INFO）。

---

## 发现 1 · 同一行的第二次写入被静默丢弃 — LOW–MEDIUM

**位置**：`src/client/seams.ts:1067`（`saveRow` 的在途守卫）

**根因**：守卫与注释不符。

```ts
const saveRow = (ns: string): Promise<void> => {
  // 已经有一轮保存/写在途：直接把这一轮排到它后面，不并发发两份。
  if (savingRowInFlight.current.has(ns)) return writeQueue.current;
```

注释声称「把这一轮排到它后面」，实现却是**提前返回**——返回在途的 promise，**不排新的写入**。于是同一行的第二次写入既没有落到磁盘，也没有任何提示。

**可达路径**：删除搜索密钥的按钮**没有 `disabled` 守卫**。同一张卡里的「添加」按钮是 `disabled: props.secretSaving === true`（`page.ts:679`，且 `secretSaving` 覆盖整个 `saveOneField`），「测试」按钮是 `disabled: probing`（`page.ts:637`），唯独删除按钮（`page.ts:643`）没有任何禁用条件。

用户在一个写入往返内点两个删除：
1. 删 A → `saveOneField` → 草稿变成 `[B]` → 写入在途；
2. 删 B → 草稿变成 `[]` → `saveRow` 命中守卫 → **被吞**。

**影响**：设置文档里的 `searchApiKeyRefs` 仍留着已删的引用名（该路径只改引用列表，不删凭据），搜索会继续轮替使用这把用户以为已经删掉的密钥；界面无任何报错。这与项目此前修过的「密钥加了删不掉、改了不落盘」是同一族症状。

**证据**：用独立脚本复刻守卫语义（`/tmp/saverow-sim.mjs`，未改仓库）——第一次写入内容为 `["B"]`，第二次调用后**写入次数仍为 1**，磁盘值保持旧值。

**建议修法**：守卫里排一次后续写入，而不是提前返回。例如把「在途」标记改成「待写」计数，在途写入结束时若有待写则再排一轮；或在途时把最新草稿挂到待写槽，由在途那轮收尾时一并写出。同时给删除按钮补 busy 守卫（与「添加」「测试」一致）作为第二道防线。

**测试缺口**：`tests/client/` 覆盖了「修订号冲突」（并发写者把修订号 +1 → 写入失败并提示），但**没有**覆盖「同一行连续两次保存」。

---

## 发现 2 · 额度窗口的元素未逐项校验 — LOW（当前不可达）

**位置**：`src/client/usage-contract.ts`（`parseVendorUsageStatus`）→ `src/client/quota.ts`（`quotaAmount`）

**根因**：边界只保证 `quota.windows` 是**数组**，元素字段（`used` / `cap` / `percent` / `unit`）原样透传。下游 `quotaAmount` 在 `unit === "usd"` 时调 `value.toFixed(2)`——若 `used`/`cap` 是字符串会抛 TypeError（面板降级为「失败 + 重试」，有 `RenderBoundary` 兜底，不会白屏）。

**为什么说当前不可达**：三家生产端（`commandcode/quota.ts`、`opendesign/quota.ts`）的 `used` / `cap` 全部经 `numberValue()` 严格校验后才落库，`NaN` 也不会让 `toFixed` 抛（`NaN.toFixed(2)` 合法）。要触发它需要远端接缝被破坏（不同版本插件、宿主伪造）。

**建议修法**：在边界把窗口元素也洗一遍（与 `parseCatalogModels` 同一纪律），非有限数字归空。

---

## 发现 3 · `readImageBytes` 的守卫写法冗余 — INFO

**位置**：`src/vendors/opendesign/index.ts`（`readImageBytes`）

```ts
if (!isRecord(attachments) && typeof attachments !== "object") return undefined;
```

`isRecord` 已排除 `null`，而 `typeof null === "object"`，所以这个条件对 `null` **不成立**——`null` 会落到下一行读属性（抛 TypeError），靠外层 `try/catch` 兜住返回 `undefined`。功能无影响，但守卫读起来像覆盖了 `null`、实际没有。建议直接写 `if (!isRecord(attachments)) return undefined;`。

---

## 本轮验证为干净的部分

| 领域 | 结论 |
| --- | --- |
| **图片链路**（新） | 字节校验 `data instanceof Uint8Array` + 非空 `mediaType`；目标 `maxBytes` 5MB；取不到字节降级成**文字占位**而非静默丢弃；纯文本请求仍发字符串（不塞数组）；空数组兜底成 `""` |
| **stop 序列**（新） | 发送侧透传（空数组省略、拷贝防外部改写）；接收侧 `finish_reason` 映射齐全（tool_calls / length / max_tokens / 兜底 stop）；旧的 `UNSUPPORTED_OPTION` 拒绝已移除 |
| **秘密处理** | 密钥不进日志、不进设置文档、不进返回值；错误消息只引用账号 ref / label，不含密钥 |
| **定时器** | 5 处全部有清理：登录轮询 `clearInterval`、设置页 30s 刷新 `clearInterval`、侧边栏退避链（`setTimeout` 链而非 `setInterval`，可随成败调整间隔）、额度读超时 `finally { clearTimeout }` |
| **子进程**（vela 登录） | `kill` + `AbortController` + `error` 事件捕获（ENOENT 静默失败有专门文案）；`defaultSleep` 正确处理「已中止」 |
| **正则** | 全库无 `new RegExp(...)`，无 ReDoS 风险 |
| **额度算术** | 除法有 `cap > 0` 守卫；`Number.isFinite` 守卫；百分比 clamp 到 0–100；`unit==="usd"` 走 `toFixed(2)` |
| **读口契约** | `remoteValueDetailed` / `callRemote` 统一「绝不 reject」→ 客户端 `void x.then(...)` 模式不产生未处理拒绝 |
| **跨行网关**（首轮真 bug） | 修复完好：`gateway-access` 注册表按**请求的 provider** 现取，基地址优先级、账号顺序、密钥解析与适配器同源；只有 opendesign 登记（另两行走 API key 回退，设计如此） |
| **保存路径** | 串行队列 + 每次现取修订号 + 同步镜像避免旧闭包 + 失败逐字段提示 + 失败后也重读 —— 机制本身扎实（缺口只在发现 1 的在途守卫） |

## 覆盖范围

构建配置与四个宿主入口 → `src/core`（账号 / 目录 / 凭据 / 失败分类 / 切换 / 搜索 / 恢复 / 用量台账）→ 三家厂商的 adapter / protocol / quota / accounts / login / index 装配 → `usage-remote` 远程面 → 客户端全部模块（seams / page / page-state / shell / 设置卡片 / 账户卡片 / 仪表盘 / 侧边栏 / 额度渲染 / 契约解析 / 更新检查 / 登录窗口）→ 交叉验证（算术边界、时间处理、异步竞态、资源清理、秘密处理、正则）。

---

## 附录：此前轮次报告、本轮未复审的未决项

以下两条在**更早**的轮次里报过，本轮是独立审查、未重新验证，按现状仍应视为未决：

| 项 | 位置 | 状态 |
| --- | --- | --- |
| commandcode 行缺 `loader/volatile-update` 订阅 → 手改 profile 的 `enabled: false` 仍要重载才生效（另两行 opencode / opendesign 都有） | `src/vendors/commandcode/index.ts` | 未修 |
| `discoverVendors` 的一个调用点缺 `.catch`（函数内部已全防御，风险低） | `src/client/seams.ts` | 未修 |
