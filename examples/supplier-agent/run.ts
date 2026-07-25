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

  console.log(`Probing ${targets.length} offer(s) at concurrency ${concurrency.join(", ")}\n`);

  const results: ProbedOffer[] = [];
  for (const [i, t] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${t.provider}:${t.model} … `);
    const probed = await probeOffer(t.provider, t.model, {
      concurrency,
      skipThroughput: has("no-throughput"),
    });
    results.push(probed);

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

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PROBES_FILE, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${PROBES_FILE}`);

  // The whole point of probing rather than declaring: show where two runtimes
  // serving the same weights disagree.
  const byModel = new Map<string, ProbedOffer[]>();
  for (const r of results) {
    const key = r.model.split(":")[0];
    byModel.set(key, [...(byModel.get(key) ?? []), r]);
  }
  const disagreements = [...byModel.entries()].filter(([, rs]) => {
    if (rs.length < 2) return false;
    const sets = rs.map((r) =>
      r.capabilities.filter((c) => c.supported).map((c) => c.name).sort().join(","),
    );
    return new Set(sets).size > 1;
  });
  if (disagreements.length) {
    console.log("\nSame weights, different capabilities — this is why we probe:");
    for (const [model, rs] of disagreements) {
      for (const r of rs) {
        const caps = r.capabilities.filter((c) => c.supported).map((c) => c.name);
        console.log(`  ${model}  ${r.provider.padEnd(11)} ${caps.join(", ") || "none"}`);
      }
    }
  }
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
