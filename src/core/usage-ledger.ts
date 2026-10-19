/**
 * 用量采集：**把每次请求记下来**，按账号落盘，进程重启后继续累计。
 *
 * 三条设计约束（都是踩过的坑）：
 * 1. **不能阻塞请求**。记录是旁路：`record()` 只做内存追加与异步落盘，adapter 的
 *    流式输出不等它。
 * 2. **失败也要记**。成功率的分母是「尝试过的请求」；只记成功会让成功率永远是 100%。
 * 3. **落盘要能自愈**。文件损坏/半截写入时丢弃坏行、保留好行，绝不让统计把插件带崩。
 *
 * 存储形态：JSON Lines，一行一条 {@link UsageRecord}。追加写、按天切分，读的时候
 * 只读最近需要的文件。
 * @module dsh-llm-account/src/core/usage-ledger
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RequestOutcome, UsageRecord } from "./usage-stats";

/** 一天一条文件（`usage-2026-10-19.jsonl`），避免单文件无限增长。 */
function fileNameOf(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `usage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`;
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

/** 台账句柄。 */
export interface UsageLedger {
  /** 记一条（异步落盘；返回的 promise 不需要 await，await 只用于测试）。 */
  record(input: RecordInput): Promise<void>;
  /** 读全部记录（按时间升序）。 */
  read(): Promise<UsageRecord[]>;
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

    async read(): Promise<UsageRecord[]> {
      await ensureDirectory().catch(() => undefined);
      const { readdir } = await import("node:fs/promises");
      let names: string[];
      try {
        names = await readdir(directory);
      } catch {
        return [];
      }
      const cutoff = now() - USAGE_RETENTION_DAYS * 86_400_000;
      const files = names
        .filter((name) => /^usage-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
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
          // 只读窗口内的：更老的文件仍然保留，但统计不读（省时间）。
          if (record !== undefined && record.at >= cutoff) records.push(record);
        }
      }
      records.sort((left, right) => left.at - right.at);
      return records;
    },

    async clear(): Promise<void> {
      // 保留文件、清空内容：避免「删文件」这类破坏性操作，也避免和并发写撞上。
      writeChain = writeChain.then(async () => {
        await ensureDirectory();
        const { writeFile } = await import("node:fs/promises");
        await writeFile(pathOf(now()), "", "utf8");
      });
      await writeChain;
    },
  };
}

/** 台账文件的目录名（相对插件私有目录）。 */
export const USAGE_DIR_NAME = "usage";

/** 由插件数据根算出用量目录。 */
export function usageDirectoryOf(dataRoot: string): string {
  return join(dataRoot, USAGE_DIR_NAME);
}

/** 确保目录存在（导出给装配层在启动时调用一次）。 */
export async function ensureUsageDirectory(directory: string): Promise<void> {
  await mkdir(dirname(join(directory, "x")), { recursive: true });
}
