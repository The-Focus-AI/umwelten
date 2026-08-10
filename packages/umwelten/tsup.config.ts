import { defineConfig } from "tsup";

/**
 * Build the one published package.
 *
 * The workspace is ten packages because that is a useful way to *write* this
 * code — the dependency DAG is enforced, and `@umwelten/supplier` deliberately
 * cannot reach `@umwelten/mycel`, so a Postgres driver never lands on a GPU box.
 * None of that has to be true on npm. `umwelten` has shipped as a single
 * self-contained package for nineteen versions, and this keeps it that way:
 * the split stays an implementation detail we can rearrange without a release.
 *
 * So every `@umwelten/*` import is inlined here, and every third-party import
 * stays external and is declared in `dependencies` — the same shape 0.4.12 has.
 */
export default defineConfig({
  entry: {
    // Matches 0.4.12's layout exactly, including `bin` → dist/cli/entry.js, so
    // an existing global install upgrades in place rather than moving its
    // executable.
    index: "src/index.ts",
    "cli/entry": "../cli/src/entry.ts",
    "mcp-serve": "src/mcp-serve.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  // Everything in `dependencies` is external by default; this pulls the
  // workspace packages *in* rather than leaving imports nothing can resolve.
  noExternal: [/^@umwelten\//],
  // Declarations for the library entries only. The CLI entry is an executable,
  // not an API, and it lives outside this package's rootDir — asking tsc to
  // describe it fails on that alone.
  dts: { entry: { index: "src/index.ts", "mcp-serve": "src/mcp-serve.ts" } },
  sourcemap: true,
  clean: true,
  shims: false,
});
