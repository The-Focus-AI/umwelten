import { defineConfig } from "tsup";

/**
 * Bundle the Exchange into one file for the container.
 *
 * Everything is inlined, so the image needs no `npm install` and carries no
 * `node_modules` at all. That is the whole point: the previous image copied the
 * entire monorepo's dependency tree, and the copy, the chown and the layer
 * export each cost minutes on a small instance.
 *
 * Inlining is not free, and `ws` is where the bill came due. It is CommonJS,
 * and esbuild rewrites a CJS `require()` it cannot resolve statically into a
 * stub that throws `Dynamic require of "events" is not supported` — at import
 * time, so the process dies on start rather than on some unusual path. The
 * banner below is the fix: esbuild's stub defers to a real `require` when one
 * is in scope, and `createRequire` puts one there.
 *
 * This is the container's entry only. `umwelten mycel …` still reaches the same
 * commands through the full CLI, and that path is unchanged.
 */
export default defineConfig({
  entry: { mycel: "src/bin.ts" },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  noExternal: [/.*/],
  dts: false,
  sourcemap: true,
  clean: true,
  // The shebang lives here rather than in bin.ts. esbuild puts the banner at
  // the very top of the file, so a shebang carried over from the source would
  // be pushed to line 2 — where it is a syntax error, not a comment. One
  // shebang, emitted first, and the require shim directly under it.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});
