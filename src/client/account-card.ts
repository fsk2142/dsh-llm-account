/**
 * 账户卡片：账号行、额度表、操作菜单、添加账户与网页登录入口。
 *
 * 与 `page.ts` 同样的纪律（Ruling 22）：**纯 props → 元素树**，没有 Hook、没有内部状态。
 * 用户输入到一半的名称/密钥住在 `page-state.ts` 的 `action` 草稿里（可完整单测），
 * 卡片只负责渲染它、把变化报出去 —— 这条由测试用替身机械保证（Hook 一律抛错）。
 *
 * 三条不可退让的规则：
 * 1. **额度缺失不得渲染成 0**：窗口里没有的字段就是没有，宁可显示「暂无额度数据」。
 * 2. **密钥只走账户操作**：密钥输入不带设置字段标记（`data-field`），因此进不了设置草稿与保存条。
 * 3. **按能力降级**：菜单项与登录入口都由宿主发布的能力声明决定（规格 §7.3），不是写死的。
 *
 * 视觉结构（2026-10-17 的界面重做）：
 * - 一行账号 = **身份行**（状态点 + 名称 + 标记 + 行尾动作）+ **额度表**（每个窗口一小块，
 *   标签与读数一行、进度条一条）两段；两段之间不再让名称与额度抢同一行的宽度；
 * - 行内动作只留三个图标按钮（刷新模型、展开报告、更多操作），重命名/恢复默认名称/
 *   换密钥/移除/上移/下移全部收进 `⋯` 菜单 —— 一行五个带边框的文字按钮是「像调试输出」
 *   的主要来源；
 * - 展开报告、编辑器、登录等待都是内嵌面板（`dsl-inset`），不是散落在行间的裸文本。
 *
 * **注**：菜单里**没有**「固定账号」项 —— 那在 2026-10-19 被有意移除（切换账号改走
 * 全局切换面板的顺序列表）。2026-10-23 修正了本注释此前仍列着「固定」的过时描述。
 * @module dsh-llm-account/src/client/account-card
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS, cls } from "./css";
import { companyLabelOf, groupModels } from "../core/model-groups";
import { rejectionText } from "./copy";
import { failureListText } from "./failure-text";
import { failureText } from "./failure-text";
import { ChevronIcon, ExternalIcon, MoreIcon, MoveIcon, RefreshIcon } from "./icons";
import { isHttpUrl } from "./login-window";
import type { AccountAction } from "./page-state";
import { QuotaBar } from "./quota-bar";
import { fallbackQuotaWindows, quotaPlanText } from "./quota";
import type { AccountUsageStatus, CatalogModel, ModelRule, QuotaWindow, VendorCapabilities, VendorUsageStatus } from "./usage-contract";

/** 登录状态面（由页面从远程 `loginStatus` 取得）。 */
export interface LoginView {
  state: string;
  authUrl?: string;
  /** 设备码流程要在浏览器里输入的代码。 */
  userCode?: string;
  /** 等待的过期时刻（epoch 毫秒）。 */
  expiresAt?: number;
  reason?: string;
  /**
   * 失败时的外部命令诊断原文（`vela` 的输出片段）。
   *
   * 界面把它显示在失败原因**下面**：`reason` 只有一句稳定文案（「等待授权超时」），
   * 而这句才能区分「命令没启动」「启动后崩了」「没有任何输出」这几种完全不同的病因。
   */
  detail?: string;
}

