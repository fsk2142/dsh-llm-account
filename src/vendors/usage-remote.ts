/**
 * 宿主侧的**账号中心远程命名空间**：把两个厂商的账号、额度与轮换观测状态合成一个远程面，
 * 供客户端（统一设置页、侧边栏额度卡片、中栏仪表盘）读取。
 *
 * 为什么需要一个**共享**服务：本包只有一个客户端 bundle，两个 profile 行都要读同一份数据，
 * 而且「生效账号/切换记录」天然是跨行的（规格 §8.1 第 1、3、4 条要的是「当前到底谁在服务」）。
 * 所以服务键只有一个，第一行创建实例、第二行复用（`ctx.get` 判定，见 `applyUsageRemote`）。
 *
 * **未验证接缝**（与 T1 的客户端接缝同类，计划 1c 实测）：
 * - `ctx.inject(["typert"], …)` + `remoteCtx.typert.register(contribution)` 的形状逐字取自本机
 *   已装的 `@mars-sea/dsh-commandcode-provider/lib/index.js:8965-8976`；
 * - `super(ctx, key, { namespace })` 的绑定由 `TypertRemoteService` 基类盖上（同文件 8841-8843）。
 * @module dsh-llm-account/src/vendors/usage-remote
 */
import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { AccountPort, AccountView, FailureKind, QuotaPort, QuotaSnapshot, QuotaWindow, VendorId } from "../core/adapter";
import type { EffectiveAccount, SwitchNotice } from "../core/rotation";
import type { RotationAccess } from "./assembly";

/** 贡献所属的 npm 包（描述符 id 的前缀，与旧插件的 `@mars-sea/…` 同一约定）。 */
export const USAGE_PACKAGE = "dsh-llm-account";

/** cordis 服务键：两个 profile 行共享同一个实例。 */
export const USAGE_SERVICE_KEY = "llmAccountUsage";

/** 线上命名空间：`<namespace>/<method>` 就是端点。 */
export const USAGE_NAMESPACE = "llm-account";

/** 本包托管的两条厂商路由。 */
const VENDOR_IDS: readonly VendorId[] = ["commandcode", "dsh-opencode-go"];

/**
 * 远程面要的账号读口：**只有** `list`。
 *
 * 按需收窄而不是照搬整个 `AccountPort`：这个远程是只读面（写入路径属于设置页面自己的端口，
 * 走的是各厂商的设置文档 + 凭据服务）。后续任务若要在远程上开放写操作，应当扩展**自己的**
 * 端口类型并说明写入路径，而不是让这个只读面顺带持有写能力。
 */
export type UsageAccountReader = Pick<AccountPort, "list">;

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
  readonly accounts: UsageAccountReader;
  readonly quota: QuotaPort;
  /** 配置里固定/首选的账号；`null` 表示自动轮换。 */
  readonly pinnedRef: () => string | null;
  /** 额度端口这一读报告的账号 ref（与 entry 里 `selectedRefOf` 同一个判定）。 */
  readonly quotaRef: () => string | undefined;
}

/** 一条额度摘要。字段一律**原样**搬运：读数里没有的字段不许补 0（全局约束）。 */
export interface QuotaSummary {
  plan?: string;
  windows: QuotaWindow[];
  failures: string[];
}

/** 账号行的展示状态：账号视图 + 生效标注 + 拒绝与额度。 */
export interface AccountUsageStatus extends AccountView {
  /**
   * 是否为当前生效账号。
   *
   * 「是否固定」**不在这里**：它由 `VendorUsageStatus.pinned` 一处给出（页面拿 `ref` 比对即可）。
   * 同一件事在两个地方各写一遍，迟早会给出两个互相矛盾的答案。
   */
  effective: boolean;
  /** 拒绝/冷却；没有就是没有（不编造）。 */
  rejection?: { kind: FailureKind; until?: number };
  /** 额度摘要；**只有**额度读数所属的那一行才有这个字段。 */
  quota?: QuotaSummary;
}

/** 一个厂商的完整状态。 */
export interface VendorUsageStatus {
  vendor: VendorId;
  /** 配置里固定的账号；`null` 表示自动轮换。 */
  pinned: string | null;
  /** 生效账号；从未发过请求时**没有**这个字段。 */
  effective?: EffectiveAccount;
  /** 最近一次切换；从未切换过时**没有**这个字段。 */
  switch?: SwitchNotice;
  accounts: AccountUsageStatus[];
  /** 额度等读取失败的原因，供 UI 提示数据不完整。 */
  failures: string[];
}

/** 切换记录：Task 2 的切换通知 + 厂商标签（`switches()` 一次只发布一家的）。 */
export interface SwitchRecord extends SwitchNotice {
  vendor: VendorId;
}

/** 宿主 `ctx.typert` 的最小形状（只认本项目用到的 `register`）。 */
interface HostTypertRegistry {
  register(contribution: HostRemoteContribution): unknown;
}

/** 一个强类型调用描述符（字段名取自 `@deepseek-ai/dsh-typert-protocol` 的 `InvocationDescriptor`）。 */
interface HostInvocationDescriptor {
  id: string;
  service: string;
  namespace: string;
  method: string;
  invocation: { kind: "direct" };
  parameters: readonly unknown[];
  result: { mode: "strict"; typeSymbol: string; create: () => { parse: (value: unknown) => unknown } };
}

/** 注册给宿主的贡献形状：与旧插件同一组字段（`face: "host"` 是宿主面）。 */
interface HostRemoteContribution {
  package: string;
  face: "host";
  schemas: readonly unknown[];
  model: { services: readonly unknown[]; events: readonly unknown[]; objects: readonly unknown[] };
  invocations: readonly HostInvocationDescriptor[];
}

