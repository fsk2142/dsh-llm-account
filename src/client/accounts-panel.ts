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

import { accountAddSection, accountRows, reasonText, type AccountCardProps, type LoginView } from "./account-card";
import { CSS_CLASS } from "./css";
import { isHttpUrl } from "./login-window";
import type { AccountAction } from "./page-state";
import type { VendorEntry } from "./registry";
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
   * 重新读取**一家**的模型目录（按账户刷新的落点）。
   *
   * 2026-10-18 用户要求：「重新获取模型不是刷新所有的，应该是刷新单个账户的」—— 入口从
   * 面板头部的全局按钮改成**每个账号行自己的刷新按钮**（见 `account-card.ts` 的行内动作），
   * 目录是厂商级资源，所以回调带厂商而不带账号：点任一账号刷的都是它所属那一家的目录，
   * 惠及该厂商的所有账号，但不碰别家。**不传 = 那些按钮不渲染**（旧调用方/纯测试不受影响）。
   */
  onRefreshModels?: (vendor: string) => void;
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
  const addProps = addVendor === undefined ? undefined : accountPropsFor(props, addVendor);
  // 只要还有一家在首次读取中，就不说「还没有添加任何账户」——那句话描述的是读完之后
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
      // 按厂商分组（2026-10-18 用户要求「新增账号那个地方优化一下操作逻辑」）：平铺四个按钮
      // 时「往哪家加」只在按钮文字的前缀里，扫一眼分不出来；现在每家一个小标题 + 两个动作。
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
                  key: `${group.entry.providerId}-add`,
                  type: "button",
                  "data-action": group.entry.providerId === "commandcode" ? "add" : `add-${group.entry.providerId}`,
                  "data-add-for": group.entry.providerId,
                  className: CSS_CLASS.buttonSecondary,
                  onClick: () => props.onOpenAction(group.entry.providerId, { kind: "add" }),
                },
                t("account.addFor"),
              ),
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
  };
}
