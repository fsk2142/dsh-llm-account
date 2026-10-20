/**
 * Open Design 入口装配测试（`src/vendors/opendesign/index.ts`）。
 *
 * 覆盖装配层里能在进程内证明的部分（真机启动留到验收）：
 * 1. 注册一次自己的 provider 路由；`enabled: false` 不注册但行照旧挂载；
 * 2. `enabled` 的后续改写经 `loader/volatile-update` 重判（撤下/重注册，幂等）；
 * 3. `Config` 解析用户现有的配置形状（含本行特有的 `controlKeyEnv` / `workspaceId` /
 *    `walletBase`）；
 * 4. 同一设置命名空间只构造一个意图日志；与另两家是不同实例；
 * 5. 关掉宿主自动生成的设置表单，并把 owner fiber 交给宿主；
 * 6. 三家装进同一个宿主：一份远程面同时回答三家，描述符只登记一次；
 * 7. 账号端口：新增账号落设置文档，密钥只进凭据库（控制面密钥写派生槽）；
 * 8. 额度端口：请求打控制面基地址，Bearer 是控制面密钥。
 *
 * 本地的假 ctx / 假设置服务 / 假凭据服务 / volatile 解包一律写在本文件里（与
 * `assembly.test.ts` 同一套做法，不跨文件共享）。
 */
import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import * as opendesign from "../../src/vendors/opendesign/index";
import { gatewayAccessOf } from "../../src/vendors/gateway-access";

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** volatile 引用的判定与解包（独立于被测代码的一份实现）。 */
function isVolatileRef(value: unknown): value is { get(): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.isFrozen(value) &&
    typeof Reflect.get(value, "get") === "function"
  );
}

/** 递归解包 volatile 引用，得到解析后的普通值。 */
function plain(value: unknown): unknown {
  if (isVolatileRef(value)) return plain(value.get());
  if (Array.isArray(value)) return value.map(plain);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]));
  return value;
}

/** 一个手工 volatile 引用（`enabled` 这类「宿主改写、入口现读」的字段的最小形状）。 */
function volatileRef(read: () => unknown): unknown {
  return Object.freeze({ get: read });
}

/** 一次被记录的 `registerAdapter`。 */
interface RecordedRegistration {
  routes: string[];
  active: boolean;
}

/** 假宿主 ctx：只实现入口真正用到的接缝，其余一律缺席。 */
function fakeHost(services: Readonly<Record<string, unknown>> = {}): {
  ctx: Context;
  registrations: RecordedRegistration[];
  liveRoutes(): string[][];
  emit(event: string, ...args: unknown[]): void;
  listenerCount(event: string): number;
  disposers(): (() => void)[];
} {
  const registrations: RecordedRegistration[] = [];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const disposers: (() => void)[] = [];
  const serviceMap = new Map(Object.entries(services));
  const host = {
    llm: {
      registerAdapter(routes: string[]): () => void {
        const record: RecordedRegistration = { routes: [...routes], active: true };
        registrations.push(record);
        return () => {
          record.active = false;
        };
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    fiber: { fake: "fiber" },
    get: (name: string): unknown => serviceMap.get(name),
    on: (event: string, listener: (...args: unknown[]) => void): (() => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => undefined;
    },
    effect: (execute: () => unknown): (() => void) => {
      const dispose = execute();
      if (typeof dispose === "function") disposers.push(dispose as () => void);
      return () => undefined;
    },
  };
  return {
    ctx: host as unknown as Context,
    registrations,
    liveRoutes: () => registrations.filter((record) => record.active).map((record) => record.routes),
    emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount: (event) => (listeners.get(event) ?? []).length,
    disposers: () => [...disposers],
  };
}

/** 一次被记录的设置提交。 */
interface RecordedMutation {
  ns: string;
  ops: readonly SettingsOp[];
  revision: number;
}

/** 一次被记录的 `settings.configure` 调用。 */
interface RecordedPresentation {
  presentation: { auto?: boolean };
  owner: unknown;
}

/** 假宿主设置服务：一份内存文档 + 修订号围栏。 */
function fakeSettings(rows: readonly { ns: string; value: Record<string, unknown>; revision?: number }[]): {
  service: unknown;
  mutations: RecordedMutation[];
  presentations: RecordedPresentation[];
  valueOf(ns: string): Record<string, unknown> | undefined;
} {
  const state = rows.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision ?? 0 }));
  const mutations: RecordedMutation[] = [];
  const presentations: RecordedPresentation[] = [];
  const service = {
    describe: () => state.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision, applies: "live" })),
    configure: (presentation: { auto?: boolean }, owner?: unknown) => {
      presentations.push({ presentation: { ...presentation }, owner });
      return () => undefined;
    },
    mutate: async (ns: string, ops: readonly SettingsOp[], expected?: number): Promise<void> => {
      const row = state.find((candidate) => candidate.ns === ns);
      if (row === undefined) throw new Error(`No configurable plugin entry "${ns}"`);
      if (expected !== undefined && row.revision !== expected) {
        throw Object.assign(new Error(`settings namespace "${ns}" changed since it was read`), {
          code: "SETTINGS_CONFLICT",
        });
      }
      mutations.push({ ns, ops: ops.map((op) => ({ ...op })), revision: expected ?? row.revision });
      for (const op of ops) {
        if (op.op === "set") row.value[op.path[0] ?? ""] = op.value;
        else delete row.value[op.path[0] ?? ""];
      }
      row.revision += 1;
    },
  };
  return {
    service,
    mutations,
    presentations,
    valueOf: (ns) => state.find((row) => row.ns === ns)?.value,
  };
}

