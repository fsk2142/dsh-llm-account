# 交接文档 · dsh-llm-account v2.0.0

> 写于 2026-11-04。读者：接手这个插件的人（或未来的自己）。
> 本文只讲**当前真实状态**和**踩过的坑**，设计细节见 `SPEC.md` / `decisions.md`。

---

## 1. 这是什么

DSH（DeepSeek Harness）的**第三方 LLM 账号/额度管理插件**。给三个网关提供统一的
账号池、额度显示、自动切换、自动重试/续写、图片投影、网页搜索：

| 厂商 id | 产品 | 协议 |
| --- | --- | --- |
| `dsh-opencode-go` | OpenCode Go / Go Plus | pi-ai SDK：`anthropic-messages`（默认）/ `openai-completions` / `openai-responses` |
| `llm-commandcode` | Command Code | 自研：`openai`（`/chat/completions`）/ `messages`（Anthropic 形状）/ `cli` |
| `opendesign` | Open Design | 自研：OpenAI 兼容 |

**不是 npm 包**（`private: true`），通过 GitHub 仓库直接被 profile 引用安装。

---

## 2. 当前状态（一眼看完）

| 项 | 值 |
| --- | --- |
| 版本 | **2.0.0** |
| HEAD | `89f9f06` `chore(release): v2.0.0` |
| 分支 / 远端 | `main` / `git@github.com:fsk2142/dsh-llm-account.git` |
| 保留的 tag | `v1.0.0` `v1.1.0` `v1.2.0` `v1.3.0` `v1.4.0` `v1.5.0` `v1.6.0` `v1.7.0` `v1.8.0` `v1.9.0` **`v2.0.0`** |
| Releases | 与 tag 一一对应，共 11 个（历史上 33 个零碎补丁版已清理） |
| 测试 | **187 文件 / 1926 用例** 全绿 |
| 类型检查 | 0 错误 |
| 代码量 | `src/` 103 文件、约 4.0 万行（含注释） |

**当前已装到本机**：`~/.dsh/profiles/desktop/node_modules/dsh-llm-account`，版本 2.0.0，
profile 依赖 SHA = `89f9f068f55489f43447d7214573d8e68db4c05c`。

---

## 3. 目录结构

```
src/
├── index.ts              插件入口（装配三行 + 客户端）
├── core/       (29)      跨厂商共享：账号、轮换、传输、图片投影、模型目录、用量…
├── vendors/    (40)      三家各自的 adapter / protocol / catalog / login / quota / accounts
│   ├── opencode/         accounts adapter catalog failures index login oauth protocol quota session
│   ├── commandcode/      accounts adapter catalog efforts failures index login plans protocol quota
│   └── opendesign/       accounts adapter catalog efforts failures index login protocol quota
├── client/     (33)      设置页 / 侧边栏卡片（纯前端渲染，无框架）
└── docs/                 设计、决策、运维、发布、审查记录
```

关键共享模块（改之前先读）：

| 文件 | 职责 |
| --- | --- |
| `core/image-projection.ts` | **三家唯一的图片/file 投影实现**。`wantedImagesOf` / `readImageBytes` / `fileBlockText` / 占位文案 |
| `core/switching/rotation.ts` | 轮换引擎：`pick` / `markRejected` / `pinned` / 模型规则 |
| `core/switching/auto-continue.ts` | 自动重试/续写的**判定逻辑**（纯函数，易测） |
| `vendors/auto-continue.ts` | 上述逻辑的**宿主接线**（事件监听） |
| `vendors/model-catalog-registry.ts` | 跨厂商换模型的候选池与委托入口 |
| `core/single-flight.ts` | 按 key 合并并发调用（OAuth 刷新去重） |

---

## 4. 这一版修了什么（2026-11-04 外部审查 14 项）

审查目录（外部给的）：`C:\Users\FSK\Documents\Codex\2026-11-01\.../outputs/2026-11-04_DSH账户插件模型使用专项审查_1.9.0`

### P1（6 组）

| 编号 | 问题 | 根因 | 落在哪 |
| --- | --- | --- | --- |
| **U01** | 取消固定后报「没有可用账号」 | `select(null)` 把顶层 `apiKeyEnv` 写回幽灵名 `OPENCODE_API_KEY`，被读成「用户固定了它」 | `opencode/accounts.ts` + `opencode/index.ts` |
| **U03** | 点停止/自动重试没反应 | OAuth 刷新 `fetch` 一个 `signal` 都不传，挂起后无终态 | `opencode/oauth.ts` + `adapter.ts` |
| **U06** | 思考档位没传到请求 | adapter 没把 `reasoningEffort` 交给协议层；`forceAdaptiveThinking` 也没开 | `opencode/adapter.ts` + `protocol.ts` |
| **U07** | 三家静默丢图 | 协议层只取 `textOf`，图片块直接跳过 | `protocol.ts` × 3 + `core/image-projection.ts` |
| **U08** | 禁用厂商仍被跨网关调用 | `enabled:false` 只撤宿主路由，注册表里的 `stream` 还在 | `model-catalog-registry.ts` + 三家 `index.ts` |
| **U14** | 截断后不自动续写 | 生产只传 `ctx`+settings，第三个 `probe` 参数没传 | `commandcode/index.ts` + `vendors/auto-continue.ts` |

