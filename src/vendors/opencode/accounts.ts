/**
 * opencode 账号端口：真源在设置文档（命名空间 `llm-opencode-go`），每个操作
 * **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；
 * Review Focus 5）。
 *
 * 形状逐条对照旧插件 `dsh-opencode-go/lib/index.js`：
 * - 设置命名空间 `llm-opencode-go`（旧插件第 8025 行的 `SETTINGS_NAMESPACE`）；
 * - 账号条目 `{ id, name, apiKeyEnv }`（旧插件 Config schema 第 6825-6829 行），
 *   身份是 `apiKeyEnv` 里的凭据引用名 ref；顶层 `apiKeyEnv` 是**当前账号**
 *   （旧插件第 6824 行，`accountRefOf` 第 6784-6786 行把空串归一成默认引用名）；
 * - `autoSwitch`（第 6830 行）；
 * - `remove` 的候选回落顺序（旧插件第 8178-8180 行）：摘掉条目 → 若当前账号是它就
 *   回落到剩余列表里的第一个（删空了才回到默认引用名）；
 * - **合成的默认槽**：当前账号（顶层 `apiKeyEnv`）不在 `accounts[]` 里时，旧插件
 *   `accountsOf`（第 6783-6790 行）补一条 `{ id: "legacy:<ref>", name: "", apiKeyEnv: ref }`
 *   放在首位。`list()` 因此也补出这一行（`opencodeAccountSlot`），否则用户现有那种
 *   「没有 `accounts` 键、只有顶层 `apiKeyEnv`」的行会一行账号都列不出来。
 *
 * **注意**：旧插件的设置文档里**没有** commandcode 那套 `modelAccountRules`，也**没有**
 * `credentialCleanupRefs`（它的恢复状态叫 `accountOperations`，见下）。前者按模型绑定
 * 属于 opencode 的模型可见性功能（`modelVisibility`，第 6819 行），不在本任务的
 * `AccountPort` 契约里；后者是本项目为「删除账号后清理凭据」引入的字段（与 commandcode
 * 同名同义），因为本项目的凭据删除由清理动作而不是删除操作本身负责。
 *
 * 本任务与计划原文的差异（控制器补充 3 优先）：
 * - 计划 Step 3 描述的是旧插件的 `accountOperations` 恢复日志；本项目的意图日志是共享
 *   内核的 `IntentLog`（Task 8），所以本模块**不**读写 `accountOperations`：
 *   `IntentLog` 已经是「先记意图、崩溃后重放」的那一层。
 * - 旧插件的 `move` 会把当前账号顺带改成队首（第 8451-8453 行）；这里保留这个行为
 *   （见 `move` 的说明），因为旧插件读当前账号时本来就会把「不在账号表里的引用名」
 *   回落到列表第一个。
 *
 * **标识空间**：账号身份一律是凭据引用名 ref（{@link opencodeAccountRef} 的产物或
 * 存量文档里用户手写的引用名），存在条目的 `apiKeyEnv` 字段里。`name` 只用于展示，
 * 改名**绝不**重新推导 ref（Task 4 复核护栏）。
 *
 * **写回纪律**：改条目时按字段覆盖（改 `name`、保留其它字段），改数组时只摘除目标条目，
 * 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
 * `{ id, name, apiKeyEnv }`，`key` 一律走凭据服务。
 *
 * **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
 * 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops，所以重放的是
 * 「用户的操作」而不是过期的 ops。
 *
 * **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`），
 * 提交用的就是同一个 ref —— 重放因此按 ref 对齐，不必按 name 猜（同名标签合法）。提交还会按
 * **最新文档**再判一次身份（ref 已在账号表里就不再追加条目、不再写凭据槽）。所有不改状态就
 * 可能失败的校验（标签、密钥、账号数上限、没有空闲 ref）都跑在 `append` 之前。
 *
 * 本任务**不**做：网页登录（opencode 没有）、客户端页面（计划 1b）、代理与协议覆盖与诊断
 * 导出（第 3 期）、用量胶囊与 TUI 页（第 2 期）。
 * @module dsh-llm-account/src/vendors/opencode/accounts
 */
