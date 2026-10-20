/**
 * Task 3 测试：宿主侧「账号中心」远程命名空间。
 *
 * 这一层把 Task 2 的生效账号/切换通知与两个厂商的账号、额度端口合成一个远程面，供客户端
 * （Task 4+ 的统一页面与侧边栏卡片）读取。**接缝未验证**：`ctx.typert.register(contribution)`
 * 的形状逐字取自本机已装的 `@mars-sea/dsh-commandcode-provider/lib/index.js:8965-8976`，
 * 真机判定在计划 1c。
 *
 * 测试用**真** cordis `Context`（服务构造需要真的 Service 基类），只在 `typert` 与厂商端口上
 * 放假件；`inject` 回调是异步的，所以 mount 之后要让出一个微任务。
 */
import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";

import type { AccountPort, AccountState, AccountView, LoginPort, QuotaSnapshot, VendorCapabilities, VendorId } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/switching/rotation";
import type { RotationAccess } from "../../src/vendors/assembly";
import {
  applyUsageRemote,
  LlmAccountUsageService,
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  USAGE_SERVICE_KEY,
  type UsageVendorDeps,
} from "../../src/vendors/usage-remote";

/** 两个账号：`a` 是固定账号（也是额度读数的账号），`b` 是另一个。 */
const VIEWS: AccountView[] = [
  { ref: "a", label: "Account A", configured: true, active: true },
  { ref: "b", label: "Account B", configured: true, active: false },
];

/** 一份额度读数：刻意只给 `used`/`cap`，不给 `percent` —— 「缺失字段不得编造」的观测点。 */
const SNAPSHOT: QuotaSnapshot = {
  plan: { id: "individual-goat", name: "GOAT", status: "active", monthlyCredits: 70 },
  windows: [{ key: "5h", used: 10, cap: 100, resetAt: 1_700_000_000_000 }],
  failures: [],
};

/** 引擎读取口：本任务只需要「现取引擎」，不需要重建。 */
function rotationAccessOf(engine: RotationEngine): RotationAccess {
  return {
    current: () => engine,
    clearCredentialRejection: (ref: string) => engine.clearCredentialRejection(ref),
  };
}

/** Command Code 的能力矩阵（规格 §7.3；与入口里的声明一致）。 */
const COMMANDCODE_CAPABILITIES: VendorCapabilities = {
  reorder: false,
  pin: true,
  browserLogin: true,
  modelAccountRules: true,
  quotaShape: "windows",
  modelVisibilityWrite: "onSave",
  automaticSwitch: true,
};

/** 假账号端口：`list` 给出固定视图，写操作只记录调用（不碰设置/凭据）。 */
function fakeAccounts(views: AccountView[] = VIEWS): {
  port: AccountPort;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): void => {
      calls.push({ method, args });
    };
  const port: AccountPort = {
    list: async () => views.map((view) => ({ ...view })),
    add: async (input) => {
      calls.push({ method: "add", args: [input] });
      return { ref: "new-ref", label: input.label, configured: input.key !== undefined, active: false };
    },
    rename: async (ref, label) => record("rename")(ref, label),
    replaceKey: async (ref, key) => record("replaceKey")(ref, key),
    remove: async (ref) => record("remove")(ref),
    select: async (ref) => record("select")(ref),
  };
  return { port, calls };
}

/** 一个厂商的读口；未给的字段用上面的缺省夹具。 */
function vendorDeps(options: {
  vendor: VendorId;
  engine?: RotationEngine;
  views?: AccountView[];
  accounts?: AccountPort;
  capabilities?: VendorCapabilities;
  snapshot?: () => Promise<QuotaSnapshot>;
  pinnedRef?: () => string | null;
  quotaRef?: () => string | undefined;
  login?: LoginPort;
}): UsageVendorDeps {
  const engine = options.engine ?? new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  return {
    vendor: options.vendor,
    rotation: rotationAccessOf(engine),
    accounts: options.accounts ?? fakeAccounts(options.views).port,
    quota: { snapshot: options.snapshot ?? (async () => ({ ...SNAPSHOT, windows: [...SNAPSHOT.windows] })) },
    // 能力声明：默认取 commandcode 的矩阵（`reorder: false`、`browserLogin: true`）。
    capabilities: options.capabilities ?? COMMANDCODE_CAPABILITIES,
    pinnedRef: options.pinnedRef ?? (() => "a"),
    quotaRef: options.quotaRef ?? (() => "a"),
    ...(options.login === undefined ? {} : { login: options.login }),
  };
}

