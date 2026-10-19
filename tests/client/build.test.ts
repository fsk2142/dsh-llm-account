import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_BUNDLE = fileURLToPath(new URL("../../lib/client.js", import.meta.url));

/**
 * Modules the **browser** bundle may reference by bare specifier: the host loader answers exactly
 * these from its own module table (mirrors `CLIENT_EXTERNALS` in `tsdown.config.ts`).
 */
const CLIENT_HOST_MODULES = ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"];

/**
 * Host entries, each asserted on its own (aggregating them would let one
 * clobbered entry hide behind the others' imports).
 *
 * `specifiers` is always the **exact** expected set of bare `@deepseek-ai/*`
 * imports: an entry that lost them (inlined) or gained new ones both fail. The
 * empty array for `lib/index.js` is the assertion that the host root entry
 * carries no bare import of its own — asserting mere existence was the gap that
 * let a rewritten root entry pass.
 */
const HOST_BUNDLES: ReadonlyArray<{ path: string; specifiers: readonly string[] }> = [
  {
    path: fileURLToPath(new URL("../../lib/index.js", import.meta.url)),
    specifiers: [],
  },
  {
    path: fileURLToPath(new URL("../../lib/commandcode.js", import.meta.url)),
    specifiers: ["@deepseek-ai/dsh-llm", "@deepseek-ai/schemastery"],
  },
  {
    path: fileURLToPath(new URL("../../lib/opencode.js", import.meta.url)),
    specifiers: ["@deepseek-ai/dsh-llm", "@deepseek-ai/schemastery"],
  },
  {
    // 第三家：与另两家同一档依赖（LLM 适配器基类 + Config schema）。
    path: fileURLToPath(new URL("../../lib/opendesign.js", import.meta.url)),
    specifiers: ["@deepseek-ai/dsh-llm", "@deepseek-ai/schemastery"],
  },
];

/** Node builtins that must never reach the browser product (bare, un-prefixed form). */
const NODE_BUILTINS = [
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
  "module", "net", "os", "path", "process", "stream", "url", "util", "worker_threads", "zlib",
];

const BUILD_HINT = "lib/ is missing or stale — run `pnpm build` before `pnpm test` (lib/ is a gitignored build artifact).";

/** The bundle is a build artifact, so a missing file must fail with the fix, not a bare ENOENT. */
function readBundle(path: string): string {
  if (!existsSync(path)) throw new Error(`${BUILD_HINT}\n  expected: ${path}`);
  // Normalize EOL so the shape assertions below do not depend on the checkout's git config.
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

/**
 * Every emitted JS bundle in `lib/`, including rolldown's code-split chunks.
 *
 * Chunk file names carry a content hash (`usage-remote-CY57W-EK.js`), so a scan that
 * only looked at the three entry files would miss whatever the bundler decided to
 * split out — exactly where an inlined host package would land.
 * @returns absolute paths of all emitted `.js` files.
 */
function emittedBundles(): string[] {
  const dir = fileURLToPath(new URL("../../lib", import.meta.url));
  if (!existsSync(dir)) throw new Error(BUILD_HINT);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => join(dir, name));
}

/**
 * Bare `@deepseek-ai/*` specifiers that survive as real import statements.
 * Anchored at line start so `@deepseek-ai` mentions inside comments are not
 * counted, but newlines inside the import list are still covered.
 */
function bareDeepseekImports(source: string): string[] {
  const matches = source.matchAll(/^[ \t]*import\s[^;]*?from\s*["'](@deepseek-ai\/[^"']+)["']/gm);
  return [...matches].map((match) => match[1]!).sort();
}

type LoaderRegistration = {
  id: string;
  factory: (require: (id: string) => unknown) => unknown;
};

/** Evaluate the bundle the way the GUI loader does: one `__ModuleLoader__.load` call. */
function loadClientBundle(source: string, requireImpl: (id: string) => unknown = () => ({})): unknown {
  const registrations: LoaderRegistration[] = [];
  const host = globalThis as typeof globalThis & { window?: { __ModuleLoader__?: unknown } };
  const previous = host.window;
  host.window = { __ModuleLoader__: { load: (registration: LoaderRegistration) => registrations.push(registration) } };
  try {
    // eslint-disable-next-line no-new-func -- the bundle is a script, not a module.
    new Function(source)();
  } finally {
    if (previous === undefined) delete host.window;
    else host.window = previous;
  }
  expect(registrations).toHaveLength(1);
  return registrations[0]!.factory(requireImpl);
}

