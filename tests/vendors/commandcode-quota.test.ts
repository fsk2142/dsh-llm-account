/**
 * Task 10 测试：Command Code 额度归一化（`toQuotaSnapshot` / `createCommandCodeQuota`）
 * 与账号端口（`createCommandCodeAccounts`：设置变更 + 意图日志 + 凭据）。
 *
 * 本地测试辅助一律写在本文件里（内存意图存储、假设置端口、假凭据服务、假 fetch），
 * 不跨任务共享（计划 Review Focus 前的说明）。
 */
import { LlmError } from "@deepseek-ai/dsh-llm";
import { expect, it } from "vitest";

import type {
  AccountView,
  CredentialPort,
  SettingsOp,
  SettingsPort,
  SettingsSnapshot,
} from "../../src/core/adapter";
import { normalizeKey } from "../../src/core/credentials";
import { IntentLog, type AccountIntent, type IntentStore } from "../../src/core/recovery";
import {
  ACTIVE_ACCOUNT_AUTO,
  COMMAND_CODE_SETTINGS_NS,
  createCommandCodeAccounts,
} from "../../src/vendors/commandcode/accounts";
import { createCommandCodeQuota, toQuotaSnapshot } from "../../src/vendors/commandcode/quota";

/** 内存意图存储：读写都收发副本。 */
function memoryStore(initial: readonly AccountIntent[] = []): {
  store: IntentStore;
  snapshot: () => AccountIntent[];
  writeCount: () => number;
} {
  let state: AccountIntent[] = initial.map((intent) => ({ ...intent }));
  let writes = 0;
  return {
    store: {
      read: async () => state.map((intent) => ({ ...intent })),
      write: async (intents) => {
        writes += 1;
        state = intents.map((intent) => ({ ...intent }));
      },
    },
    snapshot: () => state.map((intent) => ({ ...intent })),
    writeCount: () => writes,
  };
}

/** 一次被记录的设置提交：命名空间、ops、期望修订号与提交发起时的文档内容。 */
interface RecordedMutation {
  ns: string;
  ops: readonly SettingsOp[];
  revision: number;
  value: Readonly<Record<string, unknown>>;
}

/** `SettingsPort` 约定的冲突错误形状：`code` 为 `SETTINGS_CONFLICT`。 */
function settingsConflict(): Error {
  return Object.assign(new Error("llm-commandcode: settings revision conflict"), { code: "SETTINGS_CONFLICT" });
}

/** 一次 `mutate` 之前给测试的钩子（可模拟并发写者抢先提交）。 */
interface MutateHookContext {
  attempt: number;
  expectedRevision: number;
  value: Readonly<Record<string, unknown>>;
  write: (field: string, fieldValue: unknown) => void;
  bumpRevision: (by?: number) => void;
}

interface FakeSettings extends SettingsPort {
  mutations: RecordedMutation[];
  namespaces: string[];
  doc: () => Record<string, unknown>;
}

/** 应用本任务使用的一层路径 ops（与宿主设置接缝的一层字段语义一致）。 */
function applyOps(value: Record<string, unknown>, ops: readonly SettingsOp[]): Record<string, unknown> {
  const next = { ...value };
  for (const op of ops) {
    const field = op.path[0];
    if (field === undefined) continue;
    if (op.op === "set") next[field] = op.value;
    else delete next[field];
  }
  return next;
}

/**
 * 假设置端口：内存文档 + 修订号围栏。
 * @param initial - 初始文档。
 * @param beforeMutate - 每次 `mutate` 发起时调用；返回 `"conflict"` 表示本次提交撞上修订号冲突。
 */
