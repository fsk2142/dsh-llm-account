/**
 * 「网页搜索」卡片的**渲染层**（纯 props → 元素树，不持有状态、不发请求）。
 *
 * 三选一（跟随模型账号 / DeepSeek 官方 / 第三方 API）最终写进宿主的 `web.searchProvider`；
 * 卡片本身不执行搜索，只负责把「现在谁在生效」「选了为什么还不能用」说清楚。
 * 诊断原文（当前 provider id、引用名）留在 `data-*` 属性上，界面显示人话。
 * @module dsh-llm-account/src/client/web-search-card
 */
import { createElement, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";

/** 三选一。 */
export type WebSearchChoice = "account" | "deepseek" | "custom";

/** 第三方 API 的可编辑字段（草稿）。 */
export interface WebSearchCustomDraft {
  endpoint: string;
  method: "GET" | "POST";
  queryParam: string;
  queryField: string;
  keyField: string;
  resultsPath: string;
  authHeader: string;
  authScheme: string;
}

/** 当前默认模型的路由与支持状态（账号模式的「跟随对象」）。 */
export interface WebSearchRouteView {
  /** 宿主路由 id（诊断原文，留给 `data-*`）。 */
  readonly providerId: string;
  /** 展示名。 */
  readonly label: string;
  /** 模型 id。 */
  readonly model: string;
  /** 该厂商网关是否支持原生搜索。 */
  readonly supported: boolean;
  /** 不支持时的原因（人话）。 */
  readonly reason?: string;
}

/** 一把凭据的配置状态。 */
export interface WebSearchKeyView {
  /** 凭据引用名（诊断原文，留给 `data-*`）。 */
  readonly ref: string;
  readonly configured: boolean;
}

/** 卡片 props。 */
export interface WebSearchCardProps {
  readonly t: (key: string) => string;
  /** 当前选择（容器按宿主 `web.searchProvider` + 本模块模式推导，可被用户点选覆盖）。 */
  readonly choice: WebSearchChoice;
  /** 宿主 `web.searchProvider` 的当前值；`undefined` = 还没设置。 */
  readonly effective: string | undefined;
  /** 当前默认模型；缺失表示没有可跟随的模型账号。 */
  readonly route?: WebSearchRouteView;
  /** 账号模式要用的凭据（厂商行的引用与配置状态）。 */
  readonly accountKey?: WebSearchKeyView;
  /** 第三方模式的字段草稿。 */
  readonly custom: WebSearchCustomDraft;
  /** 第三方 Key（引用与配置状态）。 */
  readonly customKey: WebSearchKeyView;
  /** 凭据服务是否可用（不可用时不说「未配置」，说「读不到」）。 */
  readonly credentialsAvailable: boolean;
  /** 读取设置失败的原因（人话）。 */
  readonly problem?: string;
  readonly saving: boolean;
  /** 保存后的提示（含「已保存但没切换」的情形）。 */
  readonly notice?: string;
  /** 保存失败的原因。 */
  readonly error?: string;
  /** 第三方 Key 输入框的草稿。 */
  readonly keyDraft: string;
  onChoose: (choice: WebSearchChoice) => void;
  onCustomField: (field: keyof WebSearchCustomDraft, value: string) => void;
  onKeyDraft: (value: string) => void;
  onSave: () => void;
}

/** 三选一的一行：radio + 标题 + 一句说明。 */
function choiceRow(props: WebSearchCardProps, choice: WebSearchChoice, titleKey: string, hintKey: string): ReactElement {
  return createElement(
    "label",
    { key: choice, "data-web-search-option": choice, className: CSS_CLASS.field },
    createElement("input", {
      type: "radio",
      name: "llm-account-web-search",
      "data-web-search-radio": choice,
      checked: props.choice === choice,
      disabled: props.saving,
      onChange: () => props.onChoose(choice),
    }),
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement("span", null, props.t(titleKey)),
      createElement("small", { className: CSS_CLASS.note }, props.t(hintKey)),
    ),
  );
}

