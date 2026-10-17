/**
 * The host decides whether this package may mount at all with
 * `app-boot`'s `evaluatePluginCompatibility`, run while it parses our
 * `cordis.patch.yml`. A row whose manifest fails that check is set
 * `disabled: true` with **one stderr line and nothing else** — the loader
 * never imports it, the entry gets no fiber, and `client-modules` skips it
 * without a word. Result: no settings page, no sidebar card, no error
 * anywhere in the UI. Measured 2026-10-17 on desktop 0.2.1-rc.2, where our
 * peers stopped at `0.2.1-rc.1` and both rows went dark.
 *
 * So this test replays the host's own rule against the **desktop versions
 * this machine is expected to run on**. The market's `/dsh-market/check`
 * is NOT a substitute: it compares peers against the versions pnpm
 * resolved inside the profile (still `0.2.0-rc.2` here), not against the
 * running `app-boot` version the gate actually uses.
 *
 * Bump `SUPPORTED_DESKTOP_VERSIONS` when a new desktop lands, and widen the
 * `dsh-*` peer ranges in package.json in the same commit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const MANIFEST_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  engines?: { node?: string; dsh?: string };
  peerDependencies?: Record<string, string>;
};

/**
 * Every desktop release this package is verified against. Each one is a
 * version we have actually booted, not a guess.
 */
const SUPPORTED_DESKTOP_VERSIONS = [
  "0.2.0-rc.2",
  "0.2.1-alpha.1",
  "0.2.1-alpha.2",
  "0.2.1-rc.1",
  "0.2.1-rc.2",
];

/** semver with `includePrerelease`, matching the host's own `satisfies`. */
function satisfies(version: string, range: string): boolean {
  // `semver` reaches the tree through `@deepseek-ai/cordis`; it is not a direct
  // dependency, so resolve it through that host package instead of relying on
  // hoisting. A missing copy must fail loudly: silently skipping this check is
  // exactly how the version gate broke unnoticed.
  const require = createRequire(import.meta.url);
  const fromCordis = createRequire(require.resolve("@deepseek-ai/cordis/package.json"));
  const semver = fromCordis("semver") as {
    satisfies: (v: string, r: string, o?: { includePrerelease?: boolean }) => boolean;
  };
  return semver.satisfies(version, range, { includePrerelease: true });
}

/**
 * Mirrors `app-boot`'s `unmetRequirements`: an own `engines.dsh` decides
 * alone and peerDependencies are ignored; otherwise every `@deepseek-ai/dsh`
 * or `@deepseek-ai/dsh-*` peer must match the runtime version.
 */
function unmetRequirements(runtimeVersion: string): Record<string, string> {
  const engines = MANIFEST.engines ?? {};
  if (engines.dsh !== undefined) {
    return satisfies(runtimeVersion, engines.dsh) ? {} : { "engines.dsh": engines.dsh };
  }
  const unmet: Record<string, string> = {};
  for (const [name, range] of Object.entries(MANIFEST.peerDependencies ?? {})) {
    if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
    if (!satisfies(runtimeVersion, range)) unmet[name] = range;
  }
  return unmet;
}

describe("host compatibility gate", () => {
  it.each(SUPPORTED_DESKTOP_VERSIONS)("mounts on desktop %s", (version) => {
    // Non-empty here means the host would set `disabled: true` on both rows,
    // which presents as a plugin that silently does nothing.
    expect(unmetRequirements(version), `desktop ${version} would disable this plugin`).toEqual({});
  });

  it("declares a dsh-* peer at all (otherwise the gate has nothing to check)", () => {
    const dshPeers = Object.keys(MANIFEST.peerDependencies ?? {}).filter(
      (name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"),
    );
    expect(dshPeers.length).toBeGreaterThan(0);
  });

  it("keeps engines.dsh and dsh-* peers from disagreeing silently", () => {
    // `engines.dsh` short-circuits every peer, so a stale range there would
    // make the peer list decorative. Pin the choice instead of leaving it implied.
    if (MANIFEST.engines?.dsh !== undefined) {
      for (const version of SUPPORTED_DESKTOP_VERSIONS) {
        expect(satisfies(version, MANIFEST.engines.dsh!), `engines.dsh excludes ${version}`).toBe(true);
      }
    }
  });
});
