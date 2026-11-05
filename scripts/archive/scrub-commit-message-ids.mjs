#!/usr/bin/env node
/**
 * 一次性：解析 `git filter-branch --msg-filter` 的输入，把**提交信息里**的身份值脱敏。
 *
 * ## 为什么单独一个文件（第八轮复审 SEC-01 的第三次变体）
 *
 * 我为了说明「上一版把真实 QQ 号写进了源码」，在提交信息里**又把它写了一遍**。
 * `filter-branch` 的 `--msg-filter` 走 shell，Windows 上引号/反斜杠极容易出错，
 * 所以把规则写进脚本、由脚本自己去读 stdin。
 *
 * ## 与 `scrub-commit-msg.mjs` 的区别
 *
 * 那个是**长期维护**的通用脱敏（读外部私有映射）。本文件是**这次一次性修复**用
 * 的窄规则：只处理「把真实值当示例写进技术说明」这一种形态。用完即可删。
 *
 * 关键点：**它自己不含任何真实值** —— 用形态匹配（10 位连续数字、调用方提供的
 * 用户名形态），不是字面量替换。这样即使本文件被公开，也不泄露任何东西。
 * @module dsh-llm-account/scripts/scrub-commit-message-ids
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * 用户名形态：由调用方提供，**不写死**。
 *
 * 为什么不留字面量：这个脚本的用途就是清除某个真实用户名，把它硬编码进正则
 * 等于把要清理的东西又写了一遍（本文件当初正好犯了这个错）。
 * 需要时通过环境变量 `SCRUB_USER_PATTERN` 传入（形如 `[A-Z]{3}[0-9A-Za-z_*]*`）。
 */
const USER_PATTERN =
  typeof process.env.SCRUB_USER_PATTERN === "string" && process.env.SCRUB_USER_PATTERN !== ""
    ? new RegExp(process.env.SCRUB_USER_PATTERN, "gu")
    : undefined;

/**
 * 脱敏一段提交信息。
 * @param message - 原始提交信息。
 * @returns 处理后的信息。
 */
export function scrubIds(message) {
  let text = message;

  /**
   * 1. **十位连续数字当示例**：`/1234567890/gu` 这种写法。
   *
   * 只替换**出现在正则/引号上下文里的**那种（`/…/`、`"…"`、`'…'`），
   * 不碰普通句子里的数字（例如版本号、行号）。
   */
  text = text.replace(/\/(\d{10})\/gu/gu, "/<ACCOUNT_ID>/gu");
  text = text.replace(/"(\d{10})"/gu, '"<ACCOUNT_ID>"');
  text = text.replace(/'(\d{10})'/gu, "'<ACCOUNT_ID>'");

  /**
   * 2. **本机用户名形态**：统一成 `<USER>`。
   *
   * 当时的具体形态是「一段大写字母开头的用户名 + 可选数字/下划线/星号」，
   * 而且它出现在正则字面量里（前面带 `\b`）。
   *
   * **不能用 `\b` 开头**：字面量里 `\b` 前面是反斜杠 `\` 而不是「词与非词的边界」，
   * 所以 `\b<名字>` 匹配不到 `b<名字>` 里的那一段。
   *
   * 这里**不写死任何真实用户名** —— 把要清理的东西再写进清理脚本，等于换个地方泄漏。
   * 需要时由调用方通过 `USER_PATTERN` 提供（见下方说明）。
   */
  if (USER_PATTERN !== undefined) text = text.replace(USER_PATTERN, "<USER>");

  /** 3. 提交信息里引用真实路径的形态（`C:/Users/具体名`）。 */
  text = text.replace(/C:\/Users\/[^/\s`"']+/gu, "%USERPROFILE%");
  text = text.replace(/C:\\Users\\[^\\\s`"']+/gu, "%USERPROFILE%");
  text = text.replace(/file:\/\/\/C:\/Users\/[^/\s`"']+/gu, "file:///%USERPROFILE%");

  return text;
}

/** 直接执行时为 filter 子进程：读 stdin、写 stdout。 */
/**
 * 判断「是不是被直接执行」（而不是被 import）。
 *
 * 原来用 `import.meta.url === \`file://${process.argv[1]}\`` —— 在 Windows 上
 * `process.argv[1]` 是 `C:\...\x.mjs`（反斜杠），拼出的 `file://C:/...` 与
 * `import.meta.url` 的 `file:///C:/...`（三斜杠）对不上，于是**永远不执行**，
 * 管道输出为空。
 *
 * 改用 `pathToFileURL` 做同样的规范化 —— 跨平台一致。
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(scrubIds(readFileSync(0, "utf8")));
}