/** 假 `ctx.typert`：只实现本项目用到的一个方法，并记下贡献。 */
function fakeTypert(): { service: unknown; register: ReturnType<typeof vi.fn>; contributions: unknown[] } {
  const contributions: unknown[] = [];
  const register = vi.fn((contribution: unknown) => {
    contributions.push(contribution);
    return () => Promise.resolve();
  });
  return { service: { register }, register, contributions };
}

/** 起一个真 Context + 假 typert，按顺序 apply 每个厂商（模拟两个 profile 行）。 */
async function mount(depsList: readonly UsageVendorDeps[]): Promise<{
  ctx: Context;
  typert: ReturnType<typeof fakeTypert>;
  service: LlmAccountUsageService;
}> {
  const ctx = new Context();
  const typert = fakeTypert();
  ctx.provide("typert");
  ctx.set("typert", typert.service);
  for (const deps of depsList) applyUsageRemote(ctx, deps);
  // `ctx.inject` 的回调在服务可用后的下一个宏任务里跑（cordis 的服务广播是异步的）。
  await new Promise((resolve) => setTimeout(resolve, 0));
  const service = ctx.get(USAGE_SERVICE_KEY) as LlmAccountUsageService;
  return { ctx, typert, service };
}

it("服务注册到固定键与命名空间，并登记三个远程方法", async () => {
  const { service, typert } = await mount([vendorDeps({ vendor: "commandcode" })]);

  expect(service).toBeInstanceOf(LlmAccountUsageService);
  // 基类盖的 typert 绑定：Gateway 每次派发都校验它。
  expect(service.typertRemote.serviceKey).toBe(USAGE_SERVICE_KEY);
  expect(service.typertRemote.namespace).toBe(USAGE_NAMESPACE);

  expect(typert.register).toHaveBeenCalledTimes(1);
  const contribution = typert.contributions[0] as {
    package: string;
    face: string;
    invocations: { id: string; service: string; namespace: string; method: string }[];
  };
  expect(contribution.package).toBe(USAGE_PACKAGE);
  expect(contribution.face).toBe("host");
  expect(contribution.invocations.map((entry) => entry.method)).toEqual([
    "status",
    "accounts",
    "switches",
    "models",
    "addAccount",
    "renameAccount",
    "replaceKey",
    "removeAccount",
    "selectAccount",
    "moveAccount",
    "setAutoSwitch",
    "switchNow",
    "setAccountOrder",
    "setSwitchSettings",
    "setAccountModels",
    "loginBegin",
    "loginStatus",
    "loginCancel",
    "usageReport",
    "usageClear",
    "usageExportCsv",
    "credentialStatus",
    "setCredential",
    // 密钥实测：添加后自动验一次 + 「测试」按钮（2026-10-20 用户要求）。
    "probeSearchCredential",
  ]);
  // 每个描述符都声明自己属于哪个服务与命名空间（旧插件同一形状）。
  for (const entry of contribution.invocations) {
    expect(entry.service).toBe(USAGE_SERVICE_KEY);
    expect(entry.namespace).toBe(USAGE_NAMESPACE);
    expect(entry.id.startsWith(`${USAGE_PACKAGE}#`)).toBe(true);
  }
});

it("两个 profile 行共享同一个服务实例，描述符只注册一次，两家都能读", async () => {
  const { typert, service } = await mount([
    vendorDeps({ vendor: "commandcode" }),
    vendorDeps({ vendor: "dsh-opencode-go" }),
  ]);

  // 第二次 apply 复用已有实例：否则同名 cordis 服务会撞车，描述符也会重复登记。
  expect(typert.register).toHaveBeenCalledTimes(1);
  await expect(service.status("commandcode")).resolves.toMatchObject({ vendor: "commandcode" });
  await expect(service.status("dsh-opencode-go")).resolves.toMatchObject({ vendor: "dsh-opencode-go" });
});

