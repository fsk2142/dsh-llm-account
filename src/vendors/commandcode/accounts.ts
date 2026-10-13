/**
 * Command Code 账号端口：真源在设置文档（命名空间 `llm-commandcode`），每个操作
 * **先写意图日志、再提交设置变更、提交成功后 `settle`**（设计 §6.4.5、§7.1；
 * 与 Task 13 同语义，Review Focus 5）。
 *
 * 形状逐条对照旧插件 `@mars-sea/dsh-commandcode-provider/lib/index.js`：
 * - 文档字段 `accounts`（条目 `{ label, apiKeyEnv }`）/ `activeAccount` /
 *   `modelAccountRules` / `credentialCleanupRefs`（Config schema 第 10059-10080 行）；
 * - `remove` 的顺序（`cleanup` 第 9221-9234 行）：移除条目 → 丢掉挂在该 ref 上的
 *   整条模型规则 → 若是当前固定账号则清成自动轮换 → 把 ref 记进 `credentialCleanupRefs`；
 * - `activeAccount` 的自动轮换取值用旧插件导出的 `ACTIVE_ACCOUNT_AUTO`（第 9523 行），
 *   空串也读作自动轮换（第 10153-10155 行 `preferredId`）。
 *
 * **标识空间**：账号身份一律是**凭据引用名 ref**（`accountRef()` 的产物或用户手写的
 * 引用名），存在条目的 `apiKeyEnv` 字段里 —— 沿用旧插件的字段名才能让两个命名空间里的
 * 真实账号零迁移（设计 §5.1）。`label` 只用于展示，改名**绝不**重新推导 ref。
 *
 * **写回纪律**：改条目时按字段覆盖（改 `label`、保留其它字段），改数组时只摘除目标条目，
 * 所以**存量文档里的其它字段与其它条目都原样保留**。本模块从不写入明文密钥：新条目只有
 * `{ label, apiKeyEnv }`，`key` 一律走凭据服务。旧插件的条目允许内联 `apiKey` 字面量
 * （Config schema 第 10062-10063 行），存量文档里如果有，本模块**不主动删**（删掉会让那个
 * 账号静默失去密钥）—— 是否把它迁进凭据服务属于迁移决策，见任务报告。
 *
 * **修订号冲突**（Review Focus 5）：`mutate` 抛 `SETTINGS_CONFLICT` 时**重读 → 用新修订号
 * 重放本次操作**，不覆盖对方的写入；`build` 每轮都拿刚读到的文档重算 ops，所以重放的
 * 是「用户的操作」而不是过期的 ops。
 *
 * **意图与身份**：`add` 在 `append` **之前**解析出 ref 并写进意图（`{ kind: "add", ref, label }`），
 * 提交用的就是同一个 ref —— 重放因此按 ref 对齐，不必按 label 猜（同名标签合法）。提交还会按
 * **最新文档**再判一次身份（ref 已在账号表里就不再追加条目、不再写凭据槽），所以并发的同标签
 * `add` 不会造出两个同 ref 的条目。所有不改状态就可能失败的校验都跑在 `append` 之前，日志里
 * 不会留下永远应用不了的意图。
 *
 * 本任务**不**做：网页登录（Task 11）、客户端页面（计划 1b）、套餐过滤与费用估算（第 2 期）。
 * @module dsh-llm-account/src/vendors/commandcode/accounts
 */
import { randomUUID } from "node:crypto";

import type {
  AccountPort,
  AccountView,
  CredentialPort,
  SettingsOp,
  SettingsPort,
  VendorId,
} from "../../core/adapter";
import { accountRef, dedupeByRef } from "../../core/accounts";
import { normalizeKey } from "../../core/credentials";
import type { AccountIntent, AccountIntentKind, IntentLog } from "../../core/recovery";

/** 设置命名空间（全局约束，不得更改）。 */
export const COMMAND_CODE_SETTINGS_NS = "llm-commandcode";

/** 本端口所属的 provider 路由（ref 生成用的厂商段）。 */
const VENDOR: VendorId = "commandcode";

/**
 * `activeAccount` 的「自动轮换」取值（旧插件 `ACTIVE_ACCOUNT_AUTO` 第 9523 行；它自己的
 * 界面把这个值渲染成「自动」，并且也把空串读作自动）。写它而不是空串，是为了让值是
 * 自解释的字符串：消费方必须把 `"auto"` 与空串一视同仁。
 */
export const ACTIVE_ACCOUNT_AUTO = "auto";