import { randomUUID } from "node:crypto";

import type { AccountPort, AccountView, CredentialPort, SettingsOp, SettingsPort } from "../../core/adapter";
import { CREDENTIAL_REF_PATTERN, dedupeByRef, moveFirst, readAccountSlot, reorder } from "../../core/accounts";
import type { AccountSlotReading } from "../../core/accounts";
import { normalizeKey } from "../../core/credentials";
import type { AccountIntent, AccountIntentKind, IntentLog } from "../../core/recovery";

/** 设置命名空间（全局约束，不得更改）。 */
export const OPENCODE_SETTINGS_NS = "llm-opencode-go";

/**
 * 账号数上限（旧插件 `MAX_ACCOUNTS` 第 6780 行）。第 21 个 `add` 必须**拒绝**，
 * 而不是静默丢弃或挤掉一个。
 */
export const MAX_ACCOUNTS = 20;

/**
 * 新账号 ref 的前缀（旧插件 `ACCOUNT_REF_PREFIX` 第 6781 行）。沿用旧插件的槽名前缀让
 * 存量账号零迁移：旧文档里的 ref 就是 `DSH_OPENCODE_GO_ACCOUNT_<32 位十六进制>`，
 * 新账号落在同一套命名里。
 */
export const OPENCODE_ACCOUNT_REF_PREFIX = "DSH_OPENCODE_GO_ACCOUNT_";

/** 顶层 `apiKeyEnv` 的默认值（旧插件 `DEFAULT_ACCOUNT_REF` 第 6782 行）。 */
export const OPENCODE_DEFAULT_REF = "OPENCODE_API_KEY";

/** 账号条目的凭据引用字段（旧插件 Config schema 第 6828 行）。 */
const REF_FIELD = "apiKeyEnv";

/** 账号条目的展示名称字段（旧插件 Config schema 第 6827 行）。 */
const LABEL_FIELD = "name";

/** 账号条目的标识字段（旧插件 Config schema 第 6826 行）。 */
const ID_FIELD = "id";

/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";

/** 当前固定账号字段（顶层 `apiKeyEnv`）。 */
const ACTIVE_FIELD = "apiKeyEnv";

/**
 * 待清理凭据引用数组字段。本项目引入（与 commandcode 同名同义）：删除账号只**记录**待清理的
 * ref，真正 `credentials.unset` 留给确认该 ref 不再被引用的清理动作。
 */
const CLEANUP_FIELD = "credentialCleanupRefs";

/** ref 撞名时的后缀尝试上限（与 commandcode 的同一上限）。 */
const MAX_REF_ATTEMPTS = 128;

/**
 * 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
 * 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
 */
const MAX_CONFLICT_RETRIES = 8;

/** 哈希后缀的十六进制位数（48 位）：足够隔离标签转义碰撞，同时保持槽名可读。 */
const HASH_SUFFIX_LENGTH = 12;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/** 账号端口的依赖（三个端口都由 Task 14 装配时注入，本模块不认识 `ctx`）。 */
export interface OpencodeAccountDeps {
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

/**
 * 计算文本的 64 位 FNV-1a 哈希，返回 16 位十六进制。
 * 与 `core/accounts.ts` 的 `hashText` 同算法：ref 的形状由本适配器决定（旧插件的前缀），
 * 但「标签不同、转义后同名」要靠同一个哈希区分。
 * @param text - 原始文本。
 * @returns 16 位小写十六进制字符串。
 */
function hashText(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const char of text) {
    hash = (hash ^ BigInt(char.codePointAt(0) ?? 0)) & UINT64_MASK;
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * 把任意文本折进 `[A-Z0-9_]`：先转大写，再把每个非法字符替换成 `_`（不折叠连续下划线 ——
 * 折叠会丢信息，反而让不同标签更容易撞名）。
 * @param text - 待转义的文本。
 * @returns 只含大写字母、数字与下划线的文本。
 */
function escapeText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/**
 * 由账号标签推导 opencode 的账号 ref（同时用作凭据槽名）。
 *
 * 形状为 `DSH_OPENCODE_GO_ACCOUNT_<LABEL>_<HASH>`：沿用**旧插件的槽名前缀**（控制器补充 3，
 * 存量账号零迁移），标签先转大写并把非 `[A-Za-z0-9_]` 的字符替换成 `_`，后缀是原始标签的
 * 短哈希 —— 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足凭据引用名的合法
 * 字符集 `^[A-Za-z_][A-Za-z0-9_]*$`。
 *
 * 与旧插件的差别：旧插件用随机 32 位十六进制 id，ref 与标签无关；这里让 ref 由标签确定性地
 * 推导，好处是并发的同标签 `add` 会冻结到同一个 ref（提交时的身份闸门因此能挡住重复条目），
 * 代价是撞名要加 `_2`、`_3`… 后缀（见 `freeRef`）。
 * @param label - 用户可见名称。
 * @returns 该账号的 ref，可安全用作凭据槽名。
 */
export function opencodeAccountRef(label: string): string {
  return `${OPENCODE_ACCOUNT_REF_PREFIX}${escapeText(label)}_${hashText(label).slice(0, HASH_SUFFIX_LENGTH)}`;
}

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

/** 读一个账号条目的 ref（存量的合法凭据引用名），读不到时为 `undefined`。 */
function refOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  const ref = normalizeKey(item[REF_FIELD]);
  return ref !== undefined && CREDENTIAL_REF_PATTERN.test(ref) ? ref : undefined;
}

/** 读一个账号条目的展示名称。 */
function labelOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return normalizeKey(item[LABEL_FIELD]);
}

