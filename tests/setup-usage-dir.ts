/**
 * 测试全局前置：把用量台账指到**临时目录**。
 *
 * 为什么必须有这个文件：`src/vendors/*\/index.ts` 的 `apply()` 里写着
 * `usage: createUsagePort()` —— 那就是**生产**采集端口，落盘到 `~/.dsh/llm-account/usage`。
 * 装配测试会真的调 `apply()` 并跑完一轮流，于是假记录（模型 `m1`、账号 `PREFERRED_REF`）
 * 被写进用户真实台账。2026-10-19 实测：831 条里 638 条是测试垃圾，界面上「今日总量」
 * 因此是一个纯属虚构的数，且会盖过真实用量。
 *
 * 这里在**任何模块加载之前**设好环境变量（vitest 的 setupFiles 早于测试文件的 import），
 * `defaultUsageRoot()` 读它。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env["DSH_LLM_ACCOUNT_USAGE_DIR"] = mkdtempSync(join(tmpdir(), "dsh-llm-account-usage-"));
