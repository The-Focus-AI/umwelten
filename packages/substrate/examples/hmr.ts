/**
 * Hot module replacement, live: a component module on disk is edited and
 * swapped into a running process — including a broken edit that rolls back.
 * Run with: npx tsx packages/substrate/examples/hmr.ts
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext } from "../src/index.js";
import { Loader } from "../src/loader.js";

const dir = await mkdtemp(join(tmpdir(), "substrate-hmr-"));
const file = join(dir, "banner.mjs");
const url = pathToFileURL(file).href;

const writeBanner = (text: string, broken = false) =>
  writeFile(
    file,
    broken
      ? "export default { this is not javascript"
      : `export default {
  name: "banner",
  apply() {
    console.log("  [banner] ${text}");
    return () => console.log("  [banner] down");
  },
};
`,
  );

const root = createContext();
const loader = new Loader(root);

console.log("initial load:");
await writeBanner("v1 — hello");
await loader.apply([{ id: "banner", url }]);

console.log("\nedit the file, reload:");
await writeBanner("v2 — edited live");
await loader.reload("banner");

console.log("\na broken edit — the running v2 must survive:");
await writeBanner("", true);
await loader.reload("banner");
const status = loader.entries()[0];
console.log(`  error recorded: ${String(status.error).slice(0, 60)}...`);
console.log(`  still active:   ${status.fiber?.active}`);

console.log("\nthe fix lands:");
await writeBanner("v3 — fixed");
await loader.reload("banner");

await root.dispose();
await rm(dir, { recursive: true, force: true });