/** 卡片属性：全部数据与回调，卡片自己不持有任何状态。 */
export interface AccountCardProps {
  /** 该厂商的状态；远程面还没挂上时为 `undefined`（卡片显示「暂无数据」而不是报错）。 */
  status: VendorUsageStatus | undefined;
  /**
   * 读不到状态时的原因（宿主原文）。
   *
   * `status === undefined` 有四种病因而症状一模一样，界面必须显示它，否则每次都得靠猜。
   */
  problem?: string | undefined;
  t: (key: string) => string;
  /** 正在进行的账户操作（来自 `page-state.ts`）。 */
  action?: AccountAction | undefined;
  /** 展开完整报告的账号。 */
  expandedRef?: string | undefined;
  /**
   * 上一次「确定」没提交出去的原因（人话）。
   *
   * 存在的理由（2026-10-18 用户报障「新增账号的操作逻辑」）：空名称/空密钥时
   * `dispatchAccountAction` 按规矩**不发调用**，界面于是没有任何可见反应 —— 按钮看起来像坏的。
   * 现在由容器把原因放进来，编辑器里显示这一行。
   */
  actionError?: string | undefined;
  /** 平铺账户列表里跟在账号名后的供应商标签；单卡模式不传。 */
  vendorLabel?: string | undefined;
  /** 网页登录的当前状态（没有登录入口的厂商为 `undefined`）。 */
  login?: LoginView | undefined;
  onOpenAction: (action: { kind: AccountAction["kind"]; ref?: string; label?: string }) => void;
  onActionField: (field: "label" | "key", value: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  /** 固定账号 / 切换账号；`null` 表示回到自动轮换。 */
  onSelect: (ref: string | null) => void;
  onRemove: (ref: string) => void;
  onToggleExpand: (ref: string) => void;
  onLoginBegin: () => void;
  /** 调整顺序（目标账号、移动后的最终下标）；没有排序能力的厂商不传。 */
  onMove?: (ref: string, toIndex: number) => void;
  /**
   * 追加到每一行 `⋯` 菜单末尾的厂商专属控件（T6 的排序控件由 `opencode-account-card.ts` 注入）。
   *
   * 扩展点：行本身的渲染只有一份实现（额度条、状态标记、菜单都在这里），厂商差异通过这个
   * render prop 挂上去，而不是复制一整行。
   * @param account - 该行账号。
   * @param index - 它在轮换顺序里的下标（排序控件要用）。
   */
  rowExtras?: (account: AccountUsageStatus, index: number) => ReactNode;
  /** 该厂商的模型目录（用于每个账号的可用模型）。 */
  catalog?: readonly CatalogModel[];
  /** 模型目录正在读取（还没有结果）。 */
  catalogLoading?: boolean;
  /** 模型目录读取失败原因（宿主原文）；读取正常或缺省。 */
  catalogFailure?: string;
  /**
   * 重新读取模型目录：账号行内的「刷新此账号的模型」按钮与模型区读失败时的「重试」
   * 共用这一个动作（目录是厂商级资源，回调不带账号）。
   */
  onRetryCatalog?: () => void;
  /** 当前模型→账号规则。 */
  modelRules?: readonly ModelRule[];
  /** 覆盖某个账号的模型；同一模型可属于多个账号。 */
  onSetAccountModels?: (ref: string, models: readonly string[]) => void;
  /**
   * 查一个模型在**当前套餐**下能用多少额度（用户 2026-10-21 要的功能）。
   *
   * 返回 `undefined` 表示官方没给这个组合的数据（套餐认不出 / 模型不在表里）——
   * 这时卡片显示「未知」，绝不编一个数字出来。判断与格式化都在容器里做，
   * 卡片只负责把它摆在开关左边。
   * @param account - 该行账号（额度与账号当前的套餐有关）。
   * @param modelId - 模型 id（目录里的原始写法）。
   * @returns 已格式化的一行文字；没有数据时 `undefined`。
   */
  modelQuotaOf?: (account: AccountUsageStatus, modelId: string) => string | undefined;
  /**
   * 这个模型在**该账号当前套餐**下能不能用（用户 2026-10-21：不要把本套餐用不了的
   * 模型也列出来）。
   *
   * 三档语义：`true` 可用；`false` **明确不可用**（隐藏）；`undefined` 没有官方清单
   * （照常显示，不能凭猜测隐藏）。
   * @param account - 该行账号。
   * @param modelId - 模型 id。
   * @returns 是否可用；未知时 `undefined`。
   */
  modelAvailable?: (account: AccountUsageStatus, modelId: string) => boolean | undefined;
  /**
   * 该账号的用量统计（容器按 ref 提供）。
   *
   * 放在**账号行内**（额度条下方）而不是另起一张大卡：用户 2026-10-19 要求「单个账号的
   * 统计放在该账号下面」—— 额度与用量本来就是同一个账号的两面，分开看要来回找。
   * 返回 `undefined` 表示这一行不画（还没读到数据）。
   */
  usageOf?: (ref: string) => ReactNode;
  /**
   * 卡片底部的常驻内容（OpenCode 的 `autoSwitch` 开关）。
   *
   * 放在这里而不是让厂商卡片在外面另起一个 `<section>`：那个开关属于这张卡片，
   * 单独漂在卡片上方（重做前的样子）既没有归属也看不出它在管什么。
   */
  cardFooter?: ReactNode;
}

/**
 * 「恢复默认名称」这个动作**应当恢复成什么**（2026-10-22 用户要求）。
 *
 * 用户原话：「账号名称修改后如果不想用了可以恢复为默认名称，就是账户原本的名称」，
 * 并明确默认名称 = 登录邮箱。
 *
 * 三个返回 `undefined` 的情形，对界面都是同一件事（菜单项不显示）：
 *
 * - 账号没有记录默认名（2026-10-22 之前建的老账号）——**不猜**；
 * - 默认名是空白；
 * - 当前名**已经等于**默认名 —— 没有什么可恢复的。
 * @param account - 账号视图（`defaultLabel` 可选）。
 * @returns 应当恢复成的名称，或 `undefined`（不可恢复）。
 */
export function restoreDefaultLabelOf(account: {
  label: string;
  defaultLabel?: string | undefined;
}): string | undefined {
  const fallback = account.defaultLabel?.trim() ?? "";
  if (fallback === "") return undefined;
  // 已经是默认名：菜单项不该出现（点了也没有变化）。
  if (fallback === account.label.trim()) return undefined;
  return fallback;
}

/**
 * 账户卡片。
 * @param props - 见 {@link AccountCardProps}。
 * @returns 元素树。
 */
export function AccountCard(props: AccountCardProps): ReactElement {
  return createElement(
    "section",
    { "data-card": "accounts", className: CSS_CLASS.card },
    createElement("h2", null, props.t("group.accounts")),
    ...accountCardBody(props),
  );
}

/**
 * 账户卡片的内容（不含外层 `<section>` 与标题）。
 *
 * 合并面板把两家放进同一张卡片：每家一个分组标题，内容复用这里 —— 行的渲染只有一份实现，
 * 面板与单卡不会长出两套额度条/菜单/登录逻辑。
 * @param props - 见 {@link AccountCardProps}。
 * @returns 元素数组。
 */
export function accountCardBody(props: AccountCardProps): ReactNode[] {
  const { status, t } = props;
  // 线上 `accounts` 可能缺（`?? []`），也可能含**渲染不了的行**（非对象）—— 结构校验只查
  // 「是不是数组」，不查每一行。渲染路径必须自己挑出能画的行：一行画不了不该让整张卡片崩。
  const accounts = (status?.accounts ?? []).filter(
    (account): account is AccountUsageStatus => typeof account === "object" && account !== null,
  );
  return [
    // 空态分三种原因，文案不许混用：「远程面还没挂上」是数据不可用；「挂上了但一家账号都
    // 没有」是提示用户去添加 —— 都写成「暂无额度数据」会把没账号显示成额度故障。
    ...(status === undefined
      ? [
          createElement("p", { key: "unavailable", "data-accounts-empty": "true", className: CSS_CLASS.note }, t("account.unavailable")),
          // 原因必须显示：上面那句话对「远程面没挂上」「读口没装配」「调用报错」「形状不认识」
          // 四种病因都成立，不显示就只能靠猜（本机实测里已经猜错过好几轮）。
          ...(props.problem === undefined
            ? []
            : [
                createElement(
                  "pre",
                  { key: "problem", "data-usage-problem": "true", className: CSS_CLASS.diagnostic },
                  props.problem,
                ),
              ]),
        ]
      : accounts.length === 0
        ? [createElement("p", { key: "empty", "data-accounts-empty": "true", className: CSS_CLASS.note }, t("account.empty"))]
        : []),
    ...accountRows(props),
    ...loginSection(props),
    addSection(props),
    props.cardFooter === undefined ? null : props.cardFooter,
  ];
}

/**
 * 只渲染账号行与失败项（不含空态/添加/登录），供平铺账户列表使用。
 * @param props - 见 {@link AccountCardProps}。
 * @returns 元素数组；调用方自己决定空态与全局添加区。
 */
export function accountRows(props: AccountCardProps): ReactNode[] {
  const accounts = (props.status?.accounts ?? []).filter(
    (account): account is AccountUsageStatus => typeof account === "object" && account !== null,
  );
  return [...accounts.map((account, index) => accountRow(props, account, index)), ...failureNotes(props)];
}

/** 添加入口/表单（平铺列表复用）。 */
export function accountAddSection(props: AccountCardProps): ReactNode {
  return addSection(props);
}

/** 一行账号：身份行（名称 + 标记 + 动作）在上，额度表在下。 */
function accountRow(props: AccountCardProps, account: AccountUsageStatus, index: number): ReactNode {
  const { t } = props;
  const pinned = props.status?.pinned === account.ref;
  const effective = account.effective;
  // 两者相同只标一次（避免同一件事写两遍）。
  const marks: ReactNode[] = [];
  const selected = account.active === true || pinned;
  if (selected) {
    marks.push(createElement("span", { key: "effective", "data-mark": "effective", className: CSS_CLASS.mark }, t("account.effectiveBy")));
  } else if (effective) {
    // 手动切到别的账号后，旧账号可能还在完成最后一个请求：标成「生效中」而不是「当前使用」。
    marks.push(createElement("span", { key: "live", "data-mark": "live", className: CSS_CLASS.mark }, t("account.liveBy")));
  }

  // `?? undefined`：契约里 `rejection` 是可选字段，而线上可能把它序列化成 `null`
  // （JSON 没有 undefined）。只写 `!== undefined` 会让 `null` 走进来，接着读
  // `.kind` 抛错 —— 渲染路径一抛，整张卡片变空白。
  const rejectionOf = account.rejection ?? undefined;
  const rejection =
    rejectionOf === undefined
      ? null
      : createElement(
          "p",
          {
            key: "rejection",
            "data-rejection-kind": rejectionOf.kind,
            className: CSS_CLASS.rejection,
            ...(rejectionOf.until === undefined ? {} : { "data-rejection-until": rejectionOf.until }),
          },
          // 可读文案，不是原始枚举（`quota`/`server`/…）；机器可读的值在 data 属性上。
          rejectionText(t, rejectionOf.kind),
        );

  const editingKey = actionOf(props, "key", account.ref);
  const editingRename = actionOf(props, "rename", account.ref);
  // `quota` 同上：可选字段，线上可能是 `null`（当作「没有摘要」，不是「有摘要但为空」）。
  const quotaOf = account.quota ?? undefined;

  // 副文案只显示配置状态；ref 是宿主生成的内部键，不再上屏。
  const statusText = account.configured ? t("account.configured") : t("account.missing");

  return createElement(
    "div",
    {
      key: account.ref,
      "data-account": account.ref,
      className: CSS_CLASS.account,
      "data-effective": effective,
      ...(rejectionOf === undefined ? {} : { "data-rejection-kind": rejectionOf.kind }),
      ...(rejectionOf?.until === undefined ? {} : { "data-rejection-until": rejectionOf.until }),
    },
    createElement(
      "div",
      { className: CSS_CLASS.accountHead },
      createElement(
        "span",
        { className: CSS_CLASS.identity },
        createElement("span", { className: CSS_CLASS.dot }),
        createElement(
          "span",
          { className: CSS_CLASS.identityText },
          createElement(
            "span",
            { className: CSS_CLASS.nameRow },
            createElement("strong", { "data-account-label": account.ref }, account.label),
            ...(props.vendorLabel === undefined
              ? []
              : [createElement("small", { key: "vendor", "data-account-vendor": props.vendorLabel, className: CSS_CLASS.vendorBadge }, props.vendorLabel)]),
            ...marks,
          ),
          createElement(
            "small",
            { "data-account-status": account.configured ? "configured" : "missing" },
            statusText,
          ),
          // 订阅套餐：厂商报告了订阅才有这一行（未订阅不是错误，什么都不画）。
          ...(() => {
            const plan = quotaOf?.plan;
            if (plan === undefined) return [];
            const text = quotaPlanText(t, plan);
            if (text === undefined) return [];
            return [
              createElement(
                "small",
                { key: "plan", "data-account-plan": plan.id, className: CSS_CLASS.note },
                text,
              ),
            ];
          })(),
        ),
      ),
      createElement(
        "div",
        { className: CSS_CLASS.accountActions },
        effective || (account.active === true && props.status?.effective === undefined)
          ? null
          : createElement(
              "button",
              {
                type: "button",
                "data-account-use": account.ref,
                className: CSS_CLASS.buttonGhost,
                onClick: () => props.onSelect(account.ref),
              },
              t("account.use"),
            ),
        // 按账户刷新模型（2026-10-18 用户要求「每个账户缺少单独刷新的按钮」）：刷的是这个
        // 账号所属厂商的目录。加载中禁用并转圈（`aria-busy` 挂给样式层）。
        ...(props.onRetryCatalog === undefined
          ? []
          : [
              createElement(
                "button",
                {
                  key: "refresh-models",
                  type: "button",
                  "data-account-refresh-models": account.ref,
                  "aria-label": t("models.refreshAccount"),
                  title: t("models.refreshAccount"),
                  className: CSS_CLASS.icon,
                  disabled: props.catalogLoading === true,
                  ...(props.catalogLoading === true ? { "aria-busy": "true" } : {}),
                  onClick: () => props.onRetryCatalog?.(),
                },
                createElement(RefreshIcon, null),
              ),
            ]),
        accountMenu(props, account, index),
      ),
    ),
    rejection,
    // 额度读取里的**部分失败**（端点级）照样列出来：与仪表盘同一条纪律 —— 不列就等于把
    // 一次不完整的读数呈现成完整的（`billing/credits` 真读不到时只剩月度一条，看起来像
    // 「5 小时/每周额度被吞了」）。文案翻成人话（`whoami` → 「账号信息读取失败」），宿主原文
    // 留在 data 属性里供排查。
    ...(quotaOf?.failures ?? []).map((failure, index) =>
      createElement(
        "small",
        {
          key: `quota-failure-${index}`,
          "data-account-quota-failure": account.ref,
          "data-failure-detail": failure,
          className: CSS_CLASS.failure,
        },
        failureText(t, failure),
      ),
    ),
    ...(() => {
      const windows = quotaOf?.windows?.length ? quotaOf.windows : fallbackQuotaWindows(props.status?.vendor ?? "");
      return [createElement("div", { key: "meters", className: CSS_CLASS.meters }, ...quotaBars(props, windows))];
    })(),
    // 该账号的用量：紧贴额度条下方（额度是「还剩多少」，用量是「用了多少」，成对读）。
    props.usageOf?.(account.ref) ?? null,
    editingRename ? renameEditor(props, account) : null,
    editingKey ? keyEditor(props, account) : null,
    accountModelsSection(props, account),
  );
}

/** 每个账号下的模型选择；同一模型可以同时出现在多个账号里。 */
function accountModelsSection(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  if (props.onSetAccountModels === undefined) return null;
  // 目录还没读出来时，这一节**不消失**：加载中说加载中，读失败时说失败并给重试。
  // 旧行为是整体返回 null —— 用户看到的是「这个账号没有模型可选」，与「正在读」
  // 「读失败」三种病因混为一谈，且没有任何入口补救（2026-10-18 用户要求补上）。
  if (props.catalog === undefined) {
    if (props.catalogLoading === true) {
      return createElement(
        "p",
        { key: "models-loading", "data-account-models-loading": account.ref, className: CSS_CLASS.note },
        props.t("models.loading"),
      );
    }
    if (props.catalogFailure !== undefined) {
      return createElement(
        "div",
        { key: "models-failure", "data-account-models-failure": account.ref, className: cls(CSS_CLASS.inline, CSS_CLASS.inset) },
        createElement(
          "p",
          { "data-failure-detail": props.catalogFailure, className: CSS_CLASS.failure },
          failureListText(props.t, props.catalogFailure),
        ),
        ...(props.onRetryCatalog === undefined
          ? []
          : [
              createElement(
                "button",
                {
                  key: "retry",
                  type: "button",
                  "data-account-models-retry": account.ref,
                  className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
                  onClick: () => props.onRetryCatalog?.(),
                },
                createElement(RefreshIcon, null),
                props.t("models.retry"),
              ),
            ]),
      );
    }
    return null;
  }
  const selected = new Set(props.modelRules?.find((rule) => rule.account === account.ref)?.models ?? []);
  /**
   * **只列出本套餐真正能用的模型**（用户 2026-10-21 要求）。
   *
   * 网关返回的是全站目录（不知道你的档位），所以过滤必须在客户端做。判据由容器给
   * （`props.modelAvailable`）：返回 `false` 才是「明确不可用」并隐藏；返回
   * `undefined` 表示这家没有官方清单，**照常显示** —— 没有依据就藏模型会让用户
   * 以为功能坏了。
   *
   * 已勾选的模型即使不在清单里也保留（`selected.has`）：那是用户此前的选择，
   * 悄悄让他「丢了一个已启用的模型」比留一行更糟。
   */
  const visible = props.catalog.filter(
    (model) => props.modelAvailable?.(account, model.id) !== false || selected.has(model.id),
  );
  const groups = groupModels(visible.map((model) => ({ id: model.id, company: model.company, free: model.free })));
  const byId = new Map(visible.map((model) => [model.id, model]));
  const groupLabel = (key: string): string =>
    key === "free" ? props.t("models.freeGroup") : key === "other" ? props.t("models.otherCompany") : companyLabelOf(key);
  return createElement(
    "details",
    { "data-account-models": account.ref, className: CSS_CLASS.inset },
    createElement(
      "summary",
      { className: CSS_CLASS.orderSummary },
      // 分母用**过滤后**的数量：它才是用户眼里「这个账号能选的模型」。
      // 用原始目录长度会出现「1/96」但列表里只画了 71 行，数字对不上。
      `${props.t("account.models")} (${selected.size}/${visible.length})`,
    ),
    // 目录读到了一部分（部分失败）时也说失败：不列就等于把一次不完整的目录呈现成完整的。
    ...(props.catalogFailure === undefined
      ? []
      : [
          createElement(
            "div",
            { key: "catalog-failure", className: cls(CSS_CLASS.inline, CSS_CLASS.inset) },
            createElement(
              "p",
              { "data-failure-detail": props.catalogFailure, className: CSS_CLASS.failure },
              failureListText(props.t, props.catalogFailure),
            ),
            ...(props.onRetryCatalog === undefined
              ? []
              : [
                  createElement(
                    "button",
                    {
                      key: "retry",
                      type: "button",
                      "data-account-models-retry": account.ref,
                      className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
                      onClick: () => props.onRetryCatalog?.(),
                    },
                    createElement(RefreshIcon, null),
                    props.t("models.retry"),
                  ),
                ]),
          ),
        ]),
    ...groups.map((group) => {
      const all = group.models.every((id) => selected.has(id));
      return createElement(
        "details",
        { key: group.key, "data-account-model-group": group.key, className: CSS_CLASS.modelGroup },
        createElement(
          "summary",
          { className: CSS_CLASS.modelGroupSummary },
          createElement("span", { className: CSS_CLASS.modelGroupTitle }, groupLabel(group.key)),
          createElement("small", null, `${group.models.filter((id) => selected.has(id)).length}/${group.models.length}`),
          createElement(
            "button",
            {
              type: "button",
              "data-account-model-group-toggle": group.key,
              className: CSS_CLASS.buttonGhost,
              onClick: (event?: { stopPropagation?: () => void; preventDefault?: () => void }) => {
                event?.preventDefault?.();
                event?.stopPropagation?.();
                const next = new Set(selected);
                for (const id of group.models) {
                  if (all) next.delete(id);
                  else next.add(id);
                }
                props.onSetAccountModels?.(account.ref, [...next]);
              },
            },
            all ? props.t("models.clearAll") : props.t("models.selectAll"),
          ),
          createElement(ChevronIcon, null),
        ),
        ...group.models.map((id) => {
          const model = byId.get(id);
          // 这个模型在当前套餐下能用多少额度（官方表里查不到就是 undefined）。
          const quotaText = props.modelQuotaOf?.(account, id);
          return createElement(
            "label",
            { key: id, className: CSS_CLASS.field },
            createElement(
              "span",
              { className: CSS_CLASS.fieldText },
              createElement("span", { className: CSS_CLASS.mono }, model?.name ?? id),
            ),
            // 额度信息摆在开关**左边**（用户 2026-10-21 指定：
            // `[模型名] ...... [额度信息] [开关]`）。
            //
            // **查不到时写「未知」而不是留空**（用户 2026-10-21 要求）：留空看起来像
            // 功能坏了，而「未知」明确表达「官方没给这个数据」，与「额度缺失不倒成 0」
            // 是同一条纪律 —— 只是把沉默换成了说明。
            createElement(
              "span",
              {
                key: "quota",
                className:
                  quotaText === undefined
                    ? `${CSS_CLASS.modelQuota} ${CSS_CLASS.modelQuotaUnknown}`
                    : CSS_CLASS.modelQuota,
                "data-model-quota": `${account.ref}:${id}`,
                title: props.t("models.quotaHint"),
              },
              quotaText ?? props.t("models.quotaUnknown"),
            ),
            createElement("input", {
              type: "checkbox",
              className: CSS_CLASS.toggle,
              "data-account-model": `${account.ref}:${id}`,
              checked: selected.has(id),
              onChange: (event: { target?: { checked?: boolean } }) => {
                const next = new Set(selected);
                if (event.target?.checked === true) next.add(id);
                else next.delete(id);
                props.onSetAccountModels?.(account.ref, [...next]);
              },
            }),
          );
        }),
      );
    }),
  );
}

/** 该厂商的能力声明；状态还没到时按「什么都没有」处理（不渲染任何高级控件）。 */
function capabilitiesOf(props: AccountCardProps): VendorCapabilities {
  return (
    props.status?.capabilities ?? {
      reorder: false,
      pin: false,
      browserLogin: false,
      modelAccountRules: false,
      quotaShape: "windows",
      modelVisibilityWrite: "onSave",
      automaticSwitch: false,
    }
  );
}

/** 该行是否正在做某个账户操作。 */
function actionOf(props: AccountCardProps, kind: AccountAction["kind"], ref: string): boolean {
  return props.action?.kind === kind && props.action.ref === ref;
}

/**
 * `⋯` 菜单：把行内动作收进一个原生 `<details>`。
 *
 * 为什么是 `<details>`：它自带开合、键盘可达与「点外部不自动关」之外的一切语义，不需要
 * 状态（卡片是纯函数）。点菜单项后由面板的冒泡处理器关闭自己。
 */
function accountMenu(props: AccountCardProps, account: AccountUsageStatus, index: number): ReactNode {
  const label = props.t("account.menu");
  const extras = props.rowExtras?.(account, index);
  return createElement(
    "details",
    { key: "menu", className: CSS_CLASS.menu, "data-account-menu": account.ref },
    createElement(
      "summary",
      { className: CSS_CLASS.icon, "aria-label": label, title: label, role: "button" },
      createElement(MoreIcon, null),
    ),
    createElement(
      "div",
      { className: CSS_CLASS.menuPanel, onClick: closeMenu },
      ...menuButtons(props, account),
      extras === undefined || extras === null ? null : extras,
      ...(capabilitiesOf(props).reorder && props.onMove !== undefined
        ? [
            createElement(
              Fragment,
              { key: "move" },
              moveItems(
                { t: props.t, onMove: props.onMove },
                account,
                index,
                Math.max(props.status?.accounts?.length ?? 0, index + 1),
              ),
            ),
          ]
        : []),
    ),
  );
}

/** 点了菜单里的任何东西就把菜单收起来（原生 details 不会自己关）。 */
function closeMenu(event: { currentTarget?: { closest?: (selector: string) => { open: boolean } | null } }): void {
  const details = event.currentTarget?.closest?.("details");
  if (details !== null && details !== undefined) details.open = false;
}

/**
 * 菜单项：重命名 / 更换密钥 / 固定 / 移除 —— 全部按能力降级。
 *
 * 「移除」是红字（宿主的 dangerButton 同款），悬停才浮出危险底色 —— 破坏性动作平时安静、
 * 指到时才醒目。
 */
function menuButtons(props: AccountCardProps, account: AccountUsageStatus): ReactNode[] {
  const { t } = props;
  /**
   * 可恢复的默认名称（2026-10-22 用户要求）。
   *
   * `undefined` 时**不显示**这个菜单项：没有记录默认名的老账号、默认名是空白、
   * 或当前名已等于默认名 —— 三种情况都没有「可恢复」的东西（见 `restoreDefaultLabelOf`）。
   */
  const restorable = restoreDefaultLabelOf(account);
  const buttons: ReactNode[] = [
    createElement(
      "button",
      { key: "rename", type: "button", "data-action": "rename", className: CSS_CLASS.item, onClick: () => props.onOpenAction({ kind: "rename", ref: account.ref }) },
      t("account.rename"),
    ),
    ...(restorable === undefined
      ? []
      : [
          createElement(
            "button",
            {
              key: "restoreName",
              type: "button",
              "data-action": "restoreName",
              className: CSS_CLASS.item,
              /**
               * **一键恢复**（2026-10-22 改）：不打开表单、不需要再确认一次。
               *
               * 恢复默认名是确定且可逆的操作（默认名就存在账号条目里），多一步确认只是
               * 麻烦。真正的写入由宿主按账号自己记录的 `defaultName` 完成 —— 客户端
               * 只负责说「点的是哪个账号」。
               */
              onClick: () => props.onOpenAction({ kind: "restoreName", ref: account.ref }),
            },
            t("account.restoreName"),
          ),
        ]),
    createElement(
      "button",
      { key: "key", type: "button", "data-action": "replaceKey", className: CSS_CLASS.item, onClick: () => props.onOpenAction({ kind: "key", ref: account.ref }) },
      t("account.replaceKey"),
    ),
  ];
  // 「使用此账户」已移除（2026-10-19）：切换账号改到全局切换面板的顺序列表。
  buttons.push(
    createElement(
      "button",
      { key: "remove", type: "button", "data-action": "remove", className: cls(CSS_CLASS.item, CSS_CLASS.buttonDanger), onClick: () => props.onRemove(account.ref) },
      t("account.remove"),
    ),
  );
  return buttons;
}

/**
 * 额度表：**每个存在的窗口一小块**（标签 + 读数 + 进度条）。
 *
 * 数字只在读数里真的有那个字段时才渲染 —— `used`/`cap` 缺任何一个都不拼 `x/y`，
 * `percent` 缺失也不补 0。全都缺就显示「暂无额度数据」。
 */
function quotaBars(props: AccountCardProps, windows: readonly QuotaWindow[]): ReactNode[] {
  return [
    createElement(
      "div",
      { key: "bars", className: CSS_CLASS.quotaBarList },
      ...windows.map((window) =>
        createElement(
          "div",
          { key: window.key, "data-quota-window": window.key },
          QuotaBar({ t: props.t, window }),
        ),
      ),
    ),
  ];
}

/** 一个输入框上的回车 = 点「确定」：账号操作是单行表单，回车提交是用户的默认预期。 */
function enterConfirms(props: AccountCardProps): (event: { key?: string; preventDefault?: () => void }) => void {
  return (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault?.();
    props.onConfirmAction();
  };
}

/** 编辑器/表单里的失败提示（容器给的人话）；没有就不画。 */
function actionErrorLine(props: AccountCardProps): ReactNode[] {
  const error = props.actionError;
  if (error === undefined || error === "") return [];
  return [createElement("small", { key: "action-error", "data-action-error": "true", className: CSS_CLASS.failure }, error)];
}

/** 重命名编辑器（受控）。 */
function renameEditor(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  const label = props.action?.label ?? "";
  return createElement(
    "div",
    { "data-editor": "rename", "data-editor-ref": account.ref, className: cls(CSS_CLASS.inline, CSS_CLASS.inset) },
    createElement("input", {
      "data-rename-input": account.ref,
      type: "text",
      value: label,
      autoFocus: true,
      placeholder: props.t("account.newLabel"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("label", event.target?.value ?? ""),
      onKeyDown: enterConfirms(props),
    }),
    createElement("button", { type: "button", "data-action": "confirmRename", className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm), onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm), onClick: () => props.onCancelAction() }, props.t("account.cancel")),
    ...actionErrorLine(props),
  );
}

