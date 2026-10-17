# 账号切换策略、模型目录勾选与界面紧凑化 —— 设计

- 日期：2026-10-17
- 状态：待评审（写完先由用户评审，评审通过后才出实施计划）
- 项目：`dsh-llm-account`
- 关联：`docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`、`docs/superpowers/notes/2026-10-17-ui-redesign.md`
- 范围：`src/core/**`、`src/vendors/**`、`src/client/**`、测试；不改凭据语义、不改 provider 路由 id、不新增持久化存储

## 0. 一句话

给两家厂商增加**可配置的账号切换策略**（手动顺序 / 额度优先）、**只在任务轮次结束后应用切换**、两家都能**手动排序**；把两家账号**合并到设置页顶部的一张常驻账户卡片**（仍各管各的凭据与顺序）；把模型卡片从「只显示已配置的模型」改为「厂商目录 ∪ 已配置」的勾选式可见性；并给 OpenCode 增加**实验性的设备码网页登录**（手动 API key 保留）；最后把设置页间距整体收紧一档。所有新行为都有默认值，默认值与现状一致（零迁移、零行为突变）。

## 1. 现状与证据

### 1.1 账号

- 持久字段 `activeAccount`（Command Code）/ 顶层 `apiKeyEnv`（OpenCode）目前被读作 **fixed/pinned**：UI 显示「固定」，菜单项叫「固定使用此账户」。
- 轮换决策在**每次请求内**：`RotationEngine.pick` = 按模型规则 → pinned → 顺序里第一个未被拒绝的账号；失败后在同一请求内回退（受 `autoSwitch` 门与「已输出/已消耗 token 不换」约束）。
- 跨请求没有主动换号；没有「间隔」「轮次」概念。
- 宿主把 `turn/end` 作为会话事件追加（`dsh-agent-loop/lib/index.js`），且 `ctx.on("session/event", (session, event) => …)` 已被本机其他插件使用（`@suagr_xl/dsh-safety`、`@changfenhuang/dsh-genui`），事件带 `event.type` 与 `session.id`。
- 手动排序：只有 OpenCode 声明 `reorder: true` 并实现 `move`（写 `accounts` 数组 + 顶层 `apiKeyEnv`）；Command Code 声明 `reorder: false`，没有排序入口；且 Command Code 的 `orderOf` 把顶层默认账号**永远放在第一位**，仅重排 `accounts` 无法真正排序。

### 1.2 模型可见性

- 设置里有 `visibleModels`（白名单）与 `modelVisibility`（逐模型布尔）；宿主 `listModels` 用 `core/catalog` 的 `selectVisible` 过滤。
- 页面的模型卡片列表 = `visibleModels ∪ keys(modelVisibility)`。**没有任何地方把厂商目录提供给页面**，所以新用户的卡片是空的，没有可勾选的模型。
- 两家适配器各自有目录能力（OpenCode 有 TTL 缓存；Command Code 目前每次直取），但目录只用于 `listModels` / `resolveModel`。

### 1.3 间距

- 行内 padding 12px、卡片内边距 16px、卡片 gap 12px、页面/区块 gap 16px，配合 13/14px 字号显得松。

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| **当前账号（current）** | 下一次请求会优先使用的账号。由持久化选择（现有 pinned 字段）给出；没有显式选择或它已不可用时，取顺序里第一个可用账号。UI 上只叫「当前使用」。 |
| **生效账号（effective）** | 最近一次真正被选中/服务完成的账号（现有概念，保留）。 |
| **轮次边界（turn boundary）** | 会话事件 `turn/end`；用于「任务结束后再切换」。 |
| **额度用尽（exhausted）** | 活的 `quota` / `rate-limit` 拒绝，或最近一次已知额度读数里某个窗口剩余 ≤ 0 / `exceeded: true`。 |
| **评估（evaluate）** | 算出「下一个该用谁」，**不等于**已经切换；应用（apply）才写持久字段。 |
| **策略（strategy）** | `order`（手动顺序）或 `best-quota`（额度优先）。 |

## 3. 不变量（不可退让）

