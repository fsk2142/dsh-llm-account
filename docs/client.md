# 客户端：启动图、界面结构与用量面板

客户端跑在宿主的浏览器环境里，受两条**硬约束**（行名解析、注册时机）与一套共享设计语言约束。
改动任何插槽组件、样式或页面结构之前，先看「启动图」一节 —— 那里记的都是会让人排查半天的坑。

---

## 启动图：行名的两个实测约束（2026-10-17）

日期：2026-10-17
项目：`dsh-llm-account`
本机：桌面端 `0.2.1-rc.1`（`ed75efe`），profile `desktop`，本包以 `link:` 装入且已进 `bundles`。

## 0. 症状与结论

宿主侧全绿（`/dsh-market/check` 零 error、两行齐全、user-patch override 生效、`dsh-llm-account/commandcode` 与 `…/opencode` 都能被 Node 解析并加载），但重启后**设置页与侧边栏完全看不到本包 UI**。

结论：`cordis.patch.yml` 两行的 `name` 都用了**子路径说明符**，而宿主 `client-modules` 的启动图扫描**不认子路径行名**——`./client` bundle 从未进入浏览器启动图。修法已落进 `cordis.patch.yml`。

## 1. 证据链

- 客户端插件到达浏览器的唯一通道是启动图（`window.__DSH_BOOT__` + `/plugins` 路由；见 `app.asar` 内 `@deepseek-ai/dsh-client-modules` 的 README 与实现）。
- 运行中宿主的启动图可匿名读取：`GET http://127.0.0.1:6900/plugins/events`（SSE，每个新连接先收完整图）。
  实测 78 个 entry，`dsh-llm-account` **不在其中**；其余第三方插件（`dsh-better-sidebar`、`dsh-context`、`dshmarket`、`dsh-plugin-save-token`、`@changfenhuang/dsh-genui`）都在。`/plugins/<id>/client.js` 不带 `?rev=` 一律 404（正常）。
- 扫描实现为 `app.asar` 内 `@deepseek-ai/dsh-client-modules` 的 `ClientModuleRegistry`（本文引用的行号来自 2026-10-17 的反汇编快照）。

### F1 子路径行名不产生 source（静默）

`locatePkgJson(loaderName, baseUrl)`：

```js
const pathLike = loaderName.startsWith(".") || loaderName.startsWith("file:") || isAbsolute(loaderName);
const expectedPackageName = pathLike ? void 0 : exactPackageSpecifier(loaderName);
if (!pathLike && expectedPackageName === void 0) return void 0;
```

`exactPackageSpecifier` 的文档注释写明：**「子路径、路径、带 scheme 的说明符一律 undefined」**。于是 `dsh-llm-account/commandcode` 与 `dsh-llm-account/opencode` 两行都在第一道门被丢弃：`locatePkgJson → undefined` → `resolveMeta` 返回 `null` → `resolveSource` 无 source → 该包**永远不进启动图，且不抛错、不告警**。

### F2 一个 `dsh.client` 包只能有一个 source

`reconcilePackage(packageName)`：

```js
if (sources.length > 1) {
  throw new Error(`client-modules: package ${packageName} resolves from multiple active Loader sources: …; remove one entry`);
}
```

且 `ClientModuleRegistry` 构造器在 flush 后只要收集到 error 就 `throw new ClientPackageCompositionError(failures)`——失败的是**这个服务 fiber 本身**，即整个客户端模块系统起不来。所以「两行都改成可见名」不能做：会把「没有 UI」升级成「整页客户端全挂」。

路径名的可见分支：`pathLike` 为真时用 `internal.resolveSync(baseUrl, { specifier })` 解析，再 `nearestPackage(moduleUrl)` **向上**找第一个带字符串 `name` 的 `package.json`——指向包内任一文件（如 `lib/opencode.js`）即命中本包根（声明 `dsh.client` 的那个 manifest）。

### F3 插入行的路径名以 **patch 文件所在目录** 为基准（这条把修复又推翻了一次）

`dsh-app-boot` 的 `parsePatchList` 末尾会跑 `anchorInsertedPluginNames(patches, file)`：

```js
const base = dirname(resolve(file));            // = 本包根（patch 文件所在目录）
if (isAbsolute(entry.name) || entry.name.startsWith("./") || entry.name.startsWith("../"))
  entry.name = pathToFileURL(resolve(base, entry.name)).href;
```

即：**插入行里的相对路径不是相对 profile，而是相对这个 bundle 自己的 patch 文件**。因此第一次修复用的 `./node_modules/dsh-llm-account/lib/opencode.js` 被改写成
`file:///D:/work/repo/node_modules/dsh-llm-account/lib/opencode.js`——不存在；加载器导入抛 `ERR_MODULE_NOT_FOUND`，`Entry._init` 只 `logger.error` 后 `return`，**`entry.fiber` 从未赋值**；`processOne` 的 `entry.fiber === void 0` 过滤把它静默跳过，于是启动图里依旧没有本包，客户端零报错。

本机复现（`node --expose-internals` 直接调宿主的 `internal.import` / `internal.resolveSync`）：

```
anchored to : file:///D:/work/repo/node_modules/dsh-llm-account/lib/opencode.js
IMPORT      : FAILED -> ERR_MODULE_NOT_FOUND
--- 改成 ./lib/opencode.js ---
anchored to : file:///D:/work/repo/lib/opencode.js   (exists)
IMPORT      : OK -> Config,PROVIDER_ID,apply,inject,name
package     : dsh-llm-account | dsh.client: {"platform":"web",...}
client.js   : D:\work\llm-acct-repo\lib\client.js exists: true
```

顺带排除的两条：`preflight`/`prepareProfileEntries` 的兼容性判定（只校验 `engines.dsh` 或 `@deepseek-ai/dsh-*` 主机 peer，本包已含 `0.2.1-rc.1`，不会被 `disabled: true`）；profile 的 `cordis.yml` 根条目列表是 `[]`，两行确实由 patch 插入。

### F4 桌面端升级后 peer 闸门把整包静默禁用（让前两次修复全部白做的第三条）