### P2（8 组）

| 编号 | 问题 |
| --- | --- |
| **U02** | 网页登录账号额度永远 401（整串 `ocoauth1:` blob 当 Bearer，缺 org 头） |
| **U04** | 登录可能误报超时（读基线期间子进程 exit 漏掉） |
| **U05** | 获取设备码期间取消无效 |
| **U09** | 仅环境变量有凭据时模型列表为空 |
| **U10** | 点「刷新」拿缓存（`catalogModels(fresh)` 参数被丢弃） |
| **U11** | 取消勾选后 60 秒内仍用旧候选 |
| **U12** | 强制 `messages` 协议无效（`resolveProtocol` 只认 `forced==="cli"`） |
| **U13** | 已卸载图片仍读字节（卸载白做，请求被撑回原大小） |

### 自检阶段额外修掉的（不在审查清单里）

1. **多会话串 inbox** —— `agent/turn-stopping` 的 payload 只有 `{turn,signal}`，
   用「全局缓存最近 agent」会导致 A 会话的续写推进 B 会话。改为优先
   `agents.currentInitiator()`，缓存降级为兜底。
2. **`noteCatalogModels` 绕过可用性检查** —— 它是缓存真正的填充路径，不检查 →
   「先 listModels、后禁用」留下 60 秒脏窗口。
3. **`orderOf` 与 `pinnedRefOf` 判据不一致** —— 同一份文档两个答案。
4. **probe 抛错致宿主收尾失败** —— getter 里 `throw` 会让 `dispatch.serial` 失败。
5. **工具结果里的图片被丢弃**（GPT 在 1.9.11 修）。
6. **`file` 块被静默丢弃**（GPT 在 1.9.11 修）。
7. **压缩遇 assistant 历史图片整体失败**（GPT 在 1.9.12 修）。

---

## 5. 我踩过的坑（按代价排序）

### 5.1 `agent/pre-step` 是 waterfall —— 不调 `next()` 会让宿主崩溃

我在 U14 里加了 `events.on("agent/pre-step", ...)` 只缓存 agent 就 `return undefined`。
宿主拿到 `undefined` 后去读 `decision.kind` → **所有模型在运行前失败**。

```js
// 宿主真实代码
const decision = await dispatch.waterfall("agent/pre-step", payload, inner);
if (decision.kind === "reject") { ... }   // ← undefined 在这里炸
```

**必须** `return next()`。同理 `agent/request-error` 也是 waterfall。

### 5.2 宿主的 `assistant/message` 里没有 `data.finish`

我按想象读了 `data.finish.kind`，实际宿主把终态放在**持久 stream 记录**里
（`data.stream` 的最后一个 `finish` 块）。1.9.10 用
`lastAssistantStreamChunk(data.stream, "finish")?.reason` 修正。

**教训**：宿主 payload 形状一律从
`C:\Users\FSK\AppData\Local\Programs\DeepSeek Harness\resources\app.asar`
里解类型声明核对，不要猜。查法：

```powershell
$bytes = [System.IO.File]::ReadAllBytes($asar)
# 按字节搜 `"name": "XxxType"`，前后取几百字节，\n 换成真换行即可读
```

### 5.3 「只测底层函数」= 假绿

U06 的档位、U07 的图片、U13 的卸载，我第一版都只测了协议层函数，全绿但**功能没生效**。
必须从 `adapter.stream` 进入、拦截真实出站 JSON。

### 5.4 测试假绿还会伪装成「已修好」

U04 的测试第一版通过，但把修复改回去**也通过** —— 两个原因：

- `now` 固定成常量 → deadline 永不到达 → 断言 `not.toBe("failed")` 把 `waiting` 也放过；
- 桩的 `emitExit` 每次 `readFile` 都触发 → 即使监听挂晚了，后续也能收到。

**唯一可靠的判定是变异检验**：把修复改回去，测试必须变红。

### 5.5 同一逻辑分散三处 → 迟早漏一家

U13 我修了 opencode，另两家漏了（commandcode 占位对但字节照读、opendesign 完全没判断）。
**修法**：判断下沉到 `core/image-projection.ts` 的 `wantedImagesOf`，三家都从它取。

