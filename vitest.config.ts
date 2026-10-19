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
  },
});