1. **不在同一轮次内主动换号**：`switchAtTurnEnd` 为真时，评估出的切换必须等到该会话出现 `turn/end` 之后的下一次请求才应用。
2. **额度未知 ≠ 0**：没有读数就是未知；未知不参与「用尽」判定，也不因为读不到就把当前账号换掉。
3. **默认零变化**：不配置任何新字段时，行为与现在完全一致（测试必须锁死）。
4. **不新增存储**：只用现有设置文档字段与既有凭据端口；凭据本身永不被切换逻辑读写。
5. **标题/压缩请求不触发切换**：`purpose` 为 `session-title` / `compaction` 的调用不评估、不应用、不清 pending。
6. **切换与排序都写设置文档**，不直接改运行时内存里的顺序；读写路径仍只有 `SettingsPort` / `AccountPort`。
7. **不做后台轮询**：`order` 策略或 `interval = 0` 时不注册任何定时器；`best-quota` 的评估也只在「请求前」或「轮次边界后的第一次请求」按间隔触发。
8. **OAuth 凭据只进凭据服务**：access/refresh token 不写设置文档、不进日志、不进错误文案；设置文档只存工作区名。
9. **登录只由用户触发**：没有点击「网页登录」就不会发起设备码或创建账号。

## 4. 设置面

两家厂商的 `Config` 各新增以下字段（全部 volatile；都可以经设置页保存）：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `switchStrategy` | `"order" \| "best-quota"` | `"order"` | 切换策略。 |
| `switchIntervalMinutes` | number，0–1440，step 1 | `0` | **只对 `best-quota` 生效**：多久重新评估一次。0 = 不按间隔重评（只在额度用尽时换）。`order` 策略下该值不参与决策。 |
| `switchAtTurnEnd` | boolean | `true` | 等当前轮次结束再应用切换。 |
| `accountOrder` | `string[]`（可选） | 缺省 | 手动排序覆盖。缺省/清洗后为空 → 沿用现有派生顺序。 |

保留现有 `autoSwitch`（失败时是否允许在同一请求内回退到其它账号），但把它的 UI 从 OpenCode 专属 footer 移到两家共用的「切换规则」卡片里；语义不变。

设置页的卡片：新增通用组 `switch`（`CardGroupId`），标题「切换规则」，字段顺序：

1. 切换策略（select：手动顺序 / 额度优先）
2. 切换间隔（number；提示「仅额度优先使用；0 表示不主动重评」）
3. 任务结束后再切换（boolean）
4. 失败时自动切换（boolean，即 `autoSwitch`）

标签页内的渲染顺序：厂商专属卡片（模型）→ 切换规则 → 集成与显示 → 高级设置。`GROUP_ORDER` 增加 `"switch"` 并排在 `"integrations"` 之前。账户卡片移出标签页，常驻在标签页上方（见 §8.1）。

文案（`copy.ts` 的 `CopyKey` 与 zh/en 两份字典都要加）：

- `group.switch`、`group.switch.hint`
- `field.switchStrategy`、`field.switchStrategy.hint`、`options.switchOrder`、`options.switchBestQuota`
- `field.switchIntervalMinutes`、`field.switchIntervalMinutes.hint`
- `field.switchAtTurnEnd`、`field.switchAtTurnEnd.hint`
- `field.autoSwitch`、`field.autoSwitch.hint`（从 `account.autoSwitch*` 迁移或复用）
- `switch.reason.balance`：额度更优（新增切换原因）
- 移除/改写「固定」相关文案：`account.pin` → 「切换到此账户」；`account.pinnedBy` → 删除或改名 `account.current`「当前使用」；`sidebar.pinned` → 不再显示。

## 5. 账号顺序（两家共用）

### 5.1 派生顺序与覆盖

每个厂商新增一个纯函数（放各自 `index.ts` 或抽到 `core/accounts.ts`，以能单测为准）：

```
orderWithOverride(derived: string[], override: unknown): string[]
```

- `override` 必须是数组；逐项只收非空字符串，去重，去掉不在 `derived` 里的 ref（不存在的账号不参与轮换）。
- 结果 = 覆盖里合法的项（按覆盖顺序）+ `derived` 中未出现的项（保持派生顺序，追加在末尾）。
- 结果为空 → 返回 `derived`。

`derived` 仍是现在的 `orderOf`（顶层默认账号 + `accounts[]`，去重）。因此：

- 没有 `accountOrder` 的存量用户：顺序与现在逐字一致。
- 第一次手动排序后写入 `accountOrder`；删除账号时从 `accountOrder` 里摘掉该 ref；新增账号自动出现在末尾。

### 5.2 排序写入

- 两家都实现 `AccountPort.move(ref, toIndex)`：用当前顺序（含覆盖）做 `reorder`，把结果写进 `accountOrder`。
- OpenCode 现有 `move` 改为写 `accountOrder`（不再重排 `accounts` 数组、不再改顶层 `apiKeyEnv`）。**行为变化**：排序不再顺带把队首设成当前账号；当前账号只由「切换到此账户」与策略改变。旧数据没有 `accountOrder`，所以默认顺序不变。
- Command Code 的能力声明 `reorder` 改为 `true`；两家账户行的菜单都出现「上移 / 下移」。
- `AccountPort.list()` 按顺序返回，不再把当前账号 `moveFirst` 到首位（现在 UI 有「当前使用」标记，不需要靠顺序表达当前）。合成的默认槽按覆盖顺序落位；没有覆盖时仍在第一位。
- 移除账号时同步从 `accountOrder` 删除该 ref。

