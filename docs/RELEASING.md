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

## 五、提交信息的格式（2026-10-26 起统一）

GitHub 文件树悬停显示的是**该路径最后一次提交的标题**，所以标题本身就是给读者看的
第一句话。统一成两段式：

```
<type>(<scope>): <一句话做了什么>

<正文：为什么改、改了什么、怎么验证的>
```

### 标题：只说「做了什么」，不超过 50 字符

| 要 | 不要 |
| --- | --- |
| `fix(search): 搜索关闭时让出 provider 槽位` | `fix(search): 关闭搜索时让出 provider 槽位 + 修 available() 恒真` |
| `feat(opendesign): 去掉合成的月度额度条` | `fix(opendesign): 去掉本地合成的月度额度条（一个会误导的显示）` |
| `docs(readme): 重写为功能与操作两段` | `docs: 新增 DSH 版本声明的统一做法（含源码依据与实测表格）` |

规则：

- **一个提交只做一件事**。两件事拆成两个提交，标题就自然短了（`+` 号是信号）；
- **括号里写范围**（`search` / `opendesign` / `client` / `readme`），省略也行；
- **不要在标题里写原因、教训、日期**——那些属于正文；
- 目标 **≤ 50 字符**，硬上限 72（超过 GitHub 会截断）。

`type` 取值（脚本靠它算版本号）：

| type | 版本影响 |
| --- | --- |
| `feat` | MINOR（`0.x` 期也是 MINOR） |
| `fix` / `perf` | PATCH |
| `feat!` / `BREAKING CHANGE:` | MAJOR（`0.x` 期抬 MINOR） |
| `chore` / `docs` / `test` / `refactor` / `style` / `build` | 不抬版本 |

### 正文：只写「为什么」与「怎么验证的」

**不写**这些（读者的时间比你的心路历程贵）：

- 「用户 2026-10-2x 要求…」这类对话痕迹；
- 「踩过的坑」「教训」「根因分析」的叙事过程；
- 「最初我以为是 X，后来发现是 Y」的推翻过程；
- 与本次改动无关的背景铺垫。

**要写**：

- 改前的**事实**（不是猜测）：哪个行为不对、表现是什么；
- 改后**怎么做**的（一两句，必要时贴关键代码或配置）；
- **怎么确认的**：跑了什么命令、结果是什么。

### 示例

```
fix(opendesign): 去掉合成的月度额度条

厂商的 billing preflight 只发五小时与每周两档，没有月度。插件此前从本地价格表取
上限、用本机台账填 used，合成了一根进度条 —— 看起来像「账户月度总额度」，实际只含
这一台机器。

现在只发布厂商真实返回的窗口。另外两家（OpenCode Go / Command Code）的月度是厂商
真数据，不受影响。

1491/1491 通过。
```

---

## 六、发版前的自检（这几条踩过）

- [ ] `lib/` 已重新构建并一起提交（产物进版本库；只改源码不提交产物 = 别人装到的还是旧代码）
- [ ] `node scripts/next-version.mjs` 的判定与预期一致（不一致先看提交信息前缀）
- [ ] 隐私扫描 0 命中（真实账号、本机路径、密钥形状、workspace id）
- [ ] 提交信息用 `feat:` / `fix:` / `chore:` 前缀 —— **脚本靠它算版本号**
- [ ] 建了 GitHub Release（否则市场里那条更新没有说明）

## 七、辅助脚本

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
