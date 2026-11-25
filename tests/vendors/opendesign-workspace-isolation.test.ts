/**
 * Open Design 多账号工作区隔离。
 *
 * 需要挡住的回归：顶层 `workspaceId` 或进程级 `discoveredWorkspace` 被某个账号的额度读取
 * 复用后，另一个账号会查到错误工作区的窗口。工作区只能来自目标账号自己的条目；只有旧
 * 单账号文档才允许顶层回退，而且额度读取不得为了补工作区去发现或写设置。
 */
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsOp } from "../../src/core/adapter";
import { opendesignWorkspaceId } from "../../src/vendors/opendesign/accounts";
import * as opendesign from "../../src/vendors/opendesign/index";

const discovery = vi.hoisted(() => ({
  discoverWorkspaceId: vi.fn(async () => "ws-discovered"),
}));

vi.mock("../../src/vendors/opendesign/login", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vendors/opendesign/login")>();
  return { ...actual, discoverWorkspaceId: discovery.discoverWorkspaceId };
});

const A = "OPENDESIGN_ACCOUNT_A";
const B = "OPENDESIGN_ACCOUNT_B";
const WALLET_BASE = "https://wallet.example.test/api/v1";

beforeEach(() => {
  discovery.discoverWorkspaceId.mockReset();
  discovery.discoverWorkspaceId.mockResolvedValue("ws-discovered");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 最小假宿主：只实现 Open Design 装配真正用到的接缝。 */
function fakeHost(services: Readonly<Record<string, unknown>> = {}): Context {
  const serviceMap = new Map(Object.entries(services));
  const host = {
    llm: { registerAdapter: () => () => undefined },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    fiber: { fake: "fiber" },
    get: (name: string): unknown => serviceMap.get(name),
    on: () => () => undefined,
    effect: (execute: () => unknown): (() => void) => {
      const dispose = execute();
      return typeof dispose === "function" ? (dispose as () => void) : () => undefined;
    },
  };
  return host as unknown as Context;
}

interface RecordedMutation {
  ns: string;
  ops: readonly SettingsOp[];
  revision: number | undefined;
}

/** 一份内存设置文档；记录所有 mutate，确保额度读取没有隐藏写入。 */
function fakeSettings(initial: Record<string, unknown>): {
  service: unknown;
  mutations: RecordedMutation[];
  valueOf(): Record<string, unknown>;
} {
  const value = { ...initial };
  const mutations: RecordedMutation[] = [];
  const service = {
    describe: () => [{ ns: "llm-opendesign", value: { ...value }, revision: 0, applies: "live" }],
    configure: () => () => undefined,
    mutate: async (ns: string, ops: readonly SettingsOp[], expected?: number): Promise<void> => {
      if (expected !== undefined && expected !== 0) throw new Error("unexpected settings revision");
      mutations.push({ ns, ops: ops.map((op) => ({ ...op })), revision: expected });
      for (const op of ops) {
        if (op.op === "set") value[op.path[0] ?? ""] = op.value;
        else delete value[op.path[0] ?? ""];
      }
    },
  };
  return { service, mutations, valueOf: () => value };
}

/** 最小假凭据服务：每个账号各有自己的控制面密钥。 */
function fakeCredentials(initial: Readonly<Record<string, string>>): unknown {
  const store = new Map(Object.entries(initial));
  return {
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
  };
}

/** 记录请求并按 URL 返回固定负载；任何未声明的 URL 都返回空对象。 */
function stubFetch(payloads: Readonly<Record<string, unknown>>): { url: string; authorization: string | undefined }[] {
  const requests: { url: string; authorization: string | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      requests.push({ url, authorization: init?.headers?.Authorization });
      return new Response(JSON.stringify(payloads[url] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  );
  return requests;
}

/** 两个有效账号的最小配置；调用方决定各自有没有工作区。 */
function account(apiKeyEnv: string, workspaceId?: string): Record<string, unknown> {
  return {
    id: apiKeyEnv,
    name: apiKeyEnv,
    apiKeyEnv,
    controlKeyEnv: `${apiKeyEnv}_CONTROL`,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
}

/** 摘要成功即可；周期额度是否发请求由 preflight URL 列表证明。 */
const SUMMARY = { membershipTier: "go", creditsPerUsd: 10_000 };

describe("opendesignWorkspaceId", () => {
  it("两个有效账号共享顶层工作区时，缺省账号不得回退到别人的工作区", () => {
    const document = {
      apiKeyEnv: A,
      workspaceId: "ws-shared",
      accounts: [account(A, "ws-A"), account(B)],
    };

    expect(opendesignWorkspaceId(document, A)).toBe("ws-A");
    expect(opendesignWorkspaceId(document, B)).toBeUndefined();
  });

  it("旧单账号文档仍允许顶层工作区回退", () => {
    expect(opendesignWorkspaceId({ apiKeyEnv: A, workspaceId: "ws-legacy", accounts: null }, A)).toBe("ws-legacy");
    expect(opendesignWorkspaceId({ workspaceId: "ws-legacy", accounts: [account(A)] }, A)).toBe("ws-legacy");
    expect(opendesignWorkspaceId({ apiKeyEnv: A, workspaceId: "ws-legacy", accounts: [account(A)] }, A)).toBe(
      "ws-legacy",
    );
  });
});

describe("额度装配的工作区隔离", () => {
  it("snapshot(B) 缺工作区时不请求 preflight，只报未配置且不写设置", async () => {
    const config = {
      enabled: true,
      apiKeyEnv: A,
      workspaceId: "ws-shared",
      walletBase: WALLET_BASE,
      accounts: [account(A, "ws-A"), account(B)],
    };
    const settings = fakeSettings(config);
    const credentials = fakeCredentials({ [`${A}_CONTROL`]: "ctrl-a", [`${B}_CONTROL`]: "ctrl-b" });
    const bundle = opendesign.apply(fakeHost({ settings: settings.service, credentials }), opendesign.Config(config));
    const requests = stubFetch({ [`${WALLET_BASE}/billing/summary`]: SUMMARY });

    const snapshot = await bundle.quota.snapshot(B);

    expect(requests).toEqual([
      { url: `${WALLET_BASE}/billing/summary`, authorization: "Bearer ctrl-b" },
    ]);
    expect(snapshot.windows).toEqual([]);
    expect(snapshot.failures).toContain("该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在设置里手填）");
    expect(settings.mutations).toEqual([]);
  });

  it("A/B 各有工作区时，preflight URL、密钥与窗口互不混用", async () => {
    const config = {
      enabled: true,
      apiKeyEnv: A,
      workspaceId: "ws-shared",
      walletBase: WALLET_BASE,
      accounts: [account(A, "ws-A"), account(B, "ws-B")],
    };
    const settings = fakeSettings(config);
    const credentials = fakeCredentials({ [`${A}_CONTROL`]: "ctrl-a", [`${B}_CONTROL`]: "ctrl-b" });
    const bundle = opendesign.apply(fakeHost({ settings: settings.service, credentials }), opendesign.Config(config));
    const requests = stubFetch({
      [`${WALLET_BASE}/billing/summary`]: SUMMARY,
      [`${WALLET_BASE}/workspaces/ws-A/billing/preflight`]: {
        codingPlan: {
          eligible: true,
          tier: "go",
          windows: [{ usedCredits: 1_000, limitCredits: 50_000, durationSeconds: 18_000, resetsAt: 1_800_000_000_000 }],
        },
      },
      [`${WALLET_BASE}/workspaces/ws-B/billing/preflight`]: {
        codingPlan: {
          eligible: true,
          tier: "go",
          windows: [{ usedCredits: 2_500, limitCredits: 50_000, durationSeconds: 18_000, resetsAt: 1_900_000_000_000 }],
        },
      },
    });

    const snapshotA = await bundle.quota.snapshot(A);
    const snapshotB = await bundle.quota.snapshot(B);

    expect(requests.filter((request) => request.url.includes("/billing/preflight"))).toEqual([
      { url: `${WALLET_BASE}/workspaces/ws-A/billing/preflight`, authorization: "Bearer ctrl-a" },
      { url: `${WALLET_BASE}/workspaces/ws-B/billing/preflight`, authorization: "Bearer ctrl-b" },
    ]);
    expect(snapshotA.windows).toEqual([{ key: "fiveHour", unit: "usd", used: 0.36, cap: 18, resetAt: 1_800_000_000_000 }]);
    expect(snapshotB.windows).toEqual([{ key: "fiveHour", unit: "usd", used: 0.9, cap: 18, resetAt: 1_900_000_000_000 }]);
    expect(settings.mutations).toEqual([]);
  });

  it("额度读取缺工作区时不调用 discoverWorkspaceId，也不写顶层", async () => {
    const config = {
      enabled: true,
      apiKeyEnv: A,
      walletBase: WALLET_BASE,
      accounts: [account(A, "ws-A"), account(B)],
    };
    const settings = fakeSettings(config);
    const credentials = fakeCredentials({ [`${A}_CONTROL`]: "ctrl-a", [`${B}_CONTROL`]: "ctrl-b" });
    const bundle = opendesign.apply(fakeHost({ settings: settings.service, credentials }), opendesign.Config(config));
    const requests = stubFetch({ [`${WALLET_BASE}/billing/summary`]: SUMMARY });

    const snapshot = await bundle.quota.snapshot(B);

    expect(discovery.discoverWorkspaceId).not.toHaveBeenCalled();
    expect(requests.some((request) => request.url.includes("/billing/preflight"))).toBe(false);
    expect(snapshot.windows).toEqual([]);
    expect(snapshot.failures).toContain("该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在设置里手填）");
    expect(settings.mutations).toEqual([]);
    expect(settings.valueOf().workspaceId).toBeUndefined();
  });

  it("旧单账号顶层回退仍能读到该账号的周期额度", async () => {
    const config = {
      enabled: true,
      apiKeyEnv: A,
      workspaceId: "ws-legacy",
      walletBase: WALLET_BASE,
      accounts: null,
    };
    const settings = fakeSettings(config);
    const credentials = fakeCredentials({ [`${A}_CONTROL`]: "ctrl-legacy" });
    const bundle = opendesign.apply(fakeHost({ settings: settings.service, credentials }), opendesign.Config(config));
    const requests = stubFetch({
      [`${WALLET_BASE}/billing/summary`]: SUMMARY,
      [`${WALLET_BASE}/workspaces/ws-legacy/billing/preflight`]: {
        codingPlan: {
          eligible: true,
          tier: "go",
          windows: [{ usedCredits: 1_000, limitCredits: 50_000, durationSeconds: 18_000, resetsAt: 1_800_000_000_000 }],
        },
      },
    });

    const snapshot = await bundle.quota.snapshot(A);

    expect(requests.filter((request) => request.url.includes("/billing/preflight"))).toEqual([
      { url: `${WALLET_BASE}/workspaces/ws-legacy/billing/preflight`, authorization: "Bearer ctrl-legacy" },
    ]);
    expect(snapshot.windows).toEqual([{ key: "fiveHour", unit: "usd", used: 0.36, cap: 18, resetAt: 1_800_000_000_000 }]);
    expect(settings.mutations).toEqual([]);
  });
});