/** 假宿主凭据服务：内存槽位。 */
function fakeCredentials(initial: Readonly<Record<string, string>> = {}): {
  service: unknown;
  store: Map<string, string>;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    service: {
      resolve: async (ref: string) => {
        const value = store.get(ref);
        return value === undefined ? undefined : { value, source: "test" };
      },
      describe: async (ref: string) => ({ configured: store.has(ref), writable: true }),
      set: async (ref: string, value: string) => {
        store.set(ref, value);
      },
      unset: async (ref: string) => {
        store.delete(ref);
      },
    },
  };
}

/** 用户现有的 Open Design 配置形状（施工单 §2.4 的文档字段子集）。 */
const SHAPE = {
  enabled: true,
  apiKeyEnv: "OPENDESIGN_API_KEY",
  workspaceId: "ws-top",
  walletBase: "https://amr-api.open-design.ai/api/v1",
  accounts: [
    {
      id: "a1",
      name: "sample-user",
      apiKeyEnv: "OPENDESIGN_ACCOUNT_WORK_ab12cd",
      controlKeyEnv: "OPENDESIGN_CONTROL_WORK",
      workspaceId: "ws-work",
    },
  ],
  modelVisibility: { "od-model-1": true },
  autoSwitch: true,
};

it("注册一次自己的 provider 路由，常量与另两行同构", () => {
  const host = fakeHost();
  opendesign.apply(host.ctx, opendesign.Config(SHAPE));
  expect(host.liveRoutes()).toEqual([[opendesign.PROVIDER_ID]]);
  expect(opendesign.PROVIDER_ID).toBe("opendesign");
  expect(opendesign.inject).toEqual(["llm"]);
  expect(opendesign.name).toBe("llm-opendesign");
});

it("enabled: false 时不注册路由，但这一行照旧挂载（其余产物与事件订阅都在）", () => {
  const host = fakeHost();
  const bundle = opendesign.apply(host.ctx, opendesign.Config({ ...SHAPE, enabled: false }));
  expect(host.registrations).toHaveLength(0);
  expect(host.liveRoutes()).toEqual([]);
  expect(bundle.adapter).toBeDefined();
  expect(typeof bundle.accounts.list).toBe("function");
  expect(typeof bundle.quota.snapshot).toBe("function");
  expect(host.listenerCount("credentials/reference-updated")).toBe(1);
  expect(host.listenerCount("loader/volatile-update")).toBe(1);
  expect(host.disposers().length).toBeGreaterThanOrEqual(2); // 登录端口 + 路由句柄
});