function fakeSettings(initial: Record<string, unknown>, beforeMutate?: (context: MutateHookContext) => "conflict" | undefined): FakeSettings {
  let value: Record<string, unknown> = { ...initial };
  let revision = 3;
  const mutations: RecordedMutation[] = [];
  const namespaces: string[] = [];
  const settings: FakeSettings = {
    mutations,
    namespaces,
    doc: () => ({ ...value }),
    describe: async (ns): Promise<SettingsSnapshot> => {
      namespaces.push(ns);
      return { revision, value: { ...value } };
    },
    mutate: async (ns, ops, expected): Promise<SettingsSnapshot> => {
      namespaces.push(ns);
      mutations.push({ ns, ops, revision: expected, value: { ...value } });
      const conflict = beforeMutate?.({
        attempt: mutations.length,
        expectedRevision: expected,
        value: { ...value },
        write: (field, fieldValue) => {
          value = { ...value, [field]: fieldValue };
        },
        bumpRevision: (by = 1) => {
          revision += by;
        },
      });
      if (conflict === "conflict") throw settingsConflict();
      if (expected !== revision) throw settingsConflict();
      value = applyOps(value, ops);
      revision += 1;
      return { revision, value: { ...value } };
    },
  };
  return settings;
}

/** 假凭据服务：按契约把空值/纯空白/缺失一律判为未配置。 */
interface FakeCredentials extends CredentialPort {
  sets: { ref: string; value: string }[];
  unsets: string[];
  described: string[][];
  values: Map<string, string>;
}

function fakeCredentials(initial: Record<string, string> = {}): FakeCredentials {
  const values = new Map(Object.entries(initial));
  const sets: { ref: string; value: string }[] = [];
  const unsets: string[] = [];
  const described: string[][] = [];
  return {
    sets,
    unsets,
    described,
    values,
    resolve: async (ref) => normalizeKey(values.get(ref)),
    set: async (ref, value) => {
      const key = normalizeKey(value);
      if (key === undefined) throw new Error("credential value must not be blank");
      sets.push({ ref, value: key });
      values.set(ref, key);
    },
    unset: async (ref) => {
      unsets.push(ref);
      values.delete(ref);
    },
    describe: async (refs) => {
      described.push([...refs]);
      const info: Record<string, { configured: boolean; writable?: boolean }> = {};
      for (const ref of refs) info[ref] = { configured: normalizeKey(values.get(ref)) !== undefined, writable: true };
      return info;
    },
  };
}

/** 一条最小账号条目：身份是 `apiKeyEnv` 里的 ref。 */
function entry(label: string, ref: string): { label: string; apiKeyEnv: string } {
  return { label, apiKeyEnv: ref };
}

/** 一条被记录的额度端点调用。 */
interface QuotaCall {
  path: string;
  headers: Headers;
}

/** 按路径挑选响应的假 `fetch`；未登记的路径抛错（证明没有多余调用）。 */
function quotaFetch(routes: Record<string, () => Response>): { fetchImpl: typeof fetch; calls: QuotaCall[] } {
  const calls: QuotaCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : String(input));
    calls.push({ path: `${url.pathname}${url.search}`, headers: new Headers(init?.headers) });
    const handler = routes[`${url.pathname}${url.search}`] ?? routes[url.pathname];
    if (handler === undefined) throw new Error(`unexpected request ${url.pathname}${url.search}`);
    return handler();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 造一个 JSON 响应。 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 完整的四个端点响应（真实形状：窗口在 `windowLimits` 里，额度在 `credits` 里）。 */
function fullRoutes(): Record<string, () => Response> {
  return {
    "/alpha/whoami": () => jsonResponse({ user: { id: "u1", name: "Fsk" }, org: { id: "org_1" } }),
    "/alpha/usage/summary": () => jsonResponse({ totalCredits: 12, totalTokensIn: 10, totalTokensOut: 20 }),
    "/alpha/billing/credits": () =>
      jsonResponse({
        credits: { monthlyCredits: 100, purchasedCredits: 5, freeCredits: 1, planId: "pro" },
        windowLimits: {
          fiveHour: { used: 3, cap: 10, exceeded: false, resetAt: "2026-10-13T20:00:00Z" },
          weekly: { used: 30, cap: 100, exceeded: true, resetAt: 1_792_000_000_000 },
        },
      }),
    "/alpha/billing/subscriptions?orgId=org_1": () => jsonResponse({ data: { planId: "goat", status: "active" } }),
  };
}

