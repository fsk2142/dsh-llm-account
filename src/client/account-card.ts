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
 * - 行内动作只留两个图标按钮（展开报告、更多操作），重命名/换密钥/固定/移除/上移/下移
 *   全部收进 `⋯` 菜单 —— 一行五个带边框的文字按钮是「像调试输出」的主要来源；
 * - 展开报告、编辑器、登录等待都是内嵌面板（`dsl-inset`），不是散落在行间的裸文本。
 * @module dsh-llm-account/src/client/account-card
 */
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS, cls } from "./css";
import { rejectionText } from "./copy";
import { ChevronIcon, ExternalIcon, MoreIcon, MoveIcon } from "./icons";
import type { AccountAction } from "./page-state";
import { quotaMeter, quotaShape, quotaWindowDetail, quotaWindowText } from "./quota";
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
  /**
   * 卡片底部的常驻内容（OpenCode 的 `autoSwitch` 开关）。
   *
   * 放在这里而不是让厂商卡片在外面另起一个 `<section>`：那个开关属于这张卡片，
   * 单独漂在卡片上方（重做前的样子）既没有归属也看不出它在管什么。
   */
  cardFooter?: ReactNode;
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
    ...accounts.map((account, index) => accountRow(props, account, index)),
    ...failureNotes(props),
    ...loginSection(props),
    addSection(props),
    props.cardFooter === undefined ? null : props.cardFooter,
  ];
}

/** 一行账号：身份行（名称 + 标记 + 动作）在上，额度表在下。 */
function accountRow(props: AccountCardProps, account: AccountUsageStatus, index: number): ReactNode {
  const { t } = props;
  const pinned = props.status?.pinned === account.ref;
  const effective = account.effective;
  // 两者相同只标一次（避免同一件事写两遍）。
  const marks: ReactNode[] = [];
  if (effective) {
    marks.push(createElement("span", { key: "effective", "data-mark": "effective", className: CSS_CLASS.mark }, t("account.effectiveBy")));
  }
  if (pinned && !effective) {
    marks.push(createElement("span", { key: "pinned", "data-mark": "pinned", className: CSS_CLASS.mark }, t("account.pinnedBy")));
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
  const expanded = props.expandedRef === account.ref;

  // 副文案：名称与 ref 不同时显示 ref（排查时真正有用的那个键），否则显示配置状态。
  const showRef = account.configured && account.label !== account.ref;
  const statusText = account.configured ? (showRef ? account.ref : t("account.configured")) : t("account.missing");

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
            ...marks,
            ...(quotaOf?.plan === undefined
              ? []
              : [createElement("span", { key: "plan", "data-mark": "plan", "data-plan": quotaOf.plan, className: CSS_CLASS.mark }, quotaOf.plan)]),
          ),
          createElement(
            "small",
            { "data-account-status": account.configured ? "configured" : "missing", ...(showRef ? { className: CSS_CLASS.mono } : {}) },
            statusText,
          ),
        ),
      ),
      createElement(
        "div",
        { className: CSS_CLASS.accountActions },
        expandButton(props, account, expanded),
        accountMenu(props, account, index),
        // 只有支持排序的厂商才有拖拽手柄；不支持的**整块不渲染**（不是藏起来）。
        ...(capabilitiesOf(props).reorder
          ? [createElement("span", { key: "drag", "data-drag-handle": account.ref, className: CSS_CLASS.drag, title: t("account.moveUp") })]
          : []),
      ),
    ),
    rejection,
    ...(quotaOf === undefined
      ? [createElement("small", { key: "quota-none", className: CSS_CLASS.quotaMissing }, t("account.quotaMissing"))]
      : [createElement("div", { key: "meters", className: CSS_CLASS.meters }, ...quotaBars(props, quotaOf))]),
    expanded ? reportBlock(props, account) : null,
    editingRename ? renameEditor(props, account) : null,
    editingKey ? keyEditor(props, account) : null,
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
 * 展开/收起报告的图标按钮。
 *
 * 图标本身不换：`.dsl-icon[aria-expanded="true"] svg` 把它转 180°，展开与否由 `aria-expanded`
 * 同时承担语义与视觉（屏幕阅读器与样式表读的是同一个属性）。
 */
