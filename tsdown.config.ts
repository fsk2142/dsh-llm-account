import { defineConfig } from "tsdown";

// `lib/` is the bundle output the host loads. `entry` must be the **object** map below:
// the array form emits `lib/vendors/...`, which does not match the flat targets declared in
// package.json `exports` (`./lib/commandcode.js`, `./lib/opencode.js`).
//
// `client` is deliberately absent: `./client` is a **browser** artifact and this config is
// `platform: "node"` — building it here would emit a node-targeted bundle for a target that
// loads in the GUI. Plan 1b adds a browser-target build for it (`exports` keeps the
// declaration in the meantime).
export default defineConfig({
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
});
