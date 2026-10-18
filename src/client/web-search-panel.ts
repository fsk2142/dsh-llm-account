/**
 * 「网页搜索」卡片的数据与写回逻辑：**自定义 Hook**，由设置页容器
 * （`seams.ts` 的 `createConnectedPage`）在自己的渲染体里调用。
 *
 * 为什么是 Hook 而不是一个独立的容器组件：Ruling 22 下 Hook 宿主只有页面容器一个，
 * 而本项目的迷你 React 夹具只把**挂载根**当作 Hook 实例 —— 作为子元素传进 `PageShell`
 * 的带 Hook 组件会在测试遍历树时于渲染外展开，直接抛 "useState outside of render"
 * （2026-10-18 实测）。以自定义 Hook 调用，全部状态落在根实例上，语义与真机一致。
 *
 * 三条写入路径，各自的落点都不同（这是本卡片最容易写错的地方）：
 * ① 本模块的设置行（`llm-account-web-search`）——模式与第三方字段；
 * ② 宿主的 `web` 行——`searchProvider`（谁执行搜索，三选一的真正语义）；
 * ③ 宿主凭据服务——第三方 Key（只存引用，密钥不进设置文档）。
 *
 * 「前提不满足就不切宿主来源」：例如选了第三方但地址没填、或选了账号模式但当前厂商不支持
 * 原生搜索 —— 设置照存（可继续改），但不把宿主推进一个必然失败的状态，并用一句人话说明
 * 为什么没生效。绝不静默改行为。
 * @module dsh-llm-account/src/client/web-search-panel
 */
import { createElement, useEffect, useState, type ReactElement } from "react";

import {
  DEFAULT_SEARCH_KEY_REF,
  WEB_SEARCH_NAMESPACE,
  WEB_SEARCH_PROVIDER_ID,
  nativeSearchSupportOf,
} from "../web-search/support";
import { CSS_CLASS } from "./css";
import { remoteOf, saveSettings, subscribeCredentials, type ClientSeamContext } from "./seams";
import {
  WebSearchCard,
  type WebSearchChoice,
  type WebSearchCustomDraft,
  type WebSearchKeyView,
  type WebSearchRouteView,
} from "./web-search-card";

/** 我们这一行的候选行名。 */
const OUR_ROWS: readonly string[] = [WEB_SEARCH_NAMESPACE];

/** 宿主 web seam 的配置行。 */
const WEB_ROWS: readonly string[] = ["web"];

/** 宿主当前默认模型所在的行。 */
const MODEL_ROWS: readonly string[] = ["agent-default-model"];

/** 厂商路由 id → 厂商设置行候选名（行 id 与核心命名空间都列上）。 */
const VENDOR_ROWS: Readonly<Record<string, readonly string[]>> = {
  commandcode: ["llm-commandcode", "commandcode"],
  "dsh-opencode-go": ["llm-opencode-go", "opencode-go"],
  opendesign: ["llm-opendesign", "opendesign"],
};

/** 「DeepSeek 官方」的宿主 provider id（`deepseek-search-api` 是同一家的另一种实现）。 */
const DEEPSEEK_PROVIDERS: readonly string[] = ["deepseek-official", "deepseek-search-api"];

/** `describe()` 里的一行。 */
interface RowView {
  /** 写入时用的行名（宿主按 profile 条目 id 寻址）。 */
  readonly row: string;
  /** 页面身份（命名空间名）。 */
  readonly ns: string;
  readonly value: Record<string, unknown>;
  readonly revision: number;
}

/** 一次读取算出来的卡片视图。 */
interface PanelView {
  readonly ours?: RowView;
  readonly web?: RowView;
  /** 宿主 `web.searchProvider` 的当前值。 */
  readonly effective: string | undefined;
  readonly route?: WebSearchRouteView;
  readonly accountKey?: WebSearchKeyView;
  readonly custom: WebSearchCustomDraft;
  readonly customKey: WebSearchKeyView;
  /** 凭据服务是否可用（不可用时不说「未配置」，说「读不到」）。 */
  readonly credentialsAvailable: boolean;
}

