/**
 * 合并账户面板：各厂商的账号**平铺**在同一张卡片里，账号名后跟供应商标签。
 *
 * 为什么平铺（2026-10-18 用户要求）：账号是「这台机器上有哪些额度」，按厂商分组会让同一个
 * 列表出现多个标题、多个添加入口；用户想直接看到所有账号，再决定用哪家的。
 *
 * 添加/网页登录是**全局入口**：先选供应商（Command Code / OpenCode），再选手动或网页登录；
 * 账户动作仍按厂商路由（`onOpenAction(vendor, …)` 等），面板自己不持有状态。
 * @module dsh-llm-account/src/client/accounts-panel
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { accountAddSection, accountRows, reasonText, velaInstallGuide, type AccountCardProps, type LoginView } from "./account-card";
import { CSS_CLASS } from "./css";
import { UsageClearButton, UsageExportButton } from "./failure-list";
import { isHttpUrl } from "./login-window";
import type { AccountAction } from "./page-state";
import type { VendorEntry } from "./registry";
import type { AccountUsageStatus } from "./usage-contract";
import type { CatalogModel, ModelRule, VendorUsageStatus } from "./usage-contract";

/** 面板里的一个厂商。 */
export interface AccountsPanelVendor {
  /** 厂商声明（取标签文案）。 */
  entry: VendorEntry;
  /** 该厂商的状态；远程面还没挂上时为 `undefined`。 */
  status?: VendorUsageStatus;
  /** 状态读不出来的原因。 */
  problem?: string;
  /** 属于这家的账户操作（面板已按厂商过滤）。 */
  action?: AccountAction;
  /** 属于这家的展开项（面板已按厂商过滤）。 */
  expandedRef?: string;
  /** 这家的网页登录状态。 */
  login?: LoginView;
  /** 这家的模型目录（每个账号的模型选择用）。 */
  catalog?: readonly CatalogModel[];
  /** 这家的模型目录读取失败原因（宿主原文）；读取正常或缺省。 */
  catalogFailure?: string;
  /** 这家的模型目录正在读取。 */
  catalogLoading?: boolean;
  /** 这家的模型→账号规则。 */
  modelRules?: readonly ModelRule[];
  /** 首次读取尚未完成（用于区分「加载中」和「读失败」）。 */
  loading?: boolean;
}