## 6. 切换控制器

### 6.1 分层

- **纯决策**（`src/core/switching.ts`，无 I/O、可完整单测）：
  - `remainingScore(snapshot): number | undefined`：一个账号的「最紧窗口剩余比例」（0–1）。窗口剩 = `1 - used/cap` 或 `1 - percent/100`；`exceeded` → 0；没有可计算窗口 → `undefined`。
  - `rankCandidates(input): Candidate[]`：输入 = 顺序、拒绝表、配置状态、额度分数、策略；过滤掉被拒绝/未配置的账号；输出带分数（未知分数排最后）。
  - `nextInOrder(order, current, usable): string | undefined`。
  - `shouldSwitch(input): { target, reason } | undefined`：实现 §6.3 的两种策略与迟滞。
- **运行时控制器**（`src/vendors/switching.ts`，两家共用）：
  - 构造参数：`now`、`settings()`（现读文档）、`accounts.list()`、`select(ref)`（持久化）、`quota(ref)`（按 ref 读额度）、`rotation()`（拒绝表/生效账号）、`logger`。
  - 状态：`lastEvaluatedAt`、`pending: { target, reason } | undefined`、`turnEnds: Map<sessionId, at>`（上限 128，LRU 淘汰）、`lastRequestAt: Map<sessionId, at>`、`inFlight` promise（串行化 apply）。
  - `noteSessionEvent(session, event)`：只认 `event?.type === "turn/end"`，记录 `session.id` 的边界时刻。
  - `beforeRequest({ sessionId, purpose })`：见 §6.2。
  - 应用切换：`await accounts.select(target)` → `rotation().noteAutoSwitch(target, reason)`（新增方法，记录生效账号与切换原因）。写入失败（修订冲突等）只记日志、保留 pending，下一次再试；**绝不让请求因切换失败而失败**。

### 6.2 请求前流程（每次模型请求调用一次，位于 `pick` 之前）

1. `purpose` 为标题/压缩 → 直接返回。
2. 读取当前账号：持久化选择（pinned）若仍可用，否则顺序里第一个可用账号。
3. 若有 pending：
   - 允许应用的条件：`switchAtTurnEnd === false`，或没有 `sessionId`，或该会话在 `lastRequestAt` 之后出现过 `turn/end`；
   - 满足 → 重新评估（目标可能已被拒绝/移除），应用后清 pending；不满足 → 保留 pending，继续用当前账号。
4. 没有 pending 时做一次评估（按策略）：
   - `order`：当前账号「用尽」→ 目标 = 顺序里当前之后的下一个可用账号（绕回一次）。
   - `best-quota`：当前账号「用尽」→ 目标 = 排名最高者；若排名读不出来（全部未知/读取失败）→ 退化为 `order` 的下一个账号（绝不因为读不到而留在已用尽的账号上）。当前账号没有用尽、但 `interval > 0` 且 `now - lastEvaluatedAt >= interval` → 读候选额度并排名，目标 = 排名最高者，但仅当它比当前高至少 **10 个百分点**（迟滞，防抖动）。**当前账号的分数未知时不做这类「更优」切换**（没有可比对象），只在用尽/被拒时切。
   - `interval = 0` 的 `best-quota` 与 `order` 一样只在用尽时评估。
5. 评估出目标后：
   - 目标 === 当前 → 什么都不做；
   - `switchAtTurnEnd === true` 且该会话还没有出现过轮次边界 → 记 pending（reason 见 §6.4）；
   - 否则立即应用。
6. `lastEvaluatedAt` 在**每次实际评估**后更新（包括没有命中目标）；`lastRequestAt[sessionId] = now`。

字段清洗（读取时，全部按「坏值 = 保守默认」处理）：`switchStrategy` 只认 `"order"` / `"best-quota"`，其余读作 `"order"`；`switchIntervalMinutes` 只收 0–1440 的有限整数，其余读作 0；`switchAtTurnEnd` 只认布尔值，其余读作 `true`；`accountOrder` 见 §5.1。

**保存时机**：四个新字段与 `autoSwitch` 都走设置页的保存条（`onSave`），不新增远程写方法。控制器每次请求现读设置文档，所以保存后下一次请求即生效。

**「用尽」的数据来源**（按优先级）：

