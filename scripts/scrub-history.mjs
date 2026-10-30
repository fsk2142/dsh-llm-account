#!/usr/bin/env node
/**
 * 一键清理提交历史里的对话痕迹。
 *
 * 把 `docs/SCRUB-COMMIT-HISTORY.md` 里那套手工步骤包成命令，**默认只做检查**，
 * 加 `--apply` 才真的改写历史（重写会改变所有 SHA，必须显式确认）。
 *
 * ## 用法
 *
 * ```
 * node scripts/scrub-history.mjs            # 只扫描，报告有多少提交需要清理
 * node scripts/scrub-history.mjs --preview   # 展示改写前后的样例对比
 * node scripts/scrub-history.mjs --apply     # 真改写（先建离线 bundle 备份并校验）
 * ```
 *
 * ## 为什么默认不改写
 *
 * 重写历史不可逆、会改所有 SHA、可能让别人的安装引用失效。这种操作不该因为
 * 「跑了个脚本」就发生。
 *
 * @module dsh-llm-account/scripts/scrub-history
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

/** 会被认作「对话痕迹」的模式。 */
const TRACE_PATTERN = /用户|原话|报障/u;

/**
 * 读一个命令的 stdout，**失败即中止**（2026-10-30 修 N05）。
 *
 * 原来的 `run()` 把所有子进程异常吞成空串，于是：
 *
 * ```
 * git log --all ...      ← 在非 Git 目录 / Git 状态异常时失败
 *   ↓ run() 返回 ""
 *   ↓ .split("\n").filter(Boolean) → []（空提交集）
 *   ↓ 主流程打印「含对话痕迹：0」「无需清理」
 * ```
 *
 * 也就是**把扫描失败映射成了安全结论**。对历史清理这种工具，那是最坏的一种错：
 * 用户会以为自己查过了、干净了。
 *
 * 现在核心步骤（扫描、计数、建 bundle、取 tree、判断是否已清理）一律走这个严格版本。
 * 本脚本里每个 git 调用都是核心步骤 —— 失败就该中止，没有「不存在是正常答案」的探测。
 * @param {string[]} args - 命令与参数。
 * @param {object} [options] - 透传给 `execFileSync`。
 * @returns stdout（已 trim）。
 */
function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), { encoding: "utf8", ...options }).trim();
}

/** 取一个提交的完整信息。 */
function messageOf(sha) {
  return run(["git", "show", sha, "--format=%B", "--no-patch"]);
}

/**
 * 对一段提交信息做与 `scrub-commit-msg.mjs` 相同的改写。
 *
 * 为什么要在这里重复一遍规则而不是 `import`：那个脚本是 stdin→stdout 的过滤器，
 * 供 git 调用；这里的 `--preview` 需要**同步**拿到结果，而它的接口是流式的。
 * 两处规则必须保持一致 —— 改一处记得改另一处。
 */
function scrub(message) {
  return message
    .replace(/^[^\n]*用户\s*20\d{2}-\d{2}-\d{2}[^\n]*\n?/gmu, "")
    .replace(/[（(]\s*20\d{2}-\d{2}-\d{2}\s*用户[^)）]*[)）]/gu, "")
    .replace(/[（(]\s*用户(?:要求|报障|反馈)[^)）]*[)）]/gu, "")
    .replace(/用户(?:报障|反馈|原话|说)([：:]?\s*「)/gu, "实际现象是$1")
    .replace(/用户(?:报障|反馈|原话|说)[：:]?\s*/gu, "")
    .replace(/经用户(?:确认|反馈|要求)/gu, "经实测")
    .replace(/经实测与实测/gu, "经实测")
    .replace(/按?用户要求/gu, "按需求")
    .replace(/用户/g, "需求")
    .replace(/需求(?:二次|再次|又)?报障([：:]?\s*「)/gu, "实际现象是$1")
    .replace(/^[^\n]*按需求[（(]原话[)）][：:]?[^\n]*\n?/gmu, "")
    .replace(/^(\s*)报障([：:]|\s*「)/gmu, "$1实际现象是：")
    .replace(/需求(?:二次|再次|又)?报障[：:]?\s*/gu, "")
    .replace(/报障时/gu, "出问题时")
    .replace(/报障后/gu, "出问题后")
    .replace(/出问题时时/gu, "出问题时")
    .replace(/出问题后后/gu, "出问题后")
    .replace(/\n{3,}/gu, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "\n");
}

