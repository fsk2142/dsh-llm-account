/**
 * 台账导出（纯函数）：把记录序列化成 CSV / 取最近 N 条。
 *
 * 为什么需要：台账能读、能清，但**没有导出**。用户想对账、备份，或者把一段时间的使用情况
 * 拿给别人看，只能自己去翻 `~/.dsh/llm-account/usage/*.jsonl`。
 *
 * 两条纪律：
 * 1. **导出原始值，不做展示名替换**：CSV 是对账用的凭据，`model` 必须是台账里那个 id
 *    （展示名是给人看的另一层，见 `core/model-names`）。想按模型分组时用
 *    {@link modelKeyOfRecord} 归一，而不是改写导出的内容。
 * 2. **RFC 4180 转义**：含逗号、引号、换行的字段整体加引号、内部引号翻倍。少了它，
 *    一个带逗号的账号名就会把整张表错列。
 * @module dsh-llm-account/src/core/usage-export
 */
import { modelKeyOf } from "../switching/model-fallback";
import type { UsageRecord } from "./stats";

/** CSV 的列顺序（固定：Excel 打开时列不跳）。 */
export const LEDGER_CSV_COLUMNS: readonly (keyof UsageRecord)[] = [
  "at",
  "vendor",
  "account",
  "model",
  "outcome",
  "failureKind",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
];

/**
 * Excel / LibreOffice 会当作**公式起始符**的字符（2026-10-22 按 bug 审查补）。
 *
 * `=` 普通公式、`+` 与 `-` 参与算术、`@` 是某些版本的控制符。以它们开头的单元格被
 * 打开时会被求值，`=HYPERLINK(...)` 这类可以外带数据。
 *
 * 现实评估（审计报告原文）：导出的 `account` 列受 `CREDENTIAL_REF_PATTERN`
 * （`^[A-Za-z_][A-Za-z0-9_]*$`）约束，不可能以这些字符开头；其余列是时间、厂商 id、
 * 内部枚举与 token 数。唯一不可控来源是厂商 API 返回的 `model` id —— 也就是说
 * **当前利用条件基本不成立**。
 *
 * 仍然加这层防护的理由：这是四行代码，而「不可控来源」一旦将来变多（比如加上用户
 * 可编辑的备注列），漏掉它的代价是被打开表格的人替我们执行公式。
 */
const FORMULA_PREFIXES: readonly string[] = ["=", "+", "-", "@"];

/**
 * 一个字段是否会被表格软件当成公式。
 * @param text - 原始文本。
 * @returns 是否以公式起始符开头。
 */
function looksLikeFormula(text: string): boolean {
  return text !== "" && FORMULA_PREFIXES.includes(text[0]!);
}

/**
 * 把一个字段转成 CSV 安全的文本。
 *
 * 只含数字/字母/常见符号时不加引号（导出的文件更干净），出现分隔符、引号或以公式字符
 * 开头时才整体包裹。
 * @param value - 原始值。
 * @returns 可安全放进一行 CSV 的文本。
 */
function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  // 逗号、双引号、换行必须包；纯空白也包（否则 Excel 可能吃掉）。
  // **公式起始符也包**：引号包裹后 Excel 不再当公式求值（RFC 4180 的合法转义）。
  if (!/[",\r\n]/.test(text) && text.trim() !== "" && !looksLikeFormula(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * 一个时刻 → ISO 8601；不可信的值原样写成数字而不是抛错。
 *
 * `new Date(NaN).toISOString()` 抛 `RangeError` —— 台账解析本来会过滤掉坏 `at`，但导出是
 * **用户按一下就期待拿到文件**的操作：一行坏数据不该让整次导出失败。坏值写成原始数字，
 * 既留下线索又不拖垮整个文件。
 * @param at - 记录时刻（形状不可信）。
 * @returns 可安全写进 CSV 的文本。
 */
function timestampOf(at: unknown): string {
  if (typeof at !== "number" || !Number.isFinite(at)) return cell(at);
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? cell(at) : cell(date.toISOString());
}

/** 一条记录 → 一行 CSV。 */
function rowOf(record: UsageRecord): string {
  return LEDGER_CSV_COLUMNS.map((column) => {
    if (column === "at") return timestampOf(record.at);
    return cell(record[column]);
  }).join(",");
}

/**
 * 把记录导成 CSV 文本（含表头）。
 *
 * 没有记录时**仍然给表头**：空文件与「导出了但这一段时间没有请求」在用户眼里应该能区分开。
 * 行之间用 `\n`（RFC 4180 允许 CRLF，但 `\n` 对 git diff 与 Excel 都更宽容）。
 * @param records - 要导出的记录（顺序即导出行序，通常按时间升序）。
 * @returns CSV 文本。
 */
export function ledgerCsvOf(records: readonly UsageRecord[]): string {
  const header = LEDGER_CSV_COLUMNS.join(",");
  if (records.length === 0) return header;
  return [header, ...records.map(rowOf)].join("\n");
}

/**
 * 只留最近 `limit` 条（导出不该把 120 天一次性塞给用户）。
 *
 * `limit` 非正数或非有限值时原样返回：导出是用户显式操作，「参数不合法」不该变成空文件。
 * @param records - 全部记录（按时间升序）。
 * @param limit - 最多保留多少条（取**尾部**，即最近的）。
 * @returns 裁剪后的记录。
 */
export function exportTailOf(records: readonly UsageRecord[], limit: number): UsageRecord[] {
  if (!Number.isFinite(limit) || limit <= 0) return [...records];
  if (records.length <= limit) return [...records];
  return records.slice(records.length - limit);
}

/**
 * 一条记录的模型归一化键（按模型分组时用它）。
 *
 * 为什么不在导出时改写：实测同一模型存在 `deepseek-v4.1-flash` 与
 * `deepseek/deepseek-v4.1-flash` 两种写法（2156 : 1），按原始 id 分组会把同一模型劈成两行。
 * 归一化是**分组时**的事，导出内容保持原值。
 * @param model - 台账里的模型 id。
 * @returns 归一化键。
 */
export function modelKeyOfRecord(model: string): string {
  return modelKeyOf(model);
}
