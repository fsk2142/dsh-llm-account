/**
 * 「网页搜索」卡片的渲染层测试（纯 props → 元素树，Ruling 22）。
 *
 * 断言用 `data-*` 标记定位控件、用回调断言「点了会发生什么」；文案一律对照 key（文案表由
 * copy.ts 自己的测试守），这样本文件不随文案改动而失效。
 */
import { expect, it, vi } from "vitest";

import {
  WebSearchCard,
  type WebSearchCardProps,
  type WebSearchCustomDraft,
} from "../../src/client/web-search-card";
import { findSim, fireSim, elementsOfSim, textsOfSim } from "../support/container-sim";

/** 文案替身：原样返回 key（断言 key 比断言文案稳）。 */
function translator(): (key: string) => string {
  return (key) => key;
}

/** 一份第三方字段草稿。 */
const CUSTOM: WebSearchCustomDraft = {
  endpoint: "https://search.example/api",
  method: "GET",
  queryParam: "q",
  queryField: "query",
  keyField: "",
  resultsPath: "",
  authHeader: "Authorization",
  authScheme: "Bearer",
};

/** 卡片 props（默认账号模式、一切正常）。 */
function propsOf(overrides: Partial<WebSearchCardProps> = {}): WebSearchCardProps {
  return {
    t: translator(),
    choice: "account",
    effective: undefined,
    custom: CUSTOM,
    customKey: { ref: "LLM_ACCOUNT_SEARCH_KEY", configured: false },
    credentialsAvailable: true,
    keyDraft: "",
    onChoose: () => undefined,
    onCustomField: () => undefined,
    onKeyDraft: () => undefined,
    onSave: () => undefined,
    ...overrides,
  };
}

it("三选一：radio 的存在、选中与「当前生效」逐条照实上屏", () => {
  const account = WebSearchCard(propsOf());
  for (const choice of ["account", "deepseek", "custom"]) {
    expect(findSim(account, "data-web-search-option", choice)).toBeDefined();
  }
  expect(findSim(account, "data-web-search-radio", "account")?.props.checked).toBe(true);
  expect(findSim(account, "data-web-search-radio", "custom")?.props.checked).toBe(false);
  // 没设置过 searchProvider：说「未设置」，不假装有默认值。
  expect(findSim(account, "data-web-search-effective")?.props["data-web-search-effective"]).toBe("none");
  expect(textsOfSim(account)).toContain("webSearch.effective.none");

  const custom = WebSearchCard(propsOf({ choice: "custom", effective: "llm-account-web" }));
  expect(findSim(custom, "data-web-search-radio", "custom")?.props.checked).toBe(true);
  const effective = findSim(custom, "data-web-search-effective");
  expect(effective?.props["data-web-search-effective"]).toBe("llm-account-web");
  expect(textsOfSim(custom).some((text) => text.includes("llm-account-web"))).toBe(true);
});

it("账号模式：跟随对象、支持状态与密钥状态逐条上屏（不支持时给原因）", () => {
  const tree = WebSearchCard(
    propsOf({
      route: {
        providerId: "dsh-opencode-go",
        label: "OpenCode",
        model: "some-model",
        supported: false,
        reason: "OpenCode 的网关是 OpenAI Chat Completions 协议，没有可声明的服务端联网搜索工具。",
      },
      accountKey: { ref: "OPENCODE_KEY", configured: true },
    }),
  );
  const route = findSim(tree, "data-web-search-route", "dsh-opencode-go");
  expect(route).toBeDefined();
  expect(findSim(tree, "data-web-search-supported")?.props["data-web-search-supported"]).toBe("false");
  expect(textsOfSim(tree).some((text) => text.includes("OpenAI Chat Completions"))).toBe(true);
  const key = findSim(tree, "data-web-search-account-key", "configured");
  expect(key?.props["data-web-search-account-ref"]).toBe("OPENCODE_KEY");
  // 引用名留在 data-* 上；上屏的是人话。文案替身下这句话就是它的 key。
  expect(textsOfSim(tree)).toContain("webSearch.account.keyConfigured");
});

it("账号模式：支持时显示「支持」；没有默认模型时说明缺什么", () => {
  const supported = WebSearchCard(
    propsOf({
      route: { providerId: "commandcode", label: "Command Code", model: "m", supported: true },
      accountKey: { ref: "COMMANDCODE_API_KEY", configured: false },
    }),
  );
  expect(findSim(supported, "data-web-search-supported")?.props["data-web-search-supported"]).toBe("true");
  expect(textsOfSim(supported)).toContain("webSearch.supported");
  expect(findSim(supported, "data-web-search-account-key", "missing")).toBeDefined();

  // 凭据服务读不到时是**第三种说法**（不是「未配置」——那是假装知道）。
  const unreadable = WebSearchCard(
    propsOf({
      route: { providerId: "commandcode", label: "Command Code", model: "m", supported: true },
      accountKey: { ref: "COMMANDCODE_API_KEY", configured: false },
      credentialsAvailable: false,
    }),
  );
  expect(findSim(unreadable, "data-web-search-account-key", "unreadable")).toBeDefined();
  expect(textsOfSim(unreadable)).toContain("webSearch.key.unreadable");

  const noModel = WebSearchCard(propsOf({ route: undefined }));
  expect(findSim(noModel, "data-web-search-route", "none")).toBeDefined();
  expect(textsOfSim(noModel)).toContain("webSearch.noModel");
});

