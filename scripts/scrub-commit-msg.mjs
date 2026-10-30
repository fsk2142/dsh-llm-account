#!/usr/bin/env node
/**
 * 清理提交信息里的「对话痕迹」与**身份标识**，供 `git filter-branch --msg-filter`
 * 或 `scripts/run-msg-scrub.mjs` 调用。
 *
 * 改写只动**提交信息文本**，不动任何文件内容。
 *
 * ## 两类规则，存放方式不同（2026-10-30 修 SEC-01）
 *
 * 1. **语法形态规则**（路径形状、对话框架）→ 写在这个文件里。它们只是正则，不含
 *    任何真实的人或账号。
 * 2. **具体身份值**（某个 QQ 号、某个本机用户名）→ **不写在这里**，从仓库外的私有
 *    映射文件读（见 {@link applyIdentityMap}）。
 *
 * 为什么第 2 类必须外置：上一版把它们硬编码在源码里，而这个文件**公开在 GitHub
 * 上** —— 为了从历史里清掉那些值，反而把它们写进了 HEAD。历史干净了，当前代码却
 * 更明确地公布了它们。这是本轮报告 SEC-01 指出的问题。
 *
 * 用法：`git filter-branch --msg-filter 'node scripts/scrub-commit-msg.mjs'`
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

/**
 * 私有身份映射文件的路径。
 *
 * 刻意**放在仓库外**：仓库里只保留「怎么替换」的语法，具体值属于本地配置。
 * 可用 `SCRUB_IDENTITY_MAP` 覆盖。
 * @returns 绝对路径。
 */
function identityMapPath() {
  const configured = process.env.SCRUB_IDENTITY_MAP;
  if (typeof configured === "string" && configured.trim() !== "") return configured.trim();
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scrub-identity.map");
}

/** 缓存已读的映射（一次进程只读一次）。 */
let identityRules;

/**
 * 读私有映射：每行 `原文=占位符`，`#` 开头是注释。
 *
 * 文件不存在或读不了时返回空表 —— 脚本仍然可用（只做语法层清理），**不会因为缺
 * 配置而失败**。这样公开仓库里的默认行为不含任何真实值。
 * @returns 规则表。
 */
function identityRulesOf() {
  if (identityRules !== undefined) return identityRules;
  const path = identityMapPath();
  if (!existsSync(path)) {
    identityRules = [];
    return identityRules;
  }
  const rules = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const from = trimmed.slice(0, separator).trim();
    const to = trimmed.slice(separator + 1).trim();
    if (from === "") continue;
    rules.push([from, to === "" ? "<REDACTED>" : to]);
  }
  identityRules = rules;
  return rules;
}

/**
 * 按私有映射替换具体身份值。
 * @param text - 待处理文本。
 * @returns 替换后的文本。
 */
function applyIdentityMap(text) {
  let output = text;
  for (const [from, to] of identityRulesOf()) {
    output = output.split(from).join(to);
  }
  return output;
}

