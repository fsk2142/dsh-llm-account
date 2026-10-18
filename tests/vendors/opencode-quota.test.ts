/**
 * Task 13 测试：opencode 额度归一化（`toQuotaSnapshot` / `createOpencodeQuota`）与账号端口
 * （`createOpencodeAccounts`：设置变更 + 意图日志 + 凭据）。
 *
 * 本地测试辅助一律写在本文件里（内存意图存储、假设置端口、假凭据服务、假 fetch），
 * 不跨任务共享。测试**不**跨文件复用 commandcode 的辅助：两个厂商的设置文档字段不同
 * （opencode 是旧插件的 `{ id, name, apiKeyEnv }` + 顶层 `apiKeyEnv` 当前账号），
 * 共享辅助会让其中一边把另一边的字段形状当成契约。
 */
import { LlmError } from "@deepseek-ai/dsh-llm";
import { expect, it } from "vitest";

import type { AccountView, CredentialPort, SettingsOp, SettingsPort, SettingsSnapshot } from "../../src/core/adapter";
import { normalizeKey } from "../../src/core/credentials";
import { IntentLog, type AccountIntent, type IntentStore } from "../../src/core/recovery";
import {
  MAX_ACCOUNTS,
  OPENCODE_DEFAULT_REF,
  OPENCODE_SETTINGS_NS,
  createOpencodeAccounts,
  opencodeAccountRef,
} from "../../src/vendors/opencode/accounts";
import { DEFAULT_USAGE_TIMEOUT_MS, USAGE_MAX_BYTES, OpencodeUsageError, createOpencodeQuota, toQuotaSnapshot } from "../../src/vendors/opencode/quota";

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
  return Object.assign(new Error("llm-opencode-go: settings revision conflict"), { code: "SETTINGS_CONFLICT" });
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
 * 假设置端口：内存文档 + 修订号围栏（初始修订号 3，每次成功提交推进 1）。
 * @param initial - 初始文档。
 * @param beforeMutate - 每次 `mutate` 发起时调用；返回 `"conflict"` 表示本次提交撞上修订号冲突。
 */
function fakeSettings(
  initial: Record<string, unknown>,
  beforeMutate?: (context: MutateHookContext) => "conflict" | undefined,
): FakeSettings {
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

/** 一条最小账号条目：身份是 `apiKeyEnv` 里的 ref（旧插件的条目字段是 id/name/apiKeyEnv）。 */
function entry(name: string, ref: string): { id: string; name: string; apiKeyEnv: string } {
  return { id: ref, name, apiKeyEnv: ref };
}

/** 默认文档：没有账号、当前账号是旧插件的默认引用名。 */
function emptyDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { apiKeyEnv: OPENCODE_DEFAULT_REF, accounts: null, autoSwitch: false, ...extra };
}

/** 造一个账号端口。 */
function accountsPort(doc: Record<string, unknown>, credentials = fakeCredentials(), store = memoryStore()): {
  port: ReturnType<typeof createOpencodeAccounts>;
  settings: FakeSettings;
  credentials: FakeCredentials;
  store: ReturnType<typeof memoryStore>;
} {
  const settings = fakeSettings(doc);
  return {
    port: createOpencodeAccounts({ settings, credentials, intents: new IntentLog(store.store) }),
    settings,
    credentials,
    store,
  };
}

/** 一条被记录的额度端点调用。 */
interface QuotaCall {
  path: string;
  headers: Headers;
  redirect: string | undefined;
}

/**
 * 按**末尾路径段**挑选响应的假 `fetch`（基地址带 `/zen/go/v1` 前缀，所以路由按末段登记）；
 * 未登记的路径抛错（证明没有多余调用）。
 */
function quotaFetch(routes: Record<string, () => Response>): { fetchImpl: typeof fetch; calls: QuotaCall[] } {
  const calls: QuotaCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const path = `${url.pathname}${url.search}`;
    calls.push({ path, headers: new Headers(init?.headers), redirect: init?.redirect });
    const tail = url.pathname.slice(url.pathname.lastIndexOf("/")) + url.search;
    const handler = routes[path] ?? routes[tail];
    if (handler === undefined) throw new Error(`unexpected request ${path}`);
    return handler();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 造一个 JSON 响应。 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 一条完整的三窗口读数（真实形状：窗口在顶层 `usage` 对象里）。 */
function fullUsage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usage: {
      source: "src-1",
      rolling: { status: "ok", percent: 42, resetsAt: "2026-10-13T20:00:00Z" },
      weekly: { status: "ok", percent: 10, resetsAt: "2026-10-14T00:00:00Z" },
      monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-11-01T00:00:00Z" },
      ...overrides,
    },
  };
}

