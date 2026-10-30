import { a as name, i as inject, n as PROVIDER_ID, r as apply, t as Config } from "./opencode-D06MviAq.js";
//#region src/index.ts
/**
* 包的根入口。
*
* ## 为什么这里要转发 opencode 的 `apply`（2026-10-28）
*
* 宿主 `client-modules` 的启动图扫描只认两种行名（`dsh-client-modules/lib/index.js`）：
*
* - 裸包名（不含 `/`）→ `exactPackageSpecifier` 识别为包根 → 产生客户端 source；
* - 路径写法（`./lib/xxx.js`）→ 走 `pathLike` 分支 → 也产生 source，但界面会显示成
*   宿主改写后的绝对 `file:` URL（长且暴露本机路径）。
*
* 而「一个声明 `dsh.client` 的包只能有一个 source」—— 三条 profile 行里**恰好一条**
* 必须产生 source，否则界面整个不出现；两条同时产生则 `reconcilePackage` 抛
* `resolves from multiple active Loader sources`。
*
* 于是 `opencode-go` 那行要么写路径（界面难看），要么写裸包名（但裸名解析到本文件，
* 本文件必须有 `apply` 才算有效插件）。这里转发 `opencode` 的实现，让裸包名可用 ——
* 三条行名现在就都是短名了。
*
* **注意**：本文件是「默认入口」的约定。若将来根入口要承载别的东西，需同步调整
* `cordis.patch.yml` 里用裸包名的那一行。
* @module dsh-llm-account/src/index
*/
/** 包名（客户端与诊断工具按它找人）。 */
const PACKAGE_NAME = "dsh-llm-account";
//#endregion
export { Config, PACKAGE_NAME, PROVIDER_ID, apply, inject, name };
