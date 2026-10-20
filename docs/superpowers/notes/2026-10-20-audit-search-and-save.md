# 2026-10-20 全量审计：搜索一族 + 设置保存（用户要求「检查有没有 bug」）

## 结论

**5 个问题，其中 2 个是真 bug（都会让功能实际不可用），3 个是隐患/套件可靠性**。全部已修，
每条都有测试锁住（变异检验过：把修复改回旧行为，对应测试变红）。

| # | 问题 | 性质 | 用户可见症状 |
|---|---|---|---|
| 1 | 搜索网关路拿错行的密钥与端点 | **真 bug（最严重）** | 配了 commandcode 账号的人，在 opendesign + DeepSeek 会话里搜索**永远失败** |
| 2 | 取消搜索后继续试剩下的 key | **真 bug** | 按了停止，界面报「已尝试 N 个密钥」；多打若干次注定失败的请求 |
| 3 | 密钥实测因加载顺序静默降级 | 隐患 | 某天实测按钮集体变成「这个版本不支持」 |
| 4 | 实测结论可能贴错行 | 隐患 | A 密钥的「可用」显示在 B 那一行 |
| 5 | 测试套件偶发红 | 套件可靠性 | 一套发红的测试会掩盖真回归 |

---

## 1. 搜索网关路拿错行的数据（真 bug）

**代码**：`src/vendors/commandcode/index.ts` 的 `gatewayAccess`。

provider 只在 commandcode 行注册（三行都注册会撞宿主的 `WEB_DUPLICATE_PROVIDER`），
但那个闭包读的是**自己行**的 `document()["apiKeyEnv"]` / `document()["apiBase"]`：

```ts
// 旧代码（bug）
gatewayAccess: async (provider) => {
  if (provider !== "opendesign") return undefined;
  const ref = document()["apiKeyEnv"];      // ← commandcode 行的账号 ref！
  const key = await credentials.resolve(ref);
  const base = document()["apiBase"];       // ← commandcode 行的端点！
  return { baseURL: base, key };
}
```

**后果链**：会话在 opendesign + DeepSeek 模型上 → 选路判 `gatewayReady` → 搜索请求拿着
**commandcode 的密钥**打 **commandcode 的端点**。而 `search-route.ts` 开头那张实测表早就写明：
`commandcode /provider/v1/messages + DeepSeek → 400（该端点只收 Claude 系）`。
更糟的是网关路是默认策略（`gateway-first`）的第一选择，**失败还不回退 API key**
（`chosen.kind === "gateway"` 时直接走网关块）——所以「配了 commandcode 账号的用户」
搜索从来都是失败的，且没有任何线索指向真正原因。

**为什么以前没被发现**：commandcode 行没配账号时 `gatewayAccess` 返回 `undefined` →
`hasGateway` 为假 → 选路退回 API key，搜索是通的。bug 只在「commandcode 配了账号」
+「会话在 opendesign」时发作 —— 而这正是主力用户的常态。

**修法**（沿用项目里已有的跨行注册表形状，`model-catalog-registry` 同款）：

- 新增 `src/vendors/gateway-access.ts`：`registerGatewayAccess(provider, accessor)` /
  `gatewayAccessOf(provider)`；访问器**用时现取**（不是登记时拷一份），任何失败读作
  「不可用」且绝不抛；
- `opendesign/index.ts` 登记自己那一份（基地址取本行 `baseURL`/`apiBase`，密钥按本行
  账号顺序解析，与适配器选账号同源）；
- `commandcode/index.ts` 改成 `gatewayAccess: (provider) => gatewayAccessOf(provider)`。

**关键验证**：`tsdown` 把 `gateway-access.ts` 提取成**共享 chunk**
（`lib/gateway-access-B1KtcMWy.js`），`lib/commandcode.js` 与 `lib/opendesign.js`
都 `import` 同一个文件 —— 模块级注册表在两个 bundle 之间真的共享（若各自打包一份，
跨行登记互相看不见，修复就等于没做）。

