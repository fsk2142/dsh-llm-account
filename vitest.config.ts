import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // React 是**宿主运行时提供**的，本包不安装它（Ruling 22）。测试用替身顶上：
      // 只提供 createElement/Fragment，Hook 一律抛错，逼着状态机留在可单测的纯模块里。
      react: fileURLToPath(new URL("./tests/support/react-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 用量台账指到临时目录：装配测试会真的跑 `apply()`（生产采集端口 → 真实数据目录），
    // 不隔离就会把假记录写进用户台账（见 `tests/setup-usage-dir.ts`）。
    setupFiles: ["tests/setup-usage-dir.ts"],
    /**
     * 单测超时（默认 5s 不够）。
     *
     * 2026-10-22：`tests/scripts/next-version.test.ts` 会**真的跑 git 命令**
     * （每个用例 `mkdtemp` + 若干 `git commit`，单独跑 500-750ms），全量并发时偶尔
     * 挤爆 5s 默认值 —— 表现为「2 failed」而单独重跑 8/8 全过（bug 审查报告也记录了
     * 同类抖动）。
     *
     * 给 20s 而不是无限：真卡死的用例仍会失败，只是不再被正常的慢用例误伤。
     * 这不是放松断言 —— 每个用例内部该验的行为一条都没少。
     */
    testTimeout: 20_000,
  },
});