桌面端在 17:20:50 落到 **0.2.1-rc.2**（`@deepseek-ai/dsh-*` 全线 rc.2、cordis 4.0.5、schemastery 3.18.5）。本包 `dsh-*` peer 只写到 `0.2.1-rc.1`，于是宿主解析 patch 时的兼容性预检把**两行都判为不兼容**：

```
dsh-app-boot  prepareProfilePatches → preflight → denial(row, base)
  manifest = manifestOf(ctx, row.name, base)      // 顺着行名找到本包 manifest
  issue = evaluatePluginCompatibility(manifest, exemptions)
  → deny(row, issue)  ⇒  row.disabled = true
```

只有一行 stderr（`dsh: disabling profile plugin row "opencode-go": ...`），UI 与启动图零痕迹。链路：行被 `disabled` → 加载器不导入 → 无 fiber → 客户端扫描的 `entry.fiber === void 0` 过滤跳过 → 启动图无本包 → UI 无。**这解释了为什么 F1/F3 修对了、两次重启仍然毫无变化**：rc.2 在第一次重启前就已经在磁盘上了。

判定规则（`unmetRequirements`）：`engines.dsh` 若存在则**独自**决定、peer 全部忽略；否则每一条 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` peer 都必须 `semver.satisfies(runtime, range, { includePrerelease: true })`。**cordis / schemastery 这类非 `dsh-*` peer 不参与闸门**，所以市场检查里那几条 peer 警告与能否挂载无关。

**市场 `/dsh-market/check` 不能替代这个闸门**：它把 peer 与 profile 里 pnpm 解析出的版本比（本机仍是 `0.2.0-rc.2`），而闸门比的是**运行时 app-boot 的版本**（`0.2.1-rc.2`）。前者 `satisfied: true`、后者 DENIED 可以同时成立。

### 四条约束合起来

| 行 | `name` | 为什么必须是这个形态 |
| --- | --- | --- |
| `llm-commandcode` | `dsh-llm-account/commandcode`（子路径） | 加载器挂载用；对扫描不可见（F1），因此不与下一行争 source；用户 patch 按 id 覆盖它 |
| `opencode-go` | `./lib/opencode.js`（包内相对路径） | 扫描可见（F1）+ 以 patch 文件为基准后真实存在（F3）+ `nearestPackage` 命中本包根；一个包只能一个 source（F2） |

此外整包必须通过 F4 的版本闸门——`dsh-*` peer 范围要跟桌面端 rc 一起长，由 `tests/compatibility.test.ts` 逐版本锁死。

## 2. 落下的设计（`cordis.patch.yml`）

- 行 id 保持 `llm-commandcode` / `opencode-go`（用户 profile patch 的按 id 覆盖、设置命名空间、provider id 全部不变）。
- `llm-commandcode` 行保持子路径名：加载器照常挂载；对扫描不可见，**不参与 source 竞争**。
- `opencode-go` 行改为**包内相对路径** `./lib/opencode.js`：扫描可见、`nearestPackage` 命中本包，成为唯一 source；它挂载的模块与 `./opencode` 子路径导出是**同一个产物文件**，opencode provider 行为不变。
- 设计文档 §5.1 的两行写法以本包 `cordis.patch.yml` 为准（`opencode-go` 一行被此约束取代）。

加载器一侧：相对名确实是加载器的一等用法（`name: ./plugins/app`，见 `@deepseek-ai/cordis-plugin-loader` README），但**基准由 patch 解析阶段改写**（F3），所以语义是「相对本包根」。别用裸包名去凑可见性：裸名/子路径虽能挂载，却都过不了扫描（F1）。

## 3. 锁定

`tests/client/boot-graph.test.ts` 镜像 `exactPackageSpecifier` / `pathLike` 判定与 `anchorInsertedPluginNames`，断言：两行 id 不变、**恰好一行**扫描可见、可见行是 `opencode-go` 且名字为 `./lib/opencode.js`、`commandcode` 行保持子路径、**每个路径行以 patch 所在目录为基准改写后必须真实存在**（这条正是杀死第一次修复的原因），外加 `./client` 导出与 manifest `icon` 存在。

## 4. 复验方式（对 1c 清单的补充）

1. 重启桌面端后重新 `GET /plugins/events`（端口每次启动都变，先从 `DeepSeek Harness` 进程持有的端口里探测）：`dsh-llm-account` 应出现在 `entries` 与某个 application batch。
2. 用图里的 `url`（形如 `plugins/??dsh-llm-account/client.js&rev=…`）拉取：应 200，body 含 `window.__ModuleLoader__.load({ id: "dsh-llm-account"`。
3. 然后才看 UI：设置页出现统一段落、侧边栏底部出现额度卡（验收口径见设计文档与计划）。

桌面端升级后重复第 1 步之前，先跑 `tests/compatibility.test.ts`（或把它支持的版本加进去）——F4 的闸门失败时第 1 步必然失败。

## 5. 图标接缝（顺带实测）

- **插件清单的图标**：宿主把**包根 manifest 的 `icon`**（或导出 `<specifier>/icon`）转成 base64 data URL 供给插件列表（依据：`app.asar` 内插件清单 API 的 zod 描述——「Base64 image data URL from a package root's manifest icon or an exported `<specifier>/icon`; render as an image, not inline markup.」）。已按 `dsh-better-sidebar` / `dsh-context` 的先例补 `"icon": "./icon.svg"` 与 `icon.svg`。
- **设置导航的 glyph**：`settings.section` 槽位只投影 `id` / `order` / `label`，第三方 section 一律拿外壳的齿轮兜底；`dshmarket` 与 `dsh-better-sidebar` 都是**挂载后自己认领导航行**、用 CSS `mask-image` 换图（`dshmarket/src/client/settings-nav-icon.ts` 的注释把这条讲得很全）。本项目暂不认领；若需要导航行专属图标，按同一手法实现（按 label 认领行 → 标记属性 → 注入 mask 样式 → 随 `ctx.effect` 清理）。


---

## 界面重做：三处界面共用一套设计语言（2026-10-17）

日期：2026-10-17
项目：`dsh-llm-account`
范围：`src/client/**`（样式、账户卡片、模型卡片、侧边栏卡、仪表盘）与两条新增测试
背景：上一轮把客户端「接进了宿主」，但截图仍然像调试输出——按钮一排五个带边框、额度只有
「标签 …… 数字」没有条、说明文字把标签挤成竖排单字、菜单项平铺在行里。这次只改表现层，
数据判定、远程契约、账户语义一律不动。

## 1. 先说结论：改了什么

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| 账号行 | 身份、额度、5 个带边框按钮、拖拽手柄挤在同一行 | **身份行**（状态点 + 名称 + 标记 + 两个图标动作）+ **额度表**（每窗口一块，标签/读数一行、4px 进度条一条） |
| 行内动作 | 展开报告、重命名、换密钥、固定、移除全部平铺 | 展开/收起是箭头图标（`aria-expanded` 同时驱动语义与旋转）；其余收进 `⋯` 原生 `<details>` 菜单，排序的上移/下移也在菜单里 |
| 额度条 | 条没有 `display`，实际**画不出来**；档位属性与样式选择器名还对不上（`data-level` vs `data-quota-level`），颜色永远不生效 | 条真正可见；档位选择器与属性统一为 `data-quota-level`；ok/warn/error 三色 |
| 设置行 | 说明与输入框一起挤标签列，「用量刷新间隔（分钟）」竖排单字 | 标签 + 说明在左列，控件固定宽度在右；输入框 240px / 数字 140px / 下拉 180px |
| 布尔设置 | 浏览器默认复选框 | `appearance:none` 画出来的滑轨开关（34×20），勾选态用宿主的强调色 |
| 模型卡片 | 每行一个红色「移除」文字按钮 | 名称 + 滑轨开关 + 悬停才变色的「×」图标按钮 |
| 添加账户 | 标签与输入同行、入口与提交共用一个按钮 | 收起时一个虚线入口；展开后是「标签在上、输入占满整行」的表单，提交/取消独立 |
| 登录 | 通栏空面板里放一个按钮 | 行内按钮；等待中的说明与授权网址放在内嵌面板里 |
| 侧边栏卡 | 无进度条、刷新与打开是两个通栏按钮、切换提示是橙色裸文本 + ISO 时间 | 标题 + 刷新图标一行；切换提示是琥珀色小条（相对时间）；额度是紧凑列表 + 条；底部一个通栏按钮 |
| 侧边栏**收起态** | 整张卡向左溢出到窗口外（真机实测槽位只有 ~35px） | 外壳是宽度容器：窄时只渲染一个「用量」图标按钮，宽时才是完整卡片（`@container`） |
| 仪表盘 | 浏览器默认 h2/h3、账号块不是卡片、切换记录是 ISO 时间 | 标题行 + 图标动作；每个账号一张卡片（生效账号用强调色描边）；切换记录右端相对时间 |
| 空态 | 空列表与读取失败都用同一种裸段落 | 列表空态是虚线框；「数据暂不可用」是安静的一行说明（不再套第二个虚线框） |
| 焦点 | 没有焦点环（键盘操作不可见） | 统一 `2px` 焦点环，颜色回落 `--dsw-alias-state-business-primary` |

## 2. 样式表（`src/client/css.ts`）的纪律

- **只用宿主 `--dsw-*` 变量**，没有硬编码颜色；`tests/client/css.test.ts` 仍在逐条守着。
  - 注意：`white-space` 会命中那条「颜色名」正则（`white`），排版一律用 `text-wrap: nowrap`。
- 变量名逐个核对自**本机桌面端主题包**（`dsh-client-ui-theme/lib/client.js` 里的 CSS 串）与前端
  产物；本轮补齐了此前用错/不存在的几项：
  - `--dsw-radius-*`、`--dsw-shadow-lv3`、`--dsw-font-family`、`--dsw-font-mono`、
    `--dsw-alias-settings-card-fill/stroke`、`--dsw-static-neutral-bluish-00`（开关滑钮）。
  - **焦点环**：`--dsw-focus-ring-color` 在宿主里是动态值（默认仅声明了宽度），因此一律写成
    `var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`，否则 `solid` 缺色会让整条
    `outline` 失效。
- 新类名都在 `CSS_CLASS` 注册，并由 `tests/client/style-contract.test.ts` 的「每个按钮都有档位类、
  每个类名在样式表里都有规则」两条守着。
- 新模块：`icons.ts`（5 个 16×16 线性图标，`currentColor`）、`time.ts`（相对时间，纯函数）。

## 3. 真机验证（不重启桌面端也能看）

桌面端 21:48 启动时 `lib/` 不存在，因此**当前桌面端实例里没有本包 UI**；`lib/` 已重新构建，重启
桌面端即可看到（`/plugins/events` 里会出现 `dsh-llm-account`）。

为了在不重启桌面端的前提下把 UI 放进真实宿主里看，用了两条通道：

1. **静态预览**（`D:\work\.preview`，不在仓库内）：Vite + React 直接渲染 `PageShell` /
   `AccountCard` / `ModelsCard` / `SidebarCard` / `Dashboard`，样式表与**真实主题 token** 来自
   `app.asar` 里的 `dsh-client-ui-theme`；Chrome headless + CDP 截图。用于逐状态（干净/有改动/
   展开报告/编辑器/菜单展开/暗色）比对。
2. **第二个 web profile**（`~/.dsh/profiles/web`，由 `dsh plugin --profile web add
   link:D:/work/repo` 初始化，bundle 自动登记）：`dsh web --no-open --port 6901` 起一个
   独立实例，用 Chrome 打开打印出来的 token URL，实测：
   - 启动图包含本包（`/plugins/events`），`settings.section` 出现「LLM 账号」；
   - 两个厂商标签页都能被发现（`llm-commandcode`、`llm-opencode-go`）；
   - 账号数据（`Default` / `COMMANDCODE_API_KEY` / `monthlyCredits`）经真实远程面读回；
   - 侧边栏收起态显示图标按钮、展开态显示完整卡片；
   - 「打开用量面板」在中栏渲染仪表盘；保存条在有改动时出现（`data-save-bar`）。
   该 profile 里我们的设置被保存过一次（`showSidebarQuota: true`），不影响桌面 profile。

重启桌面端后的复验顺序：设置页 → LLM 账号（两标签页、账号行、模型、字段、高级设置）→ 侧边栏
底部（展开/收起两种形态）→ 打开用量面板。

## 4. 测试

- 全量：`pnpm test` — 35 files / 518 tests 通过；`pnpm typecheck` 通过；`pnpm build` 通过。
- `tests/client/style-contract.test.ts`（本轮一并入库）把两条与重做直接相关的结构契约钉住：
  - 账号行仍是两段结构（身份行里有 `dsl-identity`/`dsl-account-actions`，额度条不在身份行里）；
  - 每个按钮都有 CSS_CLASS 里的档位类，每个用到的类名在样式表里都有规则。
- `tests/client/quota.test.ts`（本轮一并入库）新增 `quotaMeter` 的覆盖：单位 0–100、档位阈值、
  `used/cap` 推算式、除零与缺失不画条、越界夹到 0–100。


---

## 用量面板三轮返修（2026-10-18）

> **合并说明（2026-10-20）**：本文件由三份独立记录合并而成 ——
> `2026-10-18-usage-panel-fixes.md`（第一轮）、`…-round2.md`（第二轮）、`…-round3.md`（第三轮）。
> 三轮是同一功能的连续修复，分散在三个文件里读不到完整脉络（尤其「缓存冻结」这条根因
> 横跨第一、二轮）。原文逐节保留，只加了轮次标题；被删文件可从 git 历史取回。
>
> 三轮的共同背景：用户每次验收后带一批具体问题回来，本轮只解决当轮的问题，
> **不动账户/切换/额度语义**（那是 `2026-10-19-rotation-and-model-fallback.md`
> 与 specs 的范围）。

---

# 第一轮：账户信息超时、平铺列表、转到设置、按账户刷新

日期：2026-10-18
范围：`src/vendors/usage-remote.ts`、`src/client/**`（仪表盘、账户面板、接缝层、样式、文案）与十条级测试
背景：用户带一张用量面板截图提了五件事 —— 「经常获取不到账户信息」「不要按供应商分组，直接显示
账号信息和对应供应商」「面板再增加一个转到设置」「重新获取模型应该刷新单个账户而不是所有」
「每个账户缺少单独刷新的按钮」。本轮全部落在客户端与 usage 远程服务，不动账户/切换/额度语义。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| 经常获取不到账户信息 | 单账号额度读取预算 8s，而 Command Code 端口是 `whoami` → 三端点并行的**两跳**，慢网下每跳 4-5s；端口自身端点预算 300s。8s 必然砍掉正常读取 | `QUOTA_READ_TIMEOUT_MS` 8s → **30s**，超时后**重试一次**（只重试超时，确定性失败不重试）；失败项改用**账号名称**（不再泄漏内部 ref） |
| 不要按供应商分组 | 旧仪表盘按厂商分 section，两个标题两个区块 | 平铺列表：所有厂商的账号一份列表，供应商是账号名后的**徽标**（`data-account-vendor`，与设置页账户行同一类）；兜底窗口与固定标注按账号**自己所属厂商**算 |
| 面板增加「转到设置」 | 宿主**没有**「打开设置对话框」的插件接缝（设置开关住在 ui-settings-general 的模块级 store，未注册为 cordis 服务；`ctx.layout` 只有 `selectPanel`/`toggleSidebar`/`openRightbar`/`closeRightbar`；shortcuts 不能程序化触发 —— app.asar 逐一排除） | 把**同一份设置页组件**注册进 `main` 插槽（key `llm-account-settings`，宿主明文支持的 keyed 面板）；按钮调 `layout.selectPanel`，宿主没这个接缝时用 `canSelectPanel` 探针**不渲染**按钮；面板带返回栏回仪表盘（不是 `selectPanel(null)`：用户从仪表盘来的） |
| 重新获取模型应刷新单个账户 | 旧实现是面板头部一个全局按钮 + 计数器，点了对**全部厂商**重读 | 全局按钮删除；**每个账号行**一个刷新按钮（`data-account-refresh-models`），回调带厂商：目录是厂商级资源（`models()` 按厂商寻址），一次读取惠及该厂商所有账号但不碰别家；加载中禁用并转圈（`aria-busy` + `dsl-spin`） |
| 每个账户缺少单独刷新按钮 | 同上 | 账号行动作区第三个图标按钮；模型区读失败时的「重试」与它是同一个动作 |

附带：仪表盘与账号级的失败项，给人话文案（超时 →「读取超时」），原文留在 `data-failure-detail`
上 —— 把 `timeout after 30000ms` 印在界面上就是调试输出。（第二轮把这条纪律
推广成 `client/failure-text.ts` 的逐条本地化。）

## 关键决策与依据

- **「转到设置」= 主栏面板而不是对话框**：宿主没有打开设置对话框的插件接缝（本轮大量逆向
  app.asar 证实，注释留在 `SETTINGS_PANEL_ID` 上）。`main` 插槽的 keyed 面板是宿主明文支持的
  扩展点（Plugins 页、任务管理器同款），所以「转到设置」在主栏打开同一份设置页组件，带一条
  返回栏。页面工厂由 `index.ts` 用宿主绑定的 `t` 造，经 `shell.ts` 透传给 `registerSharedSurfaces`
  （`settings.section` 的页面与这个面板是同一份组件的两个实例、两个 React 根）。

---

# 第二轮：英文、切换记录、缓存冻结、单位、思考档位

日期：2026-10-18
范围：`src/client/**`（`failure-text.ts` 新增、`quota.ts`、`dashboard.ts`、`account-card.ts`、`models-card.ts`、`sidebar-card.ts`、`seams.ts`、`copy.ts`、`css.ts`）、`src/vendors/commandcode/**`（`efforts.ts` 新增、`adapter.ts`、`protocol.ts`、`quota.ts`）
背景：用户验收第一轮后带回六件事 —— ① whoami 用量面板里多了英文；② 不需要保留切换记录；
③ 重新点开设置后原来显示的额度信息又不见了；④ 额度信息带上单位；⑤ 月额度信息也没有
（「无法获取吗？」）；⑥ 选择模型后仍然无法继续选择思考模式。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 面板里有英文 | 诊断原文直接上屏：端点短名（`whoami`、`credits`、`usage`）、宿主包装过的 `quota: commandcode "Work" read failed (timeout after 30000ms)`、以及客户端接缝自己产的 `the llm-account remote namespace has no models()` | 新增 `client/failure-text.ts`：已知形状**映射成人话**（含带引号账号名的包装 →「账号 X 的额度读取失败（读取超时）」），认不出的形状**原样返回**（宿主能力错误要看得见）；原文一律留在 `data-*`（`data-failure-detail` / `data-account-quota-failure` / `data-dashboard-failure` …）。接线的四处：账户卡片（厂商级失败 + 额度失败 + 目录失败）、仪表盘（厂商级失败 + 账号额度失败）、侧边栏卡片、模型卡片（`failureListText` 处理 `；` 连接的多条） |
| ② 不要切换记录 | 记录只说明过去发生过什么，用户要的是「现在哪张卡还有额度」 | 客户端**全部**移除：仪表盘的记录区（读取 + 渲染 + `switches` prop）、`seams.ts` 的 `readSwitches` 与仪表盘加载、`copy.ts` 的 `dashboard.switches`/`dashboard.noSwitches`、`css.ts` 的 `.dsl-switch*`/`[data-switch-record]`/`CSS_CLASS.switchNotice`/`switchRoute`。**宿主侧的 `switches()` 与 `rotation` 的记录保留**（跨行观测要它：设置页/侧边栏跟随真实账号），`switch-card` 的「即将切换」倒计时也保留 —— 那是将来的事，不是历史 |
| ③ 重新打开设置额度又不见了 | **缓存冻结**：一次瞬时失败（单端点超时）的读数被写进 60s TTL 的设置页读数缓存，重开设置直接吃这份残缺读数，看起来像额度凭空消失 | 新增 `seams.ts` 的 `completeReading(status)`：只有**完整**读数够格进缓存（failures 为空 + 每个「已配置」账号都有非空 quota 且 `quota.failures` 为空）；不完整照旧每次现读。三个写缓存点（设置页状态 effect、侧边栏写回、仪表盘写回）都过这道闸 |
| ④ 额度信息带上单位 | 单位是**厂商给的事实**，不能由界面猜 | `QuotaUnit = "usd"`（`core/adapter.ts`），CC 的 `quota.ts` 给每个数字窗口标 `unit: "usd"`（不限窗口没有数字，不标）；界面 `quotaAmount` = `$` + 两位小数（旧插件 `formatMoney` 第 1516 行同一口径：`$7.22`、`$0.12 / $3.00`）；没给单位的窗口照旧裸数字（不替别家猜单位）。原始浮点仍在状态与 `data-*` 里 |
| ⑤ 月额度也没有 | **不是端点故障**：实测 `whoami` → `usage`/`billing/credits`/`billing/window-limits` 四端点全部 200，`usage.totalCredits = 62.2122`；月度额度来自 `usage`，此前只要它那一次读取瞬时失败，界面就只剩失败行 | 同 ③（残缺读数不再进缓存，重开必现读）；并且月度窗口本来就只在 `usage` 给数时才出现（缺失 ≠ 0）。`usage` 失败时窗口列表与失败项分开呈现：读到的照旧显示，失败项给人话 |
| ⑥ 不能选思考模式 | 宿主的档位选择器**完全**由 `resolveModel().reasoning.efforts` 驱动，而 CC 网关的 `/provider/v1/models` 从不公布档位（实测 85 个模型的键只有 `id`/`name`/`reasoning`/`contextWindow`/`maxTokens`）—— 不声明就等于没有档位可选 | 新增 `vendors/commandcode/efforts.ts`：官方 CLI 模型表的静态档位快照（58 个模型，与旧插件 `KNOWN_EFFORTS` 在 command-code@1.79.2 上校验过）；`resolveModel` 用它声明档位（负载自己哪天公布了就以负载为准）；请求路径按表**再收一次口**（宿主的「关闭」会送来 `off`，表里只有部分模型认它；表外的值一律不发字段）；Messages 传输在有可选档位时打开 `thinking: { type: "adaptive" }`（旧插件第 6624 行：那个端点只认 adaptive，且不开它 `output_config.effort` 不起作用） |

## 关键决策与依据

- **本地化 ≠ 抹掉证据**：`failureText` 只翻「认得出形状」的诊断；认不出的原样上屏（宿主能力
  错误 `the host remote service has no $mount()` 这类必须看得见）。每处都保留 `data-*`
  原文属性，排查路径不变。
- **表外模型就是不声明档位**：自动思考、由厂商决定深度的模型（旧插件 `KNOWN_THINKING_MODELS`
  的那批）本来就没有可选档位；猜一组只会换来一个发出去就被厂商拒的请求。opencode 侧无需改动
  —— models.dev 的 `reasoning_options` 已经声明了档位（探测 32 个模型中 26 个有）。
- **`off` 的处理跟着表走**：旧插件把「关闭思考」编码成 `off` 档位，网关对不认它的模型会拒字段，
  所以请求路径校验一次（`supported.includes(...)`），声明与发送同一条纪律。

---

# 第三轮：套餐信息、月度额度、新增账号操作逻辑

日期：2026-10-18
范围：`src/core/adapter.ts`、`src/vendors/commandcode/plans.ts`（新增）、`src/vendors/commandcode/quota.ts`、`src/vendors/usage-remote.ts`、`src/client/**`（`usage-contract.ts`、`quota.ts`、`account-card.ts`、`dashboard.ts`、`accounts-panel.ts`、`seams.ts`、`copy.ts`、`css.ts`）
背景：用户验收第二轮后带回四件事 —— ① 「套餐信息没办法获得吗？我这个是订阅的套餐」；
② 「月度额度也没有显示」；③ 「再添加一个 opencode 的账号添加」；④ 「新增账号那个地方也优化一下
操作逻辑」；另有「再看看还有没有可以优化的地方」。

## 先纠正一个事实：套餐**是**能读到的

第一轮/第二轮的判断（「套餐必须手填」）建立在两把**未订阅**密钥的实测上。本轮把
`~/.dsh/.credentials.yaml` 里**三把** ref 都跑了一遍（脚本 `cc-third.mjs`）：第三把
`DSH_LLM_ACCOUNT_SAMPLE` 正是**订阅账号**，四个端点全绿：

| 端点 | 形态 |
| --- | --- |
| `/alpha/whoami` | `user = sample-user`（user@example.com） |
| `/alpha/billing/subscriptions` | `data = { id: sub_…, status: "active", planId: "individual-goat", currentPeriodStart: 2026-10-14, currentPeriodEnd: 2026-11-14, cancelAtPeriodEnd: false, orgId: null }` |
| `/alpha/billing/credits` | `credits.monthlyCredits = 55.7714050703`（余额）、`purchasedCredits = 0`、`freeCredits = 0`；`windowLimits = { limited: true, fiveHour: { used: 0.0024, cap: 14 }, weekly: { used: 14.2285949297, cap: 35 } }` |
| `/alpha/usage/summary` | `totalCredits = 14.24`、`periodBasis = "billing-period"`、`periodStart = 2026-10-14`（订阅账期，不再是无订阅账号的滚动 30 天） |

三条交叉验证，把「套餐 → 月度配给」这层语义钉死了：

1. `fiveHour.cap = 14`、`weekly.cap = 35` 正好是 **70 的 1/5 与 1/2** —— GOAT 的每月额度是 70；
2. `70 − 55.7714050703 = 14.2285949297` 与该账号 `weekly.used` **一字不差**；
3. 官方 CLI `command-code@1.84.0` 的 `getPlanInfo` / `getPlanTotalCredits` 的静态表
   （`Sr`/`wr`）里 `individual-goat → { name: "GOAT", monthlyCredits: 70 }`，与旧插件
   `KNOWN_SUBSCRIPTION_PLANS`（第 941-995 行）一致。

官方文档（`command-code-knowledge/reference/plans.md`）说的「plan is not readable
headlessly；去问用户、去看 `/usage` 浮层或网页」针对的是**哪一个 planId**的问题 ——
有订阅的账号，`subscriptions.data.planId` 就是答案；没订阅的账号，端点如实回报 `data: null`，
那种「没有套餐」本身也是读数。

## 结论表

| 用户诉求 | 根因 / 约束 | 落地 |
| --- | --- | --- |
| ① 套餐信息 | 端点只给 `planId` 与状态，**不给**套餐名与每月额度；名称/额度只有厂商静态表里有（CLI 与旧插件各带一份，内容一致） | 新增 `vendors/commandcode/plans.ts`：9 条 `planId` 前缀 → `{name, monthlyCredits}`（Go 10 / GOAT 70 / Pro 30 / Pro-v1 80 / Provider 15 / Max 150 / Ultra 300 / Teams Pro 40），**最长前缀**匹配（`individual-pro-v1` 用 80 而不是 30）；`adapter.ts` 的 `QuotaSnapshot.plan` 从 `string` 升级为结构化 `QuotaPlan { id, name?, status?, monthlyCredits?, periodEnd? }`；`quota.ts` 的 `planOf` 走 subscriptions 优先、`credits.planId` 回退（CLI 同），`data: null` 视为**没有订阅**（不是读失败）；账号卡与仪表盘各多一行 `data-account-plan` / `data-dashboard-plan`：`套餐 GOAT · 每月 $70.00 · 本期至 2026/11/14` |
| ② 月度额度没显示 | 月度窗口此前**故意**不给上限（`monthlyCredits` 是**余额**，拿它当 cap 会画出百分之几百的伪读数），所以订阅账号也只看到「已用 $14.24」 | 现在**有套餐**时按厂商自己的算法给配给：`cap` = 套餐每月额度、`used` = `cap − 余额`、`resetAt` = 本期结束（旧插件 `monthlyView` 第 5722-5750 行、CLI `getCreditDepletionPct` 同一口径）→ 订阅账号看到 `已用 $14.23 / 共 $70.00` + 20% 的条 + 重置时间；**没有套餐**（未订阅 / 表里没有 / 余额缺失）时退回原来的「只报当期消耗」，一个字都不编 |
| ③ 再加一个 opencode 账号入口 | opencode 的多账号 `add` 早已实现（ref 形如 `DSH_OPENCODE_GO_ACCOUNT_<LABEL>_<HASH>`，上限 20），缺的是**看得清、点得准** | 新增入口按厂商分组：每家一个小标题（`data-add-vendor-group`）+ 两个动作「使用 API Key」/「网页登录」；按钮文字不再自带厂商前缀（标题已经写了），厂商仍留在 `data-add-for` / `data-login-for` 上 |
| ④ 新增账号操作逻辑 | 空名称点「确定」时 `dispatchAccountAction` 按规矩**不发调用**，界面因此**毫无反应** —— 按钮看起来像坏的；远程侧 reject 则被 `void pending.then(…)` 静默丢掉 | ① 容器加 `actionError` 状态：空名称/空密钥 → 「请先填写账户名称。」「请先填写密钥。」；远程面没挂上 → 「账户服务还没就绪」；远程 reject → 原文（以前完全不可见）。② 表单顶上写明「添加 Command Code 账户」（面板底部只有一个表单位置、两家共用）。③ 名称框自动聚焦。④ 两个输入框**回车 = 确定**（重命名/更换密钥的编辑器同样支持）。⑤ 密钥框下方写明「密钥只写入本机凭据库，设置文件里不留明文」。⑥ 一改字段就清掉上一次的错误 |
| ⑤ 还能优化什么 | — | 仪表盘也显示套餐行（与设置页同一形状、同一份 `quotaPlanText`）；`QuotaPlan` 进摘要时**拷贝**出去（测试钉住不是宿主对象引用）；修正 `commandcode/quota.ts` 里「窗口单位是 token 数」的**过时注释**（线上 14/35 与旧插件 `formatMoney` 都证明是美元额度） |

## 关键决策与依据

- **没有套餐就是没有，不猜**：`planOf` 只在端点给了 `planId` 或 `status` 时产出 `QuotaPlan`；
  表里没有的 `planId` 只带 `id`（+状态），`name`/`monthlyCredits` 一律缺省 —— 界面退回标识原文。
  这样厂商上新套餐时界面不会撒谎（只是少两块信息），补表即可。
- **月度窗口的两种口径必须分开**：`cap` 只能来自套餐表，`used` 只能来自「额度 − 余额」或
  「当期消耗」，二者不可混用。余额缺失（端点失败）时**不**降级成 `used = 0`，而是整条退回消耗口径
  —— 否则「读不到余额」会显示成「这个月还没用」。
- **`active` 不写上屏**：状态是常态就不重复；`trialing` / `past_due` / `canceled` /
  `incomplete` 本地化后露出，词表外的原文照排（状态是厂商开放词表）。
- **`actionError` 放容器而不是页面状态**：`PageState` 管的是**可序列化的页面状态**（草稿、
  保存结果），一次性动作错误属于交互反馈，留在容器的 `useState` 里，页面仍是纯函数。

---

# 三轮共同的验证与边界

- 每轮都以 `pnpm run typecheck`（0 错）+ 全量 `vitest` + `tsdown` 双产物重建收尾；
  轮次终点的用例数依次为 8xx → 9xx → 1xxx（具体数字见各轮提交信息）。
- **已知边界**：宿主的 `resolveModel()` 档位声明只在「模型目录已读过」时可用；目录读失败时
  不声明档位，界面就不显示选择器 —— 这是宿主驱动的事实，不是本插件的缺陷。
- **月度额度的 cap 只信套餐表**：厂商上新套餐时必须补 `plans.ts`，否则该套餐只显示「已用」。
  这是刻意的取舍：宁可少一块信息，也不猜一个会画出伪读数的上限。


---

## 用量统计搬到账号下面（2026-10-19）

日期：2026-10-19（本轮）
报障原话：

1. 「我发现每次用量刷新的时候都会把设置页消失，更改一下统计吧，只在每个账号下面统计本身的用量，类似于这个」（附参考图）
2. 「另外一个就是我发现第三方的 deepseek 模型不支持图片输入，理论上官方都是支持的，你顺便检查一下」

第 2 条的结论单独写在 `2026-10-19-image-input-audit.md`（只做了调研，没有改代码）。

## 1. 为什么「刷新用量」会让整个设置页消失

症状是**整页**消失（不只是那一块），说明是 React 把子树丢了。此前有两层保护，都不够：

| 层 | 覆盖到什么 | 漏掉什么 |
| --- | --- | --- |
| `renderWithBoundary`（`seams.ts` 的同步 `try/catch`） | 调用容器函数那一次求值 | **子组件**的渲染。React 是在之后的工作循环里逐个渲染子组件的，账号行、额度条、用量块都在那一步才求值 |
| `PageShell` 里的 `try/catch` | `pageBody()` 一次求值 | 同上 |

子组件渲染期一抛，最近的**错误边界**接住；没有边界就整棵根树卸载 —— 表现就是设置页没了。

改写后（`src/client/boundary.ts`）：

- `RenderBoundary` 是一个**真正的类组件边界**（`getDerivedStateFromError` + `componentDidCatch`），
  两处使用：
  1. `createConnectedPage` 外层（`variant: "panel"`）：整页兜底，带组件栈与「重试」；
  2. 每个账号的用量块外面（`variant: "inline"`）：**一句话 + 重试**，坏了只坏这一块。
- 容器里的用量 effect 也整段包进 `try/catch`：effect 里抛错同样会走到边界（甚至更糟），
  而这里的病因本来就只该显示成「用量读取失败」。
- `accountUsageOf` 现在返回 `createElement(RenderBoundary, …, createElement(AccountUsageBlock, …))`。
  **必须**是元素（推迟给 React 渲染）而不是 `AccountUsageBlock(…)` 的返回值：直接调用等于在
  账号行的渲染期抛，最近的边界就变成整页那层了。

回归覆盖（`tests/client/container-simulation.test.ts`）：喂一个「读任何字段都抛」的桶，
断言页面本体、账号行都还在，只有用量块换成行内失败提示且原因可见。

## 2. 统计改到每个账号下面（对齐参考图）

- **删掉**页面底部的跨账号用量卡片（`UsageCard` 整个移除，连带时间窗口按钮与「清空」入口）。
- `AccountUsageBlock` 改成参考图的版式：

  ```
  用量   账期 2026/10/14 – 2026/11/14   按厂商重置时间
  ┌──────────┬─────────┬──────────────┬───────────────┐
  │ 4.6K     │ 100%    │ $18.14       │ 106.6M        │
  │ 请求     │ 成功率  │ 花费         │ Token         │
  │ 4.6K 成功 / 0 失败 │     │ 官方价 ≈ $18.14 │ 2M 入 / 4.6M 出 │
  └──────────┴─────────┴──────────────┴───────────────┘
  缓存命中率 87%   缓存命中 100M · 缓存写入 0   最近一次请求 3 分钟前
  ```

  四个指标块（请求 / 成功率 / 花费 / Token）+ 脚下的一行核对数。数字用 K/M/B 收窄
  （一行要塞四个数）。缺失一律破折号 / 「未公开」，不写 0 或 $0.00。
- 花费优先取**厂商按美元记账**的权威金额（额度窗口 `unit === "usd"`），没有才退回
  `token × 厂商单价`；官方价折算始终是一行小字（用户要求「出个小字约等于官方多少」）。
- 账期区间来自 `period.start` / `period.end`；没有终点时只写「自 … 起」，不编结束日期。
- 宿主侧补了 `AccountUsage.lastAt`（周期内最近一次请求），否则「最近一次请求」这一行随
  总卡片一起没了。
- 读用量失败时，在**该厂商第一个账号**的用量位置说一次原因（同一句原因在三个账号下面
  重复三遍只是噪音）。

## 3. 验证

- `pnpm run typecheck` 干净；
- `pnpm test`：61 个文件 / 821 个用例全绿（新增 2 个容器仿真用例）；
- `pnpm run build`：`lib/client.js` 里能查到 `dsl-usage-section` / `dsl-boundary` /
  `data-boundary-retry` / `getDerivedStateFromError`。

宿主的改动（`usage-report.ts` 的 `lastAt`）要**重启 DSH** 才生效；客户端 bundle 刷新页面即可。


---

## 用量统计的周期口径（2026-10-19）

用户需求（原话要点）：
- 额度下方加用量：请求数与成功/失败、成功率、按官方计价表算价值、token 消耗、
  平均缓存命中率，尽量详细；
- 「厂商价值，然后出个小字约等于官方多少价值」→ 两种口径并列，官方价用小字；
- 「每个账号只统计自己的记账周期，然后单独有一个总的记录」；
- 数据来源：「两者都要」。

## 1. 数据从哪来

**主来源：插件自己采集。** 三个 adapter（Command Code / OpenCode Go / OpenDesign）在
**每次尝试结束处**上报一条样本：

- `stream` 循环里把 `usage` 块逐块累加（厂商可能分多次发：`message_start` 给输入计数、
  `message_delta` 给输出计数）—— 累加而不是覆盖；
- 成功、失败、用户取消三个分支**各记一条**。只记成功会让成功率永远是 100%；
- 采集是**旁路**：端口同步返回，台账内部用写队列串行化落盘。统计坏掉不能影响请求。

**宿主的 `tokenUsage` 没有接入（如实记录）。** 查过 `app.asar`：宿主确实按会话累计
`tokenUsage`（`uncachedInputTokens` / `cacheReadTokens` / `cacheWriteTokens` /
`outputTokens`），但字段只挂在 `dsh-api-session-controller` 的**子代理会话描述符**
schema 上，没有一个「按会话/按账号查用量」的公共远程方法。要从客户端读它得依赖宿主私有
结构，宿主机升级就会断 —— 所以这一路留空，等宿主提供正式接口再接。用户选的「两者都要」
因此只落地了自采集这一路。

## 2. 口径（都已用测试钉住）

| 指标 | 口径 | 为什么 |
|---|---|---|
| 成功率 | `成功 / 尝试数` | 失败也是尝试，不记失败就永远是 100% |
| 缓存命中率 | `缓存读 /（缓存读 + 未命中输入）` | 写缓存是「这次没命中、为下次准备」，进分母会系统性低估 |
| 厂商价 | 逐条记录按**该记录的模型**累加 | 一次统计里可能混多个模型，先合 token 再套一个价会算错 |
| 官方折算 | 同一批 token 按 DeepSeek 官方价再算一次 | 用户要的「约等于」 |
| 缺失值 | 一律 `undefined` → 界面显示 `—` 或「未公开」 | 缺失不是 0；`$0.00` 会被读成「免费」 |

## 3. 价格表

**DeepSeek 官方价**（2026-10-19 取自 `api-docs.deepseek.com/quick_start/pricing`）：

| 模型 | 输入(未命中) | 输入(命中) | 输出 |
|---|---|---|---|
| deepseek-flash / v4.1-flash | $0.30 | $0.006 | $1.20 |
| deepseek-v4-pro | $1.32 | $0.044 | $3.96 |

单位是每 1M token。官方分**峰谷两档**（高峰 = UTC 周一至周五 01:00–04:00 与
06:00–10:00，不含中国法定节假日；低谷是高峰的一半）。这里取**高峰价**，因为折算价值
作为「最多花多少」的上界更诚实。

**厂商真实价：当前为空。** Command Code / OpenCode Go 都是订阅 + credit 制，官方定价页
只给「每月多少 credit / 约多少次请求」，**不公布逐模型 token 单价**；OpenDesign 的
`vela billing preflight` 直接给美元消耗，也不需要 token×单价。硬摊成单价只会给出假数字，
所以界面显示「未公开」。要加价时改 `src/core/pricing.ts` 的 `VENDOR_PRICES` 即可。

## 4. 记账周期

「每个账号只统计自己的记账周期」的落地方式：**由额度窗口的 `resetAt` 反推周期起点**。

- 粒度由窗口 key 推断：`fiveHour`/`5h`/`rolling` → 5 小时；`weekly` → 周；`monthly*` → 月；
- 有 `resetAt`：周期 = `[resetAt - 粒度长度, resetAt)`，标 `fromResetAt: true`，
  界面显示「按厂商重置时间」；
- `resetAt` 缺失或已过期：退回自然周期（本地时区；周从周一起算），标
  `fromResetAt: false`，界面显示「按自然 X 推算」—— 不把推算说成厂商的事实。
- 每账号取它**最细**的一档窗口（5 小时比周/月更能反映「最近用了多少」）。

总账是**另一套**聚合：跨账号，按用户选的窗口（今日 / 近 7 天 / 近 30 天 / 全部）。
周期与窗口是两件不同的事，报表里各算各的。

## 5. 文件

| 文件 | 职责 |
|---|---|
| `src/core/usage-stats.ts` | 记录、聚合、计价、窗口（纯函数） |
| `src/core/pricing.ts` | 官方价表 + 厂商价表 + 模型 id 归一查表 |
| `src/core/billing-period.ts` | 由 `resetAt` / 自然边界推导周期 |
| `src/core/usage-ledger.ts` | JSONL 按天落盘、坏行自愈、并发串行、保留 120 天 |
| `src/core/usage-report.ts` | 每账号周期 + 总账 |
| `src/core/usage-port.ts` | adapter 侧的采集端口（不阻塞、不抛错） |
| `src/vendors/usage-store.ts` | 三条 provider 行共用一本台账 |
| `src/client/usage-card.ts` | 界面（纯 props） |

落盘位置：`~/.dsh/llm-account/usage/usage-YYYY-MM-DD.jsonl`。

## 6. 验证

`tsc --noEmit` 0 错；64 文件 / 858 例全绿；`tsdown` 重建。新增 37 例覆盖：成功率与命中率
的分母、双口径计价、缺失值不变 0、模型 id 三种写法、窗口裁剪、周期边界的四个方向、
台账坏行自愈与并发写、卡片渲染（含官方价必须是 `<small>`）。