/** 找出所有含痕迹的提交。 */
function tracedCommits() {
  const shas = run(["git", "log", "--all", "--format=%H"]).split("\n").filter((line) => line !== "");
  return shas.filter((sha) => TRACE_PATTERN.test(messageOf(sha)));
}

/** 主流程。 */
function main() {
  const apply = process.argv.includes("--apply");
  const preview = process.argv.includes("--preview");

  const traced = tracedCommits();
  const total = run(["git", "rev-list", "--all", "--count"]);
  console.log(`提交总数：${total}`);
  console.log(`含对话痕迹：${traced.length}`);

  if (traced.length === 0) {
    console.log("\n无需清理。");
    return;
  }

  if (preview) {
    // 取一个最典型的（正文最长的）提交展示前后对比。
    const sample = traced
      .map((sha) => ({ sha, body: messageOf(sha) }))
      .sort((left, right) => right.body.length - left.body.length)[0];
    if (sample !== undefined) {
      console.log("\n──── 改写前 ────");
      console.log(sample.body.slice(0, 600));
      console.log("\n──── 改写后 ────");
      console.log(scrub(sample.body).slice(0, 600));
    }
    console.log("\n确认无误后加 --apply 执行改写。");
    return;
  }

  if (!apply) {
    console.log("\n这是只读扫描。下一步：");
    console.log("  node scripts/scrub-history.mjs --preview   看改写效果");
    console.log("  node scripts/scrub-history.mjs --apply     真正改写（会自动备份）");
    return;
  }

  // —— 真正的改写 ——
  //
  // **备份必须是仓库之外的、独立的**（2026-10-30 修）。
  //
  // 原来用 `git branch backup-…` 建备份分支，然后 `filter-branch --all` 改写所有
  // refs —— 那条备份分支**也在 `--all` 的范围内**，所以它保留的不是改写之前的
  // 提交链。末尾还建议用它回滚，等于给了一个假的保险。
  //
  // 现在改成 `git bundle create <仓库外路径> --all`：产物是一个独立文件，
  // 不在任何 ref 上，`filter-branch` 碰不到它。并且**校验它真的能克隆**，
  // 校验失败就中止 —— 不给「以为有备份」的错觉。
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
  const backupDir = process.env.SCRUB_BACKUP_DIR ?? join(tmpdir(), "dsh-scrub-backups");
  mkdirSync(backupDir, { recursive: true });
  const backupBundle = join(backupDir, `dsh-llm-account-before-scrub-${stamp}.bundle`);
  console.log(`\n创建离线备份（不在任何 ref 上，filter-branch 改写不到）：${backupBundle}`);
  run(["git", "bundle", "create", backupBundle, "--all"]);
  // 校验：能从这个 bundle 独立克隆出完整历史。
  //
  // **校验用的克隆必须删掉**（2026-10-30 修 F05）：它是一个包含**改写前全部历史**
  // （含敏感内容）的完整副本。离线 bundle 是有意保留的回滚资产；验证克隆只是
  // 一次性检查，留着等于在临时目录里多存一份敏感数据。
  const verifyDir = mkdtempSync(join(tmpdir(), "dsh-scrub-verify-"));
  try {
    run(["git", "clone", "--quiet", "--mirror", backupBundle, verifyDir]);
    const before = run(["git", "rev-list", "--all", "--count"]);
    const after = execFileSync("git", ["-C", verifyDir, "rev-list", "--all", "--count"], { encoding: "utf8" }).trim();
    if (before !== after) {
      throw new Error(`备份不完整：原 ${before} 个提交，备份里 ${after} 个`);
    }
    console.log(`✓ 备份可独立克隆（${before} 个提交）`);
  } catch (error) {
    console.error(`\n⚠ 备份校验失败，**中止改写**（没有可靠的回滚手段时不该动手）：`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error(`  已生成的 bundle 保留在：${backupBundle}`);
    process.exitCode = 1;
    return;
  } finally {
    // 无论校验成功与否都清掉这份临时副本。
    rmSync(verifyDir, { recursive: true, force: true });
  }

  // 关键：filter-branch 在临时目录执行，脚本必须用绝对路径。
  const here = dirname(fileURLToPath(import.meta.url));
  const filterScript = join(here, "scrub-commit-msg.mjs").replace(/\\/gu, "/");
  console.log(`改写中（脚本：${filterScript}）…`);

  const beforeTree = run(["git", "rev-parse", "HEAD^{tree}"]);
  /**
   * 只改写**当前分支**，不再 `--all`。
   *
   * `--all` 会连所有 tag、远端跟踪分支一起改写 —— 而 tag 指向的是已发布的版本，
   * 改写它们会让下游按 SHA 固定安装的人拿到不同的对象。真要清理 tag 应该单独
   * 决策（并考虑 GitHub Release 的连带影响），不该混在提交信息清理里顺带做。
   */
  execFileSync("git", ["filter-branch", "-f", "--msg-filter", `node "${filterScript}"`, "--", "HEAD"], {
    stdio: "inherit",
    env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: "1" },
  });

  // 改写后校验：文件内容必须一个字节都没变。
  const afterTree = run(["git", "rev-parse", "HEAD^{tree}"]);
  if (beforeTree !== afterTree) {
    console.error("\n⚠ 文件内容发生了变化（tree 不一致）。请检查：");
    console.error(`  从离线备份恢复：`);
    console.error(`    git clone --mirror "${backupBundle}" recovered && cd recovered`);
    console.error(`  或从 reflog 找回：git reset --hard ORIG_HEAD`);
    process.exitCode = 1;
    return;
  }
  console.log("✓ 文件内容未变（只改了提交信息）");
  console.log(`  回滚方式：从离线备份重克隆 —— git clone --mirror "${backupBundle}" <目录>`);

  const left = tracedCommits().length;
  if (left === 0) {
    console.log("✓ 痕迹已全部清除");
  } else {
    // 全仓扫描会连其它 ref 与悬空对象一起扫到，所以「仍有 N 处」不等于失败。
    // 真正的判据是：**当前分支上还有没有**。
    const reachable = run(["git", "log", "HEAD", "--format=%H"]).split("\n").filter((line) => line !== "");
    const live = reachable.filter((sha) => TRACE_PATTERN.test(messageOf(sha)));
    if (live.length === 0) {
      console.log(`✓ 当前分支已干净（另有 ${left} 处在其它 ref/悬空对象里，属正常）`);
    } else {
      console.log(`⚠ 当前分支仍有 ${live.length} 处未清理 —— 说明改写规则漏了某种写法`);
    }
  }
  console.log(`\n下一步（确认无误后）：`);
  console.log(`  git push --force-with-lease origin main`);
  console.log(`\n本脚本**不改写 tag**（tag 指向已发布版本，改写它们会让按 SHA 固定安装的`);
  console.log(`下游拿到不同对象）。若确实要清理 tag 里的历史，那是一次独立的、需要`);
  console.log(`评估 GitHub Release / 下游克隆影响的决策 —— 不要顺手做。`);
  console.log(`\n离线恢复包（保留到确认无需回滚为止）：`);
  console.log(`  ${backupBundle}`);
  console.log(`  恢复方式：git clone --mirror "${backupBundle}" <目录>`);
}

main();
