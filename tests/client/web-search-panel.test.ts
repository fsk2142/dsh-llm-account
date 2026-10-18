/**
 * 「网页搜索」卡片**容器**的接线测试：真的挂载组件（迷你 React 运行时），驱动三条写入路径。
 *
 * 覆盖的行为（此前只有真机能验）：
 * 1. 首读：三选一按宿主现状推导，「当前生效」照实上屏；
 * 2. 选 DeepSeek 官方 → 写宿主 `web` 行的 `searchProvider`；
 * 3. 第三方：地址没填**不切来源**（设置照存）并说明原因；
 * 4. 第三方：地址合法 + 填了 Key → 写宿主凭据 + 切到本插件 provider；
 * 5. 账号模式：厂商不支持 / 密钥缺失都不切来源，原因说人话；
 * 6. 读取失败时显示原因，不假装可用；
 * 7. 凭据更新事件后重读（徽标从「未配置」变成「已配置」）。
 */
import { afterEach, expect, it, vi } from "vitest";

import type { ClientSeamContext } from "../../src/client/seams";
import {
  findSim,
  fireSim,
  installMiniReact,
  settleSim,
  textsOfSim,
  type MiniReact,
} from "../support/container-sim";

vi.mock("react", async () => {
  const stub = await import("../support/react-stub");
  const mini = installMiniReact();
  return {
    createElement: stub.createElement,
    Fragment: stub.Fragment,
    useState: mini.useState,
    useEffect: mini.useEffect,
    useRef: mini.useRef,
    __mini: mini,
  };
});

/** 取迷你运行时（`vi.mock` 把它挂在 react 上导出）。 */
async function runtime(): Promise<MiniReact> {
  return ((await import("react")) as unknown as { __mini: MiniReact }).__mini;
}

afterEach(async () => {
  (await runtime()).reset();
});

/** 文案替身：只给少数结构性键真文案（要断言的替换占位），其余原样返回 key。 */
function translator(): (key: string) => string {
  const table: Record<string, string> = {
    "webSearch.blocked": "未切换：{reason}",
    "webSearch.blocked.noKey": "账号密钥没配置（{ref}）",
    "webSearch.saved": "已保存并切换",
  };
  return (key) => table[key] ?? key;
}

/** 一次 `mutate` 的记录。 */
interface WriteRecord {
  readonly row: string;
  readonly ops: readonly { readonly op: string; readonly path: readonly string[]; readonly value: unknown }[];
  readonly revision: number | undefined;
}

/** 一行设置（假宿主里可变）。 */
interface RowSeed {
  readonly ns: string;
  value: Record<string, unknown>;
  revision: number;
}

/** 假的客户端上下文：设置行与凭据状态都可读写、可断言。 */
interface FakeHost {
  readonly ctx: ClientSeamContext;
  readonly writes: WriteRecord[];
  readonly credentialWrites: { ref: string; value: string }[];
  readonly rows: RowSeed[];
  setConfigured(ref: string, value: boolean): void;
  /** 触发 `credentials/reference-updated`（面板应据此重读）。 */
  emitCredentialsUpdated(): void;
  /** 让 `describe()` 直接失败（读取失败的用例）。 */
  breakDescribe(error: string): void;
}

/**
 * 凭据服务在这个假宿主上「怎么可达」——对应三种真实形态：
 * - `property`：命名空间已武装，`ctx.remote.credentials` 直接可读；
 * - `property-throws`：属性访问会让宿主代理抛 `cannot get property … without inject`，
 *   只能走 `ctx.get("remote.credentials")`；
 * - `none`：两条路都拿不到（卡片必须照实说「读不到」而不是「未配置」）。
 */
type CredentialsAccess = "property" | "property-throws" | "none";