/**
 * 更换密钥编辑器（受控）。
 *
 * 输入框刻意**不带** `data-field`：那是设置字段的标记，带上它就会和设置草稿/保存条共用一条通道。
 * 密钥只经 `onActionField`/`onConfirmAction` 走到账户操作，再由宿主写进凭据服务。
 */
function keyEditor(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  return createElement(
    "div",
    { "data-editor": "key", "data-editor-ref": account.ref, className: cls(CSS_CLASS.inline, CSS_CLASS.inset) },
    createElement("input", {
      "data-key-input": account.ref,
      type: "password",
      value: props.action?.key ?? "",
      autoFocus: true,
      placeholder: props.t("account.newKey"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("key", event.target?.value ?? ""),
      onKeyDown: enterConfirms(props),
    }),
    createElement("button", { type: "button", "data-action": "confirmKey", className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm), onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm), onClick: () => props.onCancelAction() }, props.t("account.cancel")),
    ...actionErrorLine(props),
  );
}

/**
 * 服务端失败项提示。
 *
 * 诊断原文（端点短名 `whoami`、包装过的 `quota: … read failed (…)`）翻成人话再上屏，
 * 原文一律留在 `data-failure-detail` 上供排查；认不出的形状（宿主能力错误）原样显示。
 */
function failureNotes(props: AccountCardProps): ReactNode[] {
  return (props.status?.failures ?? []).map((failure, index) =>
    createElement(
      "p",
      { key: `failure-${index}`, "data-failure": index, "data-failure-detail": failure, className: CSS_CLASS.failure },
      failureText(props.t, failure),
    ),
  );
}