/** 一次读取的结果：要么有视图，要么有原因。 */
interface PanelRead {
  readonly view?: PanelView;
  readonly problem?: string;
}

/** 判定普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 取字符串字段（非字符串一律 `undefined`）。 */
function stringOf(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

/** 拆宿主远程调用的信封（裸载荷也认，与 seams 的私有实现同判据）。 */
function unwrapOf(result: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (isRecord(result) && typeof result.ok === "boolean") {
    if (result.ok) return { ok: true, value: result.value };
    const error = result.error;
    return {
      ok: false,
      error: isRecord(error) && typeof error.message === "string" ? error.message : String(error),
    };
  }
  return { ok: true, value: result };
}

/** 从 describe() 的载荷里取行数组（`{ namespaces }` 或裸数组，两种形状都认）。 */
function rowsOf(payload: unknown): RowView[] | undefined {
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.namespaces)
      ? payload.namespaces
      : undefined;
  if (list === undefined) return undefined;
  const rows: RowView[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const name = typeof raw.ns === "string" ? raw.ns : typeof raw.id === "string" ? raw.id : undefined;
    if (name === undefined) continue;
    rows.push({
      row: name,
      ns: typeof raw.ns === "string" ? raw.ns : name,
      value: isRecord(raw.value) ? raw.value : {},
      revision: typeof raw.revision === "number" ? raw.revision : 0,
    });
  }
  return rows;
}

