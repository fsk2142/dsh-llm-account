/**
 * 发布文档的**安全回归测试**（第六轮复审 V55-02）。
 *
 * ## 为什么需要它
 *
 * v1.5.1 把「全量暂存」改成白名单暂存、v1.5.4 把「推送全部标签」改成只推目标
 * tag。但 `docs/RELEASING.md` 的**手工发版**章节一直在教那两个旧做法 ——
 *
 * 而那一章正是给「脚本不可用时」用的。也就是说：真出问题时，用户会去看文档、
 * 然后**用回我刚封堵的做法**。
 *
 * 这不是靠记性维持的：这里把「文档里不许出现哪些命令」变成断言。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** 仓库根目录（本文件在 `tests/scripts/` 下）。 */
const root = join(import.meta.dirname, "..", "..");

/**
 * 读文档。
 * @param relative - 相对仓库根的路径。
 * @returns 文本。
 */
function doc(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

describe("docs/RELEASING.md 不教危险操作（V55-02）", () => {
  /** 手工发版章节（存在时才有意义）。 */
  const releasing = doc("docs/RELEASING.md");

  it("**没有「全量暂存」的命令字面量**", () => {
    // 允许在「为什么不能这么做」的说明里出现词，但不允许出现可复制的命令。
    expect(releasing, "文档不该出现全量暂存命令（会带上工作树里所有非忽略文件）").not.toMatch(/git\s+add\s+-A\b/u);
  });

  it("**没有「推送全部标签」的命令字面量**", () => {
    // `git push --tags` / `git push origin main --tags` 都会把无关标签推上去。
    expect(releasing, "文档不该出现推送全部标签的命令").not.toMatch(/git\s+push[^\n]*--tags\b/u);
  });

  it("手工流程给的是**白名单暂存**与**只推目标 tag**", () => {
    expect(releasing, "应有显式路径的 git add --").toMatch(/git\s+add\s+--\s+package\.json/u);
    expect(releasing, "应只推目标 tag").toMatch(/git\s+push\s+--atomic\s+origin\s+main\s+refs\/tags\//u);
  });

  it("补建 Release 的示例用 `--release-only`", () => {
    expect(releasing, "补建必须带 --release-only（否则会走完整发版）").toMatch(/--release-only\s+v/u);
  });
});

describe("README 的配置字段与 schema 一致", () => {
  /** README 文本。 */
  const readme = doc("README.md");

  it("文档提到的自动重试字段都是现行 schema 里的", () => {
    /**
     * 旧字段（`autoContinueOnError` / `autoContinueOnTruncate`）只允许出现在
     * **迁移章节**里，不能作为推荐配置项出现。
     *
     * 判定方式：找到旧字段所在的表格/段落，看它附近有没有「旧」「迁移」「已废弃」
     * 这类标记 —— 单看那一行不够（表格行的文字往往只有「并入 xxx」）。
     */
    const lines = readme.split("\n");
    const legacyFields = ["autoContinueOnError", "autoContinueOnTruncate"];
    for (const field of legacyFields) {
      const index = lines.findIndex((line) => line.includes(`\`${field}\``));
      expect(index, `README 提到了 ${field}`).toBeGreaterThanOrEqual(0);
      // 往上找 3 行、往下找 1 行，够覆盖「### 迁移」标题 + 表头。
      const context = lines.slice(Math.max(0, index - 3), index + 2).join("\n");
      expect(
        /旧|迁移|已废弃|并入/u.test(context),
        `README 把 ${field} 当成现行配置了 —— 它是 v1.4.0 之前的旧字段，只该出现在迁移说明里`,
      ).toBe(true);
    }
  });

  it("现行字段都在", () => {
    for (const field of ["autoContinue", "autoContinueMaxAttempts", "autoContinueIntervalMs"]) {
      expect(readme, `README 应说明 ${field}`).toContain(field);
    }
  });
});
