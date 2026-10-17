/**
 * `cordis.patch.yml` is this package's only attachment point to the host
 * Loader, and its row names are constrained by the host's `client-modules`
 * scan (measured 2026-10-17 on desktop 0.2.1-rc.1 — see
 * `docs/superpowers/notes/2026-10-17-client-boot-graph.md`):
 *
 * - A **subpath** row name (`dsh-llm-account/opencode`) mounts on the host but
 *   never becomes a client source: the scan's `exactPackageSpecifier` returns
 *   `undefined` for subpaths, so the declared `dsh.client` bundle silently
 *   never enters the browser boot graph — no UI, no error.
 * - A `dsh.client` package must be the source of **exactly one** row: two
 *   visible rows throw `ClientPackageCompositionError` and take the whole
 *   client boot down.
 *
 * So the patch must keep the `llm-commandcode` row a subpath (invisible to the
 * scan but still mounted, and still the target of the user profile patch's
 * by-id override) and give the `opencode-go` row the single scan-visible,
 * path-form name whose `nearestPackage` walk lands on this package root.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PATCH = fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url));
const MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as {
  icon?: unknown;
  exports?: Record<string, unknown>;
  dsh?: { client?: { platform?: unknown } };
};

/** Mirrors client-modules' `exactPackageSpecifier`: a bare package root, or undefined. */
function packageRootSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
  }
  return specifier.length > 0 && !specifier.includes("/") && !specifier.includes(":")
    ? specifier
    : undefined;
}

/** Mirrors client-modules' `locatePkgJson` visibility gate: path-like or bare root. */
function scanVisible(name: string): boolean {
  const pathLike =
    name.startsWith(".") ||
    name.startsWith("file:") ||
    name.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(name);
  return pathLike || packageRootSpecifier(name) !== undefined;
}

type Row = { id: string; name: string };

/** Reads the insert section's rows: `- id:` directly followed by `name: "…"`. */
function insertRows(yaml: string): Row[] {
  const rows: Row[] = [];
  for (const match of yaml.matchAll(/^\s*-\s*id:\s*(\S+)\s*\r?\n\s*name:\s*"([^"]+)"/gmu)) {
    rows.push({ id: match[1]!, name: match[2]! });
  }
  return rows;
}

describe("cordis.patch.yml boot-graph contract", () => {
  const rows = insertRows(readFileSync(PATCH, "utf8"));

  it("inserts exactly the two legacy row ids", () => {
    expect(rows.map((row) => row.id)).toEqual(["llm-commandcode", "opencode-go"]);
  });

  it("keeps the commandcode row a subpath (invisible to the scan, patch-overridable)", () => {
    expect(rows.find((row) => row.id === "llm-commandcode")?.name).toBe(
      "dsh-llm-account/commandcode",
    );
  });

  it("keeps the opencode row the single scan-visible name, as a path into this package", () => {
    const visible = rows.filter((row) => scanVisible(row.name));
    expect(visible.map((row) => row.id)).toEqual(["opencode-go"]);
    expect(visible[0]?.name).toBe("./node_modules/dsh-llm-account/lib/opencode.js");
  });

  it("ships the ./client export and the manifest icon", () => {
    expect(MANIFEST.dsh?.client?.platform).toBe("web");
    expect(MANIFEST.exports).toHaveProperty("./client");
    expect(MANIFEST.icon).toBe("./icon.svg");
  });
});