/** 账号条目的凭据引用字段（旧插件 Config schema 第 10059-10064 行）。 */
const REF_FIELD = "apiKeyEnv";

/** 账号条目的展示名称字段。 */
const LABEL_FIELD = "label";

/** 账号条目数组字段。 */
const ACCOUNTS_FIELD = "accounts";

/** 按模型绑定账号的规则数组字段。 */
const RULES_FIELD = "modelAccountRules";

/** 一条模型规则指向账号的字段（`ModelRule.account`）。 */
const RULE_ACCOUNT_FIELD = "account";

/** 当前固定账号字段。 */
const ACTIVE_FIELD = "activeAccount";

/** 待清理凭据引用数组字段。 */
const CLEANUP_FIELD = "credentialCleanupRefs";

/** 合法凭据引用名（Global Constraints）。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** ref 撞名时的后缀尝试上限（旧插件开通过程第 9108 行的同一条 128 次上限）。 */
const MAX_REF_ATTEMPTS = 128;

/**
 * 修订号冲突后的重放轮数上限。冲突是并发写的正常结果，重读即可推进；给上限是为了
 * 不在持续争用下无限循环，耗尽后把最后一次冲突错误抛给调用方。
 */
const MAX_CONFLICT_RETRIES = 8;

/** 账号端口的依赖（三个端口都由 Task 14 装配时注入，本模块不认识 `ctx`）。 */
export interface CommandCodeAccountDeps {
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

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 文档里的账号数组（形状不可信，非数组一律当空）。 */
function rawAccounts(value: Readonly<Record<string, unknown>>): readonly unknown[] {
  const accounts = value[ACCOUNTS_FIELD];
  return Array.isArray(accounts) ? accounts : [];
}

/** 文档里的规则数组（写回时原样保留非规则条目，只按 ref 摘除）。 */
function rawRules(value: Readonly<Record<string, unknown>>): readonly unknown[] {
  const rules = value[RULES_FIELD];
  return Array.isArray(rules) ? rules : [];
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
  return ref !== undefined && REF_PATTERN.test(ref) ? ref : undefined;
}

/** 读一个账号条目的展示名称。 */
function labelOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return normalizeKey(item[LABEL_FIELD]);
}

/** 读一条模型规则挂在哪个账号上。 */
function ruleAccountOf(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  return normalizeKey(item[RULE_ACCOUNT_FIELD]);
}

/** 文档里是否已有这个账号条目。 */
function hasAccount(value: Readonly<Record<string, unknown>>, ref: string): boolean {
  return rawAccounts(value).some((item) => refOf(item) === ref);
}

/**
 * 读当前固定账号；`undefined` 表示自动轮换（字段缺失、空串与 {@link ACTIVE_ACCOUNT_AUTO}
 * 都算自动 —— 旧插件 `preferredId` 第 10153-10155 行就是这么读的）。
 */
function activeRefOf(value: Readonly<Record<string, unknown>>): string | undefined {
  const active = normalizeKey(value[ACTIVE_FIELD]);
  return active === undefined || active === ACTIVE_ACCOUNT_AUTO ? undefined : active;
}

/** 标签必须是可展示的非空文本（空标签会渲染成一行没有名字的账号）。 */
function requireLabel(label: string): string {
  const next = normalizeKey(label);
  if (next === undefined) throw new Error("llm-commandcode: account label must not be blank");
  return next;
}

/** 密钥必须是可用的非空文本（空值/纯空白永远不该写进凭据服务）。 */
function requireKey(key: string): string {
  const next = normalizeKey(key);
  if (next === undefined) throw new Error("llm-commandcode: API key must not be blank");
  return next;
}

/** 修订号过期（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error: unknown): boolean {
  return isRecord(error) && error.code === "SETTINGS_CONFLICT";
}

/** 未知账号 ref（改名/换 key/固定时用）。 */
function unknownRef(ref: string): Error {
  return new Error(`llm-commandcode: unknown account ref "${ref}"`);
}

/**
 * 给新账号挑一个未被占用的 ref：先是 `accountRef()` 的产物，撞名时按旧插件的办法加
 * 数字后缀（`_2`、`_3`…）。
 *
 * 占用集合 = 现有账号条目的 ref ∪ 待清理的 ref ∪ 顶层默认凭据引用（旧插件开通过程
 * 第 9099-9105 行的同一集合）。这条护栏是 Review Focus 1 的机器化保证：两个账号
 * 永远不会共用同一个凭据槽，否则它们会互相污染失效标记与额度。
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

  const first = accountRef(VENDOR, label);
  if (!occupied.has(first)) return first;
  for (let suffix = 2; suffix <= MAX_REF_ATTEMPTS; suffix += 1) {
    const candidate = `${first}_${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`llm-commandcode: no free credential reference for label "${label}"`);
}

/** Command Code 的账号端口（设置变更实现）。 */
class CommandCodeAccounts implements AccountPort {
  readonly #deps: CommandCodeAccountDeps;