/** 网页登录入口：只有声明了 `browserLogin` 的厂商才有。 */
function loginSection(props: AccountCardProps): ReactNode[] {
  const { t, login } = props;
  if (!capabilitiesOf(props).browserLogin) return [];
  // 入口是行内动作（左对齐的普通按钮），不单独套一层通栏面板；等待中的说明才用内嵌面板，
  // 因为那里有授权网址要占一整行。
  const button = createElement(
    "button",
    { key: "login", type: "button", "data-action": "login", className: CSS_CLASS.buttonSecondary, onClick: () => props.onLoginBegin() },
    createElement(ExternalIcon, null),
    t("account.login"),
  );
  const detail: ReactNode[] = [];
  if (login?.state === "waiting") {
    detail.push(createElement("p", { key: "waiting" }, t("account.loginWaiting")));
    if (login.userCode !== undefined) {
      detail.push(
        createElement(
          "p",
          { key: "code", "data-login-code": login.userCode, className: CSS_CLASS.mono },
          t("account.loginCode").replace("{code}", login.userCode),
        ),
      );
    }
    if (login.authUrl !== undefined) {
      detail.push(
        createElement(
          "a",
          {
            key: "url",
            "data-login-url": "true",
            className: CSS_CLASS.link,
            // 授权网址来自厂商：只放行 http(s)。`javascript:` / `data:` 在 Electron 里
            // 等于执行任意脚本（与 accounts-panel 的同一条闸门）。
            ...(isHttpUrl(login.authUrl) ? { href: login.authUrl } : {}),
            target: "_blank",
            rel: "noreferrer",
          },
          login.authUrl,
        ),
      );
    }
  }
  if (login?.state === "failed") {
    detail.push(
      createElement("p", { key: "reason", "data-login-reason": login.reason ?? "error", className: CSS_CLASS.failure }, reasonText(t, login.reason)),
    );
    // 诊断原文：一句「等待授权超时」背后有四种病因，只有 vela 的真实输出能区分它们。
    // 界面上**照原样显示**（不再加包装文案）：这句话本身就是给用户/开发者看的线索。
    if (login.detail !== undefined && login.detail !== "") {
      detail.push(
        createElement(
          "pre",
          { key: "detail", "data-login-detail": login.detail, className: CSS_CLASS.diagnostic },
          login.detail,
        ),
      );
    }
    // 缺环境是**唯一**一种用户自己就能修好的失败：给出可执行的安装步骤，而不是一句
    // 「请先安装」（用户 2026-10-20：「用户缺少环境的时候给出提示，如何快速安装环境」）。
    const guide = velaInstallGuide(t, login.reason, props.onLoginBegin === undefined ? undefined : () => props.onLoginBegin());
    if (guide !== null) detail.push(guide);
  }
  return [
    createElement("div", { key: "login-row", "data-login-panel": login?.state ?? "idle", className: CSS_CLASS.actions }, button),
    ...(detail.length === 0 ? [] : [createElement("div", { key: "login-detail", className: CSS_CLASS.inset }, ...detail)]),
  ];
}

