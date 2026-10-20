/**
 * 用量采集：**把每次请求记下来**，按账号落盘，进程重启后继续累计。
 *
 * 三条设计约束（都是踩过的坑）：
 * 1. **不能阻塞请求**。记录是旁路：`record()` 只做内存追加与异步落盘，adapter 的
 *    流式输出不等它。
 * 2. **失败也要记**。成功率的分母是「尝试过的请求」；只记成功会让成功率永远是 100%。
 * 3. **落盘要能自愈**。文件损坏/半截写入时丢弃坏行、保留好行，绝不让统计把插件带崩。
 *
 * 存储形态：JSON Lines，一天一个文件（`usage-YYYY-MM-DD.jsonl`）。读取时**按文件名
 * 预筛**——选「今日」只读今天那一个文件，不必把 120 天全扫一遍。
 * @module dsh-llm-account/src/core/usage-ledger
 */
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RequestOutcome, UsageRecord } from "./stats";

/** 一天一条文件（`usage-2026-10-19.jsonl`），避免单文件无限增长。 */
function fileNameOf(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `usage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`;
}

/**
 * 从文件名取出它覆盖的那一天起点（本地时区，与 {@link fileNameOf} 一致）。
 * @param name - 文件名。
 * @returns 当天零点（epoch 毫秒）；名字不合规时为 `undefined`。
 */