/** 构造一个额度端口：`ref`/密钥可缺省，用来验证「没有可用密钥」的分支。 */
function quotaPort(
  routes: Record<string, () => Response>,
  ref: string | null = "acc-a",
  key: string | null = "sk-live",
): {
  port: ReturnType<typeof createCommandCodeQuota>;
  calls: QuotaCall[];
} {
  const resolvedRef = ref ?? undefined;
  const { fetchImpl, calls } = quotaFetch(routes);
  return {
    port: createCommandCodeQuota({
      apiBase: "https://api.example.test",
      ref: () => resolvedRef,
      resolveKey: async (candidate) => (candidate === resolvedRef ? (key ?? undefined) : undefined),
      fetchImpl,
    }),
    calls,
  };
}

it("窗口缺失时保持 undefined，不倒成 0（Review Focus 4）", () => {
  const snap = toQuotaSnapshot({ credits: { monthlyCredits: 100 }, failures: [] });
  expect(snap.windows).toEqual([]);
});

it("五小时/每周窗口映射为 used/cap/exceeded/resetAt", () => {
  const snap = toQuotaSnapshot({
    credits: { fiveHour: { used: 3, cap: 10, exceeded: false, resetAt: "2026-10-13T20:00:00Z" } },
    failures: [],
  });
  expect(snap.windows[0]).toMatchObject({ key: "fiveHour", used: 3, cap: 10, exceeded: false });
  expect(snap.windows[0].resetAt).toBe(Date.parse("2026-10-13T20:00:00Z"));
});

it("单个端点失败不拖垮整体，失败项进入 failures", () => {
  const snap = toQuotaSnapshot({ credits: { monthlyCredits: 1 }, failures: ["subscriptions"] });
  expect(snap.failures).toEqual(["subscriptions"]);
  expect(snap.windows.length).toBeGreaterThanOrEqual(0);
});

it("窗口字段逐个独立：缺失就是 undefined，不倒成 0", () => {
  const snap = toQuotaSnapshot({ credits: { windowLimits: { fiveHour: { used: 7 } } }, failures: [] });
  expect(snap.windows).toEqual([{ key: "fiveHour", used: 7 }]);
  const weekly = toQuotaSnapshot({ credits: { windowLimits: { weekly: { cap: 100 } } }, failures: [] });
  expect(weekly.windows).toEqual([{ key: "weekly", cap: 100 }]);
});

it("resetAt 一律转成 epoch 毫秒；无法解析的字符串保持 undefined", () => {
  const snap = toQuotaSnapshot({
    credits: {
      windowLimits: {
        fiveHour: { used: 1, resetAt: "2026-10-13T20:00:00Z" },
        weekly: { used: 1, resetAt: "not a date" },
      },
    },
    failures: [],
  });
  expect(snap.windows[0].resetAt).toBe(1_791_921_600_000);
  expect(snap.windows[1].resetAt).toBeUndefined();
});

it("percent 超出 0–100 视为端点未报告（契约是 0–100）", () => {
  const snap = toQuotaSnapshot({ credits: { windowLimits: { fiveHour: { used: 1, cap: 2, percent: 150 } } }, failures: [] });
  expect(snap.windows[0].percent).toBeUndefined();
  const ok = toQuotaSnapshot({ credits: { windowLimits: { fiveHour: { used: 1, cap: 2, percent: 50 } } }, failures: [] });
  expect(ok.windows[0].percent).toBe(50);
});

it("月度额度窗口用 monthlyCredits 键（单位是额度，不是 token），且只在两端都给数时出现", () => {
  const both = toQuotaSnapshot({
    usage: { totalCredits: 12 },
    credits: { credits: { monthlyCredits: 100 } },
    failures: [],
  });
  expect(both.windows).toEqual([{ key: "monthlyCredits", used: 12, cap: 100 }]);
  // 只有额度上限、没有本期消耗：不造窗口（Review Focus 4）。
  expect(toQuotaSnapshot({ credits: { credits: { monthlyCredits: 100 } }, failures: [] }).windows).toEqual([]);
  expect(toQuotaSnapshot({ usage: { totalCredits: 12 }, failures: [] }).windows).toEqual([]);
});

