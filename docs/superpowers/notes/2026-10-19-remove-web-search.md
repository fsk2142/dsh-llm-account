# 移除网页搜索行（2026-10-19 13:35）

## 为什么
用户决定：**彻底删掉** DSH 网页搜索这一行（`dsh-llm-account/web-search`）及其对宿主
`@deepseek-ai/dsh-web` 的依赖。前一版已经把静态 import 改成类型导入 + 本地镜像，但用户希望
连这条能力一起去掉（宿主 profile 里本就没有这个包，少一条少一份风险）。

## 删除范围
- 源码（**移到回收站**，可恢复）：`src/web-search/`、`src/client/web-search-card.ts`、
  `src/client/web-search-panel.ts`、`tests/web-search/`、`tests/client/web-search-*.test.ts`
- 接线：`cordis.patch.yml` 的 `llm-account-web-search` 行、`tsdown.config.ts` 的 host entry、
  `package.json` 的 `./web-search` export 与 `@deepseek-ai/dsh-web` peer
- 客户端：`page.ts` 的 `webSearch` / `webSearchDirty` props 与渲染位、`seams.ts` 的
  `useWebSearchPanel` 调用与「一个保存按钮两处落盘」的分支、`copy.ts` 的 162 行 `webSearch.*` 文案
- 测试：`boot-graph` 断言改成三行、`build.test` 的 `HOST_BUNDLES` 去掉 web-search 条目

## 验证
`tsc` 0 错；**61 文件 / 821 例全绿**；`tsdown` 重建后 `lib/` 只剩 index / commandcode /
opencode / opendesign 四个宿主入口（14 个文件）；客户端启动模拟仍 BOOT OK。

## 另一个事实（重要，别混淆）
用户同时贴了崩溃对话框，诊断报告在
`%APPDATA%/@deepseek-ai/dsh-desktop/logs/crash-2026-10-19T05-34-50-947Z-host.log`：

```
phase: startup
Error: desktop welcome: Web authentication failed
    at connectDesktopWelcome (…/DeepSeek Harness/resources/app.asar/lib/main.js:8886:31)
--- renderer console (error level) ---
(no error-level renderer console output was captured)
```

**这次崩溃不是本插件造成的**：栈全在桌面端自己的 `main.js`（欢迎页 Web 鉴权），阶段是
`startup`，渲染进程一行错误都没有 —— 插件代码还没开始跑。同一台机器上 05:19 / 05:20 / 05:34
的四份崩溃日志都是同一个错误，而本机代理（`127.0.0.1:4905`）此时持续 502，git push 也同样失败。
