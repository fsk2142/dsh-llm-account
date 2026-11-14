/**
 * 搜索能力已经**整体移交给宿主**（2026-11-14）。
 *
 * ## 这条用例钉住的是「不回归」，不是「有这个功能」
 *
 * 历史：本插件曾经承载网页搜索 —— 注册 provider、选路（网关 / API key）、
 * 维护搜索密钥的引用名列表、实测密钥可用性。那套东西有 6 个源模块 + 10 个测试文件。
 *
 * 2026-11-14 用户要求「官方的网页搜索功能已经更新，现在从我们的这个插件里面剥离
 * 网页搜索的功能」。剥离之后，**这四件事一条都不能再用代码把它引回来**：
 *
 * 1. 设置卡里不能再有 `search` 卡；
 * 2. 三家 schema 里不能再有 `searchStrategy` / `searchApiKeyRefs`；
 * 3. 不能再往宿主 `web` 服务注册搜索 provider（注册了就会和官方那个撞
 *    `WEB_DUPLICATE_PROVIDER`，或抢走官方的搜索）；
 * 4. 远端面不能再暴露 `probeSearchCredential`（那是搜索密钥专用的实测通道）。
 *
 * ## 为什么用例要检查「源码文本」
 *
 * 这些属性是**装配事实**而不是某个函数返回值：只要 `src` 里还留着一句
 * `registerSearchProvider(...)`，宿主就可能真的多一个 provider。跑一遍插件是唯一
 * 更可靠的验证方式，但它需要真实宿主；在单测里用源码文本核对是第二可靠的做法，
 * 而且能让「有人日后顺手加回来」这件事当场变红。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS_CARDS } from "../../src/client/settings-cards";

/** 递归收集 `.ts` 源文件（相对仓库根）。 */
function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(path.replace(/\\/gu, "/"));
  }
  return out;
}

/** 全部源码文本（按文件分组，便于给出准确的失败信息）。 */
const SOURCES = sourceFiles("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));

describe("网页搜索已移交宿主：不得回归", () => {
  it("**设置页没有搜索卡**（剥离后卡片只剩显示 / 切换 / 高级）", () => {
    expect(SETTINGS_CARDS.map((card) => card.id)).toEqual(["display", "switching", "advanced"]);
  });

  it("**三家 schema 都不再有搜索字段**", () => {
    for (const vendor of ["commandcode", "opendesign", "opencode"]) {
      const text = readFileSync(`src/vendors/${vendor}/index.ts`, "utf8");
      expect(text, `${vendor} 的 schema 里不该再有 searchStrategy`).not.toContain("searchStrategy:");
      expect(text, `${vendor} 的 schema 里不该再有 searchApiKeyRefs`).not.toContain("searchApiKeyRefs:");
    }
  });

  it("**源码里没有任何一处注册搜索 provider**（否则会和官方那个撞）", () => {
    const offenders = SOURCES.filter(({ text }) => text.includes("registerSearchProvider(")).map(({ file }) => file);
    expect(offenders, "注册搜索 provider 会与宿主官方实现冲突").toEqual([]);
  });

  it("**源码里没有 applySearch / 搜索槽位同步**", () => {
    const offenders = SOURCES.filter(
      ({ text }) => text.includes("applySearch(") || text.includes("createSearchSlotSync("),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("**远端面不再暴露搜索密钥实测**", () => {
    const offenders = SOURCES.filter(
      ({ text }) => text.includes("probeSearchCredential") || text.includes("probeSearchKey"),
    ).map(({ file }) => file);
    expect(offenders, "搜索密钥实测通道是搜索专用，剥离后不该留").toEqual([]);
  });

  it("**6 个搜索源模块都已删除**（不是留着不用）", () => {
    const gone = [
      "src/core/switching/search-keys.ts",
      "src/core/switching/search-route.ts",
      "src/vendors/search-api.ts",
      "src/vendors/search-provider.ts",
      "src/vendors/search-release.ts",
      "src/vendors/search.ts",
      "src/vendors/gateway-access.ts",
    ];
    const still = gone.filter((file) => {
      try {
        readFileSync(file, "utf8");
        return true;
      } catch {
        return false;
      }
    });
    expect(still, "这些模块只服务搜索，应当随搜索一起删除").toEqual([]);
  });
});
