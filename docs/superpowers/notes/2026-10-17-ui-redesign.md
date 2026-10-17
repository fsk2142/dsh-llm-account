# 界面重做：三处界面共用一套设计语言（2026-10-17）

日期：2026-10-17
项目：`dsh-llm-account`
范围：`src/client/**`（样式、账户卡片、模型卡片、侧边栏卡、仪表盘）与两条新增测试
背景：上一轮把客户端「接进了宿主」，但截图仍然像调试输出——按钮一排五个带边框、额度只有
「标签 …… 数字」没有条、说明文字把标签挤成竖排单字、菜单项平铺在行里。这次只改表现层，
数据判定、远程契约、账户语义一律不动。

## 1. 先说结论：改了什么

| 位置 | 之前 | 现在 |
| --- | --- | --- |
| 账号行 | 身份、额度、5 个带边框按钮、拖拽手柄挤在同一行 | **身份行**（状态点 + 名称 + 标记 + 两个图标动作）+ **额度表**（每窗口一块，标签/读数一行、4px 进度条一条） |
| 行内动作 | 展开报告、重命名、换密钥、固定、移除全部平铺 | 展开/收起是箭头图标（`aria-expanded` 同时驱动语义与旋转）；其余收进 `⋯` 原生 `<details>` 菜单，排序的上移/下移也在菜单里 |
| 额度条 | 条没有 `display`，实际**画不出来**；档位属性与样式选择器名还对不上（`data-level` vs `data-quota-level`），颜色永远不生效 | 条真正可见；档位选择器与属性统一为 `data-quota-level`；ok/warn/error 三色 |
| 设置行 | 说明与输入框一起挤标签列，「用量刷新间隔（分钟）」竖排单字 | 标签 + 说明在左列，控件固定宽度在右；输入框 240px / 数字 140px / 下拉 180px |
| 布尔设置 | 浏览器默认复选框 | `appearance:none` 画出来的滑轨开关（34×20），勾选态用宿主的强调色 |
| 模型卡片 | 每行一个红色「移除」文字按钮 | 名称 + 滑轨开关 + 悬停才变色的「×」图标按钮 |
| 添加账户 | 标签与输入同行、入口与提交共用一个按钮 | 收起时一个虚线入口；展开后是「标签在上、输入占满整行」的表单，提交/取消独立 |
| 登录 | 通栏空面板里放一个按钮 | 行内按钮；等待中的说明与授权网址放在内嵌面板里 |
| 侧边栏卡 | 无进度条、刷新与打开是两个通栏按钮、切换提示是橙色裸文本 + ISO 时间 | 标题 + 刷新图标一行；切换提示是琥珀色小条（相对时间）；额度是紧凑列表 + 条；底部一个通栏按钮 |
| 侧边栏**收起态** | 整张卡向左溢出到窗口外（真机实测槽位只有 ~35px） | 外壳是宽度容器：窄时只渲染一个「用量」图标按钮，宽时才是完整卡片（`@container`） |
| 仪表盘 | 浏览器默认 h2/h3、账号块不是卡片、切换记录是 ISO 时间 | 标题行 + 图标动作；每个账号一张卡片（生效账号用强调色描边）；切换记录右端相对时间 |
| 空态 | 空列表与读取失败都用同一种裸段落 | 列表空态是虚线框；「数据暂不可用」是安静的一行说明（不再套第二个虚线框） |
| 焦点 | 没有焦点环（键盘操作不可见） | 统一 `2px` 焦点环，颜色回落 `--dsw-alias-state-business-primary` |

## 2. 样式表（`src/client/css.ts`）的纪律

- **只用宿主 `--dsw-*` 变量**，没有硬编码颜色；`tests/client/css.test.ts` 仍在逐条守着。
  - 注意：`white-space` 会命中那条「颜色名」正则（`white`），排版一律用 `text-wrap: nowrap`。
- 变量名逐个核对自**本机桌面端主题包**（`dsh-client-ui-theme/lib/client.js` 里的 CSS 串）与前端
  产物；本轮补齐了此前用错/不存在的几项：
  - `--dsw-radius-*`、`--dsw-shadow-lv3`、`--dsw-font-family`、`--dsw-font-mono`、
    `--dsw-alias-settings-card-fill/stroke`、`--dsw-static-neutral-bluish-00`（开关滑钮）。
  - **焦点环**：`--dsw-focus-ring-color` 在宿主里是动态值（默认仅声明了宽度），因此一律写成
    `var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`，否则 `solid` 缺色会让整条
    `outline` 失效。
- 新类名都在 `CSS_CLASS` 注册，并由 `tests/client/style-contract.test.ts` 的「每个按钮都有档位类、
  每个类名在样式表里都有规则」两条守着。
- 新模块：`icons.ts`（5 个 16×16 线性图标，`currentColor`）、`time.ts`（相对时间，纯函数）。

## 3. 真机验证（不重启桌面端也能看）

桌面端 21:48 启动时 `lib/` 不存在，因此**当前桌面端实例里没有本包 UI**；`lib/` 已重新构建，重启
桌面端即可看到（`/plugins/events` 里会出现 `dsh-llm-account`）。

为了在不重启桌面端的前提下把 UI 放进真实宿主里看，用了两条通道：

1. **静态预览**（`D:\work\.preview`，不在仓库内）：Vite + React 直接渲染 `PageShell` /
   `AccountCard` / `ModelsCard` / `SidebarCard` / `Dashboard`，样式表与**真实主题 token** 来自
   `app.asar` 里的 `dsh-client-ui-theme`；Chrome headless + CDP 截图。用于逐状态（干净/有改动/
   展开报告/编辑器/菜单展开/暗色）比对。
2. **第二个 web profile**（`~/.dsh/profiles/web`，由 `dsh plugin --profile web add
   link:D:/work/repo` 初始化，bundle 自动登记）：`dsh web --no-open --port 6901` 起一个
   独立实例，用 Chrome 打开打印出来的 token URL，实测：
   - 启动图包含本包（`/plugins/events`），`settings.section` 出现「LLM 账号」；
   - 两个厂商标签页都能被发现（`llm-commandcode`、`llm-opencode-go`）；
   - 账号数据（`Default` / `COMMANDCODE_API_KEY` / `monthlyCredits`）经真实远程面读回；
   - 侧边栏收起态显示图标按钮、展开态显示完整卡片；
   - 「打开用量面板」在中栏渲染仪表盘；保存条在有改动时出现（`data-save-bar`）。
   该 profile 里我们的设置被保存过一次（`showSidebarQuota: true`），不影响桌面 profile。

重启桌面端后的复验顺序：设置页 → LLM 账号（两标签页、账号行、模型、字段、高级设置）→ 侧边栏
底部（展开/收起两种形态）→ 打开用量面板。

## 4. 测试

- 全量：`pnpm test` — 35 files / 518 tests 通过；`pnpm typecheck` 通过；`pnpm build` 通过。
- `tests/client/style-contract.test.ts`（本轮一并入库）把两条与重做直接相关的结构契约钉住：
  - 账号行仍是两段结构（身份行里有 `dsl-identity`/`dsl-account-actions`，额度条不在身份行里）；
  - 每个按钮都有 CSS_CLASS 里的档位类，每个用到的类名在样式表里都有规则。
- `tests/client/quota.test.ts`（本轮一并入库）新增 `quotaMeter` 的覆盖：单位 0–100、档位阈值、
  `used/cap` 推算式、除零与缺失不画条、越界夹到 0–100。
