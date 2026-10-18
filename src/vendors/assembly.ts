/**
 * 装配层的公共件：把宿主接缝（设置文档、凭据服务、启动环境、事件）收敛成 `core` 的端口，
 * 并提供两个入口共用的 volatile 配置解包与「一份存储一个意图日志」的登记表。
 *
 * 两个厂商入口（`commandcode/index.ts`、`opencode/index.ts`）只声明自己的 `Config` 与
 * 适配器接线；**宿主接缝的读法只有这一份**——两处各写一份迟早会走偏（与
 * `core/accounts.ts` 模块头同一条理由）。
 *
 * 本模块不缓存服务实例：每一次读都重新 `ctx.get(name)`。宿主服务的可用性与本插件的挂载
 * 时机无关（凭据服务可能晚到），缓存 `undefined` 会让「晚到的服务」永远读不到。
 * @module dsh-llm-account/src/vendors/assembly
 */
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import type { SettingsDescriptor, SettingsForms } from "@deepseek-ai/dsh-settings";

import type { AccountState, CredentialPort, SettingsOp, SettingsPort, SettingsSnapshot } from "../core/adapter";
import type { SwitchSettingsWrite } from "../core/switching";
import { normalizeKey } from "../core/credentials";
import { IntentLog } from "../core/recovery";
import type { AccountIntent, AccountIntentKind, IntentStore } from "../core/recovery";
import { RotationEngine } from "../core/rotation";

/**
 * 一次设置写入的修订号冲突重试上限。冲突是并发写的正常结果（重读即可推进），给上限只是
 * 为了不在持续争用下无限循环；与两个账号端口的同一上限。
 */
const MAX_CONFLICT_RETRIES = 8;

/** 意图日志里合法的操作分类（存储形状不可信，读的时候逐条收窄）。 */
const INTENT_KINDS = [
  "add",
  "remove",
  "rename",
  "replace-key",
  "select",
  "move",
  "auto-switch",
] as const satisfies readonly AccountIntentKind[];

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** volatile 引用的最小形状：`createVolatile` 的产物是**冻结对象**加一个 `get`。 */
interface VolatileRef {
  get(): unknown;
}

/**
 * 判定一个值是不是 volatile 引用。
 *
 * 鸭子类型判定（冻结 + `get`）而不是认 cosmokit 的私有符号：本项目不依赖 cosmokit，而配置
 * 里普通解析值不会是冻结对象，所以这个判定不会误伤普通字段。
 * @param value - 待判定的配置字段值。
 * @returns 是否为 volatile 引用。
 */
export function isVolatileRef(value: unknown): value is VolatileRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.isFrozen(value) && typeof Reflect.get(value, "get") === "function";
}

/**
 * 把一份已解析的 Config 读成普通值：volatile 字段**每次**经 `.get()` 现取（引用的身份稳定、
 * 值会变，这正是「改完立即生效」的机制），非引用字段原样透传。
 * @param config - 已解析的 Config（宿主交给 `apply` 的那一份）。
 * @returns 每个字段的当前值。
 */
export function unwrapVolatileConfig(config: Record<string, unknown>): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(config)) plain[field] = isVolatileRef(value) ? value.get() : value;
  return plain;
}

/**
 * 宿主是否已经把这份 config 解析过（volatile 引用就是解析产物）。
 *
 * 程序化构造的配置（例如装配测试，或将来 1b 的远程页）是普通值，必须自己过一遍 `Config`；
 * 把已经解析好的配置再解析一次会把 volatile 引用当成普通值，反而丢掉活引用。
 * @param value - `apply` 收到的原始 config。
 * @returns 是否已经是解析产物。
 */
export function isParsedConfig(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).some((field) => isVolatileRef(field));
}

