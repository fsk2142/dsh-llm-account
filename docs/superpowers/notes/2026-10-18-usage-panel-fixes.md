# 用量面板返修：账户信息超时、平铺列表、转到设置、按账户刷新（2026-10-18）

日期：2026-10-18
项目：`dsh-llm-account`
范围：`src/vendors/usage-remote.ts`、`src/client/**`（仪表盘、账户面板、接缝层、样式、文案）与十条级测试
背景：用户带一张用量面板截图提了五件事 —— 「经常获取不到账户信息」「不要按供应商分组，直接显示
账号信息和对应供应商」「面板再增加一个转到设置」「重新获取模型应该刷新单个账户而不是所有」
「每个账户缺少单独刷新的按钮」。本轮全部落在客户端与 usage 远程服务，不动账户/切换/额度语义。

## 1. 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| 经常获取不到账户信息 | 单账号额度读取预算 8s，而 Command Code 端口是 `whoami` → 三端点并行的**两跳**，慢网下每跳 4-5s；端口自身端点预算 300s。8s 必然砍掉正常读取 | `QUOTA_READ_TIMEOUT_MS` 8s → **30s**，超时后**重试一次**（只重试超时，确定性失败不重试）；失败项改用**账号名称**（不再泄漏内部 ref） |
| 不要按供应商分组 | 旧仪表盘按厂商分 section，两个标题两个区块 | 平铺列表：所有厂商的账号一份列表，供应商是账号名后的**徽标**（`data-account-vendor`，与设置页账户行同一类）；兜底窗口与固定标注按账号**自己所属厂商**算 |
| 面板增加「转到设置」 | 宿主**没有**「打开设置对话框」的插件接缝（设置开关住在 ui-settings-general 的模块级 store，未注册为 cordis 服务；`ctx.layout` 只有 `selectPanel`/`toggleSidebar`/`openRightbar`/`closeRightbar`；shortcuts 不能程序化触发 —— app.asar 逐一排除） | 把**同一份设置页组件**注册进 `main` 插槽（key `llm-account-settings`，宿主明文支持的 keyed 面板）；按钮调 `layout.selectPanel`，宿主没这个接缝时用 `canSelectPanel` 探针**不渲染**按钮；面板带返回栏回仪表盘（不是 `selectPanel(null)`：用户从仪表盘来的） |
| 重新获取模型应刷新单个账户 | 旧实现是面板头部一个全局按钮 + 计数器，点了对**全部厂商**重读 | 全局按钮删除；**每个账号行**一个刷新按钮（`data-account-refresh-models`），回调带厂商：目录是厂商级资源（`models()` 按厂商寻址），一次读取惠及该厂商所有账号但不碰别家；加载中禁用并转圈（`aria-busy` + `dsl-spin`） |
| 每个账户缺少单独刷新按钮 | 同上 | 账号行动作区第三个图标按钮；模型区读失败时的「重试」与它是同一个动作 |

附带：仪表盘与账号级的失败项，给人话文案（超时 →「读取超时」），原文留在 `data-failure-detail`
上 —— 把 `timeout after 30000ms` 印在界面上就是调试输出。（2026-10-18 第二轮把这条纪律
推广成 `client/failure-text.ts` 的逐条本地化，见 `2026-10-18-usage-panel-round2.md`。）

## 2. 关键决策与依据

- **「转到设置」= 主栏面板而不是对话框**：宿主没有打开设置对话框的插件接缝（本轮大量逆向
  app.asar 证实，注释留在 `SETTINGS_PANEL_ID` 上）。`main` 插槽的 keyed 面板是宿主明文支持的
  扩展点（Plugins 页、任务管理器同款），所以「转到设置」在主栏打开同一份设置页组件，带一条
  返回栏。页面工厂由 `index.ts` 用宿主绑定的 `t` 造，经 `shell.ts` 透传给 `registerSharedSurfaces`
  （`settings.section` 的页面与这个面板是同一份组件的两个实例、两个 React 根）。
- **按账户刷新的回调带厂商不带账号**：目录是厂商级资源，按钮在账号行上只是因为「用户在那里」。
  把 ref 也传进容器只会得到一个无法使用的参数 —— 不制造假参数。
- **刷新不再走计数器 effect**：旧实现 bump 一个全局计数器让「读全部厂商」的 effect 重跑，与
  「不是刷新所有的」直接矛盾。改成容器里一个 `refreshVendorCatalog(vendor)` 直接读一家，
  挂载时的「读全部」effect 依赖里去掉计数器。
- **失败文案分两层**：可见文本是人话，宿主原文进 `data-*` 属性。内部 ref 一律不上屏（账户行
  2026-10-17 的纪律，本轮把 usage 远程面的失败项与切换记录两条漏掉的路径补齐）。

## 3. 验证

- `vitest run`：**620 通过 / 0 失败**（46 个文件）。新增/重写：`createSettingsPanelView` 与
  `registerSharedSurfaces` 的页面工厂分支、`canSelectPanel` 只探不发、仪表盘「转到设置」按钮的
  渲染门禁、账号行刷新按钮（含禁用/转圈）、容器仿真里「点账号行刷新只重读那一家」与
  「转到设置 → 返回栏」两条全链路；`usage-remote` 补超时重试与文案两条回归。
- `tsc --noEmit` 通过；`tsdown` 构建通过（`lib/client.js` 里 `llm-account-settings`、
  `data-account-refresh-models`、`dsl-settings-panel` 均在）。
- 未提交 git（与上一轮相同，等用户验收后再决定提交）。

## 4. 已知边界

- 「转到设置」与设置页面板都依赖宿主真的提供 `layout.selectPanel` 与 `main` keyed 面板 ——
  这两条是旁证（旧插件产物）而非真机实测，真机验收（计划 1c）时要 first-class 验证。
- 假宿主 `fakeHost` 新增按厂商给账号行的选项（`accounts`），侧边栏卡片的空态文案仍依赖缺省空账号。
