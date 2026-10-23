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
    // **缺省视为「同一人」**：绝大多数既有用例关心的是额度归一化/容错，不是身份闸门；
    // 多账号隔离另有专门的用例（见下方「身份闸门」一组）。
    // 生产装配必须给真实实现 —— 缺省会判成「不确定」而不采信 preflight。
    identitiesOf: async () => ({ account: "u-1", vela: "u-1" }),
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
  // **没有月度窗口**（2026-10-23）：厂商不发，我们也不再从本地套餐表补。
  // 套餐信息本身仍然发布（界面用它显示「每月 $480」这种厂商真实数据）。
  expect(wrapped.windows).toEqual([]);

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

// —— 多账号兼容：vela preflight 的身份闸门（2026-10-20）——

it("**账号与 vela 登录态不是同一人 → 不采信 preflight**（否则显示别人的用量）", async () => {
  // `vela billing preflight` 没有 --key 参数，永远用本机 vela 登录态查。
  // 网关下挂了第二个人的账号时，采信它就是「把别人的额度显示给你」——
  // 用户会照着一个不属于自己的数字安排事情，比没有数据更糟。
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT", creditsPerUsd: 10000 })]);
  const preflight = vi.fn(async () => ({
    codingPlan: { windows: [{ usedCredits: 17871, limitCredits: 50000, durationSeconds: 18000 }] },
  }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight,
      identitiesOf: async () => ({ account: "user-alice", vela: "user-bob" }),
    }),
  );
  const snapshot = await quota.snapshot();
  // 关键：**没有调用** preflight。
  expect(preflight).not.toHaveBeenCalled();
  // 周期窗口一条都没有（那是 bob 的数据，不属于 alice）。
  expect(snapshot.windows.filter((w) => w.key === "fiveHour" || w.key === "weekly")).toEqual([]);
  // 但必须说清为什么 —— 不能静默少一档。
  expect(snapshot.failures.join(" ")).toContain("不是同一个人");
  // 套餐与余额照旧（那用的是该账号自己的控制面密钥，结论准确）。
  expect(snapshot.plan).toMatchObject({ id: "GOAT" });
});

it("同一人时才采信 preflight，窗口正常出现", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT", creditsPerUsd: 10000 })]);
  const preflight = vi.fn(async () => ({
    codingPlan: {
      windows: [{ usedCredits: 17871, limitCredits: 50000, durationSeconds: 18000, resetsAt: 1_800_000_000_000 }],
    },
  }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight,
      identitiesOf: async () => ({ account: "user-same", vela: "user-same" }),
    }),
  );
  const snapshot = await quota.snapshot();
  expect(preflight).toHaveBeenCalledWith("ws-1");
  const fiveHour = snapshot.windows.find((w) => w.key === "fiveHour");
  expect(fiveHour?.used).toBe(1.7871);
  expect(fiveHour?.cap).toBe(5);
});

it("**身份读不到就当作不确定，同样不采信**（不猜）", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT" })]);
  const preflight = vi.fn(async () => ({ codingPlan: { windows: [] } }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight,
      // 缺 vela 侧身份（vela 没登录 / 命令失败）。
      identitiesOf: async () => ({ account: "user-alice" }),
    }),
  );
  const snapshot = await quota.snapshot();
  expect(preflight).not.toHaveBeenCalled();
  expect(snapshot.failures.join(" ")).toContain("无法确认");
});

it("没提供 identitiesOf 的老装配也不采信（缺省=不确定，不是「默认同一人」）", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT" })]);
  const preflight = vi.fn(async () => ({ codingPlan: { windows: [] } }));
  // 显式把 identitiesOf 去掉（`deps()` 的缺省是「同一人」，那是给额度归一化用例用的）。
  const quota = createOpenDesignQuota(
    deps(fetchImpl, { workspaceIdOf: () => "ws-1", preflight, identitiesOf: undefined }),
  );
  const snapshot = await quota.snapshot();
  expect(preflight).not.toHaveBeenCalled();
  expect(snapshot.failures.join(" ")).toContain("无法确认");
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
  // 摘要里的 10000 是**接口自己的说法**，已确认与官方文档不符（Go 的 5 小时窗口
  // 官方是 $10，而 50000 credits ÷ 10000 只有 $5）。上限以官方表为准（2026-10-21）。
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
  // 厂商只发 5 小时/7 天两个窗口 —— **只发布这两个**（2026-10-23 起不再补月度）。
  // 5 小时窗口的上限取**官方 $10**（不是 50000 ÷ 10000 = $5）；已用仍按换算率折。
  expect(snapshot.windows).toEqual([
    { key: "fiveHour", unit: "usd", used: 0.1812, cap: 10, resetAt: 1_800_000_000_000 },
  ]);
  expect(snapshot.failures).toEqual([]);
});

