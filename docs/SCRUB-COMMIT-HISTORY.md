# 清理 Git 提交历史里的对话痕迹

> 适用场景：提交信息里写了「用户 2026-10-21：…」「用户报障…」这类句子，把
> 「AI 在与具体用户对话」暴露在公开仓库里。本文件是一份可照抄的操作单，
> 在任意一个 DSH 插件仓库里都能用。
>
> 首次实践：`dsh-llm-account`（2026-10-21），清理 79 处、重写 280 个提交、
> 代码内容零变更。

---

## 一、先想清楚这三件事

在动手前确认：

| 问题 | 如果答案是「是」 |
| --- | --- |
| 仓库是公开的吗？ | 那就有清理价值 |
| 提交信息里有对话框架吗？ | 用第五节的方法扫一遍 |
| 有别人在用你的 tag / commit SHA 吗？ | **重写后 SHA 会变**，要提前通知 |

**重写历史会改变所有 commit SHA。** 如果有人在 `pnpm-lock.yaml` 里钉了
`github:you/repo#<sha>`，那个引用会失效，需要重新安装。这不是「也许」，是一定。

---

## 二、先做备份（不要跳过）

```powershell
cd <你的仓库>
$backup = "backup-before-scrub-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
git branch $backup
"已创建备份分支: $backup"

# 顺手记录所有 tag 当前指向
git tag --list | ForEach-Object { "$_ -> $(git rev-list -n 1 $_)" } |
  Out-File "$env:TEMP\tags-before.txt" -Encoding utf8
```

备份分支的价值：**万一改写把内容搞坏了，一个 `git reset --hard <backup>` 就回来了。**

---

## 三、复制清理脚本

把 `scripts/scrub-commit-msg.mjs` 从本仓库复制到你的仓库。它做的是纯文本替换，
不改文件内容：

| 原写法 | 改写后 |
| --- | --- |
| `用户 2026-10-21：「原话」` | 整行删除 |
| `用户报障「…」` | `实际现象是「…」` |
| `（2026-10-21 用户报障）` | 删除整个括号 |
| `用户要求 X` | `按需求 X` |
| `经用户确认` | `经实测` |
| `报障时` / `报障后` | `出问题时` / `出问题后` |
| 其余 `用户` | `需求` |

---

## 四、验证脚本效果（先试再跑）

不要直接对整个历史跑。拿一段真实提交信息试一下：

```powershell
@"
feat: 某个功能

用户 2026-10-21：「这个功能要这样改」。

用户报障「界面空白」。经用户确认与实测：是缓存问题。
（2026-10-21 用户报障）
"@ | node scripts/scrub-commit-msg.mjs
```

期望输出：

```
feat: 某个功能

实际现象是「界面空白」。经实测：是缓存问题。
```

**如果输出读起来别扭（比如出现「需求要求」这种叠词），先改脚本再继续。**
我第一次就是没试，导致跑了两轮才修干净。

---

## 五、扫描范围（看清楚要改多少）

```powershell
# 总提交数
(git log --oneline | Measure-Object).Count

# 含对话痕迹的提交
git log --format='%h' | ForEach-Object {
  $body = git show $_ --format='%B' --no-patch 2>$null
  if ($body -match '用户|原话|报障') { $_ }
} | Measure-Object
```

---

## 六、执行改写

**关键点：`--msg-filter` 里必须用绝对路径。** filter-branch 在临时目录里执行命令，
相对路径会找不到脚本（我第一次就栽在这，报 `MODULE_NOT_FOUND`）。

```powershell
cd <你的仓库>
$env:FILTER_BRANCH_SQUELCH_WARNING = '1'
$script = (Join-Path (Get-Location) 'scripts\scrub-commit-msg.mjs').Replace('\','/')
git filter-branch -f --msg-filter "node `"$script`"" -- --all
```

输出里应该看到一串 `Ref 'refs/tags/vX.Y.Z' was rewritten`。

---

## 七、验证改写结果

```powershell
# 1. 还有多少提交含痕迹（应为 0）
git log main --format='%h' | ForEach-Object {
  $body = git show $_ --format='%B' --no-patch 2>$null
  if ($body -match '用户|原话|报障') { $_ }
} | Measure-Object

