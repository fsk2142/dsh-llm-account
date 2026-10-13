import { defineConfig } from "tsdown";

// `lib/` is the bundle output the host loads; the vendor and client entries
// (`lib/commandcode.js`, `lib/opencode.js`, `lib/client.js`) declared in
// package.json `exports` are added to `entry` by the assembly task, which is
// also when those source files come into existence.
export default defineConfig({
  entry: ["src/index.ts"],
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
