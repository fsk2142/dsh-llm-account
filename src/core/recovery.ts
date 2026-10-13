/**
 * 账号操作意图日志：先写意图、再提交，崩溃后重放（设计文档 §6.4.5、§12 Review Focus 5）。
 *
 * 账号操作（增删改、改密钥、选择、排序、自动切换）都是「设置 + 凭据」两处写入，
 * 中途崩溃会留下半成品。约定做法是**先记意图、再做提交、成功后 `settle`**：崩溃后
 * 重启时 `replay` 把未决意图逐条交给调用方的 `apply`，按结果收尾 —— 冲突时重放，
 * 而不是盲目覆盖。
 *
 * 本模块是纯核心逻辑：不导入任何宿主包、不注册定时器、不写日志输出，只依赖注入的
 * `IntentStore` 端口。日志的**真源永远在存储里**：每个方法都重新 `read`，不缓存，
 * 因此外部对同一份存储的其它写者不会被陈旧的内存副本覆盖。
 *
 * **顺序**：日志顺序就是 `append` 的插入顺序（即存储 `read` 返回的顺序），**不按
 * `createdAt` 排序** —— 回放必须按因果顺序（先 add 再 rename），墙钟顺序做不到这点。
 * 调用方负责按因果顺序 `append`。
 * @module dsh-llm-account/src/core/recovery
 */

/** 账号操作意图的分类。 */
export type AccountIntentKind =
  | "add"
  | "remove"
  | "rename"
  | "replace-key"
  | "select"
  | "move"
  | "auto-switch";

/**
 * 一条待提交的账号操作意图。字段按 `kind` 取用（与 `AccountPort` 的参数一一对应）：
 * `add`/`rename` 用 `label`，`remove`/`rename`/`replace-key`/`select`/`move` 用 `ref`，
 * `move` 用 `toIndex`，`auto-switch` 用 `value`。
 */
export interface AccountIntent {
  /** 意图标识，同一份日志内唯一（`settle`/去重都按它定位）。 */
  id: string;
  /** 操作类型。 */
  kind: AccountIntentKind;
  /** 目标账号的 ref（ref 标识空间；`add` 时尚不存在，可缺省）。 */
  ref?: string;
  /** `add`/`rename` 的目标名称。 */
  label?: string;
  /** `move` 的目标下标。 */
  toIndex?: number;
  /** `auto-switch` 的目标开关值。 */
  value?: boolean;
  /** 入队时刻（epoch 毫秒），仅供展示与排查，不参与排序。 */
  createdAt: number;
}

/**
 * 意图日志的持久化端口：一次读全量、一次写全量。
 *
 * 端口实现须把整份日志当作原子值（写成功后 `read` 必须返回刚写入的内容），
 * 失败必须抛错 —— 静默失败会让崩溃恢复丢掉已提交的操作。
 */
export interface IntentStore {
  /** 读取当前全量日志（顺序即日志顺序）。 */
  read(): Promise<AccountIntent[]>;
  /** 覆盖写入全量日志。 */
  write(intents: AccountIntent[]): Promise<void>;
}

/**
 * 一次 `replay` 的结果。
 *
 * - `applied`：本轮回放中被 `apply` 判定为「已提交」的意图数（已从日志移除）。
 * - `rejected`：被 `apply` 判定为「已被拒绝/冲突」的意图数（同样已从日志移除，
 *   不会再次重放；它和 `applied` 的区别只在**语义归属**，不在是否落盘收尾）。
 * - `unknown`：`apply` 无法判定、仍留在日志里等待下次重放的意图数。同一个意图在
 *   一次 `replay` 调用里最多尝试一次，所以它不会因为多轮而被重复计数。
 * - `remaining`：本次 `replay` 返回时日志里还剩多少条（= `unknown` 加上回放期间
 *   新追加、尚未处理的意图；对未来得及进本轮快照的新意图也计入）。
 */
export interface ReplayReport {
  applied: number;
  rejected: number;
  unknown: number;
  remaining: number;
}

/** `apply` 对单条意图的判定。 */
export type ReplayOutcome = "applied" | "rejected" | "unknown";

/**
 * 单次 `replay` 的轮数上限。回放期间新追加的意图要在下一轮处理，轮数必须有上限，
 * 否则「`apply` 每次都追加一条」就成了死循环。
 */
const MAX_REPLAY_ROUNDS = 4;

