import { defineConfig } from "tsup";

/**
 * Bundle the Exchange into one file for the container.
 *
 * Everything is inlined, including the three runtime dependencies — all of them
 * are pure JavaScript, so the image needs no `npm install` and carries no
 * `node_modules` at all. That is the whole point: the previous image copied the
 * entire monorepo's dependency tree, and the copy, the chown and the layer
 * export each cost minutes on a small instance.
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
  // No `banner` here: tsup already carries the shebang over from bin.ts, and a
  // second one lands on line 2 where it is a syntax error rather than a comment.
});
