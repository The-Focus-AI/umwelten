/**
 * The published manifest has to list what the bundle leaves out.
 *
 * `umwelten` ships as one package: tsup inlines every `@umwelten/*` workspace
 * package and leaves every third-party import external, resolved at runtime
 * from `dependencies`. That arrangement has one failure mode, and it is silent
 * — a workspace package adds a third-party dependency, nobody adds it here, and
 * tsup has no external declaration to honour so it inlines that too.
 *
 * Inlining a CJS package into an ESM bundle is where it bites: esbuild replaces
 * its `require()` calls with a stub that throws, so the crash is
 * `Dynamic require of "events" is not supported` at import time. Not on some
 * unusual path — on `umwelten --help`, because the fault is in the import
 * graph. `ws` did exactly this, and every test still passed, because the suite
 * runs against `src/` and never loads the artifact.
 *
 * Comparing the manifests catches it at the point the dependency is added,
 * rather than after a release.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function manifest(name: string): { name: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(packagesDir, name, "package.json"), "utf8"));
}

describe("the published manifest", () => {
  it("declares every third-party dependency the workspace packages import", () => {
    const published = manifest("umwelten");
    const declared = new Set(Object.keys(published.dependencies ?? {}));

    const undeclared: string[] = [];
    for (const dir of readdirSync(packagesDir)) {
      if (dir === "umwelten") continue;
      let pkg;
      try {
        pkg = manifest(dir);
      } catch {
        continue; // not a package directory
      }
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        // Workspace packages are inlined by tsup, so they are the one thing
        // that must *not* appear in the published manifest.
        if (dep.startsWith("@umwelten/")) continue;
        if (!declared.has(dep)) undeclared.push(`${dep} (from ${pkg.name})`);
      }
    }

    expect(
      undeclared,
      "Add these to packages/umwelten/package.json dependencies, or tsup will " +
        "inline them and the published binary will throw on import.",
    ).toEqual([]);
  });
});
