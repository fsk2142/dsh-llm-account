# 侧边栏轮播、账户标记与刷新间隔（2026-10-18 22:50）

## 1. 「已指定」→「当前使用」

仪表盘每个账号以前可能同时出现「生效中」与「已指定」两个徽标，用户读起来像「每个账户都被指定了」。
现在每家**只标一个** `data-dashboard-current`：

- 这家有生效账号（`effective`）→ 标它（自动轮换后的真实服务者）；
- 没有生效账号 → 退回设置里选中的那个（`active`）；
- `pinned` 徽标整块删掉（`data-dashboard-pinned` 不再渲染）。

**账户切换不跨厂商**：每个厂商各有独立的 `RotationEngine`（各自账号表、各自额度），一家用完
只会切到同一家的下一个账号 —— 这条本来就是这么实现的，本轮没有放松。

## 2. 侧边栏轮播

- `page-state.ts` 新增 `sidebarVendorsOf()`：按标签页顺序列出**所有**开启侧边栏额度的厂商。
- `seams.ts` 的侧边栏卡片：`vendors` 列表 + `turn` 计数，每 `sidebarRotateMinutes` 分钟切下一家
  （取模循环）；只有一家时不排定时器，行为与从前完全一致。
- 每次切换都会读该厂商的 `status()`，卡片显示它「当前使用」账号的额度（同一套渲染）。
- 新设置字段 `sidebarRotateMinutes`（三家 Config 都有，默认 1，夹在 1–60 分钟），设置页
  「集成与显示」卡片可改。

## 3. 刷新间隔到底有没有用

以前 `quotaRefreshMinutes` **只**驱动侧边栏轮询；设置页的状态读取缓存写死 60 秒 TTL，
于是用户「每次点设置都看到它自己刷新」，改设置毫无感觉。现在：

- `ReadingCache` 的 TTL 可以是函数；`noteSidebarSnapshots` 把 TTL 设成
  `quotaRefreshMs(quotaRefreshMinutes)` —— 设 10 分钟就 10 分钟内重开设置吃缓存。
- 侧边栏控制器 effect 的依赖从「设置修订号」改成「两个间隔的取值指纹」（`refreshKey`）：
  宿主每次重读设置都给新对象，用修订号会让「打开设置页」白读一次状态。

验证：`tsc` 0 错；61 文件 / 814 例全绿；`tsdown` 已重建。

## 4. 2026-10-18 23:20 三处返修

**a) 从用量面板「转到设置」后无法下滑**
`createSettingsPanelView` 把页面塞进主栏插槽，但 `.dsl-settings-panel` **没有任何样式**：
宿主给槽位固定高度、内容溢出即被裁掉。补三条规则：面板 `height:100% / min-height:0 / overflow:hidden`，
返回栏 `flex:none`，页面根 `flex:1 1 auto / min-height:0 / overflow-y:auto` —— 滚动由我们接管。

**b) 轮播遇到没登录账号的厂商会显示「未配置」**
轮播每切到一家都会读一次 `status()`；读到「这一家没有任何已配置账号」就**立即跳到下一家**
（`skips` 计数保证一轮之内不会空转：全都空的就停在最后一家显示空态）。
用户要求的是「跳过」，不是「把未配置栏摆出来」。

**c) 设置页里两个「保存」**
网页搜索卡片自带保存按钮，与厂商表单的保存条同时出现，文案都是「保存」。
现在：网页搜索的按钮改名为 **「保存搜索设置」**，并且**没有改动时禁用**（`dirty` 由草稿与存储值比较得出）。
两个按钮仍各管各的命名空间，但视觉与语义不再重复。

测试：container-simulation +1（跳过未配置厂商）、既有侧边栏用例补账号（避免触发跳过）；
web-search-card / panel 全过。61 文件 / 816 例全绿。

## 5. 2026-10-18 23:40 去掉「转到设置」/ 额度缺数字 / 统一保存

**a) 「转到设置」整套删除**（用户要求）
`DashboardProps.onOpenSettings`、`SETTINGS_PANEL_ID`、`createSettingsPanelView`、
`registerSharedSurfaces` 的 `pageComponent` 参数与主栏第二条注册、`dashboard.openSettings` /
`dashboard.back` 文案、`.dsl-settings-panel` 样式**全部移除**。主栏 now 只有用量仪表盘一条；
设置页仍通过 `settings.section` 正常注册（`applyShell` 的 `pageComponent` 不动）。

**b) OpenDesign 有额度条但没有数字（真 bug）**
真机快照显示 5h/weekly 两个窗口只有 `resetAt`、没有 `used/cap`。原因：`vela billing preflight`
的 `usedCredits` / `limitCredits` 是**字符串**（`"906"` / `"50000"`），而 `numberValue()`
只认 `number`。修：接受数字字符串（trim + Number + isFinite），补一条字符串负载的回归测试。
修后快照：5h `$0.0906 / $5`、weekly `$0.0906 / $15`、monthly `上限 $120`。

**c) 网页搜索的保存按钮并入设置页唯一「保存」**
- `useWebSearchPanel(ctx, t, controls?)` 新增两个可选控制口：`saveRef`（把内部 `save()` 交出去）
  与 `onDirty`（脏状态上报）。
- 卡片不再渲染 `data-web-search-save`（连同 `saving` 文案位）。
- 页面容器：`webSearchDirty` → `PageShell.webSearchDirty`，保存条在「厂商字段脏 **或** 网页搜索脏」
  时出现；`onSave` 先 `void webSearchSave.current?.()` 再写厂商字段（两个独立设置行，互不阻塞）。

结果：`tsc` 0 错；61 文件 / 813 例全绿；`tsdown` 重建。
