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
 * 把一个字段转成 CSV 安全的文本。
 *
 * 只含数字/字母/常见符号时不加引号（导出的文件更干净），出现分隔符或引号时才整体包裹。
 * @param value - 原始值。
 * @returns 可安全放进一行 CSV 的文本。
 */
function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  // 逗号、双引号、换行都必须引号包裹；纯空白也包（否则 Excel 可能吃掉）。
  if (!/[",\r\n]/.test(text) && text.trim() !== "") return text;
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
