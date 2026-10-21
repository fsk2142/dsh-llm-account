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

## 二、发版步骤

```bash
# 1. 算出下一个版本（只打印，不改文件）
node scripts/next-version.mjs

# 2. 确认无误后写回 package.json
node scripts/next-version.mjs --write

# 3. 重新构建（版本号是构建期注入的，见 tsdown.config.ts 的 define）
pnpm run build

# 4. 全量验证
pnpm run typecheck
pnpm test

# 5. 提交（注意带上 lib/ —— 产物进版本库）
git add -A src tests lib package.json
git commit -m "chore(release): v<新版本>"

# 6. 打 tag 并推送（tag 是下次算版本的起点）
git tag v<新版本>
git push origin main --tags
```

## 三、为什么必须打 tag

`scripts/next-version.mjs` 的起点优先级是：

1. `--since <ref>`（显式指定）；
2. **`v<package.json 的 version>`** ← 正常情况走这条；
3. 全部历史（连 tag 都没有时的兜底，输出里会写明）。

第 3 条是兜底而不是常态：没有 tag 时算出来的版本会**重复计入已经发布过的提交**，
数字偏大。所以**每次发版都要打 tag**。

## 四、发版前的自检（这几条踩过）

- [ ] `lib/` 已重新构建并一起提交（产物进版本库；只改源码不提交产物 = 别人装到的还是旧代码）
- [ ] `node scripts/next-version.mjs` 的判定与自己的预期一致（不一致先看提交信息前缀对不对）
- [ ] 隐私扫描 0 命中（真实账号、本机路径、密钥形状）
- [ ] 提交信息用 `feat:` / `fix:` / `chore:` 前缀 —— **脚本靠它算版本号**

## 五、当前状态

- 版本：见 `package.json`
- 仓库还没有任何 tag（首次发版时补上，之后按上面的流程走）
