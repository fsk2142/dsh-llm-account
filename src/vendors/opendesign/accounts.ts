/**
 * Open Design 账号端口：真源在设置文档（命名空间 `llm-opendesign`），每个操作
 * **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；Review Focus 5）。
 *
 * 形状以 `opencode/accounts.ts` 为模板（计划 §2.4），按 Open Design 的账号事实扩展：
 * - 设置命名空间 `llm-opendesign`（计划 §1）；
 * - 账号条目 `{ id, name, apiKeyEnv, controlKeyEnv?, workspaceId? }`：`apiKeyEnv` 是**推理**
 *   密钥的槽（runtime key），`controlKeyEnv` 是**控制面**密钥的槽（额度/账单接口用），
 *   `workspaceId` 是这台机器上该账号的工作区（vela 周期额度查询用）；
 * - 顶层 `apiKeyEnv` 是**当前账号**（`select` 写它、`move` 把队首写回它），缺省
 *   {@link OPENDESIGN_DEFAULT_REF}；
 * - 账号身份一律是**凭据引用名 ref**（`accountRef("opendesign", label)` 的产物或存量文档里
 *   用户手写的引用名），存在条目的 `apiKeyEnv` 字段里。`name` 只用于展示，改名**绝不**重新
 *   推导 ref（Task 4 复核护栏）。
 *
 * **两个凭据槽**：一个账号最多占两个凭据槽（推理 + 控制面）。控制面槽的解析顺序是
 * 「条目里合法的 `controlKeyEnv`」→「由 ref 派生的 `_CONTROL` 槽」（{@link opendesignControlRef}）；
 * 默认槽（`apiKeyEnv` 恰好是 {@link OPENDESIGN_DEFAULT_REF} 的那一个）的派生控制槽是
 * {@link OPENDESIGN_DEFAULT_CONTROL_REF}（计划 §1）。`remove` 把**两个**槽都记进
 * `credentialCleanupRefs` —— 只记一个会让控制面密钥在账号删除后永远留在凭据库里。
 *
 * **写回纪律**：改条目时按字段覆盖（改 `name`、保留其它字段），改数组时只摘除目标条目，
 * 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
 * 引用名，`key` / `controlKey` 一律走凭据服务。
 *
 * **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
 * 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops。
 *
 * **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`）；
 * `controlKeyEnv` / `workspaceId` 不进意图 —— 意图携带的字段是**身份与去向**，这两个字段
 * 每轮从最新文档重算即可（它们由本次调用决定，不依赖旧文档），而 `AccountIntentKind` 是封闭
 * 联合，新增字段类型不属于本任务范围。提交还会按最新文档再判一次身份（ref 已在账号表里就
 * 不再追加条目、不再写凭据槽）。所有不改状态就可能失败的校验（标签、密钥、账号数上限、没有
 * 空闲 ref）都跑在 `append` 之前。
 *
 * 本任务**不**做：模型可见性（在适配器侧）、套餐过滤、按模型绑定的额外规则。
 * @module dsh-llm-account/src/vendors/opendesign/accounts
 */
import { randomUUID } from "node:crypto";

import type { AccountPort, AccountView, CredentialPort, SettingsOp, SettingsPort, VendorId } from "../../core/adapter";
import { accountRef, CREDENTIAL_REF_PATTERN, dedupeByRef, globalOrderOfVendor, moveFirst, readAccountSlot, reorder } from "../../core/accounts";
import type { AccountSlotReading } from "../../core/accounts";
import { normalizeKey } from "../../core/credentials";
import type { AccountIntent, AccountIntentKind, IntentLog } from "../../core/recovery";

/** 设置命名空间（计划 §1，全局约束，不得更改）。 */
export const OPENDESIGN_SETTINGS_NS = "llm-opendesign";

/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR: VendorId = "opendesign";

/** 顶层默认账号的推理凭据引用名（计划 §1）。 */
export const OPENDESIGN_DEFAULT_REF = "OPENDESIGN_API_KEY";

/** 顶层默认账号的控制面凭据引用名（计划 §1）。 */
export const OPENDESIGN_DEFAULT_CONTROL_REF = "OPENDESIGN_CONTROL_KEY";

/**
 * 账号数上限（与另两家同一条纪律）：第 21 个 `add` 必须**拒绝**，而不是静默丢弃或挤掉一个。
 */
export const MAX_ACCOUNTS = 20;

/** 账号条目的凭据引用字段（推理密钥槽）。 */
const REF_FIELD = "apiKeyEnv";

/** 账号条目的控制面凭据引用字段（额度/账单密钥槽）。 */
const CONTROL_FIELD = "controlKeyEnv";

/** 账号条目的工作区字段（vela 周期额度查询用）。 */
const WORKSPACE_FIELD = "workspaceId";

/** 账号条目的展示名称字段。 */
const LABEL_FIELD = "name";

