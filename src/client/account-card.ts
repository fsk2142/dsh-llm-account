/**
 * Command Code 账户卡片（Task 5）：账号行、额度条、`⋯` 菜单、添加账户与网页登录入口。
 *
 * 与 `page.ts` 同样的纪律（Ruling 22）：**纯 props → 元素树**，没有 Hook、没有内部状态。
 * 用户输入到一半的名称/密钥住在 `page-state.ts` 的 `action` 草稿里（可完整单测），
 * 卡片只负责渲染它、把变化报出去 —— 这条由测试用替身机械保证（Hook 一律抛错）。
 *
 * 三条不可退让的规则：
 * 1. **额度缺失不得渲染成 0**：窗口里没有的字段就是没有，宁可显示「暂无额度数据」。
 * 2. **密钥只走账户操作**：密钥输入不带设置字段标记（`data-field`），因此进不了设置草稿与保存条。
 * 3. **按能力降级**：菜单项与登录入口都由宿主发布的能力声明决定（规格 §7.3），不是写死的。
 * @module dsh-llm-account/src/client/account-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";
import { rejectionText } from "./copy";
import type { AccountAction } from "./page-state";
import { quotaShape, quotaWindowDetail, quotaWindowText } from "./quota";
import type { AccountUsageStatus, QuotaSummary, QuotaWindow, VendorCapabilities, VendorUsageStatus } from "./usage-contract";

/** 登录状态面（由页面从远程 `loginStatus` 取得）。 */
export interface LoginView {
  state: string;
  authUrl?: string;
  reason?: string;
}

/** 卡片属性：全部数据与回调，卡片自己不持有任何状态。 */
export interface AccountCardProps {
  /** 该厂商的状态；远程面还没挂上时为 `undefined`（卡片显示「暂无数据」而不是报错）。 */
  status: VendorUsageStatus | undefined;
  t: (key: string) => string;
  /** 正在进行的账户操作（来自 `page-state.ts`）。 */
  action?: AccountAction | undefined;
  /** 展开完整报告的账号。 */
  expandedRef?: string | undefined;
  /** 网页登录的当前状态（没有登录入口的厂商为 `undefined`）。 */
  login?: LoginView | undefined;
  onOpenAction: (action: { kind: AccountAction["kind"]; ref?: string }) => void;
  onActionField: (field: "label" | "key", value: string) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
  /** 固定账号 / 切换账号；`null` 表示回到自动轮换。 */
  onSelect: (ref: string | null) => void;
  onRemove: (ref: string) => void;
  onToggleExpand: (ref: string) => void;
  onLoginBegin: () => void;
  /**
   * 追加到每一行末尾的厂商专属控件（T6 的排序控件由 `opencode-account-card.ts` 注入）。
   *
   * 扩展点：行本身的渲染只有一份实现（额度条、状态标记、菜单都在这里），厂商差异通过这个
   * render prop 挂上去，而不是复制一整行。
   * @param account - 该行账号。
   * @param index - 它在轮换顺序里的下标（排序控件要用）。
   */
  rowExtras?: (account: AccountUsageStatus, index: number) => ReactNode;
}

/**
 * 账户卡片。
 * @param props - 见 {@link AccountCardProps}。
 * @returns 元素树。
 */
export function AccountCard(props: AccountCardProps): ReactElement {
  const { status, t } = props;
  const accounts = status?.accounts ?? [];
  return createElement(
    "section",
    { "data-card": "accounts", className: CSS_CLASS.card },
    createElement("h2", null, t("group.accounts")),
    ...accounts.map((account, index) => accountRow(props, account, index)),
    // 空态分三种原因，文案不许混用：「远程面还没挂上」是数据不可用；「挂上了但一家账号都
    // 没有」是提示用户去添加 —— 都写成「暂无额度数据」会把没账号显示成额度故障。
    ...(status === undefined
      ? [createElement("p", { key: "unavailable", "data-accounts-empty": "true" }, t("account.unavailable"))]
      : accounts.length === 0
        ? [createElement("p", { key: "empty", "data-accounts-empty": "true" }, t("account.empty"))]
        : []),
    ...failureNotes(props),
    ...loginSection(props),
    addSection(props),
  );
}