describe("client bundle build", () => {
  it("构建产物是客户端 bundle：调用 __ModuleLoader__.load 且 id 正确", () => {
    const source = readBundle(CLIENT_BUNDLE);

    expect(source.split(/\r?\n/, 1)[0]).toContain("window.__ModuleLoader__.load({");
    // Id on its own line, exactly as the legacy plugins' client bundles declare it.
    expect(source).toMatch(/^window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "dsh-llm-account",\s*\n\s*factory: \(require\) => \{/);
    expect(source.trimEnd().endsWith("return module.exports;\n\t}\n});")).toBe(true);

    const exports = loadClientBundle(source) as { apply?: unknown; inject?: unknown };
    expect(typeof exports.apply).toBe("function");
    // Cordis *service* names, not npm module ids: the loader arms exactly these
    // before calling apply, and the list intentionally differs from
    // package.json `dsh.client.inject`.
    expect(exports.inject).toEqual(["slots", "locale", "remote", "remote.settings"]);
  });

  it("客户端入口不导入任何 node 内置模块（静态 / require / 动态 import 三种形态）", () => {
    const source = readBundle(CLIENT_BUNDLE);

    expect(source).not.toMatch(/(?:from\s*|require\s*\(\s*|import\s*\(\s*)["']node:/);
    const bare = NODE_BUILTINS.join("|");
    expect(source).not.toMatch(new RegExp(`(?:require\\s*\\(\\s*|import\\s*\\(\\s*)["'](?:${bare})["']\\s*\\)`));
  });

  it("客户端产物自包含：不相对引用任何分块", () => {
    // 浏览器侧只有 `lib/client.js` 一个文件：加载器不会替它解析相对路径（宿主分块也不在浏览器
    // 图里），所以一旦它长出 `./xxx.js` 这类导入，客户端就是加载即坏。宿主侧不受此约束
    // （`platform: "node"`，可以正当使用 node 内置与相对分块）。
    const source = readBundle(CLIENT_BUNDLE);
    expect(source).not.toMatch(/(?:from\s*|require\s*\(\s*|import\s*\(\s*)["']\.{1,2}\//);
  });

  it("客户端产物只引用宿主提供的模块（白名单之外的裸导入一律不许出现）", () => {
    // 这一条守的是「按值导入宿主/内核代码」这类回归：`src/client/usage-contract.ts` 从
    // `src/core/adapter.ts` 只做**类型**导入（`verbatimModuleSyntax` 会擦掉整条 import），一旦
    // 有人把它改成值导入，core 的 `@deepseek-ai/dsh-llm` 之类就会进浏览器产物 —— 那时
    // `node:` 断言可能仍然通过（该依赖没用到 node 内置），所以必须直接断言裸导入集合。
    //
    // 正则的**前缀守卫** `(?:^|[^-\w])` 是必需的：没有它，`"data-switch-from": notice.fromRef`
    // 这种属性名里的 `from"` 会被当成导入语句，测试就会对正常代码报假阳性（T8 实测踩到）。
    const source = readBundle(CLIENT_BUNDLE);
    const bare = [...source.matchAll(/(?:^|[^-\w])(?:from|require\s*\(|import\s*\()\s*["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    const outside = [...new Set(bare)].filter((specifier) => !CLIENT_HOST_MODULES.includes(specifier));
    expect(outside).toEqual([]);
  });
});

describe("host-side bundles", () => {
  it.each(HOST_BUNDLES)("$path 的裸 @deepseek-ai 导入与期望集合精确一致（逐文件断言）", ({ path, specifiers }) => {
    const source = readBundle(path);

    // Exact set, sorted: `[]` for lib/index.js, which must carry no bare import.
    expect(bareDeepseekImports(source)).toEqual([...specifiers].sort());
  });

  it("宿主提供的 dsh-typert-protocol 保持外部导入，没有被内联进任何产物", () => {
    // 这条断言的形状是关键：**内联会消灭 specifier**。所以「顶层入口里没有它」不等于安全
    // （它住在共享分块里），必须要求整目录里**至少有一个**产物仍然按裸导入引用它。
    // 该包必须留在 peerDependencies（或 tsdown 的 neverBundle 里）：被内联的副本与宿主
    // Gateway 校验的 `TypertRemoteService` 基类不是同一个类身份，远程面会注册不上。
    const importedEverywhere = emittedBundles().flatMap((path) => bareDeepseekImports(readBundle(path)));
    expect(importedEverywhere).toContain("@deepseek-ai/dsh-typert-protocol");
  });
});