/**
 * 插件 `Config` 的导出类型：宿主加载器对它的**最小**要求。
 *
 * 两个理由不写 schemastery 的推断类型：① schemastery 只默认导出一个值，节点类型没有可命名
 * 的出口；② 推断类型会展开出 cosmokit 的 `Dict`，dts 生成器无法为它写出可移植的引用
 * （TS2883：`.pnpm` 里的传递依赖不能出现在声明文件里）。这里只声明加载器真正用到的两件事：
 * 可调用（解析这一行的配置）与可序列化（`"toJSON" in schema` 的判定，见 dsh-settings 的
 * `SettingsForms.schema()`）；volatile 记号与节点树由运行时的真 schema 对象提供。
 */
export interface PluginConfigSchema {
  /** 解析一份配置（原始缺省时用 schema 默认值）。 */
  (data?: Record<string, unknown>): unknown;
  /** 序列化 schema（宿主的设置表单据此投影 volatile 节点）。 */
  toJSON(): unknown;
}

/**
 * 把一个 Config 字段标成 volatile。
 *
 * `.volatile()` 返回的是**标好记号的副本**（schemastery 的链式方法都返回新节点），所以必须
 * 用返回值。类型上做一次断言：记号改变的是「解析成什么」（活引用），不是字段对插件暴露的
 * 类型 —— 入口一律按 `Record<string, unknown>` 读配置，不依赖这个类型。
 * @param schema - 字段节点。
 * @returns 标好 volatile 的同一字段。
 */
export function markVolatile<T extends { volatile(): unknown }>(schema: T): T {
  return schema.volatile() as T;
}

/**
 * 把一份 Config 字段表里的字段逐个标成 volatile，`skip` 里的组合期秘密字段除外。
 *
 * 宿主设置表单只投影 volatile 节点，且 `settings.mutate` 拒绝写非 volatile 路径；所以
 * **账号文档用到的每个字段都必须在 `skip` 之外**，否则账号端口会读不到、写不动。
 * @param fields - 字段表。
 * @param skip - 不标 volatile 的字段名（例如只在组合文件里出现的 `apiKey` 字面量）。
 * @returns 标好的字段表。
 */
export function markVolatileFields<F extends Record<string, unknown>>(fields: F, skip: readonly string[] = []): F {
  const marked: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(fields)) {
    marked[field] = skip.includes(field) ? schema : markVolatile(schema as { volatile(): unknown });
  }
  return marked as F;
}

/**
 * 轮换引擎的读取口。
 *
 * 适配器与额度端口都按请求现取引擎，所以账号库状态（顺序/固定/规则）一变就换一台新引擎，
 * 并把**仍然生效的拒绝记录**以及**观测状态（生效账号与切换记录）**搬到新引擎上：换引擎不能
 * 把「这个账号刚被拒绝」或「刚才是谁在服务」弄丢。
 */
export interface RotationAccess {
  /** 当前账号库状态对应的引擎（状态变了就顺带重建）。 */
  current(): RotationEngine;
  /**
   * 凭据更新后清除该账号的 `invalid-credential` 标记。
   * @param ref - 换了密钥的账号 ref。
   */
  clearCredentialRejection(ref: string): void;
}

/** 账号库状态的比较键：顺序、固定账号与规则任一变化都要重建引擎。 */
function stateKey(state: AccountState): string {
  return JSON.stringify([state.order, state.pinned, state.rules]);
}

/**
 * 造一个轮换引擎读取口。
 *
 * 为什么重建而不是「让引擎跟随」：引擎构造时复制状态（Task 5 的文档化决定），跟随会让
 * 「顺序 = 账号列表」这条装配要求失效。搬迁拒绝记录时冷却窗口会从搬迁时刻重算（引擎不暴露
 * 绝对失效时刻），只在用户改账号的瞬间发生一次，代价可接受。
 * @param state - 现读账号库状态（顺序 = 账号列表，固定 = 当前账号，规则 = 按模型绑定）。
 * @returns 读取口。
 */
