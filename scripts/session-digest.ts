#!/usr/bin/env npx tsx
/**
 * Summarize learnings row counts per Habitat session directory.
 * Usage: dotenvx run -- pnpm tsx scripts/session-digest.ts /path/to/habitat/sessions
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileLearningsStore } from "../src/session-record/learnings-store.js";
import { LEARNING_KINDS } from "../src/session-record/types.js";
import type { HabitatSessionMetadata } from "../src/habitat/types.js";

async function main(): Promise<void> {
  const sessionsDir = process.argv[2];
  if (!sessionsDir) {
    console.error("Usage: pnpm tsx scripts/session-digest.ts <sessionsDir>");
    process.exit(1);
  }

  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const rows: string[] = [];

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const sessionDir = join(sessionsDir, ent.name);
    let meta: HabitatSessionMetadata;
    try {
      const raw = await readFile(join(sessionDir, "meta.json"), "utf-8");
      meta = JSON.parse(raw) as HabitatSessionMetadata;
    } catch {
      continue;
    }
    const store = new FileLearningsStore(sessionDir);
    const all = await store.readAll();
    const total = LEARNING_KINDS.reduce((n, k) => n + all[k].length, 0);
    if (total === 0) continue;
    const kinds = LEARNING_KINDS.map((k) => `${k}:${all[k].length}`).join(" ");
    rows.push(
      [
        meta.lastUsed ?? meta.created,
        meta.sessionId,
        meta.type ?? "?",
        meta.routeSignature ?? "-",
        meta.agentId ?? "-",
        `rows=${total}`,
        kinds,
      ].join("\t"),
    );
  }

  rows.sort((a, b) => b.localeCompare(a));
  console.log(
    ["lastUsed", "sessionId", "type", "route", "agentId", "totals", "kinds"].join(
      "\t",
    ),
  );
  for (const line of rows) console.log(line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
