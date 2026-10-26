/**
 * Task 14 测试：两行装配的**假 ctx** 冒烟（不启动宿主）。
 *
 * 本机没有与桌面端同版本（`0.2.0-rc.2`）的 `dsh` CLI，所以真机启动留到计划 1c。本文件
 * 覆盖装配层里能在进程内证明的部分：
 *
 * 1. 两个入口各注册一次自己的 provider 路由；
 * 2. 两个 `Config` 能解析用户**现有**的 profile config 形状，且字段值原样保留；
 * 3. 一个设置命名空间只构造一个 `IntentLog`（Task 8 的文档化前置条件）；
 * 4. 凭据变更事件会清除该账号的 `invalid-credential` 标记；
 * 5. opencode 的固定命名空间（`llm-opencode-go`）在宿主上解析到 profile 行 id
 *    （`opencode-go`）——读写都落在行 id 上；
 * 6. opencode 的 `enabled` 开关真的管住路由：`false` 不注册（用户现有 profile 行就是
 *    `enabled: false`）、`true` 注册一次、之后的改写经 `loader/volatile-update` 重判并能撤下
 *    （旧插件「false withdraws the route; the plugin stays mounted」的语义）。
 *
 * 本地的假 ctx / 假设置服务 / 假凭据服务 / volatile 解包一律写在本文件里，不跨任务共享
 * （计划 Review Focus 前的说明）。
 */
import { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { afterEach, expect, it, vi } from "vitest";

import type { AccountView, SettingsOp } from "../../src/core/adapter";
import { resetCatalogSources } from "../../src/vendors/model-catalog-registry";
import * as commandcode from "../../src/vendors/commandcode/index";
import * as opencode from "../../src/vendors/opencode/index";
import * as opendesign from "../../src/vendors/opendesign/index";

/**
 * 每个用例后清掉**跨厂商模型注册表**。
 *
 * 它是模块级单例（三条 provider 行在同一个进程里共享），而 `apply()` 会往里登记目录读口。
 * 不复位的话，前一个用例登记过的「会返回模型的假目录」会漏到后一个用例里，让后者意外走进
 * 「限额换模型」分支（实测：`gateway.keys` 里多出一个空 key）。
 */
afterEach(() => {
  resetCatalogSources();
});

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * volatile 引用的判定与解包（独立于被测代码的一份实现：测试必须自己认得出解析产物，
 * 否则「字段值原样保留」会连同实现里的错误一起被放过）。
 */
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

/** 一次被记录的 `registerAdapter`（`replace` 只用来满足返回句柄的形状）。 */
interface RecordedRegistration {
  routes: string[];
  adapter: unknown;
  /** 注册句柄被调用（撤下路由）后置为 `false`；记录本身保留，便于断言「注册了几次」。 */
  active: boolean;
}

/** 一个手工 volatile 引用（`enabled` 这类「宿主改写、入口现读」的字段的最小形状）。 */
function volatileRef(read: () => unknown): unknown {
  return Object.freeze({ get: read });
}

/** 假宿主 ctx：只实现入口真正用到的接缝，其余一律缺席。 */
interface FakeHost {
  ctx: Context;
  registrations: RecordedRegistration[];
  /** 当前仍然生效的路由集合（撤下的注册不计入）。 */
  liveRoutes(): string[][];
  /** 把一个事件投给假 ctx 上登记的监听器（宿主 `emit` 的最小替身）。 */
  emit(event: string, ...args: unknown[]): void;
  /** 某个事件当前登记了几个监听器。 */
  listenerCount(event: string): number;
  /** `effect` 里登记的资源释放器（宿主卸载时才会调用，测试只看有没有登记）。 */
  disposers(): (() => void)[];
}

/**
 * 造一个假宿主 ctx。
 * @param services - `ctx.get(name)` 能读到的服务（缺省：一个服务都没有，模拟接缝缺席）。
 * @returns 假 ctx 与观察窗口。
 */
function fakeHost(services: Readonly<Record<string, unknown>> = {}): FakeHost {
  const registrations: RecordedRegistration[] = [];
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const disposers: (() => void)[] = [];
  const serviceMap = new Map(Object.entries(services));
  const host = {
    llm: {
      registerAdapter(routes: string[], adapter: unknown): (() => void) & { replace: (next: string[]) => void } {
        const record: RecordedRegistration = { routes: [...routes], adapter, active: true };
        registrations.push(record);
        const handle = (() => {
          record.active = false;
        }) as (() => void) & { replace: (next: string[]) => void };
        handle.replace = () => undefined;
        return handle;
      },
    },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    /** `ctx.fiber`：`settings.configure` 的 owner 参数（Task 3 会传它，这里要能断言到）。 */
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

/** 一次被记录的 `settings.configure` 调用（Task 3：关掉宿主自动生成的设置表单）。 */
interface RecordedPresentation {
  presentation: { auto?: boolean };
  owner: unknown;
}

/** 假宿主设置服务：一份内存文档 + 修订号围栏，各行的文档内容与 `describe()` 一一对应。 */
interface FakeSettings {
  service: unknown;
  mutations: RecordedMutation[];
  /** 每次 `configure` 的参数（`auto: false` 与 owner fiber）。 */
  presentations: RecordedPresentation[];
  valueOf(ns: string): Record<string, unknown> | undefined;
}

/**
 * 造一个假设置服务：只支持顶层 path op（本项目的端口只写顶层字段）。
 * @param rows - 命名空间、文档内容与初始修订号。
 * @returns 假设置服务与观察窗口。
 */
function fakeSettings(rows: readonly { ns: string; value: Record<string, unknown>; revision?: number }[]): FakeSettings {
  const state = rows.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision ?? 0 }));
  const mutations: RecordedMutation[] = [];
  const presentations: RecordedPresentation[] = [];
  const service = {
    describe: () =>
      state.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision, applies: "live", autoGenerate: false })),
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

