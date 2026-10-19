# DSH 起不来：可选依赖在**加载期**被静态 import（2026-10-19）

## 现象
用户报：插件改动之后 DSH Desktop 无法启动。

## 排查过程（可复现的证据链）
1. **产物语法与加载**：所有 `lib/*.js` `node --check` 通过；用宿主同款的
   `window.__ModuleLoader__.load({ id, factory })` 模拟客户端启动 → `apply` 正常跑完，
   注册 `settings.section(llm-account)` 与 `main(llm-account-dashboard)`，无异常。
2. **单测**：67 文件 / 879 例全绿。
3. **依赖闭包**：列出产物里全部裸导入，再去**宿主 profile** 的 node_modules 里逐个找 ——
   `@deepseek-ai/dsh-web` 在 `~/.dsh/profiles/desktop/node_modules` 里**不存在**（桌面端搜索
   没装/没随 profile 安装），而 `lib/web-search.js` 顶部就有 `import ... from "@deepseek-ai/dsh-web"`。

## 根因
`@deepseek-ai/dsh-web` 是**可选**依赖（`inject: ["web"]` 只保证「没有 web 服务时不调用 apply」），
但我们把 `WebError` 当**值**静态 import 了它。静态 import 在**加载期**解析：包不在 →
`ERR_MODULE_NOT_FOUND` → 这一行插件加载失败 → 宿主起不来。`inject` 挡不住加载期这一层。

## 修法
- 新增 `src/web-search/web-error.ts`：本地镜像 `WebError`（`name: "WebError"`、`code` 逐字对齐，
  支持 `cause`）。四个调用点（`anthropic` / `custom` / `provider` / `util`）改用它；
  `import type { WebSearchResult … }` 保持不变（类型导入编译期擦除，零运行时依赖）。
- `package.json`：`peerDependenciesMeta["@deepseek-ai/dsh-web"].optional = true`。
- 回归测试两条：
  1. `build.test.ts` 的 `HOST_BUNDLES` 明确断言 `lib/web-search.js` **不含** dsh-web；
  2. 新增「任何产物都不得 `from "@deepseek-ai/dsh-web"`」的全 `lib/*.js` 扫描。

## 验收
`tsc` 0 错；67 文件 / 879 例全绿；`tsdown` 重建后产物裸依赖只剩
`dsh-credentials` / `dsh-llm` / `schemastery`（宿主自带）；客户端启动模拟仍 BOOT OK。