it("status() 给出生效账号与固定账号；没有请求时生效账号缺省（不编造）", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: "a", rules: [] });
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine, pinnedRef: () => "a" })]);

  const before = await service.status("commandcode");
  expect(before.pinned).toBe("a");
  expect(before.effective).toBeUndefined();
  expect(before.accounts.map((row) => row.effective)).toEqual([false, false]);

  engine.pick({ model: "m", tried: new Set() }); // 选中 a
  const after = await service.status("commandcode");
  expect(after.effective?.ref).toBe("a");
  expect(after.accounts.map((row) => row.effective)).toEqual([true, false]);
  // 「是否固定」只有一处来源（status.pinned）：页面拿 ref 比对，不在行上再写一遍。
  expect(after.pinned).toBe("a");
});

it("每个已配置账号都读一次额度，缺失字段不进摘要", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: "a", rules: [] });
  engine.pick({ model: "m", tried: new Set() }); // 生效账号 a
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine })]);

  const status = await service.status("commandcode");
  const [first, second] = status.accounts;

  expect(first!.quota?.plan).toEqual({ id: "individual-goat", name: "GOAT", status: "active", monthlyCredits: 70 });
  expect(first!.quota?.windows).toEqual([{ key: "5h", used: 10, cap: 100, resetAt: 1_700_000_000_000 }]);
  expect("percent" in (first!.quota!.windows[0] ?? {})).toBe(false);
  // 两个账号都各自读到额度，而不是只给当前账号。
  expect(second!.quota?.plan?.id).toBe("individual-goat");
  // 摘要是**拷出去**的（不是宿主对象的引用）：改摘要不能改到端口的读数上。
  expect(first!.quota?.plan).not.toBe(SNAPSHOT.plan);
});

it("额度读取失败只记在 failures 里，不产出任何摘要", async () => {
  const { service } = await mount([
    vendorDeps({
      vendor: "commandcode",
      snapshot: async () => {
        throw new Error("quota endpoint down");
      },
    }),
  ]);

  const status = await service.status("commandcode");
  expect(status.accounts.every((row) => row.quota === undefined)).toBe(true);
  expect(status.failures).toHaveLength(status.accounts.length);
  expect(status.failures[0]).toContain("commandcode");
  expect(status.failures[0]).toContain("quota");
});

it("额度失败项写账号名称，不写内部 ref（这一行直接显示在用量面板上）", async () => {
  const { service } = await mount([
    vendorDeps({
      vendor: "commandcode",
      snapshot: async () => {
        throw new Error("quota endpoint down");
      },
    }),
  ]);

  const status = await service.status("commandcode");
  expect(status.failures).toContain('quota: commandcode "Account A" read failed (quota endpoint down)');
  expect(status.failures).toContain('quota: commandcode "Account B" read failed (quota endpoint down)');
  // 内部 ref（"a" / "b"）不出现在消息里：旧写法把它印在界面上，像调试输出。
  expect(status.failures.some((item) => /commandcode [ab] read/.test(item))).toBe(false);
});