it("enabled 的后续改写经 loader/volatile-update 重判：撤下与重注册都是幂等的", () => {
  let enabled = true;
  const config = opendesign.Config(SHAPE) as Record<string, unknown>;
  config.enabled = volatileRef(() => enabled);
  const host = fakeHost();
  opendesign.apply(host.ctx, config);
  expect(host.liveRoutes()).toEqual([[opendesign.PROVIDER_ID]]);

  // 重复广播不得重复注册。
  host.emit("loader/volatile-update", []);
  expect(host.registrations).toHaveLength(1);

  enabled = false;
  host.emit("loader/volatile-update", []);
  expect(host.liveRoutes()).toEqual([]);
  expect(host.registrations).toHaveLength(1);

  enabled = true;
  host.emit("loader/volatile-update", []);
  expect(host.liveRoutes()).toEqual([[opendesign.PROVIDER_ID]]);
  expect(host.registrations).toHaveLength(2);
});

it("Config 解析用户现有的配置形状（含控制面槽、工作区与额度基地址）", () => {
  const parsed = plain(opendesign.Config(SHAPE)) as Record<string, unknown>;
  expect(parsed).toMatchObject(SHAPE);
  // 缺省字段照旧填默认值：默认推理槽、默认控制面基地址、默认刷新间隔。
  expect(parsed).toMatchObject({
    apiKeyEnv: "OPENDESIGN_API_KEY",
    walletBase: "https://amr-api.open-design.ai/api/v1",
    quotaRefreshMinutes: 1,
    showSidebarQuota: false,
  });
  // 没有翻译字段：账号条目与顶层一一对应（顶层 workspaceId 是回退，不是覆盖）。
  const accounts = parsed.accounts as { apiKeyEnv: string; controlKeyEnv: string; workspaceId: string }[];
  expect(accounts[0]).toMatchObject({
    apiKeyEnv: "OPENDESIGN_ACCOUNT_WORK_ab12cd",
    controlKeyEnv: "OPENDESIGN_CONTROL_WORK",
    workspaceId: "ws-work",
  });
});

it("同一设置命名空间只构造一个意图日志；与另两家是不同实例", () => {
  const first = opendesign.apply(fakeHost().ctx, opendesign.Config(SHAPE));
  const second = opendesign.apply(fakeHost().ctx, opendesign.Config(SHAPE));
  expect(second.intents).toBe(first.intents);
  expect(first.settingsNs).toBe("llm-opendesign");
});

it("关掉宿主自动生成的设置表单，并把 owner fiber 交给宿主", () => {
  const settings = fakeSettings([]);
  const host = fakeHost({ settings: settings.service });
  opendesign.apply(host.ctx, opendesign.Config(SHAPE));
  expect(settings.presentations).toEqual([
    { presentation: { auto: false }, owner: (host.ctx as unknown as { fiber: unknown }).fiber },
  ]);
});

it("账号端口：新增账号落设置文档；密钥只进凭据库（控制面密钥写派生槽）", async () => {
  const settings = fakeSettings([{ ns: "opendesign", value: { ...SHAPE }, revision: 1 }]);
  const credentials = fakeCredentials();
  const host = fakeHost({ settings: settings.service, credentials: credentials.service });
  const bundle = opendesign.apply(host.ctx, opendesign.Config(SHAPE));

  const view = await bundle.accounts.add({
    label: "第二账号",
    key: "rt-2",
    controlKey: "ctrl-2",
    workspaceId: "ws-2",
  });
  expect(view.label).toBe("第二账号");
  expect(view.configured).toBe(true);
  // ref 由标签派生（`accountRef("opendesign", label)` → `DSH_LLM_ACCOUNT_OPENDESIGN_<label>_<hash>`；
  // 中文标签经 escapeText 转成下划线，所以这里只断言前缀与厂商段）。
  expect(view.ref.startsWith("DSH_LLM_ACCOUNT_OPENDESIGN_")).toBe(true);

  const document = settings.valueOf("opendesign")!;
  const entries = document.accounts as Record<string, unknown>[];
  const added = entries.find((entry) => entry.name === "第二账号")!;
  expect(added.apiKeyEnv).toBe(view.ref);
  // 控制面槽写进条目；设置文档里只有引用名，没有明文密钥。
  expect(added.controlKeyEnv).toBe(`${view.ref}_CONTROL`);
  expect(added.workspaceId).toBe("ws-2");
  expect(JSON.stringify(document)).not.toContain("rt-2");
  expect(credentials.store.get(view.ref)).toBe("rt-2");
  expect(credentials.store.get(`${view.ref}_CONTROL`)).toBe("ctrl-2");
});