/** 按候选行名取一行（命中即返回，优先级按候选顺序）。 */
function pickRow(rows: readonly RowView[], candidates: readonly string[]): RowView | undefined {
  for (const candidate of candidates) {
    const hit = rows.find((row) => row.ns === candidate || row.row === candidate);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 宿主凭据服务的最小形状（只认本卡片用到的两个方法）。 */
interface RemoteCredentials {
  describe(refs: readonly string[]): Promise<unknown>;
  set(ref: string, value: string): Promise<unknown>;
}

/** `ctx.remote.credentials`：命名空间被武装（嵌套注入）后才有的属性。 */
function credentialsPropertyOf(ctx: ClientSeamContext): unknown {
  try {
    return remoteOf(ctx)?.credentials;
  } catch {
    return undefined;
  }
}

/** `ctx.get("remote.credentials")`：cordis 的「无注入要求」服务读取（宿主自己的卡片就是按这个名字注入的）。 */
function credentialsServiceOf(ctx: ClientSeamContext): unknown {
  try {
    return typeof ctx.get === "function" ? ctx.get("remote.credentials") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 取宿主凭据服务；两条路都试，都拿不到按「读不到」处理（不崩、不假装未配置）。
 *
 * 为什么必须包 try：命名空间没被武装时，宿主代理对未注入的属性**抛错**
 * （`cannot get property "…" without inject`，cordis 的 ReflectService.handler.get）。
 * 一次渲染里抛出会把整页打空 —— 比读不到凭据严重得多，所以这里一律折成 `undefined`。
 * 第二条路是 `ctx.get(name)`（「不需要注入映射」的服务读取），宿主自己的网页搜索卡片也是
 * 靠 `"remote.credentials"` 这个服务名拿到它的。
 * @param ctx - 客户端上下文。
 * @returns 形状认识的凭据服务，或 `undefined`。
 */
function credentialsOf(ctx: ClientSeamContext): RemoteCredentials | undefined {
  for (const candidate of [credentialsPropertyOf(ctx), credentialsServiceOf(ctx)]) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.describe !== "function" || typeof candidate.set !== "function") continue;
    return candidate as unknown as RemoteCredentials;
  }
  return undefined;
}

/** 读几把引用名的配置状态（读不到时 `available: false`，卡片照实说）。 */
async function configuredOf(
  ctx: ClientSeamContext,
  refs: readonly string[],
): Promise<{ available: boolean; configured: Record<string, boolean> }> {
  const credentials = credentialsOf(ctx);
  const wanted = refs.filter((ref) => ref.length > 0);
  if (credentials === undefined) return { available: false, configured: {} };
  if (wanted.length === 0) return { available: true, configured: {} };
  let result: unknown;
  try {
    result = await credentials.describe(wanted);
  } catch {
    return { available: false, configured: {} };
  }
  const unwrapped = unwrapOf(result);
  if (!unwrapped.ok || !isRecord(unwrapped.value)) return { available: false, configured: {} };
  const configured: Record<string, boolean> = {};
  for (const ref of wanted) {
    const view = unwrapped.value[ref];
    configured[ref] = isRecord(view) && view.configured === true;
  }
  return { available: true, configured };
}

/** 我们这一行的值 → 第三方字段草稿。 */
function customDraftOf(ours: RowView | undefined): WebSearchCustomDraft {
  const value = ours?.value;
  return {
    endpoint: stringOf(value, "endpoint") ?? "",
    method: value?.method === "POST" ? "POST" : "GET",
    queryParam: stringOf(value, "queryParam") ?? "q",
    queryField: stringOf(value, "queryField") ?? "query",
    keyField: stringOf(value, "keyField") ?? "",
    resultsPath: stringOf(value, "resultsPath") ?? "",
    authHeader: stringOf(value, "authHeader") ?? "Authorization",
    authScheme: stringOf(value, "authScheme") ?? "Bearer",
  };
}

/** 读一次页面数据（设置文档 + 凭据状态），失败原因翻成人话。 */
async function readPanel(ctx: ClientSeamContext): Promise<PanelRead> {
  const settings = remoteOf(ctx)?.settings;
  if (settings === undefined || typeof settings.describe !== "function") {
    return { problem: "宿主设置服务不可用（ctx.remote.settings 缺席）" };
  }
  let described: unknown;
  try {
    described = await settings.describe();
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
  const unwrapped = unwrapOf(described);
  if (!unwrapped.ok) return { problem: unwrapped.error };
  const rows = rowsOf(unwrapped.value);
  if (rows === undefined) return { problem: "宿主 describe() 返回的形状不认识" };

  const ours = pickRow(rows, OUR_ROWS);
  const web = pickRow(rows, WEB_ROWS);
  const model = pickRow(rows, MODEL_ROWS);
  const providerId = stringOf(model?.value, "provider");
  const modelId = stringOf(model?.value, "model");
  const vendor = providerId === undefined ? undefined : pickRow(rows, VENDOR_ROWS[providerId] ?? []);
  const support = providerId === undefined ? undefined : nativeSearchSupportOf(providerId);
  const route: WebSearchRouteView | undefined =
    providerId === undefined || modelId === undefined
      ? undefined
      : {
          providerId,
          label: support?.label ?? providerId,
          model: modelId,
          supported: support?.supported === true,
          ...(support?.reason === undefined ? {} : { reason: support.reason }),
        };
  const custom = customDraftOf(ours);
  const accountRef = stringOf(vendor?.value, "apiKeyEnv") ?? "";
  const customRef = stringOf(ours?.value, "apiKeyEnv") ?? DEFAULT_SEARCH_KEY_REF;
  const keys = await configuredOf(ctx, [accountRef, customRef]);
  return {
    view: {
      ...(ours === undefined ? {} : { ours }),
      ...(web === undefined ? {} : { web }),
      effective: stringOf(web?.value, "searchProvider"),
      ...(route === undefined ? {} : { route }),
      ...(accountRef.length === 0
        ? {}
        : { accountKey: { ref: accountRef, configured: keys.configured[accountRef] === true } }),
      custom,
      customKey: { ref: customRef, configured: keys.configured[customRef] === true },
      credentialsAvailable: keys.available,
    },
  };
}

/** 按宿主现状推导当前选择（用户的点选会覆盖它）。 */
function choiceOf(view: PanelView): WebSearchChoice {
  const mode: WebSearchChoice = view.ours?.value.mode === "custom" ? "custom" : "account";
  if (view.effective === undefined || view.effective === WEB_SEARCH_PROVIDER_ID) return mode;
  if (DEEPSEEK_PROVIDERS.includes(view.effective)) return "deepseek";
  // 别的插件在生效：按本模块自己的模式显示；「当前生效」那一行会照实说明。
  return mode;
}

/** 切到某个来源的前提没满足时，给出人话原因；`undefined` = 可以切。 */
function blockedReasonOf(
  selected: WebSearchChoice,
  view: PanelView,
  written: WebSearchCustomDraft,
  t: (key: string) => string,
): string | undefined {
  if (selected === "deepseek") return undefined;
  if (selected === "account") {
    if (view.route === undefined) return t("webSearch.blocked.noModel");
    if (!view.route.supported) return view.route.reason ?? t("webSearch.blocked.unsupported");
    if (view.credentialsAvailable && view.accountKey !== undefined && !view.accountKey.configured) {
      return t("webSearch.blocked.noKey").replace("{ref}", view.accountKey.ref);
    }
    return undefined;
  }
  const endpoint = written.endpoint.trim();
  if (endpoint.length === 0 || !URL.canParse(endpoint)) return t("webSearch.blocked.endpoint");
  return undefined;
}

/**
 * 「网页搜索」卡片：读宿主设置与凭据 → 组装卡片 props → 写回。
 *
 * 以自定义 Hook 的形态被页面容器调用（见模块头：独立容器组件过不了迷你夹具）。
 * @param ctx - 客户端上下文。
 * @param t - 取词函数。
 * @returns 卡片元素树。
 */
export function useWebSearchPanel(
  ctx: ClientSeamContext,
  t: (key: string) => string,
  controls?: {
    /** 把内部 `save()` 交给页面容器（设置页底部那一个「保存」按钮调用它）。 */
    saveRef?: { current: (() => Promise<void>) | undefined };
    /** 有无未保存改动（页面容器据此决定是否显示保存条）。 */
    onDirty?: (dirty: boolean) => void;
  },
): ReactElement {
  const [read, setRead] = useState<PanelRead | undefined>(undefined);
  const [choiceDraft, setChoiceDraft] = useState<WebSearchChoice | undefined>(undefined);
  const [fieldDraft, setFieldDraft] = useState<Partial<WebSearchCustomDraft>>({});
  const [keyDraft, setKeyDraft] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = async (): Promise<void> => {
    setRead(await readPanel(ctx));
  };

  useEffect(() => {
    void refresh();
    return subscribeCredentials(ctx, () => {
      void refresh();
    });
    // 依赖只用 ctx：refresh 每次渲染都是新函数，放进依赖会把「读取 → setState → 重渲染 →
    // 读取」变成死循环（refresh 自己读 ctx，行为上仍然跟着 ctx 走）。
  }, [ctx]);

  const titleRow = (): ReactElement => createElement("h2", null, t("webSearch.title"));
  if (read === undefined) {
    return createElement(
      "section",
      { "data-web-search": "true", className: CSS_CLASS.card },
      titleRow(),
      createElement("p", { className: CSS_CLASS.note }, t("webSearch.loading")),
    );
  }
  const view = read.view;
  if (view === undefined) {
    return createElement(
      "section",
      { "data-web-search": "true", className: CSS_CLASS.card },
      titleRow(),
      createElement(
        "p",
        { "data-web-search-problem": "true", className: CSS_CLASS.failure },
        `${t("webSearch.readFailed")}：${read.problem ?? ""}`,
      ),
    );
  }

  const choice = choiceDraft ?? choiceOf(view);
  const custom: WebSearchCustomDraft = { ...view.custom, ...fieldDraft };
  // 有改动才显示「保存搜索设置」：否则设置页里会同时挂着两个「保存」按钮
  // （厂商表单的保存条 + 这张卡的），用户会以为重复了（2026-10-18 报障）。
  const dirty =
    (choiceDraft !== undefined && choiceDraft !== choiceOf(view)) ||
    Object.keys(fieldDraft).length > 0 ||
    keyDraft.trim() !== "";

  const save = async (): Promise<void> => {
    setNotice(undefined);
    setError(undefined);
    try {
      // ① 本模块的设置行：模式与第三方字段。
      if (view.ours === undefined) {
        setError(t("webSearch.rowMissing"));
        return;
      }
      const oursFailure = await saveSettings(ctx, view.ours.row, oursFields(choice, custom), view.ours.revision);
      if (oursFailure !== undefined) {
        setError(oursFailure);
        return;
      }
      // ② 第三方 Key：只在输入框有内容时写（密钥进宿主凭据库，不进设置文档）。
      if (choice === "custom" && keyDraft.trim().length > 0) {
        const credentials = credentialsOf(ctx);
        if (credentials === undefined) {
          setError(t("webSearch.key.unavailable"));
          return;
        }
        let written: unknown;
        try {
          written = await credentials.set(view.customKey.ref, keyDraft.trim());
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          return;
        }
        const unwrapped = unwrapOf(written);
        if (!unwrapped.ok) {
          setError(unwrapped.error);
          return;
        }
      }
      // ③ 宿主 `web` 行：前提满足才切；不满足就照实说（设置已存）。
      const blocked = blockedReasonOf(choice, view, custom, t);
      let switched = false;
      if (blocked !== undefined) {
        setNotice(t("webSearch.blocked").replace("{reason}", blocked));
      } else if (view.web === undefined) {
        setError(t("webSearch.webRowMissing"));
      } else {
        const target = choice === "deepseek" ? "deepseek-official" : WEB_SEARCH_PROVIDER_ID;
        const webFailure = await saveSettings(ctx, view.web.row, [{ key: "searchProvider", value: target }], view.web.revision);
        if (webFailure !== undefined) {
          setError(webFailure);
          return;
        }
        switched = true;
        setNotice(t("webSearch.saved"));
      }
      setFieldDraft({});
      setKeyDraft("");
      if (switched) setChoiceDraft(undefined);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
    }
  };

  // 把保存动作与「脏」状态交给页面容器：设置页只有一个「保存」按钮，
  // 它同时保存厂商字段与这张卡（2026-10-18 用户要求去掉重复的保存按钮）。
  if (controls?.saveRef !== undefined) controls.saveRef.current = save;
  useEffect(() => {
    controls?.onDirty?.(dirty);
  }, [dirty]);

  return createElement(WebSearchCard, {
    t,
    choice,
    effective: view.effective,
    ...(view.route === undefined ? {} : { route: view.route }),
    ...(view.accountKey === undefined ? {} : { accountKey: view.accountKey }),
    custom,
    customKey: view.customKey,
    credentialsAvailable: view.credentialsAvailable,
    ...(view.ours === undefined ? { problem: t("webSearch.rowMissing") } : {}),
    ...(notice === undefined ? {} : { notice }),
    ...(error === undefined ? {} : { error }),
    keyDraft,
    onChoose: (next: WebSearchChoice) => {
      setChoiceDraft(next);
    },
    onCustomField: (field: keyof WebSearchCustomDraft, value: string) => {
      setFieldDraft((previous) => ({ ...previous, [field]: value }));
    },
    onKeyDraft: (value: string) => {
      setKeyDraft(value);
    },
    onSave: () => {
      void save();
    },
  });
}

/** 写进本模块设置行的字段（`choice` 与草稿 → 设置路径值）。 */
function oursFields(
  choice: WebSearchChoice,
  custom: WebSearchCustomDraft,
): { key: string; value: unknown }[] {
  const fields: { key: string; value: unknown }[] = [
    { key: "mode", value: choice === "custom" ? "custom" : "account" },
  ];
  if (choice !== "custom") return fields;
  fields.push(
    { key: "endpoint", value: custom.endpoint.trim() },
    { key: "method", value: custom.method },
    { key: "queryParam", value: custom.queryParam.trim() === "" ? "q" : custom.queryParam.trim() },
    { key: "queryField", value: custom.queryField.trim() === "" ? "query" : custom.queryField.trim() },
    { key: "keyField", value: custom.keyField.trim() },
    { key: "resultsPath", value: custom.resultsPath.trim() },
    { key: "authHeader", value: custom.authHeader.trim() },
    { key: "authScheme", value: custom.authScheme.trim() },
  );
  return fields;
}
