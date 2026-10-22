# 发版清单

本文件是**发版时照着做**的操作步骤。版本号规则与判据见 [SPEC.md](SPEC.md) 的「版本号」一节。

## 一、版本号怎么定（结论先行）

三段是 `MAJOR.MINOR.PATCH`，**判据是「会不会让老用户出问题」，不是「改动大不大」**：

| 段 | 什么时候抬 | 常见误判 |
| --- | --- | --- |
| **PATCH** | 修 bug（行为变得正确、接口不变） | — |
| **MINOR** | 新增功能，**旧用法照旧可用** | 「大功能」不一定是 MAJOR |
| **MAJOR** | 已有用户升级后**必须改代码或改配置** | 「重构」如果对外行为不变，**不是** MAJOR |

**`0.x` 特例**：主版本为 0 时公开 API 视为不稳定（SemVer 第 4 条）。所以本仓库在
`0.x` 期间，破坏性变更抬 **MINOR**（`0.2.0 → 0.3.0`），**不**抬到 `1.0.0` ——
那会假装「从此不再破坏兼容」，而我们还在跟宿主的 `0.2.x-rc` 走。

## 二、一条命令发版（推荐）

```bash
node scripts/release.mjs --note "这次改了什么"
```

它按顺序做完：算版本号 → 重建产物 → typecheck + 全量测试 → 提交 → 打 tag 推送 →
**建 GitHub Release**。

- **验证不过就不发**：测试或类型检查失败时脚本在推送前中止，不会留下半成品。
- **没 token 不卡死**：`GITHUB_TOKEN` 未设置时明确提示「跳过建 Release」，其余步骤照常。
  Release 是市场显示更新说明的来源，漏了它市场只会说「有新版本」而说不出内容。
- `--dry-run` 只算版本号，不动任何文件。

## 三、手工发版（脚本不可用时）

```bash
# 1. 算版本号（只打印）
node scripts/next-version.mjs

# 2. 确认后写回 package.json
node scripts/next-version.mjs --write

# 3. 重建（版本号构建期注入，见 tsdown.config.ts 的 define）
pnpm run build

# 4. 全量验证
pnpm run typecheck
pnpm test

# 5. 提交（带上 lib/ —— 产物进版本库）
git add -A
git commit -m "chore(release): v<新版本>"

# 6. 打 tag 并推送
git tag v<新版本>
git push origin main --tags

# 7. 建 GitHub Release（市场靠它显示更新说明）
#    网页：仓库 → Releases → Draft a new release → 选已有 tag
#    或设好 GITHUB_TOKEN 后：node scripts/release.mjs（会顺带做第 1–6 步）
```

## 四、为什么必须打 tag

`scripts/next-version.mjs` 的起点优先级是：

1. `--since <ref>`（显式指定）；
2. **`v<package.json 的 version>`** ← 正常情况走这条；
3. 全部历史（连 tag 都没有时的兜底，输出里会写明）。

第 3 条是兜底而不是常态：没有 tag 时算出来的版本会**重复计入已经发布过的提交**，
数字偏大。所以**每次发版都要打 tag**。

## 五、发版前的自检（这几条踩过）

- [ ] `lib/` 已重新构建并一起提交（产物进版本库；只改源码不提交产物 = 别人装到的还是旧代码）
- [ ] `node scripts/next-version.mjs` 的判定与预期一致（不一致先看提交信息前缀）
- [ ] 隐私扫描 0 命中（真实账号、本机路径、密钥形状、workspace id）
- [ ] 提交信息用 `feat:` / `fix:` / `chore:` 前缀 —— **脚本靠它算版本号**
- [ ] 建了 GitHub Release（否则市场里那条更新没有说明）

## 六、辅助脚本

| 脚本 | 用途 |
| --- | --- |
| `scripts/release.mjs` | 一条命令发版（见第二节） |
| `scripts/next-version.mjs` | 按 conventional commits 算版本号；`--json` 给脚本调用 |
| `scripts/find-dead-code.mjs <repo>` | 扫零引用导出与无人导入的文件 |
| `scripts/clean-test-usage.mjs` | 清掉台账里混进来的测试假记录（模型 id 为 `m1` 那种） |
| `scripts/clear-desktop-auth-cookies.mjs` | 清桌面端登录 cookie（登录态异常时用） |
| `scripts/mutation-check.py` | 变异检验：对指定测试做反向编辑，确认它们真的会红 |
| `scripts/fix-doc-headings.mjs` | 修 Markdown 标题层级（主题 H2 / 子节 H3） |
| `scripts/scrub-history.mjs` | 清理提交历史里的对话痕迹，见 [SCRUB-COMMIT-HISTORY.md](SCRUB-COMMIT-HISTORY.md) |