function dayOfFile(name: string): number | undefined {
  const match = /^usage-(\d{4})-(\d{2})-(\d{2})\.jsonl$/u.exec(name);
  if (match === null) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

/** 保留多少天的历史文件（超出不读、也不删 —— 删除是用户的决定）。 */
export const USAGE_RETENTION_DAYS = 120;

/** 一次待记录请求的入参（缺字段按 0 处理，见 `countsOf`）。 */
export interface RecordInput {
  vendor: string;
  account: string;
  at?: number;
  outcome: RequestOutcome;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
  failureKind?: string;
}

/** 读台账时的范围（都可选；省略即全部保留期）。 */
export interface ReadRange {
  /** 只要这个时刻之后（含）的记录。 */
  since?: number | undefined;
  /** 只要这个时刻之前（含）的记录。 */
  until?: number | undefined;
}

/** 台账句柄。 */
export interface UsageLedger {
  /** 记一条（异步落盘；返回的 promise 不需要 await，await 只用于测试）。 */
  record(input: RecordInput): Promise<void>;
  /**
   * 读记录（按时间升序）。
   *
   * @param range - 时间范围；给了 `since` 就会跳过更早的**文件**（不是读进来再过滤）。
   */
  read(range?: ReadRange): Promise<UsageRecord[]>;
  /** 清空台账（用户显式操作；文件保留为空文件而不是删除）。 */
  clear(): Promise<void>;
}

/**
 * 把一行文本解析成记录。
 * @param line - 一行 JSONL。
 * @returns 记录，或 `undefined`（空行/坏行）。
 */
function parseLine(line: string): UsageRecord | undefined {
  const text = line.trim();
  if (text === "") return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const row = raw as Record<string, unknown>;
  const numberOr0 = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  const at = numberOr0(row["at"]);
  const vendor = typeof row["vendor"] === "string" ? row["vendor"] : "";
  // 没有时间戳或厂商的行无从归属，当坏行丢弃。
  if (at === 0 || vendor === "") return undefined;
  const outcome: RequestOutcome = row["outcome"] === "success" ? "success" : "failure";
  const record: UsageRecord = {
    vendor,
    account: typeof row["account"] === "string" ? row["account"] : "",
    at,
    outcome,
    inputTokens: numberOr0(row["inputTokens"]),
    outputTokens: numberOr0(row["outputTokens"]),
    cacheReadTokens: numberOr0(row["cacheReadTokens"]),
    cacheWriteTokens: numberOr0(row["cacheWriteTokens"]),
    model: typeof row["model"] === "string" ? row["model"] : "",
  };
  const failureKind = row["failureKind"];
  if (typeof failureKind === "string" && failureKind !== "") record.failureKind = failureKind;
  return record;
}

/**
 * 读台账里的记录。
 *
 * 先按**文件名**筛掉不可能有命中的日期，再解析剩下的文件 —— 这是「切到今日」这条
 * 最常见路径上唯一值得做的优化：从 120 个文件降到 1 个。
 * @param directory - 存放目录。
 * @param now - 时钟（测试注入）。
 * @param range - 时间范围。
 * @returns 记录（按时间升序）。
 */
async function readRecords(directory: string, now: () => number, range: ReadRange = {}): Promise<UsageRecord[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const retentionCutoff = now() - USAGE_RETENTION_DAYS * 86_400_000;
  const since = range.since === undefined ? retentionCutoff : Math.max(range.since, retentionCutoff);
  const until = range.until;
  const dayStartOf = (at: number): number => {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const firstDay = dayStartOf(since);
  const lastDay = until === undefined ? undefined : dayStartOf(until);
  const files = names
    .filter((name) => dayOfFile(name) !== undefined)
    .filter((name) => {
      const day = dayOfFile(name)!;
      // 该文件覆盖 [day, day+1)；与 [firstDay, lastDay+1) 有交集才读。
      if (day < firstDay) return false;
      if (lastDay !== undefined && day > lastDay) return false;
      return true;
    })
    .sort()
    .slice(-USAGE_RETENTION_DAYS);
  const records: UsageRecord[] = [];
  for (const name of files) {
    let text: string;
    try {
      text = await readFile(join(directory, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const record = parseLine(line);
      if (record === undefined) continue;
      if (record.at < since) continue;
      if (until !== undefined && record.at > until) continue;
      records.push(record);
    }
  }
  records.sort((left, right) => left.at - right.at);
  return records;
}

/**
 * 造一个台账。
 *
 * @param directory - 存放目录（宿主侧一个插件私有目录）。
 * @param now - 时钟注入（测试用）。
 * @returns 台账句柄。
 */
export function createUsageLedger(directory: string, now: () => number = Date.now): UsageLedger {
  /** 写队列：保证同一进程内追加是有序的（否则 JSONL 会交错成坏行）。 */
  let writeChain: Promise<void> = Promise.resolve();
  let ready: Promise<void> | undefined;

  const ensureDirectory = async (): Promise<void> => {
    ready ??= mkdir(directory, { recursive: true }).then(() => undefined);
    await ready;
  };

  const pathOf = (at: number): string => join(directory, fileNameOf(at));

  return {
    async record(input: RecordInput): Promise<void> {
      const at = input.at ?? now();
      const record: UsageRecord = {
        vendor: input.vendor,
        account: input.account,
        at,
        outcome: input.outcome,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTokens ?? 0,
        model: input.model ?? "",
        ...(input.failureKind === undefined ? {} : { failureKind: input.failureKind }),
      };
      const line = `${JSON.stringify(record)}\n`;
      // 串行化：每次落盘都排在上一次之后，且单次失败不影响后续写入。
      writeChain = writeChain
        .then(async () => {
          await ensureDirectory();
          await appendFile(pathOf(at), line, "utf8");
        })
        .catch((error: unknown) => {
          console.warn("[dsh-llm-account] could not append the usage ledger:", error);
        });
      await writeChain;
    },

    async read(range?: ReadRange): Promise<UsageRecord[]> {
      await ensureDirectory().catch(() => undefined);
      return readRecords(directory, now, range ?? {});
    },

    async clear(): Promise<void> {
      // 清**整段保留期**，不是只清今天：`readRecords` 会读每一个日文件，只清今天的会让
      // 前几天的历史在重读后原样回来 —— 用户确认的是「清空全部」，界面却显示部分成功
      // 且部分数据丢失（2026-10-20 审计）。
      //
      // 仍然**保留文件本身、只清空内容**：删文件这类破坏性操作更大，且与并发写更容易撞上。
      writeChain = writeChain.then(async () => {
        await ensureDirectory();
        let names: string[];
        try {
          names = await readdir(directory);
        } catch {
          // 目录不可读：没有可清的东西。
          return;
        }
        const files = names.filter((name) => dayOfFile(name) !== undefined);
        // 保留期内的每一个日文件都清空（`slice` 与读路径同一口径，避免读得到却清不掉）。
        const targets = files.sort().slice(-USAGE_RETENTION_DAYS);
        for (const name of targets) {
          await writeFile(join(directory, name), "", "utf8");
        }
        // 目录里一个日文件都没有（新装机器）时也写一个空的今天文件：让「清空」可被观察到，
        // 与以前的行为一致。
        if (targets.length === 0) await writeFile(pathOf(now()), "", "utf8");
      });
      await writeChain;
    },
  };
}

/** 台账文件的目录名（相对插件私有目录）。 */
export const USAGE_DIR_NAME = "usage";
