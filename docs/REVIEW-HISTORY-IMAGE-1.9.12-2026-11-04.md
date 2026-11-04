# assistant历史图片阻断压缩 · 1.9.12候选修复记录

日期：2026-11-04。源版本1.9.11。用户指出的回归由上一版本新增的assertProjectableContent过严校验引入：输入历史中的assistant图片合法，但三家在读取字节/构造请求前把它当成不支持的当前请求而抛UNSUPPORTED_CONTENT。

## 修复原则

GenerateOptions中的assistant消息是重放历史，不等于要求供应商原生生成或接收assistant图片。历史图片转成明确的文字占位，保留附件标识、原有文本和卸载状态，说明原图未内联、不能从占位推断图片内容。

此规则同时适用于compaction、session-title及普通请求。只为compaction放宽仍会使标题或普通历史重放失败，因此不单独按purpose打补丁。

共享wantedImagesOf跳过assistant历史图片，不读取历史图片字节；即使调用方传入了这些图片的字节表，三家assistant序列化也不会内联它们。user/tool图片仍按既有图片路径发送；system/developer图片的明确拒绝保持不变。未删除历史文本、未改写持久会话日志。

## 验证

- 三家完整adapter.stream × 普通/compaction/session-title，9例在修复前均复现原UNSUPPORTED_CONTENT；修复后实际发出请求、收到模拟上游SUMMARY_OK文本并正常finish(stop)。附件读取计数均为0；出站同时包含历史原文与图片标识占位，无历史base64。
- OpenCode真实Pi SDK三种协议 × 三用途，新增9例先红后绿，text-only模型也能处理仅含历史图片占位的请求。
- CommandCode覆盖openai/messages/cli、三用途、bytes/offloaded/missing及纯图历史，30例原失败场景通过。工具图片原矩阵继续通过。
- OpenDesign普通、压缩、标题的历史图片序列化回归通过。
- 原来要求assistant图片抛错的测试锁定了错误行为，本次替换为合法历史保留占位的断言；仍保留系统/开发者图片拒绝保护。

本轮完整183个测试文件1926例通过，类型检查及构建通过。首轮并行构建重写lib时，启动图测试读lib/index.js出现ENOENT；没有改测试断言，在构建结束后顺序复跑完整测试通过。前后日志均归档。

这批测试使用真实协议/SDK与完整适配器、注入假上游响应；未对真实长会话执行新版本压缩，也不以可收到模拟摘要文本证明摘要语义质量。

## 交付定位

1.9.12为该回归的候选修复版，不据此宣告正式稳定或没有其他Bug。本机安装副本更新后，正在运行的DSH需要重载才能加载；保留用户其他任务不强制重启。