/** 构造一个额度端口：`ref`/密钥可缺省，用来验证「没有可用密钥」的分支。 */
function quotaPort(
  payload: Record<string, unknown> | (() => Response),
  ref: string | null = "acc-a",
  key: string | null = "sk-live",
): { port: ReturnType<typeof createOpencodeQuota>; calls: QuotaCall[] } {
  const resolvedRef = ref ?? undefined;
  const routes = { "/usage": typeof payload === "function" ? payload : () => jsonResponse(payload) };
  const { fetchImpl, calls } = quotaFetch(routes);
  return {
    port: createOpencodeQuota({
      apiBase: "https://opencode.ai/zen/go/v1",
      ref: () => resolvedRef,
      resolveKey: async (candidate) => (candidate === resolvedRef ? (key ?? undefined) : undefined),
      fetchImpl,
    }),
    calls,
  };
}

it("rolling/weekly/monthly 的 percent 与 resetsAt 被保留；缺失窗口不补 0（Review Focus 4）", () => {
  const snap = toQuotaSnapshot({ usage: { rolling: { status: "ok", percent: 42, resetsAt: "2026-10-13T20:00:00Z" } } });
  expect(snap.windows).toHaveLength(1);
  expect(snap.windows[0]).toMatchObject({ key: "rolling", percent: 42 });
  // `QuotaWindow.resetAt` 是 epoch 毫秒，端点的 `resetsAt` 是 ISO 字符串。
  expect(snap.windows[0].resetAt).toBe(Date.parse("2026-10-13T20:00:00Z"));
  // 没有公布的窗口不造出来。
  expect(snap.windows.map((window) => window.key)).toEqual(["rolling"]);
});

