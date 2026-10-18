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
import { accountRef } from "../../src/core/accounts";
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

it("月度窗口只报消耗（monthlyCredits 是余额）：没有 cap、没有 percent，不造比例（Review Focus 4）", () => {
  const both = toQuotaSnapshot({
    usage: { totalCredits: 12 },
    credits: { credits: { monthlyCredits: 100 } },
    failures: [],
  });
  expect(both.windows).toEqual([{ key: "monthlyCredits", used: 12 }]);
  // 月度配给总数在第 1 期未知（套餐表是第 2 期），而 monthlyCredits 是余额：拿它当 cap
  // 会把「快用完」画成百分之几百，所以这里 cap 与 percent 都必须是「未报告」。
  expect(both.windows[0]?.cap).toBeUndefined();
  expect(both.windows[0]?.percent).toBeUndefined();
  // 窗口只依赖 usage 的消耗：credits 没给余额（甚至整个端点失败）也照样产出。
  expect(toQuotaSnapshot({ usage: { totalCredits: 12 }, failures: [] }).windows).toEqual([
    { key: "monthlyCredits", used: 12 },
  ]);
  // 只有余额、没有本期消耗：不造窗口（缺失不倒成 0）。
  expect(toQuotaSnapshot({ credits: { credits: { monthlyCredits: 100 } }, failures: [] }).windows).toEqual([]);
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
    { key: "monthlyCredits", used: 12 },
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
  // 月度消耗窗口的 used 来自 usage，它失败就没有这个窗口；两个 token 窗口照常返回。
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

it("setAutoSwitch 写自动切换开关：意图先落库、提交后清除，字段写进设置文档（§4.2 的 C）", async () => {
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

  await port.setAutoSwitch!(false);

  // 提交动作发起时，意图已经在日志里（append 先于 mutate）。
  expect(seenAtSubmit).toHaveLength(1);
  expect(seenAtSubmit[0]).toEqual([expect.objectContaining({ kind: "auto-switch", value: false })]);
  // 提交成功后意图被清除（append + settle 各落盘一次）。
  expect(store.snapshot()).toEqual([]);
  expect(store.writeCount()).toBe(2);
  expect(settings.doc().autoSwitch).toBe(false);
  expect(settings.namespaces.every((ns) => ns === COMMAND_CODE_SETTINGS_NS)).toBe(true);
  // 2026-10-17 起 Command Code 也支持手动排序（`reorder: true`），`move` 必须存在。
  expect(typeof port.move).toBe("function");
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

it("add 在写意图之前解析 ref：意图带着最终 ref，提交用的就是它（重放因此按 ref 对齐）", async () => {
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

  const view = await port.add({ label: "Team A" });

  // 提交动作发起时，意图已经在日志里，而且已经带着这次提交真正使用的 ref。
  expect(seenAtSubmit).toHaveLength(1);
  expect(seenAtSubmit[0]).toEqual([expect.objectContaining({ kind: "add", ref: view.ref, label: "Team A" })]);
  expect(settings.doc().accounts).toEqual([entry("Team A", view.ref)]);
  expect(store.snapshot()).toEqual([]);
});

it("重放一条「设置已提交、凭据写入失败」的 add 意图：按 ref 对齐即无操作，不产生重复账号", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  const credentials = fakeCredentials();
  // 模拟崩溃点：设置条目已提交，凭据写入失败，意图因此没有被收尾（留给重放）。
  credentials.set = async () => {
    throw new Error("credential store down");
  };
  const intents = new IntentLog(store.store);
  const port = createCommandCodeAccounts({ settings, credentials, intents });

  await expect(port.add({ label: "Team A", key: "sk-live" })).rejects.toThrow("credential store down");

  const committed = settings.doc().accounts as readonly { label: string; apiKeyEnv: string }[];
  const pending = store.snapshot();
  expect(committed).toHaveLength(1);
  expect(pending).toHaveLength(1);
  // 意图里带着已提交条目的 ref：重放不用按 label 猜（同名标签合法，猜就会造重复账号）。
  expect(pending[0]).toMatchObject({ kind: "add", ref: committed[0]?.apiKeyEnv, label: "Team A" });

  // 重放 apply（Task 14 的契约形状）：按意图里的 ref 对齐；条目已存在就是「已提交」。
  const apply = async (intent: AccountIntent): Promise<"applied" | "unknown"> => {
    if (intent.ref === undefined) return "unknown";
    const accounts = settings.doc().accounts as readonly { label: string; apiKeyEnv: string }[];
    return accounts.some((item) => item.apiKeyEnv === intent.ref) ? "applied" : "unknown";
  };
  const report = await intents.replay(apply);

  expect(report).toEqual({ applied: 1, rejected: 0, unknown: 0, remaining: 0 });
  // 无操作：没有重放出第二个账号条目。
  expect(settings.doc().accounts).toEqual([entry("Team A", committed[0]?.apiKeyEnv ?? "")]);
  expect(store.snapshot()).toEqual([]);
});

it("没有空闲 ref 时在写意图之前失败：日志里不留一条永远应用不了的意图", async () => {
  const store = memoryStore();
  // 占满 freeRef 的全部候选：基础 ref 与 _2…_128（accounts.ts 的 MAX_REF_ATTEMPTS = 128）。
  const first = accountRef("commandcode", "Team A");
  const occupied = [first, ...Array.from({ length: 127 }, (_, index) => `${first}_${index + 2}`)];
  const settings = fakeSettings({
    accounts: occupied.map((ref) => entry("Team A", ref)),
    activeAccount: ACTIVE_ACCOUNT_AUTO,
    modelAccountRules: [],
  });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  await expect(port.add({ label: "Team A" })).rejects.toThrow(/no free credential reference/);

  // 校验跑在 append 之前：一次都没落盘，没有提交，也没有未决意图。
  expect(store.writeCount()).toBe(0);
  expect(store.snapshot()).toEqual([]);
  expect(settings.mutations).toEqual([]);
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

it("并发同标签的两个 add 冻结到同一个 ref：文档里只有一个条目，凭据槽最多写一次（Review Focus 1）", async () => {
  const ref = accountRef("commandcode", "Team A");
  const settings = fakeSettings({ accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] });
  // 显式造出**真实**的交错：把第一次 mutate 停在「两个 add 都已经从**还没有提交**的文档里
  // 冻结出 ref」之后 —— 意图日志里出现第二条意图（两个 add 都已经 append）即放行。
  // 于是两次调用都冻结到同一个确定性 ref（正是重复条目的来源），而第一次提交一定发生在
  // 第二次读取之后。它证明的是「提交按最新文档再判一次身份」这道闸门；它不依赖微任务
  // 调度的运气（不靠 Promise.all 的偶然顺序）。
  let parked = false;
  let release: () => void = () => {};
  const bothFrozen = new Promise<void>((resolve) => {
    release = resolve;
  });
  const innerMutate = settings.mutate.bind(settings);
  settings.mutate = async (ns, ops, expected) => {
    if (!parked) {
      parked = true;
      await bothFrozen;
    }
    return innerMutate(ns, ops, expected);
  };
  let state: AccountIntent[] = [];
  const store: IntentStore = {
    read: async () => state.map((intent) => ({ ...intent })),
    write: async (intents) => {
      state = intents.map((intent) => ({ ...intent }));
      if (state.length >= 2) release();
    },
  };
  const credentials = fakeCredentials();
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store) });

  const [first, second] = await Promise.all([
    port.add({ label: "Team A", key: "sk-first" }),
    port.add({ label: "Team A", key: "sk-second" }),
  ]);

  // 两次都冻结到同一个确定性 ref —— 没有闸门时文档会变成 `[R, R]`。
  expect([first.ref, second.ref]).toEqual([ref, ref]);
  expect(settings.doc().accounts).toEqual([entry("Team A", ref)]);
  // 文档只被提交一次：判定为「已成立」的那次不落盘（空 ops 不是一次空写）。
  expect(settings.mutations).toHaveLength(1);
  // 没有追加条目的那次不再写凭据槽：槽里最多一个值，两个密钥不会互相覆盖。
  expect(credentials.sets).toHaveLength(1);
  expect(credentials.sets[0]?.ref).toBe(ref);
  expect(["sk-first", "sk-second"]).toContain(credentials.sets[0]?.value);
  // 两条意图都被收尾。
  expect(state).toEqual([]);
});

it("冲突重试时冻结的 ref 已经在文档里：不再追加条目、不再写凭据槽（幂等提交）", async () => {
  const ref = accountRef("commandcode", "Team A");
  const settings = fakeSettings(
    { accounts: [], activeAccount: ACTIVE_ACCOUNT_AUTO, modelAccountRules: [] },
    (context) => {
      if (context.attempt !== 1) return undefined;
      // 另一个写者抢先提交了**同一个 ref**（标签相同 → 确定性 ref 相同），修订号 3 → 7。
      context.write("accounts", [entry("Team A", ref)]);
      context.bumpRevision(4);
      return "conflict";
    },
  );
  const store = memoryStore();
  const credentials = fakeCredentials();
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  const view = await port.add({ label: "Team A", key: "sk-live" });

  expect(view.ref).toBe(ref);
  // 重试读到的文档里已经有这个 ref：不追加第二个条目（只 submit 了一次）。
  expect(settings.mutations).toHaveLength(1);
  expect(settings.doc().accounts).toEqual([entry("Team A", ref)]);
  // 也没有写凭据槽（槽归抢先的写者），视图如实报告未配置。
  expect(credentials.sets).toEqual([]);
  expect(view).toMatchObject({ label: "Team A", configured: false, active: false });
  expect(store.snapshot()).toEqual([]);
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

  // 默认槽不再合成：只列 accounts[] 里的真实账号。
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

  expect(await port.list()).toEqual([
    { ref: "a", label: "A", configured: false, active: false },
  ]);
});

it("用户真实形状：顶层默认槽不在 accounts[] 时不再显示，只显示真实账号", async () => {
  const store = memoryStore();
  // 用户 profile patch 里的真实 commandcode 行：顶层 apiKeyEnv 是旧「默认」槽，
  // accounts[] 里另有一个账号，activeAccount 指向默认槽。
  const settings = fakeSettings({
    apiKeyEnv: "COMMANDCODE_API_KEY",
    accounts: [entry("sample-user-2", "COMMANDCODE_API_KEY_2")],
    activeAccount: "default",
    modelAccountRules: [],
  });
  const credentials = fakeCredentials({ COMMANDCODE_API_KEY: "sk-default", COMMANDCODE_API_KEY_2: "sk-2" });
  const port = createCommandCodeAccounts({ settings, credentials, intents: new IntentLog(store.store) });

  // 没有合成的 Default 行；真实账号按名字显示。
  expect(await port.list()).toEqual([
    { ref: "COMMANDCODE_API_KEY_2", label: "sample-user-2", configured: true, active: false },
  ]);
});

it("真账号条目占用了顶层默认 ref 时不合成第二行（同 ref 不重复）", async () => {
  const store = memoryStore();
  const settings = fakeSettings({
    apiKeyEnv: "COMMANDCODE_API_KEY",
    accounts: [entry("A", "COMMANDCODE_API_KEY")],
    activeAccount: "COMMANDCODE_API_KEY",
    modelAccountRules: [],
  });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials({ COMMANDCODE_API_KEY: "sk-a" }),
    intents: new IntentLog(store.store),
  });

  // 只有真条目那一行：它是真账号（可改名/可移除），合成的默认槽只是「顶层 ref 不在账号表里」
  // 时的补位。
  expect(await port.list()).toEqual([{ ref: "COMMANDCODE_API_KEY", label: "A", configured: true, active: true }]);
  await port.select("COMMANDCODE_API_KEY");
  expect(settings.doc().activeAccount).toBe("COMMANDCODE_API_KEY");
});