/** 「当前生效」一行：说清宿主此刻实际会用的 provider（含「未设置」）。 */
function effectiveLine(props: WebSearchCardProps): ReactNode {
  const value = props.effective;
  return createElement(
    "p",
    {
      key: "effective",
      "data-web-search-effective": value ?? "none",
      className: CSS_CLASS.note,
    },
    value === undefined
      ? props.t("webSearch.effective.none")
      : `${props.t("webSearch.effective")}：${value}`,
  );
}

/** 账号模式的明细：跟谁、支不支持、密钥有没有。 */
function accountDetail(props: WebSearchCardProps): ReactNode[] {
  const route = props.route;
  if (route === undefined) {
    return [
      createElement(
        "p",
        { key: "no-model", "data-web-search-route": "none", className: CSS_CLASS.note },
        props.t("webSearch.noModel"),
      ),
    ];
  }
  const lines: ReactNode[] = [
    createElement(
      "p",
      { key: "route", "data-web-search-route": route.providerId, className: CSS_CLASS.note },
      props.t("webSearch.route").replace("{vendor}", route.label).replace("{model}", route.model),
    ),
    createElement(
      "p",
      {
        key: "support",
        "data-web-search-supported": route.supported ? "true" : "false",
        className: route.supported ? CSS_CLASS.note : CSS_CLASS.failure,
      },
      route.supported
        ? props.t("webSearch.supported")
        : `${props.t("webSearch.unsupported")}：${route.reason ?? ""}`,
    ),
  ];
  const key = props.accountKey;
  if (key !== undefined) {
    lines.push(
      createElement(
        "p",
        {
          key: "key",
          "data-web-search-account-key": props.credentialsAvailable
            ? key.configured
              ? "configured"
              : "missing"
            : "unreadable",
          "data-web-search-account-ref": key.ref,
          className: CSS_CLASS.note,
        },
        props.credentialsAvailable
          ? key.configured
            ? props.t("webSearch.account.keyConfigured").replace("{ref}", key.ref)
            : props.t("webSearch.account.keyMissing").replace("{ref}", key.ref)
          : props.t("webSearch.key.unreadable"),
      ),
    );
  }
  return lines;
}

/** 第三方模式的一个字段行。 */
function customFieldRow(
  props: WebSearchCardProps,
  field: keyof WebSearchCustomDraft,
  titleKey: string,
  hintKey?: string,
): ReactElement {
  const value = props.custom[field];
  const control =
    field === "method"
      ? createElement(
          "select",
          {
            "data-web-search-field": field,
            value,
            disabled: props.saving,
            onChange: (event: { target?: { value?: string } }) => props.onCustomField(field, event.target?.value ?? ""),
          },
          createElement("option", { key: "GET", value: "GET" }, "GET"),
          createElement("option", { key: "POST", value: "POST" }, "POST"),
        )
      : createElement("input", {
          "data-web-search-field": field,
          type: "text",
          value,
          disabled: props.saving,
          onChange: (event: { target?: { value?: string } }) => props.onCustomField(field, event.target?.value ?? ""),
        });
  return createElement(
    "label",
    { key: field, className: CSS_CLASS.field },
    createElement(
      "span",
      { className: CSS_CLASS.fieldText },
      createElement("span", null, props.t(titleKey)),
      ...(hintKey === undefined
        ? []
        : [createElement("small", { key: "hint", className: CSS_CLASS.note }, props.t(hintKey))]),
    ),
    control,
  );
}