/**
 * 账号条目的**默认名称**（登录时拿到的邮箱，2026-10-22 用户要求）。
 *
 * 为什么需要单独存：用户改名会覆盖 `name`，而原始邮箱就此丢失 ——
 * 「不想用自定义名了就恢复默认」这件事就做不到了。
 *
 * **兼容性**：老账号没有这个字段。读取方要能降级：
 * - 有它 → 「恢复默认名称」可用；
 * - 没有它 → 该菜单项不可用（不猜、不编一个名称出来）。
 *
 * 它只在登录落库时写一次，`rename` **永不改它** —— 默认值不该被用户的改名影响。
 */
const DEFAULT_LABEL_FIELD = "defaultName";

/** 账号条目的标识字段。 */
const ID_FIELD = "id";

/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";

/** 当前固定账号字段（顶层 `apiKeyEnv`）。 */
const ACTIVE_FIELD = "apiKeyEnv";

/** 全局顺序字段（`vendor:ref` 键；三家文档保存同一份）。 */
const ORDER_FIELD = "accountOrder";

/** 自动切换开关字段（`autoSwitch` 落库是三家共用的可靠性机制）。 */
const AUTO_SWITCH_FIELD = "autoSwitch";

/**
 * 待清理凭据引用数组字段。删除账号只**记录**待清理的 ref（推理槽 + 控制面槽），真正
 * `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
 */
const CLEANUP_FIELD = "credentialCleanupRefs";

/** ref 撞名时的后缀尝试上限（与另两家的同一上限）。 */
const MAX_REF_ATTEMPTS = 128;

/**
 * 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
 * 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
 */
const MAX_CONFLICT_RETRIES = 8;

/** 派生的控制面槽后缀（`<ref>_CONTROL`）。 */
const CONTROL_SUFFIX = "_CONTROL";

/** 账号端口的依赖（三个端口都由装配时注入，本模块不认识 `ctx`）。 */
export interface OpenDesignAccountDeps {
  /** 账号文档的真源。 */
  settings: SettingsPort;
  /** 密钥只经它进出，永不写入设置文档。 */
  credentials: CredentialPort;
  /**
   * 意图日志。**必须是每个设置命名空间唯一的那个实例**（`IntentLog` 的文档化前置条件：
   * 一份存储只配一个实例），本模块只使用注入的实例，不自建。
   */
  intents: IntentLog;
}

/** 追加账号的输入：展示名称与两个可选密钥（+ 可选工作区）。 */
export interface OpenDesignAccountInput {
  /** 用户可见名称（账号标签；ref 由它派生）。 */
  label: string;
  /** 推理密钥（runtime key）；缺省表示先建条目、稍后补。 */
  key?: string;
  /** 控制面密钥（额度接口用）；缺省表示这个账号只做推理。 */
  controlKey?: string;
  /** 工作区 id（vela 周期额度查询用）；缺省表示这台机器不知道该账号的工作区。 */
  workspaceId?: string;
}

/**
 * Open Design 的账号端口：`AccountPort` 的七个方法都在，`add` 多收两个可选字段
 * （控制面密钥与工作区）。多出来的字段不影响 `AccountPort` 的实现（多余参数是可选的）。
 */
export type OpenDesignAccounts = Omit<AccountPort, "add"> & {
  add(input: OpenDesignAccountInput): Promise<AccountView>;
  /**
   * 把工作区写进**这个账号自己的条目**（2026-10-20，多账号兼容）。
   *
   * 不在 `AccountPort` 里：那是三家共用的最小契约，工作区只有这一家有这个概念。
   */
  setWorkspace(ref: string, workspaceId: string): Promise<void>;
};

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文档里的账号数组（形状不可信，`null` 与非数组一律当空）。 */
function rawAccounts(value: Readonly<Record<string, unknown>>): readonly unknown[] {
  const accounts = value[ACCOUNTS_FIELD];
  return Array.isArray(accounts) ? accounts : [];
}

/** 文档里的待清理引用数组（写回时同样原样保留）。 */
function rawCleanupRefs(value: Readonly<Record<string, unknown>>): readonly unknown[] {
  const refs = value[CLEANUP_FIELD];
  return Array.isArray(refs) ? refs : [];
}

/** 读一个合法凭据引用名（不合法的值一律当缺失）。 */
function refValue(value: unknown): string | undefined {
  const ref = normalizeKey(value);
  return ref !== undefined && CREDENTIAL_REF_PATTERN.test(ref) ? ref : undefined;
}

/** 读一个账号条目的 ref（推理槽），读不到时为 `undefined`。 */
function refOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return refValue(item[REF_FIELD]);
}

/** 读一个账号条目的展示名称。 */
function labelOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return normalizeKey(item[LABEL_FIELD]);
}