/** 合并账户面板属性。 */
export interface AccountsPanelProps {
  t: (key: string) => string;
  vendors: readonly AccountsPanelVendor[];
  /** 打开一个账户操作；`vendor` 是动作要路由到的厂商。 */
  onOpenAction: (vendor: string, action: { kind: AccountAction["kind"]; ref?: string }) => void;
  onActionField: (field: "label" | "key", value: string) => void;
  /** 提交当前操作（动作里已带厂商）。 */
  onConfirmAction: (vendor: string) => void;
  onCancelAction: () => void;
  onSelect: (vendor: string, ref: string | null) => void;
  onRemove: (vendor: string, ref: string) => void;
  onMove?: (vendor: string, ref: string, toIndex: number) => void;
  onToggleExpand: (vendor: string, ref: string) => void;
  onLoginBegin: (vendor: string) => void;
  /**
   * 取消某一家等待中的登录。等待面板必须能关掉 —— 用户不授权（或浏览器没弹出来）时，
   * 那块面板与授权链接会一直挂在那里，没有出口就只能等过期。
   */
  onLoginCancel?: (vendor: string) => void;
  /**
   * 「添加账户」区块被**收起**时调用（用户再点一次「新增账户」）。
   *
   * 收起 = 后退一步：还开着的添加表单与等待中的网页登录都该一起收掉 —— 那两者都渲染在
   * `<details>` 外面，只折叠摘要的话它们会留在卡片上（用户报障：再点新增账户也取消不掉）。
   */
  onCollapseAddChooser?: () => void;
  /**
   * 正在启动登录的厂商（远程调用还没回来）。按钮据此禁用并显示「正在启动…」——
   * 没有这个中间态时，点击到授权网址出现之间界面毫无反馈，看起来就是「点了没反应」。
   */
  loginStarting?: Readonly<Record<string, boolean | undefined>>;
  /**
   * 启动登录失败的原因（宿主原文），按厂商。
   *
   * 与 `login.state === "failed"` 分工：后者是**登录流程**自己给出的稳定原因键
   * （`timeout` / `vela-missing` …，翻成专门文案）；这里是**调用没能发出去/抛错**的原文
   * （远程面没挂上、宿主装配故障），界面只显示通用人话，原文留在 `data-*` 上供排查。
   */
  loginError?: Readonly<Record<string, string | undefined>>;
  /**
   * 上一次「确定」没提交出去的原因（人话）；没有就是 `undefined`。
   *
   * 面板只负责把它递给**正在编辑的那一家**（动作里带着厂商），与 `action` 同一条路由。
   */
  actionError?: string | undefined;
  /** 覆盖某个账号可用的模型。 */
  onSetAccountModels?: (vendor: string, ref: string, models: readonly string[]) => void;
  /**
   * 某个账号的用量统计（渲染在它自己的额度条下方）。
   *
   * 返回 `undefined` 表示这一行不画 —— 还没读到数据时不该占一块空白。
   */
  usageOf?: (vendor: string, ref: string) => ReactNode;
  /**
   * 查一个模型在**该账号当前套餐**下能用多少额度（用户 2026-10-21 要的功能）。
   *
   * 返回 `undefined` = 官方没给这个组合的数据，界面留空（不编数字）。格式化由容器做。
   * @param vendor - 厂商行 id。
   * @param account - 该账号（额度与它当前的套餐有关）。
   * @param modelId - 模型 id（目录原始写法）。
   * @returns 已格式化的额度文字；没有数据时 `undefined`。
   */
  modelQuotaOf?: (vendor: string, account: AccountUsageStatus, modelId: string) => string | undefined;
  /**
   * 重新读取**一家**的模型目录（按账户刷新的落点）。
   *
   * 2026-10-18 用户要求：「重新获取模型不是刷新所有的，应该是刷新单个账户的」—— 入口从
   * 面板头部的全局按钮改成**每个账号行自己的刷新按钮**（见 `account-card.ts` 的行内动作），
   * 目录是厂商级资源，所以回调带厂商而不带账号：点任一账号刷的都是它所属那一家的目录，
   * 惠及该厂商的所有账号，但不碰别家。**不传 = 那些按钮不渲染**（旧调用方/纯测试不受影响）。
   */
  onRefreshModels?: (vendor: string) => void;
  /**
   * 导出用量台账（CSV）。
   *
   * 缺省表示当前宿主没有这个能力 —— 那就整个按钮不渲染，而不是留一个点了没反应的入口。
   * 回调返回 promise：导出要读台账并拼整段文本，按钮据此显示「导出中」并禁用。
   */
  onExportUsage?: (() => Promise<void>) | undefined;
  /** 导出进行中（按钮禁用 + 换文案）。 */
  exportBusy?: boolean;
  /** 上一次导出的失败原因（人话）；成功或还没导过时缺省。 */
  exportError?: string | undefined;
  /**
   * 清空用量台账（不可撤销；面板负责二次确认）。
   *
   * 缺省表示当前宿主没有这个能力 —— 整个按钮不渲染，而不是留一个点了没反应的入口。
   */
  onClearUsage?: (() => void) | undefined;
  /** 清空进行中。 */
  clearBusy?: boolean;
  /** 是否已展开二次确认。 */
  clearConfirming?: boolean;
  /** 请求展开确认 / 收起确认。 */
  onRequestClearConfirm?: (() => void) | undefined;
  onCancelClear?: (() => void) | undefined;
  /** 上一次清空的失败原因。 */
  clearError?: string | undefined;
}

/**
 * 合并账户面板。
 * @param props - 见 {@link AccountsPanelProps}。
 * @returns 元素树。
 */
