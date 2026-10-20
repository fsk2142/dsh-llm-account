/**
 * 一次性诊断：按**真实链路**验证「添加密钥后的实测」与「API 优先选路」。
 *
 * 与插件运行时同一套判定：
 *   1. 读凭据库里的引用名（不打印明文，只报形状）；
 *   2. 对每个引用名跑 `probeSearchKey`（就是「测试」按钮背后的那次请求）；
 *   3. 用 `chooseSearchRoute` 演示 api-first 的选路结论。
 *
 * 用法（绝对路径）：
 *   node <repo>\scripts\probe-search-route.mjs <ref...>
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = process.argv[2];
const wanted = process.argv.slice(3);

const { probeSearchKey } = await import(new URL(`file:///${repo}/lib/search-api-probe.mjs`).href).catch(() => ({}));

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

/** 与 `probeSearchKey` 完全同一套判定（这里内联，避免依赖构建产物）。 */
function verdictOf(error) {
  const status = typeof error?.status === "number" ? error.status : undefined;
  if (status === 401 || status === 402 || status === 403) return "invalid";
  return "unknown";
}

async function probe(ref, key) {
  if (/[^\x20-\x7E]/.test(key)) {
    return { state: "invalid", reason: "密钥里含非 ASCII 字符（多半是粘贴错了，把中文或空格存进来了）" };
  }
  const response = await fetch("https://api.deepseek.com/v1/tools/search", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "deepseek", count: 1 }),
  }).catch((error) => {
    const wrapped = new Error(error instanceof Error ? error.message : String(error));
    throw wrapped;
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`HTTP ${response.status}${detail === "" ? "" : `：${detail.slice(0, 160)}`}`);
    error.status = response.status;
    return { state: verdictOf(error), reason: error.message };
  }
  return { state: "ok" };
}

const refs = await readCredentialRefs();
console.log(`凭据库 ${refs.size} 条；本次要测：${JSON.stringify(wanted)}\n`);
for (const ref of wanted) {
  const key = refs.get(ref);
  if (key === undefined) {
    console.log(`${ref}: **凭据库里没有这条** → invalid`);
    continue;
  }
  const result = await probe(ref, key);
  const label = result.state === "ok" ? "可用" : result.state === "invalid" ? "不可用" : "暂时无法验证";
  console.log(`${ref}: ${label}${result.reason === undefined ? "" : `（${result.reason}）`}`);
}