/**
 * 读一个账号条目的**默认名称**（登录时的邮箱）。
 *
 * `undefined` 有两种情况，对「恢复默认名称」而言是同一件事（都不可用）：
 * - 老账号没有这个字段（2026-10-22 之前建的）；
 * - 字段存在但是空白。
 *
 * 不降级成「ref 里那段转义文本」—— 那是凭据槽名，不是用户能认的邮箱。
 * @param item - 账号条目（任意形状）。
 * @returns 默认名称，或 `undefined`。
 */
function defaultLabelOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return normalizeKey(item[DEFAULT_LABEL_FIELD]);
}

/** 文档里是否已有这个账号条目。 */
function hasAccount(value: Readonly<Record<string, unknown>>, ref: string): boolean {
  return rawAccounts(value).some((item) => refOf(item) === ref);
}

/**
 * 由账号 ref 派生控制面凭据槽。
 *
 * 默认槽（{@link OPENDESIGN_DEFAULT_REF}）派生到 {@link OPENDESIGN_DEFAULT_CONTROL_REF}
 * （计划 §1 的两个默认引用名）；其余账号派生到 `<ref>_CONTROL`。派生的槽名必满足凭据引用名
 * 的合法字符集（ref 本身合法，后缀只有字母与下划线）。
 * @param ref - 账号的推理凭据引用名。
 * @returns 控制面凭据引用名。
 */
export function derivedControlRef(ref: string): string {
  return ref === OPENDESIGN_DEFAULT_REF ? OPENDESIGN_DEFAULT_CONTROL_REF : `${ref}${CONTROL_SUFFIX}`;
}

/** 文档里承载某个账号的条目（形状不可信；找不到时为 `undefined`）。 */
function itemOf(value: Readonly<Record<string, unknown>>, ref: string): unknown {
  return rawAccounts(value).find((item) => refOf(item) === ref);
}

/**
 * 解析一个账号 **当前生效**的控制面凭据槽：条目里合法的 `controlKeyEnv` 优先（用户手写的
 * 或历史文档里的槽名），没有时回落到派生槽（{@link derivedControlRef}）。
 * @param value - 现读的设置文档。
 * @param ref - 目标账号的推理凭据引用名。
 * @returns 该账号的控制面凭据引用名。
 */
export function opendesignControlRef(value: Readonly<Record<string, unknown>>, ref: string): string {
  const entry = itemOf(value, ref);
  const declared = isRecord(entry) ? refValue(entry[CONTROL_FIELD]) : undefined;
  return declared ?? derivedControlRef(ref);
}

/**
 * 解析一个账号的工作区 id：条目 `workspaceId` 优先，其次顶层 `workspaceId`（计划 §2.5：
 * 「只在该账号配置了 workspaceId 且本机能解析到 vela 时查询」）。
 * @param value - 现读的设置文档。
 * @param ref - 目标账号的推理凭据引用名。
 * @returns 工作区 id，或 `undefined`。
 */
export function opendesignWorkspaceId(value: Readonly<Record<string, unknown>>, ref: string): string | undefined {
  const entry = itemOf(value, ref);
  const declared = isRecord(entry) ? normalizeKey(entry[WORKSPACE_FIELD]) : undefined;
  return declared ?? normalizeKey(value[WORKSPACE_FIELD]);
}

/**
 * 固定账号槽：**哨兵词汇只在这一个函数里决定**（缺失、空串与非法值都读作自动轮换）。
 *
 * `fallback` 是默认引用名 {@link OPENDESIGN_DEFAULT_REF}：顶层 `apiKeyEnv` 就叫这个名字时，
 * `slot.ref` 恰好是「默认槽的 ref」。入口的 `pinnedRefOf`/`defaultRefOf` 与端口的
 * `activeRefOf`（`list()` 的 active、`remove()` 的回落、`add()` 的返回）都读它。
 * @param value - 现读的设置文档。
 * @returns 归一化后的槽判定。
 */
export function opendesignAccountSlot(value: Readonly<Record<string, unknown>>): AccountSlotReading {
  return readAccountSlot(value[ACTIVE_FIELD], { fallback: OPENDESIGN_DEFAULT_REF });
}

/**
 * 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串与非法引用名都算自动）。
 * @param value - 现读的设置文档。
 * @returns 固定账号的 ref，或 `undefined`（自动轮换）。
 */
function activeRefOf(value: Readonly<Record<string, unknown>>): string | undefined {
  return opendesignAccountSlot(value).pinned ?? undefined;
}

/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label: string): string {
  const next = normalizeKey(label);
  if (next === undefined) throw new Error("llm-opendesign: account name must not be blank");
  return next;
}

/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key: string, field: string): string {
  const next = normalizeKey(key);
  if (next === undefined) throw new Error(`llm-opendesign: ${field} must not be blank`);
  return next;
}

/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error: unknown): boolean {
  return isRecord(error) && error.code === "SETTINGS_CONFLICT";
}