**测试**：`tests/vendors/gateway-access.test.ts`（4：现取语义 / 缺席不抛 / 抛错不抛 /
重复登记覆盖）、`opendesign.test.ts` +2（登记的是本行数据 / 没密钥时如实不可用）、
`assembly.test.ts` +1（**端到端**：两行装进同一宿主，搜索请求必须打在 opendesign 的
基地址上、用 opendesign 的密钥）。变异检验：把登记的基地址改回 commandcode 的端点 →
端到端用例红，报错信息正是旧 bug 的症状。

## 2. 取消搜索后继续试剩下的 key（真 bug）

**代码**：`src/vendors/search-provider.ts` 的 `worthAnotherKey`。

上一轮为了让「密钥里混中文导致请求根本没发出去（ByteString 错误）」也能换下一把 key，
把判定改成「没有状态码就换」。但 **`AbortError` 也没有状态码** —— 用户按停止被当成了
「这把 key 有问题」：

1. `fetch` 抛 `AbortError` → `worthAnotherKey` 返回 true → 拿同一个**已取消**的信号
   去试下一把 key（每把都瞬间失败）→ 最后报「搜索失败（已尝试 N 个密钥）」；
2. 连带：API 路取消后代码继续落到网关路，用同一个取消的信号再发一次请求。

**修法**（三处）：
- `isAbortError()` 单独识别取消，`worthAnotherKey` 对它返回 false（优先级最高）；
- API 路失败后先查 `signal?.aborted` → 抛「搜索已取消」，不回退网关；
- 网关路的 `fetch` 包 try/catch：在途取消也给一句干净的话，不把 DOMException 原样抛给宿主。

**测试**：`search-provider.test.ts` +4（只发一次 / 不回退网关 / 在途取消 /
**无 signal 时 401 照旧换 key** —— 防修取消把换 key 一起弄坏）。变异检验：分别删掉
三处修复，三条测试各自变红。

## 3. 密钥实测因加载顺序静默降级（隐患）

`probeSearchCredential` 取 `[...vendorDeps.values()][0]?.probeSearchKey` —— **第一家**的。
而目前只有 commandcode 行传了 `probeSearchKey`。加载顺序一变（或某行没传），
实测就整体变成「这个版本不支持密钥实测」，而另外两行其实能测。
改为 `.find(deps => deps.probeSearchKey !== undefined)`。+2 条回归测试。

## 4. 实测结论可能贴错行（隐患）

客户端 `testSecret` 取返回数组的 `[0]` 当作这一把 key 的结论。宿主契约说「顺序与入参一致」，
但结论贴错行（A 的可用性显示在 B 那一行）是很难自查的误导。改为按 `ref` 匹配，
匹配不到就当没测出来。

## 5. 测试套件偶发红

`tests/core/usage/export-safety.test.ts` 的「1500 条台账」用例要往真实台账追加 1500 条
（单跑约 900ms），全量并行下超过 vitest 默认 5 秒超时 → 整套报红。
**一套发红的测试会掩盖真回归**，所以给该用例显式 30 秒超时（与断言语义无关）。

---

## 审计过但**没有**问题的部分

- 全量 `tsc --noEmit` 0 错；**100 文件 / 1159 例全绿**（本轮 +13 例）；
- `tsdown` 构建干净，四个宿主入口均可加载；客户端按宿主 ModuleLoader 形状
  启动冒烟通过（`settings.section` / `sidebar.footer.action` / `main` 三条注册）；
- 设置保存的串行队列 + 修订号现取 + 草稿同步镜像（`saveRow` / `saveOneField` /
  `latestDrafts`）—— 连拨两个开关、排队期间改字段都不会撞修订号；
- 共享字段（`searchStrategy` / `searchApiKeyRefs`）的归属：功能页承载行是
  `llm-commandcode`，provider 也读 commandcode 行 —— 两边一致；
- 搜索选路（`chooseSearchRoute`）、`sourcesOf` 的「没有 `web_search_tool_result`
  就是失败」硬断言、`searchViaApi` 的分档文案、非 ASCII 密钥本地判 invalid；
- `web-search` 行已整体移除，产物里不再有 `@deepseek-ai/dsh-web` 的运行时依赖。

## 验证

```
tsc --noEmit        0 errors
vitest              100 files / 1159 tests 全绿
tsdown              15 files, 2.25 MB
boot smoke          settings.section(llm-account,12) + sidebar.footer.action(llm-account-quota,1)
                    + main(llm-account-dashboard)；三次注入均一次
```