/** 文档里是否已有这个账号条目。 */
function hasAccount(value: Readonly<Record<string, unknown>>, ref: string): boolean {
  return rawAccounts(value).some((item) => refOf(item) === ref);
}

/**
 * 当前账号槽：**哨兵词汇只在这一个函数里决定**（缺失、空串与非法值都读作自动轮换 ——
 * 旧插件 `accountRefOf` 第 6784-6786 行把空串归一成默认引用名，也就是「没有固定账号」）。
 *
 * `fallback` 是内置默认引用名 {@link OPENCODE_DEFAULT_REF}：它是旧插件合成默认槽时用的那个
 * ref（第 6791-6792 行 `legacy:<ref>` 的 `<ref>`），所以 `slot.ref` 恰好就是「默认槽的 ref」。
 * 入口的 `pinnedRefOf`/`defaultRefOf`（轮换引擎的固定账号与顺序首项）与端口的
 * `activeRefOf`（`list()` 的 active、`remove()` 的回落）都读它。
 * @param value - 现读的设置文档。
 * @returns 归一化后的槽判定。
 */
export function opencodeAccountSlot(value: Readonly<Record<string, unknown>>): AccountSlotReading {
  return readAccountSlot(value[ACTIVE_FIELD], { fallback: OPENCODE_DEFAULT_REF });
}

/**
 * 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串与非法引用名都算自动）。
 */
function activeRefOf(value: Readonly<Record<string, unknown>>): string | undefined {
  return opencodeAccountSlot(value).pinned ?? undefined;
}

/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label: string): string {
  const next = normalizeKey(label);
  if (next === undefined) throw new Error("llm-opencode-go: account name must not be blank");
  return next;
}

/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key: string): string {
  const next = normalizeKey(key);
  if (next === undefined) throw new Error("llm-opencode-go: API key must not be blank");
  return next;
}

/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error: unknown): boolean {
  return isRecord(error) && error.code === "SETTINGS_CONFLICT";
}

/** 未知账号 ref（改名/换 key/固定/排序时用）。 */
function unknownRef(ref: string): Error {
  return new Error(`llm-opencode-go: unknown account ref "${ref}"`);
}

/** 账号数超限（旧插件 `assertAccounts` 第 6798-6800 行的同一上限与同一拒绝姿态）。 */
function tooManyAccounts(): Error {
  return new Error(`llm-opencode-go: OpenCode Go supports at most ${MAX_ACCOUNTS} accounts`);
}