it("plan 取 subscriptions 的 planId，缺失时退回 credits 的 planId，都没有就缺省", () => {
  expect(toQuotaSnapshot({ subscriptions: { data: { planId: "goat" } }, credits: { credits: { planId: "pro" } }, failures: [] }).plan).toBe("goat");
  expect(toQuotaSnapshot({ subscriptions: { data: {} }, credits: { credits: { planId: "pro" } }, failures: [] }).plan).toBe("pro");
  expect("plan" in toQuotaSnapshot({ failures: [] })).toBe(false);
});

it("额度端口按旧插件的端点与请求头取数：whoami 先拿 orgId，再并行拉三个端点", async () => {
  const { port, calls } = quotaPort(fullRoutes());
  const snap = await port.snapshot();

  expect(calls.map((call) => call.path)).toEqual([
    "/alpha/whoami",
    "/alpha/usage/summary",
    "/alpha/billing/credits",
    "/alpha/billing/subscriptions?orgId=org_1",
  ]);
  for (const call of calls) {
    expect(call.headers.get("authorization")).toBe("Bearer sk-live");
    expect(call.headers.get("accept-encoding")).toBe("identity");
    expect(call.headers.get("x-command-code-version")).toBe("1.79.2");
    expect(call.headers.get("x-cli-environment")).toBe("production");
  }
  expect(snap.failures).toEqual([]);
  expect(snap.plan).toBe("goat");
  expect(snap.windows).toEqual([
    { key: "fiveHour", used: 3, cap: 10, exceeded: false, resetAt: 1_791_921_600_000 },
    { key: "weekly", used: 30, cap: 100, exceeded: true, resetAt: 1_792_000_000_000 },
    { key: "monthlyCredits", used: 12, cap: 100 },
  ]);
});

it("whoami 失败时只记名，窗口仍然返回，其余端点不带 orgId", async () => {
  const routes = fullRoutes();
  delete routes["/alpha/billing/subscriptions?orgId=org_1"];
  routes["/alpha/whoami"] = () => jsonResponse({ message: "nope" }, 500);
  routes["/alpha/billing/subscriptions"] = () => jsonResponse({ data: { planId: "goat" } });
  const { port, calls } = quotaPort(routes);

  const snap = await port.snapshot();

  expect(snap.failures).toEqual(["whoami"]);
  expect(snap.plan).toBe("goat");
  expect(snap.windows).toHaveLength(3);
  expect(calls.map((call) => call.path)).toContain("/alpha/billing/subscriptions");
});

it("四个端点各自失败只记自己的名，顺序固定、其余照常返回", async () => {
  const routes = fullRoutes();
  routes["/alpha/usage/summary"] = () => new Response("boom", { status: 503 });
  routes["/alpha/billing/credits"] = () => new Response("not json", { status: 200 });
  const { port } = quotaPort(routes);

  const snap = await port.snapshot();

  expect(snap.failures).toEqual(["usage", "credits"]);
  expect(snap.windows).toEqual([]);
  expect(snap.plan).toBe("goat");
});

it("传输抛错也只记名，不让整次读取失败", async () => {
  const routes = fullRoutes();
  routes["/alpha/usage/summary"] = () => {
    throw new Error("network down");
  };
  const { port } = quotaPort(routes);

  const snap = await port.snapshot();

  expect(snap.failures).toEqual(["usage"]);
  // usage 失败会连带没有月度额度窗口（它的 used 来自 usage），两个 token 窗口照常返回。
  expect(snap.windows).toEqual([
    { key: "fiveHour", used: 3, cap: 10, exceeded: false, resetAt: 1_791_921_600_000 },
    { key: "weekly", used: 30, cap: 100, exceeded: true, resetAt: 1_792_000_000_000 },
  ]);
});

it("没有可用密钥时抛 MISSING_CREDENTIAL，且一个端点都不请求", async () => {
  const { port, calls } = quotaPort(fullRoutes(), "acc-a", "   ");
  await expect(port.snapshot()).rejects.toBeInstanceOf(LlmError);
  const { port: noRef, calls: noRefCalls } = quotaPort(fullRoutes(), null);
  await expect(noRef.snapshot()).rejects.toMatchObject({ code: "MISSING_CREDENTIAL" });
  expect([...calls, ...noRefCalls]).toEqual([]);
});

