/**
 * 用量采集的**宿主侧单例**：三条 provider 行共用一本台账。
 *
 * 为什么是模块级单例而不是每行一个：三个 `apply` 在同一个 node 进程里跑（同一个 bundle
 * 模块实例），而「总账」必须跨厂商、跨账号 —— 每行各写一本账就没法合计，也会把同一个
 * 数据目录写坏。这里仿照客户端 `sharedUsage` 的做法：第一次用的人定下目录，之后共用。
 * @module dsh-llm-account/src/vendors/usage-store
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { createUsageLedger, USAGE_DIR_NAME, type UsageLedger } from "../core/usage-ledger";
import type { UsagePort, UsageSample } from "../core/usage-port";

/** 单例台账。 */
let sharedLedger: UsageLedger | undefined;

/**
 * 用量数据的根目录。
 *
 * 放 `~/.dsh/llm-account/usage`：与宿主其它插件的用户级状态同处一地（`~/.dsh`），
 * 但用插件自己的子目录，不与宿主的 `cache/` `logs/` 混在一起。
 * @returns 目录路径。
 */
export function defaultUsageRoot(): string {
  return join(homedir(), ".dsh", "llm-account", USAGE_DIR_NAME);
}

/**
 * 取（或首次创建）共享台账。
 * @param directory - 存放目录；首次调用时生效，之后忽略（保证只有一本账）。
 * @returns 台账。
 */
export function sharedUsageLedger(directory: string = defaultUsageRoot()): UsageLedger {
  sharedLedger ??= createUsageLedger(directory);
  return sharedLedger;
}

/** 复位单例（测试隔离；生产不会调用）。 */
export function resetSharedUsageLedger(): void {
  sharedLedger = undefined;
}

/**
 * 造一个写共享台账的采集端口。
 *
 * 端口必须**同步返回、不抛错**：adapter 在流式路径上调用它，任何抛出都会变成请求失败。
 * `record()` 内部把落盘 Promise 交给台账自己的写队列，这里只负责不 await。
 * @param ledger - 台账；缺省用共享单例。
 * @returns 采集端口。
 */
export function createUsagePort(ledger: UsageLedger = sharedUsageLedger()): UsagePort {
  return {
    record(sample: UsageSample): void {
      try {
        // 刻意不 await：落盘是旁路，请求不等它。
        void ledger.record({
          vendor: sample.vendor,
          account: sample.account,
          outcome: sample.outcome,
          ...(sample.model === undefined ? {} : { model: sample.model }),
          ...(sample.inputTokens === undefined ? {} : { inputTokens: sample.inputTokens }),
          ...(sample.outputTokens === undefined ? {} : { outputTokens: sample.outputTokens }),
          ...(sample.cacheReadTokens === undefined ? {} : { cacheReadTokens: sample.cacheReadTokens }),
          ...(sample.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: sample.cacheWriteTokens }),
          ...(sample.failureKind === undefined ? {} : { failureKind: sample.failureKind }),
        });
      } catch (error) {
        console.warn("[dsh-llm-account] could not queue the usage sample:", error);
      }
    },
  };
}
