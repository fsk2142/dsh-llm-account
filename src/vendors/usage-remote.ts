/**
 * 宿主侧的**账号中心远程命名空间**：把两个厂商的账号、额度与轮换观测状态合成一个远程面，
 * 供客户端（统一设置页、侧边栏额度卡片、中栏仪表盘）读取。
 *
 * 为什么需要一个**共享**服务：本包只有一个客户端 bundle，两个 profile 行都要读同一份数据，
 * 而且「生效账号/切换记录」天然是跨行的（规格 §8.1 第 1、3、4 条要的是「当前到底谁在服务」）。
 * 所以服务键只有一个，第一行创建实例、第二行复用（`ctx.get` 判定，见 `applyUsageRemote`）。
 *
 * **接缝状态（2026-10-24 更正）**：这里原本标着「未验证」，那已经过时 —— 用量面板
 * 在真机上一直正常取数。下面记录的来源仍然有效（作为「为什么这样接」的依据）：
 * - `ctx.inject(["typert"], …)` + `remoteCtx.typert.register(contribution)` 的形状逐字取自本机
 *   已装的 `@mars-sea/dsh-commandcode-provider/lib/index.js:8965-8976`；
 * - `super(ctx, key, { namespace })` 的绑定由 `TypertRemoteService` 基类盖上（同文件 8841-8843）。
 * @module dsh-llm-account/src/vendors/usage-remote
 */
import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { readFile } from "node:fs/promises";

import type {
  AccountPort,
  AccountView,
  CatalogModel,
  CatalogModelsResult,
  CredentialPort,
  LoginPort,
  LoginStatus,
  ModelRule,
  QuotaPort,
  QuotaSnapshot,
  VendorCapabilities,
  VendorId,
} from "../core/adapter";
import type { RotationAccess } from "./assembly";
import type { SwitchDecision, SwitchRuntimeState, SwitchSettingsWrite } from "../core/switching/settings";
import {
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  USAGE_SERVICE_KEY,
  usageDescriptors,
  type AccountUsageStatus,
  type AddAccountInput,
  type QuotaSummary,
  type SwitchNowResult,
  type SwitchRecord,
  type UsageInvocationDescriptor,
  type UsageReportView,
  type UsageWindowView,
  type VendorUsageStatus,
} from "../client/usage-contract";
import { lastUsedAccountOf } from "../core/last-used";
import { ledgerCsvOf, exportTailOf } from "../core/usage/export";
import { failureBreakdownOf, failureBreakdownPerAccount } from "../core/usage/failures";
import { buildUsageReport } from "../core/usage/report";
import { withinWindow, type UsageRecord } from "../core/usage/stats";
import { sharedUsageLedger } from "./usage-store";

/**
 * 由窗口算出读台账的下界。
 *
 * 为什么不是只按窗口：报表同时给「账号本周期」与「当前窗口」两套聚合，而周期可能比窗口
 * 更长（例如窗口选「今日」、账号周期是按月的），所以下界要取两者更早的那个 —— 否则周期
 * 那半边会缺数据。
 * @param window - 时间窗口。
 * @param now - 现在。
 * @returns 读范围。
 */
function readRangeFor(window: UsageWindowView, now: number): { since?: number } {
  const day = 86_400_000;
  // 周期最长按月：留 40 天余量，既覆盖最长的周期聚合，又不必读 120 天。
  const periodFloor = now - 40 * day;
  const windowFloor = windowStartOf(window, now);
  // `window === "all"` 时 `windowStartOf` 返回 `undefined`，意思是**没有下界** ——
  // 以前这里把 undefined 当成「没给」而回落到 40 天，等于把 `all` 悄悄变成「近 40 天」：
  // 失败明细与超过 40 天的周期都会掉数据，而 CSV 导出（全读）与界面对不上
  // （2026-10-20 审计）。这里保持 `all` 真的无下界（台账读取自身仍受 120 天保留期约束）。
  if (window === "all") return {};
  return { since: windowFloor === undefined ? periodFloor : Math.min(windowFloor, periodFloor) };
}

/** 窗口起点（`all` 无下界）。 */
function windowStartOf(window: UsageWindowView, now: number): number | undefined {
  if (window === "all") return undefined;
  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  return now - (window === "7d" ? 7 : 30) * 86_400_000;
}

/**
 * 额度窗口的「精细度」排序：数字越小越细。
 *
 * 用来挑出「本周期」该按哪一档算：5 小时窗口比周/月更能反映最近用了多少。
 * @param key - `QuotaWindow.key`。
 * @returns 排序权重。
 */
function rankOfWindow(key: string): number {
  const lower = key.toLowerCase();
  if (lower.includes("5h") || lower.includes("fivehour") || lower.includes("rolling")) return 0;
  if (lower.includes("day")) return 1;
  if (lower.includes("week")) return 2;
  return 3;
}

// 线上契约（包名、命名空间、方法名、描述符、结果类型）住在 `src/client/usage-contract.ts`：
// 客户端要用同一份描述符去 `$mount`，而客户端**不能**导入本文件（这一侧拉进宿主依赖）。
// 这里重新导出，让宿主侧的消费者不必知道它住在哪。
export {
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  USAGE_SERVICE_KEY,
  VENDOR_IDS,
} from "../client/usage-contract";
export type {
  AccountUsageStatus,
  QuotaSummary,
  SwitchRecord,
  UsageInvocationDescriptor,
  VendorUsageStatus,
} from "../client/usage-contract";

/**
 * 远程面要的账号口：**整个** `AccountPort`。
 *
 * 收窄→放宽的经过：Task 3 只发布只读面，当时按需收窄成 `Pick<AccountPort, "list">`（Ruling 19）。
 * Task 5 的账户卡片要做重命名/换密钥/固定/移除/添加，所以这里放宽为完整端口 —— 写入路径仍由
 * 各厂商的账号端口实现（密钥只经凭据服务，见 `AccountPort.replaceKey` 的契约），远程面只是**转发**。
 */
export type UsageAccountPort = AccountPort;

/**
 * 一个厂商的读口。两个 entry 各自构造一份，交给同一个服务实例。
 *
 * `pinnedRef`/`quotaRef` 必须由 entry 提供（而不是服务自己猜）：固定账号的判定住在各厂商的
 * 设置文档语义里（commandcode 的 `activeAccount` 是**旧槽 id 空间**），额度端口这一读报告的
 * 是「当前选中的账号」—— 服务只有拿到这两个判定，才能既不编造固定账号、也不把额度读数
 * 挪到另一个账号头上。
 */