/** 假宿主凭据服务：内存槽位 + 写入记录。 */
function fakeCredentials(initial: Readonly<Record<string, string>> = {}): { service: unknown; store: Map<string, string> } {
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

/**
 * 一个**真** cordis `Context` 的宿主。
 *
 * 远程面（Task 3）需要真的 `Service` 基类与真的服务解析（`ctx.get` 只会向上找、`Service` 实例
 * 对外是代理），假 ctx 撑不住这些语义。只提供入口真正用到的服务；`ctx.fiber`/`ctx.logger`
 * 由 cordis 自己给。
 * @param services - 额外要提供的服务（设置、凭据等）。
 * @returns 真 ctx 与观察窗口。
 */
function realHost(services: Readonly<Record<string, unknown>> = {}): {
  ctx: Context;
  typert: { contributions: unknown[] };
  routes: string[][];
} {
  const ctx = new Context();
  const typert = { contributions: [] as unknown[] };
  const routes: string[][] = [];
  const provided: Record<string, unknown> = {
    llm: {
      registerAdapter: (list: string[]) => {
        routes.push([...list]);
        return () => undefined;
      },
    },
    typert: {
      register: (contribution: unknown) => {
        typert.contributions.push(contribution);
        return () => Promise.resolve();
      },
    },
    ...services,
  };
  for (const [key, value] of Object.entries(provided)) {
    // cordis 4：`set` 之前必须先 `provide`（重复 provide 会抛，所以只在需要时补一次）。
    try {
      ctx.provide(key);
    } catch {
      // 已经提供过：直接用现有声明。
    }
    ctx.set(key, value);
  }
  return { ctx, typert, routes };
}

/** 把若干 Anthropic Messages 事件拼成一段 SSE 正文（与 `tests/vendors/opencode.test.ts` 同一形状）。 */
function anthropicSse(frames: readonly (readonly [string, unknown])[]): string {
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** 一次干净的文本回复（"hello"）：适配器会跑完整个流，走「成功」那一支。 */
const TEXT_FRAMES: readonly (readonly [string, unknown])[] = [
  [
    "message_start",
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "m1",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 1 },
      },
    },
  ],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
  ],
  ["message_stop", { type: "message_stop" }],
];

/** 用户现有的 commandcode 配置形状（逐字来自 task-14-brief 与 profile patch 第 29-41 行）。 */
const COMMAND_CODE_SHAPE = {
  apiKeyEnv: "COMMANDCODE_API_KEY",
  visibleModels: ["deepseek/deepseek-v4.1-flash"],
  modelVisibility: {},
  showSidebarQuota: true,
  accounts: [{ label: "sample-user-2", apiKeyEnv: "COMMANDCODE_API_KEY_2" }],
  activeAccount: "default",
  modelAccountRules: [],
  switchStrategy: "order",
};

/** 用户现有的 opencode 配置形状（task-14-brief；profile patch 第 117-153 行的子集）。 */
const OPENCODE_SHAPE = {
  usageDisplay: "always" as const,
  modelVisibility: { "space-bunny": true },
  autoSwitch: true,
  enabled: false,
};

