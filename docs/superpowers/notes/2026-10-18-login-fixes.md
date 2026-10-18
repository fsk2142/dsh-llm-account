# 网页登录三症状修复（2026-10-18）

用户报障（设置页 → 账户面板）：

1. 点 Command Code 的「网页登录」后**没有自动弹出浏览器**；
2. 授权链接/等待面板**一直不消失**；
3. 点 OpenCode 与 Open Design 的「网页登录」**没有任何反应**。

## 根因（三条独立成因，都不是「按钮没接上」）

- **没有自动打开**：客户端里根本没有打开窗口的代码。授权网址只以 `<a href>` 的形式列出，
  等用户自己点。三家都这样。
- **面板不消失**：等待面板没有「取消」；`loginStatus` 轮询又只处理 `waiting → 其它`，
  用户不授权时状态一直是 `waiting`，于是链接挂到宿主侧超时才消失（commandcode 是 120s）。
- **另外两家没反应（真 bug）**：`onLoginBegin` 是 `void remoteValue(usage?.loginBegin(v)).then(...)`：
  - 登录流程自己返回 `failed`（opencode 设备码申请失败 → `network`；opendesign 本机没有 vela →
    `vela-missing`）时，**界面只渲染 `waiting`**，`failed` 无处显示 → 看起来什么都没发生；
  - 远程调用 reject / 同步抛错时没有失败分支 → 异常被吞（点击处理器里直接抛 = 页面无变化）。
  - 第三条还有一个放大器：远程命名空间方法在返回 promise **之前**同步抛错时，
    `remoteValue` 根本收不到 promise（`await` 的是已经炸掉的表达式）。

## 修法

- `src/client/login-window.ts`（新）：`openLoginWindow` / `pointLoginWindowAt` / `closeLoginWindow`。
  浏览器只允许在**用户手势的同步阶段**开窗，所以点击当刻先开 `about:blank`，
  拿到 `authUrl` 再导航；失败/取消/success 一律关掉占位窗口（不留空白页）。
  读 `location` 本身也会抛（跨域），整个导航必须包在 try 里。
- `src/client/accounts-panel.ts`：
  - 等待面板加「取消登录」（`data-action="login-cancel"` + `data-login-for`）；
  - 「添加账户」组下面新增三态提示：启动中（`data-login-starting`，按钮 `disabled`+`aria-busy`）、
    流程失败（`data-login-failure` + `data-login-failure-detail`，原因翻成人话）、
    调用失败（`data-login-error` + `data-login-error-detail`，原文只进 data 属性）；
  - `cancelled` 不算失败，不报红。
- `src/client/seams.ts`：
  - `beginLogin(vendor)` 统一两个入口（合并面板与账号行内联登录）：关旧窗口 → 同步开新窗口 →
    进「启动中」→ 调远程 → `waiting` 导航窗口 / `failed` 关窗并记录 / 抛错关窗并记录；
  - `cancelLogin(vendor)`：关窗、清状态、调 `loginCancel`；
  - 新增 `callRemote()`：把命名空间方法的**同步抛错**折成被拒绝的 promise（登录按钮与 1s 轮询
    两处都经它）；
  - 轮询：连续 3 次读不到（`LOGIN_POLL_MAX_MISSES`）才判 `failed/network`；
    本机时钟过了 `expiresAt` 而宿主仍报 `waiting` 时就地收 `failed/timeout`；
  - 页面卸载时关掉未导航的占位窗口。
- `src/vendors/opencode/login.ts`：设备码申请失败按「HTTP 拒绝 → `unavailable`」与
  「传输失败 → `network`」分开报（以前一律 `network`，界面会说错话）。
- `src/client/copy.ts`：新增 `account.loginStarting/loginCancel/loginFailed/loginExpired` 与
  `account.reason.vela-missing/no-signin/config-invalid`（zh/en 成对）。

## 测试

- `tests/client/login-window.test.ts`（9）：无 window / 被拦截 / 导航失败 / 跨域读 location /
  关窗幂等。
- `tests/client/accounts-panel.test.ts`（+5）：取消按钮与回调、失败原因文案、cancelled 不报红、
  启动中禁用、调用失败的原文只在 data 属性。
- `tests/client/container-simulation.test.ts`（+5，真容器）：opencode 路由与自动导航、
  opendesign 失败可见且关窗、取消后停轮询、success 自动消失并重读账号、连续读失败先保面板后收尾。
- `tests/vendors/opencode-login.test.ts`（+1）：HTTP 拒绝 vs 传输失败的两种原因。

结果：`tsc` 0 错、vitest 59 文件 / 781 例全绿、`tsdown` 重建成功。

## 真机待验

- Command Code：点「网页登录」应弹出一个窗口并停在授权页；浏览器里批准后等待面板自动消失、
  账号出现在列表；不批准可点「取消登录」。
- OpenCode：若仍失败，界面会说明原因是网络还是服务端拒绝（以前完全没提示）。
- Open Design：没有 vela 时会明确说「本机找不到 vela…」，装上桌面端/CLI 后应能弹出设备授权页。

## 第二轮（同日 21:45–21:55）：不登录也要自己收起

用户补充两点：① 不登录时链接不消失、必须手点「取消登录」；② 再点一次「新增账户」也应能取消。

- **期限**：Command Code 的 `waiting` 状态以前**不带** `expiresAt`（宿主自己有 120s 定时器，
  但界面不知道）。现在宿主把它报出来（`src/vendors/commandcode/login.ts`），客户端在
  `expiresAt` 到了就地收成 `failed/timeout` 并收起面板；宿主没报期限时按
  `LOGIN_WAITING_TTL_MS = 120s` 兜底。
- **关窗即收起**：用户关掉我们弹出的授权窗口 → 面板收起（**不**取消宿主流程：关闭那一刻
  他可能刚批准，取消会误杀成功；流程自己会超时，轮询到终态即止）。
- **竞态闸门**：定时器每秒一拍，超时判定后仍有多拍在途；迟到的 `waiting` 会把面板闪回来
  （实测）。新增 `loginClosed` 引用：收尾后一律不采纳 `waiting`。
- **再点「新增账户」= 收起区块**：`<details>` 的 `onToggle`（open=false）→
  容器把开着的添加表单（`closeAction`）与等待中的登录（`loginCancel`）一起收掉。
  两者都渲染在 `<details>` 外面，只折叠摘要的话它们会留在卡片上。
- 测试：container-simulation +5（到期收起 / 无 expiresAt 的默认 TTL / 关窗收起且不误取消 /
  收起区块同时清表单与登录 / 加账号后目录重读），accounts-panel +1（onToggle 语义）。