1. 拒绝表里当前账号的活条目 `quota` / `rate-limit` / `invalid-credential`；
2. 控制器缓存里当前账号最近一次额度读数（窗口剩余 ≤ 0 / `exceeded`）；
3. 都没有 → 不算用尽（不猜）。

### 6.3 `best-quota` 的额度读取

- `QuotaPort.snapshot(ref?: string)`：带 ref 时读该账号，否则读当前选中账号（现有行为）。两家 `create*Quota` 的 `ref` 依赖从「无参 getter」改成 `(explicit?: string) => string | undefined`；密钥解析走同一个 `resolveKey(ref)`。
- 控制器自带缓存：`ref → { snapshot, at }`；TTL = `max(switchIntervalMinutes, 5)` 分钟。评估时只读缓存过期或未知的候选；并发上限 2；单次读取沿用该厂商的请求超时；整体评估预算 20 秒，超时/失败一律记为未知。
- 只读**配置状态为已配置**且未被拒绝的账号；账号列表来自 `accounts.list()`。
- 未知分数排在已知之后；当前账号不是用尽状态时，**绝不**因为读不到其它账号而把它换掉。

### 6.4 切换通知

- 新增 `SwitchReason` 取值 `"balance"`（文案「额度更优」），`core/rotation.ts` 与客户端 `usage-contract.ts` 两处联合类型都要加（客户端那份是独立定义的，不是 re-export）。
- 原因映射：用尽触发的切换沿用触发它的拒绝分类（`quota` / `rate-limit` / `invalid-credential`）；没有拒绝、仅因已知额度剩余为 0 的用尽 → `quota`；`best-quota` 的重评切换 → `balance`；用户点「切换到此账户」→ `manual`。
- `RotationEngine` 新增 `noteAutoSwitch(ref, reason)`：更新生效账号并记一条切换提示；与 `noteManualSwitch` 的区别只有原因。没有可指名原因时不记提示（保持现有纪律）。
- 侧边栏/仪表盘的切换记录因此能显示策略切换。

### 6.5 与现有 `pick` / `autoSwitch` 的关系

- `pick` 的候选与回退顺序**不变**；切换控制器只是提前把「当前账号」持久化成策略选择的结果。
- `autoSwitch: false` 仍然把候选收窄到当前账号；控制器的用尽切换会改变「当前账号」，因此在 `autoSwitch` 关闭时也生效（「额度用尽后切换下一个」与「失败回退」是两件事）。在文档与提示里写清楚。
- 模型规则优先级不变（规则命中的账号优先于当前账号）。
- `autoSwitch` 从「OpenCode footer 立即写」变成「两家共用的切换规则卡片、随保存条保存」；字段与默认值不变，只有写入时机变化（保存后下一次请求生效）。

## 7. 远程契约

### 7.1 状态

- `VendorUsageStatus` 新增 `current: string | null`：宿主计算的下一次请求会用的账号。口径与控制器一致：pinned 若存在、已配置且未被拒绝 → 它；否则顺序里第一个已配置且未被拒绝的账号；都没有 → `null`。
- 保留 `pinned`（现状字段，不破坏既有测试/客户端），但页面不再用它显示「固定」；等未来版本再考虑移除。
- `status()` 的额度读取仍只归属 `quotaRef`（不扩大到所有账号）。

### 7.2 模型目录

- `USAGE_METHODS` 增加 `"models"`；对应的 typert 描述符与客户端 `$mount` 一起更新。
- 方法：`models(vendor) => { models: { id: string; name?: string }[]; failures: string[] }`。
- 宿主 adapter 新增 `catalogModels(): Promise<{ id; name? }[]>`：
  - OpenCode：复用现有 `#catalog`（TTL 缓存）。
  - Command Code：给目录加一个按 `apiBase` 的短 TTL 缓存（与 OpenCode 同款），避免设置页每次打开都直取。
- `UsageVendorDeps` 增加 `models?: () => Promise<CatalogModel[]>`；两家 `index.ts` 传入 adapter 的实现；没有实现的厂商该方法返回 `failures: ["models: not supported"]`。
- 目录读取失败不抛：返回 `{ models: [], failures: [原因] }`；页面对「失败」和「目录为空」显示不同文案。

### 7.3 登录状态

- `LoginStatus`（core 与客户端 `usage-contract` 两处）新增 `userCode?`（设备码）、`expiresAt?`（设备码过期时刻）。
- 现有 `loginBegin` / `loginStatus` / `loginCancel` 三个方法与描述符不变；OpenCode 的登录端口实现同一套接口。
- 登录成功不返回 token（只返回 `success` 与账号名）；token 只在宿主侧写入凭据服务。

## 8. 页面

