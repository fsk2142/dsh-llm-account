/**
 * 自动版本号（`scripts/next-version.mjs`）的规则测试。
 *
 * 用户 2026-10-21 问「版本号怎么推进」，并要求把「自动版本」也做了。
 *
 * 这里钉住三件容易搞错的事：
 * 1. **MAJOR 的判据是「会不会让老用户出问题」**，不是「改动大不大」——
 *    重构后对外行为不变就只是内部变化（`refactor:` 不抬版本）；
 * 2. **`0.x` 特例**：主版本为 0 时破坏性变更抬 MINOR（`0.2.0 → 0.3.0`），
 *    不假装 API 已稳定（SemVer 规范第 4 条）；
 * 3. **`!` 与 `BREAKING CHANGE:` 页脚两种写法都认**。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// `.mjs` 没有类型声明：显式给一个形状，避免 tsc 把它当 any 漏检。
type NextVersion = (options: { cwd: string }) => {
  current: string;
  next: string;
  level: string;
  counts: Record<string, number>;
  total: number;
};
const { nextVersion } = (await import("../../scripts/next-version.mjs")) as { nextVersion: NextVersion };

/**
 * 造一个临时仓库：给定初始版本与一串提交首行。
 * @param version - package.json 的 version。
 * @param subjects - 每行一个提交首行（可带 `\n\n正文`）。
 * @returns 仓库目录。
 */
function repoWith(version: string, subjects: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-ver-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "x", version }, null, 2)}\n`, "utf8");
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  };
  git("init", "-q");
  git("config", "user.email", "user@example.com");
  git("config", "user.name", "Sample Author");
  writeFileSync(join(dir, "seed.txt"), "seed\n", "utf8");
  git("add", ".");
  git("commit", "-q", "-m", "chore: seed");
  for (const subject of subjects) {
    // 每个提交改一个不同文件，避免「没有改动」被 git 拒绝。
    writeFileSync(join(dir, `f-${Math.random().toString(36).slice(2)}.txt`), "x\n", "utf8");
    git("add", ".");
    git("commit", "-q", "-m", subject);
  }
  return dir;
}

describe("next-version：按 conventional commits 抬版本", () => {
  it("只有 `fix:` → PATCH", () => {
    const dir = repoWith("1.2.3", ["fix: 修一个 bug", "fix: 再修一个"]);
    const result = nextVersion({ cwd: dir });
    expect(result.level).toBe("patch");
    expect(result.next).toBe("1.2.4");
  });

  it("有任意 `feat:` → MINOR（压过 patch）", () => {
    const dir = repoWith("1.2.3", ["fix: 修 bug", "feat: 新功能", "fix: 又一个"]);
    const result = nextVersion({ cwd: dir });
    expect(result.level).toBe("minor");
    expect(result.next).toBe("1.3.0");
  });

  it("`feat!:` → MAJOR", () => {
    const dir = repoWith("1.2.3", ["feat!: 删掉一个公开接口"]);
    expect(nextVersion({ cwd: dir }).next).toBe("2.0.0");
  });

  it("`BREAKING CHANGE:` 页脚 → MAJOR", () => {
    const dir = repoWith("1.2.3", ["fix: 改了配置格式\n\nBREAKING CHANGE: 旧配置不再支持"]);
    expect(nextVersion({ cwd: dir }).next).toBe("2.0.0");
  });

  it("**`0.x` 里破坏性变更抬 MINOR**，不假装 API 已稳定", () => {
    // SemVer 规范第 4 条：主版本为 0 时公开 API 不稳定。抬到 1.0.0 会暗示
    // 「从此不再破坏兼容」—— 那是我们还没准备好的承诺。
    const dir = repoWith("0.2.0", ["feat!: 破坏性变更"]);
    expect(nextVersion({ cwd: dir }).next).toBe("0.3.0");
  });

  it("只有 `chore:` / `docs:` / `refactor:` → 不抬版本", () => {
    // 「大重构」如果对外行为不变，就只是内部变化 —— 这是 MAJOR 最常被误解的地方。
    const dir = repoWith("1.2.3", ["chore: 清理", "docs: 文档", "refactor: 重写内部实现"]);
    const result = nextVersion({ cwd: dir });
    expect(result.level).toBe("none");
    expect(result.next).toBe("1.2.3");
  });

  it("中文冒号 `：` 也认（本仓库的提交信息里两种都有）", () => {
    const dir = repoWith("1.2.3", ["feat：新功能"]);
    expect(nextVersion({ cwd: dir }).next).toBe("1.3.0");
  });

  it("**起点 tag 存在时从 tag 算**，只计入 tag 之后的提交", () => {
    // 这是 RELEASING.md 写的正常路径：`v<当前版本>` 是上次发版的 tag。
    // 2026-10-21 发 0.2.1 时踩到：这条路径引用了一个不存在的变量 `base`，
    // 只要 tag 在就抛 `ReferenceError: base is not defined`，脚本根本跑不完。
    // 而「tag 不存在」的兜底分支不受影响，所以此前的测试（临时仓库没有 tag）
    // 一直全绿，把这个 bug 漏了过去。
    const dir = repoWith("1.2.3", []);
    const git = (...args: string[]): void => {
      execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
    };
    git("tag", "v1.2.3");
    // 打过 tag 之后才有的提交：一个 feat。
    writeFileSync(join(dir, "after.txt"), "x\n", "utf8");
    git("add", ".");
    git("commit", "-q", "-m", "feat: tag 之后的新功能");
    const result = nextVersion({ cwd: dir });
    // 只按 tag 之后的 feat 抬 MINOR；tag 之前那个 `chore: seed` 不参与。
    expect(result.next).toBe("1.3.0");
    expect(result.total).toBe(1);
  });
});