/** 一行账号：名称、套餐、状态标记、额度条、展开报告、`⋯` 菜单。 */
function accountRow(props: AccountCardProps, account: AccountUsageStatus, index: number): ReactNode {
  const { t, action } = props;
  const pinned = props.status?.pinned === account.ref;
  const effective = account.effective;
  // 两者相同只标一次（避免同一件事写两遍）。
  const marks: ReactNode[] = [];
  if (pinned && !effective) marks.push(createElement("span", { key: "pinned", "data-mark": "pinned", className: CSS_CLASS.mark }, t("account.pinnedBy")));
  if (effective) marks.push(createElement("span", { key: "effective", "data-mark": "effective", className: CSS_CLASS.mark }, t("account.effectiveBy")));

  let rejection: ReactNode = null;
  if (account.rejection !== undefined) {
    rejection = createElement(
      "span",
      {
        "data-rejection-kind": account.rejection.kind,
        ...(account.rejection.until === undefined ? {} : { "data-rejection-until": account.rejection.until }),
      },
      // 可读文案，不是原始枚举（`quota`/`server`/…）；机器可读的值在 data 属性上。
      rejectionText(t, account.rejection.kind),
    );
  }

  const editingKey = action?.kind === "key" && action.ref === account.ref;
  const editingRename = action?.kind === "rename" && action.ref === account.ref;

  return createElement(
    "div",
    {
      key: account.ref,
      "data-account": account.ref,
      className: CSS_CLASS.account,
      ...(account.rejection === undefined ? {} : { "data-rejection-kind": account.rejection.kind }),
      ...(account.rejection?.until === undefined ? {} : { "data-rejection-until": account.rejection.until }),
    },
    createElement("span", { "data-account-label": account.ref }, account.label),
    createElement("span", { "data-account-status": account.configured ? "configured" : "missing" }, account.configured ? t("account.configured") : t("account.missing")),
    ...marks,
    rejection,
    ...(account.quota === undefined ? [createElement("small", { key: "quota-none" }, t("account.quotaMissing"))] : []),
    ...quotaBars(props, account.quota),
    ...(props.status === undefined ? [] : [planLine(props, account.quota)]),
    createElement(
      "button",
      {
        type: "button",
        "data-action": "expand",
        "aria-expanded": props.expandedRef === account.ref,
        onClick: () => props.onToggleExpand(account.ref),
      },
      props.expandedRef === account.ref ? t("account.collapse") : t("account.expand"),
    ),
    props.expandedRef === account.ref ? reportBlock(props, account) : null,
    // 只有支持排序的厂商才有拖拽手柄；不支持的**整块不渲染**（不是藏起来）。
    capabilitiesOf(props).reorder ? createElement("span", { "data-drag-handle": account.ref }, "::") : null,
    ...menuButtons(props, account),
    editingRename ? renameEditor(props, account) : null,
    editingKey ? keyEditor(props, account) : null,
    // 厂商专属控件（T6 的排序）挂在行尾：行渲染只有一份实现。
    props.rowExtras === undefined ? null : props.rowExtras(account, index),
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

/** 套餐行：只在有额度摘要且厂商给了套餐名时出现。 */
function planLine(props: AccountCardProps, quota: QuotaSummary | undefined): ReactNode {
  if (quota?.plan === undefined) return null;
  return createElement("small", { key: "plan", "data-plan": quota.plan }, `${props.t("account.plan")}: ${quota.plan}`);
}

/**
 * 额度条：**每个存在的窗口一行**。
 *
 * 数字只在读数里真的有那个字段时才渲染 —— `used`/`cap` 缺任何一个都不拼 `x/y`，
 * `percent` 缺失也不补 0。全都缺就显示「暂无额度数据」。
 */
function quotaBars(props: AccountCardProps, quota: QuotaSummary | undefined): ReactNode[] {
  if (quota === undefined) return [];
  return quota.windows.map((window) => quotaBar(props, window));
}

/** 一个额度窗口。 */
function quotaBar(props: AccountCardProps, window: QuotaWindow): ReactNode {
  return createElement("div", { key: window.key, "data-quota-window": window.key, className: CSS_CLASS.quotaRow }, createElement("span", null, window.key), quotaText(props, window));
}

/** 一个窗口的读数文案：缺失与真的 0 必须区分开（规则在 `quota.ts`，三张卡片共用一份）。 */
function quotaText(props: AccountCardProps, window: QuotaWindow): ReactNode {
  const shape = quotaShape(window);
  return createElement(
    "span",
    { "data-quota-value": shape, ...(shape === "missing" ? { className: CSS_CLASS.quotaMissing } : {}) },
    quotaWindowText(props.t, window),
  );
}

/** 展开后的完整报告：窗口明细与失败项。 */
function reportBlock(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  const { t } = props;
  const quota = account.quota;
  return createElement(
    "div",
    { "data-report": account.ref },
    ...(quota === undefined
      ? [createElement("p", { key: "none" }, t("account.quotaMissing"))]
      : [
          ...quota.windows.map((window) =>
            createElement(
              "p",
              { key: `w-${window.key}`, "data-report-window": window.key },
              `${window.key}: ${quotaWindowDetail(window)}`,
            ),
          ),
          ...quota.failures.map((failure, index) => createElement("p", { key: `f-${index}`, "data-report-failure": index }, failure)),
        ]),
  );
}

/** `⋯` 菜单：按能力渲染条目。 */
function menuButtons(props: AccountCardProps, account: AccountUsageStatus): ReactNode[] {
  const { t } = props;
  const capabilities = capabilitiesOf(props);
  const buttons: ReactNode[] = [
    createElement("button", { key: "rename", type: "button", "data-action": "rename", onClick: () => props.onOpenAction({ kind: "rename", ref: account.ref }) }, t("account.rename")),
    createElement("button", { key: "key", type: "button", "data-action": "replaceKey", onClick: () => props.onOpenAction({ kind: "key", ref: account.ref }) }, t("account.replaceKey")),
  ];
  // 只有支持固定的厂商才给「固定使用此账户」；opencode 用 select 切换（T6 处理）。
  if (capabilities.pin) {
    buttons.push(
      createElement("button", { key: "pin", type: "button", "data-action": "pin", onClick: () => props.onSelect(account.ref) }, t("account.pin")),
    );
  }
  buttons.push(createElement("button", { key: "remove", type: "button", "data-action": "remove", onClick: () => props.onRemove(account.ref) }, t("account.remove")));
  return buttons;
}

/** 重命名编辑器（受控）。 */
function renameEditor(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  const label = props.action?.label ?? "";
  return createElement(
    "span",
    { "data-editor": "rename", "data-editor-ref": account.ref, className: CSS_CLASS.inline },
    createElement("input", {
      "data-rename-input": account.ref,
      type: "text",
      value: label,
      placeholder: props.t("account.newLabel"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("label", event.target?.value ?? ""),
    }),
    createElement("button", { type: "button", "data-action": "confirmRename", onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", onClick: () => props.onCancelAction() }, props.t("account.cancel")),
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
    "span",
    { "data-editor": "key", "data-editor-ref": account.ref, className: CSS_CLASS.inline },
    createElement("input", {
      "data-key-input": account.ref,
      type: "password",
      value: props.action?.key ?? "",
      placeholder: props.t("account.newKey"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("key", event.target?.value ?? ""),
    }),
    createElement("button", { type: "button", "data-action": "confirmKey", onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", onClick: () => props.onCancelAction() }, props.t("account.cancel")),
  );
}

/** 服务端失败项提示。 */
function failureNotes(props: AccountCardProps): ReactNode[] {
  return (props.status?.failures ?? []).map((failure, index) =>
    createElement("p", { key: `failure-${index}`, "data-failure": index, className: CSS_CLASS.failure }, failure),
  );
}

/** 网页登录入口：只有声明了 `browserLogin` 的厂商才有。 */
function loginSection(props: AccountCardProps): ReactNode[] {
  const { t, login } = props;
  if (!capabilitiesOf(props).browserLogin) return [];
  const nodes: ReactNode[] = [
    createElement("button", { key: "login", type: "button", "data-action": "login", onClick: () => props.onLoginBegin() }, t("account.login")),
  ];
  if (login?.state === "waiting") {
    nodes.push(createElement("p", { key: "waiting" }, t("account.loginWaiting")));
    if (login.authUrl !== undefined) {
      nodes.push(createElement("a", { key: "url", "data-login-url": "true", href: login.authUrl, target: "_blank", rel: "noreferrer" }, login.authUrl));
    }
  }
  if (login?.state === "failed") {
    nodes.push(createElement("p", { key: "reason", "data-login-reason": login.reason ?? "error" }, reasonText(t, login.reason)));
  }
  return nodes;
}

/** 失败原因文案：认识的原因用专门文案，不认识的回退到通用文案（**不打印原因键**）。 */
function reasonText(t: (key: string) => string, reason: string | undefined): string {
  const key = `account.reason.${reason ?? "error"}`;
  if (reason === undefined) return t("account.reason.error");
  const text = t(key);
  return text === key ? t("account.reason.error") : text;
}

/**
 * 底部「添加账户」（受控输入）。
 *
 * **第一次输入就会打开 `add` 操作**（`openAction` + `setActionField` 一起调）：页面状态机里
 * `setActionField` 在没有进行中操作时是恒等变换（`page-state.ts`），而这张卡片里**没有任何
 * 按钮去打开 `add`** —— 只写 `onActionField` 的话，两个输入框永远是空的、「添加」按钮点了
 * 什么也不会发生（`confirmAction` 拿到 `action === undefined` 直接返回）。这是接线层的漏口，
 * 由容器渲染仿真（`tests/client/container-simulation.test.ts`）抓出来。
 */
function addSection(props: AccountCardProps): ReactNode {
  const { t, action } = props;
  const adding = action?.kind === "add";
  /** 打开 add 操作（幂等：`openAction` 对同一 kind/ref 返回原对象）后再写字段。 */
  const edit = (field: "label" | "key", value: string): void => {
    if (!adding) props.onOpenAction({ kind: "add" });
    props.onActionField(field, value);
  };
  const nodes: ReactNode[] = [
    createElement("input", {
      key: "label",
      "data-add-label": "true",
      type: "text",
      value: adding ? action.label : "",
      placeholder: t("account.newLabel"),
      onChange: (event: { target?: { value?: string } }) => edit("label", event.target?.value ?? ""),
    }),
    createElement("input", {
      key: "key",
      "data-add-key": "true",
      type: "password",
      value: adding ? action.key : "",
      placeholder: t("account.newKey"),
      onChange: (event: { target?: { value?: string } }) => edit("key", event.target?.value ?? ""),
    }),
    createElement("button", {
      key: "add",
      type: "button",
      "data-action": "add",
      // 表单还没打开时（用户直接点按钮）先打开它：`confirmAction` 在 `action === undefined`
      // 时什么都不做，那一次点击就会静默丢失。字段为空时派发仍然不发调用（见
      // `dispatchAccountAction`），输入框会留着用户能看见。
      onClick: () => {
        if (!adding) props.onOpenAction({ kind: "add" });
        props.onConfirmAction();
      },
    }, t("account.add")),
  ];
  if (adding) {
    nodes.push(createElement("button", { key: "cancel", type: "button", "data-action": "cancel", onClick: () => props.onCancelAction() }, t("account.cancel")));
  }
  return createElement("div", { "data-card": "add-account", className: CSS_CLASS.actions }, ...nodes);
}
