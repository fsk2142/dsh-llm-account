import { expect, it, vi } from "vitest";

import { applyShell, resetShell } from "../../src/client/shell";

/** 一个够用的假宿主：locale.register 可被要求抛错。 */
function fakeHost(options: { localeThrows?: boolean } = {}) {
  const registered: Record<string, unknown>[] = [];
  const ctx = {
    effect: (cb: () => unknown) => cb(),
    inject: (_names: readonly string[], cb: (scoped: unknown) => unknown) => cb({ remote: {} }),
    locale: {
      register: () => {
        if (options.localeThrows === true) throw new Error('locale namespace "settings.llm-account" already has locale "zh"');
        return () => undefined;
      },
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (_name: string, cb: () => unknown) => cb(),
      register: (entry: Record<string, unknown>) => {
        registered.push(entry);
        return () => undefined;
      },
    },
  };
  return { ctx, registered };
}

it("文案注册抛错（locale 已被占用）时，设置页仍然注册", () => {
  resetShell();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { ctx, registered } = fakeHost({ localeThrows: true });
  applyShell(ctx, { copy: { zh: { nav: "x" }, en: { nav: "y" } }, pageComponent: () => () => null });
  warn.mockRestore();
  // 页面照常注册 —— 文案缺了只是显示 key，页面不注册就是整个设置页消失。
  expect(registered.some((entry) => entry["name"] === "settings.section")).toBe(true);
});

it("注册失败不置位守卫：下一次 apply 还能再试", () => {
  resetShell();
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  // 第一次：slots.register 抛错 → 页面没注册成功。
  const failing = fakeHost();
  // 让 `slots.inject` 本身抛错：那才是「页面注册没成功」的路径
  // （`slots.register` 抛错会被 registerPage 内部的兜底吃掉）。
  failing.ctx.slots.inject = () => {
    throw new Error("slot busy");
  };
  applyShell(failing.ctx, { pageComponent: () => () => null });
  expect(failing.registered).toHaveLength(0);
  // 第二次：正常宿主 —— 守卫若在失败时置位，这里就不会注册。
  const ok = fakeHost();
  // 第二次用正常的 inject/register。
  applyShell(ok.ctx, { pageComponent: () => () => null });
  errors.mockRestore();
  expect(ok.registered.some((entry) => entry["name"] === "settings.section")).toBe(true);
});
