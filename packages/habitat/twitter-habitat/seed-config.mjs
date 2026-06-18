/**
 * Idempotent config.json seeder for the twitter-habitat image (#155).
 *
 * Ensures the habitat config points at the seeded work-dir assets:
 *   - toolsDir     = "tools"        (so the bookmarks tool loads from /data/tools)
 *   - stimulusFile = "STIMULUS.md"  (so the Twitter persona is used)
 *
 * Never overwrites existing fields: a Gaia-seeded config.json keeps its name,
 * provider/model, secret bindings, and any agents it already declares. Only the
 * two work-dir-pointing fields are filled in when missing. Creates a minimal
 * standalone config when the volume is empty (plain `docker run`, no Gaia).
 */
import { readFileSync, writeFileSync } from "node:fs";

const configPath = process.argv[2];
if (!configPath) {
  console.error("usage: seed-config.mjs <path-to-config.json>");
  process.exit(1);
}

let config;
let existed = true;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  existed = false;
  // Minimal standalone default. Provider/model come from env or an operator
  // edit; Gaia normally seeds those before this runs.
  config = { name: "Twitter" };
}

if (config === null || typeof config !== "object" || Array.isArray(config)) {
  config = { name: "Twitter" };
  existed = false;
}

let changed = false;
if (config.toolsDir === undefined) {
  config.toolsDir = "tools";
  changed = true;
}
if (config.stimulusFile === undefined) {
  config.stimulusFile = "STIMULUS.md";
  changed = true;
}
if (config.name === undefined) {
  config.name = "Twitter";
  changed = true;
}

if (changed || !existed) {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`[twitter-habitat] Seeded config.json (toolsDir, stimulusFile).`);
}
