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
import { existsSync, readFileSync } from "node:fs";

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
  /**
   * 先查：已存在就直接成功（幂等），不靠 422 猜。
   *
   * **只有 404 才代表「不存在」**（2026-10-30 修 N08.2）。原来把任何非 2xx 都当成
   * 「还没建」，于是 403 / 429 / 5xx（token 权限不足、限流、GitHub 故障）都会继续
   * 去 POST —— 既遮蔽了真实原因，也可能在状态未知时重复创建。
   */
  const existing = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });
  if (existing.ok) return "exists";
  if (existing.status !== 404) {
    const text = await existing.text();
    throw new Error(
      `查询 Release 失败（HTTP ${existing.status}）：${text.slice(0, 200)}。这是「状态未知」而不是「不存在」，所以没有创建。`,
    );
  }
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
 *
 * `end` 是终点，缺省 `tag`。补建旧版本时**必须**显式传目标 tag（R06）：不带范围
 * 的 `git log` 读的是 `HEAD`，补建 v1.5.0 会把 v1.5.1 之后的提交也混进去。
 * @param {{ tag: string, base: string, wholeHistory: boolean, end?: string, note: string }} input
 * @returns Release 正文。
 */
function releaseBody({ tag, base, wholeHistory, end, note }) {
  const head = end ?? tag;
  const range = wholeHistory ? [head] : [`${base}..${head}`];
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
 * 原来 `git add -A` 会暂存工作树里所有非忽略文件，而私密文件一旦误落进仓库目录就会
 * 随发版提交上去。
 *
 * **只列真实存在的路径**（2026-10-30 修 R01）。`git add -- <path>` 对不存在的
 * pathspec 会 `fatal: pathspec ... did not match any files` 并中止发版 —— 之前这里
 * 写了不存在的 `CHANGELOG.md`，会在「版本号已写、产物已重建、测试已跑」之后炸掉，
 * 留下半完成的工作树。
 *
 * 所以：清单里的路径**必须存在**；可选文件（如将来的 CHANGELOG）由
 * {@link existingPaths} 过滤，缺了不阻断发版。
 */
const STAGED_PATHS = [
  "package.json",
  "lib",
  "src",
  "tests",
  "docs",
  "scripts",
  "README.md",
  "LICENSE",
  "icon.svg",
  "cordis.patch.yml",
  ".gitignore",
  "tsdown.config.ts",
  "pnpm-lock.yaml",
];

/**
 * 从清单里挑出**发版该处理的路径**。
 *
 * ## 为什么不能只看 `existsSync`（2026-10-30 修 N03）
 *
 * 一个**已被 Git 跟踪、但在工作树里被删掉**的路径，`existsSync` 是 `false`，
 * 于是被过滤掉 —— 它的**删除就不会进提交**。若删除的目的正是移除敏感文件，
 * 那文件会继续留在已发布的 tag 里。
 *
 * 所以判定要分三类：
 *
 * 1. 文件存在 → 要（可能是新增或修改）；
 * 2. 不存在、但**被 Git 跟踪** → 也要（这是删除，必须暂存）；
 * 3. 不存在、也从未被跟踪 → 跳过（可选文档缺失，不该阻断发版）。
 *
 * 一个都不剩才是真异常（多半是工作目录不对）。
 * @param {readonly string[]} candidates - 候选路径。
 * @returns 该交给 `git add` 的路径。
 */
function existingPaths(candidates) {
  // 一次问清哪些路径有跟踪记录（`ls-files` 对已删除但仍在 index 的路径也会列出）。
  const tracked = new Set(
    parseNulList(
      run(["git", "ls-files", "-z", "--cached", "--", ...candidates], { stdio: ["ignore", "pipe", "ignore"] }),
    ),
  );
  const useful = candidates.filter((path) => {
    if (existsSync(path)) return true;
    // 不存在：只要它在 Git 里还有记录，就可能是「删除」，必须一起 add。
    // 目录形式的清单项要按前缀匹配（`git ls-files` 给的是具体文件）。
    return [...tracked].some((file) => file === path || file.startsWith(`${path}/`));
  });
  if (useful.length === 0) {
    throw new Error(`发版中止：清单里没有任何一个路径存在或被跟踪（${candidates.join(", ")}）。先确认工作目录对不对。`);
  }
  return useful;
}

/**
 * 解析 `git diff --cached --name-only -z` 的输出。
 *
 * `-z` 用 NUL 分隔（路径里可能有空格或换行，按行拆会拆错）。末尾还有一个 NUL，
 * 过滤空串即可。
 * @param {string} raw - 命令原始输出。
 * @returns 暂存路径列表。
 */
function parseNulList(raw) {
  return raw.split("\u0000").filter((item) => item !== "");
}

/**
 * 发版前的安全闸门。
 *
 * 分三层，各管一件事（不混为一谈）：
 *
 * 1. **index 预检**（R02）：`git add -- <白名单>` 只更新所列路径，**不会清空** index
 *    里已有的其他条目；而裸 `git commit` 提交的是**整个 index**。所以发版前必须
 *    确认 index 是干净的 —— 有预暂存内容就停止，让人自己处理（**不擅自丢弃**）。
 * 2. **工作树机密文件名扫描**：`.env*` / `auth.json` / `*.pem` / Cookie 库等，见到
 *    就硬失败。注意 `git status` **看不到被 .gitignore 忽略的未跟踪文件**，所以这
 *    一层只覆盖「会被 git 看见」的部分，不能宣称覆盖了全部机密。
 * 3. 打印 `git status`，让发版者看到本次到底会提交什么。
 */
function guardWorkingTree() {
  // —— 1. index 预检 ——
  const staged = parseNulList(run(["git", "diff", "--cached", "--name-only", "-z"]));
  if (staged.length > 0) {
    throw new Error(
      [
        `发版中止：版本库 index 里已经有暂存内容 ——`,
        ...staged.map((path) => `  ${path}`),
        ``,
        `发版脚本只应提交它自己白名单里的文件。请先人工处理这些暂存（git restore --staged <path>`,
        `或把它们提交掉），**不要**在发版脚本里自动清空 index。`,
      ].join("\n"),
    );
  }

  // —— 2. 工作树机密文件名扫描 ——
  //
  // **必须用 `-z`**（2026-10-30 修 A02）。`git status --porcelain` 会给含空格/特殊
  // 字符的路径**加双引号并转义**：
  //
  // ```
  //  M "src/private key.pem"
  // ```
  //
  // 按行 split 再 `slice(3).trim()` 得到的是 `"src/private key.pem"`（带引号），
  // 而 `SECRET_FILE` 要求以 `.pem` 结尾 —— 于是**漏检**。被 `git add -f` 强制跟踪过的
  // 凭据文件改动就能混进发布提交。
  //
  // `-z` 输出以 NUL 分隔且**不加引号、不转义**，路径可以原样使用。
  const SECRET_FILE = /(^|\/)(\.env[^/]*|auth\.json|credentials[^/]*|.*\.pem|.*\.key|.*cookies.*\.(sqlite|db))$/i;
  const risk = statusPaths().filter((path) => SECRET_FILE.test(path));
  if (risk.length > 0) {
    throw new Error(
      [`发版中止：工作树里有疑似机密文件，不该提交 ——`, ...risk.map((path) => `  ${path}`), ``, `处理掉（加进 .gitignore 或移出仓库）后再发版。`].join("\n"),
    );
  }

  // —— 3. 让人看到会提交什么 ——
  const dirty = statusPaths();
  if (dirty.length > 0) {
    console.log("本次会提交这些变更：");
    for (const path of dirty) console.log(`  ${path}`);
  }
}

/**
 * 取工作树里**有变更的路径**（已跟踪的改动 + 未跟踪的新文件）。
 *
 * 用 `git status --porcelain=v1 -z`：NUL 分隔、**不加引号**，含空格/引号/Unicode 的
 * 路径都能原样取出。记录格式是 `XY <path>`（两个状态字符 + 一个空格 + 路径），
 * 重命名/复制会**额外**跟一段原路径（也用 NUL 分隔），这里一并消费掉。
 * @returns 变更路径列表。
 */
function statusPaths() {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parts = raw.split("\u0000");
  const paths = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (record === undefined || record.length < 4) continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    // 重命名（R）与复制（C）后面还跟着一条「原路径」记录，跳过它。
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return paths;
}

/**
 * 暂存本轮发版文件，并**校验最终 index** 严格落在白名单内。
 *
 * R02 的教训：`git add -- <path>` 不限定 `git commit` 的范围，所以「白名单暂存」
 * 不等于「白名单提交」。这里在 add 之后**再查一次 index**，把实际会进提交的路径
 * 与白名单比对 —— 多出来的立刻中止。
 *
 * @param {readonly string[]} paths - 本轮要暂存的白名单路径。
 */
function stageForRelease(paths) {
  run(["git", "add", "--", ...paths]);
  const staged = parseNulList(run(["git", "diff", "--cached", "--name-only", "-z"]));
  if (staged.length === 0) {
    throw new Error("发版中止：暂存后 index 是空的（没有可提交的变更）。");
  }
  /** 某个暂存路径是否落在白名单内（白名单项可以是目录前缀）。 */
  const allowed = (path) => paths.some((entry) => path === entry || path.startsWith(`${entry}/`));
  const outside = staged.filter((path) => !allowed(path));
  if (outside.length > 0) {
    throw new Error(
      [
        `发版中止：index 里有白名单之外的路径 ——`,
        ...outside.map((path) => `  ${path}`),
        ``,
        `这些文件不该随发版提交。若确实是发布产物，把它们加进 STAGED_PATHS；否则移出仓库。`,
      ].join("\n"),
    );
  }
  return staged;
}

/**
 * 找一个 tag 之前的**最近一个 tag**（按提交图，不是按版本号排序）。
 *
 * 用 `git describe --tags --abbrev=0 <tag>^`：从目标 tag 的父提交往上走，取最近
 * 的可达 tag。比「按版本号排序后取前一个」可靠 —— 后者在以下情形会错：
 * 同一提交上打了多个 tag、tag 不在主线、版本号与发布顺序不一致。
 * @param {string} tag - 目标 tag（如 `v1.5.0`）。
 * @returns 前一个 tag；没有则 `undefined`。
 */
/**
 * 找一个 tag 之前的**最近一个发布 tag**（按提交图，不是按版本号排序）。
 *
 * ## 为什么不能直接用 `git describe --tags`
 *
 * `--tags` 认**所有**标签，包括开发用的临时标记。若两个版本之间有人打了
 * `scratch-tag`：
 *
 * ```
 * A feat: base              tag v1.0.0
 * B feat: important change  tag scratch-tag
 * C fix: last change        tag v1.1.0
 * ```
 *
 * `git describe --tags --abbrev=0 v1.1.0^` 会返回 `scratch-tag`，于是
 * `git log scratch-tag..v1.1.0` 只拿到 `C` —— **`B` 的改动从 Release 说明里消失**
 * （2026-10-30 修 A03，已在独立仓库复现）。
 *
 * ## 做法
 *
 * 用 `--match 'v[0-9]*'` 先把候选收窄到**看起来像版本号**的标签，再用正则严格校验
 * `v<major>.<minor>.<patch>`（`--match` 只是 glob，不是正则，必须二次确认）。
 * 找不到就返回 `undefined`，由调用方退回「读目标 tag 之前的全部历史」——
 * 宁可多列，也不静默漏掉改动。
 * @param {string} tag - 目标 tag（如 `v1.5.0`）。
 * @returns 前一个发布 tag；没有则 `undefined`。
 */
function previousTagOf(tag) {
  /** 正式发布标签的形态：`v1.2.3`（可带预发布后缀）。 */
  const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
  try {
    const found = execFileSync("git", ["describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", `${tag}^`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // `--match` 是 glob，可能仍命中 `v1.0.0-rc1-backup` 这类；这里按正式形态再筛一次。
    return RELEASE_TAG.test(found) ? found : undefined;
  } catch {
    // `describe` 失败 = 父提交上没有任何可达的版本 tag（首个发布，或 tag 在根提交上）。
    return undefined;
  }
}

/**
 * 建（或补建）Release 并打印结果。
 *
 * 单独抽出来是为了让 `--release-only` 能复用同一条路径 —— 推送成功、建 Release
 * 失败时**补建**，而不是抬一个新版本重发。
 * @param {{ info: ReturnType<typeof packageInfo>, tag: string, base: string, wholeHistory: boolean, end?: string, note: string }} input
 */
async function publishRelease({ info, tag, base, wholeHistory, end, note }) {
  const body = releaseBody({ tag, base, wholeHistory, ...(end === undefined ? {} : { end }), note });
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
   * 起点由 `previousTagOf(targetTag)` 从**目标 tag 自己的历史**倒推（不是 `package.json` 的版本）；
 * 找不到前一个 tag（首个发布）就以该 tag 为终点读它之前的全部历史。
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
    /**
     * 起点必须从**目标 tag 自己的历史**倒推，不能用 `package.json` 的版本。
     *
     * 原来的写法是 `base = "v" + package.json.version`，它只在「补建刚发布的那个
     * tag」时碰巧正确。补建更早的版本就错了 —— 例如当前版本 1.5.1 时补 v1.5.0：
     * `base = v1.5.1`，而 v1.5.0 是它的**祖先**，`git log v1.5.1..v1.5.0` 是**空**，
     * Release 说明因此什么都没有（这正是 v1.5.0 补建时正文为空的原因）。
     *
     * 正确做法：从 `tag^` 往上找**最近的 tag**（`git describe --tags --abbrev=0`）。
     * 找不到（第一个 tag）就退回「只读该 tag 的历史」，而不是读 `HEAD` —— 那会把
     * 后续提交混进旧版本的说明里。
     */
    const previousTag = previousTagOf(releaseOnlyTag);
    if (previousTag === undefined) {
      console.log(`  ${releaseOnlyTag} 是首个 tag，说明将覆盖它之前的全部历史。`);
    } else {
      console.log(`  变更范围：${previousTag}..${releaseOnlyTag}`);
    }
    await publishRelease({
      info,
      tag: releaseOnlyTag,
      base: previousTag ?? releaseOnlyTag,
      wholeHistory: previousTag === undefined,
      /** 补建时**始终以目标 tag 为终点**，不能用 HEAD（那会混入之后的提交）。 */
      end: releaseOnlyTag,
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

  // 2. **先做预检，再动任何文件**（2026-10-30 修 N06）。
  //
  // 原来顺序是「写版本号 → 构建 → 跑测试 → 才检查 index」，于是预暂存问题或构建
  // 失败会留下**半完成的工作树**（package.json 已改、lib/ 已重建、却没提交）。
  //
  // 把不依赖构建的检查全部提前：有问题就在写任何东西之前停下，工作树保持原样。
  guardWorkingTree();
  /**
   * 预检 tag 冲突：同名 tag 已存在说明这个版本发过了 —— 或者上一轮发到一半。
   * 两种情况都不该继续（`git tag` 会直接报错，但那时版本号已经写进去了）。
   */
  const tag = `v${next.next}`;
  if (refExists(`refs/tags/${tag}`)) {
    throw new Error(
      [
        `发版中止：tag ${tag} 已经存在。`,
        ``,
        `如果上一次发版的提交与推送已完成、只是 Release 没建，用：`,
        `  node scripts/release.mjs --release-only ${tag}`,
        `如果这次确实要重发，先确认并删除该 tag。`,
      ].join("\n"),
    );
  }

  // 3. 写版本号并重建产物（版本号是构建期注入的）。
  run(["node", "scripts/next-version.mjs", "--write"]);
  console.log("已写回 package.json");
  run(["pnpm", "build"], { stdio: "inherit" });
  console.log("产物已重建");

  // 4. 全量验证：任何一步失败都不该发出去。
  //
  // 提交标题也在这里查：GitHub 文件树悬停显示的是「该路径最后一次提交的标题」，
  // 所以标题本身就是给读者看的第一句话（规范见 docs/RELEASING.md 第五节）。
  run(["node", "scripts/check-commit-titles.mjs"], { stdio: "inherit" });
  run(["npx", "tsc", "--noEmit"], { stdio: "inherit" });
  run(["npx", "vitest", "run"], { stdio: "inherit" });

  // 5. 暂存 + 提交 + 打 tag + 推送。
  //
  // `tag` 与 `guardWorkingTree()` 已在步骤 2 的预检里做过 —— 那里能在**动任何文件
  // 之前**就发现 index 脏或 tag 冲突。
  stageForRelease(existingPaths(STAGED_PATHS));
  run(["git", "commit", "-m", `chore(release): ${tag}`]);
  run(["git", "tag", tag]);
  /**
   * **只推这一个 tag**（2026-10-30 修 N02）。
   *
   * `git push --tags` 会把本地**所有**未推送的 `refs/tags/*` 一起发上去 —— 包括
   * 为测试、备份或未公开分支建的标签。若某个标签指向不该公开的提交，那条历史就
   * 跟着出去了。发布只该推它自己刚建的那个。
   *
   * `--atomic`：main 与 tag 要么一起成功、要么一起失败，减少「tag 推上去了但
   * main 没推」这类半完成状态（远端支持时生效）。
   */
  run(["git", "push", "--atomic", "origin", "main", `refs/tags/${tag}`]);
  console.log(`已推送 ${tag}`);

  // 5. 建 Release（市场靠它显示更新说明）。
  //
  // 这一步**可以单独补建**：`--release-only <tag>` 只做本步。推送成功但建 Release
  // 失败时，不要抬版本重发 —— 用同一条命令补，`createRelease` 是幂等的。
  await publishRelease({ info, tag, base: next.base, wholeHistory: next.wholeHistory, note });
}

await main();