it("第三方模式：九个字段 + Key 行的值都来自 props（凭据读不到时不说「未配置」）", () => {
  const tree = WebSearchCard(
    propsOf({
      choice: "custom",
      custom: { ...CUSTOM, method: "POST", keyField: "api_key", resultsPath: "data.hits", authScheme: "" },
      keyDraft: "sk-draft",
      customKey: { ref: "MY_SEARCH_KEY", configured: true },
      credentialsAvailable: true,
    }),
  );
  expect(findSim(tree, "data-web-search-field", "endpoint")?.props.value).toBe("https://search.example/api");
  expect(findSim(tree, "data-web-search-field", "method")?.props.value).toBe("POST");
  expect(findSim(tree, "data-web-search-field", "keyField")?.props.value).toBe("api_key");
  expect(findSim(tree, "data-web-search-field", "resultsPath")?.props.value).toBe("data.hits");
  expect(findSim(tree, "data-web-search-field", "authScheme")?.props.value).toBe("");
  expect(findSim(tree, "data-web-search-key")?.props.value).toBe("sk-draft");
  const status = findSim(tree, "data-web-search-key-status", "configured");
  expect(status?.props["data-web-search-key-ref"]).toBe("MY_SEARCH_KEY");

  const unreadable = WebSearchCard(
    propsOf({ choice: "custom", customKey: { ref: "MY_SEARCH_KEY", configured: false }, credentialsAvailable: false }),
  );
  expect(textsOfSim(unreadable)).toContain("webSearch.key.unreadable");
});

it("交互：点 radio / 改字段 / 改 Key / 保存都走对应回调", () => {
  const onChoose = vi.fn();
  const onCustomField = vi.fn();
  const onKeyDraft = vi.fn();
  const onSave = vi.fn();
  const tree = WebSearchCard(
    propsOf({ choice: "custom", onChoose, onCustomField, onKeyDraft, onSave }),
  );
  fireSim(findSim(tree, "data-web-search-radio", "deepseek"), "onChange");
  expect(onChoose).toHaveBeenCalledWith("deepseek");
  fireSim(findSim(tree, "data-web-search-field", "endpoint"), "onChange", { target: { value: "https://next.example" } });
  expect(onCustomField).toHaveBeenCalledWith("endpoint", "https://next.example");
  fireSim(findSim(tree, "data-web-search-field", "method"), "onChange", { target: { value: "POST" } });
  expect(onCustomField).toHaveBeenCalledWith("method", "POST");
  fireSim(findSim(tree, "data-web-search-key"), "onChange", { target: { value: "sk-new" } });
  expect(onKeyDraft).toHaveBeenCalledWith("sk-new");
  // 这张卡不再有自己的保存按钮：统一由设置页底部那个「保存」触发（2026-10-18 用户要求）。
  expect(elementsOfSim(tree).some((element) => element.props["data-web-search-save"] !== undefined)).toBe(false);
});

it("problem / notice / error 三行只在给值时出现", () => {
  const quiet = WebSearchCard(propsOf());
  expect(elementsOfSim(quiet).some((element) => "data-web-search-problem" in element.props)).toBe(false);
  expect(elementsOfSim(quiet).some((element) => "data-web-search-notice" in element.props)).toBe(false);
  expect(elementsOfSim(quiet).some((element) => "data-web-search-error" in element.props)).toBe(false);

  const loud = WebSearchCard(propsOf({ problem: "describe 挂了", notice: "已保存", error: "写不进去" }));
  expect(textsOfSim(loud).some((text) => text.includes("describe 挂了"))).toBe(true);
  expect(textsOfSim(loud).some((text) => text.includes("已保存"))).toBe(true);
  expect(textsOfSim(loud).some((text) => text.includes("写不进去"))).toBe(true);
});

it("DeepSeek 模式：提示那是宿主自己的钥匙", () => {
  const tree = WebSearchCard(propsOf({ choice: "deepseek", effective: "deepseek-official" }));
  expect(findSim(tree, "data-web-search-deepseek")).toBeDefined();
  expect(findSim(tree, "data-web-search-effective")?.props["data-web-search-effective"]).toBe("deepseek-official");
});