export interface UsageVendorDeps {
  readonly vendor: VendorId;
  readonly rotation: RotationAccess;
  readonly accounts: UsageAccountPort;
  readonly quota: QuotaPort;
  /** 能力声明（规格 §7.3）：随 `status()` 发布给页面，客户端不各写一份。 */
  readonly capabilities: VendorCapabilities;
  /** 配置里固定/首选的账号；`null` 表示自动轮换。 */
  readonly pinnedRef: () => string | null;
  /** 额度端口这一读报告的账号 ref（与 entry 里 `selectedRefOf` 同一个判定）。 */
  readonly quotaRef: () => string | undefined;
  /** 网页登录端口：只有声明了 `browserLogin` 能力的厂商才有（本包只有 commandcode）。 */
  readonly login?: LoginPort;
  /**
   * 未过滤的模型目录（设置页勾选用）。
   *
   * 与宿主 `listModels` 的区别：那个已经按 `visibleModels`/`modelVisibility` 过滤，
   * 隐藏的模型不在里面；这个返回厂商的全量目录，页面才能在「隐藏」之后重新勾上。
   */
  readonly models?: () => Promise<CatalogModel[]>;
  /**
   * 凭据端口（**可选**）：只用于 `credentialStatus` 回答「这个引用名真的配了吗」。
   *
   * 三家都会传同一个实现（都代理到宿主的 credentials 服务），所以只需要登记一次。
   * 缺省时 `credentialStatus` 如实回答「都没配」—— 不猜。
   */
  readonly credentials?: CredentialPort;
  /**
   * 搜索密钥实测：给一个引用名发一次**最小**搜索请求，回答它到底能不能用。
   *
   * 为什么放在宿主侧：密钥只在宿主侧解析（客户端从不接触明文），而「能不能用」只有真的
   * 发一次请求才知道 —— 凭据库里有没有这把 key 与它是否有效是两件事。
   * 缺省时 `probeSearchCredential` 如实回答 `unknown`（不谎称已验证）。
   */
  readonly probeSearchKey?: (ref: string) => Promise<{ state: "ok" | "invalid" | "unknown"; reason?: string }>;
  /** 设置文档里的全局顺序（`vendor:ref` 键；两家相同）。 */
  readonly accountOrder?: () => readonly string[];
  /** 把同一份全局顺序写进两家文档。 */
  readonly setAccountOrder?: (order: readonly string[]) => Promise<void>;
  /** 模型→账号分配规则（同一模型可属于多个账号）。 */
  readonly modelRules?: () => readonly ModelRule[];
  /** 覆盖某个账号的模型列表。 */
  readonly setAccountModels?: (ref: string, models: readonly string[]) => Promise<void>;
  /** 切换策略运行态（倒计时/待切换）；页面「立即切换」也走这里。 */
  readonly switchState?: () => SwitchRuntimeState;
  readonly switchNow?: () => Promise<SwitchDecision | undefined>;
  /** 把一套全局切换设置写进这家文档。 */
  readonly setSwitchSettings?: (settings: SwitchSettingsWrite) => Promise<void>;
}

/**
 * **单个账号**的额度窗口提示（报表口径需要的几项）。
 *
 * 只存「用来定位统计周期」的内容，不存整份 `QuotaSnapshot` —— 报表用不到那么多，
 * 少存少错。
 */
interface AccountWindowHint {
  /** 账号 ref。 */
  ref: string;
  /** 最细那一档窗口的 key（`fiveHour` / `weekly`…）。 */
  windowKey?: string;
  /** 该窗口的重置时刻。 */
  resetAt?: number;
  /** 套餐本期结束 / 开始（厂商公布了才有）。 */
  planEnd?: number;
  planStart?: number;
  /** 权威已用金额（只来自与套餐账期同口径的美元窗口）。 */
  spent?: { amount: number; window: string };
}

/**
 * 宿主 `ctx.typert` 的最小形状（只认本项目用到的部分）。
 *
 * `remotes` 是宿主 `RemoteStore.view(ctx)` 暴露的**只读查询面**（`get` / `list`）——
 * 2026-10-29 加，用于「描述符是否还在」的幂等判定。它可能不存在（旧宿主），
 * 所以是可选字段。
 */
interface HostTypertRegistry {
  register(contribution: HostRemoteContribution): unknown;
  readonly remotes?: {
    get?(endpoint: string): unknown;
    list?(): readonly unknown[];
  };
}

/** 注册给宿主的贡献形状：与旧插件同一组字段（`face: "host"` 是宿主面）。 */
interface HostRemoteContribution {
  package: string;
  face: "host";
  schemas: readonly unknown[];
  model: { services: readonly unknown[]; events: readonly unknown[]; objects: readonly unknown[] };
  invocations: readonly UsageInvocationDescriptor[];
}

/**
 * 判定「能挂属性的宿主对象」：cordis 的 `Service` 对外是**可调用代理**（`typeof` 是 `"function"`），
 * 所以只认 `typeof === "object"` 会漏掉服务实例 —— 那会让第二行以为服务不存在，从而重复构造。
 */
function isServiceLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** 错误对象到一行文案（不泄漏对象结构，也不把 `undefined` 打成空白）。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 往宿主日志里留一行警告（形式残缺的 ctx 上静默跳过 —— 日志不是本模块的硬依赖）。 */
function warnOn(ctx: Context, message: string): void {
  const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger;
  logger?.warn?.(message);
}

/**
 * 账号中心的远程服务。
 *
 * 方法名必须与描述符里的 `method` 一致：`invocation: { kind: "direct" }` 就是按名字在实例上
 * 派发的。三个方法都要求显式给出厂商 —— 页面一次只渲染一家的标签页（规格 §8），没有默认值
 * 比猜一个默认厂商安全。
 *
 * **不要在本类里用 `#` 私有成员**（字段与方法都不行）：cordis 的 `Service` 实例对外是**代理**，
 * `ctx.get(key)` 拿到的是代理而不是原对象，访问 `#` 私有成员会抛
 * `TypeError: Receiver must be an instance of class …`（实测）。TS 的 `private` 是编译期的、
 * 不经过代理机制，所以本类一律用它。旧插件同样只用普通字段（`deps`），不是巧合。
 */
export class LlmAccountUsageService extends TypertRemoteService {
  private readonly vendorDeps = new Map<VendorId, UsageVendorDeps>();