// 「月度上限：只按官方套餐表补」的测试已删除（2026-10-23）：那个本地补窗口的逻辑
// 本身就移除了。厂商自己发月度窗口的情形由下面「厂商自己给月度窗口时照常发布」覆盖。

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
  // 已用按「官方上限 ÷ limitCredits」折：5 小时 906/5000 = 0.1812、周 906/5000 = 0.1812。
  expect(snapshot.windows[0]).toMatchObject({ key: "fiveHour", unit: "usd", used: 0.1812, cap: 10 });
  expect(snapshot.windows[1]).toMatchObject({ key: "weekly", unit: "usd", used: 0.1812, cap: 30 });
});

// —— 2026-10-23：**不再合成月度窗口** ——
//
// 这家厂商的 `billing preflight` 只发五小时与每周两档，没有月度。此前插件从本地价格表
// (`MONTHLY_MAX_USD`) 取一个上限、再用本机台账填 `used`，凑出一个「月度条」——那个条会让人
// 误以为它是「账户月度总额度」，而实际用量只含这一台机器。用户 2026-10-23 要求去掉。

it("**不再合成月度窗口**：厂商只给两档，就只发布这两档", async () => {
  const fetchImpl = scriptedFetch([
    () => json({
      membershipTier: "go",
      subscriptionStatus: "active",
      subscriptionCurrentPeriodStart: "2026-10-18T10:21:12.000Z",
      subscriptionCurrentPeriodEnd: "2026-11-18T10:21:12.000Z",
    }),
    () =>
      json({
        codingPlan: {
          windows: [
            { usedCredits: 3298, limitCredits: 50_000, durationSeconds: 18_000 },
            { usedCredits: 91_437, limitCredits: 150_000, durationSeconds: 604_800 },
          ],
        },
      }),
  ]);
  const snapshot = await createOpenDesignQuota(deps(fetchImpl, { workspaceIdOf: () => "ws-1", preflight: async () => ({ codingPlan: { windows: [
    { usedCredits: 3298, limitCredits: 50_000, durationSeconds: 18_000 },
    { usedCredits: 91_437, limitCredits: 150_000, durationSeconds: 604_800 },
  ] } }) })).snapshot();

  expect(snapshot.windows.map((window) => window.key)).toEqual(["fiveHour", "weekly"]);
  expect(snapshot.windows.some((window) => window.key === "monthly"), "**不该再有月度窗口**").toBe(false);
  // 厂商真实数字照旧发布。
  expect(snapshot.windows[0]?.used).toBeCloseTo(0.6596, 4);
  expect(snapshot.windows[1]?.used).toBeCloseTo(18.2874, 4);
});

it("即便只拿到账单摘要（无 preflight），也不补月度窗口", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "go" })]);
  const snapshot = await createOpenDesignQuota(deps(fetchImpl)).snapshot();

  expect(snapshot.windows.some((window) => window.key === "monthly")).toBe(false);
  // 套餐信息仍然发布（那是厂商真实数据，界面用它显示「每月 $120」）。
  expect(snapshot.plan?.id).toBe("go");
});

it("厂商自己给月度窗口时**照常发布**（另外两家的情形，与本厂商无关）", async () => {
  const fetchImpl = scriptedFetch([
    () => json({ creditsPerUsd: 10, membershipTier: "go" }),
    () =>
      json({
        codingPlan: { windows: [{ usedCredits: 500, limitCredits: 1200, durationSeconds: 2_592_000 }] },
      }),
  ]);
  const snapshot = await createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight: async () => ({ codingPlan: { windows: [{ usedCredits: 500, limitCredits: 1200, durationSeconds: 2_592_000 }] } }),
    }),
  ).snapshot();

  const monthly = snapshot.windows.find((window) => window.key === "monthly");
  expect(monthly, "厂商给的月度窗口不该被吞掉").toBeDefined();
  expect(monthly?.used).toBe(50);
  expect(monthly?.usedSource, "这是官方数，不标记本机口径").toBeUndefined();
});