function expandButton(props: AccountCardProps, account: AccountUsageStatus, expanded: boolean): ReactNode {
  const label = expanded ? props.t("account.collapse") : props.t("account.expand");
  return createElement(
    "button",
    {
      key: "expand",
      type: "button",
      "data-action": "expand",
      "aria-expanded": expanded,
      "aria-label": label,
      title: label,
      className: CSS_CLASS.icon,
      onClick: () => props.onToggleExpand(account.ref),
    },
    createElement(ChevronIcon, null),
  );
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
  const capabilities = capabilitiesOf(props);
  const buttons: ReactNode[] = [
    createElement(
      "button",
      { key: "rename", type: "button", "data-action": "rename", className: CSS_CLASS.item, onClick: () => props.onOpenAction({ kind: "rename", ref: account.ref }) },
      t("account.rename"),
    ),
    createElement(
      "button",
      { key: "key", type: "button", "data-action": "replaceKey", className: CSS_CLASS.item, onClick: () => props.onOpenAction({ kind: "key", ref: account.ref }) },
      t("account.replaceKey"),
    ),
  ];
  // 只有支持固定的厂商才给「固定使用此账户」；opencode 用 select 切换（T6 处理）。
  if (capabilities.pin) {
    buttons.push(
      createElement(
        "button",
        { key: "pin", type: "button", "data-action": "pin", className: CSS_CLASS.item, onClick: () => props.onSelect(account.ref) },
        t("account.pin"),
      ),
    );
  }
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
function quotaBars(props: AccountCardProps, quota: QuotaSummary): ReactNode[] {
  // `windows` 在 QuotaSummary 里是必填字段，但线上同样可能缺或为 null：当「没有窗口」处理，
  // 而不是让 `.map` 抛在渲染路径上。
  return (quota.windows ?? []).map((window) => quotaBar(props, window));
}

/**
 * 一个额度窗口。
 *
 * 条宽与颜色的依据是**已用百分比**（契约写明 `percent` 是「已用百分比」，厂商的
 * `rate-limited` 也配着 `percent: 100`）。所以：用得越多越糟 —— 这不是审美选择，
 * 是单位的方向。两处历史错误都修在这里：
 * - 曾经按 0–1 处理（阈值永远判成健康、条宽乘 100 永远画满）；
 * - 曾经把「少用」当危险（方向反了，等于把健康标成红、把耗尽标成绿）。
 */
function quotaBar(props: AccountCardProps, window: QuotaWindow): ReactNode {
  const meter = quotaMeter(window);
  return createElement(
    "div",
    { key: window.key, "data-quota-window": window.key, className: CSS_CLASS.quotaRow },
    createElement(
      "div",
      { className: CSS_CLASS.meterHead },
      createElement("span", { className: CSS_CLASS.meterLabel }, window.key),
      quotaText(props, window),
    ),
    meter === undefined
      ? null
      : createElement(
          "span",
          { key: "bar", "data-quota-percent": meter.percent, className: CSS_CLASS.quotaTrack },
          createElement("span", {
            "data-quota-level": meter.level,
            className: CSS_CLASS.quotaFill,
            style: { width: `${meter.percent}%` },
          }),
        ),
  );
}

/** 一个窗口的读数文案：缺失与真的 0 必须区分开（规则在 `quota.ts`，三张卡片共用一份）。 */
function quotaText(props: AccountCardProps, window: QuotaWindow): ReactNode {
  const shape = quotaShape(window);
  return createElement(
    "span",
    { "data-quota-value": shape, className: shape === "missing" ? CSS_CLASS.quotaMissing : CSS_CLASS.quotaValue },
    quotaWindowText(props.t, window),
  );
}

/** 展开后的完整报告：窗口明细与失败项，一块内嵌面板（等宽、可断行）。 */
function reportBlock(props: AccountCardProps, account: AccountUsageStatus): ReactNode {
  const { t } = props;
  const quota = account.quota ?? undefined;
  return createElement(
    "div",
    { "data-report": account.ref, className: CSS_CLASS.inset },
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
      placeholder: props.t("account.newLabel"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("label", event.target?.value ?? ""),
    }),
    createElement("button", { type: "button", "data-action": "confirmRename", className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm), onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm), onClick: () => props.onCancelAction() }, props.t("account.cancel")),
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
      placeholder: props.t("account.newKey"),
      onChange: (event: { target?: { value?: string } }) => props.onActionField("key", event.target?.value ?? ""),
    }),
    createElement("button", { type: "button", "data-action": "confirmKey", className: cls(CSS_CLASS.buttonPrimary, CSS_CLASS.buttonSm), onClick: () => props.onConfirmAction() }, props.t("account.confirm")),
    createElement("button", { type: "button", "data-action": "cancel", className: cls(CSS_CLASS.buttonGhost, CSS_CLASS.buttonSm), onClick: () => props.onCancelAction() }, props.t("account.cancel")),
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
    if (login.authUrl !== undefined) {
      detail.push(createElement("a", { key: "url", "data-login-url": "true", className: CSS_CLASS.link, href: login.authUrl, target: "_blank", rel: "noreferrer" }, login.authUrl));
    }
  }
  if (login?.state === "failed") {
    detail.push(
      createElement("p", { key: "reason", "data-login-reason": login.reason ?? "error", className: CSS_CLASS.failure }, reasonText(t, login.reason)),
    );
  }
  return [
    createElement("div", { key: "login-row", "data-login-panel": login?.state ?? "idle", className: CSS_CLASS.actions }, button),
    ...(detail.length === 0 ? [] : [createElement("div", { key: "login-detail", className: CSS_CLASS.inset }, ...detail)]),
  ];
}

/** 失败原因文案：认识的原因用专门文案，不认识的回退到通用文案（**不打印原因键**）。 */
function reasonText(t: (key: string) => string, reason: string | undefined): string {
  const key = `account.reason.${reason ?? "error"}`;
  if (reason === undefined) return t("account.reason.error");
  const text = t(key);
  return text === key ? t("account.reason.error") : text;
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
  return createElement(
    "div",
    { "data-card": "add-account", className: cls(CSS_CLASS.add, CSS_CLASS.inset) },
    createElement(
      "label",
      { className: CSS_CLASS.addField },
      createElement("small", null, t("account.newLabel")),
      createElement("input", {
        "data-add-label": "true",
        type: "text",
        value: action?.label ?? "",
        placeholder: t("account.newLabel.placeholder"),
        onChange: (event: { target?: { value?: string } }) => edit("label", event.target?.value ?? ""),
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
      }),
    ),
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