export function createRotationAccess(state: () => AccountState): RotationAccess {
  let engine = new RotationEngine(state());
  let key = stateKey(state());
  const current = (): RotationEngine => {
    const next = state();
    const nextKey = stateKey(next);
    if (nextKey === key) return engine;
    const replacement = new RotationEngine(next);
    for (const [ref, rejection] of engine.rejections()) replacement.markRejected(ref, rejection);
    // Ruling 16（Task 2 复核）：**观测状态也要搬**。只搬拒绝记录的话，用户一改账号设置
    // （顺序/固定/规则）就会丢掉「生效账号」与切换记录 —— 卡片随即显示「没有生效账号」，
    // 正是规格 §8.1 要修掉的那类缺陷。
    replacement.adoptObservations(engine);
    engine = replacement;
    key = nextKey;
    return engine;
  };
  return {
    current,
    clearCredentialRejection(ref: string): void {
      current().clearCredentialRejection(ref);
    },
  };
}

/** 设置行的候选名字（按优先级）：现代宿主按 profile 行 id 建索引，旧宿主用插件自报的命名空间。 */
export type SettingsRowIds = readonly string[];

/**
 * 关掉宿主为**这一行**自动生成的设置表单（`configure({ auto: false })`）。
 *
 * 为什么必须做：本包自带统一设置页（`settings.section`，id `llm-account`）。宿主默认会按
 * schemastery 配置自动生成一份表单，不关掉就会和我们的页面**并排出现**。旧 Command Code 插件
 * 用的正是这一条（`@mars-sea/dsh-commandcode-provider/lib/index.js:10982`：
 * `settingsCtx.settings.configure({ auto: false }, ctx.fiber)`）。
 *
 * 两个未验证接缝都收在这里：`ctx.fiber` **没有**出现在 cordis 4.0.4 的 `Context` 类型里
 * （运行时存在：`lib/index.js:1684`），所以只有一个窄化的结构读取；`configure` 的第二个参数
 * 就是 owner fiber。
 *
 * 幂等：宿主对「这一行已经登记过策略」会抛错，而那种情况下的目标状态（自动表单已关）本来
 * 就已经达成 —— 所以不把它变成整行的失败，只在日志里留一行。
 * @param ctx - 该 profile 行的插件上下文。
 * @param namespace - 该行的设置命名空间（只用于日志文案）。
 */
export function disableSettingsAutoForm(ctx: Context, namespace: string): void {
  const service: unknown = ctx.get("settings");
  if (!isRecord(service) || typeof service.configure !== "function") {
    // 宿主没有这条策略接口：自动表单可能仍会出现，必须留痕而不是静默跳过。
    ctx.logger.warn(
      `dsh-llm-account: the settings service has no configure(); the generated settings form for "${namespace}" cannot be disabled and may appear beside the unified page`,
    );
    return;
  }
  const configure = service.configure as (presentation: { auto?: boolean }, owner?: unknown) => unknown;
  const fiber = (ctx as unknown as { fiber?: unknown }).fiber;
  ctx.effect(
    () => {
      try {
        const dispose = configure.call(service, { auto: false }, fiber);
        return typeof dispose === "function" ? (dispose as () => void) : () => undefined;
      } catch (error) {
        ctx.logger.warn(
          `dsh-llm-account: could not disable the generated settings form for "${namespace}" (${error instanceof Error ? error.message : String(error)}); if a form still appears beside the unified page, this is why`,
        );
        return () => undefined;
      }
    },
    "dsh-llm-account: settings auto-form policy",
  );
}

/** 宿主设置服务的形状判定（只认本装配层用到的两个方法）。 */
function isSettingsForms(value: unknown): value is SettingsForms {
  return isRecord(value) && typeof value.describe === "function" && typeof value.mutate === "function";
}

/** 读宿主设置服务；服务缺席时抛错（调用方都处在「必须读写配置」的路径上）。 */
function requireSettingsForms(ctx: Context, namespace: string): SettingsForms {
  const service: unknown = ctx.get("settings");
  if (!isSettingsForms(service)) {
    throw new Error(
      `dsh-llm-account: the settings service is unavailable, so the "${namespace}" document cannot be read or written`,
    );
  }
  return service;
}