it("两个入口各注册一次自己的 provider 路由", () => {
  const commandCodeHost = fakeHost();
  commandcode.apply(commandCodeHost.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  expect(commandCodeHost.registrations.map((registration) => registration.routes)).toEqual([[commandcode.PROVIDER_ID]]);
  expect(commandcode.PROVIDER_ID).toBe("commandcode");
  expect(commandcode.inject).toEqual(["llm"]);
  expect(commandcode.name).toBe("llm-commandcode");

  const opencodeHost = fakeHost();
  // 用户现有的这一行是 `enabled: false`（见下一条测试），注册行为在这里用启用态单独断言。
  opencode.apply(opencodeHost.ctx, opencode.Config({ ...OPENCODE_SHAPE, enabled: true }));
  expect(opencodeHost.registrations.map((registration) => registration.routes)).toEqual([[opencode.PROVIDER_ID]]);
  expect(opencode.PROVIDER_ID).toBe("dsh-opencode-go");
  expect(opencode.inject).toEqual(["llm"]);
  expect(opencode.name).toBe("llm-opencode-go");
});

it("**commandcode 的 enabled 同样管住路由**（三行对称，2026-10-20 复审）", () => {
  // 复审判定：opencode / opendesign 早就有这个门，唯独 commandcode 无条件注册 ——
  // 用户手改 profile 把它配成 `enabled: false` 不会生效（另外两家会）。
  const disabledHost = fakeHost();
  commandcode.apply(disabledHost.ctx, commandcode.Config({ ...COMMAND_CODE_SHAPE, enabled: false }));
  expect(disabledHost.registrations, "enabled: false 时不许注册路由").toHaveLength(0);
  expect(disabledHost.liveRoutes()).toEqual([]);
  // 行本身仍挂载：凭据订阅与 volatile 重判都还在。
  expect(disabledHost.listenerCount("credentials/reference-updated")).toBe(1);

  const enabledHost = fakeHost();
  commandcode.apply(enabledHost.ctx, commandcode.Config({ ...COMMAND_CODE_SHAPE, enabled: true }));
  expect(enabledHost.liveRoutes()).toEqual([[commandcode.PROVIDER_ID]]);
});

it("**缺省（没写 enabled）按启用处理**，不会把老用户的命令行悄悄关掉", () => {
  // 兼容性：存量 profile 里没有这个字段，缺省必须是启用。字段默认值是 `true`。
  const host = fakeHost();
  commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  expect(host.liveRoutes()).toEqual([[commandcode.PROVIDER_ID]]);
});

it("opencode 的 enabled 为 false 时不注册路由，为 true 时注册一次", () => {
  const disabledHost = fakeHost();
  const disabled = opencode.apply(disabledHost.ctx, opencode.Config(OPENCODE_SHAPE));
  // 用户 profile 里的这一行就是 `enabled: false`：路由与它的模型都不许上线。
  expect(disabledHost.registrations).toHaveLength(0);
  expect(disabledHost.liveRoutes()).toEqual([]);
  // 「the plugin stays mounted」：其余产物照旧构造，凭据事件照旧订阅，改写仍需重判。
  expect(disabled.adapter).toBeDefined();
  expect(typeof disabled.accounts.list).toBe("function");
  expect(typeof disabled.quota.snapshot).toBe("function");
  expect(disabledHost.listenerCount("credentials/reference-updated")).toBe(1);
  expect(disabledHost.listenerCount("loader/volatile-update")).toBe(1);

  const enabledHost = fakeHost();
  opencode.apply(enabledHost.ctx, opencode.Config({ ...OPENCODE_SHAPE, enabled: true }));
  expect(enabledHost.liveRoutes()).toEqual([[opencode.PROVIDER_ID]]);
});

it("opencode 的 enabled 改成 false 会撤下已注册的路由", () => {
  let enabled = true;
  // 已解析的配置 + 一个可控的 volatile `enabled`：宿主改写后入口必须**现读**（volatile 变更
  // 不会重跑 `apply`，所以只有经 `loader/volatile-update` 重判才能撤下路由）。
  const config = opencode.Config(OPENCODE_SHAPE) as Record<string, unknown>;
  config.enabled = volatileRef(() => enabled);
  const host = fakeHost();
  const bundle = opencode.apply(host.ctx, config);
  expect(host.liveRoutes()).toEqual([[opencode.PROVIDER_ID]]);
  expect(host.listenerCount("loader/volatile-update")).toBe(1);

  // 重复广播不得重复注册（重判是幂等的）。
  host.emit("loader/volatile-update", []);
  expect(host.registrations).toHaveLength(1);
  expect(host.liveRoutes()).toEqual([[opencode.PROVIDER_ID]]);

  enabled = false;
  host.emit("loader/volatile-update", []);
  // 撤下：注册句柄被释放（路由与其模型目录随之消失），但这一行与其余产物留着。
  expect(host.liveRoutes()).toEqual([]);
  expect(host.registrations).toHaveLength(1);
  expect(bundle.adapter).toBeDefined();
  expect(host.listenerCount("credentials/reference-updated")).toBe(1);

  // 再打开：重新注册一次（与旧插件 `applyRoute` 的释放/重注册同一行为）。
  enabled = true;
  host.emit("loader/volatile-update", []);
  expect(host.liveRoutes()).toEqual([[opencode.PROVIDER_ID]]);
  expect(host.registrations).toHaveLength(2);
});

it("Config 能解析用户现有的 commandcode 配置形状", () => {
  const parsed = plain(commandcode.Config(COMMAND_CODE_SHAPE));
  expect(parsed).toMatchObject(COMMAND_CODE_SHAPE);
  // 缺省字段照旧填默认值，不把用户没写的字段变成 `undefined` 以外的怪形状。
  expect(parsed).toMatchObject({ apiKeyEnv: "COMMANDCODE_API_KEY" });
});

it("Config 能解析用户现有的 opencode 配置形状", () => {
  const parsed = plain(opencode.Config(OPENCODE_SHAPE));
  expect(parsed).toMatchObject(OPENCODE_SHAPE);
  expect(parsed).toMatchObject({ apiKeyEnv: "OPENCODE_API_KEY" });
});

it("同一设置命名空间只构造一个意图日志", () => {
  const first = commandcode.apply(fakeHost().ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  const second = commandcode.apply(fakeHost().ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  // 一份存储只配一个实例：否则两个实例各自「读全量 → 改全量 → 写全量」会互相覆盖。
  expect(second.intents).toBe(first.intents);
  expect(first.settingsNs).toBe("llm-commandcode");

  // 登记表按命名空间分槽：另一条路由拿到的是另一个实例。
  const other = opencode.apply(fakeHost().ctx, opencode.Config(OPENCODE_SHAPE));
  expect(other.intents).not.toBe(first.intents);
  expect(other.settingsNs).toBe("llm-opencode-go");
});

it("凭据变更后清除该账号的失效标记", () => {
  const host = fakeHost();
  const bundle = commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  expect(host.listenerCount("credentials/reference-updated")).toBe(1);

  const ref = "COMMANDCODE_API_KEY_2";
  const engine = bundle.rotation.current();
  engine.markRejected(ref, { kind: "invalid-credential", message: "no usable key" });
  expect(engine.rejections().has(ref)).toBe(true);

  host.emit("credentials/reference-updated", ref);
  // 用户补上密钥后这个账号必须能重新参与轮换（Ruling 23）。
  expect(bundle.rotation.current().rejections().has(ref)).toBe(false);
});

it("账号库状态变化重建引擎时，生效账号与切换记录一起搬迁（Task 2 的观测状态必须活过重建）", () => {
  // 入口现读的文档是**插件配置**（真实宿主里它是 volatile 引用，设置改写后会被换成新值）。
  // 假宿主没有那条链路，所以这里直接把顶层 `apiKeyEnv` 做成 volatile 引用，模拟「用户换了当前账号」。
  let active = "OPENCODE_API_KEY";
  const config = opencode.Config({
    ...OPENCODE_SHAPE,
    accounts: [{ id: "work", name: "work", apiKeyEnv: "OPENCODE_API_KEY_2" }],
  }) as Record<string, unknown>;
  config.apiKeyEnv = volatileRef(() => active);

  const host = fakeHost();
  const bundle = opencode.apply(host.ctx, config);

  // 造出「生效账号 + 一条切换记录」：选中当前账号 → 按额度拒绝 → 换到另一个账号。
  const before = bundle.rotation.current();
  expect(before.pick({ model: "m1", tried: new Set() })).toBe("OPENCODE_API_KEY");
  before.markRejected("OPENCODE_API_KEY", { kind: "quota", message: "exhausted" });
  expect(before.pick({ model: "m1", tried: new Set(["OPENCODE_API_KEY"]) })).toBe("OPENCODE_API_KEY_2");
  expect(before.effectiveAccount()?.ref).toBe("OPENCODE_API_KEY_2");
  expect(before.switchNotices()).toHaveLength(1);

  // 账号库状态变了（这里体现为顶层当前账号改写）→ 装配层重建引擎。
  active = "OPENCODE_API_KEY_2";
  const after = bundle.rotation.current();
  expect(after).not.toBe(before); // 前提：确实换了一台引擎，否则这条测试什么都没证明

  // 既有行为不许回归：拒绝记录照旧搬迁。
  expect(after.rejections().has("OPENCODE_API_KEY")).toBe(true);
  // 新增行为：不搬观测状态的话，用户一改设置卡片就会显示「没有生效账号」。
  expect(after.effectiveAccount()).toEqual(before.effectiveAccount());
  expect(after.switchNotices()).toEqual(before.switchNotices());
});

it("两个入口都关掉宿主自动生成的设置表单，并把 owner fiber 交给宿主", () => {
  for (const entry of [commandcode, opencode] as const) {
    const settings = fakeSettings([]);
    const host = fakeHost({ settings: settings.service });
    const shape = entry === commandcode ? COMMAND_CODE_SHAPE : OPENCODE_SHAPE;
    entry.apply(host.ctx, entry.Config(shape));
    expect(settings.presentations).toEqual([{ presentation: { auto: false }, owner: (host.ctx as unknown as { fiber: unknown }).fiber }]);
  }
});

it("两个入口装进同一个宿主：一份远程面同时回答两家，描述符只登记一次（Task 3 接线）", async () => {
  // `status()` 会经两家**真额度端口**读一次用量 —— 不打桩就会打真实网络（谁家端点慢就随超时），
  // 本机对那两个 API 主机的连通性不稳定，这条测试因此会随机 5s 超时（2026-10-17 实测：
  // 未打桩时约一半跑次超时，与代码无关）。给所有请求一个即答的 200 `{}`：只验证「接线」。
  vi.stubGlobal(
    "fetch",
    (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
  );
  try {
    const settings = fakeSettings([
      { ns: "llm-commandcode", value: { ...COMMAND_CODE_SHAPE }, revision: 1 },
      { ns: "opencode-go", value: { ...OPENCODE_SHAPE, enabled: true }, revision: 1 },
    ]);
    const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "k1", OPENCODE_API_KEY: "k2" });
    const host = realHost({ settings: settings.service, credentials: credentials.service });

    commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
    opencode.apply(host.ctx, opencode.Config({ ...OPENCODE_SHAPE, enabled: true }));
    // 远程面的注册发生在 `ctx.inject(["typert"], …)` 的回调里（异步）。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const service = host.ctx.get("llmAccountUsage") as {
      status(vendor: string): Promise<{ vendor: string; pinned: string | null }>;
    };
    expect(service).toBeDefined();
    await expect(service.status("commandcode")).resolves.toMatchObject({ vendor: "commandcode" });
    await expect(service.status("dsh-opencode-go")).resolves.toMatchObject({ vendor: "dsh-opencode-go" });

    // 描述符由创建服务的那一行登记一次，不是每行一次。
    expect(host.typert.contributions).toHaveLength(1);
    // 两个入口各自关掉了自己的自动表单。
    expect(settings.presentations.map((record) => record.presentation)).toEqual([{ auto: false }, { auto: false }]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("请求成功后把服务完成请求的账号上报为生效账号；失败时不报（noteSettled 接线，规格 §8.1 第 1 条）", async () => {
  const credentials = fakeCredentials({ OPENCODE_API_KEY: "sk-default" });
  // 一次干净的文本回复：适配器跑完整个流 → 走「成功」那一支。
  vi.stubGlobal("fetch", (async (input: unknown) => {
    if (String(input).includes("models.dev")) return new Response("{}", { status: 503 });
    if (String(input).includes("/models")) {
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(anthropicSse(TEXT_FRAMES), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  try {
    const host = fakeHost({ credentials: credentials.service });
    const bundle = opencode.apply(host.ctx, opencode.Config({ ...OPENCODE_SHAPE, enabled: true }));
    const engine = bundle.rotation.current();

    // 观察 `noteSettled` 本身，而不是只看生效账号：`pick` 早就把生效账号置好了，
    // 「成功后再确认一次」是另一件事（变异检验发现原来的断言在没有 noteSettled 时也通过）。
    const settled = vi.spyOn(engine, "noteSettled");
    expect(engine.effectiveAccount()).toBeUndefined();

    const { chunks, error } = await drain(bundle.adapter.stream(streamRequest()));
    expect(error).toBeUndefined();
    expect(chunks.length).toBeGreaterThan(0);
    expect(settled).toHaveBeenCalledWith("OPENCODE_API_KEY");
    expect(engine.effectiveAccount()?.ref).toBe("OPENCODE_API_KEY");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("请求失败时不把失败账号上报为生效账号（只有成功才 noteSettled）", async () => {
  const credentials = fakeCredentials({ PREFERRED_REF: "key-preferred" });
  const gateway = quotaGateway();
  vi.stubGlobal("fetch", gateway.fetchImpl);
  try {
    const host = fakeHost({ credentials: credentials.service });
    const bundle = opencode.apply(host.ctx, opencode.Config(twoAccountConfig(false)));
    const engine = bundle.rotation.current();
    const settled = vi.spyOn(engine, "noteSettled");

    const { error } = await drain(bundle.adapter.stream(streamRequest()));
    expect(error).toMatchObject({ code: "QUOTA" });
    // 额度拒绝是「谁被拒绝」，不是「谁服务成功」：上报成功账号会把卡片指向一个没干活的账号。
    expect(settled).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("登录落库的撞名判定：别人的凭据槽拒绝写入，同一账号的重新登录放行（T5 Step 7）", () => {
  const views: AccountView[] = [
    { ref: "COMMANDCODE_API_KEY", label: "COMMANDCODE_API_KEY", configured: true, active: true },
    { ref: "work", label: "sample-user-2", configured: true, active: false },
  ];

  // 空闲槽：可以写。
  expect(commandcode.loginSlotHolder(views, "fresh", "someone")).toBeUndefined();
  // 占用者名字与登录用户名不同 → 是**另一个**账号，拒绝并报出占用者。
  expect(commandcode.loginSlotHolder(views, "work", "someone-else")).toMatchObject({ label: "sample-user-2" });
  // 同一账号重新登录（忽略大小写与首尾空白）：放行，允许刷新密钥。
  expect(commandcode.loginSlotHolder(views, "work", " sample-user-2 ")).toBeUndefined();
  expect(commandcode.loginSlotHolder(views, "work", "SAMPLE-USER-2")).toBeUndefined();
  // 合成的默认槽：名字就是 ref 本身，用户名与之不同 → 拒绝（宁可让用户手动处置）。
  expect(commandcode.loginSlotHolder(views, "COMMANDCODE_API_KEY", "sample-user-2")).toMatchObject({
    label: "COMMANDCODE_API_KEY",
  });
});

it("opencode 的固定命名空间在宿主上解析到 profile 行 id", async () => {
  const settings = fakeSettings([
    {
      ns: "opencode-go",
      value: {
        apiKeyEnv: "OPENCODE_API_KEY",
        accounts: [{ id: "work", name: "work", apiKeyEnv: "OPENCODE_API_KEY_2" }],
      },
      revision: 4,
    },
  ]);
  const credentials = fakeCredentials({ OPENCODE_API_KEY: "sk-default", OPENCODE_API_KEY_2: "sk-work" });
  const host = fakeHost({ settings: settings.service, credentials: credentials.service });
  // 程序化构造（绕过 schemastery 归一化）也必须能装配。
  const bundle = opencode.apply(host.ctx, OPENCODE_SHAPE);

  // 顶层 `apiKeyEnv` 不在 `accounts[]` 里也不再合成默认行：没有账号就是没有。
  await expect(bundle.accounts.list()).resolves.toEqual([
    { ref: "OPENCODE_API_KEY_2", label: "work", configured: true, active: false },
  ]);

  await bundle.accounts.select("OPENCODE_API_KEY_2");
  // 读写都必须落在宿主真实的行 id 上：写 `llm-opencode-go` 只会得到一个不存在的行。
  expect(settings.mutations.map((mutation) => mutation.ns)).toEqual([
    "opencode-go",
    "opencode-go",
    "opencode-go",
  ]);
  expect(settings.valueOf("opencode-go")).toMatchObject({ apiKeyEnv: "OPENCODE_API_KEY_2" });
  expect(settings.valueOf("opencode-go")?.accountIntents).toEqual([]);
});

// ---------------------------------------------------------------------------
// 最终修复波：I1 哨兵（`default`/`auto`/空/缺失/非法）只在一个地方判定、I2 文档里的
// `apiKey` 不是凭据来源、I3 `autoSwitch: false` 真的收窄候选集。
// ---------------------------------------------------------------------------

/** 一条最小的请求：装配产物上的适配器只用到 provider/model/messages。 */
function streamRequest(): GenerateOptions {
  return {
    provider: "dsh-opencode-go",
    model: "m1",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  } as unknown as GenerateOptions;
}

/** 把流收成数组；抛错时把异常交回调用方（与宿主「边收边抛」的消费方式一致）。 */
async function drain(source: AsyncIterable<StreamChunk>): Promise<{ chunks: StreamChunk[]; error: unknown }> {
  const chunks: StreamChunk[] = [];
  try {
    for await (const chunk of source) chunks.push(chunk);
    return { chunks, error: undefined };
  } catch (error) {
    return { chunks, error };
  }
}

it("commandcode 的 activeAccount: default 与账号中心读同一份文档：固定到顶层默认账号（I1）", () => {
  const host = fakeHost();
  const bundle = commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
  const engine = bundle.rotation.current();

  // `default` 是旧插件的槽 id，指顶层 `apiKeyEnv` 那个账号 —— 与 `accounts.list()` 合成的
  // 第一行（同一个 ref）必须是同一个判定。
  expect(engine.pick({ model: "m1", tried: new Set() })).toBe("COMMANDCODE_API_KEY");
  // 顺序 = 顶层默认账号 + `accounts` 条目；固定账号被试过之后轮到真账号。
  expect(engine.pick({ model: "m1", tried: new Set(["COMMANDCODE_API_KEY"]) })).toBe("COMMANDCODE_API_KEY_2");
});

it("设置文档里的 apiKey 不是凭据来源：opencode 只认 stored → environment（I2）", async () => {
  const settings = fakeSettings([
    {
      ns: "opencode-go",
      // 用户（或手工编辑）在文档里写了一个未声明的 `apiKey` 字面量。
      value: { apiKeyEnv: "OPENCODE_TEST_REF", accounts: null, apiKey: "sk-from-settings" },
      revision: 2,
    },
  ]);
  const credentials = fakeCredentials({});
  const calls: string[] = [];
  vi.stubGlobal("fetch", (async (input: unknown) => {
    calls.push(String(input));
    return new Response("{}", { status: 500 });
  }) as typeof fetch);
  try {
    const host = fakeHost({ settings: settings.service, credentials: credentials.service });
    const config = opencode.Config({
      ...OPENCODE_SHAPE,
      enabled: true,
      apiKeyEnv: "OPENCODE_TEST_REF",
      apiKey: "sk-from-settings",
    });
    // 前提：未声明的 `apiKey` 会被 schemastery 原样带过，所以它确实到得了适配器配置里
    // （这正是这条缺陷能被触发的原因）。
    expect(plain(config)).toMatchObject({ apiKey: "sk-from-settings" });

    const bundle = opencode.apply(host.ctx, config);
    const { error } = await drain(bundle.adapter.stream(streamRequest()));

    // 密钥一个都没解析到（凭据服务为空、启动环境里没有这个名字）→ MISSING_CREDENTIAL，
    // 而且**一次 HTTP 都不发**：字面量没有被当成凭据来源。
    expect(error).toMatchObject({ code: "MISSING_CREDENTIAL" });
    expect(calls).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

/**
 * 造一个「当前账号 + 另一个账号」的假网关：目录端点返回空清单，生成端点一律 402 额度拒绝，
 * 并按顺序记下每次生成请求带的密钥 —— 「第二个账号有没有被联系」就是看这个序列。
 * @returns 假 fetch 与密钥序列。
 */
function quotaGateway(): { fetchImpl: typeof fetch; keys: string[] } {
  const keys: string[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes("models.dev")) return new Response("{}", { status: 503 });
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers(init?.headers);
    keys.push((headers.get("x-api-key") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/, ""));
    return new Response(JSON.stringify({ error: { type: "insufficientquota" } }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, keys };
}

/** 用户真实形状 + 第二个账号的 opencode 配置（`autoSwitch` 由调用方给）。 */
function twoAccountConfig(autoSwitch: boolean): Record<string, unknown> {
  return {
    ...OPENCODE_SHAPE,
    enabled: true,
    apiKeyEnv: "PREFERRED_REF",
    accounts: [{ id: "other", name: "other", apiKeyEnv: "OTHER_REF" }],
    autoSwitch,
    switchStrategy: "order",
  };
}

it("autoSwitch: false 时只试当前账号：额度拒绝不会打到第二个账号（I3）", async () => {
  const credentials = fakeCredentials({ PREFERRED_REF: "key-preferred", OTHER_REF: "key-other" });
  const gateway = quotaGateway();
  vi.stubGlobal("fetch", gateway.fetchImpl);
  try {
    const host = fakeHost({ credentials: credentials.service });
    const bundle = opencode.apply(host.ctx, opencode.Config(twoAccountConfig(false)));
    const { error } = await drain(bundle.adapter.stream(streamRequest()));

    // 唯一的候选被额度拒绝后没有下一个：抛出那次拒绝，第二个账号**从未被联系**。
    expect(error).toMatchObject({ code: "QUOTA" });
    expect(gateway.keys).toEqual(["key-preferred"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("autoSwitch: true 时同一个网关会轮到第二个账号（同一份文档只差这个开关）", async () => {
  const credentials = fakeCredentials({ PREFERRED_REF: "key-preferred", OTHER_REF: "key-other" });
  const gateway = quotaGateway();
  vi.stubGlobal("fetch", gateway.fetchImpl);
  try {
    const host = fakeHost({ credentials: credentials.service });
    const bundle = opencode.apply(host.ctx, opencode.Config(twoAccountConfig(true)));
    const { error } = await drain(bundle.adapter.stream(streamRequest()));

    expect(error).toMatchObject({ code: "QUOTA" });
    expect(gateway.keys).toEqual(["key-preferred", "key-other"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("备用账号服务成功后提为当前账号：move 走设置端口，顺序与顶层引用一起落地", async () => {
  const credentials = fakeCredentials({ PREFERRED_REF: "key-preferred", OTHER_REF: "key-other" });
  const settings = fakeSettings([{ ns: "opencode-go", value: twoAccountConfig(true), revision: 4 }]);
  // 网关：第一把钥匙 402 配额用尽，第二把干净回复（备用账号服务成功）。
  const keys: string[] = [];
  vi.stubGlobal("fetch", (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("models.dev")) return new Response("{}", { status: 503 });
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const headers = new Headers(init?.headers);
    const key = (headers.get("x-api-key") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    keys.push(key);
    if (key === "key-preferred") {
      return new Response(JSON.stringify({ error: { type: "insufficientquota" } }), { status: 402, headers: { "content-type": "application/json" } });
    }
    return new Response(anthropicSse(TEXT_FRAMES), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  try {
    const host = fakeHost({ credentials: credentials.service, settings: settings.service });
    const bundle = opencode.apply(host.ctx, opencode.Config(twoAccountConfig(true)));
    const { error } = await drain(bundle.adapter.stream(streamRequest()));
    expect(error).toBeUndefined();
    expect(keys).toEqual(["key-preferred", "key-other"]);

    // 晋升是一次真实的设置写入：账号表顺序不变（只有一条），顶层引用改成服务成功的那个。
    await vi.waitFor(() => expect(settings.valueOf("opencode-go")?.apiKeyEnv).toBe("OTHER_REF"));
    expect(settings.valueOf("opencode-go")?.accounts).toEqual([{ id: "other", name: "other", apiKeyEnv: "OTHER_REF" }]);
    // 提位后下一轮请求直接用新当前账号（引擎按文档重建，order 首位就是它）。
    expect(bundle.rotation.current().pick({ model: "m1", tried: new Set() })).toBe("OTHER_REF");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("autoSwitch 关着时备用账号服务成功也不提位（顺序是用户的地盘）", async () => {
  const credentials = fakeCredentials({ PREFERRED_REF: "key-preferred", OTHER_REF: "key-other" });
  const settings = fakeSettings([{ ns: "opencode-go", value: twoAccountConfig(false), revision: 4 }]);
  vi.stubGlobal("fetch", (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("models.dev")) return new Response("{}", { status: 503 });
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const headers = new Headers(init?.headers);
    const key = (headers.get("x-api-key") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    if (key === "key-preferred") {
      return new Response(JSON.stringify({ error: { type: "insufficientquota" } }), { status: 402, headers: { "content-type": "application/json" } });
    }
    return new Response(anthropicSse(TEXT_FRAMES), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch);
  try {
    const host = fakeHost({ credentials: credentials.service, settings: settings.service });
    const bundle = opencode.apply(host.ctx, opencode.Config(twoAccountConfig(false)));
    // autoSwitch: false 时候选集只有当前账号：第二个账号根本不会被联系，遑论提位。
    const { error } = await drain(bundle.adapter.stream(streamRequest()));
    expect(error).toMatchObject({ code: "QUOTA" });
    expect(settings.mutations).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

// ---------------------------------------------------------------------------
// 2026-10-17 修复波：commandcode 的 3 处不对称（§4.2）。
// C（确定性 bug）：`autoSwitch` 落库 + 门 —— 按设计 §6.4.5/§7.3 实现，而不是改声明。
// A/B（设计取舍）：顺序不重排、备援晋升只属 opencode —— 用测试锁死形状。
// ---------------------------------------------------------------------------

/** 一条 provider 为 commandcode 的最小请求。 */
function commandCodeStreamRequest(): GenerateOptions {
  return {
    provider: "commandcode",
    model: "m1",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  } as unknown as GenerateOptions;
}

/**
 * 造一个 commandcode 的假网关：所有生成请求都回 429 额度拒绝（带窗口证据），按顺序记下
 * `Authorization` 头里的密钥 —— 「第二个账号有没有被联系」就是看这个序列。
 * @returns 假 fetch 与密钥序列。
 */
function commandCodeQuotaGateway(): { fetchImpl: typeof fetch; keys: string[] } {
  const keys: string[] = [];
  const fetchImpl = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    // 只记**生成**请求：目录端点（`/models`）本来就不带密钥，把它记进来会让
    // 「第二个账号有没有被联系」这条断言混进一次空 key（2026-10-19 修）。
    if (key !== "") keys.push(key);
    return new Response(
      JSON.stringify({ error: { code: "RATE_LIMITED", rateLimit: { window: "fiveHour", reset: Math.floor(Date.now() / 1000) + 3600 } } }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, keys };
}

it("commandcode 的 autoSwitch: false 只试当前账号：额度拒绝不会打到第二个账号（C）", async () => {
  const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "key-default", COMMANDCODE_API_KEY_2: "key-second" });
  const gateway = commandCodeQuotaGateway();
  vi.stubGlobal("fetch", gateway.fetchImpl);
  try {
    const host = fakeHost({ credentials: credentials.service });
    const bundle = commandcode.apply(host.ctx, commandcode.Config({ ...COMMAND_CODE_SHAPE, autoSwitch: false }));
    const { error } = await drain(bundle.adapter.stream(commandCodeStreamRequest()));

    // 唯一的候选（固定账号 = 顶层默认账号）被额度拒绝后没有下一个：抛出那次拒绝，
    // 第二个账号**从未被联系**。
    expect(error).toMatchObject({ code: "RATE_LIMIT" });
    expect(gateway.keys).toEqual(["key-default"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("commandcode 默认 autoSwitch: true 时同一个网关会轮到第二个账号（同一份文档只差这个开关）", async () => {
  const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "key-default", COMMANDCODE_API_KEY_2: "key-second" });
  const gateway = commandCodeQuotaGateway();
  vi.stubGlobal("fetch", gateway.fetchImpl);
  try {
    const host = fakeHost({ credentials: credentials.service });
    // 用户现有文档里没有这个字段：Config 的默认值 `true` 保持旧插件「额度耗尽总是回落」的行为。
    const bundle = commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
    const { error } = await drain(bundle.adapter.stream(commandCodeStreamRequest()));

    expect(error).toMatchObject({ code: "RATE_LIMIT" });
    expect(gateway.keys).toEqual(["key-default", "key-second"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("commandcode 的 list() 顺序不随固定账号重排：固定标记换行，顺序仍是轮换顺序（A）", async () => {
  const settings = fakeSettings([
    {
      ns: "llm-commandcode",
      value: { ...COMMAND_CODE_SHAPE, activeAccount: "COMMANDCODE_API_KEY_2" },
      revision: 4,
    },
  ]);
  const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "sk-default", COMMANDCODE_API_KEY_2: "sk-fsk" });
  const host = fakeHost({ settings: settings.service, credentials: credentials.service });
  const bundle = commandcode.apply(
    host.ctx,
    commandcode.Config({ ...COMMAND_CODE_SHAPE, activeAccount: "COMMANDCODE_API_KEY_2" }),
  );

  // 固定的其实是第二行（`active: true` 在它身上）；默认槽不再合成。
  await expect(bundle.accounts.list()).resolves.toEqual([
    { ref: "COMMANDCODE_API_KEY_2", label: "sample-user-2", configured: true, active: true },
  ]);
  // 固定账号仍被引擎优先（固定 ≠ 顺序）：固定它之后下一次选择就是它。
  expect(bundle.rotation.current().pick({ model: "m1", tried: new Set() })).toBe("COMMANDCODE_API_KEY_2");
});

it("commandcode 的备用账号服务成功也不提位：固定账号保持不动（B：晋升只属 opencode）", async () => {
  const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "key-default", COMMANDCODE_API_KEY_2: "key-second" });
  const settings = fakeSettings([
    { ns: "llm-commandcode", value: { ...COMMAND_CODE_SHAPE, activeAccount: "default" }, revision: 4 },
  ]);
  const keys: string[] = [];
  vi.stubGlobal("fetch", (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    // 同上：目录请求不带密钥，不算「联系了某个账号」。
    if (key !== "") keys.push(key);
    if (key === "key-default") {
      return new Response(
        JSON.stringify({ error: { code: "RATE_LIMITED", rateLimit: { window: "fiveHour", reset: Math.floor(Date.now() / 1000) + 3600 } } }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      [
        '{"choices":[{"delta":{"content":"hello"}}]}',
        '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "[DONE]",
      ]
        .map((event) => `data: ${event}\n\n`)
        .join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch);
  try {
    const host = fakeHost({ credentials: credentials.service, settings: settings.service });
    const bundle = commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));
    const { error } = await drain(bundle.adapter.stream(commandCodeStreamRequest()));

    expect(error).toBeUndefined();
    expect(keys).toEqual(["key-default", "key-second"]);
    // 备用账号把请求服务完，但一次设置写入都没有：固定账号（`activeAccount`）保持不动。
    // Command Code 的固定语义是「透支时允许回落、窗口重置后恢复固定」（设计 §6.4.4），
    // 把服务过的账号提为固定账号会毁掉「恢复固定」；晋升是 opencode 上游
    // （`GoAccountSelection.adopt`）的行为、且以它的 `autoSwitch` 为门 —— 不往这里搬。
    // 「卡片跟随真实账号」由内核的「最近成功者」（`noteSettled`）经远程面发布，不靠改文档。
    expect(settings.mutations).toEqual([]);
    expect(settings.valueOf("llm-commandcode")?.activeAccount).toBe("default");
  } finally {
    vi.unstubAllGlobals();
  }
});

// —— 限额换模型——

it("限额时换到同名模型：目录里先记下候选，配一个能服务的第二个模型", async () => {
  const { noteCatalogModels, resetCatalogSources, cachedModelCandidates } = await import("../../src/vendors/model-catalog-registry");
  resetCatalogSources();
  // 模拟「适配器读过目录」：这是缓存的真实填充路径（不再额外发请求）。
  noteCatalogModels("commandcode", [{ id: "deepseek-v4.1-flash" }, { id: "deepseek-v4.1-flash-2" }]);
  expect(cachedModelCandidates()?.map((item) => item.model)).toContain("deepseek-v4.1-flash");
  resetCatalogSources();
});

// —— 搜索的网关路：数据必须来自 opendesign 行（2026-10-20 审计修掉的真 bug）——

/** 搜索 provider 的最小形状（本用例只用到 `search`）。 */
interface SearchProviderLike {
  search(request: { query: string }, signal?: AbortSignal): Promise<unknown>;
}

/** 被 commandcode 行注册出来的那个搜索 provider（`web.registerSearchProvider` 捕获）。 */
let capturedProvider: SearchProviderLike | undefined;

it("网关路用 opendesign 行的基地址与密钥（provider 只在 commandcode 行注册）", async () => {
  // 旧 bug：`gatewayAccess` 读 commandcode **自己行**的 `apiKeyEnv` / `apiBase` ——
  // 会话在 opendesign + DeepSeek 模型上时，搜索拿着 commandcode 的密钥打 commandcode
  // 的端点（实测 400：那个端点只收 Claude 系），而网关路是默认策略的第一选择、
  // 失败还不回退 API key。这个用例把两行装进同一个宿主，钉住数据来源。
  const requests: { url: string; authorization: string | undefined; apiKey: string | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      requests.push({
        url: String(input),
        // 头名按**小写**读：provider 发的就是小写（真实 fetch 大小写不敏感，直接取属性敏感）。
        authorization: init?.headers?.["authorization"],
        apiKey: init?.headers?.["x-api-key"],
      });
      return new Response(
        JSON.stringify({
          content: [{ type: "web_search_tool_result", content: [{ title: "A", url: "https://a.example/x" }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  );
  try {
    const settings = fakeSettings([
      { ns: "llm-commandcode", value: { ...COMMAND_CODE_SHAPE }, revision: 1 },
      {
        ns: "opendesign",
        value: { enabled: true, apiKeyEnv: "OPENDESIGN_API_KEY", baseURL: "https://amr-link.example/v1" },
        revision: 1,
      },
    ]);
    const credentials = fakeCredentials({
      // commandcode 行的账号密钥：**不该**被搜索用到（旧 bug 正是用了它）。
      COMMANDCODE_API_KEY: "sk-commandcode",
      // opendesign 行的账号密钥：搜索该用这把。
      OPENDESIGN_API_KEY: "sk-opendesign",
    });
    const host = fakeHost({
      settings: settings.service,
      credentials: credentials.service,
      web: {
        registerSearchProvider: (provider: unknown) => {
          capturedProvider = provider as SearchProviderLike;
          return () => undefined;
        },
      },
      // 会话路由：宿主 `agents.currentInitiator()` 的形状（实测确认有这两个字段）。
      agents: {
        currentInitiator: () => ({
          session: { requestContext: () => ({ provider: "opendesign", model: "deepseek-v4-pro" }) },
        }),
      },
    });
    // 假 ctx 补一个 `inject`：搜索 provider 与远程面都经它注册。语义与 cordis 一致 ——
    // 请求的服务缺席时**不回调**（所以缺 typert 时远程面静默不注册，不影响本用例）。
    (host.ctx as unknown as { inject: unknown }).inject = (
      deps: readonly string[],
      callback: (injected: Record<string, unknown>) => unknown,
    ) => {
      const injected: Record<string, unknown> = {};
      for (const dep of deps) {
        const service = (host.ctx as unknown as { get(name: string): unknown }).get(dep);
        if (service === undefined) return undefined;
        injected[dep] = service;
      }
      return callback(injected);
    };

    // 两行装进同一个宿主（顺序无关：注册表用时现取）。
    opendesign.apply(
      host.ctx,
      opendesign.Config({ apiKeyEnv: "OPENDESIGN_API_KEY", baseURL: "https://amr-link.example/v1" }),
    );
    commandcode.apply(host.ctx, commandcode.Config(COMMAND_CODE_SHAPE));

    expect(capturedProvider, "commandcode 行应该注册了搜索 provider").toBeDefined();
    const result = (await capturedProvider!.search({ query: "你好" })) as { sources: { url: string }[] };

    expect(result.sources.map((source) => source.url)).toEqual(["https://a.example/x"]);
    // 请求打在 **opendesign 行**的基地址上，用的是 **opendesign 行**的密钥。
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://amr-link.example/v1/messages");
    expect(requests[0]!.apiKey).toBe("sk-opendesign");
    expect(requests[0]!.authorization).toBe("Bearer sk-opendesign");
    expect(requests[0]!.apiKey).not.toBe("sk-commandcode");
  } finally {
    vi.unstubAllGlobals();
  }
});