### 8.1 页面结构（账户合并、其余仍按厂商）

- 顺序：标题/简介 → **统一账户卡片（常驻，不属于任何标签页）** → 厂商标签页 → 当前标签页内容。
- 统一账户卡片：一个 `dsl-card`、标题「账户」，内部按厂商分组：
  - 组头：厂商名（`vendor.commandcode` / `vendor.opencodeGo`）+ 右侧小号「添加账户」按钮；
  - 组内：该厂商的账号行（顺序 = 该厂商的 `list()` 顺序）；
  - 组尾：该厂商的「添加账户」展开表单（点组头按钮后在该组内展开）；
  - 已发现但读不到状态的厂商：整组显示「账号数据暂不可用」+ 原因（不显示假的空列表）。
- 标签页只承载模型、切换规则、集成与显示、高级设置；**账户不再出现在标签页里**。
- 两家的状态数据容器已经一次性读取（`seams.ts` 的状态 effect 遍历全部 entries），合并账户不需要新增请求。
- 两家账号仍是两套凭据/两条 provider 路由，**不共用账号**：合并只发生在展示与管理层；每个厂商的「当前使用」、顺序、额度各自独立。
- 账户操作的状态需要带厂商：`AccountAction` 增加 `vendor` 字段（`openAction` 时写入），派发时用 `action.vendor`（不再用 `activeVendor`）。展开报告的状态按 `vendor::ref` 记录，避免两家同 ref 串台（ref 事实上按厂商派生，但状态键显式带上更稳）。
- 组件拆分：从现有 `AccountCard` 抽出「只有行、没有卡片外壳」的 `AccountRows`；`AccountCard` 保持原 API（单厂商外壳）以便既有测试/调用，新面板用 `AccountRows` 在每个厂商组里渲染，避免卡片套卡片。

### 8.2 账户行（两家共用一份渲染）

- 「当前使用」标记：用该厂商 `status.current`（成功色小标）。**移除**「固定」标记与「固定使用此账户」文案。
- 菜单项：`切换到此账户`（对该厂商调用 `selectAccount`，立即生效并持久化）；`上移` / `下移`（两家都出现，按 `capabilities.reorder`）。
- 行顺序 = 该厂商 `list()` 顺序（不再把当前账号提前）。
- 切换成功后：重读该厂商 `status` 与设置快照（已有 `accountRevision` 机制）。
- 网页登录入口由能力声明驱动：Command Code 的现有入口不变；OpenCode 新增设备码登录（实验性），等待态显示链接 + 设备码。

### 8.3 切换规则卡片（两家共用形状，各自一份）

- 在**该厂商的标签页内**渲染，标题「切换规则」，四行字段（§4）。`switchStrategy = order` 时间隔输入禁用并显示提示；`best-quota` 时可用。
- 卡片底部/提示里说明：策略切换只在轮次边界生效；`autoSwitch` 管的是失败回退，两者独立。

### 8.4 模型卡片

- 在各自厂商的标签页内；数据：`目录 ∪ visibleModels ∪ keys(modelVisibility)`，目录顺序在前，新增/手工项在后，去重。
- 每行：模型 id（目录给名字且不同时显示名字）、勾选框、移除按钮。
  - 勾选状态用 `isModelVisible(id, { visibleModels, modelVisibility })`（直接复用 `core/catalog` 的纯函数，保证与宿主过滤同一份规则）。
  - 勾选/取消：`modelVisibility[id] = boolean`（走现有 `applyModelEdit` 的 toggle）。
  - 移除：仅当该 id 出现在设置里（白名单或显隐表）时显示；删除两处记录。
- 「添加模型」输入保留（目录外的手工 id），语义不变（进白名单 + 显式可见）。
- 计数行：显示 `已显示 N / 共 M`；搜索只过滤展示，不改设置。
- 目录读取失败：列表仍显示已配置项，附一行可读原因与「重试」按钮；不显示「还没有配置模型」。
- 目录只在该厂商标签页第一次渲染时拉一次；不参与后台轮询。

### 8.5 侧边栏 / 仪表盘

- 「当前」标记改用 `current`；与 `effective` 不同时仍给切换提示（文案从「固定」改为「当前使用」）。
- 切换记录新增 `balance` 原因文案。

### 8.6 间距（紧凑化）

字号不变，只动间距：

