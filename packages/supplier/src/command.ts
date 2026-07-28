/**
 * `umwelten supplier` — turn this machine into a Supplier.
 *
 * A CLI command rather than a separately installed binary: someone who already
 * has umwelten runs a command they already have, which is the difference
 * between onboarding hardware being a task and it being a decision.
 *
 * This package deliberately does **not** depend on `@umwelten/exchange`. It
 * talks to a running Exchange over HTTP, which keeps a database driver out of
 * every umwelten install for a command that never opens a database.
 */

import { Command } from "commander";
import { discoverRuntimes } from "./discover.js";
import { probeOffer } from "./probe.js";
import { findDuplicateModels, probeTargets, toOfferDrafts } from "./offers.js";
import { ExchangeClient } from "./exchange-client.js";
import type { MachineState, ProbedOffer, ServingMode, SupplierConfig } from "./types.js";

interface CliOptions {
  exchange?: string;
  credential?: string;
  guarantees?: string;
  mode?: string;
  provider?: string;
  model?: string;
  concurrency?: string;
  noHeadroom?: boolean;
}

function resolveConfig(opts: CliOptions): SupplierConfig {
  const exchangeUrl = opts.exchange ?? process.env.EXCHANGE_URL;
  const credential = opts.credential ?? process.env.SUPPLIER_CREDENTIAL;
  if (!exchangeUrl) throw new Error("No Exchange URL. Pass --exchange or set EXCHANGE_URL.");
  if (!credential) {
    throw new Error("No credential. Pass --credential or set SUPPLIER_CREDENTIAL.");
  }

  const mode = (opts.mode ?? "adapted") as ServingMode;
  if (mode !== "managed" && mode !== "adapted") {
    throw new Error(`Unknown serving mode "${mode}". Expected managed or adapted.`);
  }

  return {
    exchangeUrl,
    credential,
    guarantees: (opts.guarantees ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    servingMode: mode,
    providers: opts.provider?.split(",").map((p) => p.trim()).filter(Boolean),
    modelFilter: opts.model,
  };
}

async function probeMachine(
  config: SupplierConfig,
  opts: CliOptions,
  onProgress: (line: string) => void,
): Promise<{ machine: MachineState; probed: ProbedOffer[] }> {
  const runtimes = await discoverRuntimes(config.providers);
  const machine: MachineState = { runtimes };

  for (const runtime of runtimes) {
    onProgress(
      runtime.reachable
        ? `✓ ${runtime.provider.padEnd(11)} ${runtime.models.length} model(s)`
        : `✗ ${runtime.provider.padEnd(11)} unreachable — ${runtime.error}`,
    );
  }

  const targets = probeTargets(machine, {
    providers: config.providers,
    modelFilter: config.modelFilter,
  });
  const concurrency = (opts.concurrency ?? "1")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  const probed: ProbedOffer[] = [];
  for (const [i, target] of targets.entries()) {
    onProgress(`[${i + 1}/${targets.length}] ${target.provider}:${target.model} …`);
    probed.push(
      await probeOffer(target.provider, target.model, {
        concurrency,
        skipHeadroom: opts.noHeadroom,
      }),
    );
  }

  return { machine, probed };
}

export const supplierCommand = new Command("supplier")
  .description("Turn this machine into a Supplier the Exchange can dispatch to")
  .addHelpText(
    "after",
    `
Serving modes:
  managed   The agent owns the runtime, pinning context size and quantization.
            Only managed Offers can commit to resource properties, which is why
            it is the default posture (ADR 0010).
  adapted   Resell a runtime already running on this machine. Costs the owner
            nothing to join, and carries no resource commitments — a lesser
            tier, priced as one.

Examples:
  umwelten supplier probe --no-headroom
  umwelten supplier publish --exchange https://exchange.example --credential $KEY
`,
  );

supplierCommand
  .command("probe")
  .description("Show what this machine can do, without publishing anything")
  .option("--provider <names>", "Restrict to these runtimes (comma-separated)")
  .option("--model <substring>", "Restrict to Models matching this")
  .option("--concurrency <levels>", "Headroom sample levels, e.g. 1,4", "1")
  .option("--no-headroom", "Capabilities only — much faster")
  .option("--mode <mode>", "managed or adapted", "adapted")
  .action(async (opts: CliOptions) => {
    // A dry run needs no Exchange: an operator inspecting a new machine should
    // not have to register it first.
    const config: SupplierConfig = {
      exchangeUrl: "",
      credential: "",
      guarantees: [],
      servingMode: (opts.mode ?? "adapted") as ServingMode,
      providers: opts.provider?.split(",").map((p) => p.trim()).filter(Boolean),
      modelFilter: opts.model,
    };

    const { probed } = await probeMachine(config, opts, (line) => console.log(line));
    const drafts = toOfferDrafts(probed, { servingMode: config.servingMode });

    console.log(`\nWould publish ${drafts.length} offer(s):`);
    for (const draft of drafts) {
      console.log(`  ${draft.model.padEnd(46)} ${draft.capabilities.join(", ") || "none"}`);
    }

    const failed = probed.filter((p) => p.failed);
    if (failed.length) {
      // A failed probe produces no Offer rather than an Offer with a hole in
      // it, so an operator has to be told which Models fell out and why.
      console.log(`\n${failed.length} model(s) produced no offer:`);
      for (const f of failed) console.log(`  ${f.model} — ${f.failed}`);
    }

    const duplicates = findDuplicateModels(drafts);
    if (duplicates.length) {
      console.log(
        `\n⚠ Published twice, and the Exchange keys on (Supplier, Model) — ` +
          `one will overwrite the other: ${duplicates.join(", ")}`,
      );
    }
  });

supplierCommand
  .command("publish")
  .description("Probe this machine and publish its Offers to the Exchange")
  .option("--exchange <url>", "Exchange base URL (or EXCHANGE_URL)")
  .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
  .option("--guarantees <names>", "Guarantees to claim, comma-separated")
  .option("--mode <mode>", "managed or adapted", "adapted")
  .option("--provider <names>", "Restrict to these runtimes")
  .option("--model <substring>", "Restrict to Models matching this")
  .option("--concurrency <levels>", "Headroom sample levels", "1")
  .option("--no-headroom", "Capabilities only")
  .action(async (opts: CliOptions) => {
    const config = resolveConfig(opts);
    const { probed } = await probeMachine(config, opts, (line) => console.log(line));
    const drafts = toOfferDrafts(probed, { servingMode: config.servingMode });

    const client = new ExchangeClient({
      exchangeUrl: config.exchangeUrl,
      credential: config.credential,
    });
    const result = await client.publish(drafts, config.guarantees);

    if (result.ok) {
      console.log(`\nPublished ${result.offers} offer(s).`);
      console.log(`Offered under: ${(result.guarantees ?? []).join(", ") || "no guarantees"}`);
      return;
    }

    // Surfaced, never swallowed. A Supplier that believes it is on-premise and
    // is not needs to hear about it.
    console.error(`\nPublish failed (${result.status}): ${result.error ?? "unknown"}`);
    if (result.message) console.error(`  ${result.message}`);
    process.exitCode = 1;
  });

supplierCommand
  .command("withdraw")
  .description("Remove this machine's Offers from the Exchange")
  .option("--exchange <url>", "Exchange base URL (or EXCHANGE_URL)")
  .option("--credential <token>", "Supplier credential (or SUPPLIER_CREDENTIAL)")
  .action(async (opts: CliOptions) => {
    const config = resolveConfig({ ...opts, mode: "adapted" });
    const client = new ExchangeClient({
      exchangeUrl: config.exchangeUrl,
      credential: config.credential,
    });
    const result = await client.withdraw();
    console.log(result.ok ? "Withdrawn." : `Withdraw failed (${result.status}).`);
    if (!result.ok) process.exitCode = 1;
  });
