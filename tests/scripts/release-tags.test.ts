/**
 * 发版脚本的**纯 Git 逻辑**回归测试。
 *
 * ## 为什么这个文件必须 import 生产模块
 *
 * 上一版把 `statusPaths` / `previousTagOf` 的解析逻辑**复制**进测试文件，然后
 * 测那个副本。结果：把 `release.mjs` 里的 `-z` 删掉、把 `--match` 删掉，测试
 * 照样 6/6 全绿 —— 一条都防不住回归（第五轮复审 F03，已实测确认）。
 *
 * 现在逻辑住在 `scripts/release-git.mjs`（可 import），测试直接调用**同一份实现**。
 * 被测代码一改，这里就会红。
 *
 * 钉住三个历史缺陷：
 * - **A02**：`git status --porcelain` 会给含空格的路径加引号 → 必须用 `-z`；
 * - **F02**：重命名记录的**源路径**要一起审计（只看目标会漏掉敏感来源）；
 * - **F01/A03**：`git describe --tags` 会被非发布标签干扰，且「只取最近一个再过滤」
 *   会在最近候选不合规时错误地返回「没有前一个版本」。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// **直接 import 生产实现** —— 这是本文件存在的意义。
import { previousTagOf, statusEntries, statusPaths } from "../../scripts/release-git.mjs";

/** 与 `release.mjs` 的机密文件规则一致（仅用于断言，不复制被测逻辑）。 */
const SECRET_FILE = /(^|\/)(\.env[^/]*|auth\.json|credentials[^/]*|.*\.pem|.*\.key|.*cookies.*\.(sqlite|db))$/i;

/** 建过的临时目录，用例结束统一删。 */
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 建一个临时 git 仓库。
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
 * 在仓库里跑 git。
 * @param cwd - 仓库路径。
 * @param args - 参数。
 * @returns stdout（已 trim）。
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * 追加一个提交并打 tag。
 * @param cwd - 仓库路径。
 * @param message - 提交信息。
 * @param tag - 标签（可选）。
 */
function commitAs(cwd: string, message: string, tag?: string): void {
  writeFileSync(join(cwd, "sample.txt"), message);
  git(cwd, "add", "sample.txt");
  git(cwd, "commit", "-q", "-m", message);
  if (tag !== undefined) git(cwd, "tag", tag);
}

describe("statusPaths：路径解析（A02 / F02）", () => {
  it("含空格的受控 `.pem` 能被识别（**-z 的必要性**）", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, ".gitignore"), "*.pem\n");
    writeFileSync(join(repo, "src", "private key.pem"), "FAKE-MARKER-ONLY");
    git(repo, "add", ".gitignore");
    git(repo, "add", "-f", "src/private key.pem");
    git(repo, "commit", "-q", "-m", "initial");
    writeFileSync(join(repo, "src", "private key.pem"), "CHANGED-FAKE-MARKER");

    // 生产实现（-z，不加引号）应当原样取出路径。
    const paths = statusPaths(repo);
    expect(paths).toContain("src/private key.pem");
    expect(
      paths.filter((path) => SECRET_FILE.test(path)),
      "含空格的 .pem 必须被扫到",
    ).toEqual(["src/private key.pem"]);

    // 对照：按行 + `slice(3).trim()` 的旧解析会留下末尾引号 → 漏检。
    const porcelain = git(repo, "status", "--porcelain", "--untracked-files=all");
    const naive = porcelain
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(3).trim());
    expect(
      naive.filter((path) => SECRET_FILE.test(path)),
      "旧解析漏检（这就是当初的 A02）",
    ).toEqual([]);
  });

  it("**重命名的源路径也要被审计**（F02）", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "private.pem"), "FAKE-MARKER");
    git(repo, "add", "src/private.pem");
    git(repo, "commit", "-q", "-m", "initial");
    git(repo, "mv", "src/private.pem", "src/public.txt");

    const entries = statusEntries(repo);
    const renamed = entries.find((entry) => entry.path === "src/public.txt");
    expect(renamed?.from, "记录里带着源路径").toBe("src/private.pem");

    const paths = statusPaths(repo);
    expect(paths, "源与目标两端都在").toContain("src/public.txt");
    expect(paths, "源路径必须保留（只看目标会漏掉敏感来源）").toContain("src/private.pem");
    expect(
      paths.filter((path) => SECRET_FILE.test(path)),
      "改名成 public.txt 也逃不掉",
    ).toEqual(["src/private.pem"]);
  });

  it("普通文件不会误报", () => {
    const repo = tempRepo();
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "notes.txt"), "hello");
    const paths = statusPaths(repo);
    expect(paths).toContain("src/notes.txt");
    expect(paths.filter((path) => SECRET_FILE.test(path))).toEqual([]);
  });
});

describe("previousTagOf：基线选择（F01 / A03）", () => {
  it("跳过非发布形态的 tag（A03）", () => {
    const repo = tempRepo();
    commitAs(repo, "feat: base", "v1.0.0");
    commitAs(repo, "feat: important change", "scratch-tag");
    commitAs(repo, "fix: last change", "v1.1.0");

    expect(previousTagOf(repo, "v1.1.0")).toBe("v1.0.0");
    const subjects = git(repo, "log", "--format=%s", "v1.0.0..v1.1.0").split("\n").filter(Boolean);
    expect(subjects, "两条提交都在范围内").toEqual(["fix: last change", "feat: important change"]);
  });

  it("**最近候选不合规时继续往前找**（F01-A）", () => {
    const repo = tempRepo();
    commitAs(repo, "feat: baseline", "v1.0.0");
    commitAs(repo, "feat: important-change", "v9-staging");
    commitAs(repo, "fix: final-change", "v1.1.0");

    // 旧实现只 describe 一次 → 拿到 v9-staging → 正则拒绝 → 返回 undefined（漏掉 v1.0.0）。
    expect(previousTagOf(repo, "v1.1.0"), "必须回退到 v1.0.0").toBe("v1.0.0");
  });

  it("人工备份标签不被当成发布基线（F01-B）", () => {
    const repo = tempRepo();
    commitAs(repo, "feat: baseline", "v1.0.0");
    commitAs(repo, "feat: important-change", "v1.1.0-backup");
    commitAs(repo, "fix: final-change", "v1.2.0");

    // `v1.1.0-backup` 不是正式发布（后缀以字母开头）→ 基线应是 v1.0.0。
    expect(previousTagOf(repo, "v1.2.0")).toBe("v1.0.0");
  });

  it("首个发布没有前一个 tag", () => {
    const repo = tempRepo();
    commitAs(repo, "feat: first", "v1.0.0");
    expect(previousTagOf(repo, "v1.0.0")).toBeUndefined();
  });

  it("同一提交上有多个 tag 时选版本号形态的那个", () => {
    const repo = tempRepo();
    commitAs(repo, "feat: base", "v1.0.0");
    commitAs(repo, "feat: next", "v1.1.0");
    git(repo, "tag", "release-candidate", "v1.1.0");
    commitAs(repo, "fix: after", "v1.2.0");
    expect(previousTagOf(repo, "v1.2.0")).toBe("v1.1.0");
  });
});