| 位置 | 现在 | 改为 |
| --- | --- | --- |
| `.dsl-field` 行内 padding | 12px 0 | 8px 0 |
| `.dsl-account` padding | 14px 0 | 10px 0 |
| `.dsl-card` padding / gap | 16px / 12px | 14px / 10px |
| `.dsl-root` gap | 16px | 12px |
| `.dsl-account` gap | 10px | 8px |
| `.dsl-meters` 行 gap | 12px | 10px |
| `.dsl-sidebar` padding / gap | 12px / 10px | 10px / 8px |
| `.dsl-dashboard` padding / gap | 20px 24px 40px / 14px | 16px 20px 32px / 12px |
| `.dsl-dashboard section` padding / gap | 14px 16px / 10px | 12px 14px / 8px |

## 9. OpenCode 网页登录（实验性）

### 9.1 实机探针证据（2026-10-17）

- 设备码流程可用：`POST https://opencode.ai/console/auth/device/code`（client_id `opencode-cli`）→ 浏览器批准 → `POST /auth/device/token` 拿到 access/refresh，有效期约 30 天。
- 该账号只有一个工作区（`Default`）；请求必须带 `x-opencode-org-id`。
- 本插件网关 `GET https://opencode.ai/zen/go/v1/models`：带 `x-opencode-org-id` → 200（37 个模型）；不带 → 403 `Workspace selection is required`。
- 本插件额度端点 `GET https://opencode.ai/zen/go/v1/usage`：403 `EntitlementError: OpenCode Go subscription required` —— 当前工作区**没有 Go 订阅**，这是权益失败，不是 token 被拒。
- 聊天链路未验证：需要已订阅 Go 的账号才能测。

**结论**：鉴权层可行（token + org 头被网关接受），因此提供实验性的「网页登录」；手动粘贴 API key 的路径**完整保留**。聊天链路在用 Go 订阅账号真机跑通之前，登录入口与文档都标注实验性。

### 9.2 凭据格式与刷新

- 登录成功后，凭据服务里存一个带前缀的 JSON：`ocoauth1:` + `{ v:1, type:"oauth", access, refresh, expires, org, orgName }`。
- 设置文档**不存 token**；账号条目仍是 `{ id, name, apiKeyEnv }`，`name` 用工作区名。`org` 只在凭据 blob 里。
- 读取凭据：前缀命中 → OAuth 材料；否则按 API key 处理（存量账号行为不变）。
- 过期前 5 分钟用 `POST /console/auth/device/token`（`grant_type=refresh_token`）刷新，把新 blob 写回凭据服务。刷新失败按凭据失效处理（进入现有 `invalid-credential` 拒绝/提示路径）。
- 刷新按 ref 做进程内单飞锁：并发请求共用一次刷新，写回一次；失败后下一次请求再试。

### 9.3 请求头

- OAuth 账号的目录、推理与额度请求都带：`Authorization: Bearer <access>`、`User-Agent: opencode/cli`、`x-opencode-org-id: <org>`。
- API key 账号保持现状：只有 `Authorization: Bearer <key>` 与 attribution 头。
- 推理链路：opencode 适配器的凭据解析从「返回字符串 key」升级为「返回 `{ apiKey, headers }`」，交给 pi-ai provider 的 auth 配置；额度端口写同一组头。
- 目录请求：OAuth 账号加认证头；API key 账号保持现状（目录原本不带 Authorization）。
- `x-opencode-session` 暂不引入（Go 文档的建议项；未验证的路由/缓存影响留给后续）。

### 9.4 登录端口（复用现有远程方法）

- 新模块 `src/vendors/opencode/login.ts` 实现现有 `LoginPort`（`begin`/`status`/`cancel`），**不新增远程方法**。
- `begin`：`POST /console/auth/device/code`（client_id `opencode-cli`），保存 attempt（deviceCode、userCode、verificationUrl、interval、expiresAt、generation），返回 `waiting` + `authUrl` + `userCode` + `expiresAt`。
- `status`：只有到达轮询间隔才真正请求 `POST /auth/device/token`；`authorization_pending` → 继续 waiting；`slow_down` → interval += 5s；拿到 token → 读 `/console/api/orgs`，取**第一个**工作区，调用账号端口 `add({ label: 工作区名, key: oauthBlob })` → `success`（附 label）；`access_denied` / `expired_token` / 网络 → `failed` + 稳定 reason 键。
- `cancel`：清空 attempt；迟到的响应按 generation 丢弃（与 Command Code 登录同一条纪律）。
- 10 分钟超时；同一时间只有一个 attempt，新的 `begin` 取代旧的。
- 账号创建失败（账号数上限、设置冲突）→ `failed` + 可读原因；因为 `add` 先写账号条目再写凭据，不会出现「凭据写了账号没落地」。
- 多工作区：本期取第一个并在成功状态里显示工作区名；工作区选择器留到后续。

### 9.5 客户端