export function AccountsPanel(props: AccountsPanelProps): ReactElement {
  const { t, vendors } = props;
  const total = vendors.reduce(
    (count, group) =>
      count + (group.status?.accounts ?? []).filter((account) => typeof account === "object" && account !== null).length,
    0,
  );
  const addVendor = vendors.find((group) => group.action?.kind === "add");
  const addProps = addVendor === undefined ? undefined : accountPropsFor(props, addVendor);  // 只要还有一家在首次读取中，就不说「还没有添加任何账户」——那句话描述的是读完之后
  // 的事实；加载中就说「正在读取」，两句话同时出现是自相矛盾（本机实测见过）。
  const anyLoading = vendors.some((group) => group.loading === true);

  return createElement(
    "section",
    { "data-card": "accounts-panel", className: CSS_CLASS.card },
    // 面板头部：标题 + 账号数。模型刷新的入口在**每个账号行**上（按账户刷新，2026-10-18），
    // 不再放全局按钮 ——「刷新所有的」正是用户明确说不要的。
    createElement(
      "div",
      { "data-panel-head": "accounts", className: CSS_CLASS.panelHead },
      createElement("h2", null, t("group.accounts")),
      createElement("span", { "data-accounts-count": total, className: CSS_CLASS.panelCount }, t("account.count").replace("{n}", String(total))),
      // 导出整本台账：与「账号数」并排，因为它是**全局**动作（台账是本机共享的一本账，
      // 不按厂商/账号拆）。能力缺席时 `UsageExportButton` 自己返回 null。
      createElement(UsageExportButton, {
        t,
        onExport: props.onExportUsage === undefined ? undefined : () => void props.onExportUsage?.(),
        busy: props.exportBusy === true,
      }),
      // 清空：紧跟导出（同一组「整本台账」操作）。同样自带二次确认与能力门控。
      createElement(UsageClearButton, {
        t,
        onClear: props.onClearUsage,
        ...(props.onRequestClearConfirm === undefined ? {} : { onRequestConfirm: props.onRequestClearConfirm }),
        ...(props.onCancelClear === undefined ? {} : { onCancel: props.onCancelClear }),
        ...(props.clearConfirming === undefined ? {} : { confirming: props.clearConfirming }),
        ...(props.clearBusy === undefined ? {} : { busy: props.clearBusy }),
      }),
    ),
    // 导出失败要说一句：静默失败会让人以为导出成功、而文件内容还是旧的。
    props.exportError === undefined
      ? null
      : createElement(
          "small",
          {
            key: "export-error",
            "data-usage-export-error": true,
            "data-usage-export-error-detail": props.exportError,
            className: CSS_CLASS.failure,
          },
          `${t("usage.exportFailed")}：${props.exportError}`,
        ),
    // 清空失败同样要说出来：静默失败会让人以为清掉了，而实际什么都没变。
    props.clearError === undefined
      ? null
      : createElement(
          "small",
          {
            key: "clear-error",
            "data-usage-clear-error": true,
            "data-usage-clear-error-detail": props.clearError,
            className: CSS_CLASS.failure,
          },
          `${t("usage.clearFailed")}：${props.clearError}`,
        ),
    createElement(
      "details",
      {
        "data-add-chooser": "true",
        className: CSS_CLASS.addChooser,
        // 收起「新增账户」= 后退一步（再点一次摘要就取消）：添加表单与等待中的登录
        // 都渲染在这个 `<details>` 外面，只折叠摘要的话它们会留在卡片上。
        onToggle: (event: { currentTarget?: { open?: boolean } }) => {
          if (event?.currentTarget?.open !== false) return;
          props.onCollapseAddChooser?.();
        },
      },
      createElement("summary", { className: CSS_CLASS.addSummary }, t("account.addAccount")),
      createElement("small", { className: CSS_CLASS.note }, t("account.addAccount.hint")),
      // 每家只有一个入口：**网页登录**（2026-10-20 用户要求）。
      //
      // 为什么去掉「新增账号（填 API key）」：用户原话「API 登录基本没什么用处，毕竟官方入口
      // 也留了 API 添加」。核对下来对 Open Design 尤其成立 —— 纯 API key 账号拿不到套餐、
      // workspaceId 与周期额度（账单只走 vela 控制面，而控制面凭据只有网页登录产物产出）。
      //
      // 底层的 `addAccount` 能力**没有删**：官方入口与命令行仍在用，以后想加回来不必重写；
      // 已用 API key 建好的账号也还能「更换密钥」（那类账号唯一的维修路径）。
      // 按厂商分组只是为了让用户知道「这一家的登录是这一家」，不是可选填 API key。
      createElement(
        "div",
        { "data-account-add-actions": "true", className: CSS_CLASS.addGroup },
        ...vendors.map((group) =>
          createElement(
            "div",
            { key: group.entry.providerId, "data-add-vendor-group": group.entry.providerId, className: CSS_CLASS.addGroup },
            createElement("small", { className: CSS_CLASS.note }, t(group.entry.labelKey)),
            createElement(
              "div",
              { className: CSS_CLASS.actions },
              createElement(
                "button",
                {
                  key: `${group.entry.providerId}-login`,
                  type: "button",
                  "data-action": group.entry.providerId === "commandcode" ? "login" : `login-${group.entry.providerId}`,
                  "data-login-for": group.entry.providerId,
                  className: CSS_CLASS.buttonSecondary,
                  // 启动中禁用：重复点击会在宿主侧开第二次尝试（把上一次顶掉），
                  // 而界面看起来仍然是「没反应」。
                  ...(props.loginStarting?.[group.entry.providerId] === true ? { disabled: true, "aria-busy": "true" } : {}),
                  onClick: () => props.onLoginBegin(group.entry.providerId),
                },
                t("account.loginFor"),
              ),
            ),
            // 启动中 / 启动失败都必须在**点击的位置附近**说清楚。
            ...loginNotes(props, group.entry.providerId),
          ),
        ),
      ),
    ),
    ...waitingLogins(props),
    // 某一家读不到状态时把原因放在它自己的小标题下，不要和「没有账号」混在一起。
    ...vendors.flatMap((group) =>
      group.status !== undefined
        ? []
        : group.loading === true
          ? [
              createElement(
                "p",
                { key: `${group.entry.providerId}-loading`, "data-accounts-loading": group.entry.providerId, className: CSS_CLASS.note },
                `${t(group.entry.labelKey)}: ${t("account.loading")}`,
              ),
            ]
          : [
              createElement(
                "p",
                { key: `${group.entry.providerId}-unavailable`, "data-accounts-vendor": group.entry.providerId, className: CSS_CLASS.note },
                `${t(group.entry.labelKey)}: ${t("account.unavailable")}`,
              ),
              ...(group.problem === undefined
                ? []
                : [
                    createElement(
                      "pre",
                      { key: `${group.entry.providerId}-problem`, "data-usage-problem": true, className: CSS_CLASS.diagnostic },
                      group.problem,
                    ),
                  ]),
            ],
    ),
    ...(total === 0 && !anyLoading
      ? [createElement("p", { key: "empty", "data-accounts-empty": "true", className: CSS_CLASS.note }, t("account.empty"))]
      : []),
    createElement(
      "div",
      { "data-account-list": "true", className: CSS_CLASS.accountList },
      ...vendors.flatMap((group) => accountRows(accountPropsFor(props, group))),
    ),
    addProps === undefined
      ? null
      : createElement(
          "div",
          { key: "add-form", "data-add-panel": addVendor!.entry.providerId, className: CSS_CLASS.inset },
          accountAddSection(addProps),
        ),
  );
}

