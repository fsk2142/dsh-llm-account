/**
 * Open Design 额度归一化测试（`toQuotaSnapshot` / `createOpenDesignQuota`）。
 *
 * 覆盖厂商事实（施工单 §0、§2.5）对应的三条口径：
 * 1. 有 `creditsPerUsd` → 美元口径的 `used`/`cap`（带 `unit: "usd"`）；
 * 2. 没有换算率 → 百分比口径（绝不无单位地摆信用点）；超过上限是读数（`exceeded`），不是错误；
 * 3. 每个来源各自失败只记一句人话，缺失不倒 0；缺控制面密钥时一个端点都不请求
 *    （`MISSING_CREDENTIAL`）。
 *
 * 本地测试辅助写在本文件里，不跨任务共享。
 */
import { LlmError } from "@deepseek-ai/dsh-llm";
import { expect, it, vi } from "vitest";

import { DEFAULT_WALLET_BASE_URL, createOpenDesignQuota, toQuotaSnapshot } from "../../src/vendors/opendesign/quota";

/** 一次被记录的请求（URL + 是否带 Authorization 头）。 */
interface RecordedRequest {
  url: string;
  authorization: string | undefined;
}

/** 按脚本回放的假 fetch：每个脚本项对应一次请求；用完再要就抛。 */
function scriptedFetch(script: readonly (() => Response | never)[]): typeof fetch & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const impl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url: String(input), authorization: headers.Authorization });
    const next = script[index];
    index += 1;
    if (next === undefined) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch & { requests: RecordedRequest[] };
  impl.requests = requests;
  return impl;
}

/** 200 JSON。 */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** 端口的最小依赖（密钥解析与工作区都走可控注入）。 */
function deps(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof createOpenDesignQuota>[0]> = {}) {
  return {
    ref: () => "OPENDESIGN_API_KEY",
    resolveControlKey: async () => "control-key-1",
    workspaceIdOf: () => undefined,
    fetchImpl,
    ...overrides,
  };
}

// —— 纯函数：两个来源的负载 → 归一化读数 ——

it("有换算率：preflight 窗口按美元口径折算（unit: usd），5 小时/7 天映射成归一化键", () => {
  const snapshot = toQuotaSnapshot({
    summary: { creditsPerUsd: 10, membershipTier: "GOAT", subscriptionStatus: "active" },
    preflight: {
      codingPlan: {
        windows: [
          { usedCredits: 24, limitCredits: 140, durationSeconds: 18_000, resetsAt: 1_800_000_000_000 },
          { usedCredits: 142, limitCredits: 350, durationSeconds: 604_800 },
        ],
      },
    },
    failures: [],
  });
  expect(snapshot.windows).toEqual([
    { key: "fiveHour", unit: "usd", used: 2.4, cap: 14, resetAt: 1_800_000_000_000 },
    { key: "weekly", unit: "usd", used: 14.2, cap: 35 },
  ]);
  // 套餐：标识即展示名（厂商没有单独的展示名），状态与本期结束原样透传。
  expect(snapshot.plan).toEqual({ id: "GOAT", name: "GOAT", status: "active" });
  expect(snapshot.failures).toEqual([]);
});

it("没有换算率：百分比口径；超过上限是读数（exceeded），不是错误", () => {
  const snapshot = toQuotaSnapshot({
    summary: { membershipTier: "team" },
    preflight: {
      codingPlan: {
        windows: [
          { usedCredits: 30, limitCredits: 40, durationSeconds: 18_000 },
          { usedCredits: 90, limitCredits: 40, durationSeconds: 86_400 },
          { usedCredits: 5 },
        ],
      },
    },
    failures: [],
  });
  expect(snapshot.windows).toEqual([
    { key: "fiveHour", percent: 75 },
    { key: "86400", percent: 100, exceeded: true },
    { key: "" },
  ]);
  // 只给了状态/标识其一的摘要也产出套餐；两个都没有才是没有订阅。
  expect(snapshot.plan).toEqual({ id: "team", name: "team" });
});