/**
 * 给新账号挑一个未被占用的 ref：先是 {@link opencodeAccountRef} 的产物，撞名时按旧插件的
 * 办法加数字后缀（`_2`、`_3`…）。
 *
 * 占用集合 = 现有账号条目的 ref ∪ 待清理的 ref ∪ 顶层当前账号引用。这条护栏是
 * Review Focus 1 的机器化保证：两个账号永远不会共用同一个凭据槽，否则它们会互相污染
 * 失效标记与额度。
 * @param value - 当前设置文档。
 * @param label - 新账号的展示名称。
 * @returns 未被占用的 ref。
 */
function freeRef(value: Readonly<Record<string, unknown>>, label: string): string {
  const occupied = new Set<string>();
  for (const item of rawAccounts(value)) {
    const ref = refOf(item);
    if (ref !== undefined) occupied.add(ref);
  }
  for (const item of rawCleanupRefs(value)) {
    const ref = normalizeKey(item);
    if (ref !== undefined) occupied.add(ref);
  }
  const fallback = normalizeKey(value[REF_FIELD]);
  if (fallback !== undefined) occupied.add(fallback);

  const first = opencodeAccountRef(label);
  if (!occupied.has(first)) return first;
  for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
    const candidate = `${first}_${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`llm-opencode-go: no free credential reference for name "${label}"`);
}

/** opencode 的账号端口（设置变更实现）。 */
class OpencodeAccounts implements AccountPort {
  readonly #deps: OpencodeAccountDeps;

  /**
   * @param deps - 设置、凭据与意图日志三个端口。
   */
  constructor(deps: OpencodeAccountDeps) {
    this.#deps = deps;
  }

  /**
   * @returns 账号行视图：身份取自 `apiKeyEnv`，`configured` 来自凭据服务。
   *
   * **当前账号显示在第一行**（旧插件 `accountsOf` 第 6783-6790 行 + `moveAccountFirst`
   * 第 6779 行的同一派生）：顶层 `apiKeyEnv` 就是「当前账号」（`select` 写它、`move`
   * 把队首跟到它），所以列表顺序必须让用户一眼看出谁在服务 —— 参考实现的会话面板
   * 「第一行成为当前账号；顺序也决定自动尝试备用账号的次序」说的就是这件事。
   * 派生（读时提位）而不是写设置：`select` 已经改了顶层引用，顺序显示跟着派生即可，
   * 不值得为用户点一次「切换」就多写一次文档。
   *
   * 当前账号不在 `accounts[]` 里时（用户现有的 opencode 行根本没有 `accounts` 键），
   * 合成一条默认槽行补在最前面（旧插件同一形状：`legacy:<ref>`）—— 只列 `accounts[]`
   * 会让正在服务请求的那个账号一行都不显示、也固定不了。真账号条目已占用这个 ref 时
   * 不合成（同 ref 的重复行不该出现）。
   */
  async list(): Promise<AccountView[]> {
    const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
    const slot = opencodeAccountSlot(snapshot.value);
    const views: AccountView[] = [];
    if (!hasAccount(snapshot.value, slot.ref)) {
      views.push({ ref: slot.ref, label: slot.ref, configured: false, active: slot.pinned === slot.ref });
    }
    views.push(
      ...rawAccounts(snapshot.value)
        .map((item) => ({ ref: refOf(item), label: labelOf(item) }))
        .filter((item): item is { ref: string; label: string } => item.ref !== undefined)
        .map((item) => ({ ref: item.ref, label: item.label ?? item.ref, configured: false, active: item.ref === slot.pinned })),
    );
    // 重复 ref 只保留第一个：同一个凭据槽不该在轮换里被算两轮（Review Focus 1）。
    const unique = dedupeByRef(moveFirst(views, slot.ref));
    const info = await this.#deps.credentials.describe(unique.map((view) => view.ref));
    return unique.map((view) => ({ ...view, configured: info[view.ref]?.configured === true }));
  }

  /**
   * 追加一个账号。
   *
   * **ref 在写意图之前解析**：它先进意图（`{ kind: "add", ref, label }`）、再进提交，
   * 提交用的就是这一个 ref。于是崩溃重放**按 ref 对齐**就够了 —— 同名标签合法（`_2`
   * 后缀），按 label 重新推导分不清「已提交但凭据没写成」「根本没提交」与「同名的存量
   * 账号」，会造出重复账号或把密钥写到错的账号上。
   *
   * **提交是幂等的**：每一轮（含冲突重试）都拿**刚读到的**文档再判一次身份 —— 冻结的
   * ref 已经在账号表里就不再追加第二个条目，也不再写凭据槽。同标签的并发 `add` 会因为
   * `opencodeAccountRef` 的确定性而冻结到同一个 ref：没有这道闸门，两次调用会把同一个
   * 凭据槽写两遍（`list()` 的 `dedupeByRef` 只会把重复行藏起来，文档里仍然留着两条）。
   *
   * 所有**不改状态就可能失败**的校验（标签、密钥、账号数上限、没有空闲 ref）都跑在
   * `append` 之前，因此日志里不会留下一条永远应用不了的意图。真正写失败（凭据服务写失败、
   * 设置冲突重试用尽）才留下未决意图：重放能确认账号条目已经落地，但**补不回密钥** ——
   * 那条账号会保持 `configured: false`，直到用户重新提供密钥（`replaceKey`）。带 `key` 时
   * 先提交账号条目、再写凭据服务（旧插件 `begin()` → `credentials.set` 的次序，第 8393-8396 行）。
   *
   * **并发填满账号表**是唯一一条「`append` 之后才可能失败」的校验：另一次 `add` 在读取与
   * 提交之间把表填满时，本方法的复核会拒绝本次提交。这条拒绝**必须先把意图收尾**（见
   * `#settleQuietly`）——否则日志里会留下一条每次重放都抛错的 `add`，而
   * `IntentLog.replay` 不吞 `apply` 的错误，一条这样的意图会拖停整轮回放。
   * @param input - 展示名称与可选密钥。
   * @returns 新账号的视图。
   */
  async add(input: { label: string; key?: string }): Promise<AccountView> {
    const label = requireLabel(input.label);
    const key = input.key === undefined ? undefined : requireKey(input.key);
    // 解析 ref 与两类拒绝（已满、没有空闲 ref）都在这里发生，不写意图（fail 在 append 之前）。
    const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
    if (rawAccounts(snapshot.value).length >= MAX_ACCOUNTS) throw tooManyAccounts();
    const ref = freeRef(snapshot.value, label);
    const document = await this.#transaction("add", { ref, label }, async (intent) => {
      // `build` 是 async 的：并发上限复核必须**先 await 收尾**再抛，不能把一条悬浮的
      // promise 丢出去（`await` 会把它按普通错误冒泡，两条路径的错误形状才是同一个）。
      const { result: applied, value: current } = await this.#mutate<boolean>(async (value) => {
        // 最新文档里已经有这个 ref：这次 add 已经落地（自己的重试，或并发的同标签 add
        // 冻结到同一个确定性 ref）→ 空 ops 表示不落盘（见 `#mutate`），也不再写凭据槽。
        if (hasAccount(value, ref)) return { ops: [], result: false };
        const accounts = rawAccounts(value);
        // 上限按**当前文档**再判一次：并发的另一个 add 可能刚刚把表填满。这是 append
        // 之后才可能发生的失败，所以要**先把这条意图收尾**再抛（见方法文档）——
        // 否则日志里会留下一条每次重放都抛错的 `add`，拖停整轮回放。
        if (accounts.length >= MAX_ACCOUNTS) {
          await this.#settleQuietly(intent);
          throw tooManyAccounts();
        }
        return {
          ops: [
            {
              op: "set",
              path: [ACCOUNTS_FIELD],
              value: [...accounts, { [ID_FIELD]: ref, [LABEL_FIELD]: label, [REF_FIELD]: ref }],
            },
          ],
          result: true,
        };
      });
      if (applied && key !== undefined) await this.#deps.credentials.set(ref, key);
      return current;
    });
    const info = await this.#deps.credentials.describe([ref]);
    return { ref, label, configured: info[ref]?.configured === true, active: activeRefOf(document) === ref };
  }

  /**
   * 只改展示名称。**绝不**重新推导 ref：ref 是账号的身份键，也是凭据槽名，重推会让顺序、
   * 规则、当前账号标记与凭据全部脱钩。
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
   * 换密钥：只写凭据服务，设置文档一个字都不动（Global Constraints：文档里只允许出现
   * 凭据引用名）。与其它操作一样先写意图，凭据写入成功后才收尾。
   * @param ref - 目标账号的 ref。
   * @param key - 新密钥（空值/纯空白直接拒绝）。
   */
  async replaceKey(ref: string, key: string): Promise<void> {
    const next = requireKey(key);
    await this.#require(ref);
    await this.#transaction("replace-key", { ref }, async () => {
      await this.#deps.credentials.set(ref, next);
    });
  }

  /**
   * 移除账号：条目、必要时当前账号标记，并把 ref 记进 `credentialCleanupRefs`。**真正删凭据
   * 不在本操作内**：只记录，等清理动作确认该 ref 不再被引用后再 `credentials.unset`。
   *
   * 当前账号的回落顺序按旧插件第 8178-8180 行：摘掉条目后，若当前账号就是被删的那个，
   * 回落到**剩余列表的第一个**；删空了才回到默认引用名。
   *
   * 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
   * @param ref - 目标账号的 ref。
   */
  async remove(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
    if (!hasAccount(snapshot.value, ref)) return;
    await this.#transaction("remove", { ref }, () =>
      this.#mutate((value) => {
        const accounts = rawAccounts(value).filter((item) => refOf(item) !== ref);
        const ops: SettingsOp[] = [
          { op: "set", path: [ACCOUNTS_FIELD], value: accounts },
          { op: "set", path: [CLEANUP_FIELD], value: [...rawCleanupRefs(value).filter((item) => item !== ref), ref] },
        ];
        if (activeRefOf(value) === ref) {
          const next = accounts.map((item) => refOf(item)).find((candidate) => candidate !== undefined);
          ops.push({ op: "set", path: [ACTIVE_FIELD], value: next ?? OPENCODE_DEFAULT_REF });
        }
        return { ops, result: undefined };
      }),
    );
  }

  /**
   * 固定账号或回到自动轮换。
   *
   * 可选的目标包含**合成的默认槽**（{@link OPENCODE_DEFAULT_REF} 或顶层 `apiKeyEnv`，即使它
   * 不在 `accounts[]` 里）：`list()` 会把它列成第一行，页面拿这一行的 ref 回来固定时必须成立。
   * 写回的就是这个 ref 本身（opencode 的当前账号字段就是那一个 ref，没有槽 id 空间）。
   * @param ref - 目标账号的 ref；`null` 表示自动轮换（写回默认引用名，旧插件第 6784-6786 行）。
   */
  async select(ref: string | null): Promise<void> {
    if (ref !== null) {
      const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
      if (!hasAccount(snapshot.value, ref) && ref !== opencodeAccountSlot(snapshot.value).ref) throw unknownRef(ref);
    }
    await this.#transaction("select", ref === null ? {} : { ref }, () =>
      this.#mutate(() => ({
        ops: [{ op: "set", path: [ACTIVE_FIELD], value: ref ?? OPENCODE_DEFAULT_REF }],
        result: undefined,
      })),
    );
  }

  /**
   * 调整账号顺序。opencode 的能力清单里 `reorder` 为真（设计 §7.3），所以本适配器**实现**
   * 它：用 Task 4 的 `reorder` 算出新顺序，落到 `accounts` 数组。
   *
   * 同时把顶层 `apiKeyEnv` 指向移动后的队首（旧插件第 8451-8453 行的同一后果）：旧插件读
   * 当前账号时会把「不在账号表里的引用名」回落到列表第一个（第 7512-7515 行的
   * `[preferred, ...accounts]`），所以「列表首项 = 当前账号」本来就是它的有效语义；这里把它
   * 显式写出来，避免排序后当前账号与列表首项不一致。
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
        // 曾经这里只要顺序没变就整体返回空 ops —— 于是「数组里只有一个备用账号」时
        // （顺序自然是恒等），把队首写成它的那一步也被跳过，晋升静默失效：
        // 文档仍旧指着旧当前账号，下一轮请求又重新选回旧账号。
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
   * 写自动切换开关（旧插件 `auto-switch` 命令落到 `autoSwitch` 字段，第 8407-8409 行）。
   * @param value - 开关值。
   */
  async setAutoSwitch(value: boolean): Promise<void> {
    await this.#transaction("auto-switch", { value }, () =>
      this.#mutate(() => ({
        ops: [{ op: "set", path: ["autoSwitch"], value }],
        result: undefined,
      })),
    );
  }

  /**
   * 一次完整事务：先 `append` 意图，再交给 `submit`（通常是设置变更），全部成功后才
   * `settle`。顺序不能颠倒：崩溃时留下的未决意图正是重放的依据。
   * @param kind - 意图类型。
   * @param fields - 意图携带的 ref/label/toIndex/value。
   * @param submit - 真正的提交动作；收到这条意图，便于在「已经 append、才发现不该提交」
   *   的路径上先把它收尾再抛（见 `#settleQuietly`）。
   * @returns `submit` 的结果。
   */
  async #transaction<T>(
    kind: AccountIntentKind,
    fields: { ref?: string; label?: string; toIndex?: number; value?: boolean },
    submit: (intent: AccountIntent) => Promise<T>,
  ): Promise<T> {
    const intent = this.#intent(kind, fields);
    await this.#deps.intents.append(intent);
    const result = await submit(intent);
    await this.#deps.intents.settle(intent.id);
    return result;
  }

  /**
   * 把一条**已经 append 但决定不提交**的意图收尾掉。
   *
   * 用途只有一处：`add` 的并发上限复核（另一次 `add` 抢先把账号表填满）。那条意图永远
   * 重放不成功 —— 重放时账号表仍然是满的，`apply` 只会再抛一次同样的错；而
   * `IntentLog.replay` 不吞 `apply` 的错误，一条这样的意图会拖停整轮回放（Task 8 的
   * 文档化边界），直到某个账号被删掉为止。所以收尾必须发生在抛出之前。
   *
   * 收尾本身写失败不抛出：那条意图会留在日志里（与「凭据写失败」同一类未决状态），
   * 但调用方拿到的仍是这次拒绝的真实原因（满表），而不是一个收尾失败。
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
   * 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新
   * 文档重算 ops 后再提交。冲突时**不**覆盖对方的写入。
   *
   * `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add`
   * 发现冻结的 ref 已经存在、`move` 发现位置没变都是这种情况）：直接返回，**不落盘**。
   * 这样「幂等的提交」不必伪造一次空写，也不会白白推进修订号去作废别人的写入。
   *
   * `build` 允许是 async 的：`add` 的并发上限复核要在「已经读到满表」时先 `settle` 掉
   * 那条意图再抛（见 `#settleQuietly`）。`build` 抛出的错误原样冒泡，且**不计**冲突重试
   * （它不是修订号冲突）。
   * @param build - 由最新文档算出 ops 与调用方要的结果。
   * @returns 调用方的结果与提交后的文档。
   */
  async #mutate<T>(
    build: (
      value: Readonly<Record<string, unknown>>,
    ) => { ops: readonly SettingsOp[]; result: T } | Promise<{ ops: readonly SettingsOp[]; result: T }>,
  ): Promise<{ result: T; value: Readonly<Record<string, unknown>> }> {
    for (let attempt = 0; ; attempt += 1) {
      const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
      const { ops, result } = await build(snapshot.value);
      if (ops.length === 0) return { result, value: snapshot.value };
      try {
        const committed = await this.#deps.settings.mutate(OPENCODE_SETTINGS_NS, ops, snapshot.revision);
        return { result, value: committed.value };
      } catch (error) {
        if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
        // 修订号过期：下一轮重读并用新修订号重放本次操作（ops 会按新文档重算）。
      }
    }
  }

  /** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
  async #require(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(OPENCODE_SETTINGS_NS);
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
 * 造一个 opencode 账号端口（真源在设置文档，密钥走凭据服务）。
 * @param deps - 设置、凭据与意图日志三个端口。
 * @returns 账号端口；七条命令全部实现（含 `move` 与 `setAutoSwitch`）。
 */
export function createOpencodeAccounts(deps: OpencodeAccountDeps): AccountPort {
  return new OpencodeAccounts(deps);
}