// —— 多账号额度诊断：说清「缺的是哪把密钥」（2026-10-21）——

it("**只有推理密钥时说明该重登一次**，不是笼统的「账单接口 401」", async () => {
  // 实测：`sk-amr_…`（推理）打控制面一律 401，只有 `vela_ctrl_…` 能通。
  // 用户切到这种账号只看到「额度读不到」时，不知道该重登还是该换账号。
  const fetchImpl = scriptedFetch([() => json({ message: "unauthorized" }, 401)]);
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      controlKeyKind: async () => "inference-only",
    }),
  );
  const snapshot = await quota.snapshot();
  const text = snapshot.failures.join(" ");
  expect(text).toContain("只有推理密钥");
  expect(text).toContain("网页登录");
  // 不能只说 401 就完事 —— 那句用户看不出该做什么。
  expect(text).not.toContain("套餐信息与额度换算单位暂时缺失");
});

it("一把密钥都没有时说清「需要先登录或填 API key」", async () => {
  const fetchImpl = scriptedFetch([() => json({ message: "unauthorized" }, 401)]);
  const quota = createOpenDesignQuota(deps(fetchImpl, { controlKeyKind: async () => "none" }));
  const snapshot = await quota.snapshot();
  expect(snapshot.failures.join(" ")).toContain("还没有任何可用密钥");
});

it("有控制面密钥但被拒时仍走旧口径（那是可重试的失败）", async () => {
  const fetchImpl = scriptedFetch([() => json({ message: "forbidden" }, 403)]);
  const quota = createOpenDesignQuota(deps(fetchImpl, { controlKeyKind: async () => "control" }));
  const snapshot = await quota.snapshot();
  expect(snapshot.failures.join(" ")).toContain("账单摘要读取失败");
});

// —— HTTP 版周期额度（2026-10-21）：多账号额度的正解 ——

it("**HTTP 周期额度优先，且不需要身份闸门**（它按账号自己的密钥鉴权）", async () => {
  // vela CLI 没有 --key，永远查本机登录态那一个人；HTTP 版按账号鉴权，
  // 所以每个账号都能拿到自己的数字，不必再核对身份。
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT", creditsPerUsd: 10000 })]);
  const velaPreflight = vi.fn(async () => ({ codingPlan: { windows: [] } }));
  const httpPreflight = vi.fn(async () => ({
    codingPlan: { windows: [{ usedCredits: 487, limitCredits: 50000, durationSeconds: 18000, resetsAt: 1_800_000_000_000 }] },
  }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight: velaPreflight,
      preflightHttp: httpPreflight,
      // 身份不一致 —— HTTP 路径**不该因此被拦**。
      identitiesOf: async () => ({ account: "user-a", vela: "user-b" }),
    }),
  );
  const snapshot = await quota.snapshot();
  expect(httpPreflight).toHaveBeenCalledWith("ws-1", "control-key-1");
  // 关键：压根没碰 vela。
  expect(velaPreflight).not.toHaveBeenCalled();
  const fiveHour = snapshot.windows.find((w) => w.key === "fiveHour");
  expect(fiveHour?.used).toBe(0.0487);
  expect(fiveHour?.cap).toBe(5);
  // 也不该出现「不是同一个人」那条失败（HTTP 已经给出了准确数据）。
  expect(snapshot.failures.join(" ")).not.toContain("不是同一个人");
});

it("HTTP 失败时**退回 vela**，那时才过身份闸门", async () => {
  const fetchImpl = scriptedFetch([() => json({ membershipTier: "GOAT", creditsPerUsd: 10000 })]);
  const velaPreflight = vi.fn(async () => ({
    codingPlan: { windows: [{ usedCredits: 100, limitCredits: 50000, durationSeconds: 18000 }] },
  }));
  const quota = createOpenDesignQuota(
    deps(fetchImpl, {
      workspaceIdOf: () => "ws-1",
      preflight: velaPreflight,
      preflightHttp: async () => {
        throw new Error("HTTP 周期额度接口返回 404");
      },
      identitiesOf: async () => ({ account: "user-a", vela: "user-b" }),
    }),
  );
  const snapshot = await quota.snapshot();
  // HTTP 失败 + 身份不一致 → vela 也不采信。
  expect(velaPreflight).not.toHaveBeenCalled();
  expect(snapshot.failures.join(" ")).toContain("不是同一个人");
});