it("额度读取超时后会重试一次；第二次成功就不记失败", async () => {
  // 先挂载（mount 自己等一个定时器），再换假时钟：status 里的 30s 预算由假时钟推进。
  let calls = 0;
  const { service } = await mount([
    vendorDeps({
      vendor: "commandcode",
      snapshot: async () => {
        calls += 1;
        // 第一次永远不 resolve（等超时）；第二次正常返回。
        if (calls <= 2) return new Promise<QuotaSnapshot>(() => {});
        return { ...SNAPSHOT, windows: [...SNAPSHOT.windows] };
      },
    }),
  ]);

  vi.useFakeTimers();
  try {
    const pending = service.status("commandcode");
    await vi.advanceTimersByTimeAsync(30_000);
    const status = await pending;
    // 两个账号各读一次、各超时一次、各重试一次成功（共 4 次调用）。
    expect(calls).toBe(4);
    expect(status.failures).toEqual([]);
    expect(status.accounts.every((row) => row.quota !== undefined)).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("端口明确失败（非超时）不重试：同样的错误再试一次必然同样失败", async () => {
  const snapshot = vi.fn(async (): Promise<QuotaSnapshot> => {
    throw new Error("no usable API key");
  });
  const { service } = await mount([vendorDeps({ vendor: "commandcode", snapshot })]);

  const status = await service.status("commandcode");
  // 两个账号各一次，没有重试（确定性失败重试无意义，只会让界面多等）。
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(status.failures).toHaveLength(2);
  expect(status.failures[0]).toContain("no usable API key");
});

it("拒绝/冷却随账号行发布，并带上重置时刻", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  // resetAt 必须在**未来**：引擎读取时会惰性清掉已过期的条目，用过去时刻等于什么都没记。
  const resetAt = Date.now() + 60_000;
  engine.markRejected("a", { kind: "quota", message: "exhausted", resetAt });
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine })]);

  const status = await service.status("commandcode");
  expect(status.accounts[0]!.rejection).toEqual({ kind: "quota", until: resetAt });
  expect(status.accounts[1]!.rejection).toBeUndefined();
});

it("switches() 按时间倒序并标注厂商；status() 给出最近一条", async () => {
  let now = 1_000;
  const engine = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [], now: () => now });
  engine.pick({ model: "m", tried: new Set() }); // a
  now = 2_000;
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  engine.pick({ model: "m", tried: new Set(["a"]) }); // b，切换 1
  now = 3_000;
  engine.noteManualSwitch("a"); // 切换 2

  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine })]);

  const records = await service.switches("commandcode");
  expect(records.map((record) => [record.fromRef, record.toRef, record.reason, record.vendor])).toEqual([
    ["b", "a", "manual", "commandcode"],
    ["a", "b", "quota", "commandcode"],
  ]);
  expect((await service.status("commandcode")).switch).toMatchObject({ fromRef: "b", toRef: "a", reason: "manual" });
});

it("accounts() 直接给出账号行（页面账户卡片的数据源）", async () => {
  const { service } = await mount([vendorDeps({ vendor: "commandcode" })]);
  await expect(service.accounts("commandcode")).resolves.toEqual([
    { ref: "a", label: "Account A", configured: true, active: true },
    { ref: "b", label: "Account B", configured: true, active: false },
  ]);
});

it("未知厂商报明确错误，而不是静默返回空结果", async () => {
  const { service } = await mount([vendorDeps({ vendor: "commandcode" })]);
  await expect(service.status("nope" as VendorId)).rejects.toThrow(/nope/);
});

it("额度按每个账号分别读取，不再只挂在当前账号上", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  engine.pick({ model: "m", tried: new Set(["a"]) }); // 生效账号 b
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine, quotaRef: () => "a" })]);

  const status = await service.status("commandcode");
  expect(status.effective?.ref).toBe("b");
  expect(status.accounts[0]!.quota?.plan?.name).toBe("GOAT");
  expect(status.accounts[1]!.quota?.plan?.name).toBe("GOAT");
});

it("没有在跑的账号库（引擎为空）时 status 仍可用，只是没有生效账号", async () => {
  const engine = new RotationEngine({ order: [], pinned: null, rules: [] } satisfies AccountState);
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine, views: [], quotaRef: () => undefined })]);
  const status = await service.status("commandcode");
  expect(status.accounts).toEqual([]);
  expect(status.effective).toBeUndefined();
});

// —— Task 5：账号操作与网页登录（账户卡片要用的写路径）——

