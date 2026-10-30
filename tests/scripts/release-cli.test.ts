/**
 * 发版 CLI 参数解析（`scripts/release-cli.mjs`）与发布标签形态
 * （`scripts/release-git.mjs` 的 `RELEASE_TAG`）的回归测试。
 *
 * ## 钉住的缺陷（第六轮复审）
 *
 * - **V55-01**：`--release-only vX --dry-run` 原来会**真的 POST** 建 Release
 *   （那条分支在 dryRun 检查之前就 `return` 了）；`--release-only` 漏传 tag 会
 *   **掉进完整发版**。
 * - **V55-03**：`RELEASE_TAG` 注释说兼容 `-rc.1`，实际不认；反而认
 *   `-1-backup` 这种人工备份标签。
 *
 * **两个被测模块都是直接 import 的**（不是在测试里重抄一份逻辑）——
 * 第五轮复审 F03 的教训：测副本的测试一条都防不住回归。
 */
import { describe, expect, it } from "vitest";

import { parseReleaseArgs } from "../../scripts/release-cli.mjs";
import { RELEASE_TAG } from "../../scripts/release-git.mjs";

describe("parseReleaseArgs：模式互斥（V55-01）", () => {
  it("**`--release-only vX --dry-run` 是演练，不是发布**", () => {
    const cli = parseReleaseArgs(["--release-only", "v1.5.5", "--dry-run"]);
    // 关键：mode 是 release-only 但 dryRun 为 true —— 调用方必须据此只预览。
    expect(cli.mode).toBe("release-only");
    expect(cli.tag).toBe("v1.5.5");
    expect(cli.dryRun, "旧实现会在这里返回 false，直接去 POST").toBe(true);
  });

  it("**`--release-only` 缺值直接报错**（不再掉进完整发版）", () => {
    expect(() => parseReleaseArgs(["--release-only"])).toThrow(/缺少值/u);
    // 跟着一个 flag 也算缺值
    expect(() => parseReleaseArgs(["--release-only", "--dry-run"])).toThrow(/缺少值/u);
  });

  it("`--release-only` 的值必须是版本 tag 形态", () => {
    expect(() => parseReleaseArgs(["--release-only", "1.5.5"])).toThrow(/版本 tag/u);
    expect(() => parseReleaseArgs(["--release-only", "latest"])).toThrow(/版本 tag/u);
    expect(parseReleaseArgs(["--release-only", "v1.5.5"]).tag).toBe("v1.5.5");
  });

  it("未知参数报错（拼错不该静默落进另一个模式）", () => {
    expect(() => parseReleaseArgs(["--bogus"])).toThrow(/未知参数/u);
    expect(() => parseReleaseArgs(["--dryrun"])).toThrow(/未知参数/u);
  });

  it("多余的位置参数报错", () => {
    expect(() => parseReleaseArgs(["v1.5.5"])).toThrow(/多余的参数/u);
  });

  it("三种正常模式", () => {
    expect(parseReleaseArgs([]).mode).toBe("full");
    expect(parseReleaseArgs(["--dry-run"]).mode).toBe("dry-run");
    expect(parseReleaseArgs(["--release-only", "v1.5.5"]).mode).toBe("release-only");
  });

  it("`--note` 需要值，且能正常传入", () => {
    expect(() => parseReleaseArgs(["--note"])).toThrow(/缺少值/u);
    expect(parseReleaseArgs(["--note", "说明", "--dry-run"]).note).toBe("说明");
  });
});

describe("RELEASE_TAG：发布标签形态（V55-03）", () => {
  it("稳定版都认", () => {
    for (const tag of ["v1.5.5", "v0.1.0", "v10.0.0"]) {
      expect(RELEASE_TAG.test(tag), tag).toBe(true);
    }
  });

  it("**标准预发布标识认**（旧实现漏掉这三种）", () => {
    for (const tag of ["v1.6.0-rc.1", "v1.6.0-beta.2", "v1.6.0-alpha"]) {
      expect(RELEASE_TAG.test(tag), tag).toBe(true);
    }
  });

  it("**人工备份/临时标签不认**（旧实现会误认数字开头的）", () => {
    for (const tag of ["v1.6.0-backup", "v1.6.0-1-backup", "v1.6.0-1", "scratch-tag", "release-candidate"]) {
      expect(RELEASE_TAG.test(tag), tag).toBe(false);
    }
  });
});