  /**
   * 额度窗口快照的**短期缓存**（2026-10-30 修 P1-P01）。
   *
   * ## 为什么需要
   *
   * 设置页每 30 秒刷一次 `usageReport()`。而那个报表同时会去问**每家、每个已配置
   * 账号**的实时额度 —— 只为拿到「周期窗口的起止时刻」来定位统计口径。账号一多，
   * 30 秒一次的代价就是成倍的上游 HTTP。
   *
   * 报表本身的**数据源是本地用量台账**（`sharedUsageLedger()`），额度只用来选窗口。
   * 窗口边界（5 小时 / 周 / 套餐期）**不会在 30 秒内变化**，所以按账号缓存一小段
   * 时间完全不影响正确性。
   *
   * ## 语义约束
   *
   * - 缓存**只影响报表的口径选择**，不影响账号卡片/侧边栏的实时额度展示（那些走
   *   `status()` 本身，不经过这里）；
   * - TTL 到点后重新读；读失败**保留上一次的值**（口径沿用上次已知的窗口比退回自然
   *   周期更稳）；
   * - 键里带账号 ref，不同账号不会串用。
   */
  private readonly quotaWindowCache = new Map<string, { at: number; value: readonly AccountWindowHint[] }>();

  /**
   * 额度窗口缓存的有效期（毫秒）。
   *
   * 取 60 秒：设置页 30 秒刷一次，于是最多「每两次刷新打一轮上游」，且窗口边界
   * （最小是 5 小时）在这段时间里不可能变。
   */
  private static readonly QUOTA_WINDOW_TTL_MS = 60_000;

  /**
   * @param ctx - 拥有本服务的 cordis 上下文（基类会用 `serviceKey` 注册自己并盖上 typert 绑定）。
   */
  constructor(ctx: Context) {
    super(ctx, USAGE_SERVICE_KEY, { namespace: USAGE_NAMESPACE });
  }

  /**
   * 登记（或更新）一个厂商的读口。两个 profile 行各调一次。
   * @param deps - 该厂商的账号/额度/轮换读口。
   */
  registerVendor(deps: UsageVendorDeps): void {
    this.vendorDeps.set(deps.vendor, deps);
  }

  /**
   * 摘掉一个厂商的读口（该 profile 行卸载时调用）。
   *
   * 服务本身住在根上下文（两个行共享），比任何一行都长命；行走了就必须把自己的读口带走，
   * 否则远程面会拿着指向已释放端口的陈旧条目继续回答。
   * @param vendor - 要摘掉的厂商 id。
   */
  unregisterVendor(vendor: VendorId): void {
    this.vendorDeps.delete(vendor);
  }

  /**
   * 一家厂商的完整状态：生效账号、固定账号、逐账号的拒绝与额度摘要。
   * @param vendor - 厂商 id。
   * @returns 状态；额度读不出来时只在 `failures` 里体现。
   */
  async status(vendor: VendorId): Promise<VendorUsageStatus> {
    const deps = this.requireVendor(vendor);
    const engine = deps.rotation.current();
    const views = await deps.accounts.list();
    const effective = engine.effectiveAccount();
    const pinned = deps.pinnedRef();
    const rejections = engine.rejections();
    const failures: string[] = [];

    // 每个已配置账号都读一次额度：账号卡片要显示各自的可用额度，不能只给当前账号。
    // 失败项用**账号名称**（不是内部 ref）：这一行会直接显示在用量面板上，而
    // `acct_commandcode_work_ab12cd` 这种内部标识对用户没有任何意义（账户行早在
    // 2026-10-17 就不再显示 ref，这条路径漏掉了）。
    const quotas = new Map<string, QuotaSummary>();
    await Promise.all(
      views
        .filter((view) => view.configured)
        .map(async (view) => {
          try {
            quotas.set(view.ref, quotaSummaryOf(await quotaWithTimeout(deps.quota, view.ref)));
          } catch (error) {
            failures.push(`quota: ${vendor} "${view.label}" read failed (${messageOf(error)})`);
          }
        }),
    );

    const accounts = views.map((view): AccountUsageStatus => {
      const rejection = rejections.get(view.ref);
      return {
        ...view,
        effective: effective !== undefined && view.ref === effective.ref,
        ...(rejection === undefined
          ? {}
          : {
              rejection: {
                kind: rejection.kind,
                ...(rejection.resetAt === undefined ? {} : { until: rejection.resetAt }),
              },
            }),
        ...(quotas.has(view.ref) ? { quota: quotas.get(view.ref)! } : {}),
      };
    });

    const latestSwitch = engine.switchNotice();
    return {
      vendor,
      capabilities: deps.capabilities,
      pinned,
      ...(effective === undefined ? {} : { effective }),
      ...(latestSwitch === undefined ? {} : { switch: latestSwitch }),
      ...(deps.switchState === undefined ? {} : { switchState: deps.switchState() }),
      ...(deps.accountOrder === undefined ? {} : { accountOrder: [...deps.accountOrder()] }),
      ...(deps.modelRules === undefined ? {} : { modelRules: deps.modelRules().map((rule) => ({ ...rule, models: [...rule.models] })) }),
      accounts,
      failures,
    };
  }

  /**
   * 账号行（页面账户卡片与仪表盘的列表数据源）。
   * @param vendor - 厂商 id。
   * @returns 账号行，顺序即轮换顺序。
   */
  async accounts(vendor: VendorId): Promise<AccountView[]> {
    return this.requireVendor(vendor).accounts.list();
  }

  /**
   * 未过滤的模型目录（设置页的勾选列表）。
   *
   * 与宿主 `listModels` 的分工：那个已经按可见性过滤；这个回答「厂商现在有哪些模型」，
   * 隐藏的模型也要在这里出现，用户才有入口重新勾上。读取失败不抛（页面要显示原因与重试）。
   * @param vendor - 厂商 id。
   * @returns 目录与失败项。
   */
  async models(vendor: VendorId): Promise<CatalogModelsResult> {
    const deps = this.requireVendor(vendor);
    if (deps.models === undefined) {
      return { models: [], failures: [`models: ${vendor} does not expose a model catalog`] };
    }
    try {
      return { models: await deps.models(), failures: [] };
    } catch (error) {
      return { models: [], failures: [`models: ${vendor} catalog read failed (${messageOf(error)})`] };
    }
  }

  /**
   * 切换记录，**最新在前**（仪表盘的切换记录区；每条都带厂商标签）。
   * @param vendor - 厂商 id。
   * @returns 切换记录数组。
   */
  async switches(vendor: VendorId): Promise<SwitchRecord[]> {
    const engine = this.requireVendor(vendor).rotation.current();
    return engine.switchNotices().map((notice) => ({ ...notice, vendor }));
  }

