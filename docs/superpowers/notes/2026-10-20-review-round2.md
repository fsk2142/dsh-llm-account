# 第二轮完整审查报告（复审）

- 日期：2026-10-20
- 范围：`<repo>` 全仓库（core / 三家厂商适配器 / 客户端 / 构建产物）
- 触发：用户要求复审，并提到「deepseek 说没有 bug 了」
- 纪律：**只读审查**——未改代码、未提交、未推送；`lib/` 重建后确认与已提交产物一致，工作树干净。

## 结论

**没有高 / 中危功能 bug**（DeepSeek 的判断基本成立）。严格挑出 **4 个 LOW 级健壮性缺口**，全部属于同一类：边界形状校验不完整——项目自己的纪律是「线上值形状不可信」，多数模块做到了，有四处漏了。

## 4 个发现（按危害排序）

### 1. 限流冷却可能被静默绕过 — LOW
- 位置：`src/vendors/commandcode/failures.ts`（30 天重置视野判定）
- 根因：只查上界（`value <= horizon`），不查下界。厂商若回一个**过去**的重置时刻，该值会通过校验进入 `Rejection.resetAt`；`RotationEngine` 发现 `now >= expiresAt` 便当场删除拒绝记录——等于这次限流**完全没有冷却**，账号被立刻重试。
- 对照：opencode / opendesign 不解析正文 resetAt，无此问题。
- 建议修法：`resetAt > now` 才采信，否则退回 `now + 5 分钟冷却`。

### 2. `discoverVendors` 不校验行是否是对象 — LOW（失败形态最难自查）
- 位置：`src/client/seams.ts:218` 附近
- 根因：循环里直接读 `row.ns` / `row.id`。宿主 `describe()` 数组里混进一个 `null` 即抛 TypeError；而 1195 行调用点**没有 `.catch`** → 未处理拒绝 + 设置页永远拿不到快照（症状：设置页空白且无任何提示）。
- 对照：同类代码 `completeReading`、`parseCredentialStatus` 都校验了对象形状，唯独这里漏了。

### 3. 额度字段用「长度」判真假，字符串也有 length — LOW
- 位置：`src/client/account-card.ts` / `src/client/dashboard.ts`
- 根因：`quotaOf?.windows?.length ? quotaOf.windows : 兜底` 与 `(quotaOf?.failures ?? []).map(...)`。若线上 `quota.windows` 是**字符串**，长度检查通过，随后 `.map` 抛错。更深的根因：`parseVendorUsageStatus` 只验顶层形状、不逐项校验 `quota`（而 `parseCatalogModels` 是逐项洗的）。
- 影响面：有 `RenderBoundary` 兜底，不会白屏，但对应面板降级为「面板失败 + 重试」。

### 4. 三行不对称（信息性） — INFO
- commandcode 的 Config 不声明 `enabled` 字段（opencode / opendesign 都有）。
- 后果：用户手改 profile 把 commandcode 行配成 `enabled: false` **不会生效**。宿主插件管理器级禁用不受影响。
- 不是门失效（commandcode 本就无条件注册），是字段缺失导致的三行不一致。

## 顺带记录（非缺陷）

- 死语句 `void currentKey;`（`src/core/switching/model-fallback.ts:191`）。
- `fallbackEffort` 生产未接线（仅测试使用）；档位安全性由 `#declaredEffort` 声明闸门保证，功能不缺。
- 上一轮已修的真 bug（搜索网关路拿错行数据、取消后继续试 key、`completeReading` 形状崩溃）本轮复核**未回归**。

## 证伪记录

曾假设 `src/core/transport.ts` 的 `Promise.race` 落败者晚到 rejection 会造成未处理拒绝。写独立复现脚本实测**不成立**：`Promise.race` 给两个输入都挂了 handler，晚到 rejection 被其吞掉；对照组（裸 `Promise.reject`）验证了检测器有效。故未计入发现。教训：先复现、再报告。

## 审查覆盖与证据

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错 |
| vitest 全量 | 109 文件 / 1244 例全绿 |
| tsdown 构建 | 15 文件；commandcode / opencode / opendesign / index 四个宿主入口均可加载 |
| 客户端启动冒烟 | 三条注册 + 三次注入，形状正确 |
| CSS 模板字面量 | 62 个反引号配对；源码与产物 `.dsl-*` 类名数一致（138 = 138） |
| 逐层审查 | core 纯函数（账号/目录/凭证/失败/切换/恢复/用量台账）；三家适配器 stream 主循环与装配；usage-remote 远程面；客户端页面/容器/样式/更新检查 |

## 修复建议优先级

1. **发现 2** 优先（几行，失败形态是静默的，用户侧无任何提示）。
2. **发现 1**（几行，影响冷却语义）。
3. **发现 3** 视对「宿主发坏数据」这种极端情况的在意程度。
4. **发现 4** 知悉即可。

## 修复记录（2026-10-20 晚，控制器实施）

四条**全部**已修，各带回归测试与变异检验（把修复改回旧行为，对应用例变红）：

| # | 修法 | 测试 |
| --- | --- | --- |
| 1 | `withinHorizon` 加上下界 `value > now`：过去的时刻不是证据，丢弃让调用方退回短冷却 | `commandcode.test.ts` +2（显式秒数 / 文案 ISO 时间戳落在过去） |
| 2 | `discoverVendors` 的循环先验 `typeof row === "object" && row !== null`；空态统计同样跳过坏元素 | `settings-describe-shape.test.ts` +2（混进 null/非对象 / 全是坏元素） |
| 3 | 在**边界**上逐项洗 `quota`（`parseVendorUsageStatus`）：`windows`/`failures` 非数组归空、`quota` 非对象归缺失。一处修复覆盖三张卡片（account-card / dashboard / sidebar-card） | `usage-contract.test.ts` +3（坏 windows / 坏 quota / 真形状原样通过） |
| 4 | commandcode 的 Config 补 `enabled`（`default(true)`）并据此 `registerAdapter`/撤下，与另两行对称 | `assembly.test.ts` +2（false 不注册 / 缺省按启用） |

顺带说明发现 3 的**根因位置**：报告指出的三处 `.length` 假值检查只是**症状**，真正的缺口在
`parseVendorUsageStatus` 只验顶层、把 `quota` 原样透传（而同文件 `parseCatalogModels` 是逐项
清洗的）。修在边界上，三张卡片就不必各自防御 —— 这也是项目既有的分工。

`void currentKey;` 与 `fallbackEffort` 未接线两条（报告「顺带记录」）**未动**：前者是无副作用的
死语句，后者由 `#declaredEffort` 声明闸门保证安全，都不构成缺陷。

