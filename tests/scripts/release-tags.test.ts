/**
 * 发版脚本（`scripts/release.mjs`）里两个**纯 Git 行为**的回归测试。
 *
 * 这两个函数没有可注入的依赖（直接调 `git`），所以测试用**真实临时仓库**跑，
 * 不碰用户的工作树与远端。
 *
 * 钉住的是第四轮复审报出的两个缺陷：
 *
 * 1. **A02**：`git status --porcelain` 会给含空格的路径**加引号**，按行
 *    `slice(3)` 得到的字符串末尾是引号 —— `SECRET_FILE` 要求以 `.pem` 结尾，于是
 *    **漏检**被强制跟踪的凭据文件。正解是 `-z` + NUL 分隔（不加引号、不转义）。
 * 2. **A03**：`git describe --tags` 认**所有**标签，两个版本之间若有开发用临时
 *    tag，`--release-only` 会从那个 tag 起算，**漏掉中间的提交**。正解是
 *    `--match 'v[0-9]*'` 收窄 + 正则二次校验。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/** 建过的临时目录，用例结束统一删。 */
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 建一个临时 git 仓库并返回它的路径。
 * @returns 仓库绝对路径。
 */
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-release-"));
  created.push(dir);
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return dir;
}

/**
 * 在仓库里跑 git 并返回 stdout（去掉末尾换行）。
 * @param cwd - 仓库路径。
 * @param args - 参数。
 * @returns stdout。
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("A02：机密文件名扫描必须能识别含空格的路径", () => {
  /** 与 `release.mjs` 里的 `SECRET_FILE` 同一规则。 */
  const SECRET_FILE = /(^|\/)(\.env[^/]*|auth\.json|credentials[^/]*|.*\.pem|.*\.key|.*cookies.*\.(sqlite|db))$/i;

  it("**旧解析（按行 slice(3)）会漏掉**被强制跟踪的 `*.pem`", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, ".gitignore"), "*.pem\n");
    writeFileSync(join(repo, "src", "private key.pem"), "FAKE-MARKER-ONLY");
    git(repo, "add", ".gitignore");
    // `-f`：绕过 .gitignore 强制跟踪（模拟「曾经提交过的凭据文件」）。
    git(repo, "add", "-f", "src/private key.pem");
    git(repo, "commit", "-q", "-m", "initial");
    writeFileSync(join(repo, "src", "private key.pem"), "CHANGED-FAKE-MARKER");

    const porcelain = git(repo, "status", "--porcelain", "--untracked-files=all");
    // 这一行长这样：` M "src/private key.pem"`（带引号）。
    const parsed = porcelain
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(3).trim());
    // 真实代码就是这样 `slice(3).trim()`：trim 吃掉**开头**的引号与空格，但**末尾**
    // 那个引号留着 —— 于是 `SECRET_FILE` 的 `$` 锚点对不上 `.pem`。
    expect(parsed, "末尾带着引号，正则 $ 锚点因此失配").toEqual(['src/private key.pem"']);
    expect(
      parsed.filter((path) => SECRET_FILE.test(path)),
      "旧解析漏检 —— 这就是 A02",
    ).toEqual([]);
  });

  it("**新解析（-z + NUL）能正确识别**", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, ".gitignore"), "*.pem\n");
    writeFileSync(join(repo, "src", "private key.pem"), "FAKE-MARKER-ONLY");
    git(repo, "add", ".gitignore");
    git(repo, "add", "-f", "src/private key.pem");
    git(repo, "commit", "-q", "-m", "initial");
    writeFileSync(join(repo, "src", "private key.pem"), "CHANGED-FAKE-MARKER");

    // 与 `statusPaths()` 的解析一致：NUL 分隔，每条记录前两位是状态。
    const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: repo,
      encoding: "utf8",
    });
    const parts = raw.split("\u0000");
    const paths: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const record = parts[index];
      if (record === undefined || record.length < 4) continue;
      const status = record.slice(0, 2);
      paths.push(record.slice(3));
      if (status.includes("R") || status.includes("C")) index += 1;
    }

    expect(paths, "不加引号").toEqual(["src/private key.pem"]);
    expect(
      paths.filter((path) => SECRET_FILE.test(path)),
      "新解析能拦住",
    ).toEqual(["src/private key.pem"]);
  });

  it("重命名记录也被正确消费（不会多出一条假路径）", () => {
    const repo = tempRepo();
    writeFileSync(join(repo, "a.txt"), "x");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "initial");
    git(repo, "mv", "a.txt", "b.txt");

    const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: repo,
      encoding: "utf8",
    });
    const parts = raw.split("\u0000");
    const paths: string[] = [];
    let sawRename = false;
    for (let index = 0; index < parts.length; index += 1) {
      const record = parts[index];
      if (record === undefined || record.length < 4) continue;
      const status = record.slice(0, 2);
      paths.push(record.slice(3));
      if (status.includes("R") || status.includes("C")) {
        sawRename = true;
        index += 1;
      }
    }
    // 重命名时只有一条「新路径」，原路径被跳过（否则会把它当成待提交文件）。
    expect(sawRename).toBe(true);
    expect(paths).toEqual(["b.txt"]);
  });
});

describe("A03：前一个发布 tag 必须只认版本号形态", () => {
  /**
   * 造出「两个版本之间夹一个开发 tag」的历史。
   * @returns 仓库路径。
   */
  function repoWithScratchTag(): string {
    const repo = tempRepo();
    const step = (message: string, tag: string): void => {
      writeFileSync(join(repo, "sample.txt"), message);
      git(repo, "add", "sample.txt");
      git(repo, "commit", "-q", "-m", message);
      git(repo, "tag", tag);
    };
    step("feat: base", "v1.0.0");
    step("feat: important change", "scratch-tag");
    step("fix: last change", "v1.1.0");
    return repo;
  }

  it("**`git describe --tags` 会被临时 tag 干扰**（原缺陷）", () => {
    const repo = repoWithScratchTag();
    const picked = git(repo, "describe", "--tags", "--abbrev=0", "v1.1.0^");
    expect(picked, "选中了开发用 tag").toBe("scratch-tag");

    const subjects = git(repo, "log", "--format=%s", `scratch-tag..v1.1.0`).split("\n").filter(Boolean);
    expect(subjects, "重要提交从范围里消失").toEqual(["fix: last change"]);
  });

  it("**`--match 'v[0-9]*'` 能跳过临时 tag**（修复后）", () => {
    const repo = repoWithScratchTag();
    const pivked = git(repo, "describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", "v1.1.0^");
    expect(pivked, "正确选中上一个版本 tag").toBe("v1.0.0");

    const subjects = git(repo, "log", "--format=%s", `v1.0.0..v1.1.0`).split("\n").filter(Boolean);
    expect(subjects, "两条提交都在").toEqual(["fix: last change", "feat: important change"]);
  });

  it("版本 tag 的形态校验", () => {
    /** 与 `previousTagOf` 里的 `RELEASE_TAG` 同一条正则。 */
    const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
    for (const tag of ["v1.0.0", "v1.5.3", "v2.0.0-rc.1"]) {
      expect(RELEASE_TAG.test(tag), tag).toBe(true);
    }
    // 注意 `v1.0.0-backup` **会**匹配（后缀允许字母）—— 那是有意的：它长得像预发布版，
    // 宁可多算一次范围也不要漏掉提交。真正的反例是「明显不是版本号」的那些。
    for (const tag of ["scratch-tag", "backup-before-scrub-2026", "v1", "release-notes"]) {
      expect(RELEASE_TAG.test(tag), tag).toBe(false);
    }
  });
});