/**
 * 按候选名单找设置行。
 *
 * 现代宿主（0.2.x）的 `settings.describe()` 按 **profile 行 id** 建索引，而 `core` 里的设置
 * 命名空间是固定的（`llm-commandcode` / `llm-opencode-go`）。opencode 这两个名字**不相同**
 * （行 id 是 `opencode-go`），所以这里必须按候选名单解析：先找行 id，再回落到命名空间
 * （旧插件的 `accountSettingsRow` 就是同一顺序）。
 * @param forms - 宿主设置服务。
 * @param rowIds - 候选行名，按优先级排列。
 * @returns 命中的行。
 */
function requireSettingsRow(forms: SettingsForms, rowIds: SettingsRowIds): SettingsDescriptor {
  const rows = forms.describe();
  for (const id of rowIds) {
    const row = rows.find((candidate) => candidate.ns === id);
    if (row !== undefined) return row;
  }
  throw new Error(
    `dsh-llm-account: no profile row provides this settings document (tried ${rowIds.join(", ")})`,
  );
}

/**
 * 造一个绑定到单一设置命名空间的 `SettingsPort`。
 *
 * 端口契约要求 `mutate` 返回**提交后**的快照，而宿主 `settings.mutate` 只返回 `void`，所以
 * 提交后重新描述一次。写路径一律用**命中的行名**（不是 `core` 的命名空间），否则 opcode
 * 的写会落到一个不存在的行上。
 * @param ctx - 插件上下文（每次读都重新取设置服务）。
 * @param namespace - `core` 侧的固定命名空间；调用方传别的名字一律报错（接线错误要吵出来）。
 * @param rowIds - 候选行名，按优先级排列。
 * @returns 设置端口。
 */
export function createSettingsPort(ctx: Context, namespace: string, rowIds: SettingsRowIds): SettingsPort {
  const require = (requested: string): void => {
    if (requested !== namespace) {
      throw new Error(`dsh-llm-account: unexpected settings namespace "${requested}" (expected "${namespace}")`);
    }
  };
  const snapshotOf = (row: SettingsDescriptor): SettingsSnapshot => ({
    revision: row.revision,
    value: isRecord(row.value) ? row.value : {},
  });
  return {
    async describe(requested: string): Promise<SettingsSnapshot> {
      require(requested);
      return snapshotOf(requireSettingsRow(requireSettingsForms(ctx, namespace), rowIds));
    },
    async mutate(requested: string, ops: readonly SettingsOp[], revision: number): Promise<SettingsSnapshot> {
      require(requested);
      const forms = requireSettingsForms(ctx, namespace);
      await forms.mutate(requireSettingsRow(forms, rowIds).ns, ops, revision);
      return snapshotOf(requireSettingsRow(forms, rowIds));
    },
  };
}

/** 宿主凭据服务的形状判定（只认本装配层用到的四个方法）。 */
function isCredentialProvider(value: unknown): value is CredentialProvider {
  return (
    isRecord(value) &&
    typeof value.resolve === "function" &&
    typeof value.describe === "function" &&
    typeof value.set === "function" &&
    typeof value.unset === "function"
  );
}

/** 读宿主凭据服务；服务缺席返回 `undefined`（读取路径按「未配置」处理，写入路径报错）。 */
function credentialsProviderOf(ctx: Context): CredentialProvider | undefined {
  const service: unknown = ctx.get("credentials");
  return isCredentialProvider(service) ? service : undefined;
}

/**
 * 造一个凭据端口：把 `core` 的 `CredentialPort`（按字符串 ref 进出）接到宿主凭据服务上。
 *
 * 引用名先过 `isCredentialRefName`：文档里的非法引用名（例如旧插件的 `account-2` 内联槽）
 * 在宿主 `credentialRef()` 里会抛 `TypeError`，读路径必须把它读成「未配置」而不是把请求打成
 * 裸异常；写路径传非法名是调用方的 bug，照旧抛。
 * @param ctx - 插件上下文（每次调用都重新取凭据服务）。
 * @returns 凭据端口。
 */