it("CredentialPort.describe 契约：空值/纯空白/缺失的引用一律 configured: false", async () => {
  const credentials = fakeCredentials({ real: "sk-live", blank: "", spaces: "   " });

  const info = await credentials.describe(["real", "blank", "spaces", "missing"]);

  expect(Object.keys(info).sort()).toEqual(["blank", "missing", "real", "spaces"]);
  expect(info.real?.configured).toBe(true);
  expect(info.blank?.configured).toBe(false);
  expect(info.spaces?.configured).toBe(false);
  expect(info.missing?.configured).toBe(false);
  for (const value of Object.values(info)) expect(typeof value.configured).toBe("boolean");
});

it("账号操作先写意图再提交，提交成功后意图被清除（与 Task 13 同语义，Review Focus 5）", async () => {
  const store = memoryStore();
  const seenAtSubmit: AccountIntent[][] = [];
  const settings = fakeSettings({ accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] }, () => {
    seenAtSubmit.push(store.snapshot());
    return undefined;
  });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  await port.select(null);

  // 提交动作发起时，意图已经在日志里（append 先于 mutate）。
  expect(seenAtSubmit).toHaveLength(1);
  expect(seenAtSubmit[0]).toHaveLength(1);
  expect(seenAtSubmit[0][0]?.kind).toBe("select");
  // 提交成功后意图被清除（append + settle 各落盘一次）。
  expect(store.snapshot()).toEqual([]);
  expect(store.writeCount()).toBe(2);
  expect(settings.doc().activeAccount).toBe(ACTIVE_ACCOUNT_AUTO);
  expect(settings.namespaces.every((ns) => ns === COMMAND_CODE_SETTINGS_NS)).toBe(true);
});

it("remove 清掉该账号的模型规则并清理凭据", async () => {
  const store = memoryStore();
  const settings = fakeSettings({
    accounts: [entry("A", "a"), entry("B", "b")],
    modelAccountRules: [{ models: ["m1"], account: "b" }],
    activeAccount: "b",
    credentialCleanupRefs: [],
  });
  const credentials = fakeCredentials({ a: "sk-a", b: "sk-b" });
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  await port.remove("b");

  const doc = settings.doc();
  expect(doc.accounts).toEqual([entry("A", "a")]);
  expect(doc.modelAccountRules).toEqual([]);
  expect(doc.credentialCleanupRefs).toEqual(["b"]);
  // 必要时清掉当前固定账号（回到自动轮换）。
  expect(doc.activeAccount).toBe(ACTIVE_ACCOUNT_AUTO);
  // 真正删除凭据留给清理动作：本任务只记录待清理的 ref。
  expect(credentials.unsets).toEqual([]);
  expect(store.snapshot()).toEqual([]);
});

it("add 追加条目并返回新 ref，密钥只进凭据服务（设置文档里没有明文）", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  const credentials = fakeCredentials();
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  const view: AccountView = await port.add({ label: "Team A", key: "sk-live-secret" });

  expect(view.ref).toMatch(/^DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_[0-9a-f]{12}$/);
  expect(view).toMatchObject({ label: "Team A", configured: true, active: false });
  expect(settings.doc().accounts).toEqual([entry("Team A", view.ref)]);
  expect(JSON.stringify(settings.doc())).not.toContain("sk-live-secret");
  expect(credentials.sets).toEqual([{ ref: view.ref, value: "sk-live-secret" }]);
  expect(store.snapshot()).toEqual([]);
});

it("同名标签的第二个账号得到不同的 ref（不共用同一个凭据槽，Review Focus 1）", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  const first = await port.add({ label: "Team A" });
  const second = await port.add({ label: "Team A" });

  expect(second.ref).not.toBe(first.ref);
  expect(second.ref).toBe(`${first.ref}_2`);
  expect(settings.doc().accounts).toEqual([entry("Team A", first.ref), entry("Team A", second.ref)]);
});

