# 客户端启动图：行名的两个实测约束（2026-10-17）

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