- `LoginStatus`（core 与客户端契约同步）新增 `userCode?`、`expiresAt?`；客户端账户卡片的 `LoginView` 同步加 `userCode?`，等待态才能显示设备码。
- 等待态：显示「在浏览器打开链接并输入代码：XXXX」；链接沿用 `authUrl`；现有 1s 轮询继续（登录端口自己按 device interval 限流）。
- 成功：刷新账号列表与状态；失败：按原因显示可读文案（新增 `account.reason.login-expired`、`account.reason.login-denied`、`account.reason.login-network`）。
- 能力：OpenCode 的 `browserLogin` 改为 `true`；登录入口由能力驱动，出现在合并账户卡的 OpenCode 组。
- 账户行不区分 OAuth / API key（凭据内容不对外）；「更换密钥」仍可用，会用 API key 覆盖该账号的 OAuth 凭据。
- 同一工作区重复登录会创建一个同名新账号（ref 自动加 `_2`），实验期接受；文档提示可删除旧的，不做静默覆盖（避免冲掉手动 key）。

### 9.6 额度与目录的错误语义

- `/usage` 的 403 `EntitlementError` 映射为可读失败「需要 OpenCode Go 订阅」，而不是通用「读取失败」。
- 目录 401/403（OAuth 头缺失或 token 失效）同样给出可读失败，不把「读不到」显示成「没有模型」。

## 10. 测试计划

- `tests/core/switching.test.ts`（新）：`remainingScore` 的单位/未知/除零/`exceeded`；排名与迟滞；`nextInOrder` 绕回；未知不触发换出。
- `tests/vendors/switching.test.ts`（新）：控制器状态机（假时钟、假事件、假额度）：轮次边界前不应用、边界后应用、pending 失效重算、写入冲突保留 pending、purpose 跳过、并发串行。
- `tests/vendors/*-ordering.test.ts`：`accountOrder` 清洗/追加/缺失；`move` 写覆盖；删除账号清理；`list()` 顺序；能力声明。
- `tests/vendors/usage-remote.test.ts`：`current` 字段、`models` 方法成功/失败、描述符与 arity。
- `tests/client/page-state.test.ts`：模型可见性判定与 toggle；策略字段的默认值/清洗。
- `tests/client/models-card.test.ts`：目录 ∪ 设置、勾选状态、手工添加、目录失败态、重试。
- `tests/client/accounts-panel.test.ts`（新）：两家账号在一张卡里按厂商分组；两家的「当前使用」互不影响；组内添加表单落在正确的厂商组；操作携带 vendor；同 ref 的展开状态不串台；一个厂商读不到状态时只影响该组。
- `tests/client/account-card.test.ts`：「当前使用」、菜单文案、两家排序项；`AccountRows` 与 `AccountCard` 的拆分不改变既有结构断言。
- `tests/client/seams.test.ts`：账户操作按 `action.vendor` 派发；登录、排序、添加、移除都走到对应厂商。
- `tests/vendors/opencode-login.test.ts`（新）：设备流程状态机（fake fetch）——waiting / slow_down / success / access_denied / expired / cancel / 迟到响应丢弃；工作区读取；账号创建失败；10 分钟超时。
- `tests/vendors/opencode-auth.test.ts`（新）：`ocoauth1:` blob 解析、过期前刷新、刷新单飞、刷新失败转凭据失效；OAuth 头注入（推理/额度/目录）；API key 账号头不变；token 不出现在设置/日志/错误文案。
- `tests/client/account-card.test.ts` 增补：等待态显示 userCode + 链接；成功刷新账号；失败原因文案。
- `tests/client/style-contract.test.ts` / `css.test.ts`：新类名/按钮类、无硬编码颜色、间距契约（可选：钉住关键 padding）。
- 现有 518 条测试全部更新并保持绿色；`pnpm typecheck` / `pnpm build`。

## 11. 风险与未验证接缝