it("账号操作转发到该厂商的账号端口（参数原样，不自行加工）", async () => {
  const accounts = fakeAccounts();
  const { service } = await mount([vendorDeps({ vendor: "commandcode", accounts: accounts.port })]);

  await expect(service.addAccount("commandcode", { label: "work", key: "sk-new" })).resolves.toMatchObject({
    ref: "new-ref",
    label: "work",
  });
  await service.renameAccount("commandcode", "a", "renamed");
  await service.replaceKey("commandcode", "a", "sk-rotated");
  await service.removeAccount("commandcode", "b");
  await service.selectAccount("commandcode", "b");
  await service.selectAccount("commandcode", null);

  expect(accounts.calls).toEqual([
    { method: "add", args: [{ label: "work", key: "sk-new" }] },
    { method: "rename", args: ["a", "renamed"] },
    { method: "replaceKey", args: ["a", "sk-rotated"] },
    { method: "remove", args: ["b"] },
    { method: "select", args: ["b"] },
    { method: "select", args: [null] },
  ]);
});

it("换密钥只走账号端口：远程面既不回显密钥，也不把它放进任何返回值", async () => {
  const accounts = fakeAccounts();
  const { service } = await mount([vendorDeps({ vendor: "commandcode", accounts: accounts.port })]);

  const result = await service.replaceKey("commandcode", "a", "sk-secret-value");
  expect(result).toBeUndefined();
  // 端口拿到的是明文密钥（它必须交给凭据服务），但远程面的返回里没有它。
  expect(JSON.stringify(result ?? null)).not.toContain("sk-secret-value");
  expect(accounts.calls).toEqual([{ method: "replaceKey", args: ["a", "sk-secret-value"] }]);
});

it("网页登录：有登录端口的厂商可以 begin/status/cancel，没有的厂商给出可读错误", async () => {
  const login: LoginPort = {
    begin: async () => ({ state: "waiting", authUrl: "https://commandcode.ai/studio/auth/cli?x=1" }),
    status: async () => ({ state: "idle" }),
    cancel: async () => undefined,
  };
  const withLogin = await mount([vendorDeps({ vendor: "commandcode", login })]);
  await expect(withLogin.service.loginBegin("commandcode")).resolves.toMatchObject({ state: "waiting" });
  await expect(withLogin.service.loginStatus("commandcode")).resolves.toEqual({ state: "idle" });
  await expect(withLogin.service.loginCancel("commandcode")).resolves.toBeUndefined();

  // opencode 没有网页登录能力：静默无操作会伪装成「登录没反应」，必须吵出来。
  const without = await mount([vendorDeps({ vendor: "dsh-opencode-go" })]);
  await expect(without.service.loginBegin("dsh-opencode-go")).rejects.toThrow(/browser login/);
});

it("排序与 autoSwitch：支持的厂商转发到账号端口，参数原样", async () => {
  const accounts = fakeAccounts();
  const withMove: AccountPort = {
    ...accounts.port,
    move: async (ref, toIndex) => {
      accounts.calls.push({ method: "move", args: [ref, toIndex] });
    },
    setAutoSwitch: async (value) => {
      accounts.calls.push({ method: "setAutoSwitch", args: [value] });
    },
  };
  const { service } = await mount([vendorDeps({ vendor: "dsh-opencode-go", accounts: withMove })]);

  await service.moveAccount("dsh-opencode-go", "b", 0);
  await service.setAutoSwitch("dsh-opencode-go", true);
  expect(accounts.calls).toEqual([
    { method: "move", args: ["b", 0] },
    { method: "setAutoSwitch", args: [true] },
  ]);
});

it("排序与 autoSwitch：端口缺方法的厂商报明确错误（不是静默无操作）", async () => {
  // 这里的假端口刻意不实现这两个可选方法（真实的两家现在都实现了 `setAutoSwitch` —— 设计
  // §6.4.5 共用，commandcode 于 2026-10-17 补齐；`move` 仍然只有 opencode 实现）。
  // 「缺方法时报明确错误」这条路径本身对未来的厂商同样适用，用缺方法的端口锁死。
  const { service } = await mount([vendorDeps({ vendor: "commandcode" })]);
  await expect(service.moveAccount("commandcode", "a", 1)).rejects.toThrow(/reordering/);
  await expect(service.setAutoSwitch("commandcode", true)).rejects.toThrow(/auto-switch/);
});
