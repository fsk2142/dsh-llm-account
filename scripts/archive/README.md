# scripts/archive — 已归档的一次性脚本

这里的脚本**不是**运行时依赖，也不被 CI 或测试引用。它们记录的是历史上做过的一次性操作
（主要是重写已发布 Git 历史时的脱敏过滤），保留是为了让当时的操作可复现、可审计。

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `scrub-commit-message-ids.mjs` | `git filter-branch --msg-filter` 的过滤体：把提交信息里的账号标识/本机用户名/本机路径脱敏 | 一次性，已完成（v1.6.0 那次历史重写） |
| `run-msg-id-scrub.mjs` | 调 `filter-branch` 把上面那个过滤器接进 `cb4e1ea..HEAD` | 一次性，已完成 |

## 为什么放在这里而不是删掉

2026-11-05 的外部审查（F11）指出：这两个文件自己的注释就写着「一次性用途」，
却和长期使用的脚本混在同一层，让人分不清哪个还能跑。

长期使用、**不要**归档的同类脚本：

- `scripts/scrub-commit-msg.mjs` —— 通用的当前提交脱敏；
- `scripts/run-msg-scrub.mjs` —— 它的驱动；
- `scripts/scrub-history.mjs` —— 完整历史重写流程。

## 注意

这些脚本会**改写 Git 历史**。在任何已经推送过的仓库上运行都需要协调所有协作者重新
clone；跑之前先读 `docs/SCRUB-COMMIT-HISTORY.md`。