/** 第三方模式的明细：字段 + Key + 状态。 */
function customDetail(props: WebSearchCardProps): ReactNode[] {
  const key = props.customKey;
  return [
    customFieldRow(props, "endpoint", "webSearch.field.endpoint", "webSearch.field.endpoint.hint"),
    customFieldRow(props, "method", "webSearch.field.method"),
    customFieldRow(props, "queryParam", "webSearch.field.queryParam", "webSearch.field.queryParam.hint"),
    customFieldRow(props, "queryField", "webSearch.field.queryField", "webSearch.field.queryField.hint"),
    customFieldRow(props, "keyField", "webSearch.field.keyField", "webSearch.field.keyField.hint"),
    customFieldRow(props, "resultsPath", "webSearch.field.resultsPath", "webSearch.field.resultsPath.hint"),
    customFieldRow(props, "authHeader", "webSearch.field.authHeader", "webSearch.field.authHeader.hint"),
    customFieldRow(props, "authScheme", "webSearch.field.authScheme", "webSearch.field.authScheme.hint"),
    createElement(
      "label",
      { key: "key", className: CSS_CLASS.field },
      createElement(
        "span",
        { className: CSS_CLASS.fieldText },
        createElement("span", null, props.t("webSearch.key")),
        createElement("small", { key: "hint", className: CSS_CLASS.note }, props.t("webSearch.key.keep")),
      ),
      createElement("input", {
        "data-web-search-key": "true",
        type: "password",
        value: props.keyDraft,
        disabled: props.saving,
        placeholder: props.t("webSearch.key.placeholder"),
        onChange: (event: { target?: { value?: string } }) => props.onKeyDraft(event.target?.value ?? ""),
      }),
    ),
    createElement(
      "p",
      {
        key: "key-status",
        "data-web-search-key-status": key.configured ? "configured" : "missing",
        "data-web-search-key-ref": key.ref,
        className: CSS_CLASS.note,
      },
      props.credentialsAvailable
        ? key.configured
          ? props.t("webSearch.key.configured").replace("{ref}", key.ref)
          : props.t("webSearch.key.missing").replace("{ref}", key.ref)
        : props.t("webSearch.key.unreadable"),
    ),
  ];
}

/** DeepSeek 官方一行：那是宿主自己的提供方，钥匙也在宿主自己的卡片里。 */
function deepseekDetail(props: WebSearchCardProps): ReactNode[] {
  return [
    createElement(
      "p",
      { key: "deepseek", "data-web-search-deepseek": "true", className: CSS_CLASS.note },
      props.t("webSearch.deepseek.hint"),
    ),
  ];
}

/** 卡片主体。 */
export function WebSearchCard(props: WebSearchCardProps): ReactElement {
  const t = props.t;
  const details =
    props.choice === "account"
      ? accountDetail(props)
      : props.choice === "custom"
        ? customDetail(props)
        : deepseekDetail(props);
  return createElement(
    "section",
    { "data-web-search": "true", className: CSS_CLASS.card },
    createElement("h2", null, t("webSearch.title")),
    createElement("p", { "data-card-hint": "true", className: CSS_CLASS.note }, t("webSearch.hint")),
    ...(props.problem === undefined
      ? []
      : [
          createElement(
            "p",
            { key: "problem", "data-web-search-problem": "true", className: CSS_CLASS.failure },
            `${t("webSearch.readFailed")}：${props.problem}`,
          ),
        ]),
    choiceRow(props, "account", "webSearch.option.account", "webSearch.option.account.hint"),
    choiceRow(props, "deepseek", "webSearch.option.deepseek", "webSearch.option.deepseek.hint"),
    choiceRow(props, "custom", "webSearch.option.custom", "webSearch.option.custom.hint"),
    effectiveLine(props),
    ...details,
    createElement(
      "div",
      { className: CSS_CLASS.actions },
      createElement(
        "button",
        {
          type: "button",
          "data-web-search-save": "true",
          className: CSS_CLASS.buttonPrimary,
          disabled: props.saving,
          onClick: () => props.onSave(),
        },
        props.saving ? t("webSearch.saving") : t("webSearch.save"),
      ),
      createElement("small", { key: "hint", className: CSS_CLASS.note }, t("webSearch.saveHint")),
    ),
    ...(props.notice === undefined
      ? []
      : [
          createElement(
            "p",
            { key: "notice", "data-web-search-notice": "true", className: CSS_CLASS.note },
            props.notice,
          ),
        ]),
    ...(props.error === undefined
      ? []
      : [
          createElement(
            "p",
            { key: "error", "data-web-search-error": "true", className: CSS_CLASS.failure },
            `${t("webSearch.failure")}：${props.error}`,
          ),
        ]),
  );
}