it("data 包装与 data: null：剥一层拿里层；null 是「没有数据」而不是读失败", () => {
  const wrapped = toQuotaSnapshot({
    summary: { data: { membershipTier: "pro", subscriptionCurrentPeriodEnd: "2026-11-14T00:00:00Z" } },
    failures: [],
  });
  // 状态缺失就是缺省（不补 "unknown"），标识与本期结束照常。
  expect(wrapped.plan).toMatchObject({ id: "pro", name: "pro" });
  expect(wrapped.plan?.status).toBeUndefined();
  expect(wrapped.plan?.periodEnd).toBe(Date.parse("2026-11-14T00:00:00Z"));
  // 没有 preflight 也有一行：套餐是 `pro`，月度上限 $480（`used` 读不到就留空），
  // 重置时刻就是订阅本期结束（不编别的日期）。
  expect(wrapped.windows).toEqual([
    { key: "monthly", unit: "usd", cap: 480, resetAt: Date.parse("2026-11-14T00:00:00Z") },
  ]);

  const nulled = toQuotaSnapshot({ summary: { data: null }, failures: [] });
  expect(nulled.plan).toBeUndefined();
});

it("端点失败只记人话：账单摘要读不到时窗口照常（preflight 的），一个字都不编", () => {
  const snapshot = toQuotaSnapshot({
    preflight: { codingPlan: { windows: [{ usedCredits: 1, limitCredits: 2, durationSeconds: 18_000 }] } },
    failures: ["账单摘要读取失败：套餐信息与额度换算单位暂时缺失"],
  });
  expect(snapshot.failures).toEqual(["账单摘要读取失败：套餐信息与额度换算单位暂时缺失"]);
  // 没有换算率 → 百分比口径（不会因为摘要缺席就把信用点当美元摆）。
  expect(snapshot.windows).toEqual([{ key: "fiveHour", percent: 50 }]);
});

// —— 端口：snapshot() 的顺序与失败处置 ——

it("snapshot：先解析控制面密钥，再打账单摘要；请求带控制面密钥的 Bearer 头", async () => {
  const fetchImpl = scriptedFetch([
    () => json({ data: { membershipTier: "GOAT", subscriptionStatus: "active", creditsPerUsd: 10 } }),
  ]);
  const preflight = vi.fn(async () => ({
    codingPlan: { windows: [{ usedCredits: 24, limitCredits: 140, durationSeconds: 18_000 }] },
  }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, { workspaceIdOf: () => "ws-1", preflight, walletBase: "https://wallet.example.test/api/v1/" }),
  );

  const snapshot = await quota.snapshot();
  // 基地址末尾斜杠被去掉；两个端点各打一次（本端口只直接打摘要，preflight 是注入的）。
  expect(fetchImpl.requests).toEqual([
    { url: "https://wallet.example.test/api/v1/billing/summary", authorization: "Bearer control-key-1" },
  ]);
  expect(preflight).toHaveBeenCalledWith("ws-1");
  expect(snapshot.windows).toEqual([{ key: "fiveHour", unit: "usd", used: 2.4, cap: 14 }]);
  expect(snapshot.plan).toMatchObject({ id: "GOAT" });
  expect(snapshot.failures).toEqual([]);
});

it("snapshot(ref)：读指定账号（切换策略用），控制面槽按那个账号解析", async () => {
  const seen: string[] = [];
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "pro" })]);
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      ref: () => "should-not-be-used",
      resolveControlKey: async (ref) => {
        seen.push(ref);
        return "key-for-work";
      },
    }),
  );
  await quota.snapshot("OPENDESIGN_ACCOUNT_WORK_ab12cd_CONTROL");
  // 端口把调用方给的 ref 原样交给密钥解析（装配层负责把控制面槽解析好）。
  expect(seen).toEqual(["OPENDESIGN_ACCOUNT_WORK_ab12cd_CONTROL"]);
  expect(fetchImpl.requests[0]?.authorization).toBe("Bearer key-for-work");
});

