import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HabitatSessionMetadata } from "../../habitat/types.js";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Collect distinct `discordChannelId` values from session dirs named `discord-*`
 * with recent `lastUsed` (for startup REST backfill of missed messages).
 */
export async function readRecentDiscordSessionChannelIds(
  sessionsDir: string,
  options?: { maxAgeMs?: number },
): Promise<string[]> {
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const cutoff = Date.now() - maxAgeMs;
  const out = new Set<string>();
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.startsWith("discord-")) {
      continue;
    }
    try {
      const st = await stat(join(sessionsDir, name));
      if (!st.isDirectory()) {
        continue;
      }
      const raw = await readFile(
        join(sessionsDir, name, "meta.json"),
        "utf-8",
      );
      const meta = JSON.parse(raw) as HabitatSessionMetadata;
      if (meta.type !== "discord" || typeof meta.discordChannelId !== "string") {
        continue;
      }
      const last = Date.parse(meta.lastUsed);
      if (!Number.isNaN(last) && last >= cutoff) {
        out.add(meta.discordChannelId);
      }
    } catch {
      continue;
    }
  }
  return [...out];
}
