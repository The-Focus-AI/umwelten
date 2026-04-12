#!/usr/bin/env npx tsx
/**
 * Spike 01: Verify Dagger can clone a git repo and list its files.
 *
 * This is the most basic step — if this fails, nothing else will work.
 *
 * Usage: npx tsx src/habitat/bridge/spikes/01-git-clone.ts [repo-url]
 */

import { dag, connection } from "@dagger.io/dagger";

const repoUrl =
  process.argv[2] || "https://github.com/The-Focus-AI/trmnl-image-agent";

console.log(`\n=== Spike 01: Git Clone ===`);
console.log(`Repo: ${repoUrl}\n`);

await connection(async () => {
  console.log("1. Cloning repo via dag.git()...");
  const repo = dag.git(repoUrl).head().tree();

  console.log("2. Listing entries...");
  const entries = await repo.entries();
  console.log(`   Found ${entries.length} entries:`);
  for (const entry of entries) {
    console.log(`     ${entry}`);
  }

  console.log("\n3. Reading a file...");
  const readme = repo.file("README.md");
  const content = await readme.contents();
  console.log(`   README.md: ${content.length} chars, first line: ${content.split("\n")[0]}`);

  console.log("\n✅ Git clone works!\n");
});