### 5.6 改动可能悄悄丢掉既有语义

U09 修 `#hasAnyAccount` 时，我丢掉了「两个解析器都没注入 → 放过（不判死）」这条
既有语义，3 条既有测试立刻变红。**既有测试就是护栏，变红先怀疑自己。**

### 5.7 PowerShell 编辑大文件的危险姿势

用 `-replace` / 行号切片改 TS，反复出现：

- CRLF 导致 `.Replace()` 静默 no-op；
- here-string 里的反引号被吃掉，文件损坏；
- 行号算错，把代码插到别的函数里。

**结论**：改代码用 `read` + `edit`（精确文本替换）；必须用脚本时，**先备份到
`.tmp/`**，改完立刻 `tsc --noEmit`。历史上有两次靠
`git checkout -- <file>` 才救回来（未提交的改动会一起丢）。

### 5.8 测试夹具的字符串要满足生产校验

`work-1` 含连字符，不符合 `CREDENTIAL_REF_PATTERN`（`/^[A-Za-z_][A-Za-z0-9_]*$/`），
被判成 `invalid` 静默回退默认名，排查了半天。用 `WORK_A` 这种合法名。

---

## 6. 已知剩余问题

| 项 | 严重度 | 说明 |
| --- | --- | --- |
| `swappedOnce` 无回归测试 | 低（测试盲区，非已知缺陷） | 「A→B→A」跨网关往返保护，代码在 `vendors/opencode/adapter.ts` 等三处，**全仓 0 处测试**。1.9.10 放宽委托条件后它是唯一防无限往返机制 |
| 工具/图片在真实上游未实测 | — | 全是离线假传输 + 真实 SDK 出站捕获，没向真模型发过工具截图 |
| 压缩全链路未实测 | — | 代码边界与图片契约已验，完整「触发→摘要→落盘→后续缩短」没在真机跑过 |
| CommandCode 回环登录 | — | 12 例标「环境受限」，需允许回环的本机补跑 |

审查报告自己列的「未验证」项还包括：工具调用/流式解析的延迟声明契约、
音频/视频等其他模态（**不承诺支持**，但也不该静默接受后丢弃）。

---

## 7. 开发与验证流程

```powershell
cd C:\Work\dsh-plug-in\dsh-llm-account

pnpm build          # tsdown，产物进 lib/（lib 是提交的！）
npx tsc --noEmit    # 类型检查
npx vitest run      # 全量（约 20 秒）
node scripts/check-final-newline.mjs          # 检查末尾换行
node scripts/check-final-newline.mjs --fix    # 自动修
```

### 强制习惯：变异检验

任何修复都要问自己「把修复改回去，测试会红吗」。做法：

```powershell
Copy-Item $f "$repo\.tmp\x.bak" -Force
# 改坏生产代码（不是测试）
npx vitest run tests/<相关>.test.ts     # 期望：红
Copy-Item "$repo\.tmp\x.bak" $f -Force  # 恢复
npx tsc --noEmit                        # 确认恢复干净
```

我这一轮靠它抓到 3 次「测试全绿但没真修好」。

---

## 8. 发布流程

```powershell
# 1. 改版本
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = 'X.Y.Z'
$pkg | ConvertTo-Json -Depth 10 | Set-Content package.json -Encoding utf8

# 2. 构建 + 全量验证
pnpm build
npx tsc --noEmit
npx vitest run
node scripts/check-final-newline.mjs

# 3. 提交 + 打 tag + 推送
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "..."
git push origin main
git push origin refs/tags/vX.Y.Z

# 4. Release
$env:GITHUB_TOKEN = [Environment]::GetEnvironmentVariable('GITHUB_TOKEN','User')
# 用 API POST /repos/fsk2142/dsh-llm-account/releases
# tag_name=vX.Y.Z, name=vX.Y.Z, body=<变更说明>
```

`scripts/release.mjs` 也能做（`--release-only <tag> --note "..."`），但它假设
tag 已推送。

### 版本号约定

- 修补：只改实现细节
- 次版本：新增能力、行为调整
- **主版本**：跨主路径的行为级修正（2.0.0 就是这么来的 —— 14 项缺陷 + 认证/图片/
  档位/续写/委托五条主路径都动了）

---

## 9. 安装到本机 profile

