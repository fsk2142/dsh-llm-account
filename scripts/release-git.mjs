#!/usr/bin/env node
/**
 * 发版脚本里的**纯 Git 逻辑**（可导入、可测试）。
 *
 * ## 为什么单独一个文件
 *
 * 这些函数原来写死在 `release.mjs` 里。而 `release.mjs` 顶层会 `await main()`
 * （跑完整个发版流程），所以**测试没法 import 它** —— 上一轮的回归测试只好把
 * 逻辑**复制**到测试文件里，然后测那个副本。
 *
 * 结果是：把生产代码改坏（删掉 `-z`、删掉 `--match`），测试照样全绿。
 * 6 条测试**一条都防不住回归**（第五轮复审 F03，已实测确认）。
 *
 * 现在这些函数住在独立模块里，`release.mjs` 与测试**共用同一份实现**。
 * 测试用临时 Git 仓库直接调用它们；变异生产代码会真的让测试变红。
 *
 * ## 约定
 *
 * 每个函数都接受显式的 `cwd`，不依赖进程当前目录 —— 测试可以指向临时仓库。
 * @module dsh-llm-account/scripts/release-git
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * 在一个仓库里跑 git，返回 stdout（已 trim）。
 * @param {string} cwd - 仓库目录。
 * @param {string[]} args - git 参数。
 * @param {object} [options] - 透传给 `execFileSync`。
 * @returns stdout。
 */
export function git(cwd, args, options = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
}

/**
 * 判断一个 git ref 是否存在。
 * @param {string} cwd - 仓库目录。
 * @param {string} ref - 如 `refs/tags/v1.5.0`。
 * @returns 是否存在。
 */
export function refExists(cwd, ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析 `git diff --cached --name-only -z` 之类**NUL 分隔**的输出。
 *
 * `-z` 的路径不会加引号、不转义，含空格/引号/Unicode 都能原样取出。末尾还有一个
 * NUL，过滤空串即可。
 * @param {string} raw - 命令原始输出。
 * @returns 路径列表。
 */
export function parseNulList(raw) {
  return raw.split("\u0000").filter((item) => item !== "");
}

/**
 * 取工作树里**有变更的路径**（含已跟踪的改动 + 未跟踪的新文件）。
 *
 * `-z` 输出的记录格式是 `XY <path>`（两个状态字符 + 一个空格 + 路径）。重命名（R）
 * 与复制（C）会**额外**跟一条「原路径」记录，这里**同时保留两端**：审计时两条都要
 * 看得到（只看目标会漏掉敏感来源）。
 * @param {string} cwd - 仓库目录。
 * @returns {{ path: string, status: string, from?: string }[]} 变更记录。
 */
export function statusEntries(cwd) {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parts = raw.split("\u0000");
  const entries = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (record === undefined || record.length < 4) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status.includes("R") || status.includes("C")) {
      // 下一条记录是「原路径」。
      const from = parts[index + 1];
      index += 1;
      entries.push({ path, status, ...(from === undefined ? {} : { from }) });
      continue;
    }
    entries.push({ path, status });
  }
  return entries;
}

/**
 * 取工作树里所有**涉及到的路径**（重命名/复制时含源与目标两端）。
 * @param {string} cwd - 仓库目录。
 * @returns 路径列表（去重）。
 */
export function statusPaths(cwd) {
  const map = new Map();
  for (const entry of statusEntries(cwd)) {
    map.set(entry.path, true);
    if (entry.from !== undefined) map.set(entry.from, true);
  }
  return [...map.keys()];
}

/**
 * 从清单里挑出**发版该处理的路径**。
 *
 * 判定分三类：
 *
 * 1. 文件存在 → 要（可能是新增或修改）；
 * 2. 不存在、但**被 Git 跟踪** → 也要（这是删除，必须暂存，否则删除不会进提交）；
 * 3. 不存在、也从未被跟踪 → 跳过（可选文档缺失不该阻断发版）。
 * @param {string} cwd - 仓库目录。
 * @param {readonly string[]} candidates - 候选路径。
 * @returns 该交给 `git add` 的路径。
 */
