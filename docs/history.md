# 实现时间线

按时间顺序记录「什么时候做了什么、为什么」。**这里不是手册** —— 需要可操作的结论时
看上面几份主题文档；这里用于追溯「这个行为是哪一轮加的」以及当时的取舍。

---

## 账号轮播与限额换模型（2026-10-19）

日期：2026-10-19（本轮，接在「统计搬到账号下面」之后）
涉及提交：`1ee3498`（轮播 + 换模型雏形）、`9827db6`（候选限制在可选范围）、`7ad6ba0`（跨厂商委托）

这两件事都是用户在同一天里逐步澄清出来的，需求演化过程比结果更值得记下来 —— 因为它解释了
为什么代码里有几处看起来「绕」的地方。

---

## 一、侧边栏账号轮播

### 需求怎么变的

| 时点 | 用户说法 | 含义 |
| --- | --- | --- |
| 最初 | 「循环显示不同账号的额度是否一直没有成功」 | 以为是 bug |
| 查清后 | —— | 不是 bug：`showSidebarQuota` 是**按厂商**存的，profile 里只给 commandcode 开了 |
| 再澄清 | 「自己选择轮播哪些账号进行显示，默认为所有账号轮播」 | 从**厂商级**改成**账号级** |

### 最终行为

- 轮播单位是 **(厂商, 账号)**，不是厂商；
- 默认**所有已配置账号**都参与（`sidebarAccounts` 未配置时不过滤）；
- 间隔 `sidebarRotateMinutes`（三家 Config 都有，默认 1 分钟，范围 1–60）；
- 侧边栏卡片整块可点 → 打开用量面板（刷新区在面板上）；
- 卡片内**两行**：第一行 5 小时档（带重置时间），第二行每周 + 每月并排。

### 关键实现点（以及为什么这么绕）

**1. 循环依赖**：账号清单住在 `status()` 里，而「该读哪一家」又取决于当前显示哪个账号。

解法：把清单当**独立数据**。一次 `status(某家)` 就同时带回「该家所有账号」和「额度」，所以：

```
启动 → 各开启的家各读一次 status（建清单）→ 之后每拍只重读目标账号所在的那一家
```

**2. `targets` 必须渲染期现算，不能进 state**：第一版放进 state，形成
「清单变 → setState → 重渲染 → 清单键又变」的回环，`turn` 每次被重置，
**轮播永远停在第一个账号**（实测：卡片上反复出现同一个账号名）。
现在 `sidebarTargetsOf(vendors, statuses, selection)` 是纯函数、渲染期直接算。

**3. 渲染条件看 `vendors.length`，不看 `targets.length`**：清单要先读一次 status 才有，
用清单当条件会死锁 —— 卡片不渲染 → 轮询不启动 → 永远不读 → 清单永远空 → 永远空白。

**4. `resetSeams()` 必须复位轮播的三份模块级状态**（`sidebarVendorsValue` /
`sidebarAccountKeysValue` / `sidebarSelectionConfiguredValue`）。漏了之后测试互相污染，
表现为「单独跑能过、连跑就失败」。

### 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/client/page-state.ts` | `sidebarTargetsOf` / `sidebarAccountKeysOf` / `sidebarSelectionConfigured` / `sidebarIncludesAccount`；`SIDEBAR_ACCOUNTS_KEY` |
| `src/client/seams.ts` | 容器：建清单、轮播定时器、`targets` 现算、`noteSidebarSnapshots` 填充清单 |
| `src/client/sidebar-card.ts` | `accountRef` 属性（显示指定账号）、两行额度版式 |

---

## 二、限额时换模型

### 需求怎么变的

原话：「遇到账号限额的时候自动切换到同等类型的模型还有思考强度，但是排除官方的 API」。
追问后澄清：

- **「同等类型」= 同名模型**，没有同名就停手（不是按 flash↔pro 这种档位猜）；
- 用户可自选范围：「增加一个选项，可以有用户指定选择在那些模型中进行切换，但是优先切换相同名称的模型」；
- 「排除官方的 API」= 排除 DeepSeek 官方直连；
- 时机：**失败后重试**，本次请求就换。

### 最终规则（`src/core/model-fallback.ts`，纯函数 + 单测）

1. **只认同名**：`modelKeyOf` 去掉厂商前缀、转小写、抹掉 `-`/`.`/`_` 后比较。
   `deepseek/deepseek-v4.1-flash` ≡ `deepseek-v4.1-flash` ≡ `DeepSeek-V4.1-Flash`；
   但 `deepseek-v4-pro` 与 flash **不同名**，不会互替。
2. **找不到同名就返回 `undefined`** —— 停手。限额是要省钱，不是把用户悄悄降到更弱的模型。
3. **排除官方直连**：`isOfficialProvider`（`deepseek` / `deepseek-*`）。
4. **思考强度尽量保留**（`fallbackEffort`）：替代模型支持原档位就保留；不支持则取该模型
   **最高**档；替代模型没有档位就不发字段。

