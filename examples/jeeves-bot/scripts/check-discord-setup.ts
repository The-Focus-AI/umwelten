#!/usr/bin/env node
/**
 * Quick sanity check before running the Jeeves Discord bot:
 * env vars, work dir, config.json, optional discord.json, Discord token → API.
 *
 * Run from repo root:
 *   dotenvx run -f examples/jeeves-bot/.env -- pnpm exec tsx examples/jeeves-bot/scripts/check-discord-setup.ts
 * Or from examples/jeeves-bot (after pnpm install in that package for tsx):
 *   pnpm run check-discord
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JEEVES_BOT_DIR = resolve(__dirname, "..");

function loadEnvFile(filePath: string): void {
  try {
    const text = readFileSync(filePath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    /* optional file */
  }
}

function resolveWorkDir(): string {
  const raw = process.env.JEEVES_WORK_DIR?.trim();
  if (!raw) {
    return join(homedir(), ".jeeves");
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\\/.test(raw)) {
    return raw;
  }
  return join(JEEVES_BOT_DIR, raw.replace(/^\.\//, ""));
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ⚠ ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ✗ ${msg}`);
}

async function discordTokenCheck(token: string): Promise<boolean> {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    fail(`Discord API: ${res.status} ${res.statusText} (check token and that the app is a bot)`);
    return false;
  }
  const data = (await res.json()) as { username?: string; id?: string };
  ok(`Discord token valid (bot: ${data.username ?? "?"}#${data.id ?? "?"})`);
  return true;
}

function providerKeyPresent(provider: string): boolean {
  const p = provider.toLowerCase();
  if (p === "google") return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
  if (p === "openrouter")
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  if (p === "github" || p === "github-models")
    return Boolean(process.env.GITHUB_TOKEN?.trim());
  warn(`Unknown provider "${provider}" — verify API key env vars yourself`);
  return true;
}

async function main(): Promise<number> {
  const envPath = join(JEEVES_BOT_DIR, ".env");
  loadEnvFile(envPath);
  if (existsSync(envPath)) {
    ok(`Loaded ${envPath} (empty values do not override existing env)`);
  } else {
    warn(`No ${envPath} — using process env only`);
  }

  console.log("\n[Jeeves Discord setup check]\n");

  let errors = 0;

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    fail("DISCORD_BOT_TOKEN is not set");
    errors++;
  } else {
    ok("DISCORD_BOT_TOKEN is set");
    try {
      const apiOk = await discordTokenCheck(token);
      if (!apiOk) errors++;
    } catch (e) {
      fail(`Discord API request failed: ${e instanceof Error ? e.message : String(e)}`);
      errors++;
    }
  }

  const workDir = resolveWorkDir();
  if (existsSync(workDir)) {
    ok(`Work dir exists: ${workDir}`);
  } else {
    warn(`Work dir missing (will be created on first run): ${workDir}`);
  }

  const configPath = process.env.JEEVES_CONFIG_PATH?.trim()
    ? resolve(process.env.JEEVES_CONFIG_PATH.trim())
    : join(workDir, "config.json");
  if (existsSync(configPath)) {
    ok(`config.json: ${configPath}`);
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as {
        agents?: unknown[];
      };
      const n = Array.isArray(cfg.agents) ? cfg.agents.length : 0;
      if (n === 0) {
        warn("config.json has no agents — /bind-agent needs valid agent ids");
      } else {
        ok(`${n} agent(s) in config (use their ids with /bind-agent)`);
      }
    } catch {
      fail("config.json is not valid JSON");
      errors++;
    }
  } else {
    warn(`No config.json yet (${configPath}) — onboarding will create it on first habitat run`);
  }

  const routingPath = process.env.DISCORD_ROUTING_PATH?.trim()
    ? resolve(process.env.DISCORD_ROUTING_PATH.trim())
    : join(workDir, "discord.json");
  if (existsSync(routingPath)) {
    try {
      const dj = JSON.parse(readFileSync(routingPath, "utf-8")) as {
        channels?: Record<string, string>;
      };
      const count = dj.channels ? Object.keys(dj.channels).length : 0;
      ok(`discord.json: ${routingPath} (${count} channel/thread mapping(s))`);
    } catch {
      warn("discord.json exists but is not valid JSON");
    }
  } else {
    ok(`No discord.json yet (${routingPath}) — optional; use /bind-agent in Discord or edit manually`);
  }

  const provider = process.env.JEEVES_PROVIDER?.trim() || "google";
  const model = process.env.JEEVES_MODEL?.trim() || "gemini-3-flash-preview";
  if (providerKeyPresent(provider)) {
    ok(`Provider API key present for ${provider}`);
  } else {
    fail(`Missing API key for provider "${provider}" (e.g. GOOGLE_GENERATIVE_AI_API_KEY)`);
    errors++;
  }
  ok(`Model: ${provider}:${model}`);

  if (process.env.DISCORD_GUILD_ID?.trim()) {
    ok(`DISCORD_GUILD_ID set — slash commands register for that guild (fast refresh)`);
  } else {
    warn("DISCORD_GUILD_ID unset — global slash commands can take up to ~1h to appear");
  }

  console.log("\nNext: enable **Message Content Intent** in the Discord Developer Portal (Bot tab).");
  console.log("Then from examples/jeeves-bot:  dotenvx run -- pnpm run discord");
  console.log("   (runs `umwelten habitat discord` with JEEVES prefix + ./jeeves-bot-data-dir)\n");

  return errors > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
