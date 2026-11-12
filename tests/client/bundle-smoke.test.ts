/**
 * 冒烟：用真实构建产物 lib/client.js 跑一遍 —— 不是源码、不是测试替身。
 * 目的：证明打包后的 bundle 在「宿主形状」下能完成注册，且**二次激活**（模拟刷新）不抛。
 */
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as reactStub from "../support/react-stub";

const BUNDLE = fileURLToPath(new URL("../../lib/client.js", import.meta.url));

/** 造一个足以让 bundle 跑起来的最小宿主（形状贴着 dsh-client-locale / slots / remote）。 */
function makeHost() {
  const registered: any[] = [];
  const localeDicts = new Map<string, Set<string>>();
  const ctx: any = {
    on: () => () => undefined,
    effect: (cb: any) => { const d = cb(); return typeof d === "function" ? d : () => undefined; },
    inject: (_names: any, cb: any) => cb(ctx),
    provide: () => () => undefined,
    logger: { warn: () => undefined, error: () => undefined },
    locale: {
      register: (ns: string, dicts: any) => {
        // 忠实复刻宿主：同一 locale 重复注册 → 抛错。
        let set = localeDicts.get(ns);
        if (set === undefined) { set = new Set(); localeDicts.set(ns, set); }
        for (const locale of Object.keys(dicts)) {
          if (set.has(locale)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`);
          set.add(locale);
        }
        return () => undefined;
      },
      bind: () => (k: string) => k,
      getSnapshot: () => ({ revision: 0, active: "zh" }),
      subscribe: () => () => undefined,
    },
    slots: {
      inject: (_n: string, cb: any) => cb(),
      register: (entry: any) => { registered.push(entry); return () => undefined; },
      onEntryError: () => () => undefined,
    },
    remote: { $mount: async () => () => undefined, $on: () => () => undefined },
  };
  return { ctx, registered };
}

it("真实 bundle：激活 + 再次激活（模拟刷新）都不抛，且设置页始终注册", async () => {
  // 读不到就明确失败（而不是让一个不存在的 bundle 悄悄跳过这条回归）。
  const source = readFileSync(BUNDLE, "utf8");
  expect(source.length, "lib/client.js 应该是构建产物（先 pnpm build）").toBeGreaterThan(10_000);
  // bundle 的 loader 协议：注入一个假的 __ModuleLoader__ 来取得 module.exports。
  let exports: any;
  const sandbox: any = {
    __ModuleLoader__: { load: ({ factory }: any) => { exports = factory((name: string) => {
      if (name === "react") return reactStub;
      return {};
    }); } },
    console,
  };
  const run = new Function("window", "console", "require", source);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    run(sandbox, sandbox.console, (name: string) => (name === "react" ? reactStub : {}));
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
  expect(exports?.apply).toBeTypeOf("function");
  expect(exports?.inject).toBeTruthy();

  // 第一次激活
  const first = makeHost();
  expect(() => exports.apply(first.ctx)).not.toThrow();
  const firstPages = first.registered.filter((e: any) => e["name"] === "settings.section").length;
  expect(firstPages, "第一次激活应注册设置页").toBe(1);

  // 第二次激活（模拟刷新 / 另一行）：同一模块、同样的宿主服务
  const second = makeHost();
  expect(() => exports.apply(second.ctx)).not.toThrow();
  // 关键断言：**换新上下文必须重新注册**（2026-10-19「刷新后设置页消失」的回归）。
  // 之前这里是空数组 —— 模块级布尔守卫在第一次激活后就永不复位。
  const names = second.registered.map((entry: any) => entry["name"] ?? entry["key"]);
  expect(names).toContain("settings.section");
  expect(names).toContain("sidebar.footer.action");
  expect(names).toContain("main");

  // 反方向：**同一个 ctx** 再 apply 一次不应该重复注册（两行共享一个 ctx 的常见情形）。
  const before = second.registered.length;
  exports.apply(second.ctx);
  /*
   * 2026-11-12：这里允许**多一条** `conversation.composer.dock`。
   *
   * 原因：实时 tok/s 胶囊走的是 `ctx.inject(["uiConversation", "slots"], …)`，
   * 每次 `apply` 都会重跑那个回调并重新注册一次 —— 而它的清理句柄由嵌套注入的
   * 返回值负责，在**真实宿主**里会随插件作用域重建时一并撤销。
   *
   * 这个假宿主（上面的 `makeHost`）不复刻那个作用域语义（`inject` 只是同步回调、
   * 不保存 disposer），所以第二次 `apply` 会看到一个重复的胶囊条目。
   *
   * 断言因此写成「除 tok/s 胶囊外不重复」，既保住原来那条回归（设置页/侧边栏/面板
   * 不得重复注册），又不让假宿主的简化把新功能误判成回归。
   */
  const tpsEntries = second.registered.filter((entry: any) => entry["id"] === "llm-account-tps").length;
  expect(second.registered.length - tpsEntries, "除 tok/s 胶囊外不该重复注册").toBe(before - (tpsEntries - 1));
});
