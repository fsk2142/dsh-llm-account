/**
 * 账号库不变量：ref 生成、按 ref 去重、顺序调整、按模型绑定、删除清理与固定账号字段
 * （含哨兵）的读法。
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
import { normalizeKey } from "./credentials";

/** ref 前缀：账号 ref 同时充当凭据槽名，前缀把它与用户手写的引用名区分开。 */
const REF_PREFIX = "DSH_LLM_ACCOUNT";

/**
 * 合法凭据引用名（Global Constraints）。槽判定与两个厂商的条目/字段校验共用这一份：
 * 「这个值是不是一个 ref」是哨兵词汇的一部分（`invalid` 与「自动轮换」是两种不同的读法），
 * 两处各写一份迟早会走偏。
 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
 * 把「派生顺序」与用户手动排序（`accountOrder`）合并成最终顺序。
 *
 * 规则（设计 `2026-10-17-switching-models-density-design.md` §5.1）：
 * 1. 覆盖值必须是数组；只收非空字符串、去重、**只保留派生顺序里存在的 ref**（不存在的
 *    账号不参与轮换）；
 * 2. 覆盖里合法的项按覆盖顺序排在前面，派生顺序里没出现的项追加在末尾（新账号不会因为
 *    用户排过序就消失）；
 * 3. 清洗后为空（字段缺失/坏形状/全部是旧 ref）→ 原样返回派生顺序。
 *
 * @param derived - 厂商从文档推导出的顺序（顶层默认账号 + `accounts[]`，已去重）。
 * @param override - 设置文档里的 `accountOrder` 原始值（形状不可信）。
 * @returns 最终轮换顺序；不修改入参。
 */
export function orderWithOverride(derived: readonly string[], override: unknown): string[] {
  const base = [...new Set(derived)];
  if (!Array.isArray(override)) return base;
  const known = new Set(base);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const item of override) {
    if (typeof item !== "string") continue;
    const ref = item.trim();
    if (ref === "" || !known.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    ordered.push(ref);
  }
  if (ordered.length === 0) return base;
  for (const ref of base) if (!seen.has(ref)) ordered.push(ref);
  return ordered;
}

/**
 * 厂商在**全局顺序**里的投影。
 *
 * 全局 `accountOrder` 存的是 `${vendor}:${ref}`：两份设置文档都保存同一份完整顺序，
 * 每家只投影出自己的账号。旧文档里的裸 ref 仍按本厂商限定处理（零迁移）。
 * @param derived - 本厂商的 ref（顶层默认账号 + 账号表，已去重）。
 * @param override - 设置文档里的 `accountOrder`（内容可能是全局键或旧裸 ref）。
 * @param vendor - 本厂商 provider id。
 * @returns 本厂商账号在全局顺序里的排列。
 */
export function globalOrderOfVendor(derived: readonly string[], override: unknown, vendor: VendorId): string[] {
  const prefix = `${vendor}:`;
  const normalized = Array.isArray(override)
    ? override.map((item) => {
        if (typeof item !== "string") return item;
        const ref = item.trim();
        if (ref === "") return item;
        // 已带任意 vendor 前缀：保留（其他厂商的键会被 orderWithOverride 过滤掉）。
        return ref.startsWith(prefix) || ref.includes(":") ? ref : `${prefix}${ref}`;
      })
    : override;
  const ordered = orderWithOverride(derived.map((ref) => `${prefix}${ref}`), normalized);
  return ordered.map((key) => key.slice(prefix.length));
}

/** 全局顺序键。 */
export function accountOrderKey(vendor: VendorId, ref: string): string {
  return `${vendor}:${ref}`;
}

/**
 * 把一项提到首位，其余项的**相对顺序不变**（旧插件 `moveAccountFirst` 第 6779 行）。
 *
 * 与 {@link reorder} 的分工：`reorder` 服务于「用户拖动排序」这一写入路径（下标语义、
 * 越界夹取），本函数服务于「当前账号是谁就显示在第一位」这一**派生**读取 —— 账号端口
 * 的 `list()` 用它让界面顺序与轮换顺序（顶层引用恒在首位）一致，不因此写任何设置。
 * ref 不在列表里、或已经是首位时原样返回（调用方据此跳过无谓的写入）。
 * @param rows - 当前顺序。
 * @param ref - 要提到首位的 ref。
 * @returns 新数组；入参不被修改。
 */
