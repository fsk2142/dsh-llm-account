#!/usr/bin/env node
/**
 * 发版：算版本号 → 重建产物 → 提交 → 打 tag → 推送 → 建 GitHub Release。
 *
 * ## 为什么要有这个脚本
 *
 * 以前发版是手工六步，其中「建 GitHub Release」这一步经常漏 —— 而插件市场的
 * **更新说明只认 Release**（不是 tag）。漏了它，市场里就只显示「有新版本」却
 * 说不出更新了什么。
 *
 * ## 前置
 *
 * 环境变量 `GITHUB_TOKEN`（细粒度 token 也行，需要 Contents: Read and write）。
 * 没设 token 时**跳过建 Release 并明确提示**，其余步骤照常 —— 不能让一个附加步骤
 * 把发版卡死。
 *
 * ## 用法
 *
 * ```
 * node scripts/release.mjs --note "这次改了什么"      # 完整发版
 * node scripts/release.mjs --note "..." --dry-run     # 只算版本号
 * ```
 *
 * 提交信息从 `git log` 自动汇总（自上一个 tag 起），`--note` 是给 Release 的补充说明。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 读一个命令的 stdout。 */
function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), { encoding: "utf8", ...options }).trim();
}

/**
 * 判断一个 git ref 是否存在。
 * @param {string} ref - 如 `refs/tags/v1.5.0`。
 * @returns 是否存在。
 */
function refExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** 读 package.json 的 name 与 repository。 */
function packageInfo() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const match = typeof url === "string" ? /github\.com[:/]([^/]+)\/([^/#.]+)/.exec(url) : null;
  return {
    name: pkg.name,
    version: pkg.version,
    owner: match?.[1],
    repo: match?.[2],
  };
}

/**
 * 建 GitHub Release，**幂等**。
 *
 * 已经存在同 tag 的 Release 时不再重复创建（GitHub 会回 422）—— 这让「推送成功、
 * 建 Release 失败」之后可以安全地重跑补建，而不必抬一个新版本。
 * @returns 成功与否；没 token 时返回 `"no-token"`；已存在时返回 `"exists"`。
 */
async function createRelease({ owner, repo, tag, title, body }) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token === undefined || token === "") return "no-token";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json; charset=utf-8",
  };
  // 先查：已存在就直接成功（幂等），不靠 422 猜。
  const existing = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });
  if (existing.ok) return "exists";
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tag_name: tag, name: title, body, draft: false, prerelease: false }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub 拒绝了建 Release（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }
  return "ok";
}

/**
 * 按范围拼出 Release 正文。
 *
 * **范围必须是一个真实存在的 ref**（2026-10-30 修）。原来用
 * `${next.current}..${tag}`：`next.current` 是 `package.json` 的原始版本号
 * （`"1.4.2"`），而 tag 带 `v` 前缀 —— `git log 1.4.2..v1.5.0` 会因为 `1.4.2`
 * 这个 ref 不存在而报错退出。更糟的是它发生在 `git push` **之后**，于是形成
 * 「代码与 tag 已发布、Release 却没建」的半完成状态（v1.5.0 就是这样丢的）。
 *
 * `next.base` 才是正确来源：它是 `next-version.mjs` 里 `refExists()` **验证过的**
 * 起点（`since` 或 `v${current}`）。只有「没有任何起点 tag」时它是描述文字，那时
 * 退回全历史（不带范围），而不是拼一个不存在的 ref。
 * @param {{ tag: string, base: string, wholeHistory: boolean, note: string }} input
 * @returns Release 正文。
 */
function releaseBody({ tag, base, wholeHistory, note }) {
  const range = wholeHistory ? [] : [`${base}..${tag}`];
  const commits = run(["git", "log", "--oneline", ...range])
    .split("\n")
    .filter((line) => line !== "" && !line.includes("chore(release)"))
    .map((line) => `- ${line.replace(/^[a-f0-9]+ /, "")}`)
    .join("\n");
  return note === "" ? commits : `${note}\n\n## 变更\n\n${commits}`;
}

/**
 * 发版时**显式**暂存的路径（不用 `git add -A`）。
 *
 * 2026-10-30 改：原来 `git add -A` 会暂存工作树里所有非忽略文件。本项目 `.gitignore`
 * 只有 3 条，不含 `.env*` / `auth.json` / 本地日志 / Cookie 导出 —— 任何一个误落在
 * 仓库目录里的私密文件都会**随发版提交上去**。
 *
 * 现在只暂存「发版确实会产出」的文件。新增构建产物时**必须**同步这个清单，
 * 否则提交会漏文件（`guardWorkingTree` 会把它报出来，不会静默漏掉）。
 */
const STAGED_PATHS = ["package.json", "lib", "src", "tests", "docs", "scripts", "README.md", "CHANGELOG.md", "cordis.patch.yml", ".gitignore"];

/**
 * 发版前的安全闸门。
 *
 * 只检查**不该出现在提交里**的东西，不做过度猜测：
 *
 * 1. 工作树里有没有 git 会跟踪的「看起来像机密」的文件（`.env*`、`auth.json`、
 *    `*.pem`、`*.key`、Cookie 库等）—— 有就硬失败，让人先处理；
 * 2. 未跟踪文件里同样扫一遍（`git add -A` 时代它们会被一起提交，现在虽然不暂存了，
 *    还是要提醒）；
 * 3. 打印 `git status`，让发版者看到本次到底会提交什么。
 */
