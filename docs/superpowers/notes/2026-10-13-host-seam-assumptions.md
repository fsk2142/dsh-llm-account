# 宿主接缝假设（试验已取消，改为记录假设）

日期：2026-10-13
项目：`dsh-llm-account`（一个包，托管两条 provider 路由：`commandcode`、`dsh-opencode-go`）
上游：计划 `docs/superpowers/plans/2026-10-13-dsh-llm-account-phase1-host.md`（Task 1）；规格 `docs/superpowers/specs/2026-10-13-dsh-llm-account-design.md`（§4.1、§8、§14）

## 0. 这份文档是什么

原计划的「宿主接缝试验」（写一个最小插件、在本机建 profile、启动宿主观察行为）已被用户取消。本文件把原本要靠试验回答的问题**改写成假设**，供两个下游使用：

- **计划 1b**（客户端统一页面）：按假设 ②③ 的兜底实现方式写代码。
- **Task 14**（两行装配与宿主冒烟）：用假 ctx 覆盖装配逻辑，只做得到的一小部分验证。
- **计划 1c**（真机切换验收）：必须逐条实测本文件 §4 的清单，把假设变成结论。

**读法**：§2 的三条都是**未验证假设，不是结论**。任何人不得把它们当作已确认的宿主行为引用。假设错误的后果已经写进每条里，目的是让 1b 的改动面最小。

## 1. 为什么跳过试验：两条硬事实

| 事实 | 证据 | 对试验的影响 |
| --- | --- | --- |
| 本机 PATH 上的 `dsh` CLI 是 **0.1.1-rc.2**（旧引擎） | 启动器 `C:\Users\me\AppData\Roaming\npm\dsh.ps1` → `C:\Users\me\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\package.json`，`"version": "0.1.1-rc.2"`（写作本文档时读文件核对；未执行任何 `dsh` 命令） | 用旧引擎建 profile 得到的宿主接缝结论不可信：桌面端不跑这个引擎 |
| 桌面端实际引擎是 **0.2.0-rc.2** | `C:\Users\me\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json`，`"desktopVersion": "0.2.0-rc.2"`（写作本文档时读文件核对） | 结论必须在与桌面端同版本的引擎上取；本机没有 |

**第三条取消理由**：客户端 `apply` 被调用几次（假设 ②）只能在**真实浏览器**里观察，本机没有这条观察通道 —— 它不是 CLI 能回答的问题。

## 2. 三条假设

### 假设 ① 子路径导出能被宿主加载器解析

- **假设**：宿主加载器能解析 `dsh-llm-account/commandcode` 与 `dsh-llm-account/opencode` 这类子路径导出，因此 `cordis.patch.yml` 里两行可以各自指向一个子路径入口。
- **依据**：Node 的 `exports` 字段解析规则；Task 0 已按 Global Constraints 写全 `exports`（`./commandcode`、`./opencode`、`./client`、`./package.json`）。
- **验证方式**：Task 14 Step 2 —— `pnpm build && node -e "import('dsh-llm-account/commandcode').then(m => console.log(Object.keys(m)))"`，期望打印出 `apply`、`Config`、`inject`、`PROVIDER_ID` 且无 `ERR_MODULE_NOT_FOUND`。
  注意：这一步只证明 **Node 能解析**该导出，不等于**宿主加载器**能解析；宿主加载器一侧列在 §4 清单第 2 项，由计划 1c 实测。
- **假设错误的后果**：两行的 `name` 要退回**包根 + 参数化的单入口**（`dsh.bundle.patch` 两行同指包根，入口靠参数区分厂商）。改动集中在装配层，不影响 `src/core/` 与两个适配器。

### 假设 ② 同一个包插入两行时，客户端 `apply` 被调用两次（每行一次）

- **假设**：两行 → 宿主调用客户端 `apply` 两次，每行一次。
- **依据**：**无** —— 纯未验证，且只能在真实浏览器里观察。规格 §14 把这一项列为未决风险（「可能出现两个设置页或只注册一个」）。
- **因此计划 1b 走兜底路径**：统一设置页**不依赖每实例注入的状态**，而是直接按设置命名空间（`llm-commandcode`、`llm-opencode-go`）读取两家的数据。（规格 §8 的主路径是模块级单例注册表、只有主实例注册那唯一一个页面；1b 采用兜底路径，两条路径页面组件与数据形状相同，只换数据来源。计划 1b 已按此记录。）**注（我们的推理，非宿主观察）**：兜底路径解决的是**数据来源**，不解决页面**重复注册**；若计划 1c 实测发现页面被注册两次，需要另行决定「只让主实例注册页面」。
- **验证方式**：计划 1c 真机观察 —— §4 清单第 3 项（页面被注册几次）。本期与 Task 14 都无法验证（假 ctx 不经过浏览器加载器）。
- **假设错误的后果**：若 `apply` 实际上只被调用一次（或注册表机制可用），页面**可以简化** —— 改为依赖注入的状态，去掉按命名空间直读的那一层；成本是白写了一层数据源适配，不返工页面组件。

