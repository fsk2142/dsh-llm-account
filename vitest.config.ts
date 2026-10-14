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
  },
});
