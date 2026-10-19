# 桌面端启动崩溃：本地鉴权 Cookie 撑爆 16KB 请求头（2026-10-19）

## 现象

桌面端启动即崩，崩溃报告固定为：

```
phase: startup
Error: desktop welcome: Web authentication failed
    at connectDesktopWelcome (.../app.asar/lib/main.js:8886:31)
    at async Object.start (.../app.asar/lib/main.js:12195:22)
```

今天 13:19–13:48 共 10 份崩溃日志，全部同一条错误；渲染进程没有任何错误输出。

## 根因（已用证据闭环）

1. 桌面端启动流程（`main.js` 12190–12195）：
   `host.start()` → `authenticateWebHost(ready.url)` → `connectDesktopWelcome(ready.url, net.fetch)`。
   `connectDesktopWelcome` 用 Electron `net.fetch`（Chromium 会话）GET 本地宿主的启动 URL，
   **任何非 2xx 都会抛 "desktop welcome: Web authentication failed"**。
2. 宿主每次启动监听**随机端口**，并为该端口签发一条本地鉴权 Cookie：
   名字是 `dsh-auth-<base64url(sha256("127.0.0.1:<port>"))>`，值约 171–173 字节，
   `Path=/`、持久化 30 天（`dsh-client-connection` 的 `cookieName` / `sessionCookie`）。
3. 端口每次不同 → 每次启动都**新增**一条 Cookie，旧的全部留在 Chromium 罐里。
   Chromium 对同一主机（`127.0.0.1`）的所有请求都会把**全部** Cookie 塞进一个
   `Cookie:` 头。
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
- 清空 71 条后，用真实配置启动：90 秒无新崩溃日志，且只写入 1 条新 Cookie
  （`2026-10-19T06:04:52.853Z`）。

## 与插件无关

- 崩溃栈没有一帧落在插件代码里，失败点是桌面端 shell 对自己的本地宿主做 HTTP 握手。
- 用完整插件与 profile、仅更换 Electron user-data 目录即可正常启动。
- 插件构建出的宿主侧服务用 Node fetch 实测 `GET /` 200、`settings/describe` RPC 200。
- 时间上的巧合：第 71 次启动正好发生在插件返修之后，实际是 Cookie 累积到阈值。

## 修复（已执行）

1. 备份真实 Cookie 库到 `%TEMP%/opencode/backups/Cookies-20261019-140437`。
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
- 如果想彻底免手动：可以加一个登录时/每日的计划任务运行上述脚本
  （未自动创建，需用户确认）。
- 上游建议（供反馈给 DSH 团队）：桌面端启动时清理过期的 `dsh-auth-*` Cookie，
  或让宿主使用稳定端口 / 复用持久化密钥，避免按 `host:port` 无限累积 Cookie。