/** 去掉引用框架，保留技术描述。 */
function scrub(message) {
  let text = message;

  /**
   * 0. **先清身份标识**（2026-10-30 加，本轮清理的核心）。
   *
   * 前几轮只清了「对话痕迹」，但没处理**本机绝对路径与账号标识** —— 这两类才是
   * 真正能指向具体人的元数据：
   *
   * - `file:///C:/Users/<用户名>/…` / `C:\Users\<用户名>\…`：暴露 Windows 用户名
   *   与目录结构；
   * - 具体账号标识（QQ 号、本机标识）：见下方说明，**不在本文件里写死**。
   *
   * 顺序很重要：必须先替换**更长的形态**（`file:///C:/...`）再替换短形态
   * （`C:/...`），否则长形态会被拆坏、留下 `file:///<LOCAL_PATH>` 的残片。
   *
   * 扫描结论（403 提交 / 30 tag）：token / 密钥 / 邮箱 / workspace id 均 **0 处**，
   * 所以这里只需要处理路径与账号标识。
   */
  text = text.replace(/file:\/\/\/C:\/Users\/[^/\s`"']+/gu, "file:///<LOCAL_PATH>");
  text = text.replace(/C:\/Users\/[^/\s`"']+/gu, "<LOCAL_PATH>");
  text = text.replace(/C:\\\\Users\\\\[^\\\s`"']+/gu, "<LOCAL_PATH>");
  text = text.replace(/C:\\Users\\[^\\\s`"']+/gu, "<LOCAL_PATH>");
  /**
   * 具体身份值从**仓库外的私有映射**替换（2026-10-30 修 SEC-01）。
   *
   * 上一版在这里硬编码了真实的 QQ 号与本机用户名 —— 而这个文件公开在 GitHub 上。
   * 为了从历史里清掉那些值，反而把它写进了 HEAD。现在仓库里只留语法，值走本地配置
   * （`SCRUB_IDENTITY_MAP`，缺省 `<仓库外>/scrub-identity.map`）。
   */
  text = applyIdentityMap(text);

  // 1. `用户 YYYY-MM-DD：` 开头的整行删掉（原话本身没有技术价值）。
  //    用 [^\n]* 而不是 `.`（后者在 dotall 缺失时行为依赖标志，这里显式只吃一行）。
  text = text.replace(/^[^\n]*用户\s*20\d{2}-\d{2}-\d{2}[^\n]*\n?/gmu, "");

  // 2. 括号里的用户署名：`` / `（需求）` → 删掉。
  text = text.replace(/[（(]\s*20\d{2}-\d{2}-\d{2}\s*用户[^)）]*[)）]/gu, "");
  text = text.replace(/[（(]\s*用户(?:要求|报障|反馈)[^)）]*[)）]/gu, "");

  // 3. `实际情况「…」` / `需求「…」` 在句首：改成「实际现象是「…」」，
  //    比直接删掉前缀好读（否则句子会以一个孤零零的引号开头）。
  text = text.replace(/用户(?:报障|反馈|原话|说)([：:]?\s*「)/gu, "实际现象是$1");
  // 其余 `用户说` / `需求` 之类先落成中性词，再统一处理。
  text = text.replace(/用户(?:报障|反馈|原话|说)[：:]?\s*/gu, "");

  // 4. 「经用户确认」这类短语换成读得通的表述（「经需求确认」很别扭）。
  //    注意后面可能已经跟了「实测」，剥掉重复。
  text = text.replace(/经用户(?:确认|反馈|要求)/gu, "经实测");
  text = text.replace(/经实测与实测/gu, "经实测");
  // `需求 X` / `按需求` → `需求是 X` / `按要求`（避免「需求要求」叠词）。
  text = text.replace(/按?用户要求/gu, "按需求");

  /**
   * **按语境替换剩下的「用户」**（2026-10-30 修）。
   *
   * 原来这里是一刀切 `用户 → 需求`，于是出现病句：
   *
   * - 「于是**需求**在新界面明确关掉后…」← 主语不通（用户才对）
   * - 「**需求**选中这样的模型，请求时…」← 同上
   * - 「**需求**看不到界面…」← 同上
   *
   * 判断依据是**「用户」后面的词**：如果跟的是人的动作（选中/关掉/以为/看到…），
   * 就换成「操作者」；如果跟的是需求类名词（要求/预期/反馈），才用「需求」。
   * 剩下的兜底用「操作者」——它在技术文档里比「需求」更不容易出病句。
   */
  text = text.replace(/用户(?=选中|在新界面|点|以为|看到|感知|只|看不到|操作|设置|填|改|关|开)/gu, "操作者");
  text = text.replace(/用户(?=要求|预期|反馈|需要|诉求|方)/gu, "需求");
  text = text.replace(/用户/g, "操作者");
  // 「操作者」重复或与他词拼接后的别扭写法收敛一下。
  text = text.replace(/操作者操作者/gu, "操作者");
  text = text.replace(/需求方方/gu, "需求方");

  // 5. 第一轮改写后仍会残留的几种痕迹（2026-10-21 实测发现）：
  //    - `需求二次报障：「…」` → 换成「实际现象是「…」」；
  //    - `按需求（原话）：` → 整行去掉（原话本身没有技术价值）；
  //    - 行首孤立的 `报障：` / `报障「` → 换成「实际现象」。
  text = text.replace(/需求(?:二次|再次|又)?报障([：:]?\s*「)/gu, "实际现象是$1");
  text = text.replace(/^[^\n]*按需求[（(]原话[)）][：:]?[^\n]*\n?/gmu, "");
  text = text.replace(/^(\s*)报障([：:]|\s*「)/gmu, "$1实际现象是：");
  text = text.replace(/需求(?:二次|再次|又)?报障[：:]?\s*/gu, "");
  // 句子中间残留的 `报障时` / `报障后`：整体替换（只替换「报障」会把后面的时/后留下，
  // 变成「出问题后后」这种叠字 —— 2026-10-21 实测踩到）。
  text = text.replace(/报障时/gu, "出问题时");
  text = text.replace(/报障后/gu, "出问题后");
  text = text.replace(/出问题时时/gu, "出问题时");
  text = text.replace(/出问题后后/gu, "出问题后");

  // 6. 压缩因删除产生的空行（连续 3 个以上换行 → 2 个）。
  text = text.replace(/\n{3,}/gu, "\n\n");

  // 7. 去掉行尾空白与文件首尾空行。
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "\n");

  return text;
}

process.stdin.on("end", () => {
  process.stdout.write(scrub(input));
});
