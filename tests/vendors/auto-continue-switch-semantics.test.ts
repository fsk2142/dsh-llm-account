/**
 * 自动继续开关的**真实语义**（2026-11-12）。
 *
 * ## 这个文件是审计发现的，不是猜的
 *
 * 排查时实测（`tests/_probe-default.test.ts`）确认：`schemastery` 的
 * `z.boolean().default(false)` 在解析后**会把字段填成 `false`** ——
 * `Object.hasOwn` 永远为 `true`：
 *
 * ```
 * parsed: {"autoContinue":false,"autoContinueOnTruncate":true}
 * hasOwn(autoContinue): true
 * ```
 *
 * 也就是说：**在 `document()`（已解析）上做「显式 vs 缺失」的判断是不可能的** ——
 * 「用户没配过」和「用户显式关着」在解析后长得一模一样。
 *
 * commandcode 之所以能区分，是因为它额外读了一份**原始文档**（`rawDocument`，
 * 从设置服务直接读、未经 schema 解析），再用 `Object.hasOwn` 判「用户到底写过没有」。
 * 另两家没有那一份 —— 所以 `autoContinueEnabledOf` 在它们上面必须先拿原始文档。
 *
 * ## 这条用例固定什么
 *
 * 1. 解析后的对象上，`hasOwn` 无法区分「没配过」与「显式 false」；
 * 2. `autoContinueEnabledOf` 的判定在**原始文档**上才是正确的；
 * 3. 缺原始文档时**保守回落**：不因为「解析后 autoContinue 存在」就否掉旧字段，
 *    否则升级用户的旧配置会被静默关掉。
 */
import { expect, it } from "vitest";

import z from "@deepseek-ai/schemastery";

import { autoContinueEnabledOf } from "../../src/vendors/auto-continue-wiring";

/** 与三家 schema 同形的开关定义。 */
const SWITCHES = z.object({
  autoContinue: z.boolean().default(false),
  autoContinueOnError: z.boolean(),
  autoContinueOnTruncate: z.boolean(),
});

it("**解析后 `hasOwn` 恒为真**（所以不能在 document() 上判「用户写过没有」）", () => {
  const parsed = SWITCHES({ autoContinueOnTruncate: true }) as Record<string, unknown>;
  expect(Object.hasOwn(parsed, "autoContinue"), "default 会被填上，hasOwn 永远 true").toBe(true);
  expect(parsed["autoContinue"], "而且值是 false —— 与「用户显式关着」完全同形").toBe(false);
});

it("在**原始文档**上判定才是对的：旧字段能开启", () => {
  // 用户只写过旧字段（升级场景）。
  expect(autoContinueEnabledOf({ autoContinueOnTruncate: true })).toBe(true);
});

it("在原始文档上，显式 `false` 仍然优先于旧字段", () => {
  expect(autoContinueEnabledOf({ autoContinue: false, autoContinueOnTruncate: true }, { authoritative: true })).toBe(false);
});

it("**解析后的对象不该被当成原始文档**：旧字段仍要能开启", () => {
  /*
   * 这条是给「调用方误传 parsed」兜底的：parsed 里 autoContinue 恒存在，
   * 若据它否掉旧字段，升级用户会发现「以前开着的自动继续突然关了」。
   *
   * 所以 `autoContinueEnabledOf` 的判据是**值**而不是 hasOwn —— 只有显式 `false`
   * **且**旧字段全没开时才是关。
   */
  const parsed = SWITCHES({ autoContinueOnTruncate: true }) as Record<string, unknown>;
  expect(autoContinueEnabledOf(parsed), "旧字段为 true 时不能因为 autoContinue 被填成 false 而判关").toBe(true);
});