/** 某一家等待授权的登录面板（设备码 / 授权网址 / 取消）。 */
function waitingLogins(props: AccountsPanelProps): ReactElement[] {
  return props.vendors.flatMap((group) => {
    const login = group.login;
    if (login?.state !== "waiting") return [];
    return [
      createElement(
        "div",
        { key: `login-${group.entry.providerId}`, "data-login-panel": group.entry.providerId, className: CSS_CLASS.inset },
        createElement("p", null, `${props.t(group.entry.labelKey)} · ${props.t("account.loginWaiting")}`),
        ...(login.userCode === undefined
          ? []
          : [
              createElement(
                "p",
                { key: "code", "data-login-code": login.userCode, className: CSS_CLASS.mono },
                props.t("account.loginCode").replace("{code}", login.userCode),
              ),
            ]),
        ...(login.authUrl === undefined
          ? []
          : [
              createElement(
                "a",
                {
                  key: "url",
                  "data-login-url": true,
                  ...(isHttpUrl(login.authUrl) ? { href: login.authUrl } : {}),
                  target: "_blank",
                  rel: "noreferrer",
                  className: CSS_CLASS.link,
                },
                login.authUrl,
              ),
            ]),
        // 取消：不给出口时这块面板只能等过期才消失（用户不授权就等于「链接永远在」）。
        ...(props.onLoginCancel === undefined
          ? []
          : [
              createElement(
                "div",
                { key: "cancel", className: CSS_CLASS.actions },
                createElement(
                  "button",
                  {
                    type: "button",
                    "data-action": "login-cancel",
                    "data-login-for": group.entry.providerId,
                    className: CSS_CLASS.buttonSecondary,
                    onClick: () => props.onLoginCancel?.(group.entry.providerId),
                  },
                  props.t("account.loginCancel"),
                ),
              ),
            ]),
      ),
    ];
  });
}

/**
 * 某一家在「添加账户」组下面的登录提示：启动中 / 流程失败 / 调用失败。
 *
 * 三态分开是有原因的：以前只有 `waiting` 有界面，`failed` 与「调用根本没发出去」都
 * 静默 —— 用户点了「网页登录」只看到什么都没发生（这正是本机报障的现象）。
 * @param props - 面板属性。
 * @param vendor - 厂商 id。
 * @returns 要渲染的提示（可能为空）。
 */
