import { defineConfig, type UserConfig } from "tsdown";

const PACKAGE_NAME = "dsh-llm-account";

/**
 * Host-provided modules the browser bundle must NOT inline: the DSH module
 * loader answers these from its own module table when it calls the bundle
 * factory's `require`. Anything else the client imports is bundled.
 */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "@deepseek-ai/dsh-client-ui-primitives",
];

// `lib/` is the bundle output the host loads. `entry` must be the **object** map below:
// the array form emits `lib/vendors/...`, which does not match the flat targets declared in
// package.json `exports` (`./lib/commandcode.js`, `./lib/opencode.js`).
//
// Two configs, because `./client` is a **browser** artifact and the host entries are
// `platform: "node"`: the client bundle is CommonJS wrapped in the loader protocol
// (`window.__ModuleLoader__.load({ id, factory })`) instead of ESM.
const hostConfig: UserConfig = {
  name: `${PACKAGE_NAME}/host`,
  entry: {
    index: "src/index.ts",
    commandcode: "src/vendors/commandcode/index.ts",
    opencode: "src/vendors/opencode/index.ts",
  },
  outDir: "lib",
  format: "esm",
  platform: "node",
  target: "node22",
  dts: true,
  clean: true,
  // tsdown's node-platform default forces `.mjs`; the package is `type: module`
  // and the host loads `lib/*.js`, so use the package-type based extension.
  fixedExtension: false,
  // `@deepseek-ai/dsh-typert-protocol` must stay **external**: it is a host-provided
  // package, and the Gateway validates the `typertRemote` binding stamped by its own
  // `TypertRemoteService` base class. An inlined copy is a different class identity,
  // so the registration would not be recognised. It is declared in
  // `peerDependencies` (which tsdown externalizes by default) and pinned here
  // explicitly so a future move back to devDependencies cannot silently re-bundle it.
  deps: {
    neverBundle: ["@deepseek-ai/dsh-typert-protocol"],
  },
};

const clientConfig: UserConfig = {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: "src/client/index.ts" },
  outDir: "lib",
  // CommonJS, not IIFE: the loader injects `require` for the externals above
  // and reads `module.exports` as the plugin's `{ apply, inject }`.
  format: "cjs",
  platform: "browser",
  // Browser syntax floor. Without this, tsdown targets `engines.node` (node22)
  // even for the browser platform, which is the wrong contract for this product.
  target: "es2022",
  // No declarations for the browser entry: tsdown's isolated-declarations pass
  // emits nothing for it (verified — `dts: true` yields zero files here), and the
  // legacy client bundles ship no `client.d.ts` either. package.json's
  // `exports["./client"]` therefore carries **no** `types` condition (removed in
  // Task 1), so the export declaration matches the artifact that actually exists.
  dts: false,
  // Must not wipe the host entries emitted by `hostConfig`.
  clean: false,
  // `banner` + `intro` + `footer` reproduce the legacy plugins' packaging
  // (verified against @mars-sea/dsh-commandcode-provider/lib/client.js):
  // the first line is the single `__ModuleLoader__.load` call that declares
  // the factory, and the last line returns the factory's `module.exports`.
  outputOptions: {
    entryFileNames: "client.js",
    // Line layout is deliberate: it reproduces the legacy bundle line-for-line
    // (banner = the single `load` call head, intro = the CJS module preamble).
    banner: [
      "window.__ModuleLoader__.load({",
      `\tid: ${JSON.stringify(PACKAGE_NAME)},`,
      "\tfactory: (require) => {",
    ].join("\n"),
    intro: "\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;",
    footer: "\t\treturn module.exports;\n\t}\n});",
  },
  // `neverBundle` only: the three host-provided client packages that are not
  // declared in package.json must stay external (they are resolved by the
  // loader's `require`). Everything else follows tsdown's package.json-driven
  // externalization, so a future client value-import of a **declared** peer
  // dependency stays external instead of being silently inlined into the
  // browser product. Do not add an `alwaysBundle` override here: it would
  // disable that default and re-introduce exactly that failure mode.
  //
  // This does NOT prevent `node:*` builtins pulled in by a bundled
  // (undeclared/transitive) dependency — `tests/client/build.test.ts` is the
  // guard for that.
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
  },
};

export default defineConfig([hostConfig, clientConfig]);
