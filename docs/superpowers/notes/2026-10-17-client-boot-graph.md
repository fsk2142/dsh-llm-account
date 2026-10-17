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

## 2. 落下的设计（`cordis.patch.yml`）

- 行 id 保持 `llm-commandcode` / `opencode-go`（用户 profile patch 的按 id 覆盖、设置命名空间、provider id 全部不变）。
- `llm-commandcode` 行保持子路径名：加载器照常挂载；对扫描不可见，**不参与 source 竞争**。
- `opencode-go` 行改为路径名 `./node_modules/dsh-llm-account/lib/opencode.js`：扫描可见、`nearestPackage` 命中本包，成为唯一 source；它挂载的模块与 `./opencode` 子路径导出是**同一个产物文件**，opencode provider 行为不变。
- 设计文档 §5.1 的两行写法以本包 `cordis.patch.yml` 为准（`opencode-go` 一行被此约束取代）。

加载器一侧：相对名是加载器文档里的一等用法（`name: ./plugins/app`，见 `@deepseek-ai/cordis-plugin-loader` README）；且本机所有其他插件都用裸名正常解析，说明 tree 的 `baseUrl` 是目录基准，`./node_modules/...` 必然落在 profile 根下。

## 3. 锁定

`tests/client/boot-graph.test.ts` 镜像 `exactPackageSpecifier` / `pathLike` 判定，断言：两行 id 不变、**恰好一行**扫描可见、可见行是 `opencode-go` 且名字为上述路径、`commandcode` 行保持子路径，外加 `./client` 导出与 manifest `icon` 存在。

## 4. 复验方式（对 1c 清单的补充）

1. 重启桌面端后重新 `GET /plugins/events`：`dsh-llm-account` 应出现在 `entries` 与某个 application batch。
2. 用图里的 `url`（形如 `plugins/??dsh-llm-account/client.js&rev=…`）拉取：应 200，body 含 `window.__ModuleLoader__.load({ id: "dsh-llm-account"`。
3. 然后才看 UI：设置页出现统一段落、侧边栏底部出现额度卡（验收口径见设计文档与计划）。

## 5. 图标接缝（顺带实测）

- **插件清单的图标**：宿主把**包根 manifest 的 `icon`**（或导出 `<specifier>/icon`）转成 base64 data URL 供给插件列表（依据：`app.asar` 内插件清单 API 的 zod 描述——「Base64 image data URL from a package root's manifest icon or an exported `<specifier>/icon`; render as an image, not inline markup.」）。已按 `dsh-better-sidebar` / `dsh-context` 的先例补 `"icon": "./icon.svg"` 与 `icon.svg`。
- **设置导航的 glyph**：`settings.section` 槽位只投影 `id` / `order` / `label`，第三方 section 一律拿外壳的齿轮兜底；`dshmarket` 与 `dsh-better-sidebar` 都是**挂载后自己认领导航行**、用 CSS `mask-image` 换图（`dshmarket/src/client/settings-nav-icon.ts` 的注释把这条讲得很全）。本项目暂不认领；若需要导航行专属图标，按同一手法实现（按 label 认领行 → 标记属性 → 注入 mask 样式 → 随 `ctx.effect` 清理）。