export function moveFirst<T extends { ref: string }>(rows: readonly T[], ref: string): T[] {
  const index = rows.findIndex((row) => row.ref === ref);
  if (index <= 0) return [...rows];
  return [rows[index]!, ...rows.slice(0, index), ...rows.slice(index + 1)];
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

/**
 * 固定账号字段的**唯一**读法。
 *
 * 两个厂商的「当前账号」字段形状不同（Command Code 是 `activeAccount`，opencode 是顶层
 * `apiKeyEnv`），但哨兵词汇完全一样：缺失、空串、自动轮换哨兵、旧插件的**默认槽**哨兵、
 * 以及一个合法 ref；认不出的值按自动轮换处理。这些判定过去散在四个地方（两个入口的
 * `pinnedRefOf` 与两个端口的 `activeRefOf`），一处漏掉一个哨兵就会出现「正在服务的账号
 * 没有任何一行、也固定不了」的裂缝 —— 所以词汇只在这里决定。
 */
export interface AccountSlotReading {
  /** 固定账号的 ref；`null` 表示按轮换顺序自动选择。 */
  readonly pinned: string | null;
  /** 这个字段当前生效的 ref（= `pinned ?? fallback`）：哨兵与坏值都落到 `fallback`。 */
  readonly ref: string;
  /** 字段缺失/空串/是自动轮换哨兵：没有固定账号。 */
  readonly auto: boolean;
  /** 字段是旧插件的默认槽哨兵：固定到 `fallback`（顶层那个账号）。 */
  readonly isDefaultSlot: boolean;
  /** 字段有值但既不是哨兵也不是合法引用名（只用于应用期诊断）。 */
  readonly invalid: boolean;
}

/** 一个厂商的固定账号字段词汇。两个哨兵都是可选的：opencode 两个都不认。 */
export interface AccountSlotVocabulary {
  /** 字段缺失/空串/坏值时回落的默认账号 ref（顶层那个账号）。 */
  readonly fallback: string;
  /** 读作「自动轮换」的哨兵值（缺失与空串之外；Command Code 是 `"auto"`）。 */
  readonly auto?: string;
  /** 旧插件的「默认槽」哨兵：值等于它时固定到 `fallback`（Command Code 是 `"default"`）。 */
  readonly legacyDefault?: string;
}

/**
 * 读固定账号字段：把缺失、空串、两种哨兵与坏值归一成一个决定。
 *
 * 优先级固定为「缺失/空串/自动哨兵 → 自动」「默认槽哨兵 → 固定到 fallback」「合法 ref →
 * 固定到它」「其余 → 自动（并标记 invalid 供诊断）」。
 * @param raw - 文档字段的原始值（形状不可信）。
 * @param vocabulary - 该厂商的哨兵词汇与默认账号 ref。
 * @returns 归一化后的槽判定。
 */
export function readAccountSlot(raw: unknown, vocabulary: AccountSlotVocabulary): AccountSlotReading {
  const value = normalizeKey(raw);
  if (value === undefined || (vocabulary.auto !== undefined && value === vocabulary.auto)) {
    return { pinned: null, ref: vocabulary.fallback, auto: true, isDefaultSlot: false, invalid: false };
  }
  if (vocabulary.legacyDefault !== undefined && value === vocabulary.legacyDefault) {
    return { pinned: vocabulary.fallback, ref: vocabulary.fallback, auto: false, isDefaultSlot: true, invalid: false };
  }
  if (CREDENTIAL_REF_PATTERN.test(value)) {
    return { pinned: value, ref: value, auto: false, isDefaultSlot: false, invalid: false };
  }
  return { pinned: null, ref: vocabulary.fallback, auto: true, isDefaultSlot: false, invalid: true };
}