/**
 * 失败原因文案：认识的原因用专门文案，不认识的回退到通用文案（**不打印原因键**）。
 *
 * 导出给合并面板复用：账号行与面板级的登录失败提示必须用同一套口径，否则同一句原因
 * 在两个位置会显示成两种说法。
 */
export function reasonText(t: (key: string) => string, reason: string | undefined): string {
  const key = `account.reason.${reason ?? "error"}`;
  if (reason === undefined) return t("account.reason.error");
  const text = t(key);
  return text === key ? t("account.reason.error") : text;
}

/**
 * `vela` 缺失时的**安装指引**块（只对这一种原因渲染，其余失败保持一句话）。
 *
 * 用户 2026-10-20：「opendesign 新增账户的时候如果使用网页登录，用户缺少环境的时候给出提示，
 * 如何快速安装环境」。为什么值得单独做一块：
 *
 * - 这是**唯一**一种用户自己就能修好的登录失败（其余是网络/未批准/凭据问题，用户改不了）；
 * - 「请先安装 vela」对普通用户等于没说 —— 他们不知道 vela 是什么、从哪来、装完怎么确认。
 *   所以给三档可执行路径（装桌面端最省事 / 只装 CLI / 设 VELA_BIN），命令单独一行便于复制。
 *
 * @param t - 取词函数。
 * @param reason - 登录失败原因键。
 * @param onRetry - 「重试网页登录」的回调；缺省时不渲染那个按钮。
 * @returns 指引块；原因不是 `vela-missing` 时为 `null`。
 */