function guardWorkingTree() {
  const SECRET_FILE = /(^|\/)(\.env[^/]*|auth\.json|credentials[^/]*|.*\.pem|.*\.key|.*cookies.*\.(sqlite|db))$/i;
  const risk = run(["git", "status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "")
    .filter((path) => SECRET_FILE.test(path));
  if (risk.length > 0) {
    throw new Error(
      [`发版中止：工作树里有疑似机密文件，不该提交 ——`, ...risk.map((path) => `  ${path}`), ``, `处理掉（加进 .gitignore 或移出仓库）后再发版。`].join("\n"),
    );
  }
  const dirty = run(["git", "status", "--porcelain", "--untracked-files=all"]);
  if (dirty !== "") {
    console.log("本次会提交这些变更：");
    console.log(dirty);
  }
}

/**
 * 建（或补建）Release 并打印结果。
 *
 * 单独抽出来是为了让 `--release-only` 能复用同一条路径 —— 推送成功、建 Release
 * 失败时**补建**，而不是抬一个新版本重发。
 * @param {{ info: ReturnType<typeof packageInfo>, tag: string, base: string, wholeHistory: boolean, note: string }} input
 */
async function publishRelease({ info, tag, base, wholeHistory, note }) {
  const body = releaseBody({ tag, base, wholeHistory, note });
  const result = await createRelease({ owner: info.owner, repo: info.repo, tag, title: tag, body });
  if (result === "no-token") {
    console.warn("⚠ 没设 GITHUB_TOKEN，跳过建 Release。市场将看不到这次的更新说明。");
    console.warn(`  设好 token 后补建：node scripts/release.mjs --release-only ${tag}`);
  } else if (result === "exists") {
    console.log(`Release 已存在，未重复创建：https://github.com/${info.owner}/${info.repo}/releases/tag/${tag}`);
  } else {
    console.log(`已建 Release：https://github.com/${info.owner}/${info.repo}/releases/tag/${tag}`);
  }
}

/** 主流程。 */
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const noteIndex = argv.indexOf("--note");
  const note = noteIndex >= 0 ? (argv[noteIndex + 1] ?? "") : "";
  /**
   * `--release-only <tag>`：只补建 Release，不碰提交/tag/推送。
   *
   * 用于「推送成功、建 Release 失败」之后（v1.5.0 就是这种状态）。
   * 起点取 `v<package.json 版本>`，不存在就退回全历史。
   */
  const releaseOnlyIndex = argv.indexOf("--release-only");
  const releaseOnlyTag = releaseOnlyIndex >= 0 ? (argv[releaseOnlyIndex + 1] ?? "") : undefined;

  const info = packageInfo();

  if (releaseOnlyTag !== undefined && releaseOnlyTag !== "") {
    if (!releaseOnlyTag.startsWith("v")) {
      throw new Error(`--release-only 需要一个带 v 的 tag（如 v1.5.0），收到：${releaseOnlyTag}`);
    }
    if (!refExists(`refs/tags/${releaseOnlyTag}`)) {
      throw new Error(`tag 不存在：${releaseOnlyTag}。先确认它真的推送过。`);
    }
    // 起点：同 tag 的前一个版本（package.json 当前的版本就是那个）。
    const base = `v${info.version}`;
    const known = refExists(`refs/tags/${base}`);
    await publishRelease({
      info,
      tag: releaseOnlyTag,
      base: known ? base : releaseOnlyTag,
      wholeHistory: !known,
      note,
    });
    return;
  }

  // 1. 算下一个版本（复用既有脚本，它是唯一真相）。
  const next = JSON.parse(run(["node", "scripts/next-version.mjs", "--json"]) || "{}");
  if (next.level === "none") {
    console.log("没有需要抬版本的提交，退出。");
    return;
  }
  console.log(`当前 ${next.current} → 下一个 ${next.next}（${next.level}）`);
  if (dryRun) return;

  // 2. 写版本号并重建产物（版本号是构建期注入的）。
  run(["node", "scripts/next-version.mjs", "--write"]);
  console.log("已写回 package.json");
  run(["pnpm", "build"], { stdio: "inherit" });
  console.log("产物已重建");

  // 3. 全量验证：任何一步失败都不该发出去。
  //
  // 提交标题也在这里查：GitHub 文件树悬停显示的是「该路径最后一次提交的标题」，
  // 所以标题本身就是给读者看的第一句话（规范见 docs/RELEASING.md 第五节）。
  run(["node", "scripts/check-commit-titles.mjs"], { stdio: "inherit" });
  run(["npx", "tsc", "--noEmit"], { stdio: "inherit" });
  run(["npx", "vitest", "run"], { stdio: "inherit" });

  // 4. 提交 + 打 tag + 推送。
  const tag = `v${next.next}`;
  guardWorkingTree();
  run(["git", "add", "--", ...STAGED_PATHS]);
  run(["git", "commit", "-m", `chore(release): ${tag}`]);
  run(["git", "tag", tag]);
  run(["git", "push", "origin", "main", "--tags"]);
  console.log(`已推送 ${tag}`);

  // 5. 建 Release（市场靠它显示更新说明）。
  //
  // 这一步**可以单独补建**：`--release-only <tag>` 只做本步。推送成功但建 Release
  // 失败时，不要抬版本重发 —— 用同一条命令补，`createRelease` 是幂等的。
  await publishRelease({ info, tag, base: next.base, wholeHistory: next.wholeHistory, note });
}

await main();