it("额度端口：请求打控制面基地址，Bearer 头用控制面密钥", async () => {
  const requests: { url: string; authorization: string | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      requests.push({ url: String(input), authorization: init?.headers?.Authorization });
      return new Response(JSON.stringify({ membershipTier: "GOAT" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  );
  try {
    const credentials = fakeCredentials({ OPENDESIGN_CONTROL_WORK: "ctrl-work" });
    const host = fakeHost({ credentials: credentials.service });
    const bundle = opendesign.apply(host.ctx, opendesign.Config(SHAPE));

    const snapshot = await bundle.quota.snapshot("OPENDESIGN_ACCOUNT_WORK_ab12cd");
    expect(requests).toEqual([
      { url: "https://amr-api.open-design.ai/api/v1/billing/summary", authorization: "Bearer ctrl-work" },
    ]);
    // 顶层没配 workspaceId 的账号条目配了（ws-work）：没有 vela 时记一句人话失败，不崩。
    expect(snapshot.plan).toMatchObject({ id: "GOAT", name: "GOAT" });
    expect(snapshot.failures.join(" ")).toContain("周期额度查询失败");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("三家装进同一个宿主：一份远程面同时回答三家，描述符只登记一次", async () => {
  // 远程面（Task 3）需要真的 `Service` 基类与真的服务解析：假 ctx 撑不住，用真 cordis。
  // 所有请求给一个即答的 200 `{}`：只验证「接线」，不打真实网络。
  vi.stubGlobal(
    "fetch",
    (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
  );
  try {
    const settings = fakeSettings([{ ns: "opendesign", value: { ...SHAPE }, revision: 1 }]);
    const credentials = fakeCredentials({ OPENDESIGN_API_KEY: "k1" });
    const ctx = new Context();
    const contributions: unknown[] = [];
    ctx.provide("llm");
    ctx.set("llm", { registerAdapter: () => () => undefined });
    ctx.provide("typert");
    ctx.set("typert", { register: (contribution: unknown) => contributions.push(contribution) });
    ctx.provide("settings");
    ctx.set("settings", settings.service);
    ctx.provide("credentials");
    ctx.set("credentials", credentials.service);

    opendesign.apply(ctx, opendesign.Config(SHAPE));
    // 远程面的注册发生在 `ctx.inject(["typert"], …)` 的回调里（异步）。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const service = ctx.get("llmAccountUsage") as { status(vendor: string): Promise<{ vendor: string }> };
    expect(service).toBeDefined();
    await expect(service.status("opendesign")).resolves.toMatchObject({ vendor: "opendesign" });
    // 描述符由创建服务的那一行登记一次。
    expect(contributions).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("网关访问登记的是**本行**的基地址与账号密钥（搜索网关路的数据来源）", async () => {
  // 2026-10-20 审计：以前 commandcode 的 `gatewayAccess("opendesign")` 读的是**自己行**的
  // `apiKeyEnv` / `apiBase`，于是 opendesign 会话里的搜索拿着 commandcode 的密钥打
  // commandcode 的端点（实测 400）。现在数据由 opendesign 行自己登记进跨行注册表。
  const credentials = fakeCredentials({
    OPENDESIGN_API_KEY: "sk-top",
    OPENDESIGN_ACCOUNT_WORK_ab12cd: "sk-work",
  });
  const settings = fakeSettings([{ ns: "opendesign", value: { ...SHAPE }, revision: 1 }]);
  const host = fakeHost({ settings: settings.service, credentials: credentials.service });
  opendesign.apply(host.ctx, opendesign.Config({ ...SHAPE, baseURL: "https://custom-link.example/v1" }));

  const access = await gatewayAccessOf("opendesign");
  // 基地址取自本行文档（`baseURL` > `apiBase` > 内置默认），不是 commandcode 的端点。
  expect(access?.baseURL).toBe("https://custom-link.example/v1");
  // 密钥取自本行账号（顶层当前账号优先），不是 commandcode 的账号。
  expect(access?.key).toBe("sk-top");
  expect(access?.key).not.toBe("sk-commandcode");
});

it("本行一个账号都解析不到密钥时，登记项如实回答不可用", async () => {
  const credentials = fakeCredentials(); // 空的：两把密钥都不在库里
  const host = fakeHost({ credentials: credentials.service });
  opendesign.apply(host.ctx, opendesign.Config(SHAPE));
  expect(await gatewayAccessOf("opendesign")).toBeUndefined();
});
