/**
 * 构建期常量（由 `tsdown.config.ts` 的 `define` 烧进客户端 bundle）。
 *
 * 为什么需要它：客户端 bundle 跑在**浏览器**里，读不到 `package.json`；
 * 而市场更新接口**只暴露 commit SHA、不暴露版本号**（`routes.js` 的
 * `installedVersion: update.current ?? update.version` —— `current` 是 git commit 且优先）。
 * 于是 git 安装时界面上只能拿到一串 SHA。
 *
 * 构建期注入是唯一能拿到真版本号的路：`define` 把它替换成字符串字面量，运行时零开销。
 *
 * 本文件是**全局脚本**（没有顶层 import/export），这样 `declare const` 才是声明一个全局
 * 变量，而不是模块增补。
 */

/**
 * `package.json` 的 `version`（构建期由 `tsdown.config.ts` 注入）。
 *
 * 测试与未走构建的环境（如 vitest 直接跑源码）里它**不存在** —— 使用处必须用
 * `typeof` 守卫（见 `update-check.ts` 的 `PLUGIN_VERSION`），不能直接读。
 */
declare const __DSH_LLM_ACCOUNT_VERSION__: string;