it("缺控制面密钥：抛 MISSING_CREDENTIAL，一个端点都不请求", async () => {
  const fetchImpl = scriptedFetch([]);
  const quota = createOpenDesignQuota(deps(fetchImpl, { resolveControlKey: async () => undefined }));
  await expect(quota.snapshot()).rejects.toMatchObject({ code: "MISSING_CREDENTIAL" });
  expect(fetchImpl.requests).toEqual([]);
  expect(() => {
    throw new LlmError("x", "MISSING_CREDENTIAL");
  }).toThrow(LlmError); // 形状自检：错误码走 LlmError
});

it("账单摘要非 2xx / 传输失败：记一句人话（**带原因**），其余照常返回", async () => {
  // 原因必须上屏：被拒（401/403）与不可达是两种处置 —— 用户报障「套餐信息也没有」时，
  // 只有一句「没有数据」谁也判断不了该换密钥还是该查网络。
  const notOk = scriptedFetch([() => json({ error: "upstream" }, 502)]);
  const quota = createOpenDesignQuota(deps(notOk));
  const snapshot = await quota.snapshot();
  expect(snapshot.failures[0]).toContain("账单摘要读取失败");
  expect(snapshot.failures[0]).toContain("HTTP 502");
  expect(snapshot.windows).toEqual([]);
  expect(snapshot.plan).toBeUndefined();

  const thrown = scriptedFetch([
    () => {
      throw new Error("network down");
    },
  ]);
  const broken = createOpenDesignQuota(deps(thrown));
  expect((await broken.snapshot()).failures[0]).toContain("账单接口不可达");
});

it("vela preflight 失败只记失败，不拖垮整体、不倒成 0", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT", creditsPerUsd: 10 })]);
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight: async () => {
        throw new Error("vela not found");
      },
    }),
  );
  const snapshot = await quota.snapshot();
  expect(snapshot.failures).toEqual(["周期额度查询失败：vela not found"]);
  expect(snapshot.plan).toMatchObject({ id: "GOAT" });
  // 窗口整条缺席（不是 0）——「读不到」与「没有」必须分得开。
  expect(snapshot.windows).toEqual([]);
});

it("没配 workspaceId 时不查询 vela，但必须说明为什么没有额度窗口", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT" })]);
  const preflight = vi.fn(async () => ({}));
  const quota = createOpenDesignQuota(deps(fetchImpl, { workspaceIdOf: () => undefined, preflight }));
  const snapshot = await quota.snapshot();
  expect(preflight).not.toHaveBeenCalled();
  // 窗口只来自 vela 的 codingPlan：没有工作区就一条都没有。以前这里是静默跳过，
  // 界面上「没读到」与「厂商没有」长得一样 —— 用户只会说「没获取到额度」。
  expect(snapshot.windows).toEqual([]);
  expect(snapshot.failures).toEqual([
    "该账号未配置工作区：周期额度需要 workspaceId（网页登录会自动写入，也可在设置里手填）",
  ]);
  // 套餐信息照旧读到了（账单摘要不依赖工作区）。
  expect(snapshot.plan).toMatchObject({ id: "GOAT" });
});

it("默认基地址是控制面入口（与推理基地址分开）", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT" })]);
  const quota = createOpenDesignQuota(deps(fetchImpl));
  await quota.snapshot();
  expect(fetchImpl.requests[0]?.url).toBe(`${DEFAULT_WALLET_BASE_URL}/billing/summary`);
});

it("套餐字段宽容读取：tier/plan/status 与 subscription 子对象都认（名字对不上不该整块消失）", async () => {
  const alias = scriptedFetch([() => json({ plan: "GOAT", status: "active", currentPeriodEnd: "2026-11-14T03:23:00Z" })]);
  const fromAlias = await createOpenDesignQuota(deps(alias)).snapshot();
  expect(fromAlias.plan).toMatchObject({ id: "GOAT", name: "GOAT", status: "active" });
  expect(fromAlias.plan?.periodEnd).toBeGreaterThan(0);

  const nested = scriptedFetch([() => json({ subscription: { tier: "PRO", status: "trialing" } })]);
  const fromNested = await createOpenDesignQuota(deps(nested)).snapshot();
  expect(fromNested.plan).toMatchObject({ id: "PRO", status: "trialing" });

  // 一个都不认：不造套餐（「缺失」与「有套餐但没名字」必须分得开）。
  const empty = scriptedFetch([() => json({ creditsPerUsd: 10 })]);
  expect((await createOpenDesignQuota(deps(empty)).snapshot()).plan).toBeUndefined();
});

