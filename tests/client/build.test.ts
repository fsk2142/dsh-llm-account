import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_BUNDLE = fileURLToPath(new URL("../../lib/client.js", import.meta.url));

/**
 * Host entries, each asserted on its own (aggregating them would let one
 * clobbered entry hide behind the others' imports). `specifiers: null` means
 * the entry legitimately carries no bare `@deepseek-ai/*` import and is only
 * checked for existence.
 */
const HOST_BUNDLES: ReadonlyArray<{ path: string; specifiers: readonly string[] | null }> = [
  {
    path: fileURLToPath(new URL("../../lib/index.js", import.meta.url)),
    specifiers: null,
  },
  {
    path: fileURLToPath(new URL("../../lib/commandcode.js", import.meta.url)),
    specifiers: ["@deepseek-ai/dsh-llm", "@deepseek-ai/schemastery"],
  },
  {
    path: fileURLToPath(new URL("../../lib/opencode.js", import.meta.url)),
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
    expect(exports.inject).toEqual(["slots", "locale", "remote"]);
  });

  it("客户端入口不导入任何 node 内置模块（静态 / require / 动态 import 三种形态）", () => {
    const source = readBundle(CLIENT_BUNDLE);

    expect(source).not.toMatch(/(?:from\s*|require\s*\(\s*|import\s*\(\s*)["']node:/);
    const bare = NODE_BUILTINS.join("|");
    expect(source).not.toMatch(new RegExp(`(?:require\\s*\\(\\s*|import\\s*\\(\\s*)["'](?:${bare})["']\\s*\\)`));
  });
});

describe("host-side bundles", () => {
  it.each(HOST_BUNDLES)("$path 仍是裸 @deepseek-ai 导入（逐文件断言）", ({ path, specifiers }) => {
    const source = readBundle(path);

    if (specifiers === null) {
      // lib/index.js is the host root entry; it carries no imports of its own today.
      expect(source.length).toBeGreaterThan(0);
      return;
    }
    expect(bareDeepseekImports(source)).toEqual([...specifiers].sort());
  });
});