/** 边界校验失败的错误：说出是哪个端点、哪个字段。 */
function boundaryError(endpoint: string, detail: string): Error {
  return new Error(`${USAGE_PACKAGE}: ${endpoint} boundary violation: ${detail}`);
}

/** 判定「普通对象」。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判定「能挂属性的宿主对象」：cordis 的 `Service` 对外是**可调用代理**（`typeof` 是 `"function"`），
 * 所以只认 `typeof === "object"` 会漏掉服务实例 —— 那会让第二行以为服务不存在，从而重复构造。
 */
function isServiceLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** 校验线上厂商 id。 */
function parseVendorId(value: unknown): VendorId {
  if (value === "commandcode" || value === "dsh-opencode-go") return value;
  throw boundaryError(`${USAGE_NAMESPACE}/vendor`, `expected a known vendor id, got ${JSON.stringify(value)}`);
}

/** 校验状态结果：只查结构（数据由本进程产生，深校验没有额外价值）。 */
function parseVendorUsageStatus(value: unknown): VendorUsageStatus {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw boundaryError(`${USAGE_NAMESPACE}/status`, "expected an object with an accounts array");
  }
  return value as unknown as VendorUsageStatus;
}

/** 校验账号行数组。 */
function parseAccountViews(value: unknown): AccountView[] {
  if (!Array.isArray(value)) throw boundaryError(`${USAGE_NAMESPACE}/accounts`, "expected an array of account views");
  return value as AccountView[];
}

/** 校验切换记录数组。 */
function parseSwitchRecords(value: unknown): SwitchRecord[] {
  if (!Array.isArray(value)) throw boundaryError(`${USAGE_NAMESPACE}/switches`, "expected an array of switch records");
  return value as SwitchRecord[];
}

/** 造一个强类型结果编解码（与旧插件 `makeStrictCodec` 同形）。 */
function strictCodec(
  typeSymbol: string,
  parse: (value: unknown) => unknown,
): HostInvocationDescriptor["result"] {
  return { mode: "strict", typeSymbol: `${USAGE_PACKAGE}#${typeSymbol}`, create: () => ({ parse }) };
}

/** 三个方法各占一个业务参数：厂商 id。 */
function vendorParameter(): unknown {
  return {
    name: "vendor",
    wire: "vendor",
    source: "json",
    codec: { mode: "strict", typeSymbol: `${USAGE_PACKAGE}#VendorId`, create: () => ({ parse: parseVendorId }) },
  };
}

/** 造一个强类型调用描述符（端点 = `<namespace>/<method>`，与旧插件同一约定）。 */
function makeDescriptor(method: string, typeSymbol: string, parse: (value: unknown) => unknown): HostInvocationDescriptor {
  return {
    id: `${USAGE_PACKAGE}#${USAGE_NAMESPACE}/${method}`,
    service: USAGE_SERVICE_KEY,
    namespace: USAGE_NAMESPACE,
    method,
    invocation: { kind: "direct" },
    parameters: [vendorParameter()],
    result: strictCodec(typeSymbol, parse),
  };
}

/** 三个远程方法。 */
const INVOCATIONS: readonly HostInvocationDescriptor[] = [
  makeDescriptor("status", "VendorUsageStatus", parseVendorUsageStatus),
  makeDescriptor("accounts", "AccountViewList", parseAccountViews),
  makeDescriptor("switches", "SwitchRecordList", parseSwitchRecords),
];

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

    // 额度读数只属于「当前选中的账号」（各厂商的额度端口就是这么做的）。归属必须显式给出，
    // 否则就会出现「把 A 的额度挂在 B 的卡片上」——那也是一种编造。
    const quotaRef = deps.quotaRef();
    const quotaApplies = quotaRef !== undefined && views.some((view) => view.ref === quotaRef);
    let quota: QuotaSummary | undefined;
    if (quotaApplies) {
      try {
        quota = quotaSummaryOf(await deps.quota.snapshot());
      } catch (error) {
        failures.push(`quota: ${vendor} read failed (${messageOf(error)})`);
      }
    }

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
        ...(quota !== undefined && view.ref === quotaRef ? { quota } : {}),
      };
    });

    const latestSwitch = engine.switchNotice();
    return {
      vendor,
      pinned,
      ...(effective === undefined ? {} : { effective }),
      ...(latestSwitch === undefined ? {} : { switch: latestSwitch }),
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
   * 切换记录，**最新在前**（仪表盘的切换记录区；每条都带厂商标签）。
   * @param vendor - 厂商 id。
   * @returns 切换记录数组。
   */
  async switches(vendor: VendorId): Promise<SwitchRecord[]> {
    const engine = this.requireVendor(vendor).rotation.current();
    return engine.switchNotices().map((notice) => ({ ...notice, vendor }));
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
}

/** 把额度读数转成摘要：字段原样搬运，缺失即缺失。 */
function quotaSummaryOf(snapshot: QuotaSnapshot): QuotaSummary {
  return {
    ...(snapshot.plan === undefined ? {} : { plan: snapshot.plan }),
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

    // 描述符只由创建服务的那一行注册一次。
    if (existing !== undefined) return;
    publishInvocations(remoteCtx);
  });
}

/** 把三个强类型调用描述符登记给宿主 `typert`。 */
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
  typert.register({
    package: USAGE_PACKAGE,
    face: "host",
    schemas: [],
    model: { services: [], events: [], objects: [] },
    invocations: INVOCATIONS,
  });
}

/** 本模块对外声明的厂商 id 列表（entry 侧接线时的自检用）。 */
export { VENDOR_IDS };