/** 复制一条意图，避免日志内部对象与调用方共享引用（字段全是基本类型，浅拷贝即深拷贝）。 */
function cloneIntent(intent: AccountIntent): AccountIntent {
  return { ...intent };
}

/**
 * 意图日志。用法：提交前 `append`，提交成功后 `settle`，启动时 `replay`。
 *
 * 每个方法都是一次「读全量 → 改全量 → 写全量」的原子步骤；存储写失败一律向外抛。
 * `settle` 对不存在的 id 是无操作，连写都不发（避免无谓落盘，也避免让「清一条早已
 * 收尾的意图」因为存储抖动而失败）。
 */
export class IntentLog {
  readonly #store: IntentStore;

  /**
   * @param store - 注入的持久化端口；本类不关心它背后是设置、文件还是数据库。
   */
  constructor(store: IntentStore) {
    this.#store = store;
  }

  /**
   * 追加一条意图并立即落盘。追加成功后才可以做真正的提交动作。
   * @param intent - 待记录的意图；入参会被复制，调用方后续改动无效。
   */
  async append(intent: AccountIntent): Promise<void> {
    const intents = await this.#read();
    intents.push(cloneIntent(intent));
    await this.#store.write(intents);
  }

  /**
   * 读取当前日志（按插入顺序）。
   * @returns 全新的数组与全新的意图对象：调用方怎么改都影响不到日志内部。
   */
  async list(): Promise<AccountIntent[]> {
    return this.#read();
  }

  /**
   * 收尾一条意图：提交成功后把它从日志里去掉，之后的 `replay` 不会再碰它。
   * 对不存在的 id 是无操作（不抛错、不落盘）。
   * @param id - 意图标识。
   */
  async settle(id: string): Promise<void> {
    const intents = await this.#read();
    const kept = intents.filter((intent) => intent.id !== id);
    if (kept.length === intents.length) return;
    await this.#store.write(kept);
  }

  /**
   * 重放未决意图：把日志交给 `apply` 逐条判定，按结果收尾。
   *
   * 单次调用最多 4 轮；每轮取一次快照，只处理**本次调用里还没尝试过**的意图（`unknown`
   * 的意图不会在同一轮里被反复重试），随后把该轮判定为 `applied`/`rejected` 的意图从
   * **当场读到的最新日志**里删掉并落盘 —— 逐轮落盘，不在内存里攒到最后一次性写。
   * `unknown` 的意图原样留下，等下一次 `replay`；回放期间新追加的意图因此不会被清掉，
   * 但会进入下一轮（轮数上限即 4）。
   *
   * `apply` 与存储的错误都不吞：抛错直接冒泡，调用方据此判断本次回放没有完成。
   * @param apply - 对单条意图执行提交动作并给出判定；`applied` 与 `rejected` 都会从
   *   日志移除，`unknown` 保留待下次重放。会收到意图的副本。
   * @returns 本次回放的计数与剩余条数，见 `ReplayReport`。
   */
  async replay(apply: (intent: AccountIntent) => Promise<ReplayOutcome>): Promise<ReplayReport> {
    let applied = 0;
    let rejected = 0;
    let unknown = 0;
    const attempted = new Set<string>();

    for (let round = 0; round < MAX_REPLAY_ROUNDS; round += 1) {
      const pending = (await this.#read()).filter((intent) => !attempted.has(intent.id));
      if (pending.length === 0) break;

      const decided = new Set<string>();
      for (const intent of pending) {
        attempted.add(intent.id);
        const outcome = await apply(cloneIntent(intent));
        if (outcome === "unknown") {
          unknown += 1;
          continue;
        }
        if (outcome === "applied") applied += 1;
        else rejected += 1;
        decided.add(intent.id);
      }

      if (decided.size > 0) {
        // 重新读一次：本轮 apply 可能追加了新意图，它们不在这轮快照里，必须保留。
        const kept = (await this.#read()).filter((intent) => !decided.has(intent.id));
        await this.#store.write(kept);
      }
    }

    return { applied, rejected, unknown, remaining: (await this.list()).length };
  }

  /**
   * 读取日志并复制一层，保证内部对象不外泄。
   * @returns 全新的数组与全新的意图对象。
   */
  async #read(): Promise<AccountIntent[]> {
    return (await this.#store.read()).map(cloneIntent);
  }
}