export function createCredentialsPort(ctx: Context): CredentialPort {
  return {
    async resolve(ref: string): Promise<string | undefined> {
      const provider = credentialsProviderOf(ctx);
      if (provider === undefined || !isCredentialRefName(ref)) return undefined;
      const resolved = await provider.resolve(credentialRef(ref));
      return normalizeKey(resolved?.value);
    },
    async set(ref: string, value: string): Promise<void> {
      const provider = credentialsProviderOf(ctx);
      if (provider === undefined) {
        throw new Error(
          "dsh-llm-account: the credentials service is unavailable in this profile, so the key cannot be stored",
        );
      }
      await provider.set(credentialRef(ref), value);
    },
    async unset(ref: string): Promise<void> {
      const provider = credentialsProviderOf(ctx);
      if (provider === undefined || !isCredentialRefName(ref)) return;
      await provider.unset(credentialRef(ref));
    },
    async describe(refs: string[]): Promise<Record<string, { configured: boolean; writable?: boolean }>> {
      const provider = credentialsProviderOf(ctx);
      const entries = await Promise.all(
        refs.map(async (ref): Promise<[string, { configured: boolean; writable?: boolean }]> => {
          if (provider === undefined || !isCredentialRefName(ref)) return [ref, { configured: false }];
          const info = await provider.describe(credentialRef(ref));
          return [ref, { configured: info.configured === true, writable: info.writable === true }];
        }),
      );
      return Object.fromEntries(entries);
    },
  };
}

/** 读一条意图记录的合法分类。 */
function readIntentKind(value: unknown): AccountIntentKind | undefined {
  return typeof value === "string" ? INTENT_KINDS.find((kind) => kind === value) : undefined;
}

/**
 * 逐字段收窄一条意图记录。
 *
 * 存储形状不可信（设置文档可能被手改）：`id`/`kind`/`createdAt` 三个身份字段齐备才认，
 * 其余字段按类型收进，认不出的条目整条丢弃 —— 一次手改不该让插件起不来，也不该让一条
 * 形状不明的记录进回放。
 * @param value - 文档里的一个数组元素。
 * @returns 合法意图，或 `undefined`。
 */
function readIntent(value: unknown): AccountIntent | undefined {
  if (!isRecord(value)) return undefined;
  const id = normalizeKey(value.id);
  const kind = readIntentKind(value.kind);
  const createdAt = value.createdAt;
  if (id === undefined || kind === undefined || typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return undefined;
  }
  const ref = normalizeKey(value.ref);
  const label = normalizeKey(value.label);
  const toIndex = typeof value.toIndex === "number" && Number.isFinite(value.toIndex) ? value.toIndex : undefined;
  const flag = typeof value.value === "boolean" ? value.value : undefined;
  return {
    id,
    kind,
    createdAt,
    ...(ref === undefined ? {} : { ref }),
    ...(label === undefined ? {} : { label }),
    ...(toIndex === undefined ? {} : { toIndex }),
    ...(flag === undefined ? {} : { value: flag }),
  };
}

/** 修订号冲突（`SettingsPort.mutate` 的约定错误形状）。 */
function isSettingsConflict(error: unknown): boolean {
  return isRecord(error) && error.code === "SETTINGS_CONFLICT";
}

/**
 * 把全局切换设置写进一份设置文档（修订冲突时重读重试）。
 * @param settings - 设置端口。
 * @param ns - 目标命名空间。
 * @param input - 策略/间隔/回合末/自动切换。
 */
export async function writeSwitchSettings(settings: SettingsPort, ns: string, input: SwitchSettingsWrite): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const snapshot = await settings.describe(ns);
    try {
      await settings.mutate(
        ns,
        [
          { op: "set", path: ["switchStrategy"], value: input.strategy },
          { op: "set", path: ["switchIntervalMinutes"], value: input.intervalMinutes },
          { op: "set", path: ["switchAtTurnEnd"], value: input.atTurnEnd },
          { op: "set", path: ["autoSwitch"], value: input.autoSwitch },
        ],
        snapshot.revision,
      );
      return;
    } catch (error) {
      if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
    }
  }
}

