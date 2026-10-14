/**
 * 样式层测试：只允许宿主变量、注入幂等、非浏览器环境安全。
 *
 * 存在意义：Global Constraints 规定「界面只用宿主 `--dsw-*` CSS 变量；自带 `<style data-plugin-css>`」。
 * 这两条都要有机械护栏，否则一次「顺手写个 #fff」就会在深色主题下坏掉，而没人会发现。
 */
import { expect, it, vi } from "vitest";

import { CSS_CLASS, PAGE_CSS, PAGE_CSS_ID, injectPluginCss } from "../../src/client/css";

it("样式表里没有任何硬编码颜色，且所有 var() 都是宿主变量", () => {
  // 十六进制 / rgb() / hsl() 一律不许出现。
  expect(PAGE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  // 常见颜色名（值位置）也不许出现。
  expect(PAGE_CSS).not.toMatch(/\b(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)\b/);
  // 每个 `var(...)` 的第一个参数必须是 `--dsw-` 开头（宿主的变量；`transparent`/`none` 这类关键字不算变量）。
  const uses = [...PAGE_CSS.matchAll(/var\(\s*([^,)]+)/g)].map((match) => match[1]!.trim());
  expect(uses.length).toBeGreaterThan(0);
  for (const name of uses) expect(name.startsWith("--dsw-"), `${name} 不是宿主变量`).toBe(true);
  // 也不该用 !important 去压宿主样式。
  expect(PAGE_CSS).not.toContain("!important");
});

it("类名常量都在样式表里真的定义了（渲染层与样式表不许各写各的）", () => {
  for (const name of Object.values(CSS_CLASS)) {
    expect(PAGE_CSS, `样式表里缺少 .${name}`).toContain(`.${name}`);
  }
});

/** 一个假 DOM：记录建过几个 style 标签、挂到哪里。 */
function fakeDom(): {
  document: unknown;
  tags: { attrs: Record<string, string>; textContent: string; removed: boolean }[];
} {
  const tags: { attrs: Record<string, string>; textContent: string; removed: boolean }[] = [];
  const head = {
    appendChild: (node: unknown) => {
      void node;
      return node;
    },
  };
  const document = {
    head,
    querySelector: (selector: string) => {
      // 只认我们自己的选择器形状：`style[data-plugin-css="<id>"]`。
      const id = /data-plugin-css="([^"]+)"/.exec(selector)?.[1];
      return tags.some((tag) => tag.attrs["data-plugin-css"] === id && !tag.removed) ? {} : null;
    },
    createElement: (_tag: string) => {
      const element = {
        attrs: {} as Record<string, string>,
        textContent: "",
        removed: false,
        setAttribute(name: string, value: string) {
          element.attrs[name] = value;
        },
        remove() {
          element.removed = true;
        },
      };
      tags.push(element);
      return element;
    },
  };
  return { document, tags };
}

it("注入形状与旧插件一致：data-plugin + data-plugin-css，且同 id 只注入一次", () => {
  const dom = fakeDom();
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = dom.document;
  try {
    const removeFirst = injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
    expect(dom.tags).toHaveLength(1);
    expect(dom.tags[0]!.attrs).toMatchObject({ "data-plugin": "@dsh-llm-account", "data-plugin-css": PAGE_CSS_ID });
    expect(dom.tags[0]!.textContent).toBe(PAGE_CSS);

    // 第二次（另一行 apply）：幂等，不重复注入。
    injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
    expect(dom.tags).toHaveLength(1);

    // 移除器真的把标签摘掉；摘掉之后再注入会重新建一个。
    removeFirst();
    expect(dom.tags[0]!.removed).toBe(true);
    injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
    expect(dom.tags).toHaveLength(2);
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});

it("没有 document（非浏览器/测试环境）时是空操作，不抛错", () => {
  const previous = (globalThis as { document?: unknown }).document;
  delete (globalThis as { document?: unknown }).document;
  try {
    const remove = injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
    expect(typeof remove).toBe("function");
    expect(() => remove()).not.toThrow();
  } finally {
    if (previous !== undefined) (globalThis as { document?: unknown }).document = previous;
  }
});

it("宿主没有 head（比如残缺的 document 替身）时也不抛错", () => {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  try {
    expect(() => injectPluginCss(PAGE_CSS_ID, PAGE_CSS)()).not.toThrow();
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
});

it("注册失败仍然不影响注入（样式与插槽是两件独立的事）", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const dom = fakeDom();
    const previous = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = dom.document;
    try {
      injectPluginCss(PAGE_CSS_ID, PAGE_CSS);
      expect(dom.tags).toHaveLength(1);
    } finally {
      (globalThis as { document?: unknown }).document = previous;
    }
  } finally {
    spy.mockRestore();
  }
});