function loginNotes(props: AccountsPanelProps, vendor: string): ReactNode[] {
  const notes: ReactNode[] = [];
  if (props.loginStarting?.[vendor] === true) {
    notes.push(
      createElement("small", { key: `${vendor}-login-starting`, "data-login-starting": vendor, className: CSS_CLASS.note }, props.t("account.loginStarting")),
    );
  }
  const login = props.vendors.find((group) => group.entry.providerId === vendor)?.login;
  // `cancelled` 是用户自己按的取消：不是失败，不该报错。
  // 流程自己给的原因已经是一句完整的人话（「等待授权超时。」），不再加前缀 —— 加「没能启动」
  // 与「超时/未批准」这些「其实启动了但没成」的原因自相矛盾。
  if (login?.state === "failed" && login.reason !== "cancelled") {
    notes.push(
      createElement(
        "small",
        {
          key: `${vendor}-login-failure`,
          "data-login-failure": vendor,
          "data-login-failure-detail": login.reason ?? "error",
          className: CSS_CLASS.failure,
        },
        reasonText(props.t, login.reason),
      ),
    );
    // 诊断原文（`vela` 的实际输出）：只有它能区分「命令没启动 / 崩了 / 没有任何输出」。
    // 挂在**这里**（`loginNotes`）而不是 `AccountCard` 的 `loginSection` —— 账户面板走的是
    // `accountRows` + 本函数这条路，`AccountCard` 整组件不参与渲染（本轮实测踩过一次）。
    if (login.detail !== undefined && login.detail !== "") {
      notes.push(
        createElement(
          "pre",
          { key: `${vendor}-login-detail`, "data-login-detail": login.detail, className: CSS_CLASS.diagnostic },
          login.detail,
        ),
      );
    }
    // 缺 vela 是**唯一**一种用户能自己修好的登录失败：给出可执行的安装步骤。
    //
    // 必须挂在这里（`loginNotes`）而不是 `AccountCard` 的 `loginSection`：账户面板走的是
    // `accountRows` + 本函数这条路，`AccountCard` 整组件并不参与渲染 —— 挂错了地方，
    // 代码能通过全部单测，但用户永远看不到（本轮实测踩到）。
    const guide = velaInstallGuide(props.t, login.reason, () => props.onLoginBegin?.(vendor));
    if (guide !== null) notes.push(guide);
  }
  const error = props.loginError?.[vendor];
  if (error !== undefined) {
    notes.push(
      createElement(
        "small",
        { key: `${vendor}-login-error`, "data-login-error": vendor, "data-login-error-detail": error, className: CSS_CLASS.failure },
        props.t("account.loginFailed"),
      ),
    );
  }
  return notes;
}

/** 把面板回调包装成该厂商的 AccountCardProps。 */
function accountPropsFor(props: AccountsPanelProps, group: AccountsPanelVendor): AccountCardProps {
  const vendor = group.entry.providerId;
  return {
    t: props.t,
    status: group.status,
    problem: group.problem,
    action: group.action,
    ...(props.actionError === undefined ? {} : { actionError: props.actionError }),
    expandedRef: group.expandedRef,
    login: group.login,
    vendorLabel: props.t(group.entry.labelKey),
    onOpenAction: (action) => props.onOpenAction(vendor, action),
    onActionField: props.onActionField,
    onConfirmAction: () => props.onConfirmAction(vendor),
    onCancelAction: props.onCancelAction,
    onSelect: (ref) => props.onSelect(vendor, ref),
    onRemove: (ref) => props.onRemove(vendor, ref),
    onToggleExpand: (ref) => props.onToggleExpand(vendor, ref),
    onLoginBegin: () => props.onLoginBegin(vendor),
    ...(group.catalog === undefined ? {} : { catalog: group.catalog }),
    ...(group.catalogFailure === undefined ? {} : { catalogFailure: group.catalogFailure }),
    ...(group.catalogLoading === undefined ? {} : { catalogLoading: group.catalogLoading }),
    // 账号行刷新 + 模型区重试是同一个动作：重读这家的目录。
    ...(props.onRefreshModels === undefined ? {} : { onRetryCatalog: () => props.onRefreshModels?.(vendor) }),
    ...(group.modelRules === undefined ? {} : { modelRules: group.modelRules }),
    ...(props.onSetAccountModels === undefined
      ? {}
      : { onSetAccountModels: (ref: string, models: readonly string[]) => props.onSetAccountModels?.(vendor, ref, models) }),
    // 该账号自身的用量（容器给）；缺省就不渲染，与其它可选块同一条纪律。
    ...(props.usageOf === undefined ? {} : { usageOf: (ref: string) => props.usageOf?.(vendor, ref) }),
    // 每个模型在当前套餐下的额度（用户 2026-10-21 要的功能）：查不到就不渲染。
    ...(props.modelQuotaOf === undefined
      ? {}
      : { modelQuotaOf: (account: AccountUsageStatus, modelId: string) => props.modelQuotaOf?.(vendor, account, modelId) }),
  };
}