it("工作区可以是异步发现的（网页登录产物不带 workspaceId）：解析出来后照常查 vela", async () => {
  const preflight = vi.fn(async () => ({
    codingPlan: { windows: [{ usedCredits: 906, limitCredits: 50_000, durationSeconds: 18_000, resetsAt: 1_800_000_000_000 }] },
  }));
  // 真实换算率（`/billing/summary` 实测）：10000 credits = 1 美元。
  const fetchImpl = scriptedFetch([() => json({ creditsPerUsd: 10_000, membershipTier: "go" })]);
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      // 装配层在缺省时会去问 vela（`team-projects list`），所以这里返回的是 Promise。
      workspaceIdOf: async () => "ws-discovered",
      preflight,
    }),
  );

  const snapshot = await quota.snapshot();
  expect(preflight).toHaveBeenCalledWith("ws-discovered");
  // 厂商只发 5 小时/7 天两个窗口；套餐是 `go`，所以末尾补一行**月度上限**（$120），
  // 用量读不到就留空（`used` 缺席），绝不编一个 0。
  expect(snapshot.windows).toEqual([
    { key: "fiveHour", unit: "usd", used: 0.0906, cap: 5, resetAt: 1_800_000_000_000 },
    { key: "monthly", unit: "usd", cap: 120 },
  ]);
  expect(snapshot.failures).toEqual([]);
});

it("月度上限：只按官方套餐表补，认不出的套餐不补；已有月度窗口不重复补", () => {
  // Go：$120（open-design.ai/model-credits 的 Plan 表）。
  expect(toQuotaSnapshot({ summary: { membershipTier: "go" }, failures: [] }).windows).toEqual([
    { key: "monthly", unit: "usd", cap: 120 },
  ]);
  // 认不出的套餐（旧快照 / 新套餐）：不编数字。
  expect(toQuotaSnapshot({ summary: { membershipTier: "enterprise-x" }, failures: [] }).windows).toEqual([]);
  // 厂商自己发了月度窗口（2592000 秒）就不补。
  const snapshot = toQuotaSnapshot({
    summary: { membershipTier: "go", creditsPerUsd: 10_000 },
    preflight: { codingPlan: { windows: [{ usedCredits: 1000, limitCredits: 5000, durationSeconds: 2_592_000 }] } },
    failures: [],
  });
  expect(snapshot.windows).toEqual([{ key: "monthly", unit: "usd", used: 0.1, cap: 0.5 }]);
});

it("preflight 的数字是字符串（\"906\"/\"50000\"）：照样折算成美元读数，不能只剩重置时间", () => {
  // 2026-10-18 真机实测：`vela billing preflight --format json` 里 usedCredits / limitCredits
  // 是字符串。只认 number 时窗口只有 resetAt，界面显示「有额度条但没有额度信息」。
  const snapshot = toQuotaSnapshot({
    summary: { creditsPerUsd: 10_000, membershipTier: "go" },
    preflight: {
      codingPlan: {
        windows: [
          { usedCredits: "906", limitCredits: "50000", durationSeconds: 18_000, resetsAt: "2026-10-18T15:21:12.000Z" },
          { usedCredits: "906", limitCredits: "150000", durationSeconds: 604_800, resetsAt: "2026-10-25T10:21:12.000Z" },
        ],
      },
    },
    failures: [],
  });
  expect(snapshot.windows[0]).toMatchObject({ key: "fiveHour", unit: "usd", used: 0.0906, cap: 5 });
  expect(snapshot.windows[1]).toMatchObject({ key: "weekly", unit: "usd", used: 0.0906, cap: 15 });
});
