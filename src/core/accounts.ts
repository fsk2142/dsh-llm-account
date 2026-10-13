/**
 * 账号库不变量：ref 生成、按 ref 去重、顺序调整、按模型绑定与删除清理。
 *
 * 全部为纯函数：不做 I/O、不持有状态、不修改入参。这些不变量是轮换引擎与
 * 两个厂商账号端口的共同地基，两处若各写一份迟早会走偏。
 *
 * **标识空间**：本模块所有 `ref` 参数、`ModelRule.account`、`AccountState.order`
 * 的元素与 `AccountState.pinned` 都在同一套 ref 标识空间里（`accountRef()` 的产物
 * 或用户手写的凭据引用名）。`label` 是人类可读名称，只用于展示，不参与身份比较。
 * @module dsh-llm-account/src/core/accounts
 */
import type { AccountState, AccountView, ModelRule, VendorId } from "./adapter";

/** ref 前缀：账号 ref 同时充当凭据槽名，前缀把它与用户手写的引用名区分开。 */
const REF_PREFIX = "DSH_LLM_ACCOUNT";

/** 哈希后缀的十六进制位数（48 位）：足够隔离标签转义碰撞，同时保持槽名可读。 */
const HASH_SUFFIX_LENGTH = 12;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/**
 * 把任意文本折进 `[A-Z0-9_]`：先转大写，再把每个非法字符替换成 `_`（不折叠连续下划线）。
 * 不做折叠是刻意的：折叠会丢失信息，反而让不同标签更容易撞名。
 * @param text - 待转义的文本（厂商 id 或账号标签）。
 * @returns 只含大写字母、数字与下划线的文本。
 */
function escapeText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/**
 * 计算文本的 64 位 FNV-1a 哈希，返回 16 位十六进制。
 * 哈希输入是**原始**文本：标签转义后同名时，靠这里区分。
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
 * 由厂商与账号标签推导账号 ref（同时用作凭据槽名）。
 *
 * 形状为 `DSH_LLM_ACCOUNT_<VENDOR>_<LABEL>_<HASH>`：厂商与标签先转大写，
 * 非 `[A-Za-z0-9_]` 的字符替换成 `_`；后缀是原始 `(vendor, label)` 的短哈希，
 * 因此「标签不同、转义后同名」也会得到两个不同 ref。结果必满足凭据引用名的
 * 合法字符集 `^[A-Za-z_][A-Za-z0-9_]*$`（前缀以字母开头，其余部分只有字母、数字、下划线）。
 *
 * 标签按原样参与推导（不去空白、不折叠大小写），所以两个仅在空白或大小写上不同的
 * 标签仍是两个账号，不会静默共用一个凭据槽。
 * @param vendor - 该账号所属的 provider 路由。
 * @param label - 用户可见名称。
 * @returns 该账号的 ref，可安全用作凭据槽名。
 */
export function accountRef(vendor: VendorId, label: string): string {
  const suffix = hashText(`${vendor}\u0000${label}`).slice(0, HASH_SUFFIX_LENGTH);
  return `${REF_PREFIX}_${escapeText(vendor)}_${escapeText(label)}_${suffix}`;
}

/**
 * 按 ref 去重，保留每个 ref **第一次**出现的条目（不合并字段），相对顺序不变。
 * 同一个 ref 在顺序里出现多次会让它被多算一轮，因此只留第一个。
 * @param views - 账号行的展示视图，可能含重复 ref。
 * @returns 去重后的新数组；入参不被修改。
 */
export function dedupeByRef(views: AccountView[]): AccountView[] {
  const seen = new Set<string>();
  const kept: AccountView[] = [];
  for (const view of views) {
    if (seen.has(view.ref)) continue;
    seen.add(view.ref);
    kept.push(view);
  }
  return kept;
}

/**
 * 把 ref 移到目标位置。`toIndex` 的语义是「移动后的最终下标」，越界夹到两端。
 * ref 不在列表里时不做任何改动（返回等值的新数组）。
 * @param order - 当前账号顺序。
 * @param ref - 要移动的账号 ref。
 * @param toIndex - 移动后的最终下标；超出范围时夹到 `[0, order.length - 1]`。
 * @returns 新的顺序数组；入参不被修改。
 */
export function reorder(order: string[], ref: string, toIndex: number): string[] {
  const next = [...order];
  const from = next.indexOf(ref);
  if (from === -1) return next;
  next.splice(from, 1);
  next.splice(Math.min(Math.max(toIndex, 0), next.length), 0, ref);
  return next;
}

/**
 * 把一组模型改派给某个账号：先从现有规则里逐个摘掉这些模型（被摘空的规则整条移除），
 * 再把它们作为一条新规则追加到末尾。由此保证一个模型同一时间只属于一个账号。
 *
 * `models` 为空时只做摘除，不产生空规则。同一账号可以有多条规则（改派只追加、不合并），
 * 消费方必须按「按模型查找」而不是「按账号查找」使用。
 * @param rules - 现有按模型规则。
 * @param models - 要改派的模型 id。
 * @param account - 目标账号 ref。
 * @returns 新的规则数组；入参不被修改。
 */
export function assignModelRule(rules: ModelRule[], models: string[], account: string): ModelRule[] {
  const stripped = rules
    .map((rule) => ({ models: rule.models.filter((model) => !models.includes(model)), account: rule.account }))
    .filter((rule) => rule.models.length > 0);
  return models.length === 0 ? stripped : [...stripped, { models: [...models], account }];
}

/**
 * 删除账号后的状态：从顺序里去掉它的每一处，丢掉挂在它名下的整条模型规则
 * （规则归账号所有，删账号即删规则），并在它是当前固定账号时把标记清成 `null`
 * （回到自动轮换）。删除不存在的 ref 是恒等变换。
 * @param state - 当前账号库状态。
 * @param ref - 要删除的账号 ref。
 * @returns 新状态；入参不被修改。
 */
export function dropAccount(state: AccountState, ref: string): AccountState {
  return {
    order: state.order.filter((entry) => entry !== ref),
    rules: state.rules.filter((rule) => rule.account !== ref),
    pinned: state.pinned === ref ? null : state.pinned,
  };
}