/** 默认的设置文档：本模块行 + 宿主 web 行 + 默认模型行 + Command Code 行。 */
function defaultRows(): RowSeed[] {
  return [
    {
      ns: "llm-account-web-search",
      value: {
        mode: "account",
        endpoint: "",
        method: "GET",
        queryParam: "q",
        queryField: "query",
        keyField: "",
        resultsPath: "",
        apiKeyEnv: "LLM_ACCOUNT_SEARCH_KEY",
        authHeader: "Authorization",
        authScheme: "Bearer",
      },
      revision: 3,
    },
    { ns: "web", value: {}, revision: 7 },
    { ns: "agent-default-model", value: { provider: "commandcode", model: "deepseek/deepseek-v4.1-flash" }, revision: 1 },
    { ns: "llm-commandcode", value: { apiKeyEnv: "COMMANDCODE_API_KEY" }, revision: 2 },
  ];
}

/** 造一个假宿主。 */
function fakeHost(options: { rows?: RowSeed[]; configured?: Record<string, boolean>; credentialsAccess?: CredentialsAccess } = {}): FakeHost {
  const rows: RowSeed[] = (options.rows ?? defaultRows()).map((row) => ({ ...row, value: { ...row.value } }));
  const configured: Record<string, boolean> = { ...(options.configured ?? { COMMANDCODE_API_KEY: true }) };
  const writes: WriteRecord[] = [];
  const credentialWrites: { ref: string; value: string }[] = [];
  const listeners: (() => void)[] = [];
  let describeError: string | undefined;
  const access = options.credentialsAccess ?? "property";

  const settings = {
    describe: (): Promise<unknown> => {
      if (describeError !== undefined) return Promise.resolve({ ok: false, error: describeError });
      return Promise.resolve({
        ok: true,
        value: {
          writable: true,
          hasDocument: true,
          namespaces: rows.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision })),
        },
      });
    },
    mutate: (
      ns: string,
      ops: readonly { op: "set"; path: readonly string[]; value: unknown }[],
      revision?: number,
    ): Promise<unknown> => {
      writes.push({ row: ns, ops, revision });
      const row = rows.find((candidate) => candidate.ns === ns);
      if (row === undefined) return Promise.resolve({ ok: false, error: `no row ${ns}` });
      for (const op of ops) row.value[op.path[0] ?? ""] = op.value;
      row.revision += 1;
      return Promise.resolve({ ok: true });
    },
  };

  const credentials = {
    describe: (refs: readonly string[]): Promise<unknown> =>
      Promise.resolve({
        ok: true,
        value: Object.fromEntries(refs.map((ref) => [ref, { configured: configured[ref] === true }])),
      }),
    set: (ref: string, value: string): Promise<unknown> => {
      credentialWrites.push({ ref, value });
      configured[ref] = true;
      return Promise.resolve({ ok: true });
    },
  };

  const remote: Record<string, unknown> = {
    settings,
    $on: (event: string, listener: () => void): (() => void) => {
      if (event === "credentials/reference-updated") listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
  if (access === "property") remote.credentials = credentials;
  if (access === "property-throws") {
    Object.defineProperty(remote, "credentials", {
      get(): never {
        throw new Error('cannot get property "credentials" without inject');
      },
    });
  }

  const ctx = {
    remote,
    get: (name: string): unknown =>
      name === "remote.credentials" && access === "property-throws" ? credentials : undefined,
  } as unknown as ClientSeamContext;

  return {
    ctx,
    writes,
    credentialWrites,
    rows,
    setConfigured: (ref, value) => {
      configured[ref] = value;
    },
    emitCredentialsUpdated: () => {
      for (const listener of [...listeners]) listener();
    },
    breakDescribe: (error) => {
      describeError = error;
    },
  };
}

/** 挂载面板并排空异步。 */
async function mountPanel(host: FakeHost): Promise<{ tree(): unknown }> {
  const mini = await runtime();
  const { useWebSearchPanel } = await import("../../src/client/web-search-panel");
  const mounted = mini.mount(() => useWebSearchPanel(host.ctx, translator()));
  await settleSim(mini);
  return { tree: () => mounted.tree() };
}

/** 走一遍「点选 + 点保存」并排空。 */
async function chooseAndSave(panel: { tree(): unknown }, choice: string): Promise<void> {
  const mini = await runtime();
  fireSim(findSim(panel.tree(), "data-web-search-radio", choice), "onChange");
  await settleSim(mini);
  fireSim(findSim(panel.tree(), "data-web-search-save"), "onClick");
  await settleSim(mini);
}

/** 某个行名上的写入。 */
function writesTo(host: FakeHost, row: string): WriteRecord[] {
  return host.writes.filter((write) => write.row === row);
}

it("首读：三选一按宿主现状推导，「当前生效」照实上屏", async () => {
  const host = fakeHost();
  const panel = await mountPanel(host);
  expect(findSim(panel.tree(), "data-web-search-radio", "account")?.props.checked).toBe(true);
  expect(findSim(panel.tree(), "data-web-search-effective")?.props["data-web-search-effective"]).toBe("none");
  // 账号行支持原生搜索：卡片显示「跟随 Command Code」与密钥已配置。
  expect(findSim(panel.tree(), "data-web-search-route", "commandcode")).toBeDefined();
  expect(findSim(panel.tree(), "data-web-search-supported")?.props["data-web-search-supported"]).toBe("true");
  expect(findSim(panel.tree(), "data-web-search-account-key", "configured")).toBeDefined();
});

it("选 DeepSeek 官方 → 保存：写宿主 web 行的 searchProvider，不碰凭据", async () => {
  const host = fakeHost();
  const panel = await mountPanel(host);
  await chooseAndSave(panel, "deepseek");

  expect(host.credentialWrites).toHaveLength(0);
  const web = writesTo(host, "web");
  expect(web).toHaveLength(1);
  expect(web[0]?.ops).toEqual([{ op: "set", path: ["searchProvider"], value: "deepseek-official" }]);
  expect(web[0]?.revision).toBe(7);
  expect(textsOfSim(panel.tree())).toContain("已保存并切换");
});

it("第三方：地址没填 → 只存设置、不切来源，并说明原因", async () => {
  const host = fakeHost();
  const panel = await mountPanel(host);
  await chooseAndSave(panel, "custom");

  const ours = writesTo(host, "llm-account-web-search");
  expect(ours).toHaveLength(1);
  expect(ours[0]?.ops[0]).toEqual({ op: "set", path: ["mode"], value: "custom" });
  expect(writesTo(host, "web")).toHaveLength(0);
  const notice = textsOfSim(panel.tree()).find((text) => text.includes("未切换"));
  expect(notice).toContain("webSearch.blocked.endpoint");
});

it("第三方：地址合法 + 填了 Key → 写凭据、切到本插件 provider", async () => {
  const host = fakeHost();
  const panel = await mountPanel(host);
  const mini = await runtime();
  fireSim(findSim(panel.tree(), "data-web-search-radio", "custom"), "onChange");
  await settleSim(mini);
  fireSim(findSim(panel.tree(), "data-web-search-field", "endpoint"), "onChange", {
    target: { value: "https://search.example/api" },
  });
  fireSim(findSim(panel.tree(), "data-web-search-key"), "onChange", { target: { value: "sk-1" } });
  await settleSim(mini);
  fireSim(findSim(panel.tree(), "data-web-search-save"), "onClick");
  await settleSim(mini);

  const ours = writesTo(host, "llm-account-web-search");
  expect(ours).toHaveLength(1);
  const ops = ours[0]?.ops ?? [];
  expect(ops.find((op) => op.path[0] === "endpoint")?.value).toBe("https://search.example/api");
  expect(host.credentialWrites).toEqual([{ ref: "LLM_ACCOUNT_SEARCH_KEY", value: "sk-1" }]);
  const web = writesTo(host, "web");
  expect(web).toHaveLength(1);
  expect(web[0]?.ops).toEqual([{ op: "set", path: ["searchProvider"], value: "llm-account-web" }]);
  expect(textsOfSim(panel.tree())).toContain("已保存并切换");
  // 保存后 Key 徽标立刻变成「已配置」。
  expect(findSim(panel.tree(), "data-web-search-key-status", "configured")).toBeDefined();
});

it("账号模式：厂商不支持原生搜索 → 不切来源，原因带上网关协议事实", async () => {
  const rows = defaultRows().filter((row) => row.ns !== "agent-default-model" && row.ns !== "llm-commandcode");
  rows.push(
    { ns: "agent-default-model", value: { provider: "dsh-opencode-go", model: "m" }, revision: 1 },
    { ns: "llm-opencode-go", value: { apiKeyEnv: "OPENCODE_KEY" }, revision: 2 },
  );
  const host = fakeHost({ rows, configured: { OPENCODE_KEY: true } });
  const panel = await mountPanel(host);
  await chooseAndSave(panel, "account");

  expect(writesTo(host, "web")).toHaveLength(0);
  const notice = textsOfSim(panel.tree()).find((text) => text.includes("未切换"));
  expect(notice).toContain("OpenAI Chat Completions");
});

it("账号模式：密钥缺失 → 不切来源，并说明缺哪把引用", async () => {
  const host = fakeHost({ configured: {} });
  const panel = await mountPanel(host);
  await chooseAndSave(panel, "account");

  expect(writesTo(host, "web")).toHaveLength(0);
  const notice = textsOfSim(panel.tree()).find((text) => text.includes("未切换"));
  expect(notice).toContain("COMMANDCODE_API_KEY");
});

it("读取失败：显示原因，不假装可用", async () => {
  const host = fakeHost();
  host.breakDescribe("boom: settings service offline");
  const panel = await mountPanel(host);
  const problem = findSim(panel.tree(), "data-web-search-problem");
  expect(problem).toBeDefined();
  expect(textsOfSim(panel.tree()).some((text) => text.includes("boom: settings service offline"))).toBe(true);
});

it("凭据更新事件后重读：徽标从「未配置」变成「已配置」", async () => {
  const host = fakeHost({ configured: {} });
  const panel = await mountPanel(host);
  expect(findSim(panel.tree(), "data-web-search-account-key", "missing")).toBeDefined();

  host.setConfigured("COMMANDCODE_API_KEY", true);
  host.emitCredentialsUpdated();
  await settleSim(await runtime());

  expect(findSim(panel.tree(), "data-web-search-account-key", "configured")).toBeDefined();
});

it("凭据服务：属性访问抛错时回落到 ctx.get(\"remote.credentials\")，Key 依然读得到、写得进", async () => {
  const host = fakeHost({ credentialsAccess: "property-throws" });
  const panel = await mountPanel(host);
  // 属性路抛错（宿主代理 `cannot get property … without inject`），但服务路命中：
  // 徽标照常读到「已配置」；只走属性路会显示「读不到」。
  expect(findSim(panel.tree(), "data-web-search-account-key", "configured")).toBeDefined();

  const mini = await runtime();
  fireSim(findSim(panel.tree(), "data-web-search-radio", "custom"), "onChange");
  await settleSim(mini);
  fireSim(findSim(panel.tree(), "data-web-search-field", "endpoint"), "onChange", {
    target: { value: "https://search.example/api" },
  });
  fireSim(findSim(panel.tree(), "data-web-search-key"), "onChange", { target: { value: "sk-get" } });
  await settleSim(mini);
  fireSim(findSim(panel.tree(), "data-web-search-save"), "onClick");
  await settleSim(mini);

  expect(host.credentialWrites).toEqual([{ ref: "LLM_ACCOUNT_SEARCH_KEY", value: "sk-get" }]);
  expect(writesTo(host, "web")).toHaveLength(1);
});

it("凭据服务两条路都拿不到：不崩、不说「未配置」，也不阻止切换", async () => {
  const host = fakeHost({ credentialsAccess: "none" });
  const panel = await mountPanel(host);
  // 第三种说法：读不到 ≠ 未配置。
  expect(findSim(panel.tree(), "data-web-search-account-key", "unreadable")).toBeDefined();
  expect(textsOfSim(panel.tree())).toContain("webSearch.key.unreadable");

  // 读不到就不假装知道密钥在不在，也不拿它当拦路理由；宿主搜索时会给出可操作的错误。
  await chooseAndSave(panel, "account");
  expect(writesTo(host, "web")).toHaveLength(1);
  expect(textsOfSim(panel.tree())).toContain("已保存并切换");
});
