#!/usr/bin/env node
/**
 * 清理提交信息里的「对话痕迹」，供 `git filter-branch --msg-filter` 调用。
 *
 * 为什么需要它：这个仓库的提交信息里长期写着「用户 2026-10-21：…」「用户报障…」
 * 这类句子，把「AI 在与具体用户对话」这件事公开在 GitHub 上（用户 2026-10-21
 * 提出隐私顾虑）。改写只动**提交信息文本**，不动任何文件内容。
 *
 * 改写规则（保守：只删引用框架，保留技术内容）：
 * - `用户 YYYY-MM-DD：` / `用户报障「…」` / `用户原话「…」` → 删掉这个框架，句子本身若
 *   承载技术信息就保留其后的描述；
 * - `用户要求` / `用户确认` / `用户所见` → 换成中性主语（需求 / 实测 / 实际）；
 * - 孤立的日期署名（`（2026-10-21 用户报障）`）→ 删掉整段。
 *
 * 用法：git filter-branch --msg-filter 'node scripts/scrub-commit-msg.mjs'
 */
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

/** 去掉引用框架，保留技术描述。 */
function scrub(message) {
  let text = message;

  // 1. `用户 YYYY-MM-DD：` 开头的整行删掉（原话本身没有技术价值）。
  //    用 [^\n]* 而不是 `.`（后者在 dotall 缺失时行为依赖标志，这里显式只吃一行）。
  text = text.replace(/^[^\n]*用户\s*20\d{2}-\d{2}-\d{2}[^\n]*\n?/gmu, "");

  // 2. 括号里的用户署名：`（2026-10-21 用户报障）` / `（用户要求）` → 删掉。
  text = text.replace(/[（(]\s*20\d{2}-\d{2}-\d{2}\s*用户[^)）]*[)）]/gu, "");
  text = text.replace(/[（(]\s*用户(?:要求|报障|反馈)[^)）]*[)）]/gu, "");

  // 3. `用户报障「…」` / `用户原话「…」` 在句首：改成「实际现象是「…」」，
  //    比直接删掉前缀好读（否则句子会以一个孤零零的引号开头）。
  text = text.replace(/用户(?:报障|反馈|原话|说)([：:]?\s*「)/gu, "实际现象是$1");
  // 其余 `用户说` / `用户要求` 之类先落成中性词，再统一处理。
  text = text.replace(/用户(?:报障|反馈|原话|说)[：:]?\s*/gu, "");

  // 4. 「经用户确认」这类短语换成读得通的表述（「经需求确认」很别扭）。
  //    注意后面可能已经跟了「实测」，剥掉重复。
  text = text.replace(/经用户(?:确认|反馈|要求)/gu, "经实测");
  text = text.replace(/经实测与实测/gu, "经实测");
  // `用户要求 X` / `按用户要求` → `需求是 X` / `按要求`（避免「需求要求」叠词）。
  text = text.replace(/按?用户要求/gu, "按需求");
  text = text.replace(/用户/g, "需求");

  // 5. 压缩因删除产生的空行（连续 3 个以上换行 → 2 个）。
  text = text.replace(/\n{3,}/gu, "\n\n");

  // 6. 去掉行尾空白与文件首尾空行。
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