| 风险 | 处理 |
| --- | --- |
| `session/event` 的 `turn/end` 形状 | **已核验（0.2.1-rc.2）**：`ctx.on("session/event", (session, event) => …)`，`event.type === "turn/end"`，`session.id` 是会话 id；代码在 `dsh-agent-loop/lib/index.js` 与 `dsh-session/lib/index.js` 里。控制器兼容 `(session, event)`、`(sessionId, event)` 与 `{ sessionId, event }` 三种形状。 |
| 切换写入设置与用户保存设置冲突（修订号） | `select` 失败只记日志、保留 pending；不会重试循环；下一次边界再试。 |
| `best-quota` 读取 N 个账号额度（每账号 3–4 个端点） | 只在间隔评估点读、TTL 缓存、并发 2、20 秒预算；失败按未知处理；界面上不承诺实时。 |
| 目录端点需要可用凭据 | 失败时显示已配置项 + 原因 + 重试，不把「读不到」当空。 |
| `accountOrder` 改变了 OpenCode 的排序副作用（不再顺带改当前账号） | 文档与测试明确：排序只改顺序，切换只走「切换到此账户」/策略。 |
| 新 typert 方法 `models` 的 arity/描述符不一致会在边界被拒 | 与现有方法同款：`parameters`/`result` 描述符 + 边界测试。 |
| 取消/中止时控制器仍在应用切换 | `apply` 不依赖请求 AbortSignal；只写设置，不阻塞请求失败路径。 |
| OpenCode OAuth 的聊天链路尚未用 Go 订阅账号验证（探针只证明了鉴权层） | 登录标注实验性；手动 API key 完整保留；失败时按凭据失效提示重新登录；后续用已订阅账号做一次真机聊天验证。 |
| OAuth token 刷新与请求并发（多个请求同时发现过期） | 按 ref 的进程内单飞锁；写回一次；失败只影响该账号的请求，不波及其它账号。 |
| 设备码被用户取消/过期 | 登录端口返回 `failed` + 稳定 reason；页面显示原因与「重试」；不残留 attempt。 |
| 把 refresh token 写进设置文档或日志 | 凭据只进凭据服务；设置文档只存工作区名；日志与错误文案只出现账号名，不出现 token。 |

## 12. 兼容与迁移

- 新字段全部有默认值，存量文档不加字段也能启动；`accountOrder` 缺省时顺序与现在一致。
- 不迁移、不改写现有 `visibleModels` / `modelVisibility` / `autoSwitch` / 账号数组。
- 移除 OpenCode 专属的 autoSwitch footer 只是 UI 变化，字段与写入路径不变（现在从通用卡片保存）。
- 「固定」相关文案删除；`VendorUsageStatus.pinned` 字段暂时保留（兼容），页面不再显示它。
- 账户合并是**页面结构变化**，不影响两套账号文档/凭据/远程方法；账户操作状态多带一个 `vendor` 字段（内部状态，不持久化）。
- 标签页仍按厂商存在；账户卡片移出标签页后，任何标签页下都能看到与操作两家账号。
- OpenCode 的 OAuth 凭据以 `ocoauth1:` 前缀存进凭据服务；没有该前缀的值一律按 API key 读，存量账号零迁移。
- OpenCode 的 `browserLogin` 由 `false` 改为 `true`，只是多一个登录入口；不登录的用户完全不受影响。

## 13. 非目标

- 不做跨厂商负载均衡、不做按模型绑定账号的 UI（`modelAccountRules` 仍是配置级能力）。
- 不做后台定时轮询（`order` 或间隔 0 时零定时器；`best-quota` 只在评估点读）。
- 不在用户未点击登录时自动创建/登录账号；登录只由账户组里的按钮触发。
- OpenCode 登录不提供多工作区选择器与「登出」按钮（删除账号会走现有凭据清理）；多工作区取第一个。
- 不重做仪表盘视觉，只补「当前使用/balance」文案与必要标记。
- 不改变「已输出/已消耗 token 不换号」的请求内回退规则。

## 14. 验收标准

1. 不配置新字段时，行为与现在一致（既有测试不因默认值改变语义）。
2. 手动顺序：当前账号额度用尽后，轮次结束后的下一次请求切到下一个可用账号；界面「当前使用」跟随。
3. 额度优先：每隔设定的间隔重新评估，目标比当前高至少 10 个百分点才切；绝不在轮次中途切；额度未知不导致换出。
4. 关闭「任务结束后再切换」时才允许在请求前立即应用。
5. 两家都能手动排序并持久化；没有 `accountOrder` 的存量配置顺序不变；删除账号后顺序自动清理。
6. 模型卡片显示厂商目录；取消勾选后宿主模型选择器不再出现该模型，重新勾选恢复；目录读取失败有可读原因与重试；手工添加仍可用。
7. 设置页顶部一张常驻账户卡片同时显示两家账号：分组、各自的「当前使用」、各自的排序与操作都正确；切换标签页不影响账户卡片；一个厂商读不到状态只影响它那一组。
8. OpenCode 网页登录（实验性）：点击后显示设备码 + 链接，浏览器批准后自动创建账号；取消/过期有可读原因；手动粘贴 API key 仍可用；token 不进入设置文档/日志。聊天链路在已订阅 Go 的账号上做一次真机验证（未通过前保持实验性标注）。
9. 设置页间距明显收紧，不出现竖排标签或挤压；暗色主题不坏。
10. `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿。
