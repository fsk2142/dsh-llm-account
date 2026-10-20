# 两次「DSH 起不来」的排查记录（2026-10-19）

> **合并说明（2026-10-20）**：本文件由两份独立记录合并 —— `2026-10-19-startup-failure.md`
> （可选依赖在加载期被静态 import）与 `2026-10-19-desktop-welcome-crash-cookies.md`
> （本地鉴权 Cookie 撑爆 16KB 请求头）。
>
> 合在一起的理由：两次的症状都是「DSH 起不来」，用户与未来的排查者最先问的就是这个；
> 分成两份时容易只查到一份就下结论（第一次的根因在**插件**里，第二次**与插件无关** ——
> 这个区分本身就是最有用的信息）。原文逐节保留。

---

# 一、插件侧的「起不来」：可选依赖在加载期被静态 import

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

> **2026-10-20 补记**：`lib/` 已改为**提交进版本库**（此前被 `.gitignore` 忽略，导致
> GitHub 安装后 `package.json` 的 `exports` 指向不存在的文件、「校验未通过」）。原因写在
> `.gitignore` 里。上面第 2 条那条「产物不含 dsh-web」的扫描因此仍然有效且更重要 ——
> 产物一旦进版本库，构建错误会被直接分发出去。

---

# 二、桌面端的「起不来」：本地鉴权 Cookie 撑爆 16KB 请求头

## 现象

桌面端启动即崩，崩溃报告固定为：

```
phase: startup
Error: desktop welcome: Web authentication failed
    at connectDesktopWelcome (.../app.asar/lib/main.js:8886:31)
    at async Object.start (.../app.asar/lib/main.js:12195:22)
```

当天 13:19–13:48 共 10 份崩溃日志，全部同一条错误；渲染进程没有任何错误输出。

## 根因（已用证据闭环）

1. 桌面端启动流程（`main.js` 12190–12195）：
   `host.start()` → `authenticateWebHost(ready.url)` → `connectDesktopWelcome(ready.url, net.fetch)`。
   `connectDesktopWelcome` 用 Electron `net.fetch`（Chromium 会话）GET 本地宿主的启动 URL，
   **任何非 2xx 都会抛 "desktop welcome: Web authentication failed"**。
2. 宿主每次启动监听**随机端口**，并为该端口签发一条本地鉴权 Cookie：
   名字是 `dsh-auth-<base64url(sha256("127.0.0.1:<port>"))>`，值约 171–173 字节，
   `Path=/`、持久化 30 天（`dsh-client-connection` 的 `cookieName` / `sessionCookie`）。
3. 端口每次不同 → 每次启动都**新增**一条 Cookie，旧的全部留在 Chromium 罐里。
   Chromium 对同一主机（`127.0.0.1`）的所有请求都会把**全部** Cookie 塞进一个 `Cookie:` 头。
4. 宿主是 Node HTTP 服务器，默认 `maxHeaderSize = 16384` 字节。
   实测：71 条 Cookie 时头部已 **16,082 字节**（加 `cookie: ` 前缀 16,090），
   再叠加 UA / Accept / Accept-Encoding / sec-fetch-* 等常规头 → 超过 16KB →
   **431 Request Header Fields Too Large**。
5. 第 71 条 Cookie 的创建时间 = `2026-10-19T05:19:50.408Z`，第一份崩溃日志 =
   `05:19:50.498Z`（相隔 90ms）。之后每次启动在**第一个请求**就 431，
   连新 Cookie 都写不进去，所以 Cookie 数量冻结在 71，崩溃永久化。

## 证据

- 真实库：71 条全部是 `127.0.0.1` 的 `dsh-auth-*`，`PRAGMA integrity_check` 正常。
- 用宿主的真实启动 URL 实测：
  - 只带新 Cookie `GET /` → **200**；
  - 带「71 条旧 + 1 条新」`GET /` → **431**。
- 浏览器同款请求头 + 本地 Node HTTP 服务：n=70 → 200，**n=71 → 431**。
- 同一个插件、同一份 profile，用**全新 Electron user-data 目录**启动桌面端：
  45 秒内无崩溃，并正常写入 1 条新 `dsh-auth-*`（握手走通）。
- 清空 71 条后，用真实配置启动：90 秒无新崩溃日志，且只写入 1 条新 Cookie。

## 与插件无关

- 崩溃栈没有一帧落在插件代码里，失败点是桌面端 shell 对自己的本地宿主做 HTTP 握手。
- 用完整插件与 profile、仅更换 Electron user-data 目录即可正常启动。
- 插件构建出的宿主侧服务用 Node fetch 实测 `GET /` 200、`settings/describe` RPC 200。
- 时间上的巧合：第 71 次启动正好发生在插件返修之后，实际是 Cookie 累积到阈值。

## 修复（已执行）

1. 备份真实 Cookie 库到 `%TEMP%/opencode/backups/Cookies-<时间戳>`。
2. 删除 `cookies` 表中全部 `host_key='127.0.0.1' AND name LIKE 'dsh-auth-%'` 的行
   （共 71 条；该库当时只有这些行）。
3. 重启验证通过（见上）。

## 复发与预防

- 每启动一次桌面端新增 1 条 Cookie，约 **71 次启动**后再次触顶
  （按每天 5–6 次，约 1–2 周）。
- 这些 Cookie 在宿主进程退出后本来就已经作废（签名密钥每进程随机），
  **可以随时全删**；重启后会自动生成一条新的。
- 本仓库提供清理脚本：

  ```powershell
  node scripts/clear-desktop-auth-cookies.mjs
  # 或
  npm run fix:desktop-cookies
  ```

  脚本会先检查桌面端是否在运行、自动备份数据库，再删除 `dsh-auth-*` 行。
- 如果想彻底免手动：可以加一个登录时/每日的计划任务运行上述脚本（未自动创建，需用户确认）。
- 上游建议（供反馈给 DSH 团队）：桌面端启动时清理过期的 `dsh-auth-*` Cookie，
  或让宿主使用稳定端口 / 复用持久化密钥，避免按 `host:port` 无限累积 Cookie。

---

# 两次的区分方法（给以后的排查）

| 特征 | 插件侧（一） | 桌面端 Cookie（二） |
| --- | --- | --- |
| 崩溃栈是否落在插件代码 | 是（`lib/*.js` 加载失败） | 否（`app.asar/lib/main.js`） |
| 错误类型 | `ERR_MODULE_NOT_FOUND` | `Web authentication failed` / HTTP 431 |
| 换全新 user-data 目录能否启动 | 不能（问题在插件产物） | **能** |
| 卸载插件能否启动 | **能** | 不能 |
| 快速自检 | `node --check lib/*.js`、扫产物裸导入 | `npm run fix:desktop-cookies` |