it("rate-limited 状态带 exceeded 标记", () => {
  const snap = toQuotaSnapshot({ usage: { weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-14T00:00:00Z" } } });
  expect(snap.windows[0].exceeded).toBe(true);

  const ok = toQuotaSnapshot({ usage: { weekly: { status: "ok", percent: 10, resetsAt: "2026-10-14T00:00:00Z" } } });
  expect(ok.windows[0].exceeded).toBe(false);
});

it("三个窗口齐全时按 rolling/weekly/monthly 顺序输出，缺失的窗口保持缺席", () => {
  const snap = toQuotaSnapshot(fullUsage());
  expect(snap.windows.map((window) => window.key)).toEqual(["rolling", "weekly", "monthly"]);
  expect(snap.windows.map((window) => window.percent)).toEqual([42, 10, 100]);
  expect(snap.windows.map((window) => window.resetAt)).toEqual([
    Date.parse("2026-10-13T20:00:00Z"),
    Date.parse("2026-10-14T00:00:00Z"),
    Date.parse("2026-11-01T00:00:00Z"),
  ]);
  // 窗口之外没有别的字段被编造（`plan` 只有厂商公布时才在）。
  expect("plan" in snap).toBe(false);
  expect(snap.failures).toEqual([]);

  // 只有 weekly：其余两个不补 0、不补当前时间。
  const only = toQuotaSnapshot({ usage: { weekly: { status: "ok", percent: 3, resetsAt: "2026-10-14T00:00:00Z" } } });
  expect(only.windows).toEqual([{ key: "weekly", percent: 3, exceeded: false, resetAt: 1_791_936_000_000 }]);
});

it("负载整体认不出来是一个已分类的失败，而不是干净的空读数（形状漂移不覆盖旧读数）", async () => {
  // 旧插件 `parseGoUsage` 对 `body.usage` 不合法一律抛 `Invalid OpenCode Go usage response`
  // （第 7925-7934 行）：这里的判定与它一致。
  for (const payload of [undefined, null, {}, { usage: 7 }, { usage: "rolling" }, []]) {
    expect(() => toQuotaSnapshot(payload)).toThrow(OpencodeUsageError);
  }
  expect(() => toQuotaSnapshot({ usage: 7 })).toThrow(/Invalid OpenCode Go usage response/);
  try {
    toQuotaSnapshot(undefined);
    expect.unreachable("认不出来的负载必须抛错");
  } catch (error) {
    expect(error).toMatchObject({
      code: "opencode-go/usage-unavailable",
      retryable: true,
      retainPrevious: false,
    });
  }

  // 端口的同一条路径：200 + 认不出来的正文 → 已分类的失败（不是空读数）。
  const { port, calls } = quotaPort({ usage: 7 });
  await expect(port.snapshot()).rejects.toMatchObject({ retryable: true, retainPrevious: false });
  expect(calls).toHaveLength(1);
  // 既不是空读数，也不是传输失败。
  await expect(quotaPort({ usage: 7 }).port.snapshot()).rejects.not.toThrow(/transport failure/);

  // **合法但空**的一种形状：`usage` 是对象而三个窗口一个都没有 —— 端点明确说「当前没有
  // 窗口数据」，空读数是诚实的。
  expect(toQuotaSnapshot({ usage: {} })).toEqual({ windows: [], failures: [] });
  expect(await quotaPort({ usage: {} }).port.snapshot()).toEqual({ windows: [], failures: [] });
});

it("形状不认识或字段非法的窗口被丢弃并记名，而不是倒成 0（整份读数照常返回）", () => {
  // 窗口字段存在但值是 `undefined`：端点没公布这个窗口，不造窗口也不记名。
  expect(toQuotaSnapshot({ usage: { rolling: undefined } })).toEqual({ windows: [], failures: [] });

  // percent 超出 0–100 / resetsAt 解析不了：这条窗口数据不可信，丢弃并记名。
  const badPercent = toQuotaSnapshot({ usage: { rolling: { status: "ok", percent: 150, resetsAt: "2026-10-13T20:00:00Z" } } });
  expect(badPercent.windows).toEqual([]);
  expect(badPercent.failures).toEqual(["rolling"]);

  const badReset = toQuotaSnapshot({ usage: { weekly: { status: "ok", percent: 1, resetsAt: "not a date" } } });
  expect(badReset.windows).toEqual([]);
  expect(badReset.failures).toEqual(["weekly"]);

  const badStatus = toQuotaSnapshot({ usage: { monthly: { status: "unknown", percent: 1, resetsAt: "2026-11-01T00:00:00Z" } } });
  expect(badStatus.windows).toEqual([]);
  expect(badStatus.failures).toEqual(["monthly"]);

  // 同一份读数里好窗口照常返回，坏的只记自己的名。
  const mixed = toQuotaSnapshot({
    usage: {
      rolling: { status: "ok", percent: 42, resetsAt: "2026-10-13T20:00:00Z" },
      weekly: { status: "ok", percent: "10", resetsAt: "2026-10-14T00:00:00Z" },
    },
  });
  expect(mixed.windows.map((window) => window.key)).toEqual(["rolling"]);
  expect(mixed.failures).toEqual(["weekly"]);
});

it("额度端口按旧插件的端点与请求头取数：GET /usage、Bearer、10s 预算、redirect: error", async () => {
  const { port, calls } = quotaPort(fullUsage());

  const snap = await port.snapshot();

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe("/zen/go/v1/usage");
  expect(calls[0]?.headers.get("authorization")).toBe("Bearer sk-live");
  expect(calls[0]?.headers.get("accept")).toBe("application/json");
  expect(calls[0]?.redirect).toBe("error");
  expect(DEFAULT_USAGE_TIMEOUT_MS).toBe(10_000);
  expect(USAGE_MAX_BYTES).toBe(1024 * 1024);
  expect(snap.windows.map((window) => window.key)).toEqual(["rolling", "weekly", "monthly"]);

  const { port: noRef, calls: noRefCalls } = quotaPort(fullUsage(), null);
  await expect(noRef.snapshot()).rejects.toMatchObject({ code: "opencode-go/usage-unavailable", retryable: false, retainPrevious: false });
  const { port: blankKey, calls: blankCalls } = quotaPort(fullUsage(), "acc-a", "   ");
  await expect(blankKey.snapshot()).rejects.toBeInstanceOf(LlmError);
  // 没有可用密钥时一个端点都不请求。
  expect([...calls, ...noRefCalls, ...blankCalls]).toHaveLength(1);
});

it("错误语义照旧插件：408/429/5xx 可重试并保留上一次读数，其它状态不可重试", async () => {
  const { port: temporary } = quotaPort(() => new Response("busy", { status: 429 }));
  await expect(temporary.snapshot()).rejects.toMatchObject({
    code: "opencode-go/usage-unavailable",
    retryable: true,
    retainPrevious: true,
    failure: { status: 429 },
  });

  const { port: server } = quotaPort(() => new Response("boom", { status: 503 }));
  await expect(server.snapshot()).rejects.toMatchObject({ retryable: true, retainPrevious: true });

  const { port: permanent } = quotaPort(() => new Response("nope", { status: 404 }));
  await expect(permanent.snapshot()).rejects.toMatchObject({ retryable: false, retainPrevious: false, failure: { status: 404 } });

  // 传输失败可重试且保留上一次读数；正文不是 JSON 时不可保留（旧插件 `invalid` 分支）。
  const { port: transport } = quotaPort(() => {
    throw new Error("network down");
  });
  await expect(transport.snapshot()).rejects.toMatchObject({ retryable: true, retainPrevious: true });

  const { port: invalidJson } = quotaPort(() => new Response("not json", { status: 200 }));
  await expect(invalidJson.snapshot()).rejects.toMatchObject({ retryable: true, retainPrevious: false });

  // 响应体超过字节上限：RangeError 分支，可重试、不保留（旧插件 `USAGE_MAX_BYTES`）。
  const { port: tooBig, calls } = quotaPort(() => {
    const oversized = new Response("{}", { status: 200 });
    oversized.headers.set("content-length", String(USAGE_MAX_BYTES + 1));
    return oversized;
  });
  await expect(tooBig.snapshot()).rejects.toMatchObject({ retryable: true, retainPrevious: false });
  // 状态是 200：字节上限必须在读正文之前就按 content-length 拦住。
  expect(calls).toHaveLength(1);
});

it("凭据解析抛错也必须是已分类的失败：可重试、不保留，并保留原始 cause（旧插件第 7865-7873 行）", async () => {
  const outage = new Error("credential store down");
  const { fetchImpl, calls } = quotaFetch({ "/usage": () => jsonResponse(fullUsage()) });
  const port = createOpencodeQuota({
    apiBase: "https://opencode.ai/zen/go/v1",
    ref: () => "acc-a",
    resolveKey: async () => {
      throw outage;
    },
    fetchImpl,
  });

  // 裸抛出去调用方既拿不到 code，也不知道该不该重试、该不该保留上一次读数。
  await expect(port.snapshot()).rejects.toBeInstanceOf(OpencodeUsageError);
  await expect(port.snapshot()).rejects.toMatchObject({
    code: "opencode-go/usage-unavailable",
    retryable: true,
    retainPrevious: false,
    cause: outage,
  });
  // 解析都没成功：一个请求都不发。
  expect(calls).toEqual([]);

  // 相反的一支：凭据服务明确说「这个账号没配密钥」（`MISSING_CREDENTIAL`）→ 重试没意义。
  const missing = Object.assign(new Error("no credential"), { code: "MISSING_CREDENTIAL" });
  const explicit = createOpencodeQuota({
    apiBase: "https://opencode.ai/zen/go/v1",
    ref: () => "acc-a",
    resolveKey: async () => {
      throw missing;
    },
    fetchImpl,
  });
  await expect(explicit.snapshot()).rejects.toMatchObject({
    code: "opencode-go/usage-unavailable",
    retryable: false,
    retainPrevious: false,
  });
});

it("上限 20 个账号", () => {
  // 旧插件 `MAX_ACCOUNTS` 第 6780 行。拒绝的姿态在下面两条测试里（预检路径 + append 之后
  // 的并发路径），这里只钉住这个契约常量。
  expect(MAX_ACCOUNTS).toBe(20);
});

it("账号操作先写意图再提交，提交成功后意图被清除", async () => {
  const store = memoryStore();
  const seenAtSubmit: AccountIntent[][] = [];
  const settings = fakeSettings(emptyDoc(), () => {
    seenAtSubmit.push(store.snapshot());
    return undefined;
  });
  const port = createOpencodeAccounts({ settings, credentials: fakeCredentials(), intents: new IntentLog(store.store) });

  await port.setAutoSwitch!(true);

  // 提交动作发起时，意图已经在日志里（append 先于 mutate）。
  expect(seenAtSubmit).toHaveLength(1);
  expect(seenAtSubmit[0]).toEqual([expect.objectContaining({ kind: "auto-switch", value: true })]);
  // 提交成功后意图被清除（append + settle 各落盘一次）。
  expect(store.snapshot()).toEqual([]);
  expect(store.writeCount()).toBe(2);
  expect(settings.doc().autoSwitch).toBe(true);
  expect(settings.namespaces.every((ns) => ns === OPENCODE_SETTINGS_NS)).toBe(true);
});

it("add 追加条目并返回新 ref，密钥只进凭据服务（设置文档里没有明文）", async () => {
  const { port, settings, credentials, store } = accountsPort(emptyDoc());

  const view: AccountView = await port.add({ label: "Team A", key: "sk-live-secret" });

  // ref 用旧插件的槽名前缀，新账号零迁移；哈希后缀让「转义后同名」仍是两个 ref。
  expect(view.ref).toMatch(/^DSH_OPENCODE_GO_ACCOUNT_TEAM_A_[0-9a-f]{12}$/);
  expect(view.ref).toBe(opencodeAccountRef("Team A"));
  expect(view).toMatchObject({ label: "Team A", configured: true, active: true });
  expect(settings.doc().accounts).toEqual([entry("Team A", view.ref)]);
  expect(JSON.stringify(settings.doc())).not.toContain("sk-live-secret");
  expect(credentials.sets).toEqual([{ ref: view.ref, value: "sk-live-secret" }]);
  expect(store.snapshot()).toEqual([]);
});

it("add 在写意图之前解析 ref：意图带着最终 ref，提交用的就是它（重放因此按 ref 对齐）", async () => {
  const store = memoryStore();
  const seenAtSubmit: AccountIntent[][] = [];
  const settings = fakeSettings(emptyDoc(), () => {
    seenAtSubmit.push(store.snapshot());
    return undefined;
  });
  const port = createOpencodeAccounts({ settings, credentials: fakeCredentials(), intents: new IntentLog(store.store) });

  const view = await port.add({ label: "Team A" });

  expect(seenAtSubmit).toHaveLength(1);
  expect(seenAtSubmit[0]).toEqual([expect.objectContaining({ kind: "add", ref: view.ref, label: "Team A" })]);
  expect(settings.doc().accounts).toEqual([entry("Team A", view.ref)]);
  expect(store.snapshot()).toEqual([]);
});

it("rename 只改 label，绝不重新推导 ref，也不丢条目上的其它字段", async () => {
  const { port, settings } = accountsPort(emptyDoc({ accounts: [{ id: "a", name: "old", apiKeyEnv: "a", note: "keep" }] }));

  await port.rename("a", "new");

  expect(settings.doc().accounts).toEqual([{ id: "a", name: "new", apiKeyEnv: "a", note: "keep" }]);
});

it("add 在 ref 撞名时按旧插件的办法加数字后缀，同名标签不共用凭据槽（Review Focus 1）", async () => {
  const { port, settings } = accountsPort(emptyDoc());

  const first = await port.add({ label: "Team A" });
  const second = await port.add({ label: "Team A" });

  expect(second.ref).not.toBe(first.ref);
  expect(second.ref).toBe(`${first.ref}_2`);
  expect(settings.doc().accounts).toEqual([entry("Team A", first.ref), entry("Team A", second.ref)]);

  // 标签不同、转义后同名：哈希后缀仍然把它们分开。
  const third = await port.add({ label: "Team-A" });
  expect(third.ref).not.toBe(first.ref);
  expect(third.ref).toMatch(/^DSH_OPENCODE_GO_ACCOUNT_TEAM_A_[0-9a-f]{12}$/);
});

it("replaceKey 走凭据服务，不写设置文档", async () => {
  const { port, settings, credentials, store } = accountsPort(
    emptyDoc({ accounts: [entry("A", "a")], apiKeyEnv: "a" }),
    fakeCredentials({ a: "sk-old" }),
  );

  await port.replaceKey("a", "sk-new");

  expect(credentials.sets).toEqual([{ ref: "a", value: "sk-new" }]);
  expect(settings.mutations).toEqual([]);
  expect(store.snapshot()).toEqual([]);
});

it("select 写当前账号：ref 固定该账号，null 回到默认引用名（自动轮换）", async () => {
  const { port, settings } = accountsPort(emptyDoc({ accounts: [entry("A", "a"), entry("B", "b")] }));

  await port.select("a");
  expect(settings.doc().apiKeyEnv).toBe("a");

  await port.select(null);
  expect(settings.doc().apiKeyEnv).toBe(OPENCODE_DEFAULT_REF);

  await expect(port.select("missing")).rejects.toThrow(/unknown account ref/);
});

it("remove 移除条目、清掉当前账号标记，并把 ref 记入待清理列表（其它字段原样保留）", async () => {
  const { port, settings, credentials, store } = accountsPort(
    emptyDoc({
      // 目标条目带一个本模块不认识的字段：写回应原样保留（只摘掉目标条目本身）。
      accounts: [{ id: "a", name: "A", apiKeyEnv: "a", note: "keep" }, entry("B", "b")],
      apiKeyEnv: "b",
      // opencode 真实的旁边字段（旧插件第 6819 行）：本模块不碰它。
      modelVisibility: { "model-1": true },
      credentialCleanupRefs: [],
    }),
    fakeCredentials({ a: "sk-a", b: "sk-b" }),
  );

  await port.remove("b");

  const doc = settings.doc();
  expect(doc.accounts).toEqual([{ id: "a", name: "A", apiKeyEnv: "a", note: "keep" }]);
  expect(doc.modelVisibility).toEqual({ "model-1": true });
  expect(doc.credentialCleanupRefs).toEqual(["b"]);
  // 当前账号指向被删的条目：回落到剩下的第一个账号。
  expect(doc.apiKeyEnv).toBe("a");
  // 真正删除凭据留给清理动作：本任务只记录待清理的 ref。
  expect(credentials.unsets).toEqual([]);
  expect(store.snapshot()).toEqual([]);

  // 幂等：重放一次已提交的移除不再产生提交。
  const before = settings.mutations.length;
  await port.remove("b");
  expect(settings.mutations).toHaveLength(before);

  // 删空最后一个账号：当前账号回到默认引用名（自动轮换）。
  await port.remove("a");
  expect(settings.doc().accounts).toEqual([]);
  expect(settings.doc().apiKeyEnv).toBe(OPENCODE_DEFAULT_REF);
  expect(settings.doc().credentialCleanupRefs).toEqual(["b", "a"]);
});

it("move 支持排序（opencode 的能力清单里 reorder 为真），并把当前账号跟到队首", async () => {
  const { port, settings } = accountsPort(emptyDoc({ accounts: [entry("A", "a"), entry("B", "b"), entry("C", "c")] }));

  await port.move!("c", 0);

  expect(settings.doc().accounts).toEqual([entry("C", "c"), entry("A", "a"), entry("B", "b")]);
  // 旧插件的 move 同时把当前账号指向队首（第 8451-8453 行）。
  expect(settings.doc().apiKeyEnv).toBe("c");
  expect(port.move).toBeTypeOf("function");

  // 位置没变：不落盘（幂等提交，不白白推进修订号）。
  const before = settings.mutations.length;
  await port.move!("c", 0);
  expect(settings.mutations).toHaveLength(before);
});

it("move 只差「成为当前账号」时也落盘：数组顺序没变不跳过 apiKeyEnv（晋升依赖这一步）", async () => {
  // 最常见的多账号形状：顶层当前账号 + 账号表里**只有一条**备用账号。此时把备用账号
  // 移到 0 位，数组顺序是恒等的 —— 但「成为当前账号」（写顶层 apiKeyEnv）正是这次
  // 操作的全部意义。旧实现只要顺序没变就整体返回空 ops，晋升于是静默失效。
  const { port, settings } = accountsPort(
    emptyDoc({ accounts: [entry("B", "b")], apiKeyEnv: "a" }),
  );

  await port.move!("b", 0);

  // 文档里只该多出 apiKeyEnv 一步（accounts 不该被无谓重写、推进修订号）。
  expect(settings.doc().accounts).toEqual([entry("B", "b")]);
  expect(settings.doc().apiKeyEnv).toBe("b");

  // 已经是当前账号又已在队首：什么都不写（幂等，不白白推进修订号）。
  const before = settings.mutations.length;
  await port.move!("b", 0);
  expect(settings.mutations).toHaveLength(before);
});

it("move 不丢条目：读不出 ref 的与重复 ref 的条目原样缀在末尾", async () => {
  // 手改坏的文档形状：一条读不出 ref（非对象）、一条与 "a" 重复 ref。
  const broken = { id: "a-again", name: "A again", apiKeyEnv: "a" };
  const unreadable = { id: "x", name: "X" };
  const { port, settings } = accountsPort(emptyDoc({ accounts: [entry("A", "a"), broken, entry("B", "b"), unreadable] }));

  await port.move!("b", 0);

  const accounts = settings.doc().accounts as unknown[];
  // 可读的按新顺序，重复与读不出 ref 的原样保留。
  expect(accounts).toEqual([entry("B", "b"), entry("A", "a"), broken, unreadable]);
});

it("list 用 CredentialPort.describe 填充 configured 与 active，空值不算已配置", async () => {
  const { port } = accountsPort(
    emptyDoc({ accounts: [entry("A", "a"), entry("B", "b"), entry("C", "c")], apiKeyEnv: "b" }),
    fakeCredentials({ a: "sk-a", c: "   " }),
  );

  const views = await port.list();

  // 顶层 `apiKeyEnv` 是 "b"，而 "b" 已经在账号表里 → 不合成默认槽行（同一 ref 不重复）。
  // **当前账号显示在第一行**（旧插件 `accountsOf` + `moveAccountFirst` 的同一派生：
  // 「第一行成为当前账号」），其余账号相对顺序不变 —— 派生，不写设置。
  expect(views).toEqual([
    { ref: "b", label: "B", configured: false, active: true },
    { ref: "a", label: "A", configured: true, active: false },
    { ref: "c", label: "C", configured: false, active: false },
  ]);
});

it("list 的当前账号提位是派生：不改设置文档，select 之后顺序随即跟上", async () => {
  const { port, settings } = accountsPort(emptyDoc({ accounts: [entry("A", "a"), entry("B", "b"), entry("C", "c")] }));

  // 文档顺序原样不动（提位只发生在读侧）。
  expect(settings.doc().accounts).toEqual([entry("A", "a"), entry("B", "b"), entry("C", "c")]);
  expect((await port.list()).map((view) => view.ref)).toEqual(["a", "b", "c"]);

  await port.select("c");
  // 一次 select（写顶层引用）之后，列表顺序随即反映新当前账号；文档里 accounts 的顺序没变。
  expect((await port.list()).map((view) => view.ref)).toEqual(["c", "a", "b"]);
  expect(settings.doc().accounts).toEqual([entry("A", "a"), entry("B", "b"), entry("C", "c")]);
});

it("用户真实形状（没有 accounts 键）：没有账号就是没有", async () => {
  // 用户 profile patch 里的真实 opencode 行：根本没有 `accounts` 键，只有顶层 `apiKeyEnv`。
  const { port } = accountsPort(
    { apiKeyEnv: "OPENCODE_API_KEY", autoSwitch: true },
    fakeCredentials({ OPENCODE_API_KEY: "sk-live" }),
  );

  // 不再合成 default 行；顶层 apiKeyEnv 仍可作为宿主的回退凭据，但账号列表为空。
  expect(await port.list()).toEqual([]);
});

it("当前账号已在账号表里时不合成第二行（真条目仍是可改名的那一行）", async () => {
  const { port, settings } = accountsPort(
    emptyDoc({ accounts: [entry("Work", "OPENCODE_API_KEY_2")], apiKeyEnv: "OPENCODE_API_KEY_2" }),
  );

  expect(await port.list()).toEqual([
    { ref: "OPENCODE_API_KEY_2", label: "Work", configured: false, active: true },
  ]);
  await port.rename("OPENCODE_API_KEY_2", "Renamed");
  expect(settings.doc().accounts).toEqual([
    { id: "OPENCODE_API_KEY_2", name: "Renamed", apiKeyEnv: "OPENCODE_API_KEY_2" },
  ]);
});

it("账号表在 append 之前就已经满：add 直接拒绝，一个字节都不写", async () => {
  // 这是**预检**路径（append 之前的校验）：拒绝时日志与设置都没有被碰过。
  const existing = Array.from({ length: MAX_ACCOUNTS }, (_, index) => entry(`A${index}`, `A${index}`));
  const { port, settings, store } = accountsPort(emptyDoc({ accounts: existing }));

  await expect(port.add({ label: "One more" })).rejects.toThrow(/at most 20 accounts/);

  expect(store.writeCount()).toBe(0);
  expect(store.snapshot()).toEqual([]);
  expect(settings.mutations).toEqual([]);
  expect((settings.doc().accounts as readonly unknown[]).length).toBe(MAX_ACCOUNTS);
});

it("并发填满账号表时收尾先于抛出：那条 add 意图不会留在日志里拖停整轮回放", async () => {
  // 起点 19 个：`add` 的预检通过（预检只看提交之前的文档），所以这次拒绝一定发生在
  // **append 之后**的复核里 —— 也就是把意图留在日志里的那条路径。
  const existing = Array.from({ length: MAX_ACCOUNTS - 1 }, (_, index) => entry(`A${index}`, `A${index}`));
  const store = memoryStore();
  const settings = fakeSettings(emptyDoc({ accounts: existing, credentialCleanupRefs: [] }));
  const intents = new IntentLog(store.store);
  const port = createOpencodeAccounts({ settings, credentials: fakeCredentials(), intents });

  // 在本端口提交之前，让并发的另一个写者把第 20 个账号提交掉：本端口的复核因此撞上满表。
  const innerMutate = settings.mutate.bind(settings);
  let filled = false;
  settings.mutate = async (ns, ops, expected) => {
    if (!filled) {
      filled = true;
      await innerMutate(ns, [{ op: "set", path: ["accounts"], value: [...existing, entry("Other", "Other")] }], expected);
    }
    return innerMutate(ns, ops, expected);
  };

  // 收尾发生在抛出之前：调用方看到的是「满表拒绝」，而不是一条没法处理的收尾错误。
  await expect(port.add({ label: "Team A" })).rejects.toThrow(/at most 20 accounts/);

  // 提交被拒：账号表保持对方写的 20 个，本端口一个条目都没加。
  expect((settings.doc().accounts as readonly unknown[]).length).toBe(MAX_ACCOUNTS);
  expect(settings.doc().accounts).not.toContainEqual(entry("Team A", opencodeAccountRef("Team A")));
  // 关键断言：那条已经 append 的意图必须在抛出之前被收尾，否则 `replay` 每次 apply 都会
  // 再抛一次同样的错（`IntentLog.replay` 不吞 apply 的错误），一条意图拖停整轮回放。
  expect(await intents.list()).toEqual([]);
  // 收尾是一次真实落盘（append 1 次 + settle 1 次），不是「假装收尾」。
  expect(store.writeCount()).toBe(2);
});

it("设置修订号冲突时重读并重放，而不是覆盖对方写入（Review Focus 5）", async () => {
  const store = memoryStore();
  const seenAtSubmit: AccountIntent[][] = [];
  const settings = fakeSettings(
    emptyDoc({ accounts: [entry("A", "a")] }),
    (context) => {
      if (context.attempt !== 1) return undefined;
      // 另一个写者抢先提交：加了账号 c，并把修订号从 3 推进到 7。
      context.write("accounts", [entry("A", "a"), entry("C", "c")]);
      context.bumpRevision(4);
      seenAtSubmit.push(store.snapshot());
      return "conflict";
    },
  );
  const port = createOpencodeAccounts({ settings, credentials: fakeCredentials(), intents: new IntentLog(store.store) });

  const view = await port.add({ label: "Team B" });

  // 冲突后重新 describe 拿到 7，再用 7 重放本次操作。
  expect(settings.mutations.map((mutation) => mutation.revision)).toEqual([3, 7]);
  const accounts = settings.doc().accounts as readonly { apiKeyEnv: string }[];
  // 对方的写入没有被覆盖，本次操作也在里面。
  expect(accounts.map((item) => item.apiKeyEnv)).toEqual(["a", "c", view.ref]);
  // 重放仍然带意图日志：两次提交发起时意图都在日志里（append 先于 mutate 的次序没被颠倒）。
  expect(seenAtSubmit).toHaveLength(1);
  expect(store.snapshot()).toEqual([]);
  // 意图只追加一次、收尾一次。
  expect(store.writeCount()).toBe(2);
});
