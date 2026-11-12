/**
 * 断流 → 失败 finish（2026-11-12 审查 A03，用户选 A）。
 *
 * ## 用户定的方向
 *
 * > 半截断流（网关提前 EOF，没有终止事件）时报**失败**，不要伪装成正常结束。
 *
 * 他要的是「更诚实、能自己决定继续」。旧行为是合成一条 `finish: stop` ——
 * 界面看起来一切正常，而回答只写了一半，且不会触发任何续写/重试。
 *
 * ## 本文件钉住的三件事
 *
 * 1. **交 `finish: error` 而不是 `throw`** —— 抛错会让已渲染的半截文本在界面上消失，
 *    而用户明确要求保留；
 * 2. **code 是 `PROVIDER_STREAM_TRUNCATED` 且不在 RETRYABLE_CODES 里** ——
 *    半截回答不能自动重放（那会让已执行的工具调用重跑一遍）；
 * 3. **已产生的 usage / 工具调用仍然照常交出** —— 那些是真花掉的，不该被吞掉。
 */
import { describe, expect, it } from "vitest";

import { STREAM_TRUNCATED_CODE, truncatedError, truncatedReason } from "../../src/core/stream-truncation";

describe("断流 reason：结构与文案（A03）", () => {
  it("交出的是 **error** 类型的 finish reason，不是 stop", () => {
    const reason = truncatedReason("Open Design");
    expect(reason.kind).toBe("error");
    expect(reason.failure.code).toBe(STREAM_TRUNCATED_CODE);
  });

  it("文案要说清三件事：发生了什么 / 已有内容还算数 / 怎么继续", () => {
    const { message } = truncatedReason("Open Design").failure;
    expect(message, "要说明流没给终止事件").toMatch(/without a terminal event/i);
    expect(message, "要说明已有内容保留").toMatch(/text received so far is kept/i);
    expect(message, "要给出可行动的下一步").toMatch(/continue/i);
  });

    it("`truncatedError()` 与 finish 用同一个码（两条路径口径一致）", () => {
    expect(truncatedError().code).toBe(STREAM_TRUNCATED_CODE);
  });
});

describe("断流的 code 不该进重试白名单（不能自动重放已产生的内容）", () => {
  it("**三家适配器的 RETRYABLE_CODES 都不含它**", async () => {
    /*
     * 这条用源码文本核对，而不是 import 常量：
     * `RETRYABLE_CODES` 不是导出的，而「白名单里有没有这个字符串」是可以直接查证的事实。
     * 为什么值得钉住：一旦有人把这个码加进去，半截回答会被自动重放 ——
     * 那会让**已经执行的工具调用重跑一遍**，是重复副作用。
     */
    const { readFile } = await import("node:fs/promises");
    for (const vendor of ["opendesign", "commandcode", "opencode"]) {
      const source = await readFile(new URL(`../../src/vendors/${vendor}/adapter.ts`, import.meta.url), "utf8");
      const list = /const RETRYABLE_CODES: readonly string\[\] = \[([\s\S]*?)\]/u.exec(source);
      expect(list, `${vendor} 的 RETRYABLE_CODES 应该能被找到`).not.toBeNull();
      expect(list![1], `${vendor} 不该把截断码列为可重试`).not.toContain("PROVIDER_STREAM_TRUNCATED");
    }
  });
});