### 候选只在「用户可选范围内」

这一条是用户当天追加的，而且我第一版**漏了**：

> 「还有一个可自选模型范围的怎么没做，根据当前的可选模型配置切换模型名单」

第一版候选取自 `catalogModels()`，而它的契约明确写着「**不受** `visibleModels` /
`modelVisibility` 过滤，供设置页勾选」。后果是：用户在设置页关掉的模型，限额换模型时
**照样会被选中** —— 那是绕过用户明确表达过的偏好，比不换更糟。

现在注册源改用 `listModels(provider)`（已按用户配置过滤）。相关规则见
`src/core/catalog.ts`：
- 白名单非空 → 只放名单内的；
- 逐模型显式 `false` **优先于**白名单；
- **从未配置可见性 → 全部关闭**（安全默认，因此换模型没有候选）。

### 跨厂商执行（`delegateStream`）

瓶颈：宿主的 `GenerateOptions.provider` 由路由决定，一个 adapter **不能**以别家身份发请求。

解法：注册表（`src/vendors/model-catalog-registry.ts`）除了模型清单，还登记各家的
`stream`。换到别家时由 `delegateStream(target, options)` 调**目标那一家的 adapter**：

- 只换 `provider` / `model` 两个字段，`messages` / `tools` / `signal` 原样透传
  （测试用引用相等钉住）；
- 目标家没登记或没 `stream` → 返回 `undefined`，调用方按「换不了」处理（**不硬切**）；
- 官方直连**永不**被委托（挑候选时排除一次，`delegateStream` 里再挡一次）。

### 三个 adapter 里的换模型分支

在 `rotation.pick()` 返回空（所有账号都被拒绝）之后：

```
① 同 provider 有同名候选 → 换 model id、清 tried、continue（不走递归！）
② 别家有同名候选 → delegateStream(...)，把流接过来
③ 都不能 → 抛原来那个失败
```

两个必须记住的坑：

- **不能递归调 `this.stream()`**：那会重跑 `beforeRequest`（可能再次触发账号切换）并把
  `tried` 清空。实测表现是「换模型后又用空密钥重试一次」（`gateway.keys` 里多出一个空串）。
- **只在「确实有账号被拒绝」时才尝试**（`lastFailure` 存在且不是 `invalid-credential`）。
  一条凭据都没解析到时直接抛 `MISSING_CREDENTIAL`，不为此去打目录端点 —— 「一条密钥都没有
  时零 HTTP」是既有纪律，不该为换模型让步。

### 候选缓存

`modelCandidates()` 带 60 秒 TTL。真实填充路径是**适配器读目录成功时**顺手
`noteCatalogModels`（本来就要为模型选择器读），不在失败路径上现打三家端点。

### 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/core/model-fallback.ts` | 纯判定：`isOfficialProvider` / `modelKeyOf` / `pickFallbackModel` / `fallbackEffort` |
| `src/vendors/model-catalog-registry.ts` | 跨厂商候选 + `delegateStream` / `canDelegate` |
| `src/vendors/*/adapter.ts` | 换模型分支（同家换 id / 跨家委托）、`#fallbackModel`、`listModels` 里 `noteCatalogModels` |
| `src/vendors/*/index.ts` | 登记目录读口 + `stream` 委托入口 |

---

## 三、测试锚点

| 文件 | 钉住什么 |
| --- | --- |
| `tests/core/model-fallback.test.ts` | 同名判定、排除官方、不猜档位、思考强度回落 |
| `tests/core/fallback-scope.test.ts` | **候选只来自可选范围**；被关掉的同名模型不会被选中 |
| `tests/vendors/model-delegation.test.ts` | 委托只换两字段、不能委托时返回 `undefined`、官方永不被委托 |
| `tests/client/container-simulation.test.ts` | 账号级轮播真的换账号（CC → OC → CC）、跳过无账号的家 |
| `tests/client/sidebar-card.test.ts` | 两行版式、整卡点击、缺档不占位 |

---

## 四、仍需知道的边界

1. **adapter 只能服务自己的 provider** —— 这是宿主的契约，不是本包的取舍。跨厂商换模型
   靠 `delegateStream` 转给目标家的 adapter，前提是那家**已在同一进程 apply 过**。
2. **委托是一次性的**：目标家自己再遇到限额不会继续往下换（避免跨厂商来回弹球）。
3. **不可见模型 = 没有候选**：如果用户把所有模型都关掉，换模型不会发生。这是刻意的安全默认。
4. **轮播不会为空转**：`targets.length <= 1` 时不排定时器；一个账号都没有时卡片显示空态。