it("rename 只改 label，绝不重新推导 ref，也不丢条目上的其它字段", async () => {
  const store = memoryStore();
  const settings = fakeSettings({
    accounts: [{ label: "old", apiKeyEnv: "a", note: "keep" }],
    activeAccount: ACTIVE_ACCOUNT_AUTO,
    modelAccountRules: [],
  });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials({ a: "sk-a" }),
    intents: new IntentLog(store.store),
  });

  await port.rename("a", "new");

  expect(settings.doc().accounts).toEqual([{ label: "new", apiKeyEnv: "a", note: "keep" }]);
});

it("replaceKey 走凭据服务，不写设置文档", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [entry("A", "a")], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  const credentials = fakeCredentials({ a: "sk-old" });
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  await port.replaceKey("a", "sk-new");

  expect(credentials.sets).toEqual([{ ref: "a", value: "sk-new" }]);
  expect(settings.mutations).toEqual([]);
  expect(store.snapshot()).toEqual([]);
});

it("select 写 activeAccount：ref 固定该账号，null 回到自动轮换", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [entry("A", "a")], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  await port.select("a");
  expect(settings.doc().activeAccount).toBe("a");
  await port.select(null);
  expect(settings.doc().activeAccount).toBe(ACTIVE_ACCOUNT_AUTO);
});

it("list 用 CredentialPort.describe 填充 configured 与 active，空值不算已配置", async () => {
  const store = memoryStore();
  const settings = fakeSettings({
    accounts: [entry("A", "a"), entry("B", "b"), entry("C", "c")],
    activeAccount: "b",
    modelAccountRules: [],
  });
  const credentials = fakeCredentials({ a: "sk-a", c: "   " });
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  const views = await port.list();

  expect(views).toEqual([
    { ref: "a", label: "A", configured: true, active: false },
    { ref: "b", label: "B", configured: false, active: true },
    { ref: "c", label: "C", configured: false, active: false },
  ]);
  expect(credentials.described).toEqual([["a", "b", "c"]]);
});

it("list 在凭据服务漏报某个 ref 时按未配置处理，重复 ref 只保留第一个", async () => {
  const store = memoryStore();
  const settings = fakeSettings({
    accounts: [entry("A", "a"), entry("A2", "a")],
    activeAccount: ACTIVE_ACCOUNT_AUTO,
    modelAccountRules: [],
  });
  const omitting: CredentialPort = {
    resolve: async () => undefined,
    set: async () => {},
    unset: async () => {},
    describe: async () => ({}),
  };
  const port = createCommandCodeAccounts({ settings, credentials: omitting, intents: new IntentLog(store.store) });

  expect(await port.list()).toEqual([{ ref: "a", label: "A", configured: false, active: false }]);
});

it("move 不实现（能力声明已关闭）", () => {
  const store = memoryStore();
  const port = createCommandCodeAccounts({
    settings: fakeSettings({ accounts: [] }),
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });
  expect(port.move).toBeUndefined();
});

it("设置修订号冲突时重读并重放，而不是覆盖对方写入（Review Focus 5）", async () => {
  const store = memoryStore();
  const settings = fakeSettings(
    { accounts: [entry("A", "a")], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] },
    (context) => {
      if (context.attempt !== 1) return undefined;
      // 另一个写者抢先提交：加了账号 c，并把修订号从 3 推进到 7。
      context.write("accounts", [entry("A", "a"), entry("C", "c")]);
      context.bumpRevision(4);
      return "conflict";
    },
  );
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  const view = await port.add({ label: "Team B" });

  // 冲突后重新 describe 拿到 7，再用 7 重放本次操作。
  expect(settings.mutations.map((mutation) => mutation.revision)).toEqual([3, 7]);
  const accounts = settings.doc().accounts as readonly { label: string; apiKeyEnv: string }[];
  // 对方的写入没有被覆盖，本次操作也在里面。
  expect(accounts.map((item) => item.apiKeyEnv)).toEqual(["a", "c", view.ref]);
  // 意图只追加一次，收尾一次。
  expect(store.writeCount()).toBe(2);
  expect(store.snapshot()).toEqual([]);
});