### 假设 ③ `settings.section` 接受 `order`，且 `hooks` 键被投影成 `use<Key>` props

- **假设**：客户端插件的 `settings.section` 注册接受 `order` 并据此排序；`hooks` 映射里形如 `commandCodeSettings` 的键，在页面里以 `props.useCommandCodeSettings(selector)` 的形式可用。
- **依据**：旧插件的**调用点形状**（§3），来自**控制器的只读调研**，不是本文档作者的验证；规格 §14 另记：宿主包在不可读的 asar 里，契约无法从已安装文件读出，只能靠行为观察。
- **实现方式（计划 1b）**：按旧插件的调用点形状实现 —— `{ name, id, order, label, locale?, inject }` + `hooks` 映射 —— 并把这一层收在一个**薄适配层**里，实测后只改那一层。统一页面按规格 §8 注册一个 `settings.section`（id `llm-account`，order 12，取代旧插件的两个页面）。
- **验证方式**：Task 14 验证不了（假 ctx 不触发页面注册）；计划 1c 实测 —— §4 清单第 4 项（`order` 是否生效）与第 3 项（页面是否出现、出现几次）。
- **假设错误的后果**：只改薄适配层，页面主体不动。若 `order` 不被接受，页面在设置里的顺序需要另找机制（例如依赖注册先后或 `id`）；若 `hooks` 键不被投影成 `use<Key>`，该页面拿设置数据的通道需要改为其它可用路径（例如走远程 `settings.describe()`）。

## 3. 旧插件的调用点形状（引用，本文档未验证）

来源：**控制器的只读调研**。安装目录为 `C:\Users\me\.dsh\profiles\desktop\node_modules\`。本文档作者**没有打开**这些包，以下内容逐字来自任务书，未经独立复核。

- Command Code 客户端 `@mars-sea/dsh-commandcode-provider/lib/client.js`：
  - `settings.section` 注册形状 `{ name, id, order, label, locale, inject }`（id `commandcode`，order 12）。
  - `hooks` 键形如 `commandCodeSettings`；页面以 `props.useCommandCodeSettings(selector)` 读取。
- OpenCode 客户端 `dsh-opencode-go/lib/client.js`：
  - 同样 `settings.section`（id `opencode-go`，order 20，**无** `locale` 字段）；页面以 `props.useOpencodeGo(selector)` 读取。
- 两者共同点：都通过 `ctx.remote.$on("credentials/reference-updated", …)` 接收凭据推送；都自带 `<style data-plugin-css>`；都只用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`/`Tag`/`Switch`/`Menu`。

用途：假设 ③ 的依据，以及计划 1b 页面注册与数据读取的书写模板。它是**观察到的旧插件写法**，不等于**宿主接受的契约**。

## 4. 计划 1c 必须实测的清单

计划 1c 要在用户在场、与桌面端同版本（`0.2.0-rc.2`）的引擎上执行。以下每项都是假设转结论的判定点：

| # | 必测项 | 怎么测 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 真机启动 | 卸载旧插件、装入新包后启动桌面端 | 正常启动，无重复注册 provider 路由或行 id 导致的失败（两插件互斥，规格 §13） |
| 2 | 两条路由是否注册 | 在模型选择器/配置里查看路由 | `commandcode` 与 `dsh-opencode-go` 都注册，各一次（同时验证假设 ① 的宿主加载器一侧） |
| 3 | 页面被注册几次 | 打开设置，观察统一页面 | 恰好一个（id `llm-account`）—— 不是两个，也不是零个（假设 ② 的判定点） |
| 4 | `order` 是否生效 | 观察统一页面在设置里的位置 | 落在期望的 order 位置；否则记录实际顺序与机制（假设 ③ 的判定点） |
| 5 | 模型目录是否出现在选择器里 | 打开模型选择器 | 两家（按可见性规则应出现的）模型都出现且可选 |

Task 14 Step 4 的 `docs/superpowers/notes/2026-10-13-host-smoke.md` 需把本期无法验证的部分指向本清单。

## 5. 与其它任务的衔接

- **计划 1b**：用假设 ③ 的形状写薄适配层；按假设 ② 走兜底路径（页面直读两个命名空间）。
- **Task 14**：Step 2 验证假设 ① 的 Node 一侧；Step 3 用假 ctx 覆盖装配；Step 4 记录无法验证项。
- **计划 1c**：执行 §4 清单，回填结论；任何一条与本文件假设不符，都只改对应的薄层/装配层。
