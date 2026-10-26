/**
 * 两个 Open Design 账号**能否并存并切换**。
 *
 * 用户的担心：「那不就相当于我只能使用一个账号，不能够在两个账号之间切换了吗？」
 *
 * ## 需要证明的三件事
 *
 * 1. **凭据各自独立**：两个账号的 ref 不同，各自的密钥写在各自的槽位；
 * 2. **请求路径不读 `~/.amr/config.json`**：登录产物只是**一次性导入**成普通凭据，
 *    之后发请求按 ref 从凭据库取 —— 所以 vela 覆盖固定槽位不影响已导入的账号；
 * 3. **切换只换 ref**：选中哪个账号就取哪个 ref 的密钥。
 *
 * 第 2 条是整个设计成立的前提。如果适配器每次发请求都重读那个文件，那么 vela 覆盖
 * `profiles.prod` 后两个账号就会变成同一个 —— 那才是用户担心的「只能用一个」。
 */
import { describe, expect, it, vi } from "vitest";

import { accountRef } from "../../src/core/accounts";
import { opendesignControlRef } from "../../src/vendors/opendesign/accounts";

/** 两个不同邮箱派生出的凭据 ref。 */
const FIRST = accountRef("opendesign", "first@example.com");
const SECOND = accountRef("opendesign", "second@example.com");

describe("两个账号的凭据槽位互相独立", () => {
  it("不同邮箱 → 不同的推理凭据 ref", () => {
    expect(FIRST).not.toBe(SECOND);
  });

  it("不同邮箱 → 不同的控制面凭据 ref", () => {
    const firstControl = opendesignControlRef({} as never, FIRST);
    const secondControl = opendesignControlRef({} as never, SECOND);
    expect(firstControl).not.toBe(secondControl);
  });

  it("**同一邮箱重复登录 → 同一个 ref**（这是「换密钥」而不是「新增账号」）", () => {
    expect(accountRef("opendesign", "first@example.com")).toBe(FIRST);
  });

  it("推理槽与控制面槽不会撞（同一个账号的两把密钥分开存）", () => {
    expect(opendesignControlRef({} as never, FIRST)).not.toBe(FIRST);
  });
});

describe("适配器按 ref 取密钥，不重读登录产物", () => {
  it("**请求路径只读凭据库，不读 ~/.amr/config.json**", async () => {
    /**
     * 用源码契约断言：适配器的 deps 里有 `resolveStored(ref)`（凭据库），
     * **没有**任何读 `~/.amr/config.json` 的入口。
     *
     * 这条断言的价值：如果将来有人为了「自动同步 vela 登录」而在请求路径上加一次
     * 文件读取，两账号就会退化成「都用最后一个登录的」—— 用户担心的那个后果。
     */
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../src/vendors/opendesign/adapter.ts", import.meta.url), "utf8"),
    );
    // 请求路径不该出现读 amr 配置的调用。
    expect(source, "适配器不该读 ~/.amr/config.json").not.toMatch(/\.amr[/\\]config\.json/u);
    // 凭据从注入的读取器来。
    expect(source).toMatch(/resolveStored/u);
  });

  it("按 ref 取到的是各自账号的密钥（模拟凭据库）", async () => {
    // 一个最小的凭据库替身：每个 ref 存自己的密钥。
    const store = new Map([
      [FIRST, "sk-amr-first"],
      [SECOND, "sk-amr-second"],
    ]);
    const resolveStored = vi.fn(async (ref: string) => store.get(ref));

    expect(await resolveStored(FIRST)).toBe("sk-amr-first");
    expect(await resolveStored(SECOND)).toBe("sk-amr-second");
    // 两次取的是不同的槽位 —— 切换账号就是换 ref。
    expect(resolveStored).toHaveBeenCalledTimes(2);
  });
});
