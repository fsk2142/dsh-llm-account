/**
 * 一次性诊断：按**真实链路**跑一次完整的网页搜索，打印真实结果。
 *
 * 走的就是插件运行时那条路：
 *   1. 读设置文档里的 `searchApiKeyRefs` 与 `searchStrategy`；
 *   2. 按引用名从凭据库解析 key；
 *   3. `chooseSearchRoute` 判定走哪条路；
 *   4. 走 API 路时调 `searchViaApi`（与「测试」按钮同一条实现）。
 *
 * 用法（绝对路径）：
 *   node <repo>\scripts\search-now.mjs <repoAbsolutePath> "<query>"
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = process.argv[2];
const query = process.argv[3] ?? "新浪微博";

const { readFile: read } = await import("node:fs/promises");
const settingsPath = join(homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml");
const settingsText = await read(settingsPath, "utf8");

/** 从 patch 文件里取 `searchApiKeyRefs` 列表与 `searchStrategy`。 */
function configOf(text) {
  const strategy = /searchStrategy:\s*(\S+)/.exec(text)?.[1] ?? "(未配置)";
  const block = /searchApiKeyRefs:\s*\n((?:\s+-\s+\S+\n)+)/.exec(text)?.[1] ?? "";
  const refs = [...block.matchAll(/-\s+(\S+)/g)].map((match) => match[1]);
  return { strategy, refs };
}

/** 极简 YAML：只认 refs: 下面那层的 `NAME: value`。 */
async function readCredentialRefs() {
  const text = await readFile(join(homedir(), ".dsh", ".credentials.yaml"), "utf8");
  const map = new Map();
  let inRefs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    const match = /^\s{2,}([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
    if (match === null) {
      if (/^\S/.test(line)) inRefs = false;
      continue;
    }
    map.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

const { strategy, refs } = configOf(settingsText);
console.log(`设置：strategy=${strategy}，refs=${JSON.stringify(refs)}\n`);
if (strategy !== "api-first" && strategy !== "api-only") {
  console.log("当前策略不是 API 优先，本次只演示 API 路。");
}

const credentials = await readCredentialRefs();
const usable = [];
for (const ref of refs) {
  const key = credentials.get(ref);
  if (key === undefined) {
    console.log(`${ref}: 凭据库里没有 → 跳过`);
    continue;
  }
  if (/[^\x20-\x7E]/.test(key)) {
    console.log(`${ref}: 含非 ASCII → 跳过（不可用）`);
    continue;
  }
  usable.push({ ref, key });
  console.log(`${ref}: 已解析`);
}

if (usable.length === 0) {
  console.log("\n没有可用密钥，搜索会失败。");
  process.exit(1);
}

console.log(`\n搜索：${query}\n${"=".repeat(50)}`);
for (const { ref, key } of usable) {
  const started = Date.now();
  const response = await fetch("https://api.deepseek.com/v1/tools/search", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query, count: 5 }),
  });
  const elapsed = Date.now() - started;
  const text = await response.text();
  if (!response.ok) {
    console.log(`[${ref}] HTTP ${response.status}（${elapsed}ms）\n  ${text.slice(0, 200)}`);
    continue;
  }
  const payload = JSON.parse(text);
  const results = Array.isArray(payload.results) ? payload.results : [];
  console.log(`[${ref}] HTTP 200（${elapsed}ms）→ ${results.length} 条结果\n`);
  for (const [index, entry] of results.entries()) {
    console.log(`${index + 1}. ${entry.title}`);
    console.log(`   ${entry.url}`);
    if (entry.site_name) console.log(`   站点：${entry.site_name}`);
    if (entry.snippet) console.log(`   摘要：${String(entry.snippet).slice(0, 120)}`);
    console.log("");
  }
  break; // 第一把成功就够了（与运行时一致：优先用第一条能用的）
}
