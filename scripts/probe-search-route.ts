/**
 * 一次性诊断脚本：按**真实链路**验证「API 优先」到底走没走通。
 *
 * 它做的事与插件运行时一致：
 *   1. 读设置文档里的 `searchApiKeyRefs`（= 用户在界面里添加的那份列表）；
 *   2. 按引用名从凭据库解析出真 key；
 *   3. 用 `chooseSearchRoute` 判定该走哪条路；
 *   4. 若走 API，就真的发一次 `POST /v1/tools/search`。
 *
 * 不打印任何密钥明文。
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { chooseSearchRoute } from "../src/core/switching/search-route";
import { normalizeSearchKeyRefs } from "../src/core/switching/search-keys";
import { searchViaApi } from "../src/vendors/search-api";

/** 极简 YAML 读取：只认「refs: 」下面那层的 `NAME: value` 行（凭据库就是这个形状）。 */
async function readCredentialRefs(): Promise<Map<string, string>> {
  const path = join(homedir(), ".dsh", ".credentials.yaml");
  const text = await readFile(path, "utf8");
  const map = new Map<string, string>();
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
    map.set(match[1]!, match[2]!.trim().replace(/^["']|["']$/g, ""));
  }
  return map;
}

async function main(): Promise<void> {
  const refs = await readCredentialRefs();
  console.log(`凭据库里的引用名（${refs.size} 条）：`);
  for (const [ref, value] of refs) {
    const looksLikeKey = value.startsWith("sk-");
    const hasCjk = /[\u4e00-\u9fff]/.test(value);
    const verdict = looksLikeKey ? "像 DeepSeek key" : hasCjk ? "**含中文，不像 key**" : "不像 key";
    console.log(`  - ${ref}: 长度 ${value.length}，${verdict}`);
  }

  // 设置文档里用户添加的列表（来自 desktop profile）。
  const configured = ["DEEPSEEK_API_KEY"];
  console.log(`\n设置文档 searchApiKeyRefs = ${JSON.stringify(configured)}`);

  const resolved: { ref: string; key: string }[] = [];
  for (const ref of normalizeSearchKeyRefs(configured)) {
    const key = refs.get(ref);
    if (key !== undefined) resolved.push({ ref, key });
  }
  console.log(`能解析到的 key：${resolved.length} 条`);

  const route = chooseSearchRoute({
    provider: "opendesign",
    model: "deepseek-v4.1-flash",
    strategy: "api-first",
    hasApiKey: resolved.length > 0,
    hasGateway: true,
  });
  console.log(`策略 api-first 的判定：${JSON.stringify(route)}`);

  if (route.kind !== "api") {
    console.log("→ 没有走 API 路，不再发请求。");
    return;
  }

  for (const item of resolved) {
    console.log(`\n用 ${item.ref} 发一次真实请求…`);
    try {
      const result = await searchViaApi({
        query: "DeepSeek 最新模型",
        key: item.key,
        maxResults: 3,
        fetchImpl: fetch,
      });
      console.log(`  成功：${result.sources.length} 条结果`);
      for (const source of result.sources.slice(0, 3)) console.log(`   - ${source.title} | ${source.url}`);
    } catch (error) {
      console.log(`  失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await main();