```powershell
$repo = 'C:\Work\dsh-plug-in\dsh-llm-account'
$prof = "$env:USERPROFILE\.dsh\profiles\desktop"
$target = "$prof\node_modules\dsh-llm-account"
$stage = "$env:TEMP\dsh-stage"

# 只拷这 6 项（其余是源码/文档，不需要）
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($i in @('lib','cordis.patch.yml','icon.svg','LICENSE','package.json','README.md')) {
  Copy-Item (Join-Path $repo $i) -Destination $stage -Recurse -Force
}

# 备份 + 替换
Rename-Item -LiteralPath $target -NewName "dsh-llm-account.bak-$(Get-Date -Format 'HHmmss')"
Copy-Item -LiteralPath $stage -Destination $target -Recurse -Force

# 同步 profile 依赖 SHA（否则 pnpm 会尝试重新拉旧版）
$sha = git -C $repo rev-parse 'vX.Y.Z^{commit}'
# 改 $prof\package.json 里的 dsh-llm-account#<sha>
# 同时改 $prof\pnpm-lock.yaml（version / integrity = codeload tarball 的 sha512 base64）
# 以及 $prof\node_modules\.modules.yaml
```

**注意**：

- 改完必须**重启 DSH**（或重载插件）才生效，运行中的进程还用旧代码。
- 备份目录记得清（历史上堆了 30 个、91 MB）。用 `safe_delete`，shell 的 `rm` 会被拦。
- **不要**用 `Remove-Item -Recurse` 清临时目录 —— 会被沙箱拦截，改用 `safe_delete`。

---

## 10. 三家厂商的关键差异（改代码必看）

| 维度 | opencode | commandcode | opendesign |
| --- | --- | --- | --- |
| 图片形状 | pi-ai `{type:"image", mimeType, data}` | openai: `image_url` / messages: `source.base64` | openai: `image_url` |
| 思考档位 | anthropic `output_config.effort`（需 `forceAdaptiveThinking`）；openai 顶层 `reasoning_effort` | 自家映射 | 自家映射 |
| 网关域名校验 | **只允许 `opencode.ai`**（`assertOpencodeBase`）—— 测试用假域名会让整个目录静默失败 | — | — |
| 目录元数据 | `/models` 的 `capabilities.reasoning.effort` + `models.dev/api.json`（5.7 MB，慢） | 自家 | 自家 |
| 额度窗口名 | `rolling` / `weekly` / `monthly` | 自家 | 自家 |

**opencode 的假域名坑**：`assertOpencodeBase` 只认 `opencode.ai`。测试里写
`https://gw.example.test/v1` 会让**整个目录读完失败**，表现是「模型没有 efforts」，
而不是报错 —— 我第一次排查 U06 就在这里绕了很久。用
`https://opencode.ai/zen/go/v1`。

---

## 11. 审查报告与本次修复的对应文件

| 文件 | 内容 |
| --- | --- |
| `docs/REVIEW-1.9.10-2026-11-04.md` | H01–H08 八组复审缺陷与修法 |
| `docs/REVIEW-U07-1.9.11-2026-11-04.md` | 工具图片 / file 块的完整语义 |
| `docs/REVIEW-HISTORY-IMAGE-1.9.12-2026-11-04.md` | assistant 历史图片与压缩 |
| `docs/FIX-1.9.8-2026-11-04.md` | pre-step waterfall 事故分析 |
| `docs/FIX-1.9.9-2026-11-04.md` | 会话隔离与上下文溢出 |

外部审查原件在
`C:\Users\FSK\Documents\Codex\2026-11-01\c-work-dsh-plug-in-dsh\outputs\2026-11-04_DSH账户插件模型使用专项审查_1.9.0\`
（`01_完整审查报告.md` 是主文档，`02_交给DSH的修复与验收计划.md` 有每项的验收标准）。

---

## 12. 如果要继续做，建议顺序

1. **补 `swappedOnce` 回归** —— 唯一明确的测试盲区，写起来不难（模拟 A 委托 B、
   B 再想委托回 A，断言 B 的 `delegateStream` 返回 `undefined`）。
2. **真机验收**（审查报告 `02_..._修复与验收计划.md` 第三批列的 7 条）—— 尤其是
   真实上游的工具图片、逐档思考强度、长对话压缩链路。这些**离线测不了**。
3. **`file` 块的真实可用性** —— 现在只是如实说「当前环境无法访问可读路径」。
   如果宿主有附件读取 seam，应该接上（`readImageBytes` 的模式可复用）。
4. **音频/视频等其他模态** —— 目前静默忽略。按审查要求应该「明确拒绝」而非静默丢弃。

---

## 13. 一句话总结

2.0.0 把外部审查的 14 项确认缺陷（含 6 组 P1）全部修完，并修掉自检发现的 7 类问题，
1926 条测试全绿、关键修复都有变异检验背书。

**但「测试全绿」不等于「零 bug」** —— 这一轮我自己就造出过 1 个让宿主完全崩溃的
回归（5.1 的 pre-step），代价是用户所有模型都用不了。所以：

> 改宿主事件接线前，先读 `app.asar` 里的真实类型声明；
> 改完跑变异检验；拿不准的行为，宁可降级成占位，也不要抛错。
