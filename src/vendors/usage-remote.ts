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

import type {
  AccountPort,
  AccountView,
  LoginPort,
  LoginStatus,
  QuotaPort,
  QuotaSnapshot,
  VendorCapabilities,
  VendorId,
} from "../core/adapter";
import type { RotationAccess } from "./assembly";
import {
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  USAGE_SERVICE_KEY,
  usageDescriptors,
  type AccountUsageStatus,
  type AddAccountInput,
  type QuotaSummary,
  type SwitchRecord,
  type UsageInvocationDescriptor,
  type VendorUsageStatus,
} from "../client/usage-contract";

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
}

/** 宿主 `ctx.typert` 的最小形状（只认本项目用到的 `register`）。 */
interface HostTypertRegistry {
  register(contribution: HostRemoteContribution): unknown;
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
      capabilities: deps.capabilities,
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
    await this.requireVendor(vendor).accounts.select(ref);
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
    invocations: usageDescriptors(),
  });
}
