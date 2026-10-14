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

import type { AccountState, AccountView, QuotaSnapshot, VendorId } from "../../src/core/adapter";
import { RotationEngine } from "../../src/core/rotation";
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
  plan: "pro",
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

/** 一个厂商的读口；未给的字段用上面的缺省夹具。 */
function vendorDeps(options: {
  vendor: VendorId;
  engine?: RotationEngine;
  views?: AccountView[];
  snapshot?: () => Promise<QuotaSnapshot>;
  pinnedRef?: () => string | null;
  quotaRef?: () => string | undefined;
}): UsageVendorDeps {
  const engine = options.engine ?? new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  return {
    vendor: options.vendor,
    rotation: rotationAccessOf(engine),
    accounts: { list: async () => (options.views ?? VIEWS).map((view) => ({ ...view })) },
    quota: { snapshot: options.snapshot ?? (async () => ({ ...SNAPSHOT, windows: [...SNAPSHOT.windows] })) },
    pinnedRef: options.pinnedRef ?? (() => "a"),
    quotaRef: options.quotaRef ?? (() => "a"),
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
  expect(contribution.invocations.map((entry) => entry.method)).toEqual(["status", "accounts", "switches"]);
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

it("每账号额度摘要只挂在额度读数所属的账号上，缺失字段不进摘要", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: "a", rules: [] });
  engine.pick({ model: "m", tried: new Set() }); // 生效账号 a
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine })]);

  const status = await service.status("commandcode");
  const [first, second] = status.accounts;

  expect(first!.quota?.plan).toBe("pro");
  expect(first!.quota?.windows).toEqual([{ key: "5h", used: 10, cap: 100, resetAt: 1_700_000_000_000 }]);
  // 读数里没有的字段不许补 0（`percent` 缺失就是缺失）。
  expect("percent" in (first!.quota!.windows[0] ?? {})).toBe(false);
  // 另一个账号没有读数：宁可没有这个字段，也不给它一个 0 摘要。
  expect(second!.quota).toBeUndefined();
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
  expect(status.failures).toHaveLength(1);
  expect(status.failures[0]).toContain("commandcode");
  expect(status.failures[0]).toContain("quota");
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

it("额度读数归属的账号与生效账号不同时，摘要挂在读数那一行（不挪到生效账号上）", async () => {
  const engine = new RotationEngine({ order: ["a", "b"], pinned: null, rules: [] });
  engine.markRejected("a", { kind: "quota", message: "exhausted" });
  engine.pick({ model: "m", tried: new Set(["a"]) }); // 生效账号 b
  const { service } = await mount([
    // 额度端口读的是「当前选中的账号」（这里仍是 a）—— 摘要必须留在 a 行。
    vendorDeps({ vendor: "commandcode", engine, quotaRef: () => "a" }),
  ]);

  const status = await service.status("commandcode");
  expect(status.effective?.ref).toBe("b");
  expect(status.accounts[0]!.quota?.plan).toBe("pro");
  expect(status.accounts[1]!.quota).toBeUndefined();
});

it("没有在跑的账号库（引擎为空）时 status 仍可用，只是没有生效账号", async () => {
  const engine = new RotationEngine({ order: [], pinned: null, rules: [] } satisfies AccountState);
  const { service } = await mount([vendorDeps({ vendor: "commandcode", engine, views: [], quotaRef: () => undefined })]);
  const status = await service.status("commandcode");
  expect(status.accounts).toEqual([]);
  expect(status.effective).toBeUndefined();
});