export function velaInstallGuide(
  t: (key: string) => string,
  reason: string | undefined,
  onRetry?: () => void,
): ReactElement | null {
  if (reason !== "vela-missing") return null;
  return createElement(
    "div",
    { key: "vela-guide", "data-vela-guide": "true", className: CSS_CLASS.inset },
    createElement("strong", { className: CSS_CLASS.velaGuideTitle }, t("account.vela.title")),
    createElement("small", null, t("account.vela.step1")),
    createElement("small", null, t("account.vela.step2")),
    // 命令单独一块等宽块：整行可选中复制，比夹在一段话里更好用。
    createElement("code", { "data-vela-command": "true", className: CSS_CLASS.mono }, t("account.vela.command")),
    createElement("small", null, t("account.vela.step3")),
    onRetry === undefined
      ? null
      : createElement(
          "button",
          {
            type: "button",
            "data-vela-retry": "true",
            className: cls(CSS_CLASS.buttonSecondary, CSS_CLASS.buttonSm),
            onClick: onRetry,
          },
          t("account.vela.retry"),
        ),
  );
}

/**
 * 底部「添加账户」：**收起的入口 → 展开的表单**。
 *
 * 为什么必须是收起的：先前两个输入框一直摊在卡片底部，按钮直接叫「添加账户」。用户点它时
 * 字段是空的，`dispatchAccountAction` 按规矩不发调用（空名称/空密钥不提交），于是**这一次
 * 点击没有任何可见反应**——按钮像是坏的。空提交不发调用这条是对的（那能防住误写一个空账号），
 * 错的是让「入口」和「提交」共用一个按钮：点击没有反应，用户无从判断是坏了还是自己没填。
 *
 * 现在点入口必然展开表单（可见的变化），提交是表单里那个独立的「添加」。表单内仍保留
 * 「第一次输入即打开 add」的幂等接线（`openAction` 对同一 kind 返回原对象），这样即便宿主
 * 或未来调用方绕过入口直接改字段，操作状态也已经是打开的。
 *
 * 2026-10-18 用户要求「新增账号那个地方优化一下操作逻辑」，这一版补了五件事：
 * ① 表单顶上写明**在往哪家加账户**（面板底部只有一个表单位置，两家共用）；
 * ② 名称框自动聚焦（点开就能打字）；③ 回车 = 确定（单行表单的默认预期）；
 * ④ 空名称点确定会看到一行人话原因（`actionError`），不再是死按钮；
 * ⑤ 密钥框下方写明它去哪（本机凭据库），并说明网页登录是另一条路。
 */
