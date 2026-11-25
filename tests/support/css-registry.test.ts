/** CSS 注册表辅助函数必须忽略注释/字符串，并要求完整类名 token。 */
import { describe, expect, it } from "vitest";

import { cssClassReferences, cssSelectorClasses } from "./css-registry";

describe("CSS 注册表辅助函数", () => {
  it("生产引用只认绑定 CSS 模块的真实属性访问", () => {
    const source = `
      // CSS_CLASS.commentOnly
      const text = "CSS_CLASS.stringOnly";
      const other = { CSS_CLASS: { propertyOnly: true } };
      import { CSS_CLASS as Styles } from "./css";
      import { CSS_CLASS as Other } from "../other/css";
      const real = Styles.realUse;
      const bracket = Styles["bracketUse"];
      const wrong = Other.wrongUse;
    `;
    expect([...cssClassReferences(source, "src/client/fixture.ts")].sort()).toEqual(["bracketUse", "realUse"]);
  });

  it("CSS 规则只认完整选择器类名，不被注释或前缀类名骗过", () => {
    const css = `
      /* .dsl-commentOnly { color: red; } */
      .dsl-prefix-extra { color: red; }
      .dsl-real-use:hover, .dsl-other[data-x] { color: blue; }
      .x { content: ".dsl-stringOnly"; }
    `;
    expect([...cssSelectorClasses(css)].sort()).toEqual(["dsl-other", "dsl-prefix-extra", "dsl-real-use", "x"]);
  });
});