  /**
   * @param deps - 设置、凭据与意图日志三个端口。
   */
  constructor(deps: CommandCodeAccountDeps) {
    this.#deps = deps;
  }

  /** @returns 账号行视图：身份取自 `apiKeyEnv`，`configured` 来自凭据服务。 */
  async list(): Promise<AccountView[]> {
    const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
    const active = activeRefOf(snapshot.value);
    const views = rawAccounts(snapshot.value)
      .map((item) => ({ ref: refOf(item), label: labelOf(item) }))
      .filter((item): item is { ref: string; label: string } => item.ref !== undefined)
      .map((item) => ({ ref: item.ref, label: item.label ?? item.ref, configured: false, active: item.ref === active }));
    // 重复 ref 只保留第一个：同一个凭据槽不该在轮换里被算两轮（Review Focus 1）。
    const unique = dedupeByRef(views);
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
   * `accountRef` 的确定性而冻结到同一个 ref：没有这道闸门，两次调用会把同一个凭据槽写
   * 两遍（`list()` 的 `dedupeByRef` 只会把重复行藏起来，文档里仍然留着两条）。
   *
   * 所有**不改状态就可能失败**的校验（标签、密钥、没有空闲 ref）都跑在 `append` 之前，
   * 因此日志里不会留下一条永远应用不了的意图。真正写失败（凭据服务写失败、设置冲突重试
   * 用尽）才留下未决意图：重放能确认账号条目已经落地，但**补不回密钥** —— 那条账号会保持
   * `configured: false`，直到用户重新提供密钥（`replaceKey`）。带 `key` 时先提交账号条目、
   * 再写凭据服务（旧插件 `run()` → `store()` 的次序）。
   * @param input - 展示名称与可选密钥。
   * @returns 新账号的视图。
   */
  async add(input: { label: string; key?: string }): Promise<AccountView> {
    const label = requireLabel(input.label);
    const key = input.key === undefined ? undefined : requireKey(input.key);
    // 解析 ref 需要当前文档；没有空闲 ref 时在这里就抛，不写意图（fail 在 append 之前）。
    const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
    const ref = freeRef(snapshot.value, label);
    const document = await this.#transaction("add", { ref, label }, async () => {
      const { result: applied, value: current } = await this.#mutate<boolean>((value) => {
        // 最新文档里已经有这个 ref：这次 add 已经落地（自己的重试，或并发的同标签 add
        // 冻结到同一个确定性 ref）→ 空 ops 表示不落盘（见 `#mutate`），也不再写凭据槽。
        if (hasAccount(value, ref)) return { ops: [], result: false };
        return {
          ops: [
            {
              op: "set",
              path: [ACCOUNTS_FIELD],
              value: [...rawAccounts(value), { [LABEL_FIELD]: label, [REF_FIELD]: ref }],
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
   * 规则、固定标记与凭据全部脱钩。
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
   * 移除账号：条目、挂在该 ref 上的整条模型规则、必要时当前固定账号标记，并把 ref 记进
   * `credentialCleanupRefs`。**真正删凭据不在本操作内**：只记录，等清理动作确认该 ref 不再
   * 被引用后再 `credentials.unset`（旧插件 `cleanup` 第 9235-9242 行就是这个次序）。
   *
   * 幂等：ref 已不在账号表里时什么都不写（重放一次已提交的移除不会产生多余写入）。
   * @param ref - 目标账号的 ref。
   */
  async remove(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
    if (!hasAccount(snapshot.value, ref)) return;
    await this.#transaction("remove", { ref }, () =>
      this.#mutate((value) => {
        const ops: SettingsOp[] = [
          { op: "set", path: [ACCOUNTS_FIELD], value: rawAccounts(value).filter((item) => refOf(item) !== ref) },
          { op: "set", path: [RULES_FIELD], value: rawRules(value).filter((item) => ruleAccountOf(item) !== ref) },
          { op: "set", path: [CLEANUP_FIELD], value: [...rawCleanupRefs(value).filter((item) => item !== ref), ref] },
        ];
        if (activeRefOf(value) === ref) ops.push({ op: "set", path: [ACTIVE_FIELD], value: ACTIVE_ACCOUNT_AUTO });
        return { ops, result: undefined };
      }),
    );
  }

  /**
   * 固定账号或回到自动轮换。
   * @param ref - 目标账号的 ref；`null` 表示自动轮换。
   */
  async select(ref: string | null): Promise<void> {
    if (ref !== null) await this.#require(ref);
    await this.#transaction("select", ref === null ? {} : { ref }, () =>
      this.#mutate(() => ({
        ops: [{ op: "set", path: [ACTIVE_FIELD], value: ref ?? ACTIVE_ACCOUNT_AUTO }],
        result: undefined,
      })),
    );
  }

  // 刻意不实现 `move`：Command Code 不支持排序（设计 §7.3 `reorder: false`），能力声明
  // 关掉它，UI 因此隐藏排序控件（`AccountPort.move` 是可选成员）。
  // `setAutoSwitch` 同样不实现：Command Code 的文档里没有这个开关，自动切换是轮换引擎的
  // 行为而不是账号库的字段（第 2 期若需要开关再补）。

  /**
   * 一次完整事务：先 `append` 意图，再交给 `submit`（通常是设置变更），全部成功后才
   * `settle`。顺序不能颠倒：崩溃时留下的未决意图正是重放的依据。
   * @param kind - 意图类型。
   * @param fields - 意图携带的 ref/label。
   * @param submit - 真正的提交动作。
   * @returns `submit` 的结果。
   */
  async #transaction<T>(
    kind: AccountIntentKind,
    fields: { ref?: string; label?: string },
    submit: (intent: AccountIntent) => Promise<T>,
  ): Promise<T> {
    const intent = this.#intent(kind, fields);
    await this.#deps.intents.append(intent);
    const result = await submit(intent);
    await this.#deps.intents.settle(intent.id);
    return result;
  }

  /**
   * 提交一次设置变更，带修订号冲突重放：每轮都重新 `describe` 拿最新修订号，并用最新
   * 文档重算 ops 后再提交。冲突时**不**覆盖对方的写入。
   *
   * `build` 针对**刚读到的**文档返回空 ops，表示这次操作在这个文档上已经成立（`add`
   * 发现冻结的 ref 已经存在就是这种情况）：直接返回，**不落盘**。这样「幂等的提交」不必
   * 伪造一次空写，也不会白白推进修订号去作废别人的写入。
   * @param build - 由最新文档算出 ops 与调用方要的结果。
   * @returns 调用方的结果与提交后的文档。
   */
  async #mutate<T>(
    build: (value: Readonly<Record<string, unknown>>) => { ops: readonly SettingsOp[]; result: T },
  ): Promise<{ result: T; value: Readonly<Record<string, unknown>> }> {
    for (let attempt = 0; ; attempt += 1) {
      const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
      const { ops, result } = build(snapshot.value);
      if (ops.length === 0) return { result, value: snapshot.value };
      try {
        const committed = await this.#deps.settings.mutate(COMMAND_CODE_SETTINGS_NS, ops, snapshot.revision);
        return { result, value: committed.value };
      } catch (error) {
        if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
        // 修订号过期：下一轮重读并用新修订号重放本次操作（ops 会按新文档重算）。
      }
    }
  }

  /** 确认账号存在；未知 ref 不该留下一条永远重放不了的意图。 */
  async #require(ref: string): Promise<void> {
    const snapshot = await this.#deps.settings.describe(COMMAND_CODE_SETTINGS_NS);
    if (!hasAccount(snapshot.value, ref)) throw unknownRef(ref);
  }

  /** 造一条带唯一 id 的意图（`createdAt` 仅供展示，不参与排序）。 */
  #intent(kind: AccountIntentKind, fields: { ref?: string; label?: string }): AccountIntent {
    return {
      id: randomUUID(),
      kind,
      createdAt: Date.now(),
      ...(fields.ref === undefined ? {} : { ref: fields.ref }),
      ...(fields.label === undefined ? {} : { label: fields.label }),
    };
  }
}

/**
 * 造一个 Command Code 账号端口（真源在设置文档，密钥走凭据服务）。
 * @param deps - 设置、凭据与意图日志三个端口。
 * @returns 账号端口；`move` 不提供（能力声明关闭）。
 */
export function createCommandCodeAccounts(deps: CommandCodeAccountDeps): AccountPort {
  return new CommandCodeAccounts(deps);
}
