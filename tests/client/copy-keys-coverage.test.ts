/**
 * 取词护栏：源码里写到的**每一个文案键**都必须在字典里存在。
 *
 * 存在意义（2026-10-20 报障「模型显示那里变成了英文了」）：账户卡片里调的是
 * `props.t("models.showGroup")` / `models.hideGroup`，而 `copy.ts` 里**根本没有这两个键** ——
 * `dictionaryOf` 的契约是「键缺失时回退到键名」，于是中文界面上直接印出了英文键名。
 * 这类缺陷不会报错、不会崩，只是界面变的看不懂，正需要机械护栏。
 *
 * 为什么是静态扫描而不是只测渲染：`t()` 的入参类型是 `string`，编译器抓不住；而渲染路径
 * 需要造出对应的数据才能走到那一个分支（本次就是「模型目录里要正好有一组模型」才看得见）。
 * 扫源码能把**全部**分支一次覆盖。
 */
import { describe, expect, it } from "vitest";

import { COPY } from "../../src/client/copy";

/** 参与扫描的文件（客户端所有会取词的模块）。 */
const SCAN: readonly string[] = [
  "src/client/account-card.ts",
  "src/client/accounts-panel.ts",
  "src/client/dashboard.ts",
  "src/client/page.ts",
  "src/client/seams.ts",
  "src/client/shell.ts",
  "src/client/sidebar-card.ts",
  "src/client/switch-card.ts",
  "src/client/switch-panel.ts",
  "src/client/usage-card.ts",
  "src/client/failure-list.ts",
  "src/client/copy.ts",
];

/** 读源码（Node 环境；测试不跑在浏览器里）。 */
async function readSource(relative: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  return readFile(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

/** 从一段源码里抓出所有字面量取词键：`t("x")`、`props.t("x")`、`this.t("x")`。 */
function keysIn(source: string): string[] {
  const out: string[] = [];
  // 只认**字面量**参数；模板字符串/变量是动态键（`duration.${part}` 那种），由各自的测试覆盖。
  for (const match of source.matchAll(/\.?\bt\(\s*"([^"]+)"\s*\)/g)) out.push(match[1]!);
  return out;
}

describe("文案键护栏", () => {
  it("源码里用到的每个键都存在于 zh 与 en 两套字典", async () => {
    const missingZh: string[] = [];
    const missingEn: string[] = [];
    for (const file of SCAN) {
      for (const key of keysIn(await readSource(file))) {
        if (!Object.hasOwn(COPY.zh, key)) missingZh.push(`${file}: ${key}`);
        if (!Object.hasOwn(COPY.en, key)) missingEn.push(`${file}: ${key}`);
      }
    }
    expect(missingZh, "这些键在 zh 字典里不存在（界面上会印出键名）").toEqual([]);
    expect(missingEn, "这些键在 en 字典里不存在").toEqual([]);
  });

  it("模型分组的按钮是「全选 / 取消全选」，不是「显示 / 隐藏本组」", async () => {
    // 需求：「原来的显示模型可以改成 全选 这样更符合那个按钮的本来含义」。
    // 它做的是**勾选这一组所有模型**，不是展开/收起这一段。
    expect(COPY.zh["models.selectAll"]).toBe("全选");
    expect(COPY.zh["models.clearAll"]).toBe("取消全选");
    const source = await readSource("src/client/account-card.ts");
    expect(source).toContain('props.t("models.selectAll")');
    expect(source).toContain('props.t("models.clearAll")');
    // 旧键必须彻底消失：留在代码里就会重新变成「键名印在界面上」。
    expect(source).not.toContain("models.showGroup");
    expect(source).not.toContain("models.hideGroup");
  });
});
