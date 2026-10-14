import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_BUNDLE = fileURLToPath(new URL("../../lib/client.js", import.meta.url));
const HOST_BUNDLES = [
  fileURLToPath(new URL("../../lib/index.js", import.meta.url)),
  fileURLToPath(new URL("../../lib/commandcode.js", import.meta.url)),
  fileURLToPath(new URL("../../lib/opencode.js", import.meta.url)),
];

const BUILD_HINT = "lib/ is missing or stale — run `pnpm build` before `pnpm test` (lib/ is a gitignored build artifact).";

/** The bundle is a build artifact, so a missing file must fail with the fix, not a bare ENOENT. */
function readClientBundle(): string {
  if (!existsSync(CLIENT_BUNDLE)) throw new Error(`${BUILD_HINT}\n  expected: ${CLIENT_BUNDLE}`);
  // Normalize EOL so the shape assertions below do not depend on the checkout's git config.
  return readFileSync(CLIENT_BUNDLE, "utf8").replaceAll("\r\n", "\n");
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
    const source = readClientBundle();

    expect(source.split(/\r?\n/, 1)[0]).toContain("window.__ModuleLoader__.load({");
    // Id on its own line, exactly as the legacy plugins' client bundles declare it.
    expect(source).toMatch(/^window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "dsh-llm-account",\s*\n\s*factory: \(require\) => \{/);
    expect(source.trimEnd().endsWith("return module.exports;\n\t}\n});")).toBe(true);

    const exports = loadClientBundle(source) as { apply?: unknown; inject?: unknown };
    expect(typeof exports.apply).toBe("function");
    expect(exports.inject).toEqual([
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-api-remotes",
    ]);
  });

  it("客户端入口不导入任何 node 内置模块", () => {
    const source = readClientBundle();

    expect(source).not.toMatch(/(?:from\s*|require\(\s*)["']node:/);
    expect(source).not.toMatch(/require\(\s*["'](?:fs|path|url|os|child_process)["']\s*\)/);
  });
});

describe("host-side bundles", () => {
  it("宿主入口仍然是裸 @deepseek-ai 导入（客户端构建没有改写它们）", () => {
    const missing = HOST_BUNDLES.filter((file) => !existsSync(file));
    if (missing.length > 0) throw new Error(`${BUILD_HINT}\n  missing: ${missing.join(", ")}`);

    const bareImports = HOST_BUNDLES.flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^(?:import|export)\b.*\bfrom\s*["']@deepseek-ai\//.test(line)),
    );
    expect(bareImports.length).toBeGreaterThan(0);
  });
});
