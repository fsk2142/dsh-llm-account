# 兼容性与插件冲突审计

日期：2026-10-19（本轮）
范围：本包与**宿主自带插件 + 已装第三方插件**的接触面；方法是对 `app.asar` 与
`~/.dsh/profiles/desktop/node_modules` 做静态扫描，再跑既有兼容性测试。

## 结论先说

**没有发现 id 冲突，也没有发现会导致异常的跨插件耦合。** 逐项证据如下。

| 接触面 | 我们的用法 | 冲突情况 |
| --- | --- | --- |
| `settings.section` 插槽 | `id: "llm-account"`，`order: 12` | 宿主自带 `general` / `account` / `models` / `plugins` / `agent-presets`；第三方 save-token `save-token`（order 430）、market `market`（order 40）—— **无同名** |
| `main` 插槽 | `key: "llm-account-dashboard"` | 宿主自带 `conversation` —— **无同名** |
| `sidebar.footer.action` 插槽 | `id: "llm-account-quota"` | 宿主自带 `cordis-panel` —— **无同名** |
| 客户端 `inject` | `slots, locale, remote, remote.settings` | 都是宿主基础服务；缺任何一个都会显式报错而不是静默（见下） |
| 宿主事件 | `settings/document-updated`、`credentials/reference-updated` | 都是宿主广播的公共失效信号，多插件同时订阅是设计意图 |
| 宿主设置行 | 只写**自己**的三个行（`llm-commandcode` / `opencode-go` / `opendesign`） | 不碰 `agent-default-model` / `web`（见下） |
| 宿主服务键 | 只注册 `llmAccountUsage`（typert remote） | 键名带包名，不会撞 |
| CSS | 全部 `.dsl-*` 前缀 + `data-plugin-css` 幂等注入 | 无 `!important`、无 `:root`/`body` 覆盖、不改宿主节点 |
| DOM | 只 `querySelector` 自己的 `<style>` | 不改写宿主 DOM；market 只给自己那一行加图标（`data-dsh-market-nav-icon` 标记），不碰我们 |

## 三个值得记录的点

### 1. 曾经有过一个真实的跨插件写（已移除）

早前版本会读宿主行 `agent-default-model` 推断「当前模型供应商」。这属于**依赖别的插件的
数据**，与本包「只做兼容、不做依赖」的纪律相悖。改用「最近一次请求的账号」（本包自己的
台账）之后，这个跨插件读取**整个删掉了** —— 现在 `seams.ts` 里搜不到
`readActiveModelRoute` / `agent-default-model`。

副作用：接触面少了一个，冲突风险也少一处。

### 2. `inject` 缺一项的失败模式是「静默空白」，所以固定写死

`remote.settings` 必须列在顶层 `inject` 里。实测（2026-10-17 桌面端 0.2.1-rc.2）：缺了它，
`remoteOf()` 会按「拿不到就降级」返回 `undefined`，于是设置页显示「没有可显示的厂商」——
**看起来像没有配置，而不是像错误**。这条注释在 `src/client/index.ts` 里保留了现场证据。

`remote.credentials` 用**嵌套** inject（`ctx.inject(["remote.credentials"], …)`），因为页面
主体不需要它（只有设置页里的凭据判断需要）。

### 3. 注册生命周期比 id 更容易出事

真正造成过故障的不是 id 冲突，而是**重复注册**：`slots.inject` 的回调会被多次调用，若每次
都 `register` 就会累积多份同 id 条目。三处（设置页 section、侧边栏卡片、主栏面板）都是
「先 `unregister?.()` 再 `register`」，并各自用 `WeakSet<object>`（按宿主上下文）判重，
失败时不写标记（下次槽位变化会重试）。

`tests/client/shell-registration.test.ts` 与 `bundle-smoke.test.ts` 钉住这两条：同上下文
重复 apply 不重复注册、新上下文必须重注册。

## 已知的非问题

- **market 的导航图标选择器**（`[role="dialog"] nav button`）会命中我们那一行，但它只对
  带自己标记的行生效，且每次 sync 重读 —— 我们改 label 语言时它跟随，不会报错。
- **`sidebarRotateMinutes`** 那个设置字段已从三家 Config 移除。schemastery 对未声明字段
  原样保留，所以用户文档里的旧值不会被抹掉，只是不再展示、不再参与判定。
- **`showSidebarQuota`** 语义变了（从「限定看哪几家」变成「要不要这个卡片」），但**读法
  兼容**：新字段 `sidebarAccounts` 优先，没有时退回旧开关。

## 验证

- `tests/compatibility.test.ts`（7 条）、`tests/client/boot-graph.test.ts`（5 条）、
  `tests/client/bundle-smoke.test.ts`（1 条）：全绿；
- 全量 895 个用例全绿；
- 静态扫描：`app.asar` 内 7 个 `settings.section`、1 个 `main`、1 个 sidebar id；第三方
  market / save-token 各自 1 个 —— 与我们三个 id 全部不同名。