/** 未知账号 ref（改名/换 key/固定/排序时用）。 */
function unknownRef(ref: string): Error {
  return new Error(`llm-opendesign: unknown account ref "${ref}"`);
}

/** 账号数超限（与另两家同一上限与同一拒绝姿态）。 */
function tooManyAccounts(): Error {
  return new Error(`llm-opendesign: Open Design supports at most ${MAX_ACCOUNTS} accounts`);
}

/**
 * 给新账号挑一个未被占用的 ref：先是 {@link opendesignAccountRef} 的产物，撞名时加数字后缀
 * （`_2`、`_3`…）。
 *
 * 占用集合 = 现有账号条目的 ref ∪ 它们的控制面槽 ∪ 待清理的 ref ∪ 顶层当前账号引用。
 * 这条护栏是 Review Focus 1 的机器化保证：两个账号永远不会共用同一个凭据槽，否则它们会
 * 互相污染失效标记与额度。
 * @param value - 当前设置文档。
 * @param label - 新账号的展示名称。
 * @returns 未被占用的 ref。
 */
function freeRef(value: Readonly<Record<string, unknown>>, label: string): string {
  const occupied = new Set<string>();
  for (const item of rawAccounts(value)) {
    const ref = refOf(item);
    if (ref === undefined) continue;
    occupied.add(ref);
    occupied.add(opendesignControlRef(value, ref));
  }
  for (const item of rawCleanupRefs(value)) {
    const ref = normalizeKey(item);
    if (ref !== undefined) occupied.add(ref);
  }
  const fallback = normalizeKey(value[REF_FIELD]);
  if (fallback !== undefined) occupied.add(fallback);

  const first = opendesignAccountRef(label);
  if (!occupied.has(first)) return first;
  for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
    const candidate = `${first}_${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`llm-opendesign: no free credential reference for name "${label}"`);
}

/**
 * 由账号标签推导 Open Design 的账号 ref（同时用作推理凭据槽名）。
 *
 * 形状为 `DSH_LLM_ACCOUNT_OPENDESIGN_<LABEL>_<HASH>`（`core/accounts.ts` 的 `accountRef`，
 * 验收 §7.3 要求凭据写入这套槽位）。标签先转大写并把非 `[A-Za-z0-9_]` 的字符替换成 `_`，
 * 后缀是原始标签的短哈希 —— 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足
 * 凭据引用名的合法字符集 `^[A-Za-z_][A-Za-z0-9_]*$`。
 * @param label - 用户可见名称。
 * @returns 该账号的 ref，可安全用作凭据槽名。
 */
export function opendesignAccountRef(label: string): string {
  return accountRef(VENDOR, label);
}

/** Open Design 的账号端口（设置变更实现）。 */
class OpenDesignAccountsImpl implements OpenDesignAccounts {
  readonly #deps: OpenDesignAccountDeps;

  /**
   * @param deps - 设置、凭据与意图日志三个端口。
   */
  constructor(deps: OpenDesignAccountDeps) {
    this.#deps = deps;
  }

  /**
   * @returns 账号行视图：身份取自 `apiKeyEnv`，`configured` 来自凭据服务。
   *
   * **只列文档里的真账号条目**（与另两家同一姿态：不再合成默认槽行）：顶层 `apiKeyEnv` 那个
   * 引用名只表示「当前账号是谁」，它的行在账号条目里（`open-design login` 与「添加账户」都
   * 会写条目）。当前账号显示在第一行（`moveFirst`，读时提位，不写设置）：`select` 写顶层
   * `apiKeyEnv`、`move` 把队首写回它，所以列表顺序必须让用户一眼看出谁在服务。
   */
  async list(): Promise<AccountView[]> {
    const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
    const slot = opendesignAccountSlot(snapshot.value);
    const views: AccountView[] = rawAccounts(snapshot.value)
      .map((item) => ({ ref: refOf(item), label: labelOf(item), defaultLabel: defaultLabelOf(item) }))
      .filter((item): item is { ref: string; label: string; defaultLabel: string | undefined } => item.ref !== undefined)
      .map((item) => ({
        ref: item.ref,
        label: item.label ?? item.ref,
        // 老账号没有这个字段：保持 `undefined`，界面据此禁用「恢复默认名称」（不猜）。
        ...(item.defaultLabel === undefined ? {} : { defaultLabel: item.defaultLabel }),
        configured: false,
        active: item.ref === slot.pinned,
      }));
    // 重复 ref 只保留第一个：同一个凭据槽不该在轮换里被算两轮（Review Focus 1）。
    const unique = dedupeByRef(moveFirst(views, slot.ref));
    // 列表顺序 = 全局顺序在本厂商的投影；没有全局顺序时保留派生顺序（当前账号提位）。
    const order = globalOrderOfVendor(unique.map((view) => view.ref), snapshot.value[ORDER_FIELD], VENDOR);
    const byRef = new Map(unique.map((view) => [view.ref, view]));
    const ordered = order.map((ref) => byRef.get(ref)).filter((view): view is AccountView => view !== undefined);
    const info = await this.#deps.credentials.describe(ordered.map((view) => view.ref));
    return ordered.map((view) => ({ ...view, configured: info[view.ref]?.configured === true }));
  }

  /**
   * 追加一个账号。
   *
   * **ref 在写意图之前解析**：它先进意图（`{ kind: "add", ref, label }`）、再进提交，提交用的
   * 就是这一个 ref。于是崩溃重放**按 ref 对齐**就够了 —— 同名标签合法（`_2` 后缀），按 label
   * 重新推导分不清「已提交但凭据没写成」「根本没提交」与「同名的存量账号」，会造出重复账号
   * 或把密钥写到错的账号上。
   *
   * **两个凭据槽都在提交之后写**：先落条目、再 `credentials.set(ref, key)`、
   * `credentials.set(controlRef, controlKey)`（与另两家「先条目后凭据」的次序一致）。任一步写
   * 失败都留下未决意图：重放能确认条目已经落地，但**补不回密钥** —— 那条账号会保持
   * `configured: false`，直到用户重新提供密钥。
   *
   * **提交是幂等的**：每一轮（含冲突重试）都拿**刚读到的**文档再判一次身份 —— 冻结的 ref
   * 已经在账号表里就不再追加第二个条目，也不再写凭据槽。
   *
   * 所有**不改状态就可能失败**的校验（标签、两把密钥、账号数上限、没有空闲 ref）都跑在
   * `append` 之前，因此日志里不会留下一条永远应用不了的意图。唯一一条「`append` 之后才可能
   * 失败」的校验是并发填满账号表：那次拒绝**必须先把意图收尾**（见 `#settleQuietly`），否则
   * 日志里会留下一条每次重放都抛错的 `add`，而 `IntentLog.replay` 不吞 `apply` 的错误。
   * @param input - 展示名称、可选的两把密钥与工作区。
   * @returns 新账号的视图。
   */
  async add(input: OpenDesignAccountInput): Promise<AccountView> {
    const label = requireLabel(input.label);
    const key = input.key === undefined ? undefined : requireKey(input.key, "API key");
    const controlKey = input.controlKey === undefined ? undefined : requireKey(input.controlKey, "control key");
    const workspaceId = normalizeKey(input.workspaceId);
    // 解析 ref 与两类拒绝（已满、没有空闲 ref）都在这里发生，不写意图（fail 在 append 之前）。
    const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
    if (rawAccounts(snapshot.value).length >= MAX_ACCOUNTS) throw tooManyAccounts();
    const ref = freeRef(snapshot.value, label);
    const controlRef = derivedControlRef(ref);
    const document = await this.#transaction("add", { ref, label }, async (intent) => {
      // `build` 是 async 的：并发上限复核必须**先 await 收尾**再抛，不能把一条悬浮的
      // promise 丢出去（`await` 会把它按普通错误冒泡，两条路径的错误形状才是同一个）。
      const { result: applied, value: current } = await this.#mutate<boolean>(async (value) => {
        // 最新文档里已经有这个 ref：这次 add 已经落地（自己的重试，或并发的同标签 add
        // 冻结到同一个确定性 ref）→ 空 ops 表示不落盘（见 `#mutate`），也不再写凭据槽。
        if (hasAccount(value, ref)) return { ops: [], result: false };
        const accounts = rawAccounts(value);
        // 上限按**当前文档**再判一次：并发的另一个 add 可能刚刚把表填满。这是 append
        // 之后才可能发生的失败，所以要**先把这条意图收尾**再抛（见方法文档）。
        if (accounts.length >= MAX_ACCOUNTS) {
          await this.#settleQuietly(intent);
          throw tooManyAccounts();
        }
        const entry: Record<string, unknown> = {
          [ID_FIELD]: ref,
          [LABEL_FIELD]: label,
          // 登录时的名称（邮箱）同时记为默认名：之后用户改名也能恢复回来。
          [DEFAULT_LABEL_FIELD]: label,
          [REF_FIELD]: ref,
          [CONTROL_FIELD]: controlRef,
        };
        if (workspaceId !== undefined) entry[WORKSPACE_FIELD] = workspaceId;
        const ops: SettingsOp[] = [{ op: "set", path: [ACCOUNTS_FIELD], value: [...accounts, entry] }];
        // 第一条账号自动成为当前账号。
        if (accounts.length === 0) ops.push({ op: "set", path: [ACTIVE_FIELD], value: ref });
        return { ops, result: true };
      });
      if (applied) {
        if (key !== undefined) await this.#deps.credentials.set(ref, key);
        if (controlKey !== undefined) await this.#deps.credentials.set(controlRef, controlKey);
      }
      return current;
    });
    const info = await this.#deps.credentials.describe([ref]);
    return { ref, label, configured: info[ref]?.configured === true, active: activeRefOf(document) === ref };
  }

  /**
   * 只改展示名称。**绝不**重新推导 ref：ref 是账号的身份键（也是两个凭据槽的名字来源），
   * 重推会让顺序、当前账号标记与凭据全部脱钩。
   * @param ref - 目标账号的 ref。
   * @param label - 新名称。
   */
  async rename(ref: string, label: string): Promise<void> {
    const next = requireLabel(label);
    await this.#require(ref);
    await this.#transaction("rename", { ref, label: next }, () =>
      this.#mutate((value) => ({
        ops: [
          {
            op: "set",
            path: [ACCOUNTS_FIELD],
            value: rawAccounts(value).map((item) =>
              refOf(item) === ref && isRecord(item) ? { ...item, [LABEL_FIELD]: next } : item,
            ),
          },
        ],
        result: undefined,
      })),
    );
  }

  /**
   * 把展示名称**恢复成登录时的默认名称**（2026-10-22 用户要求）。
   *
   * 语义：等价于 `rename(ref, defaultLabel)`，但**必须由账号自己记录的默认名驱动**，
   * 不能由调用方传一个「它以为的默认名」进来 —— 那会把「默认值」变成另一个可被改写的字段。
   *
   * 老账号没有 `defaultName` 时抛错（而不是静默无操作）：界面上那个菜单项本来就会
   * 因为 `view.defaultLabel === undefined` 而不显示，能走到这里说明有人直接调了远程方法，
   * 静默失败会让它以为成功了。
   * @param ref - 目标账号的 ref。
   */
  async restoreDefaultLabel(ref: string): Promise<void> {
    await this.#require(ref);
    // 默认名从**当前文档**读：`#require` 只保证条目存在，不返回内容。
    const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
    const entry = rawAccounts(snapshot.value).find((item) => refOf(item) === ref);
    const fallback = defaultLabelOf(entry);
    if (fallback === undefined) {
      throw new Error(`llm-opendesign: account "${ref}" has no recorded default name`);
    }
    await this.rename(ref, fallback);
  }

  /**
   * 把工作区写进**这个账号自己的条目**（多账号兼容的关键，2026-10-20）。
   *
   * 为什么必须逐账号：周期额度只来自 `vela billing preflight`，它按 `workspaceId` 查。
   * 旧实现在「同账号重新登录」时把发现到的工作区写进**顶层**字段（`fillTopLevelWorkspace`），
   * 而顶层是所有账号共用的回退 —— 第二个账号登录后会把顶层改成它自己的工作区，于是第一个
   * 账号（自己没配）回退到顶层，拿到的是**第二个账号的工作区**，额度就显示错了人。
   *
   * 空值不写：`undefined` / 空串表示「这次没发现到」，不该把已有值擦掉。
   * @param ref - 目标账号的 ref。
   * @param workspaceId - 工作区 id。
   */
  async setWorkspace(ref: string, workspaceId: string): Promise<void> {
    const next = normalizeKey(workspaceId);
    if (next === undefined) return;
    await this.#require(ref);
    await this.#transaction("set-workspace", { ref, workspaceId: next }, () =>
      this.#mutate((value) => ({
        ops: [
          {
            op: "set",
            path: [ACCOUNTS_FIELD],
            value: rawAccounts(value).map((item) =>
              refOf(item) === ref && isRecord(item) ? { ...item, [WORKSPACE_FIELD]: next } : item,
            ),
          },
        ],
        result: undefined,
      })),
    );
  }

  /**
   * 换推理密钥：只写凭据服务，设置文档一个字都不动（Global Constraints：文档里只允许出现
   * 凭据引用名）。与其它操作一样先写意图，凭据写入成功后才收尾。
   * @param ref - 目标账号的 ref。
   * @param key - 新密钥（空值/纯空白直接拒绝）。
   */
  async replaceKey(ref: string, key: string): Promise<void> {
    const next = requireKey(key, "API key");
    await this.#require(ref);
    await this.#transaction("replace-key", { ref }, async () => {
      await this.#deps.credentials.set(ref, next);
    });
  }

  /**
   * 移除账号：条目、必要时当前账号标记，并把**两个**凭据引用（推理槽 + 控制面槽）记进
   * `credentialCleanupRefs`。**真正删凭据不在本操作内**：只记录，等清理动作确认该 ref 不再
   * 被引用后再 `credentials.unset`。
   *
   * 当前账号的回落顺序：摘掉条目后，若当前账号就是被删的那个，回落到**剩余列表的第一个**；
   * 删空了才回到默认引用名 {@link OPENDESIGN_DEFAULT_REF}。
   *
   * 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
   * @param ref - 目标账号的 ref。
   */
  async remove(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
    if (!hasAccount(snapshot.value, ref)) return;
    await this.#transaction("remove", { ref }, () =>
      this.#mutate((value) => {
        const accounts = rawAccounts(value).filter((item) => refOf(item) !== ref);
        const controlRef = opendesignControlRef(value, ref);
        const ops: SettingsOp[] = [
          { op: "set", path: [ACCOUNTS_FIELD], value: accounts },
          {
            op: "set",
            path: [CLEANUP_FIELD],
            value: [...rawCleanupRefs(value).filter((item) => item !== ref && item !== controlRef), ref, controlRef],
          },
        ];
        if (activeRefOf(value) === ref) {
          const next = accounts.map((item) => refOf(item)).find((candidate) => candidate !== undefined);
          ops.push({ op: "set", path: [ACTIVE_FIELD], value: next ?? OPENDESIGN_DEFAULT_REF });
        }
        return { ops, result: undefined };
      }),
    );
  }

  /**
   * 固定账号或回到自动轮换。
   *
   * 可选的目标是账号条目自己的 ref；顶层 `apiKeyEnv` 当前是个合法引用名时，也允许固定到它
   * （`list()` 里当前账号被提到第一行，页面拿这一行的 ref 回来固定时必须成立）。
   * 写回的就是这个 ref 本身（`apiKeyEnv` 就是当前账号，没有槽 id 空间）。
   * @param ref - 目标账号的 ref；`null` 表示自动轮换（写回默认引用名）。
   */
  async select(ref: string | null): Promise<void> {
    if (ref !== null) {
      const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
      if (!hasAccount(snapshot.value, ref) && ref !== opendesignAccountSlot(snapshot.value).ref) throw unknownRef(ref);
    }
    await this.#transaction("select", ref === null ? {} : { ref }, () =>
      this.#mutate(() => ({
        ops: [{ op: "set", path: [ACTIVE_FIELD], value: ref ?? OPENDESIGN_DEFAULT_REF }],
        result: undefined,
      })),
    );
  }

  /**
   * 调整账号顺序。Open Design 的能力清单里 `reorder` 为真，所以本适配器**实现**它：用
   * `core/accounts` 的 `reorder` 算出新顺序，落到 `accounts` 数组。
   *
   * 同时把顶层 `apiKeyEnv` 指向移动后的队首（与 opencode 同一后果）：「列表首项 = 当前账号」
   * 是不变量，避免排序后当前账号与列表首项不一致。
   * @param ref - 目标账号的 ref。
   * @param toIndex - 移动后的最终下标；越界时 `reorder` 夹到两端。
   */
  async move(ref: string, toIndex: number): Promise<void> {
    await this.#require(ref);
    await this.#transaction("move", { ref, toIndex }, () =>
      this.#mutate((value) => {
        const accounts = rawAccounts(value);
        // 顺序只收**可读且第一次出现**的 ref：文档里的重复 ref 条目（手改坏的形状）不参与
        // 排序，原样缀在末尾 —— 本操作只动顺序，一个条目都不许丢。
        const order: string[] = [];
        const seen = new Set<string>();
        for (const item of accounts) {
          const itemRef = refOf(item);
          if (itemRef === undefined || seen.has(itemRef)) continue;
          seen.add(itemRef);
          order.push(itemRef);
        }
        const next = reorder(order, ref, toIndex);
        const byRef = new Map<string, unknown>();
        const extras: unknown[] = [];
        for (const item of accounts) {
          const itemRef = refOf(item);
          // 读不出 ref 的条目与重复 ref 的条目都原样保留：只动顺序，不丢未知形状的条目。
          if (itemRef === undefined || byRef.has(itemRef)) extras.push(item);
          else byRef.set(itemRef, item);
        }
        // 两个写入目标**各自**判定：「顺序没变」不写 accounts，「队首没变」不写 apiKeyEnv。
        const head = next[0];
        const active = activeRefOf(value);
        const orderChanged = next.join("\u0000") !== order.join("\u0000");
        const activeChanged = head !== undefined && active !== head;
        if (!orderChanged && !activeChanged) return { ops: [], result: undefined };
        const ops: SettingsOp[] = [];
        if (orderChanged) {
          ops.push({ op: "set", path: [ACCOUNTS_FIELD], value: [...next.map((candidate) => byRef.get(candidate)), ...extras] });
        }
        if (activeChanged) ops.push({ op: "set", path: [ACTIVE_FIELD], value: head });
        return { ops, result: undefined };
      }),
    );
  }

  /**
   * 写全局顺序（`vendor:ref`；三家文档保存同一份）。
   * @param order - 全局顺序键。
   */
  async setOrder(order: readonly string[]): Promise<void> {
    const clean = order.filter((key): key is string => typeof key === "string" && key.trim() !== "");
    await this.#mutate(() => ({
      ops: [{ op: "set", path: [ORDER_FIELD], value: clean }],
      result: undefined,
    }));
  }

  /**
   * 写自动切换开关（`autoSwitch` 落库是三家共用的可靠性机制）。
   * @param value - 开关值。
   */
  async setAutoSwitch(value: boolean): Promise<void> {
    await this.#transaction("auto-switch", { value }, () =>
      this.#mutate(() => ({
        ops: [{ op: "set", path: [AUTO_SWITCH_FIELD], value }],
        result: undefined,
      })),
    );
  }

  /**
   * 一次完整事务：先 `append` 意图，再交给 `submit`，全部成功后才 `settle`。顺序不能颠倒：
   * 崩溃时留下的未决意图正是重放的依据。
   * @param kind - 意图类型。
   * @param fields - 意图携带的 ref/label/toIndex/value。
   * @param submit - 真正的提交动作；收到这条意图，便于在「已经 append、才发现不该提交」的
   *   路径上先把它收尾再抛（见 `#settleQuietly`）。
   * @returns `submit` 的结果。
   */
  async #transaction<T>(
    kind: AccountIntentKind,
    fields: { ref?: string; label?: string; toIndex?: number; value?: boolean; workspaceId?: string },
    submit: (intent: AccountIntent) => Promise<T>,
  ): Promise<T> {
    const intent = this.#intent(kind, fields);
    await this.#deps.intents.append(intent);
    const result = await submit(intent);
    await this.#deps.intents.settle(intent.id);
    return result;
  }

  /**
   * 把一条**已经 append 但决定不提交**的意图收尾掉（用途只有 `add` 的并发上限复核，见
   * `opencode/accounts.ts` 的同名方法说明）。收尾本身写失败不抛出：那条意图会留在日志里
   * （与「凭据写失败」同一类未决状态），但调用方拿到的仍是这次拒绝的真实原因（满表）。
   * @param intent - 已 append 的意图。
   */
  async #settleQuietly(intent: AccountIntent): Promise<void> {
    try {
      await this.#deps.intents.settle(intent.id);
    } catch {
      // 收尾失败不掩盖拒绝原因：调用方要的是「为什么这次 add 没成功」。
    }
  }

  /**
   * 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新文档
   * 重算 ops 后再提交。冲突时**不**覆盖对方的写入。
   *
   * `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add` 发现
   * 冻结的 ref 已经存在、`move` 发现位置没变都是这种情况）：直接返回，**不落盘**。这样
   * 「幂等的提交」不必伪造一次空写，也不会白白推进修订号去作废别人的写入。
   *
   * `build` 允许是 async 的：`add` 的并发上限复核要在「已经读到满表」时先 `settle` 掉那条
   * 意图再抛（见 `#settleQuietly`）。`build` 抛出的错误原样冒泡，且**不计**冲突重试。
   * @param build - 由最新文档算出 ops 与调用方要的结果。
   * @returns 调用方的结果与提交后的文档。
   */
  async #mutate<T>(
    build: (
      value: Readonly<Record<string, unknown>>,
    ) => { ops: readonly SettingsOp[]; result: T } | Promise<{ ops: readonly SettingsOp[]; result: T }>,
  ): Promise<{ result: T; value: Readonly<Record<string, unknown>> }> {
    for (let attempt = 0; ; attempt += 1) {
      const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
      const { ops, result } = await build(snapshot.value);
      if (ops.length === 0) return { result, value: snapshot.value };
      try {
        const committed = await this.#deps.settings.mutate(OPENDESIGN_SETTINGS_NS, ops, snapshot.revision);
        return { result, value: committed.value };
      } catch (error) {
        if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
        // 修订号过期：下一轮重读并用新修订号重放本次操作（ops 会按新文档重算）。
      }
    }
  }

  /** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
  async #require(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(OPENDESIGN_SETTINGS_NS);
    if (!hasAccount(snapshot.value, ref)) throw unknownRef(ref);
  }

  /** 造一条带唯一 id 的意图（`createdAt` 仅供展示，不参与排序）。 */
  #intent(
    kind: AccountIntentKind,
    fields: { ref?: string; label?: string; toIndex?: number; value?: boolean },
  ): AccountIntent {
    return {
      id: randomUUID(),
      kind,
      createdAt: Date.now(),
      ...(fields.ref === undefined ? {} : { ref: fields.ref }),
      ...(fields.label === undefined ? {} : { label: fields.label }),
      ...(fields.toIndex === undefined ? {} : { toIndex: fields.toIndex }),
      ...(fields.value === undefined ? {} : { value: fields.value }),
    };
  }
}

/**
 * 造一个 Open Design 账号端口（真源在设置文档，两把密钥都走凭据服务）。
 * @param deps - 设置、凭据与意图日志三个端口。
 * @returns 账号端口；七条命令全部实现（含 `move`、`setOrder` 与 `setAutoSwitch`）。
 */
export function createOpenDesignAccounts(deps: OpenDesignAccountDeps): OpenDesignAccounts {
  return new OpenDesignAccountsImpl(deps);
}
