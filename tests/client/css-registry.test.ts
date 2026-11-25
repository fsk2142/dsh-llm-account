/** CSS 注册表不能继续积累死常量；每个声明都必须有生产引用和对应规则。 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

import { CSS_CLASS, PAGE_CSS } from "../../src/client/css";
import { cssClassReferences, cssSelectorClasses } from "../support/css-registry";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

it("CSS_CLASS 每个常量都有生产引用与对应规则", () => {
  const cssSource = readFileSync("src/client/css.ts", "utf8");
  const block = cssSource.slice(cssSource.indexOf("export const CSS_CLASS = {"));
  const entries = [...block.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*"([^"]+)"/gm)].map(
    (match) => ({ key: match[1]!, className: match[2]! }),
  );
  const references = new Set<string>();
  const selectorClasses = cssSelectorClasses(PAGE_CSS);
  for (const path of walk("src")) {
    if (relative(process.cwd(), path).replaceAll("\\", "/") === "src/client/css.ts") continue;
    for (const key of cssClassReferences(readFileSync(path, "utf8"), path)) references.add(key);
  }

  const unused = entries.filter(({ key }) => !references.has(key));
  expect(unused.map(({ key }) => key), "生产代码未使用的 CSS 常量").toEqual([]);

  const missingRules = entries.filter(({ className }) => !selectorClasses.has(className));
  expect(missingRules.map(({ key }) => key), "没有对应 CSS 规则的常量").toEqual([]);
  expect(Object.keys(CSS_CLASS).length).toBe(entries.length);
});
