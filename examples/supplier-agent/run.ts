#!/usr/bin/env node
/**
 * Supplier agent — prototype CLI.
 *
 * "I'm running a DGX Spark / M4 Max and I want to plug it into the exchange."
 *
 *   discover   which local runtimes are up, and what they serve
 *   probe      run each model and record what it can actually do
 *   publish    turn probe results into OfferDrafts and send them up
 *
 * Usage:
 *   dotenvx run -- pnpm tsx examples/supplier-agent/run.ts discover
 *   dotenvx run -- pnpm tsx examples/supplier-agent/run.ts probe --provider ollama
 *   dotenvx run -- pnpm tsx examples/supplier-agent/run.ts probe --model gemma --concurrency 1,4
 *   dotenvx run -- pnpm tsx examples/supplier-agent/run.ts publish --supplier office-spark
 *
 * `probe` writes its results to output/supplier-agent/probes.json; `publish`
 * reads that file, so the slow stage runs once and can be republished freely.
 */

import fs from "node:fs";
import path from "node:path";
import "@umwelten/core/env/load.js";
import { discoverRuntimes, toProbeTargets } from "./discover.js";
import { probeOffer } from "./probe.js";
import { publishOffers, toOfferDrafts } from "./publish.js";
import { printCapabilityMatrix } from "./report.js";
import type { ProbedOffer, SupplierProfile } from "./types.js";

const OUT_DIR = "output/supplier-agent";
const PROBES_FILE = path.join(OUT_DIR, "probes.json");

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "discover";

function flag(name: string): string | undefined {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.split("=").slice(1).join("=");
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function has(name: string): boolean {
  return argv.includes(`--${name}`);
}

async function cmdDiscover() {
  const providerFilter = flag("provider")?.split(",");
  const runtimes = await discoverRuntimes(providerFilter);

  for (const r of runtimes) {
    if (!r.reachable) {
      console.log(`✗ ${r.provider.padEnd(11)} unreachable — ${r.error}`);
      continue;
    }
    console.log(`✓ ${r.provider.padEnd(11)} ${r.models.length} model(s)`);
    for (const m of r.models) console.log(`    ${m}`);
  }

  const reachable = runtimes.filter((r) => r.reachable).length;
  console.log(`\n${reachable}/${runtimes.length} runtimes reachable.`);
  return runtimes;
}

async function cmdProbe() {
  const runtimes = await discoverRuntimes(flag("provider")?.split(","));
  const targets = toProbeTargets(runtimes, flag("model"));

  if (targets.length === 0) {
    console.error("No probe targets. Is a local runtime running?");
    process.exitCode = 1;
    return;
  }

  const concurrency = (flag("concurrency") ?? "1")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  // A full matrix takes tens of minutes and the operator will Ctrl-C it. Load
  // whatever a previous run got through, and write after every model so an
  // interrupt costs one probe rather than the whole run.
  const results: ProbedOffer[] = loadExistingProbes();
  const done = new Set(results.map((r) => `${r.provider}:${r.model}`));

  const pending = has("fresh")
    ? targets
    : targets.filter((t) => !done.has(`${t.provider}:${t.model}`));

  if (results.length && !has("fresh")) {
    console.log(`Resuming: ${results.length} already probed, ${pending.length} to go.`);
    console.log(`(Pass --fresh to re-probe everything.)\n`);
  }
  if (pending.length === 0) {
    console.log("Nothing left to probe.");
    printCapabilityMatrix(results);
    return;
  }

  console.log(`Probing ${pending.length} offer(s) at concurrency ${concurrency.join(", ")}\n`);

  for (const [i, t] of pending.entries()) {
    process.stdout.write(`[${i + 1}/${pending.length}] ${t.provider}:${t.model} … `);
    const probed = await probeOffer(t.provider, t.model, {
      concurrency,
      skipThroughput: has("no-throughput"),
    });

    // Replace any stale entry for this pair rather than accumulating duplicates.
    const idx = results.findIndex((r) => r.provider === t.provider && r.model === t.model);
    if (idx >= 0) results[idx] = probed;
    else results.push(probed);
    saveProbes(results);

    if (probed.failed) {
      console.log(`FAILED — ${probed.failed}`);
      continue;
    }
    const supported = probed.capabilities.filter((c) => c.supported).map((c) => c.name);
    const single = probed.throughput.find((s) => s.concurrency === 1);
    console.log(
      `${supported.join(", ") || "none"}${single ? ` · ${single.tokensPerSecond} tok/s · ${single.ttftMs}ms TTFT` : ""}`,
    );
  }

  console.log(`\nWrote ${PROBES_FILE}`);
  printCapabilityMatrix(results);
}

function loadExistingProbes(): ProbedOffer[] {
  if (!fs.existsSync(PROBES_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(PROBES_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`Could not read ${PROBES_FILE}; starting fresh.`);
    return [];
  }
}

function saveProbes(results: ProbedOffer[]): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PROBES_FILE, JSON.stringify(results, null, 2));
}

async function cmdPublish() {
  if (!fs.existsSync(PROBES_FILE)) {
    console.error(`No ${PROBES_FILE}. Run \`probe\` first.`);
    process.exitCode = 1;
    return;
  }

  const probed: ProbedOffer[] = JSON.parse(fs.readFileSync(PROBES_FILE, "utf8"));
  const profile: SupplierProfile = {
    supplierId: flag("supplier") ?? "local-dev",
    description: flag("description"),
    guarantees: (flag("guarantees") ?? "on-premise,no-training").split(","),
  };

  const drafts = toOfferDrafts(probed, profile);
  const result = await publishOffers(drafts, profile, {
    outDir: OUT_DIR,
    exchangeUrl: flag("to") ?? process.env.EXCHANGE_URL,
    token: process.env.EXCHANGE_TOKEN,
  });

  console.log(`${drafts.length} offer draft(s) → ${result.written}`);
  if (result.posted) console.log(`Posted to exchange (${result.status}).`);
  else if (result.error) console.log(`Not posted — ${result.error}`);
  else console.log("Not posted — no --to / EXCHANGE_URL set.");
}

const commands: Record<string, () => Promise<unknown>> = {
  discover: cmdDiscover,
  probe: cmdProbe,
  publish: cmdPublish,
};

const run = commands[command];
if (!run) {
  console.error(`Unknown command: ${command}. Try discover | probe | publish.`);
  process.exit(1);
}
await run();
