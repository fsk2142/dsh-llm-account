# 全量审计：兼容性、插件共存、安全、性能（2026-10-19 00:30）

本轮是对整个插件的一次**完整复审**，目标有四条：版本/兼容性、与其它插件（尤其插件市场）
的共存、安全漏洞、性能。每一项都按「先测出来、再修、再补回归测试」的顺序做。

## 0. 结论速览

| 方向 | 结论 |
|---|---|
| 与插件市场冲突 | 找到并修掉 3 处**注册生命周期**缺陷（设置页 section、侧边栏卡片、中栏面板） |
| 版本适配 | peer 范围覆盖正在运行的桌面端 0.2.1-rc.2，兼容性门禁通过 |
| 安全 | 修掉 1 处未加协议的 `href`（`javascript:` 注入面）、收紧 `workspaceId` 参数注入闸门 |
| 性能 | 目录读数加 TTL 缓存 + 并发去重（每家一次对话少十几次网络请求） |
| 测试 | 814 → 820 例；`tsc` 0 错；`tsdown` 双产物重建 |

## 1. 与插件市场的冲突（用户报障：打开市场后我们的设置页打不开）

先读宿主实现，不猜：

- `dsh-client-ui-settings-general`：`ctx.slots.getVersion("settings.section")` + `entries()`
  构建导航行；设置正文用 `renderSlot("settings.section", …, { only: active })` 渲染。
- `dsh-client-ui-renderer` 的 `slots.inject(key, callback)`：宿主**每次槽位声明变化**都会
  重新执行 `callback`；如果 callback 抛错，控制器 `stop()` 并 `queueMicrotask` 抛出去 ——
  之后**永远不再回调**。
- 插件市场 `dshmarket` 用 `createSectionGate` 反复 `register` / 撤销自己的 `market` 行
  （它的设置可见性开关就是这么实现的），因此会不断改变 `settings.section` 的声明版本。

结论：市场本身不与我们争 id（`llm-account` vs `market` vs `save-token`，order 12/40/430，
无冲突），但**它的反复重注册会把我们的 callback 再跑一遍**。我们原来的实现有三处会被这一步
踩坏：

1. `shell.ts` 的 section 注册：丢弃了 `register` 的撤销句柄，也从不在重注册前撤销 →
   每次回调追加一条同名 section，宿主按失效句柄丢弃时表现为「点 tab 打不开」。
   （上一轮已修，本轮加了**抛错兜底**：注册失败也只记一行错误并返回空注销函数，
   让控制器的生命周期继续。）
2. `registerSidebarCard`：整条链路**完全没有**保存句柄，回调重复执行就累积多张侧边栏卡片，
   回调里抛错则卡片永久消失。已改为「先撤销、再注册、失败兜底」，并把注销句柄真正接到
   `registerSharedSurfaces` 的返回函数上。
3. `registerPanelCard`：同上。

三处都补了回归测试（`tests/client/seams.test.ts`）：重复回调只保留一份、抛错不把控制器
带走。

## 2. 版本与兼容性

- 桌面端实测版本 `0.2.1-rc.2`（`app.asar` 的 `/dsh/package.json`）。
- `tests/compatibility.test.ts` 按宿主 `evaluatePluginCompatibility` 的规则回放我们的
  `peerDependencies`：`0.2.0-rc.2 … 0.2.1-rc.2` 全部通过。
- `cordis.patch.yml` 的四行（`llm-commandcode` / `opencode-go` / `opendesign` /
  `llm-account-web-search`）仍满足 `client-modules` 扫描规则：恰好一行用路径名，
  其余用子路径，不产生第二个客户端 source。
- `package.json` 的 `dsh.client.inject` 三件都在宿主的 548 个内置包里存在。

## 3. 安全

| 问题 | 处理 |
|---|---|
| `account-card.ts` 的登录链接直接写 `href: login.authUrl` | 与 `accounts-panel.ts` 统一走 `isHttpUrl()`，非 http(s) 不渲染 `href` |
| `velaPreflight(workspaceId)` 把用户可改的值拼进命令行 | 白名单 `^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$`（不能以 `-` 开头，`--help` 也挡掉） |
| `createVelaPreflight` 同一参数、**没有**闸门 | 同上（`login.ts`），两处执行同一份规则 |
| `login-window.ts` 的 `window.location` 赋值 | 已有 `isHttpUrl` 闸门（上一轮），本轮补了回归测试 |

另外核对过：没有 `innerHTML` / `eval` / `new Function`；没有把密钥写进日志；
`console.*` 只有一条加载横幅。

## 4. 性能

- **Command Code 目录**：`resolveModel()` 每个请求都会问一次目录，原来完全不缓存。
  现在 60 秒 TTL + 并发去重（与 OpenDesign 本轮新增的实现同一套），换 `apiBase` 立即失效。
  回归测试：连续两次 `listModels` 只打一次端点、并发复用同一 promise、换基地址重新拉。
- 其它两家的目录本来就有 TTL 缓存（opencode）或按厂商级资源处理，无需改动。
- 设置页读状态的新鲜期已跟随「用量刷新间隔」，本轮未改。

## 5. 测试与产物

- `tsc --noEmit`：0 错。
- `vitest run`：61 文件 / 820 例全绿。
- `tsdown`：host 19 文件 + client `lib/client.js` 重建；构建产物里能查到本轮新增的错误
  兜底字符串。

## 6. 遗留与建议

- 插件市场侧还有一个**不属于我们**的脆弱点：它的 `installSettingsNavIcon` 用
  `[role="dialog"] nav button` 找自己的行并按 `textContent` 精确匹配，只在文字完全相等时
  加图标。我们把导航标签改成带后缀都不会影响它，但改语言会（它每次 sync 重读 label，正常）。
- 若设置页仍然不出现，需要宿主控制台里 `[dsh-llm-account] could not register …` 那一行
  作为证据 —— 现在三种注册失败都会打印，并带上「会在下一次槽位变化时重试」的语义。