/**
 * 把意图日志落到设置文档的一个隐藏字段上（一次读全量、一次写全量）。
 *
 * 写失败一律向外抛（静默失败会让崩溃恢复丢掉已提交的操作）；修订号冲突时重读并用新修订号
 * 重放这次落盘 —— op 是「整体覆盖这一个字段」的路径写，不碰文档里的其它字段。
 * @param settings - 设置端口（记载账号文档的那个命名空间）。
 * @param namespace - 设置命名空间。
 * @param field - 存放意图的字段名（入口自己的隐藏字段）。
 * @param warn - 丢弃形状不明的条目时的诊断出口。
 * @returns 意图存储端口。
 */
export function createSettingsIntentStore(
  settings: SettingsPort,
  namespace: string,
  field: string,
  warn?: (message: string) => void,
): IntentStore {
  return {
    async read(): Promise<AccountIntent[]> {
      const snapshot = await settings.describe(namespace);
      const raw = snapshot.value[field];
      if (!Array.isArray(raw)) return [];
      const intents: AccountIntent[] = [];
      for (const item of raw) {
        const intent = readIntent(item);
        if (intent === undefined) {
          warn?.(`dsh-llm-account: dropped a malformed "${field}" entry from namespace "${namespace}"`);
          continue;
        }
        intents.push(intent);
      }
      return intents;
    },
    async write(intents: AccountIntent[]): Promise<void> {
      const value = intents.map((intent) => ({ ...intent }));
      for (let attempt = 0; ; attempt += 1) {
        const snapshot = await settings.describe(namespace);
        try {
          await settings.mutate(namespace, [{ op: "set", path: [field], value }], snapshot.revision);
          return;
        } catch (error) {
          if (attempt >= MAX_CONFLICT_RETRIES || !isSettingsConflict(error)) throw error;
          // 修订号过期：下一轮重读拿新修订号再写（内容不变，是同一份全量）。
        }
      }
    },
  };
}

/**
 * 每个设置命名空间唯一的意图日志。
 *
 * `IntentLog` 的文档化前置条件是「一份存储只配一个实例」：多实例各自的「读全量 → 改全量 →
 * 写全量」会互相覆盖。登记表按命名空间分槽，同一个命名空间里第二次装配拿到的是同一个实例。
 *
 * 重挂载（宿主重新挂载这一行）会带来新的上下文与新的端口，所以实例保留、**存储端口换新**：
 * 否则重挂载后仍会往旧上下文的设置服务里读写。串行链在实例上，换端口不会让并发写交叉。
 */
interface IntentSlot {
  store: IntentStore;
  log: IntentLog;
}

const intentSlots = new Map<string, IntentSlot>();

/**
 * 取（必要时构造）某个设置命名空间的意图日志。
 * @param namespace - 设置命名空间。
 * @param store - 本次装配的存储端口；该命名空间已有实例时把它换成这个端口。
 * @returns 该命名空间唯一的意图日志。
 */
export function intentLogFor(namespace: string, store: IntentStore): IntentLog {
  const existing = intentSlots.get(namespace);
  if (existing !== undefined) {
    existing.store = store;
    return existing.log;
  }
  const slot: IntentSlot = {
    store,
    log: new IntentLog({
      read: () => slot.store.read(),
      write: (intents) => slot.store.write(intents),
    }),
  };
  intentSlots.set(namespace, slot);
  return slot.log;
}

/**
 * 读启动环境里的一次取值（宿主 `launchEnvironmentOf`：启动器快照，缺席时回落到进程环境）。
 * 空串与纯空白读作未配置（凭据来源的同一纪律）。
 * @param ctx - 插件上下文。
 * @param name - 变量名。
 * @returns 该变量的值，或 `undefined`。
 */
export function environmentValue(ctx: Context, name: string): string | undefined {
  return normalizeKey(launchEnvironmentOf(ctx).get(name)?.value);
}