function addSection(props: AccountCardProps): ReactNode {
  const { t, action } = props;
  const adding = action?.kind === "add";

  if (!adding) {
    return createElement(
      "div",
      { "data-card": "add-account", className: CSS_CLASS.add },
      createElement(
        "button",
        { key: "add", type: "button", "data-action": "add", className: CSS_CLASS.addTrigger, onClick: () => props.onOpenAction({ kind: "add" }) },
        t("account.add"),
      ),
    );
  }

  const edit = (field: "label" | "key", value: string): void => props.onActionField(field, value);
  const vendor = props.vendorLabel;
  return createElement(
    "div",
    { "data-card": "add-account", className: cls(CSS_CLASS.add, CSS_CLASS.inset) },
    ...(vendor === undefined
      ? []
      : [
          createElement(
            "p",
            { key: "title", "data-add-title": vendor, className: CSS_CLASS.addTitle },
            t("account.addTitle").replace("{vendor}", vendor),
          ),
        ]),
    createElement(
      "label",
      { className: CSS_CLASS.addField },
      createElement("small", null, t("account.newLabel")),
      createElement("input", {
        "data-add-label": "true",
        type: "text",
        value: action?.label ?? "",
        autoFocus: true,
        placeholder: t("account.newLabel.placeholder"),
        onChange: (event: { target?: { value?: string } }) => edit("label", event.target?.value ?? ""),
        onKeyDown: enterConfirms(props),
      }),
    ),
    createElement(
      "label",
      { className: CSS_CLASS.addField },
      createElement("small", null, t("account.newKey")),
      createElement("input", {
        "data-add-key": "true",
        type: "password",
        value: action?.key ?? "",
        placeholder: t("account.newKey.placeholder"),
        onChange: (event: { target?: { value?: string } }) => edit("key", event.target?.value ?? ""),
        onKeyDown: enterConfirms(props),
      }),
    ),
    createElement("small", { key: "key-hint", className: CSS_CLASS.note }, t("account.newKey.hint")),
    ...actionErrorLine(props),
    createElement(
      "div",
      { className: CSS_CLASS.actions },
      createElement("button", { key: "ok", type: "button", "data-action": "confirmAdd", className: CSS_CLASS.buttonPrimary, onClick: () => props.onConfirmAction() }, t("account.confirm")),
      createElement("button", { key: "cancel", type: "button", "data-action": "cancel", className: CSS_CLASS.buttonGhost, onClick: () => props.onCancelAction() }, t("account.cancel")),
    ),
  );
}