  /**
   * 磁盘上**当前安装版本**（读 `package.json` 的 `version`）。
   *
   * 用途：客户端 bundle 里有构建期注入的版本号（= 页面加载时的版本）。两者不一致
   * 说明插件已被更新、但页面里跑的还是旧代码 —— 那时应当提示用户刷新页面，而不是
   * 让他重启程序。
   *
   * **为什么不缓存**：这个值正是「磁盘变了」的探针，缓存会让它永远报旧值。
   * 读一次文件很便宜（几 KB），而且只在页面加载与更新完成后调用。
   * @returns 版本字符串；读不到时抛错（调用方据此不提示，而不是猜）。
   */
  async installedVersion(): Promise<string> {
    // 产物在 `lib/` 下，包根是其上一级。用 import.meta.url 定位，避免 cwd 假设。
    const here = new URL(import.meta.url);
    const manifest = new URL("../package.json", here);
    const raw = await readFile(manifest, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const version =
      typeof parsed === "object" && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
    if (typeof version !== "string" || version.trim() === "") {
      throw new Error("package.json has no version field");
    }
    return version.trim();
  }

  /**
   * 追加一个账号。有密钥时同时写入凭据服务（ref 由账号端口按标签分配一个**空闲**槽）。
   * @param vendor - 厂商 id。
   * @param input - 展示名称与可选密钥。
   * @returns 新账号的视图。
   */
  async addAccount(vendor: VendorId, input: AddAccountInput): Promise<AccountView> {
    return this.requireVendor(vendor).accounts.add(input);
  }

  /**
   * 只改展示名称（ref 是身份键，永不重推）。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号。
   * @param label - 新名称。
   */
  async renameAccount(vendor: VendorId, ref: string, label: string): Promise<void> {
    await this.requireVendor(vendor).accounts.rename(ref, label);
  }

  /**
   * 把账号名恢复成登录时的默认名（2026-10-22）。
   *
   * 默认名住在**账号条目**里（`defaultName` 字段），所以由厂商端口自己查、自己写 ——
   * 客户端传来的只是「点的是哪个账号」，不是一个可能已过期的名字。这样「默认名」只有
   * 一处真相。
   *
   * 没实现这个能力（或该账号没有记录默认名）时**报错**而不是静默：界面本来就不会显示
   * 那个入口，能走到这里说明是直接调的远程方法，静默失败会让它以为成功了。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号。
   */
  async restoreAccountName(vendor: VendorId, ref: string): Promise<void> {
    const port = this.requireVendor(vendor).accounts;
    if (typeof port.restoreDefaultLabel !== "function") {
      throw new Error(`dsh-llm-account: vendor "${vendor}" does not support restoring the default account name`);
    }
    await port.restoreDefaultLabel.call(port, ref);
  }

  /**
   * 换密钥。
   *
   * 密钥只交给账号端口，端口只写凭据服务 —— **不经过设置文档**（全局约束）。这里不做日志输出，
   * 也不把它放进任何返回值。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号。
   * @param key - 新密钥。
   */
  async replaceKey(vendor: VendorId, ref: string, key: string): Promise<void> {
    await this.requireVendor(vendor).accounts.replaceKey(ref, key);
  }

  /**
   * 移除账号（凭据的实际清理由账号端口按各厂商语义处理）。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号。
   */
  async removeAccount(vendor: VendorId, ref: string): Promise<void> {
    await this.requireVendor(vendor).accounts.remove(ref);
  }

  /**
   * 固定账号或回到自动轮换。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号；`null` 表示自动轮换。
   */
  async selectAccount(vendor: VendorId, ref: string | null): Promise<void> {
    const deps = this.requireVendor(vendor);
    await deps.accounts.select(ref);
    // 手动切号后立刻把「生效账号」也指过去，页面上的「当前使用」不用等下一次请求才跟随。
    if (ref !== null) deps.rotation.current().noteSelected(ref);
  }

  /**
   * 调整账号顺序。
   *
   * 只有声明了 `reorder` 能力的厂商才实现（本包只有 opencode）。没实现的厂商**报明确错误**，
   * 不是静默无操作 —— 页面上没有这个控件，能走到这里就说明接线错了。
   * @param vendor - 厂商 id。
   * @param ref - 目标账号。
   * @param toIndex - 移动后的最终下标。
   */
  async moveAccount(vendor: VendorId, ref: string, toIndex: number): Promise<void> {
    const move = this.requireVendor(vendor).accounts.move;
    if (move === undefined) {
      throw new Error(`dsh-llm-account: vendor "${vendor}" does not support reordering accounts`);
    }
    await move.call(this.requireVendor(vendor).accounts, ref, toIndex);
  }

  /**
   * 写自动切换开关。
   *
   * 两家都已实现（设计 §6.4.5 把 `autoSwitch` 落库定为共用的可靠性机制；Command Code 在
   * 2026-10-17 按交接文件 §4.2 的 C 项补齐，此前只有 opencode）。端口上仍是可选方法：
   * 没实现的厂商报明确错误，不是静默无操作。
   * @param vendor - 厂商 id。
   * @param value - 开关值。
   */
  async setAutoSwitch(vendor: VendorId, value: boolean): Promise<void> {
    const setAutoSwitch = this.requireVendor(vendor).accounts.setAutoSwitch;
    if (setAutoSwitch === undefined) {
      throw new Error(`dsh-llm-account: vendor "${vendor}" has no auto-switch setting`);
    }
    await setAutoSwitch.call(this.requireVendor(vendor).accounts, value);
  }

  /**
   * 立即执行一次切换（页面按钮）：有 pending 先应用；否则强制评估一次并立即写选择。
   * @param vendor - 厂商 id。
   * @returns 是否真的切了、切到谁、原因。
   */
  async switchNow(vendor: VendorId): Promise<SwitchNowResult> {
    const switchNow = this.requireVendor(vendor).switchNow;
    if (switchNow === undefined) return { switched: false };
    const decision = await switchNow();
    return decision === undefined
      ? { switched: false }
      : { switched: true, target: decision.target, reason: decision.reason };
  }

  /**
   * 把一份全局顺序写进**所有**已注册厂商的设置文档（两家保存同一份，各自投影）。
   * @param order - `vendor:ref` 键。
   */
  async setAccountOrder(order: readonly string[]): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const deps of this.vendorDeps.values()) {
      if (deps.setAccountOrder !== undefined) writes.push(deps.setAccountOrder(order));
    }
    await Promise.all(writes);
  }

  /**
   * 把一套全局切换设置写进**所有**已注册厂商的设置文档。
   * @param settings - 策略/间隔/回合末/自动切换。
   */
  async setSwitchSettings(settings: SwitchSettingsWrite): Promise<void> {
    const writes: Promise<void>[] = [];
    for (const deps of this.vendorDeps.values()) {
      if (deps.setSwitchSettings !== undefined) writes.push(deps.setSwitchSettings(settings));
    }
    await Promise.all(writes);
  }

  /**
   * 覆盖一个账号可用的模型；同一模型可以同时属于多个账号。
   * @param vendor - 厂商 id。
   * @param ref - 账号 ref。
   * @param models - 该账号的模型 id 列表。
   */
  async setAccountModels(vendor: VendorId, ref: string, models: readonly string[]): Promise<void> {
    const setter = this.requireVendor(vendor).setAccountModels;
    if (setter === undefined) return;
    await setter(ref, models);
  }

  /**
   * 开始（或接续）一次网页登录。
   * @param vendor - 厂商 id。
   * @returns 登录状态（`waiting` 时带授权网址）。
   */
  async loginBegin(vendor: VendorId): Promise<LoginStatus> {
    return this.requireLogin(vendor).begin();
  }

  /**
   * 查询当前登录尝试。
   * @param vendor - 厂商 id。
   * @returns 登录状态。
   */
  async loginStatus(vendor: VendorId): Promise<LoginStatus> {
    return this.requireLogin(vendor).status();
  }

  /**
   * 取消等待中的登录尝试。
   * @param vendor - 厂商 id。
   */
  async loginCancel(vendor: VendorId): Promise<void> {
    await this.requireLogin(vendor).cancel();
  }

  /**
   * 取某厂商各账号的**额度窗口提示**（带 TTL 缓存）。
   *
   * ## 为什么要缓存（第七轮复审 P1-P01）
   *
   * `usageReport()` 被设置页每 30 秒调一次。它需要每个账号的窗口边界来定位「统计
   * 周期」，而这份信息来自 `status(vendor)` —— 后者会对**每个已配置账号并发打额度
   * 端点**（Command Code 每账号最多 4 个请求）。
   *
   * 也就是说：用户只是看着用量页面不动，每 30 秒就会产生 `账号数 × 端点` 次上游
   * 请求。而窗口边界（最小 5 小时）在这段时间根本不会变。
   *
   * 缓存 60 秒后，最长「每两次刷新打一轮」。
   *
   * ## 失败处理
   *
   * 读失败时**保留上一次成功的值** —— 沿用已知窗口比退回自然周期更符合用户预期
   * （报表不会在 30 秒后突然换口径）。缓存过期且从未成功过时返回空数组，调用方
   * 自然回退到自然周期。
   * @param vendor - 厂商 id。
   * @returns 各账号的窗口提示（可能为空）。
   */
  private async quotaWindowHintsOf(vendor: VendorId): Promise<readonly AccountWindowHint[]> {
    const cached = this.quotaWindowCache.get(vendor);
    if (cached !== undefined && Date.now() - cached.at < LlmAccountUsageService.QUOTA_WINDOW_TTL_MS) {
      return cached.value;
    }
    try {
      const status = await this.status(vendor);
      const hints: AccountWindowHint[] = [];
      for (const account of status.accounts ?? []) {
        // 选**最细**的一档窗口（5 小时比周/月更能反映「本周期」）。
        const ranked = [...(account.quota?.windows ?? [])].sort(
          (left, right) => rankOfWindow(left.key) - rankOfWindow(right.key),
        );
        const finest = ranked[0];
        // 套餐本期结束时刻：**优先于**额度窗口粒度。
        const periodEnd = account.quota?.plan?.periodEnd;
        const periodStart = account.quota?.plan?.periodStart;
        // 权威金额要**跟周期同口径**：旧写法按「最细」挑，于是拿到 5 小时窗口的已用
        // （$0.16），却配在「本周期」（按套餐是一个月）的标题下 —— 一个月的统计配五小时
        // 的金额，用户一眼就觉得数是错的（2026-10-19 报障）。
        // 现在只认**重置时间与套餐账期一致**的美元窗口；没有就留空，让报表用本机口径
        // （`localSpent`）回答「这台机器这一期用了多少」。
        const usdWindows = ranked.filter((window) => window.unit === "usd" && window.used !== undefined);
        const sameAsPlan =
          periodEnd === undefined
            ? undefined
            : usdWindows.find((window) => window.resetAt !== undefined && Math.abs(window.resetAt - periodEnd) < 60_000);
        // 没有套餐信息时退回最细那一档（那是当时唯一能拿到的口径）。
        const usd = sameAsPlan ?? (periodEnd === undefined ? usdWindows[0] : undefined);
        hints.push({
          ref: account.ref,
          ...(finest === undefined ? {} : { windowKey: finest.key }),
          ...(finest?.resetAt === undefined ? {} : { resetAt: finest.resetAt }),
          ...(periodEnd === undefined ? {} : { planEnd: periodEnd }),
          ...(periodStart === undefined ? {} : { planStart: periodStart }),
          ...(usd?.used === undefined ? {} : { spent: { amount: usd.used, window: usd.key } }),
        });
      }
      this.quotaWindowCache.set(vendor, { at: Date.now(), value: hints });
      return hints;
    } catch {
      // 这一家的额度读不到：有旧值就沿用（口径不跳变），没有就让调用方退回自然周期。
      return cached?.value ?? [];
    }
  }

  /**
   * 用量报表：读共享台账，按「每账号自己的记账周期」+ 一份总账聚合。
   *
   * **跨厂商**：台账是三条 provider 行共用的那一本，所以这里不按 vendor 取读口。
   *
   * 周期粒度从**当前额度窗口**推断：`status()` 里已经有每账号的窗口（含 `resetAt`），
   * 用它能让周期锚到厂商真实的重置时间；额度读不到时退回自然周期（报表里会标明
   * `fromResetAt: false`，界面上显示成「按自然 X 推算」）。
   * @param window - 时间窗口（`today` / `7d` / `30d` / `all`）。
   * @returns 报表。
   */
  async usageReport(window: UsageWindowView = "today"): Promise<UsageReportView> {
    const now = Date.now();
    let records: UsageRecord[] = [];
    try {
      // 按窗口给下界：`today` 只需读今天那一个文件（120 → 1），这是最常见的路径；
      // `all` 什么都不传（保留期内的全读）。期间还要读周期聚合，所以下界取两者更早者。
      records = await sharedUsageLedger().read(readRangeFor(window, now));
    } catch (error) {
      // 台账读失败（磁盘权限、文件损坏）：给一份空报表 + 一行 warn，而不是让页面崩。
      console.warn("[dsh-llm-account] could not read the usage ledger:", error);
    }
    // 当前各账号的额度窗口：用来定位周期（失败就让报表退回自然周期）。
    const windows = new Map<string, { windowKey?: string; resetAt?: number }>();    /** 每账号的**套餐本期结束**时刻（需求「按套餐有效期统计」，优先级最高）。 */
    const planEnds = new Map<string, number>();
    /** 每账号的套餐本期开始时刻（厂商公布了才填）。 */
    const planStarts = new Map<string, number>();
    /** 每账号的**权威已用金额**（只来自 `unit === "usd"` 的窗口）。 */
    const spent = new Map<string, { amount: number; window: string }>();
    /**
     * 取各厂商的额度窗口提示 —— **带 TTL 缓存**（2026-10-30 修 P1-P01）。
     *
     * 原来这里直接 `await this.status(vendor)`，而 `status()` 会对每个已配置账号并发
     * 打额度端点。设置页每 30 秒刷一次报表，账号一多就是成倍的上游 HTTP —— 而报表
     * 本身的数据源是**本地台账**，额度只用来选「统计周期」。
     *
     * 窗口边界最小是 5 小时，不可能在 60 秒内变化，所以缓存完全不影响口径正确性。
     */
    for (const vendor of this.vendorDeps.keys()) {
      const hints = await this.quotaWindowHintsOf(vendor);
      for (const hint of hints) {
        const key = `${vendor}\u0000${hint.ref}`;
        windows.set(key, {
          ...(hint.windowKey === undefined ? {} : { windowKey: hint.windowKey }),
          ...(hint.resetAt === undefined ? {} : { resetAt: hint.resetAt }),
        });
        if (hint.planEnd !== undefined) planEnds.set(key, hint.planEnd);
        if (hint.planStart !== undefined) planStarts.set(key, hint.planStart);
        if (hint.spent !== undefined) spent.set(key, hint.spent);
      }
    }
    const report = buildUsageReport({
      records,
      window,
      now,
      periodWindowOf: (vendor, account) => windows.get(`${vendor}\u0000${account}`)?.windowKey,
      resetAtOf: (vendor, account) => windows.get(`${vendor}\u0000${account}`)?.resetAt,
      planPeriodEndOf: (vendor, account) => planEnds.get(`${vendor}\u0000${account}`),
      planPeriodStartOf: (vendor, account) => planStarts.get(`${vendor}\u0000${account}`),
      spentOf: (vendor, account) => spent.get(`${vendor}\u0000${account}`),
    });
    // 「最近一次请求」：侧边栏据此跟随当前会话。
    // 只收**仍然存在的账号**：台账里可能留着已删除的 ref，拿它显示会对不上名字。
    const known = new Set(windows.keys());
    const lastUsed = lastUsedAccountOf(records, (vendor, account) => known.has(`${vendor}\u0000${account}`));
    // 失败明细：只在**这个窗口**内统计（与总账同一口径），并且**按账号**分开
    // —— 界面把用量块渲染在每个账号下面，传一份全局的会让同厂商所有账号显示同一份
    // （失败属于 A 却显示在 B 下面）。一条失败都没有时不写这个字段：界面据此整块不渲染，
    // 而不是画一行「失败 0 次」。
    const scoped = withinWindow(records, window, now);
    const perAccount = failureBreakdownPerAccount(scoped);
    // 键是 `vendor\u0000account`：拆开成两个字段传出去，客户端按 (vendor, account) 查
    // —— 只按 account 会让两家同名 ref 串味（2026-10-20 审计）。
    const failuresByAccount = [...perAccount.entries()].map(([key, rows]) => {
      const separator = key.indexOf("\u0000");
      return {
        vendor: separator < 0 ? "" : key.slice(0, separator),
        account: separator < 0 ? key : key.slice(separator + 1),
        rows,
      };
    });
    // 与此同时保留一份**全局**的（按厂商汇总），供将来做「整家厂商的失败概览」；
    // 界面目前只用 `failuresByAccount`。
    const failuresByKind = failureBreakdownOf(scoped);
    return {
      ...report,
      ...(lastUsed === undefined ? {} : { lastUsed }),
      ...(failuresByKind.length === 0 ? {} : { failuresByKind }),
      ...(failuresByAccount.length === 0 ? {} : { failuresByAccount }),
    };
  }

  /**
   * 导出用量台账为 CSV。
   *
   * 为什么在宿主侧做序列化：台账文件在这台机器上，客户端只拿到远程结果；把 CSV 文本整个传过去
   * 比传几千条记录再在浏览器里拼更省事，也保证导出与界面看到的是**同一份**数据。
   *
   * **缺省导出全部**（120 天保留期内）。以前缺省是「最近 1000 条」，而客户端从不传参 ——
   * 台账一旦超过 1000 条，用户拿到的文件就悄悄少了前面那部分，界面上却毫无提示
   * （2026-10-20 审计；当时台账已有 2401 条）。对账场景下「看起来成功但数据不全」比失败更糟。
   * @param limit - 可选上限（尾部，即最近的）。省略 = 不截断。
   * @returns CSV 文本（含表头）。
   */
  async usageExportCsv(limit?: number): Promise<string> {
    const records = await sharedUsageLedger().read();
    // 只有显式给了正数上限才截断；`undefined`/非正数/非有限值一律导出全部。
    const usable = typeof limit === "number" && Number.isFinite(limit) && limit > 0;
    return ledgerCsvOf(usable ? exportTailOf(records, limit) : [...records]);
  }

  /**
   * 清空用量台账。
   *
   * 只清内容、不删文件（见 `usage-ledger` 的 `clear`）：删文件的破坏性更大，而
   * 「清空」的语义已经达成。二次确认在客户端做 —— 宿主侧不该替用户决定。
   */
  async usageClear(): Promise<void> {
    await sharedUsageLedger().clear();
  }

  /**
   * 查询一组凭据引用名是否**真的**配置了。
   *
   * 为什么需要：界面上「搜索 API key」填的是**引用名**，真 key 在凭据库里 ——
   * 填了名字不等于库里有那把 key，而界面从来不去查，用户无从判断自己加没加成功
   * （2026-10-20 报障「添加 API KEY 后没有显示是否已添加」）。
   *
   * **只回布尔，绝不回密钥**：密钥一旦进了浏览器内存就多一条泄漏途径，
   * 而界面只需要「有没有」这一个事实。
   * @param refs - 要查询的引用名。
   * @returns 逐条 `{ ref, configured }`（顺序与入参一致）。
   */
  async credentialStatus(refs: readonly string[]): Promise<{ ref: string; configured: boolean }[]> {
    // 凭据端口是**厂商级**的，但实现完全一致（都代理到宿主的 credentials 服务），
    // 取任意一家即可；一家都没登记时如实回答「都没配」。
    const credentials = [...this.vendorDeps.values()][0]?.credentials;
    if (credentials === undefined) return refs.map((ref) => ({ ref, configured: false }));
    // 一次查询一批：端口本来就是批量接口，避免 N 次往返。
    const described = await credentials.describe([...refs]);
    return refs.map((ref) => ({ ref, configured: described[ref]?.configured === true }));
  }

  /**
   * 往凭据库里写一把密钥。
   *
   * 与账号卡片的「更换密钥」走**同一条路径**（`credentials.set`）：密钥只经凭据服务进出，
   * 设置文档里永远不落明文（项目全局约束）。
   * @param ref - 凭据引用名。
   * @param secret - 密钥（空值在边界上已被拒绝）。
   */
  async setCredential(ref: string, secret: string): Promise<void> {
    const credentials = [...this.vendorDeps.values()][0]?.credentials;
    if (credentials === undefined) {
      throw new Error("dsh-llm-account: 凭据服务不可用，无法写入密钥（请在宿主的凭据页添加）");
    }
    await credentials.set(ref, secret);
  }

  /**
   * 实测一组搜索密钥：每个引用名发一次**最小**请求，回答「能不能用」。
   *
   * 为什么必须真的发请求：凭据库里「有这把 key」与「这把 key 能用」是两件事 —— 2026-10-20
   * 实测到用户把一段中文误存成密钥，`configured` 一直是 `true`，而搜索每次都在构造请求头时
   * 就炸了。只有实测能让界面在**添加的那一刻**就把问题说出来。
   *
   * 三档语义见 `CredentialProbe`：网络类失败归 `unknown`，**绝不**据此说密钥无效。
   * @param refs - 要实测的引用名。
   * @returns 逐条结论（顺序与入参一致）。
   */
  async probeSearchCredential(refs: readonly string[]): Promise<{ ref: string; state: "ok" | "invalid" | "unknown"; reason?: string }[]> {
    // 取**第一个实现了实测的**厂商，而不是「第一个厂商」：探针只依赖凭据库与
    // Search API（与哪一行注册的无关），但目前只有 commandcode 行传了它。用 `[0]` 的话，
    // 哪天加载顺序变了（或某行没传），实测就整体静默降级成「这个版本不支持」——
    // 而另外两行其实能测（2026-10-20 审计）。
    const probe = [...this.vendorDeps.values()].find((deps) => deps.probeSearchKey !== undefined)?.probeSearchKey;
    if (probe === undefined) {
      // 没实现实测（老装配）：如实说「没能判定」，界面据此只显示「已保存」。
      return refs.map((ref) => ({ ref, state: "unknown" as const, reason: "这个版本不支持密钥实测" }));
    }
    const out: { ref: string; state: "ok" | "invalid" | "unknown"; reason?: string }[] = [];
    for (const ref of refs) {
      try {
        const result = await probe(ref);
        out.push(result.reason === undefined ? { ref, state: result.state } : { ref, state: result.state, reason: result.reason });
      } catch (error) {
        // 实测自己炸了（装配故障）：同样归 unknown —— 那是「没测出来」，不是「密钥无效」。
        out.push({
          ref,
          state: "unknown",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  /** 取一家厂商的读口；没登记过就吵出来（静默返回空结果会伪装成「没有账号」）。 */
  private requireVendor(vendor: VendorId): UsageVendorDeps {
    const deps = this.vendorDeps.get(vendor);
    if (deps === undefined) {
      throw new Error(
        `dsh-llm-account: vendor "${vendor}" is not registered on the ${USAGE_SERVICE_KEY} remote (registered: ${[...this.vendorDeps.keys()].join(", ") || "none"})`,
      );
    }
    return deps;
  }

  /** 取一家厂商的登录端口；该厂商不支持网页登录时给出可读错误（而不是静默无操作）。 */
  private requireLogin(vendor: VendorId): LoginPort {
    const login = this.requireVendor(vendor).login;
    if (login === undefined) {
      throw new Error(`dsh-llm-account: vendor "${vendor}" does not support browser login`);
    }
    return login;
  }
}

/**
 * 单个账号额度读取的超时（毫秒）；一个账号卡住不能拖住整页状态。
 *
 * **2026-10-18 从 8s 提到 30s**（本机实测：用量面板「经常获取不到账户信息」的根因）。
 * Command Code 的额度端口是 `whoami` → 另三个端点并行，即**两跳**；而端口自身的端点预算
 * （`DEFAULT_REQUEST_TIMEOUT_MS`）是 300s。8s 比一次正常读取的两跳时间还短 —— 慢网下
 * （每跳 4-5s）读取必然在 8s 被砍，于是界面显示「暂无额度数据 + read failed (timeout
 * after 8000ms)」，而账号信息本身（名称、状态）其实读到了。30s 留足了两跳在慢网下的
 * 余量，同时仍能砍掉真正卡住的端点（端口自己的 300s 预算对界面太长了）。
 */
const QUOTA_READ_TIMEOUT_MS = 30_000;

/**
 * 带超时（超时后重试一次）的额度读取。
 *
 * ## 超时后底层调用怎么办（2026-10-22 修 MEDIUM-1）
 *
 * `Promise.race` 的败者**不会被取消** —— 超时 reject 之后 `snapshot(ref)` 仍在飞。
 * 若直接重试，失败路径上会同时存在两个未完成的 snapshot：
 *
 * - 厂商额度接口的请求量翻倍（重试几次就翻几倍）；
 * - `snapshot` 内部会 `resolveKey(ref)`，在 opencode 那条链路上可能触发 OAuth 刷新并
 *   回写凭据槽 —— 两个并发刷新会互相踩踏。
 *
 * 本包的 `QuotaPort.snapshot` **不接受 `AbortSignal`**（端口签名由厂商实现决定，三家
 * 都不支持取消），所以无法真正中止它。能做的是两件事：
 *
 * 1. 给败者挂一个 `.catch()`，避免它在超时后被当成 unhandled rejection；
 * 2. **放弃重试**（`QUOTA_READ_RETRIES = 0`）—— 超时的根因是上游慢，再发一次只会让
 *    在途请求叠加。界面已经会如实显示 `timeout after 30000ms`，用户点刷新即可再来。
 *
 * 这比「重试拿翻倍请求量换一次可能的成功」更克制：额度面板是旁路读数，晚一拍看到
 * 数字没有代价，而并发刷新踩踏会真的让某个账号的凭据暂时失效。
 * @param quota - 额度端口。
 * @param ref - 账号 ref。
 * @returns 读数；超时或端口明确失败时抛错（由调用方记入 failures）。
 */
export async function quotaWithTimeout(quota: QuotaPort, ref: string): Promise<QuotaSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** 底层读取的 promise；超时后仍会继续跑完，所以要在后面挂 catch。 */
  const reading = quota.snapshot(ref);
  try {
    return await Promise.race([
      reading,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${QUOTA_READ_TIMEOUT_MS}ms`)), QUOTA_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    /**
     * **给败者挂一个兜底 catch。**
     *
     * 竞态赢的是超时那一侧时，`reading` 还在飞；它之后 reject 的话，没有人 await 它
     * —— 那会变成 unhandled rejection（Node 会打印警告，测试里还可能被判失败）。
     * 这里挂一个空 catch 明确表示「这个结果已经不再需要」。
     *
     * 注意不能因此认为它被取消了：请求仍会跑完，只是结果被丢弃。
     */
    void reading.catch(() => undefined);
  }
}

/** 把额度读数转成摘要：字段原样搬运，缺失即缺失。 */
function quotaSummaryOf(snapshot: QuotaSnapshot): QuotaSummary {
  return {
    ...(snapshot.plan === undefined ? {} : { plan: { ...snapshot.plan } }),
    windows: snapshot.windows.map((window) => ({ ...window })),
    failures: [...snapshot.failures],
  };
}

/** 读宿主 `ctx.typert`，形状不认识时返回 `undefined`。 */
function hostTypertOf(ctx: Context): HostTypertRegistry | undefined {
  const service: unknown = ctx.get("typert");
  if (!isServiceLike(service) || typeof service.register !== "function") return undefined;
  return service as unknown as HostTypertRegistry;
}

/** 取现有的账号中心服务（**结构**判定：两个 entry 可能是两份模块实例，`instanceof` 会误判）。 */
function existingServiceOf(ctx: Context): LlmAccountUsageService | undefined {
  const service: unknown = ctx.get(USAGE_SERVICE_KEY);
  if (!isServiceLike(service) || typeof service.registerVendor !== "function") return undefined;
  return service as unknown as LlmAccountUsageService;
}

/**
 * 装配一个厂商的账号中心远程：`typert` 就绪后创建（或复用）服务、登记读口，并由**创建者**
 * 注册一次描述符。
 *
 * 两条硬约束（都是实测结果，不是设计偏好）：
 * 1. **服务必须住在根上下文**：两个 profile 行的注入作用域是**兄弟**，第一行在自己作用域里
 *    注册的服务第二行看不见（`ctx.get` 只会向上找），结果就是两家各建一个实例、同名服务
 *    互相覆盖。注册在共同祖先（root）上才有一个共享实例。
 * 2. **不能每次都 `new`**：同名 cordis 服务重复注册会撞车或悄悄覆盖，使其中一家读不到数据；
 *    所以先按结构判定复用已有实例（`instanceof` 不行 —— 两条子路径可能是两份模块实例）。
 * @param ctx - 该 profile 行的插件上下文。
 * @param deps - 该行的厂商读口。
 */
export function applyUsageRemote(ctx: Context, deps: UsageVendorDeps): void {
  // 宿主上下文必须能注入：没有 `inject`（假 ctx、残缺宿主）时发布不了远程面，直接跳过而不是
  // 把整行弄崩 —— 该行本身的 provider 路由仍然可用。但必须留痕：客户端会因此看不到数据。
  if (typeof ctx.inject !== "function") {
    warnOn(ctx, `dsh-llm-account: this host context has no inject(); the ${USAGE_NAMESPACE} remote is not published`);
    return;
  }
  ctx.inject(["typert"], (remoteCtx) => {
    const root = remoteCtx.root;
    const existing = existingServiceOf(root);
    const service = existing ?? new LlmAccountUsageService(root);
    service.registerVendor(deps);

    // 本行的读口跟着本行的生命期走（服务本身留在 root）。
    ctx.effect(
      () => () => {
        service.unregisterVendor(deps.vendor);
      },
      "dsh-llm-account: usage remote vendor",
    );

    /**
     * 描述符：**每次都尝试**，由 `publishInvocations` 自己判定幂等。
     *
     * 原来这里写 `if (existing !== undefined) return;` —— 用「服务在不在」代替
     * 「描述符在不在」。两者是独立状态：`typert` 服务的 ctx 重建过时，服务还在
     * root 上、描述符却被 `withdraw` 了，于是我们永远跳过注册，客户端拿到
     * `gateway/definition-unavailable`。
     */
    publishInvocations(remoteCtx);
  });
}

/**
 * 把三个强类型调用描述符登记给宿主 `typert` —— **幂等**。
 *
 * ## 为什么需要幂等（2026-10-29）
 *
 * 调用方原来只在「新建服务」时调本函数（`if (existing !== undefined) return`）。
 * 但**服务实例**与**描述符**是两套独立状态：
 *
 * - 服务挂在 `root` 上（`ctx.get(USAGE_SERVICE_KEY)`）；
 * - 描述符挂在 `typert` 服务的 `descriptors` 表里，随 **`typert` 的 ctx** 销毁而
 *   `withdraw`。
 *
 * 两者不同步时就会出问题：服务还在 → 调用方跳过注册；而描述符表已空 → 客户端拿到
 * `gateway/definition-unavailable: its strict definition was withdrawn`。
 *
 * 现在改成**查了再决定**：宿主暴露 `remotes.get(endpoint)`，描述符全在就什么都不做；
 * 缺任何一个就补注册。
 * @param remoteCtx - 注入 `typert` 后的上下文。
 */
function publishInvocations(remoteCtx: Context): void {
  const typert = hostTypertOf(remoteCtx);
  if (typert === undefined) {
    // 宿主有 `typert` 服务却不是认识的形状：不要把整行弄崩，但必须留下痕迹。
    warnOn(
      remoteCtx,
      `dsh-llm-account: the host typert service does not expose register(); the ${USAGE_NAMESPACE} remote was not published`,
    );
    return;
  }

  const descriptors = usageDescriptors();
  const endpoints = descriptors.map((descriptor) => `${USAGE_NAMESPACE}/${descriptor.method}`);

  /**
   * 描述符都还在 → 已经是想要的状态，什么都不做。
   *
   * 只在宿主真的暴露了查询面时判定；旧宿主没有 `remotes.get` 就直接走注册
   * （那种宿主也只有一次装配，不存在「撤回了却没人补」的场景）。
   */
  const lookup = typert.remotes?.get;
  if (typeof lookup === "function") {
    const allPresent = endpoints.every((endpoint) => {
      try {
        return lookup.call(typert.remotes, endpoint) !== undefined;
      } catch {
        // 查询本身抛错：当作「查不到」，交给下面的注册路径兜底。
        return false;
      }
    });
    if (allPresent) return;
  }

  try {
    typert.register({
      package: USAGE_PACKAGE,
      face: "host",
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: descriptors,
    });
  } catch (error) {
    /**
     * 宿主拒绝重复注册（`typert: Remote package "..." is already registered`）。
     *
     * 这说明描述符表里**其实还在**，只是 `remotes.get` 没查到（或没这个接口）——
     * 不是需要整行挂掉的错误。
     */
    warnOn(
      remoteCtx,
      `dsh-llm-account: the host refused to re-register the ${USAGE_NAMESPACE} remote (likely already registered): ${String(error)}`,
    );
  }
}