export function existingPaths(cwd, candidates) {
  const tracked = new Set(
    parseNulList(
      git(cwd, ["ls-files", "-z", "--cached", "--", ...candidates], { stdio: ["ignore", "pipe", "ignore"] }),
    ),
  );
  const useful = candidates.filter((path) => {
    if (existsSync(`${cwd}/${path}`) || existsSync(path)) return true;
    return [...tracked].some((file) => file === path || file.startsWith(`${path}/`));
  });
  if (useful.length === 0) {
    throw new Error(`发版中止：清单里没有任何一个路径存在或被跟踪（${candidates.join(", ")}）。先确认工作目录对不对。`);
  }
  return useful;
}

/**
 * 正式发布标签的形态：`v<major>.<minor>.<patch>`，可带 SemVer 预发布后缀。
 *
 * ## 允许的预发布标识
 *
 * 只认 `alpha` / `beta` / `rc`（可带序号），即 SemVer 规范里常见的三种：
 * `v1.6.0-rc.1`、`v1.6.0-beta.2`、`v1.6.0-alpha`。
 *
 * ## 为什么不能「后缀以数字开头就放行」
 *
 * 上一版是 `/^v\d+\.\d+\.\d+(?:-\d[0-9A-Za-z.-]*)?$/` —— 注释写着兼容 `-rc.1`，
 * 但实际**不认** `-rc.1`（`-` 后面要求数字），反而**认** `v1.6.0-1-backup`
 * 这种人工备份标签（数字开头即可）。两处都错（第六轮复审 V55-03，Node 实测确认）：
 *
 * | 标签 | 上一版 | 本版 |
 * | --- | --- | --- |
 * | `v1.6.0-rc.1` | ❌ false | ✅ true |
 * | `v1.6.0-beta.2` | ❌ false | ✅ true |
 * | `v1.6.0-1-backup` | ⚠️ true（误认） | ✅ false |
 * | `v1.6.0-backup` | ✅ false | ✅ false |
 *
 * 用「明确的预发布关键字白名单」而不是「后缀首字符」判断 —— 后者无法区分
 * 「合法的数字开头预发布」与「人工备份命名」。
 * @type {RegExp}
 */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.[0-9A-Za-z]+)*)?$/u;

/**
 * 找一个 tag 之前的**最近一个正式发布 tag**。
 *
 * ## 为什么不能直接用 `git describe --tags`
 *
 * `--tags` 认所有标签。两个版本之间若有开发用标记：
 *
 * ```
 * A feat: base              tag v1.0.0
 * B feat: important change  tag scratch-tag
 * C fix: last change        tag v1.1.0
 * ```
 *
 * `git describe --tags --abbrev=0 v1.1.0^` 返回 `scratch-tag`，于是
 * `git log scratch-tag..v1.1.0` 只拿到 `C` —— **`B` 从 Release 说明里消失**。
 *
 * ## 为什么不能只 describe 一次再过滤
 *
 * 那样只会得到「最近的那个候选」：若它不合规（例如 `v9-staging`），函数返回
 * `undefined`，**不会继续往前找** —— 明明 `v1.0.0` 就在更早的历史里。
 * 第五轮复审 F01 复现了这一点。
 *
 * ## 做法
 *
 * 取**目标 tag 祖先上的全部标签**（`git tag --merged <tag>^`），按
 * 「距目标 tag 的提交距离」排序，取第一个合规的。距离用
 * `git rev-list --count <tag>..<target>` 算 —— 越小越近。
 * @param {string} cwd - 仓库目录。
 * @param {string} tag - 目标 tag（如 `v1.5.0`）。
 * @returns 前一个正式发布 tag；没有则 `undefined`。
 */
export function previousTagOf(cwd, tag) {
  /** 目标 tag 的父提交；首个提交没有父，直接视为「没有前一个版本」。 */
  const parent = `${tag}^`;
  if (!refExists(cwd, parent)) return undefined;

  let candidates;
  try {
    candidates = git(cwd, ["tag", "--merged", parent, "--list"], { stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    return undefined;
  }
  // 先按政策过滤：只有正式发布形态才可能是基线。
  const release = candidates.filter((name) => RELEASE_TAG.test(name));
  if (release.length === 0) return undefined;

  /** 距目标 tag 的提交数；越小越近。 */
  const distance = (name) => {
    try {
      return Number(git(cwd, ["rev-list", "--count", `${name}..${tag}`], { stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
  release.sort((left, right) => distance(left) - distance(right));
  const nearest = release[0];
  // 最近的那个必须真的在目标 tag 的祖先里（`--merged` 已保证），且距离有意义。
  return nearest === undefined || !Number.isFinite(distance(nearest)) ? undefined : nearest;
}