it("move 写 accountOrder 覆盖，且不改当前账号", async () => {
  const store = memoryStore();
  const settings = fakeSettings({ accounts: [entry("A", "a"), entry("B", "b")], activeAccount: "b" });
  const port = createCommandCodeAccounts({
    settings,
    credentials: fakeCredentials(),
    intents: new IntentLog(store.store),
  });

  await port.move!("b", 0);

  // 顺序 = 顶层默认账号 + accounts[]（默认槽只参与轮换，不再显示成账号行）。
  expect(settings.doc().accountOrder).toEqual(["b", "COMMANDCODE_API_KEY", "a"]);
  // 排序不换号：当前账号仍是用户选的那个。
  expect(settings.doc().activeAccount).toBe("b");
  expect((await port.list()).map((view) => view.ref)).toEqual(["b", "a"]);
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

it("snapshot(ref) 用指定账号的密钥，而不是当前 ref getter", async () => {
  const { fetchImpl, calls } = quotaFetch(fullRoutes());
  const port = createCommandCodeQuota({
    apiBase: "https://api.example.test",
    ref: () => "acc-a",
    resolveKey: async (ref) => (ref === "acc-b" ? "sk-b" : undefined),
    fetchImpl,
  });

  await port.snapshot("acc-b");

  expect(calls.some((call) => call.headers.get("authorization")?.includes("sk-b"))).toBe(true);
});