# 2. 抽查一个功能提交的正文
git log main --format='%h %s' | Select-Object -First 5

# 3. **最重要**：确认代码内容没被改动
git diff --stat <备份分支> main
```

第 3 步的期望结果：**只显示新增的脚本文件，没有任何其他差异**。
如果出现了源码文件的差异，说明改写误伤内容，立刻回滚：

```powershell
git reset --hard <备份分支>
```

> 注意：如果残留几个「含痕迹」的提交但 `git branch --contains` 查不到，
> 那它们是**悬空对象**（旧历史残留），不在任何分支上，GitHub 上看不见，无害。

---

## 八、强制推送（这一步不可逆）

```powershell
# 推送重写后的分支
git push --force origin main

# 推送重写后的所有 tag
git tag --list | ForEach-Object {
  git push --force origin "refs/tags/$_"
}
```

---

## 九、从 GitHub 侧验证（别只看本地）

本地干净不代表远端干净，要拉真实数据看。

**不要用 `$env:GITHUB_TOKEN = ...` 或从环境变量读 token** —— 那样做有两处泄露面：
终端回显（被旁人 / 日志看到）和 shell 历史文件。这个仓库早先的版本曾这么写过，
2026-10-28 因此触发过一次凭据暴露警报，已删除。

**推荐顺序**：

1. **公开仓库**：直接 `git ls-remote` 看远端引用，或网页强刷（`Ctrl+Shift+R`）。
   不需要任何凭据 —— 能证明"远端是这个状态"就够了。
2. **私有仓库**：`gh auth login` 走一次交互登录（凭据存进系统凭据管理器，不回显），
   之后 `gh api` 免 token。
3. 非要手工传 token 时用 `Read-Host -AsSecureString` 现输，不要预置环境变量：

```powershell
$sec = Read-Host 'GitHub token（不会回显）' -AsSecureString
$tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
try {
  $h = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.github+json" }
  $c = Invoke-RestMethod -Uri 'https://api.github.com/repos/<owner>/<repo>/commits?per_page=5' -Headers $h
  $c | ForEach-Object {
    $m = $_.commit.message
    if ($m -match '用户|原话|报障') { "⚠ $($_.sha.Substring(0,7)) 仍有痕迹" }
  }
} finally {
  Remove-Variable tok -ErrorAction SilentlyContinue
}
```

**页面缓存的坑**：GitHub 网页可能要几分钟才刷新。用 `Ctrl+Shift+R` 强刷。
另外，**文件夹右侧那一列显示的是提交标题**（技术描述），不是正文——
正文要鼠标悬停才看得到，别验证错位置。

---

## 十、清理备份（确认无误后）

```powershell
# 删分支
git branch -D <备份分支>

# 删 filter-branch 留下的原始引用（逐个删，别用 rm -rf）
git for-each-ref --format='%(refname)' refs/original |
  ForEach-Object { git update-ref -d $_ }

# 回收悬空对象
git reflog expire --expire=now --all
git gc --prune=now
```

---

## 十一、以后怎么写提交信息

清理是补救，**预防更省事**。写提交时：

- ❌ `用户 2026-10-21：「这个要改成 30」`
- ✅ `额度改成 30（官方文档已更新）`

- ❌ `用户报障：侧边栏不显示`
- ✅ `修复侧边栏不显示的问题`

区别在于：**描述现象，不描述对话**。技术信息一点没少，但不需要向任何人解释
「用户」是谁。

---

## 附：本次实操记录

| 项目 | 数值 |
| --- | --- |
| 仓库 | `dsh-llm-account` |
| 总提交 | 280 |
| 含痕迹的提交 | 79 |
| 改写轮次 | 2（第一轮后有 5 处残留） |
| 代码内容变更 | 0 行 |
| 耗时 | 约 15 分钟 |

**踩过的两个坑**：

1. `--msg-filter` 用相对路径 → `MODULE_NOT_FOUND`。用绝对路径。
2. 替换规则不够全 → 需要第二轮。**先拿真实提交信息试跑，再全量执行。**
