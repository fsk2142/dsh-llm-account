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
import type { Context } from "@deepseek-ai/cordis";
import { expect, it } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import * as commandcode from "../../src/vendors/commandcode/index";
import * as opencode from "../../src/vendors/opencode/index";

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

/** 假宿主设置服务：一份内存文档 + 修订号围栏，各行的文档内容与 `describe()` 一一对应。 */
interface FakeSettings {
  service: unknown;
  mutations: RecordedMutation[];
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
  const service = {
    describe: () =>
      state.map((row) => ({ ns: row.ns, value: { ...row.value }, revision: row.revision, applies: "live", autoGenerate: false })),
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

/** 用户现有的 commandcode 配置形状（逐字来自 task-14-brief 与 profile patch 第 29-41 行）。 */
const COMMAND_CODE_SHAPE = {
  apiKeyEnv: "COMMANDCODE_API_KEY",
  visibleModels: ["deepseek/deepseek-v4.1-flash"],
  modelVisibility: {},
  showSidebarQuota: true,
  accounts: [{ label: "sample-user-2", apiKeyEnv: "COMMANDCODE_API_KEY_2" }],
  activeAccount: "default",
  modelAccountRules: [],
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
