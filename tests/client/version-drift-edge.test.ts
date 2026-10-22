/**
 * 版本漂移检测的边界情况（2026-10-22）。
 *
 * 用户在 v0.8.1 之后报「又发现新 bug」，这里把 `checkVersionDrift` 的边界逐一钉住 ——
 * 它挂在 `apply` 路径上，出错会同时影响「该不该弹」与「会不会误弹」。
 *
 * 排查到的两类风险：
 *
 * 1. **误弹**：`PLUGIN_VERSION` 在构建期注入失败时是 `"0.0.0-unknown"`，
 *    与磁盘版本永不相等 → 每次加载页面都弹。用户遇到一次「刷新了也没用」之后
 *    就会学会忽略这类提示，那比不弹更糟。
 * 2. **读不到**：远程面是**懒挂载**的，`apply` 时 `context.remote.llm-account`
 *    可能还不存在 → 检测放弃。不弹是对的，但要有明确语义。
 */
import { describe, expect, it } from "vitest";

import { UNKNOWN_VERSION, driftOf, isKnownVersion, versionsMatch } from "../../src/client/version-drift";

describe("构建期版本号异常时不能误弹", () => {
  it("**占位版本号不会触发弹窗**（否则每次加载都弹）", () => {
    const result = driftOf(UNKNOWN_VERSION, { ok: true, version: "0.8.1" });
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.reason).toContain("placeholder");
    }
  });

  it("空版本号同样不判断", () => {
    expect(driftOf("", { ok: true, version: "0.8.1" }).kind).toBe("unknown");
  });

  it("正常版本号仍能正确判出 stale", () => {
    expect(driftOf("0.8.0", { ok: true, version: "0.8.1" }).kind).toBe("stale");
  });

  it("`isKnownVersion` 只认真实版本号", () => {
    expect(isKnownVersion("0.8.1")).toBe(true);
    expect(isKnownVersion(UNKNOWN_VERSION)).toBe(false);
    expect(isKnownVersion("")).toBe(false);
    expect(isKnownVersion("  ")).toBe(false);
  });

  it("版本号含前后空格时仍正确判断", () => {
    expect(versionsMatch(" 0.8.1 ", "0.8.1")).toBe(true);
  });
});