/**
 * 排序控件（供 `opencode-account-card.ts` 通过 {@link AccountCardProps.rowExtras} 注入）。
 *
 * 导出在这里而不是让厂商卡片自己画：菜单项的类与形状只有一份（`dsl-item`），
 * 由行渲染决定它们长什么样，厂商卡片只提供「上移/下移」两个语义。
 * @param props - 渲染所需的文案与回调。
 * @param account - 目标账号。
 * @param index - 当前下标。
 * @param count - 账号总数（判断越界）。
 * @returns 两个菜单项；越界的一侧禁用。
 */
export function moveItems(
  props: { t: (key: string) => string; onMove: (ref: string, toIndex: number) => void },
  account: AccountUsageStatus,
  index: number,
  count: number,
): ReactNode {
  const move = (direction: "up" | "down"): ReactNode => {
    const disabled = direction === "up" ? index === 0 : index === count - 1;
    const label = direction === "up" ? props.t("account.moveUp") : props.t("account.moveDown");
    return createElement(
      "button",
      {
        key: direction,
        type: "button",
        "data-move": direction,
        "data-move-ref": account.ref,
        disabled,
        "aria-label": label,
        className: CSS_CLASS.item,
        onClick: () => props.onMove(account.ref, direction === "up" ? index - 1 : index + 1),
      },
      createElement(MoveIcon, { direction }),
      label,
    );
  };
  return createElement(Fragment, null, move("up"), move("down"));
}
