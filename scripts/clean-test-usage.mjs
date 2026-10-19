/**
 * 清掉台账里的**测试记录**（模型 id 恰好是 `m1` 的那些）。
 *
 * 背景（2026-10-19 实测）：装配测试会真的调用 `apply()`，而 `apply()` 里写的是
 * `usage: createUsagePort()` —— 生产采集端口、生产数据目录。于是每跑一次 `pnpm test`，
 * 假记录（账号 `PREFERRED_REF` / `OTHER_REF`、模型 `m1`）就落进用户真实台账。
 * 实测 831 条里 638 条是这样来的，把「今日总量」抬成一个纯属虚构的数。
 *
 * 修了两头：
 * 1. `tests/setup-usage-dir.ts` 用 `DSH_LLM_ACCOUNT_USAGE_DIR` 把测试指到临时目录（不再复发）；
 * 2. 这个脚本清理**已经写进去的**那一批。
 *
 * 判定只认一个事实：**模型的真实 id 绝不会是 `m1`**（测试夹具的占位名）。按账号名过滤是不
 * 安全的 —— 测试恰好复用了真实的默认槽名 `COMMANDCODE_API_KEY`。
 *
 * 用法（先备份、再清理，默认 dry-run）：
 *   node scripts/clean-test-usage.mjs            # 只统计，不改文件
 *   node scripts/clean-test-usage.mjs --apply    # 真的清理（自动写 .bak 备份）
 */
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 测试夹具用的占位模型名（真实厂商不会返回它）。 */
const TEST_MODEL = "m1";

/** 台账目录（与 `src/vendors/usage-store.ts` 的默认值一致）。 */
const DIR = process.env.DSH_LLM_ACCOUNT_USAGE_DIR ?? join(homedir(), ".dsh", "llm-account", "usage");

const apply = process.argv.includes("--apply");

const files = (await readdir(DIR)).filter((name) => name.startsWith("usage-") && name.endsWith(".jsonl"));
let kept = 0;
let dropped = 0;
const touched = [];

for (const name of files) {
  const path = join(DIR, name);
  const text = await readFile(path, "utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const keep = [];
  let removedHere = 0;
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // 半行（进程被杀时可能留下）：保留原样，不去猜它是什么。
      keep.push(line);
      kept += 1;
      continue;
    }
    if (record?.model === TEST_MODEL) {
      removedHere += 1;
      dropped += 1;
      continue;
    }
    keep.push(line);
    kept += 1;
  }
  if (removedHere === 0) continue;
  touched.push({ name, removedHere, kept: keep.length });
  if (!apply) continue;
  await copyFile(path, `${path}.bak`);
  await writeFile(path, keep.length === 0 ? "" : `${keep.join("\n")}\n`, "utf8");
}

console.log(`ledger: ${DIR}`);
console.log(`files scanned: ${files.length}, records kept: ${kept}, test records ${apply ? "removed" : "to remove"}: ${dropped}`);
for (const item of touched) console.log(`  ${item.name}: -${item.removedHere} (kept ${item.kept})`);
if (!apply && dropped > 0) console.log("\nre-run with --apply to rewrite the files (a .bak backup is written first)");
